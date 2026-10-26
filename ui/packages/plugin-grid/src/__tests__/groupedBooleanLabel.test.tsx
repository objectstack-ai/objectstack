/**
 * Grouped boolean headers fall back to readable Yes/No.
 *
 * Regression coverage for the group header rendering the raw i18n key
 * (`grid.booleanTrue`) instead of a label: the formatter asked for keys that
 * exist in neither the grid's default bundle nor the locale files, and passed
 * the English fallback as a bare second argument — which the no-provider
 * translator reads as an options object, so the fallback never applied.
 *
 * These grids render with no `I18nProvider`, which is exactly the path the
 * defaults map exists to serve (standalone usage / tests).
 */
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

const rows = [
  { id: '1', name: 'Row 1', active: true },
  { id: '2', name: 'Row 2', active: false },
  { id: '3', name: 'Row 3', active: true },
];

function renderBooleanGroupedGrid() {
  const schema: any = {
    type: 'object-grid' as const,
    objectName: 'test_object',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'active', label: 'Active', type: 'boolean' },
    ],
    data: { provider: 'value', items: rows },
    grouping: { fields: [{ field: 'active' }] },
  };
  return render(
    <ActionProvider>
      <ObjectGrid schema={schema} />
    </ActionProvider>
  );
}

const groupLabels = () =>
  Array.from(document.querySelectorAll('.group-label')).map((el) => el.textContent);

describe('Grouped boolean group headers', () => {
  it('labels the groups Yes / No', async () => {
    renderBooleanGroupedGrid();
    await waitFor(() => expect(groupLabels().length).toBeGreaterThan(0));
    expect(groupLabels()).toEqual(expect.arrayContaining(['Yes', 'No']));
  });

  it('never leaks a raw `grid.*` translation key into a group header', async () => {
    renderBooleanGroupedGrid();
    await waitFor(() => expect(groupLabels().length).toBeGreaterThan(0));
    for (const label of groupLabels()) {
      expect(label).not.toMatch(/^grid\./);
    }
  });
});
