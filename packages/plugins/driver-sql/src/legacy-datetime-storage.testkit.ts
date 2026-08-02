// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Test double for a SQLite database that still holds PRE-canonical
 * `Field.datetime` values — the shape every deployment had before #3912, and the
 * shape one still has when `backfillCanonicalDatetimes` could not run (it logs
 * and swallows, deliberately, so a migration failure cannot take boot down).
 *
 * Since #3912 the write path canonicalises, so the legacy forms cannot be
 * produced through `create()` any more. They have to be inserted RAW, and the
 * column's canonical marker has to be cleared, or the driver would correctly
 * conclude the column is clean and skip the read-side repair. Both halves are
 * needed for the fixture to be honest — which is exactly why they live in one
 * helper rather than being re-improvised per suite.
 *
 * Not exported from the package entry (`index.ts`): this is test-only.
 */

import { SqlDriver } from './sql-driver.js';

export class LegacyStorageDriver extends SqlDriver {
  /**
   * Insert rows bypassing `formatInput`, so each `datetime` value lands in
   * whatever form it is given (a number → INTEGER epoch ms, a string → TEXT),
   * then mark `field` as NOT known-canonical so the read paths apply their
   * repair — the state of an un-migrated database.
   */
  async seedLegacyRows(
    table: string,
    field: string,
    rows: Array<Record<string, unknown>>,
  ): Promise<void> {
    await this.knex(table).insert(rows);
    this.forgetCanonical(table, field);
  }

  /** Drop the "already backfilled" marker for one column. */
  forgetCanonical(table: string, field: string): void {
    this.canonicalDatetimeFields[table]?.delete(field);
  }

  /**
   * The `Field.time` twin (#3994): insert raw pre-canonical time values and
   * clear the column's canonical marker.
   */
  async seedLegacyTimeRows(
    table: string,
    field: string,
    rows: Array<Record<string, unknown>>,
  ): Promise<void> {
    await this.knex(table).insert(rows);
    this.forgetCanonicalTime(table, field);
  }

  /** Drop the "already backfilled" marker for one `Field.time` column. */
  forgetCanonicalTime(table: string, field: string): void {
    this.canonicalTimeFields[table]?.delete(field);
  }

  /**
   * Does this dialect still owe a `Field.datetime` column the read-side legacy
   * repair? (#4245)
   *
   * The driver's own rule, exposed so a matrix consumer can ASSERT which
   * dialects have a legacy storage form instead of asserting it in a comment.
   * True only on SQLite — the typeless store where INTEGER epoch ms can sit
   * next to zone-naive TEXT in one column — and only while the column's
   * canonical marker is clear, so call it after {@link forgetCanonical}.
   */
  legacyDatetimeRepairApplies(table: string, field: string): boolean {
    return this.needsLegacyDatetimeRepair(table, field);
  }

  /** The `Field.time` twin of {@link legacyDatetimeRepairApplies} (#4245). */
  legacyTimeRepairApplies(table: string, field: string): boolean {
    return this.needsLegacyTimeRepair(table, field);
  }

  /** Raw stored form of a column, for asserting on the fixture's premise. */
  async storedForms(table: string, field: string): Promise<Array<{ id: string; type: string; value: unknown }>> {
    const res: any = await this.knex.raw(
      `select id, typeof(??) as t, ?? as v from ?? order by id`,
      [field, field, table],
    );
    const rows = Array.isArray(res) ? res : (res?.rows ?? []);
    return rows.map((r: any) => ({ id: r.id, type: r.t, value: r.v }));
  }
}
