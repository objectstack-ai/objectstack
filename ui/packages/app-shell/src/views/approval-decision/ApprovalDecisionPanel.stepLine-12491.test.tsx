/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The approval decision panel draws NO step line (objectstack#26563).
 *
 * The panel used to draw the bound row's `flow_steps` through
 * `ApprovalStepLine` (objectui#12491). That field is the flow graph's trunk:
 * the server walks the flow from its start preferring `approve`, then `true`,
 * then the first edge. So a request a decision routed elsewhere was drawn on
 * rungs it never visits. The reported case, hotclm's `contract_approval`
 * routed manager → finance only, read "直属上级 · 法务负责人 + 财务负责人（会签） ·
 * 分管领导 · 总经理" while the request waited on the finance controller.
 *
 * The bound row proves only its own step, which the page's header names, and
 * one step is no line, so the panel draws none until the approvals read
 * serves the route the run takes.
 *
 * ## What is asserted
 *
 * The reported row, served trunk and all, draws no step line and none of the
 * trunk's rungs; a decided row draws none either; the panel's other parts
 * still draw, in their order. The step line's own layout contract (vertical,
 * no width pinning, no scroller, the same classes at every step count, the
 * connector tint) is pinned where the line is still drawn, over the same
 * `ApprovalStepLine` markup: `RecordApprovalsPanel.stepProgressVertical.test.tsx`.
 * The declared actions bar is doubled.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

vi.mock('../DeclaredActionsBar.js', () => ({
  DeclaredActionsBar: () => <div data-testid="declared-actions-probe" />,
}));

import { RecordContextProvider } from '@object-ui/react';
import { builtInLocales } from '@object-ui/i18n/locales';
import { ApprovalDecisionRenderer } from './ApprovalDecisionPanel';
import type { ApprovalRequestLite } from '../../hooks/useRecordApprovals';

type Step = NonNullable<ApprovalRequestLite['flow_steps']>[number];

/** The line's accessible name: the `en` pack's `approvalsInbox.stepProgress` row. */
const STEP_LINE_NAME = (builtInLocales as unknown as { en: { approvalsInbox: { stepProgress: string } } })
  .en.approvalsInbox.stepProgress;

/** The reported route's rungs, labels verbatim from the hotclm report. */
const MANAGER = '直属上级';
const JOINT = '法务负责人 + 财务负责人（会签）';
const EXECUTIVE = '分管领导';
const GM = '总经理';
const FINANCE = '财务负责人';

/**
 * The trunk `attachFlowSteps` served for that request: its walk takes the
 * first branch of the routing decision, so the request's own node
 * (`finance_only`) is not on it and nothing is marked current.
 */
const SERVED_TRUNK: Step[] = [
  { id: 'manager_review', label: MANAGER, state: 'upcoming' },
  { id: 'legal_finance_joint', label: JOINT, state: 'upcoming' },
  { id: 'executive_signoff', label: EXECUTIVE, state: 'upcoming' },
  { id: 'gm_signoff', label: GM, state: 'upcoming' },
];

/** The request as the approvals get serves it to the page. */
function requestRow(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'areq_26563',
    process_name: 'flow:contract_approval',
    process_label: '合同审批',
    object_name: 'contract',
    record_id: 'ctr_1',
    status: 'pending',
    submitter_id: 'u_submitter',
    submitter_name: 'Zhou Ming',
    flow_run_id: 'run_1',
    flow_node_id: 'finance_only',
    current_step: 'finance_only',
    step_label: FINANCE,
    pending_approvers: [],
    viewer: { can_act: false, is_submitter: false, can_override: false },
    flow_steps: SERVED_TRUNK,
    ...extra,
  };
}

function mount(data: Record<string, unknown>): HTMLElement {
  render(
    <RecordContextProvider objectName="sys_approval_request" recordId={String(data.id)} data={data}>
      <ApprovalDecisionRenderer />
    </RecordContextProvider>,
  );
  return screen.getByTestId('approval-decision-panel');
}

afterEach(() => {
  cleanup();
});

describe('ApprovalDecisionPanel — no guessed step line (objectstack#26563)', () => {
  it('the reported request, served with its flow trunk, draws no step line and none of the trunk\'s rungs', () => {
    const panel = mount(requestRow());
    expect(within(panel).queryByLabelText(STEP_LINE_NAME)).toBeNull();
    expect(within(panel).queryByRole('list')).toBeNull();
    for (const rung of [MANAGER, JOINT, EXECUTIVE, GM]) {
      expect(within(panel).queryByText(rung)).toBeNull();
    }
    expect(within(panel).getByTestId('declared-actions-probe')).toBeTruthy();
  });

  it('a decided request whose trunk the server marked all done draws no step line either', () => {
    const panel = mount(requestRow({
      status: 'approved',
      flow_steps: SERVED_TRUNK.map((s) => ({ ...s, state: 'done' })),
    }));
    expect(within(panel).queryByLabelText(STEP_LINE_NAME)).toBeNull();
    expect(within(panel).queryByRole('list')).toBeNull();
  });

  it('CONTROL: the tally still draws, above the decisions', () => {
    const panel = mount(requestRow({ decision_progress: { behavior: 'quorum', got: 1, need: 2 } }));
    const bar = within(panel).getByRole('progressbar');
    const actions = within(panel).getByTestId('declared-actions-probe');
    // DOCUMENT_POSITION_FOLLOWING: the argument comes after the receiver.
    expect(bar.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(panel).queryByLabelText(STEP_LINE_NAME)).toBeNull();
  });
});
