// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A comparand keeps its own TYPE, end to end — #5526.
 *
 * `filter-normalizer` used to carry `values: string[]`, so every comparand was
 * flattened to a string on the way in (`stringifyForCube`) and GUESSED back into
 * a type on the way out (`recoverNumber`, behind `coerceFilterValueForSql` /
 * `coerceFilterValueForObjectQL`). An all-strings encoding has no escape, so
 * author strings collided with the tokens the encoder wrote for other types.
 * Measured on `main` for `{code: {$eq: v}}` — #5526's table:
 *
 *   | author's `v` | leaf values  | SQL bind      | engine bind |
 *   |---|---|---|---|
 *   | `'007'`  | `["007"]`  | `7` → fixed by #5528 | `7` → fixed by #5528 |
 *   | `'1.50'` | `["1.50"]` | `1.5` → fixed by #5528 | `1.5` → fixed by #5528 |
 *   | `'null'` | `["null"]` | real `NULL`   | real `null` |
 *   | `'true'` | `["true"]` | `1`           | `true`      |
 *
 * `values` is now `unknown[]`: the author's value travels untouched and NOTHING
 * decodes it. So this file no longer tests a decoder — there is none. It tests
 * the property that replaced it, on every consumer that reads a leaf:
 *
 *   1. the leaf carries `v` ITSELF;
 *   2. the SQL path binds `v`, converted only where a driver cannot bind the JS
 *      type (`boolean` → `1`/`0`, `Date` → ISO) — never by re-reading a string;
 *   3. the engine path binds `v` with no conversion at all;
 *   4. the row sets that follow, against a TEXT column with DECOY rows.
 *
 * # Provenance — this file is #5528's asset, carried forward
 *
 * It was `filter-value-canonical-number.test.ts`, which pinned the narrowed
 * decoder #5528 shipped as an explicit stopgap. Every case of that file survives
 * here, upgraded from "what does `coerceFilterValueForSql('007')` return" to the
 * end-to-end question, because the function it named is gone and the scenario is
 * not. Two blocks changed VERDICT rather than form, and both are the point of
 * #5526:
 *
 *   - the `'null'` / `'true'` / `'false'` collision, pinned there as UNCHANGED
 *     ("route A/B in #5526"), is now pinned as FIXED;
 *   - `{score: {$gte: '80'}}` bound the number `80` (`native-sql-datetime-filter`
 *     pinned that too); it now binds the string the author wrote. The DB's own
 *     type resolution decides the comparison, which is the whole reason a
 *     consumer must not guess: SQLite applies the column's numeric affinity, and
 *     Postgres infers the parameter's type from the column.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Cube, FilterCondition } from '@objectstack/spec/data';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';
import { DatasetSchema } from '@objectstack/spec/ui';

import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import { ObjectQLStrategy } from '../strategies/objectql-strategy.js';
import {
  normalizeAnalyticsFilterTree,
  toSqlBindValue,
} from '../strategies/filter-normalizer.js';
import { AnalyticsService } from '../analytics-service.js';

// ── 1. Encode + bind, comparand by comparand ─────────────────────────────────

/**
 * `leaf` is what the tree must carry, `sql` what the SQL path must bind, `engine`
 * what `engine.aggregate` must receive.
 *
 * The two consumers differ in exactly ONE place — a boolean, which SQL spells
 * `1`/`0` because better-sqlite3 refuses a JS boolean and the engine needs the
 * real thing to match a stored boolean. Every other row carries the same value
 * three times over, and that identity IS the invariant: a divergence means
 * something re-typed the author's value on one path.
 */
const CASES: Array<{
  name: string;
  value: unknown;
  leaf: unknown;
  sql: unknown;
  engine: unknown;
  why: string;
}> = [
  // ── #5526's headline: the tokens the old encoder owned ──────────────────────
  {
    name: "the author string 'null'",
    value: 'null',
    leaf: 'null',
    sql: 'null',
    engine: 'null',
    why: 'was real NULL on both paths — every comparison UNKNOWN, so the widget could never draw a row',
  },
  {
    name: "the author string 'true'",
    value: 'true',
    leaf: 'true',
    sql: 'true',
    engine: 'true',
    why: 'was 1 (SQL) / true (engine) — a text column storing "true" stopped matching',
  },
  {
    name: "the author string 'false'",
    value: 'false',
    leaf: 'false',
    sql: 'false',
    engine: 'false',
    why: 'was 0 (SQL) / false (engine)',
  },

  // ── #5528's rows: information `Number()` would have destroyed ──────────────
  { name: "'007'", value: '007', leaf: '007', sql: '007', engine: '007', why: 'leading zeros — order number / SKU (was 7 before #5528)' },
  { name: "'0912'", value: '0912', leaf: '0912', sql: '0912', engine: '0912', why: 'leading zero — dialling code (was 912)' },
  { name: "'1.50'", value: '1.50', leaf: '1.50', sql: '1.50', engine: '1.50', why: 'trailing zero — price string (was 1.5)' },
  { name: "'1.0'", value: '1.0', leaf: '1.0', sql: '1.0', engine: '1.0', why: 'trailing zero (was 1)' },
  { name: "'-0'", value: '-0', leaf: '-0', sql: '-0', engine: '-0', why: 'the sign is lost by Number() (was 0)' },
  {
    name: "'12345678901234567890'",
    value: '12345678901234567890',
    leaf: '12345678901234567890',
    sql: '12345678901234567890',
    engine: '12345678901234567890',
    why: 'more digits than a double holds (was 12345678901234567000)',
  },
  {
    name: "'1000000000000000000000'",
    value: '1000000000000000000000',
    leaf: '1000000000000000000000',
    sql: '1000000000000000000000',
    engine: '1000000000000000000000',
    why: 'canonical form of 1e21 is exponential, so the digits round-tripped lossily (was 1e21)',
  },
  // Strings #5528's regex already refused. They were strings then and are
  // strings now — by construction rather than by a regex, which is the change.
  { name: "'1e3'", value: '1e3', leaf: '1e3', sql: '1e3', engine: '1e3', why: 'exponent' },
  { name: "'1e+21'", value: '1e+21', leaf: '1e+21', sql: '1e+21', engine: '1e+21', why: 'canonical String(1e21), and still a string' },
  { name: "'+7'", value: '+7', leaf: '+7', sql: '+7', engine: '+7', why: 'leading plus' },
  { name: "' 7'", value: ' 7', leaf: ' 7', sql: ' 7', engine: ' 7', why: 'leading whitespace' },
  { name: "'0x10'", value: '0x10', leaf: '0x10', sql: '0x10', engine: '0x10', why: 'hex' },
  { name: "'Infinity'", value: 'Infinity', leaf: 'Infinity', sql: 'Infinity', engine: 'Infinity', why: 'not finite' },
  { name: "'NaN'", value: 'NaN', leaf: 'NaN', sql: 'NaN', engine: 'NaN', why: 'not finite' },
  { name: "''", value: '', leaf: '', sql: '', engine: '', why: 'the empty string is a value, not a null and not a number' },
  { name: "'won'", value: 'won', leaf: 'won', sql: 'won', engine: 'won', why: 'plain text' },
  // The strings that DID round-trip through #5528's decoder. They are the
  // over-correction guard in the other direction: a string spelled like a number
  // is still a STRING now, because the author typed a string.
  { name: "'7' (canonical numeric spelling)", value: '7', leaf: '7', sql: '7', engine: '7', why: "#5528 recovered this as 7; the author's string is a string" },
  { name: "'80' (canonical numeric spelling)", value: '80', leaf: '80', sql: '80', engine: '80', why: 'the native-sql-datetime-filter case: was 80, now the string' },

  // ── Real non-string types: unchanged behaviour, now by construction ─────────
  { name: 'the number 7', value: 7, leaf: 7, sql: 7, engine: 7, why: 'a number never becomes text' },
  { name: 'the number 1.5', value: 1.5, leaf: 1.5, sql: 1.5, engine: 1.5, why: 'no formatting round trip to lose precision in' },
  { name: 'the number -3', value: -3, leaf: -3, sql: -3, engine: -3, why: 'sign preserved' },
  { name: 'the number 0', value: 0, leaf: 0, sql: 0, engine: 0, why: 'zero is a value, not an absence' },
  { name: 'the number -12.25', value: -12.25, leaf: -12.25, sql: -12.25, engine: -12.25, why: 'no String()/Number() lap at all' },
  {
    name: 'the boolean true',
    value: true,
    leaf: true,
    sql: 1,
    engine: true,
    why: 'the ONE divergence: better-sqlite3 cannot bind a JS boolean; the engine compares against the stored boolean',
  },
  { name: 'the boolean false', value: false, leaf: false, sql: 0, engine: false, why: 'mirror of true' },
];

describe('[#5526] a leaf carries the author comparand ITSELF', () => {
  for (const c of CASES) {
    it(`${c.name} → leaf ${JSON.stringify(c.leaf)}`, () => {
      const node = normalizeAnalyticsFilterTree({ where: { code: { $eq: c.value } } });
      expect(node?.kind).toBe('leaf');
      // Exact set, not "contains": the leaf carries one comparand and it is the
      // author's.
      expect((node as { values: unknown[] }).values, c.why).toEqual([c.leaf]);
    });
  }

  it('the leaf value is the SAME REFERENCE for a non-primitive, i.e. nothing re-encoded it', () => {
    const when = new Date('2026-03-04T05:06:07.000Z');
    const node = normalizeAnalyticsFilterTree({ where: { closed: { $gte: when } } }) as
      | { kind: 'leaf'; values: unknown[] }
      | null;
    expect(node?.values[0]).toBe(when);
  });
});

describe('[#5526] the SQL bind form converts only what a driver cannot bind', () => {
  for (const c of CASES) {
    it(`${c.name} → binds ${JSON.stringify(c.sql)}`, () => {
      expect(toSqlBindValue(c.value), c.why).toEqual(c.sql);
    });
  }

  it('the two consumers agree on every comparand EXCEPT a boolean', () => {
    // The engine path applies no conversion, so `toSqlBindValue` is the entire
    // difference between the two. Anything but a boolean that differs means the
    // SQL boundary grew an opinion about a type it should have passed through.
    for (const c of CASES) {
      if (typeof c.value === 'boolean') {
        expect(toSqlBindValue(c.value)).not.toEqual(c.value);
        continue;
      }
      expect(toSqlBindValue(c.value), c.name).toEqual(c.value);
    }
  });

  it('a Date binds as canonical ISO text (unbindable object → the one SQL form it has)', () => {
    expect(toSqlBindValue(new Date('2026-03-04T05:06:07.000Z'))).toBe('2026-03-04T05:06:07.000Z');
  });

  it('null binds as NULL, not as the empty string', () => {
    // The old encoder wrote `''` for a `null` comparand in an ordering position,
    // which is a REAL comparison against the empty string — on a text column it
    // matched rows. NULL makes the predicate UNKNOWN, i.e. no rows: the answer
    // `driver-memory` and `formula` give, and the fail-closed one.
    expect(toSqlBindValue(null)).toBeNull();
  });

  it('an object comparand binds as JSON rather than failing at the driver', () => {
    expect(toSqlBindValue({ a: 1 })).toBe('{"a":1}');
    expect(toSqlBindValue([1, 'x'])).toBe('[1,"x"]');
  });

  it('`undefined` in a comparand position is REFUSED at this door (#6386)', () => {
    // ⚠️ RE-JUDGED, and the distinction matters because two rulings sit one line
    // apart here. This case used to assert the leaf `{code equals [null]}`,
    // reading `comparand()`'s `undefined` → `null` normalisation (#5526) through
    // the door. #6386 pushed #6050's ruling B — an `undefined` where a comparand
    // belongs is REFUSED — down to this door, so the observable answer moved.
    //
    // ⛔ What did NOT move: `comparand()` itself, byte for byte, and with it both
    // rulings it carries — #5526's normalisation and #5332's "only `=== null` is
    // the null PREDICATE". #6386 refuses an INPUT; it re-decides neither. The
    // consequence is that the normalisation is now unreachable FROM THIS DOOR,
    // which is a fact worth recording rather than a licence to delete it:
    // retiring it is #5526's call on its own terms.
    //
    // The `null` half of the same position is untouched and asserted below, in
    // the SQL/engine consumer blocks — that is the pair this file exists to keep
    // apart, and they live one `===` apart in every polarity table in the module.
    const refusal = (): unknown => normalizeAnalyticsFilterTree({ where: { code: { $eq: undefined } } });
    expect(refusal).toThrowError(/comparand at "code"\.\$eq is undefined/);
    // Still the module's one envelope (#5352), so the REST face answers 400.
    try {
      refusal();
      expect.unreachable('an undefined comparand must not compile');
    } catch (e) {
      expect((e as { code?: unknown }).code).toBe('INVALID_FILTER');
      expect((e as { status?: unknown }).status).toBe(400);
    }
    // The neighbouring `null` comparand keeps compiling, and to the null
    // PREDICATE rather than a value comparison (#5332) — the row that proves the
    // refusal did not widen to `== null`.
    expect(normalizeAnalyticsFilterTree({ where: { code: { $eq: null } } })).toEqual({
      kind: 'leaf', member: 'code', operator: 'notSet', values: [],
    });
  });
});

// ── 2. The SQL consumer: bound params AND row sets, with decoys ──────────────

interface Row {
  id: string;
  code: string | null;
  score: number;
}

/**
 * Every row here is a DECOY for one of the collisions above:
 *
 *   - `r_7` is what a `'007'` filter used to return once the comparand became the
 *     integer `7` and SQLite applied the TEXT column's affinity — the wrong row,
 *     silently. `r_15` does the same for `'1.50'`.
 *   - `r_nulltext` STORES the text `'null'` while `r_realnull` stores real NULL:
 *     the old encoding could not tell the author's two intents apart, and
 *     `{code: {$eq: 'null'}}` reached SQL as `code = NULL`, which is UNKNOWN for
 *     BOTH of these rows and returned neither.
 *   - `r_truetext` does the same for `'true'` against `r_1`, which stores `'1'`.
 */
const ROWS: Row[] = [
  { id: 'r_007', code: '007', score: 7 },
  { id: 'r_7', code: '7', score: 7 },
  { id: 'r_150', code: '1.50', score: 1 },
  { id: 'r_15', code: '1.5', score: 1 },
  { id: 'r_nulltext', code: 'null', score: 2 },
  { id: 'r_realnull', code: null, score: 2 },
  { id: 'r_truetext', code: 'true', score: 3 },
  { id: 'r_1', code: '1', score: 3 },
  { id: 'r_80', code: '80', score: 80 },
];

const CUBE: Cube = {
  name: 'orders',
  title: 'Orders',
  sql: 'orders',
  measures: { total: { name: 'total', label: 'Total', type: 'count', sql: '*' } },
  dimensions: {
    id: { name: 'id', label: 'Id', type: 'string', sql: 'id' },
    code: { name: 'code', label: 'Code', type: 'string', sql: 'code' },
    score: { name: 'score', label: 'Score', type: 'number', sql: 'score' },
  },
  public: false,
} as unknown as Cube;

const ROW_CASES: Array<{ name: string; filter: FilterCondition; expected: string[]; note: string }> = [
  {
    name: "{code: {$eq: 'null'}} finds the row storing the TEXT 'null' — and only it",
    filter: { code: { $eq: 'null' } },
    expected: ['r_nulltext'],
    note: "#5526's headline. The bind was real NULL, so `code = NULL` was UNKNOWN for every row and this returned [].",
  },
  {
    name: "{code: {$eq: 'true'}} finds the row storing the TEXT 'true', not the row storing '1'",
    filter: { code: { $eq: 'true' } },
    expected: ['r_truetext'],
    note: "The bind was the integer 1, which SQLite compares as '1' against this TEXT column → ['r_1'], the wrong row.",
  },
  {
    name: "{code: {$eq: 'false'}} finds nothing rather than the row storing '0'",
    filter: { code: { $eq: 'false' } },
    expected: [],
    note: 'No row stores the text "false". The bind was 0, which matched nothing here either — but for the wrong reason.',
  },
  {
    name: "{code: {$eq: '007'}} finds the row storing '007'",
    filter: { code: { $eq: '007' } },
    expected: ['r_007'],
    note: "Before #5528 the bind was the integer 7 and this returned ['r_7'].",
  },
  {
    name: "{code: {$eq: '1.50'}} finds the row storing '1.50'",
    filter: { code: { $eq: '1.50' } },
    expected: ['r_150'],
    note: "Before #5528 the bind was 1.5 and this returned ['r_15'].",
  },
  {
    name: "{code: {$eq: '7'}} still finds the row storing '7'",
    filter: { code: { $eq: '7' } },
    expected: ['r_7'],
    note: 'A numeric-looking string is now bound as text; on a TEXT column that is the same row it always was.',
  },
  {
    name: "{code: {$in: ['007', '1.50', 'null', 'true']}} keeps all four spellings",
    filter: { code: { $in: ['007', '1.50', 'null', 'true'] } },
    expected: ['r_007', 'r_150', 'r_nulltext', 'r_truetext'],
    note: 'Every operator reads the same leaf, so $in gains the fix with $eq.',
  },
  {
    name: '{score: {$eq: 7}} still matches on the numeric column',
    filter: { score: { $eq: 7 } },
    expected: ['r_007', 'r_7'],
    note: 'A genuine number comparand is untouched.',
  },
  {
    name: "{score: {$gte: '80'}} — a STRING comparand on a numeric column still matches",
    filter: { score: { $gte: '80' } },
    expected: ['r_80'],
    note: "Was bound as 80; now bound as '80'. SQLite applies the INTEGER column's numeric affinity to a TEXT comparand, so the DB decides the comparison — which is why the consumer must not guess.",
  },
  {
    name: '{code: null} is still the null PREDICATE, not a value comparison',
    filter: { code: null },
    expected: ['r_realnull'],
    note: "#5332 / #5525's ruling is untouched: a real `null` comparand compiles to IS NULL (notSet) and never enters `values`.",
  },
  {
    name: '{code: {$eq: null}} is the same predicate as {code: null}',
    filter: { code: { $eq: null } },
    expected: ['r_realnull'],
    note: 'The #5332 / #5525 pair. Deleting the encoder must not disturb it.',
  },
  {
    name: '{code: {$ne: null}} is IS NOT NULL, and the TEXT "null" row is one of the rows it keeps',
    filter: { code: { $ne: null } },
    expected: ['r_007', 'r_1', 'r_15', 'r_150', 'r_7', 'r_80', 'r_nulltext', 'r_truetext'],
    note: 'The two facts the old encoding conflated, from the other side.',
  },
];

/** Point sql.js at the `.wasm` shipped inside its own package (Node-safe). */
async function locateWasm(): Promise<((file: string) => string) | undefined> {
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve('sql.js/package.json');
    const { dirname, join } = await import('node:path');
    const dir = dirname(pkgJsonPath);
    return (file: string) => join(dir, 'dist', file);
  } catch {
    return undefined;
  }
}

describe("[#5526] analytics SQL path — a text column's own spelling is what gets bound", () => {
  let db: any;
  let ctx: StrategyContext;
  let bound: unknown[][];

  beforeAll(async () => {
    const mod: any = await import('sql.js');
    const initSqlJs = mod.default ?? mod;
    const locateFile = await locateWasm();
    const SQL = await initSqlJs(locateFile ? { locateFile } : undefined);

    db = new SQL.Database();
    // `code` is TEXT on purpose: the whole point is a column that STORES the
    // author's spelling, which is where a re-typed bind stops matching.
    db.run(`CREATE TABLE "orders" ("id" TEXT PRIMARY KEY, "code" TEXT, "score" INTEGER);`);
    const insert = db.prepare(`INSERT INTO "orders" ("id","code","score") VALUES (?,?,?)`);
    for (const r of ROWS) insert.run([r.id, r.code, r.score]);
    insert.free();

    bound = [];
    ctx = {
      getCube: (name: string) => (name === 'orders' ? CUBE : undefined),
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async (_object: string, sql: string, params: unknown[]) => {
        bound.push(params);
        const stmt = db.prepare(sql.replace(/\$\d+/g, '?'));
        stmt.bind(params as any[]);
        const out: Record<string, unknown>[] = [];
        while (stmt.step()) out.push(stmt.getAsObject());
        stmt.free();
        return out;
      },
    } as StrategyContext;
  });

  afterAll(() => {
    db?.close();
  });

  for (const c of ROW_CASES) {
    it(c.name, async () => {
      bound.length = 0;
      const result = await new NativeSQLStrategy().execute(
        { cube: 'orders', measures: ['total'], dimensions: ['id'], where: c.filter } as AnalyticsQuery,
        ctx,
      );
      const got = result.rows.map((r) => String(r.id)).sort();
      expect(got, c.note).toEqual(c.expected);
    });
  }

  it("binds 'null' / 'true' / '007' as TEXT, and a real boolean as 1", async () => {
    const bindsFor = async (where: FilterCondition): Promise<unknown[]> => {
      bound.length = 0;
      await new NativeSQLStrategy().execute(
        { cube: 'orders', measures: ['total'], dimensions: ['id'], where } as AnalyticsQuery,
        ctx,
      );
      return bound[0];
    };
    // Exact param sets — the statement binds one comparand per case, so a stray
    // conversion shows up as a different array rather than a missing `toContain`.
    expect(await bindsFor({ code: { $eq: 'null' } })).toEqual(['null']);
    expect(await bindsFor({ code: { $eq: 'true' } })).toEqual(['true']);
    expect(await bindsFor({ code: { $eq: 'false' } })).toEqual(['false']);
    expect(await bindsFor({ code: { $eq: '007' } })).toEqual(['007']);
    expect(await bindsFor({ code: { $eq: '80' } })).toEqual(['80']);
    // Not merely "the rows came back": SQLite's affinity would rescue a '7' bound
    // as text on the numeric column, so only the bound TYPE can see this.
    expect(await bindsFor({ score: { $eq: 7 } })).toEqual([7]);
    expect(await bindsFor({ code: { $eq: true } as never })).toEqual([1]);
    expect(await bindsFor({ code: { $eq: false } as never })).toEqual([0]);
  });

  it('a null comparand in an ORDERING position binds NULL, so the widget draws nothing', async () => {
    // Uncovered by any ruling before this (#5332 said so explicitly): the encoder
    // wrote `''`, i.e. `code > ''`, a real comparison that on a text column
    // returned rows. NULL is UNKNOWN for every row — no rows, no accident.
    bound.length = 0;
    const result = await new NativeSQLStrategy().execute(
      { cube: 'orders', measures: ['total'], dimensions: ['id'], where: { code: { $gt: null } } } as AnalyticsQuery,
      ctx,
    );
    expect(bound[0]).toEqual([null]);
    expect(result.rows).toEqual([]);
  });
});

// ── 3. The LIKE family: its comparand is declared a `string` ─────────────────

describe('[#5526] the LIKE family stringifies at the emitter, on all three emitters', () => {
  const nativeParams = async (where: FilterCondition): Promise<unknown[]> => {
    const ctx = {
      getCube: (name: string) => (name === 'orders' ? CUBE : undefined),
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async () => [],
    } as unknown as StrategyContext;
    return (await new NativeSQLStrategy().generateSql(
      { cube: 'orders', measures: ['total'], where } as AnalyticsQuery,
      ctx,
    )).params;
  };
  const echoParams = async (where: FilterCondition): Promise<unknown[]> => {
    const ctx = {
      getCube: (name: string) => (name === 'orders' ? CUBE : undefined),
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async () => [],
    } as unknown as StrategyContext;
    return (await new ObjectQLStrategy().generateSql(
      { cube: 'orders', measures: ['total'], where } as AnalyticsQuery,
      ctx,
    )).params;
  };
  /** The operand the engine receives, via the private converter. */
  const engineOperand = (where: FilterCondition): unknown => {
    const node = normalizeAnalyticsFilterTree({ where }) as {
      operator: string;
      values: unknown[];
    };
    const strategy = new ObjectQLStrategy() as unknown as {
      convertFilter(operator: string, values?: unknown[]): unknown;
    };
    return strategy.convertFilter(node.operator, node.values);
  };

  it('a string comparand is unchanged — the escaping contract (#5567) is untouched', async () => {
    expect(await nativeParams({ code: { $contains: 'a_b' } })).toEqual(['%a\\_b%', '\\']);
    expect(await echoParams({ code: { $contains: 'a_b' } })).toEqual(['%a\\_b%', '\\']);
    expect(engineOperand({ code: { $contains: 'a_b' } })).toEqual({ $contains: 'a_b' });
  });

  it('a NUMBER comparand becomes its String() form — the same one driver-sql applyLike uses', async () => {
    // `filter.zod.ts` declares `$contains: z.string()`, so a number here is
    // off-contract input. It is stringified rather than dropped (a dropped
    // predicate WIDENS — #3948 / #4128) and rather than refused, because
    // `driver-sql`'s `applyLike` does `String(value)` too: refusing on one face
    // only would fork what `{$contains: 5}` means by which face answered. The
    // shared leniency is filed separately, not decided here.
    expect(await nativeParams({ code: { $contains: 5 } } as unknown as FilterCondition)).toEqual(['%5%', '\\']);
    expect(engineOperand({ code: { $contains: 5 } } as unknown as FilterCondition)).toEqual({ $contains: '5' });
  });

  it("a null comparand becomes '%null%' — narrower than the '%%' it used to be", async () => {
    // The old encoder wrote `''` for null, so this compiled to `LIKE '%%'` and
    // matched EVERY non-NULL row: a silent widening, in a file whose whole
    // subject is silent widening. `String(null)` is `'null'`, which is what
    // `driver-sql` has always compiled — so this converges as it narrows.
    expect(await nativeParams({ code: { $contains: null } } as unknown as FilterCondition)).toEqual(['%null%', '\\']);
    expect(engineOperand({ code: { $contains: null } } as unknown as FilterCondition)).toEqual({ $contains: 'null' });
  });

  it('the echo binds what execution binds, for every LIKE shape', async () => {
    for (const where of [
      { code: { $contains: 'a_b' } },
      { code: { $startsWith: '50%' } },
      { code: { $endsWith: 'x\\y' } },
      { code: { $notContains: '_admin' } },
    ] as FilterCondition[]) {
      expect(await echoParams(where), JSON.stringify(where)).toEqual(await nativeParams(where));
    }
  });
});

// ── 4. The ObjectQL consumer: the comparand handed to the engine ─────────────

const dataset = DatasetSchema.parse({
  name: 'orders',
  label: 'Orders',
  object: 'order',
  dimensions: [{ name: 'code', field: 'code', type: 'string' }],
  measures: [{ name: 'order_count', aggregate: 'count' }],
});

/** Stored rows carry the author's STRINGS, exactly as the engine would hold them. */
const ENGINE_ROWS: Array<{ code: unknown }> = [
  { code: '007' },
  { code: '7' },
  { code: '1.50' },
  { code: 'null' },
  { code: null },
  { code: 'true' },
  { code: true },
];

/**
 * A stand-in for `engine.aggregate` that filters with STRICT equality, the way
 * the real engine compares against a stored value: a comparand re-typed to `7` /
 * `null` / `true` matches a DIFFERENT row than the author asked for, or none.
 */
function makeEngine(captured: Array<Record<string, unknown> | undefined>) {
  return async (
    _object: string,
    options: { groupBy?: string[]; filter?: Record<string, unknown> },
  ): Promise<Array<Record<string, unknown>>> => {
    captured.push(options.filter);
    const filtered = ENGINE_ROWS.filter((row) =>
      Object.entries(options.filter ?? {}).every(
        ([field, cond]) => (row as Record<string, unknown>)[field] === cond,
      ),
    );
    return [{ order_count: filtered.length }];
  };
}

describe('[#5526] analytics engine path — the comparand reaches engine.aggregate verbatim', () => {
  const run = async (comparandValue: unknown) => {
    const captured: Array<Record<string, unknown> | undefined> = [];
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: makeEngine(captured),
    });
    const result = await svc.queryDataset!(dataset, {
      measures: ['order_count'],
      runtimeFilter: { code: { $eq: comparandValue } } as FilterCondition,
    });
    return { captured, result };
  };

  for (const v of ['007', '1.50', 'null', 'true', '7']) {
    it(`passes the string ${JSON.stringify(v)} through, and counts exactly the row that stores it`, async () => {
      const { captured, result } = await run(v);
      expect(captured[0]?.code).toBe(v);
      // Exactly one stored row carries each of these spellings, so `1` here is an
      // exact-set assertion over a fixture that also holds the decoys (real
      // `null`, real `true`, the numeric-looking `'7'`).
      expect(result.rows).toEqual([{ order_count: 1 }]);
    });
  }

  it('still hands the engine a real number for a number comparand', async () => {
    const { captured } = await run(7);
    expect(captured[0]?.code).toBe(7);
  });

  it('still hands the engine a real boolean for a boolean comparand', async () => {
    const { captured, result } = await run(true);
    expect(captured[0]?.code).toBe(true);
    // The stored real `true` row, NOT the row storing the text 'true'.
    expect(result.rows).toEqual([{ order_count: 1 }]);
  });

  it('a real null comparand is still the null predicate, not a value', async () => {
    const { captured, result } = await run(null);
    // `convertFilter` maps `notSet` to a bare `null` — the spelling every driver
    // reads as IS NULL (#5332 / #5525), reached without entering `values`.
    expect(captured[0]).toEqual({ code: null });
    expect(result.rows).toEqual([{ order_count: 1 }]);
  });
});

// ── 5. `dateRange` binds at its DECLARED type ────────────────────────────────

describe('[#5526] a timeDimension dateRange binds at the type the spec declares (string)', () => {
  const engineFilterFor = async (dateRange: string[]): Promise<Record<string, unknown> | undefined> => {
    const captured: Array<Record<string, unknown> | undefined> = [];
    const ctx = {
      getCube: (name: string) => (name === 'orders' ? CUBE : undefined),
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async (_o: string, options: { filter?: Record<string, unknown> }) => {
        captured.push(options.filter);
        return [];
      },
    } as unknown as StrategyContext;
    await new ObjectQLStrategy().execute(
      {
        cube: 'orders',
        measures: ['total'],
        timeDimensions: [{ dimension: 'code', dateRange }],
      } as AnalyticsQuery,
      ctx,
    );
    return captured[0];
  };

  it('forwards ISO bounds as the strings they are', async () => {
    expect(await engineFilterFor(['2026-01-01', '2026-01-31'])).toEqual({
      code: { $gte: '2026-01-01', $lte: '2026-01-31' },
    });
  });

  it('a numeric-looking bound stays a string too', async () => {
    // `coerceFilterValueForObjectQL` used to recover this as the number
    // 1750000000000 — a lenient consumer rescuing a shape
    // `AnalyticsQuerySchema` does not declare (`dateRange: string[]`). An
    // epoch-ms window would have to be declared at the producer or in the spec,
    // not guessed here (Prime Directive #12).
    expect(await engineFilterFor(['1750000000000', '1750000000001'])).toEqual({
      code: { $gte: '1750000000000', $lte: '1750000000001' },
    });
  });
});
