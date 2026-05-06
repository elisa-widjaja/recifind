import { Box, Typography } from '@mui/material';

// Right-arrow glyph reused across both designs. Uses the same path as
// /landing-arrow-20.svg so the visual lockup matches the brand arrow.
function Arrow({ color, size = 18 }) {
  return (
    <Box component="svg" viewBox="0 0 20 20" sx={{ width: size, height: size, display: 'block' }} fill="none">
      <path
        d="M13.4793 10.8333H3.3335V9.16659H13.4793L8.81266 4.49992L10.0002 3.33325L16.6668 9.99992L10.0002 16.6666L8.81266 15.4999L13.4793 10.8333Z"
        fill={color}
      />
    </Box>
  );
}

// Per-mode tokens — explicit hex so the preview renders the same regardless
// of the surrounding MUI theme. Light values traced from the user's mocks.
function tokens(dark) {
  if (dark) {
    return {
      bg: 'linear-gradient(135deg, #1c1825 0%, #141319 100%)',
      text: '#fff',
      label: 'rgba(255,255,255,0.9)',
      divider: 'rgba(255,255,255,0.08)',
      arrow: '#fff',
      border: '1px solid rgba(255,255,255,0.06)',
      shadow: 'none',
      pageBg: '#121212',
    };
  }
  return {
    bg: 'linear-gradient(135deg, #ffffff 0%, #f2f0ff 100%)',
    text: '#0a0a0a',
    label: '#0a0a0a',
    divider: 'rgba(0,0,0,0.08)',
    arrow: '#0a0a0a',
    border: '1px solid rgba(0,0,0,0.06)',
    shadow: '0 1px 3px rgba(0,0,0,0.04)',
    pageBg: '#fafafa',
  };
}

const STATS = [
  { num: 333, label: 'Recipes' },
  { num: 13,  label: 'Friends' },
];

// Design 1 — horizontal split: number on top, label below, arrow bottom-right.
function Design1Tile({ dark }) {
  const t = tokens(dark);
  return (
    <Box sx={{
      display: 'grid', gridTemplateColumns: '1fr 1fr',
      borderRadius: '14px',
      background: t.bg,
      border: t.border,
      boxShadow: t.shadow,
      overflow: 'hidden',
    }}>
      {STATS.map((stat, i) => (
        <Box key={stat.label} sx={{
          position: 'relative',
          p: '18px 20px',
          minHeight: 100,
          borderLeft: i === 0 ? 'none' : `1px solid ${t.divider}`,
        }}>
          <Typography sx={{
            fontSize: 32, fontWeight: 800, lineHeight: 1, mb: 1.25,
            color: t.text, fontVariantNumeric: 'tabular-nums',
          }}>
            {stat.num}
          </Typography>
          <Typography sx={{ fontSize: 14, fontWeight: 500, color: t.label }}>
            {stat.label}
          </Typography>
          <Box sx={{ position: 'absolute', right: 14, bottom: 14 }}>
            <Arrow color={t.arrow} />
          </Box>
        </Box>
      ))}
    </Box>
  );
}

// Design 2 — vertical split: label on top, number below, arrow vertically
// centered on the right edge.
function Design2Tile({ dark }) {
  const t = tokens(dark);
  return (
    <Box sx={{
      borderRadius: '14px',
      background: t.bg,
      border: t.border,
      boxShadow: t.shadow,
      overflow: 'hidden',
    }}>
      {STATS.map((stat, i) => (
        <Box key={stat.label} sx={{
          position: 'relative',
          p: '16px 20px',
          borderTop: i === 0 ? 'none' : `1px solid ${t.divider}`,
        }}>
          <Typography sx={{ fontSize: 13, fontWeight: 500, color: t.label, mb: 0.5 }}>
            {stat.label}
          </Typography>
          <Typography sx={{
            fontSize: 32, fontWeight: 800, lineHeight: 1,
            color: t.text, fontVariantNumeric: 'tabular-nums',
          }}>
            {stat.num}
          </Typography>
          <Box sx={{ position: 'absolute', right: 18, top: '50%', transform: 'translateY(-50%)' }}>
            <Arrow color={t.arrow} />
          </Box>
        </Box>
      ))}
    </Box>
  );
}

// One labeled panel: tile shown at full width on top of a wrapper that
// matches the page background of the theme being demonstrated. This gives
// an honest read of how the tile blends in light vs. dark contexts.
function PreviewPanel({ Tile, dark, label }) {
  const t = tokens(dark);
  return (
    <Box sx={{
      bgcolor: t.pageBg,
      borderRadius: '12px',
      p: '14px 14px 10px',
    }}>
      <Tile dark={dark} />
      <Typography sx={{
        mt: '10px',
        fontSize: 10, fontWeight: 700, letterSpacing: '0.6px',
        textTransform: 'uppercase',
        color: dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)',
        textAlign: 'center',
      }}>
        {label}
      </Typography>
    </Box>
  );
}

export default function StatsTilesPreview() {
  return (
    <Box sx={{
      display: 'flex', flexDirection: 'column', gap: 1.5,
      p: 1.5,
      borderRadius: '12px',
      border: '1px dashed',
      borderColor: 'divider',
    }}>
      <Typography sx={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.8px',
        textTransform: 'uppercase', color: 'text.secondary',
      }}>
        Stat tiles — design exploration
      </Typography>

      <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'text.primary', mt: 0.5 }}>
        Design 1 — number on top, arrow bottom-right
      </Typography>
      <PreviewPanel Tile={Design1Tile} dark={false} label="Light" />
      <PreviewPanel Tile={Design1Tile} dark={true}  label="Dark" />

      <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'text.primary', mt: 1 }}>
        Design 2 — label on top, arrow on right edge
      </Typography>
      <PreviewPanel Tile={Design2Tile} dark={false} label="Light" />
      <PreviewPanel Tile={Design2Tile} dark={true}  label="Dark" />
    </Box>
  );
}
