// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8286] `/api/v1/analytics/query` echoed the executed statement to every
 * caller, on production deployments included — while the contract had declared
 * the echo debug-only all along (`AnalyticsResultResponseSchema.data.sql`,
 * "Executed SQL (if debug enabled)"). This file pins declared = enforced.
 *
 * ## Why every absence pin here is PAIRED
 *
 * "`sql` is absent" is trivially green against any fixture that never minted a
 * statement — a query that errored early, a strategy with no renderer, a cube
 * that does not exist. A whole suite of absence assertions can be vacuous and
 * still read as thorough. So no absence claim stands alone here:
 *
 *  - every arm captures, SERVER-SIDE, the statement the run actually produced
 *    (`executeRawSql` / the delegated service / the ObjectQL renderer), and
 *    asserts it is a real statement, so the fixture is proven capable of
 *    disclosure before absence is claimed of it; and
 *  - every absence arm has a presence twin on the SAME cube, the SAME query and
 *    the SAME rows, differing in the debug switch and nothing else.
 *
 * The vocabulary is `cross-field-engine-fallback.test.ts`'s, deliberately:
 * absence is `toBeUndefined()`, never falsiness — an empty string would satisfy
 * "no SQL" while still being a key on the wire.
 *
 * ## Every strategy, because the gate is one gate
 *
 * `NativeSQLStrategy` returns the statement it ran, `ObjectQLStrategy` renders
 * a representative one, and `FallbackDelegateStrategy` passes through whatever
 * the delegated service minted. All three are driven below on both sides of the
 * switch: a gate bolted onto one of them would leave the others serving.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Cube, FilterCondition } from '@objectstack/spec/data';
import type {
  AnalyticsQuery,
  AnalyticsResult,
  IAnalyticsService,
} from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { DatasetSchema } from '@objectstack/spec/ui';
import { AnalyticsService } from '../analytics-service.js';

const silentLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as any;

/** The card's cube: a member-walled directory object. */
const usersCube: Cube = {
  name: 'sys_user',
  title: 'Users',
  sql: 'sys_user',
  measures: {
    count: { name: 'count', label: 'Count', type: 'count', sql: '*' },
  },
  dimensions: {
    id: { name: 'id', label: 'Id', type: 'string', sql: 'id' },
  },
  public: false,
};

/**
 * The reported request, verbatim — no debug field of any kind, because the
 * request contract has none to set (see `AnalyticsServiceConfig.debugSql` for
 * why that is deliberate rather than an omission).
 */
const REPRO_QUERY: AnalyticsQuery = {
  cube: 'sys_user',
  measures: ['count'],
  dimensions: [],
};

const ROWS = [{ count: '2' }];

/** The enumerated member list the card says the echo disclosed the shape of. */
const MEMBER_SCOPE: FilterCondition = {
  id: { $in: ['usr_1', 'usr_2', 'usr_3'] },
} as FilterCondition;

/**
 * A native-SQL service over {@link usersCube}. `executed` collects the
 * statements the driver was actually asked to run — the server-side witness
 * that makes an absence assertion mean "withheld" rather than "never existed".
 */
function nativeService(options: { debugSql?: boolean; readScope?: FilterCondition } = {}) {
  const executed: string[] = [];
  const svc = new AnalyticsService({
    cubes: [usersCube],
    logger: silentLogger,
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async (_object, sql) => {
      executed.push(sql);
      return ROWS;
    },
    ...(options.readScope ? { getReadScope: () => options.readScope! } : {}),
    // Explicit on BOTH sides on purpose: an arm that let the default decide
    // would pass or fail with the shell's `NODE_ENV`, which is not a property
    // of this code. The default itself is pinned in its own block below.
    debugSql: options.debugSql,
  });
  return { svc, executed };
}

// ─────────────────────────────────────────────────────────────────
// NativeSQLStrategy — the reported path
// ─────────────────────────────────────────────────────────────────

describe('[#8286] NativeSQLStrategy — the echo is gated, the query is not', () => {
  it('debug ON: the response carries the statement that ran', async () => {
    const { svc, executed } = nativeService({ debugSql: true });

    const result = await svc.query(REPRO_QUERY);

    expect(result.rows).toEqual(ROWS);
    expect(executed).toHaveLength(1);
    expect(executed[0]).toContain('SELECT');
    expect(executed[0]).toContain('"sys_user"');
    // Not merely "a string": the echo is the statement the driver ran, which is
    // the only version of it worth handing a debugger.
    expect(result.sql).toBe(executed[0]);
  });

  it('debug OFF: the same query, the same rows — the echo is absent', async () => {
    const { svc, executed } = nativeService({ debugSql: false });

    const result = await svc.query(REPRO_QUERY);

    // The pair's whole point: this run DID mint a statement, on the same cube
    // and the same query as the arm above. Absence here is a withholding.
    expect(executed).toHaveLength(1);
    expect(executed[0]).toContain('SELECT');
    expect(result.rows).toEqual(ROWS);
    expect(result.sql, 'the echo must be absent, not half-rendered').toBeUndefined();
  });

  it('debug OFF: the isolation predicate does not travel at all', async () => {
    const { svc, executed } = nativeService({ debugSql: false, readScope: MEMBER_SCOPE });

    const result = await svc.query(REPRO_QUERY);

    // The read scope reached the statement — the disclosure the card describes
    // is real, and this fixture reproduces it.
    expect(executed[0]).toMatch(/"sys_user"\."id" IN \(/);
    // …and none of it reaches the caller: not the predicate's shape (an
    // enumerated `id IN (…)` member list rather than an `organization_id`
    // comparison), not its parameter arity (which counts the caller's own org),
    // not the physical table name.
    expect(result.sql).toBeUndefined();
    const onTheWire = JSON.stringify(result);
    expect(onTheWire).not.toContain('sys_user');
    expect(onTheWire).not.toContain('IN (');
    expect(onTheWire).not.toContain('SELECT');
  });

  it('debug ON: the isolation predicate is what the echo shows — same fixture', async () => {
    const { svc, executed } = nativeService({ debugSql: true, readScope: MEMBER_SCOPE });

    const result = await svc.query(REPRO_QUERY);

    expect(result.sql).toBe(executed[0]);
    expect(result.sql).toMatch(/"sys_user"\."id" IN \(/);
  });
});

// ─────────────────────────────────────────────────────────────────
// FallbackDelegateStrategy — the pass-through path
// ─────────────────────────────────────────────────────────────────

/**
 * A delegated analytics service that always echoes — the real shape of
 * `MemoryAnalyticsService` (`@objectstack/driver-memory`), which is what the
 * dev stack registers and what `FallbackDelegateStrategy` hands results back
 * from untouched.
 */
const DELEGATED_SQL = 'SELECT COUNT(*) AS "count" FROM sys_user';

function fallbackService(debugSql: boolean | undefined) {
  const delegate: IAnalyticsService = {
    query: async (): Promise<AnalyticsResult> => ({
      rows: ROWS,
      fields: [{ name: 'count', type: 'number' }],
      sql: DELEGATED_SQL,
    }),
    getMeta: vi.fn(),
  } as unknown as IAnalyticsService;

  return new AnalyticsService({
    cubes: [usersCube],
    logger: silentLogger,
    // No native SQL, no aggregate bridge — the delegate is the only strategy
    // that can handle this query, so what is measured below is genuinely its
    // pass-through and not some other path answering.
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: false, inMemory: false }),
    fallbackService: delegate,
    debugSql,
  });
}

describe('[#8286] FallbackDelegateStrategy — the delegate\'s echo is gated too', () => {
  it('debug ON: the delegated statement reaches the caller', async () => {
    const result = await fallbackService(true).query(REPRO_QUERY);

    expect(result.rows).toEqual(ROWS);
    expect(result.sql).toBe(DELEGATED_SQL);
  });

  it('debug OFF: the same delegate, the same rows — the echo is absent', async () => {
    const result = await fallbackService(false).query(REPRO_QUERY);

    // The delegate minted the statement either way (the arm above is the proof
    // on this very fixture); the seam is what withholds it. A gate bolted onto
    // `NativeSQLStrategy` alone would leave this arm serving.
    expect(result.rows).toEqual(ROWS);
    expect(result.sql, 'the echo must be absent, not half-rendered').toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────
// ObjectQLStrategy — the rendered-echo path
// ─────────────────────────────────────────────────────────────────

function objectqlService(debugSql: boolean | undefined) {
  return new AnalyticsService({
    cubes: [usersCube],
    logger: silentLogger,
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async () => ROWS,
    debugSql,
  });
}

describe('[#8286] ObjectQLStrategy — the rendered echo is gated', () => {
  it('debug ON: the representative statement reaches the caller', async () => {
    const result = await objectqlService(true).query(REPRO_QUERY);

    expect(result.rows).toEqual(ROWS);
    expect(result.sql).toContain('SELECT');
    expect(result.sql).toContain('sys_user');
  });

  it('debug OFF: the same query, the same rows — the echo is absent', async () => {
    const result = await objectqlService(false).query(REPRO_QUERY);

    expect(result.rows).toEqual(ROWS);
    expect(result.sql, 'the echo must be absent, not half-rendered').toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────
// The production default — the repro, with nothing configured
// ─────────────────────────────────────────────────────────────────

/**
 * The service resolves the default ONCE, in its constructor, so each arm builds
 * its service inside its own environment.
 */
async function queryUnderNodeEnv(value: string | undefined): Promise<AnalyticsResult> {
  const previous = process.env.NODE_ENV;
  try {
    if (value === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = value;
    // `debugSql` is not passed AT ALL — this is the deployment in the report: a
    // host that configured nothing, serving a request that asked for nothing.
    const svc = new AnalyticsService({
      cubes: [usersCube],
      logger: silentLogger,
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async () => ROWS,
    });
    return await svc.query(REPRO_QUERY);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}

describe('[#8286] the default posture — no host choice, no request field', () => {
  it('NODE_ENV=production: the echo is absent (the reported deployment)', async () => {
    const result = await queryUnderNodeEnv('production');
    expect(result.rows).toEqual(ROWS);
    expect(result.sql, 'the echo must be absent, not half-rendered').toBeUndefined();
  });

  it('NODE_ENV unset: absent too — an unset variable is not development', async () => {
    // The 2026-08-06 maintainer ruling for machine-readable environment
    // answers, inherited here: of the two ways to be wrong, disclosing on a
    // production deployment whose operator forgot the variable is the dangerous
    // one. `os start` / `os serve` / `os doctor` all read absence as production.
    const result = await queryUnderNodeEnv(undefined);
    expect(result.sql, 'the echo must be absent, not half-rendered').toBeUndefined();
  });

  it('NODE_ENV=development: present — the default is a default, not a removal', async () => {
    // The presence half of the default pair. Without it, the two arms above
    // would be satisfied by a build that had simply deleted the echo, and this
    // suite could not tell a gate from a deletion.
    const result = await queryUnderNodeEnv('development');
    expect(result.sql).toContain('SELECT');
    expect(result.sql).toContain('"sys_user"');
  });

  it('an explicit host choice outranks the environment, in both directions', async () => {
    const previous = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      const on = await nativeService({ debugSql: true }).svc.query(REPRO_QUERY);
      expect(on.sql).toContain('SELECT');

      process.env.NODE_ENV = 'development';
      const off = await nativeService({ debugSql: false }).svc.query(REPRO_QUERY);
      expect(off.sql, 'the echo must be absent, not half-rendered').toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// The other caller-facing face, and the one that is NOT gated
// ─────────────────────────────────────────────────────────────────

const usersDataset = DatasetSchema.parse({
  name: 'user_headcount',
  label: 'User headcount',
  object: 'sys_user',
  include: [],
  dimensions: [{ name: 'id', field: 'id', type: 'string' }],
  measures: [{ name: 'user_count', aggregate: 'count' }],
});

const DATASET_CTX = { tenantId: 'org_A' } as ExecutionContext;

function datasetService(debugSql: boolean | undefined) {
  return new AnalyticsService({
    logger: silentLogger,
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async () => [{ id: 'usr_1', user_count: 2 }],
    debugSql,
  });
}

describe('[#8286] queryDataset inherits the verdict — one gate, not two', () => {
  it('debug ON: the dataset response carries the echo', async () => {
    const result = await datasetService(true).queryDataset(
      usersDataset,
      { dimensions: ['id'], measures: ['user_count'] },
      DATASET_CTX,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.sql).toContain('SELECT');
  });

  it('debug OFF: the same dataset, the same rows — the echo is absent', async () => {
    const result = await datasetService(false).queryDataset(
      usersDataset,
      { dimensions: ['id'], measures: ['user_count'] },
      DATASET_CTX,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.sql, 'the echo must be absent, not half-rendered').toBeUndefined();
  });
});

describe('[#8286] the dry-run route keeps its echo — it IS the surface for it', () => {
  it('generateSql answers with the statement even with the echo gated off', async () => {
    // `/api/v1/analytics/sql` exists to hand back a statement; gating it would
    // not narrow an over-serving response, it would delete a declared route.
    // The debugging author is meant to come here, which is why the query face
    // can afford to say nothing.
    const { svc } = nativeService({ debugSql: false, readScope: MEMBER_SCOPE });

    const { sql } = await svc.generateSql(REPRO_QUERY);

    expect(sql).toContain('SELECT');
    expect(sql).toMatch(/"sys_user"\."id" IN \(/);
  });
});
