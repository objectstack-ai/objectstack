// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { evaluateValidationRules, ValidationError } from '@objectstack/objectql';

import { Account } from '../src/objects/account.object.js';

/**
 * Verifies the Account object's declared validation rules actually enforce on
 * the write path — running the real `evaluateValidationRules` evaluator against
 * the very rules shipped in `account.object.ts`. This is the "demonstrated AND
 * verified" half of the showcase: a rule that parses but no-ops would slip past
 * the coverage test, but not this one.
 *
 * `state_machine` is already covered by objectql's own suite; here we exercise
 * the three rule types this object adds: `format`, `json_schema`, `conditional`.
 */
const schema = Account as unknown as { validations?: unknown[] };

describe('showcase Account validation rules (write-path enforcement)', () => {
  describe('format — tax_id EIN pattern', () => {
    it('rejects a malformed tax id', () => {
      expect(() => evaluateValidationRules(schema, { tax_id: '123-45' }, 'insert')).toThrow(
        ValidationError,
      );
    });

    it('accepts a well-formed EIN', () => {
      expect(() => evaluateValidationRules(schema, { tax_id: '12-3456789' }, 'insert')).not.toThrow();
    });

    it('does not fire when tax_id is absent (requiredness is not its concern)', () => {
      expect(() => evaluateValidationRules(schema, { name: 'Acme' }, 'insert')).not.toThrow();
    });
  });

  describe('json_schema — support_config shape', () => {
    it('accepts a conforming config', () => {
      expect(() =>
        evaluateValidationRules(schema, { support_config: { tier: 'premium', seats: 10 } }, 'insert'),
      ).not.toThrow();
    });

    it('rejects an unknown tier / missing required field', () => {
      expect(() =>
        evaluateValidationRules(schema, { support_config: { tier: 'gold' } }, 'insert'),
      ).toThrow(ValidationError);
      expect(() =>
        evaluateValidationRules(schema, { support_config: { seats: 3 } }, 'insert'),
      ).toThrow(ValidationError);
    });

    it('rejects additional properties (additionalProperties: false)', () => {
      expect(() =>
        evaluateValidationRules(schema, { support_config: { tier: 'standard', extra: 1 } }, 'insert'),
      ).toThrow(ValidationError);
    });
  });

  describe('conditional — churn requires a reason', () => {
    it('blocks marking an account churned without a reason', () => {
      expect(() =>
        evaluateValidationRules(schema, { status: 'churned' }, 'update', {
          previous: { status: 'active' },
        }),
      ).toThrow(ValidationError);
    });

    it('allows churning when a reason is supplied', () => {
      expect(() =>
        evaluateValidationRules(
          schema,
          { status: 'churned', churn_reason: 'Migrated to a competitor' },
          'update',
          { previous: { status: 'active' } },
        ),
      ).not.toThrow();
    });

    it('does not require a reason for non-churned accounts', () => {
      expect(() =>
        evaluateValidationRules(schema, { status: 'active' }, 'update', {
          previous: { status: 'prospect' },
        }),
      ).not.toThrow();
    });
  });
});
