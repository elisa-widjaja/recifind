import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';

const theme = createTheme({
  palette: { mode: 'light' },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        // Always reserve space for the vertical scrollbar so expanding/collapsing
        // a section (which adds/removes the scrollbar) doesn't change the viewport
        // width and shift every section, table, and caret. overflow-y: scroll is
        // the broadly-supported way to keep the gutter; scrollbar-gutter is the
        // modern equivalent for browsers that support it.
        html: { overflowY: 'scroll', scrollbarGutter: 'stable' },
      },
    },
    // Dropdowns/menus/dialogs open as modals. By default MUI locks body scroll
    // and adds padding-right to compensate for the hidden scrollbar — but since
    // we always reserve the scrollbar gutter above, that compensation is
    // spurious and shifts every section/table when a Select opens. Disable it.
    MuiModal: {
      defaultProps: { disableScrollLock: true },
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
