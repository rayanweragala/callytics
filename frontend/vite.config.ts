import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    {
      name: 'mock-css-modules',
      transform(code, id) {
        if (id.endsWith('.module.css')) {
          return {
            code: 'export default new Proxy({}, { get: (target, prop) => prop });',
            map: null,
          };
        }
      },
      enforce: 'pre',
    },
    react(),
  ],
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      // Coverage measured only on lib/ and utils/ — the pure logic layer.
      // Pages and components require browser E2E (deferred to a later phase).
      // Matches the scoping pattern used in stasis/jest.config.js and backend/jest.config.js.
      include: ['src/lib/**/*.ts', 'src/utils/**/*.ts'],
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 70,
        branches: 60,
        functions: 70,
        statements: 70,
      },
    }
  }
});
