import { useState, useEffect } from 'react';
import { Box, Typography, Stack, Button, Skeleton } from '@mui/material';
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

function isEmbeddable(url) {
  if (!url) return false;
  return url.includes('tiktok.com') || url.includes('youtube.com') || url.includes('youtu.be');
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
  const [editorsExpanded, setEditorsExpanded] = useState(false);
  // Per-fetch loaded flags so each section can swap its skeleton for real
  // content as soon as its own fetch resolves — instead of waiting for the
  // slowest of three to gate the whole page.
  const [trendingLoaded, setTrendingLoaded] = useState(false);
  const [discoverLoaded, setDiscoverLoaded] = useState(false);
  const [editorsLoaded, setEditorsLoaded] = useState(false);
  const [aiLoaded, setAiLoaded] = useState(false);

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
    if (cuisinePrefs?.length && !cuisinePrefs.includes('All of the above')) {
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

  // Same de-dup logic as PublicLanding: drop trending overlaps, drop YouTube embeds, prioritise reels.
  const trendingIds = new Set(trending.map(r => r.id));
  const seen = new Set();
  const discoverUniq = discover.filter(r => {
    if (trendingIds.has(r.id)) return false;
    if (!r.sourceUrl || seen.has(r.sourceUrl)) return false;
    if (r.sourceUrl.includes('youtube.com') || r.sourceUrl.includes('youtu.be')) return false;
    seen.add(r.sourceUrl);
    return true;
  });
  const reels = discoverUniq.filter(r => {
    const u = r.sourceUrl || '';
    return u.includes('tiktok.com') || u.includes('instagram.com/reel');
  }).slice(0, 2);
  const reelIds = new Set(reels.map(r => r.id));
  const otherEmbed = discoverUniq.filter(r => !reelIds.has(r.id) && isEmbeddable(r.sourceUrl));
  const nonEmbed = discoverUniq.filter(r => !reelIds.has(r.id) && !isEmbeddable(r.sourceUrl));
  const videoRecipes = [...reels, ...otherEmbed, ...nonEmbed].slice(0, 5);

  const visibleEditors = editorsExpanded ? editorsPick : editorsPick.slice(0, 3);

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

      <Stack sx={{ gap: '32px' }}>
        {(!discoverLoaded || videoRecipes.length > 0) && (
          <Box>
            <SectionLabel>Watch & Cook</SectionLabel>
            {discoverLoaded
              ? <DiscoverRecipes recipes={videoRecipes} onOpen={onOpenRecipe} />
              : <WatchCookSkeleton />}
          </Box>
        )}

        {(!trendingLoaded || trending.length > 0) && (
          <Box>
            <SectionLabel>Trending Now</SectionLabel>
            {trendingLoaded
              ? <RecipeShelf recipes={trending.slice(0, 5)} onSave={onSaveRecipe} onShare={onShareRecipe} onOpen={onOpenRecipe} cardWidth={180} cardHeight={120} gap="8px" />
              : <ShelfSkeleton cardWidth={180} cardHeight={120} count={4} />}
          </Box>
        )}

        {(!editorsLoaded || editorsPick.length > 0) && (
          <Box>
            <SectionLabel>Editor's Picks</SectionLabel>
            {editorsLoaded ? (
              <>
                <Stack spacing={1}>
                  {visibleEditors.map(recipe => (
                    <RecipeListCard key={recipe.id} recipe={recipe} onSave={onSaveRecipe} onShare={onShareRecipe} onOpen={onOpenRecipe} />
                  ))}
                </Stack>
                {editorsPick.length > 3 && (
                  <Button size="small" onClick={() => setEditorsExpanded(e => !e)} sx={{ mt: 0.5, fontSize: 11, textTransform: 'none', color: 'text.secondary' }}>
                    {editorsExpanded ? 'Show less' : `+ ${editorsPick.length - 3} more picks`}
                  </Button>
                )}
              </>
            ) : (
              <ListSkeleton count={3} />
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
      </Stack>
    </Box>
  );
}
