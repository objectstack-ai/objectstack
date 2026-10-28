// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Checklist item `records-forms.field-unique-enforcement` (#26573): its four
// api clauses at the REST data doors of a booted stack on the stock SQL family
// (`bootStack`'s default SQLite datasource). No showcase object declares a
// field-level `unique` (fixtures.knownGaps[0]), so this file authors the
// item's own scratch object inline, as its fixtures prescribe: `sku` bare
// `unique: true`, `gsku` `unique: 'global'`, `nick` with no unique.
//
//   acceptance[0], negative[0], negative[1] — a colliding create is 409
//     UNIQUE_VIOLATION; the developerMessage names the object by its declared
//     label and says no record was written; on the tenant-scoped (composite)
//     index the user-facing `error` is the generic sentence, and on the
//     single-column global index it names the field by its label (#26867),
//     while `field` keeps the API key; neither carries a driver
//     prefix, the driver's statement or the bound value; the row count is
//     unchanged.
//   acceptance[1] — NULL-distinct: two rows with no sku both land.
//   acceptance[2] — an update onto a taken value is refused and the row keeps
//     its old value; an update leaving the unique field alone (or re-sending
//     its own value) passes.
//   acceptance[3], negative[2] — the REST door that stamps one value onto two
//     rows in one request is `POST /data/:object/updateMany` with
//     `options.atomic`; its per-row report refuses both (ROLLED_BACK for the
//     row written first, UNIQUE_VIOLATION for the causal one) and BOTH rows
//     re-read unchanged. REST
//     has no predicate-update door, so the engine's predicate `updateMany`
//     stays the driver pins' (memory-unique-constraint.test.ts).
//
// The scope matrix (acceptance[4]) and the autonumber converge (acceptance[5])
// stay unit-pinned, as the item says.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

const OBJ = 'fue_item';
const LABEL = 'Unique Item';

const fueStack = defineStack({
  manifest: {
    id: 'com.dogfood.field-unique-rest-refusal', namespace: 'fue', version: '0.0.0', type: 'app',
    name: 'Field unique REST fixture', description: 'One object with an org-scoped and a global unique field.',
  },
  objects: [
    ObjectSchema.create({
      name: OBJ, label: LABEL, pluralLabel: 'Unique Items', sharingModel: 'public_read_write',
      fields: {
        name: Field.text({ label: 'Name', required: true }),
        sku: Field.text({ label: 'SKU', unique: true }),
        gsku: Field.text({ label: 'Global SKU', unique: 'global' }),
        nick: Field.text({ label: 'Nickname' }),
      },
    }),
  ],
} as never);

type Answer = { status: number; json: any; text: string };

describe('records-forms.field-unique-enforcement — the unique refusal at the REST doors', () => {
  let stack: VerifyStack;
  let token = '';

  const call = async (method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(token, method, path, body);
    const text = await res.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
  const create = async (data: Record<string, unknown>): Promise<string> => {
    const res = await call('POST', `/data/${OBJ}`, data);
    expect(res.status, res.text).toBe(201);
    const [row] = await stack.rows(OBJ, { name: data.name });
    return String(row.id);
  };
  const read = async (id: string) => (await stack.rows(OBJ, { id }))[0];
  /** The driver-anonymous contract: no driver prefix, no statement text, no bound value. */
  const expectDriverAnonymous = (text: string, value: string) => {
    expect(text).not.toMatch(/\[driver-/);
    expect(text).not.toMatch(/UNIQUE constraint failed/i);
    expect(text).not.toContain(value);
  };

  beforeAll(async () => {
    stack = await bootStack(fueStack);
    token = await stack.signIn();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  // The measured bodies. Bare `unique: true` is tenant-scoped, so its SQLite
  // index is composite and no single column is named; the global index is
  // single-column, so the field is named — by its label in `error` and
  // `developerMessage` (one resolution, the engine's), by its API key on
  // `field` (#26867).
  it.each([
    ['sku', 'FUE-SKU-0001', {
      error: 'A record with this value already exists',
      code: 'UNIQUE_VIOLATION',
      developerMessage: `Duplicate record refused on '${LABEL}': a unique constraint already holds these values. No record was written.`,
      object: OBJ,
    }],
    ['gsku', 'FUE-GSKU-0001', {
      error: 'A record with this Global SKU already exists',
      code: 'UNIQUE_VIOLATION',
      developerMessage: `Duplicate record refused on '${LABEL}': a unique constraint on 'Global SKU' already holds this value. No record was written.`,
      field: 'gsku',
      object: OBJ,
    }],
  ])('acceptance[0], negative[0], negative[1]: a colliding create on %s is 409 UNIQUE_VIOLATION, driver-anonymous, and nothing lands', async (field, value, body) => {
    await create({ name: `fue-first-${field}`, [field]: value });
    const refused = await call('POST', `/data/${OBJ}`, { name: `fue-second-${field}`, [field]: value });
    expect(refused.status, refused.text).toBe(409);
    expect(refused.json).toEqual(body);
    expectDriverAnonymous(refused.text, value);
    expect(await stack.rows(OBJ, { [field]: value })).toHaveLength(1);
    expect(await stack.rows(OBJ, { name: `fue-second-${field}` })).toHaveLength(0);
  });

  it('acceptance[1]: two rows with no sku both land (NULL-distinct)', async () => {
    const a = await create({ name: 'fue-null-a' });
    const b = await create({ name: 'fue-null-b' });
    expect(a).not.toBe(b);
    expect((await read(a))?.sku ?? null).toBeNull();
    expect((await read(b))?.sku ?? null).toBeNull();
  });

  it('acceptance[2]: an update onto a taken value is refused and the row keeps its old value; a self-update passes', async () => {
    await create({ name: 'fue-upd-taken', sku: 'FUE-UPD-1' });
    const id = await create({ name: 'fue-upd-mover', sku: 'FUE-UPD-2' });

    const refused = await call('PATCH', `/data/${OBJ}/${id}`, { sku: 'FUE-UPD-1' });
    expect(refused.status, refused.text).toBe(409);
    expect(refused.json.code).toBe('UNIQUE_VIOLATION');
    expectDriverAnonymous(refused.text, 'FUE-UPD-1');
    expect((await read(id)).sku).toBe('FUE-UPD-2');

    // A row never collides with itself: leaving sku alone, or re-sending its own value, passes.
    const other = await call('PATCH', `/data/${OBJ}/${id}`, { nick: 'moved-nothing' });
    expect(other.status, other.text).toBe(200);
    const same = await call('PATCH', `/data/${OBJ}/${id}`, { sku: 'FUE-UPD-2' });
    expect(same.status, same.text).toBe(200);
    expect(await read(id)).toMatchObject({ sku: 'FUE-UPD-2', nick: 'moved-nothing' });
  });

  it('acceptance[3], negative[2]: an atomic updateMany stamping one value onto two rows is refused, and neither row changes', async () => {
    const c = await create({ name: 'fue-many-c', sku: 'FUE-MANY-C', nick: 'c' });
    const d = await create({ name: 'fue-many-d', sku: 'FUE-MANY-D', nick: 'd' });
    const before = [await read(c), await read(d)];

    const res = await call('POST', `/data/${OBJ}/updateMany`, {
      records: [{ id: c, data: { sku: 'FUE-MANY-X', nick: 'c2' } }, { id: d, data: { sku: 'FUE-MANY-X', nick: 'd2' } }],
      options: { atomic: true },
    });
    // The per-row report: the causal row keeps its own code, the row written
    // before it is marked rolled back, and nothing succeeded.
    expect(res.status, res.text).toBe(200);
    expect(res.json).toMatchObject({ success: false, total: 2, succeeded: 0, failed: 2 });
    expect(res.json.results.map((r: any) => [r.id, r.success, r.errors?.[0]?.code])).toEqual([
      [c, false, 'ROLLED_BACK'],
      [d, false, 'UNIQUE_VIOLATION'],
    ]);
    expect([await read(c), await read(d)]).toEqual(before);
    expect(await stack.rows(OBJ, { sku: 'FUE-MANY-X' })).toHaveLength(0);
  });
});
