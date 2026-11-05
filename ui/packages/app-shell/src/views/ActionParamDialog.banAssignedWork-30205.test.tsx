/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The ban dialog's companion (objectstack#30205): the user's open work and one
 * optional hand-over, drawn by `ActionParamDialog` above the params when its
 * state carries `companion: { kind: 'user-assigned-work' }`.
 *
 * The client's `security.assignedWork.count` / `.transfer` are doubles that
 * record what they are asked. `t()` answers its key followed by its options as
 * JSON, so each assertion names the sentence AND the numbers in it without
 * pinning any language's wording. The user picker is a plain input standing in
 * for the lazy `user` widget.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import type { ActionParamDef } from '@object-ui/core';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/i18n')>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key),
    language: 'en',
  }),
  useObjectLabel: () => ({
    objectLabel: (def: { name: string; label: string }) => def.label,
    fieldLabel: (_o: string, _f: string, fallback: string) => fallback,
  }),
}));

vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  getLazyFieldWidget: () => ({ id, value, onChange }: any) => (
    <input id={id} data-testid={`widget-${id}`} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { AdapterCtx, MetadataCtx } from '@object-ui/react';
import { ActionParamDialog } from './ActionParamDialog';
import { splitAssignedWork } from './userAssignedWork';

const USER_ID = 'u_lee';
const PARAMS: ActionParamDef[] = [{ name: 'banReason', label: 'Ban Reason', type: 'text' }];

const OBJECTS = [
  { name: 'showcase_project', label: 'Project', fields: { owner_id: { label: 'Owner' } } },
  { name: 'showcase_field_zoo', label: 'Field Zoo', fields: { f_user: { label: 'User' }, f_users: { label: 'Users' } } },
  { name: 'hr_review', label: 'Review', fields: {} },
];

const SUMMARY = {
  userId: USER_ID,
  objects: [
    { object: 'showcase_project', field: 'owner_id', count: 3, transferable: true },
    { object: 'showcase_field_zoo', field: 'f_user', count: 2, transferable: true },
    { object: 'showcase_field_zoo', field: 'f_users', count: 2, transferable: false },
  ],
  total: 7,
  truncated: false,
  unreadable: [] as string[],
};

let count: ReturnType<typeof vi.fn>;
let transfer: ReturnType<typeof vi.fn>;

function mount(resolve = vi.fn()) {
  const adapter = { getClient: () => ({ security: { assignedWork: { count, transfer } } }) } as any;
  const metadata = { objects: OBJECTS } as any;
  render(
    <AdapterCtx.Provider value={adapter}>
      <MetadataCtx.Provider value={metadata}>
        <ActionParamDialog
          state={{
            open: true,
            params: PARAMS,
            title: 'Ban User',
            description: 'Ban this user?',
            resolve,
            companion: { kind: 'user-assigned-work', userId: USER_ID },
          }}
          onOpenChange={() => {}}
        />
      </MetadataCtx.Provider>
    </AdapterCtx.Provider>,
  );
  return resolve;
}

const confirm = () => screen.getByRole('button', { name: 'actionDialog.confirm' });

async function pickTarget(id: string) {
  const input = await screen.findByTestId('widget-assigned_work_target');
  fireEvent.change(input, { target: { value: id } });
}

beforeEach(() => {
  count = vi.fn(async () => SUMMARY);
  transfer = vi.fn();
});

describe('the ban dialog says how many records the user holds (objectstack#30205)', () => {
  it('counts the dialog\'s user once and shows owned (owner_id) apart from assigned', async () => {
    mount();
    const summary = await screen.findByTestId('user-assigned-work-summary');
    expect(count).toHaveBeenCalledTimes(1);
    expect(count).toHaveBeenCalledWith(USER_ID);
    expect(within(summary).getByText('console.assignedWork.summary {"total":7,"owned":3,"assigned":4}')).toBeTruthy();
    const ownerRow = screen.getByTestId('user-assigned-work-row-showcase_project-owner_id');
    expect(ownerRow.textContent).toContain('console.assignedWork.row {"object":"Project","field":"Owner"}');
    expect(ownerRow.textContent).toContain('3');
    // A multi-valued field is counted and said not to be handed over here.
    const multi = screen.getByTestId('user-assigned-work-row-showcase_field_zoo-f_users');
    expect(multi.textContent).toContain('console.assignedWork.notTransferable');
    expect(screen.getByTestId('user-assigned-work-row-showcase_field_zoo-f_user').textContent)
      .not.toContain('console.assignedWork.notTransferable');
  });

  it('owned is the owner_id rows only; every other user field is assigned', () => {
    expect(splitAssignedWork(SUMMARY)).toEqual({ owned: 3, assigned: 4 });
    expect(splitAssignedWork({ ...SUMMARY, objects: [{ object: 'a', field: 'owner', count: 5, transferable: true }], total: 5 }))
      .toEqual({ owned: 0, assigned: 5 });
  });

  it('says when the count was cut short and names the objects it could not read', async () => {
    count = vi.fn(async () => ({ ...SUMMARY, truncated: true, unreadable: ['hr_review', 'no_such_def'] }));
    mount();
    expect(await screen.findByTestId('user-assigned-work-truncated')).toBeTruthy();
    expect(screen.getByTestId('user-assigned-work-unreadable').textContent)
      .toBe('console.assignedWork.unreadable {"objects":"Review, no_such_def"}');
  });

  it('a user who holds nothing readable: says so and offers no hand-over', async () => {
    count = vi.fn(async () => ({ userId: USER_ID, objects: [], total: 0, truncated: false, unreadable: [] }));
    mount();
    expect(await screen.findByText('console.assignedWork.none')).toBeTruthy();
    expect(screen.queryByTestId('user-assigned-work-handover')).toBeNull();
  });

  it('a refused count is shown in the panel and the ban stays confirmable', async () => {
    count = vi.fn(async () => { throw new Error('Forbidden'); });
    const resolve = mount();
    expect((await screen.findByTestId('user-assigned-work-count-failed')).textContent)
      .toBe('console.assignedWork.countFailed {"message":"Forbidden"}');
    expect((confirm() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirm());
    await waitFor(() => expect(resolve).toHaveBeenCalledWith({ banReason: undefined }));
  });
});

describe('the ban dialog offers one optional hand-over (objectstack#30205)', () => {
  it('the hand-over button waits for a person to be picked', async () => {
    mount();
    await screen.findByTestId('user-assigned-work-handover');
    const button = screen.getByTestId('user-assigned-work-transfer') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await pickTarget('u_kim');
    expect(button.disabled).toBe(false);
  });

  it('a complete hand-over: reports what moved and reads the counts again', async () => {
    transfer = vi.fn(async () => ({
      fromUserId: USER_ID, toUserId: 'u_kim', updated: 5, failed: 0, remaining: 0,
      objects: [{ object: 'showcase_project', field: 'owner_id', updated: 3, failed: 0, failures: [] }],
    }));
    mount();
    await pickTarget('u_kim');
    fireEvent.click(screen.getByTestId('user-assigned-work-transfer'));
    const report = await screen.findByTestId('user-assigned-work-report');
    expect(transfer).toHaveBeenCalledWith(USER_ID, { toUserId: 'u_kim' });
    expect(report.textContent).toContain('console.assignedWork.report {"updated":5,"failed":0,"remaining":0}');
    await waitFor(() => expect(count).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('user-assigned-work-transfer').textContent).toBe('console.assignedWork.handover');
  });

  it('a partial hand-over: names each failed record with its reason and offers the next batch', async () => {
    transfer = vi.fn(async () => ({
      fromUserId: USER_ID, toUserId: 'u_kim', updated: 2, failed: 1, remaining: 1,
      objects: [{
        object: 'showcase_project', field: 'owner_id', updated: 2, failed: 1,
        failures: [{ id: 'p3', code: 'RECORD_LOCKED', message: 'The record is locked by an approval' }],
      }],
    }));
    mount();
    await pickTarget('u_kim');
    fireEvent.click(screen.getByTestId('user-assigned-work-transfer'));
    const report = await screen.findByTestId('user-assigned-work-report');
    expect(report.textContent).toContain('console.assignedWork.report {"updated":2,"failed":1,"remaining":1}');
    expect(screen.getAllByTestId('user-assigned-work-failure').map((li) => li.textContent)).toEqual([
      'console.assignedWork.failure {"object":"Project","id":"p3","message":"The record is locked by an approval"}',
    ]);
    // Something remains: the next click hands over the next batch.
    expect(screen.getByTestId('user-assigned-work-transfer').textContent).toBe('console.assignedWork.handoverNext');
    fireEvent.click(screen.getByTestId('user-assigned-work-transfer'));
    await waitFor(() => expect(transfer).toHaveBeenCalledTimes(2));
  });

  it('a hand-over to a banned person is refused in the user\'s language, not the server\'s', async () => {
    transfer = vi.fn(async () => {
      throw Object.assign(new Error('User "u_kim" is banned and cannot be assigned new records; pick an active user'), {
        code: 'VALIDATION_ERROR',
        fields: [{ field: 'toUserId', code: 'reference_user_banned' }],
      });
    });
    mount();
    await pickTarget('u_kim');
    fireEvent.click(screen.getByTestId('user-assigned-work-transfer'));
    expect((await screen.findByTestId('user-assigned-work-transfer-refused')).textContent).toBe('console.assignedWork.targetBanned');
    expect(screen.queryByTestId('user-assigned-work-report')).toBeNull();
  });

  it('any other refused hand-over shows the server\'s reason', async () => {
    transfer = vi.fn(async () => { throw new Error('No user has id "u_kim"'); });
    mount();
    await pickTarget('u_kim');
    fireEvent.click(screen.getByTestId('user-assigned-work-transfer'));
    expect((await screen.findByTestId('user-assigned-work-transfer-refused')).textContent)
      .toBe('console.assignedWork.transferRefused {"message":"No user has id \\"u_kim\\""}');
  });

  it('the ban never waits for the hand-over: Confirm stays clickable while one runs, and bans', async () => {
    let finish!: (v: unknown) => void;
    transfer = vi.fn(() => new Promise((r) => { finish = r; }));
    const resolve = mount();
    await pickTarget('u_kim');
    fireEvent.click(screen.getByTestId('user-assigned-work-transfer'));
    await waitFor(() => expect(screen.getByTestId('user-assigned-work-transfer').getAttribute('aria-busy')).toBe('true'));
    expect((confirm() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirm());
    await waitFor(() => expect(resolve).toHaveBeenCalledWith({ banReason: undefined }));
    await act(async () => {
      finish({ fromUserId: USER_ID, toUserId: 'u_kim', updated: 0, failed: 0, remaining: 0, objects: [] });
    });
  });

  it('the panel is not drawn on a dialog without the companion', async () => {
    render(
      <ActionParamDialog state={{ open: true, params: PARAMS, title: 'Unban User', resolve: vi.fn() }} onOpenChange={() => {}} />,
    );
    await screen.findByRole('button', { name: 'actionDialog.confirm' });
    expect(screen.queryByTestId('user-assigned-work')).toBeNull();
    expect(count).not.toHaveBeenCalled();
  });
});
