import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The GitHub Pages deploy (docs/PLAN.md task 11) serves the site under
// /utahsnowpack/ and sets VITE_BASE for the production build; local dev,
// preview, and e2e stay at the root.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    // e2e/ is Playwright's domain (pnpm test:e2e); keep vitest on unit tests.
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
