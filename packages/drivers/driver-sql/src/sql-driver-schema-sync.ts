// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25521 cut 6] The two in-place drift reconcilers of `SqlDriver`'s schema
 * sync — `applyDriftOpInPlace`, which applies one column drift op as a dialect
 * `ALTER` on Postgres and MySQL, and `rebuildSqliteTablePatched`, the SQLite
 * table rebuild that applies a set of them — moved out of `sql-driver.ts`
 * whole. `applyMigrationEntries`, which calls both, stays in the class, as do
 * the members the two bodies call (`applyIndexDriftOp`, `buildRebuiltColumn`,
 * `syncTableIndexes` and the rest).
 *
 * A MOVE, not a redesign. Each function below is the body of the `SqlDriver`
 * method of the same name as it stood, re-indented one level and otherwise
 * unedited: the same dialect statements, the same rebuild procedure, the same
 * honoured-entries contract.
 *
 * ## How the moved bodies reach the class
 *
 * The shape `sql-driver-introspection.ts` (cut 1) applies, after #23050. The
 * class keeps both methods, because the published `dist/*.d.ts` lists each
 * one's name, docblock and position, and tests call both on the driver. Each
 * body is now one literal of exactly the {@link SchemaSyncHost} members that
 * method reads, plus a `.call`. The methods are no longer `async`: each
 * returns the moved function's own promise, so a caller awaits the same
 * promise the body settles, with no extra wrapper.
 *
 * The methods the bodies call go as closures that call them on the driver at
 * call time, so a subclass override or a test spy on the instance is still the
 * one the body reaches. The fields `knex`, `logger`, `managedObjectFields` and
 * `managedObjectIndexes`, the getter `dialectName` and the two dialect getters
 * go as GETTERS, so each read happens when the body makes it, as it did on the
 * class; `this.logger.warn(...)` still calls `warn` on the logger itself.
 *
 * The module-level declarations the bodies read, `isIndexDriftOp` and the
 * types `DriftOp` and `ManagedDriftEntry`, live in `schema-drift.ts`, which
 * exports them, and are imported from there; `sql-driver.ts` still reads all
 * three. `index.ts` re-exports nothing from this module, so the published
 * surface does not move.
 */

import { isIndexDriftOp, type DriftOp, type ManagedDriftEntry } from './schema-drift.js';
import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the functions below read — every one of them, and
 * no other; each function's `this` is the `Pick` of the members IT reads. Each
 * is typed AS the class member (an indexed access on the class), so a change
 * to a member's signature on the class is a change here too, and naming a
 * member the class does not have is a compile error. See the module header
 * for which members are getters.
 */
export interface SchemaSyncHost {
  applyDeclaredColumnDefault: SqlDriver['applyDeclaredColumnDefault'];
  applyIndexDriftOp: SqlDriver['applyIndexDriftOp'];
  buildRebuiltColumn: SqlDriver['buildRebuiltColumn'];
  readonly dialectName: SqlDriver['dialectName'];
  introspectColumns: SqlDriver['introspectColumns'];
  readonly isMysql: SqlDriver['isMysql'];
  readonly isPostgres: SqlDriver['isPostgres'];
  readonly knex: SqlDriver['knex'];
  readonly logger: SqlDriver['logger'];
  readonly managedObjectFields: SqlDriver['managedObjectFields'];
  readonly managedObjectIndexes: SqlDriver['managedObjectIndexes'];
  nowColumnDefault: SqlDriver['nowColumnDefault'];
  resolveTenantField: SqlDriver['resolveTenantField'];
  syncTableIndexes: SqlDriver['syncTableIndexes'];
}

/** The body of `SqlDriver#applyDriftOpInPlace`; the method's docblock there is its contract. */
export async function applyDriftOpInPlace(this: Pick<SchemaSyncHost, 'applyIndexDriftOp' | 'dialectName' | 'isMysql' | 'isPostgres' | 'knex' | 'logger'>, op: DriftOp): Promise<boolean> {
  // Index ops need no dialect-specific ALTER — route them to the portable path.
  if (isIndexDriftOp(op)) return this.applyIndexDriftOp(op);
  const { table, column } = op;
  if (this.isPostgres) {
    switch (op.type) {
      case 'relax_not_null':
        await this.knex.raw('ALTER TABLE ?? ALTER COLUMN ?? DROP NOT NULL', [table, column]);
        return true;
      case 'tighten_not_null':
        await this.knex.raw('ALTER TABLE ?? ALTER COLUMN ?? SET NOT NULL', [table, column]);
        return true;
      case 'widen_varchar':
      case 'narrow_varchar':
        await this.knex.raw(`ALTER TABLE ?? ALTER COLUMN ?? TYPE varchar(${op.to})`, [table, column]);
        return true;
      case 'drop_column':
        await this.knex.raw('ALTER TABLE ?? DROP COLUMN ??', [table, column]);
        return true;
      case 'drop_column_default':
        await this.knex.raw('ALTER TABLE ?? ALTER COLUMN ?? DROP DEFAULT', [table, column]);
        return true;
    }
  }
  if (this.isMysql) {
    // MySQL MODIFY restates the FULL column definition — reconstruct the
    // type (with length for char types, so a nullability change never
    // silently drops a varchar's declared length) from columnInfo.
    const info: any = await this.knex(table).columnInfo();
    const ci: any = info?.[column];
    const colType: string | undefined = ci?.type
      ? (/char/i.test(ci.type) && ci.maxLength ? `${ci.type}(${ci.maxLength})` : ci.type)
      : undefined;
    switch (op.type) {
      case 'relax_not_null':
        if (!colType) return false;
        await this.knex.raw(`ALTER TABLE ?? MODIFY ?? ${colType} NULL`, [table, column]);
        return true;
      case 'tighten_not_null':
        if (!colType) return false;
        await this.knex.raw(`ALTER TABLE ?? MODIFY ?? ${colType} NOT NULL`, [table, column]);
        return true;
      case 'widen_varchar':
      case 'narrow_varchar':
        await this.knex.raw(`ALTER TABLE ?? MODIFY ?? varchar(${op.to})`, [table, column]);
        return true;
      case 'drop_column':
        await this.knex.raw('ALTER TABLE ?? DROP COLUMN ??', [table, column]);
        return true;
      case 'drop_column_default':
        // `ALTER … ALTER COLUMN … DROP DEFAULT` — the one ALTER COLUMN form
        // MySQL accepts without restating the type, so it cannot lose a
        // varchar length the way MODIFY can.
        await this.knex.raw('ALTER TABLE ?? ALTER COLUMN ?? DROP DEFAULT', [table, column]);
        return true;
    }
  }
  this.logger.warn(`[schema-drift] ${op.type} on ${table}.${column} is unsupported on dialect '${this.dialectName}' — skipped`);
  return false;
}

/** The body of `SqlDriver#rebuildSqliteTablePatched`; the method's docblock there is its contract. */
export async function rebuildSqliteTablePatched(this: Pick<SchemaSyncHost, 'applyDeclaredColumnDefault' | 'buildRebuiltColumn' | 'introspectColumns' | 'knex' | 'logger' | 'managedObjectFields' | 'managedObjectIndexes' | 'nowColumnDefault' | 'resolveTenantField' | 'syncTableIndexes'>, table: string, ents: ManagedDriftEntry[]): Promise<ManagedDriftEntry[]> {
  const relax = new Set<string>();
  const tighten = new Set<string>();
  const drop = new Set<string>();
  const dropDefault = new Set<string>();
  // The entries this rebuild ACTS on, filled by the same pass that fills the
  // four sets — deliberately not a second list of op types to keep in sync
  // with the branches below. An entry is honoured if and only if one of those
  // branches took it, so the returned set cannot drift from the work done.
  const honoured: ManagedDriftEntry[] = [];
  for (const e of ents) {
    if (e.op.type === 'relax_not_null') relax.add(e.op.column);
    else if (e.op.type === 'tighten_not_null') tighten.add(e.op.column);
    else if (e.op.type === 'drop_column') drop.add(e.op.column);
    else if (e.op.type === 'drop_column_default') dropDefault.add(e.op.column);
    // Everything else is IGNORED here and must be reported as such (#11722):
    // widen/narrow varchar (SQLite ignores declared length — nothing to do),
    // `manual_column_type_change` (no reconciler arm on ANY dialect, by
    // decision), and any column op added later, which lands in this branch by
    // default rather than being silently absorbed into `honoured`.
    else continue;
    honoured.push(e);
  }

  const physical = await this.introspectColumns(table);
  const kept = physical.filter((c) => !drop.has(c.name));
  const keptNames = kept.map((c) => c.name);
  const fields = this.managedObjectFields.get(table) ?? {};
  const tmp = `__os_mig_${table}`;

  // FK enforcement must be toggled OUTSIDE the transaction (SQLite ignores
  // the PRAGMA inside one). Off during the swap so the rename doesn't trip
  // any dangling references mid-flight.
  await this.knex.raw('PRAGMA foreign_keys = OFF');
  try {
    await this.knex.transaction(async (trx) => {
      await trx.schema.dropTableIfExists(tmp);
      await trx.schema.createTable(tmp, (t) => {
        for (const c of kept) {
          const col = this.buildRebuiltColumn(t, c);
          if (!col) continue;
          const nullable = relax.has(c.name) ? true : tighten.has(c.name) ? false : c.nullable;
          if (!nullable && c.name !== 'id') col.notNullable();
          if (c.name === 'created_at' || c.name === 'updated_at') {
            // #11321: the SAME canonical default {@link createAuditTimestampColumn}
            // emits, not `knex.fn.now()`. This method is SQLite-only (see the
            // `isSqlite` branch in `applyMigrationEntries`), where
            // `knex.fn.now()` is the zone-naive `CURRENT_TIMESTAMP` — so
            // re-emitting it here would silently REVERT a table that was
            // created with the canonical default the moment any unrelated
            // drift (a relaxed NOT NULL, a dropped column) triggered a
            // rebuild. A rebuild must hand back the column `initObjects`
            // would have built.
            col.defaultTo(this.nowColumnDefault('datetime'));
          } else if (!dropDefault.has(c.name)) {
            // Re-emit the METADATA-declared default. The rebuild dropped the
            // original table, so a column whose default is not restated here
            // comes back without one — which is precisely what a
            // `drop_column_default` op wants, and precisely what a
            // `defaultValue: 'NOW()'` sibling must not suffer.
            const f = (fields as Record<string, any>)[c.name];
            if (f) this.applyDeclaredColumnDefault(col, f, f.type || 'string');
          }
        }
      });
      const colList = keptNames.map((n) => `"${n}"`).join(', ');
      await trx.raw(`INSERT INTO "${tmp}" (${colList}) SELECT ${colList} FROM "${table}"`);
      await trx.schema.dropTable(table);
      await trx.schema.renameTable(tmp, table);
    });
  } finally {
    await this.knex.raw('PRAGMA foreign_keys = ON');
  }

  // Recreate unique constraints + declared indexes from metadata. The rebuild
  // dropped the original table, so every index went with it — this is a fresh
  // materialization, and it must produce the SAME constraints as
  // `initObjects` would. It used to inline its own `uniq_<table>_<col>`
  // single-column DDL, which is how a tenant-scoped field could silently
  // regain a global unique index after any drift rebuild (#3696); both paths
  // now share {@link syncTableIndexes}.
  try {
    const keptSet = new Set(keptNames);
    await this.syncTableIndexes(
      table,
      fields,
      this.managedObjectIndexes.get(table),
      this.resolveTenantField(table),
      keptSet,
    );
  } catch (e: any) {
    this.logger.warn(`[schema-drift] could not fully recreate indexes for '${table}' after rebuild`, e?.message ?? e);
  }

  return honoured;
}
