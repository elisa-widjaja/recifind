# ReciFriend — designing "the group chat for cooking"

> A recipe-sharing app for home cooks who want to save recipes from anywhere and share them with the people they actually cook with — not build an audience.

> **⚡ At a glance**
>
> **What it is** — A "group chat for cooking": save any reel or link as a real recipe, share it with friends.
> **The challenge** — Ship a 0→1 social product solo, and decide *when* to go native without over-building.
> **My role** — Sole product designer, PM, and engineer — strategy → UX → visual design → front-end → Worker API → native Swift → analytics.
> **The decision that mattered** — Web → PWA → Capacitor iOS on one shared codebase; hand-wrote Swift *only* for the #1 "share from a reel" workflow.
> **Early signal** — ~23 of 28 users arrived through the invite loop (small, early cohort).
>
> *10-sec read above · facts below · full story in the TL;DR.*

| | |
|---|---|
| **Role** | Solo product designer & builder — research, product strategy, UX/UI, visual design, front-end, and instrumentation |
| **Type** | 0→1 consumer product (live) |
| **Platforms** | Web → installable PWA → iOS (TestFlight) |
| **Timeline** | Ongoing; iOS build 19 in TestFlight |
| **Stack** | React + Vite + MUI · Cloudflare Workers + D1 + KV + Pages · Supabase auth · Gemini · Resend · Capacitor (iOS) · Swift/SwiftUI (share extension) · GA4 |

> 📸 **Suggested hero:** `apps/recipe-ui/public/logowithshadow.svg` (logo) over a screenshot of the logged-out landing page at recifriend.com.

---

## TL;DR

I designed and shipped ReciFriend, a recipe app built around one belief: people don't want to *follow* cooks, they want to *cook with* their friends. I owned it end to end — from positioning and the growth model down to the React components, the Cloudflare Worker API, and the analytics that tell me whether any of it is working.

The interesting product decisions weren't about recipe cards. They were about **sequencing**: what to build first (a viral web loop), what to defer (a native app), and where to break my own "reuse everything" rule (one hand-written Swift component for the single most important workflow). This case study is about those decisions and the trade-offs behind them.

**Early signal (all-time, small cohort — includes my own test & family accounts):** ~23 of 28 users arrived through an invite link, with 25 friend connections and 55 peer-to-peer recipe shares between them — directionally the exact behavior the product was designed to produce.

---

## The problem & the opportunity

Saving a recipe is broken. The good ones live inside TikTok and Instagram reels, scattered YouTube videos, and blog posts buried under life stories. People screenshot them, lose them, and never cook them. And when they *do* want to share one with a partner or a friend, they paste a link into a chat where it instantly disappears.

There's an obvious "solution" — a polished feed of influencer recipes — and I deliberately rejected it. That market is saturated, and it serves creators, not cooks. The opportunity I cared about was the quiet majority: **home cooks sharing with family and friends.**

**The product bet:** capture a recipe from anywhere in one tap, auto-structure it into real ingredients and steps, and make sharing it with named friends feel as casual as a text message.

---

## User & positioning

**Who it's for:** home cooks sharing with family and friends — explicitly *not* influencers. That single exclusion shaped the whole roadmap. Audience features, follower counts, and creator tooling all went on a "not yet / not ever" list.

**Positioning:** *"the group chat for cooking."* It's a mental model anyone gets instantly — private, social, peer-to-peer, low-stakes. It told me what to build (connections, sharing, activity) and, just as usefully, what to leave out (discovery-for-strangers, vanity metrics).

**The mechanic that makes it work:** recipes are public by default (you can opt out). That one default is what powers a live discovery feed for logged-out visitors and the viral loops that bring new people in — without asking anyone to "post content."

---

## My role & approach

I was the only person on this — designer, PM, and engineer. I treated those as one job, not three. Concretely:

- **As PM:** I wrote the product strategy, defined the target user and the anti-goals, ordered the growth priorities, and set the metric gates that decide what gets built next.
- **As designer:** I designed every screen, flow, and piece of copy, and built a reusable visual system in MUI.
- **As engineer:** I shipped the React front end, the TypeScript Cloudflare Worker API, the D1 schema, the iOS wrapper, and a native Swift share extension.

The thread connecting all three: **I design with the grain of the technology.** Knowing exactly what the platform makes cheap or expensive let me design flows that were actually shippable by one person — and instrument them so I'd know if they worked.

---

## The product

A quick tour of the core loops:

**Capture from anywhere → auto-enrich.** Paste a URL (or share a reel) and Gemini turns it into a structured recipe — title, ingredients, steps, meal type, duration, image — *before* save, so the recipe is ready the moment you open it. If enrichment fails, you still keep a title-only recipe rather than nothing.

> 📸 **Suggested:** `image assets/ReciFind-AddRecipe.gif` — the paste-and-auto-fill flow.

**Discovery feed (the acquisition surface).** Logged-out visitors don't hit a wall — they see real recipe shelves: *Trending now*, *Editor's Picks*, AI-generated *Trending in health & nutrition* topics, and a *Discover new recipes* shelf. Every card has a "Save this" button that triggers signup.

> 📸 **Suggested:** `image assets/Trending in health-loggedin.png`

**Share with friends.** One tap opens a sheet with two paths: *Share with friends* (native iOS share → SMS with a rich preview) and *Share with connections* (an iMessage-style multi-select picker that notifies recipients in-app). Logged-out users skip straight to native share — no auth wall.

> 📸 **Suggested:** `image assets/share with connections drawer.png`

**Friend activity (the retention surface).** The logged-in home feed shows what your people are doing — recipes they cooked, saved, and shared — plus always-on Editor's Picks and a "Cook with Friends" invite ticker.

> 📸 **Suggested:** `image assets/homefeed-new users.png`

**Warm onboarding.** Invited users never see a cold start — they land on a "[Friend] invited you" welcome, a preview of that friend's recipes, friend-of-friend suggestions, and a pre-filled feed. *(This is the subject of a dedicated deep-dive case study.)*

---

## Platform strategy: web → PWA → iOS

This is the decision I'm proudest of, because it's where product strategy and engineering reality met.

It would have been easy — and wrong — to start by building an iOS app. Instead I sequenced the platform deliberately, governed by one rule I wrote down up front:

> **Build viral features in the PWA first. Go native only after retention is proven. Native is a retention play, not an acquisition play.**

**Stage 1 — Web app.** The whole product is a React + MUI app on Cloudflare Pages, backed by a single Cloudflare Worker. Cheap to iterate, instantly deployable, reachable from any link.

**Stage 2 — PWA.** The same web app is an installable PWA with a web *share target*, so mobile-web users can already push a URL straight into the Add Recipe flow. This is where I built and tested every viral mechanic — discovery feed, "Save this" CTAs, the invite loop — because the web is the cheapest place to learn.

**Stage 3 — iOS (via Capacitor).** Native wraps the *existing* PWA. I only justified the investment once the loop showed signal, because native's payoff is **retention** (push, home-screen presence, frictionless capture), not finding new users. The explicit success gate for taking iOS seriously: **D7 retention > 20%** `[GA: D7 retention = ___]`.

> The PWA isn't a stepping stone I threw away — it's the same codebase the iOS app runs. One product, three delivery channels.

---

## Why Capacitor over a native Swift rewrite

A full SwiftUI rewrite was a real option. I rejected it on purpose, and the reasoning is a good window into how I weigh design ambition against delivery as a solo builder.

| | **Capacitor (chosen)** | **Native Swift rewrite (rejected)** |
|---|---|---|
| **Codebase** | One React codebase serves web, PWA, and iOS | Two UIs to maintain in lockstep |
| **Speed** | Native shell bootstrapped in ~1.5 days | Weeks-to-months to reach parity |
| **Cost (solo)** | Reuse existing skills, components, tests | Stand up a parallel Swift competency |
| **Continuity** | iOS inherits the web app's behavior → near-zero regressions | Re-implement and re-test everything |
| **Trade-off accepted** | Give up native rendering performance & full UI fidelity | Gain those, at a cost I couldn't justify yet |

The deciding insight: since *native is a retention play*, what I actually needed from iOS was native **capabilities** (push notifications, the system share sheet, deep links, secure token storage) — **not** native **rendering**. Capacitor delivers those capabilities through thin plugins around an unchanged web app. So I scoped *out* everything that would truly require deep native work (native camera UI, widgets, Siri, Live Activities) and kept the native surface area as small as possible.

---

## The one place I went native: the iOS Share Extension

Here's the exception that proves the rule. The **#1 workflow** in the entire product is *"share a reel from TikTok/Instagram straight into ReciFriend."* It's the moment of capture — if that's clunky, nothing else matters. So it's the one place I wrote real Swift.

**Why it *had* to be native:** an iOS Share Extension is a separate system process with its own bundle. When someone taps Share inside Instagram and picks ReciFriend, iOS launches the *extension*, not the app — and a Capacitor WebView simply cannot run in that context. There is no JavaScript escape hatch for the share sheet. Native was the only option.

**What it does — and the design problem underneath it:**

- **v1** was a zero-UI handoff: extract the URL, open the main app via `recifriend://add-recipe?url=…`, let the existing web flow take over. Safe, simple, but it cold-started the app and made the user wait.
- **v2** saves the recipe **inside the extension itself** — a small SwiftUI form (thumbnail + editable title + Save) that calls the Worker directly, so the recipe is saved in ~300ms and Gemini enrichment finishes in the background. The user is back in their reel in a heartbeat.

> 📸 **Suggested:** `image assets/ios share recipe from reel.png` and `image assets/save to recifriend-ios drawer.png`

**The hard part — auth across a process boundary.** The extension can't run OAuth or touch Capacitor. My solution: an **App Group + a shared iOS Keychain**. The main app mirrors the Supabase JWT into the shared Keychain on every auth event (via a small custom Capacitor plugin I wrote, `SharedAuthStore`); the extension reads it read-only. On a 401 it purges the stale token.

**Designing for failure.** The native fast path is never a single point of failure: no token, a timeout, or offline all *silently fall back* to the v1 behavior (open the app with the URL pre-filled). The user never sees the seam.

> This is the case study's thesis in one feature: I'll happily reuse a web codebase across three platforms — and I'll hand-write Swift for the 5% of the experience where reuse would quietly degrade the most important moment.

---

## Designing with the grain of the tech

A few places where engineering constraints became design decisions:

- **Cloudflare D1 free tier** has hard quota limits, so I designed feeds around batched queries and key-prefix reads instead of expensive list operations — keeping the product on a $0 infra footprint while it proves itself.
- **OAuth redirects wipe browser state**, so I never rely on `localStorage` to carry context across a Google sign-in. Inviter context rides in URL params and is resolved server-side instead.
- **WebViews can't enter the share sheet**, which is exactly why the share extension is native (above).

None of these are visible in a screenshot. All of them shaped what the experience could be.

---

## Measuring success

I instrumented the product so strategy isn't a vibe — it's a dashboard.

**Custom admin dashboard** (a separate Cloudflare Pages app, `admin.recifriend.com`). Its centerpiece is a per-inviter **invite-conversion + activation** view: how many people *Joined* via someone's link, how many *Activated* (saved ≥1 recipe **and** signed in within 30 days), and the resulting **activation %**. I built the activation definition myself because "signed up" is a vanity number and "came back and used it" is the real one.

> 📸 **Suggested:** screenshot of the admin dashboard invite-conversions view (capture from `admin.recifriend.com`).

**Google Analytics (GA4)** for the acquisition funnel — landing visitors, signup conversion, retention cohorts, and event tracking (cook-mode, save, share) keyed to user IDs.

**By the numbers** *(early, all-time; small cohort that includes my own test/family accounts — directional signal, not statistical proof):*

| Loop | Signal |
|---|---|
| **Acquisition via invite** | ~23 of 28 users joined through an invite link |
| **Network formation** | 25 friend connections |
| **Sharing behavior** | 55 peer-to-peer recipe shares |
| **Engagement** | 26 cook-mode sessions logged |
| **Activation (saved ≥1 recipe)** | ~39% of users |
| **Landing → signup** | `[GA: ___]` |
| **D7 retention (iOS gate: >20%)** | `[GA: ___]` |
| **Time-to-first-invite (target: <60s)** | `[GA: ___]` |

The honest read: the invite-driven acquisition ratio is the most encouraging early signal — most users came in through the loop, which is the whole thesis. It's a small sample and not yet proof, but it's pointed the right way.

---

## Outcomes & what's next

ReciFriend is live on the web and in TestFlight (build 19). The viral loop exists end to end and the early ratios are encouraging. The roadmap is gated, not guessed:

- **Prove retention** before leaning harder into iOS — the D7 > 20% gate decides whether push becomes a priority (push tokens are still at 0; that bet is unproven by design).
- **Tighten the funnel** with GA data: where do new users drop between landing, signup, first save, and first invite?
- **Deepen the friend graph** — friend-of-friend suggestions and email-match auto-connect to make the network compound.

---

## Reflections

- **The hardest design work was deciding what *not* to build.** "Not influencers," "no native rewrite," "no iOS until retention" — each anti-goal saved weeks and kept the product coherent.
- **Constraints are a design material.** A free-tier database and a WebView's limits didn't box me in; they told me where to be clever and where to go native.
- **Instrument before you opine.** Building the admin dashboard and GA early meant every strategy claim could be checked against reality — including the uncomfortable ones (push = 0, small N).

> 📸 **Suggested closing visual:** `image assets/Why ReciFriend Carousel Design/` — the "why ReciFriend" carousel, or `image assets/App Store Status.png`.
