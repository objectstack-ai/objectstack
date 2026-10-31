// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27884] The engine's stored-row read gate (`stored-metadata-type-read-gate.ts`):
 * a caller-context read of `sys_metadata` / `sys_metadata_history` serves a
 * capability-gated type's documents (a datasource's connection configuration
 * and secret handle) only to holders of the capability the `/meta` type gate
 * names for that type. Every pin here is a negative or a preservation pin
 * against a driver that really evaluates the composed predicate.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IRealtimeService, RealtimeEventPayload } from '@objectstack/spec/contracts';
import { STORED_METADATA_TYPE_READ_CAPABILITIES, storedMetadataTypesWithheldFrom } from '@objectstack/metadata-core';
import { ObjectQL } from './engine.js';
import { storedMetadataTypeReadFilter } from './stored-metadata-type-read-gate.js';

const CAPABILITY = 'manage_platform_settings';
const REF = 'sys_secret:sec_gate_pin_0001';
const HOST = 'db.gate-pin.internal';
const datasourceBody = JSON.stringify({
  name: 'ds_pin',
  driver: 'postgres',
  config: { host: HOST, port: 5432, database: 'pin_db', username: 'pin_user' },
  external: { credentialsRef: REF },
});
const viewBody = JSON.stringify({ name: 'v_pin', label: 'V', type: 'grid' });

const tableOf = (name: string) => ({
  name,
  label: name,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    type: { name: 'type', type: 'text' as const },
    name: { name: 'name', type: 'text' as const },
    metadata: { name: 'metadata', type: 'textarea' as const },
  },
});

/** A predicate evaluator for the shapes these reads compose: equality, `$in`, `$nin`, `$and`. */
function matches(row: Record<string, unknown>, where: unknown): boolean {
  if (!where || typeof where !== 'object') return true;
  return Object.entries(where as Record<string, unknown>).every(([key, cond]) => {
    if (key === '$and') return (cond as unknown[]).every((c) => matches(row, c));
    if (key.startsWith('$')) throw new Error(`pin driver: unsupported combinator ${key}`);
    const value = row[key] ?? null;
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      const c = cond as Record<string, unknown>;
      if ('$nin' in c) return !(c.$nin as unknown[]).includes(value);
      if ('$in' in c) return (c.$in as unknown[]).includes(value);
      if ('$eq' in c) return value === c.$eq;
      throw new Error(`pin driver: unsupported condition on ${key}: ${JSON.stringify(c)}`);
    }
    return value === (cond ?? null);
  });
}

function makeDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const rows = (o: string, ast: any) => Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(o: string, ast: any) {
      const matched = rows(o, ast);
      return typeof ast?.limit === 'number' ? matched.slice(0, ast.limit) : matched;
    },
    findStream() { throw new Error('ns'); },
    async findOne(o: string, ast: any) { return rows(o, ast)[0] ?? null; },
    async count(o: string, ast: any) { return rows(o, ast).length; },
    async aggregate(o: string, ast: any) { return [{ n: rows(o, ast).length }]; },
    async create(o: string, data: Record<string, unknown>) {
      const row = { ...data };
      storeFor(o).set(String(data.id), row);
      return row;
    },
    async update(o: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(o); const up = { ...s.get(id), ...data, id }; s.set(id, up); return up;
    },
    async delete(o: string, id: string) { return storeFor(o).delete(id); },
    async bulkCreate(o: string, rs: Record<string, unknown>[]) { return Promise.all(rs.map((r) => this.create(o, r))); },
    async updateMany() { return 0; }, async deleteMany() { return 0; },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async upsert(o: string, data: Record<string, unknown>) { return this.create(o, data); },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return driver;
}

/** A datasource administrator: holds the row's capability (platform administrators do). */
const ADMIN = { userId: 'u_admin', systemPermissions: [CAPABILITY, 'manage_metadata', 'studio.access'] };
/**
 * The shipped organization administrator's capability set — below datasource
 * administration (`organization_admin`, `@objectstack/plugin-security`).
 */
const ORG_ADMIN = { userId: 'u_org_admin', systemPermissions: ['manage_org_users', 'setup.access', 'setup.write', 'manage_mailboxes'] };
/** A caller that may enter Studio (and so read the history table) without datasource administration. */
const STUDIO_AUTHOR = { userId: 'u_author', systemPermissions: ['studio.access', 'manage_metadata'] };
/** A plain reader: no capability set at all. */
const READER = { userId: 'u_reader' };

describe('[#27884] stored-row read gate on the stored-metadata tables', () => {
  let engine: ObjectQL;

  beforeEach(async () => {
    engine = new ObjectQL();
    engine.registerDriver(makeDriver(), true);
    await engine.init();
    for (const table of ['sys_metadata', 'sys_metadata_history']) {
      engine.registry.registerObject(tableOf(table));
      await engine.insert(table, { id: `${table}_ds`, type: 'datasource', name: 'ds_pin', metadata: datasourceBody }, { context: { isSystem: true } });
      await engine.insert(table, { id: `${table}_cat`, type: 'external_catalog', name: 'ds_pin', metadata: '{}' }, { context: { isSystem: true } });
      await engine.insert(table, { id: `${table}_view`, type: 'view', name: 'v_pin', metadata: viewBody }, { context: { isSystem: true } });
    }
    vi.spyOn((engine as any).logger, 'debug').mockImplementation(() => undefined);
  });

  it('a datasource administrator reads the row whole: connection configuration and credentialsRef', async () => {
    const rows = await engine.find('sys_metadata', { where: { type: 'datasource' }, context: ADMIN });
    expect(rows).toHaveLength(1);
    const body = JSON.parse(rows[0].metadata);
    expect(body.external.credentialsRef).toBe(REF);
    expect(body.config).toMatchObject({ host: HOST, port: 5432, database: 'pin_db', username: 'pin_user' });
    const one = await engine.findOne('sys_metadata', { where: { id: 'sys_metadata_ds' }, context: ADMIN });
    expect(one?.type).toBe('datasource');
    expect(await engine.count('sys_metadata', { context: ADMIN })).toBe(3);
  });

  for (const [label, caller] of [['the built-in organization administrator', ORG_ADMIN], ['a plain reader', READER]] as const) {
    it(`${label} is served no datasource-family row on sys_metadata (find, findOne, count, aggregate)`, async () => {
      const listed = await engine.find('sys_metadata', { context: caller });
      expect(listed.map((r: any) => r.type).sort()).toEqual(['view']);
      expect(JSON.stringify(listed)).not.toContain(REF);
      expect(JSON.stringify(listed)).not.toContain(HOST);

      // Asked for by type: nothing, not a refusal that names the row.
      expect(await engine.find('sys_metadata', { where: { type: 'datasource' }, context: caller })).toEqual([]);
      // A get of the row's id answers as a get of a row that does not exist.
      expect(await engine.findOne('sys_metadata', { where: { id: 'sys_metadata_ds' }, context: caller })).toBeNull();
      expect(await engine.count('sys_metadata', { where: { type: 'datasource' }, context: caller })).toBe(0);
      expect(await engine.count('sys_metadata', { context: caller })).toBe(1);
      const agg: any = await engine.aggregate('sys_metadata', { where: { type: 'external_catalog' }, groupBy: ['type'], aggregations: [{ function: 'count', alias: 'n' }], context: caller });
      expect(JSON.stringify(agg)).toContain('"n":0');
    });
  }

  it('the history table (the same document, versioned) is gated by the same row', async () => {
    const author = await engine.find('sys_metadata_history', { context: STUDIO_AUTHOR });
    expect(author.map((r: any) => r.type)).toEqual(['view']);
    expect(await engine.findOne('sys_metadata_history', { where: { id: 'sys_metadata_history_ds' }, context: STUDIO_AUTHOR })).toBeNull();
    const admin = await engine.find('sys_metadata_history', { context: ADMIN });
    expect(admin.map((r: any) => r.type).sort()).toEqual(['datasource', 'external_catalog', 'view']);
  });

  it('a system read is the platform\'s own and is not narrowed', async () => {
    const rows = await engine.find('sys_metadata', { context: { isSystem: true } });
    expect(rows).toHaveLength(3);
  });

  it('the composed predicate names exactly the types whose capability the caller lacks', () => {
    expect(storedMetadataTypeReadFilter({ object: 'sys_metadata', operation: 'find', context: ORG_ADMIN as any }))
      .toEqual({ type: { $nin: ['datasource', 'external_catalog'] } });
    expect(storedMetadataTypeReadFilter({ object: 'sys_metadata', operation: 'find', context: ADMIN as any })).toBeUndefined();
    // Outside the family, and on a write, nothing is composed.
    expect(storedMetadataTypeReadFilter({ object: 'task', operation: 'find', context: READER as any })).toBeUndefined();
    expect(storedMetadataTypeReadFilter({ object: 'sys_metadata', operation: 'update', context: READER as any })).toBeUndefined();
    // Every type in the row is withheld from a caller with no capability set.
    expect(storedMetadataTypesWithheldFrom(READER)).toEqual(Object.keys(STORED_METADATA_TYPE_READ_CAPABILITIES));
  });
});

describe('[#27884] realtime events of a datasource-family row carry no body to any subscriber', () => {
  it('insert and update events of a datasource row withhold the body; an ungated row keeps it', async () => {
    const published: RealtimeEventPayload[] = [];
    const realtime: IRealtimeService = {
      publish: vi.fn(async (event: RealtimeEventPayload) => { published.push(event); }),
      subscribe: vi.fn(async () => 'sub-1'),
      unsubscribe: vi.fn(async () => undefined),
    };
    const engine = new ObjectQL();
    engine.registerDriver(makeDriver(), true);
    await engine.init();
    engine.registry.registerObject(tableOf('sys_metadata'));
    engine.setRealtimeService(realtime);
    vi.spyOn((engine as any).logger, 'debug').mockImplementation(() => undefined);

    await engine.insert('sys_metadata', { id: 'e_ds', type: 'datasource', name: 'ds_pin', metadata: datasourceBody }, { context: { isSystem: true } });
    await engine.update('sys_metadata', { id: 'e_ds', metadata: datasourceBody }, { context: { isSystem: true } });
    await engine.insert('sys_metadata', { id: 'e_cat', type: 'external_catalog', name: 'ds_pin', metadata: '{"tables":[]}' }, { context: { isSystem: true } });
    await engine.insert('sys_metadata', { id: 'e_view', type: 'view', name: 'v_pin', metadata: viewBody }, { context: { isSystem: true } });

    expect(published).toHaveLength(4);
    for (const event of published.slice(0, 3)) {
      const payload = event.payload as Record<string, any>;
      expect(JSON.stringify(payload)).not.toContain(REF);
      expect(JSON.stringify(payload)).not.toContain(HOST);
      expect(payload.after).not.toHaveProperty('metadata');
      if (payload.changes) expect(payload.changes).not.toHaveProperty('metadata');
    }
    expect((published[3].payload as Record<string, any>).after.metadata).toBe(viewBody);
  });
});
