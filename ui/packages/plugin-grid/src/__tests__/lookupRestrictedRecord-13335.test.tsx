/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13335 in the GRID: a lookup cell whose record the viewer may not
 * read (its GET answers 404, so `findOne` answers `null`) printed the raw id
 * beside a question mark. Driven through the real `ObjectGrid`; the second
 * row's readable reference is the control.
 */

import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';

registerAllFields();

const OBJECT = 'kb_article_13335';
const REFERENCED = 'kb_case_13335_grid';
const RESTRICTED_ID = 'CTPnPnOW17jcvcy-grid';
const READABLE = { id: 'CASE-GRID-READABLE', name: 'Printer jam' };
const ROWS = [
  { id: 'a1', title: 'KA-0025', source_case: RESTRICTED_ID },
  { id: 'a2', title: 'KA-0026', source_case: READABLE.id },
];

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

describe('objectui#13335 — ObjectGrid: an unreadable lookup cell reads "Restricted record"', () => {
  it('the unreadable cell shows the label with no id; the readable cell keeps its name', async () => {
    const ds = {
      find: vi.fn(async () => ({ data: ROWS, total: ROWS.length, hasMore: false, pageSize: 50 })),
      findOne: vi.fn(async (objectName: string, id: string) =>
        objectName === REFERENCED && id === READABLE.id ? READABLE : null,
      ),
      getObjectSchema: async (name: string) =>
        name === REFERENCED
          ? { name, fields: { id: { type: 'text' }, name: { type: 'text' } } }
          : {
              name,
              fields: {
                id: { type: 'text' },
                title: { type: 'text', label: 'Title' },
                source_case: { type: 'lookup', label: 'Source Case', reference: REFERENCED },
              },
            },
    } as any;
    const schema: any = {
      type: 'object-grid',
      objectName: OBJECT,
      data: ROWS,
      pagination: { pageSize: 50 },
      columns: [
        { field: 'title', label: 'Title' },
        { field: 'source_case', label: 'Source Case', type: 'lookup' },
      ],
    };

    const { container } = render(
      <ActionProvider>
        <SchemaRendererProvider dataSource={ds}>
          <ObjectGrid schema={schema} dataSource={ds} />
        </SchemaRendererProvider>
      </ActionProvider>,
    );

    await waitFor(() => expect(screen.getAllByText('Printer jam').length).toBeGreaterThan(0), { timeout: 4000 });
    await waitFor(() => expect(screen.getAllByText('Restricted record').length).toBeGreaterThan(0), { timeout: 4000 });
    expect(container.textContent, 'the unreadable id is not printed in the grid').not.toContain(RESTRICTED_ID);
    const marks = container.querySelectorAll('[data-slot="restricted-reference"]');
    expect(marks).toHaveLength(1);
    // What the lookup renderer draws carries no id and no link. (The table's
    // own cell wrapper, `data-table`'s and not this renderer's, put the raw
    // value in its `title` too, until objectui#13377: that half is pinned in
    // `lookupCellTooltip-13377.test.tsx`.)
    expect(marks[0]!.outerHTML).not.toContain(RESTRICTED_ID);
    expect(marks[0]!.closest('td')!.querySelector('a')).toBeNull();
    expect(container.querySelectorAll('[data-slot="unresolved-reference"]')).toHaveLength(0);
  });
});
