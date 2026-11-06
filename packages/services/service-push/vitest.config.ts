import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * The transports read their configuration types and the plugin parses its
 * `config` with `PushServiceConfigSchema`, both from `@objectstack/spec/system`.
 * Unaliased, the workspace link resolves that to the spec package's last
 * build, so a test about the source next to it would report on build state
 * instead (`pnpm check:test-source-alias` is the gate). Anchored regex, array
 * form: a bare string `find` matches by PREFIX.
 */
export default defineConfig({
  test: {
    // A late console.* must not redden a green suite (#10374).
    // Mechanism + measured costs: examples/app-showcase/vitest.config.ts.
    // Enforced repo-wide by scripts/check-console-intercept-disarm.mjs.
    disableConsoleIntercept: true,
  },
  resolve: {
    alias: [
      { find: /^@objectstack\/spec\/system$/, replacement: path.resolve(__dirname, '../../spec/src/system/index.ts') },
      // The relay sender parses its request with `PushRelayRequestSchema`
      // (`@objectstack/spec/api`), and the plugin reads `isControlPlaneDeclined`
      // from `@objectstack/core`: both from source, for the same reason.
      { find: /^@objectstack\/spec\/api$/, replacement: path.resolve(__dirname, '../../spec/src/api/index.ts') },
      { find: /^@objectstack\/core$/, replacement: path.resolve(__dirname, '../../core/src/index.ts') },
      // The relay sender reads the `cloud-binding` service name from the
      // contract (`CLOUD_BINDING_SERVICE`, `@objectstack/spec/contracts`): from
      // source, for the same reason.
      { find: /^@objectstack\/spec\/contracts$/, replacement: path.resolve(__dirname, '../../spec/src/contracts/index.ts') },
    ],
  },
});
