import { useState, useEffect, useRef, cloneElement, isValidElement } from 'react';
import {
  Box, Container, Typography, Button, Stack, Fab
} from '@mui/material';
import { keyframes } from '@emotion/react';
import RecipeShelf from './RecipeShelf';
import DiscoverRecipes from './DiscoverRecipes';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { getVideoThumbnailUrl } from '../utils/videoEmbed';

const API_BASE_URL = import.meta.env.VITE_RECIPES_API_BASE_URL || '';


async function fetchJson(path) {
  const res = await fetch(`${API_BASE_URL}${path}`);
  if (!res.ok) return null;
  return res.json();
}

/**
 * Full logged-out landing page.
 * Props:
 *   onJoin: () => void           — opens auth dialog
 *   onOpenRecipe: (recipe) => void — opens recipe detail
 *   darkMode: boolean
 */
function isEmbeddable(url) {
  if (!url) return false;
  return url.includes('tiktok.com') || url.includes('youtube.com') || url.includes('youtu.be');
}

function SectionLabel({ emoji, label, inline = false }) {
  const el = (
    <Typography fontWeight={700} fontSize={13} sx={{ color: 'text.primary' }}>
      {emoji ? `${emoji} ` : ''}{label}
    </Typography>
  );
  if (inline) return el;
  return <Box sx={{ mb: '10px' }}>{el}</Box>;
}


// ── Shared card styles ──
const WHY_CARD_SX = {
  flexShrink: 0,
  // Slightly wider than before (was 280) to reduce how much of the next
  // card peeks at the right edge of the carousel.
  width: 'calc(85vw)',
  maxWidth: 308,
  scrollSnapAlign: 'start',
  borderRadius: 3,
  pt: 2.5,
  px: 1,
  pb: 0,
  // Stronger card definition so the cards lift off the page background:
  // a 1px tinted border + a soft drop shadow. Was a single light-divider
  // border that visually blended into the gradient background.
  border: '1px solid',
  borderColor: (theme) => theme.palette.mode === 'dark'
    ? 'rgba(255,255,255,0.10)'
    : 'rgba(0,0,0,0.08)',
  boxShadow: (theme) => theme.palette.mode === 'dark'
    ? '0 6px 18px rgba(0,0,0,0.45), 0 1px 3px rgba(255,255,255,0.04)'
    : '0 6px 18px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04)',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  // Hard-clamped (vs minHeight) because the carousel is a flex row — without
  // a fixed height the tallest card stretches its siblings. Sized so the
  // phone (110% scaled, pulled up 30px) sits flush with the card's bottom
  // edge: ~138px top content + 251px phone − 6px push-up ≈ 383px total.
  height: 384,
  overflow: 'hidden',
};

// ── Shared card gradients ──
// Default (used by Card 1 + Card 3): white → soft lavender, lavender behind
// the phone at bottom-right.
const cardBg = (darkMode) => darkMode
  ? 'linear-gradient(135deg,#1a0f2e,#0f1a2e)'
  : 'linear-gradient(135deg, #ffffff 31%, #f2f0ff 64%)';
// Card 2 reversed: lavender at top-left → white at bottom-right (inverse of
// the default so the carousel reads with visual variety).
const cardBgReversed = (darkMode) => darkMode
  ? 'linear-gradient(135deg, #2a1a3e 31%, #15151b 64%)'
  : 'linear-gradient(135deg, #f2f0ff 31%, #ffffff 64%)';

// ── Phone shell + storyboard primitives ──
// PhoneShell: rounded phone frame with a small notch, fits inside the card.
// `cropped` mode: only the top portion of the device renders (rounded top,
// flat bottom, no bottom bezel) so the phone visually bleeds off the bottom
// of the card per the storyboard mock.
// Phone scaled to 90% of native (was 190 × 320 cropped). Inner screen height
// stays proportional to the new width.
const PHONE_W = 171;
const PHONE_H = Math.round(PHONE_W * 1.95);
const PHONE_H_CROPPED = 288;

// Two-frame RAF kick — render initial state, commit to the screen, then on
// the next frame flip the prop so the browser sees a transition target and
// animates. Used by frames that want a mount-time entrance animation
// (since Storyboard remounts the active frame each cycle).
function useMountKick() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let r2 = null;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setShown(true));
    });
    return () => {
      cancelAnimationFrame(r1);
      if (r2) cancelAnimationFrame(r2);
    };
  }, []);
  return shown;
}

function PhoneShell({ children, cropped = false }) {
  const visibleHeight = cropped ? PHONE_H_CROPPED : PHONE_H;
  return (
    <Box sx={{
      position: 'relative',
      width: PHONE_W,
      height: visibleHeight,
      mx: 'auto',
      borderTopLeftRadius: '20px',
      borderTopRightRadius: '20px',
      borderBottomLeftRadius: cropped ? 0 : '20px',
      borderBottomRightRadius: cropped ? 0 : '20px',
      bgcolor: '#0a0a0a',
      paddingTop: '4px',
      paddingLeft: '4px',
      paddingRight: '4px',
      paddingBottom: cropped ? 0 : '4px',
      boxShadow: cropped
        ? '0 -2px 0 rgba(0,0,0,0) inset, 0 8px 24px rgba(0,0,0,0.18), 0 0 0 1px rgba(255,255,255,0.04) inset'
        : '0 8px 24px rgba(0,0,0,0.18), 0 0 0 1px rgba(255,255,255,0.04) inset',
      overflow: 'hidden',
    }}>
      {/* Notch */}
      <Box sx={{
        position: 'absolute', top: 7, left: '50%', transform: 'translateX(-50%)',
        width: 38, height: 7, borderRadius: 8, bgcolor: '#000', zIndex: 3,
      }} />
      {/* Inner screen — when cropped, the screen is taller than the visible
          area so content still composes at full height and gets clipped at
          the bottom (the natural "bleeds off the card" look). */}
      <Box sx={(theme) => ({
        position: 'relative',
        width: '100%',
        height: cropped ? PHONE_H : '100%',
        borderTopLeftRadius: '16px',
        borderTopRightRadius: '16px',
        borderBottomLeftRadius: cropped ? 0 : '16px',
        borderBottomRightRadius: cropped ? 0 : '16px',
        bgcolor: theme.palette.mode === 'dark' ? '#15151b' : '#fff',
        overflow: 'hidden',
      })}>
        {children}
      </Box>
    </Box>
  );
}

// Storyboard: cycles through provided frames using `setTimeout`, supports
// either a single holdMs or per-frame holds array (e.g. [1000,3000,3000]).
//
// Renders ONLY the active frame at any moment (not all frames stacked with
// opacity transitions). Earlier opacity-stacking implementation triggered
// iOS WKWebView reloads — three large <img>s decoded simultaneously per
// cycle exhausts GPU/memory in the constrained mobile webview, the
// watchdog kills the page, Capacitor cold-launches the splash, and the
// "auto-open auth on cold start" effect in App.jsx fires unprompted.
//
// Trade-off: frames snap rather than cross-fade. Each frame can implement
// its own entrance animation via local state + RAF (see ScreenShareSheet).
function Storyboard({ frames, holdMs = 2400 }) {
  const [active, setActive] = useState(0);
  const holdsRef = useRef(holdMs);
  holdsRef.current = holdMs;

  useEffect(() => {
    if (frames.length <= 1) return;
    let cancelled = false;
    let timer;
    let current = 0;
    const tick = () => {
      if (cancelled) return;
      current = (current + 1) % frames.length;
      setActive(current);
      const holds = holdsRef.current;
      const wait = Array.isArray(holds) ? (holds[current] ?? 2400) : holds;
      timer = setTimeout(tick, wait);
    };
    const initialHold = Array.isArray(holdsRef.current)
      ? (holdsRef.current[0] ?? 2400)
      : holdsRef.current;
    timer = setTimeout(tick, initialHold);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [frames.length]);

  const frame = frames[active];
  // `key={active}` forces remount so each frame's mount-time animations
  // (e.g. ScreenShareSheet's slide-in) replay every cycle.
  return (
    <Box key={active} sx={{ position: 'absolute', inset: 0 }}>
      {isValidElement(frame) ? cloneElement(frame, { isActive: true }) : frame}
    </Box>
  );
}

// Status bar that sits at the top of each phone screen — gives the mockup
// just enough visual weight to read as a real device frame.
function StatusBar() {
  return (
    <Box sx={{ height: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: '8px', pt: '2px', flexShrink: 0 }}>
      <Typography sx={{ fontSize: 8, fontWeight: 700, color: 'text.primary', opacity: 0.75 }}>9:41</Typography>
      <Box sx={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
        <Box sx={{ width: 8, height: 4, borderRadius: '1px', bgcolor: 'text.primary', opacity: 0.5 }} />
        <Box sx={{ width: 11, height: 5, borderRadius: '1.5px', border: '1px solid', borderColor: 'text.primary', opacity: 0.5 }} />
      </Box>
    </Box>
  );
}

// ── Card 1: Save from anywhere ──
// Storyboard (per the mock):
//   KF1 (1s) — full-bleed reel background.
//   KF2 (3s) — iOS share sheet slides up over the dimmed reel; this is a
//              real device screenshot (IMG_5147 cropped) so it reads as
//              authentic rather than wireframe.
//   KF3 (3s) — cross-fades to a real Recipes-page screenshot.
// Top-of-card workflow row reads left-to-right: source platform (cycling
// IG/TT/YT) → share icon → ReciFriend logo. Phone shell is "cropped" so it
// bleeds off the bottom of the card per the mock.

// Workflow row icons — designer-supplied PNGs, scaled to 80% of native size
// (logos 75 → 60, arrows 20 → 16). Total row: 60+16+60+16+60 = 212px, fits
// comfortably inside the 264px card content area.
const LOGO_PX = 60;
const ARROW_PX = 16;
const SOURCE_LOGOS = [
  '/landing-instagram-75.svg',
  '/landing-tiktok-75.svg',
  '/landing-youtube-75.svg',
];

// Cycling source-platform slot. All three logos are stacked in DOM and we
// cross-fade between them by toggling opacity — earlier Storyboard-based
// approach mounted the active frame and unmounted the previous one, leaving
// a brief blank slot during the swap. With opacity stacking the outgoing
// logo fades out as the incoming one fades in over the same window.
function CyclingSourceLogo() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setActive((i) => (i + 1) % SOURCE_LOGOS.length),
      2400,
    );
    return () => clearInterval(id);
  }, []);
  return (
    <Box sx={{ position: 'relative', width: LOGO_PX, height: LOGO_PX, flexShrink: 0 }}>
      {SOURCE_LOGOS.map((src, i) => (
        <Box
          key={src}
          component="img"
          src={src}
          alt=""
          sx={{
            position: 'absolute', inset: 0,
            width: LOGO_PX, height: LOGO_PX,
            display: 'block',
            opacity: i === active ? 1 : 0,
            transition: 'opacity 800ms cubic-bezier(.25,.46,.45,.94)',
            willChange: 'opacity',
          }}
        />
      ))}
    </Box>
  );
}

// Workflow row laid out exactly per spec — assets used at native size, no
// resize. Rendered with no gaps between icons since the asset spacing is
// designed-in.
function WorkflowRow() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <CyclingSourceLogo />
      <Box
        component="img"
        src="/landing-arrow-20.svg"
        alt=""
        sx={{ width: ARROW_PX, height: ARROW_PX, display: 'block', flexShrink: 0 }}
      />
      <Box
        component="img"
        src="/landing-share-75.svg"
        alt=""
        sx={{ width: LOGO_PX, height: LOGO_PX, display: 'block', flexShrink: 0 }}
      />
      <Box
        component="img"
        src="/landing-arrow-20.svg"
        alt=""
        sx={{ width: ARROW_PX, height: ARROW_PX, display: 'block', flexShrink: 0 }}
      />
      <Box
        component="img"
        src="/landing-recifriend-75.png"
        alt="ReciFriend"
        sx={{ width: LOGO_PX, height: LOGO_PX, display: 'block', flexShrink: 0 }}
      />
    </Box>
  );
}

// Card 1 phone animation — drives three layered KR assets through a 3-phase
// loop per the storyboard direction:
//   Phase 0 (1s): KR1 (reel) shows, KR2 parked offscreen below, KR3 hidden.
//   Phase 1 (3s): KR2 (share sheet) slides up over KR1.
//   Phase 2 (3s): KR1 + KR2 fade out, KR3 (recipe list) fades in.
//   Loop back to Phase 0 (KR3 fades out, KR1 fades in, KR2 snaps back to
//   parked position invisibly so the next slide starts clean).
function Card1PhoneAnimation({ darkMode = false }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const holds = [1000, 3000, 3000];
    let cancelled = false;
    let timer;
    let current = 0;
    const tick = () => {
      if (cancelled) return;
      current = (current + 1) % 3;
      setPhase(current);
      timer = setTimeout(tick, holds[current]);
    };
    timer = setTimeout(tick, holds[0]);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  // Asset intrinsic 358×310. Wrapper is 110% of the parent column width
  // (scaled up 10% per direction) and pulled back 5% so it centers; the
  // overflow bleeds past the card's 8px horizontal padding and is clipped
  // by the card's overflow:hidden.
  return (
    <Box sx={{
      position: 'relative',
      width: '110%',
      marginLeft: '-5%',
      aspectRatio: '358/310',
    }}>
      {/* KR1 — reel base layer. Visible in phases 0 + 1, fades out in 2. */}
      <Box
        component="img"
        src={themedAsset('/landing-card1-kr1.png', darkMode)}
        alt=""
        sx={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          objectFit: 'contain',
          opacity: phase === 2 ? 0 : 1,
          transition: 'opacity 600ms cubic-bezier(.25,.46,.45,.94)',
        }}
      />
      {/* KR2 — share sheet. Slides up on phase 1, fades out on phase 2,
          snaps back to parked translateY(100%) on phase 0 (invisible) so
          the next slide enters from the same starting position. Nudged 2px
          left so its edge aligns with the phone's inner screen edge in the
          KR1 + KR3 assets (asset crops differ slightly between the three). */}
      <Box
        component="img"
        src={themedAsset('/landing-card1-kr2.png', darkMode)}
        alt=""
        sx={{
          position: 'absolute', top: 0, bottom: 0, left: '-2px', right: '2px',
          width: '100%', height: '100%',
          objectFit: 'contain',
          opacity: phase === 1 ? 1 : 0,
          transform: phase === 0 ? 'translateY(100%)' : 'translateY(0)',
          // No transition on phase 0 so the parked-reset snap is instant
          // (under cover of opacity 0). Animated otherwise.
          transition: phase === 0
            ? 'none'
            : 'transform 600ms cubic-bezier(.2,.8,.2,1), opacity 600ms cubic-bezier(.25,.46,.45,.94)',
        }}
      />
      {/* KR3 — recipe list, fades in on phase 2 (over the fading KR1+KR2). */}
      <Box
        component="img"
        src={themedAsset('/landing-card1-kr3.png', darkMode)}
        alt=""
        sx={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          objectFit: 'contain',
          opacity: phase === 2 ? 1 : 0,
          transition: 'opacity 600ms cubic-bezier(.25,.46,.45,.94)',
        }}
      />
    </Box>
  );
}

// KF1 — Reel background. Full-bleed food still + TikTok/IG-style overlay UI.
// Fades in on each cycle (the loop wraps from KF3 → KF1 with a fade per the
// updated mock direction).
function ScreenReel() {
  const shown = useMountKick();
  return (
    <Box sx={{
      position: 'absolute', inset: 0, overflow: 'hidden',
      opacity: shown ? 1 : 0,
      transition: 'opacity 600ms cubic-bezier(.25,.46,.45,.94)',
    }}>
      <Box
        component="img"
        src="/landing-reel-ramen.jpg"
        alt=""
        sx={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          objectFit: 'cover',
          filter: 'brightness(0.95)',
        }}
      />
      <StatusBar />

      {/* Right-rail action icons */}
      <Box sx={{
        position: 'absolute', right: '6px', bottom: '36px',
        display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center',
        color: '#fff',
      }}>
        {[
          { glyph: '♥', count: '12k' },
          { glyph: '💬', count: '184' },
          { glyph: '↗',  count: 'Share' },
        ].map((it) => (
          <Box key={it.glyph} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
            <Box sx={{
              width: 18, height: 18, borderRadius: '50%',
              bgcolor: 'rgba(0,0,0,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, lineHeight: 1, color: '#fff',
              textShadow: '0 1px 2px rgba(0,0,0,0.6)',
            }}>{it.glyph}</Box>
            <Typography sx={{ fontSize: 6, fontWeight: 700, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>{it.count}</Typography>
          </Box>
        ))}
      </Box>

      {/* Bottom caption */}
      <Box sx={{
        position: 'absolute', left: '6px', right: '36px', bottom: '6px',
        color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.6)',
      }}>
        <Typography sx={{ fontSize: 7.5, fontWeight: 700, lineHeight: 1.2 }}>@cozychefkitchen</Typography>
        <Typography sx={{ fontSize: 6.5, lineHeight: 1.25, mt: '2px', opacity: 0.95 }}>
          Braised Beef Ramen 🍜 #cozyfood
        </Typography>
      </Box>
    </Box>
  );
}

// KF2 — Real iOS share sheet screenshot (IMG_5147 crop). The sheet slides up
// from the bottom each time this frame becomes active.
function ScreenShareSheet() {
  const shown = useMountKick();
  return (
    <Box sx={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {/* Dimmed reel in the background. */}
      <Box
        component="img"
        src="/landing-reel-ramen.jpg"
        alt=""
        sx={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          objectFit: 'cover', filter: 'brightness(0.6)',
        }}
      />
      {/* Share-sheet screenshot — slides up from the bottom on mount. */}
      <Box
        component="img"
        src="/landing-share-sheet.jpg"
        alt=""
        sx={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          width: '100%', height: '62%',
          objectFit: 'cover', objectPosition: 'bottom',
          willChange: 'transform',
          transform: shown ? 'translateY(0)' : 'translateY(110%)',
          transition: 'transform 420ms cubic-bezier(.2,.8,.2,1)',
        }}
      />
    </Box>
  );
}

// KF3 — Real Recipes-page screenshot. Fades in on each cycle (KF2 → KF3).
function ScreenRecipeList() {
  const shown = useMountKick();
  return (
    <Box
      component="img"
      src="/landing-recipes-page.jpg"
      alt=""
      sx={{
        position: 'absolute', inset: 0,
        width: '100%', height: '100%',
        objectFit: 'cover', objectPosition: 'top',
        opacity: shown ? 1 : 0,
        transition: 'opacity 600ms cubic-bezier(.25,.46,.45,.94)',
      }}
    />
  );
}

function CardSaveFromAnywhere({ onJoin, darkMode }) {
  return (
    <Box sx={{
      ...WHY_CARD_SX,
      background: cardBg(darkMode),
      // position:relative establishes the containing block for the phone's
      // absolute positioning below — that's how we guarantee zero gap
      // between phone bottom and card bottom regardless of how the title
      // and workflow row measure out.
      position: 'relative',
      textAlign: 'center',
    }}>
      {/* Top content stacks naturally from the top: workflow row → subhead.
          Subhead has mt:'10px' to push it 10px down from the workflow row. */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: 'center' }}>
        <WorkflowRow />
        <Typography
          sx={{ display: 'block', mt: '10px', fontSize: 13, fontWeight: 500, lineHeight: 1.35, px: 0.5, color: 'text.primary' }}
        >
          Save recipes directly from reels to ReciFriend.
        </Typography>
      </Box>

      {/* Card 1 phone animation — anchored to the card's bottom edge so it
          is always flush, regardless of varying top-content height. The
          card's px:1 padding doesn't apply here (left:0, right:0 reach the
          card's full inner width) so the 110% scale-up bleeds beyond the
          card edges symmetrically and gets clipped by overflow:hidden. */}
      <Box sx={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
        <Card1PhoneAnimation darkMode={darkMode} />
      </Box>
    </Box>
  );
}

// ── Card 2: Cook with Friends ──
// Storyboard: friend activity feed cycles between two arrangements showing
// real-time cooking + saving updates.
const FRIEND_ACTIVITY_FRAMES = [
  [
    { color: '#7c3aed', initial: 'C', name: 'Cynthia', verb: 'cooked', recipe: 'Paella' },
    { color: '#10b981', initial: 'M', name: 'Mike',    verb: 'saved',  recipe: 'Carbonara' },
  ],
  [
    { color: '#f59e0b', initial: 'A', name: 'Aiko',    verb: 'shared', recipe: 'Bibimbap' },
    { color: '#ef4444', initial: 'J', name: 'Jordan',  verb: 'cooked', recipe: 'Tacos' },
  ],
];

function FriendActivityScreen({ items }) {
  return (
    <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <StatusBar />
      <Box sx={{ p: '8px', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <Typography sx={{ fontSize: 9, fontWeight: 700 }}>Friend activity</Typography>
        {items.map((item, i) => (
          <Box key={i} sx={(theme) => ({
            display: 'flex', alignItems: 'center', gap: '6px',
            borderRadius: 1.25, p: '6px',
            bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
          })}>
            <Box sx={{
              width: 18, height: 18, borderRadius: '50%',
              bgcolor: item.color, color: '#fff',
              fontSize: 8, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>{item.initial}</Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: 7.5, fontWeight: 600, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {item.name} {item.verb} {item.recipe}
              </Typography>
              <Typography sx={{ fontSize: 6.5, color: 'text.secondary', mt: '1px' }}>just now</Typography>
            </Box>
            {item.verb === 'cooked' && (
              <Typography sx={{ fontSize: 9 }}>🍳</Typography>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// Card 2 activity ticker — single-slot fade + slide cycle, ported from the
// in-app CwfTicker (see FriendSections.jsx). Each item sits in the same
// pill-card; the avatar slot alternates between a letter avatar (colored
// circle + initial) and a photo avatar (img URL). Photos here are Pravatar
// placeholders so you can swap to real friend photos by changing the `photo`
// field.
const C2_ITEMS = [
  { type: 'letter', initial: 'E', color: '#7c3aed', lightColor: '#a78bfa', name: 'Elisa',  text: 'saved Miso Ramen ❤️', time: '2h' },
  { type: 'letter', initial: 'H', color: '#10b981', lightColor: '#34d399', name: 'Henny',  text: 'shared Beef Stew with you', time: '5h' },
  { type: 'letter', initial: 'M', color: '#f59e0b', lightColor: '#fbbf24', name: 'Max',    text: 'is cooking Tacos tonight 🌮', time: 'now' },
  { type: 'photo',  photo: 'https://i.pravatar.cc/96?img=32', color: '#ef4444', lightColor: '#f87171', name: 'Sara',   text: 'saved Salmon Bowl 🐟', time: '3h' },
  { type: 'photo',  photo: 'https://i.pravatar.cc/96?img=33', color: '#06b6d4', lightColor: '#22d3ee', name: 'Jordan', text: 'cooked Chicken Tikka Masala', time: '6h' },
];

const C2_HOLD_MS = 2800, C2_OUT_MS = 450, C2_IN_MS = 550, C2_OVERLAP_MS = 150;
const C2_OUT_EASE = 'cubic-bezier(0.4,0,1,1)';
const C2_IN_EASE  = 'cubic-bezier(0,0,0.2,1)';

function Card2ActivityTicker() {
  const refs = useRef([]);
  const currentIdx = useRef(0);
  useEffect(() => {
    const items = refs.current;
    if (!items.length) return;
    let enterTimer = null, resetTimer = null;
    const cycle = () => {
      const prev = currentIdx.current;
      const next = (prev + 1) % items.length;
      currentIdx.current = next;
      const prevEl = items[prev];
      prevEl.style.transition = `opacity ${C2_OUT_MS}ms ${C2_OUT_EASE}, transform ${C2_OUT_MS}ms ${C2_OUT_EASE}`;
      prevEl.style.opacity = '0';
      prevEl.style.transform = 'translateY(-14px)';
      enterTimer = setTimeout(() => {
        const nextEl = items[next];
        nextEl.style.transition = `opacity ${C2_IN_MS}ms ${C2_IN_EASE}, transform ${C2_IN_MS}ms ${C2_IN_EASE}`;
        nextEl.style.opacity = '1';
        nextEl.style.transform = 'translateY(0)';
      }, C2_OUT_MS - C2_OVERLAP_MS);
      resetTimer = setTimeout(() => {
        prevEl.style.transition = 'none';
        prevEl.style.opacity = '0';
        prevEl.style.transform = 'translateY(20px)';
      }, C2_OUT_MS + 80);
    };
    const interval = setInterval(cycle, C2_HOLD_MS + C2_OUT_MS);
    return () => { clearInterval(interval); clearTimeout(enterTimer); clearTimeout(resetTimer); };
  }, []);
  return (
    // Outer pill carries bgcolor + borderRadius + boxShadow + overflow:hidden.
    // Drop shadow paints outside the box's borders and is therefore not
    // clipped by the box's own overflow:hidden — when we put the shadow on
    // the rotating items inside, their shadows were being cropped by the
    // outer overflow:hidden on every side.
    <Box sx={(theme) => ({
      position: 'relative',
      height: 44,
      width: '100%',
      overflow: 'hidden',
      bgcolor: 'background.paper',
      borderRadius: 2,
      boxShadow: theme.palette.mode === 'dark'
        ? '0 6px 16px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.10)'
        : '0 6px 16px rgba(0,0,0,0.10), 0 1px 3px rgba(0,0,0,0.06)',
    })}>
      {C2_ITEMS.map((item, i) => (
        <Box
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          style={{
            opacity: i === 0 ? 1 : 0,
            transform: i === 0 ? 'translateY(0)' : 'translateY(20px)',
          }}
          sx={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', gap: 1, px: 1.5,
            willChange: 'opacity, transform',
          }}
        >
          {item.type === 'photo' ? (
            <Box
              component="img"
              src={item.photo}
              alt=""
              loading="lazy"
              sx={{
                width: 28, height: 28, borderRadius: '50%',
                objectFit: 'cover', flexShrink: 0,
                // Subtle ring so the photo reads as an avatar against the
                // pill bg in both themes.
                boxShadow: (t) => t.palette.mode === 'dark'
                  ? '0 0 0 1.5px rgba(255,255,255,0.12)'
                  : '0 0 0 1.5px rgba(0,0,0,0.06)',
              }}
            />
          ) : (
            <Box sx={{
              width: 28, height: 28, borderRadius: '50%',
              bgcolor: item.color,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Typography sx={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>{item.initial}</Typography>
            </Box>
          )}
          <Typography
            variant="caption"
            sx={{ flex: 1, fontSize: 11, color: 'text.secondary', lineHeight: 1.2, textAlign: 'left' }}
          >
            <Box component="span" sx={(t) => ({ color: t.palette.mode === 'dark' ? item.lightColor : item.color, fontWeight: 600 })}>
              {item.name}
            </Box>{' '}{item.text}
          </Typography>
          <Typography variant="caption" sx={{ fontSize: 10, color: 'text.disabled', flexShrink: 0 }}>{item.time}</Typography>
        </Box>
      ))}
    </Box>
  );
}

// Card 2 phone animation — two-phase loop:
//   Phase 0 (3s): KR1 (phone showing friends list) is visible, drawer parked
//                 below the phone, no tint.
//   Phase 1 (3.5s): black tint fades in to 75% over the phone screen while
//                   the drawer (KR2_drawer) slides up from below.
//   Loop back to Phase 0 (tint fades out, drawer slides back down).
// The phone sits flush with the card's bottom edge per direction.
function Card2PhoneAnimation({ darkMode = false }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const holds = [3000, 3500];
    let cancelled = false;
    let timer;
    let current = 0;
    const tick = () => {
      if (cancelled) return;
      current = (current + 1) % 2;
      setPhase(current);
      timer = setTimeout(tick, holds[current]);
    };
    timer = setTimeout(tick, holds[0]);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  return (
    <Box sx={{
      // Mirror Card 1's phone wrapper: anchored to the card's bottom edge
      // with no top constraint. Inner box drives the height via aspect.
      position: 'absolute',
      bottom: 0, left: 0, right: 0,
    }}>
      <Box sx={{
        position: 'relative',
        // Same 110% width + -5% margin as Card 1 so Card 2's phone has the
        // same visual size and bleed beyond the card edges.
        width: '110%',
        marginLeft: '-5%',
        // Asset is now natively 358:310, matching Card 1 — no crop needed.
        aspectRatio: '358 / 310',
        overflow: 'hidden',
      }}>
        {/* KR1 — phone with friends list, fills the container 1:1. */}
        <Box
          component="img"
          src={themedAsset('/landing-card2-kr1.png', darkMode)}
          alt=""
          sx={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            display: 'block',
          }}
        />
        {/* Black tint at 75% opacity, masked to the phone's inner screen.
            Asset is 358×310, inner screen at top 12.26% / left 11.45% /
            right 11.73% / bottom 0% — top-corner curve rx=53 ry=44 in
            asset, ≈19% wide × 16% tall of the resulting tint. */}
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            top: '12.3%', left: '11.5%', right: '11.7%', bottom: 0,
            bgcolor: 'rgba(0,0,0,0.75)',
            borderRadius: '19% 19% 0 0 / 16% 16% 0 0',
            opacity: phase === 1 ? 1 : 0,
            transition: 'opacity 600ms cubic-bezier(.25,.46,.45,.94)',
            pointerEvents: 'none',
          }}
        />
        {/* KR2 drawer — slides up from below the phone on phase 1, slides
            back down on phase 0. Width is the drawer asset's intrinsic
            260/358 ≈ 72.63% of the phone's screen (new export). */}
        <Box
          component="img"
          src={themedAsset('/landing-card2-kr2-drawer.png', darkMode)}
          alt=""
          sx={{
            position: 'absolute',
            bottom: 0,
            left: '50%',
            width: `${(260 / 358) * 100}%`,
            height: 'auto',
            display: 'block',
            transform: phase === 1
              ? 'translateX(-50%) translateY(0)'
              : 'translateX(-50%) translateY(100%)',
            transition: 'transform 700ms cubic-bezier(.2,.8,.2,1)',
            willChange: 'transform',
          }}
        />
      </Box>
    </Box>
  );
}

function CardCookWithFriends({ onJoin, darkMode }) {
  return (
    <Box sx={{
      ...WHY_CARD_SX,
      // Card 2 uses the reversed gradient (lavender top-left → white
      // bottom-right) so the carousel reads with visual variety.
      background: cardBgReversed(darkMode),
      position: 'relative',
      textAlign: 'center',
    }}>
      {/* Top content: ticker on top, subhead below.
          Spacing tuned to match Card 1's subhead vertical position:
          - Ticker mt:'10px' (per spec)
          - Column gap: 1.25 (10px) so ticker_bottom + gap = workflow_height
            + Card 1's column gap (60 + 4 = 64), giving the subhead the same
            y-offset as Card 1's subhead. */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, alignItems: 'stretch', textAlign: 'center' }}>
        <Box sx={{ mt: '10px', px: '6px' }}>
          <Card2ActivityTicker />
        </Box>
        <Typography
          sx={{ display: 'block', mt: '10px', fontSize: 13, fontWeight: 500, lineHeight: 1.35, px: 0.5, color: 'text.primary' }}
        >
          Share recipes with friends and see what they are cooking.
        </Typography>
      </Box>

      {/* Phone animation — KR1 base + black tint + KR2 drawer slide-up. */}
      <Card2PhoneAnimation darkMode={darkMode} />
    </Box>
  );
}

// ── Card 3: Discover trending recipes ──
// Storyboard: trending tag chip + a recipe shelf preview.
const TREND_TAGS = ['#PlantBasedEating', '#FermentedFoods', '#HighProteinMeals', '#GutHealth', '#AntiInflammatory'];

function ScreenTrendingTags({ tagIdx }) {
  const tag = TREND_TAGS[tagIdx % TREND_TAGS.length];
  return (
    <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <StatusBar />
      <Box sx={{ p: '8px', flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <Typography sx={{ fontSize: 9, fontWeight: 700 }}>Trending</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
          <Box sx={(theme) => ({
            px: 1, py: '4px', borderRadius: 999,
            border: '1.5px solid',
            borderColor: theme.palette.mode === 'dark' ? `${theme.palette.primary.light}66` : `${theme.palette.primary.main}55`,
            color: theme.palette.mode === 'dark' ? 'primary.light' : 'primary.main',
            fontSize: 8, fontWeight: 700,
          })}>
            {tag}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function ScreenRecipeShelf() {
  const cards = [
    { title: 'Beet hummus',     g: 'linear-gradient(135deg,#fda4af,#f43f5e)' },
    { title: 'Miso salmon',     g: 'linear-gradient(135deg,#fcd34d,#f97316)' },
    { title: 'Lentil dahl',     g: 'linear-gradient(135deg,#86efac,#16a34a)' },
  ];
  return (
    <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <StatusBar />
      <Box sx={{ p: '8px', flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <Typography sx={{ fontSize: 9, fontWeight: 700 }}>Trending</Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {cards.map((c) => (
            <Box key={c.title} sx={(theme) => ({
              display: 'flex', alignItems: 'center', gap: '6px',
              borderRadius: 1, p: '4px', pr: '6px',
              bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
            })}>
              <Box sx={{ width: 22, height: 22, borderRadius: '6px', background: c.g, flexShrink: 0 }} />
              <Typography sx={{ fontSize: 7.5, fontWeight: 600, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</Typography>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

// Card 3 recipe shelf — modeled on the in-app "Discover New Recipes" shelf
// (DiscoverRecipes.jsx). Renders the same 6 recipes the public landing
// fetches into `discover`, with a fallback gradient placeholder list while
// data loads. Cards have the same thumbnail-first design (image bg + title
// + play icon overlay) as the in-page shelf, sans the autoplay iframe.
const SHELF_FALLBACK = [
  { title: 'Braised Beef Ramen',     emoji: '🍜', g: 'linear-gradient(135deg, #fcd34d, #f97316)' },
  { title: 'Spicy Peanut Noodles',   emoji: '🌶️', g: 'linear-gradient(135deg, #fda4af, #f43f5e)' },
  { title: 'Mini Croissants',        emoji: '🥐', g: 'linear-gradient(135deg, #fde68a, #fb923c)' },
  { title: 'Agedashi Tofu',          emoji: '🥢', g: 'linear-gradient(135deg, #86efac, #16a34a)' },
  { title: 'Pommes Anna',            emoji: '🥔', g: 'linear-gradient(135deg, #fef08a, #facc15)' },
  { title: 'Korean Bibimbap',        emoji: '🍚', g: 'linear-gradient(135deg, #c4b5fd, #7c3aed)' },
];
const SHELF_CARD_W = 110;

// Returns the dark-mode counterpart of a public asset path when darkMode
// is true. Convention: insert "-dark" before the extension
//   /landing-foo.png → /landing-foo-dark.png
//
// Dark assets aren't ready yet — flip DARK_ASSETS_READY to true once the
// "-dark" siblings are dropped into apps/recipe-ui/public/. Until then both
// themes share the light asset (no 404 on dark mode).
const DARK_ASSETS_READY = false;
function themedAsset(src, darkMode) {
  if (!DARK_ASSETS_READY || !darkMode || !src) return src;
  return src.replace(/(\.[a-z0-9]+)$/i, '-dark$1');
}

// Single stable keyframe for the Card 3 discover-icon needle. Defined at
// module scope via @emotion/react's keyframes helper so it produces one
// hashed CSS rule (vs inline @keyframes in sx, which can leak stylesheets
// under repeated activation).
const COMPASS_SPIN = keyframes`
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
`;
const SHELF_GAP = 8;
const SHELF_PAD_X = 20; // matches inner pl/pr below — used for explicit
                       // maxScroll math because some WebKit builds don't
                       // include trailing padding-right in scrollWidth for
                       // an overflowing flex container.

function ShelfCard({ recipe }) {
  // Match the in-app WatchCard logic: prefer the video host's thumbnail
  // (TikTok / YouTube), fall back to the recipe's stored imageUrl.
  const thumbSrc = recipe.sourceUrl
    ? (getVideoThumbnailUrl(recipe.sourceUrl) || recipe.imageUrl)
    : recipe.imageUrl;
  return (
    <Box sx={{
      flexShrink: 0,
      width: SHELF_CARD_W,
      aspectRatio: '9 / 16',
      borderRadius: '10px',
      overflow: 'hidden',
      position: 'relative',
      // Gradient placeholder shows while imageUrl loads (or for the
      // fallback recipes that have no imageUrl).
      background: recipe.g || 'linear-gradient(135deg,#e5e7eb,#9ca3af)',
    }}>
      {thumbSrc ? (
        <Box
          component="img"
          src={thumbSrc}
          alt={recipe.title}
          sx={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'cover', display: 'block',
          }}
        />
      ) : recipe.emoji ? (
        <Box sx={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 64, opacity: 0.92,
        }}>
          {recipe.emoji}
        </Box>
      ) : null}
      {/* Centered play icon overlay — signals these are video recipes */}
      <Box sx={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.18)',
      }}>
        <PlayArrowIcon sx={{
          fontSize: 36,
          color: 'white',
          filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.4))',
        }} />
      </Box>
      {/* Bottom gradient overlay for title legibility (same as in-app WatchCard) */}
      <Box sx={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 60%)',
      }} />
      {/* Title */}
      <Typography sx={{
        position: 'absolute', bottom: 8, left: 8, right: 8,
        color: '#fff',
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1.25,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {recipe.title}
      </Typography>
    </Box>
  );
}

function Card3RecipeShelf({ recipes = [] }) {
  // Use up to 6 real recipes; fall back to gradient placeholders while
  // discover data is still loading (or if it returns empty).
  const items = recipes.length > 0 ? recipes.slice(0, 6) : SHELF_FALLBACK;
  const containerRef = useRef(null);
  const innerRef = useRef(null);
  const [maxScroll, setMaxScroll] = useState(0);
  const [animated, setAnimated] = useState(false);
  const triggeredRef = useRef(false);

  // Compute max scroll explicitly from the known card geometry rather than
  // relying on scrollWidth (which on some WebKit builds drops trailing
  // padding-right for overflowing flex content, leaving the last card flush
  // against the container's right edge instead of inset by SHELF_PAD_X).
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const measure = () => {
      const n = items.length;
      const contentW = SHELF_PAD_X * 2 + n * SHELF_CARD_W + Math.max(0, n - 1) * SHELF_GAP;
      const containerW = c.clientWidth;
      setMaxScroll(Math.max(0, contentW - containerW));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(c);
    return () => ro.disconnect();
  }, [items.length]);

  // Single-shot trigger: when this shelf scrolls into view (≥ 50% visible)
  // wait 3 seconds, then start the slide animation. Once started, never
  // re-triggers. Feature-detect IntersectionObserver for jsdom.
  useEffect(() => {
    if (triggeredRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !triggeredRef.current) {
        triggeredRef.current = true;
        observer.disconnect();
        setTimeout(() => setAnimated(true), 3000);
      }
    }, { threshold: 0.5 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    // Negative mx pulls the container out to the card's full width so the
    // shelf can use the entire 308px-wide card surface. pl/pr on the inner
    // give the row a 16px inset from each card edge.
    <Box ref={containerRef} sx={{ mx: -1, overflow: 'hidden' }}>
      <Box ref={innerRef} sx={{
        display: 'flex',
        gap: '8px',
        // Symmetric 20px insets — initial state has 20px left padding;
        // since maxScroll = scrollWidth − clientWidth includes both pl and
        // pr, the slide ends with the last card sitting exactly 20px from
        // the container's right edge.
        pl: '20px',
        pr: '20px',
        // Translation from 0 → -maxScroll. The translation distance is
        // (scrollWidth - clientWidth) which naturally accounts for both
        // pl and pr — at end, the right-padded last card sits flush
        // against clientWidth - rightPad. Cards slide so the row goes
        // flush against the container's left edge mid-animation.
        transform: animated ? `translateX(-${maxScroll}px)` : 'translateX(0)',
        transition: 'transform 5s cubic-bezier(.25,.46,.45,.94)',
        willChange: 'transform',
      }}>
        {items.map((r, i) => (
          <ShelfCard key={r.id ?? i} recipe={r} />
        ))}
      </Box>
    </Box>
  );
}

// Card 3 friend-feed item — single static row sized to match Card 2's
// ticker height (44px). Slimmer than the in-app ActivityItem variant: 26px
// avatar / 30px thumbnail / 11px text with a 2-line clamp.
function Card3FriendFeedItem() {
  return (
    <Box sx={(theme) => ({
      bgcolor: 'background.paper',
      borderRadius: 2,
      px: 1.25,
      height: 44,
      display: 'flex', alignItems: 'center', gap: '8px',
      boxShadow: theme.palette.mode === 'dark'
        ? '0 6px 16px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.10)'
        : '0 6px 16px rgba(0,0,0,0.10), 0 1px 3px rgba(0,0,0,0.06)',
    })}>
      {/* Avatar (letter) */}
      <Box sx={{
        width: 26, height: 26, borderRadius: '50%',
        bgcolor: '#10b981',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Typography sx={{ color: '#fff', fontSize: 11, fontWeight: 700, lineHeight: 1 }}>H</Typography>
      </Box>
      {/* Sentence: bold name + bold recipe with secondary verbs around them */}
      <Typography sx={{
        flex: 1, fontSize: 11, lineHeight: 1.3, textAlign: 'left',
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>Henny</Box>
        <Box component="span" sx={{ color: 'text.secondary' }}> shared </Box>
        <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>Braised Beef Ramen</Box>
        <Box component="span" sx={{ color: 'text.secondary' }}> with you</Box>
      </Typography>
      {/* Timestamp */}
      <Typography sx={{ fontSize: 9, color: 'text.disabled', flexShrink: 0 }}>now</Typography>
      {/* Recipe thumbnail */}
      <Box sx={{
        width: 30, height: 30, borderRadius: '6px', flexShrink: 0,
        overflow: 'hidden', bgcolor: 'action.hover',
      }}>
        <Box
          component="img"
          src="/landing-reel-ramen.jpg"
          alt=""
          sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </Box>
    </Box>
  );
}

function CardDiscoverTrending({ onJoin, darkMode, recipes = [] }) {
  return (
    <Box sx={{
      ...WHY_CARD_SX,
      background: cardBg(darkMode),
      position: 'relative',
      textAlign: 'center',
    }}>
      {/* Discover icon → recipe shelf → subhead. Shelf top sits at
          card_y≈91 to match the y-position of Card 2's phone:
            pt(20) + icon mt(10) + icon(40) + shelf mt(21) = 91.
          Cards scaled down (110 wide) so the shelf height + a centered
          subhead below + the 20px bottom padding all fit within 384. */}
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', textAlign: 'center' }}>
        <Box sx={(theme) => ({
          mt: '10px',
          display: 'flex',
          justifyContent: 'center',
          // Theme-aware purple — same primary palette as the BottomAppBar
          // discover tab; lifts to primary.light in dark mode for legibility.
          color: theme.palette.mode === 'dark' ? theme.palette.primary.light : theme.palette.primary.main,
        })}>
          {/* Same SVG as BottomAppBar's DiscoverIcon, rendered at 48px
              with a lighter stroke. Compass needle rotates clockwise via
              COMPASS_SPIN — 4s per turn for a noticeable, steady cadence. */}
          <Box
            component="svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            sx={{ width: 48, height: 48 }}
          >
            <circle cx="12" cy="12" r="9" />
            <Box
              component="path"
              d="M16 8l-3 5-5 3 3-5z"
              sx={{
                animation: `${COMPASS_SPIN} 4s linear infinite`,
                transformOrigin: '50% 50%',
                // Make transform-origin resolve against the SVG view-box
                // so the needle rotates around the icon's center (12,12)
                // rather than the path's own bounding box.
                transformBox: 'view-box',
              }}
            />
          </Box>
        </Box>
        {/* Subhead — pt(20) + icon mt(10) + icon(48) + text mt(16) = 94,
            matching Cards 1 + 2's subhead y-offset. */}
        <Typography
          sx={{ display: 'block', mt: '16px', fontSize: 13, fontWeight: 500, lineHeight: 1.35, px: 0.5, color: 'text.primary' }}
        >
          Discover recipes and health topics curated for your cooking preferences.
        </Typography>
        {/* Shelf — bottom lands ~20px above the card edge with the
            scaled-down 110-wide cards (h=196): text bottom (~129) + mt(39)
            + card_h(196) = 364, leaving 20px bottom padding. */}
        <Box sx={{ mt: '39px' }}>
          <Card3RecipeShelf recipes={recipes} />
        </Box>
      </Box>
    </Box>
  );
}

const NUM_WHY_CARDS = 3;

function WhyJoinCarousel({ onJoin, darkMode, discoverRecipes = [] }) {
  const [active, setActive] = useState(0);
  const scrollRef = useRef(null);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const cardW = el.scrollWidth / NUM_WHY_CARDS;
    setActive(Math.round(el.scrollLeft / cardW));
  };

  return (
    <Box>
      <Typography fontWeight={400} fontSize={22} textAlign="center" sx={{ color: 'text.primary', mb: 1.5 }}>
        Save, cook, share
      </Typography>

      {/* Same mx:-2 / pl:2 pattern as TrendingHealthCarouselB */}
      <Box sx={{ mx: -2, overflow: 'hidden' }}>
        <Box
          ref={scrollRef}
          onScroll={handleScroll}
          sx={{
            display: 'flex',
            gap: '10px',
            overflowX: 'auto',
            scrollSnapType: 'x mandatory',
            scrollPaddingLeft: '16px',
            pl: 2,
            pb: 0.5,
            '&::-webkit-scrollbar': { display: 'none' },
            scrollbarWidth: 'none',
          }}
        >
          <CardSaveFromAnywhere onJoin={onJoin} darkMode={darkMode} />
          <CardCookWithFriends onJoin={onJoin} darkMode={darkMode} />
          <CardDiscoverTrending onJoin={onJoin} darkMode={darkMode} recipes={discoverRecipes} />
        </Box>
      </Box>

      {/* Dot indicators */}
      <Box sx={{ display: 'flex', justifyContent: 'center', gap: 0.75, mt: 1.5 }}>
        {[0, 1, 2].map(i => (
          <Box
            key={i}
            onClick={() => {
              const el = scrollRef.current;
              if (!el) return;
              const cardW = el.scrollWidth / NUM_WHY_CARDS;
              el.scrollTo({ left: cardW * i, behavior: 'smooth' });
            }}
            sx={{
              width: active === i ? 16 : 6,
              height: 6,
              borderRadius: 3,
              bgcolor: active === i ? 'primary.main' : 'divider',
              transition: 'width 0.25s, background-color 0.25s',
              cursor: 'pointer',
            }}
          />
        ))}
      </Box>
    </Box>
  );
}

export default function PublicLanding({ onJoin, onLogin, onOpenRecipe, darkMode, onShare }) {
  const [trending, setTrending] = useState([]);
  const [discover, setDiscover] = useState([]);
  const [fabVisible, setFabVisible] = useState(false);
  const whyJoinRef = useRef(null);

  useEffect(() => {
    const el = whyJoinRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setFabVisible(!entry.isIntersecting),
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    fetchJson('/public/trending-recipes').then(d => setTrending(d?.recipes || []));
    fetchJson('/public/discover').then(d => setDiscover(d?.recipes || []));
  }, []);

  // YouTube Shorts dropped — the embed hits Error 153 in WKWebView and the
  // nocookie/UA workarounds didn't fix it. Instagram + TikTok reels are the
  // preferred video sources here. TikTok autoplays via iframe; Instagram
  // reels render as thumbnail cards (Instagram blocks iframing).
  const trendingIds = new Set(trending.map(r => r.id));
  const seenUrls = new Set();
  const discoverUniq = discover.filter(r => {
    if (trendingIds.has(r.id)) return false;
    if (!r.sourceUrl || seenUrls.has(r.sourceUrl)) return false;
    if (r.sourceUrl.includes('youtube.com') || r.sourceUrl.includes('youtu.be')) return false;
    seenUrls.add(r.sourceUrl);
    return true;
  });
  // First slots: Instagram reels + TikTok videos (the "reels" experience).
  const reels = discoverUniq.filter(r => {
    const u = r.sourceUrl || '';
    return u.includes('tiktok.com') || u.includes('instagram.com/reel');
  }).slice(0, 2);
  const reelIds = new Set(reels.map(r => r.id));
  const otherVideos = discoverUniq.filter(r => !reelIds.has(r.id) && isEmbeddable(r.sourceUrl));
  const nonEmbeddable = discoverUniq.filter(r => !reelIds.has(r.id) && !isEmbeddable(r.sourceUrl));
  const videoRecipes = [...reels, ...otherVideos, ...nonEmbeddable].slice(0, 5);

  const trendingFiltered = trending.slice(0, 5);

  return (
    <>
      {/* ── Header (logged-out): logo on the left, Login on the right ── */}
      <Box
        sx={(theme) => ({
          position: 'fixed',
          top: 0, left: 0, right: 0,
          zIndex: 1100,
          paddingTop: 'env(safe-area-inset-top)',
          bgcolor: theme.palette.mode === 'dark'
            ? 'rgba(0,0,0,0.85)'
            : 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          borderBottom: 1,
          borderColor: 'divider',
        })}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1 }}>
          <Typography
            variant="h6"
            component="div"
            sx={{ fontWeight: 600, fontSize: '14px', userSelect: 'none' }}
          >
            ReciFriend
          </Typography>
          <Box
            component="button"
            onClick={onLogin || onJoin}
            sx={(theme) => ({
              border: 'none',
              bgcolor: 'transparent',
              color: 'primary.main',
              fontFamily: 'inherit',
              fontSize: 14,
              fontWeight: 600,
              px: 1.5,
              py: 0.75,
              borderRadius: 999,
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
              '&:active': { opacity: 0.6 },
              '&:hover': { bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' },
            })}
          >
            Login
          </Box>
        </Box>
      </Box>

      <Container maxWidth="sm" disableGutters>
        <Box sx={{ px: { xs: 2, sm: 3 }, pb: 6 }}>

        {/* Top padding includes the header height (~50) plus the iOS
            dynamic-island safe-area inset, so first content clears both. */}
        <Stack sx={{ gap: '32px', pt: 'calc(env(safe-area-inset-top) + 70px)' }}>

          {/* ── Why Join Recifind ── */}
          <Box ref={whyJoinRef}>
            <WhyJoinCarousel
              onJoin={onJoin}
              darkMode={darkMode}
              discoverRecipes={discoverUniq.slice(0, 6)}
            />
          </Box>

          {/* ── Section 1: Trending ── */}
          {trendingFiltered.length > 0 && (
            <Box>
              <SectionLabel label="Trending Now" />
              <RecipeShelf
                recipes={trendingFiltered}
                onSave={onJoin}
                onShare={(recipe, e) => onShare?.(recipe, e)}
                onOpen={onOpenRecipe}
                cardWidth={180}
                cardHeight={120}
                gap="8px"
              />
            </Box>
          )}

          {/* ── Discover New Recipes ── */}
          {videoRecipes.length > 0 && (
            <Box>
              <SectionLabel label="Discover New Recipes" />
              <DiscoverRecipes recipes={videoRecipes} onOpen={onOpenRecipe} />
            </Box>
          )}

        </Stack>
      </Box>

      <Fab
        variant="extended"
        onClick={onJoin}
        sx={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1200,
          bgcolor: 'primary.main',
          color: '#fff',
          fontWeight: 700,
          fontSize: 14,
          textTransform: 'none',
          px: 4,
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          transition: 'opacity 0.25s',
          opacity: fabVisible ? 1 : 0,
          pointerEvents: fabVisible ? 'auto' : 'none',
          '&:hover': { bgcolor: 'primary.dark' },
        }}
      >
        Join Free
      </Fab>
      {/* Visible privacy link so OAuth consent-screen verifiers (Google etc.)
          can confirm the public homepage links to the privacy policy. */}
      <Box
        component="a"
        href="/privacy.html"
        sx={{
          position: 'fixed',
          bottom: 4,
          right: 8,
          fontSize: 10,
          color: '#999',
          textDecoration: 'none',
          zIndex: 9999,
          opacity: 0.6,
        }}
      >
        Privacy
      </Box>
      </Container>
    </>
  );
}
