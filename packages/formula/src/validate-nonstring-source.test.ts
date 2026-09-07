/**
 * #15663 — an expression envelope whose `source` is NOT a string is refused
 * through `errors[]`, not by throwing a raw `TypeError` out of the validator.
 *
 * ## The acceptance test is not "it no longer throws"
 *
 * `validateExpression`'s own docblock promises it never throws, and every
 * consumer is built on that promise: `AutomationEngine.validateFlowExpressions`
 * collects LOCATED findings and throws one assembled error naming the flow, the
 * node, the slot and the source (ADR-0032 §1d), and `@objectstack/lint`'s stack
 * walk attributes each finding to the hook / sharing rule / action it came from.
 * A `TypeError` escaping from inside the validator bypassed all of it — the
 * author got `source.trim is not a function` and no location at all.
 *
 * So the pin is TWO-sided: the refusal arrives on the `errors[]` channel here,
 * and the caller's location survives to the author (pinned next door, in
 * `@objectstack/lint`'s `validate-expressions-nonstring-source.test.ts`).
 *
 * ## Why the entry, once
 *
 * `validateExpression` is the shared parse every predicate/value slot in the
 * platform goes through, and the value arrives from METADATA — `ExprInput`
 * declares `source?: string`, but every production call site casts, because a
 * declaration is a claim about stored data and not a guarantee about it. The
 * guard therefore belongs at the entry both public functions share, never in
 * each caller's own try/catch (Prime Directive #12's tolerant-consumer shape).
 */
import { describe, it, expect } from 'vitest';

import { validateExpression, inferExpressionType } from './validate';

/** The refusal sentence, spelled once. Not exported from the package — the
 *  published surface does not move for this fix; the text travels `errors[]`. */
const REFUSAL = 'an expression envelope carries its expression as a string `source`';

describe('#15663 — a non-string envelope `source`', () => {
  describe('is refused through `errors[]`, for every role', () => {
    const CASES: Array<[label: string, source: unknown, found: string]> = [
      ['an object', { nested: 1 }, 'found an object'],
      ['a nested object (the card\'s own value)', { nested: 1 }, 'found an object'],
      ['a number', 1, 'found a number'],
      ['an array', ['a'], 'found an array'],
      ['a boolean', true, 'found a boolean'],
    ];

    for (const role of ['predicate', 'value', 'template'] as const) {
      for (const [label, source, found] of CASES) {
        it(`${role}: refuses ${label} without throwing`, () => {
          const r = validateExpression(role, { source } as never);
          expect(r.ok).toBe(false);
          expect(r.errors).toHaveLength(1);
          expect(r.errors[0].message).toContain(REFUSAL);
          expect(r.errors[0].message).toContain(found);
          // The defect's own signature must be gone from what the author reads.
          expect(r.errors[0].message).not.toContain('is not a function');
        });
      }
    }

    it('does not throw — the property the whole located-reporting contract rests on', () => {
      expect(() => validateExpression('predicate', { source: { nested: 1 } } as never)).not.toThrow();
      expect(() => validateExpression('value', { dialect: 'cel', source: ['a'] } as never)).not.toThrow();
      expect(() => validateExpression('template', { source: true } as never)).not.toThrow();
    });

    it('refuses regardless of the declared dialect — the shape is judged first', () => {
      for (const dialect of ['cel', 'template', 'cron', undefined]) {
        const r = validateExpression('predicate', { dialect, source: 1 } as never);
        expect(r.ok).toBe(false);
        expect(r.errors[0].message).toContain(REFUSAL);
      }
    });
  });

  describe('the message is self-correcting — it names both authorable forms', () => {
    it('a CEL role is shown bare CEL and a `cel` envelope', () => {
      const m = validateExpression('predicate', { source: 1 } as never).errors[0].message;
      expect(m).toContain('record.rating >= 4');
      expect(m).toContain("dialect: 'cel'");
    });

    it('the `template` role is shown a TEMPLATE, not a CEL predicate', () => {
      const m = validateExpression('template', { source: 1 } as never).errors[0].message;
      expect(m).toContain('{{ record.name }}');
      expect(m).toContain("dialect: 'template'");
      // Prescribing bare CEL to a text template is advice that cannot succeed.
      expect(m).not.toContain('record.rating >= 4');
    });

    it('attributes to the empty string — the value that WOULD be the location is the value being refused', () => {
      // `source` is declared `string` on `ExprValidationError` and every caller
      // renders it; echoing the offending non-string would put an object into it.
      expect(validateExpression('predicate', { source: { nested: 1 } } as never).errors[0].source).toBe('');
    });
  });

  describe('`inferExpressionType` — the SECOND consumer of the same entry', () => {
    it('answers `unknown` instead of throwing', () => {
      expect(() => inferExpressionType({ source: 1 } as never)).not.toThrow();
      expect(inferExpressionType({ source: 1 } as never)).toBe('unknown');
      expect(inferExpressionType({ dialect: 'cel', source: ['a'] } as never)).toBe('unknown');
    });

    it('CONTROL — a real numeric expression still infers `number`', () => {
      expect(inferExpressionType({ dialect: 'cel', source: '1 + 1' })).toBe('number');
      expect(inferExpressionType('1 + 1')).toBe('number');
    });
  });

  /**
   * CONTROLS. The reject set and the accept set of everything that already
   * RETURNED are unchanged by this fix — only the population that used to
   * produce no verdict at all (a crash) moved, and it moved into the reject set.
   * These are the shapes that must keep their existing verdict exactly.
   */
  describe('CONTROLS — what must NOT change', () => {
    it('bare text still validates', () => {
      expect(validateExpression('predicate', 'record.rating >= 4').ok).toBe(true);
      expect(validateExpression('value', 'record.amount / 100').ok).toBe(true);
      expect(validateExpression('template', 'Hi {{ record.name }}').ok).toBe(true);
    });

    it('a well-formed envelope still validates', () => {
      expect(validateExpression('predicate', { dialect: 'cel', source: '1 == 1' }).ok).toBe(true);
      expect(validateExpression('predicate', { source: '1 == 1' }).ok).toBe(true);
    });

    it('"not authored" still reads as `ok: true` — absent, null, empty, whitespace', () => {
      expect(validateExpression('predicate', null).ok).toBe(true);
      expect(validateExpression('predicate', undefined).ok).toBe(true);
      expect(validateExpression('predicate', '').ok).toBe(true);
      expect(validateExpression('predicate', '   ').ok).toBe(true);
      expect(validateExpression('predicate', {}).ok).toBe(true);
      expect(validateExpression('predicate', { dialect: 'cel' }).ok).toBe(true);
      expect(validateExpression('predicate', { source: undefined }).ok).toBe(true);
      // A NULL `source` is "not authored" too, and stays so: only a PRESENT
      // non-string is the fourth population this card refuses.
      expect(validateExpression('predicate', { source: null } as never).ok).toBe(true);
    });

    it('an `{ ast }` envelope carrying no `source` is still admitted', () => {
      // Its admission is `ExpressionSchema`'s rule, not this entry's; the guard
      // must not start refusing it as "a non-string source".
      expect(validateExpression('predicate', { ast: { kind: 'whatever' } } as never).ok).toBe(true);
    });

    it('a malformed STRING still gets its own diagnostic, not the shape refusal', () => {
      const brace = validateExpression('predicate', '{record.rating} >= 4');
      expect(brace.ok).toBe(false);
      expect(brace.errors[0].message).not.toContain(REFUSAL);
      expect(brace.errors[0].message).toContain('template brace');
      expect(brace.errors[0].source).toBe('{record.rating} >= 4');

      const dialect = validateExpression('template', { dialect: 'cel', source: 'record.x' });
      expect(dialect.ok).toBe(false);
      expect(dialect.errors[0].message).not.toContain(REFUSAL);
    });
  });
});
