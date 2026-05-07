import { useEffect, useState } from 'react';
import { Drawer, Box, Typography, IconButton, TextField, Button, Stack, CircularProgress, Rating, Chip, Divider } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import { Capacitor } from '@capacitor/core';

// Right-anchored drawer used for "info" pages (About, Privacy, Notifications)
// and the Send Feedback form. Slides in from the right with MUI's default
// drawer transition. Replaces the four static HTML pages (kept on disk only
// as fallbacks for direct URL access / OAuth verifiers) and the old Feedback
// Dialog.
export default function SettingsDrawer({
  kind,
  onClose,
  // Feedback-specific (controlled by App.jsx so submit/network state lives there).
  feedbackRating,
  setFeedbackRating,
  feedbackFrequency,
  setFeedbackFrequency,
  feedbackMessage,
  setFeedbackMessage,
  feedbackEmail,
  setFeedbackEmail,
  feedbackSubmitting,
  feedbackDone,
  onSubmitFeedback,
  onResetFeedback,
  // Cooking preferences (read initial values from profile; save closes drawer).
  preferences,
  onSavePreferences,
}) {
  const open = !!kind;
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      // Default MUI is { enter: 225, exit: 195 } — exit is faster than enter.
      // Match exit to enter so open and close feel symmetrical.
      transitionDuration={{ enter: 225, exit: 225 }}
      // Sync the backdrop fade with the slide. Disable focus management hooks
      // that can cause a one-frame focus-ring flash on open.
      ModalProps={{
        disableAutoFocus: true,
        disableEnforceFocus: true,
        disableRestoreFocus: true,
        BackdropProps: { transitionDuration: 225 },
      }}
      // appear:true makes Slide enter from the offscreen state on first
      // render instead of briefly painting at its final on-screen position.
      SlideProps={{ appear: true }}
      PaperProps={{
        sx: (theme) => ({
          width: '100%',
          maxWidth: { xs: '100%', sm: 480 },
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          // True black on dark theme; standard background.paper (white) on light.
          bgcolor: theme.palette.mode === 'dark' ? '#000' : 'background.paper',
          // MUI Paper applies a translucent white "elevation overlay" via
          // backgroundImage in dark mode (Drawer is elevation 16). Without
          // overriding it, even bgcolor:#000 reads as dark grey.
          ...(theme.palette.mode === 'dark' ? {
            backgroundImage: 'none',
            // Soften body text from pure white to off-white so it's not
            // max contrast on true black (easier on the eyes). The H1/H2/P
            // helpers use color:inherit so they pick this up.
            color: 'rgba(255,255,255,0.86)',
          } : null),
          // GPU layer hint — smooths the slide transform on iOS WKWebView
          // and avoids subpixel rendering hiccups during animation.
          willChange: 'transform',
          transform: 'translateZ(0)',
        }),
      }}
    >
      {/* iOS-style circle back button */}
      <Box sx={{ px: '24px', pt: '12px', pb: 0 }}>
        <BackButton onClick={onClose} />
      </Box>
      <Box sx={{ px: '24px', pb: '40px', overflowY: 'auto' }}>
        {kind === 'about' && <AboutContent />}
        {kind === 'privacy' && <PrivacyContent />}
        {kind === 'notifications' && <NotificationsContent />}
        {kind === 'preferences' && (
          <PreferencesContent
            initial={preferences}
            onSave={async (next) => { await onSavePreferences?.(next); onClose?.(); }}
          />
        )}
        {kind === 'feedback' && (
          <FeedbackContent
            rating={feedbackRating}
            setRating={setFeedbackRating}
            frequency={feedbackFrequency}
            setFrequency={setFeedbackFrequency}
            message={feedbackMessage}
            setMessage={setFeedbackMessage}
            email={feedbackEmail}
            setEmail={setFeedbackEmail}
            submitting={feedbackSubmitting}
            done={feedbackDone}
            onSubmit={onSubmitFeedback}
            onResetToCompose={onResetFeedback}
            onClose={onClose}
          />
        )}
      </Box>
    </Drawer>
  );
}

function BackButton({ onClick }) {
  return (
    <Box
      component="button"
      aria-label="Back"
      onClick={onClick}
      sx={(theme) => ({
        width: 36, height: 36, borderRadius: '50%',
        // Tint reverses on dark theme so the button stays visible against
        // the black drawer background.
        bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
        color: '#8a8a8a',
        border: 'none', cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        WebkitTapHighlightColor: 'transparent',
        transition: 'background-color 150ms ease, transform 150ms ease',
        '&:hover': {
          bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)',
        },
        '&:active': { transform: 'scale(0.92)' },
        mb: '24px',
      })}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
        strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
        <line x1="19" y1="12" x2="5" y2="12" />
        <polyline points="12 19 5 12 12 5" />
      </svg>
    </Box>
  );
}

// ── Content blocks ──────────────────────────────────────────────────────

function H1({ children }) {
  return <Typography component="h1" sx={{ fontSize: 28, fontWeight: 800, lineHeight: 1.15, color: 'inherit', mb: 0.5 }}>{children}</Typography>;
}
function Tagline({ children }) {
  return <Typography sx={{ fontSize: 14, fontStyle: 'italic', color: 'text.secondary', mb: 4 }}>{children}</Typography>;
}
function H2({ children }) {
  return <Typography component="h2" sx={{ fontSize: 18, fontWeight: 700, color: 'inherit', mt: 4, mb: 1 }}>{children}</Typography>;
}
function P({ children }) {
  return <Typography component="p" sx={{ fontSize: 15, color: 'inherit', lineHeight: 1.6, mb: 1.5 }}>{children}</Typography>;
}
function UL({ children }) {
  return <Box component="ul" sx={{ pl: 2.5, mb: 2, '& li': { fontSize: 15, color: 'inherit', lineHeight: 1.6, mb: 1 } }}>{children}</Box>;
}
function ExternalLink({ href, children }) {
  return <Box component="a" href={href} target="_blank" rel="noopener" sx={{ color: 'primary.main', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>{children}</Box>;
}

function AboutContent() {
  return (
    <>
      <H1>ReciFriend</H1>
      <Tagline>A group chat for cooking.</Tagline>

      <H2>What it is</H2>
      <P>ReciFriend is a recipe-saving and sharing app for home cooks. Save the recipes you love, share them with friends, and see what the people you cook with are making.</P>

      <H2>Who it's for</H2>
      <P>Made for home cooks sharing with family and friends — not influencers, not audiences. If you've ever sent a recipe link in a group chat and wished it lived somewhere better, ReciFriend is for you.</P>

      <H2>How it works</H2>
      <P>Paste a recipe URL from anywhere — TikTok, Instagram, food blogs, YouTube — and we'll extract the ingredients and steps so you can cook from the recipe directly. Add friends, share what you're cooking, and let your people inspire your next meal.</P>

      <H2>Get in touch</H2>
      <P>Questions, feedback, feature ideas, bugs — anything: <ExternalLink href="mailto:hello@recifriend.com">hello@recifriend.com</ExternalLink>.</P>

      <Box sx={{ mt: 5, pt: 2.5, borderTop: 1, borderColor: 'divider' }}>
        <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 0.5 }}>recifriend.com</Typography>
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>Made with care.</Typography>
      </Box>
    </>
  );
}

function PrivacyContent() {
  return (
    <>
      <H1>Privacy Policy</H1>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 4 }}>Last updated: 2026-04-17</Typography>

      <P>ReciFriend ("we", "us", "our") is a recipe-saving and sharing app. This policy explains what data we collect, how we use it, and your rights.</P>

      <H2>1. What we collect</H2>
      <UL>
        <li><strong>Account information:</strong> email address and display name provided via Google Sign-In.</li>
        <li><strong>Recipes:</strong> URLs, titles, ingredients, steps, and images you save to your collection.</li>
        <li><strong>Friend graph:</strong> the list of friends you connect with and pending friend invites.</li>
        <li><strong>Preferences:</strong> meal type preferences, dietary preferences, and skill level you set during onboarding.</li>
        <li><strong>Security logs:</strong> IP address and browser user-agent for rate limiting and abuse prevention. Not stored long-term.</li>
        <li><strong>Email opt-out status:</strong> whether you have unsubscribed from notification emails.</li>
      </UL>

      <H2>2. Third-party services</H2>
      <UL>
        <li><strong>Supabase</strong> — authentication (Google OAuth), user accounts, image storage. <ExternalLink href="https://supabase.com/privacy">supabase.com/privacy</ExternalLink></li>
        <li><strong>Cloudflare</strong> — app hosting (Pages), API worker, database (D1), key-value (KV). <ExternalLink href="https://www.cloudflare.com/privacypolicy/">cloudflare.com/privacypolicy</ExternalLink></li>
        <li><strong>Google Gemini</strong> — server-side recipe enrichment. Recipe URLs may be sent; no personal account data is shared.</li>
        <li><strong>Resend</strong> — transactional email. Your email is passed to Resend only when sending you a notification. <ExternalLink href="https://resend.com/legal/privacy-policy">resend.com/legal/privacy-policy</ExternalLink></li>
        <li><strong>Apple APNs</strong> — iOS push notifications. A device token is stored server-side, used only to deliver notifications relevant to your account.</li>
      </UL>
      <P>We do not use advertising networks, tracking pixels, or third-party analytics beyond what is listed above.</P>

      <H2>3. How we use your data</H2>
      <UL>
        <li>To operate the app: display your recipes, connect you with friends, send transactional notifications.</li>
        <li>To improve recipe enrichment: recipe URLs are processed by Gemini for structured data.</li>
        <li>To prevent abuse: request rate limiting based on IP address.</li>
      </UL>
      <P>We do not sell your data, share it with advertisers, or use it for profiling outside of ReciFriend.</P>

      <H2>4. Your rights</H2>
      <UL>
        <li><strong>Export your data:</strong> email <ExternalLink href="mailto:hello@recifriend.com">hello@recifriend.com</ExternalLink> for a copy.</li>
        <li><strong>Delete your account:</strong> email <ExternalLink href="mailto:hello@recifriend.com">hello@recifriend.com</ExternalLink> with subject "Delete my account". Removed within 30 days.</li>
        <li><strong>Unsubscribe from emails:</strong> every notification email includes an unsubscribe link.</li>
      </UL>

      <H2>5. Data retention</H2>
      <P>Your data is retained as long as your account is active. Deleted accounts are purged within 30 days. Security logs are not retained beyond request handling.</P>

      <H2>6. Children</H2>
      <P>ReciFriend is not directed at children under 13. We do not knowingly collect personal information from children under 13.</P>

      <H2>7. Changes to this policy</H2>
      <P>Material changes will be communicated by email. Continued use of ReciFriend after updates constitutes acceptance.</P>

      <H2>8. Contact</H2>
      <P><ExternalLink href="mailto:hello@recifriend.com">hello@recifriend.com</ExternalLink></P>
    </>
  );
}

function NotificationsContent() {
  return (
    <>
      <H1>Notifications</H1>
      <Tagline>Stay in the loop with your cooking circle.</Tagline>

      <H2>Why turn them on</H2>
      <P>Notifications are how ReciFriend keeps you connected to what your friends are cooking. We only send a handful — never spam.</P>
      <UL>
        <li><strong>Friend requests</strong> — know the moment someone wants to connect.</li>
        <li><strong>Recipes shared with you</strong> — when a friend sends a recipe your way, see it right away.</li>
        <li><strong>Saves on your recipes</strong> — find out when a friend bookmarks something you posted.</li>
        <li><strong>Friend activity highlights</strong> — occasional nudges about what your circle is cooking.</li>
      </UL>

      <H2>How to manage</H2>
      <P>Notification permissions are managed by your device's system settings.</P>
      <P><strong>iOS:</strong> Settings → ReciFriend → Notifications.<br />
        <strong>Android / web:</strong> use your browser or system settings.</P>

      <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 5, pt: 2.5, borderTop: 1, borderColor: 'divider' }}>
        You can revoke permissions any time. We'll never send marketing emails or push notifications.
      </Typography>
    </>
  );
}

function FeedbackContent({
  rating, setRating,
  frequency, setFrequency,
  message, setMessage,
  email, setEmail,
  submitting, done,
  onSubmit, onResetToCompose, onClose,
}) {
  if (done) {
    return (
      <Box sx={{ textAlign: 'center', py: 6 }}>
        <Typography sx={{ fontSize: 22, fontWeight: 700, mb: 1.5 }}>Thank you!</Typography>
        <Typography sx={{ fontSize: 15, color: 'text.secondary', mb: 4 }}>
          We read every piece of feedback. We'll get back to you if you left an email.
        </Typography>
        <Button variant="contained" onClick={() => { onResetToCompose?.(); onClose?.(); }}
          sx={{ borderRadius: 999, textTransform: 'none', fontWeight: 600, px: 3, py: 1.25 }}>
          Done
        </Button>
      </Box>
    );
  }

  const FREQUENCIES = [
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'rarely', label: 'Rarely' },
    { value: 'first', label: 'First time' },
  ];

  return (
    <>
      <H1>Send feedback</H1>
      <Tagline>What's working, what isn't, what's missing — tell us anything.</Tagline>

      <Stack spacing={3.5}>
        <Box>
          <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 1.25 }}>How would you rate ReciFriend so far?</Typography>
          <Rating value={rating ?? 0} onChange={(_, v) => setRating(v)} size="large" />
        </Box>

        <Box>
          <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 1.25 }}>How often do you cook?</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {FREQUENCIES.map((f) => {
              const active = frequency === f.value;
              return (
                <Box
                  key={f.value}
                  component="button"
                  type="button"
                  onClick={() => setFrequency(f.value)}
                  sx={(theme) => ({
                    px: 1.75, py: 0.875, borderRadius: 999, border: 'none',
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
                    bgcolor: active
                      ? 'primary.main'
                      : (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.05)'),
                    color: active ? '#fff' : 'text.primary',
                  })}
                >
                  {f.label}
                </Box>
              );
            })}
          </Box>
        </Box>

        <Box>
          <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 1.25 }}>Other comments</Typography>
          <TextField
            multiline rows={4}
            placeholder="Optional comments…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            fullWidth size="small"
          />
        </Box>

        <TextField
          placeholder="Your email (optional)"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          fullWidth size="small" type="email"
        />

        <Button
          variant="contained"
          onClick={onSubmit}
          disabled={submitting || !frequency || !rating}
          sx={{ borderRadius: 999, textTransform: 'none', fontWeight: 700, py: 1.25 }}
        >
          {submitting ? <CircularProgress size={20} sx={{ color: '#fff' }} /> : 'Send'}
        </Button>
      </Stack>
    </>
  );
}

// ── Cooking preferences (settings-side editor) ─────────────────────────
// Mirrors the OnboardingFlow's three sections, but on a single scrolling
// page (no pagination, no progress bar, no "don't show this again"). Used
// when the user revisits to edit prefs they entered during onboarding.
const DIETARY_PREFS = ['🥦 Vegetarian', '🌱 Vegan', '🌾 Gluten-free', '🥛 Dairy-free', '💪 High protein', '🐟 Pescatarian', '🥩 Meat lover', '✅ None / all good'];
const COOKING_FOR = [
  { value: 'solo',         label: '👤 Just me',                sub: 'Quick meals, single portions' },
  { value: 'couple',       label: '👫 Partner or roommate',    sub: 'Easy sharing, 2–3 servings' },
  { value: 'family',       label: '👨‍👩‍👧 Family',               sub: 'Kid-friendly, crowd pleasers' },
  { value: 'entertaining', label: '🎉 I love to entertain',    sub: 'Impressive dishes, feeds a crowd' },
];
// Alphabetical by label; "All of the above" pinned at the end.
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

function PreferencesContent({ initial, onSave }) {
  const [dietary, setDietary] = useState(() => initial?.dietaryPrefs ?? []);
  const [cookingFor, setCookingFor] = useState(() => initial?.cookingFor ?? '');
  const [cuisinePrefs, setCuisinePrefs] = useState(() => initial?.cuisinePrefs ?? []);
  const [saving, setSaving] = useState(false);

  // If the user reopens the drawer after the profile re-fetches with newer
  // values, pull those in (only when the drawer transitions open — initial
  // is supplied by the parent each time it mounts).
  useEffect(() => {
    setDietary(initial?.dietaryPrefs ?? []);
    setCookingFor(initial?.cookingFor ?? '');
    setCuisinePrefs(initial?.cuisinePrefs ?? []);
  }, [initial?.dietaryPrefs, initial?.cookingFor, initial?.cuisinePrefs]);

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

  const handleSave = async () => {
    setSaving(true);
    try { await onSave({ dietaryPrefs: dietary, cookingFor, cuisinePrefs }); }
    finally { setSaving(false); }
  };

  return (
    <>
      <H1>Cooking preferences</H1>
      <Tagline>Tune what we surface and suggest.</Tagline>

      <H2>Dietary preferences</H2>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>
        We'll filter out recipes that don't work for you.
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 1, mt: 1 }}>
        {DIETARY_PREFS.map((d) => {
          const sel = dietary.includes(d);
          const firstSpace = d.indexOf(' ');
          const rawEmoji = firstSpace > 0 ? d.slice(0, firstSpace) : d;
          const label = firstSpace > 0 ? d.slice(firstSpace + 1) : '';
          // Override the "✅" green check on the no-restrictions option so it
          // doesn't visually clash with the new purple selection check; keep
          // the underlying stored value unchanged for backward compat.
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
                gap: '6px',
                minHeight: 88,
                px: 1.25, py: 1.5,
                borderRadius: '18px',
                border: '1.5px solid',
                borderColor: 'divider',
                bgcolor: 'transparent',
                color: 'text.primary',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                transition: 'transform 120ms ease',
                '&:active': { transform: 'scale(0.97)' },
                '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
              }}
            >
              {sel && (
                <Box sx={{
                  // Hangs over the top-right corner of the card.
                  position: 'absolute', top: '-8px', right: '-8px',
                  width: 22, height: 22, borderRadius: '50%',
                  bgcolor: 'primary.main', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                  // Extra ring so the badge reads as detached from the card.
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

      <Divider sx={{ my: 3 }} />

      <H2>I am cooking for</H2>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>
        Helps us suggest the right recipes for your table.
      </Typography>
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
                borderBottom: isLast ? 0 : 1,
                borderColor: 'divider',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2, borderRadius: 1 },
              }}
            >
              <Box
                sx={{
                  width: 24, height: 24, borderRadius: '50%',
                  border: sel ? 0 : '1.5px solid',
                  borderColor: 'action.disabled',
                  bgcolor: sel ? 'primary.main' : 'transparent',
                  color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'background-color 180ms ease, border-color 180ms ease',
                }}
              >
                {sel && <CheckIcon sx={{ fontSize: 16 }} />}
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography sx={{ fontSize: 15, fontWeight: 500, color: 'text.primary', lineHeight: 1.3 }}>
                  {c.label}
                </Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>
                  {c.sub}
                </Typography>
              </Box>
            </Box>
          );
        })}
      </Box>

      <Divider sx={{ my: 3 }} />

      <H2>Favorite cuisines</H2>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>
        Pick all that apply — we'll surface more of what you're into.
      </Typography>
      <Box sx={{ mb: 4 }}>
        {CUISINES.map((c, i) => {
          const sel = cuisinePrefs.includes(c);
          // Strip the leading flag/glyph from stored values for display only
          // (kept on disk for backward compat with profiles set during
          // onboarding).
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
                borderBottom: isLast ? 0 : 1,
                borderColor: 'divider',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2, borderRadius: 1 },
              }}
            >
              <Box
                sx={{
                  width: 24, height: 24, borderRadius: '50%',
                  border: sel ? 0 : '1.5px solid',
                  borderColor: 'action.disabled',
                  bgcolor: sel ? 'primary.main' : 'transparent',
                  color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'background-color 180ms ease, border-color 180ms ease',
                }}
              >
                {sel && <CheckIcon sx={{ fontSize: 16 }} />}
              </Box>
              <Typography sx={{ flex: 1, fontSize: 15, fontWeight: 500, color: 'text.primary' }}>
                {label}
              </Typography>
            </Box>
          );
        })}
      </Box>

      <Button
        variant="contained"
        onClick={handleSave}
        disabled={saving}
        fullWidth
        sx={{ borderRadius: 999, textTransform: 'none', fontWeight: 700, py: 1.25 }}
      >
        {saving ? <CircularProgress size={20} sx={{ color: '#fff' }} /> : 'Save'}
      </Button>
    </>
  );
}
