import { describe, it, expect } from 'vitest';
import vectors from '../../../test-fixtures/duration-vectors.json';
import { estimateDurationMinutes, ensureEstimatedDuration } from './estimateDuration';

function buildCase(v: any) {
  const steps = v.steps ?? Array(v.stepsRepeat.count).fill(v.stepsRepeat.text);
  const ingredients = v.ingredients ?? Array(v.ingredientsCount ?? 0).fill('x');
  return { steps, ingredients, expected: v.expected, name: v.name };
}

describe('estimateDurationMinutes', () => {
  for (const v of vectors as any[]) {
    const c = buildCase(v);
    it(c.name, () => {
      expect(estimateDurationMinutes(c.steps, c.ingredients)).toBe(c.expected);
    });
  }
  it('returns 0 for non-array steps', () => {
    expect(estimateDurationMinutes(undefined as any, [])).toBe(0);
  });
});

describe('ensureEstimatedDuration', () => {
  it('fills durationMinutes when null and steps exist', () => {
    const r: any = { durationMinutes: null, steps: ['Chop the onions', 'Add to pan', 'Serve hot'], ingredients: ['onion', 'oil', 'salt', 'pepper'] };
    ensureEstimatedDuration(r);
    expect(r.durationMinutes).toBe(11);
  });
  it('leaves an existing positive durationMinutes untouched', () => {
    const r: any = { durationMinutes: 25, steps: ['x'], ingredients: [] };
    ensureEstimatedDuration(r);
    expect(r.durationMinutes).toBe(25);
  });
  it('stays null when there are no steps', () => {
    const r: any = { durationMinutes: 0, steps: [], ingredients: ['a'] };
    ensureEstimatedDuration(r);
    expect(r.durationMinutes).toBe(null);
  });
});
