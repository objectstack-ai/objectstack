#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// assert-turbo-remote-cache -- says whether the Turbo remote cache was ON for
// the `turbo run build` step before it, and reds a writing run when it was not.
//
//   node scripts/ci/assert-turbo-remote-cache.mjs --site NAME --log FILE [--if-ran] [--move-summary-to DIR]
//   node scripts/ci/assert-turbo-remote-cache.mjs --self-test   # offline, fixtures only
//
// ## What this is for
//
// ci.yml's Build Core comment "Turbo remote cache (#21186)" passes TURBO_TOKEN
// only when the signing key is non-empty, and any of the three credentials
// unset turns the remote cache off with the build otherwise unchanged. turbo
// says so in exactly one line of its run prelude --
// `Remote caching disabled (remote cache requested — set TURBO_TOKEN and
// TURBO_TEAM, …)` -- and nothing read that line, so a missing or rotated secret
// left every carrier building cold with every check green. This step reads it.
//
// ## Inputs
//
//   --site NAME   the carrier, as the step summary and the annotations name it.
//   --log FILE    the build step's turbo STRUCTURED log (`--log-file=FILE`,
//                 repo-relative: turbo 2.11.5 refuses a path that escapes the
//                 repo root and silently writes `.turbo/logs/<epoch>.json`
//                 instead). One JSON object per line; turbo leaves some of the
//                 separating commas out, so it is read line by line, never as
//                 one JSON document.
//   --if-ran      a missing --log means the build step ran no turbo at all
//                 (Test Core's empty-shard exit), so there is nothing to judge
//                 and the step is green. Without the flag a missing log is
//                 PREREQUISITE NOT MET.
//   --move-summary-to DIR
//                 move the run summary this step read out of `.turbo/runs/`
//                 into DIR, so a later step that reads every file there (Test
//                 Core's drift check and timings capture) sees only its own run.
//   GITHUB_EVENT_NAME, GITHUB_REF
//                 decide whether this run WRITES to the remote: `merge_group`,
//                 or `push` / `workflow_dispatch` on refs/heads/main -- the
//                 `remote:rw` branch of the TURBO_CACHE expression every
//                 carrier spells. Keep the two in step.
//   GITHUB_STEP_SUMMARY  the hit / miss / remote-hit table is appended here.
//
// The counts come from the run summary (`--summarize`), whose path is the
// log's `Summary:` line. The summary does not record whether the remote cache
// was on -- only each task's `cache.source` -- which is why the log is read too.
//
// ## The verdict
//
//   enabled                        green.
//   disabled (any reason)          red on a writing run, a warning otherwise:
//                                  fork PRs receive no secrets, and a PR only
//                                  reads.
//   unavailable, transient         a warning on every run. `Could not connect`
//   (`Could not connect`,          and `Unexpected server error` are Vercel's
//   `Unexpected server error`)     side; the build is still correct, and a
//                                  queue that reds on a vendor outage blocks
//                                  every merge for a cache.
//   unavailable, anything else     red on a writing run, a warning otherwise:
//   (auth failed, disabled for     these are an account or billing state that
//   the team, usage limit,         a maintainer has to change, exactly like a
//   spending paused, the mid-run   missing secret.
//   403 that turns it off)
//   no prelude line in the log     PREREQUISITE NOT MET on every run: turbo
//                                  changed its wording, or the step stopped
//                                  writing the log. An instrument that cannot
//                                  read its input has not passed it.
//
// ⛔ Remote HITS are reported, never judged. A writing run can hit only the
// local cache and be healthy; the table is what a seat reads for the hit rate.
//
// ## Exit codes
//
//   0  green, or a warning (the annotation says which).
//   1  a FINDING: a writing run had the remote cache off.
//   3  PREREQUISITE NOT MET: no log (without --if-ran), no remote-caching line
//      in it, or no readable run summary.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { basename, join } from 'node:path';
import process from 'node:process';

import { EXIT_FINDINGS, EXIT_PREREQUISITE_NOT_MET } from '../import-prerequisite.mjs';
import { isEntrypoint } from '../invoked-as.mjs';

const SCRIPT = 'assert-turbo-remote-cache';

// turbo 2.11.5's prelude sentences, read from the binary's strings and
// reproduced on a real run for disabled and unavailable. The first match in a
// turbo-sourced line wins.
const STATE_LINE = /Remote caching (enabled|disabled|unavailable)\b(?:\s*\(([^)]*)\))?/;
// Printed mid-run when the remote answers 403 and turbo gives up on it.
const MIDRUN_OFF = /Remote cache returned 403 and access could not be restored/;
const TRANSIENT_REASON = /^(Could not connect|Unexpected server error)/;
const SUMMARY_LINE = /^\s*Summary:\s+(\S+\.json)\s*$/;

/** One parsed entry per JSON object line of a turbo structured log. */
export function parseStructuredLog(text) {
  const entries = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/,$/, '');
    if (!line.startsWith('{')) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // A line cut off by a killed run; the rest of the log still reads.
    }
  }
  return entries;
}

/** `{ state, reason, sentence, summaryPath }` from the turbo-sourced lines. */
export function readRemoteState(entries) {
  let found = null;
  let summaryPath = null;
  for (const e of entries) {
    if (e?.source !== 'turbo' || typeof e.text !== 'string') continue;
    const text = e.text.trim().replace(/^•\s*/, '');
    if (!found) {
      const m = STATE_LINE.exec(text);
      if (m) found = { state: m[1], reason: m[2] ?? '', sentence: text };
    }
    if (MIDRUN_OFF.test(text)) found = { state: 'unavailable', reason: 'mid-run 403', sentence: text };
    const s = SUMMARY_LINE.exec(e.text);
    if (s) summaryPath = s[1];
  }
  return { ...(found ?? { state: null, reason: '', sentence: '' }), summaryPath };
}

/** Whether this run writes to the remote (the `remote:rw` branch of TURBO_CACHE). */
export function isWritingRun(eventName, ref) {
  if (eventName === 'merge_group') return true;
  return (eventName === 'push' || eventName === 'workflow_dispatch') && ref === 'refs/heads/main';
}

/** `'ok' | 'warn' | 'fail' | 'refuse'` for one state on one kind of run. */
export function judge(state, reason, writing) {
  if (state === 'enabled') return 'ok';
  if (state === 'disabled') return writing ? 'fail' : 'warn';
  if (state === 'unavailable') {
    if (TRANSIENT_REASON.test(reason)) return 'warn';
    return writing ? 'fail' : 'warn';
  }
  return 'refuse';
}

/** Build-task cache counts from a turbo run summary. */
export function countCache(summary) {
  const counts = { tasks: 0, remoteHits: 0, localHits: 0, misses: 0, timeSavedMs: 0 };
  for (const t of summary?.tasks ?? []) {
    if (t.command === '<NONEXISTENT>') continue;
    counts.tasks += 1;
    const c = t.cache ?? {};
    if (c.status === 'HIT') {
      if (c.source === 'REMOTE' || (c.source === undefined && c.remote && !c.local)) counts.remoteHits += 1;
      else counts.localHits += 1;
      counts.timeSavedMs += c.timeSaved ?? 0;
    } else {
      counts.misses += 1;
    }
  }
  return counts;
}

export function renderSummary(site, { state, sentence }, verdict, writing, counts) {
  const mark = { ok: '✅', warn: '⚠️', fail: '❌' }[verdict] ?? '⛔';
  const kind = writing ? 'writing run (merge queue / main)' : 'read-only run';
  const lines = [
    `### ${mark} Turbo remote cache — ${site}`,
    '',
    `Remote caching **${state}** on a ${kind}.`,
    '',
    `> ${sentence}`,
    '',
    '| build tasks | remote hits | local hits | misses | time saved |',
    '|---:|---:|---:|---:|---:|',
    `| ${counts.tasks} | ${counts.remoteHits} | ${counts.localHits} | ${counts.misses} | ${(counts.timeSavedMs / 1000).toFixed(1)} s |`,
    '',
  ];
  return lines.join('\n');
}

function parseArgs(argv) {
  const args = { site: null, log: null, ifRan: false, moveTo: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--site') args.site = argv[++i];
    else if (a === '--log') args.log = argv[++i];
    else if (a === '--if-ran') args.ifRan = true;
    else if (a === '--move-summary-to') args.moveTo = argv[++i];
    else return { error: `unknown argument '${a}'` };
  }
  if (!args.site || !args.log) return { error: '--site and --log are both required' };
  return args;
}

// Workflow-command escaping: a property value (`title=`) also escapes `:` and `,`.
const escData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escProp = (s) => escData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
function annotate(level, title, message) {
  console.log(`::${level} title=${escProp(title)}::${escData(message)}`);
}

function refuse(message) {
  annotate('error', 'Turbo remote cache: NOT MEASURED', message);
  console.log(`${SCRIPT}: PREREQUISITE NOT MET -- ${message}`);
  process.exit(EXIT_PREREQUISITE_NOT_MET);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) refuse(args.error);
  if (!existsSync(args.log)) {
    if (args.ifRan) {
      console.log(`${SCRIPT}: ${args.site}: no turbo log at ${args.log} -- the build step ran no turbo, nothing to judge.`);
      return;
    }
    refuse(`${args.site}: no turbo structured log at ${args.log}; the build step must pass --log-file=${args.log}.`);
  }
  const read = readRemoteState(parseStructuredLog(readFileSync(args.log, 'utf8')));
  if (!read.state) {
    refuse(`${args.site}: no "Remote caching enabled|disabled|unavailable" line in ${args.log}; turbo's wording changed, so this reader is blind until it is updated.`);
  }
  if (!read.summaryPath || !existsSync(read.summaryPath)) {
    refuse(`${args.site}: no run summary named in ${args.log}; the build step must pass --summarize.`);
  }
  let summary;
  try {
    summary = JSON.parse(readFileSync(read.summaryPath, 'utf8'));
  } catch (err) {
    refuse(`${args.site}: run summary ${read.summaryPath} does not parse (${err.message}).`);
  }
  if (args.moveTo) {
    mkdirSync(args.moveTo, { recursive: true });
    renameSync(read.summaryPath, join(args.moveTo, basename(read.summaryPath)));
  }

  const writing = isWritingRun(process.env.GITHUB_EVENT_NAME, process.env.GITHUB_REF);
  const verdict = judge(read.state, read.reason, writing);
  const counts = countCache(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, renderSummary(args.site, read, verdict, writing, counts));
  }
  console.log(`${SCRIPT}: ${args.site}: turbo said: ${read.sentence}`);
  console.log(
    `${SCRIPT}: ${args.site}: ${counts.tasks} build task(s) -- ${counts.remoteHits} remote hit(s), ` +
      `${counts.localHits} local hit(s), ${counts.misses} miss(es).`,
  );
  if (verdict === 'ok') return;
  const title = `Turbo remote cache ${read.state} (${args.site})`;
  if (verdict === 'warn') {
    annotate('warning', title, read.sentence);
    return;
  }
  annotate(
    'error',
    title,
    `${read.sentence} -- this run writes the remote cache, so it must be on. ` +
      'Check the TURBO_TOKEN and TURBO_REMOTE_CACHE_SIGNATURE_KEY secrets and the TURBO_TEAM variable.',
  );
  process.exit(EXIT_FINDINGS);
}

// ---------------------------------------------------------------------------
// Self-test -- the parse, the verdict table and the counts, on fixtures.
// ---------------------------------------------------------------------------

// Set only after the verdict line prints; the dispatch refuses when it is unset
// (AGENTS.md, "Writing a --self-test": the handshake).
let selfTestReachedVerdict = false;

// Battery name -> minimum case count. A literal, so a deleted battery names
// itself in the refusal instead of taking its own floor with it.
const SELF_TEST_BATTERIES = Object.freeze({
  'structured log parsing': 3,
  'remote state': 7,
  'writing run': 5,
  'verdict table': 9,
  'cache counts': 5,
  'rendering': 3,
});
const SELF_TEST_BATTERY_FLOOR = 6;

function selfTest() {
  const seen = new Map();
  let current = null;
  let failed = 0;
  const battery = (name) => {
    current = name;
  };
  const t = (label, cond) => {
    seen.set(current, (seen.get(current) ?? 0) + 1);
    if (cond) {
      console.log(`  ok    [${current}] ${label}`);
    } else {
      failed += 1;
      console.log(`  FAIL  [${current}] ${label}`);
    }
  };
  const turboLine = (text, level = 'info') => JSON.stringify({ source: 'turbo', level, timestamp: 1, text });
  const taskLine = (text) => JSON.stringify({ source: '@objectstack/spec#build', level: 'stdout', timestamp: 1, text });
  // The shape turbo 2.11.5 writes: an array, with some separating commas missing.
  const logOf = (...lines) => ['[', ...lines.map((l, i) => (i % 2 ? `${l},` : l)), ']'].join('\n');
  const DISABLED =
    '   • Remote caching disabled (remote cache requested — set TURBO_TOKEN and TURBO_TEAM, or run "turbo login" and "turbo link"), using shared worktree cache';

  battery('structured log parsing');
  {
    const entries = parseStructuredLog(logOf(turboLine('   • turbo 2.11.5'), turboLine(DISABLED), taskLine('cache miss, executing abc')));
    t('reads every object line, with or without a trailing comma', entries.length === 3);
    t('a cut-off last line is dropped, the rest still read', parseStructuredLog(`[\n${turboLine('a')},\n{"source":"tu`).length === 1);
    t('a separator-only line is not an entry', parseStructuredLog('[\n,\n]').length === 0);
  }

  battery('remote state');
  {
    const r = (...lines) => readRemoteState(parseStructuredLog(logOf(...lines)));
    const d = r(turboLine(DISABLED), turboLine('Summary:    /w/.turbo/runs/X.json'));
    t('disabled, with its reason', d.state === 'disabled' && d.reason.startsWith('remote cache requested'));
    t('the summary path is read from the Summary: line', d.summaryPath === '/w/.turbo/runs/X.json');
    t('enabled', r(turboLine('   • Remote caching enabled')).state === 'enabled');
    const u = r(turboLine('   • Remote caching unavailable (Could not connect to "https://vercel.com/api"), using shared worktree cache', 'warn'));
    t('unavailable, with its reason', u.state === 'unavailable' && u.reason.startsWith('Could not connect'));
    t(
      'the mid-run 403 overrides an enabled prelude',
      r(turboLine('   • Remote caching enabled'), turboLine('Remote cache returned 403 and access could not be restored; disabling remote caching for this run', 'warn')).state ===
        'unavailable',
    );
    t('a task printing the sentence is not turbo saying it', r(taskLine('Remote caching enabled')).state === null);
    t('no prelude line reads as no state', r(turboLine('   • turbo 2.11.5')).state === null);
  }

  battery('writing run');
  t('merge_group writes', isWritingRun('merge_group', 'refs/heads/gh-readonly-queue/main/pr-1-abc'));
  t('push to main writes', isWritingRun('push', 'refs/heads/main'));
  t('workflow_dispatch on main writes', isWritingRun('workflow_dispatch', 'refs/heads/main'));
  t('pull_request only reads', !isWritingRun('pull_request', 'refs/pull/1/merge'));
  t('schedule only reads', !isWritingRun('schedule', 'refs/heads/main'));

  battery('verdict table');
  t('enabled is green on a writing run', judge('enabled', '', true) === 'ok');
  t('enabled is green on a read-only run', judge('enabled', '', false) === 'ok');
  t('disabled reds a writing run', judge('disabled', 'remote cache requested', true) === 'fail');
  t('disabled only warns a read-only run', judge('disabled', 'remote cache requested', false) === 'warn');
  t('could-not-connect only warns, even a writing run', judge('unavailable', 'Could not connect to "x"', true) === 'warn');
  t('a server error only warns, even a writing run', judge('unavailable', 'Unexpected server error at "x"', true) === 'warn');
  t('auth failure reds a writing run', judge('unavailable', 'Authentication failed', true) === 'fail');
  t('usage limit only warns a read-only run', judge('unavailable', 'Usage limit exceeded', false) === 'warn');
  t('no state refuses', judge(null, '', false) === 'refuse');

  battery('cache counts');
  {
    const c = countCache({
      tasks: [
        { command: 'tsup', cache: { local: true, remote: false, status: 'HIT', source: 'LOCAL', timeSaved: 1000 } },
        { command: 'tsup', cache: { local: false, remote: true, status: 'HIT', source: 'REMOTE', timeSaved: 2500 } },
        { command: 'tsup', cache: { local: false, remote: false, status: 'MISS', timeSaved: 0 } },
        { command: '<NONEXISTENT>', cache: { local: false, remote: false, status: 'MISS', timeSaved: 0 } },
      ],
    });
    t('a task with no command is not counted', c.tasks === 3);
    t('a REMOTE-sourced hit is a remote hit', c.remoteHits === 1);
    t('a LOCAL-sourced hit is a local hit', c.localHits === 1);
    t('a miss is a miss', c.misses === 1);
    t('time saved sums the hits', c.timeSavedMs === 3500);
  }

  battery('rendering');
  {
    const counts = { tasks: 76, remoteHits: 70, localHits: 4, misses: 2, timeSavedMs: 123400 };
    const md = renderSummary('Build Core', { state: 'enabled', sentence: 'Remote caching enabled' }, 'ok', true, counts);
    t('names the site', md.includes('Turbo remote cache — Build Core'));
    t('carries the counts row', md.includes('| 76 | 70 | 4 | 2 | 123.4 s |'));
    t('quotes turbo verbatim', md.includes('> Remote caching enabled'));
  }

  const declared = Object.keys(SELF_TEST_BATTERIES);
  const floor = [];
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floor.push(`only ${declared.length} batteries declared, below the pinned ${SELF_TEST_BATTERY_FLOOR}`);
  }
  for (const name of seen.keys()) {
    if (!declared.includes(name)) floor.push(`battery "${name}" registered cases but is not declared`);
  }
  for (const name of declared) {
    const count = seen.get(name) ?? 0;
    if (count < SELF_TEST_BATTERIES[name]) {
      floor.push(`battery "${name}" registered ${count} case(s), below its pinned ${SELF_TEST_BATTERIES[name]}`);
    }
  }
  for (const line of floor) console.log(`  FAIL  [floor] ${line}`);
  failed += floor.length;

  const cases = [...seen.values()].reduce((a, b) => a + b, 0);
  if (failed > 0) {
    console.log(`\n${SCRIPT} self-test: FAILED (${failed} of ${cases} case(s) and floor checks).`);
    process.exit(EXIT_FINDINGS);
  }
  console.log(`\n${SCRIPT} self-test: OK (${cases} case(s) across ${declared.length} batteries).`);
  selfTestReachedVerdict = true;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        `\n${SCRIPT} self-test: selfTest() returned without reaching its verdict, so no success line was\n` +
          'printed. Exiting 0 here would report a self-test that never finished as one that passed.',
      );
      process.exit(EXIT_FINDINGS);
    }
  } else {
    main();
  }
}
