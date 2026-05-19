import { describe, it, expect } from 'vitest';
import vectors from '../../../../test-fixtures/duration-vectors.json';
import { estimateDurationMinutes } from './estimateDuration';

function buildCase(v) {
  const steps = v.steps ?? Array(v.stepsRepeat.count).fill(v.stepsRepeat.text);
  const ingredients = v.ingredients ?? Array(v.ingredientsCount ?? 0).fill('x');
  return { steps, ingredients, expected: v.expected, name: v.name };
}

describe('estimateDurationMinutes (frontend mirror)', () => {
  for (const v of vectors) {
    const c = buildCase(v);
    it(c.name, () => {
      expect(estimateDurationMinutes(c.steps, c.ingredients)).toBe(c.expected);
    });
  }
  it('returns 0 for non-array steps', () => {
    expect(estimateDurationMinutes(undefined, [])).toBe(0);
  });
});
