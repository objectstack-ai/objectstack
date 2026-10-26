/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10946 — `SpecConditionalFormattingRule.condition` and
 * `BulkActionDef.visible` read the named view's expression slots BY REFERENCE.
 *
 * Before this card `condition` was `string` alone and `visible` had no arm for
 * the protocol's envelope (on the installed spec its `source` is optional and
 * it may carry `ast` / `meta`). Both were narrower than `ObjectListViewSchema`
 * declares and than `ObjectGrid`'s evaluator reads, so every relay of a named
 * view into a grid needed a type assertion.
 *
 * ## Where each half bites
 *
 * - The TYPE pins are checked by `tsc -p tsconfig.test.json` (this package's
 *   `type-check` script), not by vitest. Every relay below is an assignment
 *   written WITHOUT an assertion, so a narrower declaration fails the build.
 *   The `it` blocks that hold them only keep the values referenced.
 * - The ZOD pins run here. The mirror keeps `z.string()` as its FIRST arm, so a
 *   string condition parses exactly as before, and reads the spec's own slot
 *   schema for the envelope. Both properties are asserted, each with a control.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import type { z } from 'zod';
import {
  ListViewSchema as SpecListViewSchema,
  type ObjectListViewSchema as SpecObjectListViewSchema,
} from '@objectstack/spec/ui';
import type {
  BulkActionDef,
  ConditionalFormattingRule,
  KanbanConditionalFormattingRule,
  SpecConditionalFormattingRule,
} from '../objectql';
import { ListViewSchema, ObjectKanbanSchema } from '../zod/index.zod';
import { KanbanConditionalFormattingRuleSchema } from '../zod/objectql.zod';

/* ── the protocol's own values, as a relay receives them ─────────────────── */

type NamedView = z.input<typeof SpecObjectListViewSchema>;
type NamedViewRule = NonNullable<NamedView['conditionalFormatting']>[number];
type NamedViewBulkDef = NonNullable<NamedView['bulkActionDefs']>[number];

// The relays `ObjectView` (route 2) performs, as plain assignments.
const relayRule = (rule: NamedViewRule): SpecConditionalFormattingRule => rule;
const relayGridRules = (rules: NamedView['conditionalFormatting']): ConditionalFormattingRule[] | undefined => rules;
const relayKanbanRule = (rule: NamedViewRule): KanbanConditionalFormattingRule => rule;
const relayBulkDefs = (defs: NamedView['bulkActionDefs']): BulkActionDef[] | undefined => defs;
const relayVisible = (visible: NamedViewBulkDef['visible']): BulkActionDef['visible'] => visible;

/* ── authored literals ───────────────────────────────────────────────────── */

const envelopeRule: SpecConditionalFormattingRule = {
  condition: { dialect: 'cel', source: "record.stage == 'won'" },
  style: { backgroundColor: '#dcfce7' },
};

// CONTROL — the string form the member declared before is still declared.
const stringRule: SpecConditionalFormattingRule = {
  condition: "record.stage == 'won'",
  style: { backgroundColor: '#dcfce7' },
};

const invalidRule: SpecConditionalFormattingRule = {
  // @ts-expect-error — a number is no predicate: the widening is to the spec's slot, not to `unknown`.
  condition: 42,
  style: {},
};

// The member the card names: an envelope that carries `ast` beside `source`.
const visibleWithAst: BulkActionDef = {
  name: 'close_all',
  operation: 'custom',
  visible: { dialect: 'cel', source: '!record.done', ast: { op: 'not' } },
};

// CONTROL — the arm `visible` declared before (`ExpressionWire`, dialect optional) is kept.
const visibleWire: BulkActionDef = {
  name: 'close_all',
  operation: 'custom',
  visible: { source: '!record.done' },
};

describe('objectui#10946 — the TS faces admit the named view\'s expression slots (tsc is the pin)', () => {
  it('a named view\'s rules and bulk defs relay into the grid-facing declarations without an assertion', () => {
    expect([relayRule, relayGridRules, relayKanbanRule, relayBulkDefs, relayVisible].every((f) => typeof f === 'function')).toBe(true);
  });

  it('an envelope condition and an envelope `visible` carrying `ast` are declared; the string and wire forms still are', () => {
    expect(envelopeRule.condition).toEqual({ dialect: 'cel', source: "record.stage == 'won'" });
    expect(stringRule.condition).toBe("record.stage == 'won'");
    expect(visibleWithAst.visible).toHaveProperty('ast');
    expect(visibleWire.visible).toEqual({ source: '!record.done' });
    expect(invalidRule.style).toEqual({});
  });

  it('the zod mirror\'s `condition` input is the TS member, by construction', () => {
    // One dialect on both rules — the list view's since objectui#11533, the kanban
    // board's since objectui#11522 — so there is no union arm to extract.
    type MirrorRule = NonNullable<z.input<typeof ListViewSchema>['conditionalFormatting']>[number];
    type KanbanMirrorRule = z.input<typeof KanbanConditionalFormattingRuleSchema>;
    expectTypeOf<MirrorRule['condition']>().toEqualTypeOf<SpecConditionalFormattingRule['condition']>();
    expectTypeOf<KanbanMirrorRule['condition']>().toEqualTypeOf<SpecConditionalFormattingRule['condition']>();
  });
});

/* ── the zod mirror ──────────────────────────────────────────────────────── */

const ENVELOPE = { dialect: 'cel', source: "record.stage == 'won'" };

const listView = (condition: unknown) => ({
  type: 'list-view',
  objectName: 'task',
  conditionalFormatting: [{ condition, style: { backgroundColor: '#dcfce7' } }],
});

const kanban = (condition: unknown) => ({
  type: 'object-kanban',
  objectName: 'task',
  groupBy: 'status',
  conditionalFormatting: [{ condition, style: { backgroundColor: '#dcfce7' } }],
});

/** The spec's own `condition` slot schema — what the mirror must read, not copy. */
const specConditionSlot = SpecListViewSchema.shape.conditionalFormatting.unwrap().element.shape.condition;

describe.each([
  ['list-view (`ListViewSchema`)', ListViewSchema, listView],
  ['object-kanban (`KanbanConditionalFormattingRuleSchema`)', ObjectKanbanSchema, kanban],
] as const)('objectui#10946 — the zod mirror of `condition` on %s', (_label, schema, doc) => {
  it('accepts the `{ dialect, source }` envelope and returns it unchanged', () => {
    const parsed = schema.safeParse(doc(ENVELOPE));
    expect(parsed.success).toBe(true);
    expect((parsed.data as { conditionalFormatting: Array<{ condition: unknown }> }).conditionalFormatting[0].condition).toEqual(ENVELOPE);
  });

  it('CONTROL — a string condition parses exactly as before: not canonicalized into an envelope', () => {
    const parsed = schema.safeParse(doc("record.stage == 'won'"));
    expect(parsed.success).toBe(true);
    expect((parsed.data as { conditionalFormatting: Array<{ condition: unknown }> }).conditionalFormatting[0].condition).toBe("record.stage == 'won'");
    // The spec slot ALONE would have rewritten it — which is why `z.string()` is the first arm.
    expect(specConditionSlot.parse("record.stage == 'won'")).toEqual({ dialect: 'cel', source: "record.stage == 'won'" });
  });

  it('CONTROL — the empty string the mirror accepted before is still accepted (no narrowing)', () => {
    expect(schema.safeParse(doc('')).success).toBe(true);
    // The spec slot alone refuses it (`min(1)`), so reading it alone would have narrowed this validator.
    expect(specConditionSlot.safeParse('').success).toBe(false);
  });

  it('refuses an envelope the protocol refuses, at the rule, while the valid envelope in the same document parses', () => {
    for (const bad of [{ dialect: 'cel' }, { source: "record.stage == 'won'" }, 42]) {
      const parsed = schema.safeParse(doc(bad));
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.path.slice(0, 2)).toEqual(['conditionalFormatting', 0]);
    }
    expect(schema.safeParse(doc(ENVELOPE)).success).toBe(true);
  });
});

describe('objectui#10946 — the envelope arm IS the spec\'s slot schema (reference, not a copy)', () => {
  // A faithful copy passes every value comparison above; reference identity is
  // the only check that tells a derivation from a fork (the `ExpressionWireSchema`
  // pin in `base-schema-predicate-envelope-7530.test.ts` makes the same move).
  type UnionOf = { options: readonly unknown[] };
  type RuleArm = { shape: { condition: UnionOf } };

  // objectui#11533 retired the list view's (and the grid's) native arm too, so
  // that rule is ONE object now as well, and `condition` is read straight off
  // its shape.
  it('on the list view\'s rule', () => {
    const condition = (ListViewSchema.shape.conditionalFormatting.unwrap().element as unknown as RuleArm).shape.condition;
    expect(condition.options[1]).toBe(specConditionSlot);
  });

  // objectui#11522 retired the kanban rule's native arm, so the rule is ONE
  // object now (the spec list view's own, extended) and there is no union to
  // index: `condition` is read straight off its shape.
  it('on the kanban rule', () => {
    const condition = (KanbanConditionalFormattingRuleSchema as unknown as RuleArm).shape.condition;
    expect(condition.options[1]).toBe(specConditionSlot);
  });

  it('CONTROL — the reference check can fail: the string arm is NOT the spec slot', () => {
    const condition = (KanbanConditionalFormattingRuleSchema as unknown as RuleArm).shape.condition;
    expect(condition.options[0]).not.toBe(specConditionSlot);
  });
});
