import { defineConfig } from 'vite';

export default defineConfig({
  base: '/digigamez/',
  build: {
    // The target digiboard runs a Chromium in the 64-78 range (its user agent
    // is spoofed to "Chrome 22 / Windows 7", but navigator.platform reports
    // Linux aarch64 and the feature fingerprint places it there). That
    // predates optional chaining and nullish coalescing (both Chrome 80), so
    // esbuild has to lower them instead of passing them through.
    target: 'chrome64',
    sourcemap: false,
  },
});
