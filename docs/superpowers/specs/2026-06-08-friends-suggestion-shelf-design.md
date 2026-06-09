# Seeded "Suggested friends" shelf — Design

Date: 2026-06-08
Status: APPROVED design. Next step: writing-plans -> implementation.
Scope: Phase 1 only (always-on shelf seeding). Founder-initiated inbound friend
requests are a separate, later spec.

## Goal

Warm the cold start for new / 0-recipe / 0-friend users. ~86% of the recently
analyzed cohort has no friends and ~88% has no inviter, so the friend-suggestion
shelf falls back to suggesting unlabeled strangers who happen to share dietary/meal
prefs (the `pref` fallback), which is weak and slightly creepy. Replace that vanity
fallback with two curated, clearly-labeled seeded accounts (the founder and a top
contributor) so cold-start users get a credible reason to make their first
connection. Real connections still come first.

## Decisions (locked in brainstorm)

1. **Scope = Phase 1 only**: the always-on suggestion shelf. No founder-initiated
   inbound requests in this spec.
2. **No auto-accept / no auto-connect anywhere.** Seeded cards go through the exact
   same friend-request flow as friend-of-friend (FOF) cards. Tapping "Add" sends a
   normal friend request the recipient must accept.
3. **Real connections first.** FOF stays the priority tier, unchanged.
4. **Seeds replace the `pref` fallback** (the "share your prefs" strangers). The
   `pref` query and code path are deleted.
5. **Trigger = drop-in replacement for `pref`.** Seeded cards only appear when FOF
   is short (< 5 FOF), topping up the shelf. A user with 5+ FOF never sees seeds.
   Cold-start users (0 FOF) are exactly who sees them.
6. **Two seeded accounts**, ordered Founder then Top Contributor:
   - `elisa.widjaja@gmail.com` -> label **"ReciFriend Founder"**
   - `mochislime02@gmail.com` -> label **"Top contributor"**
   Both are owner-controlled accounts; no third-party consent concern.
7. **Section rename**: "Friends you may know" -> **"Suggested friends"** (true for
   both FOF and seeded cards; "you may know" is false for seeds).
8. **Bare badge labels**, no reason line / no recipe count (a hardcoded count goes
   stale).
9. **Metrics**: no schema/write-path change. Add the two seeded user IDs to the
   known-ID exclusion list the admin metrics queries already apply (same pattern as
   `METRICS_EXCLUDED_EMAILS`), so seeded friendships do not inflate the `has_friends`
   activation segment.

## Behavior / data flow

`handleFriendSuggestions` (apps/worker/src/index.ts ~3327) keeps its current shape.
The only structural change is the second tier.

- **Tier 1 (unchanged)** — Friend-of-friend (`kind: 'fof'`), ranked by `mutualCount`,
  excluding existing friends + dismissed. If it returns >= 5, that is the whole
  result.
- **Tier 2 (replaced)** — When FOF < 5, top up with the **seeded pair**
  (`kind: 'seed'`): Founder first, then Top Contributor. The old `pref`
  (shared-preferences strangers) query is removed.

Result sizes:
- 0 FOF -> up to 2 cards (Founder, Top Contributor).
- 1–4 FOF -> those FOF cards, then seeds appended (subject to exclusions below).
- 5+ FOF -> FOF only, no seeds.

## Seeded account config

A constant in the worker, easy to reorder / relabel / extend:

```ts
const SEEDED_SUGGESTIONS = [
  { email: 'elisa.widjaja@gmail.com', label: 'ReciFriend Founder' },
  { email: 'mochislime02@gmail.com',  label: 'Top contributor' },
]
```

Emails are resolved to Supabase user IDs (once at startup or per request). The
resolved IDs are what the suggestion query and the metrics exclusion list use.

## Exclusions (identical to FOF rules)

A seeded card is dropped when the seeded account is any of:
- the viewer themselves,
- already a friend of the viewer,
- already has a pending friend request in either direction,
- previously dismissed by the viewer (`dismissed_suggestions`).

This is the same set of checks FOF cards already pass, so seeds behave identically.
Notably: a user already friends with the founder will not be re-suggested the founder.

## Frontend (apps/recipe-ui/src/components/SuggestionsShelf.jsx)

- Section title: "Friends you may know" -> **"Suggested friends"**.
- Seeded cards (`kind: 'seed'`) render a bare badge sub-line using the card's
  `label` ("ReciFriend Founder" / "Top contributor") in place of the FOF
  mutual-friends line.
- "Add" sends a normal friend request; card moves to the existing "Requested"
  (`requestSent`) state. Dismiss works the same as for FOF cards. No auto-accept.
- No new card component; reuse the existing suggestion card, swap the sub-line
  source based on `kind`.

## Metrics

No code change in the write path. The two resolved seeded user IDs are added to the
exclusion the admin metrics queries already apply (alongside `METRICS_EXCLUDED_EMAILS`
handling), so a founder/top-contributor friendship does not count toward the
`has_friends` segment used for activation/retention analysis.

## Tests (apps/worker/src/friends-suggestions.test.ts)

- FOF still wins when >= 5 (no seeds appear).
- Seeds top up when FOF < 5, ordered Founder then Top Contributor.
- Each exclusion rule for a seeded account: self, already-friend, pending request
  (either direction), dismissed.
- Seeded cards carry `kind: 'seed'` and the correct `label`.
- Remove the `pref`-fallback test coverage that no longer applies.

## Relevant code/files

- apps/worker/src/index.ts: `handleFriendSuggestions` (~3327),
  `GET /friends/suggestions` (~892), `friend_requests_sent`, `dismissed_suggestions`.
- apps/recipe-ui/src/components/SuggestionsShelf.jsx (shelf UI + section title).
- apps/worker/src/friends-suggestions.test.ts, friends-discovery.test.ts.
- Wherever `METRICS_EXCLUDED_EMAILS` is applied (admin metrics queries) — add the two
  seeded IDs.

## Out of scope (explicitly)

- Founder-initiated inbound friend requests (the concierge mechanic) — separate spec.
- Auto-accept / auto-connect of any kind.
- Featuring top-contributor recipes as content (decision 4c in the starter doc) — not
  pursued; the top contributor is a normal friend suggestion.
- Pinning the founder for well-connected (5+ FOF) users.
- A "do not suggest me" control or top-contributor rotation (single, owner-controlled
  account; not needed).
