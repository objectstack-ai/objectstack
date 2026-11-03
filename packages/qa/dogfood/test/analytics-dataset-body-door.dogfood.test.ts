// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// END-TO-END gate for #29156: `POST /analytics/dataset/query` refuses an
// unknown key on its OUTER body, proven on the stock showcase through the real
// stack (HTTP → REST → the dataset query door).
//
// Before the fix a `runtimeFilter` written beside `selection` instead of
// inside it answered 200 with the UNFILTERED aggregate, and `bogus: 1` beside
// `selection` answered 200 too. Both now answer 400 VALIDATION_FAILED naming
// the key; the misplaced filter names `selection.runtimeFilter`.
//
// Controls: the same filter inside `selection` is served (200) and actually
// narrows the answer, and the plain body is served.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const DATASET = 'showcase_project_metrics';
const MEASURE = 'project_count';
// Matches no showcase project, so a filter that is honoured answers 0 and a
// dropped one answers the full count.
const NO_MATCH = { name: { $icontains: 'zz-no-such-project-29156' } };

describe('dogfood: the dataset query door refuses unknown body keys (#29156)', () => {
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

  const count = (body: Record<string, any>): number => Number(body.rows?.[0]?.[MEASURE] ?? 0);

  it('CONTROL: the plain body is served and counts projects', async () => {
    const res = await datasetQuery({ datasetName: DATASET, selection: { measures: [MEASURE] } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(count(res.body)).toBeGreaterThan(0);
  });

  it('CONTROL: `selection.runtimeFilter` is served and narrows the answer', async () => {
    const res = await datasetQuery({ datasetName: DATASET, selection: { measures: [MEASURE], runtimeFilter: NO_MATCH } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(count(res.body)).toBe(0);
  });

  it('a top-level `runtimeFilter` → 400 VALIDATION_FAILED naming it, remedy `selection.runtimeFilter`', async () => {
    const res = await datasetQuery({ datasetName: DATASET, selection: { measures: [MEASURE] }, runtimeFilter: NO_MATCH });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(String(res.body.message)).toContain('Unrecognized key(s) on this dataset query: `runtimeFilter`');
    expect(String(res.body.message)).toContain('did you mean `selection.runtimeFilter`?');
    expect(res.body.details?.fields?.map((f: { field: string }) => f.field)).toEqual(['runtimeFilter']);
  });

  it('`bogus: 1` beside `selection` → 400 VALIDATION_FAILED naming `bogus`', async () => {
    const res = await datasetQuery({ datasetName: DATASET, selection: { measures: [MEASURE] }, bogus: 1 });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(String(res.body.message)).toContain('Unrecognized key(s) on this dataset query: `bogus`');
  });
});
