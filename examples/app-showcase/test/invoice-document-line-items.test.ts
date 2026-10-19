// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { RecordLineItemsProps } from '@objectstack/spec/ui';

import { InvoiceDocumentPage } from '../src/ui/pages/index.js';
import { InvoiceLine } from '../src/data/objects/invoice.object.js';

/**
 * The invoice print page heads its line-items table with labels.
 *
 * `record:line_items` draws a column exactly as declared. Unlike the
 * master-detail grid, it does not fill a column from the child object's
 * field, so a column with no `label` is headed by its raw field name: the
 * printed invoice read `description` / `quantity` / `unit_price` / `amount`.
 *
 * The pin holds each column to the label its own child field declares, and
 * never to the field name. Deriving the expected heading from the field keeps
 * the print in step with the master-detail grid, which hydrates the same
 * labels for the same fields.
 */

type Column = Record<string, unknown>;
type Component = { type?: unknown; properties?: Record<string, unknown> };

const page = InvoiceDocumentPage as unknown as { regions?: { components?: Component[] }[] };

const lineItemBlocks = (page.regions ?? [])
  .flatMap((region) => region.components ?? [])
  .filter((component) => component.type === 'record:line_items');

const columnsOf = (block: Component | undefined): Column[] =>
  (Array.isArray(block?.properties?.columns) ? block!.properties!.columns : []) as Column[];

const childFields = (InvoiceLine.fields ?? {}) as Record<string, { label?: unknown }>;

describe('Invoice print page — the line-items table is headed by labels, not field names', () => {
  const [block, ...rest] = lineItemBlocks;

  it('carries one line-items block over the invoice lines', () => {
    expect(block, 'the invoice print page must carry its line-items table').toBeTruthy();
    expect(rest).toHaveLength(0);
    expect(block.properties?.childObject).toBe(InvoiceLine.name);
    expect(columnsOf(block).map((c) => c.name)).toEqual(['description', 'quantity', 'unit_price', 'amount']);
  });

  it('heads every column with its child field\'s own label, never the field name', () => {
    for (const column of columnsOf(block)) {
      const name = column.name as string;
      const fieldLabel = childFields[name]?.label;
      expect(typeof fieldLabel, `showcase_invoice_line.${name} must declare a label`).toBe('string');
      expect(column.label, `column '${name}' must declare its heading`).toBe(fieldLabel);
      expect(column.label, `column '${name}' must not be headed by its field name`).not.toBe(name);
    }
  });

  it('parses against the spec\'s `record:line_items` row with the labels intact', () => {
    const result = RecordLineItemsProps.safeParse(block.properties);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    expect(result.data).toEqual(block.properties);
  });
});
