module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  moduleNameMapper: {
    '^better-auth/node$': '<rootDir>/tests/mocks/better-auth-node.ts',
  },
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '/.base/'],
  modulePathIgnorePatterns: ['<rootDir>/.base'],
  collectCoverageFrom: ['src/**/*.ts'],
};
