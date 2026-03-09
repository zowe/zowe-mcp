/*
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Copyright Contributors to the Zowe Project.
 *
 */
import vitest from '@vitest/eslint-plugin';
import headers from 'eslint-plugin-headers';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Global ignores (build artifacts, generated files, vendored code)
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/.vscode-test/**',
      '**/vscode.d.ts',
      'packages/zowe-mcp-vscode/server/**',
    ],
  },
  // Type-checked recommended + stylistic rules for all TypeScript files
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ['**/*.ts', '**/*.mts'],
    languageOptions: {
      parserOptions: {
        project: [
          'packages/zowe-mcp-common/tsconfig.eslint.json',
          'packages/zowe-mcp-server/tsconfig.eslint.json',
          'packages/zowe-mcp-vscode/tsconfig.eslint.json',
          'packages/zowe-mcp-evals/tsconfig.eslint.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      headers,
    },
    rules: {
      // Intentionally unused args/vars (e.g. _options, _suffix) allowed when prefixed with _
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // License header enforcement
      'headers/header-format': [
        'error',
        {
          source: 'string',
          content:
            'This program and the accompanying materials are made available under the terms of the\n' +
            'Eclipse Public License v2.0 which accompanies this distribution, and is available at\n' +
            'https://www.eclipse.org/legal/epl-v20.html\n' +
            '\n' +
            'SPDX-License-Identifier: EPL-2.0\n' +
            '\n' +
            'Copyright Contributors to the Zowe Project.\n',
          blockPrefix: '\n',
          blockSuffix: '\n ',
          linePrefix: ' * ',
          trailingNewlines: 2,
        },
      ],
    },
  },
  // Vitest rules for server test files (VS Code extension uses Mocha, not Vitest)
  {
    files: [
      'packages/zowe-mcp-server/__tests__/**/*.ts',
      'packages/zowe-mcp-server/**/*.test.ts',
      'packages/zowe-mcp-server/**/*.spec.ts',
    ],
    plugins: {
      vitest,
    },
    rules: {
      ...vitest.configs.recommended.rules,
      // Test files routinely access .mock on spied functions (typed as any by Vitest)
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      'vitest/no-conditional-expect': 'warn',
    },
  }
);
