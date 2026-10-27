// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26672] A file field's read verdict does not depend on whether the caller's
 * projection lists `id`.
 *
 * ## The defect
 *
 * A reader refused `sys_file` read (every member whose application grants no
 * `sys_file` read) is served a file field by the parent-derived verdict of
 * #22637: a file whose `ref_object` / `ref_id` name the record being read
 * hydrates when the download door's field-owned verdict allows this reader.
 * That verdict is judged per RECORD, by the record's `id`. A projection that
 * left `id` out (`GET /data/:object?select=attachment`) handed the hydration
 * rows with no `id`, so no file could be matched to its owner and every one
 * answered `{ id, metadataRefused: true }` — while `select=id,attachment`
 * answered the full `{ id, name, size, mimeType, url }` to the same reader.
 *
 * ## What is pinned, on the composed REST harness
 *
 * `RestServer` → `ObjectStackProtocolImplementation` → `ObjectQL` → a real
 * `SqlDriver` on better-sqlite3, through the three read doors that reach the
 * hydration: `GET /data/:object` (`select`), `POST /data/:object/query`
 * (`fields`) and `GET /data/:object/:id` (`select`, the `findOne` door).
 *
 *   - The permitted reader gets the full value with or without `id`, and no
 *     `id` key the caller did not name.
 *   - CONTROL the same projection with `id` answers as it did.
 *   - CONTROL a reader the field-owned verdict refuses is still refused, with
 *     or without `id`: nothing an unauthorised caller sees is widened.
 *
 * ## The stand-ins, and only these
 *
 *   - The security layer's `sys_file` refusal: an engine middleware that
 *     throws `PERMISSION_DENIED` for every non-system `sys_file` read, the
 *     shape plugin-security's `file-field-hydration-refused.test.ts` measures
 *     on the real `SecurityPlugin`.
 *   - The field-owned verdict the storage plugin hands the engine: one that
 *     allows the reader and nobody else. The real verdict's agreement with the
 *     download door is pinned in service-storage's
 *     `field-owned-file-hydration-door-agreement.test.ts`.
 *
 * `@objectstack/objectql` resolves through its `exports` to `dist/` here, so
 * an ablation of the engine is observed only after a rebuild of that package.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'rq_filed_doc';
const SYS = { isSystem: true };
const READER = 'u_reader';
const STRANGER = 'u_stranger';
const FILE_ID = 'f_26672_owned';

const hydrated = {
  id: FILE_ID, name: 'contract.pdf', size: 2048, mimeType: 'application/pdf', url: `/api/v1/storage/files/${FILE_ID}`,
};
const refused = { id: FILE_ID, metadataRefused: true };

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

const refusal = () =>
  Object.assign(new Error('You do not have permission to perform this action.'), {
    name: 'PermissionDeniedError', code: 'PERMISSION_DENIED', status: 403, statusCode: 403,
  });

const rowsOf = (res: any): Array<Record<string, unknown>> => res._json?.records ?? res._json?.data ?? res._json;
const recordOf = (res: any): Record<string, unknown> => res._json?.record ?? res._json;

describe('[#26672] a file field reads the same with or without `id` in the projection', () => {
  let engine: ObjectQL;
  let caller = READER;
  let list: (query: Record<string, unknown>) => Promise<any>;
  let query: (body: Record<string, unknown>) => Promise<any>;
  let getById: (id: string, query: Record<string, unknown>) => Promise<any>;

  beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(
      new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as any,
      true,
    );
    await engine.init();
    engine.registry.registerObject({
      name: OBJECT,
      label: 'Filed doc',
      fields: {
        title: { name: 'title', type: 'text' },
        attachment: { name: 'attachment', type: 'file' },
      },
    } as any);
    // The storage service's `sys_file`, as far as the hydration reads it.
    engine.registry.registerObject({
      name: 'sys_file',
      label: 'System File',
      fields: {
        key: { name: 'key', type: 'text' },
        name: { name: 'name', type: 'text' },
        mime_type: { name: 'mime_type', type: 'text' },
        size: { name: 'size', type: 'number' },
        status: { name: 'status', type: 'text' },
        ref_object: { name: 'ref_object', type: 'text' },
        ref_id: { name: 'ref_id', type: 'text' },
        ref_field: { name: 'ref_field', type: 'text' },
      },
    } as any);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);

    await engine.insert('sys_file', {
      id: FILE_ID, key: `files/${FILE_ID}.pdf`, name: 'contract.pdf', mime_type: 'application/pdf', size: 2048,
      status: 'committed', ref_object: OBJECT, ref_id: 'd1', ref_field: 'attachment',
    } as any, { context: SYS } as any);
    await engine.insert(OBJECT, { id: 'd1', title: 'Signed', attachment: FILE_ID } as any, { context: SYS } as any);

    engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
      if (!opCtx.context?.isSystem) throw refusal();
      return next();
    }, { object: 'sys_file' });
    engine.registerFieldOwnedFileReadAuthorizer(async (_object, ownerIds, context) =>
      new Set(context?.userId === READER ? ownerIds : []));

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: caller });
    rest.registerRoutes();
    const routes = rest.getRoutes();
    const route = (method: string, path: string) => {
      const found = routes.find((r: any) => r.method === method && r.path === path);
      expect(found).toBeDefined();
      return found!;
    };
    const listRoute = route('GET', '/api/v1/data/:object');
    const queryRoute = route('POST', '/api/v1/data/:object/query');
    const getRoute = route('GET', '/api/v1/data/:object/:id');
    list = async (q) => {
      const res = makeRes();
      await listRoute.handler({ params: { object: OBJECT }, query: q } as any, res);
      return res;
    };
    query = async (body) => {
      const res = makeRes();
      await queryRoute.handler({ params: { object: OBJECT }, body } as any, res);
      return res;
    };
    getById = async (id, q) => {
      const res = makeRes();
      await getRoute.handler({ params: { object: OBJECT, id }, query: q } as any, res);
      return res;
    };
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  const as = (user: string) => { caller = user; };

  it('the refusal it starts from: the reader may not read sys_file directly', async () => {
    const direct = await engine.find('sys_file', { context: { userId: READER } }).then(() => null, (e: any) => e);
    expect({ code: direct?.code, status: direct?.statusCode ?? direct?.status }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
  });

  it('GET /data/:object?select=<file field>: a permitted reader gets the full value, and no `id` it did not name', async () => {
    as(READER);
    const res = await list({ select: 'attachment' });
    expect(res._status ?? 200).toBe(200);
    expect(rowsOf(res)).toEqual([{ attachment: hydrated }]);
  });

  it('POST /data/:object/query with fields: [<file field>]: the same', async () => {
    as(READER);
    const res = await query({ fields: ['attachment'] });
    expect(res._status ?? 200).toBe(200);
    expect(rowsOf(res)).toEqual([{ attachment: hydrated }]);
  });

  it('GET /data/:object/:id?select=<file field> (the findOne door): the same', async () => {
    as(READER);
    const res = await getById('d1', { select: 'attachment' });
    expect(res._status ?? 200).toBe(200);
    const record = recordOf(res);
    expect(record.attachment).toEqual(hydrated);
    expect(record).not.toHaveProperty('id');
  });

  it('CONTROL select=id,<file field> answers as it did', async () => {
    as(READER);
    expect(rowsOf(await list({ select: 'id,attachment' }))).toEqual([{ id: 'd1', attachment: hydrated }]);
    expect(rowsOf(await query({ fields: ['id', 'attachment'] }))).toEqual([{ id: 'd1', attachment: hydrated }]);
    expect(recordOf(await getById('d1', { select: 'id,attachment' }))).toMatchObject({ id: 'd1', attachment: hydrated });
  });

  it('CONTROL a reader the field-owned verdict refuses is still refused, with or without `id`', async () => {
    as(STRANGER);
    expect(rowsOf(await list({ select: 'attachment' }))).toEqual([{ attachment: refused }]);
    expect(rowsOf(await list({ select: 'id,attachment' }))).toEqual([{ id: 'd1', attachment: refused }]);
    expect(rowsOf(await query({ fields: ['attachment'] }))).toEqual([{ attachment: refused }]);
    expect(rowsOf(await query({ fields: ['id', 'attachment'] }))).toEqual([{ id: 'd1', attachment: refused }]);
    const byId = recordOf(await getById('d1', { select: 'attachment' }));
    expect(byId.attachment).toEqual(refused);
    expect(byId).not.toHaveProperty('id');
    expect(recordOf(await getById('d1', { select: 'id,attachment' })).attachment).toEqual(refused);
  });
});
