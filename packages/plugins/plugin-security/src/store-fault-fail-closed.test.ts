// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#7505] `readRowById`'s callers, under a store that cannot be read.
//
// ## The collapse this suite exists to keep closed
//
// The shared single-row probe answered `null` for three different facts — the
// row does not exist, the engine threw, no engine is wired — and its own
// contract note claimed a `null` "always DENIES downstream". That was true of
// ONE caller and false of the others, in two opposite directions:
//
//   • `assertControlledByParentWrite` turned a fault into `404
//     RECORD_NOT_FOUND` (covered next door in
//     `controlled-by-parent-sharing.test.ts` — the 404 is that gate's own
//     envelope and belongs with the rest of its legs);
//   • the two admin-door PROVENANCE gates read `null` as "this row is not
//     package/platform-managed" and let the write THROUGH. That is fail-OPEN:
//     for the duration of a store fault, ADR-0086's two-doors boundary and
//     ADR-0066's asset-ownership boundary both silently stood down;
//   • `getCallerPreImage`'s owner-echo consumer caught the throw and answered
//     `403 changing record ownership` — fail-closed, but with a sentence that
//     accuses the caller of something they did not do and an envelope an SDK
//     will not retry.
//
// Maintainer ruling of 2026-08-11: FAIL-CLOSED, and never `404` for an outage.
// A fault propagates; `null` means absent and only absent.
//
// ## Why the store double faults per OBJECT
//
// Every case below pins BOTH directions on the SAME gate: the steady-state
// answer (row absent / row present) and the fault answer. A double that threw
// on everything would satisfy "the fault propagates" while telling us nothing
// about whether the gate still works — which is the failure mode this whole
// family is made of.

import { describe, it, expect, vi } from 'vitest';
import { SecurityPlugin } from './security-plugin.js';
import type { PermissionSet } from '@objectstack/spec/security';

const USER = 'usr_admin';
const OTHER = 'usr_other';

type Row = Record<string, unknown>;

/**
 * A driver outage shaped like the real one — modelled field-for-field on
 * `@objectstack/objectql`'s `DatasourceUnavailableError`: `code`, `name`,
 * `datasource`, and NO `status`, because that class declares none.
 * `@objectstack/rest`'s `mapDataError` routes it to 503 off the CODE
 * (`rest-server.ts`, pinned by `rest.test.ts` "maps ERR_DATASOURCE_UNAVAILABLE
 * → 503"), so giving the double a `status` its producer never sets would let
 * these cases pass against an error no engine can throw.
 *
 * `plugin-security` does not depend on `objectql` — it reaches the engine
 * through the injected service — so the shape is restated rather than imported.
 */
function datasourceOutage(object: string): Error {
  const e = new Error(
    `[ObjectQL] Datasource 'primary' configured for object '${object}' is declared but not connected: ` +
      `it failed to connect at startup and the server was started with OS_ALLOW_DRIVER_CONNECT_FAILURE.`,
  ) as Error & { code: string; datasource: string };
  e.name = 'DatasourceUnavailableError';
  e.code = 'ERR_DATASOURCE_UNAVAILABLE';
  e.datasource = 'primary';
  return e;
}

const SCHEMAS: Record<string, unknown> = {
  sys_permission_set: {
    name: 'sys_permission_set',
    fields: { id: { name: 'id' }, name: { name: 'name' }, managed_by: { name: 'managed_by' } },
  },
  sys_position: {
    name: 'sys_position',
    fields: { id: { name: 'id' }, name: { name: 'name' }, managed_by: { name: 'managed_by' } },
  },
  crm_task: {
    name: 'crm_task',
    sharingModel: 'private',
    fields: {
      id: { name: 'id' },
      subject: { name: 'subject' },
      owner_id: { name: 'owner_id', type: 'lookup', reference: 'sys_user' },
    },
  },
};

/** Full CRUD, no `allowTransfer` and no `modifyAllRecords` — the owner echo is live. */
const ADMIN_SET: PermissionSet = {
  name: 'admin_set',
  label: 'Admin Set',
  objects: {
    sys_permission_set: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    sys_position: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    crm_task: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
} as unknown as PermissionSet;

/**
 * `ADMIN_SET` plus the tenant-admin wildcard. Needed only for
 * `sys_permission_set`: the ADR-0090 D12 delegated-admin gate runs a few lines
 * AFTER the two-doors gate and refuses RBAC-table writes from a principal with
 * mere CRUD grants, so without this the "admitted" half of a steady-state pair
 * would be measuring that gate instead of this one. It carries
 * `modifyAllRecords`, which is exactly why the two-doors boundary is placed
 * ahead of the CRUD check — a superuser does not get to forge provenance
 * either.
 */
const TENANT_ADMIN_SET: PermissionSet = {
  name: 'tenant_admin',
  label: 'Tenant Admin',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, modifyAllRecords: true } },
} as unknown as PermissionSet;

interface BootOptions {
  rows?: Record<string, Row[]>;
  /** `findOne` on this object throws a datasource outage. */
  faultOn?: string;
  /** Defaults to the plain-CRUD `ADMIN_SET` (no transfer grant, no wildcard). */
  sets?: PermissionSet[];
}

async function boot(options: BootOptions = {}) {
  const sets = options.sets ?? [ADMIN_SET];
  const rows: Record<string, Row[]> = options.rows ?? {};
  const matches = (row: Row, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    // `$and` / `$or` are CONJOINED with their sibling keys, the way a real
    // driver reads them — never `return`ed, which would discard every sibling
    // equality key in the same filter object (#7620 / #8494).
    if (Array.isArray(where.$and) && !where.$and.every((w: any) => matches(row, w))) return false;
    if (Array.isArray(where.$or) && !where.$or.some((w: any) => matches(row, w))) return false;
    return Object.entries(where).every(([k, v]) => {
      if (k === '$and' || k === '$or') return true;
      if (v && typeof v === 'object' && Array.isArray((v as any).$in)) {
        return (v as any).$in.map(String).includes(String(row[k]));
      }
      return String(row[k]) === String(v);
    });
  };

  const store = {
    rows,
    getSchema: (object: string) => SCHEMAS[object],
    find: vi.fn(async (object: string, o: any = {}) => (rows[object] ?? []).filter((r) => matches(r, o?.where))),
    findOne: vi.fn(async (object: string, o: any = {}) => {
      if (options.faultOn && object === options.faultOn) throw datasourceOutage(object);
      return (rows[object] ?? []).find((r) => matches(r, o?.where)) ?? null;
    }),
  };

  let middleware: any;
  const ql = {
    registerMiddleware: (mw: any) => {
      if (!middleware) middleware = mw;
    },
    getSchema: store.getSchema,
    find: store.find,
    findOne: store.findOne,
  };

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: ql,
    metadata: { get: async (n: string) => SCHEMAS[n], list: async () => sets },
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({
    defaultPermissionSets: sets,
    fallbackPermissionSet: sets[0].name,
  });
  await plugin.init(ctx);
  await plugin.start(ctx);

  const context = () => ({ userId: USER, tenantId: 'org-1', positions: [], permissions: [] });

  /** Run one write through the real middleware. Resolves if it was admitted. */
  const write = async (opCtx: Partial<Record<string, unknown>>): Promise<'admitted'> => {
    let admitted = false;
    await middleware({ options: {}, context: context(), ...opCtx } as any, async () => {
      admitted = true;
    });
    if (!admitted) throw new Error('middleware resolved without calling next()');
    return 'admitted';
  };

  return { store, plugin, write };
}

/** The thrown error itself — `rejects.toThrow` cannot see `code` / `status`. */
const refusalOf = async (run: Promise<unknown>): Promise<any> => {
  try {
    await run;
  } catch (e) {
    return e;
  }
  throw new Error('expected the write to be refused, but it was admitted');
};

/**
 * The shared shape of every fault assertion: the ENGINE's error arrived
 * untouched, and none of the gate's own envelopes was manufactured on top of
 * it. The negative half carries the ruling — a security code here would relabel
 * a dependency outage as an authorization event, and a 404 would tell an SDK to
 * drop the record id for good.
 */
function expectPropagatedOutage(err: any): void {
  expect(err.code).toBe('ERR_DATASOURCE_UNAVAILABLE');
  expect(err.name).toBe('DatasourceUnavailableError');
  expect(err.code).not.toBe('PERMISSION_DENIED');
  expect(err.code).not.toBe('RECORD_NOT_FOUND');
  expect(err.status ?? err.statusCode).not.toBe(403);
  expect(err.status ?? err.statusCode).not.toBe(404);
  expect(err.message).not.toContain('[Security] Access denied');
}

// ---------------------------------------------------------------------------

describe('[#7505] assertPackageManagedWriteGate — the two-doors boundary under a store fault', () => {
  const rows = () => ({
    sys_permission_set: [
      { id: 'ps_pkg', name: 'Package Set', managed_by: 'package' },
      { id: 'ps_env', name: 'Env Set', managed_by: 'admin' },
    ],
  });
  // `update` / `delete` defer to the ADR-0094 write-through, so the gate's own
  // row protection is reachable on the lifecycle verbs only.
  const purge = (where: Row) => ({ object: 'sys_permission_set', operation: 'purge', options: { where } });
  // See TENANT_ADMIN_SET: this table's writes pass a second, later gate.
  const bootPkg = (o: BootOptions = {}) => boot({ sets: [TENANT_ADMIN_SET], ...o });

  it('STEADY STATE: a package-managed row is refused, an admin-authored row is admitted', async () => {
    const h = await bootPkg({ rows: rows() });
    const denied = await refusalOf(h.write(purge({ id: 'ps_pkg' })));
    expect(denied.code).toBe('PERMISSION_DENIED');
    expect(denied.message).toContain('package-managed permission set');
    await expect(h.write(purge({ id: 'ps_env' }))).resolves.toBe('admitted');
  });

  it('FAULT (by id): the outage propagates — it does NOT read as "no package row here"', async () => {
    // The measured fail-open. Before the fix this resolved: the probe threw,
    // `readRowById` answered `null`, the gate concluded the row was not
    // package-managed, and the purge went through — against the very row the
    // steady-state case above proves is protected.
    const h = await bootPkg({ rows: rows(), faultOn: 'sys_permission_set' });
    expectPropagatedOutage(await refusalOf(h.write(purge({ id: 'ps_pkg' }))));
  });

  it('FAULT (bulk filter): the same answer — one gate cannot answer two ways for one outage', async () => {
    // The sibling branch, one `if` above: a filter write with no single id asks
    // the same question of the same store with `.findOne`, and used to swallow
    // the same fault with `.catch(() => null)`.
    const h = await bootPkg({ rows: rows(), faultOn: 'sys_permission_set' });
    expectPropagatedOutage(await refusalOf(h.write(purge({ name: 'Package Set' }))));
  });

  it('STEADY STATE (bulk filter): a filter that hits no package row is still admitted', async () => {
    // Fail-closed must not become "refuse everything": the bulk branch exists
    // precisely so a bulk edit that touches only env-authored rows succeeds.
    const h = await bootPkg({ rows: rows() });
    await expect(h.write(purge({ managed_by: 'admin' }))).resolves.toBe('admitted');
  });
});

describe('[#7505] assertSystemRowWriteGate — ADR-0066 asset ownership under a store fault', () => {
  const rows = () => ({
    sys_position: [
      { id: 'pos_platform', name: 'CEO', managed_by: 'platform' },
      { id: 'pos_admin', name: 'Regional Lead', managed_by: 'admin' },
    ],
  });
  const del = (where: Row) => ({ object: 'sys_position', operation: 'delete', options: { where } });

  it('STEADY STATE: a platform-provided position is refused, an admin-authored one is admitted', async () => {
    const h = await boot({ rows: rows() });
    const denied = await refusalOf(h.write(del({ id: 'pos_platform' })));
    expect(denied.code).toBe('PERMISSION_DENIED');
    expect(denied.message).toContain('provided by the platform');
    await expect(h.write(del({ id: 'pos_admin' }))).resolves.toBe('admitted');
  });

  it('FAULT (by id): the outage propagates instead of admitting the delete', async () => {
    const h = await boot({ rows: rows(), faultOn: 'sys_position' });
    expectPropagatedOutage(await refusalOf(h.write(del({ id: 'pos_platform' }))));
  });

  it('FAULT (bulk filter): the outage propagates there too', async () => {
    const h = await boot({ rows: rows(), faultOn: 'sys_position' });
    expectPropagatedOutage(await refusalOf(h.write(del({ name: 'CEO' }))));
  });
});

describe('[#7505] getCallerPreImage — the owner-anchor echo under a store fault', () => {
  const rows = () => ({
    crm_task: [
      { id: 'tsk_1', subject: 'Call back', owner_id: USER },
      { id: 'tsk_2', subject: 'Follow up', owner_id: OTHER },
    ],
  });
  const setOwner = (id: string, owner: string) => ({
    object: 'crm_task',
    operation: 'update',
    data: { id, owner_id: owner },
    options: { where: { id } },
  });

  it('STEADY STATE: an unchanged-owner echo is tolerated, a real transfer is denied', async () => {
    const h = await boot({ rows: rows() });
    // The form save that resends the owner it was given — the whole reason the
    // pre-image is read at all.
    await expect(h.write(setOwner('tsk_1', USER))).resolves.toBe('admitted');
    // …and the same shape with a DIFFERENT owner is a transfer, denied without
    // the grant. Both directions, or "tolerated" would prove nothing.
    const denied = await refusalOf(h.write(setOwner('tsk_1', OTHER)));
    expect(denied.code).toBe('PERMISSION_DENIED');
    expect(denied.message).toContain('requires the transfer grant');
  });

  it('STEADY STATE: an absent pre-image still DENIES — the oracle is untouched', async () => {
    // `null` from the probe means "absent, or invisible to you", and those two
    // must stay indistinguishable: the pre-image is read under the CALLER's
    // context precisely so a non-reader learns nothing about ownership. A row
    // that is not there denies exactly like a row the caller cannot see.
    const h = await boot({ rows: rows() });
    const denied = await refusalOf(h.write(setOwner('tsk_missing', USER)));
    expect(denied.code).toBe('PERMISSION_DENIED');
    expect(denied.message).toContain('requires the transfer grant');
  });

  it('FAULT: the outage propagates instead of being read as "you are not the owner"', async () => {
    // Fail-closed either way — the throw happens before `next()`, so no write
    // reaches the driver. What changes is the sentence: a store outage used to
    // be reported as an attempted ownership grab, on a 403 an SDK will not
    // retry. The catch that produced it was the only fail-closed answer
    // available while "absent" and "unreadable" were the same `null`.
    const h = await boot({ rows: rows(), faultOn: 'crm_task' });
    const err = await refusalOf(h.write(setOwner('tsk_1', USER)));
    expectPropagatedOutage(err);
    expect(err.message).not.toContain('requires the transfer grant');
  });

  it('the fault is NOT memoized as a verdict — a retry re-probes the store', async () => {
    // `getCallerPreImage` memoizes on `opCtx.__preImage`, and it must not cache
    // an outage: a probe that stored `null` on the fault path would turn one
    // transient failure into a settled "no pre-image" for the rest of the
    // operation, which is the collapse again at a smaller scale.
    const h = await boot({ rows: rows(), faultOn: 'crm_task' });
    expectPropagatedOutage(await refusalOf(h.write(setOwner('tsk_1', USER))));
    const firstCalls = h.store.findOne.mock.calls.length;
    expect(firstCalls).toBeGreaterThan(0);
    // The retry really re-asks the store…
    const second = await refusalOf(h.write(setOwner('tsk_1', USER)));
    expect(h.store.findOne.mock.calls.length).toBeGreaterThan(firstCalls);
    // …and gets the same honest answer, not a settled verdict derived from the
    // first failure.
    expectPropagatedOutage(second);
  });
});

describe('[#7505] readRowById itself', () => {
  it('a write that touches none of the probes is unaffected by a faulting store', async () => {
    // The blast radius, asserted rather than assumed: an ordinary field-only
    // update on an object with no provenance registry entry and no ownership
    // write never reaches `readRowById`, so a store fault does not reach it
    // either. Without this, "propagate the fault" could be satisfied by a
    // change that refuses every write during an outage.
    const h = await boot({
      rows: { crm_task: [{ id: 'tsk_1', subject: 'Call back', owner_id: USER }] },
      faultOn: 'crm_task',
    });
    await expect(
      h.write({
        object: 'crm_task',
        operation: 'update',
        data: { id: 'tsk_1', subject: 'Renamed' },
        options: { where: { id: 'tsk_1' } },
      }),
    ).resolves.toBe('admitted');
  });
});
