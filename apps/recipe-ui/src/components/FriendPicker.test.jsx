import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FriendPicker } from './FriendPicker';

const FRIENDS = [
  { id: 'f1', display_name: 'Alice', avatar_url: null },
  { id: 'f2', display_name: 'Bob', avatar_url: null },
  { id: 'f3', display_name: 'Carol', avatar_url: null },
];

describe('FriendPicker', () => {
  it('renders each friend as a selectable row', () => {
    render(<FriendPicker open friends={FRIENDS} onClose={() => {}} onSend={() => {}} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Carol')).toBeInTheDocument();
  });

  it('Send button is disabled when nothing is selected', () => {
    render(<FriendPicker open friends={FRIENDS} onClose={() => {}} onSend={() => {}} />);
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });

  it('selecting a friend enables Send and passes ids to onSend', async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true, value: { shared_with: 2, skipped: 0 } });
    render(<FriendPicker open friends={FRIENDS} onClose={() => {}} onSend={onSend} />);
    fireEvent.click(screen.getByText('Alice'));
    fireEvent.click(screen.getByText('Bob'));
    const sendBtn = screen.getByRole('button', { name: /send/i });
    expect(sendBtn).not.toBeDisabled();
    fireEvent.click(sendBtn);
    await waitFor(() => expect(onSend).toHaveBeenCalledWith(['f1', 'f2']));
  });

  it('shows success toast-like message after Send', async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true, value: { shared_with: 1, skipped: 0 } });
    render(<FriendPicker open friends={FRIENDS} onClose={() => {}} onSend={onSend} />);
    fireEvent.click(screen.getByText('Alice'));
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByText(/shared with 1 friend/i)).toBeInTheDocument());
  });

  it('shows rate-limit error after 429', async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: false, error: { code: 'RATE_LIMITED', retry_after_seconds: 600 } });
    render(<FriendPicker open friends={FRIENDS} onClose={() => {}} onSend={onSend} />);
    fireEvent.click(screen.getByText('Alice'));
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByText(/try again/i)).toBeInTheDocument());
  });

  it('empty friend list shows zero state with copy-link fallback', () => {
    render(<FriendPicker open friends={[]} onClose={() => {}} onSend={() => {}} />);
    expect(screen.getByText(/you don't have friends yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();
  });

  it('shows a checkmark badge on the selected friend\'s avatar', () => {
    render(<FriendPicker open friends={FRIENDS} onClose={() => {}} onSend={() => {}} />);
    fireEvent.click(screen.getByText('Alice'));
    const aliceRow = screen.getByText('Alice').closest('[data-testid="friend-row"]');
    expect(aliceRow).toHaveAttribute('data-selected', 'true');
    const bobRow = screen.getByText('Bob').closest('[data-testid="friend-row"]');
    expect(bobRow).toHaveAttribute('data-selected', 'false');
  });
});
