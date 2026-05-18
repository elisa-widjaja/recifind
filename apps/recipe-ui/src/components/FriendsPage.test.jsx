import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import FriendsPage from './FriendsPage';

describe('FriendsPage — My Friends tab', () => {
  it('renders friend names and wires avatarUrl onto the Avatar', () => {
    const { container } = render(
      <FriendsPage
        initialTab="connections"
        friends={[
          { friendId: 'f1', friendName: 'Mochimo', friendEmail: 'm@x.com', avatarUrl: 'https://img/a.jpg' },
          { friendId: 'f2', friendName: 'Henny', friendEmail: 'h@x.com', avatarUrl: null },
        ]}
      />
    );
    expect(screen.getByText('Mochimo')).toBeInTheDocument();
    expect(screen.getByText('Henny')).toBeInTheDocument();
    // Friend with a photo: the <img> carries the avatarUrl.
    expect(container.querySelector('img[src="https://img/a.jpg"]')).toBeTruthy();
    // Friend without a photo: colored-initial fallback (no stray img).
    expect(screen.getByText('H')).toBeInTheDocument();
  });
});

describe('FriendsPage — Pending tab name/email/privacy', () => {
  it('incoming request shows name + status but NOT the requester email (privacy)', () => {
    render(
      <FriendsPage
        initialTab="pending"
        pendingRequests={[
          { fromUserId: 'u1', fromName: 'Awo', fromEmail: 'awo@example.com', avatarUrl: null },
        ]}
      />
    );
    expect(screen.getByText('Awo')).toBeInTheDocument();
    expect(screen.getByText('wants to connect')).toBeInTheDocument();
    // Privacy: the requester's email must not be exposed pre-accept.
    expect(screen.queryByText('awo@example.com')).toBeNull();
  });

  it('sent request shows name + email + status', () => {
    render(
      <FriendsPage
        initialTab="pending"
        sentRequests={[
          { toUserId: 'u2', toName: 'Bree', toEmail: 'bree@example.com' },
        ]}
      />
    );
    expect(screen.getByText('Bree')).toBeInTheDocument();
    expect(screen.getByText('bree@example.com')).toBeInTheDocument();
    expect(screen.getByText('awaiting response')).toBeInTheDocument();
  });

  it('open invite shows the email + invite status (email is the only identifier)', () => {
    render(
      <FriendsPage
        initialTab="pending"
        sentInvites={[{ id: 'i1', toEmail: 'cara@example.com' }]}
      />
    );
    expect(screen.getByText('cara@example.com')).toBeInTheDocument();
    expect(screen.getByText('invite link not yet accepted')).toBeInTheDocument();
  });

  it('incoming with no display name shows the email once (as the title), not duplicated', () => {
    render(
      <FriendsPage
        initialTab="pending"
        pendingRequests={[{ fromUserId: 'u3', fromEmail: 'dan@example.com' }]}
      />
    );
    // No display name → email is the only identifier, shown as the title.
    expect(screen.getAllByText('dan@example.com')).toHaveLength(1);
    expect(screen.getByText('wants to connect')).toBeInTheDocument();
  });
});
