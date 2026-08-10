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

  it('deletes only guard-confirmed ids, per id, after fetching candidates with the cutoff filter', async () => {
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
    // Per-id deletes — the engine's delete path reads `where.id` as a scalar
    // target; a `{$in}` there would be bound as an object by the driver.
    expect(deletes.map((d) => d.where)).toEqual([{ id: 'f1' }, { id: 'f3' }]);
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

  it('a guard on one object is never consulted for the reap of others (regression pin)', async () => {
    // [#5194] This pin used to read "sys_job_run: classic blind reap" and
    // assert the unbounded `multi: true` DELETE — the exact limb #5194 removed,
    // so keeping the assertion would have kept it passing on an empty result.
    // The property it exists for is untouched and now sharper: an UNGUARDED
    // object runs the same batched machinery with an empty guard list, so
    // "can another object's guard reach this reap?" is a live question rather
    // than a moot one. It must not, and it is never even consulted.
    const guard = vi.fn(async () => []);
    const { engine, deletes, finds } = captureEngine(
      [
        ...guarded,
        { name: 'sys_job_run', lifecycle: { class: 'telemetry', retention: { maxAge: '30d' } } },
      ],
      { findImpl: (object) => (object === 'sys_job_run' ? [{ id: 'j1' }] : []) },
    );
    const svc = service(engine);
    svc.registerReapGuard('sys_file', guard);

    const report = await svc.sweep();

    // sys_file: no candidates → nothing to confirm, nothing deleted.
    expect(guard).not.toHaveBeenCalled();
    // sys_job_run: read on its own cutoff, deleted by id, guard-free.
    expect(finds.map((f) => f.object)).toEqual(['sys_file', 'sys_job_run']);
    expect(finds[1].where).toEqual({ created_at: { $lt: isoCutoff('30d') } });
    expect(deletes).toEqual([
      { object: 'sys_job_run', where: { id: 'j1' }, multi: true, context: { isSystem: true, positions: [], permissions: [] } },
    ]);
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
    expect(deletes).toHaveLength(510); // 500 confirmed from page 1 + 10 from page 2, per id
    expect(report.swept[0].deleted).toBe(510);
  });
});

// [#5535] Two registrars on ONE object. Before this, `registerReapGuard` was a
// single-slot `set()`: the second registrant silently unhooked the first — on
// `sys_file` that means the byte-reclaim guard stops running while the rows
// (the only pointer to those bytes) keep being deleted. Guards now compose by
// intersection, which is what "confirm before delete" already implied.
describe('LifecycleService.sweep — reap guard composition', () => {
  const guarded: LifecycleObjectLike[] = [
    { name: 'sys_file', lifecycle: { class: 'transient', ttl: { field: 'deleted_at', expireAfter: '30d' } } },
  ];

  const rowsOf = (...ids: string[]) => ids.map((id) => ({ id, deleted_at: '2020-01-01T00:00:00Z' }));

  /** A store the sweep actually drains, so "retried next sweep" is observable. */
  function backedEngine(seed: Array<Record<string, unknown>>) {
    const store = [...seed];
    const captured = captureEngine(guarded, {
      findImpl: () => store.slice(),
      deleteImpl: (_object, options) => {
        const idx = store.findIndex((r) => r.id === options?.where?.id);
        if (idx >= 0) store.splice(idx, 1);
        return { deletedCount: idx >= 0 ? 1 : 0 };
      },
    });
    return { ...captured, store };
  }

  const idsOf = (rows: Array<Record<string, unknown>>) => rows.map((r) => r.id as string);

  it('deletes only ids EVERY guard confirmed; a veto by either one keeps the row', async () => {
    const rows = rowsOf('f1', 'f2', 'f3');
    const { engine, deletes } = captureEngine(guarded, { findImpl: () => rows });
    const svc = service(engine);
    // Each guard vetoes a different id — neither alone would keep both.
    svc.registerReapGuard('sys_file', async (_o, r) => idsOf(r).filter((id) => id !== 'f2'));
    svc.registerReapGuard('sys_file', async (_o, r) => idsOf(r).filter((id) => id !== 'f3'));

    const report = await svc.sweep();

    expect(deletes.map((d) => d.where)).toEqual([{ id: 'f1' }]);
    expect(report.swept[0].deleted).toBe(1);
    expect(report.errors).toEqual([]);
  });

  it('is order-independent: the same two guards registered the other way round agree', async () => {
    const vetoF2 = async (_o: string, r: Array<Record<string, unknown>>) =>
      idsOf(r).filter((id) => id !== 'f2');
    const vetoF3 = async (_o: string, r: Array<Record<string, unknown>>) =>
      idsOf(r).filter((id) => id !== 'f3');

    const deleteSets: string[][] = [];
    for (const order of [[vetoF2, vetoF3], [vetoF3, vetoF2]]) {
      const { engine, deletes } = captureEngine(guarded, { findImpl: () => rowsOf('f1', 'f2', 'f3') });
      const svc = service(engine);
      for (const g of order) svc.registerReapGuard('sys_file', g);
      await svc.sweep();
      deleteSets.push(deletes.map((d) => d.where.id as string));
    }

    expect(deleteSets[0]).toEqual(['f1']);
    expect(deleteSets[1]).toEqual(deleteSets[0]);
  });

  it('asks a guard only about rows the guards before it confirmed', async () => {
    // The point of the narrowing: a guard's confirmation is the RECEIPT for
    // cleanup it has already performed. Showing guard 2 a row guard 1 vetoed
    // would have it reclaim/de-index a row that then survives the sweep.
    const rows = rowsOf('f1', 'f2', 'f3');
    const { engine } = captureEngine(guarded, { findImpl: () => rows });
    const svc = service(engine);
    const first = vi.fn(async (_o: string, r: Array<Record<string, unknown>>) =>
      idsOf(r).filter((id) => id !== 'f2'),
    );
    const second = vi.fn(async (_o: string, r: Array<Record<string, unknown>>) => idsOf(r));
    svc.registerReapGuard('sys_file', first);
    svc.registerReapGuard('sys_file', second);

    await svc.sweep();

    expect(first).toHaveBeenCalledWith('sys_file', rows); // the full candidate batch
    expect(second).toHaveBeenCalledTimes(1);
    expect(idsOf(second.mock.calls[0][1])).toEqual(['f1', 'f3']); // f2 already vetoed
  });

  it('a guard that vetoes the whole batch spares the later guards the call', async () => {
    const { engine, deletes } = captureEngine(guarded, { findImpl: () => rowsOf('f1', 'f2') });
    const svc = service(engine);
    const second = vi.fn(async (_o: string, r: Array<Record<string, unknown>>) => idsOf(r));
    svc.registerReapGuard('sys_file', async () => []);
    svc.registerReapGuard('sys_file', second);

    const report = await svc.sweep();

    expect(second).not.toHaveBeenCalled();
    expect(deletes).toHaveLength(0);
    expect(report.swept[0].deleted).toBe(0);
  });

  it('a row one guard vetoed is retried by the next sweep and deleted once both confirm', async () => {
    const { engine, store } = backedEngine(rowsOf('f1', 'f2'));
    const svc = service(engine);
    let firstSweep = true;
    svc.registerReapGuard('sys_file', async (_o, r) =>
      idsOf(r).filter((id) => !(firstSweep && id === 'f2')),
    );
    svc.registerReapGuard('sys_file', async (_o, r) => idsOf(r));

    const one = await svc.sweep();
    expect(idsOf(store)).toEqual(['f2']); // vetoed, still there
    expect(one.swept[0].deleted).toBe(1);

    firstSweep = false;
    const two = await svc.sweep();
    expect(store).toEqual([]); // retried and reaped
    expect(two.swept[0].deleted).toBe(1);
  });

  it('a throwing guard deletes nothing — not even ids an earlier guard confirmed', async () => {
    // Same fail-safe as the single-guard case: the error reaches the per-object
    // handler in sweep() and no row is deleted. The earlier guard's external
    // cleanup for this batch is simply retried next sweep — never paid out in
    // a delete on a batch no one finished confirming.
    const { engine, deletes } = captureEngine(guarded, { findImpl: () => rowsOf('f1', 'f2') });
    const svc = service(engine);
    const first = vi.fn(async (_o: string, r: Array<Record<string, unknown>>) => idsOf(r));
    svc.registerReapGuard('sys_file', first);
    svc.registerReapGuard('sys_file', async () => {
      throw new Error('index unreachable');
    });

    const report = await svc.sweep();

    expect(first).toHaveBeenCalledTimes(1);
    expect(deletes).toHaveLength(0);
    expect(report.swept).toEqual([]);
    expect(report.errors).toEqual([{ object: 'sys_file', error: 'index unreachable' }]);
  });

  it('registering the identical guard twice runs it once (re-run wiring, not a second opinion)', async () => {
    const { engine, deletes } = captureEngine(guarded, { findImpl: () => rowsOf('f1') });
    const svc = service(engine);
    const guard = vi.fn(async (_o: string, r: Array<Record<string, unknown>>) => idsOf(r));
    svc.registerReapGuard('sys_file', guard);
    svc.registerReapGuard('sys_file', guard);

    await svc.sweep();

    // Called twice, its external cleanup would run twice per batch.
    expect(guard).toHaveBeenCalledTimes(1);
    expect(deletes.map((d) => d.where)).toEqual([{ id: 'f1' }]);
  });

  it('multiple guards on an engine without find are skipped, never blind-deleted', async () => {
    const { engine, deletes } = captureEngine(guarded); // no findImpl → no engine.find
    const svc = service(engine);
    svc.registerReapGuard('sys_file', async () => ['f1']);
    svc.registerReapGuard('sys_file', async () => ['f1']);

    const report = await svc.sweep();

    expect(deletes).toHaveLength(0);
    expect(report.skipped).toEqual([{ object: 'sys_file', reason: 'reap-guard-unsupported' }]);
  });

  it('keeps byte reclaim running when a second consumer registers (the #5535 shape)', async () => {
    // service-storage's `sys_file` guard, in the same shape but stubbed here:
    // reclaim the bytes FIRST, confirm only if that succeeded (the row is the
    // only pointer to the bytes, so a failed reclaim must veto). The second
    // registrar is the ADR-0057 §3.3 domain callback #4672 will add — it
    // de-indexes by id. Under the old single-slot registry the byte reclaim
    // was unhooked wholesale by that second call: rows deleted, bytes leaked.
    const bytes = new Map([
      ['f1', 'k1'],
      ['f2', 'k2'],
      ['f3', 'k3'],
    ]);
    const index = new Set(['f1', 'f2', 'f3']);
    const { engine, store } = backedEngine(rowsOf('f1', 'f2', 'f3'));
    const svc = service(engine);

    svc.registerReapGuard('sys_file', async (_o, rows) => {
      const confirmed: string[] = [];
      for (const row of rows) {
        const id = row.id as string;
        if (id === 'f2') continue; // storage.delete threw → veto, keep the pointer
        bytes.delete(id);
        confirmed.push(id);
      }
      return confirmed;
    });
    svc.registerReapGuard('sys_file', async (_o, rows) => {
      const confirmed: string[] = [];
      for (const row of rows) {
        index.delete(row.id as string);
        confirmed.push(row.id as string);
      }
      return confirmed;
    });

    const report = await svc.sweep();

    expect(idsOf(store)).toEqual(['f2']); // vetoed row retained for the next sweep
    expect([...bytes.keys()]).toEqual(['f2']); // …with its bytes intact — no leak
    // …and the de-indexer was never shown f2, so a surviving row keeps its
    // index entry rather than silently disappearing from search.
    expect([...index]).toEqual(['f2']);
    expect(report.swept[0].deleted).toBe(2);
    expect(report.errors).toEqual([]);
  });
});

describe('LifecycleService.sweep — unguarded reap batching (#5194)', () => {
  /** An ordinary lifecycle object: retention declared, NO reap guard. */
  const plain: LifecycleObjectLike[] = [
    { name: 'sys_job_run', lifecycle: { class: 'telemetry', retention: { maxAge: '30d' } } },
  ];

  /**
   * An engine whose rows really disappear, so "what one sweep did" and "what
   * the next sweep still finds" are both observable. Deletion is by id through
   * a Map (O(1)) — the ceiling case drives 10k deletes and an array scan per
   * delete would make this test quadratic.
   */
  function storeEngine(objects: LifecycleObjectLike[], rowCount: number) {
    const store = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < rowCount; i++) store.set(`r${i}`, { id: `r${i}`, created_at: '2020-01-01T00:00:00Z' });
    const captured = captureEngine(objects, {
      findImpl: (_object, options) => {
        const limit = (options?.limit as number) ?? store.size;
        const page: Array<Record<string, unknown>> = [];
        for (const row of store.values()) {
          if (page.length >= limit) break;
          page.push(row);
        }
        return page;
      },
      deleteImpl: (_object, options) => {
        const id = options?.where?.id as string | undefined;
        const existed = id !== undefined && store.delete(id);
        return { deletedCount: existed ? 1 : 0 };
      },
    });
    return { ...captured, store };
  }

  it('bounds the FIRST sweep over a large backlog, and drains the rest on later sweeps', async () => {
    // The #5194 scenario: retention declared on a table that already holds
    // history. Before this change that first sweep was ONE unbounded DELETE
    // over every historical row — a long write transaction (SQLite locks the
    // whole database for it). It is now 20 pages of 500, by id, and the
    // remainder waits for the next sweep.
    const CEILING = 500 * 20;
    const { engine, deletes, finds, store } = storeEngine(plain, CEILING + 7);
    const svc = service(engine);

    const first = await svc.sweep();

    expect(finds).toHaveLength(20);                       // exactly the per-sweep page budget
    expect(finds.every((f) => f.limit === 500)).toBe(true);
    expect(deletes).toHaveLength(CEILING);                // …and not one row more
    expect(first.swept[0].deleted).toBe(CEILING);         // the report says what really happened
    expect(store.size).toBe(7);                           // backlog left standing, not lost

    // Every delete named ONE row by scalar id — never a predicate, so each is a
    // short transaction and each gets the by-id cascade path.
    expect(deletes.every((d) => typeof d.where?.id === 'string')).toBe(true);
    expect(deletes.every((d) => Object.keys(d.where).length === 1)).toBe(true);

    const second = await svc.sweep();

    expect(second.swept[0].deleted).toBe(7);              // the remainder drains next sweep
    expect(store.size).toBe(0);
    expect(finds).toHaveLength(21);                       // 20 + one short page, which ends the pass
  });

  it('leaves the steady state alone: a small increment is one page and one report line', async () => {
    const { engine, deletes, finds, store } = storeEngine(plain, 3);

    const report = await service(engine).sweep();

    expect(finds).toHaveLength(1);                        // short page ⇒ no second read
    expect(finds[0].where).toEqual({ created_at: { $lt: isoCutoff('30d') } });
    expect(finds[0].context).toEqual({ isSystem: true, positions: [], permissions: [] });
    expect(deletes.map((d) => d.where)).toEqual([{ id: 'r0' }, { id: 'r1' }, { id: 'r2' }]);
    expect(store.size).toBe(0);
    expect(report.swept).toEqual([
      { object: 'sys_job_run', class: 'telemetry', policy: 'retention', cutoff: isoCutoff('30d'), deleted: 3 },
    ]);
    expect(report.errors).toEqual([]);
  });

  it('still honours retention.onlyWhen — the predicate moves to the candidate READ', async () => {
    const onlyWhen: LifecycleObjectLike[] = [
      {
        name: 'sys_automation_run',
        lifecycle: {
          class: 'telemetry',
          retention: { maxAge: '30d', onlyWhen: { status: { $in: ['completed', 'failed'] } } },
        } as unknown as LifecycleObjectLike['lifecycle'],
      },
    ];
    const { engine, finds, deletes } = storeEngine(onlyWhen, 2);

    await service(engine).sweep();

    // The scope narrows which rows are CANDIDATES; it is not silently dropped
    // now that the delete addresses rows by id.
    expect(finds[0].where).toEqual({
      created_at: { $lt: isoCutoff('30d') },
      status: { $in: ['completed', 'failed'] },
    });
    expect(deletes.map((d) => d.where)).toEqual([{ id: 'r0' }, { id: 'r1' }]);
  });

  it('an engine that cannot read rows keeps the single bulk DELETE — retention never just stops', async () => {
    // `find` is optional on LifecycleEngineLike. Batching needs it; enforcement
    // does not. An engine without it degrades to the pre-#5194 unbounded delete
    // rather than losing the policy — the fail-safe for guards (skip) would be
    // the wrong trade here, because no guard is waiting to confirm anything.
    const { engine, deletes } = captureEngine(plain); // no findImpl → no engine.find

    const report = await service(engine).sweep();

    expect(deletes).toHaveLength(1);
    expect(deletes[0].multi).toBe(true);
    expect(deletes[0].where).toEqual({ created_at: { $lt: isoCutoff('30d') } });
    expect(report.skipped).toEqual([]);
    expect(report.swept[0].deleted).toBe(3); // whatever the driver reported
  });

  it('never turns an id-less row into a predicate delete', async () => {
    // `where: { id: undefined }` + `multi: true` is NOT a by-id delete: the
    // engine finds no scalar id, routes to deleteMany, and runs the batch's
    // whole cutoff predicate. With zero guards nothing else narrows the page,
    // so this is the one place that invariant can be enforced.
    const { engine, deletes } = captureEngine(plain, {
      findImpl: () => [{ id: 'r0' }, { id: null }, { created_at: '2020-01-01T00:00:00Z' }],
    });

    const report = await service(engine).sweep();

    expect(deletes.map((d) => d.where)).toEqual([{ id: 'r0' }]);
    expect(report.swept[0].deleted).toBe(1);
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
    // [#5194] One candidate row per pass, so each pass is observable both in
    // the predicate it reads with and in the by-id delete it then issues.
    const { engine, deletes, finds } = captureEngine([TELEMETRY_OBJ], {
      findImpl: (object, options) => {
        if (object === 'sys_organization') return [{ id: 'org_reg' }, { id: 'org_plain' }];
        const org = (options?.where as Record<string, unknown> | undefined)?.organization_id;
        return [{ id: org === 'org_reg' ? 'tenant_row' : 'global_row' }];
      },
    });
    const settings = fakeSettings(
      {},
      { org_reg: { retention_overrides: { sys_job_run: { maxAge: '2y' } } } },
    );

    await service(engine, { getSettings: () => settings }).sweep();

    // The per-pass predicate is carried by the candidate READ now — the passes
    // themselves, and their windows, are unchanged.
    const reaps = finds.filter((f) => f.object === 'sys_job_run');
    // One tenant-scoped pass on the regulated tenant's 2y window…
    expect(reaps[0].where).toEqual({
      created_at: { $lt: isoCutoff('2y') },
      organization_id: 'org_reg',
    });
    // …then the global 30d pass excluding it but INCLUDING NULL-org rows.
    expect(reaps[1].where).toEqual({
      created_at: { $lt: isoCutoff('30d') },
      $or: [{ organization_id: { $nin: ['org_reg'] } }, { organization_id: null }],
    });
    expect(reaps).toHaveLength(2);
    expect(deletes.map((d) => d.where)).toEqual([{ id: 'tenant_row' }, { id: 'global_row' }]);
  });

  it('retention.onlyWhen survives tenant-scoped overrides on every pass', async () => {
    const { engine, deletes, finds } = captureEngine(
      [
        {
          name: 'sys_automation_run',
          lifecycle: {
            class: 'telemetry',
            retention: { maxAge: '30d', onlyWhen: { status: { $in: ['completed', 'failed'] } } },
          } as any,
        },
      ],
      {
        findImpl: (object, options) => {
          if (object === 'sys_organization') return [{ id: 'org_reg' }];
          const org = (options?.where as Record<string, unknown> | undefined)?.organization_id;
          return [{ id: org === 'org_reg' ? 'tenant_row' : 'global_row' }];
        },
      },
    );
    const settings = fakeSettings(
      {},
      { org_reg: { retention_overrides: { sys_automation_run: { maxAge: '2y' } } } },
    );

    await service(engine, { getSettings: () => settings }).sweep();

    // [#5194] `onlyWhen` narrows which rows are CANDIDATES; it rides the read
    // that selects them, on every pass, and is not dropped now that the delete
    // addresses rows by id.
    const predicate = { status: { $in: ['completed', 'failed'] } };
    const reaps = finds.filter((f) => f.object === 'sys_automation_run');
    expect(reaps[0].where).toEqual({
      created_at: { $lt: isoCutoff('2y') },
      organization_id: 'org_reg',
      ...predicate,
    });
    expect(reaps[1].where).toEqual({
      created_at: { $lt: isoCutoff('30d') },
      $or: [{ organization_id: { $nin: ['org_reg'] } }, { organization_id: null }],
      ...predicate,
    });
    expect(reaps).toHaveLength(2);
    expect(deletes.map((d) => d.where)).toEqual([{ id: 'tenant_row' }, { id: 'global_row' }]);
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

  // [#6231] `count()` takes the object name as argument ONE; the query AST is
  // `DriverQuery` (`Omit<QueryAST, 'object'>`) and must not restate it. The
  // governance counter used to pass `{ object: obj.name }` — carried not by a
  // cast but by a hand-written driver shape whose `query` was
  // `Record<string, unknown>`, which would equally have accepted a `where` the
  // filter dialect does not have.
  it('counts by argument one only — the query never restates the object name', async () => {
    const count = vi.fn(async (_object: string, _query?: unknown) => 5);
    const driver = { name: 'default', count };
    const { engine } = captureEngine([TELEMETRY_OBJ], { driver });
    const settings = fakeSettings({ quotas: { sys_job_run: 1 } });

    await service(engine, { getSettings: () => settings }).sweep();

    expect(count).toHaveBeenCalled();
    for (const [object, query] of count.mock.calls) {
      expect(object).toBe('sys_job_run');
      expect(query ?? {}).not.toHaveProperty('object');
    }
  });

  it('quota defaults by class apply when no per-object quota is set', async () => {
    const driver = { name: 'default', count: async () => 50 };
    const { engine } = captureEngine([TELEMETRY_OBJ], { driver });
    const settings = fakeSettings({ quota_defaults: { telemetry: 10 } });

    const report = await service(engine, { getSettings: () => settings }).sweep();

    expect(report.alerts).toEqual([{ type: 'quota-exceeded', object: 'sys_job_run', rowCount: 50, quota: 10 }]);
  });
});

// #5195 — ADR-0057 P4 lets an operator override any object's window through the
// `lifecycle` settings namespace, and until this the only validation on that
// override was "does it parse". That is a side door around #5179's invariant:
// `DbQueueAdapter` dedups `sys_job_queue` publishes against terminal rows by
// `created_at`, checks at CONSTRUCTION that its idempotency window is ≤ the
// object's DECLARED retention — and never sees a settings override. Set
// `maxAge: '1h'` and the rows the dedup check reads are reaped an hour after
// they are written, so duplicate deliveries resume with nothing in any log.
//
// A consumer now registers the shortest window its contract survives; an
// override below it is rejected (not clamped) and the declared window runs.
// Nothing here names sys_job_queue: the mechanism is the deliverable, the queue
// is only its first caller (pinned end-to-end in @objectstack/service-queue).
describe('LifecycleService — retention floors (#5195)', () => {
  const FLOOR_MS = 24 * 3_600_000; // 24h, the queue's default dedup window

  const floor = (over: Partial<Parameters<LifecycleService['registerRetentionFloor']>[1]> = {}) => ({
    policy: 'retention' as const,
    minWindowMs: FLOOR_MS,
    declaredBy: 'com.example.consumer',
    consequence: 'the consumer silently re-accepts work it already did.',
    remedy: 'raise the override to ≥ 24h, or shorten the consumer window.',
    ...over,
  });

  const QUEUE_LIKE: LifecycleObjectLike = {
    name: 'app_work_queue',
    lifecycle: { class: 'transient', retention: { maxAge: '7d', onlyWhen: { status: 'done' } } } as any,
  };

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

  it('rejects a global override below the floor and keeps enforcing the declared window', async () => {
    const error = vi.fn();
    const { engine, deletes } = captureEngine([QUEUE_LIKE]);
    const settings = fakeSettings({ retention_overrides: { app_work_queue: { maxAge: '1h' } } });
    const svc = service(engine, {
      getSettings: () => settings,
      logger: { ...silentLogger(), error },
    });
    svc.registerRetentionFloor('app_work_queue', floor());

    const report = await svc.sweep();

    // The 1h override never reaches the delete: rows still live 7d, so the
    // consumer's 24h dedup window still has rows to dedup against.
    expect(deletes).toHaveLength(1);
    expect(deletes[0].where).toEqual({ created_at: { $lt: isoCutoff('7d') }, status: 'done' });
    expect(report.swept[0].cutoff).toBe(isoCutoff('7d'));

    // …and it is loud: machine-readable on the report, `error` in the log,
    // carrying the consequence AND the fix (AGENTS.md degradation rule).
    expect(report.floorViolations).toEqual([{
      object: 'app_work_queue',
      policy: 'retention',
      scope: 'global',
      override: '1h',
      offendingMs: 3_600_000,
      floorMs: FLOOR_MS,
      declaredBy: 'com.example.consumer',
      appliedMs: 7 * 86_400_000,
    }]);
    expect(error).toHaveBeenCalledTimes(1);
    const line = error.mock.calls[0]![0] as string;
    expect(line).toContain('REJECTED');
    expect(line).toContain('com.example.consumer');
    expect(line).toContain('Consequence:');
    expect(line).toContain('Fix:');
  });

  it('a legal override (≥ the floor) still wins over the declared window', async () => {
    const { engine, deletes } = captureEngine([QUEUE_LIKE]);
    // 2d: shorter than the declared 7d, longer than the 24h floor — exactly the
    // environment tuning P4 exists for. The floor bounds overrides, it does not
    // abolish them.
    const settings = fakeSettings({ retention_overrides: { app_work_queue: { maxAge: '2d' } } });
    const svc = service(engine, { getSettings: () => settings });
    svc.registerRetentionFloor('app_work_queue', floor());

    const report = await svc.sweep();

    expect(deletes[0].where).toEqual({ created_at: { $lt: isoCutoff('2d') }, status: 'done' });
    expect(report.floorViolations).toEqual([]);
  });

  it('an override exactly AT the floor is legal (the bound is ≥, not >)', async () => {
    const { engine, deletes } = captureEngine([QUEUE_LIKE]);
    const settings = fakeSettings({ retention_overrides: { app_work_queue: { maxAge: '24h' } } });
    const svc = service(engine, { getSettings: () => settings });
    svc.registerRetentionFloor('app_work_queue', floor());

    const report = await svc.sweep();

    expect(deletes[0].where).toEqual({ created_at: { $lt: isoCutoff('24h') }, status: 'done' });
    expect(report.floorViolations).toEqual([]);
  });

  it('an object with no registered floor is untouched — 1h still applies', async () => {
    const { engine, deletes } = captureEngine([
      QUEUE_LIKE,
      { name: 'sys_job_run', lifecycle: { class: 'telemetry', retention: { maxAge: '30d' } } as any },
    ]);
    const settings = fakeSettings({
      retention_overrides: { app_work_queue: { maxAge: '1h' }, sys_job_run: { maxAge: '1h' } },
    });
    const svc = service(engine, { getSettings: () => settings });
    // Floor on ONE object only.
    svc.registerRetentionFloor('app_work_queue', floor());

    const report = await svc.sweep();

    const forObject = (name: string) => deletes.find((d) => d.object === name)!;
    expect(forObject('app_work_queue').where.created_at.$lt).toBe(isoCutoff('7d'));
    // No floor ⇒ P4 is unchanged: an aggressive override is the operator's call.
    expect(forObject('sys_job_run').where.created_at.$lt).toBe(isoCutoff('1h'));
    expect(report.floorViolations.map((v) => v.object)).toEqual(['app_work_queue']);
  });

  it('floors a TENANT-scoped override too — the same door one scope down', async () => {
    const { engine, finds } = captureEngine([QUEUE_LIKE], {
      findImpl: (object) => (object === 'sys_organization' ? [{ id: 'org_fast' }] : []),
    });
    const settings = fakeSettings(
      {},
      { org_fast: { retention_overrides: { app_work_queue: { maxAge: '1h' } } } },
    );
    const svc = service(engine, { getSettings: () => settings });
    svc.registerRetentionFloor('app_work_queue', floor());

    const report = await svc.sweep();

    // The tenant pass falls back to the window that DID pass the floor (7d),
    // so no tenant can shorten its way past another package's contract.
    // [#5194] The floored window is observable on the candidate read.
    const reaps = finds.filter((f) => f.object === 'app_work_queue');
    expect(reaps[0].where).toEqual({
      created_at: { $lt: isoCutoff('7d') },
      organization_id: 'org_fast',
      status: 'done',
    });
    expect(report.floorViolations).toHaveLength(1);
    expect(report.floorViolations[0]!.scope).toBe('tenant:org_fast');
  });

  it('a retention floor does not reject a ttl override (policies are separate windows)', async () => {
    const { engine, deletes } = captureEngine([
      { name: 'app_session', lifecycle: { class: 'transient', ttl: { field: 'expires_at', expireAfter: '7d' } } as any },
    ]);
    const settings = fakeSettings({ retention_overrides: { app_session: { expireAfter: '1h' } } });
    const svc = service(engine, { getSettings: () => settings });
    svc.registerRetentionFloor('app_session', floor()); // policy: 'retention'

    const report = await svc.sweep();

    expect(deletes[0].where).toEqual({ expires_at: { $lt: isoCutoff('1h') } });
    expect(report.floorViolations).toEqual([]);

    // The same floor declared for `ttl` DOES bite.
    const second = captureEngine([
      { name: 'app_session', lifecycle: { class: 'transient', ttl: { field: 'expires_at', expireAfter: '7d' } } as any },
    ]);
    const ttlSvc = service(second.engine, { getSettings: () => settings });
    ttlSvc.registerRetentionFloor('app_session', floor({ policy: 'ttl' }));
    const ttlReport = await ttlSvc.sweep();
    expect(second.deletes[0].where).toEqual({ expires_at: { $lt: isoCutoff('7d') } });
    expect(ttlReport.floorViolations[0]!.policy).toBe('ttl');
  });

  it('the strictest of several registered floors governs', async () => {
    const { engine, deletes } = captureEngine([QUEUE_LIKE]);
    const settings = fakeSettings({ retention_overrides: { app_work_queue: { maxAge: '2d' } } });
    const svc = service(engine, { getSettings: () => settings });
    svc.registerRetentionFloor('app_work_queue', floor()); // 24h — 2d clears it
    svc.registerRetentionFloor('app_work_queue', floor({
      minWindowMs: 3 * 86_400_000,
      declaredBy: 'com.example.slow-consumer',
    })); // 3d — 2d does not

    const report = await svc.sweep();

    expect(deletes[0].where.created_at.$lt).toBe(isoCutoff('7d'));
    expect(report.floorViolations[0]!.declaredBy).toBe('com.example.slow-consumer');
  });

  it('re-registering the same (object, policy, declaredBy) replaces rather than accumulates', async () => {
    const { engine, deletes } = captureEngine([QUEUE_LIKE]);
    const settings = fakeSettings({ retention_overrides: { app_work_queue: { maxAge: '2d' } } });
    const svc = service(engine, { getSettings: () => settings });
    svc.registerRetentionFloor('app_work_queue', floor({ minWindowMs: 3 * 86_400_000 }));
    // A reconstructed adapter re-registers with a lowered window; the stale
    // stricter floor must not linger and keep rejecting a now-legal override.
    svc.registerRetentionFloor('app_work_queue', floor({ minWindowMs: 3_600_000 }));

    const report = await svc.sweep();

    expect(deletes[0].where.created_at.$lt).toBe(isoCutoff('2d'));
    expect(report.floorViolations).toEqual([]);
  });

  it('reports a DECLARED window below the floor, and still enforces it', async () => {
    const error = vi.fn();
    const { engine, deletes } = captureEngine([
      { name: 'app_work_queue', lifecycle: { class: 'transient', retention: { maxAge: '6h' } } as any },
    ]);
    const svc = service(engine, { logger: { ...silentLogger(), error } });
    svc.registerRetentionFloor('app_work_queue', floor());

    const report = await svc.sweep();

    // Refusing to reap would trade a broken consumer contract for the
    // unbounded table #5179 closed — so the declaration still runs, loudly.
    expect(deletes[0].where.created_at.$lt).toBe(isoCutoff('6h'));
    expect(report.floorViolations).toEqual([{
      object: 'app_work_queue',
      policy: 'retention',
      scope: 'global',
      offendingMs: 6 * 3_600_000,
      floorMs: FLOOR_MS,
      declaredBy: 'com.example.consumer',
      appliedMs: 6 * 3_600_000,
    }]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]![0]).toContain('declared retention window');
  });

  it('logs a standing violation once, but reports it on every sweep', async () => {
    const error = vi.fn();
    const { engine } = captureEngine([QUEUE_LIKE]);
    const settings = fakeSettings({ retention_overrides: { app_work_queue: { maxAge: '1h' } } });
    const svc = service(engine, { getSettings: () => settings, logger: { ...silentLogger(), error } });
    svc.registerRetentionFloor('app_work_queue', floor());

    const first = await svc.sweep();
    const second = await svc.sweep();

    // Hourly repetition of an unchanged misconfiguration is what trains people
    // to skim `error` — the report stays complete regardless.
    expect(error).toHaveBeenCalledTimes(1);
    expect(first.floorViolations).toHaveLength(1);
    expect(second.floorViolations).toHaveLength(1);
  });

  it('falls back to warn when the logger has no error method', async () => {
    const warn = vi.fn();
    const { engine } = captureEngine([QUEUE_LIKE]);
    const settings = fakeSettings({ retention_overrides: { app_work_queue: { maxAge: '1h' } } });
    const svc = service(engine, {
      getSettings: () => settings,
      logger: { info: () => {}, warn, debug: () => {} },
    });
    svc.registerRetentionFloor('app_work_queue', floor());

    await svc.sweep();

    expect(warn.mock.calls.some((c) => String(c[0]).includes('REJECTED'))).toBe(true);
  });

  it('refuses a malformed floor at registration — an unactionable rejection helps nobody', () => {
    const { engine } = captureEngine([QUEUE_LIKE]);
    const svc = service(engine);
    expect(() => svc.registerRetentionFloor('app_work_queue', floor({ minWindowMs: 0 })))
      .toThrow(/positive finite minWindowMs/);
    expect(() => svc.registerRetentionFloor('app_work_queue', floor({ minWindowMs: Number.NaN })))
      .toThrow(/positive finite minWindowMs/);
    expect(() => svc.registerRetentionFloor('app_work_queue', floor({ policy: 'forever' as any })))
      .toThrow(/policy 'retention' or 'ttl'/);
    expect(() => svc.registerRetentionFloor('app_work_queue', floor({ consequence: '' })))
      .toThrow(/declaredBy, consequence and remedy/);
    expect(() => svc.registerRetentionFloor('app_work_queue', floor({ remedy: '' })))
      .toThrow(/declaredBy, consequence and remedy/);
    expect(() => svc.registerRetentionFloor('', floor())).toThrow(/requires an object name/);
  });

  it('an unparseable override still keeps the declared window and is not a floor violation', async () => {
    const { engine, deletes } = captureEngine([QUEUE_LIKE]);
    const settings = fakeSettings({ retention_overrides: { app_work_queue: { maxAge: 'forever' } } });
    const svc = service(engine, { getSettings: () => settings });
    svc.registerRetentionFloor('app_work_queue', floor());

    const report = await svc.sweep();

    expect(deletes[0].where.created_at.$lt).toBe(isoCutoff('7d'));
    expect(report.floorViolations).toEqual([]);
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

/**
 * [#4551] The read-only referential-integrity audit rides this sweep's clock.
 *
 * It is here — rather than on a clock of its own — so an operator does not have
 * to know the finding exists in order to go looking for it (the same argument
 * that put #4469's stranded-request inspection on the approvals SLA clock).
 * Its subject is unrelated to retention; a clock is scheduling, not scope.
 */
describe('LifecycleService reference audit leg (#4551)', () => {
  it('runs the audit on every sweep and carries the finding in the report', async () => {
    const { engine } = captureEngine([]);
    const finding = {
      scanned: 2,
      dangling: [{
        objectName: 'sys_position_permission_set', recordId: 'ppr_1',
        field: 'permission_set_id', target: 'sys_permission_set', value: 'ps_gone',
      }],
      undetermined: 0, unreadableObjects: [], truncatedObjects: [],
    };
    engine.inspectDanglingReferences = async () => finding;

    const report = await service(engine).sweep();
    expect(report.danglingReferences).toEqual(finding);
  });

  it('an engine without the audit reports NOTHING rather than an empty finding', async () => {
    // Absence of a report is honest ("nobody looked"); a zeroed report would
    // read as "looked and found nothing", which is the misreading #4551 is
    // specifically trying to prevent.
    const { engine } = captureEngine([]);
    const report = await service(engine).sweep();
    expect('danglingReferences' in report).toBe(false);
  });

  it('an audit that throws never costs the sweep its reaping', async () => {
    const { engine, deletes } = captureEngine([
      { name: 'sys_job_run', lifecycle: { class: 'telemetry', retention: { maxAge: '30d' } } },
    ]);
    engine.inspectDanglingReferences = async () => { throw new Error('probe store down'); };

    const report = await service(engine).sweep();
    expect(deletes).toHaveLength(1);
    // …and a failed AUDIT is not a failed POLICY: `errors` means "a lifecycle
    // policy did not get applied", which is not what happened here.
    expect(report.errors).toEqual([]);
    expect(report.danglingReferences).toBeUndefined();
  });

  it('`referenceAudit.enabled: false` drops the leg and leaves lifecycle alone', async () => {
    const { engine, deletes } = captureEngine([
      { name: 'sys_job_run', lifecycle: { class: 'telemetry', retention: { maxAge: '30d' } } },
    ]);
    let called = 0;
    engine.inspectDanglingReferences = async () => {
      called += 1;
      return { scanned: 0, dangling: [], undetermined: 0, unreadableObjects: [], truncatedObjects: [] };
    };

    const report = await service(engine, { referenceAudit: { enabled: false } }).sweep();
    expect(called).toBe(0);
    expect(report.danglingReferences).toBeUndefined();
    expect(deletes).toHaveLength(1);
  });

  it('forwards the audit budget and never leaks `enabled` into it', async () => {
    const { engine } = captureEngine([]);
    let seen: unknown;
    engine.inspectDanglingReferences = async (opts: unknown) => {
      seen = opts;
      return { scanned: 0, dangling: [], undetermined: 0, unreadableObjects: [], truncatedObjects: [] };
    };

    const svc = service(engine, { referenceAudit: { enabled: true, rowsPerObject: 7, maxRows: 21 } });
    await svc.sweep();
    // …and it hands the audit the teardown bit (#4747) — the audit's lifetime
    // is this service's lifetime, so `signal` is the service's own, never a
    // configured one.
    expect(seen).toEqual({ rowsPerObject: 7, maxRows: 21, signal: { aborted: false } });
  });
});

/**
 * [#4747] The sweep must not outlive the engine it sweeps through.
 *
 * `stop()` used to clear the timers and nothing else — which was moot anyway,
 * because the only caller was `ObjectQLPlugin.stop()`, a hook the kernel never
 * invokes (the Plugin contract is `init`/`start`/`destroy`). So on a one-shot
 * host the sweep woke 60s after boot, inside a process whose datasource had
 * already been disconnected, and the #4551 audit filed the objects it could not
 * read as findings — on every healthy run.
 *
 * Note what is NOT the fix here: switching the audit off for one-shot commands.
 * That would make the audit permanently blind exactly where an operator has no
 * other tool, which is the opposite of why #4551 built it. What the audit gets
 * is the teardown bit, so it reads while the engine is live and stops when it
 * is not.
 */
describe('LifecycleService teardown (#4747)', () => {
  const AUDIT_CLEAN = {
    scanned: 0, dangling: [], undetermined: 0,
    unreadableObjects: [], truncatedObjects: [], aborted: false,
  };

  it('a sweep that starts after stop() reads nothing at all', async () => {
    const { engine, deletes } = captureEngine([
      { name: 'sys_job_run', lifecycle: { class: 'telemetry', retention: { maxAge: '30d' } } },
    ]);
    let audits = 0;
    engine.inspectDanglingReferences = async () => { audits += 1; return AUDIT_CLEAN; };

    const svc = service(engine);
    svc.stop();
    const report = await svc.sweep();

    expect(svc.stopped).toBe(true);
    expect(audits).toBe(0);         // no read → no `ERROR Find operation failed`
    expect(deletes).toEqual([]);    // and no write against a closing pool either
    expect(report.swept).toEqual([]);
    expect(report.danglingReferences).toBeUndefined();
  });

  it('stop() DURING a sweep calls the audit off instead of racing it', async () => {
    // The real shape of the bug: the sweep is async, so clearing a timer says
    // nothing about the work already in flight. The audit is handed the bit,
    // and by the time it runs it can see that teardown began.
    const { engine } = captureEngine([
      { name: 'sys_job_run', lifecycle: { class: 'telemetry', retention: { maxAge: '30d' } } },
    ]);
    let seenSignal: { aborted: boolean } | undefined;
    engine.inspectDanglingReferences = async (opts: any) => {
      seenSignal = opts?.signal;
      return AUDIT_CLEAN;
    };
    const svc = service(engine);
    // Teardown lands while the reaping leg is running.
    const original = engine.delete.bind(engine);
    engine.delete = async (object: string, options: any) => {
      svc.stop();
      return original(object, options);
    };

    const report = await svc.sweep();

    // The audit leg is not entered at all once the service is stopped …
    expect(seenSignal).toBeUndefined();
    expect(report.danglingReferences).toBeUndefined();
    // … and the sweep unwinds rather than issuing more work.
    expect(svc.stopped).toBe(true);
  });

  it('an audit already running sees the abort through the signal it was given', async () => {
    // Belt to the timing braces: even if a sweep gets into the audit leg before
    // stop() lands, the object it is holding flips to aborted, so the audit
    // stops reading and its report says it did not finish.
    const { engine } = captureEngine([]);
    const svc = service(engine);
    let signalDuringAudit: { aborted: boolean } | undefined;
    engine.inspectDanglingReferences = async (opts: any) => {
      signalDuringAudit = opts.signal;
      expect(opts.signal.aborted).toBe(false);
      svc.stop();                               // teardown mid-audit
      return { ...AUDIT_CLEAN, aborted: opts.signal.aborted };
    };

    const report = await svc.sweep();

    expect(signalDuringAudit!.aborted).toBe(true);
    expect(report.danglingReferences?.aborted).toBe(true);
  });

  it('stop() mid-reap ends the paging loop instead of running out the page budget', async () => {
    // [#5194] `sweep()` checks the abort bit between OBJECTS. That used to be
    // the whole story for an unguarded reap, which was a single `await` between
    // two such checks; it is now up to 20 pages of reads and deletes, so the
    // loop has to check too — otherwise teardown keeps pushing writes at a
    // datasource the host is closing, which is the #4747 defect itself.
    const store = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < 5000; i++) store.set(`r${i}`, { id: `r${i}`, created_at: '2020-01-01T00:00:00Z' });
    const { engine, deletes } = captureEngine(
      [{ name: 'sys_job_run', lifecycle: { class: 'telemetry', retention: { maxAge: '30d' } } }],
      {
        findImpl: (_object, options) => {
          const limit = (options?.limit as number) ?? store.size;
          const page: Array<Record<string, unknown>> = [];
          for (const row of store.values()) {
            if (page.length >= limit) break;
            page.push(row);
          }
          return page;
        },
        deleteImpl: (_object, options) => {
          const id = options?.where?.id as string | undefined;
          if (id !== undefined) store.delete(id);
          return { deletedCount: 1 };
        },
      },
    );
    const svc = service(engine);
    // Teardown lands while the first page is being deleted.
    const original = engine.delete.bind(engine);
    engine.delete = async (object: string, options: unknown) => {
      svc.stop();
      return original(object, options);
    };

    await svc.sweep();

    // The page in flight finishes (it is already confirmed work), and the loop
    // stops there rather than reading and deleting 19 more pages.
    expect(deletes).toHaveLength(500);
    expect(store.size).toBe(4500);
    expect(svc.stopped).toBe(true);
  });

  /**
   * [#5755] The Archiver's batch loop is the reap loop's twin: same 20-page
   * budget, same "teardown lands mid-loop" exposure — except every page costs
   * a read AND up to 500 writes on a SECOND datasource. These two tests pin the
   * loop's two ends: the budget it runs when nothing calls it off, and the stop
   * it makes when something does.
   */
  const ARCHIVED_OBJ: LifecycleObjectLike = {
    name: 'sys_audit_log',
    lifecycle: {
      class: 'audit',
      retention: { maxAge: '90d' },
      // No `keep`: the cold-side prune is a single call AFTER the loop, so
      // declaring it here would assert a leg these tests do not govern.
      archive: { after: '90d', to: 'archive' },
    } as any,
  };

  /**
   * A counting hot/cold pair. Every leg the archive loop can issue — the page
   * read, the per-row copy, the hot delete — is recorded, so "the loop stopped"
   * is observable per leg instead of inferred from a row count.
   */
  function archivePair(rowCount: number, onCopy?: (copied: number) => void) {
    let remaining: Array<Record<string, unknown>> = [];
    for (let i = 0; i < rowCount; i++) {
      remaining.push({ id: `r${i}`, created_at: '2020-01-01T00:00:00.000Z' });
    }
    const pageReads: number[] = [];
    const copied: string[] = [];
    const hotDeleted: Array<Array<string | number>> = [];
    // [#5966] The cold-side `keep` prune is the loop's successor leg, so it is
    // recorded the same way the loop's legs are — with the predicate it sent,
    // not just a count, so "the prune ran" and "the prune ran on the right
    // cutoff" are separable assertions.
    const coldPruned: Array<Record<string, unknown> | undefined> = [];
    return {
      pageReads,
      copied,
      hotDeleted,
      coldPruned,
      remaining: () => remaining,
      hot: {
        name: 'default',
        find: async (_object: string, query: any) => {
          const limit = (query?.limit as number) ?? remaining.length;
          pageReads.push(limit);
          return remaining.slice(0, limit);
        },
        upsert: async () => ({}),
        bulkDelete: async (_object: string, ids: Array<string | number>) => {
          hotDeleted.push(ids);
          const gone = new Set(ids);
          remaining = remaining.filter((r) => !gone.has(r.id as string));
        },
        deleteMany: async () => 0,
      },
      cold: {
        name: 'archive',
        find: async () => [],
        upsert: async (_object: string, row: Record<string, unknown>) => {
          copied.push(row.id as string);
          onCopy?.(copied.length);
          return row;
        },
        bulkDelete: async () => {},
        deleteMany: async (_object: string, query?: Record<string, unknown>) => {
          coldPruned.push(query);
          return 0;
        },
      },
    };
  }

  it('an archive nobody calls off runs its whole 20-batch budget', async () => {
    // The control for the test below: with the abort bit down, the loop is
    // bounded only by ARCHIVE_MAX_BATCHES_PER_SWEEP (20 × 500), and the rest of
    // the backlog waits for the next sweep.
    const pair = archivePair(10_500);
    const { engine } = captureEngine([ARCHIVED_OBJ], {
      driver: pair.hot,
      datasources: { archive: pair.cold },
    });

    const report = await service(engine).sweep();

    expect(pair.pageReads).toHaveLength(20);
    expect(pair.copied).toHaveLength(10_000);
    expect(pair.hotDeleted).toHaveLength(20);
    expect(pair.remaining()).toHaveLength(500);
    expect(report.swept.find((e) => e.policy === 'archive')?.archived).toBe(10_000);
  });

  it('stop() mid-archive ends the batch loop instead of running out the page budget', async () => {
    // The #4747 shape on the archive side: teardown lands while batch 2 is
    // copying, so batches 3…20 must issue nothing at all — no hot read, no cold
    // copy, no hot delete — at two datasources the host is closing.
    let svc!: LifecycleService;
    const pair = archivePair(10_500, (copied) => {
      if (copied === 501) svc.stop(); // first row of batch 2
    });
    const { engine } = captureEngine([ARCHIVED_OBJ], {
      driver: pair.hot,
      datasources: { archive: pair.cold },
    });
    svc = service(engine);

    const report = await svc.sweep();

    expect(svc.stopped).toBe(true);
    // Two pages read, not 20 — the loop stopped at the boundary after the batch
    // that was in flight, and never asked the hot store for page 3.
    expect(pair.pageReads).toHaveLength(2);
    expect(pair.copied).toHaveLength(1000);
    // The safety rule survives the interruption: the batch in flight completed
    // its pair, so every id the cold store took was hot-deleted and no id was
    // hot-deleted that the cold store had not taken — no half batch either way.
    expect(pair.hotDeleted.map((ids) => ids.length)).toEqual([500, 500]);
    expect(pair.hotDeleted.flat()).toEqual(pair.copied);
    // …and the batches never begun are still hot, for the next sweep to move.
    expect(pair.remaining()).toHaveLength(9500);
    expect(report.swept.find((e) => e.policy === 'archive')?.archived).toBe(1000);
  });

  /**
   * [#5966] The leg AFTER the loop. #5755 stopped the batch loop; the cold-side
   * `keep` prune sits past its exit and had no check of its own, so teardown
   * landing anywhere inside `archiveObject` still ended with one predicate
   * DELETE at the cold datasource.
   *
   * The distinction that makes this worth pinning separately: by the time the
   * prune is reached, the abort bit has already been READ — either the loop
   * broke on it, or a leg the loop issued raised it. Continuing is a decision
   * the code makes with the answer in hand, not an await that merely straddled
   * teardown. The three tests below cover the prune's two ends and both ways
   * the loop can hand control to it.
   */
  const KEEP_OBJ: LifecycleObjectLike = {
    name: 'sys_audit_log',
    lifecycle: {
      class: 'audit',
      retention: { maxAge: '90d' },
      // The delta from ARCHIVED_OBJ is `keep`, and only `keep`: the prune leg
      // does not run at all without it, which is why #5755's fixture omitted it.
      archive: { after: '90d', to: 'archive', keep: '365d' },
    } as any,
  };

  it('a `keep` prune nobody calls off runs, on the cutoff `keep` declares', async () => {
    // The control: with the abort bit down the prune is ordinary work, and the
    // guard must not cost it. 700 rows drain inside the budget, so the loop
    // exits on its short page — not on abort — and the prune follows it.
    const pair = archivePair(700);
    const { engine } = captureEngine([KEEP_OBJ], {
      driver: pair.hot,
      datasources: { archive: pair.cold },
    });

    const report = await service(engine).sweep();

    expect(pair.pageReads).toHaveLength(2);
    expect(pair.copied).toHaveLength(700);
    expect(pair.remaining()).toHaveLength(0);
    // Exactly one prune, carrying the `keep` cutoff (not `after`'s).
    expect(pair.coldPruned).toEqual([{ where: { created_at: { $lt: isoCutoff('365d') } } }]);
    expect(report.swept.find((e) => e.policy === 'archive')?.archived).toBe(700);
  });

  it('stop() mid-archive stops the prune too, not just the batch loop', async () => {
    // Teardown lands while batch 2 copies, so the loop breaks at its head after
    // READING `aborted === true` — and the very next statement used to send a
    // predicate DELETE to the cold store the host is closing.
    let svc!: LifecycleService;
    const pair = archivePair(10_500, (copied) => {
      if (copied === 501) svc.stop(); // first row of batch 2
    });
    const { engine } = captureEngine([KEEP_OBJ], {
      driver: pair.hot,
      datasources: { archive: pair.cold },
    });
    svc = service(engine);

    const report = await svc.sweep();

    expect(svc.stopped).toBe(true);
    expect(pair.pageReads).toHaveLength(2); // #5755's guard, still holding
    expect(pair.copied).toHaveLength(1000);
    // The leg this test exists for: nothing at all is sent to the cold store
    // after the loop reads the bit.
    expect(pair.coldPruned).toEqual([]);
    // Deferral, not loss: the rows the prune would have taken are still cold,
    // and the archiving that DID complete is still reported.
    expect(pair.remaining()).toHaveLength(9500);
    expect(report.swept.find((e) => e.policy === 'archive')?.archived).toBe(1000);
  });

  it('stop() after the loop has made its last check still calls the prune off', async () => {
    // The other way in, and the one the per-batch check cannot see: the backlog
    // drains inside the budget, so the loop exits on `rows.length <
    // ARCHIVE_BATCH_SIZE` and never re-reads the abort bit. Teardown lands in
    // the final hot delete — after the loop's last check, before the prune —
    // which is precisely the window #5755 left open.
    let svc!: LifecycleService;
    const pair = archivePair(700);
    const hotBulkDelete = pair.hot.bulkDelete;
    pair.hot.bulkDelete = async (object: string, ids: Array<string | number>) => {
      await hotBulkDelete(object, ids);
      if (pair.remaining().length === 0) svc.stop(); // the last batch just landed
    };
    const { engine } = captureEngine([KEEP_OBJ], {
      driver: pair.hot,
      datasources: { archive: pair.cold },
    });
    svc = service(engine);

    const report = await svc.sweep();

    expect(svc.stopped).toBe(true);
    // The archive itself completed — every row copied and hot-deleted in pairs.
    expect(pair.pageReads).toHaveLength(2);
    expect(pair.hotDeleted.map((ids) => ids.length)).toEqual([500, 200]);
    expect(pair.hotDeleted.flat()).toEqual(pair.copied);
    expect(report.swept.find((e) => e.policy === 'archive')?.archived).toBe(700);
    // …and the prune, the one leg still owed, is left for the next sweep.
    expect(pair.coldPruned).toEqual([]);
  });

  /**
   * [#6412] The two legs left over after #5966. Both are the same shape as the
   * cold prune above — control flow that has ALREADY read `aborted === true`
   * and issues a destructive operation anyway — but they sit at two different
   * scopes, so each gets its own fixture and its own control:
   *
   *  - the space reclaim, AFTER `sweep()`'s object loop (VACUUM-class);
   *  - the shard rotation, inside `reapObject` after the ttl reap (DROPs
   *    expired physical shards).
   */

  /** A hot store a reap can page through, with the by-id delete it issues. */
  function reapStore(rowCount: number) {
    const store = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < rowCount; i++) {
      store.set(`r${i}`, {
        id: `r${i}`,
        created_at: '2020-01-01T00:00:00.000Z',
        expires_at: '2020-01-01T00:00:00.000Z',
      });
    }
    return {
      store,
      findImpl: (_object: string, options: any) => {
        const limit = (options?.limit as number) ?? store.size;
        const page: Array<Record<string, unknown>> = [];
        for (const row of store.values()) {
          if (page.length >= limit) break;
          page.push(row);
        }
        return page;
      },
      deleteImpl: (_object: string, options: any) => {
        const id = options?.where?.id as string | undefined;
        if (id !== undefined) store.delete(id);
        return { deletedCount: 1 };
      },
    };
  }

  const REAPED_OBJ: LifecycleObjectLike = {
    name: 'sys_job_run',
    lifecycle: { class: 'telemetry', retention: { maxAge: '30d' } } as any,
  };

  it('a space reclaim nobody calls off runs, once per drained datasource', async () => {
    // The control: with the abort bit down the reclaim is ordinary work, and the
    // guard must not cost it. 700 rows drain in two pages, the reap reports rows
    // deleted, and the datasource is vacuumed exactly once.
    const hot = reapStore(700);
    const reclaimSpace = vi.fn(async () => {});
    const { engine, deletes } = captureEngine([REAPED_OBJ], {
      driver: { name: 'default', reclaimSpace },
      findImpl: hot.findImpl,
      deleteImpl: hot.deleteImpl,
    });

    const report = await service(engine).sweep();

    expect(deletes).toHaveLength(700); // by-id, two pages
    expect(hot.store.size).toBe(0);
    expect(reclaimSpace).toHaveBeenCalledTimes(1);
    expect(report.reclaimed).toEqual(['default']);
  });

  it("stop() inside the LAST object's reap calls the space reclaim off too", async () => {
    // The window the per-object check cannot see. `sweep()` reads the abort bit
    // at the TOP of the object loop, so teardown landing in the LAST declared
    // object's reap never meets that check again: `batchedReap` breaks BECAUSE
    // it read `aborted === true`, the object loop then ends normally rather than
    // through the check, and the very next statement used to send a VACUUM to
    // the datasource the host is closing. Probe evidence on #6412:
    // `reclaims === ['vacuum']`.
    const hot = reapStore(5_000);
    const reclaimSpace = vi.fn(async () => {});
    const { engine, deletes } = captureEngine([REAPED_OBJ], {
      driver: { name: 'default', reclaimSpace },
      findImpl: hot.findImpl,
      deleteImpl: hot.deleteImpl,
    });
    const svc = service(engine);
    // Teardown lands while the first page is being deleted.
    const original = engine.delete.bind(engine);
    engine.delete = async (object: string, options: unknown) => {
      svc.stop();
      return original(object, options);
    };

    const report = await svc.sweep();

    expect(svc.stopped).toBe(true);
    // #5194's guard, still holding: the page in flight finishes, page 2 is never
    // read — and the reap still reports rows deleted, so the driver IS a reclaim
    // candidate. The bit, not the candidacy, is what calls the VACUUM off.
    expect(deletes).toHaveLength(500);
    expect(hot.store.size).toBe(4_500);
    // The leg this test exists for.
    expect(reclaimSpace).not.toHaveBeenCalled();
    // Deferral, not loss: the pages the reap freed are returned by the next
    // sweep, which re-derives the same reclaim set from the same deletes.
    expect(report.reclaimed).toEqual([]);
  });

  const TTL_ROTATED_OBJ: LifecycleObjectLike = {
    name: 'sys_activity',
    lifecycle: {
      class: 'telemetry',
      // The delta that makes the rotation leg reachable with the bit already
      // read: `ttl` puts a paging reap — the thing that reads the bit and breaks
      // — in front of the rotation, inside one `reapObject` call.
      ttl: { field: 'expires_at', expireAfter: '7d' },
      storage: { strategy: 'rotation', shards: 14, unit: 'day' },
    } as any,
  };

  const rotation = () => ({
    object: 'sys_activity',
    current: 'sys_activity__r20260710',
    shards: ['sys_activity__r20260710'],
    dropped: ['sys_activity__r20260626'],
  });

  it('a shard rotation nobody calls off drops its expired shards', async () => {
    // The control for the test below: bit down, ttl reap and rotation both run.
    const hot = reapStore(700);
    const rotateShards = vi.fn(async () => rotation());
    const { engine, deletes } = captureEngine([TTL_ROTATED_OBJ], {
      driver: { name: 'default', supportsRotation: true, rotateShards },
      findImpl: hot.findImpl,
      deleteImpl: hot.deleteImpl,
    });

    const report = await service(engine).sweep();

    expect(deletes).toHaveLength(700); // the ttl reap drained the store
    expect(rotateShards).toHaveBeenCalledWith(TTL_ROTATED_OBJ, FIXED_NOW);
    expect(report.swept.map((e) => e.policy)).toEqual(['ttl', 'rotation']);
    expect(report.swept.find((e) => e.policy === 'rotation')?.droppedShards).toBe(1);
  });

  it('stop() inside the ttl reap calls the shard rotation off', async () => {
    // ttl + rotation on ONE object: the reap runs first and `batchedReap` breaks
    // because it READ `aborted === true`, then returns straight into a rotation
    // guarded only by strategy and driver capability. The DROP of expired
    // physical shards is the most destructive operation this service issues, and
    // it went to a datasource the host is closing. Probe evidence on #6412:
    // `drops === ['DROP shard']`.
    const hot = reapStore(5_000);
    const rotateShards = vi.fn(async () => rotation());
    const { engine, deletes } = captureEngine([TTL_ROTATED_OBJ], {
      driver: { name: 'default', supportsRotation: true, rotateShards },
      findImpl: hot.findImpl,
      deleteImpl: hot.deleteImpl,
    });
    const svc = service(engine);
    const original = engine.delete.bind(engine);
    engine.delete = async (object: string, options: unknown) => {
      svc.stop(); // teardown lands in the ttl reap's first page
      return original(object, options);
    };

    const report = await svc.sweep();

    expect(svc.stopped).toBe(true);
    expect(deletes).toHaveLength(500); // the reap stopped at its own boundary …
    // … and no shard was dropped after it had read the bit.
    expect(rotateShards).not.toHaveBeenCalled();
    expect(report.swept.map((e) => e.policy)).toEqual(['ttl']);
    // Suppressing the rotation must not divert the object into the age-based
    // fallback reap — that branch is `!lc.ttl`-gated, so it stays shut.
    expect(hot.store.size).toBe(4_500);
  });

  const ROTATED_ONLY_OBJ: LifecycleObjectLike = {
    name: 'sys_activity',
    lifecycle: {
      class: 'telemetry',
      storage: { strategy: 'rotation', shards: 14, unit: 'day' },
    } as any,
  };

  it('rotation without `ttl` is unchanged — nothing has read the bit before the DROP', async () => {
    // The form #6412's triage graded benign, pinned so the guard above cannot
    // silently take it as well. Without `ttl` (and without `archive`, which
    // returns earlier) nothing in `reapObject` awaits before the rotation, so
    // the bit is structurally false there — not merely unobserved. Teardown
    // landing INSIDE the rotation is as close as this form gets, and the
    // rotation must still complete and report exactly as it always did.
    let svc!: LifecycleService;
    const rotateShards = vi.fn(async () => {
      svc.stop(); // mid-DROP: after dispatch, so no decision was made with it
      return rotation();
    });
    const { engine, deletes } = captureEngine([ROTATED_ONLY_OBJ], {
      driver: { name: 'default', supportsRotation: true, rotateShards },
    });
    svc = service(engine);

    const report = await svc.sweep();

    expect(rotateShards).toHaveBeenCalledTimes(1);
    // No fallback age reap took the rotation's place …
    expect(deletes).toEqual([]);
    // … and the entry is identical to the one the unaborted form reports.
    expect(report.swept).toEqual([
      {
        object: 'sys_activity',
        class: 'telemetry',
        policy: 'rotation',
        cutoff: isoCutoff('14d'),
        droppedShards: 1,
      },
    ]);
  });

  it('stop() then start() re-arms the service — teardown is not one-way', async () => {
    const { engine } = captureEngine([]);
    let audits = 0;
    engine.inspectDanglingReferences = async () => { audits += 1; return AUDIT_CLEAN; };

    // A far-off first sweep: this test drives `sweep()` directly, and an armed
    // 1ms timer would race its own assertion.
    const svc = service(engine, { initialDelayMs: 600_000 });
    svc.stop();
    expect(svc.stopped).toBe(true);
    svc.start();
    expect(svc.stopped).toBe(false);

    await svc.sweep();
    expect(audits).toBe(1);
    svc.stop();
  });
});
