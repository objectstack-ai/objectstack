// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Temporal conformance for TursoDriver (ADR-0053 D-A3, framework#4081 /
 * framework#4191).
 *
 * `TursoDriver extends SqlDriver`, so in LOCAL (and replica — same local
 * engine) mode the whole temporal seam is inherited, not re-implemented:
 * canonical datetime storage (framework#3912), the `Field.time` convention
 * (framework#3994), the calendar-day bound rewrites (framework#3777), the
 * comparand coercion, and the read-repair for un-backfilled legacy rows. This
 * suite runs the shared `@objectstack/spec/data` matrix against the real
 * local engine so it fails if this driver ever stops sharing that seam — the
 * same consumer `driver-sqlite-wasm` keeps on the framework side, for the
 * same inheritance reason.
 *
 * Four sweeps, mirroring the framework's `driver-sql` consumer:
 *   1. canonical `datetime`/`date` — rows seeded through `create()` in their
 *      tagged writer forms (D-E4 mixed-writer axis), plus the same cases
 *      spelled in relative tokens resolved at the pinned `TEMPORAL_NOW`;
 *   2. canonical `Field.time`;
 *   3. legacy `datetime` storage — rows injected RAW below the write path in
 *      the pre-framework#3912 forms (INTEGER epoch ms / zone-naive TEXT) with
 *      the known-canonical marker cleared, so the read-repair answers the
 *      same table (the storage-form axis, framework#4191);
 *   4. legacy `Field.time` storage — the pre-framework#3994 forms (INTEGER
 *      epoch ms / full-timestamp TEXT), same rule.
 *
 * The legacy sweeps matter MORE here than for an ordinary embedded SQLite:
 * a Turso deployment's data lives in the cloud and is exactly the kind of
 * long-lived database whose backfill may never have run (D-B3 lets it fail
 * without taking boot down) — correctness must not be contingent on it.
 *
 * REMOTE mode gets the same matrix, in `turso-remote-temporal-conformance.
 * test.ts` — it used to be excluded here because `RemoteTransport` compiles
 * filters itself and failed every window (#937); since that transport routes
 * its payloads and comparands through the driver's seam, the two modes are
 * held to one table, which is the whole point of the axis.
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
import { TursoDriver } from './turso-driver.js';

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

const TIME_CONFORMANCE_OBJECT = {
  name: 'time_conformance',
  fields: { at: { type: 'time' }, why: { type: 'string' } },
};

/**
 * The Turso twin of driver-sql's `LegacyStorageDriver` testkit (deliberately
 * unexported there — test-only): insert rows bypassing `formatInput` so each
 * temporal value lands in the raw pre-convention form it is given, then clear
 * the column's known-canonical marker so the read paths apply their repair —
 * the state of an un-migrated (or backfill-failed, D-B3) database.
 */
class LegacyStorageTursoDriver extends TursoDriver {
  async seedLegacyRows(table: string, field: string, rows: Array<Record<string, unknown>>): Promise<void> {
    await this.knex(table).insert(rows);
    this.canonicalDatetimeFields[table]?.delete(field);
  }

  async seedLegacyTimeRows(table: string, field: string, rows: Array<Record<string, unknown>>): Promise<void> {
    await this.knex(table).insert(rows);
    this.canonicalTimeFields[table]?.delete(field);
  }

  /** Raw stored form of a column, for asserting the fixture's premise. */
  async storedForms(table: string, field: string): Promise<Array<{ id: string; type: string }>> {
    const res: any = await this.knex.raw(`select id, typeof(??) as t from ?? order by id`, [field, table]);
    const rows = Array.isArray(res) ? res : (res?.rows ?? []);
    return rows.map((r: any) => ({ id: r.id, type: r.t }));
  }
}

describe('TursoDriver — temporal conformance (local mode)', () => {
  let driver: TursoDriver;

  beforeAll(async () => {
    driver = new TursoDriver({ url: ':memory:' });
    // Local mode is the SqlDriver-inherited engine — the mode this suite is
    // about. Replica shares it; remote does not (see module doc).
    expect(driver.transportMode).toBe('local');
    await driver.initObjects([CONFORMANCE_OBJECT]);
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
    await driver.disconnect();
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

describe('TursoDriver — Field.time conformance (local mode)', () => {
  let driver: TursoDriver;

  beforeAll(async () => {
    driver = new TursoDriver({ url: ':memory:' });
    await driver.initObjects([TIME_CONFORMANCE_OBJECT]);
    for (const r of TEMPORAL_TIME_ROWS) {
      await driver.create(
        'time_conformance',
        {
          id: r.id,
          // The mixed-writer axis for wall clocks (framework#3994 measured
          // this exact column): a bound `Date` and canonical text converge.
          at: r.writerForm === 'native' ? new Date(`1970-01-01T${r.at}Z`) : r.at,
          why: r.why,
        },
        { bypassTenantAudit: true },
      );
    }
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  for (const c of TEMPORAL_TIME_CASES) {
    it(c.name, async () => {
      const rows = await driver.find('time_conformance', { where: c.filter });
      const got = (rows as any[]).map((r) => r.id).sort();
      expect(got, c.note).toEqual([...c.expected].sort());
    });
  }
});

describe('TursoDriver — temporal conformance on un-backfilled legacy storage', () => {
  let driver: LegacyStorageTursoDriver;

  beforeAll(async () => {
    driver = new LegacyStorageTursoDriver({ url: ':memory:' });
    await driver.initObjects([CONFORMANCE_OBJECT]);
    // The two pre-framework#3912 storage forms, split by the writer-form tag
    // (the storage-form axis): `native` writes landed as INTEGER epoch ms,
    // `wire` writes as zone-naive TEXT. The inherited read-repair must answer
    // the same table the canonical sweep does.
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
    await driver.disconnect();
  });

  it('holds the mixed legacy forms it claims to (the premise, so the sweep cannot pass vacuously)', async () => {
    const forms = await driver.storedForms('conformance', 'at');
    const byId = Object.fromEntries(forms.map((f) => [f.id, f.type]));
    for (const r of TEMPORAL_ROWS) {
      expect(byId[r.id], r.id).toBe(r.writerForm === 'native' ? 'integer' : 'text');
    }
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

describe('TursoDriver — Field.time conformance on un-backfilled legacy storage', () => {
  let driver: LegacyStorageTursoDriver;

  beforeAll(async () => {
    driver = new LegacyStorageTursoDriver({ url: ':memory:' });
    await driver.initObjects([TIME_CONFORMANCE_OBJECT]);
    // The pre-framework#3994 forms (framework#4191): `native` → INTEGER epoch
    // ms of the wall clock on the epoch day (a_midnight = the measured
    // hazard, INTEGER 0, which sorts before every TEXT row), `wire` →
    // full-timestamp TEXT pinned to the fixture's boundary day so every
    // consumer of this axis seeds the same bytes.
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
    await driver.disconnect();
  });

  it('holds the mixed legacy forms it claims to (the premise, so the sweep cannot pass vacuously)', async () => {
    const forms = await driver.storedForms('time_conformance', 'at');
    const byId = Object.fromEntries(forms.map((f) => [f.id, f.type]));
    for (const r of TEMPORAL_TIME_ROWS) {
      expect(byId[r.id], r.id).toBe(r.writerForm === 'native' ? 'integer' : 'text');
    }
  });

  for (const c of TEMPORAL_TIME_CASES) {
    it(c.name, async () => {
      const rows = await driver.find('time_conformance', { where: c.filter });
      const got = (rows as any[]).map((r) => r.id).sort();
      expect(got, c.note).toEqual([...c.expected].sort());
    });
  }
});
