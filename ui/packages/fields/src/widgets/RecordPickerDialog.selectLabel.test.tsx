/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Record Picker select-column label resolution — #3333.
 *
 * The "Browse all records" picker table must format cells with the SAME
 * field metadata the list view uses. Pre-fix the dialog handed the cell
 * renderer a bare `{ name, type }` descriptor, so a `select` column had no
 * `options` and fell back to title-casing the raw stored value
 * (`manufacturing` → "Manufacturing" instead of the authored label).
 *
 * With `fieldsMeta` (the referenced object's schema `fields` map) the dialog
 * enriches each column's field descriptor — options, currency, scale, … —
 * so select columns resolve their option labels, and string-authored
 * `lookupColumns` (no `type` on the column def) inherit the schema field's
 * type and format identically.
 */

import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import { RecordPickerDialog } from './RecordPickerDialog';
import { getCellRenderer } from '../index';

const projects = [
  { id: 'p1', name: 'Line A retooling', project_phase: 'manufacturing' },
];

const projectFields = {
  name: { type: 'text', label: 'Name' },
  project_phase: {
    type: 'select',
    label: 'Project Phase',
    options: [
      { label: '01 立项', value: 'initiation' },
      { label: '03 制造', value: 'manufacturing' },
    ],
  },
};

function makeDataSource() {
  const find = vi.fn(async () => ({ data: projects, total: projects.length }));
  return { find } as any;
}

describe('RecordPickerDialog — select columns resolve option labels (#3333)', () => {
  it('renders the authored option label when fieldsMeta provides options', async () => {
    render(
      <RecordPickerDialog
        open
        onOpenChange={() => {}}
        dataSource={makeDataSource()}
        objectName="projects"
        columns={[
          { field: 'name', label: 'Name', type: 'text' },
          { field: 'project_phase', label: 'Project Phase', type: 'select' },
        ]}
        onSelect={() => {}}
        cellRenderer={getCellRenderer}
        fieldsMeta={projectFields}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('03 制造')).toBeInTheDocument();
    });
    expect(screen.queryByText('Manufacturing')).not.toBeInTheDocument();
  });

  it('string-authored columns without a type inherit the schema field type', async () => {
    render(
      <RecordPickerDialog
        open
        onOpenChange={() => {}}
        dataSource={makeDataSource()}
        objectName="projects"
        columns={['name', 'project_phase']}
        onSelect={() => {}}
        cellRenderer={getCellRenderer}
        fieldsMeta={projectFields}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('03 制造')).toBeInTheDocument();
    });
    expect(screen.queryByText('Manufacturing')).not.toBeInTheDocument();
  });

  it('falls back to the humanized raw value without fieldsMeta (legacy behavior)', async () => {
    render(
      <RecordPickerDialog
        open
        onOpenChange={() => {}}
        dataSource={makeDataSource()}
        objectName="projects"
        columns={[{ field: 'project_phase', label: 'Project Phase', type: 'select' }]}
        onSelect={() => {}}
        cellRenderer={getCellRenderer}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Manufacturing')).toBeInTheDocument();
    });
  });
});
