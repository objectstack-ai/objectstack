/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27057 — a host's `onRowClick` takes a calendar event click, as it
 * takes a kanban card or a grid row.
 *
 * The console hands the calendar one through `ListView` (a function on the
 * `object-calendar` node), and that handler opens the record in the one record
 * page. The calendar used to drop it whenever its own navigation was the
 * drawer, which it always is unless a block authors otherwise, so a calendar
 * event opened the quick-look `RecordDetailPanel` while a grid row of the same
 * object opened the page.
 *
 * Rows, each through the real `SchemaRenderer` and the registered renderer:
 *   - a host function on the node key (the `ListView` channel) → the host gets
 *     the record, and no quick-look panel opens;
 *   - the same function as a trailing React prop (a host mounting the block
 *     itself) → the same;
 *   - no host → the calendar's own drawer opens, the fallback outside the
 *     console;
 *   - an authored string on the key → dropped by the declared host hatch, so
 *     the drawer opens and the click raises nothing.
 *
 * REVERSE VERIFICATION, direction predicted before running: put back
 * `onRowClick: navIsOverlay ? undefined : onRowClick` and the two host rows go
 * red (the host is never called and the panel opens), while the fallback and
 * the authored-string rows stay green.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';

vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  // The quick-look payload of the calendar's own drawer.
  RecordDetailPanel: ({ recordId }: { recordId: string | number }) => (
    <div data-testid="quick-look-panel" data-record-id={String(recordId)} />
  ),
}));

// Module scope: the registration side effect this file renders through.
import './index';

afterEach(cleanup);

function currentMonthRecords() {
  const now = new Date();
  const day = (n: number) => new Date(now.getFullYear(), now.getMonth(), n, 10, 0, 0, 0).toISOString();
  return [
    { id: 'r1', name: 'Kickoff call', start_at: day(10) },
    { id: 'r2', name: 'Design review', start_at: day(12) },
  ];
}

function calendarNode(extra: Record<string, unknown> = {}) {
  return {
    type: 'object-calendar',
    id: 'n',
    objectName: 'event',
    calendar: { startDateField: 'start_at', titleField: 'name' },
    data: currentMonthRecords(),
    ...extra,
  } as never;
}

async function clickKickoff(schema: unknown, hostProps: Record<string, unknown> = {}) {
  render(
    <SchemaRendererProvider dataSource={null}>
      <SchemaRenderer schema={schema as never} {...hostProps} />
    </SchemaRendererProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Kickoff call' }));
}

describe('a host row click takes a calendar event (objectstack#27057)', () => {
  it('a host function on the node key gets the record, and the quick-look panel stays shut', async () => {
    const host = vi.fn();
    await clickKickoff(calendarNode({ onRowClick: host }));

    await waitFor(() => expect(host).toHaveBeenCalledTimes(1));
    expect(host.mock.calls[0][0]).toMatchObject({ id: 'r1', name: 'Kickoff call' });
    expect(screen.queryByTestId('quick-look-panel')).toBeNull();
  });

  it('a host function passed as a React prop does the same', async () => {
    const host = vi.fn();
    await clickKickoff(calendarNode(), { onRowClick: host });

    await waitFor(() => expect(host).toHaveBeenCalledTimes(1));
    expect(host.mock.calls[0][0]).toMatchObject({ id: 'r1' });
    expect(screen.queryByTestId('quick-look-panel')).toBeNull();
  });

  it('FALLBACK: with no host the calendar opens its own drawer', async () => {
    await clickKickoff(calendarNode());

    const panel = await screen.findByTestId('quick-look-panel');
    expect(panel.getAttribute('data-record-id')).toBe('r1');
  });

  it('an authored string on the key is dropped: the drawer opens and the click raises nothing', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await clickKickoff(calendarNode({ onRowClick: 'NOT-A-FUNCTION' }));

      expect(await screen.findByTestId('quick-look-panel')).toBeTruthy();
      const typeErrors = errors.mock.calls.filter((args) => args.join(' ').includes('is not a function'));
      expect(typeErrors).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });
});
