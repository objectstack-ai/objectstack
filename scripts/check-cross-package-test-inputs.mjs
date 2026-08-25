#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-cross-package-test-inputs -- keeps CI's idea of a test's inputs equal
// to the test's REAL inputs, for the tests that read outside their own package.
//
// ── The defect this exists to make impossible (#7802) ────────────────────────
//
// `packages/spec/src/data/api-methods-batch-conformance.test.ts` resolves the
// repo root and walks every `*.object.ts` in the monorepo. Its home package is
// `spec`; its input set is the whole repo. #7769 changed ONE object under
// `packages/platform-objects`, the scan's verdict flipped to red -- and the
// change reached `main` anyway, because BOTH of CI's scoping layers judge the
// scan by where it LIVES:
//
//   Layer A -- `turbo ls --affected` in ci.yml's `test` job (the PR path).
//     Affected packages come from the dependency GRAPH. `packages/spec` declares
//     no dependency on `packages/platform-objects` (and should not -- the scan
//     reads source text precisely to avoid inverting the spec -> * direction),
//     so a platform-objects-only diff can never reach spec. Measured on
//     turbo 2.10.7: 51 packages affected, `@objectstack/spec` not among them.
//
//   Layer B -- turbo's task cache. `test` declares `inputs: ["$TURBO_DEFAULT$",
//     ...]`, which is PACKAGE-LOCAL. `@objectstack/spec#test` therefore hashes
//     the same before and after any change outside `packages/spec`, so even the
//     merge-queue and push builds -- which deliberately partition the FULL
//     package list, not the affected subset -- replay a cached green.
//     Measured: `turbo run test --filter=@objectstack/spec` after the
//     platform-objects edit printed `>>> FULL TURBO`, 42ms, replaying the
//     previous run's log, while `--force` on the same tree failed the scan.
//
// Layer B is why the merge queue did not catch it. The `filter` job's
// `dorny/paths-filter` gate -- which DOES open up on `merge_group` -- was never
// the leak: `core` matches `packages/**`, so it was `true` throughout.
//
// ── The mechanism ───────────────────────────────────────────────────────────
//
// A package whose tests read outside itself declares that radius ONCE, in
// CROSS_PACKAGE_TEST_INPUTS -- declared in `scripts/cross-package-test-inputs.mjs`
// and imported here (see the note where it used to sit) -- and both layers are
// driven from it:
//
//   Layer A: `--union-into <turbo-ls.json>` adds the declaring package to the
//            shard's package set when the diff touches its declared globs.
//   Layer B: `--verify` requires turbo.json to carry a matching
//            `<pkg>#test` task whose `inputs` include the same globs as
//            `$TURBO_ROOT$/...` entries, so the cache hash moves with them.
//
// ── Why this is not just another hand-maintained list ───────────────────────
//
// It IS a list, and a list you must remember to update is exactly the failure
// mode that produced #7802. So the list does not depend on anyone remembering:
// `--verify` finds the escaping tests ITSELF, statically, and fails naming any
// package that has one and no declaration. Add a new cross-package scan and the
// gate goes red with the package name and what to write; the default for an
// undeclared scan is a RED GATE, never a silent skip. The reverse rots too, so
// it is checked in the same pass: a declaration whose package no longer has an
// escaping test fails as stale.
//
// Staleness has a SECOND grain, one level below that (#10566). Both limbs above
// are PACKAGE-scoped, so a package that keeps ONE escaping test can carry a
// declared GLOB held by nothing indefinitely and nothing says so -- the glob
// simply stops being checked against the code, which is the property a narrow
// radius rests on. `globHolderVerdict()` asks the per-GLOB question, and why it
// cannot be answered from the roster alone is written there.
//
// What the list buys over "just always run those packages" is the radius. A
// declared glob of `packages/**/*.object.ts` keeps spec's 5-minute suite off
// every PR that does not touch an object; `always-run` would put it on all of
// them, which is the affected-subset optimisation the 3-way shard exists for
// (ci.yml `test`) traded away to fix eight packages.
//
// ── What holds a radius, and the day it turned out to be prose (#9763) ──────
//
// A narrow glob is only safe while the gate can check it against the paths the
// tests really read, so `verify()` builds a ROSTER per package and fails naming
// any path outside the declared globs. That roster used to come from one flat
// regex over the source, which sees a path only when the WHOLE repo-relative
// path sits inside ONE quoted string and starts at a known top-level directory.
//
// Three live spellings do not, and the shortfall read as "covered" rather than
// as "unrecognised" -- silently, exit 0. Measured on 06f9848f9: for
// `create-objectstack`, dropping the declared glob AND unquoting two header
// COMMENTS made this gate pass, while the two tests that genuinely load
// `scripts/sync-template-versions.mjs` went right on loading it. Prose was
// holding the radius; an innocent reword would have unforced it.
//
// So the roster now has two halves, and the fix is a reconstruction rather than
// a wider regex:
//
//   FLAT      -- `repoRelativeLiterals()`, unchanged in kind, sees quoted whole
//                paths. Its one data defect was a missing top-level directory:
//                `skills/` was absent from the alternation, so formula's read of
//                its own published skill was invisible twice over.
//   RESOLVED  -- `scanPathExpressions()` walks the SAME recognised expressions
//                the escape detector already walks, and keeps the segment NAMES
//                alongside the depth (`walkLiteral`). A path split across
//                `join('scripts', 'x.mjs')` arguments and an ascent-relative
//                `new URL('../../../scripts/x.mjs', import.meta.url)` both come
//                out as the repo-relative string an author would have quoted.
//
// This needed no parser: the resolver was already there, computing depths for
// the escape verdict, and a name is that same walk in another coordinate. The
// gate stays dependency-free, which is what keeps it un-mutable in CI.
//
// What it still does not see, stated rather than discovered later: a path built
// by template literal (`${repoRoot}/scripts/x.mjs`), one whose segments come
// from a variable or an array the scan cannot fold, and a directory read whose
// path is only a loop variable. Each yields NO name -- never a wrong one; an
// unreadable argument costs the name and keeps the depth, so the escape verdict
// is unaffected and the roster never gains an entry pointing at a file nobody
// reads.
//
// ── The other way out of a package: the RESOLVER (#10452) ───────────────────
//
// Everything above is a path-shaped file read, seeded from `import.meta.url` or
// `__dirname`. An ES module specifier is none of those -- it is a bare string in
// `import` position that the module resolver, not `node:path`, turns into a
// file -- so "reads that reach another package through Node's RESOLVER are
// outside this gate entirely" was this file's stated boundary, and a test that
// IMPORTS across the package boundary went undeclared silently.
//
// Measured on `2d3860df9a`, not reasoned: two live `packages/cli` contract tests
// import `maskComments` from `../../../../scripts/js-comment-mask.mjs`. With the
// hand-added glob for it removed, this gate printed `OK: 12 package(s) read
// outside themselves, all declared` and exited 0 -- so an edit to that module
// would not have re-run cli's suite, which is #7802 exactly, by another spelling.
// The declaration was added by hand in PR #10450 precisely because the gate did
// not demand it.
//
// So specifiers are now walked by the same `walkLiteral`, in the same two
// coordinates, judged on the same shallowest point (RECOGNISED_IMPORT_SPELLINGS,
// published beside the path list). Two things make it a different read rather
// than a wider regex:
//
//   The BOUNDARY. Only a RELATIVE specifier is collected. A bare one
//   (`@objectstack/verify`) is an installed dependency resolved through
//   `node_modules`, which no glob can hash -- the same exclusion `vendored`
//   already makes. Getting this wrong would put every package's suite on every
//   workspace sibling.
//
//   The NAME. A specifier is not a path: under NodeNext `../x.js` is `../x.ts`
//   on disk, and three cli tests import the showcase app with no extension at
//   all. `resolveImportTarget()` maps the recognised extension rules back onto a
//   real file, and a specifier matching none of them keeps its escape verdict
//   and loses its name, exactly as an unreadable path argument does.
//
// This found six couplings nothing had ever declared: `@objectstack/client`'s
// route-ledger conformance tests import five sibling packages' `src/` directly,
// and `@objectstack/rest`, the three services and `plugin-auth` are not even
// dependencies of it -- so no graph edge reached them and no glob hashed them.
//
// ── The third way out: an ANCHOR the file cannot ask for (#10029) ───────────
//
// Every seed above answers "where am I?" from the module itself, so it resolves
// in the depth coordinate with nothing but the source. A CJS-typed package
// cannot ask that question at all: `packages/plugins/plugin-auth` publishes
// `dist/index.js` as CommonJS, so under `module: NodeNext` `import.meta` is a
// TS1470 there however well it runs under vitest. Four of its tests therefore
// walk UP from `process.cwd()` to an anchor -- its own `package.json`, or the
// workspace root -- and that walk resolved to nothing here. Nothing, in this
// gate, does not mean "unknown": it means the reads built on it produced no
// depth, no name and NO FLAG, which is the one failure mode this file exists
// not to have.
//
// Measured on `19f98fa1f^`, not reasoned: `rate-limit-storage-isolation.test.ts`
// read `packages/runtime/src` and `packages/services/service-sms/src` off such a
// seed, appeared in no roster, and turbo replayed a cached green over the scan
// it never re-ran -- #7802 exactly, by a fourth spelling. #10161 reseeded that
// ONE file from `__dirname`. `findUpSeeds()` closes the CLASS it was an instance
// of, so the next author who reaches for the idiom gets a red gate instead of
// silence. Today's population is clean, which is the point: this lands with no
// gate turning red and is pinned by `--self-test` cases that fail without it.
//
// What is new in kind: an anchor names an ABSOLUTE directory, where every other
// spelling names a place relative to the file. So it is the first seed that
// needs to know where the file SITS before it can be expressed as a depth, and
// the first that can name a directory this scan cannot locate (another
// package's manifest) -- which it answers with the trade `walkLiteral` already
// makes for an unreadable argument: keep the escape verdict, invent no name.
//
// ── The fourth way to be invisible: the LINE BREAK (#11093) ────────────────
//
// Every section above widened the set of recognised SHAPES. This one is not a
// shape at all: the same recognised call, printed by a formatter across four
// lines instead of one, resolved to nothing.
//
// A `const X = …` initialiser used to be matched by a regex with a hard TWO-LINE
// window, so a call prettier broke past the print width matched nothing at all
// -- no binding, no depth, no name, and therefore no flag. A read ARGUMENT never
// carried that window (`balancedArgs` has always been line-agnostic), which is
// why #11093 reported the asymmetry as `new URL()` seen / `resolve()` unseen.
// Measured rather than reasoned, on `7f30b6be`: the split is POSITION, not
// spelling. Multi-line `new URL()`, `resolve()` and `join()` were ALL invisible
// in declaration position and all three visible in argument position. So the
// spelling a formatter produces for any relative literal long enough to break
// the line was the unseen one -- the default, not an exotic case.
//
// Two halves, and only one of them is loud. `declarationInitialiser()` reads the
// statement to a depth-0 terminator, which restores the DEPTH and with it the
// escape flag. `withoutTrailingComma()` restores the NAME, which the formatter's
// trailing comma was costing on its own: `splitTopLevel` yields that comma as an
// EMPTY final argument, and an empty argument read as "one I cannot fold" nulls
// the segments (`pathExpression`). Fixing only the first half would have flagged
// the read and still left its declared glob held by nothing -- the #10566
// failure, reported against the glob rather than against the scan.
//
// Measured on `7f30b6be` with a probe test in `packages/spec`, both directions:
// `resolve(HERE, '../../../scripts/js-comment-mask.mjs')` on one line reached the
// roster, and the four-line spelling of the same call did not. On the tree as it
// stands the whole answer -- every escaping package, every rostered path and
// directory, every `globHolderVerdict` -- is byte-identical before and after, so
// this recognises more without re-attributing any existing glob. The probe is
// what proves the instrument was sensitive; the unchanged tree on its own would
// prove nothing.
//
// Usage:
//   node scripts/check-cross-package-test-inputs.mjs --verify
//   node scripts/check-cross-package-test-inputs.mjs --union-into <turbo-ls.json> --changed <file>
//   node scripts/check-cross-package-test-inputs.mjs --list-escapes
//   node scripts/check-cross-package-test-inputs.mjs --self-test

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, relative, dirname, sep, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

import { CROSS_PACKAGE_TEST_INPUTS } from './cross-package-test-inputs.mjs';
import { matchesAny, selfTest as globMatchSelfTest } from './glob-match.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/**
 * Where a dev must go to ADD a declaration, for the remedy this gate prints.
 *
 * Derived from the import specifier rather than spelled, so it cannot go on
 * naming this file after the table moved (#11511) -- a remedy that names the
 * wrong file is worse than a vague one, because the dev follows it and finds
 * nothing to edit. Computing it from the module URL also keeps the string out
 * of this module body: `extractWatchHints` strips a leading `./` and then
 * refuses what is left for having no separator, so an import specifier scores
 * as no population while a repo-relative spelling would score as one.
 */
const DECLARATION_FILE = relative(REPO_ROOT, fileURLToPath(new URL('./cross-package-test-inputs.mjs', import.meta.url)));

// ── the declaration table, and the predicate applied to it ───────────────
//
// Both moved OUT of this gate and into plain modules no workflow invokes
// (#11511), because a gate that is also a library is a module the dispatch
// derivation cannot follow: `scripts/pm/dispatch-gates.mjs` follows a gate's
// first-party imports one level, but never into a file that is itself a
// discovered gate. `check:ci-filter-parity` reads the table and derived
// NOTHING from it while it lived here.
//
// They landed in two modules rather than one on measurement -- the follow
// hands an importer the whole followed module's population, so pairing the
// predicate with the table would have handed `check:examples-live-imports`
// 3105 (gate, file) pairs it never opens. Each module's header carries its own
// half of that measurement.
//
// This gate's own coverage is unchanged: it imports the table, so the follow
// gives every one of those globs back to `check:cross-package-test-inputs`,
// now labelled with the module they came from.


/**
 * Whether the declared globs cover a DIRECTORY a test lists with `readdirSync`.
 *
 * Not the same question as `matchesAny`, and the difference is not a detail: a
 * subtree glob is written to match FILES, so `packages/lint/src/**` does not
 * match the bare string `packages/lint/src`, while turbo hashing that glob does
 * re-run the test when the listing changes. What a directory read needs is that
 * the glob covers what is INSIDE the directory.
 *
 * Answered against the real entries rather than inferred from the glob's shape,
 * because shape cannot tell the two apart: `packages/lint/src/**` and
 * `packages/lint/src/**\/*.object.ts` both look like subtree globs and only the
 * first re-runs when an ordinary `.ts` file appears. An empty directory is not
 * covered by anything — there is nothing to have matched.
 */
export function coversDirectory(dir, globs, root = REPO_ROOT) {
  let entries;
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true });
  } catch {
    return false;
  }
  const files = entries.filter((e) => e.isFile()).map((e) => `${dir}/${e.name}`);
  return files.length > 0 && files.every((f) => matchesAny(f, globs));
}

// ── the escape detector ──────────────────────────────────────────────────────
const FS_READ = /\b(readFileSync|readdirSync|statSync|existsSync|globSync|opendirSync|execFileSync)\b/;
/** A quoted literal that climbs — the cheapest necessary condition for an escaping import (#10452). */
const ASCENDING_LITERAL = /(['"])\.\.\//;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.turbo', '.next', '.git']);

/**
 * Reads whose FIRST argument is a path, for the argument-position scan below.
 * `execFileSync` is deliberately absent from this list though it is in FS_READ:
 * its first argument is a binary to run, not a file to read.
 */
const PATH_ARG_READS = ['readFileSync', 'readdirSync', 'statSync', 'lstatSync', 'existsSync', 'globSync', 'opendirSync'];

/**
 * The path spellings this gate can SEE, in the words an author would write them.
 * Printed in the failure text and mirrored in AGENTS.md, because the detector is
 * a source scan: a spelling that is not on this list yields no flag, so a read
 * written that way goes undeclared silently. Anything added here needs a
 * `--self-test` case in the same edit, or the next refactor drops it unnoticed.
 *
 * The AGENTS.md copy is held BYTE-IDENTICAL to this array by
 * `scripts/check-published-list-mirrors.mjs` (#10855), comments included: twice the
 * stale line over there was the stated REASON FOR A PROHIBITION (#10163, #10854), so
 * a containment check would have missed exactly the drift that cost the most. Editing
 * this array therefore means editing that block in the SAME PR -- and AGENTS.md is
 * governed, human-merge-only, so that gate can only ever go RED. It prints the block
 * to paste.
 */
export const RECOGNISED_PATH_SPELLINGS = [
  "const HERE = dirname(fileURLToPath(import.meta.url));   // seed (ESM)",
  'const HERE = __dirname;                                  // seed (CJS)',
  'const HERE = import.meta.dirname;       // and dirname(import.meta.filename)',
  "const HERE = resolve(fileURLToPath(import.meta.url), '..');  // seed, walked",
  '                                        // from the FILE instead of named;',
  '                                        // import.meta.filename works too',
  "const P = resolve(HERE, '<rel>');       // join() and the path.* forms too",
  "const P = fileURLToPath(new URL('<rel>', import.meta.url));",
  "const P = new URL('<rel>', import.meta.url);",
  "readFileSync(resolve(HERE, '<rel>'))    // the same expressions in argument",
  "readFileSync(new URL('<rel>', import.meta.url))              // position",
  '',
  '// Any call above may be BROKEN ACROSS LINES -- a formatter does that to every',
  '// argument list past the print width, so it is the DEFAULT spelling for a long',
  '// relative literal, and it is read whole, trailing comma and all (#11093).',
  '',
  '// ANCHOR seeds -- a findUp walk, for a CJS-typed package where import.meta',
  '// is a TS1470. Both compose with every expression above (#10029).',
  "const PKG = findUp((dir) => JSON.parse(readFileSync(join(dir, 'package.json'))).name",
  "                           === '<the name of THIS package>');   // -> package root",
  "const REPO = findUp((dir) => existsSync(join(dir, 'pnpm-workspace.yaml')));",
  '                                        // -> repo root',
  '  ⛔ NOT a manifest name belonging to some OTHER package -- that root cannot',
  '     be located from here, so the escape is flagged and the path is NOT named',
];

/**
 * The IMPORT spellings this gate can SEE, in the words an author would write
 * them (#10452). Published for the same reason as the list above, and printed
 * beside it in the failure text.
 *
 * An ES module specifier is none of the shapes above it: it is a bare string in
 * `import` position that the module RESOLVER, not `node:path`, turns into a
 * file. So until this list existed the gate's stated boundary — "reads that
 * reach another package through Node's RESOLVER rather than through `fs` are
 * outside this gate entirely" — held, and a test importing across the package
 * boundary went undeclared silently. Measured on `2d3860df9a`: with
 * `scripts/js-comment-mask.mjs` deleted from `@objectstack/cli`'s globs, and two
 * live tests importing `maskComments` from it, this gate printed
 * `OK: 12 package(s) read outside themselves, all declared` and exited 0.
 *
 * ⚠️ The boundary that makes this safe: only specifiers that START RELATIVE
 * (`./`, `../`) are read. A BARE specifier (`@objectstack/verify`, `node:fs`) is
 * an installed dependency resolved through `node_modules` — the same thing
 * `walkLiteral`'s `vendored` flag already drops, for the same reason: no turbo
 * glob can name it, and collecting them would put every package's suite on every
 * workspace sibling. A relative specifier that ESCAPES is the opposite case: it
 * names a repo source file a glob can hash, and nothing else was seeing it.
 */
export const RECOGNISED_IMPORT_SPELLINGS = [
  "import { x } from '../<rel>';     // static — `import type` counts too, it",
  '                                  // is an input to the typecheck verdict',
  "export { x } from '../<rel>';     // re-export, and `export * from`",
  "import '../<rel>';                // side-effect import",
  "await import('../<rel>');         // dynamic, with a LITERAL specifier",
  "require('../<rel>');              // cjs (no test spells it this way today)",
  '  ⛔ NOT `@objectstack/<pkg>`     // a BARE specifier is an installed',
  '                                  // dependency, never a repo source input',
];

/**
 * Every string-literal module specifier in `src`, in the four positions a
 * specifier can occupy. The pattern set is the one `check-examples-live-imports`
 * already proved on this same corpus — that gate reads test imports for the
 * `examples/**` axis, and this is the same read widened to every target.
 *
 * Deliberately NOT comment-masked, which is where this gate parts company with
 * that sibling. Masking is a read that can only SHRINK what is collected, and a
 * spelling wrongly masked is a live import gone silent — the one failure mode
 * this file exists to not have. Not masking can only over-collect, and this gate
 * settles that trade the same way everywhere else: a mention forces a WIDER
 * declaration, never a narrower one (see the `check-nul-bytes.mjs` roster entry,
 * declared for exactly that reason).
 *
 * Measured on this tree across 2509 test sources: of the 4174 relative
 * specifiers this finds, 6 exist only inside comments — and not one of those 6
 * escapes its package, so none reaches the roster at all. The over-collection
 * this trade accepts is real but currently costs nothing, and it is bounded in
 * the safe direction by construction: a commented-out specifier can only force
 * a declaration nobody needed, never withdraw one a live import holds.
 */
export function importSpecifiers(src) {
  const out = new Set();
  const patterns = [
    // `from '<spec>'` covers `import … from` and `export … from`, multiline
    // clauses included — a clause never contains a quote, so the literal that
    // follows `from` is the specifier.
    /\bfrom\s*(['"])([^'"\n]+)\1/g,
    /\bimport\s*(['"])([^'"\n]+)\1/g,
    /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g,
    /\brequire\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g,
  ];
  for (const re of patterns) for (const m of src.matchAll(re)) out.add(m[2]);
  return out;
}

/**
 * The specifier extensions this gate can map back to a file ON DISK.
 *
 * Under `moduleResolution: NodeNext` a TypeScript source is imported with the
 * extension of the file it will EMIT, so `../x.js` is `../x.ts` on disk — while
 * a root script really is `.mjs` and resolves as itself. Extensionless
 * specifiers occur too. Measured on this tree, over every relative specifier
 * that escapes its package: 15 extensionless (`packages/client`'s five
 * route-ledger conformance tests, which import six sibling packages that way),
 * 10 `.js` naming a `.ts` (`packages/lint` and cli, into `examples/`), and 3
 * literal `.mjs` (the two cli tests of #10452, plus `packages/spec`'s
 * `schema-tree-freshness.test.ts` reaching `scripts/check-regen-pending.mjs`).
 * Each rule below is pinned by a `--self-test` case against a real file, so a
 * rule that stops resolving fails here rather than going quiet.
 *
 * ⚠️ "Extensionless" is judged against the KNOWN module extensions, never
 * against "the last segment contains a dot". This repo's authored metadata is
 * `contact.view.ts`, `semantic-zoo.object.ts`, `task-triage.page.ts`, and it is
 * imported as `../../../examples/app-showcase/src/ui/views/contact.view` — a
 * trailing-dot-segment test reads `.view` as an extension, appends nothing, and
 * the specifier resolves to nothing. Measured: that spelling is exactly the
 * three `packages/cli` i18n-coverage imports, whose globs were on the roster by
 * HAND. Getting this wrong does not fail loudly; it silently declines to hold a
 * radius somebody already wrote down.
 *
 * A specifier matching none of them keeps its ESCAPE verdict and loses its NAME
 * — the same trade `walkLiteral` makes for an argument it cannot read, and for
 * the same reason: a roster entry pointing at a file nobody reads is worse than
 * a missing one. The author still gets a red gate naming the test.
 */
const KNOWN_MODULE_EXTENSION = /\.(?:[cm]?[jt]sx?|json|node)$/;

function resolveImportTarget(name) {
  const candidates = [name];
  if (/\.js$/.test(name)) candidates.push(name.replace(/\.js$/, '.ts'), name.replace(/\.js$/, '.tsx'));
  else if (/\.mjs$/.test(name)) candidates.push(name.replace(/\.mjs$/, '.mts'));
  else if (/\.cjs$/.test(name)) candidates.push(name.replace(/\.cjs$/, '.cts'));
  else if (!KNOWN_MODULE_EXTENSION.test(name)) candidates.push(`${name}.ts`, `${name}.tsx`, `${name}.mts`);
  for (const c of candidates) {
    try {
      if (statSync(join(REPO_ROOT, c)).isFile()) return c;
    } catch {
      // Not this candidate — try the next.
    }
  }
  return null;
}

function walkTests(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walkTests(p, out);
    else if (/\.test\.[cm]?[jt]sx?$/.test(e.name)) out.push(p);
  }
  return out;
}

function packageRootOf(file) {
  let d = dirname(file);
  while (d.startsWith(REPO_ROOT) && d !== REPO_ROOT) {
    if (existsSync(join(d, 'package.json'))) return d;
    d = dirname(d);
  }
  return null;
}

/**
 * Walk a relative path literal from `base` (a depth below the package root),
 * reporting where it ENDS, the SHALLOWEST point it passes through, and whether
 * it steps into an installed dependency.
 *
 * `min` is the load-bearing number, and `end` alone is a trap: a literal that
 * climbs past the package root and then descends into a SIBLING package ends at
 * a perfectly positive depth while addressing another package entirely.
 * `join(HERE, '..', '..', 'spec', 'src', 'rls.zod.ts')` from `<pkg>/src` ends at
 * +4 and reads `packages/spec` — the exact #7802 shape, invisible to a test on
 * the final depth. Final depth is only sound for a binding that STOPS at the top
 * of its ascent, which is what a `REPO_ROOT` const happens to be and what the
 * other spellings are not.
 *
 * `segs` is the SAME walk carried in repo-relative NAMES rather than in depths,
 * and it is what lets the roster below name a file the source never spells as
 * one whole string (#9763). It is `null` whenever the name stops being knowable
 * — an unresolved base, an argument this scan cannot read, or an ascent past the
 * repo root — because a path with a segment missing from its middle is a
 * fabricated roster entry, and a coverage check that fabricates entries is worse
 * than one that misses them. Depth decides the ESCAPE verdict either way; segs
 * only ever adds a name to the radius roster.
 */
function walkLiteral(base, literal, segs) {
  let end = base;
  let min = base;
  let vendored = false;
  let out = segs ? [...segs] : null;
  for (const seg of literal.split('/').filter(Boolean)) {
    if (seg === '..') {
      end -= 1;
      // Above the repo root there is no repo-relative name to report.
      if (out) out = out.length ? out.slice(0, -1) : null;
    } else if (seg !== '.') {
      end += 1;
      if (out) out = [...out, seg];
      // An installed dependency is not a repo source input: turbo cannot hash
      // `node_modules/**` as a source glob, and the walk above skips it anyway.
      // A read that lands there escapes the package but declares nothing.
      if (seg === 'node_modules') vendored = true;
    }
    if (end < min) min = end;
  }
  return { end, min, vendored, segs: out };
}

/** Split an argument list on its TOP-LEVEL commas — `new URL(x, import.meta.url)` has one of its own. */
function splitTopLevel(text) {
  const out = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(text.slice(start).trim());
  return out;
}

const PATH_LITERAL = /^(['"`])([^'"`]*)\1$/;
const NEW_URL_LITERAL = /^new\s+URL\(\s*(['"`])([^'"`]*)\1\s*,\s*import\.meta\.url\s*,?\s*\)$/;

/**
 * `PATH_LITERAL`'s character class excludes only quote characters, so a
 * BACKTICK-delimited argument containing no quotes matches it even when it is
 * an interpolating template — `` `${someVar}` `` reads as the literal segment
 * text `${someVar}`, which the walk below would count as ONE ordinary descent
 * instead of routing it through the cannot-read branch that exists for exactly
 * this case. That is not a lower bound: it biases the depth walk UPWARD and can
 * hide an escape the unreadable-argument trade was written to still catch
 * (#11487). A single- or double-quoted literal is unaffected — `${` inside one
 * of those is ordinary text, never interpolation, so only the backtick
 * delimiter needs the extra check. This is the ONE call site `PATH_LITERAL`
 * has in this file (inside `pathExpression()`'s `resolve`/`join` argument
 * walk), so narrowing it here does not move any other consumer's verdict.
 */
function readablePathLiteral(arg) {
  const lit = arg.match(PATH_LITERAL);
  if (!lit) return null;
  if (lit[1] === '`' && lit[2].includes('${')) return null;
  return lit;
}

/**
 * `NEW_URL_LITERAL` has the identical character-class shape as `PATH_LITERAL`
 * above, and the identical blind spot: a BACKTICK-delimited argument holding no
 * quotes matches it even when it is an interpolating template, so
 * `` new URL(`${someVar}`, import.meta.url) `` would read `${someVar}` as the
 * literal segment text and walk it as one ordinary descent (#12085). Unlike
 * `readablePathLiteral()`'s call site, this one has no "cannot read, keep
 * depth" fallback to route into — `pathExpression()` just returns `undefined`
 * for the whole `new URL(...)` seed when this returns `null`, the same outcome
 * as any other unrecognised seed shape. A single- or double-quoted literal is
 * unaffected — `${` inside one of those is ordinary text, never interpolation.
 * This is the ONE call site `NEW_URL_LITERAL` has in this file, so narrowing it
 * here does not move any other consumer's verdict.
 */
function readableNewUrlLiteral(expr) {
  const lit = expr.match(NEW_URL_LITERAL);
  if (!lit) return null;
  if (lit[1] === '`' && lit[2].includes('${')) return null;
  return lit;
}

/**
 * A formatter's TRAILING COMMA, dropped from an argument list before it is read.
 *
 * The other half of the line-spanning spelling (#11093), and the half that would
 * have survived a fix to `declarationInitialiser()` alone: prettier ends every
 * argument list it breaks across lines with one, and `splitTopLevel` yields it
 * as an EMPTY final argument. An empty argument is not a literal, so the walk
 * below took it for "an argument I cannot fold" and threw the NAME away while
 * keeping the depth — the read would have been flagged as escaping and still
 * held no glob. Measured on `7f30b6be`: the depth-only half of this defect is
 * silent, so a case pinning only "it flags" passes with the name still lost.
 *
 * Safe as a text rule because it only strips a comma that is the LAST non-space
 * character of a whole argument list: a quoted literal always ends with its own
 * quote, so no string can be shortened by it.
 */
const withoutTrailingComma = (args) => args.replace(/,\s*$/, '');

/**
 * Resolve one path expression to `{ end, min, vendored, segs }`, or `undefined`
 * when the spelling is not one of RECOGNISED_PATH_SPELLINGS. Recursive so that
 * every recognised form composes with every other: a `new URL` seed may sit
 * under a `fileURLToPath`, inside a `resolve()`, in a read's argument — each
 * layer is peeled by the same function rather than by a separate special case.
 *
 * `fileSegs` is the repo-relative segments of the file being scanned, or `null`
 * when the caller has no repo context (the `--self-test` shapes, which assert on
 * depth alone). It is what turns the depth walk into a NAME: with it, the three
 * spellings of #9763 — a path split across `join`/`resolve` arguments, an
 * ascent-relative literal, and a descent into a top-level directory the flat
 * literal regex does not list — resolve to the same repo-relative string an
 * author would have written in one quoted piece.
 */
function pathExpression(expr, hereDepth, known, fileSegs = null) {
  expr = expr.trim();
  // The directory-naming seeds below NAME the directory; `fileSegs` names the
  // FILE inside it. Named rather than counted: the recognised set has been
  // widened twice (#8995, #9763), and these comments went on saying "the two
  // seeds" long after it reached four. A count copied into prose goes stale
  // silently -- RECOGNISED_PATH_SPELLINGS, printed verbatim in the failure
  // text, cannot (#10565).
  const dirSegs = fileSegs ? fileSegs.slice(0, -1) : null;
  const at = (depth, segs) => ({ end: depth, min: depth, vendored: false, segs });

  // `fileURLToPath(x)` does not move the path, only its spelling.
  const unwrapped = expr.match(/^(?:url\.)?fileURLToPath\(([\s\S]*)\)$/);
  if (unwrapped) return pathExpression(withoutTrailingComma(unwrapped[1]), hereDepth, known, fileSegs);

  // Every `\s*` below already spans newlines, so each seed reads the same broken
  // across lines as on one — `,?` is all the line-spanning form adds (#11093).
  if (/^(?:path\.)?dirname\(\s*(?:url\.)?fileURLToPath\(\s*import\.meta\.url\s*,?\s*\)\s*,?\s*\)$/.test(expr)) {
    return at(hereDepth, dirSegs);
  }
  if (expr === '__dirname') return at(hereDepth, dirSegs);
  // `import.meta.dirname` / `.filename` (Node >= 20.11) are the modern spelling of
  // the two seeds above. No test uses them TODAY — which is the reason to accept
  // them now: the first author who reaches for them would otherwise get silence.
  if (expr === 'import.meta.dirname') return at(hereDepth, dirSegs);
  if (/^(?:path\.)?dirname\(\s*import\.meta\.filename\s*,?\s*\)$/.test(expr)) {
    return at(hereDepth, dirSegs);
  }
  // The directory-naming seeds above NAME the directory. `import.meta.url` and
  // `import.meta.filename` name the FILE, which sits one level below it, and an
  // author reaches that same directory by WALKING instead — most often
  // `resolve(fileURLToPath(import.meta.url), '..')`. Modelling the file at
  // `hereDepth + 1` is what makes the walked form come out equal to the named one
  // through the ordinary literal walk below, rather than needing a case of its own,
  // and it is precisely Node's `resolve`/`join`, which treat a file argument as a
  // directory prefix like any other. Unrecognised until #8995: three packages/cli
  // e2e tests seed this way, so their reads of `content/docs/**` produced no flag
  // and went undeclared — the silence this list exists to prevent, and it cost a
  // merge-queue dequeue (PR #8983) before anyone saw it.
  if (expr === 'import.meta.url' || expr === 'import.meta.filename') {
    return at(hereDepth + 1, fileSegs);
  }

  // A `new URL(rel, import.meta.url)` resolves against the importing FILE, so
  // its base is the file's directory — the same base as the directory-naming
  // seeds above. This is the ASCENT-RELATIVE spelling of #9763: one string, but
  // it starts at `..`, so the flat literal regex below never saw it while the
  // walk here has always resolved it — the name was thrown away, not the path.
  const url = readableNewUrlLiteral(expr);
  if (url) return walkLiteral(hereDepth, url[2], dirSegs);

  if (/^[A-Za-z_$][\w$]*$/.test(expr)) return known.get(expr);

  const call = expr.match(/^(?:path\.)?(?:resolve|join)\(([\s\S]*)\)$/);
  if (!call) return undefined;
  const args = splitTopLevel(withoutTrailingComma(call[1]));
  const base = pathExpression(args[0], hereDepth, known, fileSegs);
  if (!base) return undefined;
  let { end, min, vendored, segs } = base;
  for (const a of args.slice(1)) {
    const lit = readablePathLiteral(a);
    if (!lit) {
      // An argument this scan cannot read leaves the DEPTH walk where it was —
      // deliberately, since the escape verdict is a lower bound and has always
      // been computed this way — but the NAME is gone: a reconstructed path
      // missing a segment out of its middle would be a roster entry pointing at
      // a file nobody reads. Losing the name is the safe half of that trade.
      segs = null;
      continue;
    }
    const step = walkLiteral(end, lit[2], segs);
    end = step.end;
    min = Math.min(min, step.min);
    vendored = vendored || step.vendored;
    segs = step.segs;
  }
  return { end, min, vendored, segs };
}

/**
 * The reads whose path argument is a DIRECTORY rather than a file. A directory
 * handed to one of these is a real input — `readdirSync(LINT_SRC)` re-reads
 * whatever `packages/lint/src` contains — so the roster must be allowed to name
 * it, which the file-only filter in `findEscapingPackages()` otherwise forbids.
 * Kept to the two calls whose argument can only be a directory: `statSync` and
 * `existsSync` take either, and admitting them would let any directory PREFIX
 * used to build a path force a declaration. `globSync` is out for the opposite
 * reason — its first argument is a pattern, not a directory.
 */
const DIR_ARG_READS = new Set(['readdirSync', 'opendirSync']);

/**
 * The name and argument list of every fs read whose first argument is a path,
 * paren-balanced.
 */
function* readArgumentLists(src) {
  const re = new RegExp(String.raw`\b(${PATH_ARG_READS.join('|')})\s*\(`, 'g');
  for (const m of src.matchAll(re)) {
    const args = balancedArgs(src, m.index + m[0].length);
    if (args !== null) yield { fn: m[1], args };
  }
}

/**
 * Scan `src` forward from `from`, quote-aware, tracking PARENTHESIS depth, and
 * return the index of the first character `stop(char, depth)` accepts -- or -1
 * if the scan ran off the end without one. `depth` is the depth AFTER the
 * character has been counted, so the paren that closes the group `from` sits
 * inside arrives as -1.
 *
 * The one place this file knows how to skip a string literal. Quote-awareness
 * is why a `(` inside a quoted path -- or the `)` inside a
 * `` throw new Error(`could not locate ${what}`) `` -- does not move the depth,
 * and it is the part a future fix is most likely to land on. Both readers below
 * share it for that reason: a mirrored helper is the shape #10628 already had to
 * undo in this file once (a hand-copied `globToRegExp`), and one scanner means a
 * fix to it cannot land on one caller and miss the other.
 *
 * ⛔ `[` and `{` are deliberately NOT counted. `declarationInitialiser()` ends a
 * statement at a depth-0 newline, and counting braces would make a declaration
 * whose initialiser is a function or object BODY swallow every declaration
 * inside it -- the two-line window's failure mode (#11093), one nesting level up.
 * An unbalanced bracket costs a name, never invents one, which is the trade
 * `walkLiteral` already makes everywhere else here.
 */
function scanBalanced(src, from, stop) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    if (stop(c, depth)) return i;
  }
  return -1;
}

/**
 * The argument text of a call whose opening paren sits at `from - 1`, or `null`
 * when the parens never close.
 *
 * Extracted from `readArgumentLists` rather than written a second time beside
 * the anchor seeds below, which need the same balanced read over a DIFFERENT
 * callee.
 */
function balancedArgs(src, from) {
  const end = scanBalanced(src, from, (c, depth) => c === ')' && depth < 0);
  return end === -1 ? null : src.slice(from, end);
}

/**
 * The initialiser text of a `const X = …` declaration whose `=` has just been
 * consumed, or `null` when the statement never ends. The terminator is a `;` or
 * a newline at paren depth 0 -- a call that BREAKS ACROSS LINES is still inside
 * its own parens at every line end, so it is read whole (#11093).
 *
 * ⚠️ This is where the line-spanning spelling was lost, and it was never about
 * `resolve()` in particular. The initialiser used to be matched by a regex with
 * a hard TWO-LINE window (`[^;\n]+(?:\n\s*[^;\n]*)??`), so ANY declaration whose
 * call a formatter broke over three or more lines matched nothing at all -- no
 * binding, no depth, no name, and therefore no flag. Measured on `7f30b6be`
 * against a probe in `packages/spec`: the one-line
 * `resolve(HERE, '../../../scripts/js-comment-mask.mjs')` reached the roster and
 * the same call spelled across four lines did not, while `new URL()` broken the
 * same way was equally invisible. What made `new URL()` look like the recognised
 * half in #11093's report is POSITION, not spelling: a read ARGUMENT is read by
 * `balancedArgs` above, which was always line-agnostic, and only the declaration
 * position carried the window. Prettier writes the multi-line form for any path
 * long enough to pass the print width, so this was the DEFAULT spelling for a
 * long relative literal, not an exotic one.
 *
 * A newline at depth 0 ends the statement as well as `;` does, so an initialiser
 * this scan cannot use (a `{` object literal, an arrow-function body) stops at
 * its first line instead of running to some later `;`. That keeps the head-match
 * loop in `scanPathExpressions()` able to reach every declaration NESTED inside
 * such an initialiser, which the two-line window consumed and hid.
 */
function declarationInitialiser(src, from) {
  const end = scanBalanced(src, from, (c, depth) => depth < 0 || (depth === 0 && (c === ';' || c === '\n')));
  return end === -1 ? null : src.slice(from, end).trim();
}

/**
 * The marker files that identify the WORKSPACE ROOT to a `findUp` walk. A
 * predicate that tests for one of these resolves, statically, to the repo root
 * -- there is exactly one directory in the tree that has it.
 *
 * Published and plural for the same reason `RECOGNISED_PATH_SPELLINGS` is: the
 * set is what the gate can SEE, so a walk keyed on some other root marker
 * (`turbo.json`, `.git`) yields no seed and the reads built on it go undeclared
 * silently. Adding one here is a data change plus a `--self-test` case.
 */
export const WORKSPACE_ROOT_MARKERS = ['pnpm-workspace.yaml'];

/** `const X = findUp(` / `let X = findUp(` — the binding the anchor seeds arrive as. */
const FIND_UP_BINDING = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*string\s*)?=\s*findUp\s*\(/g;
/** A manifest-name predicate, in either argument order. */
const MANIFEST_NAME_TEST = /\bname\s*===\s*(['"`])([^'"`]+)\1|(['"`])([^'"`]+)\3\s*===\s*\bname\b/;

/**
 * The ANCHOR seeds: `findUp` walks that name an absolute directory in the tree
 * rather than a place relative to the importing file (#10029).
 *
 * Every seed above this one answers "where am I?" -- `import.meta.url`,
 * `__dirname`, `import.meta.dirname`. A CJS-typed package cannot ask that
 * question: under `module: NodeNext` `import.meta` is a TS1470 there however
 * well it runs under vitest, so `packages/plugins/plugin-auth` reaches for a
 * walk up from `process.cwd()` instead, and four of its tests spell it. That
 * walk resolved to NOTHING here, so every path built on it resolved to nothing
 * too -- no depth, no name, no flag, which is this gate's one failure mode.
 * Measured on `19f98fa1f^`: `rate-limit-storage-isolation.test.ts` read
 * `packages/runtime/src` and `packages/services/service-sms/src` through such a
 * seed and appeared in NO roster, while turbo replayed a cached green over the
 * scan it never re-ran (#7802 exactly). #10161 reseeded that one file from
 * `__dirname`; this closes the CLASS the file was an instance of.
 *
 * Two predicates are knowable without executing anything, and they are the two
 * the idiom uses:
 *
 *   PACKAGE ROOT -- the predicate reads a `package.json` and compares its `name`
 *     to a literal. When that literal is the scanned file's OWN package, the
 *     answer is this package's root: depth 0, named.
 *   REPO ROOT -- the predicate tests for a WORKSPACE_ROOT_MARKERS file. The
 *     answer is the repo root, which sits `pkgSegs.length` levels ABOVE the
 *     package root, so the binding escapes on its own -- exactly as the
 *     `resolve(HERE, '../../../..')` spelling of the same anchor already does.
 *
 * ⚠️ Why these need repo context when no other seed does. Every other spelling
 * is relative to the FILE, so it resolves in the depth coordinate on its own; an
 * anchor names an absolute directory, and where that lands relative to the
 * package root is not knowable until you know where the file sits. So both
 * arrive only with `fileSegs`, and a caller with none (the depth-only
 * `--self-test` shapes) gets no seed rather than a guessed one.
 *
 * ⛔ The boundary that keeps this from FABRICATING. A predicate naming some
 * OTHER package's manifest resolves to that package's root, which this scan
 * cannot locate without walking the tree -- so it takes the sound half of the
 * trade `walkLiteral` already makes for an unreadable argument: the walk
 * necessarily passed through the repo root, so `min` says so and the escape is
 * flagged, while `segs` is `null` and no name is invented. A roster entry
 * pointing at a file nobody reads is worse than a missing one.
 *
 * An unrecognised predicate yields no seed at all, which is the pre-#10029
 * behaviour and is why the recognised set is published rather than implied.
 */
function findUpSeeds(src, hereDepth, fileSegs, ownPackageName) {
  const seeds = new Map();
  // An anchor is absolute; without the file's place in the tree there is no
  // depth to express it in. Depth-only callers get nothing, deliberately.
  if (!fileSegs) return seeds;
  const pkgSegs = fileSegs.slice(0, fileSegs.length - 1 - hereDepth);
  const repoRootDepth = -pkgSegs.length;
  for (const m of src.matchAll(FIND_UP_BINDING)) {
    const args = balancedArgs(src, m.index + m[0].length);
    if (args === null) continue;
    if (WORKSPACE_ROOT_MARKERS.some((f) => args.includes(f))) {
      seeds.set(m[1], { end: repoRootDepth, min: repoRootDepth, vendored: false, segs: [] });
      continue;
    }
    const named = args.includes('package.json') ? args.match(MANIFEST_NAME_TEST) : null;
    if (!named) continue;
    const wanted = named[2] ?? named[4];
    if (ownPackageName && wanted === ownPackageName) {
      seeds.set(m[1], { end: 0, min: 0, vendored: false, segs: pkgSegs });
    } else {
      // Another package's root: outside this one for certain, locatable only by
      // walking the tree. Keep the verdict, drop the name.
      seeds.set(m[1], { end: repoRootDepth, min: repoRootDepth, vendored: false, segs: null });
    }
  }
  return seeds;
}

/**
 * One pass over `src`, answering the gate's two separate questions at once:
 *
 *   `escapes` — every path that addresses something outside the package, which
 *               in a file that also reads the filesystem is the #7802 shape.
 *   `files` / `dirs` — the repo-relative paths those same expressions RESOLVE
 *               to, which is the radius roster `verify()` measures declarations
 *               against. Split by what the read wants, because the filter in
 *               `findEscapingPackages()` differs: a directory counts only when a
 *               directory-listing read is what consumed it.
 *
 * The two answers come from one walk because they come from one resolution: the
 * depth that decides `escapes` and the name that fills the roster are the same
 * traversal seen in two coordinates (see `walkLiteral`).
 *
 * Deliberately a source scan and not a real parse: a detector with no
 * dependencies cannot itself fail to resolve in CI, which is what keeps this
 * gate un-mutable. The price is that it only sees the spellings it knows, so the
 * list it knows is published (RECOGNISED_PATH_SPELLINGS, printed in the failure
 * text and mirrored in AGENTS.md) instead of being an implementation detail an
 * author has to reverse-engineer from a silent pass.
 *
 * Two positions are scanned, because a path is as often nested straight into the
 * read as it is bound to a name first:
 *   const SRC = readFileSync(resolve(HERE, '../../other/src/x.ts'), 'utf8');
 * binds `SRC` to file CONTENTS, never to a path, so a declaration-only scan sees
 * no path at all in the line that does the escaping.
 *
 * `--self-test` pins the shapes that must keep flagging AND the shapes that must
 * not; an added spelling without an added case is the next silent regression.
 */
function scanPathExpressions(src, hereDepth, fileSegs = null, ownPackageName = null) {
  const known = new Map();
  const escapes = [];
  const files = new Set();
  const dirs = new Set();
  // Module specifiers this file imports from outside the package, as the
  // repo-relative names they SPELL — mapped onto real files by the caller.
  const imports = new Set();
  // An import resolves against the importing file's DIRECTORY, which is what
  // `fileSegs` names one level below.
  const dirSegs = fileSegs ? fileSegs.slice(0, -1) : null;
  const report = (name, info) => {
    // `vendored`: the read escapes the package but lands in an installed
    // dependency, which no declaration can name. Not a cross-package input.
    if (!info || info.vendored || info.min >= 0) return;
    escapes.push({ name, depth: info.min });
  };
  // A resolved name goes on the roster regardless of depth: `findEscapingPackages`
  // drops the package's own paths itself, using the same own-prefix rule it
  // already applies to the flat literals, so this stays one rule rather than two.
  const collect = (into, info) => {
    if (info?.segs?.length && !info.vendored) into.add(info.segs.join('/'));
  };

  // The anchor seeds go in FIRST, and they are read by their own balanced pass
  // rather than by `DECL` below, because `DECL` cannot reach them: it stops an
  // initialiser at the first `;`, and a `findUp` predicate is a block with
  // statements in it. Seeding `known` here is what lets every later spelling
  // compose with an anchor exactly as it composes with an `import.meta.url`
  // seed -- `join(REPO, 'packages', 'runtime', 'src')` is the ordinary literal
  // walk once `REPO` has a depth.
  for (const [name, info] of findUpSeeds(src, hereDepth, fileSegs, ownPackageName)) {
    known.set(name, info);
    collect(files, info);
    report(name, info);
  }

  // The binding HEAD only. The initialiser is read by `declarationInitialiser()`
  // instead of by this regex, which is what makes a call broken across lines
  // readable at all (#11093) -- and, because the match now advances past the
  // `=` rather than past the whole statement, a declaration nested inside
  // another one's initialiser is still reached.
  const DECL_HEAD = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
  for (const m of src.matchAll(DECL_HEAD)) {
    const expr = declarationInitialiser(src, m.index + m[0].length);
    if (expr === null) continue;
    const info = pathExpression(expr, hereDepth, known, fileSegs);
    if (!info) continue;
    known.set(m[1], info);
    collect(files, info);
    report(m[1], info);
  }

  let n = 0;
  for (const { fn, args } of readArgumentLists(src)) {
    n += 1;
    const first = splitTopLevel(args)[0];
    const info = known.get(first) ?? pathExpression(first, hereDepth, known, fileSegs);
    collect(DIR_ARG_READS.has(fn) ? dirs : files, info);
    // A bare binding here was already judged at its declaration; reporting it a
    // second time would only duplicate the finding under a less useful name.
    if (known.has(first)) continue;
    report(`read #${n} argument`, info);
  }

  // The RESOLVER half (#10452). A relative specifier resolves against the
  // importing FILE's directory — the same base as the directory-naming seeds
  // and as `new URL(rel, import.meta.url)` — so it is the same `walkLiteral`
  // walk in the same two coordinates, and the escape verdict is the same
  // shallowest point. What differs is only that the name it produces is a
  // MODULE specifier, so it goes in its own bucket for
  // `findEscapingPackages()` to map back onto a file (`resolveImportTarget`);
  // everything else here is shared.
  for (const spec of importSpecifiers(src)) {
    // ⚠️ The boundary. Anything not starting `.` is a bare specifier: an
    // installed dependency, which no declared glob can name.
    if (!spec.startsWith('.')) continue;
    const info = walkLiteral(hereDepth, spec, dirSegs);
    report(`import '${spec}'`, info);
    if (info.segs?.length && !info.vendored) imports.add(info.segs.join('/'));
  }
  return { escapes, files, dirs, imports };
}

/**
 * Every path in `src` that addresses something outside the package. Kept as the
 * exported name the `--self-test` shapes and any future reader reach for; the
 * roster half of the same walk is internal to `findEscapingPackages()`.
 */
export function escapingBindings(src, hereDepth, fileSegs = null, ownPackageName = null) {
  return scanPathExpressions(src, hereDepth, fileSegs, ownPackageName).escapes;
}

/**
 * Repo-relative path literals a test names in its own source — the roster a
 * probe-style scan reads. Extracting them is what lets a declaration be NARROW
 * safely: a glob is only allowed to be narrow while it still covers every path
 * the tests actually name, and the moment someone adds a probe outside the
 * declared radius the gate fails naming the file. Over-collection (a path in a
 * comment or an assertion message) is harmless — it can only force a WIDER
 * declaration, never a narrower one.
 *
 * This half sees a path only when the WHOLE repo-relative path sits inside ONE
 * quoted string and starts at a top-level directory. That is the third spelling
 * of #9763 and the only one that is a DATA defect rather than a collector one:
 * `skills/` was simply missing from the alternation, so `@objectstack/formula`'s
 * read of the published formula skill was invisible twice over — once here and
 * once in the reconstruction. The list below is every top-level directory a
 * declared glob can name; a new one added to the tree belongs here too.
 */
export function repoRelativeLiterals(src) {
  const out = new Set();
  for (const m of src.matchAll(/(['"`])((?:packages|apps|examples|content|scripts|skills)\/[A-Za-z0-9._/-]+)\1/g)) {
    out.add(m[2]);
  }
  return out;
}

/**
 * Memoised, because the anchor seeds (#10029) need it BEFORE the scan rather
 * than only after it: a `findUp` keyed on a manifest `name` is this package's
 * root when the literal is this package's name, and some other package's root
 * -- unnameable from here -- when it is not. Asking per test file re-read the
 * same manifest once per test in the package; asking per package root does not.
 */
const packageNameCache = new Map();

function packageNameOf(pkgRoot) {
  if (packageNameCache.has(pkgRoot)) return packageNameCache.get(pkgRoot);
  let name;
  try {
    name = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')).name ?? null;
  } catch {
    name = null;
  }
  packageNameCache.set(pkgRoot, name);
  return name;
}

/** Every package with at least one test that reads outside its own directory. */
export function findEscapingPackages() {
  const found = new Map();
  for (const top of ['packages', 'apps', 'examples']) {
    const dir = join(REPO_ROOT, top);
    if (!existsSync(dir)) continue;
    for (const file of walkTests(dir)) {
      const src = readFileSync(file, 'utf8');
      // Two ways out of a package, so two cheap pre-filters. The second is what
      // lets a test that ONLY imports across the boundary be seen at all: before
      // #10452 a file with no `fs` call never reached the scan, so the import
      // half would have been unreachable no matter how well it resolved. An
      // escaping specifier must contain an ascending relative literal, which is
      // all this asks before paying for the walk.
      if (!FS_READ.test(src) && !ASCENDING_LITERAL.test(src)) continue;
      const pkgRoot = packageRootOf(file);
      if (!pkgRoot) continue;
      const hereDepth = relative(pkgRoot, dirname(file)).split(sep).filter(Boolean).length;
      // The file's OWN repo-relative segments are the seed that turns the depth
      // walk into a name (#9763). Only this call site has them — `--self-test`
      // asserts on synthetic sources with no place in the tree, so it passes
      // none and gets depth-only answers, exactly as before.
      const fileSegs = relative(REPO_ROOT, file).split(sep).filter(Boolean);
      // Read BEFORE the scan, not after: an anchor seed keyed on a manifest
      // `name` is only this package's root while the literal is this package's
      // name, so the scan needs the answer to avoid resolving another package's
      // anchor to this one's directory (#10029).
      const name = packageNameOf(pkgRoot);
      const scan = scanPathExpressions(src, hereDepth, fileSegs, name);
      if (!scan.escapes.length) continue;
      if (!name) continue;
      if (!found.has(name))
        found.set(name, { dir: relative(REPO_ROOT, pkgRoot), tests: [], literals: new Map(), dirEntries: new Set() });
      const entry = found.get(name);
      const rel = relative(REPO_ROOT, file);
      entry.tests.push(rel);
      const own = relative(REPO_ROOT, pkgRoot);
      // Two rosters, one filter. The flat literals are what an author WROTE in
      // one quoted piece; the reconstructed ones are what the recognised path
      // expressions RESOLVE to — the reads that hold a radius without ever
      // spelling it (#9763). A reconstructed directory counts only when a
      // directory-listing read consumed it; everything else must name a file.
      // A third source, same filter: the modules the test IMPORTS from outside
      // the package (#10452). A specifier is mapped onto the file it really
      // resolves to first — `../x.js` is `../x.ts` on disk under NodeNext — and
      // one that resolves to nothing drops out here rather than entering the
      // roster as a name nobody reads.
      const imported = [...scan.imports].map((p) => resolveImportTarget(p)).filter((p) => p !== null);
      const roster = [
        ...[...repoRelativeLiterals(src), ...scan.files, ...imported].map((p) => [p, 'file']),
        ...[...scan.dirs].map((p) => [p, 'dir']),
      ];
      for (const [lit, kind] of roster) {
        // Paths inside the package's own directory are already covered by
        // `$TURBO_DEFAULT$` and by the package's own affected-set membership.
        if (lit === own || lit.startsWith(`${own}/`)) continue;
        // Only paths naming a real file — or a real directory a directory-read
        // consumed — count. Test sources are full of synthetic fixture paths
        // (`packages/a/src/x.ts`) and of directory prefixes used to build a path
        // or phrase a message; neither is an input, and requiring a glob to
        // cover them would force declarations wider than the truth.
        let real = false;
        try {
          const st = statSync(join(REPO_ROOT, lit));
          real = kind === 'dir' ? st.isDirectory() : st.isFile();
        } catch {
          real = false;
        }
        if (!real) continue;
        if (kind === 'dir') entry.dirEntries.add(lit);
        if (!entry.literals.has(lit)) entry.literals.set(lit, rel);
      }
    }
  }
  return found;
}

/**
 * Which of a package's declared globs no longer hold anything, and which of its
 * `heldBy` witnesses key a glob the entry does not declare.
 *
 * The INVERSE of the roster-coverage limb in `verify()`, and the half that was
 * missing until #10566. That limb asks whether every path the tests NAME sits
 * inside a declared glob; this one asks whether every declared GLOB still holds
 * one of those paths. Both staleness limbs beside it are package-scoped -- a
 * package with an escaping test and no entry, an entry whose package has no
 * escaping test any more -- so the question was never asked at the grain the
 * radius is actually written at. It stayed invisible while most declaring
 * packages had exactly one escaping test; `@objectstack/plugin-auth` has had two
 * since #10161, which is what made an unheld glob reachable rather than
 * theoretical.
 *
 * ⚠️ Why the roster cannot answer this on its own, and why an fs walk cannot
 * either. The roster is a LOWER bound on what the tests read: an argument this
 * scan cannot fold costs the NAME and keeps the depth (`pathExpression`), so a
 * read whose path is a loop variable, a `git ls-files` result or a computed
 * target holds a live radius while naming nothing. Measured on this tree: 6 of
 * the 60 declared globs are held by exactly such reads -- `create-objectstack`'s
 * `scripts/invoked-as.mjs` among them, a glob whose own rationale already says
 * it "appears in NO quoted string the flat literal collector can see". A limb
 * that failed every roster-invisible glob would fail all six on a healthy tree.
 * Asking the filesystem instead answers a different question entirely: it would
 * fail the globs declared for a path a test only NAMES in prose (`serve.ts`,
 * `check-nul-bytes.mjs`, `realtime-protocol.mdx` today), which the flat literal
 * collector holds precisely because it takes quoted paths without parsing.
 *
 * So a glob is held either MECHANICALLY, by a roster path, or by DECLARATION:
 * `heldBy` names the escaping test that reads it, and that witness is checked --
 * the named test must still be one of this package's escaping tests. Which is
 * what makes the ablation this limb exists for fail: reseed
 * `managed-extension-fields.test.ts` from a BARE `process.cwd()` and it stops
 * being an escaping test at all, so plugin-auth keeps its entry through its
 * second test while `packages/**\/*.object.ts` loses its only witness and is
 * named here.
 *
 * ⚠️ "Bare" is load-bearing since #10029, and this sentence used to say
 * `process.cwd()` was "a root walk this detector deliberately does not
 * resolve". Half of that is now false: the `findUp` ANCHOR seeds -- which is
 * how plugin-auth actually spells a cwd walk -- DO resolve, so reseeding that
 * way leaves the test escaping and ablates nothing. It is the unadorned
 * `process.cwd()` expression, with no recognised anchor predicate on it, that
 * still resolves to nothing. Reach for the wrong one and this limb reads as
 * healthy while nothing was measured.
 *
 * A rostered DIRECTORY is asked with `coversDirectory` against this glob ALONE,
 * the same predicate the coverage limb uses -- so two globs that only jointly
 * cover one directory would both read as unheld. There is no such pair on this
 * tree, and `heldBy` is the declared way out if one is ever written.
 *
 * What this still does not see, stated rather than discovered later: a witness
 * that stays escaping through some OTHER read while dropping the one that held
 * the glob. The witness is a weaker claim than a roster path, and it is the
 * strongest one available for a read this detector cannot name.
 */
export function globHolderVerdict({ globs, heldBy = {} }, info) {
  const rostered = (glob) =>
    [...info.literals.keys()].some((lit) =>
      info.dirEntries.has(lit) ? coversDirectory(lit, [glob]) : matchesAny(lit, [glob]),
    );
  const witnessed = (glob) => (heldBy[glob] ?? []).some((t) => info.tests.includes(t));
  return {
    unheld: globs.filter((g) => !rostered(g) && !witnessed(g)),
    stray: Object.keys(heldBy).filter((g) => !globs.includes(g)),
  };
}

// ── modes ────────────────────────────────────────────────────────────────────

function verify() {
  const escaping = findEscapingPackages();
  const declared = new Set(Object.keys(CROSS_PACKAGE_TEST_INPUTS));
  const problems = [];

  for (const [name, info] of [...escaping].sort()) {
    if (declared.has(name)) continue;
    problems.push(
      `${name} has test(s) that read outside the package but declares no input radius.\n` +
        info.tests.map((t) => `      ${t}`).join('\n') +
        `\n    Add an entry to CROSS_PACKAGE_TEST_INPUTS in ${DECLARATION_FILE}\n` +
        `    with the repo-relative globs those tests read, then run this gate again\n` +
        `    for the turbo.json inputs it requires.`,
    );
  }
  for (const name of [...declared].sort()) {
    if (escaping.has(name)) continue;
    problems.push(
      `${name} declares a cross-package input radius, but no test in it reads outside\n` +
        `    the package any more. Delete the entry (and its turbo.json inputs) — a stale\n` +
        `    declaration invalidates that package's test cache for nothing.`,
    );
  }

  // A declaration may be narrower than "the whole repo" only while it still
  // covers every repo-relative path its tests name. This is what keeps
  // narrowing honest: extending a probe roster past the declared radius fails
  // here, by file name, instead of silently going ungated again.
  for (const [name, { globs }] of Object.entries(CROSS_PACKAGE_TEST_INPUTS)) {
    const info = escaping.get(name);
    if (!info) continue;
    const uncovered = [...info.literals].filter(([lit]) =>
      info.dirEntries.has(lit) ? !coversDirectory(lit, globs) : !matchesAny(lit, globs),
    );
    if (uncovered.length) {
      problems.push(
        `${name} names path(s) no declared glob covers, so a change to them would not\n` +
          `    re-run its tests:\n` +
          uncovered
            .map(([lit, test]) => `      ${lit}${info.dirEntries.has(lit) ? '/   (listed in ' : '   (named in '}${test})`)
            .join('\n') +
          `\n    Widen the package's globs to cover them.`,
      );
    }
  }

  // The same question the other way round: a declared glob that holds nothing
  // any more (#10566). See `globHolderVerdict()` for why a roster miss alone
  // cannot decide it, and what `heldBy` is for.
  for (const [name, entry] of Object.entries(CROSS_PACKAGE_TEST_INPUTS)) {
    const info = escaping.get(name);
    // A package with no escaping test at all is already reported whole by the
    // limb above; listing each of its globs again would only bury that.
    if (!info) continue;
    const { unheld, stray } = globHolderVerdict(entry, info);
    if (unheld.length) {
      problems.push(
        `${name} declares glob(s) nothing holds any more \u2014 no path its escaping tests\n` +
          `    name lands inside them, and no \`heldBy\` witness reads outside the package\n` +
          `    any more:\n` +
          unheld
            .map((g) => {
              const gone = entry.heldBy?.[g] ?? [];
              return `      ${g}${gone.length ? `   (witness no longer escaping: ${gone.join(', ')})` : ''}`;
            })
            .join('\n') +
          `\n    Three dispositions, in the order to try them. Deleting is LAST because a\n` +
          `    glob can read as unheld for two opposite reasons, and only one of them means\n` +
          `    the declaration is wrong:\n` +
          `      1. The read is REAL and this scan does not SEE it. Check the reads against\n` +
          `         the recognised spellings printed below \u2014 an unrecognised one yields no\n` +
          `         name, which is indistinguishable here from no read. (A call broken\n` +
          `         across lines IS read; what still yields no name is a path built by\n` +
          `         template literal or out of a variable.) Fix the spelling, or teach the\n` +
          `         detector and add a --self-test case in the same edit.\n` +
          `      2. The read is real and this scan cannot NAME it even though it sees it \u2014\n` +
          `         a loop variable, a \`git ls-files\` result, an argument it cannot fold.\n` +
          `         Name the test that reads it in the entry's \`heldBy\`.\n` +
          `      3. The read is GONE. Delete the glob (and its turbo.json input).\n` +
          `    A glob held by nothing is a declaration that has stopped being checked\n` +
          `    against the code, which is the whole reason a radius is allowed to be narrow\n` +
          `    \u2014 so deleting one that is still read re-opens the blind spot silently.`,
      );
    }
    if (stray.length) {
      problems.push(
        `${name} has heldBy witness(es) keyed to glob(s) it does not declare:\n` +
          stray.map((g) => `      ${g}`).join('\n') +
          `\n    Fix the key or drop the witness \u2014 keyed to a glob that is not in \`globs\`, it\n` +
          `    holds nothing and hides nothing.`,
      );
    }
  }

  // Layer B: turbo.json must hash the declared globs, or the merge queue
  // replays a cached green over a scan it never ran (the #7802 escape itself).
  let turbo;
  try {
    turbo = JSON.parse(readFileSync(join(REPO_ROOT, 'turbo.json'), 'utf8'));
  } catch (e) {
    console.error(`FAIL: cannot read turbo.json: ${e.message}`);
    process.exit(1);
  }
  for (const [name, { globs }] of Object.entries(CROSS_PACKAGE_TEST_INPUTS)) {
    const task = turbo.tasks?.[`${name}#test`];
    if (!task) {
      problems.push(
        `turbo.json has no "${name}#test" task. Without it the package's test cache is\n` +
          `    keyed on package-local files only, so a change to its declared globs replays\n` +
          `    a stale green instead of re-running. Add it with inputs:\n` +
          `      ${JSON.stringify(expectedInputs(globs))}`,
      );
      continue;
    }
    const missing = globs.filter((g) => !(task.inputs ?? []).includes(`$TURBO_ROOT$/${g}`));
    if (missing.length) {
      problems.push(
        `turbo.json "${name}#test" inputs are missing the declared glob(s):\n` +
          missing.map((g) => `      $TURBO_ROOT$/${g}`).join('\n'),
      );
    }
  }

  if (problems.length) {
    console.error('FAIL: cross-package test inputs are not declared consistently.\n');
    for (const p of problems) console.error(`  - ${p}\n`);
    console.error(
      'Why this gate exists: a test whose real inputs are wider than its package is\n' +
        'invisible to BOTH the affected-subset filter and the turbo cache, so it can go\n' +
        'red on `main` while every PR reports green (#7802).\n',
    );
    console.error(
      'How this gate SEES a read, and its limit: it is a source scan, so it recognises\n' +
        'these spellings and only these. A path written any other way yields no flag —\n' +
        'which means no declaration, silently. Write escaping reads as:\n' +
        RECOGNISED_PATH_SPELLINGS.map((s) => `      ${s}`).join('\n') +
        '\n    Reaching for a spelling that is not here? Add it to the detector (with a\n' +
        '    --self-test case) rather than working around it — an unseen read is the\n' +
        '    defect above, not a style question.',
    );
    console.error(
      '\nA test reaches outside its package by IMPORTING as well as by reading, and\n' +
        'those specifiers are read too (#10452). The recognised list, same rule — a\n' +
        'spelling that is not here yields no flag:\n' +
        RECOGNISED_IMPORT_SPELLINGS.map((s) => `      ${s}`).join('\n'),
    );
    process.exit(1);
  }
  console.log(
    `OK: ${escaping.size} package(s) read outside themselves, all declared, ` +
      `and turbo.json hashes every declared glob.`,
  );
}

function expectedInputs(globs) {
  return ['$TURBO_DEFAULT$', '!dist/**', '!coverage/**', '!.turbo/**', ...globs.map((g) => `$TURBO_ROOT$/${g}`)];
}

/**
 * `turbo ls --output=json` emits `packages.count` beside `packages.items`, and
 * keeps the two equal -- measured on turbo 2.10.10, all of the bare, `--filter`
 * and `--affected` forms agree. So `count` is TURBO's field, not this script's
 * invention, and a document we have appended to is a valid `turbo ls` payload
 * only while the count moves with the array.
 *
 * Nothing reads `count` today, which is exactly what makes it cheap to keep
 * true and expensive to leave stale: the consumer is partition-test-shards.mjs,
 * whose stated posture is to assert this payload's shape LOUDLY so an
 * experimental-command upgrade becomes a red step naming the cause rather than
 * a silently empty shard. A hand-mutated document that contradicts itself about
 * its own size is the input to that assertion. The reader now checks the
 * agreement (`readPackageItems()` there), so this is a checked invariant across
 * the two scripts rather than a convention someone has to remember.
 *
 * Reconciling inside the SERIALIZER rather than as a statement beside the write
 * is the point: `unionInto()` has exactly one `writeFileSync`, and it has no
 * other source of bytes, so "appended to `items` but forgot to move `count`" is
 * not a state this script can reach. A separate `reconcile(); write();` pair
 * would have re-created the original defect the first time someone added a
 * second write path.
 */
function serializePackageList(parsed) {
  parsed.packages.count = parsed.packages.items.length;
  return JSON.stringify(parsed);
}

/**
 * Layer A. Adds any declaring package whose globs the diff touches to the
 * package list ci.yml is about to shard, so the scan runs on the PR that
 * actually changed its inputs.
 */
function unionInto(listPath, changedPath) {
  const parsed = JSON.parse(readFileSync(listPath, 'utf8'));
  const items = parsed?.packages?.items;
  if (!Array.isArray(items)) {
    console.error(`FAIL: ${listPath} is not a \`turbo ls --output=json\` payload ({packages:{items:[...]}}).`);
    process.exit(1);
  }
  const changed = readFileSync(changedPath, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const present = new Set(items.map((i) => i.name));
  // findEscapingPackages() walks packages/, apps/ and examples/ in full and reads
  // every *.test.* file it finds; its answer does not vary between iterations of
  // the loop below, so it is indexed ONCE here rather than re-walked per matching
  // declaration. Nothing between here and the old per-iteration call site writes
  // to packages/apps/examples (the only write in this function is the final
  // `writeFileSync(listPath, ...)`, to the turbo-ls.json output, after this
  // point), so hoisting cannot change what the walk sees.
  const escapingDirs = new Map([...findEscapingPackages()].map(([n, info]) => [n, info.dir]));
  const added = [];
  for (const [name, { globs }] of Object.entries(CROSS_PACKAGE_TEST_INPUTS)) {
    if (present.has(name)) continue;
    const hit = changed.find((f) => matchesAny(f, globs));
    if (!hit) continue;
    const dir = escapingDirs.get(name);
    if (!dir) continue;
    // Repo-relative, because that is the convention `turbo ls` emits for every
    // entry it wrote (measured on turbo 2.10.10: 0 of 77 items absolute). An
    // absolute path here is not wrong for today's only consumer, but it makes a
    // single document carry two conventions, and the obvious way to read such a
    // document -- `join(REPO_ROOT, it.path)`, correct for every entry turbo
    // wrote -- produces a garbage path for exactly these appended entries, which
    // are the cross-package scans this function exists to keep running. One
    // document, one convention; the consumer resolves it explicitly
    // (partition-test-shards.mjs `packageDir()`).
    items.push({ name, path: dir });
    added.push(`${name}  (declared glob matched ${hit})`);
  }
  // The push above changed the list's size, so the size the document DECLARES
  // moves with it -- serializePackageList() is the only way this function turns
  // `parsed` into bytes, precisely so that cannot be skipped.
  writeFileSync(listPath, serializePackageList(parsed));
  if (added.length) {
    console.log('Cross-package scans pulled into this run because the diff touched their declared inputs:');
    for (const a of added) console.log(`  + ${a}`);
  } else {
    console.log('No cross-package scan declares inputs touched by this diff.');
  }
}

function selfTest() {
  const cases = [];
  const ok = (label, cond) => cases.push({ label, cond });

  // glob semantics -- driven from the shared module rather than restated here,
  // so this gate and `check:examples-live-imports` are pinned against ONE set
  // of cases. The module has no CI invocation of its own (it is not a gate, by
  // design), so folding its failures into both importers' `--self-test` IS its
  // coverage. Its fixtures are assembled from segments, which is why the cases
  // that used to sit here no longer spell any path: a path literal in that
  // module would be inherited as a watch hint by every gate importing it.
  for (const failure of globMatchSelfTest()) ok(failure, false);

  // detector shapes -- one per spelling that appears in the repo today
  const at = (src, depth) => escapingBindings(src, depth).length > 0;
  ok(
    'flags resolve() off a fileURLToPath seed (api-methods-batch-conformance)',
    at("const HERE = dirname(fileURLToPath(import.meta.url));\nconst REPO_ROOT = resolve(HERE, '../../../..');", 2),
  );
  ok(
    'flags join() with a multi-segment literal (dogfood)',
    at("const HERE = dirname(fileURLToPath(import.meta.url));\nconst REPO_ROOT = join(HERE, '../../../..');", 2),
  );
  ok(
    'flags a two-step chain (create-objectstack)',
    at(
      "const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');\n" +
        "const repoRoot = path.resolve(pkgRoot, '..', '..');",
      1,
    ),
  );
  ok(
    'does NOT flag a within-package resolve',
    !at("const HERE = dirname(fileURLToPath(import.meta.url));\nconst FIX = resolve(HERE, '../fixtures');", 2),
  );
  ok(
    'does NOT flag a descent back below the package root',
    !at(
      "const HERE = dirname(fileURLToPath(import.meta.url));\n" +
        "const ROOT = resolve(HERE, '../..');\n" +
        "const SRC = join(ROOT, 'src', 'data');",
      2,
    ),
  );

  // The ascent-then-descent shape. Every case below ends at a NON-NEGATIVE
  // depth while addressing a sibling package, so each one passes a test on the
  // final depth and is caught only by the shallowest point reached.
  ok(
    'flags a one-literal climb into a sibling package (formula -> spec)',
    at("const HERE = dirname(fileURLToPath(import.meta.url));\nconst Z = join(HERE, '..', '..', 'spec', 'src', 'rls.zod.ts');", 1),
  );
  ok(
    'flags a fileURLToPath(new URL()) seed naming a sibling package',
    at("const SRC = fileURLToPath(new URL('../../../other-pkg/src/x.ts', import.meta.url));", 2),
  );
  ok(
    'flags a new URL() seed with no fileURLToPath around it',
    at("const SRC = new URL('../../../other-pkg/src/x.ts', import.meta.url);", 2),
  );
  ok(
    'flags a new URL() nested straight into a read (no path binding exists)',
    at("const SRC = readFileSync(new URL('../../../scripts/gate.mjs', import.meta.url), 'utf8');", 1),
  );
  ok(
    'flags a read whose argument is a multi-line new URL()',
    at("const c = readFileSync(\n  new URL('../../../scripts/gate.mjs', import.meta.url),\n  'utf8',\n);", 1),
  );

  // ── the LINE-SPANNING DECLARATION (#11093) ────────────────────────────────
  //
  // The case directly above pins a multi-line call in a READ ARGUMENT, which
  // `balancedArgs` has always read whole. A call bound to a NAME was read by a
  // regex with a hard two-line window instead, so the same expression spelled
  // across three or more lines matched nothing at all: no binding, no depth, no
  // name, and therefore no flag. #11093 reported it as `new URL()` recognised /
  // `resolve()` not; the measurement says the split is POSITION, not spelling —
  // every shape below was invisible in declaration position and every one of
  // them is visible in argument position. Prettier breaks any argument list past
  // the print width, so this is the DEFAULT spelling for a long relative
  // literal, not an exotic one.
  //
  // Each case below fails on a detector without `declarationInitialiser()`. The
  // ones pinning a NAME fail without `withoutTrailingComma()` as well, and they
  // are the load-bearing half: the name is what a declared glob is checked
  // against, so losing it leaves a real read holding no radius while the escape
  // flag still fires — a `globHolderVerdict()` failure blamed on the glob.
  //
  // `packages/spec/src/x.test.ts` — one directory below its package root.
  const SPANNED_FILE = ['packages', 'spec', 'src', 'x.test.ts'];
  const spannedNames = (src) => [...scanPathExpressions(src, 1, SPANNED_FILE).files];
  const SPANNED_SEED = 'const HERE = dirname(fileURLToPath(import.meta.url));\n';
  const SPANNED_RESOLVE = SPANNED_SEED + "const P = resolve(\n  HERE,\n  '../../../scripts/gate.mjs',\n);";
  ok('flags a resolve() DECLARATION spelled across lines (the shape a formatter writes)', at(SPANNED_RESOLVE, 1));
  ok(
    '⭐ and NAMES the file it resolved — the roster half, which a flags-only case passes without',
    spannedNames(SPANNED_RESOLVE).includes('scripts/gate.mjs'),
  );
  const SPANNED_JOIN = SPANNED_SEED + "const P = path.join(\n  HERE,\n  '../../../scripts/gate.mjs',\n);";
  ok('flags a join() declaration spelled across lines, symmetrically with resolve()', at(SPANNED_JOIN, 1));
  ok('and names that one too', spannedNames(SPANNED_JOIN).includes('scripts/gate.mjs'));
  const SPANNED_URL = "const P = new URL(\n  '../../../scripts/gate.mjs',\n  import.meta.url,\n);";
  ok('flags a multi-line new URL() in DECLARATION position, not only in a read argument', at(SPANNED_URL, 1));
  ok('and names it', spannedNames(SPANNED_URL).includes('scripts/gate.mjs'));
  ok(
    'flags a multi-line fileURLToPath(new URL()) declaration',
    at("const P = fileURLToPath(\n  new URL('../../../scripts/gate.mjs', import.meta.url),\n);", 1),
  );
  ok(
    'reads a seed whose own dirname(fileURLToPath(import.meta.url)) is broken across lines',
    at(
      'const HERE = dirname(\n  fileURLToPath(import.meta.url),\n);\n' + "const P = resolve(HERE, '../../../scripts/gate.mjs');",
      1,
    ),
  );
  // The trailing comma is prettier's, not the author's, so the same shape must
  // resolve identically with and without it — otherwise the fix would be keyed
  // to one formatter's output.
  ok(
    'the same span with NO trailing comma names the same file',
    spannedNames(SPANNED_SEED + "const P = resolve(\n  HERE,\n  '../../../scripts/gate.mjs'\n);").includes(
      'scripts/gate.mjs',
    ),
  );
  ok(
    'does NOT flag a multi-line resolve() that stays inside the package',
    !at(SPANNED_SEED + "const FIX = resolve(\n  HERE,\n  '../fixtures',\n);", 2),
  );
  // Reading the initialiser to a depth-0 terminator instead of matching a
  // two-line window is what keeps these two reachable: the window consumed
  // whatever it matched, so the NEXT declaration started after it.
  ok(
    'a declaration FOLLOWING a multi-line one is still read',
    spannedNames(
      SPANNED_SEED + "const A = resolve(\n  HERE,\n  '../fixtures',\n);\n" + "const B = resolve(HERE, '../../../scripts/gate.mjs');",
    ).includes('scripts/gate.mjs'),
  );
  ok(
    'a declaration nested inside a function-body initialiser is reached',
    spannedNames(
      SPANNED_SEED + 'const load = () => {\n' + "  const G = resolve(HERE, '../../../scripts/gate.mjs');\n" + '  return G;\n' + '};',
    ).includes('scripts/gate.mjs'),
  );
  ok(
    'flags a resolve() nested straight into a read',
    at(
      "const HERE = dirname(fileURLToPath(import.meta.url));\n" +
        "const SRC = readFileSync(resolve(HERE, '../../../other-pkg/src/x.ts'), 'utf8');",
      2,
    ),
  );
  ok(
    'flags a fileURLToPath(new URL()) chained through resolve()',
    at("const P = resolve(fileURLToPath(new URL('..', import.meta.url)), '../../other-pkg/src');", 2),
  );
  ok(
    'does NOT flag a new URL() that stays inside the package',
    !at("const SRC = readFileSync(new URL('../sibling-dir/x.ts', import.meta.url), 'utf8');", 2),
  );
  ok(
    'does NOT flag a new URL() naming the package root itself',
    !at("const PKG = fileURLToPath(new URL('../../package.json', import.meta.url));", 2),
  );
  ok(
    'does NOT flag a climb into node_modules (no glob can declare an installed dep)',
    !at("const HERE = dirname(fileURLToPath(import.meta.url));\nconst L = resolve(HERE, '../../../node_modules/tsx/dist/loader.mjs');", 1),
  );
  ok(
    'does NOT flag a read argument that is an unrecognised expression',
    !at('const SRC = readFileSync(somewhereElse(x), \'utf8\');', 2),
  );
  ok(
    'flags an import.meta.dirname seed (no file uses it yet — that is the point)',
    at("const HERE = import.meta.dirname;\nconst SRC = resolve(HERE, '../../other-pkg/src/x.ts');", 1),
  );
  ok(
    'flags a dirname(import.meta.filename) seed',
    at("const HERE = dirname(import.meta.filename);\nconst SRC = resolve(HERE, '../../other-pkg/src/x.ts');", 1),
  );
  ok(
    'does NOT flag an import.meta.dirname seed that stays inside the package',
    !at("const HERE = import.meta.dirname;\nconst FIX = resolve(HERE, '../fixtures');", 2),
  );

  // The seed WALKED from the file rather than named off it (#8995). Three
  // packages/cli e2e tests spell it this way; before the file itself was a
  // recognised expression the whole chain below resolved to `undefined`, so the
  // reads produced no flag and no declaration -- silently, which is the one
  // failure mode this detector exists to not have.
  ok(
    'flags a resolve(fileURLToPath(import.meta.url), $DOTDOT) seed (packages/cli e2e)',
    at(
      "const HERE = resolve(fileURLToPath(import.meta.url), '..');\n" +
        "const REPO_ROOT = resolve(HERE, '../../..');\n" +
        "const D = resolve(REPO_ROOT, 'content/docs/deployment/cli.mdx');",
      1,
    ),
  );
  ok(
    'flags the same seed with the climb and the tail in ONE three-argument resolve',
    at(
      "const HERE = resolve(fileURLToPath(import.meta.url), '..');\n" +
        "const D = resolve(HERE, '../../..', 'content/docs/deployment/cli.mdx');",
      1,
    ),
  );
  ok(
    'flags the walked seed via join() and the path.* form',
    at(
      "const HERE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.');\n" +
        "const S = path.resolve(HERE, '../../other-pkg/src/x.ts');",
      1,
    ),
  );
  ok(
    'flags a walked import.meta.filename seed',
    at("const HERE = resolve(import.meta.filename, '..');\nconst S = resolve(HERE, '../../other-pkg/src/x.ts');", 1),
  );
  // The walked seed and the named seed address the same directory, so every
  // verdict must agree between them. This is the case that fails if the file is
  // ever modelled at its directory's depth instead of one below it.
  ok(
    'walked seed agrees with the named seed on an in-package path',
    !at("const HERE = resolve(fileURLToPath(import.meta.url), '..');\nconst FIX = resolve(HERE, '../fixtures');", 2) &&
      !at("const HERE = dirname(fileURLToPath(import.meta.url));\nconst FIX = resolve(HERE, '../fixtures');", 2),
  );
  ok(
    'does NOT flag the walked seed climbing into node_modules (the tsx bin those tests resolve)',
    !at(
      "const HERE = resolve(fileURLToPath(import.meta.url), '..');\n" +
        "const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');",
      1,
    ),
  );
  ok(
    'does NOT flag the bare file expression itself (it names its own file)',
    !at("const SELF = fileURLToPath(import.meta.url);\nconst C = readFileSync(SELF, 'utf8');", 2),
  );

  // ── the ANCHOR seeds (#10029) ──────────────────────────────────────────────
  //
  // A `findUp` walk from `process.cwd()`, which is how a CJS-typed package
  // reaches its own root when `import.meta` is a TS1470 there. Until these
  // cases existed the walk resolved to nothing, so every path built on it
  // resolved to nothing too and the reads went undeclared SILENTLY -- measured
  // on `19f98fa1f^` against `rate-limit-storage-isolation.test.ts`, which read
  // two other packages by directory and appeared in no roster while turbo
  // replayed a cached green over it.
  //
  // ⚠️ Today's `findUp` population is CLEAN (the three surviving plugin-auth
  // tests read in-package or vendored), so no gate turns red from this and none
  // turns newly green either. That makes these cases the only proof there is:
  // each one below fails on a detector without `findUpSeeds()`. The two that
  // pin a NAME are the load-bearing pair -- a case asserting only "it does not
  // flag" passes just as happily on a seed that resolved to NOTHING, which is
  // precisely the bug.
  const FIND_UP_FN =
    'function findUp(predicate: (dir: string) => boolean, what: string): string {\n' +
    '  let dir = process.cwd();\n' +
    '  for (;;) {\n' +
    '    if (predicate(dir)) return dir;\n' +
    '    const parent = dirname(dir);\n' +
    '    if (parent === dir) throw new Error(`could not locate ${what}`);\n' +
    '    dir = parent;\n' +
    '  }\n' +
    '}\n';
  // Verbatim from `packages/plugins/plugin-auth/src/*.test.ts` — a predicate
  // BLOCK with statements in it, which is why `DECL` cannot read these and
  // `findUpSeeds()` balances the parens itself.
  const PKG_SEED =
    'const PKG = findUp((dir) => {\n' +
    "  const manifest = join(dir, 'package.json');\n" +
    '  if (!existsSync(manifest)) return false;\n' +
    "  const { name } = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string };\n" +
    "  return name === '@objectstack/plugin-auth';\n" +
    "}, 'the @objectstack/plugin-auth package root');\n";
  const REPO_SEED =
    'const REPO = findUp(\n' +
    "  (dir) => existsSync(join(dir, 'pnpm-workspace.yaml')),\n" +
    "  'the workspace root (pnpm-workspace.yaml)',\n" +
    ');\n';
  // `packages/plugins/plugin-auth/src/x.test.ts` — one directory below its
  // package root, whose own root is 3 segments below the repo root.
  const PA = ['packages', 'plugins', 'plugin-auth', 'src', 'x.test.ts'];
  const PA_NAME = '@objectstack/plugin-auth';
  const anchorEscapes = (src) => escapingBindings(src, 1, PA, PA_NAME).length > 0;
  const anchorFiles = (src) => [...scanPathExpressions(src, 1, PA, PA_NAME).files];
  const anchorDirs = (src) => [...scanPathExpressions(src, 1, PA, PA_NAME).dirs];

  // ⭐ The #10029 specimen, reconstructed: the exact read that was invisible.
  const RATE_LIMIT_SHAPE =
    FIND_UP_FN +
    REPO_SEED +
    "const abs = join(REPO, 'packages/runtime/src');\n" +
    'for (const entry of readdirSync(abs, { recursive: true, withFileTypes: true })) {\n}\n';
  ok('flags a directory read off a workspace-root anchor (the #10029 specimen)', anchorEscapes(RATE_LIMIT_SHAPE));
  ok(
    'and NAMES the directory it read, so a narrow glob can be checked against it',
    anchorDirs(RATE_LIMIT_SHAPE).includes('packages/runtime/src'),
  );
  ok(
    'the workspace-root anchor escapes on its own, like resolve(HERE, $DOTDOTS) already does',
    anchorEscapes(FIND_UP_FN + REPO_SEED),
  );
  ok(
    'a segment-by-segment join off the anchor resolves the same way',
    anchorFiles(FIND_UP_FN + REPO_SEED + "const G = join(REPO, 'scripts', 'check-nul-bytes.mjs');").includes(
      'scripts/check-nul-bytes.mjs',
    ),
  );

  // The package-root anchor. Its whole point is that it does NOT escape, so the
  // name is what proves it resolved at all — this is the `better-auth-schema-parity`
  // shape, which triage measured in-package and which must stay quiet for the
  // RIGHT reason.
  const IN_PACKAGE_SHAPE = FIND_UP_FN + PKG_SEED + "const source = readFileSync(join(PKG, 'src', 'auth-manager.ts'), 'utf8');";
  ok('does NOT flag a package-root anchor read that stays inside the package', !anchorEscapes(IN_PACKAGE_SHAPE));
  ok(
    '⭐ and resolves that anchor to THIS package root — the case a bare "does not flag" would pass without the seed',
    anchorFiles(IN_PACKAGE_SHAPE).includes('packages/plugins/plugin-auth/src/auth-manager.ts'),
  );
  ok(
    'flags a climb OUT of the package off the package-root anchor',
    anchorEscapes(FIND_UP_FN + PKG_SEED + "const G = join(PKG, '..', '..', '..', 'scripts', 'check-nul-bytes.mjs');"),
  );
  ok(
    'and names it',
    anchorFiles(FIND_UP_FN + PKG_SEED + "const G = join(PKG, '..', '..', '..', 'scripts', 'check-nul-bytes.mjs');").includes(
      'scripts/check-nul-bytes.mjs',
    ),
  );
  ok(
    'a vendored read off the anchor stays invisible (member-role-canonical: no glob can hash node_modules)',
    !anchorEscapes(
      FIND_UP_FN +
        PKG_SEED +
        "const require_ = createRequire(join(PKG, 'probe.js'));\n" +
        "const VENDOR_DIST = dirname(require_.resolve('better-auth'));\n" +
        "const SRC = readFileSync(join(VENDOR_DIST, 'plugins', 'organization', 'routes', 'crud-members.mjs'), 'utf8');",
    ),
  );

  // ⛔ The boundary, pinned in both directions. A manifest name that is not this
  // package's names a root this scan cannot locate, so it keeps the escape
  // verdict and loses the name — the same trade an unreadable `join()` argument
  // makes. Inventing this package's root for it would put a file nobody reads on
  // the roster AND hide a real escape behind a depth of 0.
  const FOREIGN_SEED =
    'const OTHER = findUp((dir) => {\n' +
    "  const manifest = join(dir, 'package.json');\n" +
    '  if (!existsSync(manifest)) return false;\n' +
    "  const { name } = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string };\n" +
    "  return name === '@objectstack/core';\n" +
    "}, 'the @objectstack/core package root');\n";
  ok(
    'flags an anchor keyed on ANOTHER package manifest',
    anchorEscapes(FIND_UP_FN + FOREIGN_SEED + "const S = readFileSync(join(OTHER, 'src', 'x.ts'), 'utf8');"),
  );
  ok(
    'but names nothing for it — no fabricated roster entry',
    !anchorFiles(FIND_UP_FN + FOREIGN_SEED + "const S = readFileSync(join(OTHER, 'src', 'x.ts'), 'utf8');").some((p) =>
      p.endsWith('x.ts'),
    ),
  );
  // The published set is the whole claim: a predicate outside it yields NO seed,
  // which is the pre-#10029 silence and is stated rather than discovered later.
  ok(
    'an unrecognised anchor predicate yields no seed (stated boundary, not a bug)',
    !anchorEscapes(
      FIND_UP_FN +
        "const ROOT = findUp((dir) => existsSync(join(dir, 'turbo.json')), 'the turbo root');\n" +
        "const G = join(ROOT, 'packages/runtime/src');\n" +
        'const names = readdirSync(G);',
    ),
  );
  // ⚠️ An anchor names an ABSOLUTE directory, so unlike every seed above it it
  // cannot be placed in the depth coordinate without knowing where the file
  // sits. A caller with no repo context gets no seed rather than a guessed one.
  ok(
    'an anchor yields nothing to a depth-only caller (no fileSegs, no guess)',
    escapingBindings(FIND_UP_FN + REPO_SEED + "const G = join(REPO, 'packages/runtime/src');", 1).length === 0,
  );
  // A bare `process.cwd()` with no recognised predicate on it still resolves to
  // nothing — the ablation `globHolderVerdict()` documents depends on it, and
  // #10029 is the reason that sentence now says BARE.
  ok(
    'a bare process.cwd() walk is still unresolved',
    !anchorEscapes("const ROOT = process.cwd();\nconst G = readFileSync(join(ROOT, 'packages/runtime/src/x.ts'), 'utf8');"),
  );

  // ── The radius roster, reconstructed rather than quoted (#9763) ────────────
  //
  // Everything above asks "does this escape?"; everything below asks "WHICH
  // FILE?" — the question the flat literal regex could only answer when an
  // author happened to write the whole repo-relative path inside one pair of
  // quotes. Where it could not, the roster fell back to whatever prose in the
  // same file HAPPENED to be quoted, so an innocent comment edit could unforce
  // a live declaration and a following narrowing would pass in silence.
  //
  // Each case below pins one spelling by the repo-relative name it must
  // produce, because a case asserting only "some path came out" would pass just
  // as happily on a wrong one, and a wrong name is a roster entry pointing at a
  // file nobody reads.
  const named = (src, depth, fileSegs) => [...scanPathExpressions(src, depth, fileSegs).files];
  const listed = (src, depth, fileSegs) => [...scanPathExpressions(src, depth, fileSegs).dirs];
  // `packages/create-objectstack/src/x.test.ts` — depth 1 below its package root.
  const CO = ['packages', 'create-objectstack', 'src', 'x.test.ts'];

  ok(
    'reconstructs a path split across join() arguments (create-objectstack -> the stamper)',
    named(
      "const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');\n" +
        "const repoRoot = path.resolve(pkgRoot, '..', '..');\n" +
        "const SYNC = path.join(repoRoot, 'scripts', 'sync-template-versions.mjs');",
      1,
      CO,
    ).includes('scripts/sync-template-versions.mjs'),
  );
  ok(
    'reconstructs an ascent-relative literal (metadata-protocol -> the durability gate)',
    named(
      "const S = readFileSync(new URL('../../../scripts/check-durability-degradation-log-level.mjs', import.meta.url), 'utf8');",
      1,
      ['packages', 'metadata-protocol', 'src', 'x.test.ts'],
    ).includes('scripts/check-durability-degradation-log-level.mjs'),
  );
  ok(
    'reconstructs an ascent-relative literal off an __dirname seed (spec -> the error catalog)',
    named("const P = resolve(__dirname, '../../../../content/docs/api/error-catalog.mdx');", 3, [
      'packages',
      'spec',
      'src',
      'api',
      'x.test.ts',
    ]).includes('content/docs/api/error-catalog.mdx'),
  );
  ok(
    'reconstructs a path under a top-level dir the flat regex does not list (formula -> skills/)',
    named(
      "const here = dirname(fileURLToPath(import.meta.url));\n" +
        "const SKILL = resolve(here, '../../../skills/objectstack-formula/SKILL.md');",
      1,
      ['packages', 'formula', 'src', 'x.test.ts'],
    ).includes('skills/objectstack-formula/SKILL.md'),
  );
  ok(
    'a directory handed to readdirSync is rostered as a DIRECTORY (spec -> packages/lint/src)',
    listed(
      "const HERE = dirname(fileURLToPath(import.meta.url));\n" +
        "const REPO_ROOT = resolve(HERE, '../../../..');\n" +
        "const LINT_SRC = join(REPO_ROOT, 'packages', 'lint', 'src');\n" +
        'const names = readdirSync(LINT_SRC);',
      2,
      ['packages', 'spec', 'src', 'identity', 'x.test.ts'],
    ).includes('packages/lint/src'),
  );
  // The other half of the same rule, and the one that keeps the file-only
  // filter honest: a directory reached but never LISTED is a prefix used to
  // build a path, not an input. `@objectstack/downstream-contract` spells
  // exactly this — `resolve(PACKAGE_DIR, '..', '..', 'spec', 'src')` feeds a
  // `relative()` comparison and a `resolve(SPEC_SRC, '..', 'package.json')`, so
  // what the roster must take is the package.json, never the directory.
  ok(
    'a directory reached but never listed is NOT rostered as a directory',
    listed(
      "const HERE = dirname(fileURLToPath(import.meta.url));\n" +
        "const PACKAGE_DIR = resolve(HERE, '..');\n" +
        "const SPEC_SRC = resolve(PACKAGE_DIR, '..', '..', 'spec', 'src');\n" +
        "const PKG = readFileSync(resolve(SPEC_SRC, '..', 'package.json'), 'utf8');",
      1,
      ['packages', 'qa', 'downstream-contract', 'test', 'x.test.ts'],
    ).length === 0,
  );
  ok(
    'and the file that prefix BUILDS is rostered',
    named(
      "const HERE = dirname(fileURLToPath(import.meta.url));\n" +
        "const PACKAGE_DIR = resolve(HERE, '..');\n" +
        "const SPEC_SRC = resolve(PACKAGE_DIR, '..', '..', 'spec', 'src');\n" +
        "const PKG = readFileSync(resolve(SPEC_SRC, '..', 'package.json'), 'utf8');",
      1,
      ['packages', 'qa', 'downstream-contract', 'test', 'x.test.ts'],
    ).includes('packages/spec/package.json'),
  );
  // The trade in `walkLiteral`: an argument the scan cannot read must cost the
  // NAME, never invent one. Both directions pinned, because dropping either
  // half is a silent regression -- inventing a name puts a file nobody reads on
  // the roster, and keeping the depth is what preserves the escape verdict.
  // (Intermediate bindings that DO resolve still yield their own names; what
  // must not appear is a name for the expression the unreadable argument sits
  // in, which is the only one that would be a fabrication.)
  ok(
    'an unreadable join() argument yields no name for the path it builds',
    !named(
      "const HERE = dirname(fileURLToPath(import.meta.url));\n" +
        "const ROOT = resolve(HERE, '../../..');\n" +
        "const P = join(ROOT, someVariable, 'x.ts');",
      1,
      CO,
    ).some((p) => p.endsWith('x.ts')),
  );
  ok(
    'but it still flags the escape (the depth walk is unchanged)',
    at(
      "const HERE = dirname(fileURLToPath(import.meta.url));\n" +
        "const ROOT = resolve(HERE, '../../..');\n" +
        "const P = join(ROOT, someVariable, 'x.ts');",
      1,
    ),
  );
  // ── the INTERPOLATING TEMPLATE argument (#11487) ──────────────────────────
  //
  // `PATH_LITERAL`'s character class excludes only quote characters, so a
  // backtick argument holding no quotes matches it even when it is an
  // interpolating template — `` `${someVar}` `` read as the literal segment
  // text `${someVar}` and walked as ONE ordinary descent, biasing the depth
  // walk UPWARD instead of taking the cannot-read path above. That is the
  // exact inverse of the trade this file relies on everywhere else: an
  // unreadable argument is safe, and a template read as readable was LESS
  // safe than unreadable. Same climb, same file, only the middle argument
  // differs from the unreadable-argument pair just above.
  const TEMPLATE_SEED = 'const HERE = dirname(fileURLToPath(import.meta.url));\n';
  const TEMPLATE_UNREADABLE = TEMPLATE_SEED + "const P = join(HERE, someVar, '../../other-pkg/src/y.ts');";
  const TEMPLATE_INTERP = TEMPLATE_SEED + "const P = join(HERE, `${someVar}`, '../../other-pkg/src/y.ts');";
  ok('(control) the unreadable-argument sibling of the pair below still flags at depth -1', at(TEMPLATE_UNREADABLE, 1));
  ok(
    'an interpolating template argument takes the SAME cannot-read path as an unreadable one — it flags too',
    at(TEMPLATE_INTERP, 1),
  );
  ok(
    'and — like any unreadable argument — yields no name for the path it builds (never a WRONG name)',
    !named(TEMPLATE_INTERP, 1, CO).some((p) => p.endsWith('y.ts')),
  );
  ok(
    'a non-interpolating backtick literal is NOT swept up by the narrowing — still read, still flags, still named',
    (() => {
      const src = TEMPLATE_SEED + "const P = join(HERE, `../../other-pkg/src/y.ts`);";
      return at(src, 1) && named(src, 1, CO).includes('packages/other-pkg/src/y.ts');
    })(),
  );
  // ── the INTERPOLATING TEMPLATE argument, `NEW_URL_LITERAL` sibling (#12085) ─
  //
  // `NEW_URL_LITERAL` has the identical character-class shape as `PATH_LITERAL`
  // above and the identical blind spot — `` new URL(`${someVar}`, import.meta.url) ``
  // reads `${someVar}` as the literal segment text and walks it as one ordinary
  // descent. But this call site has no "cannot read, keep depth" fallback to
  // fall into: `readableNewUrlLiteral()` rejecting the argument makes
  // `pathExpression()` return `undefined` for the WHOLE `new URL(...)` seed —
  // the same outcome as any other unrecognised seed shape, NOT the depth-kept
  // outcome `PATH_LITERAL`'s pair above pins. So this case must assert
  // "does not flag, no name" rather than "flags at the unreadable depth".
  const URL_TEMPLATE_INTERP = 'const P = new URL(`../../other-pkg/${someVar}`, import.meta.url);';
  ok(
    "(control) the same climb spelled with a real segment instead of interpolation still flags and is named — proves the case above isn't vacuous",
    (() => {
      const src = 'const P = new URL(`../../other-pkg/src/y.ts`, import.meta.url);';
      return at(src, 1) && named(src, 1, CO).includes('packages/other-pkg/src/y.ts');
    })(),
  );
  ok(
    'an interpolating new URL() template does NOT flag — the whole seed is unrecognised, not depth-kept (#12085)',
    !at(URL_TEMPLATE_INTERP, 1),
  );
  ok(
    'and — like any unrecognised seed — yields no name at all (never a fabricated NAME)',
    named(URL_TEMPLATE_INTERP, 1, CO).length === 0,
  );
  ok(
    'a quoted (non-backtick) new URL() literal containing literal `${` text is unaffected — `${` outside a backtick is ordinary text, never interpolation',
    (() => {
      const src = "const P = new URL('../../other-pkg/${literalText}', import.meta.url);";
      return at(src, 1) && named(src, 1, CO).includes('packages/other-pkg/${literalText}');
    })(),
  );
  ok(
    'a climb ABOVE the repo root yields no name (there is no repo-relative one)',
    named("const OUT = resolve(__dirname, '../../../../../../elsewhere/x.ts');", 1, CO).length === 0,
  );
  ok(
    'a vendored path is never rostered (no glob can declare an installed dep)',
    !named(
      "const HERE = dirname(fileURLToPath(import.meta.url));\nconst L = resolve(HERE, '../../../node_modules/tsx/dist/loader.mjs');",
      1,
      CO,
    ).some((p) => p.includes('node_modules')),
  );
  ok(
    'without a file seed the walk still answers on depth alone (--self-test above)',
    named("const P = resolve(__dirname, '../../scripts/x.mjs');", 1, null).length === 0 &&
      at("const P = resolve(__dirname, '../../scripts/x.mjs');", 1),
  );

  // ── the RESOLVER half (#10452) ─────────────────────────────────────────────
  //
  // One case per entry in RECOGNISED_IMPORT_SPELLINGS, which is the rule this
  // file publishes for its path spellings and now owes its import spellings
  // too: a list of what the gate can see is a claim, and a claim nothing runs
  // is the phantom check this repo keeps re-learning. Adding a spelling to that
  // array without a case here should feel like the omission it is.
  //
  // Then the BOUNDARY, in its own cases and deliberately over-covered. Reading
  // a bare specifier as an escape would put every package's suite on every
  // workspace sibling — the one way this half could do more damage than the
  // blind spot it closes — so `@objectstack/*`, `node:*` and a plain package
  // name are each pinned NOT to flag, rather than trusting one case to stand
  // for the class.
  const specOf = (src, depth, fileSegs) =>
    [...scanPathExpressions(src, depth, fileSegs).imports].map((p) => resolveImportTarget(p)).filter((p) => p !== null);
  // `packages/cli/src/commands/x.contract.test.ts` — the #10452 specimen, two
  // directories below its package root.
  const CLI = ['packages', 'cli', 'src', 'commands', 'x.contract.test.ts'];

  ok('flags a static import that escapes the package (the #10452 specimen)', at("import { maskComments } from '../../../../scripts/js-comment-mask.mjs';", 2));
  ok(
    'flags an `import type` — it is an input to the typecheck verdict',
    at("import type { RouteLedgerEntry } from '../../runtime/src/route-ledger';", 1),
  );
  ok('flags a re-export (`export … from`)', at("export { ROUTE_LEDGER } from '../../runtime/src/route-ledger';", 1));
  ok('flags a star re-export (`export * from`)', at("export * from '../../runtime/src/route-ledger';", 1));
  ok('flags a side-effect import with no clause', at("import '../../../../scripts/js-comment-mask.mjs';", 2));
  ok('flags a dynamic import with a literal specifier', at("const m = await import('../../../../scripts/js-comment-mask.mjs');", 2));
  ok('flags a cjs require with a literal specifier', at("const { maskComments } = require('../../../../scripts/js-comment-mask.mjs');", 2));

  // ⛔ The boundary. An installed dependency is not a repo source input and no
  // turbo glob can name it, which is the same exclusion `vendored` already
  // makes for path reads.
  ok('does NOT flag a bare workspace specifier', !at("import { verify } from '@objectstack/verify';", 2));
  ok('does NOT flag a node: builtin', !at("import { readFileSync } from 'node:fs';", 2));
  ok('does NOT flag an unscoped package name', !at("import { describe, it } from 'vitest';", 2));
  ok('does NOT flag a same-directory relative import', !at("import { helper } from './helper.js';", 2));
  ok(
    'does NOT flag an ascent that stays inside the package',
    !at("import { fixture } from '../fixtures/app.js';", 2),
  );
  ok(
    'a bare specifier contributes no roster name either',
    specOf("import { verify } from '@objectstack/verify';", 2, CLI).length === 0,
  );

  // The NAME half. Each case pins the repo-relative path the specifier must
  // produce AGAINST A REAL FILE, so an extension rule that stops resolving
  // fails here instead of quietly dropping a package's radius. A case asserting
  // only "something came out" would pass just as happily on a wrong name.
  ok(
    'a literal .mjs specifier resolves as itself (cli -> the comment masker)',
    specOf("import { maskComments } from '../../../../scripts/js-comment-mask.mjs';", 2, CLI).includes('scripts/js-comment-mask.mjs'),
  );
  ok(
    'an extensionless specifier resolves to the .ts on disk (client -> runtime`s ledger)',
    specOf("import { ROUTE_LEDGER } from '../../runtime/src/route-ledger';", 1, [
      'packages',
      'client',
      'src',
      'client-url-conformance.test.ts',
    ]).includes('packages/runtime/src/route-ledger.ts'),
  );
  ok(
    'a NodeNext .js specifier resolves to the .ts on disk (dogfood -> runtime`s ledger)',
    specOf("import { ROUTE_LEDGER } from '../../../runtime/src/route-ledger.js';", 1, [
      'packages',
      'qa',
      'dogfood',
      'test',
      'route-ledger-live-mount-parity.dogfood.test.ts',
    ]).includes('packages/runtime/src/route-ledger.ts'),
  );
  // ⚠️ The metadata spelling. `contact.view` is extensionless as a SPECIFIER
  // while its last segment carries a dot, so a "does it end in .something" test
  // appends no candidate and the name is lost. Measured before the fix: this
  // exact import went unnamed, and the glob holding it was on the roster only
  // because a human had written it there.
  ok(
    'an extensionless specifier whose last segment contains a dot still resolves (cli -> a .view)',
    specOf("import { contactView } from '../../../examples/app-showcase/src/ui/views/contact.view';", 1, [
      'packages',
      'cli',
      'test',
      'i18n-section-coverage.test.ts',
    ]).includes('examples/app-showcase/src/ui/views/contact.view.ts'),
  );
  // The same trade `walkLiteral` makes for an unreadable argument: no name, but
  // the escape verdict survives, so the author still gets a red gate naming the
  // test rather than a silent pass.
  ok(
    'a specifier that resolves to no file yields no name',
    specOf("import { x } from '../../../no-such-dir-10452/x';", 1, CLI).length === 0,
  );
  ok(
    'but it still flags the escape',
    at("import { x } from '../../../no-such-dir-10452/x';", 1),
  );

  // The `skills/` prefix -- the one spelling of #9763 that is a DATA fix in the
  // flat collector rather than a reconstruction, kept pinned on both sides so a
  // future trim of the alternation cannot pass.
  ok('the flat collector sees a quoted skills/ path', repoRelativeLiterals("const S = 'skills/objectstack-formula/SKILL.md';").has('skills/objectstack-formula/SKILL.md'));
  ok('and still sees the prefixes it always did', repoRelativeLiterals("const S = 'packages/lint/src/x.ts';").has('packages/lint/src/x.ts'));
  ok('a path under an undeclared top-level dir is still not collected flat', !repoRelativeLiterals("const S = 'node_modules/x/y.ts';").size);

  // Directory coverage. `**` globs are written to match FILES, so the bare
  // directory string does not match its own subtree glob -- which is why a
  // rostered directory needs `coversDirectory` and not `matchesAny`.
  ok('a subtree glob does NOT match the bare directory it covers', !matchesAny('packages/lint/src', ['packages/lint/src/**']));
  ok('but it DOES cover that directory as a listing', coversDirectory('packages/lint/src', ['packages/lint/src/**']));
  ok('a single-file glob does not cover the directory it sits in', !coversDirectory('scripts', ['scripts/check-nul-bytes.mjs']));
  ok('a directory that does not exist is covered by nothing', !coversDirectory('scripts/no-such-dir-9763', ['**']));

  // The per-GLOB holder limb (#10566), the inverse of the coverage cases above
  // and driven on synthetic rosters. The witness half is pinned in BOTH
  // directions on purpose: the whole value of `heldBy` is that it STOPS
  // holding, and a case asserting only "a witness makes it green" would pass
  // just as happily on a witness nothing checks.
  const rosterOf = (literals, dirs = [], tests = []) => ({
    literals: new Map(literals.map((l) => [l, 'packages/x/src/some.test.ts'])),
    dirEntries: new Set(dirs),
    tests,
  });
  ok(
    'a glob a rostered path lands inside is held',
    globHolderVerdict({ globs: ['packages/lint/src/**'] }, rosterOf(['packages/lint/src/a.ts'])).unheld.length === 0,
  );
  ok(
    'a glob no rostered path lands inside is UNHELD (the gap #10566 measured)',
    globHolderVerdict({ globs: ['packages/**/*.object.ts'] }, rosterOf(['packages/lint/src/a.ts'])).unheld[0] ===
      'packages/**/*.object.ts',
  );
  ok(
    'a rostered DIRECTORY holds the subtree glob covering it (matchesAny alone would not)',
    globHolderVerdict({ globs: ['packages/lint/src/**'] }, rosterOf(['packages/lint/src'], ['packages/lint/src']))
      .unheld.length === 0,
  );
  ok(
    'a heldBy witness holds a roster-invisible glob while that test still escapes',
    globHolderVerdict(
      { globs: ['packages/**/*.object.ts'], heldBy: { 'packages/**/*.object.ts': ['packages/x/src/walk.test.ts'] } },
      rosterOf([], [], ['packages/x/src/walk.test.ts']),
    ).unheld.length === 0,
  );
  ok(
    'and stops holding it the moment that test stops reading outside the package',
    globHolderVerdict(
      { globs: ['packages/**/*.object.ts'], heldBy: { 'packages/**/*.object.ts': ['packages/x/src/walk.test.ts'] } },
      rosterOf([], [], ['packages/x/src/other.test.ts']),
    ).unheld[0] === 'packages/**/*.object.ts',
  );
  ok(
    'one live witness out of two is enough -- losing one holder is not losing the glob',
    globHolderVerdict(
      {
        globs: ['packages/**/*.object.ts'],
        heldBy: { 'packages/**/*.object.ts': ['packages/x/src/gone.test.ts', 'packages/x/src/walk.test.ts'] },
      },
      rosterOf([], [], ['packages/x/src/walk.test.ts']),
    ).unheld.length === 0,
  );
  ok(
    'a witness keyed to a glob the entry does not declare is reported stray',
    globHolderVerdict(
      {
        globs: ['packages/lint/src/**'],
        heldBy: { 'packages/lint/src/**/*.object.ts': ['packages/x/src/walk.test.ts'] },
      },
      rosterOf(['packages/lint/src/a.ts'], [], ['packages/x/src/walk.test.ts']),
    ).stray[0] === 'packages/lint/src/**/*.object.ts',
  );
  const noWitness = globHolderVerdict({ globs: ['packages/**/*.object.ts'] }, rosterOf(['packages/lint/src/a.ts']));
  ok('a glob declared with no witness at all is unheld', noWitness.unheld.length === 1);
  ok('-- and not stray: stray is only about keys `globs` does not contain', noWitness.stray.length === 0);

  // `--union-into`'s output document. `packages.count` is turbo's field and the
  // append changes the size it describes, so the two are one operation -- these
  // pin the half of the cross-script invariant this side owns (the reader's
  // half is partition-test-shards.mjs `--self-test`).
  // These run the real serializer -- the one and only source of the bytes
  // `unionInto()` writes -- and assert on the parsed-back document, so they pin
  // what lands on disk rather than an intermediate object.
  const written = (packages) => JSON.parse(serializePackageList({ packageManager: 'pnpm9', packages })).packages;
  ok('count follows an appended item', written({ count: 0, items: [{ name: 'a', path: 'p' }, { name: 'b', path: 'q' }] }).count === 2);
  ok('a correct count is left correct', written({ count: 1, items: [{ name: 'a', path: 'p' }] }).count === 1);
  ok('count follows an empty list down', written({ count: 7, items: [] }).count === 0);
  ok('the write never invents items', written({ count: 0, items: [] }).items.length === 0);
  ok('the write leaves turbo\'s other fields alone', JSON.parse(serializePackageList({ packageManager: 'pnpm9', packages: { count: 0, items: [] } })).packageManager === 'pnpm9');

  // The path convention this function appends in. `turbo ls` writes every entry
  // of this document repo-relative; an entry appended in the other convention
  // is not wrong for today's consumer but it makes one array carry two rules,
  // and the obvious way to read it -- `join(REPO_ROOT, it.path)` -- then breaks
  // on exactly the appended entries. End-to-end through the real `unionInto()`
  // and the real serializer, on the fixture that first measured the divergence:
  // a diff touching `scripts/**` pulls @objectstack/spec in by its declaration.
  const unionDir = mkdtempSync(join(tmpdir(), 'os-union-into-'));
  const unionList = join(unionDir, 'turbo-ls.json');
  const unionChanged = join(unionDir, 'changed-files.txt');
  writeFileSync(unionList, JSON.stringify({ packageManager: 'pnpm9', packages: { count: 0, items: [] } }));
  writeFileSync(unionChanged, 'scripts/sync-template-versions.mjs\n');
  unionInto(unionList, unionChanged);
  const unioned = JSON.parse(readFileSync(unionList, 'utf8')).packages.items;
  ok('the union appends the package its declaration matched', unioned.length > 0);
  ok(
    'every appended path is repo-relative, the convention `turbo ls` emits',
    unioned.length > 0 && unioned.every((i) => !isAbsolute(i.path)),
  );
  ok(
    'and each one still names a real directory once resolved against the repo root',
    unioned.length > 0 && unioned.every((i) => existsSync(resolve(REPO_ROOT, i.path))),
  );

  // ── the entry guard, driven for real ────────────────────────────────────
  //
  // This module EXPORTS helpers, and the dispatch below used to run on IMPORT:
  // `await import(...)` printed this gate's verdict into the importer's stdout
  // and, on an unhappy tree, called `process.exit(1)` -- handing a consumer that
  // asked for `globToRegExp` this gate's verdict as its own exit status.
  // `check-examples-live-imports.mjs` hand-copied the helper rather than pay it.
  //
  // A spawned child is the only honest witness: the guard's answer depends on
  // what node puts in `process.argv[1]`, which cannot be modelled in-process.
  // Without this case the guard can be deleted as quietly as it was missing.
  const importProbe = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(fileURLToPath(import.meta.url)).href)});\nconsole.log('ALIVE');`],
    { encoding: 'utf8' },
  );
  ok(
    'importing this module prints NOTHING -- the dispatch is behind the entry guard',
    (importProbe.stdout || '').trim() === 'ALIVE' && (importProbe.stderr || '').trim() === '',
  );
  ok(
    'importing this module does not exit the importer -- it survives to run its own code',
    importProbe.status === 0 && (importProbe.stdout || '').includes('ALIVE'),
  );

  const failed = cases.filter((c) => !c.cond);
  for (const c of cases) console.log(`${c.cond ? 'ok  ' : 'FAIL'} ${c.label}`);
  if (failed.length) {
    console.error(`\n${failed.length}/${cases.length} self-test case(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${cases.length} self-test cases passed.`);
}

// ---------------------------------------------------------------------------
// Entry guard -- this module EXPORTS helpers, so the dispatch must not run on
// import.
//
// Until the guard was added, the `else verify()` fallthrough below fired on
// `await import(...)` as well as on invocation. Importing the module for
// `globToRegExp` or `findEscapingPackages` printed this gate's verdict to the
// importer's stdout, and on an unhappy tree called `process.exit(1)` -- so a
// consumer inherited THIS gate's verdict as its own exit status, having asked
// only for a helper. `check-examples-live-imports.mjs` paid that cost: it
// hand-copied `globToRegExp` rather than import it, naming this load-time gate
// as the reason.
//
// `globToRegExp` has since moved out to `scripts/glob-match.mjs` (#11511), so
// that particular consumer no longer arrives here at all. The guard stays
// load-bearing regardless: `findEscapingPackages`, `coversDirectory` and
// `globHolderVerdict` are still exported from a file with a CLI, and the
// rule `check:entry-guard` enforces is about the FILE, not about who happens
// to import it today.
//
// `isEntrypoint` is the repo's one answer to "was I run?" -- see
// `scripts/invoked-as.mjs` for why the hand-typed spellings are wrong, and
// `check:entry-guard`, which fails any other spelling in `scripts/**`.
if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) selfTest();
  else if (argv.includes('--list-escapes')) {
    for (const [name, info] of [...findEscapingPackages()].sort()) {
      console.log(`${name}  (${info.dir})`);
      for (const t of info.tests) console.log(`    ${t}`);
    }
  } else if (argv.includes('--union-into')) {
    const listPath = argv[argv.indexOf('--union-into') + 1];
    const changedPath = argv[argv.indexOf('--changed') + 1];
    if (!listPath || !changedPath) {
      console.error('usage: check-cross-package-test-inputs.mjs --union-into <turbo-ls.json> --changed <file>');
      process.exit(2);
    }
    unionInto(listPath, changedPath);
  } else verify();
}
