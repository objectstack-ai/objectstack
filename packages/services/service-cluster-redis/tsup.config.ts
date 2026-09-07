// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'tsup';

import { dropSourcesContent } from '../../../scripts/tsup-drop-sources-content.mjs';

export default defineConfig({
    entry: ['src/index.ts'],
    splitting: true,
    sourcemap: true,
    clean: true,
    dts: !process.env.OS_SKIP_DTS,
    format: ['esm', 'cjs'],
    target: 'es2020',
    external: ['vitest', 'ioredis'],
    esbuildOptions: dropSourcesContent,
});
