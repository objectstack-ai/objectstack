/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The record page's edit state draws its body tables as the host's editor
 * (objectstack#35599). The page keeps its `record:related_list` nodes; a host
 * provides `RecordBodyTableEditorSlotContext` while the edit state is open, and
 * a list whose relationship id (`CHILD_OBJECT.FK_FIELD`) is in the slot's set
 * draws the slot's element in its place — it reads no rows of its own. Every
 * other list draws as before. CONTROLs: no slot (read mode, every other page)
 * and a slot naming other relationships leave every list a read-only list.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RecordContextProvider, SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import type { DataSource } from '@object-ui/types';
// Registers `record:related_list`, the block under test.
import '../../index';
import { RecordBodyTableEditorSlotContext, type RecordBodyTableEditorSlot } from '../../relatedListCompact';

afterEach(() => cleanup());

const PARENT = 'crm_account';

const ROWS: Record<string, Array<Record<string, unknown>>> = {
  crm_quote: [{ id: 'q1', name: 'Q-001', account_id: 'a1' }],
  crm_contact: [{ id: 'c1', name: 'Ada', account_id: 'a1' }],
};

const makeDataSource = () => ({
  find: vi.fn(async (object: string) => {
    const data = ROWS[object] ?? [];
    return { data, total: data.length };
  }),
  getObjectSchema: vi.fn(async (name: string) => ({ name, fields: { name: { type: 'text', label: 'Name' } } })),
  onMutation: () => () => {},
});

const NODES = [
  { type: 'record:related_list', id: 'quotes', properties: { objectName: 'crm_quote', relationshipField: 'account_id', title: 'Quotes', columns: ['name'] } },
  { type: 'record:related_list', properties: { objectName: 'crm_contact', relationshipField: 'account_id', title: 'Contacts', columns: ['name'] } },
];

const slotFor = (ids: string[]): RecordBodyTableEditorSlot => ({
  ids: new Set(ids),
  render: ({ objectName, relationshipField, title }) => (
    <div data-testid="slot-editor" data-table={`${objectName}.${relationshipField}`}>
      {title ?? ''}
    </div>
  ),
});

function mount(slot: RecordBodyTableEditorSlot | null) {
  const ds = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={ds as unknown as DataSource}>
      <RecordContextProvider objectName={PARENT} recordId="a1" dataSource={ds as never}>
        <RecordBodyTableEditorSlotContext.Provider value={slot}>
          {NODES.map((node, idx) => (
            <SchemaRenderer key={idx} schema={node as never} />
          ))}
        </RecordBodyTableEditorSlotContext.Provider>
      </RecordContextProvider>
    </SchemaRendererProvider>,
  );
  return ds;
}

const readObjects = (ds: ReturnType<typeof makeDataSource>) => ds.find.mock.calls.map((c) => c[0]);

describe('record:related_list — the edit state draws a body table as the host editor (objectstack#35599)', () => {
  it('a list named by the slot draws the slot element with its relationship and title, and reads no rows; the other list is unchanged', async () => {
    const ds = mount(slotFor(['crm_quote.account_id']));
    await screen.findByText('Ada');
    const editors = screen.getAllByTestId('slot-editor');
    expect(editors).toHaveLength(1);
    expect(editors[0]).toHaveAttribute('data-table', 'crm_quote.account_id');
    expect(editors[0]).toHaveTextContent('Quotes');
    expect(screen.queryByText('Q-001')).toBeNull();
    expect(readObjects(ds)).not.toContain('crm_quote');
  });

  it('CONTROL — with no slot every list is the read-only list', async () => {
    const ds = mount(null);
    await screen.findByText('Ada');
    await screen.findByText('Q-001');
    expect(screen.queryByTestId('slot-editor')).toBeNull();
    await waitFor(() => expect(readObjects(ds)).toContain('crm_quote'));
  });

  it('CONTROL — a slot naming other relationships leaves every list as it was', async () => {
    mount(slotFor(['crm_quote.other_fk', 'crm_order.account_id']));
    await screen.findByText('Ada');
    await screen.findByText('Q-001');
    expect(screen.queryByTestId('slot-editor')).toBeNull();
  });
});
