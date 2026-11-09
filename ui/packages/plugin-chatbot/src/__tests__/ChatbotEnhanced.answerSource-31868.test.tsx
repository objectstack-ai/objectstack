/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#31868 — an answer turn draws the `source` block its data tools
 * answered, as one collapsed "How this was computed" block, and nothing else
 * of a tool payload reaches that face.
 *
 * The turns are built from wire parts through `uiMessageToChatMessage`, so the
 * lift (`detectAnswerSource`) and the draw are pinned together, the way a
 * streamed or reloaded conversation reaches the chat.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ChatbotEnhanced, type ChatbotProcessVisibility } from '../ChatbotEnhanced';
import { detectAnswerSource, uiMessageToChatMessage } from '../mapMessages';

afterEach(cleanup);

/** A value that sits in the tool payload beside `source` and must never be drawn outside debug. */
const SENTINEL = 'PAYLOAD_SENTINEL_31868';

const SOURCE = {
  object: 'crm_opportunity',
  label: 'Opportunity',
  filter: { stage: 'open', amount: { $gt: 1000 }, is_won: false },
  scope: 'visible_to_you',
  groupBy: ['owner', { field: 'closed_at', dateGranularity: 'quarter' }],
  aggregations: [{ function: 'sum', field: 'amount' }, { function: 'count' }],
  orderBy: [{ field: 'amount', order: 'desc' }],
  limit: 50,
  line: 'Summed the amount of 7 open opportunities',
  records: Array.from({ length: 7 }, (_, i) => ({ id: `r${i + 1}`, label: `Deal ${i + 1}` })),
};

/** The service-ai wire form: the tool's JSON inside a `{ type: 'text', value }` wrapper. */
const wrapped = (body: unknown) => ({ type: 'text', value: JSON.stringify(body) });

const toolPart = (toolCallId: string, toolName: string, output: unknown) => ({
  type: `tool-${toolName}`,
  toolCallId,
  state: 'output-available',
  input: { objectName: 'crm_opportunity', note: SENTINEL },
  output,
});

const turn = (parts: unknown[]) =>
  uiMessageToChatMessage({ id: 'a1', role: 'assistant', parts: [...parts, { type: 'text', text: 'You have 7 open deals.' }] } as never);

const question = { id: 'u1', role: 'user' as const, content: 'How much is in my open pipeline?' };

function renderTurn(parts: unknown[], processVisibility?: ChatbotProcessVisibility) {
  return render(
    <ChatbotEnhanced messages={[question, turn(parts)]} processVisibility={processVisibility} />,
  );
}

const withSource = () =>
  toolPart('t1', 'aggregate_data', wrapped({ rows: [{ owner: SENTINEL, amount: 1 }], source: SOURCE }));

const openBlock = () => fireEvent.click(screen.getByRole('button', { name: 'How this was computed' }));

describe('objectstack#31868 — detectAnswerSource lifts the source block alone', () => {
  it('peels the text wrapper and keeps only the declared members', () => {
    const lifted = detectAnswerSource(wrapped({ rows: [SENTINEL], source: { ...SOURCE, secret: SENTINEL } }));
    expect(lifted).toEqual({
      object: 'crm_opportunity',
      label: 'Opportunity',
      filter: SOURCE.filter,
      scope: 'visible_to_you',
      groupBy: [{ field: 'owner' }, { field: 'closed_at', dateGranularity: 'quarter' }],
      aggregations: [{ function: 'sum', field: 'amount' }, { function: 'count' }],
      records: SOURCE.records,
    });
    expect(JSON.stringify(lifted)).not.toContain(SENTINEL);
  });

  it('a result with no source, or a source without its object, lifts nothing', () => {
    expect(detectAnswerSource(wrapped({ rows: [] }))).toBeUndefined();
    expect(detectAnswerSource(wrapped({ source: { ...SOURCE, object: '' } }))).toBeUndefined();
    expect(detectAnswerSource('plain text answer')).toBeUndefined();
  });

  it('a declared member that is not its shape drops the whole block', () => {
    expect(detectAnswerSource(wrapped({ source: { ...SOURCE, aggregations: 'sum(amount)' } }))).toBeUndefined();
    expect(detectAnswerSource(wrapped({ source: { ...SOURCE, groupBy: [42] } }))).toBeUndefined();
    expect(detectAnswerSource(wrapped({ source: { ...SOURCE, records: [{ id: 'r1' }] } }))).toBeUndefined();
    expect(detectAnswerSource(wrapped({ source: { ...SOURCE, filter: 'stage = open' } }))).toBeUndefined();
  });
});

describe('objectstack#31868 — the "How this was computed" block', () => {
  it('draws collapsed by default: the trigger only, none of its parts', () => {
    renderTurn([withSource()]);
    const block = screen.getByTestId('answer-source');
    expect(within(block).getByRole('button', { name: 'How this was computed' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByTestId('answer-source-section')).toBeNull();
  });

  it('expanding it shows the object, filter, grouping, aggregations, records and scope', () => {
    renderTurn([withSource()]);
    openBlock();
    const section = screen.getByTestId('answer-source-section');
    expect(section).toHaveTextContent('Opportunity');

    const rows = within(screen.getByTestId('answer-source-filter')).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      'stage Equals open',
      'AND amount Greater than 1000',
      'AND is_won Equals False',
    ]);

    expect(section).toHaveTextContent('Grouped byowner, closed_at');
    expect(section).toHaveTextContent('Sum amount');
    expect(section).toHaveTextContent('Count');
    // Five record labels, then the rest as a count.
    expect(screen.getByTestId('answer-source-records')).toHaveTextContent(
      /^Deal 1, Deal 2, Deal 3, Deal 4, Deal 5 and 2 more$/,
    );
    expect(screen.getByTestId('answer-source-scope')).toHaveTextContent('Only records visible to you');
    // Left out on purpose: the order, the limit and the model-facing line.
    expect(section).not.toHaveTextContent('desc');
    expect(section).not.toHaveTextContent('Summed the amount');
  });

  it('a filter that does not lower to flat rows is drawn as served', () => {
    const nested = { $or: [{ stage: 'open' }, { $and: [{ amount: { $gt: 1 } }] }] };
    renderTurn([toolPart('t1', 'query_records', wrapped({ source: { object: 'crm_opportunity', filter: nested } }))]);
    openBlock();
    expect(screen.queryByTestId('answer-source-filter')).toBeNull();
    expect(screen.getByTestId('answer-source-filter-served')).toHaveTextContent(JSON.stringify(nested));
  });

  it('an OR group draws its rows joined by OR, and no filter reads All records', () => {
    renderTurn([
      toolPart('t1', 'query_records', wrapped({ source: { object: 'a', filter: { $or: [{ stage: 'open' }, { stage: 'won' }] } } })),
      toolPart('t2', 'query_records', wrapped({ source: { object: 'b' } })),
    ]);
    openBlock();
    const [first, second] = screen.getAllByTestId('answer-source-section');
    expect(within(first).getAllByRole('listitem').map((r) => r.textContent)).toEqual([
      'stage Equals open',
      'OR stage Equals won',
    ]);
    expect(second).toHaveTextContent('All records');
    // One block for the turn, one section per tool that answered a source.
    expect(screen.getAllByTestId('answer-source')).toHaveLength(1);
  });

  it('a turn whose tools answered no source draws no block', () => {
    renderTurn([toolPart('t1', 'query_records', wrapped({ rows: [{ name: 'Deal 1' }] }))]);
    expect(screen.queryByTestId('answer-source')).toBeNull();
    expect(screen.queryByRole('button', { name: 'How this was computed' })).toBeNull();
  });

  it.each<ChatbotProcessVisibility>(['summary', 'hidden'])(
    'in %s mode the block is drawn, and nothing else of the payload is',
    (mode) => {
      renderTurn([withSource()], mode);
      openBlock();
      expect(screen.getByTestId('answer-source-section')).toBeInTheDocument();
      expect(document.body).not.toHaveTextContent(SENTINEL);
    },
  );

  it('debug mode keeps its tool card with its raw payload, and draws the block too', () => {
    renderTurn([withSource()], 'debug');
    expect(screen.getByTestId('answer-source')).toBeInTheDocument();
    // The debug card is the developer surface it was: its raw parameters and result.
    fireEvent.click(screen.getByRole('button', { name: /aggregate_data/ }));
    expect(screen.getByText('Parameters')).toBeInTheDocument();
    expect(screen.getByText('Result')).toBeInTheDocument();
  });

  it('reads the shipped zh pack', async () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
        <ChatbotEnhanced messages={[question, turn([withSource()])]} />
      </I18nProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '计算方式' }));
    expect(screen.getByTestId('answer-source-records')).toHaveTextContent('另有 2 条');
    expect(screen.getByTestId('answer-source-scope')).toHaveTextContent('仅包含你可见的记录');
  });
});
