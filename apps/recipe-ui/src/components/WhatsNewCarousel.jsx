import { useEffect, useRef, useState } from 'react';
import { Drawer, Box, Button, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import discoverClip from '../assets/whats-new/discover.mp4';
import discoverPoster from '../assets/whats-new/discover.webp';
import friendsShot from '../assets/whats-new/friends.webp';
import tagsClip from '../assets/whats-new/tags.mp4';
import tagsPoster from '../assets/whats-new/tags.webp';

// Media per tip id (lib/whatsNew.js), all 9:16 portrait (540x960), light-mode.
// - Clips are screen recordings with the status bar (recording dot + Dynamic
//   Island) cropped off and no audio; the tags clip plays at 1.75x. `poster`
//   is each clip's first frame, shown until the clip loads.
// - The friends shot is a rendered mock with made-up names, not a real capture,
//   so no real user's name or photo ships in the app.
const TIP_MEDIA = {
  'discover-search': { video: discoverClip, poster: discoverPoster },
  'friends-of-friends': { image: friendsShot },
  'custom-tags': { video: tagsClip, poster: tagsPoster },
};

// Sheet title. Copy rule: no em dashes.
const HEADER_TITLE = 'Top tips';

const prefersReducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

// v2 of the one-time "What's new" sheet: one swipeable card per tip, each led by
// a screenshot, with no per-tip "Try it" link (v1 has one). Same props as
// WhatsNewSheet (v1) so App.jsx can swap them via WHATS_NEW.variant; `onTry` is
// accepted but unused here. Swiping is native CSS scroll snap; `index` follows the
// scroll position and drives the dots and the Next / Got it button.
// Copy rule: no em dashes.
export default function WhatsNewCarousel({ open, tips, onTry, onClose, darkMode = false }) {
  const [index, setIndex] = useState(0);
  const trackRef = useRef(null);
  // While a Next/dot scroll animates, scroll events report in-between positions.
  // Ignore them so the dots and button don't flicker back.
  const programmaticUntilRef = useRef(0);
  const videoRefs = useRef({});
  const reducedMotion = prefersReducedMotion();
  // Clip sources by tip id. Each small clip is downloaded whole and played from
  // a blob: URL, because iOS Safari refuses to play a video whose host ignores
  // byte-range requests (Cloudflare *.pages.dev previews do; a cold cache can
  // too). If the download fails, fall back to the plain asset URL.
  const [clipUrls, setClipUrls] = useState({});
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    const created = [];
    tips.forEach((tip) => {
      const clip = TIP_MEDIA[tip.id]?.video;
      if (!clip) return;
      fetch(clip)
        .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          created.push(url);
          return url;
        })
        .catch(() => clip)
        .then((url) => { if (!cancelled) setClipUrls((prev) => ({ ...prev, [tip.id]: url })); });
    });
    return () => {
      cancelled = true;
      created.forEach((url) => URL.revokeObjectURL(url));
      setClipUrls({});
    };
  }, [open, tips]);
  const isLast = index >= tips.length - 1;

  // Only the visible card's clip plays, from the start each time it comes into
  // view. With reduced motion nothing autoplays; the clip gets controls instead.
  const syncClip = (video, i) => {
    if (!video) return;
    if (!video.getAttribute('src')) return; // clip still downloading: poster shows
    if (open && i === index && !reducedMotion) {
      try { video.currentTime = 0; } catch { /* not seekable yet */ }
      const playing = video.play?.();
      playing?.catch?.(() => {}); // autoplay refused: the poster stays up
    } else {
      video.pause?.();
    }
  };

  useEffect(() => {
    tips.forEach((tip, i) => syncClip(videoRefs.current[tip.id], i));
  }, [open, index, tips, reducedMotion, clipUrls]);

  // The Drawer mounts its content after this component's first effect has run,
  // so the effect above finds no clips on open. Sync each clip as it mounts too.
  // React re-invokes an inline ref (null, then the element) on every render, so
  // null calls are ignored and only a genuinely new element triggers a sync.
  const registerClip = (tip, i) => (el) => {
    if (!el || videoRefs.current[tip.id] === el) return;
    videoRefs.current[tip.id] = el;
    syncClip(el, i);
  };

  // Start from the first card each time it opens.
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  const goTo = (i) => {
    const next = Math.max(0, Math.min(tips.length - 1, i));
    setIndex(next);
    const track = trackRef.current;
    // scrollTo is missing in jsdom; the index state alone drives the tests.
    if (track?.scrollTo) {
      programmaticUntilRef.current = Date.now() + 600;
      track.scrollTo({ left: next * track.clientWidth, behavior: 'smooth' });
    }
  };

  const handleScroll = (e) => {
    const { scrollLeft, clientWidth } = e.currentTarget;
    if (!clientWidth || Date.now() < programmaticUntilRef.current) return;
    const i = Math.round(scrollLeft / clientWidth);
    if (i !== index) setIndex(i);
  };

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      sx={{ zIndex: (t) => t.zIndex.modal + 1 }}
      PaperProps={{
        // Full-screen, square-cornered. The header clears the notch / Dynamic
        // Island and the button clears the home indicator.
        sx: {
          height: '100%',
          borderRadius: 0,
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          display: 'flex', flexDirection: 'column',
          ...(darkMode ? { backgroundColor: '#212328', backgroundImage: 'none' } : {}),
        },
      }}
    >
      <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', px: '24px', pt: '26px', pb: '12px', flexShrink: 0 }}>
        <Box sx={{ position: 'absolute', left: '16px', top: '20px' }}>
          <Box
            component="button"
            aria-label="Close"
            onClick={onClose}
            sx={(theme) => ({
              width: 36, height: 36, borderRadius: '50%',
              bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
              color: '#8a8a8a',
              border: 'none', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              WebkitTapHighlightColor: 'transparent',
              transition: 'background-color 150ms ease, transform 150ms ease',
              '&:hover': { bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)' },
              '&:active': { transform: 'scale(0.92)' },
            })}
          >
            <CloseIcon sx={{ fontSize: 18 }} />
          </Box>
        </Box>
        <Typography sx={{ fontWeight: 700, fontSize: 16 }}>{HEADER_TITLE}</Typography>
      </Box>

      {/* Cards are centered in the space between the header and the button. */}
      <Box sx={{ width: '100%', maxWidth: 440, mx: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        <Box sx={{ my: 'auto' }}>
        <Box
          ref={trackRef}
          onScroll={handleScroll}
          sx={{
            display: 'flex',
            overflowX: 'auto',
            scrollSnapType: 'x mandatory',
            scrollbarWidth: 'none',
            '&::-webkit-scrollbar': { display: 'none' },
          }}
        >
          {tips.map((tip, i) => (
            <Box
              key={tip.id}
              sx={{ flex: '0 0 100%', minWidth: 0, scrollSnapAlign: 'center', scrollSnapStop: 'always', px: 2, pt: 0.5 }}
            >
              {/* Portrait phone frame, sized from the viewport height so the
                  button below stays on screen; width follows from the 9:16
                  ratio, so it's narrower on short phones. svh (small viewport)
                  keeps iOS Safari's toolbars out of the math. */}
              <Box
                sx={(theme) => ({
                  borderRadius: '14px', overflow: 'hidden', mx: 'auto',
                  border: '1px solid',
                  borderColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.10)',
                  bgcolor: '#fafafa',
                  aspectRatio: '9 / 16',
                  height: 'min(50vh, 468px)',
                  '@supports (height: 1svh)': { height: 'min(50svh, 468px)' },
                  maxWidth: '100%',
                })}
              >
                {(() => {
                  const media = TIP_MEDIA[tip.id] || {};
                  const mediaSx = {
                    display: 'block', width: '100%', height: '100%',
                    objectFit: 'cover', objectPosition: 'top',
                    WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none',
                  };
                  if (media.video) {
                    return (
                      <Box
                        component="video"
                        ref={registerClip(tip, i)}
                        src={clipUrls[tip.id]}
                        poster={media.poster}
                        aria-label={tip.title}
                        muted
                        loop
                        playsInline
                        preload="metadata"
                        controls={reducedMotion}
                        disablePictureInPicture
                        sx={mediaSx}
                      />
                    );
                  }
                  return <Box component="img" src={media.image} alt={tip.title} draggable={false} sx={mediaSx} />;
                })()}
              </Box>
              <Box sx={{ pt: 1.75, px: 0.5, textAlign: 'center' }}>
                <Typography sx={{ fontSize: 17, fontWeight: 700, lineHeight: 1.25 }}>{tip.title}</Typography>
                <Typography color="text.secondary" sx={{ fontSize: 14, lineHeight: 1.4, mt: 0.5, minHeight: '2.8em' }}>
                  {tip.body}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'center', gap: '2px', pt: 1 }}>
          {tips.map((tip, i) => (
            <Box
              key={tip.id}
              component="button"
              aria-label={`Go to tip ${i + 1}`}
              aria-current={i === index ? 'true' : undefined}
              onClick={() => goTo(i)}
              // 24px hit area around a small dot.
              sx={{
                width: 24, height: 24, p: 0, border: 'none', background: 'none', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <Box
                sx={(theme) => ({
                  height: 7, borderRadius: 999,
                  width: i === index ? 18 : 7,
                  transition: 'width 200ms ease, background-color 200ms ease',
                  bgcolor: i === index
                    ? (theme.palette.mode === 'dark' ? '#fff' : theme.palette.primary.main)
                    : (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.18)'),
                })}
              />
            </Box>
          ))}
        </Box>
        </Box>

        <Box sx={{ px: 2, pt: 1.5, pb: 5 }}>
          <Button variant="contained" fullWidth onClick={isLast ? onClose : () => goTo(index + 1)}>
            {isLast ? 'Got it' : 'Next'}
          </Button>
        </Box>
      </Box>
    </Drawer>
  );
}
