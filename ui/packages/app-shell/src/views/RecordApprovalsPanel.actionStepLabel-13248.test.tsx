/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The approval timeline draws each row's AUTHORED step label (objectui#13248).
 *
 * Measured on HotCRM: a record's approval history read "· Manager Review" (the
 * `manager_review` node id, prettified) where the flow author wrote "Sales
 * Manager Review". The panel's headline already drew the authored label; the
 * rows prettified `step_name`.
 *
 * The rows cannot read the label off themselves: `GET
 * /approvals/requests/:id/actions` serves an action row without
 * `step_label` (the server stores that column as a copy of the owning
 * request's step label, and does not put it on this door's wire). So the stub
 * rows below carry exactly what that door sends, `step_name` and no label,
 * and the label comes from the row's request, which the panel already holds.
 *
 * Every row is awaited before anything is asserted (the settle rule
 * `RecordApprovalsPanel.viaOverrideMarker.test.tsx` explains), and each case
 * that reads a fallback has a labelled row in the same DOM, so a panel that
 * prettifies every row cannot pass it.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import type { ApprovalRequestLite } from '../hooks/useRecordApprovals';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthenticatedFetch: () => vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { RecordApprovalsPanel } from './RecordApprovalsPanel';

/** Level 1, decided: the `manager_review` node, authored "Sales Manager Review". */
const L1: ApprovalRequestLite = {
  id: 'req_l1',
  process_name: 'flow:opportunity_approval',
  process_label: 'Large Deal Approval',
  object_name: 'opportunity',
  record_id: 'rec_1',
  status: 'approved',
  current_step: 'manager_review',
  step_label: 'Sales Manager Review',
  submitter_id: 'u_submitter',
  submitted_at: '2026-08-01T08:00:00Z',
  completed_at: '2026-08-02T08:00:00Z',
};

/** Level 2, pending: the `finance_review` node, authored "Finance Director Sign-off". */
const L2: ApprovalRequestLite = {
  id: 'req_l2',
  process_name: 'flow:opportunity_approval',
  process_label: 'Large Deal Approval',
  object_name: 'opportunity',
  record_id: 'rec_1',
  status: 'pending',
  current_step: 'finance_review',
  step_label: 'Finance Director Sign-off',
  submitter_id: 'u_submitter',
  submitted_at: '2026-08-02T08:05:00Z',
};

/** The same request as a backend that serves no step label sends it. */
function withoutLabel(r: ApprovalRequestLite): ApprovalRequestLite {
  const rest = { ...r };
  delete rest.step_label;
  return rest;
}

/**
 * A row of the stubbed actions door, in the shape that door sends: a
 * `step_name`, and no `step_label`.
 */
interface StubAction {
  id: string;
  request_id: string;
  action: string;
  step_name: string;
  actor_id: string;
  actor_name: string;
  created_at: string;
}

const ACTIONS_BY_REQUEST: Record<string, StubAction[]> = {
  req_l1: [
    {
      id: 'a1', request_id: 'req_l1', action: 'submit', step_name: 'manager_review',
      actor_id: 'u_submitter', actor_name: 'Zhou Ming', created_at: '2026-08-01T08:00:00Z',
    },
    {
      id: 'a2', request_id: 'req_l1', action: 'approve', step_name: 'manager_review',
      actor_id: 'u_manager', actor_name: 'Wang Fang', created_at: '2026-08-02T08:00:00Z',
    },
  ],
  req_l2: [
    {
      id: 'a3', request_id: 'req_l2', action: 'comment', step_name: 'finance_review',
      actor_id: 'u_finance', actor_name: 'Li Lei', created_at: '2026-08-02T09:00:00Z',
    },
  ],
};

const ACTORS = ['Zhou Ming', 'Wang Fang', 'Li Lei'];

function stubApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const m = String(url).match(/\/approvals\/requests\/([^/]+)\/actions$/);
      if (m) {
        return { ok: true, json: async () => ({ data: ACTIONS_BY_REQUEST[m[1]] ?? [] }) } as unknown as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    }),
  );
}

/** Render, then wait for every stubbed row before any assertion runs. */
async function renderPanel(requests: ApprovalRequestLite[]) {
  stubApi();
  render(
    <RecordApprovalsPanel
      approvals={{
        available: true,
        requests,
        pendingRequest: requests.find((r) => r.status === 'pending') ?? null,
      }}
      currentUserId="u_viewer"
    />,
  );
  try {
    for (const name of ACTORS) await screen.findByText(name);
  } catch {
    throw new Error(
      'TIMELINE ROWS NEVER ARRIVED: the stubbed actions flush had not landed, so the step '
      + 'labels below were not tested by this run. This is a timing reading, not a label one.',
    );
  }
}

/** The step text the given actor's row draws, or null when it draws none. */
function stepOf(actorName: string): string | null {
  const li = screen.getByText(actorName).closest('li');
  if (!li) throw new Error(`no timeline row for ${actorName}`);
  const step = within(li as HTMLElement).queryByTestId('approval-action-step');
  return step ? (step.textContent ?? '').replace(/\s+/g, ' ').trim() : null;
}

/** The headline's flow-and-step line. */
function headlineText(): string {
  const panel = screen.getByTestId('record-approvals-panel');
  const header = panel.firstElementChild as HTMLElement;
  return (header.textContent ?? '').replace(/\s+/g, ' ').trim();
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RecordApprovalsPanel — timeline rows draw the authored step label (objectui#13248)', () => {
  it('draws each row\'s request step label, not the prettified node id', async () => {
    await renderPanel([L2, L1]);
    expect(stepOf('Wang Fang')).toBe('· Sales Manager Review');
    expect(stepOf('Zhou Ming')).toBe('· Sales Manager Review');
    // Keyed per row: the level-2 row draws level 2's label, not level 1's,
    // and not the headline's by accident of being the pending one.
    expect(stepOf('Li Lei')).toBe('· Finance Director Sign-off');
  });

  it('falls back to the prettified step_name when the request carries no step label', async () => {
    await renderPanel([withoutLabel(L2), withoutLabel(L1)]);
    expect(stepOf('Wang Fang')).toBe('· Manager Review');
    expect(stepOf('Li Lei')).toBe('· Finance Review');
  });

  it('decides per row: a labelled request\'s rows keep the label beside an unlabelled one\'s fallback', async () => {
    await renderPanel([withoutLabel(L2), L1]);
    // The live control for the fallback below, in the same DOM.
    expect(stepOf('Wang Fang')).toBe('· Sales Manager Review');
    expect(stepOf('Li Lei')).toBe('· Finance Review');
  });

  it('draws the pending step the same way in the headline and in its timeline row', async () => {
    await renderPanel([L2, L1]);
    expect(headlineText()).toContain('Large Deal Approval · Finance Director Sign-off');
    expect(stepOf('Li Lei')).toBe('· Finance Director Sign-off');
  });
});
