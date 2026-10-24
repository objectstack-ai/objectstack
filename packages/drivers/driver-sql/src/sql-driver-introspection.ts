// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25521 cut 1] The catalog-introspection helpers of `SqlDriver` —
 * `introspectColumnOrder`, `introspectColumns`, `introspectForeignKeys`,
 * `introspectPrimaryKeys` and `introspectUniqueConstraints`, the per-table
 * catalog reads `introspectSchema` and the schema-sync drift checks are built
 * on — moved out of `sql-driver.ts` whole.
 *
 * [#25521 cut 4] `introspectSchema`, the public whole-schema read those
 * helpers serve, moved here too: it lists the tables per dialect and reads each
 * one through four of them. `listPhysicalColumns`, the other member of the
 * class's Schema Introspection section, stayed in the class: its body is
 * shorter than the host literal a stub would need, so moving it would make
 * `sql-driver.ts` longer, not shorter.
 *
 * A MOVE, not a redesign. Each function below is the body of the `SqlDriver`
 * method of the same name as it stood, re-indented one level and otherwise
 * unedited: the same catalog statements, the same dialect arms, the same
 * `onFailure` contract. A line that continues a template literal keeps its
 * indentation, because there it is statement text, not layout.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), applied per method. The class keeps
 * every method — the published `dist/*.d.ts` lists each one's name, docblock
 * and position, and `TursoDriver` overrides `introspectColumns` and calls
 * `super` — and each body is one literal of exactly the
 * {@link IntrospectionHost} members that method reads, plus a `.call`. The
 * methods are no longer `async`: each returns the moved function's own
 * promise, so a caller awaits the same promise the body settles, with no
 * extra wrapper.
 *
 * `introspectColumns` reads `introspectColumnOrder` through a closure that
 * calls it on the driver at call time, so a subclass override or a test spy on
 * the instance is still the one the body reaches. `introspectSchema` reads the
 * four helpers it calls the same way, so `TursoDriver`'s override of
 * `introspectColumns` (and a test spy on the instance) is still the one it
 * reaches. `TursoDriver` also overrides `introspectSchema` itself and calls
 * `super`, which reaches the class method, which hands this body its host.
 *
 * The field `knex`, the three dialect getters and the getter `dialectName` go
 * as GETTERS, so each read happens when the body makes it, as it did on the
 * class.
 *
 * The two module-level declarations the bodies read, `UniqueConstraintMember`
 * and `singleColumnUniqueColumns`, stay in `sql-driver.ts`, which exports them
 * already (a test imports `singleColumnUniqueColumns` from there), and are
 * imported from there: the module cycle is evaluation-safe because the one
 * value import is read only inside a function body, never while the two
 * modules are first evaluated. `introspectSchema` also reads the types
 * `IntrospectedSchema` and `IntrospectedTable`, which `sql-driver.ts` exports
 * already, and the function `postgresTableNameCollisionError`, which only
 * this body reads: it stays in `sql-driver.ts` and gained a leading `export`
 * there (the shape cut 2 applied), so it is imported, not copied, and is read
 * only inside the body too. `index.ts` re-exports nothing from this module,
 * so the published surface does not move.
 */

import type {
  IntrospectedColumn,
  IntrospectedForeignKey,
  IntrospectedSchema,
  IntrospectedTable,
  SqlDriver,
  UniqueConstraintMember,
} from './sql-driver.js';
import { postgresTableNameCollisionError, singleColumnUniqueColumns } from './sql-driver.js';

/**
 * The `SqlDriver` members the functions below read — every one of them, and
 * no other; each function's `this` is the `Pick` of the members IT reads. Each
 * is typed AS the class member (an indexed access on the class), so a change
 * to a member's signature on the class is a change here too, and naming a
 * member the class does not have is a compile error. See the module header
 * for which members are getters.
 */
export interface IntrospectionHost {
  readonly dialectName: SqlDriver['dialectName'];
  introspectColumnOrder: SqlDriver['introspectColumnOrder'];
  introspectColumns: SqlDriver['introspectColumns'];
  introspectForeignKeys: SqlDriver['introspectForeignKeys'];
  introspectPrimaryKeys: SqlDriver['introspectPrimaryKeys'];
  introspectUniqueConstraints: SqlDriver['introspectUniqueConstraints'];
  readonly isMysql: SqlDriver['isMysql'];
  readonly isPostgres: SqlDriver['isPostgres'];
  readonly isSqlite: SqlDriver['isSqlite'];
  readonly knex: SqlDriver['knex'];
}

/** The body of `SqlDriver#introspectColumnOrder`; the method's docblock there is its contract. */
export async function introspectColumnOrder(this: Pick<IntrospectionHost, 'isMysql' | 'isPostgres' | 'isSqlite' | 'knex'>, tableName: string, schema?: string): Promise<string[]> {
  if (this.isPostgres) {
    const result = await this.knex.raw(
      `SELECT column_name
           FROM information_schema.columns
          WHERE table_name = ?
            AND table_catalog = current_database()
            AND table_schema = ${schema === undefined ? 'current_schema()' : '?'}
          ORDER BY ordinal_position`,
      schema === undefined ? [tableName] : [tableName, schema],
    );
    return result.rows.map((row: any) => row.column_name);
  }
  if (this.isMysql) {
    const result = await this.knex.raw(
      `SELECT COLUMN_NAME as column_name
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ?
          ORDER BY ORDINAL_POSITION`,
      [tableName],
    );
    return result[0].map((row: any) => row.column_name);
  }
  if (this.isSqlite) {
    const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
    const result = await this.knex.raw(`PRAGMA table_info(${safeTableName})`);
    return (result as { name: string; cid: number }[])
      .slice()
      .sort((a, b) => a.cid - b.cid)
      .map((row) => row.name);
  }
  return [];
}

/** The body of `SqlDriver#introspectColumns`; the method's docblock there is its contract. */
export async function introspectColumns(this: Pick<IntrospectionHost, 'introspectColumnOrder' | 'isSqlite' | 'knex'>, tableName: string, schema?: string): Promise<IntrospectedColumn[]> {
  let catalog = this.knex(tableName);
  if (schema !== undefined) catalog = catalog.withSchema(schema);
  const columnInfo = (await catalog.columnInfo()) as Record<string, any>;
  const columns: IntrospectedColumn[] = [];

  // #11163: emit in DECLARED order, not the `columnInfo()` object's
  // key-insertion order (alphabetical on MySQL — see
  // {@link introspectColumnOrder}). `columnInfo()` stays the source of the
  // per-column FACTS because each dialect spells type / nullable /
  // defaultValue / maxLength differently and knex already normalises them;
  // only the ORDER comes from the ordinal read. A name one read has and the
  // other lacks (the catalog moved between the two statements) is appended
  // in `columnInfo()` order rather than dropped, so the merge can reorder
  // but never lose a column.
  const has = (name: string) => Object.prototype.hasOwnProperty.call(columnInfo, name);
  const orderedNames = (await this.introspectColumnOrder(tableName, schema)).filter(has);
  const seen = new Set(orderedNames);
  for (const name of Object.keys(columnInfo)) {
    if (!seen.has(name)) orderedNames.push(name);
  }

  for (const colName of orderedNames) {
    const info = columnInfo[colName];
    let type = 'string';
    // Raw as knex reports it: a number on some dialects, a STRING on SQLite
    // (measured: `"255"`) — see the `maxLength` note on IntrospectedColumn.
    let maxLength: number | string | undefined;

    if (this.isSqlite) {
      type = info.type?.toLowerCase() || 'string';
    } else {
      type = info.type || 'string';
    }

    if (info.maxLength) {
      maxLength = info.maxLength;
    }

    columns.push({
      name: colName,
      type,
      nullable: info.nullable !== false,
      defaultValue: info.defaultValue,
      // The spec contract's spelling, and the only one this driver emits.
      // `introspectSchema` flips it from the table's key list below.
      primaryKey: false,
      isUnique: false,
      maxLength,
    });
  }

  return columns;
}

/** The body of `SqlDriver#introspectForeignKeys`; the method's docblock there is its contract. */
export async function introspectForeignKeys(
  this: Pick<IntrospectionHost, 'isMysql' | 'isPostgres' | 'isSqlite' | 'knex'>,
  tableName: string,
  opts: {
    /**
     * What a failed read means to THIS caller (#7332). `'throw'` (the
     * default) surfaces it; `'partial'` returns whatever was read before the
     * failure — correct only where a short read is self-correcting.
     */
    onFailure?: 'throw' | 'partial';
  } = {},
): Promise<IntrospectedForeignKey[]> {
  const foreignKeys: IntrospectedForeignKey[] = [];

  try {
    if (this.isPostgres) {
      // Read from `pg_constraint`, not `information_schema` (#11324). The
      // three-view join this replaced was wrong in two independent ways, both
      // measured on PostgreSQL 16.13, and neither is repairable inside
      // `information_schema`:
      //
      // 1. `ccu.table_schema = tc.table_schema` demanded that parent and
      //    child sit in the SAME schema. For a FOREIGN KEY,
      //    `constraint_column_usage` describes the REFERENCED side — that is
      //    why the projection aliases it `referenced_table` — so its
      //    `table_schema` is the PARENT's, not the constraint's. A foreign
      //    key whose target lives next door therefore contributed ZERO rows
      //    and the table reported having no foreign keys at all: the #7332
      //    failure mode through a different door, because `[]` does not read
      //    downstream as "I could not see it", it reads as *this table has no
      //    foreign keys*, and federated-object codegen, the persisted
      //    `external_catalog` (ADR-0015) and schema-drift comparison all act
      //    on that. Cross-schema references are the normal shape for the
      //    federated remotes ADR-0015 points this driver at.
      // 2. The `kcu` ↔ `ccu` join carried NO ordinal correlation, so an
      //    N-column key came back as the N x N cartesian product — a 2-column
      //    key measured as 4 rows (`x -> a`, `x -> b`, `y -> a`, `y -> b`)
      //    where the answer is `x -> a`, `y -> b`. `IntrospectedForeignKey`
      //    is a flat per-column record, so the phantom pairs are
      //    indistinguishable from the real ones to every consumer.
      //
      // Why the whole query moves rather than just the join predicate:
      // `constraint_column_usage` exposes no ordinal column AT ALL (measured
      // — its seven columns are the catalog/schema/name triples for the table
      // and the constraint, plus `column_name`), so defect 2 has nothing to
      // correlate on there. Correlating `ccu` on `tc.constraint_schema` — the
      // spelling `introspectUniqueConstraints` already carries, and the
      // conservative half-fix — was measured to repair defect 1 and leave
      // defect 2 untouched at 4 rows. `pg_constraint` carries both facts on
      // ONE row: `conkey` and `confkey` are parallel `smallint[]`s in KEY
      // order, so unnesting them TOGETHER pairs child column with parent
      // column by construction, and `WITH ORDINALITY` keeps the key position
      // the old join threw away — the same shape `introspectPrimaryKeys` uses
      // for `indkey` (#11101 / #11162). `ORDER BY … k.ord` is what pins a
      // composite key's rows as ORDERED SIBLING ROWS, which is how the flat
      // per-column record expresses a composite key correctly with no change
      // to `IntrospectedForeignKey`'s shape. Measured on a key declared out
      // of column sequence — `foreign key (second_col, first_col)` — the
      // result is KEY order, not column order.
      //
      // Scoping is unchanged in meaning (#11201): `ns.nspname = ANY
      // (current_schemas(false))` is `tc.table_schema = ANY (…)` expressed
      // over the catalog — the session's `search_path` minus the implicit
      // `pg_catalog` — so a bare name is still scoped the way every other
      // statement in the session resolves it, and a same-named table in a
      // schema `search_path` never reaches still contributes nothing.
      // `con.conname` orders the constraints; `con.oid` breaks a tie between
      // two same-named constraints in two schemas both on the path, so each
      // constraint's columns are always contiguous and in key order.
      // Dropping to `pg_catalog` also drops `information_schema`'s privilege
      // filter, which is what `introspectPrimaryKeys` and `introspectIndexes`
      // already do — this family reads the catalog directly.
      //
      // An unknown table name still yields an empty list rather than a throw
      // (measured), i.e. this rewrite deliberately does NOT adopt the
      // `?::regclass` failure mode `introspectPrimaryKeys` has; the #7332
      // `onFailure` contract below is unchanged by it.
      // `referenced_schema` (#11377): the PARENT's schema when — and only
      // when — it is not on the session's `search_path`, NULL otherwise.
      // The scoping predicate on the CHILD (`ns.nspname = ANY (…)`) is
      // #11201's and is untouched; this CASE asks the same question about
      // the parent's namespace, so "in path" here means exactly what bare-
      // name resolution means to every other statement in the session.
      // Measured on live PostgreSQL 16.13 (the card's fixture shape): a
      // parent in `os11377_far` answers `referenced_schema = os11377_far`
      // with `referenced_table` still the bare name; an in-path parent
      // answers NULL. The bare spelling of `referenced_table` is
      // deliberate and unconditional — see `IntrospectedForeignKey`.
      const result = await this.knex.raw(
        `
          SELECT
            att.attname AS column_name,
            parent.relname AS referenced_table,
            patt.attname AS referenced_column,
            con.conname AS constraint_name,
            CASE
              WHEN pns.nspname = ANY (current_schemas(false)) THEN NULL
              ELSE pns.nspname
            END AS referenced_schema
          FROM pg_constraint con
          JOIN pg_class child ON child.oid = con.conrelid
          JOIN pg_namespace ns ON ns.oid = child.relnamespace
          JOIN pg_class parent ON parent.oid = con.confrelid
          JOIN pg_namespace pns ON pns.oid = parent.relnamespace
          CROSS JOIN LATERAL unnest(con.conkey, con.confkey)
            WITH ORDINALITY AS k(attnum, fattnum, ord)
          JOIN pg_attribute att
            ON att.attrelid = con.conrelid
            AND att.attnum = k.attnum
          JOIN pg_attribute patt
            ON patt.attrelid = con.confrelid
            AND patt.attnum = k.fattnum
          WHERE con.contype = 'f'
            AND child.relname = ?
            AND ns.nspname = ANY (current_schemas(false))
          ORDER BY con.conname, con.oid, k.ord
        `,
        [tableName],
      );

      for (const row of result.rows) {
        foreignKeys.push({
          columnName: row.column_name,
          referencedTable: row.referenced_table,
          referencedColumn: row.referenced_column,
          constraintName: row.constraint_name,
          // The key is ABSENT for an in-path parent, not `undefined`: an
          // explicit `referencedSchema: undefined` still spells the key
          // into `Object.keys`, JSON round-trips differently, and reads as
          // "someone considered this" — the contract is that presence
          // itself carries the fact (#11377).
          ...(row.referenced_schema != null
            ? { referencedSchema: row.referenced_schema }
            : {}),
        });
      }
    } else if (this.isMysql) {
      // `KEY_COLUMN_USAGE.ORDINAL_POSITION` IS the key ordinal, and it is
      // selected by neither the projection nor an order clause — so without
      // `ORDER BY` the row order of a composite key's columns is whatever the
      // plan yields. The order is load-bearing for the same reason it is on
      // the Postgres arm above: #11324 made a composite foreign key ORDERED
      // SIBLING ROWS in this flat per-column record — `(x, y) references
      // p (a, b)` is `x -> p.a` then `y -> p.b` — and `IntrospectedForeignKey`
      // carries no ordinal field for a consumer to recover the position from.
      //
      // ⚠️ This clause is NOT a repair of a wrong answer, and the measurement
      // that says so is the reason to keep it. On MySQL 8.0.46, a key declared
      // out of column sequence — `foreign key (second_col, first_col)
      // references ooo_parent (pa, pb)` — came back in KEY order through THIS
      // predicate with no `ORDER BY` at all: the right answer, unpinned. But
      // on the same server, in the same session, the sibling
      // `introspectPrimaryKeys` predicate over the SAME view returned COLUMN
      // order for an out-of-sequence primary key — `carrier_code` (ordinal 2)
      // ahead of `shipment_id` (ordinal 1) — reproducing #11101 exactly. So
      // this view does not preserve the ordinal for free on this server:
      // WHICH of the two orders you get is decided by the WHERE clause, and
      // nothing declares that. (Same conclusion as the primary-key arm: the
      // InnoDB folklore that the view "tends to" return ordinal order does not
      // hold on an out-of-sequence key.) What the clause removes is a
      // dependence on a plan choice nobody chose — see the pin in
      // `sql-driver-11379-introspect-fk-mysql-ordinal-order.test.ts`, which is
      // deliberately a pin on the emitted SQL rather than on the row order,
      // because a row-order assertion passes here with or without this line.
      // `referenced_schema` (#11377), symmetric with the Postgres arm: the
      // PARENT's database when it differs from the session's default
      // database, NULL otherwise. MySQL's resolution scope for a bare name
      // is `DATABASE()` (there is no search path to be partially on), and
      // `KEY_COLUMN_USAGE` carries the parent's database as
      // `REFERENCED_TABLE_SCHEMA` on the same row this arm already reads —
      // the child-side filter `TABLE_SCHEMA = DATABASE()` never constrained
      // the referenced side, so a cross-database InnoDB foreign key was
      // already returned here, under a bare name `DATABASE()` does not
      // resolve. `<=>` is the null-safe comparison: with no default
      // database selected, NO bare name resolves, so every parent is
      // out-of-scope and qualified.
      const result = await this.knex.raw(
        `
          SELECT
            COLUMN_NAME as column_name,
            REFERENCED_TABLE_NAME as referenced_table,
            REFERENCED_COLUMN_NAME as referenced_column,
            CONSTRAINT_NAME as constraint_name,
            CASE
              WHEN REFERENCED_TABLE_SCHEMA <=> DATABASE() THEN NULL
              ELSE REFERENCED_TABLE_SCHEMA
            END as referenced_schema
          FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ?
            AND REFERENCED_TABLE_NAME IS NOT NULL
          ORDER BY ORDINAL_POSITION
        `,
        [tableName],
      );

      for (const row of result[0]) {
        foreignKeys.push({
          columnName: row.column_name,
          referencedTable: row.referenced_table,
          referencedColumn: row.referenced_column,
          constraintName: row.constraint_name,
          // Absent, not `undefined`, for an in-database parent — same
          // presence-is-the-fact contract as the Postgres arm (#11377).
          ...(row.referenced_schema != null
            ? { referencedSchema: row.referenced_schema }
            : {}),
        });
      }
    } else if (this.isSqlite) {
      const tableExistsResult = await this.knex.raw(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        [tableName],
      );

      if (!Array.isArray(tableExistsResult) || tableExistsResult.length === 0) {
        return foreignKeys;
      }

      const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
      const result = await this.knex.raw(`PRAGMA foreign_key_list(${safeTableName})`);

      for (const row of result) {
        foreignKeys.push({
          columnName: row.from,
          referencedTable: row.table,
          referencedColumn: row.to,
          constraintName: `fk_${tableName}_${row.from}`,
        });
      }
    }
  } catch (e) {
    // Only a caller that can CORRECT a short read may ask for one (#7332).
    if (opts.onFailure !== 'partial') throw e;
  }

  return foreignKeys;
}

/** The body of `SqlDriver#introspectPrimaryKeys`; the method's docblock there is its contract. */
export async function introspectPrimaryKeys(
  this: Pick<IntrospectionHost, 'isMysql' | 'isPostgres' | 'isSqlite' | 'knex'>,
  tableName: string,
  opts: {
    /**
     * What a failed read means to THIS caller (#7332). `'throw'` (the
     * default) surfaces it; `'partial'` returns whatever was read before the
     * failure — correct only where a short read is self-correcting.
     */
    onFailure?: 'throw' | 'partial';
  } = {},
): Promise<string[]> {
  const primaryKeys: string[] = [];

  try {
    if (this.isPostgres) {
      // `i.indkey` is an `int2vector` holding the key's attnums IN KEY ORDER,
      // but `a.attnum = ANY(i.indkey)` is a MEMBERSHIP test: it reads the
      // vector as a set and discards the position. With no `ORDER BY`, the row
      // order was whatever the plan yielded — measured on PostgreSQL 16.13,
      // `pg_attribute` scan order, i.e. COLUMN order. For a table declared
      // `(carrier_code, shipment_id, leg_seq)` with `PRIMARY KEY (shipment_id,
      // carrier_code)` that is the key REVERSED.
      //
      // Joining the ORDINALITY of `indkey` keeps the position that the
      // membership test threw away, and `ORDER BY k.ord` makes the result the
      // declared key order — the same guarantee the SQLite arm below gets from
      // sorting on the `PRAGMA table_info` ordinal. The two orders differ
      // whenever a key is declared out of column sequence, and this list is
      // used as an addressing / upsert-conflict-target key, where the order is
      // load-bearing: a key in the wrong order is a DIFFERENT key.
      //
      // `k.ord <= i.indnkeyatts` bounds the join to the KEY columns (#11162).
      // For a covering primary key — `CREATE UNIQUE INDEX … INCLUDE (payload)`
      // promoted via `ADD CONSTRAINT … PRIMARY KEY USING INDEX` — `indkey`
      // holds the key columns AND the INCLUDE'd payload columns, and
      // `indnkeyatts` is the count of the leading entries that are actually
      // key members. Measured on PostgreSQL 16.13: `indkey = '2 1 3'`,
      // `indnkeyatts = 2`, and without the bound `payload` was reported as a
      // key member — a key with an extra member is a DIFFERENT key, for the
      // same addressing reasons as above. `indnkeyatts` exists on PG 11+;
      // this driver already requires 9.4+ syntax (`WITH ORDINALITY`) and CI
      // runs 16.
      const result = await this.knex.raw(
        `
          SELECT a.attname as column_name
          FROM pg_index i
          CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a
            ON a.attrelid = i.indrelid
            AND a.attnum = k.attnum
          WHERE i.indrelid = ?::regclass
            AND i.indisprimary
            AND k.ord <= i.indnkeyatts
          ORDER BY k.ord
        `,
        [tableName],
      );

      for (const row of result.rows) {
        primaryKeys.push(row.column_name);
      }
    } else if (this.isMysql) {
      // `KEY_COLUMN_USAGE.ORDINAL_POSITION` IS the key ordinal, and it was
      // selected by neither the projection nor an order clause. Without
      // `ORDER BY` the row order is unspecified — and measured on MySQL
      // 8.0.46 it is COLUMN order, not ordinal order, so an out-of-sequence
      // key came back reversed. (The InnoDB folklore that it "tends to"
      // return ordinal order does not hold on this shape.) Same reason as the
      // Postgres arm above: the order is load-bearing.
      const result = await this.knex.raw(
        `
          SELECT COLUMN_NAME as column_name
          FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ?
            AND CONSTRAINT_NAME = 'PRIMARY'
          ORDER BY ORDINAL_POSITION
        `,
        [tableName],
      );

      for (const row of result[0]) {
        primaryKeys.push(row.column_name);
      }
    } else if (this.isSqlite) {
      const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '');

      const tablesResult = await this.knex.raw("SELECT name FROM sqlite_master WHERE type = 'table'");
      const tableNames = Array.isArray(tablesResult) ? tablesResult.map((row: any) => row.name) : [];

      if (!tableNames.includes(safeTableName)) {
        return primaryKeys;
      }

      const result = await this.knex.raw(`PRAGMA table_info(${safeTableName})`);

      // `PRAGMA table_info` does not report `pk` as a boolean. It reports the
      // column's 1-based position WITHIN the primary key — `0` for "not part
      // of the key", `1` for the first key column, `2` for the second, and so
      // on. Filtering on `pk === 1` therefore kept only the first member of a
      // composite key and silently dropped the rest, and because
      // `introspectSchema` derives `col.primaryKey` FROM this list, both output
      // signals were wrong together.
      //
      // Ordering by the ordinal (rather than taking `table_info`'s row order,
      // which is COLUMN order) makes `primaryKeys` the declared key order. The
      // two differ whenever a key is declared out of column sequence, and this
      // list is used as an addressing / upsert-conflict-target key, where the
      // order is load-bearing.
      const keyedRows = (result as { name: string; pk: number }[]).filter((row) => row.pk > 0);
      keyedRows.sort((a, b) => a.pk - b.pk);

      for (const row of keyedRows) {
        primaryKeys.push(row.name);
      }
    }
  } catch (e) {
    // Only a caller that can CORRECT a short read may ask for one (#7332).
    if (opts.onFailure !== 'partial') throw e;
  }

  return primaryKeys;
}

/** The body of `SqlDriver#introspectUniqueConstraints`; the method's docblock there is its contract. */
export async function introspectUniqueConstraints(
  this: Pick<IntrospectionHost, 'isMysql' | 'isPostgres' | 'isSqlite' | 'knex'>,
  tableName: string,
  opts: {
    /**
     * What a failed read means to THIS caller (#7332). `'throw'` (the
     * default) surfaces it; `'partial'` returns whatever was read before the
     * failure — correct only where a short read is self-correcting.
     */
    onFailure?: 'throw' | 'partial';
  } = {},
): Promise<string[]> {
  const members: UniqueConstraintMember[] = [];

  try {
    if (this.isPostgres) {
      // ⚠️ This query was INVALID until #11161: it selected `c.column_name`
      // while the only aliases in scope were `tc` and `ccu`, so every
      // execution raised `missing FROM-clause entry for table "c"` — and the
      // bare `catch {}` this method carried until #11161 converted that into
      // `[]` on every call. Live Postgres therefore NEVER reported a unique
      // constraint through this method; the defect surfaced (as nine loud
      // test failures) the moment the catch stopped swallowing, which is the
      // #7332 contract doing exactly its job. The schema pin follows
      // `introspectSchema`'s own table listing (`current_schemas(false)`,
      // #9350's pattern): `constraint_column_usage` spans every schema the
      // user can read, so without it the newly-working query would report a
      // same-named table's constraints from a schema the session never
      // reaches.
      // `constraint_schema` is SELECTed, not just joined on, because it is
      // half the constraint's IDENTITY here (#11202). `table_schema = ANY
      // (current_schemas(false))` deliberately spans every schema on the
      // search path, and Postgres auto-names a unique constraint after the
      // table and column (`orders_email_key`) — so two same-named tables in
      // two schemas produce two DIFFERENT constraints carrying the SAME
      // name. Grouping on the name alone would fuse them into one apparent
      // two-member constraint and drop a genuinely single-column unique from
      // the answer.
      const result = await this.knex.raw(
        `
          SELECT tc.constraint_schema, tc.constraint_name, ccu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.constraint_column_usage AS ccu
            ON tc.constraint_schema = ccu.constraint_schema
            AND tc.constraint_name = ccu.constraint_name
          WHERE tc.constraint_type = 'UNIQUE'
            AND tc.table_name = ?
            AND tc.table_schema = ANY (current_schemas(false))
        `,
        [tableName],
      );

      for (const row of result.rows) {
        members.push({
          constraint: [String(row.constraint_schema), String(row.constraint_name)],
          column: row.column_name ?? null,
        });
      }
    } else if (this.isMysql) {
      // `TABLE_SCHEMA = DATABASE()` and `TABLE_NAME = ?` are both pinned in
      // the WHERE and merged by the `USING` join, so a constraint name is
      // already unique within this answer — one identity part suffices,
      // unlike the Postgres arm above.
      const result = await this.knex.raw(
        `
          SELECT CONSTRAINT_NAME, COLUMN_NAME
          FROM information_schema.TABLE_CONSTRAINTS tc
          JOIN information_schema.KEY_COLUMN_USAGE kcu
            USING (CONSTRAINT_NAME, TABLE_SCHEMA, TABLE_NAME)
          WHERE CONSTRAINT_TYPE = 'UNIQUE'
            AND TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ?
        `,
        [tableName],
      );

      for (const row of result[0]) {
        members.push({
          constraint: [String(row.CONSTRAINT_NAME)],
          column: row.COLUMN_NAME ?? null,
        });
      }
    } else if (this.isSqlite) {
      const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '');

      const tablesResult = await this.knex.raw("SELECT name FROM sqlite_master WHERE type = 'table'");
      const tableNames = Array.isArray(tablesResult) ? tablesResult.map((row: any) => row.name) : [];

      if (!tableNames.includes(safeTableName)) {
        return [];
      }

      const indexes = await this.knex.raw(`PRAGMA index_list(${safeTableName})`);

      for (const idx of indexes) {
        // `origin: 'pk'` is the auto-index SQLite materialises for a
        // non-INTEGER PRIMARY KEY — not a declared UNIQUE constraint, and so
        // not what this method reports (#11654). Skipping it is what makes
        // SQLite agree with the other two arms, whose
        // `CONSTRAINT_TYPE = 'UNIQUE'` filter never sees a primary key at
        // all, AND what makes SQLite agree with ITSELF: an `INTEGER PRIMARY
        // KEY` is a rowid alias for which SQLite creates no auto-index, so
        // `index_list` is empty and the key was never flagged — the same
        // logical schema answering differently by the declared type of its
        // key alone. Nothing is lost by the exclusion: primary-key
        // membership is reported losslessly by `introspectPrimaryKeys`,
        // through `IntrospectedTable.primaryKeys` and
        // `IntrospectedColumn.primaryKey`.
        //
        // The test is on the INDEX's origin, never on whether the COLUMN is
        // in the key: a key column that separately carries its own unique
        // index (`origin: 'c'`) really does have a declared single-column
        // unique constraint and stays flagged.
        //
        // `origin` has been reported by this pragma since SQLite 3.8.9, so
        // an absent value is not a case that arises here; were it ever
        // absent this reads as the pre-#11654 behaviour rather than
        // silently dropping real constraints, and the pin on
        // `index_list`'s own origin values turns red.
        if (idx.unique === 1 && idx.origin !== 'pk') {
          // `PRAGMA index_info` reports one row per index MEMBER, and a
          // member is not always a column: an expression term
          // (`CREATE UNIQUE INDEX … ON t (lower(a))`) arrives with
          // `name: null`. Every member is carried through so it still
          // COUNTS toward the index's width — dropping the unnamed ones
          // here would make `(a, lower(b))` look single-column and flag `a`.
          // The `null` is discarded later, where it can only cost a flag
          // rather than manufacture one. Previously the row's `name` was
          // pushed unconditionally, so a one-term expression index put a
          // literal `null` into a `string[]`.
          const info = await this.knex.raw(`PRAGMA index_info(${idx.name})`);
          for (const entry of info) {
            members.push({ constraint: [String(idx.name)], column: entry.name ?? null });
          }
        }
      }
    }
  } catch (e) {
    // Only a caller that can CORRECT a short read may ask for one (#7332).
    if (opts.onFailure !== 'partial') throw e;
  }

  return singleColumnUniqueColumns(members);
}

/** The body of `SqlDriver#introspectSchema`; the method's signature there is its contract. */
export async function introspectSchema(this: Pick<IntrospectionHost, 'dialectName' | 'introspectColumns' | 'introspectForeignKeys' | 'introspectPrimaryKeys' | 'introspectUniqueConstraints' | 'isMysql' | 'isPostgres' | 'isSqlite' | 'knex'>): Promise<IntrospectedSchema> {
  const tables: Record<string, IntrospectedTable> = {};
  // Stamped BEFORE the reads, not after: a consumer asking "has the remote
  // changed since this snapshot?" must not be told the snapshot covers a
  // moment later than the first table it actually read.
  const introspectedAt = new Date().toISOString();
  let tableNames: string[] = [];
  // PostgreSQL only (#24707): the schema each listed table lives in, so its
  // columns are read THERE. Every other dialect leaves it empty.
  const schemaByTable = new Map<string, string>();

  if (this.isPostgres) {
    // Every schema the session can actually reach unqualified, rather than
    // the literal `'public'` — same answer for a default deployment, where
    // `current_schemas(false)` is exactly `{public}`, and the right answer for
    // a session pointed at another schema, where the literal listed nothing.
    //
    // `table_schema` and its `search_path` position are selected too
    // (#24707). The result is keyed by BARE name, so two schemas holding the
    // same name used to collapse into one key with the later table silently
    // dropped — refused below instead. And the schema is what the column read
    // needs: knex `columnInfo()` on a bare name reads `current_schema()`, the
    // FIRST schema on the path only, so a table in a later schema reported
    // zero columns. No `ORDER BY` is added: the key order of a single-schema
    // answer stays exactly what it was.
    const result = await this.knex.raw(`
        SELECT table_schema, table_name,
          array_position(current_schemas(false), table_schema::name) AS path_position
        FROM information_schema.tables
        WHERE table_schema = ANY (current_schemas(false))
        AND table_type = 'BASE TABLE'
      `);
    const rows = result.rows as { table_schema: string; table_name: string; path_position: number }[];
    const schemasByTable = new Map<string, { schema: string; position: number }[]>();
    for (const row of rows) {
      const seen = schemasByTable.get(row.table_name);
      const entry = { schema: row.table_schema, position: Number(row.path_position) };
      if (seen) seen.push(entry);
      else schemasByTable.set(row.table_name, [entry]);
    }
    const collisions = [...schemasByTable]
      .filter(([, schemas]) => schemas.length > 1)
      .map(([table, schemas]) => ({
        table,
        schemas: schemas.sort((a, b) => a.position - b.position).map((s) => s.schema),
      }))
      .sort((a, b) => (a.table < b.table ? -1 : a.table > b.table ? 1 : 0));
    if (collisions.length > 0) throw postgresTableNameCollisionError(collisions);

    tableNames = rows.map((row) => row.table_name);
    for (const row of rows) schemaByTable.set(row.table_name, row.table_schema);
  } else if (this.isMysql) {
    const result = await this.knex.raw(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
        AND table_type = 'BASE TABLE'
      `);
    tableNames = result[0].map((row: any) => row.TABLE_NAME);
  } else if (this.isSqlite) {
    const result = await this.knex.raw(`
        SELECT name as table_name
        FROM sqlite_master
        WHERE type='table'
        AND name NOT LIKE 'sqlite_%'
      `);
    tableNames = result.map((row: any) => row.table_name);
  }

  for (const tableName of tableNames) {
    // All four reads take the #7332 default (`onFailure: 'throw'`): this
    // caller cannot correct a short read, and `introspectColumns` has never
    // swallowed — so a partially-readable database fails the whole-schema
    // introspection loudly instead of emitting tables whose keys silently
    // read as absent (#11161). Every in-tree caller of `introspectSchema`
    // already handles a throw (the datasource health check reports
    // `{ ok: false }`, the REST/CLI seams surface the error).
    // On PostgreSQL the columns are read in the table's OWN schema (#24707);
    // the three key reads below already scope to `current_schemas(false)`
    // or resolve along `search_path`, which the refusal above makes
    // unambiguous among base tables.
    const columns = await this.introspectColumns(tableName, schemaByTable.get(tableName));
    const foreignKeys = await this.introspectForeignKeys(tableName);
    const primaryKeys = await this.introspectPrimaryKeys(tableName);
    const uniqueConstraints = await this.introspectUniqueConstraints(tableName);

    for (const col of columns) {
      if (primaryKeys.includes(col.name)) col.primaryKey = true;
      if (uniqueConstraints.includes(col.name)) col.isUnique = true;
    }

    tables[tableName] = { name: tableName, columns, foreignKeys, primaryKeys };
  }

  // `dialectName` — not the raw Knex client, and not the spec's
  // `SQLDialectSchema` enum. The only in-tree consumer of this key is
  // `suggestFieldTypeForSqlType(col.type, schema.dialect as SqlDialect)`,
  // whose `SqlDialect` vocabulary (`packages/spec/src/data/type-compat.ts`)
  // spells PostgreSQL `postgres`, exactly as `dialectName` does. Emitting
  // the enum's `postgresql` instead would put the key in `Object.keys()`
  // while leaving every per-dialect type alias unreachable — the omission
  // this repairs, wearing a fix's clothes.
  return { tables, dialect: this.dialectName, introspectedAt };
}
