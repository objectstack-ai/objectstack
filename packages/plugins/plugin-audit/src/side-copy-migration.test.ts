// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The at-rest rewrite of the columns `side-copy-columns.ts` lists, run end to
 * end: the paged runner against a fake engine, then the archive run through a
 * real SQL driver. The rows are shaped as the writer stored them before it
 * omitted the column: a create, an update and a delete, on all four copy sides
 * (`new_value`, `old_value`, and the two halves of `sys_activity.metadata`).
 * The planners themselves are pinned in `side-copy-columns.test.ts`.
 *
 * ⛔ The value here is a sentinel, and no title or message names one.
 */

import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
// [engine-double-contract] A fake engine's update must refuse exactly what
// ObjectQL refuses, as in `key-material-copy-migration.test.ts`.
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { SysAuditLog } from './objects/sys-audit-log.object.js';
import {
  migrateArchivedSideCopies,
  migrateSideCopies,
  type SideCopyMigrationEngine,
} from './side-copy-migration.js';

type Row = Record<string, unknown>;

const LISTED = 'sys_approval_request';
const HELD = 'side-copy-sentinel';

/** A listed row as the writer copied it whole, before it omitted the column. */
const requestRow = (id: string, status: string, held = true): Row => ({
  id,
  process_name: 'expense',
  status,
  ...(held ? { payload_json: JSON.stringify({ note: HELD }) } : {}),
});

const auditRows = (): Row[] => [
  { id: 'al_1', object_name: LISTED, action: 'create', record_id: 'r_1', updated_at: '2026-11-01T00:00:00.000Z', old_value: null, new_value: JSON.stringify(requestRow('r_1', 'pending')) },
  { id: 'al_2', object_name: LISTED, action: 'update', record_id: 'r_1', old_value: JSON.stringify(requestRow('r_1', 'pending')), new_value: JSON.stringify(requestRow('r_1', 'approved')) },
  { id: 'al_3', object_name: LISTED, action: 'delete', record_id: 'r_1', old_value: JSON.stringify(requestRow('r_1', 'approved')), new_value: null },
  // A listed update that never carried the column: never touched.
  { id: 'al_4', object_name: LISTED, action: 'update', record_id: 'r_2', old_value: JSON.stringify({ status: 'pending' }), new_value: JSON.stringify({ status: 'rejected' }) },
  // Not a listed object: never touched, whatever its columns are called.
  { id: 'al_5', object_name: 'crm_note', action: 'create', record_id: 'n_1', old_value: null, new_value: JSON.stringify({ id: 'n_1', payload_json: HELD }) },
];

const TEXT_SOURCES = { summary: ['process_name'] };

const activityRows = (): Row[] => [
  { id: 'ac_1', object_name: LISTED, record_id: 'r_1', summary: 'Created', metadata: JSON.stringify({ old: null, new: requestRow('r_1', 'pending'), _textSources: TEXT_SOURCES }) },
  { id: 'ac_2', object_name: LISTED, record_id: 'r_2', summary: 'Updated', metadata: JSON.stringify({ old: { status: 'pending' }, new: { status: 'rejected' } }) },
  { id: 'ac_3', object_name: 'crm_note', record_id: 'n_1', summary: 'Created', metadata: JSON.stringify({ old: null, new: { payload_json: HELD } }) },
];

/** Rows of the listed object that still hold the sentinel. */
const heldCopies = (rows: Row[]): number =>
  rows.filter((r) => r.object_name === LISTED && JSON.stringify(r).includes(HELD)).length;

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

describe('migrateSideCopies (driven, paged)', () => {
  function fakeEngine(tables: Record<string, Row[]>) {
    const writes: Array<{ object: string; data: Row; context: unknown }> = [];
    const engine: SideCopyMigrationEngine = {
      async find(object, query) {
        const q = (query ?? {}) as { where?: any; limit?: number };
        const rows = (tables[object] ?? [])
          .filter((r) => matchesWhere(r, q.where ?? {}))
          .sort((a, b) => String(a.id).localeCompare(String(b.id)));
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
    return { engine, writes };
  }
  const logger = () => ({ info: vi.fn(), warn: vi.fn() });

  it('a dry run counts the listed copies holding the column and writes nothing', async () => {
    const tables = { sys_audit_log: auditRows(), sys_activity: activityRows() };
    const before = JSON.stringify(tables);
    const { engine, writes } = fakeEngine(tables);
    const report = await migrateSideCopies(engine, logger());
    expect(report).toEqual({
      apply: false,
      byObject: { sys_audit_log: { scanned: 4, rewritten: 3, refused: 0 }, sys_activity: { scanned: 2, rewritten: 1, refused: 0 } },
      scanned: 6,
      rewritten: 4,
      refused: 0,
      failures: 0,
    });
    expect(writes).toHaveLength(0);
    expect(JSON.stringify(tables)).toBe(before);
  });

  it('apply leaves no listed copy holding the column, moves no other key, column or row, and a re-run is a no-op', async () => {
    const tables = { sys_audit_log: auditRows(), sys_activity: activityRows() };
    expect(heldCopies([...tables.sys_audit_log, ...tables.sys_activity])).toBe(4);
    const { engine, writes } = fakeEngine(tables);
    const log = logger();
    const report = await migrateSideCopies(engine, log, { apply: true, pageSize: 2 });
    expect(report.rewritten).toBe(4);
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
    const { payload_json: _omitted, ...kept } = requestRow('r_1', 'pending');
    expect(JSON.parse(String(tables.sys_audit_log[0]!.new_value))).toEqual(kept);
    const pair = JSON.parse(String(tables.sys_activity[0]!.metadata));
    expect(pair.new).toEqual(kept);
    expect(pair._textSources).toEqual(TEXT_SOURCES);
    expect(tables.sys_audit_log[3]).toEqual(auditRows()[3]);
    expect(tables.sys_audit_log[4]).toEqual(auditRows()[4]);
    expect(tables.sys_activity[2]).toEqual(activityRows()[2]);
    expect(writes[0]!.data.updated_at).toBe('2026-11-01T00:00:00.000Z');
    expect(writes.every((w) => isDeepStrictEqual(w.context, { isSystem: true, preserveAudit: true }))).toBe(true);
    const lines = [...log.info.mock.calls, ...log.warn.mock.calls].flat().join('\n');
    expect(lines).not.toContain(HELD);

    const after = JSON.stringify(tables);
    const again = await migrateSideCopies(engine, logger(), { apply: true, pageSize: 2 });
    expect(again.rewritten).toBe(0);
    expect(again.scanned).toBe(6);
    expect(JSON.stringify(tables)).toBe(after);
  });

  it('walks only the tables `objects` names', async () => {
    const tables = { sys_audit_log: auditRows(), sys_activity: activityRows() };
    const { engine } = fakeEngine(tables);
    const report = await migrateSideCopies(engine, logger(), { apply: true, objects: ['sys_activity'] });
    expect(report.rewritten).toBe(1);
    expect(tables.sys_audit_log).toEqual(auditRows());
  });
});

describe('migrateArchivedSideCopies (an archive datasource, through its driver)', () => {
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

  it('apply leaves no archived listed copy holding the column, moves nothing else, and a re-run changes no byte', async () => {
    const cold = await archiveStore(auditRows());
    const before = new Map((await allRows(cold)).map((r) => [r.id, r]));
    expect(heldCopies([...before.values()])).toBe(3);
    const report = await migrateArchivedSideCopies(cold, logger(), { apply: true, pageSize: 2, objects: ['sys_audit_log'] });
    expect(report.rewritten).toBe(3);
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
    expect(created).not.toHaveProperty('payload_json');
    expect(created.status).toBe('pending');
    expect(after.find((r) => r.id === 'al_5')).toEqual(before.get('al_5'));

    const again = await migrateArchivedSideCopies(cold, logger(), { apply: true, objects: ['sys_audit_log'] });
    expect(again.rewritten).toBe(0);
    expect(isDeepStrictEqual(await allRows(cold), after)).toBe(true);
  });
});
