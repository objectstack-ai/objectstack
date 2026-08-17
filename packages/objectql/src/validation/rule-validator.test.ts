// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  evaluateValidationRules,
  needsPriorRecord,
  legalNextStates,
  stripReadonlyWhenFields,
  stripReadonlyWhenFieldsMulti,
  hasReadonlyWhenInPayload,
  hasParentScopedReadonlyWhenInPayload,
  hasParentScopedRequiredWhen,
  stripReadonlyFields,
  stripRuntimeOwnedFields,
  isRuntimeOwnedField,
  runtimeOwnedStripWarning,
  readonlyStripWarning,
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
  // ── ADR-0113 non-regression: reject iff the MERGED state violates AND the
  // PRE state complied. A write may not CREATE a violation; it need not FIX a
  // pre-existing one. (The pre-ADR behavior — throwing on ANY write while a
  // legacy row violates — was the lockout #3929 documented: a row from before
  // the rule tightened could not be edited at all without backfilling.)

  it('update that CREATES the violation is rejected — condition flipped true without the field', () => {
    // pre: draft, no amount → complied. Write flips status to sent, no amount → violates.
    expect(() => evaluateValidationRules(invoiceFields, { status: 'sent' }, 'update', { previous: { status: 'draft' } })).toThrow(ValidationError);
  });
  it('update that nulls the field out under a TRUE condition is rejected', () => {
    // pre: sent + amount → complied. Write clears amount → violates.
    expect(() => evaluateValidationRules(invoiceFields, { amount: null } as any, 'update', { previous: { status: 'sent', amount: 10 } })).toThrow(ValidationError);
  });
  it('legacy rows rest: a pre-existing violation does not block an unrelated write', () => {
    // pre: sent, amount ALREADY missing → pre violated (row predates the rule).
    // The write touches only `note` — leaves the violation in place, creates nothing.
    expect(() => evaluateValidationRules(invoiceFields, { note: 'x' } as any, 'update', { previous: { status: 'sent' } })).not.toThrow();
  });
  it('a write that FIXES the legacy violation passes', () => {
    expect(() => evaluateValidationRules(invoiceFields, { amount: 25 }, 'update', { previous: { status: 'sent' } })).not.toThrow();
  });
  // #3903 — the `conditionalRequired` alias read is RETIRED. Stored pre-17
  // rows are lowered to `requiredWhen` by the ADR-0087 chain at rehydration
  // (`applyConversionsToStoredItem`), so this validator only ever sees the
  // canonical key; raw legacy input no longer gets a consumer-side fallback.
  it('does NOT read the retired conditionalRequired alias (PD #12 — no dialect fallback)', () => {
    const f = { fields: { amount: { type: 'currency', conditionalRequired: "record.status == 'sent'" } } } as any;
    expect(() => evaluateValidationRules(f, { status: 'sent' }, 'insert')).not.toThrow();
  });
  it('enforces the rule once the stored-conversion chain has lowered the alias', async () => {
    const { applyConversionsToStoredItem } = await import('@objectstack/spec');
    const storedRow = {
      name: 'invoice',
      fields: { amount: { type: 'currency', conditionalRequired: "record.status == 'sent'" } },
    };
    const converted = applyConversionsToStoredItem('object', storedRow) as any;
    expect(converted.fields.amount.requiredWhen).toBe("record.status == 'sent'");
    expect(() => evaluateValidationRules(converted, { status: 'sent' }, 'insert')).toThrow(ValidationError);
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

// #4889 — PARENT-scoped `readonlyWhen`. The showcase's invoice-line shape:
// `readonlyWhen: parent.status == 'paid'` on a detail whose master is the
// invoice header. Until #4889 the server bound only `record`/`previous`, so
// every one of these predicates faulted and the fail-open branch wrote the
// field anyway — the client grid was the only thing enforcing the lock.
const invoiceLineFields = {
  fields: {
    invoice: { type: 'master_detail', reference: 'showcase_invoice', required: true },
    // Row-scoped — unaffected by the parent binding, and here to prove it.
    description: { type: 'text', requiredWhen: 'record.quantity >= 100' },
    quantity: { type: 'number', readonlyWhen: "parent.status == 'paid'" },
    unit_price: { type: 'currency', readonlyWhen: "parent.status == 'paid'" },
  },
};

describe('parent-scoped readonlyWhen (#4889)', () => {
  const line = { id: 'l1', invoice: 'inv1', quantity: 6, unit_price: 49.99 };

  it('drops the field when the master-detail header locks it', () => {
    const out = stripReadonlyWhenFields(
      invoiceLineFields,
      { quantity: 9999, unit_price: 0.01 },
      line,
      undefined,
      { id: 'inv1', status: 'paid' },
    );
    expect(out).toEqual({});
  });

  it('KEEPS the field when the header is not locked', () => {
    const out = stripReadonlyWhenFields(
      invoiceLineFields,
      { quantity: 9999 },
      line,
      undefined,
      { id: 'inv1', status: 'draft' },
    );
    expect(out).toEqual({ quantity: 9999 });
  });

  it('treats the field as LOCKED when `parent` could not be bound (fail-CLOSED)', () => {
    // The pre-#4889 behaviour, and the bug: no `parent` binding ⇒ the predicate
    // faults ⇒ the write used to go through. It must now be dropped.
    const warnings: string[] = [];
    const out = stripReadonlyWhenFields(invoiceLineFields, { quantity: 9999 }, line, {
      warn: (m: string) => warnings.push(m),
    } as never);
    expect(out).toEqual({});
    expect(warnings.some((w) => w.includes("reads 'parent'") && w.includes('LOCKED'))).toBe(true);
  });

  it('keeps fail-OPEN for a predicate that is simply broken (undeclared key)', () => {
    // Not an unbound root — `record` IS bound, the key under it is not declared.
    // #4649 deliberately left this fail-open for field predicates; #4889 must
    // not have widened itself into that case.
    const warnings: string[] = [];
    const out = stripReadonlyWhenFields(
      { fields: { amount: { type: 'currency', readonlyWhen: "record.no_such_field == 'paid'" } } },
      { amount: 999 },
      { amount: 1 },
      { warn: (m: string) => warnings.push(m) } as never,
    );
    expect(out).toEqual({ amount: 999 });
    expect(warnings.some((w) => w.includes('change allowed through'))).toBe(true);
  });

  it('leaves a RECORD-scoped lock on the same object working unchanged', () => {
    // The contrast the issue drew: `record.status == 'paid'` was correct all
    // along, and stays correct with a parent bound alongside it.
    const headerFields = { fields: { status: { type: 'select' }, tax_rate: { type: 'number', readonlyWhen: "record.status == 'paid'" } } };
    expect(stripReadonlyWhenFields(headerFields, { tax_rate: 99 }, { status: 'paid', tax_rate: 8 })).toEqual({});
    expect(stripReadonlyWhenFields(headerFields, { tax_rate: 99 }, { status: 'draft', tax_rate: 8 })).toEqual({ tax_rate: 99 });
  });

  it('binds a DIFFERENT parent per matched row on the bulk path', () => {
    const rows = [
      { id: 'l1', invoice: 'paid_inv', quantity: 1 },
      { id: 'l2', invoice: 'draft_inv', quantity: 2 },
    ];
    const headers: Record<string, Record<string, unknown>> = {
      paid_inv: { id: 'paid_inv', status: 'paid' },
      draft_inv: { id: 'draft_inv', status: 'draft' },
    };
    // Locked in ≥1 matched row ⇒ dropped for the whole batch (#3042 rule).
    expect(
      stripReadonlyWhenFieldsMulti(invoiceLineFields, { quantity: 9999 }, rows, undefined,
        (row) => headers[String(row?.invoice)] ?? null),
    ).toEqual({});
    // No matched row locked ⇒ a legitimate bulk edit still lands.
    expect(
      stripReadonlyWhenFieldsMulti(invoiceLineFields, { quantity: 9999 }, [rows[1]!], undefined,
        (row) => headers[String(row?.invoice)] ?? null),
    ).toEqual({ quantity: 9999 });
  });

  it('is fail-CLOSED on the bulk path too when a row has no resolvable parent', () => {
    const out = stripReadonlyWhenFieldsMulti(
      invoiceLineFields,
      { quantity: 9999 },
      [{ id: 'l1', invoice: 'gone', quantity: 1 }],
      undefined,
      () => null,
    );
    expect(out).toEqual({});
  });
});

describe('hasParentScopedReadonlyWhenInPayload (#4889 gate)', () => {
  it('is TRUE when the payload writes a parent-scoped readonlyWhen field', () => {
    expect(hasParentScopedReadonlyWhenInPayload(invoiceLineFields, { quantity: 1 })).toBe(true);
  });
  it('is FALSE when the payload only writes fields with no parent-scoped lock', () => {
    expect(hasParentScopedReadonlyWhenInPayload(invoiceLineFields, { description: 'x' })).toBe(false);
  });
  it('is FALSE for a record-scoped readonlyWhen (no needless header read)', () => {
    expect(hasParentScopedReadonlyWhenInPayload(invoiceFields, { amount: 1 })).toBe(false);
  });
  it('does not mistake a field NAMED parent_id, or a string literal, for the binding', () => {
    const decoys = {
      fields: {
        a: { type: 'text', readonlyWhen: "record.parent_id != ''" },
        b: { type: 'text', readonlyWhen: "record.kind == 'parent'" },
      },
    };
    expect(hasParentScopedReadonlyWhenInPayload(decoys, { a: 'x', b: 'y' })).toBe(false);
  });
});

// #4977 — PARENT-scoped `requiredWhen`, the mirror of the block above on the
// same field. `readonlyWhen` failing open WROTE a field that should have been
// frozen; `requiredWhen` failing open ACCEPTS a record that should have been
// rejected. Ruling (2026-08-06): bind the scope, keep fail-OPEN, gate the
// unbindable declaration at build time (option B — 422 — was NOT taken).
const sentLineFields = {
  fields: {
    invoice: { type: 'master_detail', reference: 'showcase_invoice', required: true },
    // THE SUBJECT.
    description: { type: 'text', requiredWhen: "parent.status == 'sent'" },
    // Row-scoped — unaffected by the parent binding, and here to prove it.
    note: { type: 'text', requiredWhen: 'record.quantity >= 100' },
    quantity: { type: 'number' },
  },
};

/** Collect the ValidationError field codes, or `null` when the write is accepted. */
function violations(
  schema: unknown,
  data: Record<string, unknown>,
  mode: 'insert' | 'update',
  opts: Record<string, unknown> = {},
): string[] | null {
  try {
    evaluateValidationRules(schema as never, data, mode, opts as never);
    return null;
  } catch (err) {
    if (err instanceof ValidationError) return err.fields.map((f) => f.field);
    throw err;
  }
}

describe('parent-scoped requiredWhen (#4977)', () => {
  it('REQUIRES the field when the master-detail header says so', () => {
    expect(violations(sentLineFields, { invoice: 'inv1', quantity: 1 }, 'insert', {
      parent: { id: 'inv1', status: 'sent' },
    })).toEqual(['description']);
  });

  it('does NOT require it when the header does not match', () => {
    expect(violations(sentLineFields, { invoice: 'inv1', quantity: 1 }, 'insert', {
      parent: { id: 'inv1', status: 'draft' },
    })).toBeNull();
  });

  it('accepts the write once the field is supplied', () => {
    expect(violations(sentLineFields, { invoice: 'inv1', description: 'seat' }, 'insert', {
      parent: { id: 'inv1', status: 'sent' },
    })).toBeNull();
  });

  it('is FAIL-OPEN when `parent` could not be bound — the #4889 asymmetry', () => {
    // The twin above resolves an unbound root to LOCKED. Here the ruling
    // deliberately kept the historical fail-open exit: the requirement is
    // skipped and the write is ACCEPTED. Do not "restore symmetry" — that is
    // option B, reserved for the next review of ADR-0058 D5.
    const warnings: string[] = [];
    expect(violations(sentLineFields, { invoice: 'inv1', quantity: 1 }, 'insert', {
      logger: { warn: (m: string) => warnings.push(m) },
    })).toBeNull();
    expect(warnings.some((w) => w.includes("reads 'parent'") && w.includes('NOT enforced'))).toBe(true);
  });

  it('keeps the plain fail-open message for a predicate that is simply broken', () => {
    // Not an unbound root — `record` IS bound, the key under it is undeclared.
    const warnings: string[] = [];
    expect(violations(
      { fields: { amount: { type: 'currency', requiredWhen: "record.no_such_field == 'x'" } } },
      { amount: 1 },
      'insert',
      { logger: { warn: (m: string) => warnings.push(m) } },
    )).toBeNull();
    expect(warnings.some((w) => w.includes('failed to evaluate — skipped'))).toBe(true);
    expect(warnings.some((w) => w.includes("reads 'parent'"))).toBe(false);
  });

  it('leaves the ROW-scoped requiredWhen on the same object working unchanged', () => {
    expect(violations(sentLineFields, { invoice: 'inv1', quantity: 500 }, 'insert', {
      parent: { id: 'inv1', status: 'draft' },
    })).toEqual(['note']);
  });

  // ── ADR-0113 non-regression, with a parent in scope ──────────────────────

  it('lets a legacy row rest: the header ALREADY required it and it was already empty', () => {
    expect(violations(sentLineFields, { quantity: 7 }, 'update', {
      previous: { id: 'l1', invoice: 'inv1', description: '', quantity: 1 },
      parent: { id: 'inv1', status: 'sent' },
    })).toBeNull();
  });

  it('rejects a write that NULLS the field while the header requires it', () => {
    expect(violations(sentLineFields, { description: '' }, 'update', {
      previous: { id: 'l1', invoice: 'inv1', description: 'seat', quantity: 1 },
      parent: { id: 'inv1', status: 'sent' },
    })).toEqual(['description']);
  });

  it('judges a REPOINT by the header the write LANDS on, not the one it leaves', () => {
    // The reason `previousParent` exists. The row complied under its draft
    // header; the write moves it under a sent one. Binding the LANDING header
    // to the pre-check too would read this as a pre-existing violation and let
    // it rest — the acceptance hole this issue exists to close, one case in.
    expect(violations(sentLineFields, { invoice: 'sent_inv' }, 'update', {
      previous: { id: 'l1', invoice: 'draft_inv', description: '', quantity: 1 },
      parent: { id: 'sent_inv', status: 'sent' },
      previousParent: { id: 'draft_inv', status: 'draft' },
    })).toEqual(['description']);
  });

  it('`previousParent` defaults to `parent` when the write does not repoint', () => {
    // No repoint ⇒ the engine does not pay a second header read, and the
    // legacy-row exemption must still apply.
    expect(violations(sentLineFields, { quantity: 7 }, 'update', {
      previous: { id: 'l1', invoice: 'inv1', description: '', quantity: 1 },
      parent: { id: 'inv1', status: 'sent' },
    })).toBeNull();
  });

  // ── blast radius: object-level rules at the SAME evaluation site ─────────

  it('does NOT bind `parent` for object-level rules — still fail-CLOSED (#4649)', () => {
    const withScriptRule = {
      fields: { ...sentLineFields.fields },
      validations: [{
        type: 'script',
        name: 'parent_in_object_rule',
        message: 'nope',
        condition: "parent.status == 'sent'",
      }],
    };
    // A parent IS supplied, and the field predicate below evaluates with it —
    // yet the object-level rule still faults on `parent` and still REJECTS.
    expect(() => evaluateValidationRules(
      withScriptRule as never,
      { invoice: 'inv1', description: 'seat' },
      'insert',
      { parent: { id: 'inv1', status: 'sent' } } as never,
    )).toThrow(/could not be evaluated/);
  });
});

describe('hasParentScopedRequiredWhen (#4977 gate)', () => {
  it('is TRUE when a field declares a parent-scoped requiredWhen', () => {
    expect(hasParentScopedRequiredWhen(sentLineFields)).toBe(true);
  });

  it('is FALSE for record-scoped requiredWhen only (no needless header read)', () => {
    expect(hasParentScopedRequiredWhen(invoiceFields)).toBe(false);
  });

  it('is FALSE for a parent-scoped READONLYWhen — that is the other gate', () => {
    expect(hasParentScopedRequiredWhen(invoiceLineFields)).toBe(false);
  });

  it('does not mistake a field NAMED parent_id, or a string literal, for the binding', () => {
    expect(hasParentScopedRequiredWhen({
      fields: {
        a: { type: 'text', requiredWhen: "record.parent_id != ''" },
        b: { type: 'text', requiredWhen: "record.kind == 'parent'" },
      },
    })).toBe(false);
  });

  it('is NOT payload-filtered, unlike its readonlyWhen twin', () => {
    // The whole failure `requiredWhen` catches is a field the payload OMITS, so
    // filtering by `name in data` would skip exactly the writes it is for.
    // (The twin takes a payload argument; this one deliberately does not.)
    expect(hasParentScopedRequiredWhen(sentLineFields)).toBe(true);
    expect(hasParentScopedReadonlyWhenInPayload(invoiceLineFields, { description: 'x' })).toBe(false);
  });
});

// #4953 — the record a `readonlyWhen` predicate sees is TOTAL over the object's
// DECLARED fields, like the two seams that were materialised in #4649/#4770.
// Before this, `stripReadonlyWhenFields` merged `{...previous, ...data}` raw, so
// a predicate reading a declared column the DRIVER did not echo back faulted —
// and a faulting `readonlyWhen` fails open, i.e. WROTE the field the author
// declared frozen. Which columns come back is a storage property no author can
// see, so the same declaration was enforced or not depending on the driver.
const sparseLockFields = {
  fields: {
    notes: { type: 'text' },
    approved_at: { type: 'datetime' },
    // "while nothing has been approved, the amount is frozen" — the `== null`
    // spelling #4649 made the supported one (and the null-guard gate prescribes).
    amount: { type: 'currency', readonlyWhen: 'record.approved_at == null' },
  },
};

/** A prior row from a driver that stores only the columns a write touched. */
const sparsePrior = () => ({ id: 'r1', amount: 100 });
/** The same row from a driver that returns every declared column. */
const totalPrior = (approvedAt: unknown) => ({ id: 'r1', amount: 100, notes: null, approved_at: approvedAt });

describe('readonlyWhen binds a TOTAL record (#4953)', () => {
  it('evaluates `record.<declared> == null` on a SPARSE prior instead of faulting through', () => {
    // THE bug. Pre-#4953: `No such key: approved_at` ⇒ fail-open ⇒ amount written.
    const warnings: string[] = [];
    const out = stripReadonlyWhenFields(sparseLockFields, { amount: 999 }, sparsePrior(), {
      warn: (m: string) => warnings.push(m),
    } as never);
    expect(out).toEqual({});
    expect(warnings.some((w) => w.includes('failed to evaluate'))).toBe(false);
    expect(warnings.some((w) => w.includes('is read-only (readonlyWhen)'))).toBe(true);
  });

  it('still KEEPS the change when the materialised value makes the predicate FALSE', () => {
    // Materialising is not "lock everything": the row HAS an approval date, so
    // the lock is off and the legitimate edit lands.
    expect(
      stripReadonlyWhenFields(sparseLockFields, { amount: 999 }, { id: 'r1', amount: 100, approved_at: '2026-01-01' }),
    ).toEqual({ amount: 999 });
  });

  it('reads the same verdict on a sparse prior as on a total one (the point)', () => {
    // One declaration, two drivers, one answer. This equality is the guarantee;
    // before #4953 the left side kept the change and the right side stripped it.
    const sparse = stripReadonlyWhenFields(sparseLockFields, { amount: 999 }, sparsePrior());
    const total = stripReadonlyWhenFields(sparseLockFields, { amount: 999 }, totalPrior(null));
    expect(sparse).toEqual(total);
    expect(sparse).toEqual({});
  });

  it('materialises the `previous` root too, not just `record`', () => {
    const schema = { fields: { ...sparseLockFields.fields, amount: { type: 'currency', readonlyWhen: 'previous.approved_at == null' } } };
    expect(stripReadonlyWhenFields(schema, { amount: 999 }, sparsePrior())).toEqual({});
    expect(stripReadonlyWhenFields(schema, { amount: 999 }, { id: 'r1', amount: 100, approved_at: '2026-01-01' })).toEqual({ amount: 999 });
  });

  it('applies on the BULK path identically — one payload, N sparse rows', () => {
    // A bulk write must not judge the same predicate by a different record
    // shape than a single-id write does.
    expect(stripReadonlyWhenFieldsMulti(sparseLockFields, { amount: 999 }, [sparsePrior()])).toEqual({});
    // ≥1 locked row still drops it for the batch; no locked row still writes.
    expect(stripReadonlyWhenFieldsMulti(sparseLockFields, { amount: 999 }, [
      { id: 'r1', amount: 1, approved_at: '2026-01-01' },
      sparsePrior(),
    ])).toEqual({});
    expect(stripReadonlyWhenFieldsMulti(sparseLockFields, { amount: 999 }, [
      { id: 'r1', amount: 1, approved_at: '2026-01-01' },
      { id: 'r2', amount: 2, approved_at: '2026-02-02' },
    ])).toEqual({ amount: 999 });
  });

  it('does NOT materialise when the prior row is not in hand (no fabrication)', () => {
    // `declared-fields.ts`'s standing rule: without the persisted state,
    // defaulting a declared field to null would FABRICATE a value that
    // contradicts the stored row. So this case keeps the historical fault →
    // fail-open exit, and the engine avoids it by fetching the prior row
    // whenever the object declares a readonlyWhen field (`needsPriorRecord`).
    const warnings: string[] = [];
    const out = stripReadonlyWhenFields(sparseLockFields, { amount: 999 }, null, {
      warn: (m: string) => warnings.push(m),
    } as never);
    expect(out).toEqual({ amount: 999 });
    expect(warnings.some((w) => w.includes('failed to evaluate — change allowed through'))).toBe(true);
  });

  it('never mutates the caller\'s prior record (it is the engine\'s hookContext.previous)', () => {
    const prior = sparsePrior();
    stripReadonlyWhenFields(sparseLockFields, { amount: 999 }, prior);
    expect('approved_at' in prior).toBe(false);
    expect('notes' in prior).toBe(false);
    const rows = [sparsePrior()];
    stripReadonlyWhenFieldsMulti(sparseLockFields, { amount: 999 }, rows);
    expect('approved_at' in rows[0]!).toBe(false);
  });

  it('leaves the fail-open branch ALIVE — an ordering comparison still faults over a total record', () => {
    // `null < null` is `no such overload`, so materialising does not make every
    // predicate evaluable. This is exactly why the null-guard gate exists.
    const warnings: string[] = [];
    const out = stripReadonlyWhenFields(
      { fields: { ...sparseLockFields.fields, amount: { type: 'currency', readonlyWhen: 'record.notes < record.approved_at' } } },
      { amount: 999 },
      sparsePrior(),
      { warn: (m: string) => warnings.push(m) } as never,
    );
    expect(out).toEqual({ amount: 999 });
    expect(warnings.some((w) => w.includes('failed to evaluate — change allowed through'))).toBe(true);
  });

  it('keeps fail-OPEN for an UNDECLARED key — materialising covers declared fields only', () => {
    // The #4649 line, unmoved: a typo must stay unevaluable so it is reported,
    // not silently read as null.
    const warnings: string[] = [];
    expect(stripReadonlyWhenFields(
      { fields: { amount: { type: 'currency', readonlyWhen: 'record.stauts == null' } } },
      { amount: 999 },
      { id: 'r1', amount: 100 },
      { warn: (m: string) => warnings.push(m) } as never,
    )).toEqual({ amount: 999 });
    expect(warnings.some((w) => w.includes('failed to evaluate — change allowed through'))).toBe(true);
  });

  // ── the consequence that moves the OTHER way, pinned rather than discovered ──
  it('`has(record.<declared>)` is uniformly TRUE — so it locks even on a sparse prior', () => {
    // CEL's own rule: a materialised `null` is a PRESENT key holding null.
    // `has()` therefore guards against an UNDECLARED key, not an empty value.
    expect(stripReadonlyWhenFields(
      { fields: { ...sparseLockFields.fields, amount: { type: 'currency', readonlyWhen: 'has(record.approved_at)' } } },
      { amount: 999 },
      sparsePrior(),
    )).toEqual({});
  });

  it('`!has(record.<declared>)` is uniformly FALSE — a lock spelled that way STOPS locking', () => {
    // The one verdict this change moves toward "allowed": pre-#4953 the sparse
    // binding made `!has(...)` true and the field was stripped. It was never a
    // guarantee — on a driver returning all columns the same declaration never
    // locked anything — so the flip replaces a storage-dependent verdict with a
    // deterministic one, and the deterministic answer is FALSE. An author who
    // means "while the field is empty" writes `== null` (the spelling
    // @objectstack/lint's null-guard gate prescribes).
    expect(stripReadonlyWhenFields(
      { fields: { ...sparseLockFields.fields, amount: { type: 'currency', readonlyWhen: '!has(record.approved_at)' } } },
      { amount: 999 },
      sparsePrior(),
    )).toEqual({ amount: 999 });
  });

  // ── blast radius: nothing else at this write gate moves ─────────────────
  it('does not touch the object-level rules — `script` / `cross_field` stay fail-CLOSED (#4649)', () => {
    const withRules = {
      fields: { ...sparseLockFields.fields },
      validations: [
        { type: 'script', name: 'typo_rule', message: 'nope', condition: 'record.stauts == null' },
      ],
    };
    expect(() => evaluateValidationRules(withRules as never, { amount: 1 }, 'update', {
      previous: { id: 'r1', amount: 100 },
    } as never)).toThrow(/could not be evaluated/);
    const crossField = {
      fields: { ...sparseLockFields.fields },
      validations: [
        { type: 'cross_field', name: 'typo_cross', message: 'nope', condition: 'record.stauts == null' },
      ],
    };
    expect(() => evaluateValidationRules(crossField as never, { amount: 1 }, 'update', {
      previous: { id: 'r1', amount: 100 },
    } as never)).toThrow(/could not be evaluated/);
  });

  it('does not disturb the #4889 parent binding: unbound root still LOCKS, and this function still materialises no header', () => {
    // `parent` is a row of ANOTHER object — this function has no declared-field
    // list for it — and an ABSENT parent is the signal #4889 depends on.
    const warnings: string[] = [];
    expect(stripReadonlyWhenFields(invoiceLineFields, { quantity: 9999 }, { id: 'l1', invoice: 'inv1' }, {
      warn: (m: string) => warnings.push(m),
    } as never)).toEqual({});
    expect(warnings.some((w) => w.includes("reads 'parent'") && w.includes('LOCKED'))).toBe(true);
    // [#6457 — RE-ANNOTATED, verdict deliberately NOT flipped here.]
    //
    // A parent that IS bound but does not carry the key is still a fault at
    // THIS seam: fail-open, the change goes through. That was the hole #6457
    // closed, and the sentence below is the reason this assertion nonetheless
    // stays exactly as PR #6454 wrote it.
    //
    // #6457's ruling materialises the header INSIDE the engine's
    // `resolveMasterDetailParent(s)`, using the MASTER object's declared-field
    // table — the one thing this pure function does not and cannot have. So the
    // strip's own contract is unchanged (its signature never grew a second field
    // table), and a caller that hands it a genuinely sparse header still gets
    // the fail-open answer pinned here. What changed is that the ENGINE no
    // longer hands it one.
    //
    // The moved verdict therefore lives where the change lives, and is pinned
    // end-to-end against a real driver in `engine-readonly-when-parent.test.ts`
    // ("ROW 2 — THE FIX"), with its `requiredWhen` mirror in
    // `engine-required-when-parent.test.ts`. Read the two together: this one
    // says the strip did not move, that one says the write path did.
    const warnings2: string[] = [];
    expect(stripReadonlyWhenFields(invoiceLineFields, { quantity: 9999 }, { id: 'l1', invoice: 'inv1' }, {
      warn: (m: string) => warnings2.push(m),
    } as never, { id: 'inv1' })).toEqual({ quantity: 9999 });
    expect(warnings2.some((w) => w.includes('failed to evaluate — change allowed through'))).toBe(true);
  });
});

// #9107 — the CONDITIONAL strip judges only the keys the CALLER supplied at
// engine entry, the same discipline #5591 gave the static strip below. The two
// helpers are pinned here at the unit level; the engine-level consequences (the
// derived-field write path, and the API-boundary lock surviving it) live in
// `engine-readonly-when-derived-writes.test.ts`.
describe('stripReadonlyWhen* — supplied-key discipline (#9107)', () => {
  const lockedFields = {
    fields: {
      status: { type: 'text' },
      amount: { type: 'number', readonlyWhen: "record.status == 'paid'" },
    },
  };
  const paid = { status: 'paid', amount: 100 };

  it('KEEPS a locked key a hook ADDED — the caller never named it', () => {
    const out = stripReadonlyWhenFields(lockedFields, { amount: 999 }, paid, undefined, undefined, {
      supplied: {},
    });
    expect(out).toEqual({ amount: 999 });
    expect(out).toBe(out); // nothing dropped
  });

  it('KEEPS a locked key a hook OVERWROTE, even though the caller supplied it', () => {
    // The caller echoed `amount` back; a hook then wrote its own value over it.
    // What sits on the key now is a PLATFORM write, not a forgery.
    const out = stripReadonlyWhenFields(lockedFields, { amount: 777 }, paid, undefined, undefined, {
      supplied: { amount: 999 },
    });
    expect(out).toEqual({ amount: 777 });
  });

  it('STILL drops it when the hook wrote the caller value back unchanged', () => {
    // Identity is the whole test: an unchanged value is indistinguishable from
    // "no hook touched it", and the fail-safe direction is to strip. This is
    // also what closes the laundering path — echoing a key cannot exempt it.
    const out = stripReadonlyWhenFields(lockedFields, { amount: 999 }, paid, undefined, undefined, {
      supplied: { amount: 999 },
    });
    expect(out).toEqual({});
  });

  it('drops a caller-forged NaN — `Object.is`, not `===`', () => {
    const nanFields = {
      fields: { status: { type: 'text' }, amount: { type: 'number', readonlyWhen: "record.status == 'paid'" } },
    };
    const out = stripReadonlyWhenFields(nanFields, { amount: Number.NaN }, paid, undefined, undefined, {
      supplied: { amount: Number.NaN },
    });
    expect(out).toEqual({});
  });

  it('does not read an inherited `Object.prototype` key as caller-supplied', () => {
    // `constructor` matches the machine-name regex, so it is a legal field
    // name; `name in supplied` would be TRUE for it on any plain object.
    const oddly = {
      fields: { status: { type: 'text' }, constructor: { type: 'text', readonlyWhen: "record.status == 'paid'" } },
    };
    const out = stripReadonlyWhenFields(oddly, { constructor: 'hook-stamp' }, paid, undefined, undefined, {
      supplied: {},
    });
    expect(out).toEqual({ constructor: 'hook-stamp' });
  });

  it('an ABSENT `supplied` judges the whole payload — the fail-SAFE default', () => {
    // The pre-#9107 behaviour, deliberately kept as the default: a call site
    // with no entry snapshot cannot tell a hook write from a forgery and must
    // assume the forgery. Forgetting the option can only over-strip.
    expect(stripReadonlyWhenFields(lockedFields, { amount: 999 }, paid)).toEqual({});
  });

  it('a hook-written key is not even EVALUATED — no unbound-root lock, no warn', () => {
    // The fail-CLOSED unbound-root branch (#4889) exists to protect against an
    // unjudgeable CALLER write. A hook write is not this strip's business at
    // all, so the predicate never runs and the branch is never reached.
    const parentScoped = {
      fields: { quantity: { type: 'number', readonlyWhen: "parent.status == 'paid'" } },
    };
    const warnings: string[] = [];
    const out = stripReadonlyWhenFields(parentScoped, { quantity: 9999 }, { id: 'l1' }, {
      warn: (m: string) => warnings.push(m),
    } as never, undefined, { supplied: {} });
    expect(out).toEqual({ quantity: 9999 });
    expect(warnings).toEqual([]);
  });

  it('the BULK strip applies the identical discipline', () => {
    const rows = [{ status: 'paid', amount: 100 }, { status: 'draft', amount: 50 }];
    // Hook-added ⇒ survives, even though row 1 locks the field.
    expect(
      stripReadonlyWhenFieldsMulti(lockedFields, { amount: 999 }, rows, undefined, undefined, { supplied: {} }),
    ).toEqual({ amount: 999 });
    // Caller-supplied ⇒ dropped for the whole batch (locked in ≥1 row).
    expect(
      stripReadonlyWhenFieldsMulti(lockedFields, { amount: 999 }, rows, undefined, undefined, {
        supplied: { amount: 999 },
      }),
    ).toEqual({});
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
    const supplied = { title: 'x', created_by: 'attacker' };
    const out = stripReadonlyFields(stampedFields, { ...supplied }, supplied);
    expect(out).toEqual({ title: 'x' });
  });

  it('KEEPS a readonly field the caller did NOT supply (server stamp survives)', () => {
    // `updated_by` was written into `data` by the audit-stamp hook, not the
    // caller — it must not be stripped.
    const supplied = { title: 'x' };
    const out = stripReadonlyFields(stampedFields, { title: 'x', updated_by: 'u1' }, supplied);
    expect(out).toEqual({ title: 'x', updated_by: 'u1' });
  });

  it('returns the SAME object when nothing is stripped', () => {
    const d = { title: 'x' };
    expect(stripReadonlyFields(stampedFields, d, { title: 'x' })).toBe(d);
  });

  it('drops a caller-forged readonly field even when it also carries a server stamp key', () => {
    const supplied = { title: 'x', created_by: 'attacker' };
    const out = stripReadonlyFields(
      stampedFields,
      { title: 'x', created_by: 'attacker', updated_by: 'u1' },
      supplied,
    );
    expect(out).toEqual({ title: 'x', updated_by: 'u1' });
  });
});

// #5591 — the strip must delete the value the CALLER SUBMITTED, never the value
// that happens to sit on the key when the strip runs. The strip executes after
// `beforeUpdate`, so those two differ exactly when a hook overwrote a key the
// caller had also named — which is what silently deleted hook-written publish
// timestamps on whole-record write-backs (hotcrm#788).
describe('stripReadonlyFields — supplied VALUE identity, not just key presence (#5591)', () => {
  it('KEEPS a readonly key a hook OVERWROTE, even though the caller supplied it', () => {
    // The caller echoed `created_by` back; a beforeUpdate hook then wrote its
    // own value over it. What is on the key now is a PLATFORM write.
    const supplied = { title: 'x', created_by: 'attacker' };
    const afterHooks = { title: 'x', created_by: 'hook-resolved-owner' };
    const out = stripReadonlyFields(stampedFields, afterHooks, supplied);
    expect(out).toEqual({ title: 'x', created_by: 'hook-resolved-owner' });
    expect(out).toBe(afterHooks); // nothing dropped ⇒ same reference
  });

  it('STILL drops it when the hook wrote the caller value back unchanged', () => {
    // Identity is the whole test: an unchanged value is indistinguishable from
    // "no hook touched it", and the fail-safe direction is to strip.
    const supplied = { created_by: 'attacker' };
    const out = stripReadonlyFields(stampedFields, { created_by: 'attacker' }, supplied);
    expect(out).toEqual({});
  });

  it('drops a caller-forged NaN — `Object.is`, not `===`', () => {
    // `===` reports NaN !== NaN, which would read a forged NaN as "a hook
    // rewrote this" and KEEP it. The one input where the loose operator
    // inverts the verdict, so it is pinned rather than left to a reviewer.
    const numeric = { fields: { score: { type: 'number', readonly: true } } };
    const supplied = { score: Number.NaN };
    const out = stripReadonlyFields(numeric, { score: Number.NaN }, supplied);
    expect(out).toEqual({});
  });

  it('does not read an inherited `Object.prototype` key as caller-supplied', () => {
    // `constructor` matches the machine-name regex, so it is a legal field
    // name; `name in supplied` would be TRUE for it on any plain object and
    // would strip a hook stamp. Own-property check, pinned.
    const oddly = { fields: { constructor: { type: 'text', readonly: true } } };
    const out = stripReadonlyFields(oddly, { constructor: 'hook-stamp' }, {});
    expect(out).toEqual({ constructor: 'hook-stamp' });
  });

  it('KNOWN LIMIT: a hook that mutates a caller-supplied object IN PLACE is still stripped', () => {
    // The snapshot is shallow, so an in-place mutation leaves identity
    // unchanged and is invisible to any comparison short of a deep clone —
    // which this path will not pay for on every write. Documented and pinned
    // so the limit is a decision, not a surprise: a hook meaning to write a
    // read-only column should ASSIGN to it.
    const jsonish = { fields: { payload: { type: 'json', readonly: true } } };
    const shared: Record<string, unknown> = { a: 1 };
    const supplied = { payload: shared };
    shared.a = 2; // the "hook" mutates in place — same reference
    const out = stripReadonlyFields(jsonish, { payload: shared }, supplied);
    expect(out).toEqual({});
  });
});

// #3493 — a "historical" import (preserveAudit) reinstates the original
// timeline: the audit/timestamp family and author-declared business `readonly`
// fields survive the strip, while platform-managed `system` columns outside the
// audit family stay stripped (no tenancy-forging backdoor).
const historicalFields = {
  fields: {
    title: { type: 'text' },
    created_at: { type: 'datetime', readonly: true, system: true },
    created_by: { type: 'lookup', readonly: true, system: true },
    updated_at: { type: 'datetime', readonly: true, system: true },
    updated_by: { type: 'lookup', readonly: true, system: true },
    organization_id: { type: 'lookup', readonly: true, system: true },
    // author-declared business readonly field (NOT system) — e.g. a case's close time
    closed_at: { type: 'datetime', readonly: true },
  },
};

describe('stripReadonlyFields — preserveAudit whitelist (#3493)', () => {
  it('KEEPS the caller-supplied audit/timestamp family under preserveAudit', () => {
    const data = {
      created_at: '2020-01-01T00:00:00Z',
      created_by: 'u_creator',
      updated_at: '2021-03-01T00:00:00Z',
      updated_by: 'u_old',
    };
    const out = stripReadonlyFields(historicalFields, { ...data }, data, undefined, { preserveAudit: true });
    expect(out).toEqual(data);
  });

  it('KEEPS an author-declared business readonly field (closed_at) under preserveAudit', () => {
    const supplied = { closed_at: '2021-03-01T00:00:00Z' };
    const out = stripReadonlyFields(
      historicalFields,
      { ...supplied },
      supplied,
      undefined,
      { preserveAudit: true },
    );
    expect(out).toEqual({ closed_at: '2021-03-01T00:00:00Z' });
  });

  it('NEVER keeps the primary key — a readonly `id` is stripped even under preserveAudit (#8215)', () => {
    // Every platform object declares its `id` `readonly: true` and nothing
    // flags it `system` (`sys_user_preference`: `Field.text({ label:
    // 'Preference ID', required: true, readonly: true })`), so the pre-#8215
    // second limb read it as a business field like `closed_at` — and a
    // historical import's by-id update handed `SET id = 'rec_1' WHERE id =
    // 'rec_1'` to the driver: a no-op on SQL, an outright rejection on stores
    // with immutable primary keys. The REST ingress folds the path id into
    // every update body (#6479), so the importer never even typed the key it
    // was being handed back. The address of a write is not a fact being
    // restored; the whitelist stops at it.
    const supplied = { id: 'rec_1', closed_at: '2021-03-01T00:00:00Z' };
    const out = stripReadonlyFields(
      { fields: { ...historicalFields.fields, id: { type: 'text', readonly: true } } },
      { ...supplied },
      supplied,
      undefined,
      { preserveAudit: true },
    );
    expect(out).toEqual({ closed_at: '2021-03-01T00:00:00Z' });
  });

  it('…while the flag keeps doing its actual job on the same payload — timeline + business fields survive (#8215)', () => {
    // The other direction, pinned so the narrowing cannot creep: #3493 scoped
    // `preserveAudit` to "reinstate the original timeline", and everything in
    // that scope still rides through beside a stripped `id`.
    const supplied = {
      id: 'rec_1',
      created_at: '2020-01-01T00:00:00Z',
      created_by: 'u_creator',
      updated_at: '2021-03-01T00:00:00Z',
      updated_by: 'u_old',
      closed_at: '2021-03-01T00:00:00Z',
    };
    const out = stripReadonlyFields(
      { fields: { ...historicalFields.fields, id: { type: 'text', readonly: true } } },
      { ...supplied },
      supplied,
      undefined,
      { preserveAudit: true },
    );
    const { id: _address, ...reinstated } = supplied;
    expect(out).toEqual(reinstated);
  });

  it('STILL strips a non-audit system column (organization_id) under preserveAudit — no tenancy backdoor', () => {
    const supplied = { organization_id: 'org_forged', closed_at: '2021-03-01T00:00:00Z' };
    const out = stripReadonlyFields(
      historicalFields,
      { ...supplied },
      supplied,
      undefined,
      { preserveAudit: true },
    );
    expect(out).toEqual({ closed_at: '2021-03-01T00:00:00Z' });
  });

  it('strips the whole family as before when preserveAudit is NOT set (regression)', () => {
    const supplied = {
      updated_at: '2021-03-01T00:00:00Z',
      closed_at: '2021-03-01T00:00:00Z',
      organization_id: 'o1',
    };
    const out = stripReadonlyFields(historicalFields, { title: 'x', ...supplied }, supplied);
    expect(out).toEqual({ title: 'x' });
  });
});

// #5503 — `autonumber` is IMPLICITLY read-only: the runtime issues the value,
// so a caller may neither seed it on create nor rewrite it on update. The field
// carries no `readonly: true` flag (and the spec builder does not inject one),
// which is exactly why the #2948 loop used to walk straight past it.
const numberedFields = {
  name: 'an_account',
  fields: {
    title: { type: 'text' },
    // the forgeable business identifier
    account_number: { type: 'autonumber', autonumberFormat: 'ACC-{0000}' },
    // a formula field: computed on READ from a plan, never persisted from the
    // write payload — deliberately NOT runtime-owned for strip purposes.
    total: { type: 'formula' },
    // an author-declared readonly field, to prove both sources coexist
    closed_at: { type: 'datetime', readonly: true },
  },
};

describe('isRuntimeOwnedField (#5503)', () => {
  it('is true for autonumber and false for every other type in the fixture', () => {
    expect(isRuntimeOwnedField({ type: 'autonumber' })).toBe(true);
    expect(isRuntimeOwnedField({ type: 'text' })).toBe(false);
    expect(isRuntimeOwnedField({ type: 'formula' })).toBe(false);
    expect(isRuntimeOwnedField({ type: 'summary' })).toBe(false);
    expect(isRuntimeOwnedField(undefined)).toBe(false);
  });
});

describe('stripReadonlyFields — implicit readonly on autonumber (#5503)', () => {
  it('drops a caller-supplied record number even with no `readonly: true` flag', () => {
    const supplied = { title: 'x', account_number: 'ACC-888888' };
    const out = stripReadonlyFields(numberedFields, { ...supplied }, supplied);
    expect(out).toEqual({ title: 'x' });
  });

  it('KEEPS a hook-stamped record number the caller did not supply', () => {
    const supplied = { title: 'x' };
    const out = stripReadonlyFields(numberedFields, { title: 'x', account_number: 'HOOK-1' }, supplied);
    expect(out).toEqual({ title: 'x', account_number: 'HOOK-1' });
  });

  it('KEEPS a hook-REWRITTEN record number the caller DID supply (#5591)', () => {
    // The #5503 limb read through the same key-only guard #5591 replaced, so
    // it inherited the same defect: a hook that re-issues the record number
    // lost its value to a caller that had echoed the old one back.
    const supplied = { title: 'x', account_number: 'ACC-888888' };
    const out = stripReadonlyFields(numberedFields, { title: 'x', account_number: 'HOOK-1' }, supplied);
    expect(out).toEqual({ title: 'x', account_number: 'HOOK-1' });
  });

  it('KEEPS it under preserveAudit — a migration reinstates legacy record numbers', () => {
    const supplied = { account_number: 'LEGACY-7' };
    const out = stripReadonlyFields(
      numberedFields, { ...supplied }, supplied, undefined, { preserveAudit: true },
    );
    expect(out).toEqual({ account_number: 'LEGACY-7' });
  });

  it('logs the runtime-owned message, not the author-declared readonly one', () => {
    const warns: string[] = [];
    const supplied = { account_number: 'ACC-888888', closed_at: '2021-01-01T00:00:00Z' };
    stripReadonlyFields(
      numberedFields,
      { ...supplied },
      supplied,
      { warn: (m: string) => warns.push(m) } as any,
    );
    expect(warns).toHaveLength(2);
    // [#8214] `preserveAuditApplies` is now stated by the pin rather than
    // assumed: `account_number` is an `autonumber` with no `system: true`, so
    // {@link isPreservableUnderAudit} keeps it and the remedy really is on
    // offer. The clause the old text printed unconditionally is unchanged FOR
    // THIS FIELD — what moved is that the strip now proves it applies before
    // saying so.
    expect(warns.some((m) => m === runtimeOwnedStripWarning('account_number', 'autonumber', 'an_account', { preserveAuditApplies: true }))).toBe(true);
    // The message must say WHY (runtime-issued) and name BOTH exempt writer
    // paths — an author who never wrote `readonly: true` gets no help from a
    // bare "this field is read-only".
    const rt = warns.find((m) => m.includes('runtime-owned'))!;
    expect(rt).toContain('isSystem');
    expect(rt).toContain('preserveAudit');
    expect(rt).toContain('COMMITTED WITHOUT IT');
  });
});

// #8141 — `options.addressKey`: the key that carries the write's ADDRESS is
// still stripped, it just stops LOGGING. Every claim `readonlyStripWarning`
// makes is false for that key (the caller did not supply it — the REST ingress
// folded the path id in, #6479; nothing it wanted was dropped; nothing it asked
// for was left out of the commit), and its remedy prose sends that caller to
// `{ context: { isSystem: true } }`, which would exempt it from this strip
// entirely — a strictly worse posture bought to silence a line that should
// never have printed.
//
// The trap this block exists to catch is silencing too much: the line's own
// docblock keeps it at `warn` so REAL forgery attempts stay visible, so every
// case below has a counter-case where the WARN must survive BYTE-IDENTICAL.
const addressedFields = {
  name: 'pref',
  fields: {
    id: { type: 'text', primaryKey: true, readonly: true },
    value: { type: 'text' },
    locked_note: { type: 'text', readonly: true },
  },
};

/** Collect the warn lines a single strip call emits. */
function stripWithWarns(
  schema: unknown,
  data: Record<string, unknown>,
  supplied: Record<string, unknown>,
  options?: { preserveAudit?: boolean; addressKey?: string; strictReadonlyWrites?: boolean },
) {
  const warns: string[] = [];
  const levels: string[] = [];
  const logger: any = {
    warn: (m: string) => { warns.push(m); levels.push('warn'); },
    error: (m: string) => { warns.push(m); levels.push('error'); },
    info: (m: string) => { warns.push(m); levels.push('info'); },
    debug: (m: string) => { warns.push(m); levels.push('debug'); },
  };
  const out = stripReadonlyFields(schema as any, data, supplied, logger, options);
  return { out, warns, levels };
}

describe('stripReadonlyFields — addressKey silences the LOG, never the strip (#8141)', () => {
  it('STILL STRIPS the address key — the payload handed on is byte-identical', () => {
    // The half that must not move. A same-value primary-key write is a no-op
    // on SQL but an outright rejection on stores with immutable primary keys,
    // and widening/narrowing the strip is #6435's explicitly separate
    // decision. This fix is about the log line, and only the log line.
    const supplied = { id: 'rec_1', value: 'v1' };
    const { out, warns } = stripWithWarns(addressedFields, { ...supplied }, supplied, { addressKey: 'id' });
    expect(out).toEqual({ value: 'v1' });
    expect(warns).toEqual([]);
  });

  it('with NO addressKey the very same call still WARNs — the option is opt-in', () => {
    // The regression pin for the two call sites this card does not touch (the
    // multi branch and the insert-side sibling pass no `addressKey` at all).
    const supplied = { id: 'rec_1', value: 'v1' };
    const { out, warns, levels } = stripWithWarns(addressedFields, { ...supplied }, supplied);
    expect(out).toEqual({ value: 'v1' });
    expect(warns).toEqual([readonlyStripWarning('id', 'pref')]);
    expect(levels).toEqual(['warn']);
    // [#8215] The line no longer offers `{ context: { preserveAudit: true } }`
    // for the primary key — the whitelist stopped covering it, so the flag
    // would not keep `id`, and offering it would be exactly the false-remedy
    // shape #8214 removed. Pinned literally, not via the composer.
    expect(warns[0]).not.toContain('preserveAudit');
  });

  it('a DIFFERENT read-only field in the same payload still WARNs, unchanged in wording and level', () => {
    // The tripwire. Silencing the address must not silence the forgery riding
    // along with it — asserted with `toBe` against the exported message so a
    // reworded or downgraded line fails here.
    const supplied = { id: 'rec_1', value: 'v1', locked_note: 'forged' };
    const { out, warns, levels } = stripWithWarns(
      addressedFields, { ...supplied }, supplied, { addressKey: 'id' },
    );
    expect(out).toEqual({ value: 'v1' });
    expect(warns).toEqual([readonlyStripWarning('locked_note', 'pref', { preserveAuditApplies: true })]);
    expect(levels).toEqual(['warn']);
    expect(warns[0]).toContain('COMMITTED WITHOUT IT');
    expect(warns[0]).toContain('{ context: { isSystem: true } }');
    expect(warns[0]).toContain('onFieldsDropped');
  });

  it('an addressKey naming a key the caller did NOT supply changes nothing', () => {
    // A server stamp on the named key is kept, exactly as before — the option
    // is consulted only where a strip would otherwise have logged.
    const d = { id: 'rec_1', value: 'v1' };
    const { out, warns } = stripWithWarns(addressedFields, d, { value: 'v1' }, { addressKey: 'id' });
    expect(out).toBe(d); // nothing stripped ⇒ same reference
    expect(warns).toEqual([]);
  });

  it('an addressKey naming a field that is not read-only changes nothing', () => {
    const supplied = { value: 'v1', locked_note: 'forged' };
    const { out, warns } = stripWithWarns(
      addressedFields, { ...supplied }, supplied, { addressKey: 'value' },
    );
    expect(out).toEqual({ value: 'v1' });
    expect(warns).toEqual([readonlyStripWarning('locked_note', 'pref', { preserveAuditApplies: true })]);
  });

  it('composes with preserveAudit — and the primary key is stripped even under the flag (#8215)', () => {
    const supplied = { id: 'rec_1', created_at: '2020-01-01T00:00:00Z', organization_id: 'org_forged' };
    const { out, warns } = stripWithWarns(
      { name: 'pref', fields: { ...addressedFields.fields, ...historicalFields.fields } },
      { ...supplied },
      supplied,
      { preserveAudit: true, addressKey: 'id' },
    );
    // [#8215] Until this card, `preserveAudit` KEPT `id` one line before the
    // address rule was consulted — a `readonly` field with no `system: true`
    // read as an author-declared business field to `isPreservableUnderAudit`,
    // and the driver received `SET id = 'rec_1' WHERE id = 'rec_1'` (a no-op
    // on SQL, an outright rejection on stores with immutable primary keys —
    // #6435 / #8141). The primary key is the ADDRESS of the write, not a fact
    // a historical import is restoring, so the whitelist no longer covers it:
    // `id` is stripped even under the flag, exactly as it is without it.
    // `created_at` is still reinstated by the whitelist; `organization_id` is
    // a non-audit system column, still stripped and still loud.
    expect(out).toEqual({ created_at: '2020-01-01T00:00:00Z' });
    // …and #8141 composes: the address stays out of the LOG as well as the
    // payload — the one surviving line names the tenancy forgery alone.
    // Load-bearing facts pinned as literals rather than through the composer,
    // so a rewording of both sides cannot keep them green.
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("Field 'organization_id'");
    expect(warns[0]).not.toContain("Field 'id'");
    // [#8214] The remedy stays derived per field: this very call had
    // `preserveAudit` ON and stripped `organization_id` anyway, so the line
    // must not offer the flag.
    expect(warns[0]).not.toContain('preserveAudit');
    // The wording contract itself is still the composer's single source.
    expect(warns).toEqual([readonlyStripWarning('organization_id', 'pref')]);
  });

  it('silences the RUNTIME-OWNED message for the same key, on the same ground', () => {
    // Why the exemption keys on the key's ROLE and not on which lock caught it:
    // an `autonumber` primary key addressed by id is the same write, and the
    // reason the line is untrue there is identical. The record number of a
    // DIFFERENT field still logs.
    const numberedId = {
      name: 'pref',
      fields: {
        id: { type: 'autonumber', primaryKey: true },
        account_number: { type: 'autonumber' },
        value: { type: 'text' },
      },
    };
    const supplied = { id: 'ACC-1', account_number: 'ACC-888888', value: 'v1' };
    const { out, warns } = stripWithWarns(numberedId, { ...supplied }, supplied, { addressKey: 'id' });
    expect(out).toEqual({ value: 'v1' });
    expect(warns).toEqual([runtimeOwnedStripWarning('account_number', 'autonumber', 'pref', { preserveAuditApplies: true })]);
  });
});

// #8214 — the two claims the strip messages were making that were not true of
// the call in front of them. The engine-level measurement lives in
// `engine-strict-readonly-warning-truthful.test.ts`; this block pins the
// composer and the strip's derivation of what it may say.
describe('#8214 — strictReadonlyWrites: the line reports a REFUSAL, not a commit', () => {
  it('the strip threads the flag into the message it emits', () => {
    const supplied = { id: 'rec_1', value: 'v1', locked_note: 'forged' };
    const { warns, levels } = stripWithWarns(
      addressedFields, { ...supplied }, supplied,
      { addressKey: 'id', strictReadonlyWrites: true },
    );
    expect(warns).toEqual([
      readonlyStripWarning('locked_note', 'pref', { strict: true, preserveAuditApplies: true }),
    ]);
    // ⛔ Not silenced, and not demoted: the forgery signal is the whole reason
    // this line exists at `warn`, and a refused forged write is the case that
    // most deserves it.
    expect(levels).toEqual(['warn']);
    expect(warns[0]).toContain("Field 'locked_note'");
  });

  it('and the ADDRESS is still silent under strict — #8141 is not re-opened', () => {
    const supplied = { id: 'rec_1', value: 'v1' };
    const { out, warns } = stripWithWarns(
      addressedFields, { ...supplied }, supplied,
      { addressKey: 'id', strictReadonlyWrites: true },
    );
    expect(warns).toEqual([]);
    expect(out).toEqual({ value: 'v1' }); // …and still STRIPPED, as ever
  });

  it('omitting the flag is identical to passing it false — the default is the old text', () => {
    expect(readonlyStripWarning('f', 'o')).toBe(readonlyStripWarning('f', 'o', { strict: false }));
    expect(runtimeOwnedStripWarning('f', 'autonumber', 'o'))
      .toBe(runtimeOwnedStripWarning('f', 'autonumber', 'o', { strict: false }));
  });

  it('the strict text swaps the CONSEQUENCE and the observe-instead remedy, nothing else', () => {
    const plain = readonlyStripWarning('f', 'o');
    const strict = readonlyStripWarning('f', 'o', { strict: true });
    expect(plain).toContain('COMMITTED WITHOUT IT');
    expect(strict).not.toContain('COMMITTED WITHOUT IT');
    expect(strict).toContain('REFUSED ENTIRELY');
    expect(strict).toContain('ERR_READONLY_FIELD_REJECTED');
    // Under strict, "pass onFieldsDropped" alone is not the remedy — dropping
    // strict is. Same direction the refusal error's own message points.
    expect(strict).toContain('drop options.strictReadonlyWrites');
    // Everything the #4903 contract requires is still in both.
    for (const m of [plain, strict]) {
      expect(m).toContain("Field 'f' on 'o' is read-only");
      expect(m).toContain('{ context: { isSystem: true } }');
      expect(m).toContain('onFieldsDropped');
    }
  });

  it('the runtime-owned twin does the same, keeping its own WHY', () => {
    const strict = runtimeOwnedStripWarning('code', 'autonumber', 'o', { strict: true });
    expect(strict).not.toContain('COMMITTED WITHOUT IT');
    expect(strict).toContain('REFUSED ENTIRELY');
    // The clause that makes it distinct from the readonly message must survive:
    // the author never wrote `readonly: true` here, so the line has to say who
    // owns the value.
    expect(strict).toContain('the runtime issues this value from its sequence');
  });
});

// #8214 (2) — the remedy set. `stripReadonlyFields` honours `preserveAudit`
// (#3493), a WHITELIST narrower than `isSystem` by construction, while the
// message offered only the blanket exemption — steering an import that forgot
// the flag to the strictly worse posture, the identical failure #8141 fixed one
// remedy over. It is now offered per field, DERIVED from the same predicate the
// strip consults, so it can never advertise an exemption that would not have
// worked — and cannot drift when #8215 narrows that predicate.
describe('#8214 — the preserveAudit remedy is derived per field, not described', () => {
  it('offers it for a field the whitelist would have kept', () => {
    const supplied = { closed_at: '2021-03-01T00:00:00Z' };
    const { warns } = stripWithWarns(historicalFields, { ...supplied }, supplied);
    expect(warns).toEqual([
      readonlyStripWarning('closed_at', undefined, { preserveAuditApplies: true }),
    ]);
    expect(warns[0]).toContain('{ context: { preserveAudit: true } }');
  });

  it('WITHHOLDS it for a non-audit system column the whitelist strips anyway', () => {
    const supplied = { organization_id: 'org_forged' };
    const { warns } = stripWithWarns(historicalFields, { ...supplied }, supplied);
    expect(warns).toEqual([readonlyStripWarning('organization_id')]);
    expect(warns[0]).not.toContain('preserveAudit');
    expect(warns[0]).toContain('{ context: { isSystem: true } }');
  });

  it('the audit family itself is offered it — that is the case #3493 exists for', () => {
    const supplied = { created_at: '2020-01-01T00:00:00Z' };
    const { warns } = stripWithWarns(historicalFields, { ...supplied }, supplied);
    expect(warns[0]).toContain('{ context: { preserveAudit: true } }');
  });

  it('a line that PRINTS with preserveAudit already on never offers it', () => {
    // The derivation's safety property, stated as a test rather than trusted:
    // a field kept by `preserveAudit` never reaches the log at all, so any
    // field that DOES reach it while the flag is on is one the whitelist
    // refused — and the remedy is correctly withheld.
    const supplied = { organization_id: 'org_forged', closed_at: '2021-03-01T00:00:00Z' };
    const { out, warns } = stripWithWarns(
      historicalFields, { ...supplied }, supplied, { preserveAudit: true },
    );
    expect(out).toEqual({ closed_at: '2021-03-01T00:00:00Z' });
    expect(warns).toEqual([readonlyStripWarning('organization_id')]);
    expect(warns[0]).not.toContain('preserveAudit');
  });

  it('the two sibling messages now agree — one predicate, two texts', () => {
    // The disagreement the card was filed about: the runtime-owned twin named
    // both exemptions unconditionally while the readonly one named neither.
    // Both are now gated on the same fact, so a field that is preservable gets
    // the sentence from either message and a field that is not gets it from
    // neither.
    for (const applies of [true, false]) {
      const ro = readonlyStripWarning('f', 'o', { preserveAuditApplies: applies });
      const rt = runtimeOwnedStripWarning('f', 'autonumber', 'o', { preserveAuditApplies: applies });
      expect(ro.includes('preserveAudit')).toBe(applies);
      expect(rt.includes('preserveAudit')).toBe(applies);
      // `isSystem` is unconditional in both — it exempts the whole strip, so it
      // is true for every field either message can name.
      expect(ro).toContain('isSystem');
      expect(rt).toContain('isSystem');
    }
  });
});

describe('stripRuntimeOwnedFields — the INSERT-side strip (#5503)', () => {
  it('drops a caller-supplied record number', () => {
    const supplied = { title: 'x', account_number: 'ACC-777777' };
    const out = stripRuntimeOwnedFields(numberedFields, { ...supplied }, supplied);
    expect(out).toEqual({ title: 'x' });
  });

  it('leaves AUTHOR-declared readonly fields alone — insert keeps its #3413 exemption', () => {
    // The engine is deliberately NOT the place the static-`readonly` insert
    // strip lives (that is the #3043 protocol ingress); this narrower helper
    // must not quietly take over that job and start stripping columns the
    // trusted internal writers legitimately seed on create.
    const supplied = { title: 'x', closed_at: '2021-01-01T00:00:00Z' };
    const out = stripRuntimeOwnedFields(numberedFields, { ...supplied }, supplied);
    expect(out).toEqual({ title: 'x', closed_at: '2021-01-01T00:00:00Z' });
  });

  it('KEEPS a hook-stamped value and returns the SAME object when nothing is stripped', () => {
    const d = { title: 'x', account_number: 'HOOK-1' };
    expect(stripRuntimeOwnedFields(numberedFields, d, { title: 'x' })).toBe(d);
  });

  it('KEEPS it under preserveAudit', () => {
    const supplied = { account_number: 'LEGACY-7' };
    const out = stripRuntimeOwnedFields(
      numberedFields, { ...supplied }, supplied, undefined, { preserveAudit: true },
    );
    expect(out).toEqual({ account_number: 'LEGACY-7' });
  });

  it('but NEVER the primary key — an `autonumber` id seeded under preserveAudit is stripped (#8215)', () => {
    // The predicate is shared with the update-side strip, and the exclusion
    // keys on the key's ROLE, not on which lock caught it: `id` is the
    // record's address on every physical table (the driver provisions it as
    // the primary key), so it is not one of the "legacy record numbers"
    // #5503's whitelist exists to reinstate — that case is the business
    // identifier (`account_number`), pinned KEPT one case up.
    const numberedId = {
      name: 'an_account',
      fields: {
        id: { type: 'autonumber' },
        account_number: { type: 'autonumber', autonumberFormat: 'ACC-{0000}' },
      },
    };
    const supplied = { id: 'LEGACY-ID-7', account_number: 'LEGACY-7' };
    const out = stripRuntimeOwnedFields(
      numberedId, { ...supplied }, supplied, undefined, { preserveAudit: true },
    );
    expect(out).toEqual({ account_number: 'LEGACY-7' });
  });
});

// #6339 — the insert-side twin of #5591, and wrong for the identical reason:
// the strip runs AFTER `beforeInsert`, so the value on the key at strip time is
// not necessarily the caller's. A key-only guard deleted whatever was standing
// there, which killed a hook that RE-ISSUED a record number the caller had also
// submitted — while the same hook's write survived on a caller that had not.
describe('stripRuntimeOwnedFields — supplied VALUE identity, not just key presence (#6339)', () => {
  it('KEEPS a record number a hook OVERWROTE, even though the caller supplied it', () => {
    // The caller forged `account_number`; a beforeInsert hook then wrote its
    // own over it. What sits on the key now is a PLATFORM write.
    const supplied = { title: 'x', account_number: 'ACC-777777' };
    const afterHooks = { title: 'x', account_number: 'HOOK-OVERWRITE' };
    const out = stripRuntimeOwnedFields(numberedFields, afterHooks, supplied);
    expect(out).toEqual({ title: 'x', account_number: 'HOOK-OVERWRITE' });
    expect(out).toBe(afterHooks); // nothing dropped ⇒ same reference
  });

  it('STILL drops it when the hook wrote the caller value back unchanged', () => {
    // Identity is the whole test: an unchanged value is indistinguishable from
    // "no hook touched it", and the fail-safe direction is to strip.
    const supplied = { account_number: 'ACC-777777' };
    const out = stripRuntimeOwnedFields(numberedFields, { account_number: 'ACC-777777' }, supplied);
    expect(out).toEqual({});
  });

  it('drops a caller-forged NaN — `Object.is`, not `===`', () => {
    // `===` reports NaN !== NaN, which would read a forged NaN as "a hook
    // rewrote this" and KEEP it. The one input where the loose operator
    // inverts the verdict, so it is pinned rather than left to a reviewer.
    const numeric = { fields: { seq: { type: 'autonumber' } } };
    const supplied = { seq: Number.NaN };
    const out = stripRuntimeOwnedFields(numeric, { seq: Number.NaN }, supplied);
    expect(out).toEqual({});
  });

  it('does not read an inherited `Object.prototype` key as caller-supplied', () => {
    // `constructor` matches the machine-name regex, so it is a legal field
    // name; `name in supplied` would be TRUE for it on any plain object and
    // would strip a hook stamp. Own-property check, pinned.
    const oddly = { fields: { constructor: { type: 'autonumber' } } };
    const out = stripRuntimeOwnedFields(oddly, { constructor: 'HOOK-1' }, {});
    expect(out).toEqual({ constructor: 'HOOK-1' });
  });

  it('warns only for the value it really dropped', () => {
    // The warning is the caller-visible half of the strip: a hook-overwritten
    // key is COMMITTED, so warning about it would make the log lie in exactly
    // the direction `runtimeOwnedStripWarning` promises it does not.
    const warns: string[] = [];
    const logger = { warn: (m: string) => warns.push(m) } as any;
    stripRuntimeOwnedFields(
      numberedFields, { account_number: 'HOOK-OVERWRITE' }, { account_number: 'ACC-777777' }, logger,
    );
    expect(warns).toEqual([]);
    stripRuntimeOwnedFields(
      numberedFields, { account_number: 'ACC-777777' }, { account_number: 'ACC-777777' }, logger,
    );
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("Field 'account_number'");
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

// #3433 — seed writes are curated end-state facts, not lifecycle events, so the
// engine passes `skipStateMachine` for them: the `state_machine` rule is skipped
// on BOTH insert (initialStates) and update (transitions), while every OTHER
// rule still runs. Each case pairs the exempted call with an un-flagged control
// so the exemption can't silently become always-on.
describe('skipStateMachine exemption for seed writes (#3433)', () => {
  const flowSchema = {
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

  it('bypasses the initialStates entry check on INSERT (born mid-flow)', () => {
    // Control: enforced without the flag.
    expect(() =>
      evaluateValidationRules(flowSchema, { approval_status: 'approved' }, 'insert'),
    ).toThrow(ValidationError);
    expect(() =>
      evaluateValidationRules(flowSchema, { approval_status: 'approved' }, 'insert', {
        skipStateMachine: true,
      }),
    ).not.toThrow();
  });

  it('bypasses the transition check on UPDATE (illegal hop draft → approved)', () => {
    // Control: draft → approved is not a declared transition.
    expect(() =>
      evaluateValidationRules(flowSchema, { approval_status: 'approved' }, 'update', {
        previous: { approval_status: 'draft' },
      }),
    ).toThrow(ValidationError);
    expect(() =>
      evaluateValidationRules(flowSchema, { approval_status: 'approved' }, 'update', {
        previous: { approval_status: 'draft' },
        skipStateMachine: true,
      }),
    ).not.toThrow();
  });

  it('skips ONLY state_machine — other rules (script) still fire under the flag', () => {
    const guardedSchema = {
      validations: [
        flowSchema.validations[0],
        {
          type: 'script' as const,
          name: 'amount_non_negative',
          condition: { dialect: 'cel' as const, source: 'record.amount < 0' },
          message: 'amount must be non-negative',
        },
      ],
    };
    // FSM skipped + script satisfied → clean.
    expect(() =>
      evaluateValidationRules(guardedSchema, { approval_status: 'approved', amount: 5 }, 'insert', {
        skipStateMachine: true,
      }),
    ).not.toThrow();
    // FSM skipped but script violated → still rejected (exemption is scoped).
    try {
      evaluateValidationRules(guardedSchema, { approval_status: 'approved', amount: -1 }, 'insert', {
        skipStateMachine: true,
      });
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).fields[0].message).toBe('amount must be non-negative');
    }
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

  // #4649 — this used to assert the opposite ("fails open"). A validation that
  // could not be checked must not read as a pass; see rule-fail-closed.test.ts
  // for the full contract.
  it('fails CLOSED on an un-evaluable predicate (#4649)', () => {
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
    ).toThrow(/rule 'broken' could not be evaluated/);
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

  it('needsPriorRecord is true for any conditional, and recurses into its branches', () => {
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

    // #4649 — a conditional wrapping only a format STILL needs the prior
    // record: its `when` is evaluated against the merged record, so without the
    // prior state it reads a PATCH as though it were the whole record. This
    // assertion was `false` before #4649, which is why a `when` referencing an
    // unchanged field used to fault and skip the guard entirely.
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
    expect(needsPriorRecord(wrapsFormat)).toBe(true);

    // A rule set with no conditional and no prior-dependent rule still needs
    // nothing — the fetch is not universal.
    const formatOnly = {
      validations: [{ type: 'format' as const, name: 'f', message: 'm', field: 'email', format: 'email' }],
    };
    expect(needsPriorRecord(formatOnly)).toBe(false);
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

// ── #5029 — the `format` keyword inside a `json_schema` rule ─────────────
//
// In ajv 8 `format` is NOT built in; it ships in `ajv-formats`. Without the
// plugin, and under the runtime's `strict: false`, an unknown format is not an
// error — ajv logs one line at COMPILE time and drops the keyword. So a rule
// declaring `format: 'email'` compiled fine, ran on every write, enforced
// `type`/`required`, and enforced NOTHING for `format`, for every record.
//
// That is the #4649 / #4762 family one level in, and nastier than either
// because the failure is PARTIAL: the rule visibly rejects bad `type` payloads
// in dev, so it reads as working while the `format` half never fires. These
// cases are the pin that it fires now.
describe('json_schema — `format` is actually enforced (#5029)', () => {
  const withSchema = (schema: Record<string, unknown>) => ({
    validations: [
      { type: 'json_schema' as const, name: 'cfg', message: 'Config does not match schema.', field: 'config', schema },
    ],
  });

  const EMAIL = withSchema({
    type: 'object',
    properties: { email: { type: 'string', format: 'email' } },
    required: ['email'],
  });

  it('rejects a value that violates `format: email`', () => {
    // The issue's exact repro. Before the plugin was registered this write
    // sailed through — `type: 'string'` and `required` both held.
    expect(() => evaluateValidationRules(EMAIL, { config: { email: 'not-an-email' } }, 'insert')).toThrow(
      ValidationError,
    );
  });

  it('accepts a valid address, and still speaks the json_schema violation code', () => {
    expect(() => evaluateValidationRules(EMAIL, { config: { email: 'ops@objectstack.ai' } }, 'insert')).not.toThrow();
    try {
      evaluateValidationRules(EMAIL, { config: { email: 'not-an-email' } }, 'insert');
      throw new Error('expected throw');
    } catch (e) {
      // A format failure is a schema violation like any other — it must not
      // invent a new error code or a new field.
      expect((e as ValidationError).fields[0].code).toBe('json_schema_violation');
      expect((e as ValidationError).fields[0].field).toBe('config');
    }
  });

  it('enforces the other formats authors actually reach for — uuid, date-time, uri', () => {
    // The DEFAULT (full) `ajv-formats` set, deliberately: `fast` mode trades
    // correctness for speed on exactly these, and a format that "mostly"
    // matches is the same declared ≠ enforced defect with a smaller hole.
    const rich = withSchema({
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        at: { type: 'string', format: 'date-time' },
        site: { type: 'string', format: 'uri' },
      },
    });
    const ok = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      at: '2026-08-04T10:00:00Z',
      site: 'https://objectstack.ai/docs',
    };
    expect(() => evaluateValidationRules(rich, { config: ok }, 'insert')).not.toThrow();
    for (const bad of [{ id: 'nope' }, { at: 'yesterday' }, { site: 'not a uri' }]) {
      expect(() => evaluateValidationRules(rich, { config: { ...ok, ...bad } }, 'insert'), JSON.stringify(bad)).toThrow(
        ValidationError,
      );
    }
  });

  it('enforces a format nested behind $ref, and inside an array item', () => {
    // The keyword is registered on the shared instance, so it reaches every
    // sub-schema — not merely a top-level property. Worth pinning: a plugin
    // registered per-compile-call would pass the flat case and fail this one.
    const nested = withSchema({
      $defs: { contact: { type: 'object', properties: { email: { type: 'string', format: 'email' } }, required: ['email'] } },
      type: 'object',
      properties: { contacts: { type: 'array', items: { $ref: '#/$defs/contact' } } },
    });
    expect(() =>
      evaluateValidationRules(nested, { config: { contacts: [{ email: 'a@b.com' }] } }, 'insert'),
    ).not.toThrow();
    expect(() =>
      evaluateValidationRules(nested, { config: { contacts: [{ email: 'a@b.com' }, { email: 'nope' }] } }, 'insert'),
    ).toThrow(ValidationError);
  });

  it('enforces `format` through a JSON STRING value too', () => {
    // `checkJsonSchema` parses a string field before validating, so the string
    // path must not be a way round the new enforcement.
    expect(() => evaluateValidationRules(EMAIL, { config: '{"email":"a@b.com"}' }, 'insert')).not.toThrow();
    expect(() => evaluateValidationRules(EMAIL, { config: '{"email":"nope"}' }, 'insert')).toThrow(ValidationError);
  });

  it('DOCUMENTS the residual gap: a misspelled format name is still ignored', () => {
    // Not the behaviour we want; it is the behaviour we have, and #5029
    // deliberately did not change it. `strict: false` is what lets an
    // author-written schema carry vendor keywords (the reason it is set), and
    // the same setting downgrades an unrecognised format to a logged line. So
    // `format: 'emial'` compiles and enforces nothing — filed separately as an
    // authoring-time question. Pinned here so the gap is a RECORD, not a
    // surprise, and so flipping it is a deliberate act that turns this red.
    const typo = withSchema({ type: 'object', properties: { email: { type: 'string', format: 'emial' } } });
    expect(() => evaluateValidationRules(typo, { config: { email: 'not-an-email' } }, 'insert')).not.toThrow();
    // …while the neighbouring keywords in the very same schema still bite, which
    // is exactly what made the pre-#5029 defect read as "working".
    const mixed = withSchema({
      type: 'object',
      properties: { email: { type: 'string', format: 'emial' } },
      required: ['email'],
    });
    expect(() => evaluateValidationRules(mixed, { config: {} }, 'insert')).toThrow(ValidationError);
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

  // #4649 — was "fails open". Neither branch ran, so the guard the author
  // declared did not happen; that must not read as a pass.
  it('fails CLOSED on an un-evaluable when predicate (#4649)', () => {
    const broken = { validations: [{ ...schema.validations[0], when: { dialect: 'cel', source: 'this is (( not valid' } }] };
    expect(() => evaluateValidationRules(broken, { account_type: 'enterprise', approver: null }, 'insert'))
      .toThrow(/could not be evaluated/);
  });

  // The outer conditional's severity still governs an unevaluable `when` — an
  // advisory guard stays advisory even when it is broken.
  it('an un-evaluable when on a warning-severity conditional does not block', () => {
    const broken = {
      validations: [{
        ...schema.validations[0],
        severity: 'warning' as const,
        when: { dialect: 'cel', source: 'this is (( not valid' },
      }],
    };
    expect(() => evaluateValidationRules(broken, { account_type: 'enterprise', approver: null }, 'insert'))
      .not.toThrow();
  });
});

/**
 * #3957 — this evaluator's BUILT-IN messages had the same defect as the field
 * validator's: hardcoded English with the API field name. An author-written
 * `rule.message` is untouched (it is already in the author's language); only
 * the platform's own sentences are localized.
 */
describe('evaluateValidationRules — built-in messages are localized (#3957)', () => {
  const zh = { locale: 'zh-CN', objectName: 'mes_invoice' };

  const failing = (
    schema: any,
    data: Record<string, unknown>,
    mode: 'insert' | 'update',
    opts: Record<string, unknown> = {},
  ) => {
    try {
      evaluateValidationRules(schema, data, mode, opts);
    } catch (e) {
      return (e as ValidationError).fields;
    }
    throw new Error('expected a ValidationError');
  };

  it('localizes a `requiredWhen` violation and names the field by its label', () => {
    const schema = {
      fields: {
        status: { type: 'select', label: '状态' },
        amount: { type: 'currency', label: '金额', requiredWhen: 'record.status == "sent"' },
      },
    };
    const [err] = failing(schema, { status: 'sent' }, 'insert', { messages: zh });
    expect(err.message).toBe('金额不能为空');
    expect(err).toMatchObject({ field: 'amount', code: 'required', label: '金额' });
  });

  it('localizes an option-visibility rejection', () => {
    const schema = {
      fields: {
        tier: {
          type: 'select',
          label: '等级',
          options: [
            { value: 'basic' },
            { value: 'vip', visibleWhen: 'record.approved == true' },
          ],
        },
      },
    };
    const [err] = failing(schema, { tier: 'vip', approved: false }, 'insert', { messages: zh });
    expect(err.message).toBe('等级:选项“vip”当前不可用');
    expect(err.code).toBe('invalid_option');
  });

  it('localizes the state-machine fallbacks when a rule declares no message', () => {
    const schema = {
      fields: { status: { type: 'select', label: '状态' } },
      validations: [{
        type: 'state_machine',
        name: 'lifecycle',
        message: '',
        field: 'status',
        initialStates: ['draft'],
        transitions: { draft: ['sent'], sent: ['paid'] },
      }],
    };
    expect(failing(schema, { status: 'paid' }, 'insert', { messages: zh })[0].message)
      .toBe('状态的初始状态无效:paid(允许:draft)');
    // draft → paid is not in `transitions.draft` (only `sent` is).
    expect(
      failing(schema, { status: 'paid' }, 'update', { messages: zh, previous: { status: 'draft' } })[0].message,
    ).toBe('状态不允许从 draft 变更为 paid');
  });

  /**
   * An author who wrote their own message owns the wording — localizing over it
   * would silently replace their (often already-translated) text.
   */
  it('never overrides an author-written rule message', () => {
    const schema = {
      fields: { status: { type: 'select', label: '状态' } },
      validations: [{
        type: 'state_machine',
        name: 'lifecycle',
        message: '已付款的发票不能退回草稿。',
        field: 'status',
        transitions: { paid: [] },
      }],
    };
    const [err] = failing(schema, { status: 'draft' }, 'update', {
      messages: zh,
      previous: { status: 'paid' },
    });
    expect(err.message).toBe('已付款的发票不能退回草稿。');
    // …but the field still carries its localized label for the UI.
    expect(err.label).toBe('状态');
  });

  it('renders English against the declared label when no locale is supplied', () => {
    const schema = {
      fields: {
        status: { type: 'select', label: 'Status' },
        amount: { type: 'currency', label: 'Amount', requiredWhen: 'record.status == "sent"' },
      },
    };
    expect(failing(schema, { status: 'sent' }, 'insert')[0].message).toBe('Amount is required');
  });
});
