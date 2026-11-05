// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30203] `auth.allowed_ip_ranges` (ADR-0069 D5) can neither lock out the
 * administrator saving it unwarned, nor stay in force after it is cleared.
 *
 * The composition: the real `AuthPlugin` bound to a real `SettingsService`
 * carrying the shipped auth manifest, and the real settings routes in front of
 * it, so a save travels the console's own door (`PUT /api/settings/auth`) and
 * the clear reaches the running gate through the real change bus.
 *
 *  - Clearing applies at once. The console sends `null` for an emptied field;
 *    the cascade then answers with source `default`, and the gate returns to
 *    the deployment's own declaration in the same pass — empty when it
 *    declared none, its own list when it did. Restoring the namespace's
 *    defaults does the same.
 *  - A save whose list leaves out the saving request's address is refused
 *    (`400 SETTINGS_VALIDATION`, `invalid_value` at the key, the address in
 *    `constraint.clientAddress`) and nothing is stored. The address is the one
 *    the gate judges at sign-in: the peer address, or the forwarded one when
 *    the deployment declares `trustProxy`. A list that includes it saves.
 *  - The recovery the refusal names: `OS_AUTH_ALLOWED_IP_RANGES` set empty
 *    opens the gate on the next boot over a stored list.
 *  - [#30385] The rest of that recovery: while the override is in force a
 *    clear (`null`) goes through the settings door and clears the stored
 *    list, so removing the override does not bring it back; any other value
 *    is still refused `409 SETTINGS_LOCKED`.
 *  - [#30398] The read an administrator asks before saving,
 *    `GET /api/v1/auth/admin/client-address`, answers the address that same
 *    save would be judged by: the plugin's real auth routes on a real Hono app,
 *    the transport peer supplied the way `@hono/node-server` supplies it.
 *
 * `@objectstack/service-settings` resolves to its `src/` here (this package's
 * `vitest.config.ts`), so the routes and the service are the checkout's.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { IHttpRequest, IHttpResponse, IHttpServer, RouteHandler } from '@objectstack/spec/contracts';
import {
  SettingsService,
  builtinSettingsManifests,
  registerSettingsRoutes,
} from '@objectstack/service-settings';
import { AuthPlugin } from './auth-plugin.js';
import type { AuthManager } from './auth-manager.js';

const OFFICE = '203.0.113.0/24';
const ADMIN_CTX = { enforced: true, permissions: ['manage_platform_settings'], userId: 'usr_admin' };
const authManifest = builtinSettingsManifests.find((m) => m.namespace === 'auth')!;

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

type Transport = { headers?: Record<string, string>; remoteAddress?: string };

/** The session the read's platform-admin gate is handed: a platform admin unless a test says otherwise. */
const PLATFORM_ADMIN_SESSION = { user: { id: 'usr_admin', email: 'admin@example.com', isPlatformAdmin: true } };

interface Rig {
  svc: SettingsService;
  manager: AuthManager;
  save(body: Record<string, unknown>, transport?: Transport): Promise<{ status: number; body: any }>;
  /** `GET /api/v1/auth/admin/client-address` on the plugin's real auth routes. */
  read(transport?: Transport, opts?: { session?: unknown; query?: string }):
    Promise<{ status: number; body: any; cacheControl: string | null }>;
}

async function boot(
  opts: { env?: Record<string, string | undefined>; svc?: SettingsService; plugin?: Record<string, unknown> } = {},
): Promise<Rig> {
  const svc = opts.svc ?? new SettingsService({ env: opts.env ?? {} });
  if (!opts.svc) svc.registerManifest(authManifest);
  const handlers = new Map<string, Array<() => Promise<void>>>();
  const ctx: any = {
    registerService: vi.fn(),
    getService: vi.fn((name: string) => {
      if (name === 'manifest') return { register: vi.fn() };
      if (name === 'settings') return svc;
      return undefined;
    }),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn((name: string, handler: () => Promise<void>) => {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    }),
    trigger: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(),
  };
  const plugin = new AuthPlugin({
    secret: 'test-secret-at-least-32-chars-long',
    baseUrl: 'http://localhost:3000',
    ...(opts.plugin ?? {}),
  });
  await plugin.init(ctx);
  const manager = ctx.registerService.mock.calls.find(([name]: [string]) => name === 'auth')?.[1] as AuthManager;
  await plugin.start(ctx);
  for (const h of handlers.get('kernel:ready') ?? []) await h();

  const http = new MockHttp();
  registerSettingsRoutes(http, svc, { contextFromRequest: () => ({ ...ADMIN_CTX }) });
  const save: Rig['save'] = async (body, transport = {}) => {
    const out = { status: 200, body: undefined as any };
    const res: IHttpResponse = {
      json: vi.fn((data: any) => { out.body = data; }) as any,
      send: vi.fn() as any,
      status: vi.fn((code: number) => { out.status = code; return res; }) as any,
      header: vi.fn(() => res) as any,
    };
    const req: IHttpRequest = {
      params: { namespace: 'auth' },
      query: {},
      body,
      headers: transport.headers ?? {},
      method: 'PUT',
      path: '/api/settings/auth',
      ...(transport.remoteAddress ? { remoteAddress: transport.remoteAddress } : {}),
    };
    await http.routes.get('PUT /api/settings/:namespace')!(req, res);
    return out;
  };

  let app: Hono | undefined;
  const read: Rig['read'] = async (transport = {}, opts = {}) => {
    if (!app) {
      app = new Hono();
      (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);
    }
    const session = 'session' in opts ? opts.session : PLATFORM_ADMIN_SESSION;
    // The gate reads the session through the auth service's in-process read.
    const getApi = vi.spyOn(manager, 'getApi').mockResolvedValue({ getSession: async () => session } as any);
    try {
      const res = await app.request(
        `http://localhost:3000/api/v1/auth/admin/client-address${opts.query ?? ''}`,
        { method: 'GET', headers: transport.headers ?? {} },
        transport.remoteAddress ? { incoming: { socket: { remoteAddress: transport.remoteAddress } } } : {},
      );
      return { status: res.status, body: await res.json(), cacheControl: res.headers.get('cache-control') };
    } finally {
      getApi.mockRestore();
    }
  };
  return { svc, manager, save, read };
}

const stored = async (svc: SettingsService) => (await svc.get('auth', 'allowed_ip_ranges', {})).value ?? null;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('#30203 clearing allowed_ip_ranges applies at once', () => {
  it('a cleared value opens the gate in the same pass, with no restart', async () => {
    const { svc, manager } = await boot();
    await svc.set('auth', 'allowed_ip_ranges', OFFICE, {});
    await vi.waitFor(() => expect(manager.isClientIpAllowed('::1')).toBe(false));
    expect(manager.isClientIpAllowed('203.0.113.7')).toBe(true);

    await svc.set('auth', 'allowed_ip_ranges', null, {});
    expect((await svc.get('auth', 'allowed_ip_ranges', {})).source).toBe('default');
    await vi.waitFor(() => expect(manager.isClientIpAllowed('::1')).toBe(true));
  });

  it('restoring the namespace defaults opens the gate too', async () => {
    const { svc, manager } = await boot();
    await svc.set('auth', 'allowed_ip_ranges', OFFICE, {});
    await vi.waitFor(() => expect(manager.isClientIpAllowed('::1')).toBe(false));

    await svc.resetNamespace('auth', {});
    await vi.waitFor(() => expect(manager.isClientIpAllowed('::1')).toBe(true));
  });

  it("a cleared value hands the gate back to the deployment's own declared list, not to none", async () => {
    const { svc, manager } = await boot({ plugin: { allowedIpRanges: ['10.0.0.0/8'] } });
    expect(manager.isClientIpAllowed('203.0.113.7')).toBe(false);
    await svc.set('auth', 'allowed_ip_ranges', OFFICE, {});
    await vi.waitFor(() => expect(manager.isClientIpAllowed('203.0.113.7')).toBe(true));
    expect(manager.isClientIpAllowed('10.1.2.3')).toBe(false);

    await svc.set('auth', 'allowed_ip_ranges', null, {});
    await vi.waitFor(() => expect(manager.isClientIpAllowed('10.1.2.3')).toBe(true));
    expect(manager.isClientIpAllowed('203.0.113.7')).toBe(false);
  });
});

describe('#30203 a console save that excludes the saving address is refused', () => {
  it('refuses a list without the peer address, names it, and stores nothing', async () => {
    const { svc, save } = await boot();
    const res = await save({ allowed_ip_ranges: OFFICE }, { remoteAddress: '::1' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SETTINGS_VALIDATION');
    const field = res.body.error.details.fields.find((f: any) => f.field === 'allowed_ip_ranges');
    expect(field.code).toBe('invalid_value');
    expect(field.constraint).toEqual({ clientAddress: '::1' });
    expect(field.message).toContain('::1');
    expect(await stored(svc)).toBeNull();
  });

  it('saves a list that includes the peer address (preservation)', async () => {
    const { svc, manager, save } = await boot();
    const res = await save({ allowed_ip_ranges: `${OFFICE}\n127.0.0.1` }, { remoteAddress: '::ffff:127.0.0.1' });
    expect(res.status).toBe(200);
    expect(await stored(svc)).toBe(`${OFFICE}\n127.0.0.1`);
    await vi.waitFor(() => expect(manager.isClientIpAllowed('198.51.100.1')).toBe(false));
    expect(manager.isClientIpAllowed('127.0.0.1')).toBe(true);
  });

  it('judges the address the gate judges: the forwarded one under trustProxy, the peer otherwise', async () => {
    const forwarded = { headers: { 'x-forwarded-for': '198.51.100.7' }, remoteAddress: '10.0.0.1' };

    const trusting = await boot({ plugin: { trustProxy: true } });
    const refused = await trusting.save({ allowed_ip_ranges: '10.0.0.0/8' }, forwarded);
    expect(refused.status).toBe(400);
    expect(refused.body.error.details.fields[0].constraint).toEqual({ clientAddress: '198.51.100.7' });
    expect((await trusting.save({ allowed_ip_ranges: '198.51.100.0/24' }, forwarded)).status).toBe(200);

    const untrusting = await boot();
    const peer = await untrusting.save({ allowed_ip_ranges: '198.51.100.0/24' }, forwarded);
    expect(peer.status).toBe(400);
    expect(peer.body.error.details.fields[0].constraint).toEqual({ clientAddress: '10.0.0.1' });
  });

  it('refuses any list when the saving address cannot be established', async () => {
    const { svc, save } = await boot();
    const res = await save({ allowed_ip_ranges: OFFICE }, {});
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields[0].constraint).toEqual({ clientAddress: null });
    expect(await stored(svc)).toBeNull();
  });

  it('never refuses a clear, and leaves an in-process write (no request) unjudged', async () => {
    const { svc, save } = await boot();
    await svc.set('auth', 'allowed_ip_ranges', OFFICE, {});
    expect(await stored(svc)).toBe(OFFICE);
    const res = await save({ allowed_ip_ranges: null }, { remoteAddress: '::1' });
    expect(res.status).toBe(200);
    expect(await stored(svc)).toBeNull();
  });
});

describe('#30203 the recovery the refusal names', () => {
  it('OS_AUTH_ALLOWED_IP_RANGES set empty opens the gate over a stored list on the next boot', async () => {
    const env: Record<string, string | undefined> = {};
    const svc = new SettingsService({ env });
    svc.registerManifest(authManifest);
    await svc.set('auth', 'allowed_ip_ranges', OFFICE, {});

    const locked = await boot({ svc });
    expect(locked.manager.isClientIpAllowed('::1')).toBe(false);

    env.OS_AUTH_ALLOWED_IP_RANGES = '';
    const recovered = await boot({ svc });
    expect(recovered.manager.isClientIpAllowed('::1')).toBe(true);
  });
});

describe('#30320 an IPv6 range is judged at both doors as the range it names', () => {
  const OFFICE_V6 = '2001:db8:1200::/40';

  it('the sign-in gate admits an IPv6 client inside an allowed IPv6 range and refuses one outside', async () => {
    const { svc, manager } = await boot();
    await svc.set('auth', 'allowed_ip_ranges', OFFICE_V6, {});
    await vi.waitFor(() => expect(manager.isClientIpAllowed('::1')).toBe(false));
    expect(manager.isClientIpAllowed('2001:db8:1234::7')).toBe(true);
    expect(manager.isClientIpAllowed('2001:db8:1300::7')).toBe(false);
    expect(manager.isClientIpAllowed('203.0.113.7')).toBe(false);
  });

  it('a save from an IPv6 address inside the range is stored, and one from outside is refused', async () => {
    const { svc, manager, save } = await boot();
    const outside = await save({ allowed_ip_ranges: OFFICE_V6 }, { remoteAddress: '2001:db8:1300::7' });
    expect(outside.status).toBe(400);
    expect(outside.body.error.code).toBe('SETTINGS_VALIDATION');
    expect(outside.body.error.details.fields[0].constraint).toEqual({ clientAddress: '2001:db8:1300::7' });
    expect(await stored(svc)).toBeNull();

    const inside = await save({ allowed_ip_ranges: OFFICE_V6 }, { remoteAddress: '2001:db8:1234::7' });
    expect(inside.status).toBe(200);
    expect(await stored(svc)).toBe(OFFICE_V6);
    await vi.waitFor(() => expect(manager.isClientIpAllowed('::1')).toBe(false));
    expect(manager.isClientIpAllowed('2001:db8:1234::7')).toBe(true);
  });
});

describe('#30398 the address read serves the address the save check judges', () => {
  // TEST-NET-1: no address any case below connects from falls inside it, so a
  // save of this list is always refused and its refusal names the judged address.
  const NOBODY = '192.0.2.0/24';

  /** One connection, asked at both doors: the read's answer and the save check's judged address. */
  const bothDoors = async (rig: Rig, transport: Transport) => {
    const read = await rig.read(transport);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    const save = await rig.save({ allowed_ip_ranges: NOBODY }, transport);
    expect(save.status, JSON.stringify(save.body)).toBe(400);
    const judged = save.body.error.details.fields.find((f: any) => f.field === 'allowed_ip_ranges').constraint.clientAddress;
    return { shown: read.body.data, judged };
  };

  it('a direct peer: the read shows the peer address the save judges', async () => {
    const { shown, judged } = await bothDoors(await boot(), { remoteAddress: '203.0.113.9' });
    expect(shown).toEqual({ clientAddress: '203.0.113.9', trustProxy: false });
    expect(judged).toBe(shown.clientAddress);
  });

  it('an IPv4-mapped peer: the read shows the mapped text the save judges, not a rewritten one', async () => {
    const { shown, judged } = await bothDoors(await boot(), { remoteAddress: '::ffff:127.0.0.1' });
    expect(shown).toEqual({ clientAddress: '::ffff:127.0.0.1', trustProxy: false });
    expect(judged).toBe(shown.clientAddress);
  });

  it('trustProxy declared: the read shows the forwarded address the save judges', async () => {
    const forwarded = { headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.2' }, remoteAddress: '10.0.0.1' };
    const { shown, judged } = await bothDoors(await boot({ plugin: { trustProxy: true } }), forwarded);
    expect(shown).toEqual({ clientAddress: '198.51.100.7', trustProxy: true });
    expect(judged).toBe(shown.clientAddress);
  });

  it('trustProxy not declared: a forged X-Forwarded-For is ignored at both doors, the peer is shown', async () => {
    const forged = { headers: { 'x-forwarded-for': '198.51.100.7', 'x-real-ip': '198.51.100.8' }, remoteAddress: '10.0.0.1' };
    const { shown, judged } = await bothDoors(await boot(), forged);
    expect(shown).toEqual({ clientAddress: '10.0.0.1', trustProxy: false });
    expect(judged).toBe(shown.clientAddress);
  });

  it('an address the server cannot establish reads null at both doors', async () => {
    const { shown, judged } = await bothDoors(await boot(), {});
    expect(shown).toEqual({ clientAddress: null, trustProxy: false });
    expect(judged).toBeNull();
  });

  it('the answer is never stored by a cache', async () => {
    const res = await (await boot()).read({ remoteAddress: '203.0.113.9' });
    expect(res.status).toBe(200);
    expect(res.cacheControl).toBe('no-store');
  });

  describe('who may read it: the platform-admin gate of every /admin mount, before any address is read', () => {
    const refusedBeforeTheRead = async (session: unknown) => {
      const rig = await boot();
      const asked = vi.spyOn(rig.manager, 'trustsForwardedHeaders');
      const res = await rig.read({ remoteAddress: '203.0.113.9' }, { session });
      expect(asked).not.toHaveBeenCalled();
      expect(res.body.success).toBe(false);
      expect(res.body.data).toBeUndefined();
      return res;
    };

    it('no session: 401 UNAUTHENTICATED', async () => {
      const res = await refusedBeforeTheRead(null);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('a signed-in caller who is not a platform admin: 403 PERMISSION_DENIED', async () => {
      const res = await refusedBeforeTheRead({ user: { id: 'usr_member', email: 'member@example.com' } });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PERMISSION_DENIED');
    });

    it("a held platform admin's session (ADR-0069 D3): 403 with the posture's own code", async () => {
      const held = { user: { ...PLATFORM_ADMIN_SESSION.user, authGate: { code: 'MFA_REQUIRED', message: 'Set up two-factor authentication.' } } };
      const res = await refusedBeforeTheRead(held);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('MFA_REQUIRED');
    });
  });

  it('the query set is closed and empty: any parameter is refused 400 VALIDATION_ERROR before the address is read', async () => {
    const rig = await boot();
    const asked = vi.spyOn(rig.manager, 'trustsForwardedHeaders');
    const res = await rig.read({ remoteAddress: '203.0.113.9' }, { query: '?address=198.51.100.7' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.data).toBeUndefined();
    expect(asked).not.toHaveBeenCalled();
  });
});

describe('#30385 the env recovery clears the stored list, so lifting the override does not lock the caller out again', () => {
  it('set the override empty, sign in, clear the stored list through the settings door, remove the override: the caller is admitted', async () => {
    const env: Record<string, string | undefined> = {};
    const svc = new SettingsService({ env });
    svc.registerManifest(authManifest);
    await svc.set('auth', 'allowed_ip_ranges', OFFICE, {});
    expect((await boot({ svc })).manager.isClientIpAllowed('::1')).toBe(false);

    // Start the server with the override set empty: the gate opens.
    env.OS_AUTH_ALLOWED_IP_RANGES = '';
    const recovered = await boot({ svc });
    expect(recovered.manager.isClientIpAllowed('::1')).toBe(true);

    // A value is still refused while the override is in force, the empty string included.
    const refused = await recovered.save({ allowed_ip_ranges: '' }, { remoteAddress: '::1' });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('SETTINGS_LOCKED');
    expect(refused.body.error.details).toEqual({ namespace: 'auth', key: 'allowed_ip_ranges', reason: 'locked-by-env' });

    // The clear goes through; the answer still reads the override, locked, and the gate stays open.
    const cleared = await recovered.save({ allowed_ip_ranges: null }, { remoteAddress: '::1' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.values.allowed_ip_ranges).toMatchObject({ value: '', source: 'env', locked: true });
    expect(recovered.manager.isClientIpAllowed('::1')).toBe(true);

    // Remove the override and restart: no stored list comes back.
    delete env.OS_AUTH_ALLOWED_IP_RANGES;
    expect((await svc.get('auth', 'allowed_ip_ranges', {})).source).toBe('default');
    const restarted = await boot({ svc });
    expect(restarted.manager.isClientIpAllowed('::1')).toBe(true);
  });
});
