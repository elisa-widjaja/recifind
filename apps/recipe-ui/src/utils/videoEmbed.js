import { useEffect, useState } from 'react';

// ─── TikTok ───────────────────────────────────────────────────────────────────

export function extractTikTokVideoId(url) {
  if (!url) return null;
  const match = url.match(/\/video\/(\d+)/);
  return match ? match[1] : null;
}

// ─── YouTube ──────────────────────────────────────────────────────────────────

export function extractYouTubeVideoId(url) {
  if (!url) return null;
  const patterns = [
    /[?&]v=([^&#]+)/,          // youtube.com/watch?v=ID
    /youtu\.be\/([^?&#]+)/,    // youtu.be/ID
    /\/shorts\/([^?&#]+)/,     // youtube.com/shorts/ID
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

// ─── Embed URL ────────────────────────────────────────────────────────────────

/**
 * Returns an autoplay-muted embed URL for TikTok or YouTube, or null for
 * any other platform (including Instagram, which blocks iframing).
 */
export function buildVideoEmbedUrl(sourceUrl) {
  if (!sourceUrl) return null;

  if (sourceUrl.includes('tiktok.com')) {
    const id = extractTikTokVideoId(sourceUrl);
    return id
      ? `https://www.tiktok.com/embed/v2/${id}?autoplay=1&muted=1`
      : null;
  }

  if (sourceUrl.includes('youtube.com') || sourceUrl.includes('youtu.be')) {
    const id = extractYouTubeVideoId(sourceUrl);
    return id
      ? `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&loop=1&playlist=${id}`
      : null;
  }

  return null;
}

// ─── Duration formatting ──────────────────────────────────────────────────────

/**
 * Formats a duration in minutes to a human-readable string.
 * Returns null for falsy or zero values — callers guard with `durationMinutes > 0`.
 */
export function formatDuration(minutes) {
  if (!minutes || minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
}

// ─── useInView hook ───────────────────────────────────────────────────────────

/**
 * Observes `ref.current` with IntersectionObserver.
 * Returns inView: boolean.
 * Disconnects on unmount.
 */
export function useInView(ref, threshold = 0.4) {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, threshold]);

  return inView;
}
