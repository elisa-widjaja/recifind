# The 60-second invite loop — designing my way out of cold start

> How I designed (and built) ReciFriend's warm-onboarding loop to get a brand-new user to invite a friend within 60 seconds of arriving — and the UX and engineering trade-offs underneath it.

> **⚡ At a glance**
>
> **The problem** — A new user lands on an empty, friendless app and leaves — fatal for a "cook with friends" product.
> **The goal** — One activation metric: invite a friend within 60 seconds of landing.
> **My role** — Sole product designer, PM, and engineer — designed *and* built the entire loop end to end.
> **What I shipped** — Live landing → "X invited you" welcome → higher-signal onboarding → friend-of-friend suggestions → pre-filled feed → smart nudge email.
> **Signature trade-off** — Show mutual-friend *counts*, never names — traded some conversion for trust.
> **Early signal** — ~23 of 28 users joined via an invite link (small, early cohort).
>
> *10-sec read above · facts below · full story in the TL;DR.*

| | |
|---|---|
| **Role** | Solo product designer & builder — strategy, UX/UI, copy, front-end, Worker API, instrumentation |
| **Focus** | New-user onboarding, virality, retention |
| **Surfaces** | Logged-out landing · "X invited you" welcome · onboarding preferences · friend-of-friend suggestions · re-engagement email · admin conversion dashboard |
| **Stack** | React + MUI · Cloudflare Workers + D1 + KV · Supabase auth (PKCE) · Gemini · Resend · GA4 |

*Companion to the [ReciFriend product overview](./recifriend-product-overview.md).*

---

## TL;DR

Every social product dies the same way: a new user signs up, lands on an empty screen, and leaves. ReciFriend's whole reason to exist is *cooking with friends*, so an empty, friendless first session isn't just a bad start — it's the product failing at the exact thing it promises.

I set one north-star activation metric — **a new user invites a friend within 60 seconds of landing** — and designed a connected loop to earn it: a landing page that feels alive, a welcome that says *who* invited you, onboarding questions that pull their weight, friend suggestions that aren't creepy, a pre-filled feed, and a re-engagement email that knows when to stay quiet.

Because I built it too, every design decision had a technical counterpart — and a few genuinely interesting trade-offs around privacy, persistence, and cost.

**Early signal (small, all-time cohort, includes my own test/family accounts):** ~23 of 28 users arrived via an invite link → directional evidence the loop pulls people in.

---

## The problem

A recipe app with no recipes and no friends is worthless on first open. Three failure modes stack up:

1. **The logged-out visitor** bounces off a static page that doesn't prove anything is happening.
2. **The new signup** lands on an empty collection (cold start) and never comes back.
3. **The invited friend** — the highest-intent person we'll ever get — arrives with no context about *why* they're here or *who* sent them.

And the deeper strategic risk: if users don't *invite* others, a peer-to-peer product has no engine. Acquisition has to come from the loop, not from ad spend I don't have.

> **The bet:** the fastest path to retention is to make a new user *give* the product to someone else immediately. The act of inviting is itself the activation.

So the metric I designed against wasn't "signups." It was **time-to-first-invite, target < 60 seconds** `[GA: median time-to-first-invite = ___]`.

---

## Insight & constraint

One product principle constrained every screen: **this is peer-to-peer, not influencer-to-audience.** That ruled out the easy growth hacks (follow suggestions for strangers, public vanity counts) and pushed me toward *warmth* — the loop had to feel like a friend handing you something, not a platform farming you for contacts.

That principle shows up most sharply later, in how I designed friend suggestions to respect privacy (below).

---

## The loop, stage by stage

### 1. Acquisition surface — a landing page that feels alive

The logged-out landing originally showed a static list of recipes. Static reads as *dead*. I rebuilt it into a discovery page of real shelves — *Trending now*, *Editor's Picks*, AI *Trending in health & nutrition* topics, *Discover new recipes* — and a **"Cook with Friends"** social-proof card with two CTAs: *Join free* and *Invite a friend*.

The key conversion mechanic: **every recipe card's "Save this" button opens signup** instead of actually saving. Wanting to keep a recipe *is* the signup trigger.

**A UX/engineering trade-off worth calling out — the activity ticker.** The "Cook with Friends" card cycles through activity one slot at a time. The original spec wanted a single shared animation controller; while building it I switched to a simpler per-component ticker (each owns its own timing) because it produced identical visible behavior with far less coupling. Same motion, less to break — a small example of letting implementation reality simplify the design without compromising it.

> 📸 **Suggested:** screenshot of recifriend.com logged-out landing (the shelves + "Cook with Friends" card).

### 2. The "X invited you" moment

The first screen after signup is a welcome modal that **branches on whether we know who invited you**:

- **Invited:** *"[Inviter] invited you to ReciFriend"* — *"[Inviter] cooks some great stuff. Save their recipes to your collection."* with a preview of up to 3 of their recipes.
- **No inviter (fallback):** a warm generic welcome with Editor's Picks previews, so the modal is **never empty**.

Both the primary CTA and "Skip for now" dismiss to the same place — I kept friction near zero on purpose. The design job here was emotional, not functional: make a stranger feel personally handed in by someone they trust.

> 📸 **Suggested:** screenshot of the welcome modal (capture the "[Friend] invited you" state).

### 3. Onboarding preferences — and a redesign that raised the signal

The first onboarding asked three questions: meal types, dietary needs, skill level. It worked, but I realized two of those questions were **low-signal for personalization**. So I redesigned it around higher-signal questions:

| v1 (lower signal) | v2 (higher signal) |
|---|---|
| Meal types | Dietary needs |
| Dietary needs | **Who you cook for** |
| Skill level | Cuisine preferences |

**"Who you cook for"** turned out to be the unlock — household context predicts recommendations far better than self-reported "skill." The card copy does the work:

- 👤 *Just me* — "Quick meals, single portions"
- 👫 *Partner or roommate* — "Easy sharing, 2–3 servings"
- 👨‍👩‍👧 *Family* — "Kid-friendly, crowd pleasers"
- 🎉 *I love to entertain* — "Impressive dishes, feeds a crowd"

Every step has a visible **Skip** and the multi-selects handle mutual exclusivity (picking "None / all good" clears the rest). Crucially, the answers aren't busywork — they feed straight into the AI recommendation prompt, so onboarding visibly pays off in the feed. **Friction vs. signal** was the running trade-off: every question had to earn its place by improving the feed or I cut it.

> 📸 **Suggested:** screenshot of the onboarding "Who you cook for" step.

### 4. Friend-of-friend suggestions — warmth without creepiness

To beat cold start, the logged-in feed surfaces a **"Friends you may know"** shelf. Two kinds of suggestion, each with honest reason copy:

- **Friend-of-friend:** *"N mutual friends"*
- **Preference match:** *"Likes [shared preference]"*

The cards are optimistic: tap *Add friend* and it flips to *Requested* instantly, reverting only on a real server error.

**The privacy trade-off I'm most deliberate about:** the easy version shows *names* of mutual friends ("Friends with Alex and Sam"). It converts better — and it leaks the social graph. I designed the server contract to return only a **mutual count**, never names. The UI says "3 mutual friends," never *who*. I traded a bit of conversion for not exposing who knows whom. For a product positioned on trust between real friends, that's the right call.

> 📸 **Suggested:** screenshot of the "Friends you may know" shelf.

### 5. The pre-filled feed — no cold start, by construction

The invited user lands on a home feed already populated with the inviter's recipes, friend activity, Editor's Picks, and the suggestion shelf. There is no empty state to design *around* because there's no empty state to begin with. The first session looks like the product already working.

> 📸 **Suggested:** `image assets/homefeed-new users.png`

### 6. Re-engagement — a nudge email that knows when to shut up

For users who sign up but don't save anything, a personalized nudge email goes out **~24 hours later** with a 3-step "how it works" strip, a demo GIF, recommended recipes, and a gamified invite hook *("Invite 5 friends… earn a reward")*.

**The timing trade-off:** it runs on an hourly cron, but **skips anyone who already saved a recipe.** Nagging an activated user is how you train them to ignore you — so the system stays silent for people who don't need it. The unsubscribe link is HMAC-signed so it can't be forged.

> 📸 **Suggested:** `image assets/ReciFriend nudge email.png` (and `image assets/Onboarding email template.png`).

---

## UX trade-offs at a glance

| Decision | I optimized for | I gave up | Why |
|---|---|---|---|
| Mutual **count**, not names | Privacy / trust | Some conversion | Trust is the brand |
| Session-only "dismissed" state | Freshness on return | Persistence | Don't permanently bury someone over one tap |
| Skip on every onboarding step | Low friction | Completion rate | A forced funnel that loses the user beats nothing |
| Skip nudge if already active | Respect | A send | Relevance > volume |
| Per-component ticker | Simplicity / robustness | A "cleaner" shared controller | Identical motion, less coupling |

---

## Technical challenges & how I solved them

This is where designing-and-building together paid off — the loop is full of problems you only see if you're also writing the code.

**OAuth wipes browser state.** You can't stash "who invited me" in `localStorage` before a Google redirect — the redirect can blow it away. I carry inviter context through **URL params** and resolve the inviter **server-side** from the invite-accept response, then trigger the welcome modal from a post-auth effect keyed only on a durable flag. The warm "X invited you" moment depends on getting this exactly right.

**Email → invite auto-connect.** When someone signs up, the Worker resolves their identity from email and auto-connects any pending invite, so accepting an invite doesn't require a manual "add friend" step.

**Friend-of-friend at the database layer.** The suggestion query self-joins the friends table, counts distinct mutual friends, and excludes me, my existing friends, and people I've already requested — ordered by mutual count.

**Cost-aware fallback (designed for a free-tier DB).** Friend-of-friend is the good suggestion; preference-matching is the fallback. So if FOF already returns enough results, the Worker **returns early and never runs the second query.** On Cloudflare D1's free tier, *not* running a query is a feature.

**N+1 → one batched query.** The activity feed first did a recipe lookup per item. I replaced it with a single `WHERE id IN (…)` over the unique recipe IDs and a map for O(1) hydration — and skip the query entirely when there's nothing to fetch.

**Caching expensive AI.** The AI recommendation topics come from Gemini, which is slow and metered. They're cached in Cloudflare KV with a **versioned key** (`ai-picks:v3:{diet}:{cuisine}:{cookingFor}`); when the personalization inputs changed, I bumped the version to invalidate cleanly. A cache hit short-circuits before any model call.

**A platform footgun I had to respect.** On Cloudflare Workers, returning a promise without `await` inside the try/catch lets rejections escape the handler and produces opaque 5xx errors with no CORS headers. Every route uses `return await …` — an invisible rule that keeps the loop from failing in ways the front end can't even diagnose.

---

## Measuring the loop

A loop you can't measure is a guess. I instrumented this one on two layers:

**Admin dashboard (built for this).** A per-inviter view shows **Joined** (signed up via your link), **Active** (saved ≥1 recipe *and* signed in within 30 days), and **Activated %**. I wrote the activation definition deliberately — "joined" flatters, "came back and cooked" is the truth. Each invitee row carries a status glyph, recipe count, and last-seen date.

> 📸 **Suggested:** screenshot of the admin invite-conversions / activation view (capture from `admin.recifriend.com`).

**Google Analytics (GA4)** for the funnel: landing → signup → first save → first invite, plus the time-to-first-invite event that grades the 60-second goal.

**By the numbers** *(early, all-time; small cohort including my own test/family accounts — directional, not statistically significant):*

| Loop stage | Signal |
|---|---|
| Joined via invite link | ~23 of 28 users |
| Invite links created | 13 (one link converts many) |
| Friend connections formed | 25 |
| Peer-to-peer shares | 55 |
| Nudge emails sent | 19 |
| Activation (saved ≥1 recipe) | ~39% of users |
| Landing → signup | `[GA: ___]` |
| Median time-to-first-invite (target <60s) | `[GA: ___]` |
| D7 retention | `[GA: ___]` |

**Honest read:** the headline is that the loop is the dominant acquisition path — most users arrived through an invite, which is exactly what a peer-to-peer product needs. It's a small N and includes my own testing, so I treat it as *direction confirmed, magnitude unproven.* The GA placeholders are the numbers that will turn "direction" into "evidence."

---

## Outcome & learnings

- **Designing the metric first changed the design.** Once "invite within 60 seconds" was the goal, every screen got judged by whether it moved someone toward inviting — which is how skip buttons, the pre-filled feed, and the "Invite a friend" CTA on the *landing* page all earned their place.
- **Privacy is a design decision, not a settings page.** Choosing mutual *counts* over names cost conversion and bought trust — and trust is the entire pitch.
- **Building it made it better.** The cost-aware query fallback, the OAuth-state handling, and the "skip the nudge if already active" rule are all UX wins that only exist because I was in the code, watching the seams.
- **What's next:** fill in the GA numbers, find the biggest funnel drop, and decide — with data, not instinct — whether the next bet is sharper friend suggestions or a faster first-invite path.

---

## Tech stack

**Front end:** React + Vite + MUI (JavaScript). **API:** Cloudflare Workers (TypeScript). **Database:** Cloudflare D1 (SQLite). **Cache:** Cloudflare KV. **Auth:** Supabase (JWT, PKCE) with Google OAuth. **AI:** Gemini (recommendation topics + recipe enrichment). **Email:** Resend, on a Cloudflare Cron trigger. **Analytics:** GA4 + a custom admin dashboard (separate Cloudflare Pages app). **Testing:** Vitest + Playwright, test-first.
