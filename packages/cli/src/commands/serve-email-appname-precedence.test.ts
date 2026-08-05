// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// framework#5448 — `OS_APP_NAME` wins over
// `config.email.defaultTemplateContext.appName`.
//
// `EmailServiceConfigSchema`'s header states the resolution order this file's
// resolver implements — config first, `OS_EMAIL_*` overriding per setting —
// and every other key honoured it: apiKey, defaultFrom, retries,
// queueDelivery, persist, the SMTP family. `appName` was the single exception,
// and it was an exception nobody could see: the resolved value was computed
// first and then the whole `defaultTemplateContext` was spread OVER it, so an
// author who wrote `defaultTemplateContext: { appName: 'Acme Dev' }` made
// `OS_APP_NAME` inert.
//
// That is not a cosmetic ordering detail. One `objectstack.config.ts` deployed
// to several environments has exactly one per-environment lever — the env var
// — and it silently did nothing: production sent mail branded "Acme Dev", and
// because the fallback sender is slugged from the same value, the envelope
// said `no-reply@acme-dev.local` too. Nothing failed, nothing logged.
//
// The chain deliberately keeps `defaultTemplateContext.appName` IN it rather
// than dropping it behind the two dedicated sources: a config that spells only
// the context form is a real, existing shape, and demoting it to 'ObjectStack'
// would trade one silently wrong value for a worse one. Hence the five-level
// ladder below, one test per rung, plus the anti-demotion case.

import { describe, it, expect, vi } from 'vitest';
import { EmailServicePlugin } from '@objectstack/plugin-email';
import { resolveEmailCapabilityArg } from './serve.js';

const appNameOf = (cfgEmail: Record<string, any>, env: NodeJS.ProcessEnv = {}, configAppName?: string) =>
  (resolveEmailCapabilityArg(cfgEmail, env, configAppName).options
    .defaultTemplateContext as Record<string, unknown>).appName;

// ── the five-level chain, one rung per test ────────────────────────────────

describe('resolveEmailCapabilityArg — defaultTemplateContext.appName precedence (#5448)', () => {
  // Every source present at once. This is the case the old code got wrong, and
  // it is the only one whose expectation changed: it used to answer
  // 'From The Context'.
  it('rung 1 — OS_APP_NAME beats every config source', () => {
    expect(appNameOf(
      { appName: 'From The Key', defaultTemplateContext: { appName: 'From The Context' } },
      { OS_APP_NAME: 'From The Env' },
      'From The Top Level',
    )).toBe('From The Env');
  });

  it('rung 2 — config.email.appName takes over when the env says nothing', () => {
    expect(appNameOf(
      { appName: 'From The Key', defaultTemplateContext: { appName: 'From The Context' } },
      {},
      'From The Top Level',
    )).toBe('From The Key');
  });

  it('rung 3 — defaultTemplateContext.appName takes over when the dedicated key is absent', () => {
    expect(appNameOf(
      { defaultTemplateContext: { appName: 'From The Context' } },
      {},
      'From The Top Level',
    )).toBe('From The Context');
  });

  it('rung 4 — top-level config.appName takes over when email says nothing', () => {
    expect(appNameOf({}, {}, 'From The Top Level')).toBe('From The Top Level');
  });

  it("rung 5 — 'ObjectStack' when no source says anything", () => {
    expect(appNameOf({}, {})).toBe('ObjectStack');
  });

  // ── the anti-demotion case ───────────────────────────────────────────────

  it('does NOT demote a config that spells only defaultTemplateContext.appName', () => {
    // The trap the fix had to avoid. Resolving `appName` after the spread
    // without putting the context form back into the chain would have answered
    // 'ObjectStack' here — a config that used to work would start branding
    // every mail with the framework's own name. This case is the reason the
    // chain has five rungs and not four.
    expect(appNameOf({ defaultTemplateContext: { appName: 'Context Only' } }, {}))
      .toBe('Context Only');
    // …and the env still overrides that shape, which is the whole point.
    expect(appNameOf(
      { defaultTemplateContext: { appName: 'Context Only' } },
      { OS_APP_NAME: 'Ops Override' },
    )).toBe('Ops Override');
  });

  // ── the blast radius the issue named: the fallback sender ────────────────

  it('slugs the fallback from-address from the resolved appName, not the raw context', () => {
    // `defaultFrom` is derived from this value when no sender is configured,
    // so the inverted precedence put the wrong brand in the envelope as well
    // as the body. Both halves move together or the fix is half done.
    const { options } = resolveEmailCapabilityArg(
      { defaultTemplateContext: { appName: 'Acme Dev' } },
      { OS_APP_NAME: 'Acme' },
    );
    expect(options.defaultFrom).toEqual({ name: 'Acme', address: 'no-reply@acme.local' });
  });

  it('leaves an explicitly configured defaultFrom alone', () => {
    const { options } = resolveEmailCapabilityArg(
      { defaultFrom: { name: 'Support', address: 'support@acme.test' },
        defaultTemplateContext: { appName: 'Acme Dev' } },
      { OS_APP_NAME: 'Acme' },
    );
    expect(options.defaultFrom).toEqual({ name: 'Support', address: 'support@acme.test' });
  });

  // ── the other context keys are untouched ─────────────────────────────────

  it('changes NOTHING about the other defaultTemplateContext keys', () => {
    // Only `appName` has env and dedicated-config carriers above it, so only
    // `appName` is special-cased. Everything else the author wrote is still
    // spread through wholesale — including keys whose names merely resemble
    // one of the resolved settings, and including a key deliberately named
    // after a config setting this resolver reads, to pin that the special case
    // is exactly one key wide.
    const { options } = resolveEmailCapabilityArg(
      {
        appName: 'Acme',
        defaultTemplateContext: {
          appName: 'ignored — the chain decides this one',
          supportEmail: 'help@acme.test',
          brandColor: '#0af',
          provider: 'this is template data, not the transport',
          year: 2026,
          nested: { logoUrl: 'https://cdn.acme.test/logo.png' },
        },
      },
      { OS_APP_NAME: 'Acme Prod' },
    );
    expect(options.defaultTemplateContext).toEqual({
      appName: 'Acme Prod',
      supportEmail: 'help@acme.test',
      brandColor: '#0af',
      provider: 'this is template data, not the transport',
      year: 2026,
      nested: { logoUrl: 'https://cdn.acme.test/logo.png' },
    });
    // …and a context key that shadows a real setting name stayed template
    // data: the transport is still resolved from its own sources.
    expect(options.provider).toBe('log');
  });

  it('still emits a context with only appName when no context was configured', () => {
    // The shape existing deployments get. Absent config must not start
    // producing an empty or missing context object.
    expect(resolveEmailCapabilityArg({}, { OS_APP_NAME: 'Solo' }).options.defaultTemplateContext)
      .toEqual({ appName: 'Solo' });
  });
});

// ── end to end: resolver output -> real plugin -> live EmailService ────────

/**
 * Minimal ObjectQL stand-in — `start()`'s `kernel:ready` handler needs an
 * engine before it decides anything, and the stranded-outbox sweep reads
 * `sys_email` on the persisting path.
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
 * Boot the real `EmailServicePlugin` the way `os serve` does — through the
 * resolver — and report the `defaultTemplateContext` the LIVE `EmailService`
 * ended up holding.
 *
 * Reading the service's own options rather than the resolver's return value is
 * what makes this more than a restatement: `sendTemplate` merges exactly this
 * object into every template's data (pinned on the plugin side by
 * `send-template.test.ts`), so what it holds is what an operator's mail
 * renders with.
 */
async function contextReachingTheService(
  cfgEmail: Record<string, any>,
  env: NodeJS.ProcessEnv = {},
): Promise<Record<string, unknown>> {
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

  const service = services.email as { options: { defaultTemplateContext?: Record<string, unknown> } };
  return service.options.defaultTemplateContext ?? {};
}

describe('the resolved appName reaches the service that renders templates (#5448)', () => {
  it('carries OS_APP_NAME through to the live EmailService over a config-pinned context', async () => {
    // The reported symptom, end to end: repo config hard-codes the dev brand,
    // production sets the env var, and the mail that goes out must say 'Acme'.
    const context = await contextReachingTheService(
      { defaultTemplateContext: { appName: 'Acme Dev', supportEmail: 'help@acme.test' } },
      { OS_APP_NAME: 'Acme' },
    );
    expect(context).toEqual({ appName: 'Acme', supportEmail: 'help@acme.test' });
  }, 60_000);

  it('carries the context-only appName when no env or dedicated key exists', async () => {
    const context = await contextReachingTheService(
      { defaultTemplateContext: { appName: 'Context Only' } },
      {},
    );
    expect(context).toEqual({ appName: 'Context Only' });
  }, 60_000);
});
