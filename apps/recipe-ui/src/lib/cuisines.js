// Canonical cuisine list — keep in sync with the worker's enum in
// buildExtractOnlyPrompt() (apps/worker/src/index.ts). Values stored in
// recipes.cuisines and profile.cuisinePrefs are lowercase keys from this map.
// CUISINE_LABELS provides the display string; iteration order is taken from
// CUISINE_ORDER so the UI rendering matches across recipe-detail chips,
// onboarding, and settings without each surface picking its own ordering.
// Alphabetical by display label. CUISINE_ORDER is derived from key-insertion
// order, so keep this object in alphabetical-by-label order — that's what the
// onboarding/settings/recipe-detail chip lists render. Adding a new cuisine?
// Drop it in the alphabetical slot here AND in the worker's two prompt enums
// in apps/worker/src/index.ts (search for "middle-eastern").
export const CUISINE_LABELS = {
  african: 'African',
  american: 'American',
  british: 'British',
  chinese: 'Chinese',
  filipino: 'Filipino',
  french: 'French',
  indian: 'Indian',
  indonesian: 'Indonesian',
  italian: 'Italian',
  japanese: 'Japanese',
  korean: 'Korean',
  mediterranean: 'Mediterranean',
  mexican: 'Mexican',
  'middle-eastern': 'Middle Eastern',
  nordic: 'Nordic',
  thai: 'Thai',
  vietnamese: 'Vietnamese',
};

export const CUISINE_ORDER = Object.keys(CUISINE_LABELS);
