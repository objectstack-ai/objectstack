// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27744] The plugin-driver conformance kit: the behaviour the engine relies on
 * from a plugin driver, as a suite a driver that lives OUTSIDE this repository
 * runs in its own CI (epic #27261 P2). A vendor driver (a closed-source
 * Salesforce driver, say) cannot be tested here, so a change to the contract
 * here can only be caught there — by this kit, imported from the published
 * `@objectstack/objectql`.
 *
 * ## What it asserts
 *
 * The contract is the engine's correctness floor over a plugin driver
 * (`external-driver-floor.ts`, #27277): the engine sends `find` a `where`, an
 * `orderBy` and a `limit` of {@link EXTERNAL_ROW_CAP} + 1, and re-applies the
 * whole query to whatever rows come back. So a driver may push any part of a
 * filter down or none of it, and may refuse what it cannot translate — what it
 * must never do is return FEWER rows than match, invent rows, or answer a
 * failure as rows. The oracle is the spec's driver conformance tables
 * (`FILTER_LOGIC_CASES`, `FILTER_TEXT_CASES`, `TEMPORAL_CASES`,
 * `PAGINATION_*_CASES`), the standard every built-in driver is held to — never
 * any one driver.
 *
 * Two tiers:
 *
 * - **`floor`** (the default) — what the engine relies on today. Each read is
 *   checked twice: the driver's own answer to the query the floor sends (every
 *   matching row, only fixture rows, or a request-shaped refusal), and the
 *   floored answer (the floor over the driver answers the table's `expected`).
 *   Plus row shape and value fidelity, write refusal statuses (from the
 *   caller's probes), the outage answer (from the caller's unavailable remote),
 *   and the `introspectSchema` shape when the driver offers one.
 * - **`direct`** — the driver answers the whole query itself, as `find()`'s
 *   contract asks of a built-in driver: an exact filter, `count`, `findOne`,
 *   a deterministic paged walk, `limit` by presence. The floor does not need
 *   any of it; it is the oracle the epic's P3 verified-pushdown credential (a
 *   driver trusted to skip the floor) builds on, and a driver may run it to
 *   measure how far it is from that.
 *
 * `DriverCapabilities` carries no pushdown claim (the query bits were retired
 * in 17.0.0), so pushdown is MEASURED, not read from `supports`: each floor
 * read case reports whether the driver answered exactly, with a superset, or
 * refused (`pushdown` on its result).
 *
 * Not covered: the text table's rejection rows (the floor refuses a retired
 * operator before the driver is asked, so they test the engine, not a driver)
 * and `TEMPORAL_TIME_CASES` (no plugin driver serves a time-of-day column
 * through the floor's temporal comparand rule yet).
 *
 * ## How a driver runs it
 *
 * The caller hands a `setup` that builds the driver over a remote holding
 * exactly a fixture's rows — a fake of the remote's API in front of the
 * driver's real translation code, or a sandbox seeded with
 * {@link pluginDriverConformanceFixtures}. Reads share one setup per fixture;
 * each write probe gets a fresh one. Then either
 * {@link runPluginDriverConformance} (any runner: a report, no test framework)
 * or {@link definePluginDriverConformanceSuite} (one test per case, under the
 * caller's `describe` / `it`, vitest and jest alike).
 */

import type { DriverQuery, IDataDriver } from '@objectstack/spec/contracts';
import {
  FILTER_LOGIC_CASES,
  FILTER_LOGIC_ROWS,
  FILTER_TEXT_CASES,
  FILTER_TEXT_ROWS,
  PAGINATION_CASES,
  PAGINATION_ROWS,
  PAGINATION_UNORDERED_CASES,
  PAGINATION_ZERO_LIMIT_CASES,
  TEMPORAL_CASES,
  TEMPORAL_NOW,
  TEMPORAL_ROWS,
  lowerFilterCondition,
  type FilterCondition,
} from '@objectstack/spec/data';
import { resolveFilterTokens } from '@objectstack/core';
import { applyDriverQueryInMemory } from './driver-query-in-memory.js';
import { declaredFieldClasses } from './having-filter.js';
import { DatasourceUnavailableError } from './driver-connect-errors.js';
import { createExternalDriverFloor } from './external-driver-floor.js';
import {
  EXTERNAL_READ_REFUSED_STATUSES,
  EXTERNAL_ROW_CAP,
  EXTERNAL_WRITE_REFUSED_CODE,
  EXTERNAL_WRITE_REFUSED_STATUSES,
  ExternalReadRefusedError,
  ExternalWriteRefusedError,
  type ExternalWriteOperation,
} from './external-driver-errors.js';

type Row = Record<string, unknown>;

// ===========================================================================
// Fixtures
// ===========================================================================

/** The kit's fixtures, one per spec conformance table. */
export type PluginDriverConformanceFixtureName = 'filter_logic' | 'filter_text' | 'temporal' | 'pagination';

/** The fixture names, in the order the kit runs them. */
export const PLUGIN_DRIVER_CONFORMANCE_FIXTURE_NAMES: readonly PluginDriverConformanceFixtureName[] =
  ['filter_logic', 'filter_text', 'temporal', 'pagination'];

/** A declared field of a fixture object, as an object's `fields` record declares it. */
export interface PluginDriverConformanceField {
  type: 'text' | 'number' | 'datetime' | 'date';
}

/**
 * One fixture: an object, its declared fields, and the rows its remote must
 * hold — exactly these, no more. `null` is a real value here (the null family
 * of the filter tables): a remote that stores it as `''` fails the shape case.
 */
export interface PluginDriverConformanceFixture {
  name: PluginDriverConformanceFixtureName;
  /** The object name the kit reads; a setup may answer another (`PluginDriverConformanceTarget.object`). */
  object: string;
  fields: Readonly<Record<string, PluginDriverConformanceField>>;
  /** A fresh copy on every call. `id` is a string on every row. */
  rows: Row[];
}

const FIXTURE_FIELDS: Record<PluginDriverConformanceFixtureName, Record<string, PluginDriverConformanceField>> = {
  filter_logic: {
    a: { type: 'text' }, b: { type: 'text' }, c: { type: 'text' }, d: { type: 'text' },
    owner: { type: 'text' }, status: { type: 'text' }, parent_object: { type: 'text' }, parent_id: { type: 'text' },
  },
  filter_text: { name: { type: 'text' }, score: { type: 'number' } },
  temporal: { at: { type: 'datetime' }, on: { type: 'date' } },
  pagination: { status: { type: 'text' }, rank: { type: 'number' }, name: { type: 'text' } },
};

function fixtureRows(name: PluginDriverConformanceFixtureName): Row[] {
  switch (name) {
    case 'filter_logic': return FILTER_LOGIC_ROWS.map((row) => ({ ...row }));
    case 'filter_text': return FILTER_TEXT_ROWS.map((row) => ({ ...row }));
    // The wire form: a remote stores an instant however it likes, and the
    // shape case accepts a native `Date` for the same instant back.
    case 'temporal': return TEMPORAL_ROWS.map(({ id, at, on }) => ({ id, at, on }));
    case 'pagination': return PAGINATION_ROWS.map((row) => ({ ...row }));
  }
}

/** Every fixture, fresh: what a remote is seeded with before the kit runs. */
export function pluginDriverConformanceFixtures(): PluginDriverConformanceFixture[] {
  return PLUGIN_DRIVER_CONFORMANCE_FIXTURE_NAMES.map((name) => ({
    name,
    object: `conformance_${name}`,
    fields: FIXTURE_FIELDS[name],
    rows: fixtureRows(name),
  }));
}

const fixtureNamed = (name: PluginDriverConformanceFixtureName): PluginDriverConformanceFixture =>
  pluginDriverConformanceFixtures().find((f) => f.name === name)!;

// ===========================================================================
// Options
// ===========================================================================

/** What a setup answers: the driver under test, over a remote holding the fixture's rows. */
export interface PluginDriverConformanceTarget {
  driver: IDataDriver;
  /** The object name the driver serves the fixture under; defaults to `fixture.object`. */
  object?: string;
  /** Called once the kit is done with this driver. */
  teardown?(): void | Promise<void>;
}

/**
 * A write the caller knows the outcome of. The kit cannot make a remote refuse
 * a write, so the caller names one it refuses (a value its validation rejects,
 * a record it locks) and one it accepts.
 */
export interface PluginDriverConformanceWriteProbe {
  name: string;
  operation: ExternalWriteOperation;
  /** The arguments after the object name, e.g. `[id, patch]` for `update`. */
  args: readonly unknown[];
  /**
   * `refused`: the remote judges the request and refuses it, so the caller
   * must read `422 EXTERNAL_WRITE_REFUSED` with the remote's message.
   * `accepted`: the write goes through.
   */
  expect: 'refused' | 'accepted';
  /** The fixture the probe's remote holds; `filter_logic` when absent. */
  fixture?: PluginDriverConformanceFixtureName;
}

/** The kit's tiers — see the module comment. */
export type PluginDriverConformanceTier = 'floor' | 'direct';

export interface PluginDriverConformanceOptions {
  /** Builds the driver over a remote holding exactly `fixture.rows`. */
  setup(fixture: PluginDriverConformanceFixture): PluginDriverConformanceTarget | Promise<PluginDriverConformanceTarget>;
  /**
   * Builds the driver over a remote that is down — every request fails as an
   * unreachable host or a server error does. Absent ⇒ the outage cases report
   * `not-offered`.
   */
  setupUnavailable?(fixture: PluginDriverConformanceFixture): PluginDriverConformanceTarget | Promise<PluginDriverConformanceTarget>;
  /** Absent or empty ⇒ the write cases report `not-offered`. */
  writeProbes?: readonly PluginDriverConformanceWriteProbe[];
  /** `['floor']` when absent. */
  tiers?: readonly PluginDriverConformanceTier[];
}

// ===========================================================================
// Cases and outcomes
// ===========================================================================

/** How a driver answered a read's filter, measured (never declared). */
export type PluginDriverPushdown = 'exact' | 'superset' | 'refused';

/** A case that ran and held. */
export interface PluginDriverConformanceOutcome {
  status: 'pass' | 'not-offered';
  /** Read cases: how the driver answered the filter it was sent. */
  pushdown?: PluginDriverPushdown;
  /** Ordered read cases: did the driver's own rows arrive in the requested order? */
  order?: 'honoured' | 'not-honoured';
  /** `not-offered`: what was absent. */
  note?: string;
}

/** A case the driver failed: the message names the query, the rule and the fix. */
export class PluginDriverConformanceFailure extends Error {
  constructor(readonly caseId: string, message: string) {
    super(`${caseId}: ${message}`);
    this.name = 'PluginDriverConformanceFailure';
  }
}

export type PluginDriverConformanceGroup =
  | 'shape' | 'filter' | 'count' | 'find-one' | 'order' | 'paging' | 'write' | 'outage' | 'introspect';

export interface PluginDriverConformanceCase {
  /** Stable across releases: `tier/group/fixture/case name`. */
  id: string;
  tier: PluginDriverConformanceTier;
  group: PluginDriverConformanceGroup;
  fixture: PluginDriverConformanceFixtureName;
  name: string;
  /** Resolves on a pass; rejects with {@link PluginDriverConformanceFailure} on a failure. */
  run(): Promise<PluginDriverConformanceOutcome>;
}

export interface PluginDriverConformance {
  cases: PluginDriverConformanceCase[];
  /** Tears down every setup the cases made. Call once, after the last case. */
  dispose(): Promise<void>;
}

// ===========================================================================
// The kit
// ===========================================================================

/** The datasource name the kit's floor names in its refusals. */
const DATASOURCE = 'conformance';

interface Session {
  driver: IDataDriver;
  object: string;
  fixture: PluginDriverConformanceFixture;
  warnings: string[];
}

/**
 * The kit's cases for one driver, and the disposer of the setups they share.
 * Each case calls `setup` lazily, so building the list costs nothing.
 */
export function createPluginDriverConformance(options: PluginDriverConformanceOptions): PluginDriverConformance {
  const tiers = new Set(options.tiers ?? ['floor']);
  for (const tier of tiers) {
    if (tier !== 'floor' && tier !== 'direct') {
      throw new TypeError(`plugin driver conformance: unknown tier '${String(tier)}' — the tiers are 'floor' and 'direct'`);
    }
  }

  const teardowns: Array<() => void | Promise<void>> = [];
  const shared = new Map<PluginDriverConformanceFixtureName, Promise<Session>>();

  const open = async (
    build: PluginDriverConformanceOptions['setup'],
    name: PluginDriverConformanceFixtureName,
  ): Promise<Session> => {
    const fixture = fixtureNamed(name);
    const target = await build(fixture);
    if (!target || typeof target.driver?.find !== 'function') {
      throw new TypeError(`plugin driver conformance: setup('${name}') answered no driver with a find()`);
    }
    if (target.teardown) teardowns.push(() => target.teardown!());
    return { driver: target.driver, object: target.object ?? fixture.object, fixture, warnings: [] };
  };
  const sessionFor = (name: PluginDriverConformanceFixtureName): Promise<Session> => {
    let session = shared.get(name);
    if (!session) {
      session = open(options.setup, name);
      shared.set(name, session);
    }
    return session;
  };

  const cases: PluginDriverConformanceCase[] = [];
  const add = (
    tier: PluginDriverConformanceTier, group: PluginDriverConformanceGroup,
    fixture: PluginDriverConformanceFixtureName, name: string,
    run: (id: string) => Promise<PluginDriverConformanceOutcome>,
  ) => {
    if (!tiers.has(tier)) return;
    const id = `${tier}/${group}/${fixture}/${name}`;
    cases.push({ id, tier, group, fixture, name, run: () => run(id) });
  };

  // ── floor ────────────────────────────────────────────────────────────────
  for (const name of PLUGIN_DRIVER_CONFORMANCE_FIXTURE_NAMES) {
    add('floor', 'shape', name, 'every row, as stored', async (id) => shapeCase(id, await sessionFor(name)));
  }
  for (const c of filterCases()) {
    add('floor', 'filter', c.fixture, c.name, async (id) => floorFilterCase(id, await sessionFor(c.fixture), c));
  }
  for (const c of FILTER_LOGIC_CASES) {
    add('floor', 'count', 'filter_logic', c.name, async (id) =>
      floorCountCase(id, await sessionFor('filter_logic'), c.filter, c.expected));
  }
  for (const c of PAGINATION_CASES) {
    add('floor', 'order', 'pagination', c.name, async (id) =>
      floorOrderCase(id, await sessionFor('pagination'), c.orderBy, c.pageSize));
  }
  const probes = options.writeProbes ?? [];
  if (probes.length === 0) {
    add('floor', 'write', 'filter_logic', 'write probes', async () =>
      ({ status: 'not-offered', note: 'no writeProbes were given' }));
  }
  for (const probe of probes) {
    const fixture = probe.fixture ?? 'filter_logic';
    add('floor', 'write', fixture, probe.name, async (id) =>
      writeCase(id, await open(options.setup, fixture), probe));
  }
  for (const verb of ['find', 'findOne', 'count'] as const) {
    add('floor', 'outage', 'filter_logic', `${verb} while the remote is down`, async (id) => {
      if (!options.setupUnavailable) return { status: 'not-offered', note: 'no setupUnavailable was given' };
      return outageCase(id, await open(options.setupUnavailable, 'filter_logic'), verb);
    });
  }
  add('floor', 'introspect', 'filter_logic', 'introspectSchema answers the spec shape', async (id) =>
    introspectCase(id, await sessionFor('filter_logic')));

  // ── direct ───────────────────────────────────────────────────────────────
  for (const c of filterCases()) {
    add('direct', 'filter', c.fixture, c.name, async (id) => directFilterCase(id, await sessionFor(c.fixture), c));
  }
  for (const c of FILTER_LOGIC_CASES) {
    add('direct', 'count', 'filter_logic', c.name, async (id) =>
      directCountCase(id, await sessionFor('filter_logic'), c.filter, c.expected.length));
    add('direct', 'find-one', 'filter_logic', c.name, async (id) =>
      directFindOneCase(id, await sessionFor('filter_logic'), c.filter, c.expected));
  }
  for (const c of PAGINATION_CASES) {
    add('direct', 'paging', 'pagination', c.name, async (id) =>
      directPagingCase(id, await sessionFor('pagination'), c.orderBy, c.pageSize));
  }
  for (const c of PAGINATION_UNORDERED_CASES) {
    add('direct', 'paging', 'pagination', `unordered — ${c.name}`, async (id) =>
      directPagingCase(id, await sessionFor('pagination'), undefined, c.pageSize));
  }
  for (const c of PAGINATION_ZERO_LIMIT_CASES) {
    add('direct', 'paging', 'pagination', `limit by presence — ${c.name}`, async (id) =>
      directZeroLimitCase(id, await sessionFor('pagination'), c.query, c.expectedRowCount));
  }

  return {
    cases,
    async dispose() {
      const pending = teardowns.splice(0);
      shared.clear();
      for (const teardown of pending) await teardown();
    },
  };
}

/** A report of one run: every case's id and status, and why each failure failed. */
export interface PluginDriverConformanceReport {
  /** The driver's `name`, from the first setup that ran. */
  driver: string | undefined;
  passed: boolean;
  results: Array<{
    id: string;
    tier: PluginDriverConformanceTier;
    group: PluginDriverConformanceGroup;
    status: 'pass' | 'fail' | 'not-offered';
    pushdown?: PluginDriverPushdown;
    order?: 'honoured' | 'not-honoured';
    message?: string;
  }>;
}

/** Runs every case in order, with no test framework, and answers a report. Never throws for a failing case. */
export async function runPluginDriverConformance(options: PluginDriverConformanceOptions): Promise<PluginDriverConformanceReport> {
  let driver: string | undefined;
  const conformance = createPluginDriverConformance({
    ...options,
    setup: async (fixture) => {
      const target = await options.setup(fixture);
      driver ??= target?.driver?.name;
      return target;
    },
  });
  const results: PluginDriverConformanceReport['results'] = [];
  try {
    for (const c of conformance.cases) {
      try {
        const outcome = await c.run();
        results.push({
          id: c.id, tier: c.tier, group: c.group, status: outcome.status,
          ...(outcome.pushdown ? { pushdown: outcome.pushdown } : {}),
          ...(outcome.order ? { order: outcome.order } : {}),
          ...(outcome.note ? { message: outcome.note } : {}),
        });
      } catch (error) {
        results.push({
          id: c.id, tier: c.tier, group: c.group, status: 'fail',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    await conformance.dispose();
  }
  return { driver, passed: results.every((r) => r.status !== 'fail'), results };
}

/** The test-framework surface the suite registers into: vitest's and jest's `describe` / `it` / `afterAll`. */
export interface PluginDriverConformanceTestApi {
  describe(name: string, body: () => void): unknown;
  it(name: string, body: () => Promise<void>): unknown;
  afterAll?(body: () => Promise<void>): unknown;
}

/**
 * Registers one test per case, grouped by tier and group, under `title`. A
 * `not-offered` case passes (it says so in the report, not here); a failing
 * case's test fails with the case's message.
 */
export function definePluginDriverConformanceSuite(
  api: PluginDriverConformanceTestApi,
  options: PluginDriverConformanceOptions,
  title = 'plugin driver conformance',
): void {
  const conformance = createPluginDriverConformance(options);
  api.describe(title, () => {
    const groups = new Map<string, PluginDriverConformanceCase[]>();
    for (const c of conformance.cases) {
      const key = `${c.tier} — ${c.group}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(c);
    }
    for (const [key, members] of groups) {
      api.describe(key, () => {
        for (const c of members) api.it(`${c.fixture}: ${c.name}`, async () => { await c.run(); });
      });
    }
    api.afterAll?.(() => conformance.dispose());
  });
}

// ===========================================================================
// The filter cases, across the three tables
// ===========================================================================

interface FilterCase {
  fixture: 'filter_logic' | 'filter_text' | 'temporal';
  name: string;
  /** The `where` as the engine hands it to a driver: tokens resolved, the shared lowering applied. */
  where: FilterCondition;
  expected: readonly string[];
}

function filterCases(): FilterCase[] {
  const out: FilterCase[] = [];
  for (const c of FILTER_LOGIC_CASES) out.push({ fixture: 'filter_logic', name: c.name, where: c.filter, expected: c.expected });
  for (const c of FILTER_TEXT_CASES) {
    if (c.expectRejection === true) continue; // the floor refuses it before the driver is asked
    out.push({ fixture: 'filter_text', name: c.name, where: c.filter, expected: c.expected });
  }
  const lowered = (filter: FilterCondition) =>
    lowerFilterCondition(filter, { isDatetimeColumn: (column) => column === 'at' });
  for (const c of TEMPORAL_CASES) {
    out.push({ fixture: 'temporal', name: c.name, where: lowered(c.filter), expected: c.expected });
    if (c.tokenFilter) {
      out.push({
        fixture: 'temporal',
        name: `${c.name} — via relative tokens`,
        where: lowered(resolveFilterTokens(c.tokenFilter, { now: new Date(TEMPORAL_NOW) })),
        expected: c.expected,
      });
    }
  }
  return out;
}

// ===========================================================================
// Case bodies
// ===========================================================================

const ROW_LIMIT = EXTERNAL_ROW_CAP + 1;

/** A JSON rendering of a query for a failure message; a bigint or a cycle never throws here. */
function show(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, v) => (v instanceof Date ? v.toISOString() : v)) ?? String(value);
  } catch {
    return String(value);
  }
}

const sorted = (ids: Iterable<string>) => [...ids].sort();

/** The HTTP status a thrown error declares, as the floor reads it: `status`, then `statusCode`. */
function declaredStatus(error: unknown): number | undefined {
  const { status, statusCode } = (error ?? {}) as { status?: unknown; statusCode?: unknown };
  const value = typeof status === 'number' ? status : typeof statusCode === 'number' ? statusCode : undefined;
  return value !== undefined && Number.isInteger(value) ? value : undefined;
}

const describeThrow = (error: unknown): string => {
  const status = declaredStatus(error);
  const message = error instanceof Error ? error.message : String(error);
  return `${status === undefined ? 'with no status' : `with status ${status}`} (${show(message)})`;
};

/** The floor over the session's driver, recording what the driver itself answered to each `find`. */
function floored(session: Session) {
  const answers: Array<{ rows?: unknown; error?: unknown }> = [];
  const inner = session.driver;
  const recorder = new Proxy(inner, {
    get(target, prop) {
      if (prop === 'find') {
        return async (object: string, query?: DriverQuery, opts?: unknown) => {
          try {
            const rows = await target.find(object, query ?? {}, opts as Parameters<IDataDriver['find']>[2]);
            answers.push({ rows });
            return rows;
          } catch (error) {
            answers.push({ error });
            throw error;
          }
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  }) as IDataDriver;
  const driver = createExternalDriverFloor(recorder, {
    datasource: DATASOURCE,
    fieldsOf: () => session.fixture.fields,
    logger: { warn: (message) => { session.warnings.push(message); } },
  });
  return { driver, answers };
}

/**
 * The driver's own rows for a read, judged as the floor needs them: an array of
 * fixture rows with string ids, no row twice, and every row in `mustInclude`.
 * Answers their ids in arrival order.
 */
function judgeRows(id: string, session: Session, query: unknown, rows: unknown, mustInclude: readonly string[]): string[] {
  const asked = `find('${session.object}', ${show(query)})`;
  if (!Array.isArray(rows)) {
    throw new PluginDriverConformanceFailure(id,
      `${asked} answered ${rows === null ? 'null' : typeof rows}, not an array of rows. Return the rows; throw to refuse.`);
  }
  const known = new Set(session.fixture.rows.map((r) => r.id as string));
  const seen = new Set<string>();
  const order: string[] = [];
  for (const row of rows) {
    const rowId = (row as Row | null)?.id;
    if (typeof rowId !== 'string') {
      throw new PluginDriverConformanceFailure(id,
        `${asked} answered a row whose id is ${show(rowId)}; every row carries its id as a string.`);
    }
    if (!known.has(rowId)) {
      throw new PluginDriverConformanceFailure(id,
        `${asked} answered a row with id '${rowId}', which the remote does not hold; return only stored rows.`);
    }
    if (seen.has(rowId)) {
      throw new PluginDriverConformanceFailure(id,
        `${asked} answered the row '${rowId}' twice; return each row once (a paged remote read overlapped).`);
    }
    seen.add(rowId);
    order.push(rowId);
  }
  const missing = mustInclude.filter((m) => !seen.has(m));
  if (missing.length > 0) {
    throw new PluginDriverConformanceFailure(id,
      `${asked} left out matching rows ${show(missing)}. The engine filters the rows a driver returns, so an `
      + 'extra row costs only transfer, but a missing one is lost: when part of a where cannot be translated, '
      + 'send the remote a WIDER filter (drop the untranslatable member of a top-level $and, or the whole $or '
      + 'or $not that holds it) or refuse with a status of 400.');
  }
  return order;
}

/** A driver throw read as the floor reads it: a request-shaped refusal passes, anything else fails. */
function judgeReadThrow(id: string, session: Session, query: unknown, error: unknown): PluginDriverPushdown {
  const status = declaredStatus(error);
  if (status !== undefined && EXTERNAL_READ_REFUSED_STATUSES.has(status)) return 'refused';
  throw new PluginDriverConformanceFailure(id,
    `find('${session.object}', ${show(query)}) threw ${describeThrow(error)}. The caller reads that as `
    + '503 ERR_DATASOURCE_UNAVAILABLE, "retry later", for a query no retry clears. Refuse a query the remote cannot '
    + `run with a status of ${sorted([...EXTERNAL_READ_REFUSED_STATUSES].map(String)).join(', ')} on the error.`);
}

/** Is `got` the stored `want` of a field of this type? `null` and absent agree; a datetime may come back as a `Date`. */
function sameStoredValue(type: PluginDriverConformanceField['type'], want: unknown, got: unknown): boolean {
  if (want === null || want === undefined) return got === null || got === undefined;
  if (type === 'datetime' || type === 'date') {
    if (got instanceof Date) {
      const iso = got.toISOString();
      return type === 'datetime' ? iso === new Date(want as string).toISOString() : iso.slice(0, 10) === want;
    }
    if (type === 'datetime' && typeof got === 'string') {
      const instant = Date.parse(got);
      return !Number.isNaN(instant) && instant === Date.parse(want as string);
    }
  }
  return got === want;
}

async function shapeCase(id: string, session: Session): Promise<PluginDriverConformanceOutcome> {
  const query = { object: session.object, limit: ROW_LIMIT };
  let rows: unknown;
  try {
    rows = await session.driver.find(session.object, query as DriverQuery);
  } catch (error) {
    throw new PluginDriverConformanceFailure(id,
      `find('${session.object}', ${show(query)}) threw ${describeThrow(error)} for the plainest read the engine sends: `
      + 'no filter, the row cap as its limit.');
  }
  const all = session.fixture.rows.map((r) => r.id as string);
  judgeRows(id, session, query, rows, all);
  const byId = new Map(session.fixture.rows.map((r) => [r.id as string, r]));
  for (const row of rows as Row[]) {
    if ('_id' in row) {
      throw new PluginDriverConformanceFailure(id,
        `the row '${row.id as string}' carries '_id'; a row carries its id as 'id' and no storage key besides.`);
    }
    const stored = byId.get(row.id as string)!;
    for (const [field, { type }] of Object.entries(session.fixture.fields)) {
      if (!sameStoredValue(type, stored[field], row[field])) {
        throw new PluginDriverConformanceFailure(id,
          `the row '${row.id as string}' answered ${field} = ${show(row[field])}, but the remote holds `
          + `${show(stored[field])} (a ${type} field). The engine evaluates the filter over the values a driver `
          + 'returns, so a changed value (a null as an empty string, a number as text) changes which rows match.');
      }
    }
  }
  return { status: 'pass' };
}

/**
 * One read through the floor, judged on both sides: the driver's own answer to
 * the query the floor sent it (every row in `mustInclude`, or a request-shaped
 * refusal), then the floored answer, handed back for the case to compare.
 */
async function flooredRead<T>(
  id: string, session: Session, sent: Row, mustInclude: readonly string[],
  read: (driver: IDataDriver) => Promise<T>,
): Promise<{ refused: true } | { value: T; ids: string[] }> {
  const { driver, answers } = floored(session);
  let value: T | undefined;
  let thrown: unknown;
  try {
    value = await read(driver);
  } catch (error) {
    thrown = error;
  }
  const own = answers[0];
  if (!own) {
    throw thrown ?? new PluginDriverConformanceFailure(id, 'the floor answered without asking the driver');
  }
  if ('error' in own) {
    judgeReadThrow(id, session, sent, own.error);
    if (!(thrown instanceof ExternalReadRefusedError)) {
      throw new PluginDriverConformanceFailure(id, `the driver refused, but the caller read ${describeThrow(thrown)}.`);
    }
    return { refused: true };
  }
  const ids = judgeRows(id, session, sent, own.rows, mustInclude);
  if (thrown !== undefined) throw thrown;
  return { value: value as T, ids };
}

async function floorFilterCase(id: string, session: Session, c: FilterCase): Promise<PluginDriverConformanceOutcome> {
  const query = { object: session.object, where: c.where };
  const read = await flooredRead(id, session, { ...query, limit: ROW_LIMIT }, c.expected,
    (driver) => driver.find(session.object, query as DriverQuery));
  if ('refused' in read) return { status: 'pass', pushdown: 'refused' };
  const got = sorted(read.value.map((r) => r.id as string));
  if (show(got) !== show(sorted(c.expected))) {
    throw new PluginDriverConformanceFailure(id,
      `through the floor, ${show(c.where)} answered ${show(got)}; the conformance table expects ${show(sorted(c.expected))}. `
      + 'The driver returned every matching row, so the values it returned differ from what the remote holds.');
  }
  return { status: 'pass', pushdown: read.ids.length === c.expected.length ? 'exact' : 'superset' };
}

async function floorCountCase(
  id: string, session: Session, where: FilterCondition, expected: readonly string[],
): Promise<PluginDriverConformanceOutcome> {
  const query = { object: session.object, where };
  const read = await flooredRead(id, session, { ...query, limit: ROW_LIMIT }, expected,
    (driver) => driver.count(session.object, query as DriverQuery));
  if ('refused' in read) return { status: 'pass', pushdown: 'refused' };
  if (read.value !== expected.length) {
    throw new PluginDriverConformanceFailure(id,
      `through the floor, count with ${show(where)} answered ${show(read.value)}; the conformance table expects ${expected.length}.`);
  }
  return { status: 'pass', pushdown: read.ids.length === expected.length ? 'exact' : 'superset' };
}

type OrderBy = ReadonlyArray<{ field: string; order: 'asc' | 'desc' }>;

/** Do these rows arrive in `orderBy`'s order (ties in any order)? Absent values sort last, as the engine sorts. */
function inOrder(rows: Row[], orderBy: OrderBy): boolean {
  const compare = (x: Row, y: Row) => {
    for (const { field, order } of orderBy) {
      const a = x[field];
      const b = y[field];
      const absentA = a === null || a === undefined;
      const absentB = b === null || b === undefined;
      if (absentA || absentB) {
        if (absentA !== absentB) return absentA ? 1 : -1;
        continue;
      }
      if (a === b) continue;
      const lt = (a as number) < (b as number);
      return (order === 'desc' ? !lt : lt) ? -1 : 1;
    }
    return 0;
  };
  return rows.every((row, i) => i === 0 || compare(rows[i - 1]!, row) <= 0);
}

/**
 * A paged walk is a partition in the requested order: every row exactly once,
 * and the walk's sort keys equal one unpaged in-memory read's.
 */
function judgeWalk(id: string, session: Session, visited: Row[], orderBy: OrderBy | undefined, how: string): void {
  const ids = visited.map((r) => r.id as string);
  const all = session.fixture.rows.map((r) => r.id as string);
  if (ids.length !== new Set(ids).size || show(sorted(ids)) !== show(sorted(all))) {
    throw new PluginDriverConformanceFailure(id,
      `${how} visited ${show(ids)}; a paged read visits every row exactly once (${all.length} rows). `
      + 'Order by a unique column after the requested keys, so a page boundary inside a run of equal keys is stable.');
  }
  if (orderBy) {
    const byId = new Map(session.fixture.rows.map((r) => [r.id as string, r]));
    const keys = (rowId: string) => orderBy.map(({ field }) => byId.get(rowId)![field]);
    const want = applyDriverQueryInMemory(session.fixture.rows, { orderBy }).map((r) => r.id as string);
    if (show(ids.map(keys)) !== show(want.map(keys))) {
      throw new PluginDriverConformanceFailure(id, `${how} visited the rows out of the order ${show(orderBy)}: ${show(ids)}.`);
    }
  }
}

async function floorOrderCase(
  id: string, session: Session, orderBy: OrderBy, pageSize: number,
): Promise<PluginDriverConformanceOutcome> {
  const all = session.fixture.rows.map((r) => r.id as string);
  const sent = { object: session.object, orderBy, limit: ROW_LIMIT };
  const visited: Row[] = [];
  let honoured = true;
  for (let offset = 0; offset < all.length; offset += pageSize) {
    const query = { object: session.object, orderBy, limit: pageSize, offset };
    const read = await flooredRead(id, session, sent, all, (driver) => driver.find(session.object, query as DriverQuery));
    if ('refused' in read) return { status: 'pass', pushdown: 'refused' };
    const driverRows = read.ids.map((rowId) => session.fixture.rows.find((r) => r.id === rowId)!);
    if (!inOrder(driverRows, orderBy)) honoured = false;
    visited.push(...read.value);
  }
  judgeWalk(id, session, visited, orderBy, `through the floor, a walk of ${pageSize}-row pages by ${show(orderBy)}`);
  return { status: 'pass', pushdown: 'exact', order: honoured ? 'honoured' : 'not-honoured' };
}

async function writeCase(
  id: string, session: Session, probe: PluginDriverConformanceWriteProbe,
): Promise<PluginDriverConformanceOutcome> {
  const driver = createExternalDriverFloor(session.driver, {
    datasource: DATASOURCE,
    fieldsOf: () => session.fixture.fields,
    logger: { warn: (message) => { session.warnings.push(message); } },
  });
  const method = (driver as unknown as Record<string, unknown>)[probe.operation];
  if (typeof method !== 'function') {
    throw new PluginDriverConformanceFailure(id, `the driver offers no ${probe.operation}(); the probe cannot run.`);
  }
  const call = `${probe.operation}('${session.object}', ${probe.args.map(show).join(', ')})`;
  try {
    await (method as (...args: unknown[]) => Promise<unknown>)(session.object, ...probe.args);
  } catch (error) {
    if (probe.expect === 'refused' && error instanceof ExternalWriteRefusedError && error.code === EXTERNAL_WRITE_REFUSED_CODE) {
      return { status: 'pass' };
    }
    const cause = (error as { cause?: unknown }).cause;
    if (probe.expect === 'refused') {
      throw new PluginDriverConformanceFailure(id,
        `${call} was refused, but the driver threw ${describeThrow(cause ?? error)}, so the caller read `
        + `${(error as { code?: unknown }).code as string} instead of 422 EXTERNAL_WRITE_REFUSED with the remote's reason. `
        + `A write the remote refuses for the request's own sake declares one of `
        + `${sorted([...EXTERNAL_WRITE_REFUSED_STATUSES].map(String)).join(', ')} as the error's status.`);
    }
    throw new PluginDriverConformanceFailure(id, `${call} should go through, but threw ${describeThrow(cause ?? error)}.`);
  }
  if (probe.expect === 'refused') {
    throw new PluginDriverConformanceFailure(id, `${call} should be refused by the remote, but it resolved.`);
  }
  return { status: 'pass' };
}

async function outageCase(
  id: string, session: Session, verb: 'find' | 'findOne' | 'count',
): Promise<PluginDriverConformanceOutcome> {
  const { driver, answers } = floored(session);
  const query = { object: session.object, where: { status: 'active' } } as DriverQuery;
  let answer: unknown;
  try {
    answer = await (driver[verb] as (o: string, q: DriverQuery) => Promise<unknown>)(session.object, query);
  } catch (error) {
    if (error instanceof DatasourceUnavailableError) return { status: 'pass' };
    const own = answers[0];
    throw new PluginDriverConformanceFailure(id,
      `while the remote is down, ${verb} reached the caller as ${(error as { code?: unknown }).code as string} `
      + `because the driver threw ${describeThrow(own && 'error' in own ? own.error : error)}. A failed or unreachable `
      + 'remote throws with no status or a 5xx, so the caller reads 503 ERR_DATASOURCE_UNAVAILABLE; a 400, 404 or 422 '
      + 'tells them their query is wrong.');
  }
  throw new PluginDriverConformanceFailure(id,
    `while the remote is down, ${verb} answered ${show(answer)}. Throw when the remote fails: an empty answer reads `
    + 'exactly like "no rows match".');
}

async function introspectCase(id: string, session: Session): Promise<PluginDriverConformanceOutcome> {
  if (typeof session.driver.introspectSchema !== 'function') {
    return { status: 'not-offered', note: 'the driver offers no introspectSchema()' };
  }
  const schema = await session.driver.introspectSchema();
  const fail = (what: string): never => {
    throw new PluginDriverConformanceFailure(id, `introspectSchema() answered ${what} (IntrospectedSchema, @objectstack/spec/contracts).`);
  };
  if (schema === null || typeof schema !== 'object') fail(`${show(schema)}, not an object`);
  if (typeof schema.dialect !== 'string' || schema.dialect === '') fail('no dialect string');
  if (typeof schema.introspectedAt !== 'string' || Number.isNaN(Date.parse(schema.introspectedAt))) {
    fail(`introspectedAt ${show(schema.introspectedAt)}, not an ISO 8601 time`);
  }
  if (schema.tables === null || typeof schema.tables !== 'object' || Array.isArray(schema.tables)) {
    fail('no tables record');
  }
  for (const [key, table] of Object.entries(schema.tables)) {
    if (table === null || typeof table !== 'object') fail(`table '${key}' as ${show(table)}`);
    if (typeof table.name !== 'string' || table.name === '') fail(`table '${key}' with no name`);
    if (!Array.isArray(table.columns)) fail(`table '${key}' with no columns array`);
    for (const column of table.columns as unknown[]) {
      const col = (column ?? {}) as Record<string, unknown>;
      const label = `column ${show(col.name)} of table '${key}'`;
      if (typeof col.name !== 'string' || col.name === '') fail(`a ${label} with no name`);
      if (typeof col.type !== 'string') fail(`${label} with no type string`);
      if (typeof col.nullable !== 'boolean') fail(`${label} with no nullable boolean`);
      if (typeof col.primaryKey !== 'boolean') {
        fail(`${label} with no primaryKey boolean${'isPrimary' in col ? ' (it spells it isPrimary)' : ''}`);
      }
    }
    if (table.indexes !== undefined) {
      if (!Array.isArray(table.indexes)) fail(`table '${key}' with indexes that are not an array (omit the key when not read)`);
      for (const index of table.indexes as unknown[]) {
        const idx = (index ?? {}) as Record<string, unknown>;
        if (typeof idx.name !== 'string' || !Array.isArray(idx.columns) || typeof idx.unique !== 'boolean') {
          fail(`table '${key}' with the index ${show(index)}, not { name, columns, unique }`);
        }
      }
    }
  }
  return { status: 'pass' };
}

// ── direct ──────────────────────────────────────────────────────────────────

async function directRead<T>(
  id: string, session: Session, verb: string, query: unknown, read: () => Promise<T>,
): Promise<{ value: T } | { refused: true }> {
  try {
    return { value: await read() };
  } catch (error) {
    const status = declaredStatus(error);
    if (status !== undefined && EXTERNAL_READ_REFUSED_STATUSES.has(status)) return { refused: true };
    throw new PluginDriverConformanceFailure(id,
      `${verb}('${session.object}', ${show(query)}) threw ${describeThrow(error)}; answer it, or refuse it with a status of 400.`);
  }
}

async function directFilterCase(id: string, session: Session, c: FilterCase): Promise<PluginDriverConformanceOutcome> {
  const query = { object: session.object, where: c.where };
  const read = await directRead(id, session, 'find', query, () => session.driver.find(session.object, query as DriverQuery));
  if ('refused' in read) return { status: 'pass', pushdown: 'refused' };
  const ids = judgeRows(id, session, query, read.value, c.expected);
  if (ids.length !== c.expected.length) {
    const extra = ids.filter((rowId) => !c.expected.includes(rowId));
    throw new PluginDriverConformanceFailure(id,
      `find('${session.object}', ${show(query)}) answered rows that do not match: ${show(sorted(extra))}. `
      + 'A driver trusted to skip the floor applies the whole where.');
  }
  return { status: 'pass', pushdown: 'exact' };
}

async function directCountCase(
  id: string, session: Session, where: FilterCondition, expected: number,
): Promise<PluginDriverConformanceOutcome> {
  const query = { object: session.object, where };
  const read = await directRead(id, session, 'count', query, () => session.driver.count(session.object, query as DriverQuery));
  if ('refused' in read) return { status: 'pass', pushdown: 'refused' };
  if (read.value !== expected) {
    throw new PluginDriverConformanceFailure(id,
      `count('${session.object}', ${show(query)}) answered ${show(read.value)}; the conformance table expects ${expected}.`);
  }
  return { status: 'pass', pushdown: 'exact' };
}

async function directFindOneCase(
  id: string, session: Session, where: FilterCondition, expected: readonly string[],
): Promise<PluginDriverConformanceOutcome> {
  const query = { object: session.object, where, limit: 1 };
  const read = await directRead(id, session, 'findOne', query, () => session.driver.findOne(session.object, query as DriverQuery));
  if ('refused' in read) return { status: 'pass', pushdown: 'refused' };
  const row = read.value as Row | null | undefined;
  if (expected.length === 0) {
    if (row !== null && row !== undefined) {
      throw new PluginDriverConformanceFailure(id,
        `findOne('${session.object}', ${show(query)}) answered the row ${show(row.id)}, but no row matches; answer null.`);
    }
    return { status: 'pass', pushdown: 'exact' };
  }
  if (row === null || row === undefined || !expected.includes(row.id as string)) {
    throw new PluginDriverConformanceFailure(id,
      `findOne('${session.object}', ${show(query)}) answered ${show(row?.id ?? row)}; one of ${show(expected)} matches.`);
  }
  return { status: 'pass', pushdown: 'exact' };
}

async function directPagingCase(
  id: string, session: Session, orderBy: OrderBy | undefined, pageSize: number,
): Promise<PluginDriverConformanceOutcome> {
  const visited: Row[] = [];
  for (let offset = 0; offset < session.fixture.rows.length; offset += pageSize) {
    const query = { object: session.object, ...(orderBy ? { orderBy } : {}), limit: pageSize, offset };
    const read = await directRead(id, session, 'find', query, () => session.driver.find(session.object, query as DriverQuery));
    if ('refused' in read) return { status: 'pass', pushdown: 'refused' };
    judgeRows(id, session, query, read.value, []);
    const page = read.value as Row[];
    if (page.length > pageSize) {
      throw new PluginDriverConformanceFailure(id,
        `find('${session.object}', ${show(query)}) answered ${page.length} rows; limit is the most rows a page holds.`);
    }
    visited.push(...page);
  }
  judgeWalk(id, session, visited, orderBy,
    `a walk of ${pageSize}-row pages${orderBy ? ` by ${show(orderBy)}` : ' with no orderBy'}`);
  return { status: 'pass', pushdown: 'exact', ...(orderBy ? { order: 'honoured' as const } : {}) };
}

async function directZeroLimitCase(
  id: string, session: Session, shape: { limit?: number; offset?: number }, expected: number,
): Promise<PluginDriverConformanceOutcome> {
  const query = { object: session.object, ...shape };
  const read = await directRead(id, session, 'find', query, () => session.driver.find(session.object, query as DriverQuery));
  if ('refused' in read) return { status: 'pass', pushdown: 'refused' };
  judgeRows(id, session, query, read.value, []);
  const length = (read.value as Row[]).length;
  if (length !== expected) {
    throw new PluginDriverConformanceFailure(id,
      `find('${session.object}', ${show(query)}) answered ${length} rows; it must answer ${expected}. `
      + '`limit` is read by presence: `limit: 0` asks for no rows.');
  }
  return { status: 'pass', pushdown: 'exact' };
}
