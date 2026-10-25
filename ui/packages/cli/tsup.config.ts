/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    index: 'src/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  shims: false,
  // The parent repo's `check:sourcemap-no-sources-content` refuses a published
  // map that embeds the original source text (#16469). Its shared
  // `scripts/tsup-drop-sources-content.mjs` hook is spelled inline here rather
  // than imported, so this build reads nothing outside the ui/ workspace and
  // the ui turbo-build-inputs guard needs no `$TURBO_ROOT$/../` entry.
  esbuildOptions(options) {
    options.sourcesContent = false;
  },
});
