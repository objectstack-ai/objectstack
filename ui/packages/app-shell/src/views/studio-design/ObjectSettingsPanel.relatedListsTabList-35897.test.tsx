/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35897 · #35899 — the object settings panel authors `relatedLists`
 * as the record page's TAB LIST:
 *  - an entry's object form (`{ list, label, columns }`) and the built-in tab
 *    names survive every write (a move, a removal, an add);
 *  - the built-in tabs are offered by object name, attachments only when the
 *    object enables files, and a listed attachments tab on an object without
 *    files says it does not show;
 *  - a relationship row edits its own title and columns: a title or a column
 *    writes the object form, clearing both writes the bare name again;
 *  - the preview draws the tabs in order, built-ins included.
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { t } from '../metadata-admin/i18n';
import { ObjectSettingsPanel } from './ObjectSettingsPanel';

afterEach(cleanup);

type Row = Record<string, unknown>;

const quote: Row = { name: 'quote', label: 'Quote', fields: { name: { type: 'text', label: 'Name' } } };
const line: Row = {
  name: 'quote_line',
  label: 'Quote Line',
  fields: {
    quote_id: { type: 'lookup', reference: 'quote', label: 'Quote' },
    product: { type: 'text', label: 'Product' },
    quantity: { type: 'number', label: 'Quantity' },
    amount: { type: 'currency', label: 'Amount' },
  },
};
const task: Row = {
  name: 'task',
  label: 'Task',
  fields: { quote_id: { type: 'lookup', reference: 'quote', label: 'Quote' }, subject: { type: 'text', label: 'Subject' } },
};
const REGISTRY = [quote, line, task];

function store(): MetadataContextValue {
  return {
    apps: [],
    objects: REGISTRY,
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
}

function Host({ initial, writes }: { initial: Row; writes: Row[] }) {
  const [draft, setDraft] = React.useState<Row>(initial);
  const value = React.useMemo(() => store(), []);
  return (
    <MetadataCtx.Provider value={value}>
      <ObjectSettingsPanel
        name="quote"
        draft={draft}
        onPatch={(patch: Row) => setDraft((d) => {
          const next = { ...d, ...patch };
          writes.push(next);
          return next;
        })}
        locale="en-US"
      />
    </MetadataCtx.Provider>
  );
}

const rowOrder = () =>
  screen.getAllByTestId(/^related-lists-row-/).map((el) => el.getAttribute('data-testid')!.replace('related-lists-row-', ''));
const lastLists = (writes: Row[]) => writes.at(-1)!.relatedLists;
const LINE_ENTRY = { list: 'quote_line', label: 'Line items', columns: ['product', 'amount'] };

describe('ObjectSettingsPanel — relatedLists is the record page tab list (objectstack#35897)', () => {
  it('a move keeps an entry\'s object form and the built-in names', () => {
    const writes: Row[] = [];
    render(<Host initial={{ ...quote, relatedLists: [LINE_ENTRY, 'sys_activity', 'task'] }} writes={writes} />);
    expect(rowOrder()).toEqual(['quote_line', 'sys_activity', 'task']);
    // The entry's own title names its row; the built-in is named and tagged.
    expect(screen.getByTestId('related-lists-row-quote_line')).toHaveTextContent('Line items');
    const stream = screen.getByTestId('related-lists-row-sys_activity');
    expect(stream).toHaveTextContent(t('engine.studio.settings.relatedListsBuiltin.sys_activity', 'en-US'));
    expect(stream).toHaveTextContent(t('engine.studio.settings.relatedListsBuiltin', 'en-US'));
    expect(screen.queryByTestId('related-lists-unmatched')).toBeNull();

    fireEvent.click(within(screen.getByTestId('related-lists-row-task')).getByRole('button', { name: 'Move up' }));
    expect(lastLists(writes)).toEqual([LINE_ENTRY, 'task', 'sys_activity']);

    fireEvent.click(screen.getByRole('button', { name: 'Remove task' }));
    expect(lastLists(writes)).toEqual([LINE_ENTRY, 'sys_activity']);
  });

  it('offers the built-ins by object name, attachments only with files on', async () => {
    const writes: Row[] = [];
    render(<Host initial={{ ...quote, enable: { files: true }, relatedLists: ['task'] }} writes={writes} />);
    fireEvent.keyDown(screen.getByTestId('related-lists-add-select'), { key: 'ArrowDown' });
    const options = within(await screen.findByRole('listbox')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual([
      t('engine.studio.settings.relatedListsAdd', 'en-US'),
      'Attachments (sys_attachment)',
      'Approvals (sys_approval_request)',
      'Activity (sys_activity)',
      'Quote Line (quote_line)',
    ]);
    fireEvent.click(screen.getByRole('option', { name: 'Attachments (sys_attachment)' }));
    expect(lastLists(writes)).toEqual(['task', 'sys_attachment']);
    // A relationship not listed shows no tab.
    expect(screen.getByTestId('related-lists-tail')).toHaveTextContent(t('engine.studio.settings.relatedListsTail', 'en-US'));
    // The preview draws the tabs in order, then the unlisted approvals and stream.
    expect(screen.getByTestId('related-lists-preview-side')).toHaveTextContent('Task · Attachments · Approvals · Activity');
  });

  it('a listed attachments tab on an object without files says it does not show', () => {
    render(<Host initial={{ ...quote, relatedLists: ['sys_attachment', 'task'] }} writes={[]} />);
    expect(screen.getByTestId('related-lists-attachments-off')).toHaveTextContent(
      t('engine.studio.settings.relatedListsAttachmentsOff', 'en-US'),
    );
    expect(screen.getByTestId('related-lists-preview-side')).toHaveTextContent('Task · Approvals · Activity');
    expect(screen.getByTestId('related-lists-preview-side')).not.toHaveTextContent('Attachments');
  });

  it('edits an entry\'s own title and columns, and clearing both writes the bare name', async () => {
    const writes: Row[] = [];
    render(<Host initial={{ ...quote, relatedLists: ['quote_line', 'task'] }} writes={writes} />);
    // A built-in has no edit; a relationship has.
    fireEvent.click(screen.getByTestId('related-lists-edit-quote_line'));
    const details = screen.getByTestId('related-lists-details-quote_line');

    fireEvent.change(within(details).getByTestId('related-lists-title-quote_line'), { target: { value: 'Line items' } });
    expect(lastLists(writes)).toEqual([{ list: 'quote_line', label: 'Line items' }, 'task']);

    // The column picker offers the child's own fields.
    fireEvent.keyDown(within(details).getByTestId('related-lists-column-add-quote_line'), { key: 'ArrowDown' });
    const options = within(await screen.findByRole('listbox')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual([
      t('engine.studio.settings.relatedListsColumnAdd', 'en-US'),
      'Quote (quote_id)',
      'Product (product)',
      'Quantity (quantity)',
      'Amount (amount)',
    ]);
    fireEvent.click(screen.getByRole('option', { name: 'Amount (amount)' }));
    expect(lastLists(writes)).toEqual([{ list: 'quote_line', label: 'Line items', columns: ['amount'] }, 'task']);

    // A move elsewhere in the list keeps the details.
    fireEvent.click(within(screen.getByTestId('related-lists-row-task')).getByRole('button', { name: 'Move up' }));
    expect(lastLists(writes)).toEqual(['task', { list: 'quote_line', label: 'Line items', columns: ['amount'] }]);

    // Clearing the title and the last column writes the bare name again.
    fireEvent.change(screen.getByTestId('related-lists-title-quote_line'), { target: { value: '' } });
    fireEvent.click(within(screen.getByTestId('related-lists-details-quote_line')).getByRole('button', { name: 'Remove amount' }));
    expect(lastLists(writes)).toEqual(['task', 'quote_line']);
  });

  it('a built-in row has no edit', () => {
    render(<Host initial={{ ...quote, relatedLists: ['sys_approval_request', 'task'] }} writes={[]} />);
    expect(screen.queryByTestId('related-lists-edit-sys_approval_request')).toBeNull();
    expect(screen.getByTestId('related-lists-edit-task')).toBeInTheDocument();
  });
});
