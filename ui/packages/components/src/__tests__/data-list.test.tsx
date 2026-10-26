/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`, which is why this carried a raised
// timeout. See object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

function renderType(schema: any) {
  const Component = ComponentRegistry.get(schema.type);
  if (!Component) throw new Error(`Component "${schema.type}" is not registered`);
  return render(<Component schema={schema} />);
}

describe('element:definition-list', () => {
  it('is registered', () => {
    expect(ComponentRegistry.get('element:definition-list')).toBeTruthy();
  });

  it('renders a term/description pair per item', () => {
    const { getByText, getByTestId } = renderType({
      type: 'element:definition-list',
      properties: {
        items: [
          { term: 'Status', description: 'Active' },
          { term: 'Owner', description: 'Ada' },
        ],
      },
    });
    expect(getByTestId('definition-list')).toBeTruthy();
    expect(getByText('Status')).toBeTruthy();
    expect(getByText('Active')).toBeTruthy();
    expect(getByText('Owner')).toBeTruthy();
  });

  it('renders an em dash for empty descriptions', () => {
    const { getByText } = renderType({
      type: 'element:definition-list',
      properties: { items: [{ term: 'Notes', description: '' }] },
    });
    expect(getByText('—')).toBeTruthy();
  });

  it('shows a friendly message when there are no items', () => {
    const { getByText } = renderType({ type: 'element:definition-list', properties: { items: [] } });
    // The bundle's `common.noData` since objectui#12910 (was "No details").
    expect(getByText('No data')).toBeTruthy();
  });
});

describe('element:repeater', () => {
  it('is registered', () => {
    expect(ComponentRegistry.get('element:repeater')).toBeTruthy();
  });

  it('renders an empty message when no object/adapter is available', () => {
    // Without an adapter the repeater resolves to its empty state rather than
    // throwing — safe to drop into any page.
    const { getByText } = renderType({
      type: 'element:repeater',
      dataSource: { object: 'showcase_category' },
      properties: { fields: ['name'], emptyText: 'Nothing here' },
    });
    expect(getByText('Nothing here')).toBeTruthy();
  });
});
