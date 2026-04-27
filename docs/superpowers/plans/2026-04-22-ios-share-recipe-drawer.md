# iOS Share-Extension Add Recipe Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the iOS Share Extension launches the app via `recifriend://add-recipe?url=...`, show a minimal Add Recipe drawer with a square thumbnail + plain-text title (editable via inline link) instead of the current form with URL + title text fields. Web and the iOS "+" FAB are unchanged.

**Architecture:** All changes live in a single file (`apps/recipe-ui/src/App.jsx`). We add one piece of state (`addRecipeSource`) that tells the drawer which layout to render. Only the Capacitor deep-link dispatcher sets it to `'share-extension'`; every other entry point sets `'manual'`. The existing `useEffect` that parses the URL and enriches via Gemini is reused unchanged — we just consume the resulting `newRecipeForm.title` and `newRecipeForm.imageUrl` in a new JSX branch with MUI `Skeleton`s and an inline edit affordance.

**Tech Stack:** React + Vite + MUI; `@capacitor/core` + `@capacitor/app` for deep links. No worker, iOS Swift, or schema changes.

**Spec:** [docs/superpowers/specs/2026-04-22-ios-share-recipe-drawer-design.md](../specs/2026-04-22-ios-share-recipe-drawer-design.md)

**Testing note:** `apps/recipe-ui/src/App.jsx` has no unit-test coverage — the file is a 6,000-line single component. The spec's testing strategy is manual on-device verification after the UI builds. Each task therefore ends with a build check (`npm run build` from `apps/recipe-ui`) and a git commit; final verification is a manual pass through the scenarios in Task 5.

---

## File Structure

- **Modify:** `apps/recipe-ui/src/App.jsx` — all changes. New state, entry-point plumbing, branched JSX for the share-extension drawer body, inline title-edit interaction.

No new files. No files deleted.

---

## Task 1: Add `addRecipeSource` state and plumb entry points

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx` (around the existing `isAddDialogOpen` state and its writer call sites)

**Why this task first:** All later tasks branch on `addRecipeSource === 'share-extension'`. Nothing else works without the flag being set correctly and cleared on close.

- [ ] **Step 1: Add the state declaration**

Find the existing `isAddDialogOpen` declaration near [App.jsx:1017](apps/recipe-ui/src/App.jsx#L1017):

```jsx
const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
```

Immediately below it, add:

```jsx
const [addRecipeSource, setAddRecipeSource] = useState(null); // 'share-extension' | 'manual' | null
```

- [ ] **Step 2: Set `'share-extension'` from the Capacitor deep-link dispatcher**

Find `onAddRecipe` in `dispatchDeepLink` at [App.jsx:1370-1377](apps/recipe-ui/src/App.jsx#L1370-L1377):

```jsx
onAddRecipe: (url) => {
  // Pre-fill source URL and open Add Recipe dialog directly (user is already authed on native)
  setNewRecipeForm((prev) => ({ ...prev, sourceUrl: url }));
  setNewRecipeErrors({});
  setNewRecipePrefillInfo({ matched: false, hasIngredients: false, hasSteps: false });
  setSourceParseState({ status: 'idle', message: '' });
  setIsAddDialogOpen(true);
},
```

Add `setAddRecipeSource('share-extension');` as the last line inside the handler (before the closing `},`):

```jsx
onAddRecipe: (url) => {
  // Pre-fill source URL and open Add Recipe dialog directly (user is already authed on native)
  setNewRecipeForm((prev) => ({ ...prev, sourceUrl: url }));
  setNewRecipeErrors({});
  setNewRecipePrefillInfo({ matched: false, hasIngredients: false, hasSteps: false });
  setSourceParseState({ status: 'idle', message: '' });
  setIsAddDialogOpen(true);
  setAddRecipeSource('share-extension');
},
```

- [ ] **Step 3: Set `'manual'` in `openAddDialog`**

Find `openAddDialog` at [App.jsx:3433](apps/recipe-ui/src/App.jsx#L3433). Add `setAddRecipeSource('manual');` immediately before `setIsAddDialogOpen(true);`:

```jsx
const openAddDialog = () => {
  // Require authentication to add recipes
  console.log('openAddDialog check:', { supabase: !!supabase, DEV_API_TOKEN: !!DEV_API_TOKEN, isAuthChecked, hasSession: !!session });
  if (supabase && !DEV_API_TOKEN) {
    if (!isAuthChecked || !session) {
      console.log('Redirecting to auth dialog');
      openAuthDialog();
      return;
    }
  }
  setNewRecipeForm({ ...NEW_RECIPE_TEMPLATE });
  setNewRecipeErrors({});
  setNewRecipePrefillInfo({ matched: false, hasIngredients: false, hasSteps: false });
  setSourceParseState({ status: 'idle', message: '' });
  setAddRecipeSource('manual');
  setIsAddDialogOpen(true);
};
```

- [ ] **Step 4: Set `'manual'` in the web `?url=` share-target handler**

Find the `?url=` `useEffect` at [App.jsx:2400-2412](apps/recipe-ui/src/App.jsx#L2400-L2412). Add `setAddRecipeSource('manual');` immediately before `setIsAddDialogOpen(true);`:

```jsx
useEffect(() => {
  if (!isAuthChecked) return;
  const params = new URLSearchParams(window.location.search);
  const sharedUrl = params.get('url') || params.get('text');
  if (!sharedUrl) return;
  // Clean the URL so refreshing doesn't re-trigger
  window.history.replaceState({}, '', window.location.pathname);
  setNewRecipeForm({ ...NEW_RECIPE_TEMPLATE, sourceUrl: sharedUrl });
  setNewRecipeErrors({});
  setNewRecipePrefillInfo({ matched: false, hasIngredients: false, hasSteps: false });
  setSourceParseState({ status: 'idle', message: '' });
  setAddRecipeSource('manual');
  setIsAddDialogOpen(true);
}, [isAuthChecked]);
```

This ensures mobile-web users going through a PWA share target still see the existing form — only iOS native Share Extension triggers the new layout.

- [ ] **Step 5: Clear on close**

Find `closeAddDialog` at [App.jsx:3450-3453](apps/recipe-ui/src/App.jsx#L3450-L3453):

```jsx
const closeAddDialog = () => {
  setIsAddDialogOpen(false);
  setIsFirstRecipe(false);
};
```

Add `setAddRecipeSource(null);`:

```jsx
const closeAddDialog = () => {
  setIsAddDialogOpen(false);
  setIsFirstRecipe(false);
  setAddRecipeSource(null);
};
```

- [ ] **Step 6: Build and verify no regression**

Run: `cd apps/recipe-ui && npm run build`
Expected: build succeeds with no new warnings. `addRecipeSource` is set but not yet read anywhere, so UI behavior is unchanged.

- [ ] **Step 7: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat(ios): add addRecipeSource state for share-extension detection"
```

---

## Task 2: Build the iOS share-layout branch (preview row + skeletons)

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx` (mobile Drawer body around [App.jsx:5441-5539](apps/recipe-ui/src/App.jsx#L5441-L5539))

**Why this task:** Replaces the Source URL + Title text fields with a thumbnail + plain-text title preview when the drawer is opened from the iOS Share Extension. Edit link is NOT yet wired to swap to a TextField — that's Task 3. This task gets the static rendering + skeletons in place.

- [ ] **Step 1: Confirm `Skeleton` is imported**

Search for `Skeleton` in the MUI import block near the top of `App.jsx`. If absent, add it to the existing `@mui/material` import. Example (exact shape depends on current imports):

```jsx
import {
  // ...existing imports
  Skeleton,
  // ...
} from '@mui/material';
```

Run: `cd apps/recipe-ui && npm run build`
Expected: build succeeds; if `Skeleton` was already imported, the edit is a no-op.

- [ ] **Step 2: Add a derived `useIosShareLayout` boolean and a loading guard**

Just above the mobile Drawer JSX (around [App.jsx:5438](apps/recipe-ui/src/App.jsx#L5438), immediately before `{/* Add Recipe — bottom drawer on mobile, centered dialog on desktop */}`), add:

```jsx
const useIosShareLayout = isMobile && addRecipeSource === 'share-extension';
const hasTitle = Boolean(newRecipeForm.title && newRecipeForm.title.trim());
const hasImage = Boolean(newRecipeForm.imageUrl && newRecipeForm.imageUrl.trim());
const shareLayoutIsLoading = useIosShareLayout && !hasTitle && sourceParseState.status === 'loading';
const shareLayoutIsError = useIosShareLayout && !hasTitle && sourceParseState.status === 'error';
```

These are derived values — no new state.

- [ ] **Step 3: Add `imageLoadFailed` local state**

Just above the block from Step 2, add:

```jsx
const [imageLoadFailed, setImageLoadFailed] = useState(false);
```

Reset it when the drawer opens or the source URL changes. Find the existing `useEffect` that clears things when `isAddDialogOpen` changes — if none exists, add a small effect right after the state declaration:

```jsx
useEffect(() => {
  if (!isAddDialogOpen) setImageLoadFailed(false);
}, [isAddDialogOpen]);

useEffect(() => {
  setImageLoadFailed(false);
}, [newRecipeForm.imageUrl]);
```

- [ ] **Step 4: Branch the mobile Drawer body on `useIosShareLayout`**

In the mobile Drawer at [App.jsx:5441-5539](apps/recipe-ui/src/App.jsx#L5441-L5539), the body today contains (after the drag handle and title):

- A `<Box>` wrapping the Source URL `TextField`, Title `TextField`, parse-state row, and "Make it public" `FormControlLabel`.
- An Actions `<Box>` with Save and Cancel.

Replace the **inner fields Box** (the one currently at [App.jsx:5474-5516](apps/recipe-ui/src/App.jsx#L5474-L5516)) with a conditional:

```jsx
{useIosShareLayout ? (
  <Box sx={{ px: 3, pt: 1, pb: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
    {/* Preview row: thumbnail + title */}
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      {/* Thumbnail */}
      {shareLayoutIsLoading ? (
        <Skeleton variant="rectangular" width={96} height={96} sx={{ borderRadius: '8px', flexShrink: 0 }} />
      ) : hasImage && !imageLoadFailed ? (
        <Box
          component="img"
          src={newRecipeForm.imageUrl}
          alt={newRecipeForm.title || 'Recipe thumbnail'}
          onError={() => setImageLoadFailed(true)}
          sx={{ width: 96, height: 96, borderRadius: '8px', objectFit: 'cover', flexShrink: 0 }}
        />
      ) : (
        <Box
          sx={{
            width: 96, height: 96, borderRadius: '8px', flexShrink: 0,
            bgcolor: darkMode ? 'rgba(255,255,255,0.08)' : 'grey.200',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 32,
          }}
          aria-hidden="true"
        >
          🍳
        </Box>
      )}
      {/* Title + Edit link */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {shareLayoutIsLoading ? (
          <>
            <Skeleton variant="text" width="90%" height={24} />
            <Skeleton variant="text" width="60%" height={20} />
          </>
        ) : (
          <>
            <Typography
              variant="subtitle1"
              sx={{
                fontWeight: 600,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                wordBreak: 'break-word',
              }}
            >
              {hasTitle ? newRecipeForm.title : 'Untitled recipe'}
            </Typography>
            {/* Edit link — wiring added in Task 3 */}
            <Typography
              component="button"
              type="button"
              onClick={() => {}}
              sx={{
                background: 'none', border: 'none', p: 0, mt: 0.5, cursor: 'pointer',
                color: 'primary.main', fontSize: '0.8rem',
                '&:hover': { textDecoration: 'underline' },
              }}
            >
              Edit
            </Typography>
          </>
        )}
      </Box>
    </Box>
    {shareLayoutIsError && (
      <Typography variant="caption" color="error">
        Couldn't fetch recipe details. Edit title to save.
      </Typography>
    )}
    <FormControlLabel
      control={
        <Checkbox
          checked={Boolean(newRecipeForm.sharedWithFriends)}
          onChange={(e) => setNewRecipeForm((prev) => ({ ...prev, sharedWithFriends: e.target.checked }))}
          color="primary"
        />
      }
      label="Make it public"
      sx={{ ml: 'calc(-4px - 2px)', mt: 1 }}
    />
  </Box>
) : (
  <Box sx={{ px: 3, pt: 1, pb: 1, display: 'flex', flexDirection: 'column', gap: 2, position: 'relative' }}>
    <TextField
      label="Source URL"
      value={newRecipeForm.sourceUrl}
      onChange={handleNewRecipeChange('sourceUrl')}
      required
      fullWidth
      placeholder="https://example.com/recipe"
      error={Boolean(newRecipeErrors.sourceUrl)}
      helperText={
        newRecipeErrors.sourceUrl ||
        (isFirstRecipe ? 'Paste an Instagram, TikTok or YouTube link' : 'Link to the original recipe or video.')
      }
    />
    <TextField
      label="Title"
      value={newRecipeForm.title}
      onChange={handleNewRecipeChange('title')}
      required
      fullWidth
      error={Boolean(newRecipeErrors.title)}
      helperText={newRecipeErrors.title}
    />
    {sourceParseState.status === 'loading' && (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
        <CircularProgress size={20} />
        <Typography variant="body2" color="text.secondary">
          {sourceParseState.message || 'Parsing recipe details...'}
        </Typography>
      </Box>
    )}
    <FormControlLabel
      control={
        <Checkbox
          checked={Boolean(newRecipeForm.sharedWithFriends)}
          onChange={(e) => setNewRecipeForm((prev) => ({ ...prev, sharedWithFriends: e.target.checked }))}
          color="primary"
        />
      }
      label="Make it public"
      sx={{ ml: 'calc(-4px - 2px)', mt: 1 }}
    />
  </Box>
)}
```

The `else` branch is the existing fields block copied verbatim. This keeps web mobile and iOS "+" FAB behavior identical.

- [ ] **Step 5: Disable the Save button while loading**

Find the Save button in the mobile Drawer actions block at [App.jsx:5519-5521](apps/recipe-ui/src/App.jsx#L5519-L5521):

```jsx
<Button type="submit" variant="contained" sx={{ px: 4, width: '100%', maxWidth: 280 }}>
  Save recipe
</Button>
```

Replace with:

```jsx
<Button
  type="submit"
  variant="contained"
  disabled={shareLayoutIsLoading}
  sx={{ px: 4, width: '100%', maxWidth: 280 }}
>
  Save recipe
</Button>
```

`shareLayoutIsLoading` is only true when the new layout is active, so this does not affect web or iOS "+" FAB.

- [ ] **Step 6: Bypass the Source URL "required" validation for the share-extension path**

The share-extension layout hides the Source URL field, so the existing `required` attribute on the hidden `TextField` can't block submission — HTML5 validation only runs on rendered inputs. But the JS-side validator at [App.jsx:3838](apps/recipe-ui/src/App.jsx#L3838) (`validateUrl(newRecipeForm.sourceUrl.trim(), { required: true })`) will still run. Since the URL was set by the Capacitor dispatcher before the drawer opened, it should always be present — but verify by reading the validator.

Find the submit handler at [App.jsx:3833](apps/recipe-ui/src/App.jsx#L3833):

```jsx
const sourceUrlError = validateUrl(newRecipeForm.sourceUrl.trim(), { required: true });
```

No change needed. The URL is always present in the share-extension flow — if it weren't, the dispatcher wouldn't have opened the drawer. Document this by adding a short comment **only** if nothing above it already explains the guarantee; otherwise leave it alone.

- [ ] **Step 7: Build and verify no web regression**

Run: `cd apps/recipe-ui && npm run build`
Expected: build succeeds, no new warnings.

Run: `cd apps/recipe-ui && npm run dev -- --host`, open in a desktop browser, click "+". Expected: existing Add Recipe form shows (URL + Title text fields). Kill the dev server.

- [ ] **Step 8: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat(ios): render thumbnail+title preview for share-extension add-recipe"
```

---

## Task 3: Wire up inline title editing

**Files:**
- Modify: `apps/recipe-ui/src/App.jsx`

- [ ] **Step 1: Add `isEditingTitle` state and a ref for the pre-edit value**

Just after the `imageLoadFailed` state added in Task 2 Step 3, add:

```jsx
const [isEditingTitle, setIsEditingTitle] = useState(false);
const titlePreEditRef = useRef('');
```

Reset `isEditingTitle` on drawer close. In the existing effect `useEffect(() => { if (!isAddDialogOpen) setImageLoadFailed(false); }, [isAddDialogOpen]);`, extend it:

```jsx
useEffect(() => {
  if (!isAddDialogOpen) {
    setImageLoadFailed(false);
    setIsEditingTitle(false);
  }
}, [isAddDialogOpen]);
```

- [ ] **Step 2: Import `TextField` if not already in scope**

`TextField` is already used elsewhere in App.jsx — no new import needed. Skip if already imported.

- [ ] **Step 3: Replace the Title + Edit block with the editable swap**

In Task 2's JSX, inside the `{shareLayoutIsLoading ? ... : ( ... )}` branch, replace the inner `<>...</>` block (the Typography title + Edit link) with:

```jsx
<>
  {isEditingTitle ? (
    <TextField
      value={newRecipeForm.title}
      onChange={(e) => setNewRecipeForm((prev) => ({ ...prev, title: e.target.value }))}
      onBlur={() => {
        setNewRecipeForm((prev) => ({
          ...prev,
          title: (prev.title || '').trim() || 'Untitled recipe',
        }));
        setIsEditingTitle(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setNewRecipeForm((prev) => ({ ...prev, title: titlePreEditRef.current }));
          setIsEditingTitle(false);
        }
      }}
      autoFocus
      size="small"
      fullWidth
      inputProps={{ 'aria-label': 'Recipe title' }}
      onFocus={(e) => e.target.select()}
    />
  ) : (
    <>
      <Typography
        variant="subtitle1"
        sx={{
          fontWeight: 600,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          wordBreak: 'break-word',
        }}
      >
        {hasTitle ? newRecipeForm.title : 'Untitled recipe'}
      </Typography>
      <Typography
        component="button"
        type="button"
        onClick={() => {
          titlePreEditRef.current = newRecipeForm.title || '';
          setIsEditingTitle(true);
        }}
        sx={{
          background: 'none', border: 'none', p: 0, mt: 0.5, cursor: 'pointer',
          color: 'primary.main', fontSize: '0.8rem',
          '&:hover': { textDecoration: 'underline' },
        }}
      >
        Edit
      </Typography>
    </>
  )}
</>
```

Keep the rest of Task 2's JSX (the surrounding `<Box sx={{ flex: 1, minWidth: 0 }}>` wrapper, the preview row, the "Make it public" checkbox) unchanged.

- [ ] **Step 4: Build**

Run: `cd apps/recipe-ui && npm run build`
Expected: build succeeds, no new warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/recipe-ui/src/App.jsx
git commit -m "feat(ios): inline edit-title swap in share-extension drawer"
```

---

## Task 4: Manual verification on iOS and regression check on web

**Files:** None modified. This task verifies the work.

- [ ] **Step 1: Web desktop regression**

Run: `cd apps/recipe-ui && npm run dev -- --host`

Open `http://localhost:5173` in a desktop browser. Click the "+" FAB → Add Recipe dialog opens with Source URL + Title text fields (existing layout). Save a test recipe. Expected: works identically to pre-change behavior.

- [ ] **Step 2: Web mobile regression (narrow viewport)**

In the same desktop browser, open DevTools → Device Toolbar → iPhone 12. Refresh. Click "+" → mobile Drawer opens with Source URL + Title text fields (existing layout). Paste a TikTok URL and save. Expected: works identically to pre-change behavior.

- [ ] **Step 3: iOS "+" FAB regression (inside iOS app)**

Build the iOS app and run on device or simulator:

```bash
cd apps/recipe-ui && npm run build
cd ../ios && npx cap sync ios && npx cap open ios
```

In Xcode, build + run on simulator. Once the app loads, tap the "+" FAB. Expected: the existing Add Recipe drawer (URL + Title fields) appears — NOT the new layout.

- [ ] **Step 4: iOS Share Extension happy path**

On the same simulator/device, open Safari, navigate to a TikTok or Instagram recipe URL. Tap the share icon → select ReciFriend. Expected:
- App launches, Add Recipe drawer opens.
- Square skeletons show for thumbnail and title for ~1-2s.
- Thumbnail image resolves, title text resolves to the recipe's title.
- Save button becomes enabled once title is present.
- Tapping "Edit" swaps the title to an inline text field with all text selected.
- Typing a new title and tapping outside (or pressing return on the soft keyboard) commits the change.
- Tapping Save saves the recipe.

- [ ] **Step 5: iOS Share Extension error path**

From Safari, share a non-recipe URL (e.g., `https://example.com`). Expected:
- Drawer opens, skeletons show briefly.
- Thumbnail falls back to the gray placeholder box with the 🍳 glyph.
- Title shows "Untitled recipe" with the error caption "Couldn't fetch recipe details. Edit title to save."
- Save button is enabled.
- User taps "Edit", types a title, taps outside, taps Save → recipe saves successfully.

- [ ] **Step 6: iOS Share Extension image-load-failure path**

If you can engineer or find a source URL where Gemini returns an `imageUrl` that 404s at render time, share it and confirm the image falls back to the gray 🍳 box via the `onError` handler. If not easily reproducible, skip.

- [ ] **Step 7: Record results**

In the commit message for the final task or a follow-up note, record which scenarios passed. If any scenario failed, file a follow-up before merging.

- [ ] **Step 8: No code change — no commit**

This task verifies the preceding commits. If everything passed, the feature is ready to ship. If any step failed, return to the relevant Task and fix.

---

## Rollout

- No backend deploy needed.
- Frontend deploy (only when ready to ship): `cd apps/recipe-ui && npm run build && npx wrangler pages deploy dist --project-name recifind`
- iOS TestFlight build via Xcode after the frontend change is deployed (so the Capacitor webview picks up the new JS).
