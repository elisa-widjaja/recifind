#!/usr/bin/env node

const API_URL = 'http://127.0.0.1:54349';
const TOKEN = 'bd44b73893b5d07b8f29b7e3b4313a76ad4eb1f0dfefa397466a4596ea66e6e5';

async function main() {
  // Fetch all recipes
  console.log('Fetching recipes...');
  let allRecipes = [];
  let cursor = null;
  do {
    const url = new URL('/recipes', API_URL);
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetch(url, {
      headers: { Authorization: 'Bearer ' + TOKEN }
    });
    if (!res.ok) {
      throw new Error('Failed to fetch: ' + res.status);
    }
    const data = await res.json();
    allRecipes.push(...(data.recipes || []));
    cursor = data.cursor;
  } while (cursor);

  console.log('Found ' + allRecipes.length + ' recipes');

  // Find Loco moco
  const locoMoco = allRecipes.find(r => r.title && r.title.toLowerCase().includes('loco'));
  if (!locoMoco) {
    console.log('Loco moco not found!');
    return;
  }

  console.log('Found:', locoMoco.title);
  console.log('ID:', locoMoco.id);
  console.log('Current URL:', locoMoco.sourceUrl);

  // Update it
  const newUrl = 'https://www.instagram.com/reel/DE0Kb9_sBQz/?igsh=NjZiM2M3MzIxNA==';
  console.log('Updating to:', newUrl);

  const updateRes = await fetch(API_URL + '/recipes/' + locoMoco.id, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + TOKEN
    },
    body: JSON.stringify({ sourceUrl: newUrl })
  });

  if (!updateRes.ok) {
    const text = await updateRes.text();
    throw new Error('Failed to update: ' + updateRes.status + ' ' + text);
  }

  console.log('Updated successfully!');
}

main().catch(e => { console.error(e); process.exit(1); });
