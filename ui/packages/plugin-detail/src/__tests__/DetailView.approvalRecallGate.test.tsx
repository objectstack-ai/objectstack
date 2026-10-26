/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DetailView } from '../DetailView';
import { InlineEditProvider, type ApprovalProgress } from '@object-ui/react';
import type { DetailViewSchema } from '@object-ui/types';

/**
 * Recall is the SUBMITTER's lever — the approval band must not offer it to
 * anyone else (objectui#6464).
 *
 * Field report on `@objectstack/*@17.2.0`: user B opens a record user A put
 * into approval. B is not the submitter and not an admin, and the band still
 * lit its recall button. The click cannot succeed — the recall endpoint
 * authorizes on submitter identity and refuses everyone else — so the only
 * thing the button could produce was a failure toast. Same
 * writability-feedback mismatch family as objectui#3794.
 *
 * The gate is FEEDBACK, not permission: nothing here changes what the server
 * allows, and the band, its tally and the approvals timeline still tell a
 * non-submitter exactly what state the record is in. Only the lever they can
 * never pull is withdrawn — the same choice the sibling submitter levers
 * already make (the approvals panel's Remind button is hidden, and the
 * declared `approval_recall` action gates through a `visible` predicate).
 *
 * The two failure modes are OPPOSITE and both are pinned below:
 *   1. still lit for a non-submitter  — the defect;
 *   2. hidden from the actual submitter — a regression that would remove the
 *      only lever for unlocking one's own record.
 * Plus the case that decides how much of the fleet this can break: a host that
 * threads NO submitter identity at all (`undefined`), which must render exactly
 * as it did before this gate existed.
 */

const RECALL = /Recall approval/;

const baseSchema: DetailViewSchema = {
  type: 'detail-view',
  title: 'Budget',
  objectName: 'budget',
  // The band renders only when DetailView's own header is suppressed (composed
  // under a Lightning-style page header) and inline editing is on.
  showHeader: false,
  data: { id: 'B1', name: 'Q3 Budget' },
  sections: [{ title: 'Basics', fields: [{ name: 'name', label: 'Name' }] }],
};

/** A quorum tally, so every case below has a second control to measure against. */
const QUORUM: ApprovalProgress = { behavior: 'quorum', got: 1, need: 2 };

/**
 * A DataSource that speaks recall. `cancelPendingApproval`'s PRESENCE is the
 * pre-existing gate — an adapter that cannot recall never offered the button —
 * so it is supplied everywhere except the one case that pins the two gates are
 * ANDed rather than swapped.
 */
function makeDataSource(overrides: Record<string, unknown> = {}) {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => null),
    cancelPendingApproval: vi.fn(async () => ({ requestId: 'r1', status: 'recalled' })),
    ...overrides,
  } as any;
}

function renderBand(
  providerProps: {
    locked?: boolean;
    approvalPending?: boolean;
    approvalIsSubmitter?: boolean;
    approvalProgress?: ApprovalProgress;
    canEdit?: boolean;
  },
  dataSource: any = makeDataSource(),
) {
  return render(
    <InlineEditProvider canEdit={providerProps.canEdit ?? false} {...providerProps}>
      <DetailView schema={baseSchema} dataSource={dataSource} inlineEdit />
    </InlineEditProvider>,
  );
}

/**
 * Every absence assertion below is paired with these. "The button is not in the
 * document" is also true of a panel that never rendered, or a band whose
 * pending state never engaged — in which case the assertion passes while
 * measuring nothing. Asserting the band and its tally in the SAME query turns
 * the absence into a measurement.
 */
function expectBandRendered(label: string) {
  expect(screen.getByRole('status'), 'band must render').toBeInTheDocument();
  expect(screen.getByText(label)).toBeInTheDocument();
  expect(screen.getByRole('progressbar'), 'tally must render').toBeInTheDocument();
}

describe('DetailView – recall is the submitter\'s lever (objectui#6464)', () => {
  /**
   * THE DEFECT. A non-submitter viewing a pending record: old and new
   * behaviour disagree here and nowhere else, so this is the cell that decides
   * whether the fix is present at all.
   */
  it('withdraws recall from a non-submitter on a pending record', () => {
    renderBand({
      locked: false,
      approvalPending: true,
      approvalIsSubmitter: false,
      approvalProgress: QUORUM,
    });

    expectBandRendered('In approval · editable');
    expect(screen.queryByRole('button', { name: RECALL })).not.toBeInTheDocument();
  });

  /**
   * THE OPPOSITE FAILURE. The submitter must keep the lever — a gate that
   * hides recall from everyone would pass the test above and still be a
   * regression, because recall is the submitter's only way to unlock a record
   * they themselves sent into approval.
   */
  it('keeps recall for the submitter of the same pending record', () => {
    renderBand({
      locked: false,
      approvalPending: true,
      approvalIsSubmitter: true,
      approvalProgress: QUORUM,
    });

    expectBandRendered('In approval · editable');
    const btn = screen.getByRole('button', { name: RECALL });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeEnabled();
  });

  /**
   * The host that resolves no approval identity — a backend with no approvals
   * API, whose band runs off the record's own `approval_status` mirror. It
   * threads `undefined`, and `undefined` is UNKNOWN, not "no": behaviour is
   * exactly what it was before this signal existed. Reading absent information
   * as a denial would silently take recall away from every such host's
   * submitter, trading a cosmetic defect for a functional loss.
   */
  it('offers recall unchanged when the host threads no submitter identity', () => {
    renderBand({ locked: false, approvalPending: true, approvalProgress: QUORUM });

    expectBandRendered('In approval · editable');
    expect(screen.getByRole('button', { name: RECALL })).toBeInTheDocument();
  });

  /**
   * The gate is about the APPROVAL, not the lock — recall survives on a
   * `lockRecord: false` node (objectui#2902) and must be withdrawn on a locked
   * one just the same. Running both cells stops the new gate from accidentally
   * riding on `locked`.
   */
  it('withdraws recall from a non-submitter on a LOCKED record too', () => {
    renderBand({
      locked: true,
      approvalPending: true,
      approvalIsSubmitter: false,
      approvalProgress: QUORUM,
    });

    expectBandRendered('Locked for approval');
    expect(screen.queryByRole('button', { name: RECALL })).not.toBeInTheDocument();
  });

  it('keeps recall for the submitter on a LOCKED record', () => {
    renderBand({
      locked: true,
      approvalPending: true,
      approvalIsSubmitter: true,
      approvalProgress: QUORUM,
    });

    expectBandRendered('Locked for approval');
    expect(screen.getByRole('button', { name: RECALL })).toBeInTheDocument();
  });

  /**
   * The two gates are ANDed, not swapped. An adapter with no
   * `cancelPendingApproval` never offered recall, and being the submitter does
   * not conjure a recall the DataSource cannot perform.
   */
  it('still offers no recall to the submitter when the adapter cannot recall', () => {
    renderBand(
      { locked: true, approvalPending: true, approvalIsSubmitter: true, approvalProgress: QUORUM },
      makeDataSource({ cancelPendingApproval: undefined }),
    );

    expectBandRendered('Locked for approval');
    expect(screen.queryByRole('button', { name: RECALL })).not.toBeInTheDocument();
  });

  /**
   * The verdict is LIVE, and the same mount must follow it both ways.
   *
   * `viewer.is_submitter` arrives with the enriched pending row, one render
   * after the band first engages, so a gate that only reads its prop at mount —
   * or a context value memoized without the new signal in its dependency list —
   * would show the correct thing on a fresh page and the stale thing on every
   * update. Re-rendering the SAME tree also proves no verdict leaks across
   * cases: whatever this assertion sees, it saw the previous prop first.
   */
  it('follows the verdict on re-render, in both directions', () => {
    const ds = makeDataSource();
    const props = { locked: true, approvalPending: true, approvalProgress: QUORUM };
    const tree = (isSubmitter: boolean | undefined) => (
      <InlineEditProvider canEdit={false} {...props} approvalIsSubmitter={isSubmitter}>
        <DetailView schema={baseSchema} dataSource={ds} inlineEdit />
      </InlineEditProvider>
    );

    const { rerender } = render(tree(false));
    expect(screen.queryByRole('button', { name: RECALL })).not.toBeInTheDocument();

    rerender(tree(true));
    expect(screen.getByRole('button', { name: RECALL })).toBeInTheDocument();

    rerender(tree(false));
    expect(screen.queryByRole('button', { name: RECALL })).not.toBeInTheDocument();

    // …and back to "unknown", which must read as the pre-#6464 behaviour
    // rather than inheriting the `false` that preceded it.
    rerender(tree(undefined));
    expect(screen.getByRole('button', { name: RECALL })).toBeInTheDocument();
    expectBandRendered('Locked for approval');
  });
});
