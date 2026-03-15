const API_BASE = process.env.API_BASE || 'http://localhost:8787';

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

function readSession(storageStatePath: string): Record<string, any> {
  const fs = require('fs');
  const state = JSON.parse(fs.readFileSync(storageStatePath, 'utf-8'));
  const localStorageEntries = state.origins?.[0]?.localStorage ?? [];
  const authEntry = localStorageEntries.find((e: { name: string }) => e.name === 'recifind-auth');
  if (!authEntry) throw new Error('No auth token found in storageState');
  return JSON.parse(authEntry.value);
}

export async function getAuthToken(storageStatePath: string): Promise<string> {
  const session = readSession(storageStatePath);
  return session?.currentSession?.access_token ?? session?.access_token ?? '';
}

export async function getUserId(storageStatePath: string): Promise<string> {
  const session = readSession(storageStatePath);
  return session?.currentSession?.user?.id ?? session?.user?.id ?? '';
}

export async function getEmail(storageStatePath: string): Promise<string> {
  const session = readSession(storageStatePath);
  const user = session?.currentSession?.user ?? session?.user;
  return user?.email ?? '';
}

// D1 profile displayName is email.split('@')[0] — not the Supabase user_metadata full_name
export async function getDisplayName(storageStatePath: string): Promise<string> {
  const email = await getEmail(storageStatePath);
  return email.split('@')[0];
}

export async function acceptFriendRequest(requesterUserId: string, acceptorToken: string): Promise<void> {
  const res = await fetch(`${API_BASE}/friends/requests/${encodeURIComponent(requesterUserId)}/accept`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${acceptorToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to accept friend request: ${res.status} ${body}`);
  }
}

export async function sendFriendRequest(senderToken: string, toEmail: string): Promise<void> {
  const res = await fetch(`${API_BASE}/friends/request`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${senderToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: toEmail }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to send friend request: ${res.status} ${body}`);
  }
}
