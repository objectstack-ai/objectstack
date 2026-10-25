/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-kanban`'s `conditionalFormatting` speaks ONE rule dialect — the spec
 * list view's `{ condition, style }` — and refuses the two it used to take BY
 * NAME (objectui#11522; triage ruling 5963861071: retire, not widen, no alias
 * window).
 *
 * TURNED AROUND, not deleted. This file used to pin that a kanban rule accepted
 * BOTH the native `{ field, operator, value }` comparison and the spec shape
 * (#1584). It now pins the opposite, for the two retired dialects:
 *
 *   - the native rule `{ field, operator, value, backgroundColor, borderColor }`,
 *   - the flat CEL rule — a `condition` with a colour at the TOP LEVEL
 *     (`{ condition, backgroundColor }`) instead of inside `style`.
 *
 * Each refusal is read on all three zod faces an author meets — the
 * `ObjectKanbanSchema` mirror, the tolerant document face
 * (`safeValidateSchema`) and the strict authoring face
 * (`StrictAnyComponentSchema`) — at the retired key's OWN path, and the message
 * there names the retirement and the respelling. A bare `success: false` would
 * not be a refusal pin: a document with an unrelated mistake fails too. The
 * accepted `{ condition, style }` rule in the same document is the live control
 * on every face.
 *
 * The TS face is pinned by `tsc -p tsconfig.test.json` (this package's
 * `type-check`): the `@ts-expect-error` lines below fail the build the moment a
 * retired key type-checks again.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import type { z } from 'zod';
import { ListViewSchema as SpecListViewSchema } from '@objectstack/spec/ui';
import { ObjectKanbanSchema, safeValidateSchema, StrictAnyComponentSchema } from '../zod/index.zod';
import { KanbanConditionalFormattingRuleSchema } from '../zod/objectql.zod';
import type { KanbanConditionalFormattingRule, SpecConditionalFormattingRule } from '../objectql';

// `groupBy`, not `groupField`: the lane key the renderer reads, declared on
// both faces by objectui#7322 (which retired `groupField` on this node).
const base = { type: 'object-kanban', objectName: 'task', groupBy: 'status' };

/** The accepted spelling — and the live control in every mixed document below. */
const SPEC_RULE = { condition: "record.status == 'done'", style: { backgroundColor: '#e0ffe0' } };

/** The retired native rule, exactly as this file used to accept it. */
const NATIVE_RULE = { field: 'priority', operator: 'equals', value: 'high', backgroundColor: '#fee2e2' };

/** The retired flat CEL rule: the colour beside `condition`, not inside `style`. */
const FLAT_CEL_RULE = { condition: "record.owner == 'bob'", backgroundColor: 'rgb(4, 5, 6)' };

type Issue = { code: string; path: PropertyKey[]; message: string };
type Face = readonly [label: string, parse: (doc: unknown) => { success: boolean; error?: { issues: Issue[] } }];

const FACES: readonly Face[] = [
  ['ObjectKanbanSchema', (doc) => ObjectKanbanSchema.safeParse(doc) as never],
  ['safeValidateSchema (tolerant face)', (doc) => safeValidateSchema(doc) as never],
  ['StrictAnyComponentSchema (strict face)', (doc) => StrictAnyComponentSchema.safeParse(doc) as never],
];

/** The issue each face reports at `conditionalFormatting[index].key`, if any. */
function issueAt(face: Face, rules: unknown[], index: number, key: string): Issue | undefined {
  const parsed = face[1]({ ...base, conditionalFormatting: rules });
  return parsed.error?.issues.find(
    (i) => i.path.join('.') === `conditionalFormatting.${index}.${key}`,
  );
}

/** What every retirement message must carry: the card and the one spelling that replaces the rule. */
function expectRetirement(issue: Issue | undefined, key: string): void {
  expect(issue, `no issue at the retired key \`${key}\``).toBeDefined();
  expect(issue!.message.startsWith(`\`${key}\``), issue!.message).toBe(true);
  expect(issue!.message).toContain('RETIRED (objectui#11522)');
  expect(issue!.message).toContain('`{ condition, style }`');
}

describe.each(FACES)('objectui#11522 — `object-kanban`.`conditionalFormatting` on %s', (...face) => {
  it('CONTROL — the spec `{ condition, style }` rule is accepted', () => {
    expect(face[1]({ ...base, conditionalFormatting: [SPEC_RULE] }).success).toBe(true);
  });

  it('refuses the native `{ field, operator, value, backgroundColor }` rule BY NAME, at each retired key', () => {
    // Index 1: the accepted rule at index 0 draws no issue in the same parse.
    const rules = [SPEC_RULE, NATIVE_RULE];
    expect(face[1]({ ...base, conditionalFormatting: rules }).success).toBe(false);
    for (const key of ['field', 'operator', 'value']) {
      const issue = issueAt(face, rules, 1, key);
      expectRetirement(issue, key);
      expect(issue!.message).toContain('native kanban rule dialect');
    }
    expectRetirement(issueAt(face, rules, 1, 'backgroundColor'), 'backgroundColor');
    const atControl = face[1]({ ...base, conditionalFormatting: rules }).error!.issues.filter(
      (i) => i.path.join('.').startsWith('conditionalFormatting.0'),
    );
    expect(atControl).toEqual([]);
  });

  it('refuses the flat CEL rule — a top-level colour beside `condition` — BY NAME, with the `style` respelling', () => {
    const rules = [SPEC_RULE, FLAT_CEL_RULE];
    const issue = issueAt(face, rules, 1, 'backgroundColor');
    expectRetirement(issue, 'backgroundColor');
    expect(issue!.message).toContain('`style: { backgroundColor }`');
    // ⛔ Not "the generic union failure": with one dialect left there is no
    // union to fail, and no issue sits at the bare rule path.
    const parsed = face[1]({ ...base, conditionalFormatting: rules });
    expect(parsed.error!.issues.some((i) => i.code === 'invalid_union' && i.path.join('.') === 'conditionalFormatting.1')).toBe(false);
  });

  it('a top-level colour is refused even beside a `style` map, and so are the other two colour keys', () => {
    // The tolerant face used to ACCEPT `{ condition, style, backgroundColor }`
    // (the spec arm was a stripping `z.object`) while the shared resolver
    // painted the stripped key over `style` anyway.
    for (const key of ['backgroundColor', 'borderColor', 'textColor']) {
      const rules = [{ ...SPEC_RULE, [key]: 'red' }];
      expectRetirement(issueAt(face, rules, 0, key), key);
    }
    const textColor = issueAt(face, [{ ...SPEC_RULE, textColor: 'red' }], 0, 'textColor');
    expect(textColor!.message).toContain('`style: { color }`');
  });
});

describe('objectui#11522 — the kanban rule IS the spec list view\'s, by reference', () => {
  const specRule = SpecListViewSchema.shape.conditionalFormatting.unwrap().element;
  type Shaped = { shape: Record<string, unknown> };

  it('`style` is the spec rule\'s own member (identity, not a copy)', () => {
    expect((KanbanConditionalFormattingRuleSchema as unknown as Shaped).shape.style).toBe(specRule.shape.style);
  });

  it('CONTROL — the identity check can fail: `condition` is the list view\'s own arm, not the bare spec slot', () => {
    expect((KanbanConditionalFormattingRuleSchema as unknown as Shaped).shape.condition).not.toBe(specRule.shape.condition);
  });

  it('inherits the spec rule\'s strictness: an undeclared key is refused with the spec\'s own message', () => {
    const parsed = ObjectKanbanSchema.safeParse({ ...base, conditionalFormatting: [{ ...SPEC_RULE, label: 'Done' }] });
    expect(parsed.success).toBe(false);
    const issue = parsed.error!.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue?.path).toEqual(['conditionalFormatting', 0]);
    expect((issue as { keys?: string[] } | undefined)?.keys).toEqual(['label']);
    // The spec rule alone draws the same refusal — the strictness is the spec's, not a local copy.
    expect(specRule.safeParse({ ...SPEC_RULE, label: 'Done' }).success).toBe(false);
  });
});

/* ── the TS face (tsc is the pin) ────────────────────────────────────────── */

const accepted: KanbanConditionalFormattingRule = SPEC_RULE;

const envelope: KanbanConditionalFormattingRule = {
  condition: { dialect: 'cel', source: "record.status == 'done'" },
  style: { borderColor: 'red' },
};

const nativeRefused: KanbanConditionalFormattingRule = {
  // @ts-expect-error — `field` is `?: never` (objectui#11522): the native rule dialect is retired.
  field: 'priority',
  // @ts-expect-error — `operator` is `?: never`.
  operator: 'equals',
  // @ts-expect-error — `value` is `?: never`.
  value: 'high',
  condition: "record.priority == 'high'",
  style: {},
};

const flatColourRefused: KanbanConditionalFormattingRule = {
  condition: "record.owner == 'bob'",
  style: {},
  // @ts-expect-error — a top-level colour is `?: never` (objectui#11522): it belongs in `style`.
  backgroundColor: 'rgb(4, 5, 6)',
};

// @ts-expect-error — the flat CEL rule has no `style`, which the rule requires.
const flatCelMissingStyle: KanbanConditionalFormattingRule = { condition: "record.owner == 'bob'" };

describe('objectui#11522 — the TS face agrees with the zod face', () => {
  it('a `{ condition, style }` rule (string or envelope condition) is the declared rule', () => {
    expect(accepted.condition).toBe("record.status == 'done'");
    expect(envelope.style).toEqual({ borderColor: 'red' });
    // The refused literals above are referenced so they are not dead code; tsc is their pin.
    expect([nativeRefused, flatColourRefused, flatCelMissingStyle].length).toBe(3);
  });

  it('the two faces declare the same keys, and the rule is the spec-format rule plus the tombstones', () => {
    type ZodIn = z.input<typeof KanbanConditionalFormattingRuleSchema>;
    expectTypeOf<keyof KanbanConditionalFormattingRule>().toEqualTypeOf<keyof ZodIn>();
    expectTypeOf<ZodIn['condition']>().toEqualTypeOf<KanbanConditionalFormattingRule['condition']>();
    expectTypeOf<ZodIn['style']>().toEqualTypeOf<KanbanConditionalFormattingRule['style']>();
    // Every retired key is unwritable on both faces (`?: never` / `z.never().optional()`).
    expectTypeOf<NonNullable<ZodIn['field']>>().toBeNever();
    expectTypeOf<NonNullable<KanbanConditionalFormattingRule['backgroundColor']>>().toBeNever();
    // And the accepted rule is exactly the shared spec-format rule.
    expectTypeOf<SpecConditionalFormattingRule>().toMatchTypeOf<KanbanConditionalFormattingRule>();
  });
});
