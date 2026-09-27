// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `page-component-filter-record-to-rule-array` — the D2 half of the
 * one-filter-orthography convergence (#17321, ruling B).
 *
 * The ruling, verbatim in its load-bearing parts: convert the flat record, the
 * operator object, several keys (they AND) and single-level AST tuples; pass a
 * record carrying `$and` / `$or` / `$not` through UNCHANGED; never flatten.
 * This file pins:
 *
 *  §1  every ruled shape converts to the exact rule array, at every door kind;
 *  §2  a combinator — record key or AST group — is left byte-identical, and so
 *      is every other shape with no lossless rule spelling, and every filter of
 *      a component whose rows are inline (the renderer's in-memory matcher reads
 *      the record form and excludes every row for a rule array);
 *  §3  an already-converged rule array is the identity, and a second replay is
 *      a no-op;
 *  §4  LOSSLESS is a measured property, not a claim: for every operator the
 *      FilterCondition and the AST declare, a mapped rule lowers through
 *      `parseFilterAST` to exactly what the source lowered to;
 *  §5  what the conversion writes is what the doors accept, so a converted row
 *      re-saves cleanly;
 *  §6  the reach is the family, derived from the schema rather than recalled;
 *  §7  the jurisdiction: retired from the authoring funnel (Clause-② no — an
 *      author is still refused), replayed at rest and by the migration chain.
 */

import { describe, expect, it } from 'vitest';

import {
  FILTER_OPERATORS,
  VALID_AST_OPERATORS,
  parseFilterAST,
} from '../data/filter.zod.js';
import { applyMetaMigrations } from '../migrations/chain.js';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry.js';
import { normalizeStackInput } from '../shared/metadata-collection.zod.js';
import { ComponentPropsMap } from '../ui/component.zod.js';
import { ElementDataSourceSchema } from '../ui/page.zod.js';
import { collectConversionNotices } from './apply.js';
import { ALL_CONVERSIONS } from './registry.js';
import { applyConversionsToStoredItem } from './stored.js';
import type { ConversionNotice } from './types.js';

const ID = 'page-component-filter-record-to-rule-array';
const RULE_FORM = '[{ field, operator, value }, ...]';

type Dict = Record<string, unknown>;

/** A one-component page, the component under test at `regions[0].components[0]`. */
function pageWith(component: Dict): Dict {
  return { pages: [{ name: 'probe', regions: [{ name: 'main', components: [component] }] }] };
}

function componentOf(stack: Dict): Dict {
  const page = (stack.pages as Dict[])[0]!;
  return ((page.regions as Dict[])[0]!.components as Dict[])[0]!;
}

/** Run the WHOLE chain (retired entries included, as the data-at-rest seams do). */
function convert(stack: Dict): { stack: Dict; notices: ConversionNotice[] } {
  return collectConversionNotices(structuredClone(stack), { includeRetired: true });
}

/** The value a converted `properties.filter` on an `object-grid` ends up holding. */
function gridFilter(filter: unknown): { value: unknown; notices: ConversionNotice[] } {
  const { stack, notices } = convert(pageWith({ type: 'object-grid', properties: { objectName: 'deal', filter } }));
  return { value: (componentOf(stack).properties as Dict).filter, notices };
}

describe('§0 premises', () => {
  it('the entry exists, targets protocol 18, and is retired from the load path', () => {
    const entry = ALL_CONVERSIONS.find((c) => c.id === ID);
    expect(entry, 'premise: the conversion is registered').toBeDefined();
    expect(entry!.toMajor).toBe(18);
    expect(entry!.retiredFromLoadPath).toBe(true);
  });

  it('the protocol-18 migration step replays it by id', () => {
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toContain(ID);
  });
});

describe('§1 the ruled subset converts to the exact rule array', () => {
  it('a flat record: one `equals` rule per key, values verbatim', () => {
    const { value, notices } = gridFilter({ stage: 'open', score: 3, archived: false });
    expect(value).toEqual([
      { field: 'stage', operator: 'equals', value: 'open' },
      { field: 'score', operator: 'equals', value: 3 },
      { field: 'archived', operator: 'equals', value: false },
    ]);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.conversionId).toBe(ID);
    expect(notices[0]!.path).toBe('pages[0].regions[0].components[0].properties.filter');
  });

  it('an operator object: the operator is lifted into `operator`, canonically spelled', () => {
    expect(gridFilter({ amount: { $gt: 100 } }).value).toEqual([
      { field: 'amount', operator: 'greater_than', value: 100 },
    ]);
    expect(gridFilter({ status: { $ne: 'done' } }).value).toEqual([
      { field: 'status', operator: 'not_equals', value: 'done' },
    ]);
    expect(gridFilter({ stage: { $nin: ['lost'] } }).value).toEqual([
      { field: 'stage', operator: 'not_in', value: ['lost'] },
    ]);
    expect(gridFilter({ name: { $notContains: 'test' } }).value).toEqual([
      { field: 'name', operator: 'not_contains', value: 'test' },
    ]);
    expect(gridFilter({ closed_at: { $between: ['2026-01-01', '2026-02-01'] } }).value).toEqual([
      { field: 'closed_at', operator: 'between', value: ['2026-01-01', '2026-02-01'] },
    ]);
  });

  it('several keys, and several operators on one key, become several rules — they AND', () => {
    expect(gridFilter({ amount: { $gte: 10, $lt: 99 }, owner_id: '{current_user_id}' }).value).toEqual([
      { field: 'amount', operator: 'greater_than_or_equal', value: 10 },
      { field: 'amount', operator: 'less_than', value: 99 },
      { field: 'owner_id', operator: 'equals', value: '{current_user_id}' },
    ]);
  });

  it('a single-level AST: a flat list of comparisons, and one bare comparison', () => {
    expect(
      gridFilter([
        ['owner_id', '=', '{current_user_id}'],
        ['amount', '>=', 5],
        ['stage', 'in', ['open', 'won']],
        ['deleted_at', 'is_null'],
      ]).value,
    ).toEqual([
      { field: 'owner_id', operator: 'equals', value: '{current_user_id}' },
      { field: 'amount', operator: 'greater_than_or_equal', value: 5 },
      { field: 'stage', operator: 'in', value: ['open', 'won'] },
      { field: 'deleted_at', operator: 'is_null' },
    ]);
    expect(gridFilter(['status', '!=', 'done']).value).toEqual([
      { field: 'status', operator: 'not_equals', value: 'done' },
    ]);
    // A legacy word spelling folds through the doors' own alias table.
    expect(gridFilter([['stage', 'notIn', ['lost']]]).value).toEqual([
      { field: 'stage', operator: 'not_in', value: ['lost'] },
    ]);
  });

  it('`{}` constrains nothing, and so does `[]`', () => {
    expect(gridFilter({}).value).toEqual([]);
  });

  it('every door kind: the binding on any component, the block `filter`, the grid `defaultFilters`', () => {
    const { stack, notices } = convert(
      pageWith({
        type: 'object-grid',
        dataSource: { object: 'deal', filter: { stage: 'open' } },
        properties: { objectName: 'deal', defaultFilters: { owner_id: 'u1' } },
      }),
    );
    const component = componentOf(stack);
    expect((component.dataSource as Dict).filter).toEqual([
      { field: 'stage', operator: 'equals', value: 'open' },
    ]);
    expect((component.properties as Dict).defaultFilters).toEqual([
      { field: 'owner_id', operator: 'equals', value: 'u1' },
    ]);
    expect(notices.map((n) => n.path)).toEqual([
      'pages[0].regions[0].components[0].dataSource.filter',
      'pages[0].regions[0].components[0].properties.defaultFilters',
    ]);
  });

  it('reaches slots and nested containers, as every page-component conversion does', () => {
    const { stack } = convert({
      pages: [
        {
          name: 'probe',
          slots: {
            tabs: {
              type: 'page:tabs',
              properties: {
                items: [
                  {
                    label: 'A',
                    children: [{ type: 'object-calendar', properties: { objectName: 'deal', filter: { a: 1 } } }],
                  },
                ],
              },
            },
          },
        },
      ],
    });
    const slot = ((stack.pages as Dict[])[0]!.slots as Dict).tabs as Dict;
    const nested = (((slot.properties as Dict).items as Dict[])[0]!.children as Dict[])[0]!;
    expect((nested.properties as Dict).filter).toEqual([{ field: 'a', operator: 'equals', value: 1 }]);
  });
});

describe('§2 what has no lossless rule spelling is left byte-identical', () => {
  // The ruled boundary first: a combinator is never flattened.
  const COMBINATOR_ROWS: ReadonlyArray<readonly [string, unknown]> = [
    ['$or', { $or: [{ stage: 'open' }, { stage: 'won' }] }],
    ['$and', { $and: [{ stage: 'open' }, { amount: { $gt: 1 } }] }],
    ['$not', { $not: { stage: 'lost' } }],
    ['$or beside a field key', { owner_id: 'u1', $or: [{ stage: 'open' }, { stage: 'won' }] }],
    ['an AST `and` group', ['and', ['stage', '=', 'open'], ['amount', '>', 1]]],
    ['an AST `or` group', ['or', ['stage', '=', 'open'], ['stage', '=', 'won']]],
    ['a flat list nesting an `or` group', [['owner_id', '=', 'u1'], ['or', ['a', '=', 1], ['b', '=', 2]]]],
  ];

  it.each(COMBINATOR_ROWS)('%s', (_name, filter) => {
    const before = pageWith({ type: 'object-kanban', properties: { objectName: 'deal', filter } });
    const { stack, notices } = convert(before);
    expect((componentOf(stack).properties as Dict).filter).toEqual(filter);
    expect(notices).toEqual([]);
    // Copy-on-write: nothing on the way was rebuilt either.
    const frozen = structuredClone(before);
    expect(collectConversionNotices(frozen, { includeRetired: true }).stack).toBe(frozen);
  });

  const DECLINED_ROWS: ReadonlyArray<readonly [string, unknown]> = [
    // The renderer at the pin skips a null key (constrains nothing); a rule would test IS NULL.
    ['a null value', { owner_id: null }],
    ['a null value beside a mappable key', { stage: 'open', owner_id: null }],
    // Direction lives in the VALUE — not in the one operator table.
    ['`$null`', { deleted_at: { $null: true } }],
    ['`$exists`', { deleted_at: { $exists: false } }],
    ['an operator that is not a FilterCondition operator', { name: { $regex: 'a.c' } }],
    ['a mis-cased operator', { amount: { $Gt: 1 } }],
    ['an empty operator object', { amount: {} }],
    ['a nested non-operator object', { owner: { id: 'u1' } }],
    ['an array in equality position', { tags: ['a', 'b'] }],
    ['a top-level `$` key that is not a combinator', { $text: 'acme' }],
    ['a field-reference comparand', { amount: { $gt: { $field: 'budget' } } }],
    ['a comparand the door refuses (`in` needs a list)', { stage: { $in: 'open' } }],
    ['an empty `icontains` comparand', { name: { $icontains: '' } }],
    ['an AST operator with no rule word (`like`)', [['name', 'like', '%acme%']]],
    ['an AST scalar comparison with no value', [['amount', '>']]],
    ['a mixed list of a rule object and an AST tuple', [{ field: 'a', operator: 'equals', value: 1 }, ['b', '=', 2]]],
  ];

  it.each(DECLINED_ROWS)('%s', (_name, filter) => {
    const { value, notices } = gridFilter(filter);
    expect(value).toEqual(filter);
    expect(notices).toEqual([]);
  });

  it('all-or-nothing: a declined key keeps the mappable keys beside it from converting', () => {
    // Converting `stage` alone would drop `owner_id: null` from an AND list — a wider filter.
    const { value } = gridFilter({ stage: 'open', deleted_at: { $null: true } });
    expect(value).toEqual({ stage: 'open', deleted_at: { $null: true } });
  });

  it('the `filter` of a component outside the family is not this entry\'s surface', () => {
    const before = pageWith({ type: 'record:related_list', properties: { objectName: 'deal', filter: { a: 1 } } });
    const { stack, notices } = convert(before);
    expect((componentOf(stack).properties as Dict).filter).toEqual({ a: 1 });
    expect(notices).toEqual([]);
  });

  describe('a component whose rows are INLINE keeps every filter as stored', () => {
    // Measured at the objectui pin `f8a9d0fb`: object-map / -tree / -calendar /
    // -gantt hand `filter` UNLOWERED to an in-memory ValueDataSource when their
    // rows are inline, and ValueDataSource matches the record form but excludes
    // EVERY row for a rule array. So there the rewrite is not lossless — and the
    // binding is composed into that same `filter`, so it stays as stored too.
    const INLINE: ReadonlyArray<readonly [string, string, Dict]> = [
      ['object-map', '`data: { provider: value }`', { data: { provider: 'value', items: [{ stage: 'open' }] } }],
      ['object-tree', '`data: { provider: value }`', { data: { provider: 'value', items: [{ stage: 'open' }] } }],
      ['object-gantt', '`data: { provider: value }`', { data: { provider: 'value', items: [{ stage: 'open' }] } }],
      ['object-calendar', '`staticData`', { staticData: [{ stage: 'open' }] }],
      ['object-map', 'an EMPTY `staticData` (still the value rung)', { staticData: [] }],
      ['object-kanban', 'a bare `data` array', { data: [{ stage: 'open' }] }],
    ];

    it.each(INLINE)('%s with %s', (type, _shape, inline) => {
      const before = pageWith({
        type,
        dataSource: { object: 'deal', filter: { owner_id: 'u1' } },
        properties: { objectName: 'deal', ...inline, filter: { stage: 'open' } },
      });
      const { stack, notices } = convert(before);
      const component = componentOf(stack);
      expect((component.properties as Dict).filter).toEqual({ stage: 'open' });
      expect((component.dataSource as Dict).filter).toEqual({ owner_id: 'u1' });
      expect(notices).toEqual([]);
      const frozen = structuredClone(before);
      expect(collectConversionNotices(frozen, { includeRetired: true }).stack).toBe(frozen);
    });

    it('`defaultFilters` on an inline-row grid stays as stored too', () => {
      const { value, notices } = (() => {
        const { stack, notices: n } = convert(pageWith({
          type: 'object-grid',
          properties: { data: { provider: 'value', items: [] }, defaultFilters: { stage: 'open' } },
        }));
        return { value: (componentOf(stack).properties as Dict).defaultFilters, notices: n };
      })();
      expect(value).toEqual({ stage: 'open' });
      expect(notices).toEqual([]);
    });

    it('control: the same filter on an object-bound block of the same type converts', () => {
      for (const data of [undefined, { provider: 'object', object: 'deal' }]) {
        const { stack, notices } = convert(
          pageWith({
            type: 'object-map',
            dataSource: { object: 'deal', filter: { owner_id: 'u1' } },
            properties: { objectName: 'deal', ...(data ? { data } : {}), filter: { stage: 'open' } },
          }),
        );
        const component = componentOf(stack);
        expect((component.properties as Dict).filter).toEqual([
          { field: 'stage', operator: 'equals', value: 'open' },
        ]);
        expect((component.dataSource as Dict).filter).toEqual([
          { field: 'owner_id', operator: 'equals', value: 'u1' },
        ]);
        expect(notices).toHaveLength(2);
      }
    });
  });

  it('`defaultFilters` is converted on the grid only', () => {
    const { stack, notices } = convert(
      pageWith({ type: 'object-kanban', properties: { objectName: 'deal', defaultFilters: { a: 1 } } }),
    );
    expect((componentOf(stack).properties as Dict).defaultFilters).toEqual({ a: 1 });
    expect(notices).toEqual([]);
  });
});

describe('§3 identity and idempotence', () => {
  it('an already-converged rule array is untouched, by reference', () => {
    const before = pageWith({
      type: 'object-grid',
      properties: { objectName: 'deal', filter: [{ field: 'stage', operator: 'equals', value: 'open' }] },
    });
    const { stack, notices } = collectConversionNotices(before, { includeRetired: true });
    expect(stack).toBe(before);
    expect(notices).toEqual([]);
  });

  it('replaying the converted stack is a no-op', () => {
    const entry = ALL_CONVERSIONS.find((c) => c.id === ID)!;
    const once = convert(entry.fixture.before);
    expect(once.notices).toHaveLength(entry.fixture.expectedNotices);
    const twice = collectConversionNotices(once.stack, { includeRetired: true });
    expect(twice.stack).toBe(once.stack);
    expect(twice.notices).toEqual([]);
  });
});

describe('§4 lossless, measured over the declared vocabularies', () => {
  /** What the ruled mapping made of `{ f: { [op]: v } }`, or `undefined` when it declined. */
  function mappedOperator(op: string, v: unknown): string | undefined {
    const { value } = gridFilter({ f: { [op]: v } });
    if (!Array.isArray(value)) return undefined;
    expect(value).toHaveLength(1);
    return (value[0] as Dict).operator as string;
  }

  /** A comparand each FilterCondition operator can take, so the door is not what declines it. */
  const sample = (op: string): unknown =>
    op === '$in' || op === '$nin' ? ['a', 'b']
      : op === '$between' ? [1, 9]
        : op === '$null' || op === '$exists' ? true
          : 'x';

  it('every FilterCondition field operator maps to a rule that lowers back to it — or is declined', () => {
    const declined: string[] = [];
    for (const op of FILTER_OPERATORS) {
      const v = sample(op);
      const rule = mappedOperator(op, v);
      if (rule === undefined) {
        declined.push(op);
        continue;
      }
      const source = op === '$eq' ? { f: v } : { f: { [op]: v } };
      expect(parseFilterAST([['f', rule, v]]), `${op} → ${rule}`).toEqual(source);
    }
    // Exactly the two whose meaning lives in the VALUE, not the operator.
    expect(declined.sort()).toEqual(['$exists', '$null']);
  });

  it('every AST operator spelling maps to a rule that lowers exactly as the source did — or is declined', () => {
    const declined: string[] = [];
    for (const op of VALID_AST_OPERATORS) {
      const unary = /null|empty/.test(op);
      const listy = /^(in|nin|not_in|notin)$/.test(op);
      const node = unary ? ['f', op] : ['f', op, listy ? ['a'] : op === 'between' ? [1, 9] : 'x'];
      const { value } = gridFilter([node]);
      if (!Array.isArray(value) || Array.isArray(value[0])) {
        declined.push(op);
        continue;
      }
      const rule = value[0] as Dict;
      const ruleNode = 'value' in rule ? [rule.field, rule.operator, rule.value] : [rule.field, rule.operator];
      expect(parseFilterAST([ruleNode]), `${op} → ${String(rule.operator)}`).toEqual(parseFilterAST([node]));
    }
    // The raw LIKE pattern operators have no rule word; nothing else is declined.
    expect(declined.sort()).toEqual(['ilike', 'like']);
  });
});

describe('§5 what it writes, the doors accept', () => {
  const SOURCES: readonly unknown[] = [
    { stage: 'open', amount: { $gt: 100, $lte: 5000 } },
    [['owner_id', '=', '{current_user_id}'], ['deleted_at', 'is_null']],
    ['stage', 'in', ['open', 'won']],
    {},
  ];

  it.each(SOURCES.map((s) => [JSON.stringify(s), s] as const))(
    'the binding door accepts the conversion of %s, and refuses the source',
    (_name, source) => {
      const { stack } = convert(pageWith({ type: 'page:card', dataSource: { object: 'deal', filter: source } }));
      const converted = (componentOf(stack).dataSource as Dict).filter;
      expect(ElementDataSourceSchema.safeParse({ object: 'deal', filter: converted }).success).toBe(true);
      // Control: the door really judges this key — the unconverted source is refused there.
      const refused = ElementDataSourceSchema.safeParse({ object: 'deal', filter: source });
      expect(refused.success).toBe(false);
      expect(refused.error!.issues.some((i) => i.path[0] === 'filter')).toBe(true);
    },
  );
});

describe('§6 the reach is the family, read off the schema', () => {
  /** Does this schema refuse a record at `key` with the rule-array prescription? */
  function refusesRecordWithPrescription(schema: unknown, key: string): boolean {
    const parse = (schema as { safeParse?: (v: unknown) => { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } } }).safeParse;
    if (typeof parse !== 'function') return false;
    const result = parse.call(schema, { [key]: { status: 'active' } });
    if (result.success) return false;
    return result.error!.issues.some((i) => i.path.length === 1 && i.path[0] === key && i.message.includes(RULE_FORM));
  }

  /** Does the conversion rewrite a record at `properties.<key>` on a component of this type? */
  function converts(type: string, key: string): boolean {
    const { stack } = convert(pageWith({ type, properties: { [key]: { status: 'active' } } }));
    return Array.isArray((componentOf(stack).properties as Dict)[key]);
  }

  const TYPES = Object.keys(ComponentPropsMap) as Array<keyof typeof ComponentPropsMap>;

  it.each(['filter', 'defaultFilters'])('`properties.%s`: converted exactly where the door refuses the record', (key) => {
    const doors = TYPES.filter((t) => refusesRecordWithPrescription(ComponentPropsMap[t], key)).sort();
    const reached = TYPES.filter((t) => converts(t, key)).sort();
    // Lit control: the schema walk really found the family.
    expect(doors.length).toBeGreaterThan(0);
    expect(reached).toEqual(doors);
  });

  it('the binding door is on every component, so the binding converts on any type', () => {
    expect(refusesRecordWithPrescription(ElementDataSourceSchema, 'filter')).toBe(true);
    const { stack } = convert(pageWith({ type: 'page:card', dataSource: { object: 'deal', filter: { a: 1 } } }));
    expect((componentOf(stack).dataSource as Dict).filter).toEqual([{ field: 'a', operator: 'equals', value: 1 }]);
  });
});

describe('§7 jurisdiction — retired from authoring, replayed at rest and by the chain', () => {
  const authored = {
    name: 'probe',
    regions: [
      {
        name: 'main',
        components: [{ type: 'object-grid', properties: { objectName: 'deal', filter: { stage: 'open' } } }],
      },
    ],
  };

  it('⛔ the authoring funnel does not replay it — an author is still refused at the door', () => {
    const notices: ConversionNotice[] = [];
    const out = normalizeStackInput(
      { pages: [structuredClone(authored)] },
      { onConversionNotice: (n) => notices.push(n) },
    );
    expect((out.pages as Dict[])[0]).toEqual(authored);
    expect(notices.filter((n) => n.conversionId === ID)).toEqual([]);
  });

  it('the stored-row seam replays it', () => {
    const stored = applyConversionsToStoredItem('page', structuredClone(authored)) as Dict;
    const component = ((stored.regions as Dict[])[0]!.components as Dict[])[0]!;
    expect((component.properties as Dict).filter).toEqual([
      { field: 'stage', operator: 'equals', value: 'open' },
    ]);
  });

  it('`os migrate meta --from 17` replays it and lists the edit', () => {
    // Explicit `toMajor`: protocol 18 is the major in preparation, so the running
    // default would stop the chain at 17.
    const result = applyMetaMigrations({ pages: [structuredClone(authored)] }, 17, 18);
    const component = (((result.stack.pages as Dict[])[0]!.regions as Dict[])[0]!.components as Dict[])[0]!;
    expect((component.properties as Dict).filter).toEqual([
      { field: 'stage', operator: 'equals', value: 'open' },
    ]);
    expect(result.applied.filter((a) => a.conversionId === ID)).toHaveLength(1);
  });
});
