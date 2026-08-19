// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Pins the CONCURRENT-RUN contract of the three boot-and-probe blocks in
// `.github/workflows/scaffold-e2e.yml` — the half that decides whether the app
// this workflow reports on is the app the job actually booted.
//
// ## What was measured, and why NEITHER sibling fix transfers
//
// Three files were found with the same shape within a day of each other, and
// all three have DIFFERENT failure modes. Copying a fix between them produces a
// green check that proves nothing, so each was re-derived from a measurement:
//
//   * `scripts/gen-sdui-manifest.sh` — vite AUTO-INCREMENTS off a busy port, so
//     the fix is `--strictPort` plus a probe requiring the session that run
//     spawned. "My server came up somewhere else."
//   * `scripts/publish-smoke.sh` — `objectstack dev` AUTO-SHIFTS, a liveness
//     check was already present and stayed green throughout, and only reading
//     the port the server really bound fixes it. "Liveness is not the question."
//   * this workflow — `os start` does NEITHER. Measured on this checkout:
//
//         $ os start --port 38200          # a neighbour already on 38200
//           ✗ Port 38200 is already in use.
//           ObjectStack does not auto-select a different port in production mode
//         $ echo $?
//         1
//         $ os start --port 38500          # nothing on 38500
//           ✓ Server is ready → http://localhost:38500/    (stays up, real 200s)
//
//     `packages/cli/src/commands/serve.ts` gates the shift on `flags.dev ||
//     NODE_ENV === 'development'`, and `start.ts` spawns `serve` with neither
//     (it forces NODE_ENV=production when the caller has not set it). So the
//     step's own server binds 8080 or it DIES — there is no shifted port to read
//     back, and no `--strictPort` to ask for, because the CLI already behaves as
//     though it had one.
//
// Which leaves the wait loop as the entire defect, and it is worse than the
// refusal suggests. The neighbour keeps answering 8080. Measured with the
// pre-fix block verbatim, a neighbour up first:
//
//     LOOP_OK=1  LOOP_ITERATIONS=1  LOOP_SECONDS=0
//     READY_ANSWERED_BY=NEIGHBOUR-RUN-A
//     OUR_PID_ALIVE=yes   KILL_RC=0
//
// The loop took its 200 on the first probe, asserted `/api/v1/ready` against the
// NEIGHBOUR's app, and killed a pid that was still booting. Exit 0, on an app
// the job never started.
//
// That measurement is also what rules OUT the obvious fix. A `SERVER_PID`
// liveness check — the thing the card was filed about — does not catch this on
// its own: through the entire window that decides the run, our own process is
// genuinely alive. The one question that separates the two worlds is whether
// something was ALREADY answering the exact URL the loop accepts as proof.
// Hence two guards, in this order, and neither alone is sufficient.
//
// ## Why these are executed assertions and not greps
//
// The blocks are shell, so they are RUN. Each case extracts the real `run:`
// script out of the workflow file and executes it under `bash -e` — GitHub's
// default shell for `run:` on Linux — with `npx` and `docker` replaced by stubs
// that encode the CLI behaviour measured above. A grep for `kill -0` passes
// against a check placed after the loop's `break`; a grep for the pre-flight
// passes against a version that mentions it in a comment.
//
// The vacuity guards carry as much weight as the assertions. `NEIGHBOUR_BODY`
// proves the neighbour was genuinely reachable at the exact spelling the loop
// probes, and the "accepts its own server" case proves the guard is not simply
// "always no" — without both, a green "refused" could mean nothing was
// listening and nothing was checked.
//
// One substitution is NOT a stub: the port literal is rewritten to a per-run
// free port before the script runs, so this test cannot collide with a
// concurrent agent in the same container — which would be a poor look in this
// file of all files. The literal is deliberately not the contract (see the
// workflow comment: every `runs-on:` in this repo is `ubuntu-latest`, one VM per
// job, so the fixed ports stay); the contract is what the loop accepts and
// refuses, and that is port-independent.
//
// Deliberately NOT asserted: that `docker run` refuses a duplicate `--name` and
// a taken `-p` host port. That claim is docker's documented behaviour and it is
// what makes the docker leg free of any wrong-answer mode — but the container
// this was written in ships the docker CLI with no daemon, so it could not be
// measured, and asserting it against our own `docker` stub would only assert the
// stub. The docker cases below pin the one thing that leg really was missing:
// the loop never asked whether its own container was still running.

import { describe, it, expect } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'scaffold-e2e.yml');

function have(bin: string): boolean {
  try {
    execFileSync('sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Linux-only by construction, like the two sibling collision suites: the failure
// being pinned is a shared-namespace one and the guards read process liveness.
const RUNNABLE =
  process.platform === 'linux' && ['bash', 'curl', 'openssl', 'node'].every(have);

/**
 * The literal `run:` script of a named step, dedented — the text GitHub hands
 * `bash`. Hand-parsed rather than via a YAML library so this test adds no
 * dependency to a package that ships to npm, and so a malformed workflow fails
 * here loudly instead of being normalised away.
 */
function stepScript(stepName: string): string {
  const lines = fs.readFileSync(WORKFLOW, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.trim() === `- name: ${stepName}`);
  if (start < 0) throw new Error(`no step named ${JSON.stringify(stepName)} in ${WORKFLOW}`);
  let i = start + 1;
  for (; i < lines.length; i += 1) {
    if (lines[i].trim() === 'run: |') break;
    if (lines[i].trim().startsWith('- name:')) {
      throw new Error(`step ${JSON.stringify(stepName)} has no 'run: |' block`);
    }
  }
  if (i >= lines.length) throw new Error(`step ${JSON.stringify(stepName)} has no 'run: |' block`);
  const bodyIndent = lines[i].length - lines[i].trimStart().length + 2;
  const body: string[] = [];
  for (i += 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') {
      body.push('');
      continue;
    }
    if (line.length - line.trimStart().length < bodyIndent) break;
    body.push(line.slice(bodyIndent));
  }
  while (body.length > 0 && body[body.length - 1] === '') body.pop();
  if (body.length === 0) throw new Error(`step ${JSON.stringify(stepName)} has an empty run block`);
  return `${body.join('\n')}\n`;
}

/** A TCP port free right now, searching upward from `base`. Advisory only. */
async function pickFreePort(base: number): Promise<number> {
  const isFree = (port: number) =>
    new Promise<boolean>((resolve) => {
      const probe = net.createServer();
      probe.once('error', () => resolve(false));
      probe.once('listening', () => probe.close(() => resolve(true)));
      probe.listen(port);
    });
  for (let port = base; port < base + 400; port += 1) {
    if (await isFree(port)) return port;
  }
  throw new Error(`no free TCP port in [${base}, ${base + 400})`);
}

/**
 * Stands in for `os start --port N` with the semantics MEASURED above: a busy
 * port is REFUSED (never shifted), and the refusal arrives after a boot delay,
 * because that delay is what let the pre-fix loop accept a neighbour while our
 * own process was still alive and undecided.
 */
const OS_START_STUB = `
const http = require('node:http');
const port = Number(process.argv[2]);
setTimeout(() => {
  if (process.env.OS_STUB_DIE_ON_BOOT === '1') {
    console.log('  boot failed: artifact could not be read');
    process.exit(1);
  }
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ iam: 'OURS', url: req.url }));
  });
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log('  Port ' + port + ' is already in use.');
      console.log('     ObjectStack does not auto-select a different port in production mode');
      process.exit(1);
    }
    throw err;
  });
  server.listen(port);
}, Number(process.env.OS_STUB_BOOT_MS || '1200'));
`;

const NPX_STUB = `#!/usr/bin/env bash
set -u
[ "\${1:-}" = os ] || { echo "stub npx: unexpected argv: $*" >&2; exit 127; }
shift
[ "\${1:-}" = start ] || { echo "stub os: unexpected argv: $*" >&2; exit 127; }
shift
PORT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="\${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done
[ -n "$PORT" ] || { echo "stub os start: no --port in argv" >&2; exit 127; }
exec "$STUB_NODE" "$STUB_DIR/os-start.js" "$PORT"
`;

/**
 * The container process a stubbed `docker run` starts.
 *
 * `STUB_CONTAINER_DIE_MS` models the app crashing DURING boot — the container
 * started, so `docker run` succeeded and the host port is genuinely ours, it
 * simply never became healthy. That ordering is the point: a container that
 * dies after already answering is not a case the loop can get wrong, because
 * the loop has already broken out of it.
 */
const CONTAINER_STUB = `
const http = require('node:http');
const dieMs = Number(process.env.STUB_CONTAINER_DIE_MS || '0');
if (dieMs > 0) {
  setTimeout(() => { console.log('container crashed on purpose'); process.exit(1); }, dieMs);
} else {
  http
    .createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ iam: 'OUR-CONTAINER', url: req.url }));
    })
    .listen(Number(process.argv[2]));
}
`;

const DOCKER_STUB = `
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const cp = require('node:child_process');
const argv = process.argv.slice(2);
const STATE = process.env.STUB_STATE;
const at = (name) => path.join(STATE, 'container-' + name + '.json');
const logAt = (name) => path.join(STATE, 'container-' + name + '.log');
const cmd = argv[0];
if (cmd === 'build') process.exit(0);
if (cmd === 'run') {
  let name = '';
  let hostPort = '';
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === '--name') name = argv[i + 1];
    else if (argv[i] === '-p') hostPort = String(argv[i + 1]).split(':')[0];
  }
  if (fs.existsSync(at(name))) {
    process.stderr.write('docker: Conflict. The container name "/' + name + '" is already in use.\\n');
    process.exit(125);
  }
  const probe = net.createServer();
  probe.once('error', () => {
    process.stderr.write('docker: Bind for 0.0.0.0:' + hostPort + ' failed: port is already allocated.\\n');
    process.exit(125);
  });
  probe.once('listening', () => probe.close(() => {
    const out = fs.openSync(logAt(name), 'a');
    const child = cp.spawn(process.execPath, [path.join(__dirname, 'container.js'), hostPort], {
      detached: true,
      stdio: ['ignore', out, out],
      env: process.env,
    });
    child.unref();
    fs.writeFileSync(at(name), JSON.stringify({ pid: child.pid, hostPort }));
    process.stdout.write(String(child.pid) + '\\n');
    process.exit(0);
  }));
  probe.listen(Number(hostPort));
} else if (cmd === 'inspect') {
  let st;
  try { st = JSON.parse(fs.readFileSync(at(argv[argv.length - 1]), 'utf8')); } catch { process.exit(1); }
  let alive = true;
  try { process.kill(st.pid, 0); } catch { alive = false; }
  process.stdout.write((alive ? 'true' : 'false') + '\\n');
} else if (cmd === 'logs') {
  try { process.stdout.write(fs.readFileSync(logAt(argv[argv.length - 1]), 'utf8')); } catch { /* none */ }
} else if (cmd === 'rm') {
  const name = argv[argv.length - 1];
  try { process.kill(JSON.parse(fs.readFileSync(at(name), 'utf8')).pid, 'SIGKILL'); } catch { /* gone */ }
  try { fs.rmSync(at(name)); } catch { /* gone */ }
} else {
  process.stderr.write('stub docker: unhandled argv: ' + argv.join(' ') + '\\n');
  process.exit(127);
}
`;

interface Harness {
  dir: string;
  runnerTemp: string;
  env: NodeJS.ProcessEnv;
}

function harness(extraEnv: NodeJS.ProcessEnv = {}): Harness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-e2e-probe-'));
  const stubDir = path.join(dir, 'bin');
  const state = path.join(dir, 'state');
  const runnerTemp = path.join(dir, 'runner-temp');
  fs.mkdirSync(stubDir);
  fs.mkdirSync(state);
  // Both app dirs the three blocks `cd` into.
  fs.mkdirSync(path.join(runnerTemp, 'e2e-app'), { recursive: true });
  fs.mkdirSync(path.join(runnerTemp, 'canary-app'), { recursive: true });
  fs.writeFileSync(path.join(stubDir, 'os-start.js'), OS_START_STUB);
  fs.writeFileSync(path.join(stubDir, 'container.js'), CONTAINER_STUB);
  fs.writeFileSync(path.join(stubDir, 'docker.js'), DOCKER_STUB);
  fs.writeFileSync(path.join(stubDir, 'npx'), NPX_STUB, { mode: 0o755 });
  fs.writeFileSync(
    path.join(stubDir, 'docker'),
    `#!/usr/bin/env bash\nexec "$STUB_NODE" "$STUB_DIR/docker.js" "$@"\n`,
    { mode: 0o755 },
  );
  return {
    dir,
    runnerTemp,
    env: {
      ...process.env,
      PATH: `${stubDir}${path.delimiter}${process.env.PATH ?? ''}`,
      STUB_DIR: stubDir,
      STUB_NODE: process.execPath,
      STUB_STATE: state,
      RUNNER_TEMP: runnerTemp,
      ...extraEnv,
    },
  };
}

interface Ran {
  status: number;
  out: string;
  seconds: number;
}

/** Execute a step's script the way GitHub does: `bash -e <file>`. */
function runBlock(h: Harness, script: string): Ran {
  const file = path.join(h.dir, 'step.sh');
  fs.writeFileSync(file, script);
  const started = Date.now();
  try {
    const out = execFileSync('bash', ['-e', file], {
      env: h.env,
      cwd: h.dir,
      encoding: 'utf8',
      timeout: 240_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, out, seconds: (Date.now() - started) / 1000 };
  } catch (err: any) {
    return {
      status: typeof err.status === 'number' ? err.status : -1,
      out: `${err.stdout ?? ''}${err.stderr ?? ''}`,
      seconds: (Date.now() - started) / 1000,
    };
  }
}

/**
 * A neighbouring run's healthy server, answering everything with 200.
 *
 * A CHILD PROCESS, not an in-process `http.createServer`, and that is not a
 * style choice: `runBlock` below uses `execFileSync`, which blocks this worker's
 * event loop for the whole run. An in-process neighbour would accept the TCP
 * connection (the kernel backlog does that) and then never write a response, so
 * the block's `curl` — which carries no `--max-time`, exactly as the workflow
 * spells it — would hang until the harness timeout. Measured while writing this
 * file: every case sat at its 240s ceiling.
 */
function neighbour(port: number): { stop: () => void } {
  const child = spawn(process.execPath, ['-e', NEIGHBOUR_STUB], {
    env: { ...process.env, NEIGHBOUR_PORT: String(port) },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  const stop = () => {
    try {
      if (child.pid) process.kill(child.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  };
  try {
    execFileSync(
      'bash',
      [
        '-c',
        `for _ in $(seq 1 80); do curl -fsS "http://localhost:${port}/api/v1/health" > /dev/null 2>&1 && exit 0; sleep 0.25; done; exit 1`,
      ],
      { stdio: 'ignore' },
    );
  } catch {
    stop();
    throw new Error(`the neighbour never came up on port ${port}`);
  }
  return { stop };
}

const NEIGHBOUR_STUB = `
const http = require('node:http');
http
  .createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ iam: 'NEIGHBOUR' }));
  })
  .listen(Number(process.env.NEIGHBOUR_PORT));
`;

function curlBody(url: string): string {
  try {
    return execFileSync('curl', ['-fsS', url], { encoding: 'utf8' }).trim();
  } catch {
    return 'NONE';
  }
}

const OS_START_STEPS: Array<[string, string]> = [
  ['scaffold-local', 'Boot from the artifact and probe health'],
  ['registry-canary', 'Boot and probe health (blank only)'],
];

describe.skipIf(!RUNNABLE)('[#9779] scaffold-e2e.yml boot-and-probe blocks assert on their OWN server', () => {
  for (const [job, step] of OS_START_STEPS) {
    describe(`${job} / ${step}`, () => {
      it('refuses a neighbour already answering the URL its loop accepts as proof', async () => {
        const port = await pickFreePort(38700);
        const script = stepScript(step).replaceAll('8080', String(port));
        const n = neighbour(port);
        try {
          // Vacuity guard: the neighbour must really be reachable at the exact
          // spelling the loop probes, or "refused" below proves nothing.
          expect(curlBody(`http://localhost:${port}/api/v1/health`)).toContain('NEIGHBOUR');
          const r = runBlock(harness(), script);
          expect(r.status).not.toBe(0);
          expect(r.out).toContain('already serving');
          // The whole card: it must NOT have gone on to assert /api/v1/ready
          // against the neighbour, which is what the pre-fix block did (and
          // printed, since `curl -fsS .../ready` echoes the body).
          expect(r.out).not.toContain('"iam":"NEIGHBOUR"');
          // And it says so at once — the answer never depended on waiting.
          expect(r.seconds).toBeLessThan(20);
        } finally {
          n.stop();
        }
      }, 120_000);

      it('accepts the server it booted itself, and probes THAT one', async () => {
        const port = await pickFreePort(38700);
        const script = stepScript(step).replaceAll('8080', String(port));
        const r = runBlock(harness(), script);
        expect(r.status).toBe(0);
        // `curl -fsS .../api/v1/ready` echoes the body, so the run says out loud
        // whose app it asserted on. This is the guard that keeps the case above
        // from passing for the trivial reason that the block always fails.
        expect(r.out).toContain('"iam":"OURS"');
      }, 120_000);

      it('fails fast, and says why, when the server it started exits', async () => {
        const port = await pickFreePort(38700);
        const script = stepScript(step).replaceAll('8080', String(port));
        const r = runBlock(harness({ OS_STUB_DIE_ON_BOOT: '1' }), script);
        expect(r.status).not.toBe(0);
        expect(r.out).toContain('exited before becoming healthy');
        // The server log is dumped, so the reason is in the run's own output.
        expect(r.out).toContain('artifact could not be read');
        // The pre-fix loop reached its 60s ceiling before saying anything.
        expect(r.seconds).toBeLessThan(30);
      }, 120_000);
    });
  }

  describe('scaffold-local / Docker build and run (scaffolded Dockerfile)', () => {
    const step = 'Docker build and run (scaffolded Dockerfile)';

    it('stops polling once its own container has exited, instead of waiting out the timeout', async () => {
      const port = await pickFreePort(38900);
      const script = stepScript(step).replaceAll('18080', String(port));
      const r = runBlock(harness({ STUB_CONTAINER_DIE_MS: '1500' }), script);
      expect(r.status).not.toBe(0);
      expect(r.out).toContain('no longer running');
      // Vacuity guard: the container really did start and then die, rather than
      // never having run at all — `docker logs` carries its own last words.
      expect(r.out).toContain('container crashed on purpose');
      expect(r.seconds).toBeLessThan(30);
    }, 120_000);

    it('passes while its container stays up', async () => {
      const port = await pickFreePort(38900);
      const script = stepScript(step).replaceAll('18080', String(port));
      const r = runBlock(harness(), script);
      expect(r.status).toBe(0);
    }, 120_000);
  });
});
