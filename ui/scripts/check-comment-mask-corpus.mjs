#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-comment-mask-corpus -- the CORPUS half of "is this span a comment, or
 * code?", cross-checked against an independent parser.
 *
 *   node scripts/check-comment-mask-corpus.mjs              # the sweep
 *   node scripts/check-comment-mask-corpus.mjs --self-test  # the comparator's own cases
 *   node scripts/check-comment-mask-corpus.mjs --masker scripts/OTHER.mjs
 *                                                           # positive control -- see below
 *
 * `scripts/js-comment-mask.mjs` answers that question for every source-scanning
 * gate in this tree, and its `--self-test` pins the SHAPES: sources someone
 * wrote down, each with a known right answer. This is the other instrument, and
 * the two do not subsume each other:
 *
 *   the self-test pins shapes someone thought of, the sweep finds shapes the
 *   tree actually contains, and neither substitutes for the other.
 *
 * ## Ported from objectstack, and where this copy diverges
 *
 * Origin: `scripts/check-comment-mask-corpus.mjs` in objectstack-ai/objectstack,
 * blob `dd50cb13ae277ac29439f9d6d2c657e01243057a` (read from `origin/main`,
 * 2026-09-07). `js-comment-mask.mjs`'s header named that script and said it was
 * NOT ported here and that nothing in this repository ran it; that paragraph is
 * updated by the same change that added this file.
 *
 * ⛔ This is NOT a verbatim copy. The five divergences below are structural --
 * a different oracle import, a different prerequisite helper, a different
 * skip-list, a different failure posture and a different enumeration. No gate
 * compares it with upstream (this repository's port pin and its parity gate
 * were retired by objectui#10208), so drift from upstream is found by hand.
 *
 *   1. THE ORACLE IS REACHED THROUGH `typescript-eslint`, NOT
 *      `@typescript-eslint/parser`. Upstream imports the parser package
 *      directly, which is a root devDependency THERE. Here it is not declared at
 *      the root at all -- only pulled in transitively by `typescript-eslint`
 *      (root devDependency `^8.67.0`) -- and pnpm's isolated `node_modules` means
 *      a direct import does not even resolve from the repo root (measured:
 *      `ERR_MODULE_NOT_FOUND`). `typescript-eslint` re-exports that same package
 *      at that same version as `parser`, so this port reads the oracle from the
 *      declaration this repository already has rather than adding a second one
 *      for a module that is already installed. The re-export exposes
 *      `parseForESLint` rather than `parse`; `parseForESLint(source, options).ast`
 *      is the same AST, and `adaptParse` below is the whole adaptation.
 *
 *   2. THE PREREQUISITE HELPER IS INLINED, NOT PORTED. Upstream calls
 *      `requireDependency` from its `scripts/import-prerequisite.mjs` -- 1,448
 *      lines, none of the rest of which this tree has any caller for. The one
 *      behaviour that matters here is that an uninstalled tree gets a NAMED
 *      prerequisite and a distinct exit code instead of a raw
 *      `ERR_MODULE_NOT_FOUND` stack and the exit 1 a real finding uses. That is
 *      `loadParser` below, and it is roughly fifteen lines. Inlining the one
 *      function was the smaller of the two, by two orders of magnitude.
 *
 *   3. THE SKIP LIST IS THIS TREE'S. Upstream skips `.cache` because its console
 *      build materialises a whole objectui checkout there; this repository has no
 *      `.cache` and no such step, so carrying that entry would be inherited
 *      folklore. What this tree does have is its own set of generated and
 *      gitignored directories, and `SKIPPED_DIRECTORIES` names them.
 *
 *   4. THE POSTURE IS REPORT-WITH-A-CEILING, NOT FAIL-ON-ANY-DISAGREEMENT --
 *      see the next section, which is the reason this card exists.
 *
 *   5. THE CORPUS IS THE TRACKED FILES, NOT A WALK OF THE WORKING TREE
 *      (objectui#11040). Upstream walks the directories. A walk lists whatever
 *      is on disk as it passes, including a file another process is about to
 *      delete, and the read that follows throws. That failed a CI Test shard:
 *      `packages/cli/src/__tests__/cli-bin.test.ts` builds with tsup, which
 *      writes a temporary `tsup.config.bundled_*.mjs` and deletes it, and
 *      `check-hand-rolled-comment-mask` (which shares this enumeration) read it
 *      in between, on a pull request that touched neither file.
 *
 * ## The posture, and why it is not upstream's
 *
 * Upstream fails on ANY disagreement and carries no allowance for known
 * residue, because its tree sweeps clean. THIS tree does not: objectui#7882 is
 * an OPEN, measured defect in `js-comment-mask.mjs`, pinned deliberately as
 * `KNOWN LIMITS` in `scripts/__tests__/js-comment-mask-jsx-6891.test.ts`, and
 * the maintainer's ruling on that card is that this sweep exists to MEASURE the
 * residue, not to turn the tree red over a defect that is already pinned and
 * already decided about. Landing upstream's posture unchanged would have made a
 * green tree red on day one for a shape a card is deliberately holding open.
 *
 * So the verdict is split by DIRECTION, because the two directions are not the
 * same defect and this tree's residue sits entirely in one of them:
 *
 *   FABRICATES  the parser says comment, the mask says code. Every gate
 *               downstream then reads genuinely commented-out text as live code
 *               and manufactures findings out of prose. `js-comment-mask.mjs`'s
 *               header calls this direction worse than no verifier at all.
 *               Measured over this tree: ZERO bytes, in zero files. It is clean,
 *               so it is asserted -- any fabricated byte is FATAL. Holding a
 *               direction that is already at zero costs this tree nothing today
 *               and is the whole of what a regression here would look like.
 *
 *   OVER-MASKS  the mask says comment, the parser says code. The gate goes blind
 *               over real code instead -- quieter, and the direction the module's
 *               header calls the better one to fail in. This is where objectui#7882's
 *               residue lands, so it is REPORTED against a declared ceiling
 *               rather than asserted at zero.
 *
 * ⛔ The ceiling is a CEILING, not an equality: ordinary edits to the file
 * holding the residue must not red this gate, and only getting WORSE may. It is
 * also not an allowlist that grows -- a breach is a new place where a gate reads
 * live code as prose, and the remedy is to look at the file, not to raise the
 * number.
 *
 * ## The measurement this port was written to take (objectui#7882)
 *
 * Run on `b6f821a8b`, this tree, 2026-09-07 -- the reading the card asked for:
 *
 *   files swept                                   4,418
 *   unparseable                                       0
 *   files disagreeing with the parser                 1
 *   FABRICATES bytes                                  0
 *   OVER-MASKS bytes                              1,517
 *   wall clock                                    ~33 s
 *
 * The corpus is 4,418 and not 4,422 because `SKIPPED_DIRECTORIES` excludes
 * `apps/site/.source`, whose four generated files this walk would otherwise
 * judge; a first pass carrying upstream's skip list swept them and found them
 * clean, so the exclusion changes the count and not the reading.
 *
 * The single disagreement is `apps/console/src/pages/DocsIndex.tsx`, and it is
 * objectui#7882's "slash in JSX text" half reaching its worst case. The JSX text
 * `src/docs/*.md` puts a `/` immediately before a `*`, so the scanner opens a
 * phantom BLOCK COMMENT -- not the phantom regex the card leads with -- and
 * because no STAR SLASH terminator follows anywhere in the file (spelled in
 * words on purpose -- writing that pair literally here would end THIS comment,
 * which is the same class of hazard one level up), the phantom runs from line 63 to
 * the end of the file. 1,517 bytes, 37 lines of live JSX, handed to every gate
 * that masks this file as though they were prose.
 *
 * ⚠️ That is bigger than the card's headline number, and it is a DIFFERENT
 * measurement rather than a correction of it. The card's "145 bytes across 28
 * files" is a diff of the LITERAL flag arrays between today's masker and the
 * pre-objectui#6891 one; this sweep diffs the COMMENT flag array against a
 * parser. Both were re-derived on `b6f821a8b`: the card's number reproduces
 * exactly (145 bytes, 28 files, and 0 comment bytes changed between the two
 * maskers, matching that header's claim too). The two numbers are about
 * different arrays and neither supersedes the other.
 *
 * ⚠️ Which gates' verdicts it can move, measured rather than reasoned: of the
 * seven gates in `scripts/` that import this masker, exactly two ever open that
 * file (`check-vi-mock-inherit`, `check-vi-mock-specifiers`; the other five
 * never read it, so no verdict of theirs can move). Both were run against the
 * tree as it is and against a copy in which the phantom is closed by a
 * one-character edit to the JSX text. Both exit 0 either way, with byte-identical
 * output. So as of this commit NO gate's verdict moves -- which is a reading with
 * a shelf life, not a property, and re-taking it is what this script is for.
 *
 * ## Unparseable is fatal, never skipped
 *
 * A file a gate could not read scores as a file with nothing to report, so a
 * file the oracle cannot parse is reported and is fatal. The one accommodation
 * is spelling, not silence: JSX is legal in any JS-family extension, so a
 * `.js`/`.mjs`/`.cjs`/`.jsx` source that fails under the extension's default JSX
 * setting is retried with the other one before it is called unparseable.
 * `.ts`/`.mts`/`.cts` are not retried -- TypeScript forbids JSX there, and
 * `(x) => x` written with a leading type parameter needs JSX off to parse at all.
 *
 * ## The one reconciliation
 *
 * A `#!` line is a comment to node, and `scanSource` flags it as one. The parser
 * does not report it in `comments` at all. Without this reconciliation the sweep
 * would open with one bogus disagreement per shebang file, so the oracle adds
 * the shebang line back explicitly, here, where a reader can see the claim and
 * check it. That is the ONLY reconciliation; every other byte of disagreement is
 * a real disagreement about what a comment is.
 *
 * ## Why the corpus has a floor
 *
 * "0 disagreements" over an empty corpus is byte-identical to "0 disagreements"
 * over a clean one, and the second is the whole point of the run. So a corpus
 * smaller than `CORPUS_FLOOR` is a REFUSAL (exit 3), not a pass. The floor is a
 * smoke detector for a walk that found nothing -- deliberately far below the
 * ~4,400 files this tree holds, because a ratchet on the count would be a number
 * to bump forever and would say nothing about coverage. Coverage is asserted by
 * the self-test instead: it proves, on every single run, that this comparator
 * can still REPORT a disagreement.
 *
 * ## The positive control -- how to prove the sweep can fail
 *
 * A green sweep is worth exactly as much as its ability to go red, so
 * `--masker PATH` points the comparison at a different implementation of
 * `scanSource`. A masker is just a module exporting `scanSource(source)`, so the
 * control can live anywhere:
 *
 *   printf 'export function scanSource(s){return {comment:new Uint8Array(s.length)};}\n' \
 *     > "$TMPDIR/blind-mask.mjs"
 *   node scripts/check-comment-mask-corpus.mjs --masker "$TMPDIR/blind-mask.mjs"
 *
 * Measured 2026-09-07 on this tree: 4,370 of 4,418 files disagree, 21,602,924
 * fabricated bytes, exit 1. A nonzero exit is the EXPECTED outcome of a control
 * run; the gate's contract is the default mode.
 *
 * ⚠️ THE OBVIOUS CONTROL DOES NOT WORK HERE, and the reason is a finding rather
 * than a caveat. Upstream's recipe re-derives its own historical defect by
 * pointing `--masker` at the pre-fix masker. The analogous move here -- extract
 * `js-comment-mask.mjs` and delete objectui#6891's one-token `<` rule -- was
 * measured, and it produces a reading IDENTICAL to the fixed masker's: 1 file,
 * 0 fabricated, 1,517 over-masked, exit 0. That is not the control
 * malfunctioning. objectui#6891's phantom is opened through the LITERAL flag,
 * and a diff of the two maskers over this whole tree moves 145 literal bytes in
 * 28 files while moving exactly ZERO comment bytes -- so a comment-array
 * comparator is blind to it BY CONSTRUCTION, everywhere, not just here.
 *
 * ⇒ The consequence worth carrying: this sweep measures the COMMENT direction
 * only. It is the right instrument for "does a gate read prose as code", and it
 * is NOT an instrument for the literal-flag half of objectui#7882. Anyone
 * reading a green run as coverage of that half is reading it wrong.
 */

// The sweep reads every tracked JS/TS file under the repo root, so the corpus is
// the whole tree as git records it; the one path literal below names the masker
// this gate exercises, not the files it reads.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/** The extensions the tree writes JavaScript-shaped source in. */
export const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx']);

/**
 * Directories that hold dependencies, build output or generated code rather
 * than authored source.
 *
 * The first seven are the build and dependency directories every package in
 * this workspace produces. The rest are this repository's own generated and
 * gitignored trees (`.gitignore`: `apps/site/.source` is written by
 * `fumadocs-mdx`, `test-results` and `playwright-report` by Playwright,
 * `.playwright-mcp` and `.objectui-tmp` by tooling). None of them holds source
 * a person wrote, so a disagreement inside one would send its reader to pin a
 * shape in `js-comment-mask.mjs` on behalf of a generator -- the failure
 * upstream records for its own `.cache` entry, which is the objectstack-only
 * case this port drops.
 *
 * The corpus is the TRACKED files (`collectSources`), so a gitignored
 * directory is out of it before this list is read. The list still applies to a
 * tracked path under one of these names, so exclusion by location stays
 * declared here rather than left to whatever `.gitignore` says.
 */
export const SKIPPED_DIRECTORIES = new Set([
  'node_modules', 'dist', '.next', 'build', '.turbo', 'coverage', '.git',
  '.source', 'test-results', 'playwright-report', '.playwright-mcp', '.objectui-tmp',
]);

/** Below this, the corpus is not a corpus -- see the header. */
export const CORPUS_FLOOR = 1000;

/**
 * The residue objectui#7882 is holding open, as measured on `b6f821a8b`, and the
 * ONLY disagreement this tree carries. See the posture section of the header.
 *
 * ⛔ `fabricatedBytes` is 0 and is an ASSERTION, not a ceiling to raise: this
 * tree has no fabricated byte anywhere, and that is the direction the masker's
 * own header calls worse than no verifier at all.
 *
 * The other two are CEILINGS over the OVER-MASKS direction, set at exactly
 * today's reading. They exist so an ordinary edit to the file holding the
 * residue cannot red this gate while a NEW blind spot can. Breaching one is not
 * an invitation to raise it -- it means a gate somewhere is now reading live
 * code as prose in a place it previously read correctly.
 */
export const KNOWN_RESIDUE = Object.freeze({
  card: 'objectui#7882',
  fabricatedBytes: 0,
  maxDisagreeingFiles: 1,
  maxOverMaskedBytes: 1517,
});

export const EXIT_DISAGREEMENT = 1;
export const EXIT_USAGE = 2;
export const EXIT_REFUSED = 3;

/** JSX is on by default only where the extension demands it. */
const JSX_BY_EXTENSION = /\.(tsx|jsx)$/;
/** ...and JS-family sources may carry JSX under any of their extensions. */
const JSX_RETRY = /\.(js|mjs|cjs|jsx)$/;

/** The NUL that `git ls-files -z` delimits with, built from its code point. */
const NUL = String.fromCharCode(0);

/**
 * Every TRACKED source file under `root`: `git ls-files`, the enumeration this
 * repository's other censuses use, filtered by `SOURCE_EXTENSIONS` and by
 * `SKIPPED_DIRECTORIES`.
 *
 * ⛔ Not a walk of the working tree (objectui#11040, divergence 5 in the
 * header). A tracked file is one somebody added, so build output and temporary
 * files are out of the corpus as a class, not by name. The cost: a new file is
 * invisible until it is `git add`ed. CI checks out commits, so every file of a
 * pull request is in. A tracked path can still be gone from disk; `readListedSource`
 * is the guard for that half.
 *
 * `root` must be inside a git work tree. Outside one, `git` refuses and this
 * throws. There is no fallback to a walk, because a fallback would bring the
 * race back without saying so.
 *
 * @param {string} [root]
 * @returns {string[]} absolute paths, sorted
 */
export function collectSources(root = REPO_ROOT) {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8')
    .split(NUL)
    .filter((path) => SOURCE_EXTENSIONS.has(extname(path)))
    .filter((path) => !path.split('/').slice(0, -1).some((dir) => SKIPPED_DIRECTORIES.has(dir)))
    .map((path) => join(root, path))
    .sort();
}

/**
 * Read one listed file, or `null` when it is no longer on disk.
 *
 * A path can be listed and then vanish before its read: a tracked file deleted
 * in the working tree, or a file another process removes between the two
 * steps. It is not in the tree any more, so it is read as ABSENT rather than
 * thrown on (objectui#11040). ⛔ Not a retry or a wait: nothing here tries
 * again. Only ENOENT means absent. Any other error is thrown, because a file
 * that exists and cannot be read must never score as a file with nothing to
 * report.
 *
 * @param {string} file
 * @returns {string | null}
 */
export function readListedSource(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Thrown when the oracle cannot read a file -- never swallowed. */
export class UnparseableSource extends Error {}

/**
 * The oracle's answer: a byte flagged per character the PARSER calls comment
 * content, plus the shebang reconciliation the header explains.
 *
 * The parser is typed loosely on purpose: `typescript-eslint` types its
 * re-exported `parseForESLint` result's `ast` as `unknown`, and narrowing it
 * here would mean asserting a shape this module does not own.
 *
 * @param {string} fileName
 * @param {string} source
 * @param {(source: string, options: object) => unknown} parse
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
  // parser's `comments`. The header carries the claim.
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
    firstDivergence:
      firstOffset === -1 ? null : { offset: firstOffset, direction: firstDirection, ...locate(source, firstOffset) },
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
  // invisible and unsearchable (see scripts/check-control-bytes.mjs).
  const printable = [...raw.slice(0, 100)]
    .map((ch) =>
      ch.codePointAt(0) < 0x20 || ch.codePointAt(0) === 0x7f
        ? '\\x' + ch.codePointAt(0).toString(16).padStart(2, '0')
        : ch,
    )
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
 * Adapt the oracle's ESLint-facing entry to the `(source, options) => ast`
 * shape the comparator wants. Divergence 1 in the header: this repository
 * reaches `@typescript-eslint/parser` through `typescript-eslint`, whose
 * `parser` export exposes `parseForESLint` rather than `parse`.
 *
 * @param {{ parseForESLint: (source: string, options: object) => { ast: unknown } }} parser
 * @returns {(source: string, options: object) => unknown}
 */
export function adaptParse(parser) {
  return (source, options) => parser.parseForESLint(source, options).ast;
}

/**
 * The parser is loaded lazily so importing this module stays cheap -- and behind
 * a NAMED prerequisite, so an uninstalled tree gets a sentence and exit 3
 * instead of a raw `ERR_MODULE_NOT_FOUND` stack and the exit 1 a real finding
 * uses. A dynamic import defers the resolution failure past linking, but it does
 * not change what the failure LOOKS like.
 *
 * The specifier is resolved from the repo root rather than from this file so the
 * answer does not depend on where a caller copied the script to.
 */
async function loadParser() {
  const specifier = 'typescript-eslint';
  try {
    const require = createRequire(join(REPO_ROOT, 'package.json'));
    const module = await import(pathToFileURL(require.resolve(specifier)).href);
    const parser = module.parser ?? module.default?.parser;
    if (!parser || typeof parser.parseForESLint !== 'function') {
      throw new Error(`'${specifier}' resolved but exports no usable parser.`);
    }
    return adaptParse(parser);
  } catch (error) {
    console.error(`PREREQUISITE NOT MET: check-comment-mask-corpus needs '${specifier}'.`);
    console.error(`   It measures that js-comment-mask.mjs and an independent parser agree on every`);
    console.error(`   comment range in this tree, so without the parser there is nothing to compare against.`);
    console.error(`   '${specifier}' is a root devDependency of this repository -- run 'pnpm install'.`);
    console.error(`   (underlying: ${String(error && error.message)})`);
    process.exit(EXIT_REFUSED);
  }
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
  const absent = [];
  let fabricatedBytes = 0;
  let overMaskedBytes = 0;
  for (const file of files) {
    const source = readListedSource(file);
    if (source === null) {
      absent.push(relative(root, file));
      continue;
    }
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
  return { files, disagreements, unparseable, absent, fabricatedBytes, overMaskedBytes, elapsedMs: Date.now() - started };
}

/**
 * The verdict, split by direction -- the posture section of the header is the
 * argument, and this function is the whole of the decision.
 *
 * Separated from printing so the test can read the verdict as VALUES rather
 * than by matching prose.
 *
 * @param {{ fabricatedBytes: number, overMaskedBytes: number, disagreements: unknown[], unparseable: unknown[] }} result
 * @param {typeof KNOWN_RESIDUE} [residue]
 * @returns {{ ok: boolean, breaches: string[] }}
 */
export function judge(result, residue = KNOWN_RESIDUE) {
  const breaches = [];
  if (result.unparseable.length) {
    breaches.push(
      `${result.unparseable.length} file(s) the oracle could not parse -- a file this sweep did not check is `
        + 'never scored as a file with nothing to report.',
    );
  }
  if (result.fabricatedBytes > residue.fabricatedBytes) {
    breaches.push(
      `${result.fabricatedBytes} FABRICATED byte(s), and this tree asserts ${residue.fabricatedBytes}: the parser `
        + 'calls that text a comment and the mask calls it code, so every gate downstream reads commented-out '
        + 'text as live code. This is the direction js-comment-mask.mjs\'s header calls worse than no verifier '
        + 'at all, and it is a REGRESSION -- it was clean.',
    );
  }
  if (result.overMaskedBytes > residue.maxOverMaskedBytes) {
    breaches.push(
      `${result.overMaskedBytes} OVER-MASKED byte(s), above the ceiling of ${residue.maxOverMaskedBytes} `
        + `declared for ${residue.card}. A gate somewhere now reads live code as prose where it did not before. `
        + '⛔ Raising the ceiling is not the remedy -- open the file named above.',
    );
  }
  if (result.disagreements.length > residue.maxDisagreeingFiles) {
    breaches.push(
      `${result.disagreements.length} disagreeing file(s), above the ceiling of ${residue.maxDisagreeingFiles} `
        + `declared for ${residue.card}.`,
    );
  }
  return { ok: breaches.length === 0, breaches };
}

const ROW_LIMIT = 25;

export const USAGE = 'usage: node scripts/check-comment-mask-corpus.mjs [--self-test] [--masker PATH]';

/**
 * Read the command line ONCE, as values, before anything dispatches on it.
 *
 * ⚠️ Upstream inlines this in `main()` and carries a defect this port's test
 * caught on its first run: with `--masker` absent, `indexOf` returns -1, so the
 * filter that drops the flag and its value drops index `-1 + 1 === 0` instead --
 * argv[0]. An unknown FIRST option was therefore filtered out of the very list
 * the unknown-option check reads, and `--anything` ran a full sweep and exited
 * 0. A gate that silently ignores a misspelled flag reports on something other
 * than what it was asked for, so the guard is explicit here.
 *
 * Parsing also happens ahead of the `--self-test` branch, so `--masker` with no
 * path is a usage error rather than being skipped over by a mode flag later in
 * the same argv.
 *
 * @param {string[]} argv
 * @returns {{ maskerPath: string | null, selfTest: boolean, errors: string[] }}
 */
export function parseArgs(argv) {
  const maskerFlag = argv.indexOf('--masker');
  const errors = [];
  let maskerPath = null;
  if (maskerFlag !== -1) {
    const candidate = argv[maskerFlag + 1];
    if (!candidate || candidate.startsWith('--')) errors.push('usage: --masker PATH   (a module exporting scanSource)');
    else maskerPath = candidate;
  }
  const rest = maskerFlag === -1 ? argv : argv.filter((_arg, index) => index !== maskerFlag && index !== maskerFlag + 1);
  const unknown = rest.filter((arg) => arg.startsWith('--') && arg !== '--self-test');
  if (unknown.length) errors.push(`unknown option(s): ${unknown.join(', ')}`);
  return { maskerPath, selfTest: rest.includes('--self-test'), errors };
}

async function main({ maskerPath = null } = {}) {
  const parse = await loadParser();
  // The comparator's own cases, first and every time: a sweep that cannot
  // report is a sweep whose green line means nothing.
  const { failures } = await runSelfTestCases(parse);
  if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    console.error("✗ comment-mask corpus sweep: the comparator's own self-test failed -- the sweep below would mean nothing.");
    process.exit(EXIT_DISAGREEMENT);
  }

  // The floor is checked BEFORE the corpus is parsed: a walk that found nothing
  // must refuse in a second, not report a fast green after one.
  const files = collectSources();
  if (files.length < CORPUS_FLOOR) {
    console.error(`✗ comment-mask corpus sweep: REFUSED -- ${files.length} source files found under ${REPO_ROOT}, floor is ${CORPUS_FLOOR}.`);
    console.error('   A green over an empty corpus is indistinguishable from a green over a clean one, so this is a refusal, not a pass.');
    process.exit(EXIT_REFUSED);
  }

  const scan = await loadMasker(maskerPath);
  const label = maskerPath ? `${maskerPath} (control run)` : 'scripts/js-comment-mask.mjs';
  const result = sweep({ files, parse, scan });
  const { disagreements, unparseable, absent, fabricatedBytes, overMaskedBytes, elapsedMs } = result;
  const seconds = (elapsedMs / 1000).toFixed(1);
  const absentNote = absent.length ? ` (${absent.length} more listed but gone from disk, read as absent)` : '';

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

  // The measurement line prints on EVERY run, green or red: this gate was asked
  // for a reading, and a reading that only appears on failure is not one.
  const summary =
    `comment-mask corpus sweep [${label}]: ${files.length - absent.length} files${absentNote}, ${disagreements.length} disagree `
    + `(${fabricatedBytes} comment bytes read as code, ${overMaskedBytes} code bytes read as comment), `
    + `${unparseable.length} unparseable, ${seconds}s `
    + `(comparator self-test: ${SELF_TEST_CASE_COUNT} cases pass).`;

  const { ok, breaches } = judge(result);
  if (!ok) {
    console.error(`✗ ${summary}`);
    for (const breach of breaches) console.error(`   - ${breach}`);
    console.error('   A disagreement is a defect in scanSource, not in the file: every source above is legal JavaScript that the parser reads.');
    console.error("   Pin the shape in js-comment-mask.mjs's --self-test as well -- the corpus finds it once, a case holds it forever.");
    process.exit(EXIT_DISAGREEMENT);
  }

  console.log(`✓ ${summary}`);
  if (disagreements.length) {
    console.log(
      `   ${disagreements.length} file(s) disagree, within the residue ${KNOWN_RESIDUE.card} is holding open `
        + `(ceiling: ${KNOWN_RESIDUE.maxDisagreeingFiles} file(s), ${KNOWN_RESIDUE.maxOverMaskedBytes} over-masked bytes, `
        + `${KNOWN_RESIDUE.fabricatedBytes} fabricated). This is a REPORT, not a pass over a clean tree.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Self-test -- the comparator, not the corpus
// ---------------------------------------------------------------------------

/**
 * The floor over `runSelfTestCases()`'s registrations.
 *
 * `failures.length === 0` cannot be the only success condition: "every case
 * held" and "the cases never ran" print the same line, and `SELF_TEST_CASE_COUNT`
 * is derived from the same array, so a deleted case shrinks the printed number
 * with it and the run stays green. The floor closes that.
 *
 * ⛔ Upstream spells this as a multi-battery roster with a set difference over
 * battery NAMES, because a file with several batteries needs to say WHICH one
 * stopped. This port registers exactly ONE battery, where a set difference and a
 * count are the same assertion, so it carries the count and not the roster
 * machinery. If a second battery is ever added here, the roster is the shape to
 * go back to -- a bare total would then keep reading "right" while one battery
 * shrank and another grew.
 *
 * It is a FLOOR, not an equality: adding cases is ordinary work and must not red.
 */
export const SELF_TEST_CASE_FLOOR = 16;

/**
 * What these cases hold: that a disagreement is REPORTED, in both directions,
 * that the shebang reconciliation is applied, and that the verdict splits the
 * two directions the way the header says. They run against the real parser, on
 * tiny sources, with stub maskers standing in for `scanSource` -- so a run of
 * this gate proves its own instrument before it reports on the tree. Without
 * them, "0 files disagree" and "the comparison is broken" print the same line.
 */
export let SELF_TEST_CASE_COUNT = 0;

async function runSelfTestCases(parse) {
  const { scanSource } = await import('./js-comment-mask.mjs');
  const failures = [];
  const cases = [];
  const ok = (label, condition) => {
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

  const commented = '// a line comment\nconst a = 1; /* a block comment */\n';
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

  // The shape objectstack#10427 shipped on: a comment inside a template interpolation.
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

  // objectui#7882, the shape this port was written to measure: a `/` in JSX TEXT
  // whose next byte is `*` opens a phantom BLOCK COMMENT in the masker, and the
  // parser calls every byte of it code. Held here as a live demonstration that
  // the comparator SEES the residue -- the ceiling in `KNOWN_RESIDUE` is only
  // honest if the instrument behind it can detect the thing it is measuring.
  const jsxTextSlash = 'export const D = () => <code>src/docs/*.md</code>;\n';
  const residueShape = compareFile('a.tsx', jsxTextSlash, { scan: scanSource, parse });
  ok('objectui#7882: a `/` in JSX text followed by `*` is reported as OVER-MASKS', residueShape.overMasks > 0);
  ok('...and in that direction only -- it fabricates nothing here', residueShape.fabricates === 0);

  ok(`the corpus walk finds at least ${CORPUS_FLOOR} files in this tree`, collectSources().length >= CORPUS_FLOOR);
  ok('...and every path it returns carries a known source extension', collectSources().every((file) => SOURCE_EXTENSIONS.has(extname(file))));

  // ── The walk's exclusions, on a REAL tree, in both directions ─────────────
  //
  // `SKIPPED_DIRECTORIES` is the kind of declaration that reads as obviously
  // correct and is measured by nothing, so the exclusion is proven the way the
  // corpus is judged -- by enumerating a real git tree on disk. The SAME BYTES are
  // planted twice, inside a skipped directory and outside it, against a masker
  // that disagrees with the parser on them: the copy outside reds, the copy
  // inside never enters the corpus at all, and the only variable between the two
  // is location.
  const plantedSource = 'export const Probe = () => null;\n';
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'comment-mask-corpus-'));
  try {
    const outsidePath = join('src', 'probe.tsx');
    const insidePath = join('dist', 'generated', 'probe.tsx');
    for (const relPath of [outsidePath, insidePath]) {
      mkdirSync(dirname(join(fixtureRoot, relPath)), { recursive: true });
      writeFileSync(join(fixtureRoot, relPath), plantedSource, 'utf8');
    }
    // Both plants TRACKED, force-added past any ignore file, so the copy under
    // `dist` is excluded by the skip list and not merely by being untracked.
    execFileSync('git', ['init', '-q'], { cwd: fixtureRoot, stdio: 'pipe' });
    execFileSync('git', ['add', '-f', '--', outsidePath, insidePath], { cwd: fixtureRoot, stdio: 'pipe' });

    const collected = collectSources(fixtureRoot).map((file) => relative(fixtureRoot, file));
    ok('the walk collects a planted source that sits outside a skipped directory', collected.includes(outsidePath));
    ok('...and collects NOTHING under a skipped directory', collected.every((file) => !file.split(sep).includes('dist')));

    const swept = sweep({ root: fixtureRoot, parse, scan: flagEverything });
    ok('the copy outside DISAGREES -- the plant is genuinely red', swept.disagreements.length === 1 && swept.disagreements[0].file === outsidePath);
    ok('...and the sweep judged exactly the one file it walked', swept.files.length === 1);
    // Excluded by LOCATION, not because those bytes happen to agree: compared
    // directly, the identical copy under `dist` disagrees just as loudly.
    const wouldDisagree = compareFile(join(fixtureRoot, insidePath), plantedSource, { scan: flagEverything, parse });
    ok('...while the identical bytes under a skipped directory would have disagreed if walked', wouldDisagree.overMasks > 0);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }

  // ── The verdict, which is this port's own divergence ──────────────────────
  ok(
    'judge(): a fabricated byte is FATAL even though the tree declares residue',
    judge({ fabricatedBytes: 1, overMaskedBytes: 0, disagreements: [], unparseable: [] }).ok === false,
  );
  ok(
    'judge(): over-masked bytes AT the declared ceiling are a REPORT, not a failure',
    judge({ fabricatedBytes: 0, overMaskedBytes: KNOWN_RESIDUE.maxOverMaskedBytes, disagreements: [{}], unparseable: [] }).ok === true,
  );
  ok(
    'judge(): ...and one byte over the ceiling is a failure',
    judge({ fabricatedBytes: 0, overMaskedBytes: KNOWN_RESIDUE.maxOverMaskedBytes + 1, disagreements: [{}], unparseable: [] }).ok === false,
  );
  ok(
    'judge(): an unparseable file is FATAL on its own',
    judge({ fabricatedBytes: 0, overMaskedBytes: 0, disagreements: [], unparseable: [{}] }).ok === false,
  );

  SELF_TEST_CASE_COUNT = cases.length;
  for (const testCase of cases) if (!testCase.condition) failures.push(testCase.label);
  return { failures, cases };
}

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 -- a self-test that never finished, reported
// as one that passed.
const SELF_TEST_VERDICT = 'check-comment-mask-corpus self-test reached its verdict';

export async function selfTest() {
  const parse = await loadParser();
  const { failures, cases } = await runSelfTestCases(parse);
  for (const testCase of cases) console.log(`${testCase.condition ? 'ok  ' : 'FAIL'} ${testCase.label}`);
  if (failures.length) {
    console.error(`\n${failures.length}/${cases.length} self-test case(s) failed.`);
    process.exit(EXIT_DISAGREEMENT);
  }

  // The assertion floor, at the verdict site: `runSelfTestCases()` registers but
  // does not decide, so the floor over ITS registrations is evaluated here,
  // after every case has had its chance and immediately before the success line
  // -- the only place a run that registered nothing can still be stopped from
  // reporting that every case held. It sits in `selfTest()`, not in the
  // registering body, so the production sweep in `main()` -- which calls
  // `runSelfTestCases()` too -- never reaches it.
  if (cases.length < SELF_TEST_CASE_FLOOR) {
    console.error(
      `\n✗ check-comment-mask-corpus self-test: ${cases.length} case(s) registered, below the pinned floor of `
        + `${SELF_TEST_CASE_FLOOR}; every case that DID run passed.`,
    );
    console.error(
      '  Cases STOPPED RUNNING -- that is the bug, not the number. Find what stopped registering '
        + '(an early return, a deleted block, a guard that now skips) and restore it.',
    );
    process.exit(EXIT_DISAGREEMENT);
  }

  console.log(`\nAll ${cases.length} self-test cases passed.`);

  return SELF_TEST_VERDICT;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  const parsed = parseArgs(argv);
  if (parsed.errors.length) {
    for (const error of parsed.errors) console.error(error);
    console.error(USAGE);
    process.exit(EXIT_USAGE);
  }
  if (parsed.selfTest) {
    if ((await selfTest()) !== SELF_TEST_VERDICT) {
      console.error(
        '\n✗ check-comment-mask-corpus self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
  } else await main(parsed);
}
