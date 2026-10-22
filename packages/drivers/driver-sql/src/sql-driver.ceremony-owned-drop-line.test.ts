// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqlDriver } from './sql-driver.js';

/**
 * [ADR-0131 D10 item 5] The boot's `[schema-drift]` line for an orphaned
 * `organization_id` column.
 *
 * On a database the organization-ownership ceremony has not certified, that
 * drop is the ceremony's: `os migrate apply --allow-destructive` refuses the
 * run, so a line prescribing it sends the operator to a refused command. The
 * boot asks the driver's own reader ({@link SqlDriver.isTenantKeyCertified},
 * the engine-handed resolver) and, on "not certified", names the ceremony in
 * the place of that sentence. A certified database, every other column and
 * every other drift kind print exactly the message the differ wrote.
 */

const TABLE = 'biz_unit';
const ORPHAN_ORG = `${TABLE}.organization_id: column exists in the database but not in metadata (orphaned)`;
const ALLOW_DESTRUCTIVE_DROP = ' — "os migrate apply --allow-destructive" to drop it.';

let driver: SqlDriver | undefined;

afterEach(async () => {
  await driver?.disconnect();
  driver = undefined;
});

/** A 17.x-shaped table: `organization_id` and `legacy_code` declared by nothing, `name` nullable under a declared NOT NULL. */
async function bootOn(resolver?: () => boolean): Promise<{ lines: string[]; asked: () => number }> {
  driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  const warn = vi.fn();
  (driver as any).logger = { warn, info: vi.fn() };
  let asked = 0;
  if (resolver) {
    driver.setTenantKeyCertifiedResolver(() => {
      asked++;
      return resolver();
    });
  }
  await (driver as any).knex.schema.createTable(TABLE, (t: any) => {
    t.string('id').primary();
    t.string('name');
    t.string('organization_id');
    t.string('legacy_code');
  });
  await driver.initObjects([
    { name: TABLE, fields: { name: { type: 'string', required: true, storage: { notNull: true } } } },
  ]);
  const lines = warn.mock.calls.map((c: any[]) => String(c[0])).filter((l) => l.startsWith('[schema-drift] '));
  return { lines, asked: () => asked };
}

const lineFor = (lines: string[], prefix: string): string => {
  const found = lines.filter((l) => l.startsWith(`[schema-drift] ${prefix}`));
  expect(found, lines.join('\n')).toHaveLength(1);
  return found[0]!;
};

describe('the boot drift line for an orphaned organization_id column', () => {
  it('not certified: names the ceremony, never --allow-destructive', async () => {
    const { lines, asked } = await bootOn(() => false);
    const line = lineFor(lines, ORPHAN_ORG);
    expect(line.startsWith(`[schema-drift] ${ORPHAN_ORG} — `)).toBe(true);
    expect(line).toContain('"os migrate organization-ownership"');
    expect(line).not.toContain('--allow-destructive');
    expect(asked()).toBe(1);
  });

  it('no resolver handed over reads as not certified: the same line', async () => {
    const { lines } = await bootOn();
    const line = lineFor(lines, ORPHAN_ORG);
    expect(line).toContain('"os migrate organization-ownership"');
    expect(line).not.toContain('--allow-destructive');
  });

  it('certified: the line the differ wrote, unchanged', async () => {
    const { lines } = await bootOn(() => true);
    expect(lineFor(lines, ORPHAN_ORG)).toBe(`[schema-drift] ${ORPHAN_ORG}${ALLOW_DESTRUCTIVE_DROP}`);
  });

  it('control, not certified: another orphaned column keeps its --allow-destructive remedy', async () => {
    const { lines } = await bootOn(() => false);
    expect(lineFor(lines, `${TABLE}.legacy_code:`)).toBe(
      `[schema-drift] ${TABLE}.legacy_code: column exists in the database but not in metadata (orphaned)${ALLOW_DESTRUCTIVE_DROP}`,
    );
  });

  it('control, not certified: a tighten_not_null keeps its --allow-destructive remedy', async () => {
    const { lines } = await bootOn(() => false);
    expect(lineFor(lines, `${TABLE}.name:`)).toBe(
      `[schema-drift] ${TABLE}.name: metadata declares \`storage.notNull\` but the column is nullable — existing nulls ` +
        'must be backfilled. Run "os migrate apply --allow-destructive".',
    );
  });

  it('a table with no organization_id drop never asks the question', async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    (driver as any).logger = { warn: vi.fn(), info: vi.fn() };
    let asked = 0;
    driver.setTenantKeyCertifiedResolver(() => {
      asked++;
      return false;
    });
    await (driver as any).knex.schema.createTable(TABLE, (t: any) => {
      t.string('id').primary();
      t.string('name');
      t.string('legacy_code');
    });
    await driver.initObjects([{ name: TABLE, fields: { name: { type: 'string' } } }]);
    expect(asked).toBe(0);
  });
});
