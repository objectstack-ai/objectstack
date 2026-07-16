// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// #3071/#3060: alias workspace deps to `src/` so the tests load regardless of
// whether upstream `dist/` has been built — same convention as
// plugin-hono-server. Without this, vitest resolves @objectstack/core through
// its package.json `exports` (dist), which on a fresh tree / CI runner may
// not exist yet.
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@objectstack/core': path.resolve(__dirname, '../../core/src/index.ts'),
      '@objectstack/types': path.resolve(__dirname, '../../types/src/index.ts'),
      '@objectstack/spec/api': path.resolve(__dirname, '../../spec/src/api/index.ts'),
      '@objectstack/spec/contracts': path.resolve(__dirname, '../../spec/src/contracts/index.ts'),
      '@objectstack/spec/data': path.resolve(__dirname, '../../spec/src/data/index.ts'),
      '@objectstack/spec/kernel': path.resolve(__dirname, '../../spec/src/kernel/index.ts'),
      '@objectstack/spec/system': path.resolve(__dirname, '../../spec/src/system/index.ts'),
      '@objectstack/spec': path.resolve(__dirname, '../../spec/src/index.ts'),
    },
  },
});
