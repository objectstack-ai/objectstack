/**
 * Repro: below the mobile breakpoint, ObjectGrid switches to a stacked
 * card layout. A `lookup` field's value arrives as a server-expanded
 * object (`{ id, name }`), which the card view's title/detail rendering
 * used to dump through a raw `String(value)` — producing the literal
 * text "[object Object]" instead of the record's display name.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const ORIGINAL_INNER_WIDTH = window.innerWidth;

function setMobileWidth() {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 });
}

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: ORIGINAL_INNER_WIDTH });
});

const OBJECT = 'showcase_account';

function makeDataSource() {
  const rows = [
    { id: 'a1', owner: { id: 'u1', name: 'Dev Admin' }, account_name: 'Northwind' },
  ];
  return {
    find: vi.fn(async () => ({ data: rows, total: rows.length, hasMore: false, pageSize: 50 })),
    getObjectSchema: async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        owner: { type: 'lookup', label: 'Owner', reference: 'users' },
        account_name: { type: 'text', label: 'Account Name' },
      },
    }),
  } as any;
}

function renderGrid(dataSource: any) {
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    // "owner" (a lookup) is deliberately the FIRST column — this is the card
    // view's "title" cell, exactly matching the real Account object's column
    // order that triggered the bug.
    columns: [
      { field: 'owner', label: 'Owner', type: 'lookup' },
      { field: 'account_name', label: 'Account Name' },
    ],
    pagination: { pageSize: 50 },
  };
  return render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={dataSource}>
        <ObjectGrid schema={schema} dataSource={dataSource} />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

describe('ObjectGrid — mobile card view resolves lookup display names', () => {
  it('shows the lookup record\'s name instead of "[object Object]" in the card title', async () => {
    setMobileWidth();
    const ds = makeDataSource();
    renderGrid(ds);

    await waitFor(() => expect(screen.getByText('Dev Admin')).toBeInTheDocument());
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument();
  });
});
