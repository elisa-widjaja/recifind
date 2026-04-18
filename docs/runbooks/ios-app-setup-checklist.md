# iOS App + Rebrand — Setup Checklist

> **For the agent:** tick checkboxes as items verify green. Use `- [x]` for completed, `- [ ]` for pending. Each section below has a **How to verify** line — run that check before ticking.

**Last updated:** 2026-04-17
**Overall progress:** 10 of 14 ready (auto-verified + Apple Dev already held by user)

---

## Section A — Already Green (agent-verified, no action)

- [x] **Xcode.app installed** at `/Applications/Xcode.app` ✅
  - How to verify: `ls /Applications/Xcode*.app`
- [x] **xcode-select pointing at full Xcode** ✅
  - How to verify: `xcode-select -p` → should output `/Applications/Xcode.app/Contents/Developer`
- [x] **Node + npm** ✅ (v22.21.0 / v10.9.4)
  - How to verify: `node -v && npm -v`
- [x] **Wrangler CLI authenticated** as `elisa.widjaja@gmail.com` ✅
  - How to verify: `cd apps/worker && npx wrangler whoami`
- [x] **Git SSH to GitHub** ✅
  - How to verify: `git push origin main` works (already verified)
- [x] **Supabase CLI installed** ✅
  - How to verify: `which supabase`
- [x] **cloudflared installed** ✅
  - How to verify: `cloudflared --version`
- [x] **Homebrew installed** ✅
- [x] **D1 database `recipes-db` reachable** ✅
  - How to verify: `cd apps/worker && npx wrangler d1 list | grep recipes-db`

---

## Section B — User Actions Required (🔴 blocking)

### B1. Apple Developer Program enrollment ($99/yr)

**Priority:** 🔴 CRITICAL — longest lead time (24–48h approval). Start first.

**Steps:**
- [ ] Open https://developer.apple.com/programs/enroll
- [ ] Sign in with Apple ID (create one at appleid.apple.com if needed)
- [ ] Choose **Individual** enrollment
- [ ] Fill in legal name, phone, address
- [ ] Pay $99 USD (credit card)
- [ ] Complete ID verification if prompted (driver's license or passport)
- [ ] Submit and wait for confirmation email

**Unlocks when approved:**
- APNs auth key (.p8) download → Story 05
- Bundle ID reservation `com.recifriend.app`
- Xcode code signing → Story 08
- Sign in with Apple service ID → Story 09
- TestFlight + App Store submission → Story 12

**Say to agent when done:** *"Apple Dev submitted"* (approval comes later, this just confirms you've started)

**Agent verification when approved:** user pastes Team ID (10 uppercase chars) into conversation; agent uses it in Story 07 AASA file.

- [x] **Apple Dev enrollment submitted** ✅
- [x] **Apple Dev enrollment approved** ✅
- [x] **Team ID captured: `7C6PMUN99K`** ✅

---

### B2. Cloudflare DNS zone for `recifriend.com`

**Priority:** 🔴 CRITICAL — blocks all domain-dependent work. Start second.

**Steps:**
- [ ] Open https://dash.cloudflare.com/
- [ ] Click **Add a site** → enter `recifriend.com`
- [ ] Choose **Free** plan
- [ ] Cloudflare scans existing DNS → click Continue
- [ ] Copy the two nameservers Cloudflare provides (e.g., `alice.ns.cloudflare.com`, `bob.ns.cloudflare.com`)
- [ ] Log into the registrar where you bought `recifriend.com` (Namecheap/GoDaddy/Porkbun/etc.)
- [ ] Replace the registrar's nameservers with Cloudflare's two
- [ ] Save at the registrar
- [ ] Back in Cloudflare, click **Done, check nameservers**
- [ ] Wait for Cloudflare to email confirming active (usually <1h, up to 24h)

**Unlocks:**
- Pages custom domain (Story 01 Task 2)
- Worker custom domain at `api.recifriend.com` (Story 01 Task 3)
- Universal Link AASA file served (Story 07)
- Email sender domain setup (Story 01 Task 9 via Resend)

**Say to agent when done:** *"Cloudflare zone added"* (propagation happens in background)

**Agent verification:** `dig NS recifriend.com` returns Cloudflare nameservers.

- [x] **Cloudflare zone added for recifriend.com** ✅ (Zone ID: `bb104f8ae2fcad09cb22fa663d487b81`)
- [ ] **Nameservers updated at registrar** — user to replace current NS with:
  - `jade.ns.cloudflare.com`
  - `merlin.ns.cloudflare.com`
- [ ] **Nameservers propagated** (agent verifies with `dig NS recifriend.com`)

**Story 01 rebrand progress (automated by agent, 2026-04-17):**
- [x] `apps/recipe-ui/.env.production` updated to `https://api.recifriend.com`
- [x] Worker deployed with `api.recifriend.com/*` route in `wrangler.toml`
- [x] All user-visible "ReciFind" copy replaced with "ReciFriend" in App.jsx, WelcomeModal, index.html, _middleware.js, index.ts (email templates)
- [x] Email sender updated to `hello@recifriend.com`
- [x] `privacy.html` created at `apps/recipe-ui/public/privacy.html`
- [ ] Cloudflare Pages custom domains `recifriend.com` + `www.recifriend.com` — see rebrand-checklist.md (needs Cloudflare API or dashboard after NS propagates)
- [ ] 301 redirect from `recifind.elisawidjaja.com` — needs elisawidjaja.com zone access (see rebrand-checklist.md)

---

### B3. Playwright MCP reconnection

**Priority:** 🟡 Medium — lets agent automate dashboard clicks (if working). Optional fallback: agent gives you exact click instructions.

**Steps:**
- [ ] In Claude Code, type `/mcp` and press Enter
- [ ] Find `playwright` in the MCP list
- [ ] If disconnected, click reconnect; if connected but tools not available, try restart
- [ ] If still not working: quit Claude Code (Cmd+Q) and reopen
- [ ] Return to this conversation

**Unlocks (when working):** agent-driven clicking through Cloudflare / Supabase / Google OAuth / Resend dashboards using your pre-authenticated browser session. Still requires you to log into each service manually the first time.

**Say to agent:** *"Playwright reconnected"* or *"can't get it working"* (fallback: you'll follow copy-paste click instructions).

- [ ] **Playwright MCP tools available to agent**
  - Agent verification: `ToolSearch query="playwright browser"` returns results.

---

## Section C — Background / Passive (🟢 no action)

### C1. iOS Simulator runtime download (~7GB, 10–20 min)

**Status:** RUNNING in background (started by agent; task ID `byeh98c54`)

**Agent verification when done:** `xcrun simctl list runtimes | grep iOS` shows iOS runtime.

**What it unlocks:** agent can boot iPhone simulators to run automated iOS builds + tests (Story 08, 09, 10, 11).

- [ ] **iOS Simulator runtime downloaded**
  - Agent: monitor task `byeh98c54` output; mark done when `xcrun simctl list runtimes` shows iOS entry.

---

## Section D — Optional (not blocking any story)

### D1. GitHub CLI authentication

- [ ] Run `gh auth login` in Terminal (browser-based flow, ~30 sec)
- [ ] Only needed if agent will create PRs or comment on issues via API

### D2. ios-deploy (real-device deploy from CLI)

- [ ] `brew install ios-deploy`
- [ ] Only needed if user wants agent to deploy builds directly to their phone via command line (normally Xcode GUI does this)

---

## Unblock Matrix — what each item lets the agent do

| Setup item | Stories unblocked |
|---|---|
| B1 Apple Dev submitted | (signals intent; no immediate unlock) |
| B1 Apple Dev approved | 05, 08, 09, 12 |
| B2 Cloudflare zone added | 01 (partial), 07, and the Resend domain verification in 01 |
| B2 Nameservers propagated | 01 (full) |
| B3 Playwright MCP | Speeds up 01 (dashboard clicks) — no hard unblock |
| C1 iOS Simulator runtime | Agent can test 08, 09, 10, 11 locally in simulator |

## Ready-to-proceed checkpoints

**Agent can start code-only stories RIGHT NOW** (no setup required):
- Story 02 — already done ✅
- Story 06 — implementer done, needs reviews ✅
- Story 04 (Friend Picker UI) — pure React, next candidate
- Story 03 (Share Backend) — pure Worker code
- Parts of Story 01 (string replacement, env files, privacy HTML, .gitignore) — pure code

**Agent waits on B1 approved** for: Story 05 APNs key, Story 08 signing, Story 09 Apple SSO config, Story 12 submission.

**Agent waits on B2 propagated** for: Story 01 domain deploy, Story 07 live AASA serving.

**Agent waits on C1** for: iOS simulator smoke tests (can still write + compile the code without it).
