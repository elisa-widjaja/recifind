# Groups — Design Spec

**Date:** 2026-06-02
**Status:** Approved (design), not yet planned/implemented
**Type:** Premium feature

## Summary

A premium-gated space where a creator makes a **Group** and members share **text**, **link**,
and **recipe** posts. Link posts render an OG preview card; recipe posts render a native in-app
recipe card to the recipe permalink. Posts support **quote-replies** and **reactions**. The group
creator is the **admin** and moderates members and content. Think "Facebook group for cooking,"
limited to text/link/recipe content.

## Premium gating

- New column `profiles.is_premium` (INT, **default `1`** — everyone is premium for now). The
  `ADD COLUMN ... DEFAULT 1` backfills existing rows to premium.
- The entire Groups surface — the UI nav entry and every `/groups/*` API route — requires
  `is_premium = 1`. Non-premium users see a "Groups is a premium feature" upsell screen.
- **Per-request premium check (read-pressure):** every `/groups/*` call needs the caller's
  `is_premium`. To avoid an extra `profiles` read on each request, the group handlers should read
  `is_premium` in the **same query** that already loads the group/membership row (JOIN to
  `profiles`), not as a separate lookup. The premium gate on `POST /groups` (no group row yet) does
  one cheap `SELECT is_premium`.
- App-owner admin panel gets a route to grant/revoke premium per user:
  `POST /admin/users/{id}/premium`. **AuthZ:** reuse the existing `/admin/*` authorization
  (app-owner identity check tied to the admin account — match the mechanism already guarding the
  re-host / re-enrich admin routes), not just any authenticated user.
- **Migration is non-idempotent:** `ALTER TABLE profiles ADD COLUMN is_premium` fails if re-run,
  and prod has no `d1_migrations` table. Ship it as a **run-once** `wrangler d1 execute --remote`
  and guard against double-apply (check `PRAGMA table_info(profiles)` first). The new Groups tables
  use `CREATE TABLE IF NOT EXISTS` and are safely idempotent.
- Monetization switch: flipping the column default to `0` later (plus a one-time UPDATE for the
  cutoff) turns Groups into a paid feature with **no further schema change**.

## Group types, visibility & joining

At creation the admin chooses **Public** or **Private** (`groups.visibility`).

- **Public group**
  - Discoverable in a public groups list.
  - Posts are viewable by **anyone, including logged-out visitors and link-preview bots.**
    `GET /groups/{id}` and `GET /groups/{id}/posts` therefore allow the `isPublicRequest` bypass for
    public groups (no JWT required to read). Public group detail pages get OG preview cards via the
    Pages middleware, same pattern as recipe permalinks.
  - **One-tap open join** — no approval.
  - **To create a post, a user must join first** (read is open, write requires membership).
- **Private group**
  - **Join by request → admin approves** (`group_join_requests`).
  - The group and all its posts are **visible to members only**.
- **Admin invite** (both types): the admin can invite a person by email. An invitation email is
  sent to the invitee (Resend, same path as friend invites) with a **tokened** join link.
  - Acceptance flow: `POST /groups/invite/{token}/accept` (auth required) validates the token,
    resolves the caller's `user_id`, and inserts a `group_members` row directly (private group:
    bypasses the request queue), then marks the invite `accepted`.
  - **Invitee has no account yet:** mirror the existing `pending_invites` / friend-invite mechanic.
    The invite is keyed by email; on signup, match the new user's email against open
    `group_invites` and auto-join them. The email's join link routes to signup → then accept.
  - Re-inviting the same email is an **upsert** (refresh token + `created_at`), not a PK error.
- Roles (`group_members.role`): `admin` | `member`. Creator = `admin`. Schema leaves room for
  multiple admins later; v1 ships single creator-admin.

### Leaving & ownership (v1 rules)

- **Member leaves:** `DELETE /groups/{id}/members/me`. Their posts **remain** (voluntary departure
  is not a moderation action — contrast with admin removal, which suppresses).
- **Owner cannot leave.** The owner is the sole admin; to exit they must **delete the group**
  (`DELETE /groups/{id}`), which cascades members, requests, invites, posts, and reactions.
- **Admin transfer and multiple admins are out of scope for v1** (schema's `role` column leaves room
  to add them later).
- **Re-requesting after decline:** `group_join_requests` uses an upsert — a declined row can be
  overwritten by a fresh `pending` request rather than colliding on the PK.

## Posts

Every group member can post. `group_posts.type` ∈ `text` | `link` | `recipe`.

- **Text post:** body text only.
- **Link post:** a URL. The worker fetches OG metadata (title / description / image) via the
  existing `fetchOgImage` / `extractMetaContent` code and **caches it on the post row** so it is
  not re-fetched on every render. **`link_image` stores the remote image URL only** — never a
  base64 data URL (which `fetchOgImage` can return), to keep D1 rows and feed payloads small.
  Re-hosting to the `recipe-previews` bucket is a possible later optimization but is out of scope
  for v1 (watch the 5GB egress cap if added).
- **Recipe post:** the author picks **one of their own** in-app recipes via a recipe picker (search
  your recipes). Stored as `recipe_id` + `recipe_owner_id`; rendered as a native recipe card linking
  to the permalink built by `buildRecipeShareUrl(recipeId, ownerId)`.
  - **Privacy rule:** posting a recipe into a **public** group makes that recipe publicly viewable
    (set its `shared`/public flag if not already), with a **confirmation warning** in the composer
    ("This will make the recipe viewable by anyone"). Posting into a **private** group keeps it
    within the membership and does not change its public flag.
  - **Deleted recipe fallback:** if the referenced recipe is later deleted, the card renders a
    graceful "recipe no longer available" placeholder rather than a broken link.
- **Quote-reply:** a post can quote another post (`quoted_post_id`), constrained to the **same
  group**. To survive deletion/suppression of the original, the quote stores a **snapshot** of the
  quoted post's display fields (author name, a text/title excerpt) on the new row, and renders that
  snapshot inline above the body. No nested comment threads.
- **Reactions:** one reaction per user per post (toggle/replace). The emoji set is a fixed,
  server-validated list: 👍 ❤️ 😋 🔥 👏. Stored in `group_post_reactions`.

Out of scope for v1 (YAGNI, revisit later): threaded comments, post editing, post-approval
workflow.

## Moderation (admin powers)

No post-approval queue. Instead the admin can:

- Approve / decline join requests (private groups).
- Invite members by email.
- **Remove a member — that member's posts are suppressed** via a soft `suppressed` flag set at
  removal time (so re-adding the member does not auto-restore their old posts). Contrast: a member
  who **leaves voluntarily** keeps their posts visible. Feed queries filter `suppressed = 0`.
- Delete any individual post in the group.
- Edit the group (name / description / visibility) and delete the group.
  - **Visibility change side-effect:** switching **private → public** retroactively exposes all
    existing posts (and any recipes posted) to the public. Require an explicit confirmation dialog
    spelling this out before saving.

## Notifications

Reuse the existing `notifications` table + push (`sendPushToUser`) + Resend
(`sendEmailNotification`, respecting `email_opt_out`). New types:

| type | recipient | channels |
| --- | --- | --- |
| `group_join_request` | group admin | in-app + push + **email** |
| `group_join_approved` | requester | in-app + push |
| `group_invite` | invitee | **email** (join link) |
| `group_new_post` | members | in-app + push, **collapsed** (see below) |
| `group_post_reaction` | post author | in-app |
| `group_post_reply` | quoted post author | in-app + push |

**`group_new_post` fan-out rule (concrete):** to protect the 50-rows-per-user notification cap and
push quotas, send **at most one `group_new_post` notification per group per recipient per 6-hour
window**, collapsed ("3 new posts in <Group>"). Implementation: before inserting, check the
recipient's most recent unread `group_new_post` for that `group_id` (via the `data` JSON) within the
window; if present, increment its count instead of inserting a new row. Reaction notifications are
in-app only (no push/email) to avoid churn from toggling.

## Data model (new D1 tables)

```sql
groups (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT,
  visibility   TEXT NOT NULL DEFAULT 'private', -- 'public' | 'private'
  created_at   TEXT NOT NULL
);

group_members (
  group_id  TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  role      TEXT NOT NULL DEFAULT 'member',     -- 'admin' | 'member'
  joined_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);

group_join_requests (
  group_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'approved' | 'declined'
  created_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);

group_invites (
  group_id      TEXT NOT NULL,
  inviter_id    TEXT NOT NULL,
  invitee_email TEXT NOT NULL,
  token         TEXT NOT NULL,                   -- unique; used by the accept route
  status        TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted'
  created_at    TEXT NOT NULL,
  PRIMARY KEY (group_id, invitee_email)          -- re-invite = upsert (refresh token/created_at)
);
-- token lookup for the accept route:
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_invites_token ON group_invites(token);
-- email match on signup auto-join:
CREATE INDEX IF NOT EXISTS idx_group_invites_email ON group_invites(invitee_email, status);

group_posts (
  id                TEXT PRIMARY KEY,
  group_id          TEXT NOT NULL,
  author_id         TEXT NOT NULL,
  type              TEXT NOT NULL,               -- 'text' | 'link' | 'recipe'
  body              TEXT,
  link_url          TEXT,
  link_title        TEXT,
  link_description  TEXT,
  link_image        TEXT,
  recipe_id         TEXT,
  recipe_owner_id   TEXT,
  quoted_post_id    TEXT,                         -- must reference a post in the same group
  quoted_snapshot   TEXT,                         -- JSON: { author_name, excerpt } captured at post time
  suppressed        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL
);

group_post_reactions (
  post_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  type       TEXT NOT NULL,                      -- emoji key
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
```

Indexes: `group_members(user_id)` (my-groups lookup), `group_posts(group_id, created_at)`
(paginated feed), `group_post_reactions(post_id)` (reaction counts), plus the `group_invites`
indexes above and `groups(visibility, created_at)` for the discover list.

**Read-pressure plan (D1 free tier, currently ~36% of the 5M/day cap):**
- `GET /groups/{id}/posts` is **paginated** (`?limit=20&before=<cursor>`), never an unbounded scan,
  served by `idx_group_posts(group_id, created_at)`.
- `GET /groups/discover` is index-served and **capped** (e.g. top 30 by `created_at`); no `LIKE`
  scan. Add a short KV cache if it shows up in read-pressure monitoring.
- Premium is read via the existing group/membership JOIN (see Premium gating), not a separate query.

## API surface

- `POST   /groups` — create (premium-gated)
- `GET    /groups` — my groups
- `GET    /groups/discover` — public groups
- `GET    /groups/{id}` — detail + feed (membership/visibility enforced)
- `PATCH  /groups/{id}` — edit (admin)
- `DELETE /groups/{id}` — delete (admin)
- `POST   /groups/{id}/join` — open join (public) / create-or-refresh request (private)
- `GET    /groups/{id}/requests` — list pending (admin)
- `POST   /groups/{id}/requests/{userId}` — approve/decline (admin, atomic batch)
- `POST   /groups/{id}/invite` — invite by email (admin), sends email
- `POST   /groups/invite/{token}/accept` — accept an invite (auth required)
- `DELETE /groups/{id}/members/{userId}` — remove member + suppress posts (admin)
- `DELETE /groups/{id}/members/me` — leave group (member; owner is rejected, must delete group)
- `GET    /groups/{id}/posts?limit=20&before=<cursor>` — paginated feed
- `POST   /groups/{id}/posts` — create text/link/recipe/quote post (member)
- `DELETE /groups/{id}/posts/{postId}` — delete (author or admin)
- `POST   /groups/{id}/posts/{postId}/react` — toggle reaction
- `POST   /groups/preview-link` — OG fetch for the composer's link preview
- `POST   /admin/users/{id}/premium` — grant/revoke premium (app-owner admin)

## Frontend

- New `currentView === 'groups'`.
- `GroupsPage.jsx` — my groups + discover public groups + "Create group" (premium upsell if not
  premium).
- `GroupDetailPage.jsx` — post feed, composer (text / link field / recipe picker / quote-reply),
  reactions, and admin controls (requests, invite, remove member, delete post, edit/delete group).
  - Public group detail is viewable **logged-out** (read-only); posting/joining triggers the
    standard signup CTA.
  - Composer shows the **"makes this recipe public" confirmation** when attaching a recipe to a
    public group, and the **private→public visibility-change confirmation** in group settings.
- Components live alongside `RecipesPage.jsx` / `FriendSections.jsx` — **not** inline in
  `App.jsx`.

## Abuse / limits (noted, deferred)

No hard caps on groups-per-user, members-per-group, or posts in v1. Revisit if abuse appears; the
schema supports adding counts/limits later without migration churn.

## Conventions to follow

- Worker handlers: `return await handler()` inside async try/catch (avoids 1101 / missing CORS).
- D1 free tier: prefer key-prefix/index lookups over `list()`; add the indexes above; estimate
  read pressure for the feed + discover queries before shipping.
- Outbound URLs in emails use `SHARE_PUBLIC_URL`, never `window.location.origin`.
- Migrations ship as idempotent `wrangler d1 execute --remote` (no `d1_migrations` table on prod).

## Suggested build phases (shippable slices)

1. Premium foundation: `is_premium` column + gating + admin grant route.
2. Group CRUD + membership (public open-join, private request→approve) + invites + emails.
3. Posts: text / link (OG fetch) / recipe picker + feed.
4. Engagement: reactions + quote-replies.
5. Moderation: remove member (+ suppress), delete post, edit/delete group.
6. Notifications wiring across all the above.
