// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Temporal conformance for the in-memory driver (ADR-0053 D-A3).
 *
 * The cases come from `@objectstack/spec/data` so this backend, `driver-sql`,
 * `driver-mongodb`, the analytics preview and `formula`'s write-side `check`
 * evaluator are all held to one standard — see `temporal-conformance.ts` for
 * the four divergences that standard exists to prevent, one of which (#4047)
 * was this driver's.
 *
 * Rows are seeded in their tagged writer forms (ISO string vs JS `Date` — the
 * D-E4 mixed-writer axis), reproducing exactly the mixed column #4047 hit;
 * the sweep proves the converged storage answers every shared case. Cases
 * carrying a token spelling also run through `resolveFilterTokens` at the
 * pinned `TEMPORAL_NOW` — the D-A3 "token → row results" axis (#4081).
 *
 * The last two describes add the **storage-form axis** (#4191): rows that
 * entered the table BEFORE any schema was declared, in the raw pre-#4047
 * forms, and were therefore never touched by the write path. That is not a
 * hypothetical population here — it is precisely what D-E3 says this driver
 * has to converge:
 *
 * > `driver-memory` converges the rows already in a table when the schema
 * > arrives, which is what catches `initialData` fixtures and
 * > persistence-adapter restores (both land before any schema is declared).
 *
 * `initialData` is the named case and the one seeded here: `connect()` pushes
 * the fixtures straight into the table, `syncSchema` then runs the retroactive
 * pass. The claim under test is that the pass leaves the table answering the
 * SAME row-id sets as the canonical sweep — the in-memory analogue of the
 * `backfillCanonicalDatetimes` sweeps in `driver-sql`, and the half of D-E3
 * that had no coverage at all.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  TEMPORAL_CASES,
  TEMPORAL_NOW,
  TEMPORAL_ROWS,
  TEMPORAL_TIME_CASES,
  TEMPORAL_TIME_ROWS,
} from '@objectstack/spec/data';
import { resolveFilterTokens } from '@objectstack/core';
import { InMemoryDriver } from './memory-driver.js';

const resolveTokens = <T,>(filter: T): T =>
  resolveFilterTokens(filter, { now: new Date(TEMPORAL_NOW) });

/**
 * The pre-#4047 storage forms, per the shared axis's seeding basis: `native`
 * → the raw platform-native instant (a JS `Date`, what an SDK caller or this
 * driver's own timestamp defaults produced), `wire` → raw text the write path
 * never rewrote (the zone-naive `YYYY-MM-DD HH:MM:SS` a `CURRENT_TIMESTAMP`
 * default or a restored snapshot carries). Neither is this driver's canon —
 * canonical UTC ISO text for `datetime`, bare-day text for `date` (D-E2) — so
 * the fixture is genuinely un-converged on both halves rather than only one.
 */
const legacyRows = () =>
  TEMPORAL_ROWS.map((r) => ({
    id: r.id,
    at: r.writerForm === 'native' ? new Date(r.at) : r.at.replace('T', ' ').replace('Z', ''),
    on: r.writerForm === 'native' ? new Date(r.on) : r.on,
    why: r.why,
  }));

/**
 * The `Field.time` twin: `native` → a `Date` whose UTC time-of-day is the wall
 * clock (`a_midnight` becomes the epoch instant itself — the row whose
 * cross-type comparison hid it from every text bound), `wire` → a full
 * timestamp still carrying a calendar day, pinned to the fixture's boundary
 * day so every consumer of this axis seeds the same bytes.
 */
const legacyTimeRows = () =>
  TEMPORAL_TIME_ROWS.map((r) => ({
    id: r.id,
    at: r.writerForm === 'native' ? new Date(`1970-01-01T${r.at}Z`) : `2026-07-28T${r.at}Z`,
    why: r.why,
  }));

describe('driver-memory — temporal conformance', () => {
  let driver: InMemoryDriver;

  beforeAll(async () => {
    driver = new InMemoryDriver({});
    await driver.connect();
    // Declaring the object is what teaches this driver the field types (#4047);
    // without it the values would keep whatever form the writer produced.
    await driver.syncSchema('conformance', {
      name: 'conformance',
      fields: { at: { type: 'datetime' }, on: { type: 'date' }, why: { type: 'string' } },
    });
    for (const r of TEMPORAL_ROWS) {
      await driver.create('conformance', {
        id: r.id,
        // The mixed-writer axis (D-E4): both shapes must converge on write.
        at: r.writerForm === 'native' ? new Date(r.at) : r.at,
        on: r.on,
        why: r.why,
      });
    }
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

describe('driver-memory — Field.time conformance', () => {
  let driver: InMemoryDriver;

  beforeAll(async () => {
    driver = new InMemoryDriver({});
    await driver.connect();
    await driver.syncSchema('time_conformance', {
      name: 'time_conformance',
      fields: { at: { type: 'time' }, why: { type: 'string' } },
    });
    for (const r of TEMPORAL_TIME_ROWS) {
      await driver.create('time_conformance', {
        id: r.id,
        // The mixed-writer axis (D-E4) for wall clocks: a `Date` write and a
        // canonical-text write of the SAME wall clock must converge.
        at: r.writerForm === 'native' ? new Date(`1970-01-01T${r.at}Z`) : r.at,
        why: r.why,
      });
    }
  });

  for (const c of TEMPORAL_TIME_CASES) {
    it(c.name, async () => {
      const rows = await driver.find('time_conformance', { where: c.filter } as any);
      const got = (rows as any[]).map((r) => r.id).sort();
      expect(got, c.note).toEqual([...c.expected].sort());
    });
  }
});

describe('driver-memory — temporal conformance on rows that predate the schema (D-E3)', () => {
  let driver: InMemoryDriver;

  beforeAll(async () => {
    // `initialData` lands during connect(), BEFORE any schema is declared, so
    // nothing coerced these values — the population D-E3 promises to converge.
    driver = new InMemoryDriver({ initialData: { conformance: legacyRows() } });
    await driver.connect();
    // The retroactive pass runs here, on rows this driver never wrote.
    await driver.syncSchema('conformance', {
      name: 'conformance',
      fields: { at: { type: 'datetime' }, on: { type: 'date' }, why: { type: 'string' } },
    });
  });

  it('converged every pre-schema row to the storage canon (the premise, so the sweep cannot pass vacuously)', async () => {
    const rows = await driver.find('conformance', {} as any);
    expect(rows).toHaveLength(TEMPORAL_ROWS.length);
    for (const row of rows as any[]) {
      const expected = TEMPORAL_ROWS.find((r) => r.id === row.id)!;
      // Canonical UTC ISO text for `datetime`, bare-day text for `date`
      // (D-E2) — no `Date` object and no zone-naive spelling survives.
      expect(row.at, `${row.id}.at`).toBe(expected.at);
      expect(row.on, `${row.id}.on`).toBe(expected.on);
    }
  });

  // Literal spellings only: the token axis is orthogonal to storage form and
  // already swept above — a divergence here is a convergence bug by construction.
  for (const c of TEMPORAL_CASES) {
    it(c.name, async () => {
      const rows = await driver.find('conformance', { where: c.filter } as any);
      const got = (rows as any[]).map((r) => r.id).sort();
      expect(got, c.note).toEqual([...c.expected].sort());
    });
  }
});

describe('driver-memory — Field.time conformance on rows that predate the schema (D-E3)', () => {
  let driver: InMemoryDriver;

  beforeAll(async () => {
    driver = new InMemoryDriver({ initialData: { time_conformance: legacyTimeRows() } });
    await driver.connect();
    await driver.syncSchema('time_conformance', {
      name: 'time_conformance',
      fields: { at: { type: 'time' }, why: { type: 'string' } },
    });
  });

  it('converged every pre-schema wall clock to the storage canon (the premise)', async () => {
    const rows = await driver.find('time_conformance', {} as any);
    expect(rows).toHaveLength(TEMPORAL_TIME_ROWS.length);
    for (const row of rows as any[]) {
      const expected = TEMPORAL_TIME_ROWS.find((r) => r.id === row.id)!;
      expect(row.at, `${row.id}.at`).toBe(expected.at);
    }
  });

  for (const c of TEMPORAL_TIME_CASES) {
    it(c.name, async () => {
      const rows = await driver.find('time_conformance', { where: c.filter } as any);
      const got = (rows as any[]).map((r) => r.id).sort();
      expect(got, c.note).toEqual([...c.expected].sort());
    });
  }
});
