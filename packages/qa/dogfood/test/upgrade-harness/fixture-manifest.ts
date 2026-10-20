// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#24522] What the upgrade harness holds the fixture to, in one place: the
// tables steps 1–7 of the 18.x line reshape (ruling record 6266750393 on the v18
// epic), the columns that identify a row of each, and the census both sides
// take — the populator when it writes the fixture, the harness when HEAD has
// booted over a copy of it.
//
// A table is named here because a step will move, delete, re-source or
// constrain its rows, so it is where an upgrade loses data if one is going to.
// The step numbers are the line's; the plan that cut them is the step-0 report
// on #24522. ⛔ A row here is never an assertion that the step's code exists —
// only that the 18.0 data it will reshape is in the fixture, and still there.
import { DatabaseSync } from 'node:sqlite';

export interface ReshapedTable {
  /** The physical table, or the prefix of a date-sharded family (`sys_activity__r…`). */
  table: string;
  /** Matches every physical shard whose name starts with `table` + `__`. */
  sharded?: boolean;
  /** The 18.x steps that reshape it. */
  steps: readonly number[];
  /** Why the step touches it, in one line. */
  why: string;
  /**
   * The columns whose values a row must keep across the upgrade. Only columns
   * no boot rewrites: never `updated_at`, never a delivery's `status`.
   */
  keyColumns: readonly string[];
  /**
   * The table becomes deployment-level and loses `organization_id`. A database
   * born at 18.0.0 never had the column, so the census projects the key
   * columns without it there.
   */
  dropsOrganization?: true;
}

/**
 * The reshaped tables. Every one must hold at least one row in the fixture —
 * the populator refuses to write a fixture otherwise, so the harness can never
 * go green over an empty table.
 */
export const RESHAPED_TABLES: readonly ReshapedTable[] = [
  { table: 'sys_webhook', steps: [1, 5], why: 'the declared webhook mirror rows the registry read replaces; the ceremony deletes them (D10 fate 2)', keyColumns: ['id', 'name', 'organization_id', 'active'] },
  { table: 'sys_http_delivery', steps: [1, 5], why: 'the mirror rows\' delivery tails, re-sourced by the ceremony', keyColumns: ['id', 'ref_id', 'organization_id'] },
  { table: 'sys_secret', steps: [2, 5], dropsOrganization: true, why: 'loses its organization column; ownership follows the referencing row', keyColumns: ['id', 'organization_id'] },
  { table: 'sys_setting', steps: [2], why: 'the referencing row a secret\'s ownership follows', keyColumns: ['id', 'organization_id'] },
  { table: 'sys_setting_audit', steps: [2, 5], why: 'its global rung moves to a deployment-level sibling', keyColumns: ['id', 'organization_id'] },
  { table: 'sys_flow_credential', steps: [2, 5], dropsOrganization: true, why: 'becomes deployment-level (no organization column)', keyColumns: ['id', 'organization_id'] },
  { table: 'sys_email', steps: [3, 5], why: 'identity mail moves to a deployment-level sibling', keyColumns: ['id', 'organization_id'] },
  { table: 'sys_invitation', steps: [3], why: 'the invitation whose mail is identity mail', keyColumns: ['id', 'organization_id', 'email'] },
  { table: 'sys_sharing_rule', steps: [5], why: '9c: the same-name guard and the sharing-rule copy migration', keyColumns: ['id', 'name', 'organization_id'] },
  { table: 'sys_share_link', steps: [5], why: '8e: organization_id NOT NULL', keyColumns: ['id', 'organization_id'] },
  { table: 'sys_activity', sharded: true, steps: [5, 7], why: '8e NOT NULL; 8c retires the organization-less read branch', keyColumns: ['id', 'organization_id'] },
  { table: 'sys_user_permission_set', steps: [5, 7], why: 'grants: 8e NOT NULL, 8c retires the NULL grant readers', keyColumns: ['id', 'organization_id'] },
  { table: 'sys_member', steps: [5], why: 'membership, the anchor attribution reads', keyColumns: ['id', 'organization_id', 'user_id'] },
  { table: 'sys_user', steps: [3], why: 'the identity mail\'s anchor; the fixture\'s people sign in with it', keyColumns: ['id', 'email'] },
];

export interface ManifestTable {
  table: string;
  physical: string[];
  steps: readonly number[];
  keyColumns: string[];
  count: number;
  rows: Array<Record<string, string | null>>;
}

export interface FixtureManifest {
  /** The git ref the generator was asked for, as given. */
  ref: string;
  /** The commit it resolved to. */
  sha: string;
  generatedAt: string;
  /** Every table's row count, physical names. */
  tables: Record<string, number>;
  reshaped: ManifestTable[];
}

const ident = (name: string): string => `"${name.replace(/"/g, '""')}"`;
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** The physical tables one reshaped entry names, in name order. */
export function physicalTablesOf(db: DatabaseSync, entry: ReshapedTable): string[] {
  const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
  return names.filter((n) => n === entry.table || (entry.sharded === true && n.startsWith(`${entry.table}__`)));
}

/** The physical columns of `table`. */
export function columnsOf(db: DatabaseSync, table: string): string[] {
  return (db.prepare('SELECT name FROM pragma_table_info(?)').all(table) as Array<{ name: string }>).map((r) => r.name);
}

/** Every row of a reshaped entry, projected onto its key columns, ordered by id. */
export function keyRowsOf(db: DatabaseSync, physical: readonly string[], keyColumns: readonly string[]): Array<Record<string, string | null>> {
  const rows: Array<Record<string, string | null>> = [];
  for (const t of physical) {
    for (const r of db.prepare(`SELECT ${keyColumns.map(ident).join(',')} FROM ${ident(t)} ORDER BY id`).all() as Array<Record<string, unknown>>) {
      rows.push(Object.fromEntries(keyColumns.map((c) => [c, text(r[c])])));
    }
  }
  return rows;
}

/**
 * The census the populator writes into the manifest. Throws when a reshaped
 * table is missing or empty, or names a key column the table does not carry
 * (`organization_id` on a `dropsOrganization` table excepted: it is left out
 * of that table's key columns).
 */
export function takeCensus(file: string, ref: string, sha: string): FixtureManifest {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const all = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
    const tables: Record<string, number> = {};
    for (const t of all) tables[t] = Number((db.prepare(`SELECT COUNT(*) AS n FROM ${ident(t)}`).get() as { n: number }).n);
    const problems: string[] = [];
    const reshaped: ManifestTable[] = [];
    for (const entry of RESHAPED_TABLES) {
      const physical = physicalTablesOf(db, entry);
      if (physical.length === 0) {
        problems.push(`${entry.table}: no such table`);
        continue;
      }
      const absent = entry.keyColumns.filter((c) => physical.some((t) => !columnsOf(db, t).includes(c)));
      const missing = absent.filter((c) => !(c === 'organization_id' && entry.dropsOrganization === true));
      if (missing.length > 0) {
        problems.push(`${entry.table}: no column ${missing.join(', ')}`);
        continue;
      }
      const keyColumns = entry.keyColumns.filter((c) => !absent.includes(c));
      const rows = keyRowsOf(db, physical, keyColumns);
      if (rows.length === 0) problems.push(`${entry.table}: empty — the populator did not reach it`);
      reshaped.push({ table: entry.table, physical, steps: entry.steps, keyColumns, count: rows.length, rows });
    }
    if (problems.length > 0) throw new Error(`the fixture does not cover what steps 1–7 reshape:\n  - ${problems.join('\n  - ')}`);
    return { ref, sha, generatedAt: new Date().toISOString(), tables, reshaped };
  } finally {
    db.close();
  }
}
