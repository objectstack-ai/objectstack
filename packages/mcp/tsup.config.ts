// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'tsup';

import { dropSourcesContent } from '../../scripts/tsup-drop-sources-content.mjs';

export default defineConfig({
  entry: ['src/index.ts'],
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: !process.env.OS_SKIP_DTS,
  format: ['esm', 'cjs'],
  target: 'es2020',
  // LOAD-BEARING, and measured rather than assumed. `package-version.ts` reads
  // this package's own `package.json` via `createRequire(import.meta.url)` —
  // correct as written for the ESM output. The shared `tsup.config.ts` this
  // package built with before has no `shims`, and there esbuild EMPTIES
  // `import.meta` in the CJS bundle (`var import_meta = {}`), so
  // `createRequire(undefined)` throws, the resolver's `catch` swallows it, and
  // `require('@objectstack/mcp')` answers `serverInfo.version` `'unknown'`
  // while the ESM build answers the manifest version: the two formats disagree
  // and nothing fails at load. `shims: true` makes tsup rewrite `import.meta.url`
  // in the CJS build to a real `__filename`-derived value (its
  // `assets/cjs_shims.js`), so both formats resolve the SAME package.json.
  // `packages/runtime/tsup.config.ts` and `packages/metadata-protocol/tsup.config.ts`
  // carry it for the same reason. Do not drop this line while
  // `package-version.ts` exists.
  //
  // Need-based injection — nothing else here references `__dirname` /
  // `__filename`, so the ESM build's shim path is a no-op.
  shims: true,
  esbuildOptions: dropSourcesContent,
});
