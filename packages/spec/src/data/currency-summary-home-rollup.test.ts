// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33659, ADR-0144 D6 and D8 rule 5] A `summary` that rolls up a stored home
 * amount declares `currencyMode: 'dynamic'`, with no `defaultCurrency`.
 *
 * D6 has consolidated totals read the stored home field, and D8 rule 5 makes
 * that field "a `dynamic`-mode currency field", shown in the organization's
 * home currency (`localization.currency`). Every row of it is in that one
 * currency, so its roll-up is too, and `dynamic` says so without naming the
 * code ("Metadata never names the home currency"). The object door lets a
 * `dynamic` roll-up through only when it names a child field and no
 * `defaultCurrency`; `defineStack`'s cross-reference pass admits it only when
 * that child field is one some `homeAmount.field` on the child object names.
 *
 * The probe shape is HotCRM's PSA phase-0 probe (hotcrm#2316): expenses in
 * their own currencies, each converted at write into `amount_home`, rolled up
 * to the project.
 */

import { describe, it, expect } from 'vitest';

import { ObjectSchema } from './object.zod';
import { defineStack } from '../stack.zod';

const stackManifest = {
  id: 'com.example.homerollup',
  name: 'home-rollup-test',
  version: '1.0.0',
  type: 'app' as const,
};

const CODE_FIELD = { type: 'text', label: 'Currency', valueDomain: 'iso_4217_currency' } as const;
const DYNAMIC = { currencyMode: 'dynamic' } as const;

/** The child: an amount in each expense's own currency, converted at write into `amount_home`. */
function expense(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'crm_probe_expense',
    label: 'Expense',
    fields: {
      project: { type: 'master_detail', label: 'Project', reference: 'crm_probe_project' },
      currency_code: CODE_FIELD,
      expense_date: { type: 'date', label: 'Date' },
      rate_used: { type: 'number', label: 'Rate', readonly: true },
      amount: {
        type: 'currency', label: 'Amount',
        currencyConfig: {
          currencyMode: 'record', currencyField: 'currency_code',
          homeAmount: { field: 'amount_home', rateDate: 'expense_date', rateField: 'rate_used' },
        },
      },
      amount_home: { type: 'currency', label: 'Amount (home)', readonly: true },
      note_amount: { type: 'currency', label: 'Plain amount' },
      ...fields,
    },
  };
}

/** The parent: one roll-up `home_expense_total`, `sum` over `amount_home` unless `rollup` says otherwise. */
function project(rollup: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'crm_probe_project',
    label: 'Project',
    fields: {
      title: { type: 'text', label: 'Title' },
      home_expense_total: {
        type: 'summary', label: 'Expenses (home)',
        summaryOperations: { object: 'crm_probe_expense', field: 'amount_home', function: 'sum', relationshipField: 'project' },
        currencyConfig: DYNAMIC,
        ...rollup,
      },
    },
  };
}

function buildStack(objects: unknown[]): void {
  defineStack({ manifest: stackManifest, objects } as Parameters<typeof defineStack>[0]);
}

/** The stack's one cross-reference finding. */
function stackRefusal(objects: unknown[]): string {
  let refusal: { code?: string; status?: number; issues?: unknown[] } | undefined;
  try {
    buildStack(objects);
  } catch (error) {
    refusal = error as typeof refusal;
  }
  expect(refusal, 'expected defineStack to REFUSE this stack, and it accepted it').toBeDefined();
  expect(refusal!.code).toBe('STACK_CROSS_REFERENCE_INVALID');
  expect(refusal!.status).toBe(422);
  expect(refusal!.issues).toHaveLength(1);
  return String(refusal!.issues![0]);
}

/** The one issue a refused object carries, at the roll-up's `currencyConfig`. */
function objectRefusal(input: unknown): string {
  const r = ObjectSchema.safeParse(input);
  expect(r.success, 'expected the object to REFUSE this roll-up').toBe(false);
  if (r.success) return '';
  expect(r.error.issues).toHaveLength(1);
  expect(r.error.issues[0]!.code).toBe('custom');
  expect(r.error.issues[0]!.path).toEqual(['fields', 'home_expense_total', 'currencyConfig']);
  return r.error.issues[0]!.message;
}

const DYNAMIC_PREFIX = "Object 'crm_probe_project' field 'home_expense_total' currencyConfig: `currencyMode: 'dynamic'` on a "
  + 'summary is admitted only for a roll-up of a stored home amount';

describe('a roll-up of a stored home amount declares `dynamic`', () => {
  it('admits the probe shape: sum over the home field, `currencyMode: \'dynamic\'`', () => {
    expect(() => buildStack([project(), expense()])).not.toThrow();
  });

  it('admits min, max and avg too, and an absent `currencyMode` (which is `dynamic`)', () => {
    for (const fn of ['min', 'max', 'avg']) {
      const summaryOperations = { object: 'crm_probe_expense', field: 'amount_home', function: fn, relationshipField: 'project' };
      expect(() => buildStack([project({ summaryOperations }), expense()])).not.toThrow();
    }
    expect(() => buildStack([project({ currencyConfig: {} }), expense()])).not.toThrow();
  });

  it('the object door alone lets a `dynamic` roll-up naming a child field through, for the stack to judge', () => {
    expect(ObjectSchema.safeParse(project()).success).toBe(true);
  });
});

describe('every other `dynamic` summary stays refused', () => {
  it('refuses a `dynamic` roll-up over a plain currency field that no `homeAmount` names, naming the home amounts', () => {
    const summaryOperations = { object: 'crm_probe_expense', field: 'note_amount', function: 'sum', relationshipField: 'project' };
    const finding = stackRefusal([project({ summaryOperations }), expense()]);
    expect(finding.startsWith(DYNAMIC_PREFIX)).toBe(true);
    expect(finding).toContain("This summary rolls up sum(crm_probe_expense.note_amount), and 'crm_probe_expense.note_amount' is not a stored home amount");
    expect(finding).toContain("The home amounts of 'crm_probe_expense' are 'amount_home'");
  });

  it('refuses a `dynamic` roll-up over the record-mode amount itself, prescribing its home field', () => {
    const summaryOperations = { object: 'crm_probe_expense', field: 'amount', function: 'sum', relationshipField: 'project' };
    const finding = stackRefusal([project({ summaryOperations }), expense()]);
    expect(finding.startsWith(DYNAMIC_PREFIX)).toBe(true);
    expect(finding).toContain("is an amount in each record's own currency");
    expect(finding).toContain("Roll up its stored home amount 'crm_probe_expense.amount_home' instead");
  });

  it('refuses a `dynamic` roll-up over a child that stores no home amount', () => {
    const plain = expense({
      amount: { type: 'currency', label: 'Amount', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } },
    });
    const finding = stackRefusal([project(), plain]);
    expect(finding.startsWith(DYNAMIC_PREFIX)).toBe(true);
    expect(finding).toContain("'crm_probe_expense' stores no home amount");
  });

  it('refuses a `dynamic` roll-up over a fixed child amount, prescribing that code', () => {
    const fixed = expense({ note_amount: { type: 'currency', label: 'Plain', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'EUR' } } });
    const summaryOperations = { object: 'crm_probe_expense', field: 'note_amount', function: 'sum', relationshipField: 'project' };
    const finding = stackRefusal([project({ summaryOperations }), fixed]);
    expect(finding.startsWith(DYNAMIC_PREFIX)).toBe(true);
    expect(finding).toContain("`currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'EUR' }`");
  });

  it('the object refuses a `dynamic` summary naming no child field, with the new admitted case in its message', () => {
    const message = objectRefusal(project({ summaryOperations: undefined }));
    expect(message).toMatch(
      /^`home_expense_total` is a `summary` field of object `crm_probe_project` declaring `currencyMode: 'dynamic'` \(an absent `currencyMode` is `dynamic`\) with no `summaryOperations` naming a child field/,
    );
    expect(message).toContain('A roll-up carries a currency in three cases only');
    expect(message).toContain("`currencyMode: 'dynamic'` (no `defaultCurrency`) when it rolls up a stored home amount");
  });

  it('the object refuses a `dynamic` summary that names a `defaultCurrency`: metadata never names the home currency', () => {
    const message = objectRefusal(project({ currencyConfig: { currencyMode: 'dynamic', defaultCurrency: 'USD' } }));
    expect(message).toContain("with `defaultCurrency: 'USD'`. `dynamic` reads no `defaultCurrency`, and metadata never names the home currency");
  });

  it('a `count` stays refused in every mode, `dynamic` included', () => {
    const summaryOperations = { object: 'crm_probe_expense', function: 'count', relationshipField: 'project' };
    expect(objectRefusal(project({ summaryOperations }))).toMatch(
      /^`home_expense_total` is a `summary` field of object `crm_probe_project` that counts child rows \(`function: 'count'`\) and declares `currencyMode: 'dynamic'`\. A count is a number of rows, never an amount/,
    );
  });

  it('does not judge a child this stack does not declare (as a `record` roll-up is not judged)', () => {
    expect(() => buildStack([project()])).not.toThrow();
  });
});
