import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SuggestionsShelf from './SuggestionsShelf';

const SUGGESTIONS = [
  { userId: 'u1', name: 'Maya R.', kind: 'fof', mutualCount: 2 },
  { userId: 'u2', name: 'James T.', kind: 'fof', mutualCount: 1 },
  { userId: 'u3', name: 'Priya S.', kind: 'pref', sharedPref: 'Vegetarian' },
];

describe('SuggestionsShelf', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders one card per suggestion with name and reason text', () => {
    render(<SuggestionsShelf accessToken="t" suggestions={SUGGESTIONS} />);
    expect(screen.getByText('Maya R.')).toBeInTheDocument();
    expect(screen.getByText('2 mutual friends')).toBeInTheDocument();
    expect(screen.getByText('James T.')).toBeInTheDocument();
    expect(screen.getByText('1 mutual friend')).toBeInTheDocument();
    expect(screen.getByText('Priya S.')).toBeInTheDocument();
    expect(screen.getByText('Also into Vegetarian')).toBeInTheDocument();
  });

  it('renders "Friends You May Know" header and "See all" when onOpenFriends is provided', () => {
    const onOpenFriends = vi.fn();
    render(
      <SuggestionsShelf accessToken="t" suggestions={SUGGESTIONS} onOpenFriends={onOpenFriends} />
    );
    expect(screen.getByText('Friends You May Know')).toBeInTheDocument();
    const seeAll = screen.getByText('See all');
    fireEvent.click(seeAll);
    expect(onOpenFriends).toHaveBeenCalledTimes(1);
  });

  it('hides "See all" when onOpenFriends is not provided', () => {
    render(<SuggestionsShelf accessToken="t" suggestions={SUGGESTIONS} />);
    expect(screen.queryByText('See all')).not.toBeInTheDocument();
  });

  it('renders nothing when suggestions list is empty', () => {
    const { container } = render(<SuggestionsShelf accessToken="t" suggestions={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('Add friend button flips to Requested (optimistic) and calls POST /friends/request', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 });
    render(<SuggestionsShelf accessToken="tok" suggestions={SUGGESTIONS} />);
    const addButtons = screen.getAllByRole('button', { name: /add friend/i });
    fireEvent.click(addButtons[0]);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /requested/i })[0]).toBeDisabled()
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/friends/request'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
        body: JSON.stringify({ userId: 'u1' }),
      })
    );
  });

  it('keeps Requested state on 4xx (e.g. already friends)', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 409 });
    render(<SuggestionsShelf accessToken="t" suggestions={SUGGESTIONS} />);
    fireEvent.click(screen.getAllByRole('button', { name: /add friend/i })[0]);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /requested/i })[0]).toBeDisabled()
    );
  });

  it('reverts Requested to Add friend on 5xx', async () => {
    // Use a controlled promise so we can assert the optimistic state
    // synchronously before the fetch resolves.
    let resolveFetch;
    global.fetch.mockReturnValueOnce(new Promise(r => { resolveFetch = r; }));
    render(<SuggestionsShelf accessToken="t" suggestions={SUGGESTIONS} />);
    fireEvent.click(screen.getAllByRole('button', { name: /add friend/i })[0]);
    // Optimistic flip happens synchronously on click
    expect(screen.getAllByRole('button', { name: /requested/i })[0]).toBeInTheDocument();
    // Now resolve with 5xx → should revert
    resolveFetch({ ok: false, status: 503 });
    await waitFor(() => {
      expect(screen.queryAllByRole('button', { name: /requested/i })).toHaveLength(0);
    });
  });

  it('dismiss button removes the card from view', () => {
    render(<SuggestionsShelf accessToken="t" suggestions={SUGGESTIONS} />);
    expect(screen.getByText('Maya R.')).toBeInTheDocument();
    const dismissButtons = screen.getAllByRole('button', { name: /dismiss/i });
    fireEvent.click(dismissButtons[0]);
    expect(screen.queryByText('Maya R.')).not.toBeInTheDocument();
    // Other cards still there
    expect(screen.getByText('James T.')).toBeInTheDocument();
  });

  it('unmounts entirely after dismissing all cards', () => {
    const { container } = render(<SuggestionsShelf accessToken="t" suggestions={[SUGGESTIONS[0]]} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(container.firstChild).toBeNull();
  });

  it('fetches /friends/suggestions on mount with Authorization header and renders results', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ suggestions: SUGGESTIONS }),
    });
    render(<SuggestionsShelf accessToken="tok" />);
    await screen.findByText('Maya R.');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/friends/suggestions'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
      })
    );
  });

  it('renders nothing when the fetch fails (non-ok response)', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => null });
    const { container } = render(<SuggestionsShelf accessToken="tok" />);
    // Wait a tick for the effect + then-chain to settle
    await waitFor(() => expect(container.firstChild).toBeNull());
  });
});
