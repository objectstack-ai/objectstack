// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7645 — a started stdio MCP transport must ANSWER.
 *
 * The defect: `os serve` with `OS_MCP_STDIO_ENABLED=true` logged
 * `[MCP] Server started (transport: stdio)`, bound the principal to a real
 * `osk_` identity, and then never replied to a single JSON-RPC request —
 * `initialize`, `tools/list`, `resources/list`, `resources/read` all timed out
 * with ZERO bytes on stdout. Malformed input drew no error either.
 *
 * The cause sat in the HOST, above the plugin: oclif's argument parser reads
 * stdin for any positional arg the caller did not supply (`tryStdin` →
 * `createInterface({input: process.stdin})`, aborted after 10 ms), and
 * `Interface.close()` calls `stdin.pause()`. `serve` declares an optional
 * `config` positional, so `os serve --dev` left `process.stdin` explicitly
 * paused. `StdioServerTransport.start()` only attaches a `data` listener, and
 * Node auto-switches to flowing mode on that listener ONLY while
 * `readableFlowing` is `null` — never after an explicit `pause()`. Listener
 * attached, `bytesRead` 0, server deaf.
 *
 * WHY THIS FILE SPAWNS THE CLI. `packages/mcp`'s 17 existing stdio pins were
 * all green while every real `os serve` stdio session was unusable, because
 * they sit BELOW the gap: they exercise the runtime in a plain node process,
 * where nothing ever paused stdin. Only a test that spawns the actual command
 * and speaks JSON-RPC down the child's pipe can see it.
 *
 * WHY IT ASSERTS AN ANSWER, not a stream flag. `process.stdin.isPaused() ===
 * false` would pass over a transport that still replies to nothing — it pins
 * the mechanism, not the consequence. The assertion below is the card's own
 * repro: write a real `initialize` to the child's stdin, get a real result
 * back. Reverse-verified — with the `resume()` in `MCPServerRuntime.start()`
 * removed, this file times out with zero bytes on stdout.
 *
 * WHY IT MINTS A KEY OVER HTTP FIRST. stdio auto-start is fail-closed
 * (ADR-0101): without an `OS_MCP_STDIO_API_KEY` that resolves to a real
 * identity the plugin REFUSES to start, so there is no transport to test. That
 * contract is correct and is not what this file is about — the first boot just
 * mints a key through the product route (`POST /keys`) against a file-backed
 * DB, and the second boot reuses that DB. A fabricated `sys_api_key` row would
 * have to guess the at-rest hashing the mint path owns.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomPort } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** `bin/run.js` — the SHIPPED entrypoint, i.e. the one the card's repro names. */
const CLI = resolve(HERE, '../bin/run.js');

const CONFIG = `
export default {
  manifest: {
    id: 'com.example.stdioprobe',
    namespace: 'stdioprobe',
    version: '1.0.0',
    type: 'app',
    name: 'MCP stdio probe',
  },
  objects: [{
    name: 'stdioprobe_task',
    label: 'Task',
    sharingModel: 'public',
    fields: { title: { type: 'text', label: 'Title' } },
  }],
};
`;

let dir: string;
let port: string;
let apiKey: string;
/** Every child this file spawns, so a failed assertion never leaks a server. */
const children: ChildProcessWithoutNullStreams[] = [];

interface Booted {
  child: ChildProcessWithoutNullStreams;
  stdout: () => string;
  stderr: () => string;
}

/**
 * Spawn `os serve` and resolve once `waitFor` matches its stdout, leaving the
 * child RUNNING — the shared `runServe` helper kills on match, and this file
 * has to keep talking to the process afterwards.
 *
 * NOTE: no positional config path is passed. That is deliberate and load-bearing:
 * supplying one makes oclif skip `tryStdin` entirely, so stdin is never paused
 * and the defect cannot reproduce. `os serve --dev` is also the form every user
 * types.
 */
function boot(env: Record<string, string | undefined>, waitFor: RegExp): Promise<Booted> {
  return new Promise((resolveBoot, rejectBoot) => {
    const child = spawn(process.execPath, [CLI, 'serve', '-p', port, '--dev'], {
      cwd: dir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NO_COLOR: '1',
        OS_LOG_LEVEL: 'info',
        OS_DISABLE_CONSOLE: '1',
        // Explicit, not inherited: the dev-admin seed this fixture signs in as
        // is hard-gated on `NODE_ENV === 'development'`, and vitest exports
        // `test`, which would leave the DB user-less and the mint unauthorized.
        NODE_ENV: 'development',
        ...env,
      },
    }) as ChildProcessWithoutNullStreams;
    children.push(child);

    let out = '';
    let err = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      rejectBoot(
        new Error(`serve never printed ${waitFor}\n--- stdout ---\n${out.slice(-4000)}\n--- stderr ---\n${err.slice(-4000)}`),
      );
    }, 150_000);

    child.stdout.on('data', (d) => {
      out += String(d);
      if (!settled && waitFor.test(out)) {
        settled = true;
        clearTimeout(timer);
        resolveBoot({ child, stdout: () => out, stderr: () => err });
      }
    });
    child.stderr.on('data', (d) => {
      err += String(d);
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectBoot(
        new Error(`serve exited ${code} before ${waitFor}\n--- stdout ---\n${out.slice(-4000)}\n--- stderr ---\n${err.slice(-4000)}`),
      );
    });
  });
}

async function stop(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done) => {
    const give = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      done();
    }, 10_000);
    child.once('exit', () => {
      clearTimeout(give);
      done();
    });
    try {
      child.kill('SIGTERM');
    } catch {
      clearTimeout(give);
      done();
    }
  });
}

describe('#7645: the stdio MCP transport answers over a spawned CLI process', () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-stdio-e2e-'));
    writeFileSync(join(dir, 'objectstack.config.ts'), CONFIG, 'utf8');
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'mcp-stdio-e2e-fixture', private: true, type: 'module' }, null, 2),
      'utf8',
    );
    port = randomPort();

    // Boot 1 — mint a real key through the product route, against a FILE db so
    // boot 2 sees the same row (`:memory:` would not survive the restart).
    const first = await boot({ OS_DATABASE_URL: join(dir, 'probe.db') }, /Server is ready/);
    const base = `http://localhost:${port}/api/v1`;
    const signIn = await fetch(`${base}/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // `serve --dev` seeds this admin on an empty DB.
      body: JSON.stringify({ email: 'admin@objectos.ai', password: 'admin123' }),
    });
    expect(signIn.status).toBe(200);
    const token = ((await signIn.json()) as { token?: string }).token;
    expect(token).toBeTruthy();

    const minted = await fetch(`${base}/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'mcp-stdio-e2e' }),
    });
    expect(minted.status).toBe(201);
    apiKey = String(((await minted.json()) as { data: { key: string } }).data.key);
    expect(apiKey.startsWith('osk_')).toBe(true);

    await stop(first.child);
  }, 240_000);

  afterAll(async () => {
    for (const child of children) await stop(child);
    if (dir) rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it('replies to a real JSON-RPC initialize written to the child process stdin', async () => {
    const booted = await boot(
      {
        OS_DATABASE_URL: join(dir, 'probe.db'),
        OS_MCP_STDIO_ENABLED: 'true',
        OS_MCP_STDIO_API_KEY: apiKey,
      },
      /\[MCP\] Server started \(transport: stdio/,
    );

    // The started transport is the premise, not the assertion — the whole
    // defect was a transport that reached exactly this line and then went deaf.
    const reply = await new Promise<string | null>((resolveReply) => {
      let buf = '';
      const onData = (d: Buffer | string) => {
        buf += String(d);
        // A JSON-RPC frame carrying OUR request id — not merely "some bytes".
        if (/"jsonrpc"\s*:\s*"2\.0"/.test(buf) && /"id"\s*:\s*1\b/.test(buf)) {
          clearTimeout(giveUp);
          booted.child.stdout.off('data', onData);
          resolveReply(buf);
        }
      };
      booted.child.stdout.on('data', onData);

      const giveUp = setTimeout(() => {
        booted.child.stdout.off('data', onData);
        resolveReply(null);
      }, 45_000);

      booted.child.stdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'objectstack-e2e', version: '0.0.0' },
          },
        })}\n`,
      );
    });

    expect(
      reply,
      'the stdio transport started but never answered `initialize` (#7645: stdin left paused by the host)',
    ).not.toBeNull();

    // An ANSWER, not just traffic: the frame has to parse as this request's
    // result and carry the server's identity, so a stray log line that happens
    // to contain `"jsonrpc"` cannot pass.
    const frame = (reply as string)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('{') && line.includes('"jsonrpc"'))
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      })
      .find((msg) => msg?.id === 1);

    expect(frame, `no parseable JSON-RPC frame for id 1 in:\n${reply}`).toBeTruthy();
    const result = frame!.result as { protocolVersion?: string; serverInfo?: { name?: string } } | undefined;
    expect(frame!.error).toBeUndefined();
    expect(result?.protocolVersion).toBeTruthy();
    expect(result?.serverInfo?.name).toBeTruthy();

    await stop(booted.child);
  }, 240_000);
});
