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
  // LOAD-BEARING, and measured rather than assumed. `servedSpecVersion`
  // (discovery-routes.ts) and `loadOpenApiSpec` (rest-server.ts) resolve a
  // manifest via `createRequire(import.meta.url)`. Under the shared root
  // config, which has no `shims`, esbuild EMPTIES `import.meta` in the CJS
  // bundle (`var import_meta = {}`), so `createRequire(undefined)` throws and
  // `require('@objectstack/rest')` answers the restriction-profile route 503
  // while the ESM build answers 200. `shims: true` rewrites `import.meta.url`
  // in the CJS build to a `__filename`-derived value, so both formats resolve
  // the same manifest; `packages/mcp/tsup.config.ts` measured the same. The
  // `check:dual-build-cjs-loads` probe on `@objectstack/rest` holds it. Do not
  // drop this line while either reader exists.
  shims: true,
  esbuildOptions: dropSourcesContent,
});
