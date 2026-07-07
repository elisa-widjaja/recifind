import { useState, useEffect, useRef } from 'react';
import { Box, Typography, Stack, Skeleton, TextField, InputAdornment, IconButton } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import RecipeShelf from './RecipeShelf';
import RecipeListCard from './RecipeListCard';
import DiscoverRecipes from './DiscoverRecipes';
import TrendingHealthCarousel from './TrendingHealthCarouselB';

const API_BASE_URL = import.meta.env.VITE_RECIPES_API_BASE_URL || '';

async function fetchJson(path, accessToken) {
  const url = `${API_BASE_URL}${path}`;
  const res = accessToken
    ? await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
    : await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

function SectionLabel({ children }) {
  return (
    <Typography sx={{ fontWeight: 700, fontSize: 13, color: 'text.primary', mb: '10px' }}>
      {children}
    </Typography>
  );
}

function WatchCookSkeleton() {
  return (
    <Box sx={{ display: 'flex', gap: '12px' }}>
      {[0, 1].map(i => (
        <Skeleton
          key={i}
          variant="rectangular"
          animation="wave"
          sx={{ width: 'calc((100vw - 44px) / 2)', aspectRatio: '9 / 16', borderRadius: '12px' }}
        />
      ))}
    </Box>
  );
}

function ShelfSkeleton({ cardWidth = 180, cardHeight = 120, count = 4 }) {
  return (
    <Box sx={{ display: 'flex', gap: '8px', overflow: 'hidden' }}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton
          key={i}
          variant="rectangular"
          animation="wave"
          sx={{ width: cardWidth, height: cardHeight, borderRadius: '8px', flexShrink: 0 }}
        />
      ))}
    </Box>
  );
}

function ListSkeleton({ count = 3 }) {
  return (
    <Stack spacing={1}>
      {Array.from({ length: count }).map((_, i) => (
        <Box key={i} sx={{ display: 'flex', gap: 1.5, alignItems: 'center', py: 0.5 }}>
          <Skeleton variant="rectangular" animation="wave" width={90} height={90} sx={{ borderRadius: '7px', flexShrink: 0 }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Skeleton variant="text" animation="wave" width="80%" height={20} />
            <Skeleton variant="text" animation="wave" width="50%" height={16} />
          </Box>
        </Box>
      ))}
    </Stack>
  );
}

export default function DiscoverPage({
  accessToken,
  cookingFor,
  cuisinePrefs,
  dietaryPrefs,
  onOpenRecipe,
  onSaveRecipe,
  onShareRecipe,
}) {
  const [trending, setTrending] = useState([]);
  const [discover, setDiscover] = useState([]);
  const [editorsPick, setEditorsPick] = useState([]);
  const [aiPicks, setAiPicks] = useState([]);
  // Per-fetch loaded flags so each section can swap its skeleton for real
  // content as soon as its own fetch resolves — instead of waiting for the
  // slowest of three to gate the whole page.
  const [trendingLoaded, setTrendingLoaded] = useState(false);
  const [discoverLoaded, setDiscoverLoaded] = useState(false);
  const [editorsLoaded, setEditorsLoaded] = useState(false);
  const [aiLoaded, setAiLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const searchSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    fetchJson('/public/trending-recipes').then(d => {
      if (cancelled) return;
      setTrending(d?.recipes || []);
      setTrendingLoaded(true);
    });
    fetchJson('/public/discover').then(d => {
      if (cancelled) return;
      setDiscover(d?.recipes || []);
      setDiscoverLoaded(true);
    });
    fetchJson('/public/editors-pick').then(d => {
      if (cancelled) return;
      setEditorsPick(d?.recipes || []);
      setEditorsLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setAiLoaded(false);
    const params = new URLSearchParams();
    // cuisinePrefs is now always an array of canonical lowercase keys (no
    // "All of the above" sentinel — selecting that in onboarding/settings
    // stores all 12 keys explicitly). Pass them through verbatim.
    if (cuisinePrefs?.length) {
      params.set('cuisine', cuisinePrefs.join(','));
    }
    if (cookingFor) params.set('cooking_for', cookingFor);
    if (dietaryPrefs?.length) params.set('diet', dietaryPrefs.join(', '));
    const q = params.toString() ? `?${params.toString()}` : '';
    fetchJson(`/public/ai-picks${q}`).then(d => {
      setAiPicks(d?.picks || []);
      setAiLoaded(true);
    });
  }, [cookingFor, cuisinePrefs, dietaryPrefs]);

  // Debounced public search. Under 2 chars we don't hit the network and clear
  // any prior results. A per-request sequence guards against a slow response
  // for an earlier query overwriting a newer one.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      ++searchSeq.current;
      setResults([]);
      setSearched(false);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++searchSeq.current;
    const t = setTimeout(() => {
      fetchJson(`/public/search?q=${encodeURIComponent(term)}`)
        .then(d => {
          if (seq !== searchSeq.current) return;
          setResults(d?.recipes || []);
          setSearched(true);
        })
        .finally(() => {
          if (seq === searchSeq.current) setSearching(false);
        });
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const isSearching = query.trim().length >= 2;

  // Same de-dup logic as PublicLanding: drop trending overlaps, drop duplicate
  // source URLs, drop YouTube embeds.
  const trendingIds = new Set(trending.map(r => r.id));
  const seen = new Set();
  const discoverUniq = discover.filter(r => {
    if (trendingIds.has(r.id)) return false;
    if (!r.sourceUrl || seen.has(r.sourceUrl)) return false;
    if (r.sourceUrl.includes('youtube.com') || r.sourceUrl.includes('youtu.be')) return false;
    seen.add(r.sourceUrl);
    return true;
  });
  // Newest first, regardless of source. Every card renders as a thumbnail
  // (social embeds are blocked in practice), so there's no reason to front-load
  // embeddable reels. discoverUniq preserves the backend's created_at DESC
  // order, so just take the 5 most recent.
  const videoRecipes = discoverUniq.slice(0, 5);

  return (
    <Box sx={{ pb: '90px' }}>
      <Typography sx={{
        fontFamily: "'Fraunces', Georgia, serif",
        fontWeight: 600,
        fontSize: '26px',
        lineHeight: 1.2,
        letterSpacing: '-0.01em',
        color: 'text.primary',
        mb: 2,
      }}>
        Discover
      </Typography>

      <TextField
        fullWidth
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search recipes"
        sx={{
          mb: 2,
          '& .MuiOutlinedInput-root': { height: { xs: '50px', sm: '54px' }, borderRadius: '999px' },
        }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon color="action" />
            </InputAdornment>
          ),
          endAdornment: query ? (
            <InputAdornment position="end">
              <IconButton aria-label="clear search" edge="end" size="small" onClick={() => setQuery('')}>
                <ClearIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ) : null,
        }}
      />

      {isSearching && (
        <Box>
          {searching && results.length === 0 ? (
            <ListSkeleton count={6} />
          ) : results.length > 0 ? (
            <Stack spacing={1}>
              {results.map(recipe => (
                <RecipeListCard key={recipe.id} recipe={recipe} onSave={onSaveRecipe} onShare={onShareRecipe} onOpen={onOpenRecipe} />
              ))}
            </Stack>
          ) : searched ? (
            <Typography sx={{ textAlign: 'center', color: 'text.secondary', mt: 4 }}>
              No recipes found for "{query.trim()}"
            </Typography>
          ) : null}
        </Box>
      )}

      {!isSearching && (<Stack sx={{ gap: '32px' }}>
        {(!discoverLoaded || videoRecipes.length > 0) && (
          <Box>
            <SectionLabel>From the Community</SectionLabel>
            {discoverLoaded
              ? <DiscoverRecipes recipes={videoRecipes} onOpen={onOpenRecipe} />
              : <WatchCookSkeleton />}
          </Box>
        )}

        {(!editorsLoaded || editorsPick.length > 0) && (
          <Box>
            <SectionLabel>Editor's Picks</SectionLabel>
            {editorsLoaded ? (
              <Stack spacing={1}>
                {editorsPick.map(recipe => (
                  <RecipeListCard key={recipe.id} recipe={recipe} onSave={onSaveRecipe} onShare={onShareRecipe} onOpen={onOpenRecipe} />
                ))}
              </Stack>
            ) : (
              <ListSkeleton count={7} />
            )}
          </Box>
        )}

        {(!aiLoaded || aiPicks.length > 0) && (
          <Box>
            <SectionLabel>Trending in Health & Nutrition</SectionLabel>
            {aiLoaded
              ? <TrendingHealthCarousel picks={aiPicks} onOpen={onOpenRecipe} onSave={onSaveRecipe} onShare={onShareRecipe} />
              : <ShelfSkeleton cardWidth={220} cardHeight={140} count={3} />}
          </Box>
        )}
      </Stack>)}
    </Box>
  );
}
