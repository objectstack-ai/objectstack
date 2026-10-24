/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/core - Object Validation Engine Tests
 *
 * The engine is a CLIENT PRE-CHECK of the rules the server evaluates in
 * `objectql/src/validation/rule-validator.ts`. Every expectation below is
 * anchored to what the server does with the same rule, because the failure mode
 * that matters is DISAGREEMENT: a pre-check that greenlights a write the server
 * rejects loses the user their client-side check, and one that rejects a write
 * the server accepts blocks work outright.
 *
 * The `#3103 regression` blocks pin the behaviours that were broken while the
 * rule types were hand-written copies claiming spec canonicity.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectValidationEngine } from '../validators/object-validation-engine';
import type {
  ScriptValidation,
  UniquenessValidation,
  StateMachineValidation,
  CrossFieldValidation,
  AsyncValidation,
  ConditionalValidation,
  FormatValidation,
  RangeValidation,
  ObjectValidationRule,
} from '@object-ui/types';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ObjectValidationEngine', () => {
  describe('predicate polarity (script / cross_field)', () => {
    // The server's contract: "if the predicate evaluates TRUE the rule is
    // violated" (rule-validator.ts `checkPredicate`). The hand-written engine
    // had this exactly backwards, so every spec-authored rule produced the
    // opposite verdict to the server's.
    const rule: ScriptValidation = {
      type: 'script',
      name: 'amount_must_not_be_negative',
      label: 'Amount check',
      severity: 'error',
      message: 'Amount must not be negative',
      condition: 'amount < 0',
    };

    it('reports a violation when the failure predicate is TRUE', async () => {
      const engine = new ObjectValidationEngine();
      const results = await engine.validateRecord([rule], { record: { amount: -5 } }, 'insert');

      expect(results).toHaveLength(1);
      expect(results[0].message).toBe('Amount must not be negative');
      expect(results[0].rule).toBe('amount_must_not_be_negative');
      expect(results[0].severity).toBe('error');
    });

    it('passes when the failure predicate is FALSE', async () => {
      const engine = new ObjectValidationEngine();
      const results = await engine.validateRecord([rule], { record: { amount: 5 } }, 'insert');

      expect(results).toHaveLength(0);
    });

    it('applies the same polarity to cross_field', async () => {
      const engine = new ObjectValidationEngine();
      const crossField: CrossFieldValidation = {
        type: 'cross_field',
        name: 'end_after_start',
        severity: 'error',
        message: 'End date must be after start date',
        condition: 'end_date < start_date',
        fields: ['end_date', 'start_date'],
      };

      const bad = await engine.validateRecord(
        [crossField],
        { record: { start_date: '2026-02-01', end_date: '2026-01-01' } },
        'insert'
      );
      const good = await engine.validateRecord(
        [crossField],
        { record: { start_date: '2026-01-01', end_date: '2026-02-01' } },
        'insert'
      );

      expect(bad).toHaveLength(1);
      expect(good).toHaveLength(0);
    });
  });

  describe('#3103 regression — ExpressionInput envelope conditions', () => {
    // `condition` is `string | { dialect, source }` on the wire. The old engine
    // typed it `string` and handed the object straight to the evaluator, where
    // `expression.trim()` threw; the catch turned that into `false`, which under
    // the old polarity meant "validation passes" — a silent no-op on a rule the
    // server was enforcing.
    it('evaluates an envelope-valued condition instead of silently passing', async () => {
      const engine = new ObjectValidationEngine();
      const rule: ScriptValidation = {
        type: 'script',
        name: 'amount_must_not_be_negative',
        severity: 'error',
        message: 'Amount must not be negative',
        condition: { dialect: 'cel', source: 'amount < 0' },
      };

      const violated = await engine.validateRecord([rule], { record: { amount: -5 } }, 'insert');
      const clean = await engine.validateRecord([rule], { record: { amount: 5 } }, 'insert');

      expect(violated).toHaveLength(1);
      expect(violated[0].message).toBe('Amount must not be negative');
      expect(clean).toHaveLength(0);
    });

    it('evaluates an envelope-valued `when` on a conditional', async () => {
      const engine = new ObjectValidationEngine();
      const rule: ConditionalValidation = {
        type: 'conditional',
        name: 'company_needs_name',
        severity: 'error',
        message: 'Company validation',
        when: { dialect: 'cel', source: 'is_company == true' },
        then: {
          type: 'script',
          name: 'company_name_required',
          severity: 'error',
          message: 'Company name is required',
          condition: 'company_name == null',
        },
      };

      const results = await engine.validateRecord(
        [rule],
        { record: { is_company: true, company_name: null } },
        'insert'
      );

      expect(results).toHaveLength(1);
      expect(results[0].message).toBe('Company name is required');
    });

    it('fails OPEN on an envelope with nothing evaluable, and says so', async () => {
      // An `ast`-only envelope, or a non-CEL dialect, is a BROKEN rule — the
      // server logs and skips it rather than rejecting the write. Loud, not
      // silent: the warning is what tells a developer the pre-check abstained.
      //
      // The spec now splits those two spellings, so this test pins them
      // differently — and what it pins CHANGED, deliberately.
      //
      // A non-CEL dialect stays AUTHORABLE: `condition` takes the whole
      // `ExpressionDialect` enum, and `cron` / `template` are not predicates,
      // so that spelling is written through the typed slot as before.
      //
      // An `ast`-only envelope is no longer authorable HERE. objectstack's
      // `evaluated-expression-slots-source-required` migration narrowed every
      // EVALUATED slot — this `condition` among them — from
      // `ExpressionInputSchema` to `EvaluatedExpressionInputSchema`, where
      // `source` is required and non-blank, because the engine evaluates
      // `source` and cannot run an `ast` alone. The PERSISTENCE union
      // (`ExpressionInputSchema`) is deliberately not narrowed by that same
      // ruling, so the shape still travels on the wire and still reaches this
      // reader — which is why it is still pinned, but as wire data, through a
      // cast that says so.
      //
      // It is NOT repaired by inventing a `source` beside the `ast`: this AST
      // is synthetic (`args: []` carries no operands), so no text was ever
      // parsed into it, and the migration's own recovery — `printCelAst(ast)`
      // — answers `null` rather than a guess for an AST it cannot round-trip.
      // A `source` written here would satisfy the type and lie about the value.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const engine = new ObjectValidationEngine();
      // Authorable: a dialect the CEL evaluator does not run.
      const nonCelDialect: ScriptValidation = {
        type: 'script',
        name: 'cron_dialect',
        severity: 'error',
        message: 'should never be reported',
        condition: { dialect: 'cron', source: '0 9 * * 1-5' },
      };
      // Wire-only: refused by the narrowed slot, still carried by persistence.
      const astOnly: ScriptValidation = {
        type: 'script',
        name: 'ast_only',
        severity: 'error',
        message: 'should never be reported',
        condition: { dialect: 'cel', ast: { op: '<', args: [] } } as unknown as
          ScriptValidation['condition'],
      };

      const results = await engine.validateRecord(
        [nonCelDialect, astOnly],
        { record: { amount: -5 } },
        'insert'
      );

      expect(results).toHaveLength(0);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('cron_dialect'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('ast_only'));
    });

    it('binds both the spec`s `record.x` scope and objectui`s bare `x`', async () => {
      // The server binds `{ record, previous }`, so spec-authored predicates read
      // `record.amount`. Passing only the raw record — as the old engine did —
      // left `record.amount` resolving to undefined, i.e. another silent no-op.
      const engine = new ObjectValidationEngine();
      const specStyle: ScriptValidation = {
        type: 'script',
        name: 'spec_style',
        severity: 'error',
        message: 'negative',
        condition: 'record.amount < 0',
      };

      const results = await engine.validateRecord([specStyle], { record: { amount: -5 } }, 'insert');
      expect(results).toHaveLength(1);
    });
  });

  describe('#3103 regression — spec defaults are defaults, not falsy reads', () => {
    it('runs a rule that omits `active` (spec default: true)', async () => {
      // `/meta` ships authored metadata, so `active` is usually absent. Reading
      // absent as "off" silently disabled every rule authored without it.
      const engine = new ObjectValidationEngine();
      const rule = {
        type: 'script',
        name: 'no_active_key',
        message: 'Amount must not be negative',
        condition: 'amount < 0',
      } as ScriptValidation;

      const results = await engine.validateRecord([rule], { record: { amount: -5 } }, 'insert');
      expect(results).toHaveLength(1);
    });

    it('runs a rule that omits `events` (spec default: insert + update)', async () => {
      const engine = new ObjectValidationEngine();
      const rule = {
        type: 'script',
        name: 'no_events_key',
        message: 'Amount must not be negative',
        condition: 'amount < 0',
      } as ScriptValidation;

      for (const event of ['insert', 'update'] as const) {
        const results = await engine.validateRecord([rule], { record: { amount: -5 } }, event);
        expect(results, `event '${event}'`).toHaveLength(1);
      }
    });

    it('still honours an explicit `active: false`', async () => {
      const engine = new ObjectValidationEngine();
      const rule: ScriptValidation = {
        type: 'script',
        name: 'disabled',
        active: false,
        message: 'Amount must not be negative',
        condition: 'amount < 0',
      };

      const results = await engine.validateRecord([rule], { record: { amount: -5 } }, 'insert');
      expect(results).toHaveLength(0);
    });

    it('still honours an explicit `events` list', async () => {
      const engine = new ObjectValidationEngine();
      const rule: ScriptValidation = {
        type: 'script',
        name: 'insert_only',
        events: ['insert'],
        message: 'Amount must not be negative',
        condition: 'amount < 0',
      };

      expect(await engine.validateRecord([rule], { record: { amount: -5 } }, 'insert')).toHaveLength(1);
      expect(await engine.validateRecord([rule], { record: { amount: -5 } }, 'update')).toHaveLength(0);
    });

    it('evaluates rules in `priority` order (lower first, stable)', async () => {
      const engine = new ObjectValidationEngine();
      const mk = (name: string, priority?: number): ScriptValidation => ({
        type: 'script',
        name,
        priority,
        message: name,
        condition: 'amount < 0',
      });

      // Authored out of order, with one rule leaving `priority` at its default.
      const rules = [mk('last', 900), mk('defaulted'), mk('first', 1)];
      const results = await engine.validateRecord(rules, { record: { amount: -5 } }, 'insert');

      expect(results.map((r) => r.rule)).toEqual(['first', 'defaulted', 'last']);
    });
  });

  describe('#3103 regression — conditional is when / then / otherwise', () => {
    const rule: ConditionalValidation = {
      type: 'conditional',
      name: 'regional_compliance',
      severity: 'error',
      message: 'Regional compliance',
      when: 'region == "EU"',
      then: {
        type: 'script',
        name: 'gdpr_consent',
        severity: 'error',
        message: 'GDPR consent is required for EU customers',
        condition: 'gdpr_consent_given == false',
      },
      otherwise: {
        type: 'script',
        name: 'tos_acceptance',
        severity: 'error',
        message: 'Terms of Service acceptance required',
        condition: 'tos_accepted == false',
      },
    };

    it('takes the `then` branch when `when` is TRUE', async () => {
      const engine = new ObjectValidationEngine();
      const results = await engine.validateRecord(
        [rule],
        { record: { region: 'EU', gdpr_consent_given: false, tos_accepted: true } },
        'insert'
      );

      expect(results).toHaveLength(1);
      expect(results[0].message).toBe('GDPR consent is required for EU customers');
    });

    it('takes the `otherwise` branch when `when` is FALSE', async () => {
      // The old shape had no else-branch at all: `rules[]` only ever ran on the
      // true side, so an `otherwise` authored against the spec was dropped.
      const engine = new ObjectValidationEngine();
      const results = await engine.validateRecord(
        [rule],
        { record: { region: 'US', gdpr_consent_given: false, tos_accepted: false } },
        'insert'
      );

      expect(results).toHaveLength(1);
      expect(results[0].message).toBe('Terms of Service acceptance required');
    });

    it('passes when the selected branch is satisfied', async () => {
      const engine = new ObjectValidationEngine();
      const results = await engine.validateRecord(
        [rule],
        { record: { region: 'EU', gdpr_consent_given: true, tos_accepted: false } },
        'insert'
      );

      expect(results).toHaveLength(0);
    });

    it('skips a branch whose own `active` is false', async () => {
      const engine = new ObjectValidationEngine();
      const withInactiveBranch: ConditionalValidation = {
        ...rule,
        then: { ...(rule.then as ScriptValidation), active: false },
      };

      const results = await engine.validateRecord(
        [withInactiveBranch],
        { record: { region: 'EU', gdpr_consent_given: false } },
        'insert'
      );

      expect(results).toHaveLength(0);
    });

    it('nests', async () => {
      const engine = new ObjectValidationEngine();
      const nested: ConditionalValidation = {
        type: 'conditional',
        name: 'country_state',
        message: 'US validation',
        when: 'country == "US"',
        then: {
          type: 'conditional',
          name: 'california',
          message: 'California validation',
          when: 'state == "CA"',
          then: {
            type: 'script',
            name: 'ca_tax_id_required',
            message: 'California requires a tax ID',
            condition: 'tax_id == null',
          },
        },
      };

      const hit = await engine.validateRecord(
        [nested],
        { record: { country: 'US', state: 'CA', tax_id: null } },
        'insert'
      );
      const miss = await engine.validateRecord(
        [nested],
        { record: { country: 'US', state: 'NV', tax_id: null } },
        'insert'
      );

      expect(hit).toHaveLength(1);
      expect(hit[0].message).toBe('California requires a tax ID');
      expect(miss).toHaveLength(0);
    });
  });

  describe('#3103 regression — format is `regex`, not `pattern`', () => {
    it('checks a spec-authored `regex` instead of throwing a false violation', async () => {
      // The old engine read `rule.pattern`; against a spec-authored rule that was
      // `undefined`, `undefined.test(...)` threw, and the catch reported a
      // VIOLATION — the client blocking a write the server accepts.
      const engine = new ObjectValidationEngine();
      const rule: FormatValidation = {
        type: 'format',
        name: 'code_shape',
        severity: 'error',
        message: 'Code must be three capitals',
        field: 'code',
        regex: '^[A-Z]{3}$',
      };

      expect(await engine.validateRecord([rule], { record: { code: 'ABC' } }, 'insert')).toHaveLength(0);

      const bad = await engine.validateRecord([rule], { record: { code: 'abc' } }, 'insert');
      expect(bad).toHaveLength(1);
      expect(bad[0].message).toBe('Code must be three capitals');
    });

    it.each([
      ['email', 'user@example.com', 'not-an-email'],
      ['url', 'https://example.com/x', 'not a url'],
      ['phone', '+1 (555) 123-4567', 'abc'],
      ['json', '{"a":1}', '{oops'],
    ] as const)('implements the named format `%s`', async (format, valid, invalid) => {
      const engine = new ObjectValidationEngine();
      const rule: FormatValidation = {
        type: 'format',
        name: `${format}_shape`,
        message: `Invalid ${format}`,
        field: 'value',
        format,
      };

      expect(await engine.validateRecord([rule], { record: { value: valid } }, 'insert')).toHaveLength(0);
      expect(await engine.validateRecord([rule], { record: { value: invalid } }, 'insert')).toHaveLength(1);
    });

    it('skips an absent or empty value rather than calling it a bad format', async () => {
      // Requiredness and type-shape are the field-level validator's job, so
      // neither an absent field nor a blank value is a FORMAT violation — the
      // server draws the same line.
      //
      // Note the engine keeps the server's `field in record` guard as well, but
      // it is defensive rather than load-bearing here: objectui validates a
      // record snapshot where the server validates a patch payload, so "absent"
      // already collapses into "undefined" and the empty-value check catches it.
      // Deleting that guard leaves this suite green — it is retained for
      // structural parity with `rule-validator.ts`, not claimed as a gate.
      const engine = new ObjectValidationEngine();
      const rule: FormatValidation = {
        type: 'format',
        name: 'email_shape',
        message: 'Invalid email',
        field: 'email',
        format: 'email',
      };

      expect(await engine.validateRecord([rule], { record: { name: 'x' } }, 'insert')).toHaveLength(0);
      expect(await engine.validateRecord([rule], { record: { email: '' } }, 'insert')).toHaveLength(0);
      expect(await engine.validateRecord([rule], { record: { email: null } }, 'insert')).toHaveLength(0);
    });

    it('fails OPEN on a regex that will not compile', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const engine = new ObjectValidationEngine();
      const rule: FormatValidation = {
        type: 'format',
        name: 'broken_regex',
        message: 'should never be reported',
        field: 'code',
        regex: '([unclosed',
      };

      expect(await engine.validateRecord([rule], { record: { code: 'x' } }, 'insert')).toHaveLength(0);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('broken_regex'));
    });

    it('applies both `regex` and `format` when both are declared', async () => {
      const engine = new ObjectValidationEngine();
      const rule: FormatValidation = {
        type: 'format',
        name: 'corp_email',
        message: 'Must be a corporate email',
        field: 'email',
        format: 'email',
        regex: '@example\\.com$',
      };

      expect(
        await engine.validateRecord([rule], { record: { email: 'a@example.com' } }, 'insert')
      ).toHaveLength(0);
      // Valid email, wrong domain → the regex half rejects it.
      expect(
        await engine.validateRecord([rule], { record: { email: 'a@other.com' } }, 'insert')
      ).toHaveLength(1);
    });
  });

  describe('StateMachineValidation', () => {
    const rule: StateMachineValidation = {
      type: 'state_machine',
      name: 'order_status',
      severity: 'error',
      message: 'Invalid status transition',
      field: 'status',
      transitions: {
        pending: ['processing', 'cancelled'],
        processing: ['shipped', 'cancelled'],
        shipped: ['delivered'],
      },
    };

    it('allows a declared transition', async () => {
      const engine = new ObjectValidationEngine();
      const results = await engine.validateRecord(
        [rule],
        { record: { status: 'processing' }, oldRecord: { status: 'pending' } },
        'update'
      );
      expect(results).toHaveLength(0);
    });

    it('rejects an undeclared transition', async () => {
      const engine = new ObjectValidationEngine();
      const results = await engine.validateRecord(
        [rule],
        { record: { status: 'delivered' }, oldRecord: { status: 'pending' } },
        'update'
      );
      expect(results).toHaveLength(1);
      expect(results[0].message).toBe('Invalid status transition');
    });

    it('is a no-op when the write does not touch the state field', async () => {
      const engine = new ObjectValidationEngine();
      const results = await engine.validateRecord(
        [rule],
        { record: { note: 'edited' }, oldRecord: { status: 'pending' } },
        'update'
      );
      expect(results).toHaveLength(0);
    });

    it('is a no-op when the state is unchanged', async () => {
      const engine = new ObjectValidationEngine();
      const results = await engine.validateRecord(
        [rule],
        { record: { status: 'pending' }, oldRecord: { status: 'pending' } },
        'update'
      );
      expect(results).toHaveLength(0);
    });

    it('leaves an undeclared from-state unconstrained (lenient)', async () => {
      const engine = new ObjectValidationEngine();
      const results = await engine.validateRecord(
        [rule],
        { record: { status: 'pending' }, oldRecord: { status: 'archived' } },
        'update'
      );
      expect(results).toHaveLength(0);
    });

    describe('#3103 regression — initialStates (objectstack#3165)', () => {
      const withInitial: StateMachineValidation = { ...rule, initialStates: ['pending'] };

      it('rejects an insert that starts mid-flow', async () => {
        // Without this the FSM has no entry point: a `select` field admits any
        // declared option, so a record can be created already `shipped`.
        const engine = new ObjectValidationEngine();
        const results = await engine.validateRecord(
          [withInitial],
          { record: { status: 'shipped' } },
          'insert'
        );
        expect(results).toHaveLength(1);
      });

      it('allows an insert at a declared initial state', async () => {
        const engine = new ObjectValidationEngine();
        const results = await engine.validateRecord(
          [withInitial],
          { record: { status: 'pending' } },
          'insert'
        );
        expect(results).toHaveLength(0);
      });

      it('leaves insert unconstrained when no initialStates are declared', async () => {
        const engine = new ObjectValidationEngine();
        const results = await engine.validateRecord([rule], { record: { status: 'shipped' } }, 'insert');
        expect(results).toHaveLength(0);
      });

      it('leaves an absent or empty state to required-validation', async () => {
        const engine = new ObjectValidationEngine();
        expect(
          await engine.validateRecord([withInitial], { record: { note: 'x' } }, 'insert')
        ).toHaveLength(0);
        expect(
          await engine.validateRecord([withInitial], { record: { status: '' } }, 'insert')
        ).toHaveLength(0);
      });
    });
  });

  describe('an unimplemented rule type is loud, not silently valid', () => {
    it('warns for the spec`s `json_schema`, which this engine does not evaluate', async () => {
      // Reporting it as valid would let the pre-check green-light a record the
      // server is about to reject, with nothing to explain the disagreement.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const engine = new ObjectValidationEngine();
      const rule = {
        type: 'json_schema',
        name: 'payload_shape',
        message: 'Bad payload',
        field: 'payload',
        schema: { type: 'object' },
      } as unknown as ObjectValidationRule;

      const results = await engine.validateRecord([rule], { record: { payload: {} } }, 'insert');

      expect(results).toHaveLength(0);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('json_schema'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('payload_shape'));
    });
  });

  describe('deprecated objectui-local variants still dispatch', () => {
    // These three cannot arrive from `/meta` — the spec's union rejects them —
    // but the engine keeps evaluating them for callers that build rules by hand.
    describe('UniquenessValidation', () => {
      const rule: UniquenessValidation = {
        type: 'unique',
        name: 'email_unique',
        severity: 'error',
        message: 'Email already exists',
        fields: ['email'],
      };

      it('passes when the checker reports unique', async () => {
        const checker = vi.fn().mockResolvedValue(true);
        const engine = new ObjectValidationEngine(undefined, checker);
        const results = await engine.validateRecord(
          [rule],
          { record: { email: 'a@example.com' } },
          'insert'
        );
        expect(results).toHaveLength(0);
        expect(checker).toHaveBeenCalledWith(
          ['email'],
          { email: 'a@example.com' },
          undefined,
          expect.anything()
        );
      });

      it('fails when the checker reports a duplicate', async () => {
        const engine = new ObjectValidationEngine(undefined, vi.fn().mockResolvedValue(false));
        const results = await engine.validateRecord(
          [rule],
          { record: { email: 'a@example.com' } },
          'insert'
        );
        expect(results).toHaveLength(1);
        expect(results[0].message).toBe('Email already exists');
      });

      it('supports multi-field uniqueness', async () => {
        const checker = vi.fn().mockResolvedValue(false);
        const engine = new ObjectValidationEngine(undefined, checker);
        const multi: UniquenessValidation = { ...rule, fields: ['tenant_id', 'email'] };
        const results = await engine.validateRecord(
          [multi],
          { record: { tenant_id: 't1', email: 'a@example.com' } },
          'insert'
        );
        expect(results).toHaveLength(1);
        expect(checker).toHaveBeenCalledWith(
          ['tenant_id', 'email'],
          { tenant_id: 't1', email: 'a@example.com' },
          undefined,
          expect.anything()
        );
      });
    });

    describe('RangeValidation', () => {
      it('validates numeric ranges', async () => {
        const engine = new ObjectValidationEngine();
        const rule: RangeValidation = {
          type: 'range',
          name: 'age_range',
          severity: 'error',
          message: 'Age must be between 0 and 120',
          field: 'age',
          min: 0,
          max: 120,
        };

        expect(await engine.validateRecord([rule], { record: { age: 30 } }, 'insert')).toHaveLength(0);
        expect(await engine.validateRecord([rule], { record: { age: 150 } }, 'insert')).toHaveLength(1);
        expect(await engine.validateRecord([rule], { record: { age: -1 } }, 'insert')).toHaveLength(1);
      });

      it('validates date ranges', async () => {
        const engine = new ObjectValidationEngine();
        const rule: RangeValidation = {
          type: 'range',
          name: 'date_range',
          severity: 'error',
          message: 'Date out of range',
          field: 'start_date',
          min: '2026-01-01',
          max: '2026-12-31',
        };

        expect(
          await engine.validateRecord([rule], { record: { start_date: '2026-06-01' } }, 'insert')
        ).toHaveLength(0);
        expect(
          await engine.validateRecord([rule], { record: { start_date: '2027-01-01' } }, 'insert')
        ).toHaveLength(1);
      });
    });

    describe('AsyncValidation', () => {
      it('reports the remote verdict', async () => {
        const fetchMock = vi
          .spyOn(globalThis, 'fetch')
          .mockResolvedValue(
            new Response(JSON.stringify({ valid: false, message: 'Taken' }), { status: 200 })
          );
        const engine = new ObjectValidationEngine();
        const rule: AsyncValidation = {
          type: 'async',
          name: 'remote_check',
          severity: 'error',
          message: 'Remote validation failed',
          endpoint: 'https://example.test/validate',
        };

        const results = await engine.validateRecord([rule], { record: { a: 1 } }, 'insert');

        expect(results).toHaveLength(1);
        expect(results[0].message).toBe('Taken');
        expect(fetchMock).toHaveBeenCalled();
      });
    });
  });
});
