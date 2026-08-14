// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3710 — the reports side door around the user-level export axis (#3544).
 *
 * `GET /data/:object/export` answers 403 for a caller without the export grant.
 * A report over the SAME object rendered as CSV is the same bulk copy of the
 * same rows, so before this gate a refused caller could simply save a report,
 * run it as CSV — or schedule one to their own inbox — and get the data anyway.
 *
 * The gate lives in `executeReport`, which every path funnels through (run,
 * ad-hoc, and the scheduled dispatch), so these exercise all three rather than
 * trusting one call site.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReportService, type ReportEmail } from './report-service.js';

function makeFakeEngine() {
  const tables: Record<string, any[]> = {};
  const ensure = (n: string) => (tables[n] ??= []);
  const matches = (row: any, filter: any): boolean => {
    if (!filter || typeof filter !== 'object') return true;
    for (const [k, v] of Object.entries(filter)) {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      if (row[k] !== v) return false;
    }
    return true;
  };
  return {
    _tables: tables,
    async find(object: string, options?: any) {
      return ensure(object)
        .filter((r) => matches(r, options?.filter ?? options?.where))
        .slice(0, options?.limit ?? 1000);
    },
    async insert(object: string, data: any) { ensure(object).push({ ...data }); return { ...data }; },
    async update(object: string, idOrData: any, _opts?: any) {
      const data = typeof idOrData === 'object' ? idOrData : _opts;
      const id = typeof idOrData === 'object' ? idOrData.id : idOrData;
      const table = ensure(object);
      const i = table.findIndex((r) => r.id === id);
      if (i >= 0) table[i] = { ...table[i], ...data };
      return table[i];
    },
    async delete(object: string, options?: any) {
      const table = ensure(object);
      const i = table.findIndex((r) => r.id === (options?.where?.id ?? options?.id));
      if (i >= 0) table.splice(i, 1);
      return {};
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
const now = new Date('2026-01-15T10:00:00Z');

describe('reports × the user-level export axis (#3710)', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let email: ReturnType<typeof makeFakeEmail>;
  let canExport: ReturnType<typeof vi.fn>;

  const build = (opts: { canExport?: any } = {}) =>
    new ReportService({
      engine: engine as any,
      email,
      clock: { now: () => now },
      maxRows: 5000,
      resolveOwnerContext: async (ownerId: string) =>
        ownerId ? { userId: ownerId, tenantId: 't1', positions: [], permissions: [] } : null,
      ...('canExport' in opts ? { canExport: opts.canExport } : { canExport }),
    });

  beforeEach(() => {
    engine = makeFakeEngine();
    email = makeFakeEmail();
    canExport = vi.fn().mockResolvedValue(true);
    engine._tables['lead'] = [
      { id: 'l1', name: 'Acme', status: 'open' },
      { id: 'l2', name: 'Globex', status: 'won' },
    ];
  });

  const saveReport = async (svc: ReportService, format: 'csv' | 'json' | 'html_table') =>
    svc.saveReport(
      { name: 'leads', object: 'lead', query: { fields: ['id', 'name'] }, format },
      CTX,
    );

  describe('interactive run', () => {
    it('denies a CSV report run when the caller may not export the object', async () => {
      const svc = build({ canExport: vi.fn().mockResolvedValue(false) });
      const report = await saveReport(svc, 'csv');
      await expect(svc.run(report.id, CTX)).rejects.toThrow(/EXPORT_NOT_PERMITTED/);
    });

    it('denies a JSON report run too — json is a bulk machine-readable copy', async () => {
      const svc = build({ canExport: vi.fn().mockResolvedValue(false) });
      const report = await saveReport(svc, 'json');
      await expect(svc.run(report.id, CTX)).rejects.toThrow(/EXPORT_NOT_PERMITTED/);
    });

    it('ALLOWS html_table — a rendered view is reading, not exporting', async () => {
      // The axis must not become a second read permission: a caller holding
      // allowRead may already see these rows on screen.
      const svc = build({ canExport: vi.fn().mockResolvedValue(false) });
      const report = await saveReport(svc, 'html_table');
      const result = await svc.run(report.id, CTX);
      expect(result.rowCount).toBe(2);
    });

    it('allows CSV when the grant is held, and asks about the REPORT object', async () => {
      const svc = build();
      const report = await saveReport(svc, 'csv');
      const result = await svc.run(report.id, CTX);
      expect(result.rowCount).toBe(2);
      expect(canExport).toHaveBeenCalledWith('lead', expect.objectContaining({ userId: 'u1' }));
    });

    it('refuses BEFORE reading any row', async () => {
      const svc = build({ canExport: vi.fn().mockResolvedValue(false) });
      const report = await saveReport(svc, 'csv');
      const findSpy = vi.spyOn(engine, 'find');
      await expect(svc.run(report.id, CTX)).rejects.toThrow(/EXPORT_NOT_PERMITTED/);
      // `sys_saved_report` lookups are fine; the OBJECT must never be queried.
      expect(findSpy.mock.calls.some(([obj]) => obj === 'lead')).toBe(false);
    });

    it('a throwing canExport denies (fail closed, ADR-0049)', async () => {
      const svc = build({ canExport: vi.fn().mockRejectedValue(new Error('resolution failed')) });
      const report = await saveReport(svc, 'csv');
      await expect(svc.run(report.id, CTX)).rejects.toThrow(/EXPORT_NOT_PERMITTED/);
    });

    it('no canExport wired → axis does not apply (no plugin-security deployment)', async () => {
      const svc = build({ canExport: undefined });
      const report = await saveReport(svc, 'csv');
      const result = await svc.run(report.id, CTX);
      expect(result.rowCount).toBe(2);
    });
  });

  describe('scheduling', () => {
    it('refuses to CREATE a csv schedule the author could not run', async () => {
      const svc = build({ canExport: vi.fn().mockResolvedValue(false) });
      const report = await saveReport(svc, 'html_table');
      await expect(
        svc.scheduleReport({ reportId: report.id, recipients: ['a@b.c'], format: 'csv' }, CTX),
      ).rejects.toThrow(/EXPORT_NOT_PERMITTED/);
    });

    it('allows an html_table schedule for the same caller', async () => {
      const svc = build({ canExport: vi.fn().mockResolvedValue(false) });
      const report = await saveReport(svc, 'html_table');
      const sched = await svc.scheduleReport(
        { reportId: report.id, recipients: ['a@b.c'], format: 'html_table' },
        CTX,
      );
      expect(sched.id).toBeTruthy();
    });
  });

  describe('scheduled dispatch — the original side door', () => {
    it('a csv schedule created while granted STOPS delivering once the grant is revoked', async () => {
      // The reason the dispatch re-checks instead of trusting the create-time
      // check: permissions change after a schedule exists.
      const gate = vi.fn().mockResolvedValue(true);
      const svc = build({ canExport: gate });
      const report = await saveReport(svc, 'html_table');
      await svc.scheduleReport(
        { reportId: report.id, recipients: ['a@b.c'], format: 'csv', intervalMinutes: 1 },
        CTX,
      );

      gate.mockResolvedValue(false); // grant revoked
      // Force the schedule due (mirrors the existing dispatch suite).
      engine._tables['sys_report_schedule'][0].next_run_at = new Date(now.getTime() - 1000).toISOString();
      const out = await svc.dispatchDue();

      expect(out.failed).toBe(1);
      expect(email._sent).toHaveLength(0);
      const sched = engine._tables['sys_report_schedule'][0];
      expect(String(sched.last_error)).toMatch(/EXPORT_NOT_PERMITTED/);
    });

    it('an html_table schedule still delivers for a caller without the grant', async () => {
      const svc = build({ canExport: vi.fn().mockResolvedValue(false) });
      const report = await saveReport(svc, 'html_table');
      await svc.scheduleReport(
        { reportId: report.id, recipients: ['a@b.c'], format: 'html_table', intervalMinutes: 1 },
        CTX,
      );
      // Force the schedule due (mirrors the existing dispatch suite).
      engine._tables['sys_report_schedule'][0].next_run_at = new Date(now.getTime() - 1000).toISOString();
      const out = await svc.dispatchDue();
      expect(out.fired).toBe(1);
      expect(email._sent).toHaveLength(1);
    });

    it('a csv schedule delivers when the owner holds the grant', async () => {
      const svc = build();
      const report = await saveReport(svc, 'html_table');
      await svc.scheduleReport(
        { reportId: report.id, recipients: ['a@b.c'], format: 'csv', intervalMinutes: 1 },
        CTX,
      );
      // Force the schedule due (mirrors the existing dispatch suite).
      engine._tables['sys_report_schedule'][0].next_run_at = new Date(now.getTime() - 1000).toISOString();
      const out = await svc.dispatchDue();
      expect(out.fired).toBe(1);
      expect(email._sent[0].attachments?.[0]?.contentType).toBe('text/csv');
    });
  });
});
