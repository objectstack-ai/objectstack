/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11815 — a kanban card judges a declared deadline against its own
 * record: an open card's past deadline reads "Overdue Nd" in red, a done
 * card's reads neutral (ruling D).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `object-kanban`.
import '../index';
// Cards render inside `KanbanRenderer`'s `React.lazy` boundary: imported at
// module scope so the cold transform is billed to the import phase (objectui#3010).
import '../KanbanImpl';

const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const TASK_DEF = {
  name: 'task',
  fields: {
    title: { type: 'text', label: 'Title' },
    status: { type: 'text', label: 'Status' },
    deliver_by: { type: 'date', label: 'Deliver by', dueLike: true, settledWhen: "record.status == 'done'" },
  },
};

const ROWS = [
  { id: 't-open', title: 'Open task', status: 'open', deliver_by: daysAgo(5) },
  { id: 't-done', title: 'Done task', status: 'done', deliver_by: daysAgo(5) },
];

const isRed = (text: string) => screen.getByText(text).closest('span.tabular-nums')?.className.includes('text-red-600');

describe('objectui#11815 — kanban card', () => {
  it("an open card's declared deadline reads overdue, a done card's reads neutral", async () => {
    const adapter = {
      find: vi.fn().mockResolvedValue({ data: ROWS }),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn().mockResolvedValue(TASK_DEF),
    };
    render(
      <SchemaRendererProvider dataSource={adapter as never}>
        <SchemaRenderer
          schema={
            {
              type: 'object-kanban',
              objectName: 'task',
              groupBy: 'status',
              columns: [
                { id: 'open', title: 'Open' },
                { id: 'done', title: 'Done' },
              ],
              cardFields: ['title', 'deliver_by'],
            } as never
          }
        />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(screen.getByText('Overdue 5d')).toBeInTheDocument());
    expect(isRed('Overdue 5d')).toBe(true);
    expect(screen.getAllByText('5 days ago')).toHaveLength(1);
    expect(isRed('5 days ago')).toBe(false);
  });
});
