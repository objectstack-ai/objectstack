// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19808] The write-path reference check answers "does this id name a row"
 * for the CALLER's organization, not for the whole database.
 *
 * `referenceExists` — the probe behind `assertReferencesResolve` (#4441) — used
 * to read under a bare `{ isSystem: true }`. That context carries no
 * `tenantId`, so `buildDriverOptions` handed the driver no tenant and the
 * existence check spanned every organization. Measured on a real
 * `SecurityPlugin` + `ObjectQL` + `SqlDriver` stack, an org-bound caller
 * writing a lookup to a row that exists only in ANOTHER organization got a
 * committed write, while an id that exists nowhere got `VALIDATION_FAILED`:
 * a stored cross-tenant foreign key, and a cross-tenant existence oracle.
 *
 * The probe now runs under the `sudo()`-shaped `referenceCheckContext`
 * (`{ ...callerContext, isSystem: true }`): RLS/FLS stay bypassed — the #4441
 * docblock's reason for elevating, which is about row-level VISIBILITY — and
 * the caller's `tenantId` survives to the driver.
 *
 * ## The seam under test, and the double
 *
 * `@objectstack/objectql` cannot import `@objectstack/driver-sql` (the
 * dependency runs the other way — see `engine-external-tenant-scope.test.ts`),
 * so the driver below applies the SQL driver's tenant wall to the rows it
 * holds, keyed off exactly the input `SqlDriver.applyTenantScope` keys off:
 * `DriverOptions.tenantId` (early return when `undefined | null | ''`), the
 * `organization_id` column, `OR organization_id IS NULL`, and the `group`
 * posture's `tenantIds` union. Every call's options are recorded as well, so
 * the cases that matter pin both the behaviour AND the option the engine
 * decided.
 *
 * ## Every write door, both directions
 *
 * `assertReferencesResolve` has three call sites (insert, update by id, bulk
 * update); a guard wired into one is still a hole one call site over. Each
 * refusal case runs over all three, and each carries its lit control (a
 * same-organization reference still commits through the same door), so a fix
 * that refused EVERYTHING cannot pass either.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { resolveThrownHttpError } from '@objectstack/types';
import { ObjectQL } from './engine.js';
import { ValidationError } from './validation/record-validator.js';

const ORG_X = 'org_x_acme';
const ORG_Y = 'org_y_globex';

/** A normal, non-system member bound to organization X. */
const MEMBER_X = { userId: 'u_x', tenantId: ORG_X } as ExecutionContext;

const PACKAGE_ID = 'com.example.reference-tenant-scope';

/** Tenant-scoped by default: the registry injects `organization_id`. */
const ACCOUNT = {
  name: 'rts_account',
  label: 'Account',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
  },
} as any;

/** ADR-0066's declared way to say "rows of this object belong to no org". */
const CATALOG = {
  name: 'rts_catalog',
  label: 'Catalog',
  tenancy: { enabled: false },
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
  },
} as any;

const CONTACT = {
  name: 'rts_contact',
  label: 'Contact',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' as const },
    account: { name: 'account', label: 'Account', type: 'lookup' as const, reference: 'rts_account' },
    catalog: { name: 'catalog', label: 'Catalog', type: 'lookup' as const, reference: 'rts_catalog' },
  },
} as any;

interface ObservedCall {
  object: string;
  method: string;
  options: Record<string, any> | undefined;
}

/** `SqlDriver.applyTenantScope`'s predicate, over one row. */
function inTenantScope(row: Record<string, unknown>, options: any): boolean {
  const tenantId = options?.tenantId;
  if (tenantId === undefined || tenantId === null || tenantId === '') return true;
  const own = row.organization_id ?? null;
  if (own === null) return true;
  const union = Array.isArray(options?.tenantIds)
    ? options.tenantIds.filter((v: unknown) => typeof v === 'string' && v !== '')
    : [];
  if (union.length > 0) return union.includes(String(own));
  return String(own) === String(tenantId);
}

function matchesValue(actual: unknown, cond: unknown): boolean {
  if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
    const c = cond as Record<string, unknown>;
    if ('$eq' in c) return (actual ?? null) === (c.$eq ?? null);
    if ('$in' in c) return Array.isArray(c.$in) && c.$in.includes(actual);
    throw new Error(`double does not understand the operator in ${JSON.stringify(cond)}`);
  }
  return (actual ?? null) === (cond ?? null);
}

function matches(row: Record<string, unknown>, where: any): boolean {
  if (!where || typeof where !== 'object') return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === '$and') { if (!(v as any[]).every((w) => matches(row, w))) return false; continue; }
    if (k === '$or') { if (!(v as any[]).some((w) => matches(row, w))) return false; continue; }
    if (k.startsWith('$')) throw new Error(`double does not understand the operator ${k}`);
    if (!matchesValue(row[k], v)) return false;
  }
  return true;
}

function makeTenantScopedDriver(observed: ObservedCall[]) {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) { s = new Map(); stores.set(obj, s); }
    return s;
  };
  const record = (object: string, method: string, options: any) => observed.push({ object, method, options });
  let nextId = 0;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any, options: any) {
      record(object, 'find', options);
      const rows = Array.from(storeFor(object).values())
        .filter((r) => inTenantScope(r, options) && matches(r, ast?.where));
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(object: string, ast: any, options: any) {
      record(object, 'findOne', options);
      for (const r of storeFor(object).values()) {
        if (inTenantScope(r, options) && matches(r, ast?.where)) return r;
      }
      return null;
    },
    async count(object: string, ast: any, options: any) {
      return (await this.find(object, ast, options)).length;
    },
    async create(object: string, data: Record<string, unknown>, options: any) {
      record(object, 'create', options);
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      // `injectTenantOnInsert`: the active organization is the write target.
      const tenant = options?.tenantId;
      const row = {
        ...data,
        ...(data.organization_id === undefined && tenant ? { organization_id: tenant } : {}),
        id,
      };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>, options: any) {
      record(object, 'update', options);
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur || !inTenantScope(cur, options)) return null;
      const next = { ...cur, ...data, id };
      s.set(id, next);
      return next;
    },
    async updateMany(object: string, ast: any, data: Record<string, unknown>, options: any) {
      const rows = await this.find(object, ast, options);
      for (const r of rows) storeFor(object).set(r.id as string, { ...r, ...data, id: r.id });
      return rows.length;
    },
    async bulkCreate(object: string, rows: Record<string, unknown>[], options: any) {
      return Promise.all(rows.map((r) => this.create(object, r, options)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, stores, storeFor };
}

/** The refusal as every HTTP door reads it (ADR-0112), plus its field codes. */
function envelopeOf(err: unknown) {
  const thrown = resolveThrownHttpError(err);
  const fields = ((err as any)?.fields ?? []).map((f: any) => ({ field: f.field, code: f.code }));
  return { status: thrown.status, code: thrown.code, fields };
}

async function refusalOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  throw new Error('expected the write to be refused, but it succeeded');
}

type Door = 'insert' | 'update by id' | 'bulk update';
const DOORS: Door[] = ['insert', 'update by id', 'bulk update'];

describe('[#19808] the lookup existence probe is scoped to the caller\'s organization', () => {
  let engine: ObjectQL;
  let observed: ObservedCall[];
  let storeFor: (obj: string) => Map<string, Record<string, unknown>>;

  beforeEach(async () => {
    observed = [];
    engine = new ObjectQL();
    const stub = makeTenantScopedDriver(observed);
    storeFor = stub.storeFor;
    engine.registerDriver(stub.driver, true);
    await engine.init();
    for (const o of [ACCOUNT, CATALOG, CONTACT]) engine.registry.registerObject(o, PACKAGE_ID);
    // Seeded straight into the store, the way rows already in a database are.
    storeFor('rts_account').set('acc_x', { id: 'acc_x', name: 'X', organization_id: ORG_X });
    storeFor('rts_account').set('acc_y', { id: 'acc_y', name: 'Y', organization_id: ORG_Y });
    // Stamped with ANOTHER organization on purpose: this double scopes every
    // row it is asked to, so the only way this row resolves for an org-X
    // caller is the engine withholding `tenantId` for a tenancy-disabled
    // object. An org-less row would resolve either way and light nothing.
    storeFor('rts_catalog').set('cat_1', { id: 'cat_1', name: 'Global', organization_id: ORG_Y });
    // The row the two update doors repoint.
    storeFor('rts_contact').set('ct_x', { id: 'ct_x', title: 'mine', account: 'acc_x', organization_id: ORG_X });
  });

  const write = (door: Door, account: string, context: ExecutionContext = MEMBER_X) => {
    if (door === 'insert') {
      return engine.insert('rts_contact', { id: 'ct_new', title: 'new', account }, { context } as any);
    }
    if (door === 'update by id') {
      return engine.update('rts_contact', { account }, { where: { id: 'ct_x' }, context } as any);
    }
    return engine.update('rts_contact', { account }, { where: { title: 'mine' }, multi: true, context } as any);
  };

  /** What the store holds for the row the door writes — `undefined` when absent. */
  const stored = (door: Door) => storeFor('rts_contact').get(door === 'insert' ? 'ct_new' : 'ct_x');

  it('premise: the org-X caller cannot read the org-Y row directly', async () => {
    const rows = await engine.find('rts_account', { where: { id: 'acc_y' }, context: MEMBER_X } as any);
    expect(rows).toEqual([]);
  });

  it.each(DOORS)('%s — a reference to a row that exists only in ANOTHER organization is refused', async (door) => {
    const err = await refusalOf(() => write(door, 'acc_y'));

    expect(err).toBeInstanceOf(ValidationError);
    expect(envelopeOf(err)).toEqual({
      status: 400,
      code: 'VALIDATION_FAILED',
      fields: [{ field: 'account', code: 'reference_not_found' }],
    });
    // Nothing landed: no new row, and a repoint left the stored value alone.
    if (door === 'insert') expect(stored(door)).toBeUndefined();
    else expect(stored(door)?.account).toBe('acc_x');
  });

  it.each(DOORS)('%s — "exists only in another organization" and "exists nowhere" are indistinguishable', async (door) => {
    const elsewhere = await refusalOf(() => write(door, 'acc_y'));
    const nowhere = await refusalOf(() => write(door, 'acc_nowhere'));

    expect(envelopeOf(elsewhere)).toEqual(envelopeOf(nowhere));
    // The same sentence, too, once the caller's own id is taken out of it —
    // the only difference left between the two answers is what the caller sent.
    const shape = (err: unknown, id: string) => String((err as Error).message).split(id).join('ID');
    expect(shape(elsewhere, 'acc_y')).toBe(shape(nowhere, 'acc_nowhere'));
  });

  it.each(DOORS)('%s — lit control: a reference inside the caller\'s own organization still commits', async (door) => {
    if (door === 'insert') {
      await write(door, 'acc_x');
      expect(stored(door)?.account).toBe('acc_x');
      return;
    }
    // Repoint to a second org-X account, so a no-op cannot pass for a commit.
    storeFor('rts_account').set('acc_x2', { id: 'acc_x2', name: 'X2', organization_id: ORG_X });
    await write(door, 'acc_x2');
    expect(stored(door)?.account).toBe('acc_x2');
  });

  it('the probe runs ELEVATED and TENANT-SCOPED — the two halves of `{ ...context, isSystem: true }`', async () => {
    const probes: ExecutionContext[] = [];
    engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
      if (opCtx.operation === 'findOne' && opCtx.object === 'rts_account') probes.push(opCtx.context);
      await next();
    });
    observed.length = 0;

    await write('insert', 'acc_x');

    // `isSystem` is what the security middleware's total bypass keys on — the
    // #4441 reason for elevating (a link to a row the caller cannot READ).
    expect(probes).toHaveLength(1);
    expect(probes[0]).toMatchObject({ isSystem: true, tenantId: ORG_X, userId: 'u_x' });
    // …and the tenant reaches the driver: the seam `applyTenantScope` keys off.
    const driverProbe = observed.filter((c) => c.object === 'rts_account' && c.method === 'findOne');
    expect(driverProbe).toHaveLength(1);
    expect(driverProbe[0].options?.tenantId).toBe(ORG_X);
  });

  it('lit control: a reference to a tenancy-disabled (platform-global) object still resolves from an org-bound caller', async () => {
    observed.length = 0;

    const row: any = await engine.insert('rts_contact', { id: 'ct_cat', title: 'c', catalog: 'cat_1' }, { context: MEMBER_X } as any);

    expect(row.catalog).toBe('cat_1');
    // Resolved because the engine withheld the tenant for this object
    // (`buildDriverOptions`, ADR-0066) — not because the double let it through.
    const catalogProbe = observed.filter((c) => c.object === 'rts_catalog' && c.method === 'findOne');
    expect(catalogProbe).toHaveLength(1);
    expect(catalogProbe[0].options?.tenantId).toBeUndefined();
  });

  it('lit control: an `isSystem` write stays unchecked — the method\'s early return, and no probe runs', async () => {
    observed.length = 0;
    const SYSTEM_X = { isSystem: true, tenantId: ORG_X } as ExecutionContext;

    await engine.insert('rts_contact', { id: 'ct_sys_1', title: 's', account: 'acc_y' }, { context: SYSTEM_X } as any);
    await engine.insert('rts_contact', { id: 'ct_sys_2', title: 's', account: 'acc_nowhere' }, { context: SYSTEM_X } as any);

    expect(storeFor('rts_contact').get('ct_sys_1')?.account).toBe('acc_y');
    expect(storeFor('rts_contact').get('ct_sys_2')?.account).toBe('acc_nowhere');
    expect(observed.filter((c) => c.object === 'rts_account')).toEqual([]);
  });

  it('the `group` posture: the probe reaches the caller\'s whole membership set, as its reads do', async () => {
    // The spread carries `accessible_org_ids`, which `buildDriverOptions`
    // widens into `tenantIds` under `group` (ADR-0105 D2). A hand-picked
    // `{ isSystem, tenantId }` would drop it and refuse a reference the
    // caller can legitimately read.
    engine.setTenancyPostureProvider(() => 'group');
    const GROUP_MEMBER = { ...MEMBER_X, accessible_org_ids: [ORG_X, ORG_Y] } as unknown as ExecutionContext;

    const readable = await engine.find('rts_account', { where: { id: 'acc_y' }, context: GROUP_MEMBER } as any);
    expect(readable.map((r: any) => r.id)).toEqual(['acc_y']);

    await engine.insert('rts_contact', { id: 'ct_grp', title: 'g', account: 'acc_y' }, { context: GROUP_MEMBER } as any);
    expect(storeFor('rts_contact').get('ct_grp')?.account).toBe('acc_y');
  });

  it('the dangling-reference audit keeps its unscoped probe — a stored cross-organization reference is NOT reported', async () => {
    // Pinned so the audit's semantics move only by decision. The audit has no
    // caller: it probes under the bare `{ isSystem: true }` it always used, so
    // a row holding another organization's id reads as resolving. Whether the
    // audit should probe under each row's OWN organization is an open
    // question on the card, not something this fix decided.
    storeFor('rts_contact').set('ct_cross', { id: 'ct_cross', title: 'legacy', account: 'acc_y', organization_id: ORG_X });

    const out = await engine.inspectDanglingReferences({ objects: ['rts_contact'] });

    expect(out.undetermined).toBe(0);
    expect(out.dangling).toEqual([]);
  });
});
