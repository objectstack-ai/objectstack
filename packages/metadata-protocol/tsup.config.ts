// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  splitting: true,
  sourcemap: true,
  clean: true,
  dts: !process.env.OS_SKIP_DTS,
  format: ['esm', 'cjs'],
  target: 'es2020',
  // [#11235] LOAD-BEARING, and measured rather than assumed. `discovery-
  // version.ts` reads its own `package.json` via
  // `createRequire(import.meta.url)` — correct as written for the ESM output.
  // `shims: true` makes tsup rewrite `import.meta.url` in the CJS build to a
  // real `__filename`-derived value (its `assets/cjs_shims.js`), so both
  // formats resolve the SAME package.json; `packages/runtime/tsup.config.ts`
  // carries it for #10993's resolver, the sibling of this one.
  //
  // What removing it does HERE was measured on this package, and it is worse
  // than the degradation the sibling's comment anticipates: at this `target`
  // esbuild does not empty `import.meta` in the CJS output, it emits
  // `createRequire(import.meta.url)` verbatim — so `dist/index.cjs` throws
  // `SyntaxError: Cannot use 'import.meta' outside a module` at LOAD time and
  // `require('@objectstack/metadata-protocol')` fails outright. Not a version
  // that degrades to `'unknown'`; a package a CJS consumer cannot import at
  // all. Do not drop this line while `discovery-version.ts` exists.
  //
  // Need-based injection — nothing else here references
  // `__dirname`/`__filename`, so the ESM build's shim path is a no-op.
  shims: true,
  external: ['vitest'],
});
