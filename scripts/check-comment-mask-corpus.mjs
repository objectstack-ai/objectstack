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
 * parser does not report it in `comments` at all. Measured on this tree: 131
 * files carry a shebang, so without this reconciliation the sweep opens with
 * 131 disagreements of 18-19 bytes each -- none of them defects. A verifier
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

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/** The extensions the tree writes JavaScript-shaped source in. */
export const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx']);

/**
 * Directories that hold dependencies or build output rather than source. Same
 * list `js-comment-mask.mjs`'s header states, so the prose and the instrument
 * cannot drift apart. Every package in this tree builds to `dist`.
 */
export const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.next', 'build', '.turbo', 'coverage', '.git']);

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

/** The parser is loaded lazily so importing this module stays cheap. */
async function loadParser() {
  const parser = await import('@typescript-eslint/parser');
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
  const { scanSource } = await import('./js-comment-mask.mjs');
  const failures = [];
  const cases = [];
  const ok = (label, condition) => cases.push({ label, condition: Boolean(condition) });

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

  SELF_TEST_CASE_COUNT = cases.length;
  for (const testCase of cases) if (!testCase.condition) failures.push(testCase.label);
  return { failures, cases };
}

export async function selfTest() {
  const parse = await loadParser();
  const { failures, cases } = await runSelfTestCases(parse);
  for (const testCase of cases) console.log(`${testCase.condition ? 'ok  ' : 'FAIL'} ${testCase.label}`);
  if (failures.length) {
    console.error(`\n${failures.length}/${cases.length} self-test case(s) failed.`);
    process.exit(EXIT_DISAGREEMENT);
  }
  console.log(`\nAll ${cases.length} self-test cases passed.`);
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) await selfTest();
  else await main(argv);
}
