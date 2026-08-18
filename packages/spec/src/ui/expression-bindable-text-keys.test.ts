// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins for the closed expression-bindable text-key vocabulary (objectui#4795
 * Direction 1, spec half — objectstack#9599). The contract these tests hold:
 *
 *   1. The key set is CLOSED at the four ruled members — a fifth key appearing
 *      here must arrive through a maintainer ruling, and this pin is what makes
 *      that loud instead of a silent accept-surface widening.
 *   2. The per-component map answers mechanically for EVERY type string —
 *      listed rows with their measured subsets, everything else with the empty
 *      set — and the runtime shape is frozen, because the objectui memo reads
 *      it at render time.
 *   3. `content` stays OUT: it has its own evaluation leg in the memo, and one
 *      key must not have two declared evaluation paths.
 */
import { describe, it, expect } from 'vitest';
import {
  EXPRESSION_BINDABLE_TEXT_KEYS,
  EXPRESSION_BINDABLE_TEXT_KEYS_BY_COMPONENT,
  ExpressionBindableTextKeySchema,
  expressionBindableTextKeysFor,
  isExpressionBindableTextKey,
} from './expression-bindable-text-keys.zod';

describe('EXPRESSION_BINDABLE_TEXT_KEYS — the closed enum', () => {
  it('is exactly the four ruled keys, in the ruling’s order', () => {
    expect(EXPRESSION_BINDABLE_TEXT_KEYS).toEqual([
      'title',
      'label',
      'value',
      'description',
    ]);
  });

  it('the Zod face accepts each member and only the members', () => {
    for (const key of EXPRESSION_BINDABLE_TEXT_KEYS) {
      expect(ExpressionBindableTextKeySchema.safeParse(key).success).toBe(true);
    }
    // `content` is deliberately excluded (it has its own evaluation leg);
    // `header` is a near-miss card key; casing is not forgiven.
    for (const nonMember of ['content', 'header', 'Title', 'LABEL', '']) {
      expect(ExpressionBindableTextKeySchema.safeParse(nonMember).success).toBe(
        false
      );
    }
  });

  it('isExpressionBindableTextKey agrees with the enum in both directions', () => {
    for (const key of EXPRESSION_BINDABLE_TEXT_KEYS) {
      expect(isExpressionBindableTextKey(key)).toBe(true);
    }
    expect(isExpressionBindableTextKey('content')).toBe(false);
    expect(isExpressionBindableTextKey('subtitle')).toBe(false);
  });
});

describe('EXPRESSION_BINDABLE_TEXT_KEYS_BY_COMPONENT — measured carriage', () => {
  it('matches the renderer read points measured at the objectui pin', () => {
    // data-display/statistic.tsx reads schema.label / .value / .description;
    // layout/card.tsx reads schema.title / .description;
    // form/button.tsx (and action/action-button.tsx) read schema.label.
    expect(EXPRESSION_BINDABLE_TEXT_KEYS_BY_COMPONENT).toEqual({
      statistic: ['label', 'value', 'description'],
      card: ['title', 'description'],
      button: ['label'],
    });
  });

  it('every declared key is a member of the closed enum, with no duplicates', () => {
    for (const [type, keys] of Object.entries(
      EXPRESSION_BINDABLE_TEXT_KEYS_BY_COMPONENT
    )) {
      expect(keys.length, `row ${type}`).toBeGreaterThan(0);
      expect(new Set(keys).size, `row ${type} has duplicates`).toBe(keys.length);
      for (const key of keys) {
        expect(
          isExpressionBindableTextKey(key),
          `row ${type} carries non-member key ${key}`
        ).toBe(true);
      }
    }
  });

  it('the map and its rows are frozen — the contract cannot be mutated by a consumer', () => {
    expect(Object.isFrozen(EXPRESSION_BINDABLE_TEXT_KEYS_BY_COMPONENT)).toBe(
      true
    );
    for (const keys of Object.values(
      EXPRESSION_BINDABLE_TEXT_KEYS_BY_COMPONENT
    )) {
      expect(Object.isFrozen(keys)).toBe(true);
    }
  });
});

describe('expressionBindableTextKeysFor — the mechanical per-type answer', () => {
  it('returns the declared row for a listed type', () => {
    expect(expressionBindableTextKeysFor('statistic')).toEqual([
      'label',
      'value',
      'description',
    ]);
    expect(expressionBindableTextKeysFor('card')).toEqual([
      'title',
      'description',
    ]);
    expect(expressionBindableTextKeysFor('button')).toEqual(['label']);
  });

  it('answers the empty set for every unlisted type — closed, never inferred', () => {
    // `text` binds through its own `content` leg; `element:*` / `page:*`
    // config rides the evaluated `properties` bag — none of them get rows
    // inferred from what their renderers happen to read.
    for (const type of ['text', 'element:text', 'page:card', 'alert', '']) {
      const keys = expressionBindableTextKeysFor(type);
      expect(keys).toEqual([]);
      expect(Object.isFrozen(keys)).toBe(true);
    }
  });

  it('prototype-chain names are not rows', () => {
    for (const hostile of [
      'constructor',
      '__proto__',
      'toString',
      'hasOwnProperty',
    ]) {
      expect(expressionBindableTextKeysFor(hostile)).toEqual([]);
    }
  });
});
