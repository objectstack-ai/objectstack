// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0155 D4] `FIXED_READ_LEAF_CASE_SETS` lands ahead of every evaluator and
 * every seam that runs it (ADR-0155 plan steps 2–5 enrol them), so until then
 * nothing executes the tables — and a miscounted `expected` list would sit
 * quietly wrong until a driver author trusted it. This file executes them:
 *
 *  - the evaluator cases, against a reference evaluator that compiles each
 *    leaf FROM ITS DESCRIPTION (`fixedInnerReadOf`), in SQL's three-valued
 *    logic, so the description and the expected rows are proven to agree;
 *  - the seam cases, against a reference judge written from ADR-0155 D1's
 *    position and verb rules and D4's recipient rule.
 *
 * The second job is proving the tables are not VACUOUS: each way an evaluator
 * can get the leaf wrong (drop a fixed predicate, ignore the levels, restate
 * them, lose the blank-id guard, wall the inner read, join instead of
 * semi-join, read the leaf as no restriction) and each rule a seam can forget
 * must fail at least one case, so an implementation that makes that mistake
 * cannot pass the table.
 */

import { describe, it, expect } from 'vitest';
import type { FilterCondition } from './filter.zod';
import { fixedInnerReadOf, isFixedReadLeaf, type FixedInnerRead, type FixedReadLeaf } from './fixed-read-leaf';
import {
  FIXED_READ_LEAF_CASE_SETS,
  SHARED_RECORD_IDS_CASE_SET,
  type FixedReadLeafCaseSet,
  type FixedReadLeafMatchesCase,
  type FixedReadLeafRow,
  type FixedReadLeafSeamCase,
} from './fixed-read-leaf-conformance';
import { isComposedReadableIds, type ComposedReadableIds } from './readable-ids';
import { SHARED_RECORD_IDS_BRAND, isSharedRecordIds, type SharedRecordIds } from './shared-record-ids';

// ── A reference evaluator, compiled from each leaf's description ─────────────

/** SQL's three truth values: `null` is UNKNOWN, and a `WHERE` keeps TRUE only. */
type Tri = boolean | null;

const and = (values: Tri[]): Tri => (values.includes(false) ? false : values.includes(null) ? null : true);
const or = (values: Tri[]): Tri => (values.includes(true) ? true : values.includes(null) ? null : false);
const not = (value: Tri): Tri => (value === null ? null : !value);

/** `value IN (members)`, three-valued: a NULL on either side of a non-match is UNKNOWN. */
function membership(value: unknown, members: readonly unknown[]): Tri {
  if (value === null || value === undefined) return null;
  if (members.includes(value)) return true;
  return members.some((m) => m === null || m === undefined) ? null : false;
}

/** The ways an evaluator can get a fixed-read leaf wrong — `faithful` compiles the description as declared. */
type Reading =
  | 'faithful'
  | 'leaf-as-no-restriction'
  | 'object-unfixed'
  | 'recipient-type-unfixed'
  | 'recipient-unfixed'
  | 'levels-ignored'
  | 'levels-restated'
  | 'blank-guard-missing'
  | 'inner-read-walled'
  | 'joined';

/** The level list an evaluator that restates plugin-sharing's write levels would compile instead of the leaf's. */
const RESTATED_LEVELS = ['edit', 'full'];

interface EvalContext {
  readonly set: FixedReadLeafCaseSet;
  readonly tenantId?: string;
  readonly reading: Reading;
  /** `joined` only: how many inner rows each outer id matched. */
  readonly fanout: Map<unknown, number>;
}

const rowsOf = (set: FixedReadLeafCaseSet, object: string): readonly FixedReadLeafRow[] => {
  const table = set.tables.find((t) => t.object === object);
  if (!table) throw new Error(`the case-set seeds no table named ${object}`);
  return table.rows;
};

/** The description, as the reading under test would compile it. */
function compiled(read: FixedInnerRead, reading: Reading): FixedInnerRead {
  const equals: Record<string, string> = { ...read.equals };
  const memberOf: Record<string, readonly string[]> = { ...read.memberOf };
  if (reading === 'object-unfixed') delete equals.object_name;
  if (reading === 'recipient-type-unfixed') delete equals.recipient_type;
  if (reading === 'recipient-unfixed') delete equals.recipient_id;
  if (reading === 'levels-ignored') delete memberOf.access_level;
  if (reading === 'levels-restated' && memberOf.access_level) memberOf.access_level = RESTATED_LEVELS;
  return { ...read, equals, memberOf };
}

/** The `column` values of the inner read's rows: the leaf's members, NULLs included when the guard is lost. */
function innerMembers(leaf: FixedReadLeaf, ctx: EvalContext): unknown[] {
  const read = compiled(fixedInnerReadOf(leaf), ctx.reading);
  // `tenantScope: 'none'` is the only declared value: the inner read is unwalled
  // unless the reading under test walls it.
  const walled = ctx.reading === 'inner-read-walled' && ctx.tenantId !== undefined;
  // The description's predicate maps name columns. A `$`-key is no column of any
  // table, so it is refused, never read as a field the row lacks.
  return rowsOf(ctx.set, read.table)
    .filter((row) =>
      Object.entries(read.equals).every(([column, value]) => {
        if (column.startsWith('$')) throw new Error(`a fixed inner read's equals names columns, not ${column}`);
        return row[column] === value;
      }),
    )
    .filter((row) =>
      Object.entries(read.memberOf).every(([column, values]) => {
        if (column.startsWith('$')) throw new Error(`a fixed inner read's memberOf names columns, not ${column}`);
        return values.includes(row[column] as string);
      }),
    )
    .filter((row) => !walled || row[ctx.set.tenantField] === ctx.tenantId)
    .map((row) => row[read.column])
    .filter((value) => ctx.reading === 'blank-guard-missing' || (value !== null && value !== ''));
}

/** The ids of `leaf.object` its composed scope admits, inside the outer read's tenant wall (ADR-0139 D2 step 3). */
function readableParentIds(leaf: ComposedReadableIds, ctx: EvalContext): unknown[] {
  return rowsOf(ctx.set, leaf.object)
    .filter((row) => ctx.tenantId === undefined || row[ctx.set.tenantField] === ctx.tenantId)
    .filter((row) => leaf.scope === undefined || matches(row, leaf.scope, ctx) === true)
    .map((row) => row.id);
}

function fieldMatches(row: FixedReadLeafRow, field: string, spec: unknown, ctx: EvalContext): Tri {
  const value = row[field];
  if (spec !== null && typeof spec === 'object' && !Array.isArray(spec) && '$in' in spec) {
    const comparand = (spec as { $in: unknown }).$in;
    if (isFixedReadLeaf(comparand)) {
      if (ctx.reading === 'leaf-as-no-restriction') return true;
      const members = innerMembers(comparand, ctx);
      if (ctx.reading === 'joined') ctx.fanout.set(row.id, members.filter((m) => m === value).length);
      return membership(value, members);
    }
    if (isComposedReadableIds(comparand)) return membership(value, readableParentIds(comparand, ctx));
    if (Array.isArray(comparand)) return membership(value, comparand);
    throw new Error(`the reference evaluator has no reading for ${field}.$in = ${String(comparand)}`);
  }
  // Implicit equality, the null predicate included.
  if (spec === null) return value === null;
  return value === null ? null : value === spec;
}

function matches(row: FixedReadLeafRow, where: FilterCondition, ctx: EvalContext): Tri {
  return and(Object.entries(where).map(([key, spec]): Tri => {
    if (key === '$and') return and((spec as FilterCondition[]).map((child) => matches(row, child, ctx)));
    if (key === '$or') return or((spec as FilterCondition[]).map((child) => matches(row, child, ctx)));
    if (key === '$not') return not(matches(row, spec as FilterCondition, ctx));
    return fieldMatches(row, key, spec, ctx);
  }));
}

/** What `find` on the case's object answers under `reading`: the ascending ids (repeated per join row under `joined`). */
function answer(set: FixedReadLeafCaseSet, c: FixedReadLeafMatchesCase, reading: Reading): string[] {
  const ctx: EvalContext = { set, tenantId: c.options?.tenantId, reading, fanout: new Map() };
  const where = c.where();
  return rowsOf(set, c.object)
    // The OUTER read's tenant wall, which every driver already applies.
    .filter((row) => ctx.tenantId === undefined || row[set.tenantField] === ctx.tenantId)
    .filter((row) => matches(row, where, ctx) === true)
    .flatMap((row) => Array.from({ length: Math.max(1, ctx.fanout.get(row.id) ?? 1) }, () => String(row.id)))
    .sort();
}

/** Does `where` hold a fixed-read leaf anywhere, inside composed scopes included? */
const holdsLeaf = (node: unknown): boolean => {
  if (isFixedReadLeaf(node)) return true;
  if (isComposedReadableIds(node)) return holdsLeaf(node.scope);
  if (node === null || typeof node !== 'object') return false;
  return (Array.isArray(node) ? node : Object.values(node)).some(holdsLeaf);
};

// ── A reference seam judge, from ADR-0155 D1 and D4 ──────────────────────────

/** The rules a seam can forget — `faithful` keeps all of them. */
type SeamReading = 'faithful' | 'no-position-rule' | 'no-verb-rule' | 'no-recipient-rule' | 'no-descent';

const READ_VERBS = new Set(['find', 'findOne', 'count', 'aggregate']);

function seamVerdict(c: FixedReadLeafSeamCase, reading: SeamReading): 'admits' | 'refuses' {
  let refused = false;
  const judge = (leaf: SharedRecordIds, op: string, field: string, object: string, nested: boolean) => {
    const positioned = op === '$in' && field === 'id' && leaf.object === object;
    const writeForm = leaf.accessLevels !== undefined;
    const verbOk = c.clause === 'where' && (
      nested || READ_VERBS.has(c.operation) ? !writeForm : c.operation === 'update' && writeForm
    );
    const recipientOk = c.context.isSystem === true
      || leaf.recipient === c.context.userId
      || leaf.recipient === c.context.onBehalfOf?.userId;
    if ((reading !== 'no-position-rule' && !positioned)
      || (reading !== 'no-verb-rule' && !verbOk)
      || (reading !== 'no-recipient-rule' && !recipientOk)) refused = true;
  };
  // A leaf anywhere but a `$in` comparand of a field of the where is out of position.
  const misplaced = () => {
    if (reading !== 'no-position-rule') refused = true;
  };
  const walk = (node: unknown, object: string, nested: boolean): void => {
    if (node === null || typeof node !== 'object') return;
    if (isSharedRecordIds(node)) return misplaced();
    for (const [key, value] of Object.entries(node)) {
      if (key === '$and' || key === '$or') (value as unknown[]).forEach((child) => walk(child, object, nested));
      else if (key === '$not') walk(value, object, nested);
      else if (isSharedRecordIds(value)) misplaced();
      else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        for (const [op, comparand] of Object.entries(value)) {
          if (op === '$in' && isSharedRecordIds(comparand)) judge(comparand, op, key, object, nested);
          else if (op === '$in' && isComposedReadableIds(comparand)) {
            if (reading !== 'no-descent') walk(comparand.scope, comparand.object, true);
          } else if (holdsLeaf(comparand)) misplaced();
        }
      }
    }
  };
  walk(c.filter(), c.object, false);
  return refused ? 'refuses' : 'admits';
}

// ── The tables, executed ─────────────────────────────────────────────────────

const set = SHARED_RECORD_IDS_CASE_SET;

describe('SHARED_RECORD_IDS_CASE_SET — the evaluator cases agree with the leaf\'s own description', () => {
  for (const c of set.cases) {
    it(c.name, () => {
      expect(answer(set, c, 'faithful')).toEqual([...c.expected]);
    });
  }
});

describe('SHARED_RECORD_IDS_CASE_SET — each wrong reading of the leaf fails the table', () => {
  const failing = (reading: Reading) =>
    set.cases.filter((c) => JSON.stringify(answer(set, c, reading)) !== JSON.stringify([...c.expected])).map((c) => c.name);
  const READ_FORM = 'the read form: every record shared with the recipient, at any level';
  const WRITE_FORMS = [
    'the write form admits only the levels it carries',
    'the write form with one level: membership is in the leaf\'s own levels',
  ];

  it('evaluating the leaf as "no restriction" fails, directly and inside a composed scope', () => {
    expect(failing('leaf-as-no-restriction')).toEqual(expect.arrayContaining([
      READ_FORM,
      'inside a composed ReadableIds scope whose parent is the object it names: the subqueries nest',
    ]));
  });

  it('dropping any one of the three fixed equality predicates fails the read form', () => {
    for (const reading of ['object-unfixed', 'recipient-type-unfixed', 'recipient-unfixed'] as const) {
      expect(failing(reading), reading).toContain(READ_FORM);
    }
    expect(failing('recipient-unfixed')).toContain('another recipient\'s grants are theirs alone');
  });

  it('ignoring the write form\'s levels, or compiling a level list of its own, fails both write-form cases', () => {
    expect(failing('levels-ignored')).toEqual(expect.arrayContaining(WRITE_FORMS));
    expect(failing('levels-restated')).toEqual(expect.arrayContaining(WRITE_FORMS));
  });

  it('losing the blank-id guard fails exactly the negation', () => {
    expect(failing('blank-guard-missing')).toEqual([
      '$not over the leaf answers every record not shared, which needs the blank-id guard',
    ]);
  });

  it('walling the inner read with the driver\'s tenant scope fails exactly the case that says so', () => {
    expect(failing('inner-read-walled')).toEqual(
      set.cases.filter((c) => c.requiresUnwalledInnerRead === true).map((c) => c.name),
    );
    expect(failing('inner-read-walled')).toHaveLength(1);
  });

  it('a join in place of the semi-join fails: a record with two grant rows is answered twice', () => {
    expect(failing('joined')).toEqual(expect.arrayContaining([READ_FORM, 'several grant rows on one record are one member']));
  });
});

describe('SHARED_RECORD_IDS_CASE_SET — D-0, the same set as today\'s list', () => {
  it('the D-0 list is G read from the grant rows the way plugin-sharing reads it today, and the leaf answers its rows', () => {
    const grants = rowsOf(set, 'sys_record_share');
    // Today's read: one find under { object_name, recipient_type: 'user', recipient_id },
    // then grantedRecordIds — nullish ids dropped, the rest stringified, the empty string dropped.
    const today = grants
      .filter((g) => g.object_name === 'srid_doc' && g.recipient_type === 'user' && g.recipient_id === 'u1')
      .map((g) => g.record_id)
      .filter((id): id is string => id !== null && id !== undefined)
      .map(String)
      .filter((id) => id !== '');
    const g = [...new Set(today)].sort();
    const listCase = set.cases.find((c) => c.name.startsWith('D-0:'))!;
    const leafCase = set.cases.find((c) => c.name === 'the read form: every record shared with the recipient, at any level')!;
    expect(((listCase.where() as { id: { $in: string[] } }).id.$in)).toEqual(g);
    expect(listCase.expected).toEqual(leafCase.expected);
    expect(answer(set, listCase, 'faithful')).toEqual(answer(set, leafCase, 'faithful'));
  });
});

describe('SHARED_RECORD_IDS_CASE_SET — the seam cases agree with ADR-0155 D1 and D4', () => {
  for (const c of set.seam) {
    it(`${c.verdict}: ${c.name}`, () => {
      expect(seamVerdict(c, 'faithful')).toBe(c.verdict);
    });
  }

  it('a seam that forgets any one rule admits at least one case the table refuses', () => {
    for (const reading of ['no-position-rule', 'no-verb-rule', 'no-recipient-rule', 'no-descent'] as const) {
      const flipped = set.seam.filter((c) => c.verdict === 'refuses' && seamVerdict(c, reading) === 'admits');
      expect(flipped.length, reading).toBeGreaterThan(0);
    }
  });
});

describe('FIXED_READ_LEAF_CASE_SETS — the tables are well-formed', () => {
  it('holds one case-set per leaf, this leaf\'s under its own brand, frozen', () => {
    expect(FIXED_READ_LEAF_CASE_SETS).toEqual([SHARED_RECORD_IDS_CASE_SET]);
    expect(new Set(FIXED_READ_LEAF_CASE_SETS.map((s) => s.brand)).size).toBe(FIXED_READ_LEAF_CASE_SETS.length);
    expect(set.brand).toBe(SHARED_RECORD_IDS_BRAND);
    expect(Object.isFrozen(FIXED_READ_LEAF_CASE_SETS)).toBe(true);
    expect(Object.isFrozen(set)).toBe(true);
    expect(Object.isFrozen(set.cases)).toBe(true);
    expect(Object.isFrozen(set.seam)).toBe(true);
    for (const table of set.tables) {
      expect(Object.isFrozen(table.rows), table.object).toBe(true);
      for (const row of table.rows) expect(Object.isFrozen(row), `${table.object}.${row.id}`).toBe(true);
    }
  });

  it('seeds the inner read\'s own table, and every row carries an id and the tenant field', () => {
    for (const s of FIXED_READ_LEAF_CASE_SETS) {
      const innerTables = new Set(s.cases.flatMap((c) => {
        const tables: string[] = [];
        const collect = (node: unknown): void => {
          if (isFixedReadLeaf(node)) tables.push(fixedInnerReadOf(node).table);
          else if (isComposedReadableIds(node)) collect(node.scope);
          else if (node !== null && typeof node === 'object') (Array.isArray(node) ? node : Object.values(node)).forEach(collect);
        };
        collect(c.where());
        return tables;
      }));
      const seeded = new Set(s.tables.map((t) => t.object));
      for (const table of innerTables) expect(seeded.has(table), table).toBe(true);
      expect(seeded.size).toBe(s.tables.length);
      for (const table of s.tables) {
        for (const row of table.rows) {
          expect(typeof row.id === 'string' && row.id.length > 0, `${table.object} row`).toBe(true);
          expect(typeof row[s.tenantField], `${table.object}.${row.id}`).toBe('string');
        }
      }
    }
  });

  it('names are unique, expected ids are ascending, distinct, and name rows of the case\'s object', () => {
    for (const s of FIXED_READ_LEAF_CASE_SETS) {
      for (const names of [s.cases.map((c) => c.name), s.seam.map((c) => c.name)]) {
        expect(new Set(names).size).toBe(names.length);
      }
      for (const c of s.cases) {
        expect([...c.expected].sort(), c.name).toEqual([...c.expected]);
        expect(new Set(c.expected).size, c.name).toBe(c.expected.length);
        const ids = new Set(rowsOf(s, c.object).map((r) => r.id));
        for (const id of c.expected) expect(ids.has(id), `${c.name}: ${id}`).toBe(true);
      }
    }
  });

  it('holdsLeaf says what each where holds, so a refusing driver refuses exactly those cases', () => {
    for (const c of set.cases) expect(holdsLeaf(c.where()), c.name).toBe(c.holdsLeaf);
    expect(set.cases.filter((c) => !c.holdsLeaf).map((c) => c.name)).toEqual([
      'D-0: today\'s list of the granted ids answers the same rows',
    ]);
  });

  it('a case that requires an unwalled inner read reads under a tenant', () => {
    for (const c of set.cases.filter((x) => x.requiresUnwalledInnerRead === true)) expect(c.options?.tenantId, c.name).toBeTypeOf('string');
  });

  it('every seam case holds at least one leaf, and both verdicts are represented', () => {
    for (const c of set.seam) expect(holdsLeaf(c.filter()), c.name).toBe(true);
    expect(new Set(set.seam.map((c) => c.verdict))).toEqual(new Set(['admits', 'refuses']));
  });

  it('every factory builds fresh leaves: no two suites judge one object', () => {
    const factories = [...set.cases.map((c) => [c.name, c.where] as const), ...set.seam.map((c) => [c.name, c.filter] as const)];
    for (const [name, build] of factories) {
      const a = build();
      const b = build();
      expect(a, name).not.toBe(b);
      expect(a, name).toEqual(b);
    }
  });

  it('the fixture levels are not plugin-sharing\'s vocabulary, so an evaluator cannot pass by restating it', () => {
    const levels = new Set(rowsOf(set, 'sys_record_share').map((g) => g.access_level));
    for (const level of RESTATED_LEVELS) expect(levels.has(level), level).toBe(false);
  });
});
