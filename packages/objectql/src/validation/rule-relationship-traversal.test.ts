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

/** A readable, resolved parent row. */
const row = (r: Record<string, unknown>) => ({ object: 'crm_account', row: r });
/** The engine could not make the parent readable for this caller. */
const unavailable = (
  reason: 'no-reference' | 'unreadable' | 'field-unreadable' | 'unresolved',
  unreadableFields?: string[],
) => ({ object: 'crm_account', unavailable: reason, unreadableFields });

const evaluate = (
  data: Record<string, unknown>,
  related?: Record<string, unknown>,
): void => {
  evaluateValidationRules(opportunity as any, data, 'insert', { related: related as never });
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

describe('#18682 — the three acceptance outcomes (ADR-0137 D2)', () => {
  // ── PASSES when the parent field matches ──────────────────────────────────
  it('ACCEPTS the write when the parent field does not trip the rule', () => {
    expect(() =>
      evaluate({ name: 'A', amount: 50000, account: 'acc_1' }, { account: row({ id: 'acc_1', type: 'direct' }) }),
    ).not.toThrow();
  });

  it('ACCEPTS when the parent matches but the local half does not', () => {
    expect(() =>
      evaluate({ name: 'A', amount: 10, account: 'acc_1' }, { account: row({ id: 'acc_1', type: 'partner' }) }),
    ).not.toThrow();
  });

  // ── REFUSES the write when it does not ────────────────────────────────────
  it('REFUSES the write when the parent field trips the rule', () => {
    expect(() =>
      evaluate({ name: 'A', amount: 50000, account: 'acc_1' }, { account: row({ id: 'acc_1', type: 'partner' }) }),
    ).toThrow(ValidationError);
  });

  it('the refusal carries the authored message, not a fault', () => {
    try {
      evaluate({ name: 'A', amount: 50000, account: 'acc_1' }, { account: row({ id: 'acc_1', type: 'partner' }) });
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
      evaluate({ name: 'A', amount: 50000, account: 'acc_1' }, { account: unavailable('unreadable') }),
    ).toThrow(ValidationError);
  });

  it('FAULTS LOUDLY and rejects when no binding was supplied at all', () => {
    expect(() => evaluate({ name: 'A', amount: 50000, account: 'acc_1' })).toThrow(ValidationError);
  });

  it('the fault is reported AS a fault, naming the unevaluable rule', () => {
    try {
      evaluate({ name: 'A', amount: 50000, account: 'acc_1' }, { account: unavailable('unreadable') });
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
        { account: unavailable('unreadable') },
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
    evaluate(data, { account: row({ id: 'acc_1', type: 'partner' }) });
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
        { related: { account: row({ id: 'acc_1', type: 'partner' }) } });
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
        { related: { account: row({ id: 'acc_1', type: 'partner' }) } }),
    ).not.toThrow();
  });
});

describe('#18682 — the engine refuses the unserviceable shape, not only lint', () => {
  // ⭐ The defect this closes: the mixed shape was REJECTED before the
  // capability (the traversal faulted) and would have been ACCEPTED after it,
  // with the bare arm silently `false` — option B's harm, on every path that
  // authors metadata without running lint (Studio, `sys_metadata`, an agent).
  // ADR-0124: an author-side direction is never the whole answer.
  const mixed = {
    fields: opportunity.fields,
    validations: [{
      name: 'mixed', type: 'script', severity: 'error', message: 'should never be reached',
      condition: "record.account.type == 'partner' && record.account == 'acc_1'",
    }],
  };

  it('REFUSES a rule that reads a reference field both ways, even with a readable parent', () => {
    try {
      evaluateValidationRules(mixed as any, { name: 'A', account: 'acc_1' }, 'insert',
        { related: { account: row({ id: 'acc_1', type: 'partner' }) } as never });
      throw new Error('expected a ValidationError');
    } catch (e) {
      const detail = JSON.stringify((e as unknown as { errors?: unknown }).errors ?? (e as Error).message);
      expect(detail).toContain('could not be evaluated');
      expect(detail).toContain('record.account.id');
      // ⛔ and never the rule's own message — the rule produced NO verdict.
      expect(detail).not.toContain('should never be reached');
    }
  });

  it('REFUSES a read deeper than one hop in the engine too', () => {
    const deep = {
      fields: opportunity.fields,
      validations: [{ name: 'deep', type: 'script', severity: 'error', message: 'no',
        condition: "record.account.owner.email == 'x@y.z'" }],
    };
    expect(() => evaluateValidationRules(deep as any, { name: 'A', account: 'acc_1' }, 'insert', {}))
      .toThrow(ValidationError);
  });
});

describe('#18682 — the refusal names the RELATED object, not the referencing one', () => {
  // ADR-0137 D2: a faulting field-rule predicate names the field and the rule.
  // The generic undeclared-key prescription said the field "this object does not
  // declare", which on a traversal is false in every clause — the field IS
  // declared, on the related object — and sent the author to the wrong file.
  const cases: Array<[string, ReturnType<typeof unavailable>, string[]]> = [
    ['unreadable object', unavailable('unreadable'), ["may not read", "'crm_account'"]],
    ['unreadable field', unavailable('field-unreadable', ['type']), ["may not read", "'type'"]],
    ['no reference stored', unavailable('no-reference'), ['no related record']],
    ['related row gone', unavailable('unresolved'), ['could not be read']],
  ];

  for (const [name, binding, expected] of cases) {
    it(`names the related object and field — ${name}`, () => {
      try {
        evaluate({ name: 'A', amount: 50000, account: 'acc_1' }, { account: binding });
        throw new Error('expected a ValidationError');
      } catch (e) {
        const detail = JSON.stringify((e as unknown as { errors?: unknown }).errors ?? (e as Error).message);
        for (const needle of expected) expect(detail).toContain(needle);
        // ⛔ never the prescription that names the REFERENCING object.
        expect(detail).not.toContain('which this object does not declare');
        expect(detail).toContain('partner_cap');
      }
    });
  }
});

describe('#18682 — the permission verdict does not depend on the CEL operator', () => {
  // `has()` returns `false` on an absent key, and `.?` yields a default — so an
  // author who reaches for a null-safe spelling would have turned "the caller
  // may not read this" into an ordinary `false` and the rule would stop firing.
  // The engine decides readability BEFORE evaluation, so every spelling refuses.
  const guarded = (condition: string) => ({
    fields: opportunity.fields,
    validations: [{ name: 'guarded', type: 'script', severity: 'error', message: 'fired', condition }],
  });

  it.each([
    ['plain member access', "record.account.type == 'partner'"],
    ['has() guard', "has(record.account.type) && record.account.type == 'partner'"],
    ['optional selection', "record.account.?type.orValue('') == 'partner'"],
  ])('refuses an unreadable parent — %s', (_name, condition) => {
    expect(() =>
      evaluateValidationRules(guarded(condition) as any, { name: 'A', account: 'acc_1' }, 'insert',
        { related: { account: unavailable('field-unreadable', ['type']) } as never }),
    ).toThrow(ValidationError);
  });
});

describe('#18682 — a readable but EMPTY related column evaluates, it does not refuse', () => {
  // #6457's trap, one root over and on a fail-CLOSED seam: a driver that does
  // not echo an all-null column must not make a valid write fail. The engine
  // materialises readable declared fields to `null`, so the predicate evaluates.
  it('accepts when the parent field is materialised null and the rule does not trip', () => {
    expect(() =>
      evaluate({ name: 'A', amount: 50000, account: 'acc_1' }, { account: row({ id: 'acc_1', type: null }) }),
    ).not.toThrow();
  });
});
