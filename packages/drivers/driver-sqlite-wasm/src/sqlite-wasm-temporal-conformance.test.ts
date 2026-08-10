// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Temporal conformance for the wasm driver (ADR-0053 D-A3, #4081).
 *
 * `SqliteWasmDriver extends SqlDriver`, so the whole temporal seam — canonical
 * datetime storage (#3912), the calendar-day bound rewrites (#3777/#4042), the
 * comparand coercion — is inherited, not re-implemented. This runs the shared
 * `@objectstack/spec/data` table against the wasm engine so the suite fails if
 * this driver ever stops sharing that seam — the same guard the #3773/#3777
 * pin tests established one case at a time, now spanning the full matrix,
 * token spellings included.
 *
 * The legacy-storage sweeps (#4191) pin the OTHER inherited half: the
 * read-repair path for rows written before the storage conventions existed
 * (#3912 for `Field.datetime`, #3994 for `Field.time`) and never backfilled.
 * Inheritance makes it easy to assume this half comes along for free — which
 * is exactly why it gets its own describes: a wasm-side override of the knex
 * seam that dropped the repair expression would fail HERE and nowhere else.
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
import { SqliteWasmDriver } from './index.js';

const resolveTokens = <T,>(filter: T): T =>
  resolveFilterTokens(filter, { now: new Date(TEMPORAL_NOW) });

/**
 * The wasm twin of driver-sql's `LegacyStorageDriver` testkit (deliberately
 * unexported there — test-only): insert rows bypassing `formatInput` so each
 * temporal value lands in the raw pre-convention form it is given, then clear
 * the column's known-canonical marker so the read paths apply their repair —
 * the state of an un-migrated (or backfill-failed, D-B3) database.
 */
class LegacyStorageWasmDriver extends SqliteWasmDriver {
  async seedLegacyRows(table: string, field: string, rows: Array<Record<string, unknown>>): Promise<void> {
    await this.knex(table).insert(rows);
    this.canonicalDatetimeFields[table]?.delete(field);
  }

  async seedLegacyTimeRows(table: string, field: string, rows: Array<Record<string, unknown>>): Promise<void> {
    await this.knex(table).insert(rows);
    this.canonicalTimeFields[table]?.delete(field);
  }

  async destroy(): Promise<void> {
    await this.knex.destroy();
  }
}

describe('driver-sqlite-wasm — temporal conformance', () => {
  let driver: SqliteWasmDriver;

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([
      {
        name: 'conformance',
        fields: { at: { type: 'datetime' }, on: { type: 'date' }, why: { type: 'string' } },
      },
    ]);
    for (const r of TEMPORAL_ROWS) {
      await driver.create(
        'conformance',
        {
          id: r.id,
          // The mixed-writer axis (D-E4): both shapes must converge on write.
          at: r.writerForm === 'native' ? new Date(r.at) : r.at,
          on: r.on,
          why: r.why,
        },
        { bypassTenantAudit: true },
      );
    }
  });

  afterAll(async () => {
    await (driver as any).knex.destroy();
  });

  for (const c of TEMPORAL_CASES) {
    it(c.name, async () => {
      const rows = await driver.find('conformance', { where: c.filter });
      const got = (rows as any[]).map((r) => r.id).sort();
      expect(got, c.note).toEqual([...c.expected].sort());
    });

    if (c.tokenFilter) {
      it(`${c.name} — via relative tokens`, async () => {
        const rows = await driver.find('conformance', { where: resolveTokens(c.tokenFilter) });
        const got = (rows as any[]).map((r) => r.id).sort();
        expect(got, c.note).toEqual([...c.expected].sort());
      });
    }
  }
});

describe('driver-sqlite-wasm — Field.time conformance', () => {
  let driver: SqliteWasmDriver;

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
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
        { bypassTenantAudit: true },
      );
    }
  });

  afterAll(async () => {
    await (driver as any).knex.destroy();
  });

  for (const c of TEMPORAL_TIME_CASES) {
    it(c.name, async () => {
      const rows = await driver.find('time_conformance', { where: c.filter });
      const got = (rows as any[]).map((r) => r.id).sort();
      expect(got, c.note).toEqual([...c.expected].sort());
    });
  }
});

describe('driver-sqlite-wasm — temporal conformance on un-backfilled legacy storage', () => {
  let driver: LegacyStorageWasmDriver;

  beforeAll(async () => {
    driver = new LegacyStorageWasmDriver({ filename: ':memory:' });
    await driver.initObjects([
      {
        name: 'conformance',
        fields: { at: { type: 'datetime' }, on: { type: 'date' }, why: { type: 'string' } },
      },
    ]);
    // The two pre-#3912 storage forms, split by the writer-form tag (the
    // storage-form axis): `native` writes landed as INTEGER epoch ms, `wire`
    // writes as zone-naive TEXT. The inherited read-repair must answer the
    // same table the canonical sweep does.
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
    await driver.destroy();
  });

  // Literal spellings only: the token axis is orthogonal to storage form and
  // already swept above — a divergence here is a repair-path bug by construction.
  for (const c of TEMPORAL_CASES) {
    it(c.name, async () => {
      const rows = await driver.find('conformance', { where: c.filter });
      const got = (rows as any[]).map((r) => r.id).sort();
      expect(got, c.note).toEqual([...c.expected].sort());
    });
  }
});

describe('driver-sqlite-wasm — Field.time conformance on un-backfilled legacy storage', () => {
  let driver: LegacyStorageWasmDriver;

  beforeAll(async () => {
    driver = new LegacyStorageWasmDriver({ filename: ':memory:' });
    await driver.initObjects([
      { name: 'time_conformance', fields: { at: { type: 'time' }, why: { type: 'string' } } },
    ]);
    // The pre-#3994 forms (#4191): `native` → INTEGER epoch ms of the wall
    // clock on the epoch day (a_midnight = the measured hazard, INTEGER 0),
    // `wire` → full-timestamp TEXT pinned to the fixture's boundary day.
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
    await driver.destroy();
  });

  for (const c of TEMPORAL_TIME_CASES) {
    it(c.name, async () => {
      const rows = await driver.find('time_conformance', { where: c.filter });
      const got = (rows as any[]).map((r) => r.id).sort();
      expect(got, c.note).toEqual([...c.expected].sort());
    });
  }
});
