// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A real SQLite database wearing the `@libsql/client` interface — so the
 * REMOTE transport can be exercised end-to-end, on rows, without a network.
 *
 * Every other remote-mode suite in this package mocks `execute` and asserts on
 * the SQL string it was handed. That is the wrong instrument for the failures
 * #937 was about: a dropped or mis-widened predicate leaves the SQL perfectly
 * valid — just wider or narrower — so a string assertion sails past it. Exactly
 * the blind spot framework#4081 hit one layer up, where `NativeSQLStrategy`
 * looked covered until something executed its output and `$between` turned out
 * to return the entire table.
 *
 * libsql IS SQLite, so backing the interface with `better-sqlite3` gives the
 * transport the same value semantics a real Turso endpoint would (TEXT/INTEGER
 * affinity, lexicographic TEXT ordering) — the semantics every row-result
 * assertion here depends on. What it deliberately does NOT model is the
 * network: HTTP batching, retries and cold-start reconnection are the concern
 * of the transport suites that already mock `execute`.
 */

import type { Client } from '@libsql/client';
import { createRequire } from 'node:module';

// better-sqlite3 is a knex PEER here and is never imported directly outside
// this testkit, so the package carries no `@types` for it. Rather than take a
// dependency to type one test double, declare the sliver of its surface the
// stub actually uses — which also documents that surface.
interface SqliteStatement {
  readonly reader: boolean;
  all(...args: unknown[]): Record<string, unknown>[];
  run(...args: unknown[]): { changes: number };
}
export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  close(): void;
}

const Database = createRequire(import.meta.url)('better-sqlite3') as new (
  filename: string,
) => SqliteDatabase;

export interface LibsqlSqliteStub {
  execute(stmt: unknown): Promise<{ rows: unknown[]; columns: string[]; rowsAffected: number }>;
  batch(stmts: unknown[]): Promise<unknown[]>;
  close(): void;
  /** The underlying database, for asserting on what actually landed on disk. */
  raw: SqliteDatabase;
}

/**
 * Build the stub. `:memory:` unless a file is given.
 *
 * Arguments are normalised by {@link normalize} to the value classes
 * better-sqlite3 can bind, using the conversions `@libsql/client` performs
 * client-side. See that function for what is modelled and why.
 */
export function makeLibsqlSqliteStub(filename = ':memory:'): LibsqlSqliteStub {
  const db = new Database(filename);

  const run = (stmt: unknown) => {
    const sql = typeof stmt === 'string' ? stmt : (stmt as { sql: string }).sql;
    const args = typeof stmt === 'string' ? [] : normalize((stmt as { args?: unknown[] }).args);
    const prepared = db.prepare(sql);
    if (prepared.reader) {
      const rows = prepared.all(...args);
      return { rows, columns: rows.length ? Object.keys(rows[0]) : [], rowsAffected: 0 };
    }
    const info = prepared.run(...args);
    return { rows: [], columns: [], rowsAffected: info.changes };
  };

  return {
    async execute(stmt) {
      return run(stmt);
    },
    async batch(stmts) {
      return stmts.map(run);
    },
    close() {
      db.close();
    },
    raw: db,
  };
}

/**
 * The client-side value conversion `@libsql/client` performs before a bind
 * reaches SQLite — modelled here because the stub binds through better-sqlite3
 * directly and better-sqlite3 performs none of it.
 *
 * ## Why this is the stub's job and not the transport's (#12393)
 *
 * `RemoteTransport.serializeValue` passes a boolean through unchanged, and its
 * comment says why: *"booleans are kept as-is (libsql handles them)"*. Read
 * against the dependency rather than trusted — `@libsql/client`'s sqlite3
 * backend converts a bound boolean to `1`/`0` itself under the default
 * `intMode` (`lib-esm/sqlite3.js`, the `typeof value === "boolean"` arm of its
 * argument valuer). So the transport's comment is accurate and the stub was the
 * half that diverged: it handed the raw boolean to better-sqlite3, which
 * rejects it outright with *"SQLite3 can only bind numbers, strings, bigints,
 * buffers, and null"*.
 *
 * The asymmetry that hid it: the LOCAL path never reaches this question,
 * because `SqlDriver.formatInput` carries its own bind safety net for exactly
 * these value classes. So a boolean written through remote mode was the one
 * combination nothing in this package exercised, and the gap surfaced only when
 * `VALUE_ROUNDTRIP_CASES` asked every driver to store a declared `boolean`.
 *
 * ⚠️ What this deliberately does NOT model: the client also valuates `Date` to
 * `value.valueOf()` and `ArrayBuffer` to a Buffer. Neither is added on
 * speculation — `serializeValue` converts a `Date` to an ISO string before the
 * client ever sees it, so no reachable write binds one, and an unreachable
 * conversion here would be a claim about the client nothing in this package
 * checks. Add them when a caller needs them, with the same source citation.
 */
const normalize = (args: unknown[] | undefined) =>
  (args ?? []).map((a) => {
    // better-sqlite3 rejects `undefined`; libsql accepts it and binds NULL.
    if (a === undefined) return null;
    // The `intMode: 'number'` default, which is what the driver runs under.
    if (typeof a === 'boolean') return a ? 1 : 0;
    return a;
  });

/**
 * The stub, typed as the `@libsql/client` `Client` that `TursoDriverConfig`
 * declares — the one place that impedance mismatch is spelled out.
 *
 * `LibsqlSqliteStub` implements the three members the driver actually calls
 * (`execute` / `batch` / `close`), not the whole `Client` interface, so handing
 * it to the config needs a cast. Suites in this package have each written that
 * cast themselves as `client: stub as never`, which erases the argument to the
 * BOTTOM type: `never` is assignable to anything, so it would go on compiling
 * even if `client` were re-typed to something this stub cannot model at all.
 * This names the TARGET type instead (the #6204 spelling), so the cast still
 * asserts something, and it lives once in the testkit rather than once per
 * suite. Existing `as never` call sites can migrate here; nothing forces them
 * to do it in the same change.
 */
export function asLibsqlClient(stub: LibsqlSqliteStub): Client {
  return stub as unknown as Client;
}
