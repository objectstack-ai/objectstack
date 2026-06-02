// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts', 'src/contracts/index.ts'],
    splitting: true,
    sourcemap: true,
    clean: true,
    dts: true,
    format: ['esm', 'cjs'],
    target: 'es2020',
    external: ['vitest'],
});
