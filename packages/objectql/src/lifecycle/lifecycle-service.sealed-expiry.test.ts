// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import {
  LifecycleService,
  type LifecycleObjectLike,
  type LifecycleSealedExpiry,
  type LifecycleSealedExpiryRequest,
  type LifecycleSealedExpiryRun,
} from './lifecycle-service.js';
import { parseLifecycleDuration } from './duration.js';

/**
 * [ADR-0154 D8] A sealed object (`lifecycle.seal`) never loses rows to a row
 * cutoff: the sweep hands each policy to the registered sealed expiry, which
 * plans whole checkpoints and signs their expiry amendment first, and deletes
 * exactly the rows each run names, completing a run only once every one is
 * gone. With no expiry registered the rows are kept, and that is said once.
 */

const FIXED_NOW = 1_700_000_000_000;
const isoCutoff = (literal: string) => new Date(FIXED_NOW - parseLifecycleDuration(literal)).toISOString();

function recordingLogger() {
  const warns: string[] = [];
  return { warns, logger: { info: () => {}, debug: () => {}, warn: (m: string) => void warns.push(m), error: () => {} } };
}

const SEAL = { valueFields: ['new_value'] };

const ARCHIVING: LifecycleObjectLike = {
  name: 'sys_audit_log',
  lifecycle: { class: 'audit', retention: { maxAge: '90d' }, archive: { after: '90d', to: 'archive', keep: '7y' }, seal: SEAL } as any,
};
const RETAINED: LifecycleObjectLike = {
  name: 'app_ledger',
  lifecycle: { class: 'audit', retention: { maxAge: '30d' }, seal: SEAL } as any,
};
const TTL: LifecycleObjectLike = {
  name: 'app_receipt',
  lifecycle: { class: 'audit', ttl: { field: 'created_at', expireAfter: '7d' }, seal: SEAL } as any,
};

/** A store that remembers what each call did. */
function store(name: string, rows: Array<Record<string, unknown>> = []) {
  let remaining = [...rows];
  const bulkDeleted: string[][] = [];
  const deleteMany = vi.fn(async () => 0);
  return {
    bulkDeleted,
    deleteMany,
    remaining: () => remaining.map((r) => r.id),
    driver: {
      name,
      syncSchema: vi.fn(async () => {}),
      find: async (_o: string, q: any) => remaining.slice(0, q?.limit ?? remaining.length),
      upsert: async (_o: string, row: Record<string, unknown>) => row,
      bulkDelete: async (_o: string, ids: string[]) => {
        bulkDeleted.push([...ids]);
        remaining = remaining.filter((r) => !ids.includes(r.id as string));
      },
      deleteMany,
    },
  };
}

function engineOver(objects: LifecycleObjectLike[], opts: { hot?: ReturnType<typeof store>; cold?: ReturnType<typeof store>; rows?: Array<Record<string, unknown>> } = {}) {
  const deletes: any[] = [];
  const finds: any[] = [];
  let rows = [...(opts.rows ?? [])];
  const engine: any = {
    registry: { getAllObjects: () => objects },
    getDriverForObject: () => opts.hot?.driver,
    datasource(name: string) {
      if (name === 'archive' && opts.cold) return opts.cold.driver;
      throw new Error(`[ObjectQL] Datasource '${name}' not found`);
    },
    async find(object: string, q: any) {
      finds.push({ object, where: q?.where });
      const ids: string[] = q?.where?.id?.$in ?? [];
      return rows.filter((r) => ids.includes(r.id as string));
    },
    async delete(object: string, q: any) {
      deletes.push({ object, where: q?.where, context: q?.context });
      rows = rows.filter((r) => r.id !== q?.where?.id);
      return { deletedCount: 1 };
    },
  };
  return { engine, deletes, finds, rowsLeft: () => rows.map((r) => r.id) };
}

function service(engine: any, logger = recordingLogger().logger) {
  return new LifecycleService({ getEngine: () => engine, logger, now: () => FIXED_NOW, initialDelayMs: 1, sweepIntervalMs: 10 });
}

function expiryOf(runs: Array<{ chain: string; rowIds: string[] }>) {
  const completed: string[] = [];
  const requests: LifecycleSealedExpiryRequest[] = [];
  const expiry: LifecycleSealedExpiry = {
    plan: vi.fn(async (request: LifecycleSealedExpiryRequest): Promise<LifecycleSealedExpiryRun[]> => {
      requests.push(request);
      return runs.map((r) => ({ ...r, complete: async () => void completed.push(r.chain) }));
    }),
  };
  return { expiry, completed, requests };
}

describe('LifecycleService — a sealed object expires only through the sealed expiry (ADR-0154 D8)', () => {
  it('with no sealed expiry registered, archives as before but keeps the archive past `keep`, and says so once', async () => {
    const hot = store('default', [{ id: 'a', created_at: '2020-01-01T00:00:00.000Z' }]);
    const cold = store('archive');
    const { engine } = engineOver([ARCHIVING], { hot, cold });
    const { warns, logger } = recordingLogger();
    const svc = service(engine, logger);

    const first = await svc.sweep();
    const second = await svc.sweep();

    // The hot→cold hand-off is not a deletion of a sealed row: the archive still holds it.
    expect(hot.bulkDeleted).toEqual([['a']]);
    expect(cold.deleteMany).not.toHaveBeenCalled();
    expect(first.skipped).toContainEqual({ object: 'sys_audit_log', reason: 'seal-expiry-pending' });
    expect(second.skipped).toContainEqual({ object: 'sys_audit_log', reason: 'seal-expiry-pending' });
    expect(first.swept.some((e) => e.policy === 'expiry')).toBe(false);
    expect(warns.filter((w) => /sys_audit_log declares lifecycle\.seal, but no sealed-object expiry is registered/.test(w))).toHaveLength(1);
    expect(warns.join('\n')).toMatch(/rows past archive\.keep 7y are KEPT/);
  });

  it('an archiving sealed object: plans `archive.keep` at its cutoff, deletes each run by id on both stores, then completes it', async () => {
    const hot = store('default', [{ id: 'x', created_at: '2026-01-01T00:00:00.000Z' }]);
    const cold = store('archive', [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }, { id: 'kept' }]);
    const { engine } = engineOver([ARCHIVING], { hot, cold });
    const svc = service(engine);
    const { expiry, completed, requests } = expiryOf([
      { chain: 'org:a', rowIds: ['e1', 'e2'] },
      { chain: 'org:b', rowIds: ['e3'] },
    ]);
    svc.registerSealedExpiry(expiry);

    const report = await svc.sweep();

    expect(requests).toEqual([{ object: 'sys_audit_log', policy: 'archive.keep', policyValue: '7y', cutoff: isoCutoff('7y') }]);
    expect(cold.remaining()).toEqual(['kept']);
    expect(cold.bulkDeleted).toEqual([['e1', 'e2'], ['e3']]);
    // The hot store is asked too: a sealed row may sit on either side of the hand-off.
    expect(hot.bulkDeleted).toContainEqual(['e1', 'e2']);
    expect(completed).toEqual(['org:a', 'org:b']);
    expect(cold.deleteMany).not.toHaveBeenCalled(); // never the row-cutoff prune
    expect(report.swept).toContainEqual({ object: 'sys_audit_log', class: 'audit', policy: 'expiry', cutoff: isoCutoff('7y'), deleted: 3 });
    expect(report.skipped).toEqual([]);
  });

  it('a retained sealed object: plans `retention.maxAge`, deletes each row through the engine, never by the cutoff', async () => {
    const { engine, deletes } = engineOver([RETAINED], { rows: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }] });
    const svc = service(engine);
    const { expiry, completed, requests } = expiryOf([{ chain: 'deployment', rowIds: ['r1', 'r2'] }]);
    svc.registerSealedExpiry(expiry);

    const report = await svc.sweep();

    expect(requests).toEqual([{ object: 'app_ledger', policy: 'retention.maxAge', policyValue: '30d', cutoff: isoCutoff('30d') }]);
    expect(deletes.map((d) => d.where)).toEqual([{ id: 'r1' }, { id: 'r2' }]);
    expect(deletes.every((d) => d.context?.isSystem === true)).toBe(true);
    expect(completed).toEqual(['deployment']);
    expect(report.swept).toEqual([{ object: 'app_ledger', class: 'audit', policy: 'expiry', cutoff: isoCutoff('30d'), deleted: 2 }]);
  });

  it('a ttl sealed object plans `ttl.expireAfter`', async () => {
    const { engine } = engineOver([TTL], { rows: [] });
    const svc = service(engine);
    const { expiry, requests } = expiryOf([]);
    svc.registerSealedExpiry(expiry);

    const report = await svc.sweep();

    expect(requests).toEqual([{ object: 'app_receipt', policy: 'ttl.expireAfter', policyValue: '7d', cutoff: isoCutoff('7d') }]);
    expect(report.swept).toEqual([{ object: 'app_receipt', class: 'audit', policy: 'expiry', cutoff: isoCutoff('7d'), deleted: 0 }]);
  });

  it('a run a reap guard vetoes in part is not completed: its rows that went stay gone, its checkpoints stay for the next sweep', async () => {
    const { engine, deletes } = engineOver([RETAINED], { rows: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }] });
    const svc = service(engine);
    svc.registerReapGuard('app_ledger', async (_o, rows) => rows.map((r) => r.id).filter((id) => id !== 'r2'));
    const { expiry, completed } = expiryOf([
      { chain: 'org:a', rowIds: ['r1', 'r2'] },
      { chain: 'org:b', rowIds: ['r3'] },
    ]);
    svc.registerSealedExpiry(expiry);

    const report = await svc.sweep();

    expect(deletes.map((d) => d.where)).toEqual([{ id: 'r1' }, { id: 'r3' }]);
    expect(completed).toEqual(['org:b']);
    expect(report.swept).toEqual([{ object: 'app_ledger', class: 'audit', policy: 'expiry', cutoff: isoCutoff('30d'), deleted: 1 }]);
  });

  it('a plan that fails deletes nothing and reports the object', async () => {
    const { engine, deletes } = engineOver([RETAINED], { rows: [{ id: 'r1' }] });
    const svc = service(engine);
    svc.registerSealedExpiry({ plan: async () => { throw new Error('no expiry amendment can be signed'); } });

    const report = await svc.sweep();

    expect(deletes).toEqual([]);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatchObject({ object: 'app_ledger' });
  });

  it('a later registration replaces the slot, and an earlier unregistration does not clear it', async () => {
    const { engine } = engineOver([RETAINED], { rows: [] });
    const svc = service(engine);
    const first = expiryOf([]);
    const second = expiryOf([]);
    const unregisterFirst = svc.registerSealedExpiry(first.expiry);
    const unregisterSecond = svc.registerSealedExpiry(second.expiry);
    unregisterFirst();

    await svc.sweep();
    expect(first.requests).toEqual([]);
    expect(second.requests).toHaveLength(1);

    unregisterSecond();
    const report = await svc.sweep();
    expect(second.requests).toHaveLength(1);
    expect(report.skipped).toContainEqual({ object: 'app_ledger', reason: 'seal-expiry-pending' });
  });

  it('refuses a registration with no plan method', () => {
    const svc = service(engineOver([]).engine);
    expect(() => svc.registerSealedExpiry({} as never)).toThrow(/requires an object with a plan\(request\) method/);
  });

  it('an object without `seal` keeps the row-cutoff path, and never asks the sealed expiry', async () => {
    const plain: LifecycleObjectLike = { name: 'app_log', lifecycle: { class: 'telemetry', retention: { maxAge: '30d' } } as any };
    const { engine, finds } = engineOver([plain], { rows: [] });
    const svc = service(engine);
    const { expiry, requests } = expiryOf([]);
    svc.registerSealedExpiry(expiry);

    const report = await svc.sweep();

    expect(requests).toEqual([]);
    expect(finds.map((f) => f.where)).toContainEqual({ created_at: { $lt: isoCutoff('30d') } });
    expect(report.swept.map((e) => e.policy)).toEqual(['retention']);
  });
});
