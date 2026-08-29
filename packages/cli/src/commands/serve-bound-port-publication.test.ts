// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13062 — `os serve` publishes the port it BOUND, on all three of the channels
 * that announce one.
 *
 * ## The defect, and why it hid
 *
 * The IPC message (`objectstack:listening`), the ready banner's `API:` row and
 * `runtime.<environment>.json` were three outputs of ONE number, and that
 * number was the port the operator ASKED for. For every value but one the
 * requested and the bound port coincide, so the three agreed with each other
 * AND with the socket, and nothing ever disagreed. For `0` they cannot
 * coincide: `utils/port-contract.ts` declares `MIN_PORT = 0` from its own
 * measurement and states that 0 is "a REQUEST, not an error" — `listen(0)`
 * binds a kernel-assigned port — so `os serve --port 0` announced
 * `{ port: 0 }`, printed `API: http://localhost:0/` and wrote `"port": 0`.
 * Three channels naming an address nothing listens on, with nothing erroring.
 *
 * ## Two halves, and the second is the one that rots
 *
 * The BEHAVIOUR half is {@link resolveBoundPort}, driven below against a fake
 * kernel — a unit, so the asymmetry that matters (`0` in, a real port out) is
 * exercised without a boot.
 *
 * The WIRING half cannot be reached that way at all: `run()` is one ~3000-line
 * method that needs a whole kernel to enter, so nothing in-process can observe
 * which variable its three publish sites read. That is exactly the half the
 * card is about — ⛔ "fix one channel and two go on lying, harder to find than
 * before" — so it is pinned by reading the source, with comments MASKED so a
 * sentence about the bound port can never answer for code that publishes the
 * requested one. (`test/serve-publishes-bound-port.e2e.test.ts` drives all
 * three through a real boot; this is the cheap half that fails in 40ms and
 * names which channel regressed.)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The repo's ONE code/prose separator, typed by the hand-written `.d.mts`
// beside it — the same import `utils/port-contract-single-source.test.ts` uses,
// and for the same reason: this file asks "does the CODE publish the bound
// port", and a comment claiming it does is precisely what was there before.
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

import {
  publishBoundPort,
  resolveBoundPort,
  runtimeBoundPortChannels,
  type BoundPortChannels,
} from './serve.js';
import { MAX_PORT } from '../utils/port-contract.js';

/** …/packages/cli/src/commands — seeded from `import.meta.url`. */
const HERE = resolve(fileURLToPath(import.meta.url), '..');

/** `serve.ts`'s CODE, with every comment span blanked. */
const SERVE = maskComments(readFileSync(resolve(HERE, 'serve.ts'), 'utf8'));

/** `serve.ts` verbatim — only for asserting that the mask actually masked. */
const SERVE_RAW = readFileSync(resolve(HERE, 'serve.ts'), 'utf8');

/**
 * A kernel whose transport reports `reported` from `getPort()`.
 *
 * ⚠️ The miss path THROWS rather than returning `undefined`, because that is
 * what `ObjectKernel.getService` really does — a miss is a composition fault
 * that `@objectstack/core` refuses to answer silently. A fake that returned
 * `undefined` would leave the production `try` untested and green.
 *
 * ⛔ That kernel is named by PACKAGE, never as a repo-relative path: this file
 * does not read it, and `check:cross-package-test-inputs` is a source scan that
 * cannot tell a path in prose from one this test really opens (measured — the
 * first draft of this comment failed that gate).
 */
function kernelReporting(
  reported: unknown,
  opts: { under?: string; getPort?: unknown } = {},
): { kernel: { getService: (name: string) => unknown }; asked: string[] } {
  const under = opts.under ?? 'http.server';
  const asked: string[] = [];
  return {
    asked,
    kernel: {
      getService(name: string) {
        asked.push(name);
        if (name !== under) throw new Error(`Service '${name}' not found`);
        return 'getPort' in opts ? { getPort: opts.getPort } : { getPort: () => reported };
      },
    },
  };
}

describe('#13062 resolveBoundPort — the transport answers, not the request', () => {
  it('answers with the BOUND port when the request was 0', () => {
    // ⭐ The whole card in one line: `--port 0` is the one request that can
    // never equal its answer, and it is the case every channel got wrong.
    const { kernel } = kernelReporting(44321);
    expect(resolveBoundPort(kernel, 0)).toBe(44321);
  });

  it('answers with the BOUND port when a non-zero request drifted', () => {
    // The second way the two part company on this command, and it needs no
    // `--port 0`: `HonoHttpServer.listen()` walks past EADDRINUSE on its own,
    // so a port taken between this command's probe and the transport's
    // `listen()` is bound one higher than the number serve resolved.
    const { kernel } = kernelReporting(41235);
    expect(resolveBoundPort(kernel, 41234)).toBe(41235);
  });

  it('is a no-op for the case that was always right — request === bound', () => {
    // ⛔ The half most easily broken on the way past: every ordinary boot must
    // publish exactly what it published before.
    const { kernel } = kernelReporting(41234);
    expect(resolveBoundPort(kernel, 41234)).toBe(41234);
  });

  it('asks for the CANONICAL service name, never the deprecated alias', () => {
    const { kernel, asked } = kernelReporting(44321);
    resolveBoundPort(kernel, 0);
    expect(asked).toEqual(['http.server']);
    // `http-server` is the same instance under a deprecated second name
    // (#4251). Reading it here would be new code taking a retiring dependency.
    expect(asked).not.toContain('http-server');
  });

  describe('the fallback is the OLD behaviour, and it may not narrow what boots', () => {
    it('falls back when nothing registered a transport (`--server=false`)', () => {
      const { kernel } = kernelReporting(0, { under: 'nothing-registers-this' });
      expect(resolveBoundPort(kernel, 3000)).toBe(3000);
    });

    it('falls back when the transport does not implement the optional member', () => {
      const { kernel } = kernelReporting(0, { getPort: undefined });
      expect(resolveBoundPort(kernel, 3000)).toBe(3000);
    });

    it('falls back when `getPort()` itself throws', () => {
      const { kernel } = kernelReporting(0, {
        getPort: () => { throw new Error('transport is mid-restart'); },
      });
      expect(resolveBoundPort(kernel, 3000)).toBe(3000);
    });

    it('falls back for a kernel that has no `getService` at all', () => {
      expect(resolveBoundPort(undefined, 3000)).toBe(3000);
      expect(resolveBoundPort({}, 3000)).toBe(3000);
    });
  });

  describe('what may not be published, whatever the transport says', () => {
    it('⛔ refuses 0 as an ANSWER, though 0 is a legal REQUEST', () => {
      // No socket is bound to port 0. A transport reporting it has not listened
      // yet — `HonoHttpServer.getPort()` returns its constructor argument until
      // the listening callback fires — and republishing it IS the defect.
      const { kernel } = kernelReporting(0);
      expect(resolveBoundPort(kernel, 41234)).toBe(41234);
    });

    it('refuses anything that cannot be a bound port', () => {
      for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_PORT + 1]) {
        const { kernel } = kernelReporting(bad);
        expect(resolveBoundPort(kernel, 41234), `accepted ${String(bad)}`).toBe(41234);
      }
      for (const bad of ['44321', null, undefined, {}]) {
        const { kernel } = kernelReporting(bad);
        expect(resolveBoundPort(kernel, 41234), `accepted ${JSON.stringify(bad)}`).toBe(41234);
      }
    });

    it('accepts the ceiling itself, read from the ONE port contract', () => {
      // ⛔ Never written as a literal here — `utils/port-contract.ts` is the one
      // place either bound is declared, and `port-contract-single-source.test.ts`
      // fails on a second copy.
      const { kernel } = kernelReporting(MAX_PORT);
      expect(resolveBoundPort(kernel, 41234)).toBe(MAX_PORT);
    });
  });
});

/** Temp `OS_HOME` directories made by the behavioural pins below. */
const publishHomes: string[] = [];
/** `runtimeBoundPortChannels` registers one `exit` cleanup per state file written. */
const exitListenersAtLoad = process.listeners('exit').slice();

afterEach(() => {
  for (const listener of process.listeners('exit')) {
    if (!exitListenersAtLoad.includes(listener)) process.removeListener('exit', listener);
  }
  while (publishHomes.length) {
    const home = publishHomes.pop() as string;
    try { rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

/**
 * Run `fn` with `OS_HOME` at a fresh temp dir and `OS_ENVIRONMENT_ID` unset,
 * then restore both — including "was not set at all", which a bare reassignment
 * cannot express. Returns the directory so the caller can read what was written.
 */
function withTempHome<T>(fn: (home: string) => T): { home: string; value: T } {
  const home = mkdtempSync(join(tmpdir(), 'os-bound-port-publication-'));
  publishHomes.push(home);
  const priorHome = process.env.OS_HOME;
  const priorEnvId = process.env.OS_ENVIRONMENT_ID;
  process.env.OS_HOME = home;
  delete process.env.OS_ENVIRONMENT_ID;
  try {
    return { home, value: fn(home) };
  } finally {
    if (priorHome === undefined) delete process.env.OS_HOME; else process.env.OS_HOME = priorHome;
    if (priorEnvId === undefined) delete process.env.OS_ENVIRONMENT_ID; else process.env.OS_ENVIRONMENT_ID = priorEnvId;
  }
}

/**
 * Drive `fn` with `process.send` replaced by a recorder, and hand back what it
 * was given.
 *
 * ⚠️ Under vitest's `forks` pool `process.send` is the RUNNER's own control
 * channel, so this must never deliver a real `objectstack:listening` message to
 * it. The swap is synchronous, spans one call, and is undone in `finally`.
 */
function recordingProcessSend(fn: () => void): unknown[] {
  const sent: unknown[] = [];
  const prior = process.send;
  (process as { send?: unknown }).send = (message: unknown) => { sent.push(message); return true; };
  try { fn(); } finally { (process as { send?: unknown }).send = prior; }
  return sent;
}

/**
 * #13062: all three channels publish ONE number, and it is the BOUND one.
 *
 * ## Why three of these are DRIVEN now, where they used to be source greps
 *
 * They read the source because `run()` is one ~3000-line method needing a whole
 * kernel to enter, so nothing in-process could observe what its three publish
 * sites read. #13193 changed the shape: the publish is now one exported seam,
 * {@link publishBoundPort}, that takes its three channels as ARGUMENTS. So
 * "all three publish that one number" is now driven and observed instead of
 * grepped — strictly stronger, because a grep passes on text that never runs,
 * and it survives the next refactor of the same code.
 *
 * ⛔ What did NOT become reachable is the WIRING question — whether the seam is
 * handed `boundPort` or `port` at its call site inside `run()`. That is still
 * un-enterable in-process, so it stays a source pin, and it is a better one
 * than before: there is now exactly ONE site to get wrong instead of three.
 *
 * ⛔ The ORDER the seam drives the three in is #13193's property, pinned in
 * `test/serve-bound-port-publish-order.test.ts`. Kept separate deliberately —
 * these two files fail for different reasons and should keep naming them.
 */
describe('#13062 all THREE channels publish that one number', () => {
  it('hands the SAME bound number to the state file and the IPC message', () => {
    let written: { port: number; url: string } | undefined;
    let announced: { type?: string; port?: unknown; url?: unknown } | undefined;
    let banners = 0;

    publishBoundPort(45062, {
      writeRuntimeState: (published) => { written = published; },
      announceListening: (message) => { announced = message; },
      printBanner: () => { banners += 1; },
    } satisfies BoundPortChannels);

    // ⛔ Not "each carries a port" — that passes for the very defect #13062
    // fixed, where all three agreed on the REQUESTED number. The assertion is
    // that both carry THE SAME one, and that the URL is composed from it.
    expect(written).toEqual({ port: 45062, url: 'http://localhost:45062' });
    expect(announced).toEqual({
      type: 'objectstack:listening',
      port: 45062,
      url: 'http://localhost:45062',
    });
    expect(announced?.port, 'the two channels disagree').toBe(written?.port);
    expect(announced?.url).toBe(written?.url);
    expect(banners, 'the third channel was not driven at all').toBe(1);
  });

  it('`runtime.<environment>.json` really lands, carrying `pid` beside that port', () => {
    // The supervisor contract this file has always guarded, now read off the
    // FILE instead of off a regex about how the object literal is formatted.
    const { home } = withTempHome(() => {
      publishBoundPort(45063, runtimeBoundPortChannels(() => { /* banner not under test here */ }));
    });

    const runtimeFile = join(home, 'runtime.env_local.json');
    expect(existsSync(runtimeFile), 'no runtime state file was written at all').toBe(true);
    const state = JSON.parse(readFileSync(runtimeFile, 'utf8'));
    expect(state.port, 'the state file does not publish the bound port').toBe(45063);
    expect(state.url).toBe('http://localhost:45063');
    expect(state.pid, 'external supervisors read `pid` beside the port').toBe(process.pid);
    expect(state.environmentId).toBe('env_local');
  });

  it('the `objectstack:listening` IPC message really reaches `process.send`', () => {
    // `os dev` reads this channel to learn where its child ended up, and #13061
    // records that `os start` could read it too — so the leg is pinned by
    // OBSERVING the send, not by grepping for the call.
    const channels = runtimeBoundPortChannels(() => { /* banner not under test here */ });
    const sent = recordingProcessSend(() => {
      channels.announceListening({ type: 'objectstack:listening', port: 45064, url: 'http://localhost:45064' });
    });

    expect(sent).toEqual([{ type: 'objectstack:listening', port: 45064, url: 'http://localhost:45064' }]);
  });

  it('and stays silent, rather than throwing, when no IPC channel is open', () => {
    // The ordinary `os serve` case: no parent, no fd 3. A publish that threw
    // here would take the banner and the state file down with it.
    const channels = runtimeBoundPortChannels(() => { /* unused */ });
    const prior = process.send;
    (process as { send?: unknown }).send = undefined;
    try {
      expect(() => channels.announceListening({
        type: 'objectstack:listening', port: 45065, url: 'http://localhost:45065',
      })).not.toThrow();
    } finally {
      (process as { send?: unknown }).send = prior;
    }
  });

  it('the ready banner, through the runtime\'s own base-URL chain', () => {
    expect(
      SERVE,
      'the banner no longer resolves its origin from `boundPort`',
    ).toContain('externalBaseOrigin: resolveAuthBaseUrl(boundPort).baseOrigin');
  });

  it('the ONE wiring site hands the seam the BOUND port, never the requested one', () => {
    // The half that cannot be driven in-process, and the whole of what is left
    // of the source scan for these channels: `run()` reaches the seam once, and
    // what it passes decides all three channels at once.
    expect(
      SERVE,
      'the publish site no longer hands `publishBoundPort` the resolved bound port',
    ).toContain('publishBoundPort(boundPort, runtimeBoundPortChannels(printBanner));');
    // Exactly two mentions in CODE: the declaration and that single call.
    expect(
      SERVE.match(/publishBoundPort\(/g) ?? [],
      'a second publish site can disagree with the first — that is the #13062 defect returning',
    ).toHaveLength(2);
  });

  it('⛔ and NONE of the three has drifted back onto the requested port', () => {
    // The card's own instruction: three outputs of one defect, and repairing
    // one leaves two lying in a place nobody thinks to look next time.
    expect(SERVE).not.toContain('port: Number(port)');
    expect(SERVE).not.toContain('externalBaseOrigin: resolveAuthBaseUrl(port)');
    // ⛔ `const runtimeUrl = ...` is gone (#13193 folded it into the seam), so a
    // negative naming it would pass for the wrong reason. The live spelling of
    // the same regression is the seam being handed the REQUESTED port.
    expect(SERVE).not.toContain('publishBoundPort(port,');
    expect(SERVE).not.toContain('publishBoundPort(Number(port)');
  });

  it('resolves it ONCE, from the transport, after the boot', () => {
    expect(
      SERVE,
      'the bound port is no longer read off the transport — three call sites resolving it '
      + 'separately is how they earn the right to disagree',
    ).toContain('const boundPort = resolveBoundPort(kernel, port);');
    expect(SERVE.match(/const boundPort =/g) ?? []).toHaveLength(1);
  });

  describe('ANTI-VACUITY: the scan reads CODE, and it read something', () => {
    it('the mask blanked comments rather than returning the file unchanged', () => {
      // Without this, every `not.toContain` above passes on an empty string.
      expect(SERVE.length).toBe(SERVE_RAW.length);
      expect(SERVE).not.toBe(SERVE_RAW);
      // A sentence that exists ONLY in a comment must be invisible to the scan…
      const proseOnly = 'republishing it is the defect itself';
      expect(SERVE_RAW, 'the control sentence was reworded — pick another').toContain(proseOnly);
      expect(SERVE).not.toContain(proseOnly);
      // …while the code around it is still there.
      expect(SERVE).toContain('export function resolveBoundPort(');
    });

    it('the requested port is still what the transport is CONSTRUCTED with', () => {
      // The positive control for the negatives above: `port` has not been
      // globally renamed, so `not.toContain('port: Number(port)')` is a
      // measurement rather than a consequence of the variable disappearing.
      expect(SERVE).toContain('new HonoServerPlugin({ port })');
      expect(SERVE).toContain('port = await getAvailablePort(requestedPort)');
    });
  });
});
