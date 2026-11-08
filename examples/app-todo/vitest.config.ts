// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    // Late console writes must not redden a green suite (#10374) — see the
    // mechanism docblock in examples/app-showcase/vitest.config.ts. Enforced
    // by scripts/check-console-intercept-disarm.mjs.
    disableConsoleIntercept: true,
  },
  resolve: {
    // Source aliases for the platform packages `test/mcp-actions.test.ts`
    // drives: the MCP door (`@objectstack/mcp`), the runtime's action bridge
    // and app boot (`@objectstack/runtime`), and the identity objects that give
    // the boot its Default Organization (`@objectstack/plugin-auth`).
    // Unaliased, each resolves through its workspace link to `dist/`, so the
    // verdict would be about build state rather than the source in this
    // checkout. `pnpm check:test-source-alias` is the gate.
    //
    // ANCHORED regex, array form: a bare string `find` matches by prefix and
    // would swallow subpaths into `…/src/index.ts/<sub>`.
    alias: [
      { find: /^@objectstack\/mcp$/, replacement: path.resolve(__dirname, '../../packages/mcp/src/index.ts') },
      { find: /^@objectstack\/plugin-auth$/, replacement: path.resolve(__dirname, '../../packages/plugins/plugin-auth/src/index.ts') },
      { find: /^@objectstack\/runtime$/, replacement: path.resolve(__dirname, '../../packages/runtime/src/index.ts') },
    ],
  },
});
