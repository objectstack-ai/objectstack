// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SchemaForm } from './SchemaForm';

afterEach(cleanup);

/**
 * A `repeater` form field whose JSONSchema wraps the canonical array form in
 * a union (`anyOf`) — the exact shape of a View `sort`
 * (`anyOf: [ "field desc" string, {field,order}[] ]`, kept a union so the
 * legacy bare-string form still validates, see objectstack/spec view.zod).
 *
 * The repeater must resolve the union to its ARRAY branch and render the row
 * sub-fields. Reading `schema.items` at the top level finds `undefined`
 * (items live under `anyOf[1].items`) and produces a blank row with no field
 * picker or order dropdown — the bug in objectui#3379.
 */
const sortUnionSchema = {
  type: 'object',
  properties: {
    sort: {
      anyOf: [
        { type: 'string' }, // legacy "field desc"
        {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              order: { type: 'string', enum: ['asc', 'desc'] },
            },
          },
        },
      ],
    },
  },
};

// Mirrors the spec's `viewForm`: `{ field: 'sort', type: 'repeater' }`.
const sortForm = {
  sections: [
    {
      label: 'Columns & Filters',
      fields: [
        { field: 'sort', type: 'repeater', helpText: 'Default sort order' },
      ],
    },
  ],
} as never;

function Harness() {
  const [val, setVal] = useState<Record<string, unknown>>({});
  return (
    <SchemaForm
      schema={sortUnionSchema}
      form={sortForm}
      value={val}
      onChange={setVal}
    />
  );
}

describe('SchemaForm repeater over a union schema (objectui#3379)', () => {
  it('renders row sub-fields for a union-wrapped array (View sort)', () => {
    render(<Harness />);

    // The Sort repeater renders with its add control.
    const addBtn = screen.getByRole('button', { name: /add item/i });
    expect(addBtn).toBeInTheDocument();

    // Adding a row must surface the field + order sub-controls — not a blank
    // row. Before the fix the repeater derived zero sub-fields from the
    // top-level (union) `schema.items`, so the added row was empty.
    fireEvent.click(addBtn);

    expect(screen.getByText('Field')).toBeInTheDocument();
    expect(screen.getByText('Order')).toBeInTheDocument();
  });

  it('renders row sub-fields when editing an existing array-form sort', () => {
    function Seeded() {
      const [val, setVal] = useState<Record<string, unknown>>({
        sort: [{ field: 'estimate_hours', order: 'desc' }],
      });
      return (
        <SchemaForm
          schema={sortUnionSchema}
          form={sortForm}
          value={val}
          onChange={setVal}
        />
      );
    }
    render(<Seeded />);

    // Expand the existing row and confirm its sub-fields resolve from the
    // union's array branch rather than falling back to a raw JSON blob.
    fireEvent.click(screen.getByRole('button', { name: /#1/ }));
    expect(screen.getByText('Field')).toBeInTheDocument();
    expect(screen.getByText('Order')).toBeInTheDocument();
  });
});
