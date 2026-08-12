// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7915 — with the stdio MCP transport mounted, `os serve` puts NOTHING but
 * protocol frames on stdout.
 *
 * The defect: `OS_MCP_STDIO_ENABLED=true` makes `process.stdout` the JSON-RPC
 * channel, while the same fd carried the CLI's banner and the kernel's
 * `INFO`/`WARN` records. MCP stdio framing is newline-delimited JSON — a
 * conforming client `JSON.parse`s every line it reads — so each of those lines
 * reaches the client as a transport error. Measured on the card's repro: the
 * `initialize` result arrived on line 517, behind 516 lines of non-protocol
 * text. It reads as "the transport is broken", which is why it only became
 * visible once #7645 (PR #7914) made the transport answer at all.
 *
 * ## Why this asserts on the STREAM, not on "the client parsed OK"
 *
 * A test that only writes `initialize` and checks the reply passes today for
 * the wrong reason: the harness reads the child's pipe as one accumulating
 * buffer and picks the frame out of it, so a short banner never bothers it.
 * Only "every byte on stdout belongs to the protocol" fails when one line
 * comes back — which is the invariant a real client actually depends on.
 *
 * ## The negative half
 *
 * Purity is trivially satisfiable by silence, and silence would be a worse bug
 * than the noise: the operator loses the banner, the boot warnings and the
 * kernel log. So the same run asserts the banner and the kernel's records are
 * present on **stderr**. Moved, not deleted.
 *
 * ## Fixture cost
 *
 * stdio auto-start is fail-closed (ADR-0101): without an `OS_MCP_STDIO_API_KEY`
 * that resolves to a real identity the plugin refuses to start, so there is no
 * transport to measure. The first boot mints a key through the product route
 * against a file-backed DB, exactly as `serve-mcp-stdio-answers.e2e.test.ts`
 * (this file's sibling — that one pins that the transport ANSWERS, this one
 * pins what else the channel carries).
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
    id: 'com.example.stdoutpurity',
    namespace: 'stdoutpurity',
    version: '1.0.0',
    type: 'app',
    name: 'MCP stdout purity probe',
  },
  objects: [{
    name: 'stdoutpurity_task',
    label: 'Task',
    sharingModel: 'public',
    fields: { title: { type: 'text', label: 'Title' } },
  }],
};
`;

let dir: string;
let port: string;
let apiKey: string;
const children: ChildProcessWithoutNullStreams[] = [];

interface Booted {
  child: ChildProcessWithoutNullStreams;
  stdout: () => string;
  stderr: () => string;
}

/**
 * Spawn `os serve` and resolve once `waitFor` matches its output, leaving the
 * child RUNNING.
 *
 * `waitFor` is matched against stdout and stderr TOGETHER. That is not a
 * convenience: this file's whole subject is that the boot says nothing on
 * stdout, so a stdout-only wait would time out on a healthy process.
 *
 * No positional config path, deliberately — `os serve --dev` is the form the
 * card's repro and every user types (and the one whose oclif stdin handling
 * #7645 had to fix).
 */
function boot(env: Record<string, string | undefined>, waitFor: RegExp): Promise<Booted> {
  return new Promise((resolveBoot, rejectBoot) => {
    const child = spawn(process.execPath, [CLI, 'serve', '-p', port, '--dev'], {
      cwd: dir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NO_COLOR: '1',
        // The card's own capture level. `warn` (the default) still puts the
        // banner and the WARN records on the channel, so `info` is the same
        // defect with more of it — the strictest setting this pin can run at.
        OS_LOG_LEVEL: 'info',
        OS_DISABLE_CONSOLE: '1',
        // Explicit, not inherited: the dev-admin seed the mint signs in as is
        // hard-gated on `NODE_ENV === 'development'`, and vitest exports `test`.
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
        new Error(
          `serve never printed ${waitFor}\n--- stdout ---\n${out.slice(-4000)}\n--- stderr ---\n${err.slice(-4000)}`,
        ),
      );
    }, 150_000);

    const onOutput = () => {
      if (settled || !waitFor.test(out + err)) return;
      settled = true;
      clearTimeout(timer);
      resolveBoot({ child, stdout: () => out, stderr: () => err });
    };

    child.stdout.on('data', (d) => {
      out += String(d);
      onOutput();
    });
    child.stderr.on('data', (d) => {
      err += String(d);
      onOutput();
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectBoot(
        new Error(
          `serve exited ${code} before ${waitFor}\n--- stdout ---\n${out.slice(-4000)}\n--- stderr ---\n${err.slice(-4000)}`,
        ),
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

/** One line of the child's stdout, as a client's `ReadBuffer` would read it. */
function parseFrame(line: string): Record<string, unknown> | undefined {
  try {
    const msg = JSON.parse(line) as Record<string, unknown>;
    return msg && typeof msg === 'object' && msg.jsonrpc === '2.0' ? msg : undefined;
  } catch {
    return undefined;
  }
}

describe('#7915: a stdio MCP boot writes nothing but protocol frames to stdout', () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-stdout-purity-e2e-'));
    writeFileSync(join(dir, 'objectstack.config.ts'), CONFIG, 'utf8');
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'mcp-stdout-purity-e2e-fixture', private: true, type: 'module' }, null, 2),
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
      body: JSON.stringify({ email: 'admin@objectos.ai', password: 'admin123' }),
    });
    expect(signIn.status).toBe(200);
    const token = ((await signIn.json()) as { token?: string }).token;
    expect(token).toBeTruthy();

    const minted = await fetch(`${base}/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'mcp-stdout-purity-e2e' }),
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

  it('keeps stdout free of every non-frame byte, and keeps the diagnostics on stderr', async () => {
    const booted = await boot(
      {
        OS_DATABASE_URL: join(dir, 'probe.db'),
        OS_MCP_STDIO_ENABLED: 'true',
        OS_MCP_STDIO_API_KEY: apiKey,
      },
      /\[MCP\] Server started \(transport: stdio/,
    );

    // Speak the protocol, so the channel is exercised rather than merely quiet:
    // an empty stdout would satisfy "no non-frame bytes" while the transport is
    // broken, and that is the failure this file must NOT pass.
    const reply = await new Promise<string | null>((resolveReply) => {
      let buf = '';
      const onData = (d: Buffer | string) => {
        buf += String(d);
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

    const stdout = booted.stdout();
    const stderr = booted.stderr();
    const seen = `\n--- stdout ---\n${stdout.slice(0, 4000)}\n--- stderr (tail) ---\n${stderr.slice(-2000)}`;

    // ── The pin ────────────────────────────────────────────────────────
    // Every line the child has written to stdout since it was spawned —
    // banner, boot progress and kernel log included, had any of them gone
    // there — read exactly as a client's ReadBuffer reads them.
    const nonFrameLines = stdout
      .split('\n')
      .filter((line) => line.length > 0)
      .filter((line) => parseFrame(line) === undefined);
    expect(
      nonFrameLines,
      `stdout carries ${nonFrameLines.length} line(s) a JSON-RPC client would fail to parse (#7915)${seen}`,
    ).toEqual([]);

    // The transport really did answer on that clean channel (#7645's pin, kept
    // here so purity can never be reached by breaking the channel).
    expect(reply, `the stdio transport never answered \`initialize\`${seen}`).not.toBeNull();
    const frame = (reply as string)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map(parseFrame)
      .find((msg) => msg?.id === 1);
    expect(frame, `no parseable JSON-RPC frame for id 1${seen}`).toBeTruthy();
    expect(frame!.error).toBeUndefined();

    // ── The negative half: moved, not silenced ─────────────────────────
    expect(stderr, `the startup banner vanished instead of moving to stderr${seen}`).toContain(
      'Server is ready',
    );
    expect(stderr, `the banner's tail is missing from stderr${seen}`).toContain('Press Ctrl+C to stop');
    // The kernel's own records — the second, independent source the card names.
    // `[MCP] Server started` is one the boot always emits at INFO.
    expect(stderr, `kernel log records are not reaching stderr${seen}`).toMatch(
      /INFO .*\[MCP\] Server started \(transport: stdio/,
    );

    await stop(booted.child);
  }, 240_000);
});
