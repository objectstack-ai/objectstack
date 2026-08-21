#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-nul-bytes -- rejects raw ASCII control bytes in every TEXT file git
// knows about: tracked, plus untracked files git does not ignore (#6984).
//
// Scanned set (#5157, #5460): every ASCII control character except the three that
// ARE ordinary text structure -- tab, LF, CR. The `IS_SCANNED` table below is the
// authoritative statement of which bytes those are; this line deliberately no
// longer transcribes the list (#5681), and the pasteable class on the next line is
// DERIVED from that table rather than copied (see "The character class is written
// down once" below). Equivalently
// `[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]`.
//
// #5157 drew that set as "C0 minus tab/LF/CR", matching the pattern #4890's own
// manual sweep used before this gate narrowed to NUL. #5460 added DEL (0x7f),
// which is a control character but NOT a C0 one -- it sits alone at the end of
// the ASCII table, outside any contiguous range, which is precisely how a
// range-shaped set missed it. See "Why DEL is in the set too" below.
//
//   node scripts/check-nul-bytes.mjs
//   node scripts/check-nul-bytes.mjs --self-test   # verify the checker itself
//   node scripts/check-nul-bytes.mjs --list        # what got scanned / skipped
//
// The script keeps its historical file name and its `pnpm check:nul-bytes`
// command name deliberately: those strings are referenced from CI, from other
// gates' comments and from agent instruction files, several of them owned by
// other in-flight work. A rename would buy accuracy in the name at the price of
// a half-applied rename across files this change must not touch -- so the name
// stays historical and the SCOPE is stated here, in the failure message, and at
// the CI step.
//
// ## Why a raw NUL (0x00) is rejected -- the original case
//
// A single raw NUL makes grep/ripgrep classify the WHOLE file as binary and
// silently return zero matches. `grep -n saveMetaItem
// packages/metadata-protocol/src/protocol.ts` reported nothing despite 16 real
// hits -- a core protocol file invisible to code search and to every grep-based
// lint, with no error to say so. The intent in each case was a composite-key
// separator, which must be written as the escape sequence \u0000; that string
// is byte-identical at runtime, so nothing else changes.
//
// Review does not catch this and neither did anything else: git decides
// binary-ness from the first 8000 bytes only, and protocol.ts carried its NUL
// at offset 147230, so it kept diffing as ordinary text. That blind spot is how
// six separate files accumulated the same defect before #3127 fixed them. This
// guard is what keeps them from coming back.
//
// ## Why the OTHER C0 controls are rejected too (#5157)
//
// The gate first shipped scanning 0x00 only, because 0x00 was the byte whose
// harm its failure message could prove. Measured, that harm really is
// NUL-specific: GNU grep 3.11 and ripgrep 14.1 report "binary file matches" for
// a file carrying 0x00, and keep matching normally for one carrying 0x01 or
// 0x03. So this widening is NOT the NUL argument extended by assertion -- it is
// a second, different harm that lands on the whole C0 set:
//
//   1. The byte RENDERS AS NOTHING, everywhere a human reads the code. Both
//      real specimens this change removed from the tree read as an empty string
//      while being load-bearing:
//
//        const key = keyParts.join('<0x01>');   // shows as: keyParts.join('')
//        case '<0x03>': // Ctrl+C               // shows as: case '':
//
//      grep prints the match, the diff prints the line, and review sees
//      `join('')` -- an obviously pointless call a later reader is invited to
//      "clean up", collapsing a composite key into an ambiguous concatenation.
//      Code that lies to every reader is worse than code grep cannot find,
//      because nothing signals that a second reading exists.
//   2. Nobody can search for it. The author who meant \u0001 cannot grep for
//      \u0001 (the file holds a byte, not that text) and cannot type the byte
//      into a search box either. The occurrence is unfindable in BOTH spellings.
//   3. The accident source does not pick bytes. Every occurrence in this repo's
//      history came from an editing tool materialising an escape sequence into
//      the real byte while an author was writing ABOUT the byte: #4763 (a
//      dispatch prompt), #4890 (a raw NUL landed in SKILL.md while the rule
//      "never emit a raw NUL" was being written), and PR #5140 -- the case that
//      produced this widening: the NUL this gate caught got fixed, and a 0x01
//      sitting 14 bytes away walked straight past the NUL-only scan.
//
// A byte in this set has no legitimate reason to appear in a text source file.
// Where the VALUE is genuinely wanted (a key separator, a Ctrl-key literal) the
// escape sequence is byte-identical at runtime and is the only spelling that a
// reviewer, a grep and a diff can all see.
//
// ## Why DEL (0x7f) is in the set too (#5460)
//
// #5157 drew its set as "the C0 controls", and DEL is not one: C0 is 0x00-0x1f,
// and 0x7f sits alone at the far end of the ASCII table. Nothing about that
// numbering is a reason to treat it differently -- it is an artifact of where
// ASCII put the byte, and a set expressed as a contiguous range simply could not
// reach it.
//
// The proof that the gap was arbitrary rather than considered is where the two
// remaining specimens were found. #5157 escaped a raw 0x03 in the CLI's password
// prompt; NINE LINES further down the SAME switch, in both login.ts and
// register.ts, sat a raw 0x7f as the Backspace key literal, untouched:
//
//     case '<0x03>': // Ctrl+C      <- escaped by #5157; reads as a key
//     ...
//     case '<0x7f>': // Backspace   <- shows as: case '':
//
// One case in a switch reads as a key, the next reads as an empty-string case,
// and the only thing separating them is which side of 0x1f the byte landed on.
//
// Each of the three harms above lands on DEL unchanged: it renders as nothing
// (the `case '':` above), neither spelling can be searched for, and -- the
// decisive one -- the accident source does not pick byte values. Both specimens
// came from the same tool behaviour as #4763 / #4890 / PR #5140. So did the
// FIRST draft of #5460's own issue body, which materialised two real 0x03 bytes
// while describing this very defect; that is the third and fourth recorded
// instance of the source, and it is why the set is drawn by accident source
// rather than by byte semantics.
//
// The wider vocabulary agrees: C's `iscntrl` and the Unicode regex class
// \p{Cc} both count 0x7f as a control character. "C0" was the narrower reading.
//
// ## Scope: the carrier, not the use (#4890)
//
// This guard used to scan JS/TS extensions only, on the theory that a raw NUL
// is "a source-code mistake". That theory does not survive its own error
// message: the harm it names -- grep treats the file as binary and returns ZERO
// matches -- is a property of *grep*, not of JavaScript. It lands identically on
// a markdown file, a YAML workflow, an .env.example, or a file whose extension
// nobody has invented yet.
//
// The extension list left every markdown under `.claude/` outside all three
// gates at once (`check:nul-bytes` = JS/TS only, `check:doc-authoring` = the
// top-level `skills/` + `content/` roots, eslint = JS/TS globs). #4890 was found
// the way that kind of hole always announces itself: the PR that was *writing
// the rule* "never emit a raw NUL" emitted a raw NUL into
// `.claude/skills/pm-dispatch/SKILL.md`, and this check reported OK. A skill
// file with a NUL in it is invisible to `grep -r` -- the agent never receives
// the rules it is supposed to follow, with no signal that anything is missing.
//
// So the scope is drawn by CARRIER (every text file) rather than by USE (source
// code). An extension allow-list would only move the same question -- "why
// exactly these files?" -- one directory further along, to be rediscovered by
// the next `.claude/`.
//
// ## What is enumerated: tracked AND untracked-not-ignored (#6984)
//
// The scan set is `git ls-files` PLUS `git ls-files --others --exclude-standard`
// -- the index, plus every working-tree file git neither tracks nor ignores.
//
// It used to be the index alone, and that is a hole shaped exactly like this
// gate's own accident source. `git ls-files` with no `--others` lists what has
// been `git add`-ed, so a file that has been WRITTEN but not yet staged was not
// scanned at all -- and a brand-new file is precisely where an editing tool
// materialises an escape into its byte (#4763, #4890, PR #5140, #5460's issue
// body; see the accident-source argument above). The run the agent instructions
// ask for -- "run this before pushing" -- is therefore the run most likely to be
// looking at a file the index-only enumeration could not see. It exited 0 and
// printed its usual success line, which reads as "this tree is clean" rather
// than "the file you just wrote was not looked at". #6984 measured it: an
// untracked file carrying a raw 0x1b, the AGENTS.md self-scan finding it, this
// gate green, and the only difference being the index.
//
// Three properties of the widened set, each measured rather than assumed:
//
//   - `--exclude-standard` applies .gitignore, $GIT_DIR/info/exclude and the
//     user's global excludes, so a developer's dependency trees and scratch
//     files stay out. Measured on this repo with a full `pnpm install` in the
//     tree: 76122 untracked paths, 0 of them after `--exclude-standard`. The
//     widened enumeration is quiet on ordinary local junk, and it prunes rather
//     than walks -- 16ms against 5ms for the index-only call.
//   - EXCLUDED still applies on top, so a vendored `node_modules/` that someone
//     un-ignores cannot turn this red either.
//   - In CI it is a NO-OP by construction: a workflow checks out a commit, so
//     every path is tracked and the untracked half is empty. That is asserted
//     in `--self-test` by staging the fixtures and re-scanning, not merely
//     stated here.
//
// Because a green now covers strictly more, the summary line states BOTH halves
// unconditionally ("N tracked, M untracked-not-ignored") even when M is 0. A
// count that only appeared when it was non-zero would leave the CI green and the
// pre-#6984 green looking identical, which is the false confidence this section
// exists to remove. Offenders found in the untracked half are marked as such,
// because "not staged yet" is the first thing an author needs to know about a
// file the gate just rejected.
//
// The two-line self-scan in the agent instructions stays the belt to this gate's
// braces: it is the instrument that found #6984 itself, and it reaches files
// this gate deliberately does not (ignored ones, and anything rule 3 below reads
// as binary).
//
// ## What counts as binary
//
// Deliberately NOT an extension list (that is the defect above, relocated).
// An enumerated path (see the section above) is scanned unless one of these is
// true, in order:
//
//   1. It is not a regular file (symlink, submodule gitlink) or is absent from
//      the working tree -- nothing to read.
//   2. It starts with a UTF-16/UTF-32 byte-order mark. Those encodings are text
//      whose NULs are STRUCTURAL, so this guard has nothing to say about them;
//      the repo has zero such files today (belt-and-braces).
//   3. Its bytes, with every SCANNED control byte removed, are not valid UTF-8.
//
// Rule 3 is the whole criterion, and three properties of it matter:
//
//   - The scanned bytes are stripped BEFORE the judgement, so a byte under
//     investigation can never be its own alibi. "The file has a NUL, therefore
//     it is binary, therefore we do not check it for NULs" is exactly the
//     circularity git falls into, and it is what this guard exists to break.
//   - #5157 widened that stripping from NUL to the whole scanned set, and the
//     widening is load-bearing rather than cosmetic: a control byte CAN break an
//     otherwise-valid multi-byte sequence, which NUL-only stripping would then
//     read as "binary". `E4 B8 01 AD` is the character 中 with a stray 0x01
//     dropped into the middle of it -- strip only NUL and that decodes as
//     invalid UTF-8, the file is skipped as binary, and the 0x01 is its own
//     alibi, one byte value over from the circularity this guard was built to
//     break. #5460 extended the same stripping to DEL, and it is load-bearing
//     there for exactly the same reason: `E4 B8 7F AD` is 中 with a stray 0x7f
//     dropped into it, and a C0-only strip reads that file as binary and hides
//     the 0x7f. Widening cannot go wrong in the other direction either: every
//     scanned byte is <= 0x7f, while valid UTF-8 multi-byte sequences are built
//     exclusively from bytes >= 0x80, so removing them can never break an
//     otherwise-valid sequence.
//   - The decode reads the ENTIRE file, not a leading window. git's 8000-byte
//     sniff is the documented blind spot above (protocol.ts hid a NUL at byte
//     147230); reusing it here would reproduce it.
//
// A new text file with an extension nobody has seen before therefore gets
// scanned by default -- it decodes as UTF-8, so it is text. Only real binary
// assets (the repo's 4 PNGs and 1 ICO today) fail rule 3 and drop out. Measured
// over all 5448 tracked paths when #5157 landed, and again over all 5456 when
// #5460 added DEL: the widened stripping moves exactly zero files between text
// and binary, so it buys the anti-circularity property above at no cost in
// false positives. The 4 PNGs and the ICO carry raw 0x7f bytes in quantity
// (1317 in one of them) and stay binary regardless -- they fail rule 3 on their
// whole-file decode, not on any single byte.
//
// There is intentionally NO per-file exemption hatch. No tracked file in this
// repo carries a legitimate raw control byte; if one ever genuinely needs to,
// that is a decision to take in the open, not a line to add to a skip-list.
//
// ## The character class is written down once (#5646)
//
// The scanned set exists for two audiences: as the IS_SCANNED table below, which
// is what the gate actually scans, and as a PCRE character class in the agent
// instructions that tell an author to self-scan beyond the gate. The second was
// a hand transcription of the first, and that transcription drifted twice in one
// day: #5577 found the self-scan class missing `\x7f` months after #5460 put DEL
// in the table, and #5579 found the harm argument next to it carrying only the
// part that is true of NUL.
//
// #5579 fixed the prose side by making it CITE this header instead of restating
// it. The class itself cannot be handled that way -- an author needs a command
// line they can paste -- so it is handled the other way round: `scannedCharClass()`
// DERIVES the class from the table, and `--self-test` asserts that every
// registered reference spells it byte-for-byte identically. Drift is red at the
// same gate that scans the tree.
//
// Deliberately an assertion and not codegen. The files that carry the class are
// hand-written prompts; generating them would buy the same guarantee at the cost
// of turning agent instructions into build output. An assertion leaves them
// hand-written and merely refuses to let them be WRONG, and it names the exact
// string to paste when they are.
//
// The registered set is an explicit ledger (see CHAR_CLASS_REFERENCES), like the
// repo's other shrink-only gates: a new file spelling the class out has to be
// added to it, and a file that stops spelling it out has to be removed from it
// on purpose. Extraction failure is RED, never a silent skip -- the class
// vanishing from a self-scan command is the same defect as it drifting.

import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

/**
 * The scanned set as a 256-entry lookup: every ASCII control character except
 * tab, LF and CR. A table rather than a regex, because the scan is one pass over
 * BYTES and must never have to decode the file first -- a file this gate is
 * interested in is precisely one that may not decode cleanly.
 */
const IS_SCANNED = new Uint8Array(256);
for (let b = 0x00; b <= 0x1f; b++) IS_SCANNED[b] = 1;
IS_SCANNED[0x09] = 0; // tab -- ordinary text structure
IS_SCANNED[0x0a] = 0; // LF
IS_SCANNED[0x0d] = 0; // CR
// DEL (#5460). Not a C0 control -- it sits alone at the end of the ASCII table,
// which is exactly why the C0-shaped range above missed it, and why two raw
// specimens sat nine lines from a 0x03 this gate had just made #5157 escape.
// It is in the set because the set is drawn by the ACCIDENT SOURCE, and an
// editing tool materialising an escape into its byte does not pick byte values.
// Every consequence the C0 argument rests on holds for it verbatim: it renders
// as nothing, neither spelling can be searched for, and it can split a
// multi-byte sequence and become its own alibi. The usual definitions of
// "control character" agree -- C's `iscntrl` and the regex class \p{Cc} both
// include it.
IS_SCANNED[0x7f] = 1;

/**
 * The scanned set as a PCRE character class, e.g. the argument of
 * `grep -naP '<class>'`, derived from the table above rather than written out.
 *
 * This is the spelling for HUMANS and for grep, as opposed to `escapeFor()`,
 * which is the JS `\uNNNN` spelling an author should write in source. Both are
 * built from byte values, never from a literal: this file is in its own scan
 * surface (#5646, #4890).
 *
 * Runs of three or more bytes collapse to a range; a run of one or two is
 * spelled out, because `\x0b-\x0c` is no shorter than `\x0b\x0c` and reads
 * worse. That rule is a CONVENTION, not a semantic property -- both spellings
 * match the same bytes -- and it is fixed here precisely because the reference
 * check below demands byte equality: something has to be canonical, and it is
 * this function. When a byte is added or removed, the emitted string changes and
 * the self-test prints the new one to paste into every registered reference.
 */
export function scannedCharClass() {
  const esc = (byteValue) => `\\x${byteValue.toString(16).padStart(2, '0')}`;
  let out = '';
  for (let b = 0; b < 256; b++) {
    if (IS_SCANNED[b] !== 1) continue;
    let end = b;
    while (end + 1 < 256 && IS_SCANNED[end + 1] === 1) end++;
    const run = end - b + 1;
    out += run >= 3 ? `${esc(b)}-${esc(end)}` : Array.from({ length: run }, (_, i) => esc(b + i)).join('');
    b = end;
  }
  return `[${out}]`;
}

/**
 * Every file that spells the scanned set out as a character class, and how to
 * find it there. `--self-test` asserts each extracted spelling equals
 * `scannedCharClass()` byte for byte (#5646).
 *
 * `anchor` matches the SURROUNDINGS of the class and captures the class itself.
 * It deliberately contains no part of the class: an anchor that did would stop
 * matching on exactly the drift it exists to catch, turning a mismatch (which
 * reports both spellings) into an extraction failure (which cannot).
 *
 * Registering a file makes its copy of the class immutable-except-in-step. Not
 * registered, on purpose:
 *
 *   - `.changeset/control-byte-gate-scans-*.md` and the published CHANGELOGs.
 *     Those are HISTORICAL RECORDS of one widening each, and one of them states
 *     the pre-DEL set correctly for the change it describes. Forcing them to
 *     equal today's set would falsify the record.
 *   - The prose STATEMENTS of the same set -- this header's opening line and the
 *     `.github/workflows/lint.yml` step comment. Those are sentences, not
 *     pasteable classes; prose stays on the #5579 footing -- cite this header, do
 *     not restate it -- and as of #5681 neither of them enumerates the bytes any
 *     more. (Which is why this list names them rather than quoting them: a ledger
 *     entry that spelled the bytes out would be one more copy.)
 *   - The non-ASCII guard `[^\x00-\x7f]` quoted in the isLikelyEmail changeset
 *     and the plugin-auth CHANGELOG: a different regex about input validation,
 *     unrelated to this set.
 */
const CHAR_CLASS_REFERENCES = [
  {
    file: '.claude/agents/os-dev.md',
    site: 'the byte-discipline self-scan command line',
    // The single-quoted PCRE argument of `grep -naP`.
    anchor: /grep -naP '([^']*)'/g,
  },
  {
    file: 'scripts/check-nul-bytes.mjs',
    site: "this header's own pasteable rendering of the scanned set",
    // The backticked class on the line after the word "Equivalently".
    anchor: /Equivalently\r?\n\/\/ `([^`]*)`/g,
  },
];

/** The repo this script lives in -- resolved from the script, so cwd cannot lie. */
function scriptRepoRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

/**
 * The escape an author should have written for a byte, as TEXT.
 * Built from the byte value rather than spelled out, because this file is in its
 * own scan surface: an exact literal would have to BE the byte, and the byte
 * would make the guard fail on itself.
 */
function escapeFor(byteValue) {
  return `\\u${byteValue.toString(16).padStart(4, '0')}`;
}

/** Hex spelling for the failure report, e.g. 0x01. */
function hex(byteValue) {
  return `0x${byteValue.toString(16).padStart(2, '0')}`;
}

// The in-repo precedent for the NUL case, cited in the failure message.
const CONVENTION = 'packages/rest/src/rest-server.ts:1065';

// Belt-and-braces: git already ignores these, so nothing matches today. Kept so
// a future vendored or committed artifact directory cannot quietly turn this red
// -- a control byte in a build artifact is that toolchain's business, not ours.
const EXCLUDED = /(^|\/)(node_modules|dist|build|\.next|\.turbo)\//;

/** UTF-16/UTF-32 byte-order marks, where NUL bytes are structural, not a bug. */
const WIDE_BOMS = [
  [0x00, 0x00, 0xfe, 0xff], // UTF-32BE
  [0xff, 0xfe, 0x00, 0x00], // UTF-32LE
  [0xfe, 0xff], // UTF-16BE
  [0xff, 0xfe], // UTF-16LE
];

function hasWideBom(buf) {
  return WIDE_BOMS.some((bom) => bom.length <= buf.length && bom.every((b, i) => buf[i] === b));
}

/** Every offset in `buf` holding a scanned control byte, in order. One pass. */
export function findControlBytes(buf) {
  const offsets = [];
  for (let i = 0; i < buf.length; i++) {
    if (IS_SCANNED[buf[i]] === 1) offsets.push(i);
  }
  return offsets;
}

/**
 * Text or binary, judged by content alone.
 *
 * @param {Buffer} buf
 * @param {number[]} [offsets] precomputed `findControlBytes(buf)`, so a caller
 *   that already has it does not pay for a second pass.
 * @returns {'text' | 'binary' | 'wide-encoding'}
 */
export function classify(buf, offsets) {
  if (hasWideBom(buf)) return 'wide-encoding';
  // Strip the scanned bytes first: a byte under investigation must never be the
  // reason we decline to investigate. See the header -- a stray 0x01 spliced
  // into a multi-byte sequence would otherwise make the file "binary" and hide
  // itself, the same circularity git falls into with NUL.
  const found = offsets ?? findControlBytes(buf);
  const probe = found.length > 0 ? buf.filter((b) => IS_SCANNED[b] === 0) : buf;
  try {
    new TextDecoder('utf8', { fatal: true }).decode(probe);
    return 'text';
  } catch {
    return 'binary';
  }
}

/**
 * Byte offset -> line:column, so the author can jump straight to a byte their
 * editor renders as nothing and grep cannot be asked to look for.
 */
function locate(buf, offset) {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (buf[i] === 0x0a) {
      line++;
      lineStart = i + 1;
    }
  }
  const column = buf.subarray(lineStart, offset).toString('utf8').length + 1;
  return { line, column };
}

/** One `git ls-files` invocation, NUL-split, with EXCLUDED applied. */
function lsFiles(root, args) {
  return execFileSync('git', ['ls-files', '-z', ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    // -z: NUL-delimited output, the one context where the byte is load-bearing
    // rather than a bug. Note the escape form -- this file must pass its own check.
    .split('\u0000')
    .filter(Boolean)
    .filter((f) => !EXCLUDED.test(f));
}

/**
 * The scan set: the index, PLUS the working-tree files git neither tracks nor
 * ignores (#6984). Argued in the header under "What is enumerated".
 *
 * Two calls rather than one `--cached --others`, because the two halves are
 * COUNTED separately: the summary line has to say how many of each it looked at,
 * and a combined call cannot tell them apart afterwards.
 *
 * The halves are disjoint by definition (`--others` means "not in the index"),
 * so the Map cannot lose a path; it is there so that a path appearing in both
 * lists would be scanned once and counted as tracked, rather than twice.
 *
 * @returns {{ file: string, untracked: boolean }[]} tracked first, then untracked
 */
function enumerate(root) {
  const tracked = lsFiles(root, []);
  // --others: working-tree files not in the index. --exclude-standard: apply
  // .gitignore, $GIT_DIR/info/exclude and the user's global excludes -- that is
  // what keeps a developer's dependency trees and scratch files out of the set,
  // and it prunes ignored directories rather than walking them.
  const untracked = lsFiles(root, ['--others', '--exclude-standard']);

  const byPath = new Map();
  for (const file of tracked) byPath.set(file, { file, untracked: false });
  for (const file of untracked) if (!byPath.has(file)) byPath.set(file, { file, untracked: true });
  return [...byPath.values()];
}

/**
 * The one scan. `main()` and `--self-test` both go through here, so the
 * self-test exercises the real code path rather than a parallel imitation.
 */
export function scan(root) {
  const files = enumerate(root);

  const offenders = [];
  const skipped = { binary: [], 'wide-encoding': [], unreadable: [] };
  let scannedTracked = 0;
  let scannedUntracked = 0;

  for (const { file, untracked } of files) {
    const full = join(root, file);
    let stat;
    try {
      // lstat, not stat: a tracked symlink must not be followed (a broken one
      // would throw), and a submodule gitlink is a directory here.
      stat = lstatSync(full);
    } catch {
      skipped.unreadable.push(file);
      continue;
    }
    if (!stat.isFile()) {
      skipped.unreadable.push(file);
      continue;
    }

    const buf = readFileSync(full);
    const offsets = findControlBytes(buf);
    const kind = classify(buf, offsets);
    if (kind !== 'text') {
      skipped[kind].push(file);
      continue;
    }
    if (untracked) scannedUntracked++;
    else scannedTracked++;

    if (offsets.length === 0) continue;
    const { line, column } = locate(buf, offsets[0]);
    const bytes = [...new Set(offsets.map((o) => buf[o]))].sort((a, b) => a - b);
    offenders.push({ file, line, column, offset: offsets[0], count: offsets.length, bytes, untracked });
  }

  // The untracked half is returned as PATHS, not just a count: `--list` exists to
  // answer "what got scanned", and these are the paths a reader cannot
  // reconstruct from the index afterwards.
  const untrackedFiles = files.filter((f) => f.untracked).map((f) => f.file);
  return {
    offenders,
    scanned: scannedTracked + scannedUntracked,
    scannedTracked,
    scannedUntracked,
    skipped,
    tracked: files.length - untrackedFiles.length,
    untracked: untrackedFiles.length,
    untrackedFiles,
  };
}

function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

/**
 * What the run actually looked at, stated so a green can be read for its SCOPE
 * (#6984).
 *
 * Both halves are named unconditionally, including `0 untracked`. That zero is
 * the informative case, not the boring one: it is what CI prints (a checked-out
 * commit has no untracked files), and it is what a local run prints once the
 * author has staged. Printing the untracked half only when non-zero would make
 * "nothing new to look at" and "new files were not looked at" -- the pre-#6984
 * green -- render identically, which is the whole defect.
 */
function summarise({ scanned, scannedTracked, scannedUntracked, skipped }) {
  const parts = [];
  if (skipped.binary.length) parts.push(`${skipped.binary.length} binary`);
  if (skipped['wide-encoding'].length) parts.push(`${skipped['wide-encoding'].length} UTF-16/32`);
  if (skipped.unreadable.length) parts.push(`${skipped.unreadable.length} non-regular`);
  const tail = parts.length ? `; skipped ${parts.join(', ')}` : '';
  return `scanned ${scanned} text file(s) -- ${scannedTracked} tracked, ${scannedUntracked} untracked-not-ignored${tail}`;
}

function main() {
  const result = scan(repoRoot());
  const { offenders } = result;

  if (offenders.length === 0) {
    console.log(`check-nul-bytes: OK (${summarise(result)}; no raw ASCII control bytes).`);
    process.exit(0);
  }

  const plural = offenders.length === 1 ? 'file contains' : 'files contain';
  console.error(`check-nul-bytes: ${offenders.length} ${plural} a raw ASCII control byte\n`);
  for (const o of offenders) {
    const times = o.count === 1 ? '1 occurrence' : `${o.count} occurrences`;
    const which = o.bytes.map(hex).join(', ');
    // "not staged yet" is the first thing an author needs to know about a file
    // this gate just rejected -- before #6984 such a file was not looked at at
    // all, so a reader seeing it here should be able to tell which half it came
    // from without re-deriving it from `git status`.
    const where = o.untracked ? ' [untracked]' : '';
    console.error(`  • ${o.file}:${o.line}:${o.column}${where} -- ${times} of ${which}, first at byte offset ${o.offset}`);
  }

  const seen = [...new Set(offenders.flatMap((o) => o.bytes))].sort((a, b) => a - b);
  console.error('\nWrite the escape sequence instead of the byte:\n');
  for (const byteValue of seen) console.error(`    ${hex(byteValue)}  ->  ${escapeFor(byteValue)}`);

  console.error(`
The resulting string is byte-identical at runtime, so behaviour does not change.

Why every ASCII control byte and not only NUL (#5157, #5460):

  • A raw NUL makes grep/ripgrep treat the entire file as binary and silently
    return ZERO matches, so the file drops out of code search and out of every
    grep-based lint. git will not warn you: it decides binary-ness from the
    first 8000 bytes only, so a NUL past that offset keeps diffing as text.
  • The other C0 controls keep matching in grep -- and read worse. They render
    as NOTHING, so \`keyParts.join('${escapeFor(0x01)}')\` appears in grep output, in the
    diff and in review as \`keyParts.join('')\`: a load-bearing separator that
    reads as an empty string, which a later reader is invited to delete. And
    the author who meant ${escapeFor(0x01)} can grep for neither spelling -- not the
    escape text (the file holds a byte) and not the byte (nobody can type it).
  • Every occurrence in this repo came from an editing tool materialising an
    escape into the real byte while someone was writing ABOUT the byte (#4763,
    #4890, PR #5140, and #5460's own issue body). That slip does not pick byte
    values, so neither does this gate -- which is why DEL (0x7f) is scanned too
    even though it is not a C0 control (#5460): it is the byte the C0-shaped
    range could not reach, and it was sitting nine lines from one that was.

That harm is not any one language's, so this guard covers every TEXT file git
knows about -- markdown and agent instructions under .claude/ included (#4890),
not just JS/TS sources, and untracked-but-not-ignored files as well as staged
ones (#6984), because a brand-new file is where an escape gets materialised.

Existing convention for the NUL case -- ${CONVENTION}:

    const key = environmentId ?? '${escapeFor(0x00)}default';

Prefer ${escapeFor(0x00)} over \\0, which becomes a legacy octal escape error if it
is ever followed by a digit. In prose (markdown, agent instructions), write the
byte's name or the escape TEXT -- never the byte itself.`);
  process.exit(1);
}

// ── Self-test ────────────────────────────────────────────────────────────────
//
// Builds a throwaway git repo in a temp dir and runs `scan()` -- the SAME
// function main() calls -- over it. Every control byte below is produced at
// runtime from a byte value; none is written as a literal, because this file is
// in its own scan surface and a literal would make the guard fail on itself.

/**
 * Every registered reference spells the scanned set exactly as this script emits
 * it (#5646). Reads the real files in the repo the script lives in -- the point
 * is the checked-in text, so there is nothing to fixture.
 *
 * Three ways this goes red, all of them drift:
 *   1. a registered file is unreadable -- de-registering is a decision, not a
 *      side effect of deleting or renaming;
 *   2. the anchor finds nothing -- the class disappearing from a self-scan
 *      command line leaves the instruction useless, so a silent skip here would
 *      be the #4690 anti-pattern applied to the gate that exists to stop it;
 *   3. an extracted spelling differs from the emitted one, in any byte.
 */
function checkCharClassReferences(root, assert) {
  const canonical = scannedCharClass();
  assert(
    CHAR_CLASS_REFERENCES.length > 0,
    'the character-class reference ledger is empty -- with no registered file this check asserts nothing',
  );

  for (const ref of CHAR_CLASS_REFERENCES) {
    let text = null;
    try {
      text = readFileSync(join(root, ref.file), 'utf8');
    } catch {
      // fall through to the assertion below, which reports it as drift
    }
    assert(
      text !== null,
      `${ref.file} is a registered character-class reference but could not be read -- restore it, or remove it from CHAR_CLASS_REFERENCES on purpose`,
    );
    if (text === null) continue;

    const found = [...text.matchAll(ref.anchor)].map((m) => m[1]);
    assert(
      found.length > 0,
      `${ref.file}: found no character class at the registered anchor (${ref.site}). Either the class was removed -- ` +
        `then de-register it, since an instruction to self-scan without a class to scan for is worse than none -- or the ` +
        `surrounding text moved, in which case update the anchor. Expected to find: ${canonical}`,
    );
    for (const spelling of found) {
      assert(
        spelling === canonical,
        `${ref.file} (${ref.site}) spells the scanned set as ${spelling}, but this gate scans ${canonical}. ` +
          `The IS_SCANNED table is authoritative: paste the gate's spelling into the reference (#5577 was this drift, ` +
          `a self-scan class missing \\x7f for months after #5460 added DEL to the table).`,
      );
    }
  }
}

function selfTest() {
  const failures = [];
  // Counted rather than written down: some assertions run inside a loop, and a
  // hand-kept total in the success line is exactly the kind of number that
  // drifts silently once someone adds a case.
  let checked = 0;
  const assert = (cond, msg) => {
    checked++;
    if (!cond) failures.push(msg);
  };

  const byte = (v) => Buffer.from([v]);
  const NUL = byte(0x00);
  const SOH = byte(0x01); // the PR #5140 specimen
  const ETX = byte(0x03); // Ctrl+C, as a CLI key literal
  const DEL = byte(0x7f); // Backspace, as a CLI key literal -- the #5460 specimen
  const ESC = byte(0x1b); // the #6984 specimen, in an unstaged file
  const dir = mkdtempSync(join(tmpdir(), 'check-nul-bytes-selftest-'));
  const write = (rel, contents) => {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  };

  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    // Hermetic ignore rules (#6984). The untracked half of the scan set is
    // decided by `--exclude-standard`, which reads the USER's global excludes
    // file as well as this repo's .gitignore. A developer whose global excludes
    // happen to list `node_modules/` would make the "EXCLUDED still applies"
    // fixture below pass for the wrong reason, and one who lists something else
    // could make a fixture vanish. Pointing core.excludesFile at an empty file
    // INSIDE .git (never in the working tree, which is the scan surface) leaves
    // the temp repo's own .gitignore as the only ignore rule in play.
    writeFileSync(join(dir, '.git', 'empty-excludes'), '');
    execFileSync('git', ['config', 'core.excludesFile', join(dir, '.git', 'empty-excludes')], { cwd: dir });

    // The #4890 case itself: agent instructions under .claude/, markdown, NUL
    // well past git's 8000-byte sniff window.
    write(
      '.claude/skills/demo/SKILL.md',
      Buffer.concat([
        Buffer.from(`# Demo skill\n\n${'filler prose. '.repeat(700)}\nsep: `),
        NUL,
        Buffer.from('\n'),
      ]),
    );
    // The historical case: a NUL in a TS source.
    write('packages/x/src/protocol.ts', Buffer.concat([Buffer.from("const sep = '"), NUL, Buffer.from("';\n")]));
    // #5157 specimen 1: a 0x01 composite-key separator, with NO NUL anywhere in
    // the file. This is the shape PR #5140 found 14 bytes from a NUL, and the
    // shape two files in this repo carried past the NUL-only gate for months.
    write('packages/x/src/key.ts', Buffer.concat([Buffer.from("const key = parts.join('"), SOH, Buffer.from("');\n")]));
    // #5157 specimen 2: a Ctrl-key literal in a CLI prompt loop.
    write('packages/cli/src/login.ts', Buffer.concat([Buffer.from("      case '"), ETX, Buffer.from("': // Ctrl+C\n")]));
    // #5157 specimen 3: the far end of the range, plus the two vertical-space
    // controls that sit between the exempt ones.
    write(
      'docs/range.md',
      Buffer.concat([
        Buffer.from('unit sep '),
        byte(0x1f),
        Buffer.from(' vt '),
        byte(0x0b),
        Buffer.from(' ff '),
        byte(0x0c),
        Buffer.from('\n'),
      ]),
    );
    // #5157, the anti-circularity case: a stray 0x01 spliced INSIDE a multi-byte
    // sequence. E4 B8 AD is 中; with the 0x01 in the middle, NUL-only stripping
    // leaves invalid UTF-8, the file reads as "binary", and the 0x01 becomes its
    // own alibi. Stripping the whole scanned set is what keeps it visible.
    write(
      'docs/split-sequence.md',
      Buffer.concat([Buffer.from('head '), byte(0xe4), byte(0xb8), SOH, byte(0xad), Buffer.from(' tail\n')]),
    );
    // #5460 specimen: a raw DEL as a Backspace key literal, the shape login.ts
    // and register.ts both carried nine lines below the 0x03 #5157 escaped.
    // Deliberately holds NO C0 byte at all, so the "green before / red after"
    // proof below is about DEL and not about some other byte riding along.
    write('packages/cli/src/prompt.ts', Buffer.concat([Buffer.from("      case '"), DEL, Buffer.from("': // Backspace\n")]));
    // #5460, the anti-circularity case for DEL, mirroring the 0x01 one above:
    // E4 B8 AD is 中; with a 0x7f in the middle, stripping only the C0 set
    // leaves invalid UTF-8, the file reads as "binary", and the DEL becomes its
    // own alibi. Stripping DEL as well is what keeps it visible.
    write(
      'docs/split-sequence-del.md',
      Buffer.concat([Buffer.from('head '), byte(0xe4), byte(0xb8), DEL, byte(0xad), Buffer.from(' tail\n')]),
    );
    // The cure, as a fixture: the same key literal written as the escape TEXT
    // stays green. This is the state the two CLI files are left in by #5460, and
    // it is what makes the gate's prescription testable rather than merely
    // stated -- a red fixture with no green counterpart proves only that
    // something is rejected, never that the fix is accepted.
    write('packages/cli/src/prompt-fixed.ts', "      case '\\u007f': // Backspace\n");
    // An extension nobody has seen before must still be scanned -- that is the
    // property an allow-list cannot have.
    write('config/weird.frobnicate', Buffer.concat([Buffer.from('key='), NUL, Buffer.from('\n')]));
    // Clean text of several shapes, including non-ASCII UTF-8 and a file long
    // enough that a leading-window probe would truncate a multi-byte character
    // (the failure a 64 KiB probe window really had: CHANGELOG.md read as binary).
    write('docs/clean.md', '# Clean\n\n中文说明,带 emoji 🚀 —— 完全合法的 UTF-8。\n');
    write('docs/long.md', `# Long\n\n${'中文段落,用于跨越任何前缀窗口。'.repeat(4000)}\n`);
    write('src/clean.ts', "export const sep = '\\u0000';\n");
    write('.github/workflows/ci.yml', 'name: ci\non: [push]\n');
    // The three exempt controls are ordinary text structure and must stay green,
    // CRLF endings included. DEL used to ride along on this fixture, asserted as
    // deliberately OUTSIDE the set; #5460 moved it into the set, so it moved out
    // of this fixture and into `packages/cli/src/prompt.ts` above, where it is
    // now asserted red. Tab / CR / LF are the whole exemption list.
    write('src/whitespace.ts', 'const a\t= 1;\r\nconst b = 2;\r\n');
    // Real binary assets: a PNG header and an ICO header, both carrying NULs and
    // other control bytes -- they must stay binary under the WIDENED stripping.
    write(
      'assets/pic.png',
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        NUL,
        Buffer.from([0xff, 0xd8, 0xc0, 0x80]),
      ]),
    );
    write('assets/icon.ico', Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10, 0xff, 0xfe, 0xc0]));
    // UTF-16LE text: valid text whose NULs are structural, not a defect.
    write('docs/utf16.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hi', 'utf16le')]));
    // A broken symlink: readFileSync would throw; lstat must keep us out.
    symlinkSync('/nonexistent/target', join(dir, 'dangling'));
    // Excluded artifact directory.
    write('packages/x/dist/bundle.js', Buffer.concat([Buffer.from('var a='), NUL, Buffer.from(';\n')]));

    execFileSync('git', ['add', '-A', '-f'], { cwd: dir });

    // ── #6984: everything BELOW this line is deliberately left unstaged ───────
    //
    // The fixtures above are in the index; these are not, which is the state the
    // gate could not see before #6984 (`git ls-files` with no `--others` lists
    // the index only). Writing them after the `git add` is the whole mechanism
    // of the fixture -- staging them would re-create the blind spot instead of
    // exercising it.

    // The specimen the issue measured: a brand-new test file carrying a raw ESC,
    // written by an editing tool and not yet `git add`-ed. This is the exact
    // shape of the accident source -- an escape materialised into its byte while
    // an author was writing ABOUT control characters -- landing on the one kind
    // of file the index-only enumeration could not reach.
    write('packages/cli/test/new-case.test.ts', Buffer.concat([Buffer.from("const esc = '"), ESC, Buffer.from("';\n")]));
    // The cure, unstaged: the same literal written as escape TEXT stays green,
    // so the prescription is testable on this half of the set too and an author
    // who follows it does not land back in the same red.
    write('packages/cli/test/new-case-fixed.test.ts', "const esc = '\\u001b';\n");
    // Untracked AND ignored. `--exclude-standard` must keep this out: a gate
    // that went red on the author's own scratch directory would be turned off
    // within a day, and then the untracked half buys nothing. Note the
    // .gitignore is itself untracked -- git honours it anyway, which is what
    // makes "ignored" and "not yet staged" different states rather than one.
    write('.gitignore', 'local-junk/\n');
    write('local-junk/scratch.md', Buffer.concat([Buffer.from('junk '), NUL, Buffer.from('\n')]));
    // Untracked dependency tree. This temp repo's .gitignore deliberately does
    // NOT list node_modules and core.excludesFile is empty, so git WILL offer
    // this path -- which makes the assertion below about EXCLUDED specifically,
    // and not about git's ignore rules doing the work a second time.
    write('node_modules/pkg/index.js', Buffer.concat([Buffer.from('var a='), NUL, Buffer.from(';\n')]));

    const result = scan(dir);
    const { offenders, scanned, skipped } = result;
    const flagged = new Map(offenders.map((o) => [o.file, o]));

    assert(flagged.has('.claude/skills/demo/SKILL.md'), '#4890: markdown under .claude/ must be flagged');
    assert(flagged.has('packages/x/src/protocol.ts'), 'the original JS/TS case must still be flagged');
    assert(flagged.has('config/weird.frobnicate'), 'an unknown extension holding text must still be scanned');

    // ── #5157: the widening, proved in both directions ──────────────────────
    //
    // Forward -- each specimen is flagged now.
    assert(flagged.has('packages/x/src/key.ts'), '#5157: a 0x01 key separator must be flagged');
    assert(flagged.has('packages/cli/src/login.ts'), '#5157: a 0x03 Ctrl-key literal must be flagged');
    assert(flagged.has('docs/range.md'), '#5157: 0x0b / 0x0c / 0x1f must be flagged');
    assert(flagged.has('docs/split-sequence.md'), '#5157: a 0x01 inside a multi-byte sequence must be flagged');
    //
    // Reverse -- the SAME fixtures were green under the NUL-only gate, and not
    // by accident of fixture construction: none of them contains a NUL at all,
    // so the pre-#5157 scan (`buf.indexOf(0)`) had literally nothing to find.
    // That is the "green before / red after" proof, recorded next to the code it
    // is about instead of in a PR description that cannot fail.
    const nulOnlyGateWouldFlag = (rel) => readFileSync(join(dir, rel)).includes(0x00);
    for (const rel of ['packages/x/src/key.ts', 'packages/cli/src/login.ts', 'docs/range.md', 'docs/split-sequence.md']) {
      assert(!nulOnlyGateWouldFlag(rel), `#5157 reverse: ${rel} carries no NUL, so the NUL-only gate passed it`);
    }
    // ...and the anti-circularity fixture would not even have been SCANNED
    // before: strip NUL only, and `head E4 B8 01 AD tail` fails to decode.
    const splitSeq = readFileSync(join(dir, 'docs/split-sequence.md'));
    let nulOnlyProbeDecodes = true;
    try {
      new TextDecoder('utf8', { fatal: true }).decode(splitSeq.filter((b) => b !== 0x00));
    } catch {
      nulOnlyProbeDecodes = false;
    }
    assert(!nulOnlyProbeDecodes, '#5157: NUL-only stripping would misread the split-sequence file as binary');
    assert(classify(splitSeq) === 'text', '#5157: widened stripping keeps the split-sequence file scannable');

    // ── #5460: DEL added to the set, proved in both directions ──────────────
    //
    // Forward -- a raw DEL is flagged, and reported as 0x7f so the prescription
    // can name the right escape.
    assert(flagged.has('packages/cli/src/prompt.ts'), '#5460: a raw 0x7f Backspace literal must be flagged');
    assert(
      flagged.get('packages/cli/src/prompt.ts')?.bytes.join() === String(0x7f),
      `#5460: the offending byte is reported as 0x7f, got ${flagged.get('packages/cli/src/prompt.ts')?.bytes}`,
    );
    assert(escapeFor(0x7f) === '\\u007f', 'the prescribed escape for DEL is \\u007f');
    assert(hex(0x7f) === '0x7f', 'DEL is reported as 0x7f');
    assert(flagged.has('docs/split-sequence-del.md'), '#5460: a 0x7f inside a multi-byte sequence must be flagged');
    //
    // Reverse -- and note WHICH way it runs. #5157's own reverse proof compared
    // against the NUL-only gate; the predecessor here is the C0-only gate, so
    // the question is whether these fixtures were green under THAT. They were,
    // and not by accident of construction: neither contains a single C0 byte, so
    // a C0-shaped scan had nothing to find in either.
    const c0OnlyGateWouldFlag = (rel) => {
      const buf = readFileSync(join(dir, rel));
      return buf.some((b) => b <= 0x1f && b !== 0x09 && b !== 0x0a && b !== 0x0d);
    };
    for (const rel of ['packages/cli/src/prompt.ts', 'docs/split-sequence-del.md']) {
      assert(!c0OnlyGateWouldFlag(rel), `#5460 reverse: ${rel} carries no C0 byte, so the C0-only gate passed it`);
    }
    // ...and the DEL anti-circularity fixture would not even have been SCANNED
    // before: strip the C0 set only, and `head E4 B8 7F AD tail` fails to decode,
    // so the file skips as binary and the 0x7f is its own alibi.
    const splitDel = readFileSync(join(dir, 'docs/split-sequence-del.md'));
    let c0OnlyProbeDecodes = true;
    try {
      new TextDecoder('utf8', { fatal: true }).decode(splitDel.filter((b) => b > 0x1f || b === 0x09 || b === 0x0a || b === 0x0d));
    } catch {
      c0OnlyProbeDecodes = false;
    }
    assert(!c0OnlyProbeDecodes, '#5460: C0-only stripping would misread the DEL split-sequence file as binary');
    assert(classify(splitDel) === 'text', '#5460: widened stripping keeps the DEL split-sequence file scannable');
    //
    // The cure is green. Escaping is what the gate tells authors to do, so the
    // escaped spelling must actually pass -- otherwise the prescription is
    // untested and an author who follows it lands in the same red.
    assert(!flagged.has('packages/cli/src/prompt-fixed.ts'), '#5460: the \\u007f escape spelling stays green');

    // ── #6984: the untracked half of the scan set, proved in both directions ──
    //
    // Forward -- a file that has been written but not staged is flagged, and is
    // reported as untracked so the author is not left wondering why `git status`
    // and this gate disagree.
    assert(
      flagged.has('packages/cli/test/new-case.test.ts'),
      '#6984: an untracked-but-not-ignored file carrying a raw 0x1b must be flagged',
    );
    assert(
      flagged.get('packages/cli/test/new-case.test.ts')?.untracked === true,
      '#6984: an offender found in the untracked half is marked untracked',
    );
    assert(
      flagged.get('packages/cli/test/new-case.test.ts')?.bytes.join() === String(0x1b),
      `#6984: the offending byte is reported as 0x1b, got ${flagged.get('packages/cli/test/new-case.test.ts')?.bytes}`,
    );
    // The cure is green on this half too.
    assert(!flagged.has('packages/cli/test/new-case-fixed.test.ts'), '#6984: the \\u001b escape spelling stays green');
    // A tracked offender is NOT marked untracked -- otherwise the marker would
    // be decoration rather than a fact about which half the file came from.
    assert(
      flagged.get('packages/x/src/protocol.ts')?.untracked === false,
      '#6984: a tracked offender is reported as tracked',
    );
    //
    // The widened set stays quiet on what a developer's tree is full of. Both
    // exclusions are asserted, because they are DIFFERENT mechanisms: git's
    // ignore rules (via --exclude-standard) and this script's own EXCLUDED.
    assert(!flagged.has('local-junk/scratch.md'), '#6984: an ignored untracked file is not scanned (--exclude-standard)');
    assert(
      !result.untrackedFiles.includes('local-junk/scratch.md'),
      '#6984: an ignored untracked file is not even enumerated',
    );
    assert(
      !flagged.has('node_modules/pkg/index.js'),
      '#6984: EXCLUDED still applies to the untracked half -- an un-ignored dependency tree cannot turn this red',
    );
    //
    // Reverse -- and the direction is the ordinary one: restore the pre-#6984
    // enumeration and the specimen is not in the scan set at all, so the gate was
    // green on it for a reason unrelated to its bytes. Stated as the enumeration
    // fact rather than as a re-run, because that IS the change: same classifier,
    // same byte table, different list of paths.
    const indexOnlyEnumeration = execFileSync('git', ['ls-files', '-z'], { cwd: dir, encoding: 'utf8' })
      // Split on the NUL delimiter built from its byte value: this file is in
      // its own scan surface, so the delimiter is never written as a literal.
      .split(String.fromCharCode(0))
      .filter(Boolean);
    assert(
      !indexOnlyEnumeration.includes('packages/cli/test/new-case.test.ts'),
      '#6984 reverse: the specimen is absent from the index-only enumeration, so the pre-#6984 gate never looked at it',
    );
    // ...and it was on disk the whole time. Without this the assertion above
    // would also pass for a file that simply did not exist.
    assert(
      findControlBytes(readFileSync(join(dir, 'packages/cli/test/new-case.test.ts'))).length === 1,
      '#6984 reverse: the byte was on disk all along -- only the enumeration changed',
    );
    //
    // The green states its own scope. This is the half of #6984 that is not
    // about coverage at all: a summary naming only what it scanned, with no
    // count for what it did not, is what made the pre-fix green read as "this
    // tree is clean".
    // Exactly the three untracked-and-not-ignored fixtures reach the scan set:
    // the two test files plus the .gitignore itself. The ignored one and the
    // EXCLUDED one are absent, so this count is also the pin on both exclusions.
    assert(
      result.untracked === 3 && result.scannedUntracked === 3,
      `#6984: 3 untracked paths enumerated and all 3 scanned as text, got ${result.untracked}/${result.scannedUntracked}`,
    );
    assert(
      result.untrackedFiles.slice().sort().join() ===
        ['.gitignore', 'packages/cli/test/new-case-fixed.test.ts', 'packages/cli/test/new-case.test.ts'].join(),
      `#6984: the untracked half is reported by path, got ${result.untrackedFiles}`,
    );
    assert(
      result.scanned === result.scannedTracked + result.scannedUntracked,
      'the halves add up to the total scanned',
    );
    const summaryLine = summarise(result);
    assert(
      summaryLine.includes(`${result.scannedTracked} tracked, ${result.scannedUntracked} untracked-not-ignored`),
      `#6984: the summary states BOTH halves, got "${summaryLine}"`,
    );
    // The zero case is the one that matters most, because it is what CI prints:
    // it must still name the untracked half rather than fall silent, or a green
    // over a fully-tracked tree and the pre-#6984 green become the same sentence.
    assert(
      summarise({ scanned: 7, scannedTracked: 7, scannedUntracked: 0, skipped: { binary: [], 'wide-encoding': [], unreadable: [] } }) ===
        'scanned 7 text file(s) -- 7 tracked, 0 untracked-not-ignored',
      'the summary names the untracked half even when it is empty',
    );

    // Which byte it was is reported, so the prescription can name the escape.
    assert(
      flagged.get('packages/x/src/key.ts')?.bytes.join() === '1',
      `the offending byte value is reported, got ${flagged.get('packages/x/src/key.ts')?.bytes}`,
    );
    assert(
      flagged.get('docs/range.md')?.bytes.join() === [0x0b, 0x0c, 0x1f].join(),
      `all distinct offending bytes are reported, got ${flagged.get('docs/range.md')?.bytes}`,
    );
    assert(escapeFor(0x01) === '\\u0001' && escapeFor(0x00) === '\\u0000', 'the prescribed escape is per-byte');
    assert(hex(0x0b) === '0x0b', 'the reported hex is two-digit');

    assert(!flagged.has('assets/pic.png'), 'a real binary asset must not be flagged');
    assert(!flagged.has('assets/icon.ico'), 'an ICO must not be flagged');
    assert(skipped.binary.length === 2, `exactly the 2 binary assets skip, got ${skipped.binary.length}`);
    assert(skipped['wide-encoding'].includes('docs/utf16.txt'), 'UTF-16 text is skipped as a wide encoding');
    assert(skipped.unreadable.includes('dangling'), 'a dangling symlink is skipped, not a crash');
    assert(!flagged.has('packages/x/dist/bundle.js'), 'dist/ stays excluded');
    assert(
      ['docs/clean.md', 'docs/long.md', 'src/clean.ts', '.github/workflows/ci.yml'].every((f) => !flagged.has(f)),
      'clean text of every shape stays green',
    );
    // #5460 inverted this one on purpose. It used to read "tab / CR / LF / DEL
    // are outside the scanned set and stay green" -- DEL was pinned OUT
    // deliberately, to record that the C0 boundary was chosen rather than
    // overlooked. The choice was re-made in #5460 and went the other way, so the
    // assertion states the new boundary and the DEL half is asserted red above.
    assert(!flagged.has('src/whitespace.ts'), 'tab / CR / LF are outside the scanned set and stay green');
    assert(
      !skipped.binary.includes('docs/long.md'),
      'a long multi-byte UTF-8 file must not be misread as binary (leading-window truncation)',
    );
    assert(scanned >= 14, `every text fixture is actually scanned, got ${scanned}`);

    // The location report points at the byte, not at byte 0.
    const skill = flagged.get('.claude/skills/demo/SKILL.md');
    assert(skill && skill.offset > 8000, "a NUL past git's 8000-byte sniff window is still located");
    assert(
      skill && skill.line === 4 && skill.column === 6,
      `line:col points at the byte, got ${skill?.line}:${skill?.column}`,
    );

    // classify() is the criterion; state it directly too.
    assert(classify(Buffer.concat([Buffer.from('plain text'), NUL])) === 'text', 'a NUL alone never makes a file binary');
    assert(classify(Buffer.concat([Buffer.from('plain text'), SOH])) === 'text', 'a 0x01 alone never makes a file binary');
    assert(classify(Buffer.concat([Buffer.from('plain text'), DEL])) === 'text', 'a 0x7f alone never makes a file binary');
    assert(classify(Buffer.from([0xc0, 0x80, 0x41, 0xf8])) === 'binary', 'invalid UTF-8 is binary');
    assert(classify(Buffer.from('')) === 'text', 'an empty file is text');
    assert(findControlBytes(Buffer.from('a\tb\r\nc\n')).length === 0, 'tab / CR / LF are not control-byte hits');
    assert(findControlBytes(Buffer.concat([Buffer.from('a'), DEL])).join() === '1', 'DEL is a control-byte hit (#5460)');
    // The set is exactly ASCII's controls minus the three text-structure ones --
    // stated as a whole so a future edit to the table has to face the boundary
    // rather than nudge it. 0x20 (space) and 0x7e (~) bracket the printable run.
    const scannedSet = [...Array(256).keys()].filter((b) => IS_SCANNED[b] === 1);
    const expectedSet = [...Array(0x20).keys()].filter((b) => b !== 0x09 && b !== 0x0a && b !== 0x0d).concat(0x7f);
    assert(scannedSet.join() === expectedSet.join(), `the scanned set is C0-minus-tab/LF/CR plus DEL, got ${scannedSet.length} bytes`);
    assert(IS_SCANNED[0x20] === 0 && IS_SCANNED[0x7e] === 0, 'printable ASCII is never scanned');

    // The emitted character class is what the reference check below compares
    // against, so it has to be right as a REGEX and not merely stable as a
    // string: compiled and run over all 256 byte values, it must select exactly
    // the table's set. Without this, a broken emitter would happily hold every
    // reference file byte-equal to a class that scans the wrong bytes.
    const emittedClass = new RegExp(scannedCharClass());
    const emittedSet = [...Array(256).keys()].filter((b) => emittedClass.test(String.fromCharCode(b)));
    assert(
      emittedSet.join() === scannedSet.join(),
      `the emitted class ${scannedCharClass()} matches exactly the scanned set, got ${emittedSet.length} of ${scannedSet.length} bytes`,
    );

    // ── #6984, the CI direction: on a fully tracked tree the widening is a no-op
    //
    // A workflow checks out a commit, so every path in CI's tree is tracked and
    // the untracked half is empty -- which means #6984 cannot change any CI
    // verdict. That is a claim about behaviour, so it is PROVED here rather than
    // asserted in a comment: stage the fixtures written above and re-scan.
    //
    // `git add -A` WITHOUT `-f`, unlike the first staging: `-f` would force-add
    // the deliberately-ignored `local-junk/scratch.md`, which would make it
    // tracked, scanned and flagged -- a real behaviour, but not the one under
    // test here, and it would turn the offender-set comparison below red for a
    // reason that has nothing to do with the enumeration widening.
    execFileSync('git', ['add', '-A'], { cwd: dir });
    const staged = scan(dir);
    assert(staged.untracked === 0, `#6984: a fully tracked tree has an empty untracked half, got ${staged.untracked}`);
    assert(
      staged.offenders.map((o) => o.file).sort().join() === offenders.map((o) => o.file).sort().join(),
      '#6984: staging changes no verdict -- the same files are flagged either way, so CI sees exactly what it saw before',
    );
    assert(
      staged.offenders.every((o) => o.untracked === false),
      '#6984: nothing is reported as untracked once everything is staged',
    );
    assert(
      summarise(staged).includes('0 untracked-not-ignored'),
      `#6984: CI's own summary line still names the untracked half, got "${summarise(staged)}"`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // ── #5646: the class is transcribed nowhere ────────────────────────────────
  //
  // Not a temp-repo fixture: the subject is the checked-in text of this repo's
  // own instruction files, which is exactly what drifted in #5577.
  checkCharClassReferences(scriptRepoRoot(), assert);

  if (failures.length) {
    console.error(`✗ check-nul-bytes --self-test -- ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  • ${f}`);
    process.exit(1);
  }
  console.log(`✓ check-nul-bytes --self-test: ${checked} assertions over a temp git repo (real scan() path)`);
}

// Exports bindings, so an import for those exports alone must run nothing (#10667).
const invokedDirectly = isEntrypoint(import.meta.url);

if (!invokedDirectly) {
  // imported as a module — expose the exports and do nothing else
} else if (process.argv.includes('--self-test')) {
  selfTest();
} else if (process.argv.includes('--list')) {
  const result = scan(repoRoot());
  for (const f of result.skipped.binary) console.log(`binary         ${f}`);
  for (const f of result.skipped['wide-encoding']) console.log(`wide-encoding  ${f}`);
  for (const f of result.skipped.unreadable) console.log(`non-regular    ${f}`);
  // The untracked half, named file by file. These are the paths #6984 added to
  // the set, and the ones a reader cannot reconstruct from the index.
  for (const f of result.untrackedFiles) console.log(`untracked      ${f}`);
  console.log(`\n${summarise(result)} (of ${result.tracked} tracked + ${result.untracked} untracked path(s) enumerated)`);
} else {
  main();
}
