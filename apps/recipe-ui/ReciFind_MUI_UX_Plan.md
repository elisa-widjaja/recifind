# 🍳 ReciFind — UX Prototype Plan (Material UI Edition)

> **Goal:** Build a local, non-scalable UX prototype that demonstrates the end-to-end recipe-finding experience using a **provided JSON dataset** — no backend, no search engine.  
> **Constraint:** Don’t write code yet. This is the **plan/spec** to “vibe code” against.

---

## 1) Problem & UX Outcome

**Problem**  
People save tons of recipes from Reels/TikTok/Blogs and can’t find what they want later.

**Outcome we’re proving**  
With clear information architecture, progressive filters, and fast scanning UI, users can **find a relevant recipe in <30 seconds** using meal-type & ingredient inputs.

**Primary KPI (prototype):** Time-to-first-useful-recipe (TTFUR).  
**Secondary KPIs:** Number of filter toggles before click; % users who use ingredient search.

---

## 2) Data Source

- Local file: `recipes.json`  
- Shape (non-negotiable for this prototype):
```json
{
  "recipes": [
    {
      "id": "r1",
      "title": "string",
      "sourceUrl": "string?",
      "imageUrl": "string?",
      "mealTypes": ["breakfast" | "lunch" | "dinner" | "dessert"],
      "ingredients": ["string", "..."],
      "steps": ["string", "..."]?,
      "durationMinutes": number?
    }
  ]
}
```
- Load path: User picks file via file picker.  
- Parsing: Fail fast with friendly error if JSON is missing `recipes` array.

---

## 3) User Stories (Acceptance Criteria)

1) **Filter by meal type**  
   - As a user, I can toggle **Breakfast / Lunch / Dinner / Dessert** chips and see results update instantly.  
   - AC: Toggling a chip filters the grid; state is visually reflected; multiple chips combine as OR.

2) **Search by ingredients**  
   - As a user, I can type ingredients (comma-separated) and set **Match All** or **Match Any**.  
   - AC: “All” returns recipes that include every typed ingredient; “Any” returns at least one match.

3) **Scan and open recipe**  
   - As a user, I can scan cards (title, meal type, optional duration) and open a **detail view**.  
   - AC: Detail shows image (if any), ingredients list, optional steps, and “View source” link.

4) **Load my own dataset**  
   - As a user, I can click **Load JSON** to replace sample data with my own `recipes.json`.  
   - AC: On successful load, grid repopulates; on error, I get a clear message and how to fix it.

5) **Empty/edge states**  
   - As a user, if nothing matches, I see a gentle **empty state** with guidance (e.g., “Try Match Any”).  
   - AC: No blank screens; accessibility and contrast respected.

---

## 4) UX Flow (Happy Path)

1. Open prototype → default sample data visible → filter controls approachable.  
2. Tap meal type chip(s) → grid updates.  
3. Enter ingredients → choose **Match All** vs **Match Any** → grid narrows.  
4. Scan cards → open one → skim ingredients/steps → click **View source** (optional).  
5. Load personal `recipes.json` → repeat flow.

---

## 5) IA & Screen Map

- **Global**: AppBar (brand, actions)  
- **Home**  
  - Filters Section  
    - Meal type chips  
    - Ingredient input + All/Any toggle  
  - Results header (count)  
  - Recipe Grid (cards)  
  - Empty State  
- **Recipe Detail** (Modal/Drawer)  
  - Hero image (optional)  
  - Title + meal type chips + optional duration  
  - Ingredients (list)  
  - Steps (ordered list; optional)  
  - “View source” (if URL)  
- **File Load Surface**  
  - File picker trigger  
  - Error/validation messaging

---

## 6) Material UI Component Inventory (no code)

**Global**
- `AppBar` + `Toolbar` — brand on left, actions on right
- `Container` — page max-width (md or lg)

**Filters**
- Meal types: `ToggleButtonGroup` (exclusive? **No** → multi-select), or `Chip` with `clickable/selected`
- Ingredients input: `TextField` (placeholder: “e.g., chicken, garlic, spinach”)
- Match mode: `ToggleButtonGroup` (values: “ALL”, “ANY”)
- Helper text: `FormHelperText`

**Results**
- Count: `Typography` subtle secondary text
- Grid: `Grid` container → `Card` per recipe
  - `CardMedia` (image), `CardContent` (title, metadata)
  - Duration: `Chip` (size small)
  - Meal type tags: `Chip` (small, outlined)

**Detail View**
- `Dialog` (or `Drawer` if you prefer mobile-first edge sheet)
- `DialogTitle` + `DialogContent`
- `ImageListItem` or `Box` with image
- Ingredients: `List` + `ListItem`
- Steps: `List` with ordered semantics (ARIA)
- External link: `Link` styled as secondary

**File Loading**
- `Button` → hidden file input (accessible label)
- `Snackbar` / `Alert` for success & error messaging

**Empty & Error States**
- `Box` centered stack with `Typography` and optional `SentimentDissatisfied` icon
- Clear next-step copy (e.g., “Switch to Match Any”, “Clear filters”)

---

## 7) Design System Decisions (Material UI Tokens)

**Theme**
- Mode: Light  
- Primary: neutral charcoal (readability)  
- Secondary: a soft accent for interactive affordances  
- Error/Warning: defaults are fine

**Typography**
- Display/Headline: `h5` for section titles  
- Body: `body2` for ingredient rows  
- Overline/Caption: metadata (meal type tags, duration)

**Spacing**
- Grid gaps: 16px on mobile, 24px on desktop  
- Card padding: 12–16px  
- Dialog content spacing: 16–24px

**Elevation**
- AppBar: elevation 0 + border bottom  
- Cards: elevation 1; hover → elevation 2  
- Dialog: default elevation

**Shape**
- Border radius: 8px across chips, cards, inputs

**States**
- Chips: `selected` style visible; use `aria-pressed` for accessibility  
- Toggle buttons: clear selected highlight; label `Match all`/`Match any` (no abbreviations)

---

## 8) Content & Copy

- **Filters header:** “Filter your saved recipes”  
- **Ingredients field label:** “Search by ingredients”  
- **All/Any helper:** “Comma-separated ingredients. Choose whether results must match all or any.”  
- **Count label:** “12 results”  
- **Empty state:** “No recipes found. Try switching to **Match any**, remove filters, or load a different JSON file.”  
- **Load button:** “Load JSON” (supporting text: `recipes.json`)  
- **Error (parse):** “That file isn’t valid. Expected an object with a `recipes` array.”

Tone: calm, direct, friendly; avoid cutesy in critical feedback.

---

## 9) Accessibility Checklist

- Color contrast meets WCAG AA for text and interactive states.  
- All interactive elements have **visible focus rings**.  
- Chips & toggles expose correct **ARIA** state (`aria-pressed`, `aria-selected`).  
- Ingredient input labeled; helper text associated via `aria-describedby`.  
- Dialog traps focus; `Esc` closes; `Close` button labeled.  
- Images in cards are decorative (empty alt) unless conveying meaning; detail hero has `alt` as recipe title.  
- Keyboard: Tab through chips → input → toggles → cards → open dialog → close.

---

## 10) Test Scenarios (Usability Script)

**Task A (Find dinner + two ingredients)**  
- “Find a dinner recipe that uses **chicken** and **spinach**.”  
  - Expect: user toggles Dinner; types “chicken, spinach”; sets **Match all**; opens a result.

**Task B (Switch to Any)**  
- “Now find anything with **tomato** or **basil**.”  
  - Expect: sets **Match any**; observes larger set.

**Task C (No results → recovery)**  
- Apply conflicting filters to trigger empty state; observe guidance and recovery.

**Task D (Load my data)**  
- Click **Load JSON** and choose a provided file.  
  - Expect: new list appears; no page refresh required; errors handled gracefully.

Measure completion time, errors, hesitations; collect feedback on clarity of chips vs. toggles.

---

## 11) Prototype States to Spec (Figma or screenshots)

- Home (default with sample data)  
- Chips: none selected; one selected; multiple selected  
- Ingredient input with helper text  
- Match All vs Any visual difference  
- Grid with images, titles, tags; hover card state  
- Empty results state  
- Dialog (with steps, without steps)  
- File load snackbars: success, error

---

## 12) Risks & Mitigations

- **Ambiguous ingredient spellings** → Keep exact match; communicate plainly (“Exact matches only in this prototype”).  
- **Long titles** → Truncate with tooltip on hover in card; full title in dialog.  
- **Missing images** → Placeholder aspect ratio box; keep layout stable.  
- **Large JSON** → This prototype is not optimized; document constraint (e.g., < 500 recipes).

---

## 13) Build Plan (When ready to code)

- **Foundation**: Material UI theming (palette, typography, shape)  
- **Shell**: AppBar, Container, Grid skeleton, Dialog  
- **Filters**: Chips & ToggleButtonGroup wired to local state  
- **Data**: File picker → JSON parse → in-memory array  
- **Interactions**: Filter logic (All/Any), open/close Dialog  
- **States**: Empty, error, loading shimmer (optional)  
- **Polish**: Focus management, keyboard navigation, hover/focus states

---

## 14) Success Criteria (Demo-Ready)

- Can load `recipes.json` and immediately browse/filter.  
- All ACs in Section 3 pass.  
- Usability test: 4/5 participants complete Task A in **≤30s**.  
- No console errors; clear error message for invalid JSON.

---

## 15) Stretch Ideas (If time permits)

- Sort control (duration asc/desc)  
- Exclude ingredient input (e.g., “-peanut”)  
- Quick-filter presets (e.g., “<20 min”)  
- Print-friendly **Cook Mode** (step-by-step)  
- Tag chip for cuisine (Mediterranean/Asian/etc.) – future dataset extension

---

### What I can deliver next (still no code, unless you say “go”)
- A **MUI component spec sheet** (props, states, visual annotations).  
- A **Figma frame map** and copy deck for each state.  
- A **dataset validator checklist** (what errors to catch and how to message them).

If this plan aligns, I’ll turn it into a one-page MUI component spec and a Figma frame checklist so you can move to implementation smoothly.
