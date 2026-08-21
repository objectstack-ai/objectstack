#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-published-files -- what each publishable package sends to npm must be a
// declared whitelist, and that whitelist must admit the built artifact only.
//
// The bug it exists to prevent (#4248): 20 of the 49 non-private workspace
// packages declared no `files` field at all, so npm fell back to "pack the
// whole directory". `npm pack --dry-run` on @objectstack/plugin-webhooks listed
// 21 files -- 15 under src/, three of them unit tests, plus a build-time
// scripts/i18n-extract.config.ts. Consumers were installing TypeScript sources,
// the test suite and build tooling, and dist/ would have landed on top of that
// rather than instead of it.
//
// The other 29 packages did declare `files`, nearly all `["dist","README.md"]`,
// so the 20 were an omission rather than a second convention -- the #3786
// shape: a hand-copied line with no gate, where whoever forgets it gets no
// signal at all. Backfilling those 20 fixes one round; this guard is what stops
// the next package from shipping its tests.
//
// It also converts a hand-checked assumption into a continuously verified one.
// #4206 excludes `<pkg>/scripts/**` from the docs-drift "implementation change"
// test, which is sound only while no package publishes scripts/ as runtime
// code. That was established by reading all three offenders by hand; with
// FORBIDDEN below it cannot quietly stop being true.
//
//   node scripts/check-published-files.mjs
//   node scripts/check-published-files.mjs --self-test
//
// Five invariants, per non-private workspace package:
//
//   DECLARED    `files` exists and is a non-empty array of strings.
//   COMPLETE    the whitelist covers `CHANGELOG.md` (#4261). AGENTS.md requires
//               breaking changesets to carry their FROM -> TO migration because
//               that text ships to consumers inside the npm package and is what
//               an upgrading agent greps after a tombstone error -- but npm does
//               not pack CHANGELOG.md unconditionally, so a whitelist that
//               omits it silently severs that delivery path. 68 of 69 packages
//               had it severed when #4261 measured.
//   SUFFICIENT  every path the manifest points at (types, module, exports
//               subpaths) is covered by it. A whitelist that omits a real entry
//               point ships a package that cannot resolve -- the opposite
//               failure, and one this guard would otherwise encourage.
//   MINIMAL     nothing the whitelist admits is a test, a test-harness config
//               or build-time tooling.
//   REGISTERED  any entry beyond the canonical `dist` / `README.md` /
//               `CHANGELOG.md` carries a reason in EXTRA_ENTRIES, reconciled in
//               BOTH directions so a stale exemption is an error rather than
//               dead text.
//
// Deliberately NOT checked: the contents of dist/. It does not exist in a fresh
// checkout and the lint job does not build, so reading it would make the
// verdict depend on local build state -- a gate that passes or fails by
// accident is worse than one with a stated boundary. What ships from dist/ is
// the build's business; this guard is about source leaking past it.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';

// Anchored to the script, not to cwd: the verdict must not depend on where the
// guard was invoked from.
const ROOT = resolve(import.meta.dirname, '..');
const WORKSPACE_FILE = 'pnpm-workspace.yaml';
const SELF = 'scripts/check-published-files.mjs';

// Entries every package may declare without justifying itself: the build
// output, the readme and the changelog. Anything else is a deliberate decision
// and needs a reason.
const CANONICAL = new Set(['dist', 'README.md', 'CHANGELOG.md']);

// Entries every package MUST cover, not merely may declare. CHANGELOG.md is the
// delivery path the AGENTS.md post-task checklist promises: breaking changesets
// write their FROM -> TO migration there, and an upgrading agent with only
// node_modules on disk -- the tombstone-error scenario -- can grep nothing
// else. npm stopped packing CHANGELOG unconditionally (see ALWAYS_PACKED), so
// only an explicit `files` entry keeps that promise true (#4261).
const REQUIRED = ['CHANGELOG.md'];

// Package name -> { files entry -> why it is published }. Reconciled against
// the manifests on every run: an entry here for a pattern no longer declared is
// an error, exactly as an unregistered pattern is. A list that can only grow
// rots into a list nobody trusts.
const EXTRA_ENTRIES = {
  '@objectstack/spec': {
    'json-schema':
      'Generated JSON Schemas -- the machine-readable protocol surface consumers validate metadata against.',
    liveness: 'Per-metadata-type liveness ledgers, read by the ADR-0049 enforce-or-remove tooling.',
    prompts: 'Authoring prompts shipped for agents consuming the protocol.',
    'llms.txt': 'Protocol summary for LLM consumers.',
    'src/**/*.zod.ts':
      'The Zod schemas are themselves the contract (Prime Directive #1); downstream code imports them directly, so these sources are product rather than build input. Narrowed to *.zod.ts so no test or helper rides along.',
    'api-surface':
      'Export snapshot used by downstream compatibility checks — one file per published entry point since #5837.',
    'spec-changes.json': 'Machine-readable spec change log driving the upgrade guide.',
  },
};

// Content that must never reach a consumer, whatever admits it. Each entry is
// a label plus a predicate over the package-relative POSIX path.
const FORBIDDEN = [
  {
    label: 'unit test',
    test: (rel) =>
      /(^|\/)(__tests__|__mocks__|__fixtures__)\//.test(rel) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel),
  },
  {
    label: 'test-harness config',
    test: (rel) => /(^|\/)vitest\.(config|setup|workspace)\.[cm]?[jt]s$/.test(rel),
  },
  {
    label: 'build tooling',
    test: (rel) =>
      /(^|\/)(tsup|rollup|vite|eslint)\.config\.[cm]?[jt]s$/.test(rel) ||
      /(^|\/)tsconfig[^/]*\.json$/.test(rel),
  },
  {
    // The arm #4206 leans on: scripts/ is build-time tooling by convention,
    // never runtime code. If that ever stops being true it must stop being true
    // loudly here, rather than silently in the docs-drift classifier.
    //
    // Spelled as an anchored REGEX, like the three entries above, and that is
    // load-bearing rather than stylistic (#10875). `rel` is package-relative,
    // over the contents of a would-be tarball: this asks whether THIS package
    // ships a scripts/ directory of its own, and says nothing whatever about
    // the repo root of the same name. Written as the quoted literal it used to
    // be -- `rel.startsWith('scripts/')` -- the dispatch derivation
    // (scripts/pm/dispatch-gates.mjs, `extractWatchHints`) reads it as this
    // gate DECLARING the repo's own scripts/ tree as its population. That
    // declaration is false, and it collapses to a bare top-level word
    // `hintCovers` refuses as too generic, so the gate scored `silent` for
    // every card in the tree while appearing to name a root it never opens.
    //
    // Two things not to do here, both of which look like the fix and are not:
    //   - do NOT respell this as a quoted `'scripts/'`. check:pm-dispatch-gates
    //     fails if this gate declares that bare root again, and it decides with
    //     the derivation's own extractor rather than a copy of it;
    //   - do NOT reach for the ROOT_DIR_WATCH_HINTS escape (`['scripts/**']`,
    //     as check-parse-guard and check-role-word legitimately use). For THIS
    //     gate that declaration would be a lie, and a load-bearing one: the
    //     derivation would name this gate for every repo-root scripts/ edit,
    //     which it does not read. A fabricated lead costs more than a missing
    //     one -- see the +139084 measurement in `hintCovers`' docblock.
    label: 'build-time script',
    test: (rel) => /^scripts\//.test(rel),
  },
];

// npm packs these regardless of `files`, so requiring the whitelist to cover
// them would flag packages that work. Measured on npm 10.9.7: packing
// @objectstack/types with `["dist","README.md"]` yielded LICENSE, README.md and
// package.json, and @objectstack/cli's `bin/run.js` shipped although `files`
// never names bin/. CHANGELOG.md is deliberately absent from this set -- older
// npm packed it unconditionally, current npm does not -- which is exactly why
// COMPLETE demands an explicit `files` entry for it (#4261).
const ALWAYS_PACKED = [
  /^package\.json$/,
  /^readme(\.[^/]+)?$/i,
  /^licen[cs]e(\.[^/]+)?$/i,
  /^notice(\.[^/]+)?$/i,
];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', 'coverage']);

/**
 * npm reads `files` entries as gitignore-style patterns. Two forms cover every
 * entry this repo declares: a bare path (a file, or a directory taken whole)
 * and a glob. Negation is rejected up front rather than approximated.
 */
function matcher(pattern) {
  const clean = pattern.replace(/^\.\//, '').replace(/\/$/, '');
  let src = '';
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '*' && clean[i + 1] === '*') {
      // `a/**/b` spans any number of segments, including none.
      const spansSlash = clean[i + 2] === '/';
      src += spansSlash ? '(?:[^/]*/)*' : '.*';
      i += spansSlash ? 2 : 1;
    } else if (c === '*') {
      src += '[^/]*';
    } else if (c === '?') {
      src += '[^/]';
    } else {
      src += /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
    }
  }
  const rx = new RegExp(`^${src}$`);
  // A directory entry takes everything beneath it: `dist` covers `dist/index.js`.
  const prefix = `${clean}/`;
  return (rel) => rx.test(rel) || rel.startsWith(prefix);
}

/**
 * The `packages:` globs from pnpm-workspace.yaml. Blank lines and comments are
 * skipped rather than treated as the end of the list: stopping early would drop
 * members from the scan and report a clean run over a partial workspace, which
 * is the one failure mode a guard must not have.
 */
function workspaceGlobs() {
  const lines = readFileSync(join(ROOT, WORKSPACE_FILE), 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => /^packages\s*:\s*$/.test(l));
  if (start === -1) throw new Error(`${WORKSPACE_FILE}: no top-level \`packages:\` block`);
  const globs = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].replace(/#.*$/, '').trimEnd();
    if (!line.trim()) continue;
    const m = line.match(/^\s+-\s+['"]?([^'"\s]+)['"]?\s*$/);
    if (m) {
      globs.push(m[1]);
      continue;
    }
    if (/^\S/.test(line)) break; // the next top-level key ends the block
  }
  if (globs.length === 0) throw new Error(`${WORKSPACE_FILE}: \`packages:\` block is empty`);
  return globs;
}

/** Workspace member directories, relative to the repo root. */
function workspaceDirs() {
  const dirs = [];
  for (const glob of workspaceGlobs()) {
    // Every pattern in this repo is `<dir>` or `<dir>/*`. Anything richer would
    // silently resolve to nothing, so reject it rather than under-report.
    const star = glob.endsWith('/*');
    const base = star ? glob.slice(0, -2) : glob;
    if (base.includes('*')) {
      throw new Error(
        `${WORKSPACE_FILE}: pattern "${glob}" is richer than <dir> or <dir>/*; extend ${SELF}`,
      );
    }
    const abs = join(ROOT, base);
    if (!existsSync(abs)) continue;
    const candidates = star ? readdirSync(abs).map((e) => posix.join(base, e)) : [base];
    for (const c of candidates) {
      if (existsSync(join(ROOT, c, 'package.json'))) dirs.push(c);
    }
  }
  return dirs.sort();
}

/** Package-relative POSIX paths of every file that is not build output. */
function walk(absDir, prefix = '', out = []) {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const rel = prefix ? posix.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) walk(join(absDir, entry.name), rel, out);
    else out.push(rel);
  }
  return out;
}

/** Every path the manifest resolves to, before npm's always-packed set. */
function entryPoints(manifest) {
  const paths = new Set();
  for (const key of ['main', 'module', 'types', 'typings', 'browser']) {
    if (typeof manifest[key] === 'string') paths.add(manifest[key]);
  }
  const collect = (node) => {
    if (typeof node === 'string') {
      // Only `./`-relative targets are paths; a bare specifier is a re-export.
      if (node.startsWith('./')) paths.add(node);
      return;
    }
    if (node && typeof node === 'object') for (const v of Object.values(node)) collect(v);
  };
  collect(manifest.exports);
  return [...paths].map((p) => p.replace(/^\.\//, '')).sort();
}

/**
 * The pattern semantics above are the one part of this guard that can be wrong
 * without any package being wrong -- a matcher that over-matches turns MINIMAL
 * into noise, and one that under-matches makes SUFFICIENT wave a broken package
 * through. Both failures are silent, so they get asserted rather than assumed.
 */
function selfTest() {
  const cases = [
    ['dist', 'dist/index.js', true],
    ['dist', 'dist/nested/deep/chunk.js', true],
    ['dist', 'dist', true],
    ['dist', 'distant/index.js', false],
    ['dist', 'src/index.ts', false],
    ['README.md', 'README.md', true],
    ['README.md', 'docs/README.md', false],
    // The COMPLETE invariant resolves through this same matcher, so the exact
    // shapes it depends on are pinned: the literal entry, a directory that
    // must NOT swallow it, and the near-miss name.
    ['CHANGELOG.md', 'CHANGELOG.md', true],
    ['dist', 'CHANGELOG.md', false],
    ['CHANGELOG.md', 'CHANGELOG.mdx', false],
    ['src/**/*.zod.ts', 'src/data/object.zod.ts', true],
    ['src/**/*.zod.ts', 'src/index.zod.ts', true],
    ['src/**/*.zod.ts', 'src/data/object.test.ts', false],
    ['src/**/*.zod.ts', 'src/data/object.zod.test.ts', false],
    ['json-schema', 'json-schema/openapi.json', true],
    ['llms.txt', 'llms.txt', true],
    ['llms.txt', 'llmsXtxt', false],
    ['./dist', 'dist/index.js', true],
    ['dist/', 'dist/index.js', true],
    ['*.json', 'api-surface.json', true],
    ['*.json', 'nested/api-surface.json', false],
  ];
  const forbidden = [
    ['src/auto-enqueuer.test.ts', 'unit test'],
    ['src/__tests__/helper.ts', 'unit test'],
    ['src/schema.spec.tsx', 'unit test'],
    ['vitest.config.ts', 'test-harness config'],
    ['tsup.config.ts', 'build tooling'],
    ['tsconfig.build.json', 'build tooling'],
    ['scripts/i18n-extract.config.ts', 'build-time script'],
    // Anchored at the PACKAGE root, which is the whole content of the
    // package-relative claim above: a scripts/ directory nested anywhere else
    // is ordinary source and must not be classified as build tooling.
    ['src/scripts/helper.ts', null],
    ['src/index.ts', null],
    ['src/latest.ts', null],
    ['dist/index.js', null],
    ['README.md', null],
  ];
  const failures = [];
  for (const [pattern, path, expected] of cases) {
    const actual = matcher(pattern)(path);
    if (actual !== expected) {
      failures.push(`matcher("${pattern}")("${path}") === ${actual}, expected ${expected}`);
    }
  }
  for (const [path, expected] of forbidden) {
    const actual = FORBIDDEN.find((f) => f.test(path))?.label ?? null;
    if (actual !== expected) {
      failures.push(`FORBIDDEN("${path}") === ${actual}, expected ${expected}`);
    }
  }
  if (failures.length > 0) {
    console.error(`✗ check:published-files --self-test — ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(
    `✓ check:published-files --self-test — ${cases.length} pattern case(s) and ` +
      `${forbidden.length} classification case(s).`,
  );
}

if (process.argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

const problems = [];
const declaredExtrasByPackage = new Map();
let members = 0;
let publishable = 0;

for (const dir of workspaceDirs()) {
  const manifestPath = posix.join(dir, 'package.json');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(ROOT, manifestPath), 'utf8'));
  } catch (err) {
    problems.push({ dir, name: manifestPath, lines: [`does not parse: ${err.message}`] });
    continue;
  }
  members++;
  if (!manifest.name || manifest.private === true) continue;
  publishable++;

  const name = manifest.name;
  const lines = [];
  const files = manifest.files;

  // --- DECLARED ------------------------------------------------------------
  if (files === undefined) {
    problems.push({
      dir,
      name,
      lines: [
        'declares no `files` field, so npm packs the whole directory -- src/,',
        'unit tests and build tooling included, with dist/ added on top rather',
        'than instead of them.',
        'Fix: add "files": ["dist", "README.md", "CHANGELOG.md"] to its package.json.',
      ],
    });
    continue;
  }
  if (!Array.isArray(files) || files.length === 0 || files.some((f) => typeof f !== 'string')) {
    problems.push({ dir, name, lines: ['`files` must be a non-empty array of strings.'] });
    continue;
  }

  const negated = files.filter((f) => f.startsWith('!'));
  if (negated.length > 0) {
    // Fail closed: modelling npm's ordering rules for negation half-right would
    // make every verdict below untrustworthy for this package.
    problems.push({
      dir,
      name,
      lines: [
        `declares negated pattern(s) ${negated.map((f) => `"${f}"`).join(', ')}, which this guard does not model.`,
        `Fix: express the whitelist positively, or teach ${SELF} to handle negation.`,
      ],
    });
    continue;
  }

  const matchers = files.map((f) => ({ pattern: f, match: matcher(f) }));

  // --- COMPLETE ------------------------------------------------------------
  for (const required of REQUIRED) {
    if (matchers.some((m) => m.match(required))) continue;
    lines.push(
      `omits "${required}" from \`files\`, and npm does not pack it unconditionally, so the`,
      'migration text breaking changesets are required to carry (AGENTS.md post-task',
      'checklist) never reaches the consumer an upgrading agent greps for it (#4261).',
      `Fix: add "${required}" to \`files\`.`,
    );
  }

  // --- REGISTERED ----------------------------------------------------------
  const registered = EXTRA_ENTRIES[name] ?? {};
  const declaredExtras = new Set();
  for (const pattern of files) {
    if (CANONICAL.has(pattern)) continue;
    declaredExtras.add(pattern);
    if (!(pattern in registered)) {
      lines.push(
        `publishes "${pattern}", which is neither \`dist\` nor \`README.md\` and carries no reason.`,
        `Fix: drop it, or register it under '${name}' in EXTRA_ENTRIES (${SELF}) with`,
        '     one line saying what a consumer does with it.',
      );
    }
  }
  declaredExtrasByPackage.set(name, declaredExtras);

  // --- SUFFICIENT ----------------------------------------------------------
  for (const target of entryPoints(manifest)) {
    if (ALWAYS_PACKED.some((rx) => rx.test(target))) continue;
    if (matchers.some((m) => m.match(target))) continue;
    lines.push(
      `resolves to "${target}", which no \`files\` entry covers -- the published package`,
      'could not load it.',
      `Fix: add a pattern covering "${target}", or point the manifest at the built copy.`,
    );
  }

  // --- MINIMAL -------------------------------------------------------------
  const admitted = new Map();
  for (const rel of walk(join(ROOT, dir))) {
    const hit = FORBIDDEN.find((f) => f.test(rel));
    if (!hit) continue;
    const via = matchers.find((m) => m.match(rel));
    if (!via) continue;
    const key = `${hit.label}|${via.pattern}`;
    if (!admitted.has(key)) admitted.set(key, []);
    admitted.get(key).push(rel);
  }
  for (const [key, paths] of admitted) {
    const [label, pattern] = key.split('|');
    const shown = paths.slice(0, 4);
    lines.push(
      `publishes ${paths.length} ${label}${paths.length === 1 ? '' : 's'} via "${pattern}":`,
      ...shown.map((p) => `    ${p}`),
      ...(paths.length > shown.length ? [`    ... and ${paths.length - shown.length} more`] : []),
      '  Fix: narrow the pattern so it admits the built output only.',
    );
  }

  if (lines.length > 0) problems.push({ dir, name, lines });
}

// --- REGISTERED, the other direction ---------------------------------------
// An exemption nobody exercises is stale text that still reads as policy -- the
// same two-way reconciliation `check:generated` does for its gate ledger.
for (const [name, patterns] of Object.entries(EXTRA_ENTRIES)) {
  const declared = declaredExtrasByPackage.get(name);
  if (!declared) {
    problems.push({
      dir: SELF,
      name,
      lines: [
        'is registered in EXTRA_ENTRIES but is not a publishable workspace package.',
        `Fix: remove its block from ${SELF}.`,
      ],
    });
    continue;
  }
  const stale = Object.keys(patterns).filter((p) => !declared.has(p));
  if (stale.length > 0) {
    problems.push({
      dir: SELF,
      name,
      lines: [
        `registers ${stale.map((p) => `"${p}"`).join(', ')}, which its \`files\` no longer declares.`,
        `Fix: remove the stale entry from ${SELF}.`,
      ],
    });
  }
}

if (problems.length > 0) {
  const plural = problems.length === 1 ? 'package publishes' : 'packages publish';
  console.error(`✗ check:published-files — ${problems.length} ${plural} the wrong thing (#4248)\n`);
  for (const p of problems) {
    console.error(`  ${p.name}  (${p.dir})`);
    for (const l of p.lines) console.error(`    ${l}`);
    console.error('');
  }
  console.error(
    'Without a `files` whitelist npm packs the whole package directory, so consumers\n' +
      'install TypeScript sources, unit tests and build-time tooling alongside dist/.\n' +
      'The canonical whitelist is ["dist", "README.md", "CHANGELOG.md"]; anything more\n' +
      'needs a reason, and dropping CHANGELOG.md severs the migration-text delivery\n' +
      'path AGENTS.md promises (#4261).',
  );
  process.exit(1);
}

const withExtras = [...declaredExtrasByPackage.values()].filter((s) => s.size > 0).length;
console.log(
  `✓ check:published-files — ${publishable} publishable package(s) of ${members} workspace ` +
    'member(s) declare a `files` whitelist that covers every entry point plus CHANGELOG.md ' +
    `and admits no test, test-harness config or build script; ${withExtras} publish more ` +
    'than dist/ + README.md + CHANGELOG.md, each with a registered reason.',
);
