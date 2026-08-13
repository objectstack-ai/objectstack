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
      '@objectstack/core': path.resolve(__dirname, '../../core/src/index.ts'),
      '@objectstack/observability': path.resolve(__dirname, '../../observability/src/index.ts'),
      '@objectstack/spec/api': path.resolve(__dirname, '../../spec/src/api/index.ts'),
      '@objectstack/spec/contracts': path.resolve(__dirname, '../../spec/src/contracts/index.ts'),
      '@objectstack/spec/data': path.resolve(__dirname, '../../spec/src/data/index.ts'),
      '@objectstack/spec/kernel': path.resolve(__dirname, '../../spec/src/kernel/index.ts'),
      // Reached transitively: `@objectstack/types` resolves the tenancy posture
      // (ADR-0105 D1) from this subpath. Without the entry the bare
      // `@objectstack/spec` alias below wins by prefix and yields the
      // nonsensical `spec/src/index.ts/security`.
      '@objectstack/spec/security': path.resolve(__dirname, '../../spec/src/security/index.ts'),
      '@objectstack/spec/system': path.resolve(__dirname, '../../spec/src/system/index.ts'),
      // [#7378] Reached transitively: `@objectstack/core` (aliased to src above)
      // resolves the metadata register contract's plural→singular fold from this
      // subpath (`pluralToSingular`). An alias list matches by PREFIX, so without
      // this entry the bare `@objectstack/spec` alias below wins and yields the
      // nonsensical `spec/src/index.ts/shared` — ENOTDIR at import time for every
      // test file that transitively loads `@objectstack/core`.
      '@objectstack/spec/shared': path.resolve(__dirname, '../../spec/src/shared/index.ts'),
      '@objectstack/spec': path.resolve(__dirname, '../../spec/src/index.ts'),
    },
  },
});
