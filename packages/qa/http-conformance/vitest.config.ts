// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // The conformance suite boots real kernels + sockets.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
