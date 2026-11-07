// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31241] A map-valued `lifecycle` setting stored as JSON TEXT is read as the
 * map it holds.
 *
 * `retention_overrides`, `quotas` and `quota_defaults` are `json` specifiers,
 * which persist an object (ADR-0007). The console's `json` field used to send
 * the textarea's text and the settings save door stored it, so a deployment
 * that saved the Data Lifecycle page holds a string where the map belongs.
 * `loadGovernance` indexed that string, so every override and quota read as
 * absent, with nothing logged. The save door now refuses a string
 * (`service-settings`), but rows already stored are not re-judged: this reader
 * parses a string that holds a JSON object, applies it and warns once per
 * stored value; anything else that is not a plain object is ignored as before,
 * now said once at `error`.
 */

import { describe, it, expect, vi } from 'vitest';
import { LifecycleService, type LifecycleObjectLike } from './lifecycle-service.js';
import { parseLifecycleDuration } from './duration.js';

const FIXED_NOW = 1_700_000_000_000;
const isoCutoff = (literal: string) => new Date(FIXED_NOW - parseLifecycleDuration(literal)).toISOString();

const JOB_RUN: LifecycleObjectLike = {
  name: 'sys_job_run',
  lifecycle: { class: 'telemetry', retention: { maxAge: '30d' } } as any,
};

/** Settings double: a value map at the global rung, plus per-organization rows. */
function settingsOf(global: Record<string, unknown>, tenant: Record<string, Record<string, unknown>> = {}) {
  return {
    async get(_ns: string, key: string, ctx?: Record<string, unknown>) {
      const org = ctx?.tenantId as string | undefined;
      if (org && tenant[org] && key in tenant[org]) return { value: tenant[org][key], source: 'tenant' };
      if (key in global) return { value: global[key], source: 'global' };
      return { value: undefined, source: 'default' };
    },
  };
}

/** Engine double: one declared object, a counting driver, captured deletes and candidate reads. */
function engineOf(rows = 1_500, organizations: string[] = []) {
  const deletes: Array<{ where: unknown }> = [];
  const reads: Array<{ object: string; where: unknown }> = [];
  const driver = { name: 'default', count: vi.fn(async () => rows) };
  const engine: any = {
    registry: { getAllObjects: () => [JOB_RUN] },
    async delete(_object: string, options: any) {
      deletes.push({ where: options?.where });
      return { deletedCount: 1 };
    },
    getDriverForObject: () => driver,
    datasource() {
      throw new Error('no datasource');
    },
  };
  if (organizations.length > 0) {
    engine.find = async (object: string, options: any) => {
      if (object === 'sys_organization') return organizations.map((id) => ({ id }));
      reads.push({ object, where: options?.where });
      const org = (options?.where as Record<string, unknown> | undefined)?.organization_id;
      return [{ id: typeof org === 'string' ? `${org}_row` : 'global_row' }];
    };
  }
  return { engine, deletes, reads };
}

function serviceOf(engine: unknown, settings: unknown) {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const svc = new LifecycleService({
    getEngine: () => engine as any,
    getSettings: () => settings as any,
    logger,
    now: () => FIXED_NOW,
    initialDelayMs: 1,
    sweepIntervalMs: 10,
    onAlert: () => {},
  });
  return { svc, logger };
}

describe('[#31241] a map setting stored as JSON text', () => {
  it('CONTROL: quotas stored as an object alert, and nothing is logged about them', async () => {
    const { engine } = engineOf(1_500);
    const { svc, logger } = serviceOf(engine, settingsOf({ quotas: { sys_job_run: 1_000 } }));

    const report = await svc.sweep();

    expect(report.alerts).toEqual([{ type: 'quota-exceeded', object: 'sys_job_run', rowCount: 1_500, quota: 1_000 }]);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('quotas stored as the text the old console saved are applied, with one warning naming the key', async () => {
    const { engine } = engineOf(1_500);
    const { svc, logger } = serviceOf(engine, settingsOf({ quotas: '{\n  "sys_job_run": 1000\n}' }));

    const first = await svc.sweep();
    const second = await svc.sweep();

    expect(first.alerts).toEqual([{ type: 'quota-exceeded', object: 'sys_job_run', rowCount: 1_500, quota: 1_000 }]);
    expect(second.alerts).toEqual(first.alerts);
    // Once per stored value, not once per sweep.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain('lifecycle.quotas is stored as JSON text, not an object');
    expect(logger.warn.mock.calls[0][0]).toContain('Save the Data Lifecycle settings page again');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('a class default stored as text applies through quota_defaults', async () => {
    const { engine } = engineOf(1_500);
    const { svc } = serviceOf(engine, settingsOf({ quota_defaults: '{"telemetry": 500}' }));

    const report = await svc.sweep();

    expect(report.alerts).toEqual([{ type: 'quota-exceeded', object: 'sys_job_run', rowCount: 1_500, quota: 500 }]);
  });

  it('a global retention override stored as text moves the window', async () => {
    const { engine, deletes } = engineOf();
    const { svc, logger } = serviceOf(engine, settingsOf({ retention_overrides: '{"sys_job_run": {"maxAge": "90d"}}' }));

    await svc.sweep();

    expect(deletes).toEqual([{ where: { created_at: { $lt: isoCutoff('90d') } } }]);
    expect(logger.warn.mock.calls[0][0]).toContain('lifecycle.retention_overrides is stored as JSON text');
  });

  it("an organization's retention override stored as text runs that organization's pass on it", async () => {
    const { engine, reads } = engineOf(1_500, ['org_reg', 'org_plain']);
    const { svc, logger } = serviceOf(
      engine,
      settingsOf({}, { org_reg: { retention_overrides: '{"sys_job_run": {"maxAge": "2y"}}' } }),
    );

    await svc.sweep();

    const passes = reads.filter((r) => r.object === 'sys_job_run').map((r) => r.where);
    expect(passes).toEqual([
      { created_at: { $lt: isoCutoff('2y') }, organization_id: 'org_reg' },
      { created_at: { $lt: isoCutoff('30d') }, organization_id: { $nin: ['org_reg'] } },
    ]);
    expect(logger.warn.mock.calls[0][0]).toContain("organization org_reg's lifecycle.retention_overrides");
  });

  it('text that is not a JSON object applies nothing, and says so once at error', async () => {
    const { engine } = engineOf(1_500);
    const { svc, logger } = serviceOf(engine, settingsOf({ quotas: '{ "sys_job_run": 1000' }));

    const first = await svc.sweep();
    await svc.sweep();

    expect(first.alerts).toEqual([]);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0]).toContain('lifecycle.quotas is not an object');
    expect(logger.error.mock.calls[0][0]).not.toContain('sys_job_run');
  });
});
