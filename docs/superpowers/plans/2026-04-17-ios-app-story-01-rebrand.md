# Story 01 — Rebrand to ReciFriend

> Part of [iOS App + Rebrand workstream](./2026-04-17-ios-app-workstream.md)
> REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Flip the product identity from ReciFind to ReciFriend — new domain `recifriend.com` serves the PWA, old domain 301-redirects, emails send from new sender, all user-visible copy updated. Zero PWA regression.

**Depends on:** none (this is the sequential blocker for everything)
**Blocks:** all other stories
**Can develop in parallel with:** Story 02 can start when this is ~75% done (Story 02 only reads S05 constants)

**Contracts consumed:** none
**Contracts produced:** IOS constants implicitly (BUNDLE_ID, URL_SCHEME, ASSOCIATED_DOMAIN); these land in shared/contracts in Story 02

---

## Files

| Action | Path | Purpose |
|---|---|---|
| Modify | `apps/recipe-ui/.env.production` | Point API to `api.recifriend.com` |
| Modify | `apps/recipe-ui/.env.local` | Dev fallback still local |
| Modify | `apps/recipe-ui/src/App.jsx` | Replace "ReciFind" → "ReciFriend" in user-facing strings |
| Modify | `apps/recipe-ui/index.html` | `<title>`, meta description, OG tags |
| Modify | `apps/recipe-ui/functions/_middleware.js` | OG tag generation uses new brand |
| Modify | `apps/recipe-ui/public/favicon.ico` + related icons | New brand assets |
| Create | `apps/recipe-ui/public/og-image.png` | 1200×630 ReciFriend OG image |
| Create | `apps/recipe-ui/public/app-icon-1024.png` | 1024×1024 App Store icon, no alpha, no rounding |
| Create | `apps/recipe-ui/public/privacy.html` | Privacy policy page |
| Modify | `apps/worker/wrangler.toml` | New custom domain routes, variables |
| Modify | `apps/worker/src/index.ts` | Any hardcoded "ReciFind" strings in email templates / responses |
| Modify | `apps/worker/src/emails/*.ts` | Transactional email templates |
| Modify | `.gitignore` | Add `*.p8` to prevent APNs key leak |
| Create | `docs/runbooks/rebrand-checklist.md` | Reproducible rebrand steps (one-time, archived after) |

---

## Task 1: Baseline — find everything referencing the old name

- [ ] **Step 1:** Find all occurrences of "ReciFind" / "recifind" in code

```bash
cd /Users/elisa/Desktop/VibeCode
grep -rn -i "recifind" --include="*.{js,jsx,ts,tsx,html,json,toml,md}" \
  --exclude-dir=node_modules --exclude-dir=.worktrees \
  apps/ > /tmp/recifind-occurrences.txt
wc -l /tmp/recifind-occurrences.txt
```

- [ ] **Step 2:** Categorize — open `/tmp/recifind-occurrences.txt` and split into: (a) user-visible copy, (b) technical identifier (domain URL, package name), (c) internal comment. Only (a) and (b) change in this story; (c) stay until code they touch is edited naturally.

- [ ] **Step 3:** Commit checklist doc

```bash
mkdir -p docs/runbooks
cat > docs/runbooks/rebrand-checklist.md <<'EOF'
# ReciFind → ReciFriend rebrand — executed 2026-04-17
[will be filled as this story runs]
EOF
git add docs/runbooks/rebrand-checklist.md
git commit -m "docs: start rebrand runbook"
```

## Task 2: Cloudflare DNS + domain setup

These steps happen in the Cloudflare dashboard, not code. Record each one in the runbook as you go.

- [ ] **Step 1:** Add `recifriend.com` as a new zone in Cloudflare
- [ ] **Step 2:** Set NS records at the registrar to point to Cloudflare
- [ ] **Step 3:** Wait for NS propagation (`dig NS recifriend.com` shows Cloudflare NS)
- [ ] **Step 4:** Cloudflare Pages → recifind project → Custom domains → add `recifriend.com` and `www.recifriend.com`
- [ ] **Step 5:** Verify HTTPS cert issued (Cloudflare does this automatically; usually < 5 min)
- [ ] **Step 6:** Curl test — `curl -I https://recifriend.com` returns 200

Record in runbook.

## Task 3: Worker custom domain

- [ ] **Step 1:** Edit `apps/worker/wrangler.toml` — add route pattern

```toml
routes = [
  { pattern = "api.recifriend.com/*", zone_name = "recifriend.com" }
]
```

- [ ] **Step 2:** Deploy worker

```bash
cd apps/worker && npx wrangler deploy
```

- [ ] **Step 3:** Verify API reachable at new domain

```bash
curl -i https://api.recifriend.com/public/trending-recipes
# expected: 200 with JSON body
```

- [ ] **Step 4:** Commit

```bash
git add apps/worker/wrangler.toml
git commit -m "feat(worker): add api.recifriend.com custom domain route"
```

## Task 4: Environment variables + frontend API base URL

- [ ] **Step 1:** Edit `apps/recipe-ui/.env.production`

```
VITE_RECIPES_API_BASE_URL=https://api.recifriend.com
```

- [ ] **Step 2:** Edit `apps/recipe-ui/.env.local` — keep pointing at tunnel API host (unchanged)

- [ ] **Step 3:** Grep for any hardcoded `recifind.elisawidjaja.com` URLs

```bash
grep -rn "recifind.elisawidjaja.com" apps/recipe-ui/src/ apps/worker/src/
```

Fix each hit to either use env var or new domain.

- [ ] **Step 4:** Commit

```bash
git add apps/recipe-ui/.env.production
git commit -m "feat(ui): point production build at api.recifriend.com"
```

## Task 5: Supabase redirect URL + Google OAuth client

- [ ] **Step 1:** Supabase dashboard → Auth → URL Configuration → Redirect URLs → add:
  - `https://recifriend.com/**`
  - `https://www.recifriend.com/**`
  - Keep `https://recifind.elisawidjaja.com/**` temporarily (remove after 30 days).

- [ ] **Step 2:** Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client → Authorized redirect URIs → add:
  - `https://recifriend.com/auth/callback`
  - `https://www.recifriend.com/auth/callback`
  - Keep old URIs during transition.

- [ ] **Step 3:** Manual smoke: log in on `https://recifriend.com` with Google → must land back logged in.

Record both in runbook with screenshots.

## Task 6: 301 redirect from old domain

- [ ] **Step 1:** Cloudflare dashboard → recifind.elisawidjaja.com zone → Rules → Redirect Rules → create rule:
  - **When:** Hostname equals `recifind.elisawidjaja.com`
  - **Then:** Static redirect, 301, URL `https://recifriend.com${uri}` (preserves path + query)

- [ ] **Step 2:** Verify preserves path

```bash
curl -sI 'https://recifind.elisawidjaja.com/recipes/abc123?share=yes' | grep -i location
# expected: Location: https://recifriend.com/recipes/abc123?share=yes
```

- [ ] **Step 3:** Record in runbook. **Note:** keep this rule indefinitely — old shared recipe links must continue working.

## Task 7: Global brand string replacement

- [ ] **Step 1:** Write regression test first — screenshot existing production landing + save copies of key user-visible strings:

```bash
# capture a known-good snapshot of current (ReciFind) build's user strings
grep -n -i "recifind" apps/recipe-ui/src/App.jsx > /tmp/before-replace.txt
```

- [ ] **Step 2:** Replace in JSX — edit `apps/recipe-ui/src/App.jsx`, replacing user-visible strings only (not code identifiers, variable names, or comments):
  - "ReciFind" → "ReciFriend" in JSX text nodes
  - "recifind.elisawidjaja.com" → "recifriend.com" in any links

Use the Edit tool with explicit `old_string`/`new_string` for each occurrence (never a blind sed — too risky on mixed code/copy files).

- [ ] **Step 3:** Replace in `apps/recipe-ui/index.html`:

```html
<title>ReciFriend — Recipes worth sharing</title>
<meta name="description" content="Save recipes from anywhere. Share with your favorite people. ReciFriend." />
<meta property="og:title" content="ReciFriend" />
<meta property="og:site_name" content="ReciFriend" />
```

- [ ] **Step 4:** Replace in `apps/recipe-ui/functions/_middleware.js` (OG tag middleware):
  - Site name, default title, twitter:site (if set)

- [ ] **Step 5:** Replace in worker email templates (`apps/worker/src/emails/*`):
  - All "ReciFind" in visible email body → "ReciFriend"
  - Sender name in headers

- [ ] **Step 6:** Visual check — `cd apps/recipe-ui && npm run dev` → tunnel preview → click through landing, signup, home, recipe detail. Every surface should say ReciFriend.

- [ ] **Step 7:** Commit

```bash
git add apps/recipe-ui/ apps/worker/src/emails/
git commit -m "feat: rebrand user-visible copy to ReciFriend"
```

## Task 8: New brand assets

Designer's work, not engineer's — but the engineer integrates. If you don't have new assets yet, this task blocks until they exist.

- [ ] **Step 1:** Drop new `favicon.ico`, `favicon-32.png`, `favicon-192.png`, `apple-touch-icon.png` into `apps/recipe-ui/public/`
- [ ] **Step 2:** Drop `og-image.png` (1200×630) into `apps/recipe-ui/public/`
- [ ] **Step 3:** Drop `app-icon-1024.png` (1024×1024, no alpha, no rounding) — will be used by Story 08 + Story 12
- [ ] **Step 4:** Update `index.html` icon link tags if filenames changed
- [ ] **Step 5:** Commit

```bash
git add apps/recipe-ui/public/
git commit -m "feat(ui): add ReciFriend brand assets"
```

## Task 9: Resend sending domain + SPF/DKIM/DMARC

- [ ] **Step 1:** Resend dashboard → Domains → add `recifriend.com`
- [ ] **Step 2:** Copy the TXT records (SPF, DKIM) and the MX record (if any) into Cloudflare DNS for `recifriend.com`
- [ ] **Step 3:** Add DMARC record manually: `TXT _dmarc.recifriend.com → "v=DMARC1; p=quarantine; rua=mailto:hello@recifriend.com"`
- [ ] **Step 4:** Wait for Resend to show "verified" (usually 10–60 min, can be up to 24h)
- [ ] **Step 5:** Update worker — grep `from:.*recifind` in `apps/worker/src/emails/`, replace with `hello@recifriend.com`
- [ ] **Step 6:** Send test email to a personal Gmail + iCloud inbox — verify it lands in inbox, not spam, with correct sender name
- [ ] **Step 7:** Deploy worker

```bash
cd apps/worker && npx wrangler deploy
```

- [ ] **Step 8:** Commit

```bash
git add apps/worker/src/emails/
git commit -m "feat(emails): switch sender to hello@recifriend.com"
```

## Task 10: RLS audit (security)

Security spec §9.S6 — mandatory before iOS app ships (anon key is public in bundle).

- [ ] **Step 1:** In Supabase SQL editor, list all tables and their RLS status:

```sql
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public';
```

- [ ] **Step 2:** For every table where `rowsecurity = false`, either enable RLS + write a policy OR confirm the table is never accessed directly from the client (only via Worker with service role key).

- [ ] **Step 3:** For every table with RLS, list policies:

```sql
SELECT schemaname, tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public';
```

Review each policy — does it actually restrict access as expected? Common bug: `USING (true)` makes RLS useless.

- [ ] **Step 4:** Document findings in `docs/runbooks/rls-audit-2026-04-17.md`. If any gaps: file as high-priority follow-ups.

- [ ] **Step 5:** Commit

```bash
git add docs/runbooks/rls-audit-2026-04-17.md
git commit -m "docs: Supabase RLS audit before iOS app ships"
```

## Task 11: Add `*.p8` to gitignore (security)

Prevents accidental commit of APNs key in Story 05.

- [ ] **Step 1:** Edit `.gitignore`:

```
# Apple push notification keys — never commit
*.p8
```

- [ ] **Step 2:** Commit

```bash
git add .gitignore
git commit -m "chore: ignore .p8 files to prevent APNs key leak"
```

## Task 12: Privacy policy page

- [ ] **Step 1:** Create `apps/recipe-ui/public/privacy.html` with sections: (a) data collected, (b) third parties (Supabase, Cloudflare, Gemini, Resend, Apple APNs), (c) how data is used, (d) user rights (delete account, export), (e) contact email.
- [ ] **Step 2:** Accessible at `https://recifriend.com/privacy`
- [ ] **Step 3:** Add link in app footer (`App.jsx`)
- [ ] **Step 4:** Commit

```bash
git add apps/recipe-ui/public/privacy.html apps/recipe-ui/src/App.jsx
git commit -m "feat: add privacy policy page"
```

## Task 13: Deploy PWA + verify

- [ ] **Step 1:** Build + deploy

```bash
cd apps/recipe-ui && npm run build && npx wrangler pages deploy dist --project-name recifind
```

(Project name stays `recifind` — the Cloudflare Pages project name is internal. Only the domain changes.)

- [ ] **Step 2:** Run full E2E against prod

```bash
cd apps/e2e && BASE_URL=https://recifriend.com npm test
```

Expected: all green, same as before rebrand.

- [ ] **Step 3:** Acceptance gate G0 checklist below.

## Acceptance criteria (Gate G0)

- [ ] `https://recifriend.com` loads the PWA; sign in with Google + email works end-to-end
- [ ] `https://recifind.elisawidjaja.com/recipes/<any-existing-id>?foo=bar` 301-redirects to the same path+query on `recifriend.com`
- [ ] Friend-request email delivers from `hello@recifriend.com` with no spam flag in both Gmail and iCloud inboxes
- [ ] OG preview for a shared recipe URL renders on iMessage and Slack with new branding
- [ ] Full E2E suite (`apps/e2e`) green against `https://recifriend.com`
- [ ] Supabase RLS audit doc committed
- [ ] `.gitignore` blocks `*.p8`

## Commit checklist

All commits from this story should land on `main` with messages starting `feat:`, `chore:`, `docs:`, or `fix:`. If any step fails acceptance, roll back with `git revert` (never `reset --hard`).
