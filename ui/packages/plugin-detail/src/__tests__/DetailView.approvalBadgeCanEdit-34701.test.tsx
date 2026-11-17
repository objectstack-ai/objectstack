/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DetailView } from '../DetailView';
import { InlineEditProvider } from '@object-ui/react';
import type { DataSource, DetailViewSchema } from '@object-ui/types';

/**
 * objectstack#34701 — the approval badge says "editable" only when the record
 * IS editable for this user.
 *
 * A `lockRecord: false` approval node means the approval does not lock the
 * record. It does not mean the record can be edited: the record page's
 * `canEdit` also carries record permission, the edit action's
 * `disabledWhen` / `visibleWhen` and a `readonlyWhen` lock on every field. The
 * badge read the node alone, so a record those gates closed was labelled
 * 「审批中 · 可编辑」 and every edit was then refused. With `canEdit` false the
 * badge now says only that an approval is running.
 */

const RECALL = /recall/i;

const schema: DetailViewSchema = {
  type: 'detail-view',
  title: 'Customer rating',
  objectName: 'customer_rating',
  resourceId: 'R1',
  showHeader: false,
  data: { id: 'R1', name: 'Northwind rating', approval_status: 'pending' },
  sections: [{ title: 'Basics', fields: [{ name: 'name', label: 'Name' }] }],
};

function makeDataSource(): DataSource {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => null),
    cancelPendingApproval: vi.fn(async () => ({ requestId: 'r1', status: 'recalled' })),
  } as unknown as DataSource;
}

function renderBand(props: { canEdit?: boolean; locked?: boolean }) {
  return render(
    <InlineEditProvider
      {...(props.canEdit === undefined ? {} : { canEdit: props.canEdit })}
      locked={props.locked ?? false}
      approvalPending
      approvalReadAnswered
      approvalIsSubmitter
    >
      <DetailView schema={schema} dataSource={makeDataSource()} inlineEdit />
    </InlineEditProvider>,
  );
}

afterEach(() => cleanup());

describe('DetailView – the approval badge reads canEdit (objectstack#34701)', () => {
  it('THE DEFECT: an unlocked node on a record the user cannot edit reads "In approval", never "editable"', () => {
    renderBand({ canEdit: false });

    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('In approval');
    expect(badge).not.toHaveTextContent('editable');
    expect(badge).toHaveAttribute('title', 'This record has a pending approval request');
    expect(screen.queryByText('Locked for approval')).not.toBeInTheDocument();
  });

  it('keeps recall on the not-editable badge: recall belongs to the approval, not to the edit gate', () => {
    renderBand({ canEdit: false });
    expect(screen.getByRole('status')).toHaveTextContent('In approval');
    expect(screen.getByRole('status')).not.toHaveTextContent('editable');
    expect(screen.getByRole('button', { name: RECALL })).toBeInTheDocument();
  });

  it('CONTROL: the same record with canEdit true still reads "In approval · editable"', () => {
    renderBand({ canEdit: true });
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('In approval · editable');
    expect(badge).toHaveAttribute(
      'title',
      'This record has a pending approval request; this step still allows editing',
    );
  });

  it('CONTROL: a host that threads no canEdit keeps the editable label (provider default true)', () => {
    renderBand({});
    expect(screen.getByRole('status')).toHaveTextContent('In approval · editable');
  });

  it('CONTROL: a locking node reads "Locked for approval" whatever canEdit says', () => {
    renderBand({ canEdit: false, locked: true });
    expect(screen.getByRole('status')).toHaveTextContent('Locked for approval');
  });
});
