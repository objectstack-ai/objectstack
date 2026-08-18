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
    fs.writeFileSync(lock, '');

    // A stub server that reproduces the shape that defeats `kill "$!"`: it
    // spawns a helper and then exits, leaving the helper reparented to init
    // while still inside the session the script created.
    const stub = [
      'const { spawn } = require("node:child_process");',
      'spawn(process.execPath, ["-e", "setInterval(() => {}, 1e9)"], { stdio: "ignore" });',
      'setTimeout(() => process.exit(0), 300);',
    ].join('');

    fs.writeFileSync(
      harness,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        // Sourcing runs no generation — the script returns right after defining
        // its lifecycle helpers, so this exercises the REAL functions.
        `source ${JSON.stringify(SCRIPT)}`,
        'DUMP_PID_FILE="$(mktemp "${TMPDIR:-/tmp}/sdui-dump-pid.XXXXXX")"',
        `trap 'sdui_stop_detached "$DUMP_PID_FILE"' EXIT`,
        `sdui_spawn_detached "$DUMP_PID_FILE" ${JSON.stringify(path.join(dir, 'dev.log'))} \\`,
        `  "$(command -v node)" -e ${JSON.stringify(stub)}`,
        'LEADER="$(cat "$DUMP_PID_FILE")"',
        'echo "LEADER=$LEADER"',
        'echo "LEADER_SID=$(ps -o sid= -p "$LEADER" | tr -d " ")"',
        'echo "SCRIPT_PGID=$(ps -o pgid= -p $$ | tr -d " ")"',
        // Let the stub exit so its helper is reparented to init before cleanup.
        'sleep 2',
        'MEMBERS="$(pgrep -s "$LEADER" | tr "\\n" " ")"',
        'echo "MEMBERS=$MEMBERS"',
        'ORPHAN=""',
        'for p in $MEMBERS; do [ "$(ps -o ppid= -p "$p" | tr -d " ")" = "1" ] && ORPHAN="$p"; done',
        'echo "ORPHAN_BEFORE=$ORPHAN"',
        'FDS=0',
        'for p in $MEMBERS; do',
        `  n=$(ls -l "/proc/$p/fd" 2>/dev/null | grep -c ${JSON.stringify(path.basename(lock))} || true)`,
        '  FDS=$((FDS + n))',
        'done',
        'echo "LOCKFDS=$FDS"',
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

    // (3, precondition) the orphan the naive `kill "$!"` cannot reach really
    // existed. Without this, the survivor assertion below could pass vacuously.
    expect(field('ORPHAN_BEFORE'), out).toMatch(/^\d+$/);

    // (2) nothing in the session inherited the caller's lock descriptor.
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
