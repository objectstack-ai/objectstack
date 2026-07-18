import { describe, it, expect } from 'vitest';
import { validateExpression, introspectScope, expectedDialect, inferExpressionType } from './validate';

describe('validateExpression (ADR-0032)', () => {
  describe('predicates (CEL)', () => {
    it('accepts a valid bare-CEL predicate', () => {
      const r = validateExpression('predicate', 'record.rating >= 4');
      expect(r.ok).toBe(true);
      expect(r.errors).toHaveLength(0);
    });

    it('rejects the #1491 brace-in-CEL form with a corrective message', () => {
      const r = validateExpression('predicate', '{record.rating} >= 4');
      expect(r.ok).toBe(false);
      expect(r.errors[0].message).toMatch(/map literal|bare reference|template brace/i);
      expect(r.errors[0].message).toContain('record.rating');
      expect(r.errors[0].source).toBe('{record.rating} >= 4');
    });

    it('rejects a CEL envelope placed in a template-only role', () => {
      const r = validateExpression('template', { dialect: 'cel', source: 'record.x' });
      expect(r.ok).toBe(false);
    });

    it('accepts an empty/absent expression (no-op)', () => {
      expect(validateExpression('predicate', '').ok).toBe(true);
      expect(validateExpression('predicate', null).ok).toBe(true);
    });

    // #1877 — a predicate calling an UNKNOWN function (e.g. `PRIOR()`, a typo'd
    // `isBlnk()`) must be rejected at build/registration, not silently accepted
    // and then no-op the flow at runtime. cel-js's type checker reports these as
    // `found no matching overload`; the engine surfaces them as an invalid CEL
    // predicate.
    it('rejects an unknown function call (#1877)', () => {
      const r = validateExpression('predicate', 'PRIOR(status) != "promoted"');
      expect(r.ok).toBe(false);
      expect(r.errors[0].message).toMatch(/invalid CEL predicate/i);
      expect(r.errors[0].message).toMatch(/overload|PRIOR/);
    });

    it('rejects an unknown function even when guarded by a short-circuit (#1877)', () => {
      const r = validateExpression('predicate', 'status == "promoted" && PRIOR(status) != "promoted"');
      expect(r.ok).toBe(false);
    });

    it('still accepts a registered stdlib function (isBlank)', () => {
      expect(validateExpression('predicate', '!isBlank(record.target_channels)').ok).toBe(true);
    });
  });

  describe('templates', () => {
    it('accepts a valid {{ path }} template', () => {
      const r = validateExpression('template', 'Hot lead: {{ record.full_name }}');
      expect(r.ok).toBe(true);
    });

    it('flags single-brace {x} in a template and suggests {{ }}', () => {
      const r = validateExpression('template', 'Hi {record.name}');
      expect(r.ok).toBe(false);
      expect(r.errors[0].message).toMatch(/\{\{ record\.name \}\}|double braces/);
    });
  });

  describe('schema-aware field existence (v1)', () => {
    it('flags an unknown record field with a did-you-mean', () => {
      const r = validateExpression('predicate', 'record.raitng >= 4', { objectName: 'crm_lead', fields: ['rating', 'status'] });
      expect(r.ok).toBe(false);
      expect(r.errors[0].message).toMatch(/unknown field `raitng`/);
      expect(r.errors[0].message).toMatch(/did you mean `rating`/);
    });

    it('passes when fields exist', () => {
      const r = validateExpression('predicate', 'record.rating >= 4 && record.status == "new"', { fields: ['rating', 'status'] });
      expect(r.ok).toBe(true);
    });

    it('skips field checks when no schema is provided', () => {
      expect(validateExpression('predicate', 'record.anything > 1').ok).toBe(true);
    });
  });

  // #1928 — a bare top-level identifier is a silent bug in a `record`-scoped
  // site (formula field / validation predicate) but correct in a `flattened`
  // flow/automation condition. The validator must distinguish by `scope`.
  describe('bare-reference detection by scope (#1928)', () => {
    it('flags a bare field reference in a record-scoped predicate', () => {
      const r = validateExpression('predicate', 'lead_score != null && lead_score > 100', { scope: 'record' });
      expect(r.ok).toBe(false);
      expect(r.errors[0].message).toMatch(/bare reference `lead_score`/);
      expect(r.errors[0].message).toMatch(/record\.lead_score/);
    });

    it('flags a bare reference in a record-scoped value (formula) expression', () => {
      const r = validateExpression('value', '(budget == null ? 0 : budget) - (spent == null ? 0 : spent)', { scope: 'record' });
      expect(r.ok).toBe(false);
      expect(r.errors[0].message).toMatch(/bare reference `(budget|spent)`/);
    });

    it('accepts the record-qualified form in a record-scoped site', () => {
      const r = validateExpression('value', '(record.budget == null ? 0 : record.budget) - (record.spent == null ? 0 : record.spent)', { scope: 'record' });
      expect(r.ok).toBe(true);
    });

    it('does NOT flag bare references in a flattened (flow) condition', () => {
      // The record's fields are flattened to top-level for flow conditions, and
      // flow variables share that namespace, so bare refs are correct here.
      expect(validateExpression('predicate', 'status == "done" && previous.status != "done"', { scope: 'flattened' }).ok).toBe(true);
      expect(validateExpression('predicate', 'budget > 100000', { scope: 'flattened' }).ok).toBe(true);
      expect(validateExpression('predicate', 'expiring_deals.length > 0', { scope: 'flattened' }).ok).toBe(true);
    });

    it('defaults to flattened scope (no bare-ref flag) when scope is unset', () => {
      expect(validateExpression('predicate', 'status == "done"').ok).toBe(true);
    });

    it('does not flag a null-guard on a record-qualified field (no type false-positive)', () => {
      expect(validateExpression('predicate', 'record.lead_score != null && record.lead_score > 100', { scope: 'record' }).ok).toBe(true);
    });
  });

  // #1928 tier 3 — flattened flow conditions reference fields bare, so a bare
  // ref is not an error. A bare NON-field that is a near-miss of a known field
  // is a likely typo → non-blocking warning (ok stays true).
  describe('flow-condition typo warnings (#1928 tier 3)', () => {
    const fields = ['stage', 'amount', 'status'] as const;

    it('warns (does not error) on a likely field typo in a flattened condition', () => {
      const r = validateExpression('predicate', 'stagee == "closed_won"', { objectName: 'crm_opportunity', fields, scope: 'flattened' });
      expect(r.ok).toBe(true);
      expect(r.errors).toHaveLength(0);
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0].message).toMatch(/`stagee` is not a field/);
      expect(r.warnings[0].message).toMatch(/did you mean `stage`/);
    });

    it('does not warn on a correct bare field reference', () => {
      const r = validateExpression('predicate', 'stage == "closed_won" && previous.stage != "closed_won"', { objectName: 'crm_opportunity', fields, scope: 'flattened' });
      expect(r.ok).toBe(true);
      expect(r.warnings).toHaveLength(0);
    });

    it('does not warn on a flow variable that is far from any field name', () => {
      const r = validateExpression('predicate', 'expiring_deals.length > 0', { objectName: 'crm_opportunity', fields, scope: 'flattened' });
      expect(r.ok).toBe(true);
      expect(r.warnings).toHaveLength(0);
    });

    it('emits no warnings without a field list (nothing to compare against)', () => {
      const r = validateExpression('predicate', 'stagee == "x"', { scope: 'flattened' });
      expect(r.ok).toBe(true);
      expect(r.warnings).toHaveLength(0);
    });
  });

  // #1928 tier 4 — a text/boolean field used with an arithmetic or ordering
  // operator against a number faults at runtime (silent null). With per-field
  // types the validator surfaces this as a NON-blocking warning, and — the
  // design law — never flags a case the runtime tolerates (number/date fields,
  // equality, string concat, null-guards).
  describe('type-soundness warnings (#1928 tier 4)', () => {
    const schema = {
      objectName: 'crm_opportunity',
      fields: ['name', 'amount', 'is_active', 'due', 'priority', 'title'] as const,
      fieldTypes: {
        name: 'text', title: 'textarea', amount: 'currency',
        is_active: 'boolean', due: 'date', priority: 'select',
      },
      scope: 'record',
    } as const;

    it('warns (does not error) on a text field used in arithmetic against a number', () => {
      const r = validateExpression('value', 'record.name * 2', schema);
      expect(r.ok).toBe(true);
      expect(r.errors).toHaveLength(0);
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0].message).toMatch(/type mismatch/i);
      expect(r.warnings[0].message).toMatch(/record\.name/);
      expect(r.warnings[0].message).toMatch(/evaluates to null/);
    });

    it('warns on a text field ordered against a number', () => {
      const r = validateExpression('predicate', 'record.title >= 5', schema);
      expect(r.ok).toBe(true);
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0].message).toMatch(/record\.title/);
    });

    it('warns on a boolean field used in arithmetic (always faults at runtime)', () => {
      const r = validateExpression('value', 'record.is_active + 1', schema);
      expect(r.ok).toBe(true);
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0].message).toMatch(/boolean/i);
      expect(r.warnings[0].message).toMatch(/record\.is_active/);
    });

    it('does NOT warn on number/currency arithmetic with an int literal (#1930 runtime fix)', () => {
      // currency → dyn, so `amount / 100`, `amount * 2 - 50` never fault.
      expect(validateExpression('value', 'record.amount / 100', schema).warnings).toHaveLength(0);
      expect(validateExpression('value', 'record.amount * 2 - 50', schema).warnings).toHaveLength(0);
    });

    it('does NOT warn on a date field with an ORDERING comparison (they hydrate at runtime)', () => {
      // Ordering ops fault → the engine's string-hydration retry fires → they work.
      // (Equality `==`/`!=` does NOT — that is the #3183 silent-miss, covered in its
      // own block below; this tier-4 check leaves it to the #3183 guardrail.)
      expect(validateExpression('predicate', 'record.due <= daysFromNow(30)', schema).warnings).toHaveLength(0);
      expect(validateExpression('predicate', 'record.due >= today()', schema).warnings).toHaveLength(0);
    });

    it('does NOT warn on a select field ordered against a number (option values may be numeric codes)', () => {
      // select → dyn, so `priority >= 3` (a numeric-coded picklist) is not flagged.
      expect(validateExpression('predicate', 'record.priority >= 3', schema).warnings).toHaveLength(0);
    });

    it('does NOT warn on heterogeneous equality (runtime-safe, returns false)', () => {
      expect(validateExpression('predicate', 'record.name == 5', schema).warnings).toHaveLength(0);
      expect(validateExpression('predicate', 'record.name != 5', schema).warnings).toHaveLength(0);
    });

    it('does NOT warn on string concatenation or a null-guard', () => {
      expect(validateExpression('value', 'record.name + record.title', schema).warnings).toHaveLength(0);
      expect(validateExpression('predicate', 'record.amount != null && record.amount > 0', schema).warnings).toHaveLength(0);
    });

    it('does not run without field types', () => {
      // No fieldTypes → nothing to check.
      expect(validateExpression('value', 'record.name * 2', { objectName: 'crm_opportunity', fields: schema.fields, scope: 'record' }).warnings).toHaveLength(0);
    });
  });

  // #1928 tier 4 (flattened) — the same soundness check for bare-field flow /
  // automation conditions. Fields are bound bare (`status - 1`); flow variables
  // stay `dyn` and are never flagged.
  describe('type-soundness warnings — flattened flow conditions (#1928 tier 4)', () => {
    const schema = {
      objectName: 'crm_opportunity',
      fields: ['stage', 'amount', 'is_active', 'title'] as const,
      fieldTypes: { stage: 'select', amount: 'currency', is_active: 'boolean', title: 'text' },
      scope: 'flattened',
    } as const;

    it('warns on a bare text field used in arithmetic against a number', () => {
      const r = validateExpression('predicate', 'title - 1 > 0', schema);
      expect(r.ok).toBe(true);
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0].message).toMatch(/type mismatch/i);
      // Bare form — not `record.title`.
      expect(r.warnings[0].message).toMatch(/`title`/);
      expect(r.warnings[0].message).not.toMatch(/record\.title/);
    });

    it('warns on a bare boolean field used in arithmetic', () => {
      const r = validateExpression('predicate', 'is_active + 1 > 0', schema);
      expect(r.ok).toBe(true);
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0].message).toMatch(/boolean/i);
    });

    it('does NOT flag a flow variable (unlisted → dyn) or number/date fields', () => {
      // `expiring_count` is not a schema field → dyn → no fault.
      expect(validateExpression('predicate', 'expiring_count * 2 > 10', schema).warnings).toHaveLength(0);
      expect(validateExpression('predicate', 'amount / 100 > 5', schema).warnings).toHaveLength(0);
    });

    it('does NOT flag a correct bare condition, equality, or a select comparison', () => {
      expect(validateExpression('predicate', 'stage == "closed_won" && amount > 1000', schema).warnings).toHaveLength(0);
      expect(validateExpression('predicate', 'title == "VIP"', schema).warnings).toHaveLength(0);
    });
  });

  describe('introspection', () => {
    it('reports the dialect + scope for a field role', () => {
      expect(expectedDialect('predicate')).toBe('cel');
      expect(expectedDialect('template')).toBe('template');
      const scope = introspectScope('predicate', { fields: ['rating'] });
      expect(scope.dialect).toBe('cel');
      expect(scope.fields).toContain('rating');
      expect(scope.roots).toContain('record');
      expect(scope.functions).toContain('daysFromNow');
    });
  });
});

describe('inferExpressionType — coarse value-type of a formula', () => {
  // The host object's fields, so a bare `<field>` reference resolves the same as
  // `record.<field>` (a stored formula may be written either way).
  const fields = ['start_date', 'end_date', 'amount', 'rate', 'first', 'last', 'name', 'items'];

  it('infers number for a computed-number formula (the leave_days repro)', () => {
    // daysBetween(...): int, int + 1 → int → number. The exact case a "total
    // leave days" dashboard card needs a SUM measure derived for.
    expect(inferExpressionType('daysBetween(start_date, end_date) + 1', { fields })).toBe('number');
    expect(inferExpressionType('daysBetween(record.start_date, record.end_date) + 1')).toBe('number');
    expect(inferExpressionType('amount * 0.1', { fields })).toBe('number'); // dyn * double → double
    expect(inferExpressionType('round(amount)', { fields })).toBe('number');
    expect(inferExpressionType('len(items)', { fields })).toBe('number');
  });

  it('accepts the canonical Expression envelope as input', () => {
    expect(inferExpressionType({ dialect: 'cel', source: 'amount * 0.1' }, { fields })).toBe('number');
  });

  it('infers text / boolean / date for non-numeric formulas', () => {
    expect(inferExpressionType('upper(name)', { fields })).toBe('text');
    expect(inferExpressionType('rate >= 0.5', { fields })).toBe('boolean');
    expect(inferExpressionType('today()')).toBe('date');
  });

  it('is conservative — an ambiguous (dyn) result is unknown, never number', () => {
    // `first + last` could be string concatenation OR numeric addition; with two
    // untyped operands cel-js yields `dyn`, so we must NOT call it a number (else
    // a dataset would SUM a text formula). This is the safety property.
    expect(inferExpressionType('first + last', { fields })).toBe('unknown');
    expect(inferExpressionType('amount + rate', { fields })).toBe('unknown');
  });

  it('returns unknown for empty, absent, or un-type-checkable expressions', () => {
    expect(inferExpressionType('')).toBe('unknown');
    expect(inferExpressionType(null)).toBe('unknown');
    expect(inferExpressionType(undefined)).toBe('unknown');
    expect(inferExpressionType('no_such_fn(amount)', { fields })).toBe('unknown'); // no overload
    expect(inferExpressionType('undeclared_field + 1')).toBe('unknown'); // bare ref, no fields given
  });
});
