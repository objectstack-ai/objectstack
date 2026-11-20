/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectstack#35891 — the record header's stage tag is the stage's menu.
 *
 * - A reader who may move the stage gets the tag with an arrow; it opens a
 *   menu of every stage in order, the current one checked.
 * - A stage the field's blocking `state_machine` cannot reach is disabled and
 *   says why under its name.
 * - Picking a stage confirms, then writes the stage through the record update.
 * - A stage whose move makes another field required (`requiredWhen`) asks for
 *   just that field in the same dialog; the move and the value go in one
 *   write. A refusal is shown in the dialog and nothing else moves.
 * - A reader who may not edit (no field grant, a page that may not edit, an
 *   approval lock) sees the plain tag.
 * - The keyboard: Enter on the tag opens, arrows move, Enter picks, Esc closes.
 *
 * `@object-ui/*` resolves to source through the root vitest alias table.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { InlineEditProvider, RecordContextProvider } from '@object-ui/react';

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

import { RecordStageMenu } from '../RecordStageMenu';

const VERSION = '2026-11-20T12:00:00.000Z';

const OPPORTUNITY = {
  name: 'crm_opportunity',
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: {
      type: 'select',
      label: 'Stage',
      options: [
        { value: 'prospecting', label: 'Prospecting' },
        { value: 'negotiation', label: 'Negotiation' },
        { value: 'closed_won', label: 'Closed Won', kind: 'won' },
        { value: 'closed_lost', label: 'Closed Lost', kind: 'lost' },
      ],
    },
    loss_reason: {
      type: 'text',
      label: 'Loss Reason',
      requiredWhen: 'has(record.stage) && record.stage == "closed_lost"',
    },
  },
  validations: [
    {
      type: 'state_machine',
      name: 'deal_flow',
      field: 'stage',
      message: 'A deal cannot skip negotiation.',
      transitions: {
        prospecting: ['negotiation', 'closed_lost'],
        negotiation: ['closed_won', 'closed_lost'],
      },
    },
  ],
};

function makeDataSource(update: (...args: any[]) => Promise<unknown> = async () => ({})) {
  return { update: vi.fn(update) };
}

interface MountOptions {
  canEdit?: boolean;
  dataSource?: ReturnType<typeof makeDataSource>;
  refresh?: () => Promise<void>;
  stage?: string;
}

function mount(opts: MountOptions = {}) {
  const dataSource = opts.dataSource ?? makeDataSource();
  const refresh = opts.refresh ?? vi.fn(async () => {});
  const stage = opts.stage ?? 'prospecting';
  const label = OPPORTUNITY.fields.stage.options.find((o) => o.value === stage)!.label;
  const tag = <span data-testid="plain-tag">{label}</span>;
  const r = render(
    <RecordContextProvider
      objectName="crm_opportunity"
      recordId="o1"
      data={{ id: 'o1', name: 'Wayne deal', stage, loss_reason: null, updated_at: VERSION }}
      objectSchema={OPPORTUNITY}
      dataSource={dataSource as any}
      refresh={refresh}
    >
      <InlineEditProvider canEdit={opts.canEdit ?? true}>
        <RecordStageMenu field="stage" label={label} tag={tag} />
      </InlineEditProvider>
    </RecordContextProvider>,
  );
  return { ...r, dataSource, refresh };
}

const trigger = () => screen.getByRole('button', { name: /^Stage: / });

function openMenu() {
  fireEvent.pointerDown(trigger(), { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return screen.getByRole('menu');
}

const item = (menu: HTMLElement, label: string) =>
  within(menu).getAllByRole('menuitem').find((el) => el.textContent?.startsWith(label))!;

beforeEach(() => {
  perms.isLoaded = true;
  perms.writeDenied = [];
});

afterEach(() => cleanup());

describe('#35891 the stage tag opens a menu of every stage', () => {
  it('lists every stage in order, the current one checked', () => {
    mount();
    expect(trigger()).toHaveAttribute('data-record-stage-tag', 'stage');
    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
    const menu = openMenu();
    const labels = within(menu).getAllByRole('menuitem').map((el) => el.getAttribute('data-stage-value'));
    expect(labels).toEqual(['prospecting', 'negotiation', 'closed_won', 'closed_lost']);
    expect(item(menu, 'Prospecting')).toHaveAttribute('aria-current', 'true');
    expect(item(menu, 'Negotiation')).not.toHaveAttribute('aria-current');
  });

  it('a stage the state machine cannot reach is disabled and says why', () => {
    mount();
    const menu = openMenu();
    const won = item(menu, 'Closed Won');
    expect(won).toHaveAttribute('aria-disabled', 'true');
    expect(within(won).getByText("Can't move here from Prospecting")).toBeInTheDocument();
    expect(item(menu, 'Negotiation')).not.toHaveAttribute('aria-disabled');
  });

  it('picking a reachable stage confirms, then writes the stage with the record version and re-reads', async () => {
    const { dataSource, refresh } = mount();
    fireEvent.click(item(openMenu(), 'Negotiation'));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Move this record to Negotiation?')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
    expect(dataSource.update).toHaveBeenCalledWith('crm_opportunity', 'o1', { stage: 'negotiation' }, { ifMatch: VERSION });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('cancelling writes nothing', async () => {
    const { dataSource } = mount();
    fireEvent.click(item(openMenu(), 'Negotiation'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(dataSource.update).not.toHaveBeenCalled();
  });
});

describe('#35891 a stage that needs more fields asks for them', () => {
  const lossRefusal = () => Object.assign(new Error('VALIDATION_FAILED'), {
    code: 'VALIDATION_FAILED',
    fields: [{ field: 'loss_reason', code: 'required', message: 'Loss Reason is required to close as lost' }],
  });

  it('Closed Lost asks for the loss reason only, and writes it with the move', async () => {
    const { dataSource } = mount();
    fireEvent.click(item(openMenu(), 'Closed Lost'));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('To move this record to Closed Lost, fill in:')).toBeInTheDocument();
    const fields = Array.from(dialog.querySelectorAll('[data-stage-change-field]')).map((el) => el.getAttribute('data-stage-change-field'));
    expect(fields).toEqual(['loss_reason']);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Price' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
    expect(dataSource.update).toHaveBeenCalledWith(
      'crm_opportunity', 'o1', { stage: 'closed_lost', loss_reason: 'Price' }, { ifMatch: VERSION },
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('left empty, the server refusal names the field in the dialog and the stage does not move', async () => {
    const dataSource = makeDataSource(async () => { throw lossRefusal(); });
    const { refresh } = mount({ dataSource });
    fireEvent.click(item(openMenu(), 'Closed Lost'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
    // Still open, the reason beside the field, nothing re-read.
    const open = await screen.findByRole('alertdialog');
    expect(within(open).getByText('Loss Reason is required to close as lost')).toBeInTheDocument();
    expect(open.querySelector('[data-stage-change-field-error="loss_reason"]')).not.toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a refusal that names a field the menu did not know about adds it to the form', async () => {
    const amountRefusal = Object.assign(new Error('VALIDATION_FAILED'), {
      code: 'VALIDATION_FAILED',
      fields: [{ field: 'name', code: 'required', message: 'Name is required to negotiate' }],
    });
    const dataSource = makeDataSource(async () => { throw amountRefusal; });
    mount({ dataSource });
    fireEvent.click(item(openMenu(), 'Negotiation'));
    let dialog = await screen.findByRole('alertdialog');
    expect(dialog.querySelector('[data-stage-change-field]')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
    dialog = await screen.findByRole('alertdialog');
    await waitFor(() => expect(dialog.querySelector('[data-stage-change-field="name"]')).not.toBeNull());
    expect(within(dialog).getByText('Name is required to negotiate')).toBeInTheDocument();
  });

  it('a refusal that names no fillable field reads under the form, the dialog stays open', async () => {
    const machineRefusal = Object.assign(new Error('VALIDATION_FAILED'), {
      code: 'VALIDATION_FAILED',
      fields: [{ field: 'stage', code: 'state_machine', message: 'A deal cannot skip negotiation.' }],
    });
    const dataSource = makeDataSource(async () => { throw machineRefusal; });
    mount({ dataSource });
    fireEvent.click(item(openMenu(), 'Negotiation'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
    const open = await screen.findByRole('alertdialog');
    await waitFor(() => expect(within(open).getByText('A deal cannot skip negotiation.')).toBeInTheDocument());
  });
});

describe('#35891 who sees the plain tag', () => {
  it('a reader the page may not let edit (an approval lock included) sees the tag, no arrow', () => {
    mount({ canEdit: false });
    expect(screen.getByTestId('plain-tag')).toHaveTextContent('Prospecting');
    expect(screen.queryByRole('button', { name: /^Stage: / })).toBeNull();
  });

  it('a reader without the edit grant on the stage field sees the tag', () => {
    perms.writeDenied = ['stage'];
    mount();
    expect(screen.getByTestId('plain-tag')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Stage: / })).toBeNull();
  });

  it('control: with the grant, the arrowed menu replaces the tag', () => {
    mount();
    expect(screen.queryByTestId('plain-tag')).toBeNull();
    expect(trigger()).toHaveTextContent('Prospecting');
  });
});

describe('#35891 the keyboard', () => {
  it('Enter opens the menu; Escape closes it without a write', async () => {
    const { dataSource } = mount();
    trigger().focus();
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    const menu = await screen.findByRole('menu');
    expect(menu).toBeInTheDocument();
    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(dataSource.update).not.toHaveBeenCalled();
  });

  it('the confirm dialog opens on Move, so Enter confirms the stage it names', async () => {
    mount();
    fireEvent.click(item(openMenu(), 'Negotiation'));
    const dialog = await screen.findByRole('alertdialog');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Move' })).toHaveFocus());
  });

  it('a stage that needs a field opens with that field focused', async () => {
    mount();
    fireEvent.click(item(openMenu(), 'Closed Lost'));
    const dialog = await screen.findByRole('alertdialog');
    await waitFor(() => expect(within(dialog).getByRole('textbox')).toHaveFocus());
  });

  it('control: the record:path dialog keeps the alert dialog default, Cancel first', async () => {
    const { useStageChange } = await import('../renderers/recordPathStageChange');
    function PathHost() {
      const change = useStageChange(true, 'stage');
      return (
        <>
          <button type="button" onClick={() => change.request({ value: 'negotiation', label: 'Negotiation' })}>go</button>
          {change.dialog}
        </>
      );
    }
    render(
      <RecordContextProvider
        objectName="crm_opportunity"
        recordId="o1"
        data={{ id: 'o1', name: 'Wayne deal', stage: 'prospecting', updated_at: VERSION }}
        objectSchema={OPPORTUNITY}
        dataSource={makeDataSource() as any}
      >
        <InlineEditProvider canEdit>
          <PathHost />
        </InlineEditProvider>
      </RecordContextProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'go' }));
    const dialog = await screen.findByRole('alertdialog');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus());
  });
});
