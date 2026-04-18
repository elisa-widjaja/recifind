import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.recifriend.app',
  appName: 'ReciFriend',
  webDir: '../recipe-ui/dist',
  ios: {
    scheme: 'recifriend',
  },
};

export default config;
