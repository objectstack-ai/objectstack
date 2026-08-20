// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Pins the CONCURRENT-RUN contract of `scripts/gen-sdui-manifest.sh` — the half
// that decides whether the manifest this script writes describes THIS tree.
//
// ## What was measured, and why the obvious fix is only half of one
//
// Agent dispatch containers run several agents against one filesystem and one
// network namespace. The script used to name a fixed port (5180) and a fixed log
// path, so two overlapping runs shared both. Measured against the pinned vite
// (8.2.1) with the requested port already held:
//
//     $ vite dev --port 5390
//     Port 5390 is in use, trying another one...
//       ➜  Local:   http://localhost:5391/
//
// vite AUTO-INCREMENTS. So run B's server came up on 5391 while run B's wait
// loop and BASE_URL still named 5390 — run B curled run A's server, got 200,
// and dumped A's manifest as its own with exit 0. The output is a real manifest
// and nothing in the run says which tree it describes, which is what makes it
// worse than no manifest: it feeds the ADR-0082 declaration-parity ratchet.
//
// `--strictPort` alone does NOT fix that, and this was measured too rather than
// reasoned: with it, run B's vite exits (`Error: Port 5390 is already in use`)
// into run B's OWN log, while run A keeps answering on the port. A probe that
// asks only "does the port answer?" still gets its 200 and still dumps A's tree.
// So the flag is necessary — it makes "the port we asked for" and "the port we
// got" the same port or no port — but the probe has to ALSO require that the
// server answering is the one this run spawned. Both halves, or neither works.
//
// ## Why these are executed assertions and not greps
//
// A grep for `--strictPort` passes against a file that only mentions the flag in
// a comment, and a grep for "liveness" passes against a check that runs in the
// wrong order. So the flag is asserted through `sdui_dev_server_cmd`, the
// function the script itself builds its argv from, and the refusal is asserted
// by standing up a real neighbouring server on the port and watching the real
// wait function turn it down.
//
// The vacuity guards matter as much as the assertions. `NEIGHBOUR_BODY` proves
// the neighbour was genuinely reachable at the same `http://localhost:<port>/`
// spelling the script probes, and `OUR_LEADER_ALIVE` proves our stand-in server
// was genuinely gone. Without those two lines a green "refused" could mean
// nothing was listening and nothing was checked — the phantom-assertion failure
// the cleanup test's header records paying for once already.
//
// ## The port helper had to become a RESERVATION, and that is measured here too
//
// "picked at run time by the script's own helper" was not enough, and the way
// it failed is worth keeping. The helper used to bind a probe socket, CLOSE it,
// and report the port free; the caller bound it afterwards. The scan is
// deterministic from the base upward, so concurrent callers did not diverge —
// they were handed the SAME port, every time, and the first one every time.
// Measured on this tree with the reservation removed, eight concurrent callers
// from base 5180:
//
//     DISTINCT_PORTS=1 of 8       # all eight got 5180
//     BIND_OK=2  BIND_ERR=6       # six lost the follow-up bind:
//                                 #   Error: listen EADDRINUSE 127.0.0.1:5180
//
// That is what dequeued a PR from the merge queue, and it presented HERE — this
// file draws from 5180 three times, and the write-target test beside it drives
// the real path for a fourth, concurrently, in one package's test run.
//
// The subtle half is how it presented. The occupier below lost its OWN bind to
// a concurrent scanner and died, so the following pick returned the occupied
// number quite legitimately — the port really was free by then — and the
// failure read as "the picker does not skip a busy port". It was not that. So
// BUSY_HELD is asserted before PICKED_WITH_BUSY is believed: a precondition
// that can evaporate silently is a test that accuses the wrong function.
//
// No vite and no console build: the contract under test is one the shell script
// owns, and the ports are picked at run time by the script's own helper so this
// test cannot collide with a concurrent agent — which would be a poor look here.

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

// Linux-only by construction, like the cleanup test beside it: the failure being
// pinned is an agent-container one, and the helpers read process sessions.
const RUNNABLE =
  process.platform === 'linux' && ['setsid', 'pgrep', 'curl', 'node'].every(have);

/** A tiny HTTP server on $SDUI_TEST_PORT, as a `node -e` program. */
const HTTP_STUB = [
  'const http = require("node:http");',
  'http.createServer((_q, r) => { r.writeHead(200); r.end("SERVER"); })',
  '  .listen(Number(process.env.SDUI_TEST_PORT), "127.0.0.1");',
].join('');

function runHarness(): Record<string, string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdui-collision-'));
  const harness = path.join(dir, 'harness.sh');

  fs.writeFileSync(
    harness,
    [
      '#!/usr/bin/env bash',
      // Not `set -e`: several steps below are expected to fail, and their exit
      // codes are the measurement.
      'set -uo pipefail',
      // Sourcing runs no generation — the script returns right after defining
      // its helpers, so this exercises the REAL functions.
      `source ${JSON.stringify(SCRIPT)}`,
      `DIR=${JSON.stringify(dir)}`,
      'NODE_BIN="$(command -v node)"',
      // "is $1 held right now?" — the same probe shape the script uses, so a
      // yes here and a skip there are answers to the same question.
      'port_held() {',
      '  "$NODE_BIN" -e \'const n=require("node:net");const s=n.createServer();s.once("error",()=>{console.log("yes");process.exit(0)});s.once("listening",()=>s.close(()=>{console.log("no");process.exit(0)}));s.listen(Number(process.argv[1]),"127.0.0.1")\' "$1"',
      '}',
      '',
      '# ── 1. the argv the script actually spawns ──────────────────────────',
      'readarray -t ARGV < <(sdui_dev_server_cmd 4321)',
      'printf "DEV_ARGV=%s\\n" "${ARGV[*]}"',
      '',
      '# ── 2. the free-port search skips a port that is taken right now ────',
      'BUSY="$(sdui_pick_free_port 5180)"',
      'export SDUI_TEST_PORT="$BUSY"',
      `"$NODE_BIN" -e 'require("node:net").createServer().listen(Number(process.env.SDUI_TEST_PORT), "127.0.0.1")' &`,
      'BUSY_PID=$!',
      // disown: otherwise bash prints its own "Killed" job notice when this is
      // reaped below, which reads like a test failure in the vitest output.
      'disown "$BUSY_PID" 2>/dev/null || true',
      'for _ in $(seq 1 40); do [ "$(port_held "$BUSY")" = yes ] && break; sleep 0.25; done',
      // Vacuity guard, and the one this file was missing when it ejected a PR:
      // if the occupier never took the port, the pick below returns it and the
      // green/red says nothing about the picker.
      'printf "BUSY_HELD=%s\\n" "$(port_held "$BUSY")"',
      'printf "BUSY_PORT=%s\\n" "$BUSY"',
      'printf "PICKED_WITH_BUSY=%s\\n" "$(sdui_pick_free_port "$BUSY")"',
      'kill -KILL "$BUSY_PID" 2>/dev/null',
      '',
      '# ── 3. a NEIGHBOUR answering on our port is refused, not accepted ───',
      'NPORT="$(sdui_pick_free_port 5180)"',
      'printf "NPORT=%s\\n" "$NPORT"',
      'export SDUI_TEST_PORT="$NPORT"',
      `"$NODE_BIN" -e ${JSON.stringify(HTTP_STUB)} &`,
      'NEIGHBOUR_PID=$!',
      'disown "$NEIGHBOUR_PID" 2>/dev/null || true',
      'for _ in $(seq 1 40); do curl -sf "http://localhost:$NPORT/" > /dev/null 2>&1 && break; sleep 0.25; done',
      // Vacuity guard: the neighbour must really be answering, at the exact
      // spelling the script probes, or "refused" below proves nothing.
      'printf "NEIGHBOUR_BODY=%s\\n" "$(curl -sf "http://localhost:$NPORT/" || echo NONE)"',
      // Stands in for `vite --strictPort` losing the race: our own server exits
      // immediately, leaving the neighbour holding the port.
      'PF="$DIR/lost.pid"',
      'sdui_spawn_detached "$PF" "$DIR/lost.log" "$NODE_BIN" -e "process.exit(1)"',
      'sleep 1',
      // Vacuity guard: ours must really be gone before the refusal means anything.
      'printf "OUR_LEADER_ALIVE=%s\\n" "$([ -n "$(sdui_live_pids "$(cat "$PF")")" ] && echo yes || echo no)"',
      'START=$SECONDS',
      'if sdui_wait_for_own_server "$PF" "$NPORT" 20; then',
      '  printf "ACCEPTED_NEIGHBOUR=yes\\n"',
      'else',
      '  printf "ACCEPTED_NEIGHBOUR=no\\n"',
      'fi',
      'printf "REFUSAL_SECONDS=%s\\n" "$((SECONDS - START))"',
      'kill -KILL "$NEIGHBOUR_PID" 2>/dev/null',
      '',
      '# ── 4. our OWN server is accepted (the check is not just "always no") ─',
      'OPORT="$(sdui_pick_free_port 5180)"',
      'printf "OPORT=%s\\n" "$OPORT"',
      'export SDUI_TEST_PORT="$OPORT"',
      'PF2="$DIR/own.pid"',
      `sdui_spawn_detached "$PF2" "$DIR/own.log" "$NODE_BIN" -e ${JSON.stringify(HTTP_STUB)}`,
      'if sdui_wait_for_own_server "$PF2" "$OPORT" 20; then',
      '  printf "ACCEPTED_OWN=yes\\n"',
      'else',
      '  printf "ACCEPTED_OWN=no\\n"',
      'fi',
      'sdui_stop_detached "$PF2"',
      '',
      '# ── 5. no fixed per-run state left in the file ──────────────────────',
      // A spelling pin, and labelled as one: the behaviour above is what the
      // suite really asserts. This exists so a fixed path cannot be reintroduced
      // quietly, since nothing else in the run would notice until two agents
      // overlapped again.
      `printf "FIXED_LOG_LITERALS=%s\\n" "$(grep -c '/tmp/sdui-dump-dev\\.log' ${JSON.stringify(SCRIPT)} || true)"`,
      '',
      '# ── 6. concurrent callers from ONE base get DISTINCT ports ──────────',
      // The card, as an executed assertion. Eight subshells, one base, at
      // once: before the reservation every one of them was handed the same
      // number — not sometimes, by construction. Eight makes a regression
      // certain to show rather than likely to.
      'mkdir -p "$DIR/picks"',
      'for i in $(seq 1 8); do ( sdui_pick_free_port 5180 > "$DIR/picks/$i" 2>/dev/null; echo >> "$DIR/picks/$i" ) & done',
      'wait',
      // grep -c . rather than wc -l: a pick that failed leaves an empty line,
      // and counting it would let TOTAL and DISTINCT agree at the wrong value.
      'printf "CONCURRENT_TOTAL=%s\\n" "$(cat "$DIR/picks"/* | grep -c .)"',
      'printf "CONCURRENT_DISTINCT=%s\\n" "$(cat "$DIR/picks"/* | sort -u | grep -c .)"',
      '',
      '# ── 7. a port held from OUTSIDE the registry is skipped, and the ────',
      '#      claim taken on it is handed back rather than hoarded ──────────',
      // The honest limit of a reservation: it binds only callers that share
      // the registry. Against everything else the probe is still the answer,
      // and losing there must not leak the claim — a hoarded claim would cost
      // a port on every future run in this container.
      'SPORT="$(sdui_pick_free_port 5180)"',
      'export SDUI_TEST_PORT="$SPORT"',
      `"$NODE_BIN" -e 'require("node:net").createServer().listen(Number(process.env.SDUI_TEST_PORT), "127.0.0.1")' &`,
      'STEAL_PID=$!',
      'disown "$STEAL_PID" 2>/dev/null || true',
      'for _ in $(seq 1 40); do [ "$(port_held "$SPORT")" = yes ] && break; sleep 0.25; done',
      'printf "STEAL_HELD=%s\\n" "$(port_held "$SPORT")"',
      // A registry of its own, so the listener above is genuinely foreign to
      // it — the shared registry already knows this port is ours.
      'RESV="$DIR/resv"',
      'STEAL_PICK="$( (export SDUI_PORT_RESERVATION_DIR="$RESV"; sdui_pick_free_port "$SPORT") )"',
      'printf "STEAL_PORT=%s\\n" "$SPORT"',
      'printf "STEAL_PICK=%s\\n" "$STEAL_PICK"',
      'printf "STEAL_CLAIM_RELEASED=%s\\n" "$([ -e "$RESV/$SPORT" ] && echo no || echo yes)"',
      'kill -KILL "$STEAL_PID" 2>/dev/null',
    ].join('\n'),
    { mode: 0o755 },
  );

  const out = execFileSync('bash', [harness], { encoding: 'utf8', timeout: 120_000 });
  const parsed: Record<string, string> = {};
  for (const line of out.split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) parsed[m[1]] = m[2];
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return parsed;
}

describe.skipIf(!RUNNABLE)('gen-sdui-manifest.sh concurrent-run contract', () => {
  const seen = RUNNABLE ? runHarness() : ({} as Record<string, string>);

  it('asks vite for a port it must actually get, or none at all', () => {
    // Read off the function the script builds its real argv from, so this cannot
    // pass against a file that merely mentions the flag.
    expect(seen.DEV_ARGV).toContain('--strictPort');
    expect(seen.DEV_ARGV).toContain('--port 4321');
  });

  it('picks a per-run port, skipping one that is already taken', () => {
    // Precondition before conclusion: the occupier must really hold the port.
    // Without this line an occupier that lost its own bind reads as a picker
    // that ignores busy ports, which is how this file accused the wrong
    // function while ejecting a PR from the merge queue.
    expect(seen.BUSY_HELD, JSON.stringify(seen)).toBe('yes');
    expect(seen.BUSY_PORT).toMatch(/^\d+$/);
    expect(seen.PICKED_WITH_BUSY).toMatch(/^\d+$/);
    expect(seen.PICKED_WITH_BUSY).not.toBe(seen.BUSY_PORT);
  });

  it("refuses a neighbouring run's server answering on this run's port", () => {
    // Both guards first: without them a green here can mean "nothing was
    // listening and nothing was checked".
    expect(seen.NEIGHBOUR_BODY).toBe('SERVER');
    expect(seen.OUR_LEADER_ALIVE).toBe('no');

    expect(seen.ACCEPTED_NEIGHBOUR).toBe('no');
    // And it says so at once rather than after the full 90s wait, because the
    // answer never depended on waiting longer.
    expect(Number(seen.REFUSAL_SECONDS)).toBeLessThan(10);
  });

  it('accepts the server this run started', () => {
    expect(seen.ACCEPTED_OWN).toBe('yes');
  });

  it('hands concurrent callers scanning one base distinct ports', () => {
    // Vacuity: all eight callers must have produced a port at all.
    expect(seen.CONCURRENT_TOTAL, JSON.stringify(seen)).toBe('8');
    expect(seen.CONCURRENT_DISTINCT, JSON.stringify(seen)).toBe('8');
  });

  it('gives each pick within one run its own port', () => {
    const picked = [seen.BUSY_PORT, seen.NPORT, seen.OPORT];
    expect(picked.every((p) => /^\d+$/.test(p ?? '')), picked.join(',')).toBe(true);
    expect(new Set(picked).size, picked.join(',')).toBe(3);
  });

  it('skips a port held from outside the registry and releases the claim', () => {
    expect(seen.STEAL_HELD, JSON.stringify(seen)).toBe('yes');
    expect(seen.STEAL_PICK).toMatch(/^\d+$/);
    expect(seen.STEAL_PICK).not.toBe(seen.STEAL_PORT);
    // The claim it took before probing must not survive a lost probe.
    expect(seen.STEAL_CLAIM_RELEASED, JSON.stringify(seen)).toBe('yes');
  });

  it('keeps no fixed dev-server log path (spelling pin)', () => {
    expect(seen.FIXED_LOG_LITERALS).toBe('0');
  });
});
