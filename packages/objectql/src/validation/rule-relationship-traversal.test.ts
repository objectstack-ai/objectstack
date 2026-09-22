// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  collectPredicateRelationships,
  evaluateValidationRules,
} from './rule-validator.js';
import { ValidationError } from './record-validator.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at MODULE
// LOAD, not inside a clocked `it()` body.
import '@objectstack/spec';
import '@objectstack/formula';

/**
 * [#18682] A validation rule on `crm_opportunity` that reads the owning
 * account's category one hop through the `account` lookup — the card's own
 * worked case, and the shape hotcrm #1915's gate is written in.
 *
 * The predicate expresses the FAILURE condition: a `partner` account may not
 * carry an opportunity over 10000.
 */
const opportunity = {
  fields: {
    name: { type: 'text', label: 'Name' },
    amount: { type: 'currency', label: 'Amount' },
    account: { type: 'lookup', reference: 'crm_account', label: 'Account' },
    // A NON-reference object-valued field, to prove the collector leaves it be.
    address: { type: 'object', label: 'Address' },
  },
  validations: [
    {
      name: 'partner_cap',
      type: 'script',
      severity: 'error',
      message: 'Partner accounts are capped at 10000.',
      fields: ['amount'],
      condition: "record.account.type == 'partner' && record.amount > 10000",
    },
  ],
};

const evaluate = (
  data: Record<string, unknown>,
  related?: Record<string, Record<string, unknown> | null>,
): void => {
  evaluateValidationRules(opportunity as any, data, 'insert', { related });
};

describe('#18682 — collectPredicateRelationships: what the engine must preload', () => {
  it('names the reference field and the related field the rule reads', () => {
    const map = collectPredicateRelationships(opportunity as any);
    expect([...map.keys()]).toEqual(['account']);
    expect([...map.get('account')!]).toEqual(['type']);
  });

  it('is empty when no rule traverses — the engine then pays no extra read', () => {
    const map = collectPredicateRelationships({
      fields: opportunity.fields,
      validations: [{ name: 'cap', type: 'script', condition: 'record.amount > 10000' }],
    } as any);
    expect(map.size).toBe(0);
  });

  // The collector asks the spec's own arbiter what a field points at, so an
  // object-valued field that traverses today keeps traversing and is never
  // preloaded.
  it('ignores a NON-reference field that is traversed', () => {
    const map = collectPredicateRelationships({
      fields: opportunity.fields,
      validations: [{ name: 'a', type: 'script', condition: "record.address.city == 'SF'" }],
    } as any);
    expect(map.size).toBe(0);
  });

  it('reaches a predicate nested inside a `conditional`', () => {
    const map = collectPredicateRelationships({
      fields: opportunity.fields,
      validations: [{
        name: 'wrapper',
        type: 'conditional',
        when: 'record.amount > 0',
        then: { name: 'inner', type: 'cross_field', condition: "record.account.tier == 'gold'" },
      }],
    } as any);
    expect([...map.get('account')!]).toEqual(['tier']);
  });
});

describe('#18682 — the three acceptance outcomes (ADR-0136 D2.4)', () => {
  // ── PASSES when the parent field matches ──────────────────────────────────
  it('ACCEPTS the write when the parent field does not trip the rule', () => {
    expect(() =>
      evaluate({ name: 'A', amount: 50000, account: 'acc_1' }, { account: { id: 'acc_1', type: 'direct' } }),
    ).not.toThrow();
  });

  it('ACCEPTS when the parent matches but the local half does not', () => {
    expect(() =>
      evaluate({ name: 'A', amount: 10, account: 'acc_1' }, { account: { id: 'acc_1', type: 'partner' } }),
    ).not.toThrow();
  });

  // ── REFUSES the write when it does not ────────────────────────────────────
  it('REFUSES the write when the parent field trips the rule', () => {
    expect(() =>
      evaluate({ name: 'A', amount: 50000, account: 'acc_1' }, { account: { id: 'acc_1', type: 'partner' } }),
    ).toThrow(ValidationError);
  });

  it('the refusal carries the authored message, not a fault', () => {
    try {
      evaluate({ name: 'A', amount: 50000, account: 'acc_1' }, { account: { id: 'acc_1', type: 'partner' } });
      throw new Error('expected a ValidationError');
    } catch (e) {
      const err = e as ValidationError;
      expect(err).toBeInstanceOf(ValidationError);
      const detail = JSON.stringify((err as unknown as { errors?: unknown }).errors ?? err.message);
      expect(detail).toContain('Partner accounts are capped at 10000.');
      expect(detail).not.toContain('could not be evaluated');
    }
  });

  // ── FAULTS LOUDLY when the acting user cannot read the parent field ───────
  //
  // The engine reads the related row under the ACTING USER, so a row the user
  // may not read arrives as `null` and is deliberately NOT overlaid. The stored
  // id stays, the traversal faults with `No such key`, and an unevaluable
  // validation predicate REJECTS the write (#4649). Never silently true, and
  // never silently false either.
  it('FAULTS LOUDLY and rejects when the related row is unreadable (null)', () => {
    expect(() =>
      evaluate({ name: 'A', amount: 50000, account: 'acc_1' }, { account: null }),
    ).toThrow(ValidationError);
  });

  it('FAULTS LOUDLY and rejects when no binding was supplied at all', () => {
    expect(() => evaluate({ name: 'A', amount: 50000, account: 'acc_1' })).toThrow(ValidationError);
  });

  it('the fault is reported AS a fault, naming the unevaluable rule', () => {
    try {
      evaluate({ name: 'A', amount: 50000, account: 'acc_1' }, { account: null });
      throw new Error('expected a ValidationError');
    } catch (e) {
      const err = e as ValidationError;
      const detail = JSON.stringify((err as unknown as { errors?: unknown }).errors ?? err.message);
      expect(detail).toContain('could not be evaluated');
      expect(detail).toContain('partner_cap');
    }
  });

  // The unreadable case must not be quietly waved through even when the LOCAL
  // half of the predicate would have decided it. Short-circuit order is not a
  // permission decision.
  it('rejects on an unreadable parent even when the local half is false', () => {
    expect(() =>
      evaluate(
        { name: 'A', amount: 50000, account: 'acc_1' },
        { account: null },
      ),
    ).toThrow(ValidationError);
  });
});

describe('#18682 — hydration is per-rule and never reaches the write payload', () => {
  // The hazard this pins: `checkPredicate` is handed the engine's merged write
  // payload. Hydrating it in place would send the expanded related RECORD to
  // the driver in place of the foreign key.
  it('does NOT mutate the record it was handed', () => {
    const data = { name: 'A', amount: 10, account: 'acc_1' };
    evaluate(data, { account: { id: 'acc_1', type: 'partner' } });
    expect(data.account).toBe('acc_1');
  });

  // Two rules on one object need not agree about how they read a field. The
  // rule that traverses is hydrated; the rule that compares the bare id is not.
  it('leaves a sibling rule that compares the BARE foreign key untouched', () => {
    const schema = {
      fields: opportunity.fields,
      validations: [
        // traverses — gets the related record
        { name: 'partner_cap', type: 'script', severity: 'error', message: 'capped',
          condition: "record.account.type == 'partner' && record.amount > 10000" },
        // compares the bare id — must still see the stored id, so this FIRES
        { name: 'blocked_account', type: 'script', severity: 'error', message: 'blocked account',
          condition: "record.account == 'acc_1'" },
      ],
    };
    try {
      evaluateValidationRules(schema as any, { name: 'A', amount: 10, account: 'acc_1' }, 'insert',
        { related: { account: { id: 'acc_1', type: 'partner' } } });
      throw new Error('expected a ValidationError');
    } catch (e) {
      const detail = JSON.stringify((e as unknown as { errors?: unknown }).errors ?? (e as Error).message);
      // The bare-id rule fired on the stored id — hydration did not leak into it.
      expect(detail).toContain('blocked account');
      // …and it fired as a VIOLATION, not as an unevaluable fault.
      expect(detail).not.toContain('could not be evaluated');
    }
  });

  // A rule that names no traversal must be handed exactly what it was handed
  // before this change — that is what keeps every existing rule unaffected.
  it('a non-traversing rule is unaffected by a binding being present', () => {
    const schema = {
      fields: opportunity.fields,
      validations: [{ name: 'cap', type: 'script', severity: 'error', message: 'too big',
        condition: 'record.amount > 10000' }],
    };
    expect(() =>
      evaluateValidationRules(schema as any, { name: 'A', amount: 10, account: 'acc_1' }, 'insert',
        { related: { account: { id: 'acc_1', type: 'partner' } } }),
    ).not.toThrow();
  });
});
