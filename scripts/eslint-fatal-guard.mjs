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
//
// ── MEASURED (#10599): the adoption test names a CALL, not a MEASUREMENT ───
//
// Those two tests ask whether `lintFilesStrict(` appears. A gate that KEPT one
// guarded call and measured a second population through `eslint.lintText()`
// answers yes to all three questions while the second population goes
// unguarded. Both fixtures run through the checker as it stood after #10458:
//
//   import + `eslint.lintText(...)`, no strict call   → 1 problem (not armed)
//   import + strict call + `eslint.lintText(...)`     → 0 problems  ← the hole
//
// So the "measures only through lintText" shape was already caught, and the
// MIXED shape was not. This is not hypothetical plumbing: this gate's own
// self-test counted through a bare `lintText()`. The same reporting fixture
// with one character removed, through that helper:
//
//   parses                    → hits()=1  fatalErrorCount=0
//   `as any;` (missing paren) → hits()=0  fatalErrorCount=1
//                               "Parsing error: ')' expected."
//
// hits()=0 is what the ten `silent` assertions require, so a fixture that
// stopped parsing would have read as PROOF THAT THE RULE IS QUIET about it.
// The guard's own failure mode, inside the self-test that asserts the guard.
//
// A blanket `/\.lintText\s*\(/` ban was not available: this gate legitimately
// lints text to establish what raw ESLint does with a file that will not parse
// — ground truth the guard is built on, which routing through the guard would
// make circular. Source text cannot tell that call from a measurement; which
// result gets COUNTED is data flow. So the check does not guess. It bans the
// BARE spelling and the gate declares which kind each call is —
// `lintTextStrict()` when the result is counted, `lintTextUnguarded({ why })`
// when it is not.
//
// ── MEASURED (#10625): every test above reads ONE FILE ─────────────────────
//
// The import test, the armed test and both bans are statements about the text
// of the file named in GUARDED_GATES. A gate that moved its counting into a
// sibling module — `import { measure } from './lint-population.mjs'`, with the
// raw call living there — presents a gate file with no banned shape in it at
// all, and keeps passing the import and armed tests on any one strict call it
// still makes. Measured against the checker as #10599 left it:
//
//   gate delegating a second population to a sibling helper → 0 problems
//   the helper, had anything read it                        → 2 problems
//
// and nothing reads it: `checkGuardAdoption()` opened exactly GUARDED_GATES.
//
// That was recorded as latent — "neither gate has a helper module today". It
// is not. BOTH gates import `./eslint-stack-headroom.mjs`, and that module has
// held a raw `eslint.lintFiles([file])` since #10449:
//
//   $ checkGuardAdoption(repoRoot)             → []
//   scripts/eslint-stack-headroom.mjs:212      → eslint.lintFiles([file])
//   imported by  check-slot-lookup-ratchet.mjs, check-query-options-…-mjs
//
// Nothing was mis-measured by it — `canaryParseFailures()` hands its results
// straight to `collectFatalMessages()`, which is what the guard would have
// done. So this is still a bound and not a live false green. What the tree
// disproves is the DISTANCE: the sibling module the defect needs already
// exists in both closures, and lands with no diff to any gate.
//
// ── The population, and why it is derived rather than listed ──────────────
//
// The question this file could not answer was WHICH FILES have to carry the
// declarations. It is answered by resolving it instead of writing it down: a
// gate's population is its LOCAL IMPORT CLOSURE — every repo-relative
// specifier it reaches, transitively. That is decidable from source, it is a
// derived fact rather than a hand-kept list that a refactor forgets to update,
// and it is exactly the set of files a measurement can move into without
// touching the gate.
//
// Two exclusions, both load-bearing:
//
//   • THIS MODULE is not scanned. Its raw calls ARE the implementation, and
//     — the trap — its own `export async function lintFilesStrict(` would
//     satisfy an armed test read over the closure, and its own import line
//     would satisfy an import test read that way. Scanning it would quietly
//     retire two working tests, in the file whose entire history is tests
//     going quiet.
//   • The import and armed tests stay FILE-scoped on the gate. Read over the
//     closure they dilute: `eslint-stack-headroom.mjs` already imports this
//     module (for `collectFatalMessages`), so every gate that imports IT
//     would pass an import test read over the closure regardless of what the
//     gate does. A gate that delegates its whole measurement therefore still
//     fails the armed test — a loud false positive, chosen deliberately over
//     a silent weakening, and it names the closure so the author can see why.
//
// The bans are what extend, because "no unguarded lint anywhere this gate's
// verdict flows through" is a closure-level claim by nature. A closure module
// that legitimately lints raw declares it, exactly as a gate does — which is
// why `lintFilesUnguarded({ why })` exists below and why the canary above is
// its first caller.
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import process from 'node:process';

import { blank, scanSource, stripComments } from './js-comment-mask.mjs';

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
 * This module, repo-relative. The one file the closure walk neither scans nor
 * walks through: its raw calls are the implementation being adopted, and its
 * own `lintFilesStrict(` definition would answer an adoption question that is
 * supposed to be about a CALL somewhere else (#10625).
 */
export const GUARD_MODULE = 'scripts/eslint-fatal-guard.mjs';

/** Relative specifiers with these extensions can hold a call; others cannot. */
const CODE_EXTENSIONS = ['.mjs', '.cjs', '.js', '.mts', '.cts', '.ts'];

/** A stand-in repo root, so an import that walks OUT of the repo stays visible. */
const CLOSURE_ROOT = '/__closure_root__';

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

/**
 * `eslint.lintText()`, fatal-checked exactly as `lintFilesStrict()` is.
 *
 * The guard's claim is about MEASUREMENTS, not about one method name: a gate
 * that counts the messages coming back from `lintText()` drops a parse failure
 * for the same reason `lintFiles()` did — ESLint returns it as a message with
 * no rule id, matching no rule the gate counts. Anything whose result is
 * COUNTED belongs here.
 *
 * Every option other than the guard's own is forwarded to `eslint.lintText()`,
 * so a call site reads like the bare one it replaces.
 *
 * @param {{lintText: (code: string, options?: object) => Promise<object[]>}} eslint
 * @param {string} code
 * @param {{gate: string, repoRoot?: string, onFatal?: (report: string, fatals: object[]) => never|unknown}} options
 * @returns {Promise<object[]>} the results, when the text parsed
 */
export async function lintTextStrict(eslint, code, { gate, repoRoot, onFatal = exitOnFatal, ...textOptions } = {}) {
  const results = await eslint.lintText(code, textOptions);
  const fatals = collectFatalMessages(results, repoRoot);
  if (fatals.length > 0) return onFatal(formatFatalReport(gate ?? 'eslint-fatal-guard', fatals), fatals);
  return results;
}

/**
 * `eslint.lintText()`, DECLARED as not a measurement. Behaviour: none added.
 *
 * This exists to be written down, not to do anything. `checkGuardAdoption()`
 * cannot tell a gate MEASURING a population through `lintText()` from a
 * self-test EXERCISING the linter — which result gets counted is a data-flow
 * fact, and the check reads source text. Rather than guess with a heuristic
 * that fires on the next author who writes a legitimate one, the distinction
 * moves to where it is decidable: the author states it, at the call site, in
 * code that survives comment stripping. A bare `.lintText(` in a guarded gate
 * is then a finding with no judgement call left in it.
 *
 * The legitimate use is a call whose result is GROUND TRUTH FOR the guard
 * rather than input to a count — the self-test fixture that must not parse,
 * and its parses-cleanly control. Routing those through `lintTextStrict()`
 * would be circular: they exist to establish the raw ESLint behaviour the
 * guard is built on, so they must see it raw.
 *
 * It is an escape hatch and it is meant to be one: an author CAN route a real
 * measurement through it. What it buys is that doing so takes typing the word
 * `Unguarded` and a reason next to the call, where a reviewer reads it,
 * instead of the silence that made #10123 and #10458 possible.
 *
 * @param {{lintText: (code: string, options?: object) => Promise<object[]>}} eslint
 * @param {string} code
 * @param {{why: string}} options `why` is required; every other key goes to `lintText`
 * @returns {Promise<object[]>} whatever ESLint returned, fatals and all
 */
export async function lintTextUnguarded(eslint, code, { why, ...textOptions } = {}) {
  if (typeof why !== 'string' || why.trim() === '') {
    throw new TypeError(
      'lintTextUnguarded() requires `why`: the reason this lint result is not a measurement. ' +
      'If it IS counted, call lintTextStrict() instead (#10599).',
    );
  }
  return eslint.lintText(code, textOptions);
}

/**
 * `eslint.lintFiles()`, DECLARED as not a measurement. Behaviour: none added.
 *
 * The `lintFiles` twin of `lintTextUnguarded()`, and it exists for the same
 * reason one level out (#10625). Once the bans reach a gate's whole import
 * closure, a closure module that lints raw for a legitimate reason needs the
 * same way to say so that a gate has — otherwise the only ways to keep the
 * tree green are a hand-kept exemption list (the thing a derived closure was
 * chosen to avoid) or wrapping a call that must not be wrapped.
 *
 * `canaryParseFailures()` in scripts/eslint-stack-headroom.mjs is the first
 * caller and the shape to copy: it lints a single file and hands the results
 * to `collectFatalMessages()` itself, so the parse failure is not discarded —
 * it is the thing being looked for. Routing it through `lintFilesStrict()`
 * would be circular AND lossy: the guard's exit path would fire first and
 * print the generic report, replacing the canary's own text, which is the only
 * place a reader is told the remedy is `--stack-size` rather than a code fix.
 *
 * Same escape hatch, same bargain as the text twin: an author CAN route a real
 * measurement through it, and doing so costs typing `Unguarded` and a reason
 * next to the call, where a reviewer reads it.
 *
 * @param {{lintFiles: (targets: string[]) => Promise<object[]>}} eslint
 * @param {string[]} targets
 * @param {{why: string}} options `why` is required
 * @returns {Promise<object[]>} whatever ESLint returned, fatals and all
 */
export async function lintFilesUnguarded(eslint, targets, { why } = {}) {
  if (typeof why !== 'string' || why.trim() === '') {
    throw new TypeError(
      'lintFilesUnguarded() requires `why`: the reason this lint result is not a measurement. ' +
      'If it IS counted, call lintFilesStrict() instead (#10625).',
    );
  }
  return eslint.lintFiles(targets);
}

/** The default handler: print the report and stop. Never returns. */
function exitOnFatal(report) {
  console.error(report);
  process.exit(FATAL_GUARD_EXIT_CODE);
}

/**
 * The repo-relative module specifiers one source reaches, and the ones it
 * reaches in a way this file cannot resolve.
 *
 * Anchored on the specifier rather than on the statement. The obvious spelling
 * — match `import`/`export`, then a lazy `[\s\S]*?`, then `from` — is the
 * quadratic shape scripts/js-comment-mask.mjs measured at 51x on this repo
 * once the comments are blanked rather than deleted; every pattern here starts
 * at a short fixed token and stops at the closing quote.
 *
 * Comments are blanked rather than stripped because this needs OFFSETS: a
 * specifier that appears inside a STRING is not an import, and the only way to
 * tell is to ask the scanner whether the match sits in a literal. That is not
 * hypothetical — scripts/invoked-as.mjs writes `await import(${…})` into a
 * template it then writes to disk, and reading that as a computed import of
 * its own would report a file the gate never loads.
 *
 * @param {string} source
 * @returns {{specifiers: string[], computed: number}} relative specifiers, and
 *   how many `import(`/`require(` calls took an argument that is not a literal
 */
export function localImportSpecifiers(source) {
  const { comment, literal } = scanSource(source);
  const code = blank(source, comment);
  const specifiers = [];
  let computed = 0;
  const scan = (re, onMatch) => {
    re.lastIndex = 0;
    for (let m; (m = re.exec(code)); ) if (!literal[m.index]) onMatch(m);
  };
  // `from '…'` covers every static import and re-export; the bare form covers
  // `import './x.mjs'`; the last two cover the dynamic and CJS spellings whose
  // specifier IS a literal, which are as decidable as a static one.
  for (const re of [
    /\bfrom\s*['"]([^'"\n]+)['"]/g,
    /\bimport\s*['"]([^'"\n]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  ]) scan(re, (m) => { if (/^\.\.?\//.test(m[1])) specifiers.push(m[1]); });
  // …and the spelling that is NOT decidable. Reported rather than passed over:
  // the closure's claim is that it is complete, and a computed specifier is
  // precisely the case where that claim stops being checkable. Saying so is
  // the difference between a bound this file knows about and the four it did
  // not (#10123 → #10458 → #10599 → #10625).
  for (const re of [/\bimport\s*\(\s*([^\s'")])/g, /\brequire\s*\(\s*([^\s'")])/g]) scan(re, () => { computed += 1; });
  return { specifiers: [...new Set(specifiers)], computed };
}

/**
 * Every file a gate reaches, gate included, guard module excluded.
 *
 * @param {string} gate the gate's repo-relative path
 * @param {{repoRoot?: string, readFile: (file: string) => string}} options
 * @returns {{files: Map<string, string>, problems: string[]}}
 */
export function guardClosure(gate, { readFile }) {
  const files = new Map();
  const problems = [];
  const queue = [gate];
  const seen = new Set([GUARD_MODULE]);
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    let src;
    try {
      src = readFile(file);
    } catch {
      problems.push(
        file === gate
          ? `${gate}: named by the fatal-parse guard but unreadable — renamed or removed?`
          : `${gate} → ${file}: imported from this gate's closure but unreadable — renamed or moved? ` +
            'The closure is what decides which files the call bans cover, so a hole in it is a hole ' +
            'in the check (#10625).',
      );
      continue;
    }
    files.set(file, src);
    const { specifiers, computed } = localImportSpecifiers(src);
    if (computed > 0) {
      problems.push(
        `${gate} → ${file}: ${computed} dynamic import/require with a specifier this check cannot ` +
        'resolve. The gate\'s population is its import closure, and a computed specifier is a file ' +
        'the closure cannot name — so the call bans below cannot claim to have covered it. Use a ' +
        'literal specifier, or move the code out of this gate\'s closure (#10625).',
      );
    }
    for (const specifier of specifiers) {
      const target = resolveClosureEntry(file, specifier);
      if (target === null) continue; // not code — a .json or an asset holds no call
      if (target.escapes) {
        problems.push(
          `${gate} → ${file}: imports \`${specifier}\`, which resolves outside the repository. ` +
          'The closure stops at the repo boundary, so this file is not covered by the call bans (#10625).',
        );
        continue;
      }
      queue.push(target.file);
    }
  }
  return { files, problems };
}

/**
 * One relative specifier, as a repo-relative path — or null when it cannot
 * hold a call at all.
 *
 * @param {string} from the importing file, repo-relative
 * @param {string} specifier
 * @returns {{file: string, escapes: boolean}|null}
 */
function resolveClosureEntry(from, specifier) {
  const extension = /(\.[a-z0-9]+)$/i.exec(specifier)?.[1]?.toLowerCase() ?? '';
  if (extension !== '' && !CODE_EXTENSIONS.includes(extension)) return null;
  // Resolved against a MARKER root rather than `/`, because `path.resolve`
  // clamps at the filesystem root: from `/` a `../../x.mjs` comes back as
  // `/x.mjs`, so an import that walks out of the repo would read as a file at
  // the top of it. Against a marker the walk-out is still visible to
  // `relative()`, which is also what makes this platform-independent.
  const rel = relative(CLOSURE_ROOT, resolve(CLOSURE_ROOT, dirname(from), specifier)).replace(/\\/g, '/');
  if (rel === '' || rel === '..' || rel.startsWith('../')) return { file: specifier, escapes: true };
  return { file: rel, escapes: false };
}

/**
 * Assert every gate in GUARDED_GATES still routes through this module — and
 * that nothing in the closure it reaches lints around it.
 *
 * Read from the gates' own source, because the alternative is trusting that a
 * guard imported once is a guard still called — and a gate that quietly went
 * back to `eslint.lintFiles()` looks, from its output, exactly like one that
 * never lost the check.
 *
 * The gate file gets the full verdict (import, armed, both bans). Every OTHER
 * file in its closure gets the bans only, for the reasons in this file's
 * header: read over the closure the import and armed tests are satisfied by
 * modules that are not the gate, and one of them is satisfied by this file.
 *
 * @param {string} repoRoot
 * @param {{gates?: string[], readFile?: (file: string) => string}} [options]
 *   `gates` and `readFile` are injection points for the self-test, which must
 *   be able to drive this over synthetic trees in BOTH directions — the live
 *   call can only ever prove the direction today's tree is in (#10458).
 * @returns {string[]} problems, empty when every gate is still guarded
 */
export function checkGuardAdoption(repoRoot, { gates = GUARDED_GATES, readFile } = {}) {
  const read = readFile ?? ((file) => readFileSync(resolve(repoRoot, file), 'utf8'));
  const problems = [];
  for (const gate of gates) {
    const { files, problems: closureProblems } = guardClosure(gate, { readFile: read });
    const gateSource = files.get(gate);
    if (gateSource !== undefined) problems.push(...guardAdoptionProblems(gate, gateSource));
    problems.push(...closureProblems);
    for (const [file, source] of files) {
      if (file === gate) continue;
      problems.push(...callBanProblems(`${gate} → ${file}`, stripComments(source), CLOSURE_NOTE));
    }
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
  } else if (!/lintFilesStrict\s*\(|lintTextStrict\s*\(/.test(src)) {
    // The docblock's own thesis, asserted rather than assumed: a guard imported
    // once is not a guard still called. Importing this module runs none of it,
    // and the `.lintFiles(` test below cannot cover the gap — a gate that
    // stopped calling anything has no direct call left to catch.
    //
    // EITHER guarded entry point arms a gate (#10599). A gate whose whole
    // population is text would route it through lintTextStrict() and never
    // call lintFilesStrict() at all; demanding the files spelling would report
    // a fully guarded gate as unguarded, which is how a true gate gets argued
    // back out.
    problems.push(
      `${gate}: imports scripts/eslint-fatal-guard.mjs but never calls lintFilesStrict() ` +
      'or lintTextStrict(). ' +
      'Importing the guard does not arm it: a gate measuring around it still scores an ' +
      'unparseable file as clean (#10123).',
    );
  }
  // The same claim about the OTHER method (#10599). `lintFilesStrict()` wraps
  // `lintFiles` and nothing else, so a gate that kept one guarded call and
  // measured a SECOND population through `eslint.lintText()` satisfied every
  // test above while that second population went unguarded — measured on this
  // tree, three problems reported, zero of them this one. The two tests above
  // catch the gate that measures ONLY through lintText (it has no
  // `lintFilesStrict(` call left to find); they cannot see the mixed one.
  //
  // Bare is the finding, not `lintText` itself: a guarded gate spells the
  // counted ones `lintTextStrict(` and declares the rest `lintTextUnguarded(`,
  // neither of which carries a `.lintText(`. That is why this is a ban and not
  // a heuristic — nothing here has to guess which call is the measurement.
  problems.push(...callBanProblems(gate, src));
  return problems;
}

/**
 * Why a file that is not a gate is being judged at all. Appended to a closure
 * finding so the author is not left looking for the gate's name on a module
 * that never appears in GUARDED_GATES.
 */
const CLOSURE_NOTE =
  ' This file is not a gate. It is in the gate\'s local import closure, which is ' +
  'the population the bans cover — a measurement moved one import out is still ' +
  'this gate\'s measurement (#10625).';

/**
 * The two call bans, over source that has already had its comments stripped.
 *
 * Shared by the gate verdict and the closure sweep so there is one copy of the
 * rule and one copy of its wording. Two copies of a guard drift, and a drifted
 * copy is invisible — the argument this whole module is built on.
 *
 * @param {string} subject what to name in the message: a gate, or `gate → file`
 * @param {string} src comment-stripped source
 * @param {string} [note] appended to each problem
 * @returns {string[]}
 */
function callBanProblems(subject, src, note = '') {
  const problems = [];
  if (/\.lintText\s*\(/.test(src)) {
    problems.push(
      `${subject}: calls \`.lintText(\` directly. A counted lintText result discards a ` +
      'parse failure exactly as `.lintFiles(` did — it comes back as a message with no ' +
      'rule id. Call lintTextStrict() if the result is counted, or lintTextUnguarded() ' +
      'with a `why` if it is not a measurement (#10599).' + note,
    );
  }
  if (/\.lintFiles\s*\(/.test(src)) {
    problems.push(
      `${subject}: calls \`.lintFiles(\` directly, so a parse failure in its population ` +
      'is discarded as a message matching no rule. Call lintFilesStrict() instead, or ' +
      'lintFilesUnguarded() with a `why` if it is not a measurement (#10625).' + note,
    );
  }
  return problems;
}
