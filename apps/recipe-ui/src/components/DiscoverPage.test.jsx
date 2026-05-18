import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
});
