# Changelog

All notable user-facing changes to the ReciFriend iOS app are documented here.
Versions are App Store marketing versions; the iOS build number is in parentheses.

The format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [1.0.1] (build 20) — uploaded 2026-05-24, pending App Store submission

Everything below is new to App Store users since **1.0 (build 17)** — it spans
TestFlight builds 18 and 19 (never publicly released) plus build 20.

### Added
- **Custom recipe tags** — add/edit your own tags on recipes; filter by them and search matches tag text.
- **Multi-select filters** in the recipe collection, with filter-drawer UX cleanup.
- **"Recipes you might like"** persistent suggestion shelf (shown when fewer than 5 recipes are saved; dismissible).
- **Redesigned Add Recipe flow** — opens as a tall sheet with a borderless, always-editable iOS-style title.
- **Estimated cook time** — recipes missing a duration now show a sensible estimate.
- **Cuisines** — unified list, emojis removed, 5 new cuisines added.
- **Onboarding** — "Get Started" checklist with tappable steps that expands until you're 2/3 done.
- **Friends** — avatars on pending requests and activity, live display names, richer pending-request rows (name + email + status, privacy-scoped).
- **Sharing** — rich link previews (Universal-Link groundwork + absolute Open Graph images), a "See this in ReciFriend" prompt when opening a shared recipe on web, and consistent "already saved" state by source URL.

### Fixed
- Fixed a **blank-screen crash** in the Add Recipe flow.
- Snackbar now **auto-dismisses after 2s** and clamps to 2 lines.
- Add Recipe title no longer auto-focuses (no keyboard pop / zoom on open).
- Removed a spurious "Recipe not found" snackbar after logout.
- Suppressed the iOS long-press image menu on avatars.
- Recipe filters clear on tab-leave / logout; image fallback fixed for emoji-titled recipes.
- Avatar and activity-feed photo fixes, plus assorted spacing/layout polish.

### Performance / Build
- **App is ~3.8 MB smaller** — production source maps are no longer bundled.

### Behind the scenes (server-side — already live on prod, benefits all builds)
- **More reliable recipe import** — JSON mode, retries, caption caching, Google Docs support.
- **Images re-hosted to Supabase** so they stop failing after Instagram/TikTok CDN links expire, plus a backfill for stale URLs.
- Retry/back-off to recover from social-platform IP blocks; enrichment regression fix; new recipe source (freshoffthegrid.com).

### Internal only (not shipped in the app)
- A separate **admin dashboard** web app (users table, drill-downs, metrics/charts, audit log, support actions, re-enrich/re-host tooling). None of this is in the iOS binary.

### Not yet included
- True in-app deep-linking (SMS link → recipe **detail**). The Universal-Link parser ships in build 20, but the share-URL change that activates it is a pending web deploy to do once 1.0.1 is live.

---

#### Suggested App Store "What's New" copy
> • Organize recipes with your own custom tags, and filter or search by them
> • Smarter recipe collection: multi-select filters and a "Recipes you might like" shelf
> • Redesigned Add Recipe flow that's faster and cleaner
> • Cook-time estimates for recipes that don't list one
> • Friends improvements: avatars and clearer request statuses
> • More reliable recipe importing and link previews
> • Performance improvements and bug fixes

## [1.0] (build 17) — released on the App Store 2026-05-24

Initial public App Store release of ReciFriend (1.0). Boundary commit `6f1a85e`.
