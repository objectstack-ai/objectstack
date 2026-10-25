#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Rejects a `vi.mock` / `vi.doMock` RELATIVE specifier that resolves to no file.
 *
 * Run:  node scripts/check-vi-mock-specifiers.mjs
 *       node scripts/check-vi-mock-specifiers.mjs --list   # every call site found
 *       node scripts/check-vi-mock-specifiers.mjs --json
 * Exit: 0 = OK, 1 = an inert mock, or the population collapsed (see below)
 *
 * ## The defect (objectui#5646)
 *
 * A module mock whose specifier names no file on disk does NOT error. Vitest
 * registers the mock against a module id that nothing imports, the run proceeds
 * with the REAL module everywhere, and the suite passes.
 *
 * That is the worst available failure direction. The test does not fail, does
 * not warn, and does not report fewer assertions -- it reports exactly the same
 * green a correct one does, so nothing in the output separates "this stand-in is
 * installed" from "this stand-in is inert".
 *
 * ## The instance this gate was built against
 *
 * PR #5645 added
 * `packages/app-shell/src/layout/__tests__/ChatDock.partialRuntimeConfig.test.tsx`,
 * which installs a deliberately partial runtime-config snapshot. The mock was
 * written one `..` short: it named the module as a sibling of the `layout/`
 * directory, where nothing of that name exists, instead of two levels up in
 * `src/` where it does.
 *
 * The suite passed. It also passed when the code under test was reverted to the
 * exact pre-fix shape the suite was written to catch -- a `TypeError` that, with
 * the mock actually installed, fails all four cases. Only an ablation leg
 * exposed it.
 *
 * The neighbours in that same file are what made it invisible to a reader: one
 * of them steps up ONE level and one steps up TWO, and BOTH are correct,
 * because their targets sit at different depths. A mock block is therefore a
 * plausible-looking mix of one-dot-dot and two, with nothing in it to say which
 * depth belongs to which line. That is also the discriminating case for this
 * gate: a resolver that got depth wrong would flag those two, and be deleted by
 * the first person it annoyed.
 *
 * ## The lineage
 *
 * objectui#4347 was `check-type-check-coverage.mjs` reporting green when a
 * `type-check` script chained a tsconfig project that does not exist -- a
 * declaration pointing at nothing, reported as a pass. This is the same shape
 * one layer down, at the module-mock level.
 *
 * ## Green at rest, and what follows from that
 *
 * There were ZERO unresolvable specifiers in this tree when this landed, and the
 * expectation is that there stay zero. So on any ordinary day this gate is
 * indistinguishable, from its output alone, from a gate that does nothing --
 * which is the very defect it exists to catch, one level up. Two consequences,
 * both load-bearing:
 *
 *   1. **The population must refuse to collapse.** A walk that finds no source
 *      files, no test files, or no relative specifiers is not a clean tree; it
 *      is a broken walk, and reporting OK for it would be this card's defect
 *      wearing the gate's uniform. `FLOORS` below turn each of those into a
 *      failure. objectui#6195 landed the same discipline in a test as
 *      `expect(tracked.length).toBeGreaterThan(1000)`.
 *   2. **The verdict line carries the census**, not just "OK", so a reader can
 *      see the population the green was computed over.
 *
 * `scripts/__tests__/check-vi-mock-specifiers.test.ts` carries the ablation --
 * the historical specifier reconstructed on a real fixture tree, and its two
 * correct neighbours -- because on this tree the run itself proves nothing.
 *
 * ## Scope: RELATIVE specifiers only (decided at dispatch, objectui#5646)
 *
 * A bare specifier (a package name, an alias) can be misspelled too, but
 * resolving one needs the workspace/package map rather than the filesystem -- a
 * different check with a different failure mode. Bare specifiers are COUNTED
 * here and reported in the census, never judged. Widening this gate into them is
 * a separate card, not an extension of this one.
 *
 * The `vi.mock(import(...))` form is matched by the same pattern, so it is
 * covered for free, and no handling was invented for it beyond that. The card
 * and the dispatch ruling both recorded its population as ZERO; re-measured on
 * this tree it is THREE, all of them in `registration`-style suites and all
 * naming a PACKAGE:
 *
 *     packages/plugin-kanban/src/registration.test.tsx:14
 *     packages/plugin-calendar/src/registration.test.tsx:31
 *     packages/plugin-list/src/__tests__/ListView.sharedGate.test.tsx:60
 *
 * What is zero is the intersection that matters here -- the form written with a
 * RELATIVE specifier, which is the set this gate judges. The census counts the
 * form separately so that stays visible rather than being inferred from a green.
 *
 * ## Why the walk is not restricted to test-NAMED files
 *
 * The obvious population is the `*.test.*` / `*.spec.*` naming. It has a hole,
 * measured on this tree: ONE file carrying a real call site matches no such
 * suffix, and it matches no test-file naming convention at all, not even a
 * `__tests__/` directory --
 *
 *     vitest.setup.base.ts                               (neither)
 *
 * It was THREE until objectui#3240 and TWO until objectui#7337, and both
 * departures are the same story. `packages/plugin-map/vitest.setup.ts` carried
 * a `maplibre-gl` mock duplicating the one in `vitest.setup.base.ts`, and only
 * that package's own vitest config ever loaded it, so it never ran under the
 * invocation CI uses; deleting the config took the copy with it.
 * `apps/console/dev/__tests__/setup/common-mocks.ts` carried a frozen
 * `@object-ui/i18n` factory in a helper with ZERO importers repo-wide, and the
 * i18n sweep deleted it rather than leave dead code wearing the shape.
 * The hole this walk exists for is unchanged: a setup file -- and a mock helper
 * -- is still exactly where a repo-wide mock gets written, and the walk has to
 * be the thing that decides that, not the filename.
 *
 * A setup file is exactly where a repo-wide mock gets written, and a mock helper
 * shared by a directory of suites is exactly where one goes unreviewed. So the
 * walk takes every tracked JS/TS-family source file and lets the PATTERN decide
 * what is a call site. The test-named count is still derived and reported, as a
 * census figure and as its own floor, but it does not narrow the scan.
 *
 * ## Resolution mirrors how this repo really spells specifiers
 *
 * More than an existence check on the literal path, or the gate reddens on
 * hundreds of correct call sites:
 *
 *   - the bare path itself, plus each of `SOURCE_EXTENSIONS`;
 *   - the `<path>/index.<ext>` forms, for a directory specifier;
 *   - and a trailing `.js` / `.jsx` / `.mjs` / `.cjs` STRIPPED and the whole
 *     ladder retried on the stem, because `src/` is NodeNext throughout and
 *     `./x.js` is how a `./x.ts` is named there.
 *
 * The judgement is `isFile`, never a bare existence test: a specifier naming a
 * DIRECTORY is not resolved by that directory existing -- it is resolved by an
 * index file inside it, which the ladder covers explicitly.
 *
 * ## Only text the language would EXECUTE is judged
 *
 * A mock call has to be real source before it can be an inert mock, and there
 * are two ways for matching text not to be. Both are answered by one pass of the
 * shared `js-comment-mask.mjs` scanner, which is the repo's single answer to "is
 * this span comment, literal, or code":
 *
 *   - **comments are blanked.** A commented-out mock is not executed, so it
 *     cannot be inert, and flagging one fabricates a finding. This file's own
 *     header quotes the defect, so without the mask the gate reds on its own
 *     prose.
 *   - **a match whose call token is inside a literal is counted, not judged.**
 *     That is a code SAMPLE, not a call -- see `findCallSites` for the instance
 *     that made the distinction necessary and why the token, not the specifier,
 *     is the discriminator.
 *
 * String CONTENT is deliberately left intact through all of this -- a gate whose
 * signal IS a quoted specifier cannot afford to erase quoted text. The
 * consequence lands on this gate's own test suite, which has to build call-site
 * fixtures without writing a matchable one into its own source; it says so where
 * it does it.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';
import { blank, scanSource } from './js-comment-mask.mjs';

/** Extensions the resolver will append to a specifier, in preference order. */
export const SOURCE_EXTENSIONS = Object.freeze(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/** Files the walk reads at all. */
const SOURCE_FILE_RE = /\.[cm]?[jt]sx?$/;

/** The test-file naming convention, for the census figure and its floor. */
const TEST_FILE_RE = /(\.(test|spec)\.[cm]?[jt]sx?$)|((^|\/)__tests__\/)/;

/** Belt-and-braces: git ignores these already, so nothing matches today. */
const EXCLUDED = /(^|\/)(node_modules|dist|build|\.next|\.turbo|\.wt-[^/]*)\//;

/**
 * A mock call followed by its opening quote, with an optional `import(` between
 * the two -- which is the whole of the `vi.mock(import(...))` support the
 * dispatch ruling asked for, and it costs nothing.
 *
 * A specifier may not span a line: a template literal carrying a newline is not
 * a static specifier, and neither is one carrying an interpolation. Both are
 * counted as `dynamic` and left unjudged rather than guessed at.
 */
export const CALL_RE = /\bvi\s*\.\s*(mock|doMock)\s*\(\s*(import\s*\(\s*)?(['"`])([^'"`\n]*)\3/g;

/**
 * Floors below which a green verdict is a claim about coverage rather than a
 * statement about the tree. Set with room -- the point is to catch a walk that
 * COLLAPSED (a broken `git ls-files`, a pattern that stopped matching, a filter
 * inverted), not to pin today's exact numbers, which move every day.
 */
export const FLOORS = Object.freeze({
  sources: 1000,
  testFiles: 1000,
  relative: 100,
});

/** Every path the resolver would accept for `specifier`, in order. */
export function candidatesFor(fromDir, specifier) {
  const base = resolve(fromDir, specifier);
  const stems = [base];
  // NodeNext: `./x.js` is how `./x.ts` is spelled. Strip and retry the ladder.
  const stripped = base.replace(/\.(js|jsx|mjs|cjs)$/, '');
  if (stripped !== base) stems.push(stripped);

  const out = [base];
  for (const stem of stems) {
    for (const ext of SOURCE_EXTENSIONS) out.push(stem + ext);
    for (const ext of SOURCE_EXTENSIONS) out.push(join(stem, `index${ext}`));
  }
  return [...new Set(out)];
}

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * The resolved path for `specifier` as written from `fromDir`, or `null`.
 *
 * @returns {{ resolved: string | null, tried: string[] }}
 */
export function resolveSpecifier(fromDir, specifier) {
  const tried = candidatesFor(fromDir, specifier);
  for (const candidate of tried) {
    if (isFile(candidate)) return { resolved: candidate, tried };
  }
  return { resolved: null, tried };
}

/** 1-based line number of `offset` in `source`. */
function lineOf(source, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) if (source[i] === '\n') line++;
  return line;
}

/**
 * Every mock call site in one file's source, classified.
 *
 * `kind` is `relative` (judged here), `bare` (out of scope -- needs the
 * workspace map), `dynamic` (an interpolated specifier, which is not a static
 * path at all) or `embedded` (see below).
 *
 * ## `embedded`: the call token is inside a string, so it is a code SAMPLE
 *
 * The one hit the first run over this tree produced was
 * `eslint-rules/no-dynamic-import-in-test-hook.test.js:37`, and it is correct as
 * written: the mock call sits inside a TEMPLATE LITERAL, as one of the code
 * samples that rule's `RuleTester` lints. Its `'./dep'` names a module that does
 * not exist and must not -- an ESLint fixture is source text, never something
 * vitest loads, so the specifier has no directory to be relative to and no mock
 * to be inert.
 *
 * The discriminator is exactly the one the language uses: the `vi` TOKEN has to
 * be code. `scanSource` flags a literal's content, so a call written in source
 * has its token unflagged while its specifier is flagged, and a call quoted
 * inside a sample has both flagged. Nothing about the specifier separates them.
 *
 * These are COUNTED, not silently dropped -- an exclusion nobody can see in the
 * census is how a scan narrows itself into vacuity.
 *
 * A real call written inside an interpolation would be skipped by this too. That
 * is not a hole worth closing: vitest hoists mock calls out of MODULE SOURCE, so
 * a call assembled inside a template is not one it would ever register either.
 */
export function findCallSites(source) {
  const { comment, literal } = scanSource(source);
  const masked = blank(source, comment);
  const sites = [];
  CALL_RE.lastIndex = 0;
  let m;
  while ((m = CALL_RE.exec(masked)) !== null) {
    const specifier = m[4];
    if (literal[m.index]) {
      sites.push({ fn: m[1], specifier, kind: 'embedded', viaImport: Boolean(m[2]), line: lineOf(masked, m.index) });
      continue;
    }
    const kind = specifier.includes('${')
      ? 'dynamic'
      : specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../')
        ? 'relative'
        : 'bare';
    sites.push({
      fn: m[1],
      specifier,
      kind,
      viaImport: Boolean(m[2]),
      line: lineOf(masked, m.index),
    });
  }
  return sites;
}

/** The NUL that `git ls-files -z` delimits with, built from its code point. */
const NUL = String.fromCharCode(0);

function trackedFiles(root) {
  return execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  })
    .toString('utf8')
    .split(NUL)
    .filter(Boolean);
}

/**
 * The one scan. `main()`, `--list`, `--json` and the test suite all go through
 * here, so the tests exercise the real code path rather than an imitation.
 *
 * @param {string} root  Repository root to scan.
 * @param {{ files?: string[] | null, floors?: Record<string, number> }} [options]
 *   `files` overrides the `git ls-files` walk (fixtures pass their own list);
 *   `floors` overrides `FLOORS` — pass `{}` to switch the collapse check off for
 *   a fixture tree, which is legitimately far below every repo floor.
 */
export function scan(root, { files = null, floors = FLOORS } = {}) {
  const tracked = files ?? trackedFiles(root);
  const sources = tracked.filter((f) => SOURCE_FILE_RE.test(f) && !EXCLUDED.test(f));
  const testFiles = sources.filter((f) => TEST_FILE_RE.test(f));

  const unresolvable = [];
  const sites = [];
  const counters = { relative: 0, bare: 0, dynamic: 0, embedded: 0, viaImport: 0, filesWithMocks: 0 };

  for (const file of sources) {
    let source;
    try {
      source = readFileSync(join(root, file), 'utf8');
    } catch {
      continue; // symlink, gitlink, unreadable -- nothing to judge
    }
    // Cheap pre-filter only. The pattern below is what actually decides.
    if (!source.includes('vi')) continue;
    const found = findCallSites(source);
    if (found.length === 0) continue;
    counters.filesWithMocks++;

    const fromDir = dirname(join(root, file));
    for (const site of found) {
      counters[site.kind]++;
      if (site.viaImport) counters.viaImport++;
      const record = { file, ...site };
      if (site.kind === 'relative') {
        const { resolved, tried } = resolveSpecifier(fromDir, site.specifier);
        record.resolved = resolved;
        if (!resolved) unresolvable.push({ ...record, tried });
      }
      sites.push(record);
    }
  }

  const census = {
    tracked: tracked.length,
    sources: sources.length,
    testFiles: testFiles.length,
    ...counters,
  };

  // The population, checked for collapse. See "Green at rest" in the header.
  const vacuous = [];
  for (const [counter, floor] of Object.entries(floors)) {
    if (census[counter] < floor) vacuous.push({ counter, value: census[counter], floor });
  }

  return { census, sites, unresolvable, vacuous };
}

function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

/** The census, as one line, for the verdict. */
export function summarise({ census }) {
  return (
    `${census.sources} tracked source file(s), ${census.testFiles} test-named; ` +
    `${census.filesWithMocks} carry a mock; ` +
    `${census.relative} relative specifier(s) resolved, ` +
    `${census.bare} bare (out of scope), ${census.dynamic} non-static, ` +
    `${census.embedded} embedded in a string literal, ` +
    `${census.viaImport} via the import() form`
  );
}

function main() {
  const result = scan(repoRoot());
  const { unresolvable, vacuous } = result;

  if (unresolvable.length === 0 && vacuous.length === 0) {
    console.log(`✅  check-vi-mock-specifiers: OK (${summarise(result)}).`);
    process.exit(0);
  }

  if (unresolvable.length > 0) {
    const plural = unresolvable.length === 1 ? 'mock resolves' : 'mocks resolve';
    console.error(`❌  check-vi-mock-specifiers: ${unresolvable.length} ${plural} to no file on disk\n`);
    console.error('  Vitest does not error on these. It registers the mock against a module id');
    console.error('  nothing imports, runs the REAL module everywhere, and the suite PASSES --');
    console.error('  identically to a correct one. Each of these is an inert stand-in:\n');
    for (const u of unresolvable) {
      console.error(`    - ${u.file}:${u.line} -- vi.${u.fn}(${JSON.stringify(u.specifier)})`);
      console.error(`      tried ${u.tried.length} path(s), first: ${u.tried[0]}`);
    }
    console.error(`
Fix the specifier, then confirm the mock is actually installed: revert the code
under test to the shape the suite was written to catch and check that the suite
goes RED. A mock whose depth was wrong passes that ablation only once it is
correctly resolved.

Count from the test file's OWN directory: a suite in \`src/x/__tests__/\` reaches
a sibling of \`x/\` with one step up and a sibling of \`src/\` with two.
Neighbouring mocks in one block legitimately use different depths, so copying the
prefix off the line above is how this gets written wrong.

Bare specifiers (a package name, an alias) are OUT OF SCOPE here -- resolving
those needs the workspace map, not the filesystem (objectui#5646).`);
  }

  if (vacuous.length > 0) {
    console.error('\n❌  check-vi-mock-specifiers: the population COLLAPSED -- this run proves nothing\n');
    for (const v of vacuous) {
      console.error(`    - ${v.counter}: found ${v.value}, floor is ${v.floor}`);
    }
    console.error(`
A scan that finds nothing reports OK, and reads as coverage. That is the exact
defect this gate exists to catch, one level up, so it is a FAILURE here instead.

Something upstream of the judgement broke: \`git ls-files\` returned little or
nothing, a filter inverted, or the pattern stopped matching. Fix the walk. If a
floor is genuinely too high because the tree changed shape, move it in \`FLOORS\`
deliberately and say why -- never to make a red run green.

Census: ${summarise(result)}`);
  }

  process.exit(1);
}

// Run only when invoked directly -- the test suite imports `scan` and friends
// and must not trigger a repo scan (or a `process.exit`) on import.
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--json')) {
    const result = scan(repoRoot());
    console.log(JSON.stringify({ census: result.census, unresolvable: result.unresolvable, vacuous: result.vacuous }, null, 2));
  } else if (process.argv.includes('--list')) {
    const result = scan(repoRoot());
    for (const s of result.sites) {
      const mark = s.kind === 'relative' ? (s.resolved ? 'ok        ' : 'UNRESOLVED') : s.kind.padEnd(10);
      console.log(`${mark}  ${s.file}:${s.line}  vi.${s.fn}(${JSON.stringify(s.specifier)})`);
    }
    console.log(`\n${summarise(result)}`);
  } else {
    main();
  }
}
