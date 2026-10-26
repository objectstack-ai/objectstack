import { describe, it, expect } from 'vitest';
import {
  validateSchema,
  assertValidSchema,
  isValidSchema,
  formatValidationErrors,
} from '../../validation/schema-validator';

describe('schema-validator', () => {
  describe('validateSchema', () => {
    it('validates a minimal valid schema', () => {
      const result = validateSchema({ type: 'form' });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects schema without type', () => {
      const result = validateSchema({} as any);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    // objectui#5373 — the ADR-0049 retirement of `CRUDSchema`. These two tests
    // used to assert the OPPOSITE: that a well-formed `type: 'crud'` node was
    // VALID, and that an ill-formed one was merely warned about. Both were
    // affirmations for a type no renderer has ever registered, and they are the
    // reason the retirement had to reach this file — deleting the old branch on
    // its own would have left `crud` falling through `validateBaseSchema` to a
    // silent `valid: true`, which is a quieter version of the same defect.
    it('REFUSES `type: \'crud\'` by name — the spelling was retired, not merely unregistered', () => {
      const result = validateSchema({
        type: 'crud',
        columns: [{ name: 'id', label: 'ID' }],
        api: '/api/users',
      });
      // Not `valid === false` alone: a refusal that named nothing would satisfy
      // that too, and so would validation breaking outright.
      expect(result.valid).toBe(false);
      const refusal = result.errors.find((e) => e.code === 'RETIRED_TYPE');
      expect(refusal).toBeDefined();
      expect(refusal!.path).toBe('schema.type');
      expect(refusal!.message).toContain('`crud` was RETIRED');
      expect(refusal!.message).toContain('object-grid');
    });

    it('refuses a retired spelling nested in children, with the child\'s own path', () => {
      const result = validateSchema({
        type: 'grid',
        children: [{ type: 'button', label: 'OK' }, { type: 'crud', columns: [] }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.map((e) => e.path)).toContain('schema.children[1].type');
    });

    // COUNTER-PROBE for both refusals above. Without it, "crud is refused" is
    // equally satisfied by this validator rejecting everything — a registered
    // node type travelling the identical path must still come back valid.
    it('still accepts a registered node type in the same run', () => {
      const result = validateSchema({
        type: 'object-grid',
        objectApiName: 'account',
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates form with fields', () => {
      const result = validateSchema({
        type: 'form',
        fields: [
          { name: 'email', label: 'Email', type: 'string' },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('detects duplicate field names in forms', () => {
      const result = validateSchema({
        type: 'form',
        fields: [
          { name: 'email', label: 'Email', type: 'string' },
          { name: 'email', label: 'Email 2', type: 'string' },
        ],
      });
      const hasDuplicateWarning = [...result.errors, ...result.warnings].some(
        (e) => e.message.toLowerCase().includes('duplicate'),
      );
      expect(hasDuplicateWarning).toBe(true);
    });

    it('validates nested children', () => {
      const result = validateSchema({
        type: 'grid',
        children: [
          { type: 'button', label: 'OK' },
        ],
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('isValidSchema', () => {
    it('returns true for valid schema', () => {
      expect(isValidSchema({ type: 'form' })).toBe(true);
    });

    it('returns false for invalid schema', () => {
      expect(isValidSchema({})).toBe(false);
    });

    it('returns false for empty object', () => {
      expect(isValidSchema({} as any)).toBe(false);
    });

    it('returns false for non-object values', () => {
      expect(isValidSchema('string' as any)).toBe(false);
      expect(isValidSchema(42 as any)).toBe(false);
    });
  });

  describe('assertValidSchema', () => {
    it('does not throw for valid schema', () => {
      expect(() => assertValidSchema({ type: 'form' })).not.toThrow();
    });

    it('throws for invalid schema', () => {
      expect(() => assertValidSchema({} as any)).toThrow();
    });
  });

  describe('formatValidationErrors', () => {
    it('formats validation errors', () => {
      const result = validateSchema({} as any);
      const formatted = formatValidationErrors(result);
      expect(typeof formatted).toBe('string');
      expect(formatted.length).toBeGreaterThan(0);
    });

    it('returns empty string for valid schemas', () => {
      const result = validateSchema({ type: 'form' });
      const formatted = formatValidationErrors(result);
      expect(formatted).toBe('');
    });
  });
});
