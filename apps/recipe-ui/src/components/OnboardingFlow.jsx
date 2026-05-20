import { useState } from 'react';
import { Dialog, DialogContent, Box, Typography, Button, Stack, Chip, LinearProgress } from '@mui/material';
import { CUISINE_LABELS, CUISINE_ORDER } from '../lib/cuisines';

const DIETARY_PREFS = ['🥦 Vegetarian', '🌱 Vegan', '🌾 Gluten-free', '🥛 Dairy-free', '💪 High protein', '🐟 Pescatarian', '🥩 Meat lover', '✅ None / all good'];
const COOKING_FOR = [
  { value: 'solo', label: '👤 Just me', sub: 'Quick meals, single portions' },
  { value: 'couple', label: '👫 Partner or roommate', sub: 'Easy sharing, 2–3 servings' },
  { value: 'family', label: '👨‍👩‍👧 Family', sub: 'Kid-friendly, crowd pleasers' },
  { value: 'entertaining', label: '🎉 I love to entertain', sub: 'Impressive dishes, feeds a crowd' },
];

/**
 * 3-screen onboarding flow.
 * Props:
 *   open: boolean
 *   onComplete: (prefs: { dietaryPrefs, cookingFor, cuisinePrefs }) => void
 *   onSkip: () => void
 */
export default function OnboardingFlow({ open, onComplete, onSkip, onDismiss }) {
  const [screen, setScreen] = useState(0);
  const [dietary, setDietary] = useState([]);
  const [cookingFor, setCookingFor] = useState('');
  const [cuisinePrefs, setCuisinePrefs] = useState([]);

  const toggleDietary = (value) => {
    if (value === '✅ None / all good') {
      setDietary(prev => prev.includes('✅ None / all good') ? [] : ['✅ None / all good']);
    } else {
      setDietary(prev => {
        const without = prev.filter(v => v !== '✅ None / all good');
        return without.includes(value) ? without.filter(v => v !== value) : [...without, value];
      });
    }
  };

  const toggleCuisine = (key) => {
    setCuisinePrefs(prev => prev.includes(key) ? prev.filter(v => v !== key) : [...prev, key]);
  };
  // "All of the above" is a UX shortcut, not a stored value — it toggles
  // between the full set of cuisine keys and an empty selection. Saved
  // prefs only ever contain real cuisine keys (matching CUISINE_ORDER), so
  // the recipe-detail chips, worker enrichment enum, and prefs share one
  // vocabulary.
  const allCuisinesSelected = CUISINE_ORDER.every(k => cuisinePrefs.includes(k));
  const toggleAllCuisines = () => {
    setCuisinePrefs(allCuisinesSelected ? [] : [...CUISINE_ORDER]);
  };

  const handleNext = () => {
    if (screen < 2) setScreen(s => s + 1);
    else onComplete({ dietaryPrefs: dietary, cookingFor, cuisinePrefs });
  };

  const TITLES = ['My dietary preferences', 'I am cooking for', 'My favorite cuisines'];
  const SUBTITLES = [
    "We'll filter out recipes that don't work for you",
    "Helps us suggest the right recipes for your table",
    "Pick all that apply — we'll surface more of what you're into",
  ];
  const progress = ((screen + 1) / 3) * 100;

  return (
    <Dialog open={open} fullWidth maxWidth="xs" disableEscapeKeyDown onClose={() => {}}
      PaperProps={{ sx: { borderRadius: 3, display: 'flex', flexDirection: 'column', overflow: 'hidden', height: 480 } }}>
      <LinearProgress variant="determinate" value={progress} sx={{ borderRadius: '12px 12px 0 0', height: 3, flexShrink: 0 }} />

      {/* Fixed header */}
      <Box sx={{ px: 3, pt: 2, pb: 1, flexShrink: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography fontWeight={700} fontSize={15} sx={{ flex: 1 }}>{TITLES[screen]}</Typography>
          <Button size="small" onClick={onDismiss} sx={{ color: 'text.disabled', minWidth: 0, p: 0.5, lineHeight: 1, fontSize: 18, flexShrink: 0 }}>✕</Button>
        </Box>
      </Box>

      {/* Scrollable body */}
      <Box sx={{ flex: 1, overflowY: 'auto', px: 3, pt: 0, pb: 1 }}>
        <Typography variant="body2" color="text.secondary" mb={1.5}>{SUBTITLES[screen]}</Typography>

        {screen === 0 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {DIETARY_PREFS.map(d => (
              <Chip key={d} label={d} clickable onClick={() => toggleDietary(d)}
                variant={dietary.includes(d) ? 'filled' : 'outlined'}
                color={dietary.includes(d) ? 'primary' : 'default'}
                sx={{ fontWeight: dietary.includes(d) ? 700 : 400, alignSelf: 'flex-start' }} />
            ))}
          </Box>
        )}

        {screen === 1 && (
          <Stack spacing={1}>
            {COOKING_FOR.map(c => (
              <Box key={c.value} onClick={() => setCookingFor(prev => prev === c.value ? '' : c.value)}
                sx={{ p: 1.5, borderRadius: 2, border: 2, cursor: 'pointer',
                  borderColor: cookingFor === c.value ? 'primary.main' : 'divider',
                  bgcolor: cookingFor === c.value ? 'primary.main' + '14' : 'transparent' }}>
                <Typography variant="body2" fontWeight={cookingFor === c.value ? 700 : 400}>{c.label}</Typography>
                <Typography variant="caption" color="text.secondary">{c.sub}</Typography>
              </Box>
            ))}
          </Stack>
        )}

        {screen === 2 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {CUISINE_ORDER.map(key => {
              const sel = cuisinePrefs.includes(key);
              return (
                <Chip key={key} label={CUISINE_LABELS[key]} clickable onClick={() => toggleCuisine(key)}
                  variant={sel ? 'filled' : 'outlined'}
                  color={sel ? 'primary' : 'default'}
                  sx={{ fontWeight: sel ? 700 : 400, alignSelf: 'flex-start' }} />
              );
            })}
            <Chip label="All of the above" clickable onClick={toggleAllCuisines}
              variant={allCuisinesSelected ? 'filled' : 'outlined'}
              color={allCuisinesSelected ? 'primary' : 'default'}
              sx={{ fontWeight: allCuisinesSelected ? 700 : 400, alignSelf: 'flex-start' }} />
          </Box>
        )}
      </Box>

      {/* Fixed footer */}
      <Box sx={{ px: 3, pt: 1, pb: 2.5, flexShrink: 0 }}>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {screen > 0 && (
            <Button fullWidth variant="text" disableElevation onClick={() => setScreen(s => s - 1)}
              sx={{ borderRadius: 20, textTransform: 'none', fontWeight: 700, color: 'text.primary' }}>
              ← Back
            </Button>
          )}
          <Button fullWidth variant="contained" disableElevation onClick={handleNext}
            sx={{ borderRadius: 20, textTransform: 'none', fontWeight: 700 }}>
            {screen < 2 ? 'Next →' : 'Next'}
          </Button>
        </Box>
        <Button fullWidth size="small" onClick={onSkip}
          sx={{ color: 'text.disabled', textTransform: 'none', fontSize: 12, mt: 0.5 }}>
          Don't show this again
        </Button>
      </Box>
    </Dialog>
  );
}
