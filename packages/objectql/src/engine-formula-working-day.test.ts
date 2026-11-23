// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0157 D4, D6, D8 — the working-day formula functions on the engine's
 * formula paths, counting through the real `WorkCalendarService` over the
 * calendar rows of each record's own organization.
 *
 * Pinned:
 *  - a formula field (`find`, `findOne`, the write response) counts over a
 *    weekend, a National Day week and a 调休 make-up Saturday, with the
 *    organization default and with a calendar named by code;
 *  - each row counts with its own organization's calendar;
 *  - a calendar refusal (D8: not maintained; D2: no default) reads `null` and
 *    logs ONE line naming the object, the field and the refusal — never a
 *    count on the weekly pattern or the wall clock;
 *  - a computed (stored) `datetime` field — the D6 write-time column — stores
 *    the count, and stores blank when the count is refused, the write itself
 *    going through (open point 1, the decision this card's contract review
 *    rules on);
 *  - the read counts through the service's cache, and sees an edit once the
 *    cache is dropped (as a calendar or exception write drops it);
 *  - a formula that calls none of the three reads no calendar at all.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { WorkCalendarService } from './work-calendar-service.js';
import { ObjectQL } from './engine.js';

type Rec = Record<string, unknown>;

function makeRecordingLogger() {
  const warns: Array<{ message: string; meta: Rec | undefined }> = [];
  const l: any = {
    trace() {}, debug() {}, info() {}, error() {}, fatal() {},
    warn(message: string, meta?: Rec) { warns.push({ message: String(message), meta }); },
    child() { return l; },
  };
  return { logger: l, warns };
}

/** Rows keyed by object; shallow COPIES out. Equality filters only; counts every `find`. */
function makeStubDriver() {
  const stores = new Map<string, Map<string, Rec>>();
  const finds: string[] = [];
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) { s = new Map(); stores.set(obj, s); }
    return s;
  };
  let nextId = 0;
  const matches = (row: Rec, where: unknown): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where as Rec)) {
      if (k.startsWith('$')) continue;
      const expected = (v && typeof v === 'object' && '$eq' in (v as Rec)) ? (v as Rec).$eq : v;
      if ((row[k] ?? null) !== (expected ?? null)) return false;
    }
    return true;
  };
  const driver = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: { where?: unknown; limit?: number }) {
      finds.push(object);
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      const page = typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
      return page.map((r) => ({ ...r }));
    },
    async findOne(object: string, ast: { where?: unknown }) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return { ...r };
      return null;
    },
    async create(object: string, data: Rec) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row: Rec = { ...data, id };
      storeFor(object).set(id, row);
      return { ...row };
    },
    async update(object: string, id: string, data: Rec) {
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) return null;
      const updated = { ...cur, ...data, id };
      s.set(id, updated);
      return { ...updated };
    },
    async updateMany() { return 0; },
    async upsert(object: string, data: Rec) { return this.create(object, data); },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: { where?: unknown }) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, rows: Rec[]) { return Promise.all(rows.map((r) => this.create(object, r))); },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {},
    async rollback() {},
  };
  return { driver, storeFor, finds };
}

const text = (name: string) => ({ name, label: name, type: 'text' as const });
const PERIOD_FIELDS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  .map((d) => `${d}_periods`);

/** The two calendar objects, as far as the service reads them. */
const SYS_WORK_CALENDAR = {
  name: 'sys_work_calendar',
  label: 'Working Calendar',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    organization_id: text('organization_id'),
    code: text('code'),
    timezone: text('timezone'),
    is_default: { name: 'is_default', label: 'Default', type: 'boolean' as const },
    maintained_from: { name: 'maintained_from', label: 'From', type: 'date' as const },
    maintained_through: { name: 'maintained_through', label: 'Through', type: 'date' as const },
    ...Object.fromEntries(PERIOD_FIELDS.map((f) => [f, text(f)])),
  },
};
const SYS_WORK_CALENDAR_EXCEPTION = {
  name: 'sys_work_calendar_exception',
  label: 'Calendar Exception',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    calendar: text('calendar'),
    date: { name: 'date', label: 'Date', type: 'date' as const },
    kind: text('kind'),
    periods: text('periods'),
  },
};

const cel = (source: string) => ({ dialect: 'cel', source });
/** A case object: formula fields over a start day and an opened instant, and one stored due time. */
const WD_CASE = {
  name: 'wd_case',
  label: 'Case',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    // The column a tenant-scoped object is served with: the row's own organization.
    organization_id: text('organization_id'),
    start: { name: 'start', label: 'Start', type: 'date' as const },
    opened_at: { name: 'opened_at', label: 'Opened', type: 'datetime' as const },
    due_day: { name: 'due_day', label: 'Due Day', type: 'formula' as const, expression: cel('addWorkingDays(record.start, 3)') },
    due_day_weekly: {
      name: 'due_day_weekly', label: 'Due Day (weekly only)', type: 'formula' as const,
      expression: cel("addWorkingDays(record.start, 3, 'weekly_only')"),
    },
    days_left: {
      name: 'days_left', label: 'Days Left', type: 'formula' as const,
      expression: cel("workingDaysBetween(record.start, '2026-10-10')"),
    },
    due_at_read: { name: 'due_at_read', label: 'Due (read)', type: 'formula' as const, expression: cel('addWorkingHours(record.opened_at, 2)') },
    // ADR-0157 D6: the write-time column a filter can compare with {now}.
    due_at: { name: 'due_at', label: 'Due At', type: 'datetime' as const, expression: cel('addWorkingHours(record.opened_at, 2)') },
    plain: { name: 'plain', label: 'Plain', type: 'formula' as const, expression: cel('addDays(record.start, 1)') },
  },
};

const WEEKDAY = '09:00-12:00, 13:00-18:00';
const weekdays = { monday_periods: WEEKDAY, tuesday_periods: WEEKDAY, wednesday_periods: WEEKDAY, thursday_periods: WEEKDAY, friday_periods: WEEKDAY };
const calendarRow = (id: string, organization: string, code: string, isDefault: boolean, timezone = 'Asia/Shanghai'): Rec => ({
  id, organization_id: organization, code, timezone, is_default: isDefault,
  maintained_from: '2026-01-01', maintained_through: '2026-12-31', ...weekdays,
});
/** Shanghai wall clock → instant (UTC+8, no DST). */
const sh = (day: string, hm: string) => new Date(`${day}T${hm}:00+08:00`).toISOString();
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v);

async function makeRig(options: { defaultInOrgB?: boolean } = {}) {
  const { logger, warns } = makeRecordingLogger();
  const engine = new ObjectQL({ logger });
  const { driver, storeFor, finds } = makeStubDriver();
  engine.registerDriver(driver as never, true);
  await engine.init();
  for (const obj of [SYS_WORK_CALENDAR, SYS_WORK_CALENDAR_EXCEPTION, WD_CASE]) engine.registry.registerObject(obj as never, 'test');
  const service = new WorkCalendarService({
    // The tenant wall the security plugin applies in a kernel: the service's
    // elevated read under `tenantId` sees that organization's calendars only.
    getEngine: () => ({
      find: async (object: string, query: Record<string, unknown>) => {
        const tenant = (query.context as { tenantId?: string } | undefined)?.tenantId;
        const rows = await engine.find(object, query as never) as Rec[];
        return tenant === undefined ? rows : rows.filter((r) => r.organization_id === undefined || r.organization_id === tenant);
      },
    }),
    hasCalendarObject: () => Boolean(engine.registry.getObject('sys_work_calendar')),
    posture: () => 'isolated',
  });
  engine.setWorkCalendarService(service);
  // org_a: a CN default calendar with a National Day week and a 调休 make-up
  // Saturday, and the same weekly pattern with no exceptions under another code.
  const cals = storeFor('sys_work_calendar');
  cals.set('cal_cn', calendarRow('cal_cn', 'org_a', 'cn_mainland', true));
  cals.set('cal_weekly', calendarRow('cal_weekly', 'org_a', 'weekly_only', false));
  // org_b: its default counts in New York, with no exceptions.
  if (options.defaultInOrgB !== false) cals.set('cal_b', calendarRow('cal_b', 'org_b', 'us_office', true, 'America/New_York'));
  const exceptions = storeFor('sys_work_calendar_exception');
  ['01', '02', '03', '04', '05', '06', '07'].forEach((d) => {
    exceptions.set(`ex_${d}`, { id: `ex_${d}`, organization_id: 'org_a', calendar: 'cal_cn', date: `2026-10-${d}`, kind: 'off', periods: null });
  });
  exceptions.set('ex_10', { id: 'ex_10', organization_id: 'org_a', calendar: 'cal_cn', date: '2026-10-10', kind: 'on', periods: WEEKDAY });
  const faultLines = (field: string) => warns.filter((w) => w.meta?.object === 'wd_case' && w.meta?.field === field);
  return { engine, service, storeFor, finds, warns, faultLines };
}

type Rig = Awaited<ReturnType<typeof makeRig>>;

describe('ADR-0157 D4 — working-day formula fields count with the organization calendar', () => {
  let rig: Rig;
  beforeEach(async () => { rig = await makeRig(); });

  it('a read steps over the National Day week and onto the 调休 Saturday; the weekly-only calendar does not (CONTROL)', async () => {
    rig.storeFor('wd_case').set('c1', { id: 'c1', organization_id: 'org_a', start: '2026-09-30', opened_at: sh('2026-09-30', '17:00') });
    const [row] = await rig.engine.find('wd_case', {} as never) as Rec[];
    expect(iso(row!.due_day)).toBe('2026-10-10T00:00:00.000Z');
    expect(iso(row!.due_day_weekly)).toBe('2026-10-05T00:00:00.000Z');
    expect(row!.days_left).toBe(3);
    expect(iso(row!.due_at_read)).toBe(sh('2026-10-08', '10:00'));
    expect(rig.warns, JSON.stringify(rig.warns)).toEqual([]);
  });

  it('a weekend: Friday + 3 working days is Wednesday, on findOne too', async () => {
    rig.storeFor('wd_case').set('c2', { id: 'c2', organization_id: 'org_a', start: '2026-09-18' });
    const row = await rig.engine.findOne('wd_case', { where: { id: 'c2' } } as never) as Rec;
    expect(iso(row.due_day)).toBe('2026-09-23T00:00:00.000Z');
  });

  it("each row counts with its own organization's default calendar", async () => {
    rig.storeFor('wd_case').set('ca', { id: 'ca', organization_id: 'org_a', start: '2026-09-30' });
    rig.storeFor('wd_case').set('cb', { id: 'cb', organization_id: 'org_b', start: '2026-09-30' });
    const rows = await rig.engine.find('wd_case', {} as never) as Rec[];
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(iso(byId.ca!.due_day)).toBe('2026-10-10T00:00:00.000Z');
    // org_b keeps no National Day: Wednesday + 3 = Monday.
    expect(iso(byId.cb!.due_day)).toBe('2026-10-05T00:00:00.000Z');
  });

  it('the write response counts too', async () => {
    const created = await rig.engine.insert('wd_case', { organization_id: 'org_a', start: '2026-09-30' }) as Rec;
    expect(iso(created.due_day)).toBe('2026-10-10T00:00:00.000Z');
  });
});

describe('ADR-0157 D8 — a refused count reads null and says so once', () => {
  it('past maintained_through: null, and one line naming the object, the field and the refusal', async () => {
    const rig = await makeRig();
    rig.storeFor('wd_case').set('late', { id: 'late', organization_id: 'org_a', start: '2026-12-30' });
    rig.storeFor('wd_case').set('late2', { id: 'late2', organization_id: 'org_a', start: '2026-12-29' });
    const rows = await rig.engine.find('wd_case', {} as never) as Rec[];
    for (const row of rows) expect(row.due_day).toBeNull();
    const lines = rig.faultLines('due_day');
    expect(lines).toHaveLength(1);
    expect(String(lines[0]!.meta?.error)).toContain("Working calendar 'cn_mainland' is maintained from 2026-01-01 through 2026-12-31");
    // The formula that calls none of the three still evaluates (CONTROL).
    expect(iso(rows[0]!.plain)).toBe('2026-12-31T00:00:00.000Z');
  });

  it('no default calendar in the organization: null and the no-default refusal, never a wall-clock count', async () => {
    const rig = await makeRig({ defaultInOrgB: false });
    rig.storeFor('wd_case').set('cb', { id: 'cb', organization_id: 'org_b', start: '2026-09-30' });
    const [row] = await rig.engine.find('wd_case', {} as never) as Rec[];
    expect(row!.due_day).toBeNull();
    expect(String(rig.faultLines('due_day')[0]?.meta?.error)).toContain('No working calendar is marked as the default');
  });

  it('a kernel with no calendar service refuses the same way', async () => {
    const rig = await makeRig();
    rig.engine.setWorkCalendarService(undefined);
    rig.storeFor('wd_case').set('c1', { id: 'c1', organization_id: 'org_a', start: '2026-09-30' });
    const [row] = await rig.engine.find('wd_case', {} as never) as Rec[];
    expect(row!.due_day).toBeNull();
    expect(String(rig.faultLines('due_day')[0]?.meta?.error)).toContain('No working calendar is marked as the default');
  });
});

describe('ADR-0157 D6, open point 1 — the write-time due column', () => {
  it('stores the count on the write, so a filter compares a stored datetime', async () => {
    const rig = await makeRig();
    const created = await rig.engine.insert('wd_case', { organization_id: 'org_a', opened_at: sh('2026-10-09', '17:00') }) as Rec;
    const stored = rig.storeFor('wd_case').get(String(created.id))!;
    expect(iso(stored.due_at)).toBe(sh('2026-10-10', '10:00'));
  });

  it('a refused count stores blank and the write goes through, with one line naming the field', async () => {
    const rig = await makeRig();
    const created = await rig.engine.insert('wd_case', { organization_id: 'org_a', opened_at: sh('2026-12-31', '17:00') }) as Rec;
    const stored = rig.storeFor('wd_case').get(String(created.id))!;
    expect(stored).toBeDefined();
    expect(stored.due_at ?? null).toBeNull();
    expect(String(rig.faultLines('due_at')[0]?.meta?.error)).toContain('maintained from 2026-01-01 through 2026-12-31');
  });
});

describe('ADR-0157 D2 — the read counts through the service cache', () => {
  it('serves the cached calendar until the cache is dropped, then reads the edit', async () => {
    const rig = await makeRig();
    rig.storeFor('wd_case').set('c1', { id: 'c1', organization_id: 'org_a', start: '2026-09-30' });
    expect(iso(((await rig.engine.find('wd_case', {} as never)) as Rec[])[0]!.due_day)).toBe('2026-10-10T00:00:00.000Z');
    // An administrator adds a holiday on 2026-10-08, straight into the store.
    rig.storeFor('sys_work_calendar_exception').set('ex_08', {
      id: 'ex_08', organization_id: 'org_a', calendar: 'cal_cn', date: '2026-10-08', kind: 'off', periods: null,
    });
    expect(iso(((await rig.engine.find('wd_case', {} as never)) as Rec[])[0]!.due_day)).toBe('2026-10-10T00:00:00.000Z');
    // A calendar or exception write drops the cache (the service's write hooks).
    rig.service.invalidate();
    expect(iso(((await rig.engine.find('wd_case', {} as never)) as Rec[])[0]!.due_day)).toBe('2026-10-12T00:00:00.000Z');
  });

  it('a plan that calls none of the three reads no calendar', async () => {
    const rig = await makeRig();
    rig.storeFor('wd_case').set('c1', { id: 'c1', organization_id: 'org_a', start: '2026-09-30' });
    await rig.engine.find('wd_case', { fields: ['id', 'plain'] } as never);
    expect(rig.finds.filter((o) => o.startsWith('sys_work_calendar'))).toEqual([]);
  });
});
