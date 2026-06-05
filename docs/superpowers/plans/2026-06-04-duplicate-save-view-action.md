# Duplicate-save "View" action Implementation Plan (option A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
>
> **Commit policy for THIS session:** the user holds all commits until explicit go-ahead. Implementers must NOT run `git commit`/`git add`; leave changes in the working tree. Ignore the per-task "Commit" convention.

**Goal:** On a duplicate save, give the user a one-tap way to open the existing recipe's detail, so a buried recipe's list position stops mattering. Web shows a "View" action on the toast; the iOS Share Extension's existing "View on ReciFriend" button is upgraded to open the specific recipe instead of the list.

**Architecture:** Web adds an optional `action` to the snackbar and wires it (View -> `handleOpenRecipeDetails`) into the three duplicate branches. Native threads the already-captured `recipeId` + the recipe's `userId` into a `recifriend://recipes/{id}?user={owner}` detail deep link inside the existing share-extension open flow.

**Tech Stack:** React/MUI (`App.jsx`, no JS unit harness — verify via build + manual), Swift iOS Share Extension (`xcodebuild`).

Spec: `docs/superpowers/specs/2026-06-04-duplicate-save-view-action-design.md`
Builds on the uncommitted duplicate-detection working tree (worker + App.jsx Tasks 4-6 + ShareFormView Task 7).

This plan refines the spec's Part 2: the share-extension button and `application.open` responder-chain mechanism ALREADY EXIST and are production-proven; the only native gap is that `openRecipeInApp` discards the recipeId and opens the list. So Part 2 is "route recipeId+owner into a detail deep link", not "add a button".

---

## File Structure

**Part 1 — Web (ships with next Pages deploy):**
- `apps/recipe-ui/src/App.jsx` — snackbar render gains `action` (~`:7777`); `resetFormState` gains an `action` param (~`:5220`); 3 duplicate branches set the action (~`:2605`, `:4723`, `:5318`).

**Part 2 — Native (ships next TestFlight build 28+):**
- `apps/ios/ios/App/ShareExtension/WorkerClient.swift` — `CreateRecipeResult` gains `ownerId` parsed from `recipe.userId` (~`:18`, `:223-228`).
- `apps/ios/ios/App/ShareExtension/ShareFormView.swift` — VM captures `savedOwnerId`; `openInApp()` passes it (~`:14`, `:199`, `:250-253`).
- `apps/ios/ios/App/ShareExtension/ShareViewController.swift` — `Outcome.viewInApp` carries `ownerId`; `openRecipeInApp` builds the detail deep link (~`:107`, `:127`, `:154-162`).

---

# PART 1 — WEB

## Task W1: Snackbar renders an optional action; `resetFormState` accepts one

**Files:** Modify `apps/recipe-ui/src/App.jsx` (`<Alert>` ~`:7777`, `resetFormState` ~`:5220`)

No JS unit harness; verify via `npm run build`.

- [ ] **Step 1: Add the `action` prop to the `<Alert>`**

In the snackbar `<Alert>` (currently opens at ~`:7777` with `onClose`/`severity`/`sx`), add an `action` prop just after `severity={snackbarState.severity}`:

```jsx
          action={
            snackbarState.action ? (
              <Button
                color="inherit"
                size="small"
                onClick={() => { snackbarState.action.onClick(); handleSnackbarClose(); }}
              >
                {snackbarState.action.label}
              </Button>
            ) : undefined
          }
```

`Button` is already imported (`App.jsx:7`). When `action` is set MUI hides the default close X and shows the button; the Snackbar still auto-hides and closes on clickaway, so dismissal is preserved. Only the duplicate toast will set `action`, so every other toast keeps its X.

- [ ] **Step 2: Give `resetFormState` an optional `action` param**

Change the signature (~`:5220`) from `const resetFormState = (message, severity = 'success') => {` to:

```jsx
    const resetFormState = (message, severity = 'success', action = undefined) => {
```

and in its `setSnackbarState({ open: true, message, severity, ... })` call, add `action,` to the object (next to `severity`). Leave the rest of `resetFormState` unchanged.

- [ ] **Step 3: Build**

Run: `cd apps/recipe-ui && npm run build`
Expected: succeeds, no errors.

---

## Task W2: Wire the View action into the three duplicate branches

**Files:** Modify `apps/recipe-ui/src/App.jsx` (`:2605`, `:4723`, `:5318`)

`handleOpenRecipeDetails(recipe)` (`:3788`) opens a recipe's detail from a full recipe object; the saved recipe in each handler is a full normalized recipe.

- [ ] **Step 1: `handleSavePublicRecipe` (~`:2605`)**

The duplicate ternary branch currently:
```jsx
          ? { open: true, message: 'Recipe already in your collection', severity: 'info', duration: 2000 }
```
becomes:
```jsx
          ? { open: true, message: 'Recipe already in your collection', severity: 'info', duration: 6000, action: { label: 'View', onClick: () => handleOpenRecipeDetails(saved) } }
```
(The save variable here is `saved`, from `const { recipe: saved, duplicate } = await res.json();`.)

- [ ] **Step 2: `handleSaveSharedRecipe` (~`:4723`)**

Currently:
```jsx
        setSnackbarState({ open: true, message: 'Recipe already in your collection', severity: 'info', duration: 2000 });
```
becomes:
```jsx
        setSnackbarState({ open: true, message: 'Recipe already in your collection', severity: 'info', duration: 6000, action: { label: 'View', onClick: () => handleOpenRecipeDetails(savedRecipe) } });
```
(Save variable is `savedRecipe`, from `const { recipe: savedRecipe, duplicate } = await response.json();`.)

- [ ] **Step 3: `handleAddRecipeSubmit` (~`:5318`)**

Currently:
```jsx
          resetFormState('Recipe already in your collection', 'info');
```
becomes:
```jsx
          resetFormState('Recipe already in your collection', 'info', { label: 'View', onClick: () => handleOpenRecipeDetails(savedRecipe) });
```
(Save variable is `savedRecipe`, from `const savedRecipe = normalizeRecipeFromApi(response?.recipe) || newRecipe;`.) Leave the non-duplicate `resetFormState('Saved ...')` / `resetFormState('Added ...')` calls unchanged.

- [ ] **Step 4: Build**

Run: `cd apps/recipe-ui && npm run build`
Expected: succeeds.

- [ ] **Step 5: Manual smoke (dev frontend + dev worker are already running this session)**

In the app (dev.recifriend.com / simulator), against a recipe you already have:
1. Save a discover/public card you own -> toast "Recipe already in your collection" with a "View" button; tap -> recipe detail opens.
2. Save a shared recipe you already have -> same.
3. Add-form: paste a URL already saved -> lands on recipes list + actionable toast; View opens detail.
4. Fresh save -> success toast, NO View button, normal duration, X still present.
Expected: all four behave as described.

---

# PART 2 — NATIVE SHARE EXTENSION

## Task N1: `CreateRecipeResult` carries the recipe owner id

**Files:** Modify `apps/ios/ios/App/ShareExtension/WorkerClient.swift` (`:18-20`, `:223-228`)

- [ ] **Step 1: Add `ownerId` to the struct**

`CreateRecipeResult` (~`:18`) currently:
```swift
struct CreateRecipeResult {
    let recipeId: String
    let statusCode: Int
}
```
becomes:
```swift
struct CreateRecipeResult {
    let recipeId: String
    let statusCode: Int
    let ownerId: String?
}
```

- [ ] **Step 2: Parse `recipe.userId` and pass it**

In `createRecipe`, the success parse (~`:223-228`) reads `json["recipe"]` into `recipe` and `id` from `recipe["id"]`. Add an owner read and include it in the result. Change the return block to:
```swift
            let recipe = json["recipe"] as? [String: Any],
            let id = recipe["id"] as? String
        else { throw WorkerClientError.badResponse(http.statusCode) }
        let ownerId = recipe["userId"] as? String
        return CreateRecipeResult(recipeId: id, statusCode: http.statusCode, ownerId: ownerId)
```
(Match the exact existing `guard let ... else` shape; only add the `ownerId` line and the third initializer argument. The worker response includes `recipe.userId`.)

- [ ] **Step 3: Compile**

Run: `cd apps/ios/ios/App && xcodebuild -workspace App.xcworkspace -scheme ShareExtension -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO`
Expected: BUILD SUCCEEDED. (Other targets may still reference the 3-arg initializer — there is only this one call site; confirm no other `CreateRecipeResult(` construction exists with `grep -rn 'CreateRecipeResult(' apps/ios`.)

---

## Task N2: Thread the owner id through the share-extension outcome

**Files:** Modify `apps/ios/ios/App/ShareExtension/ShareFormView.swift` (`:14`, `:199`, `:250-253`) and `ShareViewController.swift` (`:107`, `:127`)

- [ ] **Step 1: VM captures the owner id**

In `ShareFormViewModel`, alongside `@Published var savedRecipeId: String? = nil` (~`:14`) add:
```swift
    @Published var savedOwnerId: String? = nil
```
Where `self.savedRecipeId = result.recipeId` is set (~`:199`), add directly after it:
```swift
                    self.savedOwnerId = result.ownerId
```

- [ ] **Step 2: `openInApp` passes the owner id**

`openInApp()` (~`:250`) currently:
```swift
    func openInApp() {
        guard let id = savedRecipeId else { return }
        onFinish(.viewInApp(recipeId: id))
    }
```
becomes:
```swift
    func openInApp() {
        guard let id = savedRecipeId else { return }
        onFinish(.viewInApp(recipeId: id, ownerId: savedOwnerId))
    }
```

- [ ] **Step 3: Outcome case carries the owner id**

In `ShareViewController.swift`, the `Outcome` enum case (~`:107`) `case viewInApp(recipeId: String)` becomes:
```swift
        case viewInApp(recipeId: String, ownerId: String?)
```
and the dispatch (~`:127`) `case .viewInApp(let recipeId):` becomes:
```swift
        case .viewInApp(let recipeId, let ownerId):
            openRecipeInApp(recipeId: recipeId, ownerId: ownerId) { [weak self] _ in
                self?.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
            }
```
(Replace the existing two-line body that called `openRecipeInApp(recipeId:)`.)

- [ ] **Step 4: Compile (done together with Task N3's change)**

`openRecipeInApp`'s new signature lands in Task N3; build after that step. (If building now, expect a signature-mismatch error on `openRecipeInApp` until N3.)

---

## Task N3: Open the specific recipe detail instead of the list

**Files:** Modify `apps/ios/ios/App/ShareExtension/ShareViewController.swift` (`:154-162`)

- [ ] **Step 1: Build the recipe-detail deep link**

`openRecipeInApp` (~`:154`) currently ignores `recipeId` and opens `recifriend://recipes`. Replace the whole function with:
```swift
    private func openRecipeInApp(recipeId: String, ownerId: String?, completion: @escaping (Bool) -> Void) {
        // recifriend://recipes/{id}?user={owner} -> main app's deep-link parser
        // resolves to the recipe DETAIL view (build 20+). Falls back to the bare
        // recipes list if the id is somehow empty.
        var components = URLComponents()
        components.scheme = "recifriend"
        components.host = "recipes"
        if !recipeId.isEmpty {
            components.path = "/\(recipeId)"
            if let ownerId = ownerId, !ownerId.isEmpty {
                components.queryItems = [URLQueryItem(name: "user", value: ownerId)]
            }
        }
        guard let url = components.url else { completion(false); return }
        openURL(url, completion: completion)
    }
```
This reuses the existing, production-proven `openURL` responder-chain `application.open` (`:164`). The deep-link form matches `buildRecipeAppDeepLink` in `apps/recipe-ui/src/lib/shareUrl.js`.

- [ ] **Step 2: Compile the whole target**

Run: `cd apps/ios/ios/App && xcodebuild -workspace App.xcworkspace -scheme ShareExtension -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO`
Expected: BUILD SUCCEEDED (Tasks N1-N3 together).

---

## Task N4: On-device verification (parser gate) — ships with next build

**Files:** none (verification)

- [ ] **Step 1: Confirm the deep link resolves to detail for an OWN recipe**

On a device/simulator running the next build: share a recipe already in your collection -> "Already in your collection" + "View on ReciFriend" -> tap -> the main app opens and navigates to THAT recipe's detail (not the recipes list, not home).

Expected: lands on the recipe detail. The `recifriend://recipes/{id}?user={owner}` -> recipe_detail path is exercised today for shared links; this confirms it also resolves an own-collection recipe. If the parser does not handle an own recipe, that is a main-app deep-link-dispatch fix (out of this plan's extension scope) — report it rather than working around it in the extension.

- [ ] **Step 2: Confirm fresh-save behavior change is acceptable**

This change also makes a FRESH save's "View on ReciFriend" open the new recipe's detail instead of the list (previously it opened the list). Confirm that is the desired behavior (it is the intent: land on what you just saved). Report if not.

---

## Self-Review

**Spec coverage:**
- Web actionable "View" toast on all 3 duplicate paths -> Tasks W1, W2. ✔
- Timing-independent (same toast for 60s and days-later) -> all paths share the `duplicate` branch. ✔
- View opens recipe detail via `handleOpenRecipeDetails` -> W2. ✔
- Fresh save keeps success toast, no action -> W2 leaves non-duplicate branches untouched; verified in W2 Step 5. ✔
- Native: duplicate save -> open the specific recipe in-app -> Tasks N1-N3 (route recipeId+owner into detail deep link), N4 verify. ✔
- Graceful fallback (empty id -> list) -> N3 Step 1. ✔
- Ships separately (web now, native next build) -> Part 1 / Part 2 split. ✔
- Option B deferred -> no ordering/`created_at` change anywhere. ✔

**Placeholder scan:** No TBD/TODO; all edits show concrete code. N4 is an explicit on-device verification, not a placeholder.

**Type/naming consistency:** `CreateRecipeResult(recipeId:statusCode:ownerId:)` defined N1, the only call site updated N1; `savedOwnerId` set N2 and read in `openInApp` N2; `Outcome.viewInApp(recipeId:ownerId:)` defined and matched in dispatch N2, consumed by `openRecipeInApp(recipeId:ownerId:completion:)` N3. `snackbarState.action` shape `{ label, onClick }` consistent across render (W1) and all three setters (W2). `resetFormState(message, severity, action)` defined W1, called with 3 args only on the duplicate path W2.
