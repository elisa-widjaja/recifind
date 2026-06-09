# Seeded "Suggested friends" Shelf Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the weak shared-preferences stranger fallback in the friend-suggestion shelf with two curated, labeled seeded accounts (the founder and a top contributor), and rename the section to "Suggested friends".

**Architecture:** `handleFriendSuggestions` keeps its two-tier shape: friend-of-friend (FOF) stays the priority tier; when FOF < 5, the second tier now returns a small fixed set of seeded accounts (`kind: 'seed'`) resolved by email from `profiles`, instead of preference-matched strangers (`kind: 'pref'`). Seeded cards go through the normal friend-request flow (no auto-accept). The frontend renders the seed's `label` as the card's reason line and updates the section title. Metrics need no change: both seeded emails are already in `METRICS_EXCLUDED_EMAILS`.

**Tech Stack:** TypeScript Cloudflare Worker (`apps/worker`), React + MUI frontend (`apps/recipe-ui`), Vitest for both. D1 (`recipes-db`).

**Spec:** `docs/superpowers/specs/2026-06-08-friends-suggestion-shelf-design.md`

---

## File Structure

- `apps/worker/src/index.ts` — `handleFriendSuggestions` (~3327): swap the `pref` fallback tier for a `seed` tier; add a module-scope `SEEDED_SUGGESTIONS` config constant; update the return-type union.
- `apps/worker/src/friends-suggestions.test.ts` — replace `pref` test coverage with `seed` coverage; fix mock chains (the viewer-prefs profile fetch is gone).
- `apps/recipe-ui/src/components/SuggestionsShelf.jsx` — `reasonText` handles `kind: 'seed'`; remove the now-dead `PREF_REASON` map + `pref` branch; rename the section title in both the loading and loaded states.
- `apps/recipe-ui/src/components/SuggestionsShelf.test.jsx` — swap `pref` fixtures for `seed` fixtures; update title assertion.
- `apps/worker/src/routes/admin.test.ts` — add a guard assertion that `mochislime02@gmail.com` is in `METRICS_EXCLUDED_EMAILS` (no production code change; the value is already present).

**Grounding facts (verified against current code):**
- `profiles` has an `email` column (used by `resolveEmailFromUserId` and `admin.ts` `WHERE email = ?` / `email IN (...)`).
- `METRICS_EXCLUDED_EMAILS` (`apps/worker/src/routes/admin.ts:612`) already contains both `elisa.widjaja@gmail.com` and `mochislime02@gmail.com`.
- The current section title string is title-cased: **"Friends You May Know"** (appears at `SuggestionsShelf.jsx:201` and `:257`).
- Sent friend requests are NOT excluded from suggestions; they are surfaced with `requestSent: true` so the "Requested" card persists. Seeds mirror this exactly. The exclusion set for seeds is: self, already-friend, dismissed.

---

## Task 1: Worker — replace `pref` fallback with `seed` fallback

**Files:**
- Modify: `apps/worker/src/index.ts:3327-3445` (`handleFriendSuggestions` + its return-type union)
- Test: `apps/worker/src/friends-suggestions.test.ts`

### Step 1: Update the worker tests to expect the `seed` tier (write the failing tests first)

Replace the entire `describe('handleFriendSuggestions', ...)` block (lines 4-201) with the version below. Changes from the original: the viewer-prefs profile `first()` fetch is gone, so every FOF-short mock chain now ends with a **seed query** (`all`) as its 3rd `prepare` call; the `pref` test becomes a `seed` test; the `kind: 'pref'`/`sharedPref` shape becomes `kind: 'seed'`/`label`.

```ts
describe('handleFriendSuggestions', () => {
  // Helper: every call to handleFriendSuggestions starts with a query against
  // friend_requests_sent. Tests that don't care about that flag should mock it
  // as empty results.
  const sentQueryMock = (toIds: string[] = []) => ({
    bind: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue({ results: toIds.map(id => ({ to_user_id: id })) }),
  });
  const allMock = (results: unknown[]) => ({
    bind: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue({ results }),
  });

  it('returns FOF suggestions tagged kind="fof" with mutualCount, sorted desc', async () => {
    const fofResults = [
      { userId: 'user-b', name: 'Maya R.', mutualCount: 2 },
      { userId: 'user-c', name: 'James T.', mutualCount: 1 },
    ];
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce(sentQueryMock())
        .mockReturnValueOnce(allMock(fofResults))
        // FOF < 5 -> seed query runs; no seeded accounts match here.
        .mockReturnValueOnce(allMock([])),
    } as unknown as D1Database;

    const result = await handleFriendSuggestions(mockDb, 'user-a');

    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions[0]).toEqual({
      userId: 'user-b',
      name: 'Maya R.',
      avatarUrl: null,
      kind: 'fof',
      mutualCount: 2,
      requestSent: false,
    });
    expect(result.suggestions[1]).toEqual({
      userId: 'user-c',
      name: 'James T.',
      avatarUrl: null,
      kind: 'fof',
      mutualCount: 1,
      requestSent: false,
    });
  });

  it('flags suggestions with requestSent=true when a pending sent-request exists', async () => {
    const fofResults = [
      { userId: 'user-b', name: 'Maya R.', mutualCount: 2 },
      { userId: 'user-c', name: 'James T.', mutualCount: 1 },
    ];
    const mockDb = {
      prepare: vi.fn()
        // user-a has already sent a request to user-b
        .mockReturnValueOnce(sentQueryMock(['user-b']))
        .mockReturnValueOnce(allMock(fofResults))
        .mockReturnValueOnce(allMock([])),
    } as unknown as D1Database;

    const result = await handleFriendSuggestions(mockDb, 'user-a');

    // Both still surfaced (not excluded) so the "Requested" card persists.
    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions[0].requestSent).toBe(true);
    expect(result.suggestions[1].requestSent).toBe(false);
  });

  it('hides nameless suggestions (null/blank display_name) so no gibberish card renders', async () => {
    const fofResults = [
      { userId: 'user-b', name: 'Maya R.', mutualCount: 2 },
      { userId: 'user-x', name: null, mutualCount: 5 },
      { userId: 'user-y', name: '   ', mutualCount: 4 },
    ];
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce(sentQueryMock())
        .mockReturnValueOnce(allMock(fofResults))
        .mockReturnValueOnce(allMock([])),
    } as unknown as D1Database;

    const result = await handleFriendSuggestions(mockDb, 'user-a');

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].userId).toBe('user-b');
  });

  it('returns empty array when no FOF and no seeded accounts match', async () => {
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce(sentQueryMock())
        .mockReturnValueOnce(allMock([]))
        .mockReturnValueOnce(allMock([])),
    } as unknown as D1Database;

    const result = await handleFriendSuggestions(mockDb, 'user-a');
    expect(result.suggestions).toHaveLength(0);
  });

  it('falls back to seeded accounts when FOF < 5, tagged kind="seed" with label, founder first', async () => {
    const fofResults = [
      { userId: 'user-b', name: 'Maya R.', mutualCount: 1 },
    ];
    // Returned out of config order to prove the handler re-orders founder first.
    const seedResults = [
      { userId: 'user-mochi', name: 'Mochi', avatarUrl: null, email: 'mochislime02@gmail.com' },
      { userId: 'user-elisa', name: 'Elisa W.', avatarUrl: null, email: 'elisa.widjaja@gmail.com' },
    ];
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce(sentQueryMock())
        .mockReturnValueOnce(allMock(fofResults))
        .mockReturnValueOnce(allMock(seedResults)),
    } as unknown as D1Database;

    const result = await handleFriendSuggestions(mockDb, 'user-a');

    expect(result.suggestions).toHaveLength(3);
    expect(result.suggestions[0].kind).toBe('fof');
    // Founder ordered before top contributor regardless of row order.
    expect(result.suggestions[1]).toEqual({
      userId: 'user-elisa',
      name: 'Elisa W.',
      avatarUrl: null,
      kind: 'seed',
      label: 'ReciFriend Founder',
      requestSent: false,
    });
    expect(result.suggestions[2]).toEqual({
      userId: 'user-mochi',
      name: 'Mochi',
      avatarUrl: null,
      kind: 'seed',
      label: 'Top contributor',
      requestSent: false,
    });
  });

  it('skips the seeded fallback when FOF >= 5', async () => {
    const fofResults = [
      { userId: 'u1', name: 'A', mutualCount: 3 },
      { userId: 'u2', name: 'B', mutualCount: 2 },
      { userId: 'u3', name: 'C', mutualCount: 2 },
      { userId: 'u4', name: 'D', mutualCount: 1 },
      { userId: 'u5', name: 'E', mutualCount: 1 },
    ];
    const mockDb = {
      prepare: vi.fn()
        .mockReturnValueOnce(sentQueryMock())
        .mockReturnValueOnce(allMock(fofResults)),
    } as unknown as D1Database;

    const result = await handleFriendSuggestions(mockDb, 'user-a');

    expect(result.suggestions).toHaveLength(5);
    expect(result.suggestions.every(s => s.kind === 'fof')).toBe(true);
    // Only the sent-set + FOF queries — no seed query.
    expect((mockDb.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });
});
```

### Step 2: Run the worker tests to verify they fail

Run: `cd apps/worker && npx vitest run src/friends-suggestions.test.ts`
Expected: FAIL — the seed test expects `kind: 'seed'`/`label` but the handler still emits `kind: 'pref'`/`sharedPref`; the mock chains no longer match the handler's query sequence.

### Step 3: Update the return-type union in `handleFriendSuggestions`

In `apps/worker/src/index.ts`, replace the `pref` union member (line 3333):

```ts
    | { userId: string; name: string; avatarUrl: string | null; kind: 'pref'; sharedPref: string; requestSent: boolean }
```

with:

```ts
    | { userId: string; name: string; avatarUrl: string | null; kind: 'seed'; label: string; requestSent: boolean }
```

### Step 4: Add the `SEEDED_SUGGESTIONS` config constant

In `apps/worker/src/index.ts`, immediately **before** `export async function handleFriendSuggestions(` (line 3327), add:

```ts
// Curated accounts surfaced in the friend-suggestion shelf when a user's real
// social graph (friend-of-friend) is thin. They go through the normal
// friend-request flow — no auto-accept. Order matters: founder first.
// Both emails are owner-controlled and are already in METRICS_EXCLUDED_EMAILS,
// so seeded connections don't inflate the has_friends activation segment.
export const SEEDED_SUGGESTIONS: ReadonlyArray<{ email: string; label: string }> = [
  { email: 'elisa.widjaja@gmail.com', label: 'ReciFriend Founder' },
  { email: 'mochislime02@gmail.com', label: 'Top contributor' },
];
```

### Step 5: Replace the `pref` fallback body with the `seed` fallback

In `apps/worker/src/index.ts`, replace everything from the `// --- Pref-match fallback ---` comment (line 3389) through the final `return { suggestions: [...fofSuggestions, ...prefSuggestions] };` (line 3444) with:

```ts
  // --- Seeded fallback ---
  // FOF is thin (< 5). Instead of suggesting unlabeled strangers, top up with a
  // small, curated set of labeled accounts (founder + a top contributor),
  // resolved by email. These use the normal friend-request flow — no
  // auto-accept. Excludes self, already-friends, and dismissed, mirroring FOF;
  // a pending sent-request is surfaced (requestSent) rather than excluded.
  const alreadySuggested = new Set(fofSuggestions.map(s => s.userId));
  const seedEmails = SEEDED_SUGGESTIONS.map(s => s.email);
  const emailPlaceholders = seedEmails.map(() => '?').join(', ');

  const seedRows = await db.prepare(`
    SELECT p.user_id AS userId, p.display_name AS name, p.avatar_url AS avatarUrl, p.email AS email
    FROM profiles p
    WHERE p.email IN (${emailPlaceholders})
      AND p.user_id != ?
      AND p.user_id NOT IN (SELECT friend_id FROM friends WHERE user_id = ?)
      AND p.user_id NOT IN (SELECT dismissed_user_id FROM dismissed_suggestions WHERE user_id = ?)
      AND p.deleted_at IS NULL
      AND p.display_name IS NOT NULL AND TRIM(p.display_name) <> ''
  `).bind(...seedEmails, userId, userId, userId).all<{
    userId: string;
    name: string;
    avatarUrl: string | null;
    email: string;
  }>();

  const labelByEmail = new Map(SEEDED_SUGGESTIONS.map(s => [s.email, s.label]));
  const orderByEmail = new Map(SEEDED_SUGGESTIONS.map((s, i) => [s.email, i]));

  const seedSuggestions = (seedRows.results || [])
    .filter(row => !alreadySuggested.has(row.userId))
    .filter(row => row.name && String(row.name).trim())
    // Preserve config order (founder first) regardless of DB row order.
    .sort((a, b) => (orderByEmail.get(a.email) ?? 99) - (orderByEmail.get(b.email) ?? 99))
    .map(row => ({
      userId: row.userId,
      name: row.name,
      avatarUrl: row.avatarUrl ?? null,
      kind: 'seed' as const,
      label: labelByEmail.get(row.email) || '',
      requestSent: sentToIds.has(row.userId),
    }));

  return { suggestions: [...fofSuggestions, ...seedSuggestions] };
```

Note: this deletes the viewer-prefs profile fetch, the `allMyPrefs` early-return, and the `LIKE`-based `prefRows` query (one fewer D1 read per cold-start request).

### Step 6: Run the worker tests to verify they pass

Run: `cd apps/worker && npx vitest run src/friends-suggestions.test.ts`
Expected: PASS — all 6 tests green.

### Step 7: Run the full worker test suite (no regressions elsewhere)

Run: `cd apps/worker && npm test`
Expected: PASS. If any other test referenced `kind: 'pref'` or `sharedPref`, fix it to the `seed` shape (grep first: `grep -rn "sharedPref\|kind: 'pref'\|kind=\"pref\"" apps/worker/src`).

### Step 8: Commit

```bash
git add apps/worker/src/index.ts apps/worker/src/friends-suggestions.test.ts
git commit -m "feat(friends): seed founder + top contributor in suggestion fallback

Replace the shared-prefs stranger fallback (kind 'pref') with a curated
seeded tier (kind 'seed') resolved by email. FOF stays priority; seeds only
top up when FOF < 5. Normal friend-request flow, no auto-accept. Excludes
self/already-friend/dismissed, mirroring FOF.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Frontend — render seed label + rename section title

**Files:**
- Modify: `apps/recipe-ui/src/components/SuggestionsShelf.jsx`
- Test: `apps/recipe-ui/src/components/SuggestionsShelf.test.jsx`

### Step 1: Update the frontend tests (write the failing tests first)

In `apps/recipe-ui/src/components/SuggestionsShelf.test.jsx`, replace the `SUGGESTIONS` fixture (lines 5-12) with:

```jsx
const SUGGESTIONS = [
  { userId: 'u1', name: 'Maya R.', kind: 'fof', mutualCount: 2 },
  { userId: 'u2', name: 'James T.', kind: 'fof', mutualCount: 1 },
  // Seeded accounts: the label IS the reason line.
  { userId: 'u3', name: 'Elisa W.', kind: 'seed', label: 'ReciFriend Founder' },
  { userId: 'u4', name: 'Mochi', kind: 'seed', label: 'Top contributor' },
];
```

Replace the "renders one card per suggestion with name and reason text" test (lines 23-33) with:

```jsx
  it('renders one card per suggestion with name and reason text', () => {
    render(<SuggestionsShelf accessToken="t" suggestions={SUGGESTIONS} />);
    expect(screen.getByText('Maya R.')).toBeInTheDocument();
    expect(screen.getByText('2 mutual friends')).toBeInTheDocument();
    expect(screen.getByText('James T.')).toBeInTheDocument();
    expect(screen.getByText('1 mutual friend')).toBeInTheDocument();
    expect(screen.getByText('Elisa W.')).toBeInTheDocument();
    expect(screen.getByText('ReciFriend Founder')).toBeInTheDocument();
    expect(screen.getByText('Mochi')).toBeInTheDocument();
    expect(screen.getByText('Top contributor')).toBeInTheDocument();
  });
```

Replace the header test (lines 35-44) with the new title string:

```jsx
  it('renders "Suggested friends" header and "See all" when onOpenFriends is provided', () => {
    const onOpenFriends = vi.fn();
    render(
      <SuggestionsShelf accessToken="t" suggestions={SUGGESTIONS} onOpenFriends={onOpenFriends} />
    );
    expect(screen.getByText('Suggested friends')).toBeInTheDocument();
    const seeAll = screen.getByText('See all');
    fireEvent.click(seeAll);
    expect(onOpenFriends).toHaveBeenCalledTimes(1);
  });
```

### Step 2: Run the frontend tests to verify they fail

Run: `cd apps/recipe-ui && npx vitest run src/components/SuggestionsShelf.test.jsx`
Expected: FAIL — "Suggested friends" not found (title still "Friends You May Know"); "ReciFriend Founder"/"Top contributor" not rendered (seed branch missing).

### Step 3: Handle `kind: 'seed'` in `reasonText` and remove the dead `pref` path

In `apps/recipe-ui/src/components/SuggestionsShelf.jsx`, delete the `PREF_REASON` map (lines 23-35, the block comment + the `const PREF_REASON = { ... };`).

Then replace `reasonText` (lines 37-43) with:

```jsx
function reasonText(s) {
  if (s.kind === 'fof') {
    const n = s.mutualCount;
    return `${n} mutual ${n === 1 ? 'friend' : 'friends'}`;
  }
  // seed (founder / top contributor): the label IS the reason line.
  return s.label || '';
}
```

### Step 4: Rename the section title in both states

In `apps/recipe-ui/src/components/SuggestionsShelf.jsx`, replace BOTH occurrences of the title. There are two — the loading state (line ~201) and the loaded state (line ~257), both currently:

```jsx
            Friends You May Know
```

Change each to:

```jsx
            Suggested friends
```

(Use replace-all on the exact string `Friends You May Know` -> `Suggested friends`; verify exactly 2 replacements.)

### Step 5: Run the frontend tests to verify they pass

Run: `cd apps/recipe-ui && npx vitest run src/components/SuggestionsShelf.test.jsx`
Expected: PASS — all tests green.

### Step 6: Run the full frontend test suite (no regressions)

Run: `cd apps/recipe-ui && npm test`
Expected: PASS. If another test asserts the old "Friends You May Know" title or a `pref`/`sharedPref` shape, fix it (grep: `grep -rn "Friends You May Know\|sharedPref\|PREF_REASON\|kind: 'pref'" apps/recipe-ui/src`).

### Step 7: Commit

```bash
git add apps/recipe-ui/src/components/SuggestionsShelf.jsx apps/recipe-ui/src/components/SuggestionsShelf.test.jsx
git commit -m "feat(friends): render seed label, rename shelf to 'Suggested friends'

reasonText renders the seed account's label (e.g. 'ReciFriend Founder',
'Top contributor') as the card reason. Section title 'Friends You May Know'
-> 'Suggested friends' (true for both FOF and seeded cards). Removes the dead
PREF_REASON map.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Metrics — guard that seeded IDs stay excluded

**Files:**
- Test: `apps/worker/src/routes/admin.test.ts:582`
- (No production change: `mochislime02@gmail.com` is already in `METRICS_EXCLUDED_EMAILS` at `apps/worker/src/routes/admin.ts:615`.)

### Step 1: Add a guard assertion next to the existing one

In `apps/worker/src/routes/admin.test.ts`, find the existing assertion (line 582):

```ts
    expect(METRICS_EXCLUDED_EMAILS).toContain('elisa.widjaja@gmail.com');
```

Add immediately after it:

```ts
    // Seeded suggestion accounts must stay excluded so founder/top-contributor
    // connections don't inflate the has_friends activation segment.
    expect(METRICS_EXCLUDED_EMAILS).toContain('mochislime02@gmail.com');
```

### Step 2: Run the test to verify it passes

Run: `cd apps/worker && npx vitest run src/routes/admin.test.ts`
Expected: PASS (the email is already in the list — this is a regression guard, so it passes immediately).

### Step 3: Commit

```bash
git add apps/worker/src/routes/admin.test.ts
git commit -m "test(metrics): guard mochislime02 stays in METRICS_EXCLUDED_EMAILS

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (before deploy)

These changes touch the worker (`/friends/suggestions`) and the frontend shelf. Per the project's import-flow guardrail, the recipe import path is untouched here, but still run both suites green before any deploy.

- [ ] `cd apps/worker && npm test` — all green
- [ ] `cd apps/recipe-ui && npm test` — all green
- [ ] Manual smoke (optional, dev tunnel): a 0-friend test account loads the home shelf and sees exactly two cards, "Elisa W. / ReciFriend Founder" then "Mochi / Top contributor", each with an "Add Friend" button; "Add" flips to "Requested"; dismiss hides the card.

**Deploy is a separate, user-initiated step** (worker: `cd apps/worker && npx wrangler deploy`; frontend: `cd apps/recipe-ui && npm run build && npx wrangler pages deploy dist --project-name recifind`). Do not deploy without the user's go-ahead, and `git status` first — the working tree is what ships.

---

## Spec coverage check

- Rename "Friends you may know" -> "Suggested friends" — Task 2, Steps 1, 4.
- Replace `pref` fallback with seeds, FOF stays priority, seeds only when FOF < 5 — Task 1, Steps 3-5.
- Two seeded accounts (founder + top contributor), founder first, bare-badge labels — Task 1, Steps 4-5 (config + ordering); Task 2, Step 3 (label as reason line).
- No auto-accept (normal request flow) — unchanged "Add Friend" -> `POST /friends/request`; nothing added.
- Exclusions identical to FOF (self / already-friend / dismissed; sent-request surfaced not excluded) — Task 1, Step 5 (SQL) + tests in Step 1.
- Metrics: seeded IDs excluded — Task 3 (already satisfied; guarded).
- Tests updated (FOF-wins-at-5, seed-tops-up, exclusion-via-requestSent, label/kind) — Task 1 Step 1, Task 2 Step 1.
- Out of scope (founder-initiated requests, auto-accept, featured recipes, pinning, do-not-suggest control) — none added. Confirmed.
