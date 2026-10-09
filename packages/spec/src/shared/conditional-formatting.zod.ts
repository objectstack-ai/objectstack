// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module shared/conditional-formatting
 *
 * The **single declaration** of a conditional formatting rule —
 * `{ condition, style }`: a CEL predicate, and the CSS `style` map applied
 * while it holds. An ordered list of them is the formatting block; the first
 * rule whose `condition` holds wins.
 *
 * Two members mount the list, and both mount THIS element, so the rule grammar
 * and the style vocabulary cannot drift apart:
 *
 * - `ListViewSchema.conditionalFormatting` — a row rule. It styles the ROW.
 *   The `object-grid` and `object-kanban` page blocks reuse that member by
 *   identity (`component.zod.ts`), so they mount this element too.
 * - `FieldSchema.conditionalFormatting` — a cell rule (#22228). It styles THAT
 *   FIELD'S CELL wherever the field renders, and its condition reads `value`
 *   (the field's value on the record) beside `record` (the row).
 *
 * Both members can apply to one record: a field rule styles its cell, and a
 * row rule styles the row.
 *
 * ## Why a module of its own
 *
 * The rule was declared inline in `ListViewSchema` until #22228. A field
 * definition cannot import it from there: `ui/view.zod.ts` imports
 * `data/field.zod.ts`, so the reverse import would be a cycle, and the data
 * layer would depend on the UI layer. This module sits below both.
 *
 * It is a `.zod.ts` module on purpose. The expression-conformance ledger
 * discovers CEL slots by scanning `packages/spec/src/**` `*.zod.ts` files, so
 * the `condition` slot stays discoverable here (key
 * `shared/conditional-formatting.zod.ts:ConditionalFormattingRuleSchema.condition`).
 * A plain `.ts` home would have hidden the slot from that scan.
 *
 * It is not re-exported from the `shared` barrel. Consumers read the rule
 * through the two members above, and their inferred types carry it.
 *
 * ## What the authoring gate checks for each member
 *
 * The parse checks the shape: exactly `condition` and `style`, a non-blank
 * condition, and a string-to-string style map. The CEL in a FIELD rule's
 * condition is also judged at `os build` / `os validate` and at the object
 * save door, by `@objectstack/lint`'s `validate-expressions.ts`: the condition
 * must parse and may read only `value` and `record` (ADR-0049, declared means
 * enforced).
 */

import { z } from 'zod';

import { EvaluatedExpressionInputSchema } from './expression.zod';
import { strictObject } from './strict-object';

/**
 * One conditional formatting rule. See the module docblock for the two members
 * that mount it.
 */
export const ConditionalFormattingRuleSchema = strictObject({
  surface: 'this conditional formatting rule',
  history:
    'Until rule shapes were closed an unknown key on a rule was dropped silently — the rule '
    + 'still applied, without whatever the key was meant to style.',
  // `visibleWhen` is the ADR-0089 spelling for a predicate on view/page, and a
  // field's own visibility predicate, so an author borrowing it here is using
  // a neighbouring surface's correct word — the `visibleWhen → visible`
  // category #3746 named, not a typo.
  aliases: { when: 'condition', expression: 'condition', visibleWhen: 'condition', rule: 'condition', styles: 'style', css: 'style' },
  guidance: {
    // The fix comes first because it holds on both members. The `rowColor`
    // pointer holds on a list view only: `rowColor` is a different capability
    // of that view (colour the row by one field's value), and pointing a
    // colour-only author at it beats making them hand-write a style map.
    color: '`color` is not a rule key — put a CSS colour in `style`: `{ condition, style: { color: "#b91c1c" } }`. On a list view, colouring whole rows by one field\'s value has its own block, `rowColor`.',
  },
}, {
  condition: EvaluatedExpressionInputSchema.describe('Predicate (CEL) to evaluate.'),
  style: z.record(z.string(), z.string()).describe('CSS styles to apply when condition is true'),
});
