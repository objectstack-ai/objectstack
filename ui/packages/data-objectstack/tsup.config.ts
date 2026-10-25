/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: {
    compilerOptions: {
      // Override composite to false for DTS generation
      composite: false,
      // Don't follow references during DTS build
      skipLibCheck: true,
    },
  },
  clean: true,
  sourcemap: false,
  skipNodeModulesBundle: true,
  external: ['@object-ui/types', '@object-ui/core', '@objectstack/client'],
});
