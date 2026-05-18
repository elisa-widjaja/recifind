import { useEffect, useRef, useState } from 'react';
import { Drawer, Box, Typography, Button, Stack, CircularProgress, Divider } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';

// First-time onboarding hosted in a single bottom-sheet drawer with five
// internal screens: Welcome → Dietary → Cooking-for → Cuisines → Checklist.
// iOS-style X close button on the LEFT (no drag-grabber).

const DIETARY_PREFS = ['🥦 Vegetarian', '🌱 Vegan', '🌾 Gluten-free', '🥛 Dairy-free', '💪 High protein', '🐟 Pescatarian', '🥩 Meat lover', '✅ None / all good'];
const COOKING_FOR = [
  { value: 'solo',         label: '👤 Just me',                sub: 'Quick meals, single portions' },
  { value: 'couple',       label: '👫 Partner or roommate',    sub: 'Easy sharing, 2–3 servings' },
  { value: 'family',       label: '👨‍👩‍👧 Family',               sub: 'Kid-friendly, crowd pleasers' },
  { value: 'entertaining', label: '🎉 I love to entertain',    sub: 'Impressive dishes, feeds a crowd' },
];
const CUISINES = [
  '🍔 American comfort',
  '🥢 Asian',
  '🇫🇷 French',
  '🇮🇳 Indian',
  '🇮🇹 Italian',
  '🇯🇵 Japanese',
  '🫒 Mediterranean',
  '🇲🇽 Mexican',
  '🧆 Middle Eastern',
  '🌍 All of the above',
];

const CHECKLIST_STEPS = [
  {
    label: 'Add your first recipe',
    sub: 'Share directly from social media reels or copy and paste a URL.',
  },
  {
    label: 'Invite a friend',
    sub: "See your friends' recipes and what they are cooking.",
  },
  {
    label: 'Share a recipe with a friend',
    sub: 'Send a recipe you love so it shows up in their feed.',
  },
];

const SCREEN_WELCOME    = 0;
const SCREEN_DIETARY    = 1;
const SCREEN_COOKING_FOR = 2;
const SCREEN_CUISINES   = 3;
const SCREEN_CHECKLIST  = 4;

export default function OnboardingDrawer({
  open,
  inviterName,
  initialPrefs,
  onSavePrefs,
  onComplete,
  onSkipForever,
  onClose,
}) {
  const [screen, setScreen] = useState(SCREEN_WELCOME);
  const [dietary, setDietary] = useState(() => initialPrefs?.dietaryPrefs ?? []);
  const [cookingFor, setCookingFor] = useState(() => initialPrefs?.cookingFor ?? '');
  const [cuisinePrefs, setCuisinePrefs] = useState(() => initialPrefs?.cuisinePrefs ?? []);
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef(null);

  // Reset state ONCE per drawer-open. We must not depend on initialPrefs
  // because handleOnboardingSavePrefs (called from each Next) refetches the
  // profile, which feeds back into initialPrefs — re-firing this effect
  // would snap `screen` back to Welcome mid-flow.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!open) { initializedRef.current = false; return; }
    if (initializedRef.current) return;
    initializedRef.current = true;
    setScreen(SCREEN_WELCOME);
    setDietary(initialPrefs?.dietaryPrefs ?? []);
    setCookingFor(initialPrefs?.cookingFor ?? '');
    setCuisinePrefs(initialPrefs?.cuisinePrefs ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Snap scroll to top on every screen transition.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [screen]);

  const toggleDietary = (value) => {
    if (value === '✅ None / all good') {
      setDietary((prev) => prev.includes(value) ? [] : [value]);
    } else {
      setDietary((prev) => {
        const without = prev.filter((v) => v !== '✅ None / all good');
        return without.includes(value) ? without.filter((v) => v !== value) : [...without, value];
      });
    }
  };
  const toggleCuisine = (value) => {
    if (value === '🌍 All of the above') {
      setCuisinePrefs((prev) => prev.includes(value) ? [] : [value]);
    } else {
      setCuisinePrefs((prev) => {
        const without = prev.filter((v) => v !== '🌍 All of the above');
        return without.includes(value) ? without.filter((v) => v !== value) : [...without, value];
      });
    }
  };

  const goNext = async () => {
    // Save preferences progressively each time the user advances past a
    // prefs screen so partial state isn't lost if they X out mid-flow.
    if (screen === SCREEN_DIETARY || screen === SCREEN_COOKING_FOR || screen === SCREEN_CUISINES) {
      setSaving(true);
      try { await onSavePrefs?.({ dietaryPrefs: dietary, cookingFor, cuisinePrefs }); }
      finally { setSaving(false); }
    }
    setScreen((s) => s + 1);
  };
  const goBack = () => setScreen((s) => Math.max(SCREEN_WELCOME, s - 1));

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      transitionDuration={{ enter: 225, exit: 225 }}
      ModalProps={{
        disableAutoFocus: true,
        disableEnforceFocus: true,
        disableRestoreFocus: true,
        BackdropProps: { transitionDuration: 225 },
      }}
      SlideProps={{ appear: true }}
      PaperProps={{
        sx: (theme) => ({
          width: '100%',
          height: '90dvh',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          paddingBottom: 'env(safe-area-inset-bottom)',
          bgcolor: theme.palette.mode === 'dark' ? '#000' : 'background.paper',
          ...(theme.palette.mode === 'dark' ? {
            backgroundImage: 'none',
            color: 'rgba(255,255,255,0.86)',
          } : null),
          willChange: 'transform',
          transform: 'translateZ(0)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }),
      }}
    >

      {/* Header row: X (left), Back + Next circle buttons (right) */}
      <Box sx={{ px: '24px', pt: '8px', pb: '20px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* X dismissal: if the user has reached the checklist (final) screen,
            treat closing as completion (checklist on home stays collapsed).
            If they dismiss earlier, signal an early-exit so home shows the
            checklist EXPANDED for this session. */}
        <CircleIconButton ariaLabel="Close" onClick={() => {
          if (screen === SCREEN_CHECKLIST) onComplete?.();
          else onClose?.();
        }}>
          <CloseIcon sx={{ fontSize: 18 }} />
        </CircleIconButton>
        <Box sx={{ display: 'flex', gap: 1.75 }}>
          {/* Back: hidden on the welcome screen and on the FIRST prefs
              screen (Dietary). Visible from cooking-for onward. */}
          {(screen === SCREEN_COOKING_FOR || screen === SCREEN_CUISINES || screen === SCREEN_CHECKLIST) && (
            <CircleIconButton ariaLabel="Back" onClick={goBack}>
              <ArrowBackIosNewIcon sx={{ fontSize: 16 }} />
            </CircleIconButton>
          )}
          {/* Next: shown on prefs screens (1-3). Welcome and Checklist
              have their own primary CTA at the bottom. */}
          {(screen === SCREEN_DIETARY || screen === SCREEN_COOKING_FOR || screen === SCREEN_CUISINES) && (
            <CircleIconButton ariaLabel="Next" onClick={goNext} disabled={saving}>
              {saving ? <CircularProgress size={16} sx={{ color: '#8a8a8a' }} /> : <ArrowForwardIosIcon sx={{ fontSize: 16 }} />}
            </CircleIconButton>
          )}
        </Box>
      </Box>

      {/* Scrollable body */}
      <Box ref={scrollRef} sx={{ px: '24px', pb: '32px', overflowY: 'auto', flex: 1 }}>
        {screen === SCREEN_WELCOME && (
          <WelcomeScreen inviterName={inviterName} onContinue={() => setScreen(SCREEN_DIETARY)} onSkipForever={onSkipForever} />
        )}
        {screen === SCREEN_DIETARY && (
          <DietaryScreen
            dietary={dietary}
            toggleDietary={toggleDietary}
            saving={saving}
            onNext={goNext}
            onBack={goBack}
          />
        )}
        {screen === SCREEN_COOKING_FOR && (
          <CookingForScreen
            cookingFor={cookingFor}
            setCookingFor={setCookingFor}
            saving={saving}
            onNext={goNext}
            onBack={goBack}
          />
        )}
        {screen === SCREEN_CUISINES && (
          <CuisinesScreen
            cuisinePrefs={cuisinePrefs}
            toggleCuisine={toggleCuisine}
            saving={saving}
            onNext={goNext}
            onBack={goBack}
          />
        )}
        {screen === SCREEN_CHECKLIST && (
          <ChecklistScreen onGetStarted={onComplete} onBack={goBack} />
        )}
      </Box>
    </Drawer>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function H1({ children }) {
  return <Typography component="h1" sx={{ fontSize: 28, fontWeight: 800, lineHeight: 1.15, color: 'inherit', mb: 0.5 }}>{children}</Typography>;
}
function Tagline({ children }) {
  return <Typography sx={{ fontSize: 14, color: 'text.secondary', mb: 4 }}>{children}</Typography>;
}
function H2({ children }) {
  return <Typography component="h2" sx={{ fontSize: 18, fontWeight: 700, color: 'inherit', mb: 1 }}>{children}</Typography>;
}

// iOS-style 36px circle icon button used in the drawer header (X, Back,
// Next). Children render the icon.
function CircleIconButton({ ariaLabel, onClick, disabled, children }) {
  return (
    <Box
      component="button"
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      sx={(theme) => ({
        width: 36, height: 36, borderRadius: '50%',
        bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
        color: '#8a8a8a',
        border: 'none', cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        WebkitTapHighlightColor: 'transparent',
        transition: 'background-color 150ms ease, transform 150ms ease',
        '&:hover': disabled ? null : { bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)' },
        '&:active': disabled ? null : { transform: 'scale(0.92)' },
      })}
    >
      {children}
    </Box>
  );
}

// ── Screens ────────────────────────────────────────────────────────────

function WelcomeScreen({ inviterName, onContinue, onSkipForever }) {
  const hasInviter = Boolean(inviterName);
  return (
    <Box sx={{ textAlign: 'center', pt: 1 }}>
      <Typography sx={{ fontSize: 56, lineHeight: 1, mb: 1.5 }}>👋</Typography>
      <H1>{hasInviter ? `${inviterName} invited you to ReciFriend` : 'Welcome to ReciFriend!'}</H1>
      <Typography sx={{ fontSize: 15, color: 'text.secondary', mt: 1.5, mb: 4 }}>
        {hasInviter
          ? `${inviterName} cooks some great stuff. Save their recipes to your collection.`
          : 'Discover and save recipes. Share them with friends.'}
      </Typography>
      <Stack spacing={1.5}>
        <Button
          fullWidth
          variant="contained"
          onClick={onContinue}
          sx={{ borderRadius: 999, textTransform: 'none', fontWeight: 700, py: 1.25, fontSize: 15 }}
        >
          {hasInviter ? 'Explore ReciFriend →' : 'Get started →'}
        </Button>
        {onSkipForever && (
          <Button
            fullWidth
            size="small"
            onClick={onSkipForever}
            sx={{ color: 'text.disabled', textTransform: 'none', fontSize: 12 }}
          >
            Don't show this again
          </Button>
        )}
      </Stack>
    </Box>
  );
}

function DietaryScreen({ dietary, toggleDietary, saving, onNext, onBack }) {
  return (
    <>
      <H1>Dietary preferences</H1>
      <Tagline>We'll filter out recipes that don't work for you.</Tagline>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mt: 1 }}>
        {DIETARY_PREFS.map((d) => {
          const sel = dietary.includes(d);
          const firstSpace = d.indexOf(' ');
          const rawEmoji = firstSpace > 0 ? d.slice(0, firstSpace) : d;
          const label = firstSpace > 0 ? d.slice(firstSpace + 1) : '';
          const emoji = d === '✅ None / all good' ? '🍽️' : rawEmoji;
          return (
            <Box
              key={d}
              role="button"
              tabIndex={0}
              aria-pressed={sel}
              onClick={() => toggleDietary(d)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleDietary(d); } }}
              sx={{
                position: 'relative',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: '6px', minHeight: 88, px: 1.25, py: 1.5,
                borderRadius: '18px',
                border: '1.5px solid', borderColor: 'divider',
                bgcolor: 'transparent', color: 'text.primary',
                cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                transition: 'transform 120ms ease',
                '&:active': { transform: 'scale(0.97)' },
                '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
              }}
            >
              {sel && (
                <Box sx={{
                  position: 'absolute', top: '-8px', right: '-8px',
                  width: 22, height: 22, borderRadius: '50%',
                  bgcolor: 'primary.main', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                  boxShadow: (theme) => `0 0 0 2px ${theme.palette.background.paper}`,
                }}>
                  <CheckIcon sx={{ fontSize: 14 }} />
                </Box>
              )}
              <Typography sx={{ fontSize: 28, lineHeight: 1 }}>{emoji}</Typography>
              <Typography sx={{ fontSize: 12.5, fontWeight: 600, textAlign: 'center', lineHeight: 1.2 }}>{label}</Typography>
            </Box>
          );
        })}
      </Box>
    </>
  );
}

function CookingForScreen({ cookingFor, setCookingFor, saving, onNext, onBack }) {
  return (
    <>
      <H1>I am cooking for</H1>
      <Tagline>Helps us suggest the right recipes for your table.</Tagline>
      <Box>
        {COOKING_FOR.map((c, i) => {
          const sel = cookingFor === c.value;
          const isLast = i === COOKING_FOR.length - 1;
          return (
            <Box
              key={c.value}
              role="button"
              tabIndex={0}
              aria-pressed={sel}
              onClick={() => setCookingFor((prev) => prev === c.value ? '' : c.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCookingFor((prev) => prev === c.value ? '' : c.value); } }}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1.5,
                py: 1.75, px: 0,
                borderBottom: isLast ? 0 : 1, borderColor: 'divider',
                cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
              }}
            >
              <Box sx={{
                width: 24, height: 24, borderRadius: '50%',
                border: sel ? 0 : '1.5px solid', borderColor: 'action.disabled',
                bgcolor: sel ? 'primary.main' : 'transparent', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                transition: 'background-color 180ms ease, border-color 180ms ease',
              }}>
                {sel && <CheckIcon sx={{ fontSize: 16 }} />}
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography sx={{ fontSize: 15, fontWeight: 500, color: 'text.primary', lineHeight: 1.3 }}>{c.label}</Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>{c.sub}</Typography>
              </Box>
            </Box>
          );
        })}
      </Box>
    </>
  );
}

function CuisinesScreen({ cuisinePrefs, toggleCuisine, saving, onNext, onBack }) {
  return (
    <>
      <H1>Favorite cuisines</H1>
      <Tagline>Pick all that apply — we'll surface more of what you're into.</Tagline>
      <Box>
        {CUISINES.map((c, i) => {
          const sel = cuisinePrefs.includes(c);
          const firstSpace = c.indexOf(' ');
          const label = firstSpace > 0 ? c.slice(firstSpace + 1) : c;
          const isLast = i === CUISINES.length - 1;
          return (
            <Box
              key={c}
              role="button"
              tabIndex={0}
              aria-pressed={sel}
              onClick={() => toggleCuisine(c)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCuisine(c); } }}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1.5,
                py: 1.75, px: 0,
                borderBottom: isLast ? 0 : 1, borderColor: 'divider',
                cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
              }}
            >
              <Box sx={{
                width: 24, height: 24, borderRadius: '50%',
                border: sel ? 0 : '1.5px solid', borderColor: 'action.disabled',
                bgcolor: sel ? 'primary.main' : 'transparent', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                transition: 'background-color 180ms ease, border-color 180ms ease',
              }}>
                {sel && <CheckIcon sx={{ fontSize: 16 }} />}
              </Box>
              <Typography sx={{ flex: 1, fontSize: 15, fontWeight: 500, color: 'text.primary' }}>{label}</Typography>
            </Box>
          );
        })}
      </Box>
    </>
  );
}

function ChecklistScreen({ onGetStarted, onBack }) {
  return (
    <>
      <H1>You're all set</H1>
      <Tagline>Three quick wins to get the most out of ReciFriend.</Tagline>

      <Stack spacing={2.25} sx={{ mb: 2 }}>
        {CHECKLIST_STEPS.map((step) => (
          <Box key={step.label} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
            {/* Soft grey circle with a check — hints at the completed
                state without claiming the step is done yet. Theme-aware
                tint so it reads on both light and dark backgrounds. */}
            <Box sx={(theme) => ({
              width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
              bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
              color: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              mt: '1px',
            })}>
              <CheckIcon sx={{ fontSize: 16 }} />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3 }}>
                {step.label}
              </Typography>
              <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.25 }}>
                {step.sub}
              </Typography>
            </Box>
          </Box>
        ))}
      </Stack>

      <Button
        fullWidth
        variant="contained"
        onClick={onGetStarted}
        sx={{ borderRadius: 999, textTransform: 'none', fontWeight: 700, py: 1.25, fontSize: 15, mt: 4 }}
      >
        Get started
      </Button>
    </>
  );
}
