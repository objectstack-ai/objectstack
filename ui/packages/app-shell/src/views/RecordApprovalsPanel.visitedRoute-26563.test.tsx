/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record's step line draws the route the request's run took, never the
 * flow graph's trunk (objectstack#26563).
 *
 * ## The defect
 *
 * The line drew the pending row's `flow_steps`, which the server builds by
 * walking the flow from its start, preferring `approve`, then `true`, then the
 * first edge. hotclm's `contract_approval` routes a contract after the
 * manager to one of three rungs (legal + finance jointly, legal only, finance
 * only, or none), then to two optional sign-offs. A contract routed to the
 * finance-only rung read "直属上级 · 法务负责人 + 财务负责人（会签） · 分管领导 ·
 * 总经理" while it waited on the finance controller: a rung it is not on, and
 * two rungs its route flags skip.
 *
 * ## What is asserted
 *
 * The line is built from the run's own request rows: the steps the run has
 * passed (approved, opened before the pending one), then the pending one, and
 * nothing ahead of it. The reported route, a route that rejoins the trunk after
 * a side rung, and the edges of "passed" (another run, a step not approved, a
 * later round of the same node, a row opened after the pending one) are each
 * pinned, on the panel and on `visitedApprovalSteps` itself. Every case carries
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

import { RecordApprovalsPanel, visitedApprovalSteps } from './RecordApprovalsPanel';

/** The line's accessible name, as the panel spells it through `tr`. */
const STEP_LINE_NAME = 'Approval steps';

/** The reported flow's rungs, labels verbatim from the hotclm report. */
const MANAGER = '直属上级';
const JOINT = '法务负责人 + 财务负责人（会签）';
const LEGAL = '法务负责人';
const FINANCE = '财务负责人';
const EXECUTIVE = '分管领导';
const GM = '总经理';

/** What the server serves as `flow_steps` for every request of this flow: its trunk. */
const SERVED_TRUNK: NonNullable<ApprovalRequestLite['flow_steps']> = [
  { id: 'manager_review', label: MANAGER, state: 'upcoming' },
  { id: 'legal_finance_joint', label: JOINT, state: 'upcoming' },
  { id: 'executive_signoff', label: EXECUTIVE, state: 'upcoming' },
  { id: 'gm_signoff', label: GM, state: 'upcoming' },
];

let seq = 0;

/** A request the run opened at `node`, at minute `minute` of the run. */
function req(
  node: string,
  label: string,
  status: string,
  minute: number,
  extra: Partial<ApprovalRequestLite> = {},
): ApprovalRequestLite {
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
    ...extra,
  };
}

/** The panel over `requests` (newest first, as the hook hands them), `pending` enriched with the trunk. */
function renderPanel(requests: ApprovalRequestLite[], pending: ApprovalRequestLite) {
  const enriched = { ...pending, flow_steps: SERVED_TRUNK };
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

describe('RecordApprovalsPanel — the step line draws the route the run took (objectstack#26563)', () => {
  it('the reported route, manager then finance only, draws those two rungs and nothing of the trunk', () => {
    const manager = req('manager_review', MANAGER, 'approved', 0);
    const finance = req('finance_only', FINANCE, 'pending', 5);
    renderPanel([manager, finance], finance);

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

  it('a route that rejoins the trunk after a side rung draws the side rung, not the trunk\'s', () => {
    const manager = req('manager_review', MANAGER, 'approved', 0);
    const legal = req('legal_only', LEGAL, 'approved', 5);
    const executive = req('executive_signoff', EXECUTIVE, 'pending', 9);
    renderPanel([manager, legal, executive], executive);

    expect(lineLabels()).toEqual([MANAGER, LEGAL, EXECUTIVE]);
    expect(within(screen.getByLabelText(STEP_LINE_NAME)).queryByText(JOINT)).toBeNull();
  });

  it('a request at its run\'s first rung draws no line: one step is no line, and nothing ahead is drawn', () => {
    const manager = req('manager_review', MANAGER, 'pending', 0);
    renderPanel([manager], manager);
    expect(screen.queryByLabelText(STEP_LINE_NAME)).toBeNull();
  });

  it('a viewer served only the pending request draws no line rather than a guessed one', () => {
    // The list read serves a request only to its participants: the finance
    // controller took no part in the manager's rung and is not served it.
    const finance = req('finance_only', FINANCE, 'pending', 5);
    renderPanel([finance], finance);
    expect(screen.queryByLabelText(STEP_LINE_NAME)).toBeNull();
  });
});

describe('visitedApprovalSteps — what counts as a passed step (objectstack#26563)', () => {
  it('orders passed steps by when the run reached them, the pending one last', () => {
    const executive = req('executive_signoff', EXECUTIVE, 'pending', 9);
    const legal = req('legal_only', LEGAL, 'approved', 5);
    const manager = req('manager_review', MANAGER, 'approved', 0);
    expect(visitedApprovalSteps(executive, [executive, legal, manager])).toEqual([
      { id: 'manager_review', label: MANAGER, state: 'done' },
      { id: 'legal_only', label: LEGAL, state: 'done' },
      { id: 'executive_signoff', label: EXECUTIVE, state: 'current' },
    ]);
  });

  it('leaves out another run\'s requests, a step not approved, and a row opened after the pending one', () => {
    const pending = req('finance_only', FINANCE, 'pending', 5);
    const rows = [
      req('manager_review', MANAGER, 'approved', 0),
      req('legal_finance_joint', JOINT, 'approved', 1, { flow_run_id: 'run_0' }),
      req('legal_only', LEGAL, 'returned', 2),
      req('executive_signoff', EXECUTIVE, 'rejected', 3),
      req('gm_signoff', GM, 'approved', 7),
      pending,
    ];
    expect(visitedApprovalSteps(pending, rows).map((s) => s.id)).toEqual(['manager_review', 'finance_only']);
  });

  it('draws a step approved in several rounds once, where its latest round sits', () => {
    const pending = req('executive_signoff', EXECUTIVE, 'pending', 9);
    const rows = [
      req('manager_review', MANAGER, 'approved', 0),
      req('finance_only', FINANCE, 'approved', 2),
      req('manager_review', MANAGER, 'approved', 4, { round: 2 }),
      pending,
    ];
    expect(visitedApprovalSteps(pending, rows).map((s) => s.id)).toEqual(['finance_only', 'manager_review', 'executive_signoff']);
  });

  it('leaves out an earlier round of the pending step itself', () => {
    const pending = req('finance_only', FINANCE, 'pending', 9, { round: 2 });
    const rows = [req('manager_review', MANAGER, 'approved', 0), req('finance_only', FINANCE, 'approved', 2), pending];
    expect(visitedApprovalSteps(pending, rows).map((s) => s.id)).toEqual(['manager_review', 'finance_only']);
  });

  it('marks an approved request\'s own step done', () => {
    const decided = req('finance_only', FINANCE, 'approved', 5);
    const rows = [req('manager_review', MANAGER, 'approved', 0), decided];
    expect(visitedApprovalSteps(decided, rows).map((s) => s.state)).toEqual(['done', 'done']);
  });

  it('names a step with no label by its node, prettified', () => {
    const pending = req('finance_only', FINANCE, 'pending', 5);
    const unlabeled = req('manager_review', '', 'approved', 0, { step_label: undefined });
    expect(visitedApprovalSteps(pending, [unlabeled, pending])[0].label).toBe('Manager Review');
  });

  it('CONTROL: a row without a run, a node or an open time, or no row at all, has no line', () => {
    const manager = req('manager_review', MANAGER, 'approved', 0);
    for (const missing of ['flow_run_id', 'flow_node_id', 'submitted_at'] as const) {
      const pending = req('finance_only', FINANCE, 'pending', 5, { [missing]: undefined });
      expect(visitedApprovalSteps(pending, [manager, pending])).toEqual([]);
    }
    expect(visitedApprovalSteps(null, [manager])).toEqual([]);
  });
});
