// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'tsup';

import { dropSourcesContent } from '../../../scripts/tsup-drop-sources-content.mjs';

export default defineConfig({
    entry: ['src/index.ts', 'src/contracts/index.ts'],
    splitting: true,
    sourcemap: true,
    clean: true,
    dts: !process.env.OS_SKIP_DTS,
    format: ['esm', 'cjs'],
    target: 'es2020',
    // Driver packages are loaded via optional, lazy `await import('@objectstack/driver-*')`
    // (default-datasource-driver-factory) — and pull in optional native clients
    // (mysql / pg / better-sqlite3 / mongodb). They must stay EXTERNAL so esbuild
    // never tries to bundle/resolve those optional natives. (They are devDeps for
    // tests; previously they were optional peerDeps, which tsup auto-externalized.)
    external: ['vitest', /^@objectstack\/driver-/],
    esbuildOptions: dropSourcesContent,
});
