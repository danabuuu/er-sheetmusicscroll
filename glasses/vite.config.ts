import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    // Vite will start on the host/port you pass via CLI:
    //   vite -i 192.168.x.x -p 5173
    strictPort: true,
  },
  build: {
    outDir: 'dist',
  },
});
