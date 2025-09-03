// .eslintrc.cjs
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parser: 'vue-eslint-parser',                    // ← 由 vue-eslint-parser 讀 .vue
  parserOptions: {
    parser: '@typescript-eslint/parser',          // ← .vue 內的 <script lang="ts"> 交給 TS 解析
    ecmaVersion: 'latest',
    sourceType: 'module',
    extraFileExtensions: ['.vue']
  },
  extends: ['plugin:vue/vue3-recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    'vue/multi-word-component-names': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'error' // 依你的規範，禁止 any
  },
  ignorePatterns: ['dist', 'node_modules']
};
