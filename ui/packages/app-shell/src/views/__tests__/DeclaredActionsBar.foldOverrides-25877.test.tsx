// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DeclaredActionsBar — `foldOverrides` (objectstack#25877).
 *
 * The reported page: an administrator who is not the approver opened a record
 * under approval and the first row above the title was five buttons — Override
 * Approve / Override Reject / Override Reassign, Recall, Reply — the exception
 * path drawn as the most prominent thing on the page.
 *
 * What these pin:
 *
 *   1. an override-only viewer gets ONE status line (pending, and who the step
 *      waits on, by name) and ONE marked menu holding every lever the override
 *      flag admits, recall included; the levers it does not admit (reply) stay
 *      buttons;
 *   2. a folded lever is the same lever: picking it dispatches the same action
 *      with the same override notice the button form sends;
 *   3. the approver's own bar is unchanged, and so is any host that does not
 *      ask for the fold.
 *
 * Nothing here is a permission assertion: the folded set is chosen by the same
 * declared gates, and the request a lever sends is unchanged.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';

const executeSpy = vi.fn().mockResolvedValue({ success: true });

// Only the dispatch is stubbed; the predicate entry stays real, as in the
// sibling DeclaredActionsBar suites.
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    ActionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useAction: () => ({ execute: executeSpy }),
  };
});

vi.mock('../../hooks/useConsoleActionRuntime', () => ({
  useConsoleActionRuntime: () => ({ actionProviderProps: {}, dialogs: null }),
}));
vi.mock('../../providers/AdapterProvider', () => ({ useAdapter: () => ({}) }));
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadataItem: () => ({ item: null, loading: false, error: null }),
}));
vi.mock('../../utils/getIcon', () => ({
  getIcon: (name: string) => () => <i data-testid={`declared-icon-${name}`} />,
}));

// Interpolating `t` over `defaultValue`, so the status line and the override
// labels read as composed English.
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectLabel: () => ({
    actionLabel: (_o: unknown, _n: unknown, fallback: string) => fallback,
    actionConfirm: (_o: unknown, _n: unknown, fallback?: string) => fallback,
    actionSuccess: (_o: unknown, _n: unknown, fallback?: string) => fallback,
  }),
  useObjectTranslation: () => ({
    t: (key: string, options?: any) =>
      String(options?.defaultValue ?? key).replace(
        /\{\{(\w+)\}\}/g,
        (_m: string, name: string) => String(options?.[name] ?? ''),
      ),
    language: 'en',
  }),
  pickLocalized: (value: unknown) => (typeof value === 'string' ? value : ''),
}));

import { AdapterCtx } from '@object-ui/react';
import { DeclaredActionsBar } from '../DeclaredActionsBar';
import { resetApproverDirectoryCache } from '../../hooks/useApproverDirectory';

// The reduced gate spellings the sibling override suite uses, for the reason
// it gives: `actionAdmittedByOverride` reads only whether `can_override` is
// ORed in, and is pinned against the verbatim shipped predicates in
// `utils/approvalOverride.test.ts`.
const DECISION_VISIBLE = 'record.viewer.can_act || record.viewer.can_override';
const RECALL_VISIBLE =
  '(record.status == "pending" || record.status == "returned") && record.viewer.is_submitter'
  + ' || record.viewer.can_override';
// Reply has no override arm (the route has none).
const REPLY_VISIBLE = 'record.viewer.can_act || record.status == "pending" && record.viewer.is_submitter';

const ACTIONS = [
  {
    name: 'approval_approve',
    label: 'Approve',
    variant: 'primary',
    type: 'api',
    method: 'POST',
    target: '/api/v1/approvals/requests/{id}/approve',
    params: [{ name: 'comment', label: 'Comment', type: 'textarea' }],
    visible: DECISION_VISIBLE,
    locations: ['record_section'],
  },
  {
    name: 'approval_reject',
    label: 'Reject',
    variant: 'danger',
    type: 'api',
    method: 'POST',
    target: '/api/v1/approvals/requests/{id}/reject',
    params: [{ name: 'comment', label: 'Comment', type: 'textarea' }],
    visible: DECISION_VISIBLE,
    locations: ['record_section'],
  },
  {
    name: 'approval_reassign',
    label: 'Reassign',
    type: 'api',
    method: 'POST',
    target: '/api/v1/approvals/requests/{id}/reassign',
    params: [{ name: 'to', label: 'To', type: 'text' }],
    visible: DECISION_VISIBLE,
    locations: ['record_section'],
  },
  {
    name: 'approval_recall',
    label: 'Recall',
    type: 'api',
    method: 'POST',
    target: '/api/v1/approvals/requests/{id}/recall',
    params: [{ name: 'comment', label: 'Comment', type: 'textarea' }],
    visible: RECALL_VISIBLE,
    locations: ['record_section'],
  },
  {
    name: 'approval_comment',
    label: 'Reply',
    type: 'api',
    method: 'POST',
    target: '/api/v1/approvals/requests/{id}/comment',
    params: [{ name: 'comment', label: 'Comment', type: 'textarea' }],
    visible: REPLY_VISIBLE,
    locations: ['record_section'],
  },
] as any[];

const FOLDED = ['approval_approve', 'approval_reject', 'approval_reassign', 'approval_recall'];

const REQUEST = {
  id: 'req_1',
  status: 'pending',
  record_id: 'opp_1',
  pending_approvers: ['u_sales_mgr'],
  pending_approver_names: { u_sales_mgr: 'Sales Manager' },
};

/** The reported viewer: an admin who submitted the record and holds no slot. */
const ADMIN_SUBMITTER = { can_act: false, is_submitter: true, can_override: true };
const ADMIN_ONLY = { can_act: false, is_submitter: false, can_override: true };
const APPROVER = { can_act: true, is_submitter: false, can_override: false };

function renderBar(viewer: Record<string, unknown>, foldOverrides = true) {
  return render(
    <AdapterCtx.Provider value={null as never}>
      <DeclaredActionsBar
        objectName="sys_approval_request"
        record={{ ...REQUEST, viewer }}
        location="record_section"
        actions={ACTIONS}
        foldOverrides={foldOverrides}
      />
    </AdapterCtx.Provider>,
  );
}

function openOverrideMenu() {
  const trigger = screen.getByTestId('declared-actions-override-menu');
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return screen.findByRole('menu');
}

beforeEach(() => {
  executeSpy.mockClear();
  resetApproverDirectoryCache();
});

describe('DeclaredActionsBar — foldOverrides (objectstack#25877)', () => {
  it('folds the override levers and recall into one marked menu for an admin who is not the approver', async () => {
    renderBar(ADMIN_SUBMITTER);

    // The row above the title is now a status line, reply, and one menu.
    const status = screen.getByTestId('declared-actions-approval-status');
    expect(status.textContent).toContain('Pending');
    expect(status.textContent).toContain('Waiting on');
    expect(status.textContent).toContain('Sales Manager');

    for (const name of FOLDED) {
      expect(screen.queryByTestId(`declared-action-${name}`), `${name} must not be a button`).toBeNull();
    }
    // Reply has no override arm, so it stays a visible button.
    expect(screen.getByTestId('declared-action-approval_comment').tagName).toBe('BUTTON');
    const trigger = screen.getByTestId('declared-actions-override-menu');
    expect(trigger).toHaveAccessibleName('Admin override');

    const menu = await openOverrideMenu();
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((item) => item.getAttribute('data-testid'))).toEqual(
      FOLDED.map((name) => `declared-action-${name}`),
    );
    // The levers keep their override framing inside the menu…
    expect(within(menu).getByTestId('declared-action-approval_approve').textContent).toContain('Override Approve');
    expect(within(menu).getByTestId('declared-action-approval_approve').getAttribute('data-override-decision')).toBe('true');
    // …and the submitter's own recall stays the plain Recall (objectui#13225).
    const recall = within(menu).getByTestId('declared-action-approval_recall');
    expect(recall.textContent).toBe('Recall');
    expect(recall.getAttribute('data-override-decision')).toBeNull();
  });

  it('dispatches a folded lever exactly as the button form does, override notice included', async () => {
    renderBar(ADMIN_ONLY);
    const menu = await openOverrideMenu();
    fireEvent.click(within(menu).getByTestId('declared-action-approval_approve'));
    await waitFor(() => expect(executeSpy).toHaveBeenCalledTimes(1));

    const dispatch = executeSpy.mock.calls[0][0];
    expect(dispatch.name).toBe('approval_approve');
    expect(dispatch.target).toBe('/api/v1/approvals/requests/{id}/approve');
    expect(dispatch.params._rowRecord.id).toBe('req_1');
    expect(dispatch.label).toBe('Override Approve');
    expect(String(dispatch.overrideNotice)).toContain('Sales Manager');
  });

  it('folds the override-arm recall too for an admin who did not submit', async () => {
    renderBar(ADMIN_ONLY);
    // Reply is not theirs (no slot, not the submitter), so the row is the
    // status line and the menu alone.
    expect(screen.queryByTestId('declared-action-approval_comment')).toBeNull();
    const menu = await openOverrideMenu();
    const recall = within(menu).getByTestId('declared-action-approval_recall');
    expect(recall.textContent).toBe('Override Recall');
    expect(recall.getAttribute('data-override-decision')).toBe('true');
  });

  it("leaves the approver's own bar unchanged", () => {
    renderBar(APPROVER);
    expect(screen.queryByTestId('declared-actions-override-menu')).toBeNull();
    expect(screen.queryByTestId('declared-actions-approval-status')).toBeNull();
    for (const name of ['approval_approve', 'approval_reject', 'approval_reassign', 'approval_comment']) {
      expect(screen.getByTestId(`declared-action-${name}`).tagName).toBe('BUTTON');
    }
  });

  it('leaves a host that does not ask for the fold unchanged', () => {
    renderBar(ADMIN_SUBMITTER, false);
    expect(screen.queryByTestId('declared-actions-override-menu')).toBeNull();
    for (const name of [...FOLDED, 'approval_comment']) {
      expect(screen.getByTestId(`declared-action-${name}`).tagName).toBe('BUTTON');
    }
  });
});
