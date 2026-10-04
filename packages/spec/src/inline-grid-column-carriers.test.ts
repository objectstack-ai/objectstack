// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20901 — an inline grid column is judged on BOTH of its carriers, and by the
 * type it renders as. #20928 brought the THIRD carrier, an
 * `object-master-detail-form` page block's `details[].columns`, to the same
 * contract (its own section near the bottom of this file), and #21142 the
 * FOURTH, a `record:line_items` page block's `columns` (the last section).
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
 *   4. THE TABLE — every type-conditional rule of the column schema, found by
 *      probing it, reaches `defineStack` through the hydrated-type table.
 *   5. THE CHAIN STEP — the `field` → `name` respelling reaches the form-view
 *      carrier (ADR-0087's lossless-break step): stored rows in every `view`
 *      spelling and `os migrate meta` get it; the authoring funnel does not.
 *
 * Key-vs-value note: the column rules judge the KEY on one type whatever its
 * value, so each refusal is a full parse failure at the column's own path, and
 * each control is a full success — never mere absence of `unrecognized_keys`.
 */

import { describe, expect, it } from 'vitest';
import { ALL_CONVERSIONS } from './conversions/registry';
import { applyConversionsToStoredItem } from './conversions/stored';
import { InlineGridColumnSchema } from './data/field.zod';
import { applyMetaMigrations } from './migrations/chain';
import { FormViewSchema, ViewMetadataSchema } from './ui/view.zod';
import { ComponentPropsMap } from './ui/component.zod';
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

// ---------------------------------------------------------------------------
// The hydrated-type table in `stack.zod.ts` covers every type-conditional rule.
// ---------------------------------------------------------------------------

/** Values tried for each column key; a key is probed with every one its own schema accepts. */
const PROBE_VALUES: readonly unknown[] = [0, 2, true, 'x', ['x'], [{ label: 'A', value: 'a' }]];

type TypeConditionalRule = { type: string; key: string; value: unknown };

/**
 * Every rule of `InlineGridColumnSchema` that depends on the column's `type`,
 * found by probing the schema rather than listed: a (type, key, value) is one
 * when the column parses with the key alone and with the type alone, and not
 * with both. A key no probe value satisfies is reported, not skipped — its rules
 * would be invisible here.
 */
function typeConditionalRules(): { rules: TypeConditionalRule[]; unprobed: string[] } {
  const shape = InlineGridColumnSchema.shape as unknown as Record<string, unknown>;
  const types = (shape.type as { unwrap(): { options: string[] } }).unwrap().options;
  const keys = Object.keys(shape).filter((key) => key !== 'name' && key !== 'type');
  const accepts = (column: Record<string, unknown>) => InlineGridColumnSchema.safeParse(column).success;
  const rules: TypeConditionalRule[] = [];
  const unprobed: string[] = [];
  for (const type of types) {
    if (!accepts({ name: 'probe', type })) rules.push({ type, key: '(none)', value: undefined });
  }
  for (const key of keys) {
    const values = PROBE_VALUES.filter((value) => accepts({ name: 'probe', [key]: value }));
    if (values.length === 0) unprobed.push(key);
    for (const value of values) {
      for (const type of types) {
        if (!accepts({ name: 'probe', type, [key]: value })) rules.push({ type, key, value });
      }
    }
  }
  return { rules, unprobed };
}

/**
 * A stack whose child object carries a field `probe` of `fieldType`, and an
 * identity-only `inlineColumns` entry over it. The field type is the column
 * type's own name: at the `.objectui-sha` pin `db11afd4967c`,
 * `fieldTypeToColumnType` maps each of the column schema's nine types' namesake
 * field type to that same column type.
 */
const stackWithProbeField = (fieldType: string, column: Record<string, unknown>) => {
  const child = childObject([column]);
  return { manifest, objects: [PARENT, { ...child, fields: { ...child.fields, probe: { type: fieldType } } }] };
};

describe('#20901 — every type-conditional column rule has its row in the hydrated-type table', () => {
  it('the probe reaches every column key, and finds the rule the tree holds today', () => {
    const { rules, unprobed } = typeConditionalRules();
    expect(unprobed, 'column keys no probe value satisfies — add a value to PROBE_VALUES').toEqual([]);
    // Anti-vacuity: a probe that found nothing would pass the check below vacuously.
    expect(rules.some((r) => r.type === 'currency' && r.key === 'scale')).toBe(true);
  });

  it('defineStack refuses each one on an identity-only column over a field of that type', () => {
    for (const { type, key, value } of typeConditionalRules().rules) {
      const column = key === '(none)' ? { name: 'probe' } : { name: 'probe', [key]: value };
      const subject = `the column schema refuses ${key === '(none)' ? 'a bare' : `\`${key}: ${JSON.stringify(value)}\` on a`} `
        + `\`${type}\` column`;
      let refusal: Refusal | undefined;
      try {
        build(stackWithProbeField(type, column));
      } catch (error) {
        refusal = error as Refusal;
      }
      expect(
        refusal,
        `${subject}, and defineStack accepted an identity-only column over a \`${type}\` child field `
          + 'carrying it — add the row to HYDRATED_INLINE_COLUMN_TYPE in stack.zod.ts',
      ).toBeDefined();
      expect(refusal!.code, subject).toBe('STACK_CROSS_REFERENCE_INVALID');
      expect(refusal!.status, subject).toBe(422);
    }
  });
});

// ---------------------------------------------------------------------------
// The `field` → `name` respelling reaches the form-view carrier (ADR-0087 D2).
// ---------------------------------------------------------------------------

describe('#20901 — the `field` → `name` respelling is a chain step on the form-view carrier', () => {
  const ID = 'form-view-subform-columns-canonicalized';
  const conversion = () => ALL_CONVERSIONS.find((c) => c.id === ID);
  const form = (columns: unknown[]) => ({ ...FORM_BASE, subforms: [{ childObject: 'crm_invoice_line', columns }] });
  const LEGACY = [{ field: 'quantity', label: 'Qty' }, { name: 'amount' }];
  const RESPELLED = [{ name: 'quantity', label: 'Qty' }, { name: 'amount' }];

  /** A stored `view` row in each spelling `ViewMetadataSchema` accepts. */
  const storedRows = (columns: unknown[]) => ({
    container: { name: 'crm_invoice', object: 'crm_invoice', formViews: { entry: form(columns) } },
    record: { name: 'crm_invoice.entry', object: 'crm_invoice', viewKind: 'form', config: form(columns) },
    overlay: { name: 'crm_invoice.edit', object: 'crm_invoice', viewKind: 'form', ...form(columns) },
  });
  const columnsOf = (row: Record<string, any>): unknown[] =>
    (row.formViews?.entry ?? row.config ?? row).subforms[0].columns;

  it('is a retired protocol-18 entry stamped with the last release whose form-view carrier accepted `field`', () => {
    expect(conversion()?.toMajor).toBe(18);
    expect(conversion()?.retiredFromLoadPath).toBe(true);
    expect(conversion()?.retiredAfter).toBe('17.5.0');
  });

  it('a stored row in each `view` spelling is respelled, and only then parses', () => {
    for (const [spelling, row] of Object.entries(storedRows(LEGACY))) {
      expect(ViewMetadataSchema.safeParse(row).success, `${spelling}, as stored`).toBe(false);
      const converted = applyConversionsToStoredItem('view', structuredClone(row)) as Record<string, any>;
      expect(columnsOf(converted), spelling).toEqual(RESPELLED);
      expect(ViewMetadataSchema.safeParse(converted).success, `${spelling}, converted`).toBe(true);
    }
  });

  it('CONTROLS — an entry already spelled `name`, and one carrying both keys, are left as they are', () => {
    const columns = [{ name: 'quantity' }, { field: 'amount', name: 'total' }];
    for (const [spelling, row] of Object.entries(storedRows(columns))) {
      expect(applyConversionsToStoredItem('view', row), spelling).toBe(row);
    }
  });

  it('`os migrate meta` replays it: the step-18 chain respells a source stack, one edit per column', () => {
    const result = applyMetaMigrations(structuredClone(stackWithSubformColumns(LEGACY, 'formViews')), 17, 18);
    const views = result.stack.views as Array<Record<string, any>>;
    expect(views[0].formViews.entry.subforms[0].columns).toEqual(RESPELLED);
    expect(result.applied.filter((a) => a.conversionId === ID).map((a) => a.path)).toEqual([
      'views[0].formViews.entry.subforms[0].columns[0].name',
    ]);
  });

  it('the authoring funnel does not replay it: defineStack refuses the `field` spelling at the schema parse', () => {
    const refusal = refusalOf(stackWithSubformColumns(LEGACY));
    expect(refusal.code).toBe('STACK_SCHEMA_INVALID');
    expect(refusal.status).toBe(422);
  });

  it('both carriers get one respelling: a field\'s `inlineColumns` and a subform\'s `columns` convert alike', () => {
    const columns = [...LEGACY, { field: 'amount', name: 'total' }, 'not-a-column'];
    const object = applyConversionsToStoredItem('object', childObject(columns)) as Record<string, any>;
    const view = applyConversionsToStoredItem('view', storedRows(columns).container) as Record<string, any>;
    expect(columnsOf(view)).toEqual(object.fields.invoice.inlineColumns);
    expect(columnsOf(view)).toEqual([...RESPELLED, { field: 'amount', name: 'total' }, 'not-a-column']);
  });
});

// ---------------------------------------------------------------------------
// #20928 — the third carrier: an `object-master-detail-form` block's `details`.
// ---------------------------------------------------------------------------

/**
 * The page block `object-master-detail-form` draws one inline grid per
 * `details` entry, hydrating an authored `columns` list with the same objectui
 * `hydrateColumns` the other two carriers feed. `details` was
 * `z.array(z.unknown())`, so the card's probe — `{ zzz_not_a_key: 1 }` and a
 * typed `currency` column with `scale` — went through `os validate` green.
 *
 * Two halves, two doors, the same split as the form-view carrier:
 *
 *   - the PROPS SCHEMA (`ComponentPropsMap['object-master-detail-form']`) is
 *     the entry contract: a strict entry whose `columns` IS
 *     `InlineGridColumnSchema`. Page-component `properties` is an open record
 *     the stack's parse never reaches, so this half is read by the
 *     component-props gate (`@objectstack/lint`), not by `defineStack`;
 *   - `defineStack`'s cross-reference check reaches the block on a page and
 *     judges an identity-only column by its child field's type. Because the
 *     column was never parsed on this carrier, it judges only a column that is
 *     valid without the type, and leaves the column's own defects to the
 *     props half — so a finding here is always one the resolved type brings.
 */
const MASTER_DETAIL_PROPS = ComponentPropsMap['object-master-detail-form'];

/**
 * Every key objectui's `MasterDetailForm` reads off a detail entry (the
 * `.objectui-sha` pin `31971ff1e28f`, re-read at `89cad75d5570`). `sortField`
 * is not one of them: the renderer derives the line-position field from the
 * child object, and the key is a tombstone (#21589,
 * `ui/master-detail-detail-sort-field-retirement.test.ts`).
 */
const FULL_DETAIL_ENTRY = {
  childObject: 'crm_invoice_line',
  relationshipField: 'invoice',
  columns: [{ name: 'quantity' }],
  formFields: ['quantity', 'amount'],
  inlineMode: 'grid',
  amountField: 'amount',
  totalField: 'total',
  title: 'Lines',
  minRows: 1,
  maxRows: 20,
  addLabel: 'Add line',
} as const;

const parseDetails = (details: unknown[]): Result =>
  MASTER_DETAIL_PROPS.safeParse({ objectName: 'crm_invoice', details }) as Result;

const parseDetailColumns = (columns: unknown[]): Result =>
  parseDetails([{ childObject: 'crm_invoice_line', columns }]);

const masterDetailBlock = (columns: unknown[], child = 'crm_invoice_line') => ({
  type: 'object-master-detail-form',
  properties: { objectName: 'crm_invoice', details: [{ title: 'Lines', childObject: child, columns }] },
});

type PagePosition = 'region' | 'nested' | 'slot';

/** A stack whose one page carries the block in the given position. */
const stackWithMasterDetailColumns = (columns: unknown[], position: PagePosition = 'region', child?: string) => {
  const block = masterDetailBlock(columns, child);
  const page = {
    name: 'crm_invoice_entry',
    label: 'Invoice Entry',
    type: 'home' as const,
    regions: [{
      name: 'main',
      components: position === 'region' ? [block]
        : position === 'nested' ? [{ type: 'page:card', properties: { children: [block] } }]
          : [],
    }],
    ...(position === 'slot' ? { kind: 'slotted', slots: { details: [block] } } : {}),
  };
  return { manifest, objects: [PARENT, childObject()], pages: [page] };
};

describe('#20928 — the master-detail block\'s detail entry is strict, and its columns are the column contract', () => {
  it('its column element IS InlineGridColumnSchema — one contract, not a copy', () => {
    type Unwrapped = { unwrap(): { element: { shape: Record<string, { unwrap(): { element: unknown } }> } } };
    const details = (MASTER_DETAIL_PROPS.shape as unknown as Record<string, Unwrapped>).details;
    const columnElement = details.unwrap().element.shape.columns.unwrap().element;
    expect(columnElement).toBe(InlineGridColumnSchema);
  });

  it('refuses the card\'s typed currency column carrying `scale`, at the column\'s `scale`, with the ruled first sentence', () => {
    const result = parseDetailColumns([{ name: 'quantity' }, TYPED_CURRENCY_WITH_SCALE]);
    expect(result.success).toBe(false);
    expect(result.error!.issues).toHaveLength(1);
    const [issue] = result.error!.issues;
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual(['details', 0, 'columns', 1, 'scale']);
    expect(issue.message.startsWith(COLUMN_FIRST_SENTENCE)).toBe(true);
  });

  it('refuses the card\'s bogus-key column: the key is named, and the missing `name` is required', () => {
    const result = parseDetailColumns([BOGUS_KEY_ONLY]);
    expect(result.success).toBe(false);
    const issues = result.error!.issues;
    const unknown = issues.find((i) => i.code === 'unrecognized_keys');
    expect(unknown?.path).toEqual(['details', 0, 'columns', 0]);
    expect(unknown?.message).toContain('`zzz_not_a_key`');
    expect(issues.some((i) => i.code === 'invalid_type' && i.path.join('.') === 'details.0.columns.0.name')).toBe(true);
  });

  it('refuses the retired `field` spelling with the prescription naming `name`', () => {
    const result = parseDetailColumns([{ field: 'quantity' }]);
    expect(result.success).toBe(false);
    const unknown = result.error!.issues.find((i) => i.code === 'unrecognized_keys');
    expect(unknown?.path).toEqual(['details', 0, 'columns', 0]);
    expect(unknown?.message).toContain('`field` → `name`');
  });

  it('refuses an entry key the renderer does not read, naming it, and a near-miss with its rename', () => {
    const bogus = parseDetails([{ childObject: 'crm_invoice_line', zzz_not_a_key: 1 }]);
    expect(bogus.success).toBe(false);
    const unknown = bogus.error!.issues.find((i) => i.code === 'unrecognized_keys');
    expect(unknown?.path).toEqual(['details', 0]);
    expect(unknown?.message).toContain('`zzz_not_a_key`');

    const alias = parseDetails([{ childObject: 'crm_invoice_line', foreignKey: 'invoice' }]);
    expect(alias.success).toBe(false);
    expect(alias.error!.issues.find((i) => i.code === 'unrecognized_keys')?.message).toContain('`foreignKey` → `relationshipField`');
  });

  it('requires `childObject` — an entry without it is the renderer\'s declined branch, refused here instead', () => {
    const result = parseDetails([{ title: 'Lines' }]);
    expect(result.success).toBe(false);
    expect(result.error!.issues.some((i) => i.code === 'invalid_type' && i.path.join('.') === 'details.0.childObject')).toBe(true);
  });

  it('refuses an `inlineMode` outside the two form factors the renderer draws', () => {
    const result = parseDetails([{ childObject: 'crm_invoice_line', inlineMode: 'drawer' }]);
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].path).toEqual(['details', 0, 'inlineMode']);
  });

  it('passes the card\'s identity-only column carrying `scale`: the schema cannot see the child field — the cross-reference check judges it (below)', () => {
    expect(parseDetailColumns([IDENTITY_ONLY_WITH_SCALE]).success).toBe(true);
  });

  it('CONTROLS — the named producer\'s entry, and an entry carrying every key the renderer reads, parse and keep their keys', () => {
    const showcase = { title: 'Tasks', childObject: 'showcase_task', addLabel: 'Add task' };
    for (const entry of [showcase, FULL_DETAIL_ENTRY]) {
      const result = parseDetails([entry]);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
      expect((result.data as { details: unknown[] }).details).toEqual([entry]);
    }
    expect(Object.keys(FULL_DETAIL_ENTRY)).toHaveLength(11);
  });
});

describe('#20928 — defineStack judges an identity-only detail column by the type it renders as', () => {
  it('refuses the card\'s identity-only column over a currency child field, on a page region', () => {
    expectHydratedCurrencyRefusal(
      stackWithMasterDetailColumns([{ name: 'quantity' }, IDENTITY_ONLY_WITH_SCALE]),
      "Page 'crm_invoice_entry' (regions.0.components.0) object-master-detail-form details[0].columns[1].scale",
    );
  });

  it('refuses it inside a container and under a slot too — wherever the page carries the block', () => {
    expectHydratedCurrencyRefusal(
      stackWithMasterDetailColumns([IDENTITY_ONLY_WITH_SCALE], 'nested'),
      "Page 'crm_invoice_entry' (regions.0.components.0.properties.children.0) object-master-detail-form details[0].columns[0].scale",
    );
    expectHydratedCurrencyRefusal(
      stackWithMasterDetailColumns([IDENTITY_ONLY_WITH_SCALE], 'slot'),
      "Page 'crm_invoice_entry' (slots.details.0) object-master-detail-form details[0].columns[0].scale",
    );
  });

  it('leaves a column that is invalid on its own to the props half: no finding the resolved type does not bring', () => {
    // Identity-only, over the currency field, carrying `scale` — AND a key the
    // column schema refuses whatever its type. The props schema reports the
    // bogus key and nothing else; the stack does not re-report it as a
    // currency-column finding.
    const column = { ...IDENTITY_ONLY_WITH_SCALE, zzz_not_a_key: 1 };
    expect(parseDetailColumns([column]).success).toBe(false);
    expect(() => build(stackWithMasterDetailColumns([column]))).not.toThrow();
  });

  it('CONTROLS — valid columns build, and so do the card\'s other two columns, which only the props half reads', () => {
    const columns = [
      { name: 'quantity', scale: 1 },
      { name: 'amount' },
      { name: 'amount', prefix: 'US$' },
      { name: 'amount', type: 'number', scale: 2 },
      { name: 'not_a_child_field', scale: 2 },
    ];
    expect(() => build(stackWithMasterDetailColumns(columns))).not.toThrow();
    expect(() => build(stackWithMasterDetailColumns([TYPED_CURRENCY_WITH_SCALE, BOGUS_KEY_ONLY]))).not.toThrow();
  });

  it('CONTROL — a child object this stack does not declare is not judged', () => {
    expect(() => build(stackWithMasterDetailColumns([IDENTITY_ONLY_WITH_SCALE], 'region', 'ext_line'))).not.toThrow();
  });

  it('following the remedy builds: the refused column with `scale` deleted and nothing added', () => {
    expect(() => build(stackWithMasterDetailColumns([{ name: 'amount' }]))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// #21142 — the fourth carrier: a `record:line_items` block's `columns`.
// ---------------------------------------------------------------------------

/**
 * The page block `record:line_items` draws ONE inline grid of the record's
 * child rows, through the same objectui grid as the other three carriers. It
 * had no `ComponentPropsMap` row, so the component-props gate skipped it and
 * the showcase project page's five `field`-keyed columns published green over
 * a grid of empty cells.
 *
 * One difference from the master-detail block is pinned on purpose: this
 * panel hands `columns` to the grid as authored, with no hydration from the
 * child object's field. So an identity-only column has no resolved type for
 * `defineStack` to judge, and the cross-reference check does not reach this
 * block — the last test below is that control.
 */
const LINE_ITEMS_PROPS = ComponentPropsMap['record:line_items'];

/** Every key objectui's `LineItemsPanel` reads off its schema (the `.objectui-sha` pin `31971ff1e28f`). */
const FULL_LINE_ITEMS = {
  childObject: 'crm_invoice_line',
  relationshipField: 'invoice',
  columns: [{ name: 'quantity', label: 'Qty', type: 'number' }],
  parentObject: 'crm_invoice',
  parentId: 'inv_1',
  recordId: 'inv_1',
  amountField: 'amount',
  totalField: 'total',
  title: 'Lines',
  readonly: false,
  minRows: 1,
  maxRows: 20,
  filter: [{ field: 'quantity', operator: 'greater_than', value: 0 }],
  sort: [{ field: 'quantity', order: 'asc' }],
  limit: 100,
} as const;

const parseLineItems = (props: unknown): Result => LINE_ITEMS_PROPS.safeParse(props) as Result;

const parseLineItemColumns = (columns: unknown[]): Result =>
  parseLineItems({ childObject: 'crm_invoice_line', relationshipField: 'invoice', columns });

describe('#21142 — the line-items block is strict, and its columns are the column contract', () => {
  it('its column element IS InlineGridColumnSchema — one contract, not a copy', () => {
    const shape = (LINE_ITEMS_PROPS as unknown as { shape: Record<string, { element: unknown }> }).shape;
    expect(shape.columns.element).toBe(InlineGridColumnSchema);
  });

  it('refuses the card\'s `field`-keyed column by name, with the prescription naming `name`', () => {
    const result = parseLineItemColumns([{ field: 'title', label: 'Title', type: 'text' }]);
    expect(result.success).toBe(false);
    const unknown = result.error!.issues.find((i) => i.code === 'unrecognized_keys');
    expect(unknown?.path).toEqual(['columns', 0]);
    expect(unknown?.message).toContain('`field` → `name`');
    // The column's identity is missing too — the grid would bind nothing.
    expect(result.error!.issues.some((i) => i.code === 'invalid_type' && i.path.join('.') === 'columns.0.name')).toBe(true);
  });

  it('refuses the typed currency column carrying `scale`, at the column\'s `scale`, with the ruled first sentence', () => {
    const result = parseLineItemColumns([{ name: 'quantity' }, TYPED_CURRENCY_WITH_SCALE]);
    expect(result.success).toBe(false);
    expect(result.error!.issues).toHaveLength(1);
    const [issue] = result.error!.issues;
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual(['columns', 1, 'scale']);
    expect(issue.message.startsWith(COLUMN_FIRST_SENTENCE)).toBe(true);
  });

  it('refuses a bogus-key column: the key is named, and the missing `name` is required', () => {
    const result = parseLineItemColumns([BOGUS_KEY_ONLY]);
    expect(result.success).toBe(false);
    const unknown = result.error!.issues.find((i) => i.code === 'unrecognized_keys');
    expect(unknown?.path).toEqual(['columns', 0]);
    expect(unknown?.message).toContain('`zzz_not_a_key`');
  });

  it('requires `relationshipField` and at least one column — nothing on this panel derives either', () => {
    const noFk = parseLineItems({ childObject: 'crm_invoice_line', columns: [{ name: 'quantity' }] });
    expect(noFk.success).toBe(false);
    expect(noFk.error!.issues.some((i) => i.code === 'invalid_type' && i.path.join('.') === 'relationshipField')).toBe(true);

    const noColumns = parseLineItems({ childObject: 'crm_invoice_line', relationshipField: 'invoice' });
    expect(noColumns.success).toBe(false);
    expect(noColumns.error!.issues.some((i) => i.code === 'invalid_type' && i.path.join('.') === 'columns')).toBe(true);

    const emptyColumns = parseLineItemColumns([]);
    expect(emptyColumns.success).toBe(false);
    expect(emptyColumns.error!.issues.some((i) => i.code === 'too_small' && i.path.join('.') === 'columns')).toBe(true);
  });

  it('refuses a block key the renderer does not read, a near-miss with its rename, and a master-detail entry key with its reason', () => {
    const bogus = parseLineItems({ ...FULL_LINE_ITEMS, zzz_not_a_key: 1 });
    expect(bogus.success).toBe(false);
    const unknown = bogus.error!.issues.find((i) => i.code === 'unrecognized_keys');
    expect(unknown?.path).toEqual([]);
    expect(unknown?.message).toContain('`zzz_not_a_key`');

    const alias = parseLineItems({ childObject: 'crm_invoice_line', foreignKey: 'invoice', columns: [{ name: 'quantity' }] });
    expect(alias.success).toBe(false);
    expect(alias.error!.issues.find((i) => i.code === 'unrecognized_keys')?.message).toContain('`foreignKey` → `relationshipField`');

    const entryKey = parseLineItems({ ...FULL_LINE_ITEMS, addLabel: 'Add line' });
    expect(entryKey.success).toBe(false);
    const refused = entryKey.error!.issues.find((i) => i.code === 'unrecognized_keys');
    expect(refused?.message).toContain('`addLabel`');
    expect(refused?.message).toContain('object-master-detail-form');
  });

  it('CONTROLS — the showcase\'s five name-keyed columns, and a bag carrying every key the renderer reads, parse and keep their keys', () => {
    // The showcase project page's block, copied (a spec test does not import an example app).
    const showcase = {
      childObject: 'showcase_task',
      relationshipField: 'project',
      amountField: 'estimate_hours',
      title: 'Tasks',
      columns: [
        { name: 'title', label: 'Title', type: 'text', required: true },
        { name: 'status', label: 'Status', type: 'select', options: [{ label: 'Backlog', value: 'backlog' }] },
        { name: 'priority', label: 'Priority', type: 'select', options: [{ label: 'Low', value: 'low' }] },
        { name: 'estimate_hours', label: 'Estimate (h)', type: 'number' },
        { name: 'due_date', label: 'Due Date', type: 'date' },
      ],
    };
    for (const props of [showcase, FULL_LINE_ITEMS]) {
      const result = parseLineItems(props);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
      expect(result.data).toEqual(props);
    }
    expect(Object.keys(FULL_LINE_ITEMS)).toHaveLength(15);
    // `childObject` may come from the component-level `dataSource` binding instead.
    const viaBinding = Object.fromEntries(Object.entries(FULL_LINE_ITEMS).filter(([key]) => key !== 'childObject'));
    expect(parseLineItems(viaBinding).success).toBe(true);
  });

  it('CONTROL — defineStack does not judge an identity-only line-items column: the panel draws it unhydrated', () => {
    const page = {
      name: 'crm_invoice_record',
      label: 'Invoice',
      type: 'record' as const,
      object: 'crm_invoice',
      regions: [{
        name: 'main',
        components: [{
          type: 'record:line_items',
          properties: { childObject: 'crm_invoice_line', relationshipField: 'invoice', columns: [IDENTITY_ONLY_WITH_SCALE] },
        }],
      }],
    };
    expect(() => build({ manifest, objects: [PARENT, childObject()], pages: [page] })).not.toThrow();
    // The same column under the master-detail block IS judged — the reach is the carrier's.
    expect(() => build(stackWithMasterDetailColumns([IDENTITY_ONLY_WITH_SCALE]))).toThrow();
  });
});
