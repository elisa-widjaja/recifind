const API_BASE = 'http://localhost:8787';

export async function deleteRecipeByTitle(userToken: string, title: string): Promise<void> {
  const listRes = await fetch(`${API_BASE}/recipes`, {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  if (!listRes.ok) return;
  const data = await listRes.json() as { recipes: Array<{ id: string; title: string }> };
  const matches = data.recipes.filter(r => r.title.startsWith('[TEST]') && r.title.includes(title));
  for (const recipe of matches) {
    await fetch(`${API_BASE}/recipes/${recipe.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${userToken}` },
    });
  }
}

export async function deleteRecipeById(token: string, id: string): Promise<void> {
  await fetch(`${API_BASE}/recipes/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function removeFriend(token: string, friendId: string): Promise<void> {
  await fetch(`${API_BASE}/friends/${encodeURIComponent(friendId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getAuthToken(storageStatePath: string): Promise<string> {
  const fs = await import('fs');
  const state = JSON.parse(fs.readFileSync(storageStatePath, 'utf-8'));
  const localStorageEntries = state.origins?.[0]?.localStorage ?? [];
  const authEntry = localStorageEntries.find((e: { name: string }) => e.name === 'recifind-auth');
  if (!authEntry) throw new Error('No auth token found in storageState');
  const session = JSON.parse(authEntry.value);
  return session?.currentSession?.access_token ?? session?.access_token ?? '';
}
