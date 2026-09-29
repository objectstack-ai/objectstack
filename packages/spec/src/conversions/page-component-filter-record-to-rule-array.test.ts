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
 *  §1  every ruled shape converts to the exact rule array, at every door kind,
 *      whether the block queries an object or carries its rows inline;
 *  §2  a combinator — record key or AST group — is left byte-identical, and so
 *      is every other shape with no lossless rule spelling;
 *  §3  an already-converged rule array is the identity, and a second replay is
 *      a no-op;
 *  §4  LOSSLESS is a measured property, not a claim: for every operator the
 *      FilterCondition and the AST declare, a mapped rule lowers through
 *      `parseFilterAST` to exactly what the source lowered to;
 *  §5  what the conversion writes is what the doors accept, so a converted row
 *      re-saves cleanly;
 *  §6  the reach is the family, derived from the schema rather than recalled;
 *  §7  the jurisdiction: retired from the authoring funnel (Clause-② no — an
 *      author is still refused), replayed at rest and by the migration chain;
 *  §8  the other half of ruling item 2: every legacy filter left as stored is
 *      REPORTED as a structured TODO (`onTodo`) naming its path, its block and
 *      what blocks the rewrite — the combinator by name — one per decline
 *      branch; a filter that converts, and a value that is no legacy form at
 *      all, reports none; and reporting writes nothing.
 */

import { describe, expect, it } from 'vitest';

import { StandardErrorCode } from '../api/errors.zod.js';
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
import { applyConversions, collectConversionNotices } from './apply.js';
import { ALL_CONVERSIONS } from './registry.js';
import { applyConversionsToStoredItem } from './stored.js';
import { CONVERSION_TODO_CODE, type ConversionNotice, type ConversionTodoNotice } from './types.js';

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

/**
 * Run the WHOLE chain (retired entries included, as the data-at-rest seams do),
 * collecting the notices AND the TODOs — the site this entry leaves as stored.
 */
function convert(stack: Dict): { stack: Dict; notices: ConversionNotice[]; todos: ConversionTodoNotice[] } {
  const notices: ConversionNotice[] = [];
  const todos: ConversionTodoNotice[] = [];
  const out = applyConversions(structuredClone(stack), {
    includeRetired: true,
    onNotice: (n) => notices.push(n),
    onTodo: (t) => todos.push(t),
  });
  return { stack: out, notices, todos };
}

/** The value a converted `properties.filter` on an `object-grid` ends up holding. */
function gridFilter(filter: unknown): { value: unknown; notices: ConversionNotice[]; todos: ConversionTodoNotice[] } {
  const { stack, notices, todos } = convert(pageWith({ type: 'object-grid', properties: { objectName: 'deal', filter } }));
  return { value: (componentOf(stack).properties as Dict).filter, notices, todos };
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

  describe('a component whose rows are INLINE converts like any other', () => {
    // Measured at the objectui pin `dd3f7e1be356`: object-map / -tree /
    // -calendar / -gantt hand `filter` to an in-memory ValueDataSource when
    // their rows are inline, and its `find` lowers a rule array through the
    // grid's own sink before matching — the same rows as the stored form, where
    // the fix's parent (no lowering) matched none. So the node's row source
    // moves no verdict, and the binding, composed into that same `filter`,
    // converts with it.
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
      const { stack, notices, todos } = convert(before);
      const component = componentOf(stack);
      expect((component.properties as Dict).filter).toEqual([
        { field: 'stage', operator: 'equals', value: 'open' },
      ]);
      expect((component.dataSource as Dict).filter).toEqual([
        { field: 'owner_id', operator: 'equals', value: 'u1' },
      ]);
      // The rows themselves ride along untouched.
      for (const [key, value] of Object.entries(inline)) {
        expect((component.properties as Dict)[key]).toEqual(value);
      }
      expect(notices.map((n) => n.path)).toEqual([
        'pages[0].regions[0].components[0].dataSource.filter',
        'pages[0].regions[0].components[0].properties.filter',
      ]);
      // Nothing left as stored, so nothing reported.
      expect(todos).toEqual([]);
    });

    it('`defaultFilters` on an inline-row grid converts too', () => {
      const { value, notices, todos } = (() => {
        const { stack, notices: n, todos: t } = convert(pageWith({
          type: 'object-grid',
          properties: { data: { provider: 'value', items: [] }, defaultFilters: { stage: 'open' } },
        }));
        return { value: (componentOf(stack).properties as Dict).defaultFilters, notices: n, todos: t };
      })();
      expect(value).toEqual([{ field: 'stage', operator: 'equals', value: 'open' }]);
      expect(notices.map((n) => n.path)).toEqual(['pages[0].regions[0].components[0].properties.defaultFilters']);
      expect(todos).toEqual([]);
    });

    it('control: the same filter on an object-bound block of the same type converts', () => {
      for (const data of [undefined, { provider: 'object', object: 'deal' }]) {
        const { stack, notices, todos } = convert(
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
        expect(todos).toEqual([]);
      }
    });
  });
});

describe('§2 what has no lossless rule spelling is left byte-identical', () => {
  // The ruled boundary first: a combinator is never flattened. The third
  // column is what the site's TODO must name (ruling item 2: "naming the
  // page/block and the combinator").
  const COMBINATOR_ROWS: ReadonlyArray<readonly [string, unknown, string]> = [
    ['$or', { $or: [{ stage: 'open' }, { stage: 'won' }] }, 'the combinator `$or`'],
    ['$and', { $and: [{ stage: 'open' }, { amount: { $gt: 1 } }] }, 'the combinator `$and`'],
    ['$not', { $not: { stage: 'lost' } }, 'the combinator `$not`'],
    ['$or beside a field key', { owner_id: 'u1', $or: [{ stage: 'open' }, { stage: 'won' }] }, 'the combinator `$or`'],
    ['an AST `and` group', ['and', ['stage', '=', 'open'], ['amount', '>', 1]], 'an `and` group'],
    ['an AST `or` group', ['or', ['stage', '=', 'open'], ['stage', '=', 'won']], 'an `or` group'],
    ['a flat list nesting an `or` group', [['owner_id', '=', 'u1'], ['or', ['a', '=', 1], ['b', '=', 2]]], 'an `or` group'],
  ];

  it.each(COMBINATOR_ROWS)('%s', (_name, filter, named) => {
    const before = pageWith({ type: 'object-kanban', properties: { objectName: 'deal', filter } });
    const { stack, notices, todos } = convert(before);
    expect((componentOf(stack).properties as Dict).filter).toEqual(filter);
    expect(notices).toEqual([]);
    // Left as stored, and SAID so: one TODO, at this door, naming the combinator.
    expect(todos).toHaveLength(1);
    expect(todos[0]!.path).toBe('pages[0].regions[0].components[0].properties.filter');
    expect(todos[0]!.reason).toContain(named);
    expect(todos[0]!.reason).toContain('the `object-kanban` block');
    // Copy-on-write: nothing on the way was rebuilt either.
    const frozen = structuredClone(before);
    expect(collectConversionNotices(frozen, { includeRetired: true }).stack).toBe(frozen);
  });

  // The third column is what the site's TODO must say, or `null` for the one
  // row that is not a legacy form at all (see the last row).
  const DECLINED_ROWS: ReadonlyArray<readonly [string, unknown, string | null]> = [
    // At the pin a null key constrains nothing where the block queries an object and selects
    // the null rows where its rows are inline — no one rule keeps both.
    ['a null value', { owner_id: null }, 'has the key `owner_id` set to null'],
    ['a null value beside a mappable key', { stage: 'open', owner_id: null }, 'has the key `owner_id` set to null'],
    // Direction lives in the VALUE — not in the one operator table.
    ['`$null`', { deleted_at: { $null: true } }, 'compares `deleted_at` with `$null`'],
    ['`$exists`', { deleted_at: { $exists: false } }, 'compares `deleted_at` with `$exists`'],
    ['an operator that is not a FilterCondition operator', { name: { $regex: 'a.c' } }, 'compares `name` with `$regex`'],
    ['a mis-cased operator', { amount: { $Gt: 1 } }, 'compares `amount` with `$Gt`'],
    ['an empty operator object', { amount: {} }, 'has the key `amount` set to an empty operator object'],
    ['a nested non-operator object', { owner: { id: 'u1' } }, 'a nested object whose key `id` is not a filter operator'],
    ['an array in equality position', { tags: ['a', 'b'] }, 'has the key `tags` set to an array'],
    ['a top-level `$` key that is not a combinator', { $text: 'acme' }, 'carries the top-level key `$text`, which is not a field'],
    ['a field-reference comparand', { amount: { $gt: { $field: 'budget' } } }, 'which this door refuses itself'],
    ['a comparand the door refuses (`in` needs a list)', { stage: { $in: 'open' } }, 'which this door refuses itself'],
    ['an empty `icontains` comparand', { name: { $icontains: '' } }, 'which this door refuses itself'],
    ['an AST operator with no rule word (`like`)', [['name', 'like', '%acme%']], 'compares `name` with the AST operator `like`'],
    ['an AST scalar comparison with no value', [['amount', '>']], 'which the AST itself does not lower'],
    // Neither a record nor an AST (`isFilterAST` refuses the rule object in it),
    // so not this conversion's form: no TODO. The door's own element-level
    // refusal (`filter.1`) is what names it.
    ['a mixed list of a rule object and an AST tuple', [{ field: 'a', operator: 'equals', value: 1 }, ['b', '=', 2]], null],
  ];

  it.each(DECLINED_ROWS)('%s', (_name, filter, said) => {
    const { value, notices, todos } = gridFilter(filter);
    expect(value).toEqual(filter);
    expect(notices).toEqual([]);
    if (said === null) {
      expect(todos).toEqual([]);
      return;
    }
    expect(todos).toHaveLength(1);
    expect(todos[0]!.reason).toContain(said);
    expect(todos[0]!.from).toBe(JSON.stringify(filter));
  });

  it('all-or-nothing: a declined key keeps the mappable keys beside it from converting', () => {
    // Converting `stage` alone would drop `deleted_at: { $null: true }` from an AND list — a wider filter.
    const { value } = gridFilter({ stage: 'open', deleted_at: { $null: true } });
    expect(value).toEqual({ stage: 'open', deleted_at: { $null: true } });
  });

  it('the `filter` of a component outside the family is not this entry\'s surface', () => {
    const before = pageWith({ type: 'record:related_list', properties: { objectName: 'deal', filter: { a: 1 } } });
    const { stack, notices, todos } = convert(before);
    expect((componentOf(stack).properties as Dict).filter).toEqual({ a: 1 });
    expect(notices).toEqual([]);
    // Not this entry's door, so not this entry's TODO either.
    expect(todos).toEqual([]);
  });

  it('`defaultFilters` is converted on the grid only', () => {
    const { stack, notices, todos } = convert(
      pageWith({ type: 'object-kanban', properties: { objectName: 'deal', defaultFilters: { a: 1 } } }),
    );
    expect((componentOf(stack).properties as Dict).defaultFilters).toEqual({ a: 1 });
    expect(notices).toEqual([]);
    expect(todos).toEqual([]);
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

  it('a rule array reports nothing either — it is not a legacy form', () => {
    const { todos } = gridFilter([{ field: 'stage', operator: 'equals', value: 'open' }]);
    expect(todos).toEqual([]);
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
    // Exactly the three whose meaning lives in the VALUE, not the operator
    // (`$empty` joined `FILTER_OPERATORS` in #20446: its `true` / `false` is
    // `is_empty` / `is_not_empty`).
    expect(declined.sort()).toEqual(['$empty', '$exists', '$null']);
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

  // The block doors on an inline-row node: what the rewrite writes there is
  // what the door takes, so moving these rows off the TODO list refuses nothing.
  it.each([
    ['object-map', { data: { provider: 'value', items: [{ stage: 'open' }] } }],
    ['object-tree', { data: { provider: 'value', items: [{ stage: 'open' }] } }],
    ['object-gantt', { data: { provider: 'value', items: [{ stage: 'open' }] } }],
    ['object-calendar', { staticData: [{ stage: 'open' }] }],
    ['object-kanban', { data: [{ stage: 'open' }] }],
  ] as const)('an inline-row `%s`: its block door accepts the conversion, and refuses the source', (type, inline) => {
    const source = { stage: 'open', amount: { $gt: 100 } };
    const { stack } = convert(pageWith({ type, properties: { objectName: 'deal', ...inline, filter: source } }));
    const converted = componentOf(stack).properties as Dict;
    const door = ComponentPropsMap[type as keyof typeof ComponentPropsMap] as unknown as {
      safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ path: PropertyKey[] }> } };
    };
    const atFilter = (v: unknown): number =>
      door.safeParse(v).error?.issues.filter((i) => i.path[0] === 'filter').length ?? 0;
    expect(Array.isArray(converted.filter)).toBe(true);
    expect(atFilter(converted)).toBe(0);
    // Control: the door really judges this key — the unconverted source is refused there.
    expect(atFilter({ objectName: 'deal', ...inline, filter: source })).toBeGreaterThan(0);
  });
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

describe('§8 the TODO channel — every site left as stored is reported (ruling item 2)', () => {
  // One row per DECLINE BRANCH of the entry, named for the branch in
  // `registry.ts` it exercises. §2 pins the same property over the rows the
  // first half of this card measured; this table is the branch census the
  // report enumerates, so a branch added without a TODO shows up here.
  const BRANCHES: ReadonlyArray<readonly [string, unknown, string]> = [
    ['record: a combinator key', { $or: [{ a: 1 }, { b: 2 }] }, 'carries the combinator `$or`'],
    ['record: a combinator beside a non-combinator `$` key', { $and: [{ a: 1 }], $text: 'x' }, 'carries the combinator `$and` (its top-level `$text` is not a field either)'],
    ['record: two combinators', { $or: [{ a: 1 }], $not: { b: 2 } }, 'carries the combinators `$or` and `$not`'],
    ['record: a non-combinator `$` key', { $where: 'x' }, 'carries the top-level key `$where`, which is not a field'],
    ['record: a combinator is named even when a field key would decline first', { owner_id: null, $or: [{ a: 1 }] }, 'carries the combinator `$or`'],
    ['record: a null value', { a: null }, 'has the key `a` set to null'],
    ['record: an array value', { a: [1, 2] }, 'has the key `a` set to an array'],
    ['record: a non-plain object value', { a: new Date(0) }, 'set to a value that is neither a scalar nor an operator object'],
    ['record: an empty operator object', { a: {} }, 'set to an empty operator object'],
    ['record: an operator outside the one table', { a: { $exists: true } }, 'compares `a` with `$exists`'],
    ['record: a nested object that is not an operator object', { a: { b: 1 } }, 'nested object whose key `b` is not a filter operator'],
    ['AST: an `and` / `or` group', ['or', ['a', '=', 1], ['b', '=', 2]], 'is a nested ObjectQL AST holding an `or` group'],
    ['AST: neither one comparison nor a flat list', ['a', '=', 1, 2], 'neither one comparison `[field, operator, value]` nor a flat list'],
    ['AST: a comparison the AST refuses to lower', [['a', '>']], 'holds the AST comparison `["a",">"]`, which the AST itself does not lower'],
    ['AST: an operator with no rule word', [['a', 'ilike', '%x%']], 'compares `a` with the AST operator `ilike`'],
    ['door: a mapped rule the door refuses', { a: { $in: 'x' } }, 'would become the rule `{"field":"a","operator":"in","value":"x"}`, which this door refuses itself ('],
  ];

  it.each(BRANCHES)('%s', (_branch, filter, said) => {
    const { value, notices, todos } = gridFilter(filter);
    expect(value).toEqual(filter);
    expect(notices).toEqual([]);
    expect(todos).toHaveLength(1);
    const [todo] = todos;
    expect(todo!.code).toBe(CONVERSION_TODO_CODE);
    expect(todo!.conversionId).toBe(ID);
    expect(todo!.surface).toBe(ALL_CONVERSIONS.find((c) => c.id === ID)!.surface);
    expect(todo!.path).toBe('pages[0].regions[0].components[0].properties.filter');
    expect(todo!.from).toBe(JSON.stringify(filter));
    expect(todo!.reason).toContain(said);
    // The tail every TODO of this entry carries: what happens to the row next.
    expect(todo!.reason).toMatch(/Left as stored, it keeps loading unchanged, but it is not the rule-array form its door declares — rewrite it by hand\.$/);
    expect(todo!.message).toContain(`at ${todo!.path} as stored`);
    expect(todo!.message).toContain(todo!.reason);
  });

  it('an inline-row node is no decline branch: a filter that maps converts there, and reports no TODO', () => {
    const { value, notices, todos } = (() => {
      const r = convert(pageWith({ type: 'object-map', properties: { staticData: [], filter: { a: 1 } } }));
      return { value: (componentOf(r.stack).properties as Dict).filter, notices: r.notices, todos: r.todos };
    })();
    expect(value).toEqual([{ field: 'a', operator: 'equals', value: 1 }]);
    expect(notices).toHaveLength(1);
    expect(todos).toEqual([]);
  });

  it('on an inline-row node a combinator is still a TODO, in the very words an object-bound block gets', () => {
    const inline = convert(
      pageWith({ type: 'object-map', properties: { staticData: [], filter: { $or: [{ a: 1 }] } } }),
    );
    const bound = convert(
      pageWith({ type: 'object-map', properties: { objectName: 'deal', filter: { $or: [{ a: 1 }] } } }),
    );
    expect((componentOf(inline.stack).properties as Dict).filter).toEqual({ $or: [{ a: 1 }] });
    expect(inline.todos).toHaveLength(1);
    expect(inline.todos[0]!.reason).toContain('carries the combinator `$or`');
    // Nothing about the rows' source is said, because nothing about it decides.
    expect(inline.todos[0]!.reason).toBe(bound.todos[0]!.reason);
  });

  it('a null-valued key is a TODO in the same words on an inline-row node and an object-bound one, naming an `is_null` rule its door takes', () => {
    // At the objectui pin the key constrains nothing where the block queries an
    // object and selects the rows whose value is null where its rows are inline,
    // so no one rule keeps both: the one reason has to be true on either block.
    const inline = convert(
      pageWith({ type: 'object-map', properties: { staticData: [], filter: { owner_id: null } } }),
    );
    const bound = convert(
      pageWith({ type: 'object-map', properties: { objectName: 'deal', filter: { owner_id: null } } }),
    );
    expect((componentOf(inline.stack).properties as Dict).filter).toEqual({ owner_id: null });
    expect(inline.todos).toHaveLength(1);
    expect(inline.todos[0]!.reason).toBe(bound.todos[0]!.reason);
    const rule = { field: 'owner_id', operator: 'is_null' };
    expect(inline.todos[0]!.reason).toContain(JSON.stringify(rule));
    // The rule it names is one the block's door takes.
    const door = ComponentPropsMap['object-map'] as unknown as {
      safeParse: (v: unknown) => { error?: { issues: Array<{ path: PropertyKey[] }> } };
    };
    const atFilter = (v: unknown): number =>
      door.safeParse(v).error?.issues.filter((i) => i.path[0] === 'filter').length ?? 0;
    expect(atFilter({ objectName: 'deal', filter: [rule] })).toBe(0);
    // Control: the door really judges this key — the stored record is refused there.
    expect(atFilter({ objectName: 'deal', filter: { owner_id: null } })).toBeGreaterThan(0);
  });

  it('an empty operator object is a TODO in the same words on an inline-row node and an object-bound one, naming the refusal the renderer answers', () => {
    // At the objectui pin the renderer refuses `{ amount: {} }` rather than
    // ignoring it — `INVALID_FILTER` where the block queries an object, no rows
    // where its rows are inline — and the one reason says so on either block.
    const inline = convert(
      pageWith({ type: 'object-map', properties: { staticData: [], filter: { amount: {} } } }),
    );
    const bound = convert(
      pageWith({ type: 'object-map', properties: { objectName: 'deal', filter: { amount: {} } } }),
    );
    expect((componentOf(inline.stack).properties as Dict).filter).toEqual({ amount: {} });
    expect(inline.todos).toHaveLength(1);
    expect(inline.todos[0]!.reason).toBe(bound.todos[0]!.reason);
    const code = 'INVALID_FILTER';
    // The code it names is one the platform declares.
    expect(StandardErrorCode.options).toContain(code);
    expect(inline.todos[0]!.reason).toContain(`\`${code}\``);
  });

  it('names the block by its type, and by its `id` when it has one', () => {
    const { todos } = convert(
      pageWith({ type: 'object-kanban', id: 'pipeline_board', properties: { objectName: 'deal', filter: { $or: [] } } }),
    );
    expect(todos[0]!.reason).toMatch(/^On the `object-kanban` block `pipeline_board`, this filter carries/);
    const anonymous = convert(pageWith({ type: 'object-kanban', properties: { objectName: 'deal', filter: { $or: [] } } }));
    expect(anonymous.todos[0]!.reason).toMatch(/^On the `object-kanban` block, this filter carries/);
  });

  it('control: every shape that converts losslessly reports NO TODO', () => {
    for (const filter of [
      { stage: 'open', score: 3 },
      { amount: { $gt: 100, $lte: 5000 } },
      [['owner_id', '=', '{current_user_id}'], ['deleted_at', 'is_null']],
      ['status', '!=', 'done'],
      {},
    ]) {
      const { value, notices, todos } = gridFilter(filter);
      expect(Array.isArray(value), JSON.stringify(filter)).toBe(true);
      expect(notices, JSON.stringify(filter)).toHaveLength(1);
      expect(todos, JSON.stringify(filter)).toEqual([]);
    }
  });

  it('control: a value that is not a legacy form is neither converted nor reported', () => {
    for (const filter of [[], [{ field: 'a', operator: 'equals', value: 1 }], 'status = open', 42]) {
      const { value, notices, todos } = gridFilter(filter);
      expect(value, JSON.stringify(filter)).toEqual(filter);
      expect(notices, JSON.stringify(filter)).toEqual([]);
      expect(todos, JSON.stringify(filter)).toEqual([]);
    }
  });

  it('one page, two blocks: the lossless filter converts, the combinator one is a TODO', () => {
    const { stack, notices, todos } = convert({
      pages: [
        {
          name: 'pipeline',
          regions: [
            {
              name: 'main',
              components: [
                { type: 'object-grid', properties: { objectName: 'deal', filter: { stage: 'open' } } },
                { type: 'object-kanban', properties: { objectName: 'deal', filter: { $or: [{ stage: 'open' }, { stage: 'won' }] } } },
              ],
            },
          ],
        },
      ],
    });
    const components = ((stack.pages as Dict[])[0]!.regions as Dict[])[0]!.components as Dict[];
    expect((components[0]!.properties as Dict).filter).toEqual([{ field: 'stage', operator: 'equals', value: 'open' }]);
    expect((components[1]!.properties as Dict).filter).toEqual({ $or: [{ stage: 'open' }, { stage: 'won' }] });
    expect(notices.map((n) => n.path)).toEqual(['pages[0].regions[0].components[0].properties.filter']);
    expect(todos.map((t) => t.path)).toEqual(['pages[0].regions[0].components[1].properties.filter']);
  });

  it('the fixture: its one stored-as-is site is its one TODO — the inline-row map converts', () => {
    const entry = ALL_CONVERSIONS.find((c) => c.id === ID)!;
    const { notices, todos } = convert(entry.fixture.before);
    expect(todos.map((t) => [t.path, t.reason.slice(0, 40)])).toEqual([
      ['pages[0].regions[0].components[1].properties.filter', 'On the `object-kanban` block, this filte'],
    ]);
    expect(notices.map((n) => n.path)).toContain('pages[0].regions[0].components[2].properties.filter');
  });

  it('reporting writes nothing: every decline yields the same stack with or without a sink', () => {
    for (const [, filter] of BRANCHES) {
      const before = pageWith({ type: 'object-grid', properties: { objectName: 'deal', filter } });
      const withSink = convert(before).stack;
      const frozen = structuredClone(before);
      // No sink at all — the authoring funnel's and every other seam's posture.
      const without = applyConversions(frozen, { includeRetired: true });
      expect(without).toBe(frozen);
      expect(JSON.stringify(withSink)).toBe(JSON.stringify(before));
    }
  });
});
