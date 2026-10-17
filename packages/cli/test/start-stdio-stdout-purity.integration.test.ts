// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 20 — spawns the real producer once per single-cause fixture: two boots of the built CLI (a `serve --dev` that mints the stdio key, then the first-run `os start` under test, its compile and serve children included); 15.0 s, the slowest of three local runs on a shared container, x 1.25, no CI reading yet

/**
 * #24192 — a FIRST-RUN `os start` with the stdio MCP transport enabled puts
 * nothing but protocol frames on stdout, its auto-compile step included.
 *
 * `serve-stdio-stdout-purity.e2e.test.ts` (#7915) pins this invariant for
 * `os serve`. This file pins it for the other documented stdio door,
 * `OS_MCP_STDIO_ENABLED=true OS_MCP_STDIO_API_KEY=osk_… os start`, on the boot
 * that door takes on a project's first run: no `dist/objectstack.json`, so
 * `start` compiles the config in a one-shot child before it spawns `serve`.
 *
 * ## The defect, measured before the fix
 *
 * `start` routes its OWN stdout to stderr (`redirectStdoutToStderr()`), but
 * that patches `process.stdout.write` in this process only. The compile child
 * was spawned with `stdio[1] = 'inherit'`, so it wrote to the raw fd 1 — the
 * fd the `serve` child's transport writes JSON-RPC frames to. Every line of its
 * progress (`◆ Compile`, `✓ Build complete`, `Artifact: …`) reached the client
 * ahead of the `initialize` answer, and a client that parses each stdout line
 * as JSON-RPC (MCP stdio framing) reads each one as a transport error. The
 * line count measured on this fixture is in the PR that landed this file.
 *
 * ## What is pinned, on ONE boot
 *
 *   1. PURITY: every complete line on stdout — from spawn through the
 *      `initialize` answer and a settle window after it — parses as a
 *      JSON-RPC 2.0 frame. Empty lines count: a client's line reader hands an
 *      empty line to `JSON.parse` too.
 *   2. The channel is live, not merely quiet: the transport answered the
 *      client's own `initialize` (its `id`, no `error`). Silence would satisfy
 *      (1) and is the worse bug.
 *   3. Moved, not deleted: the compile child's progress is on STDERR — the
 *      operator keeps it.
 *   4. Positive control: `dist/objectstack.json` exists afterwards, so the
 *      boot really took the auto-compile leg. A fixture that grew a `dist/`
 *      would skip the compile child and leave (1) green for the wrong reason.
 *
 * The `initialize` is written AT SPAWN, as an MCP client does; that the line
 * survives the compile child is #24002's pin
 * (`start-mcp-stdio-early-initialize.integration.test.ts`), not this one's.
 *
 * ## Why a minting boot first
 *
 * stdio auto-start is fail-closed (ADR-0101): without an `OS_MCP_STDIO_API_KEY`
 * that resolves to a real identity there is no transport, so nothing would
 * answer and (2) could not hold. A `serve --dev` boot mints a key through the
 * product route (`POST /keys`) against a file-backed database that the
 * `os start` boot then reuses. It names its config positional, gets no stdin,
 * and must leave no `dist/` behind.
 *
 * ## Why `bin/run.js` with `NODE_ENV` unset, and `.integration`
 *
 * `os start` forces a production `serve` child unless `NODE_ENV` is set, and
 * the production supervisor is the documented stdio invocation. `NODE_ENV`
 * unset is also what makes oclif resolve the command from `dist/`, so this file
 * needs a built CLI (`@objectstack/cli#test` dependsOn `build`). The `.e2e`
 * name would move it to the nightly run; its subject is one spawn line in
 * `start.ts` that any edit there can break, so it rides the queue run.
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
/**
 * After the answer: the frame is detected as soon as its line is complete, and
 * anything else already in flight on the pipe gets this long to arrive and be
 * judged by the purity assertion too.
 */
const SETTLE_MS = 750;

/** The compile child's own lines — the producer this file is about. */
const COMPILE_HEADER = '◆ Compile';
const COMPILE_DONE = /✓ Build complete/;

/** The request id the client's `initialize` carries; the answer must echo it. */
const REQUEST_ID = 24192;
const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: REQUEST_ID,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'objectstack-start-stdout-purity', version: '0.0.0' },
  },
});

const STACK_LITERAL = `{
  manifest: { id: 'com.example.fx24192', namespace: 'fx', version: '1.0.0', type: 'app', name: 'Fx 24192' },
  objects: [{ name: 'fx_task', label: 'Task', pluralLabel: 'Tasks', sharingModel: 'private', fields: { title: { type: 'text', label: 'Title' } } }],
}`;

const groups: ChildProcess[] = [];
let dir: string;
let db: string;
let apiKey: string;

/**
 * The environment both boots share; `undefined` unsets. Each spawn states its
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
    OS_MCP_STDIO_ENABLED: undefined,
    OS_MCP_STDIO_API_KEY: undefined,
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

/** One stdout line, read as a client's line reader reads it: a JSON-RPC 2.0 frame, or nothing. */
function parseFrame(line: string): Record<string, unknown> | undefined {
  try {
    const msg = JSON.parse(line) as unknown;
    return msg !== null && typeof msg === 'object' && (msg as { jsonrpc?: unknown }).jsonrpc === '2.0'
      ? (msg as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The COMPLETE lines of a stream so far. The last element of the split is
 * dropped: it is the empty string after a trailing newline, or a line the pipe
 * has not finished delivering — a chunk boundary is evidence of nothing.
 */
function completeLines(text: string): string[] {
  return text.split('\n').slice(0, -1).map((line) => line.replace(/\r$/, ''));
}

beforeAll(async () => {
  // Build prerequisite first: both boots resolve their command from `dist/`.
  requireBuiltCli(RUN_JS_RESOLVES_FROM_DIST);

  dir = mkdtempSync(join(tmpdir(), 'os-start-stdout-purity-'));
  mkdirSync(join(dir, '.os-home'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fx-24192', private: true, type: 'module' }));
  writeFileSync(join(dir, 'objectstack.config.ts'), defineStackSourceFromLiteral(STACK_LITERAL));
  linkSpec(dir);
  db = `file:${join(dir, 'probe.db')}`;

  // ── Boot 1: mint the stdio key through the product route ────────────────
  const port = randomPort();
  const mint = spawn(
    process.execPath,
    [CLI, 'serve', 'objectstack.config.ts', '-p', port, '--dev', '--no-ui'],
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
        label: 'start-stdio-stdout-purity',
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

  const minted = await probe('the key-mint probe', () => exchange('/keys', { name: 'start-stdout-purity' }, token));
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

describe('a first-run os start with the stdio MCP transport writes nothing but protocol frames to stdout (#24192)', () => {
  it('keeps the compile child off stdout, answers initialize there, and keeps the compile progress on stderr', async () => {
    const port = randomPort();
    const child = spawn(
      process.execPath,
      [CLI, 'start', '-p', port, '--no-ui', '--database', db],
      {
        cwd: dir,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
        env: bootEnv({
          OS_MCP_STDIO_ENABLED: 'true',
          OS_MCP_STDIO_API_KEY: apiKey,
          // Truly unset: production posture, and oclif resolves the command from `dist/`.
          NODE_ENV: undefined,
        }),
      },
    );
    groups.push(child);
    // AT SPAWN, as an MCP client does — the line waits in the pipe through the compile.
    child.stdin!.write(`${INITIALIZE}\n`);

    let stdout = '';
    let stderr = '';
    const outcome = await new Promise<{ answered: boolean; why: string }>((settle) => {
      const timer = setTimeout(() => settle({ answered: false, why: `no answer within ${ANSWER_TIMEOUT_MS} ms` }), ANSWER_TIMEOUT_MS);
      child.stdout!.on('data', (d) => {
        stdout += String(d);
        if (completeLines(stdout).some((line) => parseFrame(line)?.id === REQUEST_ID)) {
          clearTimeout(timer);
          settle({ answered: true, why: 'answered' });
        }
      });
      child.stderr!.on('data', (d) => { stderr += String(d); });
      child.on('exit', (code) => {
        clearTimeout(timer);
        settle({
          answered: false,
          why: portContentionError(stdout + stderr, 'os start (bin/run.js, NODE_ENV unset ⇒ production)', port)?.message
            ?? `os start exited ${String(code)} before answering`,
        });
      });
    });
    if (outcome.answered) await new Promise((r) => setTimeout(r, SETTLE_MS));

    const lines = completeLines(stdout);
    const seen = `\n--- ${outcome.why} ---\n--- stdout (head) ---\n${stdout.slice(0, 4000)}\n--- stderr (tail) ---\n${stderr.slice(-4000)}`;

    // 2. The channel is live: the transport answered the client's own request.
    expect(outcome.answered, `initialize was never answered${seen}`).toBe(true);
    const frame = lines.map(parseFrame).find((msg) => msg?.id === REQUEST_ID);
    expect(frame?.error, `initialize was answered with an error${seen}`).toBeUndefined();

    // 1. Purity — every line a client has read so far is a frame.
    const nonFrameLines = lines.filter((line) => parseFrame(line) === undefined);
    expect(
      nonFrameLines,
      `stdout carries ${nonFrameLines.length} line(s) a JSON-RPC client would fail to parse (#24192)${seen}`,
    ).toEqual([]);

    // 3. Moved, not deleted: the compile child's progress reached the operator on stderr.
    expect(stderr, `the compile child's header is missing from stderr${seen}`).toContain(COMPILE_HEADER);
    expect(stderr, `the compile child's completion line is missing from stderr${seen}`).toMatch(COMPILE_DONE);

    // 4. Positive control: the boot took the auto-compile leg, so the compile child ran.
    expect(existsSync(join(dir, 'dist', 'objectstack.json')), `the boot never compiled the config${seen}`).toBe(true);

    await stopGroup(child);
  }, 240_000);
});
