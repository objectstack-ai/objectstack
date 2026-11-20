// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0157 D1, D3, D7, D10: the platform's real working-calendar objects
 * (`@objectstack/platform-objects`, not a mirror), on a real sqlite engine,
 * with the calendar service's write hooks bound as the kernel binds them
 * (`installWorkCalendarHooks`), written through the generic data doors:
 *
 * - a calendar created without `timezone` takes the organization's zone: the
 *   hooks run before `required` is judged, so the fill is what `required` sees;
 * - a code outside the calendar-code shape is refused by the object's format
 *   rule, naming `code`;
 * - one exception row per (calendar, date) in an organization: a second is
 *   refused by the unique key, while the same date on another calendar lands;
 * - an exception file through the generic async import door names its
 *   calendar by code, and a bad line is refused for that row alone while the
 *   rest of the file lands;
 * - an edit to a calendar is judged in the organization of the stored row:
 *   its one read for "one default per organization" runs there, whatever
 *   organization the session or the payload names;
 * - moving a calendar to another organization while it stays the default is
 *   refused before any read; a move without a default lands.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL, WorkCalendarService, installWorkCalendarHooks } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { SysImportJob } from '@objectstack/platform-objects/audit';
import { SysWorkCalendar, SysWorkCalendarException } from '@objectstack/platform-objects/system';
import { RestServer } from './rest-server';
import { DEFAULT_ORGANIZATION_ID, installDefaultOrganization } from './default-organization.testkit.js';

const ORG = DEFAULT_ORGANIZATION_ID;
/** A calendar code (a record's `code` column), never an error code. */
const CN_STANDARD = 'cn_standard';
/** An organization with no `localization.timezone`. */
const ZONELESS_ORG = 'org_zoneless';

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

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
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(SysWorkCalendar as any);
  engine.registry.registerObject(SysWorkCalendarException as any);
  engine.registry.registerObject(SysImportJob as any);
  await engine.syncSchemas();
  await installDefaultOrganization(engine);
  for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
    if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as any);
  }
  // As the kernel binds them: the organization's zone answers a create that leaves `timezone` out.
  const service = new WorkCalendarService({ getEngine: () => engine as any });
  installWorkCalendarHooks(engine as any, service, {
    timezoneOf: async (organizationId) => (organizationId === ORG ? 'Asia/Shanghai' : undefined),
  });
  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  // The request's execution context, as the kernel resolves it: the active organization is `tenantId`.
  const session = { organizationId: ORG };
  (rest as any).resolveExecCtx = async () => ({ userId: 'calendar-admin', tenantId: session.organizationId });
  rest.registerRoutes();
  const routes = rest.getRoutes();
  const find = (method: string, path: string) => {
    const route = routes.find((r: any) => r.method === method && r.path === path);
    if (!route) throw new Error(`route not registered: ${method} ${path}`);
    return route;
  };
  return {
    engine,
    session,
    post: find('POST', '/api/v1/data/:object'),
    create: find('POST', '/api/v1/data/:object/import/jobs'),
    progress: find('GET', '/api/v1/data/import/jobs/:jobId'),
    results: find('GET', '/api/v1/data/import/jobs/:jobId/results'),
  };
}

type Booted = Awaited<ReturnType<typeof boot>>;

/** POST one record to the generic create door: the status and the body. */
async function post(ctx: Booted, object: string, body: Record<string, unknown>): Promise<{ status: number; json: any }> {
  const res = makeRes();
  await ctx.post.handler({ params: { object }, body, query: {} } as any, res);
  return { status: res._status, json: res._json };
}

const WEEK = {
  monday_periods: '09:00-12:00, 13:00-18:00',
  tuesday_periods: '09:00-12:00, 13:00-18:00',
  wednesday_periods: '09:00-12:00, 13:00-18:00',
  thursday_periods: '09:00-12:00, 13:00-18:00',
  friday_periods: '09:00-12:00, 13:00-18:00',
};

const calendar = (code: string, extra: Record<string, unknown> = {}) => ({
  name: code, code, ...WEEK, maintained_from: '2026-01-01', maintained_through: '2026-12-31', ...extra,
});

/** POST the CSV to the async door and wait for the job's terminal state. */
async function importCsv(ctx: Booted, object: string, csv: string): Promise<{ job: any; results: any[] }> {
  const res = makeRes();
  await ctx.create.handler({ params: { object }, body: { format: 'csv', csv } } as any, res);
  expect(res._status).toBe(201);
  const jobId = res._json.jobId;
  for (let i = 0; i < 200; i++) {
    const p = makeRes();
    await ctx.progress.handler({ params: { jobId }, query: {} } as any, p);
    if (['succeeded', 'failed', 'cancelled'].includes(p._json?.status)) {
      const r = makeRes();
      await ctx.results.handler({ params: { jobId }, query: {} } as any, r);
      return { job: p._json, results: r._json.results };
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`import job ${jobId} did not finish`);
}

const byCalendarDate = (a: any, b: any) => `${a.calendar}${a.date}`.localeCompare(`${b.calendar}${b.date}`);

const exceptions = async (ctx: Booted) =>
  (await ctx.engine.find('sys_work_calendar_exception', { context: { isSystem: true, tenantId: ORG } as any }))
    .map((r: any) => ({ calendar: r.calendar, date: String(r.date).slice(0, 10), kind: r.kind, periods: r.periods ?? null }))
    .sort(byCalendarDate);

describe('sys_work_calendar through the create door (ADR-0157 D1, D7)', () => {
  let ctx: Booted;
  beforeEach(async () => {
    ctx = await boot();
  });

  it('a create that leaves timezone out stores the organization zone', async () => {
    const { status, json } = await post(ctx, 'sys_work_calendar', calendar(CN_STANDARD));
    expect(status).toBe(201);
    const stored: any = await ctx.engine.findOne('sys_work_calendar', { where: { id: json.id }, context: { isSystem: true, tenantId: ORG } as any });
    expect(stored).toMatchObject({ code: CN_STANDARD, timezone: 'Asia/Shanghai', organization_id: ORG });
  });

  it('CONTROL: with no organization zone to take, the blank is refused as required', async () => {
    ctx.session.organizationId = ZONELESS_ORG;
    const { status, json } = await post(ctx, 'sys_work_calendar', calendar('cn_standard'));
    expect(status).toBe(400);
    expect(json).toMatchObject({ code: 'VALIDATION_FAILED', fields: [{ field: 'timezone', code: 'required' }] });
  });

  it('refuses a code outside the calendar-code shape, naming code', async () => {
    const { status, json } = await post(ctx, 'sys_work_calendar', calendar('CN Standard'));
    expect(status).toBe(400);
    expect(json.code).toBe('VALIDATION_FAILED');
    expect(json.fields.map((f: any) => [f.field, f.code])).toEqual([['code', 'invalid_format']]);
  });
});

describe('sys_work_calendar_exception through the data doors (ADR-0157 D3, D10)', () => {
  let ctx: Booted;
  let cn: string;
  let plant: string;
  beforeEach(async () => {
    ctx = await boot();
    cn = (await post(ctx, 'sys_work_calendar', calendar('cn_standard'))).json.id;
    plant = (await post(ctx, 'sys_work_calendar', calendar('plant_a'))).json.id;
  });

  it('holds one row per (calendar, date): a second is refused, the same date on another calendar lands', async () => {
    expect((await post(ctx, 'sys_work_calendar_exception', { calendar: cn, date: '2026-10-01', kind: 'off' })).status).toBe(201);

    const second = await post(ctx, 'sys_work_calendar_exception', { calendar: cn, date: '2026-10-01', kind: 'on', periods: '09:00-18:00' });
    expect(second.status).toBe(409);
    expect(second.json.code).toBe('UNIQUE_VIOLATION');
    expect((await post(ctx, 'sys_work_calendar_exception', { calendar: plant, date: '2026-10-01', kind: 'on', periods: '08:00-16:00' })).status).toBe(201);

    expect(await exceptions(ctx)).toEqual([
      { calendar: cn, date: '2026-10-01', kind: 'off', periods: null },
      { calendar: plant, date: '2026-10-01', kind: 'on', periods: '08:00-16:00' },
    ].sort(byCalendarDate));
  });

  it('imports a file of exceptions naming the calendar by code; a bad line is refused alone', async () => {
    const { job, results } = await importCsv(ctx, 'sys_work_calendar_exception', [
      'calendar,date,kind,periods,note',
      'cn_standard,2026-10-01,off,,National Day',
      'cn_standard,2026-10-02,off,09:00-12:00,National Day', // a day off carries no periods: refused
      'cn_standard,2026-09-27,on,09:00-12:00,Make-up workday',
    ].join('\n'));

    expect(job).toMatchObject({ status: 'succeeded', total: 3, created: 2, errors: 1 });
    expect(results[0]).toMatchObject({ row: 1, ok: true, action: 'created' });
    expect(results[1]).toMatchObject({ row: 2, ok: false, field: 'periods', code: 'invalid_value' });
    expect(results[2]).toMatchObject({ row: 3, ok: true, action: 'created' });
    expect(await exceptions(ctx)).toEqual([
      { calendar: cn, date: '2026-09-27', kind: 'on', periods: '09:00-12:00' },
      { calendar: cn, date: '2026-10-01', kind: 'off', periods: null },
    ]);
  });
});

/** Every one-default read the hooks make, by the organization it ran in. */
function recordDefaultReads(engine: ObjectQL): string[] {
  const reads: string[] = [];
  const find = engine.find.bind(engine);
  (engine as any).find = (object: string, query: any) => {
    if (object === 'sys_work_calendar' && query?.where?.is_default === true) reads.push(String(query?.context?.tenantId ?? '(none)'));
    return find(object, query);
  };
  return reads;
}

async function seed(posture: 'group' | 'isolated') {
  const ctx = await boot();
  ctx.engine.setTenancyPostureProvider(() => posture);
  const put = async (organizationId: string, code: string, extra: Record<string, unknown> = {}) =>
    String(((await ctx.engine.insert('sys_work_calendar', calendar(code, { timezone: 'UTC', ...extra }), {
      context: { userId: 'calendar-admin', tenantId: organizationId } as any,
    })) as any).id);
  // org_b holds a default; org_a holds none, so a read in org_a would admit the edit.
  const storedDefault = await put('org_b', 'b_main', { is_default: true });
  const stored = await put('org_b', 'b_alt');
  await put('org_a', 'a_main');
  return { ctx, stored, storedDefault, reads: recordDefaultReads(ctx.engine) };
}

/** The refusal an engine write meets, or `undefined` when it lands. */
const refusalOf = (write: Promise<unknown>): Promise<any> => write.then(() => undefined, (e: unknown) => e);

describe('an edit is judged in the organization of the stored row (ADR-0157 D2)', () => {
  it('group: a session in org_a editing a row stored in org_b makes exactly one read, in org_b', async () => {
    const { ctx, stored, reads } = await seed('group');
    const err = await refusalOf(ctx.engine.update('sys_work_calendar', { id: stored, is_default: true, organization_id: 'org_a' }, {
      context: { userId: 'calendar-admin', tenantId: 'org_a', accessible_org_ids: ['org_a', 'org_b'] } as any,
    }));

    expect(reads).toEqual(['org_b']);
    expect(err?.code).toBe('VALIDATION_FAILED');
    expect(err?.fields?.map((f: any) => [f.field, f.code])).toEqual([['is_default', 'invalid_value']]);
  });

  it('isolated: a session in org_a does not reach a row stored in org_b, and the hooks read nothing', async () => {
    const { ctx, stored, reads } = await seed('isolated');
    const err = await refusalOf(ctx.engine.update('sys_work_calendar', { id: stored, is_default: true, organization_id: 'org_a' }, {
      context: { userId: 'calendar-admin', tenantId: 'org_a' } as any,
    }));

    expect(reads).toEqual([]);
    expect(err?.code).toBe('RECORD_NOT_FOUND');
  });
});

describe('moving a calendar to another organization (ADR-0157 D2)', () => {
  // A system writer in the row's own organization, the one writer whose
  // payload reaches the hooks with `organization_id` in it.
  const asSystem = { context: { userId: 'calendar-admin', tenantId: 'org_b', isSystem: true } as any };

  it('refuses moving a calendar that stays the default, before any read', async () => {
    const { ctx, storedDefault, reads } = await seed('isolated');
    const err = await refusalOf(ctx.engine.update('sys_work_calendar', { id: storedDefault, organization_id: 'org_a' }, asSystem));

    expect(err?.code).toBe('VALIDATION_FAILED');
    expect(err?.fields?.map((f: any) => [f.field, f.code])).toEqual([['is_default', 'invalid_value']]);
    expect(reads).toEqual([]);
  });

  it('refuses a move that sets the default, before any read', async () => {
    const { ctx, stored, reads } = await seed('isolated');
    const err = await refusalOf(ctx.engine.update('sys_work_calendar', { id: stored, is_default: true, organization_id: 'org_a' }, asSystem));

    expect(err?.code).toBe('VALIDATION_FAILED');
    expect(err?.fields?.map((f: any) => [f.field, f.code])).toEqual([['is_default', 'invalid_value']]);
    expect(reads).toEqual([]);
  });

  it('CONTROL: a move without a default lands', async () => {
    const { ctx, stored } = await seed('isolated');
    expect(await refusalOf(ctx.engine.update('sys_work_calendar', { id: stored, organization_id: 'org_a' }, asSystem))).toBeUndefined();

    const moved: any = await ctx.engine.findOne('sys_work_calendar', { where: { id: stored }, context: { isSystem: true } as any });
    expect(moved).toMatchObject({ organization_id: 'org_a', is_default: false });
  });
});
