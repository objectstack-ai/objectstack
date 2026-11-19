// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// END-TO-END gate: `POST /analytics/dataset/query` with a saved `datasetName`
// answers only the members the dataset declares (ADR-0021, ADR-0149 D1),
// proven on the stock showcase through the real stack (HTTP → REST → the
// dataset query door → AnalyticsService.queryDataset).
//
// Before, the door minted a member the dataset does not declare: the ad-hoc
// `count`, a raw field read as its `sum`, an `<field>_sum` suffix spelling, a
// `<dataset>.`-qualified spelling, and a raw field named as a dimension or a
// time dimension, each answered 200. Each now answers 400 INVALID_FIELD with
// the same refusal the AI tool `query_dataset` gives, on the single door and
// on each entry of the batch door.
//
// Controls: the declared members are served (200) on both doors; a missing
// dataset is still 404 first.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const DATASET = 'showcase_task_metrics';

describe('dogfood: the dataset query door refuses members the dataset does not declare', () => {
  let stack: VerifyStack;
  let token: string;

  beforeAll(async () => {
    stack = await bootShowcase();
    token = await stack.signIn();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  async function datasetQuery(body: Record<string, unknown>): Promise<{ status: number; body: Record<string, any> }> {
    const res = await stack.apiAs(token, 'POST', '/analytics/dataset/query', body);
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  }
  const codeOf = (body: Record<string, any>) => body.error?.code ?? body.code;
  const messageOf = (body: Record<string, any>) => String(body.error?.message ?? body.message ?? '');

  it('CONTROL: declared measures and dimensions, a declared time dimension included, are served', async () => {
    const res = await datasetQuery({
      datasetName: DATASET,
      selection: {
        measures: ['task_count', 'est_hours'],
        dimensions: ['status'],
        timeDimensions: [{ dimension: 'created_at', dateRange: ['2000-01-01', '2100-12-31'] }],
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Array.isArray(res.body.rows)).toBe(true);
  });

  it.each([
    ['the ad-hoc count', { measures: ['count'] }, 'measure "count"'],
    ['a raw field as a measure', { measures: ['estimate_hours'] }, 'measure "estimate_hours"'],
    ['a suffix spelling', { measures: ['estimate_hours_sum'] }, 'measure "estimate_hours_sum"'],
    ['a dataset-qualified spelling', { measures: [`${DATASET}.task_count`] }, `measure "${DATASET}.task_count"`],
    ['a raw field as a dimension', { measures: ['task_count'], dimensions: ['estimate_hours'] }, 'dimension "estimate_hours"'],
    [
      'a raw field as a time dimension',
      { measures: ['task_count'], timeDimensions: [{ dimension: 'updated_at', granularity: 'month' }] },
      'dimension "updated_at"',
    ],
  ])('%s → 400 INVALID_FIELD naming it and the declared members', async (_case, selection, named) => {
    const res = await datasetQuery({ datasetName: DATASET, selection });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(codeOf(res.body)).toBe('INVALID_FIELD');
    expect(messageOf(res.body)).toContain(`The dataset "${DATASET}" does not declare the ${named}.`);
    expect(messageOf(res.body)).toContain('task_count');
    expect(messageOf(res.body)).toContain('declare the member on the dataset');
  });

  it('the batch door refuses the same entry with the same answer, and serves its declared sibling', async () => {
    const res = await stack.apiAs(token, 'POST', '/analytics/dataset/query/batch', {
      queries: [
        { datasetName: DATASET, selection: { measures: ['count'] } },
        { datasetName: DATASET, selection: { measures: ['task_count'] } },
      ],
    });
    expect(res.status).toBe(200);
    const [refused, served] = ((await res.json()) as any).data.results;
    expect([refused.status, refused.error.code]).toEqual([400, 'INVALID_FIELD']);
    expect(refused.error.message).toContain(`The dataset "${DATASET}" does not declare the measure "count".`);
    expect(Array.isArray(served.data?.rows)).toBe(true);
  });

  it('CONTROL: a missing dataset is still 404 first, whatever the members', async () => {
    const res = await datasetQuery({ datasetName: 'no_such_dataset', selection: { measures: ['count'] } });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
  });
});
