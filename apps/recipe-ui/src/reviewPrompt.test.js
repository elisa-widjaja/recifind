import { describe, it, expect } from 'vitest';
import { decideReviewPrompt, REVIEW_THRESHOLD } from './reviewPrompt';

const base = { count: REVIEW_THRESHOLD, now: 1_000_000, state: {}, armedThisSession: false, isIOS: true };

describe('decideReviewPrompt', () => {
  it('skips on non-iOS even when otherwise eligible', () => {
    expect(decideReviewPrompt({ ...base, isIOS: false })).toBe('skip');
  });

  it('skips below the recipe threshold', () => {
    expect(decideReviewPrompt({ ...base, count: REVIEW_THRESHOLD - 1 })).toBe('skip');
  });

  it('arms (does not show) the first time the threshold is reached', () => {
    expect(decideReviewPrompt({ ...base, state: {} })).toBe('arm');
  });

  it('skips when armed during this same session (waits for return visit)', () => {
    expect(decideReviewPrompt({ ...base, state: { armedAt: 500_000 }, armedThisSession: true })).toBe('skip');
  });

  it('shows on a return visit (armed in a prior session, not rated, not snoozed)', () => {
    expect(decideReviewPrompt({ ...base, state: { armedAt: 500_000 }, armedThisSession: false })).toBe('show');
  });

  it('skips forever once rated', () => {
    expect(decideReviewPrompt({ ...base, state: { armedAt: 500_000, rated: true } })).toBe('skip');
  });

  it('skips while within the snooze window', () => {
    expect(decideReviewPrompt({ ...base, state: { armedAt: 500_000, snoozedUntil: base.now + 1 } })).toBe('skip');
  });

  it('shows again after the snooze window expires', () => {
    expect(decideReviewPrompt({ ...base, state: { armedAt: 500_000, snoozedUntil: base.now - 1 }, armedThisSession: false })).toBe('show');
  });
});
