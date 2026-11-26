// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37487 — an answer's verified record citations are drawn again
 * after a reload, from either place a reload restores a conversation from:
 *
 *  - Server history: rows → `toUIMessages` → `hydratedMessagesToChatMessages`.
 *    The persisted `data-record-citations` part is read back as it was stored,
 *    never verified again (ruling Q1 on objectstack#37144).
 *  - Cache fallback: the live map → `sanitizeChatMessagesForCache` → JSON →
 *    `hydratedMessagesToChatMessages`.
 *
 * Both rebuilds go through the one allow-list of kept data parts
 * (`STORED_ANSWER_DATA_PARTS`). The reference is the chips the live answer
 * draws; CONTROL: a part the contract refuses draws nothing on either path.
 * The API-mode store rebuild is pinned in plugin-chatbot's
 * `useObjectChat.recordCitationsReload-37487.test.tsx`.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RECORD_CITATIONS_PART_TYPE } from '@objectstack/spec/ai';
import { ChatbotEnhanced, uiMessageToChatMessage } from '@object-ui/plugin-chatbot';
import { hydratedMessagesToChatMessages } from '../AiChatPage';
import { sanitizeChatMessagesForCache, toUIMessages } from '../../../hooks/useChatConversation';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TEXT = 'The policy covers contractors.';
const CITATIONS = [
  { object: 'policy', id: 'pol_7', context: 'policy_document', anchor: 'scope', quote: 'Applies to every contractor on site.' },
  { object: 'policy', id: 'pol_7', quote: 'Revision 3 published 2026-10-01' },
];
/** An alias the contract refuses by name (`section` for `anchor`). */
const REFUSED = [{ ...CITATIONS[0], section: 'scope' }];

const citationsPart = (data: unknown) => ({ type: RECORD_CITATIONS_PART_TYPE, id: 'record-citations', data });

const liveAnswer = (data: unknown) =>
  uiMessageToChatMessage({
    id: 'a1',
    role: 'assistant',
    parts: [{ type: 'text', text: TEXT }, citationsPart(data)],
  } as never);

/** The stored turn, as the server persists the answer's parts. */
const serverHistory = (data: unknown) =>
  toUIMessages([
    { id: 'u1', role: 'user', content: 'Who does the policy cover?' },
    { id: 'a1', role: 'assistant', content: [{ type: 'text', text: TEXT }, citationsPart(data)] },
  ] as never);

const chipQuotes = () => screen.queryAllByTestId('record-citation').map((chip) => chip.textContent);

function chipsOf(messages: unknown[]) {
  render(<ChatbotEnhanced messages={messages as never} />);
  const quotes = chipQuotes();
  cleanup();
  return quotes;
}

const LIVE_CHIPS = () => chipsOf([liveAnswer(CITATIONS)]);

describe('a reloaded answer draws its citation chips again (objectstack#37487)', () => {
  it('the live answer draws two chips (the reference)', () => {
    expect(LIVE_CHIPS()).toHaveLength(2);
  });

  it('server history: the persisted part draws the same chips, and nothing is fetched', () => {
    const fetchSpy = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchSpy);
    const [, answer] = hydratedMessagesToChatMessages(serverHistory(CITATIONS));
    expect(answer.content).toBe(TEXT);
    expect(answer.recordCitations).toEqual(CITATIONS);
    expect(chipsOf([answer])).toEqual(LIVE_CHIPS());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('server history CONTROL: a refused part draws nothing', () => {
    const [, answer] = hydratedMessagesToChatMessages(serverHistory(REFUSED));
    expect(answer.content).toBe(TEXT);
    expect(answer.recordCitations).toBeUndefined();
    expect(chipsOf([answer])).toEqual([]);
  });

  it('cache fallback: the live answer is cached and restored with the same chips', () => {
    const cached = JSON.parse(JSON.stringify(sanitizeChatMessagesForCache([liveAnswer(CITATIONS)])));
    expect(cached[0].parts.map((p: { type: string }) => p.type)).toEqual(['text', RECORD_CITATIONS_PART_TYPE]);
    const [restored] = hydratedMessagesToChatMessages(cached);
    expect(restored.content).toBe(TEXT);
    expect(chipsOf([restored])).toEqual(LIVE_CHIPS());
  });

  it('cache fallback: a restored server answer is re-cached without losing its chips', () => {
    const [, answer] = hydratedMessagesToChatMessages(serverHistory(CITATIONS));
    const cached = JSON.parse(JSON.stringify(sanitizeChatMessagesForCache([answer])));
    const [restored] = hydratedMessagesToChatMessages(cached);
    expect(restored.recordCitations).toEqual(answer.recordCitations);
  });

  it('cache fallback CONTROL: a refused part is not cached and draws nothing', () => {
    const live = liveAnswer(REFUSED);
    expect(live.recordCitations).toBeUndefined();
    const cached = JSON.parse(JSON.stringify(sanitizeChatMessagesForCache([live])));
    expect(cached[0].parts.map((p: { type: string }) => p.type)).toEqual(['text']);
    const [restored] = hydratedMessagesToChatMessages(cached);
    expect(chipsOf([restored])).toEqual([]);
  });
});
