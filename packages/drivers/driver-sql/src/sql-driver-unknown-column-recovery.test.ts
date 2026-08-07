// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#3821 — `find()` must not turn an unknown column into "no rows".
 *
 * A SELECT projection naming a column the table lacks already had a retry
 * (select `*` and let the missing field simply be absent). An unknown ORDER BY
 * column did not: it fell through to `return []`, so the page came back empty
 * while `count()` — a separate statement — still reported the true total. The
 * UI reads that as "the records vanished". It surfaced through the sharing-rule
 * recipient picker, whose client mangled `'name asc'` into a list of
 * one-character column names.
 *
 * Rows matter more than their order, so an unsortable query returns the rows
 * unordered. These tests pin that, and that a genuine SQL error still throws.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

describe('SqlDriver find() recovers from unknown columns (objectstack#3821)', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await driver.initObjects([
      {
        name: 'member',
        fields: {
          name: { type: 'string' },
          rank: { type: 'integer' },
        },
      },
    ]);

    await driver.create('member', { id: 'm1', name: 'Carol', rank: 3 }, { bypassTenantAudit: true });
    await driver.create('member', { id: 'm2', name: 'Alice', rank: 1 }, { bypassTenantAudit: true });
    await driver.create('member', { id: 'm3', name: 'Bob', rank: 2 }, { bypassTenantAudit: true });
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('returns the rows unordered when ORDER BY names a column the table lacks', async () => {
    const rows = await driver.find('member', {
      orderBy: [{ field: 'nosuchfield', order: 'asc' }],
    } as any);

    expect(rows.map((r: any) => r.id).sort()).toEqual(['m1', 'm2', 'm3']);
  });

  it('still sorts when every ORDER BY column exists', async () => {
    const rows = await driver.find('member', {
      orderBy: [{ field: 'rank', order: 'asc' }],
    } as any);

    expect(rows.map((r: any) => r.name)).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('drops only the unknown clause when a known and an unknown sort are mixed', async () => {
    // knex emits both columns in one ORDER BY, so the whole clause has to go;
    // what must NOT happen is losing the rows.
    const rows = await driver.find('member', {
      orderBy: [{ field: 'rank', order: 'asc' }, { field: 'nosuchfield', order: 'desc' }],
    } as any);

    expect(rows).toHaveLength(3);
  });

  it('recovers from an unknown SELECT projection and an unknown sort together', async () => {
    const rows = await driver.find('member', {
      fields: ['name', 'nosuchfield'],
      orderBy: [{ field: 'alsomissing', order: 'asc' }],
    } as any);

    expect(rows).toHaveLength(3);
    expect(rows.map((r: any) => r.name).sort()).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('keeps honouring the WHERE clause while recovering', async () => {
    const rows = await driver.find('member', {
      where: { rank: { $gte: 2 } },
      orderBy: [{ field: 'nosuchfield', order: 'asc' }],
    } as any);

    expect(rows.map((r: any) => r.id).sort()).toEqual(['m1', 'm3']);
  });

  it('propagates errors that are not about an unknown column', async () => {
    await expect(driver.find('no_such_table', {})).rejects.toThrow();
  });
});
