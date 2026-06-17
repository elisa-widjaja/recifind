import { useEffect, useState } from 'react';
import {
  Box, Button, Chip, CircularProgress, Collapse, IconButton, Link, Snackbar, TextField, Typography,
  Table, TableHead, TableRow, TableCell, TableBody,
} from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import ConfirmModal from '../components/ConfirmModal';
import { fetchAdmin } from '../api';

const truncate = (s, n = 60) => {
  const t = s || '';
  return t.length > n ? t.slice(0, n) + '…' : t;
};

// Facebook reels are login-walled from the worker, so re-enrich can only recover
// their content from a pasted caption. The caption field is shown only for these.
const isFacebookUrl = (url) => /facebook\.com|fb\.watch/i.test(url || '');

const EMPTY = { groups: [], page: { returned: 0, has_more: false } };

// Shared column widths so the nested owners table lines up under the outer table.
// Both tables use tableLayout: 'fixed', so matching the first two widths makes
// Owner align under Title and Recipe ID align under Source.
const CARET_W = 36;
const COL1_W = 220; // Title (outer) / Owner (inner)

export default function Recipes() {
  const [search, setSearch] = useState('');
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState({}); // key -> bool
  const [toast, setToast] = useState('');
  const [confirm, setConfirm] = useState(null); // { recipeId, title }
  const [reEnrichTarget, setReEnrichTarget] = useState(null); // { recipeId, title }
  const [reEnrichCaption, setReEnrichCaption] = useState(''); // optional pasted caption (FB reels)
  const [reHostTarget, setReHostTarget] = useState(null); // { recipeId, title }

  const load = () => {
    const q = search.trim();
    if (!q) { setData(EMPTY); return; }
    setLoading(true);
    fetchAdmin(`/admin/recipes/search?q=${encodeURIComponent(q)}`)
      .then(setData)
      .catch((e) => setToast(`Search failed: ${e.message}`))
      .finally(() => setLoading(false));
  };

  // Debounced live search.
  useEffect(() => {
    const q = search.trim();
    if (!q) { setData(EMPTY); return; }
    setLoading(true);
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const post = (path, body) => fetchAdmin(path, { method: 'POST', body: JSON.stringify(body || {}) });
  const doHide = (rid) =>
    post(`/admin/recipes/${rid}/hide`).then(() => { setToast('Recipe hidden'); load(); })
      .catch((e) => setToast(`Hide failed: ${e.message}`));
  const doUnhide = (rid) =>
    post(`/admin/recipes/${rid}/unhide`).then(() => { setToast('Recipe unhidden'); load(); })
      .catch((e) => setToast(`Unhide failed: ${e.message}`));
  const doReEnrich = (rid, caption) =>
    post(`/admin/recipes/${rid}/re-enrich`, caption && caption.trim() ? { caption: caption.trim() } : undefined)
      .then((d) => {
        const r = d?.recipe || {};
        const ing = (r.ingredients || []).length;
        const steps = (r.steps || []).length;
        if (ing === 0 && steps === 0) {
          setToast('Source returned nothing — content unchanged');
        } else {
          setToast(`Re-enriched (${ing} ingredients, provenance: ${r.provenance || 'n/a'})`);
        }
        load();
      })
      .catch((e) => setToast(`Re-enrich failed: ${e.message}`));
  const doReHost = (rid) =>
    fetchAdmin('/admin/migrate-images', { method: 'POST', body: JSON.stringify({ recipeIds: [rid], dryRun: false }) })
      .then((d) => {
        const r = (d.results || [])[0];
        const st = r?.status;
        if (st === 'rehosted') setToast('Image re-hosted');
        else if (st === 'cleared') setToast(`Image cleared — ${r?.reason || 'source had no image'}`);
        else setToast(`Re-host failed — ${r?.reason || 'unknown'}`);
        load();
      })
      .catch((e) => setToast(`Re-host failed: ${e.message}`));

  const toggle = (key) => setExpanded((m) => ({ ...m, [key]: !m[key] }));

  const q = search.trim();
  return (
    <Box>
      <Typography variant="h4" gutterBottom>Recipes</Typography>
      <Box sx={{ display: 'flex', gap: 1, mb: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField
          size="small"
          placeholder="Search recipe title…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: 300 }}
          autoFocus
        />
        {loading && <CircularProgress size={20} />}
      </Box>

      {!q ? (
        <Typography variant="body2" color="text.secondary">
          Type a recipe title to search. Copies of the same recipe (saved by multiple users) are grouped together.
        </Typography>
      ) : data.groups.length === 0 && !loading ? (
        <Typography variant="body2" color="text.secondary">No recipes match “{q}”.</Typography>
      ) : (
        <>
          <Table size="small" sx={{ tableLayout: 'fixed' }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: CARET_W, px: 0 }} />
                <TableCell sx={{ width: COL1_W, pl: 0.5 }}>Title</TableCell>
                <TableCell>Source</TableCell>
                <TableCell align="right" sx={{ width: 72 }}>Owners</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.groups.map((g) => (
                <RecipeGroupRow
                  key={g.key}
                  g={g}
                  open={!!expanded[g.key]}
                  onToggle={() => toggle(g.key)}
                  onHide={(rid) => setConfirm({ recipeId: rid, title: g.title })}
                  onUnhide={doUnhide}
                  onReEnrich={(rid) => setReEnrichTarget({ recipeId: rid, title: g.title, sourceUrl: g.source_url })}
                  onReHost={(rid) => setReHostTarget({ recipeId: rid, title: g.title })}
                />
              ))}
            </TableBody>
          </Table>
          {data.page?.has_more && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
              Showing the first {data.groups.length} recipes — refine your search to narrow results.
            </Typography>
          )}
        </>
      )}

      <ConfirmModal
        open={!!confirm}
        title={`Hide recipe "${confirm?.title}"?`}
        body="This copy will be hidden from the public landing and friend feeds. The owner can still see it. Reversible by clearing recipes.hidden_at in D1."
        destructive
        confirmLabel="Hide"
        onConfirm={() => { doHide(confirm.recipeId); setConfirm(null); }}
        onClose={() => setConfirm(null)}
      />
      <ConfirmModal
        open={!!reEnrichTarget}
        title={`Re-enrich "${reEnrichTarget?.title}"?`}
        body="Re-runs enrichment on the source URL and replaces this recipe's ingredients and steps. If the source can't be parsed, the current content is kept."
        confirmLabel="Re-enrich"
        onConfirm={() => { doReEnrich(reEnrichTarget.recipeId, reEnrichCaption); setReEnrichTarget(null); setReEnrichCaption(''); }}
        onClose={() => { setReEnrichTarget(null); setReEnrichCaption(''); }}
      >
        {isFacebookUrl(reEnrichTarget?.sourceUrl) && (
          <TextField
            label="Caption (optional)"
            placeholder="Paste the full Facebook reel caption here. Facebook reels are login-walled from the server, so it can't fetch the caption itself; paste it and Gemini will extract the ingredients and steps."
            value={reEnrichCaption}
            onChange={(e) => setReEnrichCaption(e.target.value)}
            multiline
            minRows={3}
            maxRows={12}
            fullWidth
            sx={{ mb: 2 }}
          />
        )}
      </ConfirmModal>
      <ConfirmModal
        open={!!reHostTarget}
        title={`Re-host image for "${reHostTarget?.title}"?`}
        body="Re-fetches the image from the source URL and stores it on Supabase. If the source no longer has an image, the current image is cleared."
        confirmLabel="Re-host"
        onConfirm={() => { doReHost(reHostTarget.recipeId); setReHostTarget(null); }}
        onClose={() => setReHostTarget(null)}
      />
      <Snackbar open={!!toast} autoHideDuration={3000} message={toast} onClose={() => setToast('')} />
    </Box>
  );
}

function RecipeGroupRow({ g, open, onToggle, onHide, onUnhide, onReEnrich, onReHost }) {
  return (
    <>
      <TableRow
        hover
        sx={{ cursor: 'pointer', '& > td': { borderBottom: open ? 'unset' : undefined } }}
        onClick={onToggle}
      >
        <TableCell sx={{ width: CARET_W, px: 0 }}>
          <IconButton size="small" aria-label={open ? 'Collapse' : 'Expand'}>
            {open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
          </IconButton>
        </TableCell>
        <TableCell title={g.title} sx={{ width: COL1_W, pl: 0.5 }}>
          {truncate(g.title, 40)}
          {g.hidden_count > 0 && (
            <Chip
              size="small"
              color="warning"
              variant="outlined"
              label={g.hidden_count === g.owner_count ? 'hidden' : `${g.hidden_count} hidden`}
              sx={{ ml: 1 }}
            />
          )}
        </TableCell>
        <TableCell
          onClick={(e) => e.stopPropagation()}
          sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {g.source_url ? (
            <Link href={g.source_url} target="_blank" rel="noopener noreferrer">
              {truncate(g.source_url, 40)}
            </Link>
          ) : (
            <Typography variant="caption" color="text.secondary">user-created</Typography>
          )}
        </TableCell>
        <TableCell align="right" sx={{ width: 72 }}>{g.owner_count}</TableCell>
      </TableRow>
      <TableRow>
        <TableCell sx={{ p: 0, border: 0 }} colSpan={4}>
          <Collapse in={open} unmountOnExit>
            <Box sx={{ py: 0.5 }}>
              <Table size="small" sx={{ tableLayout: 'fixed' }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: CARET_W, px: 0 }} />
                    <TableCell sx={{ width: COL1_W, pl: 0.5 }}>Owner</TableCell>
                    <TableCell>Recipe ID</TableCell>
                    <TableCell>Saved</TableCell>
                    <TableCell>Visibility</TableCell>
                    <TableCell sx={{ width: 280 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {g.owners.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell sx={{ width: CARET_W, px: 0 }} />
                      <TableCell sx={{ width: COL1_W, pl: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <Link href={`#/users/${o.user_id}`}>
                          {o.display_name || o.email || o.user_id}
                        </Link>
                        {o.email && o.display_name && (
                          <Typography component="span" variant="caption" color="text.secondary"> · {o.email}</Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{o.id}</Typography>
                      </TableCell>
                      <TableCell>{new Date(o.created_at).toLocaleDateString()}</TableCell>
                      <TableCell>
                        {o.hidden_at ? (
                          <Chip size="small" color="warning" variant="outlined" label="hidden" />
                        ) : Number(o.shared_with_friends) === 1 ? (
                          <Chip size="small" variant="outlined" label="public" />
                        ) : (
                          <Chip size="small" variant="outlined" label="private" />
                        )}
                      </TableCell>
                      <TableCell align="right" sx={{ width: 280 }}>
                        <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          <Button
                            size="small"
                            sx={{ whiteSpace: 'nowrap', minWidth: 'auto' }}
                            disabled={o.image_status !== 'stale'}
                            title={o.image_status === 'stale' ? 'Re-host this image onto Supabase' : `Image is ${o.image_status || 'none'} — nothing to re-host`}
                            onClick={() => onReHost(o.id)}
                          >Re-host</Button>
                          <Button size="small" sx={{ whiteSpace: 'nowrap', minWidth: 'auto' }} onClick={() => onReEnrich(o.id)}>Re-enrich</Button>
                          {o.hidden_at ? (
                            <Button size="small" sx={{ minWidth: 'auto' }} onClick={() => onUnhide(o.id)}>Unhide</Button>
                          ) : (
                            <Button size="small" sx={{ minWidth: 'auto' }} onClick={() => onHide(o.id)}>Hide</Button>
                          )}
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}
