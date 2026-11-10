// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One build turn renders ONE plan card after a reload too: the newest
 * `propose_blueprint` result, the plan the runtime builds.
 *
 * The server stores a multi-step turn as one assistant row per step, so a
 * reloaded turn is SEVERAL assistant messages; the live stream gives it as one.
 * Both reload paths this page has are driven to the rendered card:
 *
 *   - server history: `toUIMessages` → `hydratedMessagesToChatMessages`, drawn
 *     directly and through API mode's store (`useObjectChat` seeds the AI SDK
 *     store from these messages and maps it back on every render);
 *   - cache fallback: `sanitizeChatMessagesForCache` → the same hydration.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook, screen, within } from '@testing-library/react';
import React from 'react';
import {
  ChatbotEnhanced,
  toRuntimeMessages,
  uiMessagesToChatMessages,
  useObjectChat,
} from '@object-ui/plugin-chatbot';
import { hydratedMessagesToChatMessages } from '../AiChatPage';
import { sanitizeChatMessagesForCache, toUIMessages } from '../../../hooks/useChatConversation';

// Stands in for the AI SDK store, as in plugin-chatbot's
// `useObjectChat.persistedChart-25908.test.tsx`: it holds what it was seeded with.
vi.mock('@ai-sdk/react', () => ({
  useChat: (opts: { messages?: unknown[] }) => ({
    messages: opts.messages ?? [],
    status: 'ready',
    error: undefined,
    sendMessage: vi.fn(),
    regenerate: vi.fn(),
    stop: vi.fn(),
    setMessages: vi.fn(),
  }),
}));

const API = 'https://example.test/api/v1/ai/agents/build/chat';

const plan = (n: number) => ({
  status: 'blueprint_proposed',
  summary: `Plan ${n}`,
  blueprint: {
    app: { label: `App ${n}` },
    objects: [{ name: 'book', label: 'Book', fields: [{ name: 'title' }] }],
  },
  counts: { objects: 1, views: 0, dashboards: 0, seedData: 0 },
  questions: [],
});

/** One stored step: the assistant's tool call, then the `tool` row with its result. */
const storedStep = (n: number) => [
  {
    id: `a-${n}`,
    role: 'assistant',
    content: [{ type: 'tool-call', toolCallId: `plan-${n}`, toolName: 'propose_blueprint', input: {} }],
  },
  {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: `plan-${n}`,
        output: { type: 'text', value: JSON.stringify(plan(n)) },
      },
    ],
  },
];
const storedUser = (id: string) => ({ id, role: 'user', content: 'build me a library app' });

function drawn(messages: React.ComponentProps<typeof ChatbotEnhanced>['messages']) {
  cleanup();
  render(<ChatbotEnhanced messages={messages} onSendMessage={vi.fn()} />);
  return screen.queryAllByTestId('proposed-plan-title').map((el) => el.textContent);
}

/** The replaced plans draw as completed steps: no fallback confirm card, nothing awaiting. */
function expectReplacedPlansCompleted() {
  expect(screen.queryByTestId('proposed-plan-fallback')).toBeNull();
  const steps = screen.getAllByTestId('tool-phase-line');
  expect(steps.length).toBeGreaterThan(0);
  for (const step of steps) expect(step).toHaveTextContent(/^Completed/);
}

/** API mode: the hydrated thread through the store and back, as `ChatPane` renders it. */
function throughStore(hydrated: ReturnType<typeof hydratedMessagesToChatMessages>) {
  const { result } = renderHook(() => useObjectChat({ api: API, conversationId: 'c1', initialMessages: hydrated }));
  return toRuntimeMessages(result.current.messages);
}

afterEach(cleanup);

describe('one plan card per build turn survives a reload', () => {
  it('server history: a turn stored as four steps draws one card, the newest, on both renders', () => {
    const hydrated = hydratedMessagesToChatMessages(
      toUIMessages([storedUser('u1'), ...[1, 2, 3, 4].flatMap(storedStep)]),
    );
    // The stored turn really is four assistant messages, one plan each.
    expect(hydrated.filter((m) => m.role === 'assistant')).toHaveLength(4);
    expect(drawn(hydrated)).toEqual(['Proposed plan · App 4']);
    expectReplacedPlansCompleted();
    expect(drawn(throughStore(hydrated))).toEqual(['Proposed plan · App 4']);
    expectReplacedPlansCompleted();
  });

  it('PRESERVATION — server history: a plan from a previous turn keeps its card', () => {
    const hydrated = hydratedMessagesToChatMessages(
      toUIMessages([
        storedUser('u1'),
        ...storedStep(0),
        storedUser('u2'),
        ...[1, 2, 3, 4].flatMap(storedStep),
      ]),
    );
    expect(drawn(hydrated)).toEqual(['Proposed plan · App 0', 'Proposed plan · App 4']);
    expect(drawn(throughStore(hydrated))).toEqual(['Proposed plan · App 0', 'Proposed plan · App 4']);
  });

  it('cache fallback: the cached turn draws one card, the newest', () => {
    const live = uiMessagesToChatMessages([
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'build me a library app' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [1, 2, 3, 4].map((n) => ({
          type: 'tool-propose_blueprint',
          toolCallId: `plan-${n}`,
          state: 'output-available',
          input: {},
          output: plan(n),
        })),
      },
    ]);
    const persisted = JSON.parse(JSON.stringify(sanitizeChatMessagesForCache(live))) as ReturnType<
      typeof sanitizeChatMessagesForCache
    >;
    const hydrated = hydratedMessagesToChatMessages(persisted);
    // The compact cache copy keeps the plan's summary, not its app label, so
    // the card is told apart by the summary it draws.
    for (const messages of [hydrated, throughStore(hydrated)]) {
      expect(drawn(messages)).toHaveLength(1);
      expect(within(screen.getByTestId('proposed-plan')).getByText('Plan 4')).toBeInTheDocument();
      expectReplacedPlansCompleted();
    }
  });
});
