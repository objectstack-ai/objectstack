// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // A late console.* must not redden a green suite: the boot test starts a
    // whole kernel, whose logger can write after teardown. Mechanism and
    // measured costs: examples/app-showcase/vitest.config.ts; enforced
    // repo-wide by scripts/check-console-intercept-disarm.mjs.
    disableConsoleIntercept: true,
    // Quiet the registry's per-item registration chatter — the engine's own
    // `OS_REGISTRY_LOG` seam, not a change to its shipped default. Enforced by
    // scripts/check-registry-log-declared.mjs.
    env: { OS_REGISTRY_LOG: 'warn' },
  },
  resolve: {
    // Every workspace package these tests import resolves to its SOURCE, so a
    // verdict here is about the checkout, never about whatever `dist/` was last
    // built (`pnpm check:test-source-alias`). Anchored, array form: a bare
    // string key matches by prefix and would swallow the subpaths.
    alias: [
      { find: /^@objectstack\/connector-openapi$/, replacement: path.resolve(HERE, '../../connectors/connector-openapi/src/index.ts') },
      { find: /^@objectstack\/spec$/, replacement: path.resolve(HERE, '../../spec/src/index.ts') },
      { find: /^@objectstack\/spec\/integration$/, replacement: path.resolve(HERE, '../../spec/src/integration/index.ts') },
      { find: /^@objectstack\/spec\/marketplace$/, replacement: path.resolve(HERE, '../../spec/src/marketplace/index.ts') },
      { find: /^@objectstack\/verify$/, replacement: path.resolve(HERE, '../../verify/src/index.ts') },
    ],
  },
});
