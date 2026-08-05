// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// framework#5447 — `config.email.persist` reaches `EmailServicePlugin`.
//
// `EmailServiceConfigSchema` has declared `persist` ("Persist to sys_email
// (default true)") for as long as the plugin has honoured it, and the plugin
// half was never in doubt: it builds no `EmailPersistence` when
// `persist === false`, and says so in its own queue-delivery diagnostics. What
// did not exist was the segment between them. `config.email` has exactly one
// reader in the repo — `resolveEmailCapabilityArg`, whose return value IS the
// plugin's constructor argument (see the `cap === 'email'` arm of the
// capability loop) — and it read every declared key except this one.
//
// So the key was declared, typed, parsed, and documented, and a PII-sensitive
// deployment that wrote `persist: false` to keep message bodies out of the
// database kept writing every body to `sys_email`. That is Prime Directive
// #10's declared != enforced with a privacy blast radius, and ADR-0049's
// enforce-or-remove was answered "enforce".
//
// The end-to-end block below is the point of this file. Asserting only that
// the resolver emits `persist: false` would re-pin the same declaration twice
// (a resolver key name against a test's expectation of that key name) and
// could not tell whether the plugin reads `persist` at all — which is exactly
// the class of gap being closed. So it boots the REAL `EmailServicePlugin`
// over the resolver's REAL output and asks the plugin what it built.

import { describe, it, expect, vi } from 'vitest';
import { EmailServicePlugin } from '@objectstack/plugin-email';
import { resolveEmailCapabilityArg } from './serve.js';

// ── resolver ───────────────────────────────────────────────────────────────

describe('resolveEmailCapabilityArg — sys_email persistence (#5447)', () => {
  it('leaves persist unset when neither config nor env declares it', () => {
    // The no-regression case: absent, not `false`. An option nobody wrote must
    // not appear in what the plugin is constructed with, because the plugin's
    // default (persist ON) is what every existing deployment is running and
    // emitting `persist: true` here would only look equivalent.
    expect(resolveEmailCapabilityArg({}, {})).not.toHaveProperty('options.persist');
  });

  it('carries config.email.persist:false through to the constructor options', () => {
    const { options } = resolveEmailCapabilityArg({ persist: false }, {});
    expect(options.persist).toBe(false);
  });

  it('carries an explicit config.email.persist:true too', () => {
    const { options } = resolveEmailCapabilityArg({ persist: true }, {});
    expect(options.persist).toBe(true);
  });

  it('reads OS_EMAIL_PERSIST_ENABLED on the same truth table as OS_EMAIL_QUEUE_ENABLED', () => {
    // One truth table for both flags, which is why `envBooleanFlag` was
    // extracted instead of the list being written a second time: an operator
    // who learned `on` works for the queue flag must not find it silently
    // means "off" here.
    for (const on of ['1', 'true', 'TRUE', 'yes', 'on', ' On ']) {
      expect(resolveEmailCapabilityArg({}, { OS_EMAIL_PERSIST_ENABLED: on }).options.persist, on)
        .toBe(true);
    }
    for (const off of ['0', 'false', 'no', 'off', '']) {
      expect(resolveEmailCapabilityArg({}, { OS_EMAIL_PERSIST_ENABLED: off }).options.persist, off)
        .toBe(false);
    }
  });

  it('lets env override config in BOTH directions', () => {
    // Both directions, because a one-way test passes just as well against a
    // resolver that ignores config entirely.
    expect(
      resolveEmailCapabilityArg({ persist: true }, { OS_EMAIL_PERSIST_ENABLED: 'false' })
        .options.persist,
    ).toBe(false);
    expect(
      resolveEmailCapabilityArg({ persist: false }, { OS_EMAIL_PERSIST_ENABLED: 'true' })
        .options.persist,
    ).toBe(true);
  });

  it('does not let an UNSET env var read as false over a config that said true', () => {
    // The tri-state `envBooleanFlag` exists for this case: `undefined` must
    // fall through to config, not resolve to `false`.
    expect(
      resolveEmailCapabilityArg({ persist: true }, { OS_EMAIL_QUEUE_ENABLED: 'true' })
        .options.persist,
    ).toBe(true);
  });

  it('keeps the queue flag resolving exactly as it did before the extraction', () => {
    // `envBooleanFlag` replaced OS_EMAIL_QUEUE_ENABLED's inline list; these
    // pin that the refactor was behaviour-preserving, empty string included.
    expect(resolveEmailCapabilityArg({}, { OS_EMAIL_QUEUE_ENABLED: 'on' }).options.queueDelivery)
      .toBe(true);
    expect(resolveEmailCapabilityArg({ queueDelivery: true }, { OS_EMAIL_QUEUE_ENABLED: '' })
      .options.queueDelivery).toBe(false);
    expect(resolveEmailCapabilityArg({ queueDelivery: true }, {}).options.queueDelivery).toBe(true);
    expect(resolveEmailCapabilityArg({}, {})).not.toHaveProperty('options.queueDelivery');
  });

  it('does not disturb the rest of the resolved options', () => {
    const { options } = resolveEmailCapabilityArg(
      { provider: 'smtp', persist: false, options: { host: 'smtp.acme.test' } },
      {},
    );
    expect(options).toMatchObject({
      provider: 'smtp',
      persist: false,
      providerOptions: { host: 'smtp.acme.test' },
    });
  });
});

// ── end to end: resolver output -> real plugin ─────────────────────────────

/**
 * Minimal ObjectQL stand-in. `start()`'s `kernel:ready` handler needs an
 * engine to exist before it decides anything about persistence, and the
 * stranded-outbox sweep reads `sys_email` on the persisting path.
 */
function fakeEngine() {
  return {
    async find() { return []; },
    async insert(_table: string, data: any) { return { id: data?.id }; },
    async update() { return {}; },
    async delete() { return { deleted: 0 }; },
  };
}

/**
 * Boot the real plugin the way `os serve` does — through the resolver — and
 * report whether an `EmailPersistence` was built.
 *
 * `EmailService.setPersistence` is called only on the persisting branch, and
 * it is what puts `persistence` into the live service's options, so reading
 * that back is a direct observation of the branch the plugin took rather than
 * a restatement of the flag it was handed.
 */
async function bootThroughResolver(
  cfgEmail: Record<string, any>,
  env: NodeJS.ProcessEnv = {},
): Promise<{ persistenceBuilt: boolean; constructedWith: Record<string, unknown> }> {
  const constructedWith = resolveEmailCapabilityArg(cfgEmail, env).options;

  const services: Record<string, unknown> = { manifest: { register: () => {} }, objectql: fakeEngine() };
  const hooks: Record<string, Array<() => Promise<void> | void>> = {};
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service '${name}' not registered`);
      return services[name];
    },
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    hook: (name: string, fn: () => Promise<void> | void) => { (hooks[name] ??= []).push(fn); },
  };

  const plugin = new EmailServicePlugin(constructedWith as any);
  await plugin.init(ctx);
  await plugin.start(ctx);
  for (const fn of hooks['kernel:ready'] ?? []) await fn();

  const service = services.email as { options: { persistence?: unknown } };
  return { persistenceBuilt: service.options.persistence != null, constructedWith };
}

describe('config.email.persist reaches EmailServicePlugin (#5447)', () => {
  it('builds NO EmailPersistence when the config says persist:false', async () => {
    const { persistenceBuilt, constructedWith } = await bootThroughResolver({ persist: false });
    expect(constructedWith.persist).toBe(false);
    expect(persistenceBuilt).toBe(false);
  }, 60_000);

  it('still persists when the config says nothing — behaviour before #5447, unchanged', async () => {
    // The compatibility anchor. Every deployment that never wrote the key is
    // this case, and it must be indistinguishable from the pre-#5447 build.
    const { persistenceBuilt, constructedWith } = await bootThroughResolver({});
    expect(constructedWith).not.toHaveProperty('persist');
    expect(persistenceBuilt).toBe(true);
  }, 60_000);

  // The two cases below are completeness pins, NOT discriminating ones, and
  // saying so is the point of this comment. Their expected outcome —
  // persistence built — is also what an unwired resolver produces, because the
  // plugin default is ON. Deleting the wiring leaves both GREEN (measured: 8
  // of these 13 go red, these two and the three default-behaviour pins do
  // not). They are worth keeping as the positive half of the matrix; they are
  // not evidence the carrier exists. The assertions that prove that are the
  // `persist:false` one above and the `OS_EMAIL_PERSIST_ENABLED=false` one
  // below — the two whose expectation DIFFERS from the default.
  it('persists on an explicit persist:true', async () => {
    const { persistenceBuilt } = await bootThroughResolver({ persist: true });
    expect(persistenceBuilt).toBe(true);
  }, 60_000);

  it('lets OS_EMAIL_PERSIST_ENABLED=false switch persistence off over a config that said true',
    async () => {
      const { persistenceBuilt } = await bootThroughResolver(
        { persist: true },
        { OS_EMAIL_PERSIST_ENABLED: 'false' },
      );
      expect(persistenceBuilt).toBe(false);
    }, 60_000);

  it('lets OS_EMAIL_PERSIST_ENABLED=true switch it back on over a config that said false',
    async () => {
      const { persistenceBuilt } = await bootThroughResolver(
        { persist: false },
        { OS_EMAIL_PERSIST_ENABLED: 'true' },
      );
      expect(persistenceBuilt).toBe(true);
    }, 60_000);
});
