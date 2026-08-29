// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12525 — the pin for the e2e harness reading back the port its child ACTUALLY
 * bound.
 *
 * ## The defect this covers is a GREEN one, and that is why it needed a file
 *
 * #12441 (the sibling this grew beside) fixed a RED suite that was not
 * reproducible. This one fixes a green that is wrong, which is the more
 * expensive direction because it does not announce itself.
 *
 * `runServe()` spawns through `bin/run-dev.js`, which pins
 * `process.env.NODE_ENV = 'development'` before argv is parsed. So
 * `serve.ts`'s `portAutoShiftAllowed` is TRUE for every child that helper
 * spawns, and a taken port is not an error there at all: `getAvailablePort()`
 * walks to the next free one and the boot SUCCEEDS. The harness then returns
 * that boot's output as a normal, passing run — while the port it asked for is
 * still held by whatever took it. On the container this fleet develops in, that
 * is plausibly a neighbouring agent's dev server, and anything a test does
 * against the requested port is talking to a stranger.
 *
 * ⛔ Not an argument to make `os serve` stricter. Auto-shifting in development
 * is correct and deliberate (#11113 pins the production half for its own
 * reasons); the defect was that the harness could not tell the difference.
 *
 * ## What is actually load-bearing here
 *
 * A read-back that has never been observed FAILING is decoration — the same
 * criticism `serve-port-bind-probe.test.ts` makes of a bind probe that cannot
 * answer NO. So the centre of this file is the forced drift below: a real
 * `os serve` child, a really-held port, and the harness rejecting rather than
 * proceeding. Everything above it is the cheap half — the parser's states, and
 * the anti-vacuity pins that keep the parse honest about a banner it does not
 * own.
 *
 * ## Cost, stated rather than hidden
 *
 * TWO real boots (this package's measured tsx-entry spawn floor is 6.5s each,
 * plus a kernel boot). The second one — the positive control — is bought
 * deliberately: without it, a `boundPortFromBanner()` that stopped matching the
 * REAL banner would leave the forced drift below still red-for-the-wrong-reason
 * (an `unreadable` verdict reads a lot like a drift verdict at a glance) and
 * this file would report a working instrument either way. The five existing
 * `runServe()` files are a control too, but only for someone running the whole
 * directory; this pair answers on its own.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  boundPortFromBanner,
  holdPort,
  portDriftError,
  randomPort,
  runServe,
} from './helpers/serve-process.js';

/** Seeded from `import.meta.url`, the spelling `check:cross-package-test-inputs` recognises. */
const HERE = resolve(fileURLToPath(import.meta.url), '..');

/**
 * The platform with no application — the cheapest fixture that still reaches
 * the ready banner, which is the only thing this file needs a boot for.
 */
const BARE_CONFIG = `
export default {};
`;

/** A healthy banner, in the shape `printServerReady` prints it under NO_COLOR. */
function bannerFor(port: number, apiRow = `  ➜  API:       http://localhost:${port}/`): string {
  return [
    '',
    '  ✓ Server is ready',
    '',
    apiRow,
    '',
    '  Mode:    development',
    '  Plugins: 3 loaded',
    '',
    '  Press Ctrl+C to stop',
    '',
  ].join('\n');
}

let bareDir: string;

beforeAll(() => {
  bareDir = mkdtempSync(join(tmpdir(), 'os-port-readback-'));
  writeFileSync(join(bareDir, 'objectstack.config.ts'), BARE_CONFIG, 'utf8');
});

afterAll(() => {
  if (bareDir) rmSync(bareDir, { recursive: true, force: true });
});

describe('#12525: the child\'s REAL port is read back out of its own banner', () => {
  it('reads the bound port out of a complete banner', () => {
    expect(boundPortFromBanner(bannerFor(41234))).toEqual({ state: 'bound', port: 41234 });
  });

  it('is silent when the child bound the port it was asked for', () => {
    expect(portDriftError(bannerFor(41234), 'os serve', 41234)).toBeNull();
    expect(portDriftError(bannerFor(41234), 'os serve', '41234')).toBeNull();
  });

  it('FAILS LOUDLY when the child bound a different port, naming BOTH', () => {
    const error = portDriftError(bannerFor(41235), 'os serve', 41234);
    expect(error).not.toBeNull();
    expect(error?.message).toContain('PORT DRIFT');
    // Both numbers, because the reader's first question is "off by how much,
    // and from what" — and because the requested one is the port anything
    // downstream would have talked to.
    expect(error?.message).toContain('41234');
    expect(error?.message).toContain('41235');
    // ⛔ And it must not read as a verdict about the code under test.
    expect(error?.message).toContain('HOST race');
  });

  it('is not fooled by an `API:` line printed EARLIER in the boot', () => {
    // The buffer `runServe()` hands over is the whole run, boot log included.
    // A line-shaped match over all of it would answer on the first `API:` it
    // met — which is not the banner's, and is not about a port at all.
    const noisyBoot = [
      '[kernel] mounting REST API: /api/v1',
      '[kernel] http://localhost:9999/ is not a port this boot bound',
      bannerFor(41234),
    ].join('\n');
    expect(boundPortFromBanner(noisyBoot)).toEqual({ state: 'bound', port: 41234 });
  });

  it('says nothing when the caller asked for no port at all', () => {
    // `runServe()` takes the port as an opaque argv element; a caller that
    // passed none has stated no expectation, so there is none to violate.
    expect(portDriftError(bannerFor(41234), 'os serve', undefined)).toBeNull();
  });

  describe('the two SILENCES, which are where a check like this rots', () => {
    it('stays silent for a boot that never printed a banner', () => {
      // The shape `serve-no-artifact.e2e.test.ts` drives on purpose: the child
      // refuses and exits, waiting on `/Nothing to serve/`. It announced no
      // bound port, so there is nothing to compare — and a verdict here would
      // re-label every failed boot in this directory a port problem.
      const refusal = [
        '  ✗ Nothing to serve',
        '     config:   /tmp/os-nothing-to-serve-x/objectstack.config.ts',
        '     artifact: dist/objectstack.json',
      ].join('\n');
      expect(boundPortFromBanner(refusal)).toEqual({ state: 'no-banner' });
      expect(portDriftError(refusal, 'os serve', 41234)).toBeNull();
      expect(portDriftError('', 'os serve', 41234)).toBeNull();
    });

    it('stays silent for a banner captured MID-PRINT, rather than guessing', () => {
      // ⭐ The determinism rule. The read-back keys on the banner's LAST line,
      // not its first, because stderr writes are ordered: if the tail is in the
      // buffer then the `API:` row is too, full stop. A head-keyed check would
      // be blind or not depending on how the pipe happened to chunk — and a
      // check that goes blind at random is worse than none, because its silence
      // reads as a pass.
      const midPrint = ['', '  ✓ Server is ready', ''].join('\n');
      expect(boundPortFromBanner(midPrint)).toEqual({ state: 'no-banner' });
    });
  });

  describe('an UNREADABLE banner is an error, not a shrug', () => {
    // A skip here would restore exactly the failure this file removes: the
    // harness looks, finds nothing, and hands back a green.
    it('refuses when the API row names an external origin (OS_AUTH_URL et al.)', () => {
      const external = bannerFor(41234, '  ➜  API:       https://app.example.com/');
      expect(boundPortFromBanner(external)).toEqual({
        state: 'unreadable',
        apiRow: '➜  API:       https://app.example.com/',
      });
      const error = portDriftError(external, 'os serve', 41234);
      expect(error?.message).toContain('CANNOT READ BACK THE BOUND PORT');
      // The message has to name the variables that cause it, or the reader is
      // left staring at a banner that looks perfectly healthy.
      expect(error?.message).toContain('OS_AUTH_URL');
      expect(error?.message).toContain('OS_BASE_URL');
    });

    it('refuses when the base URL was unusable and the banner printed paths only', () => {
      const pathsOnly = bannerFor(41234, '  ➜  API:       /');
      expect(boundPortFromBanner(pathsOnly).state).toBe('unreadable');
      expect(portDriftError(pathsOnly, 'os serve', 41234)).not.toBeNull();
    });
  });

  describe('ANTI-VACUITY: the parse is held against the LIVE banner, not a copy', () => {
    // ⚠️ `bannerFor()` above is a transcript, and a transcript cannot notice
    // that the source it was copied from has been reworded. The day
    // `printServerReady` renames its row or drops its tail, every assertion
    // above stays green while `boundPortFromBanner()` returns `no-banner`
    // forever — which is a SILENT SKIP on every real boot, i.e. the exact false
    // green this card is about, restored with nothing red to show for it.
    const formatSource = () => readFileSync(resolve(HERE, '../src/utils/format.ts'), 'utf8');

    it('printServerReady still prints an `API:` row and still ends with the tail', () => {
      const source = formatSource();
      const apiAt = source.indexOf('API:');
      const tailAt = source.indexOf('Press Ctrl+C to stop');

      expect(
        apiAt,
        'printServerReady no longer prints an `API:` row — boundPortFromBanner() in '
        + 'test/helpers/serve-process.ts reads the bound port out of it and now sees nothing',
      ).toBeGreaterThan(-1);
      expect(
        tailAt,
        'printServerReady no longer prints `Press Ctrl+C to stop` — that line is the marker '
        + 'boundPortFromBanner() uses to know the whole banner has arrived',
      ).toBeGreaterThan(-1);

      // ⭐ And the ORDER, which is the assumption the determinism rests on: the
      // tail can only prove the API row arrived if the API row is printed first.
      expect(
        apiAt,
        'the `API:` row is no longer printed BEFORE the banner tail — keying the read-back '
        + 'on the tail no longer proves the row is in the buffer',
      ).toBeLessThan(tailAt);
    });

    it('serve.ts still builds that row from the BOUND port, not the requested one', () => {
      // ⭐ The load-bearing premise of the whole read-back. `requestedPort` is
      // what the harness asked for; `boundPort` is what the transport reports
      // it BOUND. If the banner were ever built from the former, this check
      // could never disagree with the harness and would be a phantom — green
      // on every run, including the drifted ones.
      //
      // ⚠️ It used to read `resolveAuthBaseUrl(port)`, and `port` is only
      // ALMOST the bound one: `getAvailablePort()` reassigns it past a dev
      // auto-shift, which is the case this file drives, but it is still the
      // number that was REQUESTED and it stays 0 under `--port 0` (#13062).
      // The banner now reads the transport's own answer, so the premise below
      // is the stronger one it was always meant to be.
      const serveSource = readFileSync(resolve(HERE, '../src/commands/serve.ts'), 'utf8');
      expect(serveSource).toContain('port = await getAvailablePort(requestedPort)');
      expect(
        serveSource,
        'the ready banner no longer derives its API row from `resolveAuthBaseUrl(boundPort)` — '
        + 'if it now uses the REQUESTED port, the #12525 read-back is vacuous by construction',
      ).toContain('externalBaseOrigin: resolveAuthBaseUrl(boundPort).baseOrigin');
      expect(
        serveSource,
        'the bound port is no longer resolved off the transport — `boundPort` is what the '
        + 'banner, the IPC message and runtime.<env>.json all publish (#13062)',
      ).toContain('const boundPort = resolveBoundPort(kernel, port)');
    });
  });

  it(
    'POSITIVE CONTROL: a real boot on a free port reads back as exactly that port',
    async () => {
      const port = randomPort();
      const { stdout, stderr } = await runServe(bareDir, ['--port', port], {
        waitFor: /Press Ctrl\+C to stop/,
        timeoutMs: 240_000,
      });
      // The run RESOLVING is already half the assertion — `runServe()` rejects
      // on a drift now, so reaching this line means the check did not fire.
      expect(boundPortFromBanner(stdout + stderr)).toEqual({ state: 'bound', port: Number(port) });
    },
    240_000,
  );

  it(
    'THE LOAD-BEARING ARM: a child that drifts off a HELD port is REJECTED, not returned',
    async () => {
      // Hold the port for real, so `serve`'s own `isPortAvailable()` says no and
      // its dev-mode `getAvailablePort()` walks off it. ⛔ Nothing is simulated
      // here: this is the lost race, produced.
      const held = await holdPort();
      try {
        const run = runServe(bareDir, ['--port', String(held.port)], {
          waitFor: /Press Ctrl\+C to stop/,
          timeoutMs: 240_000,
        });

        // ⭐ Rejects. Before this change the same run RESOLVED, with a healthy
        // banner for a server on a port nobody in the test knew about.
        await expect(run).rejects.toThrow(/PORT DRIFT/);

        const message = await run.then(
          () => 'the run RESOLVED — the harness accepted a drifted boot',
          (error: Error) => error.message,
        );
        const bound = /child BOUND port (\d+)/.exec(message);
        expect(
          bound,
          `the rejection did not name the port the child actually bound:\n${message}`,
        ).not.toBeNull();
        // The whole point: the number the child bound is NOT the number the
        // harness asked for, and the harness now knows it.
        expect(Number(bound?.[1])).not.toBe(held.port);
        expect(message).toContain(String(held.port));
      } finally {
        await held.release();
      }
    },
    240_000,
  );
});
