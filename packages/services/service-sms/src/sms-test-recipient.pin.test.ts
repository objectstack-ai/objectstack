// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Who "Send test SMS" sends to, driven through the SERVED door: a real
// `SettingsService` holding the real `sms` manifest, its real REST routes, and
// the real `sms/test` handler that `SmsServicePlugin` registers at
// `kernel:ready`.
//
// The served form has no recipient input, so the console's request body is its
// unsaved edits and carries no `to` — and the handler refused every press by
// asking for one. The pins: with no `to`, the test goes to the signed-in admin's
// own number, read from their own `sys_user` row; an explicit `to` still wins;
// and every refusal that remains carries the ADR-0112 envelope.

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { SettingsService, smsSettingsManifest, registerSettingsRoutes } from '@objectstack/service-settings';
import { SmsServicePlugin } from './sms-plugin.js';

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
const ADMIN_PHONE = '+8613800000001';

/** The console's draft after an admin typed Twilio credentials and did not save yet. */
const TWILIO_DRAFT = {
  provider: 'twilio',
  twilio_account_sid: 'AC_test',
  twilio_auth_token: 'tok',
  twilio_from_number: '+15005550006',
};

type UserRow = { id: string; phone_number?: string | null };

function fakeEngine(users: UserRow[], opts: { userReadFails?: boolean } = {}) {
  return {
    findOne: vi.fn(async (object: string, query: any) => {
      if (object !== 'sys_user') return null;
      if (opts.userReadFails) throw new Error('sys_user is unavailable');
      return users.find((u) => u.id === query?.where?.id) ?? null;
    }),
  };
}

async function serve(users: UserRow[], opts: { userReadFails?: boolean } = {}) {
  const settings = new SettingsService({ env: {} });
  settings.registerManifest(smsSettingsManifest);
  const engine = fakeEngine(users, opts);
  const services = new Map<string, unknown>([['settings', settings], ['objectql', engine]]);
  const readyHooks: Array<() => Promise<void> | void> = [];
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService(name: string, svc: unknown) { services.set(name, svc); },
    getService(name: string) {
      if (!services.has(name)) throw new Error(`service not found: ${name}`);
      return services.get(name);
    },
    hook(event: string, fn: () => Promise<void> | void) {
      if (event === 'kernel:ready') readyHooks.push(fn);
    },
  } as any;
  const plugin = new SmsServicePlugin();
  await plugin.init(ctx);
  await plugin.start(ctx);
  for (const fn of readyHooks) await fn();

  const http = new MockHttp();
  registerSettingsRoutes(http, settings, {
    contextFromRequest: () => ({ enforced: true, permissions: ['manage_platform_settings'], userId: ADMIN_ID }),
  });

  /** Twilio's REST endpoint, as the one-shot test transport reaches it. */
  const twilio = vi.fn(async (_url: string, _init: any) => new Response(
    JSON.stringify({ sid: 'SM_test', status: 'queued' }),
    { status: 201, headers: { 'Content-Type': 'application/json' } },
  ));
  vi.stubGlobal('fetch', twilio);

  /** POST /api/settings/sms/test with the body the console sends. */
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
      params: { namespace: 'sms', actionId: 'test' },
      query: {},
      body,
      headers: {},
      method: 'POST',
      path: '/api/settings/sms/test',
    };
    await handler(req, res);
    return captured;
  };
  /** The `To` of the one message Twilio was handed. */
  const sentTo = () => new URLSearchParams(String(twilio.mock.calls[0]?.[1]?.body ?? '')).get('To');
  return { engine, settings, twilio, sentTo, pressSendTest };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('served sms/test — the recipient', () => {
  it('with no "to", sends to the signed-in admin\'s own number', async () => {
    const { engine, twilio, sentTo, pressSendTest } = await serve([{ id: ADMIN_ID, phone_number: ADMIN_PHONE }]);

    const answer = await pressSendTest(TWILIO_DRAFT);

    expect(answer.status).toBe(200);
    expect(answer.body?.data).toMatchObject({ ok: true });
    expect(twilio).toHaveBeenCalledTimes(1);
    expect(sentTo()).toBe(ADMIN_PHONE);
    // The number never travels back in the answer unmasked.
    expect(JSON.stringify(answer.body)).not.toContain(ADMIN_PHONE);
    // The read is the caller's OWN row, projected to the number alone.
    expect(engine.findOne).toHaveBeenCalledWith(
      'sys_user',
      { where: { id: ADMIN_ID }, fields: ['phone_number'] },
      { context: expect.objectContaining({ isSystem: true }) },
    );
  });

  it('control: an explicit "to" still wins, and no account is read', async () => {
    const { engine, twilio, sentTo, pressSendTest } = await serve([{ id: ADMIN_ID, phone_number: ADMIN_PHONE }]);

    const answer = await pressSendTest({ ...TWILIO_DRAFT, to: '+15005550009' });

    expect(answer.status).toBe(200);
    expect(twilio).toHaveBeenCalledTimes(1);
    expect(sentTo()).toBe('+15005550009');
    expect(engine.findOne).not.toHaveBeenCalled();
  });

  it.each([
    ['an account with no phone number', [{ id: ADMIN_ID, phone_number: null }], {}, TWILIO_DRAFT, 'error'],
    ['an account row that is missing', [], {}, TWILIO_DRAFT, 'error'],
    ['a failed account read', [{ id: ADMIN_ID, phone_number: ADMIN_PHONE }], { userReadFails: true }, TWILIO_DRAFT, 'error'],
    // `log` is the namespace's default: the press on a fresh install. A log
    // "send" is not a delivery, so it is not reported as one.
    ['the log-only provider', [{ id: ADMIN_ID, phone_number: ADMIN_PHONE }], {}, {}, 'warning'],
  ] as const)('refuses, sending nothing, for %s — ADR-0112 envelope', async (_name, users, opts, draft, severity) => {
    const { twilio, pressSendTest } = await serve([...users], opts);

    const answer = await pressSendTest({ ...draft });

    expect(answer.status).toBe(400);
    expect(answer.body?.success).toBe(false);
    expect(answer.body?.error?.code).toBe('SETTINGS_ACTION_FAILED');
    expect(answer.body?.error?.details).toMatchObject({ ok: false, severity });
    expect(twilio).not.toHaveBeenCalled();
  });

  it('an in-process call with no "to" and no user refuses', async () => {
    // Not a public door — the routes refuse an anonymous caller before any
    // action runs — but the trusted in-process path reaches the same handler.
    const { settings, twilio } = await serve([{ id: ADMIN_ID, phone_number: ADMIN_PHONE }]);

    const result = await settings.runAction('sms', 'test', { ...TWILIO_DRAFT }, {});

    expect(result).toMatchObject({ ok: false, severity: 'error' });
    expect(twilio).not.toHaveBeenCalled();
  });
});
