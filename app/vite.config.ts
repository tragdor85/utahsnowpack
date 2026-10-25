import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
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
