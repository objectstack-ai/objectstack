/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `AiPendingActionsInbox` on a host with NO `I18nProvider` — objectui#7173.
 *
 * ## Why this is a separate file and not one more case in the i18n suite
 *
 * `createI18n` installs its instance as react-i18next's module-level global
 * (`initReactI18next`), so once any test in a file has mounted an
 * `I18nProvider`, a later provider-less render in the SAME file reads that
 * global rather than the component's defaults map. Measured while writing the
 * sibling suite: two mounts in one test — `renderIn('zh')` then a bare
 * `render(...)` — produced two zh trees, and a "provider-less" assertion there
 * would have been quietly measuring the previous test's pack instead. Vitest
 * isolates module state per FILE, so a file that never mounts a provider is the
 * only place this leg can honestly be measured.
 *
 * ## What this leg is, and is not, evidence of
 *
 * It does NOT discriminate the conversion: every `aiApprovals.*` `en` value is
 * byte-identical to the literal it replaced, so English renders either way. It
 * holds the two directions English CAN speak to:
 *
 *   - no key ever reaches the DOM raw (`aiApprovals.title` in the card header
 *     is what a missing defaults row would look like), and
 *   - `{{count}}` is interpolated on this path too — `interpolateFallback`, not
 *     i18next, does it here, and it resolves exactly one spelling
 *     (objectui#3512 / #6219). A `{{ count }}` would ship literal braces.
 *
 * No inline `defaultValue` anywhere (objectui#3517): the English comes from the
 * component's defaults map, which mirrors the `en` pack row for row.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import type { PendingActionRow } from '@objectstack/spec/contracts';
import { AiPendingActionsInbox } from '../AiPendingActionsInbox';

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

function rows(): PendingActionRow[] {
  const base = {
    object_name: 'task',
    action_name: 'delete',
    tool_name: 'action_delete_task',
    tool_input: '{"id":"t1"}',
    status: 'pending' as const,
    proposed_by: 'agent_1',
  };
  return [
    { ...base, id: 'aaaaaaaa1111', proposed_at: ago(30 * SEC) },
    { ...base, id: 'bbbbbbbb2222', proposed_at: ago(50 * SEC) },
    { ...base, id: 'cccccccc3333', proposed_at: ago(3 * HOUR) },
    { ...base, id: 'dddddddd4444', proposed_at: ago(20 * DAY) },
  ];
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ items: rows(), total: rows().length }),
    }) as unknown as Response),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * The desktop face. Below `md` the same rows are also drawn as phone cards
 * (objectstack#35449); happy-dom applies no stylesheet, so both faces are in
 * the DOM here, and a single-match lookup on a row's text reads the table.
 */
const tableFace = () => within(screen.getByRole('table'));

/** Every key the component reads, in the spelling it reads them. */
const KEYS = [
  'detail.justNow', 'detail.minutesAgo', 'detail.hoursAgo', 'detail.daysAgo',
  'common.refresh', 'common.cancel', 'common.loading', 'common.ok',
  'aiApprovals.title', 'aiApprovals.description', 'aiApprovals.tabPending',
  'aiApprovals.tabDecided', 'aiApprovals.tabAll', 'aiApprovals.statusPending',
  'aiApprovals.statusApproved', 'aiApprovals.statusHeld', 'aiApprovals.statusExecuted', 'aiApprovals.statusFailed',
  'aiApprovals.statusRejected', 'aiApprovals.colTool', 'aiApprovals.colAction',
  'aiApprovals.colObject', 'aiApprovals.colStatus', 'aiApprovals.colProposed',
  'aiApprovals.colDecision', 'aiApprovals.emptyTitle', 'aiApprovals.emptyDescription',
  'aiApprovals.view', 'aiApprovals.approve', 'aiApprovals.reject', 'aiApprovals.working',
  'aiApprovals.approveAndExecute', 'aiApprovals.outcomeApprove', 'aiApprovals.outcomeReject',
  'aiApprovals.outcomeExecuteFailed', 'aiApprovals.drawerFallbackTitle',
  'aiApprovals.drawerSubtitle', 'aiApprovals.fieldProposedBy', 'aiApprovals.fieldDecidedBy',
  'aiApprovals.fieldConversation', 'aiApprovals.fieldToolInput', 'aiApprovals.fieldResult',
  'aiApprovals.fieldError', 'aiApprovals.fieldRejectionReason', 'aiApprovals.rejectTitle',
  'aiApprovals.rejectBody', 'aiApprovals.rejectPlaceholder',
];

describe('AiPendingActionsInbox with no I18nProvider (objectui#7173)', () => {
  it('reads English from the defaults map, never a raw key', async () => {
    render(<AiPendingActionsInbox pollInterval={0} />);
    await waitFor(() => expect(tableFace().getByText('just now')).toBeTruthy());

    expect(screen.getByText('AI Approvals')).toBeTruthy();
    expect(
      screen.getByText('Actions an AI agent proposed that need a human review before execution.'),
    ).toBeTruthy();
    expect(screen.getByText('Tool')).toBeTruthy();
    expect(screen.getByText('Decision')).toBeTruthy();
    expect(screen.getByText('Refresh')).toBeTruthy();

    for (const k of KEYS) expect(screen.queryByText(k)).toBeNull();
  });

  it('interpolates {{count}} on the fallback path — no literal braces', async () => {
    render(<AiPendingActionsInbox pollInterval={0} />);
    await waitFor(() => expect(tableFace().getByText('just now')).toBeTruthy());

    expect(tableFace().getByText('1m ago')).toBeTruthy();
    expect(tableFace().getByText('3h ago')).toBeTruthy();
    expect(tableFace().getByText('20d ago')).toBeTruthy();
    expect(screen.queryByText(/\{\{\s*(count|id|message|tool|object)\s*\}\}/)).toBeNull();
  });

  it('translates the empty state and the reject dialog from the defaults map', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({ items: [], total: 0 }) }) as unknown as Response),
    );
    render(<AiPendingActionsInbox pollInterval={0} />);

    await waitFor(() => expect(screen.getByText('No actions waiting')).toBeTruthy());
    expect(
      screen.getByText('When the AI proposes a sensitive action it will appear here for review.'),
    ).toBeTruthy();
    for (const k of KEYS) expect(screen.queryByText(k)).toBeNull();
  });

  it('opens the reject dialog with English copy and an interpolation-free placeholder', async () => {
    render(<AiPendingActionsInbox pollInterval={0} />);
    await waitFor(() => expect(tableFace().getByText('just now')).toBeTruthy());

    fireEvent.click(screen.getAllByText('Reject')[0]);

    expect(await screen.findByText('Reject this action?')).toBeTruthy();
    expect(
      screen.getByText('The reason is shown back to the AI so it can adjust its next response.'),
    ).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
    for (const k of KEYS) expect(screen.queryByText(k)).toBeNull();
  });
});

describe('AiPendingActionsInbox at phone width: the stacked cards and the full-width drawer (objectstack#35449)', () => {
  // The geometry is measured in Chromium by `ui/e2e/ai-approvals-inbox-phone-35449.spec.ts`
  // (happy-dom has no layout engine). This half pins what a DOM can say: which
  // face each breakpoint draws, what a card says first, and that every
  // decision on a card and in the drawer reaches the same handlers.
  const IDS = ['aaaaaaaa1111', 'bbbbbbbb2222', 'cccccccc3333', 'dddddddd4444'];

  it('draws the table from `md` up and one card per action below it', async () => {
    render(<AiPendingActionsInbox pollInterval={0} />);
    const cards = await screen.findByTestId('ai-inbox-cards');

    expect(cards.className.split(/\s+/)).toContain('md:hidden');
    const tableBox = screen.getByRole('table').closest('.rounded-md.border') as HTMLElement;
    expect(tableBox.className.split(/\s+/)).toEqual(expect.arrayContaining(['hidden', 'md:block']));
    expect(within(cards).queryByRole('table')).toBeNull();
    for (const id of IDS) expect(within(cards).getByTestId(`ai-inbox-card-${id}`)).toBeTruthy();
  });

  it('leads each card with what the action does; the tool name follows it', async () => {
    render(<AiPendingActionsInbox pollInterval={0} />);
    const card = await screen.findByTestId(`ai-inbox-card-${IDS[0]}`);

    const action = within(card).getByText('delete');
    const tool = within(card).getByText('action_delete_task');
    expect(card.textContent?.startsWith('delete'), card.textContent ?? '').toBe(true);
    expect(action.compareDocumentPosition(tool) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(card).getByText('just now')).toBeTruthy();
  });

  it('decides from a card: Approve posts the decision, Reject opens the reason dialog', async () => {
    render(<AiPendingActionsInbox pollInterval={0} />);
    fireEvent.click(await screen.findByTestId(`ai-inbox-card-approve-${IDS[1]}`));

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => String(url).endsWith(`/pending-actions/${IDS[1]}/approve`) && (init as RequestInit | undefined)?.method === 'POST',
        ),
      ).toBe(true),
    );

    fireEvent.click(screen.getByTestId(`ai-inbox-card-reject-${IDS[2]}`));
    expect(await screen.findByText('Reject this action?')).toBeTruthy();
  });

  it('opens the drawer from a card at full width, its decision buttons free to wrap', async () => {
    render(<AiPendingActionsInbox pollInterval={0} />);
    fireEvent.click(await screen.findByTestId(`ai-inbox-card-view-${IDS[0]}`));

    const drawer = await screen.findByRole('dialog');
    const cls = drawer.className.split(/\s+/);
    // `cn` merges the component's `w-full` over the primitive's `w-3/4`.
    expect(cls).toContain('w-full');
    expect(cls).not.toContain('w-3/4');
    expect(cls).toContain('sm:max-w-[560px]');
    const approve = within(drawer).getByText('Approve & Execute').closest('button') as HTMLElement;
    expect((approve.parentElement as HTMLElement).className.split(/\s+/)).toContain('flex-wrap');
    expect(within(drawer).getByText('Reject').closest('button')).toBeTruthy();
  });
});
