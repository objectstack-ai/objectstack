/**
 * Filter-AST vocabulary parity, and no-silent-drop. (#3948)
 *
 * Two invariants, both of which this driver used to break in the same direction:
 *
 *  1. Every operator in `VALID_AST_OPERATORS` must be expressible. That set gates
 *     `isFilterAST()`, so anything in it is an operator the protocol will happily
 *     parse and hand to a driver. Seven of them — `not_in`, `is_null`,
 *     `is_not_null`, `isnull`, `isnotnull`, `is_empty`, `is_not_empty` — fell to
 *     `default: return null` and the caller dropped the condition, so e.g.
 *     `is_null` narrowed nothing instead of matching null rows.
 *
 *  2. An operator this driver cannot express must THROW, never be skipped. A
 *     dropped condition widens the result set: the caller asked to filter and
 *     silently received more rows than it asked for. driver-sql already threw on
 *     the same input, so the two backends disagreed about the same query.
 *
 * The nastiest case is the bare comparison triple. `['x','before',1]` reaches a
 * driver only when `isFilterAST()` refused it, leaving the array unparsed — and
 * the old loop cast each string element to a logic keyword, opening empty logic
 * groups and returning `{}`: a filter matching EVERY record.
 *
 * [#5158] That loop is gone. `FilterArray` is input-only authoring sugar, and
 * both doors into the runtime lower it through `parseFilterAST` before a driver
 * is reached — so an array arriving HERE is refused rather than compiled by a
 * second implementation (which is what cloud's `RemoteTransport` already did,
 * cloud#1075). Invariant (1) is unchanged and is still measured against the
 * spec's own operator set: every operator must survive the authored form all
 * the way to a matched row, which is now `parseFilterAST` + this driver rather
 * than this driver alone. Invariant (2) likewise — the refusal simply happens
 * one door earlier for the shapes `parseFilterAST` cannot express.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { VALID_AST_OPERATORS, parseFilterAST } from '@objectstack/spec/data';
import type { FilterCondition } from '@objectstack/spec/data';
import { InMemoryDriver } from './memory-driver.js';

const TABLE = 'vocab_probe';

describe('InMemoryDriver filter vocabulary ↔ VALID_AST_OPERATORS', () => {
  let driver: InMemoryDriver;

  beforeEach(async () => {
    driver = new InMemoryDriver({ persistence: false });
    await driver.connect();
    await driver.create(TABLE, { id: '1', name: 'alpha', score: 10, note: null });
    await driver.create(TABLE, { id: '2', name: 'beta', score: 20, note: 'set' });
  });

  /** Operators are exercised through `find`, the path a real query takes. */
  // Cast deliberately: several `where` shapes below are ones the declared
  // contract forbids, fed in to prove the driver throws instead of silently
  // dropping the condition. `unknown` is the honest parameter type.
  const find = (where: unknown) =>
    driver.find(TABLE, { object: TABLE, fields: ['id'], where: where as FilterCondition });

  /**
   * The authored `FilterArray`, travelling the one route that exists (#5158):
   * lowered by the spec's `parseFilterAST`, then executed by the driver. This
   * is what the engine and the protocol face do; feeding the array raw is what
   * no longer works, pinned at the bottom of this file.
   */
  const findAuthored = (where: unknown) => find(parseFilterAST(where));

  it('reads a non-empty operator set from the spec', () => {
    // Guards every assertion below from passing vacuously.
    expect(VALID_AST_OPERATORS.size).toBeGreaterThan(0);
  });

  /** A representative value per operator, so each one is actually exercised. */
  const valueFor = (op: string): unknown => {
    if (op === 'in' || op === 'nin' || op === 'not_in') return ['alpha'];
    if (op === 'between') return [0, 100];
    if (/null|empty/.test(op)) return true;
    if (/contains|like|startswith|starts_with|endswith|ends_with/.test(op)) return 'alp';
    return 'alpha';
  };

  it.each([...VALID_AST_OPERATORS])('expresses %s without dropping it', async (op) => {
    const field = /^[<>=!]/.test(op) || op === 'between' ? 'score' : 'name';
    const value = field === 'score' && !Array.isArray(valueFor(op)) ? 10 : valueFor(op);
    // The assertion is that this does not throw and does not silently degrade to
    // "no predicate". An operator the driver cannot express now throws, so any
    // rejection here means the spec accepts a name this driver cannot honour.
    await expect(
      findAuthored([[field, op, value]]),
      `VALID_AST_OPERATORS accepts "${op}" but InMemoryDriver cannot express it`,
    ).resolves.toBeDefined();
  });

  it('matches null rows for is_null instead of dropping the predicate', async () => {
    // The regression this pins: `is_null` used to return null from the converter,
    // the condition was dropped, and the query returned BOTH rows.
    const rows = await findAuthored([['note', 'is_null', true]]);
    expect(rows.map((r: any) => r.id)).toEqual(['1']);
  });

  it('matches non-null rows for is_not_null', async () => {
    const rows = await findAuthored([['note', 'is_not_null', true]]);
    expect(rows.map((r: any) => r.id)).toEqual(['2']);
  });

  it('throws on an operator it cannot express, rather than matching everything', async () => {
    // `parseFilterAST` is lenient here by design (`$${op}` fallback), so the
    // driver meets `{ name: { $sounds_like: … } }`; the ENGINE door gates on
    // `isFilterAST` and refuses the authored array a layer earlier. #3948's
    // condition holds either way: it THROWS, never a match-everything.
    //
    // What it does NOT yet do on this path is speak the ADR-0112 envelope —
    // the object path hands an unknown `$op` straight to mingo, which raises a
    // bare `MingoError` with no `code`/`status`. That gap is the general form
    // of #5324 (same `normalizeFilterCondition` passthrough, `$not` being the
    // instance filed there) and is NOT a #5158 regression: the array path that
    // used to carry the envelope for this input is what #5158 deleted, and the
    // object path has always answered this way.
    await expect(findAuthored([['name', 'sounds_like', 'alpha']])).rejects.toThrow();
  });

  it('a malformed between emits no predicate on this backend — the #5328 divergence', async () => {
    // driver-sql THROWS on `{ score: { $between: 5 } }`; this driver's
    // `normalizeFilterCondition` skips the arm entirely and the field
    // normalises to `{}`, which mingo evaluates as "matches nothing". Two
    // backends, one filter, two answers — filed as #5328, not fixed here.
    //
    // Pinned as-is so the divergence is visible rather than folklore. It is
    // pre-existing: the loud refusal this test used to observe belonged to the
    // ARRAY path, which #5158 deleted; the object path never had one.
    await expect(findAuthored([['score', 'between', 5]])).resolves.toEqual([]);
  });

  it('still honours a well-formed logical node', async () => {
    const rows = await findAuthored(['or', ['name', '=', 'alpha'], ['name', '=', 'beta']]);
    expect(rows.map((r: any) => r.id).sort()).toEqual(['1', '2']);
  });

  // ── the array dialect itself: refused, not compiled (#5158) ───────────

  it.each([
    ['bare comparison triple the AST gate refuses', ['created_at', 'before', '2024-01-01']],
    ['nested condition array', [['name', '=', 'alpha']]],
    ['infix logical join (the undeclared dialect)', [['name', '=', 'alpha'], 'or', ['name', '=', 'beta']]],
    ['element of the wrong type', [42]],
  ])('refuses an array %s instead of compiling a second dialect', async (_label, where) => {
    await expect(find(where)).rejects.toThrow(/A filter ARRAY reached the driver/);
  });

  it('an empty array is still "no filter", not a refusal', async () => {
    const rows = await find([]);
    expect(rows.map((r: any) => r.id).sort()).toEqual(['1', '2']);
  });
});
