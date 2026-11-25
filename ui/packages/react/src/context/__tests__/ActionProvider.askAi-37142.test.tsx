/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#37142 (ADR-0160 D7) — `<ActionProvider onAskAi>` and
 * `useDrawsAction`.
 *
 * The provider installs the host's in-app assistant on its runner, and the
 * hook answers, for every surface under it, whether an `ask_ai` action is
 * drawn at all. Pinned:
 *  1. No `onAskAi` → `ask_ai` is not drawn; every other action is.
 *  2. `onAskAi` arriving on a LATER render (the agent catalog resolves after
 *     the first) draws it, and the hook's identity changes so a memoised
 *     filter re-runs; `onAskAi` leaving hides it again.
 *  3. A click runs the LATEST `onAskAi` with the record, and nothing else.
 *  4. No provider at all → `ask_ai` is not drawn.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import type { AssistantFocusHandler } from '@object-ui/core';
import { ActionProvider, useAction, useDrawsAction } from '../ActionContext';

afterEach(() => cleanup());

const ASK = { name: 'ask_about_account', type: 'ask_ai' };
const SCRIPT = { name: 'close', type: 'script', target: 'close' };

function harness(initial: AssistantFocusHandler | undefined) {
  let onAskAi = initial;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ActionProvider context={{ objectName: 'account', record: { id: 'acc_1' } }} onAskAi={onAskAi}>
      {children}
    </ActionProvider>
  );
  const view = renderHook(() => ({ draws: useDrawsAction(), action: useAction() }), { wrapper });
  return {
    ...view,
    setOnAskAi(next: AssistantFocusHandler | undefined) {
      onAskAi = next;
      view.rerender();
    },
  };
}

describe('<ActionProvider onAskAi> — whether ask_ai is drawn', () => {
  it('does not draw ask_ai without an assistant, and draws everything else', () => {
    const { result } = harness(undefined);
    expect(result.current.draws(ASK)).toBe(false);
    expect(result.current.draws(SCRIPT)).toBe(true);
  });

  it('draws ask_ai once the assistant arrives on a later render, with a new gate identity', () => {
    const view = harness(undefined);
    const before = view.result.current.draws;
    view.setOnAskAi(vi.fn());
    expect(view.result.current.draws(ASK)).toBe(true);
    expect(view.result.current.draws).not.toBe(before);
    view.setOnAskAi(undefined);
    expect(view.result.current.draws(ASK)).toBe(false);
  });

  it('keeps the gate identity when only the handler function changes', () => {
    const view = harness(vi.fn());
    const before = view.result.current.draws;
    view.setOnAskAi(vi.fn());
    expect(view.result.current.draws).toBe(before);
  });

  it('runs the latest onAskAi with the record on a click', async () => {
    const first = vi.fn();
    const latest = vi.fn();
    const view = harness(first);
    view.setOnAskAi(latest);
    let outcome: { success: boolean } | undefined;
    await act(async () => {
      outcome = await view.result.current.action.execute({ ...ASK });
    });
    expect(outcome?.success).toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith({ object: 'account', id: 'acc_1' });
  });
});

describe('useDrawsAction — no provider', () => {
  it('does not draw ask_ai, and draws everything else', () => {
    const { result } = renderHook(() => useDrawsAction());
    expect(result.current(ASK)).toBe(false);
    expect(result.current(SCRIPT)).toBe(true);
  });
});
