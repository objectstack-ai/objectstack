// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

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
      '@objectstack/spec/data': path.resolve(__dirname, '../../spec/src/data/index.ts'),
      '@objectstack/spec/shared': path.resolve(__dirname, '../../spec/src/shared/index.ts'),
      '@objectstack/spec/system': path.resolve(__dirname, '../../spec/src/system/index.ts'),
      // [ADR-0105 D1] Reached transitively via `@objectstack/types` (tenancy posture).
      '@objectstack/spec/security': path.resolve(__dirname, '../../spec/src/security/index.ts'),
      // Reached transitively via `@objectstack/core` (#3777's `nextUtcCalendarDay`
      // import pulls core's src barrel in, which fans out to these subpaths).
      '@objectstack/spec/api': path.resolve(__dirname, '../../spec/src/api/index.ts'),
      '@objectstack/spec/kernel': path.resolve(__dirname, '../../spec/src/kernel/index.ts'),
      '@objectstack/spec/qa': path.resolve(__dirname, '../../spec/src/qa/index.ts'),
      '@objectstack/spec': path.resolve(__dirname, '../../spec/src/index.ts'),
      '@objectstack/core': path.resolve(__dirname, '../../core/src/index.ts'),
    },
  },
});
