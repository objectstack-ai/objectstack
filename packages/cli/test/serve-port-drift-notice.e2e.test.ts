// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12543 — when `os serve` binds a port other than the one it was asked for, it
 * SAYS SO, naming both numbers on one line.
 *
 * ## The defect is the silence, not the behaviour
 *
 * Auto-shifting to the next free port in development is correct and deliberate:
 * several example apps have to run side by side, and #11113 owns the production
 * half, where a busy port is a loud refusal instead. ⛔ Nothing in this file
 * argues for changing either half, and a change to what `os serve` *does* would
 * be answering a different card. What was missing is that the shift happened
 * with nothing marking it as one: the ready banner prints the port that was
 * BOUND, and no line anywhere said it was not the port that was ASKED FOR.
 *
 * ## Why the producer, when the consumers already cope
 *
 * The consumer side of this family is fully landed — a bind probe (#12441), the
 * shared `runServe()` read-back (#12525), three spawners taught to check
 * locally (#12526), and a security probe (#12548). Every one of them
 * re-derives, by hand and by parsing the banner, a fact `serve.ts` holds for
 * free at the moment it shifts: the requested port and the bound port, in one
 * scope. And the banner is a lossy place to re-derive it from — `runServe()`'s
 * read-back carries an `unreadable` state precisely because the `API:` row
 * shows an `OS_AUTH_URL` / `BETTER_AUTH_URL` / `OS_BASE_URL` origin when one is
 * set, which is not what the process bound at all. The producer has no such
 * gap. This file pins it finally saying so.
 *
 * ⚠️ The cost of the silence is measured rather than supposed: a harness asks
 * for a port, silently gets another, and then talks to whatever holds the one
 * it asked for. The positive case below reproduces exactly that — with a real
 * HTTP neighbour, and it asserts the stranger answering as well as the notice.
 *
 * ## CHANNEL — the sharpest constraint here, and not a free choice
 *
 * `stdout` is the JSON-RPC channel whenever the stdio MCP transport is mounted
 * (#7915): one non-frame line there reaches a conforming client as a transport
 * error, which is what `serve-stdio-stdout-purity.e2e.test.ts` exists to pin.
 * So the notice goes to **stderr**, through `serve.ts`'s own `printDiagnostic`
 * — the same helper, stream and boot position as the production-mode refusal
 * that is this notice's counterpart under the other half of the same policy.
 *
 * This file proves the half it can reach on its own: under a real drift the
 * notice is on stderr and the child's stdout carries nothing at all. The other
 * half is that `serve-stdio-stdout-purity.e2e.test.ts` still passes unchanged,
 * which is a different boot shape and stays in its own file.
 *
 * ## Why this file spawns instead of calling `runServe()`
 *
 * `runServe()` REJECTS a drifted boot — that is #12525's read-back doing its
 * job. Routing the positive case through it would make the very condition under
 * test unreachable. So this file owns its spawn, while still taking the
 * entrypoint, the child environment and the free-port draw from the shared
 * helper rather than re-deriving them.
 *
 * ⚠️ The one instrument it does own is the HTTP neighbour. `holdPort()` in the
 * shared helper binds a bare TCP socket, which is enough to make a port
 * unbindable but cannot ANSWER — and "something else answered where you were
 * pointed" is the specific harm this card was filed about. The surface ruling
 * on this card keeps `helpers/serve-process.ts` out of the diff, so the
 * neighbour lives here, named as a deliberate second instrument rather than a
 * blind duplicate of the draw.
 *
 * ## The negative half is not optional
 *
 * ⭐ A drift notice that appears when there is no drift is worse than silence:
 * it trains readers to skip the line, and then the one boot that really did
 * shift reads like every other. The SAME regex is asserted present in the
 * drifted boot and absent in the clean one, so neither case can pass by the
 * regex having quietly stopped matching anything at all.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CLI, TSX, E2E_SECRET_KEY, childEnv, randomPort } from './helpers/serve-process.js';

/**
 * The notice, as ONE regex shared by both cases.
 *
 * Deliberately loose about decoration and exact about the two numbers: what is
 * pinned is that a reader gets the requested port AND the bound port out of a
 * single line, without holding a second one beside it to compare against.
 */
const DRIFT_NOTICE = /Port (\d+) is in use — serving on (\d+) instead\./;

/** The banner's last line — the marker that the WHOLE banner is in the buffer. */
const BANNER_TAIL = /Press Ctrl\+C to stop/;

/** The platform with no application — the cheapest fixture that still boots. */
const BARE_CONFIG = 'export default {};\n';

let dir: string;
const children: ChildProcessWithoutNullStreams[] = [];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-port-drift-notice-'));
  writeFileSync(join(dir, 'objectstack.config.ts'), BARE_CONFIG, 'utf8');
});

afterAll(() => {
  for (const child of children) {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/**
 * A real HTTP neighbour on a real port — the card's own instrument, and the
 * reason it must not be simulated. The point is not merely that the port cannot
 * be bound; it is that something ELSE answers there while `os serve` is happily
 * bound somewhere the caller was never told about.
 */
function realNeighbour(): Promise<{ port: number; release: () => Promise<void> }> {
  return new Promise((resolveHold, rejectHold) => {
    const server: Server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ iAm: 'A NEIGHBOURING AGENT DEV SERVER, not os serve' }));
    });
    server.on('error', rejectHold);
    server.listen(0, '0.0.0.0', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        rejectHold(new Error(`listen(0) produced no numeric address: ${String(address)}`));
        return;
      }
      resolveHold({
        port: address.port,
        release: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

interface Booted {
  stdout: string;
  stderr: string;
  child: ChildProcessWithoutNullStreams;
  reachedBanner: boolean;
}

/**
 * Boot `os serve` on `port` and collect BOTH streams until the banner's last
 * line lands — or the child dies, or the clock runs out. A boot that never got
 * there resolves with `reachedBanner: false` rather than throwing, so the
 * caller's failure message can show what it printed on the way down.
 */
function boot(port: number | string, timeoutMs = 180_000): Promise<Booted> {
  return new Promise((resolveBoot) => {
    const child = spawn(TSX, [CLI, 'serve', 'objectstack.config.ts', '--port', String(port)], {
      cwd: dir,
      // The shared child environment, never a bare `...process.env` (#11267).
      //
      // `NODE_ENV` is declared here rather than left to the entrypoint even
      // though `bin/run-dev.js` pins the same value before argv is parsed: the
      // branch under test is `flags.dev || NODE_ENV === 'development'`, so the
      // reason these boots can drift at all belongs AT the spawn where a reader
      // can see it, not two files away. Silence would also inherit the vitest
      // worker's `NODE_ENV=test`, which `childEnv()` deliberately does not
      // strip.
      env: childEnv({
        NODE_ENV: 'development',
        NO_COLOR: '1',
        OS_DATABASE_URL: ':memory:',
        OS_LOG_LEVEL: '',
        OS_DISABLE_CONSOLE: '1',
        OS_SECRET_KEY: E2E_SECRET_KEY,
      }),
    });
    children.push(child);

    let stdout = '';
    let stderr = '';
    let settled = false;
    const done = (reachedBanner: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveBoot({ stdout, stderr, child, reachedBanner });
    };

    const timer = setTimeout(() => done(false), timeoutMs);
    // Key on the banner's LAST line so no assertion can read a boot that has
    // printed only half of it.
    const check = () => {
      if (BANNER_TAIL.test(stdout + stderr)) done(true);
    };
    child.stdout.on('data', (d) => {
      stdout += String(d);
      check();
    });
    child.stderr.on('data', (d) => {
      stderr += String(d);
      check();
    });
    child.on('exit', () => done(false));
  });
}

/** The port the banner says was actually bound, read out of its `API:` row. */
function boundPort(output: string): string | undefined {
  const apiRow = output.match(/^[^\n]*\bAPI:[^\n]*$/m);
  return apiRow ? (apiRow[0].match(/localhost:(\d+)/) ?? [])[1] : undefined;
}

describe('#12543: a shifted port announces itself, naming both numbers', () => {
  it('POSITIVE — a really-held port produces a notice carrying REQUESTED and BOUND', async () => {
    const neighbour = await realNeighbour();
    try {
      const booted = await boot(neighbour.port);
      const { stdout, stderr } = booted;
      const seen = `\n--- stdout ---\n${stdout.slice(0, 2000)}\n--- stderr (tail) ---\n${stderr.slice(-3000)}`;

      expect(booted.reachedBanner, `the boot never reached its banner${seen}`).toBe(true);

      // The drift really happened. Without this, every assertion below could
      // pass on a boot that never shifted at all.
      const bound = boundPort(stderr);
      expect(bound, `no API row in the banner to read a bound port from${seen}`).toBeDefined();
      expect(
        Number(bound),
        `the child bound the port it was asked for — there is no drift to announce${seen}`,
      ).not.toBe(neighbour.port);

      // ── The pin ──────────────────────────────────────────────────────
      const match = stderr.match(DRIFT_NOTICE);
      expect(match, `no drift notice on stderr for a boot that DID drift${seen}`).not.toBeNull();
      // Both numbers, in that one line. The reader's two questions are "from
      // what" and "to what", and a line answering only the second is the
      // banner — which is what five consumer PRs already had to parse.
      expect(match![1], `the notice does not name the REQUESTED port${seen}`).toBe(String(neighbour.port));
      expect(match![2], `the notice does not name the BOUND port${seen}`).toBe(String(bound));

      // ── The channel ──────────────────────────────────────────────────
      // stdout is the JSON-RPC channel when the stdio transport is mounted
      // (#7915), so the notice must not be there — and under `os serve`
      // nothing else may be either.
      expect(stdout, `the drifted boot put bytes on stdout${seen}`).toBe('');

      // ── The cost the notice exists to make visible ────────────────────
      // The port the caller asked for is still answered by the stranger. This
      // is the false-green generator the card measured, re-derived here so the
      // notice is pinned against a real one rather than a described one.
      const answer = await fetch(`http://localhost:${neighbour.port}/api/v1/auth/sign-in/email`, {
        method: 'POST',
      }).then((r) => r.text());
      expect(answer, 'the held port was not answered by the neighbour').toContain(
        'A NEIGHBOURING AGENT DEV SERVER, not os serve',
      );

      booted.child.kill('SIGKILL');
    } finally {
      await neighbour.release();
    }
  }, 240_000);

  it('NEGATIVE — an ordinary boot on a free port says nothing about ports', async () => {
    const booted = await boot(randomPort());
    const { stderr } = booted;
    const seen = `\n--- stderr (tail) ---\n${stderr.slice(-3000)}`;

    expect(booted.reachedBanner, `the boot never reached its banner${seen}`).toBe(true);
    expect(stderr, `the banner is missing, so "no notice" would prove nothing${seen}`).toContain(
      'Server is ready',
    );

    // ⭐ The whole value of the notice is that it is rare. The same regex the
    // positive case just matched must find nothing here.
    expect(stderr, `a drift notice appeared on a boot that never drifted${seen}`).not.toMatch(
      DRIFT_NOTICE,
    );

    booted.child.kill('SIGKILL');
  }, 240_000);
});
