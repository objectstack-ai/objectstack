// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D8] One predicate, computed once: the driver's native tenant read
 * scope (`DriverOptions.tenantId` / `tenantIds`, which `SqlDriver.applyTenantScope`
 * compiles) is the Layer 0 verdict projected onto `DriverOptions` — never a
 * second derivation beside the wall.
 *
 * Before this, `buildDriverOptions` derived the driver's scope on its own from
 * the active organization alone, so the two walls answered differently in two
 * places: under `single` the driver narrowed a read Layer 0 leaves open, and
 * for an exempt `PLATFORM_ADMIN` (or the verified platform owner's read) the
 * driver narrowed what Layer 0 had admitted.
 *
 * The seam under test is `DriverOptions`, as in
 * `engine-external-tenant-scope.test.ts`: `@objectstack/objectql` cannot import
 * a driver, and "no `tenantId`" is exactly "no organization predicate" in the
 * SQL driver. The recorded verdict is planted the way plugin-security records
 * it — on the operation context, by a middleware, before the core handler runs.
 *
 * Both directions are pinned: what widens (the `single` read, a recorded
 * `none`) and what must not move (the walled read, the system read under a
 * wall, the write target in every posture, a recorded verdict that does not
 * parse).
 */

import { describe, it, expect } from 'vitest';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { ObjectQL } from './engine.js';

const ORG_A = 'org_a';
const ORG_B = 'org_b';
const MEMBER: ExecutionContext = { userId: 'u_member', tenantId: ORG_A };
const GROUP_MEMBER = { ...MEMBER, accessible_org_ids: [ORG_A, ORG_B] } as ExecutionContext;

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
    async delete() { return true; },
    async bulkCreate() { return []; }, async bulkUpdate() { return []; }, async bulkDelete() {},
    async syncSchema() {},
  };
  return driver;
}

/** Tenant-scoped by default: the registry injects `organization_id`. */
const TASK = { name: 'ds_task', fields: { name: { type: 'text' } } } as any;

async function makeEngine(opts: { posture: string; recordedVerdict?: unknown }) {
  const observed: ObservedCall[] = [];
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver(observed), true);
  await engine.init();
  engine.registry.registerObject(TASK, 'com.example.driver-read-scope');
  engine.setTenancyPostureProvider(() => opts.posture);
  if (opts.recordedVerdict !== undefined) {
    // Where plugin-security records what its wall decided (#15813).
    engine.registerMiddleware(async (opCtx, next) => {
      (opCtx as any).tenantLayer0Verdict = opts.recordedVerdict;
      await next();
    });
  }
  const last = (method: string) => observed.filter((c) => c.method === method).at(-1)?.options;
  return { engine, observed, last };
}

describe('[ADR-0131 D8] the driver read scope over the engine\'s own facts (no wall recorded)', () => {
  it('`single`: a member\'s read carries no tenant scope — the wall is inert, so the driver is too', async () => {
    const { engine, last } = await makeEngine({ posture: 'single' });
    await engine.find('ds_task', {}, { context: MEMBER });
    await engine.count('ds_task', {}, { context: MEMBER });
    for (const method of ['find', 'count']) {
      expect(last(method)?.tenantId, method).toBeUndefined();
      expect(last(method)?.tenantIds, method).toBeUndefined();
    }
  });

  it('`single`: an insert still carries the active organization — the write target, not a read scope', async () => {
    const { engine, last } = await makeEngine({ posture: 'single' });
    await engine.insert('ds_task', { name: 'A' }, { context: MEMBER });
    expect(last('create')?.tenantId).toBe(ORG_A);
  });

  it('`isolated`: a member\'s read is scoped to the active organization', async () => {
    const { engine, last } = await makeEngine({ posture: 'isolated' });
    await engine.find('ds_task', {}, { context: MEMBER });
    expect(last('find')).toMatchObject({ tenantId: ORG_A });
    expect(last('find')?.tenantIds).toBeUndefined();
  });

  it('`isolated`: a SYSTEM read naming an organization stays scoped to it — the engine grants no exemption', async () => {
    const { engine, last } = await makeEngine({ posture: 'isolated' });
    await engine.find('ds_task', {}, { context: { isSystem: true, tenantId: ORG_A } as ExecutionContext });
    expect(last('find')).toMatchObject({ tenantId: ORG_A });
  });

  it('`isolated`: a SYSTEM read naming no organization is unscoped, as before', async () => {
    const { engine, last } = await makeEngine({ posture: 'isolated' });
    await engine.find('ds_task', {}, { context: { isSystem: true } as ExecutionContext });
    expect(last('find')?.tenantId).toBeUndefined();
  });

  it('`group`: the read reaches the membership union, keyed on the active organization', async () => {
    const { engine, last } = await makeEngine({ posture: 'group' });
    await engine.find('ds_task', {}, { context: GROUP_MEMBER });
    expect(last('find')).toMatchObject({ tenantId: ORG_A, tenantIds: [ORG_A, ORG_B] });
  });

  it('`group` with no membership set: the active organization, never wider', async () => {
    const { engine, last } = await makeEngine({ posture: 'group' });
    await engine.find('ds_task', {}, { context: MEMBER });
    expect(last('find')).toMatchObject({ tenantId: ORG_A });
    expect(last('find')?.tenantIds).toBeUndefined();
  });
});

describe('[ADR-0131 D8] the driver read scope is the verdict the wall RECORDED on the operation', () => {
  it('a recorded `none` (an exempt platform admin, the verified owner\'s read) reaches what Layer 0 admitted', async () => {
    const { engine, last } = await makeEngine({ posture: 'isolated', recordedVerdict: { kind: 'none' } });
    await engine.find('ds_task', {}, { context: MEMBER });
    await engine.update('ds_task', { name: 'x' }, { where: { name: 'y' }, multi: true, context: MEMBER } as any);
    expect(last('find')?.tenantId).toBeUndefined();
    expect(last('updateMany')?.tenantId).toBeUndefined();
  });

  it('a recorded `organizations` set is the driver\'s union, deduplicated by the wall', async () => {
    const { engine, last } = await makeEngine({
      posture: 'group',
      recordedVerdict: { kind: 'organizations', organizationIds: [ORG_B] },
    });
    await engine.find('ds_task', {}, { context: GROUP_MEMBER });
    // The recorded verdict (e.g. a delegator intersection) wins over the
    // caller's own membership list.
    expect(last('find')).toMatchObject({ tenantId: ORG_A, tenantIds: [ORG_B] });
  });

  it('a recorded `organization` is the driver\'s equality', async () => {
    const { engine, last } = await makeEngine({
      posture: 'isolated',
      recordedVerdict: { kind: 'organization', organizationId: ORG_B },
    });
    await engine.find('ds_task', {}, { context: MEMBER });
    expect(last('find')).toMatchObject({ tenantId: ORG_B });
  });

  it('a recorded `deny` keeps the active organization — the narrowest scope a driver can express', async () => {
    const { engine, last } = await makeEngine({ posture: 'isolated', recordedVerdict: { kind: 'deny' } });
    await engine.find('ds_task', {}, { context: MEMBER });
    expect(last('find')).toMatchObject({ tenantId: ORG_A });
  });

  it('a recorded value that does not parse reads as absent — the engine decides, with no exemption', async () => {
    const { engine, last } = await makeEngine({ posture: 'isolated', recordedVerdict: { kind: 'everyone' } });
    await engine.find('ds_task', {}, { context: MEMBER });
    expect(last('find')).toMatchObject({ tenantId: ORG_A });
  });

  it('an insert ignores the recorded verdict: the active organization is where the row lands', async () => {
    const { engine, last } = await makeEngine({ posture: 'isolated', recordedVerdict: { kind: 'none' } });
    await engine.insert('ds_task', { name: 'A' }, { context: MEMBER });
    expect(last('create')?.tenantId).toBe(ORG_A);
  });
});
