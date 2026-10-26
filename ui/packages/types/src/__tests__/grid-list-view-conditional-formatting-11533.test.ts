/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `conditionalFormatting` on `object-grid` (`ObjectGridSchema`, and the
 * `object-view` `table` slot built from it) and on `list-view` speaks ONE rule
 * dialect — the spec list view's `{ condition, style }` — and refuses the native
 * dialect BY NAME (objectui#11533; triage ruling 5965301211: retire, as
 * objectui#11522 ruled for `object-kanban`, no alias window).
 *
 * The retired spellings, each refused at its OWN key:
 *
 *   - the native comparison `{ field, operator, value }`,
 *   - its template predicate `expression`,
 *   - a colour at the TOP LEVEL of a rule — `backgroundColor`, `borderColor`,
 *     `textColor` — on the native rule, beside an `expression`, or beside a CEL
 *     `condition` (the "flat CEL" rule) instead of inside `style`.
 *
 * Each refusal is read on every zod face an author meets: the two mirrors
 * (`ObjectGridSchema`, `ListViewSchema`), the tolerant document face
 * (`safeValidateSchema`) and the strict authoring face
 * (`StrictAnyComponentSchema`), the last two on a page `list-view` node (its
 * props in the `properties` bag since objectui#12670) and on an
 * `object-view` `table` slot. A bare `success: false` would not be a refusal pin
 * (a document with an unrelated mistake fails too), so each assertion reads the
 * issue at the retired key's path and its message. The accepted
 * `{ condition, style }` rule at index 0 of the same document is the live
 * control on every face.
 *
 * ⚠️ The authored `object-grid` NODE is not one of these faces: its props are
 * the `properties` bag, which is `@objectstack/spec`'s
 * `ComponentPropsMap['object-grid']` row by reference, and the installed row
 * types `conditionalFormatting` as `unknown`. It is the spec's member, not
 * objectui's rule, so it is not narrowed here.
 *
 * Stored stock is not authoring: the shared resolver keeps every arm, so a grid
 * or list view STORED with a retired rule still paints. That half is pinned at
 * the renderer, in `@object-ui/plugin-grid`'s
 * `gridRowDecorationMembers-8071.test.tsx` and `@object-ui/plugin-list`'s
 * `ListView.storedRuleDialect-11533.test.tsx`.
 *
 * The TS face is pinned by `tsc -p tsconfig.test.json` (this package's
 * `type-check`): the `@ts-expect-error` lines below fail the build the moment a
 * retired key type-checks again.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import type { z } from 'zod';
import { ListViewSchema as SpecListViewSchema } from '@objectstack/spec/ui';
import {
  ListViewSchema,
  ObjectGridSchema,
  safeValidateSchema,
  StrictAnyComponentSchema,
} from '../zod/index.zod';
import { KanbanConditionalFormattingRuleSchema } from '../zod/objectql.zod';
import type {
  ConditionalFormattingRule,
  ListViewSchema as ListViewSchemaType,
  NamedListView,
  ObjectGridSchema as ObjectGridSchemaType,
  SpecConditionalFormattingRule,
} from '../objectql';

/** The accepted spelling — and the live control in every mixed document below. */
const SPEC_RULE = { condition: "record.status == 'done'", style: { backgroundColor: '#e0ffe0' } };

/** The retired native rule, as the grid and the list view used to accept it. */
const NATIVE_RULE = { field: 'priority', operator: 'equals', value: 'high', backgroundColor: '#fee2e2' };

/** The retired template predicate, beside a colour. */
const EXPRESSION_RULE = { expression: '${record.amount > 1000}', backgroundColor: '#fee2e2' };

/** The retired flat CEL rule: the colour beside `condition`, not inside `style`. */
const FLAT_CEL_RULE = { condition: "record.owner == 'bob'", backgroundColor: 'rgb(4, 5, 6)' };

type Issue = { code: string; path: PropertyKey[]; message: string; keys?: string[] };
type Parsed = { success: boolean; error?: { issues: Issue[] } };

/**
 * Each face: how to wrap a rule list into the document it judges, the path
 * prefix of the member inside that document, and the parse.
 */
type Face = readonly [
  label: string,
  wrap: (rules: unknown[]) => unknown,
  prefix: string,
  parse: (doc: unknown) => Parsed,
];

const grid = (rules: unknown[]) => ({ type: 'object-grid', objectName: 'task', conditionalFormatting: rules });
const listView = (rules: unknown[]) => ({ type: 'list-view', objectName: 'task', conditionalFormatting: rules });
const objectView = (rules: unknown[]) => ({ type: 'object-view', objectName: 'task', table: { conditionalFormatting: rules } });
/** objectui#12670: the authored page `list-view` the published faces judge — its props in the bag, its object in `data`. */
const listViewPage = (rules: unknown[]) => ({
  type: 'list-view',
  properties: { data: { provider: 'object', object: 'task' }, conditionalFormatting: rules },
});

const FACES: readonly Face[] = [
  ['ObjectGridSchema (the grid mirror)', grid, 'conditionalFormatting', (d) => ObjectGridSchema.safeParse(d) as never],
  ['ListViewSchema (the list-view mirror)', listView, 'conditionalFormatting', (d) => ListViewSchema.safeParse(d) as never],
  ['safeValidateSchema on a `list-view` node', listViewPage, 'properties.conditionalFormatting', (d) => safeValidateSchema(d) as never],
  ['StrictAnyComponentSchema on a `list-view` node', listViewPage, 'properties.conditionalFormatting', (d) => StrictAnyComponentSchema.safeParse(d) as never],
  ['safeValidateSchema on an `object-view` `table` slot', objectView, 'table.conditionalFormatting', (d) => safeValidateSchema(d) as never],
  ['StrictAnyComponentSchema on an `object-view` `table` slot', objectView, 'table.conditionalFormatting', (d) => StrictAnyComponentSchema.safeParse(d) as never],
];

/** The issue a face reports at `<member>[index].key`, if any. */
function issueAt(face: Face, rules: unknown[], index: number, key: string): Issue | undefined {
  const [, wrap, prefix, parse] = face;
  return parse(wrap(rules)).error?.issues.find((i) => i.path.join('.') === `${prefix}.${index}.${key}`);
}

/** What every retirement message must carry: the key, the card and the one spelling that replaces the rule. */
function expectRetirement(issue: Issue | undefined, key: string): void {
  expect(issue, `no issue at the retired key \`${key}\``).toBeDefined();
  expect(issue!.code).toBe('invalid_type');
  expect(issue!.message.startsWith(`\`${key}\``), issue!.message).toBe(true);
  expect(issue!.message).toContain('RETIRED (objectui#11533)');
  expect(issue!.message).toContain('`{ condition, style }`');
}

describe.each(FACES)('objectui#11533 — `conditionalFormatting` on %s', (...face) => {
  const [, wrap, prefix, parse] = face;

  it('CONTROL — the spec `{ condition, style }` rule is accepted, with a string or an envelope condition', () => {
    expect(parse(wrap([SPEC_RULE])).success).toBe(true);
    expect(parse(wrap([{ condition: { dialect: 'cel', source: "record.status == 'done'" }, style: { color: 'red' } }])).success).toBe(true);
  });

  it('refuses the native `{ field, operator, value, backgroundColor }` rule BY NAME, at each retired key', () => {
    // Index 1: the accepted rule at index 0 draws no issue in the same parse.
    const rules = [SPEC_RULE, NATIVE_RULE];
    const parsed = parse(wrap(rules));
    expect(parsed.success).toBe(false);
    for (const key of ['field', 'operator', 'value']) {
      const issue = issueAt(face, rules, 1, key);
      expectRetirement(issue, key);
      expect(issue!.message).toContain('native rule dialect');
      expect(issue!.message).toContain('`{ condition: "record.priority == \'high\'", style: { backgroundColor: \'#fee2e2\' } }`');
    }
    expectRetirement(issueAt(face, rules, 1, 'backgroundColor'), 'backgroundColor');
    expect(parsed.error!.issues.filter((i) => i.path.join('.').startsWith(`${prefix}.0`))).toEqual([]);
  });

  it('refuses `expression` BY NAME, with the `condition` respelling', () => {
    const rules = [SPEC_RULE, EXPRESSION_RULE];
    const issue = issueAt(face, rules, 1, 'expression');
    expectRetirement(issue, 'expression');
    expect(issue!.message).toContain('`{ condition: \'record.amount > 1000\', style: { backgroundColor: \'#fee2e2\' } }`');
  });

  it('refuses the flat CEL rule — a top-level colour beside `condition` — BY NAME, with the `style` respelling', () => {
    const rules = [SPEC_RULE, FLAT_CEL_RULE];
    const issue = issueAt(face, rules, 1, 'backgroundColor');
    expectRetirement(issue, 'backgroundColor');
    expect(issue!.message).toContain('`style: { backgroundColor }`');
    // ⛔ Not the generic union failure it used to be: with one dialect left there
    // is no union to fail, and no issue sits at the bare rule path.
    const parsed = parse(wrap(rules));
    expect(parsed.error!.issues.some((i) => i.code === 'invalid_union' && i.path.join('.') === `${prefix}.1`)).toBe(false);
  });

  it('a top-level colour is refused even beside a `style` map, and so are the other two colour keys', () => {
    // The tolerant face used to ACCEPT `{ condition, style, backgroundColor }`
    // (the spec arm was a stripping `z.object`) while the shared resolver
    // painted the stripped key over `style` anyway.
    for (const key of ['backgroundColor', 'borderColor', 'textColor']) {
      expectRetirement(issueAt(face, [{ ...SPEC_RULE, [key]: 'red' }], 0, key), key);
    }
    expect(issueAt(face, [{ ...SPEC_RULE, textColor: 'red' }], 0, 'textColor')!.message).toContain('`style: { color }`');
  });

  it('inherits the spec rule\'s strictness: an undeclared key is refused with the spec\'s own message', () => {
    const parsed = parse(wrap([{ ...SPEC_RULE, label: 'Done' }]));
    expect(parsed.success).toBe(false);
    const issue = parsed.error!.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue?.path.join('.')).toBe(`${prefix}.0`);
    expect(issue?.keys).toEqual(['label']);
    expect(issue?.message).toContain('Unrecognized key(s) on this conditional formatting rule');
  });
});

describe('objectui#11533 — the grid\'s and the list view\'s rule IS the spec list view\'s, by reference', () => {
  const specRule = SpecListViewSchema.shape.conditionalFormatting.unwrap().element;
  type Shaped = { shape: Record<string, unknown> };
  const gridRule = ObjectGridSchema.shape.conditionalFormatting.unwrap().element as unknown as Shaped;
  const listRule = ListViewSchema.shape.conditionalFormatting.unwrap().element as unknown as Shaped;

  it('is ONE declaration, shared by the two mirrors', () => {
    expect(gridRule).toBe(listRule);
  });

  it('`style` is the spec rule\'s own member (identity, not a copy)', () => {
    expect(gridRule.shape.style).toBe(specRule.shape.style);
  });

  it('`condition` is objectui\'s string arm, then the spec slot BY REFERENCE — the arm the kanban rule reads too', () => {
    type UnionOf = { options: readonly unknown[] };
    const condition = gridRule.shape.condition as UnionOf;
    expect(condition.options[1]).toBe(specRule.shape.condition);
    // The kanban rule's `condition` is the same union, re-described for the card
    // (`.describe()` returns a copy, so the arms are compared, not the union).
    const kanbanCondition = (KanbanConditionalFormattingRuleSchema as unknown as Shaped).shape.condition as UnionOf;
    expect(kanbanCondition.options[1]).toBe(condition.options[1]);
    expect(kanbanCondition.options[0]).toBe(condition.options[0]);
  });

  it('CONTROL — the identity checks can fail: `condition` is NOT the bare spec slot', () => {
    expect(gridRule.shape.condition).not.toBe(specRule.shape.condition);
  });

  it('the spec rule alone refuses the same native rule — the strictness is the spec\'s, not a local copy', () => {
    expect(specRule.safeParse(NATIVE_RULE).success).toBe(false);
    expect(specRule.safeParse(SPEC_RULE).success).toBe(true);
  });
});

/* ── the TS face (tsc is the pin) ────────────────────────────────────────── */

const accepted: ConditionalFormattingRule = SPEC_RULE;

const envelope: ConditionalFormattingRule = {
  condition: { dialect: 'cel', source: "record.status == 'done'" },
  style: { borderColor: 'red' },
};

const nativeRefused: ConditionalFormattingRule = {
  // @ts-expect-error — `field` is `?: never` (objectui#11533): the native rule dialect is retired.
  field: 'priority',
  // @ts-expect-error — `operator` is `?: never`.
  operator: 'equals',
  // @ts-expect-error — `value` is `?: never`.
  value: 'high',
  condition: "record.priority == 'high'",
  style: {},
};

const expressionRefused: ConditionalFormattingRule = {
  condition: 'record.amount > 1000',
  style: {},
  // @ts-expect-error — `expression` is `?: never` (objectui#11533): write the predicate as `condition`.
  expression: '${record.amount > 1000}',
};

const flatColourRefused: ConditionalFormattingRule = {
  condition: "record.owner == 'bob'",
  style: {},
  // @ts-expect-error — a top-level colour is `?: never` (objectui#11533): it belongs in `style`.
  backgroundColor: 'rgb(4, 5, 6)',
};

// @ts-expect-error — the flat CEL rule has no `style`, which the rule requires.
const flatCelMissingStyle: ConditionalFormattingRule = { condition: "record.owner == 'bob'" };

// The members that carry the rule: the grid's, the list view's and the named view's.
const gridNode: ObjectGridSchemaType = {
  type: 'object-grid',
  objectName: 'task',
  // @ts-expect-error — the grid's member takes `ConditionalFormattingRule`: the native rule is refused.
  conditionalFormatting: [NATIVE_RULE],
};

const listNode: ListViewSchemaType = {
  type: 'list-view',
  objectName: 'task',
  // @ts-expect-error — the list view's member is `z.input` of the narrowed zod rule.
  conditionalFormatting: [NATIVE_RULE],
};

describe('objectui#11533 — the TS face agrees with the zod face', () => {
  it('a `{ condition, style }` rule (string or envelope condition) is the declared rule', () => {
    expect(accepted.condition).toBe("record.status == 'done'");
    expect(envelope.style).toEqual({ borderColor: 'red' });
    // The refused literals above are referenced so they are not dead code; tsc is their pin.
    expect([nativeRefused, expressionRefused, flatColourRefused, flatCelMissingStyle, gridNode, listNode].length).toBe(6);
  });

  it('the two faces declare the same keys, and the rule is the spec-format rule plus the tombstones', () => {
    type ZodIn = NonNullable<z.input<typeof ObjectGridSchema>['conditionalFormatting']>[number];
    expectTypeOf<keyof ConditionalFormattingRule>().toEqualTypeOf<keyof ZodIn>();
    expectTypeOf<ZodIn['condition']>().toEqualTypeOf<ConditionalFormattingRule['condition']>();
    expectTypeOf<ZodIn['style']>().toEqualTypeOf<ConditionalFormattingRule['style']>();
    // Every retired key is unwritable on both faces (`?: never` / `z.never().optional()`).
    expectTypeOf<NonNullable<ZodIn['field']>>().toBeNever();
    expectTypeOf<NonNullable<ZodIn['expression']>>().toBeNever();
    expectTypeOf<NonNullable<ConditionalFormattingRule['expression']>>().toBeNever();
    expectTypeOf<NonNullable<ConditionalFormattingRule['backgroundColor']>>().toBeNever();
    // And the accepted rule is exactly the shared spec-format rule.
    expectTypeOf<SpecConditionalFormattingRule>().toMatchTypeOf<ConditionalFormattingRule>();
  });

  it('the grid\'s, the list view\'s and the named view\'s members all carry the one rule', () => {
    type ListRule = NonNullable<ListViewSchemaType['conditionalFormatting']>[number];
    expectTypeOf<NonNullable<ObjectGridSchemaType['conditionalFormatting']>[number]>().toEqualTypeOf<ConditionalFormattingRule>();
    expectTypeOf<NonNullable<NamedListView['conditionalFormatting']>[number]>().toEqualTypeOf<ConditionalFormattingRule>();
    expectTypeOf<keyof ListRule>().toEqualTypeOf<keyof ConditionalFormattingRule>();
    expectTypeOf<NonNullable<ListRule['field']>>().toBeNever();
  });
});
