// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// #3071: without these aliases, vitest resolves workspace deps through their
// package.json `exports` — i.e. `dist/` — so whether this package's tests
// even LOAD depends on turbo build ordering and cache-restore integrity on
// the runner (the deterministic zero-output CI failure). Aliasing to `src/`
// (the same convention plugin-hono-server et al. already use) removes the
// dist dependency entirely.
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
      '@objectstack/platform-objects/audit': path.resolve(__dirname, '../../platform-objects/src/audit/index.ts'),
      '@objectstack/spec/contracts': path.resolve(__dirname, '../../spec/src/contracts/index.ts'),
      '@objectstack/spec/data': path.resolve(__dirname, '../../spec/src/data/index.ts'),
      '@objectstack/spec/system': path.resolve(__dirname, '../../spec/src/system/index.ts'),
      '@objectstack/spec/api': path.resolve(__dirname, '../../spec/src/api/index.ts'),
      '@objectstack/spec/kernel': path.resolve(__dirname, '../../spec/src/kernel/index.ts'),
      '@objectstack/spec': path.resolve(__dirname, '../../spec/src/index.ts'),
      '@objectstack/types': path.resolve(__dirname, '../../types/src/index.ts'),
    },
  },
});
