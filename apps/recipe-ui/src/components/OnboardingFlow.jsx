import { useState } from 'react';
import { Dialog, DialogContent, Box, Typography, Button, Stack, Chip, LinearProgress } from '@mui/material';

const DIETARY_PREFS = ['Vegetarian', 'Vegan', 'Gluten-free', 'Dairy-free', 'High protein', 'Pescatarian', 'Meat lover', 'None / all good'];
const COOKING_FOR = [
  { value: 'solo', label: '👤 Just me', sub: 'Quick meals, single portions' },
  { value: 'couple', label: '👫 Partner or roommate', sub: 'Easy sharing, 2–3 servings' },
  { value: 'family', label: '👨‍👩‍👧 Family', sub: 'Kid-friendly, crowd pleasers' },
  { value: 'entertaining', label: '🎉 I love to entertain', sub: 'Impressive dishes, feeds a crowd' },
];
const CUISINES = ['Italian', 'Asian', 'Mexican', 'Mediterranean', 'American comfort', 'Indian', 'Middle Eastern', 'French', 'Japanese', 'All of the above'];

/**
 * 3-screen onboarding flow.
 * Props:
 *   open: boolean
 *   onComplete: (prefs: { dietaryPrefs, cookingFor, cuisinePrefs }) => void
 *   onSkip: () => void
 */
export default function OnboardingFlow({ open, onComplete, onSkip }) {
  const [screen, setScreen] = useState(0);
  const [dietary, setDietary] = useState([]);
  const [cookingFor, setCookingFor] = useState('');
  const [cuisinePrefs, setCuisinePrefs] = useState([]);

  const toggleDietary = (value) => {
    if (value === 'None / all good') {
      setDietary(prev => prev.includes('None / all good') ? [] : ['None / all good']);
    } else {
      setDietary(prev => {
        const without = prev.filter(v => v !== 'None / all good');
        return without.includes(value) ? without.filter(v => v !== value) : [...without, value];
      });
    }
  };

  const toggleCuisine = (value) => {
    if (value === 'All of the above') {
      setCuisinePrefs(prev => prev.includes('All of the above') ? [] : ['All of the above']);
    } else {
      setCuisinePrefs(prev => {
        const without = prev.filter(v => v !== 'All of the above');
        return without.includes(value) ? without.filter(v => v !== value) : [...without, value];
      });
    }
  };

  const handleNext = () => {
    if (screen < 2) setScreen(s => s + 1);
    else onComplete({ dietaryPrefs: dietary, cookingFor, cuisinePrefs });
  };

  const progress = ((screen + 1) / 3) * 100;

  return (
    <Dialog open={open} fullWidth maxWidth="xs" PaperProps={{ sx: { borderRadius: 3 } }}>
      <LinearProgress variant="determinate" value={progress} sx={{ borderRadius: '12px 12px 0 0', height: 3 }} />
      <DialogContent sx={{ pt: 3, pb: 3, px: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
          <Button size="small" onClick={onSkip} sx={{ color: 'text.disabled', textTransform: 'none', fontSize: 11, minWidth: 0 }}>
            Skip →
          </Button>
        </Box>

        {screen === 0 && (
          <>
            <Typography variant="h6" fontWeight={800} mb={0.5}>Any dietary preferences?</Typography>
            <Typography variant="body2" color="text.secondary" mb={2}>We'll filter out recipes that don't work for you</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 3 }}>
              {DIETARY_PREFS.map(d => (
                <Chip key={d} label={d} clickable onClick={() => toggleDietary(d)}
                  variant={dietary.includes(d) ? 'filled' : 'outlined'}
                  color={dietary.includes(d) ? 'primary' : 'default'}
                  sx={{ fontWeight: dietary.includes(d) ? 700 : 400 }} />
              ))}
            </Box>
          </>
        )}

        {screen === 1 && (
          <>
            <Typography variant="h6" fontWeight={800} mb={0.5}>Who are you usually cooking for?</Typography>
            <Typography variant="body2" color="text.secondary" mb={2}>Helps us suggest the right recipes for your table</Typography>
            <Stack spacing={1} mb={3}>
              {COOKING_FOR.map(c => (
                <Box key={c.value} onClick={() => setCookingFor(c.value)}
                  sx={{ p: 1.5, borderRadius: 2, border: 2, cursor: 'pointer',
                    borderColor: cookingFor === c.value ? 'primary.main' : 'divider',
                    bgcolor: cookingFor === c.value ? 'primary.main' + '14' : 'transparent' }}>
                  <Typography variant="body2" fontWeight={cookingFor === c.value ? 700 : 400}>{c.label}</Typography>
                  <Typography variant="caption" color="text.secondary">{c.sub}</Typography>
                </Box>
              ))}
            </Stack>
          </>
        )}

        {screen === 2 && (
          <>
            <Typography variant="h6" fontWeight={800} mb={0.5}>What cuisines do you love?</Typography>
            <Typography variant="body2" color="text.secondary" mb={2}>Pick all that apply — we'll surface more of what you're into</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 3 }}>
              {CUISINES.map(c => (
                <Chip key={c} label={c} clickable onClick={() => toggleCuisine(c)}
                  variant={cuisinePrefs.includes(c) ? 'filled' : 'outlined'}
                  color={cuisinePrefs.includes(c) ? 'primary' : 'default'}
                  sx={{ fontWeight: cuisinePrefs.includes(c) ? 700 : 400 }} />
              ))}
            </Box>
          </>
        )}

        <Box sx={{ display: 'flex', gap: 1 }}>
          {screen > 0 && (
            <Button variant="outlined" disableElevation onClick={() => setScreen(s => s - 1)}
              sx={{ borderRadius: 20, textTransform: 'none', fontWeight: 700, flex: '0 0 auto' }}>
              ← Back
            </Button>
          )}
          <Button fullWidth variant="contained" disableElevation onClick={handleNext}
            sx={{ borderRadius: 20, textTransform: 'none', fontWeight: 700 }}>
            {screen < 2 ? 'Next →' : "Let's cook! 🍳"}
          </Button>
        </Box>
        <Button fullWidth size="small" onClick={onSkip}
          sx={{ color: 'text.disabled', textTransform: 'none', fontSize: 12, mt: 0.5 }}>
          Don't show this again
        </Button>
      </DialogContent>
    </Dialog>
  );
}
