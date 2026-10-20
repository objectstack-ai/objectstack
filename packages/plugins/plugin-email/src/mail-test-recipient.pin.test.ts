// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Who "Send test email" sends to, driven through the SERVED door: a real
// `SettingsService` holding the real `mail` manifest, its real REST routes, and
// the real `mail/test` handler that `EmailServicePlugin` registers at
// `kernel:ready`.
//
// The served form has no recipient input, so the console's request body is its
// unsaved edits — `{}` on a page nobody has edited — and carries no `to`. The
// handler used to fall back to `from_email`, the sender address: a "success"
// mailed to a no-reply box, or, with From empty, a refusal asking for a field
// the page does not have. The pins: with no `to`, the test goes to the signed-in
// admin's own address, read from their own `sys_user` row; an explicit `to`
// still wins; and every refusal that remains carries the ADR-0112 envelope.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { SettingsService, mailSettingsManifest, registerSettingsRoutes } from '@objectstack/service-settings';
import { EmailServicePlugin } from './email-plugin.js';

const nm = vi.hoisted(() => ({ createTransport: vi.fn(), sendMail: vi.fn() }));
vi.mock('nodemailer', () => ({
  default: { createTransport: nm.createTransport },
  createTransport: nm.createTransport,
}));

class MockHttp implements IHttpServer {
  routes = new Map<string, RouteHandler>();
  private add(method: string, path: string, handler: RouteHandler) {
    this.routes.set(`${method} ${path}`, handler);
  }
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

const ADMIN_ID = 'usr_admin';
const ADMIN_EMAIL = 'admin@acme.test';
const FROM_EMAIL = 'no-reply@acme.test';

type UserRow = { id: string; email?: string | null };

function fakeEngine(users: UserRow[], opts: { userReadFails?: boolean } = {}) {
  return {
    insert: vi.fn(async (_object: string, row: any) => ({ id: row?.id })),
    update: vi.fn(async () => undefined),
    find: vi.fn(async () => []),
    findOne: vi.fn(async (object: string, query: any) => {
      if (object !== 'sys_user') return null;
      if (opts.userReadFails) throw new Error('sys_user is unavailable');
      return users.find((u) => u.id === query?.where?.id) ?? null;
    }),
  };
}

function fakeCtx(services: Record<string, unknown>) {
  const hooks: Record<string, Array<() => Promise<void> | void>> = {};
  return {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    getService: <T,>(name: string): T => {
      if (!(name in services)) throw new Error(`service '${name}' not registered`);
      return services[name] as T;
    },
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    hook: (name: string, fn: () => Promise<void> | void) => { (hooks[name] ??= []).push(fn); },
    fire: async (name: string) => { for (const fn of hooks[name] ?? []) await fn(); },
  };
}

/** Boot the served `mail/test` door: real settings service + routes, the plugin's real action. */
async function serve(users: UserRow[], opts: { userReadFails?: boolean } = {}) {
  const settings = new SettingsService({ env: {} });
  settings.registerManifest(mailSettingsManifest);
  await settings.setMany('mail', { provider: 'smtp', smtp_host: 'smtp.acme.test', from_email: FROM_EMAIL });
  const engine = fakeEngine(users, opts);
  const services: Record<string, unknown> = { manifest: { register: () => {} }, objectql: engine, settings };
  const ctx = fakeCtx(services);
  const plugin = new EmailServicePlugin();
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  await ctx.fire('kernel:ready');

  const http = new MockHttp();
  registerSettingsRoutes(http, settings, {
    contextFromRequest: () => ({
      enforced: true,
      permissions: ['manage_platform_settings'],
      userId: ADMIN_ID,
    }),
  });

  /** POST /api/settings/mail/test with the body the console sends. */
  const pressSendTest = async (body: unknown) => {
    const handler = http.routes.get('POST /api/settings/:namespace/:actionId');
    if (!handler) throw new Error('the settings action route is not mounted');
    const captured: { status: number; body: any } = { status: 200, body: undefined };
    const res: IHttpResponse = {
      json: vi.fn((data: any) => { captured.body = data; }) as any,
      send: vi.fn() as any,
      status: vi.fn((code: number) => { captured.status = code; return res; }) as any,
      header: vi.fn(() => res) as any,
    };
    const req: IHttpRequest = {
      params: { namespace: 'mail', actionId: 'test' },
      query: {},
      body,
      headers: {},
      method: 'POST',
      path: '/api/settings/mail/test',
    };
    await handler(req, res);
    return captured;
  };
  return { engine, settings, pressSendTest };
}

/** The `to` of the one message nodemailer was handed, as text. */
const sentTo = () => JSON.stringify(nm.sendMail.mock.calls[0]?.[0]?.to);

beforeEach(() => {
  nm.createTransport.mockReset();
  nm.sendMail.mockReset();
  nm.createTransport.mockImplementation(() => ({ sendMail: nm.sendMail, close: vi.fn() }));
  nm.sendMail.mockResolvedValue({ messageId: '<wire-1@smtp>', response: '250 2.0.0 Ok' });
});

describe('served mail/test — the recipient', () => {
  it('with no "to", sends to the signed-in admin\'s own address, not to From', async () => {
    const { engine, pressSendTest } = await serve([{ id: ADMIN_ID, email: ADMIN_EMAIL }]);

    const answer = await pressSendTest({});

    expect(answer.status).toBe(200);
    expect(answer.body?.data).toMatchObject({ ok: true });
    expect(nm.sendMail).toHaveBeenCalledTimes(1);
    expect(sentTo()).toContain(ADMIN_EMAIL);
    expect(sentTo()).not.toContain(FROM_EMAIL);
    // The read is the caller's OWN row, projected to the address alone.
    expect(engine.findOne).toHaveBeenCalledWith(
      'sys_user',
      { where: { id: ADMIN_ID }, fields: ['email'] },
      { context: expect.objectContaining({ isSystem: true }) },
    );
  });

  it('control: an explicit "to" still wins, and no account is read', async () => {
    const { engine, pressSendTest } = await serve([{ id: ADMIN_ID, email: ADMIN_EMAIL }]);

    const answer = await pressSendTest({ to: 'ops@acme.test' });

    expect(answer.status).toBe(200);
    expect(nm.sendMail).toHaveBeenCalledTimes(1);
    expect(sentTo()).toContain('ops@acme.test');
    expect(sentTo()).not.toContain(ADMIN_EMAIL);
    expect(engine.findOne).not.toHaveBeenCalledWith('sys_user', expect.anything(), expect.anything());
  });

  it.each([
    ['an account with no email address', [{ id: ADMIN_ID, email: null }], {}],
    ['an account row that is missing', [], {}],
    ['a failed account read', [{ id: ADMIN_ID, email: ADMIN_EMAIL }], { userReadFails: true }],
  ] as const)('refuses, sending nothing, for %s — ADR-0112 envelope', async (_name, users, opts) => {
    const { pressSendTest } = await serve([...users], opts);

    const answer = await pressSendTest({});

    expect(answer.status).toBe(400);
    expect(answer.body?.success).toBe(false);
    expect(answer.body?.error?.code).toBe('SETTINGS_ACTION_FAILED');
    expect(answer.body?.error?.details).toMatchObject({ ok: false, severity: 'error' });
    expect(nm.sendMail).not.toHaveBeenCalled();
  });

  it('an in-process call with no "to" and no user refuses rather than mailing From', async () => {
    // Not a public door — the routes refuse an anonymous caller before any
    // action runs — but the trusted in-process path reaches the same handler.
    const { settings } = await serve([{ id: ADMIN_ID, email: ADMIN_EMAIL }]);

    const result = await settings.runAction('mail', 'test', {}, {});

    expect(result).toMatchObject({ ok: false, severity: 'error' });
    expect(nm.sendMail).not.toHaveBeenCalled();
  });
});
