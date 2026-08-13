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
// client), overwhelmingly fixture object literals annotated with a schema's
// OUTPUT type (`z.infer`) while holding an authored INPUT literal — so every
// defaulted key reads as "missing". Hand-fixing 691 of those in the PR that
// opens the gate would bury the gate. They are ledgered per file instead, in
// the package's own `test-typecheck-debt.json`, and the ledger is EXACT:
// recorded must equal measured. That is what makes it shrink-only in practice —
//
//   • a file gains errors      → red ("grew")
//   • a file loses errors      → red ("shrank; re-record") — so the number
//                                tracks reality downward instead of rotting
//   • a file reaches zero      → red ("graduated; delete the entry")
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
  'no gate ever read — and every file below still carries errors from before that gate existed, ' +
  'almost all of them fixture literals annotated with a schema OUTPUT type (`z.infer`) while holding ' +
  'an authored INPUT literal. EXACT ratchet, judged by re-running tsc: a file that gains errors is red, ' +
  'a file that loses them is red until its number is re-recorded, a file that reaches zero is red until ' +
  'its entry is deleted, and a file NOT listed here may have no errors at all. Regenerate with: ' +
  UPDATE_COMMAND;

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
  `add the file to\\s+(?:\\S*\\/)?${LEDGER_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
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

type Ledger = { _comment: string; entries: Record<string, number> };

/** `path(line,col): error TSxxxx: …` — continuation lines of a multi-line message never match. */
const DIAGNOSTIC = /^(\S[^(]*)\((\d+),(\d+)\): error (TS\d+): /;

/**
 * Per-file error counts from a raw `tsc --noEmit --pretty false` transcript.
 * Paths are normalised to posix and relative to the package being judged, so
 * the ledger reads the same on every platform.
 */
export function parseDiagnostics(output: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of output.split(/\r?\n/)) {
    const m = DIAGNOSTIC.exec(line);
    if (!m) continue;
    const file = m[1].split(path.sep).join('/');
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  return counts;
}

/**
 * The verdict, as a pure function over observed counts and the recorded ledger,
 * so the self-test proves the semantics the real run applies.
 */
export function evaluate(actual: Map<string, number>, ledger: Record<string, number>): string[] {
  const problems: string[] = [];

  for (const [file, count] of [...actual].sort(([a], [b]) => a.localeCompare(b))) {
    if (!Object.hasOwn(ledger, file)) {
      problems.push(
        `${file}: ${count} type error(s) in a file the ledger does not cover. Fix them — this file is ` +
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
    if (count > recorded) {
      problems.push(
        `${file}: ${count} type error(s), ledger records ${recorded} — the debt GREW. Fix the ${count - recorded} ` +
          `new one(s); the ledger only ratchets down (${ISSUE}).`,
      );
    } else if (count < recorded) {
      problems.push(
        `${file}: ${count} type error(s), ledger records ${recorded} — the debt SHRANK, which is the goal. ` +
          `Re-record it so the number stays true: ${UPDATE_COMMAND}.`,
      );
    }
  }

  for (const [file, recorded] of Object.entries(ledger).sort(([a], [b]) => a.localeCompare(b))) {
    if (typeof recorded !== 'number' || !Number.isInteger(recorded) || recorded <= 0) {
      problems.push(
        `${file}: ledger entry is not a positive integer error count (${JSON.stringify(recorded)}) — ` +
          `a ledger without a measurement is a permission slip.`,
      );
      continue;
    }
    if (!actual.has(file)) {
      problems.push(
        `${file}: ledger records ${recorded} type error(s) but tsc reports none — it GRADUATED, or the file ` +
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

function writeLedger(counts: Map<string, number>): void {
  const entries: Record<string, number> = {};
  for (const file of [...counts.keys()].sort()) entries[file] = counts.get(file)!;
  const ledger: Ledger = { _comment: LEDGER_COMMENT, entries };
  fs.writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
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
  const cases: Array<{ label: string; actual: Array<[string, number]>; ledger: Record<string, number>; expect: RegExp[] }> = [
    {
      label: 'a clean, unledgered file passes',
      actual: [],
      ledger: {},
      expect: [],
    },
    {
      label: 'a ledgered file at its recorded count passes',
      actual: [['a.test.ts', 3]],
      ledger: { 'a.test.ts': 3 },
      expect: [],
    },
    {
      label: 'an error in an unledgered file is red — the everyday case, and what a deleted directive produces',
      actual: [['pin.test.ts', 1]],
      ledger: {},
      expect: [/pin\.test\.ts: 1 type error\(s\) in a file the ledger does not cover/],
    },
    {
      label: 'a ledgered file that gains an error is red',
      actual: [['a.test.ts', 4]],
      ledger: { 'a.test.ts': 3 },
      expect: [/a\.test\.ts: 4 type error\(s\), ledger records 3 — the debt GREW/],
    },
    {
      label: 'a ledgered file that loses an error is red until re-recorded',
      actual: [['a.test.ts', 2]],
      ledger: { 'a.test.ts': 3 },
      expect: [/a\.test\.ts: 2 type error\(s\), ledger records 3 — the debt SHRANK/],
    },
    {
      label: 'a graduated file is red until its entry is deleted',
      actual: [],
      ledger: { 'a.test.ts': 3 },
      expect: [/a\.test\.ts: ledger records 3 type error\(s\) but tsc reports none/],
    },
    {
      label: 'a ledger entry without a real measurement is red',
      actual: [],
      ledger: { 'a.test.ts': 0 },
      expect: [/a\.test\.ts: ledger entry is not a positive integer error count/],
    },
    {
      label: 'problems from both directions are reported together',
      actual: [
        ['a.test.ts', 4],
        ['new.test.ts', 1],
      ],
      ledger: { 'a.test.ts': 3, 'gone.test.ts': 2 },
      expect: [
        /a\.test\.ts: 4 type error\(s\), ledger records 3 — the debt GREW/,
        /new\.test\.ts: 1 type error\(s\) in a file the ledger does not cover/,
        /gone\.test\.ts: ledger records 2 type error\(s\) but tsc reports none/,
      ],
    },
  ];

  const failures: string[] = [];
  for (const c of cases) {
    const got = evaluate(new Map(c.actual), c.ledger);
    if (got.length !== c.expect.length || !c.expect.every((rx, i) => rx.test(got[i]))) {
      failures.push(`${c.label}: expected ${c.expect.length} problem(s) matching ${c.expect}, got ${JSON.stringify(got)}`);
    }
  }

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
  if (parsed.size !== 2 || parsed.get('src/a.test.ts') !== 2 || parsed.get('src/b.test.ts') !== 1) {
    failures.push(`parseDiagnostics mis-read a multi-line transcript: ${JSON.stringify([...parsed])}`);
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
  const expect = (label: string, cond: boolean): void => {
    if (!cond) failures.push(label);
  };

  const unledgered = evaluate(new Map([['pin.test.ts', 1]]), {})[0] ?? '';
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

  const shrank = evaluate(new Map([['a.test.ts', 2]]), { 'a.test.ts': 3 })[0] ?? '';
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

  const graduated = evaluate(new Map<string, number>(), { 'a.test.ts': 3 })[0] ?? '';
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

  const grew = evaluate(new Map([['a.test.ts', 4]]), { 'a.test.ts': 3 })[0] ?? '';
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

  if (failures.length) {
    console.error(`✗ check:test-typecheck --self-test — ${failures.length} failure(s)\n`);
    for (const f of failures) console.error('  • ' + f);
    process.exit(1);
  }
  console.log(
    `✓ check:test-typecheck --self-test — ${cases.length} semantic case(s), the parser, and the #8435 `
      + 'convention hold (the unledgered-file verdict keeps its ledger offer marked maintainer-only, '
      + 'and the SHRANK / GRADUATED / GREW verdicts stay unmarked).',
  );
}

if (process.argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

const counts = parseDiagnostics(runTsc());

if (process.argv.includes('--update')) {
  writeLedger(counts);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  console.log(`check:test-typecheck — re-recorded ${LEDGER_NAME}: ${counts.size} file(s), ${total} error(s).`);
  process.exit(0);
}

const problems = evaluate(counts, loadLedger().entries);
if (problems.length) {
  console.error(`check:test-typecheck: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error('  • ' + p);
  process.exit(1);
}

const total = [...counts.values()].reduce((a, b) => a + b, 0);
console.log(
  `check:test-typecheck: OK — ${PKG_NAME}'s test layer compiles under ${PKG_DIR}/${PROJECT}; ` +
    `${counts.size} file(s) / ${total} error(s) held in ${LEDGER_NAME} (shrink-only, ${ISSUE}).`,
);
