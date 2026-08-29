// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13193 / #13158 — the pin for the ORDER `os serve` publishes its bound port in.
 *
 * ## What broke, and why it read as a flake for a day
 *
 * `os serve` publishes the port it bound on three channels: the runtime state
 * file `runtime.<environment>.json`, the `objectstack:listening` IPC message,
 * and the ready banner. Two of those ANNOUNCE an address; the third is the FILE
 * a consumer then opens. `serve.ts` used to fire them banner → IPC → file, so
 * every consumer that believed an announcement raced a file that did not exist
 * yet.
 *
 * `serve-publishes-bound-port.e2e.test.ts` is an ordinary such consumer: it
 * waits for the banner AND the IPC message, then reads the file. It ejected 14
 * PRs from the shared merge queue in a rolling 24 hours — 10 independent hits —
 * always with the same reason line, never an assertion:
 *
 * ```text
 * Error: ENOENT: no such file or directory, open '/tmp/os-bound-port-home-DEqSfV/runtime.env_local.json'
 *   ❯ channelsOf test/serve-publishes-bound-port.e2e.test.ts:241:28
 * ```
 *
 * ⛔ The producer was wrong, not the reader. Load never created the race, it
 * only widened it: all a busy machine does is deschedule the child between the
 * announcement and the write.
 *
 * ## Why this file exists ALONGSIDE that e2e, rather than instead of it
 *
 * ⭐ An end-to-end test cannot pin an ordering. It can only lose the race often
 * enough for someone to notice — which is the failure mode being repaired, and
 * a "fix" verified only by that e2e passing once would be indistinguishable
 * from a fix that did nothing. So the ordering is observed DIRECTLY here:
 * `publishBoundPort` takes its three channels as arguments, and these tests
 * record the sequence it drives them in. Reverse the order in `serve.ts` and
 * this file goes red on every machine, every run, with no load required.
 *
 * The e2e keeps its own job — proving the three channels agree with the socket
 * (#13062). This file proves they cannot be announced before they are true.
 *
 * ## ⛔ Why the real IPC leg is never CALLED here
 *
 * `runtimeBoundPortChannels().announceListening` is `process.send`, and under
 * vitest's `forks` pool `process.send` is the runner's OWN control channel. A
 * test that drove that leg for real would post `objectstack:listening` to
 * vitest itself. The real leg's body is one guarded `process.send`; what is
 * worth pinning about it — WHEN it fires — is pinned by observing the moment,
 * not by delivering the message.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  publishBoundPort,
  runtimeBoundPortChannels,
  type BoundPortChannels,
  type ListeningMessage,
} from '../src/commands/serve.js';

/** The file name a plain `os serve` writes when `OS_ENVIRONMENT_ID` is unset. */
const RUNTIME_FILE = 'runtime.env_local.json';

const tempDirs: string[] = [];
/** `runtimeBoundPortChannels` registers an `exit` cleanup per state file written. */
const exitListenersBefore = process.listeners('exit').slice();

afterEach(() => {
  for (const listener of process.listeners('exit')) {
    if (!exitListenersBefore.includes(listener)) process.removeListener('exit', listener);
  }
  while (tempDirs.length) {
    const dir = tempDirs.pop() as string;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

/** A temp directory, torn down by `afterEach`. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-publish-order-'));
  tempDirs.push(dir);
  return dir;
}

/**
 * Run `fn` with `OS_HOME` pointed at `home` and `OS_ENVIRONMENT_ID` unset, then
 * put both back exactly as they were — including "was not set at all", which a
 * bare reassignment cannot express.
 */
function withHome<T>(home: string, fn: () => T): T {
  const priorHome = process.env.OS_HOME;
  const priorEnvId = process.env.OS_ENVIRONMENT_ID;
  process.env.OS_HOME = home;
  delete process.env.OS_ENVIRONMENT_ID;
  try {
    return fn();
  } finally {
    if (priorHome === undefined) delete process.env.OS_HOME; else process.env.OS_HOME = priorHome;
    if (priorEnvId === undefined) delete process.env.OS_ENVIRONMENT_ID; else process.env.OS_ENVIRONMENT_ID = priorEnvId;
  }
}

describe('#13193 — `os serve` writes the state file BEFORE it announces the port', () => {
  it('drives the three channels in the order state-file → IPC → banner', () => {
    const order: string[] = [];

    publishBoundPort(45671, {
      writeRuntimeState: () => { order.push('state-file'); },
      announceListening: () => { order.push('ipc'); },
      printBanner: () => { order.push('banner'); },
    } satisfies BoundPortChannels);

    // ⛔ Not `order[0] === 'state-file'` alone: a publish that silently stopped
    // announcing would satisfy that, and losing a channel is the defect in the
    // opposite direction — the one #13062 was filed for.
    expect(order, 'all three channels must fire, in this exact order').toEqual([
      'state-file', 'ipc', 'banner',
    ]);
  });

  it('gives both announcements the same address the state file was written with', () => {
    let written: { port: number; url: string } | undefined;
    let announced: ListeningMessage | undefined;
    let bannerPrinted = false;

    publishBoundPort(45672, {
      writeRuntimeState: (published) => { written = published; },
      announceListening: (message) => { announced = message; },
      printBanner: () => { bannerPrinted = true; },
    });

    expect(written).toEqual({ port: 45672, url: 'http://localhost:45672' });
    expect(announced).toEqual({
      type: 'objectstack:listening',
      port: 45672,
      url: 'http://localhost:45672',
    });
    expect(bannerPrinted).toBe(true);
  });

  /**
   * ⭐ The load-bearing one, and the reason this file drives the REAL writer
   * rather than three recorders.
   *
   * The e2e's failure is `existsSync(...) === false` at the instant it reacts to
   * an announcement. So that is measured here at the instant each announcement
   * FIRES — not after the publish returns, where the ordering under test has
   * already finished and both orders look identical. Against the old order both
   * booleans below are `false` deterministically; against the new one both are
   * `true` deterministically. No load, no sleep, no retry.
   */
  it('has the state file already on disk at the moment each announcement fires', () => {
    const home = tempDir();
    const runtimeFile = join(home, RUNTIME_FILE);

    let existedAtIpc: boolean | undefined;
    let existedAtBanner: boolean | undefined;

    withHome(home, () => {
      expect(existsSync(runtimeFile), 'precondition: no state file before the publish').toBe(false);

      // The REAL writer — the code path `os serve` runs. Only the two
      // announcement legs are observers (see the header for why).
      const real = runtimeBoundPortChannels(() => {
        existedAtBanner = existsSync(runtimeFile);
      });

      publishBoundPort(45673, {
        writeRuntimeState: real.writeRuntimeState,
        announceListening: () => { existedAtIpc = existsSync(runtimeFile); },
        printBanner: real.printBanner,
      });
    });

    expect(existedAtIpc, 'runtime state file must exist when the IPC message is sent').toBe(true);
    expect(existedAtBanner, 'runtime state file must exist when the banner prints').toBe(true);

    // And it must already carry the BOUND port — not a placeholder written
    // early to win an ordering check. Present is only half the contract.
    const state = JSON.parse(readFileSync(runtimeFile, 'utf8'));
    expect(state.port).toBe(45673);
    expect(state.url).toBe('http://localhost:45673');
    expect(state.environmentId).toBe('env_local');
    expect(state.pid).toBe(process.pid);
  });

  /**
   * Moving the write to the FRONT put it upstream of both announcements, so a
   * write that fails must not be able to take them down with it. It cannot:
   * the real writer swallows its own failure, exactly as it did when it ran
   * last. A boot does not die because a supervision file could not be written.
   */
  it('still announces when the real state-file write fails', () => {
    // `OS_HOME` under a regular FILE — `mkdirSync(..., {recursive:true})`
    // fails with ENOTDIR, deterministically and with no permissions games.
    const blocker = join(tempDir(), 'not-a-directory');
    writeFileSync(blocker, 'x');
    const home = join(blocker, 'nested');

    const order: string[] = [];

    withHome(home, () => {
      const real = runtimeBoundPortChannels(() => { order.push('banner'); });
      publishBoundPort(45674, {
        writeRuntimeState: (published) => {
          order.push('state-file');
          real.writeRuntimeState(published);
        },
        announceListening: () => { order.push('ipc'); },
        printBanner: real.printBanner,
      });
    });

    expect(order, 'a failed write must not swallow the announcements').toEqual([
      'state-file', 'ipc', 'banner',
    ]);
    expect(existsSync(join(home, RUNTIME_FILE)), 'the write really did fail').toBe(false);
  });
});
