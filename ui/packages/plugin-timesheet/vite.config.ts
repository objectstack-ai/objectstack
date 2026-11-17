/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

import { createDtsExplicitExtensions } from '../../scripts/vite-dts-explicit-extensions.ts';
import { createDtsFailOnTypeErrors } from '../../scripts/vite-dts-fail-on-type-errors.ts';

// Vitest falls back to this file from this directory; refuse that entry point
// (route 4 in scripts/vitest-invocation-guard.mjs).
import {
  assertCanonicalVitestInvocation,
  repoRootFrom,
} from '../../scripts/vitest-invocation-guard.mjs';

if (process.env.VITEST) {
  assertCanonicalVitestInvocation({ repoRoot: repoRootFrom(import.meta.url) });
}

export default defineConfig({
  plugins: [
    react(),
    dts({
      insertTypesEntry: true,
      // Resolve `@object-ui/*` to published typings, not workspace sources (TS6059).
      compilerOptions: { rootDir: resolve(__dirname, 'src'), paths: {} },
      aliasesExclude: [/^@object-ui\//],
      include: ['src'],
      exclude: ['**/*.test.ts', '**/*.test.tsx', 'node_modules'],
      ...createDtsExplicitExtensions({ packageDir: __dirname }),
      ...createDtsFailOnTypeErrors({ packageDir: __dirname }),
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@object-ui/core': resolve(__dirname, '../core/src/index.ts'),
    },
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.tsx'),
      name: 'ObjectUIPluginTimesheet',
      fileName: 'index',
    },
    rollupOptions: {
      external: (id) => !/^[./]/.test(id) && !id.startsWith(__dirname),
      output: {
        inlineDynamicImports: true,
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          '@object-ui/components': 'ObjectUIComponents',
          '@object-ui/core': 'ObjectUICore',
          '@object-ui/i18n': 'ObjectUII18n',
          '@object-ui/react': 'ObjectUIReact',
          '@object-ui/types': 'ObjectUITypes',
          'lucide-react': 'LucideReact',
        },
      },
    },
  },
});
