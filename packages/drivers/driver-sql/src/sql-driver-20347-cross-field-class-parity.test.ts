// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20347] PARITY: this driver's cross-field comparison boundary answers
 * exactly what `crossFieldComparisonVerdict` (`@objectstack/spec/data`) answers,
 * on every pair of declared columns.
 *
 * The spec's classification was LIFTED from this driver's module-private
 * `crossFieldComparisonClass` (the #5222 boundary) so the authoring door and
 * the write check could read one definition. Lifting it made a second copy
 * for as long as the driver keeps its own, so this file holds the two equal:
 * one object declaring every `FieldType` member once (`f_<type>`) plus every
 * multi-capable member flagged `multiple: true` (`m_<type>`), and every
 * ordered pair of those columns compiled as `{ a: { $eq: { $field: b } } }`.
 *
 * The driver's verdict is read from what it DOES, never from its prose: the
 * pair compiles and runs (admitted), or it is refused in the withheld
 * `INVALID_FILTER` / 400 envelope the cross-field boundary raises (#7929 —
 * `withheldFilterDiagnosticOf` answers non-null only for that family). Any
 * other outcome fails the case: it means the pair never reached the class
 * question, and a parity claim over it would be a claim about nothing. The
 * fixture keeps the boundary's other refusals out by construction — every
 * column is declared, no reference is dotted, and no tenant-isolation column
 * is compared.
 *
 * Only `$eq` is driven: the class question is asked once per comparison,
 * before the operator is read, for all six operators the boundary compiles
 * (`sql-driver-cross-field-reference.test.ts` pins the operator matrix).
 *
 * The engine lane's rewire of this driver onto the spec export keeps this file
 * green by construction; until then it is the proof the lift changed nothing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver, withheldFilterDiagnosticOf } from './index.js';
import {
  FieldType,
  MULTI_CAPABLE_TYPES,
  REFERENCE_VALUE_TYPES,
  crossFieldComparisonVerdict,
  type FilterCondition,
} from '@objectstack/spec/data';

const OBJ = 'cfc_parity_probe';

interface ProbeColumn {
  name: string;
  type: string;
  multiple?: boolean;
}

const columns: ProbeColumn[] = [
  ...FieldType.options.map((type) => ({ name: `f_${type}`, type })),
  ...[...MULTI_CAPABLE_TYPES].map((type) => ({ name: `m_${type}`, type, multiple: true })),
];

/** A declaration the driver's DDL accepts for each probe column. */
function declarationOf(c: ProbeColumn): Record<string, unknown> {
  const decl: Record<string, unknown> = { name: c.name, type: c.type };
  if (c.multiple) decl.multiple = true;
  if (REFERENCE_VALUE_TYPES.has(c.type)) decl.reference = OBJ;
  if (c.type === 'formula') decl.expression = '1';
  return decl;
}

type Observed = 'admitted' | 'refused';

describe('[#20347] driver-sql cross-field boundary ⇔ crossFieldComparisonVerdict, every declared pair', () => {
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([
      {
        name: OBJ,
        fields: Object.fromEntries([
          ['id', { name: 'id', type: 'text' }],
          ...columns.map((c) => [c.name, declarationOf(c)] as const),
        ]),
      } as never,
    ]);
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  async function observe(target: string, ref: string): Promise<Observed> {
    const where = { [target]: { $eq: { $field: ref } } } as FilterCondition;
    try {
      await driver.find(OBJ, { fields: ['id'], where });
      return 'admitted';
    } catch (e) {
      const err = e as { code?: unknown; status?: unknown };
      // The ADR-0112 envelope AND the cross-field boundary's own withheld form:
      // anything else never reached the class question.
      expect({ code: err.code, status: err.status }, `${target} vs ${ref}: ${String(e)}`)
        .toEqual({ code: 'INVALID_FILTER', status: 400 });
      expect(withheldFilterDiagnosticOf(e), `${target} vs ${ref}: not the cross-field boundary's refusal`)
        .not.toBeNull();
      return 'refused';
    }
  }

  it('the probe covers every FieldType member and every multi-capable member flagged multiple', () => {
    expect(columns.filter((c) => !c.multiple).map((c) => c.type).sort()).toEqual([...FieldType.options].sort());
    expect(columns.filter((c) => c.multiple).map((c) => c.type).sort()).toEqual([...MULTI_CAPABLE_TYPES].sort());
  });

  for (const target of columns) {
    it(`${target.name} against every declared column`, async () => {
      const mismatches: string[] = [];
      for (const ref of columns) {
        const verdict = crossFieldComparisonVerdict(target, ref).verdict;
        const expected: Observed = verdict === 'comparable' ? 'admitted' : 'refused';
        const observed = await observe(target.name, ref.name);
        if (observed !== expected) {
          mismatches.push(`${target.name} vs ${ref.name}: spec says ${verdict}, driver ${observed}`);
        }
      }
      expect(mismatches).toEqual([]);
    });
  }
});
