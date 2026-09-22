import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WhatsNewCarousel from './WhatsNewCarousel';

const tips = [
  { id: 'discover-search', title: 'Search community recipes', body: 'Search by dish, tag or creator.', action: 'discover' },
  { id: 'friends-of-friends', title: "See your friends' friends", body: 'Open a friend and tap Friends.', action: 'friends' },
  { id: 'custom-tags', title: 'Organize with custom tags', body: 'Add your own tags.', action: 'recipes' },
];

// jsdom has no media playback; stub it so the play/pause wiring can be asserted.
// Clips load via fetch -> blob URL; by default the download fails here, which
// exercises the fallback to the plain asset URL.
beforeEach(() => {
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  HTMLMediaElement.prototype.pause = vi.fn();
  global.fetch = vi.fn(() => Promise.reject(new Error('offline')));
});

describe('WhatsNewCarousel', () => {
  it('does not render contents when closed', () => {
    render(<WhatsNewCarousel open={false} tips={tips} onTry={() => {}} onClose={() => {}} />);
    expect(screen.queryByText(tips[0].title)).not.toBeInTheDocument();
  });

  it('renders one card per tip, each with its clip or screenshot', () => {
    render(<WhatsNewCarousel open tips={tips} onTry={() => {}} onClose={() => {}} />);
    expect(screen.getByText('Top tips')).toBeInTheDocument();
    for (const tip of tips) {
      expect(screen.getByText(tip.title)).toBeInTheDocument();
      expect(screen.getByText(tip.body)).toBeInTheDocument();
    }
    // Discover and tags are muted, looping, inline clips; friends is a still.
    for (const tip of [tips[0], tips[2]]) {
      const clip = screen.getByLabelText(tip.title);
      expect(clip.tagName).toBe('VIDEO');
      expect(clip.muted).toBe(true);
      expect(clip.loop).toBe(true);
      expect(clip).toHaveAttribute('playsinline');
      expect(clip).toHaveAttribute('poster');
    }
    expect(screen.getByRole('img', { name: tips[1].title })).toBeInTheDocument();
    // No per-tip "Try it" link in the carousel (v1 list keeps it).
    expect(screen.queryByRole('button', { name: /try it/i })).not.toBeInTheDocument();
  });

  it('shows a dot per card and marks the first as current', () => {
    render(<WhatsNewCarousel open tips={tips} onTry={() => {}} onClose={() => {}} />);
    const dots = screen.getAllByRole('button', { name: /go to tip/i });
    expect(dots).toHaveLength(tips.length);
    expect(dots[0]).toHaveAttribute('aria-current', 'true');
    expect(dots[1]).not.toHaveAttribute('aria-current');
  });

  it('"Next" advances through the cards, then becomes "Got it" and closes', () => {
    const onClose = vi.fn();
    render(<WhatsNewCarousel open tips={tips} onTry={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getAllByRole('button', { name: /go to tip/i })[1]).toHaveAttribute('aria-current', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('plays only the visible card\'s clip, restarting it when its card comes into view', async () => {
    render(<WhatsNewCarousel open tips={tips} onTry={() => {}} onClose={() => {}} />);
    const discover = screen.getByLabelText(tips[0].title);
    const tags = screen.getByLabelText(tips[2].title);
    const playedBy = () => HTMLMediaElement.prototype.play.mock.instances;
    // Nothing plays until the clip has a source.
    expect(playedBy()).toEqual([]);
    await waitFor(() => expect(playedBy()).toEqual([discover]));
    await waitFor(() => expect(tags).toHaveAttribute('src'));

    fireEvent.click(screen.getAllByRole('button', { name: /go to tip/i })[2]);
    expect(playedBy()).toEqual([discover, tags]);
    expect(HTMLMediaElement.prototype.pause.mock.instances).toContain(discover);
  });

  it('plays clips from a blob URL so hosts without byte-range support still work on iOS', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['x'], { type: 'video/mp4' })) }));
    const created = [];
    URL.createObjectURL = vi.fn(() => { const u = `blob:clip-${created.length}`; created.push(u); return u; });
    URL.revokeObjectURL = vi.fn();
    const { unmount } = render(<WhatsNewCarousel open tips={tips} onTry={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText(tips[0].title).getAttribute('src')).toMatch(/^blob:clip-/));
    await waitFor(() => expect(screen.getByLabelText(tips[2].title).getAttribute('src')).toMatch(/^blob:clip-/));
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('falls back to the plain asset URL when the download fails', async () => {
    render(<WhatsNewCarousel open tips={tips} onTry={() => {}} onClose={() => {}} />);
    const discover = screen.getByLabelText(tips[0].title);
    await waitFor(() => expect(discover).toHaveAttribute('src'));
    expect(discover.getAttribute('src')).not.toMatch(/^blob:/);
  });

  it('tapping a dot jumps to that card', () => {
    render(<WhatsNewCarousel open tips={tips} onTry={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getAllByRole('button', { name: /go to tip/i })[2]);
    expect(screen.getByRole('button', { name: 'Got it' })).toBeInTheDocument();
  });

  it('the close button calls onClose', () => {
    const onClose = vi.fn();
    render(<WhatsNewCarousel open tips={tips} onTry={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
