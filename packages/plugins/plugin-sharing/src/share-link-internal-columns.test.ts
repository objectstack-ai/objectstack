// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21197] `sys_share_link.token` and `.password_hash` are declared
 * `internal: true` (ruling record 5942811916, C2): no generic exit — the data
 * path, and the compliance ledger's CRUD mirror that honours the same flag —
 * carries them. This plugin's own routes still need both, and get them back
 * through the engine's privileged accessor.
 *
 * Run on a REAL `ObjectQL` over `@objectstack/driver-sql` + better-sqlite3, so
 * the engine's strip is live: a fake engine that hands rows back whole would
 * keep every assertion below green with the recovery deleted.
 *
 * Pinned:
 *  - the generic read omits both columns; storage holds both;
 *  - a password-protected link REFUSES redemption without its password and
 *    with a wrong one, and opens with the right one — the gate is held, never
 *    weakened by the strip;
 *  - the redemption route still answers "password required" (401) for a
 *    protected link, and still resolves an open one with the link's token —
 *    what the console's shared page addresses the link's companion routes by;
 *  - the creator's link list still carries each link's token — what the
 *    console builds and copies the URL from — and no hash.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { SysShareLink } from './objects/sys-share-link.object.js';
import { ShareLinkService } from './share-link-service.js';
import { registerShareLinkRoutes } from './share-link-routes.js';
import type { SharingEngine } from './sharing-service.js';

type Row = Record<string, unknown>;

const TARGET = {
  name: 'pin_doc',
  label: 'Pinned Doc',
  publicSharing: { enabled: true, allowedAudiences: ['link_only'], allowedPermissions: ['view'] },
  fields: {
    id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' },
  },
};

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

async function drive(
  http: MockHttp,
  key: string,
  opts: { params?: Record<string, string>; query?: Record<string, string | string[]>; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any }> {
  const handler = http.routes.get(key);
  if (!handler) throw new Error(`no handler for ${key}`);
  const captured = { status: 200, body: undefined as any };
  const res: IHttpResponse = {
    json: vi.fn((data: any) => { captured.body = data; }) as any,
    send: vi.fn() as any,
    status: vi.fn((code: number) => { captured.status = code; return res; }) as any,
    header: vi.fn(() => res) as any,
  };
  const req: IHttpRequest = {
    params: opts.params ?? {},
    query: opts.query ?? {},
    body: undefined,
    headers: opts.headers ?? {},
    method: 'GET',
    path: '/',
  };
  await handler(req, res);
  return captured;
}

const B = '/api/v1/share-links';
const CREATOR = { userId: 'usr_creator' };

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try {
      await (engines.pop() as unknown as { destroy?(): Promise<void> })?.destroy?.();
    } catch {
      /* noop */
    }
  }
});

async function boot() {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  for (const o of [SysShareLink, TARGET]) engine.registry.registerObject(o as never, '@objectstack/plugin-sharing');
  await engine.syncSchemas();
  await (engine as any).insert('pin_doc', { id: 'doc_1', title: 'Shared doc' }, { context: { isSystem: true } });
  const service = new ShareLinkService({ engine: engine as unknown as SharingEngine });
  const http = new MockHttp();
  registerShareLinkRoutes(http, service, engine as unknown as SharingEngine, {
    contextFromRequest: () => ({ ...CREATOR }),
  });
  return { engine: engine as any, service, http };
}

async function rowsAtRest(engine: any): Promise<Row[]> {
  const found = await engine.getDriver('sys_share_link').find('sys_share_link', { where: {} });
  return (Array.isArray(found) ? found : [found]).filter(Boolean);
}

const PASSWORD = 'open sesame 21197';

describe('[#21197] sys_share_link: the internal token and password hash, and the routes that read them back', () => {
  it('the generic read omits both columns; storage holds both', async () => {
    const { engine, service } = await boot();
    const link = await service.createLink({ object: 'pin_doc', recordId: 'doc_1', password: PASSWORD }, CREATOR);
    const [stored] = await rowsAtRest(engine);
    expect(stored?.token).toBe(link.token);
    expect(stored?.password_hash, 'a hash is stored').toBeTruthy();

    const generic = (await engine.find('sys_share_link', { context: { isSystem: true } })) as Row[];
    expect(generic).toHaveLength(1);
    expect(generic[0]).not.toHaveProperty('token');
    expect(generic[0]).not.toHaveProperty('password_hash');
  });

  it('a password-protected link refuses without the password and with a wrong one, and opens with it', async () => {
    const { service } = await boot();
    const link = await service.createLink({ object: 'pin_doc', recordId: 'doc_1', password: PASSWORD }, CREATOR);

    expect(await service.resolveToken(link.token), 'no password').toBeNull();
    expect(await service.resolveToken(link.token, { providedPassword: 'not it' }), 'wrong password').toBeNull();
    const opened = await service.resolveToken(link.token, { providedPassword: PASSWORD });
    expect(opened, 'the right password opens it').not.toBeNull();
    expect(opened!.link.token, 'the resolved link carries its token').toBe(link.token);
    expect(opened!.link, 'and no hash').not.toHaveProperty('password_hash');
  });

  it('the redemption route answers password-required, refuses a wrong password, and opens with the right one', async () => {
    const { service, http } = await boot();
    const link = await service.createLink({ object: 'pin_doc', recordId: 'doc_1', password: PASSWORD }, CREATOR);

    const bare = await drive(http, `GET ${B}/:token/resolve`, { params: { token: link.token } });
    expect(bare.status).toBe(401);
    expect(bare.body?.error?.code).toBe('NEEDS_PASSWORD');

    const wrong = await drive(http, `GET ${B}/:token/resolve`, { params: { token: link.token }, headers: { 'x-share-password': 'not it' } });
    expect(wrong.status).toBe(401);
    expect(wrong.body?.error?.code).toBe('WRONG_PASSWORD');

    const right = await drive(http, `GET ${B}/:token/resolve`, { params: { token: link.token }, headers: { 'x-share-password': PASSWORD } });
    expect(right.status).toBe(200);
    expect(right.body?.data?.record?.id).toBe('doc_1');
    expect(right.body?.data?.link?.token).toBe(link.token);
  });

  it('an open link resolves through the route with its token, as the shared page needs', async () => {
    const { service, http } = await boot();
    const link = await service.createLink({ object: 'pin_doc', recordId: 'doc_1' }, CREATOR);
    const res = await drive(http, `GET ${B}/:token/resolve`, { params: { token: link.token } });
    expect(res.status).toBe(200);
    expect(res.body?.data?.link?.token).toBe(link.token);
    expect(res.body?.data?.record?.title).toBe('Shared doc');
  });

  it("the creator's link list carries each link's token, and no hash", async () => {
    const { service, http } = await boot();
    const a = await service.createLink({ object: 'pin_doc', recordId: 'doc_1', password: PASSWORD }, CREATOR);
    const b = await service.createLink({ object: 'pin_doc', recordId: 'doc_1' }, CREATOR);

    const res = await drive(http, `GET ${B}`, { query: { object: 'pin_doc', recordId: 'doc_1' } });
    expect(res.status).toBe(200);
    const listed = (res.body?.data ?? []) as Row[];
    expect(listed.map((l) => l.token).sort()).toEqual([a.token, b.token].sort());
    for (const l of listed) expect(l).not.toHaveProperty('password_hash');
  });
});
