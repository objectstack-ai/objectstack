// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The dataset-bearing cards (ADR-0149): `expect.datasets` and
 * `run.datasetQuestions` on order_to_cash and travel_expense. Each
 * card loads, each declaration is one the platform's own `DatasetSchema`
 * accepts, each question's words make its declared route the right one, the
 * build prompt states every name and word the Build half checks, and the
 * scorer checks them on a built artifact. Every refusal case starts from a
 * card that loads clean and changes one thing.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { loadScenarioFile, readCapabilityAreas, type LoadedScenario } from '../src/index.js';
import { namespacedScenario } from '../src/runner/namespace.js';
import { buildPrompt, datasetQuestionPrompt, promptLanguageGaps } from '../src/runner/prompts.js';
import { scoreGraph } from '../src/score/index.js';
import { artifactToEvalGraph } from '../src/score/scenario-graph.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CARDS = resolve(HERE, '../../../../docs/qa/scenarios');
const AREAS = readCapabilityAreas(resolve(HERE, '../../../../docs/qa/platform-checklist/areas'));
const DATASET_CARDS = ['order_to_cash', 'travel_expense'] as const;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a card is mutated as raw JSON on purpose
type RawCard = any;

const raw = (id: string): RawCard => JSON.parse(readFileSync(join(CARDS, `${id}.json`), 'utf8'));

function load(id: string, mutate: (c: RawCard) => void = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'scenario-datasets-'));
  dirs.push(dir);
  const card = raw(id);
  mutate(card);
  const file = join(dir, `${id}.json`);
  writeFileSync(file, JSON.stringify(card, null, 2));
  return loadScenarioFile(file, { areas: AREAS, library: 'open' });
}

const dq = (c: RawCard, id: string) => c.run.datasetQuestions.find((x: { id: string }) => x.id === id);
const measure = (c: RawCard, ds: string, m: string) => c.expect.datasets.find((d: { name: string }) => d.name === ds).measures.find((x: { name: string }) => x.name === m);

describe('the dataset cards load, each with every route kind', () => {
  it.each(DATASET_CARDS)('%s: datasets with synonyms and descriptions, an exact hit, an ambiguous pair, a near miss and an uncovered question', (id) => {
    const { card, refusals } = load(id);
    expect(refusals).toEqual([]);
    const c = card!.card;
    expect(c.expect.datasets!.length).toBeGreaterThanOrEqual(2);
    expect(c.expect.datasets!.every((d) => d.measures.every((m) => (m.synonyms?.length ?? 0) > 0 && m.description))).toBe(true);
    const kinds = c.run.datasetQuestions!.map((q) => (q.expect.kind === 'asked_back' ? `asked_back:${q.expect.reason}` : q.expect.kind));
    expect(new Set(kinds)).toEqual(new Set(['metric_selected', 'asked_back:ambiguous', 'asked_back:near_miss', 'fallback_labelled']));
  });

  it('the ambiguous pair is across two datasets: inside one, the platform refuses a word on two members', () => {
    const { card } = load('order_to_cash');
    const pair = card!.card.run.datasetQuestions!.find((q) => q.id === 'dq_revenue')!.expect;
    expect(pair.kind === 'asked_back' && new Set(pair.candidates.map((x) => x.dataset)).size).toBe(2);
  });
});

/** [case, card, mutation, the refusal's path, its message]. */
const REFUSALS: Array<[string, (typeof DATASET_CARDS)[number], (c: RawCard) => void, string, RegExp]> = [
  ['a synonym on two members of one dataset — the platform’s own rule (ADR-0149 D1)', 'order_to_cash', (c) => measure(c, 'billing', 'open_balance').synonyms.push('billings'), 'expect.datasets[1].measures[1].synonyms[3]', /the platform refuses this dataset: synonym "billings" of measure "open_balance" is also a synonym of measure "billed_amount"/],
  ['a dataset on an object the card does not expect', 'order_to_cash', (c) => (c.expect.datasets[0].object = 'quote'), 'expect.datasets[0].object', /`quote` is not in expect\.objects/],
  ['a sum over a field no seed row carries', 'order_to_cash', (c) => (measure(c, 'order_book', 'booked_amount').field = 'net_amount'), 'expect.datasets[0].measures[0].field', /no seed row of `sales_order` carries `net_amount`/],
  ['a sum over text', 'order_to_cash', (c) => (measure(c, 'order_book', 'booked_amount').field = 'status'), 'expect.datasets[0].measures[0].field', /holds a value that is no number/],
  ['a count that names a field', 'travel_expense', (c) => (measure(c, 'reimbursement', 'claim_count').field = 'total_amount'), 'expect.datasets[1].measures[1].field', /a `count` measure counts rows and names no field/],
  ['an exact-hit word that matches two measures', 'order_to_cash', (c) => (dq(c, 'dq_bookings').words = ['revenue']), 'run.datasetQuestions[0].words[0]', /must match exactly the one measure `order_book\.booked_amount`.*matches `order_book\.booked_amount`, `billing\.billed_amount`/],
  ['an ambiguous word that matches one measure', 'order_to_cash', (c) => (dq(c, 'dq_revenue').words = ['bookings']), 'run.datasetQuestions[2].words[0]', /must match exactly the candidates/],
  ['a near-miss word that is a hit', 'order_to_cash', (c) => Object.assign(dq(c, 'dq_booking_total'), { words: ['bookings'], ask: { en: 'What are our bookings?' } }), 'run.datasetQuestions[3].words[0]', /a near-miss word matches no member, and `bookings` matches `order_book\.booked_amount`/],
  ['a near-miss word near nothing it names', 'order_to_cash', (c) => Object.assign(dq(c, 'dq_booking_total'), { words: ['turnover'], ask: { en: 'What is our turnover?' } }), 'run.datasetQuestions[3].words[0]', /`turnover` is not near `order_book\.booked_amount`/],
  ['a fallback on an object a dataset covers', 'order_to_cash', (c) => (dq(c, 'dq_payment_count').expect.object = 'invoice'), 'run.datasetQuestions[4].expect.object', /a dataset's base object/],
  ['a word the ask does not write', 'order_to_cash', (c) => dq(c, 'dq_bookings').words.push('backlog'), 'run.datasetQuestions[0].words[2]', /no language of the ask writes `backlog`/],
  ['an ask language that writes none of the words', 'order_to_cash', (c) => (dq(c, 'dq_bookings').ask.zh = '一共多少?'), 'run.datasetQuestions[0].ask.zh', /writes none of the question's words/],
  ['a dataset question id that is already a question id: the two would share a replay key', 'order_to_cash', (c) => (dq(c, 'dq_bookings').id = 'open_receivables'), 'run.datasetQuestions[0].id', /already a question or operation id/],
  ['dataset questions on a card that declares no dataset', 'order_to_cash', (c) => delete c.expect.datasets, 'run.datasetQuestions', /declare them in `expect\.datasets`/],
  ['a route kind outside the closed set', 'order_to_cash', (c) => (dq(c, 'dq_bookings').expect.kind = 'guessed'), 'run.datasetQuestions[0].expect.kind', /discriminator|Invalid input/],
];

describe('the loader refuses a dataset declaration or a dataset question that is wrong, at the field', () => {
  it.each(REFUSALS)('%s', (_name, id, mutate, path, message) => {
    const { card, refusals } = load(id, mutate);
    expect(card).toBeUndefined();
    const hit = refusals.filter((r) => r.path === path);
    expect(hit.map((r) => r.message).join(' | ')).toMatch(message);
  });
});

describe('the build prompt states every dataset name and word the Build half checks', () => {
  const scenario = (id: string): LoadedScenario => namespacedScenario(load(id).card!);

  it('each dataset on its namespaced object, each member with its synonyms and description, word for word', () => {
    const prompt = buildPrompt(scenario('order_to_cash').card);
    expect(prompt).toContain('  - `order_book` on `demoorder_sales_order`, label "Order book", description "Sales orders and the amounts booked on them, by status.":');
    expect(prompt).toContain('    - measure `booked_amount` (sum of `total_amount`), label "Booked amount", synonyms "bookings", "revenue", "营收", "订单金额", "成交额", description "The sum of the sales orders\' total amounts, every status counted, cancelled ones included."');
    expect(prompt).toContain('    - measure `order_count` (count of rows), label "Order count"');
    expect(prompt).toContain('    - dimension `aging` (field `aging_bucket`), label "Aging bucket", synonyms "aging"');
    // A card without datasets gets no dataset line.
    expect(buildPrompt(namespacedScenario(loadScenarioFile(join(CARDS, 'service_desk.json'), { areas: AREAS, library: 'open' }).card!).card)).not.toContain('Datasets (analytics datasets');
  });

  it('a dataset question’s turn carries the ask and the card’s today, and no answer format that would steer its route', () => {
    const card = scenario('order_to_cash').card;
    expect(datasetQuestionPrompt(card, 'dq_revenue')).toBe('What is our total revenue? Today is 2026-10-31.\n\nAnswer from the app’s data using the `app` tools.');
    expect(datasetQuestionPrompt(card, 'dq_revenue', { lang: 'zh' })).toBe('我们的总营收是多少? Today is 2026-10-31.\n\nAnswer from the app’s data using the `app` tools.');
    expect(datasetQuestionPrompt(card, 'dq_revenue')).not.toContain('Source:');
  });

  it('`--lang` holds a dataset question to its language like every other text a run renders', () => {
    const c = load('order_to_cash', (x) => Object.assign(dq(x, 'dq_revenue'), { ask: { en: 'What is our total revenue?' }, words: ['revenue'] })).card!.card;
    expect(promptLanguageGaps(c, { lang: 'zh' }, ['ask'])).toEqual(['run.datasetQuestions[dq_revenue].ask']);
  });
});

describe('the Build half checks each declared dataset on a built artifact', () => {
  const expect_ = namespacedScenario(load('travel_expense').card!).card.expect;
  const member = (name: string, synonyms: string[], description = 'd') => ({ name, label: name, synonyms, description });
  const built = (mutate: (a: RawCard) => void = () => {}) => {
    const a: RawCard = {
      objects: expect_.objects.map((name) => ({ name, fields: {} })),
      datasets: [
        { name: 'trip_plan', object: 'demotravel_trip_request', measures: [member('estimated_spend', ['estimated cost', 'trip cost', 'travel spend', '差旅花费', '预计费用']), member('trip_days', ['Days On The Road', '出差天数'])], dimensions: [member('trip_status', ['request_status'])] },
        { name: 'reimbursement', object: 'demotravel_expense_claim', measures: [member('claimed_amount', ['expense claims', 'travel spend', '差旅花费', '报销金额']), member('claim_count', ['number of claims', '报销单数'])], dimensions: [member('claim_status', [])] },
        { name: 'claim_lines', object: 'demotravel_claim_line', measures: [member('line_amount', ['line total', '明细金额'])], dimensions: [member('expense_type', ['费用类型'])] },
      ],
    };
    mutate(a);
    return scoreGraph(artifactToEvalGraph(a), expect_).checks.filter((c) => c.check.startsWith('dataset'));
  };

  it('a faithful build passes every dataset check: one per dataset, one per member (synonyms compared as the tools compare a term)', () => {
    const checks = built();
    expect(checks.map((c) => c.check)).toEqual([
      'dataset:trip_plan',
      'dataset-measure:trip_plan.estimated_spend',
      'dataset-measure:trip_plan.trip_days',
      'dataset-dimension:trip_plan.trip_status',
      'dataset:reimbursement',
      'dataset-measure:reimbursement.claimed_amount',
      'dataset-measure:reimbursement.claim_count',
      'dataset-dimension:reimbursement.claim_status',
      'dataset:claim_lines',
      'dataset-measure:claim_lines.line_amount',
      'dataset-dimension:claim_lines.expense_type',
    ]);
    expect(checks.every((c) => c.pass)).toBe(true);
  });

  it('a missing synonym, a missing description, a missing member, another base object and a missing dataset each fail their own check', () => {
    const fails = (mutate: (a: RawCard) => void) => built(mutate).filter((c) => !c.pass).map((c) => [c.check, c.detail]);
    expect(fails((a) => a.datasets[1].measures[0].synonyms.pop())).toEqual([['dataset-measure:reimbursement.claimed_amount', 'no synonym "报销金额"']]);
    expect(fails((a) => delete a.datasets[0].measures[0].description)).toEqual([['dataset-measure:trip_plan.estimated_spend', 'no description']]);
    expect(fails((a) => a.datasets[0].dimensions.pop())).toEqual([['dataset-dimension:trip_plan.trip_status', 'missing']]);
    expect(fails((a) => (a.datasets[0].object = 'demotravel_employee'))).toEqual([['dataset:trip_plan', 'on demotravel_employee, not demotravel_trip_request']]);
    expect(fails((a) => a.datasets.pop()).map(([c]) => c)).toEqual(['dataset:claim_lines', 'dataset-measure:claim_lines.line_amount', 'dataset-dimension:claim_lines.expense_type']);
  });
});
