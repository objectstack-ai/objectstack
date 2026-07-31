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
// Exit status: the child's own code when it finishes; 75 on a declared stall;
// 1 when the child dies on a signal this guard did not send.

import { spawn } from 'node:child_process';
import { createWriteStream, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const STALL_EXIT_CODE = 75; // EX_TEMPFAIL
const CHECK_INTERVAL_MS = 5_000;
const SIGKILL_GRACE_MS = 10_000;

const argv = process.argv.slice(2);
let logPath = '';
let stallMinutes = 10;
let reportDir = '';
let command = [];

for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--log') logPath = argv[++i] ?? '';
  else if (argv[i] === '--stall-minutes') stallMinutes = Number(argv[++i]);
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
    'run-with-stall-guard: usage: run-with-stall-guard.mjs --log <file> [--stall-minutes N] -- <command...>',
  );
  process.exit(1);
}

const stallMs = stallMinutes * 60_000;
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const watchdog = setInterval(() => {
  const silentMs = Date.now() - lastOutputAt;
  if (silentMs < stallMs) return;

  stalled = true;
  clearInterval(watchdog);
  const banner = `
${'═'.repeat(72)}
⛔ STALL: no test output for ${(silentMs / 60_000).toFixed(1)} minutes (limit: ${stallMinutes}m).

   frozen since : ${new Date(lastOutputAt).toISOString()}
   last line    : ${lastLine}

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
  void collectForensics().then((forensics) => {
    if (forensics) {
      process.stdout.write(forensics);
      log.write(forensics);
    }
    killGroup('SIGTERM');
    setTimeout(() => killGroup('SIGKILL'), SIGKILL_GRACE_MS).unref();
  });
}, CHECK_INTERVAL_MS);

child.on('error', (err) => {
  clearInterval(watchdog);
  console.error(`run-with-stall-guard: failed to start ${command[0]} -- ${err.message}`);
  log.end(() => process.exit(1));
});

child.on('exit', (code, signal) => {
  clearInterval(watchdog);
  const finish = (status) => log.end(() => process.exit(status));
  if (stalled) {
    finish(STALL_EXIT_CODE);
  } else if (signal) {
    console.error(`run-with-stall-guard: command killed by ${signal}`);
    finish(1);
  } else {
    finish(code ?? 1);
  }
});
