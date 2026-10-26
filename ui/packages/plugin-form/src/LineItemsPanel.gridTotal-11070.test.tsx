/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:line_items` shows its grid's footer total whenever `amountField`
 * names the child column to sum (objectui#11070 round 8).
 *
 * The grid's `totalField` (`total_field` until objectui#11610) is the CHILD
 * column summed. `MasterDetailForm` maps it from the detail's `amountField`;
 * this panel used to map it only when the block's own `totalField` (the
 * PARENT field the sum is saved to) was set as well, so a
 * panel that named only the column to sum (the objectstack showcase's
 * project page authors exactly that) showed no total. Both adapters now map
 * the same key the same way.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { SchemaRendererProvider } from '@object-ui/react';
import { LineItemsPanel, type LineItemsPanelSchema } from './LineItemsPanel';

registerAllFields();

function dataSource() {
  return {
    getObjectSchema: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockResolvedValue({
      data: [
        { id: 'l1', hours: 3 },
        { id: 'l2', hours: 4 },
      ],
    }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as any;
}

const BASE: LineItemsPanelSchema = {
  childObject: 'task',
  relationshipField: 'project',
  parentObject: 'project',
  parentId: 'p1',
  columns: [{ name: 'hours', label: 'Hours', type: 'number' }],
};

function show(schema: LineItemsPanelSchema) {
  render(
    <SchemaRendererProvider dataSource={dataSource()}>
      <LineItemsPanel schema={schema} />
    </SchemaRendererProvider>,
  );
}

/** Wait for the rows to load, so an absent total is not just an unfinished load. */
async function loaded() {
  await waitFor(() => expect(screen.getAllByLabelText('Hours').length).toBeGreaterThanOrEqual(2));
}

describe('record:line_items: the grid total follows `amountField` (objectui#11070 round 8)', () => {
  it('`amountField` alone shows the footer total of that child column', async () => {
    show({ ...BASE, amountField: 'hours' });
    await loaded();
    expect(screen.getByTestId('line-items-total').textContent).toBe('7');
  });

  it('CONTROL: with neither key there is no footer total', async () => {
    show(BASE);
    await loaded();
    expect(screen.queryByTestId('line-items-total')).toBeNull();
  });
});
