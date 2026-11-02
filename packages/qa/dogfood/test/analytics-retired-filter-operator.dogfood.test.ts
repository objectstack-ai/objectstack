// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// END-TO-END gate for #28945: a RETIRED filter operator in a dashboard
// widget's `runtimeFilter` is refused on `POST /analytics/dataset/query` with
// the retirement's prescription, the way the data door refuses it — proven on
// the stock showcase, through the real stack (HTTP → REST → analytics plugin →
// the analytics `where` door).
//
// The D3 retirement entry `filter-regex-options-retired` lists stored dashboard
// widget filters as a stored site and promises `$regex` / `$options` are
// "refused everywhere with INVALID_FILTER / 400 naming the replacement". The
// analytics door gave the envelope with a generic "Unsupported filter operator
// … Supported: …" list instead (measured on this file's base). It now answers
// "… is RETIRED … Write "$icontains" instead", then the spec table's
// prescription, word for word what the data door prints after its own lead-in.
//
// Controls: `$icontains` is served (200), and an unknown operator keeps the
// generic list.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RETIRED_FILTER_OPERATORS } from '@objectstack/spec/data';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const DATASET = 'showcase_project_metrics';

describe('dogfood: a retired filter operator in an analytics runtimeFilter names its replacement (#28945)', () => {
  let stack: VerifyStack;
  let token: string;

  beforeAll(async () => {
    stack = await bootShowcase();
    token = await stack.signIn();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  async function datasetQuery(runtimeFilter: unknown): Promise<{ status: number; body: Record<string, any> }> {
    const res = await stack.apiAs(token, 'POST', '/analytics/dataset/query', {
      datasetName: DATASET,
      selection: { measures: ['project_count'], runtimeFilter },
    });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  }

  /** The prescription the data door prints after its own lead-in. */
  const tail = (message: string): string => message.slice(message.indexOf(' Write "'));

  it('CONTROL: $icontains is served', async () => {
    const res = await datasetQuery({ name: { $icontains: 'acme' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  for (const op of ['$regex', '$options'] as const) {
    it(`${op} → 400 INVALID_FILTER, RETIRED, "Write "$icontains" instead", the table's prescription`, async () => {
      const res = await datasetQuery({ name: { [op]: op === '$regex' ? 'acme' : 'i' } });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.code).toBe('INVALID_FILTER');
      const message = String(res.body.message);
      expect(message).toContain(`Filter operator "${op}" on field "name" is RETIRED`);
      expect(message).toContain(`Write "${RETIRED_FILTER_OPERATORS[op].to}" instead.`);
      expect(message).not.toContain('Unsupported filter operator');
      // The opening of the prescription, inside what a client reads.
      expect(message).toContain(RETIRED_FILTER_OPERATORS[op].why.slice(0, 80));
    });
  }

  it('the same prescription the data door gives for the same key', async () => {
    const analytics = await datasetQuery({ name: { $regex: 'acme' } });
    const data = await stack.apiAs(token, 'POST', '/data/showcase_project/query', { where: { name: { $regex: 'acme' } } });
    const dataBody = (await data.json()) as Record<string, any>;
    expect(data.status, JSON.stringify(dataBody)).toBe(400);
    expect(dataBody.code).toBe('INVALID_FILTER');
    const dataMessage = String(dataBody.error);
    expect(dataMessage).toContain(' Write "$icontains" instead.');
    // The data door cuts its client message at 500 characters with `…`; the
    // analytics door serves the message whole. What the data door shows is a
    // prefix of what the analytics door shows, from the replacement on.
    const shown = tail(dataMessage).replace(/…$/, '');
    expect(shown.length).toBeGreaterThan(200);
    expect(tail(String(analytics.body.message)).startsWith(shown)).toBe(true);
  });

  it('CONTROL: an unknown operator keeps the generic list', async () => {
    const res = await datasetQuery({ name: { $sounds_like: 'acme' } });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.code).toBe('INVALID_FILTER');
    expect(String(res.body.message)).toContain('Unsupported filter operator "$sounds_like"');
  });
});
