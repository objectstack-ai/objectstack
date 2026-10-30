/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A field group may stand for a related list's body table (objectstack#27069,
 * `fieldGroups[].relatedList`). Studio's group inspector places one, over the
 * same inbound-relationship vocabulary the `relatedLists` editor uses, and the
 * form designer stops treating such a group as a place fields go.
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { t } from '../metadata-admin/i18n';
import { ObjectGroupInspector } from './ObjectGroupInspector';
import { ObjectFormDesigner } from './ObjectFormDesigner';

afterEach(cleanup);

type Row = Record<string, unknown>;

const quote: Row = { name: 'quote', label: 'Quote', fields: { name: { type: 'text', label: 'Name' } } };
// Body tables (objectstack#27478): an inline-edited master_detail child, and a
// lookup marked relatedList: 'primary'. The plain lookup `task` is a side card.
const lineItem: Row = { name: 'quote_line', label: 'Quote Line', fields: { quote: { type: 'master_detail', reference: 'quote', label: 'Quote', inlineEdit: 'grid' } } };
const schedule: Row = { name: 'schedule', label: 'Schedule', fields: { quote_id: { type: 'lookup', reference: 'quote', label: 'Quote', relatedList: 'primary' } } };
const task: Row = { name: 'task', label: 'Task', fields: { quote_id: { type: 'lookup', reference: 'quote', label: 'Quote' } } };

const STORE: MetadataContextValue = {
  apps: [],
  objects: [quote, lineItem, schedule, task],
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
  getTypeStatus: () => 'ready',
};

function renderInspector(draft: Row, groupKey: string, onPatch = vi.fn()) {
  render(
    <MetadataCtx.Provider value={STORE}>
      <ObjectGroupInspector draft={draft} objectName="quote" groupKey={groupKey} onPatch={onPatch} onClose={() => {}} />
    </MetadataCtx.Provider>,
  );
  return onPatch;
}

const placementPicker = () =>
  within(screen.getByTestId('group-related-table')).getByRole('combobox');

describe('ObjectGroupInspector — a group places a related table', () => {
  it('offers the inbound relationships that are body tables, and writes the picked one as relatedList', async () => {
    const draft = { ...quote, fieldGroups: [{ key: 'basics', label: 'Basics' }, { key: 'lines', label: 'Lines' }] };
    const onPatch = renderInspector(draft, 'lines');
    fireEvent.keyDown(placementPicker(), { key: 'ArrowDown' });
    const options = within(await screen.findByRole('listbox')).getAllByRole('option').map((o) => o.textContent);
    // objectstack#27478: the side card `task` is not offered — a group only
    // positions a body table.
    expect(options).toEqual([
      t('engine.studio.designer.group.relatedListNone', 'en-US'),
      'Quote Line (quote_line)',
      'Schedule (schedule)',
    ]);
    fireEvent.click(screen.getByRole('option', { name: 'Quote Line (quote_line)' }));
    expect(onPatch.mock.calls.at(-1)![0].fieldGroups).toEqual([
      { key: 'basics', label: 'Basics' },
      { key: 'lines', label: 'Lines', relatedList: 'quote_line' },
    ]);
  });

  it('does not offer a relationship another group already places', async () => {
    const draft = {
      ...quote,
      fieldGroups: [{ key: 'lines', label: 'Lines', relatedList: 'quote_line' }, { key: 'more', label: 'More' }],
    };
    renderInspector(draft, 'more');
    fireEvent.keyDown(placementPicker(), { key: 'ArrowDown' });
    const options = within(await screen.findByRole('listbox')).getAllByRole('option').map((o) => o.textContent);
    expect(options).not.toContain('Quote Line (quote_line)');
    expect(options).toContain('Schedule (schedule)');
  });

  it('shows a stored side-card value with a line saying why it draws nothing (objectstack#27478)', () => {
    const draft = { ...quote, fieldGroups: [{ key: 'lines', label: 'Lines', relatedList: 'task' }] };
    renderInspector(draft, 'lines');
    expect(screen.getByTestId('group-related-table-not-body')).toHaveTextContent('“task” is not a body table');
    expect(placementPicker()).toHaveTextContent('task');
  });

  it('a stored body-table value draws no such line (control)', () => {
    const draft = { ...quote, fieldGroups: [{ key: 'lines', label: 'Lines', relatedList: 'quote_line' }] };
    renderInspector(draft, 'lines');
    expect(screen.queryByTestId('group-related-table-not-body')).toBeNull();
  });

  it('withholds the picker while the group still holds fields', () => {
    const draft = {
      ...quote,
      fields: { ...(quote.fields as Row), terms: { type: 'textarea', label: 'Terms', group: 'lines' } },
      fieldGroups: [{ key: 'lines', label: 'Lines' }],
    };
    renderInspector(draft, 'lines');
    expect(placementPicker()).toBeDisabled();
    expect(screen.getByTestId('group-related-table-hint')).toHaveTextContent(
      t('engine.studio.designer.group.relatedListHasFields', 'en-US'),
    );
  });

  it('clearing the picker removes the key', async () => {
    const draft = { ...quote, fieldGroups: [{ key: 'lines', label: 'Lines', relatedList: 'quote_line' }] };
    const onPatch = renderInspector(draft, 'lines');
    fireEvent.keyDown(placementPicker(), { key: 'ArrowDown' });
    fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', {
      name: t('engine.studio.designer.group.relatedListNone', 'en-US'),
    }));
    expect(onPatch.mock.calls.at(-1)![0].fieldGroups).toEqual([{ key: 'lines', label: 'Lines' }]);
  });
});

describe('ObjectFormDesigner — a related-table group is no place for fields', () => {
  it('draws the table group in its place, with no drop zone', () => {
    render(
      <ObjectFormDesigner
        draft={{
          name: 'quote',
          fields: { name: { type: 'text', label: 'Name', group: 'basics' } },
          fieldGroups: [
            { key: 'basics', label: 'Basics' },
            { key: 'lines', label: 'Lines', relatedList: 'quote_line' },
            { key: 'empty', label: 'Empty' },
          ],
        }}
        systemFieldNames={new Set()}
        onChange={() => {}}
        onSelectField={() => {}}
      />,
    );
    expect(screen.getByTestId('form-designer-related-table-lines')).toHaveTextContent('quote_line');
    // Only the ordinary empty group invites a drop.
    expect(screen.getAllByText(t('engine.studio.designer.dropHere', 'en-US'))).toHaveLength(1);
    expect(screen.queryByTestId('form-designer-related-table-empty')).toBeNull();
  });
});
