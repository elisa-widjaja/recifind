import { useEffect, useState } from 'react';
import {
  Box, Card, CardContent, CircularProgress, Grid, MenuItem, Select, Typography,
} from '@mui/material';
import {
  LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, BarChart, Bar,
} from 'recharts';
import { fetchAdmin } from '../api';

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
        <Tile title="Total users" value={t.total_users} />
        <Tile title="Active users" value={`${t.active_users_approx} (${activePct}%)`} />
        <Tile title="Viral coefficient" value={t.latest_viral_coef?.viral_coef?.toFixed(2) ?? '—'} />
        <Tile title="Total recipes" value={t.total_recipes} />
      </Grid>

      <ChartCard title="Signups per day">
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={data.signups_per_day}>
            <XAxis dataKey="day" />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="n" stroke="#6200EA" />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <Grid container spacing={2}>
        <Grid item xs={6}>
          <ChartCard title="Activation curve (% with ≥1 recipe by signup week)">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.activation_curve}>
                <XAxis dataKey="week" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Bar dataKey="pct" fill="#6200EA" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
        <Grid item xs={6}>
          <ChartCard title="Viral loop completion (% who invited a friend)">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.loop_completion}>
                <XAxis dataKey="week" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Bar dataKey="pct" fill="#00BCD4" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
      </Grid>

      <ChartCard title="Viral coefficient over time (weekly)" sx={{ mt: 2 }}>
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

function Tile({ title, value }) {
  return (
    <Grid item xs={3}>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="caption" color="text.secondary">{title}</Typography>
          <Typography variant="h4">{value}</Typography>
        </CardContent>
      </Card>
    </Grid>
  );
}

function ChartCard({ title, children, sx }) {
  return (
    <Card variant="outlined" sx={{ mb: 2, ...sx }}>
      <CardContent>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>{title}</Typography>
        {children}
      </CardContent>
    </Card>
  );
}
