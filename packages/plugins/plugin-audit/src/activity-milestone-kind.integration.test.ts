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
 * ## [#22786] …and the row is withheld from a reader not served them
 *
 * The kind is not the row's only column that speaks about the watched fields:
 * its `type` is the declaration's, and so is its summary. So the redaction's
 * withheld-row pre-scan withholds the row itself from that reader, by the same
 * declared list and the same served answer, on every read; a reader served
 * every watched field, and a row no milestone fired, are unchanged.
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
 * [ADR-0139 E6, ruled letter B] The row half is a predicate over the
 * writer-stamped `milestone_key`: a milestone row is served only when its key
 * equals the key of the object's CURRENT declaration and the reader is served
 * every field that declaration watches. Pinned below beside the earlier
 * behaviour: a declaration edit withholds the rows written under the old one
 * from every non-system reader, and an unjudgeable milestone row is stored
 * unstamped and withheld.
 *
 * ⚠️ Disclosure discipline: no test title states a value.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { AuditPlugin } from './audit-plugin.js';
import { keptRowsOfParent } from './activity-field-redaction.js';
import { declaredMilestoneWatchedFields, milestoneKeyOf, planActivityStamp } from './activity-changed-fields.js';
import { singlePostureTenancy } from './__tests__/single-posture-tenancy.js';

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
const meta = (r: Row | null | undefined) => (typeof r?.metadata === 'string' ? JSON.parse(r.metadata) : null);

describe('[#22771] a fired milestone is served with metadata.kind, judged like the text it rides beside', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  let itemId = '';
  /** The rows, classified ONCE from the at-rest read. */
  const rowIds: Record<'created' | 'tracked' | 'typedMilestone' | 'untypedMilestone' | 'appKind', string> = {} as never;

  const allFields = (object: string): string[] =>
    Object.keys(((engine as any).getSchema(object)?.fields ?? {}) as Record<string, unknown>);

  /** The double: the two field members, answered per reader, and the two read halves (below). No field is served masked. */
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
    // [ADR-0139 E5] Every reader reads every parent record here: the two halves
    // of a read the engine composes the parent-record gate's ReadableIds
    // leaves from — the object-level admission and the read scope (none).
    async canReadObject(): Promise<boolean> {
      return true;
    },
    async getReadFilter(): Promise<Record<string, unknown> | undefined> {
      return undefined;
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
    await kernel.use(singlePostureTenancy());
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

  it('[ADR-0139 E6] at rest: each fired milestone is stamped with the key of the watched fields, every other row with none', async () => {
    const atRest = await read(SYS);
    const keyOf = (id: string) => atRest.find((r) => r.id === id)?.milestone_key ?? null;
    expect(keyOf(rowIds.typedMilestone)).toBe('phase,stage');
    expect(keyOf(rowIds.untypedMilestone)).toBe('phase,stage');
    for (const id of [rowIds.created, rowIds.tracked, rowIds.appKind]) expect(keyOf(id), id).toBeNull();
    expect(milestoneKeyOf(declaredMilestoneWatchedFields(itemObject))).toBe('phase,stage');
  });

  it('[ADR-0139 E6] the milestone key is never served, to any non-system reader', async () => {
    for (const context of [CONTROL, NOTE_WITHHELD, WATCH_WITHHELD]) {
      for (const row of await read(context)) expect(row, String(row.id)).not.toHaveProperty('milestone_key');
    }
  });

  it('[ADR-0139 E6, letter B] after the declaration changes, the rows written under the old one are withheld from every non-system reader', async () => {
    const edited = {
      ...itemObject,
      activityMilestones: [itemObject.activityMilestones[0]], // `phase` no longer watched
    };
    engine.registry.registerObject(edited as any, HARNESS_PACKAGE);
    try {
      for (const context of [CONTROL, NOTE_WITHHELD, WATCH_WITHHELD]) {
        const ids = (await read(context)).map((r) => r.id);
        expect(ids).not.toContain(rowIds.typedMilestone);
        expect(ids).not.toContain(rowIds.untypedMilestone);
        expect(ids).toContain(rowIds.tracked);
      }
      expect((await read(SYS)).map((r) => r.id)).toContain(rowIds.typedMilestone);
    } finally {
      engine.registry.registerObject(itemObject as any, HARNESS_PACKAGE);
    }
    // Control: under the declaration they were written under, served again.
    expect((await read(CONTROL)).map((r) => r.id)).toContain(rowIds.typedMilestone);
  });

  it('[ADR-0139 E6] a milestone row the planner cannot judge is stored unstamped and withheld from every non-system reader', async () => {
    const id = String((await engine.insert(ACTIVITY, {
      type: 'note', summary: 'unjudged', object_name: ITEM, record_id: itemId,
      timestamp: new Date().toISOString(),
      metadata: JSON.stringify({ kind: 'milestone', text_sources: { summary: [], record_label: [] } }),
      // A writer's own stamp is not taken.
      changed_fields: [], milestone_key: 'phase,stage',
    }, { context: SYS })).id);
    try {
      const atRest = (await read(SYS)).find((r) => r.id === id);
      expect(atRest?.changed_fields ?? null).toBeNull();
      expect(atRest?.milestone_key ?? null).toBeNull();
      for (const context of [CONTROL, NOTE_WITHHELD, WATCH_WITHHELD]) {
        expect((await read(context)).map((r) => r.id)).not.toContain(id);
      }
    } finally {
      await engine.delete(ACTIVITY, { where: { id }, context: SYS } as any);
    }
    expect(await read(SYS)).toHaveLength(5);
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

  // ── [#22786] the row, for a reader not served a watched field ───────────

  it('a reader withheld a watched field is served neither milestone row', async () => {
    // Each change also has a key this reader may read; the rows are withheld
    // as rows all the same, by the declared watched fields. The untyped one
    // too, though its own field is served: the kind is a fact about every
    // watched field.
    const ids = (await read(WATCH_WITHHELD)).map((r) => r.id);
    expect(ids).not.toContain(rowIds.typedMilestone);
    expect(ids).not.toContain(rowIds.untypedMilestone);
  });

  it('findOne: the by-id read withholds each milestone row from that reader, and serves it to the control', async () => {
    const byId = (context: any, row: keyof typeof rowIds) =>
      engine.findOne(ACTIVITY, { where: { id: rowIds[row] }, context }) as Promise<Row | null>;
    for (const row of ['typedMilestone', 'untypedMilestone'] as const) {
      expect(await byId(WATCH_WITHHELD, row)).toBeNull();
      const control = await byId(CONTROL, row);
      expect(control?.id).toBe(rowIds[row]);
      expect(meta(control)?.kind).toBe('milestone');
    }
    expect((await byId(WATCH_WITHHELD, 'tracked'))?.id).toBe(rowIds.tracked);
  });

  it('control: that reader is served exactly the rows no milestone fired', async () => {
    const ids = (await read(WATCH_WITHHELD)).map((r) => String(r.id)).sort();
    expect(ids).toEqual([rowIds.created, rowIds.tracked, rowIds.appKind].sort());
  });

  it('control: a row no milestone fired is served to that reader as it is to the control', async () => {
    const control = await served(CONTROL, 'tracked');
    expect(control).toBeTruthy();
    expect(await served(WATCH_WITHHELD, 'tracked')).toEqual(control);
  });

  it('count: each reader’s total agrees with the rows it is served', async () => {
    const where = { object_name: ITEM, record_id: itemId };
    for (const context of [CONTROL, WATCH_WITHHELD, NOTE_WITHHELD]) {
      expect(await engine.count(ACTIVITY, { where }, { context })).toBe((await read(context)).length);
    }
    expect(await engine.count(ACTIVITY, { where }, { context: WATCH_WITHHELD })).toBe(3);
    expect(await engine.count(ACTIVITY, { where }, { context: CONTROL })).toBe(5);
  });

  it('fail closed: when the withheld-row rule cannot be built, the read is denied, not served unjudged', async () => {
    // The rule reads the parent's CURRENT declaration; make that one read
    // fail and nothing else.
    const original = (engine as any).getSchema.bind(engine);
    const spy = vi.spyOn(engine as any, 'getSchema').mockImplementation(((object: string) => {
      if (object === ITEM && new Error().stack?.includes('currentMilestoneWatched')) {
        throw new Error('definition unavailable');
      }
      return original(object);
    }) as any);
    try {
      for (const context of [CONTROL, WATCH_WITHHELD]) {
        expect(await read(context)).toEqual([]);
        expect(await engine.count(ACTIVITY, { where: { object_name: ITEM, record_id: itemId } }, { context })).toBe(0);
      }
      // The system read takes no rule, so the failure cannot reach it.
      expect(await read(SYS)).toHaveLength(5);
    } finally {
      spy.mockRestore();
    }
    // Control: with the definition back, the read is served again.
    expect((await read(CONTROL)).length).toBe(5);
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

describe('[ADR-0139 E6] the milestone key: stamped by the planner, compared by the predicate', () => {
  const milestone = (watched: unknown) => ({
    old: { a: 1 }, new: { a: 2 }, kind: 'milestone',
    text_sources: { summary: [], record_label: [], ...(watched === undefined ? {} : { kind: watched }) },
  });

  it('a fired milestone the mirror declared is keyed by its watched fields, sorted and distinct', () => {
    expect(planActivityStamp(milestone(['b', 'a', 'b']))).toEqual({ changed_fields: ['a'], milestone_key: 'a,b' });
  });

  it('no milestone kind, or a kind on a row the mirror did not write, carries no key', () => {
    const { kind: _kind, ...noKind } = milestone(['c']);
    expect(planActivityStamp(noKind)?.milestone_key).toBeNull();
    expect(planActivityStamp({ ...milestone(['c']), kind: 'email' })?.milestone_key).toBeNull();
    expect(planActivityStamp({ kind: 'milestone' })?.milestone_key).toBeNull();
  });

  it('a declaration with no readable list cannot be judged: no stamp at all', () => {
    for (const watched of [undefined, 'c', [1], ['a,b']]) {
      expect(planActivityStamp(milestone(watched)), JSON.stringify(watched)).toBeNull();
    }
  });

  it('served only under the current declaration, to a reader served every field it watches', () => {
    const milestoneBranch = (served: string[], watched: string[]) =>
      (keptRowsOfParent('obj', served, watched).$and as unknown[])[3];
    expect(milestoneBranch(['a', 'b'], ['a', 'b'])).toEqual({
      $or: [{ milestone_key: { $null: true } }, { milestone_key: 'a,b' }],
    });
    expect(milestoneBranch(['a'], ['a', 'b'])).toEqual({ milestone_key: { $null: true } });
    expect(milestoneBranch(['a', 'b'], [])).toEqual({ milestone_key: { $null: true } });
  });
});
