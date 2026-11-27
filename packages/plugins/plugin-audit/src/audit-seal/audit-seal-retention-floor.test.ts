// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { assertEngineDeleteDispatch, LifecycleService, parseLifecycleDuration, type LifecycleObjectLike } from '@objectstack/objectql';
import { describe, expect, it, vi } from 'vitest';
import { AuditPlugin } from '../audit-plugin.js';
import { AUDIT_SEAL_FLOOR_REGISTRAR, sealedWindowFloors } from './retention-floor.js';
import type { AuditExpiryRequest } from './expiry.js';
import type { AuditSealer } from './sealer.js';

/**
 * [ADR-0154 D8] On a sealed object, a retention override cannot shorten the
 * declared window: `AuditPlugin` registers a retention floor for every sealed
 * object at its declared window, so the window the sealed expiry is asked for
 * — the one its amendment signs — is never below the declaration, globally or
 * for one organization. A longer override still applies.
 */

const FIXED_NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const isoCutoff = (literal: string) => new Date(FIXED_NOW - parseLifecycleDuration(literal)).toISOString();
const SEAL = { valueFields: ['new_value'] };

const retained = (maxAge = '30d'): LifecycleObjectLike => ({
  name: 'app_ledger',
  lifecycle: { class: 'audit', retention: { maxAge }, seal: SEAL } as never,
});

/** A sweep over `objects` whose settings carry `global` and per-organization `tenants` retention overrides. */
function sweepRig(
  objects: LifecycleObjectLike[],
  global: Record<string, unknown> | undefined,
  tenants: Record<string, Record<string, unknown>> = {},
) {
  // The registry's owner reads, as `SchemaRegistry` answers them: an object with a `_packageId` is owned by that
  // package (installed from code when it is `app.ledger`), one with none is a plain registration from code.
  const ownerOf = (name: string) => objects.find((o) => o.name === name) as { _packageId?: string } | undefined;
  const engine = {
    registry: {
      getAllObjects: () => objects,
      getPackagedObjectOwner: (name: string) => {
        const o = ownerOf(name) as { _packageId?: string; _provenance?: string } | undefined;
        return o?._packageId && o._packageId !== 'sys_metadata' && o._provenance !== 'org' ? { packageId: o._packageId } : undefined;
      },
      getObjectOwner: (name: string) => (ownerOf(name) ? { packageId: ownerOf(name)!._packageId, definition: ownerOf(name) } : undefined),
      getPackage: (id: string) => (id === 'app.ledger' ? { source: 'code' } : undefined),
    },
    getDriverForObject: () => undefined,
    find: async (object: string) => (object === 'sys_organization' ? Object.keys(tenants).map((id) => ({ id })) : []),
    delete: async (_object: string, options: unknown) => {
      assertEngineDeleteDispatch(options as never);
      return { deletedCount: 0 };
    },
  };
  const settings = {
    async get(_ns: string, key: string, ctx?: Record<string, unknown>) {
      if (key !== 'retention_overrides') return { value: undefined, source: 'default' };
      const tenantId = ctx?.tenantId as string | undefined;
      if (tenantId && tenants[tenantId]) return { value: tenants[tenantId], source: 'tenant' };
      return global ? { value: global, source: 'global' } : { value: undefined, source: 'default' };
    },
  };
  const errors: string[] = [];
  const logger = { info() {}, debug() {}, warn() {}, error: (m: string) => void errors.push(m) };
  const lifecycle = new LifecycleService({
    getEngine: () => engine as never, logger, now: () => FIXED_NOW, initialDelayMs: 1, sweepIntervalMs: 10,
    getSettings: () => settings as never, referenceAudit: { enabled: false },
  } as never);
  const plugin = new AuditPlugin({ cryptoProvider: { label: 'host' } as never });
  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    getService: (name: string) => {
      if (name === 'lifecycle') return lifecycle;
      throw new Error(`no '${name}' service`);
    },
  };
  const start = async () => {
    (plugin as unknown as { startSealer(e: unknown, c: unknown): void }).startSealer(engine, ctx);
    const sealer = (plugin as unknown as { sealer: AuditSealer }).sealer;
    await sealer.stop(); // drive the passes here
    const requests: AuditExpiryRequest[] = [];
    vi.spyOn(sealer, 'expire').mockImplementation(async (request) => {
      requests.push(request);
      return [];
    });
    return { sealer, requests };
  };
  return { lifecycle, plugin, start, errors };
}

describe('AuditPlugin — on a sealed object, a retention override cannot shorten the declared window (ADR-0154 D8)', () => {
  it('an override below the declared window, global or for one organization, is rejected: the expiry is asked for the declared window', async () => {
    const rig = sweepRig([retained('30d')], { app_ledger: { maxAge: '1d' } }, {
      org_short: { app_ledger: { maxAge: '10d' } },
      org_long: { app_ledger: { maxAge: '400d' } },
    });
    const { requests } = await rig.start();

    const report = await rig.lifecycle.sweep();

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ object: 'app_ledger', policy: 'retention.maxAge', policyValue: '30d', cutoff: isoCutoff('30d') });
    expect([...(requests[0].tenants ?? [])].sort((a, b) => a.tenantId.localeCompare(b.tenantId))).toEqual([
      { tenantId: 'org_long', policyValue: '400d', cutoff: isoCutoff('400d') },
      { tenantId: 'org_short', policyValue: '30d', cutoff: isoCutoff('30d') },
    ]);
    expect(report.floorViolations.map((v) => [v.scope, v.override, v.appliedMs, v.declaredBy])).toEqual([
      ['global', '1d', 30 * DAY, AUDIT_SEAL_FLOOR_REGISTRAR],
      ['tenant:org_short', '10d', 30 * DAY, AUDIT_SEAL_FLOOR_REGISTRAR],
    ]);
    expect(rig.errors.join('\n')).toMatch(/REJECTED the retention override '1d'.*app_ledger.*lifecycle\.seal/s);
  });

  it('an override above the declared window still applies, and is what the expiry signs', async () => {
    const rig = sweepRig([retained('30d')], { app_ledger: { maxAge: '90d' } });
    const { requests } = await rig.start();

    const report = await rig.lifecycle.sweep();

    expect(requests[0]).toMatchObject({ policyValue: '90d', cutoff: isoCutoff('90d') });
    expect(report.floorViolations).toEqual([]);
  });

  it('the floor follows the declaration: a lengthened window is the floor from the next sealer pass on', async () => {
    const objects = [retained('30d')];
    const rig = sweepRig(objects, { app_ledger: { maxAge: '45d' } });
    const { sealer, requests } = await rig.start();
    await rig.lifecycle.sweep();
    expect(requests[0]).toMatchObject({ policyValue: '45d' });

    objects[0] = retained('60d');
    await sealer.runPass();
    await rig.lifecycle.sweep();

    expect(requests[1]).toMatchObject({ policyValue: '60d', cutoff: isoCutoff('60d') });
  });

  it('a lifecycle service without retention floors gets no expiry: the sealed rows are kept', async () => {
    const registered: unknown[] = [];
    const errors: string[] = [];
    const plugin = new AuditPlugin({ cryptoProvider: { label: 'host' } as never });
    const engine = { getDriverForObject: () => undefined, registry: { getAllObjects: () => [retained()] } };
    const ctx = {
      logger: { info() {}, warn() {}, debug() {}, error: (m: string) => void errors.push(m) },
      getService: () => ({ registerExpiryPrefix: (expiry: unknown) => (registered.push(expiry), () => {}) }),
    };
    (plugin as unknown as { startSealer(e: unknown, c: unknown): void }).startSealer(engine, ctx);
    await (plugin as unknown as { sealer: AuditSealer }).sealer.stop();
    expect(registered).toEqual([]);
    expect(errors.join('\n')).toMatch(/no retention floors/);
  });
});

describe('AuditPlugin — signed expiry covers objects whose lifecycle is declared in packaged metadata (ADR-0154 D8)', () => {
  const FIELDS = { id: { type: 'text' }, created_at: { type: 'datetime' }, tenant_id: { type: 'lookup' }, new_value: { type: 'textarea' } };
  const runtime = (): LifecycleObjectLike => ({ ...retained('30d'), fields: FIELDS, _provenance: 'org', _packageId: 'sys_metadata' } as never);
  const packaged = (): LifecycleObjectLike => ({ ...retained('30d'), fields: FIELDS, _provenance: 'package', _packageId: 'app.ledger' } as never);

  it('an object created at runtime takes no floor: an override below its declared window applies, and no expiry is asked', async () => {
    const rig = sweepRig([runtime()], { app_ledger: { maxAge: '1d' } });
    const { requests } = await rig.start();

    const report = await rig.lifecycle.sweep();

    expect(requests).toEqual([]);
    expect(report.floorViolations).toEqual([]);
    expect(report.swept).toEqual([expect.objectContaining({ object: 'app_ledger', policy: 'retention', cutoff: isoCutoff('1d') })]);
  });

  it('an object owned under a package id no installed code or marketplace package answers takes no floor and no expiry', async () => {
    // The reload door's shape: a loader-chain body stamped with a package and package provenance.
    const unplaced = { ...retained('30d'), fields: FIELDS, _provenance: 'package', _packageId: 'app.unknown' } as never;
    const rig = sweepRig([unplaced], { app_ledger: { maxAge: '1d' } });
    const { requests } = await rig.start();

    const report = await rig.lifecycle.sweep();

    expect(requests).toEqual([]);
    expect(report.floorViolations).toEqual([]);
    expect(report.swept).toEqual([expect.objectContaining({ object: 'app_ledger', policy: 'retention', cutoff: isoCutoff('1d') })]);
  });

  it('a packaged object still takes its floor and the signed expiry', async () => {
    const rig = sweepRig([packaged()], { app_ledger: { maxAge: '1d' } });
    const { requests } = await rig.start();

    const report = await rig.lifecycle.sweep();

    expect(requests).toEqual([expect.objectContaining({ object: 'app_ledger', policyValue: '30d' })]);
    expect(report.floorViolations.map((v) => v.declaredBy)).toEqual([AUDIT_SEAL_FLOOR_REGISTRAR]);
  });

  it("the sealer's expiry answers no run for an object created at runtime, before it resolves a seam; a packaged one goes on", async () => {
    const objects = [runtime()];
    const rig = sweepRig(objects, undefined);
    const { sealer } = await rig.start();
    vi.mocked(sealer.expire).mockRestore();
    const seams = vi.spyOn(sealer as unknown as { resolveSeams(): Promise<unknown> }, 'resolveSeams').mockResolvedValue(null);
    const request = { object: 'app_ledger', policy: 'retention.maxAge', policyValue: '30d', cutoff: isoCutoff('30d') } as const;

    await expect(sealer.expire(request)).resolves.toEqual([]);
    expect(seams).not.toHaveBeenCalled();

    objects[0] = packaged();
    await expect(sealer.expire(request)).rejects.toThrow(/could not be resolved/);
    expect(seams).toHaveBeenCalledTimes(1);
  });
});

describe('sealedWindowFloors — the windows a sealed object is floored at', () => {
  /** A registry that places every object as a plain registration from code. */
  const CODE = { getObjectOwner: () => ({}) };
  it('a retained or ttl sealed object: one floor per window, at the declared value, by the audit seal', () => {
    expect(sealedWindowFloors(retained('30d'), CODE)).toEqual([
      expect.objectContaining({ policy: 'retention', minWindowMs: 30 * DAY, declaredBy: AUDIT_SEAL_FLOOR_REGISTRAR }),
    ]);
    expect(sealedWindowFloors({
      name: 'app_receipt',
      lifecycle: { class: 'audit', ttl: { field: 'created_at', expireAfter: '7d' }, seal: SEAL },
    }, CODE)).toEqual([expect.objectContaining({ policy: 'ttl', minWindowMs: 7 * DAY })]);
  });

  it('none for an unsealed object, an archiving one (it expires past `archive.keep`, which no override reaches), an unparsable window, or one the registry does not place in packaged metadata', () => {
    expect(sealedWindowFloors({ name: 'app_note', lifecycle: { class: 'audit', retention: { maxAge: '30d' } } }, CODE)).toEqual([]);
    expect(sealedWindowFloors({
      name: 'sys_audit_log',
      lifecycle: { class: 'audit', retention: { maxAge: '90d' }, archive: { after: '90d', to: 'archive', keep: '7y' }, seal: SEAL },
    }, CODE)).toEqual([]);
    expect(sealedWindowFloors({ name: 'app_ledger', lifecycle: { class: 'audit', retention: { maxAge: 'soon' }, seal: SEAL } }, CODE)).toEqual([]);
    expect(sealedWindowFloors({ ...retained('30d'), _provenance: 'org' } as never, CODE)).toEqual([]);
    expect(sealedWindowFloors(retained('30d'), {})).toEqual([]);
  });
});
