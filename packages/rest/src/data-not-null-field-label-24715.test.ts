// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24715] A `/data` write's NOT NULL refusal names the field by its LABEL, in
 * the caller's locale, and a field declared `storage: { notNull: true }` is not
 * told to declare `required`.
 *
 * `unit_price` (label "Sales Price") is ADR-0113's engine-populated column:
 * `storage: { notNull: true }`, no `required`. The record validator judges
 * `required` only, so a write with no value for it reaches the driver and the
 * DATABASE refuses it. Measured on `origin/main` `7e7e605de` through these same
 * two doors, before the change:
 *
 *     PATCH /api/v1/data/OBJECT/ID  { "unit_price": null }
 *     POST  /api/v1/data/OBJECT     { …, no unit_price }
 *       400 { "error": "unit_price is required", "code": "VALIDATION_FAILED",
 *             "fields": [{ "field": "unit_price", "code": "required",
 *                          "message": "unit_price is required" }],
 *             "hint": "The database column for 'unit_price' requires a value:
 *                      provide it, or declare the field `required` in the
 *                      object metadata. If the object declares neither … run
 *                      'os migrate' …", "object": "OBJECT" }
 *
 * Read through the public doors, over a REAL `ObjectQL` +
 * `ObjectStackProtocolImplementation` + SQLite `:memory:`.
 *
 * [#24768] The label now comes from the ENGINE, not from this door: a NOT NULL
 * refusal on a field the object declares leaves `engine.insert` /
 * `engine.update` as the record validator's own `ValidationError`, built by the
 * validator's builder with the validator's message context, and this door
 * answers it as it answers every `ValidationError` (the classification's
 * validation arm). So the answer is the validator's envelope, byte for byte the
 * shape of its own `required` refusal: `fields[0]` carries `label`, there is no
 * `hint` (the validator's `required` has none), and a `PATCH` writing null reads
 * the validator's clear-out sentence (`required_cleared`), as a `PATCH` clearing
 * a `required` field does. The door's second object read and its relabel
 * (`not-null-refusal-label.ts`) retired.
 *
 * The controls: a field the metadata declares with neither `required` nor
 * `storage.notNull` over a NOT NULL column (drift) is declared, so it is named
 * by its label the same way; a column the metadata does not declare at all
 * keeps the classification's column sentence and its drift hint. Pinned by
 * kind: the sentence is the catalog's sentence for the label (asked of
 * `renderValidationMessage`, the record validator's own renderer).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
  SysMetadataAuditObject,
  SysMetadataCommitObject,
  SysMetadataHistoryObject,
  SysMetadataObject,
} from '@objectstack/metadata-core';
import { renderValidationMessage } from '@objectstack/spec/system';
import { RestServer } from './rest-server';

const OBJECT = 'line_item_24715';

/** The metadata as the DDL saw it: every column the table is built with. */
const AS_SYNCED = {
  name: OBJECT, label: 'Line item', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const, label: 'Name' },
    // ADR-0113's engine-populated column: NOT NULL on purpose, not `required`.
    unit_price: { name: 'unit_price', type: 'number' as const, label: 'Sales Price', storage: { notNull: true } },
    // The validator's own `required`, for the parity case.
    list_price: { name: 'list_price', type: 'number' as const, label: 'List Price', required: true },
    drift_col: { name: 'drift_col', type: 'text' as const, label: 'Drift Column', storage: { notNull: true } },
    gone_col: { name: 'gone_col', type: 'text' as const, label: 'Gone Column', storage: { notNull: true } },
  },
};

/**
 * The metadata the doors read afterwards: `drift_col` declares neither
 * `required` nor `storage.notNull` over a column that is still NOT NULL (drift),
 * and `gone_col` is not declared at all.
 */
const SERVED = (() => {
  const { gone_col: _gone, drift_col, ...fields } = AS_SYNCED.fields;
  const { storage: _storage, ...undeclared } = drift_col;
  return { ...AS_SYNCED, fields: { ...fields, drift_col: undeclared } };
})();

const ZH_LABELS: Record<string, string> = {
  [`objects.${OBJECT}.fields.unit_price.label`]: '销售价格',
  [`objects.${OBJECT}.fields.list_price.label`]: '标价',
};
/** An `II18nService` holding a `zh-CN` bundle: `t` echoes the key on a miss. */
const I18N = {
  t: (key: string, locale: string) => (locale === 'zh-CN' && ZH_LABELS[key]) || key,
  getLocales: () => ['en', 'zh-CN'],
};

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const res: any = {
    write: () => true, end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(opts: { locale?: string; i18n?: boolean } = {}) {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
  await engine.init();
  if (opts.i18n) engine.setI18nService(I18N);
  engine.registry.registerObject(AS_SYNCED as any);
  await engine.syncSchemas();
  await engine.insert(OBJECT, { id: 'e1', name: 'existing', unit_price: 5, list_price: 7, drift_col: 'd', gone_col: 'g' } as any);
  engine.registry.registerObject(SERVED as any);
  // The protocol's object read consults the stored-metadata family; registered
  // after the DDL, as a boot does, so its unprovisioned table reads as empty.
  for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
    if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as any);
  }

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(
    createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined,
    // i18nServiceProvider — the 14th constructor argument.
    async () => (opts.i18n ? I18N : undefined) as any,
  );
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user', ...(opts.locale ? { locale: opts.locale } : {}) });
  rest.registerRoutes();
  const call = async (method: string, path: string, body: unknown, params: Record<string, string> = { object: OBJECT }) => {
    const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    expect(route, `${method} ${path}`).toBeDefined();
    const res = makeRes();
    await route!.handler({ params, body, query: {}, headers: {} } as any, res);
    return { status: res._status ?? 200, body: res._json };
  };
  const patch = (data: Record<string, unknown>) =>
    call('PATCH', '/api/v1/data/:object/:id', data, { object: OBJECT, id: 'e1' });
  const create = (data: Record<string, unknown>) => call('POST', '/api/v1/data/:object', data);
  const stored = async () => (await engine.find(OBJECT, { where: { id: 'e1' } }) as any[])[0];
  return { engine, patch, create, stored };
}

/** The catalog's sentence for `label`, in `locale` — what the record validator renders. */
const requiredSentence = (label: string, field: string, locale?: string, messageKey: 'required' | 'required_cleared' = 'required') =>
  renderValidationMessage({ messageKey, label, field, params: {} }, { locale });

/** The record validator's envelope for one field, named by `label` with `message`. */
function expectRefusal(door: { status: number; body: any }, field: string, label: string, message: string) {
  expect(door.status, JSON.stringify(door.body)).toBe(400);
  expect(door.body).toEqual({
    code: 'VALIDATION_FAILED',
    error: message,
    fields: [{ field, code: 'required', message, label }],
    object: OBJECT,
  });
}

/** The classification's answer for a column no field declares: the column's sentence, and its hint. */
function expectColumnRefusal(door: { status: number; body: any }, field: string) {
  expect(door.status, JSON.stringify(door.body)).toBe(400);
  expect(door.body).toMatchObject({
    code: 'VALIDATION_FAILED',
    error: `${field} is required`,
    fields: [{ field, code: 'required', message: `${field} is required` }],
    object: OBJECT,
  });
  expect(Object.keys(door.body).sort()).toEqual(['code', 'error', 'fields', 'hint', 'object']);
}

describe('[#24715] a declared `storage.notNull` field\'s refusal names its label', () => {
  it('the fixture is the ADR-0113 posture: the validator lets the write through and the database refuses it', async () => {
    const { engine } = await boot();
    expect(AS_SYNCED.fields.unit_price).toMatchObject({ label: 'Sales Price', storage: { notNull: true } });
    expect('required' in AS_SYNCED.fields.unit_price).toBe(false);
    // [#24768] …and the engine names it: the validator's class, not the driver's error.
    const refused = await engine.update(OBJECT, { unit_price: null } as any, { where: { id: 'e1' } } as any).then(
      () => undefined,
      (e: any) => e,
    );
    expect(refused?.name).toBe('ValidationError');
    expect(refused?.code).toBe('VALIDATION_FAILED');
  });

  it('PATCH writing null: the label, in the validator\'s clear-out sentence', async () => {
    const { patch, stored } = await boot();
    const door = await patch({ unit_price: null });
    expectRefusal(door, 'unit_price', 'Sales Price', requiredSentence('Sales Price', 'unit_price', undefined, 'required_cleared'));
    expect(door.body.error).not.toContain('unit_price');
    expect((await stored()).unit_price).toBe(5);
  });

  it('POST with no value: the label, in the validator\'s `required` sentence', async () => {
    const { create, engine } = await boot();
    const door = await create({ id: 'n1', name: 'new', list_price: 1, drift_col: 'd' });
    expectRefusal(door, 'unit_price', 'Sales Price', requiredSentence('Sales Price', 'unit_price'));
    expect(await engine.find(OBJECT, { where: { id: 'n1' } })).toHaveLength(0);
  });
});

describe('[#24715] localized the way the record validator localizes its own `required`', () => {
  it('zh-CN: the translated label in the catalog\'s zh-CN sentence — the validator\'s template, word for word', async () => {
    const { patch, create } = await boot({ locale: 'zh-CN', i18n: true });

    const door = await patch({ unit_price: null });
    expectRefusal(door, 'unit_price', '销售价格', requiredSentence('销售价格', 'unit_price', 'zh-CN', 'required_cleared'));

    const missing = await create({ id: 'n2', name: 'new', list_price: 1, drift_col: 'd' });
    expectRefusal(missing, 'unit_price', '销售价格', requiredSentence('销售价格', 'unit_price', 'zh-CN'));

    // The validator, on the same request shape, for the field it refuses itself.
    const own = await create({ id: 'n1', name: 'new', unit_price: 1, drift_col: 'd' });
    expect(own.status, JSON.stringify(own.body)).toBe(400);
    const validatorMessage = own.body.fields.find((f: any) => f.field === 'list_price')?.message;
    expect(validatorMessage).toBe(requiredSentence('标价', 'list_price', 'zh-CN'));
    expect(missing.body.error.replace('销售价格', 'LABEL')).toBe(validatorMessage.replace('标价', 'LABEL'));
  });

  it('a bare `zh` reaches the zh-CN bundle, as the validator\'s locale negotiation does', async () => {
    const { patch } = await boot({ locale: 'zh', i18n: true });
    const door = await patch({ unit_price: null });
    expectRefusal(door, 'unit_price', '销售价格', requiredSentence('销售价格', 'unit_price', 'zh-CN', 'required_cleared'));
  });
});

describe('[#24715] the controls', () => {
  it('drift — declared with neither `required` nor `storage.notNull` over a NOT NULL column: still a declared field, so its label', async () => {
    const { patch } = await boot();
    const door = await patch({ drift_col: null });
    expectRefusal(door, 'drift_col', 'Drift Column', requiredSentence('Drift Column', 'drift_col', undefined, 'required_cleared'));
  });

  it('a column the metadata does not declare: the column\'s sentence and the drift hint', async () => {
    const { create } = await boot();
    const door = await create({ id: 'n1', name: 'new', unit_price: 1, list_price: 1, drift_col: 'd' });
    expectColumnRefusal(door, 'gone_col');
    expect(String(door.body.hint)).toMatch(/os migrate/);
  });
});
