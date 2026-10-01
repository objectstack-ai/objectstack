// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21154] A query over the activity stream's value-bearing columns, by a
 * reader the security service does not serve every field of the parent.
 *
 * The field redaction (#21081) narrows what an activity row SERVES; a filter,
 * a search, a sort or a group key over the same column is evaluated at rest,
 * before it. So for a reader withheld a parent field, a matching probe and a
 * non-matching probe are both refused, in the engine's own refusal shape; a
 * reader served every field of that parent queries the text as before.
 *
 * ## Why a real engine, a real driver and the real plugin
 *
 * The rows are written by the real audit writer's CRUD mirror and every probe
 * goes through the real engine middleware chain, with the guard mounted by
 * `AuditPlugin` itself at `kernel:ready` — a guard that stops being mounted
 * fails here like one that was never written.
 *
 * ## The one stand-in
 *
 * The security service, answering the two contract members the serve seam
 * asks (`getReadableFields`, `getQueryableFields`) per reader: a field served
 * MASKED is readable and not queryable; a field not served is in neither. On a
 * real boot the three declaration classes (a `maskingRule`, a
 * `requiredPermissions` capability, a permission set) are pinned at the HTTP
 * door in `packages/qa/dogfood/test/activity-text-predicate.dogfood.test.ts`.
 *
 * ⚠️ Disclosure discipline: no test title states a value or a column.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import type { EngineAggregateOptions, EngineQueryOptions } from '@objectstack/spec/data';

import { AuditPlugin } from './audit-plugin.js';
import { redactActivityRows } from './activity-field-redaction.js';
import { ACTIVITY_QUERY_GUARD, AUDIT_LOG_QUERY_GUARD, namedValueBearingColumns, pinnedParentObject } from './parent-field-query-guard.js';

const ACTIVITY = 'sys_activity';
const ITEM = 'apg_item';
const LABELLED = 'apg_label';
/** A parent of which the restricted readers are served every field. */
const OPEN_PARENT = 'apg_open';
const HARNESS_PACKAGE = 'com.objectstack.audit.test.activity-predicate-guard';

const SYS = { isSystem: true } as const;
/** A field of the item, and the labelled object's title, are served to this reader MASKED. */
const MASKED_READER = { userId: 'u_apg_masked', tenantId: 'org_1', positions: ['org_member'] };
/** A field of the item, and the labelled object's title, are not served to this reader. */
const UNSERVED_READER = { userId: 'u_apg_unserved', tenantId: 'org_1', positions: ['org_member'] };
/** Served every field of every object — the control. */
const CONTROL = { userId: 'u_apg_control', tenantId: 'org_1', positions: ['org_member'] };
/** The security service answers nothing about masking for this reader. */
const NO_QUERYABLE_READER = { userId: 'u_apg_noq', tenantId: 'org_1', positions: ['org_member'] };

/** Synthetic values. */
const V = {
  masked1: 'APGMASKEDONE31', masked2: 'APGMASKEDTWO32',
  unserved1: 'APGUNSERVEDONE33', unserved2: 'APGUNSERVEDTWO34',
  title: 'APGTITLE35',
  open1: 'APGOPENONE36', open2: 'APGOPENTWO37',
  none: 'APGNOMATCH38',
};

const itemObject = {
  name: ITEM,
  label: 'Guard Item',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' as const },
    f_masked: { name: 'f_masked', label: 'Masked', type: 'text' as const, trackHistory: true },
    f_unserved: { name: 'f_unserved', label: 'Unserved', type: 'text' as const, trackHistory: true },
  },
};
const labelledObject = {
  name: LABELLED,
  label: 'Guard Labelled',
  fields: { title: { name: 'title', label: 'Title', type: 'text' as const } },
};
const openObject = {
  name: OPEN_PARENT,
  label: 'Guard Open',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' as const },
    f_open: { name: 'f_open', label: 'Open', type: 'text' as const, trackHistory: true },
  },
};

type Row = Record<string, any>;
type Ctx = EngineQueryOptions['context'];

/** The class a probe is about: the column, the parent it is pinned to, and a value stored in it. */
interface ColumnCase {
  column: 'summary' | 'record_label' | 'metadata';
  parent: string;
  stored: string;
}

/** Each restricted reader, and the column cases its own withheld field reaches. */
const READER_CASES: Array<{ name: string; ctx: Ctx; cases: ColumnCase[] }> = [
  {
    name: 'served masked',
    ctx: MASKED_READER,
    cases: [
      { column: 'summary', parent: ITEM, stored: V.masked2 },
      { column: 'metadata', parent: ITEM, stored: V.masked1 },
      { column: 'record_label', parent: LABELLED, stored: V.title },
    ],
  },
  {
    name: 'not served',
    ctx: UNSERVED_READER,
    cases: [
      { column: 'summary', parent: ITEM, stored: V.unserved2 },
      { column: 'metadata', parent: ITEM, stored: V.unserved1 },
      { column: 'record_label', parent: LABELLED, stored: V.title },
    ],
  },
];

/** The engine's predicate refusal, first sentence, for `columns`. */
const predicateWords = (columns: string[]) =>
  `[Security] Access denied: query on '${ACTIVITY}' references field(s) not readable by the caller: ${columns.join(', ')}.`;
/** The engine's aggregate refusal, first sentence, for `columns`. */
const aggregateWords = (columns: string[]) =>
  `[Security] Field read denied: not permitted to aggregate [${columns.join(', ')}] on '${ACTIVITY}'.`;
const firstSentence = (message: string) => {
  const end = message.indexOf('. ');
  return end < 0 ? message : message.slice(0, end + 1);
};

/** The ADR-0112 envelope the engine's own refusal carries, and its words. */
async function expectRefused(probe: Promise<unknown>, words: string | RegExp): Promise<void> {
  let thrown: any = null;
  try {
    await probe;
  } catch (err) {
    thrown = err;
  }
  expect(thrown, 'the probe was answered instead of refused').not.toBeNull();
  expect(thrown.code).toBe('PERMISSION_DENIED');
  expect(thrown.status).toBe(403);
  expect(thrown.statusCode).toBe(403);
  if (typeof words === 'string') expect(firstSentence(String(thrown.message))).toBe(words);
  else expect(firstSentence(String(thrown.message))).toMatch(words);
}

describe('[#21154] a query over the activity text by a reader withheld a parent field is refused', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  const ids: Record<string, string> = {};

  const allFields = (object: string): string[] =>
    Object.keys(((engine as any).getSchema(object)?.fields ?? {}) as Record<string, unknown>);

  /** The double: the two contract members, answered per reader. */
  const security: {
    getReadableFields?: (object: string, context?: any) => Promise<string[] | undefined>;
    getQueryableFields: (object: string, context?: any) => Promise<string[] | undefined>;
  } = {
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
      const readable = (await security.getReadableFields!(object, context)) ?? [];
      if (context?.userId === NO_QUERYABLE_READER.userId) return undefined;
      if (context?.userId === MASKED_READER.userId) {
        if (object === ITEM) return readable.filter((f) => f !== 'f_masked');
        if (object === LABELLED) return readable.filter((f) => f !== 'title');
      }
      return readable;
    },
  };

  const find = (context: Ctx, where: Record<string, unknown>, extra: EngineQueryOptions = {}) =>
    engine.find(ACTIVITY, { where, context, ...extra }) as Promise<Row[]>;
  const contains = (c: ColumnCase, value: string, pinned = true) =>
    pinned ? { object_name: c.parent, [c.column]: { $contains: value } } : { [c.column]: { $contains: value } };
  const grouped = (context: Ctx, c: ColumnCase) => {
    const options: EngineAggregateOptions = {
      where: { object_name: c.parent },
      groupBy: [c.column],
      aggregations: [{ function: 'count', alias: 'n' }],
      context,
    };
    return engine.aggregate(ACTIVITY, options);
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
    for (const object of [itemObject, labelledObject, openObject]) {
      engine.registry.registerObject(object as any, HARNESS_PACKAGE);
    }
    await engine.syncSchemas();

    // Every row is written by the real audit writer's CRUD mirror.
    ids.item = (await engine.insert(
      ITEM,
      { name: 'item', f_masked: V.masked1, f_unserved: V.unserved1 },
      { context: SYS },
    )).id;
    await engine.update(ITEM, { f_masked: V.masked2, f_unserved: V.unserved2 }, { where: { id: ids.item }, context: SYS });
    ids.labelled = (await engine.insert(LABELLED, { title: V.title }, { context: SYS })).id;
    ids.open = (await engine.insert(OPEN_PARENT, { name: 'open', f_open: V.open1 }, { context: SYS })).id;
    await engine.update(OPEN_PARENT, { f_open: V.open2 }, { where: { id: ids.open }, context: SYS });
  }, 120_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    }
  }, 30_000);

  // ── the scene ───────────────────────────────────────────────────────────

  it('control: at rest, every matching probe matches a row and every non-matching probe matches none', async () => {
    for (const { cases } of READER_CASES) {
      for (const c of cases) {
        expect((await find(SYS, contains(c, c.stored))).length, `${c.column} matches at rest`).toBeGreaterThan(0);
        expect(await find(SYS, contains(c, V.none))).toHaveLength(0);
      }
    }
    expect((await find(SYS, { object_name: OPEN_PARENT, summary: { $contains: V.open2 } })).length).toBeGreaterThan(0);
  });

  // ── one block per class ─────────────────────────────────────────────────

  for (const reader of READER_CASES) {
    describe(`a reader withheld a parent field (${reader.name})`, () => {
      for (const [i, c] of reader.cases.entries()) {
        it(`value-bearing column ${i + 1}: a matching and a non-matching filter are both refused`, async () => {
          await expectRefused(find(reader.ctx, contains(c, c.stored)), predicateWords([c.column]));
          await expectRefused(find(reader.ctx, contains(c, V.none)), predicateWords([c.column]));
        });

        it(`value-bearing column ${i + 1}: a count under a matching and a non-matching filter is refused`, async () => {
          await expectRefused(engine.count(ACTIVITY, { where: contains(c, c.stored), context: reader.ctx }), predicateWords([c.column]));
          await expectRefused(engine.count(ACTIVITY, { where: contains(c, V.none), context: reader.ctx }), predicateWords([c.column]));
        });

        it(`value-bearing column ${i + 1}: a grouping by it is refused in the aggregate words`, async () => {
          await expectRefused(grouped(reader.ctx, c), aggregateWords([c.column]));
        });

        it(`value-bearing column ${i + 1}: a sort by it is refused`, async () => {
          await expectRefused(
            find(reader.ctx, { object_name: c.parent }, { orderBy: [{ field: c.column, order: 'asc' }] }),
            predicateWords([c.column]),
          );
        });
      }

      it('a free-text search reaching the text column is refused, matching or not', async () => {
        // The searched set is the object's (its nameField among the textual
        // columns), so the words name every value-bearing column it reaches.
        const searched = /^\[Security\] Access denied: query on 'sys_activity' references field\(s\) not readable by the caller: summary(, [a-z_]+)*\.$/;
        const c = reader.cases[0];
        await expectRefused(find(reader.ctx, { object_name: c.parent }, { search: c.stored }), searched);
        await expectRefused(find(reader.ctx, { object_name: c.parent }, { search: V.none }), searched);
      });

      it('the same reader queries the text of a parent it is served in full, as before', async () => {
        const hit = await find(reader.ctx, { object_name: OPEN_PARENT, summary: { $contains: V.open2 } });
        expect(hit.length).toBeGreaterThan(0);
        expect(await find(reader.ctx, { object_name: OPEN_PARENT, summary: { $contains: V.none } })).toHaveLength(0);
      });

      it('a query naming no value-bearing column answers as before', async () => {
        const rows = await find(reader.ctx, { object_name: ITEM, record_id: ids.item });
        expect(rows.length).toBeGreaterThanOrEqual(2);
      });
    });
  }

  // ── a query that pins no parent ─────────────────────────────────────────

  it('a filter that pins no parent object is refused for a reader withheld a field of any object the stream can concern', async () => {
    const c = READER_CASES[0].cases[0];
    for (const ctx of [MASKED_READER, UNSERVED_READER, NO_QUERYABLE_READER]) {
      await expectRefused(find(ctx, contains(c, c.stored, false)), predicateWords(['summary']));
      await expectRefused(find(ctx, contains(c, V.none, false)), predicateWords(['summary']));
    }
  });

  it('a parent named only inside an alternative is not a pin', async () => {
    await expectRefused(
      find(MASKED_READER, { $or: [{ object_name: ITEM }], summary: { $contains: V.masked2 } }),
      predicateWords(['summary']),
    );
  });

  it('control: a reader served every field of every object the stream can concern filters and searches it with no parent named, as before', async () => {
    const c = READER_CASES[0].cases[0];
    expect((await find(CONTROL, contains(c, c.stored, false))).length).toBeGreaterThan(0);
    expect(await find(CONTROL, contains(c, V.none, false))).toHaveLength(0);
    expect((await find(CONTROL, {}, { search: c.stored })).length).toBeGreaterThan(0);
    expect(await find(CONTROL, {}, { search: V.none })).toHaveLength(0);
  });

  // ── the controls ────────────────────────────────────────────────────────

  it('control: the unrestricted reader filters, groups and sorts by every value-bearing column of a pinned parent, as before', async () => {
    for (const { cases } of READER_CASES) {
      for (const c of cases) {
        expect((await find(CONTROL, contains(c, c.stored))).length).toBeGreaterThan(0);
        expect(await find(CONTROL, contains(c, V.none))).toHaveLength(0);
      }
    }
    const c = READER_CASES[0].cases[0];
    expect((await grouped(CONTROL, c)).length).toBeGreaterThan(0);
    const sorted = await find(CONTROL, { object_name: c.parent }, { orderBy: [{ field: c.column, order: 'asc' }] });
    expect(sorted.length).toBeGreaterThan(0);
  });

  it('a system read is not judged, pinned or not', async () => {
    const c = READER_CASES[0].cases[0];
    expect((await find(SYS, contains(c, c.stored, false))).length).toBeGreaterThan(0);
  });

  it('fail closed: a reader the security service has no masking answer for is refused on a pinned parent', async () => {
    const c = READER_CASES[0].cases[0];
    await expectRefused(find(NO_QUERYABLE_READER, contains(c, c.stored)), predicateWords([c.column]));
  });

  it('without a security service the text is served whole, so a filter over it answers as before', async () => {
    const readable = security.getReadableFields;
    delete security.getReadableFields;
    try {
      const c = READER_CASES[1].cases[0];
      expect((await find(UNSERVED_READER, contains(c, c.stored, false))).length).toBeGreaterThan(0);
      expect(await find(UNSERVED_READER, contains(c, V.none, false))).toHaveLength(0);
    } finally {
      security.getReadableFields = readable;
    }
  });
});

// ── the guard's own definitions ───────────────────────────────────────────

describe('[#21154] the parent-field query guard: its column lists, its pin rule and its clause walk', () => {
  const named = (ast: Record<string, unknown>) => namedValueBearingColumns(ast, ACTIVITY_QUERY_GUARD.columns);

  it('names exactly the columns the field redaction strips when it fails closed', async () => {
    const row: Record<string, unknown> = {
      id: 'a1', object_name: '', record_id: 'r1', type: 'note', url: 'u', actor_name: 'n',
      summary: 's', record_label: 'l', metadata: '{}',
    };
    const before = Object.keys(row);
    await redactActivityRows([row], { getReadableFields: async () => [], getQueryableFields: async () => [] }, {});
    const stripped = before.filter((key) => !(key in row));
    expect(stripped.sort()).toEqual([...ACTIVITY_QUERY_GUARD.columns].sort());
  });

  it('reads a pin only from an equality at the root or inside a root conjunction', () => {
    expect(pinnedParentObject({ object_name: 'acct' }, ACTIVITY)).toBe('acct');
    expect(pinnedParentObject({ object_name: { $eq: 'acct' } }, ACTIVITY)).toBe('acct');
    expect(pinnedParentObject({ $and: [{ type: 'x' }, { $and: [{ object_name: 'acct' }] }] }, ACTIVITY)).toBe('acct');
    expect(pinnedParentObject({ object_name: 'acct', $and: [{ object_name: 'acct' }] }, ACTIVITY)).toBe('acct');
    expect(pinnedParentObject({ object_name: 'acct', type: { $in: ['a', 'b'] } }, ACTIVITY)).toBe('acct');
    expect(pinnedParentObject({ object_name: 'acct', $and: [{ object_name: 'lead' }] }, ACTIVITY)).toBeNull();
    expect(pinnedParentObject({ $or: [{ object_name: 'acct' }] }, ACTIVITY)).toBeNull();
    expect(pinnedParentObject({ $not: { object_name: 'acct' } }, ACTIVITY)).toBeNull();
    expect(pinnedParentObject({ object_name: { $in: ['acct'] } }, ACTIVITY)).toBeNull();
    expect(pinnedParentObject({ object_name: { $eq: 'acct', $ne: 'lead' } }, ACTIVITY)).toBeNull();
    expect(pinnedParentObject({ object_name: ACTIVITY }, ACTIVITY)).toBeNull();
    expect(pinnedParentObject({ object_name: 'Not A Name' }, ACTIVITY)).toBeNull();
    expect(pinnedParentObject(undefined, ACTIVITY)).toBeNull();
    // On the ledger, the ledger itself is not a parent; the activity stream's rule applies otherwise.
    expect(pinnedParentObject({ object_name: 'acct' }, AUDIT_LOG_QUERY_GUARD.object)).toBe('acct');
    expect(pinnedParentObject({ object_name: AUDIT_LOG_QUERY_GUARD.object }, AUDIT_LOG_QUERY_GUARD.object)).toBeNull();
  });

  it('collects a column from every row-shaping clause, a cross-field comparand included, and not from the projection', () => {
    expect(named({ fields: ['summary', 'record_label', 'metadata'] })).toEqual({ aggregate: [], predicate: [] });
    expect(named({ where: { type: { $eq: { $field: 'summary' } } } }).predicate).toEqual(['summary']);
    expect(named({ where: { $or: [{ type: 'x' }, { $not: { record_label: 'y' } }] } }).predicate).toEqual(['record_label']);
    expect(named({ having: { metadata: 'x' } }).predicate).toEqual(['metadata']);
    expect(named({ orderBy: [{ field: 'record_label', order: 'asc' }] }).predicate).toEqual(['record_label']);
    expect(named({ groupBy: ['summary'] }).aggregate).toEqual(['summary']);
    expect(named({ groupBy: [{ field: 'metadata' }] }).aggregate).toEqual(['metadata']);
    expect(named({ aggregations: [{ function: 'max', field: 'metadata.x' }] }).aggregate).toEqual(['metadata']);
    expect(named({ aggregations: [{ function: 'count', field: '*', filter: { summary: 'x' } }] }))
      .toEqual({ aggregate: [], predicate: ['summary'] });
    expect(named({ where: { type: 'x', object_name: 'acct' }, orderBy: [{ field: 'timestamp' }] }))
      .toEqual({ aggregate: [], predicate: [] });
  });
});
