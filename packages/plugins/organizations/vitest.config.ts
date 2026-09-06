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
    // The three entries, and why each one is a VALUE reach rather than a type
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
  },
});
