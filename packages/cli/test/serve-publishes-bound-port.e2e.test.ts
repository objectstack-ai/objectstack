// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13062 — the three channels `os serve` announces an address on all name the
 * port it BOUND, driven through a real boot.
 *
 * ## What is under test, and why one file covers all three
 *
 * The IPC message (`objectstack:listening`), the ready banner's `API:` row and
 * `runtime.<environment>.json` were three outputs of ONE number, and that
 * number was the port the operator ASKED for. ⛔ Repairing one of them and
 * leaving two is the failure the card names explicitly — the survivors are
 * harder to find afterwards, because the repaired one reads as the whole fix.
 * So all three are read out of the SAME boot here, and compared to each other
 * as well as to the socket.
 *
 * `--port 0` is the case where requested and bound can never coincide
 * (`utils/port-contract.ts`: `MIN_PORT = 0`, "a REQUEST, not an error"), so it
 * is the arm that goes red without the fix. The non-zero arms are the other
 * half of the criterion and the easier one to break in passing: every ordinary
 * boot must publish exactly what it published before.
 *
 * ## ⚠️ THE INSTRUMENT, AND ITS PROOF — the card demanded both
 *
 * The report this card was filed from could NOT confirm a bound port by
 * observing sockets: `ss` sees no sockets at all in this fleet's container,
 * verified there against a control server on a known port. ⇒ that instrument is
 * VOID here, which is a different thing from it answering "no". A conclusion
 * drawn from a void instrument is not a measurement.
 *
 * So this file uses a different one — a real client CONNECT — and proves it can
 * answer in both directions before it is believed, in `describe('the
 * instrument…')` below: it must reach a server this file starts on a port it
 * learned from `address()`, and it must be REFUSED on a port that was probed
 * free and left unbound. An instrument with only its positive arm shown is a
 * shape that always succeeds.
 *
 * ## Cost, stated rather than hidden
 *
 * THREE real boots, each a `tsx` spawn (this package's measured floor is ~6s)
 * plus a kernel boot. They buy the three arms of the acceptance criterion —
 * `--port 0`, a free non-zero port, and a port taken out from under the boot —
 * and none of them substitutes for another. The cheap half of the same
 * criterion (which variable each publish site reads, and the resolver's whole
 * fallback table) is `src/commands/serve-bound-port-publication.test.ts`, which
 * answers in milliseconds.
 *
 * ## ⚠️ Process-group cleanup, and why it is not decoration
 *
 * A neighbouring card's e2e round killed only the direct child and left 13
 * orphaned `serve` processes behind, which took the container to 14.4GB of
 * 16GB — and the run that followed failed on a TIMEOUT rather than an
 * assertion, i.e. a false red about the code under test. Every child here is
 * spawned `detached` and torn down by PROCESS GROUP, and each teardown is
 * verified by the same connect probe going back to REFUSED.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, connect, type Server } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CLI,
  TSX,
  boundPortFromBanner,
  childEnv,
  E2E_SECRET_KEY,
  holdPort,
  randomPort,
  reservePort,
} from './helpers/serve-process.js';

/** The platform with no application — the cheapest fixture that reaches a ready banner. */
const BARE_CONFIG = `
export default {};
`;

/**
 * `serve.ts`'s OWN default for the environment id (`OS_ENVIRONMENT_ID ??
 * 'env_local'`), which is what names the runtime state file. The variable is
 * UNSET for every child below rather than pinned to a value of this file's
 * own, so the name asserted here is the one a plain `os serve` writes.
 */
const RUNTIME_FILE = 'runtime.env_local.json';

/** How long a connect probe waits before calling a port unreachable. */
const CONNECT_TIMEOUT_MS = 2_000;

/**
 * ⭐ THE INSTRUMENT: can a client actually reach `port`?
 *
 * A TCP connect, not a socket table — see this file's header for why the
 * obvious instrument is void in this container. Resolves `true` on `connect`,
 * `false` on any error or timeout, and never throws, so a caller reads one
 * boolean rather than classifying errno.
 */
function reachable(port: number): Promise<boolean> {
  return new Promise((resolveProbe) => {
    let settled = false;
    const done = (answer: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveProbe(answer);
    };
    const socket = connect({ port, host: '127.0.0.1' });
    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
  });
}

interface Booted {
  /** The `objectstack:listening` message, or `null` if the child never sent one. */
  ipc: { type?: string; port?: unknown; url?: unknown } | null;
  stdout: string;
  stderr: string;
  /** Everything written under this child's `OS_HOME`. */
  home: string;
  stop: () => Promise<void>;
}

/**
 * Boot a real `os serve` with an IPC channel open, wait until it has BOTH
 * printed its banner tail and sent its listening message, and hand back all
 * three channels plus a teardown.
 *
 * The child is `detached` so it leads its own process group, and `stop()` kills
 * that GROUP: `tsx` runs the CLI in a grandchild, so signalling the direct
 * child alone is what leaves orphans behind (see the header).
 */
function bootServe(cwd: string, args: string[], home: string): Promise<Booted> {
  return new Promise((resolveBoot, rejectBoot) => {
    const child: ChildProcess = spawn(
      TSX,
      [CLI, 'serve', 'objectstack.config.ts', ...args],
      {
        cwd,
        detached: true,
        // fd 3 is the IPC channel `os dev` opens on this same child, and the
        // only way to read the `objectstack:listening` message at all.
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        // `childEnv`, never a bare `...process.env` — the runner's own
        // `TEST` / `VITEST` variables reach into a spawned boot's auth and
        // crypto posture otherwise (see the helper's header).
        env: childEnv({
          NO_COLOR: '1',
          OS_DATABASE_URL: ':memory:',
          OS_LOG_LEVEL: '',
          OS_DISABLE_CONSOLE: '1',
          OS_SECRET_KEY: E2E_SECRET_KEY,
          // The state file this test reads, kept out of the runner's real
          // home directory and out of every other worker's way.
          OS_HOME: home,
          // UNSET, so the file name is the one a plain `os serve` writes.
          OS_ENVIRONMENT_ID: undefined,
          // UNSET: any of these replaces the banner's `http://localhost:<port>`
          // with an external origin, and the banner channel goes with it.
          OS_AUTH_URL: undefined,
          BETTER_AUTH_URL: undefined,
          OS_BASE_URL: undefined,
        }),
      },
    );

    let stdout = '';
    let stderr = '';
    let ipc: Booted['ipc'] = null;
    let settled = false;

    const stop = (): Promise<void> =>
      new Promise((done) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          done();
          return;
        }
        child.on('exit', () => done());
        try {
          // NEGATIVE pid = the whole process group. `tsx` runs the CLI in a
          // grandchild; killing `child.pid` alone leaves it running.
          process.kill(-(child.pid as number), 'SIGTERM');
        } catch {
          try { child.kill('SIGTERM'); } catch { /* already gone */ }
          done();
        }
      });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void stop().then(() =>
        rejectBoot(new Error(
          'serve never reported both a banner and a listening message.\n'
          + `--- ipc ---\n${JSON.stringify(ipc)}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
        )),
      );
    }, 220_000);

    const settle = () => {
      if (settled) return;
      // BOTH, deliberately: the banner tail proves the whole banner is in the
      // buffer (writes to one stream are ordered), and the message proves the
      // IPC channel spoke. Waiting on one and reading the other is how a green
      // gets returned for a channel that never answered.
      if (ipc === null || !/Press Ctrl\+C to stop/.test(stdout + stderr)) return;
      settled = true;
      clearTimeout(timer);
      resolveBoot({ ipc, stdout, stderr, home, stop });
    };

    child.stdout?.on('data', (d) => { stdout += String(d); settle(); });
    child.stderr?.on('data', (d) => { stderr += String(d); settle(); });
    child.on('message', (msg: any) => {
      if (msg?.type === 'objectstack:listening') { ipc = msg; settle(); }
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectBoot(err);
    });
    child.on('exit', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectBoot(new Error(
        `serve exited before announcing a port.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
      ));
    });
  });
}

/** The three channels, read out of one boot. */
function channelsOf(booted: Booted): { ipc: unknown; banner: unknown; runtimeFile: unknown } {
  const banner = boundPortFromBanner(booted.stdout + booted.stderr);
  const state = JSON.parse(readFileSync(join(booted.home, RUNTIME_FILE), 'utf8'));
  return {
    ipc: booted.ipc?.port,
    banner: banner.state === 'bound' ? banner.port : banner,
    runtimeFile: state.port,
  };
}

let bareDir: string;
const homes: string[] = [];

const newHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'os-bound-port-home-'));
  homes.push(home);
  return home;
};

beforeAll(() => {
  bareDir = mkdtempSync(join(tmpdir(), 'os-bound-port-'));
  writeFileSync(join(bareDir, 'objectstack.config.ts'), BARE_CONFIG, 'utf8');
});

afterAll(() => {
  if (bareDir) rmSync(bareDir, { recursive: true, force: true });
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

describe('the instrument, before anything is concluded with it', () => {
  let control: Server;
  let controlPort: number;

  beforeAll(async () => {
    control = createServer();
    await new Promise<void>((ready) => control.listen(0, '127.0.0.1', () => ready()));
    const address = control.address();
    if (address === null || typeof address === 'string') throw new Error('listen(0) gave no numeric address');
    // ⭐ `server.address()` in-process: the same reading `serve` now publishes,
    // demonstrated here on a server this file owns.
    controlPort = address.port;
  });

  afterAll(async () => {
    await new Promise<void>((closed) => control.close(() => closed()));
  });

  it('POSITIVE ARM: reaches a server this file started, on the port `address()` reported', async () => {
    expect(controlPort).toBeGreaterThan(0);
    expect(await reachable(controlPort)).toBe(true);
  });

  it('NEGATIVE ARM: is REFUSED on a port that was probed free and left unbound', async () => {
    // Without this, `reachable()` could be a function that always says yes and
    // every conclusion below would be vacuous.
    expect(await reachable(reservePort())).toBe(false);
  });

  it('and it reports the control port UNREACHABLE once the control server closes', async () => {
    const doomed = createServer();
    await new Promise<void>((ready) => doomed.listen(0, '127.0.0.1', () => ready()));
    const port = (doomed.address() as { port: number }).port;
    expect(await reachable(port)).toBe(true);
    await new Promise<void>((closed) => doomed.close(() => closed()));
    expect(await reachable(port)).toBe(false);
  });
});

describe('#13062 `os serve --port 0` — the request that can never be the answer', () => {
  it(
    'announces the BOUND port on all three channels, and it is really listening',
    async () => {
      const booted = await bootServe(bareDir, ['--port', '0'], newHome());
      let announced = -1;
      try {
        const { ipc, banner, runtimeFile } = channelsOf(booted);

        // ⭐ The defect, stated as the three readings it produced:
        // `{ port: 0 }`, `API: http://localhost:0/`, `"port": 0`.
        expect(ipc, 'the IPC message still announces the REQUESTED port').not.toBe(0);
        expect(banner, 'the ready banner still names http://localhost:0').not.toBe(0);
        expect(runtimeFile, 'runtime.env_local.json still records port 0').not.toBe(0);

        // One number, not three that happen to be non-zero.
        expect(banner).toBe(ipc);
        expect(runtimeFile).toBe(ipc);
        expect(Number.isInteger(ipc)).toBe(true);

        // …and the URL the IPC message carries agrees with its own port field,
        // since that string is what `os dev` prints and hands to an AI client.
        expect(booted.ipc?.url).toBe(`http://localhost:${ipc}`);

        // ⭐ THE MEASUREMENT the card asked for: the announced port is one a
        // client can actually reach. The instrument above proved it can answer
        // NO before this was allowed to mean YES.
        expect(await reachable(ipc as number)).toBe(true);
        announced = ipc as number;
      } finally {
        await booted.stop();
      }

      // ⚠️ Teardown really tore down — the same probe, the other way. This is
      // the orphan check too: `tsx` runs the CLI in a GRANDCHILD, so a teardown
      // that signalled only the direct child would leave a server still
      // answering here (13 such orphans took this container to 14.4GB once).
      expect(await reachable(announced)).toBe(false);
    },
    240_000,
  );
});

describe('#13062 the non-zero half — nothing an ordinary boot publishes may move', () => {
  it(
    'publishes exactly the port it was asked for when that port is free',
    async () => {
      const asked = Number(randomPort());
      const booted = await bootServe(bareDir, ['--port', String(asked)], newHome());
      try {
        const { ipc, banner, runtimeFile } = channelsOf(booted);
        // ⛔ Byte for byte what these channels published before this change:
        // requested and bound coincide here, and that is the whole population
        // of ordinary boots.
        expect(ipc).toBe(asked);
        expect(banner).toBe(asked);
        expect(runtimeFile).toBe(asked);
        expect(booted.ipc?.url).toBe(`http://localhost:${asked}`);
        expect(await reachable(asked)).toBe(true);
      } finally {
        await booted.stop();
      }
      // The child is gone, so the port it held is gone with it. This is the
      // orphan check as well: a surviving grandchild would still be listening.
      expect(await reachable(asked)).toBe(false);
    },
    240_000,
  );

  it(
    'follows the DEV AUTO-SHIFT onto the port it really took, on all three channels',
    async () => {
      // The second way requested and bound part company on this command, and
      // the one that is reachable without `--port 0`: the port is genuinely
      // held, so `serve`'s own `getAvailablePort()` walks off it. ⛔ Nothing is
      // simulated — this is the drift, produced.
      const held = await holdPort();
      let booted: Booted | undefined;
      try {
        booted = await bootServe(bareDir, ['--port', String(held.port)], newHome());
        const { ipc, banner, runtimeFile } = channelsOf(booted);

        expect(ipc, 'the boot announced the port it could not have bound').not.toBe(held.port);
        expect(banner).toBe(ipc);
        expect(runtimeFile).toBe(ipc);
        expect(await reachable(ipc as number)).toBe(true);
      } finally {
        if (booted) await booted.stop();
        await held.release();
      }
    },
    240_000,
  );
});
