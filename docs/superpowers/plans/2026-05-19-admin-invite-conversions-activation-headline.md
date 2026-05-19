# Admin Invite-Conversions Activation Headline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Invite-conversions one-line caption + always-open table with a big-number Joined / Active / Activated% headline and a collapsed-by-default detail disclosure.

**Architecture:** Pure presentational change in one React file. All metrics are derived client-side from the existing `data.invite_conversions` array already returned by `GET /admin/users/:id` — no API/worker/schema change. Deploy is admin-ui Pages only.

**Tech Stack:** React, MUI (`Collapse`, `Typography`, `Stack`, existing `Table`), Vite, Cloudflare Pages (`recifriend-admin`).

---

### Task 1: Activation headline + collapsible detail in Invite conversions section

**Files:**
- Modify: `apps/admin-ui/src/pages/UserDrilldown.jsx` — the `<Section title="Invite conversions">` block (currently lines ~97–134) and add a `useState` import (already imported) for the collapse toggle.
- Spec: `docs/superpowers/specs/2026-05-19-admin-invite-conversions-activation-headline-design.md`

No automated test (presentational, derived from existing endpoint data; `admin.test.ts` unaffected — endpoint unchanged). Verification is build + manual prod smoke.

- [ ] **Step 1: Add the collapse toggle state**

In `UserDrilldown`, alongside the other `useState` hooks (near line 31), add:

```jsx
  const [showInvitees, setShowInvitees] = useState(false);
```

- [ ] **Step 2: Replace the Invite conversions Section body**

Replace the entire current block:

```jsx
      <Section title="Invite conversions">
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {data.invite_link
            ? `Invite link active · ${data.invite_conversions.length} conversion${data.invite_conversions.length === 1 ? '' : 's'} · link created ${new Date(data.invite_link.created_at).toLocaleDateString()}`
            : 'No invite link generated'}
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Invitee</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Recipes</TableCell>
              <TableCell>Last seen</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.invite_conversions.map((iv, i) => (
              <TableRow key={iv.invitee_user_id || i}>
                <TableCell>
                  {iv.invitee_email || iv.invitee_name || '(email unavailable)'}
                  {iv.invitee_deleted_at && (
                    <Typography component="span" variant="caption" color="text.secondary"> · deleted</Typography>
                  )}
                </TableCell>
                <TableCell>
                  {iv.status === 'accepted_disconnected' ? (
                    <Typography component="span" variant="body2" color="text.secondary">accepted · disconnected</Typography>
                  ) : (
                    iv.status
                  )}
                </TableCell>
                <TableCell>{iv.invitee_recipe_count}</TableCell>
                <TableCell>{iv.last_sign_in_at ? new Date(iv.last_sign_in_at).toLocaleDateString() : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
```

with:

```jsx
      <Section title="Invite conversions">
        {(() => {
          const convs = data.invite_conversions;
          const THIRTY_D = 30 * 24 * 60 * 60 * 1000;
          const isActivated = (iv) =>
            iv.invitee_recipe_count >= 1 &&
            !iv.invitee_deleted_at &&
            !!iv.last_sign_in_at &&
            Date.now() - new Date(iv.last_sign_in_at).getTime() <= THIRTY_D;
          const joined = convs.length;
          const active = convs.filter(isActivated).length;
          const rate = joined ? `${Math.round((active / joined) * 100)}%` : '—';
          const Metric = ({ value, label }) => (
            <Stack alignItems="center" sx={{ minWidth: 72 }}>
              <Typography variant="h4">{value}</Typography>
              <Typography variant="caption" color="text.secondary">{label}</Typography>
            </Stack>
          );
          return (
            <>
              <Stack direction="row" spacing={4} sx={{ mb: 0.5 }}>
                <Metric value={joined} label="Joined" />
                <Metric value={active} label="Active" />
                <Metric value={rate} label="Activated" />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {data.invite_link
                  ? `via invite link · created ${new Date(data.invite_link.created_at).toLocaleDateString()}`
                  : 'No invite link generated'}
              </Typography>
              {joined === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  No one has joined via this link yet.
                </Typography>
              ) : (
                <>
                  <Box sx={{ mt: 1 }}>
                    <Button size="small" onClick={() => setShowInvitees((v) => !v)}>
                      {showInvitees ? `▾ Hide invitees` : `▸ View ${joined} invitee${joined === 1 ? '' : 's'}`}
                    </Button>
                  </Box>
                  <Collapse in={showInvitees} unmountOnExit>
                    <Table size="small" sx={{ mt: 1 }}>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ width: 28 }} />
                          <TableCell>Invitee</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell>Recipes</TableCell>
                          <TableCell>Last seen</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {convs.map((iv, i) => {
                          const act = isActivated(iv);
                          return (
                            <TableRow key={iv.invitee_user_id || i}>
                              <TableCell
                                title={act ? 'Active (≥1 recipe & signed in within 30d)' : 'Inactive'}
                                sx={{ color: act ? 'success.light' : 'text.disabled' }}
                              >
                                {act ? '●' : '○'}
                              </TableCell>
                              <TableCell>
                                {iv.invitee_email || iv.invitee_name || '(email unavailable)'}
                                {iv.invitee_deleted_at && (
                                  <Typography component="span" variant="caption" color="text.secondary"> · deleted</Typography>
                                )}
                              </TableCell>
                              <TableCell>
                                {iv.status === 'accepted_disconnected' ? (
                                  <Typography component="span" variant="body2" color="text.secondary">accepted · disconnected</Typography>
                                ) : (
                                  iv.status
                                )}
                              </TableCell>
                              <TableCell>{iv.invitee_recipe_count}</TableCell>
                              <TableCell>{iv.last_sign_in_at ? new Date(iv.last_sign_in_at).toLocaleDateString() : '—'}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </Collapse>
                </>
              )}
            </>
          );
        })()}
      </Section>
```

- [ ] **Step 3: Add `Collapse` to the MUI import**

In the `@mui/material` import (lines 2–7), add `Collapse` to the first import line. Result:

```jsx
  Box, Button, Chip, CircularProgress, Collapse, Divider, Paper, Stack, Typography,
```

(`Box`, `Button`, `Stack`, `Typography`, `Table*` are already imported — no other import changes.)

- [ ] **Step 4: Build to verify it compiles**

Run: `cd apps/admin-ui && npm run build`
Expected: `✓ built in …s`, no errors. (A chunk-size warning is pre-existing and acceptable.)

- [ ] **Step 5: Commit (spec + plan + implementation together)**

```bash
cd /Users/elisa/Desktop/VibeCode
git add docs/superpowers/specs/2026-05-19-admin-invite-conversions-activation-headline-design.md \
        docs/superpowers/plans/2026-05-19-admin-invite-conversions-activation-headline.md \
        apps/admin-ui/src/pages/UserDrilldown.jsx
git commit -m "feat(admin-ui): invite-conversions activation headline + collapsible invitee detail

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

(Commit only after explicit user go-ahead per repo workflow — the user has already approved a single combined commit for this work.)

- [ ] **Step 6: Deploy admin-ui (Pages only — scoped to apps/admin-ui)**

First confirm no unrelated staged worker/recipe-ui changes are involved (Pages deploy is dir-scoped to `apps/admin-ui`, but check anyway per deploy-working-tree rule):

Run: `git status --porcelain` — expect only intended/committed scope.

Then:
```bash
cd apps/admin-ui && npm run build && npx wrangler pages deploy dist --project-name recifriend-admin
```
Expected: `✨ Deployment complete!` with a `*.recifriend-admin.pages.dev` URL. Live at `admin.recifriend.com`.

- [ ] **Step 7: Manual prod smoke (closes Plan Task 25 for this section)**

On `https://admin.recifriend.com` → a user with multiple conversions:
- Headline shows Joined / Active / Activated% with correct arithmetic (Active counts only invitees with ≥1 recipe AND signed in ≤30d AND not deleted).
- Subline shows link-created date (or "No invite link generated").
- Toggle expands/collapses; per-row dot is green for activated, grey otherwise; tooltip on hover.
- A user with 0 conversions: shows "No one has joined via this link yet." and no toggle/table.

---

## Self-Review

**Spec coverage:** Activation definition (recipe≥1 + 30d + not deleted, null→inactive) → Step 2 `isActivated`. Headline Joined/Active/Activated% with `—` at 0 → Step 2 `Metric`s + `rate`. Subline + null-link copy → Step 2. Collapse default-closed + toggle labels + hide-at-0 → Step 2. Detail table unchanged columns + leading status dot consistent with Users table → Step 2 (uses same `●/○` glyph, `success.light`/`text.disabled`, same tooltip text as `Users.jsx:75–82`). Empty state → Step 2. No API/worker/schema change → confirmed, single file. Deploy scoping → Steps 6–7. All spec sections covered.

**Placeholder scan:** No TBD/TODO; all code blocks are complete and final.

**Type consistency:** `isActivated` defined once and reused for both the `active` count and per-row dot. `joined`/`active`/`rate` names consistent across headline and toggle. `showInvitees` state name consistent (Step 1 declare, Step 2 use). `Collapse` import added (Step 3) matches usage (Step 2).
