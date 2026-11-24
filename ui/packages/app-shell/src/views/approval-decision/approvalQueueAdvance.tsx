/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Working through the approvals queue on the request pages
 * (objectstack#34586).
 *
 * The inbox's 「待我审批」 tab opens a request on its page with the queue as it
 * shows it, filtered and sorted: {@link approvalQueueState} is the history
 * state it navigates with. Its `from` is the shape every list hands a page it
 * opens (`from.pathname`, `from.label`, `from.siblings`), so the record page's
 * own top bar draws the counter 「第 N 条，共 M 条」 and ↓ ↑ (with `j` / `k`) over
 * it, through `useRecordPageReturn` — no second sibling mechanism. The one
 * key this module adds, {@link APPROVAL_QUEUE_STATE}, says the set is the
 * reader's pending queue, which is what lets a decision move on.
 *
 * {@link useApprovalQueueAdvance} watches the request the page shows. When it
 * leaves the reader's pending queue — its status leaves `pending`, or the
 * server's `viewer.can_act` turns false (approved by a countersign slot,
 * reassigned, sent back, rejected) — while the reader's 「处理后打开下一条」 is
 * on, the page is replaced by the next request of the queue, the one after it
 * (or, at the end, the one before it), with the decided one dropped from the
 * set. With none left it goes back to the list and says the list is done. The
 * change is seen on the page's own re-read after the decision, not guessed
 * from the action: an action that leaves the request pending for the reader
 * (request more info, remind) keeps the page where it is.
 *
 * A page opened any other way — a notification, a direct link, another list —
 * carries no such state: no counter, no switch, nothing moves.
 *
 * The switch is the reader's own preference
 * ({@link APPROVAL_QUEUE_OPEN_NEXT_PREFERENCE}, kept per browser and never
 * metadata), default on.
 */

import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Checkbox } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/react';
import { readFromSiblings, siblingRecordStep } from '../recordDrawerStack.js';
import {
  APPROVAL_QUEUE_OPEN_NEXT_PREFERENCE,
  useWorkspacePreference,
  type PreferenceSwitch,
} from '../../utils/workspacePreference.js';

/** The history-state key that marks a request page opened from the reader's pending queue. */
export const APPROVAL_QUEUE_STATE = 'approvalQueue';

/**
 * The history state the inbox opens a request with: the queue as the list
 * shows it, in its order, and the way back to the list.
 */
export function approvalQueueState(
  list: { pathname: string; label: string },
  requestIds: ReadonlyArray<string>,
): Record<string, unknown> {
  return {
    from: { pathname: list.pathname, label: list.label, siblings: requestIds.map(String) },
    [APPROVAL_QUEUE_STATE]: true,
  };
}

/** The queue a request page was opened from, or `undefined` when it was opened any other way. */
export function readApprovalQueue(
  state: unknown,
  requestId: string | undefined,
): { siblings: readonly string[]; listPath: string } | undefined {
  if (!requestId || !state || typeof state !== 'object') return undefined;
  if ((state as Record<string, unknown>)[APPROVAL_QUEUE_STATE] !== true) return undefined;
  const listPath = (state as { from?: { pathname?: unknown } }).from?.pathname;
  const siblings = readFromSiblings(state);
  if (typeof listPath !== 'string' || !siblings || !siblings.includes(requestId)) return undefined;
  return { siblings, listPath };
}

/**
 * Whether the request row is in the reader's pending queue: pending, and the
 * server says the reader can act on it. A row served without the `viewer`
 * block answers by status alone; a row with no status is not known.
 */
export function inReaderQueue(row: unknown): boolean | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const status = (row as { status?: unknown }).status;
  if (typeof status !== 'string') return undefined;
  if (status !== 'pending') return false;
  const canAct = (row as { viewer?: { can_act?: unknown } }).viewer?.can_act;
  return typeof canAct === 'boolean' ? canAct : true;
}

/**
 * Which request to open once `decidedId` has left the queue: the one after
 * it, or at the end of the queue the one before it; `undefined` when it was
 * the last. `remaining` is the queue without it, in its order.
 */
export function nextInQueue(
  siblings: readonly string[],
  decidedId: string,
): { next: string | undefined; remaining: string[] } {
  const index = siblings.indexOf(decidedId);
  const remaining = siblings.filter((id) => id !== decidedId);
  if (index < 0) return { next: undefined, remaining };
  return { next: siblings[index + 1] ?? siblings[index - 1], remaining };
}

/** The reader's 「处理后打开下一条」 and its setter. */
export function useApprovalQueueOpenNext(): [boolean, (on: boolean) => void] {
  const [value, setValue] = useWorkspacePreference<PreferenceSwitch>(APPROVAL_QUEUE_OPEN_NEXT_PREFERENCE, 'user', 'on');
  const set = React.useCallback((on: boolean) => setValue(on ? 'on' : 'off'), [setValue]);
  return [value !== 'off', set];
}

/**
 * The request page's half of the queue: watches `row` (the request the page
 * shows, as it re-reads it) and moves on when a decision takes it out of the
 * reader's queue. `requestId` is the page's own record id, `undefined` off a
 * request page or in a pane. Answers the top bar's switch, or `null` when the
 * page was not opened from the queue.
 */
export function useApprovalQueueAdvance(requestId: string | undefined, row: unknown): React.ReactNode {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useObjectTranslation();
  const [openNext, setOpenNext] = useApprovalQueueOpenNext();
  const queue = React.useMemo(() => readApprovalQueue(location.state, requestId), [location.state, requestId]);
  const rowId = row && typeof row === 'object' ? (row as { id?: unknown }).id : undefined;
  const queued = rowId != null && String(rowId) === requestId ? inReaderQueue(row) : undefined;
  /** What the page last showed of this request: its id and whether it was in the queue. */
  const seen = React.useRef<{ id: string; queued: boolean } | null>(null);

  React.useEffect(() => {
    if (!requestId || queued === undefined) return;
    const before = seen.current;
    seen.current = { id: requestId, queued };
    if (!queue || !openNext || before?.id !== requestId || !before.queued || queued) return;
    const { next, remaining } = nextInQueue(queue.siblings, requestId);
    if (next === undefined) {
      toast.success(String(t('approvalsInbox.queueDone', { defaultValue: 'No more pending requests in this list.' })));
      navigate(queue.listPath, { replace: true });
      return;
    }
    const step = siblingRecordStep(location, requestId, next);
    if (step === null) return;
    const from = (step.state.from ?? {}) as Record<string, unknown>;
    navigate(step.to, { replace: true, state: { ...step.state, from: { ...from, siblings: remaining } } });
  }, [requestId, queued, queue, openNext, location, navigate, t]);

  if (!queue) return null;
  const label = String(t('approvalsInbox.openNextAfterDecision', { defaultValue: 'Open next after deciding' }));
  return (
    <label
      className="mr-1 inline-flex cursor-pointer select-none items-center gap-1.5 whitespace-nowrap"
      data-testid="approval-queue-open-next"
    >
      <Checkbox checked={openNext} onCheckedChange={(checked) => setOpenNext(checked === true)} aria-label={label} />
      <span>{label}</span>
    </label>
  );
}
