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
import { InlineEditProvider } from '@object-ui/react';
import type { DetailViewSchema } from '@object-ui/types';

/**
 * The band follows the host's ANSWERED approvals read (objectui#12220).
 *
 * On a composition without the approvals service the record page's approvals
 * read answers `200 { data: [] }` and the server enforces no lock, yet a record
 * whose `approval_status` column read `pending` showed "Locked for approval"
 * and a Recall lever with nothing to recall. The host had found no request and
 * threaded `locked: false` / `approvalPending: false`, which is the provider's
 * default too, so the band could not tell "the host read approvals and found
 * nothing" from "no host opinion" and OR-ed the column back in.
 *
 * `approvalReadAnswered` is the host saying which. These pins cover the band's
 * side; the record page's side (that it threads the flag from its read) is
 * `RecordDetailView.approvalLock-12220.test.tsx` in app-shell.
 */

const RECALL = /Recall approval/;

const baseSchema: DetailViewSchema = {
  type: 'detail-view',
  title: 'Account',
  objectName: 'account',
  // The band renders only when DetailView's own header is suppressed (composed
  // under a Lightning-style page header) and inline editing is on.
  showHeader: false,
  data: { id: 'A1', name: 'Northwind', approval_status: 'pending' },
  sections: [{ title: 'Basics', fields: [{ name: 'name', label: 'Name' }] }],
};

/** A DataSource that speaks recall, so the lever's absence is measurable. */
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

function renderBand(providerProps: {
  locked?: boolean;
  approvalPending?: boolean;
  approvalReadAnswered?: boolean;
}) {
  return render(
    <InlineEditProvider canEdit={false} {...providerProps}>
      <DetailView schema={baseSchema} dataSource={makeDataSource()} inlineEdit />
    </InlineEditProvider>,
  );
}

describe('DetailView – the band follows an answered approvals read (objectui#12220)', () => {
  it('shows no band and no recall on a `pending` record whose host read answered with no request', () => {
    const answered = renderBand({ locked: false, approvalPending: false, approvalReadAnswered: true });
    // The body rendered, so the band's absence below is not a blank mount.
    expect(screen.getByText('Northwind')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText('Locked for approval')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: RECALL })).not.toBeInTheDocument();
    answered.unmount();

    // Control, same record and same host pair, minus the flag: the column
    // fallback engages and the band and its lever render. Without this the
    // absences above would pass on a band that can never render.
    renderBand({ locked: false, approvalPending: false });
    expect(screen.getByText('Locked for approval')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: RECALL })).toBeInTheDocument();
  });

  it('keeps a record with an open locking request locked', () => {
    renderBand({ locked: true, approvalPending: true, approvalReadAnswered: true });
    expect(screen.getByText('Locked for approval')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: RECALL })).toBeInTheDocument();
  });

  it('with no answered read (route absent), the column fallback still locks', () => {
    // The record page threads `approvalReadAnswered: false` after a 404 / 501;
    // its own pair is then column-derived, but the band must lock even from a
    // host whose pair is empty.
    renderBand({ locked: false, approvalPending: false, approvalReadAnswered: false });
    expect(screen.getByText('Locked for approval')).toBeInTheDocument();
  });

  it('control (objectui#2902): an answered `lockRecord: false` request reads editable over a `pending` column', () => {
    renderBand({ locked: false, approvalPending: true, approvalReadAnswered: true });
    expect(screen.getByText('In approval · editable')).toBeInTheDocument();
    expect(screen.queryByText('Locked for approval')).not.toBeInTheDocument();
  });
});
