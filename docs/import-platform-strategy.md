# Recipe import: per-platform strategy

How each source platform is parsed, where title/image/content come from, the
fallback chain, and known ceilings. The deterministic regression suite
(`apps/worker/src/import-fixtures.test.ts` + iOS `ShareExtensionTests`) pins
this behavior.

| Platform | Title / Image | Content (ingredients/steps) | Fetched where | Fallback chain | Known ceiling |
|---|---|---|---|---|---|
| Recipe blogs (AllRecipes, NYT Cooking, Fresh Off The Grid, Google Docs) | og/twitter meta | JSON-LD (`recipeIngredient`/`recipeInstructions`) via `extractRecipeDetailsFromHtml` | Worker | `structuredHtml` → `textInference` → title-only | reliable |
| Instagram | og:description caption → `extractInstagramRecipeTitle`; device fallback | caption → Gemini (`captionExtract`) | Worker (caption); device (title/image fallback) | `captionExtract` → `textInference` → title-only | datacenter rate-limiting; caption-less → title-only |
| TikTok | og caption → `extractTikTokRecipeTitle`; device fallback | caption → Gemini | Worker (caption); device fallback | `captionExtract` → `textInference` → title-only | caption-less → title-only |
| YouTube | og meta | Gemini video understanding (`youtubeVideo`) | Worker (Gemini reads the video URL) | `youtubeVideo` → `textInference` → title-only | non-cooking → title-only |
| Facebook | device caption → dish-name extract; `og:image` entity-decoded | device full caption → Gemini, only when provided | Device (residential IP); worker login-walled | device caption → Gemini → title-only / "Facebook Reel" placeholder | login-wall/rate-limit inconsistency; recipe-in-video (no caption) → title-only |
| Pinterest | pin's `og:title` / `og:image` | best-effort from the pin's OWN description text only | Worker (parses the **pin page**; does NOT follow the pin's outbound link to the source site) | `structuredHtml` (usually empty — pins rarely carry recipe JSON-LD) → `textInference` → title-only | **shallow + UNTESTED**: never reaches the linked recipe site, so usually title+image only; `pin.it` short links error (not allowlisted, not resolved) |

## Cross-cutting invariants
- `isAllowedSourceHost` gates `/recipes/parse`, `/recipes/enrich`, `/recipes` create.
- `isFacebookLinkShim` blocks the `facebook.com/l.php?u=` open redirector.
- `og:image` is re-hosted to Supabase (`recipe-previews`).
- Preview precedence: device-first for Facebook (worker login-walled), worker-first for all other platforms.
- Facebook content is title-only unless the iOS Share Extension supplies a full caption (device residential fetch).

## Known gaps / follow-ups

- **Pinterest is shallow and untested.** Importing a `pinterest.com/pin/...` URL passes the allowlist and parses the *pin page itself* — the worker never follows the pin's outbound link to the underlying recipe site (`resolveSourceUrl` only expands `vm.tiktok.com`/`youtu.be`/`fb.watch`/`tiktok.com/t/`/`facebook.com/share/`). So a pin that links out to a recipe blog typically yields only title + image. A non-whitelisted source *behind* a pin never triggers the unsupported-source error (the worker stops at Pinterest); the error only fires if the user pastes that external URL directly, or a `pin.it` short link (not allowlisted/resolved). Options if we invest: (a) resolve pins to their source URL + allowlist source-following, (b) support `pin.it`, or (c) drop Pinterest from the allowlist + message if it underdelivers.
