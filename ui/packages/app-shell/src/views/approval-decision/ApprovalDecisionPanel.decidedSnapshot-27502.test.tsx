/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * After a decision, the approval request page must not tell two stories
 * (objectstack#27502, ruling record 6499914328). The page's highlights read the
 * REQUEST row, whose status moves to approved; the decision panel's summary
 * reads the request's `payload`, the target record as it was SUBMITTED, which
 * keeps its submitted status (objectstack#10749, ruling record 5377367175: the
 * snapshot is kept as the evidence of what was submitted). So the summary is
 * labelled as the submitted values: a section whose accessible name is the
 * pack's `approvalsInbox.snapshotAsSubmitted` row, holding the snapshot's own
 * values.
 *
 * The rows are in the shape the approvals get serves the request page after a
 * reload: a decided request, its snapshot still at submission. The declared
 * actions bar is doubled: what is under test is the summary's label.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../DeclaredActionsBar.js', () => ({
  DeclaredActionsBar: () => <div data-testid="declared-actions-probe" />,
}));

import { MetadataCtx, RecordContextProvider } from '@object-ui/react';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { ApprovalDecisionRenderer } from './ApprovalDecisionPanel';
import { resetApproverDirectoryCache } from '../../hooks/useApproverDirectory';

const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });

/** The heading's pack key, and what one pack says for it. */
const HEADING_KEY = 'approvalsInbox.snapshotAsSubmitted';
const packHeading = (language: string): unknown =>
  HEADING_KEY.split('.').reduce<unknown>(
    (node, part) => (node as Record<string, unknown> | undefined)?.[part],
    (builtInLocales as Record<string, unknown>)[language],
  );

/** The pack row the heading must come from, rendered by the instance under test. */
const HEADING = String(i18n.t(HEADING_KEY));

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

const seen: string[] = [];
const metadata = {
  getItem: async (type: string, name: string) => {
    seen.push(`${type}:${name}`);
    return type === 'object' && name === EXPENSE_REPORT.name ? EXPENSE_REPORT : null;
  },
};

/** The target record as it was submitted: it does not move on a decision. */
const SUBMITTED = { title: 'EXP-DEMO', status: 'submitted', approved_amount: 0 };

function requestRow(status: string, payload: Record<string, unknown> = SUBMITTED): Record<string, unknown> {
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
    payload,
  };
}

beforeEach(() => {
  resetApproverDirectoryCache();
  seen.length = 0;
});

afterEach(() => {
  cleanup();
});

function mount(data: Record<string, unknown>): HTMLElement {
  render(
    <I18nProvider instance={i18n}>
      <MetadataCtx.Provider value={metadata as never}>
        <RecordContextProvider objectName="sys_approval_request" recordId={data.id as string} data={data}>
          <ApprovalDecisionRenderer />
        </RecordContextProvider>
      </MetadataCtx.Provider>
    </I18nProvider>,
  );
  return screen.getByTestId('approval-decision-panel');
}

describe('ApprovalDecisionPanel — the summary is labelled as the submitted values (objectstack#27502)', () => {
  it('a decided request: the snapshot keeps its submitted status, under the heading, and nobody is waited on', async () => {
    const panel = mount(requestRow('approved'));
    const summary = await within(panel).findByTestId('record-snapshot-summary');

    // The decided state the reload serves: nobody is waited on any more.
    expect(within(panel).queryByTestId('approval-decision-pending-approvers')).toBeNull();
    // The summary is the region the heading names, and the heading is the pack row.
    expect(HEADING).not.toBe(HEADING_KEY);
    expect(within(panel).getByRole('region', { name: HEADING })).toBe(summary);
    expect(summary.querySelector('[data-summary-heading]')?.textContent).toBe(HEADING);
    // What the section holds is the snapshot as submitted, under the declared select field.
    const status = summary.querySelector('[data-summary-field="status"]');
    expect(status?.textContent).toBe('StatusSubmitted');
  });

  it('a pending request carries the heading too: it names the source, not a status', async () => {
    const panel = mount(requestRow('pending'));
    const summary = await within(panel).findByTestId('record-snapshot-summary');

    expect(within(panel).getByTestId('approval-decision-pending-approvers')).toBeTruthy();
    expect(within(panel).getByRole('region', { name: HEADING })).toBe(summary);
  });

  it('CONTROL: a summary that draws nothing draws no heading', async () => {
    // Only keys the object does not declare: the definition answers, and no row is drawn.
    const panel = mount(requestRow('approved', { legacy_note: 'x' }));

    await waitFor(() => expect(seen).toContain(`object:${EXPENSE_REPORT.name}`));
    await new Promise((r) => setTimeout(r, 0));
    expect(within(panel).queryByTestId('record-snapshot-summary')).toBeNull();
    expect(within(panel).queryByText(HEADING)).toBeNull();
  });

  it('the heading copy is a key in all ten language packs', () => {
    const languages = Object.keys(builtInLocales);
    expect(languages).toHaveLength(10);
    for (const language of languages) {
      const value = packHeading(language);
      expect(typeof value, `${language} defines ${HEADING_KEY}`).toBe('string');
      expect((value as string).trim(), `${language} defines ${HEADING_KEY}`).not.toBe('');
    }
  });
});
