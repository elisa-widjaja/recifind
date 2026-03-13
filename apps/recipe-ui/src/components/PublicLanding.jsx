import { useState, useEffect, useRef } from 'react';
import {
  Box, Container, Typography, Button, Stack, Chip,
  Tooltip, Fab
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import RecipeShelf from './RecipeShelf';
import DiscoverRecipes from './DiscoverRecipes';
import RecipeListCard from './RecipeListCard';

const API_BASE_URL = import.meta.env.VITE_RECIPES_API_BASE_URL || '';

function isSocialVideoRecipe(url) {
  if (!url) return false;
  return url.includes('youtube.com') || url.includes('youtu.be')
    || url.includes('tiktok.com') || url.includes('instagram.com');
}

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
export default function PublicLanding({ onJoin, onOpenRecipe, darkMode, onShare }) {
  const [trending, setTrending] = useState([]);
  const [editorsPick, setEditorsPick] = useState([]);
  const [aiPicks, setAiPicks] = useState([]);
  const [editorsExpanded, setEditorsExpanded] = useState(false);
  const [fabVisible, setFabVisible] = useState(true);
  const cookWithFriendsRef = useRef(null);

  useEffect(() => {
    fetchJson('/public/trending-recipes').then(d => setTrending(d?.recipes || []));
    fetchJson('/public/editors-pick').then(d => setEditorsPick(d?.recipes || []));
    fetchJson('/public/ai-picks').then(d => setAiPicks(d?.picks || []));
  }, []);

  useEffect(() => {
    const el = cookWithFriendsRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setFabVisible(!entry.isIntersecting),
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const visibleEditors = editorsExpanded ? editorsPick : editorsPick.slice(0, 3);

  const allVideoRecipes = trending.filter(r => isSocialVideoRecipe(r.sourceUrl));
  const youtubeShorts = allVideoRecipes.filter(r => r.sourceUrl?.includes('/shorts/')).slice(0, 2);
  const instagramRecipes = allVideoRecipes.filter(r => r.sourceUrl?.includes('instagram.com')).slice(0, 2);
  const tiktokRecipes = allVideoRecipes.filter(r => r.sourceUrl?.includes('tiktok.com')).slice(0, 1);
  const videoRecipes = [...youtubeShorts, ...instagramRecipes, ...tiktokRecipes];

  return (
    <Container maxWidth="sm" disableGutters>
      <Box sx={{ px: { xs: 2, sm: 3 }, pb: 6 }}>

<Stack spacing={3} sx={{ pt: '20px' }}>

          {/* ── Section 1: Trending ── */}
          {trending.length > 0 && (
            <Box>
              <SectionLabel label="Trending Now" />
              <RecipeShelf
                recipes={trending}
                onSave={onJoin}
                onShare={(recipe, e) => onShare?.(recipe, e)}
                onOpen={onOpenRecipe}
                cardWidth={180}
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

          {/* ── Section 2: Editor's Pick ── */}
          {editorsPick.length > 0 && (
            <Box>
              <SectionLabel label="Editor's Picks" />
              <Stack spacing={1}>
                {visibleEditors.map(recipe => (
                  <RecipeListCard key={recipe.id} recipe={recipe} onSave={onJoin} onShare={onShare} onOpen={onOpenRecipe} />
                ))}
              </Stack>
              {editorsPick.length > 3 && (
                <Button size="small" onClick={() => setEditorsExpanded(e => !e)}
                  sx={{ mt: 0.5, fontSize: 11, textTransform: 'none', color: 'text.secondary' }}>
                  {editorsExpanded ? 'Show less' : `+ ${editorsPick.length - 3} more picks`}
                </Button>
              )}
            </Box>
          )}

          {/* ── Section 3: AI Picks ── */}
          {aiPicks.length > 0 && (
            <Box>
              <SectionLabel label="Trending in health and nutrition" />
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1.5, overflow: 'hidden', maxHeight: '52px' }}>
                {aiPicks.map(p => (
                  <Box key={p.topic} sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                    <Chip
                      label={p.hashtag}
                      size="small"
                      variant="outlined"
                      sx={{ color: darkMode ? '#fff' : 'text.secondary', borderColor: 'divider', fontSize: 11, height: 20, borderRadius: '10px' }}
                    />
                    {p.reason && (
                      <Tooltip
                        title={p.reason}
                        enterTouchDelay={0}
                        leaveTouchDelay={4000}
                        arrow
                      >
                        <InfoOutlinedIcon sx={{ fontSize: 13, color: 'text.disabled', cursor: 'pointer' }} />
                      </Tooltip>
                    )}
                  </Box>
                ))}
              </Box>
              <RecipeShelf
                recipes={aiPicks
                  .filter(p => {
                    const { ingredients = [], steps = [] } = p.recipe;
                    const clean = items => items.length > 0 && items.every(s =>
                      s.length <= 200 && !/\d+[Kk]?\s+likes/i.test(s) &&
                      !/\d+\s+comments/i.test(s) && !/@\w{3,}/.test(s) && !/^\s*#\w+/.test(s)
                    );
                    return clean(ingredients) && clean(steps);
                  })
                  .map(p => ({ ...p.recipe, _hashtag: p.hashtag, _topic: p.topic }))}
                onSave={onJoin} onShare={(recipe, e) => onShare?.(recipe, e)} onOpen={onOpenRecipe} cardWidth={180} gap="8px"
              />
            </Box>
          )}

          {/* ── Section 4: Cook with Friends ── */}
          <Box ref={cookWithFriendsRef}>
            <CookWithFriends onJoin={onJoin} darkMode={darkMode} />
          </Box>

        </Stack>
      </Box>

      {/* ── Floating Join CTA — hidden when Cook with Friends is visible ── */}
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
          transition: 'opacity 0.25s, transform 0.25s',
          opacity: fabVisible ? 1 : 0,
          pointerEvents: fabVisible ? 'auto' : 'none',
          '&:hover': { bgcolor: 'primary.dark' },
        }}
      >
        Join Free
      </Fab>
    </Container>
  );
}

function SectionLabel({ emoji, label, inline = false }) {
  const el = (
    <Typography fontWeight={700} fontSize={13} sx={{ color: 'text.primary' }}>
      {emoji ? `${emoji} ` : ''}{label}
    </Typography>
  );
  if (inline) return el;
  return <Box sx={{ mb: 1 }}>{el}</Box>;
}

// Flat list of ticker items — one white card shows at a time, cycling through all
const TICKER_ITEMS = [
  { initial: 'E', name: 'Elisa', color: '#7c3aed', text: 'saved Miso Ramen ❤️', time: '2h' },
  { initial: 'H', name: 'Henny', color: '#10b981', text: 'shared Beef Stew with you', time: '5h' },
  { initial: 'M', name: 'Max',   color: '#f59e0b', text: 'is cooking Tacos tonight 🌮', time: 'now' },
  { initial: 'H', name: 'Henny', color: '#10b981', text: 'saved Salmon Bowl 🐟', time: '3h' },
  { initial: 'M', name: 'Max',   color: '#f59e0b', text: 'saved Chicken Tikka Masala 🍛', time: '6h' },
];

const HOLD_MS    = 2800;
const OUT_MS     = 450;
const IN_MS      = 550;
const OVERLAP_MS = 150;
const OUT_EASE   = 'cubic-bezier(0.4, 0, 1, 1)';
const IN_EASE    = 'cubic-bezier(0, 0, 0.2, 1)';

// One slot — only one white card visible at a time, whole card animates in/out
function ActivityTicker() {
  const refs = useRef([]);
  const currentIdx = useRef(0);

  useEffect(() => {
    const items = refs.current;
    if (!items.length) return;

    let enterTimer = null;
    let resetTimer = null;

    const cycle = () => {
      const prev = currentIdx.current;
      const next = (prev + 1) % items.length;
      currentIdx.current = next;

      // Exit current card — fade up and out
      const prevEl = items[prev];
      prevEl.style.transition = `opacity ${OUT_MS}ms ${OUT_EASE}, transform ${OUT_MS}ms ${OUT_EASE}`;
      prevEl.style.opacity = '0';
      prevEl.style.transform = 'translateY(-14px)';

      // Enter next card — slide in from below, overlapping the exit
      enterTimer = setTimeout(() => {
        const nextEl = items[next];
        nextEl.style.transition = `opacity ${IN_MS}ms ${IN_EASE}, transform ${IN_MS}ms ${IN_EASE}`;
        nextEl.style.opacity = '1';
        nextEl.style.transform = 'translateY(0)';
      }, OUT_MS - OVERLAP_MS);

      // Snap exited card back below the viewport (invisible, ready for reuse)
      resetTimer = setTimeout(() => {
        prevEl.style.transition = 'none';
        prevEl.style.opacity = '0';
        prevEl.style.transform = 'translateY(20px)';
      }, OUT_MS + 80);
    };

    const interval = setInterval(cycle, HOLD_MS + OUT_MS);
    return () => {
      clearInterval(interval);
      clearTimeout(enterTimer);
      clearTimeout(resetTimer);
    };
  }, []);

  return (
    <Box sx={{ position: 'relative', height: 44, overflow: 'hidden', mb: 1.5 }}>
      {TICKER_ITEMS.map((item, i) => (
        <Box
          key={i}
          ref={el => { refs.current[i] = el; }}
          style={{
            opacity: i === 0 ? 1 : 0,
            transform: i === 0 ? 'translateY(0)' : 'translateY(20px)',
          }}
          sx={{
            position: 'absolute', inset: 0,
            bgcolor: 'background.paper', borderRadius: 2,
            display: 'flex', alignItems: 'center', gap: 1, px: 1.5,
            willChange: 'opacity, transform',
          }}
        >
          <Box sx={{
            width: 28, height: 28, borderRadius: '50%',
            bgcolor: item.color, display: 'flex', alignItems: 'center',
            justifyContent: 'center', flexShrink: 0,
          }}>
            <Typography sx={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>{item.initial}</Typography>
          </Box>
          <Typography variant="caption" sx={{ flex: 1, fontSize: 11, color: 'text.secondary', lineHeight: 1.2 }}>
            <Box component="span" sx={{ color: item.color, fontWeight: 600 }}>{item.name}</Box>{' '}{item.text}
          </Typography>
          <Typography variant="caption" sx={{ fontSize: 10, color: 'text.disabled', flexShrink: 0, lineHeight: 1.2 }}>{item.time}</Typography>
        </Box>
      ))}
    </Box>
  );
}

function CookWithFriends({ onJoin, darkMode }) {
  return (
    <Box sx={{
      borderRadius: 3, p: 2, border: 1, borderColor: 'divider',
      background: darkMode ? 'linear-gradient(135deg,#1a0f2e,#0f1a2e)' : 'linear-gradient(135deg,#f3f0ff,#e8f4fd)',
    }}>
      <Typography fontWeight={700} fontSize={13} mb={0.5}>Cook with Friends</Typography>
      <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
        Join ReciFind to share recipes and see what your friends are cooking.
      </Typography>
      <ActivityTicker />
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button fullWidth variant="contained" disableElevation onClick={onJoin}
          sx={{ borderRadius: 20, textTransform: 'none', fontWeight: 700 }}>
          Join free
        </Button>
        <Button fullWidth variant="outlined" onClick={onJoin}
          sx={{ borderRadius: 20, textTransform: 'none' }}>
          Invite a friend
        </Button>
      </Box>
    </Box>
  );
}
