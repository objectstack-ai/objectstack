// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'tsup';

import { dropSourcesContent } from '../../scripts/tsup-drop-sources-content.mjs';

export default defineConfig({
  // `core` is the lean engine entry (ADR-0076) — engine/registry/hooks/validation
  // only, no kernel plugin or @objectstack/metadata-protocol. `index` is the
  // batteries-included barrel.
  entry: ['src/index.ts', 'src/core.ts'],
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: !process.env.OS_SKIP_DTS,
  format: ['esm', 'cjs'],
  target: 'es2020',
  esbuildOptions: dropSourcesContent,
});
