import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the browser talks to /api on the Vite server, which forwards to the API.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
