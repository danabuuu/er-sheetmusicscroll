import { defineConfig } from 'vite';

// When built in CI (GitHub Actions) the app is served from a subpath on GitHub Pages.
const base = process.env.CI ? '/er-sheetmusicscroll/' : '/';

export default defineConfig({
  root: '.',
  base,
  server: {
    host: '0.0.0.0',  // listen on all interfaces so the simulator can reach it
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
  },
});
