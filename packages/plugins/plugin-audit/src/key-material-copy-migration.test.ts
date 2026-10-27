// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The at-rest rewrite of the key-material columns the audit writer copied into
 * the ledger before it omitted them — pure planners, then the paged runner
 * against a fake engine, then the archive run through a real SQL driver. The
 * rows are shaped as the writer stored them: a create, a rotation and a delete,
 * on all four snapshot sides (`new_value`, `old_value`, and the two halves of
 * `sys_activity.metadata`).
 *
 * ⛔ The material here is a sentinel, never real cipher text, and no title or
 * message names one.
 */

import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
// [engine-double-contract] A fake engine's update must refuse exactly what
// ObjectQL refuses — opened with the producer's own predicate, the shape
// `mail-log-body-migration.test.ts` takes.
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { omitKeyMaterialFromCopy } from './key-material-copy.js';
import { SysAuditLog } from './objects/sys-audit-log.object.js';
import {
  migrateArchivedKeyMaterialCopies,
  migrateKeyMaterialCopies,
  planKeyMaterialActivityRowPatch,
  planKeyMaterialAuditRowPatch,
  type KeyMaterialMigrationEngine,
} from './key-material-copy-migration.js';

type Row = Record<string, unknown>;

const ONE = 'key-material-sentinel-one';
const TWO = 'key-material-sentinel-two';

/** A secret-store row as the writer copied it whole. */
const storeRow = (id: string, material: string, version = 1): Row => ({
  id,
  namespace: 'mail',
  key: 'api_key',
  kms_key_id: 'local',
  alg: 'aes-256-gcm',
  version,
  ciphertext: material,
});

/** A settings-holder row as the writer copied it whole. */
const holderRow = (id: string, handle: string): Row => ({
  id,
  namespace: 'mail',
  key: 'api_key',
  value: null,
  encrypted: true,
  value_enc: handle,
});

const auditRows = (): Row[] => [
  { id: 'al_1', object_name: 'sys_secret', action: 'create', record_id: 's_1', updated_at: '2026-10-19T00:00:00.000Z', old_value: null, new_value: JSON.stringify(storeRow('s_1', ONE)) },
  { id: 'al_2', object_name: 'sys_secret', action: 'update', record_id: 's_1', old_value: JSON.stringify({ version: 1, ciphertext: ONE }), new_value: JSON.stringify({ version: 2, ciphertext: TWO }) },
  { id: 'al_3', object_name: 'sys_secret', action: 'delete', record_id: 's_1', old_value: JSON.stringify(storeRow('s_1', TWO, 2)), new_value: null },
  { id: 'al_4', object_name: 'sys_platform_setting', action: 'update', record_id: 'p_1', old_value: JSON.stringify({ value_enc: ONE }), new_value: JSON.stringify({ value_enc: TWO }) },
  { id: 'al_5', object_name: 'sys_setting', action: 'create', record_id: 't_1', old_value: null, new_value: JSON.stringify(holderRow('t_1', ONE)) },
  // A settings update with no material: never touched.
  { id: 'al_6', object_name: 'sys_platform_setting', action: 'update', record_id: 'p_2', old_value: JSON.stringify({ value: 'a' }), new_value: JSON.stringify({ value: 'b' }) },
  // Not a listed object: never touched, whatever its columns are called.
  { id: 'al_7', object_name: 'crm_note', action: 'create', record_id: 'n_1', old_value: null, new_value: JSON.stringify({ id: 'n_1', ciphertext: ONE }) },
];

const TEXT_SOURCES = { summary: ['key'], record_label: ['key'] };

const activityRows = (): Row[] => [
  { id: 'ac_1', object_name: 'sys_secret', record_id: 's_1', summary: 'Created', metadata: JSON.stringify({ old: null, new: storeRow('s_1', ONE), _textSources: TEXT_SOURCES }) },
  { id: 'ac_2', object_name: 'sys_secret', record_id: 's_1', summary: 'Deleted', metadata: JSON.stringify({ old: storeRow('s_1', TWO, 2), new: null, _textSources: TEXT_SOURCES }) },
  { id: 'ac_3', object_name: 'sys_platform_setting', record_id: 'p_2', summary: 'Updated', metadata: JSON.stringify({ old: { value: 'a' }, new: { value: 'b' } }) },
  { id: 'ac_4', object_name: 'crm_note', record_id: 'n_1', summary: 'Created', metadata: JSON.stringify({ old: null, new: { ciphertext: ONE } }) },
];

/** Rows of a listed object that still hold a sentinel. */
const heldCopies = (rows: Row[]): number =>
  rows.filter((r) => r.object_name !== 'crm_note' && /key-material-sentinel/.test(JSON.stringify(r))).length;

describe('omitKeyMaterialFromCopy — the writer\'s rule, the rewrite\'s rule', () => {
  it('removes the listed column, keeps every other key, and invents none', () => {
    const copy: Row = { namespace: 'mail', version: 1, ciphertext: ONE };
    expect(omitKeyMaterialFromCopy('sys_secret', copy)).toBe(true);
    expect(copy).toEqual({ namespace: 'mail', version: 1 });
    const holder: Row = { encrypted: true };
    expect(omitKeyMaterialFromCopy('sys_setting', holder)).toBe(false);
    expect(holder).toEqual({ encrypted: true });
  });

  it('is a no-op on any other object', () => {
    const other: Row = { ciphertext: ONE, value_enc: TWO };
    expect(omitKeyMaterialFromCopy('crm_note', other)).toBe(false);
    expect(other).toEqual({ ciphertext: ONE, value_enc: TWO });
  });
});

describe('planKeyMaterialAuditRowPatch', () => {
  it('removes the material from a create, both halves of a rotation and a delete, keeping every other key', () => {
    const rows = auditRows();
    const create = planKeyMaterialAuditRowPatch(rows[0]!)!;
    expect(Object.keys(create)).toEqual(['new_value']);
    const { ciphertext: _dropped, ...kept } = storeRow('s_1', ONE);
    expect(create.new_value).toBe(JSON.stringify(kept));
    const rotation = planKeyMaterialAuditRowPatch(rows[1]!)!;
    expect(JSON.parse(String(rotation.old_value))).toEqual({ version: 1 });
    expect(JSON.parse(String(rotation.new_value))).toEqual({ version: 2 });
    expect(Object.keys(planKeyMaterialAuditRowPatch(rows[2]!)!)).toEqual(['old_value']);
    expect(JSON.parse(String(planKeyMaterialAuditRowPatch(rows[3]!)!.new_value))).toEqual({});
    expect(JSON.parse(String(planKeyMaterialAuditRowPatch(rows[4]!)!.new_value))).not.toHaveProperty('value_enc');
  });

  it('leaves a material-free row and another object\'s row alone, and is idempotent', () => {
    const rows = auditRows();
    expect(planKeyMaterialAuditRowPatch(rows[5]!)).toBeNull();
    expect(planKeyMaterialAuditRowPatch(rows[6]!)).toBeNull();
    const once = { ...rows[0]!, ...planKeyMaterialAuditRowPatch(rows[0]!) };
    expect(planKeyMaterialAuditRowPatch(once)).toBeNull();
  });
});

describe('planKeyMaterialActivityRowPatch', () => {
  it('removes the material from each half and keeps the pair\'s other keys', () => {
    const [created, deleted] = activityRows();
    const a = JSON.parse(String(planKeyMaterialActivityRowPatch(created!)!.metadata));
    expect(a._textSources).toEqual(TEXT_SOURCES);
    expect(a.old).toBeNull();
    expect(a.new).not.toHaveProperty('ciphertext');
    expect(a.new.namespace).toBe('mail');
    const d = JSON.parse(String(planKeyMaterialActivityRowPatch(deleted!)!.metadata));
    expect(d.old).not.toHaveProperty('ciphertext');
    expect(d.old.version).toBe(2);
  });

  it('leaves a material-free pair, another object\'s row and a rewritten row alone', () => {
    const rows = activityRows();
    expect(planKeyMaterialActivityRowPatch(rows[2]!)).toBeNull();
    expect(planKeyMaterialActivityRowPatch(rows[3]!)).toBeNull();
    const once = { ...rows[0]!, ...planKeyMaterialActivityRowPatch(rows[0]!) };
    expect(planKeyMaterialActivityRowPatch(once)).toBeNull();
  });
});

/** The Filter Protocol subset the runner's page query speaks; anything else is refused. */
function matchesWhere(r: Row, w: Record<string, any>): boolean {
  return Object.entries(w).every(([key, cond]) => {
    if (key === '$and') return (cond as Record<string, any>[]).every((c) => matchesWhere(r, c));
    if (key.startsWith('$')) throw new Error(`fake engine: combinator ${key} is not implemented`);
    if (cond && typeof cond === 'object') {
      const ops = Object.keys(cond);
      if (ops.length !== 1 || !['$in', '$gt'].includes(ops[0]!)) {
        throw new Error(`fake engine: operator ${ops.join(',')} is not implemented`);
      }
      if ('$in' in cond) return (cond.$in as unknown[]).includes(r[key]);
      return String(r[key]) > String(cond.$gt);
    }
    return r[key] === cond;
  });
}

describe('migrateKeyMaterialCopies (driven, paged)', () => {
  function fakeEngine(tables: Record<string, Row[]>, opts: { failRead?: string } = {}) {
    const reads: Array<{ object: string; limit: unknown }> = [];
    const writes: Array<{ object: string; data: Row; context: unknown }> = [];
    const engine: KeyMaterialMigrationEngine = {
      async find(object, query) {
        if (object === opts.failRead) throw new Error('read refused');
        const q = (query ?? {}) as { where?: any; limit?: number };
        reads.push({ object, limit: q.limit });
        const rows = (tables[object] ?? [])
          .filter((r) => matchesWhere(r, q.where ?? {}))
          .sort((a, b) => String(a.id).localeCompare(String(b.id)));
        // The caller's bound, applied AFTER the filter, by presence.
        const page = typeof q.limit === 'number' ? rows.slice(0, q.limit) : rows;
        return page.map((r) => ({ ...r }));
      },
      async update(object, data, options) {
        assertEngineUpdateDispatch(data, options === undefined ? undefined : { ...options });
        writes.push({ object, data: data as Row, context: (options as { context?: unknown } | undefined)?.context });
        const { id, ...rest } = data as Row;
        const row = (tables[object] ?? []).find((r) => r.id === id);
        if (row) Object.assign(row, rest);
        return { id, ...rest };
      },
    };
    return { engine, reads, writes };
  }
  const logger = () => ({ info: vi.fn(), warn: vi.fn() });

  it('a dry run counts the copies holding material and writes nothing', async () => {
    const tables = { sys_audit_log: auditRows(), sys_activity: activityRows() };
    const before = JSON.stringify(tables);
    const { engine } = fakeEngine(tables);
    const report = await migrateKeyMaterialCopies(engine, logger());
    expect(report).toEqual({
      apply: false,
      byObject: { sys_audit_log: { scanned: 6, rewritten: 5 }, sys_activity: { scanned: 3, rewritten: 2 } },
      scanned: 9,
      rewritten: 7,
      failures: 0,
    });
    expect(JSON.stringify(tables)).toBe(before);
  });

  it('apply leaves no copy holding material, moves no other column or row, and a re-run is a no-op', async () => {
    const tables = { sys_audit_log: auditRows(), sys_activity: activityRows() };
    expect(heldCopies([...tables.sys_audit_log, ...tables.sys_activity])).toBe(7);
    const { engine, writes } = fakeEngine(tables);
    const report = await migrateKeyMaterialCopies(engine, logger(), { apply: true, pageSize: 2 });
    expect(report.rewritten).toBe(7);
    expect(report.failures).toBe(0);
    expect(heldCopies([...tables.sys_audit_log, ...tables.sys_activity])).toBe(0);

    const originals = new Map([...auditRows(), ...activityRows()].map((r) => [r.id, r]));
    for (const row of [...tables.sys_audit_log, ...tables.sys_activity]) {
      const original = originals.get(row.id)!;
      for (const key of Object.keys(original)) {
        if (['new_value', 'old_value', 'metadata'].includes(key)) continue;
        expect(row[key], `${String(row.id)}.${key}`).toBe(original[key]);
      }
    }
    expect(tables.sys_audit_log[6]).toEqual(auditRows()[6]);
    expect(tables.sys_activity[3]).toEqual(activityRows()[3]);
    expect(writes[0]!.data.updated_at).toBe('2026-10-19T00:00:00.000Z');
    expect(writes.every((w) => isDeepStrictEqual(w.context, { isSystem: true, preserveAudit: true }))).toBe(true);

    const after = JSON.stringify(tables);
    const again = await migrateKeyMaterialCopies(engine, logger(), { apply: true, pageSize: 2 });
    expect(again.rewritten).toBe(0);
    expect(again.scanned).toBe(9);
    expect(JSON.stringify(tables)).toBe(after);
  });

  it('a table it cannot read is a failure, never a clean report, and no log line names a value', async () => {
    const tables = { sys_audit_log: auditRows(), sys_activity: activityRows() };
    const { engine } = fakeEngine(tables, { failRead: 'sys_activity' });
    const log = logger();
    const report = await migrateKeyMaterialCopies(engine, log, { apply: true });
    expect(report.failures).toBe(1);
    expect(report.byObject.sys_audit_log!.rewritten).toBe(5);
    const lines = [...log.info.mock.calls, ...log.warn.mock.calls].flat().join('\n');
    expect(lines).not.toMatch(/key-material-sentinel/);
  });
});

describe('migrateArchivedKeyMaterialCopies (an archive datasource, through its driver)', () => {
  async function archiveStore(rows: Row[]): Promise<SqliteWasmDriver> {
    const cold = new SqliteWasmDriver({ filename: ':memory:' });
    await cold.connect();
    await cold.syncSchema('sys_audit_log', SysAuditLog);
    for (const row of rows) await cold.upsert('sys_audit_log', row, ['id']);
    return cold;
  }
  const allRows = async (cold: SqliteWasmDriver): Promise<Row[]> =>
    (await cold.find('sys_audit_log', { orderBy: [{ field: 'id', order: 'asc' }] })).map((r) => ({ ...r }));
  const logger = () => ({ info: vi.fn(), warn: vi.fn() });

  it('apply leaves no archived copy holding material, moves nothing else, and a re-run changes no byte', async () => {
    const cold = await archiveStore(auditRows());
    const before = new Map((await allRows(cold)).map((r) => [r.id, r]));
    expect(heldCopies([...before.values()])).toBe(5);
    const report = await migrateArchivedKeyMaterialCopies(cold, logger(), { apply: true, pageSize: 2, objects: ['sys_audit_log'] });
    expect(report.rewritten).toBe(5);
    expect(report.failures).toBe(0);

    const after = await allRows(cold);
    expect(heldCopies(after)).toBe(0);
    for (const row of after) {
      const original = before.get(row.id)!;
      for (const key of Object.keys(original)) {
        if (key === 'new_value' || key === 'old_value') continue;
        expect(row[key], `${String(row.id)}.${key}`).toEqual(original[key]);
      }
    }
    const created = JSON.parse(String(after.find((r) => r.id === 'al_1')!.new_value));
    expect(created).not.toHaveProperty('ciphertext');
    expect(created.kms_key_id).toBe('local');
    expect(after.find((r) => r.id === 'al_7')).toEqual(before.get('al_7'));

    const again = await migrateArchivedKeyMaterialCopies(cold, logger(), { apply: true, objects: ['sys_audit_log'] });
    expect(again.rewritten).toBe(0);
    expect(isDeepStrictEqual(await allRows(cold), after)).toBe(true);
  });

  it('an archive table nothing was archived into yet reads as no rows, never a failure', async () => {
    const cold = new SqliteWasmDriver({ filename: ':memory:' });
    await cold.connect();
    const report = await migrateArchivedKeyMaterialCopies(cold, logger(), { apply: true, objects: ['sys_audit_log'] });
    expect(report).toEqual({ apply: true, byObject: { sys_audit_log: { scanned: 0, rewritten: 0 } }, scanned: 0, rewritten: 0, failures: 0 });
  });
});
