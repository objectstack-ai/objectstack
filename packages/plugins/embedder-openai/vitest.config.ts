// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@objectstack/spec/contracts': path.resolve(__dirname, '../../spec/src/contracts/index.ts'),
      '@objectstack/spec/shared': path.resolve(__dirname, '../../spec/src/shared/index.ts'),
      // [ADR-0105 D1] Reached transitively via `@objectstack/types` (tenancy posture).
      '@objectstack/spec/security': path.resolve(__dirname, '../../spec/src/security/index.ts'),
      '@objectstack/spec': path.resolve(__dirname, '../../spec/src/index.ts'),
    },
  },
});
