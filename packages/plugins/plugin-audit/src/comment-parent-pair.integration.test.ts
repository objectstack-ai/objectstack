// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 E7] The comment-thread read gate on the LEAF path, over
 * `sys_comment`'s writer-stamped parent pair, through a real engine and a real
 * SQL driver — and the pair's writers and its stored-row backfill.
 *
 * What is measured here and nowhere else: the leaf is composed by the engine
 * at its executor boundary (ADR-0139 D2) and evaluated by the driver as one
 * subquery against the parent's table (D3), so a broad comment read is served
 * every comment the caller may read, with a true total, past the 2,000-row
 * window the thread probe had — a delegated caller's included, with its
 * delegator intersection (D5.1, as amended); D5's two remaining classes still
 * read through the bounded probe, by name; and a row the backfill has not
 * reached is probed by its thread, never leafed.
 *
 * The security stand-in is E5's (`parent-record-read-leaf.integration.test.ts`,
 * whose header says why it is the smallest honest one): one rule per parent
 * object, served as `getReadFilter` and by one GLOBAL engine middleware.
 *
 *  - `e7_doc`: a member reads the records it owns; the admin reads them all;
 *    a delegated caller reads the INTERSECTION of its own leg and its
 *    delegator's (ADR-0090 D10), whose leg withholds a few of the member's;
 *  - `e7_vault`: no member may read it; the admin may;
 *  - `e7_gated`: narrowed by an object-scoped read middleware (D5.2);
 *  - `e7_far`: bound to another datasource (D5.3).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectKernel, findMisplacedReadableIds, refuseReadableIdsOnce, resolveReadableParentIds } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { AuditPlugin } from './audit-plugin.js';
import { parseCommentThreadId } from './comment-access-hooks.js';
import { backfillCommentParentPair } from './comment-parent-pair-backfill.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const COMMENT = 'sys_comment';
const REACTION = 'sys_comment_reaction';
const DOC = 'e7_doc';
const VAULT = 'e7_vault';
const GATED = 'e7_gated';
const FAR = 'e7_far';
const HARNESS_PACKAGE = 'com.objectstack.audit.test.comment-parent-pair';

/** The thread probe's window this card lifts. */
const WINDOW = 2_000;

const SYS = { isSystem: true } as const;
const MEMBER_A = { userId: 'u_a', tenantId: 'org_1', positions: ['org_member'] };
const MEMBER_B = { userId: 'u_b', tenantId: 'org_1', positions: ['org_member'] };
const ADMIN = { userId: 'u_admin', tenantId: 'org_1', positions: ['org_admin'] };
const DELEGATED_A = { ...MEMBER_A, onBehalfOf: { userId: 'u_delegator' } };
/** The delegator's own leg on `e7_doc` admits every record but these (by name). */
const WITHHELD_FROM_DELEGATOR = ['a0', 'a1', 'a2'];

/**
 * Past the 2,000-row candidate window the leaf replaces: 2,300 comments member
 * A may read, 300 member B may. The window was over COMMENT rows (the thread
 * probe's candidate pre-scan reads `sys_comment`, `READ_SCAN_LIMIT` in
 * `comment-access-hooks.ts`), never over parent records, so the comments sit
 * ten to a doc. [#23181] One comment per doc wrote 2,600 docs, and each doc
 * write pays the CRUD mirror's ledger row and activity row, which nothing in
 * this file reads: about 6 s of the file's clock, against well under 1 s for
 * the comments themselves.
 */
const COMMENTS_PER_DOC = 10;
const DOCS_OF_A = 230;
const DOCS_OF_B = 30;
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

function installSecurityMiddleware(engine: ObjectQL): void {
  engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
    if (READ_OPS.has(op.operation) && op.context && !op.context.isSystem) {
      if (!mayReadObject(op.object, op.context)) {
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

async function insertInBatches(engine: ObjectQL, object: string, rows: Row[]): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const out = await engine.insert(object, rows.slice(i, i + BATCH) as any, { context: SYS });
    for (const r of (Array.isArray(out) ? out : [out]) as Row[]) ids.push(String(r.id));
  }
  return ids;
}

const commentOn = (object: string, id: string, body: string): Row => ({
  thread_id: `${object}:${id}`,
  body,
  author_id: 'u_fixture',
});

// [#23181] Pay the first kernel boot at module scope, never in a hook: vitest
// clocks a hook as it clocks a test, and the first boot is the slow one. The
// throwaway kernel registers no fixture object, writes nothing and is shut down
// before any hook runs.
await (await bootKernel(new SqliteWasmDriver({ filename: ':memory:' }))).kernel.shutdown();

describe('[ADR-0139 E7] the comment-thread read gate over the stamped parent pair', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  let driver: SqliteWasmDriver;
  const seenWhere: unknown[] = [];
  const ids: Record<string, string> = {};

  /** Ground truth from each row's THREAD (never its pair), judged by the stand-in's rules. */
  const truth = async (reader: any): Promise<string[]> => {
    const atRest: Row[] = await engine.find(COMMENT, { limit: 100_000, context: SYS });
    const live = new Map<string, Map<string, Row>>();
    for (const parent of [DOC, VAULT, GATED, FAR]) {
      const records: Row[] = await engine.find(parent, { limit: 100_000, context: SYS });
      live.set(parent, new Map(records.map((r) => [String(r.id), r])));
    }
    return atRest
      .filter((row) => {
        const target = parseCommentThreadId(row.thread_id);
        const parent = target && live.get(target.object)?.get(target.recordId);
        if (!target || !parent) return false;
        if (isAdmin(reader)) return true;
        if (target.object === VAULT) return false;
        if (target.object === DOC && reader?.onBehalfOf?.userId && WITHHELD_FROM_DELEGATOR.includes(parent.name)) return false;
        if (target.object === DOC || target.object === GATED) return parent.owner === reader.userId;
        return true;
      })
      .map((r) => String(r.id))
      .sort();
  };
  const served = async (context: any, extra: Record<string, unknown> = {}) =>
    ((await engine.find(COMMENT, { limit: 100_000, ...extra, context })) as Row[]).map((r) => String(r.id)).sort();
  const atRest = async (id: string): Promise<Row> => (await engine.findOne(COMMENT, { where: { id }, context: SYS })) as Row;

  beforeAll(async () => {
    ({ kernel, engine } = await bootKernel((driver = new SqliteWasmDriver({ filename: ':memory:' }))));
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
    engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
      if (READ_OPS.has(op.operation) && op.context && !op.context.isSystem && !isAdmin(op.context) && op.ast) {
        const mine = { owner: op.context.userId ?? '__nobody__' };
        op.ast.where = op.ast.where ? { $and: [op.ast.where, mine] } : mine;
      }
      return next();
    }, { object: GATED });
    // Registered last, so it sees each comment read's WHERE as the gate left it.
    engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
      if (READ_OPS.has(op.operation) && op.context && !op.context.isSystem) seenWhere.push(op.ast?.where);
      return next();
    }, { object: COMMENT });

    const docs: Row[] = [];
    for (let i = 0; i < DOCS_OF_A; i++) docs.push({ name: `a${i}`, owner: MEMBER_A.userId });
    for (let i = 0; i < DOCS_OF_B; i++) docs.push({ name: `b${i}`, owner: MEMBER_B.userId });
    const docIds = await insertInBatches(engine, DOC, docs);
    await insertInBatches(engine, COMMENT, docIds.flatMap((id, i) =>
      Array.from({ length: COMMENTS_PER_DOC }, (_, k) => commentOn(DOC, id, `c${i * COMMENTS_PER_DOC + k}`))));

    ids.gone = String((await engine.insert(DOC, { name: 'gone', owner: MEMBER_A.userId }, { context: SYS })).id);
    ids.vault = String((await engine.insert(VAULT, { name: 'vault' }, { context: SYS })).id);
    ids.gatedA = String((await engine.insert(GATED, { name: 'gated a', owner: MEMBER_A.userId }, { context: SYS })).id);
    ids.gatedB = String((await engine.insert(GATED, { name: 'gated b', owner: MEMBER_B.userId }, { context: SYS })).id);
    ids.far = String((await engine.insert(FAR, { name: 'far' }, { context: SYS })).id);
    for (const [key, object, id] of [
      ['onGone', DOC, ids.gone],
      ['onVault', VAULT, ids.vault],
      ['onGatedA', GATED, ids.gatedA],
      ['onGatedB', GATED, ids.gatedB],
      ['onFar', FAR, ids.far],
    ] as const) {
      ids[key] = String((await engine.insert(COMMENT, commentOn(object, id, key), { context: SYS })).id);
    }
    await engine.delete(DOC, { where: { id: ids.gone }, context: SYS });
    // A writer sending its own pair, and a thread that names no record.
    ids.forged = String((await engine.insert(COMMENT, {
      ...commentOn(DOC, docIds[0], 'forged'), object_name: VAULT, record_id: ids.vault,
    }, { context: SYS })).id);
    ids.dangling = String((await engine.insert(COMMENT, { thread_id: 'watercooler', body: 'x', author_id: 'u_fixture' }, { context: SYS })).id);
    ids.firstDoc = docIds[0];
    ids.lastDocOfB = docIds[docIds.length - 1];
  }, 180_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  it('control: the fixture is past the window, and every writer stamped the pair from the thread', async () => {
    expect((await truth(MEMBER_A)).length).toBeGreaterThan(WINDOW);
    const rows: Row[] = await engine.find(COMMENT, { limit: 100_000, context: SYS });
    for (const row of rows) {
      const target = parseCommentThreadId(row.thread_id);
      expect({ object_name: row.object_name ?? null, record_id: row.record_id ?? null }, String(row.id)).toEqual(
        target ? { object_name: target.object, record_id: target.recordId } : { object_name: null, record_id: null },
      );
    }
    // The writer's own pair never lands: the stamp is assigned over it.
    expect(await atRest(ids.forged)).toMatchObject({ object_name: DOC, record_id: ids.firstDoc });
    expect(await atRest(ids.dangling)).toMatchObject({ object_name: null, record_id: null });
  });

  it('a member is served every comment it may read past the old window, and count equals the rows served', async () => {
    for (const member of [MEMBER_A, MEMBER_B]) {
      const expected = await truth(member);
      const rows = await served(member);
      expect(rows).toEqual(expected);
      expect(await engine.count(COMMENT, {}, { context: member })).toBe(rows.length);
    }
  });

  it('[O2] the bound case, recorded: rows at rest, the member served and counted, the administrator total', async () => {
    const reading = {
      rowsAtRest: (await engine.find(COMMENT, { limit: 100_000, context: SYS })).length,
      memberTruth: (await truth(MEMBER_A)).length,
      memberServed: (await served(MEMBER_A)).length,
      memberTotal: await engine.count(COMMENT, {}, { context: MEMBER_A }),
      adminTruth: (await truth(ADMIN)).length,
      adminTotal: await engine.count(COMMENT, {}, { context: ADMIN }),
    };
    // A reading, never a verdict on a duration (AGENTS.md).
    console.log(`E7-COMMENT-READING ${JSON.stringify(reading)}`);
    expect(reading.memberServed).toBe(reading.memberTruth);
    expect(reading.memberTotal).toBe(reading.memberServed);
    expect(reading.adminTotal).toBe(reading.adminTruth);
  });

  it('an administrator’s newest-20 read is served 20 rows and a true total, not the window', async () => {
    const page: Row[] = await engine.find(COMMENT, { orderBy: [{ field: 'created_at', order: 'desc' }], limit: 20, context: ADMIN });
    expect(page).toHaveLength(20);
    const total = await engine.count(COMMENT, {}, { context: ADMIN });
    expect(total).toBe((await truth(ADMIN)).length);
    expect(total).toBeGreaterThan(WINDOW);
  });

  it('an unreadable parent’s comments stay hidden: the vault, a deleted record, another member’s, and a thread naming no record', async () => {
    const rows = new Set(await served(MEMBER_A));
    for (const key of ['onVault', 'onGone', 'onGatedB', 'dangling']) expect(rows.has(ids[key]), key).toBe(false);
    expect(rows.has(ids.onGatedA)).toBe(true);
    expect(rows.has(ids.onFar)).toBe(true);
    const admin = new Set(await served(ADMIN));
    expect(admin.has(ids.onVault)).toBe(true);
    expect(admin.has(ids.onGone)).toBe(false);
    expect(admin.has(ids.dangling)).toBe(false);
    // Scoped to one unreadable thread, a member is served nothing and counts nothing.
    const where = { thread_id: `${VAULT}:${ids.vault}` };
    expect(await engine.find(COMMENT, { where, context: MEMBER_A })).toEqual([]);
    expect(await engine.count(COMMENT, { where }, { context: MEMBER_A })).toBe(0);
  });

  it('one leaf per enumerated parent; D5’s middleware-gated and federated parents are probed beside them', async () => {
    seenWhere.length = 0;
    await served(MEMBER_A);
    const where = seenWhere[0] as any;
    const branches: any[] = JSON.stringify(where).includes('"$or"') ? findOr(where) : [where];
    const stampedLeaves = branches.flatMap((b) => (b?.$or ? b.$or : [b]));
    const leaves = stampedLeaves.filter((b) => b?.record_id?.$in && !Array.isArray(b.record_id.$in)).map((b) => b.object_name);
    expect(leaves).toEqual(expect.arrayContaining([DOC, VAULT]));
    for (const probed of [GATED, FAR, COMMENT, REACTION]) expect(leaves, probed).not.toContain(probed);
    expect(stampedLeaves).toEqual(expect.arrayContaining([
      { object_name: GATED, record_id: { $in: [ids.gatedA] } },
      { object_name: FAR, record_id: { $in: [ids.far] } },
    ]));
  });

  it('D5.1, as amended: a delegated caller reads through the leaf — every comment its delegator intersection admits, past the window, a true total', async () => {
    seenWhere.length = 0;
    const rows = await served(DELEGATED_A);
    const stampedLeaves = findOr(seenWhere[0]).flatMap((b) => (b?.$or ? b.$or : [b]));
    const leaves = stampedLeaves.filter((b) => b?.record_id?.$in && !Array.isArray(b.record_id.$in)).map((b) => b.object_name);
    expect(leaves).toEqual(expect.arrayContaining([DOC, VAULT]));
    for (const probed of [GATED, FAR]) expect(leaves, probed).not.toContain(probed);
    // D5.2 and D5.3 keep the probe, read with the delegated context.
    expect(stampedLeaves).toEqual(expect.arrayContaining([
      { object_name: GATED, record_id: { $in: [ids.gatedA] } },
      { object_name: FAR, record_id: { $in: [ids.far] } },
    ]));
    const expected = await truth(DELEGATED_A);
    expect(expected.length).toBeGreaterThan(WINDOW);
    expect(rows).toEqual(expected);
    expect(await engine.count(COMMENT, {}, { context: DELEGATED_A })).toBe(rows.length);
    // The intersection, never the principal's leg alone: exactly the comments on the records the delegator is withheld go.
    const withheldThreads = ((await engine.find(DOC, { where: { name: { $in: WITHHELD_FROM_DELEGATOR } }, context: SYS })) as Row[])
      .map((d) => `${DOC}:${d.id}`);
    const onWithheld = ((await engine.find(COMMENT, { where: { thread_id: { $in: withheldThreads } }, context: SYS })) as Row[])
      .map((r) => String(r.id))
      .sort();
    expect(onWithheld.length).toBeGreaterThanOrEqual(WITHHELD_FROM_DELEGATOR.length);
    const asMember = new Set(await served(MEMBER_A));
    expect([...asMember].filter((id) => !rows.includes(id)).sort()).toEqual(onWithheld);
    expect(rows.every((id) => asMember.has(id))).toBe(true);
  });

  it('D5.1, as amended: parity with the probe — the leaf serves a delegated caller exactly the comments the probe’s own readability answer admits, unbounded', async () => {
    // The probe's answer is `resolveReadableParentIds` (one caller-scoped read
    // per parent object, through the engine middleware chain), asked for every
    // stamped pair at rest, so no window cuts it.
    const atRest: Row[] = await engine.find(COMMENT, { limit: 100_000, context: SYS });
    const pairs = new Map<string, Set<string>>();
    for (const row of atRest) {
      if (![DOC, VAULT, GATED, FAR].includes(row.object_name) || row.record_id == null) continue;
      if (!pairs.has(row.object_name)) pairs.set(row.object_name, new Set());
      pairs.get(row.object_name)!.add(String(row.record_id));
    }
    const readable = await resolveReadableParentIds(engine as any, DELEGATED_A, pairs);
    const admittedByProbe = atRest
      .filter((row) => readable.get(row.object_name)?.has(String(row.record_id)) ?? false)
      .map((r) => String(r.id))
      .sort();
    expect(admittedByProbe.length).toBeGreaterThan(WINDOW);
    expect(await served(DELEGATED_A)).toEqual(admittedByProbe);
  });

  it('a row the backfill has not reached is probed by its thread, never leafed — then the backfill stamps it', async () => {
    // The state after the upgrade, for three rows: no pair at rest.
    const firstComment = ((await engine.find(COMMENT, { where: { thread_id: `${DOC}:${ids.firstDoc}` }, limit: 1, context: SYS })) as Row[])[0];
    const rowIds = [String(firstComment.id), ids.onVault, ids.onGatedA];
    // Planted below the engine: every engine write of the pair is re-derived.
    for (const id of rowIds) await driver.update(COMMENT, id, { object_name: null, record_id: null });
    for (const id of rowIds) expect((await atRest(id)).object_name ?? null).toBeNull();

    seenWhere.length = 0;
    const rows = await served(MEMBER_A);
    expect(rows).toEqual(await truth(MEMBER_A));
    expect(rows).toContain(String(firstComment.id));
    expect(rows).not.toContain(ids.onVault);
    // The unstamped rows' branch: a literal thread list, only over rows with no pair.
    const probe = findOr(seenWhere[0]).find((b) => b?.object_name?.$null === true);
    expect(probe).toEqual({ object_name: { $null: true }, thread_id: { $in: expect.any(Array) } });
    expect([...probe.thread_id.$in].sort()).toEqual([`${DOC}:${ids.firstDoc}`, `${GATED}:${ids.gatedA}`].sort());
    expect(await engine.count(COMMENT, {}, { context: MEMBER_A })).toBe(rows.length);

    const report = await backfillCommentParentPair(engine as any, { info: vi.fn(), warn: vi.fn() }, { apply: true });
    expect(report).toEqual({ apply: true, scanned: 4, stamped: 3, unparented: 1, failures: 0 });
    seenWhere.length = 0;
    expect(await served(MEMBER_A)).toEqual(rows);
    expect(JSON.stringify(seenWhere[0])).not.toContain('"thread_id":{"$in"');
  });

  it('the re-point rule re-stamps the pair; a member’s own pair is never written', async () => {
    const [own, other] = ((await engine.find(DOC, { where: { owner: MEMBER_A.userId }, limit: 2, context: SYS })) as Row[]).map((r) => String(r.id));
    const created = await engine.insert(COMMENT, {
      thread_id: `${DOC}:${own}`, body: 'mine', author_id: 'spoofed', object_name: VAULT, record_id: ids.vault,
    }, { context: MEMBER_A });
    const id = String(created.id);
    expect(await atRest(id)).toMatchObject({ object_name: DOC, record_id: own, author_id: MEMBER_A.userId });

    await engine.update(COMMENT, { thread_id: `${DOC}:${other}` }, { where: { id }, context: MEMBER_A });
    expect(await atRest(id)).toMatchObject({ thread_id: `${DOC}:${other}`, object_name: DOC, record_id: other });

    // Naming the pair without a thread: the engine strips a member's readonly value.
    await engine.update(COMMENT, { object_name: VAULT, record_id: ids.vault, body: 'still mine' }, { where: { id }, context: MEMBER_A });
    expect(await atRest(id)).toMatchObject({ body: 'still mine', object_name: DOC, record_id: other });

    // ...and under `preserveAudit` (a REST historical import puts it on an
    // ordinary caller's write), where the engine's strip keeps a readonly
    // value, the stamp re-derives the pair from the row's own thread.
    await engine.update(COMMENT, { object_name: VAULT, record_id: ids.vault }, { where: { id }, context: { ...MEMBER_A, preserveAudit: true } });
    expect(await atRest(id)).toMatchObject({ thread_id: `${DOC}:${other}`, object_name: DOC, record_id: other });
    await engine.update(COMMENT, { record_id: ids.vault }, { where: { id }, context: { ...MEMBER_A, preserveAudit: true } });
    expect(await atRest(id)).toMatchObject({ object_name: DOC, record_id: other });
  });

  it('a SYSTEM multi-row update naming the pair over comments on different records is refused whole; over one thread it stores that thread\'s pair', async () => {
    const [d1, d2] = ((await engine.find(DOC, { limit: 2, context: SYS })) as Row[]).map((r) => String(r.id));
    const a = String((await engine.insert(COMMENT, commentOn(DOC, d1, 'multi a'), { context: SYS })).id);
    const b = String((await engine.insert(COMMENT, commentOn(DOC, d2, 'multi b'), { context: SYS })).id);
    const c = String((await engine.insert(COMMENT, commentOn(DOC, d1, 'multi c'), { context: SYS })).id);
    const outcome = await engine
      .update(COMMENT, { object_name: VAULT, record_id: ids.vault }, { multi: true, where: { id: { $in: [a, b] } }, context: SYS } as any)
      .then((value) => ({ value }), (error) => ({ error }));
    expect(outcome).toHaveProperty('error');
    const error = (outcome as { error: any }).error;
    expect({ code: error.code, status: error.status }).toEqual({ code: 'VALIDATION_ERROR', status: 400 });
    expect(await atRest(a)).toMatchObject({ object_name: DOC, record_id: d1 });
    expect(await atRest(b)).toMatchObject({ object_name: DOC, record_id: d2 });
    // Rows sharing one thread derive one pair: the write lands, and stores that pair.
    await engine.update(COMMENT, { object_name: VAULT, record_id: ids.vault }, { multi: true, where: { id: { $in: [a, c] } }, context: SYS } as any);
    expect(await atRest(a)).toMatchObject({ object_name: DOC, record_id: d1 });
    expect(await atRest(c)).toMatchObject({ object_name: DOC, record_id: d1 });
  });

  it('D5.2: the reaction gate keeps the bounded probe — a literal comment-id list, no leaf', async () => {
    const reactionWhere: unknown[] = [];
    engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
      if (READ_OPS.has(op.operation) && op.context && !op.context.isSystem) reactionWhere.push(op.ast?.where);
      return next();
    }, { object: REACTION });
    const own = ((await engine.find(COMMENT, { where: { thread_id: `${GATED}:${ids.gatedA}` }, context: SYS })) as Row[])[0];
    await engine.insert(REACTION, { comment_id: own.id, emoji: '👍', user_id: MEMBER_A.userId }, { context: SYS });
    await engine.insert(REACTION, { comment_id: ids.onVault, emoji: '👍', user_id: MEMBER_A.userId }, { context: SYS });
    const rows: Row[] = await engine.find(REACTION, { context: MEMBER_A });
    expect(rows.map((r) => String(r.comment_id))).toEqual([String(own.id)]);
    expect(reactionWhere[0]).toEqual({ comment_id: { $in: [own.id] } });
  });
});

/** The `$or` of the gate's predicate, wherever the caller's own WHERE put it. */
function findOr(where: any): any[] {
  if (where?.$or) return where.$or;
  for (const part of where?.$and ?? []) {
    const found = findOr(part);
    if (found.length) return found;
  }
  return [];
}

describe('[ADR-0139 E7] backfillCommentParentPair', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  let driver: SqliteWasmDriver;
  const rowIds: string[] = [];
  const stampedAt = new Map<string, unknown>();
  const logger = () => ({ info: vi.fn(), warn: vi.fn() });

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    ({ kernel, engine } = await bootKernel(driver));
    engine.registry.registerObject(objectOf(DOC) as any, HARNESS_PACKAGE);
    await engine.syncSchemas();
    // A real `single` install's Default Organization: the system writes below
    // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
    await installDefaultOrganization(engine);
    for (let i = 0; i < 5; i++) {
      const doc = String((await engine.insert(DOC, { name: `d${i}` }, { context: SYS })).id);
      rowIds.push(String((await engine.insert(COMMENT, commentOn(DOC, doc, `c${i}`), { context: SYS })).id));
    }
    rowIds.push(String((await engine.insert(COMMENT, { thread_id: 'free-form', body: 'x', author_id: 'u' }, { context: SYS })).id));
    // The state after the upgrade: every row at rest, unstamped, with an
    // updated_at of its own — planted below the engine, which re-derives any
    // pair an engine write names.
    for (const id of rowIds) {
      await driver.update(COMMENT, id, { object_name: null, record_id: null, updated_at: '2020-01-01T00:00:00.000Z' });
      stampedAt.set(id, (await engine.findOne(COMMENT, { where: { id }, context: SYS }) as Row).updated_at);
    }
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  const all = async () => (await engine.find(COMMENT, { orderBy: [{ field: 'id', order: 'asc' }], context: SYS })) as Row[];

  it('control: every row is unstamped', async () => {
    for (const row of await all()) expect(row.object_name ?? null, String(row.id)).toBeNull();
  });

  it('a dry run counts every unstamped row and writes none', async () => {
    const report = await backfillCommentParentPair(engine as any, logger(), { pageSize: 2 });
    expect(report).toEqual({ apply: false, scanned: 6, stamped: 5, unparented: 1, failures: 0 });
    for (const row of await all()) expect(row.object_name ?? null).toBeNull();
  });

  it('apply stamps each row from its thread, a page at a time, and keeps each row’s updated_at', async () => {
    const report = await backfillCommentParentPair(engine as any, logger(), { apply: true, pageSize: 2 });
    expect(report).toEqual({ apply: true, scanned: 6, stamped: 5, unparented: 1, failures: 0 });
    for (const row of await all()) {
      const target = parseCommentThreadId(row.thread_id);
      expect({ object_name: row.object_name ?? null, record_id: row.record_id ?? null }).toEqual(
        target ? { object_name: target.object, record_id: target.recordId } : { object_name: null, record_id: null },
      );
      expect(row.updated_at, String(row.id)).toEqual(stampedAt.get(String(row.id)));
      expect(row.is_edited ?? false).toBe(false);
    }
  });

  it('idempotent: a second run stamps nothing, and finds only the thread naming no record', async () => {
    const before = await all();
    const report = await backfillCommentParentPair(engine as any, logger(), { apply: true, pageSize: 2 });
    expect(report).toEqual({ apply: true, scanned: 1, stamped: 0, unparented: 1, failures: 0 });
    expect(await all()).toEqual(before);
  });

  it('a row re-pointed between the page read and the write keeps the re-pointed pair', async () => {
    const doc = String((await engine.insert(DOC, { name: 'race' }, { context: SYS })).id);
    const moved = String((await engine.insert(DOC, { name: 'race target' }, { context: SYS })).id);
    const id = String((await engine.insert(COMMENT, commentOn(DOC, doc, 'race'), { context: SYS })).id);
    await driver.update(COMMENT, id, { object_name: null, record_id: null });
    // The engine the backfill drives re-points the row right after reading the page.
    const racing = {
      find: async (...args: any[]) => {
        const page = await (engine.find as any)(...args);
        await engine.update(COMMENT, { id, thread_id: `${DOC}:${moved}` }, { context: SYS });
        return page;
      },
      update: (...args: any[]) => (engine.update as any)(...args),
    };
    await backfillCommentParentPair(racing as any, logger(), { apply: true, pageSize: 500 });
    expect(await engine.findOne(COMMENT, { where: { id }, context: SYS })).toMatchObject({
      thread_id: `${DOC}:${moved}`, object_name: DOC, record_id: moved,
    });
  });

  it('a read the table refuses is a failure, never a clean report', async () => {
    const log = logger();
    const failing = { find: vi.fn(async () => { throw new Error('no such table'); }), update: vi.fn() };
    const report = await backfillCommentParentPair(failing as any, log, { apply: true });
    expect(report.failures).toBe(1);
    expect(failing.update).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});

/** A driver that does not compile the composed leaf, refusing it with D3's envelope, as `driver-mongodb` does. */
class RefusingDriver extends SqliteWasmDriver {
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

describe('[ADR-0139 D3] on a driver that refuses the leaf, a comment read fails and says why', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;

  beforeAll(async () => {
    ({ kernel, engine } = await bootKernel(new RefusingDriver({ filename: ':memory:' })));
    engine.registry.registerObject(objectOf(DOC) as any, HARNESS_PACKAGE);
    await engine.syncSchemas();
    // A real `single` install's Default Organization: the system writes below
    // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
    await installDefaultOrganization(engine);
    const doc = String((await engine.insert(DOC, { name: 'one', owner: MEMBER_A.userId }, { context: SYS })).id);
    await engine.insert(COMMENT, commentOn(DOC, doc, 'one'), { context: SYS });
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  it('control: a system read is served the comment', async () => {
    expect((await engine.find(COMMENT, { context: SYS })).length).toBe(1);
  });

  it('a member’s list and total are refused with D3’s envelope — never served as the deny-all sentinel', async () => {
    for (const read of [() => engine.find(COMMENT, { context: MEMBER_A }), () => engine.count(COMMENT, {}, { context: MEMBER_A })]) {
      const outcome = await read().then((value) => ({ value }), (error) => ({ error }));
      expect(outcome).toHaveProperty('error');
      const error = (outcome as { error: any }).error;
      expect({ code: error.code, status: error.status }).toEqual({ code: 'INTERNAL_ERROR', status: 500 });
      expect(String(error.message)).toContain('[driver-e7-refusing]');
    }
  });
});
