import { describe, it, expect } from 'vitest';
import { validateExpression, introspectScope, expectedDialect } from './validate';

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
