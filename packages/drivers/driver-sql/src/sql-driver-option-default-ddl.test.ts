// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An option-level `default: true` gets NO physical column DEFAULT (#7246).
 *
 * The engine now honours the select idiom — `ObjectQL.applyFieldDefaults` falls
 * back to the option marked `default: true` when the field declares no
 * `defaultValue`. The DDL deliberately does NOT follow, and because that reads
 * as an oversight next to case 4 of `applyDeclaredColumnDefault` (an ordinary
 * literal IS emitted), it is pinned here rather than left to a comment.
 *
 * Why not emit, in short — the long form lives on
 * `SqlDriver.applyDeclaredColumnDefault`:
 *
 *  - `defaultValue` beats the option flag, and that precedence lives in ONE
 *    place, the engine. A column DEFAULT is a second resolver.
 *  - On `multiple: true` the default is an ARRAY; there is no scalar DDL form,
 *    so emitting needs a carve-out the author cannot see.
 *  - This method runs for fresh and re-materialized columns only, never a
 *    retrofit, so emitting would give new databases a DEFAULT that older ones
 *    on identical metadata lack — and `detectDrift`'s only `default_mismatch`
 *    producer is the #4560 runtime-token check, so nothing would report it.
 *
 * The #4560 discipline is NOT the reason: an option's `value` is a plain
 * literal, so it could legally be emitted. This is a design decision about
 * where a default is resolved, and the last test states the consequence that
 * makes it safe — every ObjectStack write path stores the value regardless,
 * because the engine, not the database, supplies it.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { SqlDriver } from '../src/index.js';

describe('SqlDriver — an option `default: true` never becomes a column DEFAULT (#7246)', () => {
  let knexInstance: any;

  const makeDriver = () => {
    const d = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    knexInstance = (d as any).knex;
    (d as any).logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
    return d;
  };

  /** The raw `CREATE TABLE` SQLite stored — the only unambiguous view of a DEFAULT. */
  const tableSql = async (table: string): Promise<string> => {
    const row = await knexInstance.raw(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
      [table],
    );
    return String(row?.[0]?.sql ?? row?.sql ?? '');
  };

  afterEach(async () => {
    await knexInstance?.destroy();
  });

  const optionZoo = [
    {
      name: 'option_zoo',
      fields: {
        title: { type: 'string' },
        // Option-default only — the shape 30 fields in the shipped corpus use.
        f_status: {
          type: 'select',
          options: [
            { label: 'Draft', value: 'draft', default: true },
            { label: 'Active', value: 'active' },
          ],
        },
        // BOTH declared: the field-level literal is emitted (case 4), and it is
        // also the value the engine resolves — the two agree, which is the
        // property that matters when both sides can answer.
        f_stage: {
          type: 'select',
          defaultValue: 'approved',
          options: [
            { label: 'Draft', value: 'draft', default: true },
            { label: 'Approved', value: 'approved' },
          ],
        },
      },
    },
  ];

  it('creates an option-defaulted column with NO database default', async () => {
    const driver = makeDriver();
    await driver.initObjects(optionZoo as any);

    const info = await knexInstance('option_zoo').columnInfo();
    expect(info.f_status.defaultValue ?? null).toBeNull();

    const sql = await tableSql('option_zoo');
    expect(sql).not.toContain("DEFAULT 'draft'");
  });

  it('REGRESSION: a field-level `defaultValue` on the SAME field is still emitted', async () => {
    // The exclusion is scoped to the option flag. Losing case 4 here would be a
    // silent behaviour change for every literal default in the platform.
    const driver = makeDriver();
    await driver.initObjects(optionZoo as any);
    const info = await knexInstance('option_zoo').columnInfo();
    expect(String(info.f_stage.defaultValue)).toContain('approved');
    // ...and never the option the field-level key outranks.
    expect(String(info.f_stage.defaultValue)).not.toContain('draft');
  });

  it('a driver-level insert that omits the field stores NULL — the engine, not the database, defaults it', async () => {
    // The consequence of the decision, stated rather than left implicit: this
    // is a RAW driver write, below the engine. Through `ObjectQL.insert` the
    // same omission stores 'draft' (pinned in
    // objectql/src/engine-select-option-default.test.ts), which is every
    // ObjectStack write path. Only a writer bypassing the engine sees this
    // NULL — and that writer is not reading `options` either.
    const driver = makeDriver();
    await driver.initObjects(optionZoo as any);
    await driver.create('option_zoo', { id: 'o1', title: 't' }, { bypassTenantAudit: true });
    const row = await knexInstance('option_zoo').where('id', 'o1').first();
    expect(row.f_status).toBeNull();
  });
});
