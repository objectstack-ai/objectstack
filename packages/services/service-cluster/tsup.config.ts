// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig, type Options } from 'tsup';

// Everything both halves below share. Spelled once so the two cannot drift in
// anything except the two properties they exist to differ in: `entry`/`format`.
//
// [#13013] `clean` is NOT here, and is `false` in both halves — deliberately.
// tsup runs an array config through `Promise.all` (`tsup/dist/index.js`, the
// `Array.isArray(configData)` map), so the halves build CONCURRENTLY: a `clean`
// in either one races the other's writes and can delete output that has already
// landed, in either direction. The output folder is emptied once, before tsup
// starts, by the `build` script in package.json. That is also a STRONGER clean
// than tsup's own, which unshifts `!**/*.d.{ts,cts,mts}` and so PRESERVES stale
// declarations — including exactly the `dist/testing.d.cts` this split exists
// to stop emitting, which would otherwise survive every rebuild of an existing
// worktree.
const shared: Options = {
  splitting: true,
  sourcemap: true,
  clean: false,
  dts: !process.env.OS_SKIP_DTS,
  target: 'es2020',
  external: ['vitest'],
};

// [#13013] The split is by FORMAT, never by ENTRY.
//
// `./testing` lost its `require` condition in #13001, so `dist/testing.cjs`,
// its map and `dist/testing.d.cts` became unreachable through the manifest
// while `files: ["dist"]` kept packing them for npm. Only the CJS half needs
// to drop that entry.
//
// ⛔ Do NOT "simplify" this into one config per ENTRY. Both entries stay
// together in the ESM half so that anything they share stays a shared chunk
// rather than two copies with two module identities. Nothing is shared here
// today — `src/testing.ts` imports only `vitest` and type-only symbols, and
// the build emits no chunk at all — but that is a property of today's source,
// not of this config, and the sibling `packages/metadata-core` carries the
// measured version of what per-entry splitting costs when it stops holding.
export default defineConfig([
  { ...shared, entry: ['src/index.ts', 'src/testing.ts'], format: ['esm'] },
  { ...shared, entry: ['src/index.ts'], format: ['cjs'] },
]);
