#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-nul-bytes -- rejects raw C0 control bytes in every tracked TEXT file.
//
// Scanned set (#5157): 0x00-0x08, 0x0b, 0x0c, 0x0e-0x1f -- the whole C0 control
// range except the three bytes that ARE ordinary text structure: tab (0x09),
// LF (0x0a), CR (0x0d). Equivalently `[\x00-\x08\x0b\x0c\x0e-\x1f]`, the exact
// pattern #4890's own manual sweep used before this gate narrowed to NUL.
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
// So the scope is drawn by CARRIER (every tracked text file) rather than by USE
// (source code). An extension allow-list would only move the same question --
// "why exactly these files?" -- one directory further along, to be rediscovered
// by the next `.claude/`.
//
// ## What counts as binary
//
// Deliberately NOT an extension list (that is the defect above, relocated).
// A tracked blob is scanned unless one of these is true, in order:
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
//     break. Widening cannot go wrong in the other direction either: every
//     scanned byte is <= 0x1f, while valid UTF-8 multi-byte sequences are built
//     exclusively from bytes >= 0x80, so removing them can never break an
//     otherwise-valid sequence.
//   - The decode reads the ENTIRE file, not a leading window. git's 8000-byte
//     sniff is the documented blind spot above (protocol.ts hid a NUL at byte
//     147230); reusing it here would reproduce it.
//
// A new text file with an extension nobody has seen before therefore gets
// scanned by default -- it decodes as UTF-8, so it is text. Only real binary
// assets (the repo's 4 PNGs and 1 ICO today) fail rule 3 and drop out. Measured
// over all 5448 tracked paths when #5157 landed: the widened stripping moves
// exactly zero files between text and binary, so it buys the anti-circularity
// property above at no cost in false positives.
//
// There is intentionally NO per-file exemption hatch. No tracked file in this
// repo carries a legitimate raw control byte; if one ever genuinely needs to,
// that is a decision to take in the open, not a line to add to a skip-list.

import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * The scanned set as a 256-entry lookup: every C0 control except tab, LF and CR.
 * A table rather than a regex, because the scan is one pass over BYTES and must
 * never have to decode the file first -- a file this gate is interested in is
 * precisely one that may not decode cleanly.
 */
const IS_SCANNED = new Uint8Array(256);
for (let b = 0x00; b <= 0x1f; b++) IS_SCANNED[b] = 1;
IS_SCANNED[0x09] = 0; // tab -- ordinary text structure
IS_SCANNED[0x0a] = 0; // LF
IS_SCANNED[0x0d] = 0; // CR

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

/**
 * The one scan. `main()` and `--self-test` both go through here, so the
 * self-test exercises the real code path rather than a parallel imitation.
 */
export function scan(root) {
  const files = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    // -z: NUL-delimited output, the one context where the byte is load-bearing
    // rather than a bug. Note the escape form -- this file must pass its own check.
    .split('\u0000')
    .filter(Boolean)
    .filter((f) => !EXCLUDED.test(f));

  const offenders = [];
  const skipped = { binary: [], 'wide-encoding': [], unreadable: [] };
  let scanned = 0;

  for (const file of files) {
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
    scanned++;

    if (offsets.length === 0) continue;
    const { line, column } = locate(buf, offsets[0]);
    const bytes = [...new Set(offsets.map((o) => buf[o]))].sort((a, b) => a - b);
    offenders.push({ file, line, column, offset: offsets[0], count: offsets.length, bytes });
  }

  return { offenders, scanned, skipped, tracked: files.length };
}

function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

function summarise({ scanned, skipped }) {
  const parts = [];
  if (skipped.binary.length) parts.push(`${skipped.binary.length} binary`);
  if (skipped['wide-encoding'].length) parts.push(`${skipped['wide-encoding'].length} UTF-16/32`);
  if (skipped.unreadable.length) parts.push(`${skipped.unreadable.length} non-regular`);
  const tail = parts.length ? `; skipped ${parts.join(', ')}` : '';
  return `scanned ${scanned} tracked text file(s)${tail}`;
}

function main() {
  const result = scan(repoRoot());
  const { offenders } = result;

  if (offenders.length === 0) {
    console.log(`check-nul-bytes: OK (${summarise(result)}; no raw C0 control bytes).`);
    process.exit(0);
  }

  const plural = offenders.length === 1 ? 'file contains' : 'files contain';
  console.error(`check-nul-bytes: ${offenders.length} ${plural} a raw C0 control byte\n`);
  for (const o of offenders) {
    const times = o.count === 1 ? '1 occurrence' : `${o.count} occurrences`;
    const which = o.bytes.map(hex).join(', ');
    console.error(`  • ${o.file}:${o.line}:${o.column} -- ${times} of ${which}, first at byte offset ${o.offset}`);
  }

  const seen = [...new Set(offenders.flatMap((o) => o.bytes))].sort((a, b) => a - b);
  console.error('\nWrite the escape sequence instead of the byte:\n');
  for (const byteValue of seen) console.error(`    ${hex(byteValue)}  ->  ${escapeFor(byteValue)}`);

  console.error(`
The resulting string is byte-identical at runtime, so behaviour does not change.

Why every C0 control byte and not only NUL (#5157):

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
    #4890, PR #5140). That slip does not pick byte values, so neither does this
    gate.

That harm is not any one language's, so this guard covers every tracked TEXT
file -- markdown and agent instructions under .claude/ included (#4890), not
just JS/TS sources.

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
  const dir = mkdtempSync(join(tmpdir(), 'check-nul-bytes-selftest-'));
  const write = (rel, contents) => {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  };

  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });

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
    // CRLF endings included. DEL (0x7f) rides along: it is not a C0 control, so
    // it is deliberately outside this gate's set and must not be flagged either.
    write(
      'src/whitespace.ts',
      Buffer.concat([Buffer.from('const a\t= 1;\r\nconst b = 2;\r\n'), byte(0x7f), Buffer.from('\n')]),
    );
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

    const { offenders, scanned, skipped } = scan(dir);
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
    assert(!flagged.has('src/whitespace.ts'), 'tab / CR / LF / DEL are outside the scanned set and stay green');
    assert(
      !skipped.binary.includes('docs/long.md'),
      'a long multi-byte UTF-8 file must not be misread as binary (leading-window truncation)',
    );
    assert(scanned >= 11, `every text fixture is actually scanned, got ${scanned}`);

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
    assert(classify(Buffer.from([0xc0, 0x80, 0x41, 0xf8])) === 'binary', 'invalid UTF-8 is binary');
    assert(classify(Buffer.from('')) === 'text', 'an empty file is text');
    assert(findControlBytes(Buffer.from('a\tb\r\nc\n')).length === 0, 'tab / CR / LF are not control-byte hits');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`✗ check-nul-bytes --self-test -- ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  • ${f}`);
    process.exit(1);
  }
  console.log(`✓ check-nul-bytes --self-test: ${checked} assertions over a temp git repo (real scan() path)`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else if (process.argv.includes('--list')) {
  const result = scan(repoRoot());
  for (const f of result.skipped.binary) console.log(`binary         ${f}`);
  for (const f of result.skipped['wide-encoding']) console.log(`wide-encoding  ${f}`);
  for (const f of result.skipped.unreadable) console.log(`non-regular    ${f}`);
  console.log(`\n${summarise(result)} (of ${result.tracked} tracked path(s))`);
} else {
  main();
}
