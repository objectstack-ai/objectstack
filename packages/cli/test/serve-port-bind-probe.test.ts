// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12441 — the pin for the e2e port draw itself.
 *
 * ## What went wrong, and why the fix needed a pin of its own
 *
 * Every `os serve` e2e in this directory hands the child a port. That port used
 * to be drawn BLIND — `40000 + Math.random() * 20000` in the shared helper,
 * `41000 + Math.random() * 19000` in `serve-node-env-production-default`, and a
 * third inline copy in `serve-app-anchored-optional-import` — under a docblock
 * asserting that "a run never contends with another agent's dev server on this
 * host". Several agents share one container in this fleet, and a measured run
 * of the full CLI suite went `1 failed | 2101 passed` on:
 *
 *     ✗ Port 49402 is already in use.
 *        ObjectStack does not auto-select a different port in production mode
 *
 * clean on an isolated re-run. The unqualified negative in that comment is what
 * kept anyone from re-examining the draw; the replacement (`reservePort()`) is
 * careful to state its residual race instead.
 *
 * ## ⚠️ Why this file exists rather than trusting the mechanism
 *
 * A bind probe is an INSTRUMENT, and an instrument that cannot answer NO is not
 * one. `probeBind()` would still look healthy — draws succeed, ports come back,
 * every e2e stays green — if its bind silently never failed: it would report
 * "free" for a port something else is holding, and the whole guarantee
 * `reservePort()`'s docblock makes would be decoration. So the load-bearing
 * test here is the NEGATIVE arm, not the positive one.
 *
 * The second thing pinned is legibility, which is the half of #12441 that pays.
 * The residual TOCTOU window is real and `reservePort()` says so; what makes it
 * affordable is that losing it now fails saying "PORT CONTENTION on port N"
 * rather than `serve exited 1 before "Server is ready"` inside a file about
 * `NODE_ENV` defaulting.
 *
 * ## Why this file is not an `.e2e.` one
 *
 * It spawns nothing but `node -e` (the probe's own child, ~75 ms) and binds
 * loopback sockets in-process. No CLI, no fixture app, no `dist/` dependency.
 */

import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:net';

import { portContentionError, portIsFree, randomPort, reservePort } from './helpers/serve-process.js';

/** Bind `0.0.0.0:0` and KEEP it bound. Resolves with the port and its closer. */
function hold(): Promise<{ port: number; release: () => Promise<void> }> {
  return new Promise((resolveHold, rejectHold) => {
    const server: Server = createServer();
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

describe('#12441: the e2e serve port is bind-probed, and the probe can say NO', () => {
  it(
    'THE NEGATIVE ARM: portIsFree() answers NO for a port this test is holding, and YES once released',
    async () => {
      const held = await hold();

      // The load-bearing assertion of this whole file. If this ever goes green
      // the other way round, `reservePort()`'s guarantee is decoration: a probe
      // that cannot fail to bind reports every port free.
      expect(
        portIsFree(held.port),
        `the bind probe called held port ${held.port} FREE — it is not an instrument`,
      ).toBe(false);

      await held.release();
      // The positive control for the same call, so a probe that answers NO to
      // everything (a broken subprocess, a bad argv, a crash on startup) cannot
      // pass the assertion above by accident.
      expect(
        portIsFree(held.port),
        `the bind probe called released port ${held.port} BUSY — it answers NO unconditionally`,
      ).toBe(true);
    },
    60_000,
  );

  it(
    'reservePort() hands back a real, currently-bindable TCP port',
    () => {
      const port = reservePort();
      expect(Number.isInteger(port)).toBe(true);
      expect(port).toBeGreaterThan(1023);
      expect(port).toBeLessThan(65536);
      // Free at this instant — which is the ONLY thing the probe claims. ⛔ Not
      // "free when serve binds it": that gap is the residual race, stated in
      // `reservePort()`'s docblock and made legible by `portContentionError()`.
      //
      // ⚠️ Three independent draw→verify pairs, and the plurality IS the point
      // rather than a workaround: this assertion sits ON the residual window,
      // so one pair can legitimately lose it to a neighbour on this shared
      // container. Three in a row is not a race, it is a broken probe.
      expect(
        [port, reservePort(), reservePort()].some((p) => portIsFree(p)),
        'three consecutive bind-probed ports were all busy on verification',
      ).toBe(true);
    },
    60_000,
  );

  it(
    'reservePort() never draws a port that is already HELD — the shape the blind draw could not avoid',
    async () => {
      const holders = await Promise.all(Array.from({ length: 12 }, () => hold()));
      const heldPorts = new Set(holders.map((h) => h.port));
      try {
        const drawn = Array.from({ length: 12 }, () => reservePort());

        // The positive control FIRST, on its own input: prove this comparison
        // can detect an overlap at all. A `Set` membership test that silently
        // matches nothing — number-vs-string being the classic way — would make
        // the real assertion below pass on any input whatsoever.
        expect(
          [[...heldPorts][0]].filter((p) => heldPorts.has(p)),
          'the overlap check cannot detect a port that IS held — it proves nothing',
        ).toHaveLength(1);

        expect(
          drawn.filter((p) => heldPorts.has(p)),
          `a probed draw returned a port held by this test: drawn=${drawn.join(',')}`,
        ).toEqual([]);
      } finally {
        for (const holder of holders) await holder.release();
      }
    },
    120_000,
  );

  it(
    'randomPort() is reservePort() as a string — one draw, no second mechanism',
    () => {
      const port = randomPort();
      expect(port).toMatch(/^\d+$/);
      // Same three-pair shape and the same reason as above — this sits on the
      // residual window too.
      expect(
        [port, randomPort(), randomPort()].some((p) => portIsFree(p)),
        'three consecutive randomPort() draws were all busy on verification',
      ).toBe(true);
    },
    60_000,
  );
});

/**
 * The measured stderr from the run that filed #12441, verbatim (the harness
 * spawns with `NO_COLOR=1`, so `serve.ts`'s `chalk.red` wrapper is inert and
 * this is byte-for-byte what a contended boot writes).
 */
const MEASURED_CONTENTION = [
  '',
  '  ✗ Port 49402 is already in use.',
  '     ObjectStack does not auto-select a different port in production mode:',
  '     a drifted port silently breaks reverse-proxy, OAuth callback, and CORS config.',
  '     Free the port, or pick another via PORT=<port> (or --port <port>).',
].join('\n');

describe('#12441: a lost race fails LEGIBLY — naming port contention and the port', () => {
  it('names the contended port, read out of the CHILD\'s own diagnostic', () => {
    const error = portContentionError(MEASURED_CONTENTION, 'os serve', 49402);
    expect(error).not.toBeNull();
    expect(error?.message).toContain('PORT CONTENTION');
    // ⭐ The port. Without it the reader is back to guessing which of the
    // suite's parallel spawns lost, which is the round the card is paying for.
    expect(error?.message).toContain('49402');
  });

  it('reads the port from the diagnostic even when the harness passes none', () => {
    expect(portContentionError(MEASURED_CONTENTION, 'os serve')?.message).toContain('49402');
  });

  it('catches the raw kernel error too, not only serve.ts own wording', () => {
    const raw = 'Error: listen EADDRINUSE: address already in use 0.0.0.0:53119';
    expect(portContentionError(raw, 'os serve')?.message).toContain('53119');
  });

  it(
    'ABLATION-SHAPED CONTROL: stays null for a boot that died of something else',
    () => {
      // If this returned an Error, every unrelated boot failure in this
      // directory would be re-labelled a port race — a detector that always
      // fires is exactly as useless as one that never does, and it would bury
      // the real diagnostic under a message about ports.
      const unrelated = [
        'Cannot find package \'@objectstack/service-cluster\': the host app does not declare it.',
        '  host app: /tmp/os-anchored-neutral-cwd-xyz',
      ].join('\n');
      expect(portContentionError(unrelated, 'os serve')).toBeNull();
      expect(portContentionError('', 'os serve')).toBeNull();
    },
  );
});
