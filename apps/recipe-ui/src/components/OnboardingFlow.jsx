import { useState } from 'react';
import { Dialog, DialogContent, Box, Typography, Button, Stack, Chip, LinearProgress } from '@mui/material';

const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Dessert', 'Drinks', 'Meal prep'];
const DIETARY_PREFS = ['Vegetarian', 'Meat lover', 'Gluten-free', 'Dairy-free', 'High protein', 'Pescatarian', 'None / all good'];
const SKILL_LEVELS = [
  { value: 'beginner', label: '🐣 Beginner', sub: 'I follow recipes step by step' },
  { value: 'home_cook', label: '🍳 Home cook', sub: "I'm comfortable in the kitchen" },
  { value: 'confident', label: '👨‍🍳 Confident', sub: 'I improvise and experiment' },
];

/**
 * 3-screen onboarding flow, each screen skippable.
 * Props:
 *   open: boolean
 *   onComplete: (prefs: { mealTypePrefs, dietaryPrefs, skillLevel }) => void
 *   onSkip: () => void
 */
export default function OnboardingFlow({ open, onComplete, onSkip }) {
  const [screen, setScreen] = useState(0);
  const [mealTypes, setMealTypes] = useState([]);
  const [dietary, setDietary] = useState([]);
  const [skill, setSkill] = useState('');

  const toggle = (list, setList, value) => {
    setList(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]);
  };

  const handleNext = () => {
    if (screen < 2) setScreen(s => s + 1);
    else onComplete({ mealTypePrefs: mealTypes, dietaryPrefs: dietary, skillLevel: skill });
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
            <Typography variant="h6" fontWeight={800} mb={0.5}>What do you love to cook?</Typography>
            <Typography variant="body2" color="text.secondary" mb={2}>Pick all that apply</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 3 }}>
              {MEAL_TYPES.map(t => (
                <Chip key={t} label={t} clickable onClick={() => toggle(mealTypes, setMealTypes, t)}
                  variant={mealTypes.includes(t) ? 'filled' : 'outlined'}
                  color={mealTypes.includes(t) ? 'primary' : 'default'}
                  sx={{ fontWeight: mealTypes.includes(t) ? 700 : 400 }} />
              ))}
            </Box>
          </>
        )}

        {screen === 1 && (
          <>
            <Typography variant="h6" fontWeight={800} mb={0.5}>Any dietary preferences?</Typography>
            <Typography variant="body2" color="text.secondary" mb={2}>We'll tailor your AI picks</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 3 }}>
              {DIETARY_PREFS.map(d => (
                <Chip key={d} label={d} clickable onClick={() => toggle(dietary, setDietary, d)}
                  variant={dietary.includes(d) ? 'filled' : 'outlined'}
                  color={dietary.includes(d) ? 'primary' : 'default'}
                  sx={{ fontWeight: dietary.includes(d) ? 700 : 400 }} />
              ))}
            </Box>
          </>
        )}

        {screen === 2 && (
          <>
            <Typography variant="h6" fontWeight={800} mb={0.5}>How confident are you in the kitchen?</Typography>
            <Typography variant="body2" color="text.secondary" mb={2}>No right answer — helps us suggest recipes</Typography>
            <Stack spacing={1} mb={3}>
              {SKILL_LEVELS.map(s => (
                <Box key={s.value} onClick={() => setSkill(s.value)}
                  sx={{ p: 1.5, borderRadius: 2, border: 2, cursor: 'pointer',
                    borderColor: skill === s.value ? 'primary.main' : 'divider',
                    bgcolor: skill === s.value ? 'primary.main' + '14' : 'transparent' }}>
                  <Typography variant="body2" fontWeight={skill === s.value ? 700 : 400}>{s.label}</Typography>
                  <Typography variant="caption" color="text.secondary">{s.sub}</Typography>
                </Box>
              ))}
            </Stack>
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
