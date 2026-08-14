// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReportService, renderReport, type ReportEmail } from './report-service.js';

// ─── Fake engine ──────────────────────────────────────────────────

interface FakeRow { [k: string]: any }

function makeFakeEngine() {
  const tables: Record<string, FakeRow[]> = {};
  const ensure = (n: string) => (tables[n] ??= []);

  function matches(row: FakeRow, filter: any): boolean {
    if (!filter || typeof filter !== 'object') return true;
    for (const [k, v] of Object.entries(filter)) {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      if (row[k] !== v) return false;
    }
    return true;
  }

  return {
    _tables: tables,
    async find(object: string, options?: any) {
      const rows = ensure(object).filter(r => matches(r, options?.filter ?? options?.where));
      if (options?.orderBy?.[0]) {
        // Canonical SortNode key only (spec/data/query.zod.ts): the real
        // engine strips an unknown `direction:` key and defaults to asc, so
        // the mock must too — honoring both keys masks wrong-key sorts.
        const { field, order } = options.orderBy[0];
        rows.sort((a, b) => {
          const av = a[field]; const bv = b[field];
          if (av === bv) return 0;
          const cmp = av > bv ? 1 : -1;
          return order === 'desc' ? -cmp : cmp;
        });
      }
      return rows.slice(0, options?.limit ?? 1000);
    },
    async insert(object: string, data: any) {
      ensure(object).push({ ...data });
      return { ...data };
    },
    async update(object: string, idOrData: any, _opts?: any) {
      const data = typeof idOrData === 'object' ? idOrData : _opts;
      const id = typeof idOrData === 'object' ? idOrData.id : idOrData;
      const table = ensure(object);
      const i = table.findIndex(r => r.id === id);
      if (i >= 0) table[i] = { ...table[i], ...data };
      return table[i];
    },
    async delete(object: string, options?: any) {
      const table = ensure(object);
      const id = options?.where?.id ?? options?.id;
      const i = table.findIndex(r => r.id === id);
      if (i >= 0) table.splice(i, 1);
      return { id };
    },
  };
}

function makeFakeEmail() {
  const sent: any[] = [];
  const email: ReportEmail & { _sent: any[] } = {
    _sent: sent,
    async send(input) { sent.push(input); return { status: 'sent' }; },
  };
  return email;
}

const CTX = { userId: 'u1', tenantId: 't1', positions: [], permissions: [] };

// ─── Rendering ─────────────────────────────────────────────────────

describe('renderReport', () => {
  it('csv: escapes quotes / commas / newlines per RFC 4180', () => {
    const out = renderReport(
      [{ a: 'x,y', b: 'has "q"', c: 'line\n2' }],
      'csv',
      ['a', 'b', 'c'],
    );
    expect(out).toBe('a,b,c\r\n"x,y","has ""q""","line\n2"');
  });

  it('csv: header-only when no rows', () => {
    expect(renderReport([], 'csv', ['a', 'b'])).toBe('a,b');
  });

  it('html_table: escapes HTML entities', () => {
    const out = renderReport([{ name: '<script>' }], 'html_table', ['name']);
    expect(out).toContain('&lt;script&gt;');
    expect(out).not.toContain('<script>');
  });

  it('json: pretty-prints rows', () => {
    const out = renderReport([{ a: 1 }], 'json');
    expect(JSON.parse(out)).toEqual([{ a: 1 }]);
  });

  it('auto-detects fields from first 50 rows when none specified', () => {
    const out = renderReport([{ a: 1 }, { b: 2 }], 'csv');
    expect(out.split('\r\n')[0]).toMatch(/a|b/);
  });
});

// ─── Service ──────────────────────────────────────────────────────

describe('ReportService', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let email: ReturnType<typeof makeFakeEmail>;
  let svc: ReportService;
  const now = new Date('2026-01-15T10:00:00Z');

  beforeEach(() => {
    engine = makeFakeEngine();
    email = makeFakeEmail();
    svc = new ReportService({
      engine: engine as any,
      email,
      clock: { now: () => now },
      maxRows: 5000,
      // Scheduled runs execute under the owner's resolved context (#2980).
      // The fake engine ignores context, so this just lets dispatch proceed
      // under a non-elevated identity instead of failing closed.
      resolveOwnerContext: async (ownerId: string) =>
        ownerId ? { userId: ownerId, tenantId: 't1', positions: [], permissions: [] } : null,
    });
    // seed the underlying object the report will query.
    engine._tables['lead'] = [
      { id: 'l1', name: 'Acme', status: 'open' },
      { id: 'l2', name: 'Beta', status: 'open' },
      { id: 'l3', name: 'Gamma', status: 'closed' },
    ];
  });

  it('saveReport: creates with a generated id and serialises query', async () => {
    const r = await svc.saveReport({
      name: 'Open leads',
      object: 'lead',
      query: { filter: { status: 'open' } },
      format: 'csv',
    }, CTX);
    expect(r.id).toMatch(/^rpt_/);
    expect(r.name).toBe('Open leads');
    expect(r.object_name).toBe('lead');
    const stored = engine._tables['sys_saved_report']?.[0];
    expect(stored?.query_json).toBe(JSON.stringify({ filter: { status: 'open' } }));
    expect(stored?.owner_id).toBe('u1');
  });

  it('saveReport: upserts when id matches existing row', async () => {
    const a = await svc.saveReport({ name: 'A', object: 'lead', query: {} }, CTX);
    const b = await svc.saveReport({ id: a.id, name: 'A-renamed', object: 'lead', query: {} }, CTX);
    expect(b.id).toBe(a.id);
    expect(b.name).toBe('A-renamed');
    expect(engine._tables['sys_saved_report'].length).toBe(1);
  });

  it('saveReport: rejects missing required fields', async () => {
    await expect(svc.saveReport({ name: '', object: 'lead', query: {} }, CTX))
      .rejects.toThrow(/VALIDATION_FAILED/);
    await expect(svc.saveReport({ name: 'x', object: '', query: {} }, CTX))
      .rejects.toThrow(/VALIDATION_FAILED/);
  });

  it('listReports: filters by object + owner', async () => {
    await svc.saveReport({ name: 'A', object: 'lead', query: {} }, CTX);
    await svc.saveReport({ name: 'B', object: 'account', query: {} }, CTX);
    const leads = await svc.listReports({ object: 'lead' }, CTX);
    expect(leads.length).toBe(1);
    expect(leads[0].name).toBe('A');
  });

  it('listReports: most recently updated first', async () => {
    // Regression: the query sorted with the non-canonical `direction: 'desc'`
    // key, which SortNode strips — so it sorted ascending (oldest first).
    engine._tables['sys_saved_report'] = [
      { id: 'r_old', name: 'Old', object_name: 'lead', query_json: '{}', owner_id: 'u1', updated_at: '2026-01-01T00:00:00Z' },
      { id: 'r_new', name: 'New', object_name: 'lead', query_json: '{}', owner_id: 'u1', updated_at: '2026-03-01T00:00:00Z' },
      { id: 'r_mid', name: 'Mid', object_name: 'lead', query_json: '{}', owner_id: 'u1', updated_at: '2026-02-01T00:00:00Z' },
    ];
    const rows = await svc.listReports({ object: 'lead' }, CTX);
    expect(rows.map(r => r.id)).toEqual(['r_new', 'r_mid', 'r_old']);
  });

  it('getReport: returns null on miss', async () => {
    expect(await svc.getReport('nope', CTX)).toBeNull();
  });

  it('deleteReport: cascades to schedules', async () => {
    const r = await svc.saveReport({ name: 'A', object: 'lead', query: {} }, CTX);
    await svc.scheduleReport({ reportId: r.id, recipients: ['x@test'] }, CTX);
    expect(engine._tables['sys_report_schedule'].length).toBe(1);
    await svc.deleteReport(r.id, CTX);
    expect(engine._tables['sys_saved_report'].length).toBe(0);
    expect(engine._tables['sys_report_schedule'].length).toBe(0);
  });

  it('run: executes query and stamps last_run_at/last_row_count', async () => {
    const r = await svc.saveReport({
      name: 'Open', object: 'lead', query: { filter: { status: 'open' } }, format: 'csv',
    }, CTX);
    const result = await svc.run(r.id, CTX);
    expect(result.rowCount).toBe(2);
    expect(result.format).toBe('csv');
    expect(result.body).toContain('Acme');
    const stored = engine._tables['sys_saved_report'][0];
    expect(stored.last_row_count).toBe(2);
    expect(stored.last_run_at).toBe(now.toISOString());
  });

  it('run: throws REPORT_NOT_FOUND for unknown id', async () => {
    await expect(svc.run('nope', CTX)).rejects.toThrow(/REPORT_NOT_FOUND/);
  });

  it('runAdHoc: executes without stamping any row', async () => {
    const result = await svc.runAdHoc({
      name: 'temp', object: 'lead', query: {}, format: 'json',
    }, CTX);
    expect(result.rowCount).toBe(3);
    expect(engine._tables['sys_saved_report']).toBeUndefined();
  });

  it('scheduleReport: requires non-empty recipients', async () => {
    const r = await svc.saveReport({ name: 'A', object: 'lead', query: {} }, CTX);
    await expect(svc.scheduleReport({ reportId: r.id, recipients: [] }, CTX))
      .rejects.toThrow(/VALIDATION_FAILED/);
  });

  it('scheduleReport: rejects unknown report', async () => {
    await expect(svc.scheduleReport({ reportId: 'nope', recipients: ['x@t'] }, CTX))
      .rejects.toThrow(/REPORT_NOT_FOUND/);
  });

  it('scheduleReport: computes next_run_at from interval', async () => {
    const r = await svc.saveReport({ name: 'A', object: 'lead', query: {} }, CTX);
    const s = await svc.scheduleReport({
      reportId: r.id, recipients: ['x@t'], intervalMinutes: 60, format: 'csv',
    }, CTX);
    const expected = new Date(now.getTime() + 60 * 60_000).toISOString();
    expect(s.next_run_at).toBe(expected);
    expect(s.recipients).toBe('x@t');
  });

  it('scheduleReport: cron_expression drives next_run_at and overrides interval (#1983)', async () => {
    const r = await svc.saveReport({ name: 'A', object: 'lead', query: {} }, CTX);
    // now = 2026-01-15T10:00:00Z (past 09:00); daily-9am cron → tomorrow 09:00Z.
    const s = await svc.scheduleReport({
      reportId: r.id, recipients: ['x@t'], intervalMinutes: 60, cronExpression: '0 9 * * *',
    }, CTX);
    expect(s.cron_expression).toBe('0 9 * * *');
    expect(s.next_run_at).toBe('2026-01-16T09:00:00.000Z');
    // …not the interval's now + 60m.
    expect(s.next_run_at).not.toBe(new Date(now.getTime() + 60 * 60_000).toISOString());
  });

  it('scheduleReport: cron honors the schedule timezone (#1983)', async () => {
    const r = await svc.saveReport({ name: 'A', object: 'lead', query: {} }, CTX);
    // 09:00 America/New_York (UTC-5 in January) = 14:00Z; now=05:00 ET → same day.
    const s = await svc.scheduleReport({
      reportId: r.id, recipients: ['x@t'], cronExpression: '0 9 * * *', timezone: 'America/New_York',
    }, CTX);
    expect(s.next_run_at).toBe('2026-01-15T14:00:00.000Z');
  });

  it('scheduleReport: rejects an invalid cron_expression (#1983)', async () => {
    const r = await svc.saveReport({ name: 'A', object: 'lead', query: {} }, CTX);
    await expect(svc.scheduleReport({
      reportId: r.id, recipients: ['x@t'], cronExpression: 'not a cron',
    }, CTX)).rejects.toThrow(/VALIDATION_FAILED/);
  });

  it('dispatchDue: advances a cron schedule to the next cron occurrence (#1983)', async () => {
    const r = await svc.saveReport({ name: 'A', object: 'lead', query: {} }, CTX);
    await svc.scheduleReport({
      reportId: r.id, recipients: ['x@t'], cronExpression: '0 9 * * *', format: 'csv',
    }, CTX);
    // Force due, then dispatch at `now`.
    engine._tables['sys_report_schedule'][0].next_run_at = new Date(now.getTime() - 1000).toISOString();
    const result = await svc.dispatchDue();
    expect(result.fired).toBe(1);
    const advanced = engine._tables['sys_report_schedule'][0];
    expect(advanced.last_status).toBe('ok');
    // Advanced via cron (tomorrow 09:00Z), not now + interval.
    expect(advanced.next_run_at).toBe('2026-01-16T09:00:00.000Z');
  });

  it('listSchedules + unscheduleReport', async () => {
    const r = await svc.saveReport({ name: 'A', object: 'lead', query: {} }, CTX);
    const s = await svc.scheduleReport({ reportId: r.id, recipients: ['x@t'] }, CTX);
    expect((await svc.listSchedules({ reportId: r.id }, CTX)).length).toBe(1);
    await svc.unscheduleReport(s.id, CTX);
    expect((await svc.listSchedules({ reportId: r.id }, CTX)).length).toBe(0);
  });

  it('dispatchDue: fires HTML schedule and emails inline html', async () => {
    const r = await svc.saveReport({
      name: 'Open leads', object: 'lead', query: { filter: { status: 'open' } },
    }, CTX);
    const s = await svc.scheduleReport({
      reportId: r.id, recipients: ['ops@t'], intervalMinutes: 60, format: 'html_table',
      subjectTemplate: '{{name}}: {{rows}} on {{date}}',
    }, CTX);
    // Force the schedule due.
    engine._tables['sys_report_schedule'][0].next_run_at = new Date(now.getTime() - 1000).toISOString();

    const result = await svc.dispatchDue();
    expect(result).toEqual({ fired: 1, failed: 0, skipped: 0 });
    expect(email._sent.length).toBe(1);
    expect(email._sent[0].subject).toBe('Open leads: 2 on 2026-01-15');
    expect(email._sent[0].html).toContain('<table');
    expect(email._sent[0].relatedObject).toBe('sys_report_schedule');
    expect(email._sent[0].relatedId).toBe(s.id);

    const advanced = engine._tables['sys_report_schedule'][0];
    expect(advanced.last_status).toBe('ok');
    expect(advanced.last_sent_at).toBe(now.toISOString());
    expect(advanced.next_run_at).toBe(new Date(now.getTime() + 60 * 60_000).toISOString());
  });

  it('dispatchDue: csv schedule attaches a file', async () => {
    const r = await svc.saveReport({ name: 'Open', object: 'lead', query: {} }, CTX);
    await svc.scheduleReport({
      reportId: r.id, recipients: ['ops@t'], intervalMinutes: 60, format: 'csv',
    }, CTX);
    engine._tables['sys_report_schedule'][0].next_run_at = new Date(now.getTime() - 1).toISOString();

    await svc.dispatchDue();
    expect(email._sent[0].attachments?.[0].filename).toMatch(/\.csv$/);
    expect(email._sent[0].attachments?.[0].contentType).toBe('text/csv');
    expect(email._sent[0].attachments?.[0].content).toContain('Acme');
  });

  it('dispatchDue: marks skipped when report disappeared', async () => {
    const r = await svc.saveReport({ name: 'A', object: 'lead', query: {} }, CTX);
    await svc.scheduleReport({ reportId: r.id, recipients: ['x@t'] }, CTX);
    engine._tables['sys_report_schedule'][0].next_run_at = new Date(now.getTime() - 1).toISOString();
    // Nuke the report row out of band.
    engine._tables['sys_saved_report'] = [];

    const result = await svc.dispatchDue();
    expect(result.skipped).toBe(1);
    expect(result.fired).toBe(0);
    expect(engine._tables['sys_report_schedule'][0].last_status).toBe('skipped');
    expect(email._sent.length).toBe(0);
  });

  it('dispatchDue: skips schedules not yet due', async () => {
    const r = await svc.saveReport({ name: 'A', object: 'lead', query: {} }, CTX);
    await svc.scheduleReport({ reportId: r.id, recipients: ['x@t'], intervalMinutes: 60 }, CTX);
    // next_run_at is now + 1h, so dispatching at `now` should skip it.
    const result = await svc.dispatchDue();
    expect(result.fired).toBe(0);
    expect(email._sent.length).toBe(0);
  });

  it('dispatchDue: marks failed when engine.find throws on the target', async () => {
    const r = await svc.saveReport({ name: 'A', object: 'lead', query: {} }, CTX);
    await svc.scheduleReport({ reportId: r.id, recipients: ['x@t'] }, CTX);
    engine._tables['sys_report_schedule'][0].next_run_at = new Date(now.getTime() - 1).toISOString();

    // Patch find to throw only for the lead object.
    const originalFind = engine.find.bind(engine);
    engine.find = vi.fn(async (object: string, opts: any) => {
      if (object === 'lead') throw new Error('boom');
      return originalFind(object, opts);
    }) as any;

    const result = await svc.dispatchDue();
    expect(result.failed).toBe(1);
    expect(engine._tables['sys_report_schedule'][0].last_status).toBe('failed');
    expect(engine._tables['sys_report_schedule'][0].last_error).toContain('boom');
  });

  it('dispatchDue: still runs (no mail) when email service absent', async () => {
    const svcNoMail = new ReportService({
      engine: engine as any,
      clock: { now: () => now },
      resolveOwnerContext: async (ownerId: string) => ({ userId: ownerId, positions: [], permissions: [] }),
    });
    const r = await svcNoMail.saveReport({ name: 'A', object: 'lead', query: {} }, CTX);
    await svcNoMail.scheduleReport({ reportId: r.id, recipients: ['x@t'] }, CTX);
    engine._tables['sys_report_schedule'][0].next_run_at = new Date(now.getTime() - 1).toISOString();

    const result = await svcNoMail.dispatchDue();
    expect(result.fired).toBe(1);
    expect(engine._tables['sys_report_schedule'][0].last_status).toBe('ok');
  });

  // ─── Authorization (#2980) ──────────────────────────────────────
  describe('access control', () => {
    const OTHER = { userId: 'u2', tenantId: 't1', positions: [], permissions: [] };

    it('getReport: a non-owner cannot read another user\'s report (not-found)', async () => {
      const r = await svc.saveReport({ name: 'Mine', object: 'lead', query: {} }, CTX);
      expect(await svc.getReport(r.id, CTX)).not.toBeNull();     // owner sees it
      expect(await svc.getReport(r.id, OTHER)).toBeNull();       // stranger cannot
    });

    it('deleteReport: a non-owner cannot delete another user\'s report', async () => {
      const r = await svc.saveReport({ name: 'Mine', object: 'lead', query: {} }, CTX);
      await expect(svc.deleteReport(r.id, OTHER)).rejects.toThrow(/REPORT_NOT_FOUND/);
      expect(engine._tables['sys_saved_report'].length).toBe(1); // still there
      await svc.deleteReport(r.id, CTX);                          // owner can
      expect(engine._tables['sys_saved_report'].length).toBe(0);
    });

    it('saveReport: a non-owner cannot overwrite another user\'s report by id', async () => {
      const r = await svc.saveReport({ name: 'Mine', object: 'lead', query: {} }, CTX);
      await expect(
        svc.saveReport({ id: r.id, name: 'Hijacked', object: 'lead', query: {} }, OTHER),
      ).rejects.toThrow(/REPORT_NOT_FOUND/);
      expect(engine._tables['sys_saved_report'][0].name).toBe('Mine');
    });

    it('saveReport: a caller cannot assign ownership to someone else on create', async () => {
      const r = await svc.saveReport(
        { name: 'X', object: 'lead', query: {}, ownerId: 'victim' } as any,
        CTX,
      );
      expect(r.owner_id).toBe('u1');
    });

    it('listReports: only the caller\'s own reports are returned', async () => {
      await svc.saveReport({ name: 'A', object: 'lead', query: {} }, CTX);   // u1
      await svc.saveReport({ name: 'B', object: 'lead', query: {} }, OTHER); // u2
      const mine = await svc.listReports({}, CTX);
      expect(mine.map(r => r.name)).toEqual(['A']);
      const theirs = await svc.listReports({}, OTHER);
      expect(theirs.map(r => r.name)).toEqual(['B']);
    });

    it('listReports: a caller-supplied ownerId cannot widen past the caller', async () => {
      await svc.saveReport({ name: 'A', object: 'lead', query: {} }, CTX);
      await svc.saveReport({ name: 'B', object: 'lead', query: {} }, OTHER);
      expect(await svc.listReports({ ownerId: 'u2' }, CTX)).toEqual([]); // u1 asking for u2 ⇒ nothing
    });

    it('system context sees all reports (scheduler / tooling path)', async () => {
      await svc.saveReport({ name: 'A', object: 'lead', query: {} }, CTX);
      await svc.saveReport({ name: 'B', object: 'lead', query: {} }, OTHER);
      const all = await svc.listReports({}, { isSystem: true } as any);
      expect(all.length).toBe(2);
    });

    it('unscheduleReport: a non-owner cannot delete another user\'s schedule', async () => {
      const r = await svc.saveReport({ name: 'Mine', object: 'lead', query: {} }, CTX);
      const s = await svc.scheduleReport({ reportId: r.id, recipients: ['x@t'] }, CTX);
      // stranger is denied as not-found and the schedule survives untouched
      await expect(svc.unscheduleReport(s.id, OTHER)).rejects.toThrow(/REPORT_NOT_FOUND/);
      expect(engine._tables['sys_report_schedule'].length).toBe(1);
      // owner can
      await svc.unscheduleReport(s.id, CTX);
      expect(engine._tables['sys_report_schedule'].length).toBe(0);
    });

    // [#7603] SUPERSEDES `unscheduleReport: an unknown schedule id is
    // idempotent, not a leak`, which asserted on this same input
    // (`'rsch_nope'` as OTHER) that the call `resolves.toBeUndefined()`.
    //
    // Its title stated the conclusion backwards. Idempotence is only "not a
    // leak" where every caller may see the row; here the sibling arm — another
    // owner's schedule — threw REPORT_NOT_FOUND, so resolving quietly was the
    // one behaviour that told a stranger apart "no such schedule" from "not
    // yours". The route turns that into 204-vs-404, which is an enumeration
    // oracle over other owners' schedule ids (#7523's defect on `deleteReport`,
    // in a quieter costume). Same input, opposite assertion: the unknown id now
    // throws, exactly as the cross-owner id does.
    it('unscheduleReport: an unknown schedule id is denied as not-found, not silently idempotent', async () => {
      await expect(svc.unscheduleReport('rsch_nope', OTHER)).rejects.toThrow(/REPORT_NOT_FOUND/);
    });

    // The assertion that actually closes the oracle, and the one to keep if any
    // of these ever have to be merged: it compares the two deny arms to EACH
    // OTHER instead of pinning each one's outcome separately. #7523's mutation
    // table showed per-arm assertions cannot fail on the plausible half-fix
    // (one arm corrected, the other left alone) — an equality cannot pass
    // through one.
    it('unscheduleReport: the unknown-id and cross-owner deny arms are indistinguishable', async () => {
      const r = await svc.saveReport({ name: 'Mine', object: 'lead', query: {} }, CTX);
      const s = await svc.scheduleReport({ reportId: r.id, recipients: ['x@t'] }, CTX);

      // A prober holds one id at a time and can only compare what comes back.
      const outcome = async (scheduleId: string) => {
        try {
          await svc.unscheduleReport(scheduleId, OTHER);
          return { threw: false, message: null as string | null };
        } catch (err) {
          // The whole message, not a pattern: the route puts it in the 404 body
          // verbatim, so any difference here is a difference on the wire.
          return { threw: true, message: (err as Error).message };
        }
      };

      // Same id on both sides, so this is literal equality with nothing
      // normalised away — the id that does not exist is `s.id` itself, in a
      // world where the schedule was never created.
      const crossOwner = await outcome(s.id);
      await svc.unscheduleReport(s.id, CTX);              // owner drops it for real
      const unknownId = await outcome(s.id);              // same id, now nonexistent

      expect(unknownId).toEqual(crossOwner);
      expect(crossOwner).toEqual({ threw: true, message: `REPORT_NOT_FOUND: ${s.id}` });
    });

    it('unscheduleReport: does not buy equal denials by refusing the owner too', async () => {
      // The cheap way to make two arms agree is to break the feature.
      const r = await svc.saveReport({ name: 'Mine', object: 'lead', query: {} }, CTX);
      const s = await svc.scheduleReport({ reportId: r.id, recipients: ['x@t'] }, CTX);
      await expect(svc.unscheduleReport(s.id, CTX)).resolves.toBeUndefined();
      expect(engine._tables['sys_report_schedule'].length).toBe(0);
    });

    it('listSchedules: a non-owner cannot see another user\'s schedules', async () => {
      const r = await svc.saveReport({ name: 'Mine', object: 'lead', query: {} }, CTX);
      await svc.scheduleReport({ reportId: r.id, recipients: ['x@t'] }, CTX);
      expect((await svc.listSchedules({ reportId: r.id }, OTHER)).length).toBe(0); // stranger sees nothing
      expect((await svc.listSchedules({ reportId: r.id }, CTX)).length).toBe(1);   // owner sees it
    });

    it('listSchedules: system context (dispatcher) still sees schedules', async () => {
      const r = await svc.saveReport({ name: 'Mine', object: 'lead', query: {} }, CTX);
      await svc.scheduleReport({ reportId: r.id, recipients: ['x@t'] }, CTX);
      expect((await svc.listSchedules({ reportId: r.id }, { isSystem: true } as any)).length).toBe(1);
    });

    it('dispatchDue: fails closed (no RLS bypass) when no owner resolver is configured', async () => {
      const noResolver = new ReportService({ engine: engine as any, email, clock: { now: () => now } });
      const r = await noResolver.saveReport({ name: 'A', object: 'lead', query: {} }, CTX);
      await noResolver.scheduleReport({ reportId: r.id, recipients: ['x@t'] }, CTX);
      engine._tables['sys_report_schedule'][0].next_run_at = new Date(now.getTime() - 1).toISOString();

      const result = await noResolver.dispatchDue();
      expect(result.fired).toBe(0);
      expect(result.failed).toBe(1);
      expect(email._sent.length).toBe(0); // nothing emailed — no elevated run
      expect(engine._tables['sys_report_schedule'][0].last_status).toBe('failed');
      expect(engine._tables['sys_report_schedule'][0].last_error).toMatch(/RLS bypassed/);
    });

    it('dispatchDue: runs under the owner context the resolver returns', async () => {
      const seen: Array<string | undefined> = [];
      const spySvc = new ReportService({
        engine: engine as any, email, clock: { now: () => now },
        resolveOwnerContext: async (ownerId) => { seen.push(ownerId); return { userId: ownerId, positions: [], permissions: [] }; },
      });
      const r = await spySvc.saveReport({ name: 'A', object: 'lead', query: {} }, CTX);
      await spySvc.scheduleReport({ reportId: r.id, recipients: ['x@t'], format: 'csv' }, CTX);
      engine._tables['sys_report_schedule'][0].next_run_at = new Date(now.getTime() - 1).toISOString();

      const result = await spySvc.dispatchDue();
      expect(result.fired).toBe(1);
      expect(seen).toEqual(['u1']); // resolved the owner, not a system context
    });
  });

  // ─── #7204 — the caller envelope the report read receives ─────────
  //
  // The row-level consequence (a `group`-posture report under-reporting) is
  // pinned end-to-end against a real engine + real SQL driver in
  // `report-group-posture-scope.integration.test.ts` — that is where the claim
  // "the report returns fewer rows than the same query interactively" is
  // measured, because a key sitting on a context object is precisely what this
  // defect looked like from in here. What is left for a fake engine is the
  // structural half: WHICH keys cross, and that the crossing cannot write back.
  describe('executeReport forwards the caller envelope, not a rebuilt subset (#7204)', () => {
    const lastFindContext = () =>
      (engine._tables as any) && (engine as any)._lastLeadFindContext;

    beforeEach(() => {
      const inner = engine.find.bind(engine);
      (engine as any).find = async (object: string, options?: any) => {
        if (object === 'lead') (engine as any)._lastLeadFindContext = options?.context;
        return inner(object, options);
      };
    });

    it('forwards the principal fields the projection used to drop', async () => {
      await svc.runAdHoc({ name: 'A', object: 'lead', query: {} }, {
        userId: 'u1',
        tenantId: 'org_a',
        positions: ['p1'],
        permissions: ['perm'],
        // Every one of these was dropped by the five-field projection.
        accessible_org_ids: ['org_a', 'org_b'],
        posture: 'MEMBER',
        org_user_ids: ['u1', 'u2'],
        systemPermissions: ['viewAllData'],
        timezone: 'Asia/Shanghai',
        principalKind: 'agent',
        onBehalfOf: { userId: 'u9' },
      } as any);

      expect(lastFindContext()).toMatchObject({
        userId: 'u1',
        tenantId: 'org_a',
        positions: ['p1'],
        permissions: ['perm'],
        accessible_org_ids: ['org_a', 'org_b'],
        posture: 'MEMBER',
        org_user_ids: ['u1', 'u2'],
        systemPermissions: ['viewAllData'],
        timezone: 'Asia/Shanghai',
        principalKind: 'agent',
        onBehalfOf: { userId: 'u9' },
      });
    });

    it('does NOT forward the middleware-private `__` keys — another object\'s access depth stays behind', async () => {
      // A REST request that touched some other object before reaching
      // /reports/:id/run arrives with that object's depth already stamped on it,
      // and plugin-security only OVERWRITES the stamp when it resolves
      // permission sets for the new object. Carried across, it would widen the
      // report's owner-match on a question it was never resolved for.
      await svc.runAdHoc({ name: 'A', object: 'lead', query: {} }, {
        userId: 'u1',
        __readScope: 'all',
        __delegatorReadScope: 'all',
        __expandRead: true,
        __referentialFieldClear: true,
      } as any);

      const seen = lastFindContext();
      expect(seen.userId).toBe('u1');
      expect(Object.keys(seen).filter((k) => k.startsWith('__'))).toEqual([]);
    });

    it('hands the engine a FRESH object — a callee stamping onto it cannot write back into the caller\'s envelope', async () => {
      // plugin-security stamps `sc.__readScope = …` in place on whatever it is
      // handed. Forwarding the caller's own object by reference would leave the
      // report's depth on the REQUEST context the route goes on using.
      const caller: any = { userId: 'u1', accessible_org_ids: ['org_a'] };
      (engine as any).find = async (object: string, options?: any) => {
        if (object === 'lead') {
          (engine as any)._lastLeadFindContext = options?.context;
          options.context.__readScope = 'all';
        }
        return engine._tables[object] ?? [];
      };

      await svc.runAdHoc({ name: 'A', object: 'lead', query: {} }, caller);

      expect(lastFindContext()).not.toBe(caller);
      expect(lastFindContext().__readScope).toBe('all'); // the callee did stamp
      expect(caller.__readScope, 'the caller envelope must be untouched').toBeUndefined();
    });

    it('keeps the projection\'s defaults for an envelope that omits them', async () => {
      // Byte-for-byte what the five-field projection produced: this change adds
      // fields, it does not change the ones that were already there.
      await svc.runAdHoc({ name: 'A', object: 'lead', query: {} }, { userId: 'u1' } as any);
      expect(lastFindContext()).toMatchObject({
        userId: 'u1', positions: [], permissions: [], isSystem: false,
      });
    });

    it('an explicit isSystem:true still crosses (the scheduler / tooling path)', async () => {
      await svc.runAdHoc({ name: 'A', object: 'lead', query: {} }, { isSystem: true } as any);
      expect(lastFindContext().isSystem).toBe(true);
    });

    it('assertExportAllowed still sees the UN-projected caller context', async () => {
      // The export axis runs before any row is read, against the caller's own
      // envelope — the forwarding change must not have re-routed its input.
      const seen: any[] = [];
      const exportSvc = new ReportService({
        engine: engine as any, email, clock: { now: () => now },
        canExport: async (_object: string, ctx: unknown) => { seen.push(ctx); return true; },
      });
      const caller: any = { userId: 'u1', accessible_org_ids: ['org_a', 'org_b'] };
      await exportSvc.runAdHoc({ name: 'A', object: 'lead', query: {}, format: 'csv' }, caller);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toBe(caller);
    });
  });
});
