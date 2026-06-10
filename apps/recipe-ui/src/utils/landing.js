// Which tab a returning user lands on, decided by how many recipes they've saved.
// 0-3 recipes -> Discover (keep them in "save more" mode while their collection is
// thin); 4+ -> Home feed (the social/retention surface that carries the friend
// suggestion shelf). Unknown/non-numeric counts default to Discover (the
// cold-start-safe choice). The one-time "Recipes tab" reward right after a first
// save in onboarding is handled separately and is not governed by this.
export function landingViewForRecipeCount(count) {
  return typeof count === 'number' && count >= 4 ? 'home' : 'discover';
}
