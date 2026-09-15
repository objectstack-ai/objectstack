#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check:pm-dispatch-gates (#8162) — the CI gate for the dispatch-gates tool.
 *
 *   node scripts/pm/check-dispatch-gates.mjs   # runs the tool's --self-test
 *
 * ## On an agent container, run this DETACHED (#14281)
 *
 * `package.json`'s `check:pm-dispatch-gates` script is exactly this file —
 * `node scripts/pm/check-dispatch-gates.mjs` — and JSON holds no comments, so
 * the instruction a script comment would carry lands here instead, in the
 * header of the file that script runs. The battery this file spawns re-runs
 * `dispatch-gates.mjs`'s own CLI as a child process many times (see the "Why
 * the self-test ONLY" section below), and on an agent container that makes a
 * full run longer than the container's foreground command cap, which SIGTERMs
 * a run past it — this file's `result.signal` branch further down reports
 * exactly that kill, but only once the process has already been cut off. Do
 * not run `pnpm check:pm-dispatch-gates` (or `dispatch-gates.mjs --self-test`
 * directly) in the foreground there. Detach it and poll the log instead:
 *
 *   nohup pnpm check:pm-dispatch-gates > /tmp/pm-dispatch-gates.log 2>&1 &
 *
 * then tail the log file until it stops growing. `dispatch-gates.mjs`'s
 * `selfTest()` streams each case's `✓`/`✗` line as that case is decided, so a
 * run killed mid-battery — by this cap, or by anything else — leaves every
 * case decided before the kill in the log, readable as a partial result. The
 * measured runtime and case count are not repeated here — a reading belongs
 * to a named commit, not to a header (the convention the next section states
 * for this same file) — see #14281 for the reading that motivated this
 * section.
 *
 * ## What #18201 changed about that, and what it did NOT
 *
 * The section above was written against a battery that spent most of its wall
 * clock discovering the SAME tree over and over: a profile of it found every
 * child derivation running the discovery twice, and the live cases in the
 * parent driving it a further twenty-odd times, each pass re-reading every
 * workflow and re-masking every gate source for bytes that had not changed.
 * #18201 collapsed those to one pass per tree per process — ⛔ not one case
 * fewer, ⛔ not one assertion weaker, and the tool's output byte-identical.
 * The battery now fits inside a quiet container's cap with room to spare, and
 * the figures for it belong to that card and its PR rather than to this
 * paragraph.
 *
 * ⛔ That is NOT a licence to drop the detached form. The cap is a property of
 * the CALLER's container and the margin is a property of how contended it is,
 * neither of which this file can see — and an agent box runs several agents
 * at once. So: detached is still the form that cannot be cut off, and the
 * `result.signal` branch below now spends its one chance on the remedy rather
 * than on naming the signal. What the collapse bought is that a foreground run
 * on a quiet box reaches a verdict at all, where before it could only ever be
 * killed.
 *
 * ## The exit contract, and why the kill branch does not keep its old code
 *
 * Four endings, four codes, and what fixes them is not this file's taste — it
 * is what READS them. A dev records a gate's exit beside the command it ran
 * (a `:: exit N` tail) and `dispatch-gates.mjs --ran` reconciles that record
 * against the families it derives, classifying each line FROM THE CODE. A code
 * here is therefore a claim addressed to a reconciler, and this file had one of
 * them wrong:
 *
 *     the battery passed         result.status (0)           a run that passed
 *     the battery failed         result.status               a run that failed
 *     the battery was KILLED     EXIT_PREREQUISITE_NOT_MET   NOT MEASURED
 *     the tool could not spawn   2                           neither, on purpose
 *
 * The kill row used to exit 2, and 2 is in none of the reconciler's classes —
 * not its NOT-MEASURED code, and not its kill set (coreutils `timeout`'s 124
 * and the 128 + signum floor), so it landed inside the `run` total. A family
 * counted as measured on the strength of a run that measured nothing is the
 * exact false green that reconciliation exists to refuse. The branch's own text
 * said the opposite in the same breath — do not record it as a run — and was
 * the only carrier saying it, so a reader who copied the number rather than the
 * sentence filed a red run over a gate that never reached a verdict.
 *
 * ⛔ The fix is NOT 143, the shape a shell reports for a SIGTERM'd child. The
 * reconciler reads a kill code as UNRUN unless the runner ALSO writes a
 * NOT-MEASURED claim with a stated reason beside it — deliberately, because an
 * unexplained kill is where an unfinished run hides. That is the right default
 * for a runner relaying a kill it did not diagnose. It is the wrong one here,
 * where this branch has already identified the kill, printed the reason and
 * named the remedy before it exits: everything the claim line would carry is
 * already on stderr, and requiring a second line to be remembered is how the
 * reading gets lost again. EXIT_PREREQUISITE_NOT_MET carries it in the code
 * itself, and it is the repo-wide code for this reading.
 *
 * The spawn-failure row keeps 2 deliberately; its reason sits at that branch.
 *
 * ⛔ None of this moves CI. lint.yml runs this gate as an ordinary step with no
 * `continue-on-error`, so every non-zero code above is equally red there. These
 * codes are read by devs and by `--ran`, and the contract is pinned by this
 * file's own `--self-test` rather than by this paragraph.
 *
 * ## Why the gate exists
 *
 * scripts/pm/dispatch-gates.mjs derives the "local gates for this card" line of
 * every dispatch prompt. It carried a --self-test from its first commit — 61
 * cases at the time this gate was written, covering workflow extraction, script
 * resolution, watch-hint scanning, the runnable-invocation rendering and the
 * change-kind derivation — and no CI job ran a single one of them. The
 * self-test executed only when a human or an agent typed it, which makes it a
 * check whose coverage is a function of who remembered.
 *
 * The failure that shape produces is quiet: a break in the extraction functions
 * lands green, and it surfaces later as a dispatch prompt naming the WRONG gate
 * families — output that reads as correct, on the very tool whose purpose is to
 * stop gate lists from being memory-shaped. Same family as the changeset gates'
 * self-tests, which is why the workflow step, like theirs, is unconditional.
 *
 * ## Why the self-test ONLY, and not the live derivation
 *
 * The live derivation answers a QUESTION about a card's file surface: it
 * re-reads every workflow file and every check script's source, prints leads,
 * and exits 0 on any completed run. There is no verdict in it for CI to hold —
 * gating on it would buy a slow read of the whole workflow tree whose exit code
 * is 0 by construction. What CI can hold is the half that HAS a verdict, the
 * self-test. That self-test is not fixture-only either. In the cases where a
 * fixture cannot prove the point it runs the same discovery the tool does —
 * every workflow file in the tree, and then the source of every gate that
 * discovery finds — sweeps the tracked corpus, builds temporary git
 * repositories with real history and drives changedPathsFromGit against them,
 * and re-runs the tool's own CLI as a child process against the real checkout:
 * invoked directly, through a symlink to it, and imported by a consumer
 * module, plus a spawned import that reads a sibling gate's live table. So the
 * derivation's contact with reality is covered by this gate too — and most of
 * what the paragraph above calls a slow read is already paid for here, with a
 * verdict attached to it.
 *
 * ⛔ That description carries no figures, deliberately. The count of workflows,
 * of gate sources, of files swept and of temporary repositories all move with
 * the tree, and one frozen in a comment goes stale without anything failing —
 * which is exactly how the older spelling of this paragraph ("it reads the
 * real pr-automation.yml and walks the real packages tree") came to describe a
 * self-test far smaller than the one CI runs, in the file the lint workflow
 * sends readers to for the measured argument. A reading belongs to a named
 * commit, not to a header. Same repair, and the same reason, as the cost note
 * in the workflow comment that points here (#12831).
 *
 * ## Why this file exists instead of pointing the script at the tool directly
 *
 * The obvious spelling is to make check:pm-dispatch-gates run the tool's own
 * --self-test, with no file in between. That is the one shape this particular
 * tool cannot have. The derivation resolves a check family to its script file
 * and then scans THAT FILE's source for the path literals it operates on — its
 * watch hints — and dispatch-gates.mjs is a tool whose own tests are made of
 * path strings. Measured on the tree at the time of writing: 49 literals
 * extracted from its source, of which 2 name inputs it really reads and 43 are
 * self-test FIXTURES naming other packages. Wired directly, the derivation
 * printed a MATCHED line for this gate on a card touching spec's filter schema,
 * matched via a fixture string inside the self-test — a fabricated lead in the
 * column the tool's contract reserves for high-signal answers, for most of the
 * tree. The tool's own header rejects exactly that ("22 leads is the same as
 * none"), so shipping it as the price of gating the tool would have taken more
 * from every dispatch prompt than the gate gives back.
 *
 * Those numbers are PRE-MASKING, and the decision they justify survives on
 * narrower grounds than they describe. maskSelfTests now blanks the fixture
 * half outright: measured on this tree, the tool's own source yields 4 hints,
 * not 49 — .github/workflows, which it really reads, and packages/plugins,
 * packages/drivers, packages/services, the bases its package resolver probes.
 * Those three are real reads and still cover three of the largest directories
 * in the tree, so a directly-wired gate would print MATCHED for every card
 * under them — a smaller fabrication than the fixture one, of the same kind.
 * The spec filter path from the incident above no longer matches via fixtures;
 * it matches again today through a declared module-body constant (the clause-②
 * suspect glob), pinned as deliberate in the tool's own self-test and inert for
 * gate matching for the same reason as the tier globs beside it.
 *
 * A separate gate file is also what the other two pm gates look like
 * (check-skill-line-ratchet.mjs, check-skill-id-lint.mjs). Its watch hints are
 * the module-body constants below — the tool it runs, plus every module whose
 * edits move this gate's verdict without leaving a hint the extractor can find.
 * Two routes reach this gate and there is no third: a card editing any of those
 * constants, through the hint; a card editing this file, through identity. The
 * step is invoked with no job filter and lint.yml declares no trigger paths, so
 * there is no third provenance to inherit — which is the blind spot #8162 is
 * about.
 *
 * ⛔ That sentence names the constants' SHAPE, not their number, for the reason
 * the ⛔ note above gives. Written as a count it said "the one constant" across
 * two later declarations (#9116) and stayed green the whole time: the self-test
 * pins the SET with containment assertions, and nothing counts the prose. Each
 * constant carries its own reason at its declaration below, which is where a
 * fourth one would be read and where the enumeration therefore lives.
 *
 * ## Why the paths above are unquoted, and why that is no longer required
 *
 * The incident is real and worth keeping. Watch-hint extraction reads any
 * quoted-looking span, backticks included, and it USED TO read comments as
 * well. Written the ordinary way, with each path in backticks, this header
 * alone yielded ten hints — packages/spec/src, packages/objectql,
 * packages/plugins, packages/drivers, .claude/agents, .changeset among them —
 * and reproduced, from the file explaining the pollution, the exact false
 * MATCHED leads it exists to avoid (measured, not predicted: the first draft of
 * this file did it). Hence the convention.
 *
 * The extractor no longer works that way: extractWatchHints opens with
 * maskComments, whose own docblock names this file as the specimen it retires.
 * Re-measured on 74049254d4, the parent of the commit that rewrote this
 * paragraph, with every repo path this header names rewritten into backticks:
 * today's extractor returns exactly the hints the file ships with — the
 * module-body constants below, and nothing out of the header — against the ten
 * the pre-masking extractor returned when this section was first written,
 * reaching spec, objectql, plugins, drivers, .claude/agents and .changeset
 * exactly as the incident describes. Comment masking alone accounts for the
 * difference: masking self-test bodies instead changes nothing here, because
 * this file has none.
 *
 * So the unquoting is no longer load-bearing, and this section is history
 * rather than an instruction: quoting a path in a comment here is now free, and
 * the paths stay unquoted because rewriting them buys nothing. What is NOT free
 * is a path literal in a module body — masking cannot reach one — so the quoted
 * paths below are still exactly this gate's watch hints, each one deliberate
 * rather than a by-product of how a sentence was typed. Only TOOL is a file this
 * gate itself reads; the other two are declared couplings, named because an edit
 * to them moves this gate's verdict with no hint to derive it from. That is the
 * rule to carry into a new gate's header rather than the unquoting.
 *
 * Nothing else belongs in this file. Assertions go in the tool's own self-test,
 * beside the code they judge; this is the CI invocation and its reason.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { EXIT_PREREQUISITE_NOT_MET } from '../import-prerequisite.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;

/**
 * The tool under test, repo-relative — the one path declared here that this gate
 * actually reads, and one of its watch hints.
 */
const TOOL = 'scripts/pm/dispatch-gates.mjs';

/**
 * The tool's shared enumeration module, declared so a card editing it derives
 * this gate (#9116).
 *
 * The tool imports its i18n walks from there instead of mirroring the gate's
 * copies, which is the point of that module — but an import specifier is not a
 * discoverable watch hint (`../i18n-bundle-surface.mjs` strips to a bare
 * filename, which the extractor rejects as unpathy). Without this constant, a
 * change to the shared module would move this gate's verdict — the tool's
 * self-test drives those very functions — while deriving nothing, which is the
 * blind-spot shape the tool exists to remove. Named here, not in the tool: this
 * family resolves to THIS file, and hints are scanned from the file a family
 * resolves to. Pinned live in the tool's own self-test.
 */
const SURFACE_MODULE = 'scripts/i18n-bundle-surface.mjs';

/**
 * The frame-sync gate whose COPIES table the tool's self-test pins the tier
 * mandate against, declared for the same reason as SURFACE_MODULE above
 * (#9116): since the 2026-08-20 clause-① narrowing, part of the
 * fable-mandatory surface is DEFINED as "every file carrying an enforced copy
 * of the decision frame", and the tool's self-test reaches that table through
 * a spawned import — which is not a discoverable watch hint. Without this
 * constant, a change to that gate's COPIES would move this gate's verdict
 * while deriving nothing, which is the blind-spot shape the tool exists to
 * remove. Pinned live in the tool's own self-test.
 */
const FRAME_MODULE = 'scripts/check-skill-frame-sync.mjs';

/**
 * The flag under which this file drives a child OTHER than TOOL, spelled so
 * that any invocation carrying it reads as a test invocation wherever it is
 * written down.
 *
 * ⛔ Not `--tool`, and not an `OS_TEST_*` environment variable. The exit
 * contract below cannot be pinned without standing the 435-second battery
 * down, and the battery is named by a module-body constant, so SOMETHING has
 * to be substitutable. What that something must never be is quiet: a run
 * against a stub grades nothing about the real tool, so the one failure this
 * affordance could introduce is a green gate over a child that is not TOOL.
 * An environment variable is the shape that fails that way — it is inherited
 * from whatever shell the runner was started in, so it can arrive without
 * appearing in any invocation anyone reads. A flag cannot: it is spelled at
 * the call site, `package.json` holds the only invocation CI runs, and the
 * word `self-test` is in the flag itself. The substituted run also announces
 * itself on stderr, and the self-test asserts that it does — so the loudness
 * is live rather than promised.
 *
 * The right boundary matters to a sibling gate: `check-self-test-wired`
 * matches `--self-test` with one, so this longer flag is not read as an
 * invocation of the self-test, and no row is credited for it.
 */
const SELF_TEST_CHILD_FLAG = '--self-test-child';

/** The flag that runs this file's own battery instead of the tool's. */
const SELF_TEST_FLAG = '--self-test';

const argv = process.argv.slice(2);

if (argv.includes(SELF_TEST_FLAG)) await selfTest();

const childAt = argv.indexOf(SELF_TEST_CHILD_FLAG);
const child = childAt < 0 ? TOOL : argv[childAt + 1];
if (child === undefined || child === '') {
  console.error(`✗ check:pm-dispatch-gates: ${SELF_TEST_CHILD_FLAG} needs a path after it.`);
  process.exit(2);
}
if (child !== TOOL) {
  console.error(
    `⛔ check:pm-dispatch-gates: SUBSTITUTED CHILD — this run spawned ${child}, not ${TOOL}, so it grades` +
      " NOTHING about the tool. It exists so this file's own self-test can drive the exit contract below" +
      ' without standing up the real battery. A production run never prints this line.',
  );
}

const started = Date.now();
/**
 * ⛔ The production spawn names TOOL DIRECTLY, and it has to keep doing so.
 *
 * The tool's derivation follows this call as a RUN edge, which is how this gate
 * inherits TOOL's own watch hints — the workflow tree among them — so that a
 * card touching only `.github/workflows` derives this gate at all. That scan
 * refuses a REBOUND program component on purpose, so collapsing both spawns
 * into one `resolve(ROOT, child)` silently cuts the edge. Measured when this
 * file's self-test was first written that way: five cases of the tool's own
 * battery red, and a workflows-only derivation stopped naming this gate
 * entirely. The substituted child therefore gets its OWN call, and the
 * production one is byte-for-byte the expression that was here before.
 */
const result =
  childAt < 0
    ? spawnSync(process.execPath, [join(ROOT, TOOL), '--self-test'], { stdio: 'inherit' })
    : spawnSync(process.execPath, [resolve(ROOT, child), '--self-test'], { stdio: 'inherit' });
/**
 * What the battery cost on THIS box, printed rather than frozen anywhere.
 *
 * The header above refuses to carry a figure and says why: a reading belongs
 * to a named commit, not to a comment. A reading taken at RUN TIME belongs to
 * the run that took it, which is the one shape that cannot rot — and it is
 * what a caller needs, because the cap this file's first section is about is
 * a property of the caller's container and not of this battery.
 */
const seconds = ((Date.now() - started) / 1000).toFixed(1);

if (result.error) {
  // ⛔ NOT the kill branch's code, and the difference is argued in the header's
  // exit-contract section: a spawn that never started has two causes this file
  // cannot tell apart — the tool is gone from the tree, which is a finding
  // about the tree, and the box could not fork, which is not. 3 would assert
  // the second reading over both. Until one measurement separates them this
  // stays the code that claims neither.
  console.error(`✗ check:pm-dispatch-gates: could not run ${child} — ${result.error.message}`);
  process.exit(2);
}
if (result.signal) {
  // ⛔ A kill is NOT a verdict, and this branch is the only place that can
  // say so before a reader reaches for the cases that did print. It answers
  // the question a killed caller actually has — what do I do now — rather
  // than naming the signal and stopping, which is what it used to do.
  console.error(
    `✗ check:pm-dispatch-gates: ${child} --self-test was killed by ${result.signal} after ${seconds}s — NOTHING was measured.`,
  );
  console.error(
    '  Every case decided before the kill is in the output above and every case after it is unjudged, so this run' +
      ' grades neither the tool nor your diff. ⛔ Do not record it as a run.',
  );
  console.error(
    `  This exits ${EXIT_PREREQUISITE_NOT_MET}, the repo-wide NOT MEASURED code, so a record line` +
      ` \`<command> :: exit ${EXIT_PREREQUISITE_NOT_MET}\` reconciles as NOT-MEASURED rather than as a run that failed.`,
  );
  console.error(
    "  Remedy — detach it and read the log, the invocation this file's header prescribes for a capped container:",
  );
  console.error('      nohup pnpm check:pm-dispatch-gates > pm-dispatch-gates.log 2>&1 &');
  console.error('  then tail that log until it stops growing. CI runs this step with no such cap.');
  process.exit(EXIT_PREREQUISITE_NOT_MET);
}
console.error(`check:pm-dispatch-gates: the battery took ${seconds}s on this box.`);
process.exit(result.status ?? 2);

/**
 * This file's own battery — the exit contract, driven against stub children.
 *
 * ## Why it cannot simply run the gate
 *
 * Every other assertion about this file would be a reading of the 435-second
 * tool battery, and the branch under test only fires when that battery is
 * KILLED. A self-test that reproduced the real conditions would have to stand
 * the battery up and then race it, which is the one shape that cannot be run
 * on every PR. So the child is substituted and the three ways a child can end
 * are written directly: killed by a signal, exited red, exited green.
 *
 * ## Why the killed stub kills ITSELF
 *
 * Measured both ways on this box. Signalling from outside — spawn the wrapper,
 * find its child, send it a SIGTERM — needs the grandchild's pid, so it races
 * the spawn and reads the process table to get it; and `timeout -s TERM` on
 * the wrapper does not exercise this branch AT ALL, because the wrapper has no
 * SIGTERM handler and dies with the child, leaving `timeout`'s own 124 and no
 * `result.signal` anywhere. A stub that signals its own pid has no race and no
 * pid lookup: node with no SIGTERM listener takes the default disposition, so
 * `spawnSync` reports `signal: 'SIGTERM'` and `status: null` — the exact shape
 * a foreground-cap kill produces, reached deterministically.
 *
 * ## The half that is NOT about this file
 *
 * A number is only a contract if something reads it that way, so each exit is
 * also pushed through the reconciler that consumes it, on a derivation of one
 * family. That is what makes `3` mean NOT MEASURED here rather than merely
 * being three — and the old `2` is pinned alongside it, still reconciling as a
 * run, so the case that motivated the change cannot quietly come back.
 */
async function selfTest() {
  let failures = 0;
  const t = (name, ok) => {
    console.log(`${ok ? '✓' : '✗'} ${name}`);
    if (!ok) failures += 1;
  };

  const SELF = fileURLToPath(import.meta.url);
  const dir = mkdtempSync(join(tmpdir(), 'check-dispatch-gates-selftest-'));
  try {
    const stub = (name, body) => {
      const at = join(dir, name);
      writeFileSync(at, body);
      return at;
    };
    // Signals its own pid: no listener is registered, so the default
    // disposition ends the process and the timer only keeps the loop alive in
    // case delivery is not synchronous.
    const killedChild = stub('killed.mjs', "process.kill(process.pid, 'SIGTERM');\nsetTimeout(() => {}, 5000);\n");
    const redChild = stub('red.mjs', 'process.exit(1);\n');
    const greenChild = stub('green.mjs', 'process.exit(0);\n');

    const drive = (childPath) =>
      spawnSync(process.execPath, [SELF, SELF_TEST_CHILD_FLAG, childPath], { encoding: 'utf8' });

    const killed = drive(killedChild);
    const red = drive(redChild);
    const green = drive(greenChild);

    t(
      'CONTROL: the killed stub really died by SIGNAL, so the branch under test is the one that ran',
      killed.stderr.includes('was killed by SIGTERM'),
    );
    t(
      `⭐ a child killed by a signal exits ${EXIT_PREREQUISITE_NOT_MET} — the code this branch's own text asks for`,
      killed.status === EXIT_PREREQUISITE_NOT_MET,
    );
    t(
      "…and the text that asks for it is still printed, so the two carriers cannot drift apart silently",
      killed.stderr.includes('Do not record it as a run') && killed.stderr.includes('NOTHING was measured'),
    );
    t('a child that RAN and failed keeps its own status', red.status === 1);
    t('a child that RAN and passed keeps its own status', green.status === 0);
    t(
      '⛔ and a substituted child announces itself on every one of those runs — a stub run is never quiet',
      [killed, red, green].every((r) => r.stderr.includes('SUBSTITUTED CHILD')),
    );

    // The reconciler's own reading of those three codes. Imported rather than
    // spawned: what is under test is how a RECORDED code classifies, not how
    // the derivation finds this family, and a spawned derivation would add a
    // full workflow-tree walk per case to every run of this gate.
    const { parseRunRecord, runReconciliation, RUN_RECORD_EXIT_PREFIX, RUN_RECORD_REASON_SEPARATOR } = await import(
      resolve(ROOT, TOOL)
    );
    const COMMAND = 'pnpm check:pm-dispatch-gates';
    const reconcile = (code) =>
      runReconciliation({
        derived: [COMMAND],
        record: parseRunRecord(`${COMMAND}${RUN_RECORD_REASON_SEPARATOR}${RUN_RECORD_EXIT_PREFIX}${code}`),
      });

    const onKill = reconcile(killed.status);
    t(
      `⭐ …and a record of that exit reconciles as NOT-MEASURED, which is the whole contract`,
      onKill.notMeasured.length === 1 && onKill.ran.length === 0 && onKill.unrun.length === 0,
    );
    t(
      '…derived from the CODE, not claimed by the runner — so a killed battery cannot be recorded as a run by hand',
      onKill.notMeasured[0]?.source === 'exit-code',
    );
    t('a red run reconciles as a RUN, and the reconciliation holds', reconcile(red.status).ran.length === 1);
    t('a green run reconciles as a RUN too', reconcile(green.status).ran.length === 1);
    t(
      '⛔ REGRESSION PIN: the code this branch used to exit still reconciles as a RUN — which is why it moved',
      reconcile(2).ran.length === 1 && reconcile(2).notMeasured.length === 0,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(
    failures === 0
      ? '✓ check:pm-dispatch-gates --self-test: the exit contract holds in all three directions.'
      : `✗ check:pm-dispatch-gates --self-test: ${failures} case(s) failed.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}
