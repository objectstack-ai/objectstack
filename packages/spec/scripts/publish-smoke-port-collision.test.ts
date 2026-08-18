// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Pins the CONCURRENT-RUN contract of `scripts/publish-smoke.sh` — the half that
// decides whether the app this gate smoke-tests is the one this run built.
//
// ## What was measured
//
// Agent dispatch containers run several agents against one filesystem and one
// network namespace, so the script's fixed default port (3210) was shared state
// between overlapping runs. `objectstack dev` AUTO-SHIFTS off a busy port —
// `packages/cli/src/commands/serve.ts` gates that on `flags.dev`, and `dev`
// always spawns `serve --dev`. Measured with a neighbour holding 34217:
//
//     $ objectstack dev --port 34217 --fresh
//       ↪ server bound to port 34218 (requested 34217)
//     $ curl http://localhost:34217/api/v1/health   → 200, the NEIGHBOUR's body
//     $ curl http://localhost:34218/api/v1/health   → 200, ours
//
// So run B's app came up on the neighbour port while run B's wait loop and
// BASE_URL still named 34217: run B ran every auth and CRUD probe against run
// A's app.
//
// ## Why the sibling fix does not transfer, which is what this test exists for
//
// `scripts/gen-sdui-manifest.sh` (the same defect, one file over) shipped
// `--strictPort` plus a probe requiring the session that run spawned to be
// alive. Neither half transfers:
//
//   * There is no `--strictPort` here. `dev` always passes `--dev` to `serve`,
//     so the auto-shift cannot be declined by a caller, and giving the CLI a
//     flag to decline it is a CLI contract change, not a fix to this script.
//   * A liveness check on our own spawn was ALREADY in this wait loop, and it
//     passes throughout the measurement above — our server did not die, it
//     succeeded on another port. Liveness is not the question here.
//
// What the script does instead is read the port its own server actually bound,
// from the runtime state file `serve.ts` publishes under OS_HOME expressly for
// external supervisors, in an OS_HOME this run can prove is its own because it
// pinned the dev child's TMPDIR. That is the contract pinned below.
//
// ## Why these are executed assertions and not greps
//
// A grep for `TMPDIR` passes against a file that names it only in a comment, and
// a grep for "reads the runtime file" passes against a check that runs in the
// wrong order. So the argv is asserted through `smoke_dev_server_argv`, the
// function the script itself builds its argv from, and the retarget is asserted
// by standing up a real neighbour on the requested port and watching the real
// wait function decline it in favour of the port its own state file names.
//
// The vacuity guards matter as much as the assertions. `NEIGHBOUR_BODY` proves
// the neighbour was genuinely reachable at the same spelling the old wait loop
// probed, and `OURS_BODY` proves the retargeted port was genuinely a different
// server. Without those a green "retargeted" could mean nothing was listening
// and nothing was turned down.
//
// No `objectstack dev` boot and no scaffold: the contract under test belongs to
// the shell script, and the ports are picked at run time by the script's own
// helper so this test cannot collide with a concurrent agent — which would be a
// poor look here.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '..', '..', '..', 'scripts', 'publish-smoke.sh');

function have(bin: string): boolean {
  try {
    execFileSync('sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Linux-only by construction, like the sibling collision test: the failure being
// pinned is an agent-container one, and the helpers read `/proc`-backed liveness.
const RUNNABLE = process.platform === 'linux' && ['bash', 'curl', 'jq', 'node'].every(have);

/** A tiny HTTP server on $STUB_PORT announcing $STUB_NAME, as a `node -e` program. */
const HTTP_STUB = [
  'const http = require("node:http");',
  'http.createServer((_q, r) => {',
  '  r.writeHead(200, { "content-type": "application/json" });',
  '  r.end(JSON.stringify({ iam: process.env.STUB_NAME }));',
  '}).listen(Number(process.env.STUB_PORT));',
].join('');

/**
 * Run a bash harness that SOURCES the real script (so the real functions run)
 * and prints `KEY=value` lines. Returns them parsed.
 */
function runHarness(body: string[]): Record<string, string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-smoke-collision-'));
  const harness = path.join(dir, 'harness.sh');
  fs.writeFileSync(
    harness,
    [
      '#!/usr/bin/env bash',
      'set -u',
      `export SMOKE_ROOT=${JSON.stringify(dir)}`,
      'export SMOKE_KEEP=1',
      `export STUB=${JSON.stringify(HTTP_STUB)}`,
      // Sourcing defines the helpers and runs nothing.
      `source ${JSON.stringify(SCRIPT)}`,
      // The script's own `set -euo pipefail` came with it. Several steps below
      // are EXPECTED to fail and their exit codes are the thing being reported,
      // so hand errexit back — without this the harness dies at the first
      // expected failure, before it can kill its stubs, and the run hangs on a
      // stdout pipe held open by an orphan rather than failing an assertion.
      'set +e +o pipefail',
      // Belt and braces on top of that: every stub below is a listener, and a
      // leaked one holds a low port in a container several agents share — the
      // very collision this file is about. `jobs -p` on EXIT kills them however
      // the harness leaves, including paths no explicit `kill` line reaches.
      'trap \'for j in $(jobs -p); do kill "$j" 2>/dev/null; done\' EXIT',
      'echo "SOURCED=ok"',
      ...body,
    ].join('\n'),
    { mode: 0o755 },
  );

  const out = execFileSync('bash', [harness], { encoding: 'utf8', timeout: 120_000 });
  const parsed: Record<string, string> = {};
  for (const line of out.split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (m) parsed[m[1]] = m[2];
  }
  return parsed;
}

describe.skipIf(!RUNNABLE)('[#9647] publish-smoke.sh smoke-tests its OWN dev server', () => {
  it('sources cleanly and defines the collision helpers without running the gate', () => {
    const r = runHarness([
      'echo "PICK_FN=$(type -t smoke_pick_free_port)"',
      'echo "WAIT_FN=$(type -t smoke_wait_for_own_server)"',
      'echo "ARGV_FN=$(type -t smoke_dev_server_argv)"',
      // The gate itself must NOT have run: no scaffold, no tarballs.
      'echo "SCAFFOLDED=$([ -d "$SMOKE_ROOT/smoke-app" ] && echo yes || echo no)"',
    ]);
    expect(r.SOURCED).toBe('ok');
    expect(r.PICK_FN).toBe('function');
    expect(r.WAIT_FN).toBe('function');
    expect(r.ARGV_FN).toBe('function');
    expect(r.SCAFFOLDED).toBe('no');
  });

  it('picks a per-run port and skips one that is already held', () => {
    const r = runHarness([
      'FIRST="$(smoke_pick_free_port 3210)"',
      'echo "FIRST=$FIRST"',
      // Hold it, then ask again from the same base.
      'STUB_PORT="$FIRST" STUB_NAME=holder node -e "$STUB" >/dev/null 2>&1 & HOLDER=$!',
      'sleep 1',
      'SECOND="$(smoke_pick_free_port 3210)"',
      'echo "SECOND=$SECOND"',
      'echo "HOLDER_REACHABLE=$(curl -sS "http://localhost:$FIRST/" | jq -r .iam)"',
      'kill "$HOLDER" 2>/dev/null',
    ]);
    expect(r.FIRST).toMatch(/^\d+$/);
    expect(r.SECOND).toMatch(/^\d+$/);
    // Vacuity guard: the port really was held, so the skip really was a skip.
    expect(r.HOLDER_REACHABLE).toBe('holder');
    expect(r.SECOND).not.toBe(r.FIRST);
  });

  it('pins the dev child TMPDIR in the argv it actually spawns', () => {
    const r = runHarness([
      'DEV_TMPDIR="$SMOKE_ROOT/dev-tmp"',
      'SMOKE_PORT=31234',
      'echo "ARGV=$(smoke_dev_server_argv | tr "\\n" " ")"',
    ]);
    // `env` and the assignment are part of the invocation, not a comment about it.
    expect(r.ARGV).toContain('env NO_COLOR=1 ');
    expect(r.ARGV).toContain('TMPDIR=');
    expect(r.ARGV).toContain('dev-tmp');
    expect(r.ARGV).toContain('objectstack dev --port 31234 --fresh');
  });

  it("declines a neighbour on the requested port and targets the port its OWN state file names", () => {
    const r = runHarness([
      'DEV_TMPDIR="$SMOKE_ROOT/dev-tmp"',
      'mkdir -p "$DEV_TMPDIR/objectstack-dev-XXXX"',
      'REQUESTED="$(smoke_pick_free_port 3210)"',
      'OURS="$(smoke_pick_free_port $((REQUESTED + 50)))"',
      'echo "REQUESTED=$REQUESTED"',
      'echo "OURS=$OURS"',
      // Run A: the neighbour, answering 200 on the port run B asked for. This is
      // exactly what the pre-fix wait loop accepted.
      'STUB_PORT="$REQUESTED" STUB_NAME=NEIGHBOUR node -e "$STUB" >/dev/null 2>&1 & NEIGHBOUR=$!',
      // Run B: our own server, on the port the auto-shift moved us to, plus the
      // runtime state file `serve.ts` writes under our pinned OS_HOME.
      'STUB_PORT="$OURS" STUB_NAME=OURS node -e "$STUB" >/dev/null 2>&1 & SERVER_PID=$!',
      'sleep 1',
      'printf \'{"pid":%s,"port":%s,"url":"http://localhost:%s","environmentId":"env_local"}\' \\',
      '  "$SERVER_PID" "$OURS" "$OURS" > "$DEV_TMPDIR/objectstack-dev-XXXX/runtime.env_local.json"',
      // Vacuity guards: both servers genuinely reachable, at the spelling probed.
      'echo "NEIGHBOUR_BODY=$(curl -sS "http://localhost:$REQUESTED/api/v1/health" | jq -r .iam)"',
      'echo "OURS_BODY=$(curl -sS "http://localhost:$OURS/api/v1/health" | jq -r .iam)"',
      'smoke_wait_for_own_server 10',
      'echo "BOUND_PORT=$BOUND_PORT"',
      'kill "$NEIGHBOUR" "$SERVER_PID" 2>/dev/null',
    ]);
    // Both were up, so the choice below was a real choice.
    expect(r.NEIGHBOUR_BODY).toBe('NEIGHBOUR');
    expect(r.OURS_BODY).toBe('OURS');
    expect(r.REQUESTED).not.toBe(r.OURS);
    // The whole card: the requested port answered 200 and was turned down anyway.
    expect(r.BOUND_PORT).toBe(r.OURS);
    expect(r.BOUND_PORT).not.toBe(r.REQUESTED);
  });

  it('refuses rather than guessing when no runtime state file is published', () => {
    const r = runHarness([
      'DEV_TMPDIR="$SMOKE_ROOT/dev-tmp"',
      'mkdir -p "$DEV_TMPDIR"',
      'REQUESTED="$(smoke_pick_free_port 3210)"',
      // A neighbour answering on the requested port, and a live process of our
      // own that never published where it bound.
      'STUB_PORT="$REQUESTED" STUB_NAME=NEIGHBOUR node -e "$STUB" >/dev/null 2>&1 & NEIGHBOUR=$!',
      'sleep 30 >/dev/null 2>&1 & SERVER_PID=$!',
      'sleep 1',
      'echo "NEIGHBOUR_BODY=$(curl -sS "http://localhost:$REQUESTED/api/v1/health" | jq -r .iam)"',
      'echo "OUR_LEADER_ALIVE=$(kill -0 "$SERVER_PID" 2>/dev/null && echo yes || echo no)"',
      'OUT="$(smoke_wait_for_own_server 1 2>&1)"; echo "WAIT_RC=$?"',
      'echo "WAIT_SAID_STATE_FILE=$(printf %s "$OUT" | grep -c "runtime state file")"',
      'kill "$NEIGHBOUR" "$SERVER_PID" 2>/dev/null',
    ]);
    // Vacuity guards: a 200 WAS available on the requested port, and our own
    // process WAS alive — the two facts the pre-fix loop accepted as sufficient.
    expect(r.NEIGHBOUR_BODY).toBe('NEIGHBOUR');
    expect(r.OUR_LEADER_ALIVE).toBe('yes');
    expect(r.WAIT_RC).not.toBe('0');
    expect(r.WAIT_SAID_STATE_FILE).toBe('1');
  });
});
