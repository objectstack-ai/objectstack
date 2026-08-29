// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os start` serves the port it prints — end to end, on a real boot (#12992).
 *
 * ## Why this one has to be a real child process
 *
 * The defect was not inside either process. `start` resolved the port one way
 * for its banner and handed the child a value on a channel the child resolved
 * the OTHER way, and each half was self-consistent: a unit test of the parent
 * saw a banner matching the flag, a unit test of the child saw a child honouring
 * its own documented precedence. Only a boot that prints and then binds can see
 * them disagree. Measured on `origin/main` before the repair:
 *
 * ```
 *   OS_PORT=41077 os start --port 41078
 *     banner:            🖥️ Console: http://localhost:41078/_console/
 *     curl answers on:   41077
 * ```
 *
 * ## What is asserted, and why it is not "the banner names the flag"
 *
 * The contract is AGREEMENT, not a particular number: every address `os start`
 * prints names the port the server actually bound. So the bound port is read
 * back out of the child's own ready banner (`boundPortFromBanner`, #12525) —
 * never assumed from what this harness passed in, which is exactly the value a
 * drift makes wrong — and the full output is then required to contain no other
 * address at all. That phrasing survives causes this card never touched,
 * including the #12543 auto-shift.
 *
 * ## ⚠️ Instrument: `OS_PORT` CONTAINS `PORT`, and absence needs a control
 *
 * The ports are compared as NUMBERS parsed out of `http://localhost:<n>`, never
 * by substring — `serve-port-validation.test.ts:111` records what a bare
 * containment assertion does to this pair of names. And the "the losing port
 * appears nowhere" assertion is paired with a positive control run through the
 * SAME regex on the SAME captured text, so an empty result means the port is
 * absent rather than that the probe never worked.
 *
 * ## ⛔ Why no leg passes `--no-ui`
 *
 * The row this card deleted was gated on `flags.ui`, so every assertion below
 * would be blind to its return under `--no-ui` — measured: with the row put
 * back, a `--no-ui` run of this whole file stayed GREEN and only the
 * structural pin caught it. The legs therefore run the DEFAULT surface, which
 * is both the operator's path and the only one where a parent-side prediction
 * is observable.
 *
 * ## Spawn shape
 *
 * `bin/run.js` with `NODE_ENV` unset, deliberately (hence
 * `requireBuiltCli`): that is the entrypoint an operator runs, and it is what
 * lets `start` apply its own `NODE_ENV=production` default to the child — which
 * closes `serve`'s auto-shift branch and makes the bind deterministic. A
 * `bin/run-dev.js` child would pin `NODE_ENV=development`, re-open auto-shift,
 * and turn a busy-port race on this shared container into a flake.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  childEnv,
  boundPortFromBanner,
  requireBuiltCli,
  reservePort,
  holdPort,
  TSX,
  RUN_JS_RESOLVES_FROM_DIST,
} from './helpers/serve-process.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN_JS = resolve(HERE, '../bin/run.js');
const RUN_DEV_JS = resolve(HERE, '../bin/run-dev.js');

/** The banner tail `printServerReady` ends with — the boot is fully printed. */
const BANNER_TAIL = /Press Ctrl\+C to stop/;

const BOOT_TIMEOUT_MS = 180_000;

// ESC spelled as a char code, never written as a raw control byte in source —
// the same construction `helpers/serve-process.ts` uses for its own stripper.
const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const stripAnsi = (text: string): string => text.replace(ANSI_SGR, '');

/** Every `http://localhost:<port>` address in some output, as numbers. */
const addressesIn = (output: string): number[] =>
  [...stripAnsi(output).matchAll(/http:\/\/localhost:(\d+)\b/g)].map((m) => Number(m[1]));

/**
 * ⛔ Kill the process GROUP, never the child alone.
 *
 * `os start` is a supervisor: it spawns `os serve` as a SEPARATE process and
 * then waits. Signalling only the `start` pid leaves that grandchild running —
 * it is reparented to init, keeps its port, and keeps its ~450 MB resident.
 * MEASURED while writing this file: repeated runs accumulated 13 orphaned
 * `serve` processes, took the container to 14.4 GB of 16 GB and load 29, and
 * the next run of this very suite then failed by TIMEOUT rather than by any
 * assertion — a false red that says nothing about the code under test.
 *
 * `detached: true` gives the child its own process group; a negative pid
 * signals that whole group, supervisor and server together.
 */
const killTree = (child: ChildProcess | undefined, signal: NodeJS.Signals): void => {
  if (child?.pid === undefined) return;
  try { process.kill(-child.pid, signal); } catch { /* group already gone */ }
};

let running: ChildProcess | undefined;
let workdir: string | undefined;

afterEach(() => {
  killTree(running, 'SIGKILL');
  running = undefined;
  if (workdir) rmSync(workdir, { recursive: true, force: true });
  workdir = undefined;
});

/** Boot a real `os start` and capture everything it printed. */
function bootStart(
  env: Record<string, string | undefined>,
  args: string[],
  entry: { exec: string; argv: string[] } = { exec: process.execPath, argv: [RUN_JS] },
): Promise<string> {
  workdir = mkdtempSync(join(tmpdir(), 'os-start-port-'));
  const home = join(workdir, 'home');

  return new Promise((resolveBoot, rejectBoot) => {
    const child = spawn(entry.exec, [...entry.argv, 'start', ...args], {
      cwd: workdir,
      // `childEnv`, never a bare `...process.env` — see its header (#11267).
      // `NODE_ENV: undefined` is required by the built entrypoint (#11464):
      // `development`/`test` sends oclif's command lookup back to `src/`.
      env: childEnv({
        NODE_ENV: undefined,
        NO_COLOR: '1',
        OS_HOME: home,
        OS_LOG_LEVEL: 'error',
        ...env,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group, so `killTree` can reach the `serve` grandchild.
      detached: true,
    });
    running = child;

    let output = '';
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killTree(child, 'SIGTERM');
      if (err) rejectBoot(err); else resolveBoot(output);
    };

    const timer = setTimeout(
      () => finish(new Error(`os start never printed a complete banner.\n--- output ---\n${output}`)),
      BOOT_TIMEOUT_MS,
    );

    const onData = (d: unknown) => {
      output += String(d);
      if (BANNER_TAIL.test(stripAnsi(output))) finish();
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (err) => finish(err));
    child.on('exit', (code) => finish(
      BANNER_TAIL.test(stripAnsi(output))
        ? undefined
        : new Error(`os start exited ${code} before its banner.\n--- output ---\n${output}`),
    ));
  });
}

describe('`os start` — every address it prints is the port it bound', () => {
  beforeAll(() => {
    requireBuiltCli(RUN_JS_RESOLVES_FROM_DIST);
  });

  it(
    'an explicit --port beats an inherited $OS_PORT, and the banner agrees',
    async () => {
      // Two DIFFERENT free ports: the one the operator exported, and the one
      // they typed. The defect is only visible when they disagree.
      const envPort = reservePort();
      let flagPort = reservePort();
      if (flagPort === envPort) flagPort = reservePort();
      expect(flagPort).not.toBe(envPort);

      const output = await bootStart(
        { OS_PORT: String(envPort) },
        ['--port', String(flagPort)],
      );

      // ── The bound port, read out of the CHILD's own banner ─────────────
      const readback = boundPortFromBanner(output);
      expect(readback.state, `banner unreadable.\n--- output ---\n${output}`).toBe('bound');
      // The explicit flag wins over the inherited environment variable, which
      // is what `--port`'s help text ("overrides $PORT") has always promised.
      expect(readback).toEqual({ state: 'bound', port: flagPort });

      // ── …and NOTHING printed names the losing port ─────────────────────
      const printed = addressesIn(output);
      // ⭐ POSITIVE CONTROL: the same probe, over the same captured text, does
      // find the bound port. Without this the assertion below would pass on an
      // empty capture, a child that printed nothing, or a broken regex.
      expect(printed, `no localhost address at all in:\n${output}`).toContain(flagPort);
      expect(
        printed.filter((p) => p !== flagPort),
        'os start printed an address it is not serving — the banner and the bind '
        + `disagreed again.\n--- output ---\n${output}`,
      ).toEqual([]);
    },
    BOOT_TIMEOUT_MS + 30_000,
  );

  it(
    'with no --port, an inherited $OS_PORT is still honoured and still agrees',
    async () => {
      // The other half of the contract: the repair must not have made the flag
      // win by breaking the environment channel it is supposed to outrank.
      const envPort = reservePort();

      const output = await bootStart({ OS_PORT: String(envPort) }, []);

      expect(boundPortFromBanner(output)).toEqual({ state: 'bound', port: envPort });

      const printed = addressesIn(output);
      expect(printed, `no localhost address at all in:\n${output}`).toContain(envPort);
      expect(
        printed.filter((p) => p !== envPort),
        `os start printed an address it is not serving.\n--- output ---\n${output}`,
      ).toEqual([]);
    },
    BOOT_TIMEOUT_MS + 30_000,
  );

  it(
    'still agrees when the CHILD moves the port under it — the auto-shift case',
    async () => {
      // ⭐ The generalisation the ruling asked for. The two halves of this card
      // (the channel, the recomputed banner) are one instance of a wider
      // property: `start` must not answer "which port?" at all. This leg proves
      // the property under a cause this card never touched — #12543's
      // development auto-shift, where the port changes AFTER `start` has
      // handed it over and the child hops to the next free one.
      //
      // Any parent-side prediction is wrong here BY CONSTRUCTION, whatever
      // precedence it uses and however correct the forwarding channel is:
      // nothing in the parent can know the hop happened.
      //
      // `bin/run-dev.js` is the entrypoint, deliberately: it pins
      // `NODE_ENV=development`, which is what opens `serve`'s auto-shift branch
      // (`flags.dev || NODE_ENV === 'development'`). ⛔ Not `bin/run.js` with an
      // explicit `NODE_ENV=development` — that is the ts-path reroute
      // `check:cli-test-child-env` rule 3 refuses at a built-entrypoint spawn.
      const held = await holdPort();
      try {
        const output = await bootStart(
          {},
          ['--port', String(held.port)],
          { exec: TSX, argv: [RUN_DEV_JS] },
        );

        const readback = boundPortFromBanner(output);
        expect(readback.state, `banner unreadable.\n--- output ---\n${output}`).toBe('bound');
        const bound = (readback as { state: 'bound'; port: number }).port;

        // The port really did move — without this the leg would pass for the
        // trivial reason that nothing shifted, and would be measuring nothing.
        expect(
          bound,
          'the port did not shift, so this leg tested nothing: something freed '
          + `${held.port} before the child bound it.\n--- output ---\n${output}`,
        ).not.toBe(held.port);

        const printed = addressesIn(output);
        expect(printed, `no localhost address at all in:\n${output}`).toContain(bound);
        expect(
          printed.filter((p) => p !== bound),
          'os start printed the port it ASKED for, not the one the child bound. A '
          + 'parent-side prediction cannot survive the auto-shift — the address has '
          + `to come from the child.\n--- output ---\n${output}`,
        ).toEqual([]);
      } finally {
        await held.release();
      }
    },
    BOOT_TIMEOUT_MS + 30_000,
  );
});
