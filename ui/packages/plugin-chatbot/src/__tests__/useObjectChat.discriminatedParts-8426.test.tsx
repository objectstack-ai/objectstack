/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `useObjectChat` — the API-mode parts builder CONSTRUCTS the discriminated
 * tool part the chat runtime declares, so the `as any` on the `messages`
 * option is gone (objectui#8426).
 *
 * ## What this file can and cannot prove
 *
 * The load-bearing proof of this card is a TYPE-CHECK: the builder's array is
 * declared as the store's own message type, so a part that does not fit is a
 * compile error at the branch that built it. ⚠️ vitest cannot see any of that —
 * types are erased before a test runs, and a suite that only inspected the
 * emitted objects would pass identically on the pre-fix builder, whose parts
 * were plain `Record`s.
 *
 * So the assertions here are deliberately RUNTIME ones, chosen because they
 * fail on the pre-fix output:
 *
 *   - `validateUIMessages` is the chat runtime's OWN statement of what its
 *     store may hold. It is the same instrument objectui#8443 used, and it is
 *     what a backend route runs over these values. Each subject below is
 *     paired with a control built the way the OLD builder built it, so a
 *     subject that stops discriminating cannot go quiet — the control is what
 *     notices.
 *   - the approval envelope is DATA, not a type: the three approval states are
 *     unreachable without it, so "the state survived the seed" is a claim a
 *     test can make.
 */

import { renderHook } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateUIMessages } from 'ai';
import { useObjectChat } from '../useObjectChat';

const API = 'https://example.test/api/v1/ai/agents/build/chat';

type SeededPart = Record<string, unknown> & { type?: string };
type SeededMessage = { id: string; role: string; parts: SeededPart[] };

const { seen } = vi.hoisted(() => ({ seen: { messages: undefined as SeededMessage[] | undefined } }));

vi.mock('@ai-sdk/react', () => ({
  // `messages` IS what `useChat` initialises its store from, so capturing the
  // option reads exactly the seed the store receives.
  useChat: (options: { messages?: SeededMessage[] }) => {
    seen.messages = options?.messages;
    return {
      messages: [],
      status: 'ready',
      error: undefined,
      sendMessage: vi.fn(),
      regenerate: vi.fn(),
      stop: vi.fn(),
      setMessages: vi.fn(),
    };
  },
}));

beforeEach(() => {
  seen.messages = undefined;
});

/** Seed one assistant message carrying exactly one tool invocation. */
function seedOneInvocation(invocation: Record<string, unknown>): SeededPart {
  renderHook(() =>
    useObjectChat({
      api: API,
      initialMessages: [
        {
          id: 'm-tool',
          role: 'assistant',
          content: '',
          toolInvocations: [invocation],
        },
      ],
    } as never),
  );
  const parts = seen.messages?.[0]?.parts ?? [];
  expect(parts).toHaveLength(1);
  return parts[0];
}

describe('the three approval states are CONSTRUCTED, envelope and all', () => {
  it('approval-requested keeps its state and carries the envelope id', async () => {
    const part = seedOneInvocation({
      toolCallId: 'call-1',
      toolName: 'delete_records',
      args: { id: 'r1' },
      state: 'approval-requested',
      approval: { id: 'apr_1', isAutomatic: false },
    });

    expect(part).toMatchObject({
      type: 'tool-delete_records',
      toolCallId: 'call-1',
      state: 'approval-requested',
      approval: { id: 'apr_1' },
    });
    // SUBJECT: the runtime's own validator accepts the seed.
    await expect(validateUIMessages({ messages: seen.messages as never })).resolves.toHaveLength(1);

    // CONTROL: the SAME state with the envelope stripped — the shape the old
    // builder emitted — is refused. Without this, a builder that dropped
    // `approval` entirely would still satisfy the subject.
    const stripped = [
      { ...seen.messages![0], parts: [{ ...part, approval: undefined }] },
    ];
    await expect(validateUIMessages({ messages: stripped as never })).rejects.toThrow();
  });

  it('approval-responded carries the decision', async () => {
    const part = seedOneInvocation({
      toolCallId: 'call-2',
      toolName: 'publish_app',
      args: { app: 'crm' },
      state: 'approval-responded',
      approval: { id: 'apr_2', approved: true, reason: 'looks right' },
    });

    expect(part).toMatchObject({
      type: 'tool-publish_app',
      state: 'approval-responded',
      approval: { id: 'apr_2', approved: true, reason: 'looks right' },
    });
    await expect(validateUIMessages({ messages: seen.messages as never })).resolves.toHaveLength(1);
  });

  it('output-denied pins `approved: false`', async () => {
    const part = seedOneInvocation({
      toolCallId: 'call-3',
      toolName: 'drop_table',
      args: { table: 't' },
      state: 'output-denied',
      approval: { id: 'apr_3', approved: false, reason: 'no' },
    });

    expect(part).toMatchObject({
      type: 'tool-drop_table',
      state: 'output-denied',
      approval: { id: 'apr_3', approved: false },
    });
    await expect(validateUIMessages({ messages: seen.messages as never })).resolves.toHaveLength(1);
  });

  it('a DYNAMIC tool name reaches the store as the `tool-<name>` discriminant', () => {
    // The card feared this was the blocker. It is not: the runtime's tool set
    // is open, so the discriminant is a template and any name fits.
    const part = seedOneInvocation({
      toolCallId: 'call-4',
      toolName: 'a_tool_named_at_runtime',
      args: {},
      state: 'input-available',
    });
    expect(part.type).toBe('tool-a_tool_named_at_runtime');
  });
});

describe('the dead `toolName` excess property is gone', () => {
  it('is not written onto a `tool-*` part, and the name is still recoverable', async () => {
    const part = seedOneInvocation({
      toolCallId: 'call-5',
      toolName: 'search',
      args: { q: 'x' },
      result: { hits: 1 },
      state: 'output-available',
    });

    // Only the dynamic-tool arm declares `toolName`; on a `tool-*` part it was
    // an excess property AND dead — the round-trip reader derives the name off
    // `type`, which is why dropping it is behaviour-preserving.
    expect(part).not.toHaveProperty('toolName');
    expect(part.type).toBe('tool-search');
    await expect(validateUIMessages({ messages: seen.messages as never })).resolves.toHaveLength(1);
  });
});

describe('the legacy authoring states are FOLDED onto the lifecycle', () => {
  it.each([
    ['partial-call', 'input-streaming'],
    ['call', 'input-available'],
    ['result', 'output-available'],
  ])('%s -> %s', async (authored, expected) => {
    const part = seedOneInvocation({
      toolCallId: `call-${authored}`,
      toolName: 'legacy',
      args: { a: 1 },
      result: authored === 'result' ? { ok: true } : undefined,
      state: authored,
    });

    expect(part.state).toBe(expected);
    // SUBJECT: folded, the seed is holdable.
    await expect(validateUIMessages({ messages: seen.messages as never })).resolves.toHaveLength(1);

    // CONTROL: the authored spelling passed through verbatim — what the old
    // builder did — is not a state the store knows.
    const passthrough = [
      { ...seen.messages![0], parts: [{ ...part, state: authored }] },
    ];
    await expect(validateUIMessages({ messages: passthrough as never })).rejects.toThrow();
  });
});

describe('an approval state with nothing to back it is REPORTED, not invented', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it('derives the state from the data and names the producer', async () => {
    // ⛔ No `approval.id` is invented — inventing contract data is what
    // AGENTS.md #0.1 forbids. The state is read off what the invocation DOES
    // carry, and the author is told once.
    const part = seedOneInvocation({
      toolCallId: 'call-6',
      // A distinct tool name per case: the warning is deduped per (state, tool).
      toolName: 'unbacked_a',
      args: { a: 1 },
      state: 'approval-requested',
    });

    expect(part.state).toBe('input-available');
    expect(part).not.toHaveProperty('approval');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/approval.*envelope/is);
    await expect(validateUIMessages({ messages: seen.messages as never })).resolves.toHaveLength(1);
  });

  it('says it ONCE for the same state and tool', () => {
    seedOneInvocation({
      toolCallId: 'call-7a',
      toolName: 'unbacked_b',
      args: {},
      state: 'approval-responded',
    });
    seedOneInvocation({
      toolCallId: 'call-7b',
      toolName: 'unbacked_b',
      args: {},
      state: 'approval-responded',
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('⛔ says NOTHING when the invocation is an ObjectStack HITL approval', () => {
    // A `pendingActionId` approval is carried by that id and by the
    // `{ status: 'pending_approval' }` result, never by the runtime envelope —
    // and `mapMessages` re-promotes the state from that result on the way back
    // out. Warning here would cry wolf on the live HITL path.
    const part = seedOneInvocation({
      toolCallId: 'call-8',
      toolName: 'hitl_tool',
      args: {},
      result: { status: 'pending_approval', pendingActionId: 'pa_1' },
      state: 'approval-requested',
      pendingActionId: 'pa_1',
    });

    expect(warn).not.toHaveBeenCalled();
    // The result rides along, which is what lets the state be re-derived.
    expect(part).toMatchObject({
      state: 'output-available',
      output: { status: 'pending_approval', pendingActionId: 'pa_1' },
    });
  });
});

describe('the whole seed is holdable — the end of the cast', () => {
  it('a mixed message (text + reasoning + tools) passes the runtime validator', async () => {
    renderHook(() =>
      useObjectChat({
        api: API,
        initialMessages: [
          { id: 'm-user', role: 'user', content: 'do it' },
          {
            id: 'm-assistant',
            role: 'assistant',
            content: 'working on it',
            reasoning: 'thinking',
            toolInvocations: [
              { toolCallId: 'c1', toolName: 'search', args: { q: 'x' }, state: 'input-available' },
              {
                toolCallId: 'c2',
                toolName: 'write',
                args: { v: 1 },
                errorText: 'boom',
                state: 'output-error',
              },
            ],
          },
        ],
      } as never),
    );

    const seeded = seen.messages ?? [];
    expect(seeded).toHaveLength(2);
    expect(seeded[1]?.parts.map((p) => p.type)).toEqual([
      'text',
      'reasoning',
      'tool-search',
      'tool-write',
    ]);
    await expect(validateUIMessages({ messages: seeded as never })).resolves.toHaveLength(2);
  });
});
