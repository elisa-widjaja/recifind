import { useEffect, useState } from 'react';
import { Box, Button, Typography, CircularProgress } from '@mui/material';
import { supabase } from './supabaseClient';
import { fetchAdmin } from './api';
import SidebarNav from './components/SidebarNav';
import Dashboard from './pages/Dashboard';
import Users from './pages/Users';
import UserDrilldown from './pages/UserDrilldown';
import AuditLog from './pages/AuditLog';

export default function App() {
  const [session, setSession] = useState(null);
  const [check, setCheck] = useState({ status: 'idle', email: null, error: null });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    setCheck({ status: 'loading', email: null, error: null });
    fetchAdmin('/admin/me')
      .then((data) => setCheck({ status: 'ok', email: data.email, error: null }))
      .catch((err) => setCheck({ status: 'error', email: null, error: err.message }));
  }, [session]);

  const signIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
  };
  const signOut = async () => { await supabase.auth.signOut(); };

  if (!session) {
    return (
      <Box sx={{ p: 8, textAlign: 'center' }}>
        <Typography variant="h4" gutterBottom>ReciFriend Admin</Typography>
        <Button variant="contained" onClick={signIn}>Sign in with Google</Button>
      </Box>
    );
  }

  if (check.status === 'loading' || check.status === 'idle') {
    return <Box sx={{ p: 8, textAlign: 'center' }}><CircularProgress /></Box>;
  }

  if (check.status === 'error') {
    return (
      <Box sx={{ p: 8, textAlign: 'center' }}>
        <Typography variant="h5" color="error">Access denied</Typography>
        <Typography sx={{ mt: 2 }}>{check.error}</Typography>
        <Button sx={{ mt: 2 }} onClick={signOut}>Sign out</Button>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <SidebarNav signOut={signOut} email={check.email} />
      <Box sx={{ flex: 1, p: 4 }}>
        <Router />
      </Box>
    </Box>
  );
}

function Router() {
  const [hash, setHash] = useState(window.location.hash || '#/');
  useEffect(() => {
    const onHash = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (hash.startsWith('#/users/')) {
    const id = hash.slice('#/users/'.length);
    return <UserDrilldown id={id} />;
  }
  if (hash === '#/users') return <Users />;
  if (hash === '#/audit-log') return <AuditLog />;
  return <Dashboard />;
}
