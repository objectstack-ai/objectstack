// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SchemaForm } from './SchemaForm';

afterEach(cleanup);

/**
 * Flat (non-sectioned) schema-driven rendering must honor per-property
 * `visibleWhen` (the retired `visibleOn` spelling is not read, objectui#12696),
 * so a create form driven by a bare JSONSchema (no FormView layout) can gate a
 * field on a sibling value. This is what lets the View
 * create form show the list layout picker only for `viewKind: 'list'` and the
 * form layout picker only for `viewKind: 'form'` (objectui#2323).
 */

// Mirrors the shape of the View createSchema's family-gated layout pickers.
const schema = {
  type: 'object',
  properties: {
    viewKind: { type: 'string', title: 'View family', enum: ['list', 'form'] },
    kind: {
      type: 'string',
      title: 'List layout',
      enum: ['grid', 'kanban'],
      visibleWhen: "data.viewKind == 'list'",
    },
    formType: {
      type: 'string',
      title: 'Form layout',
      enum: ['simple', 'tabbed'],
      visibleWhen: "data.viewKind == 'form'",
    },
  },
};

describe('SchemaForm flat path — per-property visibleWhen (objectui#2323)', () => {
  it('shows the list layout picker and hides the form one for a list draft', () => {
    render(<SchemaForm schema={schema} value={{ viewKind: 'list' }} onChange={() => {}} />);
    expect(screen.getByText('View family')).toBeInTheDocument();
    expect(screen.getByText('List layout')).toBeInTheDocument();
    expect(screen.queryByText('Form layout')).not.toBeInTheDocument();
  });

  it('shows the form layout picker and hides the list one for a form draft', () => {
    render(<SchemaForm schema={schema} value={{ viewKind: 'form' }} onChange={() => {}} />);
    expect(screen.getByText('View family')).toBeInTheDocument();
    expect(screen.getByText('Form layout')).toBeInTheDocument();
    expect(screen.queryByText('List layout')).not.toBeInTheDocument();
  });

  it('fails open — a field with no visibleWhen always renders', () => {
    render(<SchemaForm schema={schema} value={{}} onChange={() => {}} />);
    // `viewKind` has no predicate, so it shows even before a family is picked.
    expect(screen.getByText('View family')).toBeInTheDocument();
    // Neither gated picker matches an empty draft.
    expect(screen.queryByText('List layout')).not.toBeInTheDocument();
    expect(screen.queryByText('Form layout')).not.toBeInTheDocument();
  });
});
