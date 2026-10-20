import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  resolve: { alias: { '@shared': path.resolve(import.meta.dirname, 'src/shared') } },
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    open: false,
    // Dev module requests originate from the opaque sandbox. This lab serves
    // only the UI directory, never repository config or credentials.
    cors: { origin: /^(null|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/ },
    fs: { strict: true, allow: [import.meta.dirname] },
  },
});
