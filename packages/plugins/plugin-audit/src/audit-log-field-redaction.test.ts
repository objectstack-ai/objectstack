// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21155] The compliance ledger's before/after snapshots, served to a reader
 * the security service answers may not read a field of the parent record.
 *
 * The CRUD mirror (`audit-writers.ts`) writes one `sys_audit_log` row per
 * record write, once, as the system; its snapshot columns carry the parent
 * record's field values. Every door onto the ledger lists it through the
 * engine, so the narrowing lives on the engine's read middleware and is
 * pinned here through the real chain.
 *
 * ## Why a real engine, a real driver and the real plugin
 *
 * The rows are written by the real audit writer and read back through the real
 * engine middleware chain, with the redaction mounted by `AuditPlugin` itself
 * at `kernel:ready` — a seam that stops being mounted fails here like one that
 * was never written.
 *
 * ## The one stand-in
 *
 * The security service. It answers the two contract members the redaction
 * asks (`getReadableFields`, `getQueryableFields`) per reader, in the shape
 * the contract defines: a field served MASKED is readable and not queryable; a
 * field not served is in neither. Which declaration produces which answer is
 * the security plugin's derivation, pinned on a real boot in the dogfood suite
 * (`audit-log-field-values.dogfood.test.ts`); here the double stands in for it
 * so every fail-closed branch is reachable.
 *
 * ## Rows no non-system door serves
 *
 * [#21175] The ledger's parent-record read gate (`audit-log-read-visibility.ts`)
 * composes on the same chain: a row about a record that no longer exists — the
 * `delete` row, and the deleted record's other rows — or one naming a record
 * the gate cannot judge is not served to any caller that is not system
 * context. What the redaction does with such a row is therefore pinned on the
 * seam's own function ({@link redactAuditLogRows}) over the row at rest, and
 * the read path pins that it is not served at all.
 *
 * ⚠️ Disclosure discipline: no test title states a value.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import type { EngineQueryOptions } from '@objectstack/spec/data';

import { AuditPlugin } from './audit-plugin.js';
import { redactAuditLogRows } from './audit-log-field-redaction.js';

const LEDGER = 'sys_audit_log';
const ITEM = 'alr_item';
const HARNESS_PACKAGE = 'com.objectstack.audit.test.audit-log-field-redaction';

const SYS = { isSystem: true } as const;
/** A field of the item is served to this reader MASKED. */
const MASKED_READER = { userId: 'u_masked', tenantId: 'org_1', positions: ['org_member'] };
/** A field of the item is not served to this reader. */
const UNSERVED_READER = { userId: 'u_unserved', tenantId: 'org_1', positions: ['org_member'] };
/** Served every field — the control. */
const CONTROL = { userId: 'u_control', tenantId: 'org_1', positions: ['org_member'] };
/** The security service answers nothing about masking for this reader. */
const NO_QUERYABLE_READER = { userId: 'u_noq', tenantId: 'org_1', positions: ['org_member'] };
/** The security service answers this reader in a shape the contract does not define. */
const MALFORMED_READER = { userId: 'u_malformed', tenantId: 'org_1', positions: ['org_member'] };

/** Synthetic values, one per field per version, and one per field of the deleted record. */
const V = {
  masked1: 'ALRMASKEDONE31', masked2: 'ALRMASKEDTWO32', maskedDel: 'ALRMASKEDDEL33',
  unserved1: 'ALRUNSERVEDONE34', unserved2: 'ALRUNSERVEDTWO35', unservedDel: 'ALRUNSERVEDDEL36',
  open1: 'ALROPENONE37', open2: 'ALROPENTWO38', openDel: 'ALROPENDEL39',
  foreign: 'ALRFOREIGN40',
};
const MASKED_VALUES = [V.masked1, V.masked2, V.maskedDel];
const UNSERVED_VALUES = [V.unserved1, V.unserved2, V.unservedDel];
const OPEN_VALUES = [V.open1, V.open2, V.openDel];

const itemObject = {
  name: ITEM,
  label: 'Ledger Redaction Item',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' as const },
    f_masked: { name: 'f_masked', label: 'Masked', type: 'text' as const },
    f_unserved: { name: 'f_unserved', label: 'Unserved', type: 'text' as const },
    f_open: { name: 'f_open', label: 'Open', type: 'text' as const },
  },
};

type Row = Record<string, any>;
const snap = (row: Row | undefined, col: 'old_value' | 'new_value') =>
  typeof row?.[col] === 'string' ? JSON.parse(row[col]) : row?.[col];

describe('[#21155] sys_audit_log before/after snapshots are served through the security service answer', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  const ids: Record<'live' | 'deleted', string> = { live: '', deleted: '' };
  const rowIds: Record<'created' | 'updated' | 'deleted' | 'config' | 'roster' | 'opaque' | 'orphan' | 'foreign', string> =
    {} as never;

  /** All fields of `object`: `id` plus the engine registry's field map — the
   * universe the security plugin answers over. */
  const allFields = (object: string): string[] | undefined => {
    const schema = (engine as any).getSchema(object);
    return schema ? ['id', ...Object.keys((schema.fields ?? {}) as Record<string, unknown>)] : undefined;
  };

  /** The double: the two contract members, answered per reader. */
  const security = {
    async getReadableFields(object: string, context?: any): Promise<string[] | undefined> {
      const all = allFields(object);
      if (!all) return undefined;
      if (context?.isSystem) return all;
      if (context?.userId === UNSERVED_READER.userId && object === ITEM) return all.filter((f) => f !== 'f_unserved');
      return all;
    },
    async getQueryableFields(object: string, context?: any): Promise<string[] | undefined> {
      const readable = (await security.getReadableFields(object, context)) ?? [];
      if (context?.userId === NO_QUERYABLE_READER.userId) return undefined;
      if (context?.userId === MALFORMED_READER.userId) return { not: 'a list' } as never;
      if (context?.userId === MASKED_READER.userId && object === ITEM) return readable.filter((f) => f !== 'f_masked');
      return readable;
    },
  };

  const read = (context: EngineQueryOptions['context'], extra: EngineQueryOptions = {}) =>
    engine.find(LEDGER, { orderBy: [{ field: 'created_at', order: 'asc' }], context, ...extra }) as Promise<Row[]>;
  const byId = (rows: Row[], key: keyof typeof rowIds) => rows.find((r) => r.id === rowIds[key]);
  const mirrorRows = (rows: Row[]) => rows.filter((r) => [rowIds.created, rowIds.updated, rowIds.deleted].includes(r.id));
  /** The rows of the live record the read path serves a non-system reader. */
  const LIVE_MIRROR_ROWS = 2;
  /** One row as stored, through the redaction seam's own function, for `context`. */
  const redactedAtRest = async (key: keyof typeof rowIds, context: Record<string, unknown>): Promise<Row> => {
    const row = (await engine.findOne(LEDGER, { where: { id: rowIds[key] }, context: SYS })) as Row;
    expect(row?.id, `the ${key} row is at rest`).toBe(rowIds[key]);
    await redactAuditLogRows([row], security, context);
    return row;
  };

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use({
      name: 'test.security-double',
      version: '0.0.0',
      init: async (ctx: any) => ctx.registerService('security', security),
      start: async () => {},
    } as any);
    await kernel.use(new AuditPlugin());
    await kernel.bootstrap();

    engine = kernel.getService<ObjectQL>('objectql');
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    engine.registerDriver(driver, true);
    engine.registry.registerObject(itemObject as any, HARNESS_PACKAGE);
    await engine.syncSchemas();

    // Every record-write row below is written by the real audit writer's CRUD mirror.
    ids.live = (await engine.insert(
      ITEM,
      { name: 'item', f_masked: V.masked1, f_unserved: V.unserved1, f_open: V.open1 },
      { context: SYS },
    )).id;
    await engine.update(
      ITEM,
      { f_masked: V.masked2, f_unserved: V.unserved2, f_open: V.open2 },
      { where: { id: ids.live }, context: SYS },
    );
    ids.deleted = (await engine.insert(
      ITEM,
      { name: 'gone', f_masked: V.maskedDel, f_unserved: V.unservedDel, f_open: V.openDel },
      { context: SYS },
    )).id;
    await engine.delete(ITEM, { where: { id: ids.deleted }, context: SYS });

    const atRest = (await engine.find(LEDGER, { where: { object_name: ITEM }, context: SYS })) as Row[];
    const idOf = (pick: (r: Row) => boolean) => String(atRest.find(pick)?.id ?? '');
    rowIds.created = idOf((r) => r.action === 'create' && r.record_id === ids.live);
    rowIds.updated = idOf((r) => r.action === 'update' && r.record_id === ids.live);
    rowIds.deleted = idOf((r) => r.action === 'delete' && r.record_id === ids.deleted);

    // Rows other writers put on the ledger, in their writers' shapes: a
    // settings digest and an administrator roster (not a parent's field map),
    // and three record-write rows the mirror's own shape cannot judge.
    const stamp = new Date().toISOString();
    const extra: Array<[keyof typeof rowIds, Row]> = [
      ['config', { action: 'config_change', object_name: ITEM, new_value: JSON.stringify({ namespace: 'n', key: 'k', scope: 's', digest: 'd' }) }],
      ['roster', { action: 'platform_admin_standing_change', object_name: ITEM, old_value: null, new_value: JSON.stringify([{ entry: 'e', userId: null }]) }],
      ['opaque', { action: 'update', object_name: ITEM, record_id: ids.live, old_value: `not json ${V.unserved1}`, new_value: JSON.stringify([V.unserved2]) }],
      ['orphan', { action: 'update', object_name: null, record_id: ids.live, old_value: JSON.stringify({ f_unserved: V.unserved1 }) }],
      ['foreign', { action: 'create', object_name: 'alr_not_registered', record_id: 'x1', new_value: JSON.stringify({ any: V.foreign }) }],
    ];
    for (const [key, row] of extra) {
      rowIds[key] = String((await engine.insert(LEDGER, { ...row, created_at: stamp }, { context: SYS })).id);
    }
  }, 120_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    }
  }, 30_000);

  // ── the scene ───────────────────────────────────────────────────────────

  it('control: at rest, the create, update and delete snapshots carry every value this file reasons about', async () => {
    const rows = await read(SYS);
    for (const id of Object.values(rowIds)) expect(id).toBeTruthy();
    const blob = JSON.stringify(mirrorRows(rows));
    for (const v of [...MASKED_VALUES, ...UNSERVED_VALUES, ...OPEN_VALUES]) expect(blob).toContain(v);
    expect(snap(byId(rows, 'created'), 'new_value')).toHaveProperty('f_masked', V.masked1);
    expect(snap(byId(rows, 'updated'), 'old_value')).toHaveProperty('f_unserved', V.unserved1);
    expect(snap(byId(rows, 'deleted'), 'old_value')).toHaveProperty('f_unserved', V.unservedDel);
  });

  // ── a field served masked ───────────────────────────────────────────────

  it('masked: no ledger row served to the reader carries the stored value of a field it is served masked', async () => {
    const rows = mirrorRows(await read(MASKED_READER));
    expect(rows).toHaveLength(LIVE_MIRROR_ROWS);
    const blob = JSON.stringify([...rows, await redactedAtRest('deleted', MASKED_READER)]);
    for (const v of MASKED_VALUES) expect(blob).not.toContain(v);
  });

  it('masked: the create, update and delete snapshots keep the served fields and drop that field', async () => {
    const rows = await read(MASKED_READER);
    const created = snap(byId(rows, 'created'), 'new_value');
    expect(created).not.toHaveProperty('f_masked');
    expect(created).toHaveProperty('f_open', V.open1);
    expect(created).toHaveProperty('f_unserved', V.unserved1);
    for (const col of ['old_value', 'new_value'] as const) {
      const updated = snap(byId(rows, 'updated'), col);
      expect(updated).not.toHaveProperty('f_masked');
      expect(updated).toHaveProperty('f_open');
    }
    expect(byId(rows, 'deleted')).toBeUndefined();
    const deleted = snap(await redactedAtRest('deleted', MASKED_READER), 'old_value');
    expect(deleted).not.toHaveProperty('f_masked');
    expect(deleted).toHaveProperty('f_open', V.openDel);
  });

  // ── a field not served ──────────────────────────────────────────────────

  it('not served: no ledger row served to the reader carries a value of a field it may not read', async () => {
    const rows = mirrorRows(await read(UNSERVED_READER));
    expect(rows).toHaveLength(LIVE_MIRROR_ROWS);
    const blob = JSON.stringify([...rows, await redactedAtRest('deleted', UNSERVED_READER)]);
    for (const v of UNSERVED_VALUES) expect(blob).not.toContain(v);
  });

  it('not served: the field masked for another reader is not withheld from this one', async () => {
    const blob = JSON.stringify([...mirrorRows(await read(UNSERVED_READER)), await redactedAtRest('deleted', UNSERVED_READER)]);
    for (const v of [...MASKED_VALUES, ...OPEN_VALUES]) expect(blob).toContain(v);
  });

  // ── the control ─────────────────────────────────────────────────────────

  it('control: a reader served every field reads every snapshot byte-identical to the row at rest', async () => {
    const atRest = await read(SYS);
    const served = await read(CONTROL);
    for (const key of ['created', 'updated'] as const) {
      for (const col of ['old_value', 'new_value'] as const) {
        expect(byId(served, key)?.[col]).toBe(byId(atRest, key)?.[col]);
      }
    }
    const deleted = await redactedAtRest('deleted', CONTROL);
    expect(deleted.old_value).toBe(byId(atRest, 'deleted')?.old_value);
  });

  // ── the doors the ledger is read through ───────────────────────────────

  it('findOne: the by-id read is redacted like the list', async () => {
    const row = (await engine.findOne(LEDGER, { where: { id: rowIds.updated }, context: UNSERVED_READER })) as Row;
    expect(row?.id).toBe(rowIds.updated);
    expect(JSON.stringify(row)).not.toContain(V.unserved2);
    expect(snap(row, 'new_value')).toHaveProperty('f_open', V.open2);
  });

  it('a projection naming only the snapshot columns is redacted the same, and gains no column', async () => {
    const rows = await read(MASKED_READER, {
      where: { object_name: ITEM, record_id: ids.live },
      fields: ['id', 'old_value', 'new_value'],
    });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(rows)).not.toContain(V.masked2);
    for (const row of rows) {
      expect(row).not.toHaveProperty('object_name');
      expect(row).not.toHaveProperty('action');
    }
    expect(JSON.stringify(rows)).toContain(V.open2);
  });

  // ── rows the mirror did not write in its shape ─────────────────────────

  it('a row of another action is served as written: its snapshot is not a parent record field map', async () => {
    const rows = await read(UNSERVED_READER);
    expect(snap(byId(rows, 'config'), 'new_value')).toEqual({ namespace: 'n', key: 'k', scope: 's', digest: 'd' });
    expect(snap(byId(rows, 'roster'), 'new_value')).toEqual([{ entry: 'e', userId: null }]);
  });

  it('fail closed: a record-write snapshot that is not a JSON object is dropped whole', async () => {
    const row = byId(await read(UNSERVED_READER), 'opaque');
    expect(row).toBeTruthy();
    expect(row).not.toHaveProperty('old_value');
    expect(row).not.toHaveProperty('new_value');
  });

  it('fail closed: a record-write row naming no parent object loses its snapshots', async () => {
    expect(byId(await read(CONTROL), 'orphan')).toBeUndefined();
    const row = await redactedAtRest('orphan', CONTROL);
    expect(row).not.toHaveProperty('old_value');
  });

  it('fail closed: a reader the service cannot answer masking for keeps no snapshot field value', async () => {
    const rows = await read(NO_QUERYABLE_READER);
    const blob = JSON.stringify([...mirrorRows(rows), await redactedAtRest('deleted', NO_QUERYABLE_READER)]);
    for (const v of [...MASKED_VALUES, ...UNSERVED_VALUES, ...OPEN_VALUES]) expect(blob).not.toContain(v);
    expect(snap(byId(rows, 'updated'), 'new_value')).toEqual({});
  });

  it('fail closed: an answer the contract does not define strips every snapshot of the read', async () => {
    const rows = await read(MALFORMED_READER);
    expect(mirrorRows(rows)).toHaveLength(LIVE_MIRROR_ROWS);
    for (const row of rows) {
      expect(row).not.toHaveProperty('old_value');
      expect(row).not.toHaveProperty('new_value');
    }
  });

  it('no answer: a row about an object the security service cannot resolve is served as written', async () => {
    expect(byId(await read(UNSERVED_READER), 'foreign')).toBeUndefined();
    const row = await redactedAtRest('foreign', UNSERVED_READER);
    expect(JSON.stringify(row)).toContain(V.foreign);
  });

  it('a system read is not redacted', async () => {
    const blob = JSON.stringify(mirrorRows(await read(SYS)));
    for (const v of [V.masked2, V.unserved2, V.unservedDel]) expect(blob).toContain(v);
  });
});
