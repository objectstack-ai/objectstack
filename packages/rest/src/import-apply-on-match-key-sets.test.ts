// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Two import contract keys, driven through the REAL `POST /data/:object/import`
 * route on a real ObjectQL engine + protocol (sqlite `:memory:`), as
 * `import-inline-mapping-entry.test.ts` is:
 *
 * - [#25577] `FieldMappingEntry.applyOn: 'create'` — a create-only column is
 *   written when the row is created and left alone when an upsert updates an
 *   existing row, so one upsert re-run refreshes master data without
 *   reverting state written since the first run.
 * - [#25578] `matchFields` as ordered key sets (`string[][]`) — each row is
 *   matched by the first set whose fields are all non-blank, and a row blank
 *   on every set is a row error, not a silent create or skip. One key set
 *   (`string[]`) keeps its own blank handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

const SUPPLIER = {
  name: 'supplier', label: 'Supplier', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const, label: 'Name' },
    status: { name: 'status', type: 'text' as const, label: 'Status' },
    credit_code: { name: 'credit_code', type: 'text' as const, label: 'Credit code' },
    country: { name: 'country', type: 'text' as const, label: 'Country' },
    registration_no: { name: 'registration_no', type: 'text' as const, label: 'Registration no.' },
  },
};

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

function makeRes() {
  const res: any = {
    write: () => true, end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

async function boot() {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(new SqlDriver({
    client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
  }), true);
  await engine.init();
  engine.registry.registerObject(SUPPLIER as any);
  await engine.syncSchemas();
  await installDefaultOrganization(engine);
  for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
    if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as any);
  }
  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const noop = () => {};
  const server = { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
  const rest = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/import');
  expect(route).toBeDefined();
  return { engine, route };
}

describe('import route — applyOn and ordered match key sets (#25577, #25578)', () => {
  let engine: any;
  let route: any;
  const call = async (body: any) => {
    const res = makeRes();
    await route.handler({ params: { object: 'supplier' }, body } as any, res);
    return res;
  };

  beforeEach(async () => {
    ({ engine, route } = await boot());
  });

  describe('ordered match key sets (#25578)', () => {
    const keySets = [['credit_code'], ['country', 'registration_no']];

    it('a mixed sheet matches domestic rows on set 1 and overseas rows on set 2 in one import', async () => {
      await engine.insert('supplier', { id: 'dom', credit_code: 'C1', name: 'Domestic' });
      await engine.insert('supplier', { id: 'ovs', country: 'DE', registration_no: 'HRB1', name: 'Overseas' });
      const res = await call({
        format: 'json', writeMode: 'upsert', matchFields: keySets,
        rows: [
          { credit_code: 'C1', name: 'Domestic Ltd' },
          { country: 'DE', registration_no: 'HRB1', name: 'Overseas GmbH' },
          { country: 'FR', registration_no: 'RCS9', name: 'New Overseas' },
        ],
      });
      expect(res._json).toMatchObject({ ok: 3, updated: 2, created: 1, errors: 0 });
      expect(res._json.results.map((r: any) => r.action)).toEqual(['updated', 'updated', 'created']);
      const all = await engine.find('supplier', {});
      expect(all).toHaveLength(3);
      expect(all.find((r: any) => r.id === 'dom')).toMatchObject({ name: 'Domestic Ltd' });
      expect(all.find((r: any) => r.id === 'ovs')).toMatchObject({ name: 'Overseas GmbH' });

      // Re-running the same sheet creates nothing: it is idempotent across both kinds of row.
      const again = await call({
        format: 'json', writeMode: 'upsert', matchFields: keySets,
        rows: [
          { credit_code: 'C1', name: 'Domestic Ltd' },
          { country: 'DE', registration_no: 'HRB1', name: 'Overseas GmbH' },
          { country: 'FR', registration_no: 'RCS9', name: 'New Overseas' },
        ],
      });
      expect(again._json).toMatchObject({ ok: 3, updated: 3, created: 0 });
      expect(await engine.find('supplier', {})).toHaveLength(3);
    });

    it('a row is matched by the first non-blank set only: a miss on it creates, it never falls through to the next set', async () => {
      await engine.insert('supplier', { id: 'ovs', country: 'DE', registration_no: 'HRB1', name: 'Overseas' });
      const res = await call({
        format: 'json', writeMode: 'upsert', matchFields: keySets,
        rows: [{ credit_code: 'C9', country: 'DE', registration_no: 'HRB1', name: 'Has a credit code' }],
      });
      expect(res._json).toMatchObject({ ok: 1, created: 1, updated: 0 });
      expect(await engine.find('supplier', {})).toHaveLength(2);
    });

    it('a row blank on every set is a row error BLANK_MATCH_KEY, on the dry run and the commit alike; the other rows import', async () => {
      const body = {
        format: 'json', writeMode: 'upsert', matchFields: keySets,
        rows: [
          { credit_code: 'C1', name: 'Domestic' },
          { country: 'DE', name: 'No registration no.' },
        ],
      };
      const dry = await call({ ...body, dryRun: true });
      expect(dry._json).toMatchObject({ ok: 1, errors: 1, created: 1, skipped: 0 });
      expect(dry._json.results[1]).toMatchObject({ row: 2, ok: false, action: 'failed', code: 'BLANK_MATCH_KEY' });

      const res = await call(body);
      expect(res._json).toMatchObject({ ok: 1, errors: 1, created: 1, skipped: 0 });
      expect(res._json.results[1]).toMatchObject({ row: 2, ok: false, action: 'failed', code: 'BLANK_MATCH_KEY' });
      expect(await engine.find('supplier', {})).toHaveLength(1);
    });

    it('a set that matches more than one record fails the row with AMBIGUOUS_MATCH, as one key set does', async () => {
      await engine.insert('supplier', { id: 'a', country: 'DE', registration_no: 'HRB1', name: 'One' });
      await engine.insert('supplier', { id: 'b', country: 'DE', registration_no: 'HRB1', name: 'Two' });
      const res = await call({
        format: 'json', writeMode: 'upsert', matchFields: keySets,
        rows: [{ country: 'DE', registration_no: 'HRB1', name: 'Which?' }],
      });
      expect(res._json).toMatchObject({ ok: 0, errors: 1 });
      expect(res._json.results[0]).toMatchObject({ ok: false, action: 'failed', code: 'AMBIGUOUS_MATCH' });
    });

    it('skipBlankMatchKey with key sets refuses the request with 400 INVALID_REQUEST before any row', async () => {
      const res = await call({
        format: 'json', writeMode: 'upsert', matchFields: keySets, skipBlankMatchKey: true,
        rows: [{ credit_code: 'C1', name: 'Domestic' }],
      });
      expect(res._status).toBe(400);
      expect(res._json.code).toBe('INVALID_REQUEST');
      expect(await engine.find('supplier', {})).toHaveLength(0);
    });

    it.each([
      ['an empty set', [['credit_code'], []]],
      ['an empty name', [['credit_code'], ['country', '']]],
      ['a non-string name', [['credit_code'], ['country', 7]]],
      ['names mixed with sets', ['credit_code', ['country', 'registration_no']]],
    ])('malformed key sets (%s) refuse the request with 400 INVALID_REQUEST', async (_label, matchFields) => {
      const res = await call({
        format: 'json', writeMode: 'upsert', matchFields,
        rows: [{ credit_code: 'C1', name: 'Domestic' }],
      });
      expect(res._status).toBe(400);
      expect(res._json.code).toBe('INVALID_REQUEST');
      expect(await engine.find('supplier', {})).toHaveLength(0);
    });

    it('control: one key set keeps its blank handling — upsert creates a blank-key row, update and skipBlankMatchKey skip it', async () => {
      const rows = [{ name: 'No credit code' }];
      const upsert = await call({ format: 'json', writeMode: 'upsert', matchFields: ['credit_code'], rows });
      expect(upsert._json).toMatchObject({ ok: 1, created: 1, errors: 0 });

      const update = await call({ format: 'json', writeMode: 'update', matchFields: ['credit_code'], rows });
      expect(update._json.results[0]).toMatchObject({ ok: true, action: 'skipped', code: 'BLANK_MATCH_KEY' });

      const skip = await call({ format: 'json', writeMode: 'upsert', matchFields: ['credit_code'], skipBlankMatchKey: true, rows });
      expect(skip._json.results[0]).toMatchObject({ ok: true, action: 'skipped', code: 'BLANK_MATCH_KEY' });
      expect(await engine.find('supplier', {})).toHaveLength(1);
    });
  });
});
