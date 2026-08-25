// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11377] A cross-schema foreign key is QUALIFIED by `referencedSchema`;
 * `referencedTable` stays a bare name always.
 *
 * Maintainer ruling (2026-08-24, on the card): `IntrospectedForeignKey` gains
 * an optional `referencedSchema`, filled when — and only when — the parent
 * lives outside the session's resolution scope; `referencedTable` stays a
 * BARE name unconditionally (a conditionally-qualified spelling was rejected
 * as a trap, and omitting the constraint was rejected as hiding truth).
 *
 * Until #11324 this fact was unreachable on Postgres: a cross-schema foreign
 * key contributed zero rows. Repairing that made the constraint visible under
 * a bare name the session's `search_path` does not resolve — true of the
 * constraint, unusable as an address, and (the #11201 family) collidable with
 * a same-named table in the current schema. The consumer half of the same
 * ruling lives in `@objectstack/objectql`'s
 * `convertIntrospectedSchemaToObjects`, which refuses to wire a lookup to a
 * bare name whose answer carries `referencedSchema`.
 *
 * ## The two presence pins are both non-vacuous only WITH their controls
 *
 * "The cross-schema answer carries the key" goes green for free if the far
 * schema collapsed onto the session's own (a truncated identifier, a `create
 * schema` that landed elsewhere), and "the in-path answer omits the key" goes
 * green for free if the in-path parent were accidentally out of path. So each
 * suite first reads the catalog — which schema each parent REALLY sits in,
 * and what the session's resolution scope REALLY is — before asserting either
 * shape. Absence is asserted with `toStrictEqual` + an `Object.keys` read:
 * `toEqual` treats `{ referencedSchema: undefined }` and `{}` as the same
 * object, and the contract is that the KEY is absent, not `undefined`.
 *
 * ## Cells
 *
 * - **Postgres** (live): the card's measured shape — parent in a schema off
 *   the `search_path`, sibling in-path parent as the unchanged control.
 * - **MySQL** (live): the symmetric fact — InnoDB permits a foreign key into
 *   another DATABASE, `KEY_COLUMN_USAGE.REFERENCED_TABLE_SCHEMA` names it,
 *   and the session's resolution scope for a bare name is `DATABASE()`.
 * - **MySQL** (emission probe, no server — the #11379 pattern): pins that the
 *   arm's one statement PROJECTS the qualification and that the TS mapping
 *   emits the key present-or-absent by row value. This half runs in every CI
 *   job, so the mapping cannot regress in the jobs that have no live server.
 * - **SQLite**: no cell, deliberately. SQLite has no schemas and a foreign
 *   key cannot cross an ATTACHed database, so the fact this key carries
 *   cannot exist there — there is nothing to measure, and the arm never sets
 *   the key (see the interface TSDoc).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import {
  MYSQL_CELL,
  PG_CELL,
  currentLiveSchema,
  declareDialectCell,
  type DialectCell,
} from './live-dialect-matrix.testkit.js';

const MATRIX = 'introspectForeignKeys cross-schema qualification';

/** The child, in the session's own resolution scope. */
const CROSS_CHILD = 'os11377_cross_child';
/** The cross-schema parent — deliberately OUTSIDE the session's scope. */
const REMOTE_PARENT = 'os11377_remote_parent';
/** The in-path parent — the unchanged-shape control. */
const LOCAL_PARENT = 'os11377_local_parent';
const FK_CROSS = 'os11377_fk_cross';
const FK_LOCAL = 'os11377_fk_local';

/** `introspectForeignKeys` is `protected`; this is the narrowest way to reach it. */
class ForeignKeyProbeDriver extends SqlDriver {
  foreignKeys(table: string) {
    return this.introspectForeignKeys(table);
  }
}

// ── Postgres: the card's measured shape ──────────────────────────────────────

function declarePgSuite(cell: DialectCell): void {
  describe(`introspectForeignKeys cross-schema qualification — ${cell.label} (#11377)`, () => {
    let driver: ForeignKeyProbeDriver;
    /** This file's own schema (#9350) — the only one on `search_path`. */
    let here: string;
    /** Where the cross-schema parent lives. Created by this file, dropped by it. */
    let far: string;

    beforeAll(async () => {
      driver = new ForeignKeyProbeDriver(cell.config());
      here = currentLiveSchema();
      far = `${here}_far`;
      // Postgres TRUNCATES an over-long identifier silently, which would fold
      // the far schema back onto this file's own and delete the cross-schema
      // condition this suite exists to measure.
      expect(
        far.length,
        `the parent schema name ${far} exceeds Postgres' 63-byte identifier limit and would be ` +
          `silently truncated onto ${here} — shorten the suffix`,
      ).toBeLessThanOrEqual(63);

      await driver.execute(`drop schema if exists "${far}" cascade`);
      await driver.execute(`create schema "${far}"`);

      await driver.execute(`drop table if exists ${CROSS_CHILD} cascade`);
      await driver.execute(`drop table if exists ${LOCAL_PARENT} cascade`);
      await driver.execute(`create table "${far}".${REMOTE_PARENT} (id varchar(64) primary key)`);
      await driver.execute(`create table ${LOCAL_PARENT} (id varchar(64) primary key)`);
      await driver.execute(
        `create table ${CROSS_CHILD} (
           id varchar(64) primary key,
           p varchar(64),
           q varchar(64),
           constraint ${FK_CROSS} foreign key (p) references "${far}".${REMOTE_PARENT} (id),
           constraint ${FK_LOCAL} foreign key (q) references ${LOCAL_PARENT} (id)
         )`,
      );
    });

    afterAll(async () => {
      await driver.execute(`drop schema if exists "${far}" cascade`).catch(() => {});
      for (const t of [CROSS_CHILD, LOCAL_PARENT]) {
        await driver.execute(`drop table if exists ${t} cascade`).catch(() => {});
      }
      await driver.disconnect().catch(() => {});
    });

    it('control: one parent is really out of path, the other really on it', async () => {
      // Part one — where the three tables really sit, read straight from the
      // catalog rather than through the method under test.
      const placed: any = await driver.execute(
        `select n.nspname, c.relname
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.relname in (?, ?, ?)
          order by c.relname`,
        [CROSS_CHILD, REMOTE_PARENT, LOCAL_PARENT],
      );
      expect(
        placed.rows.map((r: any) => `${r.nspname}.${r.relname}`),
        `the fixture collapsed — presence/absence of referencedSchema would then be measuring ` +
          `nothing`,
      ).toEqual([
        `${here}.${CROSS_CHILD}`,
        `${here}.${LOCAL_PARENT}`,
        `${far}.${REMOTE_PARENT}`,
      ]);

      // Part two — the session's OWN resolution scope: `here` is on it, `far`
      // is not. This is the exact predicate the fix's CASE asks, so if the
      // cell's searchPath config ever changed shape, this reds with the reason
      // rather than letting both pins go vacuous.
      const scope: any = await driver.execute(`select current_schemas(false) as path`);
      const path: string[] = scope.rows[0].path;
      expect(path, 'the file schema must be the session scope').toContain(here);
      expect(path, `the far schema must NOT be on the session scope`).not.toContain(far);
    });

    it('qualifies the cross-schema key with referencedSchema and keeps referencedTable bare', async () => {
      const foreignKeys = await driver.foreignKeys(CROSS_CHILD);

      // `toStrictEqual`, deliberately: the in-path record must not carry the
      // key AT ALL — `toEqual` would accept `referencedSchema: undefined`.
      expect(
        foreignKeys,
        `${cell.label}: the ${far} parent must be qualified by referencedSchema and the ` +
          `in-path parent must stay byte-identical to the pre-#11377 shape`,
      ).toStrictEqual([
        {
          columnName: 'p',
          referencedTable: REMOTE_PARENT,
          referencedColumn: 'id',
          constraintName: FK_CROSS,
          referencedSchema: far,
        },
        {
          columnName: 'q',
          referencedTable: LOCAL_PARENT,
          referencedColumn: 'id',
          constraintName: FK_LOCAL,
        },
      ]);

      // The ruling's "bare name ALWAYS", named: qualification is the separate
      // key, never a spelling change of referencedTable.
      const cross = foreignKeys[0]!;
      expect(cross.referencedTable).toBe(REMOTE_PARENT);
      expect(cross.referencedTable).not.toContain('.');

      // Key ABSENCE on the in-path record, asserted on its own so a future
      // matcher swap cannot silently weaken it.
      const inPath = foreignKeys[1]!;
      expect(Object.keys(inPath)).not.toContain('referencedSchema');
    });

    it('carries the qualification through `introspectSchema`, the in-tree consumer seam', async () => {
      const schema = await driver.introspectSchema();

      expect(Object.keys(schema.tables)).toContain(CROSS_CHILD);
      const keys = schema.tables[CROSS_CHILD].foreignKeys;
      expect(keys.find((k) => k.columnName === 'p')?.referencedSchema).toBe(far);
      const local = keys.find((k) => k.columnName === 'q')!;
      expect(Object.keys(local)).not.toContain('referencedSchema');
    });
  });
}

declareDialectCell(PG_CELL, MATRIX, declarePgSuite);

// ── MySQL: the symmetric fact, on a live server ──────────────────────────────

function declareMysqlSuite(cell: DialectCell): void {
  describe(`introspectForeignKeys cross-schema qualification — ${cell.label} (#11377)`, () => {
    let driver: ForeignKeyProbeDriver;
    /** This file's own database (#9350) — the session's `DATABASE()`. */
    let here: string;
    /** Where the cross-database parent lives. Created by this file, dropped by it. */
    let far: string;

    beforeAll(async () => {
      driver = new ForeignKeyProbeDriver(cell.config());
      here = currentLiveSchema();
      far = `${here}_far`;
      // MySQL's identifier limit is 64; a silent fold-back is not the failure
      // shape there (CREATE DATABASE errors instead), but the guard keeps the
      // fixture honest for the same reason as the PG suite's.
      expect(far.length).toBeLessThanOrEqual(64);

      await driver.execute(`drop database if exists ${far}`);
      await driver.execute(`create database ${far}`);

      await driver.execute(`drop table if exists ${CROSS_CHILD}`);
      await driver.execute(`drop table if exists ${LOCAL_PARENT}`);
      await driver.execute(
        `create table ${far}.${REMOTE_PARENT} (id varchar(64) primary key) engine=InnoDB`,
      );
      await driver.execute(`create table ${LOCAL_PARENT} (id varchar(64) primary key) engine=InnoDB`);
      await driver.execute(
        `create table ${CROSS_CHILD} (
           id varchar(64) primary key,
           p varchar(64),
           q varchar(64),
           constraint ${FK_CROSS} foreign key (p) references ${far}.${REMOTE_PARENT} (id),
           constraint ${FK_LOCAL} foreign key (q) references ${LOCAL_PARENT} (id)
         ) engine=InnoDB`,
      );
    });

    afterAll(async () => {
      await driver.execute(`drop table if exists ${CROSS_CHILD}`).catch(() => {});
      await driver.execute(`drop table if exists ${LOCAL_PARENT}`).catch(() => {});
      await driver.execute(`drop database if exists ${far}`).catch(() => {});
      await driver.disconnect().catch(() => {});
    });

    it('control: the parent really is in another database, and DATABASE() is this file\'s own', async () => {
      const placed: any = await driver.execute(
        `select TABLE_SCHEMA as s, TABLE_NAME as t
           from information_schema.TABLES
          where TABLE_NAME in (?, ?, ?)
          order by TABLE_NAME`,
        [CROSS_CHILD, REMOTE_PARENT, LOCAL_PARENT],
      );
      expect(
        placed[0].map((r: any) => `${r.s}.${r.t}`),
        `the fixture collapsed into one database — presence/absence of referencedSchema would ` +
          `then be measuring nothing`,
      ).toEqual([`${here}.${CROSS_CHILD}`, `${here}.${LOCAL_PARENT}`, `${far}.${REMOTE_PARENT}`]);

      const db: any = await driver.execute(`select DATABASE() as d`);
      expect(db[0][0].d, 'the session scope must be the file database').toBe(here);
    });

    it('qualifies the cross-database key with referencedSchema and keeps referencedTable bare', async () => {
      const foreignKeys = await driver.foreignKeys(CROSS_CHILD);

      const byColumn = Object.fromEntries(foreignKeys.map((k) => [k.columnName, k]));
      expect(Object.keys(byColumn).sort()).toEqual(['p', 'q']);

      expect(byColumn.p).toStrictEqual({
        columnName: 'p',
        referencedTable: REMOTE_PARENT,
        referencedColumn: 'id',
        constraintName: FK_CROSS,
        referencedSchema: far,
      });
      expect(byColumn.p!.referencedTable).not.toContain('.');

      expect(byColumn.q).toStrictEqual({
        columnName: 'q',
        referencedTable: LOCAL_PARENT,
        referencedColumn: 'id',
        constraintName: FK_LOCAL,
      });
      expect(Object.keys(byColumn.q!)).not.toContain('referencedSchema');
    });
  });
}

declareDialectCell(MYSQL_CELL, MATRIX, declareMysqlSuite);

// ── MySQL: the mapping, with no server (the #11379 emission-probe pattern) ───

/** One row of `KEY_COLUMN_USAGE` as the MySQL arm's projection aliases it. */
interface FkRow {
  column_name: string;
  referenced_table: string;
  referenced_column: string;
  constraint_name: string;
  referenced_schema: string | null;
}

/**
 * A driver that DECLARES MySQL and answers from a canned result set — the
 * documented `MysqlFkEmissionProbe` shape from the #11379 pin, reused so the
 * projection and the TS mapping stay pinned in the CI jobs that provision no
 * live MySQL. See that file for why re-declaring the client is the real
 * dispatch path and not a hole.
 */
class MysqlFkQualificationProbe extends SqlDriver {
  readonly emitted: { sql: string; bindings: unknown }[] = [];

  constructor(private readonly rows: FkRow[]) {
    super({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    (this.config as { client?: string }).client = 'mysql2';

    const knex = this.knex as unknown as Record<string, unknown>;
    Object.defineProperty(knex, 'raw', {
      configurable: true,
      value: (sql: unknown, bindings: unknown) => {
        this.emitted.push({ sql: String(sql), bindings });
        return [this.rows, []];
      },
    });
  }

  foreignKeys(table: string) {
    return this.introspectForeignKeys(table);
  }

  soleStatement(): string {
    expect(
      this.emitted.length,
      'introspectForeignKeys emitted no statement, or more than one — the ' +
        'capture below would be measuring nothing. Did the dialect dispatch ' +
        'stop reaching the MySQL arm?',
    ).toBe(1);
    return this.emitted[0]!.sql;
  }
}

describe('introspectForeignKeys (MySQL) projects and maps the qualification (#11377)', () => {
  let probe: MysqlFkQualificationProbe | undefined;

  afterEach(async () => {
    await (probe as unknown as { knex?: { destroy(): Promise<void> } } | undefined)?.knex?.destroy();
    probe = undefined;
  });

  it('emits the null-safe REFERENCED_TABLE_SCHEMA vs DATABASE() projection', async () => {
    probe = new MysqlFkQualificationProbe([]);
    await probe.foreignKeys('cross_child');

    const sql = probe.soleStatement();

    // Control first: the captured statement really is this method's
    // foreign-key read (the #11379 file says why a file-level grep cannot be
    // trusted here — the literal appears in sibling reads too).
    expect(sql).toMatch(/information_schema\.KEY_COLUMN_USAGE/i);
    expect(sql).toMatch(/REFERENCED_TABLE_NAME IS NOT NULL/i);

    // The pin: the projection carries the qualification, null-safely — with
    // no default database, NO bare name resolves, so every parent qualifies.
    expect(sql).toMatch(/REFERENCED_TABLE_SCHEMA\s*<=>\s*DATABASE\(\)/i);
    expect(sql).toMatch(/referenced_schema/);
  });

  it('maps a qualified row to referencedSchema and an in-database row to key ABSENCE', async () => {
    probe = new MysqlFkQualificationProbe([
      {
        column_name: 'p',
        referenced_table: 'remote_parent',
        referenced_column: 'id',
        constraint_name: 'fk_cross',
        referenced_schema: 'far_db',
      },
      {
        column_name: 'q',
        referenced_table: 'local_parent',
        referenced_column: 'id',
        constraint_name: 'fk_local',
        referenced_schema: null,
      },
    ]);
    const keys = await probe.foreignKeys('cross_child');

    expect(keys).toStrictEqual([
      {
        columnName: 'p',
        referencedTable: 'remote_parent',
        referencedColumn: 'id',
        constraintName: 'fk_cross',
        referencedSchema: 'far_db',
      },
      {
        columnName: 'q',
        referencedTable: 'local_parent',
        referencedColumn: 'id',
        constraintName: 'fk_local',
      },
    ]);
    expect(Object.keys(keys[1]!)).not.toContain('referencedSchema');
  });
});
