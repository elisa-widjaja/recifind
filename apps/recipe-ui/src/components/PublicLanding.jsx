import { useState, useEffect, useRef } from 'react';
import {
  Box, Container, Typography, Button, Stack, Fab
} from '@mui/material';
import RecipeShelf from './RecipeShelf';
import DiscoverRecipes from './DiscoverRecipes';
import RecipeListCard from './RecipeListCard';
import TrendingHealthCarousel from './TrendingHealthCarouselB';

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
  return <Box sx={{ mb: 1 }}>{el}</Box>;
}


// Flat list of ticker items — one white card shows at a time, cycling through all
const TICKER_ITEMS = [
  { initial: 'E', name: 'Elisa', color: '#7c3aed', lightColor: '#a78bfa', text: 'saved Miso Ramen ❤️', time: '2h' },
  { initial: 'H', name: 'Henny', color: '#10b981', lightColor: '#34d399', text: 'shared Beef Stew with you', time: '5h' },
  { initial: 'M', name: 'Max',   color: '#f59e0b', lightColor: '#fbbf24', text: 'is cooking Tacos tonight 🌮', time: 'now' },
  { initial: 'H', name: 'Henny', color: '#10b981', lightColor: '#34d399', text: 'saved Salmon Bowl 🐟', time: '3h' },
  { initial: 'M', name: 'Max',   color: '#f59e0b', lightColor: '#fbbf24', text: 'saved Chicken Tikka Masala 🍛', time: '6h' },
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
            <Box component="span" sx={{ color: t => t.palette.mode === 'dark' ? item.lightColor : item.color, fontWeight: 600 }}>{item.name}</Box>{' '}{item.text}
          </Typography>
          <Typography variant="caption" sx={{ fontSize: 10, color: 'text.disabled', flexShrink: 0, lineHeight: 1.2 }}>{item.time}</Typography>
        </Box>
      ))}
    </Box>
  );
}

// ── Shared card styles ──
const WHY_CARD_SX = {
  flexShrink: 0,
  width: 'calc(80vw)',
  maxWidth: 280,
  scrollSnapAlign: 'start',
  borderRadius: 3,
  p: 2.5,
  border: '1px solid',
  borderColor: 'divider',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  minHeight: 220,
};

// ── Shared card gradient ──
const cardBg = (darkMode) => darkMode
  ? 'linear-gradient(135deg,#1a0f2e,#0f1a2e)'
  : 'linear-gradient(135deg,#f3f0ff,#e8f4fd)';

// ── Card 1: Save from anywhere ──
const SOCIAL_LOGOS = [
  { src: '/instagram.svg', delay: '0s' },
  { src: '/youtube.svg', delay: '0.3s' },
  { src: '/tiktok.svg', delay: '0.6s' },
];

const logoAnimKeyframes = `
@keyframes logoWobble {
  0%, 100% { transform: rotate(0deg) scale(1); }
  20%  { transform: rotate(-10deg) scale(1.12); }
  40%  { transform: rotate(8deg) scale(1.08); }
  60%  { transform: rotate(-4deg) scale(1.04); }
  80%  { transform: rotate(2deg) scale(1.01); }
}`;

function CardSaveFromAnywhere({ onJoin, darkMode }) {
  return (
    <Box sx={{ ...WHY_CARD_SX, background: cardBg(darkMode) }}>
      <style>{logoAnimKeyframes}</style>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box>
          <Typography fontWeight={700} fontSize={15} lineHeight={1.3}>Save from anywhere</Typography>
          <Typography variant="caption" color="text.secondary" fontSize={12} lineHeight={1.5} display="block" mt={0.5}>
            Paste your recipe link. We pull the details instantly.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 3, justifyContent: 'center', py: 1 }}>
          {SOCIAL_LOGOS.map((logo, i) => (
            <Box
              key={i}
              component="img"
              src={logo.src}
              alt=""
              sx={{
                width: 38, height: 38,
                animation: `logoWobble 2.6s ease-in-out infinite`,
                animationDelay: logo.delay,
              }}
            />
          ))}
        </Box>
      </Box>
      <Button
        variant="contained"
        disableElevation
        onClick={onJoin}
        sx={{ borderRadius: 20, textTransform: 'none', fontWeight: 700, fontSize: 13, alignSelf: 'center', px: 3 }}
      >
        + Add Recipe
      </Button>
    </Box>
  );
}

// ── Card 2: Cook with Friends ──
function CardCookWithFriends({ onJoin, darkMode }) {
  return (
    <Box sx={{ ...WHY_CARD_SX, background: cardBg(darkMode) }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box>
          <Typography fontWeight={700} fontSize={15} lineHeight={1.3}>Cook with friends</Typography>
          <Typography variant="caption" color="text.secondary" fontSize={12} lineHeight={1.5} display="block" mt={0.5}>
            Share recipes and see what your friends are cooking.
          </Typography>
        </Box>
        <ActivityTicker />
      </Box>
      <Button
        variant="outlined"
        onClick={onJoin}
        sx={{ borderRadius: 20, textTransform: 'none', fontWeight: 700, fontSize: 13, alignSelf: 'center', px: 3 }}
      >
        Invite Friends
      </Button>
    </Box>
  );
}

// ── Card 3: Discover trending recipes — one tag at a time, same ticker animation ──
const TREND_TAGS = ['#PlantBasedEating', '#FermentedFoods', '#HighProteinMeals', '#GutHealth', '#AntiInflammatory'];

const TAG_HOLD_MS = 1800, TAG_OUT_MS = 260, TAG_IN_MS = 320, TAG_OVERLAP_MS = 80;

function TagTicker() {
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

      const prevEl = items[prev];
      prevEl.style.transition = `opacity ${TAG_OUT_MS}ms ${OUT_EASE}, transform ${TAG_OUT_MS}ms ${OUT_EASE}`;
      prevEl.style.opacity = '0';
      prevEl.style.transform = 'translateY(-14px)';

      enterTimer = setTimeout(() => {
        const nextEl = items[next];
        nextEl.style.transition = `opacity ${TAG_IN_MS}ms ${IN_EASE}, transform ${TAG_IN_MS}ms ${IN_EASE}`;
        nextEl.style.opacity = '1';
        nextEl.style.transform = 'translateY(0)';
      }, TAG_OUT_MS - TAG_OVERLAP_MS);

      resetTimer = setTimeout(() => {
        prevEl.style.transition = 'none';
        prevEl.style.opacity = '0';
        prevEl.style.transform = 'translateY(20px)';
      }, TAG_OUT_MS + 80);
    };

    const interval = setInterval(cycle, TAG_HOLD_MS + TAG_OUT_MS);
    return () => { clearInterval(interval); clearTimeout(enterTimer); clearTimeout(resetTimer); };
  }, []);

  return (
    <Box sx={{ position: 'relative', height: 36, overflow: 'hidden', my: 0.5 }}>
      {TREND_TAGS.map((tag, i) => (
        <Box
          key={tag}
          ref={el => { refs.current[i] = el; }}
          style={{
            opacity: i === 0 ? 1 : 0,
            transform: i === 0 ? 'translateY(0)' : 'translateY(20px)',
          }}
          sx={{
            position: 'absolute', inset: 0,
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            willChange: 'opacity, transform',
          }}
        >
          <Box sx={{
            px: 2, py: 0.75,
            borderRadius: 20,
            border: '1.5px solid',
            borderColor: t => `${t.palette.mode === 'dark' ? t.palette.primary.light : t.palette.primary.main}4D`,
            fontSize: 13, fontWeight: 600,
            color: t => t.palette.mode === 'dark' ? 'primary.light' : 'primary.main',
          }}>
            {tag}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function CardDiscoverTrending({ onJoin, darkMode }) {
  return (
    <Box sx={{ ...WHY_CARD_SX, background: cardBg(darkMode) }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box>
          <Typography fontWeight={700} fontSize={15} lineHeight={1.3}>Discover trending recipes</Typography>
          <Typography variant="caption" color="text.secondary" fontSize={12} lineHeight={1.5} display="block" mt={0.5}>
            Trending recipes and health topics, curated for you daily.
          </Typography>
        </Box>
        <TagTicker />
      </Box>
      <Button
        variant="contained"
        disableElevation
        onClick={onJoin}
        sx={{ borderRadius: 20, textTransform: 'none', fontWeight: 700, fontSize: 13, alignSelf: 'center', px: 3 }}
      >
        Join Free
      </Button>
    </Box>
  );
}

const NUM_WHY_CARDS = 3;

function WhyJoinCarousel({ onJoin, darkMode }) {
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
          <CardDiscoverTrending onJoin={onJoin} darkMode={darkMode} />
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

export default function PublicLanding({ onJoin, onOpenRecipe, darkMode, onShare }) {
  const [trending, setTrending] = useState([]);
  const [discover, setDiscover] = useState([]);
  const [editorsPick, setEditorsPick] = useState([]);
  const [aiPicks, setAiPicks] = useState([]);
  const [editorsExpanded, setEditorsExpanded] = useState(false);
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
    fetchJson('/public/editors-pick').then(d => setEditorsPick(d?.recipes || []));
    fetchJson('/public/ai-picks').then(d => setAiPicks(d?.picks || []));
  }, []);

  const visibleEditors = editorsExpanded ? editorsPick : editorsPick.slice(0, 3);

  // First 2 slots: YouTube Shorts (autoplay); remaining slots: other social videos
  const trendingIds = new Set(trending.map(r => r.id));
  // Deduplicate by source_url (same video saved by multiple users → keep first)
  const seenUrls = new Set();
  const discoverUniq = discover.filter(r => {
    if (trendingIds.has(r.id)) return false;
    if (!r.sourceUrl || seenUrls.has(r.sourceUrl)) return false;
    seenUrls.add(r.sourceUrl);
    return true;
  });
  const youtubeShorts = discoverUniq.filter(r => r.sourceUrl?.includes('/shorts/')).slice(0, 2);
  const youtubeShortsIds = new Set(youtubeShorts.map(r => r.id));
  const otherVideos = discoverUniq.filter(r => !youtubeShortsIds.has(r.id) && isEmbeddable(r.sourceUrl));
  const nonEmbeddable = discoverUniq.filter(r => !youtubeShortsIds.has(r.id) && !isEmbeddable(r.sourceUrl));
  const videoRecipes = [...youtubeShorts, ...otherVideos, ...nonEmbeddable].slice(0, 5);

  const trendingFiltered = trending.slice(0, 5);

  return (
    <Container maxWidth="sm" disableGutters>
      <Box sx={{ px: { xs: 2, sm: 3 }, pb: 6 }}>

        <Stack spacing={3} sx={{ pt: '20px' }}>

          {/* ── Why Join Recifind ── */}
          <Box ref={whyJoinRef}>
            <WhyJoinCarousel onJoin={onJoin} darkMode={darkMode} />
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
              <SectionLabel label="Trending in Health & Nutrition" />
              <TrendingHealthCarousel picks={aiPicks} onOpen={onOpenRecipe} onSave={onJoin} onShare={onShare} />
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
    </Container>
  );
}
