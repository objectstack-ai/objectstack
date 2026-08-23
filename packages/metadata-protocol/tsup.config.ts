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
  // [#11235] `discovery-version.ts` reads its own `package.json` via
  // `createRequire(import.meta.url)` — correct as written for the ESM output,
  // but esbuild EMPTIES `import.meta` in a CJS bundle, so `import.meta.url`
  // would be `undefined` there and the read would fall through to the
  // `'unknown'` last resort on every `require('@objectstack/metadata-protocol')`
  // consumer. `shims: true` makes tsup rewrite `import.meta.url` in the CJS
  // build to a real `__filename`-derived value instead (its
  // `assets/cjs_shims.js`), so both formats resolve the SAME package.json.
  // Identical need, identical remedy, identical wording as
  // `packages/runtime/tsup.config.ts` carries for #10993's resolver.
  // Need-based injection — nothing here references `__dirname`/`__filename`,
  // so the ESM build's shim path is a no-op.
  shims: true,
  external: ['vitest'],
});
