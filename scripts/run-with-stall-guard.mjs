#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// run-with-stall-guard -- a stalled test run must SAY it stalled, not sit
// in_progress until someone reads log timestamps.
//
// Test Core has hung mid-suite with frozen output -- three times in one day
// (#4250). The signature is mechanical: a healthy run prints continuously and
// finishes in ~9-12 minutes; a stalled one stops emitting bytes entirely (two
// log fetches 9 minutes apart returned byte-identical content) while the job
// stays in_progress until the job-level timeout or a human cancels. A job
// timeout cannot tell "slow" from "stopped" -- only output progress can. So
// this wrapper watches exactly that: if the wrapped command emits nothing for
// --stall-minutes, it declares a stall, prints the last line seen and how long
// ago it was seen, kills the command's process group, and exits 75
// (EX_TEMPFAIL: the sanctioned response is a rerun -- every #4250 occurrence
// passed on rerun of the same commit).
//
//   node scripts/run-with-stall-guard.mjs --log <file> [--stall-minutes N] \
//     [--report-dir <dir>] -- <command...>
//
// It also owns the log tee: combined stdout+stderr is forwarded to this
// process's stdout AND appended to --log (which check-test-completeness.mjs
// reads afterwards). The old `cmd 2>&1 | tee $log` pattern needed
// `set -o pipefail` or tee's exit status would mask a red suite; here the
// child's real exit status is propagated by construction, so there is no pipe
// to guard. Do not reintroduce `| tee`.
//
// ## The instrument's one precondition: the wrapped command must STREAM
//
// The guard measures output FLUSHES, so it is only a liveness instrument when
// the wrapped pipeline flushes while work is running. Turbo's default log
// order in CI is GROUPED — a task's output is buffered and flushed only when
// the task ENDS — which turns "one task still running" into "zero bytes", and
// a shard whose tail is a single task longer than --stall-minutes into a
// guaranteed kill of a HEALTHY suite (measured twice in one day: exit 75 with
// `Test Files 173 passed (173)` arriving in the very flush the kill forced,
// stamped ~40ms after it). That red reproduces on rerun, so it reads as "not
// a flake, therefore the diff" — the exact false trail #4250's triage line
// warns against. So the precondition is ENFORCED, not documented: a wrapped
// command that invokes turbo without `--log-order=stream` is refused at
// startup (exit 1, before anything runs). pnpm's recursive runner streams
// with per-package prefixes (measured), so non-turbo callers are untouched.
//
// ## The second signal: source-side write progress (the liveness probe)
//
// Output flushes are the primary instrument and they are measured at the WRONG
// END of the pipeline: what the guard sees is whatever the last buffering layer
// chose to release. `--log-order=stream` closes one spelling of that; any future
// layer -- a reporter change, a new runner, a pnpm output-mode change --
// re-opens it, and the result is a healthy suite killed deterministically on an
// innocent diff.
//
// So there is a second, independent signal: the bytes every process in the
// wrapped group has passed to write(), read from /proc/<pid>/io (wchar). That is
// the SAME quantity the guard already trusts, sampled at the SOURCE -- before
// any buffering layer can hide it.
//
// ### What a genuinely frozen suite looks like to this probe
//
// Zero bytes written by ANY process in the group for the whole stall window.
// Not "no CPU" -- CPU is precisely the signal that does not work here. Measured
// on this repo (node 22, 2.5s sample, one process per shape):
//
//     shape                        state  dCPU(ticks)  dwchar(bytes)
//     idle hang (self-test #4)     S                0              0
//     sync-spinning hang (#5)      R              251              0
//     GC-thrash hang               R              272              0
//     HEALTHY silent-but-working   S                1         25,542
//
// Read the CPU column before designing anything on it: the two genuine hangs peg
// a core, while the healthy suite the probe exists to protect is nearly IDLE --
// it is I/O-bound, it is busy WRITING. A naive "burning CPU therefore alive,
// therefore do not kill" probe would have protected the hangs and killed the
// healthy suite. CPU does not merely fail to separate these shapes, it separates
// them BACKWARDS. wchar separates all four correctly.
//
// ### The probe may only ever DELAY a kill, and only to a hard cap
//
// A hang that writes while wedged (a retry loop, a poller, a log spin) would
// look alive to this probe forever, so it is a CONFIRMING signal in exactly one
// direction:
//
//   * no output AND no source-side bytes -> stall, killed at --stall-minutes,
//     exactly as before. Idle and spinning hangs take this path with no added
//     latency, because they write nothing.
//   * no output BUT source-side bytes still moving -> the kill is DEFERRED, and
//     the deferral is announced loudly: it means a buffering layer is hiding a
//     live suite from this guard, and that layer should be FIXED, not tolerated.
//   * ...until --stall-cap-minutes, when the group is killed anyway under a
//     DISTINCT verdict (STALL-CAP). That cap is what stops the probe from
//     converting "kills healthy suites" into "never fires on spin hangs", which
//     is strictly worse: a job sitting in_progress until the job timeout is the
//     state this guard exists to abolish, and no green run can distinguish that
//     regression from success.
//
// The cap's ceiling is not a matter of taste. Every guard-wrapped job in ci.yml
// runs `timeout-minutes: 30` against `--stall-minutes 10`, so a cap set "far
// above" the window would just hand the verdict back to the job timeout. Default
// is 2x the window; a cap <= the window is REFUSED, because it would disable the
// probe silently.
//
// ## What this guard does NOT see (#12846)
//
// Two limits, both worth knowing before trusting a green run:
//
//   1. THE DEFERRED PATH CAN STILL LOSE TO THE JOB TIMEOUT. The verdict lands at
//      `p + s + C` -- job prep, plus how far into the step the output froze, plus
//      the cap -- and on the ci.yml family that can exceed `timeout-minutes`, in
//      which case the job dies unlabelled and the STALL-CAP banner above is never
//      printed. The undeferred path (kill at the window) still clears it, so this
//      is the deferred path only. The term that decides it is the healthy run
//      length, which no static check can read; the full statement of the boundary,
//      and how to re-take the measurement rather than trust a number, is in the
//      header of `scripts/check-stall-guard-budget.mjs`.
//
//   2. THIS GUARD ONLY EVER FIRES ON SILENCE. `silentMs` is reset by every chunk
//      of output, and there is no absolute deadline anywhere in this file. So a
//      wedge that KEEPS WRITING -- a retry loop, a poller, a log spin -- never
//      reaches the cap logic at all and is bounded only by the job timeout. The
//      note above about such a hang concerns one that has ALREADY gone quiet at
//      this guard while writing at the source; one that never goes quiet here is
//      invisible to the instrument. Likewise a wedge in a step this guard does not
//      wrap is not watched at all -- on the `test` job that is 16 of its 17 steps.
//      Raising a job timeout does not extend this guard's reach over either shape.
//
// If /proc/<pid>/io cannot be read (not Linux, hardened permissions), the probe
// reports itself UNAVAILABLE and the guard behaves exactly as it did before this
// signal existed. An unreadable probe must never read as liveness.
//
// ## Stall forensics (before the kill)
//
// A declared stall triages itself instead of leaving a mystery for a human:
//
//   1. Every process in the command's process group is sampled twice via
//      /proc (state + CPU time, ~2s apart) and classified: a process that is
//      BURNING CPU is sync-spinning or GC-thrashing; one that is idle is
//      waiting on something that never settles.
//   2. With --report-dir set AND the processes launched with
//      NODE_OPTIONS="--report-on-signal --report-signal=SIGUSR2
//      --report-directory=<dir>", each node process in the group gets a
//      SIGUSR2: a live event loop responds with a diagnostic report (exact JS
//      stack + open libuv handles), which is digested into the output. A node
//      process that produces NO report has a BLOCKED event loop -- the
//      no-report fact plus its CPU classification is itself the diagnosis.
//      (Verified: report-on-signal is served BY the event loop, so a
//      sync-blocked process stays silent -- that is signal, not failure.)
//
// Forensics are best-effort (Linux /proc; every step try/caught) and never
// delay the kill by more than ~6s.
//
// ## Teardown: SIGTERM, then SIGKILL for real
//
// A stall verdict must leave nothing behind. SIGTERM goes to the whole process
// group; the guard then WAITS for the group to actually empty (polling /proc)
// and SIGKILLs whatever is still standing before it exits.
//
// The wait is the point. The previous shape armed an unref'd
// `setTimeout(SIGKILL, 10s)` and exited from the direct child's 'exit' handler
// -- but the direct child (pnpm -> turbo, or sh) dies on SIGTERM immediately, so
// the guard exited first and the SIGKILL timer never fired. Any DESCENDANT that
// traps SIGTERM outlived the guard. That is not hypothetical here:
// `ObjectKernelConfig.gracefulShutdown` defaults on and registers exactly such a
// handler in every kernel a test boots (#4250's own root-cause pass counted 47
// kernels and 48 SIGTERM interceptions in a single objectql suite run), so the
// stall most likely to leak workers is the one this guard exists for.
//
// ## Verifying the guard (--self-test)
//
//   node scripts/run-with-stall-guard.mjs --self-test
//
// A guard that has never fired is indistinguishable from a guard that does not
// work, and this one only fires on an event that is rare and not reproducible on
// demand. So its firing is exercised on every CI run against SYNTHETIC stalls:
// an idle hang, a sync-spinning hang, a hang that never emits a first line, and
// a SIGTERM-trapping descendant. The self-test asserts the verdict (exit 75),
// the classification (idle vs ON-CPU), the SIGUSR2 harvest including the "no
// report = blocked event loop" inference, full group teardown, and -- in the
// other direction -- that a healthy run still propagates its own exit status and
// that steady output is never mistaken for a stall.
//
// Exit status: the child's own code when it finishes; 75 on a declared stall;
// 1 when the child dies on a signal this guard did not send.

import { spawn } from 'node:child_process';
import {
  createWriteStream,
  readFileSync,
  readdirSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const STALL_EXIT_CODE = 75; // EX_TEMPFAIL
const CHECK_INTERVAL_MS = 5_000;
const SIGKILL_GRACE_MS = 10_000;
// How far above --stall-minutes the liveness probe may defer a kill, when it is
// not given an explicit --stall-cap-minutes. Deliberately small: the guard-wrapped
// jobs run `timeout-minutes: 30` against a 10-minute window, so a larger multiple
// would return the verdict to the job timeout -- the outcome the guard abolishes.
const DEFAULT_CAP_MULTIPLE = 2;
// Announce a deferral every N watchdog ticks (the first one always prints). A
// deferral is a bug report about the pipeline, not routine noise -- but repeating
// it every 5s would bury the suite's own output.
const DEFER_NOTE_EVERY = 12;

const argv = process.argv.slice(2);

// Handled before the option loop below: --self-test takes no --log and must not
// spawn a wrapped command. selfTest() never returns.
if (argv.includes('--self-test')) await selfTest();

let logPath = '';
let stallMinutes = 10;
let stallCapMinutes = 0; // 0 = derive from stallMinutes
let livenessProbe = true;
let reportDir = '';
let command = [];

for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--log') logPath = argv[++i] ?? '';
  else if (argv[i] === '--stall-minutes') stallMinutes = Number(argv[++i]);
  else if (argv[i] === '--stall-cap-minutes') stallCapMinutes = Number(argv[++i]);
  else if (argv[i] === '--no-liveness-probe') livenessProbe = false;
  else if (argv[i] === '--report-dir') reportDir = argv[++i] ?? '';
  else if (argv[i] === '--') {
    command = argv.slice(i + 1);
    break;
  } else {
    console.error(`run-with-stall-guard: unknown option ${argv[i]}`);
    process.exit(1);
  }
}

if (!logPath || command.length === 0 || !Number.isFinite(stallMinutes) || stallMinutes <= 0) {
  console.error(
    'run-with-stall-guard: usage: run-with-stall-guard.mjs --log <file> [--stall-minutes N]\n' +
      '  [--stall-cap-minutes N] [--no-liveness-probe] [--report-dir <dir>] -- <command...>',
  );
  process.exit(1);
}

if (stallCapMinutes === 0) stallCapMinutes = stallMinutes * DEFAULT_CAP_MULTIPLE;
if (!Number.isFinite(stallCapMinutes) || stallCapMinutes <= stallMinutes) {
  console.error(
    `run-with-stall-guard: --stall-cap-minutes (${stallCapMinutes}) must be GREATER than ` +
      `--stall-minutes (${stallMinutes}).\n` +
      '  The cap bounds how long the liveness probe may defer a kill while the wrapped group\n' +
      '  is still writing bytes at the source. A cap at or below the stall window disables\n' +
      '  the probe silently, and a probe that is silently off is indistinguishable from one\n' +
      '  that works -- so this is refused instead.',
  );
  process.exit(1);
}

// The precondition check from the header: a turbo invocation under this guard
// must pin `--log-order=stream`, or the guard's instrument (output flushes)
// measures buffering artifacts instead of liveness and kills healthy suites by
// construction. Deliberately NOT exported — importing this file would execute
// it (it is an entrypoint, not a library); the self-test pins both directions
// through real subprocess invocations instead.
function turboLogOrderViolation(argv) {
  const runsTurbo = argv.some(
    (tok) => !tok.startsWith('-') && (tok === 'turbo' || tok.endsWith('/turbo')),
  );
  if (!runsTurbo) return false;
  const streams = argv.some(
    (tok, i) =>
      tok === '--log-order=stream' || (tok === '--log-order' && argv[i + 1] === 'stream'),
  );
  return !streams;
}

if (turboLogOrderViolation(command)) {
  console.error(
    'run-with-stall-guard: REFUSING to wrap a turbo invocation without --log-order=stream.\n' +
      "  This guard measures output flushes. Turbo's default log order in CI is grouped —\n" +
      '  a task flushes only when it ENDS — so a task running longer than --stall-minutes\n' +
      '  emits zero bytes and is killed as a stall while perfectly healthy (a deterministic\n' +
      '  red on an innocent diff; it happened, twice in one day, with every test passing).\n' +
      '  Add --log-order=stream to the turbo command so the guard observes real liveness.',
  );
  process.exit(1);
}

const stallMs = stallMinutes * 60_000;
const capMs = stallCapMinutes * 60_000;
const log = createWriteStream(logPath, { flags: 'w' });

// detached: own process group, so a stall verdict can kill pnpm -> turbo -> the
// per-package vitest processes together, not just the top of the tree.
const child = spawn(command[0], command.slice(1), {
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let lastOutputAt = Date.now();
let lastLine = '(no output yet)';
let carry = '';
let stalled = false;

function onChunk(chunk) {
  lastOutputAt = Date.now();
  process.stdout.write(chunk);
  log.write(chunk);

  // Remember the last complete non-blank line for the stall verdict. ANSI is
  // stripped so the verdict quotes text, not colour codes.
  carry = (carry + chunk.toString('utf8')).slice(-8192);
  const nl = carry.lastIndexOf('\n');
  if (nl === -1) return;
  for (const line of carry.slice(0, nl).split('\n').reverse()) {
    const clean = line.replace(/\x1B\[[0-9;]*m/g, '').trim();
    if (clean) {
      lastLine = clean;
      break;
    }
  }
  carry = carry.slice(nl + 1);
}

child.stdout.on('data', onChunk);
child.stderr.on('data', onChunk);

function killGroup(signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    // Group already gone -- the 'exit' handler finishes up.
  }
}

// A declaration, not a `const`: --self-test runs before the module body
// finishes initializing, and an arrow-const would be in its temporal dead zone.
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Close the log and exit. Hoisted out of the child's 'exit' handler because on
 *  a stall it is the teardown sequence, not the child's death, that decides when
 *  the guard may leave. */
const finish = (status) => log.end(() => process.exit(status));

/** One /proc sample of every process in the child's process group.
 *  Returns Map<pid, {comm, state, cpuTicks, rssPages, cmdline}>. */
function sampleGroup() {
  const procs = new Map();
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      // comm may contain spaces/parens -- split at the LAST ')'.
      const rp = stat.lastIndexOf(')');
      const comm = stat.slice(stat.indexOf('(') + 1, rp);
      const f = stat.slice(rp + 2).split(' '); // f[0]=state f[2]=pgrp f[11]=utime f[12]=stime f[21]=rss
      if (Number(f[2]) !== child.pid) continue;
      let cmdline = '';
      try {
        cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
      } catch { /* raced with exit */ }
      procs.set(pid, {
        comm,
        state: f[0],
        cpuTicks: Number(f[11]) + Number(f[12]),
        rssPages: Number(f[21]),
        cmdline: cmdline || `[${comm}]`,
      });
    } catch { /* process vanished between readdir and read */ }
  }
  return procs;
}

// ---------------------------------------------------------------------------
// The liveness probe: source-side write progress
// ---------------------------------------------------------------------------

/** Per-pid wchar counters observed on the previous poll. */
let probeSeen = new Map();
/** True once ANY group member's /proc/<pid>/io was read successfully. While
 *  this is false the probe is UNAVAILABLE and can never postpone a kill: an
 *  unreadable counter must not be mistaken for liveness. */
let probeEverRead = false;
/** The first poll only records counters. Without this, every pid's whole
 *  lifetime total would be booked as "progress just now" on the first tick,
 *  which is a stall's worth of free credit handed to a suite that is already
 *  frozen. */
let probeBaselined = false;
/** Bytes the group has written since the baseline -- quoted in the verdict. */
let probeBytes = 0;
let lastProgressAt = Date.now();

/** One poll of /proc/<pid>/io across the wrapped process group.
 *
 *  Only POSITIVE per-pid deltas count, and a pid seen for the first time
 *  contributes its whole counter (new work starting IS progress), so a process
 *  exiting can never move the accumulator backwards -- an exit must read as
 *  neither a stall nor liveness. Every read is try/caught; the probe is
 *  best-effort and fails CLOSED. */
function pollWriteProgress() {
  let grew = 0;
  const next = new Map();
  let entries;
  try {
    entries = readdirSync('/proc');
  } catch {
    return false; // not Linux: probeEverRead stays false, probe stays unavailable
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    let wchar;
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      // f[2] = pgrp. Scoping to the detached child's group excludes this guard
      // and every other agent's processes on a shared machine.
      if (Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[2]) !== child.pid) continue;
      const m = /^wchar:\s*(\d+)/m.exec(readFileSync(`/proc/${pid}/io`, 'utf8'));
      if (!m) continue;
      wchar = Number(m[1]);
    } catch {
      continue; // vanished mid-read, or io is not readable for this uid
    }
    probeEverRead = true;
    next.set(pid, wchar);
    const prev = probeSeen.get(pid);
    grew += prev === undefined ? wchar : Math.max(0, wchar - prev);
  }
  probeSeen = next;
  if (!probeBaselined) {
    probeBaselined = true;
    return false;
  }
  if (grew > 0) {
    probeBytes += grew;
    lastProgressAt = Date.now();
  }
  return grew > 0;
}

/** One line for the verdict banner: what the second signal saw. */
function probeVerdictLine(now) {
  if (!livenessProbe) return 'disabled (--no-liveness-probe) -- output flushes were the only signal';
  if (!probeEverRead) {
    return 'UNAVAILABLE (/proc/<pid>/io unreadable here) -- output flushes were the only signal';
  }
  const quietM = ((now - lastProgressAt) / 60_000).toFixed(1);
  return `no byte written by ANY process in the group for ${quietM}m -- FROZEN at the source, not merely buffered`;
}

/** Classify every group member from two /proc samples and, when report-dir
 *  plumbing is armed, harvest SIGUSR2 diagnostic reports from the node
 *  processes. Returns the forensics text block (empty string off-Linux). */
async function collectForensics() {
  if (!existsSync('/proc')) return '';
  const lines = [];
  try {
    const before = sampleGroup();
    await sleep(2_000);
    const after = sampleGroup();

    lines.push('Process group at stall time (2s CPU sample):');
    for (const [pid, b] of before) {
      const a = after.get(pid);
      const cpuDelta = a ? a.cpuTicks - b.cpuTicks : 0;
      // 2s sample at 100Hz ticks: >20 ticks ~= >10% of a core.
      const verdict =
        a === undefined ? 'exited during sampling'
        : cpuDelta > 20 || a.state === 'R' ? 'ON-CPU -- sync-spinning or GC-thrashing'
        : 'idle -- waiting on something that never settles';
      const rssMb = Math.round(((a ?? b).rssPages * 4096) / 1_048_576);
      const cmd = b.cmdline.length > 120 ? `${b.cmdline.slice(0, 117)}...` : b.cmdline;
      lines.push(`  pid ${pid} [${b.state}${a ? `->${a.state}` : ''}] cpuΔ=${cpuDelta} ticks rss=${rssMb}MB  ${cmd}`);
      lines.push(`       -> ${verdict}`);
    }

    if (reportDir && existsSync(reportDir)) {
      const already = new Set(readdirSync(reportDir));
      const nodePids = [...after.entries()]
        .filter(([, p]) => /(^|\/)node(\s|$)/.test(p.cmdline) || p.comm === 'node')
        .map(([pid]) => pid);
      for (const pid of nodePids) {
        try { process.kill(pid, 'SIGUSR2'); } catch { /* gone */ }
      }
      await sleep(3_000);
      const fresh = readdirSync(reportDir).filter(
        (f) => f.startsWith('report.') && f.endsWith('.json') && !already.has(f),
      );
      const reportedPids = new Set();
      lines.push('');
      lines.push(`Diagnostic reports (SIGUSR2 -> ${nodePids.length} node process(es), ${fresh.length} responded):`);
      for (const file of fresh.slice(0, 6)) {
        try {
          const report = JSON.parse(readFileSync(join(reportDir, file), 'utf8'));
          const pid = report.header?.processId;
          reportedPids.add(pid);
          const js = report.javascriptStack ?? {};
          lines.push(
            `  -- pid ${pid} (${file}): ${js.message || 'event loop responsive, no active JS frame -- awaiting something that never settles; check the report\'s libuv handles'}`,
          );
          for (const frame of (js.stack ?? []).slice(0, 10)) lines.push(`       ${frame.trim()}`);
        } catch (e) {
          lines.push(`  -- ${file}: unreadable (${e.message})`);
        }
      }
      for (const pid of nodePids) {
        if (reportedPids.has(pid)) continue;
        lines.push(
          `  -- pid ${pid}: NO report -- its event loop is BLOCKED (the report is served ` +
          'by the loop). Cross-check its CPU verdict above: on-CPU = sync spin / GC; ' +
          'idle = wedged outside JS.',
        );
      }
      lines.push('  Full reports kept in the report dir -- upload/inspect for handles and heap.');
    } else if (reportDir) {
      lines.push(`Report dir ${reportDir} does not exist -- SIGUSR2 harvest skipped.`);
    } else {
      lines.push('No --report-dir -- SIGUSR2 stack harvest not armed for this run.');
    }
  } catch (e) {
    lines.push(`(forensics incomplete: ${e.message})`);
  }
  return lines.length ? `\n${lines.join('\n')}\n` : '';
}

/** Wait for the process group to actually empty after SIGTERM, then SIGKILL the
 *  holdouts. Returns the pids that had to be killed (empty = clean shutdown), so
 *  the log can name them: a process that ignored SIGTERM during a stall is
 *  evidence about the stall, not noise. */
async function reapGroup(graceMs) {
  const deadline = Date.now() + graceMs;
  if (!existsSync('/proc')) {
    // Off-Linux we cannot observe the group; wait out the grace, then escalate.
    await sleep(graceMs);
    killGroup('SIGKILL');
    return [];
  }
  let survivors = [];
  while (Date.now() < deadline) {
    try {
      survivors = [...sampleGroup().keys()];
    } catch {
      survivors = [];
    }
    if (survivors.length === 0) return [];
    await sleep(250);
  }
  killGroup('SIGKILL');
  return survivors;
}

let probeDeferrals = 0;

const watchdog = setInterval(() => {
  if (livenessProbe) pollWriteProgress();
  const silentMs = Date.now() - lastOutputAt;
  if (silentMs < stallMs) return;

  // The second signal, in the ONE direction it is safe in. It may postpone a
  // kill while the group is demonstrably still producing bytes -- never past the
  // cap, and never at all when the counters could not be read. An idle or a
  // sync-spinning hang writes nothing, so neither is ever postponed by this.
  const sourceAlive =
    livenessProbe && probeEverRead && Date.now() - lastProgressAt < stallMs;
  const capped = silentMs >= capMs;

  if (sourceAlive && !capped) {
    if (probeDeferrals % DEFER_NOTE_EVERY === 0) {
      const note =
        `\n⚠ stall guard: no output reached this guard for ${(silentMs / 60_000).toFixed(1)}m, but the wrapped\n` +
        `  group has written ${probeBytes} bytes at the source since then -- deferring the kill\n` +
        `  until the cap (${stallCapMinutes}m). A live suite is being hidden from this guard by a\n` +
        '  buffering layer: FIX THE LAYER (every turbo under this guard must pin\n' +
        '  --log-order=stream), do not rely on this deferral.\n';
      process.stdout.write(note);
      log.write(note);
    }
    probeDeferrals++;
    return;
  }

  stalled = true;
  clearInterval(watchdog);
  const now = Date.now();
  const banner = sourceAlive
    ? `
${'═'.repeat(72)}
⛔ STALL-CAP: nothing reached this guard for ${(silentMs / 60_000).toFixed(1)} minutes (cap: ${stallCapMinutes}m),
   but the wrapped group kept WRITING the whole time.

   frozen since : ${new Date(lastOutputAt).toISOString()}  (as this guard sees it)
   last written : ${new Date(lastProgressAt).toISOString()}  (as /proc/<pid>/io sees it)
   bytes written: ${probeBytes} since the probe's baseline
   last line    : ${lastLine}

   This group is NOT frozen -- it is producing output that never arrives here.
   Two things look exactly like this, and both are bugs to fix rather than
   wait out:

     1. A BUFFERING LAYER between the suite and this guard -- the class turbo's
        grouped log order was one spelling of. Check that every turbo under this
        guard pins --log-order=stream and that no reporter or runner in the
        pipeline groups its output.
     2. A hang that WRITES while wedged -- a retry loop, a poller, a log spin.
        The forensics below name which processes were burning the bytes.

   Killing at the cap instead of deferring forever: a guard that never fires
   leaves the job in_progress until the job timeout, which is the state this
   guard exists to abolish.

   Collecting forensics before the kill (process states + JS stacks)...
${'═'.repeat(72)}
`
    : `
${'═'.repeat(72)}
⛔ STALL: no test output for ${(silentMs / 60_000).toFixed(1)} minutes (limit: ${stallMinutes}m).

   frozen since : ${new Date(lastOutputAt).toISOString()}
   last line    : ${lastLine}
   liveness probe: ${probeVerdictLine(now)}

   This is the #4250 failure mode -- the suite is STOPPED, not slow. A
   healthy run prints continuously; only a hang goes silent this long.
   Killing the test process group and failing the step now, instead of
   sitting in_progress until the job timeout.

   Triage: every #4250 stall so far passed on a plain rerun of the same
   commit -- rerun this job before suspecting the diff. If it stalls twice
   at the same test file, add that occurrence to #4250.

   Collecting forensics before the kill (process states + JS stacks)...
${'═'.repeat(72)}
`;
  process.stdout.write(banner);
  log.write(banner);
  void collectForensics().then(async (forensics) => {
    if (forensics) {
      process.stdout.write(forensics);
      log.write(forensics);
    }
    // Own the teardown AND the exit: waiting for the group to empty is the only
    // way SIGKILL escalation can ever run (the direct child dies on SIGTERM at
    // once, and exiting on its death is what used to strand every descendant
    // that traps SIGTERM). The child's 'exit' handler defers to this path.
    killGroup('SIGTERM');
    const survivors = await reapGroup(SIGKILL_GRACE_MS);
    if (survivors.length) {
      const note =
        `\n   ${survivors.length} process(es) ignored SIGTERM for ${SIGKILL_GRACE_MS / 1000}s ` +
        `and were SIGKILLed: ${survivors.join(', ')}\n` +
        '   (a stalled process that also refuses SIGTERM is itself a clue — check\n' +
        '    the forensics above for what those pids were doing.)\n';
      process.stdout.write(note);
      log.write(note);
    }
    finish(STALL_EXIT_CODE);
  });
}, Math.min(CHECK_INTERVAL_MS, Math.max(250, stallMs / 2)));

child.on('error', (err) => {
  clearInterval(watchdog);
  console.error(`run-with-stall-guard: failed to start ${command[0]} -- ${err.message}`);
  log.end(() => process.exit(1));
});

child.on('exit', (code, signal) => {
  clearInterval(watchdog);
  if (stalled) {
    // The stall path owns the exit — it is still reaping the group. Returning
    // here is what gives SIGKILL escalation a chance to run at all.
    return;
  }
  if (signal) {
    console.error(`run-with-stall-guard: command killed by ${signal}`);
    finish(1);
  } else {
    finish(code ?? 1);
  }
});

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

/** SIGKILL every process whose command line mentions `marker`.
 *
 *  The marker is this run's mkdtemp path, which is threaded through the argv of
 *  every synthetic child — so this matches ONLY processes this self-test
 *  started. Matching on a program name instead (`node`, `vitest`) would reach
 *  into whatever else shares the machine, including a parallel agent's test run.
 */
function killByMarker(marker) {
  if (!existsSync('/proc')) return 0;
  let killed = 0;
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid === process.pid) continue;
    try {
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (!cmdline.includes(marker)) continue;
      process.kill(pid, 'SIGKILL');
      killed++;
    } catch { /* vanished, or not ours to read */ }
  }
  return killed;
}

/** Run this script as a subprocess and capture its verdict.
 *
 *  'close' (not 'exit') so the captured output is complete.
 *
 *  The case timeout is not boilerplate. Every stall case here wraps a child that
 *  hangs FOREVER by construction, so a guard that fails to detect the stall
 *  never exits — and an unbounded self-test would then hang exactly the way
 *  #4250 hangs, needing a job timeout and a human to interpret it. That is the
 *  failure mode this whole script exists to abolish; the verifier must not
 *  reproduce it. On timeout the case is a labeled red, and the orphaned
 *  synthetic children are reaped by marker.
 */
function runGuard(args, env = {}, { timeoutMs = 90_000, marker = '' } = {}) {
  const selfPath = fileURLToPath(import.meta.url);
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [selfPath, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { p.kill('SIGKILL'); } catch { /* already gone */ }
      if (marker) killByMarker(marker);
    }, timeoutMs);
    p.stdout.on('data', (c) => (out += c));
    p.stderr.on('data', (c) => (out += c));
    p.on('close', (code) => {
      clearTimeout(timer);
      // Deliberately NO marker sweep here. The teardown case asserts that a
      // descendant did NOT survive the guard, and reaping on the way out would
      // erase the very leak it looks for — a mutation restoring the pre-fix
      // teardown went green while this sweep was in place. Survivors are swept
      // once, after every case has been judged.
      resolve({ code, out, timedOut });
    });
  });
}

/** Exercise the guard against synthetic stalls. Exits 0 / 1; never returns. */
async function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'stall-guard-selftest-'));
  const linux = existsSync('/proc');
  const failures = [];
  const results = [];

  // 3s stall window. The watchdog's poll interval tracks the window
  // (min(5s, window/2)), so detection lands ~3-4.5s in rather than waiting out
  // a fixed 5s tick — the production 10-minute window still polls every 5s.
  const WINDOW = ['--stall-minutes', '0.05'];

  const check = (label, cond, detail) => {
    if (cond) {
      results.push(`  ✓ ${label}`);
    } else {
      failures.push(label);
      results.push(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    }
  };

  // Arms the SIGUSR2 stack harvest in the synthetic children, exactly as the
  // CI steps do. Without this the "no report = blocked loop" inference cannot
  // be distinguished from "reports were never enabled".
  const reportEnv = (d) => ({
    NODE_OPTIONS: `--report-on-signal --report-signal=SIGUSR2 --report-directory=${d}`,
  });

  try {
    // -- 1. A healthy run is untouched: real exit status, both streams tee'd. --
    {
      const log = join(dir, 'healthy.log');
      const { code, out } = await runGuard([
        '--log', log, ...WINDOW, '--',
        process.execPath, '-e',
        "console.log('suite passed'); console.error('a warning on stderr');", dir,
      ], {}, { marker: dir });
      const logged = readFileSync(log, 'utf8');
      check('healthy run exits 0', code === 0, `got ${code}`);
      check('healthy run is not called a stall', !out.includes('STALL'));
      check('stdout and stderr both reach the log',
        logged.includes('suite passed') && logged.includes('a warning on stderr'), logged);
    }

    // -- 2. A red suite stays red: the child's status, not the wrapper's. --
    //    This is the invariant that replaced `| tee` + `set -o pipefail`; if it
    //    regresses, every failing suite in CI reports green.
    {
      const { code } = await runGuard([
        '--log', join(dir, 'failing.log'), ...WINDOW, '--',
        process.execPath, '-e', "console.log('3 tests failed'); process.exitCode = 3;", dir,
      ], {}, { marker: dir });
      check('failing suite propagates its exit code', code === 3, `got ${code}`);
    }

    // -- 3. Slow but alive is NOT a stall. Output resets the clock. --
    {
      const { code, out } = await runGuard([
        '--log', join(dir, 'slow.log'), ...WINDOW, '--',
        process.execPath, '-e',
        "let n = 0; const t = setInterval(() => { console.log('still running ' + n); " +
          'if (++n > 12) { clearInterval(t); } }, 400);', dir,
      ], {}, { marker: dir });
      check('steady output past the stall window is not a stall',
        code === 0 && !out.includes('STALL'), `exit ${code}`);
    }

    // -- 3b. The turbo log-order precondition, both directions. --
    //    Grouped log order flushes a task's output only when the task ends, so
    //    a guard-wrapped turbo without --log-order=stream kills a healthy solo
    //    tail task BY CONSTRUCTION (the 2026-08-24 healthy-kill pair: exit 75
    //    with 173/173 files passing in the flush the kill forced). The wrap is
    //    refused before anything spawns. Refusal shapes use a bare `turbo`
    //    that never runs; accepted turbo-shapes use a nonexistent path so the
    //    verdict is "failed to start", never a real turbo against this repo.
    {
      const refused = await runGuard(
        ['--log', join(dir, 'lo1.log'), ...WINDOW, '--', 'turbo', 'run', 'test'],
        {}, { marker: dir },
      );
      check('a guard-wrapped turbo without --log-order=stream is refused',
        refused.code === 1 && refused.out.includes('REFUSING'), `exit ${refused.code}`);
      check('the refusal happens before anything runs (no stall verdict, no spawn)',
        !refused.out.includes('STALL') && !refused.out.includes('failed to start'));

      const viaPnpm = await runGuard(
        ['--log', join(dir, 'lo2.log'), ...WINDOW, '--',
          'pnpm', 'turbo', 'run', 'test', '--concurrency=4', '--log-order=grouped'],
        {}, { marker: dir },
      );
      check('an explicit --log-order=grouped is refused too',
        viaPnpm.code === 1 && viaPnpm.out.includes('REFUSING'), `exit ${viaPnpm.code}`);

      const streamed = await runGuard(
        ['--log', join(dir, 'lo3.log'), ...WINDOW, '--',
          '/nonexistent/turbo', 'run', 'test', '--log-order=stream'],
        {}, { marker: dir },
      );
      check('--log-order=stream lifts the refusal (reaches spawn)',
        !streamed.out.includes('REFUSING') && streamed.out.includes('failed to start'),
        streamed.out.trim().split('\n')[0]);

      const spaced = await runGuard(
        ['--log', join(dir, 'lo4.log'), ...WINDOW, '--',
          '/nonexistent/turbo', 'run', 'test', '--log-order', 'stream'],
        {}, { marker: dir },
      );
      check('the split `--log-order stream` spelling is accepted as well',
        !spaced.out.includes('REFUSING') && spaced.out.includes('failed to start'));

      const flagValue = await runGuard(
        ['--log', join(dir, 'lo5.log'), ...WINDOW, '--',
          'sh', '-c', 'echo turbo-adjacent ok', 'sh', '--tag=turbo'],
        {}, { marker: dir },
      );
      check('`turbo` inside a flag value does not trip the refusal',
        flagValue.code === 0 && !flagValue.out.includes('REFUSING'), `exit ${flagValue.code}`);
    }

    // -- 4. Idle hang: event loop alive, nothing will ever settle. --
    //    The "await-type" stall — a promise that never resolves.
    {
      const reports = join(dir, 'reports-idle');
      mkdirSync(reports, { recursive: true });
      const res = await runGuard(
        ['--log', join(dir, 'idle.log'), ...WINDOW, '--report-dir', reports, '--',
          process.execPath, '-e',
          "console.log('RUN alpha.test.ts'); console.log('RUN beta.test.ts'); " +
            'setTimeout(() => {}, 1e9);', dir],
        reportEnv(reports), { marker: dir },
      );
      const { code, out } = res;
      check('idle hang: the guard exits on its own', !res.timedOut,
        'the guard never exited — detection is broken');
      check('idle hang is declared a stall', code === STALL_EXIT_CODE, `exit ${code}`);
      check('the verdict quotes the last line seen',
        out.includes('last line    : RUN beta.test.ts'));
      check('idle hang is not rescued by the liveness probe (plain verdict, no deferral)',
        !out.includes('STALL-CAP') && !out.includes('deferring the kill'));
      if (linux) {
        check('idle hang is classified idle, not on-CPU',
          out.includes('idle -- waiting on something that never settles'));
        check('a live event loop answers SIGUSR2 with a report',
          /SIGUSR2 -> \d+ node process\(es\), [1-9]\d* responded/.test(out));
      }
    }

    // -- 5. Sync-spinning hang: event loop BLOCKED. --
    //    The inverse inference, and the subtlest claim the script makes: the
    //    ABSENCE of a diagnostic report is the diagnosis. If report-on-signal
    //    ever starts answering from off-loop, this is what notices.
    if (linux) {
      const spinDir = join(dir, 'reports-spin');
      mkdirSync(spinDir, { recursive: true });
      const res = await runGuard(
        ['--log', join(dir, 'spin.log'), ...WINDOW, '--report-dir', spinDir, '--',
          process.execPath, '-e',
          "console.log('RUN gamma.test.ts'); const t = Date.now(); let x = 0; " +
            'while (Date.now() - t < 600000) { x += Math.sqrt(x + 1); }', dir],
        reportEnv(spinDir), { marker: dir },
      );
      const { code, out } = res;
      check('sync-spinning hang: the guard exits on its own', !res.timedOut,
        'the guard never exited — detection is broken');
      check('sync-spinning hang is declared a stall', code === STALL_EXIT_CODE, `exit ${code}`);
      check('sync-spinning hang is classified ON-CPU',
        out.includes('ON-CPU -- sync-spinning or GC-thrashing'));
      check('a blocked event loop is diagnosed by its SILENCE',
        out.includes('NO report -- its event loop is BLOCKED'));
      // The inversion this card exists to design out. A spinning hang pegs a
      // core, so any probe that reads CPU as liveness stops firing here -- and
      // "never fires on spin hangs" is strictly worse than the defect it would
      // be fixing, because no green run can tell it apart from success.
      check('sync-spinning hang is NOT rescued by the probe — burning CPU is not liveness',
        !out.includes('STALL-CAP') && !out.includes('deferring the kill'));
      check('the verdict names the source-side probe as the reason it fired',
        out.includes('FROZEN at the source'));
    }

    // -- 6. A hang that never prints a first line. --
    //    The #4322 shape: a suite wedged during module load emits nothing at
    //    all, so there is no "last line" to anchor on and nothing for a human
    //    to notice. The clock must start at spawn, not at first output.
    {
      const res = await runGuard([
        '--log', join(dir, 'silent.log'), ...WINDOW, '--',
        process.execPath, '-e', 'setTimeout(() => {}, 1e9);', dir,
      ], {}, { marker: dir });
      const { code, out } = res;
      check('no-output hang: the guard exits on its own', !res.timedOut,
        'the guard never exited — detection is broken');
      check('a hang with no output at all is still caught', code === STALL_EXIT_CODE, `exit ${code}`);
      check('the no-output case says so instead of quoting a stale line',
        out.includes('last line    : (no output yet)'));
    }

    // -- 7. Teardown reaches a descendant that traps SIGTERM. --
    //    ObjectKernelConfig.gracefulShutdown installs exactly this handler in
    //    every kernel a test boots, so "dies on SIGTERM" cannot be assumed.
    //    Before the reap loop, the guard exited on the direct child's death and
    //    left such a descendant running.
    if (linux) {
      const pidFile = join(dir, 'descendant.pid');
      const script = join(dir, 'traps-sigterm.sh');
      writeFileSync(
        script,
        'echo "turbo: running 2 packages"\n' +
          `${process.execPath} -e '\n` +
          '  require("fs").writeFileSync(process.argv[1], String(process.pid));\n' +
          '  process.on("SIGTERM", () => {});\n' +
          '  setTimeout(() => {}, 1e9);\n' +
          `' "${pidFile}" &\nwait\n`,
      );
      const res = await runGuard([
        '--log', join(dir, 'group.log'), ...WINDOW, '--', 'sh', script,
      ], {}, { marker: dir });
      const { code, out } = res;
      check('SIGTERM-trapping descendant: the guard exits on its own', !res.timedOut,
        'the guard never exited — teardown is broken');
      check('stall with a SIGTERM-trapping descendant still exits 75',
        code === STALL_EXIT_CODE, `exit ${code}`);
      // "Dead" means gone OR a zombie: SIGKILL leaves the entry in /proc until
      // the (now reparented) process is reaped, and in a container PID 1 may be
      // slow to do it. A zombie runs no code and holds no handles — the thing
      // this asserts is that it is not still RUNNING. Poll briefly so the
      // verdict does not depend on reap latency.
      const pid = Number(readFileSync(pidFile, 'utf8').trim());
      let state = null;
      for (let i = 0; i < 20; i++) {
        try {
          const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
          state = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0];
        } catch {
          state = null; // reaped
        }
        if (state === null || state === 'Z') break;
        await sleep(100);
      }
      const alive = state !== null && state !== 'Z';
      check('the descendant does not outlive the guard', !alive,
        `pid ${pid} still running (state=${state}) after the guard exited`);
      check('the SIGKILL escalation is reported, not silent',
        out.includes('ignored SIGTERM'));
      if (alive) {
        try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
      }
    }
    // -- 8. HEALTHY silent-but-working: the shape the probe exists to protect. --
    //    The child writes real bytes the entire time, but none of them reach the
    //    guard -- which is what ANY buffering layer between the suite and this
    //    wrapper looks like from here (turbo's grouped log order was one
    //    spelling of it). Output flushes alone call this a stall and kill a
    //    healthy suite; the source-side probe is what tells them apart.
    if (linux) {
      const sink = join(dir, 'buffered-output.txt');
      const shape = [
        process.execPath, '-e',
        "const fs = require('fs'); const fd = fs.openSync(process.argv[1], 'a'); let n = 0;" +
          "const t = setInterval(() => { fs.writeSync(fd, 'work '.repeat(80) + '\\n');" +
          "if (++n > 45) { clearInterval(t); fs.closeSync(fd); console.log('suite passed'); } }, 100);",
        sink, dir,
      ];
      const saved = await runGuard(
        ['--log', join(dir, 'buffered.log'), ...WINDOW, '--stall-cap-minutes', '0.5', '--', ...shape],
        {}, { marker: dir },
      );
      check('a healthy silent-but-working run is NOT killed', saved.code === 0, `exit ${saved.code}`);
      check('...and is never called a stall', !saved.out.includes('STALL'));
      check('...and the deferral is announced, not silent',
        saved.out.includes('deferring the kill'), saved.out.trim().split('\n')[0]);

      // Positive control, and the reason case 8 is evidence rather than a
      // coincidence: the SAME child, probe off, must die. Without this a probe
      // that did nothing at all would score exactly like one that works.
      const killed = await runGuard(
        ['--log', join(dir, 'buffered-noprobe.log'), ...WINDOW, '--no-liveness-probe', '--', ...shape],
        {}, { marker: dir },
      );
      check('positive control: the same run IS killed with --no-liveness-probe',
        killed.code === STALL_EXIT_CODE, `exit ${killed.code}`);
      check('positive control: and the verdict says the probe was off',
        killed.out.includes('disabled (--no-liveness-probe)'));
    }

    // -- 9. A hang that WRITES while wedged is still killed -- at the cap. --
    //    The probe's own residual failure mode: a retry loop or a log spin looks
    //    alive to it forever. The cap is what keeps that from becoming "never
    //    fires", and the distinct verdict word is what keeps it diagnosable.
    if (linux) {
      const res = await runGuard(
        ['--log', join(dir, 'writing-hang.log'), ...WINDOW, '--stall-cap-minutes', '0.15', '--',
          process.execPath, '-e',
          "const fs = require('fs'); const fd = fs.openSync(process.argv[1], 'a');" +
            "console.log('RUN delta.test.ts');" +
            "setInterval(() => { fs.writeSync(fd, 'still retrying\\n'); }, 50);",
          join(dir, 'retry-loop.txt'), dir],
        {}, { marker: dir },
      );
      const { code, out } = res;
      check('a writing hang: the guard still exits on its own', !res.timedOut,
        'the guard never exited — the probe inverted the defect');
      check('a hang that keeps writing is still killed', code === STALL_EXIT_CODE, `exit ${code}`);
      check('...at the cap, under its own distinct STALL-CAP verdict',
        out.includes('STALL-CAP'), out.trim().split('\n').slice(-2).join(' | '));
      check('...having first announced the deferral it was granted',
        out.includes('deferring the kill'));
    }

    // -- 10. A cap that would silently disable the probe is refused. --
    {
      const bad = await runGuard(
        ['--log', join(dir, 'badcap.log'), ...WINDOW, '--stall-cap-minutes', '0.05', '--',
          process.execPath, '-e', "console.log('this child must never run');", dir],
        {}, { marker: dir },
      );
      check('a --stall-cap-minutes at or below --stall-minutes is refused',
        bad.code === 1 && bad.out.includes('must be GREATER than'), `exit ${bad.code}`);
      check('the cap refusal happens before anything spawns',
        !bad.out.includes('this child must never run'));
    }
  } finally {
    // Every synthetic child hangs by construction, so the sweep is not optional
    // housekeeping — without it a failed run leaves spinning processes on a
    // machine that other agents' suites share. Marker-scoped: only ours.
    const swept = killByMarker(dir);
    if (swept) results.push(`  · swept ${swept} leftover synthetic process(es)`);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  console.log('run-with-stall-guard --self-test');
  for (const line of results) console.log(line);
  if (!linux) {
    console.log('  (process-classification cases skipped: /proc not available)');
  }
  if (failures.length) {
    console.error(`\n✗ ${failures.length} self-test case(s) failed — the stall guard does not do what its callers assume.`);
    process.exit(1);
  }
  console.log(`\n✓ ${results.length} case(s) passed — the guard fires, classifies and tears down.`);
  process.exit(0);
}
