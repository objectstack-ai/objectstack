// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0144 D2] `currencyMode: 'record'` + `currencyField` — a record-mode
 * amount points at a sibling ISO 4217 code field on the same object.
 *
 * Two doors, one per half: `CurrencyConfigSchema` refuses the half one config
 * can see (`record` without a pointer or with a `defaultCurrency`, a pointer
 * under another mode, an empty pointer), and the
 * object's `superRefine` refuses what the pointer names (nothing, a non-text
 * field, a text field with no ISO 4217 value domain). A `formula` declaring
 * `returnType: 'currency'` carries the same config, so it meets both doors.
 * `dynamic` and `fixed` parse exactly as they did before `record` existed.
 *
 * Amended 2026-11-09 (#31743, ruling A recorded in 6739066323): on a
 * `master_detail` child the pointer may be the path `PARENT_FIELD.CODE_FIELD`,
 * and a `summary` through that same `master_detail` is in the parent's
 * currency. Three doors now: the config door judges the path's spelling, the
 * object door its first segment (a `master_detail` of the same object, never a
 * `lookup`) and the summary's one-segment rule, and `defineStack`'s
 * cross-reference pass the halves that need the parent object.
 */

import { describe, it, expect } from 'vitest';

import { CurrencyConfigSchema, FieldSchema } from './field.zod';
import { ObjectSchema } from './object.zod';
import { defineStack } from '../stack.zod';

const CODE_FIELD = { type: 'text', label: 'Currency', valueDomain: 'iso_4217_currency' } as const;
const RECORD = { currencyMode: 'record', currencyField: 'currency_code' } as const;

function invoice(fields: Record<string, unknown>): Record<string, unknown> {
  return { name: 'invoice', label: 'Invoice', fields };
}

/** The issues of a refused object parse, reduced to what an author is shown. */
function objectIssues(input: unknown): Array<{ code: string; path: PropertyKey[]; message: string }> {
  const r = ObjectSchema.safeParse(input);
  if (r.success) return [];
  return r.error.issues.map((i) => ({ code: i.code, path: i.path, message: i.message }));
}

describe('`CurrencyConfigSchema`: `record` ⇔ `currencyField`', () => {
  it('a `record` config with a pointer parses, keeping the mode and the pointer', () => {
    const r = CurrencyConfigSchema.safeParse(RECORD);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.currencyMode).toBe('record');
    expect(r.data.currencyField).toBe('currency_code');
  });

  it('refuses `record` without `currencyField`, at the key, with the prescription', () => {
    const r = CurrencyConfigSchema.safeParse({ currencyMode: 'record' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues).toHaveLength(1);
    expect(r.error.issues[0]!.code).toBe('custom');
    expect(r.error.issues[0]!.path).toEqual(['currencyField']);
    expect(r.error.issues[0]!.message).toMatch(/^`currencyMode: 'record'` needs `currencyField`/);
  });

  it.each(['dynamic', 'fixed'] as const)('refuses `currencyField` under `%s`, at the key', (mode) => {
    const r = CurrencyConfigSchema.safeParse({ currencyMode: mode, defaultCurrency: 'USD', currencyField: 'currency_code' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues).toHaveLength(1);
    expect(r.error.issues[0]!.path).toEqual(['currencyField']);
    expect(r.error.issues[0]!.message).toMatch(/^`currencyField` is read only under `currencyMode: 'record'`/);
  });

  it('refuses an empty `currencyField`, at the key, in every mode', () => {
    for (const mode of ['record', 'dynamic', 'fixed'] as const) {
      const config = mode === 'fixed' ? { currencyMode: mode, defaultCurrency: 'USD', currencyField: '' } : { currencyMode: mode, currencyField: '' };
      const r = CurrencyConfigSchema.safeParse(config);
      expect(r.success, mode).toBe(false);
      if (r.success) continue;
      // Under `dynamic` / `fixed` the out-of-mode refusal is told too, at the same key.
      expect(r.error.issues.length, mode).toBe(mode === 'record' ? 1 : 2);
      expect(r.error.issues.every((i) => i.path.join('.') === 'currencyField'), mode).toBe(true);
      expect(r.error.issues[0]!.message).toMatch(/^`currencyField` names a field: an empty name points at nothing/);
    }
  });

  it('refuses `defaultCurrency` under `record`, at the key, with the prescription', () => {
    const r = CurrencyConfigSchema.safeParse({ ...RECORD, defaultCurrency: 'EUR' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues).toHaveLength(1);
    expect(r.error.issues[0]!.code).toBe('custom');
    expect(r.error.issues[0]!.path).toEqual(['defaultCurrency']);
    expect(r.error.issues[0]!.message).toMatch(/^`defaultCurrency` is not read under `currencyMode: 'record'`/);
    // …and `dynamic` keeps tolerating its inert code, for the rows #27157 left behind.
    expect(CurrencyConfigSchema.safeParse({ currencyMode: 'dynamic', defaultCurrency: 'EUR' }).success).toBe(true);
  });

  it('refuses `currencyField` under the defaulted mode (no `currencyMode` written ⇒ dynamic)', () => {
    expect(CurrencyConfigSchema.safeParse({ currencyField: 'currency_code' }).success).toBe(false);
  });

  it('`dynamic` and `fixed` outputs are byte-identical to before `record` existed', () => {
    const cases: Array<[unknown, string]> = [
      [{}, '{"currencyMode":"dynamic"}'],
      [{ currencyMode: 'dynamic' }, '{"currencyMode":"dynamic"}'],
      [{ currencyMode: 'dynamic', defaultCurrency: 'EUR' }, '{"currencyMode":"dynamic","defaultCurrency":"EUR"}'],
      [{ currencyMode: 'fixed', defaultCurrency: 'USD' }, '{"currencyMode":"fixed","defaultCurrency":"USD"}'],
    ];
    for (const [input, before] of cases) {
      expect(JSON.stringify(CurrencyConfigSchema.parse(input))).toBe(before);
    }
  });

  it('parse is idempotent: `parse(parse(x))` equals `parse(x)` in every mode', () => {
    for (const input of [{}, { currencyMode: 'fixed', defaultCurrency: 'USD' }, RECORD]) {
      const once = CurrencyConfigSchema.parse(input);
      expect(CurrencyConfigSchema.parse(once)).toEqual(once);
    }
    const object = invoice({ currency_code: CODE_FIELD, amount: { type: 'currency', label: 'Amount', currencyConfig: RECORD } });
    const once = ObjectSchema.parse(object);
    expect(ObjectSchema.parse(once)).toEqual(once);
  });
});

describe('the object judges what `currencyField` names', () => {
  it('accepts a pointer at a declared `text` field with `valueDomain: iso_4217_currency`', () => {
    const object = invoice({ currency_code: CODE_FIELD, amount: { type: 'currency', label: 'Amount', currencyConfig: RECORD } });
    expect(objectIssues(object)).toEqual([]);
  });

  it('refuses a pointer into nothing, naming the candidates', () => {
    const issues = objectIssues(invoice({
      doc_currency: CODE_FIELD,
      amount: { type: 'currency', label: 'Amount', currencyConfig: RECORD },
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('custom');
    expect(issues[0]!.path).toEqual(['fields', 'amount', 'currencyConfig', 'currencyField']);
    expect(issues[0]!.message).toMatch(/^`amount\.currencyConfig\.currencyField` names `currency_code`, but object `invoice` declares no other field/);
    expect(issues[0]!.message).toContain('candidates: `doc_currency`');
  });

  it('refuses a pointer at the amount itself', () => {
    const issues = objectIssues(invoice({
      currency_code: { type: 'currency', label: 'Amount', currencyConfig: RECORD },
    }));
    expect(issues.map((i) => i.path)).toEqual([['fields', 'currency_code', 'currencyConfig', 'currencyField']]);
    expect(issues[0]!.message).toContain('the object has none; declare one');
  });

  it('refuses a pointer at a field that is not `text`', () => {
    const issues = objectIssues(invoice({
      currency_code: { type: 'number', label: 'Currency' },
      amount: { type: 'currency', label: 'Amount', currencyConfig: RECORD },
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toEqual(['fields', 'amount', 'currencyConfig', 'currencyField']);
    expect(issues[0]!.message).toMatch(/^`amount\.currencyConfig\.currencyField` names `currency_code`, a `number` field/);
  });

  it('refuses a pointer at a `text` field without the ISO 4217 value domain', () => {
    const issues = objectIssues(invoice({
      currency_code: { type: 'text', label: 'Currency' },
      amount: { type: 'currency', label: 'Amount', currencyConfig: RECORD },
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toEqual(['fields', 'amount', 'currencyConfig', 'currencyField']);
    expect(issues[0]!.message).toMatch(/^`amount\.currencyConfig\.currencyField` names `currency_code`, a `text` field .* does not declare `valueDomain: 'iso_4217_currency'`/);
  });

  it('a `formula` with `returnType: currency` meets the same doors in the same shape', () => {
    const formula = (currencyConfig: unknown) => ({
      type: 'formula', label: 'Net', expression: 'record.amount * 0.9', returnType: 'currency', currencyConfig,
    });
    expect(FieldSchema.safeParse({ name: 'net', ...formula(RECORD) }).success).toBe(true);
    expect(FieldSchema.safeParse({ name: 'net', ...formula({ currencyMode: 'record' }) }).success).toBe(false);
    const ok = invoice({ currency_code: CODE_FIELD, net: formula(RECORD) });
    expect(objectIssues(ok)).toEqual([]);
    const bad = invoice({ currency_code: { type: 'text', label: 'Currency' }, net: formula(RECORD) });
    expect(objectIssues(bad).map((i) => i.path)).toEqual([['fields', 'net', 'currencyConfig', 'currencyField']]);
  });
});

// ─── ADR-0144 D2 and D6, amended 2026-11-09: a child follows its parent ───────

const FOLLOW = { currencyMode: 'record', currencyField: 'sales_order.currency_code' } as const;

/** A child object: a `master_detail` to `sales_order`, a `lookup` to `region`, and an amount. */
function orderLine(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'order_line',
    label: 'Order Line',
    fields: {
      sales_order: { type: 'master_detail', label: 'Order', reference: 'sales_order' },
      region: { type: 'lookup', label: 'Region', reference: 'region' },
      note: { type: 'text', label: 'Note' },
      amount: { type: 'currency', label: 'Amount', currencyConfig: FOLLOW },
      ...fields,
    },
  };
}

/** The one issue a refused config parse carries. */
function refusedOnce(r: { success: boolean; error?: { issues: Array<{ code: string; path: PropertyKey[]; message: string }> } }) {
  expect(r.success, 'the config must NOT parse clean').toBe(false);
  expect(r.error!.issues).toHaveLength(1);
  expect(r.error!.issues[0]!.code).toBe('custom');
  return r.error!.issues[0]!;
}

describe('`CurrencyConfigSchema`: the spelling of a `currencyField` path', () => {
  it('admits `PARENT_FIELD.CODE_FIELD` under `record`', () => {
    const r = CurrencyConfigSchema.safeParse(FOLLOW);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.currencyField).toBe('sales_order.currency_code');
  });

  it('refuses a path of three segments: the ruling names one hop', () => {
    const issue = refusedOnce(CurrencyConfigSchema.safeParse({ currencyMode: 'record', currencyField: 'a.b.c' }));
    expect(issue.path).toEqual(['currencyField']);
    expect(issue.message).toMatch(/^`currencyField` names `a\.b\.c`, a path of 3 segments, and a path is two\./);
  });

  it.each(['sales_order.', '.currency_code', 'sales_order..currency_code', 'Sales_Order.currency_code', 'sales_order.currency-code'])(
    'refuses the malformed path `%s`, at the key', (pointer) => {
      const issue = refusedOnce(CurrencyConfigSchema.safeParse({ currencyMode: 'record', currencyField: pointer }));
      expect(issue.path).toEqual(['currencyField']);
      expect(issue.message.startsWith(`\`currencyField\` names \`${pointer}\``)).toBe(true);
    },
  );

  it('a path under `dynamic` meets the out-of-mode refusal only, as any pointer does', () => {
    const issue = refusedOnce(CurrencyConfigSchema.safeParse({ currencyMode: 'dynamic', currencyField: 'a.b.c' }));
    expect(issue.message).toMatch(/^`currencyField` is read only under `currencyMode: 'record'`/);
  });
});

describe('the object judges the first segment of a `currencyField` path', () => {
  it('accepts a path through a `master_detail` field of the same object', () => {
    expect(objectIssues(orderLine())).toEqual([]);
  });

  it('a `formula` with `returnType: currency` may follow the parent the same way', () => {
    const net = { type: 'formula', label: 'Net', expression: 'record.amount * 0.9', returnType: 'currency', currencyConfig: FOLLOW };
    expect(objectIssues(orderLine({ net }))).toEqual([]);
  });

  it('refuses a path through a `lookup`: the ruling names `master_detail` only', () => {
    const issues = objectIssues(orderLine({
      amount: { type: 'currency', label: 'Amount', currencyConfig: { currencyMode: 'record', currencyField: 'region.currency_code' } },
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toEqual(['fields', 'amount', 'currencyConfig', 'currencyField']);
    expect(issues[0]!.message).toMatch(/^`amount\.currencyConfig\.currencyField` names `region\.currency_code`, and `region` is a `lookup` field on object `order_line`\. Only a `master_detail`/);
    expect(issues[0]!.message).toContain('candidates: `sales_order.currency_code`');
  });

  it('refuses a path whose first segment is not a relationship field', () => {
    const issues = objectIssues(orderLine({
      amount: { type: 'currency', label: 'Amount', currencyConfig: { currencyMode: 'record', currencyField: 'note.currency_code' } },
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toMatch(/^`amount\.currencyConfig\.currencyField` names `note\.currency_code`, and `note` is a `text` field/);
    expect(issues[0]!.message).not.toContain('a lookup may be blank');
  });

  it('refuses a path whose first segment is not declared, naming the candidates', () => {
    const issues = objectIssues(orderLine({
      amount: { type: 'currency', label: 'Amount', currencyConfig: { currencyMode: 'record', currencyField: 'order.currency_code' } },
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toMatch(/^`amount\.currencyConfig\.currencyField` names `order\.currency_code`, but object `order_line` declares no other field `order`\./);
    expect(issues[0]!.message).toContain('candidates: `sales_order.currency_code`');
  });

  it('a malformed path meets the config door once, and the object door does not judge it again', () => {
    const issues = objectIssues(orderLine({
      amount: { type: 'currency', label: 'Amount', currencyConfig: { currencyMode: 'record', currencyField: 'a.b.c' } },
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toEqual(['fields', 'amount', 'currencyConfig', 'currencyField']);
    expect(issues[0]!.message).toMatch(/a path of 3 segments/);
  });

  it('a `summary` names the parent\'s code in one segment: a path stays refused there', () => {
    const order = {
      name: 'sales_order', label: 'Order',
      fields: {
        currency_code: CODE_FIELD,
        parent_order: { type: 'master_detail', label: 'Parent', reference: 'sales_order' },
        total: {
          type: 'summary', label: 'Total',
          summaryOperations: { object: 'order_line', field: 'amount', function: 'sum', relationshipField: 'sales_order' },
          currencyConfig: { currencyMode: 'record', currencyField: 'parent_order.currency_code' },
        },
      },
    };
    const issues = objectIssues(order);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toEqual(['fields', 'total', 'currencyConfig', 'currencyField']);
    expect(issues[0]!.message).toMatch(/^`total\.currencyConfig\.currencyField` names `parent_order\.currency_code`, a path, on a `summary` field/);
    // The one-segment spelling of the same roll-up parses.
    const total = { ...order.fields.total, currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } };
    expect(objectIssues({ ...order, fields: { ...order.fields, total } })).toEqual([]);
  });
});

describe('`homeAmount.rateField` sharing compares a path pointer by its spelling', () => {
  const home = (field: string, rateDate = 'line_date') => ({ field, rateDate, rateField: 'fx_rate' });
  const homeFields = {
    line_date: { type: 'date', label: 'Date' },
    fx_rate: { type: 'number', label: 'Rate', readonly: true },
    amount_home: { type: 'currency', label: 'Amount (home)', readonly: true },
    tax_home: { type: 'currency', label: 'Tax (home)', readonly: true },
  };
  const amountOf = (currencyField: string, homeField: string) => ({
    type: 'currency', label: homeField, currencyConfig: { currencyMode: 'record', currencyField, homeAmount: home(homeField) },
  });

  it('two amounts following the same parent share one rate field', () => {
    expect(objectIssues(orderLine({
      ...homeFields,
      amount: amountOf('sales_order.currency_code', 'amount_home'),
      tax: amountOf('sales_order.currency_code', 'tax_home'),
    }))).toEqual([]);
  });

  it('a following amount and one with its own code field do not', () => {
    const issues = objectIssues(orderLine({
      ...homeFields,
      currency_code: CODE_FIELD,
      amount: amountOf('sales_order.currency_code', 'amount_home'),
      tax: amountOf('currency_code', 'tax_home'),
    }));
    expect(issues.map((i) => i.path)).toEqual([['fields', 'tax', 'currencyConfig', 'homeAmount', 'rateField']]);
    expect(issues[0]!.message).toMatch(/already stores the rate of `amount`, an amount with another code field/);
  });
});

// ─── defineStack: the halves only the stack can see ─────────────────────────

const stackManifest = {
  id: 'com.example.recordcurrencypath',
  name: 'record-currency-path-test',
  version: '1.0.0',
  type: 'app' as const,
};

/** The parent: its own code field, a second code field, a plain text field, and a roll-up of its lines. */
function salesOrder(total: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'sales_order',
    label: 'Order',
    fields: {
      currency_code: CODE_FIELD,
      billing_currency: CODE_FIELD,
      title: { type: 'text', label: 'Title' },
      total: {
        type: 'summary', label: 'Total',
        summaryOperations: { object: 'order_line', field: 'amount', function: 'sum', relationshipField: 'sales_order' },
        currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' },
        ...total,
      },
      ...extra,
    },
  };
}

const region = { name: 'region', label: 'Region', fields: { title: { type: 'text', label: 'Title' } } };

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

describe('defineStack: the parent holds the code a path follows', () => {
  it('accepts a child following its parent\'s code field, with the roll-up in that currency', () => {
    expect(() => buildStack([salesOrder(), region, orderLine()])).not.toThrow();
  });

  it('refuses a path whose second segment the parent does not declare', () => {
    const finding = stackRefusal([salesOrder(), region, orderLine({
      amount: { type: 'currency', label: 'Amount', currencyConfig: { currencyMode: 'record', currencyField: 'sales_order.currency' } },
    })]);
    expect(finding.startsWith(
      "Object 'order_line' field 'amount' currencyConfig.currencyField: 'sales_order.currency' follows 'sales_order'",
    )).toBe(true);
    expect(finding).toContain("candidates: 'currency_code', 'billing_currency'");
  });

  it('refuses a path whose second segment holds no ISO 4217 code', () => {
    const finding = stackRefusal([salesOrder(), region, orderLine({
      amount: { type: 'currency', label: 'Amount', currencyConfig: { currencyMode: 'record', currencyField: 'sales_order.title' } },
    })]);
    expect(finding.startsWith(
      "Object 'order_line' field 'amount' currencyConfig.currencyField: 'sales_order.title' follows 'sales_order.title', a 'text' field that does not hold an ISO 4217 code",
    )).toBe(true);
  });

  it('does not judge a path whose parent this stack does not declare', () => {
    expect(() => buildStack([region, orderLine()])).not.toThrow();
  });
});

describe('defineStack: a roll-up through that master_detail declares the parent\'s currency', () => {
  it('refuses a roll-up that does not say it is money', () => {
    const finding = stackRefusal([salesOrder({ currencyConfig: undefined }), region, orderLine()]);
    expect(finding.startsWith(
      "Object 'sales_order' field 'total' currencyConfig: the summary rolls up sum(order_line.amount) through the master_detail 'sales_order'",
    )).toBe(true);
    expect(finding).toContain('would show as a bare number');
    expect(finding).toContain("`currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' }`");
  });

  it('refuses a roll-up naming another code field than the one its children follow', () => {
    const finding = stackRefusal([
      salesOrder({ currencyConfig: { currencyMode: 'record', currencyField: 'billing_currency' } }), region, orderLine(),
    ]);
    expect(finding).toContain("It names 'billing_currency' instead");
  });

  it('resolves an omitted relationshipField to the child\'s one relation back', () => {
    const ops = { object: 'order_line', field: 'amount', function: 'max' };
    expect(() => buildStack([salesOrder({ summaryOperations: ops }), region, orderLine()])).not.toThrow();
    const finding = stackRefusal([salesOrder({ summaryOperations: ops, currencyConfig: undefined }), region, orderLine()]);
    expect(finding).toContain('rolls up max(order_line.amount)');
  });

  it('does not judge a `count`, which reads no amount', () => {
    const ops = { object: 'order_line', function: 'count', relationshipField: 'sales_order' };
    expect(() => buildStack([salesOrder({ summaryOperations: ops, currencyConfig: undefined }), region, orderLine()])).not.toThrow();
  });

  it('does not judge a roll-up over a child amount with its own code field (D6\'s first bullet stays the registry\'s)', () => {
    const own = orderLine({
      currency_code: CODE_FIELD,
      amount: { type: 'currency', label: 'Amount', currencyConfig: RECORD },
    });
    expect(() => buildStack([salesOrder({ currencyConfig: undefined }), region, own])).not.toThrow();
  });
});
