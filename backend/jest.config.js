module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: '.*\.(unit|int)\.spec\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: './coverage',
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
