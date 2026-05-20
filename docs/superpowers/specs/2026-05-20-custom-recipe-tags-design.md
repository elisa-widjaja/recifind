# Custom Recipe Tags — Design

**Date:** 2026-05-20
**Status:** Design complete, awaiting implementation plan

## Summary

Add a per-recipe `customTags` field so users can organize their recipes with free-form personal tags (e.g. `backpacking`, `meal prep`, `toddler meals`, `dog food`). Users add and edit tags in the recipe-detail dialog's edit mode. Users find recipes by tag via the existing Recipes-page filter drawer and the search bar.

Tags are entirely user-authored — no Gemini involvement, no auto-suggestion from imports, no AI tag generation. Autocomplete in the tag input is driven exclusively by the user's own previously-created tags.

## Non-goals (v1)

- Gemini auto-suggesting tags from captions, JSON-LD, or any other source.
- Server-side tag search/index (we filter client-side from already-loaded recipes — same as cuisine filter today).
- Tag-renaming UX ("rename all 'meal prep' to 'meal-prep' across my recipes").
- Tag-merge UX.
- Recipient-side tag-strip on shared recipes.
- Discovery-feed tag chips on PublicLanding / FriendSections.
- Admin-UI tag management.
- Migration of old emoji-prefixed cuisine prefs (unrelated concern, tracked separately).

## Data model

### Storage

Per-recipe tags — tags travel with the recipe when shared/saved, mirroring how `meal_types` and `cuisines` already work. This was chosen over a per-user tags table because:

1. Examples given (`backpacking`, `meal prep`, `dog food`, `toddler meals`) feel like personal-but-not-secret organizational hints, comparable to existing per-recipe taxonomy fields.
2. The implementation parallels `meal_types` and `cuisines`: one column, JSON array of strings, sanitize on POST/PATCH.
3. Client-side filter logic uses the already-loaded `recipes` array — no joins, no extra queries.

### Schema migration

Add a single column to `recipes`:

```sql
ALTER TABLE recipes ADD COLUMN custom_tags TEXT DEFAULT '[]';
```

D1's `ALTER TABLE ADD COLUMN` is online and instant; no table rewrite. Existing rows return the default `'[]'` when read. Old worker code reading the table before the new code deploys keeps working (it simply doesn't reference the new column).

### Tag value semantics

- **Stored verbatim** as the user typed them (preserves original casing for display, e.g. `"Meal Prep"`).
- **Trimmed** of leading/trailing whitespace.
- **Case-insensitive dedupe within a single recipe** — if a user enters both `"meal prep"` and `"Meal Prep"`, only the first instance is kept.
- **Cross-recipe casing convergence**: the autocomplete dropdown surfaces existing tags; once the user picks one from the dropdown, that casing is reused. Two recipes typed independently can drift in casing, but the filter logic is case-insensitive so they still group together.
- **Empty strings** are dropped silently.

### Limits

- Max **5 tags per recipe** (silent slice if the request body contains more — keeps the UI focused on a small set of meaningful organizational tags rather than free-form notes).
- Max **30 chars per tag** (silent truncation if longer).
- Client-side validation matches: input is blocked beyond 30 chars; adding is disabled once 5 tags are present.

## Worker API & validation

### `Recipe` interface

Add `customTags: string[]` alongside existing fields.

### `normalizeRecipePayload` (`apps/worker/src/index.ts`)

Adds a new helper:

```ts
function sanitizeCustomTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seenLower = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().slice(0, 30);
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (seenLower.has(lower)) continue;
    seenLower.add(lower);
    out.push(trimmed);
    if (out.length >= 5) break;
  }
  return out;
}
```

Wired into `normalizeRecipePayload` so `customTags` is sanitized on every POST/PATCH.

### SELECT projections

Every existing SELECT that returns a recipe row gains `custom_tags` in its column list. The Recipe-to-JSON mapping deserializes via `JSON.parse(custom_tags || '[]')`, defaulting to `[]` for old rows.

### INSERT/UPDATE column lists

`handleCreateRecipe` and `handleUpdateRecipe` include `custom_tags` in their column lists, value provided via `JSON.stringify(recipe.customTags)`.

### Endpoints — what's untouched

- **`/recipes/parse`** — unchanged. Cache key + cached payload shape unchanged.
- **`/recipes/enrich`** — unchanged. Returned `enriched` object does not include `customTags`.
- **`captionExtract`, `fetchOembedCaption`, `runEnrichmentChain`, `textInference`, `youtubeVideo`, `buildExtractOnlyPrompt`, all other Gemini prompts** — untouched. The JSON schema Gemini is asked to return is unchanged.
- **No new endpoints.** The client passes `customTags` in the regular POST/PATCH recipe body. No tag-CRUD endpoint, no tag-list endpoint — the client derives the user's distinct tag set from `recipes` already in state.

This guarantee is critical for the recipe-import-flow guardrail (`feedback_protect_import_flow.md`): we are not touching any code path that today's 100%-failure outage was rooted in.

## Frontend UX

### Recipe detail — edit mode

In `apps/recipe-ui/src/App.jsx`, immediately below the existing "Cuisines" chip block, above "Notes":

```jsx
<Box sx={{ pb: isEditMode ? 3 : 0 }}>
  <Divider sx={...} />
  <Typography variant="subtitle2" sx={...}>Tags</Typography>
  <Autocomplete
    multiple
    freeSolo
    options={availableTags}                  // computed via useMemo from recipes state
    value={activeRecipeDraft.customTags ?? []}
    onChange={(_, newTags) => setActiveRecipeDraft(prev => ({ ...prev, customTags: newTags }))}
    renderTags={(tags, getTagProps) => tags.map((t, i) => <Chip key={t} label={t} {...getTagProps({ index: i })} />)}
    renderInput={(params) => <TextField {...params} placeholder="Add a tag..." />}
  />
</Box>
```

`availableTags` is computed once per render via `useMemo`:

```js
const availableTags = useMemo(() => {
  const all = recipes.flatMap(r => r.customTags || []);
  const seenLower = new Set();
  const out = [];
  for (const tag of all) {
    const lower = tag.toLowerCase();
    if (seenLower.has(lower)) continue;
    seenLower.add(lower);
    out.push(tag);
  }
  return out.sort((a, b) => a.localeCompare(b));
}, [recipes]);
```

Save happens through the existing PATCH `/recipes/:id` flow — `customTags` rides along in the standard `buildApiRecipePayload` output. No new save path.

Client-side validation:
- **30-char cap**: enforced via the `<TextField>` `inputProps={{ maxLength: 30 }}`. The browser-native length cap prevents typing past 30 chars without any keystroke interception. The worker-side `sanitizeCustomTags` truncation is the durable safety net.
- **5-tag cap**: enforced in `onChange` — if `newTags.length > 5`, ignore the change. The input field itself is also disabled (`disabled={value.length >= 5}`) so the user sees a clear stop. The worker-side cap is again the safety net.

### Recipe detail — view mode

Section **hidden entirely** when `customTags` is empty (matches the existing Cuisines view-mode behavior — no header, no empty placeholder).

When non-empty: renders plain MUI `<Chip>` elements, no icons, no click handlers — purely informational.

### Recipes-page filter drawer (`RecipesPage.jsx`)

New "Tags" section below Cuisines:

- Lists all distinct user tags (computed the same way as `availableTags` above) as selectable chips.
- Multi-select; tapping toggles inclusion.
- Empty state: section hidden entirely when the user has no tagged recipes (mirroring existing Cuisines section behavior).
- Selected tags filter the recipe grid to recipes containing **any** of the selected tags (OR logic — consistent with how meal-type filter works today).

### Search bar

Extends the existing title/ingredient match in `App.jsx`'s search-filter `useMemo`:

```js
recipe.title.toLowerCase().includes(q) ||
recipe.ingredients.some(i => i.toLowerCase().includes(q)) ||
(recipe.customTags || []).some(t => t.toLowerCase().includes(q))
```

### JSON import (`validateRecipesPayload`)

The bulk-import normalizer accepts `customTags` as an optional field, defaults to `[]` when missing.

## Edge cases

| Case | Behavior |
|---|---|
| Old recipe loaded after deploy | `customTags: []` (worker normalizes `null` → `[]`). |
| Friend saves your recipe | Your `customTags` array copies into their owned copy. They can freely edit. |
| Last recipe with a given tag deleted | Tag disappears from autocomplete (it's computed from in-state recipes). No separate "delete tag" affordance needed. |
| Public-discover / friend-activity surfaces | `customTags` included in the JSON shape but no UI renders them — tags only show in the recipe-detail dialog and filter drawer. |
| Hidden / soft-deleted recipe | No change — tags vanish with the recipe row. |
| Mass-import via JSON | `customTags` optional, defaults to `[]`. |
| Recipe with 6+ tags in request body | Silent slice to 5. |
| Recipe with a 35-char tag | Silent truncation to 30 chars. |
| Tag containing only whitespace | Dropped. |
| Non-string array element | Dropped. |

## Testing

### Worker

`apps/worker/src/create-recipe.test.ts` adds cases for the `sanitizeCustomTags` round-trip:

- 6+ tags → exactly 5 retained
- 35-char tag → truncated to 30 chars
- `["meal prep", "Meal Prep"]` → one tag retained, original casing preserved
- `["  ", "valid"]` → empty/whitespace dropped, valid kept
- `[123, "valid", null]` → only valid string kept
- Round-trip via POST + GET preserves the sanitized array

### Frontend

No new test file required (the existing test surface in `apps/recipe-ui/src/` doesn't cover recipe-detail editing). Manual smoke test on dev tunnel + Xcode iOS local build covers:

- Adding a tag in edit mode, saving, reload, tag still there.
- Adding a tag that already exists (case-insensitive variant) is collapsed.
- 6th tag rejected.
- 31st character of a tag rejected.
- Filter drawer shows tags after creating them; hidden when none.
- Search bar matches tag text.

### Smoke-test pre-deploy (per `feedback_protect_import_flow.md`)

Required before *both* dev deploy and prod deploy:

- `POST /recipes/parse` AllRecipes URL → ingredients + steps + title + imageUrl populated.
- `POST /recipes/enrich` Instagram + TikTok + YouTube URLs → ingredients/steps populated (or empty if blocked, but the call must complete < 4s).
- Latency under 4s for enrich calls.

## Deploy plan

The user has TestFlight Build 17 in Apple App Store review (per `project_testflight_current.md`). To avoid shipping a regression during the review window:

1. Apply the D1 schema migration to `recipes-db`:
   ```bash
   cd apps/worker && npx wrangler d1 execute recipes-db --remote \
     --command "ALTER TABLE recipes ADD COLUMN custom_tags TEXT DEFAULT '[]'"
   ```
   Safe because old workers don't reference the column; new rows get the default.
2. Deploy **only the dev worker**: `cd apps/worker && npx wrangler deploy --env dev` → `api-dev.recifriend.com`.
3. **Skip** prod worker deploy (`npx wrangler deploy`).
4. **Skip** Pages deploy.
5. User tests on `dev.recifriend.com` (web tunnel) + Xcode local iOS build pointed at the dev tunnel.
6. Only after explicit user approval → deploy prod worker (`npx wrangler deploy`) and Pages (`npx wrangler pages deploy dist --project-name recifind`).

If anything regresses in dev testing, the prod worker stays untouched and the Build-17-in-review app continues to work against the existing prod worker.

## Decisions confirmed

- **Per-recipe data model** (option A). Per-user model rejected — too complex, not justified by the examples given.
- **Filter drawer chip section + search bar match** (option C). Both discoverability and quick lookup.
- **MUI Autocomplete with `multiple + freeSolo`, suggestions from user's own recipes** (option A). No AI suggestions.
- **5 tags per recipe** max, 30 chars per tag, silent truncation/slice.
- **Tags hidden in view mode when empty**, always shown in edit mode.
- **Gemini, /parse, /enrich entirely untouched.**
- **Dev-first deploy** with user-gated promotion to prod, because of App Store review window.
