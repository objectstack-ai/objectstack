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
 * `ObjectStackProtocolImplementation` + SQLite `:memory:`, with the stored
 * metadata family registered so the protocol's by-name object read answers
 * (the door reads the field's label and `storage` there).
 *
 * The controls: a field the metadata declares with neither `required` nor
 * `storage.notNull` on a NOT NULL column (drift) keeps the drift hint; a column
 * the metadata does not declare at all keeps the column's sentence. Pinned by
 * kind: the sentence is the catalog's `required` sentence for the label (asked
 * of `renderValidationMessage`, the record validator's own renderer), and the
 * hint is judged by what it prescribes.
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

/** The catalog's `required` sentence for `label`, in `locale` — what the record validator renders. */
const requiredSentence = (label: string, field: string, locale?: string) =>
  renderValidationMessage({ messageKey: 'required', label, field, params: {} }, { locale });

/** The envelope the classification answers, with the field's sentence `message`. */
function expectRefusal(door: { status: number; body: any }, field: string, message: string) {
  expect(door.status, JSON.stringify(door.body)).toBe(400);
  expect(door.body).toMatchObject({
    code: 'VALIDATION_FAILED',
    error: message,
    fields: [{ field, code: 'required', message }],
    object: OBJECT,
  });
  // No key is added or dropped, on the body or on the field.
  expect(Object.keys(door.body).sort()).toEqual(['code', 'error', 'fields', 'hint', 'object']);
  expect(Object.keys(door.body.fields[0]).sort()).toEqual(['code', 'field', 'message']);
}

/** The declared column's hint: the value, or the default / hook that supplies it — never `required`, never drift. */
function expectDeclaredNotNullHint(hint: unknown, field: string) {
  const text = String(hint);
  expect(text).toContain(`'${field}'`);
  expect(text).toContain('`storage: { notNull: true }`');
  expect(text).toMatch(/requires a value/);
  expect(text).not.toContain('`required`');
  expect(text).not.toMatch(/drift|os migrate/);
}

describe('[#24715] a declared `storage.notNull` field\'s refusal names its label', () => {
  it('the fixture is the ADR-0113 posture: the validator lets the write through and the database refuses it', async () => {
    const { engine } = await boot();
    expect(AS_SYNCED.fields.unit_price).toMatchObject({ label: 'Sales Price', storage: { notNull: true } });
    expect('required' in AS_SYNCED.fields.unit_price).toBe(false);
    await expect(engine.update(OBJECT, { unit_price: null } as any, { where: { id: 'e1' } } as any)).rejects.toThrow(/not null/i);
  });

  it('PATCH writing null: the label in `error` and `fields[0].message`, the declared column\'s hint', async () => {
    const { patch, stored } = await boot();
    const door = await patch({ unit_price: null });
    expectRefusal(door, 'unit_price', requiredSentence('Sales Price', 'unit_price'));
    expect(door.body.error).not.toContain('unit_price');
    expectDeclaredNotNullHint(door.body.hint, 'unit_price');
    expect((await stored()).unit_price).toBe(5);
  });

  it('POST with no value: the same answer', async () => {
    const { create, engine } = await boot();
    const door = await create({ id: 'n1', name: 'new', list_price: 1, drift_col: 'd' });
    expectRefusal(door, 'unit_price', requiredSentence('Sales Price', 'unit_price'));
    expectDeclaredNotNullHint(door.body.hint, 'unit_price');
    expect(await engine.find(OBJECT, { where: { id: 'n1' } })).toHaveLength(0);
  });
});

describe('[#24715] localized the way the record validator localizes its own `required`', () => {
  it('zh-CN: the translated label in the catalog\'s zh-CN sentence — the validator\'s template, word for word', async () => {
    const { patch, create } = await boot({ locale: 'zh-CN', i18n: true });

    const door = await patch({ unit_price: null });
    expectRefusal(door, 'unit_price', requiredSentence('销售价格', 'unit_price', 'zh-CN'));
    expectDeclaredNotNullHint(door.body.hint, 'unit_price');

    // The validator, on the same request shape, for the field it refuses itself.
    const own = await create({ id: 'n1', name: 'new', unit_price: 1, drift_col: 'd' });
    expect(own.status, JSON.stringify(own.body)).toBe(400);
    const validatorMessage = own.body.fields.find((f: any) => f.field === 'list_price')?.message;
    expect(validatorMessage).toBe(requiredSentence('标价', 'list_price', 'zh-CN'));
    expect(door.body.error.replace('销售价格', 'LABEL')).toBe(validatorMessage.replace('标价', 'LABEL'));
  });

  it('a bare `zh` reaches the zh-CN bundle, as the validator\'s locale negotiation does', async () => {
    const { patch } = await boot({ locale: 'zh', i18n: true });
    const door = await patch({ unit_price: null });
    expectRefusal(door, 'unit_price', requiredSentence('销售价格', 'unit_price', 'zh-CN'));
  });
});

describe('[#24715] the controls: what the field map cannot name keeps today\'s answer', () => {
  it('drift — declared with neither `required` nor `storage.notNull` over a NOT NULL column: the label, and the drift hint', async () => {
    const { patch } = await boot();
    const door = await patch({ drift_col: null });
    expectRefusal(door, 'drift_col', requiredSentence('Drift Column', 'drift_col'));
    expect(String(door.body.hint)).toMatch(/drifted from metadata/);
    expect(String(door.body.hint)).toMatch(/os migrate/);
  });

  it('a column the metadata does not declare: the column\'s sentence and the drift hint', async () => {
    const { create } = await boot();
    const door = await create({ id: 'n1', name: 'new', unit_price: 1, list_price: 1, drift_col: 'd' });
    expectRefusal(door, 'gone_col', 'gone_col is required');
    expect(String(door.body.hint)).toMatch(/os migrate/);
  });
});
