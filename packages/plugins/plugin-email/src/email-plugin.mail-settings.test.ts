// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// EmailServicePlugin ↔ `mail` settings namespace (#5087).
//
// The gap this pins: the settings page offers a full SMTP form and SMTP is its
// DEFAULT provider, while `applyMailSettings` used to answer "transport
// unchanged" and `mail/test` answered "Configuration looks valid … wire
// @objectstack/plugin-mail for actual delivery" — a success toast for a mail
// nobody sent. Every assertion below is about that pair: a saved SMTP config
// must actually become the live transport, and every way it can fail to must
// be LOUD (error log + a failing test action), never a LogTransport reporting
// success.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmailServicePlugin } from './email-plugin.js';
import { EmailService, LogTransport } from './email-service.js';
import { SmtpTransport } from './transports/smtp.js';

const nm = vi.hoisted(() => ({ createTransport: vi.fn(), sendMail: vi.fn() }));
vi.mock('nodemailer', () => ({
  default: { createTransport: nm.createTransport },
  createTransport: nm.createTransport,
}));

// ── harness ────────────────────────────────────────────────────────────────

interface Resolved { value: unknown; source?: string }

function fakeSettings(values: Record<string, Resolved>) {
  const listeners: Array<() => void> = [];
  const actions = new Map<string, (a: any) => Promise<any>>();
  return {
    createClient: () => ({}),
    getNamespace: async () => ({ values }),
    subscribe: (_ns: string, cb: () => void) => { listeners.push(cb); },
    registerAction: (ns: string, id: string, fn: (a: any) => Promise<any>) => {
      actions.set(`${ns}/${id}`, fn);
    },
    /** Simulate a save: patch the snapshot and emit settings:changed. */
    async save(patch: Record<string, Resolved>) {
      Object.assign(values, patch);
      for (const l of listeners) l();
      // let the async re-apply settle
      await new Promise((r) => setTimeout(r, 0));
    },
    action: (id: string) => actions.get(`mail/${id}`),
  };
}

function fakeEngine() {
  const inserted: Array<{ object: string; row: any }> = [];
  const updated: Array<{ object: string; patch: any }> = [];
  return {
    inserted,
    updated,
    async insert(object: string, row: any) { inserted.push({ object, row }); return { id: row.id }; },
    async update(object: string, patch: any) { updated.push({ object, patch }); },
    async find() { return []; },
  };
}

function fakeCtx(services: Record<string, unknown>) {
  const hooks: Record<string, Array<() => Promise<void> | void>> = {};
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    logger,
    getService: <T,>(name: string): T => {
      if (!(name in services)) throw new Error(`service '${name}' not registered`);
      return services[name] as T;
    },
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    hook: (name: string, fn: () => Promise<void> | void) => { (hooks[name] ??= []).push(fn); },
    fire: async (name: string) => { for (const fn of hooks[name] ?? []) await fn(); },
  };
}

const MAIL_DEFAULTS: Record<string, Resolved> = {
  provider: { value: 'smtp', source: 'default' },
  smtp_port: { value: 587, source: 'default' },
  smtp_secure: { value: true, source: 'default' },
  from_email: { value: 'no-reply@example.test', source: 'global' },
  from_name: { value: 'ObjectStack', source: 'default' },
};

/** Boot the plugin against fake services and run its kernel:ready hook. */
async function boot(mailValues: Record<string, Resolved>, opts: any = {}) {
  const engine = fakeEngine();
  const settings = fakeSettings({ ...MAIL_DEFAULTS, ...mailValues });
  const services: Record<string, unknown> = {
    manifest: { register: () => {} },
    objectql: engine,
    settings,
  };
  const ctx = fakeCtx(services);
  const plugin = new EmailServicePlugin({ seedTemplates: false, ...opts });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  await ctx.fire('kernel:ready');
  const service = services.email as EmailService;
  return { plugin, ctx, engine, settings, service };
}

const transportOf = (service: EmailService) => service.options.transport;

beforeEach(() => {
  nm.createTransport.mockReset();
  nm.sendMail.mockReset();
  nm.createTransport.mockImplementation(() => ({ sendMail: nm.sendMail, close: vi.fn() }));
  nm.sendMail.mockResolvedValue({ messageId: '<wire-1@smtp>', response: '250 2.0.0 Ok' });
});

// ── hot swap ───────────────────────────────────────────────────────────────

describe('applyMailSettings — provider=smtp', () => {
  it('replaces the LogTransport with a real SmtpTransport built from the saved settings', async () => {
    const { service, ctx } = await boot({
      provider: { value: 'smtp', source: 'global' },
      smtp_host: { value: 'smtp.exmail.qq.com', source: 'global' },
      smtp_port: { value: 465, source: 'global' },
      smtp_secure: { value: true, source: 'global' },
      smtp_user: { value: 'ops@example.cn', source: 'global' },
      smtp_password: { value: 'sekrit', source: 'global' },
    });

    const transport = transportOf(service);
    expect(transport).toBeInstanceOf(SmtpTransport);
    expect((transport as SmtpTransport).describe()).toMatchObject({
      host: 'smtp.exmail.qq.com',
      port: 465,
      secure: true,
      auth: { user: 'ops@example.cn' },
    });
    expect(ctx.logger.error).not.toHaveBeenCalled();
  });

  it('re-swaps the transport when the settings are saved again (no restart)', async () => {
    const { service, settings } = await boot({
      provider: { value: 'smtp', source: 'global' },
      smtp_host: { value: 'smtp.first.test', source: 'global' },
    });
    expect((transportOf(service) as SmtpTransport).describe()).toMatchObject({ host: 'smtp.first.test' });

    await settings.save({ smtp_host: { value: 'smtp.second.test', source: 'global' } });

    expect(transportOf(service)).toBeInstanceOf(SmtpTransport);
    expect((transportOf(service) as SmtpTransport).describe()).toMatchObject({ host: 'smtp.second.test' });
  });

  it('delivers through the swapped-in transport and still records sys_email', async () => {
    const { service, engine } = await boot({
      provider: { value: 'smtp', source: 'global' },
      smtp_host: { value: 'smtp.163.com', source: 'global' },
    });

    const res = await service.send({
      to: 'user@example.test',
      subject: '【ObjectStack】您的验证码',
      html: '<p>你好,世界</p>',
    });

    expect(res.status).toBe('sent');
    expect(nm.sendMail).toHaveBeenCalledTimes(1);
    // The message handed to nodemailer keeps the authored UTF-8 text intact —
    // MIME/RFC 2047 encoding is nodemailer's job (proved on the wire in
    // smtp.wire.test.ts), never a lossy transform of ours.
    expect(nm.sendMail.mock.calls[0][0]).toMatchObject({
      subject: '【ObjectStack】您的验证码',
      html: '<p>你好,世界</p>',
      to: ['user@example.test'],
      from: 'ObjectStack <no-reply@example.test>',
    });

    // sys_email persistence survives the transport swap.
    const row = engine.inserted.find((r) => r.object === 'sys_email');
    expect(row?.row).toMatchObject({
      subject: '【ObjectStack】您的验证码',
      body_html: '<p>你好,世界</p>',
      status: 'queued',
    });
    expect(engine.updated[engine.updated.length - 1]?.patch).toMatchObject({
      status: 'sent',
      message_id: '<wire-1@smtp>',
    });
  });
});

describe('applyMailSettings — provider=smtp that cannot be built', () => {
  it('keeps the previous transport and logs at ERROR when SMTP was actually selected', async () => {
    const { service, ctx } = await boot({
      provider: { value: 'smtp', source: 'global' },
      // no smtp_host
    });

    expect(transportOf(service)).toBeInstanceOf(LogTransport);
    expect(ctx.logger.error).toHaveBeenCalledTimes(1);
    const line = ctx.logger.error.mock.calls[0][0] as string;
    // An error owes the consequence and the fix.
    expect(line).toMatch(/NO mail is delivered over SMTP/);
    expect(line).toMatch(/Settings → Mail → Host|OS_MAIL_SMTP_HOST/);
  });

  it('keeps a boot-configured SMTP transport when the settings page carries no host', async () => {
    // The deployment shape this feature enables: SMTP set through
    // OS_EMAIL_SMTP_* at boot, settings page never touched. Mail IS being
    // delivered, so there is nothing to report — an error here would be a
    // false alarm on every start.
    const { service, ctx } = await boot(
      { provider: { value: 'smtp', source: 'global' } },
      { provider: 'smtp', providerOptions: { host: 'smtp.boot.test' } },
    );
    expect((transportOf(service) as SmtpTransport).describe()).toMatchObject({ host: 'smtp.boot.test' });
    expect(ctx.logger.error).not.toHaveBeenCalled();
  });

  it('does not shout on the out-of-the-box default (provider never configured)', async () => {
    const { service, ctx } = await boot({});
    expect(transportOf(service)).toBeInstanceOf(LogTransport);
    expect(ctx.logger.error).not.toHaveBeenCalled();
    expect(ctx.logger.info.mock.calls.some((args: unknown[]) => /out-of-the-box state/.test(String(args[0]))))
      .toBe(true);
  });
});

describe('EmailServicePlugin constructor path (CLI / os serve)', () => {
  it('THROWS when provider=smtp has no host — a boot that cannot deliver fails loudly', async () => {
    const ctx = fakeCtx({ manifest: { register: () => {} } });
    const plugin = new EmailServicePlugin({ provider: 'smtp', seedTemplates: false });
    await expect(plugin.init(ctx as never)).rejects.toThrow(/requires a host/);
  });

  it('builds the SMTP transport from providerOptions', async () => {
    const services: Record<string, unknown> = { manifest: { register: () => {} } };
    const ctx = fakeCtx(services);
    const plugin = new EmailServicePlugin({
      provider: 'smtp',
      providerOptions: { host: 'smtp.aliyun.test', port: 465 },
      seedTemplates: false,
    });
    await plugin.init(ctx as never);
    expect(transportOf(services.email as EmailService)).toBeInstanceOf(SmtpTransport);
  });
});

// ── mail/test ──────────────────────────────────────────────────────────────

describe('mail/test action', () => {
  it('performs a REAL send through the form\'s SMTP settings', async () => {
    const { settings, engine } = await boot({
      provider: { value: 'smtp', source: 'global' },
      smtp_host: { value: 'smtp.example.cn', source: 'global' },
    });

    const result = await settings.action('test')!({
      values: { provider: 'smtp', smtp_host: 'smtp.example.cn', from_email: 'no-reply@example.test' },
      payload: { to: 'admin@example.test' },
    });

    expect(nm.sendMail).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, severity: 'info' });
    expect(result.message).toContain('smtp.example.cn');
    // A test send is a send: it lands in sys_email like any other.
    expect(engine.inserted.some((r) => r.object === 'sys_email')).toBe(true);
  });

  it('reports the SMTP server\'s own error when authentication fails', async () => {
    nm.sendMail.mockRejectedValue(new Error('Invalid login: 535 5.7.8 Error: authentication failed'));
    const { settings } = await boot({
      provider: { value: 'smtp', source: 'global' },
      smtp_host: { value: 'smtp.example.cn', source: 'global' },
    });

    const result = await settings.action('test')!({
      values: { provider: 'smtp', smtp_host: 'smtp.example.cn', smtp_user: 'u', smtp_password: 'bad', from_email: 'no-reply@example.test' },
      payload: { to: 'admin@example.test' },
    });

    expect(result.ok).toBe(false);
    expect(result.severity).toBe('error');
    expect(result.message).toMatch(/535 5\.7\.8 Error: authentication failed/);
  });

  it('refuses to "test" an SMTP config with no host', async () => {
    const { settings } = await boot({ provider: { value: 'smtp', source: 'global' } });
    const result = await settings.action('test')!({
      values: { provider: 'smtp', from_email: 'no-reply@example.test' },
      payload: { to: 'admin@example.test' },
    });
    expect(result).toMatchObject({ ok: false, severity: 'error' });
    expect(result.message).toMatch(/SMTP host is required/);
    expect(nm.sendMail).not.toHaveBeenCalled();
  });

  it('never reports success while only the LogTransport is active', async () => {
    const { settings } = await boot({ provider: { value: 'log', source: 'global' } });
    const result = await settings.action('test')!({
      values: { provider: 'log', from_email: 'no-reply@example.test' },
      payload: { to: 'admin@example.test' },
    });
    expect(result.ok).toBe(false);
    expect(result.severity).toBe('warning');
    expect(result.message).toMatch(/only logged/);
    // ...and the old lie is gone for good.
    expect(result.message).not.toMatch(/Configuration looks valid|plugin-mail/);
  });
});
