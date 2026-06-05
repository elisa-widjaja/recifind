# ReciFind Project Memory

## Deployment
- **Production site**: Cloudflare Pages (NOT Vercel), project name `recifind`
- **Domain**: recifind.elisawidjaja.com
- **Deploy command** (run from project root `/Users/elisa/Desktop/VibeCode`):
  ```bash
  cd apps/recipe-ui && npm run build && cd ../.. && npx wrangler pages deploy apps/recipe-ui/dist --project-name recifind
  ```
- Git pushes do NOT auto-deploy — must deploy manually with wrangler
- Vercel is configured but NOT serving prod

## Stack
- Frontend: React + Vite + MUI, in `apps/recipe-ui/`
- Backend: Cloudflare Worker (`apps/worker/src/index.ts`), deployed via `wrangler deploy`
- Database: Cloudflare D1 (`recipes-db`)
- Auth: Supabase JWT
- OG tags middleware: `apps/recipe-ui/functions/_middleware.js` (Cloudflare Pages Functions, untracked in git)

## Key files
- `apps/recipe-ui/src/App.jsx` — entire frontend (single large file)
- `apps/worker/src/index.ts` — all API routes
- `apps/worker/wrangler.toml` — worker config, D1 binding, env vars

## Mobile preview (phone testing without deploying)
1. Set `allowedHosts: true` in `apps/recipe-ui/vite.config.js` (not `'all'`, must be boolean `true`)
2. Start Vite: `cd apps/recipe-ui && npm run dev -- --host`
3. Start tunnel: `cloudflared tunnel --url http://localhost:5173` (install via `brew install cloudflared`)
4. Open the `https://xxxx.trycloudflare.com` URL on your phone
5. For Google login to work: add the tunnel URL (`https://xxxx.trycloudflare.com/**`) to Supabase → Auth → URL Configuration → Redirect URLs (remove when done — URL changes every session)

## Product Strategy & Growth

### Target user
Home cooks sharing with family and friends — not influencers. Positioning: "group chat for cooking."

### Platform decision
Build viral features in PWA first. iOS only after strong D7 retention (>20%). Native is a retention play, not acquisition.

### Viral growth priority (in order)
1. Live discovery feed on landing page (logged-out users see real recipes from real users, not static)
2. "Save this" CTA on every recipe card → triggers signup
3. Invite-first onboarding step (immediately after OAuth, before empty state)
4. Notification: "X saved your recipe" (ego loop, brings users back)
5. Friend activity feed in app (daily retention)

### Landing page (current state)
- Logged-out visitors already see a list of static recipes — good foundation
- Recipes are public by default, users can opt out
- Goal: make it feel alive with real user activity

### Primary conversion goal
New user invites a friend within 60 seconds of landing.

### Invite → signup → warm onboarding flow (to build)
1. Sarah gets invited by Elisa, clicks email link
2. Sarah signs up with Google
3. Welcome screen: "Elisa invited you" + preview of Elisa's public recipes
4. "Elisa's friends are also on ReciFind" → 2-3 friend suggestions (friend-of-friend)
5. Sarah lands on home feed pre-filled with Elisa's recipes (no cold start)

### Email matching mechanic
- On signup, check if new user's email has any pending friend invites → auto-connect
- The `accept_friend` URL param flow already exists — just needs warm UI on first load
- Friend-of-friend suggestions: query friends of my friends who aren't my friends yet
- Google Contacts import: skip for now (complex, privacy-sensitive)

### What NOT to build yet
- Google Contacts import
- iOS app (until PWA retention is proven)
- Influencer/audience features

## Worker gotcha
- All route handlers must use `return await handler()` inside async try/catch
- `return handler()` without `await` causes unhandled Promise rejections that bypass the catch block → Cloudflare 1101 errors with no CORS headers
