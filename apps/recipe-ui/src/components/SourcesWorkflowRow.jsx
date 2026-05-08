import { useEffect, useState } from 'react';
import { Box } from '@mui/material';

// Source platforms cycle every 2.4s with an 800ms cross-fade. All three
// logos are stacked in DOM and we toggle opacity — mounting/unmounting
// would cause a brief blank slot mid-swap.
const LOGO_PX = 60;
const ARROW_PX = 16;
const SHARE_PX = 56;
const SOURCE_LOGOS = [
  '/landing-instagram-75.svg',
  '/landing-tiktok-75.svg',
  '/landing-youtube-75.png',
];

function CyclingSourceLogo({ size = LOGO_PX }) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setActive((i) => (i + 1) % SOURCE_LOGOS.length),
      2400,
    );
    return () => clearInterval(id);
  }, []);
  return (
    <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      {SOURCE_LOGOS.map((src, i) => (
        <Box
          key={src}
          component="img"
          src={src}
          alt=""
          sx={{
            position: 'absolute', inset: 0,
            width: size, height: size,
            display: 'block',
            opacity: i === active ? 1 : 0,
            transition: 'opacity 800ms cubic-bezier(.25,.46,.45,.94)',
            willChange: 'opacity',
          }}
        />
      ))}
    </Box>
  );
}

// Source platform (cycling IG/TT/YT) → arrow → iOS share icon → arrow →
// ReciFriend logo. Used both on the public landing's "Save / Cook / Share"
// carousel and inside the Add Recipe drawer to teach the share flow.
//
// Pass darkMode to swap the arrow + share-icon variants. The source-platform
// logos and the ReciFriend logo are theme-agnostic.
export default function SourcesWorkflowRow({ darkMode = false }) {
  const arrowSrc = darkMode ? '/landing-arrow-20-dark.svg' : '/landing-arrow-20.svg';
  const shareSrc = darkMode ? '/landing-share-ios-dark.png' : '/landing-share-ios.png';
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <CyclingSourceLogo />
      <Box
        component="img"
        src={arrowSrc}
        alt=""
        sx={{ width: ARROW_PX, height: ARROW_PX, display: 'block', flexShrink: 0 }}
      />
      <Box
        component="img"
        src={shareSrc}
        alt=""
        sx={{ width: SHARE_PX, height: SHARE_PX, display: 'block', flexShrink: 0, objectFit: 'contain' }}
      />
      <Box
        component="img"
        src={arrowSrc}
        alt=""
        sx={{ width: ARROW_PX, height: ARROW_PX, display: 'block', flexShrink: 0 }}
      />
      <Box
        component="img"
        src="/landing-recifriend-75.png"
        alt="ReciFriend"
        sx={{ width: LOGO_PX, height: LOGO_PX, display: 'block', flexShrink: 0 }}
      />
    </Box>
  );
}
