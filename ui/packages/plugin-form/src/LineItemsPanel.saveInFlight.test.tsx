/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `record:line_items` panel takes no input into its grid while its own
 * save is in flight (objectui#10631).
 *
 * The panel reloads its rows once a save lands, so a line edited while the
 * batch was still in flight was overwritten by that reload and the panel read
 * clean: the edit was lost with nothing on screen to say so. Its grid is now
 * disabled for the length of the save, exactly as the master-detail form's is.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { SchemaRendererProvider } from '@object-ui/react';
import { LineItemsPanel } from './LineItemsPanel';

registerAllFields();

const schema = {
  childObject: 'po_line',
  relationshipField: 'po',
  parentObject: 'po',
  parentId: 'p1',
  columns: [{ name: 'amount', label: 'Amount', type: 'number' }],
} as any;

const amountInputs = () => screen.getAllByLabelText('Amount') as HTMLInputElement[];
const saveButton = () => screen.getByRole('button', { name: /^(Save|Saving…)$/ }) as HTMLButtonElement;

describe('LineItemsPanel: the grid is disabled while the save is in flight', () => {
  it('a keystroke during the save does not reach the grid, and the grid takes input again once the save has reloaded', async () => {
    let stored = [{ id: 'l1', amount: 10 }];
    let land: () => void = () => {};
    const batchTransaction = vi.fn(async (ops: any[]) => {
      await new Promise<void>((r) => { land = r; });
      stored = [{ id: 'l1', amount: ops.find((o) => o.id === 'l1')?.data?.amount ?? 10 }];
      return { results: ops.map((op) => ({ id: op.id, ...op.data })) };
    });
    const ds: any = {
      getObjectSchema: vi.fn().mockResolvedValue(null),
      find: vi.fn(async () => ({ data: stored.map((r) => ({ ...r })) })),
      batchTransaction,
    };
    render(
      <SchemaRendererProvider dataSource={ds}>
        <LineItemsPanel schema={schema} />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(amountInputs()[0].value).toBe('10'));
    await act(async () => {
      fireEvent.change(amountInputs()[0], { target: { value: '15' } });
    });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(batchTransaction).toHaveBeenCalledTimes(1));

    expect(saveButton().disabled).toBe(true);
    for (const input of amountInputs()) expect(input.disabled).toBe(true);
    const user = userEvent.setup();
    await user.type(amountInputs()[0], '9');
    expect(amountInputs()[0].value).toBe('15');

    await act(async () => {
      land();
    });
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(2)); // the post-save reload
    await waitFor(() => expect(amountInputs()[0].disabled).toBe(false));
    expect(amountInputs()[0].value).toBe('15');
    // Nothing typed during the save is pending: the panel is clean.
    expect(saveButton().disabled).toBe(true);
  });
});
