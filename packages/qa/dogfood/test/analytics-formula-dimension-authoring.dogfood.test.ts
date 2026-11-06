// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// END-TO-END gate for #30773: a dataset whose DIMENSION groups by a formula
// field is refused where it is authored — the runtime save (`PUT /meta/dataset`,
// the gate Studio, REST and MCP share) answers `422` naming
// `dimension-virtual-field-refused`, and the dataset compile behind
// `POST /analytics/dataset/query` answers `400 DATASET_INVALID` naming the
// dimension, whatever the selection — proven on the stock showcase, through the
// real stack.
//
// `showcase_project.budget_remaining` is a `formula` (`returnType: 'currency'`):
// computed on read, no column. Measured on `main` `2d04cd2b` before this card,
// such a dataset compiled and registered, a query selecting only its stored
// dimension was served, and only a query grouping by the formula was refused
// (#29304, `400 INVALID_FIELD` at `groupBy.0`) — in front of whoever opened
// the tile, not the author.
//
// Controls: the same dataset without the formula dimension saves and queries.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const OBJECT = 'showcase_project';
const SAVED = 'os30773_project_by_formula';
const SAVED_CONTROL = 'os30773_project_by_status';

const dataset = (name: string, withFormula: boolean) => ({
  name,
  label: 'Projects',
  object: OBJECT,
  dimensions: [
    { name: 'status', label: 'Status', field: 'status', type: 'string' },
    ...(withFormula ? [{ name: 'remaining', label: 'Remaining', field: 'budget_remaining', type: 'number' }] : []),
  ],
  measures: [{ name: 'cnt', label: 'Count', aggregate: 'count' }],
});

describe('dogfood: a dataset dimension over a formula field is refused at authoring (#30773)', () => {
  let stack: VerifyStack;
  let token: string;

  beforeAll(async () => {
    stack = await bootShowcase();
    token = await stack.signIn();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  async function call(method: 'PUT' | 'POST', path: string, body: unknown) {
    const res = await stack.apiAs(token, method, path, body);
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  }

  it('PUT /meta/dataset: the save is refused 422, naming dimension-virtual-field-refused at the dimension', async () => {
    const res = await call('PUT', `/meta/dataset/${SAVED}`, dataset(SAVED, true));
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    const text = JSON.stringify(res.body);
    expect(text).toContain('dimension-virtual-field-refused');
    expect(text).toContain('dimensions[1].field');
    expect(text).toContain('budget_remaining');
  });

  it('CONTROL PUT /meta/dataset: the same dataset over a stored dimension saves', async () => {
    const res = await call('PUT', `/meta/dataset/${SAVED_CONTROL}`, dataset(SAVED_CONTROL, false));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  for (const dimensions of [['remaining'], ['status']]) {
    it(`POST /analytics/dataset/query (inline, selecting ${dimensions.join()}): 400 DATASET_INVALID naming the dimension and the remedy`, async () => {
      const res = await call('POST', '/analytics/dataset/query', {
        dataset: dataset('os30773_inline', true),
        selection: { dimensions, measures: ['cnt'] },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      // This door builds its envelope by hand: `{ code, message }` at the top.
      expect(res.body.code, JSON.stringify(res.body)).toBe('DATASET_INVALID');
      const message = String(res.body.message);
      expect(message).toContain(
        'dataset "os30773_inline" dimension "remaining" (dimensions.1) groups by field "budget_remaining", ' +
          `which object "${OBJECT}" declares as \`formula\``,
      );
      expect(message).toContain(`Denormalise the value onto "${OBJECT}" (a stored field, written when the source changes)`);
    });
  }

  it('CONTROL POST /analytics/dataset/query: the dataset without the formula dimension is served', async () => {
    const res = await call('POST', '/analytics/dataset/query', {
      dataset: dataset('os30773_inline_control', false),
      selection: { dimensions: ['status'], measures: ['cnt'] },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });
});
