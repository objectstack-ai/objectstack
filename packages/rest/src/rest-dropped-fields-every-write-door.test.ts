// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `X-ObjectStack-Dropped-Fields` (#3431) on every 2xx REST write answer whose
 * body carries `droppedFields`, through the one seam `applyDroppedFieldsHeader`.
 *
 * Single `POST /data/:object` and `PATCH /data/:object/:id` sent the header.
 * These doors put the same strip in the body and sent no header, so a caller
 * reading the header was told nothing:
 *
 * | door | the body's report | header |
 * |:--|:--|:--|
 * | `POST /data/:object/:id/clone` | top-level `droppedFields` | the clone's own events |
 * | `POST /data/:object/createMany` | top-level `droppedFields` (already the rows' union) | that union |
 * | `POST /data/:object/batch` | `results[i].droppedFields` | the union of the rows' events |
 * | `POST /data/:object/updateMany` | `results[i].droppedFields` | the union of the rows' events |
 * | `POST /data/:object/import` (commit) | `results[i].droppedFields` | the union of the rows' events |
 * | `POST /batch` (cross-object) | top-level `droppedFields`, one per op with its `index` | the union |
 *
 * The header has one `field;reason=REASON` token per stripped field, so it
 * cannot say which row (or op, or object) dropped what: a bulk door's header
 * names the union, each token once, and the body keeps the per-row report.
 * An import DRY RUN writes nothing, so it is not a write answer and sends no
 * header, though its rows preview the strip. Bodies are unchanged.
 *
 * Harness: `RestServer` → `ObjectStackProtocolImplementation` → a real
 * `ObjectQL` over better-sqlite3 `:memory:`, the route handlers called with a
 * response double that records headers. The stale-roll-up answer (#28782) of
 * clone and createMany is read through a protocol double, at the end.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysImportJob } from '@objectstack/platform-objects/audit';
import { withEarnedAnswer } from '@objectstack/types';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'hdr_drops_doors';
const HEADER = 'X-ObjectStack-Dropped-Fields';

const PROJ = {
  name: OBJECT, label: 'Header drops', systemFields: false,
  enable: { apiEnabled: true, clone: true },
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', type: 'text' as const },
    status: { name: 'status', type: 'text' as const },
    ro: { name: 'ro', type: 'text' as const, readonly: true },
    ro2: { name: 'ro2', type: 'text' as const, readonly: true },
    locked: { name: 'locked', type: 'text' as const, readonlyWhen: "record.status == 'closed'" },
  },
};

// Clone copies the source's readonly columns that hold a value (#15703: the
// strip of a copied value is reported), so a clone of a PROJ row would also
// report any `ro2` the source carried. Clone is read on its own objects: one
// readonly column, and none.
const CLONE_OBJECT = 'hdr_drops_clone';
const PLAIN_OBJECT = 'hdr_drops_plain';
const CLONE_PROJ = {
  name: CLONE_OBJECT, label: 'Header drops clone', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', type: 'text' as const },
    ro: { name: 'ro', type: 'text' as const, readonly: true },
  },
};
const PLAIN_PROJ = {
  name: PLAIN_OBJECT, label: 'Header drops plain', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', type: 'text' as const },
  },
};

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const res: any = {
    headers: {} as Record<string, string>,
    write: () => true, end: () => {},
    header: (k: string, v: string) => { res.headers[k] = v; return res; },
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

type Answer = { status: number; body: any; header: string | undefined };

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot() {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
  await engine.init();
  engine.registry.registerObject(PROJ as any);
  engine.registry.registerObject(CLONE_PROJ as any);
  engine.registry.registerObject(PLAIN_PROJ as any);
  engine.registry.registerObject(SysImportJob as any);
  await engine.syncSchemas();
  await installDefaultOrganization(engine);
  await engine.insert(OBJECT, { id: 'open1', title: 'open', status: 'open' } as any);
  await engine.insert(OBJECT, { id: 'open2', title: 'open too', status: 'open' } as any);
  // `readonlyWhen` already true; seeded under `isSystem`.
  await engine.insert(OBJECT, { id: 'closed1', title: 'closed', status: 'closed', locked: 'L' } as any, { context: { isSystem: true } } as any);
  await engine.insert(CLONE_OBJECT, { id: 'src1', title: 'source', ro: 'seeded' } as any, { context: { isSystem: true } } as any);
  // #29200: the same object, its readonly column left empty (null).
  await engine.insert(CLONE_OBJECT, { id: 'src_empty', title: 'empty source' } as any);
  await engine.insert(PLAIN_OBJECT, { id: 'plain1', title: 'source' } as any);

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(
    createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any,
    undefined, undefined, undefined, undefined,
    async () => engine, // objectQLProvider: the cross-object `/batch` door's transaction
  );
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const call = async (path: string, body: unknown, params: Record<string, string> = { object: OBJECT }): Promise<Answer> => {
    const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === path);
    expect(route, `POST ${path}`).toBeDefined();
    const res = makeRes();
    await route!.handler({ method: 'POST', params, body, query: {}, headers: {} } as any, res);
    return { status: res._status ?? 200, body: res._json, header: res.headers[HEADER] };
  };
  return { engine, call };
}

const RO = { object: OBJECT, fields: ['ro'], reason: 'readonly' };

describe('clone: the header names what the body reports', () => {
  it('overrides carrying a readonly field: 201, body droppedFields, header `ro;reason=readonly`', async () => {
    const b = await boot();
    const r = await b.call('/api/v1/data/:object/:id/clone', { overrides: { ro: 'forged', title: 'copy' } }, { object: CLONE_OBJECT, id: 'src1' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.droppedFields).toEqual([{ object: CLONE_OBJECT, fields: ['ro'], reason: 'readonly' }]);
    expect(r.header).toBe('ro;reason=readonly');
  });

  // #29200: the caller sent no readonly key and the copy carried none with a
  // value, so the engine stripped nothing the caller or the source supplied.
  it('a plain clone of a row whose readonly column is empty: no droppedFields, no header', async () => {
    const b = await boot();
    const r = await b.call('/api/v1/data/:object/:id/clone', {}, { object: CLONE_OBJECT, id: 'src_empty' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).not.toHaveProperty('droppedFields');
    expect(r.header).toBeUndefined();
    expect(r.body.record.ro ?? null).toBeNull();
    expect(r.body.record.title).toBe('empty source');
  });

  it('overrides setting the readonly field on that empty source: still reported, body and header', async () => {
    const b = await boot();
    const r = await b.call('/api/v1/data/:object/:id/clone', { overrides: { ro: 'forged' } }, { object: CLONE_OBJECT, id: 'src_empty' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.droppedFields).toEqual([{ object: CLONE_OBJECT, fields: ['ro'], reason: 'readonly' }]);
    expect(r.header).toBe('ro;reason=readonly');
    expect(r.body.record.ro ?? null).toBeNull();
  });

  // #15703 ruled that a clone REPORTS the readonly value it copied and the
  // engine stripped: the caller reads the default back and is told why.
  it('a plain clone of a row whose readonly column holds a value: still reported, body and header', async () => {
    const b = await boot();
    const r = await b.call('/api/v1/data/:object/:id/clone', {}, { object: CLONE_OBJECT, id: 'src1' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.droppedFields).toEqual([{ object: CLONE_OBJECT, fields: ['ro'], reason: 'readonly' }]);
    expect(r.header).toBe('ro;reason=readonly');
    expect(r.body.record.ro ?? null).toBeNull();
  });

  it('a clone that strips nothing: no droppedFields, no header (the control)', async () => {
    const b = await boot();
    const r = await b.call('/api/v1/data/:object/:id/clone', { overrides: { title: 'plain copy' } }, { object: PLAIN_OBJECT, id: 'plain1' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).not.toHaveProperty('droppedFields');
    expect(r.header).toBeUndefined();
  });
});

describe('createMany: one header naming the union of the rows\' strips, each field once', () => {
  it('two rows both stripping `ro`: header `ro;reason=readonly`', async () => {
    const b = await boot();
    const r = await b.call('/api/v1/data/:object/createMany', [{ id: 'm1', title: 'a', ro: 'x' }, { id: 'm2', title: 'b', ro: 'y' }]);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.droppedFields).toEqual([RO]);
    expect(r.header).toBe('ro;reason=readonly');
  });

  it('only one row strips: the field is still named once', async () => {
    const b = await boot();
    const r = await b.call('/api/v1/data/:object/createMany', [{ id: 'm3', title: 'a', ro: 'x' }, { id: 'm4', title: 'b' }]);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.header).toBe('ro;reason=readonly');
  });

  it('rows stripping different fields: the header names each one', async () => {
    const b = await boot();
    const r = await b.call('/api/v1/data/:object/createMany', [{ id: 'm5', ro: 'x' }, { id: 'm6', ro2: 'y' }]);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.header).toBe('ro;reason=readonly, ro2;reason=readonly');
  });

  it('no row strips: no droppedFields, no header (the control)', async () => {
    const b = await boot();
    const r = await b.call('/api/v1/data/:object/createMany', [{ id: 'm7', title: 'clean' }]);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).not.toHaveProperty('droppedFields');
    expect(r.header).toBeUndefined();
  });
});

describe('the per-row bulk doors: the header names the union, the body keeps each row\'s report', () => {
  const rows = [
    { id: 'open1', data: { title: 'u1', ro: 'x' } },
    { id: 'open2', data: { title: 'u2', ro: 'y' } },
    { id: 'closed1', data: { locked: 'forged' } },
  ];

  it('updateMany: header names `ro` once and `locked;reason=readonly_when`', async () => {
    const b = await boot();
    const r = await b.call('/api/v1/data/:object/updateMany', { records: rows });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.results.map((x: any) => x.droppedFields)).toEqual([
      [RO], [RO], [{ object: OBJECT, fields: ['locked'], reason: 'readonly_when' }],
    ]);
    expect(r.header).toBe('ro;reason=readonly, locked;reason=readonly_when');
  });

  it('batch (operation update): the same union', async () => {
    const b = await boot();
    const r = await b.call('/api/v1/data/:object/batch', { operation: 'update', records: rows });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.results.map((x: any) => x.droppedFields)).toEqual([
      [RO], [RO], [{ object: OBJECT, fields: ['locked'], reason: 'readonly_when' }],
    ]);
    expect(r.header).toBe('ro;reason=readonly, locked;reason=readonly_when');
  });

  it('updateMany and batch that strip nothing send no header (the control)', async () => {
    const b = await boot();
    const clean = [{ id: 'open1', data: { title: 'clean' } }];
    const many = await b.call('/api/v1/data/:object/updateMany', { records: clean });
    expect(many.status, JSON.stringify(many.body)).toBe(200);
    expect(many.header).toBeUndefined();
    const batch = await b.call('/api/v1/data/:object/batch', { operation: 'update', records: clean });
    expect(batch.status, JSON.stringify(batch.body)).toBe(200);
    expect(batch.header).toBeUndefined();
  });

  it('import commit: header names the rows\' union; the dry run writes nothing and sends none', async () => {
    const b = await boot();
    const importRows = [{ id: 'i1', title: 'a', ro: 'x' }, { id: 'i2', title: 'b' }, { id: 'i3', title: 'c', ro: 'z' }];
    const dry = await b.call('/api/v1/data/:object/import', { format: 'json', rows: importRows, dryRun: true });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body.results.map((x: any) => x.droppedFields)).toEqual([[RO], undefined, [RO]]);
    expect(dry.header).toBeUndefined();
    const commit = await b.call('/api/v1/data/:object/import', { format: 'json', rows: importRows, dryRun: false });
    expect(commit.status, JSON.stringify(commit.body)).toBe(200);
    expect(commit.body.results.map((x: any) => x.droppedFields)).toEqual([[RO], undefined, [RO]]);
    expect(commit.header).toBe('ro;reason=readonly');
  });

  it('an import commit that strips nothing sends no header (the control)', async () => {
    const b = await boot();
    const r = await b.call('/api/v1/data/:object/import', { format: 'json', rows: [{ id: 'i4', title: 'clean' }], dryRun: false });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.header).toBeUndefined();
  });
});

describe('cross-object POST /batch: the header names the ops\' union', () => {
  it('two ops stripping `ro`: body keeps one event per op with its index, header names `ro` once', async () => {
    const b = await boot();
    const r = await b.call('/api/v1/batch', {
      operations: [
        { object: OBJECT, action: 'create', data: { id: 'x1', title: 'a', ro: 'x' } },
        { object: OBJECT, action: 'update', id: 'open1', data: { ro: 'y' } },
      ],
    }, {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.droppedFields).toEqual([{ ...RO, index: 0 }, { ...RO, index: 1 }]);
    expect(r.header).toBe('ro;reason=readonly');
  });

  it('a batch that strips nothing sends no header (the control)', async () => {
    const b = await boot();
    const r = await b.call('/api/v1/batch', { operations: [{ object: OBJECT, action: 'create', data: { id: 'x2', title: 'clean' } }] }, {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).not.toHaveProperty('droppedFields');
    expect(r.header).toBeUndefined();
  });
});

describe('the stale-roll-up answer (#28782) of clone and createMany carries the header too', () => {
  /** objectql's `SummaryRecomputeError`, as a write's caller reads it: by `code`, carrying `written`. */
  function staleRefusal(written: unknown): Error {
    return Object.assign(new Error('Failed to recompute 1 roll-up summary value(s) after write; the triggering records WERE written.'), {
      code: 'ERR_SUMMARY_RECOMPUTE',
      written,
      failures: [{ childObject: OBJECT, parentObject: 'hdr_parent', parentId: 'p1', field: 'probe_sf', error: new Error('sum over text') }],
    });
  }

  function restOver(protocolMembers: Record<string, unknown>) {
    const protocol: any = {
      getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
      getMetaTypes: vi.fn().mockResolvedValue([]),
      getMetaItems: vi.fn().mockResolvedValue([]),
      ...protocolMembers,
    };
    const rest = new RestServer(createMockServer() as any, protocol, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    return async (path: string, body: unknown, params: Record<string, string>): Promise<Answer> => {
      const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === path)!;
      const res = makeRes();
      await route.handler({ method: 'POST', params, body, query: {}, headers: {} } as any, res);
      return { status: res._status ?? 200, body: res._json, header: res.headers[HEADER] };
    };
  }

  it('clone: 201 with the earned body and its header', async () => {
    const answer = { object: OBJECT, id: 'c1', sourceId: 'open1', record: { id: 'c1' }, droppedFields: [RO] };
    const call = restOver({ cloneData: vi.fn(async () => { throw withEarnedAnswer(staleRefusal(answer.record) as any, answer); }) });
    const r = await call('/api/v1/data/:object/:id/clone', { overrides: { ro: 'x' } }, { object: OBJECT, id: 'open1' });
    expect(r.status).toBe(201);
    expect(r.body).toEqual(answer);
    expect(r.header).toBe('ro;reason=readonly');
  });

  it('createMany: 201 with the earned body and its header', async () => {
    const answer = { object: OBJECT, records: [{ id: 'm1' }, { id: 'm2' }], count: 2, droppedFields: [RO] };
    const call = restOver({ createManyData: vi.fn(async () => { throw withEarnedAnswer(staleRefusal(answer.records) as any, answer); }) });
    const r = await call('/api/v1/data/:object/createMany', [{ ro: 'x' }, { ro: 'y' }], { object: OBJECT });
    expect(r.status).toBe(201);
    expect(r.body).toEqual(answer);
    expect(r.header).toBe('ro;reason=readonly');
  });
});
