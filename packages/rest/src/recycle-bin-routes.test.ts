// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// [#30237 PR 5, ADR-0148] The recycle bin's REST doors under `{data}/:object/recycle-bin`.

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

function mockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
}
function mockProtocol() {
  return { getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }), getMetaTypes: vi.fn().mockResolvedValue([]), getMetaItems: vi.fn().mockResolvedValue([]) };
}
function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: any) => { res.body = b; return res; });
  res.end = vi.fn(() => res);
  return res;
}

const CALLER = { userId: 'u_admin', tenantId: 'org_1' };

const ENTRY = {
  id: 'e1',
  object: 'account',
  recordId: 'a1',
  recordCount: 2,
  snapshot: {
    rows: [
      { object: 'account', id: 'a1', values: { id: 'a1', name: 'Acme', revenue: 900, ssn: '123-45-6789' } },
      { object: 'contact', id: 'c1', values: { id: 'c1', name: 'Ann', phone: '555' } },
    ],
    clearedReferences: [{ object: 'deal', id: 'd1', field: 'account', value: 'a1' }],
  },
  deletedBy: 'u_bob',
  deletedAt: '2026-11-03T00:00:00.000Z',
  retentionDays: 30,
  purgeAfter: '2026-12-03T00:00:00.000Z',
};

/** The slice of the engine the doors call. */
function mockEngine() {
  return {
    listRecycleBin: vi.fn(async (object: string) => ({ object, entries: [ENTRY], hasMore: true })),
    restore: vi.fn(async (entryId: string, opts: any) => ({
      entryId, object: opts.object, recordId: 'a1', rows: [{ object: 'account', id: 'a1' }], relinked: 0,
    })),
    purge: vi.fn(async () => true),
    empty: vi.fn(async () => 3),
    getSchema: vi.fn((object: string) => (object === 'account'
      ? { fields: { name: {}, revenue: {}, ssn: { maskingRule: { type: 'partial' } } } }
      : { fields: { name: {}, phone: {} } })),
  };
}

function buildServer(engine: any, opts: { caller?: any; security?: any; objects?: Record<string, any> } = {}) {
  const rest = new RestServer(
    mockServer() as any, mockProtocol() as any, { api: { requireAuth: false } } as any,
    undefined, undefined, undefined, undefined,
    engine === undefined ? undefined : async () => engine,
  );
  vi.spyOn(rest as any, 'resolveExecCtx').mockResolvedValue(opts.caller === undefined ? CALLER : opts.caller);
  vi.spyOn(rest as any, 'resolveSecurityService').mockResolvedValue(opts.security);
  vi.spyOn(rest as any, 'loadObjectItem').mockImplementation(async (...a: any[]) => opts.objects?.[a[2]]);
  rest.registerRoutes();
  const routes = rest.getRoutes();
  const find = (method: string, path: string) => routes.find((r) => r.method === method && r.path === path)!;
  return {
    routes,
    list: find('GET', '/api/v1/data/:object/recycle-bin'),
    empty: find('DELETE', '/api/v1/data/:object/recycle-bin'),
    restore: find('POST', '/api/v1/data/:object/recycle-bin/:entryId/restore'),
    purge: find('DELETE', '/api/v1/data/:object/recycle-bin/:entryId'),
  };
}

const call = async (route: any, req: { params: any; query?: any }) => {
  const res = mockRes();
  await route.handler({ headers: {}, query: {}, ...req } as any, res);
  return res;
};

describe('[#30237] the recycle-bin doors are mounted before the greedy CRUD routes', () => {
  it('registers GET / DELETE {data}/:object/recycle-bin ahead of GET / DELETE {data}/:object/:id', () => {
    const { routes } = buildServer(mockEngine());
    const at = (method: string, path: string) => routes.findIndex((r) => r.method === method && r.path === path);
    expect(at('GET', '/api/v1/data/:object/recycle-bin')).toBeGreaterThanOrEqual(0);
    expect(at('GET', '/api/v1/data/:object/recycle-bin')).toBeLessThan(at('GET', '/api/v1/data/:object/:id'));
    expect(at('DELETE', '/api/v1/data/:object/recycle-bin')).toBeLessThan(at('DELETE', '/api/v1/data/:object/:id'));
  });
});

describe('[#30237] GET {data}/:object/recycle-bin', () => {
  it("lists the object's entries as the caller, with each row's values cut to the fields it may query on", async () => {
    const engine = mockEngine();
    const security = {
      getQueryableFields: vi.fn(async (object: string) => (object === 'account' ? ['id', 'name'] : ['id', 'name', 'phone'])),
    };
    const { list } = buildServer(engine, { security });
    const res = await call(list, { params: { object: 'account' }, query: { limit: '10', offset: '20' } });

    expect(res.statusCode).toBe(200);
    expect(engine.listRecycleBin).toHaveBeenCalledWith('account', { context: CALLER, limit: 10, offset: 20 });
    expect(res.body).toEqual({
      success: true,
      data: {
        object: 'account',
        hasMore: true,
        entries: [{
          id: 'e1',
          object: 'account',
          recordId: 'a1',
          recordCount: 2,
          deletedBy: 'u_bob',
          deletedAt: '2026-11-03T00:00:00.000Z',
          retentionDays: 30,
          purgeAfter: '2026-12-03T00:00:00.000Z',
          rows: [
            { object: 'account', id: 'a1', values: { id: 'a1', name: 'Acme' } },
            { object: 'contact', id: 'c1', values: { id: 'c1', name: 'Ann', phone: '555' } },
          ],
        }],
      },
    });
    expect(security.getQueryableFields).toHaveBeenCalledTimes(2);
  });

  it("with only a read projection, withholds every field that declares a maskingRule", async () => {
    const engine = mockEngine();
    const security = { getReadableFields: vi.fn(async () => ['id', 'name', 'revenue', 'ssn', 'phone']) };
    const { list } = buildServer(engine, { security });
    const res = await call(list, { params: { object: 'account' } });
    expect(res.body.data.entries[0].rows[0].values).toEqual({ id: 'a1', name: 'Acme', revenue: 900 });
  });

  it('keeps only the id of a row whose object the security service gives no answer for', async () => {
    const engine = mockEngine();
    const security = { getQueryableFields: vi.fn(async (object: string) => (object === 'account' ? undefined : ['id', 'name'])) };
    const { list } = buildServer(engine, { security });
    const res = await call(list, { params: { object: 'account' } });
    expect(res.body.data.entries[0].rows).toEqual([
      { object: 'account', id: 'a1', values: { id: 'a1' } },
      { object: 'contact', id: 'c1', values: { id: 'c1', name: 'Ann' } },
    ]);
  });

  it('serves the values as the engine answered them where no security service is registered', async () => {
    const { list } = buildServer(mockEngine());
    const res = await call(list, { params: { object: 'account' } });
    expect(res.body.data.entries[0].rows[0].values).toEqual({ id: 'a1', name: 'Acme', revenue: 900, ssn: '123-45-6789' });
  });

  it('does not serve the references the delete cleared', async () => {
    const { list } = buildServer(mockEngine());
    const res = await call(list, { params: { object: 'account' } });
    expect(res.body.data.entries[0]).not.toHaveProperty('clearedReferences');
    expect(res.body.data.entries[0]).not.toHaveProperty('snapshot');
  });

  it.each([
    [{ object: 'account' }, 'an unknown parameter'],
    [{ limit: ['1', '2'] }, 'a repeated parameter'],
  ])('refuses %j (%s), 400, and lists nothing', async (query) => {
    const engine = mockEngine();
    const { list } = buildServer(engine);
    const res = await call(list, { params: { object: 'account' }, query });
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(engine.listRecycleBin).not.toHaveBeenCalled();
  });

  it.each([
    [{ limit: 'ten' }, 'limit', 'a limit that is not a number'],
    [{ limit: '1.5' }, 'limit', 'a limit that is not whole'],
    [{ limit: '0' }, 'limit', 'a limit under 1'],
    [{ limit: '201' }, 'limit', 'a limit over 200'],
    [{ limit: '' }, 'limit', 'an empty limit'],
    [{ offset: '-1' }, 'offset', 'a negative offset'],
  ])('refuses %j through its declaration (%s), 400 naming the parameter, and lists nothing', async (query, param) => {
    const engine = mockEngine();
    const { list } = buildServer(engine);
    const res = await call(list, { params: { object: 'account' }, query });
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(res.body.error)).toContain(`"field":"${param}"`);
    expect(engine.listRecycleBin).not.toHaveBeenCalled();
  });

  it("answers the engine's 403 for a caller that does not manage the object's bin", async () => {
    const engine = mockEngine();
    engine.listRecycleBin.mockRejectedValueOnce(Object.assign(new Error('Listing the recycle bin of this object needs the recycle-bin manager permission on it.'), {
      code: 'PERMISSION_DENIED', status: 403, httpStatus: 403, object: 'account',
    }));
    const { list } = buildServer(engine);
    const res = await call(list, { params: { object: 'account' } });
    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatchObject({ code: 'PERMISSION_DENIED', details: { object: 'account' } });
  });

  it('an anonymous caller is refused before anything is listed', async () => {
    const engine = mockEngine();
    const { list } = buildServer(engine, { caller: null });
    const res = await call(list, { params: { object: 'account' } });
    expect(res.statusCode).toBe(401);
    expect(engine.listRecycleBin).not.toHaveBeenCalled();
  });

  it('answers 405 for an object whose API exposes no operation, and lists nothing', async () => {
    const engine = mockEngine();
    const { list } = buildServer(engine, { objects: { account: { name: 'account', enable: { apiMethods: [] } } } });
    const res = await call(list, { params: { object: 'account' } });
    expect(res.statusCode).toBe(405);
    expect(engine.listRecycleBin).not.toHaveBeenCalled();
  });

  it('answers 501 when the engine has no recycle bin', async () => {
    const { list } = buildServer({ find: vi.fn() });
    const res = await call(list, { params: { object: 'account' } });
    expect(res.statusCode).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
  });
});

describe('[#30237] DELETE {data}/:object/recycle-bin (empty)', () => {
  it('empties the object as the caller and answers how many entries went', async () => {
    const engine = mockEngine();
    const { empty } = buildServer(engine);
    const res = await call(empty, { params: { object: 'account' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: { object: 'account', removed: 3 } });
    expect(engine.empty).toHaveBeenCalledWith('account', { context: CALLER });
  });

  it('refuses any query parameter, 400, and empties nothing', async () => {
    const engine = mockEngine();
    const { empty } = buildServer(engine);
    const res = await call(empty, { params: { object: 'account' }, query: { all: 'true' } });
    expect(res.statusCode).toBe(400);
    expect(engine.empty).not.toHaveBeenCalled();
  });

  it("answers the security layer's 403 refusal of the `purge` verb at its own status", async () => {
    const engine = mockEngine();
    engine.empty.mockRejectedValueOnce(Object.assign(new Error("[Security] Access denied: purge on 'account'"), { code: 'PERMISSION_DENIED', status: 403 }));
    const { empty } = buildServer(engine);
    const res = await call(empty, { params: { object: 'account' } });
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
  });
});

describe('[#30237] POST {data}/:object/recycle-bin/:entryId/restore', () => {
  it('restores the entry under the addressed object, as the caller, and answers what came back', async () => {
    const engine = mockEngine();
    const { restore } = buildServer(engine);
    const res = await call(restore, { params: { object: 'account', entryId: 'e1' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { entryId: 'e1', object: 'account', recordId: 'a1', rows: [{ object: 'account', id: 'a1' }], relinked: 0 },
    });
    expect(engine.restore).toHaveBeenCalledWith('e1', { context: CALLER, object: 'account' });
  });

  it('answers a receipt, never a record body: a member the report carries beyond its five is not served (#8497)', async () => {
    const engine = mockEngine();
    engine.restore.mockResolvedValueOnce({
      entryId: 'e1', object: 'account', recordId: 'a1', relinked: 0,
      rows: [{ object: 'account', id: 'a1', values: { ssn: '123-45-6789' } }],
      record: { id: 'a1', ssn: '123-45-6789' },
    } as any);
    const { restore } = buildServer(engine);
    const res = await call(restore, { params: { object: 'account', entryId: 'e1' } });
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({ entryId: 'e1', object: 'account', recordId: 'a1', rows: [{ object: 'account', id: 'a1' }], relinked: 0 });
    expect(JSON.stringify(res.body)).not.toContain('123-45-6789');
  });

  it('answers 404 when no entry of that object is visible to the caller', async () => {
    const engine = mockEngine();
    engine.restore.mockResolvedValueOnce(null as any);
    const { restore } = buildServer(engine);
    const res = await call(restore, { params: { object: 'account', entryId: 'nope' } });
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'RECORD_NOT_FOUND', details: { object: 'account', entryId: 'nope' } });
  });

  it('answers a 409 refusal with its code and the entry it names, so the caller can restore the parent first', async () => {
    const engine = mockEngine();
    engine.restore.mockRejectedValueOnce(Object.assign(new Error("The parent of this record is in the recycle bin: restore it first."), {
      code: 'RESTORE_PARENT_IN_RECYCLE_BIN', status: 409, httpStatus: 409,
      entryId: 'e1', object: 'contact', recordId: 'c1', field: 'account', parentObject: 'account', parentId: 'a0', parentEntryId: 'e0',
    }));
    const { restore } = buildServer(engine);
    const res = await call(restore, { params: { object: 'contact', entryId: 'e1' } });
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'RESTORE_PARENT_IN_RECYCLE_BIN',
      details: { entryId: 'e1', object: 'contact', recordId: 'c1', field: 'account', parentObject: 'account', parentId: 'a0', parentEntryId: 'e0' },
    });
  });

  it("answers the engine's 403 for another member's entry", async () => {
    const engine = mockEngine();
    engine.restore.mockRejectedValueOnce(Object.assign(new Error('You can restore only the records you deleted.'), {
      code: 'PERMISSION_DENIED', status: 403, httpStatus: 403, object: 'account', entryId: 'e1',
    }));
    const { restore } = buildServer(engine);
    const res = await call(restore, { params: { object: 'account', entryId: 'e1' } });
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
  });

  it("answers the restore's own success when only a roll-up could not recompute after it", async () => {
    const engine = mockEngine();
    const written = { entryId: 'e1', object: 'account', recordId: 'a1', rows: [{ object: 'account', id: 'a1' }], relinked: 0 };
    engine.restore.mockRejectedValueOnce(Object.assign(new Error('Roll-up summary recompute failed'), {
      code: 'ERR_SUMMARY_RECOMPUTE', failures: [{ parentObject: 'account', field: 'total', childObject: 'contact' }], written,
    }));
    const { restore } = buildServer(engine);
    const res = await call(restore, { params: { object: 'account', entryId: 'e1' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: written });
  });

  it('answers an unexpected fault as 500 without its message', async () => {
    const engine = mockEngine();
    engine.restore.mockRejectedValueOnce(new Error('driver exploded: SELECT * FROM secret'));
    const { restore } = buildServer(engine);
    const res = await call(restore, { params: { object: 'account', entryId: 'e1' } });
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
});

describe('[#30237] DELETE {data}/:object/recycle-bin/:entryId (purge)', () => {
  it('purges the entry under the addressed object, as the caller', async () => {
    const engine = mockEngine();
    const { purge } = buildServer(engine);
    const res = await call(purge, { params: { object: 'account', entryId: 'e1' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: { object: 'account', entryId: 'e1', purged: true } });
    expect(engine.purge).toHaveBeenCalledWith('e1', { context: CALLER, object: 'account' });
  });

  it('answers 404 when no entry of that object is visible to the caller', async () => {
    const engine = mockEngine();
    engine.purge.mockResolvedValueOnce(false);
    const { purge } = buildServer(engine);
    const res = await call(purge, { params: { object: 'account', entryId: 'e9' } });
    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe('RECORD_NOT_FOUND');
  });

  it('refuses any query parameter, 400, and purges nothing', async () => {
    const engine = mockEngine();
    const { purge } = buildServer(engine);
    const res = await call(purge, { params: { object: 'account', entryId: 'e1' }, query: { permanent: 'true' } });
    expect(res.statusCode).toBe(400);
    expect(engine.purge).not.toHaveBeenCalled();
  });
});

describe('[#30237] the doors follow the object\'s API exposure: restore / purge derive from `delete`', () => {
  const EXPOSES_DELETE = { account: { name: 'account', enable: { apiMethods: ['get', 'list', 'delete'] } } };
  const WITHHOLDS_DELETE = { account: { name: 'account', enable: { apiMethods: ['get', 'list', 'update'] } } };

  it('serves every door of an object whose API exposes `delete`', async () => {
    const engine = mockEngine();
    const doors = buildServer(engine, { objects: EXPOSES_DELETE });
    expect((await call(doors.list, { params: { object: 'account' } })).statusCode).toBe(200);
    expect((await call(doors.restore, { params: { object: 'account', entryId: 'e1' } })).statusCode).toBe(200);
    expect((await call(doors.purge, { params: { object: 'account', entryId: 'e1' } })).statusCode).toBe(200);
    expect((await call(doors.empty, { params: { object: 'account' } })).statusCode).toBe(200);
  });

  it('answers 405 at every door of an object whose API withholds `delete`, and calls no engine verb', async () => {
    const engine = mockEngine();
    const doors = buildServer(engine, { objects: WITHHOLDS_DELETE });
    for (const [door, params] of [
      [doors.list, { object: 'account' }],
      [doors.restore, { object: 'account', entryId: 'e1' }],
      [doors.purge, { object: 'account', entryId: 'e1' }],
      [doors.empty, { object: 'account' }],
    ] as const) {
      expect((await call(door, { params })).statusCode).toBe(405);
    }
    expect(engine.listRecycleBin).not.toHaveBeenCalled();
    expect(engine.restore).not.toHaveBeenCalled();
    expect(engine.purge).not.toHaveBeenCalled();
    expect(engine.empty).not.toHaveBeenCalled();
  });
});
