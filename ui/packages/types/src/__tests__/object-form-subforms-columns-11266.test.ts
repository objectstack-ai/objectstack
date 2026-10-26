/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11266 — one `ObjectFormSchema.subforms[].columns` entry is the spec's
 * `InlineGridColumnSchema`, by reference.
 *
 * `@objectstack/spec` 17.6.0 judges `FormViewSchema.subforms[].columns` with its
 * closed inline grid column schema (objectstack#20927). The mirror held
 * `z.array(z.any())` there, so `objectui validate` accepted a column with an
 * undeclared key, and a typed `currency` column carrying `scale`, both of which
 * `os validate` refuses. Two authoring doors gave two verdicts on one document.
 *
 * An authored document reaches `subforms` through the object-view `form` slot:
 * `subforms` is a form-VIEW member, which the `object-form` row refuses in its
 * `properties` bag (objectui#10859 batch 4), and the slot is this mirror minus
 * its identity keys. So the face rows below author it there. The mirror rows
 * parse the flat node as `ObjectForm` reads it.
 *
 * ## What is pinned
 *
 *   - BY REFERENCE: a column's schema IS the spec schema as it crosses the
 *     import boundary, so a faithful hand copy turns this red. The TypeScript
 *     face IS the spec's `InlineGridColumn` (judged by `tsc -p tsconfig.test.json`).
 *   - THE VERDICTS, on the tolerant face (`safeValidateSchema`) and on the
 *     strict authoring face, which `objectui validate` runs. An undeclared
 *     column key is refused at the column, with the key named. A `scale` on a
 *     column that DECLARES `type: 'currency'` is refused at that `scale`. A bare
 *     field-name string is refused at the column. A column `{ name }` is
 *     accepted: the lit control.
 *   - ONE VERDICT ACROSS THE TWO DOORS: each probe column gets the verdict the
 *     spec's own `FormViewSchema` gives it, read live in the same run.
 *
 * ⛔ Not refused here, and pinned as ACCEPTED so that reaching for it is a
 * deliberate change: a `scale` on an identity-only column (`{ name, scale }`)
 * whose child field is a currency. Refusing it takes the child object's fields,
 * which are not in the document this mirror judges. The spec's column schema
 * accepts it too; `defineStack` refuses it at publish, by resolving `name`
 * through `childObject`, and `plugin-form`'s `hydrateColumns` reports it at
 * render (objectui#10783).
 */

import { describe, it, expect } from 'vitest';
import {
  InlineGridColumnSchema as SpecInlineGridColumnSchema,
  type InlineGridColumn as SpecInlineGridColumn,
} from '@objectstack/spec/data';
import { FormViewSchema as SpecFormViewSchema } from '@objectstack/spec/ui';
import type { ObjectFormSchema as DeclaredObjectFormSchema } from '../objectql';
import { ObjectFormSchema as ObjectFormMirror } from '../zod/objectql.zod.js';
import { safeValidateSchema, StrictAnyComponentSchema } from '../zod/index.zod.js';
import { stripImportedDefaults } from '../zod/imported-defaults.js';

/* ── Type level ───────────────────────────────────────────────────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

type DeclaredSubform = NonNullable<DeclaredObjectFormSchema['subforms']>[number];
type DeclaredColumn = NonNullable<DeclaredSubform['columns']>[number];

// By reference: a declared column IS the spec's authoring type. A local
// restatement, or the `any` this replaced, turns this red.
export type _ColumnIsTheSpecInput = Expect<Equal<DeclaredColumn, SpecInlineGridColumn>>;

export const identityOnlyColumnIsAuthorable: DeclaredSubform = {
  childObject: 'order_line',
  columns: [{ name: 'quantity' }, { name: 'amount', type: 'currency', label: 'Amount' }],
};
export const stringColumnIsRefused: DeclaredSubform = {
  childObject: 'order_line',
  // @ts-expect-error a column is an object keyed by `name`, never a bare field-name string
  columns: ['quantity'],
};

/* ── Runtime ──────────────────────────────────────────────────────────────── */

const CHILD = 'order_line';

/** An authored object-view whose form declares one subform with one column. */
const viewWith = (column: unknown) => ({
  type: 'object-view',
  objectName: 'order',
  form: { subforms: [{ childObject: CHILD, columns: [column] }] },
});
/** The flat `object-form` node as `ObjectForm` reads it, with the same subform. */
const flatWith = (column: unknown) => ({
  type: 'object-form',
  objectName: 'order',
  mode: 'create',
  subforms: [{ childObject: CHILD, columns: [column] }],
});
/** The spec's form view with the same subform: the other door's verdict. */
const specFormViewWith = (column: unknown) => ({
  type: 'simple',
  subforms: [{ childObject: CHILD, columns: [column] }],
});

const VALID = { name: 'quantity' };
const BOGUS_KEY = { name: 'quantity', bogusKey: 1 };
const TYPED_CURRENCY_WITH_SCALE = { name: 'amount', type: 'currency', scale: 2 };
const IDENTITY_ONLY_WITH_SCALE = { name: 'amount', scale: 2 };
const BARE_STRING = 'quantity';

/** The column's own position on the object-view face. */
const VIEW_COLUMN = ['form', 'subforms', 0, 'columns', 0];
/** …and on the flat mirror. */
const FLAT_COLUMN = ['subforms', 0, 'columns', 0];

type Face = { name: string; parse: (doc: unknown) => ReturnType<typeof safeValidateSchema> };
const FACES: ReadonlyArray<Face> = [
  { name: 'tolerant (`safeValidateSchema`)', parse: (doc) => safeValidateSchema(doc) },
  { name: 'strict authoring face', parse: (doc) => StrictAnyComponentSchema.safeParse(doc) as ReturnType<typeof safeValidateSchema> },
];

/** One column's schema on the mirror, unwrapped from `subforms`' and `columns`' `optional` / `array`. */
const mirrorColumnSchema = () => ObjectFormMirror.shape.subforms.unwrap().element.shape.columns.unwrap().element;

describe('objectui#11266 — `subforms[].columns` is the spec\'s `InlineGridColumnSchema`, by reference', () => {
  it('a column\'s schema IS the spec schema as it crosses the import boundary', () => {
    expect(mirrorColumnSchema()).toBe(stripImportedDefaults(SpecInlineGridColumnSchema));
    // The crossing is the identity here (the column schema carries no default),
    // so the member is the spec's own object.
    expect(mirrorColumnSchema()).toBe(SpecInlineGridColumnSchema);
  });

  describe.each(FACES)('on the $name', ({ parse }) => {
    it('CONTROL: a column `{ name }` is accepted', () => {
      const parsed = parse(viewWith(VALID));
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    });

    it('an undeclared column key is refused at the column, with the key named', () => {
      const parsed = parse(viewWith(BOGUS_KEY));
      expect(parsed.success).toBe(false);
      expect(parsed.error!.issues).toHaveLength(1);
      const [issue] = parsed.error!.issues;
      expect(issue.code).toBe('unrecognized_keys');
      expect(issue.path).toEqual(VIEW_COLUMN);
      expect((issue as { keys?: string[] }).keys).toEqual(['bogusKey']);
    });

    it('a `scale` on a column that declares `type: \'currency\'` is refused at that `scale`', () => {
      const parsed = parse(viewWith(TYPED_CURRENCY_WITH_SCALE));
      expect(parsed.success).toBe(false);
      expect(parsed.error!.issues).toHaveLength(1);
      const [issue] = parsed.error!.issues;
      expect(issue.code).toBe('custom');
      expect(issue.path).toEqual([...VIEW_COLUMN, 'scale']);
      // The refusal is the spec's own, sentence included: the same column
      // judged by the spec's schema in this run yields the same message.
      const spec = SpecInlineGridColumnSchema.safeParse(TYPED_CURRENCY_WITH_SCALE);
      expect(spec.success).toBe(false);
      expect(issue.message).toBe(spec.error!.issues[0].message);
    });

    it('a bare field-name string is refused at the column', () => {
      const parsed = parse(viewWith(BARE_STRING));
      expect(parsed.success).toBe(false);
      expect(parsed.error!.issues).toHaveLength(1);
      const [issue] = parsed.error!.issues;
      expect(issue.code).toBe('invalid_type');
      expect(issue.path).toEqual(VIEW_COLUMN);
    });

    it('⛔ an identity-only column with `scale` is accepted: the currency is the child field\'s, which this document does not carry', () => {
      const parsed = parse(viewWith(IDENTITY_ONLY_WITH_SCALE));
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    });
  });

  it('the flat mirror gives the same verdicts at the same column', () => {
    expect(ObjectFormMirror.safeParse(flatWith(VALID)).success).toBe(true);

    const bogus = ObjectFormMirror.safeParse(flatWith(BOGUS_KEY));
    expect(bogus.success).toBe(false);
    expect(bogus.error!.issues.map((i) => [i.code, i.path])).toEqual([['unrecognized_keys', FLAT_COLUMN]]);

    const currency = ObjectFormMirror.safeParse(flatWith(TYPED_CURRENCY_WITH_SCALE));
    expect(currency.success).toBe(false);
    expect(currency.error!.issues.map((i) => [i.code, i.path])).toEqual([['custom', [...FLAT_COLUMN, 'scale']]]);
  });

  it.each([
    ['a column `{ name }`', VALID, true],
    ['an undeclared column key', BOGUS_KEY, false],
    ['a typed currency column with `scale`', TYPED_CURRENCY_WITH_SCALE, false],
    ['an identity-only column with `scale`', IDENTITY_ONLY_WITH_SCALE, true],
    ['a bare field-name string', BARE_STRING, false],
  ] as const)('one verdict across the two doors: %s', (_label, column, expected) => {
    // The other door, read live: the spec's form view judging the same column.
    const spec = SpecFormViewSchema.safeParse(specFormViewWith(column));
    expect(spec.success).toBe(expected);
    expect(safeValidateSchema(viewWith(column)).success).toBe(spec.success);
  });
});
