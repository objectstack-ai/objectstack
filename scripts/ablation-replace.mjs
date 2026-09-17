#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ablation-replace -- perform an ablation mutation through an anchor that must
// HIT, and produce the on-disk evidence the caller would otherwise have to
// remember to add by hand.
//
//   node scripts/ablation-replace.mjs --file <path> --anchor <text> --replacement <text> -- <cmd...>
//   node scripts/ablation-replace.mjs --file <path> --anchor <text> --delete -- <cmd...>
//   node scripts/ablation-replace.mjs --file <path> --anchor <text> --replacement <text> --hold
//   node scripts/ablation-replace.mjs --restore --file <path>
//   node scripts/ablation-replace.mjs --self-test
//
// ## The failure this exists to stop
//
// An ablation's entire job is to prove an assertion is not vacuously true:
// break the thing, watch the test go red. Its verdict is therefore only as
// good as the mutation actually landing on disk. A mutation that silently does
// not land produces a GREEN run that reads exactly like "the mutation landed
// and the gate held" -- a false green, and one that points the wrong way:
// asked to prove a NEW gate can fail, "it did not fire" reads as evidence the
// GATE is broken, and the expensive outcome is a working gate weakened until
// it "fires".
//
// The `-i` family (`sed -i`, `perl -i`) has failed exactly that way in this
// repository twice, in two DIFFERENT modes, and neither was caught by an exit
// code:
//
//   2026-08-20   under `-0`, `$/` interpolated inside the replacement text and
//                became a NUL byte; the target script turned binary. Caught by
//                `grep` reporting "binary file matches" and by an on-disk count
//                coming back 0/0 instead of 0/1.
//   2026-09-14   `perl -i` swallowed its argument and wrote NOTHING. exit 0.
//                Caught by the marker count.
//
// Both were caught by evidence the dev added by hand. An evidence chain that
// depends on memory is one whose missed occasion nobody hears about. So this
// tool does not ask the caller to remember: the counts and the blob hashes are
// its OWN verdict, and a mutation that did not move the file is a non-zero
// exit here.
//
// ## Three structural properties, not three checks bolted on
//
// **1. The anchor and the replacement are LITERAL strings taken from argv.**
// There is no regex, no shell word-splitting and no variable interpolation
// anywhere in the substitution path -- which is the whole of the 2026-08-20
// failure, removed rather than detected. `$/` in a replacement is four
// characters here and cannot become anything else. (The byte guard below is
// the belt to that braces: a replacement carrying a control byte is refused
// outright.)
//
// **2. The anchor MUST hit, a declared number of times.** Zero hits refuses and
// exits non-zero; so does a count other than the declared one (default: exactly
// one). An anchor that matches seven places is not the ablation that was
// intended, and "it ran" is not evidence that it did. This is the shape the
// 2026-08-20 dev hand-wrote after the `perl` incident; it is here so the next
// one does not have to.
//
// **3. The write is verified against the DISK, never against an exit code.**
// After writing, the file is re-read and four independent facts are asserted:
// the anchor count fell by exactly the declared amount, the replacement count
// rose by exactly that amount (plant mode), the `git hash-object` blob CHANGED,
// and the file gained no control bytes. The 2026-09-14 failure -- wrote
// nothing, exit 0 -- dies on the third of those.
//
// ## Restore is proven too, and an empty hash reads as FAILURE
//
// Restoring is a normal, silent, exit-0 operation when it does nothing at all,
// so its exit code is not evidence either. The restore leg asserts, on the
// absolute path:
//
//   the file's blob hash == the path's blob hash at HEAD
//   `git diff HEAD -- <abs path>` prints nothing
//
// `git hash-object` prints an EMPTY string for a path it cannot resolve. That
// is not "nothing to compare" -- it is a failed measurement, and it is treated
// as FAILURE rather than as a match against another empty.
//
// Restore is spelled `git checkout HEAD -- <abs path>`, never a bare
// `git checkout -- <path>`: the bare form restores from the INDEX, which on a
// tree where the mutation was staged hands the mutation straight back, exit 0
// and no output.
//
// ### Scope of the restore proof: this PATH, not the whole tree
//
// Deliberately per-path, because a whole-tree proof already exists and is
// better at it: `scripts/ablation-dist-preflight.mjs` reads
// `git status --porcelain` over the entire tree precisely because a build run
// between mutate and restore writes committed artifacts BESIDE the file you
// chose, and every per-path proof calls that tree clean. The two compose:
// this tool proves the mutation and its restore on the path it owns; that one
// proves the ablation reached `dist/` and that the tree carries nothing else.
// ⛔ Neither is a substitute for the other.
//
// ## EXIT / INT / TERM, and the limit of what a process can promise
//
// The mutation is armed with a restore on `exit`, `SIGINT`, `SIGTERM` and an
// uncaught exception, against an ABSOLUTE path resolved once, up front, from
// `git rev-parse --show-toplevel`. A relative path in a restore handler is a
// trap that runs, exits 0 and restores nothing when the process has changed
// directory; the absolute form is the only one whose effect does not depend on
// where the handler happens to fire. The foreground ten-minute cap in this
// environment sends SIGTERM, and it can land mid-mutation.
//
// That promise has a boundary, and the boundary decides the modes:
//
//   WRAP (`-- <cmd...>`)  the default and the recommended form. The tool
//                         mutates, runs <cmd> as a child, and restores when
//                         that child is done -- or when the tool is killed
//                         while it waits. The mutation exists only for the
//                         lifetime of a process that is holding the trap.
//   HOLD (`--hold`)       the mutation is left on disk for a caller that will
//                         drive several commands itself. A process that has
//                         exited holds no trap, so the handler is DISARMED on
//                         a successful hold and the exact restore command is
//                         printed instead. Claiming otherwise would be the
//                         false promise this tool exists to refuse.
//
// ## This tool is ADOPTION-STYLE and is NOT a required path
//
// ⛔ Nothing in this repository requires an ablation to go through this script,
// no gate checks for it, and it is not wired into CI. New ablations are
// expected to use it; an existing one migrates when it is touched for other
// reasons. Making it mandatory would add a required gate -- a manual floor --
// and that is the maintainer's call, not this script's and not its caller's.
// ⛔ Do not mass-rewrite existing ablation scripts to route through it.
//
// ## Why this is not a `check:*` gate
//
// Same reason as `ablation-dist-preflight.mjs`: it judges, and creates, a
// deliberately mutated working tree. It can only be run by the agent
// performing the ablation, at the moment between "mutate" and "measure". CI
// has no ablation in flight and nothing to assert.

import { readFileSync, writeFileSync, existsSync, statSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { isEntrypoint } from './invoked-as.mjs';

const TOOL = 'ablation-replace';

// Exit codes are part of the contract a caller scripts against:
//   0  the leg succeeded and its evidence is printed
//   1  the leg RAN and its on-disk evidence refutes it (nothing landed, the
//      restore did not restore, a control byte appeared)
//   2  usage -- the invocation is malformed, nothing was read or written
//   3  ANCHOR MISS -- the anchor is absent, or hits a count other than declared.
//      Separated from 1 so a caller can tell "your anchor is stale" from
//      "the write did not land".
//   4  the restore leg could not be PROVEN. Reserved, and distinct from every
//      other code, because in WRAP mode the wrapped command's own status passes
//      through untouched -- a red child is the ablation's expected reading, not
//      this tool's failure -- so the tool's own failure needs a code no child
//      can accidentally mint.
export const EXIT = Object.freeze({ OK: 0, EVIDENCE: 1, USAGE: 2, ANCHOR: 3, RESTORE: 4 });

// Control bytes, minus TAB (0x09) and LF (0x0a), which are ordinary source
// text. CR (0x0d) is included: it is not ordinary in this repo's sources and a
// replacement that smuggles one in is a byte-level surprise of exactly the
// class the 2026-08-20 incident belongs to.
//
// Spelled as NUMERIC CODE POINTS and never as a character class, because a
// regex literal naming these bytes cannot be written safely here. Measured
// while writing this file: a literal spelled with backslash-u escapes was
// materialised by the editing tool into the RAW bytes, `grep` then reported
// this source file as binary, and `check:nul-bytes` would have refused the
// push -- the 2026-08-20 failure mode, reproduced inside the tool written to
// prevent it. The arithmetic form has no escape to materialise.

function controlByteReport(text) {
  const found = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c <= 0x08) || c === 0x0b || c === 0x0c || (c >= 0x0e && c <= 0x1f) || c === 0x7f) {
      found.push({ index: i, code: c });
      if (found.length >= 5) break;
    }
  }
  return found;
}

export function describeControlBytes(text) {
  return controlByteReport(text).map((f) => `offset ${f.index}: U+${f.code.toString(16).padStart(4, '0')}`);
}

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function gitQuiet(args, cwd) {
  try {
    return { ok: true, out: git(args, cwd) };
  } catch (e) {
    return { ok: false, out: '', err: String((e && e.stderr) || (e && e.message) || e) };
  }
}

export function repoRootOf(startDir) {
  const r = gitQuiet(['rev-parse', '--show-toplevel'], startDir);
  if (!r.ok) return null;
  const root = r.out.trim();
  return root.length > 0 ? root : null;
}

// `git hash-object` prints an empty string for a path it cannot resolve, and an
// empty string compares equal to another empty string. Every caller here must
// go through this, which returns null rather than '' so that a failed
// measurement can never be mistaken for a match.
export function blobHash(absPath, cwd) {
  if (!existsSync(absPath)) return null;
  const r = gitQuiet(['hash-object', '--', absPath], cwd);
  if (!r.ok) return null;
  const h = r.out.trim();
  return /^[0-9a-f]{40,64}$/.test(h) ? h : null;
}

export function headBlobHash(repoRoot, absPath) {
  const rel = relative(repoRoot, absPath);
  const r = gitQuiet(['rev-parse', `HEAD:${rel}`], repoRoot);
  if (!r.ok) return null;
  const h = r.out.trim();
  return /^[0-9a-f]{40,64}$/.test(h) ? h : null;
}

// Literal, non-overlapping occurrence count. Not a regex: the anchor is text.
export function countOccurrences(haystack, needle) {
  if (needle.length === 0) return 0;
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

export function replaceFirstN(haystack, needle, replacement, n) {
  let out = '';
  let rest = haystack;
  let done = 0;
  while (done < n) {
    const i = rest.indexOf(needle);
    if (i === -1) break;
    out += rest.slice(0, i) + replacement;
    rest = rest.slice(i + needle.length);
    done += 1;
  }
  return { text: out + rest, replaced: done };
}

// --- the pure verdicts, so the self-test can exercise them without a tree ---

export function mutateVerdict({ anchorBefore, anchorAfter, replBefore, replAfter, expect, isDelete, hashBefore, hashAfter, newControlBytes }) {
  if (hashBefore === null || hashAfter === null) {
    return { ok: false, code: EXIT.EVIDENCE, msg: 'a blob hash could not be measured (empty result) — that is a FAILED measurement, not a match' };
  }
  if (hashAfter === hashBefore) {
    return {
      ok: false,
      code: EXIT.EVIDENCE,
      msg: `NOTHING LANDED — the blob hash is unchanged (${hashBefore.slice(0, 12)}). The write reported success and the file did not move.`,
    };
  }
  if (newControlBytes.length > 0) {
    return { ok: false, code: EXIT.EVIDENCE, msg: `the write introduced control byte(s): ${newControlBytes.join(', ')}` };
  }
  if (anchorBefore - anchorAfter !== expect) {
    return {
      ok: false,
      code: EXIT.EVIDENCE,
      msg: `the anchor count moved ${anchorBefore} -> ${anchorAfter}, a drop of ${anchorBefore - anchorAfter}, not the declared ${expect}`,
    };
  }
  if (!isDelete && replAfter - replBefore !== expect) {
    return {
      ok: false,
      code: EXIT.EVIDENCE,
      msg: `the replacement count moved ${replBefore} -> ${replAfter}, a rise of ${replAfter - replBefore}, not the declared ${expect}`,
    };
  }
  return { ok: true, code: EXIT.OK, msg: `mutation landed: anchor ${anchorBefore} -> ${anchorAfter}, blob ${hashBefore.slice(0, 12)} -> ${hashAfter.slice(0, 12)}` };
}

export function anchorVerdict({ anchorBefore, expect }) {
  if (anchorBefore === 0) {
    return {
      ok: false,
      code: EXIT.ANCHOR,
      msg: 'ANCHOR MISS — the anchor does not occur in the file. Refusing to run: a substitution with nothing to substitute writes a file identical to the one it read, and every downstream reading of this ablation would be vacuous.',
    };
  }
  if (anchorBefore !== expect) {
    return {
      ok: false,
      code: EXIT.ANCHOR,
      msg: `ANCHOR AMBIGUOUS — the anchor occurs ${anchorBefore} times, not the declared ${expect}. Lengthen the anchor, or declare the count with --expect ${anchorBefore}.`,
    };
  }
  return { ok: true, code: EXIT.OK, msg: `anchor hits ${anchorBefore} time(s), as declared` };
}

export function restoreVerdict({ hashAfter, headHash, diffEmpty, diffReadable }) {
  if (headHash === null) {
    return { ok: false, code: EXIT.EVIDENCE, msg: 'the path has no readable blob at HEAD — an empty hash reads as FAILURE, never as a match' };
  }
  if (hashAfter === null) {
    return { ok: false, code: EXIT.EVIDENCE, msg: 'the restored file has no readable blob hash — an empty hash reads as FAILURE, never as a match' };
  }
  if (!diffReadable) {
    return { ok: false, code: EXIT.EVIDENCE, msg: 'git diff HEAD could not be read — a proof that cannot be taken is not a proof that passed' };
  }
  if (hashAfter !== headHash) {
    return { ok: false, code: EXIT.EVIDENCE, msg: `the restored blob ${hashAfter.slice(0, 12)} does not equal the HEAD blob ${headHash.slice(0, 12)}` };
  }
  if (!diffEmpty) {
    return { ok: false, code: EXIT.EVIDENCE, msg: 'the blob equals HEAD but `git diff HEAD` is not empty — the index and the tree disagree' };
  }
  return { ok: true, code: EXIT.OK, msg: `restored: blob == HEAD (${headHash.slice(0, 12)}) and \`git diff HEAD\` is empty` };
}

// --- I/O legs -------------------------------------------------------------

function say(line) {
  console.log(`${TOOL}: ${line}`);
}

function fail(msg, code) {
  console.error(`x ${TOOL}: ${msg}`);
  process.exit(code);
}

function usage(msg) {
  console.error(`${TOOL}: ${msg}\n`);
  console.error('  node scripts/ablation-replace.mjs --file <path> --anchor <text> --replacement <text> -- <cmd...>');
  console.error('  node scripts/ablation-replace.mjs --file <path> --anchor <text> --delete -- <cmd...>');
  console.error('  node scripts/ablation-replace.mjs --file <path> --anchor <text> --replacement <text> --hold');
  console.error('  node scripts/ablation-replace.mjs --restore --file <path>');
  console.error('  node scripts/ablation-replace.mjs --self-test');
  console.error('');
  console.error('  --expect N   the anchor must occur exactly N times (default 1)');
  console.error('  --delete     remove the anchor instead of replacing it');
  console.error('  --hold       leave the mutation on disk; prints the restore command');
  process.exit(EXIT.USAGE);
}

export function parseArgs(argv) {
  const dd = argv.indexOf('--');
  const head = dd === -1 ? argv.slice() : argv.slice(0, dd);
  const command = dd === -1 ? [] : argv.slice(dd + 1);
  const out = { file: null, anchor: null, replacement: null, expect: 1, isDelete: false, hold: false, restore: false, command, sawDoubleDash: dd !== -1 };
  for (let i = 0; i < head.length; i++) {
    const a = head[i];
    const need = (name) => {
      const v = head[i + 1];
      if (v === undefined) return { error: `${name} needs a value` };
      i += 1;
      return { value: v };
    };
    if (a === '--file') { const r = need('--file'); if (r.error) return { error: r.error }; out.file = r.value; }
    else if (a === '--anchor') { const r = need('--anchor'); if (r.error) return { error: r.error }; out.anchor = r.value; }
    else if (a === '--replacement') { const r = need('--replacement'); if (r.error) return { error: r.error }; out.replacement = r.value; }
    else if (a === '--expect') {
      const r = need('--expect');
      if (r.error) return { error: r.error };
      const n = Number(r.value);
      if (!Number.isInteger(n) || n < 1) return { error: `--expect takes a positive integer, got "${r.value}"` };
      out.expect = n;
    } else if (a === '--delete') out.isDelete = true;
    else if (a === '--hold') out.hold = true;
    else if (a === '--restore') out.restore = true;
    else if (a === '--self-test') { /* handled by the dispatcher */ }
    else return { error: `unrecognised option "${a}"` };
  }
  return { value: out };
}

export function validateArgs(a) {
  if (a.restore) {
    if (!a.file) return '--restore needs --file';
    if (a.anchor !== null || a.replacement !== null) return '--restore takes no --anchor / --replacement';
    if (a.command.length > 0) return '--restore takes no trailing command';
    return null;
  }
  if (!a.file) return 'needs --file';
  if (a.anchor === null) return 'needs --anchor';
  if (a.anchor.length === 0) return 'the anchor is empty — an empty anchor matches nothing and proves nothing';
  if (a.isDelete && a.replacement !== null) return '--delete and --replacement are mutually exclusive';
  if (!a.isDelete && a.replacement === null) return 'needs --replacement (or --delete)';
  if (!a.isDelete && a.replacement === a.anchor) return 'the replacement is byte-identical to the anchor — that mutation cannot move the file';
  if (a.hold && a.command.length > 0) return '--hold leaves the mutation in place, so it takes no trailing command';
  if (!a.hold && a.command.length === 0) {
    return 'needs either a trailing `-- <cmd...>` (the tool holds the restore trap while it runs) or --hold (you drive, and restore yourself)';
  }
  return null;
}

function resolveTarget(fileArg, repoRoot) {
  const abs = isAbsolute(fileArg) ? resolve(fileArg) : resolve(process.cwd(), fileArg);
  if (!existsSync(abs)) fail(`no such file: ${abs}`, EXIT.USAGE);
  if (!statSync(abs).isFile()) fail(`not a regular file: ${abs}`, EXIT.USAGE);
  const rel = relative(repoRoot, abs);
  if (rel.startsWith('..')) fail(`${abs} is outside the repository at ${repoRoot} — this tool restores from HEAD, so the path must be tracked here`, EXIT.USAGE);
  return abs;
}

function restoreLeg(repoRoot, absPath, { quiet = false } = {}) {
  const r = gitQuiet(['checkout', 'HEAD', '--', absPath], repoRoot);
  const hashAfter = blobHash(absPath, repoRoot);
  const headHash = headBlobHash(repoRoot, absPath);
  const d = gitQuiet(['diff', '--quiet', 'HEAD', '--', absPath], repoRoot);
  // `git diff --quiet` exits 1 on a difference, which gitQuiet reports as not-ok.
  // Distinguish "there is a difference" from "the diff could not be taken" by
  // asking again in a form that answers with text rather than a status.
  const names = gitQuiet(['diff', '--name-only', 'HEAD', '--', absPath], repoRoot);
  const diffReadable = names.ok;
  const diffEmpty = names.ok && names.out.trim().length === 0;
  const v = restoreVerdict({ hashAfter, headHash, diffEmpty, diffReadable });
  if (!quiet) {
    say(`restore ${absPath}`);
    if (!r.ok) console.error(`  git checkout HEAD -- <path> reported: ${r.err.trim()}`);
    say(`  blob after restore  ${hashAfter === null ? '(UNMEASURABLE)' : hashAfter}`);
    say(`  blob at HEAD        ${headHash === null ? '(UNMEASURABLE)' : headHash}`);
    say(`  git diff HEAD       ${diffReadable ? (diffEmpty ? 'empty' : names.out.trim()) : '(UNREADABLE)'}`);
    if (v.ok) say(`ok ${v.msg}`);
    else console.error(`x ${TOOL}: ${v.msg}`);
  }
  return v;
}

function run(argv) {
  const parsed = parseArgs(argv);
  if (parsed.error) usage(parsed.error);
  const a = parsed.value;
  const bad = validateArgs(a);
  if (bad) usage(bad);

  // Absolute, resolved ONCE and up front, so the restore handler does not
  // depend on the process's working directory when it fires.
  const repoRoot = repoRootOf(process.cwd());
  if (!repoRoot) fail('not inside a git repository (git rev-parse --show-toplevel failed) — this tool restores from HEAD and cannot operate without one', EXIT.USAGE);
  const absPath = resolveTarget(a.file, repoRoot);

  if (a.restore) {
    const v = restoreLeg(repoRoot, absPath);
    process.exit(v.ok ? EXIT.OK : EXIT.EVIDENCE);
  }

  const replacement = a.isDelete ? '' : a.replacement;
  const badBytes = describeControlBytes(replacement);
  if (badBytes.length > 0) {
    fail(`the replacement carries control byte(s) — ${badBytes.join(', ')}. Refusing before any write: this is the 2026-08-20 failure mode, where an interpolated variable became a NUL byte and turned the target binary.`, EXIT.USAGE);
  }
  if (describeControlBytes(a.anchor).length > 0) {
    fail('the anchor carries a control byte — refusing: an anchor nobody can type back is an anchor nobody can audit.', EXIT.USAGE);
  }

  const before = readFileSync(absPath, 'utf8');
  const anchorBefore = countOccurrences(before, a.anchor);
  const av = anchorVerdict({ anchorBefore, expect: a.expect });

  say(`target   ${absPath}`);
  say(`anchor   ${JSON.stringify(a.anchor)}  x${anchorBefore} (before)`);
  if (!av.ok) {
    console.error(`x ${TOOL}: ${av.msg}`);
    console.error(`  nothing was written; the file is untouched at ${blobHash(absPath, repoRoot) ?? '(UNMEASURABLE)'}`);
    process.exit(av.code);
  }
  say(`  ${av.msg}`);

  const replBefore = a.isDelete ? 0 : countOccurrences(before, replacement);
  const hashBefore = blobHash(absPath, repoRoot);
  const controlBefore = describeControlBytes(before).length;

  // Arm the restore BEFORE the write. A SIGTERM landing between the write and
  // the handler's installation would otherwise leave the tree mutated with
  // nothing on the process that could put it back.
  let armed = true;
  const restoreNow = () => {
    if (!armed) return null;
    armed = false;
    return restoreLeg(repoRoot, absPath, { quiet: false });
  };
  process.on('exit', restoreNow);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      console.error(`x ${TOOL}: ${sig} received mid-ablation — restoring ${absPath}`);
      restoreNow();
      process.exit(130);
    });
  }
  process.on('uncaughtException', (e) => {
    console.error(`x ${TOOL}: uncaught exception mid-ablation — restoring ${absPath}`);
    restoreNow();
    console.error(e && e.stack ? e.stack : String(e));
    process.exit(1);
  });

  const { text: after, replaced } = replaceFirstN(before, a.anchor, replacement, a.expect);
  writeFileSync(absPath, after, 'utf8');

  // Re-read from DISK. Not from the string we just wrote: the whole point is
  // that the write is not taken on trust.
  const onDisk = readFileSync(absPath, 'utf8');
  const anchorAfter = countOccurrences(onDisk, a.anchor);
  const replAfter = a.isDelete ? 0 : countOccurrences(onDisk, replacement);
  const hashAfter = blobHash(absPath, repoRoot);
  const controlAfter = describeControlBytes(onDisk);
  const newControlBytes = controlAfter.length > controlBefore ? controlAfter : [];

  say(`  replaced ${replaced} occurrence(s)`);
  say(`anchor   x${anchorBefore} -> x${anchorAfter}`);
  if (!a.isDelete) say(`replace  ${JSON.stringify(replacement)}  x${replBefore} -> x${replAfter}`);
  say(`blob     ${hashBefore ?? '(UNMEASURABLE)'} -> ${hashAfter ?? '(UNMEASURABLE)'}`);

  const mv = mutateVerdict({ anchorBefore, anchorAfter, replBefore, replAfter, expect: a.expect, isDelete: a.isDelete, hashBefore, hashAfter, newControlBytes });
  if (!mv.ok) {
    console.error(`x ${TOOL}: ${mv.msg}`);
    process.exit(mv.code); // the exit handler restores
  }
  say(`ok ${mv.msg}`);

  if (a.hold) {
    // A process that has exited holds no trap. Say so, disarm, and hand the
    // caller the exact command -- rather than let an armed-looking tool
    // restore the mutation the caller just asked to keep.
    armed = false;
    say('--hold: the mutation stays on disk. This process is exiting, so it holds NO trap for it.');
    say(`  restore with: node scripts/ablation-replace.mjs --restore --file ${absPath}`);
    say('  and before reading any verdict, prove the mutation reached the built artifact:');
    say(`  node scripts/ablation-dist-preflight.mjs <package> ${JSON.stringify(a.isDelete ? a.anchor : replacement)}${a.isDelete ? ' --absent' : ''}`);
    process.exit(EXIT.OK);
  }

  say(`running: ${a.command.join(' ')}`);
  const child = spawnSync(a.command[0], a.command.slice(1), { cwd: process.cwd(), stdio: 'inherit' });
  const childStatus = child.status === null ? 1 : child.status;
  say(`command exited ${childStatus}${child.signal ? ` (signal ${child.signal})` : ''}`);
  const rv = restoreNow();
  // The child's colour is the ablation's READING, not this tool's verdict: a
  // RED child is the expected direction for most ablations. So the child's
  // status passes through unchanged, and the one thing that is this tool's own
  // failure -- a restore that did not restore -- gets its own code, which no
  // child can accidentally mint.
  if (rv && !rv.ok) {
    console.error(`x ${TOOL}: the command ran, but the RESTORE could not be proven. The tree is not the tree you think you are measuring.`);
    process.exit(EXIT.RESTORE);
  }
  process.exit(childStatus);
}

// --- self-test ------------------------------------------------------------
//
// BOTH directions, because a one-directional self-test on a refusal tool is
// the same vacuity the tool exists to prevent: a helper that refuses
// everything passes an "anchor missing must exit non-zero" test perfectly.
//
//   direction A  anchor MISSING  -> MUST exit non-zero and write nothing
//   direction B  anchor PRESENT  -> MUST land on disk and print before/after
//
// Direction B is checked against the DISK, not against this process's idea of
// what it wrote.

const SELF_TEST_VERDICT = `${TOOL} self-test reached its verdict`;

const SELF_TEST_BATTERIES = Object.freeze({
  'pure verdicts': 16,
  'argument parsing': 9,
  'direction A — anchor missing refuses': 5,
  'direction B — anchor present lands on disk': 8,
  'restore is proven, never assumed': 4,
  'WRAP mode holds the trap and restores after the child': 7,
});
const SELF_TEST_BATTERY_FLOOR = 6;
const UNATTRIBUTED_BATTERY = '(no battery open)';

function selfTest() {
  const seen = new Map();
  let open = null;
  const battery = (name) => { open = name; };
  let failed = 0;
  const ok = (cond, what) => {
    const b = open ?? UNATTRIBUTED_BATTERY;
    seen.set(b, (seen.get(b) ?? 0) + 1);
    if (cond) return;
    failed += 1;
    console.error(`  x ${what}`);
  };

  const self = fileURLToPath(import.meta.url);

  battery('pure verdicts');
  ok(countOccurrences('aXbXc', 'X') === 2, 'countOccurrences counts literal hits');
  ok(countOccurrences('aaaa', 'aa') === 2, 'countOccurrences is non-overlapping');
  ok(countOccurrences('abc', '') === 0, 'an empty needle counts zero, never Infinity');
  ok(replaceFirstN('a.b.c', '.', '!', 1).text === 'a!b.c', 'replaceFirstN replaces exactly N');
  ok(replaceFirstN('a.b.c', '.', '!', 2).replaced === 2, 'replaceFirstN reports how many it replaced');
  ok(anchorVerdict({ anchorBefore: 0, expect: 1 }).code === EXIT.ANCHOR, 'zero hits is an ANCHOR exit');
  ok(anchorVerdict({ anchorBefore: 3, expect: 1 }).code === EXIT.ANCHOR, 'an ambiguous anchor is an ANCHOR exit');
  ok(anchorVerdict({ anchorBefore: 3, expect: 3 }).ok, 'a declared multi-hit anchor is accepted');
  ok(
    mutateVerdict({ anchorBefore: 1, anchorAfter: 0, replBefore: 0, replAfter: 1, expect: 1, isDelete: false, hashBefore: 'a'.repeat(40), hashAfter: 'a'.repeat(40), newControlBytes: [] }).msg.includes('NOTHING LANDED'),
    'an unchanged blob is NOTHING LANDED — the 2026-09-14 failure mode',
  );
  ok(
    mutateVerdict({ anchorBefore: 1, anchorAfter: 0, replBefore: 0, replAfter: 1, expect: 1, isDelete: false, hashBefore: null, hashAfter: 'b'.repeat(40), newControlBytes: [] }).ok === false,
    'a null (empty) hash is a FAILED measurement, not a match',
  );
  ok(
    mutateVerdict({ anchorBefore: 1, anchorAfter: 0, replBefore: 0, replAfter: 1, expect: 1, isDelete: false, hashBefore: 'a'.repeat(40), hashAfter: 'b'.repeat(40), newControlBytes: ['offset 3: U+0000'] }).ok === false,
    'a new control byte is fatal — the 2026-08-20 failure mode',
  );
  ok(
    mutateVerdict({ anchorBefore: 2, anchorAfter: 1, replBefore: 0, replAfter: 1, expect: 2, isDelete: false, hashBefore: 'a'.repeat(40), hashAfter: 'b'.repeat(40), newControlBytes: [] }).ok === false,
    'a partial replacement is refused even though the blob moved',
  );
  ok(restoreVerdict({ hashAfter: null, headHash: 'a'.repeat(40), diffEmpty: true, diffReadable: true }).ok === false, 'an unmeasurable restored blob is FAILURE');
  ok(restoreVerdict({ hashAfter: 'a'.repeat(40), headHash: null, diffEmpty: true, diffReadable: true }).ok === false, 'an unmeasurable HEAD blob is FAILURE');
  ok(restoreVerdict({ hashAfter: 'a'.repeat(40), headHash: 'a'.repeat(40), diffEmpty: false, diffReadable: true }).ok === false, 'blob equality alone does not pass — git diff HEAD must be empty too');
  ok(restoreVerdict({ hashAfter: 'a'.repeat(40), headHash: 'a'.repeat(40), diffEmpty: true, diffReadable: false }).ok === false, 'an unreadable diff is FAILURE, never a pass');

  battery('argument parsing');
  ok(parseArgs(['--file', 'x', '--anchor', 'a', '--replacement', 'b', '--', 'echo', 'hi']).value.command.join(' ') === 'echo hi', 'the trailing command is taken from after --');
  ok(parseArgs(['--file', 'x']).value.file === 'x', '--file is read');
  ok(parseArgs(['--expect', '0']).error !== undefined, '--expect 0 is refused');
  ok(parseArgs(['--expect']).error !== undefined, 'a flag with no value is refused');
  ok(parseArgs(['--nope']).error !== undefined, 'an unrecognised option is refused');
  ok(validateArgs(parseArgs(['--file', 'x', '--anchor', 'a', '--replacement', 'a', '--hold']).value) !== null, 'a replacement identical to the anchor is refused');
  ok(validateArgs(parseArgs(['--file', 'x', '--anchor', 'a', '--replacement', 'b']).value) !== null, 'neither --hold nor a command is refused');
  ok(validateArgs(parseArgs(['--file', 'x', '--anchor', 'a', '--delete', '--replacement', 'b', '--hold']).value) !== null, '--delete with --replacement is refused');
  ok(validateArgs(parseArgs(['--restore', '--file', 'x']).value) === null, '--restore --file is well-formed');

  // The two live directions need a real git tree, because the evidence is
  // `git hash-object` and `git diff HEAD`.
  const tmp = mkdtempSync(join(tmpdir(), 'ablation-replace-selftest-'));
  const cleanup = () => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } };
  try {
    mkdirSync(join(tmp, 'src'), { recursive: true });
    const target = join(tmp, 'src', 'guard.ts');
    writeFileSync(target, 'export const GUARD = true;\nexport const OTHER = 1;\n', 'utf8');
    const g = (args) => execFileSync('git', args, { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    g(['init', '-q']);
    g(['config', 'user.email', 'selftest@example.invalid']);
    g(['config', 'user.name', 'selftest']);
    g(['add', '-A']);
    g(['commit', '-qm', 'seed']);
    const headBlob = headBlobHash(tmp, target);
    const pristine = blobHash(target, tmp);

    const invoke = (args) => spawnSync(process.execPath, [self, ...args], { cwd: tmp, encoding: 'utf8' });

    battery('direction A — anchor missing refuses');
    const missBefore = readFileSync(target, 'utf8');
    const a1 = invoke(['--file', target, '--anchor', 'NO_SUCH_ANCHOR_a7f3', '--replacement', 'x', '--hold']);
    ok(a1.status !== 0, `anchor missing MUST exit non-zero (got ${a1.status})`);
    ok(a1.status === EXIT.ANCHOR, `anchor missing exits with the ANCHOR code ${EXIT.ANCHOR} (got ${a1.status})`);
    ok(/ANCHOR MISS/.test(a1.stderr), 'the refusal names the anchor miss');
    ok(readFileSync(target, 'utf8') === missBefore, 'anchor missing writes NOTHING to disk');
    ok(blobHash(target, tmp) === pristine, 'anchor missing leaves the blob hash untouched');

    battery('direction B — anchor present lands on disk');
    const b1 = invoke(['--file', target, '--anchor', 'GUARD = true', '--replacement', 'GUARD = false', '--hold']);
    const afterText = readFileSync(target, 'utf8');
    const afterHash = blobHash(target, tmp);
    ok(b1.status === 0, `anchor present MUST succeed (got ${b1.status}: ${b1.stderr})`);
    ok(afterText.includes('GUARD = false'), 'the mutation is ON DISK, read back from the file');
    ok(!afterText.includes('GUARD = true'), 'the anchor is gone from the file on disk');
    ok(afterHash !== pristine, 'the blob hash MOVED');
    ok(/x1 -> x0/.test(b1.stdout), 'the before/after anchor counts are printed');
    ok(b1.stdout.includes(pristine ?? 'UNSET') && b1.stdout.includes(afterHash ?? 'UNSET'), 'both blob hashes are printed');
    ok(/--restore --file/.test(b1.stdout), '--hold prints the exact restore command instead of pretending to hold a trap');
    const b2 = invoke(['--file', target, '--anchor', 'GUARD = false', '--replacement', 'GUARD = false', '--hold']);
    ok(b2.status === EXIT.USAGE, 'a no-op replacement is refused before any write');

    battery('restore is proven, never assumed');
    const r1 = invoke(['--restore', '--file', target]);
    ok(r1.status === 0, `restore succeeds (got ${r1.status}: ${r1.stderr})`);
    ok(blobHash(target, tmp) === headBlob, 'after restore the blob equals the HEAD blob');
    ok(/git diff HEAD\s+empty/.test(r1.stdout), 'the restore leg prints the git diff HEAD proof');
    ok(readFileSync(target, 'utf8').includes('GUARD = true'), 'the original text is back on disk');

    battery('WRAP mode holds the trap and restores after the child');
    // The wrapped command reads the target and reports what it saw, so the
    // mutation is proven to have been LIVE for the child -- not merely written
    // and restored around a command that never looked.
    const reader = join(tmp, 'reader.mjs');
    writeFileSync(
      reader,
      "import { readFileSync } from 'node:fs';\n"
        + `const t = readFileSync(${JSON.stringify(target)}, 'utf8');\n`
        + "process.stdout.write(t.includes('GUARD = false') ? 'CHILD_SAW_MUTATION' : 'CHILD_SAW_PRISTINE');\n"
        + "process.exit(t.includes('GUARD = false') ? 7 : 0);\n",
      'utf8',
    );
    const w1 = invoke(['--file', target, '--anchor', 'GUARD = true', '--replacement', 'GUARD = false', '--', process.execPath, reader]);
    ok(/CHILD_SAW_MUTATION/.test(w1.stdout), 'the wrapped child ran against the MUTATED file');
    ok(w1.status === 7, `the child's own status passes through untouched (got ${w1.status}) — a red child is the ablation's reading, not this tool's failure`);
    ok(blobHash(target, tmp) === headBlob, 'WRAP restored the file once the child exited');
    ok(/git diff HEAD\s+empty/.test(w1.stdout), 'WRAP prints the restore proof, not just a restore');
    // `--self-test` after the `--` belongs to the CHILD. Read off the WHOLE
    // argv it hijacked the dispatcher: the parent ran its own self-test, printed
    // a green line, and performed no ablation at all. Found by dogfooding this
    // tool on its own self-test; pinned here.
    //
    // The child is the reader, NOT this script: wrapping the real self-test
    // makes the self-test spawn itself, unbounded. That recursion is the reason
    // this case uses a stand-in -- the property under test is the parent's argv
    // slicing, and the reader carries the flag just as well.
    const w2 = invoke(['--file', target, '--anchor', 'GUARD = true', '--replacement', 'GUARD = false', '--', process.execPath, reader, '--self-test']);
    ok(/CHILD_SAW_MUTATION/.test(w2.stdout), 'a `--self-test` AFTER the -- does not hijack the dispatcher — the parent still performs the ablation');
    ok(!/self-test: all/.test(w2.stdout), 'and the parent does not print a self-test verdict for an ablation it was asked to run');
    ok(blobHash(target, tmp) === headBlob, 'and that wrapped run still restores the file');
  } finally {
    cleanup();
  }

  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    console.error(`  x SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}`);
    failed += 1;
  }
  for (const name of declared) {
    const count = seen.get(name) ?? 0;
    if (count < SELF_TEST_BATTERIES[name]) {
      console.error(
        count === 0
          ? `  x self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned`
          : `  x self-test battery "${name}" ran ${count} case(s), below its pinned ${SELF_TEST_BATTERIES[name]}`,
      );
      failed += 1;
    }
  }
  for (const name of seen.keys()) {
    if (!declared.includes(name)) {
      console.error(`  x cases ran under the undeclared battery "${name}"`);
      failed += 1;
    }
  }

  if (failed > 0) {
    console.error(`x ${TOOL} self-test: ${failed} case(s) failed.`);
    process.exit(1);
  }
  const total = [...seen.values()].reduce((s, n) => s + n, 0);
  console.log(`ok ${TOOL} self-test: all ${total} cases pass, in both directions.`);
  return SELF_TEST_VERDICT;
}

const argv = process.argv.slice(2);
const invokedDirectly = isEntrypoint(import.meta.url);

// `--self-test` counts only BEFORE the `--`. Everything after it belongs to the
// wrapped command, and the natural way to dogfood this tool is to wrap its own
// self-test -- which, read off the whole argv, silently made the parent run its
// self-test instead of the ablation and printed a GREEN that described nothing.
// Found by doing exactly that; the WRAP battery below now pins it.
const headArgv = argv.includes('--') ? argv.slice(0, argv.indexOf('--')) : argv;

if (!invokedDirectly) {
  // imported for its exports — run nothing
} else if (headArgv.includes('--self-test')) {
  if (selfTest() !== SELF_TEST_VERDICT) {
    console.error(
      `\nx ${TOOL} self-test: selfTest() returned without reaching its verdict,\n`
        + 'so no success line was printed. Exiting 0 here would report a self-test\n'
        + 'that never finished as a self-test that passed.\n',
    );
    process.exit(1);
  }
} else {
  run(argv);
}
