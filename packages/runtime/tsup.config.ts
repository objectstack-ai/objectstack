// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: !process.env.OS_SKIP_DTS,
  format: ['esm', 'cjs'],
  target: 'es2020',
  // [#10993] `runtime-version.ts` reads its own `package.json` via
  // `createRequire(import.meta.url)` — correct as written for the ESM
  // output, but esbuild EMPTIES `import.meta` in a CJS bundle (measured:
  // `packages/lint`'s own dist already warns `[empty-import-meta]` on the
  // dependency that does this without the shim). `shims: true` makes tsup
  // rewrite `import.meta.url` in the CJS build to a real `__filename`-derived
  // value instead (its `assets/cjs_shims.js`), so `require('@objectstack/
  // runtime')` resolves the SAME package.json `dist/index.js` does. Need-based
  // injection — nothing here references `__dirname`/`__filename`, so the ESM
  // build's shim path is a no-op.
  shims: true,
  // Mark driver packages as external so they are resolved at runtime, not bundled
  external: [
    '@objectstack/driver-memory',
    '@objectstack/driver-sql',
    '@objectstack/driver-sqlite-wasm',
    '@objectstack/driver-mongodb',
    // OPTIONAL install, loaded through `turso-driver-factory.ts`'s lazy
    // `import()` (#5820). External so esbuild never tries to resolve/bundle a
    // package that is deliberately not a dependency of this one.
    '@objectstack/driver-turso',
    '@objectstack/metadata',
    '@objectstack/objectql',
  ],
});
