/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26679 — a related list's row click hands the host the rows the
 * list shows, in its order, as a third argument: the clicked record's sibling
 * set, which the record drawer steps through with ↑ ↓ one level down.
 *
 * The node `RelatedList` hands `SchemaRenderer` is captured (the pattern of
 * `RelatedList.mobileLookupTitle-12188.test.tsx`), and its `onRowClick` is
 * invoked the way the table invokes it — `(row, event)`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { RelatedList } from '../RelatedList';

const h = vi.hoisted(() => ({ schema: null as any }));
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    SchemaRenderer: (props: any) => {
      h.schema = props.schema;
      return null;
    },
  };
});

const OBJECT = 'crm_task';
const ROWS = [
  { id: 't_1', subject: 'Send quote' },
  { id: 't_2', subject: 'Call back' },
  { id: 't_3', subject: 'Demo' },
];
const dataSource = {
  getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields: { subject: { type: 'text', label: 'Subject' } } })),
  find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
};

afterEach(() => {
  cleanup();
  h.schema = null;
});

describe('RelatedList row click carries the rows on show (objectstack#26679)', () => {
  it('calls the host with (row, event, rows), rows in the list order', async () => {
    const onRowClick = vi.fn();
    render(
      <RelatedList
        title="Tasks"
        type="table"
        api={OBJECT}
        objectName={OBJECT}
        referenceField="lead"
        parentId="l_1"
        columns={['subject']}
        dataSource={dataSource as any}
        onRowClick={onRowClick}
      />,
    );
    await waitFor(() => expect(h.schema?.data?.length ?? 0).toBe(3));
    const event = { button: 0 };
    h.schema.onRowClick(ROWS[1], event);
    expect(onRowClick).toHaveBeenCalledTimes(1);
    const [row, passedEvent, rows] = onRowClick.mock.calls[0];
    expect(row).toBe(ROWS[1]);
    expect(passedEvent).toBe(event);
    expect(rows.map((r: any) => r.id)).toEqual(['t_1', 't_2', 't_3']);
  });

  it('control, no host handler: the node carries no row click', async () => {
    render(
      <RelatedList
        title="Tasks"
        type="table"
        api={OBJECT}
        objectName={OBJECT}
        referenceField="lead"
        parentId="l_1"
        columns={['subject']}
        dataSource={dataSource as any}
      />,
    );
    await waitFor(() => expect(h.schema?.data?.length ?? 0).toBe(3));
    expect(h.schema.onRowClick).toBeUndefined();
  });
});
