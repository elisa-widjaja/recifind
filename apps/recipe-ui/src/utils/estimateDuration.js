// Pure, deterministic cook-time estimate. MUST stay equivalent to
// apps/worker/src/estimateDuration.ts — both pinned by
// test-fixtures/duration-vectors.json so they cannot silently drift.

export function estimateDurationMinutes(steps, ingredients) {
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
  const verbBonuses = [
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
