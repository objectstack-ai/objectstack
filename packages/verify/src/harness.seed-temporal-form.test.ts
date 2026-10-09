// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22301 item 9 — a cel-dated seed row is stored under `bootStack`, and every
 * hook sees the value the column stores, however the hook runs.
 *
 * Measured before the fix (`origin/main` 28bff18d0, this file's app, one
 * `bootStack`): for `start_date: cel\`daysFromNow(1)\`` on a `date` field the
 * SQL driver stored `YYYY-MM-DD`, while
 *
 *   · an in-process `handler` hook (a source config — what `bootStack` boots)
 *     saw a JS `Date` object, and
 *   · the same hook lowered to a sandboxed `body` (the compiled artifact
 *     `objectstack dev` boots) saw the full instant `YYYY-MM-DDT00:00:00.000Z`.
 *
 * So a hook that reads the field as a string — hotcrm's `campaign_validation`
 * is the measured one — accepted the row under `objectstack dev` and refused it
 * under `bootStack`. The divergence was the value the seed loader handed the
 * engine (`resolveSeedRecord`'s `Date`), not the app's hook: the loader now
 * hands over the ADR-0053 stored form, and every reading below is equal.
 *
 * The literal rows are the control: a literal ISO value is already in stored
 * form and reaches every hook unchanged.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cel, defineStack } from '@objectstack/spec';
import { Field, ObjectSchema } from '@objectstack/spec/data';
import { bootStack, type VerifyStack } from './harness.js';

/** What the in-process hook saw, per row name: `typeof` and the value. */
const handlerSaw = new Map<string, { start: string; end: string }>();
const describeValue = (v: unknown): string =>
  v instanceof Date ? `Date:${v.toISOString()}` : `${typeof v}:${String(v)}`;

const fields = {
  name: Field.text({ label: 'Name', required: true }),
  start_date: Field.date({ label: 'Start' }),
  end_at: Field.datetime({ label: 'End' }),
  seen: Field.text({ label: 'Seen' }),
};

const rows = (prefix: string) => [
  { name: `${prefix}-cel`, start_date: cel`daysFromNow(1)`, end_at: cel`daysFromNow(2)` },
  { name: `${prefix}-literal`, start_date: '2026-10-10', end_at: '2026-10-11T00:00:00.000Z' },
];

const app = defineStack({
  manifest: { id: 'com.example.stf', namespace: 'stf', version: '0.0.0', type: 'app', name: 'Seed temporal form' },
  objects: [
    ObjectSchema.create({ name: 'stf_handler', label: 'Handler', pluralLabel: 'Handlers', sharingModel: 'public_read_write', fields }),
    ObjectSchema.create({ name: 'stf_body', label: 'Body', pluralLabel: 'Bodies', sharingModel: 'public_read_write', fields }),
    ObjectSchema.create({ name: 'stf_guarded', label: 'Guarded', pluralLabel: 'Guarded', sharingModel: 'public_read_write', fields }),
  ],
  hooks: [
    {
      name: 'stf_handler_reads',
      object: 'stf_handler',
      events: ['beforeInsert'],
      handler: async (ctx: { input: Record<string, unknown> }) => {
        handlerSaw.set(String(ctx.input.name), {
          start: describeValue(ctx.input.start_date),
          end: describeValue(ctx.input.end_at),
        });
      },
    },
    {
      name: 'stf_body_reads',
      object: 'stf_body',
      events: ['beforeInsert'],
      body: {
        language: 'js',
        source:
          "ctx.input.seen = typeof ctx.input.start_date + ':' + String(ctx.input.start_date) + '|' + " +
          "typeof ctx.input.end_at + ':' + String(ctx.input.end_at);",
        capabilities: [],
      },
    },
    {
      // hotcrm's `campaign_validation` shape: dates are read only when strings.
      name: 'stf_guarded_requires_string_dates',
      object: 'stf_guarded',
      events: ['beforeInsert'],
      handler: async (ctx: { input: Record<string, unknown> }) => {
        if (typeof ctx.input.start_date !== 'string' || typeof ctx.input.end_at !== 'string') {
          throw Object.assign(new Error('both dates are required'), { code: 'VALIDATION_FAILED', status: 400 });
        }
      },
    },
  ],
  data: [
    { object: 'stf_handler', mode: 'insert', records: rows('handler') },
    { object: 'stf_body', mode: 'insert', records: rows('body') },
    { object: 'stf_guarded', mode: 'insert', records: rows('guarded') },
  ],
} as never);

let stack: VerifyStack;
const stored = new Map<string, Record<string, unknown>>();

beforeAll(async () => {
  stack = await bootStack(app);
  for (const object of ['stf_handler', 'stf_body', 'stf_guarded']) {
    for (const row of await stack.rows(object)) stored.set(String(row.name), row);
  }
}, 120_000);
afterAll(async () => {
  await stack?.stop();
});

describe('a cel-dated seed row reaches every hook in its stored form', () => {
  it('the rows are stored, in the ADR-0053 form of each field', () => {
    for (const prefix of ['handler', 'body', 'guarded']) {
      const row = stored.get(`${prefix}-cel`);
      expect(row, `${prefix}-cel stored`).toBeDefined();
      expect(row!.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row!.end_at).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
    }
  });

  it('an in-process handler sees the stored string, not a Date', () => {
    const row = stored.get('handler-cel')!;
    expect(handlerSaw.get('handler-cel')).toEqual({
      start: `string:${row.start_date}`,
      end: `string:${row.end_at}`,
    });
  });

  it('a sandboxed body sees the same value — the stored form, not a full instant on a date field', () => {
    const row = stored.get('body-cel')!;
    expect(row.seen).toBe(`string:${row.start_date}|string:${row.end_at}`);
  });

  it('a hook that reads the dates only as strings no longer refuses the row', () => {
    expect(stored.get('guarded-cel')).toBeDefined();
  });

  it('control — a literal row reaches both hooks unchanged and is stored as written', () => {
    expect(handlerSaw.get('handler-literal')).toEqual({
      start: 'string:2026-10-10',
      end: 'string:2026-10-11T00:00:00.000Z',
    });
    expect(stored.get('body-literal')!.seen).toBe('string:2026-10-10|string:2026-10-11T00:00:00.000Z');
    expect(stored.get('handler-literal')).toMatchObject({ start_date: '2026-10-10', end_at: '2026-10-11T00:00:00.000Z' });
    expect(stored.get('guarded-literal')).toBeDefined();
  });
});
