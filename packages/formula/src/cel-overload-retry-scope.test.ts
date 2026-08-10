// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7098 — the ADR-0032 §1c retry rewrites the operands that PROVABLY faulted,
 * and nothing else.
 *
 * The companion to `cel-overload-retry-trigger.test.ts`, which pins *when* the
 * retry arms (#6679). This file pins what it is allowed to REWRITE once armed.
 *
 * Before the fix, `hydrateOverloadStrings` rewrote the entire scope on the
 * strength of a docblock claim that it "can never change a comparison that
 * already evaluated cleanly". The retry knows only that the WHOLE expression
 * faulted, so that claim was false: every other comparison in the expression was
 * re-interpreted against the hydrated values, and the result was a silently
 * wrong answer — `{ ok: true }`, no fault, no log line.
 *
 * Each case below states the answer evaluation 1 gives for the sub-expression
 * that must survive, so a future reader can see what "already evaluated cleanly"
 * means for that row.
 */

import { describe, expect, it } from 'vitest';
import { celEngine } from './cel-engine';
import type { Expression } from '@objectstack/spec';

const cel = (source: string): Expression => ({ dialect: 'cel', source });

describe('§1c retry — scope of the rewrite (#7098)', () => {
  describe("the filer's two reproductions", () => {
    // `record.s == "5.0"` is string == string: it type-checks and answers TRUE
    // in evaluation 1. Only `record.n >= 4` faults. Scope-wide hydration made
    // `record.s` the number 5, and `5 == "5.0"` is false across types.
    it('keeps a deliberate string equality beside a faulting numeric compare (&&)', () => {
      const r = celEngine.evaluate(cel('record.n >= 4 && record.s == "5.0"'), {
        record: { n: '7', s: '5.0' },
      });
      expect(r).toEqual({ ok: true, value: true });
    });

    it('keeps it in the ternary form too — the fault is in the condition', () => {
      const r = celEngine.evaluate(cel('record.n >= 4 ? record.s == "5.0" : false'), {
        record: { n: '7', s: '5.0' },
      });
      expect(r).toEqual({ ok: true, value: true });
    });
  });

  describe('the same hazard in the other shapes that reach it', () => {
    it('keeps a string membership test (`in` against a string list)', () => {
      const r = celEngine.evaluate(cel('record.n >= 4 && record.s in ["5.0", "x"]'), {
        record: { n: '7', s: '5.0' },
      });
      expect(r).toEqual({ ok: true, value: true });
    });

    it('keeps a date-string equality (the ISO half of §1c)', () => {
      const r = celEngine.evaluate(cel('record.n >= 4 && record.d == "2026-06-20"'), {
        record: { n: '7', d: '2026-06-20' },
      });
      expect(r).toEqual({ ok: true, value: true });
    });

    it('keeps != as well as ==', () => {
      const r = celEngine.evaluate(cel('record.n >= 4 && record.s != "5.0"'), {
        record: { n: '7', s: '5.0' },
      });
      expect(r).toEqual({ ok: true, value: false });
    });

    it('keeps the SAME field readable as a string in one conjunct and a number in another', () => {
      // Per operand POSITION, not per field: scope-level narrowing would still
      // have had to trade one of these two answers away.
      const r = celEngine.evaluate(cel('record.n >= 4 && record.n == "7"'), {
        record: { n: '7' },
      });
      expect(r).toEqual({ ok: true, value: true });
    });

    it('does not retype a numeric string the expression RETURNS', () => {
      // Not a boolean at all — a `Field.formula` of type text. Scope-wide
      // hydration returned the number 5, so the stored value became "5".
      const r = celEngine.evaluate(cel('record.n >= 4 ? record.s : "none"'), {
        record: { n: '7', s: '5.0' },
      });
      expect(r).toEqual({ ok: true, value: '5.0' });
    });

    it('leaves a string concatenation alone (`+` is coercible, the counterpart is not)', () => {
      const r = celEngine.evaluate(cel('record.n >= 4 && record.s + "!" == "5.0!"'), {
        record: { n: '7', s: '5.0' },
      });
      expect(r).toEqual({ ok: true, value: true });
    });
  });

  describe('the §1c rescue itself still works (no coverage lost)', () => {
    it('rescues the numeric-literal compare (#1534)', () => {
      expect(celEngine.evaluate(cel('record.rating >= 4'), { record: { rating: '5.0' } }))
        .toEqual({ ok: true, value: true });
    });

    it('rescues the temporal compare (#1530)', () => {
      const r = celEngine.evaluate(cel('record.end_date <= daysFromNow(60)'), {
        now: new Date('2026-06-01T00:00:00Z'),
        record: { end_date: '2026-06-20' },
      });
      expect(r).toEqual({ ok: true, value: true });
    });

    it('rescues arithmetic against an int literal', () => {
      expect(celEngine.evaluate(cel('record.amount / 100'), { record: { amount: '250000.00' } }))
        .toEqual({ ok: true, value: 2500 });
    });

    it('rescues a field compared against another field that IS a number', () => {
      // The counterpart is read off the scope, not off the static type — every
      // field is `dyn` under `unlistedVariablesAreDyn`.
      expect(celEngine.evaluate(cel('record.rating >= record.threshold'), {
        record: { rating: '5.0', threshold: 4 },
      })).toEqual({ ok: true, value: true });
    });

    it('rescues the operand on the LEFT of the literal too', () => {
      expect(celEngine.evaluate(cel('100000 < record.amount'), { record: { amount: '250000.00' } }))
        .toEqual({ ok: true, value: true });
    });

    it('still answers false when the rescued compare is simply unmet', () => {
      expect(celEngine.evaluate(cel('record.rating >= 4'), { record: { rating: '2.5' } }))
        .toEqual({ ok: true, value: false });
    });
  });

  describe('the operators that ANSWER instead of faulting are never rewritten', () => {
    // Measured on cel-js 8.0.0: `==`, `!=` and `in` are defined ACROSS types, so
    // they always had an answer and the retry has no licence to revise it. Each
    // row below states that answer, and it is the same whether or not an
    // unrelated conjunct faults — which is the property that was missing.
    it.each([
      ['record.n == 7', false],
      ['record.n != 7', true],
      ['record.n in [1, 7]', false],
    ] as Array<[string, boolean]>)('%s answers %s on its own', (src, expected) => {
      expect(celEngine.evaluate(cel(src), { record: { n: '7' } }))
        .toEqual({ ok: true, value: expected });
    });

    it.each([
      ['record.n >= 4 && record.n == 7', false],
      ['record.n >= 4 && record.n != 7', true],
      ['record.n >= 4 && record.n in [1, 7]', false],
    ] as Array<[string, boolean]>)('%s still answers %s beside a faulting compare', (src, expected) => {
      expect(celEngine.evaluate(cel(src), { record: { n: '7' } }))
        .toEqual({ ok: true, value: expected });
    });
  });

  describe('what stays LOUD', () => {
    it('does not rescue a non-numeric string', () => {
      const r = celEngine.evaluate(cel('record.rating >= 4'), { record: { rating: 'high' } });
      expect(r.ok).toBe(false);
    });

    it('does not rescue a numeric string against a Timestamp (a real mismatch)', () => {
      const r = celEngine.evaluate(cel('record.n <= daysFromNow(60)'), { record: { n: '7' } });
      expect(r.ok).toBe(false);
    });

    it('reports the ORIGINAL fault when no operand provably faulted', () => {
      // The faulting operand is bound by a comprehension, so the walk cannot read
      // its value and declines to guess. Loud beats silently wrong.
      const r = celEngine.evaluate(cel('record.items.exists(i, i.price > 100)'), {
        record: { items: [{ price: '250.00' }] },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.message).toMatch(/no such overload/i);
    });
  });
});
