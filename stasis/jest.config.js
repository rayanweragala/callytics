module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['**/*.unit.spec.ts', '**/*.test.ts'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  collectCoverageFrom: [
    'engine/edgeResolver.ts',
    'flowLoader.ts',
    'executors/menu.executor.ts',
    'nodes/hunt.executor.ts',
    'sipTrafficMonitor.ts',
    'executors/business_hours.executor.ts',
    'executors/voicemail.executor.ts',
    'executors/webhook.executor.ts',
    'executors/queue.executor.ts',
    'engine/queueManager.ts',
  ],
  coverageThreshold: {
    global: {
      lines: 70,
    },
  },
};
