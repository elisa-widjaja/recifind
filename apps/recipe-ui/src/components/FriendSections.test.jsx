import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  it('renders Accept and Decline buttons for a friend_request item with fromUserId', () => {
    render(
      <ActivityItem
        item={FRIEND_REQUEST_ITEM}
        onAcceptFriendRequest={vi.fn()}
        onDeclineFriendRequest={vi.fn()}
        onResolveRequest={vi.fn()}
      />
    );
    expect(screen.getByText('Jules sent you a friend request')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /accept friend request/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /decline friend request/i })).toBeInTheDocument();
  });

  it('calls onAcceptFriendRequest with fromUserId when Accept is tapped', async () => {
    const onAccept = vi.fn().mockResolvedValue(undefined);
    const onResolve = vi.fn();
    render(
      <ActivityItem
        item={FRIEND_REQUEST_ITEM}
        onAcceptFriendRequest={onAccept}
        onDeclineFriendRequest={vi.fn()}
        onResolveRequest={onResolve}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /accept friend request/i }));
    await waitFor(() => expect(onAccept).toHaveBeenCalledWith('user-jules'));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(101));
  });

  it('calls onDeclineFriendRequest with fromUserId when Decline is tapped', async () => {
    const onDecline = vi.fn().mockResolvedValue(undefined);
    const onResolve = vi.fn();
    render(
      <ActivityItem
        item={FRIEND_REQUEST_ITEM}
        onAcceptFriendRequest={vi.fn()}
        onDeclineFriendRequest={onDecline}
        onResolveRequest={onResolve}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /decline friend request/i }));
    await waitFor(() => expect(onDecline).toHaveBeenCalledWith('user-jules'));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(101));
  });

  it('disables buttons while the accept request is in flight', async () => {
    let resolveAccept;
    const onAccept = vi.fn().mockReturnValue(new Promise((r) => { resolveAccept = r; }));
    render(
      <ActivityItem
        item={FRIEND_REQUEST_ITEM}
        onAcceptFriendRequest={onAccept}
        onDeclineFriendRequest={vi.fn()}
        onResolveRequest={vi.fn()}
      />
    );
    const acceptBtn = screen.getByRole('button', { name: /accept friend request/i });
    const declineBtn = screen.getByRole('button', { name: /decline friend request/i });
    fireEvent.click(acceptBtn);
    await waitFor(() => expect(acceptBtn).toBeDisabled());
    expect(declineBtn).toBeDisabled();
    resolveAccept();
    await waitFor(() => expect(acceptBtn).not.toBeDisabled());
  });

  it('hides Accept/Decline buttons when fromUserId is missing (stale payload)', () => {
    const staleItem = { ...FRIEND_REQUEST_ITEM, fromUserId: undefined };
    render(
      <ActivityItem
        item={staleItem}
        onAcceptFriendRequest={vi.fn()}
        onDeclineFriendRequest={vi.fn()}
        onResolveRequest={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /accept friend request/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /decline friend request/i })).not.toBeInTheDocument();
    // Still displays the message so the user isn't left staring at a blank row
    expect(screen.getByText('Jules sent you a friend request')).toBeInTheDocument();
  });
});
