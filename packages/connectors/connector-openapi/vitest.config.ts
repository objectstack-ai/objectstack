// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * This package had NO vitest config until #10371, and that is the fact this
 * header exists to keep visible: adding one changes how every test file in
 * `packages/connectors/connector-openapi` is configured, not just the file that
 * needed it. So it is deliberately minimal — anchored `resolve.alias` entries
 * and **no `test` block at all**, because the package's existing test files run
 * on vitest's defaults (`globals: false`, `environment: 'node'`) and import
 * `describe`/`it`/`expect` explicitly. Sibling configs in this repo do carry
 * `test: { globals: true, … }`; copying that shape here would silently
 * re-specify the defaults for every existing file.
 *
 * ## Why the two entries
 *
 * `plugin-shutdown-unregisters-connector.test.ts` (#10371) boots a REAL
 * `LiteKernel` with the REAL `AutomationServicePlugin` to prove that
 * `kernel.shutdown()` reaches `ConnectorOpenApiPlugin.destroy()` — the whole
 * point of that card is that the kernel calls `destroy()` and never called
 * `stop()`, so a stand-in kernel would assert nothing. Without these entries
 * both imports resolve through their packages' `exports` to **dist**, which
 * makes the test a verdict about build state rather than about the source in
 * the checkout — and the dangerous half of that is not a loud error but a test
 * that passes GREEN against a stale artifact with nothing in the output saying
 * so. `scripts/check-test-source-alias.mjs` carries the measured history
 * (#7668, #7778, #7849); it named these two imports and is the gate that fails
 * without the entries below.
 *
 * ⚠️ The registry in that script is SHRINK-ONLY, so widening
 * `KNOWN_UNALIASED_TEST_IMPORTS['@objectstack/connector-openapi']` was never an
 * option, and it is deliberately left untouched: its one remaining member,
 * `@objectstack/spec`, is still reached unaliased by this package's other test
 * files and stays that registry's problem to retire. Aliasing bare
 * `@objectstack/spec` here would additionally hit rule 5's ENOTDIR trap (its
 * subpaths would resolve through `…/spec/src/index.ts/<sub>`), which is why
 * only the two specifiers the gate actually named are added.
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    // Array form with ANCHORED patterns, per the trap the gate documents: the
    // object form matches by PREFIX, so a bare key whose replacement is a FILE
    // also swallows every subpath and resolves it to `…/index.ts/<sub>`
    // (`ENOTDIR`, at run time, in a config that looks right).
    alias: [
      {
        find: /^@objectstack\/core$/,
        replacement: path.resolve(__dirname, '../../core/src/index.ts'),
      },
      {
        find: /^@objectstack\/service-automation$/,
        replacement: path.resolve(__dirname, '../../services/service-automation/src/index.ts'),
      },
    ],
  },
});
