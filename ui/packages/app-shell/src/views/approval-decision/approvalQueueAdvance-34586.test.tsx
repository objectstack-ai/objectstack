/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#34586 — the request page's half of the approvals queue
 * (`approvalQueueAdvance.tsx`): which state marks a page as opened from the
 * reader's queue, which request opens after a decision, and when the page
 * moves at all. The inbox-to-page flow on the real record page is pinned in
 * the console (`ApprovalsInboxPage.queueStepper-34586.test.tsx`).
 *
 * The harness is a route with the hook over a row the test hands it, and the
 * record page's own `useRecordPageReturn` beside it, so the counter the top
 * bar would draw is read from the same history state the hook writes.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';

const { toastStub } = vi.hoisted(() => ({
  toastStub: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: toastStub }));

import {
  APPROVAL_QUEUE_STATE,
  approvalQueueState,
  inReaderQueue,
  nextInQueue,
  readApprovalQueue,
  useApprovalQueueAdvance,
} from './approvalQueueAdvance.js';
import { useRecordPageReturn } from '../recordDrawerStack.js';

const LIST = { pathname: '/apps/crm/system/approvals', label: 'Approvals Inbox' };
const pageOf = (id: string) => `/apps/crm/sys_approval_request/record/${id}`;

type Row = { id: string; status: string; viewer?: { can_act: boolean } };
const pending = (id: string): Row => ({ id, status: 'pending', viewer: { can_act: true } });

/** The page: the hook over the row the test holds for the route's id. */
function Page({ rows }: { rows: Record<string, Row> }) {
  const { recordId } = useParams();
  const location = useLocation();
  const toggle = useApprovalQueueAdvance(recordId, recordId ? rows[recordId] : undefined);
  const position = useRecordPageReturn(recordId).stepper?.position;
  const siblings = (location.state as { from?: { siblings?: unknown } } | null)?.from?.siblings;
  return (
    <>
      <output data-testid="where">{location.pathname}</output>
      <output data-testid="position">{position ? `${position.index + 1}/${position.total}` : 'none'}</output>
      <output data-testid="siblings">{JSON.stringify(siblings ?? null)}</output>
      {toggle}
    </>
  );
}

function Harness({ entry, rows }: { entry: { pathname: string; state?: unknown }; rows: Record<string, Row> }) {
  return (
    <MemoryRouter initialEntries={[LIST.pathname, entry]} initialIndex={1}>
      <Routes>
        <Route path="/apps/:appName/system/approvals" element={<output data-testid="where">{LIST.pathname}</output>} />
        <Route path="/apps/:appName/:objectName/record/:recordId" element={<Page rows={rows} />} />
      </Routes>
    </MemoryRouter>
  );
}

const QUEUE = ['r1', 'r2', 'r3'];
const fromQueue = (id: string, ids: string[] = QUEUE) => ({ pathname: pageOf(id), state: approvalQueueState(LIST, ids) });
const where = () => screen.getByTestId('where').textContent;
const position = () => screen.getByTestId('position').textContent;

beforeEach(() => {
  toastStub.success.mockClear();
  try { window.localStorage.clear(); } catch { /* no storage */ }
});
afterEach(cleanup);

describe('the queue state (objectstack#34586)', () => {
  it('reads the queue only from a page the inbox marked, and only for a request in it', () => {
    const state = approvalQueueState(LIST, QUEUE);
    expect(state[APPROVAL_QUEUE_STATE]).toBe(true);
    expect(readApprovalQueue(state, 'r2')).toEqual({ siblings: QUEUE, listPath: LIST.pathname });
    expect(readApprovalQueue(state, 'r9')).toBeUndefined();
    // Another list's rows (the same `from` shape, no mark) are not the queue.
    expect(readApprovalQueue({ from: { pathname: LIST.pathname, siblings: QUEUE } }, 'r2')).toBeUndefined();
    expect(readApprovalQueue(null, 'r2')).toBeUndefined();
  });

  it('the next request is the one after the decided one, else the one before, else none', () => {
    expect(nextInQueue(QUEUE, 'r1')).toEqual({ next: 'r2', remaining: ['r2', 'r3'] });
    expect(nextInQueue(QUEUE, 'r3')).toEqual({ next: 'r2', remaining: ['r1', 'r2'] });
    expect(nextInQueue(['r1'], 'r1')).toEqual({ next: undefined, remaining: [] });
  });

  it('a request is in the reader queue while pending and the server says the reader can act', () => {
    expect(inReaderQueue(pending('r1'))).toBe(true);
    expect(inReaderQueue({ id: 'r1', status: 'pending', viewer: { can_act: false } })).toBe(false);
    expect(inReaderQueue({ id: 'r1', status: 'approved', viewer: { can_act: false } })).toBe(false);
    expect(inReaderQueue({ id: 'r1', status: 'pending' })).toBe(true);
    expect(inReaderQueue({ id: 'r1' })).toBeUndefined();
  });
});

describe('the request page moves on after a decision (objectstack#34586)', () => {
  it('approved: the page is replaced by the next request, the decided one dropped from the set', async () => {
    const rows = { r1: pending('r1'), r2: pending('r2'), r3: pending('r3') };
    const { rerender } = render(<Harness entry={fromQueue('r1')} rows={rows} />);
    expect(position()).toBe('1/3');
    expect(screen.getByTestId('approval-queue-open-next')).toBeInTheDocument();

    rerender(<Harness entry={fromQueue('r1')} rows={{ ...rows, r1: { id: 'r1', status: 'approved', viewer: { can_act: false } } }} />);
    await waitFor(() => expect(where()).toBe(pageOf('r2')));
    expect(screen.getByTestId('siblings').textContent).toBe(JSON.stringify(['r2', 'r3']));
    expect(position()).toBe('1/2');
    expect(screen.getByTestId('approval-queue-open-next')).toBeInTheDocument();
  });

  it('a countersign approval that leaves the request pending for others still moves on', async () => {
    const rows = { r1: pending('r1'), r2: pending('r2'), r3: pending('r3') };
    const { rerender } = render(<Harness entry={fromQueue('r1')} rows={rows} />);
    rerender(<Harness entry={fromQueue('r1')} rows={{ ...rows, r1: { id: 'r1', status: 'pending', viewer: { can_act: false } } }} />);
    await waitFor(() => expect(where()).toBe(pageOf('r2')));
  });

  it('the last request of the queue goes back to the list and says it is done', async () => {
    const rows = { r3: pending('r3') };
    const { rerender } = render(<Harness entry={fromQueue('r3', ['r3'])} rows={rows} />);
    rerender(<Harness entry={fromQueue('r3', ['r3'])} rows={{ r3: { id: 'r3', status: 'rejected', viewer: { can_act: false } } }} />);
    await waitFor(() => expect(where()).toBe(LIST.pathname));
    expect(toastStub.success).toHaveBeenCalledWith('No more pending requests in this list.');
  });

  it('with the switch off the page stays, and the choice is kept for the next page', async () => {
    const rows = { r1: pending('r1'), r2: pending('r2') };
    const { rerender, unmount } = render(<Harness entry={fromQueue('r1', ['r1', 'r2'])} rows={rows} />);
    const box = within(screen.getByTestId('approval-queue-open-next')).getByRole('checkbox');
    expect(box).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(box);
    expect(box).toHaveAttribute('aria-checked', 'false');

    rerender(<Harness entry={fromQueue('r1', ['r1', 'r2'])} rows={{ ...rows, r1: { id: 'r1', status: 'approved', viewer: { can_act: false } } }} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(where()).toBe(pageOf('r1'));
    unmount();

    render(<Harness entry={fromQueue('r2', ['r1', 'r2'])} rows={rows} />);
    expect(within(screen.getByTestId('approval-queue-open-next')).getByRole('checkbox')).toHaveAttribute('aria-checked', 'false');
  });

  it('turning the switch back on after a decision it was off for moves nothing', async () => {
    const rows = { r1: pending('r1'), r2: pending('r2') };
    const { rerender } = render(<Harness entry={fromQueue('r1', ['r1', 'r2'])} rows={rows} />);
    const box = within(screen.getByTestId('approval-queue-open-next')).getByRole('checkbox');
    fireEvent.click(box);
    rerender(<Harness entry={fromQueue('r1', ['r1', 'r2'])} rows={{ ...rows, r1: { id: 'r1', status: 'approved', viewer: { can_act: false } } }} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(where()).toBe(pageOf('r1'));

    fireEvent.click(box);
    expect(box).toHaveAttribute('aria-checked', 'true');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(where()).toBe(pageOf('r1'));
  });

  it('an action that leaves the request in the reader queue (more info asked) does not move', async () => {
    const rows = { r1: pending('r1'), r2: pending('r2') };
    const { rerender } = render(<Harness entry={fromQueue('r1', ['r1', 'r2'])} rows={rows} />);
    rerender(<Harness entry={fromQueue('r1', ['r1', 'r2'])} rows={{ ...rows, r1: { ...pending('r1') } }} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(where()).toBe(pageOf('r1'));
  });

  it('a request first shown already decided does not move: only a change seen on this page does', async () => {
    render(<Harness entry={fromQueue('r1')} rows={{ r1: { id: 'r1', status: 'approved', viewer: { can_act: false } } }} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(where()).toBe(pageOf('r1'));
  });

  it('opened without the queue (a notification, a direct link): no switch, no counter, no move', async () => {
    const rows = { r1: pending('r1') };
    const { rerender } = render(<Harness entry={{ pathname: pageOf('r1') }} rows={rows} />);
    expect(screen.queryByTestId('approval-queue-open-next')).toBeNull();
    expect(position()).toBe('none');
    rerender(<Harness entry={{ pathname: pageOf('r1') }} rows={{ r1: { id: 'r1', status: 'approved', viewer: { can_act: false } } }} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(where()).toBe(pageOf('r1'));
  });
});
