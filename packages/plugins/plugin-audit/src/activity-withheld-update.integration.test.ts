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
import { computeWithheldUpdateFilter, isWithheldOnlyUpdate } from './activity-field-redaction.js';
import { PARENT_GATE_SCAN_LIMIT } from './parent-record-read-gate.js';

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

  /** The double: the two contract members, answered per reader. */
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
    expect(atRest).toHaveLength(5);
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
      [rowIds.created, rowIds.mixed, rowIds.empty, rowIds.served],
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
    expect(byType).toEqual({ created: 1, updated: 3 });
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

  it('findOne: the withheld row is absent by id for the member and present for the admin', async () => {
    expect(await engine.findOne(ACTIVITY, { where: { id: rowIds.withheld }, context: MEMBER })).toBeNull();
    expect((await engine.findOne(ACTIVITY, { where: { id: rowIds.mixed }, context: MEMBER }))?.id).toBe(rowIds.mixed);
    expect((await engine.findOne(ACTIVITY, { where: { id: rowIds.withheld }, context: ADMIN }))?.id).toBe(rowIds.withheld);
  });

  it('a system read is not narrowed', async () => {
    expect((await read(SYS)).map((r) => r.id)).toContain(rowIds.withheld);
  });
});

describe('[#21388] isWithheldOnlyUpdate reads the stored change', () => {
  const served = new Set(['open']);

  it('an update every key of which is withheld', () => {
    expect(isWithheldOnlyUpdate({ old: { a: 1 }, new: { a: 2, b: 3 } }, served)).toBe(true);
  });

  it('a key on either side that is served keeps the row', () => {
    expect(isWithheldOnlyUpdate({ old: { a: 1, open: 1 }, new: { a: 2 } }, served)).toBe(false);
    expect(isWithheldOnlyUpdate({ old: {}, new: { open: 1 } }, served)).toBe(false);
  });

  it('a change empty on both sides, a create, a delete and a non-change are not withheld', () => {
    expect(isWithheldOnlyUpdate({ old: {}, new: {} }, served)).toBe(false);
    expect(isWithheldOnlyUpdate({ old: null, new: { a: 1 } }, served)).toBe(false);
    expect(isWithheldOnlyUpdate({ old: { a: 1 }, new: null }, served)).toBe(false);
    expect(isWithheldOnlyUpdate({ channel: 'email' }, served)).toBe(false);
    expect(isWithheldOnlyUpdate(null, served)).toBe(false);
  });
});

describe('[#21388] computeWithheldUpdateFilter — the pre-scan bound fails closed', () => {
  const update = (i: number, key: string) => ({
    id: `r${i}`,
    object_name: 'obj',
    metadata: JSON.stringify({ old: { [key]: 1 }, new: { [key]: 2 } }),
  });
  const engineOf = (rows: Row[]) => ({ find: vi.fn(async () => rows) });
  const servedFor = async () => ['open'];

  it('under the bound: the withheld ids are ANDed out, and nothing else', async () => {
    const logger = { warn: vi.fn() };
    const rows = [update(1, 'secret'), update(2, 'open')];
    expect(await computeWithheldUpdateFilter(engineOf(rows), { where: { a: 1 } }, servedFor, logger))
      .toEqual({ id: { $nin: ['r1'] } });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('nothing withheld: no filter at all', async () => {
    const logger = { warn: vi.fn() };
    expect(await computeWithheldUpdateFilter(engineOf([update(1, 'open')]), {}, servedFor, logger)).toBeNull();
  });

  it('at the bound: only the judged, kept rows are served, and that is said', async () => {
    const logger = { warn: vi.fn() };
    const rows = Array.from({ length: PARENT_GATE_SCAN_LIMIT }, (_, i) => update(i, i === 0 ? 'secret' : 'open'));
    const filter = (await computeWithheldUpdateFilter(engineOf(rows), {}, servedFor, logger)) as Row;
    expect(filter.id.$in).toHaveLength(PARENT_GATE_SCAN_LIMIT - 1);
    expect(filter.id.$in).not.toContain('r0');
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('the pre-scan reads as the system, in the caller order, within the bound', async () => {
    const engine = engineOf([]);
    const orderBy = [{ field: 'timestamp', order: 'desc' }];
    await computeWithheldUpdateFilter(engine, { where: { a: 1 }, orderBy }, servedFor, { warn: vi.fn() });
    expect(engine.find).toHaveBeenCalledWith(ACTIVITY, expect.objectContaining({
      where: { a: 1 }, orderBy, limit: PARENT_GATE_SCAN_LIMIT, context: { isSystem: true },
    }));
  });
});
