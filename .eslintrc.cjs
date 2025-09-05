/* eslint-env node */
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  // ★ 用 vue-eslint-parser 解析 .vue，並轉交 TS 給 @typescript-eslint/parser
  parser: 'vue-eslint-parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    parser: '@typescript-eslint/parser'
  },
  extends: [
    'plugin:vue/vue3-recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:promise/recommended',
    'prettier'
  ],
  settings: { 'import/resolver': { typescript: true } },
  rules: {
    'vue/multi-word-component-names': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
    'import/no-unresolved': 'error',
    'import/order': [
      'warn',
      { 'newlines-between': 'newLine', groups: [['builtin','external','internal'], ['parent','sibling','index']] }
    ]
  },
  ignorePatterns: ['dist', 'node_modules', 'coverage', '.vitest']
};