import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * [#12157] `plugin.ts` registers the ADR-0126 §4 activation ledger's object,
 * `sys_metadata_activation`, which is DECLARED in `@objectstack/platform-objects`
 * (the ADR puts it there, beside its data-plane siblings, so it needs zero
 * `packages/spec` surface). The plugin tests therefore reach that package, and
 * unaliased the workspace link resolves it to `dist/` — which makes the verdict
 * a function of build state rather than of the source in this checkout. A
 * `dist` merely BEHIND would run the ledger tests green against an object
 * declaration that no longer matches the one shipping, which is exactly the
 * reading they exist to pin. `pnpm check:test-source-alias` is the gate.
 *
 * ANCHORED regex, array form, deliberately: a bare string `find` matches by
 * PREFIX, so with a FILE replacement it would also swallow any subpath and
 * resolve it to `…/platform-objects/src/index.ts/<sub>` — `ENOTDIR` at run
 * time, from a config that reads as correct. Mirrors the identical rule in
 * `packages/services/service-messaging/vitest.config.ts`.
 */
export default defineConfig({
  test: {
    // A late console.* must not redden a green suite (#10374): vitest's worker
    // forwards console output over RPC and discards the promise, and a write
    // landing after teardown's rpcDone() snapshot is rejected into an unhandled
    // error — a fully green run that exits 1. Disarming removes the mechanism.
    // Mechanism + measured costs: examples/app-showcase/vitest.config.ts.
    // Enforced repo-wide by scripts/check-console-intercept-disarm.mjs.
    disableConsoleIntercept: true,
    // #13517 / #15425: quiet the SchemaRegistry's per-item registration
    // chatter — the engine's OWN `OS_REGISTRY_LOG` seam
    // (`SchemaRegistryOptions.logLevel` / `REGISTRY_LOG_LEVELS`, objectql's
    // registry.ts), not a change to its shipped 'info' default and not a
    // library that sniffs `process.env.VITEST`. This suite constructs bare
    // registries in `connector-reload-reingest.test.ts` and
    // `flow-name-shadowing.test.ts` and registers items into them per case.
    // ⚠️ `flow-name-shadowing.test.ts` asserts on shadowing warnings, which
    // ride a bare `console.warn` this level never gates — measured green with
    // the declaration in place. Enforced by
    // scripts/check-registry-log-declared.mjs.
    env: { OS_REGISTRY_LOG: 'warn' },
  },
  resolve: {
    alias: [
      {
        find: /^@objectstack\/platform-objects$/,
        replacement: path.resolve(__dirname, '../../platform-objects/src/index.ts'),
      },
    ],
  },
});
