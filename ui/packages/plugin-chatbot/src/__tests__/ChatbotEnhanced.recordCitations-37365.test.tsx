/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#37365 (ADR-0160 D9) — an answer draws its verified record
 * citations as chips, and a chip opens the cited record at its section.
 *
 * The turns are built from wire parts through `uiMessageToChatMessage`, so the
 * lift (`extractRecordCitations`, through the spec's `RecordCitationsSchema`)
 * and the draw are pinned together, the way a streamed conversation reaches
 * the chat.
 *
 * - A chip shows the quote; a click calls `onOpenRecord` with the citation's
 *   `object` / `id` and its `anchor`.
 * - A quote taken from a related row still opens the root record: the chip
 *   opens the citation's `object` / `id`, nothing else.
 * - The list is drawn as persisted: nothing is fetched to verify it again.
 * - A part the parse refuses draws nothing, and the CONTROL (the same turn
 *   with a part that parses) draws its chips.
 * - The record-link grammar is unchanged: a fragment is still refused.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RECORD_CITATIONS_MAX, RECORD_CITATIONS_PART_TYPE } from '@objectstack/spec/ai';
import { ChatbotEnhanced } from '../ChatbotEnhanced';
import { extractRecordCitations, uiMessageToChatMessage } from '../mapMessages';
import { parseRecordLink } from '../recordLink';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A citation to a section of the root record's body. */
const SECTION_CITATION = {
  object: 'policy',
  id: 'pol_7',
  context: 'policy_document',
  anchor: 'scope',
  quote: 'Applies to every contractor on site.',
};

/** A citation whose quote came from a related-list cell: it still names the root record. */
const RELATED_ROW_CITATION = {
  object: 'policy',
  id: 'pol_7',
  context: 'policy_document',
  quote: 'Revision 3 published 2026-10-01',
};

const citationsPart = (data: unknown) => ({ type: RECORD_CITATIONS_PART_TYPE, id: 'record-citations', data });

const turn = (parts: unknown[]) =>
  uiMessageToChatMessage({
    id: 'a1',
    role: 'assistant',
    parts: [{ type: 'text', text: 'The policy covers contractors.' }, ...parts],
  } as never);

const question = { id: 'u1', role: 'user' as const, content: 'Who does the policy cover?' };

function renderTurn(parts: unknown[], onOpenRecord = vi.fn()) {
  render(<ChatbotEnhanced messages={[question, turn(parts)]} onOpenRecord={onOpenRecord} />);
  return onOpenRecord;
}

const chips = () => screen.queryAllByTestId('record-citation');

describe('objectstack#37365 — extractRecordCitations reads the part through the spec schema', () => {
  it('lifts the parsed list', () => {
    expect(extractRecordCitations([citationsPart([SECTION_CITATION, RELATED_ROW_CITATION])] as never)).toEqual([
      SECTION_CITATION,
      RELATED_ROW_CITATION,
    ]);
  });

  it('reads the last part of the type', () => {
    const parts = [citationsPart([SECTION_CITATION]), citationsPart([RELATED_ROW_CITATION])];
    expect(extractRecordCitations(parts as never)).toEqual([RELATED_ROW_CITATION]);
  });

  it.each([
    ['an alias the schema refuses by name (`section` for `anchor`)', [{ ...RELATED_ROW_CITATION, section: 'scope' }]],
    ['a key the schema does not declare', [{ ...SECTION_CITATION, field: 'content' }]],
    ['a citation with no quote', [{ object: 'policy', id: 'pol_7' }]],
    ['more citations than the bound', Array.from({ length: RECORD_CITATIONS_MAX + 1 }, () => SECTION_CITATION)],
    ['data that is not a list', { citations: [SECTION_CITATION] }],
  ])('a part the parse refuses is no list: %s', (_label, data) => {
    expect(extractRecordCitations([citationsPart(data)] as never)).toBeUndefined();
  });

  it('an empty list, or no part at all, is no list', () => {
    expect(extractRecordCitations([citationsPart([])] as never)).toBeUndefined();
    expect(extractRecordCitations([{ type: 'text', text: 'hi' }] as never)).toBeUndefined();
  });
});

describe('objectstack#37365 — the chips under an answer', () => {
  it('each chip shows its quote, and a click opens the record at the cited section', () => {
    const onOpenRecord = renderTurn([citationsPart([SECTION_CITATION])]);
    expect(screen.getByTestId('record-citations')).toHaveTextContent('Cited from records');
    expect(chips()).toHaveLength(1);
    expect(chips()[0]).toHaveTextContent(SECTION_CITATION.quote);
    fireEvent.click(chips()[0]);
    expect(onOpenRecord).toHaveBeenCalledTimes(1);
    expect(onOpenRecord).toHaveBeenCalledWith({ objectName: 'policy', recordId: 'pol_7', anchor: 'scope' });
  });

  it('a quote from a related row opens the root record, with no anchor', () => {
    const onOpenRecord = renderTurn([citationsPart([RELATED_ROW_CITATION])]);
    fireEvent.click(chips()[0]);
    expect(onOpenRecord).toHaveBeenCalledWith({ objectName: 'policy', recordId: 'pol_7' });
  });

  it('draws the persisted list as it is: nothing is fetched to verify it again', () => {
    const fetchSpy = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchSpy);
    renderTurn([citationsPart([SECTION_CITATION, RELATED_ROW_CITATION])]);
    expect(chips()).toHaveLength(2);
    fireEvent.click(chips()[1]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a part that fails the parse draws nothing; CONTROL: the same turn with a part that parses draws its chips', () => {
    renderTurn([citationsPart([{ ...SECTION_CITATION, section: 'scope' }])]);
    expect(screen.queryByTestId('record-citations')).toBeNull();
    expect(chips()).toHaveLength(0);
    cleanup();
    renderTurn([citationsPart([SECTION_CITATION])]);
    expect(screen.getByTestId('record-citations')).toBeInTheDocument();
    expect(chips()).toHaveLength(1);
  });

  it('with no record opener the chips are drawn and open nothing', () => {
    render(<ChatbotEnhanced messages={[question, turn([citationsPart([SECTION_CITATION])])]} />);
    expect(chips()).toHaveLength(1);
    expect(chips()[0].tagName).not.toBe('BUTTON');
  });
});

describe('objectstack#37365 — the record-link grammar is unchanged', () => {
  it('refuses a fragment; CONTROL: the bare record form is read', () => {
    expect(parseRecordLink('/record/policy/pol_7#scope')).toBeNull();
    expect(parseRecordLink('/record/policy/pol_7?section=scope')).toBeNull();
    expect(parseRecordLink('/record/policy/pol_7')).toEqual({ objectName: 'policy', recordId: 'pol_7' });
  });
});
