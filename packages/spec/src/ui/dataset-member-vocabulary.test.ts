// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0149 D1] A dataset member's business vocabulary: `synonyms` and
 * `description` on both member shapes, the aliases that point at them, the
 * per-key bounds, and the dataset-level rule that within one dataset a word
 * answers to one member.
 *
 * The rule is judged under `normalizeDatasetTerm`, the ONE normalization the
 * dataset tools' term matcher calls too, so its cases are pinned here first.
 */

import { describe, expect, it } from 'vitest';
import {
  DatasetDimensionSchema,
  DatasetMeasureSchema,
  DatasetSchema,
  normalizeDatasetTerm,
} from './dataset.zod';

const base = {
  name: 'sales_analysis',
  label: 'Sales analysis',
  object: 'opportunity',
};

const amount = { name: 'total_amount', aggregate: 'sum' as const, field: 'amount' };
const stage = { name: 'stage', field: 'stage' };

const issuesOf = (input: unknown) => {
  const parsed = DatasetSchema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues;
};

describe('normalizeDatasetTerm', () => {
  it('folds case, width, `_`, `-` and whitespace runs, and trims', () => {
    expect(normalizeDatasetTerm('total_amount')).toBe('total amount');
    expect(normalizeDatasetTerm('  Total   Amount ')).toBe('total amount');
    expect(normalizeDatasetTerm('ＴＯＴＡＬ－ＡＭＯＵＮＴ')).toBe('total amount');
    expect(normalizeDatasetTerm('Win-Rate')).toBe('win rate');
    expect(normalizeDatasetTerm('营收')).toBe('营收');
  });

  it('decides equality only: a substring or a neighbour is a different term', () => {
    expect(normalizeDatasetTerm('amount')).not.toBe(normalizeDatasetTerm('total_amount'));
    expect(normalizeDatasetTerm('revenues')).not.toBe(normalizeDatasetTerm('revenue'));
  });
});

describe('member vocabulary keys', () => {
  it('a dimension and a measure take `synonyms` and a string or locale-map `description`', () => {
    const measure = DatasetMeasureSchema.safeParse({
      ...amount,
      synonyms: ['收入', '销售额', 'revenue'],
      description: { en: 'Won amount, by close month', 'zh-CN': '已赢单金额合计，按成交日期归月' },
    });
    expect(measure.success).toBe(true);
    expect(measure.data?.synonyms).toEqual(['收入', '销售额', 'revenue']);

    const dimension = DatasetDimensionSchema.safeParse({
      ...stage,
      synonyms: ['阶段', 'pipeline stage'],
      description: 'Sales stage of the opportunity',
    });
    expect(dimension.success).toBe(true);
    expect(dimension.data?.description).toBe('Sales stage of the opportunity');
  });

  it('an absent key materializes nothing', () => {
    const parsed = DatasetMeasureSchema.safeParse(amount);
    expect(parsed.success).toBe(true);
    expect(Object.keys(parsed.data ?? {})).not.toContain('synonyms');
    expect(Object.keys(parsed.data ?? {})).not.toContain('description');
  });

  it.each([
    ['synonym', 'synonyms'],
    ['aliases', 'synonyms'],
    ['keywords', 'synonyms'],
    ['aiDescription', 'description'],
    ['tooltip', 'description'],
  ])('points `%s` at `%s` on both member shapes', (written, canonical) => {
    for (const [schema, member] of [[DatasetMeasureSchema, amount], [DatasetDimensionSchema, stage]] as const) {
      const parsed = schema.safeParse({ ...member, [written]: ['x'] });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toContain(`\`${written}\` → \`${canonical}\``);
    }
  });

  it('refuses an untrimmed, empty or over-long synonym, at its position', () => {
    for (const bad of [' revenue', 'revenue ', '', 'line\nbreak', 'x'.repeat(61)]) {
      const parsed = DatasetMeasureSchema.safeParse({ ...amount, synonyms: ['ok', bad] });
      expect(parsed.success, JSON.stringify(bad)).toBe(false);
      expect(parsed.error?.issues[0]?.path).toEqual(['synonyms', 1]);
    }
    expect(DatasetMeasureSchema.safeParse({ ...amount, synonyms: ['x'.repeat(60)] }).success).toBe(true);
  });

  it('takes at most 20 synonyms per member', () => {
    const words = Array.from({ length: 21 }, (_, i) => `word ${i}`);
    expect(DatasetMeasureSchema.safeParse({ ...amount, synonyms: words.slice(0, 20) }).success).toBe(true);
    const parsed = DatasetMeasureSchema.safeParse({ ...amount, synonyms: words });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toContain('at most 20 synonyms');
  });

  it('bounds a member description to 500 characters per locale, judged at the dataset', () => {
    const ok = issuesOf({ ...base, dimensions: [stage], measures: [{ ...amount, description: 'x'.repeat(500) }] });
    expect(ok).toEqual([]);

    const plain = issuesOf({ ...base, dimensions: [stage], measures: [{ ...amount, description: 'x'.repeat(501) }] });
    expect(plain).toHaveLength(1);
    expect(plain[0]?.path).toEqual(['measures', 0, 'description']);
    expect(plain[0]?.message).toContain('501 characters');

    const map = issuesOf({
      ...base,
      dimensions: [{ ...stage, description: { en: 'Stage', 'zh-CN': '阶'.repeat(501) } }],
      measures: [amount],
    });
    expect(map).toHaveLength(1);
    expect(map[0]?.path).toEqual(['dimensions', 0, 'description', 'zh-CN']);
  });
});

describe('within one dataset, a word answers to one member', () => {
  it('accepts a synonym equal to its own member\'s name or label, as written', () => {
    const parsed = DatasetSchema.safeParse({
      ...base,
      dimensions: [stage],
      measures: [{ ...amount, label: 'Revenue', synonyms: ['Total Amount', 'revenue', '营收'] }],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.measures[0]?.synonyms).toEqual(['Total Amount', 'revenue', '营收']);
  });

  it('refuses a synonym repeated within one member after normalization', () => {
    const issues = issuesOf({
      ...base,
      dimensions: [stage],
      measures: [{ ...amount, synonyms: ['net revenue', 'Net_Revenue'] }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toEqual(['measures', 0, 'synonyms', 1]);
    expect(issues[0]?.message).toContain('repeats synonyms[0] "net revenue"');
  });

  it('refuses a synonym equal to another member\'s name, naming both members and the word', () => {
    const issues = issuesOf({
      ...base,
      dimensions: [stage],
      measures: [amount, { name: 'deal_count', aggregate: 'count', synonyms: ['Total-Amount'] }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toEqual(['measures', 1, 'synonyms', 0]);
    expect(issues[0]?.message).toContain('synonym "Total-Amount" of measure "deal_count"');
    expect(issues[0]?.message).toContain('is also the name ("total_amount") of measure "total_amount"');
  });

  it('refuses a synonym equal to any locale of another member\'s label', () => {
    const issues = issuesOf({
      ...base,
      dimensions: [{ ...stage, label: { en: 'Stage', 'zh-CN': '阶段' } }],
      measures: [{ ...amount, synonyms: ['阶段'] }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toEqual(['measures', 0, 'synonyms', 0]);
    expect(issues[0]?.message).toContain('is also the zh-CN label of dimension "stage"');
  });

  it('reports a synonym shared by two members once, on the later member', () => {
    const issues = issuesOf({
      ...base,
      dimensions: [{ ...stage, synonyms: ['revenue'] }],
      measures: [{ ...amount, synonyms: ['Revenue'] }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toEqual(['measures', 0, 'synonyms', 0]);
    expect(issues[0]?.message).toContain('is also a synonym ("revenue") of dimension "stage"');
  });

  it('dimensions and measures are one population, and two datasets are independent', () => {
    const dataset = (synonym: string) => ({
      ...base,
      dimensions: [stage],
      measures: [{ ...amount, synonyms: [synonym] }],
    });
    expect(issuesOf(dataset('stage'))).toHaveLength(1);
    expect(issuesOf(dataset('营收'))).toEqual([]);
    expect(issuesOf({ ...dataset('营收'), name: 'finance_close' })).toEqual([]);
  });
});
