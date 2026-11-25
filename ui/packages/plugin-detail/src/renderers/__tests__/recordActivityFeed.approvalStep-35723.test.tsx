/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An approval step on the record's activity stream draws as the one-line
 * approval entry (objectstack#35723).
 *
 * plugin-approvals writes one `sys_activity` row per approval step it records
 * (submitted, approved, rejected, recalled) about the record the request
 * governs, in the ADR-0052 §5 shape: `type: 'system'`, `metadata.kind:
 * 'approval'`, and `source_object: 'sys_approval_request'` naming the request.
 * The mapper reads exactly that triple as the `approval` feed kind, which
 * `RecordActivityTimeline` draws as one line with 「看审批」 where the host
 * supplies `RecordViewApprovalsContext`.
 *
 * Until then nothing produced `approval`, and the producer census
 * (`feedTypeProducerCensus-5877.test.ts`) listed it as a kind with no
 * producer. The served `metadata` is a JSON STRING, as the writer stores it.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { RecordContextProvider } from '@object-ui/react';
import type { DataSource } from '@object-ui/types';
import {
  APPROVAL_ACTIVITY_FEED_TYPE,
  PRODUCED_FEED_TYPES,
  activityRowToFeedItem,
  normalizeFeedTypes,
  resetUnproducedFeedTypeWarnings,
  type SysActivityRow,
} from '../recordActivityFeed';
import { RecordActivityRenderer } from '../record-activity';
import { RecordViewApprovalsContext } from '../../recordTimelineStream';
import { DefaultRecordPageContext } from '../../defaultRecordPage';

const approvalMetadata = (action: string, stepLabel?: string): string =>
  JSON.stringify({ kind: 'approval', action, ...(stepLabel ? { step_label: stepLabel } : {}) });

/** The approval entry as plugin-approvals writes it, for an approve on step "Manager review". */
const APPROVED: SysActivityRow = {
  id: 'act-approved',
  type: 'system',
  summary: 'Approved · Manager review',
  timestamp: '2026-11-20T09:00:00.000Z',
  actor_id: 'u_ada',
  actor_name: 'Ada Approver',
  object_name: 'crm_deal',
  record_id: 'deal-1',
  source_object: 'sys_approval_request',
  source_id: 'req-1',
  metadata: approvalMetadata('approve', 'Manager review'),
};

describe('the mapper reads an approval step as the `approval` feed kind (objectstack#35723)', () => {
  it('maps the writer\'s triple to `approval`, keeping its line, actor and request pointer', () => {
    const item = activityRowToFeedItem(APPROVED, 'System');
    expect(item).toMatchObject({
      type: 'approval',
      body: 'Approved · Manager review',
      actor: 'Ada Approver',
      sourceObject: 'sys_approval_request',
      sourceId: 'req-1',
      activityType: 'system',
      activityKind: 'approval',
    });
    expect(APPROVAL_ACTIVITY_FEED_TYPE).toBe('approval');
  });

  it('CONTROL — a row missing any of the three is not an approval step', () => {
    // An app's own entry cannot be `system` (the app activity door refuses it),
    // so a forged kind on another type keeps that type's presentation…
    expect(activityRowToFeedItem({ ...APPROVED, type: 'scheduled' }, 'System')?.type).toBe('event');
    // …and a `system` row without the kind, or without the request pointer the
    // server's read gate keys on, stays a system entry.
    expect(activityRowToFeedItem({ ...APPROVED, metadata: JSON.stringify({ action: 'approve' }) }, 'System')?.type)
      .toBe('system');
    expect(activityRowToFeedItem({ ...APPROVED, source_object: 'sys_email' }, 'System')?.type).toBe('system');
    expect(activityRowToFeedItem({ ...APPROVED, source_object: null }, 'System')?.type).toBe('system');
  });
});

describe('the producer census counts `approval` as produced (objectstack#35723)', () => {
  beforeEach(() => resetUnproducedFeedTypeWarnings());
  afterEach(() => {
    vi.restoreAllMocks();
    resetUnproducedFeedTypeWarnings();
  });

  it('is in PRODUCED_FEED_TYPES, so `types: [\'approval\']` no longer reports "no producer"', () => {
    expect(PRODUCED_FEED_TYPES.has('approval')).toBe(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(normalizeFeedTypes(['approval'], 'record:activity')).toEqual(['approval']);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('the record page\'s stream draws the entry with 「看审批」 (objectstack#35723)', () => {
  beforeEach(() => cleanup());

  const renderStream = (viewApprovals: (() => void) | null) => {
    const find = vi.fn(async () => ({ data: [APPROVED], total: 1 }));
    const dataSource = { find } as unknown as DataSource;
    const view = render(
      <DefaultRecordPageContext.Provider value>
        <RecordViewApprovalsContext.Provider value={viewApprovals}>
          <RecordContextProvider
            objectName="crm_deal"
            recordId="deal-1"
            data={{ id: 'deal-1', name: 'Acme renewal' }}
            dataSource={dataSource}
          >
            <RecordActivityRenderer schema={{}} />
          </RecordContextProvider>
        </RecordViewApprovalsContext.Provider>
      </DefaultRecordPageContext.Provider>,
    );
    return { ...view, find };
  };

  it('draws the approval row, and its 「看审批」 opens the host\'s approvals', async () => {
    const viewApprovals = vi.fn();
    const { container, find } = renderStream(viewApprovals);
    await waitFor(() => expect(find).toHaveBeenCalled());
    expect(await screen.findByText('Approved · Manager review')).toBeTruthy();
    const row = container.querySelector('[data-stream-approval-row]');
    expect(row).not.toBeNull();
    const link = row!.querySelector('[data-stream-view-approval]') as HTMLButtonElement | null;
    expect(link).not.toBeNull();
    fireEvent.click(link!);
    expect(viewApprovals).toHaveBeenCalledTimes(1);
  });

  it('CONTROL — with no host to open the approvals, the entry is its one line with no link', async () => {
    const { container, find } = renderStream(null);
    await waitFor(() => expect(find).toHaveBeenCalled());
    expect(await screen.findByText('Approved · Manager review')).toBeTruthy();
    const row = container.querySelector('[data-stream-approval-row]');
    expect(row).not.toBeNull();
    expect(row!.querySelector('[data-stream-view-approval]')).toBeNull();
  });
});
