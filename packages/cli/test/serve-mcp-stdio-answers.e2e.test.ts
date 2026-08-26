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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_SECRET_KEY, childEnv, randomPort } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/**
 * `bin/run.js` through plain `node` — the SHIPPED entrypoint, and this file
 * genuinely reaches it (#11707).
 *
 * Both halves of that are load-bearing and neither works alone. @oclif/core
 * 4.13.3 skips its TypeScript path lookup only when `isProd()` —
 * `!['development', 'test'].includes(process.env.NODE_ENV ?? '')` — so under a
 * child `NODE_ENV` of `development` or `test` it rewrites the command target
 * from the declared `./dist/commands` to `./src/commands` and transpiles, and
 * `packages/cli/dist` goes unread whichever stub is named. This file used to
 * pin `NODE_ENV=development` on the child (#11317); the boot below leaves it
 * UNSET instead — the value that disables the reroute — and the `--dev` admin
 * seed survives that, for the reason spelled out at the `NODE_ENV` entry below.
 *
 * ⛔ Do not restore either half on its own. `bin/run-dev.js` assigns
 * `NODE_ENV = 'development'` before argv is parsed, so it reroutes
 * unconditionally; and re-pinning `NODE_ENV` on the child while naming
 * `bin/run.js` is the self-cancelling pair #11317 found here — it promises the
 * built artifact, delivers source, and says nothing.
 *
 * PRICE, stated because it is real. This file is now a verdict about BUILD
 * STATE as well as about the source in the checkout, which is the trade
 * `scripts/check-test-source-alias.mjs` argues against for in-process imports.
 * `turbo.json` declares `@objectstack/cli#test` `dependsOn: ["build"]` (#11268)
 * so CI always builds `dist/` first; `requireBuiltCli()` below is what a
 * developer running `vitest` directly gets instead of oclif's "command serve
 * not found". Neither catches a `dist/` that is merely BEHIND its source —
 * that residual is the honest cost of consuming the artifact, and
 * `serve-node-env-production-default.e2e.test.ts` (which has consumed `dist/`
 * since #11113) carries exactly the same one.
 */
const CLI = resolve(HERE, '../bin/run.js');

/**
 * Refuse to run against an unbuilt `packages/cli`, in a sentence rather than as
 * oclif's "command serve not found".
 *
 * The command target is read from the CLI's own `oclif.commands.target` rather
 * than restated here: that declaration is where `dist/commands` is decided, and
 * a copy keeps probing the old path after someone moves it — the argument
 * `scripts/cli-build-prerequisite.mjs` makes for the gates that shell out to
 * this CLI. Only that one declared shape is read; anything else (unreadable,
 * or `oclif.commands` written as a bare string) DEFERS rather than failing, so
 * a checkout this cannot understand never turns red here and the spawn's own
 * output stays the fallback — the same fail-open direction those gates take.
 */
function requireBuiltCli(): void {
  let target: unknown;
  try {
    target = JSON.parse(readFileSync(resolve(HERE, '../package.json'), 'utf8'))?.oclif?.commands?.target;
  } catch {
    return;
  }
  if (typeof target !== 'string' || !target) return;
  const commandFile = resolve(HERE, '..', target.replace(/^\.\//, ''), 'serve.js');
  if (existsSync(commandFile)) return;
  throw new Error(
    `packages/cli is not built: ${commandFile} does not exist.\n` +
      'This file spawns bin/run.js with NODE_ENV unset, which is what makes oclif resolve the ' +
      'command from dist/ instead of transpiling src/ — so on an unbuilt tree the child answers ' +
      '"command serve not found" and every boot below times out.\n' +
      'CI declares the build (turbo: @objectstack/cli#test dependsOn build); a direct vitest run does not.\n' +
      'Run: pnpm exec turbo run build --filter=@objectstack/cli',
  );
}

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
 * Spawn `os serve` and resolve once `waitFor` matches its output — stdout and
 * stderr together — leaving the child RUNNING; the shared `runServe` helper
 * kills on match, and this file has to keep talking to the process afterwards.
 *
 * Both streams, because since #7915 `serve` writes every human line (banner,
 * boot progress, kernel logs — including the `[MCP] Server started` record this
 * file waits for) to stderr, and keeps stdout clear for the protocol. Matching
 * stdout alone would wait on a stream that carries nothing until a client
 * speaks.
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
      // `childEnv`, not a bare `...process.env`: the vitest worker exports
      // `TEST=true`, which better-auth 1.7.1 reads directly and answers by
      // switching its own origin/CSRF validation OFF in the child — see
      // `helpers/serve-process.ts` for the measurement (#11267). This file
      // signs in for real, so it is a child that actually reaches that code.
      env: childEnv({
        NO_COLOR: '1',
        OS_LOG_LEVEL: 'info',
        OS_DISABLE_CONSOLE: '1',
        // Explicit, not minted: with `VITEST` no longer inherited (#11267),
        // `local-crypto-provider.ts`'s detectMode answers `development` for
        // this child instead of `test`, and development mode PERSISTS a minted
        // key to `$HOME/.objectstack/dev-crypto-key`. Supplying one keeps this
        // boot from writing to the runner's home directory and from coupling
        // itself to whatever other test got there first.
        OS_SECRET_KEY: E2E_SECRET_KEY,
        // UNSET, not `development` — and `undefined` rather than `''`, because
        // Node's `spawn()` omits an undefined-valued entry rather than
        // stringifying it. Unset is what keeps oclif's ts-path reroute OFF, so
        // `CLI` above resolves the command from `dist/`; the vitest worker
        // exports `NODE_ENV=test`, which would switch the reroute back on, so
        // the entry has to be here to remove it rather than merely omitted.
        //
        // The `--dev` admin seed this boot depends on still runs. `serve.ts`
        // assigns `process.env.NODE_ENV = 'development'` IN-PROCESS for `--dev`
        // when the variable is unset, before `runtime.start()`, and
        // plugin-auth's `isDevAdminSeedArmed()` reads it at CALL time inside
        // the `kernel:ready` hook — after that assignment. Both halves
        // re-measured on this tree, not inherited from the card.
        NODE_ENV: undefined,
        ...env,
      }),
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

    const onOutput = () => {
      if (!settled && waitFor.test(out + err)) {
        settled = true;
        clearTimeout(timer);
        resolveBoot({ child, stdout: () => out, stderr: () => err });
      }
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
    // Build prerequisite first: the spawns below resolve `serve` from `dist/`.
    requireBuiltCli();

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
