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
    const rows = await engine.find('rts_account', { where: { id: 'acc_y' }, context: MEMBER_X });
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

    const readable = await engine.find('rts_account', { where: { id: 'acc_y' }, context: GROUP_MEMBER });
    expect(readable.map((r: any) => r.id)).toEqual(['acc_y']);

    await engine.insert('rts_contact', { id: 'ct_grp', title: 'g', account: 'acc_y' }, { context: GROUP_MEMBER } as any);
    expect(storeFor('rts_contact').get('ct_grp')?.account).toBe('acc_y');
  });

  // ── [#19837] The dangling-reference audit asks the same question the guard
  // above now asks: each scanned row's reference is probed under that row's
  // OWN organization (claim-seat ruling, option B). It used to probe under the
  // bare `{ isSystem: true }`, so the row below read as resolving.

  it('[#19837] the audit REPORTS a stored cross-organization reference — probed under the row\'s own organization', async () => {
    // Written before #19808, or by an `isSystem` write: the guard never saw it.
    storeFor('rts_contact').set('ct_cross', { id: 'ct_cross', title: 'legacy', account: 'acc_y', organization_id: ORG_X });
    observed.length = 0;

    const out = await engine.inspectDanglingReferences({ objects: ['rts_contact'] });

    expect(out.undetermined).toBe(0);
    expect(out.dangling).toEqual([
      { objectName: 'rts_contact', recordId: 'ct_cross', field: 'account', target: 'rts_account', value: 'acc_y' },
    ]);
    // The row's organization reached the driver as the probe's tenant.
    const probe = observed.filter((c) => c.object === 'rts_account' && c.method === 'findOne');
    expect(probe.map((c) => c.options?.tenantId)).toEqual([ORG_X, ORG_X]);
  });

  it('[#19837] lit controls: same-organization, NULL-organization and tenancy-disabled references are not reported', async () => {
    const contacts = storeFor('rts_contact');
    // `ct_x` (seeded above) holds a same-organization reference.
    contacts.set('ct_y_own', { id: 'ct_y_own', title: 'y', account: 'acc_y', organization_id: ORG_Y });
    // A NULL-organization row probes unscoped: its reference resolves anywhere.
    contacts.set('ct_null', { id: 'ct_null', title: 'n', account: 'acc_y', organization_id: null });
    // `cat_1` is stamped ORG_Y, so only the withheld tenant lets this resolve.
    contacts.set('ct_cat', { id: 'ct_cat', title: 'c', catalog: 'cat_1', organization_id: ORG_X });
    // The lit half: the same run still reports what really resolves nowhere.
    contacts.set('ct_gone', { id: 'ct_gone', title: 'g', account: 'acc_nowhere', organization_id: ORG_X });

    const out = await engine.inspectDanglingReferences({ objects: ['rts_contact'] });

    expect(out.scanned).toBe(5);
    expect(out.undetermined).toBe(0);
    expect(out.dangling.map((d) => d.recordId)).toEqual(['ct_gone']);
  });

  it('[#19837] ⚠️ `group` posture: a cross-organization reference a group member legitimately wrote is reported too', async () => {
    // Pinned so this moves only by decision. The guard's reach under `group` is
    // the WRITER's membership set, which the stored row does not record, so the
    // audit — probing under the row's own organization alone — is stricter than
    // the rule here. Raised on the card as an open question.
    engine.setTenancyPostureProvider(() => 'group');
    const GROUP_MEMBER = { ...MEMBER_X, accessible_org_ids: [ORG_X, ORG_Y] } as unknown as ExecutionContext;
    await engine.insert('rts_contact', { id: 'ct_grp', title: 'g', account: 'acc_y' }, { context: GROUP_MEMBER } as any);
    expect(storeFor('rts_contact').get('ct_grp')).toMatchObject({ account: 'acc_y', organization_id: ORG_X });

    const out = await engine.inspectDanglingReferences({ objects: ['rts_contact'] });

    expect(out.dangling.map((d) => d.recordId)).toEqual(['ct_grp']);
  });
});

/**
 * [#19837] The master-detail PARENT binding reads the header under the
 * caller's tenant scope.
 *
 * `resolveMasterDetailParent` (update by id) and `resolveMasterDetailParents`
 * (insert, bulk update) read the header the detail's `parent.*` predicates are
 * judged against. They read under a bare `{ isSystem: true }`, so the header
 * was found in ANY organization. Measured on a real `SecurityPlugin` +
 * `ObjectQL` + `SqlDriver` stack after #19808: an org-X caller naming an org-Y
 * header got `note: required` for a `locked` header and `header:
 * reference_not_found` for an `open` one — one bit of another organization's
 * row per write, because `evaluateValidationRules` runs before
 * `assertReferencesResolve`. The update doors leaked the same bit through
 * `readonlyWhen` (a dropped or kept field, a strict refusal or not) and, for a
 * row that already STORES a cross-organization header, through a committed or
 * refused write.
 *
 * The read now runs under `ObjectQL.referenceCheckContext(context)`. A header
 * outside the caller's tenant scope binds as ABSENT — the same binding a header
 * that exists nowhere gets — so every pair below answers the same, and the
 * controls prove the predicates still evaluate wherever the header is the
 * caller's to read.
 */
describe('[#19837] the master-detail parent binding is scoped to the caller\'s organization', () => {
  let engine: ObjectQL;
  let observed: ObservedCall[];
  let storeFor: (obj: string) => Map<string, Record<string, unknown>>;

  const HEADER = {
    name: 'pb_header',
    label: 'Header',
    fields: {
      id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
      status: { name: 'status', label: 'Status', type: 'text' as const },
    },
  } as any;

  /** A platform-global master (ADR-0066). */
  const GLOBAL_HEADER = { ...HEADER, name: 'pb_gheader', label: 'Global header', tenancy: { enabled: false } } as any;

  /** `requiredWhen` over `parent.*` — the insert and update doors. */
  const LINE = {
    name: 'pb_line',
    label: 'Line',
    fields: {
      id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
      header: { name: 'header', label: 'Header', type: 'master_detail' as const, reference: 'pb_header' },
      note: { name: 'note', label: 'Note', type: 'text' as const, requiredWhen: "parent.status == 'locked'" },
    },
  } as any;

  const GLOBAL_LINE = {
    ...LINE,
    name: 'pb_gline',
    label: 'Global line',
    fields: { ...LINE.fields, header: { ...LINE.fields.header, reference: 'pb_gheader' } },
  } as any;

  /** `readonlyWhen` over `parent.*` — the update doors. */
  const ITEM = {
    name: 'pb_item',
    label: 'Item',
    fields: {
      id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
      header: { name: 'header', label: 'Header', type: 'master_detail' as const, reference: 'pb_header' },
      memo: { name: 'memo', label: 'Memo', type: 'text' as const, readonlyWhen: "parent.status == 'locked'" },
    },
  } as any;

  beforeEach(async () => {
    observed = [];
    engine = new ObjectQL();
    const stub = makeTenantScopedDriver(observed);
    storeFor = stub.storeFor;
    engine.registerDriver(stub.driver, true);
    await engine.init();
    for (const o of [HEADER, GLOBAL_HEADER, LINE, GLOBAL_LINE, ITEM]) engine.registry.registerObject(o, PACKAGE_ID);
    const headers = storeFor('pb_header');
    headers.set('hx_open', { id: 'hx_open', status: 'open', organization_id: ORG_X });
    headers.set('hx_locked', { id: 'hx_locked', status: 'locked', organization_id: ORG_X });
    headers.set('hy_open', { id: 'hy_open', status: 'open', organization_id: ORG_Y });
    headers.set('hy_locked', { id: 'hy_locked', status: 'locked', organization_id: ORG_Y });
    headers.set('hnull_locked', { id: 'hnull_locked', status: 'locked', organization_id: null });
    // Stamped with ANOTHER organization on purpose, as `cat_1` above: only the
    // engine withholding `tenantId` for a tenancy-disabled master resolves it.
    storeFor('pb_gheader').set('gh_locked', { id: 'gh_locked', status: 'locked', organization_id: ORG_Y });
  });

  /** Insert a line with `note` omitted — `requiredWhen` decides. */
  const insertLine = (header: string, object = 'pb_line') =>
    engine.insert(object, { id: `ln_${header}`, header }, { context: MEMBER_X } as any);

  it('premise: the org-X caller cannot read either org-Y header directly', async () => {
    const rows = await engine.find('pb_header', { where: { id: { $in: ['hy_open', 'hy_locked'] } }, context: MEMBER_X });
    expect(rows).toEqual([]);
  });

  it('insert — an org-Y `locked` header and an org-Y `open` header answer the same, as a header that exists nowhere', async () => {
    const locked = await refusalOf(() => insertLine('hy_locked'));
    const open = await refusalOf(() => insertLine('hy_open'));
    const nowhere = await refusalOf(() => insertLine('h_nowhere'));

    const expected = { status: 400, code: 'VALIDATION_FAILED', fields: [{ field: 'header', code: 'reference_not_found' }] };
    expect(locked).toBeInstanceOf(ValidationError);
    expect(envelopeOf(locked)).toEqual(expected);
    expect(envelopeOf(open)).toEqual(expected);
    expect(envelopeOf(nowhere)).toEqual(expected);
    const shape = (err: unknown, id: string) => String((err as Error).message).split(id).join('ID');
    expect(shape(locked, 'hy_locked')).toBe(shape(open, 'hy_open'));
    expect(storeFor('pb_line').size).toBe(0);
  });

  it('update by id — a repoint onto an org-Y header answers the same whichever state that header is in', async () => {
    storeFor('pb_line').set('ln_x', { id: 'ln_x', header: 'hx_open', note: null, organization_id: ORG_X });
    const repoint = (header: string) =>
      engine.update('pb_line', { header }, { where: { id: 'ln_x' }, context: MEMBER_X } as any);

    const locked = await refusalOf(() => repoint('hy_locked'));
    const open = await refusalOf(() => repoint('hy_open'));

    const expected = { status: 400, code: 'VALIDATION_FAILED', fields: [{ field: 'header', code: 'reference_not_found' }] };
    expect(envelopeOf(locked)).toEqual(expected);
    expect(envelopeOf(open)).toEqual(expected);
    expect(storeFor('pb_line').get('ln_x')?.header).toBe('hx_open');
  });

  it('update by id — `readonlyWhen` over a STORED org-Y header locks the field whichever state that header is in', async () => {
    const items = storeFor('pb_item');
    items.set('it_yl', { id: 'it_yl', header: 'hy_locked', memo: 'orig', organization_id: ORG_X });
    items.set('it_yo', { id: 'it_yo', header: 'hy_open', memo: 'orig', organization_id: ORG_X });
    const drops: Record<string, unknown[]> = { it_yl: [], it_yo: [] };
    const writeMemo = (id: string) => engine.update('pb_item', { memo: 'new' }, {
      where: { id }, context: MEMBER_X, onFieldsDropped: (d: unknown) => drops[id].push(d),
    } as any);

    await writeMemo('it_yl');
    await writeMemo('it_yo');

    // Unbound `parent` is #4889's fail-CLOSED LOCKED, for both: no bit leaks
    // through the stored value or through the drop report.
    expect(items.get('it_yl')?.memo).toBe('orig');
    expect(items.get('it_yo')?.memo).toBe('orig');
    expect(drops.it_yl).toEqual([{ object: 'pb_item', fields: ['memo'], reason: 'readonly_when' }]);
    expect(drops.it_yo).toEqual(drops.it_yl);

    // …and under `strictReadonlyWrites`, both are the same loud refusal.
    const strict = (id: string) => refusalOf(() => engine.update('pb_item', { memo: 'new' }, {
      where: { id }, context: MEMBER_X, strictReadonlyWrites: true,
    } as any));
    const lockedStrict = envelopeOf(await strict('it_yl'));
    expect({ status: lockedStrict.status, code: lockedStrict.code }).toEqual({ status: 500, code: 'ERR_READONLY_FIELD_REJECTED' });
    expect(envelopeOf(await strict('it_yo'))).toEqual(lockedStrict);
  });

  it('update by id and bulk — `requiredWhen` over a STORED org-Y header is not judged against that header', async () => {
    const lines = storeFor('pb_line');
    for (const id of ['ln_yl', 'ln_yo', 'ln_bl', 'ln_bo']) {
      lines.set(id, { id, header: id.endsWith('l') ? 'hy_locked' : 'hy_open', note: 'n', organization_id: ORG_X });
    }

    // Clearing `note` would violate `requiredWhen` against the locked header
    // (ADR-0113: the pre-state complied). It used to be refused for `hy_locked`
    // and committed for `hy_open`; the header is not the caller's to read, so
    // both are now judged with `parent` unbound (#4977: fail-open) — alike.
    await engine.update('pb_line', { note: '' }, { where: { id: 'ln_yl' }, context: MEMBER_X } as any);
    await engine.update('pb_line', { note: '' }, { where: { id: 'ln_yo' }, context: MEMBER_X } as any);
    await engine.update('pb_line', { note: '' }, { where: { id: 'ln_bl' }, multi: true, context: MEMBER_X } as any);
    await engine.update('pb_line', { note: '' }, { where: { id: 'ln_bo' }, multi: true, context: MEMBER_X } as any);

    expect(['ln_yl', 'ln_yo', 'ln_bl', 'ln_bo'].map((id) => lines.get(id)?.note)).toEqual(['', '', '', '']);
  });

  it('lit controls: a same-organization `locked` header still requires `note`; an `open` one commits', async () => {
    const err = await refusalOf(() => insertLine('hx_locked'));
    expect(envelopeOf(err)).toEqual({ status: 400, code: 'VALIDATION_FAILED', fields: [{ field: 'note', code: 'required' }] });

    await insertLine('hx_open');
    expect(storeFor('pb_line').get('ln_hx_open')?.header).toBe('hx_open');
  });

  it('lit controls: a same-organization `locked` header still locks `readonlyWhen`; an `open` one lets it through', async () => {
    const items = storeFor('pb_item');
    items.set('it_xl', { id: 'it_xl', header: 'hx_locked', memo: 'orig', organization_id: ORG_X });
    items.set('it_xo', { id: 'it_xo', header: 'hx_open', memo: 'orig', organization_id: ORG_X });

    await engine.update('pb_item', { memo: 'new' }, { where: { id: 'it_xl' }, context: MEMBER_X } as any);
    await engine.update('pb_item', { memo: 'new' }, { where: { id: 'it_xo' }, context: MEMBER_X } as any);

    expect(items.get('it_xl')?.memo).toBe('orig');
    expect(items.get('it_xo')?.memo).toBe('new');
  });

  it('lit controls: a NULL-organization header and a tenancy-disabled master still bind', async () => {
    const nullOrg = await refusalOf(() => insertLine('hnull_locked'));
    expect(envelopeOf(nullOrg)).toEqual({ status: 400, code: 'VALIDATION_FAILED', fields: [{ field: 'note', code: 'required' }] });

    observed.length = 0;
    const global = await refusalOf(() => insertLine('gh_locked', 'pb_gline'));
    expect(envelopeOf(global)).toEqual({ status: 400, code: 'VALIDATION_FAILED', fields: [{ field: 'note', code: 'required' }] });
    // Bound because the engine withheld the tenant for this master (ADR-0066).
    const read = observed.filter((c) => c.object === 'pb_gheader' && c.method === 'find');
    expect(read).toHaveLength(1);
    expect(read[0].options?.tenantId).toBeUndefined();
  });

  it('the header read runs ELEVATED and TENANT-SCOPED — the two halves of `{ ...context, isSystem: true }`', async () => {
    const reads: Array<{ operation: string; context: ExecutionContext }> = [];
    engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
      if (opCtx.object === 'pb_header') reads.push({ operation: opCtx.operation, context: opCtx.context });
      await next();
    });
    storeFor('pb_line').set('ln_x', { id: 'ln_x', header: 'hx_open', note: 'n', organization_id: ORG_X });

    // Insert: `resolveMasterDetailParents` is the batch `find`; the `findOne`
    // behind it is #19808's reference probe (the payload names the header).
    await insertLine('hx_open');
    // Update by id, header not in the payload: no reference probe, so the one
    // `findOne` is `resolveMasterDetailParent` reading the stored row's header.
    await engine.update('pb_line', { note: 'm' }, { where: { id: 'ln_x' }, context: MEMBER_X } as any);

    expect(reads.map((r) => r.operation)).toEqual(['find', 'findOne', 'findOne']);
    for (const { context } of reads) {
      expect(context).toMatchObject({ isSystem: true, tenantId: ORG_X, userId: 'u_x' });
    }
    // …and the tenant reaches the driver on every one of them.
    const driverReads = observed.filter((c) => c.object === 'pb_header');
    expect(driverReads.map((c) => c.options?.tenantId)).toEqual([ORG_X, ORG_X, ORG_X]);
  });
});
