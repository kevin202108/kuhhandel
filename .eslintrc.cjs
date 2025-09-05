/* eslint-env node */
module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    'vue/setup-compiler-macros': true, // 避免 defineProps/defineEmits 被視為未定義
  },
  parser: 'vue-eslint-parser',          // ← 先用 SFC 解析器
  parserOptions: {
    parser: '@typescript-eslint/parser',// ← 再把 <script lang="ts"> 交給 TS parser
    ecmaVersion: 'latest',
    sourceType: 'module',
    extraFileExtensions: ['.vue'],
  },
  extends: [
    'plugin:vue/vue3-recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:promise/recommended',
    'prettier', // 關閉與 Prettier 衝突規則
  ],
  settings: {
    // 讓 import/no-unresolved 能正確解析 .ts/.vue 與 tsconfig paths
    'import/resolver': {
      typescript: { project: true },
      node: { extensions: ['.js', '.jsx', '.ts', '.tsx', '.d.ts', '.vue'] },
    },
  },
  rules: {
    'vue/multi-word-component-names': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
    'import/no-unresolved': 'error',
    'import/order': [
      'warn',
      { 'newlines-between': 'always', groups: [['builtin','external','internal'], ['parent','sibling','index']] },
    ],
  },
  ignorePatterns: ['dist', 'node_modules', 'coverage', '.vitest'],
};
