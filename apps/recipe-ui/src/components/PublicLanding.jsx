import { useState, useEffect } from 'react';
import {
  Box, Container, Typography, Button, Stack,
  Card, CardActionArea
} from '@mui/material';
import RecipeShelf from './RecipeShelf';
import WatchAndCook from './WatchAndCook';
import { buildVideoEmbedUrl } from '../utils/videoEmbed';

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
export default function PublicLanding({ onJoin, onOpenRecipe, darkMode }) {
  const [trending, setTrending] = useState([]);
  const [editorsPick, setEditorsPick] = useState([]);
  const [aiPicks, setAiPicks] = useState([]);
  const [editorsExpanded, setEditorsExpanded] = useState(false);

  useEffect(() => {
    fetchJson('/public/trending-recipes').then(d => setTrending(d?.recipes || []));
    fetchJson('/public/editors-pick').then(d => setEditorsPick(d?.recipes || []));
    fetchJson('/public/ai-picks').then(d => setAiPicks(d?.picks || []));
  }, []);

  const visibleEditors = editorsExpanded ? editorsPick : editorsPick.slice(0, 3);

  const handleShare = async (recipe) => {
    const url = recipe.sourceUrl || window.location.href;
    const title = recipe.title || 'Recipe';
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch {
        // user cancelled or share failed — ignore
      }
    } else {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // clipboard blocked — ignore
      }
    }
  };

  const videoRecipes = trending.filter(r => buildVideoEmbedUrl(r.sourceUrl) !== null);

  return (
    <Container maxWidth="sm" disableGutters>
      <Box sx={{ px: { xs: 2, sm: 3 }, pb: 6 }}>

<Stack spacing={3} sx={{ pt: 2 }}>

          {/* ── Section 1: Trending ── */}
          {trending.length > 0 && (
            <Box>
              <SectionLabel emoji="🔥" label="Trending from the community" />
              <RecipeShelf
                recipes={trending}
                onSave={onJoin}
                onShare={handleShare}
                onOpen={onOpenRecipe}
                showPlatformBadge
                cardWidth={190}
                cardHeight={200}
              />
            </Box>
          )}

          {/* ── Watch & Cook ── */}
          {videoRecipes.length > 0 && (
            <Box>
              <WatchAndCook recipes={videoRecipes} onOpen={onOpenRecipe} />
            </Box>
          )}

          {/* ── Section 2: Editor's Pick ── */}
          {editorsPick.length > 0 && (
            <Box>
              <SectionLabel emoji="⭐" label="Editor's Pick" />
              <Stack spacing={1}>
                {visibleEditors.map(recipe => (
                  <EditorCard key={recipe.id} recipe={recipe} onSave={onJoin} onOpen={onOpenRecipe} />
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
              <SectionLabel emoji="🥦" label="Trending in health and nutrition" />
              <Stack spacing={0.5} sx={{ mb: 1.5 }}>
                {aiPicks.map(p => (
                  <Box key={p.topic} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                    <Typography variant="caption" sx={{ fontSize: 11, fontWeight: 700, color: 'primary.main', flexShrink: 0, mt: '1px' }}>{p.hashtag}</Typography>
                    <Typography variant="caption" sx={{ fontSize: 11, color: 'text.secondary', lineHeight: 1.4 }}>{p.reason}</Typography>
                  </Box>
                ))}
              </Stack>
              <RecipeShelf
                recipes={aiPicks.map(p => ({ ...p.recipe, _hashtag: p.hashtag, _topic: p.topic }))}
                onSave={onJoin} onOpen={onOpenRecipe} cardWidth={160}
              />
            </Box>
          )}

          {/* ── Section 4: Cook with Friends ── */}
          <CookWithFriends onJoin={onJoin} darkMode={darkMode} />

        </Stack>
      </Box>
    </Container>
  );
}

function SectionLabel({ emoji, label, inline = false }) {
  const el = (
    <Typography fontWeight={700} fontSize={13} sx={{ color: 'text.primary' }}>
      {emoji} {label}
    </Typography>
  );
  if (inline) return el;
  return <Box sx={{ mb: 1 }}>{el}</Box>;
}

function EditorCard({ recipe, onSave, onOpen }) {
  return (
    <Card elevation={0} sx={{ display: 'flex', borderRadius: 2, border: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
      <CardActionArea onClick={() => onOpen?.(recipe)}
        sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1, pr: 1.5 }}>
        <Box sx={{ width: 56, height: 56, flexShrink: 0, borderRadius: 1.5, overflow: 'hidden', bgcolor: 'action.hover' }}>
          {recipe.imageUrl
            ? <Box component="img" src={recipe.imageUrl} alt={recipe.title} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>🍳</Box>
          }
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={600} noWrap>{recipe.title}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {recipe.mealTypes?.[0]} {recipe.durationMinutes ? `· ${recipe.durationMinutes} min` : ''}
          </Typography>
        </Box>
        <Button size="small" variant="outlined" onClick={(e) => { e.stopPropagation(); onSave?.(); }}
          sx={{ borderRadius: 20, textTransform: 'none', fontSize: 11, flexShrink: 0 }}>
          Save
        </Button>
      </CardActionArea>
    </Card>
  );
}

function CookWithFriends({ onJoin, darkMode }) {
  return (
    <Box sx={{ borderRadius: 3, p: 2, border: 1, borderColor: 'divider',
      background: darkMode ? 'linear-gradient(135deg,#1a0f2e,#0f1a2e)' : 'linear-gradient(135deg,#f3f0ff,#e8f4fd)' }}>
      <Typography fontWeight={700} fontSize={13} mb={0.5}>🍳 Cook with Friends</Typography>
      <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
        Cooking is better together
      </Typography>
      {/* Social proof teaser — illustrative activity */}
      <Box sx={{ bgcolor: 'background.paper', borderRadius: 2, p: 1.25, mb: 1.5, opacity: 0.85 }}>
        <ActivityRow initial="E" name="Elisa" action="saved your Miso Ramen ❤️" time="2h" color="#7c3aed" />
        <Box sx={{ mt: 0.75 }}>
          <ActivityRow initial="S" name="Sarah" action="shared Beef Stew with you" time="5h" color="#10b981" />
        </Box>
      </Box>
      <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
        Join ReciFind to share recipes and see what your friends are cooking.
      </Typography>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button fullWidth variant="contained" size="small" disableElevation onClick={onJoin}
          sx={{ borderRadius: 20, textTransform: 'none', fontWeight: 700, fontSize: 11 }}>
          Join free
        </Button>
        <Button fullWidth variant="outlined" size="small" onClick={onJoin}
          sx={{ borderRadius: 20, textTransform: 'none', fontSize: 11 }}>
          Invite a friend
        </Button>
      </Box>
    </Box>
  );
}

function ActivityRow({ initial, name, action, time, color }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box sx={{ width: 26, height: 26, borderRadius: '50%', bgcolor: color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Typography sx={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>{initial}</Typography>
      </Box>
      <Typography variant="caption" sx={{ flex: 1, fontSize: 11, color: 'text.secondary' }}>
        <Box component="span" sx={{ color, fontWeight: 600 }}>{name}</Box> {action}
      </Typography>
      <Typography variant="caption" sx={{ fontSize: 10, color: 'text.disabled' }}>{time}</Typography>
    </Box>
  );
}
