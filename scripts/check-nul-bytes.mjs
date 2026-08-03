#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-nul-bytes -- rejects raw NUL (0x00) bytes in every tracked TEXT file.
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
//   node scripts/check-nul-bytes.mjs
//   node scripts/check-nul-bytes.mjs --self-test   # verify the checker itself
//   node scripts/check-nul-bytes.mjs --list        # what got scanned / skipped
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
//   3. Its bytes, with NULs removed, are not valid UTF-8.
//
// Rule 3 is the whole criterion, and two properties of it matter:
//
//   - NUL is stripped BEFORE the judgement, so a raw NUL can never be its own
//     alibi. "The file has a NUL, therefore it is binary, therefore we do not
//     check it for NULs" is exactly the circularity git falls into, and it is
//     what this guard exists to break.
//   - The decode reads the ENTIRE file, not a leading window. git's 8000-byte
//     sniff is the documented blind spot above (protocol.ts hid a NUL at byte
//     147230); reusing it here would reproduce it.
//
// A new text file with an extension nobody has seen before therefore gets
// scanned by default -- it decodes as UTF-8, so it is text. Only real binary
// assets (the repo's 4 PNGs and 1 ICO today) fail rule 3 and drop out.
//
// There is intentionally NO per-file exemption hatch. No tracked file in this
// repo carries a legitimate raw NUL; if one ever genuinely needs to, that is a
// decision to take in the open, not a line to add to a skip-list.

import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// The escape sequence authors should write instead, and the in-repo precedent.
// Written as an escape, never as the byte -- this file is itself in scope, so a
// literal NUL here would make the guard fail on itself.
const ESCAPE = '\\u0000';
const CONVENTION = 'packages/rest/src/rest-server.ts:1065';

// Belt-and-braces: git already ignores these, so nothing matches today. Kept so
// a future vendored or committed artifact directory cannot quietly turn this red
// -- a NUL in a build artifact is that toolchain's business, not ours.
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

/**
 * Text or binary, judged by content alone.
 *
 * @returns {'text' | 'binary' | 'wide-encoding'}
 */
export function classify(buf) {
  if (hasWideBom(buf)) return 'wide-encoding';
  // Strip NULs first: the byte under investigation must never be the reason we
  // decline to investigate. Multi-byte UTF-8 sequences never contain 0x00, so
  // removing NULs cannot break an otherwise-valid sequence.
  const probe = buf.includes(0) ? buf.filter((b) => b !== 0) : buf;
  try {
    new TextDecoder('utf8', { fatal: true }).decode(probe);
    return 'text';
  } catch {
    return 'binary';
  }
}

/**
 * Byte offset -> line:column, so the author can jump straight to a byte their
 * editor renders as nothing and grep refuses to look for.
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
    const kind = classify(buf);
    if (kind !== 'text') {
      skipped[kind].push(file);
      continue;
    }
    scanned++;

    const offsets = [];
    for (let i = buf.indexOf(0); i !== -1; i = buf.indexOf(0, i + 1)) offsets.push(i);
    if (offsets.length === 0) continue;
    const { line, column } = locate(buf, offsets[0]);
    offenders.push({ file, line, column, offset: offsets[0], count: offsets.length });
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
    console.log(`check-nul-bytes: OK (${summarise(result)}; no raw NUL bytes).`);
    process.exit(0);
  }

  const plural = offenders.length === 1 ? 'file contains' : 'files contain';
  console.error(`check-nul-bytes: ${offenders.length} ${plural} a raw NUL byte (0x00)\n`);
  for (const o of offenders) {
    const times = o.count === 1 ? '1 occurrence' : `${o.count} occurrences`;
    console.error(`  • ${o.file}:${o.line}:${o.column} -- ${times}, first at byte offset ${o.offset}`);
  }
  console.error(`
A raw NUL makes grep/ripgrep treat the entire file as binary and silently return
ZERO matches, so the file drops out of code search and out of every grep-based
lint. git will not warn you: it only scans the first 8000 bytes to decide
binary-ness, so a NUL past that offset keeps diffing as ordinary text.

That harm is grep's behaviour, not any one language's, so this guard covers every
tracked TEXT file -- markdown and agent instructions under .claude/ included
(#4890), not just JS/TS sources.

Write the escape sequence ${ESCAPE} instead of the byte. The resulting string is
byte-identical at runtime, so behaviour does not change. Existing convention --
${CONVENTION}:

    const key = environmentId ?? '${ESCAPE}default';

Prefer ${ESCAPE} over \\0, which becomes a legacy octal escape error if it is
ever followed by a digit. In prose (markdown, agent instructions), write the
words "NUL byte" or the escape text -- never the byte itself.`);
  process.exit(1);
}

// ── Self-test ────────────────────────────────────────────────────────────────
//
// Builds a throwaway git repo in a temp dir and runs `scan()` -- the SAME
// function main() calls -- over it. Every NUL below is produced at runtime from
// a byte value; none is written as a literal, because this file is in its own
// scope and a literal would make the guard fail on itself.

function selfTest() {
  const failures = [];
  const assert = (cond, msg) => {
    if (!cond) failures.push(msg);
  };

  const NUL = Buffer.from([0x00]);
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
    // Real binary assets: a PNG header and an ICO header, both carrying NULs.
    write(
      'assets/pic.png',
      Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), NUL, Buffer.from([0xff, 0xd8, 0xc0, 0x80])]),
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
    const flagged = new Set(offenders.map((o) => o.file));

    assert(flagged.has('.claude/skills/demo/SKILL.md'), '#4890: markdown under .claude/ must be flagged');
    assert(flagged.has('packages/x/src/protocol.ts'), 'the original JS/TS case must still be flagged');
    assert(flagged.has('config/weird.frobnicate'), 'an unknown extension holding text must still be scanned');

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
    assert(
      !skipped.binary.includes('docs/long.md'),
      'a long multi-byte UTF-8 file must not be misread as binary (leading-window truncation)',
    );
    assert(scanned >= 7, `every text fixture is actually scanned, got ${scanned}`);

    // The location report points at the NUL, not at byte 0.
    const skill = offenders.find((o) => o.file === '.claude/skills/demo/SKILL.md');
    assert(skill && skill.offset > 8000, "a NUL past git's 8000-byte sniff window is still located");
    assert(
      skill && skill.line === 4 && skill.column === 6,
      `line:col points at the NUL, got ${skill?.line}:${skill?.column}`,
    );

    // classify() is the criterion; state it directly too.
    assert(classify(Buffer.concat([Buffer.from('plain text'), NUL])) === 'text', 'a NUL alone never makes a file binary');
    assert(classify(Buffer.from([0xc0, 0x80, 0x41, 0xf8])) === 'binary', 'invalid UTF-8 is binary');
    assert(classify(Buffer.from('')) === 'text', 'an empty file is text');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`✗ check-nul-bytes --self-test -- ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  • ${f}`);
    process.exit(1);
  }
  console.log('✓ check-nul-bytes --self-test: 16 assertions over a temp git repo (real scan() path)');
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
