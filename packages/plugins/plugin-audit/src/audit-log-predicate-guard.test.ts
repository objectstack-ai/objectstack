// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21154] A query over the compliance ledger's before/after snapshot columns,
 * by a reader the security service does not serve every field of the parent.
 *
 * The ledger's snapshot columns carry the values of the record a row is about.
 * A filter, a search, a sort or a group key over them is evaluated at rest,
 * before any read-time narrowing, so for a reader withheld a parent field a
 * matching probe and a non-matching probe are both refused, in the engine's own
 * refusal shape; a reader served every field of that parent queries the
 * snapshots as before. The same rule, and the same guard, as the activity
 * stream's value-bearing columns (`activity-predicate-guard.test.ts`).
 *
 * ## Why a real engine, a real driver and the real plugin
 *
 * The rows are written by the real audit writer's CRUD mirror and every probe
 * goes through the real engine middleware chain, with the guard mounted by
 * `AuditPlugin` itself at `kernel:ready`.
 *
 * ## The one stand-in
 *
 * The security service, answering the two contract members the serve seam asks
 * per reader: a field served MASKED is readable and not queryable; a field not
 * served is in neither. On a real boot the three declaration classes are pinned
 * at the HTTP door in
 * `packages/qa/dogfood/test/activity-text-predicate.dogfood.test.ts`.
 *
 * ⚠️ Disclosure discipline: no test title states a value or a column.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import type { EngineAggregateOptions, EngineQueryOptions } from '@objectstack/spec/data';

import { AuditPlugin } from './audit-plugin.js';

const LEDGER = 'sys_audit_log';
const ITEM = 'alg_item';
/** A parent of which the restricted readers are served every field. */
const OPEN_PARENT = 'alg_open';
const HARNESS_PACKAGE = 'com.objectstack.audit.test.audit-log-predicate-guard';

const SYS = { isSystem: true } as const;
const MASKED_READER = { userId: 'u_alg_masked', tenantId: 'org_1', positions: ['org_member'] };
const UNSERVED_READER = { userId: 'u_alg_unserved', tenantId: 'org_1', positions: ['org_member'] };
const CONTROL = { userId: 'u_alg_control', tenantId: 'org_1', positions: ['org_member'] };

/** Synthetic values. */
const V = {
  masked1: 'ALGMASKEDONE41', masked2: 'ALGMASKEDTWO42',
  unserved1: 'ALGUNSERVEDONE43', unserved2: 'ALGUNSERVEDTWO44',
  open1: 'ALGOPENONE45', open2: 'ALGOPENTWO46',
  none: 'ALGNOMATCH47',
};

const itemObject = {
  name: ITEM,
  label: 'Ledger Guard Item',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' as const },
    f_masked: { name: 'f_masked', label: 'Masked', type: 'text' as const },
    f_unserved: { name: 'f_unserved', label: 'Unserved', type: 'text' as const },
  },
};
const openObject = {
  name: OPEN_PARENT,
  label: 'Ledger Guard Open',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' as const },
    f_open: { name: 'f_open', label: 'Open', type: 'text' as const },
  },
};

type Row = Record<string, any>;
type Ctx = EngineQueryOptions['context'];

/** Each restricted reader, and a stored value of its withheld field in each snapshot column. */
const READER_CASES: Array<{ name: string; ctx: Ctx; cases: Array<{ column: 'old_value' | 'new_value'; stored: string }> }> = [
  { name: 'served masked', ctx: MASKED_READER, cases: [{ column: 'old_value', stored: V.masked1 }, { column: 'new_value', stored: V.masked2 }] },
  { name: 'not served', ctx: UNSERVED_READER, cases: [{ column: 'old_value', stored: V.unserved1 }, { column: 'new_value', stored: V.unserved2 }] },
];

const predicateWords = (columns: string[]) =>
  `[Security] Access denied: query on '${LEDGER}' references field(s) not readable by the caller: ${columns.join(', ')}.`;
const aggregateWords = (columns: string[]) =>
  `[Security] Field read denied: not permitted to aggregate [${columns.join(', ')}] on '${LEDGER}'.`;
const firstSentence = (message: string) => {
  const end = message.indexOf('. ');
  return end < 0 ? message : message.slice(0, end + 1);
};

async function expectRefused(probe: Promise<unknown>, words: string): Promise<void> {
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
  expect(firstSentence(String(thrown.message))).toBe(words);
}

describe('[#21154] a query over the ledger snapshots by a reader withheld a parent field is refused', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  const ids: Record<string, string> = {};

  const allFields = (object: string): string[] =>
    Object.keys(((engine as any).getSchema(object)?.fields ?? {}) as Record<string, unknown>);

  const security: {
    getReadableFields?: (object: string, context?: any) => Promise<string[] | undefined>;
    getQueryableFields: (object: string, context?: any) => Promise<string[] | undefined>;
  } = {
    async getReadableFields(object: string, context?: any): Promise<string[] | undefined> {
      const all = allFields(object);
      if (context?.isSystem) return all;
      if (context?.userId === UNSERVED_READER.userId && object === ITEM) return all.filter((f) => f !== 'f_unserved');
      return all;
    },
    async getQueryableFields(object: string, context?: any): Promise<string[] | undefined> {
      const readable = (await security.getReadableFields!(object, context)) ?? [];
      if (context?.userId === MASKED_READER.userId && object === ITEM) return readable.filter((f) => f !== 'f_masked');
      return readable;
    },
  };

  const find = (context: Ctx, where: Record<string, unknown>, extra: EngineQueryOptions = {}) =>
    engine.find(LEDGER, { where, context, ...extra }) as Promise<Row[]>;
  const contains = (column: string, value: string, parent: string | null = ITEM) =>
    parent ? { object_name: parent, [column]: { $contains: value } } : { [column]: { $contains: value } };
  const grouped = (context: Ctx, column: string, parent = ITEM) => {
    const options: EngineAggregateOptions = {
      where: { object_name: parent },
      groupBy: [column],
      aggregations: [{ function: 'count', alias: 'n' }],
      context,
    };
    return engine.aggregate(LEDGER, options);
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
    for (const object of [itemObject, openObject]) engine.registry.registerObject(object as any, HARNESS_PACKAGE);
    await engine.syncSchemas();

    // Every ledger row is written by the real audit writer's CRUD mirror.
    ids.item = (await engine.insert(ITEM, { name: 'item', f_masked: V.masked1, f_unserved: V.unserved1 }, { context: SYS })).id;
    await engine.update(ITEM, { f_masked: V.masked2, f_unserved: V.unserved2 }, { where: { id: ids.item }, context: SYS });
    ids.open = (await engine.insert(OPEN_PARENT, { name: 'open', f_open: V.open1 }, { context: SYS })).id;
    await engine.update(OPEN_PARENT, { f_open: V.open2 }, { where: { id: ids.open }, context: SYS });
  }, 120_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    }
  }, 30_000);

  it('control: at rest, every matching probe matches a row and every non-matching probe matches none', async () => {
    for (const { cases } of READER_CASES) {
      for (const c of cases) {
        expect((await find(SYS, contains(c.column, c.stored))).length, `${c.column} matches at rest`).toBeGreaterThan(0);
        expect(await find(SYS, contains(c.column, V.none))).toHaveLength(0);
      }
    }
    expect((await find(SYS, contains('new_value', V.open2, OPEN_PARENT))).length).toBeGreaterThan(0);
  });

  for (const reader of READER_CASES) {
    describe(`a reader withheld a parent field (${reader.name})`, () => {
      for (const [i, c] of reader.cases.entries()) {
        it(`snapshot column ${i + 1}: a matching and a non-matching filter are both refused`, async () => {
          await expectRefused(find(reader.ctx, contains(c.column, c.stored)), predicateWords([c.column]));
          await expectRefused(find(reader.ctx, contains(c.column, V.none)), predicateWords([c.column]));
        });

        it(`snapshot column ${i + 1}: a count under a matching and a non-matching filter is refused`, async () => {
          await expectRefused(engine.count(LEDGER, { where: contains(c.column, c.stored), context: reader.ctx }), predicateWords([c.column]));
          await expectRefused(engine.count(LEDGER, { where: contains(c.column, V.none), context: reader.ctx }), predicateWords([c.column]));
        });

        it(`snapshot column ${i + 1}: a grouping by it is refused in the aggregate words`, async () => {
          await expectRefused(grouped(reader.ctx, c.column), aggregateWords([c.column]));
        });

        it(`snapshot column ${i + 1}: a sort by it is refused`, async () => {
          await expectRefused(find(reader.ctx, { object_name: ITEM }, { orderBy: [{ field: c.column, order: 'asc' }] }), predicateWords([c.column]));
        });
      }

      it('a free-text search reaching the snapshot columns is refused, matching or not', async () => {
        const searched = /^\[Security\] Access denied: query on 'sys_audit_log' references field\(s\) not readable by the caller: old_value, new_value\.$/;
        for (const value of [reader.cases[1].stored, V.none]) {
          let thrown: any = null;
          try {
            await find(reader.ctx, { object_name: ITEM }, { search: value });
          } catch (err) {
            thrown = err;
          }
          expect(thrown, 'the probe was answered instead of refused').not.toBeNull();
          expect(thrown.code).toBe('PERMISSION_DENIED');
          expect(firstSentence(String(thrown.message))).toMatch(searched);
        }
      });

      it('the same reader queries the snapshots of a parent it is served in full, as before', async () => {
        expect((await find(reader.ctx, contains('new_value', V.open2, OPEN_PARENT))).length).toBeGreaterThan(0);
        expect(await find(reader.ctx, contains('new_value', V.none, OPEN_PARENT))).toHaveLength(0);
      });

      it('a query naming no snapshot column answers as before', async () => {
        expect((await find(reader.ctx, { object_name: ITEM, record_id: ids.item })).length).toBeGreaterThanOrEqual(2);
      });
    });
  }

  it('a filter that pins no parent object is refused for a reader withheld a field of any object the ledger can concern', async () => {
    for (const ctx of [MASKED_READER, UNSERVED_READER]) {
      await expectRefused(find(ctx, contains('new_value', V.masked2, null)), predicateWords(['new_value']));
      await expectRefused(find(ctx, contains('new_value', V.none, null)), predicateWords(['new_value']));
    }
  });

  it('control: a reader served every field of every object the ledger can concern filters and searches it with no parent named, as before', async () => {
    expect((await find(CONTROL, contains('new_value', V.masked2, null))).length).toBeGreaterThan(0);
    expect(await find(CONTROL, contains('new_value', V.none, null))).toHaveLength(0);
    expect((await find(CONTROL, {}, { search: V.masked2 })).length).toBeGreaterThan(0);
    expect(await find(CONTROL, {}, { search: V.none })).toHaveLength(0);
  });

  it('control: the unrestricted reader filters, groups and sorts by both snapshot columns of a pinned parent, as before', async () => {
    for (const { cases } of READER_CASES) {
      for (const c of cases) {
        expect((await find(CONTROL, contains(c.column, c.stored))).length).toBeGreaterThan(0);
        expect(await find(CONTROL, contains(c.column, V.none))).toHaveLength(0);
      }
    }
    expect((await grouped(CONTROL, 'new_value')).length).toBeGreaterThan(0);
    expect((await find(CONTROL, { object_name: ITEM }, { orderBy: [{ field: 'old_value', order: 'asc' }] })).length).toBeGreaterThan(0);
  });

  it('a system read is not judged, pinned or not', async () => {
    expect((await find(SYS, contains('new_value', V.masked2, null))).length).toBeGreaterThan(0);
  });

  it('without a security service the snapshots are served whole, so a filter over them answers as before', async () => {
    const readable = security.getReadableFields;
    delete security.getReadableFields;
    try {
      expect((await find(UNSERVED_READER, contains('new_value', V.unserved2, null))).length).toBeGreaterThan(0);
      expect(await find(UNSERVED_READER, contains('new_value', V.none, null))).toHaveLength(0);
    } finally {
      security.getReadableFields = readable;
    }
  });
});
