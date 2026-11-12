// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// END-TO-END gate for #32527 (ruling 6816429574, letter A): the save that
// turns a `formula` into a stored computed field — `type: 'number'` with the
// same `expression` — on an object that already holds rows fills those rows,
// so the dataset `sum` over the field reads the true total; and it says so on
// the answer, per field.
//
// Measured before this card (the #32443 thread, SQLite, real ObjectQL and
// analytics): every existing row stayed NULL and the dataset `sum` read 0
// where the true total was 6, with no error. `os migrate stored-expressions
// --apply` filled them, but it needs a direct database URL, which a hosted
// tenant does not have, and the save said nothing.
//
// Driven through the real stack on SQLite: `PUT /api/v1/meta/object/:name`
// (the save door Studio, REST and MCP share), the data door for the rows, and
// `POST /analytics/dataset/query` for the total. The draft-then-publish door
// (`POST /meta/:type/:name/publish`) is the second case: the one Studio's
// designer takes on every edit.
//
// Control: before the change the formula's own read answers each row's days
// (the rows are right; only the column the change adds is empty), so the 6
// after it is the fill's.
//
// Boots a fixture stack of its own, so it stays out of `SHARED_SHOWCASE`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { cel, defineStack } from '@objectstack/spec';

const stackDef = defineStack({
  manifest: {
    id: 'com.dogfood.stored-expression-fill',
    namespace: 'dfsx',
    version: '0.0.0',
    type: 'app',
    name: 'Stored Expression Fill',
    description: 'An empty app; the objects under test are saved at runtime through the metadata door.',
  },
});

// JSON round-trip: the wire form of the `cel` envelope.
const DAYS = JSON.parse(JSON.stringify(cel`record.end_day - record.start_day`));
const FORMULA = { type: 'formula', label: 'Days', returnType: 'number', expression: DAYS };
const STORED = { type: 'number', label: 'Days', expression: DAYS };

const definition = (name: string, days: Record<string, unknown>) => ({
  name,
  label: 'Leave Request',
  sharingModel: 'public_read_write',
  fields: {
    title: { type: 'text', label: 'Title' },
    start_day: { type: 'number', label: 'Start' },
    end_day: { type: 'number', label: 'End' },
    days,
  },
});

/** Three requests of 1 + 2 + 3 = 6 days. */
const REQUESTS = [[1, 2], [3, 5], [10, 13]];

describe('dogfood: a formula turned into a stored number on a populated object is filled at the change (#32527)', () => {
  let stack: VerifyStack;
  let token: string;

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await stack.apiAs(token, method, path, body);
    const json: any = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };

  /** The dataset door's answer to a `sum` over `days`. */
  const askTotal = (object: string) =>
    call('POST', '/analytics/dataset/query', {
      dataset: {
        name: `${object}_days`,
        label: 'Days',
        object,
        dimensions: [],
        measures: [{ name: 'total_days', label: 'Total days', aggregate: 'sum', field: 'days' }],
      },
      selection: { dimensions: [], measures: ['total_days'] },
    });

  /** The dataset door's `sum` over `days`. */
  const totalDays = async (object: string) => {
    const res = await askTotal(object);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const rows = (res.json?.rows ?? res.json?.data?.rows ?? []) as Array<Record<string, unknown>>;
    return Number(rows[0]?.total_days ?? 0);
  };

  /** A live object whose `days` is a formula, holding the three requests. */
  const populated = async (object: string) => {
    const saved = await call('PUT', `/meta/object/${object}`, definition(object, FORMULA));
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    for (const [start_day, end_day] of REQUESTS) {
      const created = await call('POST', `/data/${object}`, { title: `from ${start_day}`, start_day, end_day });
      expect(created.status, JSON.stringify(created.json)).toBeLessThan(300);
    }
  };

  const filledNotice = (answer: any) =>
    (answer?.advisories ?? answer?.data?.advisories ?? []).filter((a: any) => a.rule === 'stored-expression-filled');

  beforeAll(async () => {
    stack = await bootStack(stackDef);
    token = await stack.signIn();
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('PUT /meta/object: the save fills the rows, says how many, and the dataset sum reads 6', async () => {
    const object = 'dfsx_leave';
    await populated(object);
    // CONTROL: the formula reads each row's days, and there is no column to total.
    const read = await call('GET', `/data/${object}?limit=10`);
    expect(read.status, JSON.stringify(read.json)).toBe(200);
    expect((read.json?.records ?? []).map((r: any) => r.days).sort()).toEqual([1, 2, 3]);

    const saved = await call('PUT', `/meta/object/${object}`, definition(object, STORED));

    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    const [notice] = filledNotice(saved.json);
    expect(notice, JSON.stringify(saved.json)).toMatchObject({
      severity: 'info',
      path: `objects.${object}.fields.days`,
    });
    expect(notice.message).toContain('3 rows of 3 written');
    expect(await totalDays(object)).toBe(6);
  });

  it('draft, then POST /meta/object/:name/publish: the publish fills the rows and the dataset sum reads 6', async () => {
    const object = 'dfsx_leave_draft';
    await populated(object);

    const draft = await call('PUT', `/meta/object/${object}?mode=draft`, definition(object, STORED));
    expect(draft.status, JSON.stringify(draft.json)).toBe(200);
    // A draft is not live: nothing is filled yet.
    expect(filledNotice(draft.json)).toEqual([]);
    // …and no total reads as complete: the live field is still the formula, and a sum over it is refused.
    const beforePublish = await askTotal(object);
    expect(beforePublish.status, JSON.stringify(beforePublish.json)).toBe(400);
    expect(beforePublish.json?.code, JSON.stringify(beforePublish.json)).toBe('DATASET_INVALID');

    const published = await call('POST', `/meta/object/${object}/publish`, {});

    expect(published.status, JSON.stringify(published.json)).toBe(200);
    const [notice] = filledNotice(published.json);
    expect(notice, JSON.stringify(published.json)).toMatchObject({ severity: 'info' });
    expect(notice.message).toContain('3 rows of 3 written');
    expect(await totalDays(object)).toBe(6);
  });
});
