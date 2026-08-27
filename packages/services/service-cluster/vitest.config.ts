import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * [#11968] `authz-cluster-bridge-plugin.ts` reads the grants-cache TTL and
 * resolves the boot-time posture statement through `@objectstack/core`
 * (`readAuthzGrantsCacheTtlMs`, `reportAuthzCachePosture`), and its test drives
 * the plugin end to end. Unaliased, the workspace link resolves that package to
 * `dist/`, which makes the verdict a function of build state rather than of the
 * source in this checkout — and the dangerous direction is the quiet one: a
 * `dist` merely BEHIND runs the posture tests green against the decision
 * function that USED to ship. This gate family (`pnpm check:test-source-alias`)
 * exists for exactly that reading.
 *
 * ANCHORED regex, array form, deliberately: a bare string `find` matches by
 * PREFIX, so with a FILE replacement it would also swallow any subpath and
 * resolve it to `…/core/src/index.ts/<sub>` — `ENOTDIR` at run time, from a
 * config that reads as correct. Mirrors the identical rule in
 * `packages/services/service-messaging/vitest.config.ts`.
 */
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@objectstack\/core$/,
        replacement: path.resolve(__dirname, '../../core/src/index.ts'),
      },
    ],
  },
});
