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
 * Four sweeps, because this driver owns two extra axes (#4081):
 *   1. canonical storage — rows seeded through `create()` in their tagged
 *      writer forms (ISO string vs JS `Date`, the D-E4 mixed-writer axis),
 *      which `formatInput` must converge;
 *   2. the same cases spelled in relative tokens, resolved through
 *      `@objectstack/core`'s `resolveFilterTokens` at the pinned `TEMPORAL_NOW`
 *      — the D-A3 "token → row results" axis;
 *   3. legacy storage — the same rows seeded RAW as pre-#3912 forms (INTEGER
 *      epoch ms / zone-naive TEXT) with the canonical marker cleared, so the
 *      read-repair path answers the same table;
 *   4. the same for `Field.time` (#4191) — the pre-#3994 forms (INTEGER epoch
 *      ms / full-timestamp TEXT), so the repair path that closed #3994 has a
 *      regression lock of its own instead of riding the datetime sweep's.
 *
 * Runs against a real SQLite, and — through the `Temporal Conformance
 * (live PG + MySQL)` CI job, which runs this package's whole suite under
 * `TZ=America/New_York` against servers on `Asia/Shanghai` — against real
 * Postgres and MySQL too, with no workflow change needed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  TEMPORAL_CASES,
  TEMPORAL_NOW,
  TEMPORAL_ROWS,
  TEMPORAL_TIME_CASES,
  TEMPORAL_TIME_ROWS,
} from '@objectstack/spec/data';
import { resolveFilterTokens } from '@objectstack/core';
import { SqlDriver } from '../src/index.js';
import { LegacyStorageDriver } from './legacy-datetime-storage.testkit.js';

const resolveTokens = <T,>(filter: T): T =>
  resolveFilterTokens(filter, { now: new Date(TEMPORAL_NOW) });

const CONFORMANCE_OBJECT = {
  name: 'conformance',
  fields: {
    at: { type: 'datetime' },
    on: { type: 'date' },
    why: { type: 'string' },
  },
};

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
    await driver.initObjects([CONFORMANCE_OBJECT]);
    for (const r of TEMPORAL_ROWS) {
      await driver.create(
        'conformance',
        {
          id: r.id,
          // The writer-form axis (D-E4): both writer populations must
          // converge to the one canonical storage form on write.
          at: r.writerForm === 'native' ? new Date(r.at) : r.at,
          on: r.on,
          why: r.why,
        },
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

    if (c.tokenFilter) {
      it(`${c.name} — via relative tokens`, async () => {
        const rows = await driver.find('conformance', { where: resolveTokens(c.tokenFilter) } as any);
        const got = (rows as any[]).map((r) => r.id).sort();
        expect(got, c.note).toEqual([...c.expected].sort());
      });
    }
  }
});

describe('sql-driver — temporal conformance on un-backfilled legacy storage', () => {
  let driver: LegacyStorageDriver;

  beforeAll(async () => {
    driver = new LegacyStorageDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([CONFORMANCE_OBJECT]);
    // The two pre-#3912 storage forms, split by the same writer-form tag:
    // `native` writes landed as INTEGER epoch ms (a bound JS Date), `wire`
    // writes as zone-naive TEXT (CURRENT_TIMESTAMP / REST payloads). One
    // column, both forms — the read-repair path must answer the same table
    // the canonical sweep does. (`on` is unaffected: bare-day text has been
    // the date canon since Phase 1.)
    await driver.seedLegacyRows(
      'conformance',
      'at',
      TEMPORAL_ROWS.map((r) => ({
        id: r.id,
        at: r.writerForm === 'native' ? Date.parse(r.at) : r.at.replace('T', ' ').replace('Z', ''),
        on: r.on,
        why: r.why,
      })),
    );
  });

  afterAll(async () => {
    await driver.disconnect?.();
  });

  // Literal spellings only: the token axis is orthogonal to storage form and
  // already swept above — a divergence here is a repair-path bug by construction.
  for (const c of TEMPORAL_CASES) {
    it(c.name, async () => {
      const rows = await driver.find('conformance', { where: c.filter } as any);
      const got = (rows as any[]).map((r) => r.id).sort();
      expect(got, c.note).toEqual([...c.expected].sort());
    });
  }
});

describe('sql-driver — Field.time conformance', () => {
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([
      { name: 'time_conformance', fields: { at: { type: 'time' }, why: { type: 'string' } } },
    ]);
    for (const r of TEMPORAL_TIME_ROWS) {
      await driver.create(
        'time_conformance',
        {
          id: r.id,
          // The mixed-writer axis for wall clocks (#3994 measured this exact
          // column): a bound `Date` and a canonical-text write must converge.
          at: r.writerForm === 'native' ? new Date(`1970-01-01T${r.at}Z`) : r.at,
          why: r.why,
        },
        { bypassTenantAudit: true } as any,
      );
    }
  });

  afterAll(async () => {
    await driver.disconnect?.();
  });

  for (const c of TEMPORAL_TIME_CASES) {
    it(c.name, async () => {
      const rows = await driver.find('time_conformance', { where: c.filter } as any);
      const got = (rows as any[]).map((r) => r.id).sort();
      expect(got, c.note).toEqual([...c.expected].sort());
    });
  }
});

describe('sql-driver — Field.time conformance on un-backfilled legacy storage', () => {
  let driver: LegacyStorageDriver;

  beforeAll(async () => {
    driver = new LegacyStorageDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([
      { name: 'time_conformance', fields: { at: { type: 'time' }, why: { type: 'string' } } },
    ]);
    // The two pre-#3994 storage forms, split by the same writer-form tag
    // (the storage-form axis, #4191): `native` writes landed as INTEGER epoch
    // ms of the wall clock on the epoch day — `a_midnight` is the measured
    // hazard, INTEGER 0, which sorts before every TEXT row — and `wire`
    // writes as full-timestamp TEXT still carrying a calendar day (pinned to
    // the fixture's boundary day so every consumer seeds the same bytes).
    // The read-repair path (`sqliteCanonicalTimeSql`) must answer the same
    // table the canonical sweep does.
    await driver.seedLegacyTimeRows(
      'time_conformance',
      'at',
      TEMPORAL_TIME_ROWS.map((r) => ({
        id: r.id,
        at: r.writerForm === 'native' ? Date.parse(`1970-01-01T${r.at}Z`) : `2026-07-28T${r.at}Z`,
        why: r.why,
      })),
    );
  });

  afterAll(async () => {
    await driver.disconnect?.();
  });

  for (const c of TEMPORAL_TIME_CASES) {
    it(c.name, async () => {
      const rows = await driver.find('time_conformance', { where: c.filter } as any);
      const got = (rows as any[]).map((r) => r.id).sort();
      expect(got, c.note).toEqual([...c.expected].sort());
    });
  }
});
