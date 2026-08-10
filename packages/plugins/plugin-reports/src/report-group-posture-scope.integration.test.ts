// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7204 — a `group`-posture report returns the caller's membership union, the
 * same row set the caller sees interactively.
 *
 * `executeReport` used to rebuild a five-field projection of the caller's
 * execution envelope (`userId` / `tenantId` / `positions` / `permissions` /
 * `isSystem`) before handing it to the engine read that produces the report.
 * `accessible_org_ids` was not in that projection, and `buildDriverOptions`
 * reads it BY NAME (`engine.ts`, ADR-0105 D2 / #3623) to widen the driver's
 * native tenant scope to the caller's whole membership set under the `group`
 * posture. Absent, drivers "fall back to equality: fail toward isolation" — so
 * the report silently returned FEWER rows than the identical interactive query,
 * with no error and nothing in the output saying so.
 *
 * WHY THIS FILE REFUSES TO STUB THE ENGINE. The defect is invisible one layer
 * up: a fake engine that records the context it was handed can only assert that
 * a key is present, and "the key is on the object" is exactly what the previous
 * shape of this bug looked like from inside the service. The consumer is the
 * REAL `buildDriverOptions` → real `@objectstack/driver-sql` native scope, so
 * the assertions below land on ROW SETS: the union of the rows in both orgs, or
 * the equality subset. Backend is better-sqlite3 `:memory:`, the canonical
 * in-repo integration stack (PR #5715).
 *
 * The posture matrix is load-bearing, not decoration. `group` is the only
 * posture the widening applies to; `isolated`, "no provider wired" and "group
 * with an empty accessible set" must all still collapse to active-org equality
 * after the fix, or the change traded under-reporting for exposure.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import type { IDataEngine } from '@objectstack/spec/contracts';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysSavedReport, SysReportSchedule } from '@objectstack/platform-objects/audit';
import { ReportService, type ReportEngine, type ReportEmail } from './report-service.js';

/**
 * A tenant-scoped business object. `organization_id` is what makes the driver's
 * native tenant scope engage at all (`isTenancyDisabled` / the SQL driver's
 * tenant column), and `day` is a READ-TIME formula field: `applyFormulaPlan`
 * evaluates it with `execCtx.timezone`, which the same projection also dropped.
 */
const account = {
  name: 'account',
  label: 'Account',
  fields: {
    organization_id: { name: 'organization_id', label: 'Org', type: 'text' },
    name: { name: 'name', label: 'Name', type: 'text' },
    day: {
      name: 'day',
      label: 'Calendar day',
      type: 'formula',
      expression: { dialect: 'cel', source: 'today()' },
    },
  },
};

/** The caller: active org `org_a`, membership union `org_a` + `org_b`. */
const GROUP_CTX = {
  userId: 'u1',
  tenantId: 'org_a',
  positions: [],
  permissions: [],
  posture: 'MEMBER',
  accessible_org_ids: ['org_a', 'org_b'],
} as any;

const ids = (rows: any[]): string[] => rows.map((r) => String(r.id)).sort();

/**
 * The engine surface this harness drives. `getService('objectql')` is declared
 * as the data-plane contract `IDataEngine`; the boot-time knobs below
 * (`registerDriver`, `registry`, `syncSchemas`) and the posture provider
 * plugin-security wires in production sit outside it, so they are named here
 * rather than erased with `any`.
 */
interface TestEngine extends IDataEngine {
  registerDriver(driver: unknown, isDefault?: boolean): void;
  registry: { registerObject(def: unknown, packageId: string, namespace: string): void };
  syncSchemas(): Promise<unknown>;
  setTenancyPostureProvider(provider: () => string | undefined): void;
  destroy(): Promise<void>;
}

describe('#7204 a group-posture report reads the caller\'s whole membership union', () => {
  let objectql: TestEngine | undefined;
  let svc: ReportService;
  let email: ReportEmail & { _sent: any[] };

  afterEach(async () => {
    vi.useRealTimers();
    try { await objectql?.destroy(); } catch { /* noop */ }
  });

  beforeEach(async () => {
    const kernel = new ObjectKernel({ logger: { level: 'error' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    objectql = kernel.getService<IDataEngine>('objectql') as TestEngine;

    // The engine's own `init()` ran during bootstrap, before this driver
    // existed, so the connect the engine would have done is done here.
    const driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.connect();
    engine().registerDriver(driver, true);
    for (const def of [account, SysSavedReport, SysReportSchedule]) {
      engine().registry.registerObject(def, 'reports-test', 'reports-test');
    }
    await engine().syncSchemas();

    // Two rows in the active org, one in the other org the caller belongs to.
    for (const row of [
      { id: 'a1', organization_id: 'org_a', name: 'A1' },
      { id: 'a2', organization_id: 'org_a', name: 'A2' },
      { id: 'b1', organization_id: 'org_b', name: 'B1' },
    ]) {
      await engine().insert('account', row, { context: { isSystem: true } });
    }

    const sent: any[] = [];
    email = {
      _sent: sent,
      async send(input) { sent.push(input); return { status: 'sent' as const }; },
    };
    svc = new ReportService({
      engine: engine() as unknown as ReportEngine,
      email,
      // A scheduled run executes as the report's OWNER (#2849 / #2980) — the
      // resolver hands back a real RLS-bearing envelope, membership set and all.
      resolveOwnerContext: async (ownerId: string) =>
        (ownerId === 'u1' ? ({ ...GROUP_CTX } as any) : null),
    });
  });

  /** What plugin-security's wiring reports in a deployment of this posture. */
  const posture = (p: string | undefined) => engine().setTenancyPostureProvider(() => p);

  /** The booted engine — narrowed once so every call site stays typed. */
  const engine = (): TestEngine => objectql as TestEngine;

  const saveAccountReport = async (format = 'csv') =>
    svc.saveReport(
      { name: 'Accounts', object: 'account', query: {}, format } as any,
      GROUP_CTX,
    );

  describe('group posture', () => {
    beforeEach(() => posture('group'));

    it('a SAVED report returns the same rows as the identical interactive query', async () => {
      const interactive = await engine().find('account', {}, { context: GROUP_CTX });
      expect(ids(interactive), 'the interactive baseline is the union').toEqual(['a1', 'a2', 'b1']);

      const report = await svc.run((await saveAccountReport()).id, GROUP_CTX);

      // The card's exact claim: the saved-report path used to return FEWER rows
      // (['a1','a2'] — active-org equality) than the interactive query above.
      expect(ids(report.rows)).toEqual(ids(interactive));
      expect(report.rowCount).toBe(3);
    });

    it('an AD-HOC report returns the union too', async () => {
      const report = await svc.runAdHoc(
        { name: 'Ad hoc', object: 'account', query: {} } as any,
        GROUP_CTX,
      );
      expect(ids(report.rows)).toEqual(['a1', 'a2', 'b1']);
    });

    it('a SCHEDULED run emails the owner the union, not the active org', async () => {
      const report = await saveAccountReport();
      await svc.scheduleReport(
        { reportId: report.id, recipients: ['ops@example.com'], format: 'csv', intervalMinutes: 60 },
        GROUP_CTX,
      );

      const result = await svc.dispatchDue(new Date(Date.now() + 3 * 60 * 60 * 1000));
      expect(result, 'the sweep must actually fire').toMatchObject({ fired: 1, failed: 0 });

      const csv: string = email._sent[email._sent.length - 1]?.attachments?.[0]?.content ?? '';
      const dataRows = csv.split('\r\n').slice(1).filter(Boolean);
      expect(dataRows).toHaveLength(3);
      expect(csv).toContain('B1');
    });

    it('the report also sees rows the ACTIVE org has none of', async () => {
      // Nothing in org_a at all: under equality the report is empty, under the
      // union it is the one org_b row. Isolates the widening from "the active
      // org happened to hold most of the rows".
      const report = await svc.runAdHoc(
        { name: 'B only', object: 'account', query: { filter: { name: 'B1' } } } as any,
        GROUP_CTX,
      );
      expect(ids(report.rows)).toEqual(['b1']);
    });

    it('an EMPTY accessible set still collapses to active-org equality (fail toward isolation)', async () => {
      const ctx = { ...GROUP_CTX, accessible_org_ids: [] };
      const interactive = await engine().find('account', {}, { context: ctx });
      const report = await svc.runAdHoc({ name: 'r', object: 'account', query: {} } as any, ctx);
      expect(ids(report.rows)).toEqual(['a1', 'a2']);
      expect(ids(report.rows)).toEqual(ids(interactive));
    });

    it('forwards the business timezone, so a read-time formula field resolves the caller\'s calendar day', async () => {
      // 20:00Z is the day BEFORE in UTC and the day AFTER in UTC+14, so the two
      // timezones disagree deterministically at this instant. `today()` is a
      // read-time formula evaluated by `applyFormulaPlan` with `execCtx.timezone`
      // — dropped by the same projection, and observable on the row's VALUE.
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(new Date('2026-08-10T20:00:00Z'));
      const ctx = { ...GROUP_CTX, timezone: 'Pacific/Kiritimati' };

      const interactive = await engine().find('account', { where: { id: 'a1' } }, { context: ctx });
      const report = await svc.runAdHoc(
        { name: 'r', object: 'account', query: { filter: { id: 'a1' } } } as any,
        ctx,
      );

      const dayOf = (v: unknown): string =>
        String(v instanceof Date ? v.toISOString() : v).slice(0, 10);
      expect(dayOf(interactive[0]?.day), 'UTC+14 is already on the 11th').toBe('2026-08-11');
      expect(dayOf((report.rows[0] as any)?.day)).toBe(dayOf(interactive[0]?.day));
    });
  });

  describe('every other posture is unchanged — the widening is group-only', () => {
    it('isolated posture: the report stays at active-org equality', async () => {
      posture('isolated');
      const interactive = await engine().find('account', {}, { context: GROUP_CTX });
      const report = await svc.runAdHoc({ name: 'r', object: 'account', query: {} } as any, GROUP_CTX);
      expect(ids(report.rows)).toEqual(['a1', 'a2']);
      expect(ids(report.rows)).toEqual(ids(interactive));
    });

    it('no posture provider (no enforcement layer): equality, never widened', async () => {
      const interactive = await engine().find('account', {}, { context: GROUP_CTX });
      const report = await svc.runAdHoc({ name: 'r', object: 'account', query: {} } as any, GROUP_CTX);
      expect(ids(report.rows)).toEqual(['a1', 'a2']);
      expect(ids(report.rows)).toEqual(ids(interactive));
    });
  });
});
