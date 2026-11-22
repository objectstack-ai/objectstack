/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

/**
 * Second build pass: the ESM build, `dist/index.js` (the package root) and
 * `dist/core.js` (the `@object-ui/plugin-detail/core` subpath, see
 * `src/core.ts`).
 *
 * Both entries come from ONE pass with `preserveModules`, so a module both
 * reach is one file both import. The record-page caches the `/core` seeds
 * write (`queueClaim`, `recordFieldAccess`, `useRecordEditable`) are module
 * state the root's hooks read; two bundles would each carry their own copy,
 * and a seed written through `/core` would never reach the root. One file per
 * source module is also the published spelling the `sideEffects` array names
 * (`./dist/queueClaim.js` beside `./src/queueClaim.ts`).
 *
 * The typings and the UMD build come from the main pass (`vite.config.ts`),
 * which runs first. ⛔ `emptyOutDir: false`: this pass must not delete them.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    emptyOutDir: false,
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.tsx'),
        core: resolve(__dirname, 'src/core.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      // ⛔ Never inline the @object-ui/* runtime packages: every plugin shares
      // the one `ComponentRegistry` of `@object-ui/core` (see vite.config.ts).
      external: (id) => !/^[./]/.test(id) && !id.startsWith(__dirname),
      output: {
        preserveModules: true,
        preserveModulesRoot: resolve(__dirname, 'src'),
        entryFileNames: '[name].js',
      },
    },
  },
});
