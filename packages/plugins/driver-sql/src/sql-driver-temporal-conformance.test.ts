// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Temporal conformance for the SQL filter compiler (ADR-0053 D-A3).
 *
 * The cases come from `@objectstack/spec/data`, so this backend, the in-memory
 * and document drivers, the analytics preview and `formula`'s write-side
 * `check` evaluator are all held to one standard — see `temporal-conformance.ts`
 * for the four divergences that standard exists to prevent. Adding a case there
 * adds it here.
 *
 * This is the TYPED half of the matrix: the columns are declared through
 * `initObjects`, so the driver knows `at` is a `Field.datetime` and `on` a
 * `Field.date` and coerces comparands accordingly. That the same case yields the
 * same row set here and in the type-blind backends is the whole assertion.
 *
 * Runs against a real SQLite, and — through the `Temporal Conformance
 * (live PG + MySQL)` CI job, which runs this package's whole suite under
 * `TZ=America/New_York` against servers on `Asia/Shanghai` — against real
 * Postgres and MySQL too, with no workflow change needed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TEMPORAL_CASES, TEMPORAL_ROWS, TEMPORAL_TOKEN_CASES } from '@objectstack/spec/data';
import { resolveFilterTokens } from '@objectstack/core';
import { SqlDriver } from '../src/index.js';

describe('sql-driver — temporal conformance', () => {
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    // The declaration is what makes this the typed half — `at` is an instant,
    // `on` a calendar day, and the driver's coercion follows from that.
    await driver.initObjects([
      {
        name: 'conformance',
        fields: {
          at: { type: 'datetime' },
          on: { type: 'date' },
          why: { type: 'string' },
        },
      },
    ]);
    for (const r of TEMPORAL_ROWS) {
      await driver.create(
        'conformance',
        { id: r.id, at: r.at, on: r.on, why: r.why },
        { bypassTenantAudit: true } as any,
      );
    }
  });

  afterAll(async () => {
    await driver.disconnect?.();
  });

  for (const c of TEMPORAL_CASES) {
    it(c.name, async () => {
      const rows = await driver.find('conformance', { where: c.filter } as any);
      const got = (rows as any[]).map((r) => r.id).sort();
      expect(got, c.note).toEqual([...c.expected].sort());
    });
  }
});

/**
 * The relative-token axis: the same rows, but the filter still carries
 * `{today}` / `{current_month_end}` when the case starts. Resolution is the
 * ObjectQL engine's job (`engine.ts` resolves `ast.where` before the driver is
 * called), so the suite performs it the same way, with the case's pinned
 * instant, and then hands the driver exactly what the engine would.
 *
 * This asserts the composition the resolved-comparand cases cannot: that a
 * token resolving correctly and a bare day meaning the whole day add up to the
 * right rows for the filter an author actually wrote.
 */
describe('sql-driver — temporal conformance (relative tokens)', () => {
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([
      {
        name: 'conformance',
        fields: { at: { type: 'datetime' }, on: { type: 'date' }, why: { type: 'string' } },
      },
    ]);
    for (const r of TEMPORAL_ROWS) {
      await driver.create(
        'conformance',
        { id: r.id, at: r.at, on: r.on, why: r.why },
        { bypassTenantAudit: true } as any,
      );
    }
  });

  afterAll(async () => {
    await driver.disconnect?.();
  });

  for (const c of TEMPORAL_TOKEN_CASES) {
    it(c.name, async () => {
      const where = resolveFilterTokens(c.filter, { now: new Date(c.now) });
      const rows = await driver.find('conformance', { where } as any);
      const got = (rows as any[]).map((r) => r.id).sort();
      expect(got, c.note).toEqual([...c.expected].sort());
    });
  }
});
