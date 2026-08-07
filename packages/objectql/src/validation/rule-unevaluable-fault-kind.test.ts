// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6133 — consumer-side pin for the CEL fault `kind`.
 *
 * `@objectstack/formula` decides the kind; THIS is where an author reads it.
 * `unevaluableRuleError` puts `faultSummary(error)` — literally
 * `` `${kind}: ${first line}` `` — into both the rejection sentence and
 * `constraint.fault`, and `packages/rest` re-emits the same kind as the HTTP
 * body's `reason`. So a misclassification upstream is not an internal detail:
 * it is the word the author is handed when their write is refused.
 *
 * Before #6133 an unbalanced paren produced `(runtime: Expected RPAREN, got
 * EOF)` — "runtime" pointing the author at their DATA when the fault is in
 * their expression. This file reads the consumer without changing it, so the
 * formula-side fix is pinned where it is actually visible.
 */
import { describe, it, expect } from 'vitest';

import { evaluateValidationRules } from './rule-validator';
import { ValidationError } from './record-validator';

const schemaWithPredicate = (source: string) => ({
  fields: {
    status: { name: 'status', label: 'Status', type: 'text' },
    amount: { name: 'amount', label: 'Amount', type: 'number' },
  },
  validations: [
    {
      type: 'script' as const,
      name: 'broken_predicate',
      condition: { dialect: 'cel', source },
      message: 'Amount is out of range.',
      events: ['insert', 'update'] as Array<'insert' | 'update'>,
    },
  ],
});

/** Run the write and hand back the rejection the author would see. */
function rejectionOf(source: string): ValidationError {
  try {
    evaluateValidationRules(schemaWithPredicate(source), { status: 'open', amount: 10 }, 'insert');
  } catch (err) {
    if (err instanceof ValidationError) return err;
    throw err;
  }
  throw new Error(`expected the write to be rejected for predicate: ${source}`);
}

describe('#6133 — the kind an author reads for an unparseable predicate', () => {
  it('reports an unbalanced paren as a SYNTAX fault, not a runtime one', () => {
    const err = rejectionOf('((record.amount > 100)');

    // The sentence the author reads.
    expect(err.fields[0]?.message).toContain('parse: Expected RPAREN');
    expect(err.fields[0]?.message).not.toContain('runtime:');

    // The machine-readable twin, and the value `packages/rest` re-emits as the
    // HTTP `reason`.
    expect(err.fields[0]?.constraint).toMatchObject({
      rule: 'broken_predicate',
      reason: 'unevaluable',
      fault: expect.stringMatching(/^parse: Expected RPAREN/),
    });
  });

  it('reports an unbalanced bracket the same way', () => {
    const err = rejectionOf('record.amount in [1, 2');
    expect(err.fields[0]?.constraint).toMatchObject({
      fault: expect.stringMatching(/^parse: Expected RBRACKET/),
    });
  });

  it('still fails CLOSED — a broken predicate rejects the write (#4649)', () => {
    // The classification fix must not soften the fail-closed guarantee: an
    // unevaluable rule still refuses the write, it just names the fault
    // correctly now.
    expect(() =>
      evaluateValidationRules(
        schemaWithPredicate('((record.amount > 100)'),
        { status: 'open', amount: 10 },
        'insert',
      ),
    ).toThrow(ValidationError);
  });

  it('leaves a genuine RUNTIME fault reported as runtime', () => {
    // The counter-case: a predicate that parses fine and faults while
    // evaluating must keep pointing at evaluation. Ordering a text field
    // against a number is the cleanest such fault — the record is total, so no
    // missing key, and the message carries no `null`, so `describeCelFault`'s
    // null-comparison sentence does not claim it either.
    const err = rejectionOf('record.status > 1');
    expect(err.fields[0]?.constraint).toMatchObject({
      fault: expect.stringMatching(/^runtime:/),
    });
  });
});
