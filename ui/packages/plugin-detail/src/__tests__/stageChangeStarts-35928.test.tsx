/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectstack#35928 — the record page's stage confirm names the flows the
 * move would start (ruling record 7073655354), through `../stageChangeStarts`,
 * the reader the list cell's confirm shares. Both of the page's confirms are
 * pinned: `record:path`'s plain confirmation and the header stage menu's
 * dialog (`RecordStageMenu`, the shared `RequiredFieldsDialog`).
 *
 *   1. List: the confirm asks `POST /api/v1/automation/_record-starts` for the
 *      record and the move, and names each flow by label under today's
 *      sentence, a flow holding an approval marked as such.
 *   2. Empty: an answer of no flows draws no list; the sentence stands alone.
 *   3. Failure: a refused read draws no list; the sentence stands alone, and
 *      the move still writes on Move.
 *
 * `@object-ui/*` resolves to source through the root vitest alias table.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { InlineEditProvider, RecordContextProvider } from '@object-ui/react';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  const stub = {
    isLoaded: true,
    checkField: () => true,
    check: () => ({ allowed: true }),
    getFieldPermissions: () => [],
    getRowFilter: () => undefined,
    getObjectApiOperations: () => undefined,
    roles: [],
    userId: null,
    systemPermissions: undefined,
    hasCapabilities: () => true,
    can: () => true,
    cannot: () => false,
  };
  return { ...actual, usePermissions: () => stub as any };
});

import { RecordPathRenderer } from '../renderers/record-path';
import { RecordStageMenu } from '../RecordStageMenu';

const VERSION = '2026-11-20T12:00:00.000Z';
const CLOSURE = { name: 'project_closure', label: 'Project Closure', startsApproval: true };
const NOTIFY = { name: 'notify_owner', label: 'Notify Owner', startsApproval: false };

const PROJECT = {
  name: 'project',
  fields: {
    name: { type: 'text', label: 'Name' },
    status: {
      type: 'select',
      label: 'Status',
      options: [
        { value: 'active', label: 'Active' },
        { value: 'completed', label: 'Completed' },
      ],
    },
  },
};

type StartsAnswer = { status: number; body: unknown } | 'network-error';

/** The global `fetch`, answering `_record-starts` with `answer` and recording every request. */
function installFetch(answer: StartsAnswer) {
  const calls: Array<{ url: string; body: any }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: unknown }) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (answer === 'network-error') throw new TypeError('Failed to fetch');
    return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
  }));
  return calls;
}

const listed = (flows: unknown[]): StartsAnswer => ({ status: 200, body: { success: true, data: { flows } } });

function Host({ children }: { children: React.ReactNode }) {
  const [dataSource] = React.useState(() => ({ update: vi.fn(async () => ({})) }));
  return (
    <RecordContextProvider
      objectName="project"
      recordId="p1"
      data={{ id: 'p1', name: 'Apollo', status: 'active', updated_at: VERSION }}
      objectSchema={PROJECT}
      dataSource={dataSource as any}
      refresh={async () => {}}
    >
      <InlineEditProvider canEdit>{children}</InlineEditProvider>
    </RecordContextProvider>
  );
}

/** `record:path`'s confirmation, opened on Completed. */
async function openPathConfirm(): Promise<HTMLElement> {
  const { container } = render(
    <Host>
      <RecordPathRenderer
        schema={{
          statusField: 'status',
          allowStageChange: true,
          stages: [{ value: 'active', label: 'Active' }, { value: 'completed', label: 'Completed' }],
        } as never}
      />
    </Host>,
  );
  const rail = container.querySelector('[role="list"]') as HTMLElement;
  fireEvent.click(within(rail).getByRole('button', { name: 'Move to Completed' }));
  return screen.findByRole('alertdialog');
}

/** The header stage menu's dialog, opened on Completed. */
async function openMenuConfirm(): Promise<HTMLElement> {
  render(
    <Host>
      <RecordStageMenu field="status" label="Active" tag={<span>Active</span>} />
    </Host>,
  );
  fireEvent.pointerDown(screen.getByRole('button', { name: /^Stage: / }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
  const item = within(screen.getByRole('menu')).getAllByRole('menuitem').find((el) => el.textContent?.startsWith('Completed'))!;
  fireEvent.click(item);
  return screen.findByRole('dialog');
}

const startsCalls = (calls: Array<{ url: string; body: any }>) =>
  calls.filter((c) => c.url === '/api/v1/automation/_record-starts');

const CONFIRMS: Array<[string, () => Promise<HTMLElement>]> = [
  ['record:path confirmation', openPathConfirm],
  ['header stage menu dialog', openMenuConfirm],
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.each(CONFIRMS)('#35928 the %s names the flows the move starts', (_name, open) => {
  let calls: Array<{ url: string; body: any }>;
  beforeEach(() => {
    calls = [];
  });

  it('list: asks for the record and the move, and names each flow under the sentence, approval marked', async () => {
    calls = installFetch(listed([CLOSURE, NOTIFY]));
    const dialog = await open();
    const list = await within(dialog).findByTestId('stage-change-starts');
    expect(within(dialog).getByText('Move this record to Completed?')).toBeInTheDocument();
    expect(list).toHaveTextContent('Saving this change starts these flows:');
    const closure = list.querySelector('[data-stage-change-start="project_closure"]')!;
    const notify = list.querySelector('[data-stage-change-start="notify_owner"]')!;
    expect(closure).toHaveTextContent('Project Closure');
    expect(closure.querySelector('[data-stage-change-start-approval]')).toHaveTextContent('starts an approval');
    expect(notify).toHaveTextContent('Notify Owner');
    expect(notify.querySelector('[data-stage-change-start-approval]')).toBeNull();
    expect(startsCalls(calls).map((c) => c.body)).toEqual([
      { object: 'project', recordId: 'p1', changes: { status: 'completed' } },
    ]);
  });

  it('empty: no flows answered draws no list, and the sentence stands alone', async () => {
    calls = installFetch(listed([]));
    const dialog = await open();
    await waitFor(() => expect(startsCalls(calls)).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(within(dialog).queryByTestId('stage-change-starts')).toBeNull();
    expect(within(dialog).getByText('Move this record to Completed?')).toBeInTheDocument();
  });

  it('failure: a refused read and a network error draw no list, and the sentence stands alone', async () => {
    calls = installFetch({ status: 404, body: { success: false, error: { code: 'RECORD_NOT_FOUND', message: 'no' } } });
    const refused = await open();
    await waitFor(() => expect(startsCalls(calls)).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(within(refused).queryByTestId('stage-change-starts')).toBeNull();
    expect(within(refused).getByText('Move this record to Completed?')).toBeInTheDocument();
    cleanup();
    vi.unstubAllGlobals();

    calls = installFetch('network-error');
    const failed = await open();
    await waitFor(() => expect(startsCalls(calls)).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(within(failed).queryByTestId('stage-change-starts')).toBeNull();
    expect(within(failed).getByText('Move this record to Completed?')).toBeInTheDocument();
  });

  it('a malformed answer (not the declared envelope) draws no list', async () => {
    calls = installFetch({ status: 200, body: { flows: [CLOSURE] } });
    const dialog = await open();
    await waitFor(() => expect(startsCalls(calls)).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(within(dialog).queryByTestId('stage-change-starts')).toBeNull();
  });
});
