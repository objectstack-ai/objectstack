/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record approvals panel's "N eligible approver(s)" counts people, not
 * `pending_approvers` slots (objectui#12781).
 *
 * The approvals service keeps one slot per resolved approver entry, so one
 * person holding two of a node's positions fills two slots under the same
 * user id. The panel handed the slot count to `DecisionProgressIndicator`, so
 * the stock showcase's committee quorum read "3 eligible approvers" beside a
 * single "Dev Admin ×3" chip. The fixtures below are in the shape the
 * approvals get serves: user-id slots, a name for each id, the server's tally.
 *
 * Each label is asserted as the pack row the indicator reads, rendered by the
 * same i18next instance the panel renders with, so a pin names the row and
 * its count rather than restating English prose.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import type { ApprovalRequestLite } from '../hooks/useRecordApprovals';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { RecordApprovalsPanel } from './RecordApprovalsPanel';

const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });

/** The pack row a label must come from, rendered by the instance under test. */
function row(key: string, args?: Record<string, unknown>): string {
  return String(i18n.t(`approvalsInbox.${key}`, args));
}

const NAMES: Record<string, string> = {
  u_nina: 'Nina Novak',
  u_pat: 'Pat Price',
  u_lee: 'Lee Lin',
  u_dev_admin: 'Dev Admin',
};

function pendingRequest(pending_approvers: string[], got = 1, need = 2): ApprovalRequestLite {
  return {
    id: 'req_12781',
    process_name: 'flow:showcase_expense_committee',
    process_label: 'High-Value Expense — Committee Quorum',
    object_name: 'showcase_expense_report',
    record_id: 'rec_1',
    status: 'pending',
    current_step: 'committee',
    step_label: 'Committee Sign-off',
    submitter_id: 'u_submitter',
    submitted_at: '2026-10-16T08:00:00Z',
    pending_approvers,
    pending_approver_names: Object.fromEntries(pending_approvers.map((id) => [id, NAMES[id]])),
    decision_progress: { behavior: 'quorum', got, need },
    viewer: { can_act: false, is_submitter: false },
  };
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      /\/approvals\/requests\/req_12781\/actions$/.test(String(url))
        ? ({ ok: true, json: async () => ({ data: [] }) } as unknown as Response)
        : ({ ok: false, status: 404, json: async () => ({}) } as unknown as Response),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderPanel(request: ApprovalRequestLite) {
  render(
    <I18nProvider instance={i18n}>
      <RecordApprovalsPanel
        approvals={{ available: true, requests: [request], pendingRequest: request }}
        currentUserId="u_viewer"
      />
    </I18nProvider>,
  );
  const panel = await screen.findByTestId('record-approvals-panel');
  return { panel, bar: within(panel).getByRole('progressbar') };
}

describe('RecordApprovalsPanel — eligible approvers count distinct users (objectui#12781)', () => {
  it.each([
    ['one user in two slots among others', ['u_nina', 'u_dev_admin', 'u_dev_admin', 'u_lee'], 3],
    ['the stock showcase committee quorum: one user in all three slots', ['u_dev_admin', 'u_dev_admin', 'u_dev_admin'], 1],
  ])('%s: the label counts distinct users, not slots', async (_name, slots, people) => {
    const { panel } = await renderPanel(pendingRequest(slots));

    expect(within(panel).getByText(row('progressEligible', { count: people }))).toBeTruthy();
    expect(within(panel).queryByText(row('progressEligible', { count: slots.length }))).toBeNull();
  });

  it('distinct users only: the count is the one the slot length always gave', async () => {
    const slots = ['u_nina', 'u_pat', 'u_lee'];
    const { panel } = await renderPanel(pendingRequest(slots));

    expect(within(panel).getByText(row('progressEligible', { count: slots.length }))).toBeTruthy();
  });

  it("the server's tally is drawn as served: got and need are untouched by the distinct count", async () => {
    const { panel, bar } = await renderPanel(
      pendingRequest(['u_nina', 'u_dev_admin', 'u_dev_admin', 'u_lee'], 1, 2),
    );

    expect(within(panel).getByText(row('progressApprovals', { got: 1, need: 2 }))).toBeTruthy();
    expect(bar.getAttribute('aria-valuemax')).toBe('2');
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
    expect(bar.children).toHaveLength(2);
  });
});
