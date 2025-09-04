/* eslint-env node */
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', extraFileExtensions: ['.vue'] },
  extends: [
    'plugin:vue/vue3-recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:promise/recommended',
    'prettier' // 關閉與 Prettier 衝突規則
  ],
  settings: { 'import/resolver': { typescript: true } },
  rules: {
    'vue/multi-word-component-names': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
    'import/no-unresolved': 'error',
    'import/order': ['warn', { 'newlines-between': 'always', groups: [['builtin','external','internal'], ['parent','sibling','index']] }]
  },
  ignorePatterns: ['dist', 'node_modules', 'coverage', '.vitest']
};
