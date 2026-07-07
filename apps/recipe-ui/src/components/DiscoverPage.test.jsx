import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import DiscoverPage from './DiscoverPage';

describe('DiscoverPage', () => {
  beforeEach(() => {
    global.fetch = vi.fn((url) => {
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
    // the community shelf stays above the search bar; the lower shelves are replaced
    expect(screen.getByText(/from the community/i)).toBeInTheDocument();
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
});
