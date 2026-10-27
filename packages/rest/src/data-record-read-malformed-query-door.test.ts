// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26816] `GET /api/v1/data/:object/:id` answers a malformed query at its own
 * status, `400`, and keeps `404` for a record that is missing or that the
 * caller may not read — with the REAL security layer (`SecurityPlugin` on a
 * real `ObjectQL` over a real `SqlDriver`).
 *
 * The route's catch used to answer every mapped `400` as `404`. That rewrite
 * was not an existence guard: until 867ad87e5e (2026-04-30) the catch answered
 * EVERY error `404`, and the rewrite kept that answer for the mapper's `400`
 * band when the mapper arrived. What it hid since is the request-shape
 * refusals `getData` raises before it reads anything — an unknown `select` or
 * `expand` entry (`INVALID_FIELD`) and an empty projection (`VALIDATION_ERROR`,
 * #26644) — so a caller was told "no such record" about its own query string,
 * while the runtime dispatcher's twin route answered the same request `400`.
 *
 * Measured on the base (`5787df4d4b`), and again on the fix:
 *
 * | request | base | fix |
 * |:--|:--|:--|
 * | own record, `?select=nope` | 404 `INVALID_FIELD` | 400, the same body |
 * | own record, `?select=`, `?select=,` | 404 `VALIDATION_ERROR` | 400, the same body |
 * | own record, `?expand=nope` | 404 `INVALID_FIELD` | 400, the same body |
 * | missing id | 404 `RECORD_NOT_FOUND` | unchanged |
 * | a row the caller's row scope hides | 404 `RECORD_NOT_FOUND` | unchanged |
 * | own record, `?select=title` / no query | 200 | unchanged |
 *
 * Why the `404`s need no rewrite: a missing row and a row the caller may not
 * read are one answer by construction — row scope makes the read return no
 * row, and `getData` then throws `RECORD_NOT_FOUND`, which DECLARES `404`.
 * And why the `400` leaks nothing about existence: every one of them is raised
 * before the read, so it is byte-identical whether the id names the caller's
 * row, a hidden row or no row at all — pinned below.
 *
 * The dispatcher's half, and the two hosts compared request for request, is
 * `packages/runtime/src/domains/data-record-read-status-parity.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'rest_by_id_query_26816';
const ME = 'usr_26816_member';
const OTHER = 'usr_26816_other';
const SYS_CTX = { isSystem: true, userId: 'usr_system' };

const MEMBER_SET = PermissionSetSchema.parse({
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
  // The caller reads its own rows only.
  rowLevelSecurity: [{ name: 'own_rows', object: OBJECT, operation: 'select', using: 'record.owner == current_user.id' }],
});
const MEMBER_CTX = { userId: ME, positions: [], permissions: [MEMBER_SET.name], posture: 'MEMBER' };

/** The caller's row, a row its row scope hides, and an id no row has. */
const MINE = 'r_mine';
const HIDDEN = 'r_hidden';
const NOWHERE = 'r_nowhere';

/**
 * name · the querystring · the code · the field the body names (an unknown
 * entry only) · the parameter its sentence names.
 */
const MALFORMED: ReadonlyArray<readonly [string, Record<string, string>, string, string | undefined, string]> = [
  ['?select=nope (the card)', { select: 'nope' }, 'INVALID_FIELD', 'nope', 'select'],
  ['?select= blank (the card)', { select: '' }, 'VALIDATION_ERROR', undefined, 'select'],
  ['?select=, comma-only', { select: ',' }, 'VALIDATION_ERROR', undefined, 'select'],
  ['?expand=nope', { expand: 'nope' }, 'INVALID_FIELD', 'nope', 'expand'],
];

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const res: any = {
    write: () => true, end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

describe('[#26816] GET /data/:object/:id — a malformed query is a 400, a missing or unreadable record a 404', () => {
  let engine: ObjectQL;
  let byId: (id: string, query: Record<string, string>) => Promise<{ status: number; body: any }>;

  beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(
      new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any),
      true,
    );
    await engine.init();
    engine.registerApp({
      id: 'com.objectstack.qa.by-id-malformed-query-26816',
      name: 'By-id read: a malformed query is not a missing record',
      version: '1.0.0',
      type: 'plugin',
      scope: 'system',
      objects: [
        {
          name: OBJECT,
          label: 'Ledger',
          sharingModel: 'public_read_write',
          fields: {
            title: { name: 'title', type: 'text' },
            owner: { name: 'owner', type: 'text' },
          },
        },
      ],
    } as never);
    await engine.syncSchemas();
    // A real `single` install's Default Organization: the system writes below
    // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
    await installDefaultOrganization(engine);

    const services: Record<string, unknown> = {
      manifest: { register: vi.fn() },
      objectql: engine,
      metadata: {
        get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
        list: async () => [MEMBER_SET],
      },
    };
    const ctx = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registerService: vi.fn(),
      getService: (name: string) => {
        if (!(name in services)) throw new Error(`service not registered: ${name}`);
        return services[name];
      },
    };
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    await plugin.init(ctx as never);
    await plugin.start(ctx as never);

    await engine.insert(OBJECT, [
      { id: MINE, title: 'mine', owner: ME },
      { id: HIDDEN, title: 'theirs', owner: OTHER },
    ], { context: SYS_CTX } as never);

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ ...MEMBER_CTX });
    rest.registerRoutes();
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object/:id');
    expect(route).toBeDefined();
    byId = async (id, query) => {
      const res = makeRes();
      await route!.handler({ params: { object: OBJECT, id }, query, headers: {} } as any, res);
      return { status: res._status ?? 200, body: res._json };
    };
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('precondition: the caller reads its own row and its row scope hides the other one', async () => {
    const read = (id: string) => engine.findOne(OBJECT, { where: { id }, context: { ...MEMBER_CTX } } as never);
    expect((await read(MINE) as any)?.title).toBe('mine');
    expect(await read(HIDDEN)).toBeNull();
  });

  it.each(MALFORMED)('%s on the caller\'s own record: 400 with the mapped body — its code, and the field and parameter it names', async (_name, query, code, field, param) => {
    const res = await byId(MINE, query);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.code).toBe(code);
    expect(res.body.field).toBe(field);
    expect(res.body.object).toBe(OBJECT);
    // The parameter is named in the sentence only: the thrown error's `param`
    // reaches neither host's wire body.
    expect(res.body.error).toContain(`'${param}'`);
  });

  it.each(MALFORMED)('%s answers the same bytes whether the id is the caller\'s, hidden, or nowhere — the 400 says nothing about existence', async (_name, query) => {
    const mine = await byId(MINE, query);
    expect(await byId(HIDDEN, query)).toEqual(mine);
    expect(await byId(NOWHERE, query)).toEqual(mine);
  });

  it('CONTROL a missing id is 404 RECORD_NOT_FOUND', async () => {
    const res = await byId(NOWHERE, {});
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.code).toBe('RECORD_NOT_FOUND');
  });

  it('CONTROL a row the caller may not read is the missing id\'s 404 — the same answer, but for the id', async () => {
    const hidden = await byId(HIDDEN, {});
    const missing = await byId(NOWHERE, {});
    expect(hidden.status, JSON.stringify(hidden.body)).toBe(404);
    expect(hidden.body.code).toBe('RECORD_NOT_FOUND');
    expect(JSON.stringify(hidden).split(HIDDEN).join('ID')).toBe(JSON.stringify(missing).split(NOWHERE).join('ID'));
    // …and a well-formed projection does not tell them apart either.
    const hiddenProjected = await byId(HIDDEN, { select: 'title' });
    expect(hiddenProjected.status, JSON.stringify(hiddenProjected.body)).toBe(404);
    expect(hiddenProjected.body.code).toBe('RECORD_NOT_FOUND');
  });

  it('CONTROL the caller\'s own record is served, projected or whole', async () => {
    const projected = await byId(MINE, { select: 'title' });
    expect(projected.status, JSON.stringify(projected.body)).toBe(200);
    expect(projected.body.record.title).toBe('mine');
    expect('owner' in projected.body.record).toBe(false);

    const whole = await byId(MINE, {});
    expect(whole.status, JSON.stringify(whole.body)).toBe(200);
    expect(whole.body.record.owner).toBe(ME);
  });
});
