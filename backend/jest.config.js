module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: '.*\.(unit|int)\.spec\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  collectCoverageFrom: [
    'src/flows/flows.service.ts',
    'src/audio/audio.service.ts',
    'src/trunks/trunks.service.ts',
    'src/extensions/extensions.service.ts',
    'src/inbound-routes/inbound-routes.service.ts',
    'src/recordings/recordings.service.ts',
    'src/diagnostics/diagnostics.service.ts',
  ],
  coverageDirectory: './coverage',
  coverageThreshold: {
    global: { lines: 70 },
  },
  projects: [
    {
      displayName: 'unit',
      rootDir: '.',
      testMatch: ['<rootDir>/src/**/*.unit.spec.ts'],
      preset: 'ts-jest',
      testEnvironment: 'node',
    },
    {
      displayName: 'integration',
      rootDir: '.',
      testMatch: ['<rootDir>/src/**/*.int.spec.ts'],
      preset: 'ts-jest',
      testEnvironment: 'node',
      globalSetup: '<rootDir>/test/globalSetup.ts',
      globalTeardown: '<rootDir>/test/globalTeardown.ts',
    },
  ],
};
