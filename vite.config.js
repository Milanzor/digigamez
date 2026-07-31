import { defineConfig } from 'vite';

export default defineConfig({
  base: '/digigamez/',
  build: {
    target: 'es2020',
    sourcemap: false,
  },
});
