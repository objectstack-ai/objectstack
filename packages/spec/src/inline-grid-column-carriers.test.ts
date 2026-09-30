// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20901 — an inline grid column is judged on BOTH of its carriers, and by the
 * type it renders as.
 *
 * The objectui master-detail grid reads one column shape from two carriers: a
 * relationship field's `inlineColumns` and a form view's `subforms[].columns`.
 * `InlineGridColumnSchema` judged only the first, and only by the column's
 * DECLARED `type`. Measured by the card through a public door (`objectui
 * validate`, exit 0) and by `FormViewSchema.safeParse` at 17.5.0, three
 * columns published green on the form-view carrier:
 *
 *   A. a typed `currency` column carrying `scale` (refused on the other carrier);
 *   B. an identity-only column carrying `scale` over a `currency` child field;
 *   C. a column whose only key is the bogus `zzz_not_a_key`.
 *
 * What is pinned here:
 *
 *   1. THE REFERENCE — the form-view carrier's column element IS
 *      `InlineGridColumnSchema` (the same object, not a copy), and A and C are
 *      refused by `FormViewSchema` with the column schema's own issues.
 *   2. THE REACH OF THE SCHEMA — B passes `FormViewSchema`: the schema cannot
 *      see the child field, so B is judged where the child field is a fact —
 *      `defineStack`'s cross-reference check, on BOTH carriers, with the column
 *      schema's own refusal (`code` + `status` of the ADR-0112 envelope, the
 *      located finding, and the ruled first sentence).
 *   3. THE CONTROLS — valid columns on both carriers, a column that declares a
 *      `type`, a child field of another type, and a child object this stack
 *      does not declare are all accepted.
 *
 * Key-vs-value note: the column rules judge the KEY on one type whatever its
 * value, so each refusal is a full parse failure at the column's own path, and
 * each control is a full success — never mere absence of `unrecognized_keys`.
 */

import { describe, expect, it } from 'vitest';
import { InlineGridColumnSchema } from './data/field.zod';
import { FormViewSchema } from './ui/view.zod';
import { defineStack } from './stack.zod';

type Issue = { code: string; path: PropertyKey[]; message: string };
type Result = { success: boolean; error?: { issues: Issue[] }; data?: unknown };

/** The column refusal's ruled first sentence (ruling B on #19629, remedy 乙 on #19910). */
const COLUMN_FIRST_SENTENCE = '`scale` is not valid on a `currency` inline grid column — delete the key.';

/** The card's three columns. */
const TYPED_CURRENCY_WITH_SCALE = { name: 'amount', type: 'currency', scale: 2 } as const;
const IDENTITY_ONLY_WITH_SCALE = { name: 'amount', scale: 2 } as const;
const BOGUS_KEY_ONLY = { zzz_not_a_key: 1 } as const;

const FORM_BASE = { type: 'simple', sections: [{ fields: ['title'] }] } as const;

const parseSubformColumns = (columns: unknown[]): Result =>
  FormViewSchema.safeParse({ ...FORM_BASE, subforms: [{ childObject: 'crm_invoice_line', columns }] }) as Result;

// ---------------------------------------------------------------------------
// A stack whose child object carries one field of each type the pins need.
// ---------------------------------------------------------------------------

const manifest = {
  id: 'com.example.inlinecarriers',
  name: 'inline-grid-column-carriers-test',
  version: '1.0.0',
  type: 'app' as const,
};

const PARENT = { name: 'crm_invoice', label: 'Invoice', fields: { title: { type: 'text' as const } } };

const childObject = (inlineColumns?: unknown[]) => ({
  name: 'crm_invoice_line',
  label: 'Invoice Line',
  fields: {
    invoice: {
      type: 'master_detail' as const,
      reference: 'crm_invoice',
      inlineEdit: 'grid' as const,
      ...(inlineColumns ? { inlineColumns } : {}),
    },
    quantity: { type: 'number' as const },
    amount: { type: 'currency' as const },
  },
});

type FormSlot = 'form' | 'formViews';

const stackWithSubformColumns = (columns: unknown[], slot: FormSlot = 'form', child = 'crm_invoice_line') => {
  const form = { ...FORM_BASE, subforms: [{ childObject: child, columns }] };
  return {
    manifest,
    objects: [PARENT, childObject()],
    views: [{
      name: 'crm_invoice',
      object: 'crm_invoice',
      ...(slot === 'form' ? { form } : { formViews: { entry: form } }),
    }],
  };
};

const stackWithInlineColumns = (inlineColumns: unknown[]) => ({
  manifest,
  objects: [PARENT, childObject(inlineColumns)],
});

/** `defineStack` over a fixture typed loosely on purpose — several are refused by design. */
const build = (stack: unknown) => defineStack(stack as Parameters<typeof defineStack>[0]);

type Refusal = { code?: string; status?: number; issues?: unknown[]; message: string };

/** Run `defineStack` and return the refusal it threw — fails the test when it accepted. */
function refusalOf(stack: unknown): Refusal {
  try {
    build(stack);
  } catch (error) {
    return error as Refusal;
  }
  throw new Error('expected defineStack to REFUSE this stack, and it accepted it');
}

/** The one cross-reference finding the stack raised — its located subject and the column refusal. */
function expectHydratedCurrencyRefusal(stack: unknown, location: string): void {
  const refusal = refusalOf(stack);
  expect(refusal.code).toBe('STACK_CROSS_REFERENCE_INVALID');
  expect(refusal.status).toBe(422);
  expect(refusal.issues).toHaveLength(1);
  const finding = String(refusal.issues![0]);
  expect(finding.startsWith(`${location}: column 'amount' declares no \`type\``)).toBe(true);
  expect(finding).toContain(`field 'crm_invoice_line.amount' is \`currency\``);
  expect(finding).toContain(COLUMN_FIRST_SENTENCE);
}

describe('#20901 — the form-view carrier references the column contract', () => {
  it('its column element IS InlineGridColumnSchema — one contract, not a copy', () => {
    const subforms = (FormViewSchema.shape as unknown as Record<string, { unwrap(): { element: { shape: Record<string, { unwrap(): { element: unknown } }> } } }>).subforms;
    const columnElement = subforms.unwrap().element.shape.columns.unwrap().element;
    expect(columnElement).toBe(InlineGridColumnSchema);
  });

  it('refuses the card\'s typed currency column carrying `scale`, at the column\'s `scale`, with the ruled first sentence', () => {
    const result = parseSubformColumns([{ name: 'quantity' }, TYPED_CURRENCY_WITH_SCALE]);
    expect(result.success).toBe(false);
    expect(result.error!.issues).toHaveLength(1);
    const [issue] = result.error!.issues;
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual(['subforms', 0, 'columns', 1, 'scale']);
    expect(issue.message.startsWith(COLUMN_FIRST_SENTENCE)).toBe(true);
  });

  it('refuses the card\'s bogus-key column: the key is named, and the missing `name` is required', () => {
    const result = parseSubformColumns([BOGUS_KEY_ONLY]);
    expect(result.success).toBe(false);
    const issues = result.error!.issues;
    const unknown = issues.find((i) => i.code === 'unrecognized_keys');
    expect(unknown?.path).toEqual(['subforms', 0, 'columns', 0]);
    expect(unknown?.message).toContain('`zzz_not_a_key`');
    expect(issues.some((i) => i.code === 'invalid_type' && i.path.join('.') === 'subforms.0.columns.0.name')).toBe(true);
  });

  it('refuses the retired `field` spelling with the prescription naming `name` — the other carrier\'s alias table, reached by reference', () => {
    const result = parseSubformColumns([{ field: 'quantity' }]);
    expect(result.success).toBe(false);
    const unknown = result.error!.issues.find((i) => i.code === 'unrecognized_keys');
    expect(unknown?.path).toEqual(['subforms', 0, 'columns', 0]);
    expect(unknown?.message).toContain('`field` → `name`');
  });

  it('passes the card\'s identity-only column carrying `scale`: the schema cannot see the child field — the cross-reference check judges it (below)', () => {
    const result = parseSubformColumns([IDENTITY_ONLY_WITH_SCALE]);
    expect(result.success).toBe(true);
  });

  it('CONTROLS — valid columns parse and keep their keys', () => {
    const columns = [
      { name: 'quantity' },
      { name: 'weight', type: 'number', computed: true, expr: 'quantity * 2', scale: 3 },
      { name: 'amount', type: 'currency', prefix: 'US$' },
      { name: 'status', type: 'select', options: [{ label: 'Open', value: 'open' }] },
    ];
    const result = parseSubformColumns(columns);
    expect(result.success).toBe(true);
    const parsed = (result.data as { subforms: Array<{ columns: unknown[] }> }).subforms[0].columns;
    expect(parsed).toEqual(columns);
  });
});

describe('#20901 — defineStack judges an identity-only column by the type it renders as', () => {
  it('refuses the card\'s identity-only column over a currency child field on the form view\'s `form`', () => {
    expectHydratedCurrencyRefusal(
      stackWithSubformColumns([{ name: 'quantity' }, IDENTITY_ONLY_WITH_SCALE]),
      'View[0].form.subforms[0].columns[1].scale',
    );
  });

  it('refuses it on a named `formViews` entry too', () => {
    expectHydratedCurrencyRefusal(
      stackWithSubformColumns([IDENTITY_ONLY_WITH_SCALE], 'formViews'),
      'View[0].formViews.entry.subforms[0].columns[0].scale',
    );
  });

  it('refuses it on the other carrier, a relationship field\'s `inlineColumns`, where the column names a field of the object that owns the field', () => {
    expectHydratedCurrencyRefusal(
      stackWithInlineColumns([{ name: 'quantity' }, IDENTITY_ONLY_WITH_SCALE]),
      "Object 'crm_invoice_line' field 'invoice' inlineColumns[1].scale",
    );
  });

  it('refuses the card\'s other two columns on the form-view carrier at the schema parse, before any cross-reference', () => {
    for (const column of [TYPED_CURRENCY_WITH_SCALE, BOGUS_KEY_ONLY]) {
      const refusal = refusalOf(stackWithSubformColumns([column]));
      expect(refusal.code, JSON.stringify(column)).toBe('STACK_SCHEMA_INVALID');
      expect(refusal.status, JSON.stringify(column)).toBe(422);
    }
  });

  it('CONTROLS — valid columns build on both carriers', () => {
    const columns = [
      { name: 'quantity', scale: 1 },
      { name: 'amount' },
      { name: 'amount', prefix: 'US$' },
      { name: 'amount', type: 'number', scale: 2 },
      { name: 'not_a_child_field', scale: 2 },
    ];
    expect(() => build(stackWithSubformColumns(columns))).not.toThrow();
    expect(() => build(stackWithSubformColumns(columns, 'formViews'))).not.toThrow();
    expect(() => build(stackWithInlineColumns(columns))).not.toThrow();
  });

  it('CONTROL — a child object this stack does not declare is not judged: an unresolved column is not a wrong one', () => {
    const stack = stackWithSubformColumns([IDENTITY_ONLY_WITH_SCALE], 'form', 'ext_line');
    expect(() => build(stack)).not.toThrow();
  });

  it('following the remedy builds: the refused column with `scale` deleted and nothing added', () => {
    const remedied: Record<string, unknown> = { ...IDENTITY_ONLY_WITH_SCALE };
    delete remedied.scale;
    expect(Object.keys(remedied)).toEqual(['name']);
    expect(() => build(stackWithSubformColumns([remedied]))).not.toThrow();
    expect(() => build(stackWithInlineColumns([remedied]))).not.toThrow();
  });
});
