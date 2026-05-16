// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/node.ts',
    'src/migrations/index.ts',
  ],
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: true,
  format: ['esm', 'cjs'],
  target: 'es2020',
});
