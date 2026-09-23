import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import DiscoverPage from './DiscoverPage';

describe('DiscoverPage', () => {
  beforeEach(() => {
    global.fetch = vi.fn((url, opts) => {
      if (url.includes('/recipes/picked-for-you')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({
          eligible: true, reason: 'Based on your Korean saves',
          recipes: [{ id: 'p1', title: 'Gochujang Chicken' }, { id: 'p2', title: 'Kimchi Fried Rice' }],
        }) });
      }
      if (url.includes('/public/trending-recipes')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ recipes: [{ id: 't1', title: 'Miso Ramen' }] }) });
      }
      if (url.includes('/public/discover')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ recipes: [{ id: 'd1', title: 'Tacos Reel', sourceUrl: 'https://www.tiktok.com/@x/video/1' }] }) });
      }
      if (url.includes('/public/editors-pick')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ recipes: [{ id: 'e1', title: 'Editor Pasta' }] }) });
      }
      if (url.includes('/public/ai-picks')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ picks: [{ topic: 'GutHealth', reason: 'Probiotics', recipes: [{ id: 'a1', title: 'Kimchi Rice' }] }] }) });
      }
      if (url.includes('/public/search')) {
        const q = new URL(url, 'http://x').searchParams.get('q') || '';
        if (q === 'nomatch') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ recipes: [] }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ recipes: [{ id: 's1', title: 'Garlic Chicken', imageUrl: 'https://img/x.jpg' }] }) });
      }
      return Promise.resolve({ ok: false });
    });
  });

  afterEach(() => { vi.restoreAllMocks(); });

  const noop = () => {};

  it('renders the retained section headers (Trending Now removed)', async () => {
    render(<DiscoverPage onOpenRecipe={noop} onSaveRecipe={noop} onShareRecipe={noop} />);
    await waitFor(() => expect(screen.getByText(/from the community/i)).toBeInTheDocument());
    expect(screen.getByText(/editor's picks/i)).toBeInTheDocument();
    expect(screen.getByText(/trending in health & nutrition/i)).toBeInTheDocument();
    // "Trending Now" shelf was removed from the Discover tab.
    expect(screen.queryByText(/^trending now$/i)).not.toBeInTheDocument();
  });

  it('fetches all four discovery endpoints on mount', async () => {
    render(<DiscoverPage onOpenRecipe={noop} onSaveRecipe={noop} onShareRecipe={noop} />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/public/trending-recipes'));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/public/discover'));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/public/editors-pick'));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/public/ai-picks'));
    });
  });

  it('shows a search box and, when typing >=2 chars, replaces shelves with results', async () => {
    render(<DiscoverPage onOpenRecipe={noop} onSaveRecipe={noop} onShareRecipe={noop} />);
    await waitFor(() => expect(screen.getByText(/from the community/i)).toBeInTheDocument());

    const input = screen.getByPlaceholderText(/search recipes/i);
    fireEvent.change(input, { target: { value: 'chicken' } });

    // result appears
    await waitFor(() => expect(screen.getByText('Garlic Chicken')).toBeInTheDocument());
    // shelves are hidden while searching
    expect(screen.queryByText(/from the community/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/editor's picks/i)).not.toBeInTheDocument();
  });

  it('does not search for queries under 2 chars', async () => {
    render(<DiscoverPage onOpenRecipe={noop} onSaveRecipe={noop} onShareRecipe={noop} />);
    await waitFor(() => expect(screen.getByText(/from the community/i)).toBeInTheDocument());

    const input = screen.getByPlaceholderText(/search recipes/i);
    fireEvent.change(input, { target: { value: 'a' } });

    await waitFor(() => {
      expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/public/search'));
    });
    // shelves still shown
    expect(screen.getByText(/from the community/i)).toBeInTheDocument();
  });

  it('shows a no-results message when the search returns nothing', async () => {
    render(<DiscoverPage onOpenRecipe={noop} onSaveRecipe={noop} onShareRecipe={noop} />);
    await waitFor(() => expect(screen.getByText(/from the community/i)).toBeInTheDocument());

    const input = screen.getByPlaceholderText(/search recipes/i);
    fireEvent.change(input, { target: { value: 'nomatch' } });

    await waitFor(() => expect(screen.getByText(/no recipes found/i)).toBeInTheDocument());
  });

  it('clearing the search box restores the shelves', async () => {
    render(<DiscoverPage onOpenRecipe={noop} onSaveRecipe={noop} onShareRecipe={noop} />);
    await waitFor(() => expect(screen.getByText(/from the community/i)).toBeInTheDocument());

    const input = screen.getByPlaceholderText(/search recipes/i);
    fireEvent.change(input, { target: { value: 'chicken' } });
    await waitFor(() => expect(screen.getByText('Garlic Chicken')).toBeInTheDocument());

    fireEvent.change(input, { target: { value: '' } });
    await waitFor(() => expect(screen.getByText(/from the community/i)).toBeInTheDocument());
  });

  it('signed in: renders Picked for you above Editor\'s Picks with the reason line', async () => {
    render(<DiscoverPage accessToken="tok" savedCount={8} onOpenRecipe={noop} onSaveRecipe={noop} onShareRecipe={noop} />);
    await waitFor(() => expect(screen.getByText(/picked for you/i)).toBeInTheDocument());
    expect(screen.getByText('Based on your Korean saves')).toBeInTheDocument();
    expect(screen.getByText('Gochujang Chicken')).toBeInTheDocument();
    const picked = screen.getByText(/picked for you/i);
    const editors = screen.getByText(/editor's picks/i);
    // DOCUMENT_POSITION_FOLLOWING (4): editors comes after picked
    expect(picked.compareDocumentPosition(editors) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/recipes/picked-for-you'),
      expect.objectContaining({ headers: { Authorization: 'Bearer tok' } }),
    );
  });

  it('does not flash the shelf back to a skeleton on a token refresh once loaded', async () => {
    const { rerender } = render(
      <DiscoverPage accessToken="tok1" savedCount={8} onOpenRecipe={noop} onSaveRecipe={noop} onShareRecipe={noop} />
    );
    await waitFor(() => expect(screen.getByText('Gochujang Chicken')).toBeInTheDocument());

    // Refreshed token triggers a refetch that never resolves during this
    // assertion window (simulates the in-flight state right after rerender).
    global.fetch.mockImplementation((url) => {
      if (url.includes('/recipes/picked-for-you')) return new Promise(() => {});
      if (url.includes('/public/editors-pick')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ recipes: [{ id: 'e1', title: 'Editor Pasta' }] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ recipes: [], picks: [] }) });
    });

    rerender(<DiscoverPage accessToken="tok2" savedCount={8} onOpenRecipe={noop} onSaveRecipe={noop} onShareRecipe={noop} />);

    expect(screen.getByText(/picked for you/i)).toBeInTheDocument();
    expect(screen.getByText('Based on your Korean saves')).toBeInTheDocument();
    expect(screen.getByText('Gochujang Chicken')).toBeInTheDocument();
    expect(screen.getByText('Kimchi Fried Rice')).toBeInTheDocument();
  });

  it('signed out: no Picked for you shelf and no request to the route', async () => {
    render(<DiscoverPage onOpenRecipe={noop} onSaveRecipe={noop} onShareRecipe={noop} />);
    await waitFor(() => expect(screen.getByText(/editor's picks/i)).toBeInTheDocument());
    expect(screen.queryByText(/picked for you/i)).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/recipes/picked-for-you'), expect.anything());
  });

  it('signed in but ineligible: shelf stays hidden', async () => {
    global.fetch.mockImplementation((url, opts) => {
      if (url.includes('/recipes/picked-for-you')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ eligible: false, reason: null, recipes: [] }) });
      }
      if (url.includes('/public/editors-pick')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ recipes: [{ id: 'e1', title: 'Editor Pasta' }] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ recipes: [], picks: [] }) });
    });
    render(<DiscoverPage accessToken="tok" savedCount={3} onOpenRecipe={noop} onSaveRecipe={noop} onShareRecipe={noop} />);
    await waitFor(() => expect(screen.getByText(/editor's picks/i)).toBeInTheDocument());
    expect(screen.queryByText(/picked for you/i)).not.toBeInTheDocument();
  });

  it('shows the shelf skeleton while loading only when savedCount >= 5', () => {
    // Never-resolving fetch keeps every section in its loading state.
    global.fetch.mockImplementation(() => new Promise(() => {}));
    const { unmount } = render(<DiscoverPage accessToken="tok" savedCount={5} onOpenRecipe={noop} onSaveRecipe={noop} onShareRecipe={noop} />);
    expect(screen.getByText(/picked for you/i)).toBeInTheDocument();
    unmount();
    render(<DiscoverPage accessToken="tok" savedCount={4} onOpenRecipe={noop} onSaveRecipe={noop} onShareRecipe={noop} />);
    expect(screen.queryByText(/picked for you/i)).not.toBeInTheDocument();
  });

  it('hides the shelf when the route fails (expired token)', async () => {
    global.fetch.mockImplementation((url) => {
      if (url.includes('/recipes/picked-for-you')) return Promise.resolve({ ok: false, status: 401 });
      if (url.includes('/public/editors-pick')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ recipes: [{ id: 'e1', title: 'Editor Pasta' }] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ recipes: [], picks: [] }) });
    });
    render(<DiscoverPage accessToken="tok" savedCount={8} onOpenRecipe={noop} onSaveRecipe={noop} onShareRecipe={noop} />);
    await waitFor(() => expect(screen.getByText('Editor Pasta')).toBeInTheDocument());
    expect(screen.queryByText(/picked for you/i)).not.toBeInTheDocument();
  });
});
