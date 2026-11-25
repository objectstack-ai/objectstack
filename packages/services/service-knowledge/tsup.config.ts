// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig, type Options } from 'tsup';

import { dropSourcesContent } from '../../../scripts/tsup-drop-sources-content.mjs';

// The root config builds `src/index.ts` alone; this package also publishes the
// adapter contract test suite as `./testing` (ADR-0161 K8, rule 1). Same shape,
// and the same reasons, as `packages/services/service-cluster/tsup.config.ts`,
// whose comments carry the measured history:
//
// - `clean` is `false` in both halves: tsup builds an array config
//   concurrently, so a `clean` in one half races the other's writes. The
//   `build` script empties `dist/` once, before tsup starts.
// - The split is by FORMAT, never by ENTRY. `./testing` is ESM only (it imports
//   `vitest`, which is ESM only, and its export map has no `require`
//   condition), so only the CJS half drops it. Both entries stay together in
//   the ESM half because `src/testing.ts` imports `KnowledgeService` from the
//   runtime modules: one config, one shared chunk, one class identity for a
//   service reached through either entry.
// - `vitest` is external: the suite runs inside the consumer's own vitest.
const shared: Options = {
  splitting: true,
  sourcemap: true,
  clean: false,
  dts: !process.env.OS_SKIP_DTS,
  target: 'es2020',
  external: ['vitest'],
  esbuildOptions: dropSourcesContent,
};

export default defineConfig([
  { ...shared, entry: ['src/index.ts', 'src/testing.ts'], format: ['esm'] },
  { ...shared, entry: ['src/index.ts'], format: ['cjs'] },
]);
