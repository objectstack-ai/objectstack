// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * End-to-end import integration: the REAL `POST /data/:object/import` route
 * driven by a REAL {@link ObjectQL} engine + {@link ObjectStackProtocolImplementation},
 * a REAL sqlite `:memory:` driver, and real registered objects — no protocol
 * mocks and, since #5704 批次 3 / #5785, no hand-written storage either.
 *
 * Mirrors `export-integration.test.ts`. It proves the server-side coercion +
 * upsert pipeline against the SAME metadata accessor (`getMetaItem`) and write
 * path (`createData`/`updateData`) a deployed server runs: human cells
 * (是→true, 高→high, name→id) become storage values, and writeMode routes each
 * row to create / update / skip.
 *
 * Backend note (#5704 批次 3 / #5785): the store was a hand-written Map until
 * this file moved to `@objectstack/driver-sql` + better-sqlite3 `:memory:`.
 * "Human cell becomes a storage value" is the whole claim of this file, and a
 * Map stores whatever JavaScript value it is handed — `true` stays `true`,
 * `['u1','u2']` stays an array, a number stays a number, no column ever
 * disagrees. The point of the migration is that the round trip now goes through
 * real column types: 是 is coerced to a boolean, written as SQLite's integer 1,
 * and read back as `true`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
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

const USER = {
  name: 'user', label: 'User', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const, label: '姓名' },
    email: { name: 'email', type: 'email' as const, label: '邮箱' },
  },
};

const TASK = {
  name: 'task', label: 'Task', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
    title: { name: 'title', type: 'text' as const, label: '标题' },
    done: { name: 'done', type: 'boolean' as const, label: '完成' },
    priority: {
      name: 'priority', type: 'select' as const, label: '优先级',
      options: [{ label: '高', value: 'high' }, { label: '低', value: 'low' }],
    },
    score: { name: 'score', type: 'number' as const, label: '分数' },
    due: { name: 'due', type: 'date' as const, label: '截止' },
    owner: { name: 'owner', type: 'lookup' as const, label: '负责人', reference: 'user', displayField: 'name' },
    members: { name: 'members', type: 'lookup' as const, label: '成员', reference: 'user', displayField: 'name', multiple: true },
    skills: {
      name: 'skills', type: 'select' as const, label: '技能', multiple: true,
      options: [{ label: '焊接', value: 'weld' }, { label: '质检', value: 'qc' }],
    },
  },
};

// Mirrors an AI-built object with required fields and NO default (framework
// import dry-run fidelity): `member_name` (required text) and `status` (required
// select, no default) must be present on create; `tier` is required but carries
// a default, so the engine fills it and the importer must NOT demand it.
const MEMBER = {
  name: 'member', label: 'Member', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    member_name: { name: 'member_name', type: 'text' as const, label: 'Name', required: true },
    status: {
      name: 'status', type: 'select' as const, label: 'Status', required: true,
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Frozen', value: 'frozen' },
        { label: 'Lost Contact', value: 'lost_contact' },
        { label: 'Archived', value: 'archived' },
      ],
    },
    tier: {
      name: 'tier', type: 'select' as const, label: 'Tier', required: true, defaultValue: 'standard',
      options: [{ label: 'Standard', value: 'standard' }, { label: 'Gold', value: 'gold' }],
    },
    // framework#3956 — bounded fields. The dry run used to ignore both.
    penalty_amount: { name: 'penalty_amount', type: 'number' as const, label: '处罚金额', min: 0, max: 9999999.99 },
    nickname: { name: 'nickname', type: 'text' as const, label: 'Nickname', maxLength: 5 },
    // framework#7501 — the issue's own repro declaration: `scale: 0` declares
    // "integer, no decimals", and the import path is the leg that proves the
    // ruling (reject, never round) — a rounding validator would have quietly
    // stored 12 here and every assertion below would still need to fail it.
    work_hours: {
      name: 'work_hours', type: 'number' as const, label: 'Max hours per shift',
      precision: 5, scale: 0, min: 1, max: 12,
    },
  },
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

async function boot() {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(makeSqliteDriver(), true);
  await engine.init();
  engine.registry.registerObject(USER as any);
  engine.registry.registerObject(TASK as any);
  engine.registry.registerObject(MEMBER as any);
  // Real DDL — the NOT NULL / column types the importer's dry run claims to
  // predict are now physically there to be violated.
  await engine.syncSchemas();
  await engine.insert('user', { id: 'u1', name: '张三', email: 'zhang@x.com' });
  await engine.insert('user', { id: 'u2', name: '李四', email: 'li@x.com' });

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const route = rest.getRoutes().find(
    (r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/import',
  );
  return { engine, protocol, route, rest };
}

const call = (route: any, body: any) => {
  const res = makeRes();
  return route.handler({ params: { object: 'task' }, body } as any, res).then(() => res);
};

describe('import route — real engine + protocol integration', () => {
  let route: any;
  let engine: any;

  beforeEach(async () => {
    ({ route, engine } = await boot());
    expect(route).toBeDefined();
  });

  it('coerces every special value type on insert (是→true, 高→high, name→id, date→ISO)', async () => {
    const csv = [
      'ID,标题,完成,优先级,分数,截止,负责人',
      '1,写代码,是,高,"1,200",2026/06/30,张三',
    ].join('\n');
    const res = await call(route, {
      format: 'csv', csv,
      mapping: { ID: 'id', 标题: 'title', 完成: 'done', 优先级: 'priority', 分数: 'score', 截止: 'due', 负责人: 'owner' },
    });
    expect(res._json).toMatchObject({ total: 1, ok: 1, errors: 0, created: 1 });
    const stored = await engine.findOne('task', { where: { id: '1' } });
    expect(stored).toMatchObject({
      title: '写代码', done: true, priority: 'high', score: 1200, owner: 'u1',
    });
    expect(String(stored.due)).toContain('2026-06-30');
  });

  it('splits a multi-value lookup cell and resolves every token to an id (issue #3063)', async () => {
    // The cell holds several display names joined by `;` (issue's CSV). Before
    // the fix the whole string was resolved as one reference and always failed.
    const csv = ['ID,标题,成员', '1,结构一班,张三;李四'].join('\n');
    const res = await call(route, {
      format: 'csv', csv,
      mapping: { ID: 'id', 标题: 'title', 成员: 'members' },
    });
    expect(res._json).toMatchObject({ total: 1, ok: 1, errors: 0, created: 1 });
    const stored = await engine.findOne('task', { where: { id: '1' } });
    expect(stored.members).toEqual(['u1', 'u2']);
  });

  it('splits a select flagged multiple:true into an option-value array on insert (issue #3063)', async () => {
    const csv = ['ID,标题,技能', '1,焊工,焊接;质检'].join('\n');
    const res = await call(route, {
      format: 'csv', csv,
      mapping: { ID: 'id', 标题: 'title', 技能: 'skills' },
    });
    expect(res._json).toMatchObject({ total: 1, ok: 1, errors: 0, created: 1 });
    const stored = await engine.findOne('task', { where: { id: '1' } });
    expect(stored.skills).toEqual(['weld', 'qc']);
  });

  it('names the specific unmatched token in a multi-value lookup (issue #3063)', async () => {
    const res = await call(route, {
      format: 'json',
      rows: [{ id: 'a', title: 'x', members: '张三;查无此人' }],
    });
    const failed = res._json.results.find((r: any) => !r.ok);
    expect(failed).toMatchObject({ field: 'members', code: 'reference_not_found' });
    expect(failed.error).toContain('查无此人');
    expect(failed.error).not.toContain('张三');
  });

  it('resolves a lookup by email when displayField is not the match, and reports not-found', async () => {
    // Default candidate fields include email — resolve 李四 via email.
    const res = await call(route, {
      format: 'json',
      rows: [
        { id: 'a', title: 'x', owner: 'li@x.com' },
        { id: 'b', title: 'y', owner: '查无此人' },
      ],
    });
    expect(res._json.created).toBe(1);
    expect(res._json.errors).toBe(1);
    const failed = res._json.results.find((r: any) => !r.ok);
    expect(failed).toMatchObject({ field: 'owner', code: 'reference_not_found' });
    const a = await engine.findOne('task', { where: { id: 'a' } });
    expect(a.owner).toBe('u2');
  });

  it('reports reference_ambiguous when a name matches more than one record', async () => {
    // Second 张三 makes the name non-unique; the importer must refuse to guess.
    await engine.insert('user', { id: 'u3', name: '张三', email: 'zhang2@x.com' });
    const res = await call(route, {
      format: 'json',
      rows: [
        { id: 'a', title: 'x', owner: '张三' },       // ambiguous name
        { id: 'b', title: 'y', owner: 'zhang2@x.com' }, // unique email → resolves
      ],
    });
    expect(res._json.errors).toBe(1);
    expect(res._json.results.find((r: any) => !r.ok)).toMatchObject({ field: 'owner', code: 'reference_ambiguous' });
    const b = await engine.findOne('task', { where: { id: 'b' } });
    expect(b.owner).toBe('u3');
  });

  it('accepts a pasted record id directly via the id fast-path', async () => {
    const res = await call(route, {
      format: 'json',
      rows: [{ id: 'c', title: 'z', owner: 'u1' }],
    });
    expect(res._json.errors).toBe(0);
    const c = await engine.findOne('task', { where: { id: 'c' } });
    expect(c.owner).toBe('u1');
  });

  it('surfaces per-row coercion errors without aborting the batch', async () => {
    const res = await call(route, {
      format: 'json',
      rows: [
        { id: 'ok', title: 'fine', score: '42' },
        { id: 'bad', title: 'nope', score: 'not-a-number' },
      ],
    });
    expect(res._json.ok).toBe(1);
    expect(res._json.errors).toBe(1);
    expect(res._json.results.find((r: any) => !r.ok)).toMatchObject({ field: 'score', code: 'invalid_number' });
  });

  it('dryRun coerces + previews create/update without persisting', async () => {
    const res = await call(route, {
      format: 'json', dryRun: true,
      rows: [{ id: 'z', title: 'preview', done: '否' }],
    });
    expect(res._json).toMatchObject({ dryRun: true, ok: 1, created: 1 });
    expect(await engine.findOne('task', { where: { id: 'z' } })).toBeNull();
  });

  it('writeMode:update touches an existing match and skips non-matches', async () => {
    await engine.insert('task', { id: '100', title: 'old', score: 1 });
    const res = await call(route, {
      format: 'json', writeMode: 'update', matchFields: ['id'],
      rows: [
        { id: '100', title: 'new', score: 2 },   // matches → update
        { id: '999', title: 'ghost' },            // no match → skip
      ],
    });
    expect(res._json).toMatchObject({ updated: 1, skipped: 1, created: 0 });
    const row = await engine.findOne('task', { where: { id: '100' } });
    expect(row).toMatchObject({ title: 'new', score: 2 });
    expect(await engine.findOne('task', { where: { id: '999' } })).toBeNull();
  });

  it('writeMode:upsert updates a match by a non-id field, else creates', async () => {
    await engine.insert('task', { id: '200', title: 'Acme', score: 1 });
    const res = await call(route, {
      format: 'json', writeMode: 'upsert', matchFields: ['title'],
      rows: [
        { title: 'Acme', score: 9 },     // matches by title → update
        { title: 'Umbrella', score: 5 }, // no match → create
      ],
    });
    expect(res._json).toMatchObject({ updated: 1, created: 1 });
    const acme = await engine.findOne('task', { where: { title: 'Acme' } });
    expect(acme).toMatchObject({ id: '200', score: 9 });
    const umbrella = await engine.findOne('task', { where: { title: 'Umbrella' } });
    expect(umbrella?.score).toBe(5);
  });

  it('rejects update/upsert without matchFields', async () => {
    const res = await call(route, { format: 'json', writeMode: 'upsert', rows: [{ title: 'x' }] });
    expect(res._status).toBe(400);
    expect(res._json.code).toBe('INVALID_REQUEST');
  });

  it('parses a native xlsx workbook server-side and coerces cells like csv', async () => {
    const ExcelJS: any = (await import('exceljs')).default ?? (await import('exceljs'));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['ID', '标题', '完成', '优先级', '分数', '截止', '负责人']);
    ws.addRow(['1', '写代码', '是', '高', 1200, new Date('2026-06-30T00:00:00Z'), '张三']);
    ws.addRow(['2', '测试', '否', '低', 3, '2026/07/01', '李四']);
    const buf = await wb.xlsx.writeBuffer();
    const xlsxBase64 = Buffer.from(buf).toString('base64');

    const res = await call(route, {
      format: 'xlsx', xlsxBase64,
      mapping: { ID: 'id', 标题: 'title', 完成: 'done', 优先级: 'priority', 分数: 'score', 截止: 'due', 负责人: 'owner' },
    });
    expect(res._json).toMatchObject({ total: 2, ok: 2, errors: 0, created: 2 });
    const one = await engine.findOne('task', { where: { id: '1' } });
    expect(one).toMatchObject({ title: '写代码', done: true, priority: 'high', score: 1200, owner: 'u1' });
    expect(String(one.due)).toContain('2026-06-30');
    const two = await engine.findOne('task', { where: { id: '2' } });
    expect(two).toMatchObject({ title: '测试', done: false, priority: 'low', score: 3, owner: 'u2' });
  });

  it('reads xlsxBase64 without an explicit format and honors the sheet selector', async () => {
    const ExcelJS: any = (await import('exceljs')).default ?? (await import('exceljs'));
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Empty'); // decoy first sheet
    const ws = wb.addWorksheet('Data');
    ws.addRow(['id', 'title', 'score']);
    ws.addRow(['x1', 'from-named-sheet', 7]);
    const buf = await wb.xlsx.writeBuffer();
    const xlsxBase64 = Buffer.from(buf).toString('base64');

    const res = await call(route, { xlsxBase64, sheet: 'Data' });
    expect(res._json).toMatchObject({ total: 1, ok: 1, created: 1 });
    const row = await engine.findOne('task', { where: { id: 'x1' } });
    expect(row).toMatchObject({ title: 'from-named-sheet', score: 7 });
  });

  it('rejects a malformed xlsx payload with 400', async () => {
    const res = await call(route, { format: 'xlsx', xlsxBase64: Buffer.from('not a workbook').toString('base64') });
    expect(res._status).toBe(400);
    expect(res._json.code).toBe('INVALID_REQUEST');
    expect(String(res._json.error)).toMatch(/xlsx/i);
  });
});

// ---------------------------------------------------------------------------
// Required-field dry-run fidelity — the dry run must predict the real insert's
// NOT NULL / required failures instead of green-lighting a row the insert
// rejects. Mirrors the live mx1n_member case (required `status` select, no
// default): dryRun said ok, the real insert died on a NOT NULL constraint.
// ---------------------------------------------------------------------------
describe('import route — required-field dry-run fidelity', () => {
  let route: any;
  let engine: any;
  beforeEach(async () => { ({ route, engine } = await boot()); });

  const imp = (body: any) => {
    const res = makeRes();
    return route.handler({ params: { object: 'member' }, body } as any, res).then(() => res);
  };

  it('dry run fails a create row missing a required no-default field — and the real insert agrees', async () => {
    const rows = [
      { id: 'm1', member_name: 'Alice' },                  // status missing → must fail
      { id: 'm2', member_name: 'Bob', status: 'active' },  // complete → ok
    ];
    // The pre-check only runs with automations OFF (a beforeInsert hook may
    // populate a required field, so with automations on we defer to the
    // engine's own validation). runAutomations defaults to true since #2922,
    // so the opt-out is explicit here.
    // Dry run: no longer reports success for the row the insert will reject.
    const dry = await imp({ format: 'json', dryRun: true, runAutomations: false, rows });
    expect(dry._json).toMatchObject({ dryRun: true, total: 2, ok: 1, errors: 1 });
    expect(dry._json.results.find((r: any) => !r.ok)).toMatchObject({ row: 1, field: 'status', code: 'required' });
    expect(await engine.findOne('member', { where: { id: 'm2' } })).toBeNull(); // dry run never writes

    // Real insert: SAME verdict (parity), and a readable required message
    // instead of a raw `NOT NULL constraint failed: member.status`. The field is
    // named by its declared LABEL, not the API name (#3957) — `status` is
    // declared `label: 'Status'` in this fixture.
    const real = await imp({ format: 'json', runAutomations: false, rows });
    expect(real._json).toMatchObject({ total: 2, ok: 1, errors: 1, created: 1 });
    expect(real._json.results.find((r: any) => !r.ok)).toMatchObject({ field: 'status', code: 'required', error: 'Status is required' });
    expect((await engine.findOne('member', { where: { id: 'm2' } }))?.status).toBe('active');
    expect(await engine.findOne('member', { where: { id: 'm1' } })).toBeNull();
  });

  it('a required field with a schema default is satisfied without being mapped', async () => {
    // `tier` is required but defaulted — the importer must not demand it; the
    // engine fills 'standard'. Only member_name + status are supplied.
    const res = await imp({ format: 'json', rows: [{ id: 'm3', member_name: 'Cara', status: 'frozen' }] });
    expect(res._json).toMatchObject({ ok: 1, errors: 0, created: 1 });
    expect(await engine.findOne('member', { where: { id: 'm3' } }))
      .toMatchObject({ member_name: 'Cara', status: 'frozen', tier: 'standard' });
  });

  it('flags a required text field too (not just selects); a blank cell counts as missing', async () => {
    const res = await imp({ format: 'json', dryRun: true, runAutomations: false, rows: [
      { id: 'm4', status: 'active' },                     // member_name missing
      { id: 'm5', member_name: '   ', status: 'active' }, // member_name blank
    ] });
    expect(res._json).toMatchObject({ ok: 0, errors: 2 });
    for (const r of res._json.results) expect(r).toMatchObject({ field: 'member_name', code: 'required' });
  });

  // framework#3956 — the dry run reported `ok:1, created:1` for a row the very
  // same endpoint then rejected with `penalty_amount must be ≥ 0`, because the
  // dry-run branch returned before any field-constraint check ran. Unlike the
  // required pre-check above, this one is NOT gated on `runAutomations`: it runs
  // on the dry run only, where the engine's own validation is never reached.
  it('dry run fails a row that violates min/max — same verdict, same message as the real write', async () => {
    const rows = [{ id: 'p1', member_name: 'Eve', status: 'active', penalty_amount: -500 }];

    const dry = await imp({ format: 'json', dryRun: true, rows });
    expect(dry._json).toMatchObject({ dryRun: true, total: 1, ok: 0, errors: 1, created: 0 });
    // #3957 — the message names the field by its LABEL, not the API column. The
    // dry-run pre-check and the engine render from the same catalog, which is
    // what keeps "same verdict, same message" true after localization.
    expect(dry._json.results[0]).toMatchObject({
      row: 1, ok: false, action: 'failed', field: 'penalty_amount',
      code: 'min_value', error: '处罚金额 must be ≥ 0',
    });

    // The real write reaches the engine's validateRecord and says the same.
    const real = await imp({ format: 'json', rows });
    expect(real._json).toMatchObject({ total: 1, ok: 0, errors: 1, created: 0 });
    expect(real._json.results[0].error).toContain('处罚金额 must be ≥ 0');
    expect(await engine.findOne('member', { where: { id: 'p1' } })).toBeNull();
  });

  it('dry run fails an over-long string too (maxLength), and passes in-range rows', async () => {
    const over = await imp({ format: 'json', dryRun: true, rows: [
      { id: 'p2', member_name: 'Fay', status: 'active', nickname: 'toolongname' },
    ] });
    expect(over._json).toMatchObject({ ok: 0, errors: 1 });
    expect(over._json.results[0]).toMatchObject({
      field: 'nickname', code: 'max_length', error: 'Nickname must be ≤ 5 characters (got 11)',
    });

    // Boundary values are legal — the pre-check must not over-reject.
    const ok = await imp({ format: 'json', dryRun: true, rows: [
      { id: 'p3', member_name: 'Gus', status: 'active', penalty_amount: 0, nickname: 'exact' },
    ] });
    expect(ok._json).toMatchObject({ ok: 1, errors: 0, created: 1 });
  });

  it('bound-checks update rows as well as creates', async () => {
    await engine.insert('member', { id: 'p4', member_name: 'Hana', status: 'active', penalty_amount: 10 });
    const res = await imp({ format: 'json', dryRun: true, writeMode: 'update', matchFields: ['id'],
      rows: [{ id: 'p4', penalty_amount: -1 }] });
    expect(res._json).toMatchObject({ ok: 0, errors: 1, updated: 0 });
    expect(res._json.results[0]).toMatchObject({ field: 'penalty_amount', code: 'min_value' });
  });

  it('required check does not apply to update-mode rows (only the touched fields matter)', async () => {
    await engine.insert('member', { id: 'm6', member_name: 'Dan', status: 'active', tier: 'gold' });
    // writeMode:update on an existing match, touching only member_name — status
    // is not supplied but the record already has it, so this must NOT fail.
    const res = await imp({ format: 'json', writeMode: 'update', matchFields: ['id'],
      rows: [{ id: 'm6', member_name: 'Daniel' }] });
    expect(res._json).toMatchObject({ ok: 1, errors: 0, updated: 1 });
    expect((await engine.findOne('member', { where: { id: 'm6' } }))?.member_name).toBe('Daniel');
  });
});

// ---------------------------------------------------------------------------
// Named mapping artifacts (#2611) — `mappingName` resolves a registered
// `mapping` item and applies its fieldMapping pipeline before coercion.
// ---------------------------------------------------------------------------
describe('import route — named mapping artifact (#2611)', () => {
  let route: any;
  let engine: any;

  const TASK_CSV_MAPPING = {
    name: 'task_feed_import',
    label: 'Task feed import',
    sourceFormat: 'csv',
    targetObject: 'task',
    fieldMapping: [
      { source: 'ID', target: 'id', transform: 'none' },
      { source: 'Task Title', target: 'title', transform: 'none' },
      // Source system codes → select LABELS; the built-in metaMap coercion
      // then turns the label (高/低) into the storage code (high/low) —
      // the artifact transform and the coercion pipeline COMPOSE.
      { source: 'Prio', target: 'priority', transform: 'map', params: { valueMap: { P1: '高', P3: '低' } } },
      { source: 'Assignee', target: 'owner', transform: 'lookup' },
      { source: 'ignored_by_projection', target: 'score', transform: 'constant', params: { value: 5 } },
    ],
    mode: 'upsert',
    upsertKey: ['id'],
  };

  beforeEach(async () => {
    ({ route, engine } = await boot());
    engine.registry.registerItem('mapping', TASK_CSV_MAPPING as any, 'name');
    engine.registry.registerItem(
      'mapping',
      { ...TASK_CSV_MAPPING, name: 'user_only_mapping', targetObject: 'user' } as any,
      'name',
    );
    engine.registry.registerItem(
      'mapping',
      {
        name: 'task_js_mapping', targetObject: 'task', sourceFormat: 'csv',
        fieldMapping: [{ source: 'x', target: 'title', transform: 'javascript' }],
      } as any,
      'name',
    );
    engine.registry.registerItem(
      'mapping',
      { ...TASK_CSV_MAPPING, name: 'task_json_mapping', sourceFormat: 'json' } as any,
      'name',
    );
  });

  it('applies rename + map + constant + lookup, strict projection, artifact upsert defaults', async () => {
    const csv = [
      'ID,Task Title,Prio,Assignee,Junk Column',
      't1,迁移旧数据,P1,张三,DROP-ME',
      't2,巡检,P3,李四,DROP-ME-TOO',
    ].join('\n');
    // No writeMode/matchFields in the request — the artifact's
    // mode:'upsert' + upsertKey:['id'] apply as defaults.
    const res = await call(route, { format: 'csv', csv, mappingName: 'task_feed_import' });
    expect(res._json).toMatchObject({ total: 2, ok: 2 });

    const one = await engine.findOne('task', { where: { id: 't1' } });
    // map: P1→高, then coercion 高→high; lookup: 张三→u1 via metaMap;
    // constant: score=5; strict projection: Junk Column never lands.
    expect(one).toMatchObject({ title: '迁移旧数据', priority: 'high', owner: 'u1', score: 5 });
    expect(one['Junk Column']).toBeUndefined();

    // Re-import the same file → artifact upsert semantics update, not dupe.
    const res2 = await call(route, { format: 'csv', csv, mappingName: 'task_feed_import' });
    expect(res2._json.ok).toBe(2);
    const all = await engine.find('task', { where: {} });
    expect(all.filter((r: any) => r.id === 't1')).toHaveLength(1);
  });

  it('404s on an unknown mappingName', async () => {
    const res = await call(route, { format: 'csv', csv: 'ID\nx', mappingName: 'nope' });
    expect(res._status).toBe(404);
    expect(res._json.code).toBe('MAPPING_NOT_FOUND');
  });

  it('400s when the mapping targets a different object', async () => {
    const res = await call(route, { format: 'csv', csv: 'ID\nx', mappingName: 'user_only_mapping' });
    expect(res._status).toBe(400);
    expect(res._json.code).toBe('MAPPING_TARGET_MISMATCH');
  });

  it('400s when mappingName and an inline mapping are both provided', async () => {
    const res = await call(route, {
      format: 'csv', csv: 'ID\nx', mappingName: 'task_feed_import', mapping: { ID: 'id' },
    });
    expect(res._status).toBe(400);
    expect(res._json.code).toBe('CONFLICTING_MAPPING');
  });

  it('400s on a javascript transform instead of silently skipping it', async () => {
    const res = await call(route, { format: 'csv', csv: 'x\n1', mappingName: 'task_js_mapping' });
    expect(res._status).toBe(400);
    expect(res._json.code).toBe('UNSUPPORTED_TRANSFORM');
  });

  it('400s when the payload format contradicts the artifact sourceFormat', async () => {
    const res = await call(route, { format: 'csv', csv: 'ID\nx', mappingName: 'task_json_mapping' });
    expect(res._status).toBe(400);
    expect(res._json.code).toBe('MAPPING_FORMAT_MISMATCH');
  });
});

// ---------------------------------------------------------------------------
// framework#7501 — declared `scale` is enforced by REJECTION on both write
// legs the issue measured: the direct data create route and the CSV import
// route. Ruling 2026-08-11: refuse (`max_scale`), never round — the import
// leg is the one that proves it, because a rounding "fix" would store 12 for
// 11.5 and report the row created; only a refusal leaves the row unwritten.
// New writes only: nothing here migrates or re-judges stored rows.
// ---------------------------------------------------------------------------
describe('import + create routes — number `scale` enforcement (#7501)', () => {
  let route: any;
  let engine: any;
  let rest: any;
  beforeEach(async () => { ({ route, engine, rest } = await boot()); });

  const imp = (body: any) => {
    const res = makeRes();
    return route.handler({ params: { object: 'member' }, body } as any, res).then(() => res);
  };

  it('CSV import refuses an over-scale cell and does NOT store a rounded value', async () => {
    const csv = [
      'ID,Name,Status,Hours',
      'w1,Ivy,active,11.5',   // scale: 0 — must be refused, not rounded to 12
      'w2,Joe,active,12',     // integer, in range — must still write
    ].join('\n');
    const res = await imp({
      format: 'csv', csv,
      mapping: { ID: 'id', Name: 'member_name', Status: 'status', Hours: 'work_hours' },
    });
    expect(res._json).toMatchObject({ total: 2, ok: 1, errors: 1, created: 1 });
    const failed = res._json.results.find((r: any) => !r.ok);
    expect(failed).toMatchObject({
      ok: false, action: 'failed', field: 'work_hours', code: 'max_scale',
      error: 'Max hours per shift must have at most 0 decimal places (got 1)',
    });
    // The refused row left NOTHING behind — neither 11.5 nor a rounded 12.
    expect(await engine.findOne('member', { where: { id: 'w1' } })).toBeNull();
    expect((await engine.findOne('member', { where: { id: 'w2' } }))?.work_hours).toBe(12);
  });

  it('dry run predicts the same refusal — same verdict, same message', async () => {
    // 2.5 is inside [min: 1, max: 12] — the ONLY violated constraint is scale,
    // so this cannot pass by riding the pre-existing min_value branch.
    const rows = [{ id: 'w3', member_name: 'Kim', status: 'active', work_hours: 2.5 }];
    const dry = await imp({ format: 'json', dryRun: true, rows });
    expect(dry._json).toMatchObject({ dryRun: true, total: 1, ok: 0, errors: 1, created: 0 });
    expect(dry._json.results[0]).toMatchObject({
      row: 1, ok: false, action: 'failed', field: 'work_hours', code: 'max_scale',
      error: 'Max hours per shift must have at most 0 decimal places (got 1)',
    });
    expect(await engine.findOne('member', { where: { id: 'w3' } })).toBeNull();
  });

  it('the direct create route answers 400 VALIDATION_FAILED + max_scale (code AND status)', async () => {
    const create = rest.getRoutes().find(
      (r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object',
    );
    expect(create).toBeDefined();
    const res = makeRes();
    await create.handler({
      params: { object: 'member' },
      body: { id: 'w4', member_name: 'Lea', status: 'active', work_hours: 11.5 },
    } as any, res);
    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(res._json.fields[0]).toMatchObject({
      field: 'work_hours', code: 'max_scale',
      constraint: { scale: 0, actual: 1 },
    });
    expect(await engine.findOne('member', { where: { id: 'w4' } })).toBeNull();

    // …and a within-scale value on the same declaration still writes (201-class).
    const ok = makeRes();
    await create.handler({
      params: { object: 'member' },
      body: { id: 'w5', member_name: 'Mo', status: 'active', work_hours: 8 },
    } as any, ok);
    expect(ok._status ?? 200).toBeLessThan(400);
    expect((await engine.findOne('member', { where: { id: 'w5' } }))?.work_hours).toBe(8);
  });
});
