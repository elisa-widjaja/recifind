# ReciFind

Recipe-sharing app. Frontend is JavaScript (React + Vite + MUI), backend is TypeScript (Cloudflare Workers).

## Deployment

- **Production**: Cloudflare Pages — NOT Vercel. Project name: `recifind`
- **Domain**: recifind.elisawidjaja.com
- **Frontend deploy** (from project root): `cd apps/recipe-ui && npm run build && cd ../.. && npx wrangler pages deploy apps/recipe-ui/dist --project-name recifind`
- **Worker deploy**: `cd apps/worker && npx wrangler deploy`
- Git pushes do NOT auto-deploy — always deploy manually with wrangler

## Cloudflare D1 (Free Tier)

- Database: `recipes-db`
- Prefer key-prefix patterns over `list()` operations — free tier has 1,000 list ops/day
- Before deploying data-layer changes, estimate KV/D1 operation counts and warn if near quota limits

## Worker Rules

- All route handlers must use `return await handler()` inside async try/catch
- `return handler()` without `await` causes unhandled Promise rejections → Cloudflare 1101 errors with no CORS headers

## Auth Flows

- Never rely on sessionStorage/localStorage to persist state across OAuth redirects
- Use URL parameters, server-side state, or cookies instead

## External Services

- **Supabase** — auth (JWT), user accounts, storage (`recipe-previews` bucket)
  - Project ref: `jpjuaaxwfpemecbwwthk`
  - Google OAuth configured for login
- **Cloudflare D1** — recipe database (`recipes-db`)
- **Gemini** — used via service account for recipe processing
- **Resend** — transactional emails (friend request notifications)

## Credentials & Env Vars

### Frontend (`apps/recipe-ui/`)
- `.env.local` — local dev (points API to `localhost:8787`, uses service role key)
- `.env.production` — prod (points API to worker URL, uses anon key)
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_RECIPES_API_BASE_URL`

### Worker (`apps/worker/`)
- Public vars in `wrangler.toml`: `AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_JWKS_URL`, `SUPABASE_URL`, `SUPABASE_STORAGE_BUCKET`
- Secrets (set via `wrangler secret put`, never in code):
  - `DEV_API_KEY` — dev/testing bypass auth
  - `SUPABASE_SERVICE_ROLE_KEY` — server-side Supabase operations
  - `GEMINI_SERVICE_ACCOUNT_B64` — Gemini API access

## Tooling

- **wrangler** — Cloudflare CLI for deploying Workers, Pages, and managing D1/KV
- **vite** — frontend build/dev server
- **vitest** — worker tests (`cd apps/worker && npm test`)
- **playwright** — browser testing (MCP server configured in `.claude/settings.json`)

## Key Files

- `apps/recipe-ui/src/App.jsx` — entire frontend
- `apps/worker/src/index.ts` — all API routes
- `apps/worker/wrangler.toml` — worker config, D1 binding, env vars
