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
import { referenceTitlesPerRead, resolveServedFields } from './activity-field-redaction.js';
import { singlePostureTenancy } from './__tests__/single-posture-tenancy.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

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
  earlier1: 'AFREARLIERONE89', earlier2: 'AFREARLIERTWO88',
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
    await kernel.use(singlePostureTenancy());
    await kernel.use(new AuditPlugin());
    await kernel.bootstrap();

    engine = kernel.getService<ObjectQL>('objectql');
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    engine.registerDriver(driver, true);
    engine.registry.registerObject(itemObject as any, HARNESS_PACKAGE);
    engine.registry.registerObject(labelledObject as any, HARNESS_PACKAGE);
    await engine.syncSchemas();
    // A real `single` install's Default Organization: the system writes below
    // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
    await installDefaultOrganization(engine);

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
        // A MIXED change, so a restricted reader keeps the row: a change
        // withheld whole is withheld as a row (#21388, its own file).
        metadata: JSON.stringify({
          old: { f_unserved: V.unserved1, f_open: V.earlier1 },
          new: { f_unserved: V.unserved2, f_open: V.earlier2 },
        }),
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

  it('masked: a milestone composed from that field is dropped, a field-change summary keeps only the served changes, and one composed from served fields is kept', async () => {
    const rows = byChange(await read(MASKED_READER));
    // [#36290] Re-composed from the changes this reader is served, never dropped whole.
    expect(String(rows.allTracked?.summary)).toContain(V.open2);
    expect(String(rows.allTracked?.summary)).toContain(V.unserved2);
    expect(String(rows.allTracked?.summary)).not.toContain(V.masked2);
    expect(String(rows.allTracked?.summary)).not.toContain('Masked');
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

  // ── [#36290] the field-change code, served narrowed change by change ────

  /** The served field-change code of a row, or `undefined`. */
  const codeOf = (row: Row | undefined) =>
    typeof row?.metadata === 'string' ? JSON.parse(row.metadata).summary_message : undefined;

  it('[#36290] at rest the field-change code names every changed field, with both values', async () => {
    const code = codeOf(byChange(await read(SYS)).allTracked);
    expect(code?.key).toBe('fieldChanges');
    expect(code.changes.map((c: Row) => c.field)).toEqual(['f_masked', 'f_unserved', 'f_open']);
    expect(JSON.stringify(code)).toContain(V.masked2);
    expect(JSON.stringify(code)).toContain(V.unserved2);
  });

  it('[#36290] masked: the code is served without the change of the field served masked', async () => {
    const code = codeOf(byChange(await read(MASKED_READER)).allTracked);
    expect(code?.key).toBe('fieldChanges');
    expect(code.changes.map((c: Row) => c.field)).toEqual(['f_unserved', 'f_open']);
    expect(JSON.stringify(code)).not.toContain(V.masked1);
    expect(JSON.stringify(code)).not.toContain(V.masked2);
  });

  it('[#36290] not served: the code and the summary are served without the change of the field not served', async () => {
    const row = byChange(await read(UNSERVED_READER)).allTracked;
    const code = codeOf(row);
    expect(code.changes.map((c: Row) => c.field)).toEqual(['f_masked', 'f_open']);
    expect(JSON.stringify(code)).not.toContain(V.unserved2);
    expect(String(row?.summary)).toContain(V.masked2);
    expect(String(row?.summary)).not.toContain(V.unserved2);
    expect(String(row?.summary)).not.toContain('Unserved');
  });

  it('[#36290] control: a reader served every field is served the whole code', async () => {
    const code = codeOf(byChange(await read(CONTROL)).allTracked);
    expect(code.changes.map((c: Row) => c.field)).toEqual(['f_masked', 'f_unserved', 'f_open']);
  });

  it('[#36290] a code other than a field-change code is still never served to a reader', async () => {
    const rows = byChange(await read(CONTROL));
    expect(codeOf(rows.created)).toBeUndefined();
    expect(codeOf(byChange(await read(SYS)).created)?.key).toBe('activityCreated');
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
    const earlier = (rows: Row[]) => rows.find((r) => r.type === 'updated' && typeof r.metadata === 'string' && !('text_sources' in JSON.parse(r.metadata)) && JSON.parse(r.metadata).new && Object.keys(JSON.parse(r.metadata).new).sort().join() === 'f_open,f_unserved');
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
    // Served no field, the reader keeps the create row with no text composed
    // from one, and is withheld every update row whose change had keys
    // (#21388: a change withheld whole is withheld as a row).
    expect(rows.created).toBeTruthy();
    expect(rows.created).not.toHaveProperty('summary');
    expect(rows.allTracked).toBeUndefined();
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

// ── a text composed from a reference names the referenced record's title ──

/** Referenced by every reference below; titled by `secret_name`. */
const REF_TARGET = 'afr_ref_target';
/** Referenced by the object-level cases; titled by `title`. */
const REF_CLOSED = 'afr_ref_closed';
/** Titled by a lookup into {@link REF_TARGET}. */
const REF_TITLED = 'afr_ref_titled';
/** Titled by a lookup into {@link REF_CLOSED}. */
const REF_TITLED_CLOSED = 'afr_ref_titled_closed';
/** Titled by a lookup into {@link REF_CLOSED} that declares `referenceNameVisible`. */
const REF_TITLED_VISIBLE = 'afr_ref_titled_visible';
/** Titled by `name`; tracks a lookup into {@link REF_TARGET}. */
const REF_TRACKED = 'afr_ref_tracked';
/** Referenced by the exposure case; titled by `title`; its declaration serves no API operation. */
const REF_UNEXPOSED = 'afr_ref_unexposed';
/** Titled by `name`; tracks a lookup into {@link REF_UNEXPOSED} and one into {@link REF_TARGET}. */
const REF_TRACKED_MIXED = 'afr_ref_tracked_mixed';
const REF_PACKAGE = 'com.objectstack.audit.test.activity-reference-title';

/** Served neither target's title field; admitted to every object. */
const TITLE_WITHHELD = { userId: 'u_title_withheld', tenantId: 'org_1', positions: ['org_member'] };
/** Served every field; refused the closed target object. */
const OBJECT_REFUSED = { userId: 'u_object_refused', tenantId: 'org_1', positions: ['org_member'] };
/** Served every field, admitted to every object. */
const REF_CONTROL = { userId: 'u_ref_control', tenantId: 'org_1', positions: ['org_member'] };

/** Synthetic titles. */
const T = { one: 'AFRREFTITLEONE71', two: 'AFRREFTITLETWO72', closed: 'AFRREFCLOSED73', unexposed: 'AFRREFUNEXPOSED74' };

const refLookup = (reference: string, extra: Record<string, unknown> = {}) =>
  ({ name: 'target', label: 'Target', type: 'lookup' as const, reference, ...extra });
const refObjects = [
  {
    name: REF_TARGET, label: 'Reference Target', nameField: 'secret_name',
    fields: {
      name: { name: 'name', label: 'Name', type: 'text' as const },
      secret_name: { name: 'secret_name', label: 'Secret Name', type: 'text' as const },
    },
  },
  {
    name: REF_CLOSED, label: 'Reference Closed', nameField: 'title',
    fields: { title: { name: 'title', label: 'Title', type: 'text' as const } },
  },
  {
    // [#36290] Values off, so its update is summarized by the record label —
    // the text this scene judges — not by a field change.
    name: REF_TITLED, label: 'Reference Titled', nameField: 'target', enable: { fieldHistory: false },
    fields: { name: { name: 'name', label: 'Name', type: 'text' as const }, target: refLookup(REF_TARGET) },
  },
  {
    name: REF_TITLED_CLOSED, label: 'Reference Titled Closed', nameField: 'target',
    fields: { name: { name: 'name', label: 'Name', type: 'text' as const }, target: refLookup(REF_CLOSED) },
  },
  {
    name: REF_TITLED_VISIBLE, label: 'Reference Titled Visible', nameField: 'target',
    fields: {
      name: { name: 'name', label: 'Name', type: 'text' as const },
      target: refLookup(REF_CLOSED, { referenceNameVisible: true }),
    },
  },
  {
    name: REF_TRACKED, label: 'Reference Tracked', nameField: 'name',
    fields: {
      name: { name: 'name', label: 'Name', type: 'text' as const },
      target: refLookup(REF_TARGET, { trackHistory: true }),
    },
  },
  {
    name: REF_UNEXPOSED, label: 'Reference Unexposed', nameField: 'title', enable: { apiEnabled: false },
    fields: { title: { name: 'title', label: 'Title', type: 'text' as const } },
  },
  {
    name: REF_TRACKED_MIXED, label: 'Reference Tracked Mixed', nameField: 'name',
    fields: {
      name: { name: 'name', label: 'Name', type: 'text' as const },
      hidden: { name: 'hidden', label: 'Hidden', type: 'lookup' as const, reference: REF_UNEXPOSED, trackHistory: true },
      open: { name: 'open', label: 'Open', type: 'lookup' as const, reference: REF_TARGET, trackHistory: true },
    },
  },
];


describe('an activity text naming a referenced record by its title is served only to a reader served that title field and admitted to its object', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  const ids: Record<string, string> = {};

  const allFields = (object: string): string[] =>
    Object.keys(((engine as any).getSchema(object)?.fields ?? {}) as Record<string, unknown>);

  /** The double: the field answers and the object-level read admission, per reader. */
  const security = {
    async getReadableFields(object: string, context?: any): Promise<string[] | undefined> {
      const all = allFields(object);
      if (context?.userId === TITLE_WITHHELD.userId) {
        if (object === REF_TARGET) return all.filter((f) => f !== 'secret_name');
        if (object === REF_CLOSED) return all.filter((f) => f !== 'title');
      }
      return all;
    },
    async getQueryableFields(object: string, context?: any): Promise<string[] | undefined> {
      return security.getReadableFields(object, context);
    },
    async canReadObject(object: string, context?: any): Promise<boolean> {
      return !(context?.userId === OBJECT_REFUSED.userId && object === REF_CLOSED);
    },
    async getReadFilter(): Promise<Record<string, unknown> | undefined> {
      return undefined;
    },
    async explain(_request: { object: string }, context?: any): Promise<{ allowed: boolean }> {
      return { allowed: !context?.isSystem };
    },
  };

  const rowsAbout = (object: string, context: EngineQueryOptions['context']) =>
    engine.find(ACTIVITY, {
      where: { object_name: object, record_id: ids[object] },
      orderBy: [{ field: 'timestamp', order: 'asc' }],
      context,
    }) as Promise<Row[]>;

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use({
      name: 'test.security-double',
      version: '0.0.0',
      init: async (ctx: any) => ctx.registerService('security', security),
      start: async () => {},
    } as any);
    await kernel.use(singlePostureTenancy());
    await kernel.use(new AuditPlugin());
    await kernel.bootstrap();

    engine = kernel.getService<ObjectQL>('objectql');
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    engine.registerDriver(driver, true);
    for (const object of refObjects) engine.registry.registerObject(object as any, REF_PACKAGE);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);

    const insert = async (object: string, data: Row) => String((await engine.insert(object, data, { context: SYS })).id);
    const one = await insert(REF_TARGET, { name: 'one', secret_name: T.one });
    const two = await insert(REF_TARGET, { name: 'two', secret_name: T.two });
    const closed = await insert(REF_CLOSED, { title: T.closed });
    ids[REF_TITLED] = await insert(REF_TITLED, { name: 'titled', target: one });
    await engine.update(REF_TITLED, { name: 'titled again' }, { where: { id: ids[REF_TITLED] }, context: SYS });
    ids[REF_TITLED_CLOSED] = await insert(REF_TITLED_CLOSED, { name: 'closed', target: closed });
    ids[REF_TITLED_VISIBLE] = await insert(REF_TITLED_VISIBLE, { name: 'visible', target: closed });
    ids[REF_TRACKED] = await insert(REF_TRACKED, { name: 'tracked', target: one });
    await engine.update(REF_TRACKED, { target: two }, { where: { id: ids[REF_TRACKED] }, context: SYS });

    // [ADR-0049] One change moving a reference into a target whose exposure
    // serves no `get` (the mirror names it by its id) and one into an exposed
    // target (named by its title).
    ids.unexposed = await insert(REF_UNEXPOSED, { title: T.unexposed });
    ids[REF_TRACKED_MIXED] = await insert(REF_TRACKED_MIXED, { name: 'mixed' });
    await engine.update(REF_TRACKED_MIXED, { hidden: ids.unexposed, open: one }, { where: { id: ids[REF_TRACKED_MIXED] }, context: SYS });
  }, 120_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    }
  }, 30_000);

  it('control: at rest, the mirror names each referenced record by its title', async () => {
    const titled = await rowsAbout(REF_TITLED, SYS);
    expect(titled.map((r) => r.type)).toEqual(['created', 'updated']);
    for (const row of titled) expect(row.record_label).toBe(T.one);
    expect((await rowsAbout(REF_TITLED_CLOSED, SYS))[0]?.record_label).toBe(T.closed);
    expect(JSON.stringify(await rowsAbout(REF_TRACKED, SYS))).toContain(T.two);
  });

  it('a reader not served the referenced title field is served the rows without the label or a summary naming it, and keeps the record id', async () => {
    const rows = await rowsAbout(REF_TITLED, TITLE_WITHHELD);
    expect(rows.map((r) => r.type)).toEqual(['created', 'updated']);
    for (const row of rows) {
      expect(row).not.toHaveProperty('record_label');
      expect(row).not.toHaveProperty('summary');
      expect(row.record_id).toBe(ids[REF_TITLED]);
    }
    expect(JSON.stringify(rows)).not.toContain(T.one);
  });

  it('a reader refused the referenced object is served no text naming its records by title', async () => {
    const rows = await rowsAbout(REF_TITLED_CLOSED, OBJECT_REFUSED);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('record_label');
    expect(rows[0]).not.toHaveProperty('summary');
    expect(JSON.stringify(rows)).not.toContain(T.closed);
  });

  it('referenceNameVisible lifts the object-level refusal and never the field-level rule', async () => {
    const refused = await rowsAbout(REF_TITLED_VISIBLE, OBJECT_REFUSED);
    expect(refused[0]?.record_label).toBe(T.closed);
    const withheld = await rowsAbout(REF_TITLED_VISIBLE, TITLE_WITHHELD);
    expect(withheld).toHaveLength(1);
    expect(withheld[0]).not.toHaveProperty('record_label');
    expect(JSON.stringify(withheld)).not.toContain(T.closed);
  });

  it('a tracked reference change names the referenced records by title only to a reader served that title', async () => {
    const withheld = (await rowsAbout(REF_TRACKED, TITLE_WITHHELD)).find((r) => r.type === 'updated');
    expect(withheld).toBeTruthy();
    expect(withheld).not.toHaveProperty('summary');
    expect(JSON.stringify(withheld)).not.toContain(T.one);
    expect(JSON.stringify(withheld)).not.toContain(T.two);
    // The record's own label is not composed from the reference: it stays.
    expect(withheld?.record_label).toBe('tracked');
  });

  it('control: a reader who may read every referenced title reads every row whole', async () => {
    for (const row of await rowsAbout(REF_TITLED, REF_CONTROL)) {
      expect(row.record_label).toBe(T.one);
      expect(String(row.summary)).toContain(T.one);
    }
    expect((await rowsAbout(REF_TITLED_CLOSED, REF_CONTROL))[0]?.record_label).toBe(T.closed);
    const tracked = (await rowsAbout(REF_TRACKED, REF_CONTROL)).find((r) => r.type === 'updated');
    expect(String(tracked?.summary)).toContain(T.one);
    expect(String(tracked?.summary)).toContain(T.two);
  });

  it('a change naming an unexposed target by its id and an exposed one by its title is served to a reader who may read that title, and to no reader withheld it', async () => {
    const updatedAs = async (context: EngineQueryOptions['context']) =>
      (await rowsAbout(REF_TRACKED_MIXED, context)).find((r) => r.type === 'updated');
    const atRest = await updatedAs(SYS);
    expect(String(atRest?.summary)).toContain(T.one);
    expect(String(atRest?.summary)).toContain(ids.unexposed);
    expect(String(atRest?.summary)).not.toContain(T.unexposed);
    const control = await updatedAs(REF_CONTROL);
    expect(String(control?.summary)).toContain(T.one);
    expect(String(control?.summary)).toContain(ids.unexposed);
    const withheld = await updatedAs(TITLE_WITHHELD);
    expect(withheld).toBeTruthy();
    // [#36290] Judged change by change: the change naming the exposed
    // target's title is dropped, the one naming the unexposed target by its id
    // (whose title field this reader IS served) is kept.
    expect(String(withheld?.summary)).toContain(ids.unexposed);
    expect(String(withheld?.summary)).not.toContain('Open');
    expect(JSON.stringify(withheld)).not.toContain(T.one);
    const code = JSON.parse(String(withheld?.metadata)).summary_message;
    expect(code.changes.map((c: Row) => c.field)).toEqual(['hidden']);
  });

  it('findOne: the by-id read is judged like the list', async () => {
    const [created] = await rowsAbout(REF_TITLED, SYS);
    const row = await engine.findOne(ACTIVITY, { where: { id: created.id }, context: TITLE_WITHHELD }) as Row;
    expect(row?.id).toBe(created.id);
    expect(row).not.toHaveProperty('record_label');
    expect(JSON.stringify(row)).not.toContain(T.one);
  });
});

describe('referenceTitlesPerRead — a referenced title is served only to a reader served its title field and admitted to its object', () => {
  const schemas: Record<string, unknown> = {
    parent: {
      name: 'parent',
      fields: {
        name: { type: 'text' },
        target: { type: 'lookup', reference: 'target' },
        visible: { type: 'lookup', reference: 'target', referenceNameVisible: true },
        untitled: { type: 'lookup', reference: 'untitled' },
        gone: { type: 'lookup', reference: 'not_registered' },
        hidden: { type: 'lookup', reference: 'hidden', referenceNameVisible: true },
        listonly: { type: 'lookup', reference: 'listonly' },
      },
    },
    target: { name: 'target', nameField: 'title', fields: { title: { type: 'text' } } },
    untitled: { name: 'untitled', nameField: 'id', fields: {} },
    hidden: { name: 'hidden', nameField: 'title', enable: { apiEnabled: false }, fields: { title: { type: 'text' } } },
    listonly: { name: 'listonly', nameField: 'title', enable: { apiMethods: ['list'] }, fields: { title: { type: 'text' } } },
  };
  const schemaOf = (object: string) => schemas[object];
  const reader = { userId: 'u' };
  const answer = (served: string[] | undefined) => async () => served;
  const security = (admits: boolean | Error | undefined) => ({
    getReadableFields: async (): Promise<string[]> => [],
    getQueryableFields: async (): Promise<string[]> => [],
    ...(admits === undefined
      ? {}
      : {
          canReadObject: async (): Promise<boolean> => {
            if (admits instanceof Error) throw admits;
            return admits === true;
          },
        }),
  });

  it('a source that is not a reference is judged by the parent alone', async () => {
    const judge = referenceTitlesPerRead(schemaOf, security(false), reader, answer([]));
    expect(await judge('parent', ['name'])).toBe(true);
  });

  it('a reference is served only when the reader is served the target title field and admitted to the target', async () => {
    expect(await referenceTitlesPerRead(schemaOf, security(true), reader, answer(['title']))('parent', ['target'])).toBe(true);
    expect(await referenceTitlesPerRead(schemaOf, security(true), reader, answer([]))('parent', ['target'])).toBe(false);
    expect(await referenceTitlesPerRead(schemaOf, security(false), reader, answer(['title']))('parent', ['target'])).toBe(false);
  });

  it('referenceNameVisible lifts the admission and never the field-level answer', async () => {
    expect(await referenceTitlesPerRead(schemaOf, security(false), reader, answer(['title']))('parent', ['visible'])).toBe(true);
    expect(await referenceTitlesPerRead(schemaOf, security(false), reader, answer([]))('parent', ['visible'])).toBe(false);
  });

  it('fail closed: a throwing admission, or a target that is not registered, serves no title', async () => {
    const warnings: string[] = [];
    const logger = { warn: (m: string) => warnings.push(m) };
    expect(await referenceTitlesPerRead(schemaOf, security(new Error('boom')), reader, answer(['title']), logger)('parent', ['target'])).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(await referenceTitlesPerRead(schemaOf, security(true), reader, answer(['title']))('parent', ['gone'])).toBe(false);
  });

  it('a target with no title field is named by its id, which is no title to withhold', async () => {
    expect(await referenceTitlesPerRead(schemaOf, security(false), reader, answer([]))('parent', ['untitled'])).toBe(true);
  });

  it('a target whose API exposure serves no get is judged by the reader like any other: its exposure was decided where the title was read', async () => {
    for (const field of ['hidden', 'listonly']) {
      expect(await referenceTitlesPerRead(schemaOf, security(true), reader, answer(['title']))('parent', [field])).toBe(true);
      expect(await referenceTitlesPerRead(schemaOf, security(true), reader, answer([]))('parent', [field])).toBe(false);
    }
    expect(await referenceTitlesPerRead(schemaOf, security(false), reader, answer(['title']))('parent', ['listonly'])).toBe(false);
  });

  it('no admission member: the field-level answer alone decides; no answer for the target narrows nothing', async () => {
    expect(await referenceTitlesPerRead(schemaOf, security(undefined), reader, answer(['title']))('parent', ['target'])).toBe(true);
    expect(await referenceTitlesPerRead(schemaOf, security(true), reader, answer(undefined))('parent', ['target'])).toBe(true);
  });

  it('every declared reference source is judged: one the reader may not read refuses the text', async () => {
    const judge = referenceTitlesPerRead(schemaOf, security(true), reader, async (o: string) => (o === 'target' ? ['title'] : []));
    expect(await judge('parent', ['name', 'target'])).toBe(true);
    expect(await judge('parent', ['target', 'gone'])).toBe(false);
  });
});
