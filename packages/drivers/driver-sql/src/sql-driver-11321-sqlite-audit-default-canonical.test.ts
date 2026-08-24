// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11321] On SQLite the builtin audit columns must take the SAME canonical
 * ISO-8601 DEFAULT a declared `Field.datetime` NOW() column in the same table
 * gets — not the zone-naive `CURRENT_TIMESTAMP`.
 *
 * ## The defect
 *
 * `createAuditTimestampColumn`'s non-MySQL branch was
 * `table.timestamp(name).defaultTo(this.knex.fn.now())`. On SQLite
 * `knex.fn.now()` compiles to an unqualified `CURRENT_TIMESTAMP`, which renders
 * a zone-NAIVE, space-separated, second-precision `'YYYY-MM-DD HH:MM:SS'`.
 * `nowColumnDefault` — what a DECLARED `defaultValue: 'NOW()'` field gets —
 * already emitted `(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`. Measured on
 * better-sqlite3 before the fix, one table, one defaulted insert:
 *
 * ```
 * created_at  "2026-08-23 14:54:17"          <- builtin audit  (naive)
 * updated_at  "2026-08-23 14:54:17"          <- builtin audit  (naive)
 * when        "2026-08-23T14:54:17.796Z"     <- declared field (canonical)
 * ```
 *
 * `updatedAtStamp()`'s own docblock condemns exactly that spelling: `Date.parse`
 * reads a zone-less string as LOCAL time, silently shifting the instant by the
 * host offset on a non-UTC runtime.
 *
 * ## Why this is asserted as AGREEMENT, not as a string
 *
 * The property that matters is that one table cannot carry two shapes for one
 * conceptual value. So §1 and §2 compare the audit columns to a declared NOW()
 * sibling *in the same table* rather than to a hard-coded literal: if
 * `nowColumnDefault` ever changes its canonical spelling, this suite must keep
 * passing (both sides move together) and must still fail if only one side moves.
 *
 * ## §3 exists because this changes emitted DDL
 *
 * Every SQLite table already on disk keeps `default CURRENT_TIMESTAMP`. If
 * schema-drift compared column defaults, this fix would make every existing
 * deployment report drift on `created_at`/`updated_at` — a narrow correctness
 * fix turned into a broad false alarm. It does not, by two independent guards
 * (`BUILTIN_COLUMNS` skips the audit columns outright; the only
 * `default_mismatch` producer is the #4560 runtime-token check, and `NOW()` is
 * not an app-resolved token). §3 pins that, WITH a positive control — a bare
 * "drift is empty" assertion would pass just as well against an inert harness.
 *
 * ## §4: the second site
 *
 * `rebuildSqliteTablePatched` re-materializes a whole table when SQLite drift is
 * reconciled, and it re-emitted the audit default itself. That method is
 * SQLite-only, so leaving it as `knex.fn.now()` would have silently REVERTED a
 * canonically-created table on the first unrelated drift rebuild. §4 pins that a
 * rebuild hands back the column `initObjects` would have built.
 *
 * ## §5: the reachability this actually repairs
 *
 * `stampInsertTimestamps` fills both audit columns app-side, so on an ordinary
 * boot the DEFAULT never fires. It gates on `tablesWithTimestamps`, which only
 * DDL-running paths populate — so on the documented `skipSchemaSync` /
 * `OS_SKIP_SCHEMA_SYNC=1` posture (`registerObjectMetadata`, the DDL-free
 * registration door) the set is EMPTY and the driver's own `create()` door hits
 * the column DEFAULT. That is the population this fix repairs, and it is wider
 * than "writes that bypass the driver".
 *
 * ## Reverse verification (direction predicted BEFORE each leg)
 *
 * Restoring `main`'s `createAuditTimestampColumn` body turns §1, §2 and §5 red
 * (audit columns naive, declared sibling canonical — the defect itself as the
 * received value) and leaves §3 GREEN, because §3's subject is drift's
 * indifference to the default, which the fix never changed. Restoring `main`'s
 * `rebuildSqliteTablePatched` line turns §4 red ONLY.
 */

import { describe, it, expect } from 'vitest';
import knexFactory from 'knex';
import { SqlDriver } from '../src/index.js';

/** Canonical instant: ISO-8601, explicit `Z`, milliseconds. */
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** The pre-canonical shape this card removes: zone-naive, space-separated. */
const NAIVE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

const OPTS = { bypassTenantAudit: true } as any;

/** An object carrying a declared `Field.datetime` NOW() sibling of the audit columns. */
const FIELDS = {
  title: { type: 'string' },
  when: { type: 'datetime', defaultValue: 'NOW()' },
} as Record<string, any>;

function sqliteDriver(filename = ':memory:'): SqlDriver {
  return new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename },
    useNullAsDefault: true,
  } as any);
}

/** The `CREATE TABLE` text SQLite itself recorded for `table`. */
async function emittedDdl(driver: SqlDriver, table: string): Promise<string> {
  const raw = (driver as any).knex;
  const rows = await raw.raw(`select sql from sqlite_master where type='table' and name=?`, [table]);
  const sql = (Array.isArray(rows) ? rows[0]?.sql : rows?.sql) ?? '';
  expect(sql, `no CREATE TABLE recorded for ${table}`).toBeTruthy();
  return String(sql);
}

/** The `default …` clause SQLite recorded for one column, normalized to one line. */
function defaultClauseOf(ddl: string, column: string): string {
  // `\`col\` <type> default <expr>` up to whatever ends the column definition:
  // the next quoted column, the table-level `primary key (…)` clause, or the
  // close of the CREATE TABLE. Without the `primary key` alternative the LAST
  // column's clause swallows it and no two columns ever compare equal.
  const m = new RegExp(
    '`' + column + '`\\s+\\w+\\s+default\\s+(.+?)(?:,\\s*`|,\\s*primary key|\\s*\\)\\s*$)',
    'i',
  ).exec(ddl);
  expect(m, `no DEFAULT clause for ${column} in: ${ddl}`).not.toBeNull();
  return m![1].trim().replace(/\s+/g, ' ');
}

describe('#11321 SQLite builtin audit columns take the canonical NOW() default', () => {
  // ── §1 emitted DDL ────────────────────────────────────────────────────────
  it('§1 the audit columns and a declared Field.datetime NOW() sibling get the SAME default expression', async () => {
    const driver = sqliteDriver();
    try {
      await driver.initObjects([{ name: 'audit_ddl_t', fields: FIELDS } as any]);
      const ddl = await emittedDdl(driver, 'audit_ddl_t');

      const declared = defaultClauseOf(ddl, 'when');
      const createdAt = defaultClauseOf(ddl, 'created_at');
      const updatedAt = defaultClauseOf(ddl, 'updated_at');

      // The property: one table, ONE default shape. Compared to the declared
      // sibling rather than to a literal, so a future respelling of the
      // canonical expression moves both sides together.
      expect(createdAt).toBe(declared);
      expect(updatedAt).toBe(declared);

      // And the shape is the canonical one, not the naive fallback — otherwise
      // "they agree" would also be satisfied by both being CURRENT_TIMESTAMP.
      expect(createdAt.toUpperCase()).not.toBe('CURRENT_TIMESTAMP');
      expect(createdAt).toContain('strftime');
      expect(createdAt).toContain('%Y-%m-%dT%H:%M:%fZ');
    } finally {
      await driver.disconnect();
    }
  });

  // ── §2 stored value on a DEFAULT-firing write ─────────────────────────────
  it('§2 a write that lets the DEFAULTs fire stores a canonical instant in every column', async () => {
    const driver = sqliteDriver();
    try {
      await driver.initObjects([{ name: 'audit_val_t', fields: FIELDS } as any]);
      const raw = (driver as any).knex;

      // Deliberately NOT driver.create(): this is the door that reaches the
      // column DEFAULT — raw SQL that names neither audit column.
      await raw.raw(`insert into "audit_val_t" ("id","title") values ('x','y')`);
      const rows = await raw.raw(`select created_at, updated_at, "when" from "audit_val_t"`);
      const row = (Array.isArray(rows) ? rows[0] : rows) as Record<string, string>;

      for (const col of ['created_at', 'updated_at', 'when']) {
        expect(row[col], `${col} = ${row[col]}`).toMatch(ISO_Z);
        expect(row[col], `${col} is still the naive shape`).not.toMatch(NAIVE);
      }
      // Same statement, same SQLite `'now'` — the instants agree to the second,
      // which is what "one conceptual value" means here.
      expect(row.created_at.slice(0, 19)).toBe(row.when.slice(0, 19));
    } finally {
      await driver.disconnect();
    }
  });

  // ── §3 the blast-radius question: does drift read this default? ───────────
  it('§3 a table still carrying the OLD CURRENT_TIMESTAMP default reports NO drift (with a positive control)', async () => {
    const driver = sqliteDriver();
    try {
      const raw = (driver as any).knex;
      // A table exactly as an already-deployed database holds it: audit columns
      // defaulted the OLD way, created before this fix.
      await raw.raw(
        `create table "legacy_t" (` +
          `"id" varchar(255), ` +
          `"created_at" datetime default CURRENT_TIMESTAMP, ` +
          `"updated_at" datetime default CURRENT_TIMESTAMP, ` +
          `"title" varchar(255), ` +
          `"when" datetime default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), ` +
          `primary key ("id"))`,
      );

      // Introspection DOES surface the legacy default — so a green below is
      // drift declining to compare it, not drift failing to see it.
      const cols = await (driver as any).introspectColumns('legacy_t');
      const createdAtCol = cols.find((c: any) => c.name === 'created_at');
      expect(String(createdAtCol.defaultValue).toUpperCase()).toContain('CURRENT_TIMESTAMP');

      const drift = await driver.detectManagedDrift([{ name: 'legacy_t', fields: FIELDS } as any]);
      expect(drift.filter((d: any) => d.column === 'created_at' || d.column === 'updated_at')).toEqual([]);
      expect(drift).toEqual([]);

      // POSITIVE CONTROL — same table, same call. Without this, the empty array
      // above is satisfied by a drift path that reports nothing at all.
      await raw.raw(`alter table "legacy_t" add column "orphan_col" varchar(255)`);
      await raw.raw(`alter table "legacy_t" add column "owner" varchar(255) default 'current_user'`);
      const controlled = await driver.detectManagedDrift([
        { name: 'legacy_t', fields: { ...FIELDS, owner: { type: 'lookup', defaultValue: 'current_user' } } } as any,
      ]);
      const kinds = controlled.map((d: any) => `${d.kind}:${d.column}`);
      expect(kinds).toContain('unmapped_column:orphan_col');
      // The default-READING dimension is demonstrably live in the same call …
      expect(kinds).toContain('default_mismatch:owner');
      // … and still says nothing about the audit columns.
      expect(controlled.filter((d: any) => d.column === 'created_at' || d.column === 'updated_at')).toEqual([]);
    } finally {
      await driver.disconnect();
    }
  });

  // ── §4 the SQLite rebuild must not revert the default ─────────────────────
  it('§4 a drift-triggered SQLite table rebuild hands back the canonical default, not CURRENT_TIMESTAMP', async () => {
    const driver = sqliteDriver();
    try {
      await driver.initObjects([{ name: 'rebuild_t', fields: FIELDS } as any]);
      const before = defaultClauseOf(await emittedDdl(driver, 'rebuild_t'), 'created_at');

      // An UNRELATED drift on the same table — an orphaned column — is what
      // triggers the whole-table rebuild. The audit columns are not the subject.
      const raw = (driver as any).knex;
      await raw.raw(`alter table "rebuild_t" add column "orphan_col" varchar(255)`);
      const drift = await driver.detectManagedDrift([{ name: 'rebuild_t', fields: FIELDS } as any]);
      expect(drift.map((d: any) => d.op.type)).toContain('drop_column');

      await (driver as any).applyMigrationEntries(drift, { allowDestructive: true });

      const after = defaultClauseOf(await emittedDdl(driver, 'rebuild_t'), 'created_at');
      expect(after).toBe(before);
      expect(after.toUpperCase()).not.toBe('CURRENT_TIMESTAMP');
      expect(after).toContain('%Y-%m-%dT%H:%M:%fZ');

      // And it still behaves: a defaulted insert into the rebuilt table.
      await raw.raw(`insert into "rebuild_t" ("id","title") values ('r','y')`);
      const rows = await raw.raw(`select created_at from "rebuild_t" where id='r'`);
      const row = (Array.isArray(rows) ? rows[0] : rows) as Record<string, string>;
      expect(row.created_at).toMatch(ISO_Z);
    } finally {
      await driver.disconnect();
    }
  });

  // ── §5 the reachability the fix actually repairs ──────────────────────────
  it('§5 on a skipSchemaSync boot the driver own create() door now stores a canonical created_at', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const filename = join(mkdtempSync(join(tmpdir(), 'os11321-')), 'probe.sqlite');

    // Boot 1 — an ordinary boot. initObjects runs the DDL and records the table
    // in `tablesWithTimestamps`, so the app-side stamp fires.
    const a = sqliteDriver(filename);
    await a.initObjects([{ name: 'reach_t', fields: FIELDS } as any]);
    await a.create('reach_t', { id: 'ddl-boot', title: 'a' } as any, OPTS);
    expect([...(a as any).tablesWithTimestamps]).toContain('reach_t');
    await a.disconnect();

    // Boot 2 — the documented out-of-band posture: metadata registered, DDL
    // skipped. `tablesWithTimestamps` stays EMPTY, so `stampInsertTimestamps`
    // returns early and `create()` reaches the column DEFAULT.
    const b = sqliteDriver(filename);
    (b as any).registerObjectMetadata([{ name: 'reach_t', fields: FIELDS }]);
    expect([...(b as any).tablesWithTimestamps]).toEqual([]);
    await b.create('reach_t', { id: 'skip-boot', title: 'b' } as any, OPTS);

    try {
      const raw = (b as any).knex;
      const rows = await raw.raw(`select id, created_at, "when" from "reach_t" order by id`);
      const byId = Object.fromEntries(
        (Array.isArray(rows) ? rows : [rows]).map((r: any) => [r.id, r]),
      );
      // The row written on the posture where the app-side stamp does NOT run —
      // the one that used to be naive.
      expect(byId['skip-boot'].created_at, 'skipSchemaSync boot created_at').toMatch(ISO_Z);
      expect(byId['skip-boot'].created_at).not.toMatch(NAIVE);
      // Both boot postures now agree, and both agree with the declared sibling.
      expect(byId['ddl-boot'].created_at).toMatch(ISO_Z);
      expect(byId['skip-boot'].when).toMatch(ISO_Z);
    } finally {
      await b.disconnect();
    }
  });

  // ── §6 dialect gate — Postgres and MySQL are untouched ────────────────────
  it('§6 Postgres keeps native now() and MySQL keeps now(3) — compiled without a connection', () => {
    for (const [client, expected] of [
      ['pg', 'CURRENT_TIMESTAMP'],
      ['mysql2', 'CURRENT_TIMESTAMP(3)'],
    ] as const) {
      const k = knexFactory({ client } as any);
      const driver = new SqlDriver({ client, connection: {} } as any);
      (driver as any).knex = k;

      const ddl = k.schema
        .createTable('t', (table: any) => {
          (driver as any).createAuditTimestampColumn(table, 'created_at');
        })
        .toString();

      expect(ddl.toUpperCase()).toContain(expected);
      // The SQLite-only canonical expression must not have leaked across.
      expect(ddl).not.toContain('strftime');
      k.destroy();
    }
  });
});
