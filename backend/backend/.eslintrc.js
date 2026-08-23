module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js', 'dist', 'node_modules'],
  rules: {
    // Nest constructors are frequently just DI wiring — noisy without this.
    '@typescript-eslint/no-empty-function': 'off',
    // Explicit return types on every method is more ceremony than value
    // at this project's size; TS inference is trusted here.
    '@typescript-eslint/explicit-function-return-type': 'off',
    // Standard convention: a leading underscore marks an argument as
    // intentionally unused (e.g. a MigrationInterface.down() that
    // deliberately doesn't implement rollback logic) without disabling
    // the check globally.
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
  overrides: [
    {
      // Jest mocks for TypeORM repositories/query builders (jest.fn(),
      // mockReturnThis() chains, etc.) don't have a convenient real type
      // to give them — fully typing each mock is ceremony that doesn't
      // catch real bugs, since the mock's shape is deliberately partial.
      // Scoped to spec files only; production code still can't use `any`.
      files: ['**/*.spec.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};
