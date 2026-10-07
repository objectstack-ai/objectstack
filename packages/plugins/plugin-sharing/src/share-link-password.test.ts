// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21839] A share link's password: what leaves the server, how it is stored,
 * how it travels in.
 *
 * Run on a REAL `ObjectQL` over `@objectstack/driver-sql` + better-sqlite3, so
 * the engine's strip of the `internal` hash column is live and every exit below
 * is the one production answers with.
 *
 * Pinned:
 *  - no exit carries the stored hash or any part of it — the mint response
 *    (service and route), the creator's list, the redemption result (service
 *    and route);
 *  - the stored form is the platform's slow password hash, and holds no
 *    plaintext;
 *  - a row in either legacy stored form still verifies, a wrong password is
 *    refused and leaves it alone, and the right password re-hashes it into the
 *    current form — once every later gate has passed;
 *  - a refused upgrade does not block the read and is reported once, naming
 *    the link and never the password;
 *  - the `x-share-password` header is accepted on both public routes, the
 *    `?password=` query parameter still is, and a wrong password is refused
 *    through either form;
 *  - no log line carries the presented password;
 *  - [#22049] `X-Share-Password-Encoding: utf-8` declares the header
 *    percent-encoded UTF-8, so a CJK and an emoji password resolve through it
 *    on both public routes; without it a Latin-1 password and a raw one
 *    containing `%` resolve unchanged; a declared encoding that does not hold
 *    is refused `400 VALIDATION_FAILED` before the token is looked up, never
 *    compared raw;
 *  - both public routes answer `Cache-Control: no-store` and
 *    `Vary: X-Share-Password, X-Share-Password-Encoding` on every outcome, and
 *    the authenticated routes do not;
 *  - the pure-JS scrypt the WebContainer path uses and `node:crypto`'s produce
 *    interchangeable hashes.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { SysShareLink } from './objects/sys-share-link.object.js';
import { ShareLinkService } from './share-link-service.js';
import { registerShareLinkRoutes } from './share-link-routes.js';
import {
  hashShareLinkPassword,
  verifyShareLinkPassword,
  isLegacyShareLinkPasswordHash,
} from './share-link-password.js';
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

const CONVERSATIONS = {
  name: 'ai_conversations',
  label: 'Conversation',
  publicSharing: { enabled: true, allowedAudiences: ['link_only'], allowedPermissions: ['view'] },
  fields: {
    id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' },
  },
};

const MESSAGES = {
  name: 'ai_messages',
  label: 'Message',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
    conversation_id: { name: 'conversation_id', label: 'Conversation', type: 'text' },
    content: { name: 'content', label: 'Content', type: 'text' },
    created_at: { name: 'created_at', label: 'Created', type: 'text' },
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
  opts: {
    params?: Record<string, string>;
    query?: Record<string, string | string[]>;
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
): Promise<{ status: number; body: any; headers: Record<string, string | string[]> }> {
  const handler = http.routes.get(key);
  if (!handler) throw new Error(`no handler for ${key}`);
  const captured = { status: 200, body: undefined as any, headers: {} as Record<string, string | string[]> };
  const res: IHttpResponse = {
    json: vi.fn((data: any) => { captured.body = data; }) as any,
    send: vi.fn() as any,
    status: vi.fn((code: number) => { captured.status = code; return res; }) as any,
    header: vi.fn((name: string, value: string | string[]) => { captured.headers[name] = value; return res; }) as any,
  };
  const req: IHttpRequest = {
    params: opts.params ?? {},
    query: opts.query ?? {},
    body: opts.body,
    headers: opts.headers ?? {},
    method: key.split(' ')[0]!,
    path: '/',
  };
  await handler(req, res);
  return captured;
}

const B = '/api/v1/share-links';
const CREATOR = { userId: 'usr_creator' };
const PASSWORD = 'correct horse 21839 $ battery';

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

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/** Every argument any logger member received, serialised. */
function loggedText(logger: ReturnType<typeof makeLogger>): string {
  const calls = [
    ...logger.info.mock.calls,
    ...logger.warn.mock.calls,
    ...logger.error.mock.calls,
    ...logger.debug.mock.calls,
  ];
  return JSON.stringify(calls);
}

async function boot(
  opts: {
    refuseHashWrites?: boolean;
    /** An engine whose `sys_share_link` reads do NOT strip the hash column. */
    leakyReads?: boolean;
    serviceOptions?: Partial<ConstructorParameters<typeof ShareLinkService>[0]>;
  } = {},
) {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  for (const o of [SysShareLink, TARGET, CONVERSATIONS, MESSAGES]) {
    engine.registry.registerObject(o as never, '@objectstack/plugin-sharing');
  }
  await engine.syncSchemas();
  const sys = { context: { isSystem: true } };
  await (engine as any).insert('pin_doc', { id: 'doc_1', title: 'Shared doc' }, sys);
  await (engine as any).insert('ai_conversations', { id: 'conv_1', title: 'Chat' }, sys);
  await (engine as any).insert(
    'ai_messages',
    { id: 'msg_1', conversation_id: 'conv_1', content: 'hello', created_at: '2026-01-01T00:00:00Z' },
    sys,
  );

  // The engine the service is handed: the real one, optionally refusing any
  // write of the password hash column (the upgrade write), or optionally
  // handing the hash column back on every `sys_share_link` read (an engine
  // without the `internal` strip — the case the service's own exit projection
  // exists for).
  const served: any = opts.refuseHashWrites || opts.leakyReads
    ? new Proxy(engine as any, {
        get(target, prop, receiver) {
          if (prop === 'find' && opts.leakyReads) {
            return async (object: string, q: unknown) => {
              const rows = await target.find(object, q);
              if (object !== 'sys_share_link' || !Array.isArray(rows)) return rows;
              return Promise.all(
                rows.map(async (r: Row) => ({ ...r, password_hash: await storedHash(target, String(r.id)) })),
              );
            };
          }
          if (prop === 'update' && opts.refuseHashWrites) {
            return async (object: string, data: Row, o: unknown) => {
              if (object === 'sys_share_link' && 'password_hash' in (data ?? {})) {
                const err: any = new Error('storage refused the write');
                err.code = 'STORAGE_REFUSED';
                throw err;
              }
              return target.update(object, data, o);
            };
          }
          const v = Reflect.get(target, prop, receiver);
          return typeof v === 'function' ? v.bind(target) : v;
        },
      })
    : engine;

  const logger = makeLogger();
  const service = new ShareLinkService({
    engine: served as SharingEngine,
    logger,
    ...(opts.serviceOptions ?? {}),
  });
  const http = new MockHttp();
  registerShareLinkRoutes(http, service, served as SharingEngine, {
    contextFromRequest: () => ({ ...CREATOR }),
  });
  return { engine: engine as any, service, http, logger };
}

async function storedHash(engine: any, id: string): Promise<string | null> {
  const found = await engine.getDriver('sys_share_link').find('sys_share_link', { where: { id } });
  const rows = (Array.isArray(found) ? found : [found]).filter(Boolean) as Row[];
  const v = rows[0]?.password_hash;
  return typeof v === 'string' ? v : null;
}

async function setStoredHash(engine: any, id: string, hash: string): Promise<void> {
  await engine.getDriver('sys_share_link').update('sys_share_link', id, { password_hash: hash });
}

function legacySha256(password: string, salt = 'legacySalt123456'): string {
  return `sha256$${salt}$${createHash('sha256').update(`${salt}:${password}`, 'utf8').digest('hex')}`;
}

function legacyPlaintext(password: string, salt = 'legacySalt123456'): string {
  return `weak$${salt}$${password}`;
}

/** Assert a serialised exit carries neither the hash key nor any piece of the stored hash. */
function expectNoHash(value: unknown, hash: string, label: string): void {
  const text = JSON.stringify(value);
  expect(text, `${label}: no password_hash key`).not.toContain('password_hash');
  for (const piece of hash.split('$').filter((p) => p.length >= 16)) {
    expect(text, `${label}: no part of the stored hash`).not.toContain(piece);
  }
}

describe('[#21839] the stored hash never leaves the server', () => {
  it('the mint response, through the service and through the route, carries no hash', async () => {
    const { engine, service, http } = await boot();

    const minted = await service.createLink({ object: 'pin_doc', recordId: 'doc_1', password: PASSWORD }, CREATOR);
    const stored = await storedHash(engine, minted.id);
    expect(stored, 'a hash is stored').toBeTruthy();
    expect(minted.token, 'the creator still gets the token').toBeTruthy();
    expect(minted).not.toHaveProperty('password_hash');
    expectNoHash(minted, stored!, 'service createLink');

    const res = await drive(http, `POST ${B}`, { body: { object: 'pin_doc', recordId: 'doc_1', password: PASSWORD } });
    expect(res.status).toBe(201);
    expect(res.body?.data?.token).toBeTruthy();
    expect(res.body?.data).not.toHaveProperty('password_hash');
    expectNoHash(res.body, (await storedHash(engine, res.body.data.id))!, 'POST route');
  });

  it('the list and the redemption result, through the service and through the route, carry no hash', async () => {
    const { engine, service, http } = await boot();
    const minted = await service.createLink({ object: 'pin_doc', recordId: 'doc_1', password: PASSWORD }, CREATOR);
    const stored = (await storedHash(engine, minted.id))!;

    const listed = await service.listLinks({ createdBy: CREATOR.userId }, CREATOR);
    expect(listed).toHaveLength(1);
    expectNoHash(listed, stored, 'service listLinks');
    expectNoHash((await drive(http, `GET ${B}`)).body, stored, 'GET list route');

    const resolved = await service.resolveToken(minted.token, { providedPassword: PASSWORD });
    expect(resolved).not.toBeNull();
    expectNoHash(resolved, stored, 'service resolveToken');
    const viaRoute = await drive(http, `GET ${B}/:token/resolve`, {
      params: { token: minted.token },
      headers: { 'x-share-password': PASSWORD },
    });
    expect(viaRoute.status).toBe(200);
    expectNoHash(viaRoute.body, stored, 'GET resolve route');
  });

  it('the list and the redemption result carry no hash even from an engine that does not strip it', async () => {
    const { engine, service } = await boot({ leakyReads: true });
    const minted = await service.createLink({ object: 'pin_doc', recordId: 'doc_1', password: PASSWORD }, CREATOR);
    const stored = (await storedHash(engine, minted.id))!;

    // Control: the wired engine really hands the hash back, so the absence
    // below is the service's projection and not the engine's strip.
    const raw = await (service as unknown as { engine: SharingEngine }).engine.find('sys_share_link', {
      where: { id: minted.id },
      context: { isSystem: true },
    } as never);
    expect((raw as Row[])[0]?.password_hash, 'the leaky engine returns the hash').toBe(stored);

    expectNoHash(await service.listLinks({ createdBy: CREATOR.userId }, CREATOR), stored, 'service listLinks');
    const resolved = await service.resolveToken(minted.token, { providedPassword: PASSWORD });
    expect(resolved, 'the password still verifies through the leaky read').not.toBeNull();
    expectNoHash(resolved, stored, 'service resolveToken');
  });
});

describe('[#21839] the stored form is the platform slow password hash', () => {
  it('a new link stores scrypt, with no plaintext, and two hashes of one password differ', async () => {
    const { engine, service } = await boot();
    const a = await service.createLink({ object: 'pin_doc', recordId: 'doc_1', password: PASSWORD }, CREATOR);
    const b = await service.createLink({ object: 'pin_doc', recordId: 'doc_1', password: PASSWORD }, CREATOR);
    const ha = (await storedHash(engine, a.id))!;
    const hb = (await storedHash(engine, b.id))!;
    expect(ha).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(ha).not.toContain(PASSWORD);
    expect(isLegacyShareLinkPasswordHash(ha)).toBe(false);
    expect(ha, 'a per-row salt').not.toBe(hb);
  });

  it('the verifier accepts the right password and refuses a wrong one, an empty one and an unknown form', async () => {
    const hash = await hashShareLinkPassword(PASSWORD);
    expect(await verifyShareLinkPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyShareLinkPassword(`${PASSWORD} `, hash)).toBe(false);
    expect(await verifyShareLinkPassword('', hash)).toBe(false);
    expect(await verifyShareLinkPassword(PASSWORD, `argon2$${hash.slice('scrypt$'.length)}`)).toBe(false);
    expect(await verifyShareLinkPassword(PASSWORD, 'scrypt$nosalt')).toBe(false);
  });
});

describe.each([
  ['salted SHA-256', legacySha256],
  ['plaintext (no SubtleCrypto)', legacyPlaintext],
] as const)('[#21839] a legacy %s row', (_name, legacy) => {
  it('still verifies, refuses a wrong password without touching the row, and is upgraded by the right one', async () => {
    const { engine, service } = await boot();
    const link = await service.createLink({ object: 'pin_doc', recordId: 'doc_1', password: 'placeholder' }, CREATOR);
    const legacyHash = legacy(PASSWORD);
    await setStoredHash(engine, link.id, legacyHash);
    expect(isLegacyShareLinkPasswordHash(legacyHash)).toBe(true);

    expect(await service.resolveToken(link.token, { providedPassword: 'not it' }), 'wrong password').toBeNull();
    expect(await service.resolveToken(link.token), 'no password').toBeNull();
    expect(await storedHash(engine, link.id), 'a refused attempt writes nothing').toBe(legacyHash);

    const opened = await service.resolveToken(link.token, { providedPassword: PASSWORD });
    expect(opened, 'the legacy row still opens with its password').not.toBeNull();

    const upgraded = (await storedHash(engine, link.id))!;
    expect(upgraded, 'upgraded into the current form').toMatch(/^scrypt\$/);
    expect(await verifyShareLinkPassword(PASSWORD, upgraded), 'the upgraded hash verifies the same password').toBe(true);
    expect(await service.resolveToken(link.token, { providedPassword: PASSWORD }), 'and the link keeps working').not.toBeNull();
    expect(await service.resolveToken(link.token, { providedPassword: 'not it' }), 'still refuses a wrong one').toBeNull();
  });
});

describe('[#21839] the legacy upgrade', () => {
  it('is not attempted for a switched-off object, whose redemption is refused', async () => {
    const { engine, service } = await boot();
    const link = await service.createLink({ object: 'pin_doc', recordId: 'doc_1', password: 'placeholder' }, CREATOR);
    const legacyHash = legacySha256(PASSWORD);
    await setStoredHash(engine, link.id, legacyHash);
    const schema = engine.getSchema('pin_doc');
    const original = schema.publicSharing;
    schema.publicSharing = { ...original, enabled: false };
    try {
      expect(await service.resolveToken(link.token, { providedPassword: PASSWORD })).toBeNull();
    } finally {
      schema.publicSharing = original;
    }
    expect(await storedHash(engine, link.id), 'no write on a refused redemption').toBe(legacyHash);
  });

  it('a refused upgrade write does not block the read, leaves the legacy form verifying, and is reported once without the password', async () => {
    const { engine, service, logger } = await boot({ refuseHashWrites: true });
    const link = await service.createLink({ object: 'pin_doc', recordId: 'doc_1', password: 'placeholder' }, CREATOR);
    const legacyHash = legacySha256(PASSWORD);
    await setStoredHash(engine, link.id, legacyHash);

    expect(await service.resolveToken(link.token, { providedPassword: PASSWORD })).not.toBeNull();
    expect(await service.resolveToken(link.token, { providedPassword: PASSWORD })).not.toBeNull();
    expect(await storedHash(engine, link.id)).toBe(legacyHash);

    const reports = logger.error.mock.calls.filter((c) => String(c[0]).includes('legacy password hash upgrade REFUSED'));
    expect(reports, 'reported once per service instance').toHaveLength(1);
    expect(reports[0]![1]).toMatchObject({ link: link.id, reason: 'STORAGE_REFUSED' });
    expect(loggedText(logger)).not.toContain(PASSWORD);
    expect(loggedText(logger)).not.toContain(legacyHash.split('$')[2]);
  });

  it('is not attempted when the deployment injects its own hasher pair', async () => {
    const { engine, service } = await boot({
      serviceOptions: {
        hashPassword: async (p: string) => `custom$${p.length}`,
        verifyPassword: async (p: string, h: string) => h === legacySha256(PASSWORD) && p === PASSWORD,
      },
    });
    const link = await service.createLink({ object: 'pin_doc', recordId: 'doc_1', password: 'placeholder' }, CREATOR);
    const legacyHash = legacySha256(PASSWORD);
    await setStoredHash(engine, link.id, legacyHash);
    expect(await service.resolveToken(link.token, { providedPassword: PASSWORD })).not.toBeNull();
    expect(await storedHash(engine, link.id), 'an injected pair owns its stored forms').toBe(legacyHash);
  });
});

describe('[#21839] how the password travels in', () => {
  async function protectedConversation() {
    const booted = await boot();
    const link = await booted.service.createLink(
      { object: 'ai_conversations', recordId: 'conv_1', password: PASSWORD },
      CREATOR,
    );
    return { ...booted, link };
  }

  it.each(['resolve', 'messages'] as const)('/%s accepts the x-share-password header', async (route) => {
    const { http, link } = await protectedConversation();
    const res = await drive(http, `GET ${B}/:token/${route}`, {
      params: { token: link.token },
      headers: { 'x-share-password': PASSWORD },
    });
    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);
    if (route === 'messages') expect(res.body?.data?.map((m: Row) => m.id)).toEqual(['msg_1']);
    else expect(res.body?.data?.record?.id).toBe('conv_1');
  });

  it.each(['resolve', 'messages'] as const)('/%s still accepts the ?password= query parameter', async (route) => {
    const { http, link } = await protectedConversation();
    const res = await drive(http, `GET ${B}/:token/${route}`, {
      params: { token: link.token },
      query: { password: PASSWORD },
    });
    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);
  });

  it.each([
    ['resolve', 'header', 401, 'WRONG_PASSWORD'],
    ['resolve', 'query', 401, 'WRONG_PASSWORD'],
    ['messages', 'header', 404, 'NOT_FOUND'],
    ['messages', 'query', 404, 'NOT_FOUND'],
  ] as const)('/%s refuses a wrong password sent as a %s', async (route, form, status, code) => {
    const { http, link, logger } = await protectedConversation();
    const wrong = 'not the password 21839';
    const res = await drive(http, `GET ${B}/:token/${route}`, {
      params: { token: link.token },
      ...(form === 'header' ? { headers: { 'x-share-password': wrong } } : { query: { password: wrong } }),
    });
    expect(res.status).toBe(status);
    expect(res.body?.success).toBe(false);
    expect(res.body?.error?.code).toBe(code);
    expect(JSON.stringify(res.body)).not.toContain(wrong);
    expect(loggedText(logger)).not.toContain(wrong);
  });

  it('no log line carries the presented password, on any outcome', async () => {
    const { http, link, logger } = await protectedConversation();
    for (const pw of [PASSWORD, 'wrong one 21839']) {
      for (const route of ['resolve', 'messages']) {
        await drive(http, `GET ${B}/:token/${route}`, { params: { token: link.token }, headers: { 'x-share-password': pw } });
        await drive(http, `GET ${B}/:token/${route}`, { params: { token: link.token }, query: { password: pw } });
      }
    }
    expect(loggedText(logger)).not.toContain(PASSWORD);
    expect(loggedText(logger)).not.toContain('wrong one 21839');
  });
});

describe('[#22049] the password header declares its encoding', () => {
  const CJK = '分享密码二二零四九';
  const EMOJI = 'open 🔐🦊 sesame';
  const LATIN1 = 'Déjà vu ½ ÿ 22049';
  const RAW_PERCENT = 'grade 100% %zz 22049';
  const RAW_PERCENT_ESCAPE = '50%25 off 22049';
  const UTF8 = { 'x-share-password-encoding': 'utf-8' };

  async function protectedConversation(password: string) {
    const booted = await boot();
    const link = await booted.service.createLink(
      { object: 'ai_conversations', recordId: 'conv_1', password },
      CREATOR,
    );
    return { ...booted, link };
  }

  function expectServed(route: 'resolve' | 'messages', res: { status: number; body: any }, label: string) {
    expect(res.status, label).toBe(200);
    expect(res.body?.success, label).toBe(true);
    if (route === 'messages') expect(res.body?.data?.map((m: Row) => m.id), label).toEqual(['msg_1']);
    else expect(res.body?.data?.record?.id, label).toBe('conv_1');
  }

  it.each([
    ['resolve', 'CJK', CJK],
    ['resolve', 'emoji', EMOJI],
    ['messages', 'CJK', CJK],
    ['messages', 'emoji', EMOJI],
  ] as const)('/%s serves a %s password sent percent-encoded under utf-8', async (route, label, password) => {
    const { http, link } = await protectedConversation(password);
    const res = await drive(http, `GET ${B}/:token/${route}`, {
      params: { token: link.token },
      headers: { 'x-share-password': encodeURIComponent(password), ...UTF8 },
    });
    expectServed(route, res, label);
  });

  it.each([
    ['resolve', 401, 'WRONG_PASSWORD'],
    ['messages', 404, 'NOT_FOUND'],
  ] as const)('/%s does not guess: the same encoded value with no encoding header is compared raw', async (route, status, code) => {
    const { http, link } = await protectedConversation(CJK);
    const res = await drive(http, `GET ${B}/:token/${route}`, {
      params: { token: link.token },
      headers: { 'x-share-password': encodeURIComponent(CJK) },
    });
    expect(res.status).toBe(status);
    expect(res.body?.error?.code).toBe(code);
  });

  it.each([
    ['resolve', 'Latin-1', LATIN1],
    ['resolve', 'raw with a stray %', RAW_PERCENT],
    ['resolve', 'raw with a %-escape', RAW_PERCENT_ESCAPE],
    ['messages', 'Latin-1', LATIN1],
    ['messages', 'raw with a stray %', RAW_PERCENT],
    ['messages', 'raw with a %-escape', RAW_PERCENT_ESCAPE],
  ] as const)('/%s still serves a %s password sent raw, with no encoding header', async (route, label, password) => {
    const { http, link } = await protectedConversation(password);
    const res = await drive(http, `GET ${B}/:token/${route}`, {
      params: { token: link.token },
      headers: { 'x-share-password': password },
    });
    expectServed(route, res, label);
  });

  it.each([
    ['resolve', 'a truncated UTF-8 sequence', { 'x-share-password': '%E5%88', ...UTF8 }],
    ['resolve', 'an octet that is not UTF-8', { 'x-share-password': '%FF', ...UTF8 }],
    ['resolve', 'an encoding the server does not read', { 'x-share-password': encodeURIComponent(CJK), 'x-share-password-encoding': 'latin1' }],
    ['messages', 'a truncated UTF-8 sequence', { 'x-share-password': '%E5%88', ...UTF8 }],
    ['messages', 'an octet that is not UTF-8', { 'x-share-password': '%FF', ...UTF8 }],
    ['messages', 'an encoding the server does not read', { 'x-share-password': encodeURIComponent(CJK), 'x-share-password-encoding': 'latin1' }],
  ] as const)('/%s refuses %s with 400 VALIDATION_FAILED, before the token is looked up', async (route, _label, headers) => {
    const { http, link, service } = await protectedConversation(CJK);
    const resolveToken = vi.spyOn(service, 'resolveToken');
    const res = await drive(http, `GET ${B}/:token/${route}`, { params: { token: link.token }, headers });
    expect(res.status).toBe(400);
    expect(res.body?.success).toBe(false);
    expect(res.body?.error?.code).toBe('VALIDATION_FAILED');
    expect(res.body?.error?.message).toContain('X-Share-Password');
    expect(JSON.stringify(res.body)).not.toContain(headers['x-share-password']);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(resolveToken).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'messages'] as const)(
    '/%s never falls back to a raw compare: an undecodable value that IS the raw password is still refused',
    async (route) => {
      const rawPassword = '%E5%88 22049';
      const { http, link } = await protectedConversation(rawPassword);
      const raw = await drive(http, `GET ${B}/:token/${route}`, {
        params: { token: link.token },
        headers: { 'x-share-password': rawPassword },
      });
      expectServed(route, raw, 'the raw form, undeclared');
      const declared = await drive(http, `GET ${B}/:token/${route}`, {
        params: { token: link.token },
        headers: { 'x-share-password': rawPassword, ...UTF8 },
      });
      expect(declared.status).toBe(400);
      expect(declared.body?.error?.code).toBe('VALIDATION_FAILED');
    },
  );

  it.each(['resolve', 'messages'] as const)('/%s: the ?password= form still wins, and the header pair is then not read', async (route) => {
    const { http, link } = await protectedConversation(CJK);
    const res = await drive(http, `GET ${B}/:token/${route}`, {
      params: { token: link.token },
      query: { password: CJK },
      headers: { 'x-share-password': '%FF', 'x-share-password-encoding': 'latin1' },
    });
    expectServed(route, res, 'query wins');
  });
});

describe('[#21839] the public routes are never cached', () => {
  function expectNoStore(res: { headers: Record<string, string | string[]> }, label: string) {
    expect(res.headers['Cache-Control'], label).toBe('no-store');
    expect(res.headers.Vary, label).toBe('X-Share-Password, X-Share-Password-Encoding');
  }

  it.each(['resolve', 'messages'] as const)('/%s sends no-store + Vary on success and on every refusal', async (route) => {
    const booted = await boot();
    const link = await booted.service.createLink(
      { object: 'ai_conversations', recordId: 'conv_1', password: PASSWORD },
      CREATOR,
    );
    const key = `GET ${B}/:token/${route}`;
    const ok = await drive(booted.http, key, { params: { token: link.token }, headers: { 'x-share-password': PASSWORD } });
    expect(ok.status).toBe(200);
    expectNoStore(ok, 'success');

    const bare = await drive(booted.http, key, { params: { token: link.token } });
    expect(bare.status).not.toBe(200);
    expectNoStore(bare, 'no password');

    const wrong = await drive(booted.http, key, { params: { token: link.token }, query: { password: 'nope 21839' } });
    expect(wrong.status).not.toBe(200);
    expectNoStore(wrong, 'wrong password');

    const unknown = await drive(booted.http, key, { params: { token: 'no-such-token-21839' } });
    expect(unknown.status).toBe(404);
    expectNoStore(unknown, 'unknown token');
  });

  it('the authenticated list route is not given the public headers', async () => {
    const { http } = await boot();
    const res = await drive(http, `GET ${B}`);
    expect(res.headers['Cache-Control']).toBeUndefined();
    expect(res.headers.Vary).toBeUndefined();
  });
});
