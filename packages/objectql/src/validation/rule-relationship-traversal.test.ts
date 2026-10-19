// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  collectPredicateRelationships,
  evaluateValidationRules,
  referentialClearBinding,
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
/** The engine could not resolve the parent row for this predicate. */
const unavailable = (
  reason: 'no-reference' | 'unreadable' | 'undeclared-field' | 'unresolved',
  undeclaredFields?: string[],
) => ({ object: 'crm_account', unavailable: reason, undeclaredFields });

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

  // ── REFUSES LOUDLY when the rule cannot be evaluated at all ───────────────
  //
  // The causes: no reference stored, the related record was not found, the
  // related object declares no such column, or the read failed outright. Each
  // is refused with a sentence naming the related object, and the write is
  // REJECTED rather than judged on a rule that produced no verdict. Never
  // silently true, and never silently false either.
  it('REFUSES LOUDLY and rejects when the related row could not be resolved', () => {
    expect(() =>
      evaluate({ name: 'A', amount: 50000, account: 'acc_1' }, { account: unavailable('unresolved') }),
    ).toThrow(ValidationError);
  });

  it('REFUSES and rejects when no binding was supplied at all', () => {
    expect(() => evaluate({ name: 'A', amount: 50000, account: 'acc_1' })).toThrow(ValidationError);
  });

  it('the fault is reported AS a fault, naming the unevaluable rule', () => {
    try {
      evaluate({ name: 'A', amount: 50000, account: 'acc_1' }, { account: unavailable('unresolved') });
      throw new Error('expected a ValidationError');
    } catch (e) {
      const err = e as ValidationError;
      const detail = JSON.stringify((err as unknown as { errors?: unknown }).errors ?? err.message);
      expect(detail).toContain('could not be evaluated');
      expect(detail).toContain('partner_cap');
    }
  });

  // An unresolvable parent must not be quietly waved through even when the
  // LOCAL half of the predicate would have decided it. Short-circuit order is
  // not a verdict.
  it('rejects on an unresolvable parent even when the local half is false', () => {
    expect(() =>
      evaluate(
        { name: 'A', amount: 50000, account: 'acc_1' },
        { account: unavailable('unresolved') },
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
      // [#20007] …and, for a null test, the guard the engine's other refusals name.
      expect(detail).toContain('`conditional` rule whose `when` is `record.account != null`');
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
    ['read failed', unavailable('unreadable'), ['could not read', "'crm_account'"]],
    ['undeclared related field', unavailable('undeclared-field', ['type']), ['declares no', "'type'"]],
    // [#20007] …and the two repairs measured to work for an EMPTY reference: the
    // guard in `referenceGuardRepair`'s spelling, and `required`.
    ['no reference stored', unavailable('no-reference'), [
      'no single related record', 'MULTIPLE references',
      '`conditional` rule whose `when` is `record.account != null`', 'make `account` required',
    ]],
    ['related record not found', unavailable('unresolved'), ["'crm_account'", 'the related record was not found']],
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
  ])('refuses a genuinely faulted parent — %s', (_name, condition) => {
    expect(() =>
      evaluateValidationRules(guarded(condition) as any, { name: 'A', account: 'acc_1' }, 'insert',
        { related: { account: unavailable('undeclared-field', ['type']) } as never }),
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

describe('#18682 — a binding is used only for the record its foreign key names', () => {
  // The evaluator judges `record`, so a related row for any OTHER id is not
  // this record's parent: it refuses as unresolved rather than evaluating.
  it('REFUSES a row whose id is not the record’s foreign key', () => {
    try {
      evaluate({ name: 'A', amount: 50000, account: 'acc_1' }, { account: row({ id: 'acc_2', type: 'direct' }) });
      throw new Error('expected a ValidationError');
    } catch (e) {
      const detail = JSON.stringify((e as unknown as { errors?: unknown }).errors ?? (e as Error).message);
      expect(detail).toContain('the related record was not found');
    }
  });
});

// [#20006] The evaluator half of a delete's reference cleanup. The engine hands
// the cleanup an EMPTY binding that remembers the delete and the reference it
// clears (end to end in `engine-predicate-relationship.test.ts`); these pin what
// the evaluator does with it, arm by arm.
describe('#20006 — the reference-cleanup binding changes a text, never a verdict', () => {
  const deal = {
    fields: {
      amount: { type: 'number' },
      account: { type: 'lookup', reference: 'crm_account' },
      accounts: { type: 'lookup', reference: 'crm_account', multiple: true },
      region: { type: 'lookup', reference: 'crm_region' },
    },
  };
  const cleanupOf = (field: string) => referentialClearBinding({
    object: 'crm_account', id: 'acc_1', referencingObject: 'crm_deal', field,
  });
  /** The refusal message, or `null` when the write is accepted. */
  const refusal = (
    condition: string, data: Record<string, unknown>, field: string, fields: Record<string, unknown> = deal.fields,
  ): string | null => {
    try {
      evaluateValidationRules(
        { fields, validations: [{ name: 'r', type: 'script', severity: 'error', message: 'fired', condition }] } as any,
        data, 'update', { previous: { id: 'deal_1', ...data }, related: cleanupOf(field) },
      );
      return null;
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      return (e as Error).message;
    }
  };

  it('offers the guard only to a rule reading through the reference the cleanup EMPTIES', () => {
    const reads = refusal("record.account.status == 'closed'", { account: null, region: 'reg_1' }, 'account');
    expect(reads).toContain('Cannot delete crm_account (acc_1): the delete clears `account`');
    expect(reads).toContain('`when` is `record.account != null`');
    // A rule reading only ANOTHER reference would stop being judged wherever
    // `account` is empty, so it is offered `deleteBehavior` alone.
    const other = refusal("record.region.kind == 'secret'", { account: null, region: 'reg_1' }, 'account');
    expect(other).toContain('Cannot delete crm_account (acc_1): the delete clears `account`');
    expect(other).toContain('Change `deleteBehavior` on crm_deal.account');
    expect(other).not.toContain('conditional');
  });

  it('attributes a key read both ways to the traversal only when the traversal is what faults', () => {
    // `status` is DECLARED here, so `record.status` reads null and cannot fault:
    // the `No such key: status` is the traversal's, and the cleanup text is right.
    const declared = refusal("record.status == 'x' || record.account.status == 'closed'",
      { account: null, status: null }, 'account', { ...deal.fields, status: { type: 'text' } });
    expect(declared).toContain('Cannot delete crm_account (acc_1)');
    // `previous.kind` faults on a deal that declares no `kind`, whatever `region`
    // holds — a root the rule's traversal analysis does not describe.
    const previous = refusal("previous.kind == 'x' && record.region.kind == 'secret'",
      { account: null, region: 'reg_1' }, 'account');
    expect(previous).toMatch(/^Validation rule 'r' could not be evaluated \(runtime: No such key: kind\)/);
    expect(previous).not.toContain('Cannot delete');
  });

  it('offers only deleteBehavior on a multi-value reference, where the guard would still run the rule', () => {
    const message = refusal("record.region.kind == 'secret'", { accounts: ['acc_2'], region: 'reg_1' }, 'accounts');
    expect(message).toContain('the delete removes it from `accounts`');
    expect(message).toContain('`deleteBehavior` on crm_deal.accounts');
    expect(message).not.toContain('conditional');
  });

  it("keeps the generic text for a fault in the rule's OWN columns — broken on every write, not by the cleanup", () => {
    // The ternary's condition is evaluated first, so the fault is `nope`, not the traversal.
    const message = refusal("record.nope == 1 ? record.region.kind == 'secret' : false", { account: null, region: 'reg_1' }, 'account');
    expect(message).toMatch(/^Validation rule 'r' could not be evaluated \(runtime: No such key: nope\)/);
    expect(message).not.toContain('Cannot delete');
  });

  it('decides nothing: a rule with a verdict that reads through no resolved record keeps it', () => {
    expect(refusal("record.amount > 100 && record.region.kind == 'secret'", { amount: 5, account: null, region: 'reg_1' }, 'account'))
      .toBe(null);
    expect(refusal("record.amount > 100 && record.region.kind == 'secret'", { amount: 500, account: null, region: 'reg_1' }, 'account'))
      .toContain('Cannot delete crm_account (acc_1)');
  });

  it('CONTROL: a plain empty binding carries no cleanup — the generic text', () => {
    let message = '';
    try {
      evaluateValidationRules(
        { ...deal, validations: [{ name: 'r', type: 'script', severity: 'error', message: 'fired', condition: "record.region.kind == 'secret'" }] } as any,
        { account: null, region: 'reg_1' }, 'update', { previous: { id: 'deal_1' }, related: {} },
      );
    } catch (e) { message = (e as Error).message; }
    expect(message).toMatch(/^Validation rule 'r' could not be evaluated \(runtime: No such key: kind\)/);
  });
});

describe('[#24468] undeclared related fields are judged per RULE, never per reference', () => {
  // The engine leaves every rule's undeclared columns out of the shared read
  // and lists them on the binding beside the row the declared rest read.
  const withUndeclared = (r: Record<string, unknown>) => ({ ...row(r), undeclaredFields: ['region'] });
  const both = {
    fields: opportunity.fields,
    validations: [
      opportunity.validations[0],
      { name: 'north_only', type: 'script', severity: 'error', message: 'north', condition: "record.account.region == 'north'" },
    ],
  };
  const errorsOf = (data: Record<string, unknown>, related: Record<string, unknown>): string => {
    try {
      evaluateValidationRules(both as any, data, 'insert', { related: related as never });
    } catch (e) {
      return JSON.stringify((e as unknown as { errors?: unknown }).errors ?? (e as Error).message);
    }
    return '';
  };

  it('a valid sibling keeps its own verdict: it admits, and only the bad rule refuses, naming its own field', () => {
    const text = errorsOf({ name: 'A', amount: 50000, account: 'acc_1' },
      { account: withUndeclared({ id: 'acc_1', type: 'direct' }) });
    expect(text).toContain("Validation rule 'north_only' could not be evaluated");
    expect(text).toContain("declares no 'region'");
    expect(text).not.toContain('partner_cap');
  });

  it('a valid sibling keeps its own verdict: it refuses with its own message', () => {
    const text = errorsOf({ name: 'A', amount: 50000, account: 'acc_1' },
      { account: withUndeclared({ id: 'acc_1', type: 'partner' }) });
    expect(text).toContain('Partner accounts are capped at 10000.');
    expect(text).not.toContain("Validation rule 'partner_cap' could not be evaluated");
  });

  it('the bad rule names only its own undeclared field, not a sibling\'s', () => {
    const text = errorsOf({ name: 'A', amount: 1, account: 'acc_1' },
      { account: { ...row({ id: 'acc_1', type: 'direct' }), undeclaredFields: ['region', 'tier'] } });
    expect(text).toContain("declares no 'region'");
    expect(text).not.toContain("'tier'");
  });

  it('with no declared column left, every rule through the reference still names its own', () => {
    const only = { fields: opportunity.fields, validations: [both.validations[1]] };
    expect(() => evaluateValidationRules(only as any, { name: 'A', account: 'acc_1' }, 'insert',
      { related: { account: unavailable('undeclared-field', ['region']) } as never })).toThrow(/declares no 'region'/);
  });
});

// [#24512] A `conditional` rule's `when` reads one hop through a reference the
// way a `script` condition does: the collector names the hop (so the engine
// preloads it), and `checkConditional` evaluates `when` on the scope
// `resolveTraversalScope` decides — the related row, or a refusal naming why
// there is none. Before, `when` met the bare id and every write it guarded was
// refused as unevaluable.
describe('[#24512] a `conditional` rule\'s `when` reads one hop through a reference', () => {
  const THEN = 'GATE-THEN: partner deals are capped at 10000.';
  const OTHERWISE = 'GATE-OTHERWISE: direct deals start at 100.';
  const SIBLING = 'SIBLING: deals over 100000 need approval.';
  /** The card's shape: a `conditional` whose `when` reads the account's type. */
  const gate = (when: string, name = 'partner_gate') => ({
    name, type: 'conditional', severity: 'error', message: 'unused', when,
    then: { name: 'gate_cap', type: 'script', severity: 'error', message: THEN, condition: 'record.amount > 10000' },
    otherwise: { name: 'gate_floor', type: 'script', severity: 'error', message: OTHERWISE, condition: 'record.amount < 100' },
  });
  const sibling = { name: 'big_deal', type: 'script', severity: 'error', message: SIBLING, condition: 'record.amount > 100000' };
  const schemaOf = (...validations: unknown[]) => ({ fields: opportunity.fields, validations });
  const PARTNER = { account: row({ id: 'acc_1', type: 'partner' }) };
  const DIRECT = { account: row({ id: 'acc_1', type: 'direct' }) };

  /** The thrown envelope, or `null` when the write is accepted. */
  const verdict = (
    schema: unknown, data: Record<string, unknown>, related?: Record<string, unknown>,
  ): ValidationError | null => {
    try {
      evaluateValidationRules(schema as any, data, 'insert', { related: related as never });
      return null;
    } catch (e) {
      if (e instanceof ValidationError) return e;
      throw e;
    }
  };
  const messagesOf = (e: ValidationError | null): string[] => (e?.fields ?? []).map((f) => f.message);
  const deal = (amount: number) => ({ name: 'A', amount, account: 'acc_1' });

  describe('the collector reaches `when`, so the engine preloads its hop', () => {
    it('names the hop a top-level `when` takes', () => {
      const map = collectPredicateRelationships(schemaOf(gate("record.account.type == 'partner'")) as any);
      expect([...map.keys()]).toEqual(['account']);
      expect([...map.get('account')!]).toEqual(['type']);
    });

    it('names the hop a `when` nested in a branch takes', () => {
      const map = collectPredicateRelationships(schemaOf({
        name: 'outer', type: 'conditional', when: 'record.amount > 0',
        otherwise: gate("record.account.tier == 'gold'", 'inner'),
      }) as any);
      expect([...map.keys()]).toEqual(['account']);
      expect([...map.get('account')!]).toEqual(['tier']);
    });

    it('names nothing for the guard spelling, which reads the stored id and no hop', () => {
      expect(collectPredicateRelationships(schemaOf(gate('record.account != null')) as any).size).toBe(0);
    });
  });

  describe('`when` is evaluated on the related row and picks its branch', () => {
    const schema = schemaOf(gate("record.account.type == 'partner'"));

    it('a partner account runs `then`', () => {
      const refused = verdict(schema, deal(50000), PARTNER);
      expect(refused?.code).toBe('VALIDATION_FAILED');
      expect(refused?.fields).toEqual([expect.objectContaining({ field: '_record', code: 'rule_violation', message: THEN })]);
      expect(refused?.fields[0]?.constraint?.reason).toBeUndefined();
      // `then` admits what it does not refuse, and `otherwise` is not run.
      expect(verdict(schema, deal(50), PARTNER)).toBeNull();
    });

    it('any other account runs `otherwise`', () => {
      const refused = verdict(schema, deal(50), DIRECT);
      expect(refused?.code).toBe('VALIDATION_FAILED');
      expect(refused?.fields).toEqual([expect.objectContaining({ field: '_record', code: 'rule_violation', message: OTHERWISE })]);
      // `otherwise` admits what it does not refuse, and `then` is not run.
      expect(verdict(schema, deal(50000), DIRECT)).toBeNull();
    });

    it('a `when` nested in a branch is evaluated on the related row too', () => {
      const nested = schemaOf({
        name: 'outer', type: 'conditional', severity: 'error', message: 'unused', when: 'record.amount > 0',
        then: gate("record.account.type == 'partner'", 'inner'),
      });
      expect(messagesOf(verdict(nested, deal(50000), PARTNER))).toEqual([THEN]);
      expect(messagesOf(verdict(nested, deal(50), DIRECT))).toEqual([OTHERWISE]);
      expect(verdict(nested, deal(50000), DIRECT)).toBeNull();
    });

    it('does not hand the expanded row to the branch rules or back to the caller', () => {
      // The branch reads the stored id: hydration is per predicate, never per rule tree.
      const schemaWithIdBranch = schemaOf({
        ...gate("record.account.type == 'partner'"),
        then: { name: 'blocked', type: 'script', severity: 'error', message: 'blocked account', condition: "record.account == 'acc_1'" },
      });
      const data = deal(10);
      expect(messagesOf(verdict(schemaWithIdBranch, data, PARTNER))).toEqual(['blocked account']);
      expect(data.account).toBe('acc_1');
    });

    it('CONTROL — the guard spelling keeps reading the stored id', () => {
      const guarded = schemaOf({
        name: 'linked', type: 'conditional', severity: 'error', message: 'unused', when: 'record.account != null',
        then: { name: 'cap', type: 'script', severity: 'error', message: THEN, condition: "record.account.type == 'partner' && record.amount > 10000" },
      });
      expect(verdict(guarded, { name: 'A', amount: 50000, account: null }, {})).toBeNull();
      expect(messagesOf(verdict(guarded, deal(50000), PARTNER))).toEqual([THEN]);
    });
  });

  describe('a `when` the engine cannot serve has no verdict — and a sibling keeps its own', () => {
    it('a second hop is refused as unevaluable, naming the rule; the sibling still judges', () => {
      const schema = schemaOf(gate("record.account.owner.region == 'north'"), sibling);
      const refused = verdict(schema, deal(200000), PARTNER);
      expect(refused?.code).toBe('VALIDATION_FAILED');
      const gateError = refused?.fields.find((f) => f.constraint?.rule === 'partner_gate');
      expect(gateError).toMatchObject({
        field: '_record',
        code: 'rule_violation',
        constraint: { rule: 'partner_gate', reason: 'unevaluable', fault: 'reads more than one relationship hop' },
      });
      expect(gateError?.message).toMatch(/^Validation rule 'partner_gate' could not be evaluated \(reads more than one relationship hop\)/);
      expect(messagesOf(refused)).toContain(SIBLING);
      // Neither branch ran.
      expect(messagesOf(refused).join('\n')).not.toContain('GATE-');
      // The sibling admits on its own: only the gate refuses.
      expect(verdict(schema, deal(10), PARTNER)?.fields.map((f) => f.constraint?.rule)).toEqual(['partner_gate']);
    });

    it('a field the related object does not declare is refused, naming only that field; a sibling through the same reference keeps its verdict', () => {
      const schema = schemaOf(gate("record.account.region == 'north'"), opportunity.validations[0]);
      // The engine reads the declared rest and lists the undeclared column.
      const related = { account: { ...row({ id: 'acc_1', type: 'partner' }), undeclaredFields: ['region'] } };
      const refused = verdict(schema, deal(50000), related);
      expect(refused?.code).toBe('VALIDATION_FAILED');
      const gateError = refused?.fields.find((f) => f.constraint?.rule === 'partner_gate');
      expect(gateError).toMatchObject({ field: '_record', code: 'rule_violation', constraint: { rule: 'partner_gate', reason: 'unevaluable' } });
      expect(gateError?.message).toContain("'crm_account' declares no 'region'");
      // The sibling reading `type` through the same reference refuses with its own message…
      expect(messagesOf(refused)).toContain('Partner accounts are capped at 10000.');
      // …and admits what it admits alone.
      const direct = { account: { ...row({ id: 'acc_1', type: 'direct' }), undeclaredFields: ['region'] } };
      expect(verdict(schema, deal(50000), direct)?.fields.map((f) => f.constraint?.rule)).toEqual(['partner_gate']);
    });

    it('an empty reference is refused naming the guard, not as a fault in this object\'s columns', () => {
      const refused = verdict(schemaOf(gate("record.account.type == 'partner'")), { name: 'A', amount: 50, account: null },
        { account: unavailable('no-reference') });
      expect(refused?.fields).toEqual([expect.objectContaining({ field: '_record', code: 'rule_violation', constraint: expect.objectContaining({ rule: 'partner_gate', reason: 'unevaluable' }) })]);
      expect(refused?.fields[0]?.message).toContain('`conditional` rule whose `when` is `record.account != null`');
      expect(refused?.fields[0]?.message).not.toContain('which this object does not declare');
    });

    it('a delete\'s reference cleanup is named, as it is for a `condition`', () => {
      const refused = (() => {
        try {
          evaluateValidationRules(
            { fields: { amount: { type: 'number' }, account: { type: 'lookup', reference: 'crm_account' } },
              validations: [gate("record.account.status == 'closed'")] } as any,
            { amount: 50, account: null }, 'update',
            { previous: { id: 'deal_1', amount: 50, account: null }, related: referentialClearBinding({
              object: 'crm_account', id: 'acc_1', referencingObject: 'crm_deal', field: 'account',
            }) },
          );
          return null;
        } catch (e) {
          return e as ValidationError;
        }
      })();
      expect(refused).toBeInstanceOf(ValidationError);
      expect(refused?.message).toContain('Cannot delete crm_account (acc_1): the delete clears `account`');
      expect(refused?.message).toContain("validation rule 'partner_gate' on crm_deal could not be evaluated");
    });
  });
});
