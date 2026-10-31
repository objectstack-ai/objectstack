// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { FieldSchema, InlineGridColumnSchema } from './field.zod';
import { ObjectSchema } from './object.zod';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { defineStack } from '../stack.zod';

// ---------------------------------------------------------------------------
// [#27945] `lookupAutofill: [{ target, source, overwrite? }]` on a single-value
// relationship field: a pick in the lookup fills `target` (a field of THIS
// object) from `source` (a field of the referenced object). Three doors judge
// it, and each refusal is pinned here by its code and its path:
//
//  - field half (`FieldSchema`): only on a single-value `lookup` /
//    `master_detail`; a pair is a closed shape of snake_case names;
//  - target half (`ObjectSchema`): a declared field of this object, not the
//    lookup itself, not `readonly`, not computed, named once;
//  - source half (`defineStack`'s cross-reference pass): a declared field of
//    the referenced object, not `internal`, whose value the target can hold.
//
// The producer's own shape (HotCRM's quote line: `unit_price` from the picked
// product's `list_price`) parses clean, and the grid column key `autofill`
// keeps its contract (the control at the end).
// ---------------------------------------------------------------------------

const manifest = {
  id: 'com.example.lookupautofill',
  name: 'lookup-autofill-test',
  version: '1.0.0',
  type: 'app' as const,
};

const product = (extra: Record<string, unknown> = {}) => ({
  name: 'crm_product',
  label: 'Product',
  fields: {
    name: { type: 'text', label: 'Name' },
    description: { type: 'textarea', label: 'Description' },
    support_email: { type: 'email', label: 'Support Email' },
    list_price: { type: 'currency', label: 'List Price' },
    weight: { type: 'number', label: 'Weight' },
    is_active: { type: 'boolean', label: 'Active' },
    category: { type: 'lookup', label: 'Category', reference: 'crm_category' },
    tags: { type: 'multiselect', label: 'Tags', options: [{ label: 'Alpha', value: 'alpha' }] },
    cost_token: { type: 'text', label: 'Cost Token', internal: true },
    margin: { type: 'formula', label: 'Margin', returnType: 'currency', expression: 'record.list_price * 0.2' },
    ...extra,
  },
});

const category = { name: 'crm_category', label: 'Category', fields: { name: { type: 'text', label: 'Name' } } };
const region = { name: 'crm_region', label: 'Region', fields: { name: { type: 'text', label: 'Name' } } };

const line = (pairs: unknown, productField: Record<string, unknown> = {}) => ({
  name: 'crm_quote_line_item',
  label: 'Quote Line Item',
  fields: {
    crm_product: { type: 'lookup', label: 'Product', reference: 'crm_product', lookupAutofill: pairs, ...productField },
    unit_price: { type: 'currency', label: 'Sales Price' },
    list_price: { type: 'currency', label: 'List Price', readonly: true },
    quantity: { type: 'number', label: 'Quantity' },
    notes: { type: 'text', label: 'Notes' },
    description: { type: 'textarea', label: 'Description' },
    is_taxable: { type: 'boolean', label: 'Taxable' },
    category: { type: 'lookup', label: 'Category', reference: 'crm_category' },
    region: { type: 'lookup', label: 'Region', reference: 'crm_region' },
    tags: { type: 'multiselect', label: 'Tags', options: [{ label: 'Alpha', value: 'alpha' }] },
    subtotal: { type: 'formula', label: 'Subtotal', returnType: 'currency', expression: 'record.quantity * record.unit_price' },
    line_no: { type: 'autonumber', label: 'Line', autonumberFormat: 'L-{0000}' },
    net_price: { type: 'currency', label: 'Net', expression: 'record.unit_price * 0.9' },
  },
});

/** HotCRM's quote line, on the overwrite rule's default: the negotiated price is filled while empty. */
const HOTCRM_PAIRS = [{ target: 'unit_price', source: 'list_price' }];

type Issue = { code: string; path: PropertyKey[]; message: string };

/** The one issue a refused value must carry. */
function refusedOnce(result: { success: boolean; error?: { issues: Issue[] } }): Issue {
  expect(result.success, 'the declaration must NOT parse clean').toBe(false);
  expect(result.error!.issues).toHaveLength(1);
  return result.error!.issues[0]!;
}

/** The object's one located target refusal. */
function targetRefusedAt(pairs: unknown, index: number): Issue {
  const issue = refusedOnce(ObjectSchema.safeParse(line(pairs)) as never);
  expect([issue.code, issue.path]).toEqual(['custom', ['fields', 'crm_product', 'lookupAutofill', index, 'target']]);
  return issue;
}

const build = (stack: unknown) => defineStack(stack as Parameters<typeof defineStack>[0]);

type Refusal = { code?: string; status?: number; issues?: unknown[] };

/** The stack's one cross-reference finding, at the pair's source. */
function sourceRefusedAt(objects: unknown[], index: number): string {
  let refusal: Refusal | undefined;
  try {
    build({ manifest, objects });
  } catch (error) {
    refusal = error as Refusal;
  }
  expect(refusal, 'expected defineStack to REFUSE this stack, and it accepted it').toBeDefined();
  expect(refusal!.code).toBe('STACK_CROSS_REFERENCE_INVALID');
  expect(refusal!.status).toBe(422);
  expect(refusal!.issues).toHaveLength(1);
  const finding = String(refusal!.issues![0]);
  expect(finding.startsWith(`Object 'crm_quote_line_item' field 'crm_product' lookupAutofill[${index}].source: `)).toBe(true);
  return finding;
}

const stackOf = (pairs: unknown) => ({ manifest, objects: [category, region, product(), line(pairs)] });

describe('`lookupAutofill` — field half (FieldSchema)', () => {
  it('accepts the pairs on a `lookup` and on a `master_detail` (control)', () => {
    for (const type of ['lookup', 'master_detail']) {
      const parsed = FieldSchema.safeParse({ type, reference: 'crm_product', lookupAutofill: [{ target: 'unit_price', source: 'list_price', overwrite: true }] });
      expect(parsed.success).toBe(true);
    }
  });

  it('refuses the key on a field that is not a relationship', () => {
    const issue = refusedOnce(FieldSchema.safeParse({ type: 'text', lookupAutofill: HOTCRM_PAIRS }) as never);
    expect([issue.code, issue.path]).toEqual(['custom', ['lookupAutofill']]);
    expect(issue.message.startsWith("`lookupAutofill` is only valid on `type: 'lookup'` or `type: 'master_detail'`")).toBe(true);
  });

  it('refuses the key on a multi-value relationship', () => {
    const issue = refusedOnce(FieldSchema.safeParse({ type: 'lookup', reference: 'crm_product', multiple: true, lookupAutofill: HOTCRM_PAIRS }) as never);
    expect([issue.code, issue.path]).toEqual(['custom', ['lookupAutofill']]);
    expect(issue.message.startsWith('`lookupAutofill` is not valid on a multi-value relationship (`multiple: true`)')).toBe(true);
  });

  it('refuses an empty list, a non-snake_case name and an unknown key in a pair', () => {
    const empty = refusedOnce(FieldSchema.safeParse({ type: 'lookup', reference: 'crm_product', lookupAutofill: [] }) as never);
    expect([empty.code, empty.path]).toEqual(['too_small', ['lookupAutofill']]);

    const casing = refusedOnce(FieldSchema.safeParse({ type: 'lookup', reference: 'crm_product', lookupAutofill: [{ target: 'UnitPrice', source: 'list_price' }] }) as never);
    expect([casing.code, casing.path]).toEqual(['invalid_format', ['lookupAutofill', 0, 'target']]);

    const alias = refusedOnce(FieldSchema.safeParse({ type: 'lookup', reference: 'crm_product', lookupAutofill: [{ target: 'unit_price', from: 'list_price', source: 'list_price' }] }) as never);
    expect([alias.code, alias.path]).toEqual(['unrecognized_keys', ['lookupAutofill', 0]]);
    expect(alias.message).toContain('`source`');
  });
});

describe('`lookupAutofill` — target half (ObjectSchema)', () => {
  it('accepts the producer shape, and each target kind a pick may fill (control)', () => {
    expect(ObjectSchema.safeParse(line(HOTCRM_PAIRS)).success).toBe(true);
    expect(ObjectSchema.safeParse(line([
      { target: 'unit_price', source: 'list_price' },
      { target: 'description', source: 'description', overwrite: true },
      { target: 'category', source: 'category' },
    ])).success).toBe(true);
  });

  it('refuses the lookup itself as a target', () => {
    expect(targetRefusedAt([{ target: 'crm_product', source: 'name' }], 0).message).toContain('which is the lookup itself');
  });

  it('refuses a target the object does not declare', () => {
    expect(targetRefusedAt([{ target: 'sales_price', source: 'list_price' }], 0).message).toContain('declares no field `sales_price`');
  });

  it('refuses a `readonly` target', () => {
    expect(targetRefusedAt([{ target: 'list_price', source: 'list_price' }], 0).message).toContain('a `readonly` field');
  });

  it('refuses a computed target — formula, autonumber, and a stored field with an `expression`', () => {
    expect(targetRefusedAt([{ target: 'subtotal', source: 'list_price' }], 0).message).toContain('a `formula` field');
    expect(targetRefusedAt([{ target: 'line_no', source: 'name' }], 0).message).toContain('a `autonumber` field');
    expect(targetRefusedAt([{ target: 'net_price', source: 'list_price' }], 0).message).toContain('computed from its `expression`');
  });

  it('refuses a target named by an earlier pair, at the later pair', () => {
    const issue = targetRefusedAt([
      { target: 'unit_price', source: 'list_price' },
      { target: 'unit_price', source: 'margin', overwrite: true },
    ], 1);
    expect(issue.message).toContain('an earlier pair of this field already fills');
  });

  it('refuses at the save door too (the registered `object` type schema)', () => {
    const objectType = getMetadataTypeSchema('object')!;
    const issue = refusedOnce(objectType.safeParse(line([{ target: 'list_price', source: 'list_price' }])) as never);
    expect([issue.code, issue.path]).toEqual(['custom', ['fields', 'crm_product', 'lookupAutofill', 0, 'target']]);
  });
});

describe('`lookupAutofill` — source half (defineStack cross-reference)', () => {
  it('accepts the producer shape and every compatible pairing (control)', () => {
    expect(() => build(stackOf(HOTCRM_PAIRS))).not.toThrow();
    expect(() => build(stackOf([
      { target: 'unit_price', source: 'margin' }, // a currency formula into currency
      { target: 'quantity', source: 'weight' }, // number into number
      { target: 'notes', source: 'support_email' }, // a string into plain text
      { target: 'description', source: 'description', overwrite: true },
      { target: 'is_taxable', source: 'is_active' },
      { target: 'category', source: 'category' }, // a relationship over the same object
      { target: 'tags', source: 'tags' },
    ]))).not.toThrow();
    // `number` and `currency` hold each other's value.
    expect(() => build(stackOf([{ target: 'quantity', source: 'list_price' }]))).not.toThrow();
  });

  it('does not judge a referenced object the stack does not declare, nor an injected audit column', () => {
    expect(() => build({ manifest, objects: [category, region, line([{ target: 'notes', source: 'anything' }])] })).not.toThrow();
    expect(() => build(stackOf([{ target: 'notes', source: 'created_at' }]))).not.toThrow();
  });

  it('refuses a source the referenced object does not declare', () => {
    const finding = sourceRefusedAt([category, region, product(), line([{ target: 'unit_price', source: 'price' }])], 0);
    expect(finding).toContain("'price' is not a field of 'crm_product'");
  });

  it('refuses an `internal` source', () => {
    const finding = sourceRefusedAt([category, region, product(), line([{ target: 'notes', source: 'cost_token' }])], 0);
    expect(finding).toContain("'crm_product.cost_token' is `internal`");
  });

  it('refuses a source whose value the target cannot hold', () => {
    const objects = (pairs: unknown) => [category, region, product(), line(pairs)];
    expect(sourceRefusedAt(objects([{ target: 'unit_price', source: 'name' }]), 0))
      .toContain("cannot fill 'crm_quote_line_item.unit_price' — the target cannot hold the source's value (`text` → `currency`)");
    expect(sourceRefusedAt(objects([{ target: 'unit_price', source: 'list_price' }, { target: 'is_taxable', source: 'weight' }]), 1))
      .toContain("the target cannot hold the source's value (`number` → `boolean`)");
    expect(sourceRefusedAt(objects([{ target: 'region', source: 'category' }]), 0))
      .toContain("a record id fills only a relationship over the same object (`lookup` over 'crm_category' → `lookup` over 'crm_region')");
    expect(sourceRefusedAt(objects([{ target: 'notes', source: 'tags' }]), 0))
      .toContain('one holds a list and the other a single value (`multiselect` → `text`)');
    expect(sourceRefusedAt(objects([{ target: 'is_taxable', source: 'margin' }]), 0))
      .toContain("the target cannot hold the source's value (`formula` returning `currency` → `boolean`)");
  });
});

describe('control: the grid column key `autofill` keeps its contract', () => {
  it('a lookup column still takes `autofill` on and off, and its describe is unchanged', () => {
    for (const autofill of [true, false]) {
      expect(InlineGridColumnSchema.safeParse({ name: 'crm_product', type: 'lookup', reference: 'crm_product', autofill }).success).toBe(true);
    }
    expect(InlineGridColumnSchema.safeParse({ name: 'crm_product' }).success).toBe(true);
    const shape = (InlineGridColumnSchema as unknown as { shape: Record<string, { description?: string }> }).shape;
    expect(shape.autofill!.description).toBe(
      "For `lookup` columns: picking a record copies its same-named fields into sibling columns (a product's unit_price/description). On by default; set false to disable.",
    );
  });

  it('the declared pairs live on the field: a grid column refuses `lookupAutofill`', () => {
    const issue = refusedOnce(InlineGridColumnSchema.safeParse({ name: 'crm_product', lookupAutofill: HOTCRM_PAIRS }) as never);
    expect(issue.code).toBe('unrecognized_keys');
  });
});
