// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21454] The stored-metadata reader seam, against a scoped-API double: which
 * reads it serves, through which derived contexts, and that it serves each one
 * exactly once. The composed contexts are pinned end to end, against the data
 * door, in `stored-metadata-reader-contexts.pin.test.ts`; this file holds the
 * routes a body or handler can take around the seam that the composition does
 * not exercise one by one.
 */

import { describe, it, expect } from 'vitest';
import {
  assertEngineFindOnePredicate,
  assertEngineUpdateDispatch,
  assertEngineDeleteDispatch,
  SysMetadataHistoryObject,
  SysMetadataObject,
} from '@objectstack/metadata-core';
import { ephemeralStoredHashDigest, ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { serveStoredMetadataRead, serveStoredMetadataReadsThrough } from './stored-metadata-reader-seam.js';

const SENTINEL = 'seam-unit-sentinel-41d7';
const STORED_HASH = `sha256:${'a1'.repeat(32)}`;

function storedRow(): Record<string, unknown> {
  return {
    id: 'row_1',
    type: 'datasource',
    name: 'unit_ds',
    metadata: JSON.stringify({
      name: 'unit_ds',
      driver: 'turso',
      config: { url: 'libsql://unit.example.invalid', encryptionKey: SENTINEL },
    }),
    checksum: STORED_HASH,
  };
}

/** A keyed-digest provider whose output names what it keyed. */
const provider = async (plain: string) => `keyed:${plain.length}`;
const engineWithProvider = { getKeyedDigest: () => provider };

/** A double of the engine's scoped API: every derived context reads the same store. */
function scopedApi(seen: { fields: unknown[]; reads: number } = { fields: [], reads: 0 }): any {
  const repo = (name: string) => ({
    async find(query?: any) {
      seen.reads += 1;
      seen.fields.push(query?.searchFields ?? query?.fields);
      return name.startsWith('sys_metadata') ? [storedRow()] : [{ id: 'n1', metadata: 'ordinary', checksum: STORED_HASH }];
    },
    async findOne(query?: any) {
      assertEngineFindOnePredicate(name, query);
      seen.reads += 1;
      return name.startsWith('sys_metadata') ? storedRow() : null;
    },
    async count() { seen.reads += 1; return 1; },
    async aggregate() { seen.reads += 1; return [{ type: 'datasource', metadata: storedRow().metadata, checksum: STORED_HASH, count: 1 }]; },
    // Write returns: a family row comes back from a write too, and is served.
    // update/delete route through the engine's own dispatch predicates so this
    // double cannot be looser than ObjectQL's (check:engine-double-contract).
    async insert(_data?: any) { return name.startsWith('sys_metadata') ? storedRow() : { id: 'n1' }; },
    async update(data?: any, opts?: any) { assertEngineUpdateDispatch(data, opts); return name.startsWith('sys_metadata') ? storedRow() : 1; },
    async delete(opts?: any) { assertEngineDeleteDispatch(opts); return 1; },
  });
  return {
    object: repo,
    sudo: () => scopedApi(seen),
    withRunAs: () => scopedApi(seen),
    async transaction(callback: (trx: any, info: unknown) => Promise<unknown>) {
      return callback(scopedApi(seen), { owned: true });
    },
    async beginTransaction() { return { ctx: scopedApi(seen), handle: 'trx_1', owned: true }; },
  };
}

/**
 * The engine face the seam reads: the keyed-digest provider, plus a `getObject`
 * answering a family-shaped field map so the default-`$search` narrowing can
 * resolve a searchable set (the body column is a searchable `textarea`, the
 * hash a searchable `text` — exactly the columns the narrowing must remove).
 */
const familySchema = {
  fields: { name: { type: 'text' }, type: { type: 'text' }, metadata: { type: 'textarea' }, checksum: { type: 'text' } },
  nameField: 'name',
};
const engineWithProviderAndSchema = { getKeyedDigest: () => provider, getObject: () => familySchema };

function expectServed(row: any, hash = 'keyed:71'): void {
  expect(String(row.metadata)).not.toContain(SENTINEL);
  expect(String(row.metadata)).toContain('unit.example.invalid');
  expect(row.checksum).toBe(hash);
}

describe('[#21454] serveStoredMetadataReadsThrough — the reads it serves', () => {
  it('find, findOne and aggregate on a family object answer the projected body and the keyed hash', async () => {
    const api = serveStoredMetadataReadsThrough(scopedApi(), engineWithProvider);
    for (const object of ['sys_metadata', 'sys_metadata_history']) {
      expectServed((await api.object(object).find({ where: {} }))[0]);
      expectServed(await api.object(object).findOne({ where: { id: 'row_1' } }));
      // Grouping by a SCALAR column is served; grouping by the body or hash is refused below.
      expectServed((await api.object(object).aggregate({ groupBy: ['type'] }))[0]);
      expect(await api.object(object).count({})).toBe(1);
    }
  });

  it('an object outside the family is answered as read, by reference', async () => {
    const raw = scopedApi();
    const api = serveStoredMetadataReadsThrough(raw, engineWithProvider);
    const rows = await api.object('pin_note').find({});
    expect(rows[0]).toEqual({ id: 'n1', metadata: 'ordinary', checksum: STORED_HASH });
  });

  it('every derived context is served too: sudo, withRunAs, transaction(fn), beginTransaction', async () => {
    const api = serveStoredMetadataReadsThrough(scopedApi(), engineWithProvider);
    expectServed((await api.sudo().object('sys_metadata').find({}))[0]);
    expectServed((await api.withRunAs('system', {}).object('sys_metadata').find({}))[0]);
    await api.transaction(async (trx: any) => {
      expectServed((await trx.object('sys_metadata').find({}))[0]);
    });
    const begun = await api.beginTransaction();
    expect(begun.handle).toBe('trx_1');
    expect(begun.owned).toBe(true);
    expectServed((await begun.ctx.object('sys_metadata').find({}))[0]);
  });

  it('serves once: an API already served through the seam is returned as is', async () => {
    const once = serveStoredMetadataReadsThrough(scopedApi(), engineWithProvider);
    const twice = serveStoredMetadataReadsThrough(once, engineWithProvider);
    expect(twice).toBe(once);
    expectServed((await twice.object('sys_metadata').find({}))[0]);
  });

  it('a projection naming the body alone reads the type beside it and serves exactly the columns named', async () => {
    const seen = { fields: [] as unknown[], reads: 0 };
    const api = serveStoredMetadataReadsThrough(scopedApi(seen), engineWithProvider);
    const [row] = await api.object('sys_metadata').find({ fields: ['metadata'] });
    expect(seen.fields).toEqual([['metadata', 'type']]);
    expect('type' in row).toBe(false);
    expect(String(row.metadata)).not.toContain(SENTINEL);
  });

  it('with no crypto provider, the hash is keyed under the data door\'s own process key', async () => {
    const api = serveStoredMetadataReadsThrough(scopedApi(), {});
    const [row] = await api.object('sys_metadata').find({});
    expect(row.checksum).toBe(await ephemeralStoredHashDigest(STORED_HASH));
    expect(row.checksum).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
  });
});

describe('[#21454] serveStoredMetadataRead — one read, served in the shape it arrived in', () => {
  it('a row list, one row, and null', async () => {
    const [listed] = await serveStoredMetadataRead('sys_metadata', {}, engineWithProvider, async () => [storedRow()]);
    expectServed(listed);
    expectServed(await serveStoredMetadataRead('sys_metadata', {}, engineWithProvider, async () => storedRow()));
    expect(await serveStoredMetadataRead('sys_metadata', {}, engineWithProvider, async () => null)).toBeNull();
  });

  it('an object outside the family runs the caller\'s query untouched and returns the answer by reference', async () => {
    const query = { fields: ['metadata'] };
    const answer = [storedRow()];
    let received: unknown;
    const out = await serveStoredMetadataRead('pin_note', query, engineWithProvider, async (q) => {
      received = q;
      return answer;
    });
    expect(received).toBe(query);
    expect(out).toBe(answer);
  });
});

describe('[#21454] the EVALUATE shapes are refused, the way the data door refuses them', () => {
  // Each case asserts the data door's envelope directly (code / status / param /
  // field): the predicates are the door's own, so the seam carries them verbatim.

  it('a filter, sort or grouping on the body column, through the served read', async () => {
    const seen = { fields: [] as unknown[], reads: 0 };
    const api = serveStoredMetadataReadsThrough(scopedApi(seen), engineWithProvider);
    await expect(api.object('sys_metadata').find({ where: { metadata: { $contains: 'z' } } }))
      .rejects.toMatchObject({ code: 'INVALID_FIELD', status: 400, param: 'filter', field: 'metadata' });
    await expect(api.object('sys_metadata').find({ orderBy: [{ field: 'metadata', order: 'asc' }] }))
      .rejects.toMatchObject({ code: 'INVALID_FIELD', status: 400, param: 'sort', field: 'metadata' });
    await expect(api.object('sys_metadata_history').aggregate({ groupBy: ['metadata'] }))
      .rejects.toMatchObject({ code: 'INVALID_FIELD', status: 400, param: 'groupBy', field: 'metadata' });
    // Not one read reached the double: every shape was refused before it ran.
    expect(seen.reads).toBe(0);
  });

  it('the array-form filter a direct engine call still honours is refused too (lowered first)', async () => {
    const api = serveStoredMetadataReadsThrough(scopedApi(), engineWithProvider);
    await expect(api.object('sys_metadata').find({ where: [['metadata', 'contains', 'z']] }))
      .rejects.toMatchObject({ code: 'INVALID_FIELD', status: 400, param: 'filter', field: 'metadata' });
  });

  it('a filter, sort or grouping on a content-hash column', async () => {
    const api = serveStoredMetadataReadsThrough(scopedApi(), engineWithProvider);
    await expect(api.object('sys_metadata').find({ where: { checksum: 'guess' } }))
      .rejects.toMatchObject({ code: 'INVALID_FIELD', status: 400, param: 'filter', field: 'checksum' });
    await expect(api.object('sys_metadata_history').find({ where: { previous_checksum: 'guess' } }))
      .rejects.toMatchObject({ code: 'INVALID_FIELD', status: 400, param: 'filter', field: 'previous_checksum' });
    await expect(api.object('sys_metadata').aggregate({ groupBy: [{ field: 'checksum' }] }))
      .rejects.toMatchObject({ code: 'INVALID_FIELD', status: 400, param: 'groupBy', field: 'checksum' });
  });

  it('count with such a predicate — the oracle verb — is refused and never reaches the store', async () => {
    const seen = { fields: [] as unknown[], reads: 0 };
    const api = serveStoredMetadataReadsThrough(scopedApi(seen), engineWithProvider);
    await expect(api.object('sys_metadata').count({ where: { metadata: { $contains: 'z' } } }))
      .rejects.toMatchObject({ code: 'INVALID_FIELD', status: 400, field: 'metadata' });
    await expect(api.object('sys_metadata').count({ where: { checksum: 'guess' } }))
      .rejects.toMatchObject({ code: 'INVALID_FIELD', status: 400, field: 'checksum' });
    expect(seen.reads).toBe(0);
  });

  it('an EXPLICIT search field list naming the body or a hash column is refused', async () => {
    const api = serveStoredMetadataReadsThrough(scopedApi(), engineWithProvider);
    await expect(api.object('sys_metadata').find({ search: 'z', searchFields: ['metadata'] }))
      .rejects.toMatchObject({ code: 'INVALID_FIELD', status: 400, param: 'searchFields', field: 'metadata' });
    await expect(api.object('sys_metadata').find({ search: { term: 'z', fields: ['checksum'] } }))
      .rejects.toMatchObject({ code: 'INVALID_FIELD', status: 400, param: 'search', field: 'checksum' });
  });

  it('a scalar-column filter / sort / grouping is NOT refused — only the family columns are', async () => {
    const api = serveStoredMetadataReadsThrough(scopedApi(), engineWithProvider);
    expectServed((await api.object('sys_metadata').find({ where: { type: 'datasource' }, orderBy: [{ field: 'name' }] }))[0]);
    expectServed((await api.object('sys_metadata').aggregate({ groupBy: ['type', 'state'] }))[0]);
    expect(await api.object('sys_metadata').count({ where: { type: 'datasource' } })).toBe(1);
  });
});

describe('[#21454] a DEFAULT $search is narrowed to the door\'s served set, not refused', () => {
  it('the body and hash columns are removed, the read runs with the remaining searchable fields', async () => {
    const seen = { fields: [] as unknown[], reads: 0 };
    const api = serveStoredMetadataReadsThrough(scopedApi(seen), engineWithProviderAndSchema);
    const [row] = await api.object('sys_metadata').find({ search: 'datasource' });
    // The read ran (a body may search a family table by name), served like the door…
    expect(seen.reads).toBe(1);
    expect(String(row.metadata)).not.toContain(SENTINEL);
    // …and the search was narrowed to name/type — never metadata or checksum.
    const searchFields = seen.fields[0] as string[];
    expect(searchFields).toContain('name');
    expect(searchFields).not.toContain('metadata');
    expect(searchFields).not.toContain('checksum');
  });
});

describe('[#21454] what a WRITE verb RETURNS is served — body projected, hash keyed', () => {
  it('insert and update returning a family row are served; a count return and a non-family write are untouched', async () => {
    const api = serveStoredMetadataReadsThrough(scopedApi(), engineWithProvider);
    expectServed(await api.object('sys_metadata').insert({ type: 'datasource' }));
    expectServed(await api.object('sys_metadata_history').update({ id: 'row_1' }));
    expect(await api.object('sys_metadata').delete({ where: { id: 'row_1' } })).toBe(1);
    // A non-family write returns by reference, nothing served.
    expect(await api.object('pin_note').insert({ x: 1 })).toEqual({ id: 'n1' });
  });
});

describe('[#21454] the engine action verb is never on a served body\'s surface', () => {
  it('serveStoredMetadataReadsThrough exposes no execute, sudo or withRunAs beyond the engine\'s own', () => {
    // The seam wraps whatever the context carries; a sandboxed body reaches
    // only the VM bridge's verbs (find/findOne/count/aggregate + writes), which
    // carries no `execute`. The reach reading: `execute` is recorded unreachable
    // from a served body on #21454, not closed here. This pin asserts the seam
    // adds no execute of its own to a repository that had none.
    const repo = { find: async () => [], count: async () => 0 } as any;
    const api = serveStoredMetadataReadsThrough({ object: (_name: string) => repo } as any, engineWithProvider);
    expect((api.object('sys_metadata') as any).execute).toBeUndefined();
  });
});

/**
 * [#21544] The door and the seam answer every family filter and search the
 * SAME way, because both call the door's two exported functions — its one
 * filter-field collector (`collectStoredMetadataFilterFields`) and its one
 * default-search narrowing (`narrowStoredMetadataSearch`). One table, run
 * through both: the generic data door (`findData`, over an engine double whose
 * registry answers the real family definitions) and the seam (a scoped API
 * served through `serveStoredMetadataReadsThrough`, whose engine face answers
 * the same definitions). A future divergence fails one shared case.
 *
 * An outcome is the refusal's `code`, `status` and the column it names (the
 * door's earlier ingress gate answers a DOTTED key first, naming the whole
 * key under `where`, so the column is compared by its head and `param` is
 * compared on the search rows only), or — for a query that ran — the
 * `searchFields` the read was handed.
 */
describe('[#21544] door / seam parity — one collector, one narrowing', () => {
  type Outcome =
    | { refused: { code: unknown; status: unknown; column: string; param?: unknown } }
    | { ran: { searchFields: unknown } };
  const deep = (n: number, leaf: Record<string, unknown>): Record<string, unknown> =>
    (n === 0 ? leaf : { $and: [deep(n - 1, leaf)] });
  const familySchemas = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    sys_metadata: SysMetadataObject,
    sys_metadata_history: SysMetadataHistoryObject,
    ...overrides,
  });
  const refusedAs = (e: any, withParam: boolean): Outcome => ({
    refused: {
      code: e?.code,
      status: e?.status,
      column: String(e?.field).split('.')[0] as string,
      ...(withParam ? { param: e?.param } : {}),
    },
  });
  const isAggregate = (query: Record<string, unknown>) => 'groupBy' in query || 'aggregations' in query;

  async function viaDoor(object: string, query: Record<string, unknown>, schemas: Record<string, unknown>, withParam: boolean): Promise<Outcome> {
    const handed: Array<Record<string, unknown>> = [];
    const record = async (_object: string, options: Record<string, unknown>) => {
      handed.push(options);
      return [];
    };
    const engine: any = {
      registry: { getObject: (name: string) => schemas[name] },
      find: record,
      aggregate: record,
      // `findData` reads through find / count / aggregate only — no `findOne` here.
      count: async () => 0,
      getKeyedDigest: () => provider,
    };
    try {
      await new ObjectStackProtocolImplementation(engine).findData({ object, query: structuredClone(query) });
    } catch (e) {
      return refusedAs(e, withParam);
    }
    return { ran: { searchFields: handed[0]?.searchFields } };
  }

  async function viaSeam(object: string, query: Record<string, unknown>, schemas: Record<string, unknown>, withParam: boolean): Promise<Outcome> {
    const handed: Array<Record<string, unknown>> = [];
    const repo = {
      async find(q: Record<string, unknown>) { handed.push(q); return []; },
      async aggregate(q: Record<string, unknown>) { handed.push(q); return []; },
    };
    const api = serveStoredMetadataReadsThrough(
      { object: (_name: string) => repo } as any,
      { getKeyedDigest: () => provider, getObject: (name: string) => schemas[name] },
    );
    const served = api.object(object) as typeof repo;
    try {
      await (isAggregate(query) ? served.aggregate(structuredClone(query)) : served.find(structuredClone(query)));
    } catch (e) {
      return refusedAs(e, withParam);
    }
    return { ran: { searchFields: handed[0]?.searchFields } };
  }

  // [label, object, query, expected column (refused) or null (ran), compare param?, schema overrides]
  const cases: Array<[string, string, Record<string, unknown>, string | null, boolean?, Record<string, unknown>?]> = [
    // The search half: an explicit list, the default search, an emptied set.
    ['an explicit search list (array) naming the body', 'sys_metadata', { search: 'z', searchFields: ['name', 'metadata'] }, 'metadata', true],
    ['an explicit search list (comma string) naming a hash', 'sys_metadata_history', { search: 'z', searchFields: 'name,checksum' }, 'checksum', true],
    ['an explicit object-form search list naming the parent hash', 'sys_metadata_history', { search: { query: 'z', fields: ['previous_checksum'] } }, 'previous_checksum', true],
    ['an explicit search list naming neither', 'sys_metadata', { search: 'z', searchFields: ['name'] }, null, true],
    ['the default search (narrowed, then run)', 'sys_metadata', { search: 'datasource' }, null, true],
    ['the default search on the history table', 'sys_metadata_history', { search: 'datasource' }, null, true],
    [
      'a default search whose set narrows to nothing',
      'sys_metadata',
      { search: 'z' },
      'metadata',
      true,
      { sys_metadata: { ...SysMetadataObject, searchableFields: ['metadata', 'checksum'] } },
    ],
    // The collector half: what the measurement found the door's old collector missed, and its neighbours.
    ['a direct body filter', 'sys_metadata', { where: { metadata: { $contains: 'z' } } }, 'metadata'],
    ['a dotted body key', 'sys_metadata', { where: { 'metadata.config': 'z' } }, 'metadata'],
    ['a dotted hash key', 'sys_metadata_history', { where: { 'checksum.x': 'z' } }, 'checksum'],
    ['a cross-field comparand on the body', 'sys_metadata', { where: { name: { $eq: { $field: 'metadata' } } } }, 'metadata'],
    ['a cross-field comparand on a hash', 'sys_metadata', { where: { type: { $lt: { $field: 'checksum' } } } }, 'checksum'],
    ['a cross-field comparand on the change note', 'sys_metadata_history', { where: { name: { $ne: { $field: 'change_note' } } } }, 'change_note'],
    ['a dotted cross-field reference', 'sys_metadata', { where: { name: { $ne: { $field: 'metadata.x' } } } }, 'metadata'],
    ['a reference in a list', 'sys_metadata', { where: { name: { $in: [{ $field: 'checksum' }] } } }, 'checksum'],
    ['a reference under $not', 'sys_metadata_history', { where: { $not: { name: { $eq: { $field: 'previous_checksum' } } } } }, 'previous_checksum'],
    ['an unrecognised $ key wrapping a body filter', 'sys_metadata', { where: { $nor: [{ metadata: { $contains: 'z' } }] } }, 'metadata'],
    ['a direct body filter 33 levels deep', 'sys_metadata', { where: deep(33, { metadata: { $contains: 'z' } }) }, 'metadata'],
    ['a cross-field comparand 33 levels deep', 'sys_metadata_history', { where: deep(33, { name: { $ne: { $field: 'checksum' } } }) }, 'checksum'],
    [
      'a cross-field comparand in an aggregation filter',
      'sys_metadata',
      { groupBy: ['type'], aggregations: [{ function: 'count', alias: 'n', filter: { name: { $ne: { $field: 'metadata' } } } }] },
      'metadata',
    ],
    [
      'a body filter 33 levels deep in an aggregation filter',
      'sys_metadata_history',
      { groupBy: ['type'], aggregations: [{ function: 'count', alias: 'n', filter: deep(33, { metadata: { $contains: 'z' } }) }] },
      'metadata',
    ],
    // Controls: scalar columns, and a `having` alias spelled like a family column, run on both.
    ['control: a cross-field comparand between scalar columns', 'sys_metadata', { where: { name: { $ne: { $field: 'type' } } } }, null],
    ['control: a scalar filter 33 levels deep', 'sys_metadata', { where: deep(33, { type: 'view' }) }, null],
    [
      'control: a `having` on an aggregation alias spelled like the body column',
      'sys_metadata',
      { groupBy: ['type'], aggregations: [{ function: 'count', alias: 'metadata' }], having: { metadata: { $gt: 0 } } },
      null,
    ],
  ];

  for (const [label, object, query, column, withParam = false, overrides] of cases) {
    it(`${label}: the door and the seam answer identically`, async () => {
      const schemas = familySchemas(overrides);
      const door = await viaDoor(object, query, schemas, withParam);
      const seam = await viaSeam(object, query, schemas, withParam);
      expect(seam).toEqual(door);
      if (column === null) {
        expect('ran' in door, `${label}: the door refused a query that should run`).toBe(true);
      } else {
        expect(door).toMatchObject({ refused: { code: 'INVALID_FIELD', status: 400, column } });
      }
    });
  }

  it('the default search is handed on narrowed — the body and hash columns never scanned', async () => {
    const door = await viaDoor('sys_metadata_history', { search: 'datasource' }, familySchemas(), false);
    const searchFields = (door as { ran: { searchFields: string[] } }).ran.searchFields;
    expect(searchFields).toContain('name');
    for (const column of ['metadata', 'checksum', 'previous_checksum', 'change_note']) expect(searchFields).not.toContain(column);
  });

  it('`count` runs the query the guard returns: a default search arrives narrowed', async () => {
    const counted: Array<Record<string, unknown>> = [];
    const repo = { async count(q: Record<string, unknown>) { counted.push(q); return 0; } };
    const api = serveStoredMetadataReadsThrough(
      { object: (_name: string) => repo } as any,
      { getKeyedDigest: () => provider, getObject: (name: string) => familySchemas()[name] },
    );
    await (api.object('sys_metadata') as typeof repo).count({ search: 'datasource' });
    const searchFields = counted[0]?.searchFields as string[];
    expect(searchFields).toContain('name');
    expect(searchFields).not.toContain('metadata');
    expect(searchFields).not.toContain('checksum');
  });
});
