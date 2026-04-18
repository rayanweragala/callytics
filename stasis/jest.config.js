module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['**/*.unit.spec.ts'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  collectCoverageFrom: [
    'engine/edgeResolver.ts',
    'flowLoader.ts',
    'executors/menu.executor.ts',
    'nodes/hunt.executor.ts',
    'src/sipTrafficMonitor.ts',
    'src/executors/business_hours.executor.ts',
    'src/executors/voicemail.executor.ts',
  ],
  coverageThreshold: {
    global: {
      lines: 70,
    },
  },
};
