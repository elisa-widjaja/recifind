#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT_DIR = resolve(__dirname, '..');
const ENV_FILE = resolve(ROOT_DIR, 'apps', 'recipe-ui', '.env.local');
const WORKER_DIR = resolve(ROOT_DIR, 'apps', 'worker');
const KV_NAMESPACE_ID = '15fc7eefa6e2484981be9ac59962e6a9';

async function loadEnv() {
  const env = { ...process.env };
  try {
    const raw = await readFile(ENV_FILE, 'utf8');
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .forEach((line) => {
        const [key, ...rest] = line.split('=');
        if (!key || rest.length === 0) return;
        const value = rest.join('=').trim().replace(/^"|"$/g, '');
        env[key.trim()] = value;
      });
  } catch (error) {
    // Ignore
  }
  return env;
}

async function getSupabaseUserByEmail(supabaseUrl, serviceRoleKey, email) {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    headers: {
      'Authorization': `Bearer ${serviceRoleKey}`,
      'apikey': serviceRoleKey
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch users: ${response.status}`);
  }

  const data = await response.json();
  const user = data.users?.find(u => u.email === email);
  return user;
}

function countUserRecipes(userId) {
  const prefix = `recipe:${userId}:`;
  let count = 0;
  let cursor = '';

  do {
    const cursorArg = cursor ? `--cursor="${cursor}"` : '';
    const result = execSync(
      `npx wrangler kv key list --namespace-id=${KV_NAMESPACE_ID} --prefix="${prefix}" ${cursorArg} --remote`,
      { cwd: WORKER_DIR, encoding: 'utf8' }
    );

    const keys = JSON.parse(result);
    count += keys.length;

    // Check if there's a cursor for pagination (wrangler doesn't expose this directly)
    // If we got 1000 keys, there might be more
    if (keys.length < 1000) {
      break;
    }
    // For simplicity, assume less than 1000 recipes per user
    break;
  } while (true);

  return count;
}

async function main() {
  const targetEmail = process.argv[2];
  if (!targetEmail) {
    console.error('Usage: node initUserMetadata.js <target-email>');
    process.exit(1);
  }

  const env = await loadEnv();
  const supabaseUrl = env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    console.error('SUPABASE_SERVICE_ROLE_KEY environment variable not set');
    process.exit(1);
  }

  // Get target user ID from Supabase
  console.log(`Looking up user: ${targetEmail}`);
  const user = await getSupabaseUserByEmail(supabaseUrl, serviceRoleKey, targetEmail);

  if (!user) {
    console.error(`User not found: ${targetEmail}`);
    process.exit(1);
  }

  const userId = user.id;
  console.log(`Found user ID: ${userId}`);

  // Count recipes
  console.log('Counting recipes...');
  const count = countUserRecipes(userId);
  console.log(`Found ${count} recipes`);

  // Create metadata
  const metaKey = `meta:${userId}`;
  const metadata = {
    count,
    updatedAt: new Date().toISOString(),
    version: 1
  };

  const tmpFile = `/tmp/meta-${userId}.json`;
  await import('node:fs/promises').then(fs => fs.writeFile(tmpFile, JSON.stringify(metadata)));

  execSync(
    `npx wrangler kv key put --namespace-id=${KV_NAMESPACE_ID} "${metaKey}" --path="${tmpFile}" --remote`,
    { cwd: WORKER_DIR, stdio: 'inherit' }
  );

  console.log(`\nMetadata initialized for ${targetEmail}:`);
  console.log(JSON.stringify(metadata, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
