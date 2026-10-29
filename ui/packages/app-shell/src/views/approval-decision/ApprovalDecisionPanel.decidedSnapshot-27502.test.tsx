/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * After a decision, the approval request page must not tell two stories
 * (objectstack#27502). The page's highlights read the REQUEST row, whose status
 * moves to approved; the decision panel's summary reads the request's
 * `payload`, the target record as it was SUBMITTED, which keeps its submitted
 * status (objectstack#10749, ruling record 5377367175: the snapshot is kept as
 * the evidence of what was submitted). So the summary is labelled as the
 * submitted values: a section whose accessible name is the pack's
 * `approvalsInbox.snapshotHeading` row, holding the snapshot's own values.
 *
 * The rows are in the shape the approvals get serves the request page after a
 * reload: a decided request, its snapshot still at submission. The declared
 * actions bar is doubled: what is under test is the summary's label.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

vi.mock('../DeclaredActionsBar.js', () => ({
  DeclaredActionsBar: () => <div data-testid="declared-actions-probe" />,
}));

import { MetadataCtx, RecordContextProvider } from '@object-ui/react';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { ApprovalDecisionRenderer } from './ApprovalDecisionPanel';
import { resetApproverDirectoryCache } from '../../hooks/useApproverDirectory';

const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });

/** The pack row the heading must come from, rendered by the instance under test. */
const HEADING = String(i18n.t('approvalsInbox.snapshotHeading'));

const EXPENSE_REPORT = {
  name: 'showcase_expense_report',
  fields: {
    title: { type: 'text', label: 'Title' },
    status: {
      type: 'select',
      label: 'Status',
      options: [
        { value: 'submitted', label: 'Submitted' },
        { value: 'approved', label: 'Approved' },
      ],
    },
    approved_amount: { type: 'currency', label: 'Approved' },
  },
};

const metadata = {
  getItem: async (type: string, name: string) =>
    type === 'object' && name === EXPENSE_REPORT.name ? EXPENSE_REPORT : null,
};

function requestRow(status: string): Record<string, unknown> {
  return {
    id: 'areq_27502',
    process_name: 'flow:showcase_expense_committee',
    object_name: EXPENSE_REPORT.name,
    record_id: 'rec_1',
    status,
    submitter_id: 'u_dev_admin',
    pending_approvers: status === 'pending' ? ['u_dev_admin'] : [],
    pending_approver_names: { u_dev_admin: 'Dev Admin' },
    viewer: { can_act: status === 'pending', is_submitter: false, can_override: false },
    // The target record as it was submitted: it does not move on a decision.
    payload: { title: 'EXP-DEMO', status: 'submitted', approved_amount: 0 },
  };
}

beforeEach(() => resetApproverDirectoryCache());

afterEach(() => {
  cleanup();
});

async function summaryOf(data: Record<string, unknown>) {
  render(
    <I18nProvider instance={i18n}>
      <MetadataCtx.Provider value={metadata as never}>
        <RecordContextProvider objectName="sys_approval_request" recordId={data.id as string} data={data}>
          <ApprovalDecisionRenderer />
        </RecordContextProvider>
      </MetadataCtx.Provider>
    </I18nProvider>,
  );
  const panel = screen.getByTestId('approval-decision-panel');
  const summary = await within(panel).findByTestId('record-snapshot-summary');
  return { panel, summary };
}

describe('ApprovalDecisionPanel — the summary is labelled as the submitted values (objectstack#27502)', () => {
  it('a decided request: the snapshot keeps its submitted status, inside a section named as the submitted values', async () => {
    const { panel, summary } = await summaryOf(requestRow('approved'));

    // The decided state the reload serves: nobody is waited on any more.
    expect(within(panel).queryByTestId('approval-decision-pending-approvers')).toBeNull();
    // The summary is the region the heading names, and the heading is the pack row.
    expect(HEADING).not.toBe('approvalsInbox.snapshotHeading');
    expect(within(panel).getByRole('region', { name: HEADING })).toBe(summary);
    // What the section holds is the snapshot, as submitted, never the request's status.
    const status = summary.querySelector('[data-summary-field="status"]');
    expect(status?.textContent).toContain('Submitted');
    expect(status?.textContent).not.toContain('Approved');
  });

  it('the label does not depend on the request status: a pending request names it the same way', async () => {
    const { panel, summary } = await summaryOf(requestRow('pending'));

    expect(within(panel).getByTestId('approval-decision-pending-approvers')).toBeTruthy();
    expect(within(panel).getByRole('region', { name: HEADING })).toBe(summary);
  });
});
