import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // host: true binds all interfaces so the phone can reach the dev server
  // over the hotspot. Without it Vite listens on localhost only.
  server: { host: true, port: 5173 },
});
