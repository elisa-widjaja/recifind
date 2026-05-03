import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import PublicLanding from './PublicLanding';

describe('PublicLanding (trimmed)', () => {
  beforeEach(() => {
    // jsdom doesn't ship IntersectionObserver — PublicLanding uses it for FAB visibility.
    global.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    global.fetch = vi.fn((url) => {
      if (url.includes('/public/trending-recipes')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ recipes: [{ id: 't1', title: 'Miso' }] }) });
      if (url.includes('/public/discover')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ recipes: [{ id: 'd1', title: 'Reel', sourceUrl: 'https://www.tiktok.com/@x/video/1' }] }) });
      if (url.includes('/public/editors-pick')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ recipes: [{ id: 'e1', title: 'Editor' }] }) });
      if (url.includes('/public/ai-picks')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ picks: [{ topic: 'X', recipes: [] }] }) });
      return Promise.resolve({ ok: false });
    });
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("does NOT render Editor's Picks (members-only on Discover)", async () => {
    render(<PublicLanding onJoin={() => {}} onOpenRecipe={() => {}} />);
    await waitFor(() => expect(screen.getByText(/trending now/i)).toBeInTheDocument());
    expect(screen.queryByText(/editor's picks/i)).not.toBeInTheDocument();
  });

  it('does NOT render Trending in Health & Nutrition (members-only on Discover)', async () => {
    render(<PublicLanding onJoin={() => {}} onOpenRecipe={() => {}} />);
    await waitFor(() => expect(screen.getByText(/trending now/i)).toBeInTheDocument());
    expect(screen.queryByText(/trending in health & nutrition/i)).not.toBeInTheDocument();
  });

  it('still renders the two retained shelves', async () => {
    render(<PublicLanding onJoin={() => {}} onOpenRecipe={() => {}} />);
    await waitFor(() => expect(screen.getByText(/trending now/i)).toBeInTheDocument());
    expect(screen.getByText(/discover new recipes/i)).toBeInTheDocument();
  });
});
