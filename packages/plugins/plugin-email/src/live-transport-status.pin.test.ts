// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// Setup → Email states which transport is LIVE. The out-of-the-box `mail`
// namespace stores provider `smtp` with an empty host, so the form reads as
// SMTP while every message goes to the development log and is recorded as
// sent. This pins the page's reading of `IEmailService.isConfigured()`: the
// statement this plugin registers through `registerLiveStatus`, and that it
// follows a transport swap made from the same page.

import { describe, it, expect, vi } from 'vitest';
import type {
  IEmailTransport, IHttpServer, IHttpRequest, IHttpResponse, RouteHandler,
} from '@objectstack/spec/contracts';
import { SettingsNamespacePayloadSchema } from '@objectstack/spec/system';
import { SettingsService, mailSettingsManifest, registerSettingsRoutes } from '@objectstack/service-settings';
import { EmailServicePlugin, type EmailServicePluginOptions } from './email-plugin.js';
import { EmailService, LogTransport } from './email-service.js';
import { SmtpTransport } from './transports/smtp.js';
import { ResendTransport } from './transports/resend.js';
import {
  describeLiveMailTransport,
  mailDeliveryCopy,
  MAIL_DELIVERY_COPY,
  type LiveMailTransportStatus,
  type MailDeliveryCopy,
  type MailDeliveryCopyLocale,
} from './live-transport-status.js';
import { PLATFORM_LOCALE_TAGS, type PlatformLocaleTag } from '@objectstack/spec/system';

vi.mock('nodemailer', () => {
  const createTransport = vi.fn(() => ({ sendMail: vi.fn(), close: vi.fn() }));
  return { default: { createTransport }, createTransport };
});

interface Resolved { value: unknown; source?: string }

function fakeSettings(values: Record<string, Resolved>) {
  const listeners: Array<() => void> = [];
  let liveStatus: (() => Promise<LiveMailTransportStatus | undefined>) | undefined;
  return {
    createClient: () => ({}),
    getNamespace: async () => ({ values }),
    subscribe: (_ns: string, cb: () => void) => { listeners.push(cb); },
    registerAction: () => {},
    registerLiveStatus: (ns: string, fn: () => Promise<LiveMailTransportStatus | undefined>) => {
      if (ns === 'mail') liveStatus = fn;
    },
    /** Patch the snapshot and emit settings:changed, WITHOUT waiting for the re-apply. */
    emitSave(patch: Record<string, Resolved>) {
      Object.assign(values, patch);
      for (const l of listeners) l();
    },
    /** What the page states, as the settings GET route asks for it. */
    read: () => liveStatus!(),
    get registered() { return liveStatus !== undefined; },
  };
}

async function boot(mailValues: Record<string, Resolved>, opts: EmailServicePluginOptions = {}) {
  const settings = fakeSettings({
    provider: { value: 'smtp', source: 'default' },
    smtp_port: { value: 587, source: 'default' },
    from_email: { value: 'no-reply@example.test', source: 'global' },
    ...mailValues,
  });
  // Only what this boot reads: the settings binding waits for an engine, and
  // nothing in these tests writes a row.
  const engine = { async find() { return []; } };
  const services: Record<string, unknown> = { manifest: { register: () => {} }, objectql: engine, settings };
  const hooks: Record<string, Array<() => Promise<void> | void>> = {};
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    getService: <T,>(name: string): T => {
      if (!(name in services)) throw new Error(`service '${name}' not registered`);
      return services[name] as T;
    },
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    hook: (name: string, fn: () => Promise<void> | void) => { (hooks[name] ??= []).push(fn); },
  };
  const plugin = new EmailServicePlugin(opts);
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  for (const fn of hooks['kernel:ready'] ?? []) await fn();
  return { settings, service: services.email as EmailService };
}

describe('describeLiveMailTransport — the reading of isConfigured()', () => {
  it('isConfigured() false: says nothing leaves this machine', () => {
    const svc = new EmailService({ transport: new LogTransport() });
    expect(svc.isConfigured()).toBe(false);
    const s = describeLiveMailTransport(svc);
    expect(s.bannerSeverity).toBe('warning');
    expect(s.label).toBe('No mail leaves this machine');
  });

  it('isConfigured() true: names the live transport', () => {
    const svc = new EmailService({ transport: new SmtpTransport({ host: 'smtp.example.test', port: 2525 }) });
    expect(svc.isConfigured()).toBe(true);
    const s = describeLiveMailTransport(svc);
    expect(s.bannerSeverity).toBe('info');
    expect(s.label).toBe('Mail is delivered through SMTP (smtp.example.test:2525)');
  });

  it('the branch is isConfigured(), not the transport class', () => {
    const smtp = new SmtpTransport({ host: 'smtp.example.test' });
    expect(describeLiveMailTransport({ isConfigured: () => false, options: { transport: smtp } }).label)
      .toBe('No mail leaves this machine');
    expect(describeLiveMailTransport({ isConfigured: () => true, options: { transport: new LogTransport() } }).bannerSeverity)
      .toBe('info');
  });
});

describe('EmailServicePlugin — the statement Setup → Email makes', () => {
  // A save the server accepts can still fail to build a transport here (a
  // stored provider with no key, as an older release could save it); the
  // previous transport stays live. Driven through the fake settings surface,
  // because the served door refuses such a save before the plugin sees it.
  it("a save that cannot replace a settings-built transport keeps it live but states no provider: 'settings' would be stale", async () => {
    const { settings, service } = await boot({
      provider: { value: 'smtp', source: 'global' },
      smtp_host: { value: 'smtp.saved.test', source: 'global' },
    });
    expect((await settings.read())?.values).toEqual({ provider: { value: 'smtp', source: 'settings' } });
    settings.emitSave({ provider: { value: 'postmark', source: 'global' } });
    const statement = await settings.read();
    expect(service.options.transport).toBeInstanceOf(SmtpTransport);
    expect(statement?.bannerSeverity).toBe('info');
    expect(statement?.values).toBeUndefined();
  });

  it("a save that cannot replace the boot transport leaves it 'environment'", async () => {
    const { settings } = await boot({}, { provider: 'smtp', providerOptions: { host: 'smtp.boot.test' } });
    settings.emitSave({ provider: { value: 'postmark', source: 'global' } });
    expect((await settings.read())?.values).toEqual({ provider: { value: 'smtp', source: 'environment' } });
  });

  it('the out-of-the-box state (provider smtp, no host) says nothing leaves this machine', async () => {
    const { settings, service } = await boot({});
    expect(settings.registered).toBe(true);
    expect(service.isConfigured()).toBe(false);
    expect((await settings.read())?.label).toBe('No mail leaves this machine');
  });

  it('follows a transport swap saved from the same page, read before the re-apply settles', async () => {
    const { settings, service } = await boot({});
    expect((await settings.read())?.bannerSeverity).toBe('warning');

    settings.emitSave({
      provider: { value: 'smtp', source: 'global' },
      smtp_host: { value: 'smtp.saved.test', source: 'global' },
    });
    // The re-apply is still running here; the statement waits for it.
    const after = await settings.read();
    expect(service.isConfigured()).toBe(true);
    expect(after?.bannerSeverity).toBe('info');
    expect(after?.label).toBe('Mail is delivered through SMTP (smtp.saved.test:587)');
  });
});

// Setup → Email's words carry every language on the platform locale table, and
// a caller's code finds its own language's entry: `zh-TW` the Traditional one
// (never the Simplified), a stored alias its table language, anything else
// English.
describe('Setup → Email copy carries the eleven platform languages', () => {
  const KEY_OF_TAG: Record<PlatformLocaleTag, MailDeliveryCopyLocale> = {
    en: 'en', 'zh-Hans': 'zh-CN', 'zh-Hant': 'zh-Hant', es: 'es-ES', ar: 'ar', fr: 'fr',
    'pt-BR': 'pt-BR', ru: 'ru', de: 'de', ja: 'ja-JP', ko: 'ko',
  };
  const KEYS = PLATFORM_LOCALE_TAGS.map((tag) => KEY_OF_TAG[tag]);
  /** Every sentence of an entry, its functions called with sample arguments. */
  const sentences = (copy: MailDeliveryCopy): Record<string, string> => ({
    hostTransport: copy.hostTransport,
    noMailLabel: copy.noMailLabel,
    noMailText: copy.noMailText,
    deliveredLabel: copy.deliveredLabel('Resend'),
    deliveredText: copy.deliveredText('Resend'),
    testSent: copy.testSent('admin@example.test', 'resend', 'msg_1'),
    testSentLive: copy.testSent('admin@example.test', undefined, 'msg_1'),
    testFailed: copy.testFailed('resend', 'refused'),
    testFailedLive: copy.testFailed(undefined, 'refused'),
    testLoggedLive: copy.testLoggedLive,
    testLoggedForm: copy.testLoggedForm('Resend'),
  });

  it('has exactly one entry per platform locale table language', () => {
    expect(Object.keys(MAIL_DELIVERY_COPY).sort()).toEqual([...KEYS].sort());
    expect(KEYS).toHaveLength(11);
  });

  it('every entry carries every sentence, written in its own language (no English fill)', () => {
    const en = sentences(MAIL_DELIVERY_COPY.en);
    for (const key of KEYS) {
      for (const [field, text] of Object.entries(sentences(MAIL_DELIVERY_COPY[key]))) {
        expect(text.trim(), `${key}.${field}`).not.toBe('');
        if (key !== 'en') expect(text, `${key}.${field}`).not.toBe(en[field]);
      }
    }
  });

  it('each table tag and stored alias is served its own language; zh-TW never the Simplified entry', () => {
    for (const tag of PLATFORM_LOCALE_TAGS) expect(mailDeliveryCopy(tag), tag).toBe(MAIL_DELIVERY_COPY[KEY_OF_TAG[tag]]);
    for (const [code, key] of [
      ['zh-TW', 'zh-Hant'], ['zh-HK', 'zh-Hant'], ['zh-CN', 'zh-CN'], ['zh', 'zh-CN'],
      ['ja-JP', 'ja-JP'], ['es-ES', 'es-ES'], ['pt', 'pt-BR'], ['en-US', 'en'], ['fr-CA', 'fr'],
    ] as const) {
      expect(mailDeliveryCopy(code), code).toBe(MAIL_DELIVERY_COPY[key]);
    }
    expect(mailDeliveryCopy('zh-TW')).not.toBe(MAIL_DELIVERY_COPY['zh-CN']);
  });

  it('a code naming no language here, or none at all, is served English', () => {
    for (const code of ['xx', 'sw-KE', undefined]) expect(mailDeliveryCopy(code), String(code)).toBe(MAIL_DELIVERY_COPY.en);
  });
});

// GET /api/settings/mail states the provider in use as `live.provider`, in the
// shape the `ai` namespace's runtime states its provider in
// (service-settings' `settings-routes.live-status.pin.test.ts`): `{ value,
// source }`, `value` one of the `provider` options. A hosted tenant's
// first-run checklist reads mail as configured from it, as it reads the
// built-in AI. Driven through the SERVED door: a real `SettingsService` with
// the real `mail` manifest, its real REST routes, and the live status this
// plugin registers at `kernel:ready`.
describe('GET /api/settings/mail — live.provider states the provider in use', () => {
  class MockHttp implements IHttpServer {
    routes = new Map<string, RouteHandler>();
    private add(method: string, path: string, handler: RouteHandler) { this.routes.set(`${method} ${path}`, handler); }
    get(path: string, h: RouteHandler) { this.add('GET', path, h); return this as any; }
    post(path: string, h: RouteHandler) { this.add('POST', path, h); return this as any; }
    put(path: string, h: RouteHandler) { this.add('PUT', path, h); return this as any; }
    delete(path: string, h: RouteHandler) { this.add('DELETE', path, h); return this as any; }
    patch(path: string, h: RouteHandler) { this.add('PATCH', path, h); return this as any; }
    use() { return this as any; }
    listen() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
    getInstance() { return null; }
  }

  /** Boot the plugin against a real settings service holding `saved`, and mount its routes. */
  async function serve(
    saved: Record<string, unknown>,
    opts: EmailServicePluginOptions = {},
    env: Record<string, string> = {},
  ) {
    const settings = new SettingsService({ env });
    settings.registerManifest(mailSettingsManifest);
    if (Object.keys(saved).length > 0) await settings.setMany('mail', saved);
    const engine = { async find() { return []; } };
    const services: Record<string, unknown> = { manifest: { register: () => {} }, objectql: engine, settings };
    const hooks: Record<string, Array<() => Promise<void> | void>> = {};
    const ctx = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      getService: <T,>(name: string): T => {
        if (!(name in services)) throw new Error(`service '${name}' not registered`);
        return services[name] as T;
      },
      registerService: (name: string, svc: unknown) => { services[name] = svc; },
      hook: (name: string, fn: () => Promise<void> | void) => { (hooks[name] ??= []).push(fn); },
    };
    const plugin = new EmailServicePlugin({ persist: false, ...opts });
    await plugin.init(ctx as never);
    await plugin.start(ctx as never);
    for (const fn of hooks['kernel:ready'] ?? []) await fn();

    const http = new MockHttp();
    registerSettingsRoutes(http, settings, {
      contextFromRequest: () => ({ enforced: true, permissions: ['manage_platform_settings'], userId: 'usr_admin' }),
    });
    /** GET /api/settings/mail as the console reads it. */
    const read = async () => {
      const captured: { status: number; body: any } = { status: 200, body: undefined };
      const res: IHttpResponse = {
        json: vi.fn((data: any) => { captured.body = data; }) as any,
        send: vi.fn() as any,
        status: vi.fn((code: number) => { captured.status = code; return res; }) as any,
        header: vi.fn(() => res) as any,
      };
      const req: IHttpRequest = {
        params: { namespace: 'mail' }, query: {}, body: undefined, headers: {}, method: 'GET', path: '/api/settings/mail',
      };
      await http.routes.get('GET /api/settings/:namespace')!(req, res);
      expect(captured.status).toBe(200);
      expect(SettingsNamespacePayloadSchema.safeParse(captured.body.data).success).toBe(true);
      return captured.body.data as { live?: Record<string, unknown>; manifest: { specifiers: any[] } };
    };
    return { settings, read, service: services.email as EmailService };
  }

  /** The live-status banner heading the page: its fields are unchanged by the new statement. */
  const banner = (data: { manifest: { specifiers: any[] } }) => {
    const first = data.manifest.specifiers[0];
    expect(first).toMatchObject({ type: 'info_banner', id: 'live_status' });
    return { label: first.label, bannerSeverity: first.bannerSeverity };
  };

  it("none: the out-of-the-box boot delivers nothing, and says so as { value: null, source: 'none' }", async () => {
    const { read } = await serve({});
    const data = await read();
    expect(data.live).toEqual({ provider: { value: null, source: 'none' } });
    expect(banner(data)).toEqual({ label: 'No mail leaves this machine', bannerSeverity: 'warning' });
  });

  it("environment: SMTP the boot built (OS_EMAIL_SMTP_* / the stack's email block) reads as source 'environment'", async () => {
    const { read } = await serve({}, { provider: 'smtp', providerOptions: { host: 'smtp.boot.test', port: 2525 } });
    const data = await read();
    expect(data.live).toEqual({ provider: { value: 'smtp', source: 'environment' } });
    expect(banner(data)).toEqual({ label: 'Mail is delivered through SMTP (smtp.boot.test:2525)', bannerSeverity: 'info' });
  });

  it("environment: a stock transport the host hands over reads as the option that names it", async () => {
    const { read } = await serve({}, { transport: new ResendTransport({ apiKey: 're_test_key' }) });
    expect((await read()).live).toEqual({ provider: { value: 'resend', source: 'environment' } });
  });

  it("settings: SMTP saved on the page reads as source 'settings'", async () => {
    const { read } = await serve({ provider: 'smtp', smtp_host: 'smtp.saved.test', from_email: 'no-reply@acme.test' });
    const data = await read();
    expect(data.live).toEqual({ provider: { value: 'smtp', source: 'settings' } });
    expect(banner(data)).toEqual({ label: 'Mail is delivered through SMTP (smtp.saved.test:587)', bannerSeverity: 'info' });
  });

  it("settings: an API provider the namespace resolves (OS_MAIL_*-locked) reads as the option that names it", async () => {
    const { read } = await serve({}, {}, { OS_MAIL_PROVIDER: 'resend', OS_MAIL_API_KEY: 're_locked_key' });
    const data = await read();
    expect(data.live).toEqual({ provider: { value: 'resend', source: 'settings' } });
    expect(JSON.stringify(data.live)).not.toContain('re_locked_key');
  });

  it("settings: an OS_MAIL_*-locked SMTP host is what the namespace resolves, so it reads 'settings'", async () => {
    const { read } = await serve({}, {}, { OS_MAIL_PROVIDER: 'smtp', OS_MAIL_SMTP_HOST: 'smtp.locked.test' });
    expect((await read()).live).toEqual({ provider: { value: 'smtp', source: 'settings' } });
  });

  it('follows a save: a boot SMTP replaced from the page reads settings, then "None (log only)" reads none', async () => {
    const { settings, read } = await serve({}, { provider: 'smtp', providerOptions: { host: 'smtp.boot.test' } });
    expect((await read()).live).toEqual({ provider: { value: 'smtp', source: 'environment' } });
    await settings.setMany('mail', { provider: 'smtp', smtp_host: 'smtp.saved.test' });
    expect((await read()).live).toEqual({ provider: { value: 'smtp', source: 'settings' } });
    await settings.setMany('mail', { provider: 'log' });
    const data = await read();
    expect(data.live).toEqual({ provider: { value: null, source: 'none' } });
    expect(banner(data)).toEqual({ label: 'No mail leaves this machine', bannerSeverity: 'warning' });
  });

  it("states nothing for a transport no option names, or one this plugin did not install: unknown is not 'none'", async () => {
    const own: IEmailTransport = { send: async () => ({ messageId: 'host-own-1' }) } as never;
    const hosted = await serve({}, { transport: own });
    const data = await hosted.read();
    expect('live' in data).toBe(false);
    // The banner still names the host's transport.
    expect(banner(data).bannerSeverity).toBe('info');

    const swapped = await serve({}, { provider: 'smtp', providerOptions: { host: 'smtp.boot.test' } });
    swapped.service.setTransport(new SmtpTransport({ host: 'smtp.elsewhere.test' }));
    expect('live' in (await swapped.read())).toBe(false);
  });
});
