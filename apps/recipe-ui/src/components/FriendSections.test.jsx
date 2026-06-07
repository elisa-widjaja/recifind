import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FriendSections, { ActivityItem } from './FriendSections';

const FRIEND_REQUEST_ITEM = {
  id: 101,
  type: 'friend_request',
  message: 'Jules sent you a friend request',
  friendName: 'Jules',
  fromUserId: 'user-jules',
  recipe: null,
  createdAt: '2026-03-10T10:00:00Z',
  read: false,
};

describe('ActivityItem — friend_request', () => {
  // The activity message bolds the friend's name in a <span>, which splits the
  // sentence across multiple text nodes. Match on the message paragraph's full
  // textContent rather than a single-node text match.
  const messageNode = (text) =>
    screen.getByText((_, el) => el?.tagName === 'P' && el?.textContent === text);

  it('renders the friend_request row with the message', () => {
    render(
      <ActivityItem
        item={FRIEND_REQUEST_ITEM}
        onOpenFriendRequest={vi.fn()}
      />
    );
    expect(messageNode('Jules sent you a friend request')).toBeInTheDocument();
  });

  it('is clickable and calls onOpenFriendRequest with the full item', () => {
    const onOpen = vi.fn();
    render(
      <ActivityItem
        item={FRIEND_REQUEST_ITEM}
        onOpenFriendRequest={onOpen}
      />
    );
    const row = screen.getByRole('button', { name: /respond to friend request from jules/i });
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(FRIEND_REQUEST_ITEM);
  });

  it('responds to keyboard activation (Enter / Space)', () => {
    const onOpen = vi.fn();
    render(
      <ActivityItem
        item={FRIEND_REQUEST_ITEM}
        onOpenFriendRequest={onOpen}
      />
    );
    const row = screen.getByRole('button', { name: /respond to friend request from jules/i });
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('is not clickable when fromUserId is missing (stale payload)', () => {
    const staleItem = { ...FRIEND_REQUEST_ITEM, fromUserId: undefined };
    const onOpen = vi.fn();
    render(
      <ActivityItem
        item={staleItem}
        onOpenFriendRequest={onOpen}
      />
    );
    // No button role assigned — row still renders the message
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(messageNode('Jules sent you a friend request')).toBeInTheDocument();
  });

  it('shows a checkmark (not a button) when the request is resolved', () => {
    const resolvedItem = { ...FRIEND_REQUEST_ITEM, resolved: true };
    const onOpen = vi.fn();
    render(
      <ActivityItem
        item={resolvedItem}
        onOpenFriendRequest={onOpen}
      />
    );
    // Not clickable — no button role, no tap handler
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    // Checkmark icon present (via aria-label)
    expect(screen.getByLabelText('Friend request accepted')).toBeInTheDocument();
    // A resolved request renders the connection message, not the request text.
    // Clicking the row (if user tries to) must NOT fire onOpenFriendRequest.
    fireEvent.click(messageNode('You and Jules are now connected'));
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('FriendSections — unified feed (Phase 5)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  function mockFetch(handlers) {
    global.fetch = vi.fn((url) => {
      for (const [pattern, response] of handlers) {
        if (url.includes(pattern)) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(response) });
        }
      }
      return Promise.resolve({ ok: false });
    });
  }

  const noop = () => {};

  it('renders a single "From your friends" section when there is friend activity', async () => {
    mockFetch([
      ['/friends/activity', { activity: [{ id: 1, type: 'friend_saved_recipe', friendName: 'Henny', recipe: { id: 'r1', title: 'Beef Stew' }, createdAt: new Date().toISOString() }] }],
      ['/friends/recently-saved', { items: [] }],
      ['/friends/recently-shared', { items: [] }],
    ]);
    render(<FriendSections accessToken="t" onOpenRecipe={noop} onSaveRecipe={noop} />);
    await waitFor(() => expect(screen.getByText(/^Friend Activity$/i)).toBeInTheDocument());
    expect(screen.queryByText(/recently saved by friends/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/recently shared by friends/i)).not.toBeInTheDocument();
  });

  it("does NOT render Editor's Picks or Trending in Health & Nutrition (those moved to Discover)", async () => {
    mockFetch([
      ['/friends/activity', { activity: [{ id: 1, type: 'friend_saved_recipe', friendName: 'Henny', recipe: { id: 'r1', title: 'Beef Stew' }, createdAt: new Date().toISOString() }] }],
      ['/friends/recently-saved', { items: [] }],
      ['/friends/recently-shared', { items: [] }],
    ]);
    render(<FriendSections accessToken="t" onOpenRecipe={noop} onSaveRecipe={noop} />);
    await waitFor(() => expect(screen.getByText(/^Friend Activity$/i)).toBeInTheDocument());
    expect(screen.queryByText(/editor's picks/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/trending in health & nutrition/i)).not.toBeInTheDocument();
  });

  it('hides "From your friends" entirely when there is no activity', async () => {
    mockFetch([
      ['/friends/activity', { activity: [] }],
      ['/friends/recently-saved', { items: [] }],
      ['/friends/recently-shared', { items: [] }],
    ]);
    render(<FriendSections accessToken="t" onOpenRecipe={noop} onSaveRecipe={noop} />);
    // Wait a frame for the loaded state to settle, then assert absence
    await waitFor(() => expect(screen.queryByText(/^Friend Activity$/i)).not.toBeInTheDocument());
  });
});
