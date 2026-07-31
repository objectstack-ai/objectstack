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
//   node scripts/run-with-stall-guard.mjs --log <file> [--stall-minutes N] -- <command...>
//
// It also owns the log tee: combined stdout+stderr is forwarded to this
// process's stdout AND appended to --log (which check-test-completeness.mjs
// reads afterwards). The old `cmd 2>&1 | tee $log` pattern needed
// `set -o pipefail` or tee's exit status would mask a red suite; here the
// child's real exit status is propagated by construction, so there is no pipe
// to guard. Do not reintroduce `| tee`.
//
// Exit status: the child's own code when it finishes; 75 on a declared stall;
// 1 when the child dies on a signal this guard did not send.

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';

const STALL_EXIT_CODE = 75; // EX_TEMPFAIL
const CHECK_INTERVAL_MS = 5_000;
const SIGKILL_GRACE_MS = 10_000;

const argv = process.argv.slice(2);
let logPath = '';
let stallMinutes = 10;
let command = [];

for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--log') logPath = argv[++i] ?? '';
  else if (argv[i] === '--stall-minutes') stallMinutes = Number(argv[++i]);
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
${'═'.repeat(72)}
`;
  process.stdout.write(banner);
  log.write(banner);
  killGroup('SIGTERM');
  setTimeout(() => killGroup('SIGKILL'), SIGKILL_GRACE_MS).unref();
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
