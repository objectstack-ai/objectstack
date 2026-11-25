// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37142 (ADR-0160 D7) — `useAskAiHandler`, the console's answer to
 * "can an `ask_ai` click be served here?".
 *
 * Pinned, against a real `ChatDockControlProvider` and the real hook:
 *  1. No drawer handle (no layout hosting the assistant, i.e. the AI surface
 *     off) → no handler, and the agent catalog is not even fetched.
 *  2. A drawer, but no catalog agent declaring `capabilities.focus` → no
 *     handler (the action stays absent).
 *  3. A drawer and a focus-honouring agent → a handler that pins the record
 *     through `setChatFocus` and opens the drawer ON that agent, so the
 *     drawer's pin control (which asks the active agent) is drawn; it sends
 *     nothing. An `ask` agent is preferred among several that honour it.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';

const harness = vi.hoisted(() => ({
  agents: [] as Array<{ name: string; capabilities?: Record<string, boolean> }>,
  agentsCalls: [] as Array<{ enabled?: boolean }>,
  setChatFocus: vi.fn(),
}));

vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAgents: (options: { enabled?: boolean }) => {
    harness.agentsCalls.push(options);
    return { agents: options.enabled === false ? [] : harness.agents, isLoading: false, refetch: () => {} };
  },
}));

vi.mock('../../layout/chatFocus.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  setChatFocus: harness.setChatFocus,
}));

import { ChatDockControlProvider, type ChatDockControl } from '../../layout/chatDockControl.js';
import { useAskAiHandler } from '../useAskAiHandler.js';

function dock(): ChatDockControl & { open: Mock<ChatDockControl['open']> } {
  return { expanded: false, fullWindow: false, toggle: vi.fn(), open: vi.fn<ChatDockControl['open']>() };
}

function renderWith(control: ChatDockControl | null) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ChatDockControlProvider value={control}>{children}</ChatDockControlProvider>
  );
  return renderHook(() => useAskAiHandler(), { wrapper });
}

const FOCUS_AGENT = { name: 'ask', capabilities: { focus: true } };
const PLAIN_AGENT = { name: 'ask', capabilities: { focus: false } };

beforeEach(() => {
  harness.agents = [];
  harness.agentsCalls = [];
  harness.setChatFocus.mockReset();
});

describe('useAskAiHandler (ADR-0160 D7)', () => {
  it('answers nothing without a drawer, and fetches no catalog', () => {
    harness.agents = [FOCUS_AGENT];
    const { result } = renderWith(null);
    expect(result.current).toBeUndefined();
    expect(harness.agentsCalls.every((call) => call.enabled === false)).toBe(true);
  });

  it('answers nothing when no served agent honours a focus', () => {
    harness.agents = [PLAIN_AGENT, { name: 'build' }];
    const { result } = renderWith(dock());
    expect(result.current).toBeUndefined();
  });

  it('pins the record and opens the drawer where both hold', () => {
    harness.agents = [PLAIN_AGENT, { ...FOCUS_AGENT, name: 'custom' }];
    const control = dock();
    const { result } = renderWith(control);
    expect(result.current).toBeTypeOf('function');

    result.current!({ object: 'account', id: 'acc_1' });

    expect(harness.setChatFocus).toHaveBeenCalledTimes(1);
    expect(harness.setChatFocus).toHaveBeenCalledWith({ object: 'account', id: 'acc_1' });
    expect(control.open).toHaveBeenCalledTimes(1);
    // On the agent that honours the focus, and with no hand-off message: the
    // `ask` agent here does not declare it, so `custom` is opened.
    expect(control.open).toHaveBeenCalledWith({ agent: 'custom' });
    expect(control.toggle).not.toHaveBeenCalled();
  });

  it('prefers an `ask` agent among several that honour a focus', () => {
    harness.agents = [{ ...FOCUS_AGENT, name: 'custom' }, FOCUS_AGENT];
    const control = dock();
    const { result } = renderWith(control);
    result.current!({ object: 'account', id: 'acc_1' });
    expect(control.open).toHaveBeenCalledWith({ agent: 'ask' });
  });
});
