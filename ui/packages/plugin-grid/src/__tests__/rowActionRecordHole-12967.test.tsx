/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12967 — one action, two doors: a `${record.*}` hole in its
 * `confirmText` reads filled from the record header and from a list row.
 *
 * The header door is an `ActionProvider` whose context carries `record` (the
 * shape `RecordDetailView` mounts) firing the action. The row door is the real
 * `ObjectGrid` firing the same action from a row's menu, which dispatches it as
 * `{ ...def, params: { _rowRecord: row } }` under a provider whose context
 * names no record (a list page). Before the fix the row door's confirm read
 * `Pause ${record.display_name}?`, the template source.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider, useAction } from '@object-ui/react';

registerAllFields();

const OBJECT = 'sys_environment';
const ROW = { id: 'env_1', name: 'acme-prod', display_name: 'Acme' };

const pauseAction = (confirmText: string) => ({
  name: 'pause_environment',
  label: 'Pause',
  type: 'api',
  locations: ['list_item', 'record_header'],
  target: '/api/v1/environments/pause',
  confirmText,
});

const makeDataSource = () => ({
  find: vi.fn(async () => ({ data: [{ ...ROW }], total: 1 })),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn(async () => ({
    name: OBJECT,
    fields: { name: { type: 'text', label: 'Name' }, display_name: { type: 'text', label: 'Display name' } },
  })),
});

/** Cancel every confirm, recording the body the user would read. */
const recordingConfirm = () => vi.fn(async (_message: string) => false);

/** Header door: fire the action under a provider that binds `record`. */
async function headerConfirm(confirmText: string): Promise<string> {
  const onConfirm = recordingConfirm();
  function Fire() {
    const { execute } = useAction();
    return <button onClick={() => void execute(pauseAction(confirmText) as never)}>fire</button>;
  }
  render(
    <ActionProvider context={{ record: { ...ROW }, objectName: OBJECT }} onConfirm={onConfirm}>
      <Fire />
    </ActionProvider>,
  );
  await userEvent.click(screen.getByText('fire'));
  await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  cleanup();
  return onConfirm.mock.calls[0][0];
}

/** Row door: fire the same action from the real grid's row menu. */
async function rowConfirm(confirmText: string): Promise<string> {
  const onConfirm = recordingConfirm();
  const ds = makeDataSource();
  render(
    <ActionProvider context={{ objectName: OBJECT }} onConfirm={onConfirm}>
      <SchemaRendererProvider dataSource={ds as never}>
        <ObjectGrid
          schema={{ type: 'object-grid', objectName: OBJECT, columns: ['name'], rowActionDefs: [pauseAction(confirmText)] } as never}
          dataSource={ds as never}
        />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
  await waitFor(() => expect(screen.getByText('acme-prod')).toBeInTheDocument());
  await userEvent.click(await screen.findByTestId('row-action-trigger'));
  await userEvent.click(await screen.findByTestId('row-action-pause_environment'));
  await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  cleanup();
  return onConfirm.mock.calls[0][0];
}

afterEach(() => cleanup());

describe('one action, two doors: a record hole in `confirmText` (objectui#12967)', () => {
  it('(a) reads filled from the record header and from a list row', async () => {
    expect(await headerConfirm('Pause ${record.display_name}?')).toBe('Pause Acme?');
    expect(await rowConfirm('Pause ${record.display_name}?')).toBe('Pause Acme?');
  });

  it('(c) CONTROL: a hole naming a field the record lacks degrades the same way on both doors', async () => {
    const header = await headerConfirm('Pause ${record.no_such_field}?');
    const row = await rowConfirm('Pause ${record.no_such_field}?');
    expect(header).toBe('Pause ?');
    expect(row).toBe(header);
  });
});
