import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FriendsSheet from './FriendsSheet';

const baseProps = {
  open: true,
  onClose: vi.fn(),
  initialView: 'list',
  friends: [
    { userId: 'u1', name: 'Henny' },
    { userId: 'u2', name: 'Max' },
  ],
  pendingRequests: [],
  onAccept: vi.fn(),
  onDecline: vi.fn(),
  onSendInvite: vi.fn(),
};

describe('FriendsSheet', () => {
  it('renders nothing when open=false', () => {
    const { container } = render(<FriendsSheet {...baseProps} open={false} />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders the friends list with count when open', () => {
    render(<FriendsSheet {...baseProps} />);
    expect(screen.getByText(/friends · 2/i)).toBeInTheDocument();
    expect(screen.getByText('Henny')).toBeInTheDocument();
    expect(screen.getByText('Max')).toBeInTheDocument();
  });

  it('calls onClose when the X button is tapped', () => {
    const onClose = vi.fn();
    render(<FriendsSheet {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText(/close/i));
    expect(onClose).toHaveBeenCalled();
  });

  it('switches to Add view when + Add tab is clicked', () => {
    render(<FriendsSheet {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /\+ add/i }));
    expect(screen.getByPlaceholderText(/email/i)).toBeInTheDocument();
  });

  it('starts on Add view when initialView="add"', () => {
    render(<FriendsSheet {...baseProps} initialView="add" />);
    expect(screen.getByPlaceholderText(/email/i)).toBeInTheDocument();
  });

  it('renders pending requests with Accept and Decline buttons', () => {
    const pending = [{ id: 1, fromUserId: 'p1', friendName: 'James' }];
    render(<FriendsSheet {...baseProps} pendingRequests={pending} />);
    expect(screen.getByText('James')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /decline/i })).toBeInTheDocument();
  });
});
