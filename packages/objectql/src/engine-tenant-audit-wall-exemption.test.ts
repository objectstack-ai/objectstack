// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D8 · 8c-1] The engine declares the wall's exemption to the driver.
 *
 * An exempt platform admin's predicate write reaches the driver with no
 * `tenantId`: the wall lifted the scope on purpose, and the driver's read scope
 * is the recorded verdict (`engine-driver-read-scope.test.ts`). The driver's
 * `[tenant-audit]` line then told that write to declare `bypassTenantAudit:
 * true` — an option no REST caller can set, because only the engine builds the
 * driver's options. The engine now fills it in when the recorded verdict is
 * `none` and the same ladder without the exemption would have walled the
 * operation: the exemption, read from the one place it is decided.
 *
 * Both directions are pinned, through the `DriverOptions` the driver receives
 * (the same seam and harness as `engine-driver-read-scope.test.ts`): what is
 * declared (a recorded `none` under a wall, on a tenant object), and what is
 * not (no verdict recorded, a walled verdict, a `single` posture, an insert, a
 * tenancy-disabled object, a caller's own value, a value that does not parse).
 */

import { describe, it, expect } from 'vitest';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { ObjectQL } from './engine.js';

const ORG_A = 'org_a';
const ADMIN: ExecutionContext = { userId: 'u_admin', tenantId: ORG_A };

interface ObservedCall {
  method: string;
  options: Record<string, any> | undefined;
}

function makeDriver(observed: ObservedCall[]) {
  const record = (method: string, options: any) => observed.push({ method, options });
  const driver: any = {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(_o: string, _ast: any, options: any) { record('find', options); return []; },
    async findOne(_o: string, _ast: any, options: any) { record('findOne', options); return null; },
    async count(_o: string, _ast: any, options: any) { record('count', options); return 0; },
    async create(_o: string, data: any, options: any) { record('create', options); return { id: 'r_1', ...data }; },
    async update(_o: string, id: string, data: any, options: any) { record('update', options); return { id, ...data }; },
    async updateMany(_o: string, _ast: any, _data: any, options: any) { record('updateMany', options); return 0; },
    async deleteMany(_o: string, _ast: any, options: any) { record('deleteMany', options); return 0; },
    async delete() { return true; },
    async bulkCreate() { return []; }, async bulkUpdate() { return []; }, async bulkDelete() {},
    async syncSchema() {},
  };
  return driver;
}

/** Tenant-scoped by default: the registry injects `organization_id`. */
const TASK = { name: 'ds_task', fields: { name: { type: 'text' } } } as any;
/** ADR-0066 platform-global: outside the tenant machinery. */
const GLOBAL = { name: 'ds_global', tenancy: { enabled: false }, fields: { name: { type: 'text' } } } as any;

async function makeEngine(opts: { posture: string; recordedVerdict?: unknown }) {
  const observed: ObservedCall[] = [];
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver(observed), true);
  await engine.init();
  engine.registry.registerObject(TASK, 'com.example.wall-exemption');
  engine.registry.registerObject(GLOBAL, 'com.example.wall-exemption');
  engine.setTenancyPostureProvider(() => opts.posture);
  if (opts.recordedVerdict !== undefined) {
    // Where plugin-security records what its wall decided (#15813).
    engine.registerMiddleware(async (opCtx, next) => {
      (opCtx as any).tenantLayer0Verdict = opts.recordedVerdict;
      await next();
    });
  }
  const last = (method: string) => observed.filter((c) => c.method === method).at(-1)?.options;
  return { engine, last };
}

const updateMany = (engine: ObjectQL, object = 'ds_task', extra: Record<string, unknown> = {}) =>
  engine.update(object, { name: 'x' }, { where: { name: 'y' }, multi: true, context: ADMIN, ...extra } as any);

describe('[ADR-0131 D8 · 8c-1] a wall-exempted write is declared to the driver', () => {
  it('`isolated`, recorded `none` on a tenant object: updateMany carries bypassTenantAudit, and no tenantId', async () => {
    const { engine, last } = await makeEngine({ posture: 'isolated', recordedVerdict: { kind: 'none' } });
    await updateMany(engine);
    expect(last('updateMany')?.bypassTenantAudit).toBe(true);
    expect(last('updateMany')?.tenantId).toBeUndefined();
  });

  it('`isolated`, recorded `none`: deleteMany is declared too', async () => {
    const { engine, last } = await makeEngine({ posture: 'isolated', recordedVerdict: { kind: 'none' } });
    await engine.delete('ds_task', { where: { name: 'y' }, multi: true, context: ADMIN } as any);
    expect(last('deleteMany')?.bypassTenantAudit).toBe(true);
  });

  it('`group`, recorded `none`: the union wall is lifted the same way', async () => {
    const { engine, last } = await makeEngine({ posture: 'group', recordedVerdict: { kind: 'none' } });
    await updateMany(engine, 'ds_task', { context: { ...ADMIN, accessible_org_ids: [ORG_A] } });
    expect(last('updateMany')?.bypassTenantAudit).toBe(true);
  });
});

describe('[ADR-0131 D8 · 8c-1] what is NOT declared', () => {
  it('a walled verdict: the write is scoped, nothing to declare', async () => {
    const { engine, last } = await makeEngine({ posture: 'isolated', recordedVerdict: { kind: 'organization', organizationId: ORG_A } });
    await updateMany(engine);
    expect(last('updateMany')?.tenantId).toBe(ORG_A);
    expect(last('updateMany')?.bypassTenantAudit).toBeUndefined();
  });

  it('no verdict recorded (a by-id write, no security layer): absence is not exemption', async () => {
    const { engine, last } = await makeEngine({ posture: 'isolated' });
    await updateMany(engine);
    expect(last('updateMany')?.bypassTenantAudit).toBeUndefined();
  });

  it('`single`: a recorded `none` is the inert wall, not a crossing', async () => {
    const { engine, last } = await makeEngine({ posture: 'single', recordedVerdict: { kind: 'none' } });
    await updateMany(engine);
    expect(last('updateMany')?.bypassTenantAudit).toBeUndefined();
  });

  it('an insert: the write target is the active organization, whatever was recorded', async () => {
    const { engine, last } = await makeEngine({ posture: 'isolated', recordedVerdict: { kind: 'none' } });
    await engine.insert('ds_task', { name: 'A' }, { context: ADMIN });
    expect(last('create')?.tenantId).toBe(ORG_A);
    expect(last('create')?.bypassTenantAudit).toBeUndefined();
  });

  it('a tenancy-disabled object: outside the machinery, nothing to declare', async () => {
    const { engine, last } = await makeEngine({ posture: 'isolated', recordedVerdict: { kind: 'none' } });
    await updateMany(engine, 'ds_global');
    expect(last('updateMany')?.bypassTenantAudit).toBeUndefined();
  });

  it('a recorded value that does not parse lifts nothing', async () => {
    const { engine, last } = await makeEngine({ posture: 'isolated', recordedVerdict: { kind: 'none', extra: 1 } });
    await updateMany(engine);
    expect(last('updateMany')?.bypassTenantAudit).toBeUndefined();
  });

  it('a caller\'s own value wins: the engine only fills in a value nobody supplied', async () => {
    const { engine, last } = await makeEngine({ posture: 'isolated', recordedVerdict: { kind: 'none' } });
    await updateMany(engine, 'ds_task', { bypassTenantAudit: false });
    expect(last('updateMany')?.bypassTenantAudit).toBe(false);
  });
});
