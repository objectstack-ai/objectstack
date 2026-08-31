// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// This package had NO vitest config until #9832, and that is the fact this
// header exists to keep visible: adding one changes how every test file in
// `packages/cli` is configured, not just the file that needed it. So the
// config is deliberately minimal — anchored `resolve.alias` entries and a
// `test` block that only carries keys with a recorded warrant (`server.deps`,
// and the #10374 console-intercept disarm), because the test files here run on
// vitest's defaults (`globals: false`, `environment: 'node'`) and re-specifying
// THOSE keys would silently flip them. Sibling configs in this repo do carry
// `test: { globals: true, … }`; copying that shape here would have flipped
// `globals` for every existing file in the package.
//
// ## Why the service-cache entry
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
// Measured again after: unchanged. ⚠️ The file/test COUNT that "unchanged" was
// checked against is deliberately not repeated here. This file used to carry
// this package's population in two separate sections; the two copies drifted
// apart and neither said which was current, so the population is now stated
// ONCE — with the commit it was measured on — in the suite-cost section below.
//
// ## Why the create-objectstack entry (#10557)
//
// `init.ts` prints its "Created files" summary from a walk of the finished
// project directory rather than a list accumulated while writing the
// template (see the command's own header) — reusing `create-objectstack`'s
// `created-summary.ts`, published as the `create-objectstack/created-summary`
// subpath so both scaffold paths share one renderer instead of drifting
// (#10499). Without an alias that bare specifier resolves through
// `create-objectstack`'s `exports` to its **dist**, for the same reason and
// the same danger as the entry above: a stale `dist/created-summary.js`
// would make every test that reaches `init.ts` a verdict about build state.
// `init.ts` is imported (relatively, inside this package) by three existing
// test files — `commands.test.ts`, `init.test.ts`,
// `init-scaffold-authoring-rules.test.ts` — so all three are reachable from
// this entry, none of them new; this alias just keeps them pointed at source.
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
// `isolate`) the lever. It is NOT that, and the measurement is recorded here
// because this file is where the next person looking for a lever will arrive.
//
// ⚠️ EVERY FIGURE BELOW COMES FROM ONE RUN ON ONE STATED COMMIT — 2f665a1af,
// re-measured 2026-08-26 (#12499). The first version of this section carried a
// DATE and no commit, and the population moved under it while the figures went
// on reading as precise: 137 files / 1498 tests had become 185 / 2115, and 20
// spawner files had become 39, before anyone checked. A date says when someone
// looked; a commit says WHAT they looked at, and only the second can be
// re-checked. Whoever re-measures next: print your commit here, and keep these
// counts in exactly one place in this file — a second copy is what rotted last
// time, because the two drifted and neither said which was current.
//
// PROTOCOL. One machine, 4 cores, warm build, one `vitest run --maxWorkers=2`
// per package, vitest 4.1.10 on node 22.22.2. ⚠️ Several agents share this
// container, so every run below held the shared heavy-verify lock
// (`scripts/pm/os-verify-lock.sh`): a suite timed beside a neighbour's build is
// a reading about the box, not about the suite.
//
// Contention actually seen, so the absolutes can be discounted honestly: three
// other agents were working this container. The `cli` run waited 4m01s for the
// lock behind a neighbour's build and then held it 13m14s; the five peer runs
// waited 7m03s and held 8m57s. The lock serialises LOCKED work only — a
// neighbour's UNLOCKED gate script was seen at ~130% CPU partway through the
// `cli` run — and 1-minute load averaged 4.36 (peak 6.97) on 4 cores across it.
// ⛔ Also part of the protocol: each package was measured against a tree with
// its own dependency closure BUILT. A package measured without one does not
// report a cheap wall, it fails loudly — `example-showcase` did, first time.
//
// ⚠️ WHICH OF THESE TRAVEL TO ANOTHER BOX. #11707 re-ran this section's
// absolutes elsewhere and they did NOT reproduce, while the ratio it cared
// about did. So: every figure in SECONDS here is box-dependent and comparable
// only inside this one run — the walls, s/file, s/test, the `Duration` split,
// the per-spawn floors. What a reader on another box should expect to reproduce
// are the RATIOS: tests/file, the top-20 concentration, the spawner share of
// the file wall, this package's multiple over its peers, and the ratio between
// the two spawn floors.
//
// Both normalisers, because per-FILE cost alone cannot tell "expensive suite"
// from "more tests per file":
//
//   package                files  tests   tests/file   wall     s/file   s/test
//   @objectstack/cli       185   2115       11.4   793.31s    4.288   0.3751
//   @objectstack/spec      432  11460       26.5   358.46s    0.830   0.0313
//   …/service-automation    91   1082       11.9    96.06s    1.056   0.0888
//   …/driver-turso          39   1006       25.8    33.89s    0.869   0.0337
//   @objectstack/client     25    346       13.8    18.74s    0.750   0.0542
//   …/example-showcase      26    364       14.0    32.94s    1.267   0.0905
//
// Normalising per TEST makes this package look WORSE, not better: it has the
// LOWEST tests-per-file of the six, so its 3.4-5.7x per-file cost becomes
// 4.1-12.0x per test. "It just has more tests per file" is falsified. ⚠️ Read
// the SHAPE of that check, not only its answer: the multiple has to WIDEN when
// the normaliser changes, and it does.
//
// The `Duration` split says where the cost is NOT:
//
//   cli       793.31s (transform 25.17s, setup 0ms, import 203.72s, tests 1353.09s)
//   spec      358.46s (transform 15.68s, setup 0ms, import  68.50s, tests  528.18s)
//   svc-auto   96.06s (transform 14.72s, setup 0ms, import 172.68s, tests    4.71s)
//   turso      33.89s (transform 14.13s, setup 0ms, import  56.93s, tests    3.62s)
//   client     18.74s (transform 10.91s, setup 0ms, import  30.15s, tests    2.38s)
//   showcase   32.94s (transform 16.68s, setup 0ms, import  48.76s, tests   12.78s)
//
// Per file this package's import cost is 1.10s and its transform cost 0.136s —
// SECOND-LOWEST of the six on BOTH; only `spec` is below it (0.16s import,
// 0.036s transform), and the tops are `service-automation` at 1.90s import and
// `example-showcase` at 0.642s transform. The wide dependency closure in
// `package.json` is not what the test files import. `setup` is 0ms in all six,
// so setupFiles cost is not it either — and that zero was checked against an
// instrument that can say otherwise: the same reporter, pointed at a
// deliberate 300ms setup file, reports it.
//
// The cost is test-body work, and it is concentrated, not uniform: median file
// 0.05s, 129 of 185 files under 2s, top 20 files = 71.3% of the file wall
// (965.3s of 1353.1s). "File wall" here is the sum of the per-module run
// durations, which is the SAME quantity vitest prints as the `tests` term
// above — said out loud so the two can be checked against each other instead of
// drifting apart, which is how this section went stale the first time.
//
// The 39 files that spawn the real CLI as a subprocess (against a `mkdtemp`
// project) are 89.4% of that file wall (1209.8s) while carrying 319 of the 2115
// tests — and they are the WHOLE of the top 20, all twenty of them. Each spawn
// re-executes the CLI's module graph in a COLD process, which is the standing
// theory after all — relocated out of vitest's worker, where neither its
// transform cache nor its module registry can reach it.
//
// ⚠️ THE SPAWNER SET MOVED IN BOTH DIRECTIONS AT ONCE, which is why the two
// shares here disagree with the 2026-08-20 pair in OPPOSITE directions: 20
// spawner files became 39, so the share of the wall they hold ROSE (56.1% ->
// 89.4%) while the top-20 concentration FELL (87.7% -> 71.3%) — the same kind
// of cost, spread across more files. Either number read alone tells the wrong
// story; the pair is the finding.
//
// ⚠️ COUNTING THE SPAWNERS: match the entry BASENAME, not `bin/run-dev.js`.
// Three of the 39 assemble the path from separate literals
// (`join(…, '..', 'bin', 'run-dev.js')`) and a slash-joined pattern misses all
// three — silently, since the answer it returns is still a plausible number.
// Prose mentions do not count either: at least one file names the entry four
// times while explicitly not spawning it.
//
// By entry point, after #11707 moved three files onto the built one:
//
//   35 files spawn `bin/run-dev.js` (source)   1169.2s   33.4s/file   311 tests
//    4 files spawn `bin/run.js`     (built)      40.6s   10.1s/file     8 tests
//
// ⛔ That is NOT a measurement of what the two entries cost. Those four are also
// the smallest files here — 2.0 tests/file against 8.9 — and per TEST the
// ordering REVERSES (5.1s vs 3.8s). File-level shares say where the wall sits,
// not what one spawn costs. What a spawn costs is measured directly, one spawn
// at a time, below.
//
// Floor per spawn, doing nothing but printing a version — 5 timed runs each
// after one discarded warm-up, box idle inside the lock:
//
//   tsx bin/run-dev.js --version   5.45-6.07s    (the source entry, 35 files)
//   node bin/run.js --version      2.46-2.66s    (the built entry, 4 files)
//   node -e 0                      0.025-0.031s  (process floor)
//
// ⚠️ The absolutes moved from the 2026-08-20 reading (6.5-6.8 / 2.9-3.2 /
// 0.031); the RATIO did not — source-over-built was 2.18x then and 2.21x here (means of the five runs each).
// That is the #11707 pattern exactly: carry the ratio to another box, never the
// seconds.
//
// ⛔ The exit code is PART of this measurement, not a formality. A nonexistent
// entry (`node bin/run-NOPE.js --version`, exit 1) returns in 0.030s — which
// reads as a better floor than anything real. Timing alone cannot tell "fast"
// from "never ran"; every row above was checked for exit 0.
//
// ⚠️ A port-selection change (#12441) was in flight on three of these spawner
// files (`serve-node-env-production-default`,
// `serve-app-anchored-optional-import`, `helpers/serve-process`) while this was
// measured. It changes which PORT a spawned `serve` binds, not which ENTRY is
// spawned, so the source-vs-built split above is unaffected by it; it can move
// wall times slightly. Recorded so the next reader can tell drift from noise.
//
// ⚠️ Two levers were measured and both are rejected HERE, on this evidence:
//
//   `test: { maxWorkers: 4 }` — real but not ours to take. 2->4 workers on this
//   box is 793.31s -> 565.86s, but CPU is FLAT (user+sys 2028.5s -> 1971.2s)
//   and per-file wall INFLATES (sum 1353.1s -> 1969.8s; longest file 94.0s ->
//   114.1s): the box is saturated, so this is packing, not work. Re-measured on
//   the commit above, and the 2026-08-20 verdict reproduced in every term. In CI
//   the box is not this package's — `ci.yml` runs `turbo run test
//   --concurrency=4` — so pinning a worker count here spends cores belonging to
//   whatever else lands on the shard. That OUTER fan-out — how many package
//   `test` tasks run at once — is a property of the shard, decided in `ci.yml`,
//   not of this config (#10149).
//
//   ⚠️ THE INNER POOL IS BOUNDED TOO, AND THE WORDING HERE USED TO DENY IT.
//   Vitest's own worker pool, inside THIS package's task, has had a host-sized
//   cap since #11958: the root `test` script and the CI test steps export
//   `VITEST_MAX_WORKERS` from `scripts/vitest-worker-cap.mjs`, which only ever
//   LOWERS vitest's own `cores - 1` default. ⛔ Their call sites are
//   deliberately NOT listed here — a list of call sites inside a package config
//   is the next thing to rot, and a citation that rotted is why this paragraph
//   exists. The script is single-source and carries its own reasoning.
//
//   ⭐ Worth keeping is WHY that omission was worse than a gap. The export sits
//   in the SAME `run:` block as the `--concurrency` flag quoted above, a few
//   lines earlier, under a comment explaining it. Saying "worker allocation is
//   decided in `ci.yml`" and then naming only the turbo flag sent the reader to
//   the exact place the cap lives and told them what they would find there — so
//   they walked past it, on the authority of this file. That is how a one-way
//   citation survives: the newer document points back at the older one, and
//   nobody re-reads the older one to check that it still holds.
//
//   ⚠️ The lever is also INERT wherever that variable is exported, not merely
//   unwise. Vitest applies the env var to the RESOLVED config, so it overwrites
//   a declared `maxWorkers` rather than being bounded by it. Observed on vitest
//   4.1.10 against a positive control: a `vitest.config.ts` declaring
//   `maxWorkers: 8` resolves to 8 with the variable unset, and to 2 under
//   `VITEST_MAX_WORKERS=2`. A pin added here would read as taken and change
//   nothing in exactly the runs that matter.
//
//   `NODE_COMPILE_CACHE` for the spawned processes — re-measured 5.15/5.34/
//   5.16/5.42s cached against 5.46/5.61/5.64/5.71s uncached, for 42MB of cache
//   (783 files). ⚠️ Unlike the 2026-08-20 reading, where the two sets
//   overlapped and the answer was "inside noise", these four-and-four do not
//   overlap: cached is consistently ~0.3s (~5%) faster. It is still not the
//   lever — that is an order of magnitude less than the 3.11s the built entry
//   already saves per spawn, and it buys 42MB to get it. The per-spawn cost is
//   module-graph EXECUTION, not compilation.
//
// So the work is real, the price is fair, and nothing contained in this package
// removes it without changing what the e2e tests assert.
//
// ## THE `test` BLOCK THAT NOW EXISTS, AND WHY IT IS NOT THE ONE REFUSED ABOVE
//
// #11775 added `test.server.deps.external`. Everything above still stands: the
// block deliberately sets NOTHING that has a default a test file can observe —
// no `globals`, no `environment`, no `pool`, no `isolate`, no `maxWorkers`. It
// is not a performance lever (the section above measured those and rejected
// them), and adding it changed no test's configuration except the resolution of
// one dependency.
//
// WHAT IT DOES. Vitest's default `server.deps.external` is `[/\/node_modules\//]`,
// evaluated against a module's REALPATH. A pnpm-linked workspace package's
// realpath is the package directory itself — `packages/types/dist/node.mjs` —
// which contains no `/node_modules/` segment, so every workspace dependency is
// INLINED, even one reached through `exports` to `dist/`. Vite then rewrites the
// `import()` written inside it to `__vite_ssr_dynamic_import__`, which resolves
// from the vitest root instead of from the module physically containing the
// call. Node ESM does the opposite: it anchors a bare specifier at the
// containing module. `@objectstack/types/node`'s `createHostImporter` EXISTS to
// resolve against a specific base, so under vitest it was measuring a base that
// had been flattened out from under it (#11412), and the entry below hands that
// call back to Node.
//
// ⚠️ THE PATTERN MUST MATCH THE REALPATH, AND A NAME-SHAPED ONE MATCHES NOTHING
// — SILENTLY. `/@objectstack[\/]types/` looks like the obvious spelling and is
// the trap: the realpath carries neither the package name nor `/node_modules/`,
// so that pattern matches zero modules and the experiment reads as
// "externalising does not help" rather than as "the pattern was wrong". #11775
// was first measured wrong for exactly that reason. Anything edited here needs a
// POSITIVE CONTROL that the pattern matches something — a pattern that matches
// nothing and a mechanism that does not work are indistinguishable from the
// outcome alone.
//
// ⚠️ IT DOES NOT FIGHT THE `resolve.alias` ENTRIES ABOVE, by construction.
// `resolve.alias` acts in the RESOLVE phase, so an aliased specifier is already
// an absolute `…/src/…` path before this predicate is consulted, and a `/dist/`
// pattern cannot match a `src/` path. That is not a coincidence to be preserved
// by care: `check:test-source-alias` FAILS any alias whose winning entry does
// not land under `src/`, so the gate that was assumed to be in tension with this
// entry is the same gate that keeps the two disjoint. Measured, not argued — see
// `test/vitest-resolution-base-collapse.e2e.test.ts`.
//
// COSTS, so the next person extending this list knows what they buy: an
// externalised package cannot be `vi.mock`ed and is not instrumented for
// coverage. Both were checked against this package when the entry landed —
// `packages/cli` has no `vi.mock` of `@objectstack/types` (its only mock targets
// are `../utils/optional-package.js`, `node:fs/promises` and
// `@objectstack/cloud-connection`) — but neither is free, and a package added
// here later must be re-checked for both.
//
// ## WHY THE SPAWN SWAP IS NOT THIS GATE'S TRADE TO REFUSE (#11707, #12460)
//
// This file used to close by calling a swap of the spawns to the built entry
// “exactly the source-vs-dist trade `scripts/check-test-source-alias.mjs`
// exists to refuse”. It is not one, and naming a gate for a verdict it never
// reaches reads as verification while verifying nothing. What that gate does
// measure: the specifiers written in `import` / `export … from` / `import()` /
// `require()` statements reachable from a package's test files, kept when they
// name a workspace dep whose own entry point resolves under `dist/`, then
// resolved through THIS config's `resolve.alias` table. That is a verdict about
// IN-PROCESS import resolution. It says nothing about which entry a test hands
// to `spawn()`, and its own header signs that second axis over to a different
// mechanism (“A SECOND resolution hazard, which this gate does NOT cover”,
// #11412). The `plugin-auth` entry below is this file's worked example: it
// satisfies the gate while being inert for the child, whose own `exports`
// lookup reaches `dist/` either way.
//
// So the swap was available, and #11707 took it — 2.06x faster in test time,
// measured there. Four files in `test/` consume `packages/cli/dist` today:
// `serve-node-env-production-default` (since #11113) and the three spawners
// #11707 moved onto `node bin/run.js` with `NODE_ENV` unset
// (`serve-mcp-stdio-answers`, `serve-mcp-capability-collision`,
// `serve-stdio-stdout-purity`). Re-running this gate on that commit and on its
// parent returns a byte-identical verdict AND a byte-identical measured
// population: it did not see the swap.
//
// What keeps those four honest is a declaration, not this gate. `turbo.json`
// declares `@objectstack/cli#test` `dependsOn: ["build"]` (#11268), so CI
// builds `dist/` before the suite runs, and each of the four refuses an unbuilt
// tree in a sentence of its own. The residual — a `dist/` merely BEHIND its
// source — is real, and those files state it. An in-process import has no such
// declaration standing behind it, which is why the alias entries above exist
// and why the gate does refuse THAT trade — see the note above on why a test
// that passes GREEN against a stale artifact is the dangerous outcome.
//
// Before adding a `test` block for speed, re-measure: if `tests` is still the
// dominant term, the block is not the lever.
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
      {
        find: /^create-objectstack\/created-summary$/,
        replacement: path.resolve(__dirname, '../create-objectstack/src/created-summary.ts'),
      },
      // `test/serve-node-env-production-default.e2e.test.ts` (#11113) writes a
      // FIXTURE config file whose text is `import { AuthPlugin } from
      // '@objectstack/plugin-auth'` — real code, but code the fixture's own
      // SPAWNED CHILD process resolves via bundle-require, never through this
      // Vite config. `check-test-source-alias` is a dependency-free text
      // reader (this file's own header explains why); it cannot tell that
      // occurrence apart from a real import in THIS file, and flags it as an
      // unaliased artifact import the same way it would a genuine one. This
      // entry satisfies the gate; it is inert for the actual e2e run (the
      // child's own dist/-resolving `exports` lookup is what that test
      // deliberately exercises — see the file's header for why testing the
      // BUILT artifact is the point there).
      {
        find: /^@objectstack\/plugin-auth$/,
        replacement: path.resolve(__dirname, '../plugins/plugin-auth/src/index.ts'),
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
    server: {
      deps: {
        external: [/packages[\/]types[\/]dist/],
      },
    },
  },
});
