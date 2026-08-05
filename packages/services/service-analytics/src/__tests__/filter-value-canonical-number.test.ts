// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A STRING comparand keeps its spelling — #5528 (route C of #5526).
 *
 * `filter-normalizer` round-trips every comparand through `values: string[]`:
 * `stringifyForCube` on the way out, `coerceFilterValueForSql` /
 * `coerceFilterValueForObjectQL` on the way back. The decoder used to decide
 * "this is a number" from the string's SHAPE alone (`/^-?\d+(\.\d+)?$/`), which
 * cannot tell a stringified number from a string the author wrote — so `'007'`
 * came back as `7` and `'1.50'` as `1.5`, on BOTH consumers.
 *
 * Measured on `main` before the fix (the #5526 table, reproduced):
 *
 *   | author's `v` | leaf values  | SQL bind | engine bind |
 *   |---|---|---|---|
 *   | `'007'`  | `["007"]`  | `7`   | `7`   |
 *   | `'0912'` | `["0912"]` | `912` | `912` |
 *   | `'1.50'` | `["1.50"]` | `1.5` | `1.5` |
 *
 * Zero-padded and trailing-zero strings are ordinary business shapes — order
 * numbers, SKUs, dialling codes, postcodes, prices — so the row-set case below
 * is the symptom an author actually reports: a widget filtered on order number
 * `'007'` returning the row that stores `'7'`, or nothing at all.
 *
 * Recovery is now limited to a number's own canonical spelling
 * (`String(Number(s)) === s`). The two directions this file has to hold apart:
 *
 *   - a comparand that REALLY was a number is `String(n)` by construction, so it
 *     still round-trips (`7` → `'7'` → `7`) — the guard against over-correcting;
 *   - a string `Number()` would rewrite cannot have come from a number, so it
 *     stays the author's string.
 *
 * ⛔ Scope: `'null'` / `'true'` / `'false'` still collide with the tokens the
 * ENCODER writes for the real values — that is the `string[]` encoding having no
 * escape, i.e. #5526's root cause, deliberately not touched here. The collision
 * is pinned below as UNCHANGED so no future reader mistakes it for fixed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Cube, AnalyticsQuery, FilterCondition } from '@objectstack/spec/data';
import type { StrategyContext } from '@objectstack/spec/contracts';
import { DatasetSchema } from '@objectstack/spec/ui';

import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import {
  normalizeAnalyticsFilterTree,
  coerceFilterValueForSql,
  coerceFilterValueForObjectQL,
} from '../strategies/filter-normalizer.js';
import { AnalyticsService } from '../analytics-service.js';

// ── 1. The decoder, value by value ───────────────────────────────────────────

/**
 * `sql` / `objectql` are what each consumer must bind. They differ only on the
 * boolean tokens (the SQL path cannot bind a JS boolean); which strings count as
 * NUMBERS is one rule shared by both, which is why every numeric row here
 * carries the same expectation twice.
 */
const DECODE: Array<{ input: string; sql: unknown; objectql: unknown; why: string }> = [
  // The #5526 table's regression rows: information `Number()` would destroy.
  { input: '007', sql: '007', objectql: '007', why: 'leading zeros — order number / SKU (was 7)' },
  { input: '0912', sql: '0912', objectql: '0912', why: 'leading zero — dialling code (was 912)' },
  { input: '1.50', sql: '1.50', objectql: '1.50', why: 'trailing zero — price string (was 1.5)' },
  { input: '1.0', sql: '1.0', objectql: '1.0', why: 'trailing zero (was 1)' },
  { input: '-0', sql: '-0', objectql: '-0', why: 'the sign is lost: String(Number("-0")) is "0" (was 0)' },
  {
    input: '12345678901234567890',
    sql: '12345678901234567890',
    objectql: '12345678901234567890',
    why: 'more digits than a double holds (was 12345678901234567000)',
  },
  {
    input: '1000000000000000000000',
    sql: '1000000000000000000000',
    objectql: '1000000000000000000000',
    why: 'canonical form of 1e21 is exponential, so the digits round-trip lossily (was 1e21)',
  },

  // Canonical numeric spellings — what a real number comparand encodes to.
  { input: '7', sql: 7, objectql: 7, why: 'String(7) — recovered' },
  { input: '1.5', sql: 1.5, objectql: 1.5, why: 'String(1.5) — recovered' },
  { input: '-3', sql: -3, objectql: -3, why: 'negative canonical — recovered' },
  { input: '0', sql: 0, objectql: 0, why: 'String(0) — recovered' },
  { input: '1000', sql: 1000, objectql: 1000, why: 'trailing zeros are canonical HERE — recovered' },

  // Shapes the leading regex rejected before this change and still rejects: the
  // narrowing can only ever REMOVE recoveries, never add one.
  { input: '1e3', sql: '1e3', objectql: '1e3', why: 'exponent — string before #5528, string after' },
  { input: '1e+21', sql: '1e+21', objectql: '1e+21', why: 'canonical String(1e21), but the regex still refuses it' },
  { input: '+7', sql: '+7', objectql: '+7', why: 'leading plus — never recovered' },
  { input: ' 7', sql: ' 7', objectql: ' 7', why: 'whitespace — never recovered' },
  { input: '0x10', sql: '0x10', objectql: '0x10', why: 'hex — never recovered' },
  { input: 'Infinity', sql: 'Infinity', objectql: 'Infinity', why: 'not finite — never recovered' },
  { input: 'NaN', sql: 'NaN', objectql: 'NaN', why: 'not finite — never recovered' },
  { input: '', sql: '', objectql: '', why: 'the empty string is a value, not a number' },
  { input: 'won', sql: 'won', objectql: 'won', why: 'plain text' },
];

describe('analytics filter decode — only a canonical numeric spelling is a number (#5528)', () => {
  for (const c of DECODE) {
    it(`${JSON.stringify(c.input)} → SQL ${JSON.stringify(c.sql)} / engine ${JSON.stringify(c.objectql)}`, () => {
      expect(coerceFilterValueForSql(c.input), c.why).toEqual(c.sql);
      expect(coerceFilterValueForObjectQL(c.input), c.why).toEqual(c.objectql);
    });
  }

  it('keeps the two consumers in step on WHICH strings are numbers', () => {
    // The table deliberately holds no boolean/null token — those are the one
    // place the two consumers are MEANT to differ, and they are pinned in their
    // own case below. Everywhere else a divergence means one coercer grew its own
    // idea of a number, which is how one `where` starts meaning two things.
    for (const c of DECODE) {
      expect(coerceFilterValueForSql(c.input)).toEqual(coerceFilterValueForObjectQL(c.input));
    }
  });
});

describe('a real number comparand still round-trips (the over-correction guard)', () => {
  // Encode with the real encoder rather than a hand-written string: this is the
  // path a `{$eq: 7}` actually takes, so it fails if the narrowing went too far.
  for (const n of [7, 1.5, -3, 0, 1000, -12.25]) {
    it(`${n} → values → ${n}`, () => {
      const node = normalizeAnalyticsFilterTree({ where: { score: { $eq: n } } });
      expect(node?.kind).toBe('leaf');
      const encoded = node?.kind === 'leaf' ? node.values[0] : undefined;
      expect(encoded).toBe(String(n));
      expect(coerceFilterValueForSql(encoded!)).toBe(n);
      expect(coerceFilterValueForObjectQL(encoded!)).toBe(n);
    });
  }
});

describe('#5526 root cause NOT fixed here — the token collision is unchanged', () => {
  // Pinned, not endorsed. `stringifyForCube` writes these same three tokens for
  // the real `null` / `true` / `false`, and `values: string[]` has no escape, so
  // an author filtering for the literal text still loses. Route A/B in #5526.
  it('the author strings null / true / false still decode to non-strings', () => {
    expect(coerceFilterValueForSql('null')).toBeNull();
    expect(coerceFilterValueForObjectQL('null')).toBeNull();
    expect(coerceFilterValueForSql('true')).toBe(1);
    expect(coerceFilterValueForObjectQL('true')).toBe(true);
    expect(coerceFilterValueForSql('false')).toBe(0);
    expect(coerceFilterValueForObjectQL('false')).toBe(false);
  });
});

// ── 2. The SQL consumer: bound params AND row sets ───────────────────────────

interface Row {
  id: string;
  code: string;
  score: number;
}

/**
 * `r_7` is the row that makes the bug visible rather than merely empty: with the
 * comparand downgraded to the integer `7`, SQLite applies the TEXT column's
 * affinity to it, compares `'7'`, and hands the author asking for order `'007'`
 * a DIFFERENT row. `r_15` does the same for `'1.50'`.
 */
const ROWS: Row[] = [
  { id: 'r_007', code: '007', score: 7 },
  { id: 'r_7', code: '7', score: 7 },
  { id: 'r_150', code: '1.50', score: 1 },
  { id: 'r_15', code: '1.5', score: 1 },
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
    name: "{code: {$eq: '007'}} finds the row storing '007'",
    filter: { code: { $eq: '007' } },
    expected: ['r_007'],
    note: "Before #5528 the bind was the integer 7 and this returned ['r_7'] — the wrong row, silently.",
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
    note: 'A canonical spelling is still recovered as a number; on a TEXT column SQLite compares it as text, so the right row comes back either way.',
  },
  {
    name: "{code: {$in: ['007', '1.50']}} keeps both spellings",
    filter: { code: { $in: ['007', '1.50'] } },
    expected: ['r_007', 'r_150'],
    note: 'The coercers serve every operator, not just $eq.',
  },
  {
    name: '{score: {$eq: 7}} still matches on the numeric column',
    filter: { score: { $eq: 7 } },
    expected: ['r_007', 'r_7'],
    note: 'A genuine number comparand is unaffected by the narrowing.',
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

describe("analytics SQL path — a text column's own spelling is what gets bound (#5528)", () => {
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
    // author's spelling, which is where a numeric bind stops matching.
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

  it("binds '007' as TEXT, not as the integer 7", async () => {
    bound.length = 0;
    await new NativeSQLStrategy().execute(
      { cube: 'orders', measures: ['total'], dimensions: ['id'], where: { code: { $eq: '007' } } } as AnalyticsQuery,
      ctx,
    );
    expect(bound[0]).toContain('007');
    expect(bound[0].map((p) => typeof p)).toContain('string');
    expect(bound[0]).not.toContain(7);
  });

  it('binds a genuine number comparand as a NUMBER', async () => {
    bound.length = 0;
    await new NativeSQLStrategy().execute(
      { cube: 'orders', measures: ['total'], dimensions: ['id'], where: { score: { $eq: 7 } } } as AnalyticsQuery,
      ctx,
    );
    // Not merely "the rows came back": SQLite's numeric affinity would rescue a
    // '7' bound as text on this column, so the row set alone cannot see the
    // difference. The bound TYPE can.
    expect(bound[0]).toContain(7);
    expect(bound[0]).not.toContain('7');
  });
});

// ── 3. The ObjectQL consumer: the comparand handed to the engine ─────────────

const dataset = DatasetSchema.parse({
  name: 'orders',
  label: 'Orders',
  object: 'order',
  dimensions: [{ name: 'code', field: 'code', type: 'string' }],
  measures: [{ name: 'order_count', aggregate: 'count' }],
});

/** Stored rows carry the author's STRINGS, exactly as the engine would hold them. */
const ENGINE_ROWS: Array<{ code: string }> = [{ code: '007' }, { code: '7' }, { code: '1.50' }];

/**
 * A stand-in for `engine.aggregate` that filters with STRICT equality, the way
 * the real engine compares against a stored value: a comparand downgraded to `7`
 * matches none of the rows above, so the count genuinely goes to zero.
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

describe("analytics engine path — the comparand reaches engine.aggregate as '007' (#5528)", () => {
  for (const v of ['007', '1.50']) {
    it(`passes the string ${JSON.stringify(v)} through, and counts the row that stores it`, async () => {
      const captured: Array<Record<string, unknown> | undefined> = [];
      const svc = new AnalyticsService({
        queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
        executeAggregate: makeEngine(captured),
      });

      const result = await svc.queryDataset!(dataset, {
        measures: ['order_count'],
        runtimeFilter: { code: { $eq: v } },
      });

      expect(captured[0]?.code).toBe(v);
      // Was 0 before #5528: the engine compared the number 7 / 1.5 against a
      // stored string and nothing matched.
      expect(result.rows).toEqual([{ order_count: 1 }]);
    });
  }

  it('still hands the engine a real number for a number comparand', async () => {
    const captured: Array<Record<string, unknown> | undefined> = [];
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: makeEngine(captured),
    });

    await svc.queryDataset!(dataset, {
      measures: ['order_count'],
      runtimeFilter: { code: { $eq: 7 } },
    });

    expect(captured[0]?.code).toBe(7);
  });
});
