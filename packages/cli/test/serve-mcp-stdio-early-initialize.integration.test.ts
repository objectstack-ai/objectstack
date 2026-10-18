// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 15 — spawns the real producer once per single-cause fixture: three runs of the built CLI (a `serve --dev` that mints the stdio key, an `os compile` for the artifact, then the `os serve` under test); 11.6 s, the slowest of four local runs on a shared container, x 1.25, no CI reading yet

/**
 * #24191 — `os serve` with the stdio MCP transport enabled and NO config
 * positional answers an `initialize` its client wrote AT SPAWN, and boots the
 * configured app.
 *
 * ## The defect, measured on `origin/main` before the fix
 *
 * An MCP client spawns its server and writes `initialize` at once; it does not
 * wait for a banner. oclif fills an omitted positional argument from a pending
 * stdin line (`tryStdin`), and `serve` declared its optional `config`
 * positional without `ignoreStdin`. So a bare `os serve` took the client's
 * line as its config path: it printed "No objectstack.config.ts found —
 * booting from artifact" beside the config, booted the compiled
 * `dist/objectstack.json` without the config's own plugins, and never answered
 * — the request it would have answered had already been consumed. The control,
 * `os serve objectstack.config.ts` with the same early write, loads the config
 * and answers, because a supplied positional skips the stdin read.
 *
 * `os start` reaches `serve` with the positional named (#24002, its own pin in
 * `start-mcp-stdio-early-initialize.integration.test.ts`); this file is the
 * door that remained: `serve` spawned directly, the way an MCP client's server
 * entry names it.
 *
 * ## What is pinned, on ONE boot
 *
 *   1. the transport ANSWERS that `initialize` — a parseable JSON-RPC frame with
 *      the request's own id and a server identity, not merely bytes on stdout;
 *   2. the configured app booted: the config is a HOST config whose plugin writes
 *      a marker from `start()`, and only a boot that loaded the config composes
 *      that plugin (booting the compiled artifact alone does not).
 *
 * Positive control, asserted before the boot: `dist/objectstack.json` exists.
 * That is what makes the defect SILENT — with no artifact a swallowed config
 * path is a loud "Nothing to serve" exit — and what makes assertion 2 the one
 * that tells the two boots apart. A fixture that lost its `dist/` would still
 * redden without the fix, but on the exit rather than on the wrong boot.
 *
 * Reverse-verified: with `ignoreStdin` removed from `serve`'s `config`
 * positional, this file goes red (the PR that landed it records the reading).
 *
 * ⛔ Stdout PURITY is not asserted here; `serve-stdio-stdout-purity.e2e.test.ts`
 * owns it. The frame is found among the lines that parse.
 *
 * ## Why a minting boot and a compile first
 *
 * stdio auto-start is fail-closed (ADR-0101): without an `OS_MCP_STDIO_API_KEY`
 * that resolves to a real identity there is no transport to answer anything.
 * So a `serve --dev` boot mints a key through the product route (`POST /keys`)
 * against a file-backed database, and the boot under test reuses that database
 * — the shape `serve-mcp-stdio-answers.e2e.test.ts` (#7645) established. Then
 * `os compile` writes the artifact the positive control needs. Both name their
 * config positional and get no stdin, so neither can take the line meant for
 * the boot under test.
 *
 * ## Why `bin/run.js` with `NODE_ENV` unset, and `.integration`
 *
 * `NODE_ENV` unset is production posture, the one an MCP client's server entry
 * runs in, and it is also what makes oclif resolve the command from `dist/`, so
 * this file needs a built CLI (CI declares it: `@objectstack/cli#test`
 * dependsOn `build`). The `.e2e` name would move it to the nightly run on
 * `main`; the subject is one argument declaration in `serve.ts` that any edit
 * there can break, so it rides the queue run, where such an edit lands.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineStackSourceFromLiteral, linkSpec } from './helpers/define-stack-fixture.js';
import {
  childEnv,
  E2E_SECRET_KEY,
  KERNEL_ASSIGNED_PORT,
  probeThroughChild,
  readKernelAssignedPort,
  requireBuiltCli,
  RUN_JS_RESOLVES_FROM_DIST,
} from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** `bin/run.js` — the SHIPPED entrypoint. See the header for why this one. */
const CLI = resolve(HERE, '../bin/run.js');

/** The banner's tail — every row above it has printed. */
const READY = /Press Ctrl\+C to stop/;
const BOOT_TIMEOUT_MS = 150_000;
/** How long the boot under test has to answer: a boot, then the reply. */
const ANSWER_TIMEOUT_MS = 60_000;

/** The host config's plugin marker — written from `start()` iff the config was composed. */
const MARKER_START = '[fx-24191] host-plugin start';
/** The request id the client's `initialize` carries; the answer must echo it. */
const REQUEST_ID = 24191;
const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: REQUEST_ID,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'objectstack-serve-early-initialize', version: '0.0.0' },
  },
});

/** One object, and an instantiated plugin: that is what makes this a HOST config. */
const STACK_LITERAL = `{
  manifest: { id: 'com.example.fx24191', namespace: 'fx', version: '1.0.0', type: 'app', name: 'Fx 24191' },
  objects: [{ name: 'fx_task', label: 'Task', pluralLabel: 'Tasks', sharingModel: 'private', fields: { title: { type: 'text', label: 'Title' } } }],
  plugins: [{
    name: 'com.example.fx24191.host-plugin',
    version: '1.0.0',
    init: async () => {},
    start: async () => { process.stderr.write(${JSON.stringify(`${MARKER_START}\n`)}); },
  }],
}`;

/** A fixed auth secret for the production boot under test; any 32+ characters. */
const AUTH_SECRET = 'fx24191'.repeat(8);

const groups: ChildProcess[] = [];
let dir: string;
let db: string;
let apiKey: string;

/**
 * The environment every child shares; `undefined` unsets. Each spawn states its
 * child's `NODE_ENV` itself, at the call (`check:cli-test-child-env`, rule 3).
 */
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
    OS_AUTH_SECRET: undefined,
    OS_MCP_STDIO_ENABLED: undefined,
    OS_MCP_STDIO_API_KEY: undefined,
    ...overrides,
  });
}

/** SIGTERM the whole process group, SIGKILL if it lingers. */
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
  // Build prerequisite first: every child resolves its command from `dist/`.
  requireBuiltCli(RUN_JS_RESOLVES_FROM_DIST);

  dir = mkdtempSync(join(tmpdir(), 'os-serve-early-initialize-'));
  mkdirSync(join(dir, '.os-home'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fx-24191', private: true, type: 'module' }));
  writeFileSync(join(dir, 'objectstack.config.ts'), defineStackSourceFromLiteral(STACK_LITERAL));
  linkSpec(dir);
  db = `file:${join(dir, 'probe.db')}`;

  // ── Boot 1: mint the stdio key through the product route ────────────────
  // A kernel-assigned port (#24295): no number is drawn and released before the
  // spawn, so there is no gap for another process to take it in.
  const mint = spawn(
    process.execPath,
    [CLI, 'serve', 'objectstack.config.ts', '-p', KERNEL_ASSIGNED_PORT, '--dev', '--no-ui'],
    {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: bootEnv({
        OS_DATABASE_URL: db,
        // Truly unset: oclif resolves the command from `dist/`.
        NODE_ENV: undefined,
      }),
    },
  );
  groups.push(mint);
  let output = '';
  const port = await new Promise<number>((ready, fail) => {
    const timer = setTimeout(
      () => fail(new Error(`the minting serve never printed ${READY}\n--- output ---\n${output.slice(-4000)}`)),
      BOOT_TIMEOUT_MS,
    );
    const onData = (d: unknown) => {
      output += String(d);
      if (!READY.test(output)) return;
      clearTimeout(timer);
      // The child is the only authority on the port the kernel assigned it.
      const bound = readKernelAssignedPort(output, 'os serve --dev (the minting boot)');
      if (bound instanceof Error) fail(bound);
      else ready(bound);
    };
    mint.stdout!.on('data', onData);
    mint.stderr!.on('data', onData);
    mint.on('exit', (code) => {
      clearTimeout(timer);
      fail(new Error(`the minting serve exited ${String(code)} before ${READY}\n--- output ---\n${output.slice(-4000)}`));
    });
  });

  const base = `http://localhost:${port}/api/v1`;
  // ⛔ No assertion inside a probe: any throw in there reads as a transport failure.
  const probe = <T>(what: string, request: () => Promise<T>): Promise<T> =>
    probeThroughChild(
      {
        child: mint,
        transcript: () => `\n--- child output ---\n${output.slice(-4000)}`,
        label: 'serve-mcp-stdio-early-initialize',
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

  const minted = await probe('the key-mint probe', () => exchange('/keys', { name: 'serve-early-initialize' }, token));
  expect(minted.status, `key mint answered ${JSON.stringify(minted.body)}`).toBe(201);
  apiKey = String((minted.body as { data: { key: string } }).data.key);
  expect(apiKey.startsWith('osk_')).toBe(true);

  await stopGroup(mint);

  // ── The artifact the positive control needs ─────────────────────────────
  const compiled = spawnSync(process.execPath, [CLI, 'compile', 'objectstack.config.ts'], {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: BOOT_TIMEOUT_MS,
    env: bootEnv({
      // Truly unset: oclif resolves the command from `dist/`.
      NODE_ENV: undefined,
    }),
  });
  expect(compiled.status, `os compile exited ${String(compiled.status)}\n--- stdout ---\n${compiled.stdout}\n--- stderr ---\n${compiled.stderr}`).toBe(0);
}, 240_000);

afterAll(async () => {
  for (const child of groups) await stopGroup(child);
  if (dir) rmSync(dir, { recursive: true, force: true });
}, 60_000);

describe('os serve with no config positional, the stdio MCP transport and an initialize written at spawn (#24191)', () => {
  it('answers that initialize and boots the configured app, not the artifact beside it', async () => {
    // Positive control: the artifact a swallowed config path would boot from is there.
    expect(existsSync(join(dir, 'dist', 'objectstack.json')), 'the fixture has no dist/objectstack.json').toBe(true);

    const child = spawn(
      process.execPath,
      // ⭐ No config positional — the subject of this file. A kernel-assigned
      // port (#24295): this child is in production posture, which refuses to
      // auto-shift, so a port drawn and released beforehand is a red whenever
      // another process takes it in the gap. Nothing below talks to the port.
      [CLI, 'serve', '-p', KERNEL_ASSIGNED_PORT, '--no-ui'],
      {
        cwd: dir,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
        env: bootEnv({
          OS_DATABASE_URL: db,
          // Production `serve` mounts auth only with a secret (`os start` hands
          // its child a persisted one); without auth the key resolves to no
          // identity and the stdio transport refuses to start (ADR-0101).
          OS_AUTH_SECRET: AUTH_SECRET,
          OS_MCP_STDIO_ENABLED: 'true',
          OS_MCP_STDIO_API_KEY: apiKey,
          // Truly unset: production posture, and oclif resolves the command from `dist/`.
          NODE_ENV: undefined,
        }),
      },
    );
    groups.push(child);
    // ⭐ AT SPAWN, before the CLI has parsed a single argument — what an MCP
    // client does. The line sits in the pipe while oclif parses `serve`'s args.
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
          why: `os serve exited ${String(code)} before answering`,
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
    expect(stderr, `the config was not loaded — its plugin never started${seen}`).toContain(MARKER_START);

    await stopGroup(child);
  }, 240_000);
});
