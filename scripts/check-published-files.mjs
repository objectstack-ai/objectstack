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
// Six invariants, per non-private workspace package:
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
//   GATED       `exports` exists and names something (#12879). `files` decides
//               what SHIPS; `exports` decides what a consumer may RESOLVE of
//               what shipped, and without it those two are the same set.
//
// GATED, and the census control that keeps it honest (#12879)
// ----------------------------------------------------------
//
// A package with no `exports` map answers "is this symbol part of the public
// surface?" twice, differently: the DECLARED surface is what the entry barrel
// exports, the REACHABLE surface is every module under `dist/`, because
// `main` + `files` alone put no gate on subpath resolution. This repo decides
// semver level and "is this internal?" by reading the barrel -- so in such a
// package that reading is not wrong, it is merely one of two answers, and the
// disagreement surfaces later as "why did an internal refactor break a
// consumer".
//
// The other direction is the subtler one, and it is why the fix is the map
// rather than a policy: if accidental reachability were treated AS the public
// contract, every internal refactor of such a package would owe a minor bump --
// ratcheting the whole package for a reachability nobody deliberately offered.
// Close the hole; do not reprice changes against it.
//
// Measured when this landed: 71 of 80 tracked manifests declared a map, and of
// the nine that did not, seven were private (docs app, an example, the root,
// a scaffold template, three QA packages) and exactly two published a dist --
// `@objectstack/cli` and `@objectstack/plugin-hono-server`. A convention
// holding at 69 of 71 publishable packages is a ratchet waiting to be written
// down, which is this invariant.
//
// What the invariant does NOT require is a `"."` entry. Two packages here
// declare a map with no root export on purpose -- `@objectstack/console` is
// static assets whose only resolvable subpath is `./package.json` (the CLI
// resolves it that way precisely BECAUSE bare resolution throws), and
// `create-objectstack` publishes only `./created-summary`. Requiring `"."`
// would fail both for doing the right thing. The claim here is narrower and is
// the whole point: the package has decided what is resolvable.
//
// CENSUS CONTROL. This gate reads a POSITIVE signal off every publishable
// manifest, so the way it fails silently is for that reading to return nothing
// at all -- an enumerator that yields no members, a key read under the wrong
// name, a parse that quietly drops everything. Each of those makes "no package
// violates GATED" true by vacuity, and the gate would print a green line
// naming a population it never had. So the run also asserts the control the
// #12879 ruling names: a census that finds nobody declaring `exports` means
// the instrument broke, not that the convention is absent. EXPORTS_CENSUS_FLOOR
// below is that reading's floor, and it fails in its own words, distinct from
// any package's violation.
//
// Deliberately NOT checked: the contents of dist/. It does not exist in a fresh
// checkout and the lint job does not build, so reading it would make the
// verdict depend on local build state -- a gate that passes or fails by
// accident is worse than one with a stated boundary. What ships from dist/ is
// the build's business; this guard is about source leaking past it.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import {
  readWorkspaceGlobs,
  selfTest as workspaceEnumeratorSelfTest,
  workspacePackageDirs,
} from './workspace-enumerator.mjs';

// Anchored to the script, not to cwd: the verdict must not depend on where the
// guard was invoked from.
const ROOT = resolve(import.meta.dirname, '..');
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

// The floor the GATED census is read against (#12879). Its job is to catch
// COLLAPSE -- a reading that returns nothing, which is the only way this gate
// can be wrong while printing green -- so it sits well under the live count
// (71 publishable packages declared a map when this landed) rather than
// tracking it. The self-test holds it inside a band against the live tree in
// both directions: above it and the gate is permanently red for the wrong
// reason, far below it and the control is disarmed.
const EXPORTS_CENSUS_FLOOR = 50;

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
 * This gate's population, written in the syntax `scripts/pm/dispatch-gates.mjs`
 * can read (#10542).
 *
 * ── The defect this repairs ─────────────────────────────────────────────────
 *
 * The dispatch derivation names a gate for a card by scanning the gate's own
 * module body for the path literals it operates on. This gate computes its
 * population at RUNTIME instead — `workspaceGlobs()` below parses
 * pnpm-workspace.yaml — so it spelled no workspace path literal anywhere, and
 * the derivation therefore named it for NO card in the tree. Measured against
 * the four layout specimens #10542 uses (a flat package, a nested package, an
 * app manifest, an example manifest), `coveringKey` returned null for all four.
 *
 * That is a strictly worse failure than a gate with a stale hardcoded list: a
 * runtime-computed population is invisible rather than wrong, so nothing in
 * the output says the gate was ever considered.
 *
 * ── Why the glob spelling, and why it is not a second source of truth ───────
 *
 * `hintCovers` refuses a literal with no path separator (`packages`, `apps`,
 * `examples`) as too generic — measured, at +139084 fabricated (gate, file)
 * pairs if bare top-level words were admitted, because those words are path
 * COMPONENTS in dozens of gates that never read the root. The sanctioned escape
 * is for a gate to declare its own subtree in a spelling that carries a
 * separator, which is what these entries do. They are the workspace globs
 * VERBATIM, so the glob collapse reduces each back to the root it names and to
 * nothing else.
 *
 * Nothing in this gate reads this array — `workspaceGlobs()` still parses the
 * YAML, and remains the only thing the scan walks. The self-test reconciles the
 * two in BOTH directions against that live parse, so a workspace root added to
 * or removed from pnpm-workspace.yaml fails here rather than leaving this
 * declaration describing a workspace that moved. A declaration that can drift
 * from the scan is worse than none: it replaces a silent gate with a lying one.
 *
 * ── Why the WHOLE workspace is honest here, with the measurement ────────────
 *
 * This is the `subtree` case, not the `filtered` one check-examples-live-imports
 * refuses. `walk()` below enumerates EVERY non-build file of every publishable
 * member and MINIMAL judges each of them against FORBIDDEN, so the declaration
 * names files this gate really opens. Measured on this tree: the declaration
 * names 5263 tracked files and the gate judges 4803 of them — 91.3%. The 460 it
 * does not judge are the members whose OWN manifests this gate read in order to
 * exclude them (`private`), which is itself a read of the declared subtree, so
 * a manifest card there is a true lead rather than a fabricated one.
 *
 * The contrast that sets the boundary is in check-published-readme-exports.mjs,
 * which enumerates the same members and scores 2.8% — its refusal docblock
 * carries that measurement and declines the same declaration.
 */
const ROOT_DIR_WATCH_HINTS = [
  'packages/*',
  'packages/adapters/*',
  'packages/apps/*',
  'packages/connectors/*',
  'packages/drivers/*',
  'packages/plugins/*',
  'packages/qa/*',
  'packages/services/*',
  'packages/triggers/*',
  'apps/*',
  'examples/*',
];

/**
 * The `packages:` globs and the member directories they enumerate.
 *
 * Both come from `scripts/workspace-enumerator.mjs` (#11510), which is where
 * this repo's one parse of that file lives. This gate used to carry a private
 * copy; so did eight other scripts, and measured against each other they
 * agreed on the repo's real file while disagreeing on nine adversarial inputs.
 *
 * The enumerator is a plain module and declares NO path population of its own,
 * deliberately — `ROOT_DIR_WATCH_HINTS` above stays this gate's own claim about
 * this gate's own surface, and the self-test still reconciles it against the
 * live parse in both directions. See the enumerator's header for the +41725
 * (gate, file) pair measurement that decided the split.
 */
const workspaceGlobs = () => readWorkspaceGlobs(ROOT);

/** Workspace member directories, relative to the repo root. */
const workspaceDirs = () => workspacePackageDirs(ROOT);

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
 * The GATED verdict: does this manifest declare a resolution gate that names
 * something?
 *
 * `ok` is the census signal, so the three failing shapes are kept apart rather
 * than folded into one boolean -- they are different defects with opposite
 * symptoms. No map at all means EVERYTHING under `dist/` resolves; a `null`,
 * empty or non-map `exports` means nothing does, including the package's own
 * entry point. A single "bad exports" message would send an author of the
 * second kind looking for the first kind's fix.
 */
function exportsVerdict(manifest) {
  const map = manifest.exports;
  if (map === undefined) {
    return {
      ok: false,
      lines: [
        'declares no `exports` map, so every module under `dist/` is importable by any',
        'consumer, whatever the entry barrel names. The DECLARED surface (the barrel) and',
        'the REACHABLE surface (all of dist/) are then different sets, and an internal',
        'refactor breaks whoever deep-imported one of them -- silently, until it does (#12879).',
        'Fix: add an `exports` map naming the entry point(s) this package MEANS to offer.',
        '     Do NOT enumerate what happens to be reachable today: that ratifies an accidental',
        '     surface and prices every later internal refactor at a minor bump.',
      ],
    };
  }
  const empty =
    map === null ||
    (typeof map === 'string' && map.trim() === '') ||
    (Array.isArray(map) && map.length === 0) ||
    (typeof map === 'object' && !Array.isArray(map) && Object.keys(map).length === 0);
  if (empty) {
    return {
      ok: false,
      lines: [
        `declares \`exports\`: ${JSON.stringify(map)}, which names nothing resolvable -- Node`,
        'refuses every specifier into this package, its own entry point included.',
        'Fix: name the entry point(s), e.g. { ".": { "types": "./dist/index.d.ts", ... } }.',
      ],
    };
  }
  if (typeof map !== 'string' && typeof map !== 'object') {
    return {
      ok: false,
      lines: [
        `declares \`exports\` as a ${typeof map}, which Node cannot read as a map.`,
        'Fix: a target string, or an object of conditions / subpaths.',
      ],
    };
  }
  return { ok: true };
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

  // ── the dispatch-gates declaration (#10542) ───────────────────────────────
  //
  // Enforcement cannot hold any of these: ROOT_DIR_WATCH_HINTS is read by
  // another tool entirely, so a wrong or stale one runs green here forever and
  // pays itself out as a dev dispatched on a packaging card with this gate
  // missing from the brief. Both directions are reconciled against the LIVE
  // parse rather than re-spelled, so a workspace root that moves cannot leave
  // the declaration describing the old one.
  const declaredRoots = ROOT_DIR_WATCH_HINTS.map((h) => h.replace(/\/\*+$/, ''));
  const liveGlobs = workspaceGlobs();
  const liveRoots = liveGlobs.map((g) => g.replace(/\/\*+$/, ''));
  const declarationCases = [
    [
      'every workspace glob this gate walks is declared (a root with no path separator is refused as too generic, so the population needs the glob spelling)',
      liveRoots.every((r) => declaredRoots.includes(r)),
    ],
    [
      'and it declares no root the workspace does not have (a declaration that can drift from the scan is worse than none — it replaces a silent gate with a lying one)',
      declaredRoots.every((r) => liveRoots.includes(r)),
    ],
    [
      'every declared entry carries a path separator (the whole point of the spelling: hintCovers refuses a bare top-level word, so a tidy-up back to directory names re-opens the blind spot silently)',
      ROOT_DIR_WATCH_HINTS.every((h) => h.includes('/')),
    ],
    [
      'no declared entry is the bare root itself (provenance, never a lookup key)',
      ROOT_DIR_WATCH_HINTS.every((h) => !liveRoots.includes(h)),
    ],
  ];
  for (const [name, ok] of declarationCases) {
    if (!ok) failures.push(`ROOT_DIR_WATCH_HINTS: ${name}`);
  }

  // ── GATED and its census floor (#12879) ───────────────────────────────────
  //
  // The verdict cases pin the two directions apart: a map that is merely ABSENT
  // leaves everything resolvable, a map that is present and EMPTY leaves nothing
  // resolvable, and both must be refused for their own reason. The `"."`-less
  // shapes are pinned as PASSING on purpose -- `@objectstack/console` and
  // `create-objectstack` really ship those, so a future tightening to "must
  // declare a root entry" fails here rather than in their manifests.
  const verdictCases = [
    ['no exports key', {}, false],
    ['a root entry', { exports: { '.': './dist/index.js' } }, true],
    ['a conditions object', { exports: { types: './dist/index.d.ts', default: './dist/index.js' } }, true],
    ['a bare string target', { exports: './dist/index.js' }, true],
    ['subpath-only, no root (@objectstack/console)', { exports: { './package.json': './package.json' } }, true],
    ['subpath-only, no root (create-objectstack)', { exports: { './created-summary': { types: './d.ts' } } }, true],
    ['an empty object', { exports: {} }, false],
    ['an empty string', { exports: '' }, false],
    ['an empty array', { exports: [] }, false],
    ['null', { exports: null }, false],
    ['a number', { exports: 7 }, false],
    ['a fallback array', { exports: ['./dist/index.js'] }, true],
  ];
  for (const [label, manifest, expected] of verdictCases) {
    const actual = exportsVerdict(manifest).ok;
    if (actual !== expected) {
      failures.push(`exportsVerdict(${label}).ok === ${actual}, expected ${expected}`);
    }
  }
  for (const [label, manifest, expected] of verdictCases) {
    if (expected) continue;
    const { lines } = exportsVerdict(manifest);
    if (!Array.isArray(lines) || lines.length === 0 || !lines.some((l) => l.startsWith('Fix:'))) {
      failures.push(`exportsVerdict(${label}) refuses without a Fix: line`);
    }
  }

  // The floor is the control, so it is itself controlled -- against the live
  // tree, in both directions. A floor ABOVE the real count makes the gate
  // permanently red for a reason that has nothing to do with any package; a
  // floor far below it (the 1 someone reaches for to quiet a red run) would
  // wave through a census that found a single package, which is the exact
  // vacuity the control exists to catch.
  let liveDeclaring = 0;
  let livePublishable = 0;
  for (const dir of workspaceDirs()) {
    let m;
    try {
      m = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    if (!m.name || m.private === true) continue;
    livePublishable++;
    if (exportsVerdict(m).ok) liveDeclaring++;
  }
  const floorCases = [
    [
      `EXPORTS_CENSUS_FLOOR is a positive integer (is ${EXPORTS_CENSUS_FLOOR})`,
      Number.isInteger(EXPORTS_CENSUS_FLOOR) && EXPORTS_CENSUS_FLOOR > 0,
    ],
    [
      `EXPORTS_CENSUS_FLOOR (${EXPORTS_CENSUS_FLOOR}) is not above the live publishable count ` +
        `(${livePublishable}) — a floor no tree can reach is a red gate about nothing`,
      EXPORTS_CENSUS_FLOOR <= livePublishable,
    ],
    [
      `EXPORTS_CENSUS_FLOOR (${EXPORTS_CENSUS_FLOOR}) is at least half the live publishable count ` +
        `(${livePublishable}) — a lower floor disarms the control instead of measuring with it`,
      EXPORTS_CENSUS_FLOOR >= Math.ceil(livePublishable / 2),
    ],
  ];
  for (const [name, ok] of floorCases) {
    if (!ok) failures.push(`GATED census: ${name}`);
  }

  // The shared enumerator is a plain module, so no workflow invokes it and it
  // has no self-test of its own to schedule (#11510 — being a gate is exactly
  // what it must not be). Its coverage is that every gate which consolidated
  // onto it folds these in, this one included.
  const enumeratorFailures = workspaceEnumeratorSelfTest({ root: ROOT });
  failures.push(...enumeratorFailures);

  if (failures.length > 0) {
    console.error(`✗ check:published-files --self-test — ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(
    `✓ check:published-files --self-test — ${cases.length} pattern case(s), ` +
      `${forbidden.length} classification case(s), ${declarationCases.length} ` +
      `population-declaration case(s), ${verdictCases.length} \`exports\` verdict case(s), ` +
      `${floorCases.length} census-floor case(s) (floor ${EXPORTS_CENSUS_FLOOR} vs ` +
      `${liveDeclaring} of ${livePublishable} live) and the shared workspace enumerator's own ` +
      `assertions, over ${liveGlobs.length} live workspace glob(s).`,
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
let exportsDeclaring = 0;

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

  // --- GATED ---------------------------------------------------------------
  // Read before the `files` invariants so the census below sees every
  // publishable package, and independent of them: what a package SHIPS and what
  // a consumer may RESOLVE of it are separate claims. (A package that also
  // fails DECLARED loses this line to that block's early exit; it is already
  // being told its manifest is wrong, and the next run says the rest.)
  const gated = exportsVerdict(manifest);
  if (gated.ok) exportsDeclaring++;
  else lines.push(...gated.lines);

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

// --- GATED, the census control ---------------------------------------------
// The one failure this gate cannot report as a violation: if the reading itself
// returns nothing, "no package violates GATED" is true and green. So the
// positive signal is asserted against a floor, in its own words (#12879).
if (exportsDeclaring < EXPORTS_CENSUS_FLOOR) {
  problems.push({
    dir: SELF,
    name: 'GATED census control',
    lines: [
      `read an \`exports\` map off ${exportsDeclaring} of ${publishable} publishable package(s), under the`,
      `floor of ${EXPORTS_CENSUS_FLOOR}. A census returning "nobody declares exports" means THIS`,
      'INSTRUMENT BROKE, not that the convention is absent (#12879) -- an enumerator that',
      'yields no members, a key read under the wrong name, or a parse that drops manifests',
      'each make every GATED verdict vacuous while this gate prints green.',
      'Fix: repair the reading. Lower EXPORTS_CENSUS_FLOOR only when packages were really',
      `     removed, never to silence this — it is the control, not a threshold to tune.`,
    ],
  });
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
    'than dist/ + README.md + CHANGELOG.md, each with a registered reason; ' +
    `${exportsDeclaring} declare an \`exports\` map gating what of that is resolvable ` +
    `(census control: floor ${EXPORTS_CENSUS_FLOOR}).`,
);
