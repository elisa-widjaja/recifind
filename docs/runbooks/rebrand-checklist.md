# ReciFind → ReciFriend Rebrand Checklist

**Executed:** 2026-04-17
**Story:** [ios-app-story-01-rebrand](../superpowers/plans/2026-04-17-ios-app-story-01-rebrand.md)

---

## Automated (completed by agent)

- [x] **Env file** — `apps/recipe-ui/.env.production` now points `VITE_RECIPES_API_BASE_URL` at `https://api.recifriend.com`
- [x] **Worker custom domain** — `routes = [{ pattern = "api.recifriend.com/*", zone_name = "recifriend.com" }]` added to `apps/worker/wrangler.toml` and deployed. Worker also serves `api.recifriend.com` once DNS propagates.
- [x] **Brand string replacement** — all user-visible "ReciFind" strings updated to "ReciFriend" in:
  - `apps/recipe-ui/index.html` (`<title>`, apple-mobile-web-app-title)
  - `apps/recipe-ui/functions/_middleware.js` (OG tags, fallback API URL)
  - `apps/recipe-ui/src/App.jsx` (nav bar, invite messages, share text, snackbar copy)
  - `apps/recipe-ui/src/components/WelcomeModal.jsx` (welcome heading, CTA button)
  - `apps/worker/src/index.ts` (all email templates: invite, friend request, accepted, nudge; sender address; unsubscribe page; feedback subject)
- [x] **Email sender** — `from:` updated to `ReciFriend <hello@recifriend.com>` in `sendEmailNotification()`
- [x] **All old-domain links in emails** — `recifind.elisawidjaja.com` links updated to `recifriend.com` in all email HTML templates
- [x] **Privacy policy** — `apps/recipe-ui/public/privacy.html` created; accessible at `https://recifriend.com/privacy.html`

---

## User must complete (manual steps)

### 1. Nameserver update at registrar (BLOCKING — everything else waits on this)

Update NS records at your domain registrar for `recifriend.com` to:
- `jade.ns.cloudflare.com`
- `merlin.ns.cloudflare.com`

Verify propagation: `dig NS recifriend.com` should return Cloudflare nameservers.

### 2. Cloudflare Pages custom domains

Once DNS is active, add the custom domains to the Pages project. Either:

**Option A — Dashboard:**
1. Go to https://dash.cloudflare.com → Workers & Pages → `recifind` project
2. Custom domains → Add custom domain → `recifriend.com`
3. Repeat for `www.recifriend.com`
4. Cloudflare auto-creates the DNS records and issues TLS certs.

**Option B — API (run after NS propagates):**
```bash
TOKEN=$(cat ~/.config/recifriend-cf-token)
ACCOUNT=c87bb35d82b7856f12f8f0c866776a88

for DOMAIN in recifriend.com www.recifriend.com; do
  curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    --data "{\"name\":\"$DOMAIN\"}" \
    "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/pages/projects/recifind/domains" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print('$DOMAIN:', 'OK' if d.get('success') else [e.get('message') for e in d.get('errors',[])])"
done
```

Verify: `curl -I https://recifriend.com` returns 200.

### 3. 301 redirect from old domain (`recifind.elisawidjaja.com`)

The old domain's zone is on `elisawidjaja.com` which requires a different Cloudflare account / zone access. Steps via dashboard:

1. Log into Cloudflare → select the `elisawidjaja.com` zone
2. Rules → Redirect Rules → Create rule
3. Settings:
   - **Rule name:** Redirect recifind subdomain to recifriend.com
   - **When:** Custom filter expression → `(http.host eq "recifind.elisawidjaja.com")`
   - **Then:** Static redirect → 301 → `https://recifriend.com${http.request.uri}`
4. Save and deploy

Verify path preservation:
```bash
curl -sI 'https://recifind.elisawidjaja.com/recipes/abc123?share=yes' | grep -i location
# expected: Location: https://recifriend.com/recipes/abc123?share=yes
```

Keep this rule indefinitely — old shared links must keep working.

### 4. Supabase OAuth redirect URLs

Supabase Dashboard → Authentication → URL Configuration → Redirect URLs → add:
- `https://recifriend.com/**`
- `https://www.recifriend.com/**`

Keep `https://recifind.elisawidjaja.com/**` for 30 days (remove 2026-05-17).

### 5. Google OAuth authorized redirect URIs

Google Cloud Console → APIs & Services → Credentials → your OAuth 2.0 client → Authorized redirect URIs → add:
- `https://recifriend.com/auth/callback`
- `https://www.recifriend.com/auth/callback`

Keep old URIs during transition.

### 6. Resend sending domain

Resend Dashboard → Domains → Add Domain → `recifriend.com`

Copy the DNS records Resend provides (SPF TXT, DKIM CNAME x2) into Cloudflare DNS for `recifriend.com`.

Also add DMARC:
- Type: TXT
- Name: `_dmarc`
- Value: `v=DMARC1; p=quarantine; rua=mailto:hello@recifriend.com`

Wait for Resend to show "Verified" (10 min – 24h). Then send a test email to verify deliverability.

### 7. Deploy the PWA to production

After all domain/OAuth steps are confirmed:

```bash
cd apps/recipe-ui && npm run build && npx wrangler pages deploy dist --project-name recifind
```

Verify: `curl -s https://recifriend.com | grep -i "ReciFriend" | head -3`

### 8. Designer assets (when ready)

Drop into `apps/recipe-ui/public/`:
- `favicon.ico`, `icon-192.png`, `apple-touch-icon.png` — new ReciFriend brand
- `og-image.png` — 1200×630 OG image
- `app-icon-1024.png` — 1024×1024 App Store icon (no alpha, no rounding)

Then redeploy with `npm run build && npx wrangler pages deploy dist --project-name recifind`.

---

## Acceptance gate (Gate G0)

- [ ] `https://recifriend.com` loads the PWA and shows "ReciFriend" branding
- [ ] `https://recifind.elisawidjaja.com/recipes/<id>?foo=bar` 301-redirects to same path+query on `recifriend.com`
- [ ] Friend-request email delivers from `hello@recifriend.com` (no spam, correct sender name)
- [ ] OG preview for shared recipe shows ReciFriend branding on iMessage/Slack
- [ ] Google Sign-In works end-to-end on `https://recifriend.com`
