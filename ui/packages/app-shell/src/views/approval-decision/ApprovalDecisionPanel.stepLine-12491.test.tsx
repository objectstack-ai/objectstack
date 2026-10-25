/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The approval decision panel draws the request's vertical step line
 * (objectui#12491, face 5 of ruling C on objectui#12438, the seat's Q1 A).
 *
 * The approval request page objectstack serves mounts `record:approval_decision`
 * over the request the approvals get route serves, and that row carries the
 * owning flow's `flow_steps`. The approvals inbox's request sheet draws them as
 * a vertical step line whenever there is more than one step, at any status;
 * the served page drew nothing. The panel now draws the line from the row it is
 * bound to, through `ApprovalStepLine`, the markup the business record's
 * approvals panel draws too.
 *
 * ## What is asserted
 *
 * The sheet's pin (`ApprovalsInboxPage.stepProgressVertical.test.tsx`, in the
 * console) is the behaviour to mirror, by hand and not by import: the sheet's
 * stepper is a frozen copy (ADR-0060 rule 3) and each side pins the contract
 * for itself. So the same layout contract is asserted over this panel's line:
 * a `flex-col` list named by the Approval Center's `stepProgress` pack row, one
 * listitem per step in order, no `shrink-0` row, every label `min-w-0` and none
 * `whitespace-nowrap`, no horizontal scroller and no breakpoint-prefixed layout
 * token in the subtree, the same classes at 2, 5, 6 and 12 steps, and each
 * connector tinted by the step it leads into.
 *
 * Then the panel's own gate, which is the sheet's and not the indicator's: a
 * one-step flow draws no line; a decided request and a `first_response` node,
 * neither of which carries a tally, still draw it.
 *
 * There is no CSSOM here, so these read the class contract Tailwind compiles,
 * not measured boxes, as the sheet's pin does. The declared actions bar is
 * doubled: what is under test is the line.
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

/**
 * The 6-step flow objectui#5554 was reported on, labels verbatim: eight to
 * sixteen CJK characters is an ordinary business step name, roughly double the
 * width of an English one, so these labels ARE the regime a row overflowed in.
 */
const REPORTED_STEPS: Step[] = [
  { id: 's1', label: '需求部门负责人初审', state: 'done' },
  { id: 's2', label: '工厂生产工艺负责人审核', state: 'done' },
  { id: 's3', label: '工厂业财审核（确认单价/派工工时）', state: 'current' },
  { id: 's4', label: '事业部成本改善经理加审', state: 'upcoming' },
  { id: 's5', label: '区域总经理+事业部业财运营总监会审', state: 'upcoming' },
  { id: 's6', label: '工厂厂长审批', state: 'upcoming' },
];

/** A synthetic flow of `n` steps, for the step-count invariance sweep. */
function stepsOfLength(n: number): Step[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `syn_${i}`,
    label: `区域总经理+事业部业财运营总监会审 ${i + 1}`,
    state: i === 0 ? 'current' : 'upcoming',
  })) as Step[];
}

/** The request as the approvals get serves it to the page, with the given steps. */
function requestRow(flow_steps: Step[] | undefined, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'areq_12491',
    process_name: 'flow:purchase',
    process_label: 'Purchase Approval',
    object_name: 'purchase_order',
    record_id: 'rec_1',
    status: 'pending',
    submitter_id: 'u_submitter',
    submitter_name: 'Zhou Ming',
    pending_approvers: [],
    viewer: { can_act: false, is_submitter: false, can_override: false },
    ...(flow_steps ? { flow_steps } : {}),
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

/** The panel's step line, found by its accessible name. */
const stepLine = (panel: HTMLElement) => within(panel).getByLabelText(STEP_LINE_NAME);
const queryStepLine = (panel: HTMLElement) => within(panel).queryByLabelText(STEP_LINE_NAME);

/** Class tokens of an element — `getAttribute` because SVG `className` is not a string. */
function tokens(el: Element): string[] {
  return (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
}

/**
 * Breakpoint-prefixed tokens in the families that could switch the axis back
 * to a row, reintroduce a scroller, or re-pin intrinsic width: a hit means some
 * viewport gets a layout no test here covers.
 */
const VIEWPORT_CONDITIONAL_LAYOUT =
  /^(?:sm|md|lg|xl|2xl|min-\[[^\]]+\]|max-\[[^\]]+\]):(?:flex-row|flex-col|flex|inline-flex|grid|overflow-x-[\w-]+|shrink-0|whitespace-nowrap|w-max|w-screen)$/;

/** Every invariant that makes each step reachable without a sideways drag. */
function expectVerticalStepLine(line: HTMLElement, expectedLabels: string[]): void {
  // 1. The steps stack; they do not queue across the width.
  expect(tokens(line)).toContain('flex-col');

  // 2. One row per step, each connector inside its row.
  const rows = within(line).getAllByRole('listitem');
  expect(rows).toHaveLength(expectedLabels.length);

  // 3. Every step, in order. Vacuous alone (a row that overflowed held every
  //    step too); it keeps the width assertions below off an empty list.
  expectedLabels.forEach((label, i) => {
    expect(rows[i]).toHaveTextContent(label);
  });

  // 4. No row pins its own width.
  for (const row of rows) {
    expect(tokens(row)).not.toContain('shrink-0');
  }

  // 5. Every label may shrink below its intrinsic width and wrap.
  for (const label of expectedLabels) {
    const el = within(line).getByText(label);
    expect(tokens(el)).toContain('min-w-0');
    expect(tokens(el)).not.toContain('whitespace-nowrap');
  }

  // 6. Nothing in the subtree is a horizontal scroller, and 7. no viewport
  //    gets its own layout.
  for (const el of [line, ...Array.from(line.querySelectorAll('*'))]) {
    for (const token of tokens(el)) {
      expect(token).not.toMatch(/^overflow-x-(auto|scroll)$/);
      expect(token).not.toMatch(VIEWPORT_CONDITIONAL_LAYOUT);
    }
  }
}

afterEach(() => {
  cleanup();
});

describe('ApprovalDecisionPanel — the vertical step line (objectui#12491)', () => {
  it('draws the reported 6-step CJK flow as a vertical line every step of which is reachable without a sideways drag', () => {
    const panel = mount(requestRow(REPORTED_STEPS));
    expectVerticalStepLine(stepLine(panel), REPORTED_STEPS.map((s) => s.label));
  });

  it('holds the same contract at the gate boundary (2 steps) and well past the report (12)', () => {
    for (const n of [2, 12]) {
      cleanup();
      const panel = mount(requestRow(stepsOfLength(n)));
      expectVerticalStepLine(stepLine(panel), stepsOfLength(n).map((s) => s.label));
    }
  });

  it('has no step-count regime: the layout classes are identical at 2, 5, 6 and 12 steps', () => {
    const shapes = [2, 5, 6, 12].map((n) => {
      cleanup();
      const line = stepLine(mount(requestRow(stepsOfLength(n))));
      const rows = within(line).getAllByRole('listitem');
      return {
        n,
        rowCount: rows.length,
        root: line.getAttribute('class'),
        firstRow: rows[0].getAttribute('class'),
        lastRow: rows[rows.length - 1].getAttribute('class'),
      };
    });
    expect(shapes.map((s) => [s.n, s.rowCount])).toEqual([[2, 2], [5, 5], [6, 6], [12, 12]]);
    expect(new Set(shapes.map((s) => s.root)).size).toBe(1);
    expect(new Set(shapes.map((s) => s.firstRow).concat(shapes.map((s) => s.lastRow))).size).toBe(1);
  });

  it('tints each connector by the step it leads INTO', () => {
    const rows = within(stepLine(mount(requestRow(REPORTED_STEPS)))).getAllByRole('listitem');
    const rail = (row: HTMLElement) =>
      Array.from(row.querySelectorAll('div')).find((d) => tokens(d).includes('w-px'));

    // A rail segment hangs below every step but the last.
    expect(rows.slice(0, -1).every((r) => rail(r) !== undefined)).toBe(true);
    expect(rail(rows[rows.length - 1])).toBeUndefined();

    // Rows 1 and 2 lead into s2 (done) and s3 (current); row 3 into s4 (upcoming).
    expect(tokens(rail(rows[0])!)).toContain('bg-emerald-300');
    expect(tokens(rail(rows[1])!)).toContain('bg-emerald-300');
    expect(tokens(rail(rows[2])!)).toContain('bg-border');
  });

  it('a decided request with 3 steps still draws its line: the gate is the step count, not the status', () => {
    const steps: Step[] = [
      { id: 'a', label: 'Manager review', state: 'done' },
      { id: 'b', label: 'Finance review', state: 'done' },
      { id: 'c', label: 'Director sign-off', state: 'done' },
    ];
    const panel = mount(requestRow(steps, { status: 'approved', decision_progress: undefined }));
    expect(within(panel).queryByRole('progressbar'), 'a decided request carries no tally').toBeNull();
    expectVerticalStepLine(stepLine(panel), steps.map((s) => s.label));
  });

  it('a pending first_response node, which carries no tally, still draws its line', () => {
    const panel = mount(requestRow(REPORTED_STEPS, { decision_progress: undefined }));
    expect(within(panel).queryByRole('progressbar')).toBeNull();
    expect(within(stepLine(panel)).getAllByRole('listitem')).toHaveLength(REPORTED_STEPS.length);
  });

  it('CONTROL: a one-step flow draws no line, and a row with no `flow_steps` draws none either', () => {
    const one = mount(requestRow([{ id: 'only', label: 'Manager review', state: 'current' }]));
    expect(queryStepLine(one)).toBeNull();
    expect(within(one).queryByRole('list')).toBeNull();
    expect(within(one).getByTestId('declared-actions-probe')).toBeTruthy();

    cleanup();
    const none = mount(requestRow(undefined));
    expect(queryStepLine(none)).toBeNull();
    expect(within(none).queryByRole('list')).toBeNull();
  });

  it('draws the line above the tally, and the tally above the decisions', () => {
    const panel = mount(requestRow(REPORTED_STEPS, { decision_progress: { behavior: 'quorum', got: 1, need: 2 } }));
    const line = stepLine(panel);
    const bar = within(panel).getByRole('progressbar');
    const actions = within(panel).getByTestId('declared-actions-probe');
    // DOCUMENT_POSITION_FOLLOWING: the argument comes after the receiver.
    expect(line.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bar.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
