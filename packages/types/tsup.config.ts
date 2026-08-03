// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'tsup';

/**
 * Two entries, deliberately. `src/index.ts` is the edge/browser-safe root that
 * `@objectstack/hono` (Cloudflare Workers, Deno, Bun) and the Worker-bootable
 * plugin layer consume; `src/node.ts` is the node-only slice
 * (`node:module` / `node:url`) behind the `./node` subpath export.
 *
 * `splitting: false` is what makes the isolation real rather than nominal: each
 * entry is emitted as a self-contained bundle, so nothing the root pulls in can
 * drag a `node:` builtin along through a shared chunk. `node-isolation.test.ts`
 * pins the source-level half of the same invariant.
 *
 * (Identical shape to `packages/metadata/tsup.config.ts`, which already ships a
 * `./node` subpath this way. The only reason this file exists at all — rather
 * than the shared `../../tsup.config.ts` — is the second entry.)
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/node.ts'],
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: !process.env.OS_SKIP_DTS,
  format: ['esm', 'cjs'],
  target: 'es2020',
});
