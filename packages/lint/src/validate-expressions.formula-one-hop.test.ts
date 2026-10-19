// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24197] A formula field's `expression` reads ONE hop through a reference
 * field, and the field-formula pass judges it on that line.
 *
 * ObjectQL's formula read path preloads the related fields a formula names one
 * hop through a reference (`record.book.title`) before it computes the field,
 * page-batched, under the reader's own read. So:
 *
 *  - one hop through a declared reference passes — the composed title of a
 *    junction object, `record.book.title + ' · ' + record.reader.name`;
 *  - a second hop is refused, naming the field and the one-hop alternative;
 *  - a reference read both through and as a plain value is refused, with the
 *    optional read as the repair for an empty reference.
 *
 * The runtime half is `packages/objectql/src/engine-formula-one-hop.test.ts`.
 * Every fixture goes through `specValid`: this is a verdict on an expression's
 * VALUE, so the stack must be one the schema accepts outright.
 */
import { describe, expect, it } from 'vitest';
import { ObjectStackSchema } from '@objectstack/spec';
import { BlueprintFieldSchema, BlueprintObjectSchema, SolutionBlueprintStrictSchema } from '@objectstack/spec/ai';

import { validateStackExpressions } from './validate-expressions.js';

const MANIFEST = { id: 'com.example.formula-hop', name: 'formula_hop', version: '1.0.0', type: 'app' } as const;

/** A fixture is only a fixture if the spec accepts it. */
function specValid(stack: Record<string, unknown>): Record<string, unknown> {
  const result = ObjectStackSchema.safeParse({ manifest: MANIFEST, ...stack });
  if (!result.success) {
    throw new Error(
      'fixture is not spec-valid: '
        + result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    );
  }
  return result.data as unknown as Record<string, unknown>;
}

const book = {
  name: 'hop_book',
  label: 'Book',
  fields: {
    title: { type: 'text', label: 'Title' },
    shelf: { type: 'lookup', label: 'Shelf', reference: 'hop_shelf' },
  },
};
const shelf = { name: 'hop_shelf', label: 'Shelf', fields: { code: { type: 'text', label: 'Code' } } };
const reader = { name: 'hop_reader', label: 'Reader', fields: { name: { type: 'text', label: 'Name' } } };
const loan = (expression: string) => ({
  name: 'hop_loan',
  label: 'Loan',
  fields: {
    book: { type: 'lookup', label: 'Book', reference: 'hop_book' },
    reader: { type: 'lookup', label: 'Reader', reference: 'hop_reader' },
    title: { type: 'formula', label: 'Title', expression },
  },
});

const WHERE = "object 'hop_loan' · field 'title' expression";

const errorsOf = (expression: string) =>
  validateStackExpressions(specValid({ objects: [book, shelf, reader, loan(expression)] }))
    .filter((i) => i.where === WHERE && (i.severity ?? 'error') === 'error');

describe('a formula expression reads one hop through a reference (#24197)', () => {
  it('admits the composed title over two lookups', () => {
    expect(errorsOf("record.book.title + ' · ' + record.reader.name")).toEqual([]);
  });

  it('admits the optional read that gives an empty reference a value', () => {
    expect(errorsOf("record.book.title + ' · ' + record.reader.?name.orValue('—')")).toEqual([]);
  });

  it('refuses a second hop, naming the field and the one-hop alternative', () => {
    const errors = errorsOf('record.book.shelf.code');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('`record.book` is read through more than one relationship hop.');
    expect(errors[0].message).toContain('A formula resolves ONE hop (`record.book.<related field>`');
    expect(errors[0].source).toBe('record.book.shelf.code');
  });

  it('refuses a reference read both through and as a value, prescribing the optional read', () => {
    const errors = errorsOf("record.reader == null ? record.book.title : record.reader.name");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('`record.reader` is read BOTH through the relationship');
    expect(errors[0].message).toContain("`record.reader.?<related field>.orValue('…')`");
  });
});

/**
 * The producers: the spec's AI blueprint schema teaches the composed title to a
 * model, in its lenient and strict twins alike. The example it gives must be
 * the one-hop read a formula actually serves — a bare lookup there composes the
 * stored id into the title — and must pass the field-formula pass above.
 */
describe('the blueprint schema teaches the one-hop composed title (#24197)', () => {
  const lenientField = (BlueprintFieldSchema as any).shape;
  const strictObject = (SolutionBlueprintStrictSchema as any).shape.objects.element.shape;
  const lenientObject = (BlueprintObjectSchema as any).shape;
  const describes = {
    'lenient expression': lenientField.expression.description as string,
    'strict expression': strictObject.fields.element.shape.expression.description as string,
    'lenient nameField': lenientObject.nameField.description as string,
    'strict nameField': strictObject.nameField.description as string,
  };
  const EXAMPLE = "record.order_no + ' · ' + record.customer.name";

  it.each(Object.entries(describes))('%s gives the one-hop example', (_slot, text) => {
    expect(text).toContain(`"${EXAMPLE}"`);
    expect(text).not.toContain("record.customer\" for");
    expect(text).not.toContain('{customer}');
  });

  it('the example passes the field-formula pass when `customer` is a lookup', () => {
    const stack = specValid({
      objects: [
        { name: 'bp_customer', label: 'Customer', fields: { name: { type: 'text', label: 'Name' } } },
        {
          name: 'bp_order',
          label: 'Order',
          fields: {
            order_no: { type: 'text', label: 'Order No' },
            customer: { type: 'lookup', label: 'Customer', reference: 'bp_customer' },
            title: { type: 'formula', label: 'Title', expression: EXAMPLE },
          },
        },
      ],
    });
    const errors = validateStackExpressions(stack)
      .filter((i) => i.where === "object 'bp_order' · field 'title' expression" && (i.severity ?? 'error') === 'error');
    expect(errors).toEqual([]);
  });

  it('the describe strings name the sort and search answer for a formula title', () => {
    for (const text of [describes['lenient nameField'], describes['strict nameField']]) {
      expect(text).toContain('a list cannot sort by it and search does not scan it');
    }
  });
});
