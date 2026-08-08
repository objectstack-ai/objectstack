// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6468 — the engine's fallback seeding and the SQL driver's sequence bootstrap
 * must agree on the counter hiding in a stored record number.
 *
 * `renderAutonumber` composes `prefix + zero-padded(seq) + suffix`, so a format
 * with tokens after the `{0..0}` slot (`{000}-{YYYY}` → `001-2026`) does not end
 * in its counter. Both seeding paths used to assume it did, and each got it
 * wrong its own way over rows numbered 1..3:
 *
 *   - the engine took the LAST digit run — the year — and seeded `2026`, so the
 *     next number was `2027-2026`;
 *   - the SQL driver concatenated every digit of the tail and seeded `12026`, so
 *     the next number was `12027-2026`.
 *
 * Two different wrong answers for ONE dataset: the band a tenant received
 * depended on which driver happened to be running, and numbers burned that way
 * are not reclaimable. Fixing one side alone would have turned that into "one
 * right, one wrong" — still cross-driver inconsistency, and harder to spot.
 *
 * These cases are the convergence assertion itself: one format, one set of
 * stored rows, both real implementations, `toBe(sqlValue)` on the engine's
 * answer. `packages/objectql` and `packages/drivers/driver-sql` each pin their
 * own half; only this package can see both at once.
 *
 * The engine half runs on the REAL `InMemoryDriver` (`supports = {}`, so the
 * engine's fallback owns the counter — the shape memory/mongo deployments run)
 * and the driver half on a REAL `SqlDriver` over better-sqlite3, each holding
 * the same fixture rows.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { InMemoryDriver } from '@objectstack/driver-memory';
import { SqlDriver } from '@objectstack/driver-sql';

/** Date tokens render from the wall clock, so the clock is pinned. Only `Date`. */
const FIXED_NOW = new Date('2026-06-15T09:00:00Z');

/** One object, one text field, one autonumber field carrying `format`. */
function recSchema(format: string) {
  return {
    name: 'rec',
    fields: {
      title: { type: 'text' },
      rec_no: { type: 'autonumber', format },
    },
  } as any;
}

const legacyRows = (stored: string[]) =>
  stored.map((v, i) => ({ id: `l${i + 1}`, rec_no: v, title: `legacy ${i + 1}` }));

/** The number the ENGINE's fallback seeding issues after `stored`. */
async function engineIssues(format: string, stored: string[]): Promise<string> {
  const driver = new InMemoryDriver();
  const engine = new ObjectQL();
  engine.registerDriver(driver as any, true);
  await engine.init();
  engine.registry.registerObject(recSchema(format));
  // Land the pre-existing numbers straight in the store: going through the
  // engine would strip the caller-supplied autonumber values (#5503).
  for (const row of legacyRows(stored)) await driver.create('rec', row);

  const created = await engine.insert('rec', { title: 'next' });
  await engine.destroy();
  return created.rec_no;
}

/** The number the SQL DRIVER's sequence bootstrap issues after `stored`. */
async function sqlDriverIssues(format: string, stored: string[]): Promise<string> {
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await driver.initObjects([recSchema(format)]);
  await (driver as any).knex('rec').insert(legacyRows(stored));

  const created = await driver.create('rec', { title: 'next' });
  await driver.disconnect();
  return created.rec_no;
}

interface Fixture {
  label: string;
  format: string;
  stored: string[];
  /** The counter both sides must reach, rendered through the same format. */
  expected: string;
  /** What each side issued before the fix — asserted absent, per side. */
  wasEngine?: string;
  wasDriver?: string;
}

const FIXTURES: Fixture[] = [
  {
    label: '`{000}-{YYYY}` — the counter leads, the year trails',
    format: '{000}-{YYYY}',
    stored: ['001-2026', '002-2026', '003-2026'],
    expected: '004-2026',
    wasEngine: '2027-2026',
    wasDriver: '12027-2026',
  },
  {
    label: '`CASE-{000}-{YYYY}` — text on both sides of the slot',
    format: 'CASE-{000}-{YYYY}',
    stored: ['CASE-001-2026', 'CASE-002-2026', 'CASE-003-2026'],
    expected: 'CASE-004-2026',
    // The engine already read this one correctly (a non-empty prefix anchored
    // it); the driver still concatenated the tail into 12026.
    wasDriver: 'CASE-12027-2026',
  },
  {
    label: '`D-{0000}` — no suffix (control: both sides were already right)',
    format: 'D-{0000}',
    stored: ['D-0001', 'D-0002', 'D-0003'],
    expected: 'D-0004',
  },
  {
    label: '`{0000}` — bare slot (control: both sides were already right)',
    format: '{0000}',
    stored: ['0001', '0002', '0003'],
    expected: '0004',
  },
];

describe('autonumber seeding parity — engine fallback vs SQL driver (#6468)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  for (const f of FIXTURES) {
    it(`${f.label}: both sides issue ${f.expected}`, async () => {
      const engineValue = await engineIssues(f.format, f.stored);
      const sqlValue = await sqlDriverIssues(f.format, f.stored);

      // The convergence itself — one dataset, one answer, whichever driver runs.
      expect(engineValue).toBe(sqlValue);
      expect(engineValue).toBe(f.expected);
      if (f.wasEngine) expect(engineValue).not.toBe(f.wasEngine);
      if (f.wasDriver) expect(sqlValue).not.toBe(f.wasDriver);
    });
  }

  it('rows carrying an older rendered suffix belong to the same counter on both sides', async () => {
    // `{000}-{YYYY}` scopes its counter to the rendered PREFIX, which is '' —
    // one counter, only the displayed year moves. Last year's `007-2025` holds
    // counter 7, so both sides must continue at 8. A side that required the
    // suffix to match would restart at 4 and re-issue numbers already stored.
    const stored = ['005-2025', '006-2025', '007-2025', '003-2026'];

    const engineValue = await engineIssues('{000}-{YYYY}', stored);
    const sqlValue = await sqlDriverIssues('{000}-{YYYY}', stored);

    expect(engineValue).toBe(sqlValue);
    expect(engineValue).toBe('008-2026');
  });
});
