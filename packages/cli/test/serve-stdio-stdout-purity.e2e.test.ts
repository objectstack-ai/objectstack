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
      // `childEnv`, not a bare `...process.env`: the vitest worker exports
      // `TEST=true`, which better-auth 1.7.1 reads directly and answers by
      // switching its own origin/CSRF validation OFF in the child — see
      // `helpers/serve-process.ts` for the measurement (#11267). This file
      // signs in for real, so it is a child that actually reaches that code.
      env: childEnv({
        NO_COLOR: '1',
        // The card's own capture level. `warn` (the default) still puts the
        // banner and the WARN records on the channel, so `info` is the same
        // defect with more of it — the strictest setting this pin can run at.
        OS_LOG_LEVEL: 'info',
        OS_DISABLE_CONSOLE: '1',
        // Explicit, not minted — but NOT because of the `VITEST` strip above.
        // What follows is quoted in the PAST TENSE on purpose: the code it
        // quotes is GONE. `detectMode` used to read
        // `if (env.VITEST || env.NODE_ENV === 'test') return 'test'`, so an
        // inherited `VITEST=true` did put a spawned child's crypto layer in
        // `test` mode. #11448 (`a58eac3e2`, merged 2026-08-23) deleted that
        // arm; the live `detectMode` (`local-crypto-provider.ts:185`, read
        // off this tree) reads `NODE_ENV` and nothing else. So stripping
        // `VITEST` is not what selects the posture here, and the `test` →
        // `development` flip the old wording predicted is unreachable in
        // either direction.
        //
        // What DOES select `development` is the `NODE_ENV` entry below, and
        // it is measured on this tree, not inherited: this file spawns
        // `bin/run.js`, which pins no `NODE_ENV` of its own (only
        // `bin/run-dev.js` does), with the variable UNSET — so `serve.ts`
        // assigns `process.env.NODE_ENV = 'development'` in-process for
        // `--dev` before `runtime.start()`, and the crypto provider reads
        // `process.env` when it resolves its key, after that assignment.
        //
        // ⭐ The conclusion is unchanged and load-bearing: development mode
        // PERSISTS a minted key to `$HOME/.objectstack/dev-crypto-key`, so
        // supplying one keeps this boot from writing to the runner's home
        // directory and from coupling itself to whatever other test got
        // there first.
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
        new Error(
          `serve never printed ${waitFor} (child-reported bound port: ${boundPort(out + err) ?? 'NEVER PRINTED'}; this file reserved ${port})\n--- stdout ---\n${out.slice(-4000)}\n--- stderr ---\n${err.slice(-4000)}`,
        ),
      );
    }, 150_000);

    const onOutput = () => {
      if (settled) return;
      // ⭐ #12526: the child is the authority on which port it bound, so read it
      // back before handing this boot to assertions that will use `port`.
      const bound = boundPort(out + err);
      if (bound !== null && bound !== port) {
        settled = true;
        clearTimeout(timer);
        rejectBoot(portDriftError(port, bound, out, err));
        return;
      }
      // `bound !== null` is part of the gate, not an optimisation: resolving on
      // `waitFor` alone would let a boot through before the child had said which
      // port it took, and the drift check would then be a no-op on an already
      // settled promise. Every marker below arrives with or before the banner.
      if (bound === null || !waitFor.test(out + err)) return;
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

/**
 * The port the CHILD says it bound — read out of the child's OWN output, never
 * out of what this file reserved (#12526, and #12441 ruling 2 before it).
 *
 * ## Why this file needs it at all
 *
 * The spawn below passes `--dev`, and `serve.ts` reads
 * `portAutoShiftAllowed = flags.dev || NODE_ENV === 'development'` — `flags.dev`
 * ALONE opens the auto-select branch, whatever `NODE_ENV` is. So a port taken
 * between `randomPort()`'s bind probe and this spawn does NOT fail the boot the
 * way it does in `serve-node-env-production-default.e2e.test.ts` (no `--dev`
 * there, so unset `NODE_ENV` defaults to production and a taken port is a hard
 * `exit 1` that `portContentionError()` can name). Here `getAvailablePort()`
 * silently hops the child onto the next free port and it reports itself READY.
 *
 * That is the strictly worse direction: a GREEN boot on the wrong port. Every
 * request this file makes afterwards goes to `port` — the port it reserved and
 * no longer owns — so it measures whatever else took it. Measured on this tree
 * with a neighbour holding the reserved port: reserved 34259, child bound
 * 34260, boot green, and the file's own next request was answered
 * `{"iAm":"A NEIGHBOURING AGENT DEV SERVER, not os serve"}`.
 *
 * ⚠️ The `--dev` responsible has been on this spawn line since `83e6016fa` — it
 * long predates #11707/#12459, which changed `NODE_ENV` and never touched it.
 * This was never read, not newly introduced.
 *
 * Two patterns because either one alone can be absent: the structured log obeys
 * `OS_LOG_LEVEL`, and the banner line is what survives when it does not.
 */
function boundPort(output: string): string | null {
  const match = /HTTP server started successfully[^\n]*?"port":\s*(\d+)/.exec(output)
    ?? /API:\s+http:\/\/localhost:(\d+)/.exec(output);
  return match ? match[1] : null;
}

/**
 * A lost port race, said out loud — the failure this file used to hide behind a
 * green boot (#12526).
 */
function portDriftError(reserved: string, bound: string, out: string, err: string): Error {
  return new Error(
    `PORT DRIFT: this file reserved port ${reserved}, but the child bound ${bound}.\n`
    + `\`os serve -p ${reserved} --dev\` passes \`--dev\`, so \`serve.ts\`'s `
    + `\`portAutoShiftAllowed = flags.dev || NODE_ENV === 'development'\` opened the auto-select `
    + `branch and \`getAvailablePort()\` hopped the child off the port that was asked for. The `
    + `boot SUCCEEDED — on the wrong port.\n`
    + `⛔ Something else took ${reserved} between \`randomPort()\`'s bind probe and the spawn. That `
    + `is a HOST race (several agents share one container), not a verdict about the code under `
    + `test — but it is NOT harmless here: every assertion below talks to ${reserved}, which is `
    + `now that other process, so continuing would measure a stranger rather than this boot.\n`
    + `⛔ Do not "fix" this by following the child to ${bound}: the point is that the port this `
    + `file uses and the port the child bound must be the SAME port. Re-run this file in `
    + `isolation; if it reproduces there, the port is genuinely held.\n`
    + `--- stdout ---\n${out.slice(-4000)}\n--- stderr ---\n${err.slice(-4000)}`,
  );
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
    // Build prerequisite first: the spawns below resolve `serve` from `dist/`.
    requireBuiltCli();

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
    // Wait for the banner's LAST line, not for `[MCP] Server started`. The
    // transport attaches inside `runtime.start()`, which the banner follows —
    // so this waits for both facts, where the MCP line alone would let the
    // assertions read a boot that had not printed its banner yet (measured:
    // that is exactly what happened on the first run of this file).
    const booted = await boot(
      {
        OS_DATABASE_URL: join(dir, 'probe.db'),
        OS_MCP_STDIO_ENABLED: 'true',
        OS_MCP_STDIO_API_KEY: apiKey,
      },
      /Press Ctrl\+C to stop/,
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

    // Let the stream settle: the reply is detected on a regex, which can match
    // before the frame's trailing newline has been delivered.
    await new Promise((r) => setTimeout(r, 750));

    const stdout = booted.stdout();
    const stderr = booted.stderr();
    const seen = `\n--- stdout ---\n${stdout.slice(0, 4000)}\n--- stderr (tail) ---\n${stderr.slice(-2000)}`;

    // ── The pin ────────────────────────────────────────────────────────
    // Every line the child has written to stdout since it was spawned —
    // banner, boot progress and kernel log included, had any of them gone
    // there — read exactly as a client's ReadBuffer reads them.
    //
    // The last element of the split is dropped either way: it is the empty
    // string after a trailing newline, or a line the pipe has not finished
    // delivering. A chunk boundary is not evidence of anything, and every line
    // that matters is followed by another.
    const nonFrameLines = stdout
      .split('\n')
      .slice(0, -1)
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
    // Purity is trivially satisfiable by silence; these say the output is on
    // the other stream rather than gone. (`Press Ctrl+C to stop` is what the
    // boot waited for above, so it is a tautology here — kept anyway, because
    // it is the assertion that would have to be deleted, not merely relaxed,
    // for the banner to disappear.)
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
