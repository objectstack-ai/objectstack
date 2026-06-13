// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: !process.env.OS_SKIP_DTS,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
});
