// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION — removing a field that stores nothing is not a destructive
// change, booted for real and driven through `PUT /api/v1/meta/object/:name`.
//
// The object save's safety diff refuses, with `409 DESTRUCTIVE_CHANGE`, a save
// that drops a field: the column's data becomes unreachable, and only
// `?force=true` lifts the refusal. That is true of a stored field and false of
// a `formula`, which is computed on read and has no column (ADR-0079 addendum,
// item 9). Refusing the formula removal taught authors and agents to send
// `force=true` by reflex — which silences the true warning on a stored field.
//
// "Stored" is the spec's storage predicate (`isVirtualSearchField` /
// `SEARCH_VIRTUAL_TYPES`), the one the sortability projection reads — so the
// cases below are judged by what each field declares:
//
//   1. a `formula` removal saves 200 without `force`, and the stored values of
//      the other fields read back unchanged;
//   2. a stored `text` removal still answers 409 DESTRUCTIVE_CHANGE, with the
//      same finding and message — the live control that this harness reaches
//      the gate at all;
//   3. an `autonumber` removal still answers 409: it is computed by the ENGINE
//      but stored in a column, so "computed" is not the axis — storage is.
//
// Boots a fixture stack of its own, so it stays out of `SHARED_SHOWCASE`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { cel, defineStack } from '@objectstack/spec';

const NAME = 'dfu_invoice';

const stackDef = defineStack({
  manifest: {
    id: 'com.dogfood.unstored-removal',
    namespace: 'dfu',
    version: '0.0.0',
    type: 'app',
    name: 'Unstored Field Removal',
    description: 'An empty app; the object under test is saved at runtime through the metadata door.',
  },
});

/** Every field the object starts with — each case removes exactly one. */
const FIELDS: Record<string, Record<string, unknown>> = {
  name: { type: 'text', label: 'Name' },
  notes: { type: 'text', label: 'Notes' },
  amount: { type: 'number', label: 'Amount' },
  // JSON round-trip: the wire form of the `cel` envelope.
  doubled: { type: 'formula', label: 'Doubled', expression: JSON.parse(JSON.stringify(cel`record.amount * 2`)) },
  reference: { type: 'autonumber', label: 'Reference' },
};

const definition = (fields: Record<string, Record<string, unknown>>) => ({
  name: NAME,
  label: 'Invoice',
  sharingModel: 'public_read_write',
  fields,
});

const without = (drop: string) => Object.fromEntries(Object.entries(FIELDS).filter(([k]) => k !== drop));

describe('dogfood: removing an unstored field through PUT /meta/object/:name', () => {
  let stack: VerifyStack;
  let token: string;
  let recordId: string;

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await stack.apiAs(token, method, path, body);
    const json: any = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };


  beforeAll(async () => {
    stack = await bootStack(stackDef);
    token = await stack.signIn();

    const saved = await call('PUT', `/meta/object/${NAME}`, definition(FIELDS));
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);

    const created = await call('POST', `/data/${NAME}`, { name: 'INV-1', notes: 'keep me', amount: 21 });
    expect(created.status, JSON.stringify(created.json)).toBeLessThan(300);
    recordId = String(created.json?.data?.id ?? created.json?.id);
    expect(recordId, JSON.stringify(created.json)).toMatch(/\S/);
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('a stored `text` removal still answers 409 DESTRUCTIVE_CHANGE with today\'s finding (live control)', async () => {
    const refused = await call('PUT', `/meta/object/${NAME}`, definition(without('notes')));
    expect(refused.status, JSON.stringify(refused.json)).toBe(409);
    expect(refused.json?.code, JSON.stringify(refused.json)).toBe('DESTRUCTIVE_CHANGE');
    expect(refused.json?.issues).toEqual([{
      code: 'field_removed',
      field: 'notes',
      message: "Field 'notes' removed — existing data in this column will become inaccessible.",
    }]);
  });

  it('an `autonumber` removal still answers 409: engine-computed, but stored in a column', async () => {
    const refused = await call('PUT', `/meta/object/${NAME}`, definition(without('reference')));
    expect(refused.status, JSON.stringify(refused.json)).toBe(409);
    expect(refused.json?.code, JSON.stringify(refused.json)).toBe('DESTRUCTIVE_CHANGE');
    expect(refused.json?.issues).toEqual([expect.objectContaining({ code: 'field_removed', field: 'reference' })]);
  });

  it('a `formula` removal saves 200 without `force`, and the stored fields read back unchanged', async () => {
    const saved = await call('PUT', `/meta/object/${NAME}`, definition(without('doubled')));
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);

    const meta = await call('GET', `/meta/object/${NAME}`);
    expect(meta.status, JSON.stringify(meta.json)).toBe(200);
    expect(Object.keys(meta.json?.item?.fields ?? {})).not.toContain('doubled');

    const read = await call('GET', `/data/${NAME}/${recordId}`);
    expect(read.status, JSON.stringify(read.json)).toBe(200);
    expect(read.json?.record, JSON.stringify(read.json)).toMatchObject({
      name: 'INV-1', notes: 'keep me', amount: 21, reference: expect.stringMatching(/\S/),
    });
  });
});
