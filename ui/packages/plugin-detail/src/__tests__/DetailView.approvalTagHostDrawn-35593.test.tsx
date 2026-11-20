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
 * objectstack#35593 — the record page's header names the pending approval
 * with a tag after the record's name, so the band draws no 「审批中已锁定」
 * badge for an APPROVAL lock. The tally stays; an editable approval keeps its
 * badge; a host that does not say it draws the tag keeps the badge as before.
 */

const baseSchema: DetailViewSchema = {
  type: 'detail-view',
  title: 'Budget',
  objectName: 'budget',
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
  } as any;
}

function tree({ locked, tagDrawnByHost }: { locked: boolean; tagDrawnByHost?: boolean }) {
  return (
    <InlineEditProvider
      canEdit={!locked}
      locked={locked}
      approvalPending
      approvalProgress={QUORUM}
      approvalIsSubmitter={false}
      approvalTagDrawnByHost={tagDrawnByHost}
    >
      <DetailView schema={baseSchema} dataSource={makeDataSource()} inlineEdit />
    </InlineEditProvider>
  );
}

describe('DetailView – the band yields the approval-lock badge to the header tag (objectstack#35593)', () => {
  it('draws no lock badge when the host header names the approval, and keeps the tally', () => {
    render(tree({ locked: true, tagDrawnByHost: true }));
    expect(screen.queryByText('Locked for approval')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('keeps the lock badge when the host does not say it draws the tag', () => {
    render(tree({ locked: true }));
    expect(screen.getByText('Locked for approval')).toBeInTheDocument();
  });

  it('keeps an editable approval\'s badge: it is not a lock', () => {
    render(tree({ locked: false, tagDrawnByHost: true }));
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
