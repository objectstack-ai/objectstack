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

import { ASK_KINDS, askKindCounts, askTurns, loadScenarioFile, readCapabilityAreas, type AskKind, type LoadedScenario } from '../src/index.js';
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

// ── Ask kinds: every question of a dataset card names the kind it asks, as many times as the README table states ──

const question = (c: RawCard, id: string) => c.run.questions.find((x: { id: string }) => x.id === id);
/** Strip the kind from every question and dataset question of the card but `keep`: the card then names exactly one kind. */
const onlyKind = (c: RawCard, keep: { askKind?: string }) => {
  for (const q of [...c.run.questions, ...c.run.datasetQuestions]) if (q !== keep) delete q.askKind;
};
/** Strip every kind from the card: a card written before ask kinds existed. */
const noKinds = (c: RawCard) => {
  for (const q of [...c.run.questions, ...(c.run.datasetQuestions ?? [])]) delete q.askKind;
};

describe('the dataset cards name the kind of every question they ask, and ask every kind at least twice', () => {
  const counts = (id: (typeof DATASET_CARDS)[number]) => {
    const { card } = load(id);
    return askKindCounts(card!.card, card!.personaTruths);
  };

  it.each(DATASET_CARDS)('%s: every question and dataset question names its kind', (id) => {
    const c = load(id).card!.card;
    expect([...c.run.questions, ...c.run.datasetQuestions!].filter((q) => q.askKind === undefined).map((q) => q.id)).toEqual([]);
  });

  it('across the two cards no kind is asked fewer than twice', () => {
    const a = counts('order_to_cash');
    const b = counts('travel_expense');
    const short = ASK_KINDS.filter((k) => a[k] + b[k] < 2);
    expect(short).toEqual([]);
  });

  it('a turn whose persona truth is withheld is a `forbidden` ask; the same question asked as a persona who may see it is the kind it names', () => {
    const { card } = load('travel_expense');
    const turns = askTurns(card!.card, card!.personaTruths).filter((t) => t.question === 'department_budgets');
    expect(turns).toEqual([
      { question: 'department_budgets', persona: 'employee', askKind: 'forbidden' },
      { question: 'department_budgets', persona: 'dept_manager', askKind: 'group_sum' },
    ]);
  });

  /**
   * The figures the card README's "What the open dataset cards ask, per kind" table states
   * (docs/qa/scenarios/README.md). A card edit that moves one fails here: change both together.
   */
  const STATED: Record<AskKind, [number, number]> = {
    count: [3, 3],
    group_sum: [2, 3],
    top_n: [1, 1],
    time_range: [1, 1],
    join: [2, 2],
    owner_latest: [2, 1],
    business_term: [2, 2],
    ambiguous: [2, 2],
    forbidden: [1, 2],
    unanswerable: [1, 1],
  };

  it('each card asks each kind as many times as the README table states', () => {
    const a = counts('order_to_cash');
    const b = counts('travel_expense');
    expect(Object.fromEntries(ASK_KINDS.map((k) => [k, [a[k], b[k]]]))).toEqual(STATED);
  });
});

/** [case, card, mutation, the refusal's path, its message]. */
const KIND_REFUSALS: Array<[string, (typeof DATASET_CARDS)[number], (c: RawCard) => void, string, RegExp]> = [
  ['a question with no kind on a card that names one kind, on a dataset question', 'order_to_cash', (c) => onlyKind(c, dq(c, 'dq_bookings')), 'run.questions[0].askKind', /a card that names one ask kind names the kind of every question it asks/],
  ['a dataset question with no kind on a card that names one kind, on a question', 'order_to_cash', (c) => onlyKind(c, question(c, 'open_receivables')), 'run.datasetQuestions[0].askKind', /a card that names one ask kind names the kind of every question it asks/],
  ['a kind outside the closed set', 'order_to_cash', (c) => (question(c, 'open_receivables').askKind = 'trend'), 'run.questions[0].askKind', /Invalid option|expected one of/],
  ['`top_n` on a truth that does not rank', 'order_to_cash', (c) => (question(c, 'open_receivables').askKind = 'top_n'), 'run.questions[0].askKind', /its truth is a `topN`/],
  ['`count` on a grouped truth', 'order_to_cash', (c) => (question(c, 'receivables_aging').askKind = 'count'), 'run.questions[1].askKind', /with no `groupBy`/],
  ['`group_sum` on a ranking', 'order_to_cash', (c) => (question(c, 'top_accounts_billed').askKind = 'group_sum'), 'run.questions[3].askKind', /with a `groupBy`/],
  ['`time_range` with no window', 'order_to_cash', (c) => (question(c, 'receivables_aging').askKind = 'time_range'), 'run.questions[1].askKind', /filters with `in_window`/],
  ['`join` with no relation path', 'order_to_cash', (c) => (question(c, 'receivables_aging').askKind = 'join'), 'run.questions[1].askKind', /relation path/],
  ['`owner_latest` that groups by nobody', 'order_to_cash', (c) => (question(c, 'open_receivables').askKind = 'owner_latest'), 'run.questions[0].askKind', /groups by a person field/],
  ['`owner_latest` that groups by a field that names no person (a status)', 'order_to_cash', (c) => (question(c, 'orders_by_status').askKind = 'owner_latest'), 'run.questions[2].askKind', /groups by a person field/],
  ['`owner_latest` across a lookup that ends on no person (a product category)', 'order_to_cash', (c) => (question(c, 'booked_by_category').askKind = 'owner_latest'), 'run.questions[5].askKind', /groups by a person field/],
  ['`unanswerable` on a question the seed answers', 'order_to_cash', (c) => (question(c, 'open_receivables').askKind = 'unanswerable'), 'run.questions[0].askKind', /only a question whose truth is `unanswerable`/],
  ['an unanswerable truth named another kind', 'order_to_cash', (c) => (question(c, 'september_commission').askKind = 'count'), 'run.questions[9].askKind', /its kind is `unanswerable`/],
  ['`business_term` on a question with a truth', 'order_to_cash', (c) => (question(c, 'open_receivables').askKind = 'business_term'), 'run.questions[0].askKind', /ask it as a dataset question/],
  ['`forbidden` declared on a question one of its personas may see', 'travel_expense', (c) => (question(c, 'department_budgets').askKind = 'forbidden'), 'run.questions[8].askKind', /asked only as personas it is withheld from/],
  ['a `metric_selected` dataset question named `ambiguous`', 'order_to_cash', (c) => (dq(c, 'dq_bookings').askKind = 'ambiguous'), 'run.datasetQuestions[0].askKind', /its kind is `business_term`/],
  ['an `asked_back` dataset question named `business_term`', 'order_to_cash', (c) => (dq(c, 'dq_revenue').askKind = 'business_term'), 'run.datasetQuestions[2].askKind', /its kind is `ambiguous`/],
  ['a `fallback_labelled` dataset question named `forbidden`', 'order_to_cash', (c) => (dq(c, 'dq_payment_count').askKind = 'forbidden'), 'run.datasetQuestions[4].askKind', /never `forbidden`/],
];

describe('the loader refuses an ask kind that does not fit its question, at `askKind`', () => {
  it.each(KIND_REFUSALS)('%s', (_name, id, mutate, path, message) => {
    const { card, refusals } = load(id, mutate);
    expect(card).toBeUndefined();
    const hit = refusals.filter((r) => r.path === path);
    expect(hit.map((r) => r.message).join(' | ')).toMatch(message);
  });

  it('`owner_latest` across a lookup that ends on a person loads: the overdue balance grouped by the account owner', () => {
    const { refusals } = load('order_to_cash', (c) => (question(c, 'overdue_by_owner').askKind = 'owner_latest'));
    expect(refusals).toEqual([]);
  });

  it('`forbidden` declared on a question asked only as a persona it is withheld from loads', () => {
    const { refusals } = load('travel_expense', (c) => Object.assign(question(c, 'department_budgets'), { askKind: 'forbidden', personas: ['employee'] }));
    expect(refusals).toEqual([]);
  });

  it('a card that asks no dataset question may leave its questions unnamed', () => {
    const { refusals } = load('order_to_cash', (c) => {
      delete c.run.datasetQuestions;
      noKinds(c);
    });
    expect(refusals).toEqual([]);
  });

  it('a card that asks dataset questions and names no kind loads, as a card written before ask kinds did', () => {
    const { card, refusals } = load('order_to_cash', noKinds);
    expect(refusals).toEqual([]);
    expect(card!.card.run.datasetQuestions!.length).toBeGreaterThan(0);
    expect([...card!.card.run.questions, ...card!.card.run.datasetQuestions!].filter((q) => q.askKind !== undefined)).toEqual([]);
  });
});
