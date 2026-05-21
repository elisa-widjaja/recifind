import { useEffect, useState } from 'react';
import {
  Box, Card, CardContent, CircularProgress, Grid, MenuItem, Select, Tooltip as MuiTooltip, Typography,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import {
  LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, BarChart, Bar,
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
};

const RANGES = [
  { v: 30, label: '30 days' },
  { v: 90, label: '90 days' },
  { v: 365, label: 'All time' },
];

export default function Dashboard() {
  const [days, setDays] = useState(90);
  const [data, setData] = useState(null);

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
        <Tile title="Active users" value={`${t.active_users_approx} (${activePct}%)`} help={HELP.activeUsers} />
        <Tile title="Total recipes" value={t.total_recipes} help={HELP.totalRecipes} />
      </Grid>

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
  if (!text) return null;
  return (
    <MuiTooltip title={text} arrow placement="top">
      <InfoOutlinedIcon
        fontSize="inherit"
        sx={{ ml: 0.5, color: 'text.secondary', verticalAlign: 'middle', cursor: 'help' }}
      />
    </MuiTooltip>
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
