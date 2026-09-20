// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Pins the cleanup contract of `scripts/gen-sdui-manifest.sh`.
//
// WHY THIS IS WORTH AN EXECUTED TEST AND NOT A SOURCE-LEVEL ASSERTION.
//
// The defect this guards was a cleanup that REPORTED success and did nothing:
// the script armed `trap 'kill "$DUMP_DEV_PID"' EXIT`, the trap ran, the script
// printed its own tidy failure message — and the dev server was measured still
// alive 20 minutes later, holding the container's shared heavy-verify flock, so
// every later agent's build queued out at exit 99 with no signal at all. A
// grep-level test ("does the file mention setsid?") would have passed against
// the broken version too, because the broken version also mentioned `kill`. The
// only assertion that distinguishes them is running the trap path and looking
// at what is still breathing afterwards.
//
// The three properties below are each independently load-bearing; the incident
// needed only one of them to be false.
//
//   1. The server runs in its OWN session. Not cosmetic: a background job in a
//      non-interactive shell inherits the SCRIPT's process group, and under the
//      agent heavy-verify discipline that group is led by the wrapping `flock`
//      itself. So `kill -- -$PGID` on the inherited group would kill the
//      caller's lock holder and the script. `setsid` is what makes a group kill
//      bounded, and this asserts the boundary actually exists.
//
//   2. Nothing in that session holds a descriptor on the caller's lock file.
//      `flock(1)` holds its lock on an open fd and background children inherit
//      open fds, which is the single step that converts "a leaked dev server"
//      into "this container is closed for business". This half matters even
//      when the kill works, because it is what makes a MISSED kill survivable.
//
//      WHAT THIS COUNT MUST BE ORDERED AFTER, AND WHY THE PIDFILE IS NOT IT.
//      `sdui_spawn_detached` returns as soon as the pidfile is non-empty, and
//      its runner writes that pid on its FIRST line -- before the loop that
//      closes the inherited descriptors. Measured on this tree: the pid is
//      published 151-297us before the close completes, and the ONLY thing that
//      kept a pidfile-ordered reading green was the caller's unrelated 50ms
//      polling sleep (margin 10-54ms, from a 0.2ms critical section). So the
//      pidfile is a barrier for "the leader exists", never for "the leader has
//      let go of my descriptors", and a count ordered on it reads a state the
//      spawn legitimately passes through -- observed once in CI as LOCKFDS=1
//      with LEADER_ALIVE_AT_COUNT=yes and the leader still `bash`, reproduced
//      here by lagging the runner between those two steps. The barrier below is
//      the spawned command's OWN post-exec report instead: `exec` replaces the
//      runner that does the closing, so that line cannot exist until the close
//      has run. We wait for the REPORT, never for a value -- the stub prints
//      whatever it counts, so a real leak still arrives as a red.
//
//   3. After the trap, nothing from that session survives — specifically
//      including a process that has been reparented to init. That is the case
//      `kill "$!"` provably cannot reach, and the test asserts the orphan
//      really existed before cleanup (see ORPHAN_BEFORE below) so that a green
//      line here can never mean "nothing was ever spawned".
//
// The stub deliberately does not involve vite or pnpm: this pins the lifecycle
// the script owns, and a real console build is neither available nor relevant
// to whether the trap reaps what it started.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '..', '..', '..', 'scripts', 'gen-sdui-manifest.sh');

function have(bin: string): boolean {
  try {
    execFileSync('sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Linux-only by construction: the failure being pinned is an agent-container
// one, and the harness reads /proc to see which descriptors a child inherited.
const RUNNABLE = process.platform === 'linux' && ['setsid', 'flock', 'pgrep', 'fuser'].every(have);

describe.skipIf(!RUNNABLE)('gen-sdui-manifest.sh cleanup contract', () => {
  it('reaps the whole session it started, holds no caller fd, and leaves nothing behind', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdui-cleanup-'));
    const lock = path.join(dir, 'caller.lock');
    const harness = path.join(dir, 'harness.sh');
    const devlog = path.join(dir, 'dev.log');
    const release = path.join(dir, 'release');
    fs.writeFileSync(lock, '');

    // A stub server that reproduces the shape that defeats `kill "$!"`: it
    // spawns a helper and then exits, leaving the helper reparented to init
    // while still inside the session the script created.
    //
    // It also takes the in-child reading of property (2) and publishes the two
    // facts the harness needs to order itself: this code runs only after `exec`
    // replaced the shell that closes the inherited descriptors, so every line
    // it prints is causally after that close. It exits on a release file rather
    // than a wall-clock timer, so "was the leader alive when we counted?" stops
    // being a race against node's boot time; the 60s cap is a self-destruct for
    // the case where the harness dies without reaping, never a wait anyone
    // relies on.
    const stub = [
      'const fs = require("node:fs");',
      'const { spawn } = require("node:child_process");',
      'const LOCK = fs.realpathSync(process.argv[1]); const RELEASE = process.argv[2];',
      'const mine = fs.readdirSync("/proc/self/fd").filter((n) => {',
      '  try { return fs.readlinkSync("/proc/self/fd/" + n) === LOCK; } catch { return false; }',
      '}).length;',
      'const helper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1e9)"], { stdio: "ignore" });',
      'fs.writeSync(1, "CHILD_LOCKFDS=" + mine + "\\nHELPER=" + helper.pid + "\\nEXECED=1\\n");',
      'setInterval(() => { if (fs.existsSync(RELEASE)) process.exit(0); }, 25);',
      'setTimeout(() => process.exit(0), 60000);',
    ].join('');

    fs.writeFileSync(
      harness,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        // Sourcing runs no generation — the script returns right after defining
        // its lifecycle helpers, so this exercises the REAL functions.
        `source ${JSON.stringify(SCRIPT)}`,
        `DEVLOG=${JSON.stringify(devlog)}`,
        `RELEASE=${JSON.stringify(release)}`,
        `LOCK=${JSON.stringify(lock)}`,
        `LOCKBASE=${JSON.stringify(path.basename(lock))}`,
        'DUMP_PID_FILE="$(mktemp "${TMPDIR:-/tmp}/sdui-dump-pid.XXXXXX")"',
        `trap 'sdui_stop_detached "$DUMP_PID_FILE"' EXIT`,
        'sdui_spawn_detached "$DUMP_PID_FILE" "$DEVLOG" \\',
        `  "$(command -v node)" -e ${JSON.stringify(stub)} "$LOCK" "$RELEASE"`,
        'LEADER="$(cat "$DUMP_PID_FILE")"',
        'echo "LEADER=$LEADER"',
        'echo "LEADER_SID=$(ps -o sid= -p "$LEADER" | tr -d " ")"',
        'echo "SCRIPT_PGID=$(ps -o pgid= -p $$ | tr -d " ")"',
        // Barrier 1 — the spawned command's own post-exec report. NOT the
        // pidfile: see the note on property (2) in this file's header. This
        // waits for the reading to become TAKEABLE, never for it to become
        // zero.
        'CHILD_REPORTED=no',
        'for _i in $(seq 1 600); do',
        '  if grep -q "^EXECED=1$" "$DEVLOG" 2>/dev/null; then CHILD_REPORTED=yes; break; fi',
        '  sleep 0.05',
        'done',
        'echo "CHILD_REPORTED=$CHILD_REPORTED"',
        'CHILD_LOCKFDS="$(sed -n "s/^CHILD_LOCKFDS=//p" "$DEVLOG" 2>/dev/null || true)"',
        'HELPER="$(sed -n "s/^HELPER=//p" "$DEVLOG" 2>/dev/null || true)"',
        'echo "CHILD_LOCKFDS=$CHILD_LOCKFDS"',
        'echo "HELPER=$HELPER"',
        // Barrier 2 — the helper has joined the session, so the session-wide
        // count below covers both members instead of whoever happened to exist.
        'HELPER_IN_SESSION=no',
        'for _i in $(seq 1 200); do',
        '  MEMB="$(pgrep -s "$LEADER" 2>/dev/null | tr "\\n" " " || true)"',
        '  case " $MEMB " in *" $HELPER "*) HELPER_IN_SESSION=yes ;; esac',
        '  if [ "$HELPER_IN_SESSION" = yes ]; then break; fi',
        '  sleep 0.05',
        'done',
        'echo "HELPER_IN_SESSION=$HELPER_IN_SESSION"',
        // The session-wide count, now ordered after both barriers. Naming the
        // holders turns a future red from "1, expected 0" into a process.
        'FDS=0',
        'HOLDERS=""',
        'for p in $(pgrep -s "$LEADER"); do',
        '  n=$(ls -l "/proc/$p/fd" 2>/dev/null | grep -c "$LOCKBASE" || true)',
        '  if [ "$n" != 0 ]; then HOLDERS="$HOLDERS $p($(tr -d "\\0\\n" < "/proc/$p/comm" 2>/dev/null || echo unknown))"; fi',
        '  FDS=$((FDS + n))',
        'done',
        'echo "LOCKFDS=$FDS"',
        'echo "LOCKFD_HOLDERS=[$HOLDERS]"',
        `echo "LEADER_ALIVE_AT_COUNT=$(kill -0 "$LEADER" 2>/dev/null && echo yes || echo no)"`,
        // Now release the stub, so its helper is reparented to init before
        // cleanup, and wait for that to have HAPPENED rather than sleeping a
        // guessed interval. A timeout leaves ORPHAN_BEFORE empty, which the
        // precondition assertion reads as a red.
        ': > "$RELEASE"',
        'ORPHAN=""',
        'MEMBERS=""',
        'for _i in $(seq 1 400); do',
        '  MEMBERS="$(pgrep -s "$LEADER" 2>/dev/null | tr "\\n" " " || true)"',
        '  for p in $MEMBERS; do',
        '    if [ "$(ps -o ppid= -p "$p" 2>/dev/null | tr -d " ")" = "1" ]; then ORPHAN="$p"; fi',
        '  done',
        '  if [ -n "$ORPHAN" ]; then break; fi',
        '  sleep 0.05',
        'done',
        'echo "MEMBERS=$MEMBERS"',
        'echo "ORPHAN_BEFORE=$ORPHAN"',
        // Falling off the end fires the EXIT trap, which is the path under test.
      ].join('\n'),
      { mode: 0o755 },
    );

    const out = execFileSync(
      'flock',
      ['-w', '120', lock, '-c', `bash ${JSON.stringify(harness)}`],
      { encoding: 'utf8', timeout: 120_000 },
    );
    const field = (k: string): string => (out.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] ?? '').trim();

    const leader = field('LEADER');
    expect(leader, out).toMatch(/^\d+$/);

    // (1) its own session — so the group kill cannot reach the caller's flock.
    expect(field('LEADER_SID'), out).toBe(leader);
    expect(field('SCRIPT_PGID'), out).not.toBe(leader);

    // The barriers themselves: a timed-out barrier must arrive as a named red,
    // not as a count taken at some other moment.
    expect(field('CHILD_REPORTED'), out).toBe('yes');
    expect(field('HELPER_IN_SESSION'), out).toBe('yes');

    // (3, precondition) the orphan the naive `kill "$!"` cannot reach really
    // existed. Without this, the survivor assertion below could pass vacuously.
    expect(field('ORPHAN_BEFORE'), out).toMatch(/^\d+$/);

    // (2) nothing in the session inherited the caller's lock descriptor. Two
    // distinct facts: the surviving-capable process's reading of ITSELF, taken
    // after `exec` and therefore after the close; and the session-wide count,
    // taken while the leader was still alive and after both barriers.
    expect(field('CHILD_LOCKFDS'), out).toBe('0');
    expect(field('LEADER_ALIVE_AT_COUNT'), out).toBe('yes');
    expect(field('LOCKFDS'), out).toBe('0');

    // (3) the trap reaped the session, orphan included.
    let survivors = '';
    try {
      survivors = execFileSync('pgrep', ['-s', leader], { encoding: 'utf8' }).trim();
    } catch {
      survivors = ''; // pgrep exits 1 when nothing matches — the passing case.
    }
    expect(survivors, `processes survived cleanup:\n${survivors}`).toBe('');

    // and the caller's lock is free again.
    expect(() => execFileSync('flock', ['-w', '5', lock, '-c', 'true'])).not.toThrow();

    fs.rmSync(dir, { recursive: true, force: true });
  }, 120_000);
});
