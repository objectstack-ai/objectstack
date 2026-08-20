// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9350 — the live-dialect matrix files must not be able to share one database.
 *
 * ## Why this suite is structural and not a reproduction
 *
 * The failure it guards against is a `Error: Test timed out in 5000ms.` on live
 * MySQL, seen four times in three days and **zero times in the three days
 * after**. A green CI run therefore proves nothing here — CI was already going
 * green. So this suite does not try to reproduce contention. It asserts the
 * property that makes the contention impossible: **two files resolve two
 * different schemas, and each file's schema derives from the file rather than
 * from a shared constant.**
 *
 * That is checkable without a live server, which matters because a live MySQL
 * cannot be run in an agent container at all.
 *
 * ## What each part is for
 *
 *  - `liveSchemaNameFor` is asserted INJECTIVE over the real list of live files
 *    in this package, read off disk — not over invented inputs. A property that
 *    holds for two hand-written strings and fails for the two files that
 *    actually collide would be the same kind of measurement-of-a-neighbouring-
 *    object that this issue burned two rounds on.
 *  - the identifier-limit case is not decoration: Postgres truncates an
 *    identifier over 63 bytes **silently**, so two long file names could be
 *    truncated back onto one schema and the isolation would evaporate with
 *    nothing red anywhere.
 *  - the source scan is what keeps the property TRUE. Nothing stops a new live
 *    suite from reading `process.env.OS_TEST_MYSQL_URL` and hand-building
 *    `{ client, connection }` again — that is exactly how every file in this
 *    package came to share one database. The scan makes the cell the only
 *    route to a live server.
 *  - the `afterCreate` cases drive the REAL hook out of the REAL config with a
 *    recording connection. They are the only verification the MySQL half can
 *    get without a server, and they are honest about their limit: they prove
 *    which statements are issued, not that a server accepts them.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LIVE_SCHEMA_PREFIX,
  MYSQL_CELL,
  PG_CELL,
  currentLiveSchema,
  liveSchemaNameFor,
} from './live-dialect-matrix.testkit.js';

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** Every test file in this package, as the repo-relative keys the resolver takes. */
const TEST_FILE_KEYS = readdirSync(SRC_DIR)
  .filter((f) => f.endsWith('.test.ts'))
  .sort()
  .map((f) => `packages/drivers/driver-sql/src/${f}`);

/** The identifier ceiling that binds: Postgres 63 bytes, MySQL 64. */
const IDENTIFIER_LIMIT = 63;

describe('live-dialect matrix — per-file schema isolation (#9350)', () => {
  it('has a non-trivial file list to measure over', () => {
    // Guards the vacuous pass: every assertion below iterates this list, so a
    // list that came back empty would report success having checked nothing.
    expect(TEST_FILE_KEYS.length).toBeGreaterThan(50);
  });

  it('gives every test file in this package a DISTINCT schema', () => {
    const byName = new Map<string, string[]>();
    for (const key of TEST_FILE_KEYS) {
      const name = liveSchemaNameFor(key);
      byName.set(name, [...(byName.get(name) ?? []), key]);
    }
    const collisions = [...byName].filter(([, files]) => files.length > 1);
    expect(collisions, `these files would share one database: ${JSON.stringify(collisions)}`)
      .toEqual([]);
    expect(byName.size).toBe(TEST_FILE_KEYS.length);
  });

  it('is deterministic — the same file always resolves the same schema', () => {
    for (const key of TEST_FILE_KEYS.slice(0, 5)) {
      expect(liveSchemaNameFor(key)).toBe(liveSchemaNameFor(key));
    }
  });

  it('derives the name from the WHOLE path, so same-named files in two packages differ', () => {
    const a = 'packages/drivers/driver-sql/src/sql-driver-datetime-mysql-storage.test.ts';
    const b = 'packages/metadata-protocol/src/sql-driver-datetime-mysql-storage.test.ts';
    expect(liveSchemaNameFor(a)).not.toBe(liveSchemaNameFor(b));
  });

  it('stays distinct where the readable slug truncates to the same prefix', () => {
    // The trap: the slug is capped so the whole identifier fits, and a cap is
    // not injective. Two names that agree for the first 40+ characters are the
    // realistic shape of that — `sql-driver-datetime-postgres-timezone` and
    // `sql-driver-upsert-conflict-target-dialects` already truncate today.
    const a = 'packages/drivers/driver-sql/src/sql-driver-a-very-long-live-dialect-name-one.test.ts';
    const b = 'packages/drivers/driver-sql/src/sql-driver-a-very-long-live-dialect-name-two.test.ts';
    const [na, nb] = [liveSchemaNameFor(a), liveSchemaNameFor(b)];
    expect(na.slice(0, 40)).toBe(nb.slice(0, 40)); // the fixture is vacuous otherwise
    expect(na).not.toBe(nb);
  });

  it('fits both dialects’ identifier limits, and is DDL-safe by construction', () => {
    for (const key of TEST_FILE_KEYS) {
      const name = liveSchemaNameFor(key);
      expect(name.length, `${name} exceeds the ${IDENTIFIER_LIMIT}-byte limit`)
        .toBeLessThanOrEqual(IDENTIFIER_LIMIT);
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(name.startsWith(LIVE_SCHEMA_PREFIX)).toBe(true);
    }
  });

  it('resolves the CURRENT file, from vitest’s testPath rather than an argument', () => {
    // `currentLiveSchema()` takes nothing, so there is no parameter a copy-paste
    // could carry over from the file it was copied from.
    expect(currentLiveSchema()).toBe(
      liveSchemaNameFor('packages/drivers/driver-sql/src/live-dialect-matrix.isolation.test.ts'),
    );
  });
});

describe('live-dialect matrix — the cell is the only route to a live server (#9350)', () => {
  /** Source with line and block comments removed, so prose about the env var is not a hit. */
  const codeOf = (file: string): string =>
    readFileSync(join(SRC_DIR, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');

  /**
   * This file, and only this file.
   *
   * The scan matched ITSELF on first run — the pattern it searches for is a
   * regex literal in its own source. Excluding a file from the scan is exactly
   * the shape of hole the scan exists to prevent, so the exclusion is pinned by
   * the next case rather than trusted: this suite opens no connection at all,
   * so it cannot be a live file however it spells the env var.
   */
  const SCANNER = 'live-dialect-matrix.isolation.test.ts';

  it('no test file in this package reads OS_TEST_*_URL directly', () => {
    const offenders = TEST_FILE_KEYS
      .map((k) => k.slice(k.lastIndexOf('/') + 1))
      .filter((f) => f !== SCANNER)
      .filter((f) => /process\.env\.OS_TEST_(POSTGRES|MYSQL)_URL/.test(codeOf(f)));
    expect(
      offenders,
      'these read the env var directly, which is one value for the whole process and puts ' +
        'every reader in the SAME database (#9350). Use MYSQL_CELL / PG_CELL from ' +
        'live-dialect-matrix.testkit.ts: `cell.url` for skipIf, `cell.config()` to connect.',
    ).toEqual([]);
  });

  it('the one excluded file cannot itself be a live suite', () => {
    // What earns the exclusion: no driver, no knex, no connection. If this ever
    // stops holding, the exclusion stops being safe and this goes red first.
    //
    // The needles are ASSEMBLED rather than written as literals, because a
    // literal would appear in this file and the case would match itself — the
    // same self-reference that made the scan above flag its own source on its
    // first run, and the reason the exclusion exists at all.
    const own = codeOf(SCANNER);
    const needle = (head: string, tail: string) => new RegExp(head + tail);
    expect(own).not.toMatch(needle('new ', 'SqlDriver'));
    expect(own).not.toMatch(needle('knex', '\\('));
    expect(own).not.toMatch(needle('\\.', 'connect\\('));
    expect(own).not.toMatch(needle('driver', '\\.execute'));
  });

  it('the testkit itself is the one place that reads them', () => {
    const testkit = readFileSync(join(SRC_DIR, 'live-dialect-matrix.testkit.ts'), 'utf8');
    expect(testkit).toContain('process.env.OS_TEST_POSTGRES_URL');
    expect(testkit).toContain('process.env.OS_TEST_MYSQL_URL');
  });
});

/** A knex pool connection that records the SQL a hook issues instead of running it. */
function recordingConnection(): { sql: string[]; conn: any } {
  const sql: string[] = [];
  const conn = {
    query(text: string, cb: (err: unknown) => void) {
      sql.push(text);
      cb(null);
    },
  };
  return { sql, conn };
}

async function runAfterCreate(config: any): Promise<string[]> {
  const { sql, conn } = recordingConnection();
  const afterCreate = config.pool?.afterCreate;
  expect(typeof afterCreate, 'the live config carries no afterCreate hook').toBe('function');
  await new Promise<void>((resolve, reject) => {
    afterCreate(conn, (err: unknown) => (err ? reject(err) : resolve()));
  });
  return sql;
}

describe('live-dialect matrix — what each dialect issues to isolate itself (#9350)', () => {
  const schema = liveSchemaNameFor(
    'packages/drivers/driver-sql/src/live-dialect-matrix.isolation.test.ts',
  );

  it('postgres: knex is pointed at the file’s schema, which the hook creates', async () => {
    const config: any = PG_CELL.config();
    expect(config.client).toBe('pg');
    expect(config.searchPath).toEqual([schema]);
    expect(await runAfterCreate(config)).toEqual([
      `create schema if not exists "${schema}"`,
      `set search_path to "${schema}"`,
    ]);
  });

  it('mysql: the session is moved into the file’s own database', async () => {
    // MySQL has no schema-inside-a-database, so the database IS the unit. `use`
    // rather than a rewritten URL keeps `database()` — which several suites
    // compare `information_schema.columns` against — reporting the isolated one.
    const config: any = MYSQL_CELL.config();
    expect(config.client).toBe('mysql2');
    expect(await runAfterCreate(config)).toEqual([
      `create database if not exists \`${schema}\``,
      `use \`${schema}\``,
    ]);
  });

  it('runs the hook on EVERY pooled connection, not just the first', async () => {
    // A pool opens connections lazily and forever: a connection created late in
    // a file must land in the same schema as the first one, or half the file
    // silently runs against the shared default database.
    const config: any = PG_CELL.config();
    expect(await runAfterCreate(config)).toEqual(await runAfterCreate(config));
  });

  it('the two live dialects do not resolve to one shared name', () => {
    // Same file, so the NAME is deliberately shared across dialects — what must
    // not happen is two FILES sharing one. This pins the axis the isolation is
    // on, so a future edit that keyed off the dialect instead of the file is red.
    const other = liveSchemaNameFor('packages/drivers/driver-sql/src/some-other-live.test.ts');
    expect(other).not.toBe(schema);
  });
});
