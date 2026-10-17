// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 20 — spawns the real producer once per single-cause fixture: two boots of the built CLI (a `serve --dev` that mints the stdio key, then the `os start` under test, its compile and serve children included); 14.6 s, the slower of two local runs on a shared container, x 1.25, no CI reading yet

/**
 * #24002 — an `os start` with the stdio MCP transport enabled answers an
 * `initialize` its client wrote AT SPAWN, and boots the configured app.
 *
 * ## The defect, measured on `origin/main` before the fix
 *
 * An MCP client spawns its server and writes `initialize` at once; it does not
 * wait for a banner. `os start` is a supervisor whose children inherit its
 * stdin, and oclif fills an omitted positional argument from a pending stdin
 * line (`tryStdin`). Two of those children took the client's line:
 *
 *   | fixture                      | what the early `initialize` became                     |
 *   |------------------------------|--------------------------------------------------------|
 *   | no `dist/` (a first run)     | the `compile` child's config path: "Config file not     |
 *   |                              | found: …/{"jsonrpc":"2.0",…}", compile failed, exit 1   |
 *   | `dist/` present              | the `serve` child's config path: "No objectstack.config |
 *   |                              | .ts found — booting from artifact", the config's own    |
 *   |                              | plugins never composed, `initialize` never answered     |
 *
 * The control the card names — `os serve objectstack.config.ts` with the same
 * early write — loads the config and answers, because a supplied positional
 * skips the stdin read.
 *
 * ## What is pinned, on ONE boot
 *
 * The fixture is a first run (no `dist/`), so the boot passes through BOTH
 * children with the client's line still pending in the pipe:
 *
 *   1. the transport ANSWERS that `initialize` — a parseable JSON-RPC frame with
 *      the request's own id and a server identity, not merely bytes on stdout;
 *   2. the configured app booted: the config is a HOST config whose plugin writes
 *      a marker from `start()`, and only a boot that loaded the config composes
 *      that plugin (booting the compiled artifact alone does not);
 *   3. positive control: `dist/objectstack.json` exists afterwards, so the boot
 *      really took the auto-compile leg and the compile child really ran with the
 *      line pending. Without it, a fixture that grew a `dist/` would stop
 *      exercising the compile child and this file would stay green.
 *
 * Reverse-verified per child: restoring either spawn's old shape alone turns
 * this file red (the PR that landed it records both readings).
 *
 * ⛔ Stdout PURITY is not asserted: the compile child's progress lines reach
 * the same stdout. That is a separate defect, not this card's; the frame is
 * found among the lines that parse.
 *
 * ## Why a minting boot first
 *
 * stdio auto-start is fail-closed (ADR-0101): without an `OS_MCP_STDIO_API_KEY`
 * that resolves to a real identity there is no transport to answer anything.
 * So a `serve --dev` boot mints a key through the product route (`POST /keys`)
 * against a file-backed database, and the `os start` boot reuses that database —
 * the shape `serve-mcp-stdio-answers.e2e.test.ts` (#7645) established. The
 * minting boot names its config positional and gets no stdin, so it can never
 * take the line meant for the boot under test.
 *
 * ## Why `bin/run.js` with `NODE_ENV` unset, and `.integration`
 *
 * `os start` forces a production child unless `NODE_ENV` is set, and the
 * production supervisor is the documented stdio invocation
 * (`OS_MCP_STDIO_ENABLED=true OS_MCP_STDIO_API_KEY=osk_… os start`). `NODE_ENV`
 * unset is also what makes oclif resolve the command from `dist/`, so this file
 * needs a built CLI (CI declares it: `@objectstack/cli#test` dependsOn
 * `build`). The `.e2e` name would move it to the nightly run on `main`; the
 * subject is two spawn lines in `start.ts` that any edit there can break, so
 * it rides the queue run, where such an edit lands.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineStackSourceFromLiteral, linkSpec } from './helpers/define-stack-fixture.js';
import {
  childEnv,
  E2E_SECRET_KEY,
  portContentionError,
  portDriftError,
  probeThroughChild,
  randomPort,
  requireBuiltCli,
  RUN_JS_RESOLVES_FROM_DIST,
} from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** `bin/run.js` — the SHIPPED entrypoint. See the header for why this one. */
const CLI = resolve(HERE, '../bin/run.js');

/** The banner's tail — every row above it has printed. */
const READY = /Press Ctrl\+C to stop/;
const BOOT_TIMEOUT_MS = 150_000;
/** How long the boot under test has to answer: compile, boot, then the reply. */
const ANSWER_TIMEOUT_MS = 120_000;

/** The host config's plugin marker — written from `start()` iff the config was composed. */
const MARKER_START = '[fx-24002] host-plugin start';
/** The request id the client's `initialize` carries; the answer must echo it. */
const REQUEST_ID = 24002;
const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: REQUEST_ID,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'objectstack-start-early-initialize', version: '0.0.0' },
  },
});

/** One object, and an instantiated plugin: that is what makes this a HOST config. */
const STACK_LITERAL = `{
  manifest: { id: 'com.example.fx24002', namespace: 'fx', version: '1.0.0', type: 'app', name: 'Fx 24002' },
  objects: [{ name: 'fx_task', label: 'Task', pluralLabel: 'Tasks', sharingModel: 'private', fields: { title: { type: 'text', label: 'Title' } } }],
  plugins: [{
    name: 'com.example.fx24002.host-plugin',
    version: '1.0.0',
    init: async () => {},
    start: async () => { process.stderr.write(${JSON.stringify(`${MARKER_START}\n`)}); },
  }],
}`;

const groups: ChildProcess[] = [];
let dir: string;
let db: string;
let apiKey: string;

/** The environment both boots share; `undefined` unsets. */
function bootEnv(overrides: Record<string, string | undefined>): Record<string, string | undefined> {
  // `childEnv`, never a bare `...process.env` — see its header (commit 1ddda1d00).
  return childEnv({
    NO_COLOR: '1',
    OS_LOG_LEVEL: 'warn',
    OS_DISABLE_CONSOLE: '1',
    OS_CLOUD_URL: 'off',
    OS_HOME: join(dir, '.os-home'),
    OS_SECRET_KEY: E2E_SECRET_KEY,
    OS_ARTIFACT_URL: undefined,
    OS_ARTIFACT_PATH: undefined,
    OS_DATABASE_URL: undefined,
    OS_MCP_STDIO_ENABLED: undefined,
    OS_MCP_STDIO_API_KEY: undefined,
    // Truly unset: production posture, and oclif resolves the command from `dist/`.
    NODE_ENV: undefined,
    ...overrides,
  });
}

/** SIGTERM the whole process group (a supervisor and its children), SIGKILL if it lingers. */
async function stopGroup(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done) => {
    const give = setTimeout(() => {
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* group already gone */ }
      done();
    }, 15_000);
    child.once('exit', () => { clearTimeout(give); done(); });
    try { process.kill(-child.pid!, 'SIGTERM'); } catch { clearTimeout(give); done(); }
  });
}

/** The JSON-RPC frame answering `id`, among the COMPLETE stdout lines that parse. */
function frameFor(stdout: string, id: number): Record<string, unknown> | undefined {
  const complete = stdout.slice(0, stdout.lastIndexOf('\n') + 1);
  for (const line of complete.split('\n')) {
    const text = line.trim();
    if (!text.startsWith('{') || !text.includes('"jsonrpc"')) continue;
    try {
      const msg = JSON.parse(text) as Record<string, unknown>;
      if (msg.id === id) return msg;
    } catch {
      /* not a frame */
    }
  }
  return undefined;
}

beforeAll(async () => {
  // Build prerequisite first: both boots resolve their command from `dist/`.
  requireBuiltCli(RUN_JS_RESOLVES_FROM_DIST);

  dir = mkdtempSync(join(tmpdir(), 'os-start-early-initialize-'));
  mkdirSync(join(dir, '.os-home'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fx-24002', private: true, type: 'module' }));
  writeFileSync(join(dir, 'objectstack.config.ts'), defineStackSourceFromLiteral(STACK_LITERAL));
  linkSpec(dir);
  db = `file:${join(dir, 'probe.db')}`;

  // ── Boot 1: mint the stdio key through the product route ────────────────
  const port = randomPort();
  const mint = spawn(
    process.execPath,
    [CLI, 'serve', 'objectstack.config.ts', '-p', port, '--dev', '--no-ui'],
    { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: bootEnv({ OS_DATABASE_URL: db }) },
  );
  groups.push(mint);
  let output = '';
  await new Promise<void>((ready, fail) => {
    const timer = setTimeout(
      () => fail(new Error(`the minting serve never printed ${READY}\n--- output ---\n${output.slice(-4000)}`)),
      BOOT_TIMEOUT_MS,
    );
    const onData = (d: unknown) => {
      output += String(d);
      if (!READY.test(output)) return;
      clearTimeout(timer);
      // `--dev` opens serve's port auto-shift: a taken port is a GREEN boot
      // elsewhere, so the port is read back out of the child's own banner.
      const drift = portDriftError(output, 'os serve --dev (the minting boot)', port);
      if (drift) fail(drift);
      else ready();
    };
    mint.stdout!.on('data', onData);
    mint.stderr!.on('data', onData);
    mint.on('exit', (code) => {
      clearTimeout(timer);
      fail(portContentionError(output, 'os serve --dev (the minting boot)', port)
        ?? new Error(`the minting serve exited ${String(code)} before ${READY}\n--- output ---\n${output.slice(-4000)}`));
    });
  });

  const base = `http://localhost:${port}/api/v1`;
  // ⛔ No assertion inside a probe: any throw in there reads as a transport failure.
  const probe = <T>(what: string, request: () => Promise<T>): Promise<T> =>
    probeThroughChild(
      {
        child: mint,
        transcript: () => `\n--- child output ---\n${output.slice(-4000)}`,
        label: 'start-mcp-stdio-early-initialize',
        what: `${what} on port ${port}`,
      },
      request,
    );
  const exchange = async (path: string, body: unknown, token?: string) => {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    let parsed: unknown = null;
    try { parsed = await res.json(); } catch { /* non-JSON error body */ }
    return { status: res.status, body: parsed };
  };

  // `serve --dev` seeds this admin on an empty database.
  const signIn = await probe('the sign-in probe', () =>
    exchange('/auth/sign-in/email', { email: 'admin@objectos.ai', password: 'admin123' }));
  expect(signIn.status, `sign-in answered ${JSON.stringify(signIn.body)}`).toBe(200);
  const token = (signIn.body as { token?: string } | null)?.token;
  expect(token).toBeTruthy();

  const minted = await probe('the key-mint probe', () => exchange('/keys', { name: 'start-early-initialize' }, token));
  expect(minted.status, `key mint answered ${JSON.stringify(minted.body)}`).toBe(201);
  apiKey = String((minted.body as { data: { key: string } }).data.key);
  expect(apiKey.startsWith('osk_')).toBe(true);

  await stopGroup(mint);
  // The boot under test is a FIRST run: nothing above may have compiled the config.
  expect(existsSync(join(dir, 'dist', 'objectstack.json')), 'the minting boot left a dist/ behind').toBe(false);
}, 240_000);

afterAll(async () => {
  for (const child of groups) await stopGroup(child);
  if (dir) rmSync(dir, { recursive: true, force: true });
}, 60_000);

describe('os start with the stdio MCP transport and an initialize written at spawn (#24002)', () => {
  it('answers that initialize and boots the configured app, through the compile and serve children', async () => {
    const port = randomPort();
    const child = spawn(
      process.execPath,
      [CLI, 'start', '-p', port, '--no-ui', '--database', db],
      {
        cwd: dir,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
        env: bootEnv({ OS_MCP_STDIO_ENABLED: 'true', OS_MCP_STDIO_API_KEY: apiKey }),
      },
    );
    groups.push(child);
    // ⭐ AT SPAWN, before the CLI has parsed a single argument — what an MCP
    // client does. The line sits in the pipe while `start` compiles and boots.
    child.stdin!.write(`${INITIALIZE}\n`);

    let stdout = '';
    let stderr = '';
    const outcome = await new Promise<{ frame?: Record<string, unknown>; why: string }>((settle) => {
      const timer = setTimeout(() => settle({ why: `no answer within ${ANSWER_TIMEOUT_MS} ms` }), ANSWER_TIMEOUT_MS);
      child.stdout!.on('data', (d) => {
        stdout += String(d);
        const frame = frameFor(stdout, REQUEST_ID);
        if (frame) {
          clearTimeout(timer);
          settle({ frame, why: 'answered' });
        }
      });
      child.stderr!.on('data', (d) => { stderr += String(d); });
      child.on('exit', (code) => {
        clearTimeout(timer);
        settle({
          why: portContentionError(stdout + stderr, 'os start (bin/run.js, NODE_ENV unset ⇒ production)', port)?.message
            ?? `os start exited ${String(code)} before answering`,
        });
      });
    });
    const seen = `\n--- ${outcome.why} ---\n--- stdout ---\n${stdout.slice(-3000)}\n--- stderr ---\n${stderr.slice(-6000)}`;

    // 1. An ANSWER to the client's own request, not merely traffic.
    expect(outcome.frame, `initialize was never answered${seen}`).toBeTruthy();
    const frame = outcome.frame!;
    expect(frame.error, `initialize was answered with an error${seen}`).toBeUndefined();
    const result = frame.result as { protocolVersion?: string; serverInfo?: { name?: string } } | undefined;
    expect(result?.protocolVersion, `the answer carries no protocolVersion${seen}`).toBeTruthy();
    expect(result?.serverInfo?.name, `the answer carries no server identity${seen}`).toBeTruthy();

    // 2. The configured app booted: the config's own plugin was composed and started.
    expect(stderr, `the host config was not loaded — its plugin never started${seen}`).toContain(MARKER_START);

    // 3. Positive control: the boot took the auto-compile leg, so the compile child ran.
    expect(existsSync(join(dir, 'dist', 'objectstack.json')), `the boot never compiled the config${seen}`).toBe(true);

    await stopGroup(child);
  }, 240_000);
});
