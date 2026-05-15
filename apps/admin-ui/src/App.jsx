import { useEffect, useState } from 'react';
import { Box, Button, Typography, CircularProgress } from '@mui/material';
import { supabase } from './supabaseClient';
import { fetchAdmin } from './api';

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
    <Box sx={{ p: 4 }}>
      <Typography variant="h4">ReciFriend Admin</Typography>
      <Typography>Signed in as {check.email}</Typography>
      <Button sx={{ mt: 2 }} onClick={signOut}>Sign out</Button>
    </Box>
  );
}
