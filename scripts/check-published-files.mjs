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
//   ANNOUNCED   a package whose resolvable surface NARROWS relative to the
//               merge base -- a map added to a manifest that already published
//               without one, or a subpath dropped from an existing map -- says
//               so in a `minor` changeset naming the deep paths that stop
//               resolving (#15715, #15589 option B as ruled B1).
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

// ANNOUNCED, and why it is the only clause here that reads history (#15715)
// ------------------------------------------------------------------------
//
// GATED above asserts the map EXISTS. It is silent on the transition, and the
// transition is where the damage is: 17.3.0 added a map to `@objectstack/cli`,
// which had published without one, and every deep path a consumer had reached
// through `dist/` stopped resolving at once. Two out-of-repo repos found out
// after publish, during an upgrade -- cloud's `objectos-runtime` (#13662) and
// hotcrm's hook-body harness (#15325). Nothing here could have gone red: an
// `exports` map is a PACKAGING contract, and inside this monorepo nothing is
// sealed, because every in-repo consumer reaches any file through a relative
// import, a vitest alias or a `paths` entry.
//
// #15589 left two independent halves. Option A imports the missing knowledge
// from outside -- `packages/qa/downstream-contract/consumer-specifiers.ledger.json`
// records the specifiers NAMED out-of-repo consumers import, and a test resolves
// each from a packed tarball. This is the other half, and its whole value is
// that it does NOT depend on that ledger being complete: it fires on the PR
// that narrows the surface, whether or not anyone has written the consumer
// down. A red here is not "you broke a listed consumer" -- it is "you are
// about to publish a narrowing nobody announced".
//
// BORN-SEALED IS NOT A NARROWING, and that distinction is the whole clause.
// A package born with a map seals nobody: there is no published predecessor
// whose consumers could have been deep-importing it. Measured over this repo
// when #15715 was filed: 69 publishable packages declare a map, introduced by
// 51 commits -- but 56 of those packages were born with it and only 13 were
// retrofitted, from 7 commits. A clause that fires on all 51 would demand a
// consumer note 44 times from packages that had no consumers and no deep paths
// that stopped resolving, and every one of those 44 lands on a new-package PR,
// where the demand is least likely to be read and most likely to be discharged
// with boilerplate. A gate answered by boilerplate 44 times out of 51 has
// stopped being read by the 7th time it matters. So the clause discriminates,
// and the ruling on #15715 (B1) is what it implements.
//
// THE DISCRIMINATOR IS A BASE-vs-HEAD COMPARISON, deliberately -- the same
// shape `check-adr-0087-registration --base` already uses here, and ⛔ NOT
// `git log -S` archaeology, which would make the verdict depend on history
// this gate has no business reading. It looks at exactly two trees:
//
//   package.json absent at the merge base            -> BORN, passes
//   present but private/unnamed at the merge base    -> BORN, passes
//     (no published predecessor either -- a package going public for the
//      first time seals nobody, and gating it is the 44-false-positive shape)
//   present and publishable, no map there, map here  -> RETROFIT, gated
//   subpath in the base map, absent here             -> REMOVAL, gated
//   anything else (unchanged, or WIDENED)            -> passes
//
// WHAT THE ANNOUNCEMENT MUST SAY. A `minor`-or-greater changeset on that
// package, whose body NAMES deep paths that stop resolving -- checked against
// the head map rather than for a form of words, which is what keeps it from
// being dischargeable with boilerplate. For a removal, every dropped subpath
// must be named. For a retrofit, at least one deep specifier of the package
// must be named that the new map genuinely does NOT resolve: writing
// `@objectstack/cli/console` when `./console` is in the map does not satisfy
// it, because that path still resolves and naming it tells a consumer nothing.
// The specifier a consumer actually wrote (`@objectstack/cli/dist/utils/console.js`)
// does satisfy it, and is the sentence #13662 needed and never got.
//
// ⚠️ ABSENCE IS NEVER A PASS (#4690). This clause reads the base through git,
// and every way that read can fail -- no `origin/main`, no merge base, an
// unreadable `.changeset/` -- makes EVERY package look born-sealed and the
// whole clause vacuously green. That is the failure this repo keeps paying
// for, so each of those is a REFUSAL that names itself, never a skip, and the
// base read carries its own census control (BASE_READ_FLOOR) exactly as GATED
// carries EXPORTS_CENSUS_FLOOR. In CI the base comes from `Lint & Repo Gates`
// checking out at `fetch-depth: 0` (.github/workflows/lint.yml) -- that is
// what makes actions/checkout fetch `+refs/heads/*:refs/remotes/origin/*` so
// `origin/main` exists at all, and on a `pull_request` event the merge base
// with the merge-ref HEAD lands exactly on the PR's branch point.
//
// The HEAD side is read from the WORKING TREE, not from a rev, so the clause
// fires on an uncommitted retrofit too -- before the commit rather than after
// the push. In CI the two are the same tree.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
// The changeset frontmatter parser is REUSED, never re-typed. Four readers of
// one block must agree on what counts as a declaration (#7004), and
// check-empty-changeset's self-test asserts that agreement byte-for-byte across
// all of them -- a fifth private copy here would be outside that assertion. The
// module is entry-guarded, so importing it runs no gate (its own I1 case).
import { parseChangeset } from './check-adr-0087-registration.mjs';

// ⛔ Nothing in this file is `export`ed, deliberately. Its top level RUNS the
// gate, and `check:entry-guard`'s second rule is that a `scripts/**` file which
// exports a binding can be imported for it — whereupon this gate's `process.exit`
// lands inside the importer. The self-test below is in the same module and calls
// these helpers directly, so exporting them would buy nothing and owe an entry
// guard around ~200 lines of top-level dispatch.
import {
  readWorkspaceGlobs,
  selfTest as workspaceEnumeratorSelfTest,
  workspaceEnumeratorFloorFailures,
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

// -- ANNOUNCED: the base-vs-HEAD discriminator (#15715) ----------------------
//
// Every function in this section is PURE -- it takes the two manifests and the
// changeset texts and returns a verdict. The git reads that supply them are the
// section after it, kept apart on purpose: the four cells the ruling names are
// then testable without a repository, and the one thing that needs a real one
// (does the base read actually reach the base tree) is testable on its own.

/**
 * The subpath keys a map DECLARES, as `"."` / `"./x"` strings.
 *
 * A bare string target, a fallback array and a conditions-only object all
 * declare the root and nothing else -- Node resolves no subpath through any of
 * them -- so all three answer `{'.'}` rather than an empty set. An empty set
 * would read as "this map declared nothing", which is a different fact and one
 * `exportsVerdict` already refuses.
 */
function exportSubpaths(map) {
  if (typeof map === 'string' || Array.isArray(map)) return new Set(['.']);
  if (!map || typeof map !== 'object') return new Set();
  const declared = Object.keys(map).filter((k) => k === '.' || k.startsWith('./'));
  return new Set(declared.length > 0 ? declared : ['.']);
}

/**
 * Does `map` resolve `subpath` (spelled `"."` or `"./x"`)?
 *
 * Pattern keys are honoured, because generalising `"./console"` to `"./*"` is a
 * WIDENING and must not read as a removal. One `*`, prefix + suffix, which is
 * what Node's subpath-patterns are.
 */
function mapResolves(map, subpath) {
  if (typeof map === 'string' || Array.isArray(map)) return subpath === '.';
  if (!map || typeof map !== 'object') return false;
  const declared = Object.keys(map).filter((k) => k === '.' || k.startsWith('./'));
  if (declared.length === 0) return subpath === '.';
  if (declared.includes(subpath)) return true;
  for (const key of declared) {
    const star = key.indexOf('*');
    if (star === -1) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (subpath.length < prefix.length + suffix.length) continue;
    if (subpath.startsWith(prefix) && subpath.endsWith(suffix)) return true;
  }
  return false;
}

/**
 * The four cells, decided from exactly two manifests (#15715, ruled B1).
 *
 * @param {string|null} baseText  `package.json` at the merge base, or null when
 *                                the path does not exist there
 * @param {object} headManifest   the manifest as it reads now
 * @returns {{ kind: 'born'|'retrofit'|'removal'|'unchanged'|'ungated-head'|'unreadable-base', lost: string[] }}
 */
function narrowingVerdict(baseText, headManifest) {
  // Cell 1a: no manifest at the base -> the package is born with whatever it
  // declares. There is no published predecessor, so it seals nobody.
  if (baseText === null || baseText === undefined) return { kind: 'born', lost: [] };
  let base;
  try {
    base = JSON.parse(baseText);
  } catch {
    return { kind: 'unreadable-base', lost: [] };
  }
  if (!base || typeof base !== 'object') return { kind: 'unreadable-base', lost: [] };
  // Cell 1b: present at the base but PRIVATE or unnamed -- npm never published
  // it, so it has no consumers either. Gating a package on the PR that first
  // makes it public is the same false positive as gating a new one, and it is
  // the shape a `private: true` scaffold takes on its way to release.
  if (!base.name || base.private === true) return { kind: 'born', lost: [] };

  const headGated = exportsVerdict(headManifest).ok;
  // No usable map at HEAD is GATED's finding, not this clause's: reporting both
  // would tell one author two different things about one manifest.
  if (!headGated) return { kind: 'ungated-head', lost: [] };

  // Cell 2: publishable at the base with no usable map there, gated here. Every
  // deep path a consumer reached through `dist/` stops resolving.
  if (!exportsVerdict(base).ok) return { kind: 'retrofit', lost: [] };

  // Cell 3: a subpath the base map declared that the head map no longer
  // resolves. Judged by RESOLUTION, not by key equality, so a widening to a
  // pattern key is not mistaken for a removal.
  const lost = [...exportSubpaths(base.exports)]
    .filter((sub) => !mapResolves(headManifest.exports, sub))
    .sort();
  if (lost.length > 0) return { kind: 'removal', lost };

  // Cell 4: unchanged, or widened.
  return { kind: 'unchanged', lost: [] };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Every deep specifier of `pkg` a body names, returned as `"./x"` subpaths.
 *
 * The body is prose, so the trailing punctuation a sentence puts after a
 * specifier (`...console.js`, `` `...` ``) is trimmed off the captured path.
 */
function deepSpecifiersNamed(body, pkg) {
  const found = new Set();
  const re = new RegExp(`${escapeRe(pkg)}\\/([A-Za-z0-9._*-]+(?:\\/[A-Za-z0-9._*-]+)*)`, 'g');
  let m;
  while ((m = re.exec(body)) !== null) {
    const path = m[1].replace(/[.,;:]+$/, '');
    if (path) found.add(`./${path}`);
  }
  return found;
}

/**
 * Is the narrowing ANNOUNCED -- a `minor`-or-greater changeset on this package
 * whose body names deep paths that genuinely stop resolving?
 *
 * The second half is checked against the head map rather than against a form of
 * words. That is the whole anti-boilerplate property: a note that names a path
 * the new map still resolves has told a consumer nothing, and reads here as
 * unsatisfied rather than as a note.
 *
 * @returns {{ satisfied: boolean, reason: string, missing: string[] }}
 */
function announcementVerdict({ pkg, narrowing, headExports, changesets }) {
  const bumped = changesets.filter((c) =>
    parseChangeset(c.text).bumps.some((b) => b.pkg === pkg && (b.bump === 'minor' || b.bump === 'major')),
  );
  if (bumped.length === 0) return { satisfied: false, reason: 'no-bump', missing: narrowing.lost };

  if (narrowing.kind === 'removal') {
    // Every dropped subpath must be named, in either spelling an author would
    // reach for: the map key (`./console`) or the specifier (`<pkg>/console`).
    const missing = narrowing.lost.filter((sub) => {
      const asSpecifier = sub === '.' ? pkg : `${pkg}${sub.slice(1)}`;
      // The BODY, not the whole file: the frontmatter names the package on every
      // changeset, so reading `c.text` would let the bump line answer the note.
      return !bumped.some((c) => {
        const body = parseChangeset(c.text).body;
        return body.includes(sub) || body.includes(asSpecifier);
      });
    });
    return missing.length > 0
      ? { satisfied: false, reason: 'unnamed-removal', missing }
      : { satisfied: true, reason: 'announced', missing: [] };
  }

  // Retrofit: at least one named deep specifier the new map does NOT resolve.
  for (const c of bumped) {
    for (const sub of deepSpecifiersNamed(parseChangeset(c.text).body, pkg)) {
      if (!mapResolves(headExports, sub)) return { satisfied: true, reason: 'announced', missing: [] };
    }
  }
  return { satisfied: false, reason: 'no-dead-path-named', missing: [] };
}

// -- ANNOUNCED: the base read, and the control that keeps it honest (#15715) -
//
// This is the only history-dependent read in this gate, so it is also the only
// place it can go vacuously green: every failure mode of the read -- a missing
// `origin/main`, an absent merge base, a `cat-file` that returns nothing --
// makes every package look BORN and the clause silently unanimous. So the read
// is controlled the way GATED's census is, in its own words.

function git(args) {
  // stderr piped, not inherited: the base read legitimately probes paths that
  // do not exist at the merge base, and git's "does not exist" on the terminal
  // would read as though the gate had failed while it is answering its question.
  return execFileSync('git', args, {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function resolveCommit(ref) {
  try { return git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim() || null; } catch { return null; }
}

function mergeBaseOf(base, head) {
  try { return git(['merge-base', base, head]).trim() || null; } catch { return null; }
}

/**
 * Every path at one rev in a SINGLE `git cat-file --batch`, absent from the map
 * when it does not exist there. ~80 manifests is ~80 process spawns done the
 * naive way, on a gate that runs on every PR.
 */
function showManyOrNull(rev, paths) {
  const found = new Map();
  if (paths.length === 0) return found;
  let out;
  try {
    out = execFileSync('git', ['cat-file', '--batch'], {
      cwd: ROOT, input: `${paths.map((p) => `${rev}:${p}`).join('\n')}\n`,
      maxBuffer: 512 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch { return found; }
  // `<oid> <type> <size>\n<contents>\n` per hit; `<request> missing\n` per miss.
  let off = 0;
  for (const path of paths) {
    const nl = out.indexOf(0x0a, off);
    if (nl < 0) break;
    const header = out.subarray(off, nl).toString('utf8');
    if (header.endsWith(' missing')) { off = nl + 1; continue; }
    const size = Number(header.split(' ')[2]);
    if (!Number.isFinite(size)) break;
    found.set(path, out.subarray(nl + 1, nl + 1 + size).toString('utf8'));
    off = nl + 1 + size + 1;
  }
  return found;
}

/**
 * Which of the pending changesets did THIS change introduce or edit?
 *
 * ⚠️ Measured, not assumed: an earlier draft of this clause accepted any pending
 * changeset, and a real subpath removal went GREEN because an unrelated
 * changeset already on main happened to contain the string `./console` in a
 * sentence about a different release. The whole stock is ~1300 files of prose
 * about this repo's own packages, so "some changeset somewhere mentions this
 * path" is satisfied by accident constantly -- the boilerplate-answered gate
 * #15715 exists to avoid, arrived at from the other direction.
 *
 * The announcement has to come from the change that does the narrowing, so the
 * subject is the diff: a changeset absent at the merge base, or one whose text
 * differs from its base copy.
 */
function introducedChangesets(all, baseTexts) {
  return all.filter((c) => baseTexts.get(c.path) !== c.text);
}

/** Pending changesets in the working tree, or `null` when the directory is unreadable. */
function pendingChangesets() {
  const dir = join(ROOT, '.changeset');
  if (!existsSync(dir)) return null;
  const out = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    // Non-recursive, so the consumed prerelease stock under `.changeset/pre/`
    // is skipped by construction, as is README.md (documentation, never a
    // changeset) and config.json.
    if (!e.isFile() || !e.name.endsWith('.md') || e.name === 'README.md') continue;
    try { out.push({ path: `.changeset/${e.name}`, text: readFileSync(join(dir, e.name), 'utf8') }); } catch { /* unreadable file */ }
  }
  return out;
}

/**
 * The base read's census control: did the read actually reach the base tree?
 *
 * RELATIVE rather than absolute, unlike EXPORTS_CENSUS_FLOOR, because the
 * legitimate reason for a package to be missing at the base is that the PR adds
 * it -- and a PR may add several. What no PR does is more than double the
 * publishable population, so a read that finds fewer than half of them at the
 * base did not fail to find new packages: it failed.
 */
function baseReadControl({ publishable, foundAtBase }) {
  if (publishable === 0) return { ok: true, lines: [] };
  if (foundAtBase >= Math.ceil(publishable / 2)) return { ok: true, lines: [] };
  return {
    ok: false,
    lines: [
      `read a \`package.json\` at the merge base for ${foundAtBase} of ${publishable} publishable`,
      'package(s), under half. Every package the base read MISSES reads as born-sealed and',
      'passes ANNOUNCED, so a broken read makes this clause unanimously green while checking',
      'nothing (#4690, #15715) -- and no PR adds more publishable packages than the repo',
      'already had.',
      'Fix: repair the read. This is the control, not a threshold to tune.',
    ],
  };
}

/**
 * The pattern semantics above are the one part of this guard that can be wrong
 * without any package being wrong -- a matcher that over-matches turns MINIMAL
 * into noise, and one that under-matches makes SUFFICIENT wave a broken package
 * through. Both failures are silent, so they get asserted rather than assumed.
 */

// -- The self-test's own battery roster and floor (#13489) ------------------
//
// A pass used to be this self-test's ONLY success condition, so "every case
// held" and "the cases never ran" printed the same line. Closed the way
// PR #13487 validated on check-doc-authoring: what is pinned is the registered
// NAMES, not a number. Every section opens with `battery('<name>')`, every
// assertion is attributed to the battery most recently opened, and the floor
// requires the OPENED set to equal the DECLARED set with each battery at or
// above its own count.
//
// The counts are a FLOOR, not an equality -- adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running; the
// remedy is to find what stopped registering.
const SELF_TEST_BATTERIES = Object.freeze({
  'the dispatch-gates declaration (#10542)': 37,
  'GATED and its census floor (#12879)': 22,
  'ANNOUNCED: the four base-vs-HEAD cells (#15715)': 26,
  'ANNOUNCED: what satisfies the announcement (#15715)': 31,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 4;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 — a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'check-published-files self-test reached its verdict';

function selfTest() {
  // The battery ledger this self-test's floor is evaluated against (#13489).
  // `battery()` opens a battery; every assertion below is attributed to the one
  // most recently opened, so a section that stops running stops registering and
  // names ITSELF at the floor rather than going quiet.
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };
  // The one in-body assertion helper the 7 inline `failures.push(...)` sites
  // now route through. The message is built the same way it always was; the
  // only change is that a case is COUNTED whether it holds or not, which is
  // what lets the floor below tell "held" from "never ran".
  const expect = (ok, message) => {
    registerCase();
    if (!ok) failures.push(message);
  };
  // Cases run before the first banner, so the first battery is opened at the
  // top of the body and that banner carries no second opener — PR #13487's own
  // shape, as batches 1b and 2 landed it.
  battery('the dispatch-gates declaration (#10542)');
  const failures = [];
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
  for (const [pattern, path, expected] of cases) {
    const actual = matcher(pattern)(path);
    expect(actual === expected, `matcher("${pattern}")("${path}") === ${actual}, expected ${expected}`);
  }
  for (const [path, expected] of forbidden) {
    const actual = FORBIDDEN.find((f) => f.test(path))?.label ?? null;
    expect(actual === expected, `FORBIDDEN("${path}") === ${actual}, expected ${expected}`);
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
    expect(ok, `ROOT_DIR_WATCH_HINTS: ${name}`);
  }

  // ── GATED and its census floor (#12879) ───────────────────────────────────
  battery('GATED and its census floor (#12879)');
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
    expect(actual === expected, `exportsVerdict(${label}).ok === ${actual}, expected ${expected}`);
  }
  for (const [label, manifest, expected] of verdictCases) {
    if (expected) continue;
    const { lines } = exportsVerdict(manifest);
    expect(
      Array.isArray(lines) && lines.length > 0 && lines.some((l) => l.startsWith('Fix:')),
      `exportsVerdict(${label}) refuses without a Fix: line`,
    );
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
    expect(ok, `GATED census: ${name}`);
  }

  // The shared enumerator is a plain module, so no workflow invokes it and it
  // has no self-test of its own to schedule (#11510 — being a gate is exactly
  // what it must not be). Its coverage is that every gate which consolidated
  // onto it folds these in, this one included.
  const enumeratorFailures = workspaceEnumeratorSelfTest({ root: ROOT });
  // The enumerator returns a SET of failures rather than one assertion, so it
  // registers as the single case it is here: that the shared enumerator's own
  // self-test ran and returned nothing.
  expect(enumeratorFailures.length === 0, `the shared workspace enumerator reported ${enumeratorFailures.length} failure(s)`);
  failures.push(...enumeratorFailures);
  failures.push(...workspaceEnumeratorFloorFailures());

  // ── ANNOUNCED: the four base-vs-HEAD cells (#15715) ───────────────────────
  battery('ANNOUNCED: the four base-vs-HEAD cells (#15715)');
  //
  // The ruling names four cells and each is pinned in BOTH directions, because
  // the way this clause fails is by answering "born" to everything: a reader
  // that returns nothing, a base that does not resolve, a verdict that falls
  // through. Every case below flips when the clause is ablated, which is the
  // property #15410 asks for -- a self-test that cannot fail is the 179th one
  // nobody wanted.
  const HEAD_MAP = { name: '@x/p', exports: { '.': './dist/index.js', './console': './dist/console.js' } };
  const cellCases = [
    // Cell 1: born-sealed passes. No manifest at the base at all.
    ['cell 1 — absent at base is BORN', narrowingVerdict(null, HEAD_MAP).kind, 'born'],
    [
      'cell 1b — PRIVATE at base is BORN (npm never published it, so it seals nobody)',
      narrowingVerdict('{"name":"@x/p","private":true}', HEAD_MAP).kind,
      'born',
    ],
    [
      'cell 1b — UNNAMED at base is BORN',
      narrowingVerdict('{"version":"1.0.0"}', HEAD_MAP).kind,
      'born',
    ],
    // Cell 2: retrofit is gated. Publishable at the base, no map there.
    [
      'cell 2 — publishable at base with no map, gated here, is a RETROFIT',
      narrowingVerdict('{"name":"@x/p","version":"1.0.0"}', HEAD_MAP).kind,
      'retrofit',
    ],
    [
      'cell 2 — an EMPTY map at base is not a map: still a RETROFIT',
      narrowingVerdict('{"name":"@x/p","exports":{}}', HEAD_MAP).kind,
      'retrofit',
    ],
    // Cell 3: subpath removal is gated.
    [
      'cell 3 — a subpath declared at base and unresolvable here is a REMOVAL',
      narrowingVerdict('{"name":"@x/p","exports":{".":"./d.js","./console":"./c.js","./hook":"./h.js"}}', HEAD_MAP).kind,
      'removal',
    ],
    [
      'cell 3 — the REMOVAL names exactly the lost subpath',
      narrowingVerdict('{"name":"@x/p","exports":{".":"./d.js","./console":"./c.js","./hook":"./h.js"}}', HEAD_MAP).lost.join(','),
      './hook',
    ],
    // Cell 4: unchanged passes -- and so does WIDENING, in both spellings.
    [
      'cell 4 — an identical map is UNCHANGED',
      narrowingVerdict(JSON.stringify(HEAD_MAP), HEAD_MAP).kind,
      'unchanged',
    ],
    [
      'cell 4 — ADDING a subpath is a widening, not a narrowing',
      narrowingVerdict('{"name":"@x/p","exports":{".":"./dist/index.js"}}', HEAD_MAP).kind,
      'unchanged',
    ],
    [
      'cell 4 — generalising a subpath to a PATTERN is a widening, not a removal',
      narrowingVerdict(
        '{"name":"@x/p","exports":{".":"./d.js","./console":"./c.js"}}',
        { name: '@x/p', exports: { '.': './d.js', './*': './dist/*.js' } },
      ).kind,
      'unchanged',
    ],
    // The two verdicts that are deliberately NOT this clause's finding.
    [
      'a HEAD with no usable map is GATED’s finding, not this one’s',
      narrowingVerdict('{"name":"@x/p","version":"1.0.0"}', { name: '@x/p' }).kind,
      'ungated-head',
    ],
    [
      'a base manifest that does not parse is refused, never read as born',
      narrowingVerdict('{ not json', HEAD_MAP).kind,
      'unreadable-base',
    ],
  ];
  for (const [label, actual, expected] of cellCases) {
    expect(actual === expected, `ANNOUNCED ${label}: got "${actual}", expected "${expected}"`);
  }

  // `mapResolves` decides cell 3, so its own semantics are pinned apart from it.
  const resolveCases = [
    ['exact subpath', { '.': './d.js', './console': './c.js' }, './console', true],
    ['absent subpath', { '.': './d.js' }, './console', false],
    ['pattern covers it', { './*': './dist/*.js' }, './console', true],
    ['pattern prefix+suffix', { './dist/*.js': './dist/*.js' }, './dist/a.js', true],
    ['pattern does not cover a different suffix', { './dist/*.js': './x' }, './dist/a.ts', false],
    ['a bare string target resolves the root only', './dist/index.js', '.', true],
    ['a bare string target resolves no subpath', './dist/index.js', './console', false],
    ['a conditions-only object is root-only', { types: './d.ts', default: './d.js' }, '.', true],
    ['a conditions-only object resolves no subpath', { types: './d.ts', default: './d.js' }, './console', false],
    ['a fallback array resolves the root only', ['./dist/index.js'], '.', true],
  ];
  for (const [label, map, sub, expected] of resolveCases) {
    expect(mapResolves(map, sub) === expected, `mapResolves(${label}, "${sub}") !== ${expected}`);
  }

  const subpathCases = [
    ['an object map lists its subpath keys', { '.': 'a', './x': 'b' }, '.,./x'],
    ['a conditions-only object is the root', { types: 'a', default: 'b' }, '.'],
    ['a bare string is the root', './dist/index.js', '.'],
    ['a fallback array is the root', ['./a.js'], '.'],
  ];
  for (const [label, map, expected] of subpathCases) {
    expect([...exportSubpaths(map)].sort().join(',') === expected, `exportSubpaths: ${label}`);
  }

  // ── ANNOUNCED: what satisfies the announcement (#15715) ────────────────────
  battery('ANNOUNCED: what satisfies the announcement (#15715)');
  //
  // The anti-boilerplate half. A `minor` bump alone never satisfies it; what
  // satisfies it is a body naming a path the NEW map does not resolve, checked
  // against the map rather than against a form of words.
  const cs = (text) => [{ path: '.changeset/x.md', text }];
  const RETROFIT = { kind: 'retrofit', lost: [] };
  const REMOVAL = { kind: 'removal', lost: ['./hook'] };
  const HEAD_EXPORTS = HEAD_MAP.exports;
  const verdictOf = (narrowing, changesets) =>
    announcementVerdict({ pkg: '@x/p', narrowing, headExports: HEAD_EXPORTS, changesets }).reason;

  const announceCases = [
    ['no changeset at all', RETROFIT, [], 'no-bump'],
    ['a PATCH changeset is not an announcement', RETROFIT, cs('---\n"@x/p": patch\n---\n\nfix: x\n'), 'no-bump'],
    [
      'a minor changeset for a DIFFERENT package does not answer for this one',
      RETROFIT,
      cs('---\n"@x/other": minor\n---\n\nnames @x/p/dist/gone.js\n'),
      'no-bump',
    ],
    [
      'a minor bump whose body names NO dead path is boilerplate, not a note',
      RETROFIT,
      cs('---\n"@x/p": minor\n---\n\nSealed the package behind an exports map.\n'),
      'no-dead-path-named',
    ],
    [
      'naming a path the new map STILL resolves tells a consumer nothing',
      RETROFIT,
      cs('---\n"@x/p": minor\n---\n\nConsumers should use @x/p/console.\n'),
      'no-dead-path-named',
    ],
    [
      'naming a genuinely dead deep path IS the announcement',
      RETROFIT,
      cs('---\n"@x/p": minor\n---\n\n@x/p/dist/utils/console.js no longer resolves; use @x/p/console.\n'),
      'announced',
    ],
    [
      'a MAJOR bump counts as at least minor',
      RETROFIT,
      cs('---\n"@x/p": major\n---\n\n@x/p/dist/utils/console.js stops resolving.\n'),
      'announced',
    ],
    ['a removal with no changeset', REMOVAL, [], 'no-bump'],
    [
      'a removal whose body names nothing',
      REMOVAL,
      cs('---\n"@x/p": minor\n---\n\nTidied the exports map.\n'),
      'unnamed-removal',
    ],
    [
      'a removal named by its MAP KEY is announced',
      REMOVAL,
      cs('---\n"@x/p": minor\n---\n\nDropped "./hook" from the map.\n'),
      'announced',
    ],
    [
      'a removal named by its SPECIFIER is announced',
      REMOVAL,
      cs('---\n"@x/p": minor\n---\n\n@x/p/hook no longer resolves.\n'),
      'announced',
    ],
    [
      'a removal of TWO subpaths is not answered by naming one',
      { kind: 'removal', lost: ['./hook', './other'] },
      cs('---\n"@x/p": minor\n---\n\n@x/p/hook no longer resolves.\n'),
      'unnamed-removal',
    ],
  ];
  for (const [label, narrowing, changesets, expected] of announceCases) {
    const got = verdictOf(narrowing, changesets);
    expect(got === expected, `announcementVerdict — ${label}: got "${got}", expected "${expected}"`);
  }

  // Only what THIS change wrote can announce what it narrows. The case below is
  // the one that was measured going wrong: an untouched changeset already on
  // main, containing the removed subpath in unrelated prose, satisfied a real
  // subpath removal and the gate went green.
  const stock = [
    { path: '.changeset/untouched.md', text: 'mentions ./console in other prose' },
    { path: '.changeset/edited.md', text: 'new text' },
    { path: '.changeset/added.md', text: 'brand new' },
  ];
  const stockAtBase = new Map([
    ['.changeset/untouched.md', 'mentions ./console in other prose'],
    ['.changeset/edited.md', 'the text it had at the base'],
  ]);
  const introduced = introducedChangesets(stock, stockAtBase).map((c) => c.path).sort();
  expect(
    introduced.join(',') === '.changeset/added.md,.changeset/edited.md',
    `introducedChangesets returns the ADDED and EDITED ones: got ${introduced.join(',')}`,
  );
  expect(
    !introduced.includes('.changeset/untouched.md'),
    'an untouched changeset already on main cannot announce this change — it was written about something else, and the stock is ~1300 files of prose about these same packages',
  );
  expect(
    introducedChangesets([], new Map()).length === 0,
    'introducedChangesets over an empty stock is empty, not everything',
  );

  const namedCases = [
    ['a plain specifier', '@x/p/dist/a.js', './dist/a.js'],
    ['trailing sentence punctuation is trimmed', 'see @x/p/dist/a.js, and', './dist/a.js'],
    ['a backticked specifier', 'use `@x/p/console` instead', './console'],
  ];
  for (const [label, body, expected] of namedCases) {
    expect(deepSpecifiersNamed(body, '@x/p').has(expected), `deepSpecifiersNamed — ${label}`);
  }
  expect(deepSpecifiersNamed('@x/other/dist/a.js', '@x/p').size === 0, 'deepSpecifiersNamed ignores another package');

  // The base-read control, in both directions.
  const controlCases = [
    ['a full read passes', { publishable: 69, foundAtBase: 69 }, true],
    ['a read that found half passes (a PR may add packages)', { publishable: 69, foundAtBase: 35 }, true],
    ['a read that found NOTHING is the instrument breaking', { publishable: 69, foundAtBase: 0 }, false],
    ['a read that found a third is the instrument breaking', { publishable: 69, foundAtBase: 23 }, false],
    ['an empty workspace is not a failure', { publishable: 0, foundAtBase: 0 }, true],
  ];
  for (const [label, args, expected] of controlCases) {
    expect(baseReadControl(args).ok === expected, `baseReadControl — ${label}`);
  }
  expect(
    baseReadControl({ publishable: 69, foundAtBase: 0 }).lines.some((l) => l.startsWith('Fix:')),
    'baseReadControl refuses with a Fix: line',
  );

  // ⭐ The reader itself, against THIS repository. Everything above is pure, and
  // a pure battery cannot tell a working `git cat-file` reader from one that
  // returns nothing for every path — which is the single shape that makes this
  // whole clause vacuously green, since every unread manifest reads as born.
  // So the reader is exercised for real, in both directions, at a rev that
  // always exists.
  const probe = showManyOrNull('HEAD', ['package.json', 'scripts/no-such-file.probe.json']);
  expect(probe.has('package.json'), 'the base reader finds a path that EXISTS at HEAD (a reader that finds nothing makes every package read as born-sealed)');
  expect(!probe.has('scripts/no-such-file.probe.json'), 'the base reader reports a path that does NOT exist at HEAD as absent');
  let probeName = null;
  try { probeName = JSON.parse(probe.get('package.json') ?? 'null')?.name ?? null; } catch { probeName = null; }
  expect(probeName !== null, 'the base reader returns PARSEABLE content, not a truncated or empty blob');
  expect(mergeBaseOf('HEAD', 'HEAD') !== null, 'mergeBaseOf resolves a rev against itself (the merge-base helper is wired)');
  expect(resolveCommit('HEAD') !== null, 'resolveCommit resolves HEAD');
  expect(resolveCommit('refs/heads/no-such-branch-xyz') === null, 'resolveCommit answers null for a ref that does not exist, so an unresolvable --base cannot read as resolved');

  // -- The floor: every declared battery RAN, and ran its cases (#13489) -----
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared. A set
  // difference names WHICH battery stopped; a count says only that something did.
  const floorMessages = [];
  const floorFailure = (message) => { floorMessages.push(message); };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (an early return, a deleted block, a guard that now '
        + 'skips) and restore it.',
    );
  }
  for (const m of floorMessages) failures.push(m);

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
      `${liveDeclaring} of ${livePublishable} live), ${cellCases.length} ANNOUNCED cell case(s), ` +
      `${resolveCases.length} subpath-resolution case(s), ${announceCases.length} announcement ` +
      `case(s) and ${controlCases.length} base-read-control case(s) (plus the base reader itself, ` +
      'exercised against this repository), and the shared workspace enumerator\'s own ' +
      `assertions, over ${liveGlobs.length} live workspace glob(s).`,
  );

  return SELF_TEST_VERDICT;
}

if (process.argv.includes('--self-test')) {
  if (selfTest() !== SELF_TEST_VERDICT) {
      console.error(
          '\n✗ check-published-files self-test: selfTest() returned without reaching its verdict,\n'
              + 'so no success line was printed. Exiting 0 here would report a self-test\n'
              + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
  }
  process.exit(0);
}

const problems = [];
const declaredExtrasByPackage = new Map();
// The publishable manifests as HEAD reads them, kept for the ANNOUNCED clause
// below: it needs the same population GATED just counted, paired with the path
// to read at the merge base.
const headManifests = [];
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
  headManifests.push({ dir, name, manifest, manifestPath });
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

// --- ANNOUNCED, the base-vs-HEAD clause -------------------------------------
// Ruled B1 on #15715. Every refusal below is a #4690 refusal: it names itself
// and reds, because the alternative -- reading an unavailable base as "no
// package narrowed anything" -- is the vacuous green this clause exists inside
// a gate that already documents that failure mode for GATED.
let announcedRan = false;
{
  const flagAt = process.argv.indexOf('--base');
  const requested = flagAt === -1 ? null : process.argv[flagAt + 1];
  const refuse = (lines) => problems.push({ dir: SELF, name: 'ANNOUNCED base read', lines });

  let baseRef = null;
  if (requested) {
    baseRef = resolveCommit(requested);
    if (!baseRef) {
      refuse([
        `\`--base ${requested}\` does not resolve to a commit in this checkout.`,
        'A base that cannot be resolved is a failure, never a pass (#4690): every package would',
        'read as born-sealed and ANNOUNCED would pass unanimously without comparing anything.',
        'Fix: pass a ref this checkout has, or omit --base to use origin/main.',
      ]);
    }
  } else {
    const ref = ['origin/main', 'main'].find((r) => resolveCommit(r));
    baseRef = ref ? resolveCommit(ref) : null;
    if (!baseRef) {
      refuse([
        'neither `origin/main` nor `main` resolves in this checkout, so the ANNOUNCED clause has',
        'no base to compare against and would pass every package by default (#4690).',
        'In CI this ref comes from `Lint & Repo Gates` checking out at `fetch-depth: 0`',
        '(.github/workflows/lint.yml), which is what makes actions/checkout fetch',
        '`+refs/heads/*:refs/remotes/origin/*` so the base branch exists locally at all.',
        'Fix: `git fetch origin main`, or pass one explicitly: --base <ref-or-sha>.',
      ]);
    }
  }

  const mergeBase = baseRef ? mergeBaseOf(baseRef, 'HEAD') : null;
  if (baseRef && !mergeBase) {
    refuse([
      `\`${requested ?? 'origin/main'}\` and HEAD have no merge base in this checkout, so this`,
      'clause has no trustworthy starting point. Refusing to fall back to the raw base, and',
      'refusing to pass by default (#4690) -- a shallow clone whose graft floor is newer than',
      'the branch point produces exactly this, and answers "nothing narrowed" for every package.',
      'Fix: deepen the checkout (`git fetch --deepen <n>` / `--unshallow`), or pass a --base',
      '     this checkout can reach.',
    ]);
  }

  const changesets = pendingChangesets();
  if (mergeBase && changesets === null) {
    refuse([
      '`.changeset/` is missing or unreadable, and this clause judges changesets -- a tree where',
      'they cannot be read would report every narrowing as unannounced, or (worse) be quietly',
      'lowered to reporting none (#4690).',
      'Fix: restore the directory, or teach this clause where it moved.',
    ]);
  }

  if (mergeBase && changesets !== null) {
    const basePaths = headManifests.map((h) => h.manifestPath);
    const baseTexts = showManyOrNull(mergeBase, basePaths);
    // Only what this change wrote can announce what this change narrows.
    const baseChangesets = showManyOrNull(mergeBase, changesets.map((c) => c.path));
    const announcing = introducedChangesets(changesets, baseChangesets);

    const control = baseReadControl({ publishable, foundAtBase: baseTexts.size });
    if (!control.ok) {
      problems.push({ dir: SELF, name: 'ANNOUNCED base-read census control', lines: control.lines });
    } else {
      announcedRan = true;
      for (const { dir, name, manifest, manifestPath } of headManifests) {
        const baseText = baseTexts.has(manifestPath) ? baseTexts.get(manifestPath) : null;
        const narrowing = narrowingVerdict(baseText, manifest);
        if (narrowing.kind === 'unreadable-base') {
          problems.push({
            dir,
            name,
            lines: [
              `has a \`package.json\` at the merge base (${mergeBase.slice(0, 9)}) that does not parse as`,
              'JSON, so whether this PR narrows its resolvable surface cannot be decided. Absence of',
              'an answer is not a pass (#4690).',
            ],
          });
          continue;
        }
        if (narrowing.kind !== 'retrofit' && narrowing.kind !== 'removal') continue;

        const announced = announcementVerdict({
          pkg: name,
          narrowing,
          headExports: manifest.exports,
          changesets: announcing,
        });
        if (announced.satisfied) continue;

        const what =
          narrowing.kind === 'retrofit'
            ? [
                'declares an `exports` map that its `package.json` at the merge base did not, so this',
                'package was PUBLISHED without one. Every deep path a consumer reached through it --',
                `\`${name}/dist/...\` and anything else outside the new map -- stops resolving on the`,
                'next release, with no deprecation and no error the consumer can act on until they',
                'upgrade (#13662, #15325 — both found after publish, by the consumer).',
              ]
            : [
                `no longer resolves ${narrowing.lost.map((l) => `"${l}"`).join(', ')}, which its \`exports\` map`,
                'declared at the merge base. A subpath removed from a published map is a break for',
                'whoever imports it, and nothing in this monorepo can observe that: every in-repo',
                'consumer reaches the file through a relative import, a vitest alias or a `paths`',
                'entry, so the packaging contract is only exercised off-repo.',
              ];

        const fix =
          announced.reason === 'no-bump'
            ? [
                `Fix: add a changeset declaring "${name}": minor, and say in its body which deep paths`,
                '     stop resolving. That text ships to consumers as CHANGELOG.md inside the tarball',
                '     and is what an upgrading agent greps after ERR_PACKAGE_PATH_NOT_EXPORTED.',
              ]
            : announced.reason === 'unnamed-removal'
              ? [
                  `Fix: name the dropped subpath(s) in that changeset's body — ${announced.missing.join(', ')}`,
                  `     — either as the map key or as \`${name}<subpath>\`. A minor bump alone does not`,
                  '     tell a consumer which import to change.',
                ]
              : [
                  `Fix: name at least one deep specifier of \`${name}\` that the new map does NOT resolve`,
                  `     (e.g. \`${name}/dist/...\`, the shape a consumer actually wrote). The body names`,
                  '     only paths the map still resolves, which tells a consumer nothing — that is the',
                  '     boilerplate answer this clause exists to refuse.',
                ];

        problems.push({
          dir,
          name,
          lines: [
            ...what,
            ...fix,
            `     If a named out-of-repo consumer imports one of them, ratify it in`,
            '     packages/qa/downstream-contract/consumer-specifiers.ledger.json as well (#15589',
            '     option A) — that ledger records WHO imports it; this clause only asks that the',
            '     narrowing be announced at all.',
          ],
        });
      }
    }
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
    'than dist/ + README.md + CHANGELOG.md, each with a registered reason; ' +
    `${exportsDeclaring} declare an \`exports\` map gating what of that is resolvable ` +
    `(census control: floor ${EXPORTS_CENSUS_FLOOR}); ` +
    (announcedRan
      ? 'none narrows its resolvable surface against the merge base without a `minor` changeset ' +
        'naming the deep paths that stop resolving.'
      : 'ANNOUNCED DID NOT RUN.'),
);
