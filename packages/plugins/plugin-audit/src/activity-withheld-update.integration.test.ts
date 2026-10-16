// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21388] An update activity row whose every recorded change is withheld from
 * the reader is withheld from that reader as a ROW, on every listing face.
 *
 * The field redaction (`activity-field-redaction.ts`, #21081) narrows a row's
 * recorded change key by key. An update whose every key the reader is withheld
 * then reached the reader as a row with an empty change, and its summary,
 * actor and timestamp said when the record changed: an org peer read each
 * sign-in time of a colleague that way. The ruled rule:
 *
 *  - an update row whose STORED change had keys, every one of which the reader
 *    is withheld, is withheld from that reader;
 *  - a row whose stored change was empty for everyone is unaffected;
 *  - creates and deletes keep their rows;
 *  - the count and every listing face agree with the rows served.
 *
 * [ADR-0139 E6] The rule is a predicate over the writer-stamped
 * `changed_fields` column (`activity-changed-fields.ts`), with no SYSTEM
 * pre-scan: the same scene, read through it, plus the unstamped row it
 * withholds from every non-system reader.
 *
 * ## Why a real engine, a real driver and the real plugin
 *
 * The rule is a WHERE the redaction's middleware ANDs into the read, so whether
 * it selects the right rows, and whether `count`, `aggregate`, a page and a
 * by-id read agree with `find`, is a question about the Filter Protocol as a
 * driver executes it. The rows are written by the real CRUD mirror, stored by a
 * real SQLite driver and read back through the real middleware chain mounted by
 * `AuditPlugin` at `kernel:ready`.
 *
 * ## The one stand-in
 *
 * The security service, answering the two contract members the redaction
 * asks, per reader, in the contract's shape. Which declaration produces which
 * answer is the security plugin's derivation, pinned on a real boot in the
 * dogfood suite (`activity-withheld-update.dogfood.test.ts`).
 *
 * ⚠️ Disclosure discipline: no test title states a value.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { AuditPlugin } from './audit-plugin.js';
import { computeWithheldRowFilter, keptRowsOfParent } from './activity-field-redaction.js';
import { planActivityStamp } from './activity-changed-fields.js';

const ACTIVITY = 'sys_activity';
/** A record the member reads with two fields withheld. */
const ITEM = 'awu_item';
/** A record the member reads with NO field served: every change is withheld. */
const SEALED = 'awu_sealed';
const HARNESS_PACKAGE = 'com.objectstack.audit.test.activity-withheld-update';

const SYS = { isSystem: true } as const;
/** Withheld `f_admin` and `f_admin2` of the item, and every field of the sealed record. */
const MEMBER = { userId: 'u_member', tenantId: 'org_1', positions: ['org_member'] };
/** Served every field: the admin. */
const ADMIN = { userId: 'u_admin', tenantId: 'org_1', positions: ['org_admin'] };

const WITHHELD = new Set(['f_admin', 'f_admin2']);

const itemObject = {
  name: ITEM,
  label: 'Withheld Update Item',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' as const },
    f_open: { name: 'f_open', label: 'Open', type: 'text' as const },
    f_admin: { name: 'f_admin', label: 'Admin One', type: 'text' as const },
    f_admin2: { name: 'f_admin2', label: 'Admin Two', type: 'text' as const },
    f_internal: { name: 'f_internal', label: 'Internal', type: 'text' as const, internal: true },
  },
};
const sealedObject = {
  name: SEALED,
  label: 'Withheld Update Sealed',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' as const },
    s_admin: { name: 's_admin', label: 'Sealed Admin', type: 'text' as const },
  },
};

type Row = Record<string, any>;
const meta = (r: Row | undefined) => (typeof r?.metadata === 'string' ? JSON.parse(r.metadata) : null);
const changeKeys = (r: Row | undefined) => {
  const m = meta(r);
  return [...new Set([...Object.keys(m?.old ?? {}), ...Object.keys(m?.new ?? {})])].sort();
};
const ORDER = [{ field: 'timestamp', order: 'asc' as const }, { field: 'id', order: 'asc' as const }];

describe('[#21388] an update whose every recorded change is withheld from the reader is withheld as a row', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  const ids: Record<string, string> = {};
  /** The mirror rows, classified ONCE from the at-rest read. */
  const rowIds: Record<string, string> = {};

  const allFields = (object: string): string[] =>
    Object.keys(((engine as any).getSchema(object)?.fields ?? {}) as Record<string, unknown>);

  /** The double: the two field members, answered per reader, and the two read halves (below). */
  const security = {
    async getReadableFields(object: string, context?: any): Promise<string[] | undefined> {
      const all = allFields(object);
      if (context?.userId === MEMBER.userId) {
        if (object === ITEM) return all.filter((f) => !WITHHELD.has(f));
        if (object === SEALED) return [];
      }
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
    // The engine's fallback admission when `canReadObject` is absent. Like
    // plugin-security's (measured), it explains a principal's access and
    // answers a SYSTEM context "not allowed".
    async explain(_request: { object: string }, context?: any): Promise<{ allowed: boolean }> {
      return { allowed: !context?.isSystem };
    },
  };

  const scoped = (object: string, record: string) => ({ object_name: object, record_id: record });
  const read = (context: any, object = ITEM, record = ids.item) =>
    engine.find(ACTIVITY, { where: scoped(object, record), orderBy: ORDER, context }) as Promise<Row[]>;

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
    engine.registry.registerObject(sealedObject as any, HARNESS_PACKAGE);
    await engine.syncSchemas();

    // Every row below is written by the real audit writer's CRUD mirror.
    const update = (object: string, id: string, patch: Row) =>
      engine.update(object, patch, { where: { id }, context: SYS });
    ids.item = (await engine.insert(
      ITEM,
      { name: 'item', f_open: 'o1', f_admin: 'a1', f_admin2: 'b1', f_internal: 'i1' },
      { context: SYS },
    )).id;
    await update(ITEM, ids.item, { f_admin: 'a2', f_admin2: 'b2' }); // withheld whole
    await update(ITEM, ids.item, { f_open: 'o2', f_admin: 'a3' }); // mixed
    await update(ITEM, ids.item, { f_internal: 'i2' }); // empty for everyone
    await update(ITEM, ids.item, { f_open: 'o3' }); // served whole
    ids.sealed = (await engine.insert(SEALED, { name: 'sealed', s_admin: 's1' }, { context: SYS })).id;
    await update(SEALED, ids.sealed, { s_admin: 's2' });

    const atRest = await read(SYS);
    const idOf = (pick: (r: Row) => boolean) => String(atRest.find(pick)?.id ?? '');
    const keys = (r: Row) => changeKeys(r).join();
    rowIds.created = idOf((r) => r.type === 'created');
    rowIds.withheld = idOf((r) => r.type === 'updated' && keys(r) === 'f_admin,f_admin2');
    rowIds.mixed = idOf((r) => r.type === 'updated' && keys(r) === 'f_admin,f_open' && meta(r).new.f_open === 'o2');
    rowIds.empty = idOf((r) => r.type === 'updated' && keys(r) === '');
    rowIds.served = idOf((r) => r.type === 'updated' && keys(r) === 'f_open' && meta(r).new.f_open === 'o3');
    const sealedRows = (await engine.find(ACTIVITY, { where: { object_name: SEALED }, context: SYS })) as Row[];
    rowIds.sealedCreated = String(sealedRows.find((r) => r.type === 'created')?.id ?? '');
    rowIds.sealedUpdated = String(sealedRows.find((r) => r.type === 'updated')?.id ?? '');

    // [ADR-0139 E6] An app's own row, inserted with no stamp of its own: the
    // before-insert hook stamps it `[]` (not a recorded change), so it is kept.
    rowIds.note = String(
      (await engine.insert(
        ACTIVITY,
        {
          type: 'note',
          summary: 'a note',
          timestamp: new Date().toISOString(),
          object_name: ITEM,
          record_id: ids.item,
          metadata: JSON.stringify({ channel: 'call' }),
          // A writer's own value is not the stamp: the planner's is.
          changed_fields: ['f_open'],
        },
        { context: SYS },
      )).id,
    );
  }, 120_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    }
  }, 30_000);

  // ── the scene ───────────────────────────────────────────────────────────

  it('control: at rest, the mirror wrote every class of row this file reasons about', async () => {
    for (const [name, id] of Object.entries(rowIds)) expect(id, name).toBeTruthy();
    const atRest = await read(SYS);
    const byId = (id: string) => atRest.find((r) => r.id === id);
    // The empty-for-everyone row really is empty at rest: the writer omits an
    // `internal` field from both sides, so this is not a redaction artefact.
    expect(meta(byId(rowIds.empty))).toMatchObject({ old: {}, new: {} });
    expect(changeKeys(byId(rowIds.withheld))).toEqual(['f_admin', 'f_admin2']);
    expect(atRest).toHaveLength(6);
  });

  it('[ADR-0139 E6] at rest, every row carries the planner\'s stamp of its recorded change', async () => {
    const atRest = await read(SYS);
    const stampOf = (id: string) => {
      const row = atRest.find((r) => r.id === id);
      return { changed_fields: row?.changed_fields, milestone_key: row?.milestone_key ?? null };
    };
    expect(stampOf(rowIds.withheld)).toEqual({ changed_fields: ['f_admin', 'f_admin2'], milestone_key: null });
    expect(stampOf(rowIds.mixed)).toEqual({ changed_fields: ['f_admin', 'f_open'], milestone_key: null });
    expect(stampOf(rowIds.empty)).toEqual({ changed_fields: [], milestone_key: null });
    expect(stampOf(rowIds.created)).toEqual({ changed_fields: [], milestone_key: null });
    // The hook's answer, over the writer's own value.
    expect(stampOf(rowIds.note)).toEqual({ changed_fields: [], milestone_key: null });
    for (const row of atRest) expect(row.changed_fields, String(row.id)).toEqual(planActivityStamp(row.metadata)?.changed_fields);
  });

  // ── the card's three pins ───────────────────────────────────────────────

  it('the member gets no row for an update whose every recorded key it is withheld', async () => {
    const rows = await read(MEMBER);
    expect(rows.map((r) => r.id)).not.toContain(rowIds.withheld);
  });

  it('the admin gets that row, with its change', async () => {
    const row = (await read(ADMIN)).find((r) => r.id === rowIds.withheld);
    expect(row).toBeTruthy();
    expect(changeKeys(row)).toEqual(['f_admin', 'f_admin2']);
  });

  it('a mixed update is still served to the member, with the served key and without the withheld one', async () => {
    const row = (await read(MEMBER)).find((r) => r.id === rowIds.mixed);
    expect(row).toBeTruthy();
    expect(changeKeys(row)).toEqual(['f_open']);
  });

  // ── what the rule leaves alone ──────────────────────────────────────────

  it('a row whose recorded change was empty for everyone is unaffected', async () => {
    expect((await read(MEMBER)).map((r) => r.id)).toContain(rowIds.empty);
  });

  it('a create keeps its row even when every recorded key is withheld', async () => {
    // A delete keeps its row by the same shape test (`isWithheldOnlyUpdate`
    // below); on a read it is the parent gate's, which serves no row about a
    // record that no longer exists.
    const rows = (await engine.find(ACTIVITY, { where: { object_name: SEALED }, context: MEMBER })) as Row[];
    expect(rows.map((r) => r.id)).toEqual([rowIds.sealedCreated]);
    expect(changeKeys(rows[0])).toEqual([]);
    expect(rowIds.sealedUpdated).toBeTruthy();
  });

  it('the member is served exactly the other rows', async () => {
    expect((await read(MEMBER)).map((r) => r.id)).toEqual(
      [rowIds.created, rowIds.mixed, rowIds.empty, rowIds.served, rowIds.note],
    );
  });

  // ── every listing face agrees with the rows served ──────────────────────

  it('count: the member total agrees with the served rows', async () => {
    const rows = await read(MEMBER);
    expect(await engine.count(ACTIVITY, { where: scoped(ITEM, ids.item) }, { context: MEMBER })).toBe(rows.length);
    expect(await engine.count(ACTIVITY, { where: scoped(ITEM, ids.item) }, { context: ADMIN })).toBe(rows.length + 1);
  });

  it('aggregate: a grouped count agrees with the served rows', async () => {
    const groups = await engine.aggregate(ACTIVITY, {
      where: scoped(ITEM, ids.item),
      groupBy: ['type'],
      aggregations: [{ function: 'count', alias: 'n' }],
      context: MEMBER,
    });
    const byType = Object.fromEntries(groups.map((g: Row) => [g.type, Number(g.n)]));
    expect(byType).toEqual({ created: 1, updated: 3, note: 1 });
  });

  it('pages: walking the list one row at a time serves the same rows, and the withheld one on no page', async () => {
    const walked: string[] = [];
    for (let offset = 0; offset < 10; offset++) {
      const page = (await engine.find(ACTIVITY, {
        where: scoped(ITEM, ids.item), orderBy: ORDER, limit: 1, offset, context: MEMBER,
      })) as Row[];
      if (page.length === 0) break;
      walked.push(String(page[0].id));
    }
    expect(walked).toEqual((await read(MEMBER)).map((r) => String(r.id)));
  });

  it('[ADR-0139 E5, E6] with no canReadObject on the service, the row is still withheld', async () => {
    // The read gate then answers by its bounded probe; the withheld-row rule
    // reads no row at all, so it judges the same rows either way.
    const own = Object.getOwnPropertyDescriptor(security, 'canReadObject');
    expect(own, 'the double carries canReadObject as its own member').toBeTruthy();
    delete (security as { canReadObject?: unknown }).canReadObject;
    try {
      const rows = await read(MEMBER);
      expect(rows.map((r) => r.id)).not.toContain(rowIds.withheld);
      // Armed: the member is still served the rows it is served with the admission.
      expect(rows.map((r) => r.id).sort()).toEqual(
        [rowIds.created, rowIds.mixed, rowIds.empty, rowIds.served, rowIds.note].sort(),
      );
    } finally {
      Object.defineProperty(security, 'canReadObject', own!);
    }
  });

  it('findOne: the withheld row is absent by id for the member and present for the admin', async () => {
    expect(await engine.findOne(ACTIVITY, { where: { id: rowIds.withheld }, context: MEMBER })).toBeNull();
    expect((await engine.findOne(ACTIVITY, { where: { id: rowIds.mixed }, context: MEMBER }))?.id).toBe(rowIds.mixed);
    expect((await engine.findOne(ACTIVITY, { where: { id: rowIds.withheld }, context: ADMIN }))?.id).toBe(rowIds.withheld);
  });

  // A row at rest from before the column existed: the stamp cleared, as the
  // platform (the migration door's own context).
  it('[ADR-0139 E6] an unstamped row is withheld from the member and the admin, served to a system read, and served again once stamped', async () => {
    const id = rowIds.served;
    const restamp = (changed: unknown) =>
      engine.update(ACTIVITY, { id, changed_fields: changed }, { context: SYS });
    await restamp(null);
    try {
      expect((await read(MEMBER)).map((r) => r.id)).not.toContain(id);
      expect((await read(ADMIN)).map((r) => r.id)).not.toContain(id);
      expect(await engine.count(ACTIVITY, { where: scoped(ITEM, ids.item) }, { context: ADMIN })).toBe(5);
      expect((await read(SYS)).map((r) => r.id)).toContain(id);
    } finally {
      await restamp(['f_open']);
    }
    expect((await read(MEMBER)).map((r) => r.id)).toContain(id);
  });

  // ── [ADR-0139 E6] the stamped columns: served narrowed, never probed ─────

  it('[ADR-0139 E6] the recorded change\'s key set is served narrowed to the fields the reader is served', async () => {
    const memberRow = (await read(MEMBER)).find((r) => r.id === rowIds.mixed);
    const adminRow = (await read(ADMIN)).find((r) => r.id === rowIds.mixed);
    expect(memberRow?.changed_fields).toEqual(['f_open']);
    expect(adminRow?.changed_fields).toEqual(['f_admin', 'f_open']);
  });

  it('[ADR-0139 E6] a membership probe on either stamped column is refused to a reader withheld a parent field, matching or not', async () => {
    for (const where of [
      { changed_fields: { $contains: 'f_admin' } },
      { changed_fields: { $contains: 'f_none' } },
      { milestone_key: { $null: false } },
    ]) {
      const pinned = { ...scoped(ITEM, ids.item), ...where };
      for (const run of [
        () => engine.find(ACTIVITY, { where: pinned, context: MEMBER }),
        () => engine.count(ACTIVITY, { where: pinned }, { context: MEMBER }),
      ]) {
        await expect(run(), JSON.stringify(where)).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
      }
    }
  });

  it('[ADR-0139 E6] control: a reader served every field filters by the key set, as by any column', async () => {
    const rows = (await engine.find(ACTIVITY, {
      where: { ...scoped(ITEM, ids.item), changed_fields: { $contains: 'f_admin2' } },
      context: ADMIN,
    })) as Row[];
    expect(rows.map((r) => r.id)).toEqual([rowIds.withheld]);
  });

  it('a system read is not narrowed', async () => {
    expect((await read(SYS)).map((r) => r.id)).toContain(rowIds.withheld);
  });
});

describe('[ADR-0139 E6] planActivityStamp — the one derivation of the stamp', () => {
  it('an update: the key union of both recorded sides, sorted', () => {
    expect(planActivityStamp({ old: { b: 1, a: 1 }, new: { a: 2, c: 3 } })).toEqual({
      changed_fields: ['a', 'b', 'c'],
      milestone_key: null,
    });
  });

  it('a change empty on both sides, a create, a delete and a non-change stamp an empty set', () => {
    for (const metadata of [
      { old: {}, new: {} },
      { old: null, new: { a: 1 } },
      { old: { a: 1 }, new: null },
      { channel: 'email' },
      null,
      '',
      'not json',
      JSON.stringify({ old: { a: 1 }, new: null }),
    ]) {
      expect(planActivityStamp(metadata), JSON.stringify(metadata)).toEqual({ changed_fields: [], milestone_key: null });
    }
  });

  it('reads the stored string exactly as the object a writer is about to serialize', () => {
    const metadata = { old: { a: 1 }, new: { a: 2 } };
    expect(planActivityStamp(JSON.stringify(metadata))).toEqual(planActivityStamp(metadata));
  });
});

describe('[ADR-0139 E6] keptRowsOfParent / computeWithheldRowFilter — a predicate, no row read', () => {
  const engineWith = (objects: Array<{ name: string; activityMilestones?: unknown }>) => ({
    registry: { getAllObjects: () => objects },
    getSchema: (name: string) => objects.find((o) => o.name === name),
    find: vi.fn(),
  });

  it('one $contains per served field, and the empty set kept', () => {
    expect(keptRowsOfParent('obj', ['open', 'b_open'], [])).toEqual({
      $and: [
        { object_name: 'obj' },
        { changed_fields: { $null: false } },
        {
          $or: [
            { changed_fields: { $empty: true } },
            { changed_fields: { $contains: 'b_open' } },
            { changed_fields: { $contains: 'open' } },
          ],
        },
        { milestone_key: { $null: true } },
      ],
    });
  });

  it('a parent the service gives no answer for is kept whole; with no answer for any, no filter at all', async () => {
    const engine = engineWith([{ name: 'a' }, { name: 'b' }]);
    const servedFor = async (o: string) => (o === 'a' ? ['x'] : undefined);
    expect(await computeWithheldRowFilter(engine, {}, servedFor, { warn: vi.fn() })).toEqual({
      $or: [keptRowsOfParent('a', ['x'], []), { object_name: 'b' }],
    });
    expect(await computeWithheldRowFilter(engine, {}, async () => undefined, { warn: vi.fn() })).toBeNull();
    expect(engine.find).not.toHaveBeenCalled();
  });

  it('a read pinned to one parent object is judged against that parent alone', async () => {
    const engine = engineWith([{ name: 'a' }, { name: 'b' }]);
    const servedFor = vi.fn(async () => ['x']);
    const where = { $and: [{ object_name: 'b' }, { record_id: '1' }] };
    expect(await computeWithheldRowFilter(engine, { where }, servedFor, { warn: vi.fn() })).toEqual(
      keptRowsOfParent('b', ['x'], []),
    );
    expect(servedFor).toHaveBeenCalledTimes(1);
  });

  it('the audit and activity objects themselves are not enumerated (the read gate excludes their rows)', async () => {
    const engine = engineWith([{ name: 'sys_activity' }, { name: 'sys_audit_log' }, { name: 'a' }]);
    expect(await computeWithheldRowFilter(engine, {}, async () => ['x'], { warn: vi.fn() })).toEqual(
      keptRowsOfParent('a', ['x'], []),
    );
  });

  it('an engine with no registry view: denied, and said once', async () => {
    const logger = { warn: vi.fn() };
    const engine = { find: vi.fn() };
    const filter = await computeWithheldRowFilter(engine, {}, async () => ['x'], logger);
    expect(filter).toEqual({ id: '__activity_withheld_row_denied__' });
    await computeWithheldRowFilter(engine, {}, async () => ['x'], logger);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(engine.find).not.toHaveBeenCalled();
  });
});
