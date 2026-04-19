# Apple Sign In — Client Secret JWT Rotation

The Supabase Apple provider's "Secret Key" field is a JWT signed with your `.p8` key. **Apple caps this JWT's lifetime at 6 months.** After expiry, Apple Sign In fails server-side for all users.

## Identifiers

- **Key ID:** `3GFUUUG72T`
- **Team ID:** `7C6PMUN99K`
- **Services ID (aud sub):** `com.recifriend.auth`
- **`.p8` file location:** `~/.config/recifriend-apple-sso.p8` (600 perms, outside repo)

## Regeneration procedure

On your Mac (requires the .p8 file from step 7 of the original Apple Sign In setup):

```bash
# 1. Generate a fresh JWT and copy to clipboard
node -e '
import("jose").then(async ({SignJWT, importPKCS8}) => {
  const fs = require("fs");
  const p8 = fs.readFileSync(process.env.HOME + "/.config/recifriend-apple-sso.p8", "utf8");
  const key = await importPKCS8(p8, "ES256");
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: "3GFUUUG72T" })
    .setIssuedAt(now)
    .setExpirationTime(now + 6 * 30 * 24 * 60 * 60)
    .setIssuer("7C6PMUN99K")
    .setAudience("https://appleid.apple.com")
    .setSubject("com.recifriend.auth")
    .sign(key);
  process.stdout.write(jwt);
});
' | pbcopy

# Run from apps/worker or any dir with jose installed (or `npm i jose` in /tmp first)
```

2. Open https://supabase.com/dashboard/project/jpjuaaxwfpemecbwwthk/auth/providers
3. Find **Apple** provider → **Secret Key (for OAuth)** field → clear it → ⌘V to paste the new JWT → **Save**
4. Test in the iOS app: tap **Continue with Apple** → should succeed

## If you lost the .p8 file

- https://developer.apple.com/account/resources/authkeys/list → revoke the existing `ReciFriend Apple SSO` key
- Create a new Sign In with Apple key → **download the .p8** (one-time) → move to `~/.config/recifriend-apple-sso.p8`
- Update the Key ID in this runbook + the trigger prompt

## Schedule

- Current JWT issued: 2026-04-19
- Expires: ~2026-10-12
- Rotation reminder: fires Apr 5 + Oct 5 yearly via claude.ai scheduled trigger (`https://claude.ai/code/scheduled/{trigger_id}`)
