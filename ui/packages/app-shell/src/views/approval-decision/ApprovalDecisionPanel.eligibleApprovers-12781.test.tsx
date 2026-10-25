/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The approval decision panel's "N eligible approver(s)" counts people, not
 * `pending_approvers` slots (objectui#12781).
 *
 * The approvals service keeps one slot per resolved approver entry, so one
 * person holding two of a node's positions fills two slots under the same
 * user id. The panel handed the slot count to `DecisionProgressIndicator`, so
 * the stock showcase's committee quorum read "3 eligible approvers" beside a
 * single "Dev Admin ×3" chip. The rows below are in the shape the approvals
 * get serves the request page: user-id slots, a name for each id, the
 * server's tally.
 *
 * The declared actions bar is doubled: what is under test is the progress
 * line. Each label is asserted as the pack row the indicator reads, rendered
 * by the same i18next instance the panel renders with.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

vi.mock('../DeclaredActionsBar.js', () => ({
  DeclaredActionsBar: () => <div data-testid="declared-actions-probe" />,
}));

import { RecordContextProvider } from '@object-ui/react';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { ApprovalDecisionRenderer } from './ApprovalDecisionPanel';
import { resetApproverDirectoryCache } from '../../hooks/useApproverDirectory';

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

function requestRow(pending_approvers: string[], got = 1, need = 2): Record<string, unknown> {
  return {
    id: 'areq_12781',
    process_name: 'flow:showcase_expense_committee',
    object_name: 'showcase_expense_report',
    record_id: 'rec_1',
    status: 'pending',
    pending_approvers,
    pending_approver_names: Object.fromEntries(pending_approvers.map((id) => [id, NAMES[id]])),
    decision_progress: { behavior: 'quorum', got, need },
    viewer: { can_act: true, is_submitter: false, can_override: false },
  };
}

beforeEach(() => resetApproverDirectoryCache());

afterEach(() => {
  cleanup();
});

function mount(data: Record<string, unknown>) {
  render(
    <I18nProvider instance={i18n}>
      <RecordContextProvider objectName="sys_approval_request" recordId={data.id as string} data={data}>
        <ApprovalDecisionRenderer />
      </RecordContextProvider>
    </I18nProvider>,
  );
  const panel = screen.getByTestId('approval-decision-panel');
  return { panel, bar: within(panel).getByRole('progressbar') };
}

describe('ApprovalDecisionPanel — eligible approvers count distinct users (objectui#12781)', () => {
  it.each([
    ['one user in two slots among others', ['u_nina', 'u_dev_admin', 'u_dev_admin', 'u_lee'], 3],
    ['the stock showcase committee quorum: one user in all three slots', ['u_dev_admin', 'u_dev_admin', 'u_dev_admin'], 1],
  ])('%s: the label counts distinct users, not slots', (_name, slots, people) => {
    const { panel } = mount(requestRow(slots));

    expect(within(panel).getByText(row('progressEligible', { count: people }))).toBeTruthy();
    expect(within(panel).queryByText(row('progressEligible', { count: slots.length }))).toBeNull();
  });

  it('distinct users only: the count is the one the slot length always gave', () => {
    const slots = ['u_nina', 'u_pat', 'u_lee'];
    const { panel } = mount(requestRow(slots));

    expect(within(panel).getByText(row('progressEligible', { count: slots.length }))).toBeTruthy();
  });

  it("the server's tally is drawn as served: got and need are untouched by the distinct count", () => {
    const { panel, bar } = mount(requestRow(['u_nina', 'u_dev_admin', 'u_dev_admin', 'u_lee'], 1, 2));

    expect(within(panel).getByText(row('progressApprovals', { got: 1, need: 2 }))).toBeTruthy();
    expect(bar.getAttribute('aria-valuemax')).toBe('2');
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
    expect(bar.children).toHaveLength(2);
  });
});
