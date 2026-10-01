// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `GET /data/:object/export?template=true` through the REAL route, driven by a
 * REAL {@link ObjectQL} engine + {@link ObjectStackProtocolImplementation} on a
 * better-sqlite3 `:memory:` driver — the stack `export-integration.test.ts`
 * boots. Objects here keep the registry's system fields ON, so the columns the
 * registry injects onto every object are really there to be excluded.
 *
 * Also here: the proof that WITHOUT `?template=true` the export is byte for
 * byte what it was before the mode existed — see the last describe block —
 * and that the template is judged by the IMPORT door's gates, never the
 * export's (#20896 ruling A).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';
import { parseXlsxToRows } from './import-prepare.js';
import { isTemplateRequired, templateInsertDefault } from './import-template.js';
import { loadXlsxWorkbook } from './xlsx-test-loader.js';

function makeSqliteDriver() {
  return new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
}

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  vi.useRealTimers();
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

/** Collects what the handler writes: status, headers, JSON body, binary chunks. */
function makeRes() {
  const chunks: Buffer[] = [];
  const headers: Record<string, string> = {};
  let status = 200;
  let json: any;
  const res: any = {
    write: (c: any) => { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))); return true; },
    end: () => {},
    header: (n: string, v: string) => { headers[n] = v; return res; },
    status: (s: number) => { status = s; return res; },
    json: (b: any) => { json = b; return res; },
  };
  return { res, headers, body: () => Buffer.concat(chunks), status: () => status, json: () => json };
}

// ---------------------------------------------------------------------------
// Objects — registry system fields ON (the default), one field per rule.
// ---------------------------------------------------------------------------

const ACCOUNT = {
  name: 'account', label: '客户',
  fields: { name: { name: 'name', type: 'text', label: 'Account name' } },
};

const LINE = {
  name: 'line', label: 'Line',
  fields: {
    name: { name: 'name', type: 'text' },
    deal: { name: 'deal', type: 'master_detail', reference: 'deal' },
    qty: { name: 'qty', type: 'number' },
  },
};

const DEAL = {
  name: 'deal', label: 'Deal',
  fields: {
    title: { name: 'title', type: 'text', label: 'Title', required: true },
    approval: {
      name: 'approval', type: 'select', label: 'Approval', readonly: true, defaultValue: 'draft',
      options: [{ label: 'Draft', value: 'draft' }, { label: 'Approved', value: 'approved' }],
    },
    stage: {
      name: 'stage', type: 'select', label: 'Stage',
      options: [{ label: 'Open', value: 'open' }, { label: 'Won', value: 'won' }],
    },
    secret_note: { name: 'secret_note', type: 'text', label: 'Hidden note', hidden: true },
    classified: { name: 'classified', type: 'text', label: 'System flagged', system: true },
    amount: { name: 'amount', type: 'currency', label: 'Amount' },
    doubled: { name: 'doubled', type: 'formula', label: 'Doubled', expression: 'amount * 2' },
    total_qty: { name: 'total_qty', type: 'summary', label: 'Total qty', summaryOperations: { object: 'line', field: 'qty', function: 'sum' } },
    code: { name: 'code', type: 'autonumber', label: 'Code', autonumberFormat: 'D-{0000}' },
    hot: { name: 'hot', type: 'boolean', label: 'Hot' },
    tags: {
      name: 'tags', type: 'multiselect', label: 'Tags',
      options: [{ label: 'VIP', value: 'vip' }, { label: 'New', value: 'new' }],
    },
    close_date: { name: 'close_date', type: 'date', label: 'Close date' },
    account: { name: 'account', type: 'lookup', label: 'Account', reference: 'account' },
    salary: { name: 'salary', type: 'number', label: 'Salary' },
  },
};

/** The seven columns the registry injects onto every object (the card's table). */
const INJECTED = ['organization_id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'owner_id', 'owning_business_unit_id'];

/**
 * A security service's `explain` answering "may create" for every object —
 * the caller half of the import door's gates on `?template=true` (#20896).
 */
const MAY_CREATE = async (request: { operation: string }) => ({ allowed: request.operation === 'create' });

interface BootOptions {
  security?: Record<string, unknown>;
}

async function boot(opts: BootOptions = {}) {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(makeSqliteDriver(), true);
  await engine.init();
  for (const o of [ACCOUNT, LINE, DEAL]) engine.registry.registerObject(o as any);
  await engine.syncSchemas();
  await engine.insert('account', { id: 'a1', name: 'Acme' });
  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const findData = vi.spyOn(protocol as any, 'findData');
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user', timezone: 'UTC' });
  if (opts.security) (rest as any).resolveSecurityService = async () => opts.security;
  rest.registerRoutes();
  const route = (method: string, path: string) => rest.getRoutes().find((r: any) => r.method === method && r.path === path)!;
  const exportRoute = route('GET', '/api/v1/data/:object/export');
  const importRoute = route('POST', '/api/v1/data/:object/import');
  const get = async (query: Record<string, unknown>, object = 'deal', headers: Record<string, string> = {}) => {
    const out = makeRes();
    await exportRoute.handler({ params: { object }, query, headers } as any, out.res);
    return out;
  };
  return { engine, protocol, findData, get, importRoute, rest };
}

const headerRow = async (bytes: Buffer, sheet = 0) => {
  const wb = await loadXlsxWorkbook(bytes);
  return { wb, header: (wb.worksheets[sheet].getRow(1).values as unknown[]).slice(1) as string[] };
};

// ---------------------------------------------------------------------------

describe('?template=true — the import template, through the real stack', () => {
  it('answers an xlsx template without reading a single row', async () => {
    const { get, findData } = await boot();
    const out = await get({ template: 'true' });
    expect(out.status()).toBe(200);
    expect(out.headers['Content-Type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(out.headers['X-Export-Template']).toBe('true');
    // No security service composed: no field-level projection applies.
    expect(out.headers['X-Export-Template-Projection']).toBe('none');
    expect(out.headers['Content-Disposition']).toMatch(/^attachment; filename="deal-template-\d{8}-\d{6}\.xlsx"/);
    expect(findData).not.toHaveBeenCalled();
    const { wb } = await headerRow(out.body());
    expect(wb.worksheets[0].actualRowCount).toBe(2); // header + example, zero data rows
  });

  it('none of the registry-injected columns is a template column — on an object that has all seven', async () => {
    const { get, protocol } = await boot();
    const schema: any = (await (protocol as any).getMetaItem({ type: 'object', name: 'deal' })).item;
    for (const f of INJECTED) expect(Object.keys(schema.fields), `${f} is injected`).toContain(f);
    const { header } = await headerRow((await get({ template: 'true' })).body());
    const wb = await loadXlsxWorkbook((await get({ template: 'true' })).body());
    const fieldColumn = (wb.worksheets[1].getColumn(2).values as unknown[]).slice(5).filter(Boolean);
    for (const f of INJECTED) expect(fieldColumn, f).not.toContain(f);
    expect(header).not.toContain('Owner');
  });

  it('keeps exactly the writable declared fields, in declaration order, the required one marked', async () => {
    const { get } = await boot();
    const out = await get({ template: 'true' });
    const { wb, header } = await headerRow(out.body());
    // `secret_note` is `hidden: true` and writable, so it is a column.
    expect(header).toEqual(['Title *', 'Stage', 'Hidden note', 'Amount', 'Hot', 'Tags', 'Close date', 'Account', 'Salary']);
    const fields = (wb.worksheets[1].getColumn(2).values as unknown[]).slice(5, 5 + header.length);
    expect(fields).toEqual(['title', 'stage', 'secret_note', 'amount', 'hot', 'tags', 'close_date', 'account', 'salary']);
  });

  it('the lookup column names its target by the target object\'s label', async () => {
    const { get } = await boot();
    const wb = await loadXlsxWorkbook((await get({ template: 'true' })).body());
    const howToFill = String(wb.worksheets[1].getCell('E12').value);
    expect(wb.worksheets[1].getCell('B12').value).toBe('account');
    expect(howToFill).toContain('客户');
  });

  it('?fields= is honoured as asked', async () => {
    const { get } = await boot();
    const { header } = await headerRow((await get({ template: 'true', fields: 'code,title' })).body());
    expect(header).toEqual(['Code', 'Title *']);
  });

  it('?locale=zh-CN answers the Chinese sheets', async () => {
    const { get } = await boot();
    const wb = await loadXlsxWorkbook((await get({ template: 'true', locale: 'zh-CN' })).body());
    expect(wb.worksheets.map((w) => w.name)).toEqual(['模板', '填写说明']);
  });

  it('an Accept-Language of zh-CN answers the Chinese sheets too', async () => {
    const { get } = await boot();
    const wb = await loadXlsxWorkbook((await get({ template: 'true' }, 'deal', { 'accept-language': 'zh-CN,zh;q=0.9' })).body());
    expect(wb.worksheets.map((w) => w.name)).toEqual(['模板', '填写说明']);
  });

  it('with no locale at all the sheets are English', async () => {
    const { get } = await boot();
    const wb = await loadXlsxWorkbook((await get({ template: 'true' })).body());
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Template', 'Instructions']);
  });

  it('format=xlsx is accepted beside it', async () => {
    const { get } = await boot();
    expect((await get({ template: 'true', format: 'xlsx' })).status()).toBe(200);
  });
});

describe('?template=true — field-level security: the WRITE projection', () => {
  // `salary` is readable and NOT editable for this caller; `amount` is neither.
  const READABLE = ['title', 'stage', 'secret_note', 'hot', 'tags', 'close_date', 'account', 'salary'];
  const WRITABLE = ['title', 'stage', 'secret_note', 'hot', 'tags', 'close_date', 'account'];

  it('a field the caller may read but not edit is absent, and the response names the write projection', async () => {
    const { get } = await boot({
      security: { explain: MAY_CREATE, getReadableFields: async () => READABLE, getWritableFields: async () => WRITABLE },
    });
    const out = await get({ template: 'true' });
    const { wb, header } = await headerRow(out.body());
    expect(header).not.toContain('Salary');
    expect(header).not.toContain('Amount');
    expect(header).toContain('Account');
    expect(out.headers['X-Export-Template-Projection']).toBe('writable');
    expect(wb.worksheets[1].getCell(3, 1).value).toBeNull();
  });

  it('a security service without getWritableFields: narrowed by the read projection, and the response says so', async () => {
    const { get } = await boot({ security: { explain: MAY_CREATE, getReadableFields: async () => READABLE } });
    const out = await get({ template: 'true' });
    const { wb, header } = await headerRow(out.body());
    expect(header).toContain('Salary');
    expect(header).not.toContain('Amount');
    expect(out.headers['X-Export-Template-Projection']).toBe('readable');
    expect(String(wb.worksheets[1].getCell(3, 1).value)).toContain('cannot say which fields you can edit');
  });

  it('a security service that answers neither projection fails the request instead of an unnarrowed header', async () => {
    const { get } = await boot({
      security: { explain: MAY_CREATE, getWritableFields: async () => undefined, getReadableFields: async () => undefined },
    });
    const out = await get({ template: 'true' });
    expect(out.status()).toBe(500);
    expect(out.json()?.error?.code ?? out.json()?.code).toBe('INTERNAL_ERROR');
    expect(out.body().length).toBe(0);
  });
});

describe('?template=true — the IMPORT door\'s gates decide, not the export\'s (#20896 ruling A)', () => {
  // The template carries no records, so it answers to whoever may import:
  // the object's `import` exposure, then the caller's create permission. The
  // export gates (`export` exposure, `canExport`) neither admit nor refuse it.
  const noCreate = async () => ({ allowed: false });

  it('create on the object and no allowExport → 200 and the workbook', async () => {
    const canExport = vi.fn(async () => false);
    const explain = vi.fn(MAY_CREATE);
    const { get } = await boot({ security: { canExport, explain, getWritableFields: async () => ['title', 'stage'] } });
    const out = await get({ template: 'true' });
    expect(out.status()).toBe(200);
    expect(out.headers['Content-Type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(out.headers['X-Export-Template']).toBe('true');
    expect((await headerRow(out.body())).header).toEqual(['Title *', 'Stage']);
    expect(explain).toHaveBeenCalledWith({ object: 'deal', operation: 'create' }, expect.objectContaining({ userId: 'test-user' }));
    expect(canExport).not.toHaveBeenCalled();
  });

  it('no create → 403 PERMISSION_DENIED from the import door, and the template builder is never called', async () => {
    const getWritableFields = vi.fn(async () => ['title']);
    const { get, rest } = await boot({ security: { canExport: async () => false, explain: noCreate, getWritableFields } });
    const builder = vi.spyOn(rest as any, 'answerImportTemplate');
    const out = await get({ template: 'true' });
    expect(out.status()).toBe(403);
    expect(out.json()).toMatchObject({ success: false, error: { code: 'PERMISSION_DENIED', details: { object: 'deal' } } });
    expect(out.body().length).toBe(0);
    expect(builder).not.toHaveBeenCalled();
    expect(getWritableFields).not.toHaveBeenCalled();
  });

  it('allowExport and no create → 403 on template=true — the export permission admits no template', async () => {
    const canExport = vi.fn(async () => true);
    const getWritableFields = vi.fn(async () => ['title']);
    const { get, rest } = await boot({ security: { canExport, explain: noCreate, getWritableFields } });
    const builder = vi.spyOn(rest as any, 'answerImportTemplate');
    const out = await get({ template: 'true' });
    expect(out.status()).toBe(403);
    expect(out.json()).toMatchObject({ success: false, error: { code: 'PERMISSION_DENIED', details: { object: 'deal' } } });
    expect(out.body().length).toBe(0);
    expect(builder).not.toHaveBeenCalled();
    expect(getWritableFields).not.toHaveBeenCalled();
    expect(canExport).not.toHaveBeenCalled();
  });

  it('a create verdict that throws is a denial, never a grant', async () => {
    const { get } = await boot({
      security: { explain: async () => { throw new Error('permission sets did not resolve'); }, getWritableFields: async () => ['title'] },
    });
    const out = await get({ template: 'true' });
    expect(out.status()).toBe(403);
    expect(out.json()?.error?.code).toBe('PERMISSION_DENIED');
    expect(out.body().length).toBe(0);
  });

  it('an object exposing create but not export serves the template — its export exposure no longer stands in front', async () => {
    const { get, engine } = await boot();
    engine.registry.registerObject({
      // `export` is derived from `list`; `import` from `create ∨ update`.
      name: 'intake', label: 'Intake', enable: { apiMethods: ['create'] },
      fields: { title: { name: 'title', type: 'text', label: 'Title' } },
    } as any);
    const out = await get({ template: 'true' }, 'intake');
    expect(out.status()).toBe(200);
    expect((await headerRow(out.body())).header).toEqual(['Title']);
  });

  it('an object exposing export but neither create nor update is refused 405 before the template', async () => {
    const { get, engine, rest } = await boot();
    engine.registry.registerObject({
      name: 'ledger', label: 'Ledger', enable: { apiMethods: ['get', 'list'] },
      fields: { title: { name: 'title', type: 'text' } },
    } as any);
    const builder = vi.spyOn(rest as any, 'answerImportTemplate');
    const out = await get({ template: 'true' }, 'ledger');
    expect(out.status()).toBe(405);
    expect(out.json()).toMatchObject({ code: 'OBJECT_API_METHOD_NOT_ALLOWED' });
    expect(out.body().length).toBe(0);
    expect(builder).not.toHaveBeenCalled();
  });
});

describe('?template= — refusals (nested VALIDATION_ERROR, nothing written)', () => {
  const refused = async (query: Record<string, unknown>) => {
    const { get, findData } = await boot();
    const out = await get(query);
    expect(out.status(), JSON.stringify(query)).toBe(400);
    expect(out.json()?.error?.code).toBe('VALIDATION_ERROR');
    expect(out.body().length).toBe(0);
    expect(findData).not.toHaveBeenCalled();
    return String(out.json()?.error?.message);
  };

  it('a value other than true / false', async () => {
    expect(await refused({ template: 'yes' })).toContain('takes true or false');
  });

  it('a row parameter beside template=true', async () => {
    expect(await refused({ template: 'true', limit: '5' })).toContain('"limit"');
  });

  it('a non-xlsx format beside template=true', async () => {
    expect(await refused({ template: 'true', format: 'csv' })).toContain('format "csv"');
  });

  it('template supplied twice', async () => {
    expect(await refused({ template: ['true', 'true'] })).toContain('template');
  });

  it('an unknown object answers 404, not a template', async () => {
    const { get } = await boot();
    const out = await get({ template: 'true' }, 'no_such_object');
    expect(out.status()).toBe(404);
    expect(out.body().length).toBe(0);
  });
});

describe('?template=true — the template filled in and imported back', () => {
  it('the example row imports through the real import door with no coercion error', async () => {
    const { get, importRoute, engine } = await boot();
    const bytes = (await get({ template: 'true' })).body();
    // What the import reader sees, and the column mapping a client builds
    // from the header (the `*` stripped) — objectui's wizard does the same.
    const rows = await parseXlsxToRows(bytes);
    expect(rows).toHaveLength(1);
    const wb = await loadXlsxWorkbook(bytes);
    const headers = (wb.worksheets[0].getRow(1).values as unknown[]).slice(1) as string[];
    const fields = (wb.worksheets[1].getColumn(2).values as unknown[]).slice(5, 5 + headers.length) as string[];
    const mapping = Object.fromEntries(headers.map((h, i) => [h, fields[i]]));

    const out = makeRes();
    await importRoute.handler({
      params: { object: 'deal' },
      body: { format: 'xlsx', xlsxBase64: bytes.toString('base64'), mapping },
    } as any, out.res);
    const report = out.json();
    const codes = (report?.results ?? []).map((r: any) => r.code).filter(Boolean);
    expect(codes, JSON.stringify(report)).toEqual([]);
    expect(report).toMatchObject({ total: 1, ok: 1, errors: 0, created: 1 });

    const [stored] = await engine.find('deal', {});
    expect(stored).toMatchObject({
      title: 'Sample', stage: 'open', secret_note: 'Sample', amount: 1, hot: true, tags: ['vip', 'new'], salary: 1,
    });
    expect(String(stored.close_date)).toContain('2026-01-31');
  });
});

// ---------------------------------------------------------------------------
// The `*`: starred exactly when the engine refuses a blank
// ---------------------------------------------------------------------------

/** A required select whose option is marked `default: true` — the showcase task's `status` shape. */
const TICKET = {
  name: 'ticket', label: 'Ticket',
  fields: {
    title: { name: 'title', type: 'text', label: 'Title', required: true },
    status: {
      name: 'status', type: 'select', label: 'Status', required: true,
      options: [{ label: 'Backlog', value: 'backlog', default: true }, { label: 'Done', value: 'done' }],
    },
  },
};

/** Import rows through the real door and return the report. */
async function importRows(importRoute: any, object: string, body: Record<string, unknown>) {
  const out = makeRes();
  await importRoute.handler({ params: { object }, body } as any, out.res);
  return out.json();
}

describe('?template=true — a required field the engine fills from its option default', () => {
  it('is not starred, its instructions row says not required, and a blank cell imports to the default', async () => {
    const { get, importRoute, engine } = await boot();
    engine.registry.registerObject(TICKET as any);
    await engine.syncSchemas();

    const bytes = (await get({ template: 'true' }, 'ticket')).body();
    const wb = await loadXlsxWorkbook(bytes);
    const headers = (wb.worksheets[0].getRow(1).values as unknown[]).slice(1) as string[];
    expect(headers).toEqual(['Title *', 'Status']);
    const guide = wb.worksheets[1];
    expect([guide.getCell('A6').value, guide.getCell('B6').value, guide.getCell('D6').value]).toEqual(['Status', 'status', 'No']);
    expect([guide.getCell('A5').value, guide.getCell('D5').value]).toEqual(['Title *', 'Yes']);

    // Fill the template the way a user does: a title, the Status cell left blank.
    const sheet = wb.worksheets[0];
    sheet.getCell('A2').value = 'Blank status';
    sheet.getCell('B2').value = null;
    const filled = Buffer.from(await wb.xlsx.writeBuffer());
    const report = await importRows(importRoute, 'ticket', {
      format: 'xlsx', xlsxBase64: filled.toString('base64'), mapping: { 'Title *': 'title', Status: 'status' },
    });
    expect(report, JSON.stringify(report)).toMatchObject({ total: 1, ok: 1, errors: 0, created: 1 });
    const [stored] = await engine.find('ticket', {});
    expect(stored).toMatchObject({ title: 'Blank status', status: 'backlog' });
  });
});

/**
 * `isTemplateRequired` mirrors the engine's insert-time default
 * (`ObjectQL.applyFieldDefaults` + `resolveOptionDefault`, both private, so
 * the template cannot call them). This battery holds the mirror to the engine:
 * for every shape, the template's own header is starred exactly when the real
 * import door refuses a blank cell, and a filled blank stores the default the
 * mirror predicts.
 */
const OPTS = [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }, { label: 'C', value: 'c' }];
const mark = (...values: string[]) => OPTS.map((o) => (values.includes(o.value) ? { ...o, default: true } : o));

const PARITY: Record<string, { def: Record<string, unknown>; blank: 'refused' | 'accepted'; stored?: unknown }> = {
  plain: { def: { type: 'text' }, blank: 'refused' },
  default_value: { def: { type: 'text', defaultValue: 'x' }, blank: 'accepted', stored: 'x' },
  default_value_false: { def: { type: 'boolean', defaultValue: false }, blank: 'accepted', stored: false },
  option_default: { def: { type: 'select', options: mark('b') }, blank: 'accepted', stored: 'b' },
  option_default_first_wins: { def: { type: 'select', options: mark('a', 'c') }, blank: 'accepted', stored: 'a' },
  option_default_multiselect: { def: { type: 'multiselect', options: mark('a', 'c') }, blank: 'accepted', stored: ['a', 'c'] },
  option_default_select_multiple: { def: { type: 'select', multiple: true, options: mark('b') }, blank: 'accepted', stored: ['b'] },
  option_default_any_type: { def: { type: 'text', options: [{ label: 'X', value: 'x', default: true }] }, blank: 'accepted', stored: 'x' },
  no_marked_option: { def: { type: 'select', options: OPTS }, blank: 'refused' },
  marked_option_without_value: { def: { type: 'select', options: [{ label: 'A', default: true }, { label: 'B', value: 'b' }] }, blank: 'refused' },
  non_canonical_flag: { def: { type: 'select', options: OPTS.map((o) => ({ ...o, default: 'true' })) }, blank: 'refused' },
  default_value_null: { def: { type: 'text', defaultValue: null }, blank: 'refused' },
  default_value_null_option_default: { def: { type: 'select', defaultValue: null, options: mark('c') }, blank: 'accepted', stored: 'c' },
  default_value_beats_option: { def: { type: 'select', defaultValue: 'a', options: mark('b') }, blank: 'accepted', stored: 'a' },
  default_value_empty_string: { def: { type: 'text', defaultValue: '' }, blank: 'refused' },
  default_value_empty_array: { def: { type: 'multiselect', defaultValue: [], options: mark('a') }, blank: 'refused' },
  readonly: { def: { type: 'text', readonly: true }, blank: 'accepted' },
  system: { def: { type: 'text', system: true }, blank: 'accepted' },
  autonumber: { def: { type: 'autonumber', autonumberFormat: 'N-{0000}' }, blank: 'accepted' },
};

describe('the `*` agrees with the engine: starred exactly when the import door refuses a blank', () => {
  it('for every shape of default the engine reads', async () => {
    const { get, importRoute, engine } = await boot();
    const objectOf = (key: string) => `pty_${key}`;
    for (const [key, { def }] of Object.entries(PARITY)) {
      engine.registry.registerObject({
        name: objectOf(key), label: key,
        fields: { title: { name: 'title', type: 'text' }, f: { name: 'f', label: 'F', required: true, ...def } },
      } as any);
    }
    await engine.syncSchemas();

    const disagreements: string[] = [];
    for (const [key, { def, blank, stored }] of Object.entries(PARITY)) {
      const object = objectOf(key);
      // The template's own verdict — its header, via `?fields=` so every shape is a column.
      const wb = await loadXlsxWorkbook((await get({ template: 'true', fields: 'f' }, object)).body());
      const starred = wb.worksheets[0].getCell('A1').value === 'F *';
      expect(wb.worksheets[1].getCell('D5').value, key).toBe(starred ? 'Yes' : 'No');
      expect(isTemplateRequired({ required: true, ...def }), key).toBe(starred);

      // The engine's verdict — a blank cell through the real import door.
      const report = await importRows(importRoute, object, { format: 'json', rows: [{ title: key, f: '' }] });
      const refused = report?.errors === 1;
      if (refused) expect(report.results?.[0], key).toMatchObject({ ok: false, field: 'f', code: 'required' });
      else expect(report, `${key}: ${JSON.stringify(report)}`).toMatchObject({ ok: 1, errors: 0, created: 1 });

      if (starred !== refused) disagreements.push(`${key}: template ${starred ? 'starred' : 'unstarred'}, engine ${refused ? 'refused' : 'accepted'} the blank`);
      expect(refused ? 'refused' : 'accepted', key).toBe(blank);
      if (!refused && stored !== undefined) {
        const [row] = await engine.find(object, {});
        expect(row?.f, key).toEqual(stored);
        expect(templateInsertDefault({ required: true, ...def }), key).toEqual(stored);
      }
    }
    expect(disagreements).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Without ?template=true: byte for byte the pre-change output
// ---------------------------------------------------------------------------

/**
 * The export's output BEFORE `?template=` existed, captured by running these
 * same eight requests against these same fixtures on `origin/main` at
 * 6bff748bbd (the branch point), with `Date` frozen at the instant below and
 * the business timezone resolved to UTC — which makes every byte, the xlsx zip
 * and the `Content-Disposition` stamp included, reproducible on any host
 * (measured identical under TZ=Asia/Shanghai and TZ=America/New_York).
 * `bytes` + `sha256` cover the whole body; the text bodies are also kept
 * verbatim so a difference reads as a diff.
 */
const FROZEN_NOW = '2026-09-29T12:34:56.000Z';
const STAMP = '20260929-123456';
const disposition = (ext: string) => `attachment; filename="task-${STAMP}.${ext}"; filename*=UTF-8''Task-${STAMP}.${ext}`;
const headersFor = (ext: string, contentType: string, limit: string, styles?: string) => ({
  'Content-Type': contentType,
  'Content-Disposition': disposition(ext),
  'X-Export-Format': ext,
  'X-Export-Limit': limit,
  ...(styles ? { 'X-Export-Styles': styles } : {}),
  'Cache-Control': 'no-store',
});
const CSV = 'text/csv; charset=utf-8';
const JSON_TYPE = 'application/json; charset=utf-8';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const PRE_CHANGE: Record<string, {
  query: Record<string, string>;
  headers: Record<string, string>;
  sha256: string;
  bytes: number;
  text?: string;
}> = {
  csvDefault: {
    query: {},
    headers: headersFor('csv', CSV, '10000'),
    sha256: '26d251901ffc998b0c8b6b8bcc866cb5fbfa3a187c80eb396151fa5eb1ffe31e',
    bytes: 123,
    text: 'ID,标题,完成,优先级,截止,负责人\r\n1,写代码,是,高,2026-06-30,张三\r\n2,写文档,否,低,2026-07-01,李四\r\n',
  },
  json: {
    query: { format: 'json' },
    headers: headersFor('json', JSON_TYPE, '10000'),
    sha256: '6bb52c02c92995b7a80767a6aae481a0ede2cf57acf01f945cbab24f6cbbfc91',
    bytes: 355,
    text: '[{"id":"1","created_at":"2026-09-29T12:34:56.000Z","updated_at":"2026-09-29T12:34:56.000Z","title":"写代码","done":"是","priority":"高","due":"2026-06-30","owner":"张三"},{"id":"2","created_at":"2026-09-29T12:34:56.000Z","updated_at":"2026-09-29T12:34:56.000Z","title":"写文档","done":"否","priority":"低","due":"2026-07-01","owner":"李四"}]',
  },
  xlsxStyled: {
    query: { format: 'xlsx' },
    headers: headersFor('xlsx', XLSX, '10000', 'applied'),
    sha256: '4f90c3cc545cad6f21f2df21eed705ac9e12fce6122fc0795ddad1d5203d9eaa',
    bytes: 6206,
  },
  xlsxUnstyled: {
    query: { format: 'xlsx', limit: '20000' },
    headers: headersFor('xlsx', XLSX, '20000', 'dropped'),
    sha256: 'ed02f9dfba285b0a16a11f079c51b790839f578de11830e5b14b2e5ca9d03315',
    bytes: 6137,
  },
  csvFields: {
    query: { format: 'csv', fields: 'title,owner' },
    headers: headersFor('csv', CSV, '10000'),
    sha256: '62cd186863bc41e298199695f8d9405a52c974b4b49bce5776ca3176c7ae5321',
    bytes: 54,
    text: '标题,负责人\r\n写代码,张三\r\n写文档,李四\r\n',
  },
  csvNoHeader: {
    query: { format: 'csv', header: 'false' },
    headers: headersFor('csv', CSV, '10000'),
    sha256: '7f8f78c0d4847c0dfe9e09bdb48fe6985bcd8d10468119c257fe36b2c996793b',
    bytes: 78,
    text: '1,写代码,是,高,2026-06-30,张三\r\n2,写文档,否,低,2026-07-01,李四\r\n',
  },
  csvEmptyNoProjection: {
    query: { format: 'csv', filter: '{"title":"nope"}' },
    headers: headersFor('csv', CSV, '10000'),
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    bytes: 0,
    text: '',
  },
  xlsxEmptyExplicitFields: {
    query: { format: 'xlsx', fields: 'id,title', filter: '{"title":"nope"}' },
    headers: headersFor('xlsx', XLSX, '10000', 'applied'),
    sha256: '8bcba0e24aa4e17c410831c7ed31041bc94b4075bbe511dbefde5e17f4709c3b',
    bytes: 5934,
  },
};

/**
 * `export-integration.test.ts`'s fixtures: `systemFields: false`, two rows. An
 * optional security service is composed the way `boot` composes one.
 */
async function bootExportFixture(security?: Record<string, unknown>) {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(makeSqliteDriver(), true);
  await engine.init();
  engine.registry.registerObject({
    name: 'user', label: 'User', systemFields: false,
    fields: { id: { name: 'id', type: 'text', primaryKey: true }, name: { name: 'name', type: 'text', label: '姓名' } },
  } as any);
  engine.registry.registerObject({
    name: 'task', label: 'Task', systemFields: false,
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true, label: 'ID' },
      title: { name: 'title', type: 'text', label: '标题' },
      done: { name: 'done', type: 'boolean', label: '完成' },
      priority: {
        name: 'priority', type: 'select', label: '优先级',
        options: [{ label: '高', value: 'high', color: '#e11d48' }, { label: '低', value: 'low', color: '#3ab' }],
      },
      due: { name: 'due', type: 'date', label: '截止' },
      owner: { name: 'owner', type: 'lookup', label: '负责人', reference: 'user', displayField: 'name' },
    },
  } as any);
  await engine.syncSchemas();
  await engine.insert('user', { id: 'u1', name: '张三' });
  await engine.insert('user', { id: 'u2', name: '李四' });
  await engine.insert('task', { id: '1', title: '写代码', done: true, priority: 'high', due: '2026-06-30T00:00:00.000Z', owner: 'u1' });
  await engine.insert('task', { id: '2', title: '写文档', done: false, priority: 'low', due: '2026-07-01T00:00:00.000Z', owner: 'u2' });
  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const findData = vi.spyOn(protocol as any, 'findData');
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user', timezone: 'UTC' });
  if (security) (rest as any).resolveSecurityService = async () => security;
  rest.registerRoutes();
  const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object/export')!;
  return { route, findData };
}

async function exportOnce(query: Record<string, string>, security?: Record<string, unknown>) {
  vi.useFakeTimers({ now: new Date(FROZEN_NOW), toFake: ['Date'] });
  try {
    const { route, findData } = await bootExportFixture(security);
    const out = makeRes();
    await route.handler({ params: { object: 'task' }, query } as any, out.res);
    return { ...out, findData };
  } finally {
    vi.useRealTimers();
  }
}

describe('without ?template=true the export is byte-identical to the pre-change output', () => {
  for (const [name, expected] of Object.entries(PRE_CHANGE)) {
    it(`${name}: ${JSON.stringify(expected.query)}`, async () => {
      const out = await exportOnce(expected.query);
      const body = out.body();
      expect(out.status()).toBe(200);
      expect(out.headers).toEqual(expected.headers);
      if (expected.text !== undefined) expect(body.toString('utf8')).toBe(expected.text);
      expect(body.length).toBe(expected.bytes);
      expect(createHash('sha256').update(body).digest('hex')).toBe(expected.sha256);
    });
  }

  it('template=false is the export itself, byte for byte', async () => {
    const plain = await exportOnce({});
    const off = await exportOnce({ template: 'false' });
    expect(off.status()).toBe(200);
    expect(off.headers).toEqual(plain.headers);
    expect(off.body().equals(plain.body())).toBe(true);
    expect(off.body().toString('utf8')).toBe(PRE_CHANGE.csvDefault.text);
  });

  // [#20896] The template's gate swap reaches no export request: the export
  // is still judged by `canExport`, and the create verdict is never asked.
  it('without allowExport: 403 EXPORT_NOT_PERMITTED before a row is read, whatever the caller may create', async () => {
    const explain = vi.fn(MAY_CREATE);
    const out = await exportOnce({}, { canExport: async () => false, explain });
    expect(out.status()).toBe(403);
    expect(out.json()).toMatchObject({ code: 'EXPORT_NOT_PERMITTED', object: 'task' });
    expect(out.body().length).toBe(0);
    expect(out.findData).not.toHaveBeenCalled();
    expect(explain).not.toHaveBeenCalled();
  });

  it('with allowExport and without create: the pre-change bytes, the create verdict never asked', async () => {
    const explain = vi.fn(async () => ({ allowed: false }));
    const out = await exportOnce({}, { canExport: async () => true, explain });
    const body = out.body();
    expect(out.status()).toBe(200);
    expect(out.headers).toEqual(PRE_CHANGE.csvDefault.headers);
    expect(body.toString('utf8')).toBe(PRE_CHANGE.csvDefault.text);
    expect(createHash('sha256').update(body).digest('hex')).toBe(PRE_CHANGE.csvDefault.sha256);
    expect(explain).not.toHaveBeenCalled();
  });
});
