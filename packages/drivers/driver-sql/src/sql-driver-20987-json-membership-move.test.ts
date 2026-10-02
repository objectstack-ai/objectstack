// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20987] The move proof for `driver-sql`'s `$contains` / `$notContains`
 * MEMBERSHIP emitter: the statement and its bindings, per dialect and per
 * comparand shape, are the ones this driver emitted before the predicate moved.
 *
 * `jsonMembershipCandidates` and the per-dialect construct (commit e04a0aff2) were
 * module-private here. They moved to `@objectstack/core`
 * (`utils/json-membership-sql.ts`) so the analytics read scope and the
 * analytics `where` ask the same question this driver asks, from one
 * implementation. The core function emits the column and the values through
 * callbacks, and {@link SqlDriver.applyJsonMembership} adapts it with knex's
 * identifier binding, so nothing a caller of this driver sees may change.
 *
 * Every expected statement below was captured from the driver BEFORE the move
 * (base `d1f8ce8658`), compiled through the real filter emitter offline (no
 * connection is opened: knex renders `toSQL()` for each client without one).
 * The construct text is held as one literal per dialect; the comparand shapes
 * cover one candidate, two candidates (a boolean, `null` and number spelling
 * that also denotes a JSON scalar), a canonicalised number (`'1.50'` binds
 * `1.5`), a comparand that is a JS number, a comparand JSON must escape, and a
 * string `Number()` would accept but the JSON grammar refuses (`'0x10'`).
 *
 * `'unknown'` is a knex client this driver does not model (here `mssql`): it
 * keeps the `LIKE` from before commit e04a0aff2, unchanged by the move. The scalar column beside
 * the JSON one is the control: `$contains` stays the substring test there.
 */

import { describe, it, expect, afterAll } from 'vitest';
import type { Knex } from 'knex';
import type { FilterCondition } from '@objectstack/spec/data';
import { SqlDriver, type SqlDriverConfig } from './sql-driver.js';

const TABLE = 't';

/** Compiles a `where` through the driver's real filter emitter and returns what knex renders. */
class MembershipProbe extends SqlDriver {
  declareJsonColumns(table: string, fields: string[]): void {
    this.jsonFields[table] = fields;
  }

  compile(where: FilterCondition): { sql: string; bindings: readonly unknown[] } {
    const builder: Knex.QueryBuilder = this.getKnex()(TABLE).select('*');
    this.applyFilterCondition(builder, where, 'and', TABLE);
    const { sql, bindings } = builder.toSQL();
    return { sql, bindings };
  }
}

/** One comparand, and the JSON scalars the pre-move driver bound for it, in order. */
interface Shape {
  readonly value: string | number;
  readonly candidates: readonly string[];
}

const SHAPES: readonly Shape[] = [
  { value: 'u1', candidates: ['"u1"'] },
  { value: 'say "hi"', candidates: ['"say \\"hi\\""'] },
  { value: 'true', candidates: ['"true"', 'true'] },
  { value: 'null', candidates: ['"null"', 'null'] },
  { value: '1.50', candidates: ['"1.50"', '1.5'] },
  { value: 10, candidates: ['"10"', '10'] },
  { value: '0x10', candidates: ['"0x10"'] },
];

/** A dialect the driver models, with the statement text captured before the move. */
interface Cell {
  readonly dialect: 'sqlite' | 'postgres' | 'mysql';
  readonly config: SqlDriverConfig;
  readonly from: string;
  /** One candidate's membership test, as emitted. */
  readonly member: string;
  readonly nullTest: string;
  /** What the cell binds for one candidate. */
  readonly bound: (candidate: string) => string;
  /** The scalar control: `$contains: 'u1'` on a text column. */
  readonly scalar: { sql: string; bindings: readonly unknown[] };
}

const CELLS: readonly Cell[] = [
  {
    dialect: 'sqlite',
    config: { client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true },
    from: 'select * from `t` where ',
    member:
      "EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(`tags`) THEN `tags` ELSE '[]' END) AS os_member "
      + "WHERE typeof(os_member.key) = 'integer' AND CASE os_member.type "
      + "WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' WHEN 'null' THEN 'null' "
      + 'ELSE json_quote(os_member.value) END = ?)',
    nullTest: '`tags` is null',
    bound: (candidate) => candidate,
    scalar: { sql: 'select * from `t` where instr(`label`, ?) > 0', bindings: ['u1'] },
  },
  {
    dialect: 'postgres',
    config: { client: 'pg', connection: {} } as SqlDriverConfig,
    from: 'select * from "t" where ',
    member: '"tags"::jsonb @> ?::jsonb',
    nullTest: '"tags" is null',
    bound: (candidate) => `[${candidate}]`,
    scalar: { sql: 'select * from "t" where "label" LIKE ? ESCAPE ?', bindings: ['%u1%', '\\'] },
  },
  {
    dialect: 'mysql',
    config: { client: 'mysql2', connection: {} } as SqlDriverConfig,
    from: 'select * from `t` where ',
    member: 'JSON_CONTAINS(`tags`, ?)',
    nullTest: '`tags` is null',
    bound: (candidate) => `[${candidate}]`,
    scalar: { sql: 'select * from `t` where CAST(`label` AS BINARY) LIKE CAST(? AS BINARY) ESCAPE ?', bindings: ['%u1%', '\\'] },
  },
];

const probes: MembershipProbe[] = [];

function probeFor(config: SqlDriverConfig): MembershipProbe {
  // No connection is opened: construction and `toSQL()` are offline.
  const probe = new MembershipProbe(config);
  probe.declareJsonColumns(TABLE, ['tags']);
  probes.push(probe);
  return probe;
}

afterAll(async () => {
  for (const probe of probes) await probe.disconnect().catch(() => {});
});

for (const cell of CELLS) {
  describe(`[#20987] the JSON-column membership statement is unchanged by the move (${cell.dialect})`, () => {
    const probe = probeFor(cell.config);

    it('the probe compiles for the dialect it names', () => {
      expect(probe.dialectName).toBe(cell.dialect);
    });

    for (const shape of SHAPES) {
      const members = shape.candidates.map(() => cell.member).join(' OR ');
      const bindings = shape.candidates.map(cell.bound);

      it(`$contains ${JSON.stringify(shape.value)} emits the pre-move statement and bindings`, () => {
        expect(probe.compile({ tags: { $contains: shape.value } } as FilterCondition)).toEqual({
          sql: `${cell.from}(${members})`,
          bindings,
        });
      });

      it(`$notContains ${JSON.stringify(shape.value)} emits the pre-move NULL-safe negation and bindings`, () => {
        expect(probe.compile({ tags: { $notContains: shape.value } } as FilterCondition)).toEqual({
          sql: `${cell.from}(${cell.nullTest} or NOT (${members}))`,
          bindings,
        });
      });
    }

    it('CONTROL $contains on a scalar text column stays the substring test', () => {
      expect(probe.compile({ label: { $contains: 'u1' } } as FilterCondition)).toEqual(cell.scalar);
    });
  });
}

describe("[#20987] the 'unknown' dialect keeps the pre-#17590 LIKE on a JSON column, unchanged by the move", () => {
  const probe = probeFor({ client: 'mssql', connection: {} } as SqlDriverConfig);

  it('the probe compiles for a client the driver does not model', () => {
    expect(probe.dialectName).toBe('unknown');
  });

  it('$contains binds the escaped substring pattern', () => {
    expect(probe.compile({ tags: { $contains: 'u1' } } as FilterCondition)).toEqual({
      sql: 'select * from [t] where [tags] LIKE ? ESCAPE ?',
      bindings: ['%u1%', '\\'],
    });
  });

  it('$notContains binds the NULL-safe NOT LIKE', () => {
    expect(probe.compile({ tags: { $notContains: '1.50' } } as FilterCondition)).toEqual({
      sql: 'select * from [t] where ([tags] is null or [tags] NOT LIKE ? ESCAPE ?)',
      bindings: ['%1.50%', '\\'],
    });
  });
});
