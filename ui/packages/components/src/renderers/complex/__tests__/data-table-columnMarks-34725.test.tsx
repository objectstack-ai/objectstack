/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#34725 — `GridFieldAuthoring.columnMarks`: a host-drawn mark after
 * a column's header label, keyed by accessorKey. The Studio Data pillar marks
 * the fields its AI assistant changed in the pending draft. A column with no
 * entry draws nothing, and a table outside the provider draws no marks at all.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { GridFieldAuthoringProvider } from '../../../context/gridFieldAuthoring';
import '../data-table';

function table() {
  const DataTable = ComponentRegistry.get('data-table') as any;
  return (
    <DataTable
      schema={{
        data: [{ id: '1', title: 'Moby Dick', renew_count: 2 }],
        pagination: false,
        searchable: false,
        columns: [
          { header: 'Title', accessorKey: 'title' },
          { header: 'Renewals', accessorKey: 'renew_count' },
        ],
      }}
    />
  );
}

const header = (name: string) => screen.getByRole('columnheader', { name: new RegExp(name) });

describe('data-table draws GridFieldAuthoring.columnMarks after the header label (objectstack#34725)', () => {
  it('a marked column draws its mark; an unmarked one draws none', () => {
    render(
      <GridFieldAuthoringProvider value={{ columnMarks: { renew_count: <span data-testid="mark">AI</span> } }}>
        {table()}
      </GridFieldAuthoringProvider>,
    );
    expect(within(header('Renewals')).getByTestId('mark')).toHaveTextContent('AI');
    expect(within(header('Title')).queryByTestId('mark')).toBeNull();
    expect(screen.getAllByTestId('mark')).toHaveLength(1);
  });

  it('outside the provider, no marks', () => {
    render(table());
    expect(screen.queryByTestId('mark')).toBeNull();
  });
});
