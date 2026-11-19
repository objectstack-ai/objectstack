// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0149 D3 rule 1] The term matcher behind `list_datasets.matches`:
 * equality after the dataset schema's own normalization, over a member's
 * name, every locale of its label and each synonym — and nothing looser.
 */

import { describe, it, expect } from 'vitest';
import { LIST_DATASETS_MAX_CANDIDATES_PER_TERM } from '@objectstack/spec/ai';
import { normalizeDatasetTerm } from '@objectstack/spec/ui';
import { findDatasetTermCandidates, matchDatasetTerms } from '../dataset-term-matcher.js';

const members = {
  dimensions: [
    { name: 'close_date', label: 'Close date', synonyms: ['成交日期'] },
    { name: 'stage', label: { en: 'Stage', 'zh-CN': '阶段' } },
  ],
  measures: [
    { name: 'total_amount', label: 'Amount', synonyms: ['营收', 'Revenue', 'sales'] },
    { name: 'opp_count', synonyms: ['商机数'] },
  ],
};

describe('matchDatasetTerms', () => {
  it('matches a name, a label in any locale and a synonym, after normalization', () => {
    expect(
      matchDatasetTerms(['Total-Amount', '  阶段 ', 'REVENUE', 'close   date', 'ｓａｌｅｓ'], members),
    ).toEqual([
      { term: 'Total-Amount', member: 'measures.total_amount', matchedOn: 'name' },
      { term: '  阶段 ', member: 'dimensions.stage', matchedOn: 'label' },
      { term: 'REVENUE', member: 'measures.total_amount', matchedOn: 'synonym' },
      // `close_date` folds to "close date", so the name answers before the label.
      { term: 'close   date', member: 'dimensions.close_date', matchedOn: 'name' },
      // NFKC folds the full-width spelling.
      { term: 'ｓａｌｅｓ', member: 'measures.total_amount', matchedOn: 'synonym' },
    ]);
  });

  it('uses the schema\'s own normalization, so the validation and the matcher agree on every word', () => {
    for (const word of ['Total_Amount', 'total-amount', ' TOTAL  AMOUNT ']) {
      expect(normalizeDatasetTerm(word)).toBe(normalizeDatasetTerm('total_amount'));
      expect(matchDatasetTerms([word], members)).toHaveLength(1);
    }
  });

  it('does not hit on a substring, a stem or a near neighbour', () => {
    expect(matchDatasetTerms(['营', 'amounts', 'sale', 'total', 'opp'], members)).toEqual([]);
  });

  it('reports every member a term equals, so the caller can ask instead of picking', () => {
    const twice = {
      dimensions: [],
      measures: [
        { name: 'won_amount', label: 'Won', synonyms: ['营收'] },
        { name: 'booked_amount', label: 'Booked', synonyms: ['营收'] },
      ],
    };
    expect(matchDatasetTerms(['营收'], twice).map((m) => m.member)).toEqual([
      'measures.won_amount',
      'measures.booked_amount',
    ]);
  });

  it('matches nothing for a term that normalizes to nothing, or with no members', () => {
    expect(matchDatasetTerms(['', '   ', '__'], members)).toEqual([]);
    expect(matchDatasetTerms(['营收'], { dimensions: [], measures: [] })).toEqual([]);
  });
});

/**
 * [#34763, ADR-0149 D3 amendment note] `list_datasets.candidates`: the
 * members offered for a term with no hit anywhere. Near is containment either
 * way after the same normalization, both sides at least two code points; the
 * order is the listing order and the cap is the spec's.
 */
describe('findDatasetTermCandidates', () => {
  const contracts = {
    name: 'contracts',
    dimensions: [{ name: 'contract_type', label: '合同类型' }],
    measures: [{ name: 'contract_amount', label: { en: 'Contract amount', 'zh-CN': '合同金额' } }],
  };
  const payments = {
    name: 'payments',
    dimensions: [],
    measures: [{ name: 'paid', label: '金额', synonyms: ['回款'] }],
  };

  it('offers a member a target of which contains the term, and one the term contains', () => {
    expect(findDatasetTermCandidates(['金额'], [contracts])).toEqual([
      { term: '金额', dataset: 'contracts', member: 'measures.contract_amount' },
    ]);
    expect(findDatasetTermCandidates(['合同金额'], [payments])).toEqual([
      { term: '合同金额', dataset: 'payments', member: 'measures.paid' },
    ]);
    // A name, a label in any locale and a synonym are all targets, after normalization.
    expect(findDatasetTermCandidates(['CONTRACT-AMOUNTS', '回款额'], [contracts, payments])).toEqual([
      { term: 'CONTRACT-AMOUNTS', dataset: 'contracts', member: 'measures.contract_amount' },
      { term: '回款额', dataset: 'payments', member: 'measures.paid' },
    ]);
  });

  it('holds both sides to two code points', () => {
    const tiny = { name: 'tiny', dimensions: [], measures: [{ name: 'xx', label: '额', synonyms: ['金'] }] };
    // A one-code-point term is in too many words to offer any of them.
    expect(findDatasetTermCandidates(['额', '金'], [contracts, tiny])).toEqual([]);
    // A one-code-point target is never offered, though the term contains it.
    expect(findDatasetTermCandidates(['金额'], [tiny])).toEqual([]);
    // Two code points on each side are enough.
    expect(findDatasetTermCandidates(['xx总'], [tiny])).toEqual([
      { term: 'xx总', dataset: 'tiny', member: 'measures.xx' },
    ]);
  });

  it('offers nothing for a term with a hit in ANY dataset, and still offers for the other terms', () => {
    // `金额` equals `payments.paid`'s label: a hit, so `contracts` offers nothing for it.
    expect(findDatasetTermCandidates(['金额', '合同'], [contracts, payments])).toEqual([
      { term: '合同', dataset: 'contracts', member: 'measures.contract_amount' },
      { term: '合同', dataset: 'contracts', member: 'dimensions.contract_type' },
    ]);
    expect(matchDatasetTerms(['金额'], payments)).toHaveLength(1);
  });

  it('lists terms as sent, datasets as given, a dataset\'s measures before its dimensions', () => {
    const first = {
      name: 'first',
      // Declared first, listed after the measure.
      dimensions: [{ name: 'region_amount_band', label: 'Amount band' }],
      measures: [{ name: 'won_amount', label: 'Won amount' }],
    };
    const second = { name: 'second', dimensions: [], measures: [{ name: 'lost_amount', label: 'Lost amount' }] };
    expect(findDatasetTermCandidates(['lost', 'amount'], [first, second])).toEqual([
      { term: 'lost', dataset: 'second', member: 'measures.lost_amount' },
      { term: 'amount', dataset: 'first', member: 'measures.won_amount' },
      { term: 'amount', dataset: 'first', member: 'dimensions.region_amount_band' },
      { term: 'amount', dataset: 'second', member: 'measures.lost_amount' },
    ]);
  });

  it(`offers at most ${LIST_DATASETS_MAX_CANDIDATES_PER_TERM} per term, the first in listing order, with no cut marker`, () => {
    const many = (name: string, n: number) => ({
      name,
      dimensions: [{ name: `${name}_amount_band`, label: 'Amount band' }],
      measures: Array.from({ length: n }, (_, i) => ({ name: `${name}_amount_${i}`, label: `M${i}` })),
    });
    const out = findDatasetTermCandidates(['amount', 'band'], [many('a', 4), many('b', 4)]);
    expect(LIST_DATASETS_MAX_CANDIDATES_PER_TERM).toBe(5);
    expect(out.filter((c) => c.term === 'amount')).toEqual([
      { term: 'amount', dataset: 'a', member: 'measures.a_amount_0' },
      { term: 'amount', dataset: 'a', member: 'measures.a_amount_1' },
      { term: 'amount', dataset: 'a', member: 'measures.a_amount_2' },
      { term: 'amount', dataset: 'a', member: 'measures.a_amount_3' },
      { term: 'amount', dataset: 'a', member: 'dimensions.a_amount_band' },
    ]);
    // The cap is per term: the next term starts its own count.
    expect(out.filter((c) => c.term === 'band').map((c) => c.member)).toEqual([
      'dimensions.a_amount_band',
      'dimensions.b_amount_band',
    ]);
    // Every entry is the bare pointer: nothing says more were left out.
    for (const c of out) expect(Object.keys(c).sort()).toEqual(['dataset', 'member', 'term']);
  });

  it('offers a term sent twice once, and nothing for a term that normalizes to nothing or with no datasets', () => {
    expect(findDatasetTermCandidates(['合同', '合同'], [payments, contracts])).toHaveLength(2);
    expect(findDatasetTermCandidates(['', '  ', '__'], [contracts])).toEqual([]);
    expect(findDatasetTermCandidates(['合同'], [])).toEqual([]);
  });
});
