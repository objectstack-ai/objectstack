// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 50 — spawns the real producer once per single-cause fixture: two in-process kernel boots on a real SQL driver, the first seeding 2,600 records through the real CRUD mirror (each pays its activity row and its ledger row) to sit past the 2,000-row window the leaf gate replaced; slowest CI reading 35.78 s (run 40204927516, refresh PR #25960's window (hourly runs 40200279306 to 40272142430)) x 1.25, rounded up; read before this file reused its at-rest reads and paid its first boot at module scope

/**
 * [ADR-0139 E5] The parent-record read gates on the LEAF path, through a real
 * engine and a real SQL driver: one `ReadableIds` leaf per parent object, no
 * pre-scan, so a broad read of `sys_activity` or `sys_audit_log` is served
 * every row the caller may read, with a true total, on any table size — a
 * delegated caller's included (D5.1, as amended) — and D5's two remaining
 * classes still read through the bounded probe, by name.
 *
 * ## Why a real engine, a real driver and the real plugin
 *
 * The leaf is composed by the engine at its executor boundary (ADR-0139 D2)
 * and evaluated by the driver as one subquery against the parent's table (D3).
 * Neither half exists in a stand-in engine, so what the gate emits is only
 * measured here: `AuditPlugin` mounts both gates at `kernel:ready`, the rows
 * are stored by `SqliteWasmDriver`, and every read goes through the real
 * middleware chain.
 *
 * ## The one stand-in, and why it is the smallest honest one
 *
 * plugin-security. A leaf is composed from the security service's
 * `canReadObject` and `getReadFilter`; a probe reads the parent as the caller
 * through the engine middleware. plugin-security keeps those two answers in
 * parity (`getReadFilter`'s contract: "the same filter the engine middleware
 * ANDs into every find"), and so does the stand-in: one rule per parent
 * object, served both as `getReadFilter` and by one GLOBAL engine middleware
 * — global as plugin-security's is, so it narrows no object by name and makes
 * no parent one of D5's middleware-gated class:
 *
 *  - `e5_doc`: a member reads the records it owns; the admin reads them all;
 *    a delegated caller (`onBehalfOf`) reads the INTERSECTION of its own leg
 *    and its delegator's (ADR-0090 D10, as plugin-security answers both
 *    halves for that context), and the delegator's leg withholds a few of
 *    the member's records — so a leaf composed without the delegation would
 *    serve rows a delegated read of `e5_doc` does not;
 *  - `e5_vault`: no member may read it (`canReadObject` false; a direct read
 *    is refused and the refusal recorded); the admin may;
 *  - every other object: every caller reads every record.
 *
 * `getReadableFields` is deliberately absent, so the withheld-update rule
 * (`activity-field-redaction.ts`, ADR-0139 E6's) stays inert and what is
 * measured is this gate alone; that rule's own bound is E6's card.
 *
 * Bulk rows are written through the engine as the system — the `e5_doc`
 * records through the real CRUD mirror (its `created` activity row and its
 * `create` ledger row), the ledger's rows about no record directly, as their
 * producers write them.
 *
 * [#26750] The ledger's rows about no record carry the Default Organization,
 * as the settings service stamps a tenant-scope change: a row with no
 * `tenant_id` is deployment-level, served to the platform administrator alone,
 * and no reader here is. The clause the ledger ANDs after its gate for every
 * other reader is taken off what the observer records, so the WHERE measured
 * below is the gate's own; the holder's case pins that the clause is there.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, findMisplacedReadableIds, refuseReadableIdsOnce, resolveReadableParentIds } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { AuditPlugin } from './audit-plugin.js';
import { LEDGER_AUDIT_CAPABILITY, ledgerRowAboutAnOrganizationWhere } from './audit-log-read-visibility.js';
import { PARENT_GATE_SCAN_LIMIT, parseParentRecord } from './parent-record-read-gate.js';
import { singlePostureTenancy } from './__tests__/single-posture-tenancy.js';
import { DEFAULT_ORGANIZATION_ID, installDefaultOrganization } from './default-organization.testkit.js';

const ACTIVITY = 'sys_activity';
const LEDGER = 'sys_audit_log';
/** Owner-scoped: a member reads its own records. */
const DOC = 'e5_doc';
/** No member may read it. */
const VAULT = 'e5_vault';
/** Narrowed by an object-scoped read middleware: D5's second class. */
const GATED = 'e5_gated';
/** Bound to another datasource: D5's third class. */
const FAR = 'e5_far';
const HARNESS_PACKAGE = 'com.objectstack.audit.test.parent-record-leaf';

const SYS = { isSystem: true } as const;
const MEMBER_A = { userId: 'u_a', tenantId: 'org_1', positions: ['org_member'] };
const MEMBER_B = { userId: 'u_b', tenantId: 'org_1', positions: ['org_member'] };
const ADMIN = { userId: 'u_admin', tenantId: 'org_1', positions: ['org_admin'] };
const HOLDER = { userId: 'u_holder', tenantId: 'org_1', positions: ['org_member'], systemPermissions: [LEDGER_AUDIT_CAPABILITY] };
const DELEGATED_A = { ...MEMBER_A, onBehalfOf: { userId: 'u_delegator' } };
/** The delegator's own leg on `e5_doc` admits every record but these (by name). */
const WITHHELD_FROM_DELEGATOR = ['a0', 'a1', 'a2'];

/** Past the 2,000-row candidate window the leaf replaces. */
const DOCS_OF_A = 2_300;
const DOCS_OF_B = 300;
/** The ledger's rows about no record, also past the window. */
const ROWS_ABOUT_NO_RECORD = 2_100;
const BATCH = 200;

const READ_OPS = new Set(['find', 'findOne', 'count', 'aggregate']);
const isAdmin = (context: any) => context?.userId === ADMIN.userId;

type Row = Record<string, any>;

/** The stand-in's one rule per parent object — the read scope a leaf is composed with. */
function readScopeOf(object: string, context: any): Record<string, unknown> | undefined {
  if (context?.isSystem || isAdmin(context)) return undefined;
  if (object !== DOC) return undefined;
  const own = { owner: context?.userId ?? '__nobody__' };
  // ADR-0090 D10: a delegated caller's scope is its own leg AND its delegator's.
  return context?.onBehalfOf?.userId ? { $and: [own, { name: { $nin: WITHHELD_FROM_DELEGATOR } }] } : own;
}
const mayReadObject = (object: string, context: any) => context?.isSystem || object !== VAULT || isAdmin(context);

/** Reads of a parent object as a caller (not the system), by object: the probe's footprint. */
const callerReads: Array<{ object: string; operation: string; userId?: string }> = [];
/** Direct reads of the vault the stand-in refused. */
const refusals: Array<{ object: string; userId?: string }> = [];

const security = {
  async canReadObject(object: string, context?: any): Promise<boolean> {
    return mayReadObject(object, context);
  },
  async getReadFilter(object: string, context?: any): Promise<Record<string, unknown> | undefined> {
    return readScopeOf(object, context);
  },
};

class WarehouseDriver extends SqliteWasmDriver {
  public override readonly name: string = 'warehouse';
}

const objectOf = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  label: name,
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' as const },
    owner: { name: 'owner', label: 'Owner', type: 'text' as const },
  },
  ...extra,
});

async function bootKernel(driver: SqliteWasmDriver) {
  const kernel = new ObjectKernel({ logger: { level: 'silent' } });
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(singlePostureTenancy());
  await kernel.use(new AuditPlugin());
  await kernel.use({
    name: 'test.security-stand-in',
    version: '0.0.0',
    init: async (ctx: any) => ctx.registerService('security', security),
    start: async () => {},
  } as any);
  await kernel.bootstrap();
  const engine = kernel.getService<ObjectQL>('objectql');
  await driver.connect();
  engine.registerDriver(driver, true);
  return { kernel, engine };
}

/** plugin-security's middleware, as the stand-in plays it: global, the same rule as `getReadFilter`. */
function installSecurityMiddleware(engine: ObjectQL): void {
  engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
    if (READ_OPS.has(op.operation) && op.context && !op.context.isSystem && op.object !== ACTIVITY && op.object !== LEDGER) {
      callerReads.push({ object: op.object, operation: op.operation, userId: op.context.userId });
      if (!mayReadObject(op.object, op.context)) {
        refusals.push({ object: op.object, userId: op.context.userId });
        throw Object.assign(new Error(`[Security] Access denied: operation '${op.operation}' on object '${op.object}'`), {
          code: 'PERMISSION_DENIED',
          statusCode: 403,
        });
      }
      const scope = readScopeOf(op.object, op.context);
      if (scope && op.ast) op.ast.where = op.ast.where ? { $and: [op.ast.where, scope] } : scope;
    }
    return next();
  });
}

async function insertInBatches(engine: ObjectQL, object: string, rows: Row[]): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    await engine.insert(object, rows.slice(i, i + BATCH) as any, { context: SYS });
  }
}

// [#23181] Pay the first kernel boot at module scope, never in a hook: vitest
// clocks a hook as it clocks a test, and the first boot is the slow one. The
// throwaway kernel registers no fixture object, writes nothing and is shut down
// before any hook runs.
await (await bootKernel(new SqliteWasmDriver({ filename: ':memory:' }))).kernel.shutdown();

describe('[ADR-0139 E5] the parent-record read gates on the leaf path', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  /** The WHERE each gated read reached the driver boundary with, by object. */
  /**
   * [#26750] A ledger read's WHERE split into the gate's own and the
   * deployment-level clause the ledger ANDs after it (`andIntoWhere`'s shape).
   */
  const DEPLOYMENT_LEVEL_CLAUSE = JSON.stringify(ledgerRowAboutAnOrganizationWhere());
  const splitDeploymentLevelClause = (where: any): { gate: unknown; bound: boolean } => {
    if (JSON.stringify(where) === DEPLOYMENT_LEVEL_CLAUSE) return { gate: undefined, bound: true };
    if (Array.isArray(where?.$and) && where.$and.length === 2 && JSON.stringify(where.$and[1]) === DEPLOYMENT_LEVEL_CLAUSE) {
      return { gate: where.$and[0], bound: true };
    }
    return { gate: where, bound: false };
  };
  const seenWhere: Record<string, unknown[]> = { [ACTIVITY]: [], [LEDGER]: [] };
  /** [#26750] Per ledger read the observer saw: was the deployment-level clause ANDed after the gate? */
  const ledgerOrganizationBound: boolean[] = [];
  const ids: Record<string, string> = {};

  /**
   * [#23181] Every row of an object at rest, as the system reads it — read once
   * and reused. No case in this describe writes after `beforeAll`, so each such
   * read answered the same rows: the cases made nearly seventy of them, most
   * over tables of thousands of rows. Each reuse counts the object first and
   * re-reads on a moved count, so a case that adds or removes rows is never
   * judged against an older ground truth.
   */
  const atRestCache = new Map<string, { count: number; rows: Row[] }>();
  const atRestOf = async (object: string): Promise<Row[]> => {
    const count = await engine.count(object, {}, { context: SYS });
    const hit = atRestCache.get(object);
    if (hit && hit.count === count) return hit.rows;
    const rows: Row[] = await engine.find(object, { limit: 100_000, context: SYS });
    atRestCache.set(object, { count, rows });
    return rows;
  };

  /** Every row at rest, and the ground truth of who may read which, judged by the stand-in's own rules. */
  const truth = async (object: string, reader: any): Promise<string[]> => {
    const atRest = await atRestOf(object);
    const live = new Map<string, Map<string, Row>>();
    for (const parent of [DOC, VAULT, GATED, FAR]) {
      const records = await atRestOf(parent);
      live.set(parent, new Map(records.map((r) => [String(r.id), r])));
    }
    const holder = Array.isArray(reader?.systemPermissions) && reader.systemPermissions.includes(LEDGER_AUDIT_CAPABILITY);
    return atRest
      .filter((row) => {
        // [#26750] No reader here is the platform administrator, so no deployment-level row is any reader's.
        if (object === LEDGER && (row.tenant_id === null || row.tenant_id === '')) return false;
        if (object === LEDGER && holder) return true;
        if (object === LEDGER && (row.record_id === null || row.record_id === '') && !['create', 'update', 'delete', 'read'].includes(row.action)) {
          return typeof row.action === 'string' && row.action !== '';
        }
        const parent = live.get(row.object_name)?.get(String(row.record_id));
        if (!parent) return false;
        if (isAdmin(reader)) return true;
        if (row.object_name === VAULT) return false;
        if (row.object_name === DOC && reader?.onBehalfOf?.userId && WITHHELD_FROM_DELEGATOR.includes(parent.name)) return false;
        if (row.object_name === DOC || row.object_name === GATED) return parent.owner === reader.userId;
        return true;
      })
      .map((r) => String(r.id))
      .sort();
  };
  const served = async (object: string, context: any, extra: Record<string, unknown> = {}) =>
    ((await engine.find(object, { limit: 100_000, ...extra, context })) as Row[]).map((r) => String(r.id)).sort();

  beforeAll(async () => {
    ({ kernel, engine } = await bootKernel(new SqliteWasmDriver({ filename: ':memory:' })));
    const warehouse = new WarehouseDriver({ filename: ':memory:' });
    await warehouse.connect();
    engine.registerDriver(warehouse);
    engine.registry.registerObject(objectOf(DOC) as any, HARNESS_PACKAGE);
    engine.registry.registerObject(objectOf(VAULT) as any, HARNESS_PACKAGE);
    engine.registry.registerObject(objectOf(GATED) as any, HARNESS_PACKAGE);
    engine.registry.registerObject(objectOf(FAR, { datasource: 'warehouse' }) as any, HARNESS_PACKAGE);
    await engine.syncSchemas();
    // A real `single` install's Default Organization: the system writes below
    // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
    await installDefaultOrganization(engine);
    installSecurityMiddleware(engine);
    // D5's second class: an object-scoped read middleware narrows the gated parent.
    engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
      if (READ_OPS.has(op.operation) && op.context && !op.context.isSystem && !isAdmin(op.context) && op.ast) {
        const mine = { owner: op.context.userId ?? '__nobody__' };
        op.ast.where = op.ast.where ? { $and: [op.ast.where, mine] } : mine;
      }
      return next();
    }, { object: GATED });
    // Registered last, so it sees each gated read's WHERE as the gates left it.
    for (const object of [ACTIVITY, LEDGER]) {
      engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
        if (!READ_OPS.has(op.operation) || !op.context || op.context.isSystem) return next();
        if (object !== LEDGER) {
          seenWhere[object].push(op.ast?.where);
          return next();
        }
        const { gate, bound } = splitDeploymentLevelClause(op.ast?.where);
        seenWhere[object].push(gate);
        ledgerOrganizationBound.push(bound);
        return next();
      }, { object });
    }

    // The bulk, through the real CRUD mirror: one activity row and one ledger row per record.
    const docs: Row[] = [];
    for (let i = 0; i < DOCS_OF_A; i++) docs.push({ name: `a${i}`, owner: MEMBER_A.userId });
    for (let i = 0; i < DOCS_OF_B; i++) docs.push({ name: `b${i}`, owner: MEMBER_B.userId });
    await insertInBatches(engine, DOC, docs);
    ids.gone = (await engine.insert(DOC, { name: 'gone', owner: MEMBER_A.userId }, { context: SYS })).id;
    await engine.delete(DOC, { where: { id: ids.gone }, context: SYS });
    ids.vault = (await engine.insert(VAULT, { name: 'vault' }, { context: SYS })).id;
    ids.gatedA = (await engine.insert(GATED, { name: 'gated a', owner: MEMBER_A.userId }, { context: SYS })).id;
    ids.gatedB = (await engine.insert(GATED, { name: 'gated b', owner: MEMBER_B.userId }, { context: SYS })).id;
    ids.far = (await engine.insert(FAR, { name: 'far' }, { context: SYS })).id;

    // The ledger's rows about no record, as their producers write them (the settings service's config_change).
    const now = new Date().toISOString();
    const outside: Row[] = [];
    for (let i = 0; i < ROWS_ABOUT_NO_RECORD; i++) {
      outside.push({
        action: 'config_change', object_name: 'sys_setting', record_id: null, actor: 'svc:fixture',
        tenant_id: DEFAULT_ORGANIZATION_ID, created_at: now,
      });
    }
    await insertInBatches(engine, LEDGER, outside);
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  it('control: the fixture is past the window, and every row came from its producer', async () => {
    const activity = await atRestOf(ACTIVITY);
    expect(activity.length).toBeGreaterThan(PARENT_GATE_SCAN_LIMIT);
    expect(activity.filter((r) => r.object_name === DOC && r.type === 'created').length).toBe(DOCS_OF_A + DOCS_OF_B + 1);
    expect(activity.some((r) => r.object_name === DOC && r.record_id === ids.gone && r.type === 'deleted')).toBe(true);
    expect((await truth(ACTIVITY, MEMBER_A)).length).toBeGreaterThan(PARENT_GATE_SCAN_LIMIT);
    const ledger = await atRestOf(LEDGER);
    expect(ledger.filter((r) => r.action === 'config_change').length).toBe(ROWS_ABOUT_NO_RECORD);
  });

  it('a member is served every activity row it may read past the old window, and the total agrees', async () => {
    const expected = await truth(ACTIVITY, MEMBER_A);
    expect(await served(ACTIVITY, MEMBER_A)).toEqual(expected);
    expect(await engine.count(ACTIVITY, {}, { context: MEMBER_A })).toBe(expected.length);
    const expectedB = await truth(ACTIVITY, MEMBER_B);
    expect(await served(ACTIVITY, MEMBER_B)).toEqual(expectedB);
  });

  it('an administrator’s site-wide read (newest first, 20) is served 20 rows and a true total, not the window', async () => {
    const page: Row[] = await engine.find(ACTIVITY, {
      orderBy: [{ field: 'timestamp', order: 'desc' }],
      limit: 20,
      context: ADMIN,
    });
    expect(page).toHaveLength(20);
    const total = await engine.count(ACTIVITY, {}, { context: ADMIN });
    expect(total).toBe((await truth(ACTIVITY, ADMIN)).length);
    expect(total).toBeGreaterThan(PARENT_GATE_SCAN_LIMIT);
  });

  it('no row is served whose parent the reader may not read, or that no longer exists', async () => {
    const all = await atRestOf(ACTIVITY);
    const byId = new Map(all.map((r) => [String(r.id), r]));
    for (const id of await served(ACTIVITY, MEMBER_A)) {
      const row = byId.get(id)!;
      expect(row.object_name).not.toBe(VAULT);
      expect(row.record_id).not.toBe(ids.gone);
      if (row.object_name === DOC) expect(byId.get(id)).toBeTruthy();
    }
    expect((await served(ACTIVITY, ADMIN)).some((id) => byId.get(id)!.record_id === ids.gone)).toBe(false);
    expect((await served(ACTIVITY, ADMIN)).some((id) => byId.get(id)!.object_name === VAULT)).toBe(true);
  });

  it('the leaf reads no parent as the caller: a member’s broad read logs no refusal and reads neither the doc nor the vault', async () => {
    callerReads.length = 0;
    refusals.length = 0;
    await served(ACTIVITY, MEMBER_A);
    await engine.count(ACTIVITY, {}, { context: MEMBER_A });
    expect(refusals).toEqual([]);
    expect(callerReads.filter((r) => r.object === DOC || r.object === VAULT)).toEqual([]);
  });

  it('one leaf per enumerated parent; D5’s middleware-gated and federated parents are probed, beside them', async () => {
    seenWhere[ACTIVITY].length = 0;
    await served(ACTIVITY, MEMBER_A);
    const where = seenWhere[ACTIVITY][0] as any;
    const branches: any[] = where.$or;
    const leaves = branches.filter((b) => b?.record_id?.$in && !Array.isArray(b.record_id.$in)).map((b) => b.object_name);
    expect(leaves).toEqual(expect.arrayContaining([DOC, VAULT]));
    expect(leaves).not.toContain(GATED);
    expect(leaves).not.toContain(FAR);
    expect(leaves).not.toContain(ACTIVITY);
    const probed = branches.filter((b) => Array.isArray(b?.record_id?.$in));
    expect(probed).toEqual(expect.arrayContaining([
      { object_name: GATED, record_id: { $in: [ids.gatedA] } },
      { object_name: FAR, record_id: { $in: [ids.far] } },
    ]));
  });

  // One case per reader (#27547): the three readers in one case were ~24 full
  // reads of the fixture, which crossed the 5 s default on a loaded Test Core
  // shard. Each reader is its own case with the same assertions — never a
  // raised timeout, a skipped reader or a smaller fixture (#27306).
  it.each([
    { label: 'MEMBER_A', reader: MEMBER_A },
    { label: 'MEMBER_B', reader: MEMBER_B },
    { label: 'ADMIN', reader: ADMIN },
  ])('[ADR-0139 D4] a read naming its parents is served the rows the same read spelled as an $or is, through one branch per named parent — $label', async ({ reader }) => {
    const NAMED = [DOC, VAULT, GATED];
    const named = { object_name: { $in: NAMED } };
    // The same rows, in a spelling the gate does not read as naming its parents: it keeps every branch.
    const spelledOut = { $or: NAMED.map((object_name) => ({ object_name })) };
    const atRest = await atRestOf(ACTIVITY);
    const parentOf = new Map(atRest.map((r) => [String(r.id), r.object_name]));
    const gateConjunct = (where: any) => where.$and[1];
    seenWhere[ACTIVITY].length = 0;
    const rows = await served(ACTIVITY, reader, { where: named });
    const narrowed = gateConjunct(seenWhere[ACTIVITY][0]);
    expect(rows).toEqual(await served(ACTIVITY, reader, { where: spelledOut }));
    const full = gateConjunct(seenWhere[ACTIVITY][1]);
    expect(rows).toEqual((await truth(ACTIVITY, reader)).filter((id) => NAMED.includes(parentOf.get(id))));
    expect(await engine.count(ACTIVITY, { where: named }, { context: reader })).toBe(rows.length);
    // A reader who reads some of the named parents and not others: the vault's rows are its alone.
    expect(rows.some((id) => parentOf.get(id) === VAULT)).toBe(reader === ADMIN);
    // One branch per named parent — the doc's and the vault's leaves, the gated parent's probe — of the full enumeration's.
    expect(narrowed.$or.map((b: any) => b.object_name)).toEqual([DOC, VAULT, GATED]);
    expect(narrowed.$or.filter((b: any) => Array.isArray(b.record_id.$in)).map((b: any) => b.object_name)).toEqual([GATED]);
    expect(full.$or.length).toBeGreaterThan(NAMED.length);
    expect(full.$or.map((b: any) => b.object_name)).toEqual(expect.arrayContaining(NAMED));
  });

  it('D5.1, as amended: a delegated caller reads through the leaf — every row its delegator intersection admits, past the window, a true total', async () => {
    for (const object of [ACTIVITY, LEDGER]) {
      seenWhere[object].length = 0;
      const rows = await served(object, DELEGATED_A);
      const where = seenWhere[object][0] as any;
      const branches: any[] = where.$or;
      const leaves = branches.filter((b) => b?.record_id?.$in && !Array.isArray(b.record_id.$in)).map((b) => b.object_name);
      expect(leaves, object).toEqual(expect.arrayContaining([DOC, VAULT]));
      expect(leaves, object).not.toContain(GATED);
      expect(leaves, object).not.toContain(FAR);
      // D5.2 and D5.3 keep the probe, read with the delegated context.
      expect(branches.filter((b) => Array.isArray(b?.record_id?.$in)), object).toEqual(expect.arrayContaining([
        { object_name: GATED, record_id: { $in: [ids.gatedA] } },
        { object_name: FAR, record_id: { $in: [ids.far] } },
      ]));
      const expected = await truth(object, DELEGATED_A);
      expect(expected.length, object).toBeGreaterThan(PARENT_GATE_SCAN_LIMIT);
      expect(rows, object).toEqual(expected);
      expect(await engine.count(object, {}, { context: DELEGATED_A }), object).toBe(expected.length);
    }
    // The intersection, never the principal's leg alone: the rows about the records the delegator is withheld are not served.
    const asMember = new Set(await served(ACTIVITY, MEMBER_A));
    const asDelegated = new Set(await served(ACTIVITY, DELEGATED_A));
    const withheld = [...asMember].filter((id) => !asDelegated.has(id));
    expect(withheld).toHaveLength(WITHHELD_FROM_DELEGATOR.length);
    expect([...asDelegated].every((id) => asMember.has(id))).toBe(true);
  });

  it('D5.1, as amended: parity with the probe — the leaf serves a delegated caller exactly the rows the probe’s own readability answer admits, unbounded', async () => {
    // The probe's answer is `resolveReadableParentIds`: one caller-scoped read
    // per parent object through the engine middleware chain, with the
    // delegated context. Asked here for every parent pair at rest, so no
    // window cuts it; the leaf must serve exactly the rows it admits.
    const atRest = await atRestOf(ACTIVITY);
    const pairs = new Map<string, Set<string>>();
    for (const row of atRest) {
      const parent = parseParentRecord(row, ACTIVITY);
      if (!parent || ![DOC, VAULT, GATED, FAR].includes(parent.object)) continue;
      if (!pairs.has(parent.object)) pairs.set(parent.object, new Set());
      pairs.get(parent.object)!.add(parent.recordId);
    }
    const readable = await resolveReadableParentIds(engine as any, DELEGATED_A, pairs);
    const admittedByProbe = atRest
      .filter((row) => {
        const parent = parseParentRecord(row, ACTIVITY);
        return parent !== null && (readable.get(parent.object)?.has(parent.recordId) ?? false);
      })
      .map((r) => String(r.id))
      .sort();
    expect(admittedByProbe.length).toBeGreaterThan(PARENT_GATE_SCAN_LIMIT);
    expect(await served(ACTIVITY, DELEGATED_A)).toEqual(admittedByProbe);
  });

  it('ledger: a non-holder is served every row about a readable record and every row about no record, past the window', async () => {
    const expected = await truth(LEDGER, MEMBER_A);
    expect(expected.length).toBeGreaterThan(DOCS_OF_A + ROWS_ABOUT_NO_RECORD - 1);
    expect(await served(LEDGER, MEMBER_A)).toEqual(expected);
    expect(await engine.count(LEDGER, {}, { context: MEMBER_A })).toBe(expected.length);
  });

  it('ledger: the outside class is a predicate — every row about no record, none named by a stored id', async () => {
    seenWhere[LEDGER].length = 0;
    const where = { action: 'config_change' };
    expect(await engine.count(LEDGER, { where }, { context: MEMBER_B })).toBe(ROWS_ABOUT_NO_RECORD);
    const seen = JSON.stringify(seenWhere[LEDGER][0]);
    expect(seen).not.toContain('"id":{"$in"');
  });

  it('ledger: the audit capability’s holder is not narrowed — the gate writes nothing for it', async () => {
    seenWhere[LEDGER].length = 0;
    ledgerOrganizationBound.length = 0;
    const expected = await truth(LEDGER, HOLDER);
    expect(await served(LEDGER, HOLDER)).toEqual(expected);
    expect(await engine.count(LEDGER, {}, { context: HOLDER })).toBe(expected.length);
    expect(seenWhere[LEDGER].every((w) => w === undefined)).toBe(true);
    // [#26750] ...while the deployment-level clause, which the holder is not exempt from, is.
    expect(ledgerOrganizationBound.length).toBeGreaterThan(0);
    expect(ledgerOrganizationBound.every(Boolean)).toBe(true);
    // ...and the activity stream's gate still narrows it.
    expect(await served(ACTIVITY, HOLDER)).toEqual(await truth(ACTIVITY, HOLDER));
  });

  it('[#22788 note 1] branch count and query time on this fixture, recorded', async () => {
    seenWhere[ACTIVITY].length = 0;
    const time = async (run: () => Promise<unknown>) => {
      const t0 = performance.now();
      await run();
      return Math.round((performance.now() - t0) * 10) / 10;
    };
    const reading = {
      rowsAtRest: (await atRestOf(ACTIVITY)).length,
      leafMs: {
        memberFind: await time(() => served(ACTIVITY, MEMBER_A)),
        memberCount: await time(() => engine.count(ACTIVITY, {}, { context: MEMBER_A })),
        adminTop20: await time(() => engine.find(ACTIVITY, { orderBy: [{ field: 'timestamp', order: 'desc' }], limit: 20, context: ADMIN })),
        adminCount: await time(() => engine.count(ACTIVITY, {}, { context: ADMIN })),
        delegatedFind: await time(() => served(ACTIVITY, DELEGATED_A)),
        delegatedCount: await time(() => engine.count(ACTIVITY, {}, { context: DELEGATED_A })),
      },
      branches: 0,
      leaves: 0,
    };
    const where = seenWhere[ACTIVITY][0] as any;
    reading.branches = where.$or.length;
    reading.leaves = where.$or.filter((b: any) => b?.record_id?.$in && !Array.isArray(b.record_id.$in)).length;
    // A reading, never a verdict on a duration (AGENTS.md).
    console.log(`E5-READING ${JSON.stringify(reading)}`);
    expect(reading.leaves).toBeGreaterThan(0);
  });
});

/** A driver that does not compile the composed leaf, refusing it with D3's envelope, as `driver-mongodb` does. */
class RefusingDriver extends SqliteWasmDriver {
  private readonly refusalState = { logged: false };
  private refuse(query: any): void {
    const site = findMisplacedReadableIds(query?.where, false);
    if (site) throw refuseReadableIdsOnce('driver-e5-refusing', site, undefined, this.refusalState, 'this test driver compiles no subquery');
  }
  override async find(object: string, query: any, options?: any) {
    this.refuse(query);
    return super.find(object, query, options);
  }
  override async count(object: string, query?: any, options?: any) {
    this.refuse(query);
    return super.count(object, query, options);
  }
}

describe('[ADR-0139 D3] on a driver that refuses the leaf, the read fails and says why', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;

  beforeAll(async () => {
    ({ kernel, engine } = await bootKernel(new RefusingDriver({ filename: ':memory:' })));
    engine.registry.registerObject(objectOf(DOC) as any, HARNESS_PACKAGE);
    await engine.syncSchemas();
    // A real `single` install's Default Organization: the system writes below
    // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
    await installDefaultOrganization(engine);
    await engine.insert(DOC, { name: 'one', owner: MEMBER_A.userId }, { context: SYS });
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  it('control: the rows are there, and a system read is served them', async () => {
    expect((await engine.find(ACTIVITY, { context: SYS })).length).toBeGreaterThan(0);
    expect((await engine.find(LEDGER, { context: SYS })).length).toBeGreaterThan(0);
  });

  for (const object of [ACTIVITY, LEDGER]) {
    it(`${object}: a member’s list and total are refused with D3’s envelope — never served as the deny-all sentinel`, async () => {
      for (const read of [
        () => engine.find(object, { context: MEMBER_A }),
        () => engine.count(object, {}, { context: MEMBER_A }),
      ]) {
        const outcome = await read().then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
        expect(outcome).toHaveProperty('error');
        const error = (outcome as { error: any }).error;
        expect({ code: error.code, status: error.status }).toEqual({ code: 'INTERNAL_ERROR', status: 500 });
        expect(String(error.message)).toContain('[driver-e5-refusing]');
      }
    });
  }
});
