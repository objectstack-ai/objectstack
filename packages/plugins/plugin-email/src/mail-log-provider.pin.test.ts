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
  let liveStatus: (() => Promise<LiveMailTransportStatus | undefined>) | undefined;
  return {
    values,
    createClient: () => ({}),
    getNamespace: async () => ({ values }),
    subscribe: (_ns: string, cb: () => void) => { listeners.push(cb); },
    registerAction: (ns: string, id: string, fn: (a: any) => Promise<any>) => { actions.set(`${ns}/${id}`, fn); },
    registerLiveStatus: (ns: string, fn: () => Promise<LiveMailTransportStatus | undefined>) => {
      if (ns === 'mail') liveStatus = fn;
    },
    /** Patch the snapshot and emit settings:changed, as a page save does. */
    save(patch: Record<string, Resolved>) {
      Object.assign(values, patch);
      for (const l of listeners) l();
    },
    /** What the page states, as the settings GET route asks for it (waits for a running re-apply). */
    statement: () => liveStatus!(),
    /** The "Send test email" answer for the stored values, with nothing edited on the form. */
    sendTest: () => actions.get('mail/test')!({
      values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.value])),
      payload: { to: 'admin@example.test' },
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
