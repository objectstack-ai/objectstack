// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32250, ADR-0150 D5] Every `/data` write door that can surface a
 * package-scoped refusal names its candidates: `details.candidates`, in the
 * shape the `/actions`, `/automation` and activation doors answer
 * (`[{ kind: 'package', packageId }, …]`).
 *
 * The refusal is what a write hook throws when a by-name value means more than
 * one item here: core's `PackageScopedNameRefusedError`, the class the
 * `sys_user_permission_set` grant hook throws when two packages ship a set of
 * the name the operator typed. Without the candidates the operator is told
 * "ambiguous" and cannot see which packages to choose between.
 *
 * Measured over the real `RestServer` routes, the real protocol, `ObjectQL` and
 * `SqlDriver`, with a hook throwing (a) the class and (b) a plain error of the
 * same shape (an error that crossed a second copy of `@objectstack/core`).
 *
 * - Whole-request doors (single create, update and delete; `createMany`):
 *   `409 RESOURCE_CONFLICT`, `error`, `code` and `object` as before, plus
 *   `details.candidates`.
 * - Per-row doors (`updateMany`, `deleteMany`, `/:object/batch` create, update,
 *   upsert and delete, atomic or not): the `207` report's row error
 *   (`results[i].errors[0]`) as before, plus `details.candidates`.
 *
 * CONTROLS, unchanged byte for byte: the unique-violation `409` on every
 * whole-request door and as a row error, the stale-version `409
 * CONCURRENT_UPDATE`, and a `409 RESOURCE_CONFLICT` thrown with no refusal.
 *
 * Not measured here: the cross-object `POST /batch` (this harness has no
 * transactional batch and answers `501`); a throw there leaves through the
 * same exit as `createMany`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { PackageScopedNameRefusedError, packageScopedRefusalMessage } from '@objectstack/core';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'rest_scoped_refusal_32250';
const P = '/api/v1/data/:object';

const CANDIDATES = [
  { kind: 'package' as const, packageId: 'com.acme.crm' },
  { kind: 'package' as const, packageId: 'com.acme.sales' },
];
const BASE = {
  status: 'refused' as const,
  reason: 'ambiguous-in-environment' as const,
  type: 'permission' as const,
  name: 'sales_rep',
  callerPackageId: null,
  candidates: CANDIDATES,
};
const REFUSAL = { ...BASE, message: packageScopedRefusalMessage(BASE) };
const SENTENCE = REFUSAL.message;

type Throw = 'class' | 'shape' | 'bare-conflict' | 'none';
let throwing: Throw = 'none';

/** What the hooks throw for a record whose `title` (or id) asks for a refusal. */
function refusal(): Error {
  if (throwing === 'class') return new PackageScopedNameRefusedError(REFUSAL);
  if (throwing === 'shape') {
    return Object.assign(new Error(SENTENCE), { code: 'RESOURCE_CONFLICT', status: 409, refusal: REFUSAL });
  }
  return Object.assign(new Error('The record is in conflict.'), { code: 'RESOURCE_CONFLICT', status: 409 });
}

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const res: any = {
    write: () => true, end: () => {},
    header: () => res, setHeader: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

describe('[#32250] /data names the candidates of a package-scoped refusal — sqlite', () => {
  let engine: ObjectQL;
  let routes: any[];

  const call = async (method: string, path: string, params: Record<string, string>, body?: unknown, query: Record<string, string> = {}) => {
    const route = routes.find((r: any) => r.method === method && r.path === path);
    expect(route, `${method} ${path}`).toBeDefined();
    const res = makeRes();
    await route.handler({ params: { object: OBJECT, ...params }, body, query, headers: {} } as any, res);
    return { status: res._status ?? 200, body: res._json };
  };

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
    engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: OBJECT,
      label: 'Scoped refusal 32250',
      fields: {
        title: { name: 'title', type: 'text' as const },
        code: { name: 'code', type: 'text' as const, unique: true },
      },
    } as any);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);
    await engine.insert(OBJECT, { id: 'r1', title: 'a', code: 'K1' } as any);
    await engine.insert(OBJECT, { id: 'r2', title: 'b', code: 'K2' } as any);

    for (const event of ['beforeInsert', 'beforeUpdate'] as const) {
      engine.registerHook(event, async (ctx: any) => {
        if (throwing !== 'none' && ctx?.input?.data?.title === 'refuse') throw refusal();
      }, { object: OBJECT });
    }
    engine.registerHook('beforeDelete', async (ctx: any) => {
      if (throwing !== 'none' && ctx?.input?.id === 'r2') throw refusal();
    }, { object: OBJECT });

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    routes = rest.getRoutes();
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  const WHOLE_REQUEST: ReadonlyArray<[string, string, string, Record<string, string>, unknown]> = [
    ['create', 'POST', P, {}, { title: 'refuse' }],
    ['update', 'PATCH', `${P}/:id`, { id: 'r1' }, { title: 'refuse' }],
    ['delete', 'DELETE', `${P}/:id`, { id: 'r2' }, undefined],
    ['createMany', 'POST', `${P}/createMany`, {}, [{ title: 'refuse' }]],
  ];

  const PER_ROW: ReadonlyArray<[string, string, unknown, string | undefined]> = [
    ['updateMany', `${P}/updateMany`, { records: [{ id: 'r1', data: { title: 'refuse' } }] }, 'r1'],
    ['deleteMany', `${P}/deleteMany`, { ids: ['r2'] }, 'r2'],
    ['batch create', `${P}/batch`, { operation: 'create', records: [{ data: { title: 'refuse' } }] }, undefined],
    ['batch update', `${P}/batch`, { operation: 'update', records: [{ id: 'r1', data: { title: 'refuse' } }] }, 'r1'],
    ['batch upsert', `${P}/batch`, { operation: 'upsert', records: [{ id: 'r9', data: { title: 'refuse' } }] }, 'r9'],
    ['batch upsert, atomic', `${P}/batch`, { operation: 'upsert', records: [{ id: 'r9', data: { title: 'refuse' } }], options: { atomic: true } }, 'r9'],
    ['batch delete', `${P}/batch`, { operation: 'delete', records: [{ id: 'r2' }] }, 'r2'],
  ];

  for (const thrown of ['class', 'shape'] as const) {
    describe(`a hook throwing the refusal as ${thrown === 'class' ? 'the class' : 'a plain object of its shape'}`, () => {
      for (const [name, method, path, params, body] of WHOLE_REQUEST) {
        it(`${name}: 409 RESOURCE_CONFLICT names the candidates`, async () => {
          throwing = thrown;
          const answer = await call(method, path, params, body);
          expect(answer.status, JSON.stringify(answer.body)).toBe(409);
          expect(answer.body).toEqual({
            error: SENTENCE,
            code: 'RESOURCE_CONFLICT',
            object: OBJECT,
            details: { candidates: CANDIDATES },
          });
        });
      }

      for (const [name, path, body, id] of PER_ROW) {
        it(`${name}: the row's error names the candidates`, async () => {
          throwing = thrown;
          const answer = await call('POST', path, {}, body);
          expect(answer.status, JSON.stringify(answer.body)).toBe(207);
          expect(answer.body.results).toEqual([{
            ...(id !== undefined ? { id } : {}),
            success: false,
            index: 0,
            errors: [{ code: 'RESOURCE_CONFLICT', message: SENTENCE, httpStatus: 409, details: { candidates: CANDIDATES } }],
          }]);
        });
      }
    });
  }

  describe('CONTROL: every other /data 409 answers as before', () => {
    const UNIQUE = {
      error: 'A record with this value already exists',
      code: 'UNIQUE_VIOLATION',
      developerMessage: "Duplicate record refused on 'Scoped refusal 32250': a unique constraint already holds these values. No record was written.",
      object: OBJECT,
    };
    const UNIQUE_ROW = {
      code: 'UNIQUE_VIOLATION',
      message: "Duplicate record refused on 'Scoped refusal 32250': a unique constraint already holds these values. No record was written.",
      httpStatus: 409,
    };

    it('unique violation on create, update and createMany', async () => {
      throwing = 'none';
      for (const [method, path, params, body] of [
        ['POST', P, {}, { title: 'x', code: 'K1' }],
        ['PATCH', `${P}/:id`, { id: 'r2' }, { code: 'K1' }],
        ['POST', `${P}/createMany`, {}, [{ title: 'x', code: 'K1' }]],
      ] as const) {
        const answer = await call(method, path, params, body);
        expect(answer.status, `${method} ${path}`).toBe(409);
        expect(answer.body, `${method} ${path}`).toEqual(UNIQUE);
      }
    });

    it('unique violation as a row error of updateMany and a batch upsert', async () => {
      throwing = 'none';
      const many = await call('POST', `${P}/updateMany`, {}, { records: [{ id: 'r2', data: { code: 'K1' } }] });
      expect(many.status).toBe(207);
      expect(many.body.results[0].errors).toEqual([UNIQUE_ROW]);
      const upsert = await call('POST', `${P}/batch`, {}, { operation: 'upsert', records: [{ id: 'r7', data: { code: 'K1' } }] });
      expect(upsert.status).toBe(207);
      expect(upsert.body.results[0].errors).toEqual([UNIQUE_ROW]);
    });

    it('a stale version on update: 409 CONCURRENT_UPDATE, no details', async () => {
      throwing = 'none';
      const answer = await call('PATCH', `${P}/:id`, { id: 'r2' }, { title: 'q', expectedVersion: '1999-01-01T00:00:00.000Z' });
      expect(answer.status).toBe(409);
      expect(answer.body.code).toBe('CONCURRENT_UPDATE');
      expect(Object.keys(answer.body).sort()).toEqual(['code', 'currentRecord', 'currentVersion', 'error', 'object']);
    });

    it('a RESOURCE_CONFLICT thrown with no refusal: create and createMany, and as a row error', async () => {
      throwing = 'bare-conflict';
      for (const [method, path, params, body] of [
        ['POST', P, {}, { title: 'refuse' }],
        ['POST', `${P}/createMany`, {}, [{ title: 'refuse' }]],
      ] as const) {
        const answer = await call(method, path, params, body);
        expect(answer.status, `${method} ${path}`).toBe(409);
        expect(answer.body, `${method} ${path}`).toEqual({ error: 'The record is in conflict.', code: 'RESOURCE_CONFLICT', object: OBJECT });
      }
      const row = await call('POST', `${P}/updateMany`, {}, { records: [{ id: 'r1', data: { title: 'refuse' } }] });
      expect(row.body.results[0].errors).toEqual([{ code: 'RESOURCE_CONFLICT', message: 'The record is in conflict.', httpStatus: 409 }]);
    });
  });
});
