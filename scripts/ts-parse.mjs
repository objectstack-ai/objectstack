#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ts-parse -- the ONE answer to "did this source actually parse?"
 *
 *   node scripts/ts-parse.mjs --self-test
 *
 * ## The defect this closes
 *
 * **`ts.createSourceFile` never throws.** Hand it merge-conflict markers, a
 * truncated body, or a source read under the wrong `ScriptKind` and it returns
 * a `SourceFile` that looks like any other: the errors are parked on
 * `parseDiagnostics`, a property NOTHING in `scripts/` read. A gate then walks
 * that wreckage, finds none of the shapes it is looking for, and scores the
 * file CLEAN -- **a file the gate could not read is reported as a file with
 * nothing to report.** The gate prints its green line, its count is lower than
 * it should be, and nothing anywhere says which file went unread.
 *
 * Measured here on 2026-08-21 against TypeScript 6.0.3 -- every one of these
 * returns a tree and exits normally:
 *
 *   source                              ScriptKind.TS    ScriptKind.TSX
 *   -------------------------------     --------------   --------------
 *   merge-conflict markers               3 diagnostics    3 diagnostics
 *   truncated function body              1 diagnostic     1 diagnostic
 *   a JSX element                        4 diagnostics    0
 *   `const id = <T>(x: T): T => x;`      0                3 diagnostics
 *
 * ## This is not hypothetical here -- it was LIVE on `main` when this landed
 *
 * The last two rows are the same defect wearing the `ScriptKind` hat, and one
 * gate in this tree was standing on them. `check-engine-double-contract.mjs`
 * walked 2504 `*.{test,spec}.{ts,tsx,mts}` files under `packages/` and
 * `examples/` while forcing `ts.ScriptKind.TSX` on every one of them. In TSX a
 * `<` opens a JSX element, so an ordinary `new Map<string, X>()` or a generic
 * arrow made the rest of the file wreckage. **32 of its 2504 files parsed with
 * parse errors** (up to 633 diagnostics in one file), and the gate reported:
 *
 *   check-engine-double-contract: OK -- 342 pinned, 133 in the DEBT ledger, 2 exempt.
 *
 * Reading the same 2504 files under the ScriptKind their own file names imply
 * turns that line into `6 problem(s)`: three test files were pinning six engine
 * doubles that the ledger had never recorded, because the scan had never been
 * able to see them. The census moved 236 -> 239 delete doubles and 272 -> 275
 * update doubles at the same time. Nothing about the tree changed; only whether
 * the gate could read it. That is the whole failure mode in one measurement,
 * and it is why the refusal below is not a defensive nicety.
 *
 * ## Why ONE module rather than 15 copies of a three-line check
 *
 * A shared helper is a second source of truth WHILE THE FIRST ONE IS STILL
 * REACHABLE. That is the real objection to a helper, and it is answered by
 * removing the first source rather than by arguing: `check-parse-guard.mjs`
 * next door fails on a raw `ts.createSourceFile` anywhere in `scripts/**`
 * outside this file, so there is no second spelling left to drift from.
 *
 * The tree has already run this experiment twice, and both results are in
 * `scripts/`:
 *
 *   • `invoked-as.mjs` -- "was I run, or imported?" -- replaced ELEVEN
 *     hand-typed spellings across 33 files, NINE of them wrong, and
 *     `check-entry-guard.mjs` is the half that stops a twelfth being typed.
 *   • `js-comment-mask.mjs` -- "is this span code, or prose?" -- replaced two
 *     families of private `stripComments`, each silently wrong in a different
 *     direction.
 *
 * A per-gate copy of "and check the diagnostics" would drift the same way: one
 * reads `.length` on a field it forgot can be undefined, one warns instead of
 * failing, one is simply never typed into the sixteenth gate -- and a missing
 * copy is invisible, because its symptom is a green line.
 *
 * ## Three parser entry points, ONE question
 *
 * `createSourceFile` is not the only way into the TypeScript parser, and the
 * other two are quieter still. Measured here against TypeScript 6.0.3:
 *
 *   • **`ts.createProgram`** parks syntax errors behind a SECOND call,
 *     `getSyntacticDiagnostics()`. A Program nobody asks answers every type
 *     question it is given about a tree it could not read, and the answers look
 *     exactly like answers about a tree it could.
 *   • **`ts.transpileModule`** reports NOTHING AT ALL unless
 *     `reportDiagnostics: true` is passed -- the quietest of the three. Hand it
 *     a snippet with a dropped operand and it hands back
 *     `return row.a === ;` as `outputText`: output that is not JavaScript, with
 *     an empty diagnostic list, because the list was never requested.
 *
 * Both were live in this tree when this section landed, and both had the SAME
 * shape as the `createSourceFile` defect rather than a milder one:
 * `check-published-readme-exports.mjs` built a Program and never called
 * `getSyntacticDiagnostics`, and `check-where-matcher-conformance.mjs`
 * transpiled without `reportDiagnostics`, where the un-runnable `outputText`
 * became a `new Function` throw that the caller's own `catch` filed as
 * `UNJUDGED` -- a source the gate could not READ, recorded as a source it could
 * not JUDGE, which is a different and much quieter claim.
 *
 * `createProgramChecked` and `transpileChecked` below route those two through
 * the same refusal, so "did this parse?" has one answer under `scripts/**`
 * whichever entry point a gate reaches for -- and `check-parse-guard.mjs` fails
 * on all three raw spellings, so there is no fourth answer to drift into.
 *
 * ## Why it EXITS rather than throws
 *
 * A throw is swallowable, and the swallow is already written down in this repo:
 * `packages/lint/src/validate-react-page-props.ts` and
 * `lint-startup-registry-verdict.ts` both wrap `createSourceFile` in
 * `try { ... } catch { continue / return [] }` -- dead code today, guarding
 * against a throw that cannot happen, and a SILENT SKIP the moment a parse
 * started throwing. Exiting cannot be caught, so a refusal cannot be downgraded
 * into a quieter answer by a caller that meant well.
 *
 * Exit code 3, deliberately not 1: "this gate found violations" and "this gate
 * could not read the tree" are different verdicts and a reader should not have
 * to guess which one they got. Both are non-zero, so CI fails either way.
 *
 * ## A FOURTH door, for a different question: text THIS PROCESS synthesised
 *
 * The three doors above all answer "could I read this tree?", and a refusal is
 * right for that question because the tree belongs to the gate's own author.
 * `packages/lint/src/checked-parse.ts` records the other side of the same axis
 * in as many words: it answers the same question by REPORTING rather than
 * refusing, "because a `scripts/**` gate audits a tree its own author controls"
 * while "a publish-time validator is handed metadata by someone else".
 *
 * A third position was never written down, and a gate in this tree was standing
 * on it. `tenant-audit-census.mjs` reads a receiver's declared type out of a
 * source that PARSED, stores that type's text whitespace-collapsed, and later
 * re-parses the stored text as a synthetic type alias
 * (`type CensusReceiver = <the stored text>;`) to ask whether it declares a
 * write door. When the collapse loses a member separator -- a type literal may
 * separate its members by a newline alone, which is legal TypeScript and
 * collapses to nothing -- the synthetic alias does not parse, and the census
 * takes `EXIT_UNPARSEABLE` for the whole run.
 *
 * Measured on 2026-09-18 against TypeScript 6.0.3:
 *
 *   type text                                              alias parses?
 *   ----------------------------------------------------   -------------
 *   { insert(o: string): Promise<void>                      yes  (0 diags)
 *     find(o: string): Promise<void> }        <- authored
 *   { insert(o: string): Promise<void>                      NO   (1 diag,
 *     find(o: string): Promise<void> }        <- collapsed       "';' expected")
 *   { insert(o: string): Promise<void>;                     yes  (0 diags)
 *     find(o: string): Promise<void>; }       <- lit control
 *
 * The refusal's own text is what makes the misfit legible: it names
 * `census-receiver-type.ts`, a file that does not exist in the tree, and its
 * reasoning -- "a file the gate could not read, reported as a file with nothing
 * to report" -- is FALSE here. The gate read the file. What did not round-trip
 * is the gate's own re-serialisation of a fragment of it, and that is a fact
 * about the synthesiser, never about the corpus. Ending the process on it turns
 * one site's unanswerable question into no answer for any site.
 *
 * So {@link parseDerivedText} answers "did the text I synthesised parse?" and
 * hands the verdict BACK, and the floor is held by making that door unreachable
 * for the question the refusal exists for: it takes an `origin` -- a
 * `ts.SourceFile` this module has already certified -- and the only way to hold
 * one is {@link parseSourceFile} returning, or a Program {@link
 * createProgramChecked} vouched for. Both of those EXIT on a source that does
 * not parse. ⇒ a source the gate could not read cannot reach the returnable
 * door: it hits the refusal first, by construction rather than by review.
 * Handing an uncertified origin is itself a refusal ({@link
 * EXIT_DERIVED_MISUSE}), for the reason the section above gives: a throw there
 * would be one `catch` away from the silent skip.
 *
 * Two deliberate divergences from the `packages/lint` sibling, both in the
 * strict direction, because this is `scripts/**`:
 *
 *   • it returns NO tree on failure (`sourceFile: null`), where the sibling
 *     always returns the recovered one. The sibling has callers that already
 *     report findings off a partial tree; here there are none, and a recovered
 *     tree is the thing a caller walks before scoring it clean. A caller that
 *     forgets to branch gets a TypeError, which is loud and non-zero.
 *   • the failure is not swallowable into a PASS. It is data, so a caller can
 *     attribute it to one site -- but there is no verdict in it that reads as
 *     "nothing to report", and `parseCensus()` counts it as a `rejection`,
 *     never as a `refusal`: the run continued, and a census that conflated the
 *     two would be lying about its own numerator.
 *
 * ## The knobs that are NOT knobs
 *
 * `ScriptTarget.Latest` and `setParentNodes: true` are fixed here because all
 * 34 `createSourceFile` lines in `scripts/` passed exactly those -- measured,
 * not assumed -- and a call site that needs a different pair should say so once,
 * here, rather than re-open a five-argument call for everyone.
 *
 * `scriptKind` stays a parameter because it is genuinely per-call-site, and
 * **omitting it is the safe default**: TypeScript then infers it from the file
 * name's extension, which is what a scan over a real tree wants and is exactly
 * what the engine-double-contract measurement above is about. Pass it only for
 * a source that has no real file name -- a fixture string in a self-test.
 *
 * ## Counting, for a census that has a numerator
 *
 * With `OS_TOOLING_PARSE_CENSUS` set, this module prints how many parses ran,
 * over how many distinct file names, and how many refused, when the process
 * exits. It only ADDS observation. The report is armed by the FIRST PARSE, not
 * by the import -- see `armCensusReport` for why the entry-point guard is the
 * wrong shape for a library. There is deliberately no env var that turns the
 * refusal off: a guard with a documented bypass is a guard that will be
 * bypassed.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { requireDefaultExport } from './import-prerequisite.mjs';
const ts = await requireDefaultExport('typescript', () => import('typescript'), import.meta.url);

import { isEntrypoint } from './invoked-as.mjs';

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// This self-test used to decide success by "no failure was recorded" and
// nothing else, so "every case held" and "the cases never ran" printed the same
// line. Closed the way PR #13487 validated on check-doc-authoring: what is
// pinned is the registered NAMES, not a number. Every section opens with
// `battery('<name>')`, every assertion is attributed to the battery most
// recently opened, and the floor requires the OPENED set to equal the DECLARED
// set with each battery at or above its own count.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3 keeps
// a total "right" the moment a sibling grows. A set difference says WHICH
// battery stopped; a count says only that something did.
//
// The counts are a FLOOR, not an equality — adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running; the
// remedy is to find what stopped registering.
//
// The machinery lives HERE, at module scope, rather than inside the self-test:
// this self-test's assertion sink is not a block-bodied helper in its body (it
// is a concise arrow, or a module-scope function), so there is no in-body
// helper to thread a per-run ledger through. Module scope is safe because the
// self-test runs once per process, and it is what lets the existing sink route
// through `registerCase()` with no case rewritten and no assertion changed.
const SELF_TEST_BATTERIES = Object.freeze({
  'a clean source still parses, and the tree is usable': 1,
  'THE case: each measured wreck refuses instead of scoring clean': 6,
  'the refusal carries a location a reader can open': 1,
  'ScriptKind, both directions. This is the shape that hides in a green': 4,
  'the refusal is NOT swallowable, which is why it exits rather than': 1,
  'the census has a numerator': 1,
  'and the report is armed by the first PARSE, not by the IMPORT. Both': 2,
  'ts.createProgram: the syntax lives behind a SECOND call': 4,
  'ts.transpileModule: the quietest of the three': 4,
  'the refusal is not swallowable on the new doors either': 1,
  'the census names which door each source came through': 1,
  'the diagnostics reader itself, in-process': 4,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 12;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

// ⚠️ None of these helpers is named with a self-test spelling, deliberately and
// on the record: `check:pm-dispatch-gates` anchors on a top-level declaration
// whose NAME spells self-test, and every such name owes a row in that gate's
// COMPOUND_ANCHOR_LEDGER. These are the battery ROSTER's machinery -- they hold
// no fixtures to mask and read no path literal -- so the accurate name is the
// one that says `battery`, not the one that would owe a ledger row for a role
// this code does not have.

/** Cases registered per battery: `battery()` opens one, `registerCase()` files into it. */
const batteryCases = new Map();
let openBattery = null;

/** Open a battery. Every assertion after this line is attributed to it. */
function battery(name) {
  openBattery = name;
}

/** Called by the self-test's own assertion sink, once per assertion. */
function registerCase() {
  const name = openBattery ?? UNATTRIBUTED_BATTERY;
  batteryCases.set(name, (batteryCases.get(name) ?? 0) + 1);
}

/**
 * The floor: every declared battery RAN, and ran its cases (#13489).
 *
 * Evaluated after every battery has had its chance and BEFORE the verdict, so
 * the success line can only be printed by a run in which the set of batteries
 * that registered assertions EQUALS the set declared.
 */
function batteryFloorFailures() {
  const declared = Object.keys(SELF_TEST_BATTERIES);
  const problems = [];
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    problems.push(
      `SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batteryCases) {
    if (declared.includes(name)) continue;
    problems.push(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declared) {
    const count = batteryCases.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    problems.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (problems.length) {
    problems.push(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (an early return, a deleted block, a guard that now '
        + 'skips) and restore it.',
    );
  }
  return problems;
}

/**
 * The exit status of a refusal. Distinct from 1 ("this gate found violations")
 * so a reader can tell "there is nothing to report" from "I could not read it".
 */
export const EXIT_UNPARSEABLE = 3;

/** Parses attempted, the distinct file names, the refusals and the rejections. */
const census = {
  parses: 0, programs: 0, transpiles: 0, derived: 0, files: new Set(), refusals: 0, rejections: 0,
};

/**
 * A snapshot of what this module has been asked to parse in this process.
 *
 * `parses` counts every source that reached the parser through ANY of the four
 * entry points, so it stays the numerator of "how much of this run was read";
 * `programs`, `transpiles` and `derived` say which door they came through.
 *
 * `refusals` and `rejections` are deliberately separate totals rather than one
 * "failures" number. A refusal ENDED THE RUN, so every source after it went
 * unread and the numerator above is short by an unknown amount; a rejection is
 * a verdict {@link parseDerivedText} handed back about text this process
 * synthesised, with the run still going and every later source still read. A
 * single total would make those two indistinguishable in the one report whose
 * job is to say how much of the run was actually measured.
 */
export function parseCensus() {
  return {
    parses: census.parses,
    programs: census.programs,
    transpiles: census.transpiles,
    derived: census.derived,
    files: census.files.size,
    refusals: census.refusals,
    rejections: census.rejections,
  };
}

/**
 * The `ts.SourceFile`s this module has CERTIFIED as parseable.
 *
 * Membership is what {@link parseDerivedText} requires of its `origin`, and it
 * is the whole floor argument for that door: a source the parser could not read
 * never becomes a member, because the two doors that add members
 * ({@link parseSourceFile}, {@link createProgramChecked}) end the process
 * instead of returning. So the one door in this module whose failure is
 * RETURNABLE is unreachable for the input the refusal exists for.
 *
 * A `WeakSet` so a long scan does not retain every tree it has read, and so
 * `has()` answers `false` for a non-object rather than throwing -- an
 * uncertified origin must reach the misuse refusal, not a TypeError.
 */
const vouchedSources = new WeakSet();

let censusReportArmed = false;

/**
 * Arm the exit report ONCE, on the first parse rather than on the import.
 *
 * This module is a LIBRARY -- eleven gates in `scripts/` import it for its
 * exports -- and the report used to be registered by a top-level
 * `if (process.env.OS_TOOLING_PARSE_CENSUS)`. That ran inside every one of
 * those importers: a module wrote to a process whose only involvement was
 * having loaded it.
 *
 * The entry-point guard is NOT the fix here, and this is the interesting half.
 * As an entrypoint this module parses nothing at all, so
 * `if (isEntrypoint(...))` would arm the census on the one run that has
 * nothing to count and leave it silent on every run that does -- a report that
 * is now import-safe and also permanently empty. The condition had to move,
 * not acquire a guard.
 *
 * So the trigger becomes "this module was USED" instead of "this module was
 * LOADED", which is the event the number is about anyway. One measurable
 * consequence, stated here rather than left to be discovered: a process that
 * imports this module and never parses now prints nothing where it used to
 * print `0 parse(s)`. Nothing read that line -- `OS_TOOLING_PARSE_CENSUS`
 * appears in no other file in the tree -- and a census whose numerator is zero
 * is the case with nothing to report. The self-test pins BOTH directions, so
 * neither the leak nor the over-correction can come back unnoticed.
 */
function armCensusReport() {
  if (censusReportArmed || !process.env.OS_TOOLING_PARSE_CENSUS) return;
  censusReportArmed = true;
  process.on('exit', () => {
    const c = parseCensus();
    process.stderr.write(
      `[ts-parse census] ${c.parses} parse(s) over ${c.files} distinct file name(s) `
        + `(${c.programs} program(s), ${c.transpiles} transpile(s), ${c.derived} derived); `
        + `${c.refusals} refusal(s), ${c.rejections} rejection(s)\n`,
    );
  });
}

/**
 * The parse errors TypeScript recorded for `sourceFile`, as plain rows.
 *
 * `parseDiagnostics` is not on the public `SourceFile` type -- it lives on the
 * internal shape -- which is most of why it goes unread. It has been populated
 * by the parser since the compiler had one, and reading it is the only way to
 * learn that a tree is wreckage. The cast is contained HERE, in one function,
 * rather than repeated at every call site: that containment is a second reason
 * this module exists.
 *
 * Answers `[]` for anything that is not a source file rather than throwing, so
 * a caller cannot turn a bad argument into a crash it then catches.
 *
 * @param {ts.SourceFile} sourceFile
 * @returns {{ line: number, column: number, message: string }[]}
 */
export function describeDiagnostics(sourceFile) {
  const raw = /** @type {any} */ (sourceFile)?.parseDiagnostics;
  if (!Array.isArray(raw)) return [];
  return raw.map((d) => {
    const at = typeof d.start === 'number'
      ? ts.getLineAndCharacterOfPosition(sourceFile, d.start)
      : { line: 0, character: 0 };
    return {
      line: at.line + 1,
      column: at.character + 1,
      message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
    };
  });
}

/** `ScriptKind.TSX` -> `'TSX'`, and a phrase for the inferred case. */
function describeScriptKind(scriptKind) {
  if (scriptKind === undefined) return 'inferred from the file name';
  for (const [name, value] of Object.entries(ts.ScriptKind)) {
    if (value === scriptKind && Number.isNaN(Number(name))) return name;
  }
  return String(scriptKind);
}

/**
 * `ts.Diagnostic[]` -- the shape `getSyntacticDiagnostics()` and
 * `transpileModule`'s `diagnostics` hand back -- as the same plain rows
 * {@link describeDiagnostics} produces, so all three refusals read identically
 * in a log. `file` is carried because a Program's diagnostics span many files
 * while one parse's do not.
 *
 * @param {readonly ts.Diagnostic[]} diagnostics
 * @returns {{ line: number, column: number, message: string, file?: string }[]}
 */
export function describeTsDiagnostics(diagnostics) {
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics.map((d) => {
    const at = d.file && typeof d.start === 'number'
      ? ts.getLineAndCharacterOfPosition(d.file, d.start)
      : { line: 0, character: 0 };
    return {
      line: at.line + 1,
      column: at.character + 1,
      message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
      file: d.file?.fileName,
    };
  });
}

/**
 * The first five locations of a refusal, plus an `and N more` line. Shared by
 * all three refusals so a reader who has learned to open one has learned to
 * open all of them.
 */
function locationLines(fileName, rows) {
  const shown = rows.slice(0, 5);
  const rest = rows.length - shown.length;
  return [
    ...shown.map((d) => `      ${d.file ?? fileName}:${d.line}:${d.column}  ${d.message}`),
    ...(rest > 0 ? [`      … and ${rest} more`] : []),
  ];
}

/**
 * The closing half every refusal shares: why the run ends here rather than
 * carrying on over a source nobody could read.
 */
const REFUSAL_WHY = [
  `    A scan of a tree the parser could not read finds none of what it is`,
  `    looking for and scores the source CLEAN — a source the gate could not`,
  `    read, reported as a source with nothing to report. The run is aborted`,
  `    instead: a number nobody measured is worse than no number.`,
  ``,
];

/**
 * The refusal text. Separate from the exit so the self-test can read it, and so
 * the wording is pinned by a case rather than by whoever reads it next.
 */
export function refusalReport(fileName, scriptKind, diagnostics) {
  const shown = diagnostics.slice(0, 5);
  const rest = diagnostics.length - shown.length;
  return [
    `x  ts-parse — REFUSING to scan a source that does not parse.`,
    ``,
    `    file       ${fileName}`,
    `    parsed as  ${describeScriptKind(scriptKind)}`,
    `    errors     ${diagnostics.length} parse diagnostic(s) from TypeScript ${ts.version}`,
    ``,
    ...shown.map((d) => `      ${fileName}:${d.line}:${d.column}  ${d.message}`),
    ...(rest > 0 ? [`      … and ${rest} more`] : []),
    ``,
    `    ts.createSourceFile never throws: it returns a tree with the errors`,
    `    parked on parseDiagnostics. A scan of that tree finds none of what it`,
    `    is looking for and would score this file CLEAN — a file the gate could`,
    `    not read, reported as a file with nothing to report. The run is aborted`,
    `    instead: a number nobody measured is worse than no number.`,
    ``,
    `    If this file compiles for tsc, suspect the ScriptKind this call site`,
    `    passes. <T>(x) => x is a generic arrow in TS and an unterminated JSX`,
    `    tag in TSX; a JSX element is the reverse. Omitting scriptKind lets the`,
    `    file name decide, which is what a scan over a real tree wants.`,
    ``,
  ].join('\n');
}

/**
 * Parse `text` as TypeScript, or refuse.
 *
 * The ONLY sanctioned way to build a `ts.SourceFile` under `scripts/**` -- see
 * `check-parse-guard.mjs`, which fails on a raw `ts.createSourceFile` anywhere
 * else in that tree.
 *
 * @param {string} fileName  What the tree is called. Its extension picks the
 *   ScriptKind when `scriptKind` is omitted, so pass the real path when you
 *   have one.
 * @param {string} text  The source.
 * @param {ts.ScriptKind} [scriptKind]  Omit to let the file name decide.
 * @returns {ts.SourceFile} A tree with NO parse errors. There is no other
 *   return: an unparseable source ends the process with {@link EXIT_UNPARSEABLE}.
 */
export function parseSourceFile(fileName, text, scriptKind) {
  armCensusReport();
  census.parses += 1;
  census.files.add(fileName);

  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKind,
  );

  const diagnostics = describeDiagnostics(sourceFile);
  if (diagnostics.length > 0) {
    census.refusals += 1;
    process.stderr.write(refusalReport(fileName, scriptKind, diagnostics));
    process.exit(EXIT_UNPARSEABLE);
  }
  vouchedSources.add(sourceFile);
  return sourceFile;
}

/**
 * The refusal text for a Program whose sources do not parse.
 *
 * Pinned here rather than inlined for the same reason {@link refusalReport} is:
 * a self-test case reads it, so the wording answers to a case instead of to
 * whoever edits it next.
 */
export function programRefusalReport(rootNames, rows) {
  return [
    `x  ts-parse — REFUSING to query a Program whose sources do not parse.`,
    ``,
    `    roots      ${rootNames.length} entry point(s), starting at ${rootNames[0] ?? '(none)'}`,
    `    errors     ${rows.length} syntactic diagnostic(s) from TypeScript ${ts.version}`,
    ``,
    ...locationLines(rootNames[0] ?? '(unknown)', rows),
    ``,
    `    ts.createProgram does not throw and does not volunteer this: syntax`,
    `    errors sit behind a SECOND call, getSyntacticDiagnostics(), which most`,
    `    callers never make. Every checker answer below an unread Program —`,
    `    "does this type have that member?", "what does this module export?" —`,
    `    is then an answer about a tree the compiler could not read, and it is`,
    `    shaped exactly like an answer about a tree it could.`,
    ``,
    ...REFUSAL_WHY,
  ].join('\n');
}

/**
 * The refusal text for a source that could not be transpiled.
 */
export function transpileRefusalReport(fileName, rows) {
  return [
    `x  ts-parse — REFUSING to run output transpiled from a source that does not parse.`,
    ``,
    `    file       ${fileName}`,
    `    errors     ${rows.length} diagnostic(s) from TypeScript ${ts.version}`,
    ``,
    ...locationLines(fileName, rows),
    ``,
    `    ts.transpileModule reports NOTHING unless reportDiagnostics: true is`,
    `    passed, and it still returns an outputText — text that is not`,
    `    JavaScript, handed back as if it were. A caller that runs it gets a`,
    `    throw from somewhere else entirely, one \`catch\` away from being filed`,
    `    as "could not judge this candidate" rather than "could not read it".`,
    ``,
    ...REFUSAL_WHY,
  ].join('\n');
}

/**
 * Build a `ts.Program`, or refuse.
 *
 * The ONLY sanctioned way to build one under `scripts/**` -- see
 * `check-parse-guard.mjs`, which fails on a raw `ts.createProgram` anywhere
 * else in that tree.
 *
 * The check is `program.getSyntacticDiagnostics()` over EVERY file the Program
 * pulled in, not just the roots. A Program's answers are transitive -- an entry
 * point's exported type is read out of whatever file declares it -- so a root
 * that parsed while its declaration source did not is exactly the state that
 * produces confident answers about an unread tree. Syntactic only: a SEMANTIC
 * diagnostic is a fact about the code under test and belongs to the caller's
 * own verdict, while a syntactic one means there is no code under test.
 *
 * @param {readonly string[]} rootNames
 * @param {ts.CompilerOptions} options
 * @param {ts.CompilerHost} [host]
 * @returns {ts.Program} A Program with NO syntax errors. There is no other
 *   return: unparseable sources end the process with {@link EXIT_UNPARSEABLE}.
 */
export function createProgramChecked(rootNames, options, host) {
  armCensusReport();
  const roots = [...rootNames];
  census.programs += 1;
  census.parses += roots.length;
  for (const r of roots) census.files.add(r);

  const program = host === undefined
    ? ts.createProgram(roots, options)
    : ts.createProgram(roots, options, host);

  const rows = describeTsDiagnostics(program.getSyntacticDiagnostics());
  if (rows.length > 0) {
    census.refusals += 1;
    process.stderr.write(programRefusalReport(roots, rows));
    process.exit(EXIT_UNPARSEABLE);
  }
  // Every file this Program pulled in has just been through the syntactic
  // check above -- transitively, which is the point of checking the whole
  // Program rather than its roots -- so each one is certified for
  // {@link parseDerivedText}. A gate that reads its corpus through a Program
  // can therefore synthesise from it on the same terms as one that parses file
  // by file.
  for (const sf of program.getSourceFiles()) vouchedSources.add(sf);
  return program;
}

/**
 * Transpile `text` to JavaScript, or refuse.
 *
 * The ONLY sanctioned way to call `ts.transpileModule` under `scripts/**` --
 * see `check-parse-guard.mjs`, which fails on the raw call anywhere else in
 * that tree.
 *
 * `reportDiagnostics` is forced ON and is deliberately not a parameter: the
 * default is what makes this API the quietest of the three, and a knob that can
 * restore the silence is a knob that will. Every diagnostic this API can
 * produce -- syntax, and the `isolatedModules` grammar rules -- means the
 * emitted text is not a faithful translation of the input, so all of them
 * refuse.
 *
 * @param {string} fileName  What the source is called. Decides the ScriptKind
 *   exactly as it does for {@link parseSourceFile}; pass the real path when you
 *   have one, and a `.ts`/`.tsx` name for a synthesised snippet.
 * @param {string} text  The source.
 * @param {ts.TranspileOptions} [transpileOptions]
 * @returns {ts.TranspileOutput} Output emitted from a source that parsed.
 */
export function transpileChecked(fileName, text, transpileOptions = {}) {
  armCensusReport();
  census.transpiles += 1;
  census.parses += 1;
  census.files.add(fileName);

  const result = ts.transpileModule(text, {
    ...transpileOptions,
    fileName,
    reportDiagnostics: true,
  });

  const rows = describeTsDiagnostics(result.diagnostics ?? []);
  if (rows.length > 0) {
    census.refusals += 1;
    process.stderr.write(transpileRefusalReport(fileName, rows));
    process.exit(EXIT_UNPARSEABLE);
  }
  return result;
}

/**
 * The exit status of a MISUSE of {@link parseDerivedText} -- an origin this
 * module never certified.
 *
 * Distinct from {@link EXIT_UNPARSEABLE} for the reason that code is distinct
 * from 1: "this gate found violations", "I could not read the tree" and "this
 * call site is asking the wrong door" are three verdicts, and a reader should
 * not have to guess which one they got. All are non-zero, so CI fails either
 * way.
 */
export const EXIT_DERIVED_MISUSE = 4;

/**
 * The refusal text for a derived parse whose origin was never certified.
 *
 * Separate from the exit so a self-test case can read it, exactly as
 * {@link refusalReport} is.
 */
export function derivedMisuseReport(fileName, origin) {
  const what = origin === null ? 'null'
    : origin === undefined ? 'undefined'
      : typeof origin === 'object' ? `an object with fileName ${JSON.stringify(origin.fileName ?? '(none)')}`
        : `a ${typeof origin}`;
  return [
    `x  ts-parse — REFUSING a derived parse whose ORIGIN this module never certified.`,
    ``,
    `    derived text  ${fileName}`,
    `    origin        ${what}`,
    ``,
    `    parseDerivedText answers a different question from parseSourceFile:`,
    `    "did the text I synthesised parse?", not "could I read this tree?". Its`,
    `    verdict is returnable ONLY because the tree behind it has already been`,
    `    read, so the origin must be a ts.SourceFile this module returned from`,
    `    parseSourceFile, or one a Program from createProgramChecked was built`,
    `    over. Both of those end the process on a source that does not parse.`,
    ``,
    `    Reading a source off disk and handing its text here would route the one`,
    `    door whose failure is NOT a refusal at exactly the input the refusal`,
    `    exists for — a file the gate could not read, scored as a file with`,
    `    nothing to report. Parse it with parseSourceFile, and pass the tree`,
    `    that call returns as the origin of anything you synthesise from it.`,
    ``,
    `    This is an exit rather than a throw for the reason the refusals are:`,
    `    a throw here is one \`catch\` away from the silent skip.`,
    ``,
  ].join('\n');
}

/**
 * The verdict text for derived text that did not parse. NOT a refusal: it names
 * the origin, says the run continues, and is meant to be printed by the caller
 * against the site the text came from.
 */
export function derivedFailureReport(fileName, originName, scriptKind, rows) {
  return [
    `!  ts-parse — derived text does not parse. The source it came FROM does.`,
    ``,
    `    derived text  ${fileName}`,
    `    derived from  ${originName}`,
    `    parsed as     ${describeScriptKind(scriptKind)}`,
    `    errors        ${rows.length} parse diagnostic(s) from TypeScript ${ts.version}`,
    ``,
    ...locationLines(fileName, rows),
    ``,
    `    This is a fact about the text THIS PROCESS SYNTHESISED, not about the`,
    `    source above: that source was read, and certified, before this text was`,
    `    built from it. So the run is NOT aborted — the verdict is returned, and`,
    `    the caller attributes it to the one site it belongs to instead of`,
    `    losing every other site to a process exit.`,
    ``,
    `    ⛔ It is still not a pass. No tree comes back with this (sourceFile is`,
    `    null), so there is no recovered wreckage to walk and no reading of this`,
    `    result that says "nothing to report". If your synthesis is supposed to`,
    `    round-trip, this is the bug in the synthesis.`,
    ``,
  ].join('\n');
}

/**
 * Parse text THIS PROCESS SYNTHESISED from a source it has already read, and
 * hand the verdict back instead of ending the run.
 *
 * ⚠️ ⛔ NOT a general escape from the refusal, and ⛔ not for a source read off
 * disk: see the `origin` parameter. The header section "A FOURTH door" carries
 * the whole argument, the measurement behind it, and why this is the only door
 * here whose failure is returnable.
 *
 * @param {ts.SourceFile} origin  The tree `text` was derived from, as returned
 *   by {@link parseSourceFile} or pulled from a {@link createProgramChecked}
 *   Program. Anything else ends the process with {@link EXIT_DERIVED_MISUSE}.
 * @param {string} fileName  What to call the synthesised text. Its extension
 *   picks the ScriptKind when `scriptKind` is omitted, exactly as for
 *   {@link parseSourceFile}; a synthesised source has no real path, so give it
 *   a `.ts`/`.tsx` name that says what it is.
 * @param {string} text  The synthesised source.
 * @param {ts.ScriptKind} [scriptKind]  Omit to let `fileName` decide.
 * @returns {{ sourceFile: ts.SourceFile|null, failure: null|{ message: string,
 *   line: number, column: number, count: number,
 *   rows: { line: number, column: number, message: string }[], report: string } }}
 *   `failure` null ⇒ it parsed and `sourceFile` is the tree. Otherwise
 *   `sourceFile` is null — there is deliberately no recovered tree to walk —
 *   and `failure.report` is the text to print against the site.
 */
export function parseDerivedText(origin, fileName, text, scriptKind) {
  armCensusReport();
  if (!vouchedSources.has(origin)) {
    process.stderr.write(derivedMisuseReport(fileName, origin));
    process.exit(EXIT_DERIVED_MISUSE);
  }
  census.parses += 1;
  census.derived += 1;
  census.files.add(fileName);

  // The same fixed knobs the three doors above pass, for the reason the header
  // gives: a call site that needs a different pair says so once, here. Pinned
  // behaviourally by the self-test rather than by this comment -- a derived
  // tree has its parents set and reads modern syntax, or the knobs drifted.
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKind,
  );

  const rows = describeDiagnostics(sourceFile);
  if (rows.length === 0) {
    // Derived text that parsed is itself a tree this module has read, so a
    // second-order synthesis (a fragment of a fragment) can name it as origin.
    vouchedSources.add(sourceFile);
    return { sourceFile, failure: null };
  }

  census.rejections += 1;
  const first = rows[0];
  return {
    sourceFile: null,
    failure: {
      message: first.message,
      line: first.line,
      column: first.column,
      count: rows.length,
      rows,
      report: derivedFailureReport(fileName, origin.fileName, scriptKind, rows),
    },
  };
}

// ---------------------------------------------------------------------------
// Self-test -- real child processes, because the refusal IS a process exit
// ---------------------------------------------------------------------------

/**
 * The refusal cannot be observed in-process: it exits. So the cases that matter
 * spawn a real child and read what it printed and what status it left, exactly
 * as `invoked-as.mjs` drives a real symlink rather than a model of one.
 */

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 — a self-test that never finished, reported as one that
// passed (#13798). The self-test's own exit code stays load-bearing, so the
// handshake is a flag rather than a returned sentinel.
let selfTestReachedVerdict = false;

export function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => {
    registerCase();
    return cases.push({ name, ok: Boolean(ok), detail });
  };

  const SELF = fileURLToPath(import.meta.url);
  // The conflict markers are BUILT rather than typed: a literal one in this
  // file would be a merge-conflict marker in this file.
  const MARKER = '<'.repeat(7);
  const MIDDLE = '='.repeat(7);
  const CLOSER = '>'.repeat(7);

  const CONFLICTED = `const a = 1;\n${MARKER} HEAD\nconst b = 2;\n${MIDDLE}\nconst b = 3;\n${CLOSER} other\n`;
  const TRUNCATED = 'export function f() {\n  const x = {\n';
  const JSX = 'const el = <div className="x">hi</div>;\n';
  const GENERIC_ARROW = 'const id = <T>(x: T): T => x;\n';
  const CLEAN = 'export const a: number = 1;\n';
  // The measured transpile wreck: a dropped right-hand operand. Kept as one
  // string so the case below and the raw-behaviour case below it are provably
  // talking about the SAME source.
  const DROPPED_OPERAND = 'const f = (row) => { return row.a === ; };\nreturn f;\n';

  const dir = mkdtempSync(join(tmpdir(), 'ts-parse-'));
  try {
    // The probe lives in a temp dir, where a bare `typescript` specifier does
    // not resolve -- so the URL is resolved HERE, from this module, and pasted
    // in. `body` is spliced into a module that imports THIS one, so the child
    // exercises the real export through the real module graph rather than a
    // re-implementation of it.
    const TS_URL = import.meta.resolve('typescript');
    const run = (body, env) => {
      const probe = join(dir, `probe-${cases.length}-${Math.random().toString(36).slice(2)}.mjs`);
      writeFileSync(
        probe,
        `import ts from ${JSON.stringify(TS_URL)};\n`
          + `import { parseSourceFile, parseCensus } from ${JSON.stringify(pathToFileURL(SELF).href)};\n`
          + `void ts;\n${body}\n`,
      );
      const r = spawnSync(process.execPath, [probe], {
        encoding: 'utf8',
        env: env === undefined ? process.env : { ...process.env, ...env },
      });
      rmSync(probe, { force: true });
      return { status: r.status, out: (r.stdout || '').trim(), err: r.stderr || '' };
    };

    const parse = (text, fileName = 't.ts', kindExpr = 'undefined') =>
      run(
        `const sf = parseSourceFile(${JSON.stringify(fileName)}, ${JSON.stringify(text)}, ${kindExpr});\n`
          + `console.log('PARSED ' + sf.statements.length);\n`,
      );

    // -- a clean source still parses, and the tree is usable ------------------
    battery('a clean source still parses, and the tree is usable');
    const clean = parse(CLEAN);
    t('a clean source parses and returns a usable tree',
      clean.status === 0 && clean.out === 'PARSED 1', JSON.stringify(clean));

    // -- THE case: each measured wreck refuses instead of scoring clean -------
    battery('THE case: each measured wreck refuses instead of scoring clean');
    for (const [name, text] of [
      ['merge-conflict markers', CONFLICTED],
      ['a truncated body', TRUNCATED],
      ['JSX under the TS ScriptKind', JSX],
    ]) {
      const r = parse(text, 'packages/foo/src/bar.ts');
      t(`${name} REFUSES rather than returning a tree`,
        r.status === EXIT_UNPARSEABLE && r.out === '',
        JSON.stringify({ status: r.status, out: r.out }));
      t(`…and the refusal for ${name} NAMES THE FILE`,
        r.err.includes('packages/foo/src/bar.ts'), r.err.slice(0, 200));
    }

    // -- the refusal carries a location a reader can open --------------------
    battery('the refusal carries a location a reader can open');
    const located = parse(CONFLICTED, 'packages/foo/src/bar.ts');
    t('the refusal reports line:column and TypeScript’s own message',
      /packages\/foo\/src\/bar\.ts:2:1\s+Merge conflict marker encountered\./.test(located.err),
      located.err.slice(0, 400));

    // -- ScriptKind, both directions. This is the shape that hides in a green
    //    gate rather than in a broken file, and it was LIVE on main. ----------
    battery('ScriptKind, both directions. This is the shape that hides in a green');
    t('JSX in a .tsx file parses when the extension decides',
      parse(JSX, 'page.tsx').status === 0);
    t('…and the SAME source refuses when the call site forces ScriptKind.TS',
      parse(JSX, 'page.tsx', 'ts.ScriptKind.TS').status === EXIT_UNPARSEABLE);
    t('a generic arrow parses in a .ts file',
      parse(GENERIC_ARROW, 'util.ts').status === 0);
    t('…and refuses when the call site forces ScriptKind.TSX (the shape a TSX-everything gate went blind on)',
      parse(GENERIC_ARROW, 'util.ts', 'ts.ScriptKind.TSX').status === EXIT_UNPARSEABLE);

    // -- the refusal is NOT swallowable, which is why it exits rather than
    //    throws: `try { parse } catch { continue }` is written in this repo
    //    today, against a throw that never comes ----------------------------
    battery('the refusal is NOT swallowable, which is why it exits rather than');
    const swallowed = run(
      `let caught = false;\n`
        + `try { parseSourceFile('t.ts', ${JSON.stringify(TRUNCATED)}); } catch { caught = true; }\n`
        + `console.log(caught ? 'SWALLOWED' : 'NOT REACHED');\n`,
    );
    t('a caller’s try/catch cannot downgrade the refusal into a skip',
      swallowed.status === EXIT_UNPARSEABLE && !swallowed.out.includes('SWALLOWED'),
      JSON.stringify(swallowed));

    // -- the census has a numerator ------------------------------------------
    battery('the census has a numerator');
    const counted = run(
      `parseSourceFile('a.ts', 'const a = 1;');\n`
        + `parseSourceFile('a.ts', 'const b = 2;');\n`
        + `parseSourceFile('b.ts', 'const c = 3;');\n`
        + `console.log(JSON.stringify(parseCensus()));\n`,
    );
    t('the census counts parses and distinct file names',
      counted.status === 0
        && counted.out === '{"parses":3,"programs":0,"transpiles":0,"files":2,"refusals":0}',
      JSON.stringify(counted));

    // -- and the report is armed by the first PARSE, not by the IMPORT. Both
    //    directions, because only the pair is a claim: a library that writes
    //    to your stderr because you imported it is the defect, and a census
    //    that can no longer report is the over-correction. -------------------
    battery('and the report is armed by the first PARSE, not by the IMPORT. Both');
    const reported = run(
      `parseSourceFile('a.ts', 'const a = 1;');\n`,
      { OS_TOOLING_PARSE_CENSUS: '1' },
    );
    t('with the census env set, a run that PARSED still reports at exit',
      reported.status === 0
        && /\[ts-parse census\] 1 parse\(s\) over 1 distinct file name\(s\)/.test(reported.err),
      JSON.stringify(reported));
    const importedOnly = run(`void parseCensus();\n`, { OS_TOOLING_PARSE_CENSUS: '1' });
    t('…and a run that only IMPORTED this module writes no census line at all',
      importedOnly.status === 0 && !importedOnly.err.includes('[ts-parse census]'),
      JSON.stringify(importedOnly));

    // -- ts.createProgram: the syntax lives behind a SECOND call -------------
    battery('ts.createProgram: the syntax lives behind a SECOND call');
    const PROGRAM_OPTIONS =
      `{ noLib: true, skipLibCheck: true, noEmit: true, types: [],`
        + ` module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext,`
        + ` moduleResolution: ts.ModuleResolutionKind.Bundler,`
        + ` allowImportingTsExtensions: true }`;
    const fixture = (name, text) => {
      const abs = join(dir, name);
      writeFileSync(abs, text);
      return abs;
    };

    const okEntry = fixture('prog-ok.ts', CLEAN);
    const brokenEntry = fixture('prog-broken.ts', TRUNCATED);
    const importer = fixture('prog-importer.ts', `import { a } from './prog-broken.ts';\nexport const b = a;\n`);

    const program = (roots) =>
      run(
        `import { createProgramChecked } from ${JSON.stringify(pathToFileURL(SELF).href)};\n`
          + `const p = createProgramChecked(${JSON.stringify(roots)}, ${PROGRAM_OPTIONS});\n`
          + `console.log('PROGRAM ' + p.getSourceFiles().length);\n`,
      );

    const progOk = program([okEntry]);
    t('a Program over sources that parse is returned and is usable',
      progOk.status === 0 && progOk.out.startsWith('PROGRAM '), JSON.stringify(progOk));

    const progBad = program([brokenEntry]);
    t('a Program over a source that does NOT parse REFUSES instead of answering',
      progBad.status === EXIT_UNPARSEABLE && progBad.out === '',
      JSON.stringify({ status: progBad.status, out: progBad.out }));
    t('…and that refusal names the file, not just the root list',
      progBad.err.includes('prog-broken.ts'), progBad.err.slice(0, 300));

    // The root parsed; the file it imports did not. This is the case a
    // roots-only check would wave through, and a Program's answers are
    // transitive, so it is the one that matters.
    const progTransitive = program([importer]);
    t('a Program whose ROOT parses but whose IMPORT does not still refuses',
      progTransitive.status === EXIT_UNPARSEABLE
        && progTransitive.err.includes('prog-broken.ts'),
      JSON.stringify({ status: progTransitive.status, err: progTransitive.err.slice(0, 300) }));

    // -- ts.transpileModule: the quietest of the three ----------------------
    battery('ts.transpileModule: the quietest of the three');
    const transpile = (text, fileName = 'snippet.ts') =>
      run(
        `import { transpileChecked } from ${JSON.stringify(pathToFileURL(SELF).href)};\n`
          + `const r = transpileChecked(${JSON.stringify(fileName)}, ${JSON.stringify(text)},`
          + ` { compilerOptions: { target: ts.ScriptTarget.ES2022, isolatedModules: true } });\n`
          + `console.log('EMITTED ' + JSON.stringify(r.outputText));\n`,
      );

    const tsOk = transpile('const f = (row) => row.a === 1;\nreturn f;\n');
    t('a snippet that parses transpiles and hands back its output',
      tsOk.status === 0 && tsOk.out.startsWith('EMITTED '), JSON.stringify(tsOk));

    const tsBad = transpile(DROPPED_OPERAND);
    t('a snippet that does NOT parse refuses rather than emitting text that is not JavaScript',
      tsBad.status === EXIT_UNPARSEABLE && tsBad.out === '',
      JSON.stringify({ status: tsBad.status, out: tsBad.out }));
    t('…and that refusal names the snippet and quotes TypeScript’s own message',
      /snippet\.ts:1:\d+\s+Expression expected\./.test(tsBad.err), tsBad.err.slice(0, 300));

    // WHY the refusal is needed, pinned rather than asserted in prose: the RAW
    // call is silent about this exact source and still returns something that
    // reads like code. If TypeScript ever starts reporting by default this case
    // goes red, and the header's claim about the default gets re-read.
    const raw = run(
      `const out = ts.transpileModule(${JSON.stringify(DROPPED_OPERAND)},`
        + ` { compilerOptions: { target: ts.ScriptTarget.ES2022, isolatedModules: true } });\n`
        + `console.log(JSON.stringify({ reported: (out.diagnostics ?? []).length,`
        + ` hasWreck: out.outputText.includes('=== ;') }));\n`,
    );
    t('the RAW transpileModule is silent about that same source and still returns text',
      raw.status === 0 && raw.out === '{"reported":0,"hasWreck":true}', JSON.stringify(raw));

    // -- the refusal is not swallowable on the new doors either --------------
    battery('the refusal is not swallowable on the new doors either');
    const swallowedTranspile = run(
      `import { transpileChecked } from ${JSON.stringify(pathToFileURL(SELF).href)};\n`
        + `let caught = false;\n`
        + `try { transpileChecked('snippet.ts', ${JSON.stringify(DROPPED_OPERAND)}); } catch { caught = true; }\n`
        + `console.log(caught ? 'SWALLOWED' : 'NOT REACHED');\n`,
    );
    t('a caller’s try/catch cannot downgrade the transpile refusal either',
      swallowedTranspile.status === EXIT_UNPARSEABLE && !swallowedTranspile.out.includes('SWALLOWED'),
      JSON.stringify(swallowedTranspile));

    // -- the census names which door each source came through ---------------
    battery('the census names which door each source came through');
    const countedAll = run(
      `import { createProgramChecked, transpileChecked } from ${JSON.stringify(pathToFileURL(SELF).href)};\n`
        + `import { parseSourceFile as ps, parseCensus as pc } from ${JSON.stringify(pathToFileURL(SELF).href)};\n`
        + `ps('a.ts', 'const a = 1;');\n`
        + `createProgramChecked(${JSON.stringify([okEntry])}, ${PROGRAM_OPTIONS});\n`
        + `transpileChecked('snippet.ts', 'const a = 1;\\n');\n`
        + `console.log(JSON.stringify(pc()));\n`,
    );
    t('the census counts programs and transpiles as their own doors',
      countedAll.status === 0
        && countedAll.out === '{"parses":3,"programs":1,"transpiles":1,"files":3,"refusals":0}',
      JSON.stringify(countedAll));

    // -- the diagnostics reader itself, in-process ---------------------------
    battery('the diagnostics reader itself, in-process');
    t('describeDiagnostics answers [] for a tree that parsed',
      describeDiagnostics(parseSourceFile('ok.ts', CLEAN)).length === 0);
    t('describeDiagnostics answers [] for a non-SourceFile rather than throwing',
      describeDiagnostics(/** @type {any} */ ({})).length === 0);
    t('describeDiagnostics answers [] for undefined rather than throwing',
      describeDiagnostics(/** @type {any} */ (undefined)).length === 0);
    t('describeTsDiagnostics answers [] for a missing list rather than throwing',
      describeTsDiagnostics(/** @type {any} */ (undefined)).length === 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // The floor runs BEFORE the verdict below, so a success line can only be
  // printed by a run in which every declared battery registered its cases.
  for (const message of batteryFloorFailures()) cases.push({ name: message, ok: false });

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  x ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`x ts-parse self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ ts-parse self-test: ${cases.length} cases pass (every measured wreck refuses and names its file, `
      + `across all three parser entry points, both ScriptKind directions, a Program's transitive import `
      + `included, and a caller’s try/catch cannot swallow any of it).`,
  );
  selfTestReachedVerdict = true;
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
      const selfTestCode = selfTest();
        if (!selfTestReachedVerdict) {
            console.error(
                '\n✗ ts-parse self-test: selfTest() returned without reaching its verdict,\n'
                    + 'so no success line was printed. Exiting 0 here would report a self-test\n'
                    + 'that never finished as a self-test that passed.\n',
            );
            process.exit(1);
        }
        process.exit(selfTestCode);
  }
  console.log('usage: node scripts/ts-parse.mjs --self-test');
}
