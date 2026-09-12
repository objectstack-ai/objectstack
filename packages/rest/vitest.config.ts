// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { configDefaults, defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import path from 'path';

// #16466 -- two vitest projects, two turbo tasks. `repo` owns the tests that read
// outside this package (the list is vitest.repo-tests.json, which
// check:cross-package-test-inputs holds equal to its own scan); `local` owns
// every other test file. turbo hashes the wide `$TURBO_ROOT$` inputs on
// `test:repo` only, so `test` stays cacheable across changes elsewhere in the
// repo. `extends: true` keeps the root options (aliases included) on both.
const REPO_TESTS: string[] = JSON.parse(readFileSync(path.join(__dirname, 'vitest.repo-tests.json'), 'utf8'));

export default defineConfig({
  test: {
    // Each project re-declares the root block's test options: a ROOT-level
    // value is inert for a project run (measured on vitest 4.1.10, see
    // check-registry-log-declared / check-console-intercept-disarm).
    projects: [
      {
        extends: true,
        test: {
          name: 'local',
          include: configDefaults.include,
          exclude: [...configDefaults.exclude, ...REPO_TESTS],
          globals: true, environment: 'node',
          // #13517: quiet the registry's per-item registration chatter — the
          // engine's own `OS_REGISTRY_LOG` seam, not a change to its shipped
          // default. Enforced by scripts/check-registry-log-declared.mjs.
          env: { OS_REGISTRY_LOG: 'warn', OS_REST_LOG: 'silent' },
          // A late console.* must not redden a green suite (#10374); see the root
          // block. A ROOT-level value is inert for a project run, so it is
          // declared here as well (scripts/check-console-intercept-disarm.mjs).
          disableConsoleIntercept: true,
        },
      },
      {
        extends: true,
        test: {
          name: 'repo',
          include: REPO_TESTS,
          globals: true, environment: 'node',
          // #13517: quiet the registry's per-item registration chatter — the
          // engine's own `OS_REGISTRY_LOG` seam, not a change to its shipped
          // default. Enforced by scripts/check-registry-log-declared.mjs.
          env: { OS_REGISTRY_LOG: 'warn', OS_REST_LOG: 'silent' },
          // A late console.* must not redden a green suite (#10374); see the root
          // block. A ROOT-level value is inert for a project run, so it is
          // declared here as well (scripts/check-console-intercept-disarm.mjs).
          disableConsoleIntercept: true,
        },
      },
    ],
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
    // library that sniffs `process.env.VITEST`. ⭐ This suite is the one
    // `docs/audits/2026-09-test-log-volume-census.md` kept as its untouched
    // CONTROL while #13985/#14016 quieted four others, and it measures 528
    // residual `[Registry]` lines here — eight times what declared objectql
    // still emits. Six test files in this package construct bare registries.
    // The ADR-0005 `[Registry] Collision` diagnostics go through a bare
    // `console.warn` the level never gates, so a real shadowing still speaks.
    // Enforced by scripts/check-registry-log-declared.mjs.
    env: { OS_REGISTRY_LOG: 'warn', OS_REST_LOG: 'silent' },
    globals: true,
    environment: 'node',
  },
  resolve: {
    // Both entries exist for `remote-tables-twin.equivalence.test.ts` (#7955),
    // the one suite here that imports sibling packages as VALUES: it mounts the
    // `service-datasource` admin registrar next to this package's federation
    // registrar to pin that the two `listRemoteTables` spellings answer `?schema=`
    // identically, and drives both through the real Hono adapter.
    //
    // Unaliased, those two specifiers resolve through the workspace link to
    // `dist/` — a BUILD ARTIFACT — which makes this suite's verdict a function of
    // build state rather than of the source in the checkout. The loud failure
    // (missing export) is the mild half; a dist merely BEHIND lets the test run
    // GREEN against the dependency's old behaviour, and nothing in the output
    // says so. That is exactly the hazard for a CROSS-PACKAGE equivalence pin:
    // its whole job is to notice when one of the two twins moves, and a stale
    // `service-datasource` dist would report the pre-fix admin route as agreeing
    // with the federation one — the #7955 defect itself, passing.
    //
    // Turbo already orders `test` after `^build`, so `turbo run test` was never
    // the failing path. The paths it does not mediate are: `pnpm test` inside
    // this package, `vitest run <file>`, an editor runner, or an agent working
    // in a tree built at an older commit — which are precisely the ways this pin
    // gets re-run WHILE someone is changing one of the two routes.
    //
    // Array form with anchored patterns, deliberately: the object form matches
    // by PREFIX, so a bare `@objectstack/service-datasource` key with a FILE
    // replacement would also swallow `@objectstack/service-datasource/contracts`
    // and resolve it to `…/src/index.ts/contracts` (ENOTDIR) at run time, in a
    // config that looks right. Same shape as `service-storage`'s config (#7778).
    alias: [
      {
        find: /^@objectstack\/plugin-hono-server$/,
        replacement: path.resolve(__dirname, '../plugins/plugin-hono-server/src/index.ts'),
      },
      {
        find: /^@objectstack\/service-datasource$/,
        replacement: path.resolve(__dirname, '../services/service-datasource/src/index.ts'),
      },
    ],
  },
});
