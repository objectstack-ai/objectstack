// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { runWithAdvisoryAggregation, type AdvisoryGroup } from '@objectstack/core';

import { evaluateValidationRules } from './rule-validator.js';
import { ValidationError } from './record-validator.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at MODULE
// LOAD, not inside a clocked `it()` body.
import '@objectstack/spec';
import '@objectstack/formula';

/**
 * [#24782] What the operator log says about a validation rule that could not be
 * EVALUATED, by severity.
 *
 * #4649 fails such a rule closed — but `severity` still governs blocking, so an
 * unevaluable `warning` / `info` rule never refuses the write. Until #24782 its
 * log said the opposite, twice: the predicate evaluator's fail-closed sentence
 * ("— write rejected: a rule that cannot be evaluated fails closed"), logged
 * before the rule's severity was consulted, and the advisory branch's per-write
 * line, which embedded the unevaluable violation's own message (ending
 * "— write rejected."). An operator reading the log for a disputed write was
 * told it was refused when it was stored.
 *
 * The pins:
 *  - an unevaluable advisory rule logs exactly ONE line, naming the rule, its
 *    severity and the fault, and saying the write proceeded — never "write
 *    rejected", never "fails closed" — on each predicate slot: a `script`
 *    condition, a `conditional`'s `when`, and the relationship-traversal refusal;
 *  - the seed / boot aggregation (#13889) folds that same advisory text;
 *  - CONTROL: an unevaluable `error` rule is refused exactly as before, and its
 *    log still says the write was rejected and the rule fails closed.
 */

const FAULTED_CONDITION = 'int(record.title) > 1';

const probe = (severity: 'error' | 'warning' | 'info') => ({
  name: 'qa_vr_probe',
  fields: { title: { type: 'text', label: 'Title' } },
  validations: [
    { type: 'script', name: 'qa_unevaluable', severity, message: 'x', condition: FAULTED_CONDITION },
  ],
});

const conditionalProbe = (severity: 'error' | 'warning') => ({
  name: 'qa_vr_probe',
  fields: { title: { type: 'text', label: 'Title' } },
  validations: [
    {
      type: 'conditional',
      name: 'qa_unevaluable_when',
      severity,
      message: 'x',
      when: FAULTED_CONDITION,
      then: { type: 'script', name: 'qa_then', message: 'then', condition: 'false' },
    },
  ],
});

/** A rule reading one hop through a lookup whose parent row was unreadable. */
const traversalProbe = (severity: 'error' | 'warning') => ({
  name: 'crm_opportunity',
  fields: {
    amount: { type: 'currency', label: 'Amount' },
    account: { type: 'lookup', reference: 'crm_account', label: 'Account' },
  },
  validations: [
    {
      type: 'script',
      name: 'partner_cap',
      severity,
      message: 'Partner accounts are capped at 10000.',
      fields: ['amount'],
      condition: "record.account.type == 'partner' && record.amount > 10000",
    },
  ],
});
const unreadableAccount = { account: { object: 'crm_account', unavailable: 'unreadable' } };

function run(
  schema: unknown,
  data: Record<string, unknown>,
  related?: Record<string, unknown>,
): { warns: string[]; thrown: unknown; returned: unknown } {
  const warns: string[] = [];
  let thrown: unknown;
  let returned: unknown;
  try {
    returned = evaluateValidationRules(schema as never, data, 'insert', {
      logger: { warn: (m: unknown) => { warns.push(String(m)); } },
      ...(related ? { related: related as never } : {}),
    });
  } catch (err) {
    thrown = err;
  }
  return { warns, thrown, returned };
}

function expectOneAdvisoryLine(warns: string[], rule: string, severity: string, fault: RegExp): void {
  expect(warns).toHaveLength(1);
  const [line] = warns;
  expect(line).toContain(`Validation rule '${rule}' (${severity}):`);
  expect(line).toMatch(fault);
  expect(line).toContain('write proceeded');
  expect(line).not.toMatch(/write rejected/);
  expect(line).not.toMatch(/fails closed/);
}

describe('[#24782] an unevaluable ADVISORY rule logs one line, and it says the write proceeded', () => {
  it.each(['warning', 'info'] as const)('a `script` condition at severity %s', (severity) => {
    const { warns, thrown, returned } = run(probe(severity), { title: 'abc' });

    expect(thrown).toBeUndefined();
    // #22726: an unevaluable rule has no verdict, so it is not an advisory hit.
    expect(returned).toEqual([]);
    expectOneAdvisoryLine(warns, 'qa_unevaluable', severity, /could not be evaluated \(.+\)/);
  });

  it('a `conditional` whose `when` cannot be evaluated', () => {
    const { warns, thrown, returned } = run(conditionalProbe('warning'), { title: 'abc' });

    expect(thrown).toBeUndefined();
    expect(returned).toEqual([]);
    expectOneAdvisoryLine(warns, 'qa_unevaluable_when', 'warning', /could not be evaluated \(.+\)/);
  });

  it('the relationship-traversal refusal (the related row was unreadable)', () => {
    const { warns, thrown, returned } = run(
      traversalProbe('warning'), { amount: 20000, account: 'acc_1' }, unreadableAccount,
    );

    expect(thrown).toBeUndefined();
    expect(returned).toEqual([]);
    expectOneAdvisoryLine(warns, 'partner_cap', 'warning', /could not be evaluated \(.+\)/);
  });

  it('on the seed / boot path the hit folds into the summary with the same advisory text, and no per-row line', async () => {
    const warns: string[] = [];
    let groups: AdvisoryGroup[] = [];
    await runWithAdvisoryAggregation(async () => {
      evaluateValidationRules(probe('warning') as never, { title: 'abc' }, 'insert', {
        logger: { warn: (m: unknown) => { warns.push(String(m)); } },
      });
    }, (g) => { groups = g; });

    expect(warns).toEqual([]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ rule: 'qa_unevaluable', severity: 'warning', rows: 1 });
    expect(groups[0]!.message).toMatch(/could not be evaluated \(.+\) — write proceeded/);
    expect(groups[0]!.message).not.toMatch(/write rejected|fails closed/);
  });
});

describe('[#24782] CONTROL — an unevaluable `error` rule is refused, and its log says so', () => {
  const refusalOf = (thrown: unknown) => {
    expect(thrown).toBeInstanceOf(ValidationError);
    return (thrown as ValidationError).fields;
  };

  it('a `script` condition', () => {
    const { warns, thrown } = run(probe('error'), { title: 'abc' });

    const fields = refusalOf(thrown);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      field: '_record',
      code: 'rule_violation',
      constraint: { rule: 'qa_unevaluable', reason: 'unevaluable' },
    });
    expect(fields[0]!.message).toMatch(/^Validation rule 'qa_unevaluable' could not be evaluated \(.+\) — write rejected\./);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatch(
      /^Validation rule 'qa_unevaluable' predicate failed to evaluate \(.+\) — write rejected: a rule that cannot be evaluated fails closed, it is never skipped$/,
    );
  });

  it('a `conditional` whose `when` cannot be evaluated', () => {
    const { warns, thrown } = run(conditionalProbe('error'), { title: 'abc' });

    expect(refusalOf(thrown)[0]).toMatchObject({ constraint: { rule: 'qa_unevaluable_when', reason: 'unevaluable' } });
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatch(/^Validation rule 'qa_unevaluable_when' when-predicate failed to evaluate \(.+\) — write rejected: a rule that cannot be evaluated fails closed/);
  });

  it('the relationship-traversal refusal', () => {
    const { warns, thrown } = run(traversalProbe('error'), { amount: 20000, account: 'acc_1' }, unreadableAccount);

    expect(refusalOf(thrown)[0]).toMatchObject({ constraint: { rule: 'partner_cap', reason: 'unevaluable' } });
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatch(/^Validation rule 'partner_cap' predicate could not be evaluated \(.+\) — write rejected$/);
  });
});
