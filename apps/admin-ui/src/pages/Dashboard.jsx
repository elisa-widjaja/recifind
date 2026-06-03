import { Fragment, useEffect, useState } from 'react';
import {
  Box, Card, CardContent, CircularProgress, ClickAwayListener, Divider, Grid, IconButton, MenuItem, Select,
  Table, TableBody, TableCell, TableHead, TableRow, ToggleButton, ToggleButtonGroup,
  Tooltip as MuiTooltip, Typography,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import {
  LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, BarChart, Bar, Legend,
} from 'recharts';
import { fetchAdmin } from '../api';

const HELP = {
  totalUsers: 'Count of profiles with deleted_at IS NULL.',
  activeUsers: 'Approximation: distinct users with ≥1 recipe. A true "signed in within 30d" figure would require Supabase Auth data per user.',
  totalRecipes: 'Total rows in the recipes table (no soft-delete filter).',
  signupsPerDay: 'Daily count of new profiles (created_at), excluding soft-deleted accounts.',
  activationCurve: 'Per signup-week cohort, % of users in that cohort who have ever added ≥1 recipe. Cumulative-to-date (no time window), so recent weeks read lower until users have had time to save.',
  loopCompletion: 'Per signup-week cohort, % of users who have ever sent ≥1 friend invite. Uses "ever sent" (friend_requests_sent has no created_at), so it\'s a coarse proxy.',
  viralCoefWeekly: 'Weekly accepted friend pairs ÷ weekly signups. Accepts and signups aren\'t cohort-aligned — it\'s a coincident weekly ratio, not a true per-cohort K-factor. >1 means more friendships formed than new signups that week.',
  signupsWindow: 'New profiles created in the selected window (excludes soft-deleted accounts and the team accounts).',
  activated24h: 'Of the signups in the window, how many created at least one recipe within 24h of their own signup time. Note: people who signed up less than 24h ago are still inside their window, so this can keep rising.',
  newSaves: 'Recipes created in the window that are the first save of that recipe (a fresh import).',
  reSaves: 'Recipes created in the window that are a re-save: a user saving a recipe that already belongs to another user (same recipe id, different owner).',
  retentionCohorts: 'Each row is one signup day (last 30 days). "Came back" = how many of that day\'s signups created a recipe on a LATER calendar day.',
};

const RANGES = [
  { v: 30, label: '30 days' },
  { v: 90, label: '90 days' },
  { v: 365, label: 'All time' },
];

export default function Dashboard() {
  const [days, setDays] = useState(90);
  const [data, setData] = useState(null);
  const [growthWindow, setGrowthWindow] = useState('7d');

  useEffect(() => {
    setData(null);
    fetchAdmin(`/admin/metrics/timeseries?days=${days}`).then(setData);
  }, [days]);

  if (!data) return <CircularProgress />;

  const t = data.totals;
  const activePct = t.total_users > 0 ? Math.round(100 * t.active_users_approx / t.total_users) : 0;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ flex: 1 }}>Dashboard</Typography>
        <Select size="small" value={days} onChange={(e) => setDays(e.target.value)}>
          {RANGES.map((r) => <MenuItem key={r.v} value={r.v}>{r.label}</MenuItem>)}
        </Select>
      </Box>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Tile title="Total users" value={t.total_users} help={HELP.totalUsers} />
        <Tile title="Active users" value={<>{t.active_users_approx} <Pct value={activePct} /></>} help={HELP.activeUsers} />
        <Tile title="Total recipes" value={t.total_recipes} help={HELP.totalRecipes} />
      </Grid>

      {data.growth && (
        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <Typography variant="subtitle2" sx={{ flex: 1 }}>Growth & engagement</Typography>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={growthWindow}
                onChange={(e, v) => { if (v) setGrowthWindow(v); }}
              >
                <ToggleButton value="1d">1 day</ToggleButton>
                <ToggleButton value="7d">1 week</ToggleButton>
                <ToggleButton value="30d">1 month</ToggleButton>
              </ToggleButtonGroup>
            </Box>

            {data.growth.windows?.[growthWindow] && (() => {
              const w = data.growth.windows[growthWindow];
              return (
                <Grid container spacing={2}>
                  <ComboTile items={[
                    { label: 'Signups', value: w.signups, help: HELP.signupsWindow },
                    { label: 'Activated in 24h', value: <>{w.activated_24h} <Pct value={w.activated_pct} /></>, help: HELP.activated24h },
                  ]} />
                  <ComboTile items={[
                    { label: 'New saves', value: w.new_saves, help: HELP.newSaves },
                    { label: 'Re-saves', value: w.re_saves, help: HELP.reSaves },
                  ]} />
                </Grid>
              );
            })()}

            {(() => {
              // Fixed weekly view (last 4 weeks), independent of the tile toggle.
              const mmdd = (w) => (typeof w === 'string' ? w.slice(5) : w);
              const signupsData = (data.growth.weekly_signups_activation ?? []).map((d) => ({
                week: mmdd(d.week),
                'Activated in 24h': d.activated_24h,
                'Not activated yet': Math.max(0, d.signups - d.activated_24h),
              }));
              const savesData = (data.growth.weekly_saves ?? []).map((d) => ({
                week: mmdd(d.week),
                'New saves': d.new_saves,
                'Re-saves': d.re_saves,
              }));
              if (!signupsData.length && !savesData.length) return null;
              return (
                <Grid container spacing={2} sx={{ mt: 0.5 }}>
                  <Grid item xs={12} md={6}>
                    <Typography variant="caption" color="text.secondary">
                      Signups vs activated in 24h (weekly, last 4 weeks; bar = total signups)
                    </Typography>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={signupsData}>
                        <XAxis dataKey="week" />
                        <YAxis allowDecimals={false} />
                        <Tooltip />
                        <Legend iconType="circle" />
                        <Bar dataKey="Activated in 24h" stackId="signups" fill="#6200EA" background={{ fill: '#f0f0f0' }} />
                        <Bar dataKey="Not activated yet" stackId="signups" fill="#D1C4E9" />
                      </BarChart>
                    </ResponsiveContainer>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography variant="caption" color="text.secondary">
                      New saves vs re-saves (weekly, last 4 weeks; bar = total saves)
                    </Typography>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={savesData}>
                        <XAxis dataKey="week" />
                        <YAxis allowDecimals={false} />
                        <Tooltip />
                        <Legend iconType="circle" />
                        <Bar dataKey="New saves" stackId="saves" fill="#6200EA" background={{ fill: '#f0f0f0' }} />
                        <Bar dataKey="Re-saves" stackId="saves" fill="#00BCD4" />
                      </BarChart>
                    </ResponsiveContainer>
                  </Grid>
                </Grid>
              );
            })()}

            <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>
              Retention by signup day (last 30 days)
              <HelpIcon text={HELP.retentionCohorts} />
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Day</TableCell>
                  <TableCell align="right">Signed up</TableCell>
                  <TableCell align="right">Came back</TableCell>
                  <TableCell align="right">%</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(data.growth.retention_cohorts ?? []).map((c) => (
                  <TableRow key={c.day}>
                    <TableCell>{c.day}</TableCell>
                    <TableCell align="right">{c.cohort_size}</TableCell>
                    <TableCell align="right">{c.returned}</TableCell>
                    <TableCell align="right"><Box component="span" sx={{ fontSize: '0.5em' }}>{c.returned_pct}%</Box></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <ChartCard title="Signups per day" help={HELP.signupsPerDay}>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={data.signups_per_day}>
            <XAxis dataKey="day" />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="n" stroke="#6200EA" />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Activation curve (% with ≥1 recipe by signup week)" help={HELP.activationCurve}>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={data.activation_curve}>
            <XAxis dataKey="week" />
            <YAxis domain={[0, 100]} />
            <Tooltip />
            <Bar dataKey="pct" fill="#6200EA" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Viral loop completion (% who invited a friend)" help={HELP.loopCompletion}>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={data.loop_completion}>
            <XAxis dataKey="week" />
            <YAxis domain={[0, 100]} />
            <Tooltip />
            <Bar dataKey="pct" fill="#00BCD4" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Viral coefficient over time (weekly)" help={HELP.viralCoefWeekly} sx={{ mt: 2 }}>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data.viral_coef_weekly}>
            <XAxis dataKey="week" />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="viral_coef" stroke="#6200EA" />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </Box>
  );
}

function HelpIcon({ text }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <ClickAwayListener onClickAway={() => setOpen(false)}>
      <MuiTooltip
        title={text}
        arrow
        placement="top"
        open={open}
        disableFocusListener
        disableHoverListener
        disableTouchListener
        slotProps={{ tooltip: { sx: { fontSize: '0.85rem', maxWidth: 320 } } }}
      >
        <IconButton
          size="small"
          aria-label="More info"
          onClick={() => setOpen((v) => !v)}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          sx={{ ml: 0.25, p: 0.25, color: 'text.disabled', verticalAlign: 'middle' }}
        >
          <InfoOutlinedIcon fontSize="small" />
        </IconButton>
      </MuiTooltip>
    </ClickAwayListener>
  );
}

function Tile({ title, value, help }) {
  return (
    <Grid item xs={12} sm={4}>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="caption" color="text.secondary">
            {title}
            <HelpIcon text={help} />
          </Typography>
          <Typography variant="h4">{value}</Typography>
        </CardContent>
      </Card>
    </Grid>
  );
}

// A percentage rendered at half the surrounding font size.
function Pct({ value }) {
  return <Box component="span" sx={{ fontSize: '0.5em', color: 'text.secondary' }}>({value}%)</Box>;
}

// Two related metrics shown side by side in one outlined card, split by a divider.
function ComboTile({ items }) {
  return (
    <Grid item xs={12} sm={6}>
      <Card variant="outlined">
        <CardContent>
          <Box sx={{ display: 'flex', gap: 3, alignItems: 'stretch' }}>
            {items.map((it, i) => (
              <Fragment key={it.label}>
                {i > 0 && <Divider orientation="vertical" flexItem />}
                <Box sx={{ flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    {it.label}
                    <HelpIcon text={it.help} />
                  </Typography>
                  <Typography variant="h4">{it.value}</Typography>
                </Box>
              </Fragment>
            ))}
          </Box>
        </CardContent>
      </Card>
    </Grid>
  );
}

function ChartCard({ title, help, children, sx }) {
  return (
    <Card variant="outlined" sx={{ mb: 2, ...sx }}>
      <CardContent>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {title}
          <HelpIcon text={help} />
        </Typography>
        {children}
      </CardContent>
    </Card>
  );
}
