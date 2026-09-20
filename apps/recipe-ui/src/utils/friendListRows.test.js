import { describe, it, expect } from 'vitest';
import { buildFriendListRows } from './friendListRows';

const viewer = { userId: 'me', displayName: 'Elisa W', avatarUrl: 'https://img/me.png', foundingChefAt: null };
const jordan = { userId: 'user-j', name: 'Jordan Lee', avatarUrl: null, foundingChefAt: null, isMutual: true };

describe('buildFriendListRows', () => {
  it('puts a "You" row first when the full list is shown for a friend', () => {
    const rows = buildFriendListRows({ friendsListScope: 'all', friends: [jordan] }, viewer, 'target-id');
    expect(rows).toEqual([
      { userId: 'me', name: 'You', avatarName: 'Elisa W', avatarUrl: 'https://img/me.png', foundingChefAt: null, isSelf: true },
      jordan,
    ]);
  });

  it('shows just the "You" row when the viewer is the only friend', () => {
    const rows = buildFriendListRows({ friendsListScope: 'all', friends: [] }, viewer, 'target-id');
    expect(rows).toHaveLength(1);
    expect(rows[0].isSelf).toBe(true);
  });

  it('adds no "You" row to a mutuals-only list (viewer is not their friend)', () => {
    const rows = buildFriendListRows({ friendsListScope: 'mutual', friends: [jordan] }, viewer, 'target-id');
    expect(rows).toEqual([jordan]);
  });

  it('adds no "You" row when viewing your own drawer', () => {
    const rows = buildFriendListRows({ friendsListScope: 'all', friends: [jordan] }, viewer, 'me');
    expect(rows).toEqual([jordan]);
  });

  it('falls back to mutualFriends for a worker without the friends field', () => {
    const rows = buildFriendListRows({ mutualFriends: [jordan] }, viewer, 'target-id');
    expect(rows).toEqual([jordan]);
  });

  it('returns an empty list for missing stats or a missing viewer id', () => {
    expect(buildFriendListRows(null, viewer, 'target-id')).toEqual([]);
    expect(buildFriendListRows({ friendsListScope: 'all', friends: [] }, { userId: null }, 'target-id')).toEqual([]);
  });
});
