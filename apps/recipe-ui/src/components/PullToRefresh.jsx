import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box, CircularProgress } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';

// JS-only pull-to-refresh. Translates the React #root element down with the
// pull so the whole page slides like a native UIScrollView, and renders a
// spinner via portal in the exposed gap above. On release past threshold,
// fires `onRefresh`; the spinner stays parked at ~70% of threshold while
// the refresh runs, then snaps back.
//
// Mount conditionally (`enabled`) so PTR only arms on views that have a
// feed worth refreshing.
export default function PullToRefresh({ onRefresh, enabled = true, threshold = 72 }) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Live gesture state lives in refs so the listener effect doesn't
  // re-bind on every move event.
  const startYRef = useRef(null);
  const startXRef = useRef(null);
  const distanceRef = useRef(0);
  const isRefreshingRef = useRef(false);
  const rootElRef = useRef(null);

  // Direct-DOM transform helper. We bypass React for the per-frame style
  // updates during the gesture — touchmove fires too fast for a state
  // round-trip and the result is GPU-cheap. SPRING_TRANSITION matches the
  // transition the spinner uses below so the page and the spinner glide
  // back together as one motion (otherwise the desync reads as "two steps").
  const SPRING_TRANSITION = 'transform 400ms cubic-bezier(0.4, 0, 0.2, 1)';
  const setRootTranslate = (px, animate) => {
    const el = rootElRef.current;
    if (!el) return;
    el.style.transition = animate ? SPRING_TRANSITION : '';
    el.style.transform = px === 0 ? '' : `translate3d(0, ${px}px, 0)`;
  };

  useEffect(() => {
    if (!enabled) return undefined;

    rootElRef.current = document.getElementById('root') || document.body;

    const getScrollTop = () =>
      window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;

    const onTouchStart = (e) => {
      if (isRefreshingRef.current) return;
      if (getScrollTop() > 0) {
        startYRef.current = null;
        startXRef.current = null;
        return;
      }
      const t = e.touches[0];
      startYRef.current = t.clientY;
      startXRef.current = t.clientX;
    };

    const onTouchMove = (e) => {
      if (startYRef.current == null || isRefreshingRef.current) return;
      const t = e.touches[0];
      const dy = t.clientY - startYRef.current;
      const dx = Math.abs(t.clientX - startXRef.current);

      // Ignore upward pulls and horizontal-dominant gestures (so recipe
      // shelves and other horizontal scrollers keep working).
      if (dy <= 0 || dy < dx) return;

      // Resistance: page travels at ~0.42x finger speed and softly caps a
      // bit beyond threshold so a very deep pull doesn't drag forever.
      const resistance = Math.min(dy / 2.4, threshold * 1.7);
      distanceRef.current = resistance;
      setPullDistance(resistance);
      setRootTranslate(resistance * 0.85, false);

      // Suppress the WebView's native rubber-band so our translation owns
      // the visual. Past a small dead zone so we don't fight micro-gestures.
      if (dy > 6) {
        try { e.preventDefault(); } catch { /* passive guard */ }
      }
    };

    const finishGesture = async () => {
      if (startYRef.current == null) return;
      startYRef.current = null;
      startXRef.current = null;
      const final = distanceRef.current;
      distanceRef.current = 0;

      if (final >= threshold) {
        isRefreshingRef.current = true;
        setIsRefreshing(true);
        // Spring to the parked refresh offset so the spinner has somewhere
        // to live while the network does its thing. Sit a little deeper
        // than the threshold so the spinner clears the safe-area notch
        // comfortably.
        setRootTranslate(threshold * 0.95, true);
        try {
          await onRefresh?.();
        } catch {
          // Caller's data path surfaces real errors; PTR just dismisses.
        }
        // Hold briefly so a fast network refresh is still perceptible.
        setTimeout(() => {
          isRefreshingRef.current = false;
          setIsRefreshing(false);
          setPullDistance(0);
          setRootTranslate(0, true);
        }, 280);
      } else {
        // Below threshold — snap back without firing onRefresh.
        setPullDistance(0);
        setRootTranslate(0, true);
      }
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', finishGesture, { passive: true });
    document.addEventListener('touchcancel', finishGesture, { passive: true });

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', finishGesture);
      document.removeEventListener('touchcancel', finishGesture);
      // Defensive reset in case the component unmounts mid-gesture.
      const el = rootElRef.current;
      if (el) {
        el.style.transition = '';
        el.style.transform = '';
      }
    };
  }, [enabled, threshold, onRefresh]);

  const progress = Math.min(pullDistance / threshold, 1);
  const visible = pullDistance > 0 || isRefreshing;
  // Indicator center tracks the page-top edge. As the page translates down
  // by `pullDistance * 0.85`, the spinner appears in the gap. Park position
  // matches the page-translate park (threshold * 0.95) so spinner + page
  // settle together when refreshing.
  const indicatorCenterY = isRefreshing
    ? threshold * 0.95
    : Math.min(pullDistance * 0.85, threshold);

  // Portal the indicator to body so it lives OUTSIDE the translating #root —
  // otherwise it'd inherit the transform and never appear in the exposed gap.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <Box
      aria-hidden
      sx={{
        position: 'fixed',
        // Anchor below the safe-area notch so the spinner clears the status
        // bar / Dynamic Island. The indicator's translate stacks on top of
        // this offset so the math above stays purely about pull distance.
        top: 'env(safe-area-inset-top, 0px)',
        left: '50%',
        transform: `translate(-50%, ${indicatorCenterY - 36}px)`,
        // Match the page transition exactly so the spinner and page glide
        // back as one motion. Opacity is snapped (not faded) so it doesn't
        // disappear early and add a perceived second step.
        transition: pullDistance === 0 || isRefreshing
          ? 'transform 400ms cubic-bezier(0.4, 0, 0.2, 1)'
          : 'none',
        opacity: visible ? Math.min(progress + 0.35, 1) : 0,
        pointerEvents: 'none',
        zIndex: 2000,
      }}
    >
      <Box
        sx={(t) => ({
          width: 36,
          height: 36,
          borderRadius: '50%',
          backgroundColor: t.palette.mode === 'dark' ? '#2a2c33' : '#fff',
          boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        })}
      >
        {isRefreshing ? (
          <CircularProgress size={18} thickness={5} />
        ) : (
          <RefreshIcon
            sx={{
              fontSize: 20,
              color: 'text.secondary',
              transform: `rotate(${progress * 270}deg)`,
              transition: 'transform 60ms linear',
            }}
          />
        )}
      </Box>
    </Box>,
    document.body
  );
}
