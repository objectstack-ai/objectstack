/**
 * #6679 — what arms the ADR-0032 §1c hydration retry.
 *
 * `celEngine.evaluate` catches a fault, and `isNumericOverloadError` decides
 * whether to hydrate string-serialized numeric / date fields and re-evaluate
 * once (#1530, #1534). Until this card that decision was a text read —
 * `/no such overload/i` against `err.message` — the last message-text read in
 * `cel-engine.ts` that armed behaviour after #6223 / PR #6677 closed the same
 * hole in `classifyError`.
 *
 * The phrase is reachable from a **native** throw, not only from cel-js. Our
 * `matches()` stdlib binding is `new RegExp(String(re)).test(...)`, so an
 * uncompilable pattern escapes cel-js unwrapped as a native `SyntaxError` that
 * echoes the pattern verbatim (measured on cel-js 8.0.0):
 *
 * ```text
 * matches(record.name, "no such overload(")
 *   -> SyntaxError: Invalid regular expression: /no such overload(/: Unterminated group
 * ```
 *
 * That message contains the phrase, so the retry used to arm on it. The filing
 * expected the consequence to be nil — the retry re-throws the original error,
 * which is classified correctly. It is not nil: if the expression short-circuits
 * around the throwing call once a field is hydrated, the retry *succeeds* and
 * returns a value where the fault was the right answer. `retry succeeds on a
 * native throw` below is that case, and it is why this file pins the trigger by
 * value and not only by the predicate's own answer.
 *
 * Both directions are pinned. Narrowing the trigger must not disarm the thing
 * the retry exists for.
 */
import { describe, expect, it } from 'vitest';
import { Environment, EvaluationError } from '@marcbachmann/cel-js';

import { celEngine } from './cel-engine';
import type { Expression } from '@objectstack/spec';

const cel = (source: string): Expression => ({ dialect: 'cel', source });

/**
 * Evaluate `source` against `record`, counting how many times CEL reads
 * `record.<probe>`.
 *
 * The count is the retry's fingerprint and needs no export: one read means the
 * expression was evaluated once, i.e. the retry never armed. More than one
 * means it did — `hydrateOverloadStrings` walks the live scope object with
 * `Object.entries` before re-evaluating, so arming the retry always re-reads
 * the record.
 */
function evaluateCountingReads(
  source: string,
  probe: string,
  value: unknown,
  rest: Record<string, unknown> = {},
) {
  let reads = 0;
  const record = {
    ...rest,
    get [probe]() {
      reads++;
      return value;
    },
  };
  const result = celEngine.evaluate(cel(source), { record });
  return { result, reads };
}

describe('ADR-0032 §1c hydration retry — what arms it (#6679)', () => {
  describe('a native throw whose message merely contains the phrase does NOT arm it', () => {
    it('does not re-evaluate for an uncompilable regex literal echoing the phrase', () => {
      const { result, reads } = evaluateCountingReads(
        'matches(record.name, "no such overload(")',
        'name',
        'x',
      );

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected the regex compilation to fault');
      // The fault itself is unchanged — a native throw carries no cel-js
      // contract, so `runtime` is still the honest verdict (#6223).
      expect(result.error.kind).toBe('runtime');
      expect(result.error.message).toContain('Invalid regular expression');
      // …and the retry never ran. Before #6679 this was 2.
      expect(reads).toBe(1);
    });

    it('does not re-evaluate when the pattern comes from a ROW rather than the source', () => {
      // The author does not have to write the phrase: `record.re` is a column
      // value, so any row can put it in the message.
      const { result, reads } = evaluateCountingReads(
        'matches(record.name, record.re)',
        'name',
        'x',
        { re: 'no such overload(' },
      );

      expect(result.ok).toBe(false);
      expect(reads).toBe(1);
    });

    it('a spuriously-armed retry could SUCCEED and swallow the fault', () => {
      // The case the filing did not find and expected might not exist.
      //
      // Evaluation 1: `record.s == "5.0"` is true, so the ternary takes the
      // `matches(...)` branch and it throws natively. The message contains the
      // phrase, so (before this card) the retry armed. Hydration turned
      // `record.s` into the number 5, `5 == "5.0"` is false, the ternary took
      // the OTHER branch, `matches` was never called — and the retry returned
      // `false` where the regex fault was the right answer.
      //
      // Two expressions differing only in whether the regex literal happens to
      // contain the phrase must not differ in whether they fault.
      const withPhrase = celEngine.evaluate(
        cel('record.s == "5.0" ? matches(record.name, "no such overload(") : false'),
        { record: { s: '5.0', name: 'x' } },
      );
      const withoutPhrase = celEngine.evaluate(
        cel('record.s == "5.0" ? matches(record.name, "(") : false'),
        { record: { s: '5.0', name: 'x' } },
      );

      expect(withPhrase.ok).toBe(false); // was `{ ok: true, value: false }`
      expect(withoutPhrase.ok).toBe(false); // the control: always faulted
      if (withPhrase.ok || withoutPhrase.ok) throw new Error('expected both to fault');
      expect(withPhrase.error.kind).toBe(withoutPhrase.error.kind);
    });

    it('leaves a native throw that does not contain the phrase exactly as it was', () => {
      const { result, reads } = evaluateCountingReads('matches(record.name, "(")', 'name', 'x');

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected the regex compilation to fault');
      expect(result.error.kind).toBe('runtime');
      expect(reads).toBe(1);
    });
  });

  describe('a genuine cel-js `no_such_overload` fault still arms it', () => {
    it('hydrates a string-serialized numeric field and re-evaluates (#1534)', () => {
      const { result, reads } = evaluateCountingReads('record.rating >= 4', 'rating', '5.0');

      expect(result).toEqual({ ok: true, value: true });
      expect(reads).toBeGreaterThan(1); // the retry ran
    });

    it('hydrates a string-serialized date field and re-evaluates (#1530)', () => {
      const { result, reads } = evaluateCountingReads(
        'record.end_date <= daysFromNow(60)',
        'end_date',
        '2026-06-20',
      );

      expect(result.ok).toBe(true);
      expect(reads).toBeGreaterThan(1);
    });

    it('the fault the retry keys on really is an EvaluationError carrying `no_such_overload`', () => {
      // The structured read the predicate now performs is only as good as this
      // pairing. Pinned against cel-js as installed, so a re-code or a re-class
      // upstream goes red here rather than by silently disarming the retry.
      const env = new Environment({ unlistedVariablesAreDyn: true });
      let caught: unknown;
      try {
        env.evaluate('record.rating >= 4', { record: { rating: '5.0' } });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(EvaluationError);
      expect((caught as EvaluationError).code).toBe('no_such_overload');
    });
  });
});
