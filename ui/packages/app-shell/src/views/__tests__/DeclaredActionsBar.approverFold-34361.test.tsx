// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DeclaredActionsBar — `foldDecisions`, the approver's band (objectstack#34361,
 * ruling A).
 *
 * The reported page: an approver who also submitted opened a customer record
 * under approval and saw seven approval buttons above the title, plus the
 * record's own row in the header — "two menus", with no way to tell which row
 * is the task.
 *
 * What these pin:
 *
 *   1. a viewer who can act gets ONE status line (the task, the step, the
 *      submitter), the decisions (`primary` / `danger` variant) as the only
 *      buttons, and ONE neutral menu holding every other lever — reply and,
 *      for an approver who also submitted, recall included;
 *   2. the split reads each action's declared `variant`, not a name list: an
 *      action declared without one lands in the menu;
 *   3. a viewer who cannot act (the submitter alone, the override-only admin)
 *      and a host that does not ask for the fold render as before;
 *   4. menu levers still count as drawn for `onDrawnActionsChange`;
 *   5. the request page (`ApprovalDecisionPanel`) draws the same band.
 *
 * Nothing here is a permission assertion: every lever keeps its own gates,
 * and the request it sends is unchanged.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import React from 'react';

const executeSpy = vi.fn().mockResolvedValue({ success: true });
const metadataItems = vi.hoisted(() => ({ byName: {} as Record<string, unknown> }));

// Only the dispatch and the metadata read are stubbed; the predicate entry
// stays real, as in the sibling DeclaredActionsBar suites.
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    ActionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useAction: () => ({ execute: executeSpy }),
    useMetadataItem: (_type: string, name?: string) => ({
      item: name ? metadataItems.byName[name] ?? null : null,
      loading: false,
      error: null,
    }),
  };
});

vi.mock('../../hooks/useConsoleActionRuntime', () => ({
  useConsoleActionRuntime: () => ({ actionProviderProps: {}, dialogs: null }),
}));
vi.mock('../../providers/AdapterProvider', () => ({ useAdapter: () => ({}) }));
vi.mock('../../utils/getIcon', () => ({
  getIcon: (name: string) => () => <i data-testid={`declared-icon-${name}`} />,
}));

// Interpolating `t` over `defaultValue`, so the status line reads as composed
// English.
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
import { ApprovalDecisionPanel } from '../approval-decision/ApprovalDecisionPanel';
import { resetApproverDirectoryCache } from '../../hooks/useApproverDirectory';

// Reduced gate spellings (the sibling fold suite's reasoning): the shipped
// predicates are pinned verbatim in `utils/approvalOverride.test.ts`.
const DECISION_VISIBLE = 'record.viewer.can_act || record.viewer.can_override';
const APPROVER_ONLY_VISIBLE = 'record.viewer.can_act';
const RECALL_VISIBLE =
  '(record.status == "pending" || record.status == "returned") && record.viewer.is_submitter'
  + ' || record.viewer.can_override';
const REMIND_VISIBLE = 'record.status == "pending" && record.viewer.is_submitter';
const REPLY_VISIBLE = 'record.viewer.can_act || record.status == "pending" && record.viewer.is_submitter';

const api = (verb: string) => ({
  type: 'api',
  method: 'POST',
  target: `/api/v1/approvals/requests/{id}/${verb}`,
  params: [{ name: 'comment', label: 'Comment', type: 'textarea' }],
  locations: ['record_section'],
});

/** The shipped set, in declaration order, with its declared variants. */
const ACTIONS = [
  { name: 'approval_approve', label: 'Approve', variant: 'primary', visible: DECISION_VISIBLE, ...api('approve') },
  { name: 'approval_reject', label: 'Reject', variant: 'danger', visible: DECISION_VISIBLE, ...api('reject') },
  { name: 'approval_reassign', label: 'Reassign', visible: DECISION_VISIBLE, ...api('reassign') },
  { name: 'approval_send_back', label: 'Send back', visible: APPROVER_ONLY_VISIBLE, ...api('revise') },
  { name: 'approval_request_info', label: 'Request info', visible: APPROVER_ONLY_VISIBLE, ...api('request-info') },
  { name: 'approval_remind', label: 'Remind', visible: REMIND_VISIBLE, ...api('remind') },
  { name: 'approval_recall', label: 'Recall', visible: RECALL_VISIBLE, ...api('recall') },
  { name: 'approval_comment', label: 'Reply', visible: REPLY_VISIBLE, ...api('comment') },
] as any[];

const LEADS = ['approval_approve', 'approval_reject'];
const APPROVER_MENU = ['approval_reassign', 'approval_send_back', 'approval_request_info', 'approval_comment'];

const REQUEST = {
  id: 'req_1',
  status: 'pending',
  object_name: 'account',
  record_id: 'acc_1',
  submitter_id: 'u_owner',
  submitter_name: 'Account Owner',
  step_label: 'Finance review',
  pending_approvers: ['u_fin'],
  pending_approver_names: { u_fin: 'Finance Lead' },
  flow_route: {
    steps: [
      { id: 'mgr', label: 'Manager review', state: 'done' },
      { id: 'fin', label: 'Finance review', state: 'current' },
      { id: 'cfo', label: 'CFO review', state: 'upcoming' },
    ],
    ahead: 'end',
  },
};

const APPROVER = { can_act: true, is_submitter: false, can_override: false };
const APPROVER_SUBMITTER = { can_act: true, is_submitter: true, can_override: false };
const SUBMITTER_ONLY = { can_act: false, is_submitter: true, can_override: false };
const ADMIN_ONLY = { can_act: false, is_submitter: false, can_override: true };

function renderBar(
  viewer: Record<string, unknown>,
  {
    foldDecisions = true,
    foldOverrides = true,
    actions = ACTIONS,
    onDrawnActionsChange,
    exclude,
  }: {
    foldDecisions?: boolean;
    foldOverrides?: boolean;
    actions?: any[];
    onDrawnActionsChange?: (names: string[]) => void;
    exclude?: string[];
  } = {},
) {
  return render(
    <AdapterCtx.Provider value={null as never}>
      <DeclaredActionsBar
        objectName="sys_approval_request"
        record={{ ...REQUEST, viewer }}
        location="record_section"
        actions={actions}
        exclude={exclude}
        foldOverrides={foldOverrides}
        foldDecisions={foldDecisions}
        onDrawnActionsChange={onDrawnActionsChange}
      />
    </AdapterCtx.Provider>,
  );
}

function openDecisionMenu() {
  const trigger = screen.getByTestId('declared-actions-decision-menu');
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return screen.findByRole('menu');
}

const menuNames = (menu: HTMLElement) =>
  within(menu).getAllByRole('menuitem').map((item) => item.getAttribute('data-testid')?.replace('declared-action-', ''));

/** The last set the bar reported. */
function lastReport(spy: ReturnType<typeof vi.fn>): string[] {
  return spy.mock.calls.at(-1)?.[0] ?? [];
}

beforeEach(() => {
  executeSpy.mockClear();
  resetApproverDirectoryCache();
  metadataItems.byName = {};
});

describe('DeclaredActionsBar — foldDecisions, the approver band (objectstack#34361)', () => {
  it('gives the approver a status line, the two decisions as buttons, and every other lever in one menu', async () => {
    renderBar(APPROVER);

    await waitFor(() => expect(screen.getByTestId('declared-actions-decision-menu')).toBeInTheDocument());
    const status = screen.getByTestId('declared-actions-approval-status');
    expect(status.getAttribute('data-approval-status')).toBe('approver');
    expect(status.textContent).toContain('Awaiting your approval');
    expect(status.textContent).toContain('Step 2');
    expect(status.textContent).toContain('Finance review');
    expect(status.textContent).toContain('Submitted by Account Owner');

    for (const name of LEADS) {
      expect(screen.getByTestId(`declared-action-${name}`).tagName, `${name} stays a button`).toBe('BUTTON');
    }
    for (const name of APPROVER_MENU) {
      expect(screen.queryByTestId(`declared-action-${name}`), `${name} must not be a button`).toBeNull();
    }

    const trigger = screen.getByTestId('declared-actions-decision-menu');
    expect(trigger).toHaveAccessibleName('More approval actions');
    // Neutral: the amber shield marks the override path only.
    expect(trigger.className).not.toContain('amber');

    const menu = await openDecisionMenu();
    // Declaration order; reply is in the menu, so it is always reachable.
    expect(menuNames(menu)).toEqual(APPROVER_MENU);
  });

  it('draws the decisions at equal width on a phone, with the menu at the row end', async () => {
    renderBar(APPROVER);
    await waitFor(() => expect(screen.getByTestId('declared-actions-decision-menu')).toBeInTheDocument());
    for (const name of LEADS) {
      expect(screen.getByTestId(`declared-action-${name}`).className).toContain('flex-1');
    }
    const trigger = screen.getByTestId('declared-actions-decision-menu');
    expect(trigger.className).toContain('shrink-0');
    const toolbar = screen.getByRole('toolbar');
    expect(toolbar.lastElementChild).toBe(trigger);
  });

  it('dispatches a menu lever exactly as its button would', async () => {
    renderBar(APPROVER);
    await waitFor(() => expect(screen.getByTestId('declared-actions-decision-menu')).toBeInTheDocument());
    const menu = await openDecisionMenu();
    fireEvent.click(within(menu).getByTestId('declared-action-approval_comment'));
    await waitFor(() => expect(executeSpy).toHaveBeenCalledTimes(1));

    const dispatch = executeSpy.mock.calls[0][0];
    expect(dispatch.name).toBe('approval_comment');
    expect(dispatch.target).toBe('/api/v1/approvals/requests/{id}/comment');
    expect(dispatch.params._rowRecord.id).toBe('req_1');
    expect(dispatch.overrideNotice).toBeUndefined();
  });

  it('folds the submitter levers too for an approver who also submitted', async () => {
    renderBar(APPROVER_SUBMITTER);
    await waitFor(() => expect(screen.getByTestId('declared-actions-decision-menu')).toBeInTheDocument());
    const status = screen.getByTestId('declared-actions-approval-status');
    expect(status.textContent).toContain('You submitted this');
    expect(status.textContent).not.toContain('Submitted by Account Owner');
    for (const name of LEADS) {
      expect(screen.getByTestId(`declared-action-${name}`).tagName).toBe('BUTTON');
    }
    expect(screen.queryByTestId('declared-action-approval_recall')).toBeNull();

    const menu = await openDecisionMenu();
    expect(menuNames(menu)).toEqual([
      'approval_reassign',
      'approval_send_back',
      'approval_request_info',
      'approval_remind',
      'approval_recall',
      'approval_comment',
    ]);
  });

  it('lands an action declared without a variant in the menu, not as a button', async () => {
    const escalate = { name: 'approval_escalate', label: 'Escalate', visible: APPROVER_ONLY_VISIBLE, ...api('escalate') };
    renderBar(APPROVER, { actions: [...ACTIONS, escalate] });
    await waitFor(() => expect(screen.getByTestId('declared-actions-decision-menu')).toBeInTheDocument());
    expect(screen.queryByTestId('declared-action-approval_escalate')).toBeNull();
    const menu = await openDecisionMenu();
    expect(menuNames(menu)).toContain('approval_escalate');
  });

  it("leaves the submitter-only viewer's bar unchanged", () => {
    renderBar(SUBMITTER_ONLY);
    expect(screen.queryByTestId('declared-actions-decision-menu')).toBeNull();
    expect(screen.queryByTestId('declared-actions-approval-status')).toBeNull();
    for (const name of ['approval_remind', 'approval_recall', 'approval_comment']) {
      expect(screen.getByTestId(`declared-action-${name}`).tagName).toBe('BUTTON');
    }
    for (const name of [...LEADS, 'approval_reassign']) {
      expect(screen.queryByTestId(`declared-action-${name}`)).toBeNull();
    }
  });

  it('leaves the override-only admin on the override fold, unchanged', async () => {
    renderBar(ADMIN_ONLY);
    expect(screen.queryByTestId('declared-actions-decision-menu')).toBeNull();
    expect(screen.getByTestId('declared-actions-override-menu')).toBeInTheDocument();
    const status = screen.getByTestId('declared-actions-approval-status');
    expect(status.getAttribute('data-approval-status')).toBeNull();
    expect(status.textContent).toContain('Waiting on');
    expect(status.textContent).not.toContain('Awaiting your approval');
  });

  it('leaves a host that does not ask for the fold unchanged', () => {
    renderBar(APPROVER, { foldDecisions: false });
    expect(screen.queryByTestId('declared-actions-decision-menu')).toBeNull();
    expect(screen.queryByTestId('declared-actions-approval-status')).toBeNull();
    for (const name of [...LEADS, ...APPROVER_MENU]) {
      expect(screen.getByTestId(`declared-action-${name}`).tagName).toBe('BUTTON');
    }
  });

  it('keeps the levers as buttons when no more than two are shown', async () => {
    // Approve and Reply only: nothing worth a menu.
    renderBar(APPROVER, { actions: [ACTIONS[0], ACTIONS[7]] });
    await waitFor(() => expect(screen.getByTestId('declared-action-approval_comment').tagName).toBe('BUTTON'));
    expect(screen.getByTestId('declared-action-approval_approve').tagName).toBe('BUTTON');
    expect(screen.queryByTestId('declared-actions-decision-menu')).toBeNull();
    // Still the approver's band: the task is named.
    expect(screen.getByTestId('declared-actions-approval-status').textContent).toContain('Awaiting your approval');
  });

  it('reports the menu levers as drawn, never a hidden one, and an empty set on unmount', async () => {
    const spy = vi.fn();
    const { unmount } = renderBar(APPROVER, { onDrawnActionsChange: spy });
    await waitFor(() => expect([...lastReport(spy)].sort()).toEqual([...LEADS, ...APPROVER_MENU].sort()));
    // Recall and remind are the submitter's: not drawn for this approver.
    expect(lastReport(spy)).not.toContain('approval_recall');

    cleanup();
    spy.mockClear();
    renderBar(APPROVER_SUBMITTER, { onDrawnActionsChange: spy });
    await waitFor(() => expect(lastReport(spy)).toContain('approval_recall'));
    unmount();
  });

  it('reports an empty set when the band goes away', async () => {
    const spy = vi.fn();
    const { unmount } = renderBar(APPROVER_SUBMITTER, { onDrawnActionsChange: spy });
    await waitFor(() => expect(lastReport(spy)).toContain('approval_recall'));
    unmount();
    expect(lastReport(spy)).toEqual([]);
  });
});

describe('ApprovalDecisionPanel — the request page draws the same band (objectstack#34361)', () => {
  it('folds the approver levers on the request page as on the record page', async () => {
    metadataItems.byName = { sys_approval_request: { name: 'sys_approval_request', actions: ACTIONS } };
    render(
      <AdapterCtx.Provider value={null as never}>
        <ApprovalDecisionPanel request={{ ...REQUEST, process_name: 'deal_review', viewer: APPROVER_SUBMITTER } as any} />
      </AdapterCtx.Provider>,
    );

    const panel = screen.getByTestId('approval-decision-panel');
    await waitFor(() => expect(within(panel).getByTestId('declared-actions-decision-menu')).toBeInTheDocument());
    expect(within(panel).getByTestId('declared-actions-approval-status').textContent).toContain('Awaiting your approval');
    for (const name of LEADS) {
      expect(within(panel).getByTestId(`declared-action-${name}`).tagName).toBe('BUTTON');
    }
    // The request page excludes nothing, so remind sits in the menu with the rest.
    for (const name of ['approval_reassign', 'approval_remind', 'approval_recall', 'approval_comment']) {
      expect(within(panel).queryByTestId(`declared-action-${name}`)).toBeNull();
    }
    const menu = await openDecisionMenu();
    expect(menuNames(menu)).toEqual([
      'approval_reassign',
      'approval_send_back',
      'approval_request_info',
      'approval_remind',
      'approval_recall',
      'approval_comment',
    ]);
  });
});

// objectstack#35016 — the band's menu entry is named, never a bare `⋯`: the
// record header keeps the page's one `⋯`, so the two are told apart by look.
describe('DeclaredActionsBar — the approver band names its menu entry (objectstack#35016)', () => {
  it('draws the entry as its label and a chevron, with no ⋯ glyph, at every width', async () => {
    renderBar(APPROVER);
    const trigger = await screen.findByTestId('declared-actions-decision-menu');
    expect(trigger.textContent).toBe('More approval actions');
    // No `hidden sm:inline` on the label: it is the name on a phone too.
    expect(trigger.querySelector('span')?.className ?? '').not.toContain('hidden');
    expect(trigger.querySelector('svg.lucide-ellipsis, svg.lucide-more-horizontal')).toBeNull();
    expect(trigger.querySelector('svg.lucide-chevron-down')).toBeTruthy();
  });
});
