/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#37487 — an answer's verified record citations survive API mode's
 * store rebuild.
 *
 * app-shell hands `useObjectChat` the hydrated thread with each answer's
 * `recordCitations` lifted off its stored `data-record-citations` part. API
 * mode rebuilds each message into the AI SDK store and maps the store back on
 * every render, so the list has to go back in as that part, through the one
 * allow-list of kept data parts (`STORED_ANSWER_DATA_PARTS`), for its chips to
 * draw again. The mock stands in for the store, as in
 * `useObjectChat.persistedChart-25908.test.tsx`.
 *
 * - The restored answer draws the same chips the live one drew.
 * - CONTROL: a list the contract refuses draws nothing: the store part is read
 *   back through the same parse as a live one, so the rebuild is no way round it.
 * - The allow-list's citations entry is the spec's part type.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { RECORD_CITATIONS_PART_TYPE } from '@objectstack/spec/ai';
import { ChatbotEnhanced } from '../ChatbotEnhanced';
import { toRuntimeMessages } from '../chatMessageAdapter';
import { STORED_ANSWER_DATA_PARTS, uiMessageToChatMessage } from '../mapMessages';
import { useObjectChat, type UseObjectChatOptions } from '../useObjectChat';

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

afterEach(cleanup);

const API = 'https://example.test/api/v1/ai/agents/ask/chat';
const TEXT = 'The policy covers contractors.';

const CITATIONS = [
  { object: 'policy', id: 'pol_7', context: 'policy_document', anchor: 'scope', quote: 'Applies to every contractor on site.' },
  { object: 'policy', id: 'pol_7', quote: 'Revision 3 published 2026-10-01' },
];

/** The chips the live stream draws: the reference a restored answer must equal. */
const LIVE = uiMessageToChatMessage({
  id: 'a1',
  role: 'assistant',
  parts: [
    { type: 'text', text: TEXT },
    { type: RECORD_CITATIONS_PART_TYPE, id: 'record-citations', data: CITATIONS },
  ],
} as never);

const hydrated = (recordCitations: unknown[]): NonNullable<UseObjectChatOptions['initialMessages']> => [
  { id: 'u1', role: 'user', content: 'Who does the policy cover?' },
  { id: 'a1', role: 'assistant', content: TEXT, recordCitations } as never,
];

function restore(recordCitations: unknown[]) {
  const { result } = renderHook(() =>
    useObjectChat({ api: API, conversationId: 'c1', initialMessages: hydrated(recordCitations) }),
  );
  return result.current.messages;
}

const chipQuotes = () => screen.queryAllByTestId('record-citation').map((chip) => chip.textContent);

describe('restored citations survive the API-mode store (objectstack#37487)', () => {
  it('the allow-list names the spec part type', () => {
    expect(STORED_ANSWER_DATA_PARTS.recordCitations).toBe(RECORD_CITATIONS_PART_TYPE);
    expect(STORED_ANSWER_DATA_PARTS.charts).toBe('data-chart');
  });

  it('the restored answer draws the chips the live one drew', () => {
    render(<ChatbotEnhanced messages={[LIVE]} />);
    const live = chipQuotes();
    expect(live).toHaveLength(2);
    cleanup();
    const messages = restore(CITATIONS);
    expect(messages[1].content).toBe(TEXT);
    expect(messages[1].recordCitations).toEqual(LIVE.recordCitations);
    render(<ChatbotEnhanced messages={toRuntimeMessages(messages)} />);
    expect(chipQuotes()).toEqual(live);
  });

  it('CONTROL: a list the contract refuses draws nothing', () => {
    const messages = restore([{ ...CITATIONS[0], section: 'scope' }]);
    expect(messages[1].content).toBe(TEXT);
    expect(messages[1].recordCitations).toBeUndefined();
    render(<ChatbotEnhanced messages={toRuntimeMessages(messages)} />);
    expect(chipQuotes()).toEqual([]);
  });
});
