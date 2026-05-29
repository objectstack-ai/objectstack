// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@objectstack/core': path.resolve(__dirname, '../core/src/index.ts'),
      '@objectstack/driver-memory': path.resolve(__dirname, '../plugins/driver-memory/src/index.ts'),
      '@objectstack/spec/api': path.resolve(__dirname, '../spec/src/api/index.ts'),
      '@objectstack/spec/cloud': path.resolve(__dirname, '../spec/src/cloud/index.ts'),
      '@objectstack/spec/contracts': path.resolve(__dirname, '../spec/src/contracts/index.ts'),
      '@objectstack/spec/data': path.resolve(__dirname, '../spec/src/data/index.ts'),
      '@objectstack/spec/kernel': path.resolve(__dirname, '../spec/src/kernel/index.ts'),
      '@objectstack/spec/system': path.resolve(__dirname, '../spec/src/system/index.ts'),
      '@objectstack/spec/shared': path.resolve(__dirname, '../spec/src/shared/index.ts'),
      '@objectstack/spec': path.resolve(__dirname, '../spec/src/index.ts'),
      '@objectstack/types': path.resolve(__dirname, '../types/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
