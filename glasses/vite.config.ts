import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    host: '0.0.0.0',  // listen on all interfaces so the simulator can reach it
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
  },
});
