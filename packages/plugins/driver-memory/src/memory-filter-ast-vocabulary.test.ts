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
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { VALID_AST_OPERATORS } from '@objectstack/spec/data';
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
  const find = (where: unknown) =>
    driver.find(TABLE, { object: TABLE, fields: ['id'], where } as any);

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
      find([[field, op, value]]),
      `VALID_AST_OPERATORS accepts "${op}" but InMemoryDriver cannot express it`,
    ).resolves.toBeDefined();
  });

  it('matches null rows for is_null instead of dropping the predicate', async () => {
    // The regression this pins: `is_null` used to return null from the converter,
    // the condition was dropped, and the query returned BOTH rows.
    const rows = await find([['note', 'is_null', true]]);
    expect(rows.map((r: any) => r.id)).toEqual(['1']);
  });

  it('matches non-null rows for is_not_null', async () => {
    const rows = await find([['note', 'is_not_null', true]]);
    expect(rows.map((r: any) => r.id)).toEqual(['2']);
  });

  it('throws on an operator it cannot express, rather than matching everything', async () => {
    await expect(find([['name', 'sounds_like', 'alpha']]))
      .rejects.toThrow(/Unsupported filter operator "sounds_like"/);
  });

  it('throws on a bare comparison triple instead of returning every record', async () => {
    // `before` is a canonical VIEW_FILTER_OPERATORS member that VALID_AST_OPERATORS
    // does not accept, so this is the exact shape that reached drivers unparsed.
    await expect(find(['created_at', 'before', '2024-01-01']))
      .rejects.toThrow(/Unrecognized filter operator "created_at"/);
  });

  it('throws on a malformed between rather than emitting no predicate', async () => {
    await expect(find([['score', 'between', 5]]))
      .rejects.toThrow(/needs a two-element array/);
  });

  it('still honours a well-formed logical node', async () => {
    const rows = await find(['or', ['name', '=', 'alpha'], ['name', '=', 'beta']]);
    expect(rows.map((r: any) => r.id).sort()).toEqual(['1', '2']);
  });
});
