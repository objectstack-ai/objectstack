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

import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { SqlDriver } from '../src/index.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LIVE_SCHEMA_PREFIX,
  MYSQL_CELL,
  PG_CELL,
  currentLiveSchema,
  liveSchemaLedger,
  liveSchemaNameFor,
  mysqlUrlForSchema,
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
   * The needle is ASSEMBLED rather than written as a literal.
   *
   * Written out, it appears in this file's own source and the scan flags
   * ITSELF — which it did, on its first run. An exclusion list was the first
   * fix and the wrong one: excluding a file from the scan is the exact shape of
   * hole the scan exists to close, and this file has since become a live suite
   * itself, which would have made the exclusion actively wrong.
   */
  const ENV_READ = new RegExp('process' + '\\.env\\.OS_TEST_(POSTGRES|MYSQL)_URL');

  it('no test file in this package reads OS_TEST_*_URL directly', () => {
    const offenders = TEST_FILE_KEYS
      .map((k) => k.slice(k.lastIndexOf('/') + 1))
      .filter((f) => ENV_READ.test(codeOf(f)));
    expect(
      offenders,
      'these read the env var directly, which is one value for the whole process and puts ' +
        'every reader in the SAME database (#9350). Use MYSQL_CELL / PG_CELL from ' +
        'live-dialect-matrix.testkit.ts: `cell.url` for skipIf, `cell.config()` to connect.',
    ).toEqual([]);
  });

  it('the scan can still see a violation — it is not matching nothing', () => {
    // Without this, an ENV_READ that silently stopped matching would report a
    // clean scan forever. The negative case, stated: the pattern must hit a
    // string that DOES read the env var.
    // assembled for the same reason the needle is — a literal here is itself a
    // violation, and the scan would flag this file
    expect(ENV_READ.test('const U = process' + '.env.OS_TEST_MYSQL_URL;')).toBe(true);
    expect(ENV_READ.test('const U = MYSQL_CELL.url;')).toBe(false);
  });

  it('the testkit itself is the one place that reads them', () => {
    const testkit = readFileSync(join(SRC_DIR, 'live-dialect-matrix.testkit.ts'), 'utf8');
    // assembled, like every other spelling of these names in this file
    expect(testkit).toContain('process' + '.env.OS_TEST_POSTGRES_URL');
    expect(testkit).toContain('process' + '.env.OS_TEST_MYSQL_URL');
  });
});

describe('live-dialect matrix — how each dialect is pointed at its own schema (#9350)', () => {
  const schema = liveSchemaNameFor(
    'packages/drivers/driver-sql/src/live-dialect-matrix.isolation.test.ts',
  );

  it('mysql: the file’s database is named in the CONNECTION, not switched into later', () => {
    // The distinction is the defect this replaced, and it is worth an assertion
    // rather than a comment. With `use`, the SESSION moved but knex's
    // `client.database()` kept returning the URL's database — and knex binds
    // THAT into `columnInfo`, so the driver read columns from `conformance` for
    // a table it had just created elsewhere and emitted `alter table … add
    // <column>` for columns already present. Measured on a live MariaDB 10.11:
    // 18 tests red, all *Duplicate column name* or a missing UNIQUE index.
    const rewritten = mysqlUrlForSchema('mysql://root:root@127.0.0.1:3306/conformance', schema);
    expect(new URL(rewritten).pathname).toBe(`/${schema}`);
  });

  it('mysql: only the database segment moves — host, port and credentials are the runner’s', () => {
    const from = new URL('mysql://runner:s3cret@db.internal:3307/conformance');
    const to = new URL(mysqlUrlForSchema(from.toString(), schema));
    expect([to.protocol, to.host, to.username, to.password]).toEqual([
      from.protocol, from.host, from.username, from.password,
    ]);
    expect(to.pathname).not.toBe(from.pathname);
  });

  it.skipIf(!MYSQL_CELL.available)(
    'mysql: the provisioned cell connects to this file’s database, with no pool hook',
    () => {
      const config: any = MYSQL_CELL.config();
      expect(config.client).toBe('mysql2');
      expect(typeof config.connection, 'a URL string, so the driver’s connect handling applies')
        .toBe('string');
      expect(new URL(config.connection).pathname).toBe(`/${schema}`);
      // nothing switches databases behind knex's back
      expect(config.pool?.afterCreate).toBeUndefined();
    },
  );

  it('postgres: knex is pointed at the file’s schema', () => {
    const config: any = PG_CELL.config();
    expect(config.client).toBe('pg');
    expect(config.searchPath).toEqual([schema]);
  });

  it('two different files do not resolve to one shared name', () => {
    const other = liveSchemaNameFor('packages/drivers/driver-sql/src/some-other-live.test.ts');
    expect(other).not.toBe(schema);
  });
});

describe('live-dialect matrix — the globalSetup creates what the cells connect to (#9350)', () => {
  // The ordering constraint the connection-named database buys: MySQL refuses
  // the handshake for a database that does not exist, so a file whose schema the
  // globalSetup never created fails at connect. One derivation feeds both, and
  // this asserts it really is one.
  it('the ledger covers every test file in the package, with distinct schemas', () => {
    const ledger = liveSchemaLedger();
    expect(ledger.length).toBe(TEST_FILE_KEYS.length);
    expect(new Set(ledger.map((e) => e.schema)).size).toBe(ledger.length);
  });

  it('the ledger’s name for a file is the same one that file resolves for itself', () => {
    const own = liveSchemaLedger().find((e) => e.file === 'live-dialect-matrix.isolation.test.ts');
    expect(own?.schema).toBe(currentLiveSchema());
  });

  it('the cells connect to a schema the ledger knows', () => {
    const known = new Set(liveSchemaLedger().map((e) => e.schema));
    expect(known.has((PG_CELL.config() as any).searchPath[0])).toBe(true);
    expect(known.has(new URL(mysqlUrlForSchema('mysql://u:p@h:3306/c', currentLiveSchema()))
      .pathname.slice(1))).toBe(true);
  });
});

describe('live-dialect matrix — the driver can SEE its own isolated schema (#9350)', () => {
  // The other half of per-file isolation, and the half that fails silently.
  //
  // Moving the suites into their own schema is only safe if the driver's
  // introspection follows them there. Postgres' index read pinned the schema
  // literally (`n.nspname = 'public'`), so under an isolated search_path it
  // returned `[]` for a table that measurably HAD a primary key and a declared
  // unique index — and `[]` does not read as "I could not see", it reads as
  // "there are no indexes", which `assertConflictTargetHonoured` turns into a
  // refusal. A fail-open on an identity check, invisible to every existing test
  // because the suites that exercise that path are MySQL-gated.
  //
  // Needs a live Postgres: this asserts what the SERVER reports, which is the
  // only place the defect existed.
  let driver: SqlDriver | undefined;
  const TABLE = 'os9350_introspection_probe';

  afterEach(async () => {
    await driver?.execute(`drop table if exists ${TABLE}`).catch(() => {});
    await driver?.disconnect().catch(() => {});
    driver = undefined;
  });

  it.skipIf(!PG_CELL.available)(
    'postgres: index introspection reports the indexes that exist in the file’s schema',
    async () => {
      driver = new SqlDriver(PG_CELL.config());
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.initObjects([
        { name: TABLE, fields: { email: { type: 'string', unique: true } } },
      ] as any);

      // What the server says is really there — the control the assertion is
      // measured against, so a green here cannot mean "nothing was created".
      const live: any = await driver.execute(
        `select i.relname as name
           from pg_index ix
           join pg_class i on i.oid = ix.indexrelid
          where ix.indrelid = to_regclass(?)`,
        [TABLE] as any,
      );
      const actual = (live.rows ?? live).map((r: any) => r.name).sort();
      expect(actual.length, 'fixture is vacuous unless the table really has indexes')
        .toBeGreaterThanOrEqual(2);

      const seen = await (driver as any).introspectIndexes(TABLE);
      expect(
        seen.map((i: any) => i.name).sort(),
        'the driver read a different set of indexes than the server holds — it is looking in ' +
          'another schema, and an empty read here becomes a silent upsert refusal',
      ).toEqual(actual);
      expect(seen.some((i: any) => i.primary)).toBe(true);
      expect(seen.some((i: any) => i.unique && !i.primary)).toBe(true);
    },
  );

  it.skipIf(!PG_CELL.available)(
    'postgres: schema introspection lists a table created in the file’s schema',
    async () => {
      driver = new SqlDriver(PG_CELL.config());
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.initObjects([{ name: TABLE, fields: { email: { type: 'string' } } }] as any);
      const introspected = await driver.introspectSchema();
      expect(Object.keys(introspected.tables ?? {})).toContain(TABLE);
    },
  );
});
