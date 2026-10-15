// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 D3] `READABLE_IDS_CASES` lands ahead of every driver that runs it
 * (E3 and E4 enrol the drivers), so between now and then nothing executes the
 * table — and a miscounted `expected` list would sit quietly wrong until a
 * driver author trusted it. This file executes it, against a reference
 * evaluator written from the declared semantics: the composed leaf is the
 * semi-join `field IN (SELECT id FROM P WHERE scope AND tenant)`, `$not` is
 * NULL-safe, and an uncomposed leaf is refused.
 *
 * The second job is proving the table is not VACUOUS: each of the three ways a
 * driver can get the leaf wrong — evaluating it as "no restriction", ignoring
 * its scope, compiling its subquery without the tenant wall — must fail at
 * least one case, so a driver that makes that mistake cannot pass the table.
 */

import { describe, it, expect } from 'vitest';
import type { FilterCondition } from './filter.zod';
import { isComposedReadableIds, isReadableIds, type ComposedReadableIds } from './readable-ids';
import {
  READABLE_IDS_CASES,
  READABLE_IDS_CHILD_ROWS,
  READABLE_IDS_PARENT_ROWS,
  READABLE_IDS_REFUSAL,
  type ReadableIdsCase,
  type ReadableIdsMatchesCase,
} from './readable-ids-conformance';

// ── A reference evaluator, from the declared semantics ───────────────────────

type Row = Record<string, unknown>;

/** The fixture, as rows the evaluator reads by column name. */
const PARENTS: readonly Row[] = READABLE_IDS_PARENT_ROWS.map((row) => ({ ...row }));
const CHILDREN: readonly Row[] = READABLE_IDS_CHILD_ROWS.map((row) => ({ ...row }));

/** The ways a driver can get the composed leaf wrong — `faithful` is the declared semantics. */
type Reading = 'faithful' | 'leaf-as-no-restriction' | 'scope-ignored' | 'subquery-unwalled';

interface EvalContext {
  readonly tenantId?: string;
  readonly reading: Reading;
}

class UncomposedLeafRefusal extends Error {
  readonly code = READABLE_IDS_REFUSAL.code;
  readonly status = READABLE_IDS_REFUSAL.status;
}

/** The ids of the parent rows the composed leaf admits under `ctx`. */
function readableParentIds(leaf: ComposedReadableIds, ctx: EvalContext): Set<unknown> {
  const walled = ctx.tenantId !== undefined && ctx.reading !== 'subquery-unwalled';
  const ids = new Set<unknown>();
  for (const parent of PARENTS) {
    if (walled && parent.organization_id !== ctx.tenantId) continue;
    if (leaf.scope !== undefined && ctx.reading !== 'scope-ignored' && !matches(parent, leaf.scope, ctx)) continue;
    ids.add(parent.id);
  }
  return ids;
}

/** One field constraint against one row: the subset of operators the table uses. */
function fieldMatches(row: Row, field: string, spec: unknown, ctx: EvalContext): boolean {
  const value = row[field];
  if (spec !== null && typeof spec === 'object' && !Array.isArray(spec) && '$in' in (spec as Row)) {
    const comparand = (spec as Row).$in;
    if (isReadableIds(comparand)) throw new UncomposedLeafRefusal(`uncomposed ReadableIds leaf at ${field}.$in`);
    if (isComposedReadableIds(comparand)) {
      if (ctx.reading === 'leaf-as-no-restriction') return true;
      return value != null && readableParentIds(comparand, ctx).has(value);
    }
    if (Array.isArray(comparand)) return comparand.includes(value);
    throw new Error(`the reference evaluator has no reading for ${field}.$in = ${String(comparand)}`);
  }
  // Implicit equality, the null predicate included.
  return spec === null ? value == null : value === spec;
}

function matches(row: Row, where: FilterCondition, ctx: EvalContext): boolean {
  for (const [key, spec] of Object.entries(where)) {
    if (key === '$and') {
      if (!(spec as FilterCondition[]).every((child) => matches(row, child, ctx))) return false;
    } else if (key === '$or') {
      if (!(spec as FilterCondition[]).some((child) => matches(row, child, ctx))) return false;
    } else if (key === '$not') {
      // NULL-safe: "not P" holds wherever P is not TRUE, a row with no value included.
      if (matches(row, spec as FilterCondition, ctx)) return false;
    } else if (!fieldMatches(row, key, spec, ctx)) {
      return false;
    }
  }
  return true;
}

/** What `find` on the child object answers for `c` under `reading`: the ascending ids. */
function answer(c: ReadableIdsMatchesCase, reading: Reading): string[] {
  const ctx: EvalContext = { tenantId: c.options?.tenantId, reading };
  const where = c.where();
  return CHILDREN
    // The OUTER read's tenant wall, which every driver already applies.
    .filter((row) => ctx.tenantId === undefined || row.organization_id === ctx.tenantId)
    .filter((row) => matches(row, where, ctx))
    .map((row) => String(row.id))
    .sort();
}

const matchesCases = READABLE_IDS_CASES.filter((c): c is ReadableIdsMatchesCase => c.verdict === 'matches');

/** Does `where` hold a composed leaf anywhere? */
const holdsComposedLeaf = (where: unknown): boolean => {
  if (isComposedReadableIds(where)) return true;
  if (where === null || typeof where !== 'object') return false;
  return (Array.isArray(where) ? where : Object.values(where)).some(holdsComposedLeaf);
};

// ── The table, executed ──────────────────────────────────────────────────────

describe('READABLE_IDS_CASES — the table agrees with the declared semantics', () => {
  for (const c of matchesCases) {
    it(c.name, () => {
      expect(answer(c, 'faithful')).toEqual([...c.expected]);
    });
  }

  for (const c of READABLE_IDS_CASES.filter((x) => x.verdict === 'refuses-uncomposed')) {
    it(c.name, () => {
      const where = c.where();
      let refusal: unknown;
      try {
        CHILDREN.forEach((row) => matches(row, where, { reading: 'faithful' }));
      } catch (e) {
        refusal = e;
      }
      expect(refusal).toBeInstanceOf(UncomposedLeafRefusal);
      expect({ code: (refusal as UncomposedLeafRefusal).code, status: (refusal as UncomposedLeafRefusal).status })
        .toEqual({ code: 'INTERNAL_ERROR', status: 500 });
    });
  }
});

describe('READABLE_IDS_CASES — each wrong reading of the leaf fails the table', () => {
  const failing = (reading: Reading) =>
    matchesCases.filter((c) => JSON.stringify(answer(c, reading)) !== JSON.stringify([...c.expected])).map((c) => c.name);

  it('a driver that evaluates the composed leaf as "no restriction" fails, on the deleted and the absent parent', () => {
    expect(failing('leaf-as-no-restriction')).toContain('no row restriction: every child whose parent exists');
  });

  it('a driver that compiles the subquery without its scope fails', () => {
    expect(failing('scope-ignored')).toContain('a scope narrows the parents whose children match');
    expect(failing('scope-ignored')).toContain('a scope that admits no parent matches no child');
  });

  it('a driver that compiles the subquery without its tenant wall fails exactly the tenant case', () => {
    expect(failing('subquery-unwalled')).toEqual(
      matchesCases.filter((c) => c.requiresTenantWall === true).map((c) => c.name),
    );
    expect(failing('subquery-unwalled')).toHaveLength(1);
  });
});

describe('READABLE_IDS_CASES — the table is well-formed', () => {
  it('names are unique, expected ids are ascending and name fixture rows', () => {
    const names = READABLE_IDS_CASES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    const childIds = new Set(READABLE_IDS_CHILD_ROWS.map((r) => r.id));
    for (const c of matchesCases) {
      expect([...c.expected].sort(), c.name).toEqual([...c.expected]);
      for (const id of c.expected) expect(childIds.has(id), `${c.name}: ${id}`).toBe(true);
    }
  });

  it('holdsComposedLeaf says what each where holds, so a refusing driver refuses exactly those cases', () => {
    for (const c of matchesCases) expect(holdsComposedLeaf(c.where()), c.name).toBe(c.holdsComposedLeaf);
    expect(matchesCases.filter((c) => !c.holdsComposedLeaf).map((c) => c.name)).toEqual([
      'the engine\'s denial answer, $in: [], matches no child',
    ]);
  });

  it('the refusal case holds an uncomposed leaf and no composed one', () => {
    const refusals = READABLE_IDS_CASES.filter((c) => c.verdict === 'refuses-uncomposed');
    expect(refusals).toHaveLength(1);
    const where = refusals[0].where() as { record_id: { $in: unknown } };
    expect(isReadableIds(where.record_id.$in)).toBe(true);
    expect(holdsComposedLeaf(where)).toBe(false);
  });

  it('every where factory builds fresh leaves: no two suites judge one object', () => {
    for (const c of READABLE_IDS_CASES as readonly ReadableIdsCase[]) {
      const a = c.where();
      const b = c.where();
      expect(a, c.name).not.toBe(b);
      expect(a, c.name).toEqual(b);
    }
  });

  it('the refusal envelope is D3\'s composition fault, not an author error', () => {
    expect(READABLE_IDS_REFUSAL).toEqual({ code: 'INTERNAL_ERROR', status: 500 });
    expect(Object.isFrozen(READABLE_IDS_REFUSAL)).toBe(true);
  });
});
