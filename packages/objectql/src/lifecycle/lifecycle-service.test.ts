// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { LifecycleService, type LifecycleObjectLike } from './lifecycle-service.js';
import { parseLifecycleDuration } from './duration.js';

const FIXED_NOW = 1_700_000_000_000; // fixed clock for deterministic cutoffs

function silentLogger() {
  return { info: () => {}, warn: () => {}, debug: () => {} };
}

/** Fake engine capturing every bulk delete, with a declarable object set. */
function captureEngine(
  objects: LifecycleObjectLike[],
  opts: {
    deleteImpl?: (object: string, options: any) => any;
    driver?: Record<string, unknown>;
    datasources?: Record<string, unknown>;
    /** When set, the engine exposes `find` (guarded-reap candidate reads). */
    findImpl?: (object: string, options: any) => any;
  } = {},
) {
  const deletes: Array<{ object: string; where: any; multi: any; context: any }> = [];
  const finds: Array<{ object: string; where: any; limit: any; context: any }> = [];
  const engine: any = {
    registry: { getAllObjects: () => objects },
    async delete(object: string, options: any) {
      deletes.push({ object, where: options?.where, multi: options?.multi, context: options?.context });
      return opts.deleteImpl ? opts.deleteImpl(object, options) : { deletedCount: 3 };
    },
    getDriverForObject: () => opts.driver,
    datasource(name: string) {
      const ds = opts.datasources?.[name];
      if (!ds) throw new Error(`[ObjectQL] Datasource '${name}' not found`);
      return ds;
    },
  };
  if (opts.findImpl) {
    engine.find = async (object: string, options: any) => {
      finds.push({ object, where: options?.where, limit: options?.limit, context: options?.context });
      return opts.findImpl!(object, options);
    };
  }
  return { engine, deletes, finds };
}

function service(engine: any, extra: Partial<ConstructorParameters<typeof LifecycleService>[0]> = {}) {
  return new LifecycleService({
    getEngine: () => engine,
    logger: silentLogger(),
    now: () => FIXED_NOW,
    initialDelayMs: 1,
    sweepIntervalMs: 10,
    ...extra,
  });
}

const isoCutoff = (literal: string) => new Date(FIXED_NOW - parseLifecycleDuration(literal)).toISOString();

describe('parseLifecycleDuration', () => {
  it('parses the ADR unit set', () => {
    expect(parseLifecycleDuration('6h')).toBe(6 * 3_600_000);
    expect(parseLifecycleDuration('14d')).toBe(14 * 86_400_000);
    expect(parseLifecycleDuration('2w')).toBe(14 * 86_400_000);
    expect(parseLifecycleDuration('7y')).toBe(7 * 365 * 86_400_000);
  });

  it('throws on malformed literals', () => {
    for (const bad of ['', '14', 'd', '14 days', '2mo', '1.5d']) {
      expect(() => parseLifecycleDuration(bad)).toThrow();
    }
  });
});

describe('LifecycleService.sweep — Reaper', () => {
  it('reaps telemetry by retention.maxAge with an ISO cutoff on created_at, multi + system context', async () => {
    const { engine, deletes } = captureEngine([
      { name: 'sys_job_run', lifecycle: { class: 'telemetry', retention: { maxAge: '30d' } } },
    ]);

    const report = await service(engine).sweep();

    expect(deletes).toHaveLength(1);
    expect(deletes[0].object).toBe('sys_job_run');
    expect(deletes[0].multi).toBe(true);
    expect(deletes[0].context).toEqual({ isSystem: true, positions: [], permissions: [] });
    expect(deletes[0].where).toEqual({ created_at: { $lt: isoCutoff('30d') } });
    // ISO-8601 string, never a bare epoch-ms number (Postgres timestamp columns).
    expect(deletes[0].where.created_at.$lt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(report.swept).toEqual([
      { object: 'sys_job_run', class: 'telemetry', policy: 'retention', cutoff: isoCutoff('30d'), deleted: 3 },
    ]);
    expect(report.errors).toEqual([]);
  });

  it('reaps transient rows by ttl on the declared field', async () => {
    const { engine, deletes } = captureEngine([
      { name: 'sys_device_code', lifecycle: { class: 'transient', ttl: { field: 'expires_at', expireAfter: '1d' } } },
    ]);

    const report = await service(engine).sweep();

    expect(deletes).toHaveLength(1);
    expect(deletes[0].where).toEqual({ expires_at: { $lt: isoCutoff('1d') } });
    expect(report.swept[0].policy).toBe('ttl');
  });

  it('merges retention.onlyWhen into the reap filter (mixed tables, #2834)', async () => {
    const { engine, deletes } = captureEngine([
      {
        name: 'sys_automation_run',
        lifecycle: {
          class: 'telemetry',
          retention: { maxAge: '30d', onlyWhen: { status: { $in: ['completed', 'failed'] } } },
        } as any,
      },
    ]);

    const report = await service(engine).sweep();

    // Age cutoff AND the status predicate — a paused run older than the
    // window must never match the delete.
    expect(deletes).toHaveLength(1);
    expect(deletes[0].where).toEqual({
      created_at: { $lt: isoCutoff('30d') },
      status: { $in: ['completed', 'failed'] },
    });
    expect(report.swept[0].policy).toBe('retention');
  });

  it('never touches record-class or undeclared objects', async () => {
    const { engine, deletes } = captureEngine([
      { name: 'crm_account' },
      { name: 'crm_invoice', lifecycle: { class: 'record' } },
    ]);

    const report = await service(engine).sweep();

    expect(deletes).toHaveLength(0);
    expect(report.swept).toEqual([]);
  });

  it('skips hot deletion entirely while an archive is declared (retain → archive → delete)', async () => {
    const { engine, deletes } = captureEngine([
      {
        name: 'sys_audit_log',
        lifecycle: {
          class: 'audit',
          retention: { maxAge: '90d' },
          archive: { after: '90d', to: 'archive', keep: '7y' },
        },
      },
    ]);

    const report = await service(engine).sweep();

    // A compliance ledger must never be dropped unarchived: with `archive`
    // declared and no Archiver run, the Reaper must not delete a single row.
    expect(deletes).toHaveLength(0);
    expect(report.skipped).toEqual([{ object: 'sys_audit_log', reason: 'archive-pending' }]);
  });

  it('reaps audit-class rows when only retention is declared (explicit delete-after-window)', async () => {
    const { engine, deletes } = captureEngine([
      { name: 'sys_metadata_audit', lifecycle: { class: 'audit', retention: { maxAge: '365d' } } },
    ]);

    await service(engine).sweep();

    expect(deletes).toHaveLength(1);
    expect(deletes[0].where).toEqual({ created_at: { $lt: isoCutoff('365d') } });
  });

  it('bounds rotation-declared objects by shards × unit until the Rotator shards physically', async () => {
    const { engine, deletes } = captureEngine([
      {
        name: 'sys_activity',
        lifecycle: { class: 'telemetry', storage: { strategy: 'rotation', shards: 14, unit: 'day' } },
      },
    ]);

    const report = await service(engine).sweep();

    expect(deletes).toHaveLength(1);
    expect(deletes[0].where).toEqual({ created_at: { $lt: isoCutoff('14d') } });
    expect(report.swept[0].policy).toBe('rotation-fallback');
  });

  it('rotates physically when the driver supports it — no fallback age reap, reclaim on dropped shards', async () => {
    const rotateShards = vi.fn(async () => ({
      object: 'sys_activity',
      current: 'sys_activity__r20260710',
      shards: ['sys_activity__r20260710'],
      dropped: ['sys_activity__r20260626'],
    }));
    const reclaimSpace = vi.fn(async () => {});
    const driver = { name: 'default', supportsRotation: true, rotateShards, reclaimSpace };
    const obj = {
      name: 'sys_activity',
      lifecycle: { class: 'telemetry' as const, storage: { strategy: 'rotation' as const, shards: 14, unit: 'day' as const } },
    };
    const { engine, deletes } = captureEngine([obj], { driver });

    const report = await service(engine).sweep();

    expect(rotateShards).toHaveBeenCalledWith(obj, FIXED_NOW);
    // Rotation replaces the fallback age reap entirely (no retention declared).
    expect(deletes).toHaveLength(0);
    expect(report.swept).toEqual([
      {
        object: 'sys_activity',
        class: 'telemetry',
        policy: 'rotation',
        cutoff: isoCutoff('14d'),
        droppedShards: 1,
      },
    ]);
    // A dropped shard freed pages — the datasource gets an incremental vacuum.
    expect(reclaimSpace).toHaveBeenCalledTimes(1);
  });

  it('an explicit retention still trims inside the live shards after rotation', async () => {
    const rotateShards = vi.fn(async () => ({
      object: 'sys_activity',
      current: 'sys_activity__r20260710',
      shards: ['sys_activity__r20260710'],
      dropped: [],
    }));
    const driver = { name: 'default', supportsRotation: true, rotateShards };
    const { engine, deletes } = captureEngine(
      [
        {
          name: 'sys_activity',
          lifecycle: {
            class: 'telemetry',
            retention: { maxAge: '14d' },
            storage: { strategy: 'rotation', shards: 14, unit: 'day' },
          },
        },
      ],
      { driver },
    );

    const report = await service(engine).sweep();

    expect(rotateShards).toHaveBeenCalledTimes(1);
    expect(deletes).toHaveLength(1);
    expect(deletes[0].where).toEqual({ created_at: { $lt: isoCutoff('14d') } });
    expect(report.swept.map((e) => e.policy)).toEqual(['rotation', 'retention']);
  });

  it('prefers explicit retention over the rotation fallback window', async () => {
    const { engine, deletes } = captureEngine([
      {
        name: 'sys_activity',
        lifecycle: {
          class: 'telemetry',
          retention: { maxAge: '10d' },
          storage: { strategy: 'rotation', shards: 14, unit: 'day' },
        },
      },
    ]);

    const report = await service(engine).sweep();

    expect(deletes).toHaveLength(1);
    expect(deletes[0].where).toEqual({ created_at: { $lt: isoCutoff('10d') } });
    expect(report.swept[0].policy).toBe('retention');
  });

  it('isolates a failing object — other policies still run, error lands in the report', async () => {
    const { engine, deletes } = captureEngine(
      [
        { name: 'bad_object', lifecycle: { class: 'telemetry', retention: { maxAge: '7d' } } },
        { name: 'good_object', lifecycle: { class: 'telemetry', retention: { maxAge: '7d' } } },
      ],
      {
        deleteImpl: (object) => {
          if (object === 'bad_object') throw new Error('no such table');
          return { deletedCount: 2 };
        },
      },
    );

    const report = await service(engine).sweep();

    expect(deletes.map((d) => d.object)).toEqual(['bad_object', 'good_object']);
    expect(report.errors).toEqual([{ object: 'bad_object', error: 'no such table' }]);
    expect(report.swept.map((e) => e.object)).toEqual(['good_object']);
  });

  it('no-ops without an engine', async () => {
    const svc = new LifecycleService({ getEngine: () => undefined, logger: silentLogger() });
    const report = await svc.sweep();
    expect(report.swept).toEqual([]);
  });

  it('no-ops when disabled via option or OS_LIFECYCLE_DISABLED', async () => {
    const { engine, deletes } = captureEngine([
      { name: 'sys_job_run', lifecycle: { class: 'telemetry', retention: { maxAge: '30d' } } },
    ]);

    const disabled = service(engine, { enabled: false });
    await disabled.sweep();
    expect(deletes).toHaveLength(0);

    process.env.OS_LIFECYCLE_DISABLED = '1';
    try {
      await service(engine).sweep();
      expect(deletes).toHaveLength(0);
    } finally {
      delete process.env.OS_LIFECYCLE_DISABLED;
    }
  });
});

describe('LifecycleService.sweep — reap guard', () => {
  const guarded: LifecycleObjectLike[] = [
    { name: 'sys_file', lifecycle: { class: 'transient', ttl: { field: 'deleted_at', expireAfter: '30d' } } },
  ];

  it('deletes only guard-confirmed ids, by $in, after fetching candidates with the cutoff filter', async () => {
    const rows = [
      { id: 'f1', deleted_at: '2020-01-01T00:00:00Z' },
      { id: 'f2', deleted_at: '2020-01-02T00:00:00Z' },
      { id: 'f3', deleted_at: '2020-01-03T00:00:00Z' },
    ];
    const { engine, deletes, finds } = captureEngine(guarded, { findImpl: () => rows });
    const svc = service(engine);
    const guard = vi.fn(async () => ['f1', 'f3']); // vetoes f2
    svc.registerReapGuard('sys_file', guard);

    const report = await svc.sweep();

    expect(finds).toHaveLength(1);
    expect(finds[0].where).toEqual({ deleted_at: { $lt: isoCutoff('30d') } });
    expect(finds[0].context).toEqual({ isSystem: true, positions: [], permissions: [] });
    expect(guard).toHaveBeenCalledWith('sys_file', rows);
    expect(deletes).toHaveLength(1);
    expect(deletes[0].where).toEqual({ id: { $in: ['f1', 'f3'] } });
    expect(deletes[0].multi).toBe(true);
    expect(report.swept).toEqual([
      { object: 'sys_file', class: 'transient', policy: 'ttl', cutoff: isoCutoff('30d'), deleted: 2 },
    ]);
    expect(report.errors).toEqual([]);
  });

  it('an erroring guard fails safe: no rows deleted, error reported', async () => {
    const { engine, deletes } = captureEngine(guarded, { findImpl: () => [{ id: 'f1' }] });
    const svc = service(engine);
    svc.registerReapGuard('sys_file', async () => {
      throw new Error('storage unreachable');
    });

    const report = await svc.sweep();

    expect(deletes).toHaveLength(0);
    expect(report.swept).toEqual([]);
    expect(report.errors).toEqual([{ object: 'sys_file', error: 'storage unreachable' }]);
  });

  it('a guard on one object never changes the blind reap of others (regression pin)', async () => {
    const { engine, deletes } = captureEngine(
      [
        ...guarded,
        { name: 'sys_job_run', lifecycle: { class: 'telemetry', retention: { maxAge: '30d' } } },
      ],
      { findImpl: () => [] },
    );
    const svc = service(engine);
    svc.registerReapGuard('sys_file', async () => []);

    const report = await svc.sweep();

    // sys_file: no candidates → no delete. sys_job_run: classic blind reap.
    expect(deletes).toHaveLength(1);
    expect(deletes[0].object).toBe('sys_job_run');
    expect(deletes[0].where).toEqual({ created_at: { $lt: isoCutoff('30d') } });
    expect(report.errors).toEqual([]);
  });

  it('a guarded object on an engine without find is skipped, never blind-deleted', async () => {
    const { engine, deletes } = captureEngine(guarded); // no findImpl → no engine.find
    const svc = service(engine);
    svc.registerReapGuard('sys_file', async () => ['f1']);

    const report = await svc.sweep();

    expect(deletes).toHaveLength(0);
    expect(report.swept).toEqual([]);
    expect(report.skipped).toEqual([{ object: 'sys_file', reason: 'reap-guard-unsupported' }]);
  });

  it('drains full batches but stops the pass when a batch is not fully confirmed', async () => {
    // Two "pages" of 500, then a short page. All of page 1 confirmed → loop
    // continues; page 2 only partially confirmed → pass ends (vetoed rows
    // would be re-fetched forever within one sweep).
    const page = (n: number, prefix: string) =>
      Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, deleted_at: '2020-01-01T00:00:00Z' }));
    const pages = [page(500, 'a'), page(500, 'b')];
    let call = 0;
    const { engine, deletes, finds } = captureEngine(guarded, { findImpl: () => pages[call++] ?? [] });
    const svc = service(engine);
    svc.registerReapGuard('sys_file', async (_object, rows) =>
      rows[0].id === 'a0' ? rows.map((r: any) => r.id) : rows.slice(0, 10).map((r: any) => r.id),
    );

    const report = await svc.sweep();

    expect(finds).toHaveLength(2);
    expect(deletes).toHaveLength(2);
    expect((deletes[0].where.id.$in as string[]).length).toBe(500);
    expect((deletes[1].where.id.$in as string[]).length).toBe(10);
    expect(report.swept[0].deleted).toBe(510);
  });
});

describe('LifecycleService.sweep — Archiver (P3)', () => {
  const AUDIT_OBJ: LifecycleObjectLike = {
    name: 'sys_audit_log',
    lifecycle: {
      class: 'audit',
      retention: { maxAge: '90d' },
      archive: { after: '90d', to: 'archive', keep: '7y' },
    } as any,
  };

  function coldStore() {
    const upserts: Array<Record<string, unknown>> = [];
    const coldDeletes: any[] = [];
    return {
      upserts,
      coldDeletes,
      driver: {
        name: 'archive',
        syncSchema: vi.fn(async () => {}),
        find: async () => [],
        upsert: async (_object: string, row: Record<string, unknown>) => {
          upserts.push(row);
          return row;
        },
        bulkDelete: async () => {},
        deleteMany: async (_object: string, query: any) => {
          coldDeletes.push(query);
          return 0;
        },
      },
    };
  }

  function hotStore(rows: Array<Record<string, unknown>>) {
    const bulkDeleted: Array<Array<string | number>> = [];
    let remaining = [...rows];
    return {
      bulkDeleted,
      remaining: () => remaining,
      driver: {
        name: 'default',
        find: async (_object: string, query: any) => remaining.slice(0, query.limit ?? remaining.length),
        upsert: async () => ({}),
        bulkDelete: async (_object: string, ids: Array<string | number>) => {
          bulkDeleted.push(ids);
          remaining = remaining.filter((r) => !ids.includes(r.id as string));
        },
        deleteMany: async () => 0,
      },
    };
  }

  it('copies past-window rows to the cold store, then hot-deletes exactly the copied ids', async () => {
    const cold = coldStore();
    const hot = hotStore([
      { id: 'a', created_at: '2020-01-01T00:00:00.000Z' },
      { id: 'b', created_at: '2020-06-01T00:00:00.000Z' },
    ]);
    const { engine } = captureEngine([AUDIT_OBJ], {
      driver: hot.driver,
      datasources: { archive: cold.driver },
    });

    const report = await service(engine).sweep();

    expect(cold.driver.syncSchema).toHaveBeenCalledWith('sys_audit_log', AUDIT_OBJ);
    expect(cold.upserts.map((r) => r.id)).toEqual(['a', 'b']);
    expect(hot.bulkDeleted).toEqual([['a', 'b']]);
    expect(hot.remaining()).toEqual([]);

    const entry = report.swept.find((e) => e.policy === 'archive');
    expect(entry?.archived).toBe(2);
    expect(entry?.cutoff).toBe(isoCutoff('90d'));
    // keep: '7y' → the archive itself is pruned past the keep window.
    expect(cold.coldDeletes).toEqual([{ where: { created_at: { $lt: isoCutoff('7y') } } }]);
    expect(report.skipped).toEqual([]);
  });

  it('retains everything and reports archive-pending when the archive datasource is missing', async () => {
    const hot = hotStore([{ id: 'a', created_at: '2020-01-01T00:00:00.000Z' }]);
    const { engine, deletes } = captureEngine([AUDIT_OBJ], { driver: hot.driver });

    const report = await service(engine).sweep();

    expect(deletes).toHaveLength(0);
    expect(hot.bulkDeleted).toEqual([]);
    expect(report.skipped).toEqual([{ object: 'sys_audit_log', reason: 'archive-pending' }]);
  });
});

describe('LifecycleService.sweep — space reclaim', () => {
  it('reclaims once per driver after deletions', async () => {
    const reclaimSpace = vi.fn(async () => {});
    const driver = { name: 'default', reclaimSpace };
    const { engine } = captureEngine(
      [
        { name: 'sys_job_run', lifecycle: { class: 'telemetry', retention: { maxAge: '30d' } } },
        { name: 'sys_http_delivery', lifecycle: { class: 'telemetry', retention: { maxAge: '30d' } } },
      ],
      { driver },
    );

    const report = await service(engine).sweep();

    // Two objects share one datasource — a single incremental_vacuum suffices.
    expect(reclaimSpace).toHaveBeenCalledTimes(1);
    expect(report.reclaimed).toEqual(['default']);
  });

  it('honors reclaim:false and skips reclaim when nothing was deleted', async () => {
    const reclaimSpace = vi.fn(async () => {});
    const driver = { name: 'default', reclaimSpace };

    const optedOut = captureEngine(
      [{ name: 'sys_job_run', lifecycle: { class: 'telemetry', retention: { maxAge: '30d' }, reclaim: false } }],
      { driver },
    );
    await service(optedOut.engine).sweep();
    expect(reclaimSpace).not.toHaveBeenCalled();

    const nothingDeleted = captureEngine(
      [{ name: 'sys_job_run', lifecycle: { class: 'telemetry', retention: { maxAge: '30d' } } }],
      { driver, deleteImpl: () => ({ deletedCount: 0 }) },
    );
    await service(nothingDeleted.engine).sweep();
    expect(reclaimSpace).not.toHaveBeenCalled();
  });

  it('a reclaim failure is logged, not thrown', async () => {
    const driver = { name: 'default', reclaimSpace: vi.fn(async () => { throw new Error('locked'); }) };
    const { engine } = captureEngine(
      [{ name: 'sys_job_run', lifecycle: { class: 'telemetry', retention: { maxAge: '30d' } } }],
      { driver },
    );

    const report = await service(engine).sweep();
    expect(report.reclaimed).toEqual([]);
    expect(report.swept).toHaveLength(1);
  });
});

describe('LifecycleService.sweep — governance (P4)', () => {
  const TELEMETRY_OBJ: LifecycleObjectLike = {
    name: 'sys_job_run',
    lifecycle: { class: 'telemetry', retention: { maxAge: '30d' } } as any,
  };

  /** Fake settings service backed by a value map, with per-tenant values. */
  function fakeSettings(values: Record<string, unknown>, tenantValues: Record<string, Record<string, unknown>> = {}) {
    return {
      async get(_ns: string, key: string, ctx?: Record<string, unknown>) {
        const tenantId = ctx?.tenantId as string | undefined;
        if (tenantId && tenantValues[tenantId] && key in tenantValues[tenantId]) {
          return { value: tenantValues[tenantId][key], source: 'tenant' };
        }
        if (key in values) return { value: values[key], source: 'global' };
        return { value: undefined, source: 'default' };
      },
    };
  }

  it('a global retention override beats the declared window', async () => {
    const { engine, deletes } = captureEngine([TELEMETRY_OBJ]);
    const settings = fakeSettings({ retention_overrides: { sys_job_run: { maxAge: '90d' } } });

    await service(engine, { getSettings: () => settings }).sweep();

    expect(deletes).toHaveLength(1);
    expect(deletes[0].where).toEqual({ created_at: { $lt: isoCutoff('90d') } });
  });

  it('an invalid override keeps the declared window (never fails open)', async () => {
    const { engine, deletes } = captureEngine([TELEMETRY_OBJ]);
    const settings = fakeSettings({ retention_overrides: { sys_job_run: { maxAge: 'forever' } } });

    await service(engine, { getSettings: () => settings }).sweep();

    expect(deletes[0].where).toEqual({ created_at: { $lt: isoCutoff('30d') } });
  });

  it('settings enabled=false disables the sweep at runtime', async () => {
    const { engine, deletes } = captureEngine([TELEMETRY_OBJ]);
    const settings = fakeSettings({ enabled: false });

    const report = await service(engine, { getSettings: () => settings }).sweep();

    expect(deletes).toHaveLength(0);
    expect(report.swept).toEqual([]);
  });

  it('tenant-scoped overrides sweep each tenant on its own window and everyone else globally', async () => {
    const { engine, deletes } = captureEngine([TELEMETRY_OBJ]);
    (engine as any).find = async (object: string) =>
      object === 'sys_organization' ? [{ id: 'org_reg' }, { id: 'org_plain' }] : [];
    const settings = fakeSettings(
      {},
      { org_reg: { retention_overrides: { sys_job_run: { maxAge: '2y' } } } },
    );

    await service(engine, { getSettings: () => settings }).sweep();

    // One tenant-scoped delete on the regulated tenant's 2y window…
    expect(deletes[0].where).toEqual({
      created_at: { $lt: isoCutoff('2y') },
      organization_id: 'org_reg',
    });
    // …then the global 30d pass excluding it but INCLUDING NULL-org rows.
    expect(deletes[1].where).toEqual({
      created_at: { $lt: isoCutoff('30d') },
      $or: [{ organization_id: { $nin: ['org_reg'] } }, { organization_id: null }],
    });
    expect(deletes).toHaveLength(2);
  });

  it('retention.onlyWhen survives tenant-scoped overrides on every pass', async () => {
    const { engine, deletes } = captureEngine([
      {
        name: 'sys_automation_run',
        lifecycle: {
          class: 'telemetry',
          retention: { maxAge: '30d', onlyWhen: { status: { $in: ['completed', 'failed'] } } },
        } as any,
      },
    ]);
    (engine as any).find = async (object: string) =>
      object === 'sys_organization' ? [{ id: 'org_reg' }] : [];
    const settings = fakeSettings(
      {},
      { org_reg: { retention_overrides: { sys_automation_run: { maxAge: '2y' } } } },
    );

    await service(engine, { getSettings: () => settings }).sweep();

    const predicate = { status: { $in: ['completed', 'failed'] } };
    expect(deletes[0].where).toEqual({
      created_at: { $lt: isoCutoff('2y') },
      organization_id: 'org_reg',
      ...predicate,
    });
    expect(deletes[1].where).toEqual({
      created_at: { $lt: isoCutoff('30d') },
      $or: [{ organization_id: { $nin: ['org_reg'] } }, { organization_id: null }],
      ...predicate,
    });
    expect(deletes).toHaveLength(2);
  });

  it('raises quota and growth alerts (observe-only — no extra deletes)', async () => {
    const onAlert = vi.fn();
    const count = vi.fn(async () => 1_500);
    const driver = { name: 'default', count };
    const { engine, deletes } = captureEngine([TELEMETRY_OBJ], { driver });
    const settings = fakeSettings({ quotas: { sys_job_run: 1_000 }, growth_alert_rows: 100 });
    const svc = service(engine, { getSettings: () => settings, onAlert });

    const first = await svc.sweep();
    expect(first.alerts).toEqual([{ type: 'quota-exceeded', object: 'sys_job_run', rowCount: 1_500, quota: 1_000 }]);

    // Second sweep: +500 rows since the baseline → growth alert too.
    count.mockResolvedValue(2_000);
    const second = await svc.sweep();
    expect(second.alerts).toContainEqual({ type: 'quota-exceeded', object: 'sys_job_run', rowCount: 2_000, quota: 1_000 });
    expect(second.alerts).toContainEqual({ type: 'growth', object: 'sys_job_run', rowCount: 2_000, delta: 500 });
    expect(onAlert).toHaveBeenCalledTimes(3);

    // Governance only ever ALERTS — the reap count is untouched (one per sweep).
    expect(deletes).toHaveLength(2);
  });

  it('quota defaults by class apply when no per-object quota is set', async () => {
    const driver = { name: 'default', count: async () => 50 };
    const { engine } = captureEngine([TELEMETRY_OBJ], { driver });
    const settings = fakeSettings({ quota_defaults: { telemetry: 10 } });

    const report = await service(engine, { getSettings: () => settings }).sweep();

    expect(report.alerts).toEqual([{ type: 'quota-exceeded', object: 'sys_job_run', rowCount: 50, quota: 10 }]);
  });
});

describe('LifecycleService timers', () => {
  it('start() sweeps after the initial delay and then on the interval; stop() disarms', async () => {
    vi.useFakeTimers();
    try {
      const { engine, deletes } = captureEngine([
        { name: 'sys_job_run', lifecycle: { class: 'telemetry', retention: { maxAge: '30d' } } },
      ]);
      const svc = service(engine, { initialDelayMs: 1_000, sweepIntervalMs: 5_000 });

      svc.start();
      expect(deletes).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(deletes).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(deletes).toHaveLength(2);

      svc.stop();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(deletes).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
