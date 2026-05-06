import { useState, useEffect, useRef } from 'react';
import { Box, Typography, Stack, Button, Dialog, DialogContent } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CloseIcon from '@mui/icons-material/Close';
import SuggestionsShelf from './SuggestionsShelf';
import RecipeThumbnail from './RecipeThumbnail';

const API_BASE_URL = import.meta.env.VITE_RECIPES_API_BASE_URL || '';

async function fetchJson(path, token) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!res.ok) return null;
  return res.json();
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (isNaN(diffMs)) return '';
  const diffH = Math.floor(diffMs / 3600000);
  if (diffH < 1) return 'just now';
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return diffD === 1 ? 'yesterday' : `${diffD}d`;
}

/**
 * Logged-in friend discovery sections.
 * Props:
 *   accessToken: string
 *   onOpenRecipe: (recipe) => void
 *   onSaveRecipe: (recipe) => void
 *   onOpenFriends?: () => void — opens the friends management drawer (threaded into "See all" on the suggestions shelf)
 *   onAcceptFriendRequest?: (fromUserId) => Promise<void> — called when user taps Accept on a friend_request activity item
 *   onDeclineFriendRequest?: (fromUserId) => Promise<void> — called when user taps Decline on a friend_request activity item
 */
export default function FriendSections({ accessToken, onOpenRecipe, onSaveRecipe, onShareRecipe, onInviteFriend, onOpenFriends, onSuggestionTap, onAcceptFriendRequest, onDeclineFriendRequest, darkMode, onCookWithFriendsVisible }) {
  const [unifiedFeed, setUnifiedFeed] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [requestDialogItem, setRequestDialogItem] = useState(null);
  const [requestDialogBusy, setRequestDialogBusy] = useState(false);

  // Local helper: replace one item in the unified feed (used by accept/decline
  // flow which previously mutated `activity` directly).
  const updateFeedItem = (id, updater) => {
    setUnifiedFeed((prev) => prev.map((a) => (a.id === id ? updater(a) : a)));
  };
  const removeFeedItem = (id) => {
    setUnifiedFeed((prev) => prev.filter((a) => a.id !== id));
  };

  async function handleRequestAccept() {
    if (!requestDialogItem || requestDialogBusy) return;
    setRequestDialogBusy(true);
    try {
      await onAcceptFriendRequest?.(requestDialogItem.fromUserId);
      // Accepted — keep the row visible but flag it resolved so it renders
      // with a checkmark and can't be tapped again.
      updateFeedItem(requestDialogItem.id, (a) => ({ ...a, resolved: true }));
      setRequestDialogItem(null);
    } finally {
      setRequestDialogBusy(false);
    }
  }

  async function handleRequestDecline() {
    if (!requestDialogItem || requestDialogBusy) return;
    setRequestDialogBusy(true);
    try {
      await onDeclineFriendRequest?.(requestDialogItem.fromUserId);
      // Declined — remove the row entirely.
      removeFeedItem(requestDialogItem.id);
      setRequestDialogItem(null);
    } finally {
      setRequestDialogBusy(false);
    }
  }

  useEffect(() => {
    if (!accessToken) return;
    Promise.all([
      fetchJson('/friends/activity', accessToken),
      fetchJson('/friends/recently-saved', accessToken),
      fetchJson('/friends/recently-shared', accessToken),
    ]).then(([act, saved, shared]) => {
      const merged = [
        ...(act?.activity || []).map((a) => ({ ...a, _kind: 'activity' })),
        ...(saved?.items || []).map((i) => ({
          id: `saved-${i.recipe.id}`,
          type: 'friend_saved_recipe',
          friendName: i.friendName,
          recipe: i.recipe,
          createdAt: i.createdAt || new Date().toISOString(),
          _kind: 'saved',
        })),
        ...(shared?.items || []).map((i) => ({
          id: `shared-${i.recipe.id}`,
          type: 'friend_shared_recipe',
          friendName: i.friendName,
          recipe: i.recipe,
          createdAt: i.createdAt || new Date().toISOString(),
          _kind: 'shared',
        })),
      ];
      merged.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      // Dedup by friendName + canonicalType + recipeId so the same save
      // doesn't appear twice when both /activity and /recently-saved return
      // it. friend_saved_your_recipe (specific, "saved your recipe X") and
      // friend_saved_recipe (generic, "saved X") collapse to the same key
      // when they reference the same recipe; the more specific one wins
      // since notifications are added after the recipe insert and therefore
      // sort first.
      const SAVE_TYPE_CANONICAL = 'saved';
      const canonicalType = (t) =>
        (t === 'friend_saved_recipe' || t === 'friend_saved_your_recipe')
          ? SAVE_TYPE_CANONICAL
          : t;
      const seen = new Set();
      const dedup = merged.filter((item) => {
        const key = `${item.friendName}|${canonicalType(item.type)}|${item.recipe?.id || item.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setUnifiedFeed(dedup);
      setLoaded(true);
    });
  }, [accessToken]);

  const cookWithFriendsRef = useRef(null);

  useEffect(() => {
    const el = cookWithFriendsRef.current;
    if (!el || !onCookWithFriendsVisible) return;
    const observer = new IntersectionObserver(
      ([entry]) => onCookWithFriendsVisible(entry.isIntersecting),
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [onCookWithFriendsVisible, loaded]);

  if (!loaded) return null;

  return (
    <Stack sx={{ gap: '32px' }}>
      {unifiedFeed.length > 0 && (
        <Box>
          <SectionLabel>Friend Activity</SectionLabel>
          <FriendActivityTicker
            items={unifiedFeed}
            onOpenRecipe={onOpenRecipe}
            onOpenFriendRequest={(it) => setRequestDialogItem(it)}
          />
        </Box>
      )}

      <SuggestionsShelf accessToken={accessToken} onTapCard={onSuggestionTap} />

      <Box ref={cookWithFriendsRef}>
        <CookWithFriends onInvite={onInviteFriend} darkMode={darkMode} />
      </Box>

      <FriendRequestDialog
        item={requestDialogItem}
        busy={requestDialogBusy}
        onAccept={handleRequestAccept}
        onDecline={handleRequestDecline}
        onClose={() => !requestDialogBusy && setRequestDialogItem(null)}
      />

    </Stack>
  );
}

function FriendRequestDialog({ item, busy, onAccept, onDecline, onClose }) {
  if (!item) return null;
  const friendName = item.friendName || '?';
  const initial = friendName.charAt(0).toUpperCase();
  const color = AVATAR_COLORS[Math.abs(item.id) % AVATAR_COLORS.length];
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogContent sx={{ position: 'relative', textAlign: 'center', py: 4, px: 3 }}>
        {/* iOS-style X close on the top-left, matches AddFriendDrawer / friend-recipes drawer */}
        <Box
          component="button"
          aria-label="Close"
          onClick={onClose}
          disabled={busy}
          sx={(theme) => ({
            position: 'absolute',
            top: 12, left: 12,
            width: 36, height: 36, borderRadius: '50%',
            bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
            color: '#8a8a8a',
            border: 'none',
            cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.55 : 1,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            WebkitTapHighlightColor: 'transparent',
            transition: 'background-color 150ms ease, transform 150ms ease',
            '&:hover': { bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)' },
            '&:active': { transform: busy ? 'none' : 'scale(0.92)' },
          })}
        >
          <CloseIcon sx={{ fontSize: 18 }} />
        </Box>
        <Box sx={{
          width: 64, height: 64, borderRadius: '50%', bgcolor: color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          mx: 'auto', mb: 2,
        }}>
          <Typography sx={{ color: '#fff', fontSize: 26, fontWeight: 700 }}>{initial}</Typography>
        </Box>
        <Typography sx={{ fontWeight: 700, fontSize: 18, mb: 0.5 }}>{friendName}</Typography>
        <Typography sx={{ color: 'text.secondary', fontSize: 14, mb: 3 }}>
          wants to connect on ReciFriend
        </Typography>
        <Stack direction="row" gap={1.5} justifyContent="center">
          <Box
            component="button"
            onClick={onDecline}
            disabled={busy}
            aria-label="Decline friend request"
            sx={{
              background: 'transparent',
              color: 'text.secondary',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: '999px',
              py: '10px',
              px: '24px',
              fontSize: 14,
              fontWeight: 700,
              fontFamily: 'inherit',
              lineHeight: 1,
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.55 : 1,
            }}
          >
            Decline
          </Box>
          <Box
            component="button"
            onClick={onAccept}
            disabled={busy}
            aria-label="Accept friend request"
            sx={{
              background: '#10b981',
              color: '#fff',
              border: 'none',
              borderRadius: '999px',
              py: '10px',
              px: '24px',
              fontSize: 14,
              fontWeight: 700,
              fontFamily: 'inherit',
              lineHeight: 1,
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.55 : 1,
            }}
          >
            Accept
          </Box>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

function SectionLabel({ children }) {
  return <Typography fontWeight={700} fontSize={13} sx={{ color: 'text.primary', mb: '10px' }}>{children}</Typography>;
}

// ── Friend Activity ticker ─────────────────────────────────────────────────
// Vertical scroll ticker. Window of 3 rows visible. Every FA_HOLD_MS, the top
// row rolls up out of view, rows 2 & 3 roll up to take its place, and the
// next item reveals at the bottom. When the user taps "show N more", the
// animation pauses and the full list renders statically.
const FA_VISIBLE = 3;
const FA_MAX_ITEMS = 10;           // cap on total items the ticker will show
const FA_ROW_HEIGHT = 64;          // px; matches the strip card's min-height
const FA_GAP = 14;                 // px between rows
const FA_STEP = FA_ROW_HEIGHT + FA_GAP;
const FA_HOLD_MS = 4000;           // delay between scroll steps
const FA_SLIDE_MS = 600;           // duration of each scroll step
const FA_SLIDE_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';
// Horizontal padding inside the overflow:hidden container so the strip card
// shadows aren't clipped at the sides. Negative outer margin pulls the
// container back outward so cards stay visually flush with parent content.
const FA_SIDE_PAD = 8;

function FriendActivityTicker({ items, onOpenRecipe, onOpenFriendRequest }) {
  // Cap the pool the ticker will ever surface. Excess items are dropped.
  const cappedItems = items.slice(0, FA_MAX_ITEMS);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const innerRef = useRef(null);

  // Tick once per FA_HOLD_MS until the bottom-most frame is reached, then
  // stop. We use a self-scheduling timeout (re-armed on each idx change)
  // instead of setInterval so the cycle ends naturally when idx hits the
  // last useful frame.
  useEffect(() => {
    if (paused) return;
    if (cappedItems.length <= FA_VISIBLE) return;
    const maxIdx = cappedItems.length - FA_VISIBLE;
    if (idx >= maxIdx) return;
    const t = setTimeout(() => {
      setIdx((i) => Math.min(i + 1, maxIdx));
    }, FA_HOLD_MS);
    return () => clearTimeout(t);
  }, [paused, cappedItems.length, idx]);

  // When paused (expanded) — render the (capped) full list as a static stack
  // with a "Show less" link to return to the animated ticker.
  if (paused) {
    return (
      <>
        <Stack spacing={`${FA_GAP}px`}>
          {cappedItems.map((item) => (
            <ActivityStrip key={item.id} item={item} onOpenRecipe={onOpenRecipe} onOpenFriendRequest={onOpenFriendRequest} />
          ))}
        </Stack>
        <Typography
          component="button"
          onClick={() => { setPaused(false); setIdx(0); }}
          sx={{
            background: 'none', border: 'none', p: 0,
            mt: 2.5, cursor: 'pointer',
            fontSize: 12, fontWeight: 500,
            color: (theme) => theme.palette.mode === 'dark' ? 'primary.light' : 'primary.main',
            fontFamily: 'inherit',
          }}
        >
          Show less
        </Typography>
      </>
    );
  }

  // No looping: just render the capped items in order. The ticker stops
  // scrolling once the bottom-most frame is reached.
  const renderList = cappedItems;
  const moreCount = Math.max(0, cappedItems.length - FA_VISIBLE);

  return (
    <>
      <Box
        sx={{
          height: FA_ROW_HEIGHT * FA_VISIBLE + (FA_VISIBLE - 1) * FA_GAP,
          overflow: 'hidden',
          position: 'relative',
          // Breathing room so strip-card shadows aren't clipped at the
          // sides; outer mx pulls the container back so cards stay flush
          // with the rest of the page content.
          px: `${FA_SIDE_PAD}px`,
          mx: `-${FA_SIDE_PAD}px`,
          // Vertical fade on top + bottom: visually softens the roll-out of
          // the top card and the roll-in of the new bottom card. As a side
          // effect, hides the bottom shadow's clip line at the container
          // edges (the shadow fades through the mask).
          maskImage: 'linear-gradient(to bottom, transparent 0, black 24px, black calc(100% - 24px), transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, black 24px, black calc(100% - 24px), transparent 100%)',
        }}
      >
        <Box
          ref={innerRef}
          sx={{
            display: 'flex', flexDirection: 'column', gap: `${FA_GAP}px`,
            transform: `translateY(${-idx * FA_STEP}px)`,
            transition: `transform ${FA_SLIDE_MS}ms ${FA_SLIDE_EASE}`,
            willChange: 'transform',
          }}
        >
          {renderList.map((item, i) => (
            <ActivityStrip
              key={`${item.id}-${i}`}
              item={item}
              onOpenRecipe={onOpenRecipe}
              onOpenFriendRequest={onOpenFriendRequest}
            />
          ))}
        </Box>
      </Box>
      {moreCount > 0 && (
        <Typography
          component="button"
          onClick={() => setPaused(true)}
          sx={{
            background: 'none', border: 'none', p: 0,
            mt: 2.5, cursor: 'pointer',
            fontSize: 12, fontWeight: 500,
            color: (theme) => theme.palette.mode === 'dark' ? 'primary.light' : 'primary.main',
            fontFamily: 'inherit',
          }}
        >
          + show {moreCount} more
        </Typography>
      )}
    </>
  );
}

// Single activity row rendered as a pill-card strip with its own shadow.
function ActivityStrip({ item, onOpenRecipe, onOpenFriendRequest }) {
  return (
    <Box sx={{
      bgcolor: 'background.paper',
      borderRadius: '12px',
      boxShadow: (theme) => theme.palette.mode === 'dark'
        ? '0 0 0 1px rgba(255,255,255,0.10)'
        : '0 1px 4px rgba(0,0,0,.08)',
      minHeight: FA_ROW_HEIGHT,
      display: 'flex', alignItems: 'center',
    }}>
      <ActivityItem item={item} onOpenRecipe={onOpenRecipe} onOpenFriendRequest={onOpenFriendRequest} />
    </Box>
  );
}

// ── Cook with Friends ──
const CWF_TICKER_ITEMS = [
  { initial: 'E', name: 'Elisa', color: '#7c3aed', lightColor: '#a78bfa', text: 'saved Miso Ramen ❤️', time: '2h' },
  { initial: 'H', name: 'Henny', color: '#10b981', lightColor: '#34d399', text: 'shared Beef Stew with you', time: '5h' },
  { initial: 'M', name: 'Max',   color: '#f59e0b', lightColor: '#fbbf24', text: 'is cooking Tacos tonight 🌮', time: 'now' },
  { initial: 'H', name: 'Henny', color: '#10b981', lightColor: '#34d399', text: 'saved Salmon Bowl 🐟', time: '3h' },
  { initial: 'M', name: 'Max',   color: '#f59e0b', lightColor: '#fbbf24', text: 'saved Chicken Tikka Masala 🍛', time: '6h' },
];
const CWF_HOLD_MS = 2800, CWF_OUT_MS = 450, CWF_IN_MS = 550, CWF_OVERLAP_MS = 150;
const CWF_OUT_EASE = 'cubic-bezier(0.4,0,1,1)', CWF_IN_EASE = 'cubic-bezier(0,0,0.2,1)';

function CwfTicker() {
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
      prevEl.style.transition = `opacity ${CWF_OUT_MS}ms ${CWF_OUT_EASE}, transform ${CWF_OUT_MS}ms ${CWF_OUT_EASE}`;
      prevEl.style.opacity = '0';
      prevEl.style.transform = 'translateY(-14px)';
      enterTimer = setTimeout(() => {
        const nextEl = items[next];
        nextEl.style.transition = `opacity ${CWF_IN_MS}ms ${CWF_IN_EASE}, transform ${CWF_IN_MS}ms ${CWF_IN_EASE}`;
        nextEl.style.opacity = '1';
        nextEl.style.transform = 'translateY(0)';
      }, CWF_OUT_MS - CWF_OVERLAP_MS);
      resetTimer = setTimeout(() => {
        prevEl.style.transition = 'none';
        prevEl.style.opacity = '0';
        prevEl.style.transform = 'translateY(20px)';
      }, CWF_OUT_MS + 80);
    };
    const interval = setInterval(cycle, CWF_HOLD_MS + CWF_OUT_MS);
    return () => { clearInterval(interval); clearTimeout(enterTimer); clearTimeout(resetTimer); };
  }, []);
  return (
    <Box sx={{ position: 'relative', height: 44, overflow: 'hidden', mb: 1.5 }}>
      {CWF_TICKER_ITEMS.map((item, i) => (
        <Box key={i} ref={el => { refs.current[i] = el; }}
          style={{ opacity: i === 0 ? 1 : 0, transform: i === 0 ? 'translateY(0)' : 'translateY(20px)' }}
          sx={{ position: 'absolute', inset: 0, bgcolor: 'background.paper', borderRadius: 2, display: 'flex', alignItems: 'center', gap: 1, px: 1.5, willChange: 'opacity, transform' }}
        >
          <Box sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: item.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Typography sx={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>{item.initial}</Typography>
          </Box>
          <Typography variant="caption" sx={{ flex: 1, fontSize: 11, color: 'text.secondary', lineHeight: 1.2 }}>
            <Box component="span" sx={{ color: t => t.palette.mode === 'dark' ? item.lightColor : item.color, fontWeight: 600 }}>{item.name}</Box>{' '}{item.text}
          </Typography>
          <Typography variant="caption" sx={{ fontSize: 10, color: 'text.disabled', flexShrink: 0 }}>{item.time}</Typography>
        </Box>
      ))}
    </Box>
  );
}

function CookWithFriends({ onInvite, darkMode }) {
  return (
    <Box sx={{
      borderRadius: 3, p: 2, border: 1, borderColor: 'divider',
      background: darkMode ? 'linear-gradient(135deg,#1a0f2e,#0f1a2e)' : 'linear-gradient(135deg,#f3f0ff,#e8f4fd)',
      display: 'flex', flexDirection: 'column',
    }}>
      <Typography fontWeight={700} fontSize={13} mb={0.5}>Cook with Friends</Typography>
      <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
        Share recipes and see what your friends are cooking.
      </Typography>
      <CwfTicker />
      <Button variant="outlined" onClick={onInvite}
        sx={{
          borderRadius: 20, textTransform: 'none', fontWeight: 700, alignSelf: 'center', px: 3,
          color: t => t.palette.mode === 'dark' ? t.palette.primary.light : t.palette.primary.main,
          borderColor: t => t.palette.mode === 'dark' ? t.palette.primary.light : t.palette.primary.main,
          '&:hover': { borderColor: t => t.palette.mode === 'dark' ? t.palette.primary.light : t.palette.primary.main },
        }}>
        Invite Friends
      </Button>
    </Box>
  );
}

const AVATAR_COLORS = ['#7c3aed', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];

const VERB_MAP = {
  friend_cooked_recipe: 'cooked',
  friend_saved_recipe: 'saved',
  friend_shared_recipe: 'shared',
  friend_saved_your_recipe: 'saved your recipe',
};

// Notification types that carry a recipe — show structured sentence + thumbnail
const RECIPE_TYPES = new Set([
  'friend_cooked_recipe',
  'friend_saved_recipe',
  'friend_shared_recipe',
  'friend_saved_your_recipe',
]);

export function ActivityItem({ item, onOpenRecipe, onOpenFriendRequest }) {
  const friendName = item.friendName ?? '?';
  // Hash friendName (string-safe; same friend gets the same color across
  // multiple activities). The previous version hashed item.id which broke
  // for the merged feed's synthetic string ids ("saved-..." / "shared-...")
  // because Math.abs(string) is NaN — leaving the avatar with no bg color.
  const color = (() => {
    const seed = String(friendName);
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
    return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
  })();
  const initial = friendName.charAt(0).toUpperCase();
  const isRecipeNotif = RECIPE_TYPES.has(item.type) && item.recipe;
  // friend_request items are "resolved" once the pending row is gone on the
  // server (accepted via email or via this UI, or declined). Resolved items
  // render with a checkmark and are not tappable.
  const isFriendRequest =
    item.type === 'friend_request' &&
    typeof item.fromUserId === 'string' &&
    item.fromUserId.length > 0 &&
    !item.resolved;
  const isResolvedFriendRequest = item.type === 'friend_request' && item.resolved;
  const isClickable = isRecipeNotif || isFriendRequest;

  function handleClick() {
    if (isRecipeNotif) onOpenRecipe?.(item.recipe);
    else if (isFriendRequest) onOpenFriendRequest?.(item);
  }

  const ariaLabel = isRecipeNotif
    ? `View ${item.recipe.title}`
    : isFriendRequest
      ? `Respond to friend request from ${friendName}`
      : undefined;

  return (
    <Box
      onClick={handleClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      aria-label={ariaLabel}
      onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(); } : undefined}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        px: 1.25,
        py: '8px',
        cursor: isClickable ? 'pointer' : 'default',
        '&:hover': isClickable ? { bgcolor: 'action.hover' } : {},
        '&:focus-visible': isClickable ? { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '-2px' } : {},
      }}
    >
      {/* Avatar */}
      <Box sx={{
        width: 32, height: 32, borderRadius: '50%', bgcolor: color,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Typography sx={{ color: '#fff', fontSize: 13, fontWeight: 700, lineHeight: 1 }}>{initial}</Typography>
      </Box>

      {isRecipeNotif ? (
        /* Recipe notification: "Sarah saved Spicy Thai Noodles".
           minWidth:0 + wordBreak:break-word ensure long titles or unbreakable
           words can't push the timestamp + thumbnail out of their fixed
           positions; the 2-line clamp + overflow:hidden clip the excess. */
        <Typography sx={{
          flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.4,
          wordBreak: 'break-word',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>{friendName}</Box>
          <Box component="span" sx={{ color: 'text.secondary' }}> {VERB_MAP[item.type]} </Box>
          <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>{item.recipe.title}</Box>
        </Typography>
      ) : (
        /* Connection notification: use pre-formatted message from the server */
        <Typography sx={{
          flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.4, color: 'text.secondary',
          wordBreak: 'break-word',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {item.message}
        </Typography>
      )}

      {/* Resolved friend-request checkmark — shown instead of leaving the
          row tappable once the pending request is gone on the server. */}
      {isResolvedFriendRequest && (
        <CheckCircleOutlineIcon
          aria-label="Friend request accepted"
          sx={{ fontSize: 18, color: '#10b981', flexShrink: 0 }}
        />
      )}

      {/* Timestamp */}
      <Typography sx={{ fontSize: 10, color: 'text.disabled', flexShrink: 0 }}>
        {timeAgo(item.createdAt)}
      </Typography>

      {/* Thumbnail — only for recipe notifications. Gradient + initial
          letter fallback handled by RecipeThumbnail when src is missing or
          fails to load. */}
      {isRecipeNotif && (
        <Box sx={{
          width: 44, height: 44, borderRadius: '8px', flexShrink: 0,
          overflow: 'hidden',
        }}>
          <RecipeThumbnail src={item.recipe.imageUrl} title={item.recipe.title} fontSize={18} />
        </Box>
      )}
    </Box>
  );
}
