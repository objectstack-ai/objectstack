// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0157: the working-calendar service (resolution, organization, cache,
 * the four computations) and the calendar objects' write hooks.
 *
 * The service half reads through a recording double, because what is pinned
 * is WHAT it asks the engine (which object, which organization, how often).
 * The hook half runs on a real `ObjectQL`, because what is pinned is what the
 * engine's own write path answers: the refusal envelope of a real insert.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveThrownHttpError } from '@objectstack/types';
import { WORK_CALENDAR_NOT_MAINTAINED_CODE, WORK_CALENDAR_UNRESOLVED_CODE } from '@objectstack/spec/data';
import { isWorkingDay } from '@objectstack/formula';
import { ObjectQL } from './engine.js';
import {
  WORK_CALENDAR_CACHE_TTL_MS,
  WORK_CALENDAR_EXCEPTION_OBJECT,
  WORK_CALENDAR_OBJECT,
  WorkCalendarService,
  enginePostureOf,
  installWorkCalendarHooks,
} from './work-calendar-service.js';

type Row = Record<string, any>;

// 2026-10-01 is a Thursday. A National Day week (seven `off` rows) and a 调休
// make-up Saturday (an `on` row on 2026-10-10).
const WEEKDAY = '09:00-12:00, 13:00-18:00';
const CN: Row = {
  id: 'cal_cn', code: 'cn_standard', name: 'China', timezone: 'Asia/Shanghai', is_default: true,
  maintained_from: '2026-01-01', maintained_through: '2026-12-31',
  monday_periods: WEEKDAY, tuesday_periods: WEEKDAY, wednesday_periods: WEEKDAY,
  thursday_periods: WEEKDAY, friday_periods: WEEKDAY, saturday_periods: '', sunday_periods: '',
};
const HOLIDAYS: Row[] = [
  ...['01', '02', '03', '04', '05', '06', '07'].map((d) => ({ id: `ex_${d}`, calendar: 'cal_cn', date: `2026-10-${d}`, kind: 'off' })),
  { id: 'ex_10', calendar: 'cal_cn', date: '2026-10-10', kind: 'on', periods: WEEKDAY },
];
const sh = (day: string, hm: string) => Date.parse(`${day}T${hm}:00+08:00`);
const ORG = { organizationId: 'org_a' } as const;

/**
 * A read double that answers equality `where`s and records every read. A read
 * whose context names a tenant sees that organization's rows (and rows that
 * carry none), as the engine scopes it; a read without one sees every row.
 */
function readDouble(calendars: Row[], exceptions: Row[]) {
  const reads: Array<{ object: string; query: Row }> = [];
  return {
    reads,
    async find(object: string, query: Row) {
      reads.push({ object, query });
      const src = object === WORK_CALENDAR_OBJECT ? calendars : exceptions;
      const tenant = query.context?.tenantId;
      const scoped = tenant === undefined ? src : src.filter((r) => r.organization_id === undefined || r.organization_id === tenant);
      const hits = scoped.filter((r) =>
        Object.entries(query.where ?? {}).every(([k, v]) => {
          // Equality only: a combinator or an operator object is refused, never answered wrong.
          if (k.startsWith('$') || (v !== null && typeof v === 'object')) throw new Error(`readDouble answers equality only, not ${k}`);
          return r[k] === v;
        }),
      );
      const from = query.offset ?? 0;
      return hits.slice(from, from + (query.limit ?? hits.length));
    },
  };
}

async function refusal(p: Promise<unknown>): Promise<any> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected a refusal');
}

describe('WorkCalendarService — resolution (ADR-0157 D2)', () => {
  it('takes the named code, else the organization default; refuses with no default, never wall-clock', async () => {
    // adr0112-ok: D6b — a calendar's persisted `code` column, not an error code
    const other = { ...CN, id: 'cal_x', code: 'plant_x', is_default: false };
    const svc = new WorkCalendarService({ getEngine: () => readDouble([CN, other], HOLIDAYS) });
    expect((await svc.resolve({ ...ORG, calendar: 'plant_x' })).code).toBe('plant_x');
    expect((await svc.resolve(ORG)).code).toBe('cn_standard'); // CONTROL: the default answers

    const none = new WorkCalendarService({ getEngine: () => readDouble([other], []) });
    const e = await refusal(none.resolve(ORG));
    expect(e).toMatchObject({ code: WORK_CALENDAR_UNRESOLVED_CODE, reason: 'no_default' });
    expect(resolveThrownHttpError(e)).toMatchObject({ status: 400, code: WORK_CALENDAR_UNRESOLVED_CODE });
    await expect(none.resolve({ ...ORG, calendar: 'nope' })).rejects.toMatchObject({ reason: 'not_found', calendar: 'nope' });
  });

  it('refuses two defaults rather than picking one', async () => {
    // adr0112-ok: D6b — a calendar's persisted `code` column, not an error code
    const svc = new WorkCalendarService({ getEngine: () => readDouble([CN, { ...CN, id: 'cal_2', code: 'two' }], []) });
    await expect(svc.resolve(ORG)).rejects.toMatchObject({ code: WORK_CALENDAR_UNRESOLVED_CODE, reason: 'ambiguous' });
  });

  it('never sends a name that is not a calendar code to the query layer', async () => {
    const engine = readDouble([CN], HOLIDAYS);
    const svc = new WorkCalendarService({ getEngine: () => engine });
    await expect(svc.resolve({ ...ORG, calendar: '{current_user_id}' })).rejects.toMatchObject({ reason: 'not_found' });
    expect(engine.reads).toHaveLength(0);
  });

  it('a kernel without the calendar object holds no calendar', async () => {
    const svc = new WorkCalendarService({ getEngine: () => readDouble([CN], []), hasCalendarObject: () => false });
    await expect(svc.resolve(ORG)).rejects.toMatchObject({ reason: 'no_default' });
  });
});

describe('WorkCalendarService — organization and authority (ADR-0157 open point 4)', () => {
  it('reads elevated in the organization the caller names, for the calendar and its exceptions', async () => {
    const engine = readDouble([CN], HOLIDAYS);
    await new WorkCalendarService({ getEngine: () => engine }).resolve({ organizationId: 'org_b', calendar: 'cn_standard' });
    expect(engine.reads.map((r) => [r.object, r.query.context])).toEqual([
      [WORK_CALENDAR_OBJECT, { isSystem: true, tenantId: 'org_b' }],
      [WORK_CALENDAR_EXCEPTION_OBJECT, { isSystem: true, tenantId: 'org_b' }],
    ]);
    expect(engine.reads[1]!.query.where).toEqual({ calendar: 'cal_cn' });
  });
});

describe('WorkCalendarService — no organization, outside `single` (ADR-0157 open point 4)', () => {
  // A calendar that only organization B holds, as its default and by code.
  const B_ONLY: Row = { ...CN, id: 'cal_b', code: 'plant_b', organization_id: 'org_b' };

  for (const posture of ['isolated', 'group'] as const) {
    it(`${posture}: a code or a default only another organization holds is refused before any read`, async () => {
      const engine = readDouble([B_ONLY], []);
      const svc = new WorkCalendarService({ getEngine: () => engine, posture: () => posture });
      for (const ref of [{ organizationId: undefined, calendar: 'plant_b' }, { organizationId: undefined }, { organizationId: '' }]) {
        const e = await refusal(svc.resolve(ref));
        expect(e).toMatchObject({ code: WORK_CALENDAR_UNRESOLVED_CODE, reason: 'no_organization' });
        expect(resolveThrownHttpError(e)).toMatchObject({ status: 400, code: WORK_CALENDAR_UNRESOLVED_CODE });
      }
      await expect(svc.addWorkingDays({ organizationId: undefined }, '2026-09-30', 1)).rejects.toMatchObject({ reason: 'no_organization' });
      expect(engine.reads).toHaveLength(0);
      // CONTROL: named, the organization that holds it resolves it.
      expect((await svc.resolve({ organizationId: 'org_b', calendar: 'plant_b' })).code).toBe('plant_b');
    });
  }

  it('single: a computation without an organization reads unscoped, as before', async () => {
    const engine = readDouble([B_ONLY], []);
    const svc = new WorkCalendarService({ getEngine: () => engine, posture: () => 'single' });
    expect((await svc.resolve({ organizationId: undefined })).code).toBe('plant_b');
    expect(engine.reads[0]!.query.context).toEqual({ isSystem: true });
  });

  it('reads the posture the engine enforces when none is passed', async () => {
    const engine = new ObjectQL();
    engine.setTenancyPostureProvider(() => 'isolated');
    expect(enginePostureOf(engine)).toBe('isolated');
    const svc = new WorkCalendarService({ getEngine: () => engine as never });
    await expect(svc.resolve({ organizationId: undefined })).rejects.toMatchObject({ reason: 'no_organization' });
    engine.setTenancyPostureProvider(() => 'single');
    expect(enginePostureOf(engine)).toBe('single'); // CONTROL
  });
});

describe('WorkCalendarService — the cache', () => {
  it('serves one read until a write invalidates it or the TTL runs out; a refusal is never cached', async () => {
    let now = 1_000;
    const calendars: Row[] = [];
    const engine = readDouble(calendars, HOLIDAYS);
    const svc = new WorkCalendarService({ getEngine: () => engine, now: () => now });
    await expect(svc.resolve(ORG)).rejects.toMatchObject({ reason: 'no_default' });
    calendars.push(CN); // the administrator fixes it
    await svc.resolve(ORG);
    const afterFix = engine.reads.length;
    await svc.resolve(ORG);
    expect(engine.reads.length).toBe(afterFix); // cached
    svc.invalidate();
    await svc.resolve(ORG);
    expect(engine.reads.length).toBe(afterFix + 2);
    now += WORK_CALENDAR_CACHE_TTL_MS;
    await svc.resolve(ORG);
    expect(engine.reads.length).toBe(afterFix + 4);
  });
});

describe('WorkCalendarService — a 调休 Saturday and a National Day week (ADR-0157 D1, D10)', () => {
  const svc = new WorkCalendarService({ getEngine: () => readDouble([CN], HOLIDAYS) });
  // CONTROL: the same calendar with no exceptions entered.
  const bare = new WorkCalendarService({ getEngine: () => readDouble([CN], []) });

  it('addWorkingDays and workingDaysBetween step over the week and onto the Saturday', async () => {
    expect(await svc.addWorkingDays(ORG, '2026-09-30', 1)).toBe('2026-10-08');
    expect(await svc.addWorkingDays(ORG, '2026-09-30', 3)).toBe('2026-10-10');
    expect(await bare.addWorkingDays(ORG, '2026-09-30', 1)).toBe('2026-10-01');
    expect(await svc.workingDaysBetween(ORG, '2026-09-30', '2026-10-10')).toBe(3);
    expect(await bare.workingDaysBetween(ORG, '2026-09-30', '2026-10-10')).toBe(7);
  });

  it('addWorkingHours and isWorkingTime count the same days', async () => {
    expect(await svc.addWorkingHours(ORG, sh('2026-09-30', '17:00'), 2)).toBe(sh('2026-10-08', '10:00'));
    expect(await svc.addWorkingHours(ORG, sh('2026-10-09', '17:00'), 2)).toBe(sh('2026-10-10', '10:00'));
    expect(await bare.addWorkingHours(ORG, sh('2026-09-30', '17:00'), 2)).toBe(sh('2026-10-01', '10:00'));
    expect(await svc.isWorkingTime(ORG, sh('2026-10-10', '10:00'))).toBe(true);
    expect(await svc.isWorkingTime(ORG, sh('2026-10-05', '10:00'))).toBe(false);
    expect(await bare.isWorkingTime(ORG, sh('2026-10-05', '10:00'))).toBe(true);
  });

  it('a span past maintained_through is refused (D8)', async () => {
    const e = await refusal(svc.addWorkingDays(ORG, '2026-12-30', 3));
    expect(e).toMatchObject({ code: WORK_CALENDAR_NOT_MAINTAINED_CODE, date: '2027-01-01' });
    expect(resolveThrownHttpError(e)).toMatchObject({ status: 400, code: WORK_CALENDAR_NOT_MAINTAINED_CODE });
    expect(await svc.addWorkingDays(ORG, '2026-12-29', 2)).toBe('2026-12-31'); // CONTROL
  });
});

// ── The write hooks, on a real engine ──────────────────────────────────

const text = { type: 'text' };
const CALENDAR_SCHEMA = {
  name: WORK_CALENDAR_OBJECT,
  label: 'Working Calendar',
  fields: {
    code: text, name: text, timezone: text, is_default: { type: 'boolean' },
    maintained_from: { type: 'date' }, maintained_through: { type: 'date' },
    monday_periods: text, tuesday_periods: text, wednesday_periods: text, thursday_periods: text,
    friday_periods: text, saturday_periods: text, sunday_periods: text,
  },
};
const EXCEPTION_SCHEMA = {
  name: WORK_CALENDAR_EXCEPTION_OBJECT,
  label: 'Calendar Exception',
  fields: { calendar: text, date: { type: 'date' }, kind: text, periods: text, note: text },
};

function memoryDriver() {
  const tables = new Map<string, Map<string, Row>>();
  const table = (o: string) => tables.get(o) ?? tables.set(o, new Map()).get(o)!;
  const matches = (r: Row, where: Row = {}) =>
    Object.entries(where).every(([k, v]) => (v && typeof v === 'object' ? true : r[k] === v));
  return {
    name: 'com.objectstack.driver.memory.work-calendar', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async initObjects() {}, async checkHealth() { return true; },
    async find(o: string, q?: any) {
      const rows = [...table(o).values()].filter((r) => matches(r, q?.where));
      return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
    },
    async findOne(o: string, q?: any) { return [...table(o).values()].find((r) => matches(r, q?.where)) ?? null; },
    async count(o: string, q?: any) { return [...table(o).values()].filter((r) => matches(r, q?.where)).length; },
    async create(o: string, data: Row) { table(o).set(String(data.id), { ...data }); return { ...data }; },
    async update(o: string, data: Row, q?: any) {
      const id = String(q?.where?.id ?? data.id);
      const next = { ...(table(o).get(id) ?? { id }), ...data };
      table(o).set(id, next);
      return next;
    },
    async delete(o: string, q?: any) { return table(o).delete(String(q?.where?.id)) ? { deleted: 1 } : false; },
  } as any;
}

describe('the calendar objects\' write door (ADR-0157 D2, D7, D10)', () => {
  let engine: ObjectQL;
  let svc: WorkCalendarService;
  let zoneAsked: Array<string | undefined>;

  beforeEach(async () => {
    engine = new ObjectQL();
    engine.registerDriver(memoryDriver(), true);
    await engine.init();
    engine.registry.registerObject(CALENDAR_SCHEMA as any, 'com.objectstack.test.work-calendar');
    engine.registry.registerObject(EXCEPTION_SCHEMA as any, 'com.objectstack.test.work-calendar');
    engine.setTenancyPostureProvider(() => 'single');
    svc = new WorkCalendarService({ getEngine: () => engine as never });
    zoneAsked = [];
    installWorkCalendarHooks(engine as never, svc, {
      timezoneOf: async (org) => { zoneAsked.push(org); return 'Asia/Shanghai'; },
    });
  });

  afterEach(async () => {
    try { await engine.destroy(); } catch { /* noop */ }
  });

  const insertCalendar = (row: Row) => engine.insert(WORK_CALENDAR_OBJECT, { ...CN, ...row }, { context: { isSystem: true } });

  it('refuses a period that crosses midnight, on insert and on update; accepts 24:00 (D7, D10)', async () => {
    const e = await refusal(insertCalendar({ id: 'c1', monday_periods: '22:00-06:00' }));
    expect(resolveThrownHttpError(e)).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    expect(e.fields).toEqual([expect.objectContaining({ field: 'monday_periods', code: 'invalid_value' })]);
    await insertCalendar({ id: 'c2', monday_periods: '18:00-24:00' }); // CONTROL
    const u = await refusal(engine.update(WORK_CALENDAR_OBJECT, { friday_periods: '23:00-01:00' }, { where: { id: 'c2' }, context: { isSystem: true } }));
    expect(u.fields).toEqual([expect.objectContaining({ field: 'friday_periods', code: 'invalid_value' })]);
  });

  it('refuses a malformed period and a span that ends before it starts', async () => {
    const e = await refusal(insertCalendar({ id: 'c1', tuesday_periods: '9:00-12:00' }));
    expect(e.fields).toEqual([expect.objectContaining({ field: 'tuesday_periods', code: 'invalid_format' })]);
    const span = await refusal(insertCalendar({ id: 'c2', maintained_from: '2027-01-01', maintained_through: '2026-12-31' }));
    expect(span.fields).toEqual([expect.objectContaining({ field: 'maintained_through', code: 'invalid_value' })]);
  });

  it('refuses a second default in the organization (D2)', async () => {
    await insertCalendar({ id: 'c1' });
    const e = await refusal(insertCalendar({ id: 'c2', code: 'second' }));
    expect(e.fields).toEqual([expect.objectContaining({ field: 'is_default', code: 'invalid_value' })]);
    await insertCalendar({ id: 'c3', code: 'third', is_default: false }); // CONTROL
  });

  it('a create that leaves the time zone out takes the organization\'s (D7)', async () => {
    await engine.insert(WORK_CALENDAR_OBJECT, { ...CN, id: 'c1', timezone: undefined, organization_id: 'org_z' }, { context: { isSystem: true, tenantId: 'org_z' } });
    const [row] = await engine.find(WORK_CALENDAR_OBJECT, { where: { id: 'c1' }, context: { isSystem: true } });
    expect(row?.timezone).toBe('Asia/Shanghai');
    expect(zoneAsked).toEqual(['org_z']);
  });

  it('refuses an off row with periods and an on row without them (D10)', async () => {
    const insertException = (row: Row) => engine.insert(WORK_CALENDAR_EXCEPTION_OBJECT, row, { context: { isSystem: true } });
    const off = await refusal(insertException({ id: 'x1', calendar: 'cal_cn', date: '2026-10-01', kind: 'off', periods: '09:00-12:00' }));
    expect(resolveThrownHttpError(off)).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    expect(off.fields).toEqual([expect.objectContaining({ field: 'periods', code: 'invalid_value' })]);
    const on = await refusal(insertException({ id: 'x2', calendar: 'cal_cn', date: '2026-10-10', kind: 'on' }));
    expect(on.fields).toEqual([expect.objectContaining({ field: 'periods', code: 'required' })]);
    await insertException({ id: 'x3', calendar: 'cal_cn', date: '2026-10-10', kind: 'on', periods: '09:00-12:00' }); // CONTROL
  });

  it('a calendar or exception write drops the cached calendar', async () => {
    await insertCalendar({ id: 'cal_cn' });
    expect(isWorkingDay(await svc.resolve(ORG), '2026-10-12')).toBe(true);
    await engine.insert(WORK_CALENDAR_EXCEPTION_OBJECT, { id: 'x1', calendar: 'cal_cn', date: '2026-10-12', kind: 'off' }, { context: { isSystem: true } });
    expect(isWorkingDay(await svc.resolve(ORG), '2026-10-12')).toBe(false);
  });
});

describe('the calendar hooks take the organization from the session', () => {
  const A_DEFAULT: Row = { ...CN, id: 'cal_a', code: 'plant_a', organization_id: 'org_a' };
  const B_DEFAULT: Row = { ...CN, id: 'cal_b', code: 'plant_b', organization_id: 'org_b' };
  const created = (organizationId?: string): Row => ({
    ...CN, id: 'cal_new', code: 'new_one', timezone: undefined,
    ...(organizationId === undefined ? {} : { organization_id: organizationId }),
  });

  /** The hooks bound on a read double, with the time-zone reads they ask for. */
  function bound(posture: 'single' | 'isolated') {
    const handlers = new Map<string, (ctx: any) => unknown>();
    const engine = {
      ...readDouble([A_DEFAULT, B_DEFAULT], []),
      registerHook(event: string, handler: (ctx: any) => unknown, options?: Row) {
        handlers.set(`${event}:${String(options?.object)}`, handler);
      },
    };
    const zoneAsked: Array<string | undefined> = [];
    installWorkCalendarHooks(engine, { invalidate() {} }, {
      posture: () => posture,
      timezoneOf: async (org) => { zoneAsked.push(org); return 'Asia/Shanghai'; },
    });
    const insert = (session: Row, data: Row) =>
      handlers.get(`beforeInsert:${WORK_CALENDAR_OBJECT}`)!({ session, input: { data, options: {} } });
    const update = (session: Row, data: Row, previous: Row) =>
      handlers.get(`beforeUpdate:${WORK_CALENDAR_OBJECT}`)!({ session, input: { data, options: {} }, previous });
    return { reads: engine.reads, zoneAsked, insert, update };
  }
  const member = { userId: 'usr_1', organizationId: 'org_a', isSystem: false };

  for (const posture of ['single', 'isolated'] as const) {
    it(`${posture}: a member's create reads in the session's organization`, async () => {
      const h = bound(posture);
      const row = created('org_b');
      await h.insert(member, row);
      expect(h.reads).toEqual([]);
      expect(h.zoneAsked).toEqual([]);
      expect(row.timezone).toBeUndefined();

      // CONTROL: the session's own organization is read, and judged.
      const own = bound(posture);
      const e = await refusal(Promise.resolve(own.insert(member, created())));
      expect(e.fields).toEqual([expect.objectContaining({ field: 'is_default', code: 'invalid_value' })]);
      expect(e.message).toContain('plant_a');
      expect(own.reads.map((r) => r.query.context?.tenantId)).toEqual(['org_a']);
      expect(own.zoneAsked).toEqual(['org_a']);
    });
  }

  it('a system writer reads in its session\'s organization too', async () => {
    const h = bound('isolated');
    const e = await refusal(Promise.resolve(h.insert({ isSystem: true, organizationId: 'org_b' }, created('org_b'))));
    expect(e.message).toContain('plant_b');
    expect(h.zoneAsked).toEqual(['org_b']);
    const other = bound('isolated');
    await other.insert({ isSystem: true }, created('org_b'));
    expect(other.reads).toEqual([]);
  });

  it('isolated: a write that names no organization reads nothing', async () => {
    const stored: Row = { ...CN, id: 'cal_old', code: 'old_one', is_default: false };
    const h = bound('isolated');
    await h.insert({ isSystem: true }, created());
    await h.update({ isSystem: true }, { is_default: true }, stored);
    expect(h.reads).toEqual([]);
    expect(h.zoneAsked).toEqual([]);
    // CONTROL: under `single` the same writes read, and are judged.
    const single = bound('single');
    for (const write of [() => single.insert({ isSystem: true }, created()), () => single.update({ isSystem: true }, { is_default: true }, stored)]) {
      const e = await refusal(Promise.resolve(write()));
      expect(resolveThrownHttpError(e)).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    }
  });
});
