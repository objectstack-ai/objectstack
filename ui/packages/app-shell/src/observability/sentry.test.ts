/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 */

/**
 * objectui#5522 / objectstack#12681 — the Sentry gate must fail CLOSED.
 *
 * What makes this file worth having is that the acceptance condition is an
 * ABSENCE ("no envelopes left the browser"), and absence is the one shape a
 * broken test reproduces perfectly: a suite that never reaches an enabled
 * verdict, for any reason at all, reads exactly like a suite proving the gate
 * works. So every negative case below is paired with a COUNTER-PROBE — a
 * posture that SHOULD report, asserted to actually be enabled. If the
 * counter-probe ever goes green-by-vacuum, it fails, and the negatives stop
 * being evidence of anything.
 *
 * The decision is tested through `resolveSentryGate`, the pure seam, rather
 * than by stubbing env vars around `initSentry`. That was a measured
 * constraint when the gate read `import.meta.env`: this repo's Vitest exposes
 * only `BASE_URL`/`DEV`/`MODE`/`PROD`/`SSR` there, and `vi.stubEnv` writes to
 * `process.env` WITHOUT reaching `import.meta.env` — so an env-stubbing suite
 * silently tested nothing but the no-DSN branch. (Measured: the first draft of
 * this file did exactly that, and its five positive cases all failed while its
 * three absence cases "passed".) The gate no longer reads env at all, which
 * removes the trap rather than working around it; the seam stays because a
 * decision with a security consequence should be reachable on its own.
 *
 * ## The gate now has ONE input, and that is the change under test
 *
 * It used to take two grants — a build-time DSN and a runtime permission — and
 * every case had to hold one fixed to prove anything about the other. The DSN
 * now arrives FROM the runtime and its presence IS the grant, so there is one
 * input and one place an operator looks. The pairs that used to matter
 * ("granting runtime, no DSN" / "DSN, denying runtime") are no longer
 * expressible, because they were the two silent dead states the collapse
 * removed.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveSentryGate } from './sentry';
import {
  getClientErrorReporting,
  resetRuntimeConfigForTesting,
  type RuntimeClientErrorReporting,
} from '../runtime-config.js';

const DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';

/** A fully-populated sink, as `RuntimeConfigPlugin` really serves one. */
function sink(over: Partial<RuntimeClientErrorReporting> = {}): RuntimeClientErrorReporting {
  return {
    dsn: DSN,
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    replaysOnErrorSampleRate: 0,
    ...over,
  };
}

const sentryMock = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  setUser: vi.fn(),
  browserTracingIntegration: vi.fn(() => ({ name: 'BrowserTracing' })),
}));

vi.mock('@sentry/react', () => sentryMock);

describe('resolveSentryGate — fails closed when the runtime served no sink', () => {
  it('withholds reporting when the runtime served nothing', () => {
    // The state every deployment inherits when nobody asked for telemetry —
    // and the state a failed fetch, a 404, an older runtime and a
    // not-yet-arrived config all produce.
    expect(resolveSentryGate(null)).toMatchObject({ enabled: false, reason: 'no-dsn' });
  });

  it('treats an empty or whitespace-only DSN as no sink', () => {
    expect(resolveSentryGate(sink({ dsn: '' }))).toMatchObject({ enabled: false });
    expect(resolveSentryGate(sink({ dsn: '   ' }))).toMatchObject({ enabled: false });
  });

  it('treats a non-string DSN as absent rather than coercing it', () => {
    // The type says `string`, but this gate is the last thing standing between
    // an air-gapped network and sentry.io, and JS callers exist.
    for (const bad of [true, 1, {}, [], null, undefined]) {
      expect(
        resolveSentryGate(sink({ dsn: bad as unknown as string })).enabled,
        `dsn ${JSON.stringify(bad)} must not enable reporting`,
      ).toBe(false);
    }
  });

  it('never reports PII on any withheld verdict', () => {
    // Belt and braces: a disabled verdict that still carried
    // `sendDefaultPii: true` would be one refactor away from leaking.
    for (const input of [null, sink({ dsn: '', sendDefaultPii: true })]) {
      const decision = resolveSentryGate(input);
      expect(decision.enabled).toBe(false);
      expect(decision.sendDefaultPii).toBe(false);
    }
  });

  it('carries no sample rate on a withheld verdict either', () => {
    const decision = resolveSentryGate(null);
    expect(decision.tracesSampleRate).toBe(0);
    expect(decision.replaysOnErrorSampleRate).toBe(0);
  });
});

/**
 * The half that could not be built before objectstack#12681.
 *
 * Every knob used to be a Vite build-time variable frozen into the bundle, so
 * a platform user consuming the prebuilt Console could set none of them — they
 * could not turn reporting ON, and could not turn PII collection OFF. These
 * cases prove the runtime now decides all of it.
 */
describe('resolveSentryGate — the runtime decides everything the build used to', () => {
  it('COUNTER-PROBE — a runtime-served DSN enables reporting', () => {
    // The whole point. If this ever goes red, the absence assertions above stop
    // meaning "the gate is careful" and start meaning "the gate is stuck shut".
    expect(resolveSentryGate(sink())).toMatchObject({
      enabled: true,
      reason: 'opted-in',
      dsn: DSN,
    });
  });

  it('does NOT require a separate permission alongside the DSN', () => {
    // The collapse this card is about: the DSN's presence IS the grant. Were a
    // second boolean ever reintroduced, a deployment would go dark the moment
    // it configured one knob and forgot the other — the quiet failure the
    // two-key shape had.
    expect(resolveSentryGate(sink()).enabled).toBe(true);
  });

  it('trims a padded DSN rather than rejecting it', () => {
    expect(resolveSentryGate(sink({ dsn: `  ${DSN}  ` }))).toMatchObject({ enabled: true, dsn: DSN });
  });

  it('carries the runtime environment tag through, and empty means "let the build decide"', () => {
    expect(resolveSentryGate(sink({ environment: 'staging' })).environment).toBe('staging');
    expect(resolveSentryGate(sink()).environment).toBe('');
  });

  it('carries the runtime sample rates through', () => {
    const decision = resolveSentryGate(sink({ tracesSampleRate: 0.25, replaysOnErrorSampleRate: 1 }));
    expect(decision.tracesSampleRate).toBe(0.25);
    expect(decision.replaysOnErrorSampleRate).toBe(1);
  });

  it('falls back to the documented defaults on a rate outside 0..1', () => {
    const decision = resolveSentryGate(
      sink({
        tracesSampleRate: 5 as unknown as number,
        replaysOnErrorSampleRate: '1' as unknown as number,
      }),
    );
    expect(decision.tracesSampleRate).toBe(0.1);
    expect(decision.replaysOnErrorSampleRate).toBe(0);
  });

  it('keeps a rate of exactly 0 rather than reading it as unset', () => {
    // `0` is a real answer ("sample nothing"), and `||`-style coalescing would
    // quietly replace it with the default — the operator would have turned
    // sampling down and got it turned back up.
    expect(resolveSentryGate(sink({ tracesSampleRate: 0 })).tracesSampleRate).toBe(0);
  });
});

describe('sendDefaultPii — opt-in, because one artifact ships to every posture', () => {
  it('is OFF when the runtime said nothing about it', () => {
    expect(resolveSentryGate(sink()).sendDefaultPii).toBe(false);
  });

  it('is ON only when the runtime explicitly asked for it', () => {
    expect(resolveSentryGate(sink({ sendDefaultPii: true })).sendDefaultPii).toBe(true);
  });

  it('stays OFF for every truthy lookalike on the wire', () => {
    // `=== true`, not truthiness. A payload should not be able to open a PII
    // flow with a string.
    for (const value of ['true', 'TRUE', 1, 'yes', 'on', {}, []]) {
      expect(
        resolveSentryGate(sink({ sendDefaultPii: value as unknown as boolean })).sendDefaultPii,
        `sendDefaultPii=${JSON.stringify(value)} must not enable PII`,
      ).toBe(false);
    }
  });
});

describe('initSentry — the posture that actually ships', () => {
  afterEach(() => {
    resetRuntimeConfigForTesting();
  });

  it('does not initialize, and does not load the SDK, on a runtime that served no sink', async () => {
    // The runtime-config singleton under Vitest holds no sink, which is exactly
    // the shape of a deployment that configured nothing. Not merely "no events
    // sent": `Sentry.init` never runs, which is what keeps the vendor-sentry
    // chunk unfetched — no third-party request at all.
    const { initSentry, getSentry } = await import('./sentry');

    await expect(initSentry()).resolves.toBe(false);
    expect(sentryMock.init).not.toHaveBeenCalled();
    expect(getSentry()).toBeNull();
  });

  it('GATE IDENTITY — agrees with the pure gate about the one input it reads', () => {
    // Ties the halves together: whatever the runtime config singleton holds in
    // this run, `initSentry`'s verdict above must be the one `resolveSentryGate`
    // derives from it. Without this, the pure tests and the wiring test could
    // drift apart and both stay green.
    expect(resolveSentryGate(getClientErrorReporting()).enabled).toBe(false);
  });

  it('reads NO sink before any config has been fetched', () => {
    // The state `initSentry` sees if it is ever called before
    // `initRuntimeConfig()` settles. It must be silence: the console's boot
    // ordering is what guarantees the sink has arrived, and the cost of getting
    // that ordering wrong has to be silence, never a leak.
    resetRuntimeConfigForTesting();
    expect(getClientErrorReporting()).toBeNull();
  });
});
