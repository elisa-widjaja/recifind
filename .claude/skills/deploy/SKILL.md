---
name: deploy
description: Build and deploy ReciFind to Cloudflare Pages and/or Workers, then verify the live site is working.
argument-hint: [frontend|worker|both]
allowed-tools: Bash
---

Build and deploy ReciFind to production on Cloudflare, then verify.

**Production domain**: recifind.elisawidjaja.com
**Worker API**: recipes-worker.elisa-widjaja.workers.dev
**Platform**: Cloudflare Pages + Workers (NEVER Vercel)

## Steps

1. Parse `$ARGUMENTS` to determine what to deploy:
   - `frontend` → Pages app only
   - `worker` → Worker only
   - `both` or no argument → deploy both

2. **Frontend deploy** (when applicable):
   Run from the project root:
   ```bash
   cd apps/recipe-ui && npm run build && cd ../.. && npx wrangler pages deploy apps/recipe-ui/dist --project-name recifind
   ```
   If the build fails, stop and show the error — do not deploy.

3. **Worker deploy** (when applicable):
   ```bash
   cd apps/worker && npx wrangler deploy
   ```

4. **Post-deploy verification** — run these checks and report pass/fail for each:

   a. Frontend loads:
   ```bash
   curl -s -o /dev/null -w "%{http_code}" https://recifind.elisawidjaja.com
   ```
   Expected: `200`

   b. API returns recipes with CORS headers:
   ```bash
   curl -s -D - -o /dev/null https://recipes-worker.elisa-widjaja.workers.dev/recipes 2>&1 | head -20
   ```
   Expected: `200` status + `access-control-allow-origin` header present

   c. SSL certificate is valid:
   ```bash
   curl -s -o /dev/null -w "%{ssl_verify_result}" https://recifind.elisawidjaja.com
   ```
   Expected: `0` (success)

5. **Report** — summarize:
   - What was deployed (frontend, worker, or both)
   - Wrangler deployment URLs from the output
   - Verification results (pass/fail for each check)
   - Any warnings or errors encountered
