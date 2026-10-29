// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The shared driver conformance case-sets (`@objectstack/spec/data`
 * `*-conformance.ts`), run against driver-odata the way it is served: a
 * plugin driver on a `schemaMode: 'external'` datasource, behind the real
 * engine's floor, over an in-process OData v4 service
 * (`__fixtures__/odata-service.ts`) that evaluates the `$filter` the driver
 * writes.
 *
 * The read case-sets run twice, over an `ordinal` service and over a
 * `case-insensitive` one: a service's collation is its own, and the driver's
 * rule is that it only ever asks a WIDER question, which the floor then
 * narrows. Both runs must answer the case's rows exactly.
 *
 * - FILTER_LOGIC, FILTER_COMPARAND_TYPE, TEMPORAL, TEMPORAL_TIME:
 *   `engine.find` with the case's `where`.
 * - FILTER_TEXT: the floored driver's `find`, beneath the engine's
 *   declared-type door (which refuses a text operator on a number field
 *   before any driver is asked), as the case-set's no-match rows require.
 * - PAGINATION, PAGINATION_UNORDERED, PAGINATION_ZERO_LIMIT: a walk of
 *   `engine.find` pages; the service pages its answers too
 *   (`@odata.nextLink`).
 * - AGGREGATION: `engine.aggregate` — the floor hides `aggregate`, so the
 *   engine aggregates the floored rows in memory.
 * - READABLE_IDS: every case is refused, loudly, in the READABLE_IDS_REFUSAL
 *   envelope, by the driver itself and by the floored driver, with nothing
 *   sent: `$filter` has no tenant-walled semi-join (ADR-0139 D3's "or refused
 *   loudly").
 * - VALUE_ROUNDTRIP: the driver's own `create` then `find`: what was written is
 *   what is read back, type included.
 */

import { describe, expect, it } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import {
  AGGREGATION_CASES,
  AGGREGATION_ROWS,
  FILTER_COMPARAND_TYPE_CASES,
  FILTER_COMPARAND_TYPE_ROWS,
  FILTER_LOGIC_CASES,
  FILTER_LOGIC_ROWS,
  FILTER_TEXT_CASES,
  FILTER_TEXT_ROWS,
  PAGINATION_ALL_IDS,
  PAGINATION_CASES,
  PAGINATION_ROWS,
  PAGINATION_UNORDERED_CASES,
  PAGINATION_ZERO_LIMIT_CASES,
  READABLE_IDS_CASES,
  READABLE_IDS_CHILD_ROWS,
  READABLE_IDS_REFUSAL,
  TEMPORAL_CASES,
  TEMPORAL_ROWS,
  TEMPORAL_TIME_CASES,
  TEMPORAL_TIME_ROWS,
  VALUE_ROUNDTRIP_CASES,
  VALUE_ROUNDTRIP_FIELDS,
  valueRoundTripDivergence,
  type FilterTextCase,
  type FilterTextRejectionCase,
} from '@objectstack/spec/data';
import { parseODataDriverConfig } from './config.js';
import { ODataDriver } from './odata-driver.js';
import { CONFORMANCE_ROOT, odataService, type ServiceProperty } from './__fixtures__/odata-service.js';

type Row = Record<string, unknown>;
const SYSTEM = { context: { isSystem: true } };
const DATASOURCE = 'conformance';
const OBJECT = 'conformance_row';
const ENTITY_SET = 'Rows';
const COLLATIONS = ['ordinal', 'case-insensitive'] as const;

const sortedIds = (rows: Row[]) => rows.map((r) => String(r.id)).sort();

/** A driver over a fresh service holding `rows`, behind the engine floor, with `fields` declared on the object. */
async function boot(opts: {
  properties: ServiceProperty[];
  rows: readonly object[];
  fields: Record<string, unknown>;
  collation?: (typeof COLLATIONS)[number];
  serverPageSize?: number;
}) {
  const service = odataService({
    entitySet: ENTITY_SET,
    properties: opts.properties,
    rows: opts.rows.map((r) => ({ ...r }) as Row),
    ...(opts.collation ? { collation: opts.collation } : {}),
    ...(opts.serverPageSize ? { serverPageSize: opts.serverPageSize } : {}),
  });
  const driver = new ODataDriver(parseODataDriverConfig({ name: DATASOURCE, serviceRoot: CONFORMANCE_ROOT }), { fetch: service.fetch });
  const engine = new ObjectQL();
  engine.registerDriver(driver);
  engine.registerDatasourceDef({ name: DATASOURCE, driver: DATASOURCE, schemaMode: 'external', external: { allowWrites: true } });
  engine.registerApp({
    id: 'conformance_pkg',
    name: 'Conformance',
    objects: [{ name: OBJECT, datasource: DATASOURCE, external: { remoteName: ENTITY_SET, writable: true }, fields: opts.fields }],
  } as never);
  await engine.syncSchemas();
  // The driver as the engine holds it: behind the floor, beneath the engine's own query doors.
  const floored = engine.getDriverByName(DATASOURCE)!;
  return { engine, driver, floored, service };
}

const text = { type: 'text' } as const;
const STRING = (name: string, nullable = true): ServiceProperty => ({ name, type: 'Edm.String', nullable });

describe.each(COLLATIONS)('driver-odata conformance over a %s service', (collation) => {
  describe('FILTER_LOGIC_CASES', () => {
    const columns = ['a', 'b', 'c', 'd', 'owner', 'status', 'parent_object', 'parent_id'];
    const setup = () => boot({
      collation,
      properties: [STRING('id', false), ...columns.map((c) => STRING(c))],
      rows: FILTER_LOGIC_ROWS,
      fields: Object.fromEntries(columns.map((c) => [c, text])),
    });
    for (const c of FILTER_LOGIC_CASES) {
      it(c.name, async () => {
        const { engine } = await setup();
        expect(sortedIds(await engine.find(OBJECT, { where: c.filter, ...SYSTEM } as never)), c.note).toEqual([...c.expected]);
      });
    }
  });

  describe('FILTER_TEXT_CASES', () => {
    const setup = () => boot({
      collation,
      properties: [STRING('id', false), STRING('name'), { name: 'score', type: 'Edm.Int32' }],
      rows: FILTER_TEXT_ROWS,
      fields: { name: text, score: { type: 'number' } },
    });
    const isRejection = (c: FilterTextCase): c is FilterTextRejectionCase => c.expectRejection === true;
    for (const c of FILTER_TEXT_CASES) {
      if (isRejection(c)) {
        it(`${c.name} — refused in the ADR-0112 envelope`, async () => {
          const { floored } = await setup();
          const err = await floored.find(OBJECT, { where: c.filter }).then(() => undefined, (e: unknown) => e);
          expect(err, c.note ?? 'expected a refusal').toMatchObject({ code: c.code, status: 400 });
          for (const mention of c.mustMention) expect((err as Error).message).toContain(mention);
        });
      } else {
        it(c.name, async () => {
          const { floored } = await setup();
          expect(sortedIds(await floored.find(OBJECT, { where: c.filter })), c.note).toEqual([...c.expected]);
        });
      }
    }
  });

  describe('FILTER_COMPARAND_TYPE_CASES', () => {
    const setup = () => boot({
      collation,
      properties: [
        STRING('id', false), { name: 'qty', type: 'Edm.Int32' }, STRING('label'),
        { name: 'active', type: 'Edm.Boolean' }, STRING('note'),
      ],
      rows: FILTER_COMPARAND_TYPE_ROWS,
      fields: { qty: { type: 'number' }, label: text, active: { type: 'boolean' }, note: text },
    });
    for (const c of FILTER_COMPARAND_TYPE_CASES) {
      it(`${c.name} (${c.verdict})`, async () => {
        const { engine } = await setup();
        const read = engine.find(OBJECT, { where: c.filter(), ...SYSTEM } as never);
        if (c.verdict === 'matches') expect(sortedIds(await read), c.note).toEqual([...c.expected]);
        else if (c.verdict === 'compiles') await expect(read, c.note).resolves.toBeInstanceOf(Array);
        else {
          const err = await read.then(() => undefined, (e: unknown) => e);
          expect(err, c.note).toMatchObject({ code: c.code, status: 400 });
          for (const mention of c.mustMention) expect((err as Error).message).toContain(mention);
        }
      });
    }
  });

  describe('TEMPORAL_CASES', () => {
    const setup = () => boot({
      collation,
      properties: [
        STRING('id', false), { name: 'at', type: 'Edm.DateTimeOffset' }, { name: 'on', type: 'Edm.Date' }, STRING('why'),
      ],
      rows: TEMPORAL_ROWS.map((r) => ({ id: r.id, at: r.at, on: r.on, why: r.why })),
      fields: { at: { type: 'datetime' }, on: { type: 'date' }, why: text },
    });
    for (const c of TEMPORAL_CASES) {
      it(c.name, async () => {
        const { engine } = await setup();
        expect(sortedIds(await engine.find(OBJECT, { where: c.filter, ...SYSTEM } as never)), c.note).toEqual([...c.expected].sort());
      });
    }
  });

  describe('TEMPORAL_TIME_CASES', () => {
    const setup = () => boot({
      collation,
      properties: [STRING('id', false), { name: 'at', type: 'Edm.TimeOfDay' }, STRING('why')],
      rows: TEMPORAL_TIME_ROWS.map((r) => ({ id: r.id, at: r.at, why: r.why })),
      fields: { at: { type: 'time' }, why: text },
    });
    for (const c of TEMPORAL_TIME_CASES) {
      it(c.name, async () => {
        const { engine } = await setup();
        expect(sortedIds(await engine.find(OBJECT, { where: c.filter, ...SYSTEM } as never)), c.note).toEqual([...c.expected].sort());
      });
    }
  });

  describe('PAGINATION cases', () => {
    // A service page of 5 rows, so a walk crosses `@odata.nextLink`.
    const setup = () => boot({
      collation,
      serverPageSize: 5,
      properties: [STRING('id', false), STRING('status'), { name: 'rank', type: 'Edm.Int32' }, STRING('name')],
      rows: PAGINATION_ROWS,
      fields: { status: text, rank: { type: 'number' }, name: text },
    });
    const walk = async (engine: ObjectQL, orderBy: unknown, pageSize: number) => {
      const visited: Row[] = [];
      for (let offset = 0; offset < PAGINATION_ROWS.length; offset += pageSize) {
        visited.push(...await engine.find(OBJECT, { ...(orderBy ? { orderBy } : {}), limit: pageSize, offset, ...SYSTEM } as never));
      }
      return visited;
    };

    for (const c of PAGINATION_CASES) {
      it(`${c.name}: every row exactly once, in the requested order`, async () => {
        const { engine } = await setup();
        const visited = await walk(engine, c.orderBy, c.pageSize);
        expect(sortedIds(visited)).toEqual([...PAGINATION_ALL_IDS].sort());
        const whole = await engine.find(OBJECT, { orderBy: c.orderBy, ...SYSTEM } as never);
        const keys = (row: Row) => c.orderBy.map(({ field }) => row[field]);
        expect(visited.map(keys)).toEqual(whole.map(keys));
      });
    }
    for (const c of PAGINATION_UNORDERED_CASES) {
      it(`unordered — ${c.name}: every row exactly once`, async () => {
        const { engine } = await setup();
        const visited = await walk(engine, undefined, c.pageSize);
        expect(visited).toHaveLength(PAGINATION_ALL_IDS.length);
        expect(sortedIds(visited)).toEqual([...PAGINATION_ALL_IDS].sort());
      });
    }
    for (const c of PAGINATION_ZERO_LIMIT_CASES) {
      it(`zero limit — ${c.name}`, async () => {
        const { engine } = await setup();
        expect(await engine.find(OBJECT, { ...c.query, ...SYSTEM } as never)).toHaveLength(c.expectedRowCount);
      });
    }
  });
});

describe('driver-odata conformance — AGGREGATION_CASES (the engine aggregates the floored rows)', () => {
  const setup = () => boot({
    properties: [
      STRING('id', false), STRING('region'), STRING('stage'), { name: 'score', type: 'Edm.Int32' },
      { name: 'amount', type: 'Edm.Int32' }, { name: 'flag', type: 'Edm.Boolean' },
    ],
    rows: AGGREGATION_ROWS,
    fields: { region: text, stage: text, score: { type: 'number' }, amount: { type: 'number' }, flag: { type: 'boolean' } },
  });
  const byGroup = (a: { group: string | null }, b: { group: string | null }) => String(a.group).localeCompare(String(b.group));

  for (const c of AGGREGATION_CASES) {
    it(c.name, async () => {
      const { engine } = await setup();
      const rows: Row[] = await engine.aggregate(OBJECT, {
        aggregations: [{ function: c.function, ...(c.field ? { field: c.field } : {}), alias: 'n' }],
        ...(c.groupBy ? { groupBy: [c.groupByAlias ? { field: c.groupBy, alias: c.groupByAlias } : c.groupBy] } : {}),
        ...SYSTEM,
      } as never);
      const groupKey = c.groupByAlias ?? c.groupBy;
      const actual = rows.map((r) => ({ group: groupKey ? String(r[groupKey]) : null, value: r.n })).sort(byGroup);
      expect(actual, c.note ?? c.name).toEqual(c.expected.map((e) => ({ group: e.group, value: e.value })).sort(byGroup));
    });
  }
});

describe('driver-odata conformance — READABLE_IDS_CASES (refused loudly: $filter has no semi-join)', () => {
  const setup = () => boot({
    properties: [STRING('id', false), STRING('object_name'), STRING('record_id'), STRING('label'), STRING('organization_id')],
    rows: READABLE_IDS_CHILD_ROWS,
    fields: { object_name: text, record_id: text, label: text, organization_id: text },
  });
  for (const c of READABLE_IDS_CASES) {
    if (c.verdict === 'matches' && !c.holdsComposedLeaf) {
      // The engine's denial answer carries no leaf: an ordinary `where`, answered.
      it(`${c.name} — answered`, async () => {
        const { floored } = await setup();
        expect(sortedIds(await floored.find(OBJECT, { where: c.where() })), c.note).toEqual([...c.expected]);
      });
      continue;
    }
    it(`${c.name} — refused by the driver and behind the floor, nothing sent`, async () => {
      const { driver, floored, service } = await setup();
      await expect(driver.find(OBJECT, { where: c.where() }), c.note).rejects.toMatchObject(READABLE_IDS_REFUSAL);
      await expect(driver.count(OBJECT, { where: c.where() }), c.note).rejects.toMatchObject(READABLE_IDS_REFUSAL);
      await expect(floored.find(OBJECT, { where: c.where() }), c.note).rejects.toMatchObject(READABLE_IDS_REFUSAL);
      expect(service.filters).toEqual([]);
    });
  }
});

describe('driver-odata conformance — VALUE_ROUNDTRIP_CASES (create, then read back)', () => {
  // The driver alone: the case-set's field shape is the driver-level one, not an engine object's.
  const columns = Object.keys(VALUE_ROUNDTRIP_FIELDS);
  for (const c of VALUE_ROUNDTRIP_CASES) {
    it(`${c.name} (${c.column})`, async () => {
      const service = odataService({
        entitySet: ENTITY_SET,
        properties: [STRING('id', false), ...columns.map((name) => STRING(name))],
        rows: [],
      });
      const driver = new ODataDriver(parseODataDriverConfig({ name: DATASOURCE, serviceRoot: CONFORMANCE_ROOT }), { fetch: service.fetch });
      driver.registerExternalObject({ name: OBJECT, external: { remoteName: ENTITY_SET }, fields: VALUE_ROUNDTRIP_FIELDS });
      await driver.create(OBJECT, { id: `rt_${c.name}`, label: c.name, [c.column]: c.wrote });
      const [row] = await driver.find(OBJECT, { where: { id: `rt_${c.name}` } });
      expect(valueRoundTripDivergence(c, row?.[c.column]), c.note).toBeNull();
    });
  }
});
