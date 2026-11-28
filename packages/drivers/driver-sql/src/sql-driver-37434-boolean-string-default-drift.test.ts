// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#37434] A boolean column's DEFAULT, declared as the STRING `'true'` /
 * `'false'`, reads as no drift once the sync has written it.
 *
 * # The defect
 *
 * The sync writes a boolean literal DEFAULT in the boolean's own physical
 * spelling: on SQLite knex's boolean formatter stores `'0'` for the string
 * `'false'` and `'1'` for `'true'` (and the Turso remote face's
 * `sqliteDeclaredColumnDefaultSql` the same). The differ's
 * `physicalLiteralMatches` compared a string declaration as text, so a freshly
 * created column read as `default_mismatch` / `set_column_default` (expected
 * `'false'`, actual `'0'`) on every drift read, and applying the entry wrote
 * `'0'` again: the plan never went empty.
 *
 * # What is asserted
 *
 * §1 (no database): `physicalLiteralMatches` reads `'true'` / `'false'` on a
 * `boolean` / `toggle` column as the booleans they spell; a real mismatch is
 * still one; on a non-boolean column the strings still compare as text.
 *
 * §2 (SQLite, two boots over one file): each spelling — the strings `'false'`
 * and `'true'`, the booleans `false` and `true`, and a `toggle` — is clean
 * after create; a CONTROL real mismatch (the table created with the opposite
 * DEFAULT) is still reported, and ONE apply empties the plan.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from './index.js';
import { physicalLiteralMatches } from './schema-drift.js';

describe('#37434 §1 — a boolean column reads the strings it spells', () => {
  it.each([
    // [physical literal text, declared, field type, expected]
    ['0', 'false', 'boolean', true],
    ['1', 'true', 'boolean', true],
    ['0', 'false', 'toggle', true],
    ['1', 'true', 'toggle', true],
    ['false', 'false', 'boolean', true],
    ['t', 'true', 'boolean', true],
    // A real mismatch is still one.
    ['0', 'true', 'boolean', false],
    ['1', 'false', 'boolean', false],
    ['0', 'true', 'toggle', false],
    // The booleans, unchanged.
    ['0', false, 'boolean', true],
    ['1', true, 'boolean', true],
    ['0', true, 'boolean', false],
    // Not a boolean column: the strings still compare as text.
    ['0', 'false', 'text', false],
    ['false', 'false', 'text', true],
  ] as const)('%j vs declared %j (%s) → %j', (text, declared, type, expected) => {
    expect(physicalLiteralMatches(text, declared, type)).toBe(expected);
  });
});

const TABLE = 'os37434_flags';

/** Every spelling of a boolean literal DEFAULT the card names, plus a `toggle`. */
const SPELLINGS: Record<string, { type: string; defaultValue: string | boolean }> = {
  s_false: { type: 'boolean', defaultValue: 'false' },
  s_true: { type: 'boolean', defaultValue: 'true' },
  b_false: { type: 'boolean', defaultValue: false },
  b_true: { type: 'boolean', defaultValue: true },
  t_false: { type: 'toggle', defaultValue: 'false' },
  t_true: { type: 'toggle', defaultValue: 'true' },
};
const PHYSICAL: Record<string, string> = { s_false: "'0'", s_true: "'1'", b_false: "'0'", b_true: "'1'", t_false: "'0'", t_true: "'1'" };

/** The same columns, each declaring the opposite truth in the same spelling. */
const flipped = (): Record<string, { type: string; defaultValue: string | boolean }> => Object.fromEntries(
  Object.entries(SPELLINGS).map(([name, f]) => [
    name,
    { ...f, defaultValue: typeof f.defaultValue === 'boolean' ? !f.defaultValue : (f.defaultValue === 'true' ? 'false' : 'true') },
  ]),
);

const object = (fields: Record<string, unknown>) => ({ name: TABLE, fields: { title: { type: 'string' }, ...fields } }) as any;
const quietLogger = () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() });

describe('#37434 §2 — SQLite: a boolean literal DEFAULT reads clean after create, and a real mismatch applies once', () => {
  const open: SqlDriver[] = [];
  let dir: string | undefined;

  const boot = async (obj: any): Promise<SqlDriver> => {
    dir ??= mkdtempSync(join(tmpdir(), 'os37434-'));
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'db.sqlite') }, useNullAsDefault: true } as any);
    (driver as any).logger = quietLogger();
    open.push(driver);
    await driver.initObjects([obj]);
    return driver;
  };

  const defaults = async (driver: SqlDriver): Promise<Record<string, unknown>> => {
    const rows: Array<{ name: string; dflt_value: unknown }> = await (driver as any).knex.raw(`PRAGMA table_info("${TABLE}")`);
    return Object.fromEntries(rows.filter((r) => r.name in SPELLINGS).map((r) => [r.name, r.dflt_value]));
  };

  afterEach(async () => {
    for (const d of open.splice(0)) await d.disconnect();
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("each spelling — 'false', 'true', false, true, and a toggle — is stored as '0' / '1' and reads no drift", async () => {
    const OBJ = object(SPELLINGS);
    const driver = await boot(OBJ);
    expect(await defaults(driver)).toEqual(PHYSICAL);
    expect(await driver.detectManagedDrift([OBJ])).toEqual([]);
  });

  it('CONTROL: a table created with the opposite DEFAULT is reported per column, and one apply empties the plan', async () => {
    const first = await boot(object(flipped()));
    await first.disconnect();
    open.splice(open.indexOf(first), 1);

    const OBJ = object(SPELLINGS);
    const second = await boot(OBJ);
    const drift = await second.detectManagedDrift([OBJ]);
    expect(drift.map((d) => [d.column, d.kind, d.op.type, d.category]).sort()).toEqual(
      Object.keys(SPELLINGS).sort().map((name) => [name, 'default_mismatch', 'set_column_default', 'safe']),
    );

    const { applied, skipped } = await second.applyMigrationEntries(drift, { allowDestructive: false });
    expect(skipped).toEqual([]);
    expect(applied).toHaveLength(Object.keys(SPELLINGS).length);
    expect(await defaults(second)).toEqual(PHYSICAL);
    expect(await second.detectManagedDrift([OBJ])).toEqual([]);
  });
});
