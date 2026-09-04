#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Self-test output vs. the Actions runner's command parser (#11886).
 *
 *   node scripts/check-self-test-workflow-commands.mjs
 *   node scripts/check-self-test-workflow-commands.mjs --self-test
 *
 * ## The defect, measured rather than supposed
 *
 * `scripts/pm/ci-failure.mjs --self-test` printed a line of prose that NAMES a
 * workflow-command token, inside backticks, as documentation of what the tool
 * anchors on. The runner does not know the token is being quoted. It parsed it
 * and minted a real annotation:
 *
 *   check-run 97678882948, `Lint & Repo Gates` on `d63b01436`, conclusion
 *   SUCCESS, via `GET /repos/{owner}/{repo}/check-runs/{id}/annotations`:
 *
 *     annotation_level = failure   path = .github   line = 32   title = ""
 *     message          = "` in it is labelled a window rather than an anchor. And a `fix`"
 *
 * That was the ONLY annotation on the run. A failure-level annotation on a
 * green required check is a claim that something failed; nothing did. The step
 * has no `if:` and the workflow has no `paths:` filter, so it was minted on
 * every pull request in the repo.
 *
 * ## Two measurements that decide this gate's shape
 *
 * **1. The legacy `##[...]` form is parsed ANYWHERE in a line, not only at the
 * start.** The source line begins `    tail with no \`` and the token sits at
 * column 18; the runner still consumed it, dropped everything before it, and
 * took the remainder of the line as the message (which is why the annotation
 * above starts mid-sentence, on a stray backtick). So a `##[` cannot be made
 * safe by indenting it or by burying it in prose.
 *
 * **2. The `::...::` form is parsed only at LINE START.** Measured against the
 * same population: `scripts/check-prerelease-pin-watch.mjs --self-test` prints
 * two lines carrying `::error::` and `::warning::` mid-sentence on every PR,
 * and its check run carries zero annotations. Those two lines are inert where
 * they sit and one re-indentation away from not being; this gate reddens at the
 * moment they move, which is the moment they start lying.
 *
 * ⚠️ Neither fact is inferable from a local run — the transformation happens on
 * a runner and nowhere else. That is exactly why the property needs a gate
 * rather than a reviewer.
 *
 * ## Why the population is "the self-tests CI runs"
 *
 * A self-test's output is deterministic and input-independent by construction
 * (that is what makes it a self-test), so "what will this print on a runner" is
 * answerable HERE, with no runner and no network. A production gate run prints
 * findings that depend on the tree, and its deliberate `::warning::` emissions
 * are the annotation surface working as intended — a different question, and
 * not this gate's.
 *
 * Membership is not re-derived: it is imported from
 * `scripts/check-self-test-wired.mjs`, which already owns the answer to "which
 * scripts does CI run that ship a `--self-test`". One definition, two gates.
 *
 * ## That sentence was a PROMISE for one release, and it was false (#15414)
 *
 * What was imported was the EXTRACTION (`collectInvocations`, `carriesSelfTest`,
 * `codeOf`) — not the population. This gate then built its own from a private
 * `walkScripts` anchored at the repo-root `scripts/` dir, and the sibling gate
 * had meanwhile grown a SECOND population source: the package-local gate lane
 * CI names by path (#15342). Two answers to one question, and they disagreed by
 * exactly one file:
 *
 *   check-self-test-wired             169 of those are run by 30 workflow(s)
 *   check-self-test-workflow-commands 168 script(s) CI runs ship a `--self-test`
 *
 * The missing member was `packages/lint/scripts/check-reference-carrier-shape
 * .mjs`, which `lint.yml` runs with `--self-test` on every pull request. Its
 * output was in no sweep — and NOTHING said so, because every `#4690` refusal
 * below fires on an EMPTY population or an empty candidate set. A population
 * that is complete-minus-one refuses nothing and prints a confident scope line.
 *
 * So the population now arrives through `collectPopulation`, exported by the
 * gate that owns it. ⛔ This file adds no walk of its own — a second walk is
 * how the drift got here, and a re-derivation that agrees today is a
 * re-derivation that can stop agreeing without either side going red.
 *
 * ## The verdict comes from real output, never from a rule about source
 *
 * The static scan below only SELECTS which self-tests to run. Whether a token
 * is printed is then answered by printing it — so the classic trap of this
 * repo (a matching rule that silently stops matching, with an empty finding set
 * as its fixed point) has no purchase on the verdict. Over-selection costs a
 * subprocess and nothing else; the whole population is ~4 minutes and the
 * selected set is ~14 seconds, which is the only reason the filter exists.
 *
 * Its stated blind spot: a script that BUILDS the token out of pieces
 * (`'##' + '[error]'`) and prints the join. Nothing in this tree does, and the
 * defect class is prose naming a token, which is written whole. A miss here
 * leaves the tree exactly where it is today rather than degrading it.
 *
 * ⚠️ Note for anyone tempted to "break the literal" in SOURCE to fix a finding:
 * splitting a JS string changes nothing. The runner parses the PRINTED LINE, so
 * the printed bytes are what must change.
 *
 * ## No registered-command list, deliberately
 *
 * The set of names the runner honours (`error`, `warning`, `notice`, `group`,
 * `add-mask`, ...) is GitHub's to change, and a stale copy of it here would
 * UNDER-match in silence — a green gate over a token it no longer recognises.
 * The detectors match the command SHAPE instead, which over-matches in the safe
 * direction. Measured cost of that choice on this tree: zero false positives
 * across the whole population.
 *
 * ## Refusals, never quiet passes (#4690)
 *
 * An empty population, an empty candidate set, a candidate that cannot be
 * spawned, one that times out, and one that prints nothing at all are each
 * exit 1 naming what could not be read. "Nothing to check" and "the walk found
 * nothing" are the two readings this gate is built to keep apart.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { isEntrypoint } from './invoked-as.mjs';
import { codeOf, collectPopulation, refusalFor } from './check-self-test-wired.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * The workflow corpus this gate's population is derived FROM.
 *
 * Nothing here reads it — `collectPopulation` does. It is declared anyway, for
 * two reasons that are both mechanical:
 *
 *   - `scripts/pm/dispatch-gates.mjs` derives this gate's family by scanning
 *     THIS module's source for path-shaped literals. Deleting the literal along
 *     with the read would drop this gate off every card that edits a workflow —
 *     while its verdict still moves with those files, since a workflow is what
 *     decides which self-tests are in the population at all.
 *   - it is PINNED against `read.workflowDir` in `main()` below, so it is a live
 *     coupling rather than a decoration: the day the shared reader's corpus root
 *     moves, this gate refuses out loud instead of quietly declaring a directory
 *     it no longer depends on.
 */
const WORKFLOW_DIR = '.github/workflows';

/** How long one self-test may take before the gate refuses rather than guesses. */
const TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Detectors — run against REAL OUTPUT, one line at a time
// ---------------------------------------------------------------------------

/**
 * The legacy form. Parsed anywhere in the line (measurement 1 in the header),
 * so this is deliberately not anchored.
 */
export const V1_COMMAND = /##\[[A-Za-z][\w-]*(?:[ \t][^\]\n]*)?\]/;

/**
 * The current form. Parsed only at line start (measurement 2), so this IS
 * anchored — a mid-sentence `::warning::` is inert and flagging it would be a
 * false positive the next author would be right to delete.
 */
export const V2_COMMAND = /^[ \t]*::[A-Za-z][\w-]*[^\n]*?::/;

/**
 * Every line of `text` the Actions runner would parse as a workflow command.
 *
 * @param {string} text combined stdout + stderr of one self-test
 * @returns {{line: number, form: 'legacy ##[...]' | 'current ::...::', text: string}[]}
 */
export function scanOutput(text) {
  const findings = [];
  text.split('\n').forEach((line, i) => {
    if (V1_COMMAND.test(line)) findings.push({ line: i + 1, form: 'legacy ##[...]', text: line });
    else if (V2_COMMAND.test(line)) findings.push({ line: i + 1, form: 'current ::...::', text: line });
  });
  return findings;
}

// ---------------------------------------------------------------------------
// Prefilter — selects which self-tests to run; never decides a verdict
// ---------------------------------------------------------------------------

/** A `##[` in code can reach any column of any printed line, so any occurrence selects. */
const CANDIDATE_V1 = /##\[/;

/**
 * A `::` command can only matter if it can land at the START of a printed line,
 * which in source means it follows a string delimiter, an escaped newline, or a
 * real newline inside a template literal. `Time::HiRes::time()` — a Perl
 * namespace inside a shell string — is the measured reason this arm is not just
 * `/::[A-Za-z]/`: that spelling selected a 65-second self-test with nothing to
 * find in it.
 */
const CANDIDATE_V2 = /(?:^|["'`]|\\n)[ \t]*::[A-Za-z][\w-]/m;

/**
 * Could this script's CODE (comments masked — prose never prints) print a
 * workflow command?
 *
 * ## Package-local members are filtered on exactly these terms — decided, not
 * ## defaulted (#15414)
 *
 * The population now includes gates CI names by a package-local path, and the
 * question asked here is whether they get a lane of their own. They do NOT, and
 * the reason is that the predicate's subject is the FILE: "could this code print
 * a workflow command" is a property of the bytes, and where the file sits says
 * nothing about it. A lane-specific arm would be a second matching rule with no
 * measurement behind it, in a gate whose whole design note is that its verdict
 * comes from real output precisely because matching rules rot in silence.
 *
 * What that decision COSTS, measured on this tree at the commit that took it:
 * `packages/lint/scripts/check-reference-carrier-shape.mjs` — the one
 * package-local member — is NOT selected. Its code carries neither form: no
 * `##[`, and no `::` that could reach the start of a printed line. So the
 * candidate set is 17 before and 17 after, and this change spawns ZERO extra
 * subprocesses today.
 *
 * The price is deferred, not waived, and it is small: that gate's `--self-test`
 * runs in 0.68s wall (measured, shared box), against ~14s for the 17 already
 * selected. If it ever gains a token in code it joins the candidate set on the
 * same terms as any root script, and paying 0.7s to scan the output of a
 * self-test CI runs on every pull request is the trade this gate exists to make.
 *
 * @param {string} relPath
 * @param {string} source
 */
export function isCandidate(relPath, source) {
  const code = codeOf(relPath, source);
  return CANDIDATE_V1.test(code) || CANDIDATE_V2.test(code);
}

// ---------------------------------------------------------------------------

/**
 * Run one self-test and hand back everything it said.
 *
 * @param {string} relPath
 */
export function runSelfTest(relPath) {
  const abs = join(ROOT, relPath);
  const argv = relPath.endsWith('.sh') ? ['bash', [abs, '--self-test']] : ['node', [abs, '--self-test']];
  const r = spawnSync(argv[0], argv[1], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    spawnError: r.error ? String(r.error.message) : null,
    timedOut: r.signal === 'SIGTERM' && Boolean(r.error),
    output: `${r.stdout ?? ''}\n${r.stderr ?? ''}`,
    bytes: (r.stdout ?? '').length + (r.stderr ?? '').length,
  };
}

function main() {
  const refuse = (message) => {
    console.error(`\ncheck-self-test-workflow-commands: REFUSED — ${message}\n`);
    process.exit(1);
  };

  // ONE definition, two gates (#15414). The walk, the sources, the workflow
  // corpus, the alias expansion, the package-local admission and every `#4690`
  // floor belong to `check-self-test-wired.mjs` and are IMPORTED. This gate's
  // own work begins at the prefilter below, and it adds no walk: the drift this
  // replaced was a second walk that agreed for a while and then quietly did not.
  const read = collectPopulation();
  if (read.refusal) refuse(read.refusal);
  if (read.workflowDir !== WORKFLOW_DIR) {
    refuse(
      `the shared population was read from \`${read.workflowDir}\`, but this gate declares ` +
        `\`${WORKFLOW_DIR}\` to the dispatch derivation. One of the two moved, and a gate naming a ` +
        'corpus it no longer depends on is derived onto the wrong cards in silence.',
    );
  }
  const { population, packageLocal, sources } = read;

  const candidates = population.filter((s) => isCandidate(s, sources.get(s)));
  if (candidates.length === 0) {
    refuse(
      'not one of the self-tests CI runs even MENTIONS a workflow-command token, which this tree ' +
        'contradicts (`scripts/pm/ci-failure.mjs` documents what it anchors on). The prefilter is ' +
        'broken, and a broken prefilter reads exactly like a clean tree (#4690).',
    );
  }

  const findings = [];
  for (const relPath of candidates) {
    const r = runSelfTest(relPath);
    if (r.spawnError) refuse(`${relPath} --self-test could not be run: ${r.spawnError}`);
    if (r.timedOut) refuse(`${relPath} --self-test did not finish within ${TIMEOUT_MS / 1000}s, so its output was never read.`);
    if (r.bytes === 0) {
      refuse(
        `${relPath} --self-test printed nothing at all, so this gate read no output from it. ` +
          'An unread self-test is not a clean one (#4690).',
      );
    }
    for (const f of scanOutput(r.output)) findings.push({ script: relPath, ...f });
  }

  const scope =
    `  scope: ${population.length} script(s) CI runs ship a \`--self-test\` (${packageLocal.length} of them ` +
    'package-local gate(s) CI names by path, present because this population is the one ' +
    'check-self-test-wired.mjs exports rather than a second walk taken here); ' +
    `${candidates.length} mention a workflow-command token in code (comments masked) and were RUN, and ` +
    'their real stdout+stderr was scanned.';

  if (findings.length > 0) {
    console.error(`\ncheck-self-test-workflow-commands: ${findings.length} finding(s)\n`);
    for (const f of findings) {
      console.error(
        `  [${f.form}] ${f.script} --self-test, output line ${f.line}:\n` +
          `      ${f.text.trim()}\n` +
          '      The Actions runner parses this and mints a real annotation on a GREEN check run.\n' +
          '      Change the PRINTED BYTES — splitting the literal in source changes nothing, because\n' +
          '      the runner reads the printed line. Reword the prose; the file\'s own comments can\n' +
          '      spell the token freely, because comments are never printed.\n',
      );
    }
    console.error(`${scope}\n`);
    process.exit(1);
  }

  console.log(
    '✓ check-self-test-workflow-commands: no self-test CI runs prints a line the Actions runner ' +
      'would parse as a workflow command.',
  );
  console.log(scope);
}

// ---------------------------------------------------------------------------
// --self-test
//
// ⚠️ Nothing this function prints may itself carry a parseable token — this
// gate is inside its own population. The adversarial fixtures below are built
// from pieces at runtime for exactly that reason, and the failure path prints
// only a label, never the offending line.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The self-test's own battery registry, floor and verdict (#13489)
// ---------------------------------------------------------------------------
//
// `failures.length === 0` used to be this self-test's ONLY success condition,
// so "every case held" and "the cases never ran" printed the same line. And
// the dispatch below was `if (--self-test) selfTest()`, which discards the
// call's completion: an early `return` anywhere above the verdict printed
// NOTHING and still exited 0. Measured on 597020aa5 by injecting `return;` as
// the first statement of `selfTest()` -- exit 0, zero bytes of output.
//
// Both holes are closed the way PR #13487 validated on check-doc-authoring:
// what is pinned is the registered NAMES, not a number. Every section opens
// with `battery('<name>')`, every `ok()` is attributed to the battery most
// recently opened, and the floor requires the OPENED set to equal the DECLARED
// set with each battery at or above its own count. A set difference names
// WHICH battery stopped running; a count says only that something did -- and a
// pinned TOTAL rots the moment a sibling battery grows.
//
// The counts are a FLOOR, not an equality: adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running, and the
// remedy is to find what stopped registering -- never to lower the number.
//
// Measured on 597020aa5 by instrumenting `ok` and printing the per-battery
// tally.
const SELF_TEST_BATTERIES = Object.freeze({
  'the measured defect': 2,
  'legacy form, anywhere in a line': 4,
  'current form, line start only': 3,
  'innocent output': 4,
  'prefilter reads CODE, never prose': 5,
  'end to end on the real defect site': 5,
  'the population is imported, never re-walked': 8,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the registry's own size is pinned too. Adding a battery raises
// this number; removing one is the same ⛔ deliberate edit as lowering a count.
const SELF_TEST_BATTERY_FLOOR = 7;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

// Returned by `selfTest()` only after the floor has been evaluated and the
// verdict printed. The dispatch refuses anything else: a `return` that leaves
// the function early prints nothing and exits 0, which is the same
// nothing-ran-nothing-complained pass one level up.
const SELF_TEST_VERDICT = 'check-self-test-workflow-commands self-test reached its verdict';

function selfTest() {
  const failures = [];
  const seen = new Map();
  let openBattery = null;
  // Declare the battery the following assertions belong to. The name must be a
  // key of SELF_TEST_BATTERIES -- an unknown one reds by set difference,
  // naming itself, rather than being counted somewhere it is not floored.
  const battery = (name) => {
    openBattery = name;
  };
  const ok = (cond, label) => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    seen.set(b, (seen.get(b) ?? 0) + 1);
    if (!cond) failures.push(label);
  };
  const HASHES = '#'.repeat(2);
  const COLONS = ':'.repeat(2);
  const v1 = (name) => `${HASHES}[${name}]`;
  const v2 = (name) => `${COLONS}${name}${COLONS}`;

  // ── The measured defect itself, reproduced from the real annotation ──────
  battery('the measured defect');
  {
    const real = `    tail with no \`${v1('error')}\` in it is labelled a window rather than an anchor. And a \`fix\``;
    const got = scanOutput(real);
    ok(got.length === 1, 'the measured production line was not flagged at all');
    ok(got[0]?.form === 'legacy ##[...]', 'the measured production line was flagged as the wrong form');
  }

  // ── Measurement 1: the legacy form is parsed ANYWHERE in a line ──────────
  battery('legacy form, anywhere in a line');
  ok(scanOutput(`${v1('error')}boom`).length === 1, 'a legacy command at column 0 was not flagged');
  ok(scanOutput(`prose about ${v1('error')} here`).length === 1, 'a legacy command MID-LINE was not flagged — the measured defect walks straight through');
  ok(scanOutput(`   ${v1('warning')} x`).length === 1, 'an indented legacy command was not flagged');
  ok(scanOutput(`x ${v1('group')} y`).length === 1, 'a legacy `group` was not flagged');

  // ── Measurement 2: the current form is parsed only at LINE START ─────────
  battery('current form, line start only');
  ok(scanOutput(`${v2('error')}boom`).length === 1, 'a current-form command at line start was not flagged');
  ok(scanOutput(`${COLONS}error file=a.ts,line=1${COLONS}boom`).length === 1, 'a current-form command WITH PROPERTIES was not flagged');
  ok(
    scanOutput(`  the quiet run emits no ${v2('error')} and no ${v2('warning')}`).length === 0,
    'a mid-sentence current-form token was flagged — measured inert, and this false positive would be deleted by the next author',
  );

  // ── Innocent output must stay innocent, or the gate gets weakened ────────
  battery('innocent output');
  ok(scanOutput('✓ check-foo: 12 file(s) scanned, nothing to report').length === 0, 'an ordinary success line was flagged');
  ok(scanOutput('  see docs/x.md ## Heading and packages/spec [ok]').length === 0, 'a markdown heading plus a bracket was flagged');
  ok(scanOutput(`Time${COLONS}HiRes${COLONS}time()`).length === 0, 'a Perl namespace was flagged as a workflow command');
  ok(scanOutput('').length === 0, 'empty output produced a finding');

  // ── The prefilter selects on CODE, never on prose ────────────────────────
  battery('prefilter reads CODE, never prose');
  ok(
    !isCandidate('scripts/x.mjs', `// the runner spells it ${v1('error')}\nconst a = 1;\n`),
    'a token that exists only in a JS comment selected the script — comments are never printed',
  );
  ok(
    isCandidate('scripts/x.mjs', `console.log('${v1('error')}');\n`),
    'control — the same literal in CODE must select, or the case above proves nothing',
  );
  ok(
    isCandidate('scripts/x.mjs', `console.log('${v2('warning')}x');\n`),
    'a current-form literal after a quote did not select',
  );
  ok(
    !isCandidate('scripts/x.sh', `raw="$(perl -MTime${COLONS}HiRes -e 'Time${COLONS}HiRes${COLONS}time()')"\n`),
    'a Perl namespace selected a shell script — the measured 65-second false positive this arm exists to drop',
  );
  ok(
    !isCandidate('scripts/x.mjs', 'const a = 1;\n'),
    'a script with no token at all selected',
  );

  // ── End to end: the real tree's real defect site, run for real ───────────
  battery('end to end on the real defect site');
  {
    const target = 'scripts/pm/ci-failure.mjs';
    const source = existsSync(join(ROOT, target)) ? readFileSync(join(ROOT, target), 'utf8') : null;
    ok(source !== null, `${target} is missing, so the end-to-end case verified nothing`);
    ok(source !== null && isCandidate(target, source), `${target} is no longer selected by the prefilter — the end-to-end case below would run nothing`);
    const r = runSelfTest(target);
    ok(r.spawnError === null, `${target} --self-test could not be spawned: ${r.spawnError}`);
    ok(r.bytes > 0, `${target} --self-test printed nothing, so nothing was scanned`);
    ok(scanOutput(r.output).length === 0, `${target} --self-test still prints a line the runner would parse — this is the #11886 defect, live`);
  }

  // ── The population is the sibling gate's, and this file takes no walk (#15414) ──
  //
  // The defect these close: this gate used to derive its own population from a
  // private root walk, so the package-local gate `lint.yml` self-tests on every
  // pull request was in NO population here and its output was never scanned.
  // Both halves need an instrument, and they need different ones:
  //
  //   - that the imported population CONTAINS the package-local member is a
  //     live reading, taken against the tree CI actually runs;
  //   - that this file does not quietly grow a second walk again is a claim
  //     about THIS SOURCE, and only an own-source pin can hold it. A re-derived
  //     population that agrees today is one that can stop agreeing with nothing
  //     going red on either side — which is precisely how the 169/168 split got
  //     here and stayed.
  battery('the population is imported, never re-walked');
  {
    const SPECIMEN = 'packages/lint/scripts/check-reference-carrier-shape.mjs';
    const live = collectPopulation();
    ok(
      live.refusal === null && live.population.length > 0,
      `the imported population could not be read (${live.refusal ?? 'empty'}), so the cases below prove nothing (#4690)`,
    );
    ok(
      live.population.includes(SPECIMEN) && live.packageLocal.length > 0,
      `${SPECIMEN} is not in the population this gate scans. CI runs its --self-test on every pull request; `
        + 'out of the population, its output is in no sweep and nothing says so (#15414)',
    );
    ok(
      typeof isCandidate(SPECIMEN, live.sources.get(SPECIMEN) ?? '') === 'boolean',
      'the prefilter could not be applied to the package-local member — it is filtered on exactly the same '
        + 'terms as a root script, and its VALUE is a measurement of that file, deliberately not pinned here',
    );
    ok(
      live.workflowDir === WORKFLOW_DIR,
      'the shared reader derives the population from a corpus root this gate does not declare, so the '
        + 'dispatch derivation would name this gate for the wrong cards',
    );

    // Own-source. The needles are ASSEMBLED: spelled out, they would be found
    // in this very fixture and the pin would red on itself forever.
    let ownCode = '';
    try {
      ownCode = codeOf('scripts/check-self-test-workflow-commands.mjs', readFileSync(fileURLToPath(import.meta.url), 'utf8'));
    } catch {
      ownCode = '';
    }
    ok(ownCode.length > 0, 'this gate could not read its own source, so the own-source pins below prove nothing (#4690)');
    ok(
      ['readdir', 'stat'].every((fn) => !ownCode.includes(`${fn}Sync(`)),
      'this gate walks a directory again. The population is imported for a reason: a second walk here is '
        + 'what drifted from the sibling gate by one file, silently, in both directions (#15414)',
    );
    ok(
      ownCode.includes('collectPopulation()') && ownCode.includes('check-self-test-wired.mjs'),
      'the population no longer arrives from the gate that owns it — "one definition, two gates" is back '
        + 'to being a sentence in a header rather than a mechanism',
    );

    // The refusals this gate delegated still fire, in both the pure and the
    // disk arm. Neither is reachable on a healthy tree, which is exactly why
    // they are driven here rather than trusted.
    ok(
      (refusalFor({
        files: ['scripts/g.mjs'],
        rootCarriers: new Set(['scripts/g.mjs']),
        workflows: [{ name: 'lint.yml', text: '' }],
        pkgScriptCount: 1,
        named: new Map([['scripts/g.mjs', new Set(['lint.yml'])]]),
        population: [],
      }) ?? '').includes('population reader is broken')
        && (collectPopulation({ root: join(ROOT, '.github') }).refusal ?? '').includes('scripts/ does not exist'),
      'an empty population, or a tree with no scripts/ at all, stopped being a REFUSAL. "Nothing to check" '
        + 'and "the reader is broken" are the two readings this gate is built to keep apart (#4690)',
    );
  }

  // ── The floor: every declared battery RAN, and ran its cases ─────────────
  //
  // Evaluated here, after every battery has had its chance and BEFORE the
  // verdict -- so the line below can only be printed by a run in which the set
  // of batteries that registered assertions equals the set declared.
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  const totalCases = [...seen.values()].reduce((a, b) => a + b, 0);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    failures.push(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned ` +
        `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the registry takes its own floor with it.`,
    );
  }
  for (const [name, count] of seen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    failures.push(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in ` +
        'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = seen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    failures.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. ` +
          'The verdict below would have claimed they hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ` +
          `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }

  if (failures.length > 0) {
    console.error('check-self-test-workflow-commands --self-test FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    if (floorBreached) {
      console.error(
        '\nA battery at or below its floor means cases STOPPED RUNNING — the battery is the bug,\n' +
          'not the number. Find what stopped registering (an early return, a deleted block, a guard\n' +
          'that now skips) and restore it. Raising a floor after ADDING cases is ordinary work;\n' +
          'LOWERING one is not a co-equal option — "the count legitimately moved" and "something\n' +
          'stopped running" need different edits, and only a measurement tells them apart.\n',
      );
    }
    process.exit(1);
  }
  console.log(
    'check-self-test-workflow-commands --self-test: both measured parse rules pinned (legacy form ' +
      'anywhere in a line, current form only at line start), the innocent-output and Perl-namespace ' +
      'cases, the comment mask in both directions, one end-to-end run of the real defect site, and the ' +
      'imported population held against the live tree with no second walk taken here' +
      ` — ${declaredBatteries.length} declared batteries, ${totalCases} cases registered, every battery` +
      ' at or above its pinned floor.',
  );
  return SELF_TEST_VERDICT;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    // ⛔ Never `selfTest();` bare, and never `return selfTest()`. A `return`
    // anywhere above that verdict prints nothing, evaluates no floor and exits
    // 0 — the same nothing-ran-nothing-complained pass the battery floor
    // refuses, one level up (#13489).
    if (selfTest() !== SELF_TEST_VERDICT) {
      console.error(
        '\n✗ check-self-test-workflow-commands self-test: selfTest() returned without reaching its\n' +
          'verdict, so no battery floor was evaluated and no success line was printed. Exiting 0 here\n' +
          'would report a self-test that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
  } else main();
}
