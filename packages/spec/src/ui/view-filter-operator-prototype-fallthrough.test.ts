// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `Object.prototype` fall-through pin for `normalizeFilterOperator`.
 *
 * Its POPULATION is the point. Every other assertion on this fold in this
 * package iterates the canonical operator vocabulary and the declared legacy
 * aliases — precisely the population that behaves — which is why the site sat
 * green while `normalizeFilterOperator('constructor')` returned the `Object`
 * FUNCTION out of a signature that declares `string`.
 *
 * This site is the worst member of the family: it indexed the alias table
 * TWICE, once raw and once lower-cased, so the case-folding accident that keeps
 * `toString` / `valueOf` quiet at `canonicalizeSqlType` and
 * `resolveDiscoveryEnvironment` does not exist here and all three prototype
 * methods came back.
 *
 * `op` is uncontrolled: this fold is exported precisely so producers and
 * renderers normalize STORED metadata through it, and a plain-JS producer has
 * no compile-time narrowing at all.
 */

import { describe, expect, it } from 'vitest';
import { normalizeFilterOperator, VIEW_FILTER_OPERATORS } from './view.zod';

// Fixed at five: the three prototype methods a raw key can name, the
// assignment-shaped one, and a plain unknown word that names nothing at all.
// Four is not four-fifths of this pin.
const POPULATION = ['constructor', 'toString', 'valueOf', '__proto__', 'nope'] as const;

describe('normalizeFilterOperator — Object.prototype fall-through', () => {
  it('folds the real vocabulary (lit control — the pin is not vacuous)', () => {
    expect(normalizeFilterOperator('eq')).toBe('equals');
    expect(normalizeFilterOperator('notIn')).toBe('not_in');
    expect(normalizeFilterOperator('equals')).toBe('equals');
  });

  it.each(POPULATION)('%s answers a string, never a prototype member', (word) => {
    // The assertion is on the SHAPE of the answer, not on which word it is:
    // what the defect produced was a `function` (and an `object` for
    // `__proto__`) out of a signature that declares `string`.
    const answer = normalizeFilterOperator(word);
    expect(typeof answer).toBe('string');
  });

  it.each(POPULATION)('%s resolves to a canonical operator or to the input verbatim', (word) => {
    const answer = normalizeFilterOperator(word);
    const canonical = (VIEW_FILTER_OPERATORS as readonly string[]).includes(answer);
    expect(canonical || answer === word, `got ${JSON.stringify(answer)}`).toBe(true);
  });

  it("refuses each probe with this function's own declared refusal value", () => {
    // Returning the input verbatim is the trailing `return` of the function
    // itself — the answer an unknown word like `nope` already gets, so the
    // enum's own validation reports it as invalid. ⛔ Not a value invented for
    // the fix.
    for (const word of POPULATION) {
      expect(normalizeFilterOperator(word), word).toBe(word);
    }
  });
});
