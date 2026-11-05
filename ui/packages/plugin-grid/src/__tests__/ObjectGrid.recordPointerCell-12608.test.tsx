/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12608 — a `referenceVia` pointer column in the list grid draws the
 * record it names, not the record id.
 *
 * `sys_approval_request.record_id` is a `text` field declaring
 * `referenceVia: 'object_name'`: its value is a record id of the object the
 * row's `object_name` names. The grid asks `resolveRecordPointer`
 * (`@object-ui/fields`) per row and draws the pair with `RecordPointerCell`:
 *
 *   - readable   → the target object's icon + the record's name, linking to
 *                  the record through the host's `recordHref`; the raw id is
 *                  the tooltip;
 *   - unreadable → the object's label + "record unavailable", the raw id only
 *                  in the tooltip, never the id alone;
 *   - one `find` per target object for the whole page, not one per row.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, RelatedRecordActionsProvider } from '@object-ui/react';

registerAllFields();

const REQUEST_DEF = {
  name: 'sys_approval_request',
  label: 'Approval Request',
  fields: {
    process_name: { name: 'process_name', type: 'text', label: 'Source' },
    object_name: { name: 'object_name', type: 'text', label: 'Object' },
    record_id: { name: 'record_id', type: 'text', label: 'Record ID', referenceVia: 'object_name' },
  },
};

const OPPORTUNITY_DEF = {
  name: 'crm_opportunity',
  label: 'Opportunity',
  icon: 'briefcase',
  nameField: 'name',
  fields: { name: { name: 'name', type: 'text', label: 'Name' } },
};

const OPPORTUNITIES = [
  { id: 'opp-1', name: 'Acme renewal' },
  { id: 'opp-2', name: 'Globex expansion' },
];

function makeDataSource() {
  const find = vi.fn(async (objectName: string, params?: any) => {
    if (objectName !== 'crm_opportunity') return { data: [] };
    const wanted: string[] = params?.$filter?.id?.$in ?? [];
    return { data: OPPORTUNITIES.filter((r) => wanted.includes(r.id)) };
  });
  const getObjectSchema = vi.fn(async (objectName: string) => {
    if (objectName === 'sys_approval_request') return REQUEST_DEF;
    if (objectName === 'crm_opportunity') return OPPORTUNITY_DEF;
    throw new Error('unknown object');
  });
  return { find, getObjectSchema, findOne: vi.fn() } as any;
}

function makeHost() {
  return {
    resolve: () => ({}),
    recordHref: (objectName: string, recordId: string | number) =>
      `/apps/crm/${objectName}/record/${encodeURIComponent(String(recordId))}`,
    openRecord: vi.fn(),
  } as any;
}

function renderGrid(rows: Array<Record<string, unknown>>, dataSource = makeDataSource()) {
  const schema: any = {
    type: 'object-grid' as const,
    objectName: 'sys_approval_request',
    columns: ['process_name', 'object_name', 'record_id'],
    data: { provider: 'value', items: rows },
  };
  const utils = render(
    <ActionProvider>
      <RelatedRecordActionsProvider value={makeHost()}>
        <ObjectGrid schema={schema} dataSource={dataSource} />
      </RelatedRecordActionsProvider>
    </ActionProvider>,
  );
  return { ...utils, dataSource };
}

describe('ObjectGrid — a referenceVia pointer cell draws the record it names (objectui#12608)', () => {
  it('renders the resolved record name with the object icon, linking to the record', async () => {
    const { container, dataSource } = renderGrid([
      { id: 'req-1', process_name: 'flow:opportunity_approval', object_name: 'crm_opportunity', record_id: 'opp-1' },
      { id: 'req-2', process_name: 'flow:opportunity_approval', object_name: 'crm_opportunity', record_id: 'opp-2' },
    ]);

    const link = await screen.findByRole('link', { name: 'Acme renewal' });
    expect(link).toHaveAttribute('href', '/apps/crm/crm_opportunity/record/opp-1');
    expect(await screen.findByRole('link', { name: 'Globex expansion' })).toHaveAttribute(
      'href',
      '/apps/crm/crm_opportunity/record/opp-2',
    );

    const cell = link.closest('[data-record-pointer="readable"]') as HTMLElement;
    expect(cell).not.toBeNull();
    // The raw id moved to the tooltip; the object's icon is drawn beside the name.
    expect(cell).toHaveAttribute('title', 'opp-1');
    expect(cell.querySelector('svg.lucide-briefcase')).not.toBeNull();
    // The id is not printed as cell text anywhere.
    expect(screen.queryByText('opp-1')).toBeNull();

    // One read for the page's targets of one object, not one per row.
    const targetReads = dataSource.find.mock.calls.filter(([name]: [string]) => name === 'crm_opportunity');
    expect(targetReads).toHaveLength(1);
    expect(targetReads[0][1].$filter.id.$in.sort()).toEqual(['opp-1', 'opp-2']);
    expect(container.querySelectorAll('[data-record-pointer="readable"]')).toHaveLength(2);
  });

  it('renders the object label plus "record unavailable" for an unresolvable record, never the id alone', async () => {
    renderGrid([
      { id: 'req-3', process_name: 'flow:opportunity_approval', object_name: 'crm_opportunity', record_id: 'opp-gone' },
    ]);

    const unavailable = await screen.findByText('Opportunity · record unavailable');
    const cell = unavailable.closest('[data-record-pointer="unreadable"]') as HTMLElement;
    expect(cell).not.toBeNull();
    expect(cell).toHaveAttribute('title', 'opp-gone');
    expect(cell.querySelector('a')).toBeNull();
    expect(screen.queryByText('opp-gone')).toBeNull();
  });

  it('a half-addressed row keeps the stored text (control)', async () => {
    renderGrid([{ id: 'req-4', process_name: 'flow:x', object_name: '', record_id: 'loose-id' }]);
    await waitFor(() => expect(screen.getByText('loose-id')).toBeInTheDocument());
    expect(document.querySelector('[data-record-pointer]')).toBeNull();
  });
});

/**
 * objectstack#30209 row 3 — a record whose name field is a REFERENCE reads as
 * the referenced record's name. `sys_session` is named by `user_id`, a lookup
 * that stores a user id: read without `$expand` the name ladder printed that
 * id, so every sign-in row of the audit list read `05bdsJ9C…` where its update
 * rows read "Dev Admin". The read now expands that one field, and only it.
 */
describe('ObjectGrid — a pointer cell names a record whose name field is a lookup (objectstack#30209)', () => {
  const AUDIT_DEF = {
    name: 'sys_audit_log',
    label: 'Audit Log',
    fields: {
      action: { name: 'action', type: 'text', label: 'Action' },
      object_name: { name: 'object_name', type: 'text', label: 'Object' },
      record_id: { name: 'record_id', type: 'text', label: 'Record', referenceVia: 'object_name' },
    },
  };
  const SESSION_DEF = {
    name: 'sys_session',
    label: 'Session',
    nameField: 'user_id',
    fields: {
      user_id: { name: 'user_id', type: 'lookup', reference: 'sys_user', label: 'User' },
      ip_address: { name: 'ip_address', type: 'text', label: 'IP' },
      device: { name: 'device', type: 'lookup', reference: 'sys_device', label: 'Device' },
    },
  };

  function sessionSource() {
    const find = vi.fn(async (objectName: string, params?: any) => {
      if (objectName !== 'sys_session') return { data: [] };
      const expanded = Array.isArray(params?.$expand) && params.$expand.includes('user_id');
      return {
        data: [{ id: 'ses-1', user_id: expanded ? { id: 'u-1', name: 'Dev Admin' } : 'u-1', ip_address: '10.0.0.1' }],
      };
    });
    const getObjectSchema = vi.fn(async (objectName: string) => {
      if (objectName === 'sys_audit_log') return AUDIT_DEF;
      if (objectName === 'sys_session') return SESSION_DEF;
      if (objectName === 'crm_opportunity') return OPPORTUNITY_DEF;
      throw new Error('unknown object');
    });
    return { find, getObjectSchema, findOne: vi.fn() } as any;
  }

  function renderAudit(rows: Array<Record<string, unknown>>, dataSource: any) {
    const schema: any = {
      type: 'object-grid' as const,
      objectName: 'sys_audit_log',
      columns: ['action', 'object_name', 'record_id'],
      data: { provider: 'value', items: rows },
    };
    return render(
      <ActionProvider>
        <RelatedRecordActionsProvider value={makeHost()}>
          <ObjectGrid schema={schema} dataSource={dataSource} />
        </RelatedRecordActionsProvider>
      </ActionProvider>,
    );
  }

  it("draws the session's user name, not the user id it stores, and expands only the name field", async () => {
    const dataSource = sessionSource();
    renderAudit([{ id: 'a-1', action: 'login', object_name: 'sys_session', record_id: 'ses-1' }], dataSource);

    expect(await screen.findByRole('link', { name: 'Dev Admin' })).toHaveAttribute(
      'href',
      '/apps/crm/sys_session/record/ses-1',
    );
    expect(screen.queryByText('u-1')).toBeNull();
    const reads = dataSource.find.mock.calls.filter(([name]: [string]) => name === 'sys_session');
    expect(reads).toHaveLength(1);
    // The other lookup on the object is not expanded: no cell shows it.
    expect(reads[0][1].$expand).toEqual(['user_id']);
  });

  it('a record named by a text field is read without an `$expand` (control)', async () => {
    const dataSource = sessionSource();
    dataSource.find.mockImplementation(async (objectName: string, params?: any) =>
      objectName === 'crm_opportunity'
        ? { data: OPPORTUNITIES.filter((r) => (params?.$filter?.id?.$in ?? []).includes(r.id)) }
        : { data: [] },
    );
    renderAudit([{ id: 'a-2', action: 'update', object_name: 'crm_opportunity', record_id: 'opp-1' }], dataSource);

    await screen.findByRole('link', { name: 'Acme renewal' });
    const reads = dataSource.find.mock.calls.filter(([name]: [string]) => name === 'crm_opportunity');
    expect(reads).toHaveLength(1);
    expect(reads[0][1]).not.toHaveProperty('$expand');
  });
});
