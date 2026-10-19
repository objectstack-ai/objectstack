// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0139 E7] The comment-thread read gate writes one ReadableIds leaf per
// parent object over `sys_comment`'s writer-stamped parent pair, with no
// pre-scan and no window, on a real boot at the HTTP door.
//
// ## What changed
//
// A comment is readable when the record its `thread_id` names is. The gate
// used to decide it from a SYSTEM pre-scan of at most 2,000 candidate rows,
// which capped every broad comment read: a member was served 1,765 of the
// 2,300 comments it may read, and an administrator's total read 2,000 of
// 2,601. Every comment now carries `object_name` + `record_id`, stamped from
// its thread, and the gate narrows by them. A row with no stamped pair (one
// written before the upgrade, until `os migrate comment-parent-pair` stamps
// it) keeps the bounded thread probe — never a leaf.
//
// ## The composition
//
// `bootStack` with the real `SecurityPlugin`, `ObjectQL`, SQL driver, REST and
// auth layers, plus `AuditPlugin`. A member owns some private records; a
// writer owns others the member cannot open. Each record carries one comment,
// so every comment is its own thread: the old probe's window bounded threads,
// and only a fixture of more than twice the window of THREADS measures it. The
// comments are inserted as the system (the before-insert hook stamps each from
// its thread).
//
// `@objectstack/plugin-audit` resolves through its BUILT output here.
// Fixtures are synthetic. ⚠️ No test title states a value.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field, isReadableIds } from '@objectstack/spec/data';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { assertArmed, armedWhen } from './armed.js';
import { catalogPermissionSet } from './catalog-permission-set.js';

const COMMENT = 'sys_comment';
const OBJ = 'ctp_item';
const SYS = { isSystem: true } as const;
/** The old pre-scan window. */
const OLD_WINDOW = 2_000;
/** Records the member owns, one comment each: served to it whole. */
const MINE_BULK = 2_050;
/** Records the writer owns, one comment each, which the member cannot open. */
const OTHER_BULK = 2_101;
/** Every fixture comment's author: the filter a fixture read is scoped by. */
const AUTHOR = 'usr_ctp_fixture';
/** Rows whose pair is cleared below: the state of a row the backfill has not reached. */
const UNSTAMPED = 5;
const BATCH = 250;
const PASSWORD = 'Ctp-Fixture-Pass-23857';

const Item = ObjectSchema.create({
  name: OBJ,
  label: 'CTP Item',
  pluralLabel: 'CTP Items',
  // sharingModel omitted: a custom object defaults to private (ADR-0090).
  fields: { name: Field.text({ label: 'Name', required: true }) },
});

const fixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.comment-thread-parent-pair',
    namespace: 'ctp',
    version: '0.0.0',
    type: 'app',
    name: 'Comment Thread Parent Pair Fixture',
    description: 'One private object whose comments a member and an administrator read past the old pre-scan window.',
  },
  objects: [Item],
});

const write = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
const baselineSet = PermissionSetSchema.parse({
  name: 'ctp_baseline',
  label: 'CTP baseline',
  objects: { [OBJ]: write, [COMMENT]: write },
});

type Row = Record<string, any>;
const rowsOf = (body: any): Row[] => body?.records ?? body?.data ?? (Array.isArray(body) ? body : []);
const filterOf = (where: Record<string, unknown>) => encodeURIComponent(JSON.stringify(where));

describe('[ADR-0139 E7] the comment-thread gate leafs over the parent pair: every comment a reader may read, past the old window', () => {
  let stack: VerifyStack;
  let ql: any;
  const token = { admin: '', member: '', writer: '' };
  const id = { mine: '', other: '' };
  const users = { member: '', writer: '' };
  const bulk = { mine: [] as string[], other: [] as string[] };
  /** Every read of sys_comment, with whether it ran as the system. */
  const commentReads: Array<{ method: string; system: boolean; where: string; fields: string; leaf: boolean }> = [];
  /** The WHERE each non-system comment read carried past the gate. */
  const gatedWheres: unknown[] = [];
  const hasLeaf = (node: unknown): boolean =>
    isReadableIds(node) ||
    (Array.isArray(node) ? node.some(hasLeaf) : !!node && typeof node === 'object' && Object.values(node).some(hasLeaf));

  const list = async (who: keyof typeof token, query: string) => {
    const res = await stack.apiAs(token[who], 'GET', `/data/${COMMENT}?${query}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    return { rows: rowsOf(body), total: Number(body.total) };
  };
  const walk = async (who: keyof typeof token, where: Record<string, unknown>) => {
    const ids: string[] = [];
    const totals = new Set<number>();
    for (let skip = 0; skip < 10_000; skip += 500) {
      const page = await list(who, `$filter=${filterOf(where)}&$orderby=id&$top=500&$skip=${skip}`);
      totals.add(page.total);
      ids.push(...page.rows.map((r) => String(r.id)));
      if (page.rows.length < 500) break;
    }
    return { ids, totals: [...totals] };
  };
  /** Every fixture comment: a read over more than twice the old window of candidate threads. */
  const bothThreads = () => ({ author_id: AUTHOR });

  beforeAll(async () => {
    stack = await bootStack(fixtureStack as unknown as Parameters<typeof bootStack>[0], {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, baselineSet],
        fallbackPermissionSet: baselineSet.name,
      }),
      extraPlugins: [new AuditPlugin()],
    });
    ql = await stack.kernel.getServiceAsync('objectql');
    token.admin = await stack.signIn();
    const userIdOf = async (email: string) =>
      String((await ql.findOne('sys_user', { where: { email }, context: { ...SYS } }))?.id ?? '');
    for (const who of ['member', 'writer'] as const) {
      const email = `ctp-${who}@verify.test`;
      token[who] = await stack.signUp(email, PASSWORD);
      users[who] = await userIdOf(email);
      const set = await catalogPermissionSet(ql, baselineSet.name);
      expect(set, 'fixture permission set served by the security catalog').toBeTruthy();
      await ql.insert('sys_user_permission_set', { user_id: await userIdOf(email), permission_set: set.name }, { context: { ...SYS } });
    }
    const idOf = async (res: Response) => {
      expect(res.status, 'fixture write').toBeLessThan(300);
      const j = (await res.json()) as any;
      return String(j.id ?? j.record?.id ?? j.data?.id);
    };
    id.mine = await idOf(await stack.apiAs(token.member, 'POST', `/data/${OBJ}`, { name: 'mine' }));
    id.other = await idOf(await stack.apiAs(token.writer, 'POST', `/data/${OBJ}`, { name: 'other' }));

    // The bulk, inserted as the system: one record per comment, each owned by
    // its member, and the before-insert hook stamps each comment's pair from
    // its thread.
    let n = 0;
    const plant = async (owner: string, count: number, into: string[]) => {
      for (let i = 0; i < count; i += BATCH) {
        const size = Math.min(BATCH, count - i);
        const records = await ql.insert(
          OBJ,
          Array.from({ length: size }, (_, k) => ({ name: `ctp record ${i + k}`, owner_id: owner })),
          { context: { ...SYS } },
        );
        const rows = ((Array.isArray(records) ? records : [records]) as Row[]).map((record) => {
          n += 1;
          return { thread_id: `${OBJ}:${record.id}`, body: `ctp ${n}`, author_id: AUTHOR };
        });
        const out = await ql.insert(COMMENT, rows, { context: { ...SYS } });
        for (const r of (Array.isArray(out) ? out : [out]) as Row[]) into.push(String(r.id));
      }
    };
    await plant(users.member, MINE_BULK, bulk.mine);
    await plant(users.writer, OTHER_BULK, bulk.other);

    // Registered after AuditPlugin's gate, so it sees each read's WHERE as the gate left it.
    ql.registerMiddleware(async (op: any, next: () => Promise<void>) => {
      if (op.context && !op.context.isSystem && ['find', 'count'].includes(op.operation)) gatedWheres.push(op.ast?.where);
      return next();
    }, { object: COMMENT });

    for (const method of ['find', 'findOne', 'count', 'aggregate'] as const) {
      const original = ql[method].bind(ql);
      vi.spyOn(ql, method).mockImplementation(async (...args: any[]) => {
        if (args[0] === COMMENT) {
          const ctx = args[1]?.context ?? args[2]?.context;
          commentReads.push({
            method,
            system: ctx?.isSystem === true,
            where: JSON.stringify(args[1]?.where ?? null),
            fields: JSON.stringify(args[1]?.fields ?? null),
            leaf: hasLeaf(args[1]?.where),
          });
        }
        return original(...args);
      });
    }

    await assertArmed([
      armedWhen({
        control: 'the store holds more than twice the old window, and each bulk comment carries the pair of its thread',
        disarmedBy: 'a store inside the window, or rows the hook did not stamp, would let every case below pass on a capped or probed read',
        observe: async () => {
          const atRest: Row[] = await ql.find(COMMENT, { where: bothThreads(), limit: 10_000, context: { ...SYS } });
          return {
            atRest: atRest.length,
            stamped: atRest.filter((r) => r.object_name === OBJ && r.thread_id === `${OBJ}:${r.record_id}`).length,
          };
        },
        armed: (o) => o.atRest > 2 * OLD_WINDOW && o.stamped === o.atRest,
        describe: (o) => JSON.stringify(o),
      }),
      armedWhen({
        control: 'the member opens its own record and not the writer’s',
        disarmedBy: 'a member who could open the writer’s record would make the hidden cases below measure nothing',
        observe: async () => {
          const recordOf = async (commentId: string) =>
            String((await ql.findOne(COMMENT, { where: { id: commentId }, context: { ...SYS } })).record_id);
          return {
            mine: (await stack.apiAs(token.member, 'GET', `/data/${OBJ}/${id.mine}`)).status,
            other: (await stack.apiAs(token.member, 'GET', `/data/${OBJ}/${id.other}`)).status,
            bulkMine: (await stack.apiAs(token.member, 'GET', `/data/${OBJ}/${await recordOf(bulk.mine[0])}`)).status,
            bulkOther: (await stack.apiAs(token.member, 'GET', `/data/${OBJ}/${await recordOf(bulk.other[0])}`)).status,
          };
        },
        armed: (o) =>
          o.mine === 200 && o.bulkMine === 200 && (o.other === 404 || o.other === 403) && (o.bulkOther === 404 || o.bulkOther === 403),
        describe: (o) => JSON.stringify(o),
      }),
    ]);
  }, 600_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await stack?.stop();
  });

  it('a member is served every comment it may read, past the old window, and every page reports that total', async () => {
    const expected = [...bulk.mine].sort();
    expect(expected.length).toBeGreaterThan(OLD_WINDOW);
    const { ids, totals } = await walk('member', bothThreads());
    // A reading, recorded beside the verdict.
    console.log(`E7-DOGFOOD-READING ${JSON.stringify({ visible: expected.length, served: ids.length, totals })}`);
    expect([...ids].sort()).toEqual(expected);
    expect(totals).toEqual([expected.length]);
  });

  it('the member is served no comment on a record it cannot open, by list, total or thread', async () => {
    const { ids } = await walk('member', bothThreads());
    const served = new Set(ids);
    expect(bulk.other.filter((rowId) => served.has(rowId))).toEqual([]);
    const otherThread = (await ql.findOne(COMMENT, { where: { id: bulk.other[0] }, context: { ...SYS } })).thread_id;
    const scoped = await list('member', `$filter=${filterOf({ thread_id: otherThread })}&$top=5`);
    expect({ rows: scoped.rows.length, total: scoped.total }).toEqual({ rows: 0, total: 0 });
  });

  it('an administrator’s newest-20 read is served 20 rows and a total past the old window', async () => {
    const { rows, total } = await list('admin', '$orderby=created_at%20desc&$top=20');
    expect(rows).toHaveLength(20);
    const fixture = (await list('admin', `$filter=${filterOf(bothThreads())}&$top=1`)).total;
    expect(fixture).toBe(MINE_BULK + OTHER_BULK);
    expect(total).toBeGreaterThanOrEqual(fixture);
    expect(total).toBeGreaterThan(2 * OLD_WINDOW);
  });

  it('no SYSTEM read of the comments carries a leaf; the only SYSTEM reads are the bounded probes of unstamped rows and of D5’s parents', async () => {
    commentReads.length = 0;
    gatedWheres.length = 0;
    await list('member', `$filter=${filterOf(bothThreads())}&$top=20`);
    await list('admin', '$orderby=created_at%20desc&$top=20');
    const system = commentReads.filter((r) => r.system);
    expect(commentReads.length).toBeGreaterThan(system.length);
    expect(system.filter((r) => r.leaf)).toEqual([]);
    const probeShapes = [JSON.stringify(['thread_id']), JSON.stringify(['object_name', 'record_id'])];
    expect(system.filter((r) => !probeShapes.includes(r.fields))).toEqual([]);
    // The thread probe reads only rows with no stamped pair.
    for (const r of system.filter((s) => s.fields === probeShapes[0])) expect(r.where).toContain('"object_name":{"$null":true}');
    // The member's own read reaches the driver carrying the leaf the gate wrote.
    expect(gatedWheres.some(hasLeaf)).toBe(true);
  });

  it('a member’s historical import (treatAsHistorical) naming a foreign pair is refused at the door; without the flag it stores its thread’s pair', async () => {
    const posted = await stack.apiAs(token.member, 'POST', `/data/${COMMENT}`, { thread_id: `${OBJ}:${id.mine}`, body: 'ctp import probe' });
    expect(posted.status, 'fixture comment').toBeLessThan(300);
    const j = (await posted.json()) as any;
    const commentId = String(j.id ?? j.record?.id ?? j.data?.id);
    const rows = [{ id: commentId, object_name: OBJ, record_id: id.other }];
    // [#24348] The import doors refuse `treatAsHistorical: true` to every caller
    // but the system principal, before a row is read. The engine-side half of
    // this pin (the pair re-derived under `preserveAudit`) is held in
    // plugin-audit's `comment-parent-pair.integration.test.ts`.
    const historical = await stack.apiAs(token.member, 'POST', `/data/${COMMENT}/import`, {
      format: 'json', writeMode: 'update', matchFields: ['id'], treatAsHistorical: true, rows,
    });
    expect(historical.status).toBe(403);
    expect(((await historical.json()) as any).error?.code).toBe('PERMISSION_DENIED');
    const untouched = await ql.findOne(COMMENT, { where: { id: commentId }, context: { ...SYS } });
    expect({ object_name: untouched.object_name, record_id: untouched.record_id }).toEqual({ object_name: OBJ, record_id: id.mine });
    // Without the flag the member's import updates the comment it owns (the
    // body carries the change), and the pair it names is the engine's to strip.
    const res = await stack.apiAs(token.member, 'POST', `/data/${COMMENT}/import`, {
      format: 'json', writeMode: 'update', matchFields: ['id'], rows: [{ ...rows[0], body: 'ctp import probe, edited' }],
    });
    expect(res.status).toBe(200);
    const report: any = await res.json();
    const atRest = await ql.findOne(COMMENT, { where: { id: commentId }, context: { ...SYS } });
    // The import updated the row, and the stored pair is still the thread's.
    expect({ updated: report.updated, ok: report.results?.[0]?.ok }).toEqual({ updated: 1, ok: true });
    expect({ object_name: atRest.object_name, record_id: atRest.record_id }).toEqual({ object_name: OBJ, record_id: id.mine });
    // ...so the writer, who reads `id.other` and not `id.mine`, is not served it.
    const writerScoped = await list('writer', `$filter=${filterOf({ id: commentId })}&$top=1`);
    expect(writerScoped.rows).toEqual([]);
  });

  it('a row the backfill has not reached is probed by its thread, not leafed: still served when readable, still hidden when not', async () => {
    const cleared = [...bulk.mine.slice(0, UNSTAMPED), ...bulk.other.slice(0, UNSTAMPED)];
    // Planted below the engine, as a row from before the upgrade is: every
    // engine write of the pair is re-derived from the row's thread.
    const driver = ql.getDriver(COMMENT);
    for (const rowId of cleared) await driver.update(COMMENT, rowId, { object_name: null, record_id: null });
    try {
      commentReads.length = 0;
      const { ids, totals } = await walk('member', bothThreads());
      expect([...ids].sort()).toEqual([...bulk.mine].sort());
      expect(totals).toEqual([bulk.mine.length]);
      const probes = commentReads.filter((r) => r.system && r.fields === JSON.stringify(['thread_id']));
      expect(probes.length).toBeGreaterThan(0);
      expect(probes.every((r) => r.where.includes('"object_name":{"$null":true}'))).toBe(true);
    } finally {
      // The engine write re-derives each row's pair from its thread: the backfill's own write path.
      for (const rowId of cleared) await ql.update(COMMENT, { id: rowId, object_name: null, record_id: null }, { context: { ...SYS } });
      const restored: Row[] = await ql.find(COMMENT, { where: { id: { $in: cleared } }, context: { ...SYS } });
      expect(restored.every((r) => r.thread_id === `${r.object_name}:${r.record_id}`)).toBe(true);
    }
  });
});
