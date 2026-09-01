// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SmsServicePlugin } from './sms-plugin.js';
import { SmsService, LogSmsTransport } from './sms-service.js';
import { AliyunSmsTransport, TwilioSmsTransport } from './transports/index.js';

/**
 * Lightweight fake PluginContext (service registry + kernel:ready hooks +
 * a fake settings service) — mirrors the messaging plugin's test harness.
 */
function fakeCtx(opts: {
  settingsValues?: Record<string, unknown>;
  /**
   * Per-key `ResolvedSettingValue.source`. The real service resolves every
   * key to `{ value, source, … }` — a fake that dropped `source` would model
   * the exact defect #5536 fixed. Default `'global'` = an admin-saved row,
   * which is what every pre-existing test here meant; `'default'` pins the
   * schema-default shape and `null` omits the field (a non-conforming
   * snapshot).
   */
  settingsSources?: Record<string, string | null>;
} = {}) {
  const services = new Map<string, unknown>();
  const readyHooks: Array<() => Promise<void> | void> = [];
  const actions = new Map<string, (input: any) => Promise<any>>();
  const subscriptions: Array<{ ns: string; fn: () => void }> = [];
  let values = opts.settingsValues;
  const sources = opts.settingsSources;

  if (values !== undefined) {
    services.set('settings', {
      async getNamespace(ns: string) {
        if (ns !== 'sms') throw new Error('unknown namespace');
        const wrapped: Record<string, { value: unknown; source?: string }> = {};
        for (const [k, v] of Object.entries(values ?? {})) {
          const src = sources && k in sources ? sources[k] : 'global';
          wrapped[k] = src === null ? { value: v } : { value: v, source: src };
        }
        return { values: wrapped };
      },
      subscribe(ns: string, fn: () => void) { subscriptions.push({ ns, fn }); return () => {}; },
      registerAction(ns: string, id: string, fn: (input: any) => Promise<any>) {
        actions.set(`${ns}/${id}`, fn);
      },
    });
  }

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const ctx = {
    logger,
    registerService(name: string, svc: unknown) { services.set(name, svc); },
    getService(name: string) {
      if (!services.has(name)) throw new Error(`service not found: ${name}`);
      return services.get(name);
    },
    hook(event: string, fn: () => Promise<void> | void) {
      if (event === 'kernel:ready') readyHooks.push(fn);
    },
  } as any;

  return {
    ctx,
    services,
    logger,
    actions,
    setValues: (v: Record<string, unknown>) => { values = v; },
    notifyChange: async () => { for (const s of subscriptions) s.fn(); await new Promise((r) => setTimeout(r, 0)); },
    fireReady: async () => { for (const fn of readyHooks) await fn(); },
  };
}

describe('SmsServicePlugin', () => {
  it('registers the sms service with the log fallback (unconfigured)', async () => {
    const { ctx, services } = fakeCtx();
    await new SmsServicePlugin().init(ctx);
    const svc = services.get('sms') as SmsService;
    expect(svc).toBeInstanceOf(SmsService);
    expect(svc.isConfigured()).toBe(false);
    expect(svc.options.transport).toBeInstanceOf(LogSmsTransport);
  });

  it('builds a provider transport from constructor options', async () => {
    const { ctx, services } = fakeCtx();
    await new SmsServicePlugin({
      provider: 'twilio',
      providerOptions: { accountSid: 'AC1', authToken: 't', from: '+15005550006' },
    }).init(ctx);
    const svc = services.get('sms') as SmsService;
    expect(svc.isConfigured()).toBe(true);
    expect(svc.options.transport).toBeInstanceOf(TwilioSmsTransport);
  });

  it('falls back to log (not a boot failure) on incomplete constructor credentials', async () => {
    const { ctx, services, logger } = fakeCtx();
    await new SmsServicePlugin({ provider: 'aliyun', providerOptions: {} }).init(ctx);
    const svc = services.get('sms') as SmsService;
    expect(svc.isConfigured()).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('rebuilds the transport from the sms settings namespace at kernel:ready', async () => {
    const harness = fakeCtx({
      settingsValues: {
        provider: 'aliyun',
        aliyun_access_key_id: 'ak',
        aliyun_access_key_secret: 'sec',
        aliyun_sign_name: '签名',
        aliyun_template_code: 'SMS_1',
      },
    });
    const plugin = new SmsServicePlugin();
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    await harness.fireReady();

    const svc = harness.services.get('sms') as SmsService;
    expect(svc.isConfigured()).toBe(true);
    expect(svc.options.transport).toBeInstanceOf(AliyunSmsTransport);
  });

  it('keeps the previous transport when settings are incomplete', async () => {
    const harness = fakeCtx({ settingsValues: { provider: 'twilio', twilio_account_sid: 'AC1' } });
    const plugin = new SmsServicePlugin();
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    await harness.fireReady();

    const svc = harness.services.get('sms') as SmsService;
    expect(svc.isConfigured()).toBe(false);
    expect(svc.options.transport).toBeInstanceOf(LogSmsTransport);
  });

  it('live-applies settings changes via subscribe', async () => {
    const harness = fakeCtx({ settingsValues: { provider: 'log' } });
    const plugin = new SmsServicePlugin();
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    await harness.fireReady();

    const svc = harness.services.get('sms') as SmsService;
    expect(svc.isConfigured()).toBe(false);

    harness.setValues({
      provider: 'twilio',
      twilio_account_sid: 'AC1',
      twilio_auth_token: 'tok',
      twilio_from_number: '+15005550006',
    });
    await harness.notifyChange();
    expect(svc.isConfigured()).toBe(true);
    expect(svc.options.transport).toBeInstanceOf(TwilioSmsTransport);
  });

  it('registers an sms/test action that validates the recipient', async () => {
    const harness = fakeCtx({ settingsValues: { provider: 'log' } });
    const plugin = new SmsServicePlugin();
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    await harness.fireReady();

    const test = harness.actions.get('sms/test');
    expect(test).toBeDefined();
    const bad = await test!({ values: { provider: 'log' }, payload: { to: 'not-a-phone' }, ctx: {} });
    expect(bad.ok).toBe(false);
    const good = await test!({ values: { provider: 'log' }, payload: { to: '+15005550006' }, ctx: {} });
    expect(good.ok).toBe(true);
    expect(good.message).not.toContain('5550006'); // masked
  });
});

describe('SmsServicePlugin — authored-value criterion (#5536)', () => {
  // The two criteria — old "values.provider === 'log'" and new
  // "source !== 'default'" — AGREE whenever an operator actually saved the
  // row, so these tests sit deliberately on the disagreement: the manifest
  // default `'log'`, a non-empty value nobody authored.
  const twilioOpts = {
    provider: 'twilio' as const,
    providerOptions: { accountSid: 'AC1', authToken: 't', from: '+15005550006' },
  };

  it('keeps the constructor-declared transport when provider is only the schema default', async () => {
    // THE card: `provider: 'log'` is non-empty, so the old criterion read it
    // as an operator selection and downgraded the deployment's declared
    // transport to LogSmsTransport on every boot of an unopened settings
    // page; `source: 'default'` says nobody made that decision.
    const harness = fakeCtx({
      settingsValues: { provider: 'log', daily_quota: 0 },
      settingsSources: { provider: 'default', daily_quota: 'default' },
    });
    const plugin = new SmsServicePlugin(twilioOpts);
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    await harness.fireReady();

    const svc = harness.services.get('sms') as SmsService;
    expect(svc.options.transport).toBeInstanceOf(TwilioSmsTransport);
    expect(svc.isConfigured()).toBe(true);
  });

  it('still downgrades when an operator actually saved provider=log (control)', async () => {
    // An admin-authored row: both criteria answer "configured", so this pins
    // byte-identical behaviour — a declared control, not fix evidence.
    const harness = fakeCtx({
      settingsValues: { provider: 'log' },
      settingsSources: { provider: 'global' },
    });
    const plugin = new SmsServicePlugin(twilioOpts);
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    await harness.fireReady();

    const svc = harness.services.get('sms') as SmsService;
    expect(svc.options.transport).toBeInstanceOf(LogSmsTransport);
    expect(svc.isConfigured()).toBe(false);
  });

  it('a snapshot with no source at all keeps the declared transport (reverse control)', async () => {
    // A non-conforming snapshot (no `source` anywhere) must land on the
    // conservative side, and the conservative side here KEEPS the transport
    // the deployment declared delivering: the other side's failure mode is
    // silently routing every send to the log transport on unattributable
    // authorship. An operator can still downgrade explicitly — a real save
    // always carries `source`.
    const harness = fakeCtx({
      settingsValues: { provider: 'log' },
      settingsSources: { provider: null },
    });
    const plugin = new SmsServicePlugin(twilioOpts);
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    await harness.fireReady();

    const svc = harness.services.get('sms') as SmsService;
    expect(svc.options.transport).toBeInstanceOf(TwilioSmsTransport);
  });

  it('daily_quota still binds by VALUE at source=default — the #2814 declination stands', async () => {
    // `sms-plugin.ts` deliberately declines to read `source` for the daily
    // cost ceiling (its comment cites #5536 by number): env-locked,
    // admin-saved and defaulted quotas are the same instruction to that
    // reader. Pinned so the authored-value criterion never creeps into the
    // quota path.
    const harness = fakeCtx({
      settingsValues: { provider: 'log', daily_quota: 1 },
      settingsSources: { provider: 'default', daily_quota: 'default' },
    });
    const plugin = new SmsServicePlugin();
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    await harness.fireReady();

    const svc = harness.services.get('sms') as SmsService;
    expect((await svc.send({ to: '+8613800000001', body: 'a' })).status).toBe('sent');
    expect((await svc.send({ to: '+8613800000002', body: 'b' })).status).toBe('failed');
  });
});

describe('SmsServicePlugin — daily quota binding (#2814)', () => {
  it('applies sms.daily_quota from settings at kernel:ready', async () => {
    const harness = fakeCtx({ settingsValues: { provider: 'log', daily_quota: 2 } });
    const plugin = new SmsServicePlugin();
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    await harness.fireReady();

    const svc = harness.services.get('sms') as SmsService;
    expect((await svc.send({ to: '+8613800000001', body: 'a' })).status).toBe('sent');
    expect((await svc.send({ to: '+8613800000002', body: 'b' })).status).toBe('sent');
    const refused = await svc.send({ to: '+8613800000003', body: 'c' });
    expect(refused.status).toBe('failed');
    expect(refused.error).toContain('TOO_MANY_REQUESTS');
  });

  it('live-applies a quota change without a restart', async () => {
    const harness = fakeCtx({ settingsValues: { provider: 'log', daily_quota: 1 } });
    const plugin = new SmsServicePlugin();
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    await harness.fireReady();

    const svc = harness.services.get('sms') as SmsService;
    await svc.send({ to: '+8613800000001', body: 'a' });
    expect((await svc.send({ to: '+8613800000002', body: 'b' })).status).toBe('failed');

    harness.setValues({ provider: 'log', daily_quota: 0 }); // admin lifts the cap
    await harness.notifyChange();
    expect((await svc.send({ to: '+8613800000003', body: 'c' })).status).toBe('sent');
  });

  it('binds the quota even when the host injected its own transport', async () => {
    // "How much may this deployment spend today" is an operator policy about
    // the deployment, not a property of whichever transport delivers — so the
    // host-transport short-circuit that skips the PROVIDER settings must not
    // skip this one.
    const send = vi.fn(async () => ({ messageId: 'host_1' }));
    const harness = fakeCtx({ settingsValues: { provider: 'aliyun', daily_quota: 1 } });
    const plugin = new SmsServicePlugin({ transport: { send } });
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    await harness.fireReady();

    const svc = harness.services.get('sms') as SmsService;
    expect((await svc.send({ to: '+8613800000001', body: 'a' })).status).toBe('sent');
    expect((await svc.send({ to: '+8613800000002', body: 'b' })).status).toBe('failed');
    // …and the injected transport is still the one that delivered.
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('degrades an unusable quota value to "no limit" and says so', async () => {
    const harness = fakeCtx({ settingsValues: { provider: 'log', daily_quota: -3 } });
    const plugin = new SmsServicePlugin();
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    await harness.fireReady();

    const svc = harness.services.get('sms') as SmsService;
    for (let i = 0; i < 5; i++) {
      expect((await svc.send({ to: '+8613800000001', body: 'x' })).status).toBe('sent');
    }
    const warned = harness.logger.warn.mock.calls.map((c: any[]) => String(c[0])).join('\n');
    expect(warned).toContain("daily_quota value '-3'");
  });

  it('an unset namespace leaves the gate off', async () => {
    const harness = fakeCtx({ settingsValues: { provider: 'log' } });
    const plugin = new SmsServicePlugin();
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    await harness.fireReady();

    const svc = harness.services.get('sms') as SmsService;
    for (let i = 0; i < 10; i++) {
      expect((await svc.send({ to: '+8613800000001', body: 'x' })).status).toBe('sent');
    }
  });
});
