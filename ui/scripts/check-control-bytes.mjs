#!/usr/bin/env node
/**
 * Rejects raw control characters in every tracked TEXT file.
 *
 * Run:  node scripts/check-control-bytes.mjs
 *       node scripts/check-control-bytes.mjs --list   # what got scanned / skipped
 * Exit: 0 = OK, 1 = a control byte is present, or the baseline below is stale
 *
 * ## Why this exists
 *
 * objectui#3425 (objectstack#5425): two raw U+0000 bytes sat in
 * `packages/app-shell/src/views/metadata-admin/inspectors/useDatasetFields.ts`
 * as a `join`/`split` separator. One of them makes grep and ripgrep classify the
 * WHOLE file as binary, so a content search returns nothing at all:
 *
 *     grep -rn "includeKey" packages/app-shell/src/.../inspectors/
 *     => grep: .../useDatasetFields.ts: binary file matches   (zero lines)
 *
 * Not a cosmetic problem. Every agent and every human who searches this repo by
 * content is blind to that file, and so is every grep-based lint. git will not
 * warn either: it decides binary-ness from the first 8000 bytes only, so a
 * control byte past that offset keeps diffing as ordinary text.
 *
 * objectstack has carried the equivalent guard since its own #3127/#4890; this
 * repo had nothing, which is why four more files accumulated the same defect
 * before anyone looked (objectstack#5450).
 *
 * ## Two harms, not one — and they are not the same byte set
 *
 * This distinction is measured, not assumed. Writing one control byte into a
 * fixture file and grepping for a literal on a different line, on GNU grep 3.11
 * and ripgrep 14:
 *
 *   - U+0000 is the ONLY byte that triggers binary classification. Both tools
 *     refuse to print the matching line.
 *   - U+0001, U+0002, U+0007, U+0008, U+000B, U+000C, U+000E, U+001A, U+001B,
 *     U+001F and U+007F all print the matching line normally.
 *
 * So the two classes fail for different reasons, and the report says which:
 *
 *   - U+0000 -> a code-search outage. The file drops out of grep, ripgrep, and
 *     every tool built on them.
 *   - every other control byte -> not a search outage, but an INVISIBLE byte in
 *     a string literal. No reviewer can see it, no diff renders it, and it is
 *     indistinguishable from its neighbours. It is never intentional in source.
 *
 * Covering only U+0000 would be the documented mistake: objectstack#5140 shipped
 * a NUL *and* a U+0001 fourteen bytes away, and the NUL-only scanner reported OK
 * on the second one (objectstack#5157). Hence the wider set — with an honest
 * message per class rather than one overstated claim for both.
 *
 * ## Scope: the carrier, not the use (objectstack#4890)
 *
 * Deliberately NOT an extension allow-list. The harm named above is a property
 * of *grep*, not of JavaScript: it lands identically on a markdown file, a YAML
 * workflow, or an extension nobody has invented yet. objectstack's guard began
 * as a JS/TS scan and the hole showed up exactly where an allow-list always puts
 * it — the PR *writing the rule* "never emit a raw NUL" emitted one into a
 * `.claude/` skill file, and the check reported OK. An agent then cannot grep
 * the instructions it is supposed to follow, with no signal that anything is
 * missing.
 *
 * A tracked blob is therefore scanned unless, in order:
 *
 *   1. it is not a regular file (symlink, submodule gitlink) or is unreadable;
 *   2. it starts with a UTF-16/UTF-32 byte-order mark — those encodings are text
 *      whose NULs are STRUCTURAL, so this guard has nothing to say about them;
 *   3. its bytes, with the scanned control bytes removed, are not valid UTF-8.
 *
 * Rule 3 is the whole criterion. The control bytes are stripped BEFORE the
 * judgement so that a control byte can never be its own alibi — "the file has a
 * NUL, therefore it is binary, therefore we do not check it for NULs" is exactly
 * the circularity git falls into, and breaking it is the point. The decode reads
 * the ENTIRE file, never a leading window, for the 8000-byte reason above.
 *
 * ## Byte discipline inside this file
 *
 * This file is in its own scope, so it must contain no control byte itself.
 * Every one below is produced at runtime from a NUMBER. None is written as a
 * literal, and none is written as a backslash escape either: a backslash escape
 * typed into an agent's tool payload gets decoded into the real byte before it
 * ever reaches disk, which is how two of the five incidents in this family
 * happened *while their author was writing the rule* (objectstack#4763, #4890).
 * Prose here names bytes in `U+XXXX` form for the same reason.
 */

import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

/**
 * Control characters that are never legitimate in a text file: the C0 range
 * minus the three that are structural in text (U+0009 tab, U+000A line feed,
 * U+000D carriage return), plus U+007F delete.
 *
 * Built from numbers on purpose — see "Byte discipline" above.
 */
export const SCANNED_BYTES = new Set([
  ...Array.from({ length: 0x20 }, (_, i) => i).filter((b) => b !== 0x09 && b !== 0x0a && b !== 0x0d),
  0x7f,
]);

/** The one byte that makes grep/ripgrep give up on the whole file. */
const NUL = 0x00;

/** `U+0000` etc, for messages. Never the byte, never a backslash escape. */
function nameOf(byte) {
  return `U+${byte.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * The six-character escape authors should write instead, assembled from a char
 * code so that this source file contains no backslash-u sequence to materialize.
 */
const ESCAPE_HINT = `${String.fromCharCode(0x5c)}u0000`;

/**
 * Belt-and-braces: git already ignores these, so nothing matches today. Kept so
 * a future vendored or committed artifact directory cannot quietly turn this
 * red — a control byte in a build artifact is that toolchain's business.
 */
const EXCLUDED = /(^|\/)(node_modules|dist|build|\.next|\.turbo|\.wt-[^/]*)\//;

/** UTF-16/UTF-32 byte-order marks, where NUL bytes are structural, not a bug. */
const WIDE_BOMS = [
  [0x00, 0x00, 0xfe, 0xff], // UTF-32BE
  [0xff, 0xfe, 0x00, 0x00], // UTF-32LE
  [0xfe, 0xff], // UTF-16BE
  [0xff, 0xfe], // UTF-16LE
];

/**
 * `path -> { bytes, issue }` — files that ALREADY carry a control byte on the
 * day this guard landed, so it could be switched on as a ratchet instead of
 * waiting for unrelated packages to be fixed first.
 *
 * This is a BASELINE, not an escape hatch. It cannot rot, because `scan()`
 * fails on an entry whose file is gone or has been cleaned — so fixing a file
 * without deleting its entry here is as red as adding a new offender. Adding an
 * entry is a deliberate admission that a file ships an unreadable byte: do it
 * with an issue number, and treat it as temporary.
 *
 * objectui's own `check-lint-coverage.mjs` / `check-type-check-coverage.mjs`
 * use the same shape (`DEBT`, known gaps with issue numbers). objectstack's
 * `check-nul-bytes.mjs` deliberately has no such map — it was introduced into a
 * tree that was already clean, which is a luxury this repo does not have today.
 * The map is expected to reach empty and stay there.
 */
export const KNOWN_OFFENDERS = new Map([
  // Empty, and expected to stay that way. The four entries this map shipped
  // with (two in `@object-ui/core`, one in `@object-ui/fields`, one in
  // `@object-ui/plugin-dashboard`) were cleaned by objectstack#5450 and deleted
  // in the same PR, because `scan()` reports a stale entry as loudly as a new
  // offender. Add one back only with an issue number, and only as debt.
]);

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
  // Strip the bytes under investigation first: none of them can appear inside a
  // multi-byte UTF-8 sequence (lead bytes are 0xC2+, continuations 0x80-0xBF),
  // so removing them cannot break an otherwise-valid sequence.
  const dirty = buf.some((b) => SCANNED_BYTES.has(b));
  const probe = dirty ? buf.filter((b) => !SCANNED_BYTES.has(b)) : buf;
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
export function locate(buf, offset) {
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
 * The one scan. `main()`, `--list` and the test suite all go through here, so
 * the tests exercise the real code path rather than a parallel imitation.
 *
 * @param root       repository root to scan
 * @param baseline   `path -> { bytes, issue }` map of pre-existing offenders
 */
export function scan(root, baseline = KNOWN_OFFENDERS) {
  const files = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  })
    // `-z` gives NUL-delimited output: the one context where this byte is
    // load-bearing rather than a bug. Split on the number, not on a literal.
    .toString('utf8')
    .split(String.fromCharCode(NUL))
    .filter(Boolean)
    .filter((f) => !EXCLUDED.test(f));

  const offenders = [];
  const baselined = [];
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

    /** @type {{ byte: number, offset: number }[]} */
    const hits = [];
    for (let i = 0; i < buf.length; i++) {
      if (SCANNED_BYTES.has(buf[i])) hits.push({ byte: buf[i], offset: i });
    }
    if (hits.length === 0) continue;

    const bytes = [...new Set(hits.map((h) => h.byte))].sort((a, b) => a - b);
    const first = hits[0];
    const { line, column } = locate(buf, first.offset);
    const record = { file, bytes, count: hits.length, line, column, offset: first.offset };

    const allowed = baseline.get(file);
    // A baseline entry covers a file only for the byte values it declares. A
    // file that gains a NEW kind of control byte is a new defect, not covered
    // debt — otherwise one entry silently licenses everything else in the file.
    if (allowed && bytes.every((b) => allowed.bytes.includes(b))) {
      baselined.push({ ...record, issue: allowed.issue });
      continue;
    }
    offenders.push(record);
  }

  // Stale baseline entries: the file was cleaned (or deleted) but its entry
  // stayed. Left unchecked, the map degrades into a permanent skip-list that
  // nobody dares delete from because nobody knows which lines still apply.
  const stillDirty = new Set(baselined.map((b) => b.file));
  const stale = [...baseline.keys()].filter((f) => !stillDirty.has(f));

  return { offenders, baselined, stale, scanned, skipped, tracked: files.length };
}

function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

function summarise({ scanned, skipped }) {
  const parts = [];
  if (skipped.binary.length) parts.push(`${skipped.binary.length} binary`);
  if (skipped['wide-encoding'].length) parts.push(`${skipped['wide-encoding'].length} UTF-16/32`);
  if (skipped.unreadable.length) parts.push(`${skipped.unreadable.length} non-regular`);
  const tail = parts.length ? `; skipped ${parts.join(', ')}` : '';
  return `scanned ${scanned} tracked text file(s)${tail}`;
}

function describe(record) {
  const names = record.bytes.map(nameOf).join(', ');
  const times = record.count === 1 ? '1 occurrence' : `${record.count} occurrences`;
  return `${record.file}:${record.line}:${record.column} — ${names} (${times}, first at byte offset ${record.offset})`;
}

function main() {
  const result = scan(repoRoot());
  const { offenders, baselined, stale } = result;

  if (offenders.length === 0 && stale.length === 0) {
    const debt = baselined.length ? `; ${baselined.length} baselined, see objectstack#5450` : '';
    console.log(`✅  check-control-bytes: OK (${summarise(result)}${debt}).`);
    process.exit(0);
  }

  if (offenders.length > 0) {
    const plural = offenders.length === 1 ? 'file contains' : 'files contain';
    console.error(`❌  check-control-bytes: ${offenders.length} ${plural} a raw control character\n`);

    const blind = offenders.filter((o) => o.bytes.includes(NUL));
    const invisible = offenders.filter((o) => !o.bytes.includes(NUL));

    if (blind.length) {
      console.error(`  ${nameOf(NUL)} — INVISIBLE TO CODE SEARCH. grep and ripgrep classify the`);
      console.error('  entire file as binary and print no matching lines at all:\n');
      for (const o of blind) console.error(`    • ${describe(o)}`);
      console.error('');
    }
    if (invisible.length) {
      console.error('  Other control characters — these do NOT make grep give up (measured on');
      console.error('  GNU grep 3.11 and ripgrep 14), but they are invisible in every editor and');
      console.error('  every diff, so nobody can review what the literal actually contains:\n');
      for (const o of invisible) console.error(`    • ${describe(o)}`);
      console.error('');
    }

    console.error(`Write the escape sequence instead of the byte — ${ESCAPE_HINT} for ${nameOf(NUL)}.
The resulting string is byte-identical at runtime, so behaviour does not change.
Better still, if the byte was only ever "a character the data cannot contain"
(a join/split separator, a sentinel), say so in a way a reader can check: a
newline, a comma, or JSON.stringify — which needs no impossible character at all.

git will not catch this for you: it decides binary-ness from the first 8000
bytes only, so a control byte past that offset keeps diffing as ordinary text.

In prose (markdown, agent instructions, PR bodies) write ${nameOf(NUL)} or the words
"NUL byte" — never the byte, and never a bare backslash escape in a tool
payload, which gets decoded into the real byte before it reaches disk.`);
  }

  if (stale.length > 0) {
    console.error(`\n❌  check-control-bytes: ${stale.length} stale KNOWN_OFFENDERS entr(y/ies) in scripts/check-control-bytes.mjs:\n`);
    for (const f of stale) console.error(`    • ${f}`);
    console.error(`
These files are listed as pre-existing debt but are now clean (or gone). Delete
their entries from KNOWN_OFFENDERS — the baseline is a ratchet, and an entry
nobody removes is how a baseline turns into a permanent skip-list.`);
  }

  process.exit(1);
}

// Run only when invoked directly — the test suite imports `scan`/`classify`
// from here and must not trigger a repo scan (or a process.exit) on import.
// Same guard shape as scripts/check-changeset-no-major.mjs.
const invokedDirectly = isEntrypoint(import.meta.url);

if (invokedDirectly) {
  if (process.argv.includes('--list')) {
    const result = scan(repoRoot());
    for (const f of result.skipped.binary) console.log(`binary         ${f}`);
    for (const f of result.skipped['wide-encoding']) console.log(`wide-encoding  ${f}`);
    for (const f of result.skipped.unreadable) console.log(`non-regular    ${f}`);
    for (const b of result.baselined) console.log(`baselined      ${describe(b)}  [${b.issue}]`);
    console.log(`\n${summarise(result)} (of ${result.tracked} tracked path(s))`);
  } else {
    main();
  }
}
