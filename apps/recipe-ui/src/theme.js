import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    primary: {
      main: '#5D5FEF'
    },
    secondary: {
      main: '#FF9F1C'
    },
    background: {
      default: '#F5F5F8',
      paper: '#FFFFFF'
    }
  },
  shape: {
    borderRadius: 8
  },
  typography: {
    fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
    h6: {
      fontWeight: 600
    },
    subtitle2: {
      textTransform: 'uppercase',
      letterSpacing: 0.6
    }
  },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          borderBottom: '1px solid rgba(0,0,0,0.08)'
        }
      }
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 8
        }
      }
    }
  }
});

export default theme;
