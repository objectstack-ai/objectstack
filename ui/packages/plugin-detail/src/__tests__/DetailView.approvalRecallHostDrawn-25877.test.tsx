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
 * Recall is drawn ONCE per page (objectstack#25877).
 *
 * The record page host mounts the pending request's declared decision actions
 * above the page, `approval_recall` among them, and the approval band below
 * drew its own recall too: two Recall buttons for one request. A host that
 * draws the declared lever says so with `approvalRecallDrawnByHost`, and the
 * band keeps its status badge and tally only.
 *
 * The opposite failure is pinned beside it: a host that does not say so (a
 * bare DetailView, a backend with no approvals API) keeps the band as the only
 * recall lever, so absent must read as "draw it".
 */

const RECALL = /Recall approval/;

const baseSchema: DetailViewSchema = {
  type: 'detail-view',
  title: 'Budget',
  objectName: 'budget',
  // The band renders only under a suppressed DetailView header with inline
  // editing on, the way the record page composes it.
  showHeader: false,
  data: { id: 'B1', name: 'Q3 Budget' },
  sections: [{ title: 'Basics', fields: [{ name: 'name', label: 'Name' }] }],
};

const QUORUM: ApprovalProgress = { behavior: 'quorum', got: 1, need: 2 };

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => null),
    cancelPendingApproval: vi.fn(async () => ({ requestId: 'r1', status: 'recalled' })),
  } as any;
}

function tree(drawnByHost: boolean | undefined, ds = makeDataSource()) {
  return (
    <InlineEditProvider
      canEdit={false}
      locked
      approvalPending
      approvalProgress={QUORUM}
      approvalIsSubmitter
      approvalRecallDrawnByHost={drawnByHost}
    >
      <DetailView schema={baseSchema} dataSource={ds} inlineEdit />
    </InlineEditProvider>
  );
}

/** The band and its tally must be there, so an absent button is a measurement. */
function expectBandRendered() {
  expect(screen.getByRole('status')).toBeInTheDocument();
  expect(screen.getByText('Locked for approval')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toBeInTheDocument();
}

describe('DetailView – the band yields recall to a host that draws it (objectstack#25877)', () => {
  it('keeps only the lock badge when the host draws the declared recall', () => {
    render(tree(true));

    expectBandRendered();
    expect(screen.queryByRole('button', { name: RECALL })).not.toBeInTheDocument();
  });

  it('draws its recall for the submitter when the host does not say it draws one', () => {
    render(tree(undefined));

    expectBandRendered();
    expect(screen.getByRole('button', { name: RECALL })).toBeEnabled();
  });

  it('follows the signal on re-render, both ways', () => {
    const ds = makeDataSource();
    const { rerender } = render(tree(false, ds));
    expect(screen.getByRole('button', { name: RECALL })).toBeInTheDocument();

    rerender(tree(true, ds));
    expect(screen.queryByRole('button', { name: RECALL })).not.toBeInTheDocument();
    expectBandRendered();

    rerender(tree(false, ds));
    expect(screen.getByRole('button', { name: RECALL })).toBeInTheDocument();
  });
});
