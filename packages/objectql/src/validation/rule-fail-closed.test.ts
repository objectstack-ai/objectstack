// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4649 — a script validation whose predicate could not be evaluated used to be
 * SKIPPED with a WARN, so the rule was declared, listed in the metadata, and
 * enforced nothing. For a validation that inverts the guarantee: the rule exists
 * to reject a write, and its failure mode shipped the write through.
 *
 * Two halves, and the tests below pin both because either alone reintroduces a
 * trap:
 *
 *  1. The record a predicate reads is TOTAL over the object's declared fields
 *     (`null` when neither the payload nor the prior record carries the key), on
 *     UPDATE as well as insert. Without this, every legitimate predicate 422s on
 *     any driver that stores only written columns — the shape the HotCRM report
 *     (hotcrm#630) came from.
 *  2. What still cannot be evaluated over that total record — a typo'd key, a
 *     parse error — REJECTS the write, naming the rule and the offending key.
 *     Without this, a typo'd predicate is back to silently doing nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import { evaluateValidationRules } from './rule-validator';
import { ValidationError } from './record-validator';

/**
 * The HotCRM shape: a lead may only be closed as a duplicate while naming the
 * surviving record. `survivor_lead_id` is DECLARED but the driver stores only
 * written columns, so the prior record it hands back does not carry the key.
 */
const leadSchema = {
  fields: {
    status: { name: 'status', label: 'Status', type: 'text' },
    disqualification_reason: { name: 'disqualification_reason', label: 'Reason', type: 'text' },
    survivor_lead_id: { name: 'survivor_lead_id', label: 'Surviving lead', type: 'text' },
  },
  validations: [
    {
      type: 'script' as const,
      name: 'duplicate_disqualification_requires_survivor',
      condition: {
        dialect: 'cel',
        source:
          'record.disqualification_reason == "duplicate" && record.survivor_lead_id == null',
      },
      message: 'A duplicate must name the surviving lead.',
      events: ['insert', 'update'] as Array<'insert' | 'update'>,
    },
  ],
};

/** What a driver that stores only written columns returns: no `survivor_lead_id`. */
const priorFromSparseDriver = { id: 'lead_1', status: 'open' };

describe('#4649 — the merged record is total on UPDATE', () => {
  it('ENFORCES the rule when the prior record omits a declared key entirely', () => {
    // Before #4649: `No such key: survivor_lead_id` → rule skipped → write
    // allowed. The lead could be closed as a duplicate naming nobody.
    expect(() =>
      evaluateValidationRules(
        leadSchema,
        { status: 'disqualified', disqualification_reason: 'duplicate' },
        'update',
        { previous: priorFromSparseDriver },
      ),
    ).toThrow(/A duplicate must name the surviving lead/);
  });

  it('still allows the write when the payload DOES name the survivor', () => {
    expect(() =>
      evaluateValidationRules(
        leadSchema,
        { status: 'disqualified', disqualification_reason: 'duplicate', survivor_lead_id: 'lead_9' },
        'update',
        { previous: priorFromSparseDriver },
      ),
    ).not.toThrow();
  });

  it('still allows the write when the survivor is already persisted', () => {
    expect(() =>
      evaluateValidationRules(
        leadSchema,
        { status: 'disqualified', disqualification_reason: 'duplicate' },
        'update',
        { previous: { ...priorFromSparseDriver, survivor_lead_id: 'lead_9' } },
      ),
    ).not.toThrow();
  });

  it('behaves identically on insert (the two paths no longer diverge)', () => {
    expect(() =>
      evaluateValidationRules(
        leadSchema,
        { status: 'disqualified', disqualification_reason: 'duplicate' },
        'insert',
        {},
      ),
    ).toThrow(/A duplicate must name the surviving lead/);
  });

  it('materialises the `previous` binding too, so `previous.<declared>` is readable', () => {
    const schema = {
      fields: {
        stage: { name: 'stage', label: 'Stage', type: 'text' },
        locked: { name: 'locked', label: 'Locked', type: 'boolean' },
      },
      validations: [
        {
          type: 'script' as const,
          name: 'no_reopen_once_locked',
          // `previous.locked` is a declared column the sparse driver omitted.
          condition: { dialect: 'cel', source: 'previous.locked == true && record.stage == "open"' },
          message: 'A locked record cannot be reopened.',
        },
      ],
    };
    // Prior carries neither key → before #4649 this faulted; it must now
    // evaluate cleanly to "no violation", NOT reject.
    expect(() =>
      evaluateValidationRules(schema, { stage: 'open' }, 'update', { previous: { id: 'r1' } }),
    ).not.toThrow();
    // …and still reject when the prior really is locked.
    expect(() =>
      evaluateValidationRules(schema, { stage: 'open' }, 'update', { previous: { id: 'r1', locked: true } }),
    ).toThrow(/locked record cannot be reopened/);
  });

  it('does not mutate the caller\'s prior record (it is the engine\'s hookContext.previous)', () => {
    const previous = { ...priorFromSparseDriver };
    try {
      evaluateValidationRules(
        leadSchema,
        { status: 'disqualified', disqualification_reason: 'duplicate' },
        'update',
        { previous },
      );
    } catch {
      /* expected */
    }
    expect(previous).toEqual(priorFromSparseDriver);
    expect('survivor_lead_id' in previous).toBe(false);
  });

  it('materialises DECLARED fields only — an undeclared key is not invented', () => {
    const schema = {
      fields: { a: { name: 'a', type: 'text' } },
      validations: [
        {
          type: 'script' as const,
          name: 'reads_undeclared',
          condition: { dialect: 'cel', source: 'record.not_a_field == null' },
          message: 'unreachable',
        },
      ],
    };
    // If materialisation covered arbitrary keys this would evaluate TRUE and
    // report the author's message; instead the typo is reported as a typo.
    expect(() => evaluateValidationRules(schema, { a: '1' }, 'update', { previous: { a: '0' } }))
      .toThrow(/could not be evaluated/);
  });
});

describe('#4649 — an unevaluable predicate fails CLOSED', () => {
  const typoSchema = {
    fields: { status: { name: 'status', label: 'Status', type: 'text' } },
    validations: [
      {
        type: 'script' as const,
        name: 'status_guard',
        condition: { dialect: 'cel', source: 'record.stauts == "bad"' }, // typo
        message: 'Status must not be bad.',
      },
    ],
  };

  it('rejects the write and names the rule AND the missing key', () => {
    let caught: ValidationError | null = null;
    try {
      evaluateValidationRules(typoSchema, { status: 'ok' }, 'update', { previous: { status: 'ok' } });
    } catch (err) {
      caught = err as ValidationError;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught!.message).toContain('status_guard');
    expect(caught!.message).toContain('stauts');
    const [field] = caught!.fields;
    expect(field.code).toBe('rule_violation');
    expect(field.constraint).toMatchObject({
      rule: 'status_guard',
      reason: 'unevaluable',
      missingKey: 'stauts',
    });
  });

  it('does not present the author\'s message — the rule never said no', () => {
    expect(() =>
      evaluateValidationRules(typoSchema, { status: 'ok' }, 'update', { previous: { status: 'ok' } }),
    ).toThrow(/could not be evaluated/);
    expect(() =>
      evaluateValidationRules(typoSchema, { status: 'ok' }, 'update', { previous: { status: 'ok' } }),
    ).not.toThrow(/Status must not be bad/);
  });

  it('still logs the fault — the operator keeps the WARN, worded as a rejection', () => {
    const warn = vi.fn();
    expect(() =>
      evaluateValidationRules(typoSchema, { status: 'ok' }, 'update', {
        previous: { status: 'ok' },
        logger: { warn },
      }),
    ).toThrow(ValidationError);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/write rejected/);
    expect(String(warn.mock.calls[0]![0])).not.toMatch(/— skipped/);
  });

  it('respects severity: a warning-severity broken rule logs and does NOT block', () => {
    const warn = vi.fn();
    const advisory = {
      ...typoSchema,
      validations: [{ ...typoSchema.validations[0]!, severity: 'warning' as const }],
    };
    expect(() =>
      evaluateValidationRules(advisory, { status: 'ok' }, 'update', {
        previous: { status: 'ok' },
        logger: { warn },
      }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });

  it('rejects a parse-error predicate too, on insert as on update', () => {
    const broken = {
      fields: { a: { name: 'a', type: 'text' } },
      validations: [
        { type: 'script' as const, name: 'unparseable', condition: 'record.a &&', message: 'm' },
      ],
    };
    expect(() => evaluateValidationRules(broken, { a: '1' }, 'insert', {}))
      .toThrow(/rule 'unparseable' could not be evaluated/);
  });

  it('keeps the message single-line (the CEL source excerpt stays in the log)', () => {
    let msg = '';
    try {
      evaluateValidationRules(typoSchema, { status: 'ok' }, 'update', { previous: { status: 'ok' } });
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).not.toContain('\n');
  });
});

describe('#4649 — `has()` semantics over a materialised field, pinned', () => {
  /**
   * A materialised field is a PRESENT key holding `null`, so `has()` is TRUE —
   * CEL's own rule, and what the insert path has always done. The app-side
   * mitigation (hotcrm#630 wraps field reads in `has(...)`) must keep working,
   * which it does as long as it pairs `has()` with a null test; a bare
   * `!has(x)` is an emptiness test that never fires, and this pins that so the
   * behaviour cannot drift under the apps relying on it.
   */
  const schema = (source: string) => ({
    fields: {
      status: { name: 'status', type: 'text' },
      survivor_lead_id: { name: 'survivor_lead_id', type: 'text' },
    },
    validations: [
      { type: 'script' as const, name: 'guarded', condition: { dialect: 'cel', source }, message: 'violated' },
    ],
  });

  const run = (source: string, data: Record<string, unknown>, previous?: Record<string, unknown>) =>
    () => evaluateValidationRules(schema(source), data, previous ? 'update' : 'insert', { previous });

  it('a `has(x) && x == …` predicate evaluates (never faults) and is correct', () => {
    // Guarded read over an absent declared key: evaluable, no violation.
    expect(run('has(record.survivor_lead_id) && record.survivor_lead_id == "x"', { status: 'a' }, { id: 'r' }))
      .not.toThrow();
    // …and fires when the value is really there.
    expect(run('has(record.survivor_lead_id) && record.survivor_lead_id == "x"', { survivor_lead_id: 'x' }, { id: 'r' }))
      .toThrow(ValidationError);
  });

  it('`has(<declared field>)` is TRUE for a materialised null — identically on insert and update', () => {
    // The predicate IS `has(...)`: violated ⇔ has() is true.
    expect(run('has(record.survivor_lead_id)', { status: 'a' }, { id: 'r' })).toThrow(ValidationError);
    expect(run('has(record.survivor_lead_id)', { status: 'a' })).toThrow(ValidationError);
  });

  it('`has(<undeclared key>)` is FALSE — has() guards undeclared keys, not empty values', () => {
    expect(run('has(record.no_such_column)', { status: 'a' }, { id: 'r' })).not.toThrow();
  });

  /**
   * The trap this pins is the one that cost two example objects in this very
   * repo: `has(a) && has(b) && a < b` READS as a null guard and is not one.
   * CEL cannot order-compare null, so the predicate aborts — and it aborted on
   * every driver that returns its NULL columns, long before #4649. The
   * rejection therefore has to teach the fix, not just report the fault.
   */
  it('an ordering comparison guarded only by has() is rejected, and the message teaches `!= null`', () => {
    let caught: ValidationError | null = null;
    try {
      evaluateValidationRules(
        {
          fields: {
            start_date: { name: 'start_date', type: 'date' },
            end_date: { name: 'end_date', type: 'date' },
          },
          validations: [{
            type: 'cross_field' as const,
            name: 'end_after_start',
            fields: ['start_date', 'end_date'],
            condition: {
              dialect: 'cel',
              source: 'has(record.start_date) && has(record.end_date) && record.end_date < record.start_date',
            },
            message: 'End must be on or after start.',
          }],
        },
        { name: 'A project with no dates' },
        'insert',
        {},
      );
    } catch (err) {
      caught = err as ValidationError;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught!.message).toContain('end_after_start');
    expect(caught!.message).toContain("'!= null'");
    expect(caught!.message).toContain('has(x)');
    expect(caught!.fields[0]!.constraint).toMatchObject({ hint: 'null-comparison' });
  });

  it('the same rule written with `!= null` evaluates cleanly on the same record', () => {
    const schema = {
      fields: {
        start_date: { name: 'start_date', type: 'date' },
        end_date: { name: 'end_date', type: 'date' },
      },
      validations: [{
        type: 'cross_field' as const,
        name: 'end_after_start',
        fields: ['start_date', 'end_date'],
        condition: {
          dialect: 'cel',
          source: 'record.start_date != null && record.end_date != null && record.end_date < record.start_date',
        },
        message: 'End must be on or after start.',
      }],
    };
    expect(() => evaluateValidationRules(schema, { name: 'no dates' }, 'insert', {})).not.toThrow();
    expect(() => evaluateValidationRules(schema, { start_date: '2026-06-01', end_date: '2026-01-01' }, 'insert', {}))
      .toThrow(/End must be on or after start/);
  });

  it('the emptiness test to write is `== null`, and it works on both paths', () => {
    expect(run('record.survivor_lead_id == null', { status: 'a' }, { id: 'r' })).toThrow(ValidationError);
    expect(run('record.survivor_lead_id == null', { status: 'a' })).toThrow(ValidationError);
    expect(run('record.survivor_lead_id == null', { survivor_lead_id: 'x' }, { id: 'r' })).not.toThrow();
  });
});

describe('#4649 — unchanged neighbours', () => {
  it('a broken `regex` on a format rule stays fail-open (out of scope, deliberately)', () => {
    const schema = {
      fields: { code: { name: 'code', type: 'text' } },
      validations: [
        { type: 'format' as const, name: 'fmt', field: 'code', regex: '([', message: 'bad' },
      ],
    };
    expect(() => evaluateValidationRules(schema, { code: 'x' }, 'update', { previous: { code: 'y' } }))
      .not.toThrow();
  });

  it('an uncompilable JSON Schema stays fail-open (out of scope, deliberately)', () => {
    const schema = {
      fields: { payload: { name: 'payload', type: 'json' } },
      validations: [
        { type: 'json_schema' as const, name: 'js', field: 'payload', schema: { type: 'not-a-type' }, message: 'bad' },
      ],
    };
    expect(() => evaluateValidationRules(schema, { payload: { a: 1 } }, 'update', { previous: {} }))
      .not.toThrow();
  });

  it('a broken field-level `requiredWhen` stays fail-open (out of scope, deliberately)', () => {
    const schema = {
      fields: {
        a: { name: 'a', type: 'text', requiredWhen: { dialect: 'cel', source: 'this is (( not valid' } },
      },
      validations: [],
    };
    expect(() => evaluateValidationRules(schema, { a: null }, 'update', { previous: { a: null } }))
      .not.toThrow();
  });
});
