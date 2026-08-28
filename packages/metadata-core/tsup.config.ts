// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/testing.ts'],
  splitting: true,
  sourcemap: true,
  clean: true,
  dts: !process.env.OS_SKIP_DTS,
  format: ['esm', 'cjs'],
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
  // `__dirname`/`__filename`, so the ESM build's shim path is a no-op.
  shims: true,
  external: ['vitest'],
});
