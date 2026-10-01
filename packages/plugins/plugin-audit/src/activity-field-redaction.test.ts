// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21081] An activity row's value-bearing columns, served to a reader the
 * security service answers may not read a field of the parent record.
 *
 * The CRUD mirror (`audit-writers.ts`) composes each `sys_activity` row once,
 * as the system, so its `summary`, `record_label` and `metadata` can carry
 * parent field values. The read gate (`activity-read-visibility.ts`) keeps a
 * row for every reader who can read the parent record, so the row's TEXT is
 * what this file is about: a field the reader may not read, or is served
 * masked, does not reach the reader through it.
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
 * field not served is in neither. Which declaration produces which answer
 * (a `maskingRule`, `requiredPermissions`, a permission set) is the security
 * plugin's derivation and is pinned on a real boot in the dogfood suite
 * (`activity-field-values.dogfood.test.ts`); here the double stands in for it
 * so every fail-closed branch is reachable.
 *
 * ⚠️ Disclosure discipline: no test title states a value.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import type { EngineQueryOptions } from '@objectstack/spec/data';

import { AuditPlugin } from './audit-plugin.js';
import { resolveServedFields } from './activity-field-redaction.js';

const ACTIVITY = 'sys_activity';
const ITEM = 'afr_item';
const LABELLED = 'afr_label';
const HARNESS_PACKAGE = 'com.objectstack.audit.test.activity-field-redaction';

const SYS = { isSystem: true } as const;
/** A field of the item is served to this reader MASKED. */
const MASKED_READER = { userId: 'u_masked', tenantId: 'org_1', positions: ['org_member'] };
/** A field of the item, and the labelled object's title, are not served to this reader. */
const UNSERVED_READER = { userId: 'u_unserved', tenantId: 'org_1', positions: ['org_member'] };
/** Served every field — the control. */
const CONTROL = { userId: 'u_control', tenantId: 'org_1', positions: ['org_member'] };
/** The security service answers nothing about masking for this reader. */
const NO_QUERYABLE_READER = { userId: 'u_noq', tenantId: 'org_1', positions: ['org_member'] };

/** Synthetic values, one per field per version. */
const V = {
  masked1: 'AFRMASKEDONE91', masked2: 'AFRMASKEDTWO92',
  unserved1: 'AFRUNSERVEDONE93', unserved2: 'AFRUNSERVEDTWO94',
  open1: 'AFROPENONE95', open2: 'AFROPENTWO96', open3: 'AFROPENTHREE97',
  title: 'AFRTITLE98',
};

const itemObject = {
  name: ITEM,
  label: 'Redaction Item',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' as const },
    stage: {
      name: 'stage', label: 'Stage', type: 'select' as const,
      options: [{ label: 'Open', value: 'open' }, { label: 'Won', value: 'won' }],
    },
    f_masked: { name: 'f_masked', label: 'Masked', type: 'text' as const, trackHistory: true },
    f_unserved: { name: 'f_unserved', label: 'Unserved', type: 'text' as const, trackHistory: true },
    f_open: { name: 'f_open', label: 'Open', type: 'text' as const, trackHistory: true },
  },
  activityMilestones: [{ field: 'stage', value: 'won', summary: 'Won {f_masked} {f_open}' }],
};
const labelledObject = {
  name: LABELLED,
  label: 'Redaction Labelled',
  fields: { title: { name: 'title', label: 'Title', type: 'text' as const } },
};

type Row = Record<string, any>;

describe('[#21081] sys_activity value-bearing columns are served through the security service answer', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  const ids: Record<string, string> = {};

  /** All fields of `object`, as the engine registry holds them. */
  const allFields = (object: string): string[] =>
    Object.keys(((engine as any).getSchema(object)?.fields ?? {}) as Record<string, unknown>);

  /** The double: the two contract members, answered per reader. */
  const security = {
    async getReadableFields(object: string, context?: any): Promise<string[] | undefined> {
      const all = allFields(object);
      if (context?.isSystem) return all;
      if (context?.userId === UNSERVED_READER.userId) {
        if (object === ITEM) return all.filter((f) => f !== 'f_unserved');
        if (object === LABELLED) return all.filter((f) => f !== 'title');
      }
      return all;
    },
    async getQueryableFields(object: string, context?: any): Promise<string[] | undefined> {
      const readable = (await security.getReadableFields(object, context)) ?? [];
      if (context?.userId === NO_QUERYABLE_READER.userId) return undefined;
      if (context?.userId === MASKED_READER.userId && object === ITEM) return readable.filter((f) => f !== 'f_masked');
      return readable;
    },
  };

  const read = (context: EngineQueryOptions['context'], extra: EngineQueryOptions = {}) =>
    engine.find(ACTIVITY, {
      where: { object_name: ITEM, record_id: ids.item },
      orderBy: [{ field: 'timestamp', order: 'asc' }],
      context,
      ...extra,
    }) as Promise<Row[]>;

  /** The mirror rows about the item, classified ONCE from the at-rest read
   * (a reader's own copy may have had the very keys the classification reads
   * redacted), then looked up by id in whatever rows a reader was served. */
  const rowIds: Record<'created' | 'allTracked' | 'openOnly' | 'milestone', string> = {} as never;
  const byChange = (rows: Row[]) => {
    const byId = (id: string) => rows.find((r) => r.id === id);
    return {
      created: byId(rowIds.created),
      allTracked: byId(rowIds.allTracked),
      openOnly: byId(rowIds.openOnly),
      milestone: byId(rowIds.milestone),
    };
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
    engine.registry.registerObject(labelledObject as any, HARNESS_PACKAGE);
    await engine.syncSchemas();

    // Every row below is written by the real audit writer's CRUD mirror.
    ids.item = (await engine.insert(
      ITEM,
      { name: 'item', stage: 'open', f_masked: V.masked1, f_unserved: V.unserved1, f_open: V.open1 },
      { context: SYS },
    )).id;
    await engine.update(
      ITEM,
      { f_masked: V.masked2, f_unserved: V.unserved2, f_open: V.open2 },
      { where: { id: ids.item }, context: SYS },
    );
    await engine.update(ITEM, { f_open: V.open3 }, { where: { id: ids.item }, context: SYS });
    await engine.update(ITEM, { stage: 'won' }, { where: { id: ids.item }, context: SYS });
    ids.labelled = (await engine.insert(LABELLED, { title: V.title }, { context: SYS })).id;

    // Rows the CRUD mirror did not write with a provenance declaration: one in
    // the mirror's earlier shape, and two an app's own server action writes.
    const stamp = new Date().toISOString();
    const meta = (r: Row) => (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : null);
    const mirrorRows = (await engine.find(ACTIVITY, { where: { object_name: ITEM }, context: SYS })) as Row[];
    const idOf = (pick: (r: Row) => boolean) => String(mirrorRows.find(pick)?.id ?? '');
    rowIds.created = idOf((r) => r.type === 'created');
    rowIds.allTracked = idOf((r) => r.type === 'updated' && 'f_unserved' in (meta(r)?.new ?? {}));
    rowIds.openOnly = idOf((r) => r.type === 'updated' && Object.keys(meta(r)?.new ?? {}).join() === 'f_open');
    rowIds.milestone = idOf((r) => r.type === 'updated' && 'stage' in (meta(r)?.new ?? {}));

    for (const row of [
      {
        type: 'updated', summary: 'earlier mirror row', record_label: 'earlier label',
        metadata: JSON.stringify({ old: { f_unserved: V.unserved1 }, new: { f_unserved: V.unserved2 } }),
      },
      { type: 'note', summary: 'app row with context', metadata: JSON.stringify({ channel: 'email' }) },
      { type: 'note', summary: 'app row without context' },
    ]) {
      await engine.insert(ACTIVITY, { ...row, object_name: ITEM, record_id: ids.item, timestamp: stamp }, { context: SYS });
    }
  }, 120_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    }
  }, 30_000);

  // ── the scene ───────────────────────────────────────────────────────────

  it('control: at rest, the mirror rows carry every class of value this file reasons about', async () => {
    const rows = byChange(await read(SYS));
    for (const id of Object.values(rowIds)) expect(id).toBeTruthy();
    expect(rows.created && rows.allTracked && rows.openOnly && rows.milestone).toBeTruthy();
    const blob = JSON.stringify([rows.created, rows.allTracked, rows.milestone]);
    for (const v of [V.masked1, V.masked2, V.unserved1, V.unserved2]) expect(blob).toContain(v);
    const labelled = await engine.find(ACTIVITY, { where: { object_name: LABELLED }, context: SYS });
    expect(JSON.stringify(labelled)).toContain(V.title);
  });

  // ── a field served masked ───────────────────────────────────────────────

  it('masked: no row served to the reader carries the stored value of a field it is served masked', async () => {
    const rows = await read(MASKED_READER);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    const blob = JSON.stringify(rows);
    expect(blob).not.toContain(V.masked1);
    expect(blob).not.toContain(V.masked2);
  });

  it('masked: a summary composed from that field is dropped, and one composed from served fields is kept', async () => {
    const rows = byChange(await read(MASKED_READER));
    expect(rows.allTracked).not.toHaveProperty('summary');
    expect(rows.milestone).not.toHaveProperty('summary');
    expect(String(rows.openOnly?.summary)).toContain(V.open3);
    expect(String(rows.created?.summary)).toContain('item');
  });

  it('masked: the recorded change keeps the served fields and drops that field', async () => {
    const rows = byChange(await read(MASKED_READER));
    const created = JSON.parse(rows.created!.metadata);
    expect(created.new).not.toHaveProperty('f_masked');
    expect(created.new).toHaveProperty('f_open', V.open1);
    const tracked = JSON.parse(rows.allTracked!.metadata);
    expect(tracked.old).not.toHaveProperty('f_masked');
    expect(tracked.new).not.toHaveProperty('f_masked');
    expect(tracked.new).toHaveProperty('f_open', V.open2);
  });

  // ── a field not served ──────────────────────────────────────────────────

  it('not served: no row served to the reader carries a value of a field it may not read', async () => {
    const blob = JSON.stringify(await read(UNSERVED_READER));
    expect(blob).not.toContain(V.unserved1);
    expect(blob).not.toContain(V.unserved2);
  });

  it('not served: the record label and the created summary composed from an unserved title are dropped', async () => {
    const rows = await engine.find(ACTIVITY, { where: { object_name: LABELLED }, context: UNSERVED_READER }) as Row[];
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(V.title);
    expect(rows[0]).not.toHaveProperty('record_label');
    expect(rows[0]).not.toHaveProperty('summary');
  });

  it('not served: the masked-for-this-caller field is not withheld from a reader it is not masked for', async () => {
    const rows = byChange(await read(UNSERVED_READER));
    expect(JSON.stringify(rows.created)).toContain(V.masked1);
    expect(rows.milestone).toHaveProperty('summary');
  });

  // ── the control ─────────────────────────────────────────────────────────

  it('control: a reader served every field reads every mirror row whole', async () => {
    const rows = byChange(await read(CONTROL));
    const blob = JSON.stringify(rows);
    for (const v of [V.masked1, V.masked2, V.unserved1, V.unserved2, V.open3]) expect(blob).toContain(v);
    expect(rows.allTracked).toHaveProperty('summary');
    expect(rows.milestone).toHaveProperty('summary');
    const labelled = await engine.find(ACTIVITY, { where: { object_name: LABELLED }, context: CONTROL }) as Row[];
    expect(labelled[0]).toHaveProperty('record_label', V.title);
  });

  // ── what the reader is served, and what it is not ──────────────────────

  it('the provenance declaration is bookkeeping: present at rest, never served to a reader', async () => {
    const atRest = byChange(await read(SYS));
    expect(JSON.parse(atRest.allTracked!.metadata)).toHaveProperty('text_sources');
    for (const reader of [MASKED_READER, UNSERVED_READER, CONTROL]) {
      for (const row of await read(reader)) {
        if (typeof row.metadata === 'string') expect(JSON.parse(row.metadata)).not.toHaveProperty('text_sources');
      }
    }
  });

  it('a projection naming only a text column is redacted the same, and gains no column', async () => {
    const rows = await read(MASKED_READER, { fields: ['summary'] });
    expect(JSON.stringify(rows)).not.toContain(V.masked2);
    for (const row of rows) {
      expect(row).not.toHaveProperty('object_name');
      expect(row).not.toHaveProperty('metadata');
    }
    expect(rows.some((r) => String(r.summary ?? '').includes(V.open3))).toBe(true);
  });

  it('findOne: the by-id read is redacted like the list', async () => {
    const tracked = byChange(await read(SYS)).allTracked!;
    const row = await engine.findOne(ACTIVITY, { where: { id: tracked.id }, context: MASKED_READER }) as Row;
    expect(row?.id).toBe(tracked.id);
    expect(JSON.stringify(row)).not.toContain(V.masked2);
    expect(row).not.toHaveProperty('summary');
  });

  it('a row in the mirror’s earlier shape (no provenance) keeps no text for a restricted reader, and keeps it for the control', async () => {
    const earlier = (rows: Row[]) => rows.find((r) => r.type === 'updated' && typeof r.metadata === 'string' && !('text_sources' in JSON.parse(r.metadata)) && JSON.parse(r.metadata).new && Object.keys(JSON.parse(r.metadata).new).join() === 'f_unserved');
    const control = earlier(await read(CONTROL));
    expect(control).toHaveProperty('summary');
    expect(control).toHaveProperty('record_label');
    // Its provenance is unknown, so a reader restricted on ANY field of the
    // parent keeps none of its text...
    for (const reader of [MASKED_READER, UNSERVED_READER]) {
      const row = (await read(reader)).find((r) => r.id === control!.id);
      expect(row).toBeTruthy();
      expect(row).not.toHaveProperty('summary');
      expect(row).not.toHaveProperty('record_label');
    }
    // ...and its recorded change is narrowed key by key like any other row.
    const unserved = (await read(UNSERVED_READER)).find((r) => r.id === control!.id);
    expect(JSON.stringify(unserved)).not.toContain(V.unserved2);
  });

  it('a row an app wrote is not the mirror’s: its text is served as written', async () => {
    const rows = await read(MASKED_READER);
    const notes = rows.filter((r) => r.type === 'note').map((r) => r.summary).sort();
    expect(notes).toEqual(['app row with context', 'app row without context']);
  });

  it('fail closed: a reader the service cannot answer masking for keeps no value-bearing column composed from a field', async () => {
    const rows = byChange(await read(NO_QUERYABLE_READER));
    const blob = JSON.stringify(rows);
    for (const v of [V.masked1, V.masked2, V.unserved1, V.unserved2, V.open1, V.open2]) expect(blob).not.toContain(v);
    expect(rows.allTracked).not.toHaveProperty('summary');
  });

  it('a system read is not redacted', async () => {
    const blob = JSON.stringify(await read(SYS));
    for (const v of [V.masked2, V.unserved2]) expect(blob).toContain(v);
  });
});

describe('[#21081] resolveServedFields — the security service answer, as the reader', () => {
  const ctx = { userId: 'u' };

  it('no security service: no answer, so nothing is narrowed', async () => {
    expect(await resolveServedFields(undefined, 'o', ctx)).toBeUndefined();
  });

  it('an unresolvable read projection: no answer', async () => {
    const svc = { getReadableFields: async () => undefined, getQueryableFields: async () => ['a'] };
    expect(await resolveServedFields(svc, 'o', ctx)).toBeUndefined();
  });

  it('the read projection intersected with the query-side answer', async () => {
    const svc = { getReadableFields: async () => ['a', 'b', 'c'], getQueryableFields: async () => ['a', 'c'] };
    expect(await resolveServedFields(svc, 'o', ctx)).toEqual(['a', 'c']);
  });

  it('fail closed: no query-side member, an undefined answer, or a throw serves no field', async () => {
    const readable = async () => ['a', 'b'];
    expect(await resolveServedFields({ getReadableFields: readable }, 'o', ctx)).toEqual([]);
    expect(await resolveServedFields({ getReadableFields: readable, getQueryableFields: async () => undefined }, 'o', ctx)).toEqual([]);
    expect(await resolveServedFields({
      getReadableFields: readable,
      getQueryableFields: async () => { throw new Error('boom'); },
    }, 'o', ctx)).toEqual([]);
  });
});
