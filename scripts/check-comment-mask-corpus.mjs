#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-comment-mask-corpus -- the CORPUS half of "is this span a comment, or
 * code?", cross-checked against an independent parser.
 *
 *   node scripts/check-comment-mask-corpus.mjs              # the sweep (the gate)
 *   node scripts/check-comment-mask-corpus.mjs --self-test  # the comparator's own cases
 *   node scripts/check-comment-mask-corpus.mjs --masker scripts/<other>.mjs
 *                                                           # positive control -- see below
 *
 * `scripts/js-comment-mask.mjs` answers that question for every source-scanning
 * gate in this tree, and its `--self-test` pins the SHAPES: two dozen sources
 * someone wrote down, each with a known right answer. This is the other
 * instrument, and the two do not subsume each other:
 *
 *   the self-test pins shapes someone thought of, the sweep finds shapes the
 *   tree actually contains, and neither substitutes for the other.
 *
 * That sentence is a measurement, not a slogan (#10640, from #10427's fix): a
 * mutation that deleted the brace counting inside `${...}` passed all 22 pinned
 * cases AND the entire 4,739-file sweep, because the tree did not happen to
 * write the shape; the case that holds it today had to be written from the
 * mutation. The converse is this file: the defect #10427 actually shipped was
 * found by the sweep, over shapes the tree writes every day, and NO pinned case
 * had it.
 *
 * ## Why this exists as a script rather than as prose
 *
 * The sweep that found #10427 ran once, in an agent's scratchpad, and left with
 * it. What stayed behind was a paragraph in `js-comment-mask.mjs`'s header
 * describing how to rebuild it -- accurate, and still not an instrument.
 * Nothing in `scripts/`, `package.json` or `.github/workflows/` could re-derive
 * the result, so the strongest verification this module ever had was the one
 * thing about it nobody could run.
 *
 * ## What it asserts
 *
 * Walk every `.{ts,tsx,mts,cts,js,mjs,cjs,jsx}` file in the repo (minus the
 * build and dependency directories listed in `SKIPPED_DIRECTORIES`), parse each
 * with `@typescript-eslint/parser` -- a root dependency already, and an
 * implementation with nothing in common with the hand-rolled scan it is
 * checking -- and diff the comment ranges it reports against `scanSource`'s
 * `comment` array BYTE FOR BYTE. Both directions are reported, and they are not
 * the same defect:
 *
 *   FABRICATES  the parser says comment, the mask says code. Every gate
 *               downstream then reads genuinely commented-out text as live
 *               code and manufactures findings out of prose. This is the
 *               direction #10427 shipped in -- 15 of its 16 files, up to
 *               10,252 comment bytes handed to a caller as code in one file.
 *
 *   OVER-MASKS  the mask says comment, the parser says code. The gate goes
 *               blind over real code instead. Quieter, and the direction
 *               `js-comment-mask.mjs`'s header calls the better one to fail in,
 *               because it under-reports loudly the next time someone
 *               re-derives the gate's scope.
 *
 * ## The one reconciliation, and why it is stated rather than discovered
 *
 * A `#!` line is a comment to node, and `scanSource` flags it as one. The
 * parser does not report it in `comments` at all. Measured on this tree: 132
 * files carry a shebang (this one included), so without this reconciliation
 * the sweep opens with one bogus disagreement per shebang file, 18-19 bytes
 * each -- measured as 131 an hour before this script joined the corpus it
 * walks, which is its own small lesson about a count in prose. A verifier
 * that cries wolf on its first run is a verifier someone turns off, so the
 * oracle adds the shebang line back explicitly, here, where a reader can see
 * the claim and check it.
 *
 * That is the ONLY reconciliation. Every other byte of disagreement is a real
 * disagreement about what a comment is, and this gate fails on it.
 *
 * ## Unparseable is fatal, never skipped
 *
 * `scripts/ts-parse.mjs` documents the failure this avoids: a file a gate could
 * not read scores as a file with nothing to report. A file the oracle cannot
 * parse is a file this sweep did not check, so it is reported and it is fatal.
 * The one accommodation is spelling, not silence: JSX is legal in any
 * JS-family extension, so a `.js`/`.mjs`/`.cjs`/`.jsx` source that fails under
 * the extension's default JSX setting is retried with the other one before it
 * is called unparseable. `.ts`/`.mts`/`.cts` are not retried -- TypeScript
 * forbids JSX there, and `<T>(x) => x` needs `jsx: false` to parse at all.
 *
 * ## Why the corpus has a floor
 *
 * "0 disagreements" over an empty corpus is byte-identical to "0 disagreements"
 * over a clean one, and the second is the whole point of the run. So a corpus
 * smaller than `CORPUS_FLOOR` is a REFUSAL (exit 3), not a pass. The floor is a
 * smoke detector for a walk that found nothing -- deliberately far below the
 * ~4,700 files this tree holds, because a ratchet on the count would be a
 * number to bump forever and would say nothing about coverage. Coverage is
 * asserted by the self-test below instead: it proves, on every single run, that
 * this comparator can still REPORT a disagreement.
 *
 * ## The positive control -- how to prove the sweep can fail
 *
 * A green sweep is worth exactly as much as its ability to go red, so
 * `--masker <path>` points the comparison at a different implementation of
 * `scanSource`. To re-derive #10427's result on today's tree:
 *
 *   git show 29b2f8c8e1^:scripts/js-comment-mask.mjs > scripts/pre-10632-mask.mjs
 *   node scripts/check-comment-mask-corpus.mjs --masker scripts/pre-10632-mask.mjs
 *   rm scripts/pre-10632-mask.mjs
 *
 * The extracted file must land in `scripts/` for its own `./invoked-as.mjs`
 * import to resolve. Measured 2026-08-21 on this tree: 16 files disagree, 15 of
 * them in the FABRICATES direction, 47,310 fabricated bytes, the largest single
 * file 10,252 -- the same 16 files, and the same 10,252, that #10427 reported.
 * A nonzero exit is the EXPECTED outcome of a control run; the gate's contract
 * is the default mode.
 *
 * ## Cost, measured rather than assumed
 *
 * 2026-08-21, this repo, 4,740 files, 72.1 MB of source, on a 4-vCPU container
 * shared with other agents: 49-54 s wall clock, of which 45.4 s is the parser,
 * 2.9 s is `scanSource` and 0.6 s is IO. A 4-worker sharded prototype of the
 * same sweep measured 33.7 s on the same box -- a 1.5x payoff for a shard
 * protocol plus an assertion that no shard silently dropped files, which is not
 * a trade worth making for an instrument whose only job is to be obviously
 * correct. The number that matters is CI's, and the step prints it on every
 * run.
 */

// dispatch-gates: whole-tree-population -- `collectSources` walks every authored JS/TS file from the repo root, so the corpus is the whole tree; the one literal below names the masker this gate exercises, not the files it reads.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';
import { requireDependency } from './import-prerequisite.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/** The extensions the tree writes JavaScript-shaped source in. */
export const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx']);

/**
 * Directories that hold dependencies or build output rather than source -- plus
 * one that holds ANOTHER REPOSITORY. Every package in this tree builds to
 * `dist`. `js-comment-mask.mjs`'s header quotes the six this walk started from
 * as part of the 2026-08-21 measurement it records; the set below is the
 * instrument and has grown past that sentence since (`.git`, and now `.cache`),
 * so this declaration is the list, and the header is the history.
 *
 * `.cache` is where `scripts/build-console.sh` materialises objectui at the
 * pinned SHA: a whole foreign checkout, gitignored, that every console pin bump
 * MUST create because the console cannot be built without it. Walked, it put
 * ~4,300 files this repo does not author into the corpus and reported one of
 * them as a disagreement -- against a masker objectui's pages have no stake in.
 * The failure text below is correct for OUR sources and wrong for those: it
 * sends the reader to pin a shape in `js-comment-mask.mjs`, which is the last
 * thing a pin bump should be editing. CI never saw it, because the lint job
 * does not build the console; every instance landed on a person instead.
 */
export const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.next', 'build', '.turbo', 'coverage', '.git', '.cache']);

/** Below this, the corpus is not a corpus -- see the header. */
export const CORPUS_FLOOR = 1000;

export const EXIT_DISAGREEMENT = 1;
export const EXIT_USAGE = 2;
export const EXIT_REFUSED = 3;

/** JSX is on by default only where the extension demands it. */
const JSX_BY_EXTENSION = /\.(tsx|jsx)$/;
/** ...and JS-family sources may carry JSX under any of their extensions. */
const JSX_RETRY = /\.(js|mjs|cjs|jsx)$/;

/**
 * Every source file under `root`, depth-first, symlinked directories skipped
 * (a symlink is not `isDirectory()` here, which also makes the walk immune to
 * cycles).
 *
 * @param {string} [root]
 * @returns {string[]} absolute paths
 */
export function collectSources(root = REPO_ROOT) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(join(dir, entry.name));
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
        found.push(join(dir, entry.name));
      }
    }
  };
  walk(root);
  found.sort();
  return found;
}

/** Thrown when the oracle cannot read a file -- never swallowed. */
export class UnparseableSource extends Error {}

/**
 * The oracle's answer: a byte flagged per character the PARSER calls comment
 * content, plus the shebang reconciliation the header explains.
 *
 * @param {string} fileName
 * @param {string} source
 * @param {(source: string, options: object) => { comments: { range: [number, number] }[] }} parse
 * @returns {Uint8Array}
 */
export function oracleComments(fileName, source, parse) {
  const options = { comment: true, range: true, loc: false, jsx: JSX_BY_EXTENSION.test(fileName) };
  let ast;
  try {
    ast = parse(source, options);
  } catch (error) {
    if (!JSX_RETRY.test(fileName)) throw new UnparseableSource(String(error && error.message));
    try {
      ast = parse(source, { ...options, jsx: !options.jsx });
    } catch {
      throw new UnparseableSource(String(error && error.message));
    }
  }
  const truth = new Uint8Array(source.length);
  for (const comment of ast.comments ?? []) {
    for (let k = comment.range[0]; k < comment.range[1]; k++) truth[k] = 1;
  }
  // The shebang: a comment to node, and to `scanSource`; absent from the
  // parser's `comments`. The header carries the measurement.
  if (source.startsWith('#!')) {
    const newline = source.indexOf('\n');
    const end = newline === -1 ? source.length : newline;
    for (let k = 0; k < end; k++) truth[k] = 1;
  }
  return truth;
}

/**
 * Compare one file's two answers, byte for byte.
 *
 * @param {string} fileName
 * @param {string} source
 * @param {{ scan: (source: string) => { comment: Uint8Array }, parse: Function }} instruments
 * @returns {{ fabricates: number, overMasks: number, firstDivergence: null | { offset: number, line: number, direction: string, excerpt: string } }}
 */
export function compareFile(fileName, source, { scan, parse }) {
  const truth = oracleComments(fileName, source, parse);
  const { comment } = scan(source);
  let fabricates = 0;
  let overMasks = 0;
  let firstOffset = -1;
  let firstDirection = '';
  for (let k = 0; k < source.length; k++) {
    const parserSays = truth[k] === 1;
    const maskSays = comment[k] === 1;
    if (parserSays === maskSays) continue;
    if (parserSays) fabricates++;
    else overMasks++;
    if (firstOffset === -1) {
      firstOffset = k;
      firstDirection = parserSays ? 'FABRICATES' : 'OVER-MASKS';
    }
  }
  return {
    fabricates,
    overMasks,
    firstDivergence: firstOffset === -1 ? null : { offset: firstOffset, direction: firstDirection, ...locate(source, firstOffset) },
  };
}

/** Line number (1-based) and a printable excerpt of the line holding `offset`. */
function locate(source, offset) {
  let line = 1;
  let lineStart = 0;
  for (let k = 0; k < offset; k++) {
    if (source[k] === '\n') {
      line++;
      lineStart = k + 1;
    }
  }
  const lineEnd = source.indexOf('\n', lineStart);
  const raw = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
  // Escaped, never raw: a control byte printed straight into a CI log is
  // invisible and unsearchable (see scripts/check-nul-bytes.mjs).
  const printable = [...raw.slice(0, 100)]
    .map((ch) => (ch.codePointAt(0) < 0x20 || ch.codePointAt(0) === 0x7f ? '\\x' + ch.codePointAt(0).toString(16).padStart(2, '0') : ch))
    .join('');
  return { line, excerpt: printable + (raw.length > 100 ? ' ...' : '') };
}

/**
 * Load a `scanSource` implementation. The default is the module this gate
 * exists to check; `--masker` points it at another one for a control run.
 *
 * @param {string | null} maskerPath  repo-relative or absolute
 * @returns {Promise<(source: string) => { comment: Uint8Array }>}
 */
export async function loadMasker(maskerPath) {
  const target = maskerPath ? resolve(REPO_ROOT, maskerPath) : join(HERE, 'js-comment-mask.mjs');
  const module = await import(pathToFileURL(target).href);
  if (typeof module.scanSource !== 'function') {
    throw new Error(`${target} exports no scanSource() -- a masker is a module exporting scanSource(source).`);
  }
  return module.scanSource;
}

/**
 * The parser is loaded lazily so importing this module stays cheap — and through
 * the prerequisite thunk, so an uninstalled tree gets a NAMED prerequisite and
 * exit 3 instead of a raw `ERR_MODULE_NOT_FOUND` stack and exit 1. A dynamic
 * import defers the resolution failure past linking, but it does not change what
 * the failure LOOKS like: the rejection reaches the top level unhandled and node
 * prints the same node-internals stack with the same exit 1 a finding uses.
 *
 * ⛔ `requireDependency`, not `requireDefaultExport`: this module wants the
 * NAMESPACE (`parser.parse`). `@typescript-eslint/parser` has no default export
 * worth reading, and the default-export helper reads `.default` strictly.
 */
async function loadParser() {
  const parser = await requireDependency(
    '@typescript-eslint/parser',
    () => import('@typescript-eslint/parser'),
    import.meta.url,
    { measures: "`js-comment-mask.mjs` and an independent parser agree on every comment range in the tree" },
  );
  return (source, options) => parser.parse(source, options);
}

/**
 * The sweep.
 *
 * @param {{ root?: string, files?: string[], parse: Function, scan: Function }} options
 */
export function sweep({ root = REPO_ROOT, files = collectSources(root), parse, scan }) {
  const started = Date.now();
  const disagreements = [];
  const unparseable = [];
  let fabricatedBytes = 0;
  let overMaskedBytes = 0;
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    let result;
    try {
      result = compareFile(file, source, { scan, parse });
    } catch (error) {
      if (!(error instanceof UnparseableSource)) throw error;
      unparseable.push({ file: relative(root, file), reason: error.message });
      continue;
    }
    if (result.fabricates === 0 && result.overMasks === 0) continue;
    fabricatedBytes += result.fabricates;
    overMaskedBytes += result.overMasks;
    disagreements.push({ file: relative(root, file), ...result });
  }
  return { files, disagreements, unparseable, fabricatedBytes, overMaskedBytes, elapsedMs: Date.now() - started };
}

const ROW_LIMIT = 25;

async function main(argv) {
  const maskerFlag = argv.indexOf('--masker');
  let maskerPath = null;
  if (maskerFlag !== -1) {
    maskerPath = argv[maskerFlag + 1];
    if (!maskerPath || maskerPath.startsWith('--')) {
      console.error('usage: --masker <path to a module exporting scanSource>');
      process.exit(EXIT_USAGE);
    }
  }
  const rest = argv.filter((arg, index) => index !== maskerFlag && index !== maskerFlag + 1);
  const unknown = rest.filter((arg) => arg.startsWith('--'));
  if (unknown.length) {
    console.error(`unknown option(s): ${unknown.join(', ')}`);
    console.error('usage: node scripts/check-comment-mask-corpus.mjs [--self-test] [--masker <path>]');
    process.exit(EXIT_USAGE);
  }

  const parse = await loadParser();
  // The comparator's own cases, first and every time: a sweep that cannot
  // report is a sweep whose green line means nothing. ~0.05s.
  const { failures } = await runSelfTestCases(parse);
  if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    console.error("✗ comment-mask corpus sweep: the comparator's own self-test failed -- the sweep below would mean nothing.");
    process.exit(EXIT_DISAGREEMENT);
  }

  // The floor is checked BEFORE the corpus is parsed: a walk that found
  // nothing must refuse in a second, not report a fast green after one.
  const files = collectSources();
  if (files.length < CORPUS_FLOOR) {
    console.error(`✗ comment-mask corpus sweep: REFUSED -- ${files.length} source files found under ${REPO_ROOT}, floor is ${CORPUS_FLOOR}.`);
    console.error('   A green over an empty corpus is indistinguishable from a green over a clean one, so this is a refusal, not a pass.');
    process.exit(EXIT_REFUSED);
  }

  const scan = await loadMasker(maskerPath);
  const label = maskerPath ? `${maskerPath} (control run)` : 'scripts/js-comment-mask.mjs';
  const { disagreements, unparseable, fabricatedBytes, overMaskedBytes, elapsedMs } = sweep({ files, parse, scan });
  const seconds = (elapsedMs / 1000).toFixed(1);

  for (const row of unparseable.slice(0, ROW_LIMIT)) {
    console.error(`  UNPARSEABLE  ${row.file}\n               ${row.reason}`);
  }
  for (const row of disagreements.slice(0, ROW_LIMIT)) {
    console.error(`  ${row.file}  fabricates=${row.fabricates} over-masks=${row.overMasks}`);
    if (row.firstDivergence) {
      console.error(`      first at line ${row.firstDivergence.line} (offset ${row.firstDivergence.offset}), ${row.firstDivergence.direction}`);
      console.error(`      ${row.firstDivergence.excerpt}`);
    }
  }
  const suppressed = Math.max(0, unparseable.length - ROW_LIMIT) + Math.max(0, disagreements.length - ROW_LIMIT);
  if (suppressed) console.error(`  ... and ${suppressed} more (the counts below are over ALL files, not just the rows printed)`);

  if (disagreements.length || unparseable.length) {
    console.error(
      `✗ comment-mask corpus sweep [${label}]: ${disagreements.length} of ${files.length} files disagree ` +
        `(${fabricatedBytes} comment bytes read as code, ${overMaskedBytes} code bytes read as comment), ` +
        `${unparseable.length} unparseable, ${seconds}s.`,
    );
    console.error('   A disagreement is a defect in scanSource, not in the file: every source above is legal JavaScript that the parser reads.');
    console.error("   Pin the shape in js-comment-mask.mjs's --self-test as well -- the corpus finds it once, a case holds it forever.");
    process.exit(EXIT_DISAGREEMENT);
  }

  console.log(
    `✓ comment-mask corpus sweep [${label}]: ${files.length} files, 0 disagree, 0 unparseable, ${seconds}s ` +
      `(comparator self-test: ${SELF_TEST_CASE_COUNT} cases pass).`,
  );
}

// ---------------------------------------------------------------------------
// Self-test -- the comparator, not the corpus
// ---------------------------------------------------------------------------

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// `failures.length === 0` used to be this self-test's ONLY success condition,
// so "every case held" and "the cases never ran" printed the same line — and
// the `SELF_TEST_CASE_COUNT` the sweep's green line prints is DERIVED from the
// same array, so a deleted case shrinks the printed number with it and the gate
// stays green. Closed the way PR #13487 validated on check-doc-authoring: what
// is pinned is the registered NAMES, not a number.
//
// This file declares ONE battery, opened at the top of `runSelfTestCases()`'s
// body. It carries ZERO named section banners — fewer than the two the
// sectioning criterion needs — and ⛔ a comment is NOT promoted to a section
// head: that is a judgement per comment this transplant does not make. The
// hoisted single battery is the shape PRs #14896, #15003 and #15217 landed for
// this case.
//
// ── Why the LEDGER is module-level and the CHECK sits at the verdict site ──
//
// This gate splits its self-test in two: `runSelfTestCases()` REGISTERS and
// returns its cases, and `selfTest()` DECIDES — it prints the per-case lines,
// the red line or the green one. There is no verdict site inside the
// registering body, so the floor is evaluated where the green line already is
// (inside `selfTest()`, reached only from the `--self-test` branch of the
// dispatch). The ledger it reads therefore has to outlive
// `runSelfTestCases()`'s frame — hence module scope rather than the local map
// the single-body recipe closes over. Only the CHECK's location moves;
// attribution and scope are untouched. This is the class-3 placement PR #15309
// settled.
//
// ⚠️ `main()` — the PRODUCTION path — also calls `runSelfTestCases()`, on every
// sweep, so the registrations happen there too. The floor is deliberately NOT
// evaluated on that path: it lives in `selfTest()`, which the sweep never
// calls. Scoping it that way is what keeps a corpus sweep from acquiring a
// refusal that belongs to the `--self-test` verdict.
//
// ⛔ The floor is NOT placed at the end of `runSelfTestCases()` before its
// `return`: an early return anywhere above that line would skip the check
// entirely — the exact defect the #13798 verdict handshake exists to catch —
// coupling hole 1 to hole 2 after the card ruled them orthogonal. It would also
// fire on every production sweep. Evaluated at the verdict site, the same early
// return lands as a count BELOW the floor and reds, in `--self-test` alone.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3
// keeps a total "right" the moment a sibling grows.
//
// The count is a FLOOR, not an equality — adding cases is ordinary work and must
// not red. A battery BELOW its floor means cases stopped running; the remedy is
// to find what stopped registering.
const SELF_TEST_BATTERIES = Object.freeze({
  'check-comment-mask-corpus self-test': 17,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 1;

// The key a case is filed under when no battery is open. It is not a declared
// battery, so it reds by the same set difference rather than silently inflating
// whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

// The battery ledger, read by `batteryFloorFailures()` below from the OTHER
// function.
//
// ⚠️ Named for the roster's role, deliberately NOT with a self-test spelling:
// `check:pm-dispatch-gates` anchors on a top-level declaration whose NAME spells
// self-test and every such name owes a row in its COMPOUND_ANCHOR_LEDGER. This
// machinery holds no fixtures to mask and reads no path literal, so the accurate
// name is the one that says `battery`.
const batterySeen = new Map();
let openBattery = null;

/** Open a battery. Every case registered after this line is attributed to it. */
function battery(name) {
  openBattery = name;
}

/** Called by `runSelfTestCases()`'s own case sink, once per case. */
function registerCase() {
  const name = openBattery ?? UNATTRIBUTED_BATTERY;
  batterySeen.set(name, (batterySeen.get(name) ?? 0) + 1);
}

/**
 * The floor: every declared battery RAN, and ran its cases (#13489).
 *
 * Guards the registrations made by **`runSelfTestCases()`** — the body whose
 * case sink `ok()` routes through `registerCase()`. It is called from
 * `selfTest()` immediately before the success line, so that line can only be
 * printed by a run in which the set of batteries that registered cases EQUALS
 * the set declared, each at or above its own count. A set difference says WHICH
 * battery stopped; a count says only that something did.
 *
 * @returns {string[]} floor breaches; empty means the floor held
 */
function batteryFloorFailures() {
  const declared = Object.keys(SELF_TEST_BATTERIES);
  const problems = [];
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    problems.push(
      `SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batterySeen) {
    if (declared.includes(name)) continue;
    problems.push(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES — a case attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declared) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    problems.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (problems.length) {
    problems.push(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (an early return, a deleted block, a guard that now '
        + 'skips) and restore it.',
    );
  }
  return problems;
}

/**
 * What these cases hold: that a disagreement is REPORTED, in both directions,
 * and that the shebang reconciliation is applied. They run against the real
 * parser, on tiny sources, with stub maskers standing in for `scanSource` --
 * so a run of this gate proves its own instrument before it reports on the
 * tree. Without them, "0 files disagree" and "the comparison is broken" print
 * the same line.
 */
export let SELF_TEST_CASE_COUNT = 0;

async function runSelfTestCases(parse) {
  // The single hoisted battery this body's cases are attributed to. The floor
  // that reads them is evaluated at the verdict site in `selfTest()`.
  battery('check-comment-mask-corpus self-test');
  const { scanSource } = await import('./js-comment-mask.mjs');
  const failures = [];
  const cases = [];
  const ok = (label, condition) => {
    registerCase();
    cases.push({ label, condition: Boolean(condition) });
  };

  const flagNothing = (source) => ({ comment: new Uint8Array(source.length) });
  const flagEverything = (source) => ({ comment: new Uint8Array(source.length).fill(1) });
  const scanWithoutShebang = (source) => {
    const { comment } = scanSource(source);
    if (source.startsWith('#!')) {
      const newline = source.indexOf('\n');
      for (let k = 0; k < (newline === -1 ? source.length : newline); k++) comment[k] = 0;
    }
    return { comment };
  };

  const commented = "// a line comment\nconst a = 1; /* a block comment */\n";
  const agreement = compareFile('a.ts', commented, { scan: scanSource, parse });
  ok('the real masker agrees with the parser on an ordinary source', agreement.fabricates === 0 && agreement.overMasks === 0);

  const blind = compareFile('a.ts', commented, { scan: flagNothing, parse });
  ok('a masker that flags no comment is reported as FABRICATES', blind.fabricates > 0 && blind.overMasks === 0);
  ok('...and the count is exactly the comment bytes it missed', blind.fabricates === '// a line comment'.length + '/* a block comment */'.length);
  ok('...and the first divergence names the direction and the line', blind.firstDivergence?.direction === 'FABRICATES' && blind.firstDivergence?.line === 1);

  const greedy = compareFile('a.ts', commented, { scan: flagEverything, parse });
  ok('a masker that flags everything is reported as OVER-MASKS', greedy.overMasks > 0 && greedy.fabricates === 0);

  const shebang = '#!/usr/bin/env node\nconst a = 1;\n';
  ok(
    'the shebang reconciliation is applied (the parser reports no comment for it)',
    compareFile('a.mjs', shebang, { scan: scanSource, parse }).fabricates === 0,
  );
  ok(
    '...and a masker that does NOT flag the shebang is caught by it',
    compareFile('a.mjs', shebang, { scan: scanWithoutShebang, parse }).fabricates === '#!/usr/bin/env node'.length,
  );

  // The shape #10427 shipped on: a comment inside a template interpolation.
  const interpolated = 'const c = `${x /* gone */} tail`;\n';
  const nested = compareFile('a.ts', interpolated, { scan: scanSource, parse });
  ok('parser and masker agree on a comment inside a template interpolation', nested.fabricates === 0 && nested.overMasks === 0);

  let refused = false;
  try {
    compareFile('a.ts', 'const = = ;;;\nfunction (', { scan: scanSource, parse });
  } catch (error) {
    refused = error instanceof UnparseableSource;
  }
  ok('an unparseable source refuses instead of scoring clean', refused);

  let jsxInJs = null;
  try {
    jsxInJs = compareFile('a.js', 'export const el = <div>{/* jsx */}</div>;\n', { scan: scanSource, parse });
  } catch {
    jsxInJs = null;
  }
  ok('JSX in a .js file is retried with jsx on rather than called unparseable', jsxInJs !== null);

  ok(`the corpus walk finds at least ${CORPUS_FLOOR} files in this tree`, collectSources().length >= CORPUS_FLOOR);
  ok('...and every path it returns carries a known source extension', collectSources().every((file) => SOURCE_EXTENSIONS.has(extname(file))));

  // ── The walk's exclusions, on a REAL tree, in both directions ─────────────
  //
  // `SKIPPED_DIRECTORIES` is the kind of declaration that reads as obviously
  // correct and is measured by nothing: for `.cache` it was wrong for as long
  // as `scripts/build-console.sh` has existed, and the only reader who ever
  // found out was an operator staring at a red gate over someone else's file.
  // So the exclusion is proven the way the corpus is judged -- by walking a
  // directory on disk. The SAME BYTES are planted twice, inside `.cache` and
  // outside it, against a masker that disagrees with the parser on them: the
  // copy outside reds, the copy inside never enters the corpus at all, and the
  // only variable between the two is location.
  //
  // ⚠️ These cases run on the production sweep path too (`main()` calls this
  // body on every sweep), which is deliberate: what they hold is a property of
  // the corpus that sweep is about to report on. The fixture is two files in a
  // temp dir, removed in `finally`.
  const plantedSource = 'export const Probe = () => null;\n';
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'comment-mask-corpus-'));
  try {
    const outsidePath = join('src', 'probe.tsx');
    const insidePath = join('.cache', 'objectui-pin', 'src', 'probe.tsx');
    for (const relPath of [outsidePath, insidePath]) {
      mkdirSync(dirname(join(fixtureRoot, relPath)), { recursive: true });
      writeFileSync(join(fixtureRoot, relPath), plantedSource, 'utf8');
    }

    const collected = collectSources(fixtureRoot).map((file) => relative(fixtureRoot, file));
    ok('the walk collects a planted source that sits outside .cache', collected.includes(outsidePath));
    ok('...and collects NOTHING under .cache', collected.every((file) => !file.split(sep).includes('.cache')));

    const swept = sweep({ root: fixtureRoot, parse, scan: flagEverything });
    ok('the copy outside .cache DISAGREES -- the plant is genuinely red', swept.disagreements.length === 1 && swept.disagreements[0].file === outsidePath);
    ok('...and the sweep judged exactly the one file it walked', swept.files.length === 1);
    // Excluded by LOCATION, not because those bytes happen to agree: compared
    // directly, the identical copy under `.cache` disagrees just as loudly.
    const wouldDisagree = compareFile(join(fixtureRoot, insidePath), plantedSource, { scan: flagEverything, parse });
    ok('...while the identical bytes under .cache would have disagreed if walked', wouldDisagree.overMasks > 0);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }

  SELF_TEST_CASE_COUNT = cases.length;
  for (const testCase of cases) if (!testCase.condition) failures.push(testCase.label);
  return { failures, cases };
}

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 — a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'check-comment-mask-corpus self-test reached its verdict';

export async function selfTest() {
  const parse = await loadParser();
  const { failures, cases } = await runSelfTestCases(parse);
  for (const testCase of cases) console.log(`${testCase.condition ? 'ok  ' : 'FAIL'} ${testCase.label}`);
  if (failures.length) {
    console.error(`\n${failures.length}/${cases.length} self-test case(s) failed.`);
    process.exit(EXIT_DISAGREEMENT);
  }

  // ── The assertion floor, at the verdict site (#13489) ─────────────────────
  // `runSelfTestCases()` registers but does not decide, so the floor over ITS
  // registrations is evaluated here, after every case has had its chance and
  // immediately before the success line — the only place a run that registered
  // nothing can still be stopped from reporting that every case held. It sits
  // in `selfTest()`, not in the registering body, so the production sweep in
  // `main()` — which calls `runSelfTestCases()` too — never reaches it.
  const floorProblems = batteryFloorFailures();
  if (floorProblems.length) {
    console.error(
      `\n✗ check-comment-mask-corpus self-test: the assertion floor over runSelfTestCases()'s `
        + `registrations was breached (${floorProblems.length} problem(s)); every case that DID run passed.`,
    );
    for (const problem of floorProblems) console.error(`  - ${problem}`);
    process.exit(EXIT_DISAGREEMENT);
  }

  console.log(`\nAll ${cases.length} self-test cases passed.`);

  return SELF_TEST_VERDICT;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    if ((await selfTest()) !== SELF_TEST_VERDICT) {
      console.error(
        '\n✗ check-comment-mask-corpus self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
  }
  else await main(argv);
}
