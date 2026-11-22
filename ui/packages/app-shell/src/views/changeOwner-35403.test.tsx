/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Change Owner in the Console (objectstack#35403): when the action is offered,
 * what the dialog sends, and how its answers read.
 *
 * Visibility is three facts — the object is structurally eligible, its switch
 * `userActions.transfer` is on (both the spec's `resolveUserActionTransfer`),
 * and the explain engine's `transfer` verdict for the record is a definite
 * allow. The verdict is seeded into the record page's one cache, exactly as the
 * page payload seeds it, so no request leaves the test. Each case below holds
 * the verdict at `true` (a platform admin, a `modifyAllRecords` holder) where
 * the case is about the object, so only the object's own facts can take the
 * action away.
 *
 * `t()` answers its key followed by its options as JSON; the user picker is a
 * plain input standing in for the lazy `user` widget.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/i18n')>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key),
    language: 'en',
  }),
  useObjectLabel: () => ({
    objectLabel: (def: { label: string }) => def.label,
    fieldLabel: (_o: string, _f: string, fallback: string) => fallback,
  }),
}));

vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  getLazyFieldWidget: () => ({ id, value, onChange, readonly, field }: any) =>
    readonly ? (
      <span data-testid={`readonly-${field?.name}`}>{String(value ?? '')}</span>
    ) : (
      <input id={id} data-testid={`widget-${id}`} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    ),
}));

import { AdapterCtx } from '@object-ui/react';
import { seedRecordVerdict } from '@object-ui/plugin-detail';
import { FormOwnerLine } from '@object-ui/plugin-form';
import { FormOwnerChangeAction } from './FormOwnerChangeAction';
import { ConsoleFormOwnerLine } from './consoleFormOwnerLine';
import { ChangeOwnerDialog } from './ChangeOwnerDialog';
import { readChangeOwnerReport } from './changeOwner';
import { seedRecordPageReaders } from './recordPagePayload';

const ALLOW = { allowed: true, record: { recordId: 'x', visible: true } };
const DENY = { allowed: false, record: { recordId: 'x', visible: true } };

let seq = 0;
/** A fresh record id per case, so each case reads only the verdict it seeds. */
function freshId(): string {
  seq += 1;
  return `r35403_${seq}`;
}

function noClient() {
  return { getClient: () => ({ data: {} }), find: vi.fn() } as any;
}

/**
 * Draw the form's Change Owner action for `objectSchema` with the record's
 * `transfer` verdict seeded as `decision`, and settle the verdict.
 */
async function mountAction(objectSchema: Record<string, unknown>, decision: unknown = ALLOW) {
  const recordId = freshId();
  const objectName = String(objectSchema.name);
  const verdict = Promise.resolve(decision);
  seedRecordVerdict(null, objectName, recordId, 'transfer', verdict);
  render(
    <AdapterCtx.Provider value={noClient()}>
      <FormOwnerChangeAction
        objectName={objectName}
        recordId={recordId}
        record={{ id: recordId, owner_id: 'u_amy' }}
        objectSchema={objectSchema}
      />
    </AdapterCtx.Provider>,
  );
  await act(async () => { await verdict; });
  return recordId;
}

const action = () => screen.queryByTestId('form-owner-change');

describe('Change Owner is offered only where the object offers it (objectstack#35403)', () => {
  it('a person-owned object, with the transfer verdict, offers it (the positive control)', async () => {
    await mountAction({ name: 'crm_deal', fields: { owner_id: { type: 'lookup' } } });
    await waitFor(() => expect(action()).not.toBeNull());
  });

  it("ownership: 'none' offers nothing, even to a platform admin", async () => {
    await mountAction({ name: 'crm_tag', ownership: 'none', fields: {} });
    expect(action()).toBeNull();
  });

  it('a managedBy object offers nothing, even to a platform admin', async () => {
    await mountAction({ name: 'auth_session', managedBy: 'better-auth', fields: {} });
    expect(action()).toBeNull();
  });

  it('a sys_* object offers nothing, even to a platform admin', async () => {
    await mountAction({ name: 'sys_queue', fields: {} });
    expect(action()).toBeNull();
  });

  it('a controlled_by_parent detail offers nothing by default …', async () => {
    await mountAction({ name: 'crm_deal_line', sharingModel: 'controlled_by_parent', fields: {} });
    expect(action()).toBeNull();
  });

  it('… and offers it once the detail turns userActions.transfer on', async () => {
    await mountAction({
      name: 'crm_deal_line',
      sharingModel: 'controlled_by_parent',
      userActions: { transfer: true },
      fields: {},
    });
    await waitFor(() => expect(action()).not.toBeNull());
  });

  it('a private object that switched transfer off offers nothing to a modifyAllRecords holder', async () => {
    await mountAction({ name: 'crm_contract', sharingModel: 'private', userActions: { transfer: false }, fields: {} });
    expect(action()).toBeNull();
  });

  it('a caller the explain engine refuses transfer (edit without transfer) is offered nothing', async () => {
    await mountAction({ name: 'crm_deal', fields: {} }, DENY);
    expect(action()).toBeNull();
  });

  it('a verdict not yet answered offers nothing (the action is drawn on a definite allow only)', async () => {
    const recordId = freshId();
    seedRecordVerdict(null, 'crm_deal', recordId, 'transfer', new Promise(() => {}));
    render(
      <AdapterCtx.Provider value={noClient()}>
        <FormOwnerChangeAction objectName="crm_deal" recordId={recordId} record={{ id: recordId }} objectSchema={{ name: 'crm_deal' }} />
      </AdapterCtx.Provider>,
    );
    expect(action()).toBeNull();
  });
});

describe("the record page's one read answers the transfer verdict (objectstack#35403)", () => {
  it("a payload that explains transfer seeds the verdict Change Owner reads: no second request", async () => {
    const recordId = freshId();
    const payload = Promise.resolve({ explain: { transfer: ALLOW } } as any);
    seedRecordPageReaders({
      payload,
      objectName: 'crm_deal',
      recordId,
      principal: null,
      related: [],
      explain: ['transfer'],
      fieldAccess: false,
      approvals: false,
    });
    render(
      <AdapterCtx.Provider value={noClient()}>
        <FormOwnerChangeAction objectName="crm_deal" recordId={recordId} record={{ id: recordId }} objectSchema={{ name: 'crm_deal' }} />
      </AdapterCtx.Provider>,
    );
    await waitFor(() => expect(action()).not.toBeNull());
  });
});

describe('the default edit form shows the owner read-only, with the action beside it (objectstack#35403)', () => {
  function mountForm(recordId: string, schema: Record<string, unknown>, host = true) {
    const line = (
      <FormOwnerLine
        mode="edit"
        objectName="crm_deal"
        recordId={recordId}
        record={{ id: recordId, owner_id: 'u_amy' }}
        objectSchema={schema}
      />
    );
    render(
      <AdapterCtx.Provider value={noClient()}>
        {host ? <ConsoleFormOwnerLine>{line}</ConsoleFormOwnerLine> : line}
      </AdapterCtx.Provider>,
    );
  }
  const SCHEMA = { name: 'crm_deal', fields: { owner_id: { type: 'lookup', label: 'Account Manager' } } };

  it('edit without transfer: the owner reads read-only under its own label, and no action is drawn', async () => {
    const recordId = freshId();
    const verdict = Promise.resolve(DENY);
    seedRecordVerdict(null, 'crm_deal', recordId, 'transfer', verdict);
    mountForm(recordId, SCHEMA);
    const line = screen.getByTestId('form-owner-line');
    expect(within(line).getByText('Account Manager')).toBeTruthy();
    expect((await within(line).findByTestId('readonly-owner_id')).textContent).toBe('u_amy');
    await act(async () => { await verdict; });
    expect(within(line).queryByRole('textbox')).toBeNull();
    expect(action()).toBeNull();
  });

  it('with the transfer verdict, Change Owner sits beside the read-only owner', async () => {
    const recordId = freshId();
    const verdict = Promise.resolve(ALLOW);
    seedRecordVerdict(null, 'crm_deal', recordId, 'transfer', verdict);
    mountForm(recordId, SCHEMA);
    const line = screen.getByTestId('form-owner-line');
    expect(await within(line).findByTestId('form-owner-change')).toBeTruthy();
    expect(within(line).getByTestId('readonly-owner_id')).toBeTruthy();
  });

  it('a form no host opts in draws no owner line (an embedded form is unchanged)', () => {
    mountForm(freshId(), SCHEMA, false);
    expect(screen.queryByTestId('form-owner-line')).toBeNull();
  });

  it('an object without owner_id draws no owner line', () => {
    mountForm(freshId(), { name: 'crm_deal', fields: { title: { type: 'text' } } });
    expect(screen.queryByTestId('form-owner-line')).toBeNull();
  });
});

describe('the Change Owner dialog sends the chosen target (objectstack#35403)', () => {
  let changeOwner: ReturnType<typeof vi.fn>;
  let changeOwnerMany: ReturnType<typeof vi.fn>;
  let find: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    changeOwner = vi.fn(async () => ({ object: 'crm_deal', id: 'd1', ownerId: 'u_bo' }));
    changeOwnerMany = vi.fn();
    find = vi.fn(async () => ({ data: [{ name: 'triage', label: 'Triage' }] }));
  });

  function mountDialog(records: Array<Record<string, unknown>>, objectDef: Record<string, unknown> = { name: 'crm_deal', fields: {} }) {
    const onOpenChange = vi.fn();
    const adapter = { getClient: () => ({ data: { changeOwner, changeOwnerMany } }), find } as any;
    render(
      <AdapterCtx.Provider value={adapter}>
        <ChangeOwnerDialog open onOpenChange={onOpenChange} objectDef={objectDef as any} records={records} />
      </AdapterCtx.Provider>,
    );
    return onOpenChange;
  }

  async function pickPerson(id: string) {
    fireEvent.change(await screen.findByTestId('widget-change_owner_target'), { target: { value: id } });
  }

  it('one record: data.changeOwner with the person picked and the notify flag', async () => {
    const onOpenChange = mountDialog([{ id: 'd1', owner_id: 'u_amy' }]);
    await pickPerson('u_bo');
    fireEvent.click(screen.getByTestId('change-owner-notify'));
    fireEvent.click(screen.getByTestId('change-owner-submit'));
    await waitFor(() => expect(changeOwner).toHaveBeenCalledTimes(1));
    expect(changeOwner).toHaveBeenCalledWith('crm_deal', 'd1', { ownerId: 'u_bo', notify: true });
    expect(changeOwnerMany).not.toHaveBeenCalled();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('one record: notify left unticked sends no notify flag', async () => {
    mountDialog([{ id: 'd1', owner_id: 'u_amy' }]);
    await pickPerson('u_bo');
    fireEvent.click(screen.getByTestId('change-owner-submit'));
    await waitFor(() => expect(changeOwner).toHaveBeenCalledWith('crm_deal', 'd1', { ownerId: 'u_bo' }));
  });

  it("one record: naming its current owner sends nothing and says why (N1)", async () => {
    mountDialog([{ id: 'd1', owner_id: 'u_amy' }]);
    await pickPerson('u_amy');
    expect(screen.getByTestId('change-owner-already-owner')).toBeTruthy();
    expect((screen.getByTestId('change-owner-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(changeOwner).not.toHaveBeenCalled();
  });

  it('one record: a refusal shows the server\'s own sentence', async () => {
    changeOwner.mockRejectedValueOnce(new Error('You may not transfer this record'));
    mountDialog([{ id: 'd1', owner_id: 'u_amy' }]);
    await pickPerson('u_bo');
    fireEvent.click(screen.getByTestId('change-owner-submit'));
    const refused = await screen.findByTestId('change-owner-refused');
    expect(refused.textContent).toContain('You may not transfer this record');
  });

  it('the dialog labels the picker with the object\'s own owner label', async () => {
    mountDialog([{ id: 'd1' }], { name: 'crm_deal', fields: { owner_id: { label: 'Account Manager' } } });
    expect(await screen.findByText('Account Manager')).toBeTruthy();
  });

  it('a list: data.changeOwnerMany with every id and the person, then each failed row drawn', async () => {
    changeOwnerMany.mockResolvedValueOnce({
      object: 'crm_deal',
      field: 'owner_id',
      ownerId: 'u_bo',
      updated: 2,
      failed: 2,
      failures: [
        { id: 'd3', code: 'PERMISSION_DENIED', message: 'not yours to move' },
        { id: 'd4', code: 'NOT_FOUND', message: 'gone' },
      ],
      notified: 0,
    });
    mountDialog([
      { id: 'd1', owner_id: 'u_amy' },
      { id: 'd2', owner_id: 'u_bo' },
      { id: 'd3', owner_id: 'u_cy' },
      { id: 'd4', owner_id: 'u_cy' },
    ]);
    await pickPerson('u_bo');
    fireEvent.click(screen.getByTestId('change-owner-submit'));
    const report = await screen.findByTestId('change-owner-report');
    expect(changeOwnerMany).toHaveBeenCalledWith('crm_deal', ['d1', 'd2', 'd3', 'd4'], { ownerId: 'u_bo' });
    expect(changeOwner).not.toHaveBeenCalled();
    // d2 already had u_bo: an echo the server counts as updated, read as unchanged.
    expect(within(report).getByText('console.changeOwner.report {"moved":1,"unchanged":1,"failed":2}')).toBeTruthy();
    const failures = within(report).getAllByTestId('change-owner-failure').map((li) => li.textContent);
    expect(failures).toEqual([
      'console.changeOwner.failure {"id":"d3","message":"not yours to move"}',
      'console.changeOwner.failure {"id":"d4","message":"gone"}',
    ]);
  });

  it('a list on an object with the queue column: data.changeOwnerMany with the queue picked', async () => {
    changeOwnerMany.mockResolvedValueOnce({
      object: 'crm_case', field: 'owner_id', queue: 'triage', updated: 2, failed: 0, failures: [], notified: 0,
    });
    mountDialog([{ id: 'c1', owner_id: 'u_amy' }, { id: 'c2', owner_id: 'u_amy' }], {
      name: 'crm_case',
      fields: { owner_id: {}, queue: { type: 'text' } },
    });
    fireEvent.click(screen.getByTestId('change-owner-kind-queue'));
    const trigger = await screen.findByTestId('change-owner-queue');
    expect(find).toHaveBeenCalledWith('sys_queue', { $top: 200 });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: 'Triage' }));
    fireEvent.click(screen.getByTestId('change-owner-submit'));
    const report = await screen.findByTestId('change-owner-report');
    expect(changeOwnerMany).toHaveBeenCalledWith('crm_case', ['c1', 'c2'], { queue: 'triage' });
    expect(within(report).getByText('console.changeOwner.report {"moved":2,"unchanged":0,"failed":0}')).toBeTruthy();
  });

  it('an object without the queue column offers no queue target', async () => {
    mountDialog([{ id: 'd1' }, { id: 'd2' }]);
    await screen.findByTestId('widget-change_owner_target');
    expect(screen.queryByTestId('change-owner-kind')).toBeNull();
  });
});

describe('how a bulk answer reads (objectstack#35403, carried nit N1)', () => {
  const rows = [
    { id: 'a', owner_id: 'u_bo' },
    { id: 'b', owner_id: { id: 'u_bo', name: 'Bo' } },
    { id: 'c', owner_id: 'u_amy' },
    { id: 'd', owner_id: 'u_bo' },
  ];

  it('a row that already named the person and did not fail reads unchanged, not moved', () => {
    const report = { updated: 3, failed: 1, failures: [{ id: 'd', code: 'PERMISSION_DENIED', message: 'no' }] };
    expect(readChangeOwnerReport(report, rows, { ownerId: 'u_bo' })).toEqual({ moved: 1, unchanged: 2, failed: 1 });
  });

  it('a queue target has no person to compare: every admitted row reads moved', () => {
    const report = { updated: 4, failed: 0, failures: [] };
    expect(readChangeOwnerReport(report, rows, { queue: 'triage' })).toEqual({ moved: 4, unchanged: 0, failed: 0 });
  });

  it('never reads more rows unchanged than the server counted updated', () => {
    const report = { updated: 1, failed: 0, failures: [] };
    expect(readChangeOwnerReport(report, rows, { ownerId: 'u_bo' })).toEqual({ moved: 0, unchanged: 1, failed: 0 });
  });
});
