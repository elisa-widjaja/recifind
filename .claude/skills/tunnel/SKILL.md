---
name: tunnel
description: Start a cloudflared tunnel to expose the local ReciFind dev server to the internet and get a public HTTPS URL for mobile testing. Use this skill whenever the user wants a tunnel URL, wants to test on their phone, wants a public URL for the local dev server, or mentions cloudflared, ngrok, or mobile preview.
---

Start the Vite dev server (if not running) and spin up the named Cloudflare tunnel. The URL is always **https://dev-recifind.elisawidjaja.com** — no Supabase update needed.

## Steps

1. **Check if Vite is running on port 5173**
   ```bash
   lsof -i :5173 | grep LISTEN
   ```
   If nothing is listening, start it in the background:
   ```bash
   cd /Users/elisa/Desktop/VibeCode/apps/recipe-ui && npm run dev -- --host > /tmp/vite-dev.log 2>&1 &
   sleep 3
   ```

2. **Check if the worker is running on port 8787**
   ```bash
   lsof -i :8787 | grep LISTEN
   ```
   If nothing is listening, start it in the background (use `--remote` so it connects to real D1/KV):
   ```bash
   cd /Users/elisa/Desktop/VibeCode/apps/worker && npx wrangler dev --port 8787 --remote > /tmp/worker-dev.log 2>&1 &
   sleep 8
   ```
   Verify it started:
   ```bash
   lsof -i :8787 | grep LISTEN
   ```

3. **Kill any existing cloudflared tunnel** to avoid stale processes:
   ```bash
   pkill -f "cloudflared tunnel" 2>/dev/null
   ```

4. **Start the named tunnel** in the background:
   ```bash
   cloudflared tunnel run recifind-dev > /tmp/cf-tunnel.log 2>&1 &
   ```

5. **Wait and verify it connected**:
   ```bash
   sleep 5 && grep "Registered tunnel connection" /tmp/cf-tunnel.log | tail -1
   ```

6. **Report to the user**:
   - Local URL: `http://localhost:5173`
   - Tunnel URL: `https://dev-recifind.elisawidjaja.com` (permanent — no Supabase update needed)

---

## Adding a new redirect URL to Supabase

Credentials are in `~/.recifind/supabase.env`. Source and use the Management API:

```bash
source ~/.recifind/supabase.env

# Get current allow list
curl -s "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_PAT" \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('uri_allow_list',''))"

# Update allow list (set uri_allow_list to the full comma-separated string including the new URL)
curl -s -X PATCH "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_PAT" \
  -H "Content-Type: application/json" \
  -d "{\"uri_allow_list\": \"EXISTING_LIST,NEW_URL\"}"
```
