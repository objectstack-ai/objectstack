// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// Setup → Email states which transport is LIVE. The out-of-the-box `mail`
// namespace stores provider `smtp` with an empty host, so the form reads as
// SMTP while every message goes to the development log and is recorded as
// sent. This pins the page's reading of `IEmailService.isConfigured()`: the
// statement this plugin registers through `registerLiveStatus`, and that it
// follows a transport swap made from the same page.

import { describe, it, expect, vi } from 'vitest';
import { EmailServicePlugin } from './email-plugin.js';
import { EmailService, LogTransport } from './email-service.js';
import { SmtpTransport } from './transports/smtp.js';
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

async function boot(mailValues: Record<string, Resolved>) {
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
  const plugin = new EmailServicePlugin({});
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
