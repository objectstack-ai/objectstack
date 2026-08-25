// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * [#11567] A real database FOREIGN KEY, built with RAW DDL, for the tests that
 * need a raw driver fault to withhold.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## Why this exists
 *
 * Two integration suites here (`batch-row-driver-text-*`, `batch-row-http-status-*`)
 * are about what a batch response does with a **raw driver error**: that its
 * text is withheld (#8502) and that it carries no declared status (#8570).
 * Both need a fault that the DATABASE raises — not a validation refusal — and
 * both used a `FOREIGN KEY constraint failed` on delete as the vehicle.
 *
 * They obtained that FK by declaring `reference_to` on a lookup field, which
 * the old `SqlDriver.createColumn` read as the gate on its FK DDL. #11567
 * retired that emission: `reference_to` is a key `FieldSchema` REFUSES (a
 * rejected alias of `reference`), so the branch could never fire for a
 * spec-conformant lookup, and the driver now refuses the key outright rather
 * than honouring it in silence. An authored lookup therefore gets **no**
 * FOREIGN KEY — pinned in `sql-driver-11567-lookup-no-foreign-key.test.ts`.
 *
 * ⚠️ So the FK has to come from somewhere else, and it must still be a REAL
 * one. Renaming the key to `reference` alone would have been the wrong repair:
 * the constraint would simply vanish, the delete would succeed, and both
 * suites would stop exercising the limb they exist to guard — the
 * `expect(raw.code).toBe('SQLITE_CONSTRAINT_FOREIGNKEY')` non-vacuity check in
 * each is precisely what refuses to let that happen quietly.
 *
 * Raw DDL is also what every other FK-touching driver test in this repo
 * already does (`sql-driver-introspection.test.ts`,
 * `sql-driver-11201-introspect-fk-schema-scope.test.ts`, the sqlite-wasm
 * twin): build the constraint with knex, then observe it. This helper only
 * gives that established practice one name and one rationale instead of two
 * copies.
 *
 * ## ⚠️ Why the FK column is declared `text`, not `lookup`
 *
 * Measured while making this change, and it is the more interesting half.
 * Spelling the child field the canonical way — `{ type: 'lookup', reference:
 * 'bd_parent' }` — makes all three FK-dependent tests fail with
 * `expected null not to be null`: no raw driver fault is raised at all. The
 * constraint is still there and still enforced (`PRAGMA foreign_key_list`
 * reports it; a raw `knex.del()` is refused `SQLITE_CONSTRAINT_FOREIGNKEY`),
 * but the ENGINE now recognises the relationship and applies `deleteBehavior`
 * on the way down, clearing the dependent row BEFORE the parent delete reaches
 * the database. The delete then succeeds and there is no driver error to
 * withhold.
 *
 * That is the documented contract doing exactly what it says — referential
 * integrity belongs to the engine, not to a database constraint (#11567) — but
 * it makes a canonical lookup useless as a *raw-fault* vehicle. So the column
 * is declared `text`: it carries a real FOREIGN KEY through raw DDL, and
 * carries no relationship the engine will resolve on its behalf. The
 * differential is the proof, same tables and same constraint either way:
 * `lookup` ⇒ no raw fault, `text` ⇒ `SQLITE_CONSTRAINT_FOREIGNKEY`.
 *
 * ## Why the table is pre-created rather than altered
 *
 * SQLite cannot `ALTER TABLE … ADD CONSTRAINT`, so an FK must be present at
 * `CREATE TABLE` time. The tables are therefore built here first; the driver's
 * own `initObjects` then takes its "table already exists" path and ADDs only
 * the columns still missing (`name`), leaving the FK column untouched. The
 * audit columns are built through the driver's OWN
 * `createAuditTimestampColumn`, so the pre-created table is shaped exactly as
 * the driver would have shaped it — including the `updated_at` that
 * `initObjects` reads to decide `tablesWithTimestamps` membership.
 */
export async function provisionRawForeignKey(
  driver: any,
  parentTable: string,
  childTable: string,
  fkColumn: string,
): Promise<void> {
  const knex = driver.knex;
  const audit = (t: any) => {
    driver.createAuditTimestampColumn(t, 'created_at');
    driver.createAuditTimestampColumn(t, 'updated_at');
  };
  await knex.schema.createTable(parentTable, (t: any) => {
    t.string('id').primary();
    audit(t);
  });
  await knex.schema.createTable(childTable, (t: any) => {
    t.string('id').primary();
    audit(t);
    t.string(fkColumn).references('id').inTable(parentTable);
  });
}
