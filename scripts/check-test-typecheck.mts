#!/usr/bin/env tsx
// check-test-typecheck — a package's TEST layer is compiled by tsc, and every
// error it still carries is a named, measured, shrink-only entry (#5286, #5449).
//
// WHY THIS EXISTS. `packages/spec/tsconfig.json` excluded `**/*.test.ts`, and
// the package's `typecheck` script is `tsc --noEmit` against that very config.
// So no gate anywhere read a spec test file with a type checker: vitest
// transpiles through esbuild (types stripped, never resolved) and CI had no
// second compile step. Seventeen `@ts-expect-error` retirement pins across five
// files — the "tsc is the best sweeper" channel the spec-property-retirement
// playbook leans on — were PHANTOM checks. Deleting a directive line left the
// suite green, which is the definition of a check that never ran. The repo-wide
// sweep that finding triggered turned up an eighteenth pin in
// `packages/client` (#5449), which is why this gate is now shared rather than
// spec-local: the mechanism is one mechanism, named per package with
// `--package`, and every package that follows onboards by wiring its
// `typecheck` script instead of copying 300 lines.
//
// The repair is `tsconfig.test.json`: the same strictness flags (they are
// inherited, untouched — this is fidelity, not loosening) with module semantics
// that match how vitest actually executes the files (`module: esnext`,
// `moduleResolution: bundler`, `lib` including ES2022). Under the build config's
// NodeNext, 108 of spec's 842 raw errors were the CHECK being misconfigured
// rather than the code being wrong (TS2835 x58 "dynamic import needs .js",
// TS1470 x24 `import.meta` in a CJS program, TS2307 x18, TS2550 x7 lib) — a
// config-tier pile that says nothing about the tests. Client's five TS6059 were
// the same shape, from an inherited `rootDir`. Fixing the config first, then
// reading the residue, is the #4311 discipline this repo already writes down.
//
// The residue is real (691 errors over 79 files for spec; 6 over 3 files for
// client). ⚠️ Its COMPOSITION as read at the time — "overwhelmingly fixture
// object literals annotated with a schema's OUTPUT type (`z.infer`) while
// holding an authored INPUT literal" — is a 2026-08 reading, and it is not what
// the ledgers hold now. That cause is #5478 / #5543, fixed by PR #6786 on
// 2026-08-08. Re-measured on 2026-08-27 (#12624): across spec's 55 ledgered
// files `z.infer` occurs 8 times in 4 files, 5 of those inside prose comments,
// and 9 of the 263 errors are of the missing-properties shape at all — none of
// the 9 in a file that contains `z.infer`. For rest's ledgered files the count
// is 0. That is why `LEDGER_COMMENT` below states NO cause: a cause written
// into a generated constant is rewritten verbatim into every ledger by every
// regeneration, so it outlives its own repair and cannot be corrected in the
// file where it is read. Hand-fixing 691 errors in the PR that opens the gate
// would bury the gate. They are ledgered per file instead, in
// the package's own `test-typecheck-debt.json`, and the ledger is EXACT:
// recorded must equal measured. That is what makes it shrink-only in practice —
//
//   • a file gains errors      → red ("grew")
//   • a file loses errors      → red ("shrank; re-record") — so the number
//                                tracks reality downward instead of rotting
//   • a file reaches zero      → red ("graduated; delete the entry")
//   • a file's errors are SWAPPED for different ones of the same cardinality
//                              → red ("arrived" / "vanished", both named).
//                                This direction did NOT exist while an entry
//                                was one integer: a count measures a QUANTITY,
//                                never an identity, so the whole error
//                                population of a file could rotate underneath
//                                a constant number and the gate printed OK.
//                                Measured by ablation in packages/rest, not
//                                argued (#13470); entries are per-signature.
//   • an unledgered file errors→ red — this is the everyday case, and it is
//                                why the pin files carry NO entry: any error in
//                                them, including the TS2578 that a deleted (or
//                                a never-applicable) `@ts-expect-error`
//                                produces, is red.
//
// Growing the ledger is possible (add the file and its count) but it is a
// visible line in this repo's diff and needs the same justification any DEBT
// entry needs — the idiom of `scripts/check-type-check-coverage.mjs`, applied
// per file rather than per package. That authority rule is stated to the AUTHOR
// too, not only here: the unledgered-file message marks the ledger-expanding
// path `⛔ MAINTAINER-ONLY` per the #8435 convention, and the self-test holds
// the marker in place. See the convention block below `LEDGER_COMMENT`.
//
// Usage (`--package` is repo-relative and required for everything but
// `--self-test`, which judges the ledger semantics alone):
//   tsx scripts/check-test-typecheck.mts --package packages/spec
//   tsx scripts/check-test-typecheck.mts --package packages/spec --update
//   tsx scripts/check-test-typecheck.mts --self-test

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SELF_TEST = process.argv.includes('--self-test');

/** A flag's value, or `undefined` when the flag is absent or trailing. */
function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : undefined;
}

// Repo-relative, and REQUIRED: a gate that guessed which package it was judging
// would report a clean run over whichever one it happened to find.
const PKG_DIR = ((): string => {
  const value = flag('--package');
  if (!value) {
    if (SELF_TEST) return 'packages/spec'; // only the ledger semantics run; nothing is read
    throw new Error('check-test-typecheck: --package <repo-relative dir> is required (e.g. --package packages/client).');
  }
  return value.replace(/\/+$/, '');
})();
const PKG = path.resolve(ROOT, PKG_DIR);
const PKG_NAME = ((): string => {
  try {
    return JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')).name ?? PKG_DIR;
  } catch {
    if (SELF_TEST) return '@objectstack/spec';
    throw new Error(`check-test-typecheck: no readable package.json at ${PKG_DIR}.`);
  }
})();
// Named on the command line rather than hardcoded, so the wiring is visible in
// package.json: `check:type-check-coverage` reads the typecheck script chain to
// decide whether a sibling test tsconfig is actually invoked, and a config no
// script names is exactly the phantom this gate is about.
const PROJECT = flag('--project') ?? 'tsconfig.test.json';
const LEDGER_PATH = path.join(PKG, 'test-typecheck-debt.json');
const LEDGER_NAME = 'test-typecheck-debt.json';
const ISSUE = 'https://github.com/objectstack-ai/objectstack/issues/5286';
const UPDATE_COMMAND = `pnpm --filter ${PKG_NAME} gen:test-typecheck-debt`;

const LEDGER_COMMENT =
  `Per-file tsc error debt of the ${PKG_NAME} TEST layer (#5286). ` +
  '`tsconfig.test.json` compiles `src/**/*.test.ts` — which `tsconfig.json` excludes and therefore ' +
  'no gate ever read — and every file below still carries errors from before that gate existed. ' +
  'THIS FIELD IS GENERATED: every regeneration rewrites it from scripts/check-test-typecheck.mts, and ' +
  'the EXACT ratchet below requires a regeneration on every repair — so an edit made here is gone by ' +
  'the next one. Anything true of THIS package goes in the sibling `_note` field, which is authored, ' +
  'is preserved verbatim, and is never written by the generator (#12624). ' +
  'This comment states NO cause for the errors, deliberately: the classes differ per package and ' +
  'per file, they move as the debt is paid down, and a cause written here is rewritten verbatim into ' +
  'every ledger by every regeneration — so it outlives its own repair and cannot be corrected in the ' +
  'file where it is read. Measure instead, before repairing anything: `tsc --noEmit --pretty false -p ' +
  'tsconfig.test.json` in the package prints the real classes with their TS codes. ' +
  'Each entry maps a file to its per-SIGNATURE error counts, never to a bare total (#13470): a ' +
  'signature is the TS code plus the diagnostic message with structural type blobs collapsed, and it ' +
  'carries NO line or column — so the pin survives edits that move code around, and only stops ' +
  'matching when the error itself becomes a different error. ' +
  'EXACT ratchet, judged by re-running tsc: a file that gains errors is red, ' +
  'a file that loses them is red until its number is re-recorded, a file that reaches zero is red until ' +
  'its entry is deleted, a signature that ARRIVES or VANISHES is red even when the file total is ' +
  'unchanged, and a file NOT listed here may have no errors at all. Regenerate with: ' +
  UPDATE_COMMAND;

// ── What the ledger's own prose must say, pinned (#12624) ───────────────────
//
// Every `--update` rebuilds `_comment` from the constant above, so the prose a
// dev picking up a paydown card reads is whatever this file said last — and a
// correction written into a `test-typecheck-debt.json` survives only until the
// next regeneration, which the EXACT ratchet REQUIRES on every repair. That is
// how the #5478 / #5543 OUTPUT-vs-INPUT cause, fixed by PR #6786 on 2026-08-08,
// went on being stamped into ledgers created 18 days later.
//
// A DEPARTURE pin alone cannot hold this: "the fossil sentence is absent"
// passes just as happily against a `_comment` that is the empty string. So the
// mechanism sentences are pinned by ARRIVAL — each one named, so a failure says
// which sentence went missing rather than that the prose "changed" — and the
// refuted cause is pinned by absence beside it. Both are asserted against the
// text `buildLedger()` REALLY emits, not a copy of it.

/** Named fragments the generated `_comment` MUST carry. Labels are the failure text. */
const LEDGER_COMMENT_REQUIRED: ReadonlyArray<readonly [string, string]> = [
  ['names the package whose debt it is', PKG_NAME],
  ['declares the ratchet EXACT', 'EXACT ratchet'],
  ['red direction 1 — a file that GAINS errors', 'a file that gains errors is red'],
  ['red direction 2 — a file that LOSES errors', 'red until its number is re-recorded'],
  ['red direction 3 — a file that reaches ZERO', 'red until its entry is deleted'],
  ['says a file NOT listed may be clean', 'may have no errors at all'],
  ['hands the reader the regenerate command', UPDATE_COMMAND],
  ['tells the reader no cause is stated and the real classes must be measured', 'states NO cause'],
  ['warns that this field is regenerated, so an edit here does not survive', 'THIS FIELD IS GENERATED'],
  ['names the authored field a package-specific note survives in', '`_note`'],
  ['red direction 4 — IDENTITY, not only quantity', 'a signature that ARRIVES or VANISHES is red even when the file total is unchanged'],
  ['says entries are per-signature rather than a bare total', 'never to a bare total'],
  ['says a signature carries no position, so it survives code movement', 'carries NO line or column'],
];

/**
 * The causal claim this constant carried until #12624, pinned as absent.
 * Measured on 2026-08-27: 0 `z.infer` occurrences across rest's ledgered files;
 * 8 across spec's 55 (5 of them inside prose comments), and none of the 9
 * missing-properties errors among spec's 263 sits in a file containing one.
 */
const LEDGER_COMMENT_REFUTED_CAUSE = /z\.infer|OUTPUT type|INPUT literal/;

/** Which required sentences a candidate `_comment` is missing, by label. */
export function ledgerCommentOmissions(comment: string): string[] {
  return LEDGER_COMMENT_REQUIRED.filter(([, fragment]) => !comment.includes(fragment)).map(([label]) => label);
}

/** Whether a candidate `_comment` has had the refuted cause put back into it. */
export function ledgerCommentRestatesRefutedCause(comment: string): boolean {
  return LEDGER_COMMENT_REFUTED_CAUSE.test(comment);
}

// ── The ratchet-remedy authority convention (#8435) ─────────────────────────
//
// The unledgered-file verdict's second remedy is "add the file to the ledger",
// which EXPANDS a shrink-only ratchet. The rule saying that is a maintainer's
// call was written only in this file's prose — where a maintainer reading the
// script sees it and the author who trips the gate never does — while the
// message itself offered the path as the plain second of two things to do.
// The convention landed for check-engine-double-contract.mjs and
// check-type-check-coverage.mjs; the twin blocks there are the reference.
//
// The words in the marked message are lifted from this file's own two
// statements of the rule — `LEDGER_COMMENT`'s "EXACT ratchet" and the GREW
// verdict's "the ledger only ratchets down" — rather than invented: one rule
// stated twice in two voices is two rules by the next reading.
//
// Deliberately NOT extended to this file's other two ledger-naming verdicts.
// SHRANK tells the author to re-record a number that already fell, and
// GRADUATED tells them to DELETE an entry; both are the ratchet TIGHTENING and
// squarely the author's job. Note GRADUATED names the ledger file too, so the
// detector below is keyed on the EXPANDING phrasing ("add the file to …") and
// not on the ledger's name — a detector that caught GRADUATED would stamp
// maintainer-only onto the improvement path and teach the opposite of the rule.
//
// ⛔ This STRENGTHENS ratchet governance and weakens nothing. No verdict moves,
// no ledger entry is added, and the problems `evaluate()` reports are the same
// set on the same inputs — only the diagnostic text of one of them changes.

/** Kept identical to the other gates' token so the convention is greppable. */
const RATCHET_AUTHORITY_MARKER = '⛔ MAINTAINER-ONLY';

/**
 * How this gate OFFERS the privileged path, as a detector rather than a string
 * compare, so the self-test can prove it still reaches its subject: a reworded
 * offer that stopped matching would make the convention check pass vacuously on
 * every message.
 *
 * The optional `(?:\S*\/)?` accepts the ledger named by PATH as well as by bare
 * filename — a gap spelled to exclude the dot would silently stop matching the
 * moment the message qualified the name with a directory, and the self-test
 * carries a path-spelled control precisely because that failure is invisible.
 */
const RATCHET_EXPANSION_OFFER = new RegExp(
  `add the (?:file|signature) to\\s+(?:\\S*\\/)?${LEDGER_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
);

/**
 * The convention: a message that hands the author the ledger-expanding path
 * must say in the same breath that the path is not theirs. A message offering no
 * such path is unaffected — this is an authority label, not a vocabulary ban.
 */
export function ratchetRemedyCarriesAuthority(message: string): boolean {
  if (!RATCHET_EXPANSION_OFFER.test(message)) return true;
  return message.includes(RATCHET_AUTHORITY_MARKER);
}

/** A file's error population: normalised signature → how many carry it. */
export type SignatureCounts = Record<string, number>;

type Ledger = {
  /** GENERATED — rebuilt from `LEDGER_COMMENT` by every `--update`. */
  _comment: string;
  /** AUTHORED — preserved verbatim by `--update`, never written by it (#12624). */
  _note?: string;
  entries: Record<string, SignatureCounts>;
};

/** Total errors a signature multiset accounts for — the old per-file count. */
export function totalErrors(sigs: SignatureCounts | Map<string, number>): number {
  const values = sigs instanceof Map ? [...sigs.values()] : Object.values(sigs);
  return values.reduce((a, b) => a + b, 0);
}

/** A ledger entry is well-formed iff it is a non-empty map of positive integer counts. */
export function isSignatureCounts(value: unknown): value is SignatureCounts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return (
    entries.length > 0 &&
    entries.every(([, n]) => typeof n === 'number' && Number.isInteger(n) && n > 0)
  );
}

/** `path(line,col): error TSxxxx: message` — continuation lines never match. */
const DIAGNOSTIC = /^(\S[^(]*)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

// ── What a signature keeps, and what it deliberately throws away (#13470) ───
//
// WHY THIS IS NOT A COUNT. The ledger used to record one integer per file, and
// an integer measures a QUANTITY, never an identity. `packages/rest` proved the
// consequence by ablation: `src/rest.test.ts` was recorded at 2, PR #13466
// replaced both hand-built `IHttpRequest` literals with a typed builder, and it
// measured 2 again — while NEITHER error was the same error. tsc reports at
// most ONE argument-assignability error per call expression, so the request
// literals had been MASKING response-literal errors at the very same two call
// sites; repairing the request unmasked the response one line down. The count
// was conserved across a change that replaced the file's entire error
// population, and the EXACT ratchet printed OK both times.
//
// WHY POSITION IS EXCLUDED. The obvious identity — code plus line/column —
// churns on every edit anywhere above it in the file, which would turn a
// generated ledger into a merge-conflict magnet and buy a gate that gets
// weakened later. A signature therefore carries NO position: moving the code
// around the file does not touch the ledger, and only a change to WHICH error
// is present does.
//
// WHY THE MESSAGE IS COLLAPSED. Measured over the 264 diagnostics the three
// ledgered packages actually carry (2026-08-30): raw messages run to 546
// characters and embed whole structural types, including tsc's own
// version-dependent elisions ("... 37 more ..."). Those blobs are churn, not
// identity. Collapsing every quoted span that is long or structural leaves the
// discriminating half — the TS code, the prose, and the NAMED types and
// identifiers — and it is what separates the two populations above:
// `parameter of type 'IHttpRequest'` vs `parameter of type 'IHttpResponse'`.
// Measured effect: 264 errors collapse to 147 signature keys, longest 186
// characters, and rest's file reduces to a single key.

/** Longest quoted span kept verbatim; beyond this it is a type blob, not a name. */
const STABLE_QUOTED_SPAN = 32;

/**
 * A diagnostic message with its churn-prone spans collapsed. A quoted span
 * survives only when it is short AND free of the structural punctuation that
 * makes tsc print a whole shape — i.e. when it is a name, a dotted path, or a
 * small literal type, all of which change only when the error does.
 */
export function normalizeMessage(message: string): string {
  return message
    .replace(/'([^']*)'/g, (whole, inner: string) =>
      inner.length <= STABLE_QUOTED_SPAN && !/[{<(\[]/.test(inner) ? whole : "'…'",
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** The pinned identity of one diagnostic: its code plus its normalised message. */
export function diagnosticSignature(code: string, message: string): string {
  return `${code}: ${normalizeMessage(message)}`;
}

/**
 * Per-file signature multisets from a raw `tsc --noEmit --pretty false`
 * transcript. Paths are normalised to posix and relative to the package being
 * judged, so the ledger reads the same on every platform.
 */
export function parseDiagnostics(output: string): Map<string, Map<string, number>> {
  const files = new Map<string, Map<string, number>>();
  for (const line of output.split(/\r?\n/)) {
    const m = DIAGNOSTIC.exec(line);
    if (!m) continue;
    const file = m[1].split(path.sep).join('/');
    const sig = diagnosticSignature(m[4], m[5]);
    const sigs = files.get(file) ?? new Map<string, number>();
    sigs.set(sig, (sigs.get(sig) ?? 0) + 1);
    files.set(file, sigs);
  }
  return files;
}

/**
 * The verdict, as a pure function over observed counts and the recorded ledger,
 * so the self-test proves the semantics the real run applies.
 */
export function evaluate(
  actual: Map<string, Map<string, number>>,
  ledger: Record<string, SignatureCounts>,
): string[] {
  const problems: string[] = [];

  for (const [file, sigs] of [...actual].sort(([a], [b]) => a.localeCompare(b))) {
    if (!Object.hasOwn(ledger, file)) {
      problems.push(
        `${file}: ${totalErrors(sigs)} type error(s) in a file the ledger does not cover. Fix them — this file is ` +
          `inside the checked zone, which is the point of ${PROJECT}. (A deleted \`@ts-expect-error\` ` +
          `shows up exactly here, as TS2578/TS2694.) That is the fix, and the only one of the two you ` +
          `can take on your own. ${RATCHET_AUTHORITY_MARKER}, NOT a co-equal option: add the file to ` +
          `${LEDGER_NAME}. This is an EXACT ratchet and the ledger only ratchets down, so a new entry ` +
          `EXPANDS it — that needs a maintainer to agree the debt is legitimate first (${ISSUE}). Do ` +
          `not take this path to get CI green.`,
      );
      continue;
    }
    const recorded = ledger[file];
    // Malformed entries are reported once, by the ledger-shape pass below;
    // judging a file against an unreadable entry would report the same defect
    // twice and in the second case describe it wrongly.
    if (!isSignatureCounts(recorded)) continue;

    // ARRIVED and VANISHED are the two the old per-file count could not see.
    // They are reported per SIGNATURE and by NAME: a wholesale substitution
    // holds the file total constant, so a reader who is told only that
    // "something changed" still cannot tell which debt was paid and which was
    // uncovered. Both halves of the set difference are named.
    for (const [sig, count] of [...sigs].sort(([a], [b]) => a.localeCompare(b))) {
      const was = recorded[sig];
      if (was === undefined) {
        problems.push(
          `${file}: ${count} type error(s) carrying a signature the ledger does not record — ARRIVED: ` +
            `${sig} — and the file total may be UNCHANGED, because repairing one error routinely ` +
            `unmasks another at the same site (${ISSUE}). Fix it — that is the fix, and the only one ` +
            `of the two you can take on your own. ${RATCHET_AUTHORITY_MARKER}, NOT a co-equal option: ` +
            `add the signature to ${LEDGER_NAME}. This is an EXACT ratchet and the ledger only ` +
            `ratchets down, so a new signature EXPANDS it — that needs a maintainer to agree the debt ` +
            `is legitimate first. Do not take this path to get CI green.`,
        );
      } else if (count > was) {
        problems.push(
          `${file}: ${count} type error(s), ledger records ${was} — the debt GREW for ${sig}. Fix the ` +
            `${count - was} new one(s); the ledger only ratchets down (${ISSUE}).`,
        );
      } else if (count < was) {
        problems.push(
          `${file}: ${count} type error(s), ledger records ${was} — the debt SHRANK for ${sig}, which is ` +
            `the goal. Re-record it so the number stays true: ${UPDATE_COMMAND}.`,
        );
      }
    }

    for (const [sig, was] of Object.entries(recorded).sort(([a], [b]) => a.localeCompare(b))) {
      if (sigs.has(sig)) continue;
      problems.push(
        `${file}: the ledger records ${was} type error(s) carrying ${sig} but tsc reports none — it ` +
          `VANISHED: repaired, or REPLACED by a different error while the file total stayed the same. ` +
          `That is the ratchet tightening. Re-record it so the ledger stays true: ${UPDATE_COMMAND}.`,
      );
    }
  }

  for (const [file, recorded] of Object.entries(ledger).sort(([a], [b]) => a.localeCompare(b))) {
    if (typeof recorded === 'number') {
      problems.push(
        `${file}: ledger entry is a bare error COUNT (${JSON.stringify(recorded)}), not a per-signature ` +
          `map — this ledger predates the identity pin (${ISSUE}). A count measures a QUANTITY, never ` +
          `an identity, so it stays green through a wholesale substitution of the errors underneath it. ` +
          `Re-record it: ${UPDATE_COMMAND}.`,
      );
      continue;
    }
    if (!isSignatureCounts(recorded)) {
      problems.push(
        `${file}: ledger entry is not a map of signature → positive integer error count ` +
          `(${JSON.stringify(recorded)}) — a ledger without a measurement is a permission slip.`,
      );
      continue;
    }
    if (!actual.has(file)) {
      problems.push(
        `${file}: ledger records ${totalErrors(recorded)} type error(s) but tsc reports none — it GRADUATED, or the file ` +
          `moved/vanished. Delete its entry from ${LEDGER_NAME} in the same change.`,
      );
    }
  }

  return problems;
}

function loadLedger(): Ledger {
  if (!fs.existsSync(LEDGER_PATH)) return { _comment: LEDGER_COMMENT, entries: {} };
  const parsed = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8')) as Ledger;
  if (!parsed || typeof parsed !== 'object' || typeof parsed.entries !== 'object') {
    throw new Error(`${LEDGER_NAME} is not { _comment, entries } — refusing to judge against an unreadable ledger.`);
  }
  return parsed;
}

/**
 * Exactly what `--update` writes, as a pure function so the self-test asserts
 * against the emitted object rather than a hand-copied fixture of it. The
 * counts pass through untouched and sorted: a regeneration re-records what tsc
 * measured and moves no number of its own.
 */
export function buildLedger(counts: Map<string, Map<string, number>>, note?: string): Ledger {
  const entries: Record<string, SignatureCounts> = {};
  for (const file of [...counts.keys()].sort()) {
    const sigs = counts.get(file)!;
    const recorded: SignatureCounts = {};
    for (const sig of [...sigs.keys()].sort()) recorded[sig] = sigs.get(sig)!;
    entries[file] = recorded;
  }
  return note === undefined ? { _comment: LEDGER_COMMENT, entries } : { _comment: LEDGER_COMMENT, _note: note, entries };
}

/**
 * `--update` regenerates `_comment` and re-records `entries`; `_note` it reads
 * back out of the file it is about to overwrite and writes unchanged. Via
 * `loadLedger()` on purpose: a ledger too broken to parse REFUSES the update
 * rather than silently dropping the authored half of its prose — the loss this
 * whole split exists to stop (#12624).
 */
function writeLedger(counts: Map<string, Map<string, number>>): void {
  fs.writeFileSync(LEDGER_PATH, `${JSON.stringify(buildLedger(counts, loadLedger()._note), null, 2)}\n`, 'utf8');
}

/** Compile the test program and hand back the raw transcript. */
function runTsc(): string {
  const require = createRequire(import.meta.url);
  const tsc = require.resolve('typescript/bin/tsc');
  const result = spawnSync(process.execPath, [tsc, '--noEmit', '--pretty', 'false', '-p', PROJECT], {
    cwd: PKG,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS ?? '--max-old-space-size=4096' },
  });
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  // A non-zero exit with NO parseable diagnostic means tsc could not run at all
  // (missing config, crash, OOM). That must not read as "no errors found" — the
  // failure mode this whole file exists to prevent.
  const hasDiagnostics = output.split(/\r?\n/).some((line) => DIAGNOSTIC.test(line));
  if (result.status !== 0 && !hasDiagnostics) {
    throw new Error(`tsc -p ${PROJECT} failed without diagnostics (exit ${result.status}):\n${output}`);
  }
  return output;
}

function selfTest(): void {
  // The two REAL signatures from the ablation that produced #13470: `packages/
  // rest`'s two call sites passed a bad request AND a bad response, tsc showed
  // only the request error, and PR #13466's repair uncovered the response one.
  // Same file, same count, entirely different errors.
  const REQ = "TS2345: Argument of type '…' is not assignable to parameter of type 'IHttpRequest'.";
  const RES = "TS2345: Argument of type '…' is not assignable to parameter of type 'IHttpResponse'.";

  /** `[file, [[signature, count], …]]` → the shape `parseDiagnostics` returns. */
  const observed = (pairs: Array<[string, Array<[string, number]>]>): Map<string, Map<string, number>> =>
    new Map(pairs.map(([file, sigs]) => [file, new Map(sigs)]));

  const cases: Array<{
    label: string;
    actual: Array<[string, Array<[string, number]>]>;
    ledger: Record<string, SignatureCounts>;
    expect: RegExp[];
  }> = [
    {
      label: 'a clean, unledgered file passes',
      actual: [],
      ledger: {},
      expect: [],
    },
    {
      label: 'a ledgered file at its recorded signature counts passes',
      actual: [['a.test.ts', [[REQ, 3]]]],
      ledger: { 'a.test.ts': { [REQ]: 3 } },
      expect: [],
    },
    {
      label: 'an error in an unledgered file is red — the everyday case, and what a deleted directive produces',
      actual: [['pin.test.ts', [['TS2578: Unused directive.', 1]]]],
      ledger: {},
      expect: [/pin\.test\.ts: 1 type error\(s\) in a file the ledger does not cover/],
    },
    {
      label: 'a ledgered file that gains an error of a RECORDED signature is red',
      actual: [['a.test.ts', [[REQ, 4]]]],
      ledger: { 'a.test.ts': { [REQ]: 3 } },
      expect: [/a\.test\.ts: 4 type error\(s\), ledger records 3 — the debt GREW/],
    },
    {
      label: 'a ledgered file that loses an error of a recorded signature is red until re-recorded',
      actual: [['a.test.ts', [[REQ, 2]]]],
      ledger: { 'a.test.ts': { [REQ]: 3 } },
      expect: [/a\.test\.ts: 2 type error\(s\), ledger records 3 — the debt SHRANK/],
    },
    {
      label: 'a graduated file is red until its entry is deleted',
      actual: [],
      ledger: { 'a.test.ts': { [REQ]: 3 } },
      expect: [/a\.test\.ts: ledger records 3 type error\(s\) but tsc reports none/],
    },
    {
      label: 'a ledger entry without a real measurement is red',
      actual: [],
      ledger: { 'a.test.ts': { [REQ]: 0 } },
      expect: [/a\.test\.ts: ledger entry is not a map of signature → positive integer error count/],
    },
    {
      label:
        'a legacy BARE-COUNT entry is red rather than silently trusted — a count cannot be judged for '
        + 'identity, so a ledger that predates the pin must be re-recorded, not read',
      actual: [['a.test.ts', [[REQ, 3]]]],
      ledger: { 'a.test.ts': 3 as unknown as SignatureCounts },
      expect: [/a\.test\.ts: ledger entry is a bare error COUNT \(3\), not a per-signature map/],
    },
    {
      // ⭐ THE CASE THIS GATE WAS REOPENED FOR (#13470). The old per-file count
      // is IDENTICAL across this substitution — 2 before, 2 after — and printed
      // OK. Both halves of the set difference must be named: which debt was
      // paid, and which one it uncovered.
      label:
        '⭐ #13470 — a WHOLESALE substitution of error identity at CONSTANT cardinality is red, and '
        + 'names both the signature that ARRIVED and the one that VANISHED',
      actual: [['rest.test.ts', [[RES, 2]]]],
      ledger: { 'rest.test.ts': { [REQ]: 2 } },
      expect: [
        /rest\.test\.ts: 2 type error\(s\) carrying a signature the ledger does not record — ARRIVED: TS2345: .*'IHttpResponse'/,
        /rest\.test\.ts: the ledger records 2 type error\(s\) carrying TS2345: .*'IHttpRequest'.* but tsc reports none — it VANISHED/,
      ],
    },
    {
      label: 'a PARTIAL substitution is red too, and the surviving signature is left unmentioned',
      actual: [['a.test.ts', [[REQ, 1], [RES, 1]]]],
      ledger: { 'a.test.ts': { [REQ]: 2 } },
      expect: [
        /a\.test\.ts: 1 type error\(s\), ledger records 2 — the debt SHRANK for TS2345: .*'IHttpRequest'/,
        /a\.test\.ts: 1 type error\(s\) carrying a signature the ledger does not record — ARRIVED: TS2345: .*'IHttpResponse'/,
      ],
    },
    {
      label: 'problems from both directions are reported together',
      actual: [
        ['a.test.ts', [[REQ, 4]]],
        ['new.test.ts', [['TS2304: Cannot find name.', 1]]],
      ],
      ledger: { 'a.test.ts': { [REQ]: 3 }, 'gone.test.ts': { [RES]: 2 } },
      expect: [
        /a\.test\.ts: 4 type error\(s\), ledger records 3 — the debt GREW/,
        /new\.test\.ts: 1 type error\(s\) in a file the ledger does not cover/,
        /gone\.test\.ts: ledger records 2 type error\(s\) but tsc reports none/,
      ],
    },
  ];

  const failures: string[] = [];
  for (const c of cases) {
    const got = evaluate(observed(c.actual), c.ledger);
    if (got.length !== c.expect.length || !c.expect.every((rx, i) => rx.test(got[i]))) {
      failures.push(`${c.label}: expected ${c.expect.length} problem(s) matching ${c.expect}, got ${JSON.stringify(got)}`);
    }
  }

  const expect = (label: string, cond: boolean): void => {
    if (!cond) failures.push(label);
  };

  // The control that makes the substitution case above mean anything: the two
  // populations really are the same size, so the number the ledger used to hold
  // is UNCHANGED across the swap. Without this the case would only be proving
  // "a changed count is red", which the per-file count already did.
  expect(
    '⭐ #13470 — the substitution fixture is cardinality-preserving (else the case above proves nothing '
      + 'the old per-file count could not already see)',
    totalErrors(new Map([[RES, 2]])) === totalErrors({ [REQ]: 2 }),
  );

  // The parser is the other half of the semantics: a multi-line tsc message
  // must count once, and a continuation line must never be read as a file.
  const parsed = parseDiagnostics(
    [
      "src/a.test.ts(1,1): error TS2739: Type '{}' is missing the following properties from type 'X':",
      "  Type 'string[]' is not assignable to type 'Y'.",
      "src/a.test.ts(9,3): error TS2578: Unused '@ts-expect-error' directive.",
      'src/b.test.ts(2,2): error TS2304: Cannot find name.',
      '',
    ].join('\n'),
  );
  if (
    parsed.size !== 2 ||
    totalErrors(parsed.get('src/a.test.ts') ?? new Map()) !== 2 ||
    totalErrors(parsed.get('src/b.test.ts') ?? new Map()) !== 1 ||
    (parsed.get('src/a.test.ts')?.size ?? 0) !== 2
  ) {
    failures.push(
      `parseDiagnostics mis-read a multi-line transcript: ${JSON.stringify([...parsed].map(([f, m]) => [f, [...m]]))}`,
    );
  }

  // ── What a signature must and must not notice (#13470) ────────────────────
  //
  // These are the two properties that decide whether pinning identity is worth
  // its cost. (i) POSITION-BLIND: the same errors after unrelated edits above
  // them must produce an IDENTICAL ledger, or every commit churns a generated
  // file and the gate gets weakened. (ii) IDENTITY-SHARP: a different named
  // type must produce a different key, or the pin is decoration.
  {
    const atLine = (line: number, type: string): string =>
      `src/rest.test.ts(${line},7): error TS2345: Argument of type '{ json: Mock<Procedure>; `
      + `status: Mock<Procedure>; }' is not assignable to parameter of type '${type}'.`;

    const before = parseDiagnostics([atLine(2063, 'IHttpResponse'), atLine(2088, 'IHttpResponse')].join('\n'));
    const moved = parseDiagnostics([atLine(9001, 'IHttpResponse'), atLine(9099, 'IHttpResponse')].join('\n'));
    const swapped = parseDiagnostics([atLine(2063, 'IHttpRequest'), atLine(2088, 'IHttpRequest')].join('\n'));

    const keysOf = (m: Map<string, Map<string, number>>): string =>
      JSON.stringify([...m].map(([f, sigs]) => [f, [...sigs]]));

    expect(
      `#13470 (i) POSITION-BLIND — the same errors at different line/column produce the SAME ledger, so `
        + `unrelated edits above them do not churn a generated file: ${keysOf(before)} vs ${keysOf(moved)}`,
      keysOf(before) === keysOf(moved),
    );
    expect(
      '#13470 (ii) IDENTITY-SHARP — swapping only the NAMED parameter type produces a DIFFERENT '
        + 'signature, which is the whole discrimination the per-file count lacked',
      keysOf(before) !== keysOf(swapped),
    );
    expect(
      '#13470 (ii-control) — and the swap is cardinality-preserving, so nothing but identity separates '
        + 'the two readings',
      totalErrors(before.get('src/rest.test.ts')!) === totalErrors(swapped.get('src/rest.test.ts')!),
    );
    expect(
      '#13470 — a signature drops the churn-prone structural blob but keeps the named type (a full '
        + 'message string would re-pin every anonymous shape tsc prints, including its own '
        + '"... 37 more ..." elisions)',
      [...before.get('src/rest.test.ts')!.keys()][0] ===
        "TS2345: Argument of type '…' is not assignable to parameter of type 'IHttpResponse'.",
    );
  }

  // ── The ratchet-remedy authority convention (#8435) ────────────────────────
  //
  // Asserted against the text `evaluate()` REALLY emits rather than a copy of
  // it: a hand-copied fixture would prove the convention about a string no
  // author ever reads. The assertions are deliberately non-overlapping, so each
  // way this can rot is caught by exactly one NAMED failure:
  //
  //   (1) the detector still reaches its subject — the only one that fails if
  //       the offer is reworded out from under RATCHET_EXPANSION_OFFER, which
  //       would make (3) pass vacuously forever after;
  //   (2) the real emitted verdict carries the marker — the only one that fails
  //       if the label is dropped from the unledgered-file message;
  //   (3) an offer WITHOUT the marker is REJECTED — the only one that fails if
  //       the predicate stops discriminating (e.g. is reduced to `return true`);
  //   (4) an offer naming the ledger by PATH is still matched — the only one
  //       that fails if the detector's gap is narrowed to exclude directories;
  //   (5)/(6)/(7) the detector does NOT reach the SHRANK, GRADUATED and GREW
  //       verdicts. Those are the ratchet TIGHTENING, squarely the author's
  //       job. (6) is the one that earns its keep: GRADUATED names the ledger
  //       FILE while telling the author to delete an entry, so a detector keyed
  //       on the name rather than on the act would over-reach onto it and stamp
  //       maintainer-only on the improvement path.
  //
  // (3) is what makes (2) worth having: without it, a predicate that approved
  // everything would keep this block green while the convention is gone.
  const unledgered = evaluate(observed([['pin.test.ts', [['TS2578: Unused directive.', 1]]]]), {})[0] ?? '';
  expect(
    '#8435 — the ratchet-offer DETECTOR still matches the unledgered-file verdict (else every '
      + 'assertion below it passes vacuously)',
    RATCHET_EXPANSION_OFFER.test(unledgered),
  );
  expect(
    `#8435 — the unledgered-file verdict marks the ledger path ${RATCHET_AUTHORITY_MARKER} (the ledger `
      + 'is an EXACT, shrink-only ratchet, so ADDING a file to it is a maintainer action — the author '
      + "must be told that where they read it, not only in this file's prose)",
    ratchetRemedyCarriesAuthority(unledgered),
  );

  {
    // SYNTHETIC — and specifically the pre-#8538 wording — rather than the real
    // verdict with the marker stripped out: derived, it would also fire on a
    // rewording, giving two named failures for one rot with the second
    // misdescribing the cause. if/else, not two flat asserts, so exactly one of
    // the two below can fire.
    const unmarkedOffer = `pin.test.ts: 1 type error(s) … Only with a reason: add the file to ${LEDGER_NAME}.`;
    if (!RATCHET_EXPANSION_OFFER.test(unmarkedOffer)) {
      expect(
        '#8435 — the synthetic unmarked-offer fixture is no longer recognised as an offer, so it '
          + 'cannot test discrimination at all. Re-spell it to match RATCHET_EXPANSION_OFFER',
        false,
      );
    } else {
      expect(
        '#8435 — ratchetRemedyCarriesAuthority() REJECTS an offer carrying no marker (proves the '
          + 'predicate discriminates rather than approving everything)',
        !ratchetRemedyCarriesAuthority(unmarkedOffer),
      );
    }
  }

  // The hand-classified control for the detector's GAP. A sibling gate's
  // first-cut regex spelled its gap to exclude the dot, so every offer naming
  // its registry BY PATH silently stopped matching — a vacuous pass that no
  // green run can reveal, because the fail path is where these strings live.
  const pathSpelledOffer = `pin.test.ts: 1 type error(s) … add the file to packages/spec/${LEDGER_NAME}.`;
  expect(
    '#8435 — the detector still matches an offer that names the ledger by PATH rather than by bare '
      + 'filename (a gap narrowed to exclude directories would make the convention unenforceable the '
      + 'moment the message qualified the name)',
    RATCHET_EXPANSION_OFFER.test(pathSpelledOffer),
  );

  const shrank = evaluate(observed([['a.test.ts', [[REQ, 2]]]]), { 'a.test.ts': { [REQ]: 3 } })[0] ?? '';
  if (!shrank.includes('SHRANK')) {
    expect(
      '#8435 — the ratchet-DOWN control is no longer the SHRANK verdict, so it cannot prove the '
        + 'detector leaves the improvement path alone. Re-point it at the re-record message',
      false,
    );
  } else {
    expect(
      '#8435 — the detector does NOT reach the SHRANK verdict (re-recording a number that already fell '
        + "is the ratchet tightening and squarely the author's job; a maintainer-only marker there "
        + 'would teach the opposite of the rule)',
      !RATCHET_EXPANSION_OFFER.test(shrank) && ratchetRemedyCarriesAuthority(shrank),
    );
  }

  const graduated = evaluate(observed([]), { 'a.test.ts': { [REQ]: 3 } })[0] ?? '';
  if (!graduated.includes(LEDGER_NAME)) {
    expect(
      `#8435 — the GRADUATED control no longer names ${LEDGER_NAME}, so it cannot prove the detector is `
        + "keyed on the ACT rather than on the ledger's name. Re-point it at the delete-the-entry message",
      false,
    );
  } else {
    expect(
      '#8435 — the detector does NOT reach the GRADUATED verdict, which names the ledger file while '
        + `telling the author to DELETE an entry. This is the over-reach control: a detector keyed on `
        + `${LEDGER_NAME} instead of on the "add the file to …" ACT would mark the ratchet-tightening `
        + 'path maintainer-only',
      !RATCHET_EXPANSION_OFFER.test(graduated) && ratchetRemedyCarriesAuthority(graduated),
    );
  }

  const grew = evaluate(observed([['a.test.ts', [[REQ, 4]]]]), { 'a.test.ts': { [REQ]: 3 } })[0] ?? '';
  if (!grew.includes('GREW')) {
    expect(
      '#8435 — the GREW control is no longer the debt-grew verdict, so it cannot prove the detector '
        + 'leaves it alone. Re-point it at the grew message',
      false,
    );
  } else {
    expect(
      '#8435 — the detector does NOT reach the GREW verdict (it offers no ledger-expanding path at all; '
        + 'it tells the author to fix the new errors)',
      !RATCHET_EXPANSION_OFFER.test(grew) && ratchetRemedyCarriesAuthority(grew),
    );
  }

  // ── The same authority rule, applied to the per-SIGNATURE offer (#13470) ──
  //
  // ARRIVED is the unledgered-file verdict's sibling one level down: recording
  // a NEW signature against a file that is already ledgered expands an EXACT
  // shrink-only ratchet exactly as adding a whole file does, and it is the more
  // tempting of the two — the file total need not have moved, so it reads like
  // bookkeeping. VANISHED is its opposite and must stay unmarked.
  const arrived = evaluate(observed([['a.test.ts', [[RES, 2]]]]), { 'a.test.ts': { [REQ]: 2 } });
  const arrivedMsg = arrived.find((m) => m.includes('ARRIVED')) ?? '';
  const vanishedMsg = arrived.find((m) => m.includes('VANISHED')) ?? '';

  expect(
    '#13470 — the ratchet-offer DETECTOR reaches the ARRIVED verdict (else the marker assertion below '
      + 'it passes vacuously forever)',
    RATCHET_EXPANSION_OFFER.test(arrivedMsg),
  );
  expect(
    `#13470 — the ARRIVED verdict marks its ledger offer ${RATCHET_AUTHORITY_MARKER}: recording a NEW `
      + 'signature EXPANDS the same shrink-only ratchet that adding a whole file does, and it is the '
      + 'more tempting path because the file total need not have moved',
    ratchetRemedyCarriesAuthority(arrivedMsg),
  );
  expect(
    '#13470 — the detector does NOT reach the VANISHED verdict (an error that is gone is the ratchet '
      + "tightening and squarely the author's job to re-record)",
    vanishedMsg !== '' && !RATCHET_EXPANSION_OFFER.test(vanishedMsg) && ratchetRemedyCarriesAuthority(vanishedMsg),
  );

  // ── The ledger's own prose (#12624) ───────────────────────────────────────
  //
  // Asserted against what `buildLedger()` REALLY emits, because that object is
  // what `--update` writes over every ledger on every repair. The pins are
  // deliberately paired: (A) ARRIVAL — each mechanism sentence is present, and
  // its own control proves that assertion can FAIL; (D) DEPARTURE — the refuted
  // cause is absent, and its own control proves the detector still recognises
  // that clause. A departure pin alone is decoration: it passes against an
  // empty `_comment`, which is exactly the regression it would be there to
  // catch.
  const written = buildLedger(observed([['a.test.ts', [[REQ, 3]]]]))._comment;

  const omissions = ledgerCommentOmissions(written);
  expect(
    `#12624 (A) — the _comment that \`--update\` WRITES carries every mechanism sentence. Missing: `
      + `${omissions.join('; ') || 'none'}. Every repair regenerates this text over the ledger, so this `
      + 'constant is the only place the prose a paydown reader sees can be made true',
    omissions.length === 0,
  );
  expect(
    '#12624 (A-control) — ledgerCommentOmissions() reports EVERY required sentence missing from an empty '
      + 'string (proves the arrival pin can fail; a pin that only asserted the old cause is GONE would '
      + 'pass happily against a `_comment` of "")',
    ledgerCommentOmissions('').length === LEDGER_COMMENT_REQUIRED.length,
  );

  expect(
    '#12624 (D) — the emitted _comment does not restate the #5478/#5543 OUTPUT-vs-INPUT cause, which '
      + 'PR #6786 fixed on 2026-08-08 and which was measured absent from the ledgered files on 2026-08-27',
    !ledgerCommentRestatesRefutedCause(written),
  );
  {
    // SYNTHETIC, and specifically the pre-#12624 wording: the detector must be
    // shown able to recognise the clause it exists to keep out, or its silence
    // above says nothing at all.
    const fossil =
      'almost all of them fixture literals annotated with a schema OUTPUT type (`z.infer`) while '
      + 'holding an authored INPUT literal.';
    expect(
      '#12624 (D-control) — ledgerCommentRestatesRefutedCause() RECOGNISES the pre-#12624 clause (proves '
        + 'the detector discriminates rather than returning false for everything)',
      ledgerCommentRestatesRefutedCause(fossil),
    );
  }

  // The other half of `--update`: it re-records what tsc measured and invents,
  // reorders or rounds nothing. The ledger's NUMBERS are the ratchet itself.
  const built = buildLedger(
    observed([
      ['b.test.ts', [[RES, 2]]],
      ['a.test.ts', [[REQ, 1]]],
    ]),
  );
  expect(
    '#12624 — `--update` writes the measured counts through unchanged and key-sorted (a regeneration '
      + `must move no number): got ${JSON.stringify(built.entries)}`,
    JSON.stringify(built.entries) === JSON.stringify({ 'a.test.ts': { [REQ]: 1 }, 'b.test.ts': { [RES]: 2 } }),
  );
  expect(
    '#13470 — and it writes SIGNATURE keys sorted too, so a regeneration that measured the same errors '
      + `produces a byte-identical file: got ${JSON.stringify(buildLedger(observed([['a.test.ts', [[RES, 1], [REQ, 1]]]])).entries)}`,
    JSON.stringify(buildLedger(observed([['a.test.ts', [[RES, 1], [REQ, 1]]]])).entries) ===
      JSON.stringify(buildLedger(observed([['a.test.ts', [[REQ, 1], [RES, 1]]]])).entries),
  );
  expect(
    '#12624 — with no authored note the written ledger is exactly { _comment, entries } in that order, '
      + `the shape loadLedger() refuses to judge against when it is anything else: got `
      + `${JSON.stringify(Object.keys(built))}`,
    JSON.stringify(Object.keys(built)) === '["_comment","entries"]',
  );
  expect(
    // `in`, not `Object.hasOwn`: this file is in the ROOT tsc program, whose
    // `lib` is ES2020, so a second `Object.hasOwn` would add a TS2550 to a
    // shrink-only raw count (check:type-check-debt). Measured: +1 either way.
    '#12624 — no `_note` key is invented when the ledger carries no authored note',
    !('_note' in built),
  );

  {
    // The authored half. A regeneration that quietly dropped this is the defect
    // #12624 records, committed one level up: the ledger's own correction was
    // being deleted by the very command the ratchet requires after every repair.
    // Asserted VERBATIM and in its own key — that is the whole answer to "how
    // does a reader tell preserved prose from generated prose".
    const note = 'ADR-0122 phase 2 (#6083) emptied this ledger.';
    const withNote = buildLedger(observed([['a.test.ts', [[REQ, 3]]]]), note);
    expect(
      `#12624 — an authored _note is preserved VERBATIM by a regeneration: got ${JSON.stringify(withNote._note)}`,
      withNote._note === note,
    );
    expect(
      '#12624 — the authored note keeps its own key rather than being folded into the generated '
        + '_comment (a reader must be able to tell which half is regenerated, and a merged field cannot '
        + `say): got ${JSON.stringify(Object.keys(withNote))}`,
      JSON.stringify(Object.keys(withNote)) === '["_comment","_note","entries"]' && !withNote._comment.includes(note),
    );
    expect(
      '#12624 — preserving a note moves no number either',
      JSON.stringify(withNote.entries) === JSON.stringify({ 'a.test.ts': { [REQ]: 3 } }),
    );
  }

  if (failures.length) {
    console.error(`✗ check:test-typecheck --self-test — ${failures.length} failure(s)\n`);
    for (const f of failures) console.error('  • ' + f);
    process.exit(1);
  }
  console.log(
    `✓ check:test-typecheck --self-test — ${cases.length} semantic case(s), the parser, the #13470 `
      + 'identity pins (a wholesale substitution at constant cardinality is red and names both the '
      + 'signature that ARRIVED and the one that VANISHED; signatures are position-blind but '
      + 'identity-sharp; the ARRIVED offer is marked maintainer-only and VANISHED is not), the #8435 '
      + 'convention (the unledgered-file verdict keeps its ledger offer marked maintainer-only, and the '
      + 'SHRANK / GRADUATED / GREW verdicts stay unmarked) and the #12624 ledger-prose pins (the text '
      + '`--update` writes carries every mechanism sentence, states no refuted cause, passes the '
      + 'measured counts through unchanged, and preserves an authored `_note` verbatim in its own key) '
      + 'all hold.',
  );
}

if (process.argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

const counts = parseDiagnostics(runTsc());

if (process.argv.includes('--update')) {
  writeLedger(counts);
  const total = [...counts.values()].reduce((a, sigs) => a + totalErrors(sigs), 0);
  const signatures = [...counts.values()].reduce((a, sigs) => a + sigs.size, 0);
  console.log(
    `check:test-typecheck — re-recorded ${LEDGER_NAME}: ${counts.size} file(s), ${total} error(s), ` +
      `${signatures} distinct signature(s).`,
  );
  process.exit(0);
}

const problems = evaluate(counts, loadLedger().entries);
if (problems.length) {
  console.error(`check:test-typecheck: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error('  • ' + p);
  process.exit(1);
}

const total = [...counts.values()].reduce((a, sigs) => a + totalErrors(sigs), 0);
const signatures = [...counts.values()].reduce((a, sigs) => a + sigs.size, 0);
console.log(
  `check:test-typecheck: OK — ${PKG_NAME}'s test layer compiles under ${PKG_DIR}/${PROJECT}; ` +
    `${counts.size} file(s) / ${total} error(s) / ${signatures} pinned signature(s) held in ` +
    `${LEDGER_NAME} (shrink-only and identity-pinned, ${ISSUE}).`,
);
