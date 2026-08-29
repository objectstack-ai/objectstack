// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

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
  // [#12971] LOAD-BEARING. `artifact-forward-conversion.ts` anchors its
  // `@objectstack/spec` version lookup with `createRequire(import.meta.url)`
  // — correct as written for the ESM output. At this `target` esbuild does
  // NOT empty `import.meta` in the CJS output: it emits
  // `createRequire(import.meta.url)` verbatim, and `import.meta` outside an
  // ES module is a PARSE-time error — so without this line `dist/index.cjs`
  // throws `SyntaxError: Cannot use 'import.meta' outside a module` at LOAD
  // time and the package's whole `require` condition is unloadable, for every
  // consumer and every code path (the guarding try/catch never runs; the
  // module never begins executing). Measured downstream: cloud's walled EE
  // runtime refused to boot because `@objectstack/organizations` resolves
  // through this condition. `shims: true` makes tsup rewrite
  // `import.meta.url` in the CJS build to a real `__filename`-derived value
  // (its `assets/cjs_shims.js`), so BOTH formats anchor on this module's own
  // file and resolve the SAME `@objectstack/spec/package.json`.
  //
  // Same line, same reason, same measurement as
  // `packages/metadata-protocol/tsup.config.ts` (#11235) and
  // `packages/runtime/tsup.config.ts` (#10993) — read either for the sibling
  // history. `pnpm check:dual-build-cjs-loads` holds the class: it
  // `require()`s every dual-built package's CJS entry point and reds on this
  // exact SyntaxError. Need-based injection — nothing here references
  // `__dirname`/`__filename`, so the ESM build's shim path is a no-op, which
  // is why it stays on BOTH halves rather than only the CJS one: identical
  // options mean the ESM output is byte-for-byte what the single config
  // emitted before the split.
  shims: true,
  external: ['vitest'],
};

// [#13013] The split is by FORMAT, never by ENTRY — that distinction is the
// whole design and reversing it is a silent breaking change.
//
// `./testing` lost its `require` condition in #13001, so `dist/testing.cjs`,
// its map and `dist/testing.d.cts` became unreachable through the manifest
// while `files: ["dist"]` kept packing them for npm. Only the CJS half needs
// to drop that entry.
//
// ⛔ Do NOT "simplify" this into one config per ENTRY. Both entries stay
// together in the ESM half because they SHARE A CHUNK
// (`src/errors.ts` + `src/canonicalize.ts`), and that chunk carries the error
// CLASSES. One config per entry gives `testing.js` its own copy of them, so
// `ConflictError` reached through `@objectstack/metadata-core/testing` stops
// being the class thrown by `@objectstack/metadata-core` — and the contract
// suite this entry point exists to publish asserts exactly that identity
// (`src/contract-suite.ts`: `.rejects.toBeInstanceOf(ConflictError)`). Every
// downstream driver package running the suite would fail on a change that
// looks like a build-config tidy-up.
//
// The CJS half needs no such care: `.` is its only entry point, so there is
// exactly one copy of those modules in the CJS output either way (with one
// entry esbuild inlines what used to be a shared chunk).
export default defineConfig([
  { ...shared, entry: ['src/index.ts', 'src/testing.ts'], format: ['esm'] },
  { ...shared, entry: ['src/index.ts'], format: ['cjs'] },
]);
