// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #14318 — an unsendable `from` address must be judged where it is
// CONFIGURED, and a send rejected before delivery must still leave a record.
//
// The measured shape: `OS_EMAIL_FROM="ObjectOS Local <noreply@localhost>"`
// booted clean (nothing looks at the address until something sends), so the
// first judgement happened on the first user's sign-up — inside
// `normalizeMessage`, on a promise better-auth runs through
// `runInBackgroundOrAwait`, which logs the throw and swallows it. Sign-up
// answered 200, the UI said "we sent you a verification email", `sys_email`
// held no failed row, and "resend" repeated the whole thing.
//
// Two halves are pinned here, one per defect:
//   1. the address is refused at configuration time — a THROW on the
//      constructor/CLI channel, an `error` + "previous sender kept" on the
//      settings channel (a save must not kill a running server);
//   2. a message rejected before delivery writes a `sys_email` row at
//      `status:'failed'` carrying the reason.

import { describe, it, expect, vi } from 'vitest';
import { EmailServicePlugin } from './email-plugin.js';
import { EmailService, type EmailPersistence } from './email-service.js';

// ── harness ────────────────────────────────────────────────────────────────

interface Resolved { value: unknown; source?: string }

function fakeSettings(values: Record<string, Resolved>) {
  return {
    createClient: () => ({}),
    getNamespace: async () => ({ values }),
    registerAction: () => {},
  };
}

function fakeEngine() {
  const inserted: Array<{ object: string; row: any }> = [];
  return {
    inserted,
    async insert(object: string, row: any) { inserted.push({ object, row }); return { id: row.id }; },
    async update() { /* no-op */ },
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

/** Boot the plugin (provider=log, so no transport is built) with `mail` settings. */
async function boot(mailValues: Record<string, Resolved>, opts: any = {}) {
  const services: Record<string, unknown> = {
    manifest: { register: () => {} },
    objectql: fakeEngine(),
    settings: fakeSettings({
      provider: { value: 'log', source: 'default' },
      ...mailValues,
    }),
  };
  const ctx = fakeCtx(services);
  const plugin = new EmailServicePlugin({ provider: 'log', seedTemplates: false, ...opts });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  await ctx.fire('kernel:ready');
  return { plugin, ctx, service: services.email as EmailService };
}

const errorLines = (ctx: { logger: { error: ReturnType<typeof vi.fn> } }): string[] =>
  ctx.logger.error.mock.calls.map((c: unknown[]) => String(c[0]));

// ── 1. configuration-time refusal — the constructor / CLI channel ──────────

describe('EmailServicePlugin.init — declared default sender', () => {
  const ctxFor = () => fakeCtx({ manifest: { register: () => {} } });

  it('refuses to boot with the exact OS_EMAIL_FROM shape that shipped the defect', async () => {
    const plugin = new EmailServicePlugin({
      provider: 'log',
      seedTemplates: false,
      defaultFrom: { name: 'ObjectOS Local', address: 'noreply@localhost' },
    });
    await expect(plugin.init(ctxFor() as never)).rejects.toThrow(/noreply@localhost/);
  });

  it('names the consequence and the fix, not just the address', async () => {
    const plugin = new EmailServicePlugin({
      provider: 'log',
      seedTemplates: false,
      defaultFrom: 'noreply@localhost',
    });
    const err = await plugin.init(ctxFor() as never).then(
      () => { throw new Error('init resolved — the invalid sender was accepted'); },
      (e: Error) => e,
    );
    // The consequence (every send rejected, silently on sign-up) and the fix
    // (OS_EMAIL_FROM / config.email.defaultFrom) are what make the boot
    // failure actionable; the address alone is not.
    expect(err.message).toMatch(/EVERY message/);
    expect(err.message).toMatch(/OS_EMAIL_FROM/);
  });

  it('refuses an address with no domain at all', async () => {
    const plugin = new EmailServicePlugin({ provider: 'log', seedTemplates: false, defaultFrom: 'noreply' });
    await expect(plugin.init(ctxFor() as never)).rejects.toThrow(/not a valid email address/);
  });

  it('boots with a deliverable sender', async () => {
    const ctx = ctxFor();
    const plugin = new EmailServicePlugin({
      provider: 'log',
      seedTemplates: false,
      defaultFrom: { name: 'ObjectOS Local', address: 'no-reply@objectstack.local' },
    });
    await expect(plugin.init(ctx as never)).resolves.toBeUndefined();
  });

  it('boots with NO declared sender — callers may always pass input.from', async () => {
    const plugin = new EmailServicePlugin({ provider: 'log', seedTemplates: false });
    await expect(plugin.init(ctxFor() as never)).resolves.toBeUndefined();
  });
});

// ── 2. configuration-time refusal — the settings channel ───────────────────

describe('applyMailSettings — saved From address', () => {
  it('refuses an unsendable saved address, keeps the previous sender, and says so at error', async () => {
    const { ctx, service } = await boot(
      { from_email: { value: 'noreply@localhost', source: 'global' } },
      { defaultFrom: { name: 'Boot', address: 'no-reply@objectstack.local' } },
    );

    // The running service still sends from the address that WORKS.
    expect(service.options.defaultFrom).toEqual({ name: 'Boot', address: 'no-reply@objectstack.local' });

    // `error`, not `warn`: the save succeeded and the page shows what the
    // operator typed, so nothing looks broken from the outside.
    const lines = errorLines(ctx);
    expect(lines.some((m) => m.includes('noreply@localhost') && m.includes('NOT applied'))).toBe(true);
    expect(lines.some((m) => m.includes('OS_EMAIL_FROM'))).toBe(true);
  });

  it('does not report the refused address as applied', async () => {
    const { ctx } = await boot(
      { from_email: { value: 'noreply@localhost', source: 'global' } },
      { defaultFrom: 'no-reply@objectstack.local' },
    );
    const applied = ctx.logger.info.mock.calls.map((c: unknown[]) => String(c[0]))
      .filter((m) => m.includes('mail settings applied'));
    expect(applied.length).toBeGreaterThan(0);
    expect(applied.some((m) => m.includes('noreply@localhost'))).toBe(false);
  });

  it('applies a deliverable saved address', async () => {
    const { ctx, service } = await boot({
      from_email: { value: 'no-reply@example.test', source: 'global' },
      from_name: { value: 'Acme', source: 'global' },
    });
    expect(service.options.defaultFrom).toEqual({ address: 'no-reply@example.test', name: 'Acme' });
    expect(errorLines(ctx)).toEqual([]);
  });

  it('never throws out of the settings path — a save must not kill the server', async () => {
    await expect(
      boot({ from_email: { value: 'noreply@localhost', source: 'global' } }),
    ).resolves.toBeDefined();
  });
});

// ── 3. a message rejected before delivery leaves a sys_email row ───────────

describe('EmailService — rejection is recorded in sys_email', () => {
  function makePersistence() {
    const rows: Array<Record<string, any>> = [];
    const p: EmailPersistence = {
      async insert(row) { rows.push({ ...row }); return { id: row.id }; },
      async update() { /* no-op */ },
    };
    return { p, rows };
  }

  const transport = () => ({ send: vi.fn(async () => ({ messageId: '<m@x>' })) });

  it('writes status=failed + the reason when the default sender is unsendable', async () => {
    const t = transport();
    const { p, rows } = makePersistence();
    const svc = new EmailService({
      transport: t,
      defaultFrom: { name: 'ObjectOS Local', address: 'noreply@localhost' },
      persistence: p,
    });

    await expect(
      svc.send({ to: 'user@example.test', subject: 'Verify your email', text: 'click here' }),
    ).rejects.toThrow(/Invalid email address: noreply@localhost/);

    // The caller still gets the error (auth propagates it), AND the attempt is
    // now queryable — which it was not: this window inserted no row at all.
    expect(t.send).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'failed',
      from_address: 'ObjectOS Local <noreply@localhost>',
      to_addresses: 'user@example.test',
      subject: 'Verify your email',
      attempt_count: 0,
    });
    expect(String(rows[0].error)).toContain('Invalid email address: noreply@localhost');
  });

  it('distinguishes a pre-delivery rejection from a transport failure in `error`', async () => {
    const { p, rows } = makePersistence();
    const svc = new EmailService({ transport: transport(), defaultFrom: 'noreply@localhost', persistence: p });
    await expect(svc.send({ to: 'a@b.test', subject: 'Hi', text: 'x' })).rejects.toThrow();
    // An operator reading `error` must not be sent to the SMTP host for a
    // message that never reached one.
    expect(String(rows[0].error)).toMatch(/^rejected before delivery: /);
  });

  it('records a rejection whose envelope is itself incomplete', async () => {
    const { p, rows } = makePersistence();
    const svc = new EmailService({ transport: transport(), defaultFrom: 'no-reply@example.test', persistence: p });
    await expect(svc.send({ to: [], subject: '', text: 'x' } as never)).rejects.toThrow(/VALIDATION_FAILED/);
    // `from_address` / `to_addresses` / `subject` are required columns, so the
    // record has to stay writable when the input names none of them.
    expect(rows[0]).toMatchObject({ status: 'failed', to_addresses: '(none)', subject: '(none)' });
  });

  it('carries the linkage the send asked for, so the failure is findable from the user record', async () => {
    const { p, rows } = makePersistence();
    const svc = new EmailService({ transport: transport(), defaultFrom: 'noreply@localhost', persistence: p });
    await expect(svc.send({
      to: 'user@example.test',
      subject: 'Verify your email',
      text: 'x',
      relatedObject: 'sys_user',
      relatedId: 'usr_1',
    })).rejects.toThrow();
    expect(rows[0]).toMatchObject({ related_object: 'sys_user', related_id: 'usr_1' });
  });

  it('never replaces the caller\'s error with a persistence one', async () => {
    const warn = vi.fn();
    const persistence: EmailPersistence = { async insert() { throw new Error('db down'); } };
    const svc = new EmailService({
      transport: transport(),
      defaultFrom: 'noreply@localhost',
      persistence,
      logger: { info: vi.fn(), warn },
    });
    await expect(svc.send({ to: 'a@b.test', subject: 'Hi', text: 'x' }))
      .rejects.toThrow(/Invalid email address/);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('rejection record could not be persisted'),
      expect.any(Object),
    );
  });

  it('writes nothing when the service has no persistence wired', async () => {
    const svc = new EmailService({ transport: transport(), defaultFrom: 'noreply@localhost' });
    await expect(svc.send({ to: 'a@b.test', subject: 'Hi', text: 'x' })).rejects.toThrow();
  });

  it('leaves the row where no re-delivery path can pick it up', async () => {
    // Both consumers of a stranded row gate on `status === 'queued'` — the
    // afterInsert outbox drain hook and the boot sweep. A rejection record
    // must never be mistaken for an outbox entry and "re-delivered".
    const { p, rows } = makePersistence();
    const svc = new EmailService({ transport: transport(), defaultFrom: 'noreply@localhost', persistence: p });
    await expect(svc.send({ to: 'a@b.test', subject: 'Hi', text: 'x' })).rejects.toThrow();
    expect(rows[0].status).not.toBe('queued');
    expect(rows[0].message_id).toBeUndefined();
  });
});
