/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The approval decision panel marks a request no person submitted with the
 * flow origin (objectui#12491, face 5 of ruling C on objectui#12438, the seat's
 * Q2 A and Q3 A).
 *
 * A flow run with no user context opens a request whose `submitter_id` is null
 * (ADR-0118 D1), and the approvals get serves that null as an absent key. On
 * the page objectstack serves, the highlights strip hides a value-less
 * Submitter chip, so the request showed no submitter and no origin. The
 * approvals inbox's request sheet marks such a request "Flow-initiated"; the
 * panel now marks it the same way, with the same pack row.
 *
 * ## The shape asserted is the contract's, not the sheet fixture's
 *
 * The sheet's characterization pin drives its marker with a `flow:` sentinel
 * id, a shape no writer produces and the contract does not admit. Here the
 * marker is asserted on the contract's two spellings of "no submitter": the key
 * absent (what the approvals get serves) and the key null. A `flow:`-prefixed
 * id is a CONTROL that draws no marker: the panel ports no prefix branch, so a
 * sentinel would be a producer defect to fix at the producer (AGENTS.md #0.1),
 * not a second spelling to tolerate here.
 *
 * Each label is asserted as the pack row the panel reads, never as English
 * copy. The declared actions bar is doubled: what is under test is the marker.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

vi.mock('../DeclaredActionsBar.js', () => ({
  DeclaredActionsBar: () => <div data-testid="declared-actions-probe" />,
}));

import { RecordContextProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { ApprovalDecisionRenderer } from './ApprovalDecisionPanel';

/** A pack's `approvalsInbox.flowOrigin` row. */
const flowOrigin = (language: string): string =>
  (builtInLocales as unknown as Record<string, { approvalsInbox: { flowOrigin: string } }>)[language]
    .approvalsInbox.flowOrigin;

/** The request as the approvals get serves it, before the submitter is chosen. */
const BASE_ROW = {
  id: 'areq_12491',
  process_name: 'flow:budget_escalation',
  process_label: 'Budget Escalation',
  object_name: 'showcase_purchase',
  record_id: 'po_1',
  status: 'pending',
  pending_approvers: [],
  viewer: { can_act: true, is_submitter: false, can_override: false },
};

/** The served row with no `submitter_id` key: the approvals get's spelling of a null column. */
const FLOW_ROW: Record<string, unknown> = { ...BASE_ROW };

function mount(data: Record<string, unknown>, wrap?: (node: React.ReactElement) => React.ReactElement): HTMLElement {
  const node = (
    <RecordContextProvider objectName="sys_approval_request" recordId={String(data.id)} data={data}>
      <ApprovalDecisionRenderer />
    </RecordContextProvider>
  );
  render(wrap ? wrap(node) : node);
  return screen.getByTestId('approval-decision-panel');
}

const marker = (panel: HTMLElement) => within(panel).queryByTestId('approval-decision-flow-origin');

afterEach(() => {
  cleanup();
});

describe('ApprovalDecisionPanel — the flow origin of a request no person submitted (objectui#12491)', () => {
  it('a served row with no `submitter_id` key is marked with the flowOrigin pack row', () => {
    expect('submitter_id' in FLOW_ROW).toBe(false);
    const panel = mount(FLOW_ROW);
    expect(marker(panel)?.textContent).toBe(flowOrigin('en'));
  });

  it('a row whose `submitter_id` is null is marked the same way', () => {
    const panel = mount({ ...BASE_ROW, submitter_id: null });
    expect(marker(panel)?.textContent).toBe(flowOrigin('en'));
  });

  it('a decided request is still marked: the origin is a fact about the request, at any status', () => {
    const panel = mount({ ...BASE_ROW, status: 'approved' });
    expect(marker(panel)?.textContent).toBe(flowOrigin('en'));
  });

  it('draws the active language: the zh pack row under a zh provider', () => {
    const panel = mount(FLOW_ROW, (node) => (
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
        {node}
      </I18nProvider>
    ));
    expect(marker(panel)?.textContent).toBe(flowOrigin('zh'));
    expect(flowOrigin('zh')).not.toBe(flowOrigin('en'));
  });

  it('CONTROL: a request a person submitted carries no marker', () => {
    const panel = mount({ ...BASE_ROW, submitter_id: 'usr_qFpo8Zk2LmN4pR7t', submitter_name: 'Ada Lovelace' });
    expect(marker(panel)).toBeNull();
    expect(panel.textContent).not.toContain(flowOrigin('en'));
    expect(within(panel).getByTestId('declared-actions-probe')).toBeTruthy();
  });

  it('CONTROL: a `flow:`-prefixed submitter id is not read as a flow origin; no prefix branch is ported', () => {
    const panel = mount({ ...BASE_ROW, submitter_id: 'flow:budget_escalation' });
    expect(marker(panel)).toBeNull();
    expect(panel.textContent).not.toContain(flowOrigin('en'));
  });
});
