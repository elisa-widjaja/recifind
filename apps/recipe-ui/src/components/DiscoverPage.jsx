import { useState, useEffect } from 'react';
import { Box, Typography, Stack, Button } from '@mui/material';
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

  useEffect(() => {
    fetchJson('/public/trending-recipes').then(d => setTrending(d?.recipes || []));
    fetchJson('/public/discover').then(d => setDiscover(d?.recipes || []));
    fetchJson('/public/editors-pick').then(d => setEditorsPick(d?.recipes || []));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (cuisinePrefs?.length && !cuisinePrefs.includes('All of the above')) {
      params.set('cuisine', cuisinePrefs.join(','));
    }
    if (cookingFor) params.set('cooking_for', cookingFor);
    if (dietaryPrefs?.length) params.set('diet', dietaryPrefs.join(', '));
    const q = params.toString() ? `?${params.toString()}` : '';
    fetchJson(`/public/ai-picks${q}`).then(d => setAiPicks(d?.picks || []));
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
      <Typography sx={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 600, fontSize: 22, mb: 2 }}>
        Discover
      </Typography>

      <Stack sx={{ gap: '32px' }}>
        {trending.length > 0 && (
          <Box>
            <SectionLabel>Trending Now</SectionLabel>
            <RecipeShelf recipes={trending.slice(0, 5)} onSave={onSaveRecipe} onShare={onShareRecipe} onOpen={onOpenRecipe} cardWidth={180} cardHeight={120} gap="8px" />
          </Box>
        )}

        {videoRecipes.length > 0 && (
          <Box>
            <SectionLabel>Watch & Cook</SectionLabel>
            <DiscoverRecipes recipes={videoRecipes} onOpen={onOpenRecipe} />
          </Box>
        )}

        {editorsPick.length > 0 && (
          <Box>
            <SectionLabel>Editor's Picks</SectionLabel>
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
          </Box>
        )}

        {aiPicks.length > 0 && (
          <Box>
            <SectionLabel>Trending in Health & Nutrition</SectionLabel>
            <TrendingHealthCarousel picks={aiPicks} onOpen={onOpenRecipe} onSave={onSaveRecipe} onShare={onShareRecipe} />
          </Box>
        )}
      </Stack>
    </Box>
  );
}
