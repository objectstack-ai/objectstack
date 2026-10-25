/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:activity`: a REFUSED read is not "no activity" (objectui#11195).
 *
 * The block's self-fetch ended in a `.catch` that set the feed to `[]` for
 * every failure, so on a custom record page a member the server refused saw
 * `No activity recorded`, the same sentence as a record with no history. The
 * catch now asks `isRefusedFeedRead` and the timeline renders a no-permission
 * state for a refusal.
 *
 * Pinned on the rendered block, with the self-fetch as the only source:
 *   1. a refused read (403 envelope, and 401) shows the no-permission state,
 *      and the read is not retried;
 *   2. the control: a 200 with zero rows shows the empty state, unchanged;
 *   3. a 404 is not a refusal, so the empty state stays;
 *   4. a 500 is not "no permission".
 * And with a host DiscussionContext as the source, the block shows the refusal
 * the host reports for either of its reads.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { RecordContextProvider, DiscussionContextProvider } from '@object-ui/react';
import { RecordActivityRenderer } from '../record-activity';
import { isRefusedFeedRead } from '../recordActivityFeed';

const EMPTY_FEED = 'No activity recorded';
const ACTIVITY_DENIED = "You don't have permission to view activity on this record.";
const COMMENTS_DENIED = "You don't have permission to view comments on this record.";

/**
 * A rejected read in the shape the ObjectStack client throws it: the HTTP
 * status on `httpStatus` and the ADR-0112 code on `code`.
 */
const rejection = (httpStatus: number, code: string) =>
  Object.assign(new Error(`${httpStatus} ${code}`), { httpStatus, code });

const rejectingSource = (err: unknown) => ({ find: vi.fn().mockRejectedValue(err) }) as any;
const answeringSource = (rows: unknown[]) => ({ find: vi.fn().mockResolvedValue({ data: rows }) }) as any;

const mountBound = (dataSource: any, wrap: (node: React.ReactNode) => React.ReactNode = (n) => n) =>
  render(
    <RecordContextProvider
      objectName="crm_account"
      recordId="rec-alpha"
      data={{ id: 'rec-alpha', name: 'Alpha' }}
      dataSource={dataSource}
    >
      {wrap(<RecordActivityRenderer schema={{} as any} />)}
    </RecordContextProvider>,
  );

/** Let every settled read's follow-up render land before counting reads. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeEach(() => {
  cleanup();
});

describe('record:activity self-fetch: a refused read shows the no-permission state (objectui#11195)', () => {
  it('a 403 PERMISSION_DENIED envelope shows the no-permission state, not the empty state', async () => {
    mountBound(rejectingSource(rejection(403, 'PERMISSION_DENIED')));

    const notice = await screen.findByTestId('activity-access-denied');
    expect(notice.textContent).toContain(ACTIVITY_DENIED);
    expect(notice.querySelector('[data-denied-source="activity"]')).not.toBeNull();
    // Visually distinct from the empty state, which is not rendered at all.
    expect(screen.queryByText(EMPTY_FEED)).toBeNull();
    expect(screen.queryByTestId('activity-loading')).toBeNull();
    // The message never names the object's internal name, or the table.
    expect(notice.textContent).not.toContain('crm_account');
    expect(notice.textContent).not.toContain('sys_activity');
  });

  it('does not retry a refused read', async () => {
    const dataSource = rejectingSource(rejection(403, 'PERMISSION_DENIED'));
    mountBound(dataSource);

    await screen.findByTestId('activity-access-denied');
    await settle();

    expect(dataSource.find).toHaveBeenCalledTimes(1);
  });

  it('a 401 is a refused read too', async () => {
    mountBound(rejectingSource(rejection(401, 'UNAUTHORIZED')));

    const notice = await screen.findByTestId('activity-access-denied');
    expect(notice.textContent).toContain(ACTIVITY_DENIED);
    expect(screen.queryByText(EMPTY_FEED)).toBeNull();
  });

  it('control: a 200 with zero rows shows the empty state, unchanged', async () => {
    mountBound(answeringSource([]));

    expect(await screen.findByText(EMPTY_FEED)).toBeTruthy();
    expect(screen.queryByTestId('activity-access-denied')).toBeNull();
  });

  it('a 404 is not a refusal: the empty state stays', async () => {
    mountBound(rejectingSource(rejection(404, 'OBJECT_NOT_FOUND')));

    expect(await screen.findByText(EMPTY_FEED)).toBeTruthy();
    expect(screen.queryByTestId('activity-access-denied')).toBeNull();
  });

  it('a 500 is not "no permission"', async () => {
    mountBound(rejectingSource(rejection(500, 'INTERNAL_ERROR')));

    // The block has no error state of its own, so a failure that is not a
    // refusal still settles on the empty state.
    expect(await screen.findByText(EMPTY_FEED)).toBeTruthy();
    expect(screen.queryByTestId('activity-access-denied')).toBeNull();
    expect(screen.queryByText(ACTIVITY_DENIED)).toBeNull();
  });
});

describe('record:activity under a host DiscussionContext shows the refusal the host reports (objectui#11195)', () => {
  it('a refused activity read with no rows replaces the empty state', async () => {
    const dataSource = answeringSource([]);
    mountBound(dataSource, (node) => (
      <DiscussionContextProvider items={[]} loading={false} activityDenied>
        {node}
      </DiscussionContextProvider>
    ));

    const notice = await screen.findByTestId('activity-access-denied');
    expect(notice.textContent).toContain(ACTIVITY_DENIED);
    expect(screen.queryByText(EMPTY_FEED)).toBeNull();
    // The host owns the feed, so the block does not fetch a second copy.
    expect(dataSource.find).not.toHaveBeenCalled();
  });

  it('a refused comment read keeps the rows on screen and names the withheld half', async () => {
    const items = [
      {
        id: 'act-1',
        type: 'field_change',
        actor: 'Grace',
        body: 'Stage moved to qualified',
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ];
    mountBound(answeringSource([]), (node) => (
      <DiscussionContextProvider items={items as any} loading={false} commentsDenied>
        {node}
      </DiscussionContextProvider>
    ));

    expect(await screen.findByText('Stage moved to qualified')).toBeTruthy();
    const notice = screen.getByTestId('activity-access-denied');
    expect(notice.textContent).toContain(COMMENTS_DENIED);
    expect(notice.textContent).not.toContain(ACTIVITY_DENIED);
  });
});

describe('isRefusedFeedRead: the one verdict both surfaces share (objectui#11195)', () => {
  it('refused: 403, 401, and a permission envelope without a status', () => {
    expect(isRefusedFeedRead(rejection(403, 'PERMISSION_DENIED'))).toBe(true);
    expect(isRefusedFeedRead(rejection(401, 'UNAUTHORIZED'))).toBe(true);
    expect(isRefusedFeedRead(Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' }))).toBe(true);
  });

  it('not refused: a 404, an API-disabled object, a 400, a 500, a bare network error', () => {
    expect(isRefusedFeedRead(rejection(404, 'OBJECT_NOT_FOUND'))).toBe(false);
    expect(isRefusedFeedRead(rejection(404, 'OBJECT_API_DISABLED'))).toBe(false);
    expect(isRefusedFeedRead(rejection(400, 'INVALID_FILTER'))).toBe(false);
    expect(isRefusedFeedRead(rejection(500, 'INTERNAL_ERROR'))).toBe(false);
    expect(isRefusedFeedRead(new TypeError('Failed to fetch'))).toBe(false);
  });
});
