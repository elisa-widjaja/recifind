// "What's new" tips: the current batch plus the pure show/seen logic for the
// one-time bottom sheet (components/WhatsNewSheet.jsx).
//
// Tips live in the bundle on purpose. The iOS app ships its frontend inside the
// binary, so a tip must travel with the build that actually has the feature.
//
// To announce a new batch: bump `version` and replace `tips`. The old seen flag
// is simply never read again. Copy rule: no em dashes.
export const WHATS_NEW = {
  version: 1,
  // Which sheet App.jsx renders: 'carousel' (v2, screenshots, one card at a
  // time: components/WhatsNewCarousel.jsx) or 'list' (v1, all tips in one list:
  // components/WhatsNewSheet.jsx). Flip to 'list' to revert to v1.
  variant: 'carousel',
  tips: [
    {
      id: 'discover-search',
      title: 'Search community recipes',
      // Matches the Discover search box placeholder shown in the screenshot.
      body: 'On the Discover tab, search by dish, tag or creator.',
      action: 'discover',
    },
    {
      id: 'friends-of-friends',
      title: "See your friends' friends",
      body: 'Open a friend and tap Friends to see all their friends, not just mutuals.',
      action: 'friends',
    },
    {
      id: 'custom-tags',
      title: 'Organize with custom tags',
      body: 'Edit a recipe to add your own tags, then filter by tag to find it fast.',
      action: 'recipes',
    },
  ],
};

// New signups skip the sheet in their first session and get it on a later open.
const MIN_ACCOUNT_AGE_MS = 60 * 60 * 1000;

export const whatsNewSeenKey = (batch = WHATS_NEW) => `whats_new_seen_v${batch.version}`;

// Seen state is per device. `user` is the Supabase session user (created_at is
// an ISO string). `now` and `storage` are injected so this stays unit-testable.
export function shouldShowWhatsNew({ user, now = Date.now(), storage, batch = WHATS_NEW }) {
  if (!user) return false;
  const createdAt = Date.parse(user.created_at);
  if (Number.isNaN(createdAt)) return false;
  if (now - createdAt < MIN_ACCOUNT_AGE_MS) return false;
  try {
    return !storage.getItem(whatsNewSeenKey(batch));
  } catch {
    // Unreadable storage would mean showing on every launch. Stay quiet instead.
    return false;
  }
}

export function markWhatsNewSeen({ storage, batch = WHATS_NEW }) {
  try {
    storage.setItem(whatsNewSeenKey(batch), '1');
  } catch {
    // Best effort: a failed write only means the sheet may show once more.
  }
}
