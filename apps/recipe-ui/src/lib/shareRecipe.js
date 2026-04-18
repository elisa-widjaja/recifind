/** @typedef {import('../../../shared/contracts').ShareRecipeRequest} ShareRecipeRequest */
/** @typedef {import('../../../shared/contracts').ShareRecipeResponse} ShareRecipeResponse */
/** @typedef {import('../../../shared/contracts').ShareRecipeError} ShareRecipeError */

export async function shareRecipe({ apiBase, jwt, recipeId, recipientUserIds }) {
  const res = await fetch(`${apiBase}/recipes/${recipeId}/share`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ recipient_user_ids: recipientUserIds }),
  });
  const body = await res.json();
  if (res.ok) return { ok: true, value: body };
  return { ok: false, error: body };
}
