// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'tsup';

import { dropSourcesContent } from '../../../scripts/tsup-drop-sources-content.mjs';

// The root config builds `src/index.ts` alone; this package also publishes the
// in-process IMAP server double as `./testing`. `src/testing.ts` imports
// nothing from the other modules (it is an independent implementation of the
// server side, by design), so the two entries share no code and need no shared
// chunk: one config, both formats, both entries.
export default defineConfig({
  entry: ['src/index.ts', 'src/testing.ts'],
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: !process.env.OS_SKIP_DTS,
  format: ['esm', 'cjs'],
  target: 'es2020',
  esbuildOptions: dropSourcesContent,
});
