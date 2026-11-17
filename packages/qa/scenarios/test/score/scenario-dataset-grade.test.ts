// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The three dataset graders (`scenario-dataset-grade.ts`) on synthetic
 * transcripts, against the order-to-cash card's datasets as it loads: the
 * route an answer took, never its figure.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadScenarioFile, readCapabilityAreas, type LoadedScenario } from '../../src/loader.js';
import { namespacedScenario } from '../../src/runner/namespace.js';
import type { DatasetQuestion } from '../../src/schema.js';
import { gradeCardDatasetQuestion, labelsFallback, statedFigures, type RunToolCall } from '../../src/score/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CARD = resolve(HERE, '../../../../../docs/qa/scenarios/order_to_cash.json');
const AREAS = resolve(HERE, '../../../../../docs/qa/platform-checklist/areas');

function load(): LoadedScenario {
  const { card, refusals } = loadScenarioFile(CARD, { areas: readCapabilityAreas(AREAS), library: 'open' });
  expect(refusals).toEqual([]);
  // The run grades the namespace-relative card: dataset names plain, objects prefixed.
  return namespacedScenario(card!);
}
const scenario = load();
const grade = (id: string, replyText: string, toolCalls: Array<RunToolCall & { isError?: boolean }> = []) => gradeCardDatasetQuestion(scenario, id, { replyText, toolCalls });
const failed = (g: ReturnType<typeof grade>) => g.checks.filter((c) => !c.pass).map((c) => c.check);

const provenance = (dataset: string, measures: string[]) => JSON.stringify({ rows: [{ x: 1 }], provenance: { kind: 'dataset', dataset: { name: dataset, label: dataset }, measures: measures.map((name) => ({ name, label: name })) } });
const queryDataset = (output: string, isError = false) => ({ name: 'query_dataset', input: { datasetName: 'order_book', selection: { measures: ['booked_amount'] } }, output, ...(isError ? { isError } : {}) });
const listDatasets = (output: unknown) => ({ name: 'list_datasets', input: { terms: ['booking'] }, output: JSON.stringify(output) });

describe('metric-selected — the answer came through query_dataset with the expected measure, read off the tool’s provenance', () => {
  it('passes on a query_dataset answer whose provenance names the dataset and the measure', () => {
    const g = grade('dq_bookings', 'Bookings come to 412,300.\nSource: Booked amount (Order book)', [queryDataset(provenance('order_book', ['booked_amount']))]);
    expect([g.grader, g.pass, failed(g)]).toEqual(['metric-selected', true, []]);
  });

  it('fails on another measure, on an object query, and on a refused query_dataset — each saying which', () => {
    const other = grade('dq_bookings', 'Billed 380,000.', [queryDataset(provenance('billing', ['billed_amount']))]);
    expect(other.checks[0]).toMatchObject({ pass: false, detail: 'query_dataset answered with billing.billed_amount, not order_book.booked_amount' });
    const objectQuery = grade('dq_bookings', 'Bookings: 412,300', [{ name: 'aggregate_records', input: { objectName: 'demoorder_sales_order' }, output: '{"value":412300}' }]);
    expect(objectQuery.checks[0]).toMatchObject({ pass: false, detail: 'no query_dataset call answered' });
    const refused = grade('dq_bookings', 'Could not read it.', [queryDataset(JSON.stringify({ error: { code: 'NOT_FOUND', status: 404 } }), true)]);
    expect(refused.checks[0]).toMatchObject({ pass: false, detail: 'no query_dataset call answered (every one was refused)' });
  });

  it('the arguments the model sent decide nothing: a provenance-less answer is no route, whatever the selection asked for', () => {
    const g = grade('dq_bookings', 'Bookings: 412,300', [queryDataset('{"rows":[{"booked_amount":412300}]}')]);
    expect(g.checks[0]).toMatchObject({ pass: false, detail: 'query_dataset answered with no provenance naming a measure' });
  });

  it('an ask-back on a word with exactly one match is a miss: no query_dataset answered', () => {
    expect(grade('dq_bookings', 'Do you mean the booked amount or the billed amount?').pass).toBe(false);
  });
});

describe('asked-back — asks which reading is meant, names every candidate, states no figure', () => {
  it('passes on an ambiguous word when the reply asks and names both candidates by words other than the asked one', () => {
    const g = grade('dq_revenue', '"Revenue" could mean two things here:\n1. Booked amount (Order book): what the sales orders total.\n2. Billed amount (Billing): what was invoiced.\nWhich one do you mean?');
    expect([g.grader, g.pass, failed(g)]).toEqual(['asked-back', true, []]);
  });

  it('echoing the ambiguous word names no candidate: "which revenue?" is not a choice offered', () => {
    const g = grade('dq_revenue', 'Which revenue do you mean?');
    expect(failed(g)).toEqual(['asked-back:names-candidates']);
    expect(g.checks.find((c) => c.check === 'asked-back:names-candidates')!.detail).toBe('the reply does not name order_book.booked_amount, billing.billed_amount');
  });

  it('a figure fails it — an answer with a question tacked on still picked a reading — and so does a reply that asks nothing', () => {
    const picked = grade('dq_revenue', 'Booked amount is 412,300; billed amount is 380,000. Did you want one of these?');
    expect(failed(picked)).toEqual(['asked-back:no-figure']);
    expect(picked.checks.find((c) => !c.pass)!.detail).toBe('the reply states 412300, 380000');
    expect(failed(grade('dq_revenue', 'There are two readings: the booked amount and the billed amount.'))).toEqual(['asked-back:asks']);
  });

  it('a near-miss word: the reply offers the candidate the word is close to (here off the skill’s or the tool description’s rule)', () => {
    const g = grade('dq_booking_total', '"Booking" is not a defined metric. Did you mean Booked amount (bookings)?');
    expect([g.pass, g.notes]).toEqual([true, ['called no list_datasets']]);
    expect(failed(grade('dq_booking_total', 'Your booking total is 412,300.'))).toEqual(['asked-back:asks', 'asked-back:names-candidates', 'asked-back:no-figure']);
  });

  it('a near-miss ask-back led by a `list_datasets` answer that offers `candidates` grades the same, and the note names what was offered', () => {
    const offered = listDatasets({ datasets: [], candidates: [{ dataset: 'order_book', member: 'booked_amount', label: 'Booked amount' }] });
    const g = grade('dq_booking_total', 'No exact match for "booking". The closest is Booked amount (Order book) — is that it?', [offered]);
    expect(g.pass).toBe(true);
    expect(g.notes).toEqual(['list_datasets offered candidates order_book.booked_amount']);
  });

  it('an option list’s numbering is no figure', () => {
    expect(statedFigures('1. Booked amount\n2) Billed amount\n3、开票金额')).toEqual([]);
    expect(statedFigures('1. Booked amount: 412,300')).toEqual([412300]);
  });

  it('an ask-back that counts its candidates, or names a year alone, states no figure — English and Chinese', () => {
    const counted = [
      'I found 2 metrics that match "revenue": Booked amount (Order book) or Billed amount (Billing). Which one do you mean?',
      'There are 2 possible readings of revenue in 2025: the booked amount or the billed amount?',
      '营收对应 2 个指标:订单金额(Order book)和开票金额(Billing)。您是指哪一个?',
      '2025 年的营收有两个指标:订单金额和开票金额,您是指哪一个?',
      '营收有 2 种口径:订单金额,或开票金额?',
    ];
    for (const reply of counted) {
      const g = grade('dq_revenue', reply);
      expect([reply, g.pass, failed(g)]).toEqual([reply, true, []]);
    }
    for (const text of ['I found 12 matching metrics', 'revenue for 2026?', 'In 2025, which one?', 'FY 2024 or calendar year 2025?', '2025年', '对应 3 个可能的口径', '有 2 项指标']) {
      expect([text, statedFigures(text)]).toEqual([text, []]);
    }
  });

  it('a real figure still fails no-figure beside a counted candidate or a year: an amount, a percentage, a count of records, a decimal, a unit', () => {
    for (const [reply, figures] of [
      ['Revenue is 1,234,500. I found 2 metrics, booked amount and billed amount — which one?', [1234500]],
      ['营收为 123.4 万元,对应 2 个指标:订单金额和开票金额,您是指哪一个?', [123.4, 1234000]],
      ['Billed amount is up 42% in 2025 — booked amount or billed amount?', [42]],
      ['There are 42 orders in 2 datasets: booked amount or billed amount?', [42]],
      ['Booked amount is 2025 and billed amount 1999 — which one?', [2025, 1999]],
      ['A total of 2025 orders across 2 metrics: booked amount or billed amount?', [2025]],
      ['In 2025 revenue was 3.2M — booked amount or billed amount?', [3.2, 3200000]],
      ['共 3 张发票,2 个指标:订单金额或开票金额?', [3]],
      ['$12 metrics? Booked amount or billed amount?', [12]],
      ['in 2025 dollars: booked amount or billed amount?', [2025]],
    ] as const) {
      expect([reply, statedFigures(reply)]).toEqual([reply, figures]);
      const g = grade('dq_revenue', reply);
      expect([reply, failed(g)]).toEqual([reply, ['asked-back:no-figure']]);
    }
  });

  it('a year-shaped count after a time word stays a figure when a counted noun follows; a year followed by its subject or by grammar does not', () => {
    for (const [reply, figures] of [
      ['We received payments for 2031 orders — booked amount or billed amount?', [2031]],
      ['Revenue came from 1980 invoices, booked amount or billed amount?', [1980]],
      ['Since 2020 people bought it — booked amount or billed amount?', [2020]],
      ['收到 2031 笔付款:订单金额或开票金额?', [2031]],
      ['来自 1980 张发票:订单金额或开票金额?', [1980]],
    ] as const) {
      expect([reply, statedFigures(reply)]).toEqual([reply, figures]);
      const g = grade('dq_revenue', reply);
      expect([reply, failed(g)]).toEqual([reply, ['asked-back:no-figure']]);
    }
    expect(statedFigures('payments for 2031 orders')).toEqual([2031]);
    expect(statedFigures('from 1980 invoices')).toEqual([1980]);
    for (const text of ['In 2025 sales grew', 'since 2020 sales', 'Since 2020 earnings, booked or billed?', 'In 2025 its booked amount or billed amount?', 'In 2025 this means booked amount or billed amount?', '2025 年销售额增长', '自 2020 年起的营收']) {
      expect([text, statedFigures(text)]).toEqual([text, []]);
    }
    expect(statedFigures('In 2025 sales grew 12%')).toEqual([12]);
  });
});

describe('fallback-labelled — an object query answered, and the reply says it is not a governed metric', () => {
  const countPayments = { name: 'aggregate_records', input: { objectName: 'demoorder_payment', aggregations: [{ function: 'count' }] }, output: '{"value":72}' };

  it('passes on an object query of the question’s object with a not-governed label, in English or Chinese', () => {
    const en = grade('dq_payment_count', 'We have received 72 payments.\nSource: payments (an object query, not a governed metric).', [countPayments]);
    expect([en.grader, en.pass]).toEqual(['fallback-labelled', true]);
    expect(grade('dq_payment_count', '共收到 72 笔付款。来源:对象 payment 的记录计数(非指标口径)', [countPayments]).pass).toBe(true);
  });

  it('an unlabelled answer fails the label, an answer through a dataset fails the route, and an object query elsewhere is no answer to it', () => {
    expect(failed(grade('dq_payment_count', 'We have received 72 payments.', [countPayments]))).toEqual(['fallback-labelled:label']);
    expect(failed(grade('dq_payment_count', '72 payments, not from a dataset.', [countPayments, queryDataset(provenance('billing', ['billed_amount']))]))).toEqual(['fallback-labelled:object-query']);
    const elsewhere = grade('dq_payment_count', '95 invoices; not a governed metric.', [{ ...countPayments, input: { objectName: 'demoorder_invoice' } }]);
    expect(elsewhere.checks[0]).toMatchObject({ pass: false, detail: 'no object query on demoorder_payment answered (object queries on demoorder_invoice)' });
  });

  it('the label words: a negation near `governed` / `dataset`, or 非指标口径 and its close spellings; a bare mention is no label', () => {
    for (const yes of ['This is not from a governed metric.', 'No dataset covers payments, so I counted the records.', 'Computed from records (ungoverned).', '非指标口径', '没有对应的指标,按对象统计']) expect([yes, labelsFallback(yes)]).toEqual([yes, true]);
    for (const no of ['Source: payment', 'Governed metric: payments', '来源:payment 对象']) expect([no, labelsFallback(no)]).toEqual([no, false]);
  });
});

describe('the notes say what the turn did on the way, never graded', () => {
  it('a loaded skill is named', () => {
    const g = grade('dq_bookings', 'Bookings: 412,300', [{ name: 'Skill', input: { skill: 'ask-data' }, output: 'loaded' }, queryDataset(provenance('order_book', ['booked_amount']))]);
    expect(g.notes).toEqual(['loaded skill ask-data', 'called no list_datasets']);
  });

  it('the card’s datasets are what a question is graded against: an id the card does not declare is refused loudly', () => {
    expect(() => grade('nope', '')).toThrow(/no dataset question `nope`/);
    const q: DatasetQuestion | undefined = scenario.card.run.datasetQuestions?.find((x) => x.expect.kind === 'fallback_labelled');
    expect(q?.expect).toEqual({ kind: 'fallback_labelled', object: 'demoorder_payment' });
  });
});
