import { useState, useEffect } from 'react';
import { Box, Typography, IconButton, useTheme } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

const API_BASE_URL = import.meta.env.VITE_RECIPES_API_BASE_URL || '';

const SUGGESTION_GRADIENTS = [
  'linear-gradient(135deg, #f5a623, #e85d3a)',
  'linear-gradient(135deg, #43b89c, #1976d2)',
  'linear-gradient(135deg, #9b59b6, #e85d8a)',
  'linear-gradient(135deg, #27ae60, #f5a623)',
  'linear-gradient(135deg, #e74c3c, #9b59b6)',
];

function gradientFor(userId) {
  const first = (userId || '?').charCodeAt(0) || 0;
  return SUGGESTION_GRADIENTS[first % SUGGESTION_GRADIENTS.length];
}

function reasonText(s) {
  if (s.kind === 'fof') {
    const n = s.mutualCount;
    return `${n} mutual ${n === 1 ? 'friend' : 'friends'}`;
  }
  return s.sharedPref ? `Also into ${s.sharedPref}` : 'Fellow home cook';
}

function initialOf(name) {
  const trimmed = (name || '').trim();
  return trimmed ? trimmed[0].toUpperCase() : '?';
}

const FEED_STYLE = {
  gap: 1.5,
  cardSize: 150,
  cardHeight: 175,
  cardRadius: 3,
  cardPadding: '16px 10px 20px',
  closeTop: 4,
  closeRight: 4,
  closeIcon: 16,
  avatarSize: 48,
  avatarFont: 20,
  nameFont: 14,
  nameMt: '8px',
  reasonFont: 11,
  reasonMt: '6px',
  buttonWidth: '80%',
  buttonPy: '8px',
  buttonPx: '12px',
  buttonFont: 12,
  headerJustify: 'space-between',
  bleedMr: { xs: -2, sm: -3, md: -4 },
};

const COMPACT_STYLE = {
  gap: 1,
  cardSize: 128,
  cardHeight: 152,
  cardRadius: 2.5,
  cardPadding: '12px 8px 14px',
  closeTop: 2,
  closeRight: 2,
  closeIcon: 14,
  avatarSize: 40,
  avatarFont: 17,
  nameFont: 13,
  nameMt: '6px',
  reasonFont: 10.5,
  reasonMt: '4px',
  buttonWidth: '88%',
  buttonPy: '6px',
  buttonPx: '10px',
  buttonFont: 11,
  headerJustify: 'center',
  bleedMr: -2,
};

/**
 * Self-contained "Friends you may know" shelf.
 * Props:
 *   accessToken: string (required for live fetch + add-friend POST)
 *   onOpenFriends?: () => void — if provided, renders "See all"
 *   variant?: 'feed' | 'compact' — 'feed' for home feed, 'compact' for drawer
 *   suggestions?: Array — test-only override; skips the fetch when provided
 */
export default function SuggestionsShelf({ accessToken, onOpenFriends, variant = 'feed', suggestions: suggestionsProp }) {
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  const v = variant === 'compact' ? COMPACT_STYLE : FEED_STYLE;
  const [suggestions, setSuggestions] = useState(suggestionsProp || []);
  const [loading, setLoading] = useState(suggestionsProp === undefined);
  const [requestedIds, setRequestedIds] = useState(() => new Set());
  const [dismissedIds, setDismissedIds] = useState(() => new Set());

  useEffect(() => {
    if (suggestionsProp !== undefined) return;
    if (!accessToken) return;
    let cancelled = false;
    fetch(`${API_BASE_URL}/friends/suggestions`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled) return;
        setSuggestions(data?.suggestions || []);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSuggestions([]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, suggestionsProp]);

  async function handleAdd(userId) {
    setRequestedIds(prev => new Set([...prev, userId]));
    try {
      const res = await fetch(`${API_BASE_URL}/friends/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok && res.status >= 500) {
        setRequestedIds(prev => {
          const next = new Set(prev);
          next.delete(userId);
          return next;
        });
      }
    } catch (_) {
      setRequestedIds(prev => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  }

  function handleDismiss(userId) {
    setDismissedIds(prev => new Set([...prev, userId]));
  }

  if (loading) return null;
  const visible = suggestions.filter(s => !dismissedIds.has(s.userId));
  if (visible.length === 0) return null;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: v.headerJustify, alignItems: 'center', mb: 2 }}>
        <Typography sx={{ fontWeight: 700, fontSize: 13, color: 'text.primary' }}>
          Friends You May Know
        </Typography>
        {onOpenFriends && (
          <Typography
            component="button"
            type="button"
            aria-label="See all friend suggestions"
            onClick={onOpenFriends}
            sx={{
              background: 'none',
              border: 'none',
              p: 0,
              cursor: 'pointer',
              color: 'text.secondary',
              fontSize: 13,
              fontFamily: 'inherit',
              '&:focus-visible': {
                outline: '2px solid',
                outlineColor: 'primary.main',
                outlineOffset: 2,
                borderRadius: 1,
              },
            }}
          >
            See all
          </Typography>
        )}
      </Box>
      <Box
        sx={{
          display: 'flex',
          gap: v.gap,
          overflowX: 'auto',
          pb: 0.5,
          mr: v.bleedMr,
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {visible.map(s => {
          const isRequested = requestedIds.has(s.userId);
          return (
            <Box
              key={s.userId}
              sx={{
                position: 'relative',
                minWidth: v.cardSize,
                maxWidth: v.cardSize,
                height: v.cardHeight,
                bgcolor: dark ? 'transparent' : 'background.paper',
                border: '1px solid',
                borderColor: dark ? 'rgba(255,255,255,0.08)' : 'divider',
                borderRadius: v.cardRadius,
                p: v.cardPadding,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                boxShadow: dark ? 'none' : '0 1px 3px rgba(0,0,0,0.06)',
                flexShrink: 0,
              }}
            >
              <IconButton
                aria-label={`Dismiss ${s.name}`}
                size="small"
                onClick={() => handleDismiss(s.userId)}
                sx={{
                  position: 'absolute',
                  top: v.closeTop,
                  right: v.closeRight,
                  color: 'text.secondary',
                  p: 0.25,
                }}
              >
                <CloseIcon sx={{ fontSize: v.closeIcon }} />
              </IconButton>
              <Box
                sx={{
                  width: v.avatarSize,
                  height: v.avatarSize,
                  borderRadius: '50%',
                  background: gradientFor(s.userId),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: v.avatarFont,
                  fontWeight: 700,
                  color: '#fff',
                  flexShrink: 0,
                }}
              >
                {initialOf(s.name)}
              </Box>
              <Typography
                sx={{
                  fontWeight: 600,
                  fontSize: v.nameFont,
                  textAlign: 'center',
                  mt: v.nameMt,
                  lineHeight: 1.2,
                  width: '100%',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {s.name}
              </Typography>
              <Typography
                sx={{
                  mt: v.reasonMt,
                  fontSize: v.reasonFont,
                  color: 'text.secondary',
                  textAlign: 'center',
                  lineHeight: 1.3,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {reasonText(s)}
              </Typography>
              <Box
                component="button"
                disabled={isRequested}
                onClick={() => !isRequested && handleAdd(s.userId)}
                sx={{
                  mt: 'auto',
                  flexShrink: 0,
                  width: v.buttonWidth,
                  background: 'transparent',
                  color: dark ? '#34d399' : '#059669',
                  border: '1px solid',
                  borderColor: dark ? 'rgba(52,211,153,0.5)' : '#10b981',
                  borderRadius: '999px',
                  py: v.buttonPy,
                  px: v.buttonPx,
                  fontSize: v.buttonFont,
                  fontWeight: 700,
                  fontFamily: 'inherit',
                  lineHeight: 1,
                  cursor: isRequested ? 'default' : 'pointer',
                  opacity: isRequested ? 0.55 : 1,
                }}
              >
                {isRequested ? 'Requested' : 'Add Friend'}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
