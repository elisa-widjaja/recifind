// Gating logic for the App Store review prompt (two-step sentiment gate).
// iOS-only, shown to engaged users (>= REVIEW_THRESHOLD saved recipes) on a
// RETURN visit — never the session they cross the threshold — and never again
// once they rate, with a 90-day snooze on dismiss/decline.

export const REVIEW_PROMPT_KEY = 'review_prompt';            // localStorage (persistent state)
export const REVIEW_ARMED_SESSION_KEY = 'review_armed_session'; // sessionStorage (per-launch)
export const REVIEW_THRESHOLD = 5;
export const REVIEW_SNOOZE_MS = 90 * 24 * 60 * 60 * 1000;

// Pure decision. Returns:
//   'arm'  — threshold reached but not yet armed: record armedAt, do NOT show.
//   'show' — armed on a previous session (return visit), eligible now.
//   'skip' — not eligible (non-iOS, below threshold, rated, snoozed, or armed
//            this same session so we wait for the next launch).
export function decideReviewPrompt({ count, now, state, armedThisSession, isIOS }) {
  if (!isIOS) return 'skip';
  const s = state || {};
  if (s.rated) return 'skip';
  if (s.snoozedUntil && now < s.snoozedUntil) return 'skip';
  if (count < REVIEW_THRESHOLD) return 'skip';
  if (!s.armedAt) return 'arm';        // first crossing — arm now, show on a later launch
  if (armedThisSession) return 'skip'; // armed this same session — wait for the return visit
  return 'show';
}

export function readReviewState() {
  try {
    return JSON.parse(localStorage.getItem(REVIEW_PROMPT_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

export function writeReviewState(patch) {
  try {
    const next = { ...readReviewState(), ...patch };
    localStorage.setItem(REVIEW_PROMPT_KEY, JSON.stringify(next));
    return next;
  } catch {
    return readReviewState();
  }
}

export function isArmedThisSession() {
  try {
    return sessionStorage.getItem(REVIEW_ARMED_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

export function markArmedThisSession() {
  try {
    sessionStorage.setItem(REVIEW_ARMED_SESSION_KEY, '1');
  } catch {
    /* sessionStorage unavailable — worst case the prompt can show same-session */
  }
}
