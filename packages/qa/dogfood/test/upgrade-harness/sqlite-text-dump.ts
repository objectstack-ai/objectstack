// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#24522] The upgrade harness's fixture travels as TEXT: a SQLite database
// dumped to one SQL script, so a fixture change is a reviewable diff and not an
// opaque binary. Two functions, one per direction, and nothing else:
//
//   - `dumpSqliteToSql(file)` — every table's `CREATE` statement as SQLite
//     recorded it, every row as one `INSERT`, then every index. Tables in name
//     order, rows in `rowid` order, so two dumps of one database are identical.
//   - `loadSqlIntoSqlite(sql, file)` — the script into a NEW database file.
//
// `node:sqlite` (no native addon, no `sqlite3` binary on the runner) reads and
// writes the same file format the harness's `sqlite-wasm` driver persists, the
// way `organization-ownership-boot-refusal-order.dogfood.test.ts` reads it.
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

type Cell = null | number | bigint | string | Uint8Array;

/** One SQL literal for one stored value; a string keeps its bytes exactly. */
function literal(value: Cell): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
  return `X'${Buffer.from(value).toString('hex')}'`;
}

const ident = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** The whole database as one deterministic SQL script. */
export function dumpSqliteToSql(file: string): string {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const tables = db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string; sql: string }>;
    const indexes = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY tbl_name, name")
      .all() as Array<{ sql: string }>;
    const out: string[] = ['PRAGMA foreign_keys=OFF;', 'BEGIN TRANSACTION;'];
    for (const { name, sql } of tables) {
      out.push(`${sql};`);
      const rows = db.prepare(`SELECT * FROM ${ident(name)} ORDER BY rowid`);
      rows.setReadBigInts(true);
      for (const row of rows.all() as Array<Record<string, Cell>>) {
        const cols = Object.keys(row);
        out.push(`INSERT INTO ${ident(name)} (${cols.map(ident).join(',')}) VALUES(${cols.map((c) => literal(row[c])).join(',')});`);
      }
    }
    for (const { sql } of indexes) out.push(`${sql};`);
    out.push('COMMIT;', '');
    return out.join('\n');
  } finally {
    db.close();
  }
}

/** The script into a NEW database file; refuses to write over an existing one. */
export function loadSqlIntoSqlite(sql: string, file: string): void {
  if (existsSync(file)) throw new Error(`loadSqlIntoSqlite: ${file} already exists; the fixture loads into a new file only`);
  const db = new DatabaseSync(file);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}
