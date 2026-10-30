/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#25943 — the assistant bus keeps how many items each chat reads
 * as awaiting the user's confirmation, so Studio's right slot can show
 * 「N 项待确认」. `usePlanApprovalPendingCount` sums the signed-in user's
 * conversations; `usePlanApprovalPending` (the launchers' marker) is that sum
 * above 0. The publishing path from the chat is pinned in
 * `AiChatPage.planApprovalReachesLaunchers-11666.test.tsx`.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import {
  publishPlanApprovalPending,
  usePlanApprovalPending,
  usePlanApprovalPendingCount,
} from '../assistantBus';

// No AuthProvider here: `useAuth` answers its signed-out default, whose user id
// the bus reads as '' — the owner every reading below is published for.
const ME = undefined;

function Probe() {
  const count = usePlanApprovalPendingCount();
  const pending = usePlanApprovalPending();
  return <output data-testid="probe" data-count={count} data-pending={String(pending)} />;
}

function publish(conversationId: string, pending: boolean, count?: number, userId: string | undefined = ME) {
  act(() => publishPlanApprovalPending({ userId, conversationId, pending, count }));
}

const probe = () => screen.getByTestId('probe');

afterEach(() => {
  // The bus is a module singleton: drop every reading a case left behind.
  for (const id of ['conv-a', 'conv-b']) {
    for (const userId of [ME, 'someone-else']) {
      act(() => publishPlanApprovalPending({ userId, conversationId: id, pending: false }));
    }
  }
  cleanup();
});

describe('usePlanApprovalPendingCount (objectstack#25943)', () => {
  it('is 0, and not pending, while nothing awaits approval', () => {
    render(<Probe />);
    expect(probe()).toHaveAttribute('data-count', '0');
    expect(probe()).toHaveAttribute('data-pending', 'false');
  });

  it('sums the items of every conversation of the signed-in user, and follows a count change', () => {
    render(<Probe />);
    publish('conv-a', true, 2);
    expect(probe()).toHaveAttribute('data-count', '2');
    expect(probe()).toHaveAttribute('data-pending', 'true');

    publish('conv-b', true, 1);
    expect(probe()).toHaveAttribute('data-count', '3');

    publish('conv-a', true, 4);
    expect(probe()).toHaveAttribute('data-count', '5');

    publish('conv-a', false);
    expect(probe()).toHaveAttribute('data-count', '1');
    publish('conv-b', false);
    expect(probe()).toHaveAttribute('data-count', '0');
    expect(probe()).toHaveAttribute('data-pending', 'false');
  });

  it('a reading published without a count counts 1', () => {
    render(<Probe />);
    publish('conv-a', true);
    expect(probe()).toHaveAttribute('data-count', '1');
  });

  it("another user's readings are not counted", () => {
    render(<Probe />);
    publish('conv-a', true, 3, 'someone-else');
    expect(probe()).toHaveAttribute('data-count', '0');
    expect(probe()).toHaveAttribute('data-pending', 'false');
  });
});
