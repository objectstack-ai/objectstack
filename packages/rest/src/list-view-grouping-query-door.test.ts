// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Server-side list-view grouping, pinned through the door it actually uses
 * (#15330) — the PLATFORM half of maintainer ruling A on objectui#7189
 * (2026-09-02, verbatim 「7189 A  其他同意」): grouping on a list view is
 * server-side, the group set and every header number are properties of the
 * QUERY, and rows inside a group are PAGED.
 *
 * ## What was unmeasured before this file
 *
 * `@objectstack/spec/ui` compiles a grouped list view into two queries —
 * {@link compileListViewGroupQuery} (the header query, an
 * `EngineAggregateOptions`) and {@link compileListViewGroupRowsQuery} (the
 * per-group row page, an `EngineQueryOptions`). Those are pinned in
 * `packages/spec/src/ui/view-grouping-query.test.ts` against a reducer written
 * inside that same test file. So the compiled SHAPE was pinned and its
 * arithmetic was pinned — against a test-local reducer. Whether the two
 * platform faces that will actually answer it agree with that reducer was
 * measured by nothing.
 *
 * This file posts the compiled queries — never a hand-written body, so the pin
 * goes red when the compiler drifts — through `POST /api/v1/data/:object/query`
 * (`rest-server.ts`, "Supports server-side aggregation via { groupBy,
 * aggregations, where, ... }") into the real chain: `RestServer` →
 * `ObjectStackProtocolImplementation.findData` (which routes a body carrying
 * `groupBy` / `aggregations` to `engine.aggregate`) → `ObjectQL.aggregate` →
 * a real sqlite `SqlDriver`. Same harness as
 * `rest-data-create-address-unknown-key.test.ts`; this card mints no route and
 * no wire shape.
 *
 * ## The two tiers, and why the fork is driven rather than assumed
 *
 * `ObjectQL.aggregate` chooses the face per query:
 *
 * ```ts
 * if (typeof drv.aggregate === 'function' && allStructuredSupported && …) {
 *     const aggregated = await drv.aggregate(object, ast, …);   // ① pushed down
 * }
 * const raw = await driver.find(object, ast, …);                // ② in-memory
 * return applyHaving(applyInMemoryAggregation(raw, ast, tz), …);
 * ```
 *
 * Tier ① is driver-sql's `GROUP BY`. Tier ② is `applyInMemoryAggregation`, the
 * face every driver with no native aggregation lands on (driver-rest, partial
 * SQL dialects) and the face a non-UTC reference timezone or a per-aggregation
 * filter forces even on driver-sql. Both are reachable for the very same view.
 *
 * The fork keys on ONE thing — whether the driver exposes `aggregate` — so this
 * file drives it by shadowing that member with an own property for the duration
 * of a tier, over the SAME driver instance and the SAME stored rows. Nothing
 * else moves: not the database, not the seed, not the compiled body. And the
 * fork is not taken on trust — {@link calls} counts the native call and counts
 * `driver.find` receiving an aggregation-bearing AST, and every tiered case
 * asserts which one moved. A test that silently ran tier ① twice would report
 * perfect agreement while measuring one face.
 *
 * ## Anti-vacuity
 *
 * A pin that posts a body and reads an empty result set passes while measuring
 * nothing, so every claim here has an arm that must come out differently:
 *
 * - §2 replays the DEFECT the ruling outlawed on this same door — grouping the
 *   first page — and gets 86/14 contiguous, 31/31/30/7/1 interleaved. Neither
 *   is the data. If the header query were secretly page-scoped it would answer
 *   one of those.
 * - §3 ablates the compiled body: without `groupBy` the door answers ONE row,
 *   without either node it answers 186 ungrouped records. Both nodes are shown
 *   load-bearing rather than decorative.
 * - §7 moves the numbers with the view filter (86/61/31/7/1 → 28/20/10/2, one
 *   unit gone entirely), so the `where` is shown to reach the header numbers.
 * - §8 pages a group and then pages it OVERLAPPING: two pages summing to 100
 *   rows carry only 80 distinct ids, so the distinctness assertion is shown to
 *   discriminate from the count assertion beside it.
 * - §9 posts bodies the door must refuse, asserting the ADR-0112 pair
 *   (`code` AND `status`) — an unknown column answers 400/`INVALID_FIELD`
 *   rather than one null-keyed bucket.
 *
 * ## The boundary this file deliberately does not cross
 *
 * The card's fixture has no group whose summed column is null in every row, and
 * the two tiers DISAGREE there — driver-sql's `SUM(col)` answers `null`, the
 * in-memory tier answers `0`, and `aggregation-conformance.ts` does not cover
 * it (its numeric aggregands are non-null by declaration). That is a face
 * disagreement with the spec's reducer, so by this card's deliverable 3 it is
 * REPORTED on #14556 and filed as its own card — not pinned here in either
 * direction, and not repaired here.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
  LIST_VIEW_GROUP_COUNT_ALIAS,
  compileListViewGroupQuery,
  compileListViewGroupRowsQuery,
  deriveColumnSummary,
} from '@objectstack/spec/ui';
import type { ListViewGroupHeaderRow, ListViewGroupQuerySource } from '@objectstack/spec/ui';
import { RestServer } from './rest-server';

// ─── The acceptance fixture — the card's, re-derived, not retyped ────────────
//
// `packages/spec/src/ui/view-grouping-query.test.ts` is the authority on this
// fixture; the generator below is the same rule, restated because a test may
// not read another package's test file. §1 re-derives every property this file
// then relies on (186 rows, five units, the two orders holding the same rows),
// so a drift between the two copies fails here rather than passing quietly.

/** Five units, 186 rows. */
const UNITS: ReadonlyArray<readonly [string, number]> = [
  ['northgate_operations', 86],
  ['northgate_quality', 61],
  ['riverside_plant', 31],
  ['northgate_plant', 7],
  ['harbour_office', 1],
];

/** Rows with no unit at all — the empty group, stored as SQL NULL. */
const UNASSIGNED_ROWS = 9;

interface Row {
  id: string;
  /**
   * The row's position in this object's STORED order. §2 needs to fetch "the
   * first page as the list view would fetch it", and a driver's unordered read
   * order is not that page — better-sqlite3 answered `id`-ascending here, which
   * is neither the contiguous nor the interleaved order the card measured. An
   * explicit sequence column makes the control arm's page exactly the window the
   * client-side grouping saw, on any dialect.
   */
  seq: number;
  business_unit: string | null;
  status: 'open' | 'done';
  amount: number;
  owner: string;
  /** Nullable on purpose — the field the derived `count_filled` pin reads. */
  notes: string | null;
}

function makeRow(unit: string | null, ordinal: number): Row {
  return {
    id: `${unit ?? 'unassigned'}-${ordinal}`,
    // Rewritten per object by `inStoredOrder` at seed time.
    seq: -1,
    business_unit: unit,
    status: ordinal % 3 === 0 ? 'done' : 'open',
    amount: ordinal,
    owner: `owner_${ordinal % 4}`,
    // Every fifth row has no note — the server's "empty" (null), never ''.
    notes: ordinal % 5 === 0 ? null : `note ${ordinal}`,
  };
}

/** Rows of one unit, then the next — the contiguous order the card measured. */
const CONTIGUOUS: Row[] = UNITS.flatMap(([unit, size]) =>
  Array.from({ length: size }, (_, i) => makeRow(unit, i + 1)),
);

/** Round-robin over the units — the interleaved order the card measured. */
const INTERLEAVED: Row[] = (() => {
  const queues = UNITS.map(([unit, size]) => Array.from({ length: size }, (_, i) => makeRow(unit, i + 1)));
  const out: Row[] = [];
  while (queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      const next = q.shift();
      if (next) out.push(next);
    }
  }
  return out;
})();

const UNASSIGNED: Row[] = Array.from({ length: UNASSIGNED_ROWS }, (_, i) => makeRow(null, i + 1));

/** Stamp each row with its index in this object's stored order. */
const inStoredOrder = (rows: readonly Row[]): Row[] => rows.map((row, i) => ({ ...row, seq: i }));

/** The view's own row order — what "the first page" means (see {@link Row.seq}). */
const STORED_ORDER = [{ field: 'seq', order: 'asc' as const }];

const PAGE_SIZE = 100;
const TOTAL_ROWS = UNITS.reduce((n, [, size]) => n + size, 0);
const EXPECTED_COUNTS: Record<string, number> = Object.fromEntries(UNITS.map(([u, n]) => [u, n]));
/** Rows whose `notes` is null, per unit: `floor(size / 5)`. */
const EXPECTED_EMPTY_NOTES: Record<string, number> = Object.fromEntries(
  UNITS.map(([u, n]) => [u, Math.floor(n / 5)]),
);
const BIGGEST_UNIT = 'northgate_operations';

// ─── The views, declared as a `ListView` would declare them ──────────────────

const GROUPED_VIEW: ListViewGroupQuerySource = {
  grouping: { fields: [{ field: 'business_unit' }] },
  columns: [
    { field: 'id' },
    { field: 'amount', summary: 'sum' },
    { field: 'owner', summary: 'count_unique' },
    { field: 'notes', summary: 'count_filled' },
  ],
};

const TWO_LEVEL_VIEW: ListViewGroupQuerySource = {
  grouping: { fields: [{ field: 'business_unit' }, { field: 'status' }] },
  columns: [{ field: 'amount', summary: 'sum' }],
};

const PLAIN_VIEW: ListViewGroupQuerySource = { grouping: { fields: [{ field: 'business_unit' }] } };

// ─── The harness ─────────────────────────────────────────────────────────────

const OBJECT_CONTIGUOUS = 'work_item';
const OBJECT_INTERLEAVED = 'work_item_interleaved';
const OBJECT_WITH_EMPTY = 'work_item_unassigned';

function objectSchema(name: string) {
  return {
    name,
    label: name,
    systemFields: false,
    fields: {
      id: { name: 'id', type: 'text' as const, primaryKey: true },
      business_unit: { name: 'business_unit', type: 'text' as const, label: 'Business Unit' },
      status: { name: 'status', type: 'text' as const, label: 'Status' },
      amount: { name: 'amount', type: 'number' as const, label: 'Amount' },
      owner: { name: 'owner', type: 'text' as const, label: 'Owner' },
      notes: { name: 'notes', type: 'text' as const, label: 'Notes' },
      seq: { name: 'seq', type: 'number' as const, label: 'Stored Order' },
    },
  };
}

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

interface DoorBody {
  object?: string;
  records?: Array<Record<string, unknown>>;
  total?: number;
  hasMore?: boolean;
  code?: string;
  error?: string;
  field?: string;
  fields?: Array<{ field?: string; code?: string; message?: string }>;
}

/**
 * The route's response object. `_status` and `_body` are the CAPTURE, deliberately
 * named apart from the `status()` / `json()` methods the handler calls: naming the
 * capture `status` leaves the method sitting in the slot on the success path (the
 * route answers 200 by calling `json()` alone), so every "did the door refuse?"
 * assertion reads a function and every case fails identically. Same spelling the
 * package's other full-chain tests use.
 */
interface CapturedResponse {
  _status?: number;
  _body?: DoorBody;
  write: () => boolean;
  end: () => void;
  header: () => CapturedResponse;
  status: (code: number) => CapturedResponse;
  json: (body: DoorBody) => CapturedResponse;
}

function makeRes(): CapturedResponse {
  const res: CapturedResponse = {
    write: () => true,
    end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: DoorBody) => { res._body = body; return res; },
  };
  return res;
}

type Tier = 'driver-sql' | 'in-memory';
const TIERS: readonly Tier[] = ['driver-sql', 'in-memory'];

/** Which face answered, counted rather than assumed. See the module note. */
const calls = { nativeAggregate: 0, findWithAggregations: 0 };

let engine: ObjectQL;
let driver: SqlDriver;
let queryRoute: { handler: (req: unknown, res: unknown) => Promise<void> };

/** `driver.aggregate` / `driver.find`, captured before either is shadowed. */
type DriverFace = (object: string, ast: Record<string, unknown>, options?: unknown) => Promise<unknown>;
let nativeAggregate: DriverFace;

beforeAll(async () => {
  driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

  const asFaces = driver as unknown as { aggregate: DriverFace; find: DriverFace };
  nativeAggregate = asFaces.aggregate.bind(driver);
  const nativeFind = asFaces.find.bind(driver);
  // Permanent: `find` is the tier-② executor, and it is also the ordinary read
  // path, so it is counted only when it receives an aggregation-bearing AST.
  Object.defineProperty(driver, 'find', {
    configurable: true,
    writable: true,
    value: (object: string, ast: Record<string, unknown>, options?: unknown) => {
      const aggregations = ast?.aggregations;
      if (Array.isArray(aggregations) && aggregations.length > 0) calls.findWithAggregations += 1;
      return nativeFind(object, ast, options);
    },
  });

  engine = new ObjectQL();
  engine.registerDriver(driver as never, true);
  await engine.init();
  for (const name of [OBJECT_CONTIGUOUS, OBJECT_INTERLEAVED, OBJECT_WITH_EMPTY]) {
    engine.registry.registerObject(objectSchema(name) as never);
  }
  await engine.syncSchemas();
  await engine.insert(OBJECT_CONTIGUOUS, inStoredOrder(CONTIGUOUS));
  await engine.insert(OBJECT_INTERLEAVED, inStoredOrder(INTERLEAVED));
  await engine.insert(OBJECT_WITH_EMPTY, inStoredOrder([...CONTIGUOUS, ...UNASSIGNED]));

  const protocol = new ObjectStackProtocolImplementation(engine as never);
  const rest = new RestServer(
    createMockServer() as never,
    protocol as never,
    { api: { requireAuth: false } } as never,
  );
  (rest as unknown as { resolveExecCtx: () => Promise<unknown> }).resolveExecCtx =
    async () => ({ userId: 'list-view-grouping-pin' });
  rest.registerRoutes();
  const found = (rest.getRoutes() as Array<{ method: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }>)
    .find((r) => r.method === 'POST' && r.path === '/api/v1/data/:object/query');
  expect(found, 'POST /api/v1/data/:object/query must be registered').toBeDefined();
  queryRoute = found!;
});

afterAll(async () => {
  try { await engine?.destroy(); } catch { /* teardown is best-effort */ }
});

/** POST the body to `/data/:object/query`, exactly as `client.data.query()` does. */
async function postQuery(object: string, body: unknown): Promise<CapturedResponse> {
  const res = makeRes();
  await queryRoute.handler({ params: { object }, body }, res);
  return res;
}

/** A successful door answer — no `status()` call is the route's 200. */
async function records(object: string, body: unknown): Promise<Array<Record<string, unknown>>> {
  const res = await postQuery(object, body);
  expect(res._status, `door refused: ${JSON.stringify(res._body)}`).toBeUndefined();
  return res._body?.records ?? [];
}

/**
 * Run `fn` with the engine's aggregate fork pinned to one tier, by shadowing
 * `driver.aggregate` with an own property. `delete` restores the prototype
 * method, so the shadow cannot leak into the next case.
 */
async function onTier<T>(tier: Tier, fn: () => Promise<T>): Promise<T> {
  const before = { ...calls };
  Object.defineProperty(driver, 'aggregate', {
    configurable: true,
    writable: true,
    value: tier === 'driver-sql'
      ? (object: string, ast: Record<string, unknown>, options?: unknown) => {
          calls.nativeAggregate += 1;
          return nativeAggregate(object, ast, options);
        }
      : undefined,
  });
  try {
    const out = await fn();
    // The fork is asserted, never assumed: a case that silently ran the other
    // face would otherwise report agreement while measuring one tier twice.
    if (tier === 'driver-sql') {
      expect(calls.nativeAggregate, 'tier driver-sql must push down to driver.aggregate')
        .toBeGreaterThan(before.nativeAggregate);
      expect(calls.findWithAggregations, 'tier driver-sql must NOT reach the in-memory fallback')
        .toBe(before.findWithAggregations);
    } else {
      expect(calls.findWithAggregations, 'tier in-memory must reach applyInMemoryAggregation via driver.find')
        .toBeGreaterThan(before.findWithAggregations);
      expect(calls.nativeAggregate, 'tier in-memory must NOT push down')
        .toBe(before.nativeAggregate);
    }
    return out;
  } finally {
    delete (driver as unknown as Record<string, unknown>).aggregate;
  }
}

/** Header rows → `{ unit: count }`, the shape a reader compares. */
function countsByUnit(headers: Array<Record<string, unknown>>): Record<string, number> {
  return Object.fromEntries(headers.map((h) => [String(h.business_unit), h[LIST_VIEW_GROUP_COUNT_ALIAS] as number]));
}

/**
 * A canonical, ORDER-INDEPENDENT, TYPE-CARRYING rendering of a header set.
 *
 * Type-carrying deliberately: folding both sides through `String()` is what hid
 * the group-key read-shape divergence (#3849), and it would make a comparison
 * pass against the very defect it exists to catch — `'1'` and `1`, `null` and
 * `'null'` must not reconcile here.
 */
function canonical(headers: Array<Record<string, unknown>>): string[] {
  return headers
    .map((row) => Object.keys(row).sort()
      .map((k) => `${k}=${JSON.stringify(row[k]) ?? 'undefined'}<${row[k] === null ? 'null' : typeof row[k]}>`)
      .join('|'))
    .sort();
}

// ─── §1 The fixture is the one the card measured ─────────────────────────────

describe('§1 the acceptance fixture, re-derived from the generator', () => {
  it('is 186 rows in five units sized 86/61/31/7/1, the same rows in both orders', () => {
    expect(TOTAL_ROWS).toBe(186);
    expect(CONTIGUOUS).toHaveLength(186);
    expect(INTERLEAVED).toHaveLength(186);
    expect(EXPECTED_COUNTS).toEqual({
      northgate_operations: 86, northgate_quality: 61, riverside_plant: 31, northgate_plant: 7, harbour_office: 1,
    });
    expect(EXPECTED_EMPTY_NOTES).toEqual({
      northgate_operations: 17, northgate_quality: 12, riverside_plant: 6, northgate_plant: 1, harbour_office: 0,
    });
    // The two orders are permutations of one another — otherwise "order does
    // not matter" would be a claim about two different datasets.
    expect([...CONTIGUOUS.map((r) => r.id)].sort()).toEqual([...INTERLEAVED.map((r) => r.id)].sort());
  });

  it('is what the door actually holds, in both objects', async () => {
    for (const object of [OBJECT_CONTIGUOUS, OBJECT_INTERLEAVED]) {
      const res = await postQuery(object, { limit: 1 });
      expect(res._body?.total, object).toBe(186);
    }
    const withEmpty = await postQuery(OBJECT_WITH_EMPTY, { limit: 1 });
    expect(withEmpty._body?.total).toBe(186 + UNASSIGNED_ROWS);
  });
});

// ─── §2 The defect the ruling outlawed, replayed on this same door ───────────

describe('§2 CONTROL — grouping the fetched page answers neither the data nor the same thing twice', () => {
  const pageScopedCounts = (rows: Array<Record<string, unknown>>): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const row of rows) counts[String(row.business_unit)] = (counts[String(row.business_unit)] ?? 0) + 1;
    return counts;
  };

  it('renders TWO headers (86, 14) on the contiguous order — three units simply absent', async () => {
    const page = await records(OBJECT_CONTIGUOUS, { limit: PAGE_SIZE, orderBy: STORED_ORDER });
    expect(page).toHaveLength(PAGE_SIZE);
    const counts = pageScopedCounts(page);
    expect(counts).toEqual({ northgate_operations: 86, northgate_quality: 14 });
    expect(counts).not.toEqual(EXPECTED_COUNTS);
  });

  it('renders FIVE headers reading 31/31/30/7/1 on the interleaved order — same query, same page size', async () => {
    const page = await records(OBJECT_INTERLEAVED, { limit: PAGE_SIZE, orderBy: STORED_ORDER });
    expect(page).toHaveLength(PAGE_SIZE);
    const counts = pageScopedCounts(page);
    expect(counts).toEqual({
      northgate_operations: 31, northgate_quality: 31, riverside_plant: 30, northgate_plant: 7, harbour_office: 1,
    });
    expect(counts).not.toEqual(EXPECTED_COUNTS);
  });
});

// ─── §3 The compiled header query, on BOTH tiers, in BOTH row orders ─────────

describe('§3 the group set and every header number are ONE aggregate query', () => {
  it.each(TIERS)('%s: five header rows, 86/61/31/7/1, in both row orders', async (tier) => {
    const query = compileListViewGroupQuery(GROUPED_VIEW);
    // The body is the COMPILER's output — never hand-written, so this pin goes
    // red when the compiler drifts.
    expect(query.groupBy).toEqual(['business_unit']);

    for (const object of [OBJECT_CONTIGUOUS, OBJECT_INTERLEAVED]) {
      const res = await onTier(tier, () => postQuery(object, query));
      expect(res._status, `${tier}/${object}: ${JSON.stringify(res._body)}`).toBeUndefined();
      const headers = res._body?.records ?? [];
      expect(headers, `${tier}/${object}`).toHaveLength(5);
      expect(countsByUnit(headers), `${tier}/${object}`).toEqual(EXPECTED_COUNTS);
      // `total` on the aggregate branch IS the group count, not the row count.
      expect(res._body?.total, `${tier}/${object}`).toBe(5);
      expect(res._body?.hasMore).toBe(false);
      // The per-group summaries ride the same row as the count.
      const biggest = headers.find((h) => h.business_unit === BIGGEST_UNIT)!;
      expect(biggest.sum_amount).toBe((86 * 87) / 2);
      expect(biggest.count_distinct_owner).toBe(4);
    }
  });

  it.each(TIERS)('%s: ABLATION — the compiled nodes are load-bearing, not decorative', async (tier) => {
    const query = compileListViewGroupQuery(GROUPED_VIEW);

    // Drop `groupBy`: the same aggregations over the whole object collapse to
    // ONE row counting every stored row. A door that was ignoring the grouping
    // and answering per-row would look identical to §3's pass without this.
    const { groupBy: _dropped, ...ungrouped } = query;
    const collapsed = await onTier(tier, () => records(OBJECT_CONTIGUOUS, ungrouped));
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0][LIST_VIEW_GROUP_COUNT_ALIAS]).toBe(186);
    expect(collapsed[0]).not.toHaveProperty('business_unit');

    // Drop both nodes: the door answers ungrouped records with no `count`
    // column at all — i.e. the aggregate branch is what produced §3's rows.
    const raw = await records(OBJECT_CONTIGUOUS, { limit: 5 });
    expect(raw).toHaveLength(5);
    expect(raw[0]).not.toHaveProperty(LIST_VIEW_GROUP_COUNT_ALIAS);
  });
});

// ─── §4 The two faces are compared to each other ─────────────────────────────

describe('§4 driver-sql and the in-memory tier answer the same thing', () => {
  const CASES: ReadonlyArray<readonly [string, string, Record<string, unknown>]> = [
    ['one level, contiguous', OBJECT_CONTIGUOUS, compileListViewGroupQuery(GROUPED_VIEW) as Record<string, unknown>],
    ['one level, interleaved', OBJECT_INTERLEAVED, compileListViewGroupQuery(GROUPED_VIEW) as Record<string, unknown>],
    ['two levels', OBJECT_CONTIGUOUS, compileListViewGroupQuery(TWO_LEVEL_VIEW) as Record<string, unknown>],
    ['depth 1', OBJECT_CONTIGUOUS, compileListViewGroupQuery(TWO_LEVEL_VIEW, { depth: 1 }) as Record<string, unknown>],
    ['the empty group', OBJECT_WITH_EMPTY, compileListViewGroupQuery(PLAIN_VIEW) as Record<string, unknown>],
    ['the view filter', OBJECT_INTERLEAVED, compileListViewGroupQuery(GROUPED_VIEW, { where: { status: { $eq: 'done' } } }) as Record<string, unknown>],
  ];

  it.each(CASES)('%s: identical header sets, values AND their types', async (_name, object, query) => {
    const pushedDown = await onTier('driver-sql', () => records(object, query));
    const inMemory = await onTier('in-memory', () => records(object, query));
    expect(canonical(inMemory)).toEqual(canonical(pushedDown));
    expect(pushedDown.length).toBeGreaterThan(0);
    expect(inMemory).toHaveLength(pushedDown.length);
  });

  /**
   * The one thing the two faces do NOT share, stated where a reader will look
   * for it. `applyInMemoryAggregation` emits buckets in the order its input rows
   * first present them; a SQL `GROUP BY` with no `ORDER BY` emits whatever the
   * dialect's grouping strategy produced. So the group SEQUENCE is not a
   * cross-tier contract — which is why the case above compares canonicalised
   * SETS, and why `limit` on the aggregate verb is a recorded limit on
   * `GroupingConfigSchema` rather than a feature: `findData` slices `records` by
   * `limit`, so a limited header query selects a tier-dependent SUBSET of the
   * groups.
   *
   * ⛔ Neither face's order is asserted, in either direction: pinning
   * driver-sql's would freeze a dialect's implementation detail as if it were
   * the contract, and pinning the in-memory tier's would freeze the driver's
   * unordered read order behind it. What IS deterministic — and is a contract,
   * because a pager reads it — is the slice arithmetic the branch performs
   * around that order.
   */
  it.each(TIERS)('%s: `limit` on the header query slices GROUPS, and `total` stays the whole group set', async (tier) => {
    const query = compileListViewGroupQuery(PLAIN_VIEW);
    const res = await onTier(tier, () => postQuery(OBJECT_CONTIGUOUS, { ...query, limit: 2 }));
    expect(res._status, JSON.stringify(res._body)).toBeUndefined();
    expect(res._body?.records).toHaveLength(2);
    // `total` is the number of GROUPS, not of rows and not of the slice.
    expect(res._body?.total).toBe(UNITS.length);
    expect(res._body?.hasMore).toBe(true);
    // Whichever two groups they are, they are real ones carrying real counts.
    for (const row of res._body?.records ?? []) {
      expect(EXPECTED_COUNTS[String(row.business_unit)]).toBe(row[LIST_VIEW_GROUP_COUNT_ALIAS]);
    }
  });
});

// ─── §5 Multi-level grouping and the outer level's own query ─────────────────

describe('§5 a two-level grouping, and the `depth: 1` outer level', () => {
  it.each(TIERS)('%s: two levels compile to a two-column groupBy and answer nine leaves', async (tier) => {
    const query = compileListViewGroupQuery(TWO_LEVEL_VIEW);
    expect(query.groupBy).toEqual(['business_unit', 'status']);

    const leaves = await onTier(tier, () => records(OBJECT_CONTIGUOUS, query));
    // Five units; `harbour_office` holds one row and it is not `done`.
    expect(leaves).toHaveLength(9);
    const open = leaves.find((h) => h.business_unit === BIGGEST_UNIT && h.status === 'open')!;
    const done = leaves.find((h) => h.business_unit === BIGGEST_UNIT && h.status === 'done')!;
    expect(done[LIST_VIEW_GROUP_COUNT_ALIAS]).toBe(28);
    expect(open[LIST_VIEW_GROUP_COUNT_ALIAS]).toBe(58);
    // The outer level folds exactly for count.
    expect((open[LIST_VIEW_GROUP_COUNT_ALIAS] as number) + (done[LIST_VIEW_GROUP_COUNT_ALIAS] as number))
      .toBe(EXPECTED_COUNTS[BIGGEST_UNIT]);
  });

  it.each(TIERS)('%s: `depth: 1` is the outer level\'s OWN query, not a fold of the leaves', async (tier) => {
    const outer = compileListViewGroupQuery(TWO_LEVEL_VIEW, { depth: 1 });
    expect(outer.groupBy).toEqual(['business_unit']);

    const rows = await onTier(tier, () => records(OBJECT_CONTIGUOUS, outer));
    expect(rows).toHaveLength(5);
    expect(countsByUnit(rows)).toEqual(EXPECTED_COUNTS);
  });
});

// ─── §6 The empty group ──────────────────────────────────────────────────────

describe('§6 the empty group is its own group, keyed null, and its rows page via `$null`', () => {
  it.each(TIERS)('%s: the header set carries a real `null` key — not the string, not a missing row', async (tier) => {
    const headers = await onTier(tier, () => records(OBJECT_WITH_EMPTY, compileListViewGroupQuery(PLAIN_VIEW)));
    expect(headers).toHaveLength(UNITS.length + 1);
    const empty = headers.find((h) => h.business_unit === null);
    expect(empty, `no null-keyed group in ${JSON.stringify(headers)}`).toBeDefined();
    // The TYPE, not just the value: `'null'` and `'(null)'` are the shapes this
    // seam has diverged into before (#3839, #3849).
    expect(empty!.business_unit).toBeNull();
    expect(typeof empty!.business_unit).toBe('object');
    expect(empty![LIST_VIEW_GROUP_COUNT_ALIAS]).toBe(UNASSIGNED_ROWS);
    // …and the five real units are untouched by its presence.
    const named = headers.filter((h) => h.business_unit !== null);
    expect(countsByUnit(named)).toEqual(EXPECTED_COUNTS);
  });

  it('opening it pages its rows through the compiled `$null` predicate', async () => {
    const rowQuery = compileListViewGroupRowsQuery(PLAIN_VIEW, { business_unit: null }, { limit: 50 });
    expect(rowQuery.where).toEqual({ $and: [{ business_unit: { $null: true } }] });

    const res = await postQuery(OBJECT_WITH_EMPTY, rowQuery);
    expect(res._status, JSON.stringify(res._body)).toBeUndefined();
    const rows = res._body?.records ?? [];
    expect(rows).toHaveLength(UNASSIGNED_ROWS);
    expect(res._body?.total).toBe(UNASSIGNED_ROWS);
    expect(rows.every((r) => r.business_unit === null)).toBe(true);
    expect(new Set(rows.map((r) => r.id)).size).toBe(UNASSIGNED_ROWS);
  });
});

// ─── §7 The derived summary, and the view filter ─────────────────────────────

describe('§7 `count_filled` is derived on the header row, and the view filter reaches the numbers', () => {
  it.each(TIERS)('%s: one `count_<field>` node serves count_filled / count_empty / the two ratios', async (tier) => {
    const query = compileListViewGroupQuery(GROUPED_VIEW);
    // ONE count(notes) node — the derived members are read off it, never their
    // own aggregation.
    expect(query.aggregations).toContainEqual({ function: 'count', field: 'notes', alias: 'count_notes' });

    for (const object of [OBJECT_CONTIGUOUS, OBJECT_INTERLEAVED]) {
      const headers = await onTier(tier, () => records(object, query));
      for (const [unit, size] of UNITS) {
        const row = headers.find((h) => h.business_unit === unit) as ListViewGroupHeaderRow;
        const empty = EXPECTED_EMPTY_NOTES[unit];
        expect(row.count, `${tier}/${object}/${unit}`).toBe(size);
        expect(deriveColumnSummary(row, 'count_filled', 'notes')).toBe(size - empty);
        expect(deriveColumnSummary(row, { type: 'count_empty', field: 'notes' }, 'id')).toBe(empty);
        expect(deriveColumnSummary(row, 'percent_filled', 'notes')).toBeCloseTo((size - empty) / size, 12);
        expect(deriveColumnSummary(row, 'percent_empty', 'notes')).toBeCloseTo(empty / size, 12);
      }
    }
  });

  it.each(TIERS)('%s: the view filter moves every header number, and drops a group entirely', async (tier) => {
    const query = compileListViewGroupQuery(GROUPED_VIEW, { where: { status: { $eq: 'done' } } });
    expect(query.where).toEqual({ status: { $eq: 'done' } });

    const headers = await onTier(tier, () => records(OBJECT_INTERLEAVED, query));
    // Every third ordinal is `done`: `floor(size / 3)`, and `harbour_office`
    // holds one row that is not — so the group is GONE, not zeroed.
    expect(countsByUnit(headers)).toEqual({
      northgate_operations: 28, northgate_quality: 20, riverside_plant: 10, northgate_plant: 2,
    });
    expect(headers).toHaveLength(4);
    expect(countsByUnit(headers)).not.toEqual(EXPECTED_COUNTS);
  });
});

// ─── §8 Rows inside a group are the existing paged find ──────────────────────

describe('§8 `limit` / `offset` slice INSIDE one group', () => {
  const openGroup = (options: { limit?: number; offset?: number }) =>
    compileListViewGroupRowsQuery(PLAIN_VIEW, { business_unit: BIGGEST_UNIT }, {
      ...options,
      orderBy: [{ field: 'amount', order: 'asc' }],
    });

  it('86 rows page as [50, 36] with 86 DISTINCT ids, every one inside the group', async () => {
    const pages: Array<Array<Record<string, unknown>>> = [];
    for (let offset = 0; offset < 200; offset += 50) {
      const res = await postQuery(OBJECT_INTERLEAVED, openGroup({ limit: 50, offset }));
      expect(res._status, JSON.stringify(res._body)).toBeUndefined();
      // `total` is the size of the GROUP, on every page — the number a header
      // and its pager must agree on.
      expect(res._body?.total).toBe(EXPECTED_COUNTS[BIGGEST_UNIT]);
      const page = res._body?.records ?? [];
      if (page.length === 0) break;
      pages.push(page);
    }

    expect(pages.map((p) => p.length)).toEqual([50, 36]);
    const rows = pages.flat();
    expect(rows).toHaveLength(86);
    expect(new Set(rows.map((r) => r.id)).size).toBe(86);
    expect(rows.every((r) => r.business_unit === BIGGEST_UNIT)).toBe(true);
  });

  it('CONTROL — distinctness is not implied by the counts: two overlapping pages sum to 100 and hold 80', async () => {
    const first = await records(OBJECT_INTERLEAVED, openGroup({ limit: 50, offset: 0 }));
    const overlapping = await records(OBJECT_INTERLEAVED, openGroup({ limit: 50, offset: 30 }));
    const ids = [...first, ...overlapping].map((r) => r.id);
    expect(ids).toHaveLength(100);
    expect(new Set(ids).size).toBe(80);
  });

  it('the group predicate is the view filter AND the key — a filtered view pages the intersection', async () => {
    const query = compileListViewGroupRowsQuery(
      PLAIN_VIEW,
      { business_unit: BIGGEST_UNIT },
      { where: { status: { $eq: 'done' } }, limit: 100 },
    );
    expect(query.where).toEqual({
      $and: [{ status: { $eq: 'done' } }, { business_unit: { $eq: BIGGEST_UNIT } }],
    });
    const res = await postQuery(OBJECT_INTERLEAVED, query);
    expect(res._body?.total).toBe(28);
    expect((res._body?.records ?? []).every((r) => r.status === 'done' && r.business_unit === BIGGEST_UNIT)).toBe(true);
  });
});

// ─── §9 The door refuses what it cannot mean ─────────────────────────────────

describe('§9 a malformed grouped query is REFUSED, not answered with a plausible empty result', () => {
  it('an unknown groupBy column is 400 / INVALID_FIELD — not one null-keyed bucket', async () => {
    const res = await postQuery(OBJECT_CONTIGUOUS, {
      groupBy: ['no_such_column'],
      aggregations: [{ function: 'count', alias: LIST_VIEW_GROUP_COUNT_ALIAS }],
    });
    expect(res._status).toBe(400);
    expect(res._body?.code).toBe('INVALID_FIELD');
    expect(res._body?.field).toBe('no_such_column');
  });

  it('an unknown aggregation column is 400 / INVALID_FIELD — not a zero that reads as data', async () => {
    const res = await postQuery(OBJECT_CONTIGUOUS, {
      groupBy: ['business_unit'],
      aggregations: [{ function: 'sum', field: 'no_such_column', alias: 'sum_x' }],
    });
    expect(res._status).toBe(400);
    expect(res._body?.code).toBe('INVALID_FIELD');
    expect(res._body?.field).toBe('no_such_column');
  });

  it('an aggregation function outside the declared vocabulary is 400 / VALIDATION_FAILED at the wire gate', async () => {
    const res = await postQuery(OBJECT_CONTIGUOUS, {
      groupBy: ['business_unit'],
      aggregations: [{ function: 'median', field: 'amount', alias: 'median_amount' }],
    });
    expect(res._status).toBe(400);
    expect(res._body?.code).toBe('VALIDATION_FAILED');
    expect(res._body?.fields?.[0]?.field).toBe('query.aggregations.0.function');
  });
});
