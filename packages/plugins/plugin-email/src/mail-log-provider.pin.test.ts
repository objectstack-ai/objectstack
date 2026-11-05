// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// Setup → Email offers the provider `log` as "None (log only — no real
// delivery)". Saving it after a boot with SMTP used to keep the SMTP transport
// live: the re-apply logged "transport unchanged — … never delivered" while
// every message kept going out over SMTP. These pins hold the four readings of
// one save to one answer — the live transport, the page's live-status
// statement, the re-apply's log line and the "Send test email" answer — after
// a boot with SMTP from the settings page, from the boot options
// (`OS_EMAIL_SMTP_*` reaches the plugin as `providerOptions`), and from the
// host. The CONTROL is a boot with no SMTP at all.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmailServicePlugin, type EmailServicePluginOptions } from './email-plugin.js';
import { EmailService, LogTransport } from './email-service.js';
import { SmtpTransport } from './transports/smtp.js';
import type { LiveMailTransportStatus } from './live-transport-status.js';

const nm = vi.hoisted(() => ({ createTransport: vi.fn(), sendMail: vi.fn() }));
vi.mock('nodemailer', () => ({
  default: { createTransport: nm.createTransport },
  createTransport: nm.createTransport,
}));

interface Resolved { value: unknown; source?: string }

function fakeSettings(values: Record<string, Resolved>) {
  const listeners: Array<() => void> = [];
  const actions = new Map<string, (a: any) => Promise<any>>();
  type LiveStatusFn = (input?: { locale?: string }) => Promise<LiveMailTransportStatus | undefined>;
  let liveStatus: LiveStatusFn | undefined;
  return {
    values,
    createClient: () => ({}),
    getNamespace: async () => ({ values }),
    subscribe: (_ns: string, cb: () => void) => { listeners.push(cb); },
    registerAction: (ns: string, id: string, fn: (a: any) => Promise<any>) => { actions.set(`${ns}/${id}`, fn); },
    registerLiveStatus: (ns: string, fn: LiveStatusFn) => {
      if (ns === 'mail') liveStatus = fn;
    },
    /** Patch the snapshot and emit settings:changed, as a page save does. */
    save(patch: Record<string, Resolved>) {
      Object.assign(values, patch);
      for (const l of listeners) l();
    },
    /**
     * What the page states, as the settings GET route asks for it (waits for a
     * running re-apply), in the caller's display `locale` when one is given.
     */
    statement: (locale?: string) => liveStatus!(locale ? { locale } : undefined),
    /**
     * The "Send test email" answer for the stored values — with nothing edited
     * on the form, or with `form` as the unsaved form state the page posts —
     * in the caller's display `locale` when one is given.
     */
    sendTest: (form?: Record<string, unknown>, locale?: string) => actions.get('mail/test')!({
      values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.value])),
      payload: form ? { to: 'admin@example.test', values: form } : { to: 'admin@example.test' },
      ...(locale ? { locale } : {}),
    }),
  };
}

async function boot(mail: Record<string, Resolved>, opts: EmailServicePluginOptions = {}) {
  const settings = fakeSettings({
    provider: { value: 'smtp', source: 'default' },
    smtp_port: { value: 587, source: 'default' },
    from_email: { value: 'no-reply@example.test', source: 'global' },
    ...mail,
  });
  // The settings binding waits for an engine; nothing here writes a row
  // (`persist: false` below), so it answers reads only.
  const engine = { async find() { return []; } };
  const services: Record<string, unknown> = { manifest: { register: () => {} }, objectql: engine, settings };
  const hooks: Record<string, Array<() => Promise<void> | void>> = {};
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const ctx = {
    logger,
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
  return { settings, logger, service: services.email as EmailService };
}

/** The re-apply's line for a `log` save — the last info line naming provider=log. */
function logLine(logger: { info: ReturnType<typeof vi.fn> }): string {
  const lines = logger.info.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('provider=log'));
  expect(lines.length).toBeGreaterThan(0);
  return lines[lines.length - 1];
}

const SAVE_LOG = { provider: { value: 'log', source: 'global' } };

/** Every reading of a `log` save that replaced a delivering transport says mail stopped — and it did. */
async function expectMailStopped(h: Awaited<ReturnType<typeof boot>>) {
  const statement = await h.settings.statement();
  // The transport.
  expect(h.service.options.transport).toBeInstanceOf(LogTransport);
  expect(h.service.isConfigured()).toBe(false);
  // The page.
  expect(statement?.label).toBe('No mail leaves this machine');
  expect(statement?.bannerSeverity).toBe('warning');
  // The log line.
  const line = logLine(h.logger);
  expect(line).toMatch(/replaces the previous live transport/);
  expect(line).toMatch(/never delivered/);
  // The answer.
  nm.sendMail.mockClear();
  const answer = await h.settings.sendTest();
  expect(answer).toMatchObject({ ok: false, severity: 'warning' });
  expect(answer.message).toMatch(/only logged/);
  expect(nm.sendMail).not.toHaveBeenCalled();
}

beforeEach(() => {
  nm.createTransport.mockReset();
  nm.sendMail.mockReset();
  nm.createTransport.mockImplementation(() => ({ sendMail: nm.sendMail, close: vi.fn() }));
  nm.sendMail.mockResolvedValue({ messageId: '<wire-1@smtp>', response: '250 2.0.0 Ok' });
});

describe('saving provider "log" after a boot with SMTP stops delivery', () => {
  it('SMTP saved on the settings page: the save installs the LogTransport', async () => {
    const h = await boot({
      provider: { value: 'smtp', source: 'global' },
      smtp_host: { value: 'smtp.saved.test', source: 'global' },
    });
    expect(h.service.options.transport).toBeInstanceOf(SmtpTransport);
    expect((await h.settings.statement())?.label).toBe('Mail is delivered through SMTP (smtp.saved.test:587)');

    h.settings.save(SAVE_LOG);
    await expectMailStopped(h);
    expect(logLine(h.logger)).toMatch(/was: "Mail is delivered through SMTP \(smtp\.saved\.test:587\)"/);
  });

  it('SMTP built at boot from the boot options (OS_EMAIL_SMTP_*): the save installs the LogTransport', async () => {
    const h = await boot({}, { provider: 'smtp', providerOptions: { host: 'smtp.env.test', port: 2525 } });
    // The out-of-the-box namespace (no host) keeps the boot-built SMTP.
    expect(h.service.options.transport).toBeInstanceOf(SmtpTransport);
    expect((await h.settings.statement())?.label).toBe('Mail is delivered through SMTP (smtp.env.test:2525)');

    h.settings.save(SAVE_LOG);
    await expectMailStopped(h);
  });

  it('a transport the host supplied: the save installs the LogTransport', async () => {
    const send = vi.fn(async () => ({ messageId: '<host@x>' }));
    const h = await boot({}, { transport: { send } as never });
    expect(h.service.isConfigured()).toBe(true);

    h.settings.save(SAVE_LOG);
    await expectMailStopped(h);
    expect(send).not.toHaveBeenCalled();
  });

  it('a restart with "log" stored and SMTP in the boot options boots onto the LogTransport', async () => {
    const h = await boot(SAVE_LOG, { provider: 'smtp', providerOptions: { host: 'smtp.env.test' } });
    await expectMailStopped(h);
  });
});

describe('CONTROL — saving provider "log" after a boot with no SMTP', () => {
  it('the LogTransport stays live, and every reading says nothing is delivered', async () => {
    const h = await boot({});
    const bootTransport = h.service.options.transport;
    expect(bootTransport).toBeInstanceOf(LogTransport);

    h.settings.save(SAVE_LOG);
    const statement = await h.settings.statement();
    expect(h.service.options.transport).toBe(bootTransport);
    expect(h.service.isConfigured()).toBe(false);
    expect(statement?.label).toBe('No mail leaves this machine');
    const line = logLine(h.logger);
    expect(line).toMatch(/the LogTransport stays live/);
    expect(line).toMatch(/never delivered/);
    const answer = await h.settings.sendTest();
    expect(answer).toMatchObject({ ok: false, severity: 'warning' });
    expect(nm.sendMail).not.toHaveBeenCalled();
  });
});

// "Send test email" tests the FORM's choice, saved or not. With "None (log
// only)" picked and not saved, the test used to go through the live service —
// a real mail over a live SMTP, answered `ok: true`.
describe('"Send test email" with provider "log" on the form, not saved, while SMTP is live', () => {
  const SMTP_SAVED = {
    provider: { value: 'smtp', source: 'global' },
    smtp_host: { value: 'smtp.saved.test', source: 'global' },
  };

  it('sends nothing, and the answer says nothing was delivered', async () => {
    const h = await boot(SMTP_SAVED);
    expect(h.service.options.transport).toBeInstanceOf(SmtpTransport);
    nm.sendMail.mockClear();

    const answer = await h.settings.sendTest({ provider: 'log' });
    expect(nm.sendMail).not.toHaveBeenCalled();
    expect(answer).toMatchObject({ ok: false, severity: 'warning' });
    expect(answer.message).toMatch(/^Nothing was delivered/);
    expect(answer.message).toMatch(/no mail left this machine/);
    expect(answer.message).toMatch(/Mail is delivered through SMTP \(smtp\.saved\.test:587\)/);
    // A test changes nothing: the live transport is still the saved SMTP.
    expect(h.service.options.transport).toBeInstanceOf(SmtpTransport);
  });

  it('SMTP built at boot from the boot options: sends nothing either', async () => {
    const h = await boot({}, { provider: 'smtp', providerOptions: { host: 'smtp.env.test', port: 2525 } });
    expect(h.service.options.transport).toBeInstanceOf(SmtpTransport);
    nm.sendMail.mockClear();

    const answer = await h.settings.sendTest({ provider: 'log' });
    expect(nm.sendMail).not.toHaveBeenCalled();
    expect(answer).toMatchObject({ ok: false, severity: 'warning' });
    expect(answer.message).toMatch(/^Nothing was delivered/);
  });

  it('CONTROL — provider "smtp" with a host on the form still sends', async () => {
    const h = await boot(SMTP_SAVED);
    nm.sendMail.mockClear();

    const answer = await h.settings.sendTest({ provider: 'smtp', smtp_host: 'smtp.form.test', smtp_port: 587 });
    expect(nm.sendMail).toHaveBeenCalledTimes(1);
    expect(answer).toMatchObject({ ok: true, severity: 'info' });
    expect(answer.message).toMatch(/^Sent test email to admin@example\.test via smtp \(smtp\.form\.test:587\)/);
  });
});

// Setup → Email in the caller's display language. The page's statement and the
// "Send test email" answer are both composed here, per request, so both take
// the locale the settings routes read from the request (`Accept-Language`,
// else `?locale`). English stays the answer for no locale and for a language
// this plugin ships no copy for.
describe('Setup → Email answers in the caller\'s language (zh-CN)', () => {
  const HAN = /[一-鿿]/;
  const SMTP_SAVED = {
    provider: { value: 'smtp', source: 'global' },
    smtp_host: { value: 'smtp.saved.test', source: 'global' },
  };

  it('the out-of-the-box statement says, in Chinese, that no mail is sent', async () => {
    const h = await boot({});
    const statement = await h.settings.statement('zh-CN');
    expect(statement?.label).toBe('当前不会发出任何邮件');
    expect(statement?.bannerSeverity).toBe('warning');
    expect(statement?.bannerText).toMatch(HAN);
    expect(statement?.bannerText).not.toMatch(/live transport|sys_email/);
  });

  it('a delivering transport is named in a Chinese statement', async () => {
    const h = await boot(SMTP_SAVED);
    const statement = await h.settings.statement('zh-CN');
    expect(statement?.label).toBe('邮件通过 SMTP (smtp.saved.test:587) 投递');
    expect(statement?.bannerSeverity).toBe('info');
    expect(statement?.bannerText).toMatch(HAN);
  });

  it('the test toast reports the send in Chinese', async () => {
    const h = await boot(SMTP_SAVED);
    nm.sendMail.mockClear();
    const answer = await h.settings.sendTest(
      { provider: 'smtp', smtp_host: 'smtp.form.test', smtp_port: 587 },
      'zh-CN',
    );
    expect(nm.sendMail).toHaveBeenCalledTimes(1);
    expect(answer).toMatchObject({ ok: true, severity: 'info' });
    expect(answer.message).toMatch(/^测试邮件已发送至 admin@example\.test，经由 smtp \(smtp\.form\.test:587\)/);
    expect(answer.message).not.toMatch(/Sent test email/);
  });

  it('"None (log only)" on the form: the warning is Chinese and names the live transport in Chinese', async () => {
    const h = await boot(SMTP_SAVED);
    nm.sendMail.mockClear();
    const answer = await h.settings.sendTest({ provider: 'log' }, 'zh-CN');
    expect(nm.sendMail).not.toHaveBeenCalled();
    expect(answer).toMatchObject({ ok: false, severity: 'warning' });
    expect(answer.message).toMatch(/^没有投递任何邮件/);
    expect(answer.message).toContain('邮件通过 SMTP (smtp.saved.test:587) 投递');
  });

  it('CONTROL — a language with no copy answers in English', async () => {
    const h = await boot({});
    expect((await h.settings.statement('fr-FR'))?.label).toBe('No mail leaves this machine');
  });
});
