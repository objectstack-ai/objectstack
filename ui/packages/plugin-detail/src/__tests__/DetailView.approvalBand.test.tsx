/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DetailView } from '../DetailView';
import { InlineEditProvider, type ApprovalProgress } from '@object-ui/react';
import type { DetailViewSchema } from '@object-ui/types';

/**
 * DetailView approval-lock band (objectui#2618).
 *
 * The band renders only when the DetailView's own header is suppressed
 * (`showHeader === false`, composed under a Lightning-style page header) and
 * inline editing is enabled. It must engage from the HOST-supplied lock
 * signal (`InlineEditProvider locked`) — not only the record's own
 * `approval_status` field — because some backends track the lock via an open
 * approval *request* and never materialize an `approval_status` on the record.
 * Without this the lock was real (writes rejected with RECORD_LOCKED) yet the
 * band silently never showed.
 */

const baseSchema: DetailViewSchema = {
  type: 'detail-view',
  title: 'Budget',
  objectName: 'budget',
  showHeader: false,
  data: { id: 'B1', name: 'Q3 Budget' },
  sections: [{ title: 'Basics', fields: [{ name: 'name', label: 'Name' }] }],
};

function renderBand(
  providerProps: {
    locked?: boolean;
    approvalPending?: boolean;
    lockedReason?: string;
    canEdit?: boolean;
    approvalProgress?: ApprovalProgress;
  },
  data?: Record<string, unknown>,
) {
  return render(
    <InlineEditProvider canEdit={providerProps.canEdit ?? false} {...providerProps}>
      <DetailView schema={{ ...baseSchema, data: { ...baseSchema.data, ...data } }} inlineEdit />
    </InlineEditProvider>,
  );
}

describe('DetailView – approval-lock band (objectui#2618)', () => {
  it('shows the band from the host lock signal even with no approval_status field', () => {
    renderBand({ locked: true });
    // Backend tracks the lock via approval request only → record carries no
    // approval_status, but the host threads `locked` — band must still show.
    expect(screen.getByText('Locked for approval')).toBeInTheDocument();
  });

  it('uses the host-supplied lockedReason as the badge tooltip', () => {
    renderBand({ locked: true, lockedReason: 'Pending manager approval' });
    const badge = screen.getByRole('status');
    expect(badge).toHaveAttribute('title', 'Pending manager approval');
  });

  it('still shows the band from the record field for field-tracked backends', () => {
    // No host `locked`, but the record materializes approval_status — the
    // legacy field-only signal remains a valid fallback.
    renderBand({ locked: false }, { approval_status: 'pending' });
    expect(screen.getByText('Locked for approval')).toBeInTheDocument();
  });

  it('does not show the band when neither signal indicates a lock', () => {
    renderBand({ locked: false }, { approval_status: 'draft' });
    expect(screen.queryByText('Locked for approval')).not.toBeInTheDocument();
  });
});

/**
 * Two-state approval band (objectui#2902).
 *
 * An approval node declares `lockRecord`, and on a `lockRecord: false` node the
 * server accepts edits for the whole time the node waits. The band used to key
 * off "a pending request exists" alone, so both states rendered identically —
 * a record you could freely edit was labelled "Locked for approval". The band
 * must now distinguish them, and recall (which is about the approval, not the
 * lock) must survive in the editable state.
 */
describe('DetailView – approval band, editable vs locked (objectui#2902)', () => {
  it('labels a pending-but-unlocked approval as editable, not locked', () => {
    renderBand({ locked: false, approvalPending: true });
    expect(screen.getByText('In approval · editable')).toBeInTheDocument();
    expect(screen.queryByText('Locked for approval')).not.toBeInTheDocument();
  });

  it('uses a distinct tooltip for the editable state', () => {
    renderBand({ locked: false, approvalPending: true });
    expect(screen.getByRole('status')).toHaveAttribute(
      'title',
      'This record has a pending approval request; this step still allows editing',
    );
  });

  it('still labels a locked approval as locked when both signals are on', () => {
    // The locked node of the same flow: pending AND locking.
    renderBand({ locked: true, approvalPending: true });
    expect(screen.getByText('Locked for approval')).toBeInTheDocument();
    expect(screen.queryByText('In approval · editable')).not.toBeInTheDocument();
  });

  it('treats `locked` alone as pending too, so un-migrated hosts are unchanged', () => {
    // A host that threads only `locked` (pre-#2902) must keep its old band.
    renderBand({ locked: true });
    expect(screen.getByText('Locked for approval')).toBeInTheDocument();
  });

  it('shows no band when no approval is running at all', () => {
    renderBand({ locked: false, approvalPending: false }, { approval_status: 'draft' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('lets the host verdict beat the approval_status mirror on an unlocked node', () => {
    // The configuration where the two sources genuinely disagree: a flow with
    // an `approvalStatusField` mirrors `approval_status: 'pending'` onto the
    // record on submit no matter what `lockRecord` says, so a `lockRecord:
    // false` node has BOTH the mirror reading "pending" and a host verdict of
    // "not locked". OR-ing the mirror in would re-lock the band on exactly the
    // node this feature exists to free — pencils live and saves landing under
    // a band that says "Locked for approval". The host resolved its verdict
    // from the request's `lock_record`, which is the same snapshot the
    // server's lock hook reads, so it wins.
    renderBand({ locked: false, approvalPending: true }, { approval_status: 'pending' });
    expect(screen.getByText('In approval · editable')).toBeInTheDocument();
    expect(screen.queryByText('Locked for approval')).not.toBeInTheDocument();
  });
});

/**
 * Quorum / per-group progress in the band (objectstack#4478).
 *
 * `lockRecord` and the recall button told the approver what they may not do.
 * Neither says how many approvals the node still needs — and on a `quorum` or
 * `per_group` (会签) node that is the fact that decides whether their own click
 * finalizes the step. The server publishes the tally it will enforce
 * (`decision_progress`, computed from the node's `behavior` / `minApprovals` /
 * approver slate); the band rendered none of it, so a "Committee Sign-off
 * (2 of 3)" step looked exactly like a single-approver one.
 *
 * The payloads below are the ones the showcase's `showcase_committee_quorum`
 * (quorum, `minApprovals: 2` over three approvers) and
 * `showcase_expense_signoff` (per_group, manager + finance) nodes produce.
 */
describe('DetailView – quorum & per-group progress (objectstack#4478)', () => {
  const QUORUM: ApprovalProgress = { behavior: 'quorum', got: 1, need: 2 };
  const PER_GROUP: ApprovalProgress = {
    behavior: 'per_group',
    got: 1,
    need: 2,
    groups: [
      { group: 'finance', got: 1, need: 1, satisfied: true },
      { group: 'manager', got: 0, need: 1, satisfied: false },
    ],
  };

  it('renders the quorum tally next to the lock badge', () => {
    renderBand({ locked: true, approvalPending: true, approvalProgress: QUORUM });
    expect(screen.getByText('Locked for approval')).toBeInTheDocument();
    expect(screen.getByText('Approvals — 1 of 2')).toBeInTheDocument();
  });

  it('exposes the tally as a progressbar, not decoration', () => {
    renderBand({ locked: true, approvalPending: true, approvalProgress: QUORUM });
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(bar).toHaveAttribute('aria-valuemax', '2');
  });

  it('renders the tally on an editable (lockRecord: false) node too', () => {
    // Progress is about the DECISION, not the lock — an unlocked quorum node
    // needs the same count.
    renderBand({ locked: false, approvalPending: true, approvalProgress: QUORUM });
    expect(screen.getByText('In approval · editable')).toBeInTheDocument();
    expect(screen.getByText('Approvals — 1 of 2')).toBeInTheDocument();
  });

  it('renders one chip per group, marking which have signed (会签)', () => {
    renderBand({ locked: true, approvalPending: true, approvalProgress: PER_GROUP });
    expect(screen.getByText('Sign-off — 1 of 2 groups')).toBeInTheDocument();
    expect(screen.getByText('finance 1/1')).toBeInTheDocument();
    expect(screen.getByText('manager 0/1')).toBeInTheDocument();
  });

  it('counts GROUPS, not approvals, on a per_group node', () => {
    renderBand({ locked: true, approvalPending: true, approvalProgress: PER_GROUP });
    expect(screen.queryByText('Approvals — 1 of 2')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '2');
  });

  it('shows no progress when the node finalizes on the first response', () => {
    // `first_response` carries no `decision_progress` — a "1 of 1" bar there
    // would be noise, not information.
    renderBand({ locked: true, approvalPending: true });
    expect(screen.getByText('Locked for approval')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows no progress once the approval is over', () => {
    // No band at all ⇒ nothing to hang a tally on, even if a stale progress
    // object is still threaded.
    renderBand(
      { locked: false, approvalPending: false, approvalProgress: QUORUM },
      { approval_status: 'approved' },
    );
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
