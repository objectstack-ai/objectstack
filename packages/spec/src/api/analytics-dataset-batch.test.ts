// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  AnalyticsResultResponseSchema,
  DATASET_QUERY_BATCH_MAX_QUERIES,
  DatasetQueryBatchEntrySchema,
  DatasetQueryBatchRequestSchema,
  DatasetQueryBatchResponseSchema,
  DatasetSelectionSchema,
} from './analytics.zod';
import type { DatasetQueryBatchEntry, DatasetQueryBatchRequest } from './analytics.zod';

/**
 * The batch dataset-query contract: several `POST /analytics/dataset/query`
 * bodies in one request, one answer entry per body, in order, each answered or
 * refused on its own.
 */

const query = (measure: string) => ({ datasetName: 'opportunities', selection: { measures: [measure] } });

/** The issue codes of a refused parse, so a refusal is told apart from a crash. */
const issueCodes = (input: unknown): string[] => {
  const parsed = DatasetQueryBatchRequestSchema.safeParse(input);
  expect(parsed.success).toBe(false);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.code);
};

describe('DatasetQueryBatchRequestSchema', () => {
  it('accepts an ordered list of single-door bodies and keeps their order', () => {
    const body: DatasetQueryBatchRequest = {
      queries: [query('amount'), { dataset: { name: 'draft' }, selection: { measures: ['count'] }, previewDrafts: true }, query('won')],
    };
    const parsed = DatasetQueryBatchRequestSchema.parse(body);
    expect(parsed.queries).toEqual(body.queries);
  });

  it('accepts exactly the bound', () => {
    const queries = Array.from({ length: DATASET_QUERY_BATCH_MAX_QUERIES }, (_, i) => query(`m${i}`));
    expect(DatasetQueryBatchRequestSchema.safeParse({ queries }).success).toBe(true);
  });

  it('refuses an empty batch', () => {
    expect(issueCodes({ queries: [] })).toEqual(['too_small']);
  });

  it('refuses one query over the bound', () => {
    const queries = Array.from({ length: DATASET_QUERY_BATCH_MAX_QUERIES + 1 }, (_, i) => query(`m${i}`));
    expect(issueCodes({ queries })).toEqual(['too_big']);
  });

  it('refuses a query that is not a JSON object, and a batch without `queries`', () => {
    expect(issueCodes({ queries: [query('amount'), 'amount'] })).toEqual(['invalid_type']);
    expect(issueCodes({ queries: [query('amount'), null] })).toEqual(['invalid_type']);
    expect(issueCodes({})).toEqual(['invalid_type']);
  });

  it('refuses an undeclared key beside `queries`', () => {
    expect(issueCodes({ queries: [query('amount')], previewDrafts: true })).toEqual(['unrecognized_keys']);
  });

  it('leaves a query\'s members to the single door: a malformed selection does not refuse the batch', () => {
    // The single door refuses this selection (an undeclared key); the batch
    // carries it to that door untouched, so the refusal lands in its entry.
    const malformed = { datasetName: 'opportunities', selection: { measures: ['amount'], where: {} } };
    expect(DatasetSelectionSchema.safeParse(malformed.selection).success).toBe(false);
    expect(DatasetQueryBatchRequestSchema.safeParse({ queries: [query('amount'), malformed] }).success).toBe(true);
  });
});

describe('DatasetQueryBatchEntrySchema / DatasetQueryBatchResponseSchema', () => {
  const answered = { data: { rows: [{ stage: 'won', amount: 3 }], fields: [{ name: 'amount', type: 'number' }] } };
  const refused = { status: 403, error: { code: 'PERMISSION_DENIED' as const, message: 'You may not read opportunities.' } };

  it('parses an answer mixing a success and a refusal, in order', () => {
    const results: DatasetQueryBatchEntry[] = [answered, refused, answered];
    const parsed = DatasetQueryBatchResponseSchema.parse({ success: true, data: { results } });
    // `null` marks an answered entry, which carries no refusal.
    expect(parsed.data.results.map((entry) => ('error' in entry ? entry.error.code : null)))
      .toEqual([null, 'PERMISSION_DENIED', null]);
  });

  it('an answered entry carries the single door\'s answer, member for member', () => {
    const parsed = DatasetQueryBatchEntrySchema.parse(answered);
    expect(parsed).toEqual({ data: AnalyticsResultResponseSchema.shape.data.parse(answered.data) });
    // A member the single answer does not declare is refused beside `data`.
    expect(DatasetQueryBatchEntrySchema.safeParse({ ...answered, rows: [] }).success).toBe(false);
  });

  it('a refused entry carries the house error envelope, whose code vocabulary is closed', () => {
    expect(DatasetQueryBatchEntrySchema.safeParse(refused).success).toBe(true);
    expect(DatasetQueryBatchEntrySchema.safeParse({
      status: 400, error: { code: 'NOT_A_REGISTERED_CODE', message: 'x' },
    }).success).toBe(false);
  });

  it('a refusal is mapped into the envelope: a fault\'s text as `message`, an outside code in `declaredCode`', () => {
    // The single door answers an undeclared fault as `{ code, error }` with no
    // `message`; relayed as it is, it is not an entry.
    expect(DatasetQueryBatchEntrySchema.safeParse({
      status: 500, error: { code: 'ANALYTICS_QUERY_FAILED', error: 'Analytics query failed.' },
    }).success).toBe(false);
    expect(DatasetQueryBatchEntrySchema.safeParse({
      status: 500, error: { code: 'ANALYTICS_QUERY_FAILED', message: 'Analytics query failed.' },
    }).success).toBe(true);
    expect(DatasetQueryBatchEntrySchema.safeParse({
      status: 422, error: { code: 'VALIDATION_FAILED', declaredCode: 'ACME_QUOTA_RULE', message: 'Over quota.', httpStatus: 422 },
    }).success).toBe(true);
  });

  it('an entry is exactly one of answer or refusal, never both and never neither', () => {
    expect(DatasetQueryBatchEntrySchema.safeParse({ ...answered, ...refused }).success).toBe(false);
    expect(DatasetQueryBatchEntrySchema.safeParse({}).success).toBe(false);
    expect(DatasetQueryBatchEntrySchema.safeParse({ error: refused.error }).success).toBe(false);
  });

  it('a refused entry\'s status is an HTTP error status', () => {
    expect(DatasetQueryBatchEntrySchema.safeParse({ ...refused, status: 200 }).success).toBe(false);
    expect(DatasetQueryBatchEntrySchema.safeParse({ ...refused, status: 503 }).success).toBe(true);
  });
});

/**
 * The single door's request and answer shapes are not moved by the batch: the
 * batch reuses them and adds nothing to them. Key sets measured at
 * `origin/main` 3ca6108a before the batch schemas were written.
 */
describe('single dataset-query door shapes are unchanged', () => {
  const keys = (shape: Record<string, unknown>) => Object.keys(shape).sort();

  it('DatasetSelectionSchema', () => {
    expect(keys(DatasetSelectionSchema.shape)).toEqual([
      'compareTo', 'dateGranularity', 'dimensions', 'limit', 'measures', 'offset', 'order',
      'runtimeFilter', 'timeDimensions', 'timezone', 'totals',
    ]);
  });

  it('AnalyticsResultResponseSchema and its `data`', () => {
    expect(keys(AnalyticsResultResponseSchema.shape)).toEqual(['data', 'error', 'meta', 'success']);
    const data = AnalyticsResultResponseSchema.shape.data;
    expect(keys(data.shape)).toEqual([
      'dimensionFields', 'drillRanges', 'drillRawRows', 'drillRawTotals', 'drillScopes', 'fields',
      'object', 'rows', 'sql', 'totals',
    ]);
    expect(keys(data.shape.fields.element.shape)).toEqual([
      'aggregate', 'builtinAggregate', 'currency', 'currencyField', 'format', 'label', 'name',
      'nullLabel', 'percentScale', 'polarity', 'type',
    ]);
  });
});
