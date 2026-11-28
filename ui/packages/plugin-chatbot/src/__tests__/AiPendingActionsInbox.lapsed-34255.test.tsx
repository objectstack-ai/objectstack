/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The AI Approvals inbox reads a LAPSED pending action as "Expired", not as a
 * rejection (objectstack#34255, the console half of the ruling on cloud#4608).
 *
 * A lapsed item is stored `status: 'rejected'`, `rejection_reason: 'lapsed'`,
 * no `decided_by`; a decision on it is answered `409` with
 * `error.details.reason: 'pending_action_lapsed'`. Both legs are measured
 * here, and a person's own rejection, which names a decider, stays "Rejected".
 *
 * Rendered in zh, not en: the zh words for the two outcomes (已过期 / 已拒绝)
 * come only from the pack, so a badge still reading the bare status shows
 * 已拒绝 and fails.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import type { PendingActionRow } from '@objectstack/spec/contracts';
import { AiPendingActionsInbox } from '../AiPendingActionsInbox';

const ZH = {
  expired: '已过期',
  rejected: '已拒绝',
  expiredDetail: '没有在期限内处理，或发起人已失去访问权限。',
  decidedBy: '处理人',
  approve: '通过',
  view: '查看',
};

const base = {
  object_name: 'task',
  action_name: 'delete',
  tool_name: 'action_delete_task',
  tool_input: '{"id":"t1"}',
  proposed_by: 'user_1',
  proposed_at: new Date().toISOString(),
};

const lapsedRow: PendingActionRow = {
  ...base,
  id: 'pa_lapsed',
  status: 'rejected',
  rejection_reason: 'lapsed',
};

/** A person's own rejection: a decider is recorded, whatever the reason says. */
const personRejectedRow: PendingActionRow = {
  ...base,
  id: 'pa_person',
  status: 'rejected',
  rejection_reason: 'lapsed',
  decided_by: 'user_2',
};

/**
 * "No decider" in the two other spellings a server can send: a SQL column read
 * back as `null`, and an empty string. Both lapsed rows read Expired too.
 */
const lapsedNullDecider = {
  ...lapsedRow,
  id: 'pa_lapsed_null',
  decided_by: null,
} as unknown as PendingActionRow;
const lapsedEmptyDecider: PendingActionRow = { ...lapsedRow, id: 'pa_lapsed_empty', decided_by: '' };

const pendingRow: PendingActionRow = { ...base, id: 'pa_pending', status: 'pending' };

const json = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  }) as unknown as Response;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderZh() {
  return render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
      <AiPendingActionsInbox pollInterval={0} />
    </I18nProvider>,
  );
}

/** The desktop face: happy-dom applies no stylesheet, so the phone cards are in the DOM too. */
const tableFace = () => within(screen.getByRole('table'));
const rowOf = (id: string) =>
  tableFace().getByTestId(`ai-inbox-view-${id}`).closest('tr') as HTMLElement;

describe('AiPendingActionsInbox — a lapsed pending action reads Expired (objectstack#34255)', () => {
  it('draws a lapsed row as Expired with no decider, and a person-rejected row as Rejected', async () => {
    const items = [lapsedRow, personRejectedRow];
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { items, total: items.length })));
    renderZh();
    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());

    expect(within(rowOf('pa_lapsed')).getByText(ZH.expired)).toBeTruthy();
    expect(within(rowOf('pa_lapsed')).queryByText(ZH.rejected)).toBeNull();
    expect(within(rowOf('pa_person')).getByText(ZH.rejected)).toBeTruthy();
    expect(within(rowOf('pa_person')).queryByText(ZH.expired)).toBeNull();

    // The drawer says why and names no decider.
    fireEvent.click(tableFace().getByTestId('ai-inbox-view-pa_lapsed'));
    const detail = await screen.findByTestId('ai-inbox-expired-detail');
    expect(within(detail).getByText(ZH.expiredDetail)).toBeTruthy();
    expect(screen.queryByText(ZH.decidedBy)).toBeNull();
  });

  it('reads a lapsed row as Expired when its decider is null or an empty string', async () => {
    const items = [lapsedNullDecider, lapsedEmptyDecider];
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { items, total: items.length })));
    renderZh();
    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());

    for (const id of ['pa_lapsed_null', 'pa_lapsed_empty']) {
      expect(within(rowOf(id)).getByText(ZH.expired)).toBeTruthy();
      expect(within(rowOf(id)).queryByText(ZH.rejected)).toBeNull();
    }
  });

  it('answers a 409 pending_action_lapsed with Expired, not the conflict error, and re-reads the item', async () => {
    let lapsed = false;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        lapsed = true;
        return json(409, {
          success: false,
          error: {
            code: 'RESOURCE_CONFLICT',
            message: 'Pending action pa_pending is no longer pending',
            details: { reason: 'pending_action_lapsed' },
          },
        });
      }
      const items = [lapsed ? { ...pendingRow, status: 'rejected', rejection_reason: 'lapsed' } : pendingRow];
      return json(200, { items, total: items.length });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderZh();
    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());

    fireEvent.click(tableFace().getByTestId('ai-inbox-approve-pa_pending'));

    // The outcome line reads Expired and why; the server's conflict message is not shown.
    await waitFor(() => expect(screen.getByText(new RegExp(ZH.expiredDetail))).toBeTruthy());
    expect(screen.queryByText(/no longer pending/)).toBeNull();
    // The list was read again after the decision, and the row itself now reads Expired.
    const reads = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'GET');
    expect(reads.length).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(within(rowOf('pa_pending')).getByText(ZH.expired)).toBeTruthy());
  });
});
