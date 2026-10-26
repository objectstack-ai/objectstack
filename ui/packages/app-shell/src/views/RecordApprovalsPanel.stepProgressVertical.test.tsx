/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * RecordApprovalsPanel — the flow step strip is a VERTICAL stepper
 * (objectui#5554).
 *
 * ## The defect
 *
 * The strip was a single non-wrapping flex ROW whose steps were each
 * `shrink-0` and whose labels were `whitespace-nowrap`. Its min-content width
 * is therefore the SUM of every step, so intrinsic width grows without bound
 * with step count and label length. On a live 17.1.0 project a real 6-step
 * flow measured 1070px inside a 527px container. The console drawer's twin
 * had no scroller of its own and dragged the whole drawer sideways; THIS one
 * carried `overflow-x-auto`, so it scrolled itself — better, but the tail
 * steps still sat behind a scroll gesture with no visible affordance, and the
 * customer acceptance tester read the clipped strip as "there is no data".
 *
 * ## What is asserted, and why not "it renders"
 *
 * "The stepper renders" is green against the broken code too — every step was
 * always in the DOM; the clipping was layout. So the assertions below name the
 * defect's own property: **no element in the stepper may pin intrinsic width,
 * and no element may be a horizontal scroller** — i.e. every step is reachable
 * without dragging anything sideways. Concretely: the container stacks
 * (`flex-col`), each step owns a row, no row is `shrink-0`, every label is
 * `min-w-0` (a flex item defaults to `min-width:auto` = min-content, which is
 * exactly how a long label pushes a row past its container) and none is
 * `whitespace-nowrap`, and nothing in the subtree is an `overflow-x` scroller.
 *
 * ## Viewport and step-count coverage
 *
 * There is no CSSOM in this environment, so these read the class contract
 * Tailwind compiles rather than measured boxes. Every token asserted is named
 * for the exact CSS property whose value caused the reported overflow.
 *
 * Rather than sample two viewports, the suite pins the stronger fact that
 * makes sampling unnecessary: the stepper carries **no breakpoint-prefixed
 * axis, overflow or width-pinning class and no measurement**, so it has the
 * same layout at every viewport — there is no width at which an untested
 * branch takes over. The same argument is made for flow length by rendering
 * 2, 5, 6 and 12 steps and pinning that the layout classes are byte-identical
 * across all four: the reported failure regime (6 steps, the reporter's own
 * CJK labels, verbatim) is exercised directly, and the invariance test rules
 * out a count threshold that could put some other length back on the old path.
 *
 * No build artifact sits between the edit and this test — the root Vitest
 * config aliases every `@object-ui` specifier at that package's source.
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

/** The strip's accessible name, as the panel spells it through `tr`. */
const STEPPER_LABEL = 'Approval steps';

type Step = NonNullable<ApprovalRequestLite['flow_steps']>[number];

/**
 * The reporter's actual 6-step flow, labels verbatim (objectui#5554). They are
 * CJK on purpose and must not be "translated" to short English: eight to
 * sixteen CJK characters is an ordinary business step name and is roughly
 * double the rendered width of an eight-to-sixteen-character English one, so
 * these labels ARE the reported regime. Swapping them for English fixtures
 * would quietly move the fixture out of the failing regime.
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

function pendingWith(flow_steps: Step[]): ApprovalRequestLite {
  return {
    id: 'req_pending',
    process_name: 'flow:purchase',
    process_label: 'Purchase Approval',
    object_name: 'purchase_order',
    record_id: 'rec_1',
    status: 'pending',
    submitter_id: 'u_submitter',
    submitter_name: 'Zhou Ming',
    submitted_at: '2026-08-20T08:00:00Z',
    viewer: { can_act: false, is_submitter: false },
    flow_steps,
  };
}

function renderWithSteps(flow_steps: Step[]) {
  const pending = pendingWith(flow_steps);
  return render(
    <RecordApprovalsPanel
      approvals={{ available: true, requests: [pending], pendingRequest: pending }}
      currentUserId="u_viewer"
    />,
  );
}

/** Class tokens of an element — `getAttribute` because SVG `className` is not a string. */
function tokens(el: Element): string[] {
  return (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
}

/**
 * Breakpoint-prefixed tokens in the families that could switch the axis back
 * to a row, reintroduce a scroller, or re-pin intrinsic width. A hit means
 * some viewport gets behaviour no test here covers — which is the failure mode
 * this card exists to end.
 */
const VIEWPORT_CONDITIONAL_LAYOUT =
  /^(?:sm|md|lg|xl|2xl|min-\[[^\]]+\]|max-\[[^\]]+\]):(?:flex-row|flex-col|flex|inline-flex|grid|overflow-x-[\w-]+|shrink-0|whitespace-nowrap|w-max|w-screen)$/;

/**
 * Every invariant that makes the steps reachable without a sideways drag.
 * Shared by the console drawer's twin suite by hand rather than by import:
 * the two steppers live in different packages and are deliberately kept
 * identical, so each side pins the contract for itself.
 */
function expectVerticalStepperContract(stepper: HTMLElement, expectedLabels: string[]): void {
  // 1. Vertical axis — the steps stack; they do not queue across the width.
  expect(tokens(stepper)).toContain('flex-col');

  // 2. One row per step. Connectors live INSIDE a row, so no connector
  //    competes with a step for horizontal space (the old strip interleaved
  //    them as siblings of the row).
  const rows = within(stepper).getAllByRole('listitem');
  expect(rows).toHaveLength(expectedLabels.length);

  // 3. Every step is present, in order. Necessary but VACUOUS ALONE — the
  //    broken row rendered all of them too. It is here so the width
  //    assertions below cannot be satisfied by an empty stepper.
  expectedLabels.forEach((label, i) => {
    expect(rows[i]).toHaveTextContent(label);
  });

  // 4. No row pins its own width. `shrink-0` on the step rows is precisely
  //    what made the old strip's min-content width the sum of every step.
  for (const row of rows) {
    expect(tokens(row)).not.toContain('shrink-0');
  }

  // 5. Every label may shrink below its intrinsic width and wrap.
  for (const label of expectedLabels) {
    const el = within(stepper).getByText(label);
    expect(tokens(el)).toContain('min-w-0');
    expect(tokens(el)).not.toContain('whitespace-nowrap');
  }

  // 6. Nothing in the subtree is a horizontal scroller. The fix is that the
  //    content FITS — not that the reader may drag it into view, which is the
  //    half-measure the card explicitly rules out.
  for (const el of [stepper, ...Array.from(stepper.querySelectorAll('*'))]) {
    for (const token of tokens(el)) {
      expect(token).not.toMatch(/^overflow-x-(auto|scroll)$/);
    }
  }

  // 7. No viewport gets its own layout — see the regex's comment.
  for (const el of [stepper, ...Array.from(stepper.querySelectorAll('*'))]) {
    for (const token of tokens(el)) {
      expect(token).not.toMatch(VIEWPORT_CONDITIONAL_LAYOUT);
    }
  }
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  // The panel loads each request's action thread; an empty thread keeps this
  // suite about layout only.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }) as any));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('RecordApprovalsPanel — vertical step stepper (objectui#5554)', () => {
  it('lays out the reported 6-step CJK flow so every step is reachable without a sideways drag', () => {
    renderWithSteps(REPORTED_STEPS);
    const stepper = screen.getByLabelText(STEPPER_LABEL);
    expectVerticalStepperContract(stepper, REPORTED_STEPS.map((s) => s.label));
  });

  it('holds the same contract at the guard boundary (2 steps) and well past the report (12)', () => {
    for (const n of [2, 12]) {
      cleanup();
      renderWithSteps(stepsOfLength(n));
      const stepper = screen.getByLabelText(STEPPER_LABEL);
      expectVerticalStepperContract(stepper, stepsOfLength(n).map((s) => s.label));
    }
  });

  it('has no step-count regime: the layout classes are identical at 2, 5, 6 and 12 steps', () => {
    const shapes = [2, 5, 6, 12].map((n) => {
      cleanup();
      renderWithSteps(stepsOfLength(n));
      const stepper = screen.getByLabelText(STEPPER_LABEL);
      const rows = within(stepper).getAllByRole('listitem');
      return {
        n,
        rowCount: rows.length,
        root: stepper.getAttribute('class'),
        firstRow: rows[0].getAttribute('class'),
        lastRow: rows[rows.length - 1].getAttribute('class'),
      };
    });

    // Every flow length renders one row per step...
    expect(shapes.map((s) => [s.n, s.rowCount])).toEqual([[2, 2], [5, 5], [6, 6], [12, 12]]);
    // ...through the SAME layout. A count threshold that put long flows (or
    // short ones) back on a horizontal row would show up here as a difference,
    // and that threshold is the "works at one length, breaks at another" shape
    // this card rules out.
    const distinctRoots = new Set(shapes.map((s) => s.root));
    const distinctRows = new Set(shapes.map((s) => s.firstRow).concat(shapes.map((s) => s.lastRow)));
    expect([...distinctRoots]).toHaveLength(1);
    expect([...distinctRows]).toHaveLength(1);
  });

  it('keeps the connector tint keyed to the step it leads INTO, as the horizontal strip did', () => {
    renderWithSteps(REPORTED_STEPS);
    const rows = within(screen.getByLabelText(STEPPER_LABEL)).getAllByRole('listitem');

    // A rail segment hangs below every step but the last.
    const rail = (row: HTMLElement) =>
      Array.from(row.querySelectorAll('div')).find((d) => tokens(d).includes('w-px'));
    expect(rows.slice(0, -1).every((r) => rail(r) !== undefined)).toBe(true);
    expect(rail(rows[rows.length - 1])).toBeUndefined();

    // s2 (done) and s3 (current) are the steps rows 1 and 2 lead into, so
    // those segments are green; s4 is upcoming, so row 2's successor is not.
    expect(tokens(rail(rows[0])!)).toContain('bg-emerald-300');
    expect(tokens(rail(rows[1])!)).toContain('bg-emerald-300');
    expect(tokens(rail(rows[2])!)).toContain('bg-border');
  });
});
