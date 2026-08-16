// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * End-to-end export integration: the REAL streaming export route driven by a
 * REAL {@link ObjectQL} engine + {@link ObjectStackProtocolImplementation},
 * a REAL sqlite `:memory:` driver, and real registered objects — no protocol
 * mocks and, since #5704 批次 3 / #5785, no hand-written storage either.
 *
 * This is the test the mocked `rest.test.ts` export suite could not be: those
 * stubbed `getObjectSchema` (a method with no real implementation) and pre-shaped
 * `findData` to return `{ data }` with an already-`$expand`-ed `owner`. That
 * green masked three production bugs:
 *   1. the route called the dead `getObjectSchema` hook → no field metadata in
 *      production → zero formatting;
 *   2. `buildFieldMetaMap` only understood the array `fields` shape, not the
 *      object-map the engine registry actually serves;
 *   3. the route read `result.data`, but real `findData` returns `{ records }`
 *      → every production export streamed ZERO rows (an empty file).
 *
 * Here the readable cells (完成→是, 优先级→高, 负责人→张三) are produced by the
 * real metadata accessor (`getMetaItem`) and a real `$expand` that resolves the
 * lookup id `u1` to its record — exactly the path a deployed server runs.
 *
 * Backend note (#5704 批次 3 / #5785): the store was a hand-written Map with a
 * hand-written `matches()` / `sortRows()` until this file moved to
 * `@objectstack/driver-sql` + better-sqlite3 `:memory:`. The stub's own comments
 * record how narrow that ledge was — it had to learn `$or`/`$and` after
 * "skipping them silently returned every row", and `$contains` after a search
 * predicate turned out to be a no-op that still passed an "it filtered"
 * assertion. Every one of those is a class of bug a fixture matcher can have and
 * the production engine cannot; filter, sort, paging and `$expand` are now
 * compiled to SQL by the driver the deployed server uses.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import ExcelJS from 'exceljs';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { maskFieldValue } from '@objectstack/plugin-security';
import { RestServer } from './rest-server';

// ---------------------------------------------------------------------------
// The real backend: better-sqlite3 `:memory:`, constructed the canonical way
// (`examples/app-crm`, `cli db clean`, PR #5715's `makeDefaultDriver()`).
// ---------------------------------------------------------------------------
function makeSqliteDriver() {
  return new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
}

/** Engines booted by this file, torn down (and their `:memory:` DBs closed) per test. */
const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

// ---------------------------------------------------------------------------
// Objects — object-map `fields` (the engine's real shape), mixed value types.
// systemFields:false keeps the column set deterministic (just our fields).
// ---------------------------------------------------------------------------
const USER = {
  name: 'user',
  label: 'User',
  systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const, label: '姓名' },
  },
};

const TASK = {
  name: 'task',
  label: 'Task',
  systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
    title: { name: 'title', type: 'text' as const, label: '标题' },
    done: { name: 'done', type: 'boolean' as const, label: '完成' },
    priority: {
      name: 'priority', type: 'select' as const, label: '优先级',
      // `color` drives the xlsx font colour; '#3ab' exercises the 3-digit path.
      options: [{ label: '高', value: 'high', color: '#e11d48' }, { label: '低', value: 'low', color: '#3ab' }],
    },
    due: { name: 'due', type: 'date' as const, label: '截止' },
    owner: { name: 'owner', type: 'lookup' as const, label: '负责人', reference: 'user', displayField: 'name' },
  },
};

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  let status = 200;
  const res: any = {
    write: (s: string) => { chunks.push(typeof s === 'string' ? s : String(s)); return true; },
    end: () => {},
    header: (n: string, v: string) => { headers[n] = v; return res; },
    status: (code: number) => { status = code; return res; },
    json: (body: any) => { (res as any)._json = body; return res; },
  };
  return { res, chunks, headers, getStatus: () => status, getJson: () => (res as any)._json };
}

function makeBinRes() {
  const chunks: Buffer[] = [];
  const headers: Record<string, string> = {};
  const res: any = {
    write: (c: any) => { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); return true; },
    end: () => {},
    header: (n: string, v: string) => { headers[n] = v; return res; },
    status: () => res,
    json: () => res,
  };
  return { res, getBuffer: () => Buffer.concat(chunks), headers };
}

async function boot() {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(makeSqliteDriver(), true);
  await engine.init();
  engine.registry.registerObject(USER as any);
  engine.registry.registerObject(TASK as any);
  // Real DDL through the real path — `user` and `task` are physical tables
  // before a single row is written.
  await engine.syncSchemas();
  await engine.insert('user', { id: 'u1', name: '张三' });
  await engine.insert('user', { id: 'u2', name: '李四' });
  // owner stored as a bare id — the readable name must come from a real $expand.
  await engine.insert('task', { id: '1', title: '写代码', done: true, priority: 'high', due: '2026-06-30T00:00:00.000Z', owner: 'u1' });
  await engine.insert('task', { id: '2', title: '写文档', done: false, priority: 'low', due: '2026-07-01T00:00:00.000Z', owner: 'u2' });

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const route = rest.getRoutes().find(
    (r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object/export',
  );
  return { engine, protocol, route };
}

function parseCsv(text: string): string[][] {
  return text.split('\r\n').filter((l) => l.length > 0).map((l) => l.split(','));
}

describe('export route — real engine + protocol integration', () => {
  let route: any;
  let protocol: any;

  beforeEach(async () => {
    ({ route, protocol } = await boot());
    expect(route).toBeDefined();
  });

  it('the real metadata accessor returns the task object schema', async () => {
    // Probe: proves getMetaItem (registry-first) sees a registerObject'd object,
    // i.e. the accessor the route now relies on actually resolves in production.
    const res = await protocol.getMetaItem({ type: 'object', name: 'task' });
    const schema = res && typeof res === 'object' && 'item' in res ? (res as any).item : res;
    expect(schema).toBeTruthy();
    expect(schema.fields).toBeTruthy();
    expect(schema.fields.done?.type).toBe('boolean');
    expect(schema.fields.owner?.reference).toBe('user');
  });

  it('CSV: formats every value type readably; owner name comes from a REAL $expand', async () => {
    const { res, chunks, headers } = makeRes();
    await route.handler({ params: { object: 'task' }, query: { format: 'csv' } } as any, res);

    expect(headers['Content-Type']).toBe('text/csv; charset=utf-8');
    const rows = parseCsv(chunks.join(''));
    // Header from schema labels; column order from schema field order.
    expect(rows[0]).toEqual(['ID', '标题', '完成', '优先级', '截止', '负责人']);
    // boolean→是, select→高, date→YYYY-MM-DD, lookup id u1 → 张三 (via $expand).
    expect(rows[1]).toEqual(['1', '写代码', '是', '高', '2026-06-30', '张三']);
    expect(rows[2]).toEqual(['2', '写文档', '否', '低', '2026-07-01', '李四']);
  });

  it('CSV: is NON-EMPTY — regression for the findData `.records` vs `.data` bug', async () => {
    const { res, chunks } = makeRes();
    await route.handler({ params: { object: 'task' }, query: { format: 'csv' } } as any, res);
    const dataRows = parseCsv(chunks.join('')).slice(1); // drop header
    // The mocked suite returned `{ data }`; real findData returns `{ records }`.
    // If the route only read `.data`, this would be 0 — an empty production file.
    expect(dataRows.length).toBe(2);
  });

  it('XLSX: opens as a real workbook with formatted cells', async () => {
    const { res, getBuffer, headers } = makeBinRes();
    await route.handler({ params: { object: 'task' }, query: { format: 'xlsx' } } as any, res);

    expect(headers['Content-Type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(getBuffer() as any);
    const ws = wb.worksheets[0];
    const header = (ws.getRow(1).values as any[]).slice(1).map((v) => String(v));
    expect(header).toEqual(['ID', '标题', '完成', '优先级', '截止', '负责人']);
    const r1 = (ws.getRow(2).values as any[]).slice(1).map((v) => String(v));
    expect(r1).toEqual(['1', '写代码', '是', '高', '2026-06-30', '张三']);
  });

  it('XLSX: select cells get the option colour as font colour; header signals applied', async () => {
    const { res, getBuffer, headers } = makeBinRes();
    await route.handler({ params: { object: 'task' }, query: { format: 'xlsx' } } as any, res);

    // Default limit (10000) is within the style cap, so colours are applied.
    expect(headers['X-Export-Styles']).toBe('applied');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(getBuffer() as any);
    const ws = wb.worksheets[0];
    // priority is column 4 (ID, 标题, 完成, 优先级, ...).
    const highCell = ws.getRow(2).getCell(4); // '高' → #e11d48
    const lowCell = ws.getRow(3).getCell(4);  // '低' → #3ab (shorthand)
    expect((highCell.font?.color as any)?.argb).toBe('FFE11D48');
    expect((lowCell.font?.color as any)?.argb).toBe('FF33AABB');
    // A non-option cell (title) stays unstyled.
    expect(ws.getRow(2).getCell(2).font?.color).toBeUndefined();
  });

  it('XLSX: exceeding the style cap drops styling but keeps all rows', async () => {
    const { res, getBuffer, headers } = makeBinRes();
    await route.handler(
      { params: { object: 'task' }, query: { format: 'xlsx', limit: '20000' } } as any,
      res,
    );

    expect(headers['X-Export-Styles']).toBe('dropped');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(getBuffer() as any);
    const ws = wb.worksheets[0];
    // Data is intact...
    const r1 = (ws.getRow(2).values as any[]).slice(1).map((v) => String(v));
    expect(r1).toEqual(['1', '写代码', '是', '高', '2026-06-30', '张三']);
    // ...but the select cell carries no font colour.
    expect(ws.getRow(2).getCell(4).font?.color).toBeUndefined();
  });

  it('JSON: readable values, all rows present', async () => {
    const { res, chunks, headers } = makeRes();
    await route.handler({ params: { object: 'task' }, query: { format: 'json' } } as any, res);

    expect(headers['Content-Type']).toBe('application/json; charset=utf-8');
    const arr = JSON.parse(chunks.join(''));
    expect(arr).toHaveLength(2);
    expect(arr[0]).toMatchObject({ title: '写代码', done: '是', priority: '高', due: '2026-06-30', owner: '张三' });
  });

  it('filter + orderby are plumbed to the engine (only done=true, desc by id)', async () => {
    const { res, chunks } = makeRes();
    await route.handler({
      params: { object: 'task' },
      query: { format: 'csv', filter: JSON.stringify({ done: true }), orderby: 'id:desc' },
    } as any, res);

    const dataRows = parseCsv(chunks.join('')).slice(1);
    // Only the done=true task survives the filter.
    expect(dataRows.map((r) => r[0])).toEqual(['1']);
    expect(dataRows[0][2]).toBe('是');
  });
});

// ===========================================================================
// #3391 blocking test: export column projection ≡ list's field-level security.
// The derivation contract opens export from `list`, so export MUST NOT expose a
// wider column set than list. The read middleware DELETES unreadable keys, so a
// schema-derived export header would otherwise leak the *names* of FLS-hidden
// columns as empty cells. These two tests are the "阻塞性测试" — they fail
// (red) against the pre-#3391 header (= full schema) and pass after the fix.
// ===========================================================================
describe('export route — FLS column projection (#3391 blocking)', () => {
  // Simulate field-level security with the exact delete-key semantics the
  // security FieldMasker uses: strip `title` from every task row on read.
  const maskTitle = (engine: any) =>
    engine.registerHook(
      'afterFind',
      (ctx: any) => { if (Array.isArray(ctx.result)) for (const r of ctx.result) { if (r) delete r.title; } },
      { object: 'task' },
    );

  it('schema-derived header is narrowed to the masked-readable column set (CSV + JSON)', async () => {
    const { engine, protocol, route } = await boot();
    maskTitle(engine);

    // The list key set under the SAME read path (afterFind runs on find too).
    const listRes: any = await protocol.findData({ object: 'task', query: {} });
    const listRows: any[] = listRes.records ?? listRes.data ?? [];
    const listKeys = new Set<string>();
    for (const r of listRows) for (const k of Object.keys(r)) listKeys.add(k);
    expect(listKeys.has('title')).toBe(false); // masked out of list too

    // CSV: the masked column's header (标题) must be gone — no empty leak column.
    const csv = makeRes();
    await route.handler({ params: { object: 'task' }, query: { format: 'csv' } } as any, csv.res);
    const header = parseCsv(csv.chunks.join(''))[0];
    expect(header).not.toContain('标题');
    expect(header).toEqual(['ID', '完成', '优先级', '截止', '负责人']);

    // JSON: every exported row's key set ⊆ the list key set; title never present.
    const json = makeRes();
    await route.handler({ params: { object: 'task' }, query: { format: 'json' } } as any, json.res);
    const arr = JSON.parse(json.chunks.join(''));
    expect(arr.length).toBe(2);
    for (const row of arr) {
      for (const k of Object.keys(row)) expect(listKeys.has(k)).toBe(true);
      expect('title' in row).toBe(false);
    }
  });

  it('explicit ?fields= keeps a requested masked column but never emits its value', async () => {
    const { engine, route } = await boot();
    maskTitle(engine);

    // An explicit request is honored (projection does NOT narrow it), but the
    // masked value must always render as an empty cell — same as list `$select`.
    const csv = makeRes();
    await route.handler(
      { params: { object: 'task' }, query: { format: 'csv', fields: 'id,title' } } as any,
      csv.res,
    );
    const rows = parseCsv(csv.chunks.join(''));
    expect(rows[0]).toEqual(['ID', '标题']); // header kept as requested
    for (const r of rows.slice(1)) {
      expect(r[0]).not.toBe('');    // id present
      expect(r[1] ?? '').toBe('');  // title masked → always empty, never a value
    }
  });
});

// ===========================================================================
// #3547: export column projection via the security service's getReadableFields
// — the LONG-TERM correct path that replaces inferring readability from masked
// data rows (#3498). The route asks `security.getReadableFields(object, ctx)`
// for the readable column set BEFORE streaming, so the header is derived from
// the schema + context, never from row content — immune to an all-null
// readable column and to an empty result set.
// ===========================================================================
describe('export route — FLS column projection via getReadableFields (#3547)', () => {
  // Boot a real engine + protocol, seed tasks, and wire a RestServer whose
  // `security` service (host provider) resolves to the supplied
  // getReadableFields — mirroring how plugin-security registers the service.
  async function bootWithSecurity(opts: {
    getReadableFields: (object: string, context?: any) => string[] | undefined;
    tasks?: Array<Record<string, unknown>>;
  }) {
    const engine = new ObjectQL();
    liveEngines.push(engine);
    engine.registerDriver(makeSqliteDriver(), true);
    await engine.init();
    engine.registry.registerObject(USER as any);
    engine.registry.registerObject(TASK as any);
    await engine.syncSchemas();
    await engine.insert('user', { id: 'u1', name: '张三' });
    const tasks = opts.tasks ?? [
      { id: '1', title: '写代码', done: true, priority: 'high', due: '2026-06-30T00:00:00.000Z', owner: 'u1' },
      { id: '2', title: '写文档', done: false, priority: 'low', due: '2026-07-01T00:00:00.000Z', owner: 'u1' },
    ];
    for (const t of tasks) await engine.insert('task', t);
    const protocol = new ObjectStackProtocolImplementation(engine as any);
    // 16th positional ctor arg is `securityServiceProvider`.
    const securityServiceProvider = async () => ({ getReadableFields: opts.getReadableFields });
    const rest = new RestServer(
      createMockServer() as any,
      protocol as any,
      { api: { requireAuth: false } } as any,
      undefined, // kernelManager
      undefined, // envRegistry
      undefined, // defaultEnvironmentIdProvider
      undefined, // authServiceProvider
      undefined, // objectQLProvider
      undefined, // emailServiceProvider
      undefined, // sharingServiceProvider
      undefined, // reportsServiceProvider
      undefined, // approvalsServiceProvider
      undefined, // sharingRulesServiceProvider
      undefined, // i18nServiceProvider
      undefined, // analyticsServiceProvider
      undefined, // settingsServiceProvider
      undefined, // serviceExistsProvider
      securityServiceProvider,
    );
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
    const route = rest.getRoutes().find(
      (r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object/export',
    );
    return { engine, route };
  }

  it('projects columns from getReadableFields — drops a masked field even though rows still carry it', async () => {
    // The service says `title` is NOT readable; every row still HAS a title
    // value. The route must drop 标题 from the header — proving the projection
    // comes from the service, not the row keys (the masked-row inference would
    // have kept 标题 because it is present in the rows).
    const { route } = await bootWithSecurity({
      getReadableFields: () => ['id', 'done', 'priority', 'due', 'owner'],
    });
    const csv = makeRes();
    await route.handler({ params: { object: 'task' }, query: { format: 'csv' } } as any, csv.res);
    const header = parseCsv(csv.chunks.join(''))[0];
    expect(header).not.toContain('标题');
    expect(header).toEqual(['ID', '完成', '优先级', '截止', '负责人']);
  });

  it('keeps a readable column that is absent from every row (null-value immunity)', async () => {
    // All tasks omit `due` → the masked-row inference would DROP 截止 from the
    // header (no row carries the key). getReadableFields lists it, so the
    // column survives — the header no longer depends on row content.
    const { route } = await bootWithSecurity({
      getReadableFields: () => ['id', 'title', 'done', 'priority', 'due', 'owner'],
      tasks: [
        { id: '1', title: 'A', done: true, priority: 'high', owner: 'u1' }, // no `due`
        { id: '2', title: 'B', done: false, priority: 'low', owner: 'u1' }, // no `due`
      ],
    });
    const csv = makeRes();
    await route.handler({ params: { object: 'task' }, query: { format: 'csv' } } as any, csv.res);
    const header = parseCsv(csv.chunks.join(''))[0];
    expect(header).toContain('截止'); // survives despite being absent from every row
    expect(header).toEqual(['ID', '标题', '完成', '优先级', '截止', '负责人']);
  });

  it('explicit ?fields= is still honored verbatim (service projection only narrows schema-derived headers)', async () => {
    // getReadableFields would drop `title`, but an explicit request wins — the
    // projection only applies to schema-derived headers (fieldsFromSchema).
    const { route } = await bootWithSecurity({
      getReadableFields: () => ['id', 'done'],
    });
    const csv = makeRes();
    await route.handler(
      { params: { object: 'task' }, query: { format: 'csv', fields: 'id,title' } } as any,
      csv.res,
    );
    const header = parseCsv(csv.chunks.join(''))[0];
    expect(header).toEqual(['ID', '标题']); // requested columns kept as asked
  });

  // -------------------------------------------------------------------------
  // Empty result sets. "Export columns don't depend on row content" is only
  // true if it also holds at ZERO rows — the case the masked-row inference
  // (#3498) could never serve, because it had no rows to narrow with.
  // -------------------------------------------------------------------------

  it('empty result set: still emits the projected header (an exact, row-independent column set)', async () => {
    // No rows at all. The service knows the readable columns from schema +
    // context, so the export carries the precise header — and an empty export
    // becomes a usable import template instead of a zero-byte file.
    const { route } = await bootWithSecurity({
      getReadableFields: () => ['id', 'done', 'priority', 'due', 'owner'],
      tasks: [],
    });
    const csv = makeRes();
    await route.handler({ params: { object: 'task' }, query: { format: 'csv' } } as any, csv.res);
    const rows = parseCsv(csv.chunks.join(''));
    expect(rows).toHaveLength(1); // header only, no data rows
    expect(rows[0]).toEqual(['ID', '完成', '优先级', '截止', '负责人']);
    expect(rows[0]).not.toContain('标题'); // the masked column stays out
  });

  it('empty result set with NO projection available: stays headerless (never names FLS-hidden columns)', async () => {
    // getReadableFields → undefined (schema unresolvable, or no security service
    // at all) → the route falls back to masked-row inference, which has no rows.
    // Writing the full schema header HERE would leak the names of FLS-hidden
    // columns — the very leak #3391 closes — so the empty file stays headerless.
    const { route } = await bootWithSecurity({
      getReadableFields: () => undefined,
      tasks: [],
    });
    const csv = makeRes();
    await route.handler({ params: { object: 'task' }, query: { format: 'csv' } } as any, csv.res);
    expect(csv.chunks.join('')).toBe('');
  });

  it('empty result set + explicit ?fields=: the requested header is echoed back', async () => {
    // An explicit request is authoritative for the same reason the projection is:
    // the caller named the columns, so nothing new is disclosed by echoing them.
    const { route } = await bootWithSecurity({
      getReadableFields: () => ['id'],
      tasks: [],
    });
    const csv = makeRes();
    await route.handler(
      { params: { object: 'task' }, query: { format: 'csv', fields: 'id,title' } } as any,
      csv.res,
    );
    expect(parseCsv(csv.chunks.join(''))).toEqual([['ID', '标题']]);
  });

  it('empty result set + header=false: no header, as asked', async () => {
    const { route } = await bootWithSecurity({
      getReadableFields: () => ['id', 'done'],
      tasks: [],
    });
    const csv = makeRes();
    await route.handler(
      { params: { object: 'task' }, query: { format: 'csv', header: 'false' } } as any,
      csv.res,
    );
    expect(csv.chunks.join('')).toBe('');
  });

  it('xlsx: an empty result set carries the projected header row', async () => {
    const { route } = await bootWithSecurity({
      getReadableFields: () => ['id', 'done'],
      tasks: [],
    });
    const { res, getBuffer } = makeBinRes();
    await route.handler({ params: { object: 'task' }, query: { format: 'xlsx' } } as any, res);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(getBuffer() as any);
    const ws = wb.worksheets[0];
    expect((ws.getRow(1).values as any[]).slice(1)).toEqual(['ID', '完成']);
    expect(ws.rowCount).toBe(1); // header only
  });
});

/**
 * `search` — the half of a list this route could not mirror.
 *
 * The route accepted `filter` and `orderby` but had no way to carry the term a
 * user had typed into the list's search box, and `ExportDownloadRequest` had no
 * field for one. So "export" after a search downloaded the UNSEARCHED superset:
 * more rows than the screen showed, in a file that looks authoritative, with
 * nothing anywhere saying so. The route comment claimed the opposite — that the
 * export "matches what the user sees".
 *
 * Same family as a dropped filter (objectstack#3948, #4181): a plausible answer
 * that is quietly broader than the one asked for.
 */
describe('export route — search', () => {
  let route: any;

  beforeEach(async () => {
    ({ route } = await boot());
  });

  const csvRows = async (query: Record<string, unknown>) => {
    const { res, chunks } = makeRes();
    await route.handler({ params: { object: 'task' }, query } as any, res);
    return parseCsv(chunks.join('')).slice(1); // drop header
  };

  it('narrows the exported rows to the search term', async () => {
    const rows = await csvRows({ format: 'csv', search: '代码' });
    expect(rows.map((r) => r[1])).toEqual(['写代码']);
  });

  it('exports everything when no term is given (unchanged behaviour)', async () => {
    expect((await csvRows({ format: 'csv' })).length).toBe(2);
  });

  it('composes with `filter` — both halves apply, neither replaces the other', async () => {
    // Chosen so each half ALONE gives a different non-empty answer, and only
    // "both applied" gives none. A test where the two agree would pass just as
    // well with `search` dropped entirely.
    const onlyFilter = await csvRows({ format: 'csv', filter: JSON.stringify(['done', '=', true]) });
    expect(onlyFilter.map((r) => r[1])).toEqual(['写代码']);
    const onlySearch = await csvRows({ format: 'csv', search: '文档' });
    expect(onlySearch.map((r) => r[1])).toEqual(['写文档']);

    // Disjoint, so the intersection is empty — which it can only be if BOTH
    // reached the engine. Dropping either one yields a row.
    const both = await csvRows({
      format: 'csv',
      filter: JSON.stringify(['done', '=', true]),
      search: '文档',
    });
    expect(both.length).toBe(0);
  });

  it('an empty or whitespace term is ignored, not applied as a blank predicate', async () => {
    expect((await csvRows({ format: 'csv', search: '' })).length).toBe(2);
    expect((await csvRows({ format: 'csv', search: '   ' })).length).toBe(2);
  });

  it('honours a `searchFields` override that excludes the matching column', async () => {
    // TASK's auto-default searchable set is { title, priority } (text + select).
    // `高` is the label of priority=high, so by default it finds 写代码 …
    expect((await csvRows({ format: 'csv', search: '高' })).map((r) => r[1])).toEqual(['写代码']);
    // … and restricting the scan to `title` finds nothing, which is only true if
    // the override actually reached the engine (ADR-0061).
    expect((await csvRows({ format: 'csv', search: '高', searchFields: 'title' })).length).toBe(0);
  });

  it('applies to xlsx too, not just the csv path', async () => {
    const { res, getBuffer } = makeBinRes();
    await route.handler(
      { params: { object: 'task' }, query: { format: 'xlsx', search: '代码' } } as any,
      res,
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(getBuffer() as any);
    expect(wb.worksheets[0].rowCount).toBe(2); // header + one match
  });
});

// ===========================================================================
// #8993: partial masking (`field.maskingRule`) on the EXPORT path — the
// auditors' screen-vs-CSV probe. The masking itself is enforced by
// plugin-security's engine middleware (REPLACE the value with its partial
// mask; pinned in packages/plugins/plugin-security/src/field-masking-rule.test.ts).
// This suite pins the export leg of the single-channel scope pin: the export
// route streams through the SAME engine read path, so the CSV must carry the
// SAME masked value the list shows — and the masked column's header must
// survive (the value is served, only partially), unlike a deleted FLS column.
// The hook below applies the REAL transform (`maskFieldValue`, imported from
// plugin-security) with the middleware's replace semantics.
// ===========================================================================
describe('export route — partial masking parity (#8993)', () => {
  const partialMaskTitle = (engine: any) =>
    engine.registerHook(
      'afterFind',
      (ctx: any) => {
        if (Array.isArray(ctx.result)) {
          for (const r of ctx.result) {
            if (r && 'title' in r) r.title = maskFieldValue(r.title, { keepHead: 1, keepTail: 0 });
          }
        }
      },
      { object: 'task' },
    );

  it('CSV carries the SAME masked value the list serves, and the masked column keeps its header', async () => {
    const { engine, protocol, route } = await boot();
    partialMaskTitle(engine);

    // Screen half: the list path serves the masked value.
    const listRes: any = await protocol.findData({ object: 'task', query: {} });
    const listRows: any[] = listRes.records ?? listRes.data ?? [];
    const listTitles = new Map(listRows.map((r: any) => [r.id, r.title]));
    expect(listTitles.get('1')).toBe('写**');
    expect(listTitles.get('2')).toBe('写**');

    // CSV half: same value, byte for byte — not the full value, not an empty
    // cell, not a dropped column.
    const csv = makeRes();
    await route.handler({ params: { object: 'task' }, query: { format: 'csv' } } as any, csv.res);
    const rows = parseCsv(csv.chunks.join(''));
    expect(rows[0]).toContain('标题');
    const titleIdx = rows[0].indexOf('标题');
    const idIdx = rows[0].indexOf('ID');
    for (const r of rows.slice(1)) {
      expect(r[titleIdx]).toBe(listTitles.get(r[idIdx]));
      expect(r[titleIdx]).toBe('写**');
    }
  });

  it('JSON export carries the masked value too (no format-specific bypass)', async () => {
    const { engine, route } = await boot();
    partialMaskTitle(engine);
    const json = makeRes();
    await route.handler({ params: { object: 'task' }, query: { format: 'json' } } as any, json.res);
    const arr = JSON.parse(json.chunks.join(''));
    expect(arr.length).toBe(2);
    for (const row of arr) expect(row.title).toBe('写**');
  });
});
