/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record header must SEE the pending node's quorum tally (objectstack#4478).
 *
 * The showcase's `showcase_committee_quorum` node declares `behavior: 'quorum'`
 * with `minApprovals: 2` over three approvers, and `showcase_expense_signoff`
 * declares `behavior: 'per_group'` with named manager / finance groups. The
 * framework turns both into a `decision_progress` block — but it attaches that
 * block in `getRequest` ONLY: `listRequests`, which is the call this hook makes
 * (`GET /approvals/requests?object=…&recordId=…`), deliberately skips the
 * per-row `sys_approval_action` tally it costs.
 *
 * So the hook had the request and none of the progress, and the record's
 * approval band could only ever render the lock badge. The fix is not a
 * fallback — the server contract is right — it is to make the consumer read the
 * enrichment where the server publishes it, with one follow-up single read for
 * the ONE pending row.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useRecordApprovals } from './useRecordApprovals';

/** The list row, exactly as `listRequests` sends it — no progress on it. */
const LIST_ROW = {
  id: 'req_committee_1',
  process_name: 'flow:showcase_committee_quorum',
  object_name: 'showcase_expense_report',
  record_id: 'AyG40_bAHSP_gi8T',
  status: 'pending',
  current_step: 'committee_signoff',
  step_label: 'Committee Sign-off (2 of 3)',
  lock_record: true,
  pending_approvers: ['u_manager', 'u_finance', 'u_legal'],
};

/**
 * The same row from `getRequest`, carrying the single-read enrichment the
 * server computes from `node_config_json` (`behavior: 'quorum'`,
 * `minApprovals: 2`, the three-approver `__approverGroups` slate).
 */
const DETAIL_ROW = {
  ...LIST_ROW,
  decision_progress: { behavior: 'quorum', got: 1, need: 2 },
};

/** A 会签 node: per-group behavior, one group signed, one outstanding. */
const PER_GROUP_DETAIL = {
  ...LIST_ROW,
  id: 'req_signoff_1',
  process_name: 'flow:showcase_expense_signoff',
  pending_approvers: ['u_devadmin', 'u_devadmin'],
  decision_progress: {
    behavior: 'per_group',
    got: 1,
    need: 2,
    groups: [
      { group: 'finance', got: 1, need: 1, satisfied: true },
      { group: 'manager', got: 0, need: 1, satisfied: false },
    ],
  },
  pending_approver_groups: { u_devadmin: ['manager'] },
};

/** Every GET the hook issued, in order. */
let gets: string[];

function stubApi(detail: unknown, opts: { detailStatus?: number } = {}) {
  gets = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      gets.push(u);
      if (/\/approvals\/requests\/[^?]+$/.test(u)) {
        if (opts.detailStatus) {
          return { ok: false, status: opts.detailStatus, json: async () => ({ error: 'nope' }) } as any;
        }
        return { ok: true, json: async () => detail } as any;
      }
      const list = (detail as any)?.id === PER_GROUP_DETAIL.id
        ? { ...LIST_ROW, id: PER_GROUP_DETAIL.id }
        : LIST_ROW;
      return { ok: true, json: async () => ({ data: [list] }) } as any;
    }),
  );
}

const mount = () =>
  renderHook(() => useRecordApprovals('showcase_expense_report', 'AyG40_bAHSP_gi8T'));

describe('useRecordApprovals — quorum progress (objectstack#4478)', () => {
  beforeEach(() => stubApi(DETAIL_ROW));

  it('exposes the quorum tally the list read does not carry', async () => {
    const { result } = mount();
    await waitFor(() =>
      expect(result.current.pendingRequest?.decision_progress).toEqual({
        behavior: 'quorum',
        got: 1,
        need: 2,
      }),
    );
  });

  it('reads the enrichment from the single-request endpoint', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.pendingRequest?.decision_progress).toBeTruthy());
    expect(gets.some((u) => u.includes('/approvals/requests?object='))).toBe(true);
    expect(gets.some((u) => u.endsWith('/approvals/requests/req_committee_1'))).toBe(true);
  });

  it('keeps the rest of the list row — the follow-up read only adds', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.pendingRequest?.decision_progress).toBeTruthy());
    expect(result.current.pendingRequest?.lock_record).toBe(true);
    expect(result.current.pendingRequest?.pending_approvers).toHaveLength(3);
  });

  it('surfaces the per-group tally and each pending approver\'s group', async () => {
    stubApi(PER_GROUP_DETAIL);
    const { result } = mount();
    await waitFor(() => expect(result.current.pendingRequest?.decision_progress).toBeTruthy());
    expect(result.current.pendingRequest?.decision_progress?.groups).toEqual([
      { group: 'finance', got: 1, need: 1, satisfied: true },
      { group: 'manager', got: 0, need: 1, satisfied: false },
    ]);
    expect(result.current.pendingRequest?.pending_approver_groups).toEqual({
      u_devadmin: ['manager'],
    });
  });

  it('leaves the row untouched when the follow-up read fails', async () => {
    // Display-only enrichment: a 500 must not take the approval panel down,
    // and must not invent a tally either.
    stubApi(DETAIL_ROW, { detailStatus: 500 });
    const { result } = mount();
    await waitFor(() => expect(result.current.pendingRequest).toBeTruthy());
    expect(result.current.pendingRequest?.decision_progress).toBeUndefined();
    // …and everything the LIST read already carried is still live — the row the
    // decision actions run against, and the lock the header reads.
    expect(result.current.pendingRequest?.id).toBe('req_committee_1');
    expect(result.current.pendingRequest?.lock_record).toBe(true);
  });

  it('makes no follow-up read when nothing is pending', async () => {
    gets = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        gets.push(String(url));
        return { ok: true, json: async () => ({ data: [{ ...LIST_ROW, status: 'approved' }] }) } as any;
      }),
    );
    const { result } = mount();
    await waitFor(() => expect(result.current.latestRequest).toBeTruthy());
    expect(gets.filter((u) => /\/approvals\/requests\/[^?]+$/.test(u))).toHaveLength(0);
  });
});
