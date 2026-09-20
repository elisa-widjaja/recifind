// Rows for the Friend Drawer's Friends tab, from the friend-view-stats response.
//
// The worker leaves the viewer out of `friends`, but the tab count above the
// list (friendCount) includes them. When the full list is shown for someone
// else's drawer the viewer is by definition one of their friends, so a "You"
// row goes first and the count and the list agree. Falls back to mutualFriends
// for a worker that predates the `friends` field.
export function buildFriendListRows(stats, viewer, targetId) {
  const rows = stats?.friends ?? stats?.mutualFriends ?? [];
  const showSelf = stats?.friendsListScope === 'all' && viewer?.userId && viewer.userId !== targetId;
  if (!showSelf) return rows;
  return [
    {
      userId: viewer.userId,
      name: 'You',
      // Avatar initial + color come from the real name, not the "You" label.
      avatarName: viewer.displayName || 'You',
      avatarUrl: viewer.avatarUrl ?? null,
      foundingChefAt: viewer.foundingChefAt ?? null,
      isSelf: true,
    },
    ...rows,
  ];
}
