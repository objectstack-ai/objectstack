/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#27520 row 8 — a bulk run's result names the
 * records it wrote, not only how many.
 *
 * Measured on the showcase's Tasks → Bulk Actions view: Mark Done over two
 * rows answered `Succeeded 2 / 2` and nothing else, so the user could not see
 * WHICH tasks were marked. The result now lists them, named the way the
 * confirm step names the affected records (the object's `nameField`).
 *
 * The list is only drawn when the successes are known: every failure the run
 * reports sits under a record of the run, so the rows left over are exactly
 * the ones that succeeded. A bulk call that answers a bare count names no
 * failed record, and the result keeps to its count.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { BulkActionDef } from '@object-ui/types';
import { BulkActionDialog } from '../components/BulkActionDialog';

afterEach(() => cleanup());

const ROWS = [
  { id: 't1', title: 'Content backlog' },
  { id: 't2', title: 'Evidence collection' },
  { id: 't3', title: 'Design system' },
];
const OBJECT_DEF = { name: 'task', nameField: 'title', fields: { title: { type: 'text', label: 'Title' } } };
const MARK_DONE: BulkActionDef = { name: 'mark_done', label: 'Mark Done', operation: 'update', patch: { done: true } } as BulkActionDef;

async function runOver(rows: typeof ROWS, dataSource: Record<string, unknown>) {
  render(
    <BulkActionDialog
      def={MARK_DONE}
      rows={rows}
      resource="task"
      dataSource={dataSource as any}
      objectDef={OBJECT_DEF}
      open
      onClose={() => {}}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Run' }));
}

describe('bulk result names the records it wrote (objectstack#27520 row 8)', () => {
  it('lists every record of a clean run by its title', async () => {
    const update = vi.fn(async () => ({}));
    await runOver(ROWS.slice(0, 2), { update });

    expect(await screen.findByText(/Succeeded 2 \/ 2/)).toBeInTheDocument();
    const list = screen.getByTestId('bulk-succeeded-records');
    expect(list).toHaveAccessibleName('Records that succeeded');
    const items = within(list).getAllByRole('listitem').map(li => li.textContent);
    expect(items).toEqual(['• Content backlog', '• Evidence collection']);
  });

  it('lists only the records that landed when the run refused one', async () => {
    const update = vi.fn(async (_resource: string, id: string) => {
      if (id === 't2') throw new Error('Evidence collection is locked');
      return {};
    });
    await runOver(ROWS, { update });

    expect(await screen.findByText(/Succeeded 2 \/ 3/)).toBeInTheDocument();
    const list = screen.getByTestId('bulk-succeeded-records');
    expect(within(list).getByText(/Content backlog/)).toBeInTheDocument();
    expect(within(list).getByText(/Design system/)).toBeInTheDocument();
    expect(within(list).queryByText(/Evidence collection/)).toBeNull();
    // The refused record stays listed under its refusal.
    expect(screen.getByTestId('bulk-error-record-t2')).toHaveTextContent('Evidence collection');
  });

  it('names no record when a bulk call answered a count without naming its failures', async () => {
    const update = vi.fn(async () => ({}));
    // Two of three landed, and the call does not say which.
    const bulkUpdate = vi.fn(async () => 2);
    await runOver(ROWS, { update, bulkUpdate });

    expect(await screen.findByText(/Succeeded 2 \/ 3/)).toBeInTheDocument();
    expect(bulkUpdate).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('bulk-succeeded-records')).toBeNull();
  });
});
