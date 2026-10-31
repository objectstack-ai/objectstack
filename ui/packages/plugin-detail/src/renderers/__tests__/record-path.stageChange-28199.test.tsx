/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:path` with `allowStageChange: true` (objectstack#28061, console half
 * objectstack#28199): a stage press asks for confirmation, then writes the
 * status field through the record update with the record's concurrency token;
 * a server refusal is shown in place; a reader who may not edit the status
 * field — and every path that does not opt in — keeps the readout.
 *
 * The subject is imported relatively and `@object-ui/*` resolves to source
 * through the root vitest alias table, so nothing here reads a `dist/`.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { InlineEditProvider, RecordContextProvider, useInlineEdit } from '@object-ui/react';

const { permsStub, perms } = vi.hoisted(() => {
  const perms: { isLoaded: boolean; writeDenied: string[] } = { isLoaded: true, writeDenied: [] };
  return {
    perms,
    permsStub: {
      get isLoaded() { return perms.isLoaded; },
      checkField: (_object: string, field: string, action: string) =>
        action === 'read' ? true : !perms.writeDenied.includes(field),
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
    },
  };
});

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return { ...actual, usePermissions: () => permsStub as any };
});

import { RecordPathRenderer } from '../record-path';

const STAGES = [
  { value: 'draft', label: 'Draft' },
  { value: 'in_review', label: 'In review' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'declined', label: 'Declined', terminal: 'lost' as const },
];

const OBJECT_SCHEMA = {
  name: 'crm_quote',
  fields: {
    status: { type: 'select', label: 'Status' },
    amount: { type: 'currency', label: 'Amount' },
  },
};

const VERSION = '2026-10-30T12:00:00.000Z';

function makeDataSource(update: (...args: any[]) => Promise<unknown> = async () => ({})) {
  return { update: vi.fn(update) };
}

interface MountOptions {
  allowStageChange?: boolean;
  canEdit?: boolean;
  dataSource?: ReturnType<typeof makeDataSource>;
  refresh?: () => Promise<void>;
  objectSchema?: Record<string, unknown>;
  editing?: boolean;
}

function EnterEditing() {
  // Puts the page's edit session into editing, the way a field pencil does.
  const inline = useInlineEdit();
  const enter = inline?.enter;
  React.useEffect(() => { enter?.(); }, [enter]);
  return null;
}

function mount(opts: MountOptions = {}) {
  const dataSource = opts.dataSource ?? makeDataSource();
  const refresh = opts.refresh ?? vi.fn(async () => {});
  const schema: Record<string, unknown> = { statusField: 'status', stages: STAGES };
  if (opts.allowStageChange !== undefined) schema.allowStageChange = opts.allowStageChange;
  const r = render(
    <RecordContextProvider
      objectName="crm_quote"
      recordId="q1"
      data={{ id: 'q1', status: 'draft', updated_at: VERSION }}
      objectSchema={opts.objectSchema ?? OBJECT_SCHEMA}
      dataSource={dataSource as any}
      refresh={refresh}
    >
      <InlineEditProvider canEdit={opts.canEdit ?? true}>
        {opts.editing && <EnterEditing />}
        <RecordPathRenderer schema={schema as never} />
      </InlineEditProvider>
    </RecordContextProvider>,
  );
  return { ...r, dataSource, refresh };
}

/** Both rows (desktop + phone) are in the DOM; the first is the desktop rail. */
const rows = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll('[role="list"]')) as HTMLElement[];

async function pressAndConfirm(container: HTMLElement, stageLabel: string) {
  fireEvent.click(within(rows(container)[0]).getByRole('button', { name: `Move to ${stageLabel}` }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByText(`Move this record to ${stageLabel}?`)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
}

beforeEach(() => {
  perms.isLoaded = true;
  perms.writeDenied = [];
});

afterEach(() => cleanup());

describe('record:path allowStageChange — a press writes the stage', () => {
  it('every stage but the current one is a button, on both rows', () => {
    const { container } = mount({ allowStageChange: true });
    for (const row of rows(container)) {
      const names = within(row).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
      expect(names).toEqual(['Move to In review', 'Move to Accepted', 'Move to Declined']);
      // The listitem semantics and the state names stay as they were.
      expect(row.querySelector('[aria-current="step"]')).toHaveAttribute('aria-label', 'Draft, current stage');
    }
  });

  it('confirming writes { statusField: value } through update with the record version, then re-reads', async () => {
    const { container, dataSource, refresh } = mount({ allowStageChange: true });
    await pressAndConfirm(container, 'In review');
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
    expect(dataSource.update).toHaveBeenCalledWith('crm_quote', 'q1', { status: 'in_review' }, { ifMatch: VERSION });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(container.querySelector('[data-stage-change-refusal]')).toBeNull();
  });

  it('cancelling the confirmation writes nothing', async () => {
    const { container, dataSource } = mount({ allowStageChange: true });
    fireEvent.click(within(rows(container)[0]).getByRole('button', { name: 'Move to Accepted' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(dataSource.update).not.toHaveBeenCalled();
  });
});

describe('record:path allowStageChange — a refusal renders in place', () => {
  it('an illegal state_machine transition shows the server\'s sentence under the path', async () => {
    const refusal = Object.assign(new Error('VALIDATION_FAILED'), {
      code: 'VALIDATION_FAILED',
      fields: [{ field: 'status', code: 'state_machine', message: 'A quote cannot go from Draft to Accepted.' }],
    });
    const { container, refresh } = mount({
      allowStageChange: true,
      dataSource: makeDataSource(async () => { throw refusal; }),
    });
    await pressAndConfirm(container, 'Accepted');
    const alert = await within(container).findByRole('alert');
    expect(alert).toHaveAttribute('data-stage-change-refusal');
    expect(within(alert).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'A quote cannot go from Draft to Accepted.',
    ]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a required field elsewhere on the record is named by its label', async () => {
    const refusal = Object.assign(new Error('VALIDATION_FAILED'), {
      code: 'VALIDATION_FAILED',
      fields: [{ field: 'amount', code: 'required', message: 'is required to accept a quote' }],
    });
    const { container } = mount({
      allowStageChange: true,
      dataSource: makeDataSource(async () => { throw refusal; }),
    });
    await pressAndConfirm(container, 'Accepted');
    const alert = await within(container).findByRole('alert');
    expect(alert).toHaveTextContent('Amount: is required to accept a quote');
  });

  it('a permission refusal reads as a fixed line, not the raw 403 text', async () => {
    const refusal = Object.assign(new Error('[Security] PERMISSION_DENIED: no update on crm_quote'), {
      httpStatus: 403,
      code: 'PERMISSION_DENIED',
    });
    const { container } = mount({
      allowStageChange: true,
      dataSource: makeDataSource(async () => { throw refusal; }),
    });
    await pressAndConfirm(container, 'In review');
    const alert = await within(container).findByRole('alert');
    expect(alert).toHaveTextContent("You don't have permission to change this record's stage.");
  });

  it('a stale concurrency token says so and re-reads the record', async () => {
    const refusal = Object.assign(new Error('CONCURRENT_UPDATE'), { code: 'CONCURRENT_UPDATE' });
    const { container, refresh } = mount({
      allowStageChange: true,
      dataSource: makeDataSource(async () => { throw refusal; }),
    });
    await pressAndConfirm(container, 'In review');
    const alert = await within(container).findByRole('alert');
    expect(alert).toHaveTextContent('Someone else changed this record');
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('the next press clears the last refusal', async () => {
    const refusal = Object.assign(new Error('nope'), { code: 'VALIDATION_FAILED', fields: [{ field: 'status', message: 'Not from here.' }] });
    const { container } = mount({
      allowStageChange: true,
      dataSource: makeDataSource(async () => { throw refusal; }),
    });
    await pressAndConfirm(container, 'Accepted');
    await within(container).findByRole('alert');
    fireEvent.click(within(rows(container)[0]).getByRole('button', { name: 'Move to In review' }));
    expect(within(container).queryByRole('alert')).toBeNull();
  });
});

describe('record:path allowStageChange — who sees the readout', () => {
  const noButtons = (container: HTMLElement) => {
    for (const row of rows(container)) {
      expect(within(row).queryAllByRole('button')).toHaveLength(0);
      expect(row.querySelectorAll('button,[tabindex]')).toHaveLength(0);
    }
  };

  it('control: the opt-in absent keeps the readout, for a reader who could edit', () => {
    const { container } = mount({});
    expect(rows(container)).toHaveLength(2);
    noButtons(container);
  });

  it('control: the opt-in false keeps the readout', () => {
    noButtons(mount({ allowStageChange: false }).container);
  });

  it('a reader the page may not let edit this record sees the readout', () => {
    noButtons(mount({ allowStageChange: true, canEdit: false }).container);
  });

  it('a reader without the edit grant on the status field sees the readout', () => {
    perms.writeDenied = ['status'];
    noButtons(mount({ allowStageChange: true }).container);
  });

  it('a read-only status field is never pressable', () => {
    noButtons(
      mount({
        allowStageChange: true,
        objectSchema: { name: 'crm_quote', fields: { status: { type: 'select', readonly: true } } },
      }).container,
    );
  });

  it('while the record\'s inline edit holds a draft, the path is a readout', async () => {
    const { container } = mount({ allowStageChange: true, editing: true });
    await waitFor(() => noButtons(container));
  });
});
