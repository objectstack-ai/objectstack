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
import { builtInLocales } from '@object-ui/i18n/locales';
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

/**
 * The chip and the count read as one story when one principal holds several
 * of a step's slots (objectstack#27615). Both numbers stay as they were: the
 * chip still stands for every slot its person fills, and the eligible count
 * still counts that person once. What changed is that the chip says, in the
 * pack's words, what its number counts, instead of a bare "×3" beside
 * "1 eligible approver".
 */
describe('ApprovalDecisionPanel — a principal holding several slots: the chip and the count read as one story (objectstack#27615)', () => {
  const chips = (panel: HTMLElement) => within(panel).getAllByTestId('approver-chip');

  it('the stock committee quorum: one chip that says its person holds three slots, beside one eligible approver', () => {
    const { panel } = mount(requestRow(['u_dev_admin', 'u_dev_admin', 'u_dev_admin']));
    const words = row('approverSlots', { count: 3 });

    // The row resolved from the pack's count family, not from the key itself.
    expect(words).not.toBe('approvalsInbox.approverSlots');
    expect(words).toContain('3');
    expect(chips(panel).map((chip) => chip.textContent)).toEqual([`Dev Admin· ${words}`]);
    expect(panel.textContent).not.toContain('×');
    expect(within(panel).getByText(row('progressEligible', { count: 1 }))).toBeTruthy();
  });

  it('one person in two slots among others: only that chip carries the slot words', () => {
    const { panel } = mount(requestRow(['u_nina', 'u_dev_admin', 'u_dev_admin', 'u_lee']));

    expect(chips(panel).map((chip) => chip.textContent)).toEqual([
      'Nina Novak',
      `Dev Admin· ${row('approverSlots', { count: 2 })}`,
      'Lee Lin',
    ]);
    expect(within(panel).getByText(row('progressEligible', { count: 3 }))).toBeTruthy();
  });

  it('the zh pack draws its own words for the chip, beside its own eligible count', async () => {
    const zh = builtInLocales.zh.approvalsInbox as Record<string, string>;
    const en = builtInLocales.en.approvalsInbox as Record<string, string>;
    // zh selects `other` at every count.
    const zhWords = zh.approverSlots_other.replace('{{count}}', '3');
    expect(zhWords).not.toBe(en.approverSlots_other.replace('{{count}}', '3'));

    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
        <RecordContextProvider
          objectName="sys_approval_request"
          recordId="areq_12781"
          data={requestRow(['u_dev_admin', 'u_dev_admin', 'u_dev_admin'])}
        >
          <ApprovalDecisionRenderer />
        </RecordContextProvider>
      </I18nProvider>,
    );
    const panel = screen.getByTestId('approval-decision-panel');

    expect(
      (await within(panel).findAllByTestId('approver-chip')).map((chip) => chip.textContent),
    ).toEqual([`Dev Admin· ${zhWords}`]);
    expect(within(panel).getByText(zh.progressEligible_other.replace('{{count}}', '1'))).toBeTruthy();
  });
});
