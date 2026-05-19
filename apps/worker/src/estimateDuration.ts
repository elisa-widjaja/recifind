// Pure, deterministic cook-time estimate. MUST stay byte-for-byte equivalent
// to apps/recipe-ui/src/utils/estimateDuration.js — both are pinned by
// test-fixtures/duration-vectors.json so they cannot silently drift.

export function estimateDurationMinutes(steps: unknown, ingredients: unknown): number {
  const s = Array.isArray(steps)
    ? steps.map((x) => String(x ?? '').trim()).filter(Boolean)
    : [];
  if (s.length === 0) return 0;
  const ing = Array.isArray(ingredients)
    ? ingredients.filter((x) => String(x ?? '').trim())
    : [];

  let minutes = 0;
  for (const step of s) {
    minutes += 3;
    minutes += Math.min(Math.floor(step.length / 80), 4);
  }

  const joined = s.join(' ').toLowerCase();
  const verbBonuses: Array<[RegExp, number]> = [
    [/\bmarinat/, 30],
    [/\b(bake|roast)\b/, 20],
    [/\b(chill|refrigerat)/, 20],
    [/\bsimmer\b/, 15],
    [/\b(rest|proof|rise|prove)\b/, 15],
    [/\bboil\b/, 10],
  ];
  for (const [re, bonus] of verbBonuses) {
    if (re.test(joined)) minutes += bonus;
  }

  minutes += Math.round(Math.min(ing.length, 15) * 0.5);

  minutes = Math.round(minutes);
  if (minutes < 10) minutes = 10;
  if (minutes > 120) minutes = 120;
  return minutes;
}

export function ensureEstimatedDuration<T extends { durationMinutes: number | null; steps?: unknown; ingredients?: unknown }>(r: T): T {
  if ((r.durationMinutes == null || r.durationMinutes <= 0)) {
    const est = estimateDurationMinutes(r.steps, r.ingredients);
    r.durationMinutes = est > 0 ? est : null;
  }
  return r;
}
