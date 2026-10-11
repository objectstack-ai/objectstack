// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22771] A row a declared `activityMilestones` entry fired is served with
 * `metadata.kind: 'milestone'`, so a reader can tell it from a finished task.
 *
 * ADR-0052 §5: "`type` stays domain-NEUTRAL … Domain kind rides in
 * `metadata.kind`." A milestone keeps the `type` its declaration names
 * (`completed`, or `updated` when it names none), and that alone made a "Case
 * resolved" milestone read as a completed task: the one hint a reader had,
 * `metadata.text_sources`, is bookkeeping the redaction strips. The CRUD mirror
 * now stamps the kind, and the served-row redaction keeps it.
 *
 * ## Why the kind is judged like a text
 *
 * "A milestone fired" is the fact that a watched field entered its declared
 * value. To a reader not served that field it is field content, so the mirror
 * declares the fields the kind derives from (every field a declared milestone
 * watches: the first match wins, so the kind is a fact about all of them), and
 * the redaction serves the kind only to a reader served every one of them. A
 * reader served them keeps it: it then says nothing that reader may not read.
 *
 * ## Why a real engine, a real driver and the real plugin
 *
 * The rows are written by the real CRUD mirror, stored by a real SQLite driver
 * and read back through the middleware chain `AuditPlugin` mounts at
 * `kernel:ready`: the activity read the console makes (a `find` on
 * `sys_activity` scoped by `object_name` + `record_id`, and the by-id read) as
 * a non-system caller. A writer that stamps the kind while the served path
 * loses it fails here; so does a redaction that serves it to the wrong reader.
 *
 * ## The one stand-in
 *
 * The security service, answering the two contract members the redaction asks,
 * per reader, in the contract's shape (as in `activity-field-redaction.test.ts`).
 *
 * ⚠️ Disclosure discipline: no test title states a value.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { AuditPlugin } from './audit-plugin.js';

const ACTIVITY = 'sys_activity';
const ITEM = 'amk_item';
const HARNESS_PACKAGE = 'com.objectstack.audit.test.activity-milestone-kind';

const SYS = { isSystem: true } as const;
/** Served every field: the control. */
const CONTROL = { userId: 'u_control', tenantId: 'org_1', positions: ['org_member'] };
/** Not served `stage`, a field a declared milestone watches. */
const WATCH_WITHHELD = { userId: 'u_watch', tenantId: 'org_1', positions: ['org_member'] };
/** Not served `f_note`, a field no milestone watches. */
const NOTE_WITHHELD = { userId: 'u_note', tenantId: 'org_1', positions: ['org_member'] };

/** Synthetic values. */
const V = { open1: 'AMKOPENONE51', open2: 'AMKOPENTWO52', open3: 'AMKOPENTHREE53', note1: 'AMKNOTEONE54', note2: 'AMKNOTETWO55' };

const itemObject = {
  name: ITEM,
  label: 'Milestone Kind Item',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' as const },
    stage: {
      name: 'stage', label: 'Stage', type: 'select' as const,
      options: [{ label: 'Open', value: 'open' }, { label: 'Won', value: 'won' }],
    },
    phase: {
      name: 'phase', label: 'Phase', type: 'select' as const,
      options: [{ label: 'Draft', value: 'draft' }, { label: 'Closed', value: 'closed' }],
    },
    f_open: { name: 'f_open', label: 'Open', type: 'text' as const, trackHistory: true },
    f_note: { name: 'f_note', label: 'Note', type: 'text' as const, trackHistory: true },
  },
  activityMilestones: [
    // A typed milestone: the card's case, a milestone whose `type` is a task's.
    { field: 'stage', value: 'won', summary: 'Won {name}', type: 'completed' },
    // An untyped one: its `type` stays `updated`, and only the kind says what it is.
    { field: 'phase', value: 'closed', summary: 'Closed {name}' },
  ],
};

type Row = Record<string, any>;
const meta = (r: Row | undefined) => (typeof r?.metadata === 'string' ? JSON.parse(r.metadata) : null);

describe('[#22771] a fired milestone is served with metadata.kind, judged like the text it rides beside', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  let itemId = '';
  /** The rows, classified ONCE from the at-rest read. */
  const rowIds: Record<'created' | 'tracked' | 'typedMilestone' | 'untypedMilestone' | 'appKind', string> = {} as never;

  const allFields = (object: string): string[] =>
    Object.keys(((engine as any).getSchema(object)?.fields ?? {}) as Record<string, unknown>);

  /** The double: the two contract members, answered per reader. No field is served masked. */
  const security = {
    async getReadableFields(object: string, context?: any): Promise<string[] | undefined> {
      const all = allFields(object);
      if (object === ITEM && context?.userId === WATCH_WITHHELD.userId) return all.filter((f) => f !== 'stage');
      if (object === ITEM && context?.userId === NOTE_WITHHELD.userId) return all.filter((f) => f !== 'f_note');
      return all;
    },
    async getQueryableFields(object: string, context?: any): Promise<string[] | undefined> {
      return security.getReadableFields(object, context);
    },
  };

  /** The console's activity read: one record's rows, as `context`. */
  const read = (context: any) =>
    engine.find(ACTIVITY, {
      where: { object_name: ITEM, record_id: itemId },
      orderBy: [{ field: 'timestamp', order: 'asc' }],
      context,
    }) as Promise<Row[]>;
  const served = async (context: any, row: keyof typeof rowIds) =>
    (await read(context)).find((r) => r.id === rowIds[row]);

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

    // Every mirror row below is written by the real audit writer's CRUD mirror.
    const update = (patch: Row) => engine.update(ITEM, patch, { where: { id: itemId }, context: SYS });
    itemId = (await engine.insert(
      ITEM,
      { name: 'item', stage: 'open', phase: 'draft', f_open: V.open1, f_note: V.note1 },
      { context: SYS },
    )).id;
    await update({ f_open: V.open2 }); // a tracked change, no milestone
    await update({ stage: 'won', f_open: V.open3 }); // the typed milestone, with a served change beside it
    await update({ phase: 'closed', f_note: V.note2 }); // the untyped milestone, with a change beside it
    // A row an app's own server action writes, its domain kind in the slot
    // ADR-0052 §5 names: not the mirror's, so served as written.
    await engine.insert(ACTIVITY, {
      type: 'note', summary: 'app row', object_name: ITEM, record_id: itemId,
      timestamp: new Date().toISOString(), metadata: JSON.stringify({ kind: 'email' }),
    }, { context: SYS });

    const atRest = await read(SYS);
    const idOf = (pick: (r: Row) => boolean) => String(atRest.find(pick)?.id ?? '');
    rowIds.created = idOf((r) => r.type === 'created');
    rowIds.tracked = idOf((r) => r.type === 'updated' && meta(r)?.new?.f_open === V.open2);
    rowIds.typedMilestone = idOf((r) => meta(r)?.new?.stage === 'won');
    rowIds.untypedMilestone = idOf((r) => meta(r)?.new?.phase === 'closed');
    rowIds.appKind = idOf((r) => r.type === 'note');
  }, 120_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    }
  }, 30_000);

  // ── the writer, at rest ─────────────────────────────────────────────────

  it('control: at rest, the mirror wrote every row this file reasons about', async () => {
    for (const [name, id] of Object.entries(rowIds)) expect(id, name).toBeTruthy();
    expect(await read(SYS)).toHaveLength(5);
  });

  it('at rest: each fired milestone carries the kind, and declares the watched fields it derives from', async () => {
    const atRest = await read(SYS);
    for (const id of [rowIds.typedMilestone, rowIds.untypedMilestone]) {
      const m = meta(atRest.find((r) => r.id === id));
      expect(m.kind).toBe('milestone');
      expect([...m.text_sources.kind].sort()).toEqual(['phase', 'stage']);
    }
  });

  it('at rest: type stays what the declaration names — no new type value', async () => {
    const atRest = await read(SYS);
    expect(atRest.find((r) => r.id === rowIds.typedMilestone)?.type).toBe('completed');
    expect(atRest.find((r) => r.id === rowIds.untypedMilestone)?.type).toBe('updated');
  });

  it('control: a CRUD-mirror row no milestone fired carries no kind, at rest or served', async () => {
    for (const context of [SYS, CONTROL]) {
      const rows = await read(context);
      for (const id of [rowIds.created, rowIds.tracked]) {
        const m = meta(rows.find((r) => r.id === id));
        expect(m).toBeTruthy();
        expect(m).not.toHaveProperty('kind');
        if (m.text_sources) expect(m.text_sources).not.toHaveProperty('kind');
      }
    }
  });

  // ── the served row ──────────────────────────────────────────────────────

  it('a reader served every field is served each milestone row with the kind', async () => {
    for (const row of ['typedMilestone', 'untypedMilestone'] as const) {
      expect(meta(await served(CONTROL, row))?.kind).toBe('milestone');
    }
  });

  it('a reader withheld a field no milestone watches is still served the kind', async () => {
    for (const row of ['typedMilestone', 'untypedMilestone'] as const) {
      expect(meta(await served(NOTE_WITHHELD, row))?.kind).toBe('milestone');
    }
  });

  it('a reader withheld a watched field is served each milestone row without the kind', async () => {
    // Both rows are served (each change has a key this reader may read), and
    // neither carries the kind — the untyped one included, whose own field is
    // served: the kind is a fact about every watched field.
    for (const row of ['typedMilestone', 'untypedMilestone'] as const) {
      const r = await served(WATCH_WITHHELD, row);
      expect(r).toBeTruthy();
      expect(meta(r)).not.toHaveProperty('kind');
    }
  });

  it('findOne: the by-id read judges the kind like the list', async () => {
    const byId = (context: any) =>
      engine.findOne(ACTIVITY, { where: { id: rowIds.typedMilestone }, context }) as Promise<Row | null>;
    expect(meta(await byId(CONTROL))?.kind).toBe('milestone');
    const withheld = await byId(WATCH_WITHHELD);
    expect(withheld?.id).toBe(rowIds.typedMilestone);
    expect(meta(withheld)).not.toHaveProperty('kind');
  });

  // ── what the redaction removes, key for key ─────────────────────────────

  it('control: the redaction still removes what it removed before, key for key', async () => {
    // The typed milestone's whole served `metadata`, per reader: the declaration
    // is never served, a change key the reader is withheld is dropped from both
    // sides, and the kind is the one key judged by its declared fields.
    expect(meta(await served(CONTROL, 'typedMilestone'))).toEqual({
      old: { stage: 'open', f_open: V.open2 },
      new: { stage: 'won', f_open: V.open3 },
      kind: 'milestone',
    });
    expect(meta(await served(WATCH_WITHHELD, 'typedMilestone'))).toEqual({
      old: { f_open: V.open2 },
      new: { f_open: V.open3 },
    });
    expect(meta(await served(NOTE_WITHHELD, 'untypedMilestone'))).toEqual({
      old: { phase: 'draft' },
      new: { phase: 'closed' },
      kind: 'milestone',
    });
    for (const context of [CONTROL, WATCH_WITHHELD, NOTE_WITHHELD]) {
      for (const row of await read(context)) {
        const m = meta(row);
        if (m) expect(m).not.toHaveProperty('text_sources');
      }
    }
  });

  it('a kind on a row an app wrote is the author’s, served as written to every reader', async () => {
    for (const context of [CONTROL, WATCH_WITHHELD, NOTE_WITHHELD]) {
      expect(meta(await served(context, 'appKind'))).toEqual({ kind: 'email' });
    }
  });
});
