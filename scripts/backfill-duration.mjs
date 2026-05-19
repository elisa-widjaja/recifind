// scripts/backfill-duration.mjs
// One-time backfill of duration_minutes for detailed recipes missing it.
// Dry-run by default; set APPLY=1 to write. Delete this file after the run.
import { execSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { estimateDurationMinutes } from '../apps/recipe-ui/src/utils/estimateDuration.js';

const SELECT = `SELECT id, steps, ingredients FROM recipes \
WHERE (duration_minutes IS NULL OR duration_minutes <= 0) \
AND ingredients IS NOT NULL AND ingredients != '[]' AND length(ingredients) > 4 \
AND steps IS NOT NULL AND steps != '[]' AND length(steps) > 4;`;

const raw = execSync(
  `npx wrangler d1 execute recipes-db --remote --json --command "${SELECT.replace(/"/g, '\\"')}"`,
  { cwd: 'apps/worker', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
);
const rows = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1))[0].results;

const updates = [];
for (const r of rows) {
  let steps = [];
  let ingredients = [];
  try { steps = JSON.parse(r.steps || '[]'); } catch {}
  try { ingredients = JSON.parse(r.ingredients || '[]'); } catch {}
  const est = estimateDurationMinutes(steps, ingredients);
  if (est > 0) updates.push({ id: r.id, est });
}

console.log(`Rows matched: ${rows.length}, will update: ${updates.length}`);
for (const u of updates) console.log(`${u.id} -> ${u.est} min`);

if (process.env.APPLY === '1' && updates.length) {
  const sql = updates
    .map((u) => `UPDATE recipes SET duration_minutes = ${u.est} WHERE id = '${u.id.replace(/'/g, "''")}';`)
    .join('\n');
  const file = 'scripts/.tmp-backfill.sql';
  writeFileSync(file, sql);
  execSync(`npx wrangler d1 execute recipes-db --remote --file ../../${file}`, {
    cwd: 'apps/worker', stdio: 'inherit',
  });
  rmSync(file);
  console.log('Applied.');
} else {
  console.log('Dry run only. Re-run with APPLY=1 to write.');
}
