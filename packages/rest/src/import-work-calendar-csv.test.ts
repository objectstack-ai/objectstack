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
 * - a calendar, and each of its exception dates, stays in its organization:
 *   an update that changes `organization_id` is refused before any read,
 *   system writes included, while an edit that keeps it lands;
 * - an exception date names a calendar of its own organization: a calendar
 *   of another organization and an id that names no calendar meet one
 *   refusal, the same body for both.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveThrownHttpError } from '@objectstack/types';
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
  const foreign = await put('org_a', 'a_main');
  return { ctx, stored, storedDefault, foreign, reads: recordDefaultReads(ctx.engine) };
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

describe('a calendar and its exceptions stay in their organization (ADR-0157 D2)', () => {
  // A system writer in the row's own organization: its payload reaches the
  // hooks with `organization_id` in it, as sent.
  const asSystem = { context: { userId: 'calendar-admin', tenantId: 'org_b', isSystem: true } as any };
  const CALENDAR_STAYS = 'A calendar stays in the organization it was created in; create it in the other organization instead.';
  const EXCEPTION_STAYS = "An exception date stays in its calendar's organization.";

  /** The refusal's status, code and field, and whether its message carries the fixed reason. */
  const refused = (err: any, reason: string) => ({
    http: (({ status, code }) => ({ status, code }))(resolveThrownHttpError(err)),
    fields: err?.fields?.map((f: any) => [f.field, f.code]),
    reason: String(err?.message).includes(reason),
  });
  const REFUSED = { http: { status: 400, code: 'VALIDATION_FAILED' }, fields: [['organization_id', 'invalid_value']], reason: true };

  const organizationOf = async (ctx: Booted, object: string, id: string) =>
    ((await ctx.engine.findOne(object, { where: { id }, context: { isSystem: true } as any })) as any)?.organization_id;

  it('refuses moving a calendar, with or without Default, before any read', async () => {
    const { ctx, stored, storedDefault, reads } = await seed('isolated');
    for (const data of [
      { id: storedDefault, organization_id: 'org_a' }, // stays the default
      { id: stored, is_default: true, organization_id: 'org_a' }, // sets the default
      { id: stored, organization_id: 'org_a' }, // no default at all
      { id: stored, organization_id: null }, // clears the organization
    ]) {
      const err = await refusalOf(ctx.engine.update('sys_work_calendar', data, asSystem));
      expect(refused(err, CALENDAR_STAYS)).toEqual(REFUSED);
    }
    expect(reads).toEqual([]);
    expect([await organizationOf(ctx, 'sys_work_calendar', storedDefault), await organizationOf(ctx, 'sys_work_calendar', stored)]).toEqual(['org_b', 'org_b']);
  });

  it('refuses moving an exception date to another organization', async () => {
    const { ctx, stored } = await seed('isolated');
    const day = String(((await ctx.engine.insert('sys_work_calendar_exception', { calendar: stored, date: '2026-10-01', kind: 'off' }, asSystem)) as any).id);
    const err = await refusalOf(ctx.engine.update('sys_work_calendar_exception', { id: day, organization_id: 'org_a' }, asSystem));

    expect(refused(err, EXCEPTION_STAYS)).toEqual(REFUSED);
    expect(await organizationOf(ctx, 'sys_work_calendar_exception', day)).toBe('org_b');
  });

  it('refuses a predicate update that would change a matched row\'s organization, on either object', async () => {
    const { ctx, stored, reads } = await seed('isolated');
    await ctx.engine.insert('sys_work_calendar_exception', { calendar: stored, date: '2026-10-01', kind: 'off' }, asSystem);
    const where = { multi: true, where: { name: 'b_alt' }, ...asSystem } as any;
    expect(refused(await refusalOf(ctx.engine.update('sys_work_calendar', { organization_id: 'org_a' }, where)), CALENDAR_STAYS)).toEqual(REFUSED);
    const days = { multi: true, where: { kind: 'off' }, ...asSystem } as any;
    expect(refused(await refusalOf(ctx.engine.update('sys_work_calendar_exception', { organization_id: 'org_a' }, days)), EXCEPTION_STAYS)).toEqual(REFUSED);
    expect(reads).toEqual([]);
  });

  it('CONTROL: an edit that keeps the organization lands, whether it leaves organization_id out or repeats it', async () => {
    const { ctx, stored } = await seed('isolated');
    const day = String(((await ctx.engine.insert('sys_work_calendar_exception', { calendar: stored, date: '2026-10-01', kind: 'off' }, asSystem)) as any).id);
    for (const data of [{ id: stored, name: 'B Alt' }, { id: stored, name: 'B Alternate', organization_id: 'org_b' }]) {
      expect(await refusalOf(ctx.engine.update('sys_work_calendar', data, asSystem))).toBeUndefined();
    }
    for (const data of [{ id: day, note: 'National Day' }, { id: day, note: 'National Day holiday', organization_id: 'org_b' }]) {
      expect(await refusalOf(ctx.engine.update('sys_work_calendar_exception', data, asSystem))).toBeUndefined();
    }
    const calendarRow: any = await ctx.engine.findOne('sys_work_calendar', { where: { id: stored }, context: { isSystem: true } as any });
    const dayRow: any = await ctx.engine.findOne('sys_work_calendar_exception', { where: { id: day }, context: { isSystem: true } as any });
    expect([calendarRow.name, calendarRow.organization_id, dayRow.note, dayRow.organization_id]).toEqual(['B Alternate', 'org_b', 'National Day holiday', 'org_b']);
  });
});

describe('an exception date names a calendar of its own organization (ADR-0157 D2)', () => {
  // A system writer in org_b, where `stored` lives; `foreign` lives in org_a.
  const asSystem = { context: { userId: 'calendar-admin', tenantId: 'org_b', isSystem: true } as any };
  const REASON = 'An exception date names a calendar of its own organization.';
  const NO_SUCH_CALENDAR = 'cal_no_such_calendar';
  const day = (calendar: string, date = '2026-10-01') => ({ calendar, date, kind: 'off' });

  /** The refusal as a caller meets it: the resolved envelope, whole. */
  const envelope = (err: unknown) => resolveThrownHttpError(err) as any;
  const REFUSED = { status: 400, code: 'VALIDATION_FAILED', details: { fields: [expect.objectContaining({ field: 'calendar', code: 'invalid_value' })] } };

  const daysOf = async (ctx: Booted) =>
    ((await ctx.engine.find('sys_work_calendar_exception', { context: { isSystem: true } as any })) as any[])
      .map((r) => [r.calendar, String(r.date).slice(0, 10), r.organization_id]);

  it('refuses a calendar of another organization, on create and on an update that carries calendar', async () => {
    const { ctx, stored, foreign } = await seed('isolated');
    const created = await refusalOf(ctx.engine.insert('sys_work_calendar_exception', day(foreign), asSystem));
    expect(envelope(created)).toMatchObject(REFUSED);
    expect(envelope(created).message).toContain(REASON);

    // A create whose row names the calendar's organization, not the session's, is not read for: the same refusal.
    const elsewhere = await refusalOf(ctx.engine.insert('sys_work_calendar_exception', { ...day(foreign), organization_id: 'org_a' }, asSystem));
    expect(envelope(elsewhere)).toMatchObject(REFUSED);

    const own = String(((await ctx.engine.insert('sys_work_calendar_exception', day(stored), asSystem)) as any).id);
    const repointed = await refusalOf(ctx.engine.update('sys_work_calendar_exception', { id: own, calendar: foreign }, asSystem));
    expect(envelope(repointed)).toMatchObject(REFUSED);
    expect(await daysOf(ctx)).toEqual([[stored, '2026-10-01', 'org_b']]);
  });

  it('refuses an id that names no calendar with the same body as a calendar of another organization', async () => {
    const { ctx, foreign } = await seed('isolated');
    const other = await refusalOf(ctx.engine.insert('sys_work_calendar_exception', day(foreign), asSystem));
    const none = await refusalOf(ctx.engine.insert('sys_work_calendar_exception', day(NO_SUCH_CALENDAR), asSystem));

    expect(envelope(none)).toMatchObject(REFUSED);
    expect(JSON.stringify(envelope(none))).toBe(JSON.stringify(envelope(other)));
    for (const named of [foreign, NO_SUCH_CALENDAR, 'org_a', 'org_b', 'a_main']) expect(JSON.stringify(envelope(other))).not.toContain(named);

    // The same through the create door, for a member of org_b: one body for both.
    ctx.session.organizationId = 'org_b';
    const viaOther = await post(ctx, 'sys_work_calendar_exception', day(foreign));
    const viaNone = await post(ctx, 'sys_work_calendar_exception', day(NO_SUCH_CALENDAR));
    expect(viaOther).toMatchObject({ status: 400, json: { code: 'VALIDATION_FAILED', fields: [expect.objectContaining({ field: 'calendar', code: 'invalid_value' })] } });
    expect(JSON.stringify(viaNone)).toBe(JSON.stringify(viaOther));
  });

  it('CONTROL: a calendar of its own organization lands, on create and on update', async () => {
    const { ctx, stored, storedDefault } = await seed('isolated');
    const own = String(((await ctx.engine.insert('sys_work_calendar_exception', day(stored), asSystem)) as any).id);
    expect(await refusalOf(ctx.engine.update('sys_work_calendar_exception', { id: own, calendar: storedDefault }, asSystem))).toBeUndefined();
    expect(await daysOf(ctx)).toEqual([[storedDefault, '2026-10-01', 'org_b']]);
  });
});
