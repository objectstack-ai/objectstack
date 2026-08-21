#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-test-source-alias — a unit test must be a verdict about the SOURCE in
// the checkout, never about a sibling package's build artifact.
//
// ── The defect this exists to make impossible (#7668, #7778, #7849) ─────────
//
// Every publishable package here resolves through `exports` to `dist/`
// (measured: 67 of 67 packages that declare an entry point at all). So when
// `packages/services/service-storage` ran `vitest` with no config, its
// `import { … } from '@objectstack/core'` followed the workspace link to
// `packages/core/dist/index.js` — A BUILD ARTIFACT. Every unit pin in that
// package was therefore reporting on build state, not on the source next to it.
//
// #7668 is what that cost: all 17 cases of `attachment-access-hooks.test.ts` —
// the only executable guard on the #4757 predicate-less unscoped-multi-delete
// refusal, which cannot be expressed over REST — errored with `TypeError:
// withoutOperationPrivateKeys is not a function` against a tree whose prebuilt
// core predated that export, while `packages/core/src/security/
// operation-private-keys.ts` had been correct the whole time.
//
// **The loud error is the mild half.** A dist merely BEHIND rather than missing
// the symbol lets a pin run GREEN against the dependency's old behaviour — a
// passing test that is not testing the code in the checkout, with nothing in
// the output saying so. That is the failure this gate is aimed at, and it is
// why "just run the tests and see" cannot find it.
//
// Ordering does not reach it. `turbo.json` declares `test` dependsOn `^build`,
// so `turbo run test` was never the failing path and needs no change. What
// breaks are the paths turbo does not mediate — `pnpm test` inside the package,
// `vitest run <file>`, an editor runner, or an agent working in a tree built at
// an older commit. Those are exactly the paths a pin is re-run on WHILE someone
// is changing the dependency, i.e. when it most needs to be telling the truth.
// Ordering cannot fix that; taking the artifact off the resolution path can.
//
// ── Why a gate and not a sweep ──────────────────────────────────────────────
//
// #7778 added the one missing config the incident named, and said explicitly
// that it was not sweeping. A sweep is the wrong terminal state anyway: it
// leaves the NEXT package unguarded, and the symptom of the omission is a green
// test, so nothing would report the gap. The invariant has to be asserted
// mechanically or it is not asserted at all.
//
// ── What this checks ────────────────────────────────────────────────────────
//
// For every workspace package that has test files:
//
//   1. Walk the imports REACHABLE FROM ITS TESTS — the test files plus every
//      file they pull in transitively — and collect the workspace packages they
//      import **as values**. `import type` is erased before the module ever
//      resolves, so it is not a hazard and is not counted. The walk follows
//      relative imports inside the package, and ALSO crosses into a dependency
//      the config aliases to source; "Where the walk goes" below says why, and
//      exactly what the crossing does and does not feed.
//   2. Keep only the deps that can actually go stale: the dep's own entry point
//      resolves under `dist/`. A dep whose `exports` already point at source
//      (the example apps' `objectstack.config.ts`) is not an artifact and needs
//      no alias — counting it would be a false positive the registry then has
//      to carry forever.
//   3. Read the package's `vitest.config.*` and resolve each of those
//      specifiers the way Vite does — entries in order, FIRST MATCH WINS,
//      string `find` matching by PREFIX and regex `find` by `String.replace`.
//      A dep whose winning entry lands under `src/` is safe. The replacement
//      is read statically, in the two spellings these configs use — a call
//      whose last argument is the path, and a template literal carrying a
//      `$1` back-reference inside it; `asPath` below states what that can and
//      cannot read, and why it does not evaluate the config.
//   4. Anything left is an unaliased artifact import, and the package must be
//      registered in `KNOWN_UNALIASED_TEST_IMPORTS` below with EXACTLY that
//      set. Unregistered ⇒ red.
//
// It also checks the trap #7778's notes name, which is a live-fire correctness
// rule rather than a style preference (rule 5 below): the OBJECT alias form
// matches by prefix, so a bare `'@objectstack/core'` key whose replacement is a
// FILE also swallows `@objectstack/core/logger` and resolves it to
// `…/core/src/index.ts/logger` — `ENOTDIR`, at run time, in a config that looks
// right. Because step 3 performs the real replacement, this gate sees the
// resulting path and fails on any specifier whose resolution passes THROUGH a
// file extension. Either anchor the pattern (`/^@objectstack\/core$/`, the
// array form) or list the subpath entry ahead of the bare one.
//
// ── Where the walk goes, and why it leaves the package (#8351) ──────────────
//
// **Aliasing a workspace dep to source imports that dep's ENTIRE import surface
// into the consumer's resolution domain.** The consumer's own files are then no
// longer the full list of specifiers its config has to resolve correctly — the
// aliased dep's source is loaded by the consumer's Vite, through the consumer's
// alias list, at the consumer's test time.
//
// A walk that stopped at the package boundary stopped one hop short of the
// domain it certifies, and that gap shipped: #7378 added a single runtime
// `import { pluralToSingular } from '@objectstack/spec/shared'` inside
// `packages/core/src/metadata-service-contract.ts`. This gate was GREEN on that
// diff. CI then went red in `@objectstack/plugin-hono-server` (16 test files
// dead at load) and `@objectstack/driver-memory` (23 dead) with rule 5's own
// signature — `ENOTDIR: not a directory, open '…/packages/spec/src/index.ts/
// shared'` — because both configs alias bare `@objectstack/spec` to a FILE and
// had no `/shared` entry above it. The specifier appears in no file of either
// failing package. It reached them purely because they alias `@objectstack/core`
// to source. Three more configs (`knowledge-ragflow`, `plugin-dev`,
// `knowledge-memory`) were latently identical and stayed green by luck of
// coverage, not by resolution.
//
// So the walk crosses the boundary into any dependency whose specifier THIS
// config resolves to a real source file, and keeps following — the domain
// extends exactly as far as the alias chain does, which is what run time does.
//
// ⚖️ The crossing feeds **rule 5 only** — the ENOTDIR check — never the
// unaliased-artifact ledger in `KNOWN_UNALIASED_TEST_IMPORTS`. That line is not
// squeamishness, it is what the two checks ARE:
//
//   - Rule 5 is a correctness verdict on the alias list the config already
//     wrote: an entry it declared mangles a specifier that will really be
//     resolved. Crossing finds more instances of the config's OWN defect, and
//     touches no registry.
//   - The ledger is a coverage measurement of which deps a package has not yet
//     aliased. Feeding it transitive surface would silently re-scope it from
//     "what this package's code imports" to "what it imports plus everything
//     every aliased dep's source imports" — re-measuring all 60+ entries of a
//     set-equality-audited, SHRINK-ONLY registry as a side effect of a walk
//     change. That is a different card, and it must not arrive disguised as
//     this one.
//
// Consequences of that line, stated so they are not rediscovered as bugs: a
// specifier collected across the boundary that resolves to `dist/`, or that no
// alias matches at all, is NOT reported here. The staleness half of the
// cross-boundary domain remains unmeasured.
//
// Crossing is deliberately gated on the alias landing on a file that EXISTS.
// An alias into `dist/` is not crossed (there is no source graph there, and the
// artifact need not exist in a bare checkout); neither is one whose replacement
// this file's static reader cannot turn into a real path. Both are silent, and
// both are the fail-open direction — accepted because the alternative is a gate
// that cannot run on a checkout it does not fully understand, and because the
// same configs are already read fail-closed by step 3 for every specifier the
// consumer writes itself.
//
// ── The latent half: PUBLISHED subpaths, judged without waiting (#9674) ─────
//
// Rule 5 above waits for a specifier to be REACHED — by this package's own
// files or, since #8351, by an aliased dependency's source. That is the right
// domain for a verdict about what a suite resolves TODAY, and it is why the
// gate stayed green over eleven mangled (config, subpath) pairs: seven configs
// alias bare `@objectstack/core` with no `/logger` entry, four alias bare
// `@objectstack/types` with no `/node` entry, and no test graph had reached
// either specifier yet. Nothing was wrong with rule 5; the pairs were simply
// outside the question it asks.
//
// So there is a second, reachability-INDEPENDENT rule, and its population comes
// from the DEPENDENCY rather than from any import: every subpath a workspace
// package PUBLISHES in its own `exports` map is resolved through every config's
// alias table, and a resolution that passes through a file extension fails.
// A table is then judged on what it would do, not on what a test has happened
// to ask it for — which is the difference between a gate and a coincidence.
//
// Two boundaries, stated so they are not rediscovered as bugs:
//
//   - It checks only the THROUGH-A-FILE shape, never "does this land on an
//     existing file". `asPath` reads a replacement as a FRAGMENT (see its
//     notes), so the template spelling `path.join(path.resolve(__dirname,
//     '../..'), 'spec/src/$1/index.ts')` cannot be turned into an absolute path
//     here at all; requiring existence would report every config using it. The
//     through-a-file shape needs no filesystem and no base directory — it is a
//     property of the string the alias produces.
//   - It therefore cannot see a namespace-capture rule misrouting a FILE-shaped
//     subpath (`@objectstack/core/logger` → `src/logger/index.ts`): that result
//     still reads as source. It is the reason the fix for `core` and `types` is
//     an enumerated subpath entry rather than one capture rule, and the reason
//     their bare entries stay PREFIX matches: a published subpath this table
//     does not list resolves through a file, which this rule reads statically
//     and run time reports loudly. Anchoring the bare entry instead would send
//     it silently to `dist/` — the vacuous-green direction this whole file
//     exists to refuse.
//
// ── The clocked-window rule: pay the first load at module top (#10126) ──────
//
// The registry above names the deps a package's tests still resolve through
// `dist/`. Loading one of those is not free — it is a cold vite transform of
// that dependency's whole module graph — and WHERE a test pays it decides
// whether the suite is measuring behaviour or measuring a compiler.
//
// `dev-plugin-security-enforcement-warning.test.ts` paid the
// `@objectstack/plugin-security` transform inside a clocked window: first in
// whichever `it()` ran first (3.1-3.6s idle on 4 vCPU, ~70% of the 5000ms
// `testTimeout`), then — after a fix that only widened the window — inside a
// `beforeAll` (`hookTimeout` 10000ms). On a merge-queue shard, which runs the
// FULL suite where PR-side CI runs only the affected subset, the same load hit
// 20.26s. Cost: `Test timed out in 5000ms` / `Hook timed out in 10000ms` on 30
// queue builds in 24h, `main` frozen 2h+, three innocent PRs ejected, and the
// first fix PR ejected twice by the very test it was fixing (#10115, PR #10120,
// #10112).
//
// Every budget the cost is moved INTO can be exhausted by a heavier shard. The
// fix is to move it OUT: a module-top `import '<specifier>'` is paid during
// COLLECTION, and collection is clocked against nothing. Verified in PR #10120
// against the installed runner rather than recalled — `@vitest/runner@4.1.10`
// wraps exactly hooks and test bodies in `withTimeout(...)`, while
// `collectTests()` awaits `runner.importFile(filepath, 'collect')` bare and
// merely RECORDS `file.collectDuration` for reporters; and vitest offers exactly
// three timeout knobs (`testTimeout`, `hookTimeout`, `teardownTimeout`), none of
// which covers module loading.
//
// So: a test file that loads one of ITS package's unaliased specifiers through a
// dynamic `import()` / `require()` **inside a function body** — an `it()`/`test()`
// body, a `beforeAll`/`beforeEach`/`afterAll` hook, or any nested function —
// with no module-scope load of the same specifier is a finding, reported against
// the test file.
//
// The convention, in one sentence: **clocked windows measure behaviour, never
// loading — a test that boots a real plugin chain pays its first load at module
// top.** It is stated for authors in AGENTS.md § Build & Test, beside the sibling
// test-gate conventions, and repeated in this gate's own failure text — where it
// is pinned by a self-test assertion, so it cannot decay back into a comment that
// no author tripping the rule ever reads.
//
// Getting it into that file took the one raise `scripts/pm/check-skill-line-
// ratchet.mjs` has granted: AGENTS.md sat exactly on its shrink-only ceiling of
// 958 with the sentence costing three lines and its section carrying two lines of
// lossless rewrap headroom, so it could not be paid for in place. Maintainer
// ruling 2026-08-20, verbatim and untranslated: 「A — 抬上限到 961 (Recommended)」.
//
// Boundaries, stated so they are not rediscovered as bugs:
//
//   - **Compliance is a MODULE-SCOPE load, which is wider than "a static
//     import".** A static `import`/`export … from` is the spelling to write and
//     the one the remedy prints. But a dynamic `import()` at module scope (top-
//     level await) is paid during collection too, by the same measurement above,
//     so flagging it would be inventing a failure. Both are accepted; a
//     type-only clause is accepted as NEITHER, since it never resolves.
//   - `typeof import('x')` is a TYPE QUERY, erased before anything loads. Never
//     a finding, and never a compliance token either.
//   - The population is the specifiers THIS package really resolves through
//     `dist/` — the same measurement `KNOWN_UNALIASED_TEST_IMPORTS` mirrors, at
//     specifier granularity. A dep already aliased to source still costs a
//     transform, and paying it in a hook is still a bad idea; it is simply not
//     what this gate measures, and widening the population is a different card.
//   - "Inside a function body" is decided by a brace scanner over the source
//     with comments and string/template/regex CONTENT masked out (the same
//     `scanSource` projection the alias reader uses). It reads `=> {`, and a `)`
//     that is not preceded by `if`/`for`/`while`/`switch`/`catch`/`with`/`await`,
//     as opening a function body, walking back over a return-type annotation
//     (`): Promise< T > {`) to find it. A brace it cannot classify reads as NOT a
//     function — the silent direction, chosen because the loud one would fail
//     tests over a parse this file cannot afford to get right (see `asPath` for
//     why evaluating instead of reading was rejected).
//
// ── The registry, and why it is shaped like this ────────────────────────────
//
// `KNOWN_UNALIASED_TEST_IMPORTS` is the measured state of the repo on the day
// this gate landed. It is **shrink-only**: entries come off as packages are
// fixed, and a new one is not the way to make a red build green — aliasing the
// import is. It is audited in BOTH directions, like `UNRESOLVED_ADR_CITATIONS`
// in `check-adr-anchors.mjs`, so it cannot rot into a permanent grandfather
// clause: a package that no longer needs its entry FAILS, naming the entry to
// delete.
//
// Each entry carries the exact set of dependencies that are currently
// unaliased, and the audit demands set EQUALITY. That is the same decision as
// "no numeric ceiling", applied one level down. A bare list of package names
// would license a listed package to acquire ten NEW artifact imports with
// nothing going red — silent regression headroom, which is precisely what
// #7888 records the type-check DEBT ledger paying for (273 raw errors of
// licensed headroom across 9 entries, every one of them invisible). There is no
// count anywhere in this file and no allowance to regress under: an entry
// states which imports are unaliased today, and any drift in either direction
// is a red gate naming the one-line edit.
//
// ⛔ Two things this gate deliberately does NOT do:
//   - It does not add or edit any package's `vitest.config.*`. Remediation is
//     per-package and lands as its own card; the point of the gate is that the
//     list of cards is finite and cannot grow behind anyone's back.
//   - It does not fail a package for having NO config. A package with tests
//     that imports no stale-able workspace dep needs no alias and no config,
//     and demanding one would be cargo cult. The predicate is the import, not
//     the file.
//
// Usage:
//   node scripts/check-test-source-alias.mjs
//   node scripts/check-test-source-alias.mjs --list      # measured state, registry-shaped
//   node scripts/check-test-source-alias.mjs --self-test

import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { stripComments, scanSource, blank } from './js-comment-mask.mjs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import process from 'node:process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/**
 * Packages whose test-reachable code imports a workspace package that resolves
 * to `dist/`, with no vitest alias redirecting it to source — i.e. packages
 * whose unit verdicts are currently a function of build state.
 *
 * MEASURED, not curated: this is what `--list` printed on the day the gate
 * landed. Each value is the exact set of unaliased artifact imports for that
 * package.
 *
 * ⛔ SHRINK-ONLY. Adding an entry, or widening one, is not how a red build gets
 * fixed — add the alias to that package's `vitest.config.*` instead (anchored
 * regex / array form; see the header). Entries are audited in both directions,
 * so one that is no longer needed fails the gate and names itself for deletion.
 */
const KNOWN_UNALIASED_TEST_IMPORTS = {
  '@objectstack/cli': [
    '@objectstack/account', '@objectstack/client', '@objectstack/cloud-connection', '@objectstack/core',
    '@objectstack/driver-sql', '@objectstack/driver-turso', '@objectstack/lint', '@objectstack/mcp',
    '@objectstack/metadata', '@objectstack/metadata-protocol', '@objectstack/objectql',
    '@objectstack/observability', '@objectstack/platform-objects', '@objectstack/plugin-email',
    '@objectstack/plugin-hono-server', '@objectstack/plugin-security', '@objectstack/rest',
    '@objectstack/runtime', '@objectstack/service-automation', '@objectstack/service-datasource',
    '@objectstack/service-settings', '@objectstack/service-sms', '@objectstack/service-storage',
    '@objectstack/setup', '@objectstack/spec', '@objectstack/types', '@objectstack/verify',
  ],
  '@objectstack/client': [
    '@objectstack/core', '@objectstack/driver-sqlite-wasm', '@objectstack/objectql',
    '@objectstack/plugin-hono-server', '@objectstack/runtime', '@objectstack/spec',
  ],
  '@objectstack/client-react': ['@objectstack/client', '@objectstack/spec'],
  '@objectstack/cloud-connection': [
    '@objectstack/core', '@objectstack/runtime', '@objectstack/spec', '@objectstack/types',
  ],
  '@objectstack/connector-mcp': ['@objectstack/core', '@objectstack/service-automation', '@objectstack/spec'],
  '@objectstack/connector-openapi': ['@objectstack/spec'],
  '@objectstack/connector-rest': [
    '@objectstack/core', '@objectstack/service-automation', '@objectstack/spec',
  ],
  '@objectstack/connector-slack': [
    '@objectstack/core', '@objectstack/service-automation', '@objectstack/spec',
  ],
  '@objectstack/core': ['@objectstack/metadata-core', '@objectstack/spec'],
  '@objectstack/dogfood': [
    '@objectstack/cli', '@objectstack/connector-mcp', '@objectstack/connector-openapi',
    '@objectstack/connector-rest', '@objectstack/core', '@objectstack/driver-sql',
    '@objectstack/driver-sqlite-wasm', '@objectstack/mcp', '@objectstack/metadata', '@objectstack/objectql',
    '@objectstack/platform-objects', '@objectstack/plugin-audit', '@objectstack/plugin-auth',
    '@objectstack/plugin-email', '@objectstack/plugin-security', '@objectstack/plugin-webhooks',
    '@objectstack/service-analytics', '@objectstack/service-messaging', '@objectstack/service-storage',
    '@objectstack/spec', '@objectstack/types', '@objectstack/verify',
  ],
  '@objectstack/driver-mongodb': [
    '@objectstack/core', '@objectstack/objectql', '@objectstack/spec', '@objectstack/types',
  ],
  '@objectstack/driver-sql': ['@objectstack/formula', '@objectstack/observability', '@objectstack/types'],
  '@objectstack/driver-sqlite-wasm': [
    '@objectstack/core', '@objectstack/driver-sql', '@objectstack/formula', '@objectstack/spec',
  ],
  '@objectstack/driver-turso': [
    '@objectstack/core', '@objectstack/driver-sql', '@objectstack/spec', '@objectstack/verify',
  ],
  '@objectstack/example-crm': ['@objectstack/driver-sql', '@objectstack/objectql', '@objectstack/spec'],
  '@objectstack/example-embed-objectql': [
    '@objectstack/driver-memory', '@objectstack/objectql', '@objectstack/spec',
  ],
  // #8990 / PR #9280 — `@objectstack/formula` came OUT of this entry (a shrink) when
  // `test/action-predicate-sparse-face.test.ts` gained the vitest source alias: that
  // test evaluates this app's authored predicates on the CEL engine, so a `dist`
  // merely BEHIND would run it green against the engine's old null/absence semantics —
  // exactly the behaviour those assertions exist to pin. Same pair examples/app-crm
  // moved through on PR #9166.
  '@objectstack/example-showcase': [
    '@objectstack/cloud-connection', '@objectstack/connector-mcp', '@objectstack/connector-openapi',
    '@objectstack/connector-rest', '@objectstack/connector-slack', '@objectstack/core',
    '@objectstack/driver-sql', '@objectstack/objectql',
    '@objectstack/plugin-approvals', '@objectstack/runtime', '@objectstack/service-automation',
    '@objectstack/service-datasource', '@objectstack/service-messaging', '@objectstack/spec',
  ],
  '@objectstack/example-todo': [
    '@objectstack/core', '@objectstack/driver-sqlite-wasm', '@objectstack/objectql',
    '@objectstack/service-automation', '@objectstack/spec', '@objectstack/trigger-record-change',
  ],
  '@objectstack/formula': ['@objectstack/spec'],
  '@objectstack/hono': ['@objectstack/types'],
  '@objectstack/http-conformance': [
    '@objectstack/core', '@objectstack/driver-sqlite-wasm', '@objectstack/objectql',
    '@objectstack/plugin-hono-server', '@objectstack/runtime',
  ],
  '@objectstack/lint': ['@objectstack/formula', '@objectstack/sdui-parser', '@objectstack/spec'],
  '@objectstack/mcp': [
    '@objectstack/core', '@objectstack/formula', '@objectstack/spec', '@objectstack/types',
  ],
  '@objectstack/metadata': [
    '@objectstack/driver-sqlite-wasm', '@objectstack/metadata-core', '@objectstack/metadata-fs',
  ],
  '@objectstack/metadata-core': ['@objectstack/spec'],
  '@objectstack/metadata-fs': ['@objectstack/metadata-core'],
  '@objectstack/metadata-protocol': [
    '@objectstack/core', '@objectstack/formula', '@objectstack/lint', '@objectstack/metadata',
    '@objectstack/metadata-core', '@objectstack/spec', '@objectstack/types',
  ],
  '@objectstack/objectql': [
    '@objectstack/core', '@objectstack/formula', '@objectstack/metadata', '@objectstack/metadata-core',
    '@objectstack/metadata-protocol', '@objectstack/spec', '@objectstack/types',
  ],
  '@objectstack/platform-objects': [
    '@objectstack/core', '@objectstack/formula', '@objectstack/metadata-core', '@objectstack/spec',
  ],
  '@objectstack/plugin-approvals': [
    '@objectstack/core', '@objectstack/driver-sql', '@objectstack/formula', '@objectstack/objectql',
    '@objectstack/platform-objects', '@objectstack/service-automation', '@objectstack/spec',
    '@objectstack/trigger-record-change', '@objectstack/types',
  ],
  '@objectstack/plugin-audit': ['@objectstack/objectql'],
  '@objectstack/plugin-auth': [
    '@objectstack/core', '@objectstack/driver-sql', '@objectstack/objectql',
    '@objectstack/platform-objects', '@objectstack/rest', '@objectstack/spec', '@objectstack/types',
  ],
  '@objectstack/plugin-dev': [
    '@objectstack/driver-memory', '@objectstack/objectql', '@objectstack/plugin-auth',
    '@objectstack/plugin-hono-server', '@objectstack/rest',
    '@objectstack/runtime', '@objectstack/service-i18n', '@objectstack/service-realtime',
    '@objectstack/service-storage',
  ],
  '@objectstack/plugin-email': [
    '@objectstack/core', '@objectstack/formula', '@objectstack/objectql', '@objectstack/platform-objects',
    '@objectstack/service-queue', '@objectstack/service-settings', '@objectstack/spec',
  ],
  '@objectstack/plugin-hono-server': ['@objectstack/types'],
  '@objectstack/plugin-pinyin-search': ['@objectstack/objectql', '@objectstack/types'],
  '@objectstack/plugin-reports': [
    '@objectstack/core', '@objectstack/driver-sql', '@objectstack/objectql',
    '@objectstack/platform-objects',
  ],
  '@objectstack/plugin-security': [
    '@objectstack/core', '@objectstack/formula', '@objectstack/metadata-core',
    '@objectstack/platform-objects', '@objectstack/plugin-sharing', '@objectstack/service-i18n',
    '@objectstack/spec',
  ],
  '@objectstack/plugin-sharing': [
    '@objectstack/core', '@objectstack/formula', '@objectstack/objectql', '@objectstack/platform-objects',
    '@objectstack/spec', '@objectstack/types',
  ],
  '@objectstack/plugin-webhooks': [
    '@objectstack/metadata-core', '@objectstack/objectql', '@objectstack/service-messaging',
    '@objectstack/spec',
  ],
  '@objectstack/rest': [
    '@objectstack/core', '@objectstack/driver-sql', '@objectstack/metadata', '@objectstack/metadata-core',
    '@objectstack/metadata-protocol', '@objectstack/objectql', '@objectstack/observability',
    '@objectstack/platform-objects', '@objectstack/plugin-security', '@objectstack/service-analytics',
    '@objectstack/spec', '@objectstack/types',
  ],
  '@objectstack/runtime': [
    '@objectstack/driver-memory', '@objectstack/driver-sql', '@objectstack/driver-sqlite-wasm',
    '@objectstack/metadata', '@objectstack/metadata-core', '@objectstack/metadata-protocol',
    '@objectstack/objectql', '@objectstack/observability', '@objectstack/plugin-auth',
    '@objectstack/plugin-hono-server', '@objectstack/plugin-security', '@objectstack/plugin-sharing',
    '@objectstack/service-analytics', '@objectstack/service-cluster', '@objectstack/service-datasource',
    '@objectstack/service-messaging',
  ],
  '@objectstack/service-analytics': [
    '@objectstack/core', '@objectstack/driver-sql', '@objectstack/driver-sqlite-wasm', '@objectstack/spec',
    '@objectstack/types',
  ],
  '@objectstack/service-automation': [
    '@objectstack/core', '@objectstack/driver-sql', '@objectstack/formula', '@objectstack/metadata-core',
    '@objectstack/objectql', '@objectstack/plugin-security', '@objectstack/service-job',
    '@objectstack/service-messaging', '@objectstack/spec',
  ],
  // `@objectstack/core` came off when the import reader started stripping
  // comments (#8351): this package's only non-`import type` mention of it is a
  // JSDoc usage example in `cache-service-plugin.ts`. Prose, not resolution.
  '@objectstack/service-cache': ['@objectstack/observability'],
  '@objectstack/service-cluster': ['@objectstack/spec'],
  '@objectstack/service-cluster-redis': ['@objectstack/service-cluster'],
  '@objectstack/service-datasource': [
    '@objectstack/driver-memory', '@objectstack/driver-sql', '@objectstack/driver-sqlite-wasm',
    '@objectstack/plugin-hono-server', '@objectstack/spec', '@objectstack/types',
  ],
  '@objectstack/service-i18n': ['@objectstack/core', '@objectstack/spec', '@objectstack/types'],
  '@objectstack/service-job': ['@objectstack/metadata-core', '@objectstack/platform-objects'],
  '@objectstack/service-knowledge': ['@objectstack/objectql'],
  '@objectstack/service-messaging': [
    '@objectstack/driver-sql', '@objectstack/metadata-core', '@objectstack/objectql',
    '@objectstack/platform-objects', '@objectstack/spec', '@objectstack/types',
  ],
  '@objectstack/service-package': ['@objectstack/metadata-core'],
  '@objectstack/service-queue': ['@objectstack/objectql', '@objectstack/platform-objects'],
  '@objectstack/service-realtime': ['@objectstack/spec'],
  '@objectstack/service-sms': ['@objectstack/plugin-auth', '@objectstack/service-settings'],
  '@objectstack/service-storage': [
    '@objectstack/objectql', '@objectstack/observability', '@objectstack/platform-objects',
    '@objectstack/spec', '@objectstack/types',
  ],
  '@objectstack/trigger-record-change': [
    '@objectstack/core', '@objectstack/driver-sql', '@objectstack/objectql',
    '@objectstack/service-automation',
  ],
  '@objectstack/trigger-schedule': ['@objectstack/service-automation', '@objectstack/spec'],
  '@objectstack/types': ['@objectstack/spec'],
  '@objectstack/verify': [
    '@objectstack/objectql', '@objectstack/platform-objects', '@objectstack/plugin-auth',
    '@objectstack/plugin-hono-server', '@objectstack/plugin-security', '@objectstack/plugin-sharing',
    '@objectstack/rest', '@objectstack/runtime', '@objectstack/service-analytics',
    '@objectstack/service-automation', '@objectstack/service-datasource', '@objectstack/service-settings',
    '@objectstack/spec', '@objectstack/types',
  ],
};

// ── workspace enumeration ───────────────────────────────────────────────────

/** Directory globs from pnpm-workspace.yaml, which are all `<dir>/*`. */
const WORKSPACE_PARENT_DIRS = [
  'packages',
  'packages/apps',
  'packages/adapters',
  'packages/connectors',
  'packages/drivers',
  'packages/plugins',
  'packages/qa',
  'packages/services',
  'packages/triggers',
  'apps',
  'examples',
];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.turbo', '.next', '.cache']);
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
/** A path that continues PAST a file extension — `…/index.ts/logger`. */
const THROUGH_A_FILE = /\.[cm]?[jt]sx?[\\/]/;

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function listWorkspacePackages(root) {
  const out = [];
  for (const parent of WORKSPACE_PARENT_DIRS) {
    const abs = join(root, parent);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) {
      const dir = join(abs, name);
      const manifest = join(dir, 'package.json');
      if (!existsSync(manifest)) continue;
      let json;
      try {
        json = readJson(manifest);
      } catch {
        continue;
      }
      if (!json.name) continue;
      out.push({ name: json.name, dir, rel: relative(root, dir), json });
    }
  }
  return out;
}

/**
 * Does importing this package land on a build artifact? Every entry point it
 * declares is inspected: if any of them points under `dist/`, a stale build can
 * decide a consumer's verdict.
 */
function resolvesToArtifact(json) {
  const targets = JSON.stringify([json.main ?? '', json.module ?? '', json.types ?? '', json.exports ?? '']);
  return /(^|[^a-z])dist\//.test(targets);
}

/**
 * The subpath specifiers a package PUBLISHES, read from its own `exports` map —
 * the population of the reachability-independent rule (see the header).
 *
 * `./package.json` is dropped (a manifest is not a module), and so is any
 * pattern key: `./*` names a set no static reader can enumerate, and inventing
 * a member of it would be exactly the fabricated path `remediationHint` refuses
 * to print. A package with no `exports` map publishes no subpath at all.
 */
function publishedSubpaths(json, name) {
  const map = json.exports;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
  return Object.keys(map)
    .filter((key) => key.startsWith('./') && key !== './package.json' && !key.includes('*'))
    .map((key) => name + key.slice(1));
}

function walkFiles(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkFiles(path, acc);
    } else if (entry.isFile()) {
      acc.push(path);
    }
  }
  return acc;
}

// ── import extraction ───────────────────────────────────────────────────────

const IMPORT_PATTERNS =
  /(?:^|[\s;})])(?:import|export)\s+([\s\S]*?)\s*from\s*['"]([^'"]+)['"]|(?:^|[\s;{(=,])import\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[\s;{(=,])require\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[\s;}])import\s+['"]([^'"]+)['"]/g;

/**
 * Every module specifier the file loads AT RUNTIME, with type-only imports
 * dropped: `import type { X } from 'y'` and `import { type X } from 'y'` are
 * erased before anything resolves, so they cannot read a stale artifact.
 *
 * Comments are stripped first, for the reason `stripComments` was written for
 * configs one level down — and this half was measured, not assumed. Source here
 * carries long rationale comments that NAME specifiers, and `packages/spec/
 * src/index.ts` opens with a JSDoc code fence demonstrating the subpath import
 * styles:
 *
 *     * import * as UI from '@objectstack/spec/ui';
 *
 * Read as code, that is an import of `@objectstack/spec/ui` by every consumer
 * that aliases `@objectstack/spec` to source — and once the walk crosses the
 * package boundary (#8351) it is an ENOTDIR failure reported against nine
 * configs, for a specifier no file anywhere actually imports. Documentation is
 * not a resolution hazard.
 *
 * ⚠️ What this still OVER-counts, measured: a namespace or named import with no
 * `type` keyword whose bindings are all used in TYPE positions is elided by
 * esbuild exactly as `import type` is, and so never resolves either. It is
 * counted here anyway — telling them apart needs a type-aware parser, and this
 * gate is deliberately a dependency-free text reader (see `asPath`).
 * `packages/core/src/qa/adapter.ts` writes `import * as QA from
 * '@objectstack/spec/qa'` and uses `QA.` only in annotations; a live probe
 * through vitest confirmed `import('@objectstack/core')` loads clean under a
 * config with no `/qa` alias, while `import('@objectstack/spec/qa')` under that
 * same config raises `ENOTDIR … spec/src/index.ts/qa`. So such a finding is
 * LATENT rather than currently-red: the alias really is missing and the config
 * really would mangle the specifier — it is one value-use away from breaking,
 * and it is being held green by type erasure, not by resolution. Reporting it
 * is the fail-closed direction and the remediation (one alias entry) is correct
 * either way, but it is not evidence that a suite is failing today.
 */
function extractRuntimeImports(text) {
  const specs = [];
  const code = stripComments(text);
  IMPORT_PATTERNS.lastIndex = 0;
  let match;
  while ((match = IMPORT_PATTERNS.exec(code))) {
    const clause = match[1];
    const spec = match[2] ?? match[3] ?? match[4] ?? match[5];
    if (!spec) continue;
    if (clause != null && isTypeOnlyClause(clause)) continue;
    specs.push(spec);
  }
  return specs;
}

function isTypeOnlyClause(clause) {
  const trimmed = clause.trim();
  if (/^type\b/.test(trimmed)) return true;
  const braced = trimmed.match(/^\{([\s\S]*)\}$/);
  if (!braced) return false;
  const names = braced[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return names.length > 0 && names.every((n) => /^type\s/.test(n));
}

// ── module-scope vs clocked-window load position (#10126) ───────────────────

/**
 * Keywords whose `(…)` is a control header rather than a parameter list, so the
 * `{` after it opens a BLOCK and not a function body. `await` is here for
 * `for await (const x of y) {`, whose `(` is preceded by that word.
 */
const CONTROL_HEADS = new Set(['if', 'for', 'while', 'switch', 'catch', 'with', 'await']);

/** `typeof import('x')` — a type query, erased before anything resolves. */
const TYPE_QUERY_BEFORE = /\btypeof\s*$/;

/**
 * Two same-length projections of one source, so a byte offset means the same
 * thing in both: `commentsOnly` keeps every string intact (the import regex has
 * to read the specifier), `codeOnly` masks literal CONTENT as well (the brace
 * scanner must not count a `{` inside a string or a template).
 */
function maskedProjections(source) {
  const { comment, literal } = scanSource(source);
  const both = new Uint8Array(source.length);
  for (let i = 0; i < source.length; i++) both[i] = comment[i] || literal[i] ? 1 : 0;
  return { commentsOnly: blank(source, comment), codeOnly: blank(source, both) };
}

/**
 * The `<` matching a closing `>`, for a return-type annotation. -1 if none.
 *
 * Balanced groups inside the argument list are jumped through `openOf` rather
 * than scanned: `Promise< { app: A; wiring: B } >` carries both braces and
 * semicolons, and a scanner that bailed on either read a real function signature
 * as "not a function". Measured — that spelling is what
 * `serve-marketplace-offline-runtime-config.test.ts` writes, and it was silently
 * exempting the file until an ablation of this classifier surfaced it. Newlines
 * are not a boundary either: these signatures routinely span lines.
 */
function matchingAngle(code, closeIndex, openOf) {
  let depth = 0;
  for (let i = closeIndex; i >= 0; i--) {
    const c = code[i];
    if (c === '>') {
      if (i > 0 && code[i - 1] === '=') {
        i--; // `=>` inside a function TYPE — an arrow, not a generic closer
        continue;
      }
      depth++;
      continue;
    }
    if (c === '<') {
      depth--;
      if (depth === 0) return i;
      continue;
    }
    if (c === '}' || c === ']' || c === ')') {
      const open = openOf.get(i);
      if (open == null) return -1;
      i = open;
      continue;
    }
    if (c === ';' || c === '{' || c === '[' || c === '(') return -1;
  }
  return -1;
}

/**
 * Does the `{` at `braceIndex` open a FUNCTION BODY (as opposed to a block, an
 * object literal, a class/interface body, or a `case` label's block)?
 *
 * Answered from the text before it, in the masked projection: `=> {` is an arrow
 * body; a `)` whose head word is not a control keyword is a parameter list; and
 * a return-type annotation may sit between the two (`): void {`,
 * `): Promise< T > {`, `): { ok: true } {`), so the walk steps back over one.
 *
 * `openOf` carries the `(`/`[`/`{` matching each closer, collected by the same
 * forward pass that calls this — matching backwards would have to re-answer
 * "is this quote inside a string" that the projection already answered.
 */
function opensFunctionBody(code, braceIndex, openOf) {
  let j = braceIndex - 1;
  const skipSpace = () => {
    while (j >= 0 && /\s/.test(code[j])) j--;
  };
  skipSpace();
  for (let guard = 0; guard < 8 && j >= 0; guard++) {
    const c = code[j];
    if (c === '>' && j > 0 && code[j - 1] === '=') return true; // `=> {`
    if (c === ')') break;
    if (c === '}' || c === ']') {
      const open = openOf.get(j);
      if (open == null) return false;
      j = open - 1;
      skipSpace();
      continue;
    }
    if (c === '>') {
      const open = matchingAngle(code, j, openOf);
      if (open < 0) return false;
      j = open - 1;
      skipSpace();
      continue;
    }
    if (c === ':') {
      // The `:` introducing a return-type annotation, reached after stepping
      // back over an object or array type (`): { ok: true } {`). A `case`/label
      // colon falls out below, on the token in front of it.
      j--;
      skipSpace();
      continue;
    }
    if (/[A-Za-z0-9_$]/.test(c)) {
      while (j >= 0 && /[A-Za-z0-9_$.]/.test(code[j])) j--;
      skipSpace();
      // A return-type annotation is introduced by `:`. Anything else before the
      // word means this brace is not a function body — `else {`, `try {`, a
      // class body, an object literal.
      if (j >= 0 && code[j] === ':') {
        j--;
        skipSpace();
        continue;
      }
      return false;
    }
    return false;
  }
  if (j < 0 || code[j] !== ')') return false;
  const open = openOf.get(j);
  if (open == null) return false;
  let k = open - 1;
  while (k >= 0 && /\s/.test(code[k])) k--;
  const end = k;
  while (k >= 0 && /[A-Za-z0-9_$]/.test(code[k])) k--;
  return !CONTROL_HEADS.has(code.slice(k + 1, end + 1));
}

/** `[start, end]` of every function body in the masked source, outermost first. */
function functionBodyRanges(code) {
  const ranges = [];
  const stack = [];
  const openOf = new Map();
  const opens = { '(': [], '[': [], '{': [] };
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') {
      opens[c].push(i);
      if (c === '{') stack.push({ start: i, isFunction: opensFunctionBody(code, i, openOf) });
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      const opener = c === ')' ? '(' : c === ']' ? '[' : '{';
      const at = opens[opener].pop();
      if (at != null) openOf.set(i, at);
      if (c === '}') {
        const frame = stack.pop();
        if (frame && frame.isFunction) ranges.push([frame.start, i]);
      }
    }
  }
  return ranges;
}

/**
 * Where this file pays each of its module loads.
 *
 * `moduleScope` is every specifier loaded during COLLECTION — a static import or
 * a module-scope dynamic one; `clocked` is every dynamic load that sits inside a
 * function body, with the line and the spelling the diagnostic quotes. Type-only
 * clauses and `typeof import(…)` queries appear in neither: they never resolve.
 */
function moduleLoadSites(source) {
  const { commentsOnly, codeOnly } = maskedProjections(source);
  const ranges = functionBodyRanges(codeOnly);
  const inFunction = (index) => ranges.some(([start, end]) => index > start && index < end);
  const moduleScope = new Set();
  const clocked = [];
  IMPORT_PATTERNS.lastIndex = 0;
  let match;
  while ((match = IMPORT_PATTERNS.exec(commentsOnly))) {
    const clause = match[1];
    const spec = match[2] ?? match[3] ?? match[4] ?? match[5];
    if (!spec) continue;
    if (clause != null && isTypeOnlyClause(clause)) continue;
    const dynamic = match[3] != null || match[4] != null;
    if (!dynamic) {
      moduleScope.add(spec);
      continue;
    }
    // The pattern's leading `(?:^|[\s;{(=,])` eats one delimiter unless the match
    // begins the file, so the keyword starts one character in.
    const head = match.index + (/^[a-z]/.test(match[0]) ? 0 : 1);
    if (TYPE_QUERY_BEFORE.test(codeOnly.slice(Math.max(0, head - 16), head))) continue;
    if (!inFunction(head)) {
      moduleScope.add(spec);
      continue;
    }
    clocked.push({ spec, form: match[4] != null ? 'require' : 'import', line: lineOf(source, head) });
  }
  return { moduleScope, clocked };
}

function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) if (source[i] === '\n') line++;
  return line;
}

/**
 * The clocked-window findings for one test file: a dynamic load of a specifier
 * this package resolves through `dist/`, inside a function body, with no
 * module-scope load of the same specifier anywhere in the file.
 */
function clockedWindowFindings(file, offendingSpecs) {
  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  if (!/\b(?:import|require)\s*\(/.test(source)) return [];
  const { moduleScope, clocked } = moduleLoadSites(source);
  const seen = new Set();
  const findings = [];
  for (const site of clocked) {
    if (!offendingSpecs.has(site.spec)) continue;
    if (moduleScope.has(site.spec)) continue;
    if (seen.has(site.spec)) continue;
    seen.add(site.spec);
    findings.push(site);
  }
  return findings;
}

/**
 * `path -> specifiers`, for the whole process. Crossing the package boundary
 * means the SAME dependency source is walked once per consuming config — nine
 * of them alias `@objectstack/core` — and both the read and the comment strip
 * are pure functions of the file.
 *
 * Measured on this repo, full scan, three runs each: ~1.6s before this change;
 * ~8.5s with the crossing and no cache; ~5.1s with it. What remains is not the
 * crossing (~0.5s) but comment stripping every source file (~3.0s), which is
 * correctness, not overhead — see `extractRuntimeImports`.
 */
const importCache = new Map();

function fileRuntimeImports(file) {
  const cached = importCache.get(file);
  if (cached) return cached;
  let specs;
  try {
    specs = extractRuntimeImports(readFileSync(file, 'utf8'));
  } catch {
    specs = [];
  }
  importCache.set(file, specs);
  return specs;
}

const RELATIVE_CANDIDATE_SUFFIXES = ['', '.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx'];

function resolveRelative(fromFile, spec) {
  return resolveModulePath(dirname(fromFile), spec);
}

/**
 * The file a path fragment lands on, resolved against `baseDir` with the
 * extension and `index.*` candidates a bundler would try. Used both for the
 * relative imports inside a package and for turning an alias replacement into
 * the file a cross-boundary walk continues into.
 */
function resolveModulePath(baseDir, spec) {
  const base = resolve(baseDir, spec);
  const candidates = [];
  for (const suffix of RELATIVE_CANDIDATE_SUFFIXES) candidates.push(base + suffix);
  // NodeNext writes `./x.js` for `./x.ts`.
  if (base.endsWith('.js')) candidates.push(base.slice(0, -3) + '.ts', base.slice(0, -3) + '.tsx');
  for (const suffix of RELATIVE_CANDIDATE_SUFFIXES) candidates.push(join(base, 'index' + suffix));
  for (const candidate of candidates) {
    if (!candidate || !SOURCE_FILE.test(candidate)) continue;
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/**
 * Workspace specifiers reachable from this package's tests, following relative
 * imports inside the package and crossing into any dependency `crossInto`
 * reports as aliased to a real source file. Starting at the tests rather than at
 * every file in the package matters: a specifier only decides a verdict if a
 * test can actually reach it.
 *
 * The two returned maps are kept apart on purpose — see "Where the walk goes"
 * in the header. `imports` is what THIS package's own files write, and is the
 * only input to the unaliased-artifact ledger. `crossPackage` is what an aliased
 * dependency's source writes, reaching this config's resolution domain through
 * the alias; it feeds rule 5 and nothing else.
 *
 * @param crossInto (spec) => absolute file path to continue into, or null.
 */
function testReachableWorkspaceImports(pkg, workspaceNames, crossInto) {
  const files = walkFiles(pkg.dir);
  const tests = files.filter((f) => TEST_FILE.test(f));
  if (tests.length === 0) return null;

  const seen = new Set();
  /** `via` is null inside this package, else the specifier that crossed out of it. */
  const queue = tests.map((file) => ({ file, via: null }));
  /** bare package name -> the specifiers actually written (bare and subpath) */
  const imports = new Map();
  /** specifier -> the alias of THIS config that pulled its writer into the graph */
  const crossPackage = new Map();

  while (queue.length > 0) {
    const { file, via } = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!SOURCE_FILE.test(file)) continue;
    for (const spec of fileRuntimeImports(file)) {
      if (spec.startsWith('.')) {
        const resolved = resolveRelative(file, spec);
        if (resolved && !seen.has(resolved)) queue.push({ file: resolved, via });
        continue;
      }
      const scoped = spec.match(/^(@[^/]+\/[^/]+)(?:\/.*)?$/);
      const bare = scoped ? scoped[1] : spec.split('/')[0];
      if (!workspaceNames.has(bare)) continue;
      if (via == null) {
        if (bare === pkg.name) continue;
        if (!imports.has(bare)) imports.set(bare, new Set());
        imports.get(bare).add(spec);
      } else if (!crossPackage.has(spec)) {
        crossPackage.set(spec, via);
      }
      // Aliasing a dep to source puts ITS import surface in this config's
      // resolution domain, so the walk follows the alias exactly as far as run
      // time does. `via` keeps the first hop: that is the alias the consumer
      // actually chose, and the one its diagnostic has to name.
      const target = crossInto ? crossInto(spec) : null;
      if (target && !seen.has(target)) queue.push({ file: target, via: via ?? spec });
    }
  }

  return { testCount: tests.length, testFiles: tests, imports, crossPackage };
}

// ── vitest config alias reading ─────────────────────────────────────────────

const VITEST_CONFIG_NAMES = [
  'vitest.config.ts',
  'vitest.config.mts',
  'vitest.config.cts',
  'vitest.config.js',
  'vitest.config.mjs',
  'vitest.config.cjs',
];

function findVitestConfig(dir) {
  for (const name of VITEST_CONFIG_NAMES) {
    const path = join(dir, name);
    if (existsSync(path)) return path;
  }
  return null;
}

/**
 * Comment stripping, shared. See `scripts/js-comment-mask.mjs` for the scanner
 * and for why this gate takes the deleting projection rather than the blanking
 * one (its import regex is lazy, and blanking is quadratic over what it leaves).
 *
 * Needed because these configs carry long rationale comments that name the very
 * specifiers being matched -- reading one as an alias would report a package as
 * safe on the strength of a paragraph about why it is not.
 *
 * The private copy this replaces knew about strings AND regex literals, but
 * decided "is this `/` a regex?" from the preceding CHARACTER alone. That misses
 * the keyword forms -- `return /["`]/.test(s)`, `case /['`]/.test(x)` -- where a
 * value character precedes and only the keyword tells regex from division. The
 * shared scanner carries the keyword set. Latent on today's corpus (34 vitest
 * configs, none carrying the shape), which is why it is pinned by shape in the
 * shared module's self-test rather than by this gate's corpus.
 */
/** End index (exclusive) of the regex literal starting at `start`, or -1. */
function scanRegexLiteral(src, start) {
  let i = start + 1;
  let inClass = false;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '\n') return -1;
    if (inClass) {
      if (c === ']') inClass = false;
    } else if (c === '[') {
      inClass = true;
    } else if (c === '/') {
      let end = i + 1;
      while (end < src.length && /[a-z]/.test(src[end])) end++;
      return end;
    }
    i++;
  }
  return -1;
}

/** Extract the balanced region starting at the opener at `start`. */
function balancedRegion(src, start) {
  const open = src[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(src, i);
      continue;
    }
    if (c === '/' ) {
      const end = scanRegexLiteral(src, i);
      if (end > 0) {
        i = end - 1;
        continue;
      }
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

function skipString(src, start) {
  const quote = src[start];
  let i = start + 1;
  while (i < src.length) {
    if (src[i] === '\\') {
      i += 2;
      continue;
    }
    if (src[i] === quote) return i;
    i++;
  }
  return i;
}

class UnreadableConfig extends Error {}

/**
 * Alias entries in declaration order, as `{ find, replacement }` where `find`
 * is a string (prefix match) or a RegExp. Anything this cannot read statically
 * throws rather than returning an empty list — a config whose aliases are
 * assembled elsewhere must not be silently reported as aliasing nothing.
 */
function readAliasEntries(configPath) {
  const src = stripComments(readFileSync(configPath, 'utf8'));
  const marker = src.match(/\balias\s*:\s*[[{]/);
  if (!marker) return [];
  const open = marker.index + marker[0].length - 1;
  const region = balancedRegion(src, open);
  if (region == null) throw new UnreadableConfig('unbalanced `alias` block');
  if (/\.\.\./.test(region)) throw new UnreadableConfig('`alias` block spreads a value this gate cannot read statically');

  const entries = [];
  if (region[0] === '[') {
    for (const object of topLevelObjects(region)) {
      const find = readValue(object, /\bfind\s*:/);
      const replacement = readValue(object, /\breplacement\s*:/);
      if (find == null || replacement == null) throw new UnreadableConfig('alias array entry without find/replacement');
      entries.push({ find: asFind(find), replacement: asPath(replacement) });
    }
  } else {
    for (const [key, value] of topLevelPairs(region)) {
      entries.push({ find: asFind(key), replacement: asPath(value) });
    }
  }
  return entries;
}

/** Objects at depth 1 of an array region. */
function topLevelObjects(region) {
  const objects = [];
  let depth = 0;
  for (let i = 0; i < region.length; i++) {
    const c = region[i];
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(region, i);
      continue;
    }
    if (c === '/') {
      const end = scanRegexLiteral(region, i);
      if (end > 0) {
        i = end - 1;
        continue;
      }
    }
    if (c === '[') depth++;
    else if (c === ']') depth--;
    else if (c === '{' && depth === 1) {
      const object = balancedRegion(region, i);
      if (object == null) throw new UnreadableConfig('unbalanced alias entry');
      objects.push(object);
      i += object.length - 1;
    }
  }
  return objects;
}

/** `key: value` pairs at depth 1 of an object region. */
function topLevelPairs(region) {
  const pairs = [];
  let depth = 0;
  let segmentStart = 1;
  const flush = (end) => {
    const segment = region.slice(segmentStart, end).trim();
    if (segment === '') return;
    const split = segment.match(/^((?:'[^']*'|"[^"]*"|`[^`]*`|[A-Za-z0-9_$]+))\s*:\s*([\s\S]+)$/);
    if (!split) throw new UnreadableConfig(`unreadable alias entry: ${segment.slice(0, 60)}`);
    pairs.push([split[1], split[2]]);
  };
  for (let i = 0; i < region.length; i++) {
    const c = region[i];
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(region, i);
      continue;
    }
    if (c === '/') {
      const end = scanRegexLiteral(region, i);
      if (end > 0) {
        i = end - 1;
        continue;
      }
    }
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        flush(i);
        break;
      }
    } else if (c === ',' && depth === 1) {
      flush(i);
      segmentStart = i + 1;
    }
  }
  return pairs;
}

function readValue(object, keyPattern) {
  const match = object.match(keyPattern);
  if (!match) return null;
  let i = match.index + match[0].length;
  while (i < object.length && /\s/.test(object[i])) i++;
  let depth = 0;
  const start = i;
  for (; i < object.length; i++) {
    const c = object[i];
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(object, i);
      continue;
    }
    if (c === '/') {
      const end = scanRegexLiteral(object, i);
      if (end > 0) {
        i = end - 1;
        continue;
      }
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === '}') {
      if (depth === 0) break;
      depth--;
    } else if (c === ',' && depth === 0) break;
  }
  return object.slice(start, i).trim();
}

function asFind(raw) {
  const literal = raw.trim();
  const asRegex = literal.match(/^\/((?:[^/\\]|\\.)*)\/([a-z]*)$/);
  if (asRegex) return new RegExp(asRegex[1], asRegex[2]);
  const asString = literal.match(/^(['"`])([\s\S]*)\1$/);
  if (asString) return asString[2];
  throw new UnreadableConfig(`alias key is neither a string nor a regex literal: ${literal.slice(0, 60)}`);
}

/**
 * The last string literal in an expression — the answer for the call forms
 * these configs use, where the path is the final argument:
 * `path.resolve(__dirname, '../x/src')`, `path.join(dir, 'x/src/$1.ts')`. A
 * bare string literal is itself the answer.
 *
 * `context` is what the diagnostic quotes, so a failure inside a `${…}` hole
 * names the whole replacement rather than the fragment.
 */
function lastStringLiteral(raw, context) {
  const strings = [...raw.matchAll(/(['"`])((?:[^\\]|\\.)*?)\1/g)].map((m) => m[2]);
  if (strings.length === 0)
    throw new UnreadableConfig(`alias replacement has no literal path: ${context.slice(0, 60)}`);
  return strings[strings.length - 1];
}

/**
 * A template literal's pieces in order — literal chunks and `${…}` holes.
 * Escapes are consumed as they are at run time, so `\${x}` is a literal
 * `${x}` and not a hole.
 */
function splitTemplateLiteral(raw) {
  const body = raw.slice(1, -1);
  const parts = [];
  let literal = '';
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === '\\') {
      literal += body[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (c === '$' && body[i + 1] === '{') {
      const hole = balancedRegion(body, i + 1);
      if (hole == null) throw new UnreadableConfig(`unbalanced \`\${…}\` in alias replacement: ${raw.slice(0, 60)}`);
      parts.push({ literal });
      parts.push({ expression: hole.slice(1, -1).trim() });
      literal = '';
      i += hole.length + 1;
      continue;
    }
    literal += c;
    i++;
  }
  parts.push({ literal });
  return parts;
}

/**
 * The path an alias replacement produces, in the two spellings these configs
 * use. Both are approximations of the same shape: what is returned stands in
 * for the resolved path, and the only questions asked of it downstream are
 * "does it have a `src` segment" and "does it continue past a file extension",
 * so a relative fragment answers exactly as well as the absolute path
 * `path.resolve` would really produce.
 *
 *   replacement: path.resolve(__dirname, '../x/src/index.ts')
 *     → `../x/src/index.ts` — the last string literal is the whole answer.
 *
 *   replacement: `${path.resolve(__dirname, '../x/src')}/$1/index.ts`
 *     → `../x/src/$1/index.ts` — each `${…}` hole resolves by the same rule and
 *       the literal chunks are concatenated around it, so the `$1` back-
 *       reference survives into `String.replace` and joins the `src` chunk.
 *
 * ⚠️ The template form is not a stylistic variant: it is how the one-rule-for-
 * all-namespaces subpath alias is written (`/^@objectstack\/spec\/([a-z-]+)$/`
 * → `…/spec/src/$1/index.ts`), because that rule needs the capture group
 * INSIDE the path. Reading only the last string literal returned the entire
 * template body — a text with no `src` SEGMENT in it (`spec/src'` is followed
 * by a quote, not a separator) — so a config aliasing every namespace
 * correctly read as aliasing nothing, and `plugin-audit` and
 * `service-knowledge` sat in the registry as unaliased on the strength of how
 * their replacement was SPELLED (#8020). Fail-closed, so never a false green —
 * but it over-stated the remediation list and told two compliant packages to
 * add the alias they already had.
 *
 * ── Spellings that are legal here and still unreadable ──────────────────────
 *
 * Each of these is fail-closed — either a loud `UnreadableConfig` naming the
 * config, or the same over-statement above — never a silent pass. Listed so
 * the next one is looked up rather than rediscovered:
 *
 *   - `+` concatenation: `path.resolve(__dirname, '../x/src') + '/$1/index.ts'`
 *     resolves to the LAST literal, `/$1/index.ts`, which has no `src` segment
 *     — the exact #8020 shape one spelling over. Write it as a template.
 *   - A hole or argument with no string literal in it at all (`${SPEC_SRC}`,
 *     `path.resolve(SRC_ROOT, 'index.ts')`) — the first throws
 *     `UnreadableConfig`; the second silently answers `index.ts`.
 *   - A path that is not the last argument, where later arguments are
 *     non-literal (`path.join('x/src', suffix)` reads `x/src` and drops
 *     `suffix`).
 *   - A template literal nested inside a `${…}` hole — the scanner treats the
 *     first inner backtick as the outer literal's terminator.
 *
 * Evaluating the config instead of reading it was measured and rejected: this
 * gate runs on a bare checkout with NO `node_modules` (that is how CI reaches
 * it, and how its own `--self-test` fixture tree in `tmpdir` works), while
 * every real config here opens with `import { defineConfig } from
 * 'vitest/config'`. Evaluation would trade a dependency-free ~3s scan for one
 * that cannot run before `pnpm install`, and would make an alias list the gate
 * cannot see today into one it executes.
 */
function asPath(raw) {
  const literal = raw.trim();
  if (literal[0] === '`' && skipString(literal, 0) === literal.length - 1) {
    return splitTemplateLiteral(literal)
      .map((part) => (part.expression == null ? part.literal : lastStringLiteral(part.expression, literal)))
      .join('');
  }
  return lastStringLiteral(literal, literal);
}

/**
 * Resolve `spec` through `entries` exactly as Vite does: entries in order,
 * first match wins, string `find` replacing a PREFIX and regex `find` going
 * through `String.replace` (so `$1` back-references work).
 */
function resolveThroughAliases(spec, entries) {
  for (const entry of entries) {
    if (typeof entry.find === 'string') {
      if (!spec.startsWith(entry.find)) continue;
      return { entry, result: entry.replacement + spec.slice(entry.find.length) };
    }
    if (!entry.find.test(spec)) continue;
    entry.find.lastIndex = 0;
    return { entry, result: spec.replace(entry.find, entry.replacement) };
  }
  return null;
}

function pointsAtSource(path) {
  return /(^|[\\/])src([\\/]|$)/.test(path) && !/(^|[\\/])dist([\\/]|$)/.test(path);
}

/**
 * The source file this config's aliases really put behind `spec`, or null when
 * the walk must not cross there. Null covers four distinct cases, all of them
 * deliberate: the specifier is not aliased at all; the alias resolves THROUGH a
 * file (rule 5 is already failing it, and there is nothing to read); the alias
 * lands on `dist/` (an artifact, not a source graph, and possibly absent in a
 * bare checkout); or the replacement does not name a file that exists.
 *
 * `asPath` returns a FRAGMENT, not an absolute path — by design, since its other
 * two callers only ask it for `src`/extension segments. The real configs spell
 * their replacements `path.resolve(__dirname, '…')`, so the fragment is relative
 * to the config's own directory; the repo root is tried as a second base for the
 * `path.resolve(REPO_ROOT, '…')` spelling. A fragment that answers to neither is
 * simply not crossed.
 */
function aliasedSourceFile(spec, entries, configDir, root) {
  const resolved = resolveThroughAliases(spec, entries);
  if (!resolved) return null;
  if (THROUGH_A_FILE.test(resolved.result)) return null;
  if (!pointsAtSource(resolved.result)) return null;
  for (const base of [configDir, root]) {
    const file = resolveModulePath(base, resolved.result);
    if (file) return file;
  }
  return null;
}

/**
 * The source file that would serve `spec`, spelled relative to `consumerDir` —
 * i.e. ready to drop into `path.resolve(__dirname, …)` in that package's vitest
 * config. Null when nothing under the dependency's `src/` answers to it.
 *
 * This is the half of the remediation hint that CANNOT be a template (#8256).
 * The right-hand side of a subpath alias is not derivable from the specifier:
 * measured in #8104, `@objectstack/spec` maps every namespace to a DIRECTORY
 * (`src/api/index.ts`) while `@objectstack/platform-objects` maps `./plugin` to
 * a FILE (`src/plugin.ts`). A single capture rule — the tempting "fix" — is
 * therefore right for one and wrong for the other, and it fails on whoever NEXT
 * writes that import rather than on the author of the rule. So the target is
 * measured per specifier against the tree instead of being guessed from its
 * shape: `resolveModulePath` tries the same file-then-`index.*` candidate list
 * a bundler does, and returns only a path that really exists.
 *
 * Fail-soft on purpose: a dependency whose source is not laid out under `src/`
 * mirroring its subpaths yields null, and the caller prints a placeholder plus
 * the instruction to resolve it by hand. A hint that cannot be measured must
 * say so, never invent a path — inventing one is the defect this card exists
 * to remove, one layer down.
 */
function sourceTargetFor(spec, packageDirs, consumerDir) {
  const scoped = spec.match(/^(@[^/]+\/[^/]+)(?:\/.*)?$/);
  const bare = scoped ? scoped[1] : spec.split('/')[0];
  const dir = packageDirs.get(bare);
  if (!dir) return null;
  const subpath = spec.slice(bare.length + 1);
  const file = resolveModulePath(join(dir, 'src'), subpath === '' ? 'index' : subpath);
  if (!file) return null;
  return relative(consumerDir, file).replace(/\\/g, '/');
}

// ── the scan ────────────────────────────────────────────────────────────────

/**
 * @returns {{ packages: Array, artifactPackages: Set<string>, totalPackages: number,
 *            configTraps: Array, publishedCount: number }}
 */
function scan(root) {
  // Per-scan, not per-process: `--self-test` rewrites fixture files BETWEEN
  // `check()` calls to exercise registry drift, and a cache that outlived a
  // scan would answer those later passes from the pre-rewrite content.
  importCache.clear();
  const workspace = listWorkspacePackages(root);
  const names = new Set(workspace.map((p) => p.name));
  const artifactPackages = new Set(workspace.filter((p) => resolvesToArtifact(p.json)).map((p) => p.name));
  const packageDirs = new Map(workspace.map((p) => [p.name, p.dir]));
  // Every subpath this workspace publishes, from the manifests rather than from
  // any import — the population the reachability-independent rule is judged on.
  const published = workspace.flatMap((p) => publishedSubpaths(p.json, p.name));

  const packages = [];
  /** Per-config latent traps: a published subpath this table would mangle. */
  const configTraps = [];
  for (const pkg of workspace) {
    // The config is read BEFORE the walk now: the alias list is what decides
    // where the walk is allowed to leave the package, so it cannot be read
    // after the graph has already been collected.
    const configPath = findVitestConfig(pkg.dir);
    let entries = [];
    let unreadable = null;
    if (configPath) {
      try {
        entries = readAliasEntries(configPath);
      } catch (error) {
        if (!(error instanceof UnreadableConfig)) throw error;
        unreadable = error.message;
      }
    }

    // The reachability-INDEPENDENT rule, run here rather than after the walk
    // because it does not need one: the population is the dependency's export
    // map. Deliberately ahead of the `!reachable` bail-out too — a config in a
    // package with no test files still resolves specifiers for whoever aliases
    // INTO it, and a table nobody exercises is where this trap survives longest.
    if (entries.length > 0) {
      const traps = [];
      for (const spec of published) {
        const resolved = resolveThroughAliases(spec, entries);
        if (!resolved || !THROUGH_A_FILE.test(resolved.result)) continue;
        traps.push({ spec, result: resolved.result, suggest: sourceTargetFor(spec, packageDirs, pkg.dir) });
      }
      if (traps.length > 0) configTraps.push({ rel: pkg.rel, configPath: relative(root, configPath), traps });
    }

    const crossInto =
      entries.length > 0 ? (spec) => aliasedSourceFile(spec, entries, dirname(configPath), root) : null;
    const reachable = testReachableWorkspaceImports(pkg, names, crossInto);
    if (!reachable) continue;

    const unaliased = [];
    /**
     * dep -> the specifiers that made it unaliased, each with where it lands
     * today and the source file that would serve it. The verdict is still the
     * emptiness of this list, exactly as the `anyUnaliased` flag it replaces —
     * see `remediationHint` for why the specifiers now have to survive the scan
     * instead of being reduced to the dep's bare name here (#8256).
     */
    const unaliasedSpecs = new Map();
    const throughAFile = [];
    for (const [dep, specs] of [...reachable.imports].sort(([a], [b]) => a.localeCompare(b))) {
      if (!artifactPackages.has(dep)) continue; // resolves to source already; not an artifact
      const offending = [];
      for (const spec of [...specs].sort()) {
        const resolved = resolveThroughAliases(spec, entries);
        if (!resolved) {
          offending.push({ spec, landsOn: null, suggest: sourceTargetFor(spec, packageDirs, pkg.dir) });
          continue;
        }
        if (THROUGH_A_FILE.test(resolved.result)) {
          throughAFile.push({ spec, result: resolved.result, via: null });
          continue;
        }
        if (!pointsAtSource(resolved.result))
          offending.push({ spec, landsOn: resolved.result, suggest: sourceTargetFor(spec, packageDirs, pkg.dir) });
      }
      if (offending.length > 0) {
        unaliased.push(dep);
        unaliasedSpecs.set(dep, offending);
      }
    }

    // Rule 5 over the specifiers that reached this config's resolution domain
    // through its own alias to a dependency's source. Ledger-neutral by
    // construction: nothing here can touch `unaliased`.
    const alreadyReported = new Set(throughAFile.map((t) => t.spec));
    for (const [spec, via] of [...reachable.crossPackage].sort(([a], [b]) => a.localeCompare(b))) {
      if (alreadyReported.has(spec)) continue;
      const resolved = resolveThroughAliases(spec, entries);
      if (!resolved || !THROUGH_A_FILE.test(resolved.result)) continue;
      throughAFile.push({ spec, result: resolved.result, via });
    }

    // The clocked-window rule (#10126), over the specifiers just measured as
    // resolving through `dist/`. Deliberately downstream of that measurement:
    // the population is not a second list to keep in step, it IS the list the
    // registry mirrors, read at specifier granularity.
    const offendingSpecs = new Set([...unaliasedSpecs.values()].flat().map((row) => row.spec));
    const clockedLoads = [];
    if (offendingSpecs.size > 0) {
      for (const file of reachable.testFiles.sort()) {
        for (const finding of clockedWindowFindings(file, offendingSpecs)) {
          clockedLoads.push({ ...finding, file: relative(root, file) });
        }
      }
    }

    packages.push({
      name: pkg.name,
      rel: pkg.rel,
      testCount: reachable.testCount,
      clockedLoads,
      configPath: configPath ? relative(root, configPath) : null,
      unreadable,
      unaliased,
      unaliasedSpecs,
      throughAFile,
    });
  }

  return { packages, artifactPackages, totalPackages: workspace.length, configTraps, publishedCount: published.length };
}

// ── the gate ────────────────────────────────────────────────────────────────

/** Spell a specifier the way it must appear inside a `/…/` regex literal. */
function escapeForRegexLiteral(spec) {
  return spec.replace(/[/\\^$*+?.()|[\]{}]/g, (c) => '\\' + c);
}

/** The bare package name a specifier belongs to. */
function barePackageOf(spec) {
  const scoped = spec.match(/^(@[^/]+\/[^/]+)(?:\/.*)?$/);
  return scoped ? scoped[1] : spec.split('/')[0];
}

/** Does this specifier reach a subpath export rather than the package entry? */
function isSubpathSpecifier(spec) {
  return spec.length > barePackageOf(spec).length;
}

/** Printed where a replacement could not be measured — never a fabricated path. */
const UNMEASURED_TARGET = '<relative>/src/…';

/**
 * The remediation block for a set of unaliased dependencies: the specifiers the
 * gate ACTUALLY measured, and one anchored entry per specifier.
 *
 * ⛔ Deliberately not a template (#8256). What stood here printed the dep's
 * bare NAME and one anchored-bare entry for `deps[0]` — correct only for a
 * package imported bare. For an importer whose reachable specifiers are all
 * subpaths (`@objectstack/spec/api`, `/data`, `/system`), `/^@objectstack\/spec$/`
 * matches NONE of the specifiers the same message had just named: the reader
 * applies the printed fix, the gate stays red, and the message repeats itself
 * with no further guidance. Worse, the obvious next guess is the object form,
 * which makes this gate pass while matching by PREFIX and dying with ENOTDIR at
 * run time (#7778) — a wrong turn this block now warns against by name, because
 * the case where it is tempting is exactly the case detected here.
 *
 * The one thing this must NOT do is answer with a different template: a single
 * capture rule is safe for a package with a uniform export map and wrong for
 * one that maps a subpath to a file, and it would fail on the next author
 * rather than on its own. Everything printed here is measured — the specifiers
 * from the walk, the targets from the tree — or explicitly marked unmeasured.
 */
function remediationHint(pkg, deps) {
  const rows = deps.flatMap((dep) => pkg.unaliasedSpecs.get(dep) ?? []);
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((r) => r.spec.length));
  const subpath = rows.find((r) => isSubpathSpecifier(r.spec));

  const lines = [
    '    Measured — the specifiers these tests really import, and where each one lands today:',
    ...rows.map(
      (r) =>
        `      ${r.spec.padEnd(width)}  ` +
        (r.landsOn ? `aliased, but lands on \`${r.landsOn}\` — an artifact` : 'no alias entry matches it'),
    ),
    "    Add ONE ANCHORED entry per specifier above to this package's vitest.config.* (array form).",
    '    Anchoring is what makes the entries order-independent and stops a bare key from swallowing',
    '    the subpaths:',
    '      alias: [',
    ...rows.map(
      (r) =>
        `        { find: /^${escapeForRegexLiteral(r.spec)}$/, ` +
        `replacement: path.resolve(__dirname, '${r.suggest ?? UNMEASURED_TARGET}') },`,
    ),
    '      ]',
  ];

  if (rows.some((r) => r.suggest))
    lines.push(
      '    Each replacement above names a file that EXISTS in this checkout' +
        (subpath
          ? "; confirm it is what that\n    package's `exports` entry for the subpath is built from — this gate measures the tree, it\n    does not read the export map."
          : '.'),
    );
  if (rows.some((r) => !r.suggest))
    lines.push(
      `    \`${UNMEASURED_TARGET}\` marks a specifier with no counterpart under that dependency's \`src/\`:`,
      '    resolve that one against the package\'s own `exports` map by hand. This gate prints no path',
      '    that it could not measure.',
    );
  if (subpath)
    lines.push(
      `    ⛔ Do NOT collapse the subpath entries into the object form \`{ '${barePackageOf(subpath.spec)}': … }\`.`,
      `    It matches by PREFIX, so \`${subpath.spec}\` resolves to \`…/src/index.ts/${subpath.spec.slice(barePackageOf(subpath.spec).length + 1)}\` —`,
      '    ENOTDIR at run time, in a config that reads as correct. This gate fails that as the',
      '    alias-through-a-file rule, and it is the trap this hint exists to keep you out of.',
    );

  return lines.join('\n');
}

function check(root, registry) {
  const failures = [];
  const { packages, artifactPackages, totalPackages, configTraps, publishedCount } = scan(root);

  // Census guard. Every reading below is a scan result, and a scan that has
  // quietly stopped matching reports a spotless repo — the #4868 family. Zero
  // is never the good news it looks like.
  if (totalPackages === 0) failures.push('scanner found NO workspace packages at all — the scan is broken, not the repo');
  if (artifactPackages.size === 0)
    failures.push('scanner found NO package resolving to `dist/` — entry-point detection is broken, not the repo');
  if (packages.length === 0) failures.push('scanner found NO package with test files — test discovery is broken, not the repo');
  if (publishedCount === 0)
    failures.push(
      'scanner found NO package publishing a subpath export — the `exports` read is broken, not the repo',
    );

  const measured = new Map(packages.filter((p) => p.unaliased.length > 0).map((p) => [p.name, p.unaliased]));

  for (const pkg of packages) {
    if (pkg.unreadable) {
      failures.push(
        `${pkg.rel}: ${pkg.configPath} cannot be read statically (${pkg.unreadable}).\n` +
          '    This gate must be able to see every alias. Write them as literal entries in this file.',
      );
    }
    for (const load of pkg.clockedLoads ?? []) {
      failures.push(
        `${load.file}:${load.line}: \`${load.form}('${load.spec}')\` is paid inside a function body — a CLOCKED window.\n` +
          `    This file has no module-scope load of \`${load.spec}\`, and this package resolves that specifier\n` +
          '    through `dist/`, so the first call transforms that dependency\'s whole module graph while a\n' +
          "    `testTimeout` or `hookTimeout` is running. Measured on the incident this rule comes from: 3.1-3.6s\n" +
          '    idle on 4 vCPU, 20.26s on a starved core — past every clock, including a hypothetical 30s.\n' +
          '    THE CONVENTION: clocked windows measure behaviour, never loading — a test that boots a real\n' +
          '    plugin chain pays its first load at module top.\n' +
          '    Add a module-top side-effect import so the transform is paid during COLLECTION, which vitest\n' +
          '    clocks against nothing (it clocks hooks and test bodies only):\n' +
          `      import '${load.spec}';\n` +
          '    Keep the dynamic call where it is — this only decides WHERE the first load is paid. Widening the\n' +
          '    timeout instead relocates the cliff to the next heavier shard; the merge queue runs the full\n' +
          '    suite where PR-side CI runs only the affected subset, so that shard is heavier than anything the\n' +
          '    PR checks measure.',
      );
    }
    for (const trap of pkg.throughAFile) {
      failures.push(
        `${pkg.rel}: alias resolves \`${trap.spec}\` to \`${trap.result}\` — a path THROUGH a file (ENOTDIR at run time).\n` +
          (trap.via
            ? `    No file of this package writes that specifier. It is reached through this config's own alias\n` +
              `    for \`${trap.via}\`, which points at source: aliasing a workspace dep to src imports THAT dep's\n` +
              '    import surface into this config\'s resolution domain, and this entry mangles one of them.\n'
            : '') +
          '    The object alias form matches by PREFIX. Anchor the pattern with the array form\n' +
          `    (\`{ find: /^${escapeForRegexLiteral(trap.spec)}$/, replacement: … }\`) or list the subpath entry BEFORE the bare one.`,
      );
    }
  }

  // The latent half. Deduped against rule 5 on purpose: when a test really does
  // reach the specifier, rule 5's finding is the stronger one — it carries HOW
  // the specifier arrives (this package's own file, or an aliased dependency's
  // source) — and two failures for one edit is how a gate teaches people to skim.
  const reportedByReach = new Set(packages.flatMap((p) => p.throughAFile.map((t) => `${p.rel} :: ${t.spec}`)));
  for (const entry of configTraps) {
    for (const trap of entry.traps) {
      if (reportedByReach.has(`${entry.rel} :: ${trap.spec}`)) continue;
      failures.push(
        `${entry.rel}: alias table would resolve the PUBLISHED subpath \`${trap.spec}\` to \`${trap.result}\` — ` +
          'a path THROUGH a file (ENOTDIR at run time).\n' +
          '    Latent, not currently failing: no test reaches that specifier from this package yet, which is\n' +
          '    the only reason the reachability rule above is silent about it. The failure lands on whoever\n' +
          '    first writes the import — inside a module one package away from this table, naming a path\n' +
          '    nobody wrote.\n' +
          `    \`${trap.spec}\` is read from \`${barePackageOf(trap.spec)}\`'s own \`exports\` map, so a subpath this\n` +
          '    table does not list cannot go unnoticed. List it BEFORE the bare entry (array form):\n' +
          `      { find: /^${escapeForRegexLiteral(trap.spec)}$/, ` +
          `replacement: path.resolve(__dirname, '${trap.suggest ?? UNMEASURED_TARGET}') },\n` +
          '    ⛔ Do NOT anchor the bare entry instead. Anchoring stops the mangling by stopping the MATCH:\n' +
          '    the subpath then resolves through `exports` to `dist/`, silently, and a stale artifact decides\n' +
          "    the verdict — the failure this file's header opens with.",
      );
    }
  }

  for (const [name, deps] of measured) {
    const registered = registry[name];
    if (!registered) {
      const pkg = packages.find((p) => p.name === name);
      failures.push(
        `${pkg.rel} (${name}): tests import ${deps.length} workspace package(s) that resolve to \`dist/\` with no source alias:\n` +
          `    ${deps.join(', ')}\n` +
          '    Every verdict in this package is currently a function of build state, not of the source in the\n' +
          '    checkout — and the dangerous case is SILENT (a dist merely behind the source runs GREEN against\n' +
          '    old behaviour).\n' +
          remediationHint(pkg, deps),
      );
      continue;
    }
    const added = deps.filter((d) => !registered.includes(d));
    const gone = registered.filter((d) => !deps.includes(d));
    if (added.length > 0)
      failures.push(
        `${name}: NEW unaliased artifact import(s) since this entry was measured: ${added.join(', ')}.\n` +
          "    Alias them in the package's vitest.config.* — widening the registry entry is not the fix.\n" +
          // The REASON for that refusal, in the text the author actually reads (#8576).
          // Mirrors `KNOWN_UNALIASED_TEST_IMPORTS`'s own words verbatim rather than
          // restating them: one rule in two voices becomes two rules by the next reading.
          '    That registry is ⛔ SHRINK-ONLY: entries are audited in both directions, so one that is no\n' +
          '    longer needed fails the gate and names itself for deletion.\n' +
          // Same defect, same fix: this branch also named bare packages and left
          // the reader to guess the specifier shape (#8256).
          remediationHint(
            packages.find((p) => p.name === name),
            added,
          ),
      );
    if (gone.length > 0)
      failures.push(
        `${name}: registry entry is STALE — no longer unaliased: ${gone.join(', ')}.\n` +
          `    Narrow the entry to exactly: ${JSON.stringify(deps)}`,
      );
  }

  for (const name of Object.keys(registry)) {
    if (measured.has(name)) continue;
    const known = packages.some((p) => p.name === name);
    failures.push(
      known
        ? `${name}: registry entry is no longer needed — every artifact import is aliased to source now. Delete the entry.`
        : `${name}: registry entry names a package with no test files (or no such package). Delete the entry.`,
    );
  }

  return { failures, packages, measured, publishedCount };
}

// ── reporting ───────────────────────────────────────────────────────────────

function printList(root) {
  const { packages } = scan(root);
  const offenders = packages.filter((p) => p.unaliased.length > 0).sort((a, b) => a.name.localeCompare(b.name));
  console.log('const KNOWN_UNALIASED_TEST_IMPORTS = {');
  for (const pkg of offenders) {
    console.log(`  '${pkg.name}': [${pkg.unaliased.map((d) => `'${d}'`).join(', ')}],`);
  }
  console.log('};');
  console.error(
    `\n${offenders.length} of ${packages.length} packages with tests have >=1 unaliased artifact import ` +
      `(${offenders.reduce((n, p) => n + p.unaliased.length, 0)} package-dependency pairs).`,
  );
}

// ── self-test ───────────────────────────────────────────────────────────────

function fixture(root, rel, files) {
  const dir = join(root, rel);
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
  }
  return dir;
}

const ARTIFACT_MANIFEST = (name) =>
  JSON.stringify({ name, main: 'dist/index.js', exports: { '.': { import: './dist/index.js' } } }, null, 2);

function buildFixtureTree() {
  const root = join(tmpdir(), `os-test-source-alias-selftest-${process.pid}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'packages'), { recursive: true });

  // The stale-able dependency every fixture imports.
  // `logger` is a subpath served by a FILE and `nested` one served by a
  // DIRECTORY — the non-uniformity that decides whether a remediation hint can
  // be a template at all (#8256; measured on the real `@objectstack/spec` vs
  // `@objectstack/platform-objects` in #8104).
  fixture(root, 'packages/core', {
    'package.json': ARTIFACT_MANIFEST('@fx/core'),
    'src/index.ts': 'export const alive = 1;\n',
    'src/logger.ts': 'export const log = 1;\n',
    'src/nested/index.ts': 'export const nested = 1;\n',
  });

  // (1) violating: tests import the artifact, no config at all.
  fixture(root, 'packages/violator', {
    'package.json': ARTIFACT_MANIFEST('@fx/violator'),
    'src/thing.ts': "import { alive } from '@fx/core';\nexport const thing = alive;\n",
    'src/thing.test.ts': "import { thing } from './thing';\nexport default thing;\n",
  });

  // (1b) THE SUBPATH-ONLY IMPORTER (#8256) — the shape the old hint could not
  // serve. Not one of its specifiers is the bare package name, so the anchored
  // BARE entry the diagnostic used to print (`/^@fx\/core$/`) matches NONE of
  // them: the reader applied the printed fix and the gate stayed red, with the
  // same message and no further guidance. All three subpaths are here because
  // their remediations differ and no single rule covers them: `logger` is a
  // file, `nested` is a directory, and `ghost` has no counterpart under `src/`
  // at all — which must print as unmeasured rather than as an invented path.
  fixture(root, 'packages/subpath-only', {
    'package.json': ARTIFACT_MANIFEST('@fx/subpath-only'),
    'src/thing.test.ts':
      "import { log } from '@fx/core/logger';\n" +
      "import { nested } from '@fx/core/nested';\n" +
      "import { ghost } from '@fx/core/ghost';\n" +
      'export default log + nested + ghost;\n',
  });

  // (2) compliant: anchored array-form alias to source.
  fixture(root, 'packages/compliant', {
    'package.json': ARTIFACT_MANIFEST('@fx/compliant'),
    'src/thing.ts': "import { alive } from '@fx/core';\nexport const thing = alive;\n",
    'src/thing.test.ts': "import { thing } from './thing';\nexport default thing;\n",
    'vitest.config.ts':
      "import path from 'path';\nexport default { resolve: { alias: [\n" +
      "  { find: /^@fx\\/core$/, replacement: path.resolve(__dirname, '../core/src/index.ts') },\n" +
      '] } };\n',
  });

  // (3) type-only import: erased before resolution, so NOT a hazard.
  fixture(root, 'packages/type-only', {
    'package.json': ARTIFACT_MANIFEST('@fx/type-only'),
    'src/thing.test.ts': "import type { Alive } from '@fx/core';\nexport type T = Alive;\n",
  });

  // (4) the ENOTDIR trap: bare object-form key swallowing a subpath import.
  fixture(root, 'packages/prefix-trap', {
    'package.json': ARTIFACT_MANIFEST('@fx/prefix-trap'),
    'src/thing.test.ts': "import { log } from '@fx/core/logger';\nexport default log;\n",
    'vitest.config.ts':
      "import path from 'path';\nexport default { resolve: { alias: {\n" +
      "  '@fx/core': path.resolve(__dirname, '../core/src/index.ts'),\n" +
      '} } };\n',
  });

  // (5) a config whose aliases are assembled elsewhere — unreadable, not empty.
  fixture(root, 'packages/opaque', {
    'package.json': ARTIFACT_MANIFEST('@fx/opaque'),
    'src/thing.test.ts': "import { alive } from '@fx/core';\nexport default alive;\n",
    'vitest.config.ts': "import { shared } from './shared';\nexport default { resolve: { alias: [...shared] } };\n",
  });

  // (6) unreachable from tests: the import exists but no test pulls it in.
  fixture(root, 'packages/unreachable', {
    'package.json': ARTIFACT_MANIFEST('@fx/unreachable'),
    'src/lonely.ts': "import { alive } from '@fx/core';\nexport default alive;\n",
    'src/thing.test.ts': "export default 1;\n",
  });

  // ── (7) THE CANARY ────────────────────────────────────────────────────────
  //
  // A byte-for-byte copy of the shape `plugin-audit` and `service-knowledge`
  // really use. Those two packages have now defeated THREE readers of vitest
  // aliases, twice on the same morning, by two different parsing assumptions:
  //
  //   - an `objectstack/core` grep census missed them because the anchored
  //     regex form writes the bytes `@fx\/core` — with an ESCAPED SLASH, so
  //     the plain specifier never appears in the file;
  //   - this gate missed them because the one-rule-for-all-namespaces subpath
  //     alias writes its replacement as a TEMPLATE LITERAL, to get the `$1`
  //     back-reference inside the path (#8020).
  //
  // Neither spelling is exotic and neither is going away — the escaped slash
  // is forced by the regex literal, the template by the capture group. They
  // are pinned together, in one fixture, so the fourth reader of these configs
  // inherits the two assumptions that have already cost this repo twice
  // instead of rediscovering them. This fixture must stay COMPLIANT: it
  // aliases everything it imports, and any reader that reports it is wrong
  // about the reader, not about the config.
  fixture(root, 'packages/canary', {
    'package.json': ARTIFACT_MANIFEST('@fx/canary'),
    'src/thing.test.ts':
      "import { alive } from '@fx/core';\nimport { log } from '@fx/core/logger';\nexport default alive + log;\n",
    'vitest.config.ts':
      "import path from 'path';\nexport default { resolve: { alias: [\n" +
      // Subpath rule first: one anchored regex for every namespace, with the
      // capture group INSIDE the path — which is what forces the template.
      '  {\n' +
      '    find: /^@fx\\/core\\/([a-z-]+)$/,\n' +
      "    replacement: `${path.resolve(__dirname, '../core/src')}/$1.ts`,\n" +
      '  },\n' +
      "  { find: /^@fx\\/core$/, replacement: path.resolve(__dirname, '../core/src/index.ts') },\n" +
      '] } };\n',
  });

  // (8) the template form is a spelling, not a licence: one landing on `dist/`
  // is still an unaliased artifact import.
  fixture(root, 'packages/template-to-dist', {
    'package.json': ARTIFACT_MANIFEST('@fx/template-to-dist'),
    'src/thing.test.ts': "import { log } from '@fx/core/logger';\nexport default log;\n",
    'vitest.config.ts':
      "import path from 'path';\nexport default { resolve: { alias: [\n" +
      '  {\n' +
      '    find: /^@fx\\/core\\/([a-z-]+)$/,\n' +
      "    replacement: `${path.resolve(__dirname, '../core/dist')}/$1.js`,\n" +
      '  },\n' +
      '] } };\n',
  });

  // (9) …and the ENOTDIR trap is still seen THROUGH a template: the chunks
  // really are concatenated, rather than the whole thing waved past.
  fixture(root, 'packages/template-prefix-trap', {
    'package.json': ARTIFACT_MANIFEST('@fx/template-prefix-trap'),
    'src/thing.test.ts': "import { log } from '@fx/core/logger';\nexport default log;\n",
    'vitest.config.ts':
      "import path from 'path';\nexport default { resolve: { alias: {\n" +
      "  '@fx/core': `${path.resolve(__dirname, '../core/src')}/index.ts`,\n" +
      '} } };\n',
  });

  // (10) a `${…}` hole with no literal in it is UNREADABLE, not empty — the
  // fail-closed half of reading templates at all.
  fixture(root, 'packages/opaque-template', {
    'package.json': ARTIFACT_MANIFEST('@fx/opaque-template'),
    'src/thing.test.ts': "import { alive } from '@fx/core';\nexport default alive;\n",
    'vitest.config.ts':
      "import { SRC } from './shared';\nexport default { resolve: { alias: [\n" +
      '  { find: /^@fx\\/core$/, replacement: `${SRC}/index.ts` },\n' +
      '] } };\n',
  });

  // ── (11-14) THE CROSS-BOUNDARY SHAPE (#8351) ──────────────────────────────
  //
  // A reproduction of the #8349 miss: the specifier that dies at run time is
  // written in NO file of the failing package. `@fx/relay` is aliased to source
  // by the consumer, so relay's own imports are resolved by the CONSUMER's
  // alias list — and the consumer's bare `@fx/core` key, whose replacement is a
  // FILE, swallows the `@fx/core/logger` that relay's source reaches.
  fixture(root, 'packages/relay', {
    'package.json': ARTIFACT_MANIFEST('@fx/relay'),
    // The hop through a relative file matters: the real incident reached the
    // subpath from `core/src/index.ts` via `metadata-service-contract.ts`, not
    // from the entry point itself.
    'src/index.ts': "export * from './inner.js';\n",
    'src/inner.ts': "import { log } from '@fx/core/logger';\nexport const relayed = log;\n",
  });

  // (11) violating: the consumer aliases relay to src, and mangles relay's own
  // subpath import. Nothing in this package mentions `@fx/core/logger`.
  fixture(root, 'packages/cross-package-trap', {
    'package.json': ARTIFACT_MANIFEST('@fx/cross-package-trap'),
    'src/thing.test.ts': "import { relayed } from '@fx/relay';\nexport default relayed;\n",
    'vitest.config.ts':
      "import path from 'path';\nexport default { resolve: { alias: {\n" +
      "  '@fx/relay': path.resolve(__dirname, '../relay/src/index.ts'),\n" +
      "  '@fx/core': path.resolve(__dirname, '../core/src/index.ts'),\n" +
      '} } };\n',
  });

  // (12) the negative control that keeps (11) honest: the SAME cross-boundary
  // reach, with the subpath entry listed ahead of the bare one. Crossing the
  // package boundary must not mean reporting everyone who does it.
  fixture(root, 'packages/cross-package-compliant', {
    'package.json': ARTIFACT_MANIFEST('@fx/cross-package-compliant'),
    'src/thing.test.ts': "import { relayed } from '@fx/relay';\nexport default relayed;\n",
    'vitest.config.ts':
      "import path from 'path';\nexport default { resolve: { alias: {\n" +
      "  '@fx/relay': path.resolve(__dirname, '../relay/src/index.ts'),\n" +
      "  '@fx/core/logger': path.resolve(__dirname, '../core/src/logger.ts'),\n" +
      "  '@fx/core': path.resolve(__dirname, '../core/src/index.ts'),\n" +
      '} } };\n',
  });

  // (13) the domain extends as far as the alias chain does: consumer → relay →
  // mid → the mangled subpath. A walk that crossed exactly one boundary and
  // stopped would miss this the way the package-scoped walk missed #8349.
  fixture(root, 'packages/mid', {
    'package.json': ARTIFACT_MANIFEST('@fx/mid'),
    'src/index.ts': "import { log } from '@fx/core/logger';\nexport const mid = log;\n",
  });
  fixture(root, 'packages/relay-deep', {
    'package.json': ARTIFACT_MANIFEST('@fx/relay-deep'),
    'src/index.ts': "import { mid } from '@fx/mid';\nexport const deep = mid;\n",
  });
  fixture(root, 'packages/cross-package-depth2', {
    'package.json': ARTIFACT_MANIFEST('@fx/cross-package-depth2'),
    'src/thing.test.ts': "import { deep } from '@fx/relay-deep';\nexport default deep;\n",
    'vitest.config.ts':
      "import path from 'path';\nexport default { resolve: { alias: {\n" +
      "  '@fx/relay-deep': path.resolve(__dirname, '../relay-deep/src/index.ts'),\n" +
      "  '@fx/mid': path.resolve(__dirname, '../mid/src/index.ts'),\n" +
      "  '@fx/core': path.resolve(__dirname, '../core/src/index.ts'),\n" +
      '} } };\n',
  });

  // (14) crossing is GATED on the alias landing on source. This consumer reaches
  // relay too, but does not alias it — at run time relay loads from its own
  // `dist/`, resolving its imports itself, so the consumer's `@fx/core` key
  // never sees `@fx/core/logger`. Reporting it here would be inventing a
  // failure. (The unaliased `@fx/relay` is a LEDGER matter, and registered.)
  fixture(root, 'packages/no-cross-unaliased', {
    'package.json': ARTIFACT_MANIFEST('@fx/no-cross-unaliased'),
    'src/thing.test.ts': "import { relayed } from '@fx/relay';\nexport default relayed;\n",
    'vitest.config.ts':
      "import path from 'path';\nexport default { resolve: { alias: {\n" +
      "  '@fx/core': path.resolve(__dirname, '../core/src/index.ts'),\n" +
      '} } };\n',
  });

  // (15) comments are not imports. The real `packages/spec/src/index.ts` opens
  // with a JSDoc fence demonstrating subpath imports; read as code it invented
  // ENOTDIR findings against nine configs for a specifier nobody imports.
  fixture(root, 'packages/documented', {
    'package.json': ARTIFACT_MANIFEST('@fx/documented'),
    'src/index.ts':
      '/**\n * Usage:\n * ```ts\n' +
      " * import * as Docs from '@fx/core/docs-only';\n" +
      ' * ```\n */\n' +
      "export const documented = 1;\n",
  });
  fixture(root, 'packages/reads-documented', {
    'package.json': ARTIFACT_MANIFEST('@fx/reads-documented'),
    'src/thing.test.ts': "import { documented } from '@fx/documented';\nexport default documented;\n",
    'vitest.config.ts':
      "import path from 'path';\nexport default { resolve: { alias: {\n" +
      "  '@fx/documented': path.resolve(__dirname, '../documented/src/index.ts'),\n" +
      "  '@fx/core': path.resolve(__dirname, '../core/src/index.ts'),\n" +
      '} } };\n',
  });

  // ── (16-19) THE LATENT HALF (#9674) ───────────────────────────────────────
  //
  // The reachability-independent rule. `@fx/publisher` PUBLISHES `./leaf` in its
  // export map and serves it from a FILE, so a bare prefix entry for the package
  // mangles it — whether or not anything imports it. On the real repo that shape
  // sat green over eleven (config, subpath) pairs: rule 5 asks what a suite
  // resolves today, and none of those specifiers had been reached yet.
  fixture(root, 'packages/publisher', {
    'package.json': JSON.stringify(
      {
        name: '@fx/publisher',
        main: 'dist/index.js',
        exports: { '.': { import: './dist/index.js' }, './leaf': { import: './dist/leaf.js' } },
      },
      null,
      2,
    ),
    'src/index.ts': 'export const published = 1;\n',
    'src/leaf.ts': 'export const leaf = 1;\n',
  });

  // (16) violating, and INVISIBLE to rule 5: no file here — and nothing this
  // config aliases — writes `@fx/publisher/leaf`. The table is judged on what it
  // would do with the specifier, not on whether anyone has asked yet.
  fixture(root, 'packages/latent-prefix-trap', {
    'package.json': ARTIFACT_MANIFEST('@fx/latent-prefix-trap'),
    'src/thing.test.ts': "import { published } from '@fx/publisher';\nexport default published;\n",
    'vitest.config.ts':
      "import path from 'path';\nexport default { resolve: { alias: [\n" +
      "  { find: '@fx/publisher', replacement: path.resolve(__dirname, '../publisher/src/index.ts') },\n" +
      '] } };\n',
  });

  // (17) the negative control that keeps (16) honest: the published subpath
  // listed ahead of the bare entry, which is the whole remediation.
  fixture(root, 'packages/latent-prefix-fixed', {
    'package.json': ARTIFACT_MANIFEST('@fx/latent-prefix-fixed'),
    'src/thing.test.ts': "import { published } from '@fx/publisher';\nexport default published;\n",
    'vitest.config.ts':
      "import path from 'path';\nexport default { resolve: { alias: [\n" +
      "  { find: /^@fx\\/publisher\\/leaf$/, replacement: path.resolve(__dirname, '../publisher/src/leaf.ts') },\n" +
      "  { find: '@fx/publisher', replacement: path.resolve(__dirname, '../publisher/src/index.ts') },\n" +
      '] } };\n',
  });

  // (18) …and when a test DOES reach the specifier, it is reported ONCE. Rule 5's
  // finding is the stronger of the two — it carries how the specifier arrives —
  // so the latent rule must stand down rather than restate it.
  fixture(root, 'packages/latent-prefix-reached', {
    'package.json': ARTIFACT_MANIFEST('@fx/latent-prefix-reached'),
    'src/thing.test.ts': "import { leaf } from '@fx/publisher/leaf';\nexport default leaf;\n",
    'vitest.config.ts':
      "import path from 'path';\nexport default { resolve: { alias: [\n" +
      "  { find: '@fx/publisher', replacement: path.resolve(__dirname, '../publisher/src/index.ts') },\n" +
      '] } };\n',
  });

  // (19) a config in a package with NO test files. It resolves nothing itself,
  // but it is a table like any other, and one nobody exercises is where this
  // trap survives longest — the scan bails out on `!reachable` AFTER this rule.
  fixture(root, 'packages/latent-no-tests', {
    'package.json': ARTIFACT_MANIFEST('@fx/latent-no-tests'),
    'src/index.ts': "export const untested = 1;\n",
    'vitest.config.ts':
      "import path from 'path';\nexport default { resolve: { alias: [\n" +
      "  { find: '@fx/publisher', replacement: path.resolve(__dirname, '../publisher/src/index.ts') },\n" +
      '] } };\n',
  });

  // ── (20-24) THE CLOCKED-WINDOW RULE (#10126) ──────────────────────────────
  //
  // `@fx/core` resolves to `dist/`, and none of these five aliases it, so every
  // one of them is in the ledger. What separates them is WHERE the first load is
  // paid: collection is unclocked, a hook or a test body is not.

  // (20) violating, in the incident's own two shapes: a hook and a test body,
  // with no module-scope load anywhere in the file. `import.meta` style, an
  // arrow hook, a `function` test body and a nested helper are all here so the
  // brace scanner is exercised on more than one spelling of "a function".
  fixture(root, 'packages/clocked-load', {
    'package.json': ARTIFACT_MANIFEST('@fx/clocked-load'),
    'src/thing.test.ts':
      "import { describe, it, beforeAll } from 'vitest';\n" +
      'beforeAll(async () => {\n' +
      "  await import('@fx/core');\n" +
      '});\n' +
      "describe('x', () => {\n" +
      "  it('y', async function (): Promise<void> {\n" +
      '    const load = async () => {\n' +
      "      await import('@fx/core/logger');\n" +
      '    };\n' +
      '    await load();\n' +
      '  });\n' +
      '});\n',
  });

  // (21) THE BOTH-PRESENT LEG. The same dynamic call inside the same hook — but
  // the module top already loaded the specifier, so the transform is paid during
  // collection and the dynamic call is a registry lookup. Compliant, and the
  // real remediation shape (PR #10120), so a reader that reports it has undone
  // the fix rather than found a defect.
  fixture(root, 'packages/clocked-load-paid', {
    'package.json': ARTIFACT_MANIFEST('@fx/clocked-load-paid'),
    'src/thing.test.ts':
      "import { it } from 'vitest';\n" +
      "import '@fx/core';\n" +
      "it('y', async () => {\n" +
      "  const mod = await import('@fx/core');\n" +
      '  return mod;\n' +
      '});\n',
  });

  // (22) THE DECOY. A dynamic import in a test body of a specifier that is NOT
  // in this package's measured set — `@fx/source-only` resolves to source, so it
  // is not a stale-able artifact and is not in the ledger. Flagging it would
  // silently re-scope the rule from the registry's population to "every import
  // anywhere", which is a different card.
  fixture(root, 'packages/source-only', {
    'package.json': JSON.stringify({ name: '@fx/source-only', exports: { '.': './src/index.ts' } }, null, 2),
    'src/index.ts': 'export const so = 1;\n',
  });
  fixture(root, 'packages/clocked-decoy', {
    'package.json': ARTIFACT_MANIFEST('@fx/clocked-decoy'),
    'src/thing.test.ts':
      "import { it } from 'vitest';\n" +
      "import '@fx/core';\n" +
      "it('y', async () => {\n" +
      "  const a = await import('@fx/source-only');\n" +
      "  const b = await import('./local.js');\n" +
      "  const c = require('node:path');\n" +
      '  return [a, b, c];\n' +
      '});\n',
    'src/local.ts': 'export const local = 1;\n',
  });

  // (23) MODULE SCOPE IS NOT ONLY A STATIC IMPORT. A top-level `await import()`
  // — and one inside a top-level `if`/`try` block, which is still module scope —
  // is paid during collection by the same measurement. Reporting these would be
  // inventing a failure, and the brace scanner is what tells them from a hook.
  fixture(root, 'packages/clocked-top-level-await', {
    'package.json': ARTIFACT_MANIFEST('@fx/clocked-top-level-await'),
    'src/thing.test.ts':
      "import { it } from 'vitest';\n" +
      "await import('@fx/core');\n" +
      'if (process.env.X) {\n' +
      "  await import('@fx/core/logger');\n" +
      '}\n' +
      "it('y', async () => {\n" +
      "  const mod = await import('@fx/core');\n" +
      "  const sub = await import('@fx/core/logger');\n" +
      '  return [mod, sub];\n' +
      '});\n',
  });

  // (24) A TYPE QUERY IS NOT A LOAD. `typeof import('x')` is erased before
  // anything resolves, so it is neither a finding nor a compliance token — the
  // shape `sys-metadata-repository.history-counters.test.ts` really writes.
  // The dynamic call in the body is therefore still reported: the type query
  // must not have quietly satisfied the rule.
  fixture(root, 'packages/clocked-type-query', {
    'package.json': ARTIFACT_MANIFEST('@fx/clocked-type-query'),
    'src/thing.test.ts':
      "import { it } from 'vitest';\n" +
      "type Core = typeof import('@fx/core');\n" +
      "it('y', async () => {\n" +
      "  const mod: Core = await import('@fx/core');\n" +
      '  return mod;\n' +
      '});\n',
  });

  // (25) THE SIGNATURE THAT DEFEATED THE CLASSIFIER ONCE. A module-level helper
  // called from test bodies, whose parameter list spans lines and whose return
  // type is `Promise< { … } >` — braces, a semicolon and newlines all between
  // the parameter list and the body `{`. A backward walk that bailed on any of
  // the three read this as "not a function body" and exempted the file
  // SILENTLY, which is how `serve-marketplace-offline-runtime-config.test.ts`
  // sat green through the sweep this rule shipped with.
  fixture(root, 'packages/clocked-typed-signature', {
    'package.json': ARTIFACT_MANIFEST('@fx/clocked-typed-signature'),
    'src/thing.test.ts':
      "import { it } from 'vitest';\n" +
      'async function boot(options: {\n' +
      '  dir: string;\n' +
      '  extra?: readonly unknown[];\n' +
      '}): Promise<{ mod: object; dir: string }> {\n' +
      "  const mod = await import('@fx/core');\n" +
      '  return { mod, dir: options.dir };\n' +
      '}\n' +
      "it('y', async () => boot({ dir: '.' }));\n",
  });

  return root;
}

function selfTest() {
  const root = buildFixtureTree();
  const problems = [];
  const expect = (condition, message) => {
    if (!condition) problems.push(message);
  };
  const has = (failures, needle) => failures.some((f) => f.includes(needle));

  try {
    // Baseline: the fixtures the registry does not cover must all be reported.
    const bare = check(root, {});
    expect(has(bare.failures, 'packages/violator'), 'violating package with no config was not reported');
    expect(!has(bare.failures, 'packages/compliant'), 'compliant package was reported');
    expect(!has(bare.failures, 'packages/type-only'), 'type-only import was treated as a runtime hazard');
    expect(!has(bare.failures, 'packages/unreachable'), 'an import no test can reach was treated as a hazard');
    expect(has(bare.failures, 'ENOTDIR'), 'the prefix/ENOTDIR alias trap was not detected');
    expect(has(bare.failures, 'cannot be read statically'), 'a config with spread aliases was read as aliasing nothing');

    // ── the remediation hint is MEASURED, not a template (#8256) ──────────
    //
    // The old text named the bare dependency and printed one anchored-BARE
    // entry for it. Following that verbatim fixes nothing for an importer that
    // only ever writes subpaths, and the message then repeats unchanged. Each
    // assertion below pins one fact the hint must carry from the measurement
    // rather than from a shape guess.
    const subpathOnly = bare.failures.find((f) => f.startsWith('packages/subpath-only')) ?? '';
    expect(
      subpathOnly.includes('@fx/core/logger') &&
        subpathOnly.includes('@fx/core/nested') &&
        subpathOnly.includes('@fx/core/ghost'),
      'the hint did not print the specifiers the gate measured — it named the bare dependency only',
    );
    expect(
      subpathOnly.includes('find: /^@fx\\/core\\/nested$/'),
      'the hint emitted no anchored entry for a measured subpath specifier (the old `deps[0]`-only template)',
    );
    // The counterexample that rules a one-size capture rule out: same package,
    // same shape of specifier, two different targets. A rule deriving the path
    // from the specifier gets exactly one of these two right.
    expect(
      subpathOnly.includes("'../core/src/logger.ts'"),
      'a subpath served by a FILE was not measured to that file — a capture rule would say `logger/index.ts`',
    );
    expect(
      subpathOnly.includes("'../core/src/nested/index.ts'"),
      'a subpath served by a DIRECTORY was not measured through its index — the same rule cannot do both',
    );
    // Fail-soft: unmeasurable must print as unmeasurable.
    expect(
      subpathOnly.includes(UNMEASURED_TARGET) && !subpathOnly.includes('src/ghost'),
      'a subpath with no counterpart under `src/` was given an invented replacement path',
    );
    // The wrong turn this card exists to stop (#7778): the object form passes
    // this gate by prefix-matching and dies with ENOTDIR at run time.
    expect(
      subpathOnly.includes('matches by PREFIX') && subpathOnly.includes('ENOTDIR'),
      'a subpath-only importer was not warned off the object form, the next guess that survives review',
    );
    // …and the warning is scoped to the case where it applies. A package
    // imported only bare cannot hit prefix-matching, and telling it about the
    // trap anyway is how a diagnostic becomes noise nobody reads.
    const bareOnly = bare.failures.find((f) => f.startsWith('packages/violator')) ?? '';
    expect(
      bareOnly.includes("find: /^@fx\\/core$/") && bareOnly.includes("'../core/src/index.ts'"),
      'the bare importer lost the anchored-bare entry, which was right for it all along',
    );
    expect(
      !bareOnly.includes('matches by PREFIX'),
      'the object-form warning was printed for an importer with no subpath specifier',
    );
    // The two reasons a specifier lands in the ledger are different repairs:
    // no entry matched it at all, versus an entry matched and points at `dist/`.
    expect(
      (bare.failures.find((f) => f.startsWith('packages/template-to-dist')) ?? '').includes('lands on'),
      'a specifier whose alias lands on `dist/` was reported as having no alias entry at all',
    );

    // ── the canary (#8020) ────────────────────────────────────────────────
    // Escaped-slash regex `find` AND template-literal `replacement`, together,
    // exactly as the two real configs write them. Both spellings have already
    // broken a reader of these configs; neither may break this one again.
    expect(
      !has(bare.failures, 'packages/canary'),
      'the canary config (escaped-slash regex find + template-literal replacement) was reported as unaliased',
    );
    // Reading a template must not degrade into waving it past: one that lands
    // on `dist/` is still unaliased, and one that resolves THROUGH a file is
    // still the ENOTDIR trap — both require the chunks to be really joined.
    expect(
      has(bare.failures, 'packages/template-to-dist'),
      'a template-literal replacement resolving to `dist/` was read as aliased to source',
    );
    expect(
      has(bare.failures, '@fx/core/logger` to `') && has(bare.failures, 'packages/template-prefix-trap'),
      'the ENOTDIR trap went unseen through a template-literal replacement',
    );
    // Fail-closed: a hole with nothing readable in it is UNREADABLE, never a
    // config that aliases nothing.
    expect(
      has(bare.failures, 'packages/opaque-template'),
      'a template replacement interpolating a non-literal was read as aliasing nothing',
    );
    expect(
      bare.failures.some((f) => f.includes('packages/opaque-template') && f.includes('cannot be read statically')),
      'an unreadable `${…}` hole did not fail as unreadable',
    );

    // Both directions on the canary: registering a package the reader can now
    // see through is the stale half, and it must name itself for deletion —
    // this is the shape of the two real entries that came off in #8020.
    const canaryRegistered = check(root, { '@fx/violator': ['@fx/core'], '@fx/canary': ['@fx/core'] });
    expect(
      has(canaryRegistered.failures, '@fx/canary') && has(canaryRegistered.failures, 'no longer needed'),
      'a registry entry for the now-readable canary config did not fail the both-directions audit',
    );

    // Registered at the measured state: the violator goes quiet, nothing else does.
    const registered = check(root, { '@fx/violator': ['@fx/core'] });
    expect(!has(registered.failures, 'packages/violator'), 'a correctly registered package still failed');
    expect(!has(registered.failures, '@fx/violator'), 'a correctly registered package still failed the both-directions audit');

    // Both-directions audit — an entry that is no longer needed must fail.
    const stale = check(root, { '@fx/violator': ['@fx/core'], '@fx/compliant': ['@fx/core'] });
    expect(has(stale.failures, 'no longer needed'), 'a registry entry for an already-fixed package did not fail');

    // …and one naming a package that does not exist.
    const ghost = check(root, { '@fx/violator': ['@fx/core'], '@fx/ghost': ['@fx/core'] });
    expect(has(ghost.failures, '@fx/ghost'), 'a registry entry for a non-existent package did not fail');

    // Growth: an entry that is too NARROW must fail rather than absorb the drift.
    fixture(root, 'packages/violator', {
      'src/second.ts': "import { log } from '@fx/core/logger';\nexport default log;\n",
      'src/thing.ts': "import { alive } from '@fx/core';\nimport { other } from '@fx/other';\nexport const thing = alive + other;\n",
    });
    fixture(root, 'packages/other', {
      'package.json': ARTIFACT_MANIFEST('@fx/other'),
      'src/index.ts': 'export const other = 1;\n',
    });
    const grown = check(root, { '@fx/violator': ['@fx/core'] });
    expect(has(grown.failures, 'NEW unaliased artifact import'), 'a new unaliased import under an existing entry did not fail');
    // #8576. The refusal above turns the registry remedy down; this pins that it
    // also says WHY, in the text the author reads. Asserted on the planted
    // violation, never on a green run — the string only ever prints on failure.
    expect(
      has(grown.failures, '⛔ SHRINK-ONLY'),
      'the refusal no longer states WHY it refuses — the registry\'s shrink-only nature is back to being '
        + 'comment-only, which tells the maintainer reading the script and not the author tripping the gate',
    );

    // Shrink: an entry wider than the measurement must fail too — no headroom.
    const wide = check(root, { '@fx/violator': ['@fx/core', '@fx/other', '@fx/gone'] });
    expect(has(wide.failures, 'STALE'), 'a registry entry listing a dep that is no longer unaliased did not fail');

    // A dependency that resolves to SOURCE is not an artifact and needs no alias.
    fixture(root, 'packages/source-dep', {
      'package.json': JSON.stringify({ name: '@fx/source-dep', exports: { '.': './src/index.ts' } }, null, 2),
      'src/index.ts': 'export const s = 1;\n',
    });
    fixture(root, 'packages/consumes-source', {
      'package.json': ARTIFACT_MANIFEST('@fx/consumes-source'),
      'src/thing.test.ts': "import { s } from '@fx/source-dep';\nexport default s;\n",
    });
    const sourceDep = check(root, { '@fx/violator': ['@fx/core', '@fx/other'] });
    expect(!has(sourceDep.failures, '@fx/consumes-source'), 'a dep that already resolves to source was reported as a hazard');

    // ── the cross-boundary walk (#8351) ───────────────────────────────────
    // Aliasing a dep to source imports ITS import surface into this config's
    // resolution domain. Each of these pins one half of that; the registry
    // fixture keeps the ledger-only entries quiet so the rule-5 half is read
    // against a clean list.
    const cross = check(root, {
      '@fx/violator': ['@fx/core', '@fx/other'],
      '@fx/no-cross-unaliased': ['@fx/relay'],
      '@fx/reads-documented': ['@fx/core'],
    });
    expect(
      cross.failures.some((f) => f.includes('packages/cross-package-trap') && f.includes('@fx/core/logger')),
      'a subpath import reached ONLY through an aliased-to-source dependency was not judged by rule 5 — the #8349 miss',
    );
    expect(
      cross.failures.some((f) => f.includes('packages/cross-package-trap') && f.includes('reached through this config')),
      'the cross-boundary diagnostic did not say the specifier comes from an aliased dependency rather than this package',
    );
    expect(
      !has(cross.failures, 'packages/cross-package-compliant'),
      'a config that correctly orders the subpath entry ahead of the bare one was reported anyway',
    );
    expect(
      cross.failures.some((f) => f.includes('packages/cross-package-depth2') && f.includes('@fx/core/logger')),
      'the walk stopped after one boundary — a mangled subpath two aliased hops out went unseen',
    );
    expect(
      !cross.failures.some((f) => f.includes('packages/no-cross-unaliased') && f.includes('ENOTDIR')),
      'a dependency this config does NOT alias to source was walked into anyway, inventing a failure',
    );
    // The ledger must be untouched by the crossing: rule 5 gets the cross-
    // boundary specifiers, `KNOWN_UNALIASED_TEST_IMPORTS` never does.
    expect(
      !cross.failures.some(
        (f) => f.includes('cross-package-trap') && f.includes('with no source alias'),
      ),
      'a cross-boundary specifier leaked into the unaliased-artifact ledger, which is registry-audited',
    );
    // Comments are prose, not resolution.
    expect(
      !has(cross.failures, 'docs-only'),
      'a specifier appearing only inside a JSDoc example was read as a real import',
    );

    // ── the latent half (#9674) ───────────────────────────────────────────
    // Judged without a reader: the population is the dependency's export map.
    expect(
      cross.failures.some((f) => f.includes('packages/latent-prefix-trap') && f.includes('@fx/publisher/leaf')),
      'a published subpath the bare prefix entry would mangle went unreported because no test reaches it',
    );
    expect(
      cross.failures.some((f) => f.includes('packages/latent-prefix-trap') && f.includes('Latent, not currently failing')),
      'the latent finding did not say it is latent — read as a live failure, it sends the reader hunting a red suite',
    );
    // The remediation must be the one that keeps the trap detectable, not the
    // one that hides it: anchoring the bare entry sends the subpath to `dist/`.
    expect(
      cross.failures.some((f) => f.includes('packages/latent-prefix-trap') && f.includes('Do NOT anchor the bare entry')),
      'the latent finding did not warn off anchoring the bare entry, the fix that silences it by silencing the match',
    );
    expect(
      cross.failures.some(
        (f) => f.includes('packages/latent-prefix-trap') && f.includes("find: /^@fx\\/publisher\\/leaf$/"),
      ),
      'the latent finding printed no anchored subpath entry to add',
    );
    expect(
      !has(cross.failures, 'packages/latent-prefix-fixed'),
      'a table listing the published subpath ahead of the bare entry was reported anyway',
    );
    // A config in a package with no tests is still a table.
    expect(
      cross.failures.some((f) => f.includes('packages/latent-no-tests') && f.includes('@fx/publisher/leaf')),
      'a config in a package with no test files was skipped — the bail-out ran before the rule',
    );
    // Deduped: one edit, one failure.
    expect(
      cross.failures.filter((f) => f.includes('packages/latent-prefix-reached') && f.includes('@fx/publisher/leaf'))
        .length === 1,
      'a subpath a test really reaches was reported twice — by the reachability rule and by the latent one',
    );
    expect(
      cross.failures.some(
        (f) => f.includes('packages/latent-prefix-reached') && f.includes('ENOTDIR at run time') && !f.includes('Latent'),
      ),
      'a reached subpath lost rule 5\'s finding — the dedupe dropped the stronger of the two',
    );

    // ── the clocked-window rule (#10126) ──────────────────────────────────
    //
    // Observed failing and observed silent, one leg per boundary the header
    // states. The `has`/`!has` helpers cannot serve the silent legs here: every
    // one of these fixtures ALSO carries an unregistered ledger entry, so a bare
    // package-name search matches for a reason that has nothing to do with this
    // rule. Each silent assertion is therefore scoped to the rule's own sentence.
    const clockedIn = (needle) =>
      cross.failures.filter((f) => f.includes(needle) && f.includes('a CLOCKED window'));

    // The hook shape — `beforeAll(async () => { await import(…) })`, the second
    // of the two spellings that ejected PR #10120 from the merge queue.
    expect(
      clockedIn('packages/clocked-load/src/thing.test.ts:3').some((f) => f.includes("import('@fx/core')")),
      'a dynamic import inside a `beforeAll` hook was not reported — the exact shape of the #10115 incident',
    );
    // …and the test-body shape, reached through a nested arrow inside an
    // `async function (): Promise< T >` body, so the brace scanner is pinned on
    // more than the one arrow spelling.
    expect(
      clockedIn('packages/clocked-load/src/thing.test.ts:8').some((f) => f.includes("import('@fx/core/logger')")),
      'a dynamic import nested two functions deep inside an `it()` body went unseen — the brace scanner reads only `=> {`',
    );
    // Counted on the FULL path: `packages/clocked-load` is also a prefix of
    // `packages/clocked-load-paid`, and a loose needle here reads that fixture's
    // findings as this one's — measured, when an ablation of the compliance leg
    // moved this count to 3 for a reason that was in the assertion, not the gate.
    expect(
      clockedIn('packages/clocked-load/src/thing.test.ts').length === 2,
      'the clocked-window rule did not report exactly the two loads this fixture pays in a clocked window',
    );
    // The remedy is the one PR #10120 landed, printed as a line to paste.
    expect(
      clockedIn('packages/clocked-load/src/thing.test.ts').every(
        (f) => f.includes('COLLECTION') && f.includes("import '@fx/"),
      ),
      'the clocked-window finding printed no module-top import to add, or did not say where the cost moves TO',
    );
    // The convention sentence itself, carried in the text the author reads.
    // #10126 asked for it in a doc; the doc that should hold it is on a
    // headroom-0 line ceiling, so until that is ruled on, THIS is where an
    // author meets it — which makes it a pin, not a comment.
    expect(
      clockedIn('packages/clocked-load/src/thing.test.ts').every((f) =>
        f.includes('clocked windows measure behaviour, never loading'),
      ),
      'the clocked-window finding no longer states the convention it enforces — the sentence is back to being comment-only',
    );

    // BOTH PRESENT IS COMPLIANT: the module top already paid it, so the dynamic
    // call is a registry lookup. A reader that reports this has undone the fix.
    expect(
      clockedIn('packages/clocked-load-paid').length === 0,
      'a file with the module-top import AND the dynamic call was reported anyway — that is the remediation, not the defect',
    );

    // THE DECOY: a dynamic import of a specifier outside the measured set
    // (`@fx/source-only` resolves to source), plus a relative import and a node
    // builtin. None is a stale-able artifact and none may be flagged.
    expect(
      clockedIn('packages/clocked-decoy').length === 0,
      'the clocked-window rule flagged a specifier outside the ledger population — it has re-scoped itself to every import anywhere',
    );

    // Module scope is wider than "a static import": a top-level `await import()`,
    // and one inside a top-level `if` block, are both paid during collection.
    expect(
      clockedIn('packages/clocked-top-level-await').length === 0,
      'a module-scope dynamic import was not accepted as paying the load — the rule invents a failure for top-level await',
    );

    // …and a TYPE QUERY is neither. `typeof import('x')` is erased before
    // anything resolves, so it cannot satisfy the rule on the file's behalf.
    expect(
      clockedIn('packages/clocked-type-query/src/thing.test.ts:4').length === 1,
      "`typeof import('x')` was read as a real module-scope load, and silenced a finding it never paid for",
    );

    // A module-level helper called from a test body is still a clocked window,
    // and its signature is where this classifier is hardest. Pinned by shape
    // because the corpus taught it: the miss was silent, and a silent exemption
    // is indistinguishable from compliance in every report the gate prints.
    expect(
      clockedIn('packages/clocked-typed-signature/src/thing.test.ts:6').length === 1,
      'a helper whose multi-line signature ends `}): Promise< { … } > {` was read as not a function body — a SILENT exemption',
    );

    // The population the green line prints has to BE a number. `check()` returning
    // it under a different name still passes every failure assertion above and
    // reports `undefined published subpath(s)` — a census nobody can read.
    expect(
      typeof cross.publishedCount === 'number' && cross.publishedCount > 0,
      'the published-subpath population is not returned as a positive number — the green line\'s census is unreadable',
    );

    // Census guard: an empty tree is a broken scanner, never a clean repo.
    const empty = join(tmpdir(), `os-test-source-alias-empty-${process.pid}`);
    rmSync(empty, { recursive: true, force: true });
    mkdirSync(empty, { recursive: true });
    const emptyResult = check(empty, {});
    expect(has(emptyResult.failures, 'the scan is broken'), 'an empty tree did not trip the census guard');
    expect(
      has(emptyResult.failures, 'publishing a subpath export'),
      'an empty tree did not trip the published-subpath census guard — a population that silently went to zero',
    );
    rmSync(empty, { recursive: true, force: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  if (problems.length > 0) {
    console.error('check-test-source-alias --self-test FAILED:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log('check-test-source-alias --self-test OK');
}

// ── entry point ─────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
if (argv.includes('--self-test')) {
  selfTest();
} else if (argv.includes('--list')) {
  printList(REPO_ROOT);
} else {
  const { failures, packages, measured, publishedCount } = check(REPO_ROOT, KNOWN_UNALIASED_TEST_IMPORTS);
  if (failures.length > 0) {
    console.error('check-test-source-alias FAILED\n');
    for (const failure of failures) console.error(`  ✗ ${failure}\n`);
    console.error(
      'A unit test must be a verdict about the source in the checkout. See this file\'s header for\n' +
        'why the dangerous case is a test that PASSES.',
    );
    process.exit(1);
  }
  console.log(
    `check-test-source-alias OK — ${packages.length} packages with tests scanned; ` +
      `${measured.size} registered as still resolving a workspace dep through \`dist/\`; ` +
      `${publishedCount} published subpath(s) resolved through every alias table.`,
  );
}
