// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // Late console writes must not redden a green suite — see the mechanism
    // docblock in examples/app-showcase/vitest.config.ts.
    disableConsoleIntercept: true,
    env: { OS_REGISTRY_LOG: 'warn' },
  },
  resolve: {
    // Source aliases for every workspace package the tests reach as a value:
    // the spec the config is authored with, the harness that boots it, and the
    // marketplace install door the test installs it through.
    // Unaliased, each resolves through its workspace link to `dist/`, so the
    // verdict would be about build state rather than the source in this
    // checkout (`pnpm check:test-source-alias`). Anchored regex, array form: a
    // bare string `find` matches by prefix and would swallow the subpaths.
    alias: [
      { find: /^@objectstack\/cloud-connection$/, replacement: path.resolve(HERE, '../../packages/cloud-connection/src/index.ts') },
      { find: /^@objectstack\/spec$/, replacement: path.resolve(HERE, '../../packages/spec/src/index.ts') },
      { find: /^@objectstack\/spec\/data$/, replacement: path.resolve(HERE, '../../packages/spec/src/data/index.ts') },
      { find: /^@objectstack\/spec\/system$/, replacement: path.resolve(HERE, '../../packages/spec/src/system/index.ts') },
      { find: /^@objectstack\/spec\/ui$/, replacement: path.resolve(HERE, '../../packages/spec/src/ui/index.ts') },
      { find: /^@objectstack\/verify$/, replacement: path.resolve(HERE, '../../packages/verify/src/index.ts') },
    ],
  },
});
