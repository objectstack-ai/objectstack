/**
 * objectui#11428 — `deriveFormFields`, the field names of an inline
 * master-detail collection's per-row expand form, takes them from
 * `@objectstack/spec`'s `deriveInlineRowFormFields`. It is the row-form twin of
 * `deriveMasterDetail.inlineGridColumns-11345.test.ts` (the grid columns).
 *
 * Two pins over one corpus, and they guard different things:
 *
 * 1. The names and their order ARE the spec's answer. This is what lets
 *    objectstack's `field-no-consumers` lint credit exactly the fields this
 *    form draws: a local filter creeping back in would let the two disagree,
 *    and this pin goes red the moment one changes an answer.
 * 2. The output is what `deriveFormFields` returned BEFORE the swap. The
 *    expected arrays below are the answers of the local filter this card
 *    replaced (its own system-name, sort-name and non-input-type sets), and
 *    `deriveFormFields` is a public export of `@object-ui/plugin-form`: the
 *    swap must not move a single name. The corpus covers the relationship
 *    field and `exclude` alone, together and absent; every system and
 *    sort-position name; the `system` and `hidden` flags; `readonly`, which the
 *    form KEEPS where the grid drops it; every non-input type; the rich types
 *    the grid omits; falsy and primitive field definitions; prototype-named
 *    keys; and the shapes with no field map.
 *
 * That `deriveFormFields` reads the spec's export at all, rather than agreeing
 * with it by coincidence, is pinned where a module mock is file-scoped:
 * `inlineRowForm.specSource-11428.test.tsx`.
 *
 * `toStrictEqual` on purpose, as in the twin.
 */
import { describe, it, expect } from 'vitest';
import { deriveInlineRowFormFields } from '@objectstack/spec/data';
import { deriveFormFields, type ChildObjectSchemaLike } from './deriveMasterDetail';

type Opts = { relationshipField?: string; exclude?: string[] };

const line = {
  name: { type: 'text', label: 'Name' },
  qty: { type: 'number', label: 'Qty' },
  unit_price: { type: 'currency', label: 'Unit price' },
  status: { type: 'select', options: ['open', 'closed'] },
  memo: { type: 'textarea' },
  order: { type: 'master_detail', reference: 'order', required: true },
};

const CORPUS: Array<{ title: string; schema: ChildObjectSchemaLike | undefined; opts?: Opts; before: string[] }> = [
  {
    title: 'the relationship field is dropped',
    schema: { name: 'line', fields: line },
    opts: { relationshipField: 'order' },
    before: ['name', 'qty', 'unit_price', 'status', 'memo'],
  },
  {
    title: '`exclude` alone: the unexcluded relationship field stays',
    schema: { name: 'line', fields: line },
    opts: { exclude: ['memo'] },
    before: ['name', 'qty', 'unit_price', 'status', 'order'],
  },
  {
    title: '`exclude` and the relationship field together, with a name the map does not hold',
    schema: { name: 'line', fields: line },
    opts: { relationshipField: 'order', exclude: ['qty', 'qty', 'nope'] },
    before: ['name', 'unit_price', 'status', 'memo'],
  },
  {
    title: 'no options: every business field, the relationship field included',
    schema: { name: 'line', fields: line },
    before: ['name', 'qty', 'unit_price', 'status', 'memo', 'order'],
  },
  {
    title: 'an empty relationship field excludes nothing',
    schema: { name: 'line', fields: line },
    opts: { relationshipField: '' },
    before: ['name', 'qty', 'unit_price', 'status', 'memo', 'order'],
  },
  {
    title: 'every system / audit name and every sort-position name is dropped',
    schema: {
      name: 'line',
      fields: {
        id: { type: 'text' },
        _id: {},
        recordId: {},
        created_at: { type: 'datetime' },
        updated_at: { type: 'datetime' },
        created_by: { type: 'lookup', reference: 'user' },
        updated_by: { type: 'lookup', reference: 'user' },
        createdAt: {},
        updatedAt: {},
        createdBy: {},
        updatedBy: {},
        organization_id: {},
        tenant_id: {},
        space: {},
        owner: { type: 'lookup', reference: 'user' },
        position: { type: 'number' },
        sort_order: { type: 'number' },
        sequence: { type: 'number' },
        line_no: { type: 'number' },
        line_number: { type: 'number' },
        sort: { type: 'number' },
        title: { type: 'text', required: true },
      },
    },
    before: ['title'],
  },
  {
    title: 'flags: `system` and `hidden` drop a field, `readonly` and `required` do not',
    schema: {
      name: 'line',
      fields: {
        secret: { type: 'text', hidden: true },
        internal: { type: 'text', system: true },
        locked: { type: 'text', readonly: true },
        must: { type: 'text', required: true },
        shown: { type: 'text', hidden: false, system: false },
        truthy_hidden: { type: 'text', hidden: 1 },
      },
    },
    before: ['locked', 'must', 'shown'],
  },
  {
    title: 'types: the non-input types are dropped, the rich types the grid omits are kept',
    schema: {
      name: 'invoice_line',
      fields: {
        total: { type: 'formula', expression: 'qty * unit_price' },
        sum: { type: 'summary' },
        roll: { type: 'rollup' },
        seq: { type: 'autonumber' },
        seq2: { type: 'auto_number' },
        notes: { type: 'textarea' },
        body: { type: 'richtext' },
        blob: { type: 'json' },
        place: { type: 'location' },
        html: { type: 'html' },
        md: { type: 'markdown' },
        cover: { type: 'image' },
        attachment: { type: 'file', multiple: true },
        face: { type: 'avatar' },
        product: { type: 'lookup', reference: 'product' },
        amount: { type: 'currency', expression: 'qty * unit_price' },
        typed_oddly: { type: 7 },
        untyped: {},
      },
    },
    before: ['notes', 'body', 'blob', 'place', 'html', 'md', 'cover', 'attachment', 'face', 'product', 'amount', 'typed_oddly', 'untyped'],
  },
  {
    title: 'falsy and primitive field definitions are kept, in field order',
    schema: {
      name: 'line',
      fields: {
        a_null: null,
        b_undefined: undefined,
        c_zero: 0,
        d_empty: '',
        e_false: false,
        f_string: 'text',
        g_number: 1,
        h_true: true,
        name: { type: 'text', label: 'Name' },
      },
    },
    before: ['a_null', 'b_undefined', 'c_zero', 'd_empty', 'e_false', 'f_string', 'g_number', 'h_true', 'name'],
  },
  {
    title: 'prototype-named keys are ordinary field names',
    schema: {
      name: 'line',
      fields: {
        constructor: { type: 'text' },
        toString: { type: 'text' },
        hasOwnProperty: { type: 'text', hidden: true },
        valueOf: { type: 'formula' },
      },
    },
    opts: { exclude: ['toString'] },
    before: ['constructor'],
  },
  { title: 'no schema', schema: undefined, before: [] },
  { title: 'no field map', schema: { name: 'line' }, before: [] },
  { title: 'an empty field map', schema: { name: 'line', fields: {} }, before: [] },
  { title: 'a null field map', schema: { name: 'line', fields: null as unknown as Record<string, unknown> }, before: [] },
  { title: 'a field map that is not an object', schema: { name: 'line', fields: 'nope' as unknown as Record<string, unknown> }, before: [] },
];

describe('deriveFormFields derives its names through the spec rule (objectui#11428)', () => {
  it.each(CORPUS)("$title: the names and their order are the spec's deriveInlineRowFormFields", ({ schema, opts }) => {
    expect(deriveFormFields(schema, opts)).toStrictEqual(deriveInlineRowFormFields(schema, opts));
  });

  it.each(CORPUS)('$title: the output is unchanged from the local filter it replaced', ({ schema, opts, before }) => {
    expect(deriveFormFields(schema, opts)).toStrictEqual(before);
  });
});
