// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Oracle catalog introspection (ADR-0015 §4.6): the `introspectSchema` arm
 * the Studio Tables tab, `list_remote_tables` and `import_object` read on an
 * Oracle datasource.
 *
 * ## Scope: the connecting user's schema
 *
 * In Oracle a user IS a schema, and an unqualified table name resolves in the
 * session's current schema (`SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')`, the
 * user's own unless an `ALTER SESSION SET CURRENT_SCHEMA` moved it). That is
 * the set listed here, under BARE names: the same resolution scope every
 * statement of the session uses, which is the rule the other three dialect
 * arms follow. Another owner's table is reached by an object whose
 * `external.remoteName` is `OWNER.TABLE`; listing every owner the user can
 * see would put the data dictionary and every installed option's schema in
 * front of the importer.
 *
 * ## Four reads, one per catalog view
 *
 * `ALL_TABLES`, `ALL_TAB_COLUMNS`, `ALL_CONSTRAINTS` (+ `ALL_CONS_COLUMNS`),
 * each ONE statement for the whole schema rather than one per table, so a
 * schema of a thousand tables is four round trips. `ALL_*` rather than
 * `USER_*` because the owner is the CURRENT schema, which need not be the
 * user's own.
 *
 * ## Type strings
 *
 * A column's `type` is spelled the way `@objectstack/spec`'s type matrix
 * (`canonicalizeSqlType(…, 'oracle')`) reads it, parameters kept where they
 * decide the class: `NUMBER(10,2)`, `NUMBER(10,0)`, `NUMBER(*,0)` (a declared
 * `INTEGER`), bare `NUMBER`, `RAW(16)`. Every other type is `DATA_TYPE` as the
 * catalog spells it (`VARCHAR2`, `TIMESTAMP(6) WITH TIME ZONE`, `CLOB`, …).
 *
 * Identifiers keep the catalog's case: an unquoted Oracle identifier is stored
 * UPPER-case, and it is that spelling a `columnMap` must name — the importer
 * maps `FULL_NAME` to the field `full_name`, and every statement this driver
 * compiles quotes `"FULL_NAME"` back, which is the identifier Oracle folded it
 * to. The fold therefore agrees between this read and the statements, by
 * construction rather than by a second fold.
 */

import type { Knex } from 'knex';

import type {
  IntrospectedColumn,
  IntrospectedForeignKey,
  IntrospectedSchema,
  IntrospectedTable,
} from './sql-driver.js';

/** The current-schema expression every read below is scoped to. */
const CURRENT_SCHEMA = `SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')`;

interface OracleColumnRow {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  DATA_TYPE: string;
  DATA_PRECISION: number | null;
  DATA_SCALE: number | null;
  DATA_LENGTH: number | null;
  CHAR_LENGTH: number | null;
  CHAR_USED: string | null;
  NULLABLE: string;
  DATA_DEFAULT: string | null;
}

/**
 * The type string {@link IntrospectedColumn.type} carries for one
 * `ALL_TAB_COLUMNS` row — see the module docblock.
 */
export function oracleColumnTypeString(row: Pick<OracleColumnRow, 'DATA_TYPE' | 'DATA_PRECISION' | 'DATA_SCALE' | 'DATA_LENGTH'>): string {
  const type = row.DATA_TYPE;
  if (type === 'NUMBER') {
    const p = row.DATA_PRECISION;
    const s = row.DATA_SCALE;
    if (p == null && s == null) return 'NUMBER';
    if (p == null) return `NUMBER(*,${s})`;
    return `NUMBER(${p},${s ?? 0})`;
  }
  if (type === 'RAW' && row.DATA_LENGTH != null) return `RAW(${row.DATA_LENGTH})`;
  return type;
}

/** The declared length of a character column, in characters, or `undefined`. */
function maxLengthOf(row: OracleColumnRow): number | undefined {
  if (!/CHAR/.test(row.DATA_TYPE)) return undefined;
  const n = row.CHAR_LENGTH ?? undefined;
  return n && n > 0 ? n : undefined;
}

/** A `DATA_DEFAULT` as the catalog stores it (expression text), trimmed; `undefined` when absent. */
function defaultOf(row: OracleColumnRow): string | undefined {
  if (row.DATA_DEFAULT == null) return undefined;
  const text = String(row.DATA_DEFAULT).trim();
  return text === '' || text.toUpperCase() === 'NULL' ? undefined : text;
}

/** Rows of a `knex.raw` on the `oracledb` client: the array knex resolves with. */
async function rowsOf<T>(knex: Knex, sql: string): Promise<T[]> {
  const result = (await knex.raw(sql)) as unknown;
  return Array.isArray(result) ? (result as T[]) : [];
}

/** The body of `SqlDriver#introspectSchema` on an Oracle client. */
export async function introspectOracleSchema(knex: Knex, dialect: string): Promise<IntrospectedSchema> {
  const introspectedAt = new Date().toISOString();

  const tableRows = await rowsOf<{ TABLE_NAME: string }>(knex, `
    SELECT TABLE_NAME
      FROM ALL_TABLES
     WHERE OWNER = ${CURRENT_SCHEMA}
       AND NESTED = 'NO'
       AND SECONDARY = 'N'
       AND (IOT_TYPE IS NULL OR IOT_TYPE = 'IOT')
       AND DROPPED = 'NO'
       AND TEMPORARY = 'N'
     ORDER BY TABLE_NAME`);

  const columnRows = await rowsOf<OracleColumnRow>(knex, `
    SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, DATA_PRECISION, DATA_SCALE, DATA_LENGTH,
           CHAR_LENGTH, CHAR_USED, NULLABLE, DATA_DEFAULT
      FROM ALL_TAB_COLUMNS
     WHERE OWNER = ${CURRENT_SCHEMA}
     ORDER BY TABLE_NAME, COLUMN_ID`);

  // Primary and single-column unique keys, in key order.
  const keyRows = await rowsOf<{ TABLE_NAME: string; CONSTRAINT_NAME: string; CONSTRAINT_TYPE: string; COLUMN_NAME: string; POSITION: number }>(knex, `
    SELECT c.TABLE_NAME, c.CONSTRAINT_NAME, c.CONSTRAINT_TYPE, cc.COLUMN_NAME, cc.POSITION
      FROM ALL_CONSTRAINTS c
      JOIN ALL_CONS_COLUMNS cc
        ON cc.OWNER = c.OWNER AND cc.CONSTRAINT_NAME = c.CONSTRAINT_NAME AND cc.TABLE_NAME = c.TABLE_NAME
     WHERE c.OWNER = ${CURRENT_SCHEMA}
       AND c.CONSTRAINT_TYPE IN ('P', 'U')
       AND c.STATUS = 'ENABLED'
     ORDER BY c.TABLE_NAME, c.CONSTRAINT_NAME, cc.POSITION`);

  // Outbound foreign keys: each child column paired with the parent column at
  // the same key position, and the parent's owner so a cross-schema parent is
  // reported as such rather than under a bare name that resolves elsewhere.
  const fkRows = await rowsOf<{
    TABLE_NAME: string; CONSTRAINT_NAME: string; COLUMN_NAME: string;
    REF_OWNER: string; REF_TABLE: string; REF_COLUMN: string; IS_LOCAL: string;
  }>(knex, `
    SELECT c.TABLE_NAME, c.CONSTRAINT_NAME, cc.COLUMN_NAME,
           rc.OWNER AS REF_OWNER, rc.TABLE_NAME AS REF_TABLE, rcc.COLUMN_NAME AS REF_COLUMN,
           CASE WHEN rc.OWNER = ${CURRENT_SCHEMA} THEN 'Y' ELSE 'N' END AS IS_LOCAL
      FROM ALL_CONSTRAINTS c
      JOIN ALL_CONS_COLUMNS cc
        ON cc.OWNER = c.OWNER AND cc.CONSTRAINT_NAME = c.CONSTRAINT_NAME AND cc.TABLE_NAME = c.TABLE_NAME
      JOIN ALL_CONSTRAINTS rc
        ON rc.OWNER = c.R_OWNER AND rc.CONSTRAINT_NAME = c.R_CONSTRAINT_NAME
      JOIN ALL_CONS_COLUMNS rcc
        ON rcc.OWNER = rc.OWNER AND rcc.CONSTRAINT_NAME = rc.CONSTRAINT_NAME AND rcc.POSITION = cc.POSITION
     WHERE c.OWNER = ${CURRENT_SCHEMA}
       AND c.CONSTRAINT_TYPE = 'R'
     ORDER BY c.TABLE_NAME, c.CONSTRAINT_NAME, cc.POSITION`);

  const tables: Record<string, IntrospectedTable> = {};
  for (const { TABLE_NAME } of tableRows) {
    tables[TABLE_NAME] = { name: TABLE_NAME, columns: [], foreignKeys: [], primaryKeys: [] };
  }

  for (const row of columnRows) {
    const table = tables[row.TABLE_NAME];
    if (!table) continue; // a view, or a table outside the filter above
    const column: IntrospectedColumn = {
      name: row.COLUMN_NAME,
      type: oracleColumnTypeString(row),
      nullable: row.NULLABLE !== 'N',
      defaultValue: defaultOf(row),
      primaryKey: false,
      isUnique: false,
      maxLength: maxLengthOf(row),
    };
    table.columns.push(column);
  }

  // Keys: the primary key's columns in key order; a UNIQUE constraint marks
  // its column only when it is single-column (the rule
  // `singleColumnUniqueColumns` applies on the other dialects — a composite
  // unique does not make any one member unique).
  const uniqueMembers = new Map<string, string[]>();
  for (const row of keyRows) {
    const table = tables[row.TABLE_NAME];
    if (!table) continue;
    if (row.CONSTRAINT_TYPE === 'P') {
      table.primaryKeys.push(row.COLUMN_NAME);
    } else {
      const key = `${row.TABLE_NAME}\u0000${row.CONSTRAINT_NAME}`;
      const members = uniqueMembers.get(key) ?? [];
      members.push(row.COLUMN_NAME);
      uniqueMembers.set(key, members);
    }
  }
  for (const [key, members] of uniqueMembers) {
    if (members.length !== 1) continue;
    const table = tables[key.slice(0, key.indexOf('\u0000'))];
    const column = table?.columns.find((c) => c.name === members[0]);
    if (column) column.isUnique = true;
  }
  for (const table of Object.values(tables)) {
    for (const column of table.columns) {
      if (table.primaryKeys.includes(column.name)) column.primaryKey = true;
    }
  }

  for (const row of fkRows) {
    const table = tables[row.TABLE_NAME];
    if (!table) continue;
    const fk: IntrospectedForeignKey = {
      columnName: row.COLUMN_NAME,
      referencedTable: row.REF_TABLE,
      referencedColumn: row.REF_COLUMN,
      constraintName: row.CONSTRAINT_NAME,
    };
    if (row.IS_LOCAL !== 'Y') fk.referencedSchema = row.REF_OWNER;
    table.foreignKeys.push(fk);
  }

  return { tables, dialect, introspectedAt };
}
