// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    // Every workspace dependency this package's tests reach AS A VALUE is
    // aliased to source, which is `pnpm check:test-source-alias`'s prescribed
    // fix (#7668/#7778); registering the package in that gate's unaliased
    // ledger is explicitly NOT — the ledger is shrink-only.
    //
    // Some of the entries, and why each one is a VALUE reach rather than a type
    // reach (a `import type` is erased before anything resolves and needs no
    // alias):
    //   - `@objectstack/plugin-auth` — `organizations-plugin.ts` imports
    //     `isDefaultOrganizationBootstrapTrigger`, `ensure-default-organization.ts`
    //     imports the open `ensureDefaultOrganization` helper it wraps, and
    //     `membership-policy-gate.ts` imports `isMembershipPolicy` /
    //     `MEMBERSHIP_POLICIES`. That last pair is the closed VOCABULARY this
    //     gate adjudicates against, so a `dist/` copy behind the source would
    //     let a declared-but-invalid policy read as valid — the gate's whole
    //     subject, answered off a build artifact.
    //   - `@objectstack/types` — `resolveTenancyPosture()`, which decides
    //     whether the membership-policy gate runs at all.
    //   - `@objectstack/core` — `resetPlatformAdminEmailMemo` in
    //     `walled-default-org-self-registrant.pin.test.ts`, whose subject is
    //     exactly which principal the default-org bootstrap treats as the
    //     declared owner.
    //   - `@objectstack/service-storage` and `@objectstack/verify` — the
    //     `StorageServicePlugin` and `bootStack` that
    //     `storage-upload-door-ownership.wall.test.ts` boots the walled stack
    //     with (#22046). The storage upload doors ARE that file's subject, so a
    //     `dist/` copy behind the source would measure an older door.
    //
    // ANCHORED regex, array form, deliberately: a bare string `find` matches by
    // PREFIX, so with a FILE replacement it would also swallow a subpath and
    // resolve it to `…/src/index.ts/<subpath>` — `ENOTDIR`, at run time, from a
    // config that reads as correct. `@objectstack/core` really does publish
    // subpaths (`./logger`, `./node`), so this is not hypothetical here.
    alias: [
      {
        find: /^@objectstack\/plugin-auth$/,
        replacement: path.resolve(__dirname, '../plugin-auth/src/index.ts'),
      },
      {
        find: /^@objectstack\/types$/,
        replacement: path.resolve(__dirname, '../../types/src/index.ts'),
      },
      {
        find: /^@objectstack\/core$/,
        replacement: path.resolve(__dirname, '../../core/src/index.ts'),
      },
      {
        // Test-only, and the reason it is a VALUE reach: the open-only wall
        // acceptance (`open-only-wall-acceptance.test.ts`) constructs a real
        // `RestServer` and drives its route handlers, so the whole REST
        // admission chain — `resolveExecCtx` → `computeExecCtx` →
        // `resolveAuthzContext` — is the subject under measurement. Resolved
        // from `dist/` that suite would render its verdict about the last
        // `pnpm build` of `@objectstack/rest`, which for an ACCEPTANCE is the
        // silent-green direction: the wall would read as raised against a
        // stale copy of the very code that raises it.
        find: /^@objectstack\/rest$/,
        replacement: path.resolve(__dirname, '../../rest/src/index.ts'),
      },
      {
        // Test-only: the moved fakes open their `update()` with
        // `assertEngineUpdateDispatch`, which is the PREDICATE those doubles are
        // pinned to (`pnpm check:engine-double-contract`). Resolved from `dist/`
        // it would pin them to a stale copy of the producer's rejection rule —
        // the exact silent-green this gate exists to stop.
        find: /^@objectstack\/metadata-core$/,
        replacement: path.resolve(__dirname, '../../metadata-core/src/index.ts'),
      },
      // Test-only, all three: `create-explicit-organization-wall.test.ts` boots
      // THIS package's Middleware A beside the real `SecurityPlugin` on a real
      // `ObjectQL` engine over a real SQLite driver, because its subject is
      // what the two middlewares answer TOGETHER — the stamp here fills an
      // absent `organization_id`, the Layer 0 write wall there judges a
      // supplied one. Resolved from `dist/`, the wall's half of every verdict
      // would be about the last build of `plugin-security`, and a dist merely
      // BEHIND runs green against the old wall while saying nothing.
      {
        find: /^@objectstack\/objectql$/,
        replacement: path.resolve(__dirname, '../../objectql/src/index.ts'),
      },
      {
        find: /^@objectstack\/plugin-security$/,
        replacement: path.resolve(__dirname, '../plugin-security/src/index.ts'),
      },
      {
        find: /^@objectstack\/driver-sqlite-wasm$/,
        replacement: path.resolve(__dirname, '../../drivers/driver-sqlite-wasm/src/index.ts'),
      },
      {
        find: /^@objectstack\/service-storage$/,
        replacement: path.resolve(__dirname, '../../services/service-storage/src/index.ts'),
      },
      {
        find: /^@objectstack\/verify$/,
        replacement: path.resolve(__dirname, '../../verify/src/index.ts'),
      },
    ],
  },
  test: {
    // A late console.* must not redden a green suite (#10374): vitest's worker
    // forwards console output over RPC and discards the promise, and a write
    // landing after teardown's rpcDone() snapshot is rejected into an unhandled
    // error — a fully green run that exits 1. Disarming removes the mechanism.
    // Mechanism + measured costs: examples/app-showcase/vitest.config.ts.
    // Enforced repo-wide by scripts/check-console-intercept-disarm.mjs.
    disableConsoleIntercept: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // #13517: quiet the registry's per-item registration chatter — the
    // engine's own `OS_REGISTRY_LOG` seam, not a change to its shipped
    // default. Enforced by scripts/check-registry-log-declared.mjs, since
    // `storage-upload-door-ownership.wall.test.ts` boots a stack through
    // `@objectstack/verify`'s `bootStack`.
    env: { OS_REGISTRY_LOG: 'warn' },
  },
});
