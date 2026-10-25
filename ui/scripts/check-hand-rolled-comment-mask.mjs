#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-hand-rolled-comment-mask -- a NEW private comment stripper is visible.
 *
 *   node scripts/check-hand-rolled-comment-mask.mjs              # the sweep
 *   node scripts/check-hand-rolled-comment-mask.mjs --list       # every carrier, with its regex
 *   node scripts/check-hand-rolled-comment-mask.mjs --self-test  # the detector's own cases
 *
 * Exit: 0 = no carrier outside `DEBT`, and every `DEBT` entry still carries one
 *       1 = BREACH -- a private comment projection at a path `DEBT` does not name
 *       2 = a STALE `DEBT` entry: the site it excuses is gone, so the line must go
 *       3 = REFUSAL -- the corpus came back below `CORPUS_FLOOR`, so nothing was read
 *       4 = usage
 *
 * ## Why this file exists, and why the sweeps did not close it
 *
 * `scripts/js-comment-mask.mjs` is the one answer to "is this span a comment, or
 * code?", graded against a parser by `check-comment-mask-corpus.mjs`. Reaching
 * that answer privately -- a regex pair that deletes what LOOKS like a comment --
 * is the defect those two exist to end, because a regex has no idea what a string
 * literal is: a block-comment opener inside a string opens a PHANTOM comment that
 * runs to the next real terminator, and the reader then reports clean over code it
 * never looked at.
 *
 * This repository has swept that population THREE times -- objectui#9183 moved 29
 * carriers, objectui#9613 moved one more, objectui#7882 repaired the masker
 * itself -- and after every sweep the tree held no instrument that could see a new
 * carrier appear. It did appear:
 * `packages/plugin-form/src/LineItemsPanel.parentIdNoCast-9333.test.ts` was first
 * committed about 39 hours after objectui#9183 closed, into a tree that sweep had
 * just cleaned, and nothing reported it. objectui#9751 is the finding; this file
 * is the half of it that outlives a sweep.
 *
 * ⛔ A sweep is not an instrument. It is a reading of one day, and the day after
 * it merges the population is free to grow again with nothing to say so.
 *
 * ## The shape this refuses, in two halves
 *
 * A carrier is a regex literal that BOTH
 *
 *   1. SPANS A COMMENT -- an escaped block opener, a wildcard repetition, then an
 *      escaped block closer; or an escaped line opener followed by a
 *      to-end-of-line consumer. This is the shape that answers "where are the
 *      comments in this source?".
 *
 *   2. sits in a REMOVAL POSITION -- it is the first argument of `.replace(`, or
 *      it is immediately preceded by `!` (the rejection half of a line filter).
 *      This is what makes the match a PROJECTION of the source rather than a
 *      lookup inside it.
 *
 * Both halves are load-bearing, and dropping either one was measured rather than
 * reasoned about. Without (1), `pnpm lint`-shaped noise: a regex trimming a
 * docblock's delimiters off text already known to be a comment is a different job,
 * and the shared masker is the wrong answer for it. Without (2), an extractor
 * scores as a carrier: `ownHeaderComment` in two of this directory's own tests
 * uses exactly the shape in (1) with `.exec` to FIND this file's leading docblock,
 * which is a lookup, not a projection.
 *
 * ## What this gate cannot see, named rather than hidden
 *
 * A projection assembled some other way is out of reach: a hand-written scanner
 * loop, a `.split()` on a comment regex, or a rejection routed through a named
 * `const` rather than an inline literal. The shape above is the one every carrier
 * the three sweeps moved was written in, and the one both shapes on objectui#9751
 * were written in -- it is where the population actually is, not where it could
 * theoretically be. Widening it is a measurement somebody has to take first; ⛔ do
 * not widen it on the strength of this paragraph alone.
 *
 * The sweep also reads only the JS family (`SOURCE_EXTENSIONS`). A projection
 * written in a fenced example inside a `.md` is invisible here. And it reads
 * only TRACKED files (`collectSources`, objectui#11040): a new file is invisible
 * until it is `git add`ed.
 *
 * ## Why a DEBT list and not an assertion at zero, and why it cannot grow
 *
 * ⛔ Not an allowlist. `DEBT` is the shrink-only shape this repository already
 * uses in `check-lint-coverage.mjs` and `check-type-check-coverage.mjs`, and it is
 * enforced in BOTH directions:
 *
 *   a carrier at a path `DEBT` does not name           -> exit 1
 *   a `DEBT` entry whose site no longer carries one    -> exit 2, delete the line
 *
 * The second direction is the whole difference between a ratchet and a baseline.
 * An allowlist that grows is paid for by adding a line; this one is paid for by
 * a line that must be DELETED the moment the site is fixed, and a fixed site that
 * keeps its line turns the tree red. ⛔ The remedy for a breach is to convert the
 * site onto `js-comment-mask.mjs`, never to add an entry here.
 *
 * Zero was not available on the day this landed, and that is a measurement rather
 * than a preference. Run over `2414e3751` -- the base this branched from, before
 * the four conversions -- this sweep reported 14 carriers in 9 files and exited 1,
 * naming exactly the four objectui#9751 was scoped to convert and no others. The
 * five below are the remainder it turned up, and none of them was on that card or
 * any other. Asserting zero would have turned a green tree red on day one over
 * sites nobody had yet looked at -- the posture `check-comment-mask-corpus.mjs`
 * declined for the same reason.
 *
 * ⚠️ Those figures are a SNAPSHOT under a named commit, which is why the commit is
 * named. ⛔ Do not refresh them in place under the old sha; re-take the reading and
 * name the new one. `--list` prints today's, and the entries below are a worklist
 * rather than a settlement.
 *
 * Each entry says what the site is and what paying it off would take, because a
 * bare path is a line the next reader cannot act on. One of them is NOT payable by
 * conversion and says so: a CSS subject is not a JavaScript subject, and pointing a
 * JavaScript masker at it would substitute a fresh guess for a graded answer --
 * the same refusal `skill-guide-data-table-binding.test.tsx` already carries for
 * jsonc.
 *
 * ## Where this runs
 *
 * `scripts/__tests__/check-hand-rolled-comment-mask.test.ts` runs the sweep and
 * the self-test, inside the `unit` project the root `vitest.config.mts` points at
 * `scripts/**` -- so this gate rides the `Test (shard N/4)` job that already
 * exists. ⛔ It adds no CI context and touches no workflow file.
 */

import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { blank, scanSource } from './js-comment-mask.mjs';
import { collectSources, readListedSource, SKIPPED_DIRECTORIES, SOURCE_EXTENSIONS } from './check-comment-mask-corpus.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

export const EXIT_BREACH = 1;
export const EXIT_STALE = 2;
export const EXIT_REFUSED = 3;
export const EXIT_USAGE = 4;

/**
 * A walk that comes back nearly empty reads exactly like a clean tree, so a
 * corpus below this is a REFUSAL rather than a pass. Deliberately far below the
 * thousands of files this tree holds: a ratchet on the count would be a number to
 * bump forever and would say nothing about what was read.
 */
export const CORPUS_FLOOR = 1000;

/**
 * Sites carrying a private comment projection that objectui#9751 did not convert,
 * each with what paying it off takes. ⛔ SHRINK-ONLY -- see the header. A stale
 * entry is a failure, and adding one is the wrong remedy for a breach.
 */
export const DEBT = Object.freeze({
  'packages/components/src/__tests__/empty-base-classes-override-friendly-8525.test.tsx':
    'Subject is CSS, not JavaScript. `js-comment-mask.mjs` is graded against a JavaScript parser and its narrowness is a decision, not a gap, so conversion is the WRONG remedy here; paying this off means a CSS-aware reader, or a ruling that the shape is fine where it stands.',
  'packages/i18n/src/__tests__/console-namespace-3546.test.tsx':
    'In class: strips whole-line comments out of a TSX source before a census counts identifier reads. Convertible as-is; outside the file surface objectui#9751 was claimed on.',
  'scripts/check-doc-example-shared-reader.mjs':
    'In class, and the only carrier here that is a LIVE GATE rather than a test: `canonical()` deletes block comments from expression text before comparing two expressions, so a phantom comment makes two different expressions read as equal -- the fabricating direction. Convertible as-is.',
  'scripts/__tests__/console-vite-alias-closure-4925.test.ts':
    'In class, rejection half of a line filter rather than a `.replace()`. Convertible, but the rewrite is a filter, not a one-line swap.',
  'scripts/__tests__/vitest-config-alias-targets-3944.test.ts':
    'In class, the same line-filter shape as its neighbour above. Convertible, same rewrite.',
});

// ---------------------------------------------------------------------------
// The detector
// ---------------------------------------------------------------------------

// The carrier shapes are ASSEMBLED rather than written, so this gate is not a
// carrier by describing one. Nothing here is exempt from the sweep -- there is no
// exemption list at all, and that is a property worth keeping.
const BACKSLASH = String.fromCharCode(92);
const SLASH = '/';
const STAR = '*';

const ESCAPED_BLOCK_OPEN = BACKSLASH + SLASH + BACKSLASH + STAR;
const ESCAPED_BLOCK_CLOSE = BACKSLASH + STAR + BACKSLASH + SLASH;
const ESCAPED_LINE_OPEN = BACKSLASH + SLASH + BACKSLASH + SLASH;

/** Repetitions that let a block pattern run from an opener to a closer. */
const SPANNING_WILDCARDS = ['[' + BACKSLASH + 's' + BACKSLASH + 'S]*', '.*', '[^]*'];

/** Repetitions that let a line pattern run to the end of its line. */
const TO_END_OF_LINE = ['.*', '[^' + BACKSLASH + 'n]*'];

/**
 * A regex LITERAL, read off already-masked text. Crude by design: it accepts a
 * character class wholesale so a `/` inside one does not end the literal early,
 * and it is never asked to decide division-versus-regex, because every hit is
 * re-checked by {@link spansAComment} before it counts.
 */
const REGEX_LITERAL = new RegExp(
  SLASH +
    '((?:[^' + SLASH + BACKSLASH + BACKSLASH + BACKSLASH + 'n[]|' + BACKSLASH + BACKSLASH + '.|' +
    '\\[(?:[^\\]' + BACKSLASH + BACKSLASH + ']|' + BACKSLASH + BACKSLASH + '.)*\\])+)' +
    SLASH + '[dgimsuvy]*',
  'g',
);

/**
 * Does this regex source span a COMMENT, rather than mention comment syntax?
 *
 * @param {string} body the regex literal's source, without its delimiters
 * @returns {'block' | 'line' | null}
 */
export function spansAComment(body) {
  const open = body.indexOf(ESCAPED_BLOCK_OPEN);
  if (open !== -1) {
    const close = body.indexOf(ESCAPED_BLOCK_CLOSE, open + ESCAPED_BLOCK_OPEN.length);
    if (close !== -1) {
      const between = body.slice(open + ESCAPED_BLOCK_OPEN.length, close);
      if (SPANNING_WILDCARDS.some((w) => between.includes(w))) return 'block';
    }
  }
  for (let at = body.indexOf(ESCAPED_LINE_OPEN); at !== -1; at = body.indexOf(ESCAPED_LINE_OPEN, at + 1)) {
    const after = body.slice(at + ESCAPED_LINE_OPEN.length);
    if (TO_END_OF_LINE.some((w) => after.startsWith(w))) return 'line';
  }
  return null;
}

/**
 * Is the literal at `index` being used to REMOVE what it matches?
 *
 * @param {string} masked the source with its comments blanked
 * @param {number} index offset of the literal's opening delimiter
 * @returns {'replace' | 'reject' | null}
 */
export function removalPosition(masked, index) {
  const before = masked.slice(Math.max(0, index - 48), index);
  if (/\.replace\(\s*$/.test(before)) return 'replace';
  if (/!\s*$/.test(before)) return 'reject';
  return null;
}

/**
 * Every carrier in one source.
 *
 * Comments go first, through the shared scanner: this gate's whole subject matter
 * is written out in prose in more than one file here, including this one, and a
 * reader that counted those would fabricate its own findings. Blanking rather than
 * deleting because the findings below report a LINE.
 *
 * The second flag array the same scanner returns is what separates a regex
 * literal from a carrier shape QUOTED INSIDE A STRING -- a distinction this gate
 * needs and a regex cannot make. `literal` covers a literal's CONTENT and not its
 * delimiters, so the opening `/` of a real regex literal is unflagged while the
 * same character inside a string is flagged. Reaching for that array is also the
 * point: it is the same graded answer, not a private re-derivation of it.
 *
 * @param {string} source
 * @returns {{ line: number, kind: string, position: string, pattern: string }[]}
 */
export function carriersIn(source) {
  const { comment, literal } = scanSource(source);
  const masked = blank(source, comment);
  const found = [];
  for (const match of masked.matchAll(REGEX_LITERAL)) {
    if (literal[match.index]) continue;
    const kind = spansAComment(match[1]);
    if (!kind) continue;
    const position = removalPosition(masked, match.index);
    if (!position) continue;
    found.push({
      line: masked.slice(0, match.index).split('\n').length,
      kind,
      position,
      pattern: SLASH + match[1] + SLASH,
    });
  }
  return found;
}

/**
 * Sweep the tree.
 *
 * The population is `collectSources`: the TRACKED files, never a walk of the
 * working tree. objectui#11040: a walk listed a tsup temp file that a build in
 * the same Test shard deleted before this loop read it, and the shard failed on
 * a pull request that touched neither file. A path listed and then gone before
 * its read is ABSENT: not scanned, not counted toward `CORPUS_FLOOR`, and
 * returned in `absent` so it is named rather than hidden. ⛔ Not a retry, a
 * timeout or a quarantine: nothing here waits for a file or reads it twice.
 *
 * @param {{ root?: string, files?: string[] }} [input]
 */
export function sweep({ root = REPO_ROOT, files = collectSources(root) } = {}) {
  const byFile = new Map();
  const absent = [];
  for (const file of files) {
    const path = relative(root, file).split('\\').join('/');
    const source = readListedSource(file);
    if (source === null) {
      absent.push(path);
      continue;
    }
    const carriers = carriersIn(source);
    if (carriers.length) byFile.set(path, carriers);
  }
  return { scanned: files.length - absent.length, byFile, absent };
}

/**
 * The verdict, split the way the header describes.
 *
 * @param {{ scanned: number, byFile: Map<string, object[]> }} result
 * @param {Record<string, string>} [debt]
 */
export function judge(result, debt = DEBT) {
  if (result.scanned < CORPUS_FLOOR) {
    return { code: EXIT_REFUSED, breaches: [], stale: [], reason: `corpus of ${result.scanned} is below the floor of ${CORPUS_FLOOR}` };
  }
  const breaches = [...result.byFile.keys()].filter((p) => !(p in debt)).sort();
  const stale = Object.keys(debt).filter((p) => !result.byFile.has(p)).sort();
  if (breaches.length) return { code: EXIT_BREACH, breaches, stale, reason: 'private comment projection outside DEBT' };
  if (stale.length) return { code: EXIT_STALE, breaches, stale, reason: 'a DEBT entry no longer excuses anything' };
  return { code: 0, breaches, stale, reason: 'no carrier outside DEBT' };
}

// ---------------------------------------------------------------------------
// Self-test -- the shapes, not the tree
// ---------------------------------------------------------------------------

/**
 * A green sweep over today's tree proves only that today's tree is what it is.
 * These cases are the contract, and they are written as SOURCES rather than as
 * regex sources, so each one exercises the literal scanner as well as the two
 * predicates. Every `CARRIER` case is a shape this repository actually held; every
 * `CLEAN` case is a shape it holds today that must NOT be reported, because a gate
 * that fabricates findings out of neighbouring prose is the failure this whole
 * family exists to prevent.
 */
export function selfTest() {
  const B = BACKSLASH;
  const O = B + SLASH + B + STAR;
  const C = B + STAR + B + SLASH;
  const L = B + SLASH + B + SLASH;
  const ANY = '[' + B + 's' + B + 'S]*?';

  const cases = [
    // The four objectui#9751 named, in the two shapes it distinguished.
    ['CARRIER', 'the JSDoc-only pair the three types readers carried',
      `const bare = body.replace(${SLASH}${O}${STAR}${ANY}${C}${SLASH}g, '').replace(${SLASH}^${B}s*${L}.*$${SLASH}gm, '');`, 2],
    ['CARRIER', 'the blanking hybrid the plugin-form census carried',
      `const out = src.replace(${SLASH}${O}${ANY}${C}${SLASH}g, (m) => m).replace(${SLASH}${L}[^${B}n]*${SLASH}g, '');`, 2],
    ['CARRIER', 'the rejection half of a line filter',
      `const code = lines.filter((l) => !${SLASH}^${B}s*${O}.*${C}${B}s*$${SLASH}.test(l));`, 1],
    ['CARRIER', 'a projection written with the dot-star spelling',
      `const bare = src.replace(${SLASH}${O}.*${C}${SLASH}g, ' ');`, 1],

    // Shapes this tree holds that are a DIFFERENT job.
    ['CLEAN', 'trimming the delimiters off text already known to be a docblock',
      `const prose = block.replace(${SLASH}^${B}s*${O}${STAR}${SLASH}, '').replace(${SLASH}${C}${B}s*$${SLASH}, '');`],
    ['CLEAN', 'stripping comment MARKERS line by line',
      `const text = line.replace(${SLASH}^[ ${B}t]*(?:${O}${STAR}?|${C}|${B}${STAR}|${L})[ ${B}t]?${SLASH}, '');`],
    ['CLEAN', 'EXTRACTING a docblock rather than removing one',
      `const block = ${SLASH}${O}${STAR}${ANY}${C}${SLASH}.exec(source);`],
    ['CLEAN', 'a docblock ATTACHED to a named declaration',
      `const doc = ${SLASH}${O}${STAR}${ANY}${C}${B}s*export const Thing${SLASH}.exec(source);`],
    ['CLEAN', 'a URL, which is where the naive line rule finds its phantoms',
      `const isFileUrl = ${SLASH}^file:${L}${SLASH}.test(href);`],
    ['CLEAN', 'a member row TOLERATING a trailing comment',
      `const row = ${SLASH}^ {2}(${B}w+)(${B}?)?:${B}s*(.+?);(?=${B}s*(?:${L}.*)?$)${SLASH};`],
    ['CLEAN', 'a carrier shape quoted in PROSE, which the masker takes out',
      `// const bare = body.replace(${SLASH}${O}${ANY}${C}${SLASH}g, '');\nconst x = 1;`],
    ['CLEAN', 'a carrier shape inside a STRING, which is not code either',
      `const doc = "body.replace(${SLASH}${O}${ANY}${C}${SLASH}g, '')";`],
  ];

  const failures = [];
  for (const [kind, name, source, expected] of cases) {
    const got = carriersIn(source).length;
    const want = kind === 'CARRIER' ? expected : 0;
    if (got !== want) failures.push(`  x ${kind} ${name}: expected ${want} carrier(s), got ${got}`);
  }

  // The self-test is only worth its runtime if it can still fail.
  const control = carriersIn(`const bare = body.replace(${SLASH}${O}${ANY}${C}${SLASH}g, '');`).length;
  if (control !== 1) failures.push(`  x positive control: the detector reported ${control} on a known carrier`);

  if (failures.length) {
    for (const f of failures) console.error(f);
    console.error(`x check-hand-rolled-comment-mask self-test: ${failures.length} of ${cases.length + 1} case(s) failed.`);
    return 1;
  }
  console.log(`OK check-hand-rolled-comment-mask self-test: ${cases.length + 1} cases pass (4 carrier shapes, 8 shapes this tree holds that are a different job, 1 positive control).`);
  return 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export const USAGE = 'usage: node scripts/check-hand-rolled-comment-mask.mjs [--list] [--self-test]';

function report(result, verdict, { list }) {
  const carriers = [...result.byFile.values()].reduce((n, rows) => n + rows.length, 0);
  const absent = result.absent.length ? ` (${result.absent.length} more listed but gone from disk, read as absent)` : '';
  console.log(
    `swept ${result.scanned} source file(s)${absent} under ${relative(REPO_ROOT, REPO_ROOT) || '.'}; ` +
      `${carriers} private comment projection(s) in ${result.byFile.size} file(s); DEBT names ${Object.keys(DEBT).length}.`,
  );
  if (list) {
    for (const [file, rows] of [...result.byFile].sort()) {
      console.log(`\n${file}${file in DEBT ? '  (DEBT)' : ''}`);
      for (const row of rows) console.log(`  line ${row.line}  ${row.kind}/${row.position}  ${row.pattern}`);
    }
  }
  if (verdict.code === EXIT_REFUSED) {
    console.error(`\nREFUSED: ${verdict.reason}. Nothing was read, so this is not a pass.`);
    return;
  }
  for (const file of verdict.breaches) {
    console.error(`\nBREACH ${file}`);
    for (const row of result.byFile.get(file)) console.error(`  line ${row.line}  ${row.kind}/${row.position}  ${row.pattern}`);
    console.error(
      '  This reaches "is this span a comment" privately. A regex cannot see a string literal, so a\n' +
        '  block-comment opener inside one opens a phantom comment and the reader goes blind over real code.\n' +
        "  Remedy: import the shared reader -- `maskComments` when the caller reports a line or an offset,\n" +
        '  `stripComments` when it reports neither. ' + String.fromCharCode(9940) + ' Adding a DEBT entry is not the remedy.',
    );
  }
  for (const file of verdict.stale) {
    console.error(`\nSTALE DEBT ${file}`);
    console.error('  No private comment projection here any more. Delete its entry in DEBT -- that deletion is what');
    console.error('  makes this list shrink-only, and leaving it behind turns the list back into an allowlist.');
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.some((a) => a === '--help' || a === '-h')) {
    console.log(USAGE);
    return 0;
  }
  const unknown = argv.filter((a) => !['--list', '--self-test'].includes(a));
  if (unknown.length) {
    console.error(`unknown argument(s): ${unknown.join(', ')}\n${USAGE}`);
    return EXIT_USAGE;
  }
  if (argv.includes('--self-test')) return selfTest();

  const result = sweep();
  const verdict = judge(result);
  report(result, verdict, { list: argv.includes('--list') });
  if (verdict.code === 0) console.log(`OK every carrier is a DEBT entry, and every DEBT entry still carries one. (${verdict.reason})`);
  return verdict.code;
}

// Referenced so the reuse is visible to a reader: the corpus enumeration and its
// skip list are this gate's population too, and a second copy of either would be
// a second definition of what "this tree's source" means.
void SKIPPED_DIRECTORIES;
void SOURCE_EXTENSIONS;

if (isEntrypoint(import.meta.url)) {
  process.exit(await main());
}
