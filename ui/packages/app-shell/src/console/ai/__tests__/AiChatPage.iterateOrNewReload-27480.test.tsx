// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27480 — the extend-or-new question an `iterate_or_new` plan asks
 * survives a reload, on both reload paths this page has. Without that, a reload
 * turns the question back into an ordinary plan card with a "Build it" button:
 * the one-click duplicate the question exists to prevent, one refresh later.
 *
 *   - server history: the stored tool result is merged back onto its call
 *     (`toUIMessages`) and re-parsed by the same detector the live chat uses;
 *   - cache fallback: the cache keeps a compact `output` rebuilt from the
 *     derived plan (`sanitizeChatMessagesForCache`), so the question's keys
 *     must be written back into it.
 *
 * Each path ends where the user does: the card rendered from the reloaded
 * messages, asserted for the question and for the absence of "Build it".
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { ChatbotEnhanced, uiMessageToChatMessage } from '@object-ui/plugin-chatbot';
import { hydratedMessagesToChatMessages } from '../AiChatPage';
import { sanitizeChatMessagesForCache, toUIMessages } from '../../../hooks/useChatConversation';

const ITERATE_OR_NEW = {
  status: 'blueprint_proposed',
  decision: 'iterate_or_new',
  existingAppOverlap: { name: 'library', label: '图书馆' },
  summary: 'A reading-list app',
  blueprint: {
    objects: [{ name: 'book', label: 'Book', fields: [{ name: 'title' }, { name: 'author' }] }],
  },
  counts: { objects: 1, views: 0, dashboards: 0, seedData: 0 },
  questions: [],
};

const LIVE = {
  id: 'a1',
  role: 'assistant' as const,
  parts: [
    {
      type: 'tool-propose_blueprint',
      toolCallId: 'plan-1',
      state: 'output-available' as const,
      input: {},
      output: ITERATE_OR_NEW,
    },
  ],
};

function renderCard(messages: React.ComponentProps<typeof ChatbotEnhanced>['messages']) {
  render(<ChatbotEnhanced messages={messages} onSendMessage={vi.fn()} />);
}

function expectQuestionNotApproval() {
  expect(screen.getByTestId('proposed-plan-iterate-or-new-question').textContent).toContain('图书馆');
  expect(screen.getByTestId('proposed-plan-extend-existing')).toBeInTheDocument();
  expect(screen.getByTestId('proposed-plan-build-new')).toBeInTheDocument();
  expect(screen.queryByTestId('proposed-plan-approve')).toBeNull();
  expect(screen.queryByTestId('proposed-plan-fallback')).toBeNull();
}

afterEach(cleanup);

describe('the iterate_or_new question survives a reload (objectstack#27480)', () => {
  it('server history: the stored result re-parses to the question', () => {
    const ui = toUIMessages([
      {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'plan-1', toolName: 'propose_blueprint', input: {} }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'plan-1',
            output: { type: 'text', value: JSON.stringify(ITERATE_OR_NEW) },
          },
        ],
      },
    ]);
    const messages = hydratedMessagesToChatMessages(ui);
    expect(messages[0]?.toolInvocations?.[0]?.proposedPlan?.iterateOrNew).toEqual({
      app: { name: 'library', label: '图书馆' },
    });
    renderCard(messages);
    expectQuestionNotApproval();
  });

  it('cache fallback: the compact cached output keeps both keys the question is read from', () => {
    const live = uiMessageToChatMessage(LIVE);
    const persisted = JSON.parse(JSON.stringify(sanitizeChatMessagesForCache([live]))) as ReturnType<
      typeof sanitizeChatMessagesForCache
    >;
    const planPart = persisted[0]?.parts.find((p) => p.type === 'tool-propose_blueprint');
    expect(planPart?.output).toMatchObject({
      status: 'blueprint_proposed',
      decision: 'iterate_or_new',
      existingAppOverlap: { name: 'library', label: '图书馆' },
    });

    // Both reads a cache-fallback reload performs: this page's hydration
    // mapper, and the live mapper `useObjectChat` re-runs over the same parts.
    for (const messages of [hydratedMessagesToChatMessages(persisted), [uiMessageToChatMessage(persisted[0])]]) {
      expect(messages[0]?.toolInvocations?.[0]?.proposedPlan?.iterateOrNew).toEqual({
        app: { name: 'library', label: '图书馆' },
      });
      cleanup();
      renderCard(messages);
      expectQuestionNotApproval();
    }
  });

  it('cache fallback: a plain proposal is cached without the question keys (control)', () => {
    const plain = { ...ITERATE_OR_NEW, decision: undefined, existingAppOverlap: undefined };
    const live = uiMessageToChatMessage({ ...LIVE, parts: [{ ...LIVE.parts[0], output: plain }] });
    const persisted = sanitizeChatMessagesForCache([live]);
    const output = persisted[0]?.parts.find((p) => p.type === 'tool-propose_blueprint')?.output as Record<
      string,
      unknown
    >;
    expect(output.status).toBe('blueprint_proposed');
    expect('decision' in output).toBe(false);
    expect('existingAppOverlap' in output).toBe(false);
    renderCard(hydratedMessagesToChatMessages(persisted));
    expect(screen.getByTestId('proposed-plan-approve')).toBeInTheDocument();
  });
});
