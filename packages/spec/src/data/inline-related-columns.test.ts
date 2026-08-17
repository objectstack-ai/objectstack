// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9227 — `inlineColumns` / `relatedListColumns` strictness.
 *
 * Both keys were `z.array(z.any())`: every column object validated — right
 * keys, wrong keys, misspelled keys, empty objects — so a mis-keyed column
 * published clean and the only place it was ever noticed was the browser, as
 * a grid with the right row COUNT and every cell blank (objectui#3951
 * measured exactly this failure in the renderer; `z.any()` kept it reachable
 * from the authoring side after the renderer was fixed).
 *
 * What is pinned here:
 *
 *   1. THE DOOR — both column lists are reached THROUGH `FieldSchema` on a
 *      real relationship field, not as standalone schemas: strictness does
 *      not recurse, so a closed parent proves nothing about a nested element.
 *   2. `inlineColumns`: the strict `name`-keyed element mirrors the objectui
 *      grid renderer's measured reads (GridField.tsx `GridColumn` +
 *      deriveMasterDetail.ts hydration). The retired `field` spelling is
 *      refused WITH the prescription naming `name` (the maintainer-ruled
 *      #4001 refusal shape); unknown keys get the named-surface refusal.
 *   3. `expr` stays a BARE arithmetic string — the grid's own evaluator
 *      (`evalArith`) tokenizes a string; a CEL envelope authored there would
 *      parse clean and render every computed cell '—'. The refusal is the
 *      producer-side guard for that renderer fact.
 *   4. `relatedListColumns`: child field-name STRINGS only, matching every
 *      in-repo usage and the strings-only page-block sibling
 *      (`record:related_list.columns`, ui/component.zod.ts). A column OBJECT
 *      is refused with the derivation prescription.
 *   5. The showcase invoice fixture form — identity-only `{ name }` entries —
 *      parses, so the one authored in-repo usage stays green in the spelling
 *      the renderer actually reads.
 */

import { describe, it, expect } from 'vitest';

import { FieldSchema, InlineGridColumnSchema } from './field.zod';

/** Reject `value` through `schema` and return its issues as a searchable string. */
function reject(
  schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } },
  value: unknown,
): string {
  const r = schema.safeParse(value);
  expect(r.success, `expected REJECTION, got a successful parse of ${JSON.stringify(value)}`).toBe(false);
  return JSON.stringify((r.error as { issues?: unknown })?.issues ?? r.error ?? []);
}

/** Parse `value` and fail loudly (with the issues) if it does not succeed. */
function accept(
  schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown; data?: unknown } },
  value: unknown,
): unknown {
  const r = schema.safeParse(value);
  expect(r.success, `expected ACCEPTANCE, got ${JSON.stringify((r.error as { issues?: unknown })?.issues ?? '')}`).toBe(true);
  return r.data;
}

/** A minimal master_detail relationship field — the real carrier of both keys. */
const MD_FIELD = {
  name: 'invoice',
  label: 'Invoice',
  type: 'master_detail',
  reference: 'showcase_invoice',
} as const;

const acceptField = (patch: Record<string, unknown>): unknown =>
  accept(FieldSchema, { ...MD_FIELD, ...patch });
const rejectField = (patch: Record<string, unknown>): string =>
  reject(FieldSchema, { ...MD_FIELD, ...patch });

// ===========================================================================
// 1. inlineColumns — the strict name-keyed grid column
// ===========================================================================
describe('#9227 inlineColumns — strict name-keyed element', () => {
  it('accepts identity-only entries (the showcase invoice fixture form)', () => {
    const parsed = acceptField({
      inlineEdit: 'grid',
      inlineTitle: 'Line Items',
      inlineColumns: [
        { name: 'product' },
        { name: 'description' },
        { name: 'service_start' },
        { name: 'quantity' },
        { name: 'unit_price' },
        { name: 'receipt' },
        { name: 'amount' },
      ],
    }) as { inlineColumns: Array<{ name: string }> };
    expect(parsed.inlineColumns).toHaveLength(7);
    expect(parsed.inlineColumns[0]).toEqual({ name: 'product' });
  });

  it('accepts every measured renderer-read key on one column, round-tripping the values', () => {
    const parsed = acceptField({
      inlineEdit: 'grid',
      inlineColumns: [{
        name: 'unit_price',
        label: 'Unit Price',
        type: 'currency',
        width: 140,
        required: true,
        prefix: '$',
        step: 0.01,
        defaultHidden: false,
        scale: 2,
      }, {
        name: 'product',
        type: 'lookup',
        reference: 'showcase_product',
        displayField: 'name',
        idField: 'id',
        multiple: false,
        autofill: true,
        readonlyWhen: "parent.status == 'paid'",
      }, {
        name: 'status',
        type: 'select',
        options: [{ label: 'Draft', value: 'draft' }, { label: 'Sent', value: 'sent' }],
        requiredWhen: { dialect: 'cel', source: 'record.quantity > 100' },
      }, {
        name: 'receipt',
        type: 'file',
        accept: ['image/*', '.pdf'],
      }, {
        name: 'amount',
        computed: true,
        expr: 'quantity * unit_price',
        scale: 2,
      }],
    }) as { inlineColumns: Array<Record<string, unknown>> };
    expect(parsed.inlineColumns[0]).toMatchObject({ name: 'unit_price', type: 'currency', width: 140, prefix: '$' });
    // Bare-string CEL predicates normalize to the Expression envelope, exactly
    // as the field-level readonlyWhen does (same ExpressionInputSchema).
    expect(parsed.inlineColumns[1].readonlyWhen).toEqual({ dialect: 'cel', source: "parent.status == 'paid'" });
    expect(parsed.inlineColumns[2].requiredWhen).toMatchObject({ dialect: 'cel', source: 'record.quantity > 100' });
    // The computed column's expr survives as the BARE string the grid evaluator reads.
    expect(parsed.inlineColumns[4].expr).toBe('quantity * unit_price');
  });

  it('refuses the retired `field` spelling with the prescription naming `name`', () => {
    const issues = rejectField({
      inlineEdit: 'grid',
      inlineColumns: [{ field: 'amount', label: 'Amount', type: 'currency' }],
    });
    expect(issues).toContain('this inline grid column');
    expect(issues).toContain('`field`');
    expect(issues).toContain('`field` → `name`');
    // The refusal also fires because `name` is missing — the element is not
    // merely stripped-and-accepted.
    expect(issues).toContain('name');
  });

  it('refuses an unknown key with the named surface and a distance suggestion', () => {
    const issues = rejectField({
      inlineEdit: 'grid',
      inlineColumns: [{ name: 'amount', lable: 'Amount' }],
    });
    expect(issues).toContain('Unrecognized key(s) on this inline grid column');
    expect(issues).toContain('`lable` → `label`');
  });

  it('refuses a nonsense key outright (the issue repro: publish-time, not blank cells)', () => {
    const issues = rejectField({
      inlineEdit: 'grid',
      inlineColumns: [{ name: 'amount', zzz: 1 }],
    });
    expect(issues).toContain('Unrecognized key(s) on this inline grid column');
    expect(issues).toContain('`zzz`');
  });

  it('refuses a bare string where a column object belongs', () => {
    rejectField({ inlineEdit: 'grid', inlineColumns: ['amount'] });
  });

  it('refuses a `type` outside the grid renderer cell-control vocabulary', () => {
    const issues = rejectField({
      inlineEdit: 'grid',
      inlineColumns: [{ name: 'notes', type: 'textarea' }],
    });
    // The refusal lands at the column's own `type` path and names the whole
    // cell-control vocabulary (the enum echoes the options, not the input).
    expect(issues).toContain('"path":["inlineColumns",0,"type"]');
    expect(issues).toContain('"select"');
    expect(issues).toContain('"lookup"');
  });

  it('refuses a CEL envelope on `expr` — the grid evaluator reads a bare arithmetic string', () => {
    const issues = rejectField({
      inlineEdit: 'grid',
      inlineColumns: [{ name: 'amount', computed: true, expr: { dialect: 'cel', source: 'quantity * unit_price' } }],
    });
    expect(issues).toContain('expr');
  });

  it('refuses the field-level `expression` spelling on a column, prescribing `expr`', () => {
    const issues = rejectField({
      inlineEdit: 'grid',
      inlineColumns: [{ name: 'amount', expression: 'quantity * unit_price' }],
    });
    expect(issues).toContain('`expression` → `expr`');
  });

  it('refuses a mis-keyed select option inside `options`', () => {
    const issues = rejectField({
      inlineEdit: 'grid',
      inlineColumns: [{ name: 'status', type: 'select', options: [{ text: 'Draft', value: 'draft' }] }],
    });
    expect(issues).toContain('this inline grid column option');
    expect(issues).toContain('`text` → `label`');
  });

  it('the element schema is exported and closed on its own', () => {
    accept(InlineGridColumnSchema, { name: 'quantity' });
    reject(InlineGridColumnSchema, { name: 'quantity', field: 'quantity' });
  });
});

// ===========================================================================
// 2. relatedListColumns — child field-name strings only
// ===========================================================================
describe('#9227 relatedListColumns — strings only', () => {
  it('accepts the in-repo showcase spellings', () => {
    const parsed = acceptField({
      relatedListColumns: ['name', 'status', 'total', 'issued_on'],
    }) as { relatedListColumns: string[] };
    expect(parsed.relatedListColumns).toEqual(['name', 'status', 'total', 'issued_on']);
    acceptField({ relatedListColumns: ['title', 'status', 'priority', 'assignee', 'due_date'] });
    acceptField({ relatedListColumns: ['name', 'status', 'health', 'budget', 'end_date'] });
  });

  it('refuses a column OBJECT with the derivation prescription', () => {
    const issues = rejectField({
      relatedListColumns: [{ name: 'amount', label: 'Amount' }],
    });
    expect(issues).toContain('FIELD-NAME strings');
    expect(issues).toContain("child object's field definitions");
  });

  it('refuses the object form in the retired grid spelling too — same named refusal', () => {
    const issues = rejectField({
      relatedListColumns: [{ field: 'amount' }],
    });
    expect(issues).toContain('FIELD-NAME strings');
  });

  it('refuses an empty-string column', () => {
    rejectField({ relatedListColumns: [''] });
  });
});
