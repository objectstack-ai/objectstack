/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12751 — on a page that declares `print`, the record's approval band
 * does not print.
 *
 * Measured on the live printed PDF: a record in approval put its "Recall
 * approval" button, its status badge and its "Approvals — 0 of 1" tally on
 * paper. The button is a control. The badge and the tally are the approval's
 * live state: they differ by viewer and change with each decision, the reason
 * the spec refuses `record:approvals` and `record:approval_decision` inside a
 * print page. So under a `PrintPageProvider` the whole band is gone, while the
 * record's own fields still print. Off a print page the band is unchanged.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DetailView } from '../DetailView';
import { InlineEditProvider, PrintPageProvider, type ApprovalProgress } from '@object-ui/react';
import type { DetailViewSchema, DataSource } from '@object-ui/types';

const RECALL = /Recall approval/;

const schema: DetailViewSchema = {
  type: 'detail-view',
  title: 'Invoice',
  objectName: 'invoice',
  // The band renders only when DetailView's own header is suppressed, which is
  // how `record:details` mounts it (`showHeader` defaults to false there).
  showHeader: false,
  data: { id: 'INV-1', name: 'INV-0001' },
  sections: [{ title: 'Basics', fields: [{ name: 'name', label: 'Name' }] }],
};

const PROGRESS: ApprovalProgress = { behavior: 'quorum', got: 0, need: 1 };

function makeDataSource() {
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

function renderRecord(locked: boolean, onPrintPage: boolean) {
  const view = (
    <InlineEditProvider
      canEdit={false}
      locked={locked}
      approvalPending
      approvalIsSubmitter
      approvalProgress={PROGRESS}
    >
      <DetailView schema={schema} dataSource={makeDataSource()} inlineEdit />
    </InlineEditProvider>
  );
  return render(onPrintPage ? <PrintPageProvider value={{ paperSize: 'A4' }}>{view}</PrintPageProvider> : view);
}

afterEach(() => cleanup());

describe('the approval band does not print (objectui#12751)', () => {
  it.each([
    ['an editable approval', false],
    ['a locking approval', true],
  ])('under a print page, %s draws no recall button, no status badge and no tally', (_label, locked) => {
    renderRecord(locked, true);

    // The record itself still prints, so the absences below measure the band.
    expect(screen.getByText('INV-0001')).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: RECALL })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText('In approval · editable')).toBeNull();
    expect(screen.queryByText('Locked for approval')).toBeNull();
  });

  it.each([
    ['an editable approval', false, 'In approval · editable'],
    ['a locking approval', true, 'Locked for approval'],
  ])('CONTROL — off a print page, %s draws the band unchanged', (_label, locked, badge) => {
    renderRecord(locked, false);

    expect(screen.getByText('INV-0001')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: RECALL })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(badge);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });
});
