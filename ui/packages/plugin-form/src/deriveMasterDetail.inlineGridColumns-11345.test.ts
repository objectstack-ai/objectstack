/**
 * objectui#11345 — `deriveColumns` takes WHICH columns an inline master-detail
 * grid draws, their order and their `defaultHidden` flag from
 * `@objectstack/spec`'s `deriveInlineGridColumns`, and keeps its own per-column
 * builder for what each column carries.
 *
 * Two pins over one corpus, and they guard different things:
 *
 * 1. The names, order and `defaultHidden` ARE the spec's answer. This is what
 *    lets objectstack's `field-no-consumers` lint credit exactly the columns
 *    this grid draws: a local filter or budget creeping back in would let the
 *    two disagree, and this pin goes red the moment one changes an answer.
 * 2. The full output is what `deriveColumns` returned BEFORE the swap. The
 *    expected arrays below were produced by the implementation this card
 *    replaced (the local `curateColumns` budget), and `deriveColumns` is a
 *    public export of `@object-ui/plugin-form`: the swap must not move a single
 *    column, label, type or flag. The corpus covers the budget edge from both
 *    sides, `maxColumns` (explicit, `0`, negative), the relationship field,
 *    `exclude`, the filters, more required columns than the budget, a computed
 *    required column, and FALSY field definitions — the one input where the
 *    spec's identity-only names, hydrated by `hydrateColumns`, would answer a
 *    bare `{ name }` where this builder answers a text column.
 *
 * `toStrictEqual` on purpose: an own `defaultHidden: undefined` (or a dropped
 * `displayField: undefined`) is a different object to a consumer that spreads
 * or serializes it, and `toEqual` would read both as equal.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_MAX_INLINE_GRID_COLUMNS, deriveInlineGridColumns } from '@objectstack/spec/data';
import { deriveColumns, type ChildObjectSchemaLike } from './deriveMasterDetail';
import { en } from '@object-ui/i18n';

/** The `en` session's word for a boolean value: what `useBooleanValueLabel`
 *  (`@object-ui/fields`) draws under `en`. The derive functions require one
 *  (objectui#12924). */
const booleanLabel = (value: boolean) => (value ? en.common.yes : en.common.no);

type Opts = { relationshipField?: string; exclude?: string[]; maxColumns?: number };

const atBudget = {
  name: { type: 'text', label: 'Name' },
  qty: { type: 'number', label: 'Qty' },
  unit_price: { type: 'currency', label: 'Unit price' },
  status: { type: 'select', options: ['open', 'closed'] },
  due: { type: 'date' },
  notes: { type: 'text' },
  order: { type: 'master_detail', reference: 'order', required: true },
};

const onePast = { ...atBudget, memo: { type: 'textarea', label: 'Memo' } };

const wide = {
  sku: { type: 'text', label: 'SKU' },
  photo: { type: 'image' },
  product: { type: 'lookup', reference: 'product', displayField: 'name' },
  code: { type: 'text' },
  amount: { type: 'currency', required: true, expression: 'qty * unit_price', scale: 2 },
  qty: { type: 'number', required: true },
  unit_price: { type: 'currency' },
  discount: { type: 'percent' },
  delivered_on: { type: 'datetime' },
  shipped_at: { type: 'time' },
  tax_class: { type: 'radio', options: [{ label: 'Standard', value: 'std' }, { label: 'Zero', value: 0 }] },
  gift: { type: 'boolean' },
  remark: { type: 'email' },
  invoice: { type: 'master_detail', reference: 'invoice' },
};

const statusOptions = [{ label: 'open', value: 'open' }, { label: 'closed', value: 'closed' }];

const CORPUS: Array<{ title: string; schema: ChildObjectSchemaLike | undefined; opts?: Opts; before: unknown[] }> = [
  {
    title: 'exactly at the budget: no column hidden',
    schema: { name: 'line', fields: atBudget },
    opts: { relationshipField: 'order' },
    before: [
      { name: 'name', label: 'Name', type: 'text', required: false },
      { name: 'qty', label: 'Qty', type: 'number', required: false },
      { name: 'unit_price', label: 'Unit price', type: 'currency', required: false },
      { name: 'status', label: 'status', type: 'select', required: false, options: statusOptions },
      { name: 'due', label: 'due', type: 'date', required: false },
      { name: 'notes', label: 'notes', type: 'text', required: false },
    ],
  },
  {
    title: 'one past the budget: the lowest-priority column is hidden',
    schema: { name: 'line', fields: onePast },
    opts: { relationshipField: 'order' },
    before: [
      { name: 'name', label: 'Name', type: 'text', required: false },
      { name: 'qty', label: 'Qty', type: 'number', required: false },
      { name: 'unit_price', label: 'Unit price', type: 'currency', required: false },
      { name: 'status', label: 'status', type: 'select', required: false, options: statusOptions },
      { name: 'due', label: 'due', type: 'date', required: false },
      { name: 'notes', label: 'notes', type: 'text', required: false },
      { name: 'memo', label: 'Memo', type: 'text', required: false, defaultHidden: true },
    ],
  },
  {
    title: '`exclude` alone: the unexcluded relationship field is a required candidate',
    schema: { name: 'line', fields: onePast },
    opts: { exclude: ['notes'] },
    before: [
      { name: 'name', label: 'Name', type: 'text', required: false },
      { name: 'qty', label: 'Qty', type: 'number', required: false },
      { name: 'unit_price', label: 'Unit price', type: 'currency', required: false },
      { name: 'status', label: 'status', type: 'select', required: false, options: statusOptions },
      { name: 'due', label: 'due', type: 'date', required: false },
      { name: 'order', label: 'order', type: 'lookup', required: true, reference: 'order', displayField: undefined },
      { name: 'memo', label: 'Memo', type: 'text', required: false, defaultHidden: true },
    ],
  },
  {
    title: 'maxColumns 3',
    schema: { name: 'line', fields: onePast },
    opts: { relationshipField: 'order', maxColumns: 3 },
    before: [
      { name: 'name', label: 'Name', type: 'text', required: false },
      { name: 'qty', label: 'Qty', type: 'number', required: false },
      { name: 'unit_price', label: 'Unit price', type: 'currency', required: false, defaultHidden: true },
      { name: 'status', label: 'status', type: 'select', required: false, options: statusOptions },
      { name: 'due', label: 'due', type: 'date', required: false, defaultHidden: true },
      { name: 'notes', label: 'notes', type: 'text', required: false, defaultHidden: true },
      { name: 'memo', label: 'Memo', type: 'text', required: false, defaultHidden: true },
    ],
  },
  {
    title: 'maxColumns 0 hides nothing',
    schema: { name: 'line', fields: onePast },
    opts: { relationshipField: 'order', maxColumns: 0 },
    before: [
      { name: 'name', label: 'Name', type: 'text', required: false },
      { name: 'qty', label: 'Qty', type: 'number', required: false },
      { name: 'unit_price', label: 'Unit price', type: 'currency', required: false },
      { name: 'status', label: 'status', type: 'select', required: false, options: statusOptions },
      { name: 'due', label: 'due', type: 'date', required: false },
      { name: 'notes', label: 'notes', type: 'text', required: false },
      { name: 'memo', label: 'Memo', type: 'text', required: false },
    ],
  },
  {
    title: 'a negative maxColumns hides nothing',
    schema: { name: 'line', fields: onePast },
    opts: { relationshipField: 'order', maxColumns: -1 },
    before: [
      { name: 'name', label: 'Name', type: 'text', required: false },
      { name: 'qty', label: 'Qty', type: 'number', required: false },
      { name: 'unit_price', label: 'Unit price', type: 'currency', required: false },
      { name: 'status', label: 'status', type: 'select', required: false, options: statusOptions },
      { name: 'due', label: 'due', type: 'date', required: false },
      { name: 'notes', label: 'notes', type: 'text', required: false },
      { name: 'memo', label: 'Memo', type: 'text', required: false },
    ],
  },
  {
    title: 'wide: a name-like primary that is not first, a computed required column, fill-priority ties',
    schema: { name: 'invoice_line', fields: wide },
    opts: { relationshipField: 'invoice' },
    before: [
      { name: 'sku', label: 'SKU', type: 'text', required: false, defaultHidden: true },
      { name: 'photo', label: 'photo', type: 'file', required: false, accept: ['image/*'], defaultHidden: true },
      { name: 'product', label: 'product', type: 'lookup', required: false, reference: 'product', displayField: 'name', defaultHidden: true },
      { name: 'code', label: 'code', type: 'text', required: false },
      { name: 'amount', label: 'amount', type: 'currency', required: false, computed: true, expr: 'qty * unit_price', scale: 2 },
      { name: 'qty', label: 'qty', type: 'number', required: true },
      { name: 'unit_price', label: 'unit_price', type: 'currency', required: false },
      { name: 'discount', label: 'discount', type: 'number', required: false, defaultHidden: true },
      { name: 'delivered_on', label: 'delivered_on', type: 'datetime', required: false, defaultHidden: true },
      { name: 'shipped_at', label: 'shipped_at', type: 'time', required: false, defaultHidden: true },
      { name: 'tax_class', label: 'tax_class', type: 'select', required: false, options: [{ label: 'Standard', value: 'std' }, { label: 'Zero', value: '0' }] },
      { name: 'gift', label: 'gift', type: 'select', required: false, options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
      { name: 'remark', label: 'remark', type: 'text', required: false, defaultHidden: true },
    ],
  },
  {
    title: 'filters: system names, sort fields, flags, non-editable types, the relationship field and `exclude`',
    schema: {
      name: 'line',
      fields: {
        id: { type: 'text' },
        _id: {},
        recordId: {},
        created_at: { type: 'datetime' },
        updated_by: { type: 'lookup', reference: 'user' },
        owner: { type: 'lookup', reference: 'user' },
        tenant_id: {},
        space: {},
        position: { type: 'number' },
        sort_order: { type: 'number' },
        secret: { type: 'text', hidden: true },
        locked: { type: 'text', readonly: true },
        internal: { type: 'text', system: true },
        total: { type: 'formula' },
        blob: { type: 'json' },
        place: { type: 'location' },
        body: { type: 'richtext' },
        seq: { type: 'autonumber' },
        roll: { type: 'rollup' },
        parent_ref: { type: 'master_detail', reference: 'parent' },
        skip_me: { type: 'text' },
        title: { type: 'text', required: true },
        status: { type: 'picklist', options: ['a', 'b'] },
        attachment: { type: 'file', multiple: true },
        approver: { type: 'lookup', reference: 'user', reference_field: 'email', readonlyWhen: "parent.status == 'locked'" },
        note: { type: 'text', requiredWhen: "record.status == 'b'" },
      },
    },
    opts: { relationshipField: 'parent_ref', exclude: ['skip_me'] },
    before: [
      { name: 'title', label: 'title', type: 'text', required: true },
      { name: 'status', label: 'status', type: 'select', required: false, options: [{ label: 'a', value: 'a' }, { label: 'b', value: 'b' }] },
      { name: 'attachment', label: 'attachment', type: 'file', required: false, multiple: true },
      { name: 'approver', label: 'approver', type: 'lookup', required: false, reference: 'user', displayField: 'email', readonlyWhen: "parent.status == 'locked'" },
      { name: 'note', label: 'note', type: 'text', required: false, requiredWhen: "record.status == 'b'" },
    ],
  },
  {
    title: 'falsy field definitions are text columns, and count toward the budget',
    schema: {
      name: 'line',
      fields: {
        a_null: null,
        b_undefined: undefined,
        c_zero: 0,
        d_empty: '',
        e_false: false,
        name: { type: 'text', label: 'Name' },
        qty: { type: 'number' },
        price: { type: 'currency' },
      },
    },
    before: [
      { name: 'a_null', label: 'a_null', type: 'text', required: false },
      { name: 'b_undefined', label: 'b_undefined', type: 'text', required: false },
      { name: 'c_zero', label: 'c_zero', type: 'text', required: false },
      { name: 'd_empty', label: 'd_empty', type: 'text', required: false, defaultHidden: true },
      { name: 'e_false', label: 'e_false', type: 'text', required: false, defaultHidden: true },
      { name: 'name', label: 'Name', type: 'text', required: false },
      { name: 'qty', label: 'qty', type: 'number', required: false },
      { name: 'price', label: 'price', type: 'currency', required: false },
    ],
  },
  {
    title: 'more required columns than the budget: every required column stays visible',
    schema: {
      fields: {
        a: { type: 'text', required: true },
        b: { type: 'text', required: true },
        c: { type: 'number', required: true },
        d: { type: 'text', required: true },
        e: { type: 'date', required: true },
        f: { type: 'text', required: true },
        g: { type: 'select', required: true, options: ['x'] },
        h: { type: 'select' },
      },
    },
    before: [
      { name: 'a', label: 'a', type: 'text', required: true },
      { name: 'b', label: 'b', type: 'text', required: true },
      { name: 'c', label: 'c', type: 'number', required: true },
      { name: 'd', label: 'd', type: 'text', required: true },
      { name: 'e', label: 'e', type: 'date', required: true },
      { name: 'f', label: 'f', type: 'text', required: true },
      { name: 'g', label: 'g', type: 'select', required: true, options: [{ label: 'x', value: 'x' }] },
      { name: 'h', label: 'h', type: 'select', required: false, defaultHidden: true },
    ],
  },
  { title: 'no schema', schema: undefined, before: [] },
  { title: 'no field map', schema: { name: 'line' }, before: [] },
  { title: 'a null field map', schema: { name: 'line', fields: null as unknown as Record<string, unknown> }, before: [] },
  { title: 'a field map that is not an object', schema: { name: 'line', fields: 'nope' as unknown as Record<string, unknown> }, before: [] },
];

describe('deriveColumns derives its columns through the spec rule (objectui#11345)', () => {
  it.each(CORPUS)("$title: names, order and defaultHidden are the spec's deriveInlineGridColumns", ({ schema, opts }) => {
    const identity = deriveColumns(schema, { ...opts, booleanLabel }).map(({ name, defaultHidden }) =>
      defaultHidden === undefined ? { name } : { name, defaultHidden },
    );
    expect(identity).toStrictEqual(deriveInlineGridColumns(schema, opts));
  });

  it.each(CORPUS)('$title: the output is unchanged from the local budget it replaced', ({ schema, opts, before }) => {
    expect(deriveColumns(schema, { ...opts, booleanLabel })).toStrictEqual(before);
  });

  it("an omitted maxColumns leaves the spec's budget visible", () => {
    const cols = deriveColumns({ name: 'invoice_line', fields: wide }, { relationshipField: 'invoice', booleanLabel });
    expect(cols.filter((c) => !c.defaultHidden)).toHaveLength(DEFAULT_MAX_INLINE_GRID_COLUMNS);
    expect(cols.length).toBeGreaterThan(DEFAULT_MAX_INLINE_GRID_COLUMNS);
  });
});
