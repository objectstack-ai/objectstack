// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `FieldSchema` field-rule triad is EVALUATED (#17778, ADR-0136 D1) — all
 * three of `visibleWhen` / `readonlyWhen` / `requiredWhen` compose
 * `PredicateInputSchema`, which is now the evaluated rule, so an envelope the
 * engine cannot evaluate is refused at authoring instead of silently doing
 * nothing at evaluation time.
 *
 * Before this the triad was `ExpressionInputSchema` — the persistence contract,
 * `source` OR `ast` — and all three slots resolved both refused spellings to a
 * NO-OP, each by its own mechanism (measured at each end on `03b7b8187`):
 * `visibleWhen` is never evaluated server-side at the field level at all
 * (`rule-validator.ts`'s `ConditionalFieldDef` has no such member);
 * `isReadonlyWhenLocked` returns LOCKED only for an unbound-ROOT fault and
 * logs `change allowed through` + returns `false` for every other fault, which
 * is the arm an unevaluable envelope takes; `requiredWhen` logs and SKIPS the
 * check. So one unauthored predicate made a form show more, lock less and
 * demand less at once, with nothing saying the rule had not run.
 *
 * Reproduction pins, one per spelling per slot, each asserting the issue's
 * `code`, `path` and message — never `success === false` alone, which an
 * unrelated refusal would satisfy just as well. Two preservation controls
 * carry the other half: the persistence contract still ACCEPTS both refused
 * shapes (it was deliberately not narrowed), and a real predicate parses to
 * byte-identically what it parsed to before.
 */

import { describe, expect, it } from 'vitest';

import {
  EVALUATED_EXPRESSION_SOURCE_REQUIRED,
  ExpressionInputSchema,
  ExpressionSchema,
} from '../shared/expression.zod.js';
import { FieldSchema } from './field.zod.js';

const AST_ONLY = { dialect: 'cel', ast: { kind: 'const', value: true } };
const BLANK_SOURCE = { dialect: 'cel', source: '   ' };
const BLANK_BARE = '   ';
const GOOD = { dialect: 'cel', source: "record.status == 'paid'" };

const FIELD = { name: 'amount', label: 'Amount', type: 'currency' } as const;

const SLOTS = ['visibleWhen', 'readonlyWhen', 'requiredWhen'] as const;

function issuesOf(slot: string, value: unknown) {
  const result = FieldSchema.safeParse({ ...FIELD, [slot]: value });
  return result.success
    ? []
    : result.error.issues.map((i) => ({
        code: i.code,
        path: i.path.map(String).join('.'),
        message: i.message,
      }));
}

describe('FieldSchema field-rule triad — an evaluated slot requires a non-blank `source` (#17778)', () => {
  for (const slot of SLOTS) {
    describe(`\`${slot}\``, () => {
      it('REFUSES an `ast`-only envelope with the published sentence at the slot', () => {
        // Both arms of the input union abort on this shape (the envelope arm's
        // missing `source` is an aborting `invalid_type`), so it surfaces as
        // the union's own issue at the SLOT, worded by the union's error map.
        expect(issuesOf(slot, AST_ONLY)).toEqual([
          { code: 'invalid_union', path: slot, message: EVALUATED_EXPRESSION_SOURCE_REQUIRED },
        ]);
      });

      it('REFUSES a blank `source` INSIDE an envelope, at `source`', () => {
        // The one shape the envelope arm refuses WITHOUT aborting (a `custom`
        // refine), so it surfaces from the arm itself, one level deeper.
        expect(issuesOf(slot, BLANK_SOURCE)).toEqual([
          {
            code: 'custom',
            path: `${slot}.source`,
            message: EVALUATED_EXPRESSION_SOURCE_REQUIRED,
          },
        ]);
      });

      it('REFUSES a blank bare-string shorthand at the slot', () => {
        expect(issuesOf(slot, BLANK_BARE)).toEqual([
          { code: 'invalid_union', path: slot, message: EVALUATED_EXPRESSION_SOURCE_REQUIRED },
        ]);
      });

      it('PRESERVES a real predicate — parses, and to the same envelope as before', () => {
        const result = FieldSchema.safeParse({ ...FIELD, [slot]: GOOD });
        expect(result.success).toBe(true);
        expect((result as { success: true; data: Record<string, unknown> }).data[slot]).toEqual(GOOD);
      });

      it('PRESERVES the bare-string shorthand, normalized to a `cel` envelope', () => {
        const result = FieldSchema.safeParse({ ...FIELD, [slot]: "record.status == 'paid'" });
        expect(result.success).toBe(true);
        expect((result as { success: true; data: Record<string, unknown> }).data[slot]).toEqual(GOOD);
      });

      it('PRESERVES an `ast` BESIDE a string `source`', () => {
        expect(FieldSchema.safeParse({ ...FIELD, [slot]: { ...GOOD, ast: { kind: 'const' } } }).success)
          .toBe(true);
      });

      it('PRESERVES absence — "no rule" is not a malformed rule', () => {
        expect(FieldSchema.safeParse(FIELD).success).toBe(true);
      });
    });
  }

  it('CONTROL: the persistence contract was NOT narrowed and still accepts both shapes', () => {
    // If this control ever goes red, the narrowing has leaked out of the
    // evaluated slots and into the schema that only PERSISTS an envelope —
    // which ADR-0136 D1 explicitly declines to do.
    expect(ExpressionSchema.safeParse(AST_ONLY).success).toBe(true);
    expect(ExpressionInputSchema.safeParse(AST_ONLY).success).toBe(true);
    expect(ExpressionSchema.safeParse(BLANK_SOURCE).success).toBe(true);
    expect(ExpressionInputSchema.safeParse(BLANK_SOURCE).success).toBe(true);
  });

  it('CONTROL: the per-OPTION `visibleWhen` is OUT of scope and still accepts an `ast`-only envelope', () => {
    // ADR-0136's scope boundary: the option-level predicate, the inline-column
    // pair and every view/page/action gate still compose
    // `ExpressionInputSchema`. This pin is what makes that boundary a measured
    // fact rather than a claim in prose — when the gate slots are converted,
    // this expectation is the one that must be updated deliberately.
    const result = FieldSchema.safeParse({
      name: 'tier',
      label: 'Tier',
      type: 'select',
      options: [{ label: 'Gold', value: 'gold', visibleWhen: AST_ONLY }],
    });
    expect(result.success).toBe(true);
  });
});
