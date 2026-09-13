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
  composeSeedSettledMessage,
  createSeedSettlementAnnouncer,
  publishBoundPort,
  readSeedSettlement,
  resolveBoundPort,
  runtimeBoundPortChannels,
  runtimeSeedSettlementChannels,
  runtimeStateFileName,
  seedingHasSettled,
  type BoundPortChannels,
  type SeedSettledMessage,
} from './serve.js';
// #17329 — the published contract's own shapes, so the fixtures below cannot
// drift from what the runtime actually hands the CLI.
import type { SeedSettlementSnapshot, SeedSuppressionReason } from '@objectstack/spec/contracts';
import type { SeedSourceSummary } from '../utils/format.js';
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

    // ⛔ Not the literal `runtime.env_local.json`: the name is keyed by the
    // PROJECT as well as the environment (#15733), and a literal here would be
    // a second copy of that rule — free to keep passing against a writer that
    // had drifted off it. `runtimeBoundPortChannels` reached outside a boot
    // anchors on the CWD, which is this runner's.
    const runtimeFile = join(home, runtimeStateFileName('env_local', process.cwd()));
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
    ).toContain('externalBaseOrigin: resolveAuthBaseUrl(boundPort, boundProtocol).baseOrigin');
  });

  it('the ONE wiring site hands the seam the BOUND port, never the requested one', () => {
    // The half that cannot be driven in-process, and the whole of what is left
    // of the source scan for these channels: `run()` reaches the seam once, and
    // what it passes decides all three channels at once.
    expect(
      SERVE,
      'the publish site no longer hands `publishBoundPort` the resolved bound port',
    ).toContain('publishBoundPort(boundPort, runtimeBoundPortChannels(printBanner), boundProtocol);');
    // Exactly two mentions in CODE: the declaration and that single call.
    expect(
      SERVE.match(/publishBoundPort\(/g) ?? [],
      'a second publish site can disagree with the first — that is the #13062 defect returning',
    ).toHaveLength(2);
  });

  describe('#16804 — the published url names the scheme the socket SPEAKS', () => {
    it('plain http when nothing asked for TLS — today\'s bytes, unchanged', () => {
      const seen: Array<{ port: number; url: string }> = [];
      publishBoundPort(45070, {
        writeRuntimeState: (published) => { seen.push(published); },
        announceListening: (message) => { seen.push({ port: message.port, url: message.url }); },
        printBanner: () => { /* not under test here */ },
      });
      expect(seen).toEqual([
        { port: 45070, url: 'http://localhost:45070' },
        { port: 45070, url: 'http://localhost:45070' },
      ]);
    });

    it('https on BOTH channels under a TLS listener — an ABLATION beside the leg above', () => {
      // Both consumers of this url OPEN it: the runtime state file is what an
      // external supervisor dials, the IPC message is what the `os dev` parent
      // learns the server from. Under `--cert`/`--key` a hardcoded `http://`
      // hands both an address that answers a TLS handshake error.
      const seen: Array<{ port: number; url: string }> = [];
      publishBoundPort(45071, {
        writeRuntimeState: (published) => { seen.push(published); },
        announceListening: (message) => { seen.push({ port: message.port, url: message.url }); },
        printBanner: () => { /* not under test here */ },
      }, 'https');
      expect(seen).toEqual([
        { port: 45071, url: 'https://localhost:45071' },
        { port: 45071, url: 'https://localhost:45071' },
      ]);
    });

    it('the default parameter IS the old behaviour — omitted and `http` agree', () => {
      const capture = (protocol?: 'http' | 'https') => {
        const out: string[] = [];
        const channels = {
          writeRuntimeState: (published: { port: number; url: string }) => { out.push(published.url); },
          announceListening: (message: { url: string }) => { out.push(message.url); },
          printBanner: () => { /* not under test here */ },
        };
        if (protocol === undefined) publishBoundPort(45072, channels);
        else publishBoundPort(45072, channels, protocol);
        return out;
      };
      expect(capture()).toEqual(capture('http'));
      // …and the legs discriminate, so agreeing is a reading and not a vacuum.
      expect(capture()).not.toEqual(capture('https'));
    });
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
      //
      // #16804 widened the construction literal to carry `tls` beside `port`;
      // what this control needs is that `port` still reaches the transport
      // under its own name, so it reads the construction site rather than one
      // formatting of it.
      expect(SERVE).toContain('new HonoServerPlugin({');
      expect(SERVE.slice(SERVE.indexOf('new HonoServerPlugin({'))).toMatch(/^new HonoServerPlugin\(\{\s*\n\s*port,/);
      expect(SERVE).toContain('port = await getAvailablePort(requestedPort)');
    });
  });
});

/**
 * #17329 — the SECOND ipc message: "this boot's seeding has come to rest".
 *
 * ## The defect, and the two clocks that hid it
 *
 * `✓ Server is ready` is true about the HTTP server and says nothing about the
 * app. `AppPlugin` races its inline seed against `OS_INLINE_SEED_BUDGET_MS`
 * (default 8s) and past it hands the rest to a detached promise, so the banner
 * prints, a parent proceeds, and the continuation's error wall lands later —
 * measured once at 82 seconds later, 120 `ERROR` lines. Which side wins is
 * decided by whether the seed fits its budget on a contended box, so the same
 * command on the same corpus disagrees between two containers.
 *
 * Everything that WOULD distinguish them arrives on the child's inherited
 * stdio, and reading that costs the boot its TTY. So the fact moves to the
 * channel the `os dev` parent already holds, beside `objectstack:listening`.
 *
 * ## ⭐ Why `inFlight`, and why that is the whole acceptance of the card
 *
 * The obvious predicate — `pending === 0` — is WRONG, and wrong in the
 * direction that reproduces the defect one level up. Two shapes register a seed
 * source and deliberately never run it (multi-tenant per-org replay,
 * `skipSeedData` planning boots); both keep `pending` above zero for the life
 * of the process by design. A `pending`-keyed message would never be sent on
 * either, and its ABSENCE would be indistinguishable from a boot still writing
 * — which is exactly how this defect hid the first time.
 */
describe('#17329 the `objectstack:seed-settled` ipc message', () => {
  /** A settlement snapshot, with `pending` kept consistent by construction. */
  const snap = (inFlight: number, suppressed: SeedSuppressionReason[] = []): SeedSettlementSnapshot => ({
    pending: inFlight + suppressed.length,
    inFlight,
    suppressed,
  });

  /** An announcer over a mutable tally, so a boot's clock can be driven. */
  const harness = (initial: SeedSettlementSnapshot | undefined) => {
    const state = { snapshot: initial, summary: undefined as SeedSourceSummary[] | undefined };
    const sent: SeedSettledMessage[] = [];
    const announcer = createSeedSettlementAnnouncer({
      readSettlement: () => state.snapshot,
      readSummary: () => state.summary,
      announceSettled: (m) => { sent.push(m); },
    });
    return { state, sent, announcer };
  };

  const s = (o: Partial<SeedSourceSummary> & { source: string }): SeedSourceSummary => ({
    inserted: 0, updated: 0, skipped: 0, rejected: 0, ...o,
  });

  it('really reaches `process.send`, like the first message', () => {
    // Pinned by OBSERVING the send, not by grepping for the call — the same
    // rule the `objectstack:listening` leg above follows.
    const channels = runtimeSeedSettlementChannels(undefined);
    const sent = recordingProcessSend(() => {
      channels.announceSettled({
        type: 'objectstack:seed-settled', ok: true, suppressed: [], sources: [],
      });
    });
    expect(sent).toEqual([{
      type: 'objectstack:seed-settled', ok: true, suppressed: [], sources: [],
    }]);
  });

  it('and stays silent, rather than throwing, when no IPC channel is open', () => {
    // The ordinary `os serve` case: no parent, no fd 3. ⛔ This message must
    // not make an IPC channel a requirement of a published command.
    const channels = runtimeSeedSettlementChannels(undefined);
    const prior = process.send;
    (process as { send?: unknown }).send = undefined;
    try {
      expect(() => channels.announceSettled({
        type: 'objectstack:seed-settled', ok: true, suppressed: [], sources: [],
      })).not.toThrow();
    } finally {
      (process as { send?: unknown }).send = prior;
    }
  });

  describe('the ordering contract — never before `objectstack:listening`', () => {
    it('a settle during `runtime.start()` is LATCHED until the release', () => {
      // The ordinary in-budget boot: seeding finished long before the bound
      // port was published. A parent that waits for `objectstack:listening`
      // and only then listens for the settle would MISS a message sent during
      // the boot, so nothing may be sent until the release.
      const { sent, announcer } = harness(snap(0));
      announcer.check();      // `app:seeded`, mid-boot
      announcer.check();      // `kernel:ready`, still mid-boot
      expect(sent, 'a settle overtook the listening announcement').toEqual([]);

      announcer.release();    // …after publishBoundPort drove its three
      expect(sent).toHaveLength(1);
      expect(sent[0].type).toBe('objectstack:seed-settled');
    });

    it('and the release is what sends it — not a later hook that may never fire', () => {
      // ⛔ Ablation of the leg above: if the release only opened a gate and
      // waited for the NEXT hook, an in-budget boot (whose hooks have all
      // already fired) would never announce at all.
      const { sent, announcer } = harness(snap(0));
      announcer.release();
      expect(sent, 'the release did not evaluate the tally it just un-gated').toHaveLength(1);
    });
  });

  describe('the over-budget path — the clock the card is about', () => {
    it('withholds while a source is still writing, then speaks when it settles', () => {
      const { state, sent, announcer } = harness(snap(1));
      announcer.release();
      expect(sent, 'announced settled over a seed that was still writing').toEqual([]);

      // The detached continuation finishes: the runtime settles the source and
      // fires `app:seeded`, which is the only signal on this path.
      state.snapshot = snap(0);
      state.summary = [s({ source: 'showcase', inserted: 132 })];
      announcer.check();

      expect(sent).toHaveLength(1);
      expect(sent[0].sources).toEqual([s({ source: 'showcase', inserted: 132 })]);
      expect(sent[0].ok).toBe(true);
    });

    it('sends exactly ONCE, however many times the hooks fire', () => {
      // `app:seeded` fires once per config app, and `kernel:ready` fires beside
      // it; a bundle with several apps would otherwise announce several times
      // and a parent reading one message would act on the first source's tally.
      const { sent, announcer } = harness(snap(0));
      announcer.release();
      announcer.check();
      announcer.check();
      announcer.check();
      expect(sent).toHaveLength(1);
    });

    it('reports failure as settled too — a failed seed has still come to rest', () => {
      // ⛔ Not "announce only on success". A parent waiting for the boot to
      // stop moving must be released by a seed that failed just as much as by
      // one that worked; withholding here recreates the hang this closes.
      const { state, sent, announcer } = harness(snap(1));
      announcer.release();
      state.snapshot = snap(0);
      state.summary = [s({ source: 'showcase', inserted: 24, rejected: 14 })];
      announcer.check();

      expect(sent).toHaveLength(1);
      expect(sent[0].ok, 'a seed that dropped 14 records reported ok').toBe(false);
      expect(sent[0].sources[0].rejected).toBe(14);
    });
  });

  describe('⭐ ruled item 3 — the two modes that report `pending > 0` FOREVER', () => {
    // 「multi-tenant replay and `skipSeedData` report `pending > 0` for the whole
    // boot — a consumer waiting on the new message must not hang forever there;
    // the message's contract states what it means in those modes.」
    it.each([
      ['multi-tenant-replay' as const],
      ['skip-seed-data' as const],
    ])('%s: announces, carrying the reason — it does NOT hang', (reason) => {
      // `suppress()` moves the source out of `inFlight` and records why, inside
      // Phase 2 `start()`. So `kernel:ready` — the only hook that runs on these
      // boots, since `app:seeded` never fires — finds nothing in flight.
      const { sent, announcer } = harness(snap(0, [reason]));
      announcer.release();

      expect(sent, 'a consumer on this boot would wait for a message never coming').toHaveLength(1);
      expect(sent[0].suppressed).toEqual([reason]);
      expect(sent[0].sources, 'no rows were written by this boot').toEqual([]);
    });

    it('⛔ and `pending` is NOT the predicate — the ablation that proves it', () => {
      // The discriminating reading. Both boots below report `pending: 1`; only
      // one of them has work outstanding. A `pending`-keyed message would treat
      // them identically and hang on both.
      const suppressed = snap(0, ['multi-tenant-replay']);
      const writing = snap(1);
      expect(suppressed.pending, 'the two modes must be indistinguishable BY PENDING').toBe(writing.pending);

      expect(seedingHasSettled(suppressed)).toBe(true);
      expect(seedingHasSettled(writing)).toBe(false);
    });
  });

  describe('a kernel with no seed pipeline at all', () => {
    it('counts as settled — an absent service is an answer, not a not-yet', () => {
      // Every source is declared in Phase 2 `start()`, which completes before
      // `kernel:ready`, so "no service" is the fact "this kernel does not seed".
      // ⛔ Treating it as unsettled would hang every app that ships no seeds.
      expect(seedingHasSettled(undefined)).toBe(true);
      const { sent, announcer } = harness(undefined);
      announcer.release();
      expect(sent).toHaveLength(1);
      expect(sent[0]).toEqual({
        type: 'objectstack:seed-settled', ok: true, suppressed: [], sources: [],
      });
    });

    it('and `readSeedSettlement` survives a kernel whose `getService` THROWS', () => {
      // `getService` throws on an unregistered name rather than returning
      // undefined — the same trap `resolveBoundPort` documents above.
      const throwing = { getService: (n: string) => { throw new Error(`Service '${n}' not found`); } };
      expect(readSeedSettlement(throwing)).toBeUndefined();
      expect(readSeedSettlement(undefined)).toBeUndefined();
      // A service present but answering nothing usable is the same as absent.
      const garbage = { getService: () => ({ snapshot: () => ({}) }) };
      expect(readSeedSettlement(garbage)).toBeUndefined();
      // …and the positive control, so those zeros are readings: a real tracker
      // IS read back through the same accessor.
      const real = { getService: () => ({ snapshot: () => snap(2) }) };
      expect(readSeedSettlement(real)).toEqual(snap(2));
    });
  });

  describe('`ok` is a verdict on what the summary CONTAINS', () => {
    it.each([
      ['a clean source', [{ source: 'showcase', inserted: 132 }], true],
      ['rejected records', [{ source: 'showcase', inserted: 24, rejected: 14 }], false],
      ['dropped references', [{ source: 'showcase', inserted: 42, droppedRefs: 3 }], false],
      ['an empty install', [{ source: 'hotcrm', emptyInstall: true }], false],
      ['one clean and one broken', [{ source: 'a', inserted: 9 }, { source: 'b', rejected: 1 }], false],
    ])('%s', (_label, sources, expected) => {
      const message = composeSeedSettledMessage(
        snap(0),
        (sources as Array<Partial<SeedSourceSummary> & { source: string }>).map(s),
      );
      expect(message.ok).toBe(expected);
    });

    it('an absent summary is `ok` with an empty `sources` — "nothing reported a problem"', () => {
      // Documented rather than smoothed over: on a suppressed boot this reads
      // "nothing ran", which is why the contract says to read `ok` against
      // `sources` and `suppressed` rather than alone.
      const message = composeSeedSettledMessage(snap(0, ['skip-seed-data']), undefined);
      expect(message).toEqual({
        type: 'objectstack:seed-settled',
        ok: true,
        suppressed: ['skip-seed-data'],
        sources: [],
      });
    });
  });

  describe('the wiring inside `run()`, which is still un-enterable in-process', () => {
    // Same reason the bound-port wiring above is a source pin: `run()` is one
    // ~3000-line method that needs a whole kernel to enter. Comments are MASKED
    // by the same separator, so a sentence about the release can never answer
    // for code that does not perform it.
    it('releases the latch AFTER the bound-port channels have been driven', () => {
      const publish = SERVE.indexOf('publishBoundPort(boundPort, runtimeBoundPortChannels(printBanner), boundProtocol);');
      const release = SERVE.indexOf('seedSettlement.release();');
      expect(publish, 'the bound-port publish site moved or was renamed').toBeGreaterThan(-1);
      expect(release, 'the settle latch is never released — the message can never be sent').toBeGreaterThan(-1);
      expect(release, 'the settle announcement can now overtake `objectstack:listening`').toBeGreaterThan(publish);
    });

    it('subscribes BOTH hooks — `kernel:ready` is the suppressed boot\'s only one', () => {
      expect(SERVE).toContain("ctx.hook('app:seeded', () => { seedSettlement.check(); });");
      expect(SERVE).toContain("ctx.hook('kernel:ready', () => { seedSettlement.check(); });");
    });

    it('⛔ and the bound-port seam still has exactly ONE call site', () => {
      // The #13062 pin, re-read here because this card added a publication
      // beside it: a second `publishBoundPort` call is that defect returning.
      expect(SERVE.match(/publishBoundPort\(/g) ?? []).toHaveLength(2);
    });
  });
});
