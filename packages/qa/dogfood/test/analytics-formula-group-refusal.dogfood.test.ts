// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// END-TO-END gate for #29304: a plain group over a formula field is refused
// `INVALID_FIELD` / 400 at its position on `POST /analytics/query` and on the
// `POST /analytics/sql` dry run alike — proven on the stock showcase, through
// the real stack (HTTP → REST → analytics plugin → the native strategy's
// decline → the engine's aggregate door).
//
// `showcase_project.budget_remaining` is a `formula` (`returnType: 'currency'`):
// computed on read, no column. Measured on `main` `447226b2` with a real
// `SqlDriver`, a dimension over a formula answered `DATABASE_ERROR` / 500 on
// the native composition (the strategy ran `GROUP BY` over a column no table
// stores), and the dry run rendered that statement.
//
// Controls: a stored dimension (`status`) is served on both doors.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const CUBE = 'showcase_project';

describe('dogfood: a plain group over a formula field is refused alike on the query and the dry run (#29304)', () => {
  let stack: VerifyStack;
  let token: string;

  beforeAll(async () => {
    stack = await bootShowcase();
    token = await stack.signIn();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  async function ask(door: '/analytics/query' | '/analytics/sql', dimension: string) {
    const res = await stack.apiAs(token, 'POST', door, { cube: CUBE, measures: ['count'], dimensions: [dimension] });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  }

  for (const door of ['/analytics/query', '/analytics/sql'] as const) {
    it(`${door}: a dimension over the formula → 400 INVALID_FIELD at groupBy.0, with the store-the-value remedy`, async () => {
      const res = await ask(door, 'budget_remaining');
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      // The ADR-0112 envelope: `{ success: false, error: { code, message, … } }`.
      expect(res.body.error?.code, JSON.stringify(res.body)).toBe('INVALID_FIELD');
      const message = String(res.body.error?.message);
      expect(message).toContain(
        `aggregate('${CUBE}'): groupBy.0 groups by 'budget_remaining', but 'budget_remaining' is a formula field`,
      );
      expect(message).toContain(`Denormalise the value onto '${CUBE}' (a stored field, written when the source changes) and group by that.`);
    });

    it(`CONTROL ${door}: a stored dimension is served`, async () => {
      const res = await ask(door, 'status');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });
  }

  it('the query and the dry run give one refusal, word for word', async () => {
    const query = await ask('/analytics/query', 'budget_remaining');
    const sql = await ask('/analytics/sql', 'budget_remaining');
    expect(sql.status).toBe(400);
    expect(sql.body.error).toEqual(query.body.error);
  });
});
