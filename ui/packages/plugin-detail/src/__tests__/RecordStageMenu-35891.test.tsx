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
 * - After a 409 the dialog asks what the re-read record needs (#36036): a field
 *   another writer filled meanwhile leaves the dialog and the move.
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
  schema?: typeof OPPORTUNITY;
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
      objectSchema={opts.schema ?? OPPORTUNITY}
      dataSource={dataSource as any}
      reread={refresh}
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

// objectstack#35928 — the stage confirm asks which flows the move would start.
// Answered here as a deployment without that read (501), so the confirm reads as
// it does without it and no request leaves for the network.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 501, json: async () => ({}) })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Move this record to Negotiation?')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
    expect(dataSource.update).toHaveBeenCalledWith('crm_opportunity', 'o1', { stage: 'negotiation' }, { ifMatch: VERSION });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('cancelling writes nothing', async () => {
    const { dataSource } = mount();
    fireEvent.click(item(openMenu(), 'Negotiation'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
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
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('To move this record to Closed Lost, fill in:')).toBeInTheDocument();
    const fields = Array.from(dialog.querySelectorAll('[data-required-fields-field]')).map((el) => el.getAttribute('data-required-fields-field'));
    expect(fields).toEqual(['loss_reason']);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Price' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
    expect(dataSource.update).toHaveBeenCalledWith(
      'crm_opportunity', 'o1', { stage: 'closed_lost', loss_reason: 'Price' }, { ifMatch: VERSION },
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('left empty, Move says the field is required and writes nothing; a server refusal of the value reads under the field', async () => {
    const dataSource = makeDataSource(async () => { throw lossRefusal(); });
    const { refresh } = mount({ dataSource });
    fireEvent.click(item(openMenu(), 'Closed Lost'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    // The shared dialog's own presence check (objectstack#35956): no write.
    await waitFor(() => expect(dialog.querySelector('[data-required-fields-error="loss_reason"]')).not.toBeNull());
    expect(within(dialog).getByText('Required')).toBeInTheDocument();
    expect(dataSource.update).not.toHaveBeenCalled();
    // Filled, the server still refuses: still open, its reason beside the
    // field, nothing re-read, the stage not moved.
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'x' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
    const open = await screen.findByRole('dialog');
    await waitFor(() => expect(within(open).getByText('Loss Reason is required to close as lost')).toBeInTheDocument());
    expect(open.querySelector('[data-required-fields-error="loss_reason"]')).not.toBeNull();
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
    let dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('[data-required-fields-field]')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
    dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.querySelector('[data-required-fields-field="name"]')).not.toBeNull());
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
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
    const open = await screen.findByRole('dialog');
    await waitFor(() => expect(within(open).getByText('A deal cannot skip negotiation.')).toBeInTheDocument());
  });
});

describe('#35956 the stage menu opens the shared fill-in dialog', () => {
  // Two more conditional fields: one a typed loss reason makes required in
  // turn, and one rich-text field the dialog has no in-place editor for.
  const CHAINED = {
    ...OPPORTUNITY,
    fields: {
      ...OPPORTUNITY.fields,
      loss_detail: {
        type: 'text',
        label: 'Loss Detail',
        requiredWhen: 'has(record.loss_reason) && record.loss_reason == "other"',
      },
      negotiation_memo: {
        type: 'richtext',
        label: 'Negotiation Memo',
        requiredWhen: 'has(record.stage) && record.stage == "negotiation"',
      },
    },
  } as unknown as typeof OPPORTUNITY;

  const footOf = (dialog: HTMLElement) => waitFor(() => {
    const el = dialog.querySelector('[data-required-fields-refusal]') as HTMLElement | null;
    expect(el).not.toBeNull();
    return el as HTMLElement;
  });

  const fieldsShown = (dialog: HTMLElement) =>
    Array.from(dialog.querySelectorAll('[data-required-fields-field]')).map((el) => el.getAttribute('data-required-fields-field'));

  it('is the one shared dialog: the record name and the move, read-only, above the field', async () => {
    mount();
    fireEvent.click(item(openMenu(), 'Closed Lost'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('data-testid', 'required-fields-dialog');
    const change = dialog.querySelector('[data-required-fields-change]') as HTMLElement;
    expect(within(change).getByText('Wayne deal')).toBeInTheDocument();
    const row = change.querySelector('[data-required-fields-change-row="stage"]') as HTMLElement;
    expect(row).toHaveTextContent('Stage:Closed Lost');
    expect(within(row).queryByRole('textbox')).toBeNull();
    // The surface's own copy of the old form is gone.
    expect(dialog.querySelector('[data-stage-change-fields]')).toBeNull();
  });

  it('a stage that needs nothing opens the same dialog as the move confirmation, no fields', async () => {
    mount();
    fireEvent.click(item(openMenu(), 'Negotiation'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('data-testid', 'required-fields-dialog');
    expect(fieldsShown(dialog)).toEqual([]);
    expect(within(dialog).getByText('Change stage?')).toBeInTheDocument();
    expect(dialog.querySelector('[data-required-fields-change-row="stage"]')).toHaveTextContent('Stage:Negotiation');
  });

  it('a value typed in the dialog that makes one more field required adds it, and Move waits for it', async () => {
    const { dataSource } = mount({ schema: CHAINED });
    fireEvent.click(item(openMenu(), 'Closed Lost'));
    const dialog = await screen.findByRole('dialog');
    expect(fieldsShown(dialog)).toEqual(['loss_reason']);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'other' } });
    await waitFor(() => expect(fieldsShown(dialog)).toEqual(['loss_reason', 'loss_detail']));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    // Empty, the chained field says so and nothing is written.
    await waitFor(() => expect(dialog.querySelector('[data-required-fields-error="loss_detail"]')).not.toBeNull());
    expect(dataSource.update).not.toHaveBeenCalled();
    const detail = dialog.querySelector('[data-required-fields-field="loss_detail"]') as HTMLElement;
    fireEvent.change(within(detail).getByRole('textbox'), { target: { value: 'Went with a competitor' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
    expect(dataSource.update).toHaveBeenCalledWith(
      'crm_opportunity', 'o1',
      { stage: 'closed_lost', loss_reason: 'other', loss_detail: 'Went with a competitor' },
      { ifMatch: VERSION },
    );
  });

  it('control: a required field with no in-place editor (rich text) is not asked; the server judges the move', async () => {
    const richRefusal = Object.assign(new Error('VALIDATION_FAILED'), {
      code: 'VALIDATION_FAILED',
      fields: [{ field: 'negotiation_memo', code: 'required', message: 'Negotiation Memo is required' }],
    });
    const dataSource = makeDataSource(async () => { throw richRefusal; });
    mount({ schema: CHAINED, dataSource });
    fireEvent.click(item(openMenu(), 'Negotiation'));
    const dialog = await screen.findByRole('dialog');
    expect(fieldsShown(dialog)).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledWith(
      'crm_opportunity', 'o1', { stage: 'negotiation' }, { ifMatch: VERSION },
    ));
    // Not added as a row (nothing to type it into): its reason reads at the foot.
    const foot = await footOf(dialog);
    expect(foot).toHaveTextContent('Negotiation Memo: Negotiation Memo is required');
    expect(fieldsShown(dialog)).toEqual([]);
  });

  it('someone else changed the record: the dialog stays, says so at its foot, and the record is re-read', async () => {
    const conflict = Object.assign(new Error('CONCURRENT_UPDATE'), { code: 'CONCURRENT_UPDATE', status: 409 });
    const dataSource = makeDataSource(async () => { throw conflict; });
    const { refresh } = mount({ dataSource });
    fireEvent.click(item(openMenu(), 'Closed Lost'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Price' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const foot = await footOf(dialog);
    expect(foot).toHaveTextContent('Someone else changed this record');
    // The typed value is still there for the next press.
    expect(within(dialog).getByRole('textbox')).toHaveValue('Price');
  });

  it('a permission refusal reads as the stage line at the foot, never the raw 403', async () => {
    const denied = Object.assign(new Error('403 Forbidden {"error":"permission denied: crm_opportunity.update"}'), {
      code: 'PERMISSION_DENIED',
      status: 403,
    });
    const dataSource = makeDataSource(async () => { throw denied; });
    mount({ dataSource });
    fireEvent.click(item(openMenu(), 'Negotiation'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    const foot = await footOf(dialog);
    expect(foot).toHaveTextContent("You don't have permission to change this record's stage.");
    expect(foot).not.toHaveTextContent('permission denied');
  });

  it('Cancel writes nothing and the next pick starts empty', async () => {
    const { dataSource } = mount();
    fireEvent.click(item(openMenu(), 'Closed Lost'));
    let dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Price' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(dataSource.update).not.toHaveBeenCalled();
    fireEvent.click(item(openMenu(), 'Closed Lost'));
    dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('textbox')).toHaveValue('');
  });
});

describe('#36036 after a 409 re-read, the stage dialog asks what the re-read record needs', () => {
  const NEXT_VERSION = '2026-11-20T12:05:00.000Z';
  const conflict = () => Object.assign(new Error('CONCURRENT_UPDATE'), { code: 'CONCURRENT_UPDATE', status: 409 });
  const STORED = { id: 'o1', name: 'Wayne deal', stage: 'prospecting', loss_reason: null, loss_detail: null, updated_at: VERSION };
  // A typed loss reason of "other" makes one more field required in turn.
  const CHAINED = {
    ...OPPORTUNITY,
    fields: {
      ...OPPORTUNITY.fields,
      loss_detail: {
        type: 'text',
        label: 'Loss Detail',
        requiredWhen: 'has(record.loss_reason) && record.loss_reason == "other"',
      },
    },
  } as unknown as typeof OPPORTUNITY;

  /**
   * The page's re-read as the record page wires it: a notice that returns at
   * once, the re-read row landing in the record context afterwards.
   */
  function mountReRead(reread: Record<string, unknown>, schema: typeof OPPORTUNITY = OPPORTUNITY) {
    let calls = 0;
    const dataSource = makeDataSource(async () => {
      calls += 1;
      if (calls === 1) throw conflict();
      return {};
    });
    const refresh = vi.fn();
    function Host() {
      const [row, setRow] = React.useState<Record<string, unknown>>(STORED);
      refresh.mockImplementation(() => { setTimeout(() => setRow(reread), 0); });
      return (
        <RecordContextProvider
          objectName="crm_opportunity"
          recordId="o1"
          data={row}
          objectSchema={schema}
          dataSource={dataSource as any}
          reread={refresh}
        >
          <InlineEditProvider canEdit>
            <RecordStageMenu field="stage" label="Prospecting" tag={<span>Prospecting</span>} />
          </InlineEditProvider>
        </RecordContextProvider>
      );
    }
    render(<Host />);
    return { dataSource, refresh };
  }

  const fieldsShown = (dialog: HTMLElement) =>
    Array.from(dialog.querySelectorAll('[data-required-fields-field]')).map((el) => el.getAttribute('data-required-fields-field'));

  async function typeAndHitConflict(dialog: HTMLElement, dataSource: ReturnType<typeof makeDataSource>, refresh: ReturnType<typeof vi.fn>) {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(dialog.querySelector('[data-required-fields-refusal]')).toHaveTextContent('Someone else changed this record'));
  }

  it('another writer filled the asked field: it leaves the dialog, and the next Move does not send it', async () => {
    const { dataSource, refresh } = mountReRead({ ...STORED, loss_reason: 'Budget cut', updated_at: NEXT_VERSION });
    fireEvent.click(item(openMenu(), 'Closed Lost'));
    const dialog = await screen.findByRole('dialog');
    expect(fieldsShown(dialog)).toEqual(['loss_reason']);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Price' } });
    await typeAndHitConflict(dialog, dataSource, refresh);
    // Nothing is left to fill: the record, the stage and the move button.
    await waitFor(() => expect(fieldsShown(dialog)).toEqual([]));
    expect(within(dialog).getByText('Move this record to Closed Lost?')).toBeInTheDocument();
    expect(dialog.querySelector('[data-required-fields-change-row="stage"]')).toHaveTextContent('Stage:Closed Lost');
    expect(within(dialog).queryByRole('textbox')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(2));
    expect(dataSource.update).toHaveBeenLastCalledWith(
      'crm_opportunity', 'o1', { stage: 'closed_lost' }, { ifMatch: NEXT_VERSION },
    );
  });

  it('control: a 409 where the asked field is still empty keeps it, with the typed value, and sends it', async () => {
    const { dataSource, refresh } = mountReRead({ ...STORED, name: 'Wayne deal (renamed)', updated_at: NEXT_VERSION });
    fireEvent.click(item(openMenu(), 'Closed Lost'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Price' } });
    await typeAndHitConflict(dialog, dataSource, refresh);
    await waitFor(() => expect(within(dialog).getByText('Wayne deal (renamed)')).toBeInTheDocument());
    expect(fieldsShown(dialog)).toEqual(['loss_reason']);
    expect(within(dialog).getByRole('textbox')).toHaveValue('Price');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(2));
    expect(dataSource.update).toHaveBeenLastCalledWith(
      'crm_opportunity', 'o1', { stage: 'closed_lost', loss_reason: 'Price' }, { ifMatch: NEXT_VERSION },
    );
  });

  it('a value typed for the filled field no longer asks for the field it chained in', async () => {
    const { dataSource, refresh } = mountReRead({ ...STORED, loss_reason: 'Budget cut', updated_at: NEXT_VERSION }, CHAINED);
    fireEvent.click(item(openMenu(), 'Closed Lost'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'other' } });
    await waitFor(() => expect(fieldsShown(dialog)).toEqual(['loss_reason', 'loss_detail']));
    const detail = dialog.querySelector('[data-required-fields-field="loss_detail"]') as HTMLElement;
    fireEvent.change(within(detail).getByRole('textbox'), { target: { value: 'Went with a competitor' } });
    await typeAndHitConflict(dialog, dataSource, refresh);
    await waitFor(() => expect(fieldsShown(dialog)).toEqual([]));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(2));
    expect(dataSource.update).toHaveBeenLastCalledWith(
      'crm_opportunity', 'o1', { stage: 'closed_lost' }, { ifMatch: NEXT_VERSION },
    );
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

describe('#36309 a host with only refresh still re-reads; reread wins where both are given', () => {
  const conflict = () => Object.assign(new Error('CONCURRENT_UPDATE'), { code: 'CONCURRENT_UPDATE', status: 409 });

  function mountWith(members: { refresh?: () => Promise<void>; reread?: () => Promise<void> }) {
    const dataSource = makeDataSource(async () => { throw conflict(); });
    render(
      <RecordContextProvider
        objectName="crm_opportunity"
        recordId="o1"
        data={{ id: 'o1', name: 'Wayne deal', stage: 'prospecting', loss_reason: null, updated_at: VERSION }}
        objectSchema={OPPORTUNITY}
        dataSource={dataSource as any}
        {...members}
      >
        <InlineEditProvider canEdit>
          <RecordStageMenu field="stage" label="Prospecting" tag={<span>Prospecting</span>} />
        </InlineEditProvider>
      </RecordContextProvider>,
    );
    return { dataSource };
  }

  it('a provider with only refresh: a 409 on Move calls refresh', async () => {
    const refresh = vi.fn(async () => {});
    const { dataSource } = mountWith({ refresh });
    fireEvent.click(item(openMenu(), 'Negotiation'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('CONTROL — a provider with both: a 409 on Move calls reread, not refresh', async () => {
    const refresh = vi.fn(async () => {});
    const reread = vi.fn(async () => {});
    const { dataSource } = mountWith({ refresh, reread });
    fireEvent.click(item(openMenu(), 'Negotiation'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(reread).toHaveBeenCalledTimes(1));
    expect(refresh).not.toHaveBeenCalled();
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
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Move' })).toHaveFocus());
  });

  it('a stage that needs a field opens with that field focused', async () => {
    mount();
    fireEvent.click(item(openMenu(), 'Closed Lost'));
    const dialog = await screen.findByRole('dialog');
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

// objectstack#35928 — under its sentence the confirm names the flows the move
// would start (`POST /api/v1/automation/_record-starts`, read through
// `../stageChangeStarts`, the reader the list cell's confirm shares); no flows,
// a refused read and a malformed answer leave the sentence alone.
describe('#35928 the stage menu\'s dialog names the flows the move starts', () => {
  const CLOSURE = { name: 'closure', label: 'Closure Sign-off', startsApproval: true };
  const NOTIFY = { name: 'notify_owner', label: 'Notify Owner', startsApproval: false };
  type StartsAnswer = { status: number; body: unknown } | 'network-error';

  /** The global `fetch`, answering the read with `answer` and recording every request. */
  function installStartsFetch(answer: StartsAnswer) {
    const calls: Array<{ url: string; body: any }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (answer === 'network-error') throw new TypeError('Failed to fetch');
      return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
    }));
    return calls;
  }
  const listed = (flows: unknown[]): StartsAnswer => ({ status: 200, body: { success: true, data: { flows } } });
  const startsCalls = (calls: Array<{ url: string }>) => calls.filter((c) => c.url === '/api/v1/automation/_record-starts');
  /** Let an answer that arrived land before reading that nothing was drawn for it. */
  const settle = () => new Promise((r) => setTimeout(r, 0));

  async function openConfirm(): Promise<HTMLElement> {
    mount();
    fireEvent.click(item(openMenu(), 'Negotiation'));
    return screen.findByRole('dialog');
  }

  it('list: asks for the record and the move, and names each flow under the sentence, approval marked', async () => {
    const calls = installStartsFetch(listed([CLOSURE, NOTIFY]));
    const dialog = await openConfirm();
    const list = await within(dialog).findByTestId('stage-change-starts');
    expect(within(dialog).getByText('Move this record to Negotiation?')).toBeInTheDocument();
    expect(list).toHaveTextContent('Saving this change starts these flows:');
    const closure = list.querySelector('[data-stage-change-start="closure"]')!;
    const notify = list.querySelector('[data-stage-change-start="notify_owner"]')!;
    expect(closure).toHaveTextContent('Closure Sign-off');
    expect(closure.querySelector('[data-stage-change-start-approval]')).toHaveTextContent('starts an approval');
    expect(notify).toHaveTextContent('Notify Owner');
    expect(notify.querySelector('[data-stage-change-start-approval]')).toBeNull();
    expect(startsCalls(calls).map((c: any) => c.body)).toEqual([{ object: 'crm_opportunity', recordId: 'o1', changes: { stage: 'negotiation' } }]);
  });

  it('empty: no flows answered draws no list, and the sentence stands alone', async () => {
    const calls = installStartsFetch(listed([]));
    const dialog = await openConfirm();
    await waitFor(() => expect(startsCalls(calls)).toHaveLength(1));
    await settle();
    expect(within(dialog).queryByTestId('stage-change-starts')).toBeNull();
    expect(within(dialog).getByText('Move this record to Negotiation?')).toBeInTheDocument();
  });

  it('failure: a refused read, a network error and a malformed answer each draw no list', async () => {
    const answers: StartsAnswer[] = [
      { status: 404, body: { success: false, error: { code: 'RECORD_NOT_FOUND', message: 'no' } } },
      'network-error',
      { status: 200, body: { flows: [CLOSURE] } },
    ];
    for (const answer of answers) {
      const calls = installStartsFetch(answer);
      const dialog = await openConfirm();
      await waitFor(() => expect(startsCalls(calls)).toHaveLength(1));
      await settle();
      expect(within(dialog).queryByTestId('stage-change-starts')).toBeNull();
      expect(within(dialog).getByText('Move this record to Negotiation?')).toBeInTheDocument();
      cleanup();
    }
  });
});
