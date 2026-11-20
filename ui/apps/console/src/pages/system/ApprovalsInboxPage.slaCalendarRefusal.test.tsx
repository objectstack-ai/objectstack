/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A working-time SLA whose calendar cannot count the deadline shows WHY in the
 * place the SLA countdown sits (ADR-0157 D9): 「日历算不出」 and the reason,
 * from the row's `sla_due_refusal`, in the UI language. A row with a due time
 * keeps its countdown (the control), and a row with neither shows nothing.
 *
 * The harness is the queue page's own (`ApprovalsInboxPage.displayLocale-10375.test.tsx`):
 * the real `I18nProvider`, with the approvals API stubbed to the served rows.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';
import { I18nProvider } from '@object-ui/i18n';

const { approvalsApiStub, ADAPTER, AUTH } = vi.hoisted(() => {
  const SUBMITTED = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const row = (id: string, extra: Record<string, unknown>): Record<string, unknown> => ({
    id,
    process_name: 'purchase_approval',
    process_label: 'Purchase Approval',
    object_name: 'showcase_purchase',
    object_label: 'Purchase',
    record_id: `po_${id}`,
    record_title: `PO ${id}`,
    status: 'pending',
    pending_approvers: ['u_1'],
    submitter_id: 'u_2',
    submitter_name: 'Sam Submitter',
    submitted_at: SUBMITTED,
    ...extra,
  });
  const ROWS = [
    row('missing', {
      sla_due_refusal: {
        code: 'ERR_WORK_CALENDAR_UNRESOLVED', reason: 'not_found', calendar: 'cn_standard',
        message: "No working calendar has the code 'cn_standard' in this organization.",
      },
    }),
    row('unmaintained', {
      sla_due_refusal: {
        code: 'ERR_WORK_CALENDAR_NOT_MAINTAINED', calendar: 'cn_standard', date: '2027-01-04',
        message: "Working calendar 'cn_standard' is maintained through 2026-12-31.",
      },
    }),
    row('timed', { sla_due_at: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString() }),
  ];
  const approvalsApiStub = {
    listRequests: async () => ({ data: ROWS, total: ROWS.length }),
    getRequest: async () => ({ data: ROWS[0] }),
    listActions: async () => ({ data: [] }),
    approve: async () => ({ data: ROWS[0], finalized: true }),
    reject: async () => ({ data: ROWS[0], finalized: true }),
  };
  const ADAPTER = {
    find: async () => ({ data: ROWS.map((r) => ({ id: r.record_id })) }),
    getObjectSchema: async () => ({ fields: {} }),
  };
  const AUTH = { user: { id: 'u_1', email: 'approver@example.com' } };
  return { approvalsApiStub, ADAPTER, AUTH };
});

vi.mock('@object-ui/auth', async (importOriginal) => {
  const authFetch = async () => new Response('{}', { status: 200 });
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useAuth: () => AUTH,
    createAuthenticatedFetch: () => authFetch,
    TokenStorage: { get: () => null },
  };
});

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
  useMetadata: () => ({ objects: [] }),
  DeclaredActionsBar: () => null,
  isViaOverrideRow: () => false,
}));

vi.mock('../../services/approvalsApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  approvalsApi: approvalsApiStub,
}));

import { ApprovalsInboxPage } from './ApprovalsInboxPage';

afterEach(() => cleanup());

function permissions(): MePermissionsAuthenticatedResponse {
  return {
    authenticated: true,
    userId: 'u_1',
    tenantId: 't_1',
    positions: [],
    hasAnyQueue: false,
    objectsUsingQueues: [],
    permissionSets: [],
    objects: {},
    fields: {},
    systemPermissions: ['setup.access'],
  };
}

function renderInbox(language: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
              <MePermissionsProvider initialPermissions={permissions()}>
          <MemoryRouter initialEntries={['/apps/app/system/approvals']}>
            <Routes>
              <Route path="/apps/:appName/system/approvals" element={<ApprovalsInboxPage />} />
            </Routes>
          </MemoryRouter>
        </MePermissionsProvider>
    </I18nProvider>,
  );
}

/** The queue cell's SLA line of the row whose record title is `title`. */
async function slaLine(title: string): Promise<string> {
  const link = (await screen.findAllByText(title))[0]!;
  const row = link.closest('tr');
  expect(row, `no queue row for ${title}`).not.toBeNull();
  const cell = row!.querySelector('td[title]');
  return (cell?.querySelector('div')?.textContent ?? '').trim();
}

describe('ApprovalsInboxPage — a working calendar that cannot count the SLA says why (ADR-0157 D9)', () => {
  it('shows the reason in place of the countdown, and keeps the countdown where a due time is served', async () => {
    renderInbox('en');
    expect(await slaLine('PO missing')).toBe('Calendar can\'t compute: no calendar "cn_standard"');
    expect(await slaLine('PO unmaintained')).toBe('Calendar can\'t compute: not maintained for 2027-01-04');
    expect(await slaLine('PO timed')).toMatch(/^SLA .* left$/);
  });

  it("reads in the UI language: 「日历算不出」 under zh-CN", async () => {
    renderInbox('zh-CN');
    expect(await slaLine('PO missing')).toBe('日历算不出：没有日历“cn_standard”');
    expect(await slaLine('PO unmaintained')).toBe('日历算不出：未维护到 2027-01-04');
  });
});
