// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #8030 brought the first REAL-ENGINE test into this package
// (`settings-secret-rotation.test.ts`), and a real-engine test resolved
// through `exports` would read `@objectstack/objectql`'s **dist** — a build
// artifact. The whole point of that test is the engine's read-only strip
// (`stripReadonlyFields`, gated on `context.isSystem`); asserting it against a
// prebuilt copy would report on build state rather than on the source in the
// checkout, and the failure mode is a GREEN test that proves nothing
// (`scripts/check-test-source-alias.mjs` for the measured history).
//
// `@objectstack/core` is aliased for the same reason and by the same change:
// that test is the first one in this package to reach
// `settings-service-plugin.ts` (for the real `IDataEngine → SettingsEngine`
// adapter), which pulls `resolveAuthzContext` from core — so core became
// newly reachable from the package's tests and the gate named it.
//
// Only those two are aliased, deliberately. The package's other workspace
// imports (`@objectstack/platform-objects`, `@objectstack/spec`,
// `@objectstack/types`) are its registered set in that gate's
// `KNOWN_UNALIASED_TEST_IMPORTS`; the registry is audited for set EQUALITY in
// both directions, so aliasing them here is a separate, deliberate shrink and
// not a rider on a P0 security fix.
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    // Array form with an ANCHORED pattern, per the trap the gate documents:
    // the object form matches by PREFIX, so a bare key whose replacement is a
    // FILE also swallows every subpath and resolves it to `…/index.ts/<sub>`
    // (`ENOTDIR`, at run time, in a config that looks right).
    alias: [
      {
        find: /^@objectstack\/objectql$/,
        replacement: path.resolve(__dirname, '../../objectql/src/index.ts'),
      },
      {
        find: /^@objectstack\/core$/,
        replacement: path.resolve(__dirname, '../../core/src/index.ts'),
      },
    ],
  },
});
