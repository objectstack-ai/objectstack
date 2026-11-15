/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#33734 — an answer computed through `query_dataset` draws its
 * `provenance` block (`DatasetProvenanceSchema`, ADR-0149 D3) in the turn's
 * "How this was computed" block: the dataset, each metric, the grouping and
 * the caller's filter. The object-query `source` block draws as it did.
 *
 * The turns are built from wire parts through `uiMessageToChatMessage`, so
 * the lift (`detectAnswerSource`) and the draw are pinned together, the way a
 * streamed or reloaded conversation reaches the chat. The fixture is a
 * `query_dataset` answer the published output contract accepts.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ChatbotEnhanced } from '../ChatbotEnhanced';
import { DatasetProvenanceSchema, QUERY_DATASET_TOOL_NAME, QueryDatasetOutputSchema } from '@objectstack/spec/ai';
import { detectAnswerSource, uiMessageToChatMessage } from '../mapMessages';

afterEach(cleanup);

/** A value that sits in the tool payload beside `provenance` and must never be drawn. */
const SENTINEL = 'PAYLOAD_SENTINEL_33734';

const PROVENANCE = {
  kind: 'dataset',
  dataset: { name: 'sales_analysis', label: 'Sales analysis' },
  measures: [
    {
      name: 'total_amount',
      label: 'Revenue',
      description: 'Closed-won amount, before refunds',
    },
    { name: 'deal_count', label: '' },
  ],
  dimensions: [
    { name: 'stage', label: 'Stage' },
    { name: 'owner', label: 'Owner' },
  ],
  runtimeFilter: { region: 'EMEA', amount: { $gte: 1000 } },
} as const;

/** A `query_dataset` answer: rows and fields, then `provenance`, `rowCount`, `truncated`. */
const ANSWER = {
  rows: [{ stage: SENTINEL, owner: 'u1', total_amount: 1200, deal_count: 2 }],
  fields: [
    { name: 'stage', type: 'string', label: 'Stage' },
    { name: 'total_amount', type: 'number', label: 'Revenue' },
  ],
  provenance: PROVENANCE,
  rowCount: 1,
  truncated: false,
};

/** The service-ai wire form: the tool's JSON inside a `{ type: 'text', value }` wrapper. */
const wrapped = (body: unknown) => ({ type: 'text', value: JSON.stringify(body) });

const toolPart = (toolCallId: string, toolName: string, output: unknown) => ({
  type: `tool-${toolName}`,
  toolCallId,
  state: 'output-available',
  input: { datasetName: 'sales_analysis', note: SENTINEL },
  output,
});

const turn = (parts: unknown[]) =>
  uiMessageToChatMessage({
    id: 'a1',
    role: 'assistant',
    parts: [...parts, { type: 'text', text: 'Revenue in EMEA is 1,200.' }],
  } as never);

const question = { id: 'u1', role: 'user' as const, content: 'What is our EMEA revenue by stage?' };

const datasetPart = (answer: unknown = ANSWER) => toolPart('t1', QUERY_DATASET_TOOL_NAME, wrapped(answer));

const renderTurn = (parts: unknown[]) =>
  render(<ChatbotEnhanced messages={[question, turn(parts)]} />);

const openBlock = () => fireEvent.click(screen.getByRole('button', { name: 'How this was computed' }));

describe('objectstack#33734 — the fixture is a query_dataset answer the contract accepts', () => {
  it('QueryDatasetOutputSchema accepts the answer', () => {
    expect(QueryDatasetOutputSchema.safeParse(ANSWER).success).toBe(true);
  });
});

describe('objectstack#33734 — detectAnswerSource lifts a dataset provenance block', () => {
  it('lifts the provenance alone, through the published contract', () => {
    const lifted = detectAnswerSource(
      wrapped({ ...ANSWER, provenance: { ...PROVENANCE, secret: SENTINEL } }),
    );
    expect(lifted).toEqual(PROVENANCE);
    expect(JSON.stringify(lifted)).not.toContain(SENTINEL);
  });

  it('a provenance the contract refuses lifts nothing', () => {
    expect(detectAnswerSource(wrapped({ ...ANSWER, provenance: { ...PROVENANCE, kind: 'object' } }))).toBeUndefined();
    expect(detectAnswerSource(wrapped({ ...ANSWER, provenance: { ...PROVENANCE, measures: 'Revenue' } }))).toBeUndefined();
    expect(DatasetProvenanceSchema.safeParse({ ...PROVENANCE, dataset: 'sales_analysis' }).success).toBe(false);
    expect(detectAnswerSource(wrapped({ ...ANSWER, provenance: { ...PROVENANCE, dataset: 'sales_analysis' } }))).toBeUndefined();
  });
});

describe('objectstack#33734 — a query_dataset answer draws its provenance', () => {
  it('shows the dataset, each metric, the grouping and the filter', () => {
    renderTurn([datasetPart()]);
    openBlock();
    const section = screen.getByTestId('answer-source-dataset-section');
    expect(section).toHaveAttribute('data-dataset', 'sales_analysis');

    expect(within(section).getByTestId('answer-source-dataset')).toHaveTextContent(/^Sales analysis$/);

    const metrics = within(within(section).getByTestId('answer-source-metrics')).getAllByRole('listitem');
    // The label, with the name beside it; the name alone where the label is empty.
    expect(metrics.map((m) => m.querySelector('[data-testid="answer-source-metric-label"]')?.textContent)).toEqual([
      'Revenue',
      'deal_count',
    ]);
    expect(metrics.map((m) => m.querySelector('[data-testid="answer-source-metric-name"]')?.textContent ?? null)).toEqual([
      'total_amount',
      null,
    ]);
    expect(metrics[0]).toHaveTextContent('Closed-won amount, before refunds');

    expect(section).toHaveTextContent('Grouped byStage, Owner');

    const rows = within(within(section).getByTestId('answer-source-filter')).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      'region Equals EMEA',
      'AND amount Greater than or equal 1000',
    ]);

    // An object-query section is not drawn for a dataset answer, and nothing
    // of the rows or the arguments reaches the block.
    expect(screen.queryByTestId('answer-source-section')).toBeNull();
    expect(screen.queryByTestId('answer-source-scope')).toBeNull();
    expect(document.body).not.toHaveTextContent(SENTINEL);
  });

  it('a selection with no filter and no dimensions says no filter was added and draws no grouping', () => {
    const { runtimeFilter: _omit, ...bare } = PROVENANCE;
    renderTurn([datasetPart({ ...ANSWER, provenance: { ...bare, dimensions: [] } })]);
    openBlock();
    const section = screen.getByTestId('answer-source-dataset-section');
    expect(within(section).queryByTestId('answer-source-filter')).toBeNull();
    expect(within(section).getByTestId('answer-source-no-added-filter')).toHaveTextContent(
      'No filter added to the dataset definition',
    );
    expect(section).not.toHaveTextContent('Grouped by');
    // A dataset answer is not "all records": the dataset's own definition still applies.
    expect(section).not.toHaveTextContent('All records');
  });

  it('a filter that does not lower to flat rows is drawn as served', () => {
    const nested = { $or: [{ region: 'EMEA' }, { $and: [{ amount: { $gt: 1 } }] }] };
    renderTurn([datasetPart({ ...ANSWER, provenance: { ...PROVENANCE, runtimeFilter: nested } })]);
    openBlock();
    const section = screen.getByTestId('answer-source-dataset-section');
    expect(within(section).getByTestId('answer-source-filter-served')).toHaveTextContent(JSON.stringify(nested));
  });

  it('a turn with a dataset answer and an object-query answer draws one block with both, in call order', () => {
    renderTurn([
      datasetPart(),
      toolPart(
        't2',
        'query_records',
        wrapped({ source: { object: 'crm_opportunity', scope: 'visible_to_you', line: 'Read the matching records' } }),
      ),
    ]);
    openBlock();
    expect(screen.getAllByTestId('answer-source')).toHaveLength(1);
    const block = screen.getByTestId('answer-source');
    const sections = block.querySelectorAll('[data-testid="answer-source-dataset-section"], [data-testid="answer-source-section"]');
    expect(Array.from(sections).map((s) => s.getAttribute('data-testid'))).toEqual([
      'answer-source-dataset-section',
      'answer-source-section',
    ]);
  });

  it('CONTROL: an object-query answer draws as it did, with no dataset section', () => {
    renderTurn([
      toolPart(
        't1',
        'aggregate_data',
        wrapped({
          rows: [],
          source: {
            object: 'crm_opportunity',
            label: 'Opportunities',
            filter: { stage: 'open' },
            scope: 'visible_to_you',
            records: 7,
            line: 'Summed the amount of 7 open opportunities',
          },
        }),
      ),
    ]);
    openBlock();
    expect(screen.queryByTestId('answer-source-dataset-section')).toBeNull();
    const section = screen.getByTestId('answer-source-section');
    expect(section).toHaveTextContent('ObjectOpportunities');
    expect(within(section).getAllByRole('listitem').map((r) => r.textContent)).toEqual(['stage Equals open']);
    expect(screen.getByTestId('answer-source-records')).toHaveTextContent(/^7$/);
    expect(screen.getByTestId('answer-source-scope')).toHaveTextContent('Only records visible to you');
  });

  it('CONTROL: a query_dataset result with no provenance (a refusal) draws no block', () => {
    renderTurn([
      datasetPart({ error: { code: 'NOT_FOUND', status: 404, message: 'Dataset not found' } }),
    ]);
    expect(screen.getByText('Revenue in EMEA is 1,200.')).toBeInTheDocument();
    expect(screen.queryByTestId('answer-source')).toBeNull();
    expect(screen.queryByRole('button', { name: 'How this was computed' })).toBeNull();
  });

  it('reads the shipped zh pack', async () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
        <ChatbotEnhanced messages={[question, turn([datasetPart()])]} />
      </I18nProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '计算方式' }));
    const section = screen.getByTestId('answer-source-dataset-section');
    expect(section).toHaveTextContent('数据集Sales analysis');
    expect(section).toHaveTextContent('指标');
  });
});
