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
import { ResendTransport } from './transports/resend.js';

const nm = vi.hoisted(() => ({ createTransport: vi.fn(), sendMail: vi.fn() }));
vi.mock('nodemailer', () => ({
  default: { createTransport: nm.createTransport },
  createTransport: nm.createTransport,
}));

// ── harness ────────────────────────────────────────────────────────────────

interface Resolved { value: unknown; source?: string }

/**
 * `branding` is the namespace's snapshot when the settings service OFFERS it
 * (a single-posture deployment lists it); absent, the fake lists no
 * `branding` namespace, as a walled posture does.
 */
function fakeSettings(values: Record<string, Resolved>, branding?: Record<string, Resolved>) {
  const listeners: Array<{ ns: string | undefined; cb: () => void }> = [];
  const actions = new Map<string, (a: any) => Promise<any>>();
  const read: string[] = [];
  const emit = async (ns: string) => {
    for (const l of listeners) if (l.ns === undefined || l.ns === ns) l.cb();
    // let the async re-apply settle
    await new Promise((r) => setTimeout(r, 0));
  };
  return {
    createClient: () => ({}),
    /** Every namespace read, in order. */
    read,
    getNamespace: async (ns: string) => {
      read.push(ns);
      if (ns === 'branding') {
        if (!branding) throw new Error(`UNKNOWN_NAMESPACE: ${ns}`);
        return { values: branding };
      }
      return { values };
    },
    listManifests: () => [{ namespace: 'mail' }, ...(branding ? [{ namespace: 'branding' }] : [])],
    subscribe: (ns: string | undefined, cb: () => void) => { listeners.push({ ns, cb }); },
    registerAction: (ns: string, id: string, fn: (a: any) => Promise<any>) => {
      actions.set(`${ns}/${id}`, fn);
    },
    /** Simulate a save: patch the snapshot and emit settings:changed. */
    async save(patch: Record<string, Resolved>) {
      Object.assign(values, patch);
      await emit('mail');
    },
    /** Simulate a save on Setup → Branding. */
    async saveBranding(patch: Record<string, Resolved>) {
      Object.assign(branding!, patch);
      await emit('branding');
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
async function boot(
  mailValues: Record<string, Resolved>,
  opts: any = {},
  branding?: Record<string, Resolved>,
) {
  const engine = fakeEngine();
  const settings = fakeSettings({ ...MAIL_DEFAULTS, ...mailValues }, branding);
  const services: Record<string, unknown> = {
    manifest: { register: () => {} },
    objectql: engine,
    settings,
  };
  const ctx = fakeCtx(services);
  const plugin = new EmailServicePlugin({ ...opts });
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

// ── stored provider values with no transport (#5094) ───────────────────────
//
// `sendgrid` and `ses` sat in the settings dropdown for several releases with
// no transport behind either. #5094 removed the options; it cannot remove the
// rows. A workspace that saved one still resolves `provider: 'sendgrid'` on
// every boot, so this is the one part of that change with live data behind it:
// the read must not throw, must not quietly look configured, and must say what
// to do — SendGrid and SES both publish SMTP endpoints, which is now the route.

describe('applyMailSettings — a stored provider this build cannot deliver with', () => {
  const RETIRED: Array<[string, RegExp]> = [
    ['sendgrid', /smtp\.sendgrid\.net/],
    ['ses', /email-smtp\.<region>\.amazonaws\.com/],
  ];

  for (const [provider, migration] of RETIRED) {
    it(`keeps the transport, never throws, and names the SMTP migration for provider=${provider}`, async () => {
      const { service, ctx } = await boot({
        provider: { value: provider, source: 'global' },
        api_key: { value: 'legacy-key', source: 'global' },
      });

      // A settings row written by an older release must never be able to kill
      // a running server: previous transport kept, boot completed.
      expect(transportOf(service)).toBeInstanceOf(LogTransport);

      expect(ctx.logger.error).toHaveBeenCalledTimes(1);
      const line = ctx.logger.error.mock.calls[0][0] as string;
      expect(line).toContain(`provider='${provider}'`);
      // Consequence…
      expect(line).toMatch(/NO mail is delivered through it/);
      // …and the fix, in the same line (AGENTS.md degradation-log-level).
      expect(line).toMatch(/Fix:/);
      expect(line).toMatch(migration);
    });
  }

  it('reports the missing transport, not a missing api_key, when both are absent', async () => {
    // "Set an API key" is the wrong instruction for a provider that has
    // nothing to hand the key to — so the unsupported-provider check runs
    // before the api_key check.
    const { ctx } = await boot({ provider: { value: 'sendgrid', source: 'global' } });
    const line = ctx.logger.error.mock.calls[0][0] as string;
    expect(line).not.toMatch(/api_key is empty/);
    expect(line).toMatch(/smtp\.sendgrid\.net/);
  });

  it('leaves a working boot-configured SMTP transport in place', async () => {
    // Mail may well still be going out (OS_EMAIL_SMTP_* configured the
    // transport at boot). The stored provider is still unusable and the
    // operator still has to fix it, so it is reported — but nothing that
    // currently delivers is torn down on the way.
    const { service, ctx } = await boot(
      { provider: { value: 'ses', source: 'global' }, api_key: { value: 'k', source: 'global' } },
      { provider: 'smtp', providerOptions: { host: 'smtp.boot.test' } },
    );
    expect((transportOf(service) as SmtpTransport).describe()).toMatchObject({ host: 'smtp.boot.test' });
    expect(ctx.logger.error).toHaveBeenCalledTimes(1);
  });

  it('treats a typo the same way, naming the providers that do work', async () => {
    const { ctx } = await boot({
      provider: { value: 'postmarkk', source: 'global' },
      api_key: { value: 'k', source: 'global' },
    });
    const line = ctx.logger.error.mock.calls[0][0] as string;
    expect(line).toMatch(/log \/ resend \/ postmark \/ smtp/);
  });

  it('recovers on the next save — the bad value is not sticky', async () => {
    const { service, settings } = await boot({
      provider: { value: 'sendgrid', source: 'global' },
      api_key: { value: 'legacy-key', source: 'global' },
    });
    expect(transportOf(service)).toBeInstanceOf(LogTransport);

    await settings.save({
      provider: { value: 'smtp', source: 'global' },
      smtp_host: { value: 'smtp.sendgrid.net', source: 'global' },
      smtp_user: { value: 'apikey', source: 'global' },
      smtp_password: { value: 'legacy-key', source: 'global' },
    });

    expect((transportOf(service) as SmtpTransport).describe()).toMatchObject({
      host: 'smtp.sendgrid.net',
      auth: { user: 'apikey' },
    });
  });
});

describe('applyMailSettings — provider=resend', () => {
  it('builds the transport the settings page can finally select', async () => {
    // The reverse half of the same invariant: `resend` had a working transport
    // all along and was missing from the dropdown (#5094). Now that it can be
    // picked, prove picking it does something.
    const { service, ctx } = await boot({
      provider: { value: 'resend', source: 'global' },
      api_key: { value: 're_live_key', source: 'global' },
    });
    expect(transportOf(service)).toBeInstanceOf(ResendTransport);
    expect(ctx.logger.error).not.toHaveBeenCalled();
  });
});

describe('EmailServicePlugin constructor path (CLI / os serve)', () => {
  it('THROWS when provider=smtp has no host — a boot that cannot deliver fails loudly', async () => {
    const ctx = fakeCtx({ manifest: { register: () => {} } });
    const plugin = new EmailServicePlugin({ provider: 'smtp' });
    await expect(plugin.init(ctx as never)).rejects.toThrow(/requires a host/);
  });

  it('builds the SMTP transport from providerOptions', async () => {
    const services: Record<string, unknown> = { manifest: { register: () => {} } };
    const ctx = fakeCtx(services);
    const plugin = new EmailServicePlugin({
      provider: 'smtp',
      providerOptions: { host: 'smtp.aliyun.test', port: 465 },
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

  it.each(['sendgrid', 'ses'])(
    'refuses to "test" a stored provider=%s and points at SMTP instead',
    async (provider) => {
      const { settings } = await boot({
        provider: { value: provider, source: 'global' },
        api_key: { value: 'legacy-key', source: 'global' },
      });
      const result = await settings.action('test')!({
        values: { provider, api_key: 'legacy-key', from_email: 'no-reply@example.test' },
        payload: { to: 'admin@example.test' },
      });

      expect(result).toMatchObject({ ok: false, severity: 'error' });
      // Not "Failed to build sendgrid transport: unknown provider" — the
      // operator needs the route that works, not the internal symptom.
      expect(result.message).toMatch(provider === 'sendgrid' ? /smtp\.sendgrid\.net/ : /email-smtp/);
      expect(result.message).toMatch(/NOTHING was sent/);
      expect(nm.sendMail).not.toHaveBeenCalled();
      // ...and it does not ask for an API key it cannot use.
      expect(result.message).not.toMatch(/api_key is required/);
    },
  );

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

describe('registered email service — isConfigured follows the mail settings', () => {
  it('answers false on the out-of-the-box boot (LogTransport, mail never configured)', async () => {
    const { service } = await boot({});
    expect(transportOf(service)).toBeInstanceOf(LogTransport);
    expect(service.isConfigured()).toBe(false);
  });

  it('turns true when a saved SMTP config replaces the LogTransport at runtime', async () => {
    const { service, settings } = await boot({ provider: { value: 'log', source: 'global' } });
    expect(service.isConfigured()).toBe(false);

    await settings.save({
      provider: { value: 'smtp', source: 'global' },
      smtp_host: { value: 'smtp.live.test', source: 'global' },
    });

    expect(transportOf(service)).toBeInstanceOf(SmtpTransport);
    expect(service.isConfigured()).toBe(true);
  });

  it('stays true across a swap from one live transport to another', async () => {
    const { service, settings } = await boot({
      provider: { value: 'smtp', source: 'global' },
      smtp_host: { value: 'smtp.live.test', source: 'global' },
    });
    expect(service.isConfigured()).toBe(true);

    await settings.save({
      provider: { value: 'resend', source: 'global' },
      api_key: { value: 're_test_key', source: 'global' },
    });

    expect(transportOf(service)).toBeInstanceOf(ResendTransport);
    expect(service.isConfigured()).toBe(true);
  });
});

// ── sender display name ────────────────────────────────────────────────────

// The Setup walkthrough's finding: an administrator who filled in only
// Settings → Mail → From email got mail from "ObjectStack <…>" while the
// subject and body named the product (`branding.workspace_name`, which the
// auth mails read). A sender with no display name of its own now carries the
// product name the auth mails read: the Branding product name when one is
// SET, else the deployment's name, else 'ObjectStack'. A From name somebody
// set always wins.
describe('sender display name follows the product name when none is set', () => {
  const SMTP_LIVE: Record<string, Resolved> = {
    provider: { value: 'smtp', source: 'global' },
    smtp_host: { value: 'smtp.example.test', source: 'global' },
    from_email: { value: 'no-reply@acme.test', source: 'global' },
    // The manifest declares no From name default: an unset one resolves empty.
    from_name: { value: undefined, source: 'default' },
  };
  const fromOnWire = () => nm.sendMail.mock.calls[nm.sendMail.mock.calls.length - 1][0].from;
  const sendOne = (service: EmailService) =>
    service.send({ to: 'new.hire@example.test', subject: 'Welcome', text: 'hi' });

  it('names the sender with the Branding product name an administrator set', async () => {
    const { service } = await boot(SMTP_LIVE, {}, {
      workspace_name: { value: 'Acme Portal', source: 'tenant' },
    });
    await sendOne(service);
    expect(fromOnWire()).toBe('Acme Portal <no-reply@acme.test>');
    expect(service.getDefaultFrom()).toEqual({ address: 'no-reply@acme.test', name: 'Acme Portal' });
  });

  it('falls back to the deployment name when no Branding product name is set', async () => {
    const { service } = await boot(
      SMTP_LIVE,
      { defaultTemplateContext: { appName: 'Acme CRM' } },
      { workspace_name: { value: undefined, source: 'default' } },
    );
    await sendOne(service);
    expect(fromOnWire()).toBe('Acme CRM <no-reply@acme.test>');
  });

  it("says 'ObjectStack' only when no product name is configured anywhere", async () => {
    const { service } = await boot(SMTP_LIVE, {}, {
      workspace_name: { value: undefined, source: 'default' },
    });
    await sendOne(service);
    expect(fromOnWire()).toBe('ObjectStack <no-reply@acme.test>');
  });

  it('keeps a From name an administrator set, whatever the product name', async () => {
    const { service } = await boot(
      { ...SMTP_LIVE, from_name: { value: 'Acme Support', source: 'global' } },
      { defaultTemplateContext: { appName: 'Acme CRM' } },
      { workspace_name: { value: 'Acme Portal', source: 'tenant' } },
    );
    await sendOne(service);
    expect(fromOnWire()).toBe('Acme Support <no-reply@acme.test>');
  });

  it('does not take a From name that is only a manifest default for a set one', async () => {
    // A resolver answering a default is no decision anybody made, the rule the
    // auth mails apply to `workspace_name` itself.
    const { service } = await boot(
      { ...SMTP_LIVE, from_name: { value: 'ObjectStack', source: 'default' } },
      {},
      { workspace_name: { value: 'Acme Portal', source: 'tenant' } },
    );
    await sendOne(service);
    expect(fromOnWire()).toBe('Acme Portal <no-reply@acme.test>');
  });

  it('follows a Branding save without a restart, and a cleared name falls back', async () => {
    const branding: Record<string, Resolved> = { workspace_name: { value: 'Acme Portal', source: 'tenant' } };
    const { service, settings } = await boot(SMTP_LIVE, { defaultTemplateContext: { appName: 'Acme CRM' } }, branding);

    await settings.saveBranding({ workspace_name: { value: 'Acme Workspace', source: 'tenant' } });
    await sendOne(service);
    expect(fromOnWire()).toBe('Acme Workspace <no-reply@acme.test>');

    await settings.saveBranding({ workspace_name: { value: undefined, source: 'default' } });
    await sendOne(service);
    expect(fromOnWire()).toBe('Acme CRM <no-reply@acme.test>');
  });

  it('names a boot-declared sender that carries no display name', async () => {
    const { service } = await boot(
      { from_email: { value: undefined, source: 'default' } },
      { defaultFrom: { address: 'ops@acme.test' } },
      { workspace_name: { value: 'Acme Portal', source: 'tenant' } },
    );
    expect(service.getDefaultFrom()).toEqual({ address: 'ops@acme.test', name: 'Acme Portal' });
  });

  it('leaves a sender the caller names untouched', async () => {
    const { service } = await boot(SMTP_LIVE, {}, {
      workspace_name: { value: 'Acme Portal', source: 'tenant' },
    });
    await service.send({
      to: 'new.hire@example.test', subject: 'Welcome', text: 'hi', from: { address: 'no-reply@acme.test' },
    });
    expect(fromOnWire()).toBe('no-reply@acme.test');
  });

  it('reads no Branding namespace where the settings service does not offer one (walled posture)', async () => {
    const { service, settings, ctx } = await boot(SMTP_LIVE, { defaultTemplateContext: { appName: 'Acme CRM' } });
    await sendOne(service);
    expect(fromOnWire()).toBe('Acme CRM <no-reply@acme.test>');
    expect(settings.read).not.toContain('branding');
    const warned = ctx.logger.warn.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(warned.filter((line: string) => /branding/i.test(line))).toEqual([]);
  });

  it('sends the test mail under the name real mail goes out with', async () => {
    const { settings } = await boot(SMTP_LIVE, {}, {
      workspace_name: { value: 'Acme Portal', source: 'tenant' },
    });
    const result = await settings.action('test')!({
      values: { provider: 'smtp', smtp_host: 'smtp.example.test', from_email: 'no-reply@acme.test' },
      payload: { to: 'admin@example.test' },
    });
    expect(result).toMatchObject({ ok: true });
    expect(fromOnWire()).toBe('Acme Portal <no-reply@acme.test>');
  });
});
