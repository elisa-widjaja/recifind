# How it works — Step-by-step guide accordion

**Date:** 2026-05-29
**Area:** `apps/recipe-ui/src/components/SettingsDrawer.jsx` → `AboutContent`

## Goal

Add a collapsible step-by-step guide to the **About → How it works** section so
users (especially first-timers on iPhone) can learn how to save recipes via the
iOS share sheet, and how to pin ReciFriend into their share-sheet Favorites.

## Placement & behavior

- A single MUI `Accordion`, inserted directly after the existing "How it works"
  paragraph (`SettingsDrawer.jsx:202`).
- Collapsed by default. Summary title: **"Step-by-step guide"** (no emoji, to
  match the other About headers).
- Always visible — shown on web and iOS alike. iOS-specific steps are clearly
  labeled "On iPhone" so they read sensibly to web/Android users (who may still
  use the app on their phone).
- Requires adding `Accordion`, `AccordionSummary`, `AccordionDetails`, and
  `ExpandMoreIcon` (`@mui/icons-material/ExpandMore`) to the imports.

## Content

Sourced from `docs/cheat-sheets/saving-recipes.md`, reordered to lead with the
iOS flow. **Google Docs is intentionally omitted** from supported sources (kept
as a private friends-and-family feature).

1. **Supported sources** — TikTok, Instagram, YouTube, Pinterest, recipe sites
   (AllRecipes, NYT Cooking, Fresh off the Grid). Facebook is not yet supported.
   (No Google Docs.)

2. **Save from the iOS share sheet (fastest)** — numbered steps:
   1. Open the reel/post in the TikTok or Instagram app.
   2. Tap **Share**.
   3. First time only: ReciFriend won't be in the top row yet — scroll the
      app-icon row to the right and tap **More** to find it.
   4. Tap **ReciFriend** — it opens, parses, and saves the recipe.
   - **Screenshot:** `public/landing-share-sheet.jpg`, shown below the steps,
     width-capped with rounded corners and a caption ("ReciFriend in your share
     sheet."). Served from the public root as `/landing-share-sheet.jpg`.

3. **Tip: pin ReciFriend to your Favorites** — so it appears in the second row
   next to Mail & Messages:
   1. On the share sheet, scroll the app row to the end and tap **More**.
   2. Tap **Edit**.
   3. Tap the green **+** next to ReciFriend to add it to Favorites.
   4. Drag it up near Mail and Messages, then tap **Done**.

4. **Or paste the link** — Copy the link → open ReciFriend → tap **+** Add
   Recipe → paste → **Save**.

5. **On web (recifriend.com) or Android** — only the paste-the-link flow is
   available (same as step 4).

6. **Tips for best results** —
   - Reels where the creator lists ingredients in the **caption** parse the
     cleanest.
   - Save from the **original creator's post**, not a repost (reposts often
     strip captions).
   - If something imports with missing pieces, edit any field manually.

## Styling

- Reuse the existing About typography feel: small bold sub-headings + body text.
- Numbered/bulleted lists indented; comfortable line spacing.
- Screenshot constrained to a sensible `maxWidth` (≈ 260–300px) so it doesn't
  dominate on desktop; rounded corners; centered or left-aligned with a small
  caption beneath.
- Accordion summary styled to sit naturally in the About flow (no heavy
  elevation/shadow that clashes with the plain text sections).

## Out of scope

- No new screenshots beyond the existing `landing-share-sheet.jpg`. The
  first-time "find the icon" and "Edit Favorites" steps are text-only.
- No changes to the cheat-sheet markdown or anywhere else in the app.
- No Google Docs mention anywhere in this UI.
