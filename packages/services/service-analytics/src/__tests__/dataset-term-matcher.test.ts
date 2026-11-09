// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0149 D3 rule 1] The term matcher behind `list_datasets.matches`:
 * equality after the dataset schema's own normalization, over a member's
 * name, every locale of its label and each synonym — and nothing looser.
 */

import { describe, it, expect } from 'vitest';
import { normalizeDatasetTerm } from '@objectstack/spec/ui';
import { matchDatasetTerms } from '../dataset-term-matcher.js';

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
