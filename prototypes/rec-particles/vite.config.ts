import { defineConfig } from 'vite';
import path from 'node:path';

// Production is served by the main app at https://readage.xyz/lab/particles/
export default defineConfig({
  base: '/lab/particles/',
  build: {
    outDir: path.resolve(__dirname, '../../dist/lab/particles'),
    emptyOutDir: true,
  },
  server: {
    port: 5177,
    strictPort: true,
  },
});
