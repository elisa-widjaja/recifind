import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActivityItem } from './FriendSections';

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
  it('renders the friend_request row with the message', () => {
    render(
      <ActivityItem
        item={FRIEND_REQUEST_ITEM}
        onOpenFriendRequest={vi.fn()}
      />
    );
    expect(screen.getByText('Jules sent you a friend request')).toBeInTheDocument();
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
    expect(screen.getByText('Jules sent you a friend request')).toBeInTheDocument();
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
    // Clicking the row (if user tries to) must NOT fire onOpenFriendRequest
    fireEvent.click(screen.getByText('Jules sent you a friend request'));
    expect(onOpen).not.toHaveBeenCalled();
  });
});
