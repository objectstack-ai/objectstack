// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// This package had NO vitest config until #9832, and that is the fact this
// header exists to keep visible: adding one changes how every test file in
// `packages/cli` is configured, not just the file that needed it. So the
// config is deliberately minimal — a single anchored `resolve.alias` entry and
// no `test` block at all, because the 135 test files here run on vitest's
// defaults (`globals: false`, `environment: 'node'`) and a `test` block would
// silently re-specify them. Sibling configs in this repo do carry
// `test: { globals: true, … }`; copying that shape here would have flipped
// `globals` for every existing file in the package.
//
// ## Why the one entry
//
// `serve-observability-registration.test.ts` (#9832) boots the REAL
// `CacheServicePlugin` to prove that a consumer registered after
// `ObservabilityServicePlugin` actually resolves `observability:metrics` and
// EMITS through it. Without an alias that import resolves through the
// package's `exports` to `@objectstack/service-cache`'s **dist**, which makes
// the test a verdict about build state rather than about the source in the
// checkout — and the dangerous half of that is not a loud error but a test
// that passes GREEN against a stale artifact with nothing in the output
// saying so. `scripts/check-test-source-alias.mjs` carries the measured
// history (#7668, #7778, #7849); it named this import and is the gate that
// fails without the entry below.
//
// ⚠️ The registry in that script is SHRINK-ONLY, so widening
// `KNOWN_UNALIASED_TEST_IMPORTS['@objectstack/cli']` was never an option — and
// it is deliberately left untouched here. The other 28 entries in it are real
// and still unaliased; this change removes nothing from that ledger and adds
// nothing to it. Measured before writing this: `@objectstack/service-cache`
// was reachable from NO other file in `packages/cli` (which is why it was
// absent from the ledger in the first place), so this entry re-resolves
// exactly one file — the new test — and cannot move any existing suite.
// Measured again after: 135 files / 1470 tests, unchanged.
//
// Crossing into `service-cache/src` also makes ITS value imports reachable to
// the gate's walk. That is one package, `@objectstack/observability`, which is
// already in this package's ledger entry — so the required set is unchanged in
// both directions.
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    // Array form with an ANCHORED pattern, per the trap the gate documents:
    // the object form matches by PREFIX, so a bare key whose replacement is a
    // FILE also swallows every subpath and resolves it to `…/index.ts/<sub>`
    // (`ENOTDIR`, at run time, in a config that looks right). `service-cache`
    // is imported bare and has no subpath exports, but the anchored form is
    // what keeps that true when one is added.
    alias: [
      {
        find: /^@objectstack\/service-cache$/,
        replacement: path.resolve(__dirname, '../services/service-cache/src/index.ts'),
      },
    ],
  },
});
