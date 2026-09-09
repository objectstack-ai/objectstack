// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16185] The `sys_migration` half of the declared pair — `columns_moved_at`.
 *
 * `sys-migration.object.ts` states that the row contract "lives in
 * `@objectstack/spec/system` (`DataMigrationFlagSchema`)", which is why the
 * schema member and this column are one card and not two. That sentence is
 * prose; nothing in the repo held the two halves together, so a later card
 * could widen either one alone and every gate would stay green. This pin holds
 * them together for the member this card adds.
 *
 * It pins the column's SHAPE as well as its presence, because the shape is the
 * contract the ruling on #15989 chose: the column must be able to be absent.
 * A `required: true` column would make "the backfill ran here but the column
 * move did not" — a real, expected deployment state — unrepresentable in the
 * ledger, and mechanism A was chosen precisely because that state must encode
 * as nothing at all. The three sibling attestation columns are asserted beside
 * it as the control that "not required" is this table's shape and not an
 * oversight on the new one.
 *
 * ⛔ Not pinned here: any read of the column. This card adds the declaration
 * and the column and stops — the writer and the reader are the blocked driver
 * card's, and a pin over behaviour that does not exist yet would be a pin over
 * nothing.
 */

import { describe, it, expect } from 'vitest';
import { DataMigrationFlagSchema } from '@objectstack/spec/system';

import { SysMigration } from './sys-migration.object.js';

const FIELDS = SysMigration.fields as Record<string, Record<string, unknown>>;

describe('sys_migration.columns_moved_at (#16185)', () => {
  it('is declared as a datetime column', () => {
    expect(FIELDS.columns_moved_at).toBeDefined();
    expect(FIELDS.columns_moved_at.type).toBe('datetime');
  });

  it('is readonly — writes flow through the migration command, not the API', () => {
    expect(FIELDS.columns_moved_at.readonly).toBe(true);
  });

  it('is NOT required: "backfilled here, columns not moved" must be representable', () => {
    // `ObjectSchema.create` resolves an undeclared `required` to `false`, so
    // the assertion is against that resolved value, not against absence.
    expect(FIELDS.columns_moved_at.required).toBe(false);
    // Control — the same shape on the three siblings it joins, against the two
    // columns that ARE required, so the assertion above is not vacuous.
    for (const sibling of ['verified_at', 'applied_at', 'deviation_observed_at']) {
      expect(FIELDS[sibling]?.required, sibling).toBe(false);
    }
    for (const mandatory of ['id', 'last_run_at']) {
      expect(FIELDS[mandatory]?.required, mandatory).toBe(true);
    }
  });

  it('matches the row contract: the schema accepts the value this column stores', () => {
    const row = {
      id: 'adr-0104-file-references',
      last_run_at: '2026-09-01T00:00:00.000Z',
      blocking: 0,
      columns_moved_at: '2026-09-09T04:00:00.000Z',
    };
    const parsed = DataMigrationFlagSchema.safeParse(row);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect((parsed.data as Record<string, unknown>).columns_moved_at).toBe(row.columns_moved_at);
  });

  it('leaves the columns the ledger already had exactly where they were', () => {
    // Order matters to a reviewer reading the clause-② instrument, not to the
    // runtime: a re-order shows up there as a large false delta.
    expect(Object.keys(FIELDS)).toEqual([
      'id',
      'last_run_at',
      'verified_at',
      'applied_at',
      'blocking',
      'advisory',
      'details',
      'deviation_observed_at',
      'deviation_detail',
      'columns_moved_at',
      'created_at',
      'updated_at',
    ]);
  });
});
