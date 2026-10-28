/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record's step line draws the route the approvals get serves for the
 * pending request, `flow_route`, never the flow graph's trunk (objectstack#26668,
 * objectstack#26563).
 *
 * ## The defect
 *
 * The line drew the pending row's `flow_steps`, the trunk the server walks
 * from the flow's start (`approve`, then `true`, then the first edge). A
 * hotclm contract the gateway routed to the finance-only rung read "直属上级 ·
 * 法务负责人 + 财务负责人（会签） · 分管领导 · 总经理" while it waited on the finance
 * controller. #26563 stopped drawing the trunk and rebuilt the line from the
 * request rows the panel's list read holds; the server now serves the route
 * itself, so the panel draws that and re-derives nothing.
 *
 * ## What is asserted
 *
 * The reported route and a route with steps ahead are drawn as served. A
 * viewer the list read serves only the pending row still sees the whole
 * route, because the route no longer comes from the list. A server that
 * serves no route draws no line, however the trunk reads. Every case carries
 * the served trunk too, so a regression to drawing it turns the case red.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import type { ApprovalRequestLite } from '../hooks/useRecordApprovals';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthenticatedFetch: () => vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { RecordApprovalsPanel } from './RecordApprovalsPanel';

/** The line's accessible name, as the panel spells it through `tr`. */
const STEP_LINE_NAME = 'Approval steps';

/** The reported flow's rungs, labels verbatim from the hotclm report. */
const MANAGER = '直属上级';
const JOINT = '法务负责人 + 财务负责人（会签）';
const FINANCE = '财务负责人';
const EXECUTIVE = '分管领导';
const GM = '总经理';

type Route = NonNullable<ApprovalRequestLite['flow_route']>;

/** What the server serves as `flow_steps` for this flow's off-trunk request: its trunk, all upcoming. */
const SERVED_TRUNK: NonNullable<ApprovalRequestLite['flow_steps']> = [
  { id: 'manager_review', label: MANAGER, state: 'upcoming' },
  { id: 'legal_finance_joint', label: JOINT, state: 'upcoming' },
  { id: 'executive_signoff', label: EXECUTIVE, state: 'upcoming' },
  { id: 'gm_signoff', label: GM, state: 'upcoming' },
];

/** The route the server serves for the reported request: manager passed, finance current, a gateway ahead. */
const REPORTED_ROUTE: Route = {
  steps: [
    { id: 'manager_review', label: MANAGER, state: 'done' },
    { id: 'finance_only', label: FINANCE, state: 'current' },
  ],
  ahead: 'undecided',
};

let seq = 0;

/** A request the run opened at `node`, at minute `minute` of the run. */
function req(node: string, label: string, status: string, minute: number): ApprovalRequestLite {
  seq += 1;
  return {
    id: `req_${seq}`,
    process_name: 'flow:contract_approval',
    process_label: '合同审批',
    object_name: 'contract',
    record_id: 'ctr_1',
    status,
    submitter_id: 'u_submitter',
    submitted_at: `2026-10-27T08:${String(minute).padStart(2, '0')}:00Z`,
    flow_run_id: 'run_1',
    flow_node_id: node,
    current_step: node,
    step_label: label,
    viewer: { can_act: false, is_submitter: false },
  };
}

/** The panel over `requests`, `pending` enriched as the get serves it: the trunk, and `route` when served. */
function renderPanel(requests: ApprovalRequestLite[], pending: ApprovalRequestLite, route?: Route) {
  const enriched = { ...pending, flow_steps: SERVED_TRUNK, ...(route ? { flow_route: route } : {}) };
  const rows = requests.map((r) => (r.id === pending.id ? enriched : r));
  return render(
    <RecordApprovalsPanel
      approvals={{ available: true, requests: [...rows].reverse(), pendingRequest: enriched }}
      currentUserId="u_viewer"
    />,
  );
}

/** Each drawn step's label, in order. */
function lineLabels(): string[] {
  const line = screen.getByLabelText(STEP_LINE_NAME);
  // A row is the marker column, then the label.
  return within(line).getAllByRole('listitem').map((li) => li.children[1]?.textContent ?? '');
}

beforeEach(() => {
  cleanup();
  seq = 0;
  // The panel loads each request's action thread; an empty thread keeps this
  // suite about the step line.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }) as any));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('RecordApprovalsPanel — the step line draws the served route (objectstack#26668)', () => {
  it('the reported route, manager then finance only, draws those two rungs and nothing of the trunk', () => {
    const manager = req('manager_review', MANAGER, 'approved', 0);
    const finance = req('finance_only', FINANCE, 'pending', 5);
    renderPanel([manager, finance], finance, REPORTED_ROUTE);

    expect(lineLabels()).toEqual([MANAGER, FINANCE]);
    const line = screen.getByLabelText(STEP_LINE_NAME);
    for (const rung of [JOINT, EXECUTIVE, GM]) {
      expect(within(line).queryByText(rung)).toBeNull();
    }
    // The pending rung is the current one: bold, numbered, not checked.
    const rows = within(line).getAllByRole('listitem');
    expect(within(rows[1]).getByText(FINANCE).className).toContain('font-medium');
    expect(rows[1]).toHaveTextContent('2');
  });

  it('the steps ahead that the server serves are drawn upcoming, after the pending one', () => {
    const manager = req('manager_review', MANAGER, 'pending', 0);
    renderPanel([manager], manager, {
      steps: [
        { id: 'manager_review', label: MANAGER, state: 'current' },
        { id: 'gm_signoff', label: GM, state: 'upcoming' },
      ],
      ahead: 'end',
    });
    expect(lineLabels()).toEqual([MANAGER, GM]);
    const rows = within(screen.getByLabelText(STEP_LINE_NAME)).getAllByRole('listitem');
    expect(within(rows[1]).getByText(GM).className).toContain('text-muted-foreground');
    expect(rows[1]).toHaveTextContent('2');
  });

  it('a viewer the list serves only the pending request still sees the whole route: it comes from the get', () => {
    // The list read serves a request only to its participants: the finance
    // controller took no part in the manager's rung and is not served it.
    const finance = req('finance_only', FINANCE, 'pending', 5);
    renderPanel([finance], finance, REPORTED_ROUTE);
    expect(lineLabels()).toEqual([MANAGER, FINANCE]);
  });

  it('a server that serves no route draws no line, whatever the trunk reads', () => {
    const manager = req('manager_review', MANAGER, 'approved', 0);
    const finance = req('finance_only', FINANCE, 'pending', 5);
    renderPanel([manager, finance], finance);
    expect(screen.queryByLabelText(STEP_LINE_NAME)).toBeNull();
  });

  it('a one-step route draws no line', () => {
    const manager = req('manager_review', MANAGER, 'pending', 0);
    renderPanel([manager], manager, { steps: [{ id: 'manager_review', label: MANAGER, state: 'current' }], ahead: 'undecided' });
    expect(screen.queryByLabelText(STEP_LINE_NAME)).toBeNull();
  });
});
