# Friends Suggestion Shelf (seeded founder + top contributors) — Brainstorm Starter

Date: 2026-06-08
Status: PRE-BRAINSTORM idea capture. NOT an approved spec. Pick this up in a fresh
session with the `superpowers:brainstorming` skill to turn it into a real spec.

## The goal

Warm the cold start for new / 0-recipe / 0-friend users. They land with an empty
feed and no social graph, which is the activation killer we measured this session
(46 of 50 nudged users never saved a recipe; cohort is ~88% no-inviter, ~86% no
friends). Curated friend suggestions give them content and a reason to engage,
without faking relationships.

## How the suggestion shelf works TODAY (grounding)

`handleFriendSuggestions` (apps/worker/src/index.ts:3327) returns, in priority order:
1. **Friend-of-friend (`kind: 'fof'`)** — friends of your friends, ranked by
   `mutualCount`, excluding existing friends + dismissed. If it finds >= 5, that is
   the whole result (real social graph wins).
2. **Preference-match fallback (`kind: 'pref'`)** — only when < 5 FOF, tops up to ~10
   with *strangers who share dietary/meal prefs*, ranked alphabetically.

Key facts:
- Real connections (FOF) are ALREADY the priority. Seeding must complement, not
  replace, FOF.
- The app ALREADY suggests unlabeled strangers via the `pref` fallback. The seeded
  idea (labeled founder/top-contributor) is a strict improvement on that weak
  fallback and could replace it.
- Tapping "Add" sends a **friend request** (`friend_requests_sent`, `requestSent`
  flag), it is NOT an auto-connect. The shelf is already consent-based.
- Frontend: `SuggestionsShelf.jsx`; section title currently "Friends you may know".
- Endpoint: `GET /friends/suggestions`; dismiss via `POST /friends/suggestions/dismiss`.

## Decisions we converged on (validate in the brainstorm)

1. **Rename the section.** "Friends you may know" implies acquaintance, which is false
   for seeded accounts. Change to "Suggested friends" / "Suggested for you" (exact copy
   TBD). This is honesty, not just cosmetics.
2. **Seed the founder**, labeled **"ReciFriend Founder"**. Configure the founder
   account to **auto-accept** incoming requests so a tap = instant connect (it is the
   founder's own account, so no third-party consent issue). Instant connect is the
   point: it kills the empty feed the moment they tap.
3. **Seed a couple of top contributors** (users with 20+ recipes), labeled
   **"Top contributor"**. Labels explain WHY a stranger is suggested, so it reads as
   curated, not creepy.
4. **Consent for top contributors is the open risk.** Auto-connecting them to
   strangers without their say-so is over the line (they did not agree to be friends
   with random new users; it exposes their activity/friends list). Resolutions, in
   order of preference:
   - (a) **Opt them in first** ("can we feature you as a suggested friend?") -> then
     auto-accept is consensual and you keep instant-connect. Trivial at a handful of
     people; flattering for power users.
   - (b) **Normal request they approve** (no auto-accept) -> zero consent issue, but
     slower / lower conversion.
   - (c) **Feature their RECIPES, not a friendship** -> their recipes are already
     public; surface them as "featured cooks" in Discover/feed without friending
     anyone. No consent question. In this framing the founder is the only true friend
     suggestion; top contributors are featured *content*.
5. **REJECTED: auto-connecting users without consent.** Too far, consent/trust
   violation, pollutes our own `has_friends` / activation metrics, undercuts the
   "friends & family / people you know" positioning, platform/PR risk.

## Two delivery mechanics (we want both, sequenced)

- **Suggestion shelf (always-on, scalable):** founder + ~2 top contributors appear for
  new/0-recipe users with labels. Keep it to ~3, curated. Best placement: onboarding /
  warm first-load where cold start hurts. Reuse the existing request rail; founder
  auto-accepts.
- **Founder-initiated inbound request (high-touch concierge):** YOU send a real friend
  request to a handpicked 0-recipe user; they get a notification + email
  ("ReciFriend Founder wants to be your friend") and accept/decline. Louder
  re-engagement trigger than a passive shelf; personal and honest. Low build cost,
  reuses `friend_requests` + the friend-request email + `/friend-requests?accept_friend=`
  deep link.
- **Sequence:** ship shelf seeding + rename + labels FIRST (always-on baseline, mostly
  a query + copy change), then add founder-initiated requests once you see whether the
  passive shelf converts.

## Metrics note (do not skip)

Tag seeded connections distinctly so a founder/top-contributor connection does not
silently inflate the `has_friends` segment we used for activation/retention analysis.
A founder-connection is not the same retention signal as a real peer friend.

## Open questions for the brainstorm

- Exact section copy ("Suggested friends" vs "Suggested for you" vs other).
- How many seeded cards (founder + how many contributors), and ordering vs FOF.
- Top-contributor selection: manual handpick vs automatic "20+ recipes" query; how to
  rotate; opt-in flow + a "do not suggest me" control.
- Founder auto-accept mechanism (a flag on the account? a special-cased userId?).
- Do seeded cards augment or REPLACE the weak `pref` fallback?
- Analytics: how to tag/segment seeded connections.
- Placement: onboarding shelf vs Friends page vs home feed (or all).
- Whether top contributors are friend-suggestions at all vs featured-recipes (decision
  4c).

## Relevant code/files
- apps/worker/src/index.ts: `handleFriendSuggestions` (~3327), `GET /friends/suggestions`
  (~892), `friend_requests_sent`, `dismissed_suggestions`.
- apps/recipe-ui/src/components/SuggestionsShelf.jsx (the shelf UI + "Friends you may know").
- apps/worker/src/friends-suggestions.test.ts, friends-discovery.test.ts (existing tests).
