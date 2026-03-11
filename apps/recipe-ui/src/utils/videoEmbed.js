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

// ─── Video thumbnail URL ──────────────────────────────────────────────────────

/**
 * Returns a reliable thumbnail URL for YouTube videos using YouTube's
 * public image CDN. Returns null for TikTok/Instagram (no public thumbnail API).
 */
export function getVideoThumbnailUrl(sourceUrl) {
  if (!sourceUrl) return null;
  if (sourceUrl.includes('youtube.com') || sourceUrl.includes('youtu.be')) {
    const id = extractYouTubeVideoId(sourceUrl);
    return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
  }
  return null;
}

// ─── Duration formatting ──────────────────────────────────────────────────────

/**
 * Formats a duration in minutes to a human-readable string.
 * e.g. 45 → "45 min", 90 → "1 hr 30 min", 120 → "2 hr"
 * Callers should guard with `durationMinutes > 0` before calling — passing 0 returns "0 min".
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
 * When once=true (default), stays inView=true permanently after first intersection.
 * When once=false, inView follows intersection state (reverts to false when out of view).
 * Disconnects on unmount.
 */
export function useInView(ref, { threshold = 0.4, once = true } = {}) {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) observer.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, threshold, once]);

  return inView;
}
