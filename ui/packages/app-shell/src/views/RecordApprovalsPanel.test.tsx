/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * RecordApprovalsPanel — the record page's read-only approval surface
 * (objectui#3461).
 *
 * The bug this pins: a record in approval showed NOTHING about who it was
 * waiting on to anyone but the pending approver — the pending-approver list
 * and the decision timeline lived only in the Approval Center (a `setup`-app
 * surface business roles can't reach). These tests assert the panel:
 *
 *   1. renders the waiting-on chips with server-RESOLVED names and 会签 group
 *      labels for a viewer who is NOT an approver — read-gated visibility is
 *      the whole point, so no `canDecide` anywhere near the render gate;
 *   2. merges the action threads of EVERY request on the record (a
 *      multi-level flow opens one request per node) into one chronological
 *      timeline;
 *   3. offers remind to the submitter only — `viewer.is_submitter` from the
 *      server, id-match fallback for older backends — and POSTs the
 *      documented endpoint;
 *   4. renders no chrome at all for a record with no requests.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import type { ApprovalRequestLite } from '../hooks/useRecordApprovals';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

import { toast } from 'sonner';
import { RecordApprovalsPanel, approverChips, mergeActionTimelines } from './RecordApprovalsPanel';

/** Level-1 request — finalized; its thread carries the level-1 decision. */
const REQ_L1: ApprovalRequestLite = {
  id: 'req_l1',
  process_name: 'flow:qif_review',
  process_label: 'QIF Review',
  object_name: 'qif_report',
  record_id: 'rec_1',
  status: 'approved',
  submitter_id: 'u_submitter',
  submitter_name: 'Zhou Ming',
  submitted_at: '2026-08-01T08:00:00Z',
  completed_at: '2026-08-02T08:00:00Z',
};

/** Level-2 request — pending 会签 across two groups, enriched single read. */
const REQ_L2: ApprovalRequestLite = {
  id: 'req_l2',
  process_name: 'flow:qif_review',
  process_label: 'QIF Review',
  object_name: 'qif_report',
  record_id: 'rec_1',
  status: 'pending',
  current_step: 'joint_signoff',
  step_label: 'Joint Sign-off',
  submitter_id: 'u_submitter',
  submitter_name: 'Zhou Ming',
  submitted_at: '2026-08-02T08:05:00Z',
  pending_approvers: ['u_qa_head', 'u_prod_head', 'u_prod_head'],
  pending_approver_names: { u_qa_head: 'Qian Hua', u_prod_head: 'Li Lei' },
  pending_approver_groups: { u_qa_head: ['quality'], u_prod_head: ['production'] },
  decision_progress: {
    behavior: 'per_group',
    got: 1,
    need: 2,
    groups: [
      { group: 'quality', got: 1, need: 1, satisfied: true },
      { group: 'production', got: 0, need: 1, satisfied: false },
    ],
  },
  viewer: { can_act: false, is_submitter: false },
};

const ACTIONS_BY_REQUEST: Record<string, any[]> = {
  req_l1: [
    { id: 'a1', request_id: 'req_l1', action: 'submit', actor_id: 'u_submitter', actor_name: 'Zhou Ming', created_at: '2026-08-01T08:00:00Z' },
    { id: 'a2', request_id: 'req_l1', action: 'approve', actor_id: 'u_dept_head', actor_name: 'Wang Fang', comment: 'Level 1 OK', created_at: '2026-08-02T08:00:00Z' },
  ],
  req_l2: [
    { id: 'a3', request_id: 'req_l2', action: 'submit', actor_id: 'u_submitter', actor_name: 'Zhou Ming', created_at: '2026-08-02T08:05:00Z' },
  ],
};

/** Every request the stub answered, plus every POST body it captured. */
let actionGets: string[];
let remindPosts: string[];

function stubApi() {
  actionGets = [];
  remindPosts = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'POST' && /\/approvals\/requests\/[^/]+\/remind$/.test(u)) {
        remindPosts.push(u);
        return { ok: true, json: async () => ({ notified: 2 }) } as any;
      }
      const m = u.match(/\/approvals\/requests\/([^/]+)\/actions$/);
      if (m) {
        actionGets.push(m[1]);
        return { ok: true, json: async () => ({ data: ACTIONS_BY_REQUEST[m[1]] ?? [] }) } as any;
      }
      return { ok: false, status: 404, json: async () => ({}) } as any;
    }),
  );
}

function renderPanel(overrides: {
  requests?: ApprovalRequestLite[];
  pendingRequest?: ApprovalRequestLite | null;
  available?: boolean;
  currentUserId?: string;
} = {}) {
  const requests = overrides.requests ?? [REQ_L2, REQ_L1];
  return render(
    <RecordApprovalsPanel
      approvals={{
        available: overrides.available ?? true,
        requests,
        pendingRequest:
          overrides.pendingRequest !== undefined
            ? overrides.pendingRequest
            : requests.find((r) => r.status === 'pending') ?? null,
      }}
      currentUserId={overrides.currentUserId ?? 'u_viewer'}
    />,
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  stubApi();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RecordApprovalsPanel — read-gated approval visibility (objectui#3461)', () => {
  it('shows resolved waiting-on chips with 会签 groups to a non-approver viewer', async () => {
    renderPanel(); // u_viewer holds no approver slot and did not submit
    expect(await screen.findByTestId('record-approvals-panel')).toBeTruthy();
    expect(screen.getByText('Waiting on')).toBeTruthy();
    // Server-resolved display names — never the raw ids the API row carries.
    expect(screen.getByText('Qian Hua')).toBeTruthy();
    expect(screen.getByText('Li Lei')).toBeTruthy();
    expect(screen.queryByText('u_qa_head')).toBeNull();
    // Group label + the collapsed ×2 count for the double-slot approver.
    expect(screen.getByText('· production')).toBeTruthy();
    expect(screen.getByText('×2')).toBeTruthy();
    // The per-group branch of the tally copy. (The literal counts are
    // interpolated by i18next, which this render intentionally runs without —
    // the group badges below carry the numbers.)
    expect(screen.getByText(/Sign-off progress/)).toBeTruthy();
    expect(screen.getByText(/quality 1\/1/)).toBeTruthy();
    expect(screen.getByText(/production 0\/1/)).toBeTruthy();
    // Header carries the flow label, current step, and pending status.
    expect(screen.getByText(/QIF Review/)).toBeTruthy();
    expect(screen.getByText('Pending')).toBeTruthy();
  });

  it('merges every request\'s action thread into one chronological timeline', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Wang Fang')).toBeTruthy());
    // Both requests were read — the level-1 decision is part of the story.
    expect(actionGets.sort()).toEqual(['req_l1', 'req_l2']);
    expect(screen.getByText('"Level 1 OK"')).toBeTruthy();
    // Chronological: level-1 submit first, level-2 submit last.
    const items = screen.getAllByRole('listitem');
    expect(items[0].textContent).toContain('Zhou Ming');
    expect(items[1].textContent).toContain('Wang Fang');
    expect(items).toHaveLength(3);
  });

  it('offers remind to the submitter and POSTs the remind endpoint', async () => {
    const pending = {
      ...REQ_L2,
      viewer: { can_act: false, is_submitter: true },
    };
    renderPanel({ requests: [pending, REQ_L1], pendingRequest: pending });
    const btn = await screen.findByRole('button', { name: /Send reminder/ });
    fireEvent.click(btn);
    await waitFor(() => expect(remindPosts).toHaveLength(1));
    expect(remindPosts[0]).toMatch(/\/approvals\/requests\/req_l2\/remind$/);
    await waitFor(() => expect((toast as any).success).toHaveBeenCalled());
  });

  it('falls back to a submitter-id match when the backend sends no viewer', async () => {
    const pending = { ...REQ_L2, viewer: undefined };
    renderPanel({
      requests: [pending, REQ_L1],
      pendingRequest: pending,
      currentUserId: 'u_submitter',
    });
    expect(await screen.findByRole('button', { name: /Send reminder/ })).toBeTruthy();
  });

  it('hides remind from a viewer who is not the submitter', async () => {
    renderPanel(); // viewer.is_submitter false, id mismatch
    await screen.findByTestId('record-approvals-panel');
    expect(screen.queryByRole('button', { name: /Send reminder/ })).toBeNull();
  });

  it('renders nothing for a record with no approval requests', () => {
    renderPanel({ requests: [], pendingRequest: null });
    expect(screen.queryByTestId('record-approvals-panel')).toBeNull();
  });

  it('renders nothing when the approvals plugin is unavailable', () => {
    renderPanel({ available: false });
    expect(screen.queryByTestId('record-approvals-panel')).toBeNull();
  });
});

describe('approverChips', () => {
  it('keeps the same person as separate chips per group, collapsing duplicates within one', () => {
    const chips = approverChips({
      ...REQ_L2,
      pending_approvers: ['u_a', 'u_a', 'u_a'],
      pending_approver_names: { u_a: 'Ann' },
      pending_approver_groups: { u_a: ['finance'] },
    });
    expect(chips).toEqual([
      { label: 'Ann', group: 'finance', count: 3, title: 'u_a' },
    ]);
  });

  it('degrades to plain name chips when no group data exists', () => {
    const chips = approverChips({
      ...REQ_L2,
      pending_approvers: ['u_a', 'u_b'],
      pending_approver_names: { u_a: 'Ann' },
      pending_approver_groups: null,
    });
    expect(chips.map((c) => c.label)).toEqual(['Ann', 'u_b']);
    expect(chips.every((c) => c.group === undefined)).toBe(true);
  });
});

describe('mergeActionTimelines', () => {
  it('sorts merged threads chronologically regardless of per-thread order', () => {
    const merged = mergeActionTimelines([
      [
        { id: 'b', request_id: 'r2', action: 'submit', created_at: '2026-08-02T00:00:00Z' },
      ],
      [
        { id: 'c', request_id: 'r1', action: 'approve', created_at: '2026-08-03T00:00:00Z' },
        { id: 'a', request_id: 'r1', action: 'submit', created_at: '2026-08-01T00:00:00Z' },
      ],
    ]);
    expect(merged.map((a) => a.id)).toEqual(['a', 'b', 'c']);
  });
});
