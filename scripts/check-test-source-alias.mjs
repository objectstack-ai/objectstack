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
  '@objectstack/example-showcase': [
    '@objectstack/cloud-connection', '@objectstack/connector-mcp', '@objectstack/connector-openapi',
    '@objectstack/connector-rest', '@objectstack/connector-slack', '@objectstack/core',
    '@objectstack/driver-sql', '@objectstack/formula', '@objectstack/objectql',
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
    '@objectstack/plugin-hono-server', '@objectstack/plugin-security', '@objectstack/rest',
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

  return { testCount: tests.length, imports, crossPackage };
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

const REGEX_CAN_START_AFTER = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>', '']);

/**
 * Remove comments, leaving strings, template literals and regex literals
 * intact. Needed because these configs carry long rationale comments that name
 * the very specifiers being matched — reading one as an alias would report a
 * package as safe on the strength of a paragraph about why it is not.
 */
function stripComments(src) {
  let out = '';
  let previous = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      out += c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === c) {
          i++;
          break;
        }
        i++;
      }
      previous = c;
      continue;
    }
    if (c === '/' && REGEX_CAN_START_AFTER.has(previous)) {
      const end = scanRegexLiteral(src, i);
      if (end > 0) {
        out += src.slice(i, end);
        i = end;
        previous = '/';
        continue;
      }
    }
    out += c;
    if (!/\s/.test(c)) previous = c;
    i++;
  }
  return out;
}

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

// ── the scan ────────────────────────────────────────────────────────────────

/**
 * @returns {{ packages: Array, artifactPackages: Set<string>, totalPackages: number }}
 */
function scan(root) {
  // Per-scan, not per-process: `--self-test` rewrites fixture files BETWEEN
  // `check()` calls to exercise registry drift, and a cache that outlived a
  // scan would answer those later passes from the pre-rewrite content.
  importCache.clear();
  const workspace = listWorkspacePackages(root);
  const names = new Set(workspace.map((p) => p.name));
  const artifactPackages = new Set(workspace.filter((p) => resolvesToArtifact(p.json)).map((p) => p.name));

  const packages = [];
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

    const crossInto =
      entries.length > 0 ? (spec) => aliasedSourceFile(spec, entries, dirname(configPath), root) : null;
    const reachable = testReachableWorkspaceImports(pkg, names, crossInto);
    if (!reachable) continue;

    const unaliased = [];
    const throughAFile = [];
    for (const [dep, specs] of [...reachable.imports].sort(([a], [b]) => a.localeCompare(b))) {
      if (!artifactPackages.has(dep)) continue; // resolves to source already; not an artifact
      let anyUnaliased = false;
      for (const spec of [...specs].sort()) {
        const resolved = resolveThroughAliases(spec, entries);
        if (!resolved) {
          anyUnaliased = true;
          continue;
        }
        if (THROUGH_A_FILE.test(resolved.result)) {
          throughAFile.push({ spec, result: resolved.result, via: null });
          continue;
        }
        if (!pointsAtSource(resolved.result)) anyUnaliased = true;
      }
      if (anyUnaliased) unaliased.push(dep);
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

    packages.push({
      name: pkg.name,
      rel: pkg.rel,
      testCount: reachable.testCount,
      configPath: configPath ? relative(root, configPath) : null,
      unreadable,
      unaliased,
      throughAFile,
    });
  }

  return { packages, artifactPackages, totalPackages: workspace.length };
}

// ── the gate ────────────────────────────────────────────────────────────────

/** Spell a specifier the way it must appear inside a `/…/` regex literal. */
function escapeForRegexLiteral(spec) {
  return spec.replace(/[/\\^$*+?.()|[\]{}]/g, (c) => '\\' + c);
}

function check(root, registry) {
  const failures = [];
  const { packages, artifactPackages, totalPackages } = scan(root);

  // Census guard. Every reading below is a scan result, and a scan that has
  // quietly stopped matching reports a spotless repo — the #4868 family. Zero
  // is never the good news it looks like.
  if (totalPackages === 0) failures.push('scanner found NO workspace packages at all — the scan is broken, not the repo');
  if (artifactPackages.size === 0)
    failures.push('scanner found NO package resolving to `dist/` — entry-point detection is broken, not the repo');
  if (packages.length === 0) failures.push('scanner found NO package with test files — test discovery is broken, not the repo');

  const measured = new Map(packages.filter((p) => p.unaliased.length > 0).map((p) => [p.name, p.unaliased]));

  for (const pkg of packages) {
    if (pkg.unreadable) {
      failures.push(
        `${pkg.rel}: ${pkg.configPath} cannot be read statically (${pkg.unreadable}).\n` +
          '    This gate must be able to see every alias. Write them as literal entries in this file.',
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

  for (const [name, deps] of measured) {
    const registered = registry[name];
    if (!registered) {
      const pkg = packages.find((p) => p.name === name);
      failures.push(
        `${pkg.rel} (${name}): tests import ${deps.length} workspace package(s) that resolve to \`dist/\` with no source alias:\n` +
          `    ${deps.join(', ')}\n` +
          '    Every verdict in this package is currently a function of build state, not of the source in the\n' +
          '    checkout — and the dangerous case is SILENT (a dist merely behind the source runs GREEN against\n' +
          '    old behaviour). Add the aliases to its vitest.config.ts, anchored-regex/array form:\n' +
          `      alias: [{ find: /^${escapeForRegexLiteral(deps[0])}$/, replacement: path.resolve(__dirname, '<relative>/src/index.ts') }]`,
      );
      continue;
    }
    const added = deps.filter((d) => !registered.includes(d));
    const gone = registered.filter((d) => !deps.includes(d));
    if (added.length > 0)
      failures.push(
        `${name}: NEW unaliased artifact import(s) since this entry was measured: ${added.join(', ')}.\n` +
          '    Alias them in the package\'s vitest.config.* — widening the registry entry is not the fix.',
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

  return { failures, packages, measured };
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
  fixture(root, 'packages/core', {
    'package.json': ARTIFACT_MANIFEST('@fx/core'),
    'src/index.ts': 'export const alive = 1;\n',
    'src/logger.ts': 'export const log = 1;\n',
  });

  // (1) violating: tests import the artifact, no config at all.
  fixture(root, 'packages/violator', {
    'package.json': ARTIFACT_MANIFEST('@fx/violator'),
    'src/thing.ts': "import { alive } from '@fx/core';\nexport const thing = alive;\n",
    'src/thing.test.ts': "import { thing } from './thing';\nexport default thing;\n",
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

    // Census guard: an empty tree is a broken scanner, never a clean repo.
    const empty = join(tmpdir(), `os-test-source-alias-empty-${process.pid}`);
    rmSync(empty, { recursive: true, force: true });
    mkdirSync(empty, { recursive: true });
    const emptyResult = check(empty, {});
    expect(has(emptyResult.failures, 'the scan is broken'), 'an empty tree did not trip the census guard');
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
  const { failures, packages, measured } = check(REPO_ROOT, KNOWN_UNALIASED_TEST_IMPORTS);
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
      `${measured.size} registered as still resolving a workspace dep through \`dist/\`.`,
  );
}
