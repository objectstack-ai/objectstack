// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 E7] The `sys_attachment` read gate on the LEAF path, through a
 * real engine and a real SQL driver: one `ReadableIds` leaf per parent object,
 * no pre-scan, so a broad read of `sys_attachment` is served every row the
 * caller may read, with a true total, past the old 2,000-row window — a
 * delegated caller's included, with its delegator intersection (D5.1, as
 * amended) — and D5's two remaining classes still read through the bounded
 * probe, by name.
 *
 * ## Why a real engine and a real driver
 *
 * The leaf is composed by the engine at its executor boundary (ADR-0139 D2)
 * and evaluated by the driver as one subquery against the parent's table (D3).
 * Neither half exists in a stand-in engine, so what the gate emits is only
 * measured here: `ObjectQLPlugin` wires the security service into the
 * composition, the rows are stored by `SqlDriver` (sqlite `:memory:`), and
 * every read goes through the real middleware chain. The gate is installed
 * exactly as `StorageServicePlugin` installs it, with the security service
 * resolved per read.
 *
 * ## The one stand-in, and why it is the smallest honest one
 *
 * plugin-security. A leaf is composed from the security service's
 * `canReadObject` and `getReadFilter`; a probe reads the parent as the caller
 * through the engine middleware. The stand-in keeps those two answers in
 * parity (`getReadFilter`'s contract: "the same filter the engine middleware
 * ANDs into every find"): one rule per parent object, served both as
 * `getReadFilter` and by one GLOBAL engine middleware — global as
 * plugin-security's is, so it narrows no object by name and makes no parent
 * one of D5's middleware-gated class:
 *
 *  - `e7_doc`: a member reads the records it owns; the admin reads them all;
 *    a delegated caller (`onBehalfOf`) reads the INTERSECTION of its own leg
 *    and its delegator's (ADR-0090 D10, as plugin-security answers both
 *    halves for that context), and the delegator's leg withholds a few of
 *    the member's records;
 *  - `e7_vault`: no member may read it (`canReadObject` false; a direct read
 *    is refused and the refusal recorded); the admin may;
 *  - every other object: every caller reads every record.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, findMisplacedReadableIds, refuseReadableIdsOnce, resolveReadableParentIds } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysAttachment } from '@objectstack/platform-objects';
import type { ISecurityService } from '@objectstack/spec/contracts';
import { installAttachmentReadVisibility } from './attachment-access-hooks.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const ATTACHMENT = 'sys_attachment';
/** Owner-scoped: a member reads its own records. */
const DOC = 'e7_doc';
/** No member may read it. */
const VAULT = 'e7_vault';
/** Narrowed by an object-scoped read middleware: D5's second class. */
const GATED = 'e7_gated';
/** Bound to another datasource: D5's third class. */
const FAR = 'e7_far';
const HARNESS_PACKAGE = 'com.objectstack.service.storage.test.attachment-leaf';

/** The bounded probe's window (`READ_SCAN_LIMIT` in attachment-access-hooks.ts). Mirrored, not imported. */
const SCAN_LIMIT = 2_000;

const SYS = { isSystem: true } as const;
const MEMBER_A = { userId: 'u_a', tenantId: 'org_1', positions: ['org_member'] };
const MEMBER_B = { userId: 'u_b', tenantId: 'org_1', positions: ['org_member'] };
const ADMIN = { userId: 'u_admin', tenantId: 'org_1', positions: ['org_admin'] };
const DELEGATED_A = { ...MEMBER_A, onBehalfOf: { userId: 'u_delegator' } };
/** The delegator's own leg on `e7_doc` admits every record but these (by name). */
const WITHHELD_FROM_DELEGATOR = ['a0', 'a1', 'a2'];

/** Past the 2,000-row candidate window the leaf replaces. */
const DOCS_OF_A = 2_300;
const DOCS_OF_B = 300;
const BATCH = 200;

const READ_OPS = new Set(['find', 'findOne', 'count', 'aggregate']);
const isAdmin = (context: any) => context?.userId === ADMIN.userId;

type Row = Record<string, any>;

function readScopeOf(object: string, context: any): Record<string, unknown> | undefined {
  if (context?.isSystem || isAdmin(context)) return undefined;
  if (object !== DOC) return undefined;
  const own = { owner: context?.userId ?? '__nobody__' };
  // ADR-0090 D10: a delegated caller's scope is its own leg AND its delegator's.
  return context?.onBehalfOf?.userId ? { $and: [own, { name: { $nin: WITHHELD_FROM_DELEGATOR } }] } : own;
}
const mayReadObject = (object: string, context: any) => context?.isSystem || object !== VAULT || isAdmin(context);

/** Reads of a parent object as a caller (not the system): the probe's footprint. */
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

const sqlite = () => new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });

class WarehouseDriver extends SqlDriver {
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

const silent = { info() {}, warn() {}, debug() {} };

async function bootKernel(driver: SqlDriver) {
  const kernel = new ObjectKernel({ logger: { level: 'silent' } });
  await kernel.use(new ObjectQLPlugin());
  await kernel.use({
    name: 'test.security-stand-in',
    version: '0.0.0',
    init: async (ctx: any) => ctx.registerService('security', security),
    start: async () => {},
  } as any);
  await kernel.bootstrap();
  const engine = kernel.getService<ObjectQL>('objectql');
  await driver.connect();
  engine.registerDriver(driver as any, true);
  engine.registry.registerObject(SysAttachment as any, HARNESS_PACKAGE);
  return { kernel, engine };
}

/** plugin-security's middleware, as the stand-in plays it: global, the same rule as `getReadFilter`. */
function installSecurityMiddleware(engine: ObjectQL): void {
  engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
    if (READ_OPS.has(op.operation) && op.context && !op.context.isSystem && op.object !== ATTACHMENT) {
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

async function insertInBatches(engine: ObjectQL, object: string, rows: Row[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const made = await engine.insert(object, rows.slice(i, i + BATCH) as any, { context: SYS });
    out.push(...(made as unknown as Row[]));
  }
  return out;
}

const attachmentTo = (parentObject: string, parentId: unknown, name = 'f.txt') => ({
  parent_object: parentObject,
  parent_id: String(parentId),
  file_id: 'file_shared',
  file_name: name,
});

describe('[ADR-0139 E7] the attachment read gate on the leaf path', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  /** The WHERE each gated read reached the driver boundary with. */
  const seenWhere: unknown[] = [];
  const ids: Record<string, string> = {};

  /** Ground truth of who may read which attachment, judged by the stand-in's own rules. */
  const truth = async (reader: any): Promise<string[]> => {
    const atRest: Row[] = await engine.find(ATTACHMENT, { limit: 100_000, context: SYS });
    const live = new Map<string, Map<string, Row>>();
    for (const parent of [DOC, VAULT, GATED, FAR]) {
      const records: Row[] = await engine.find(parent, { limit: 100_000, context: SYS });
      live.set(parent, new Map(records.map((r) => [String(r.id), r])));
    }
    return atRest
      .filter((row) => {
        const parent = live.get(row.parent_object)?.get(String(row.parent_id));
        if (!parent) return false;
        if (isAdmin(reader)) return true;
        if (row.parent_object === VAULT) return false;
        if (row.parent_object === DOC && reader?.onBehalfOf?.userId && WITHHELD_FROM_DELEGATOR.includes(parent.name)) return false;
        if (row.parent_object === DOC || row.parent_object === GATED) return parent.owner === reader.userId;
        return true;
      })
      .map((r) => String(r.id))
      .sort();
  };
  const served = async (context: any, extra: Record<string, unknown> = {}) =>
    ((await engine.find(ATTACHMENT, { limit: 100_000, ...extra, context })) as Row[]).map((r) => String(r.id)).sort();

  beforeAll(async () => {
    ({ kernel, engine } = await bootKernel(sqlite()));
    const warehouse = new WarehouseDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await warehouse.connect();
    engine.registerDriver(warehouse as any);
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
    // The gate, as StorageServicePlugin installs it: the security service resolved per read.
    installAttachmentReadVisibility(engine as any, silent, () => kernel.getService<ISecurityService>('security'));
    // Registered after the gate, so it sees each gated read's WHERE as the gate left it.
    engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
      if (READ_OPS.has(op.operation) && op.context && !op.context.isSystem) seenWhere.push(op.ast?.where);
      return next();
    }, { object: ATTACHMENT });

    // The parents, then one attachment per parent record.
    const docs: Row[] = [];
    for (let i = 0; i < DOCS_OF_A; i++) docs.push({ name: `a${i}`, owner: MEMBER_A.userId });
    for (let i = 0; i < DOCS_OF_B; i++) docs.push({ name: `b${i}`, owner: MEMBER_B.userId });
    const madeDocs = await insertInBatches(engine, DOC, docs);
    await insertInBatches(engine, ATTACHMENT, madeDocs.map((d) => attachmentTo(DOC, d.id)));
    ids.gone = (await engine.insert(DOC, { name: 'gone', owner: MEMBER_A.userId }, { context: SYS })).id;
    ids.goneAttachment = (await engine.insert(ATTACHMENT, attachmentTo(DOC, ids.gone), { context: SYS })).id;
    await engine.delete(DOC, { where: { id: ids.gone }, context: SYS });
    ids.vault = (await engine.insert(VAULT, { name: 'vault' }, { context: SYS })).id;
    ids.vaultAttachment = (await engine.insert(ATTACHMENT, attachmentTo(VAULT, ids.vault), { context: SYS })).id;
    ids.gatedA = (await engine.insert(GATED, { name: 'gated a', owner: MEMBER_A.userId }, { context: SYS })).id;
    ids.gatedB = (await engine.insert(GATED, { name: 'gated b', owner: MEMBER_B.userId }, { context: SYS })).id;
    ids.gatedAttachmentA = (await engine.insert(ATTACHMENT, attachmentTo(GATED, ids.gatedA), { context: SYS })).id;
    ids.gatedAttachmentB = (await engine.insert(ATTACHMENT, attachmentTo(GATED, ids.gatedB), { context: SYS })).id;
    ids.far = (await engine.insert(FAR, { name: 'far' }, { context: SYS })).id;
    ids.farAttachment = (await engine.insert(ATTACHMENT, attachmentTo(FAR, ids.far), { context: SYS })).id;
    // Rows naming no readable parent: a dangling id, an object the registry does not hold, the gated object itself.
    ids.dangling = (await engine.insert(ATTACHMENT, attachmentTo(DOC, 'no_such_doc'), { context: SYS })).id;
    ids.unregistered = (await engine.insert(ATTACHMENT, attachmentTo('e7_nowhere', 'x1'), { context: SYS })).id;
    ids.selfRef = (await engine.insert(ATTACHMENT, attachmentTo(ATTACHMENT, ids.dangling), { context: SYS })).id;
  }, 180_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  it('control: the fixture is past the window, for the member and in total', async () => {
    const atRest: Row[] = await engine.find(ATTACHMENT, { limit: 100_000, context: SYS });
    expect(atRest.length).toBeGreaterThan(SCAN_LIMIT);
    expect((await truth(MEMBER_A)).length).toBeGreaterThan(SCAN_LIMIT);
    expect((await truth(MEMBER_A)).length).toBe(DOCS_OF_A + 1 + 1); // own docs, own gated, the far one
  });

  it('a member is served every attachment it may read past the old window, and the total agrees', async () => {
    const expected = await truth(MEMBER_A);
    expect(await served(MEMBER_A)).toEqual(expected);
    expect(await engine.count(ATTACHMENT, {}, { context: MEMBER_A })).toBe(expected.length);
    const expectedB = await truth(MEMBER_B);
    expect(await served(MEMBER_B)).toEqual(expectedB);
    expect(await engine.count(ATTACHMENT, {}, { context: MEMBER_B })).toBe(expectedB.length);
  });

  it('an administrator’s page of 20 is 20 rows over a true total, not the window', async () => {
    const page: Row[] = await engine.find(ATTACHMENT, { limit: 20, context: ADMIN });
    expect(page).toHaveLength(20);
    const total = await engine.count(ATTACHMENT, {}, { context: ADMIN });
    expect(total).toBe((await truth(ADMIN)).length);
    expect(total).toBeGreaterThan(SCAN_LIMIT);
  });

  it('no row is served whose parent the reader may not read, that no longer exists, or that names none', async () => {
    const hidden = [ids.vaultAttachment, ids.goneAttachment, ids.dangling, ids.unregistered, ids.selfRef, ids.gatedAttachmentB];
    const asA = new Set(await served(MEMBER_A));
    for (const id of hidden) expect(asA.has(String(id))).toBe(false);
    const asAdmin = new Set(await served(ADMIN));
    expect(asAdmin.has(String(ids.vaultAttachment))).toBe(true);
    for (const id of [ids.goneAttachment, ids.dangling, ids.unregistered, ids.selfRef]) expect(asAdmin.has(String(id))).toBe(false);
  });

  it('the leaf reads no parent as the caller: a member’s broad read logs no refusal and reads neither the doc nor the vault', async () => {
    callerReads.length = 0;
    refusals.length = 0;
    await served(MEMBER_A);
    await engine.count(ATTACHMENT, {}, { context: MEMBER_A });
    expect(refusals).toEqual([]);
    expect(callerReads.filter((r) => r.object === DOC || r.object === VAULT)).toEqual([]);
  });

  it('one leaf per enumerated parent; D5’s middleware-gated and federated parents are probed beside them', async () => {
    seenWhere.length = 0;
    await served(MEMBER_A);
    const branches: any[] = (seenWhere[0] as any).$or;
    const leaves = branches.filter((b) => b?.parent_id?.$in && !Array.isArray(b.parent_id.$in)).map((b) => b.parent_object);
    expect(leaves).toEqual(expect.arrayContaining([DOC, VAULT]));
    expect(leaves).not.toContain(GATED);
    expect(leaves).not.toContain(FAR);
    expect(leaves).not.toContain(ATTACHMENT);
    const probed = branches.filter((b) => Array.isArray(b?.parent_id?.$in));
    expect(probed).toEqual(
      expect.arrayContaining([
        { parent_object: GATED, parent_id: { $in: [String(ids.gatedA)] } },
        { parent_object: FAR, parent_id: { $in: [String(ids.far)] } },
      ]),
    );
    expect(probed).toHaveLength(2);
  });

  it('D5.1, as amended: a delegated caller reads through the leaf — every attachment its delegator intersection admits, past the window, a true total', async () => {
    seenWhere.length = 0;
    const rows = await served(DELEGATED_A);
    const branches: any[] = (seenWhere[0] as any).$or;
    const leaves = branches.filter((b) => b?.parent_id?.$in && !Array.isArray(b.parent_id.$in)).map((b) => b.parent_object);
    expect(leaves).toEqual(expect.arrayContaining([DOC, VAULT]));
    expect(leaves).not.toContain(GATED);
    expect(leaves).not.toContain(FAR);
    // D5.2 and D5.3 keep the probe, read with the delegated context.
    const probed = branches.filter((b) => Array.isArray(b?.parent_id?.$in));
    expect(probed).toEqual(
      expect.arrayContaining([
        { parent_object: GATED, parent_id: { $in: [String(ids.gatedA)] } },
        { parent_object: FAR, parent_id: { $in: [String(ids.far)] } },
      ]),
    );
    expect(probed).toHaveLength(2);
    const expected = await truth(DELEGATED_A);
    expect(expected.length).toBeGreaterThan(SCAN_LIMIT);
    expect(rows).toEqual(expected);
    expect(await engine.count(ATTACHMENT, {}, { context: DELEGATED_A })).toBe(rows.length);
    // The intersection, never the principal's leg alone: exactly the attachments on the records the delegator is withheld go.
    const withheldDocs = ((await engine.find(DOC, { where: { name: { $in: WITHHELD_FROM_DELEGATOR } }, context: SYS })) as Row[])
      .map((d) => String(d.id));
    const onWithheld = ((await engine.find(ATTACHMENT, { where: { parent_object: DOC, parent_id: { $in: withheldDocs } }, context: SYS })) as Row[])
      .map((r) => String(r.id))
      .sort();
    expect(onWithheld).toHaveLength(WITHHELD_FROM_DELEGATOR.length);
    const asMember = new Set(await served(MEMBER_A));
    expect([...asMember].filter((id) => !rows.includes(id)).sort()).toEqual(onWithheld);
    expect(rows.every((id) => asMember.has(id))).toBe(true);
  });

  it('D5.1, as amended: parity with the probe — the leaf serves a delegated caller exactly the attachments the probe’s own readability answer admits, unbounded', async () => {
    // The probe's answer is `resolveReadableParentIds` (one caller-scoped read
    // per parent object, through the engine middleware chain), asked for every
    // parent pair at rest, so no window cuts it.
    const atRest: Row[] = await engine.find(ATTACHMENT, { limit: 100_000, context: SYS });
    const pairs = new Map<string, Set<string>>();
    for (const row of atRest) {
      if (![DOC, VAULT, GATED, FAR].includes(row.parent_object)) continue;
      if (!pairs.has(row.parent_object)) pairs.set(row.parent_object, new Set());
      pairs.get(row.parent_object)!.add(String(row.parent_id));
    }
    const readable = await resolveReadableParentIds(engine as any, DELEGATED_A, pairs);
    const admittedByProbe = atRest
      .filter((row) => readable.get(row.parent_object)?.has(String(row.parent_id)) ?? false)
      .map((r) => String(r.id))
      .sort();
    expect(admittedByProbe.length).toBeGreaterThan(SCAN_LIMIT);
    expect(await served(DELEGATED_A)).toEqual(admittedByProbe);
  });

  it('[ADR-0139 O2] the bound case, recorded: rows at rest, served, total, branches and time', async () => {
    seenWhere.length = 0;
    const time = async (run: () => Promise<unknown>) => {
      const t0 = performance.now();
      await run();
      return Math.round((performance.now() - t0) * 10) / 10;
    };
    const reading = {
      rowsAtRest: (await engine.find(ATTACHMENT, { limit: 100_000, context: SYS })).length,
      memberTruth: (await truth(MEMBER_A)).length,
      memberServed: (await served(MEMBER_A)).length,
      memberTotal: await engine.count(ATTACHMENT, {}, { context: MEMBER_A }),
      adminTotal: await engine.count(ATTACHMENT, {}, { context: ADMIN }),
      ms: {
        memberFind: await time(() => served(MEMBER_A)),
        memberCount: await time(() => engine.count(ATTACHMENT, {}, { context: MEMBER_A })),
        adminTop20: await time(() => engine.find(ATTACHMENT, { limit: 20, context: ADMIN })),
        delegatedFind: await time(() => served(DELEGATED_A)),
      },
      branches: 0,
      leaves: 0,
    };
    const where = seenWhere[0] as any;
    reading.branches = where?.$or?.length ?? 1;
    reading.leaves = (where?.$or ?? [where]).filter((b: any) => b?.parent_id?.$in && !Array.isArray(b.parent_id.$in)).length;
    // A reading, never a verdict on a duration (AGENTS.md).
    console.log(`E7-ATTACHMENT-READING ${JSON.stringify(reading)}`);
    expect(reading.rowsAtRest).toBeGreaterThan(SCAN_LIMIT);
  });
});

/** A driver that does not compile the composed leaf, refusing it with D3's envelope, as `driver-mongodb` does. */
class RefusingDriver extends SqlDriver {
  private readonly refusalState = { logged: false };
  private refuse(query: any): void {
    const site = findMisplacedReadableIds(query?.where, false);
    if (site) throw refuseReadableIdsOnce('driver-e7-refusing', site, undefined, this.refusalState, 'this test driver compiles no subquery');
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

describe('[ADR-0139 D3] on a driver that refuses the leaf, the attachment read fails and says why', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;

  beforeAll(async () => {
    ({ kernel, engine } = await bootKernel(new RefusingDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })));
    engine.registry.registerObject(objectOf(DOC) as any, HARNESS_PACKAGE);
    await engine.syncSchemas();
    // A real `single` install's Default Organization: the system writes below
    // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
    await installDefaultOrganization(engine);
    installAttachmentReadVisibility(engine as any, silent, () => kernel.getService<ISecurityService>('security'));
    const doc = await engine.insert(DOC, { name: 'one', owner: MEMBER_A.userId }, { context: SYS });
    await engine.insert(ATTACHMENT, attachmentTo(DOC, doc.id), { context: SYS });
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  it('control: the row is there, and a system read is served it', async () => {
    expect((await engine.find(ATTACHMENT, { context: SYS })).length).toBe(1);
  });

  it('a member’s list and total are refused with D3’s envelope — never served as the deny-all sentinel', async () => {
    for (const read of [
      () => engine.find(ATTACHMENT, { context: MEMBER_A }),
      () => engine.count(ATTACHMENT, {}, { context: MEMBER_A }),
    ]) {
      const outcome = await read().then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      expect(outcome).toHaveProperty('error');
      const error = (outcome as { error: any }).error;
      expect({ code: error.code, status: error.status }).toEqual({ code: 'INTERNAL_ERROR', status: 500 });
      expect(String(error.message)).toContain('[driver-e7-refusing]');
    }
  });
});
