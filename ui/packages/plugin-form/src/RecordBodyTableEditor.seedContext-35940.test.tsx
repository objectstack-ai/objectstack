/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The record page's body-table editor seeds a new line with the values a
 * create form of the child seeds (objectstack#35940): its static defaults, and
 * the session facts `ObjectForm` threads, so a field defaulted to the acting
 * user starts on that user. CONTROL: with no known user that field starts
 * empty and is left to the server, as on a create form.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RecordContextProvider } from '@object-ui/react';
import { MePermissionsProvider } from '@object-ui/permissions';
import { registerAllFields } from '@object-ui/fields';
import {
  RecordBodyTableEditor,
  RecordEditSessionContext,
  type BodyTableEditHandle,
  type RecordEditSession,
} from './RecordBodyTableEditor';

registerAllFields();
afterEach(() => cleanup());

const USER_ID = 'user-42';

const TASK_SCHEMA = {
  name: 'meeting_task',
  fields: {
    name: { type: 'text', label: 'Name', required: true },
    status: { type: 'text', label: 'Status', required: true, defaultValue: 'pending' },
    assignee: { type: 'user', label: 'Assignee', defaultValue: 'current_user' },
    meeting: { type: 'master_detail', label: 'Meeting', reference: 'meeting' },
  },
};

const ME_PERMISSIONS = {
  authenticated: true,
  userId: USER_ID,
  tenantId: 't1',
  roles: ['user'],
  permissionSets: [],
  objects: { '*': { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true } },
  fields: {},
};

function mount(withUser: boolean) {
  const ds = {
    getObjectSchema: vi.fn(async () => TASK_SCHEMA),
    find: vi.fn(async () => ({ data: [] })),
    onMutation: () => () => {},
  };
  let handle: BodyTableEditHandle | null = null;
  const session: RecordEditSession = {
    register: (h) => {
      handle = h;
      return () => { handle = null; };
    },
    reportDirty: () => {},
    saving: false,
  };
  const editor = (
    <RecordContextProvider objectName="meeting" recordId="m1" dataSource={ds as never}>
      <RecordEditSessionContext.Provider value={session}>
        <RecordBodyTableEditor objectName="meeting_task" relationshipField="meeting" />
      </RecordEditSessionContext.Provider>
    </RecordContextProvider>
  );
  render(withUser ? <MePermissionsProvider initialPermissions={ME_PERMISSIONS as never}>{editor}</MePermissionsProvider> : editor);
  return { rows: () => (handle as BodyTableEditHandle | null)?.snapshot()?.rows ?? null };
}

describe('RecordBodyTableEditor — a new line seeds what a create form seeds (objectstack#35940)', () => {
  it('a field defaulted to the acting user starts on that user, beside the static defaults', async () => {
    const { rows } = mount(true);
    fireEvent.click(await screen.findByTestId('line-items-add'));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()![0]).toMatchObject({ status: 'pending', assignee: USER_ID });
  });

  it('CONTROL: with no known user the field starts empty, left to the server', async () => {
    const { rows } = mount(false);
    fireEvent.click(await screen.findByTestId('line-items-add'));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()![0]).toMatchObject({ status: 'pending' });
    expect(rows()![0].assignee ?? null).toBeNull();
  });
});
