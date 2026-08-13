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
// #8104 finished the job for the remaining three — `@objectstack/spec`,
// `@objectstack/platform-objects` and `@objectstack/types` — and with them this
// package's entry in `KNOWN_UNALIASED_TEST_IMPORTS` came off. That registry is
// audited for set EQUALITY in both directions, so deleting the entry is half of
// that change rather than its cleanup: the aliases below and the absence of the
// entry each fail the gate without the other.
//
// ⚠️ What the shrink actually required, measured rather than assumed: this
// package imports NO bare `@objectstack/spec` and NO bare
// `@objectstack/platform-objects` at run time. Every specifier its tests can
// reach for those two is a SUBPATH — `spec/api`, `spec/contracts`, `spec/data`,
// `spec/system`, `platform-objects/system` — joined by `spec/security`, reached
// transitively through `@objectstack/types` ([ADR-0105 D1] tenancy posture)
// once types itself resolves to source. An anchored BARE pattern
// (`/^@objectstack\/spec$/`) matches none of them, so copying #8063's
// two-entry shape would have left all of them on `dist` with the registry entry
// undeletable. The subpath rules below are the load-bearing half.
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
      // `platform-objects` gets an EXPLICIT subpath entry rather than the
      // one-rule-for-all-namespaces capture below, because its export map is
      // not uniform: `./plugin` is `src/plugin.ts`, a FILE, while every other
      // namespace is `src/<ns>/index.ts`. A `([a-z-]+)` rule would send
      // `platform-objects/plugin` to `src/plugin/index.ts`, which does not
      // exist — a path nobody wrote, failing on whoever adds that import.
      // `plugin-audit` writes its `platform-objects/audit` entry the same way
      // and for the same reason.
      {
        find: /^@objectstack\/platform-objects\/system$/,
        replacement: path.resolve(__dirname, '../../platform-objects/src/system/index.ts'),
      },
      {
        find: /^@objectstack\/platform-objects$/,
        replacement: path.resolve(__dirname, '../../platform-objects/src/index.ts'),
      },
      // `spec`, by contrast, IS uniform — every namespace in its export map is
      // `src/<ns>/index.ts` — so one rule covers all of them and cannot go
      // stale when a new namespace import arrives. The capture group has to sit
      // INSIDE the path, which is what forces the template literal here (the
      // shape `service-knowledge` and `plugin-audit` already use, and the one
      // the gate's canary fixture pins so a reader cannot misread it — #8020).
      {
        find: /^@objectstack\/spec\/([a-z-]+)$/,
        replacement: `${path.resolve(__dirname, '../../spec/src')}/$1/index.ts`,
      },
      {
        find: /^@objectstack\/spec$/,
        replacement: path.resolve(__dirname, '../../spec/src/index.ts'),
      },
      {
        find: /^@objectstack\/types$/,
        replacement: path.resolve(__dirname, '../../types/src/index.ts'),
      },
    ],
  },
});
