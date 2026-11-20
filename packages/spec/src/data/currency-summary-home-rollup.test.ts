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
 * that child field is an amount in the home currency: a `currency` field in
 * `dynamic` mode, of which a stored home amount is one (widened from the home
 * amount alone by seat ruling record 7000258793).
 *
 * The probe shape is HotCRM's PSA phase-0 probe (hotcrm#2316): expenses in
 * their own currencies, each converted at write into `amount_home`, rolled up
 * to the project.
 */

import { describe, it, expect } from 'vitest';

import { ObjectSchema } from './object.zod';
import { recordCurrencyDynamicRollupNotHomeError, storedHomeAmountSourceOf } from './record-currency-path';
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
  + "summary is admitted only for a roll-up of an amount in the organization's home currency";

/** `summaryOperations` rolling `sum(crm_probe_expense.FIELD)` up through `project`. */
const sumOf = (field: string) => ({ summaryOperations: { object: 'crm_probe_expense', field, function: 'sum', relationshipField: 'project' } });

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

/**
 * [Seat ruling record 7000258793, ADR-0144 D8 rule 5 read as written] A plain
 * `dynamic` amount is in the tenant (home) currency by definition: `dynamic`
 * "amounts display in the tenant default currency (the `localization.currency`
 * setting)". So a total of such amounts is too, and the roll-up declares it
 * the way a roll-up of a stored home amount does. The probe shape is HotCRM's
 * (hotcrm#2569): a timesheet total over the time entries' plain cost amount.
 */
describe('a roll-up of a plain `dynamic` amount declares `dynamic` too', () => {
  it('admits sum / min / max / avg over a child `currency` field with no `currencyConfig`, which no `homeAmount` names', () => {
    for (const fn of ['sum', 'min', 'max', 'avg']) {
      const summaryOperations = { object: 'crm_probe_expense', field: 'note_amount', function: fn, relationshipField: 'project' };
      expect(() => buildStack([project({ summaryOperations }), expense()]), fn).not.toThrow();
    }
    expect(() => buildStack([project({ ...sumOf('note_amount'), currencyConfig: {} }), expense()])).not.toThrow();
  });

  it('admits one over a child amount declaring `currencyMode: \'dynamic\'`, writable, readonly or computed by an `expression`', () => {
    for (const def of [
      { type: 'currency', label: 'Cost', currencyConfig: DYNAMIC },
      { type: 'currency', label: 'Cost', readonly: true },
      { type: 'currency', label: 'Cost', expression: 'record.amount_home * 2' },
    ]) {
      expect(() => buildStack([project(sumOf('cost_amount')), expense({ cost_amount: def })]), JSON.stringify(def)).not.toThrow();
    }
  });

  it('admits one over the readonly plain amount of a child whose record-mode amount declares no `homeAmount`', () => {
    const noHome = expense({
      amount: { type: 'currency', label: 'Amount', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } },
    });
    expect(() => buildStack([project(), noHome])).not.toThrow();
  });

  it('CONTROL: a summary that declares nothing still has no currency (no published default moves)', () => {
    const bare = ObjectSchema.parse(project({ ...sumOf('note_amount'), currencyConfig: undefined })) as { fields: Record<string, { currencyConfig?: unknown }> };
    expect(bare.fields.home_expense_total!.currencyConfig).toBeUndefined();
    expect(() => buildStack([project({ ...sumOf('note_amount'), currencyConfig: undefined }), expense()])).not.toThrow();
  });
});

describe('every other `dynamic` summary stays refused', () => {
  it('refuses a `dynamic` roll-up over a `number` field, naming the child\'s amounts in the home currency', () => {
    const finding = stackRefusal([project(sumOf('rate_used')), expense()]);
    expect(finding.startsWith(DYNAMIC_PREFIX)).toBe(true);
    expect(finding).toContain(
      "This summary rolls up sum(crm_probe_expense.rate_used), and 'crm_probe_expense.rate_used' is a 'number' field, "
        + 'not a `currency` field in `dynamic` mode',
    );
    expect(finding).toContain("The amounts of 'crm_probe_expense' in the home currency are 'amount_home', 'note_amount'; roll up one of them");
  });

  it('refuses one over a `summary` of the child, even one declaring `dynamic` itself: a roll-up of a roll-up is not admitted', () => {
    const line = {
      name: 'crm_probe_line', label: 'Line',
      fields: {
        expense: { type: 'master_detail', label: 'Expense', reference: 'crm_probe_expense' },
        cost: { type: 'currency', label: 'Cost' },
      },
    };
    const nested = expense({
      lines_total: {
        type: 'summary', label: 'Lines',
        summaryOperations: { object: 'crm_probe_line', field: 'cost', function: 'sum', relationshipField: 'expense' },
        currencyConfig: DYNAMIC,
      },
    });
    const finding = stackRefusal([project(sumOf('lines_total')), nested, line]);
    expect(finding.startsWith(DYNAMIC_PREFIX)).toBe(true);
    expect(finding).toContain("'crm_probe_expense.lines_total' is a 'summary' field, not a `currency` field in `dynamic` mode");
  });

  it('refuses a `dynamic` roll-up over the record-mode amount itself, prescribing its home field', () => {
    const summaryOperations = { object: 'crm_probe_expense', field: 'amount', function: 'sum', relationshipField: 'project' };
    const finding = stackRefusal([project({ summaryOperations }), expense()]);
    expect(finding.startsWith(DYNAMIC_PREFIX)).toBe(true);
    expect(finding).toContain("is an amount in each record's own currency");
    expect(finding).toContain("Roll up its stored home amount 'crm_probe_expense.amount_home' instead");
  });

  it('refuses a `dynamic` roll-up over a record-mode amount that stores no home amount, prescribing `homeAmount`', () => {
    const plain = expense({
      amount: { type: 'currency', label: 'Amount', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } },
    });
    const finding = stackRefusal([project(sumOf('amount')), plain]);
    expect(finding.startsWith(DYNAMIC_PREFIX)).toBe(true);
    expect(finding).toContain('Roll up a stored home amount of the child instead (declare `homeAmount` on the amount)');
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
    expect(message).toContain(
      "`currencyMode: 'dynamic'` (no `defaultCurrency`) when it rolls up an amount in the organization's home currency, "
        + 'a child `currency` field in `dynamic` mode (a stored home amount included)',
    );
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

/**
 * [#33713, N7] A stored home amount counts only where its `homeAmount` is
 * valid as declared — the reading the object door guarantees for an authored
 * object. An `objectExtensions` entry merges its fields into the child without
 * that reading, so it cannot make a field that is not a home amount one by
 * naming it in a `homeAmount`. The one reading lives in
 * `record-currency-path.ts` (`storedHomeAmountSourceOf`), which the engine
 * registry reads too.
 */
describe('a `homeAmount` makes a home amount only where it is valid as declared', () => {
  /** A record-mode amount an extension adds to the child, whose `homeAmount.field` names `target`. */
  const forging = (target: string) => ({
    forged: {
      type: 'currency', label: 'Forged',
      currencyConfig: {
        currencyMode: 'record', currencyField: 'currency_code',
        homeAmount: { field: target, rateDate: 'expense_date', rateField: 'rate_used' },
      },
    },
  });
  const overNote = { summaryOperations: { object: 'crm_probe_expense', field: 'note_amount', function: 'sum', relationshipField: 'project' } };
  const stackWith = (extensionFields: Record<string, unknown>, rollup: Record<string, unknown> = overNote, child = expense()) => ({
    manifest: stackManifest,
    objects: [project(rollup), child],
    objectExtensions: [{ extend: 'crm_probe_expense', fields: extensionFields }],
  });
  const refusalOf = (stack: unknown): string => {
    let refusal: { code?: string; issues?: unknown[] } | undefined;
    try {
      defineStack(stack as Parameters<typeof defineStack>[0]);
    } catch (error) {
      refusal = error as typeof refusal;
    }
    expect(refusal, 'expected defineStack to REFUSE this stack, and it accepted it').toBeDefined();
    expect(refusal!.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refusal!.issues).toHaveLength(1);
    return String(refusal!.issues![0]);
  };

  it('a forged `homeAmount` makes no `number` field or `fixed` amount admissible: both stay refused', () => {
    const readonlyFixed = { type: 'currency', label: 'Fixed', readonly: true, currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'EUR' } };
    for (const [target, extra, says] of [
      ['rate_used', {}, "is a 'number' field"],
      ['fixed_amount', { fixed_amount: readonlyFixed }, 'is fixed to EUR'],
    ] as const) {
      const finding = refusalOf(stackWith({ ...extra, ...forging(target) }, sumOf(target)));
      expect(finding.startsWith(DYNAMIC_PREFIX), target).toBe(true);
      expect(finding, target).toContain(says);
    }
  });

  it('a plain `dynamic` amount is admitted whatever a `homeAmount` says of it: writable, computed, or claimed twice', () => {
    const computed = { type: 'currency', label: 'Computed', readonly: true, expression: 'amount * 2' };
    for (const [target, extra] of [
      ['note_amount', {}],
      ['computed_amount', { computed_amount: computed }],
      ['amount_home', {}],
    ] as const) {
      expect(() => defineStack(stackWith({ ...extra, ...forging(target) }, sumOf(target)) as Parameters<typeof defineStack>[0]), target)
        .not.toThrow();
    }
  });

  it('CONTROL: an extension declaring a valid home amount on the child is admitted, as an authored one is', () => {
    const home = { ext_home: { type: 'currency', label: 'Home', readonly: true }, ...forging('ext_home') };
    const summaryOperations = { object: 'crm_probe_expense', field: 'ext_home', function: 'sum', relationshipField: 'project' };
    expect(() => defineStack(stackWith(home, { summaryOperations }) as Parameters<typeof defineStack>[0])).not.toThrow();
  });

  it('reads the object door\'s guarantee: every authored home amount the object parses is one, and nothing else is', () => {
    const fields = (ObjectSchema.parse(expense()) as { fields: Record<string, unknown> }).fields;
    expect(storedHomeAmountSourceOf(fields, 'amount_home')).toBe('amount');
    for (const other of ['amount', 'note_amount', 'rate_used', 'currency_code', 'absent']) {
      expect(storedHomeAmountSourceOf(fields, other), other).toBeUndefined();
    }
  });
});

/**
 * [#33713] The (d) sentence has one spelling, `record-currency-path.ts`'s,
 * which `defineStack` and the engine registry both print. This pins the
 * stack's half; the registry's equality with `defineStack` is pinned in
 * `@objectstack/objectql`'s `record-currency-guards.test.ts`.
 */
describe('case (d) is worded once', () => {
  it('defineStack prints `recordCurrencyDynamicRollupNotHomeError` for each refused child field', () => {
    const fixedChild = expense({ note_amount: { type: 'currency', label: 'Plain', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'EUR' } } });
    for (const [field, child] of [['note_amount', fixedChild], ['amount', expense()], ['rate_used', expense()]] as const) {
      const summaryOperations = { object: 'crm_probe_expense', field, function: 'sum', relationshipField: 'project' };
      const childFields = (child as { fields: Record<string, unknown> }).fields;
      expect(stackRefusal([project({ summaryOperations }), child]), field).toBe(recordCurrencyDynamicRollupNotHomeError(
        { object: 'crm_probe_project', field: 'home_expense_total', fn: 'sum', childObject: 'crm_probe_expense', childField: field },
        childFields,
        childFields[field],
      ));
    }
  });

  it('a `currency` child that is neither `dynamic` nor a well-formed `record` / `fixed` is named by what its `currencyConfig` lacks', () => {
    // A stored row the object door never parsed: `fixed` with no code, or a mode outside the three.
    const rollup = { object: 'crm_probe_project', field: 'home_expense_total', fn: 'sum', childObject: 'crm_probe_expense', childField: 'note_amount' };
    for (const [config, names] of [
      [{ currencyMode: 'fixed' }, '`fixed` mode with no `defaultCurrency` code'],
      [{ currencyMode: 'euro' }, "`currencyMode` 'euro' is none of `dynamic`, `fixed` and `record`"],
    ] as const) {
      const child = { type: 'currency', label: 'Plain', currencyConfig: config };
      const message = recordCurrencyDynamicRollupNotHomeError(rollup, { ...(expense().fields as Record<string, unknown>), note_amount: child }, child);
      expect(message, names).toContain(`'crm_probe_expense.note_amount' is a 'currency' field `);
      expect(message, names).toContain(names);
    }
  });
});
