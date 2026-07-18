// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  evaluateValidationRules,
  needsPriorRecord,
  legalNextStates,
  stripReadonlyWhenFields,
  stripReadonlyWhenFieldsMulti,
  hasReadonlyWhenInPayload,
  stripReadonlyFields,
} from './rule-validator.js';
import { ValidationError } from './record-validator.js';

// B2 — field-level conditional rules (CEL over `record`).
const invoiceFields = {
  fields: {
    status: { type: 'select' },
    // amount is required once the invoice is sent, and locked once it's paid.
    amount: {
      type: 'currency',
      requiredWhen: "record.status == 'sent'",
      readonlyWhen: "record.status == 'paid'",
    },
  },
};

describe('field requiredWhen enforcement (B2)', () => {
  it('rejects a missing required-when field (insert, predicate TRUE)', () => {
    expect(() => evaluateValidationRules(invoiceFields, { status: 'sent' }, 'insert')).toThrow(ValidationError);
  });
  it('passes when the required-when field has a value', () => {
    expect(() => evaluateValidationRules(invoiceFields, { status: 'sent', amount: 10 }, 'insert')).not.toThrow();
  });
  it('passes when the predicate is FALSE', () => {
    expect(() => evaluateValidationRules(invoiceFields, { status: 'draft' }, 'insert')).not.toThrow();
  });
  it('evaluates over the merged record on update (prior status=sent, amount absent → required)', () => {
    expect(() => evaluateValidationRules(invoiceFields, { note: 'x' } as any, 'update', { previous: { status: 'sent' } })).toThrow(ValidationError);
  });
  it('honors the conditionalRequired alias', () => {
    const f = { fields: { amount: { type: 'currency', conditionalRequired: "record.status == 'sent'" } } };
    expect(() => evaluateValidationRules(f, { status: 'sent' }, 'insert')).toThrow(ValidationError);
  });
});

describe('stripReadonlyWhenFields (B2)', () => {
  it('drops a field locked by a TRUE readonlyWhen (keeps the persisted value)', () => {
    const out = stripReadonlyWhenFields(invoiceFields, { amount: 999 }, { status: 'paid', amount: 100 });
    expect(out).toEqual({});
  });
  it('keeps the field when readonlyWhen is FALSE', () => {
    const out = stripReadonlyWhenFields(invoiceFields, { amount: 999 }, { status: 'draft', amount: 100 });
    expect(out).toEqual({ amount: 999 });
  });
  it('returns the same object when no readonlyWhen fields are touched', () => {
    const d = { x: 1 };
    expect(stripReadonlyWhenFields({ fields: { x: { type: 'number' } } }, d, null)).toBe(d);
  });
});

// #3042 — `readonlyWhen` on the BULK (updateMany) path. One payload is applied
// to every matched row, so the strip evaluates the predicate against EACH
// matched row's prior state and drops a field locked in ≥1 of them.
describe('hasReadonlyWhenInPayload (#3042 gate)', () => {
  it('is TRUE when the payload writes a readonlyWhen field', () => {
    expect(hasReadonlyWhenInPayload(invoiceFields, { amount: 999 })).toBe(true);
  });
  it('is FALSE when the payload touches no readonlyWhen field', () => {
    expect(hasReadonlyWhenInPayload(invoiceFields, { status: 'draft' })).toBe(false);
  });
  it('is FALSE for an object with no readonlyWhen fields at all', () => {
    expect(hasReadonlyWhenInPayload({ fields: { x: { type: 'number' } } }, { x: 1 })).toBe(false);
  });
});

describe('stripReadonlyWhenFieldsMulti (#3042)', () => {
  it('drops the field when it is locked in EVERY matched row', () => {
    const out = stripReadonlyWhenFieldsMulti(invoiceFields, { amount: 999 }, [
      { status: 'paid', amount: 100 },
      { status: 'paid', amount: 200 },
    ]);
    expect(out).toEqual({});
  });

  it('drops the field when it is locked in AT LEAST ONE matched row (fail-safe for the batch)', () => {
    // One draft (unlocked) + one paid (locked). A single bulk payload cannot
    // write to the draft and skip the paid row, so the locked field is dropped
    // for the whole batch.
    const out = stripReadonlyWhenFieldsMulti(invoiceFields, { amount: 999 }, [
      { status: 'draft', amount: 100 },
      { status: 'paid', amount: 200 },
    ]);
    expect(out).toEqual({});
  });

  it('KEEPS the field when NO matched row locks it (legitimate bulk edit unaffected)', () => {
    const out = stripReadonlyWhenFieldsMulti(invoiceFields, { amount: 999 }, [
      { status: 'draft', amount: 100 },
      { status: 'sent', amount: 200 },
    ]);
    expect(out).toEqual({ amount: 999 });
  });

  it('keeps the field when the match set is empty (0 rows updated anyway)', () => {
    const d = { amount: 999 };
    expect(stripReadonlyWhenFieldsMulti(invoiceFields, d, [])).toBe(d);
  });

  it('returns the same object when no readonlyWhen field is in the payload', () => {
    const d = { status: 'draft' };
    expect(stripReadonlyWhenFieldsMulti(invoiceFields, d, [{ status: 'paid' }])).toBe(d);
  });
});

// #2948 — static `readonly:true` write enforcement (caller-supplied only).
const stampedFields = {
  fields: {
    title: { type: 'text' },
    created_by: { type: 'lookup', readonly: true },
    updated_by: { type: 'lookup', readonly: true },
  },
};

describe('stripReadonlyFields (#2948)', () => {
  it('drops a caller-supplied write to a static readonly field', () => {
    const supplied = new Set(['title', 'created_by']);
    const out = stripReadonlyFields(stampedFields, { title: 'x', created_by: 'attacker' }, supplied);
    expect(out).toEqual({ title: 'x' });
  });

  it('KEEPS a readonly field the caller did NOT supply (server stamp survives)', () => {
    // `updated_by` was written into `data` by the audit-stamp hook, not the
    // caller — it must not be stripped.
    const supplied = new Set(['title']);
    const out = stripReadonlyFields(stampedFields, { title: 'x', updated_by: 'u1' }, supplied);
    expect(out).toEqual({ title: 'x', updated_by: 'u1' });
  });

  it('returns the SAME object when nothing is stripped', () => {
    const d = { title: 'x' };
    expect(stripReadonlyFields(stampedFields, d, new Set(['title']))).toBe(d);
  });

  it('drops a caller-forged readonly field even when it also carries a server stamp key', () => {
    const supplied = new Set(['title', 'created_by']);
    const out = stripReadonlyFields(
      stampedFields,
      { title: 'x', created_by: 'attacker', updated_by: 'u1' },
      supplied,
    );
    expect(out).toEqual({ title: 'x', updated_by: 'u1' });
  });
});

describe('needsPriorRecord — field conditional rules (B2)', () => {
  it('is true when a field declares requiredWhen / readonlyWhen', () => {
    expect(needsPriorRecord(invoiceFields as any)).toBe(true);
  });
});

// Mirrors the showcase Account lifecycle: a re-entrant FSM where a churned
// account can be reactivated but cannot jump straight back to prospect.
const accountSchema = {
  validations: [
    {
      type: 'state_machine' as const,
      name: 'account_lifecycle',
      field: 'status',
      message: 'Invalid account lifecycle transition.',
      transitions: {
        prospect: ['active', 'churned'],
        active: ['churned'],
        churned: ['active'],
      },
    },
  ],
};

describe('state_machine enforcement', () => {
  it('allows a declared transition (churned → active)', () => {
    expect(() =>
      evaluateValidationRules(accountSchema, { status: 'active' }, 'update', {
        previous: { status: 'churned' },
      }),
    ).not.toThrow();
  });

  it('rejects an undeclared transition (active → prospect)', () => {
    expect(() =>
      evaluateValidationRules(accountSchema, { status: 'prospect' }, 'update', {
        previous: { status: 'active' },
      }),
    ).toThrow(ValidationError);
  });

  it('surfaces the rule message and an invalid_transition code', () => {
    try {
      evaluateValidationRules(accountSchema, { status: 'prospect' }, 'update', {
        previous: { status: 'churned' },
      });
      throw new Error('expected throw');
    } catch (e) {
      const err = e as ValidationError;
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.fields[0].code).toBe('invalid_transition');
      expect(err.fields[0].field).toBe('status');
      expect(err.fields[0].message).toBe('Invalid account lifecycle transition.');
    }
  });

  it('is a no-op when the state field is unchanged', () => {
    expect(() =>
      evaluateValidationRules(accountSchema, { status: 'active', name: 'X' }, 'update', {
        previous: { status: 'active' },
      }),
    ).not.toThrow();
  });

  it('is a no-op when the PATCH does not touch the state field', () => {
    expect(() =>
      evaluateValidationRules(accountSchema, { name: 'renamed' }, 'update', {
        previous: { status: 'active' },
      }),
    ).not.toThrow();
  });

  it('does not enforce transitions on insert (no prior state)', () => {
    expect(() =>
      evaluateValidationRules(accountSchema, { status: 'churned' }, 'insert'),
    ).not.toThrow();
  });

  it('is lenient when the prior state is not described by the FSM', () => {
    expect(() =>
      evaluateValidationRules(accountSchema, { status: 'active' }, 'update', {
        previous: { status: 'legacy_unknown' },
      }),
    ).not.toThrow();
  });
});

// #3165 — the FSM entry point: `initialStates` constrains which state a record
// may be CREATED in (a `select` field alone would permit any declared option).
describe('state_machine initialStates enforcement on INSERT (#3165)', () => {
  const approvalSchema = {
    validations: [
      {
        type: 'state_machine' as const,
        name: 'approval_flow',
        field: 'approval_status',
        message: 'A request must start as draft.',
        initialStates: ['draft'],
        transitions: {
          draft: ['pending'],
          pending: ['approved', 'rejected'],
        },
      },
    ],
  };

  it('allows an insert whose state is a declared initial state', () => {
    expect(() =>
      evaluateValidationRules(approvalSchema, { approval_status: 'draft' }, 'insert'),
    ).not.toThrow();
  });

  it('rejects an insert that is born mid-flow (approval_status: approved)', () => {
    try {
      evaluateValidationRules(approvalSchema, { approval_status: 'approved' }, 'insert');
      throw new Error('expected throw');
    } catch (e) {
      const err = e as ValidationError;
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.fields[0].code).toBe('invalid_initial_state');
      expect(err.fields[0].field).toBe('approval_status');
      expect(err.fields[0].message).toBe('A request must start as draft.');
    }
  });

  it('is a no-op on insert when the field carries no value (required-validation owns presence)', () => {
    expect(() =>
      evaluateValidationRules(approvalSchema, { name: 'x' }, 'insert'),
    ).not.toThrow();
    expect(() =>
      evaluateValidationRules(approvalSchema, { approval_status: null }, 'insert'),
    ).not.toThrow();
  });

  it('does not affect UPDATE transitions (initialStates is insert-only)', () => {
    // draft → pending is a declared transition; initialStates must not interfere.
    expect(() =>
      evaluateValidationRules(approvalSchema, { approval_status: 'pending' }, 'update', {
        previous: { approval_status: 'draft' },
      }),
    ).not.toThrow();
  });

  it('legacy no-op: a state_machine WITHOUT initialStates still allows any insert value', () => {
    expect(() =>
      evaluateValidationRules(accountSchema, { status: 'churned' }, 'insert'),
    ).not.toThrow();
  });
});

describe('execution control', () => {
  it('skips inactive rules', () => {
    const schema = {
      validations: [{ ...accountSchema.validations[0], active: false }],
    };
    expect(() =>
      evaluateValidationRules(schema, { status: 'prospect' }, 'update', {
        previous: { status: 'active' },
      }),
    ).not.toThrow();
  });

  it('skips rules whose events do not include the write context', () => {
    const schema = {
      validations: [{ ...accountSchema.validations[0], events: ['insert' as const] }],
    };
    expect(() =>
      evaluateValidationRules(schema, { status: 'prospect' }, 'update', {
        previous: { status: 'active' },
      }),
    ).not.toThrow();
  });

  it('treats warning severity as non-blocking', () => {
    const schema = {
      validations: [{ ...accountSchema.validations[0], severity: 'warning' as const }],
    };
    expect(() =>
      evaluateValidationRules(schema, { status: 'prospect' }, 'update', {
        previous: { status: 'active' },
      }),
    ).not.toThrow();
  });
});

describe('script / cross_field predicates', () => {
  const projectSchema = {
    validations: [
      {
        type: 'cross_field' as const,
        name: 'end_after_start',
        fields: ['start_date', 'end_date'],
        condition: { dialect: 'cel', source: 'has(record.start_date) && has(record.end_date) && record.end_date < record.start_date' },
        message: 'End must be on or after start.',
      },
    ],
  };

  it('rejects when the failure predicate is true (end before start)', () => {
    expect(() =>
      evaluateValidationRules(
        projectSchema,
        { end_date: '2026-01-01' },
        'update',
        { previous: { start_date: '2026-06-01', end_date: '2026-12-01' } },
      ),
    ).toThrow(ValidationError);
  });

  it('allows when the predicate is false (merged record honours unchanged fields)', () => {
    expect(() =>
      evaluateValidationRules(
        projectSchema,
        { end_date: '2026-12-01' },
        'update',
        { previous: { start_date: '2026-06-01', end_date: '2026-07-01' } },
      ),
    ).not.toThrow();
  });

  it('fails open (no throw) on an un-evaluable predicate', () => {
    const schema = {
      validations: [
        {
          type: 'script' as const,
          name: 'broken',
          condition: { dialect: 'cel', source: 'this is not valid ((' },
          message: 'broken rule',
        },
      ],
    };
    expect(() =>
      evaluateValidationRules(schema, { a: 1 }, 'update', { previous: { a: 0 } }),
    ).not.toThrow();
  });
});

describe('introspection', () => {
  it('legalNextStates returns the declared targets', () => {
    expect(legalNextStates(accountSchema, 'status', 'prospect')).toEqual(['active', 'churned']);
    expect(legalNextStates(accountSchema, 'status', 'active')).toEqual(['churned']);
  });

  it('legalNextStates returns [] for a known dead-end state, null for no FSM', () => {
    const deadEnd = {
      validations: [
        { type: 'state_machine' as const, name: 'f', field: 'status', message: 'm', transitions: { done: [] } },
      ],
    };
    expect(legalNextStates(deadEnd, 'status', 'done')).toEqual([]);
    expect(legalNextStates(accountSchema, 'other_field', 'x')).toBeNull();
    expect(legalNextStates({ validations: [] }, 'status', 'x')).toBeNull();
  });

  it('needsPriorRecord detects rules that require prior state', () => {
    expect(needsPriorRecord(accountSchema)).toBe(true);
    // format only inspects the incoming value → no prior fetch needed.
    expect(needsPriorRecord({ validations: [{ type: 'format', name: 'f', message: 'm', field: 'x', format: 'email' }] })).toBe(false);
    expect(needsPriorRecord({ validations: [] })).toBe(false);
    expect(needsPriorRecord(undefined)).toBe(false);
  });

  it('needsPriorRecord recurses into conditional branches', () => {
    // conditional wrapping a cross_field → needs prior.
    const wrapsPrior = {
      validations: [
        {
          type: 'conditional' as const,
          name: 'c',
          message: 'm',
          when: { dialect: 'cel', source: 'record.type == "x"' },
          then: { type: 'cross_field', name: 'cf', message: 'm', fields: ['a'], condition: { dialect: 'cel', source: 'record.a < record.b' } },
        },
      ],
    };
    expect(needsPriorRecord(wrapsPrior)).toBe(true);

    // conditional wrapping only a format → does not need prior.
    const wrapsFormat = {
      validations: [
        {
          type: 'conditional' as const,
          name: 'c',
          message: 'm',
          when: { dialect: 'cel', source: 'record.type == "x"' },
          then: { type: 'format', name: 'f', message: 'm', field: 'email', format: 'email' },
        },
      ],
    };
    expect(needsPriorRecord(wrapsFormat)).toBe(false);
  });
});

describe('format enforcement', () => {
  const schema = (extra: Record<string, unknown>) => ({
    validations: [{ type: 'format' as const, name: 'fmt', message: 'Bad format.', ...extra }],
  });

  it('rejects an invalid named format (email) on insert', () => {
    expect(() =>
      evaluateValidationRules(schema({ field: 'email', format: 'email' }), { email: 'not-an-email' }, 'insert'),
    ).toThrow(ValidationError);
  });

  it('accepts a valid named format (email)', () => {
    expect(() =>
      evaluateValidationRules(schema({ field: 'email', format: 'email' }), { email: 'a@b.com' }, 'insert'),
    ).not.toThrow();
  });

  it('accepts multi-label domains and rejects malformed / empty-label emails', () => {
    const emailSchema = schema({ field: 'email', format: 'email' });
    const ok = (v: string) =>
      expect(() => evaluateValidationRules(emailSchema, { email: v }, 'insert')).not.toThrow();
    const bad = (v: string) =>
      expect(() => evaluateValidationRules(emailSchema, { email: v }, 'insert')).toThrow(ValidationError);

    ok('a@b.co.uk');
    ok('x.y+z@sub.domain.io');
    bad('a@b'); // no dot in domain
    bad('a@b.'); // empty trailing label
    bad('a@.com'); // empty leading label
    bad('a@b..c'); // consecutive dots -> empty label
    bad('a b@c.com'); // whitespace in local part
  });

  it('validates an email in linear time (no ReDoS on adversarial input)', () => {
    // Overlapping-quantifier email regexes backtrack polynomially on a long
    // run of domain-ish chars with no valid terminator. This must stay fast.
    const attack = `a@${'a'.repeat(50_000)}${'.'.repeat(50_000)}!`;
    const start = performance.now();
    expect(() =>
      evaluateValidationRules(schema({ field: 'email', format: 'email' }), { email: attack }, 'insert'),
    ).toThrow(ValidationError);
    expect(performance.now() - start).toBeLessThan(1_000);
  });

  it('validates url / phone / json named formats', () => {
    expect(() => evaluateValidationRules(schema({ field: 'site', format: 'url' }), { site: 'nope' }, 'insert')).toThrow(ValidationError);
    expect(() => evaluateValidationRules(schema({ field: 'site', format: 'url' }), { site: 'https://x.io' }, 'insert')).not.toThrow();
    expect(() => evaluateValidationRules(schema({ field: 'tel', format: 'phone' }), { tel: 'abc' }, 'insert')).toThrow(ValidationError);
    expect(() => evaluateValidationRules(schema({ field: 'tel', format: 'phone' }), { tel: '+1 (415) 555-2020' }, 'insert')).not.toThrow();
    expect(() => evaluateValidationRules(schema({ field: 'blob', format: 'json' }), { blob: '{bad' }, 'insert')).toThrow(ValidationError);
    expect(() => evaluateValidationRules(schema({ field: 'blob', format: 'json' }), { blob: '{"ok":1}' }, 'insert')).not.toThrow();
  });

  it('enforces a regex', () => {
    expect(() => evaluateValidationRules(schema({ field: 'zip', regex: '^[0-9]{5}$' }), { zip: '1234' }, 'insert')).toThrow(ValidationError);
    expect(() => evaluateValidationRules(schema({ field: 'zip', regex: '^[0-9]{5}$' }), { zip: '94107' }, 'insert')).not.toThrow();
  });

  it('skips when the field is absent or empty (requiredness is not its job)', () => {
    expect(() => evaluateValidationRules(schema({ field: 'email', format: 'email' }), { other: 1 }, 'insert')).not.toThrow();
    expect(() => evaluateValidationRules(schema({ field: 'email', format: 'email' }), { email: '' }, 'insert')).not.toThrow();
  });

  it('skips on update when the PATCH does not touch the field', () => {
    expect(() =>
      evaluateValidationRules(schema({ field: 'email', format: 'email' }), { name: 'x' }, 'update', { previous: { email: 'still-bad' } }),
    ).not.toThrow();
  });

  it('fails open on an invalid regex', () => {
    expect(() => evaluateValidationRules(schema({ field: 'x', regex: '((' }), { x: 'anything' }, 'insert')).not.toThrow();
  });

  it('surfaces an invalid_format code', () => {
    try {
      evaluateValidationRules(schema({ field: 'email', format: 'email' }), { email: 'bad' }, 'insert');
      throw new Error('expected throw');
    } catch (e) {
      const err = e as ValidationError;
      expect(err.fields[0].code).toBe('invalid_format');
      expect(err.fields[0].field).toBe('email');
    }
  });
});

describe('json_schema enforcement', () => {
  const schema = {
    validations: [
      {
        type: 'json_schema' as const,
        name: 'cfg',
        message: 'Config does not match schema.',
        field: 'config',
        schema: { type: 'object', properties: { port: { type: 'number' } }, required: ['port'], additionalProperties: false },
      },
    ],
  };

  it('accepts a conforming object value', () => {
    expect(() => evaluateValidationRules(schema, { config: { port: 8080 } }, 'insert')).not.toThrow();
  });

  it('rejects a non-conforming object value', () => {
    expect(() => evaluateValidationRules(schema, { config: { port: 'nope' } }, 'insert')).toThrow(ValidationError);
    expect(() => evaluateValidationRules(schema, { config: {} }, 'insert')).toThrow(ValidationError);
  });

  it('parses and validates a JSON string value', () => {
    expect(() => evaluateValidationRules(schema, { config: '{"port":80}' }, 'insert')).not.toThrow();
    expect(() => evaluateValidationRules(schema, { config: '{"port":"x"}' }, 'insert')).toThrow(ValidationError);
  });

  it('treats an unparseable JSON string as invalid_json', () => {
    try {
      evaluateValidationRules(schema, { config: '{bad' }, 'insert');
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ValidationError).fields[0].code).toBe('invalid_json');
    }
  });

  it('skips when the field is absent or null', () => {
    expect(() => evaluateValidationRules(schema, { other: 1 }, 'insert')).not.toThrow();
    expect(() => evaluateValidationRules(schema, { config: null }, 'insert')).not.toThrow();
  });

  it('fails open on an uncompilable schema', () => {
    const broken = {
      validations: [{ type: 'json_schema' as const, name: 'b', message: 'm', field: 'c', schema: { type: 'not-a-real-type' } }],
    };
    expect(() => evaluateValidationRules(broken, { c: { any: 1 } }, 'insert')).not.toThrow();
  });
});

describe('conditional enforcement', () => {
  const schema = {
    validations: [
      {
        type: 'conditional' as const,
        name: 'enterprise_requires_approval',
        message: 'Conditional failed.',
        when: { dialect: 'cel', source: 'record.account_type == "enterprise"' },
        then: {
          type: 'script',
          name: 'require_approval',
          message: 'Enterprise accounts require an approver.',
          condition: { dialect: 'cel', source: 'record.approver == null' },
        },
        otherwise: {
          type: 'script',
          name: 'require_payment',
          message: 'A payment method is required.',
          condition: { dialect: 'cel', source: 'record.payment == null' },
        },
      },
    ],
  };

  it('runs the then-branch when when is true (and it fails)', () => {
    try {
      evaluateValidationRules(schema, { account_type: 'enterprise', approver: null }, 'insert');
      throw new Error('expected throw');
    } catch (e) {
      const err = e as ValidationError;
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.fields[0].message).toBe('Enterprise accounts require an approver.');
    }
  });

  it('passes the then-branch when satisfied', () => {
    expect(() =>
      evaluateValidationRules(schema, { account_type: 'enterprise', approver: 'u1' }, 'insert'),
    ).not.toThrow();
  });

  it('runs the otherwise-branch when when is false', () => {
    expect(() =>
      evaluateValidationRules(schema, { account_type: 'smb', payment: null }, 'insert'),
    ).toThrow(ValidationError);
    expect(() =>
      evaluateValidationRules(schema, { account_type: 'smb', payment: 'card' }, 'insert'),
    ).not.toThrow();
  });

  it('is a no-op when when is false and there is no otherwise', () => {
    const noElse = { validations: [{ ...schema.validations[0], otherwise: undefined }] };
    expect(() => evaluateValidationRules(noElse, { account_type: 'smb' }, 'insert')).not.toThrow();
  });

  it('the outer conditional severity governs blocking (warning → non-blocking)', () => {
    const advisory = { validations: [{ ...schema.validations[0], severity: 'warning' as const }] };
    expect(() =>
      evaluateValidationRules(advisory, { account_type: 'enterprise', approver: null }, 'insert'),
    ).not.toThrow();
  });

  it('fails open on an un-evaluable when predicate', () => {
    const broken = { validations: [{ ...schema.validations[0], when: { dialect: 'cel', source: 'this is (( not valid' } }] };
    expect(() => evaluateValidationRules(broken, { account_type: 'enterprise', approver: null }, 'insert')).not.toThrow();
  });
});
