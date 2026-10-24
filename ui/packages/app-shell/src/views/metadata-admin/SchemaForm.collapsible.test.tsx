// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SchemaForm } from './SchemaForm';

afterEach(cleanup);

const schema = {
  type: 'object',
  properties: {
    openField: { type: 'string', title: 'Open Field' },
    advancedField: { type: 'string', title: 'Advanced Field' },
  },
};

/**
 * ADR-0047: the spec form already declares which sections are collapsible
 * and which start collapsed (Advanced, type-specific options). The renderer
 * must honour those flags so the panel opens lean — previously they were
 * ignored and every section rendered flat/expanded.
 */
describe('SchemaForm — collapsible sections', () => {
  const form = {
    type: 'simple' as const,
    sections: [
      { label: 'Basics', fields: [{ field: 'openField' }] },
      { label: 'Advanced', collapsible: true, collapsed: true, fields: [{ field: 'advancedField' }] },
    ],
  };

  it('a collapsed section hides its body until the header is clicked', () => {
    render(<SchemaForm schema={schema} form={form} value={{ openField: '', advancedField: '' }} onChange={() => {}} />);
    // Non-collapsible section's field is always present.
    expect(screen.getByText('Open Field')).toBeInTheDocument();
    // Collapsed section: header present, body (its field) not yet mounted.
    expect(screen.getByText('Advanced')).toBeInTheDocument();
    expect(screen.queryByText('Advanced Field')).not.toBeInTheDocument();
    // Expand it.
    fireEvent.click(screen.getByText('Advanced'));
    expect(screen.getByText('Advanced Field')).toBeInTheDocument();
  });

  it('a collapsible section with collapsed:false renders open', () => {
    const openForm = {
      type: 'simple' as const,
      sections: [
        { label: 'Interface', collapsible: true, collapsed: false, fields: [{ field: 'openField' }] },
      ],
    };
    render(<SchemaForm schema={schema} form={openForm} value={{ openField: '' }} onChange={() => {}} />);
    expect(screen.getByText('Open Field')).toBeInTheDocument();
  });

  it('hides a section whose visibleWhen predicate is false (object/CEL form)', () => {
    const condForm = {
      type: 'simple' as const,
      sections: [
        { label: 'Basics', fields: [{ field: 'openField' }] },
        {
          label: 'Layout',
          visibleWhen: { dialect: 'cel', source: "data.type != 'list'" },
          fields: [{ field: 'advancedField' }],
        },
      ],
    };
    render(<SchemaForm schema={{ ...schema, properties: { ...schema.properties, type: { type: 'string' } } }} form={condForm} value={{ type: 'list', openField: '', advancedField: '' }} onChange={() => {}} />);
    // type == 'list' → "data.type != 'list'" is false → Layout hidden.
    expect(screen.queryByText('Layout')).not.toBeInTheDocument();
    expect(screen.queryByText('Advanced Field')).not.toBeInTheDocument();
    expect(screen.getByText('Open Field')).toBeInTheDocument();
  });
});
