import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

const mockCssModulesPlugin: Plugin = {
  name: 'mock-css-modules',
  transform(_code: string, id: string) {
    if (id.endsWith('.module.css')) {
      return {
        code: 'export default new Proxy({}, { get: (target, prop) => prop });',
        map: null,
      };
    }
    return undefined;
  },
  enforce: 'pre',
};

export default defineConfig({
  plugins: [
    ...(process.env.VITEST ? [mockCssModulesPlugin] : []),
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
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.npm_package_version ?? 'dev'),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8' as const,
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
