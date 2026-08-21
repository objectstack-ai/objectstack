// eslint-fatal-guard — a file that will not PARSE must never score clean.
//
// The two ESLint-driven ratchets in this directory
// (check-slot-lookup-ratchet.mjs, check-query-options-erasure-ratchet.mjs)
// measure by running ESLint over `packages/**` through its Node API and
// COUNTING the messages that match their own rule. The counting step is where
// an unparseable file disappears.
//
// ── MEASURED (#10123), re-derived on this tree at 5262124388 ────────────────
//
// A `packages/**` file holding one syntax error, linted through the Node API
// with this repo's real config:
//
//   lintFiles returned normally (did NOT throw)
//   messages: [{"ruleId":null,"fatal":true,"severity":2,
//               "message":"Parsing error: Expression expected.","line":2,"column":32}]
//   errorCount=1 fatalErrorCount=1
//
// ESLint does not throw on a parse failure — it returns it as an ordinary
// message with NO rule id and `fatal: true`. Neither ratchet's filter can match
// it (one compares `m.message` to its rule's text, the other compares
// `m.ruleId` to its rule's id), so the file contributed ZERO sites and both
// gates printed `✓ … holds` and exited 0 — output byte-identical to a file that
// was measured and is clean.
//
// The same file, through the root `lint` script's spelling
// (`eslint <file> --no-inline-config`), exits 1:
//
//   2:32  error  Parsing error: Expression expected
//   ✖ 1 problem (1 error, 0 warnings)
//
// So before this guard the two gates and `pnpm lint` DISAGREED about whether an
// unparseable file is a failure — and they disagreed in the direction that
// matters, because each ratchet's own docblock argues it exists precisely
// BECAUSE a green `pnpm lint` proves nothing for the files it covers. A gate
// whose stated rationale is "I see what lint cannot" must not be the one that
// goes quiet first.
//
// ── A fatal is not a finding. It is the measurement failing ─────────────────
//
// This is why the guard aborts rather than counting a fatal as a site: a parse
// failure says the file was never read for sites at all, so neither "0 sites"
// nor "N sites" is a fact about it. Reporting it as a rule hit would be the
// same lie with a different sign.
//
// EXIT CODE 2, deliberately. Both gates already reserve 2 for "refusing to
// report clean when the thing being measured is not what this gate thinks it
// is" (a renamed rule, a rescoped population) and 1 for "the ratchet moved".
// A parse failure belongs to the first family — nothing moved, the measurement
// did not happen — and the exit code is the only part of that distinction a CI
// log preserves for a reader who sees only the step's status.
//
// ── Why `m.fatal`, and not `ruleId === null` ───────────────────────────────
//
// A null rule id alone is not the signal: ESLint also emits `ruleId: null`
// warnings for other reasons (an explicitly-linted file that config ignores,
// for one), and counting those would make the guard fire on a healthy tree,
// which is how a true gate gets weakened back out. `fatal` is the parse-failure
// flag itself, cross-checked here against the per-result `fatalErrorCount`
// summary so a future ESLint that moves the flag cannot make this silent again
// — the failure mode this whole file exists to close.
//
// ── Why a shared module, and how adoption is kept honest ───────────────────
//
// Two copies of a guard drift, and a drifted copy is invisible: the gate that
// lost the check keeps printing the same green line. So the check lives once,
// the gates route their run through `lintFilesStrict()` instead of calling
// `eslint.lintFiles()`, and `checkGuardAdoption()` asserts both of those facts
// about every gate in GUARDED_GATES by reading their source. That assertion is
// driven by check-query-options-erasure-ratchet.mjs's `--self-test`, which CI
// runs ahead of the gate itself (`pnpm check:query-options-erasure`);
// `pnpm check:slot-lookup` has no self-test hook of its own, so the coverage of
// ITS call site is the source assertion, not a second wired self-test.
//
// ── MEASURED (#10458): reading the source has to mean reading CODE ────────
//
// Those assertions scanned the RAW file, comments included — and both gates
// carry a `//` line naming this module in their own docblocks. So the import
// test was satisfied by PROSE. Deleting check-slot-lookup-ratchet.mjs's real
// `import { lintFilesStrict } …` line and leaving its docblock exactly as it
// was measured:
//
//   ON-DISK: real import lines=0 ; docblock mentions=1
//   $ node scripts/check-query-options-erasure-ratchet.mjs --self-test
//   ✓ self-test: … both gates still routed through it.
//   exit=0
//
// Green, with the sentence it printed false, on the one check whose whole job
// is noticing that a gate went quiet. Two things follow, and both are below:
// the source is read through scripts/js-comment-mask.mjs (the repo-wide answer
// to "comment or code", #9367) rather than raw; and "the name appears" was
// never the claim — `lintFilesStrict(` must actually be CALLED, because a
// guard imported once is not a guard still called.
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import process from 'node:process';

import { stripComments } from './js-comment-mask.mjs';

/** "This gate could not measure", as distinct from 1 = "the ratchet moved". */
export const FATAL_GUARD_EXIT_CODE = 2;

/**
 * The gates that drive ESLint over a population and count what comes back.
 * Every one of them must route its run through `lintFilesStrict()`.
 */
export const GUARDED_GATES = [
  'scripts/check-slot-lookup-ratchet.mjs',
  'scripts/check-query-options-erasure-ratchet.mjs',
];

/**
 * Every parse failure in an ESLint result set, flattened and repo-relative.
 *
 * @param {Array<{filePath?: string, messages?: Array<object>, fatalErrorCount?: number}>} results
 * @param {string} [repoRoot] absolute root to make paths relative to
 * @returns {Array<{file: string, line: number, column: number, message: string}>}
 */
export function collectFatalMessages(results, repoRoot) {
  const fatals = [];
  for (const result of results ?? []) {
    const path = result?.filePath;
    const file = !path ? '(unknown file)'
      : repoRoot ? relative(repoRoot, path).replace(/\\/g, '/')
      : path;
    const messages = (result?.messages ?? []).filter((m) => m?.fatal);
    for (const m of messages) {
      fatals.push({
        file,
        line: m.line ?? 0,
        column: m.column ?? 0,
        message: m.message ?? '(no message)',
      });
    }
    // The cross-check. `fatalErrorCount` is ESLint's own summary of the same
    // fact; if it ever disagrees with the per-message flag, the disagreement is
    // reported rather than resolved in favour of silence.
    if (messages.length === 0 && (result?.fatalErrorCount ?? 0) > 0) {
      fatals.push({
        file,
        line: 0,
        column: 0,
        message:
          `ESLint reported fatalErrorCount=${result.fatalErrorCount} but no message ` +
          'carried the fatal flag. Treated as a parse failure: this gate does not ' +
          'report clean for a file it may not have read.',
      });
    }
  }
  return fatals;
}

/**
 * The author-facing failure. Names every file, where it broke and why.
 *
 * @param {string} gate the gate's name, for the first line
 * @param {ReturnType<typeof collectFatalMessages>} fatals
 * @returns {string}
 */
export function formatFatalReport(gate, fatals) {
  const lines = [
    `✗ ${gate}: ${fatals.length} parse failure(s) inside the population this gate measures:`,
    '',
  ];
  for (const f of fatals) lines.push(`  • ${f.file}:${f.line}:${f.column} — ${f.message}`);
  lines.push(
    '',
    'ESLint returns a parse failure as a message with no rule id, so it matches no',
    'rule this gate counts. A file that does not parse was never read for sites at',
    'all: counting it as zero would report it clean without measuring it, which is',
    'the one thing this gate exists to prevent. Nothing was counted this run.',
    '',
    'Fix the parse error (regenerate the file if it is generated), then run this',
    'gate again. `pnpm lint` fails on the same file with the same error.',
  );
  return lines.join('\n');
}

/**
 * `eslint.lintFiles()`, with a parse failure anywhere in the results treated as
 * the measurement failing rather than as a file with nothing to report.
 *
 * @param {{lintFiles: (targets: string[]) => Promise<object[]>}} eslint
 * @param {string[]} targets
 * @param {{gate: string, repoRoot?: string, onFatal?: (report: string, fatals: object[]) => never|unknown}} options
 * @returns {Promise<object[]>} the results, when every file parsed
 */
export async function lintFilesStrict(eslint, targets, { gate, repoRoot, onFatal = exitOnFatal } = {}) {
  const results = await eslint.lintFiles(targets);
  const fatals = collectFatalMessages(results, repoRoot);
  if (fatals.length > 0) return onFatal(formatFatalReport(gate ?? 'eslint-fatal-guard', fatals), fatals);
  return results;
}

/** The default handler: print the report and stop. Never returns. */
function exitOnFatal(report) {
  console.error(report);
  process.exit(FATAL_GUARD_EXIT_CODE);
}

/**
 * Assert every gate in GUARDED_GATES still routes through this module.
 *
 * Read from the gates' own source, because the alternative is trusting that a
 * guard imported once is a guard still called — and a gate that quietly went
 * back to `eslint.lintFiles()` looks, from its output, exactly like one that
 * never lost the check.
 *
 * @param {string} repoRoot
 * @returns {string[]} problems, empty when every gate is still guarded
 */
export function checkGuardAdoption(repoRoot) {
  const problems = [];
  for (const gate of GUARDED_GATES) {
    let src;
    try {
      src = readFileSync(resolve(repoRoot, gate), 'utf8');
    } catch {
      problems.push(`${gate}: named by the fatal-parse guard but unreadable — renamed or removed?`);
      continue;
    }
    problems.push(...guardAdoptionProblems(gate, src));
  }
  return problems;
}

/**
 * The adoption verdict for ONE gate, from its source text.
 *
 * Split out and kept pure so the self-test can drive it over synthetic sources
 * in BOTH directions. The live-tree call above can only ever prove the
 * direction today's tree happens to be in, and being green when it should be
 * red is this check's entire failure mode (#10458).
 *
 * @param {string} gate the gate's name, for the messages
 * @param {string} source the gate's source, comments and all
 * @returns {string[]} problems, empty when this gate is still guarded
 */
export function guardAdoptionProblems(gate, source) {
  const problems = [];
  // Prose is not adoption. Both gates name this module in their docblocks, so
  // against the RAW text the import test below was satisfied by a comment —
  // green at exactly the moment a gate stopped importing it (#10458). The
  // repo-wide answer to "comment or code" is scripts/js-comment-mask.mjs
  // (#9367); a private strip here would be another copy of what that exists to
  // retire. `stripComments` rather than `maskComments` because this reports
  // gate NAMES, never a line or an offset into the original text.
  const src = stripComments(source);
  if (!/eslint-fatal-guard\.mjs/.test(src)) {
    problems.push(
      `${gate}: does not import scripts/eslint-fatal-guard.mjs. A gate that counts ` +
      'ESLint messages scores an unparseable file as clean without it (#10123).',
    );
  } else if (!/lintFilesStrict\s*\(/.test(src)) {
    // The docblock's own thesis, asserted rather than assumed: a guard imported
    // once is not a guard still called. Importing this module runs none of it,
    // and the `.lintFiles(` test below cannot cover the gap — a gate that
    // stopped calling anything has no direct call left to catch.
    problems.push(
      `${gate}: imports scripts/eslint-fatal-guard.mjs but never calls lintFilesStrict(). ` +
      'Importing the guard does not arm it: a gate measuring around it still scores an ' +
      'unparseable file as clean (#10123).',
    );
  }
  if (/\.lintFiles\s*\(/.test(src)) {
    problems.push(
      `${gate}: calls \`.lintFiles(\` directly, so a parse failure in its population ` +
      'is discarded as a message matching no rule. Call lintFilesStrict() instead.',
    );
  }
  return problems;
}
