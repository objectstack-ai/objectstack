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
//
// ## WHY THERE IS STILL NO `test` BLOCK — the suite cost, measured (#10152)
//
// This package's suite was the largest single item on the Test Core critical
// path (548.6s / 474.4s in two `merge_group` runs), and the standing theory for
// suite cost in this repo — per-file module-graph re-execution under isolation,
// the proxy `scripts/partition-test-shards.mjs` weights by — predicted the
// cause would be import surface, which would have made a `test` block (`pool`,
// `isolate`) the lever. Measured on 2026-08-20, it is NOT that, and the
// measurement is recorded here because this file is where the next person
// looking for a lever will arrive.
//
// One machine, 4 cores, warm build, `npx vitest run --maxWorkers=2` per
// package, vitest 4.1.10. Both normalisers, because per-FILE cost alone cannot
// tell "expensive suite" from "more tests per file":
//
//   package                files  tests   tests/file   wall     s/file   s/test
//   @objectstack/cli         137   1498       10.9    495.81s   3.619   0.3310
//   @objectstack/spec        415  11045       26.6    325.31s   0.784   0.0295
//   …/service-automation      83    991       11.9     57.97s   0.698   0.0585
//   …/driver-turso            39   1003       25.7     38.50s   0.987   0.0384
//   @objectstack/client       23    314       13.7     23.75s   1.033   0.0756
//   …/example-showcase        21    342       16.3     31.15s   1.483   0.0911
//
// Normalising per TEST makes this package look worse, not better: it has the
// LOWEST tests-per-file of the six, so its 2.4-5.2x per-file cost becomes
// 3.6-11x per test. "It just has more tests per file" is falsified.
//
// The `Duration` split says where the cost is NOT:
//
//   cli      495.81s (transform 29.47s, setup 0ms, import 192.91s, tests 774.95s)
//   spec     325.31s (transform 13.79s, setup 0ms, import  63.90s, tests 456.36s)
//   svc-auto  57.97s (transform 14.54s, setup 0ms, import  96.78s, tests   4.73s)
//   turso     38.50s (transform 16.85s, setup 0ms, import  65.98s, tests   3.56s)
//   client    23.75s (transform 18.31s, setup 0ms, import  39.72s, tests   2.25s)
//
// Per file this package's import cost is 1.41s and its transform cost 0.215s —
// MID-BAND and LOWEST respectively (client 1.73s/file import, turso 1.69s).
// The wide dependency closure in `package.json` is not what the test files
// import. `setup` is 0ms everywhere, so setupFiles cost is not it either.
//
// The cost is test-body work, and it is concentrated, not uniform: median file
// 0.03s, 105 of 137 files under 2s, top 20 files = 87.7% of the wall. The 20
// files that spawn the real CLI as a subprocess (`bin/run-dev.js` through
// `tsx`, against a `mkdtemp` project) are 56.1% of the file wall (300.1s) while
// carrying 177 of 1498 tests. Each spawn re-executes the CLI's module graph in
// a COLD process, which is the standing theory after all — relocated out of
// vitest's worker, where neither its transform cache nor its module registry
// can reach it. Floor per spawn, doing nothing but printing a version:
//
//   tsx bin/run-dev.js --version   6.5-6.8s     (the source entry these use)
//   node bin/run.js --version      2.9-3.2s     (the built entry)
//   node -e 0                      0.031s       (process floor)
//
// ⚠️ Two levers were measured and both are rejected HERE, on this evidence:
//
//   `test: { maxWorkers: 4 }` — real but not ours to take. 2->4 workers on an
//   idle box is 495.81s -> 337.13s, but CPU is flat (user+sys 1291.3s ->
//   1256.2s) and per-file wall INFLATES (sum 535.1s -> 748.3s; longest file
//   74.3s -> 104.1s): the box is saturated, so this is packing, not work. In CI
//   the box is not this package's — `ci.yml` runs `turbo run test
//   --concurrency=4` — so pinning a worker count here spends cores belonging to
//   whatever else lands on the shard. Worker allocation is a property of the
//   shard, decided in `ci.yml`, not of this config (#10149).
//
//   `NODE_COMPILE_CACHE` for the spawned processes — measured 6.98/6.24/6.41/
//   6.18s cached vs 6.39/6.72s uncached, i.e. inside noise for 42MB of cache.
//   The per-spawn cost is module-graph EXECUTION, not compilation.
//
// So the work is real, the price is fair, and nothing contained in this package
// removes it without changing what the e2e tests assert. Swapping the spawns to
// the built entry would halve per-spawn boot and is exactly the source-vs-dist
// trade `scripts/check-test-source-alias.mjs` exists to refuse — see the note
// above on why a test that passes GREEN against a stale artifact is the
// dangerous outcome. Before adding a `test` block for speed, re-measure: if
// `tests` is still the dominant term, the block is not the lever.
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
