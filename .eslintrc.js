module.exports = {
  env: {
    commonjs: true,
    es2021: true,
    node: true,
  },
  extends: [
    'airbnb-base',
  ],
  parserOptions: {
    ecmaVersion: 12,
  },
  rules: {
    'no-await-in-loop': 'off',
    'no-console': 'off',
    'no-restricted-syntax': 'off',
  },
};
