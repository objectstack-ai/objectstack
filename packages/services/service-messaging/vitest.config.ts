import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * [#9371] `plugin-shutdown-stops-dispatchers.test.ts` asserts a property of the
 * KERNEL's teardown contract — that `ObjectKernel.performShutdown()` reaches
 * this plugin's `destroy()` — so the `@objectstack/core` it runs against has to
 * be the source in this checkout. Unaliased, the workspace link resolves it to
 * `dist/`, and the verdict becomes a function of build state: a `dist` merely
 * BEHIND would run that test GREEN against a `performShutdown` that no longer
 * matches the one shipping, which is precisely the reading it exists to pin.
 * `pnpm check:test-source-alias` is the gate.
 *
 * ANCHORED regex, array form, deliberately: a bare string `find` matches by
 * PREFIX, so with a FILE replacement it would also swallow any subpath and
 * resolve it to `…/core/src/index.ts/<sub>` — `ENOTDIR` at run time, from a
 * config that reads as correct. Mirrors the identical rule in
 * `examples/app-showcase/vitest.config.ts`.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@objectstack\/core$/, replacement: path.resolve(__dirname, '../../core/src/index.ts') },
    ],
  },
});
