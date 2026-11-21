// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0155 D6, plan step 6] The switch, end to end: the sharing scopes carry
 * the share-grant leaf (`SharedRecordIds`) where they used to carry an id list
 * read with `limit: 5000`.
 *
 * Real `ObjectQL`, real `SqlDriver`, the real sharing middleware and the real
 * `sys_record_share` object (its indexes included). One private object holds
 * 1,000 rows the caller owns, 6,000 rows another user owns, one row sitting
 * in a queue the caller belongs to, one row a pending approval step waits on
 * the caller for, and rows nothing admits. The caller's grants grow from
 * 5,000 to 5,001 to 6,000 across the cases, so the cases run in order.
 *
 * "Today's list" is the retired statement, rebuilt here from what it read: the
 * grant rows under `limit: 5000` (plus the approval ids, which it merged into
 * the same list), OR-ed beside the owner and queue arms and run as a system
 * read. It is the control each pin compares against, not a second scope.
 *
 * ## The dialect axis
 *
 * The SQLite cell always runs. The PostgreSQL cell runs where
 * `OS_TEST_POSTGRES_URL` is set and is a named skip otherwise; it owns one
 * schema, created before and dropped after. No CI job provisions that variable
 * for this package, so the PostgreSQL cell is red-capable and un-run in CI;
 * the change that landed this file carries its local PostgreSQL run.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL, ObjectQLPlugin, driverEvaluatesFixedReadLeaf } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ReadableIds, resolveInjectedColumnProvenance } from '@objectstack/spec/data';

import { SharingService } from './sharing-service.js';
import { buildSharingMiddleware } from './sharing-plugin.js';
import { SysRecordShare } from './objects/sys-record-share.object.js';
import { WRITE_ACCESS_LEVELS } from './access-level.js';

const DEAL = 'd6_deal';
const LINE = 'd6_line';
const ME = 'u_me';
const OTHER = 'u_other';
const AGENT = 'u_agent';
const QUEUE = 'q_sales';
const ORG = 'org_d6';

const OWNED = 1000;
const pad = (n: number) => String(n).padStart(4, '0');
const ownId = (i: number) => `own_${pad(i)}`;
const shrId = (i: number) => `shr_${pad(i)}`;
/** Sits in the caller's queue, owner empty. */
const QUEUED = 'q_0001';
/** Sits in a queue the caller is not in. */
const QUEUED_ELSEWHERE = 'q_0002';
/** A pending approval step waits on the caller for it. */
const APPROVAL = 'apr_0001';
/** Nothing admits it: another owner, and only noise grants name it. */
const NEVER = 'x_0001';

/** Every thousandth grant is read-only; the rest are `edit`, so both scopes pass the cap. */
const accessOf = (i: number) => (i % 1000 === 0 ? 'read' : 'edit');
const editGrantsUpTo = (n: number) => n - Math.floor(n / 1000);

const SYSTEM = { isSystem: true };
const asMe = () => ({ userId: ME });
const asAgentForMe = () => ({ userId: AGENT, onBehalfOf: { userId: ME } });

const DEAL_DEF = { name: DEAL, label: 'D6 deal', sharingModel: 'private', fields: { name: { type: 'text', label: 'Name' } } };
const LINE_DEF = {
  name: LINE,
  label: 'D6 line',
  sharingModel: 'public_read_write',
  fields: { name: { type: 'text', label: 'Name' }, deal_id: { type: 'text', label: 'Deal' } },
};

interface Cell { id: string; config: () => Record<string, unknown> | null }

const PG_SCHEMA = `d6_switch_${process.pid}_${Date.now().toString(36)}`;
const CELLS: Cell[] = [
  { id: 'sqlite', config: () => ({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) },
  {
    id: 'postgres',
    config: () => (process.env.OS_TEST_POSTGRES_URL
      ? { client: 'pg', connection: process.env.OS_TEST_POSTGRES_URL, searchPath: [PG_SCHEMA] }
      : null),
  },
];

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(config === null)(`[ADR-0155 D6] the share-grant leaf in the sharing scopes · ${cell.id}`, () => {
    let driver: SqlDriver;
    let ql: ObjectQL;
    let knex: any;
    /** The queue and approval arms are wired while this is on. */
    let arms = true;
    let grantsSeeded = 0;
    let marker = 0;

    const sharing = () => new SharingService({
      engine: ql as never,
      ownershipQueues: () => (arms
        ? { queuesOf: async () => [QUEUE], isMember: async (_u: string, q: string) => q === QUEUE }
        : null) as never,
      approvals: () => (arms
        ? { pendingApproverReadGrants: async (object: string) => new Map(object === DEAL ? [[APPROVAL, ['req_1']]] : []) }
        : null),
    });

    const shareRow = (id: string, record: string, recipient: string, access: string, extra: Record<string, unknown> = {}) => ({
      id, object_name: DEAL, record_id: record, recipient_type: 'user', recipient_id: recipient, access_level: access,
      source: 'manual', organization_id: ORG, ...extra,
    });

    /** The caller's grants on `shr_0001` … `shr_<n>`. */
    async function growGrantsTo(n: number): Promise<void> {
      const rows = [];
      for (let i = grantsSeeded + 1; i <= n; i++) rows.push(shareRow(`g_me_${pad(i)}`, shrId(i), ME, accessOf(i)));
      if (rows.length > 0) await knex.batchInsert('sys_record_share', rows, 200);
      grantsSeeded = n;
      const [{ n: stored }] = await knex('sys_record_share').where({ recipient_id: ME, object_name: DEAL, recipient_type: 'user' }).count({ n: '*' });
      expect(Number(stored), 'the grants the caller holds on the object').toBe(n);
    }

    /** The retired statement's scope: the grant rows under `limit: 5000`, merged with the approval ids. */
    async function todaysScope(verb: 'read' | 'update'): Promise<Record<string, unknown>> {
      const grants = await ql.find('sys_record_share', {
        where: {
          object_name: DEAL, recipient_type: 'user', recipient_id: ME,
          ...(verb === 'update' ? { access_level: { $in: [...WRITE_ACCESS_LEVELS] } } : {}),
        },
        fields: ['record_id'],
        limit: 5000,
      }, { context: SYSTEM } as never);
      const listed = new Set(
        (grants as Array<{ record_id: unknown }>)
          .map((g) => g.record_id).filter((v) => v != null).map(String).filter((v) => v !== ''),
      );
      if (verb === 'read' && arms) listed.add(APPROVAL);
      const disjuncts: unknown[] = [{ owner_id: ME }];
      if (arms) disjuncts.push({ owner_id: null, queue: QUEUE });
      if (listed.size > 0) disjuncts.push({ id: { $in: [...listed] } });
      return disjuncts.length === 1 ? (disjuncts[0] as Record<string, unknown>) : { $or: disjuncts };
    }

    const ids = (rows: unknown) => (rows as Array<{ id: string }>).map((r) => String(r.id)).sort();
    const leafIds = async (context: Record<string, unknown>) => ids(await ql.find(DEAL, { fields: ['id'] }, { context } as never));
    const listIds = async () => ids(await ql.find(DEAL, { where: await todaysScope('read'), fields: ['id'] }, { context: SYSTEM } as never));
    const leafCount = (context: Record<string, unknown>) => ql.count(DEAL, {}, { context } as never);
    const listCount = async () => ql.count(DEAL, { where: await todaysScope('read') }, { context: SYSTEM } as never);
    const leafGet = async (id: string, context: Record<string, unknown> = asMe()) =>
      (await ql.findOne(DEAL, { where: { id } }, { context } as never)) !== null;
    const listGet = async (id: string) =>
      (await ql.findOne(DEAL, { where: { $and: [{ id }, await todaysScope('read')] } }, { context: SYSTEM } as never)) !== null;

    /** A predicate `update` the caller makes, and the ids it touched. */
    async function leafUpdate(context: Record<string, unknown>): Promise<string[]> {
      const name = `touched_${++marker}`;
      await ql.update(DEAL, { name }, { where: { name: { $ne: '__never__' } }, multi: true, context } as never);
      return ids(await ql.find(DEAL, { where: { name }, fields: ['id'] }, { context: SYSTEM } as never));
    }
    async function listUpdate(): Promise<string[]> {
      const name = `touched_${++marker}`;
      const where = { $and: [{ name: { $ne: '__never__' } }, await todaysScope('update')] };
      await ql.update(DEAL, { name }, { where, multi: true, context: SYSTEM } as never);
      return ids(await ql.find(DEAL, { where: { name }, fields: ['id'] }, { context: SYSTEM } as never));
    }

    beforeAll(async () => {
      driver = new SqlDriver(config as never);
      knex = (driver as unknown as { knex: any }).knex;
      if (cell.id === 'postgres') await knex.raw('CREATE SCHEMA IF NOT EXISTS ??', [PG_SCHEMA]);
      ql = new ObjectQL();
      ql.registerDriver(driver as never, true);
      await ql.init();
      ql.registerObject(DEAL_DEF as never);
      ql.registerObject(LINE_DEF as never);
      ql.registerObject(SysRecordShare as never);
      await driver.initObjects([DEAL, LINE, 'sys_record_share'].map((name) => ql.getSchema(name) as never));

      const service = sharing();
      ql.registerMiddleware(buildSharingMiddleware(service) as never, { object: '*' });
      // The engine composes a `ReadableIds` scope from the `security` service:
      // here, one whose read filter for an object is the sharing scope.
      const services = new Map<string, unknown>([['security', {
        canReadObject: async () => true,
        getReadFilter: (object: string, context: unknown) => service.buildReadFilter(object, context as never),
        explain: async () => ({ allowed: true }),
      }]]);
      await (new ObjectQLPlugin({ ql, registerProtocol: false } as never) as any).init({
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        registerService: (name: string, svc: unknown) => services.set(name, svc),
        getService: (name: string) => {
          if (!services.has(name)) throw new Error(`Service '${name}' not found`);
          return services.get(name);
        },
      });

      const deals: Array<Record<string, unknown>> = [];
      for (let i = 1; i <= OWNED; i++) deals.push({ id: ownId(i), name: 'seed', owner_id: ME });
      for (let i = 1; i <= 6000; i++) deals.push({ id: shrId(i), name: 'seed', owner_id: OTHER });
      deals.push({ id: QUEUED, name: 'seed', owner_id: null, queue: QUEUE });
      deals.push({ id: QUEUED_ELSEWHERE, name: 'seed', owner_id: null, queue: 'q_other' });
      deals.push({ id: APPROVAL, name: 'seed', owner_id: OTHER });
      for (let i = 1; i <= 50; i++) deals.push({ id: `x_${pad(i)}`, name: 'seed', owner_id: OTHER });
      await knex.batchInsert(DEAL, deals.map((d) => ({ ...d, organization_id: ORG })), 200);
      await knex.batchInsert(LINE, deals.map((d) => ({ id: `ln_${d.id}`, name: 'line', deal_id: d.id, organization_id: ORG })), 200);

      // Grants that must never count for the caller on DEAL, and the agent's.
      const noise = [
        ...Array.from({ length: 100 }, (_, k) => shareRow(`g_other_${k}`, ownId(k + 1), OTHER, 'edit')),
        ...Array.from({ length: 50 }, (_, k) => shareRow(`g_obj_${k}`, `x_${pad(k + 1)}`, ME, 'edit', { object_name: 'd6_elsewhere' })),
        shareRow('g_team', NEVER, ME, 'edit', { recipient_type: 'team' }),
        ...Array.from({ length: 100 }, (_, k) => shareRow(`g_agent_s${k}`, shrId(k + 1), AGENT, k < 50 ? 'edit' : 'read')),
        ...Array.from({ length: 50 }, (_, k) => shareRow(`g_agent_o${k}`, ownId(k + 1), AGENT, 'read')),
      ];
      await knex.batchInsert('sys_record_share', noise, 200);
    }, 120_000);

    afterAll(async () => {
      if (cell.id === 'postgres' && knex) await knex.raw('DROP SCHEMA IF EXISTS ?? CASCADE', [PG_SCHEMA]);
      await driver?.disconnect?.();
    });

    it('PREMISE: the driver evaluates the leaf, and the queue arm is a real column', () => {
      expect(driverEvaluatesFixedReadLeaf(driver as never, 'SharedRecordIds')).toBe(true);
      expect(resolveInjectedColumnProvenance(ql.getSchema(DEAL) as never, 'queue')).toBe('injected-provisioned');
    });

    it('5,000 grants: the leaf and today\'s list admit the same rows, list total and get by id, every arm', async () => {
      arms = true;
      await growGrantsTo(5000);
      const expected = OWNED + 5000 + 2;
      expect(await leafCount(asMe())).toBe(expected);
      expect(await listCount()).toBe(expected);
      const viaLeaf = await leafIds(asMe());
      expect(viaLeaf).toHaveLength(expected);
      expect(viaLeaf).toEqual(await listIds());
      for (const [id, admitted] of [
        [ownId(1), true], [QUEUED, true], [APPROVAL, true], [shrId(5000), true],
        [QUEUED_ELSEWHERE, false], [NEVER, false], [shrId(5001), false],
      ] as const) {
        expect(await leafGet(id), `leaf · ${id}`).toBe(admitted);
        expect(await listGet(id), `list · ${id}`).toBe(admitted);
      }
    });

    it('5,000 grants: a predicate update touches the same rows through the write form as through today\'s list', async () => {
      arms = true;
      const viaLeaf = await leafUpdate(asMe());
      // Owned, queued, and the edit-level grants; never the approval row, never a read-only grant.
      expect(viaLeaf).toHaveLength(OWNED + 1 + editGrantsUpTo(5000));
      expect(viaLeaf).toEqual(await listUpdate());
      expect(viaLeaf).not.toContain(APPROVAL);
      expect(viaLeaf).not.toContain(shrId(5000));
    });

    it('5,001 grants: the leaf counts the 5,001st, where today\'s list stops at 5,000', async () => {
      arms = false;
      await growGrantsTo(5001);
      expect(await leafCount(asMe())).toBe(OWNED + 5001);
      expect(await listCount(), 'today: one grant dropped without a word').toBe(OWNED + 5000);
      expect(await leafGet(shrId(5001))).toBe(true);
    });

    it('6,000 grants: 7,000 rows are visible, and the 6,000th granted record is read by id', async () => {
      arms = false;
      await growGrantsTo(6000);
      expect(await leafCount(asMe())).toBe(7000);
      expect(await leafIds(asMe())).toHaveLength(7000);
      expect(await leafGet(shrId(6000))).toBe(true);
      expect(await listCount(), 'today: 1,000 grants dropped').toBe(OWNED + 5000);
    });

    it('6,000 grants: a predicate update reaches every edit-level grant through the write form', async () => {
      arms = false;
      const viaLeaf = await leafUpdate(asMe());
      expect(viaLeaf).toHaveLength(OWNED + editGrantsUpTo(6000));
      expect(viaLeaf).toContain(shrId(5999));
      expect(viaLeaf).not.toContain(shrId(6000));
      expect(await listUpdate(), 'today: capped at 5,000 edit grants').toHaveLength(OWNED + 5000);
    });

    it('nested: the leaf inside a composed ReadableIds scope counts every grant', async () => {
      arms = false;
      const where = { deal_id: { $in: ReadableIds.of(DEAL) } };
      expect(await ql.count(LINE, { where }, { context: asMe() } as never)).toBe(7000);
      const sixThousandth = await ql.findOne(LINE, { where: { $and: [{ id: `ln_${shrId(6000)}` }, where] } }, { context: asMe() } as never);
      expect(sixThousandth?.deal_id).toBe(shrId(6000));
      const never = await ql.findOne(LINE, { where: { $and: [{ id: `ln_${NEVER}` }, where] } }, { context: asMe() } as never);
      expect(never).toBeNull();
    });

    it('delegated: the agent\'s leaf and the delegator\'s leaf, AND-ed, admit only what both reach', async () => {
      arms = false;
      // The agent holds 100 grants on shr_*, and 50 on rows the delegator owns.
      expect(await leafCount(asAgentForMe())).toBe(150);
      expect(await leafGet(shrId(100), asAgentForMe())).toBe(true);
      expect(await leafGet(ownId(50), asAgentForMe())).toBe(true);
      expect(await leafGet(shrId(101), asAgentForMe()), 'the delegator reaches it, the agent does not').toBe(false);
      expect(await leafGet(ownId(51), asAgentForMe()), 'the delegator owns it, the agent holds no grant').toBe(false);
      // The write form: the agent's edit grants on shr_0001 … shr_0050, all of which the delegator may edit.
      const touched = await leafUpdate(asAgentForMe());
      expect(touched).toEqual(Array.from({ length: 50 }, (_, k) => shrId(k + 1)));
    });

    it('6,000 grants with the queue and approval arms: each is its own disjunct beside the leaf', async () => {
      arms = true;
      expect(await leafCount(asMe())).toBe(7002);
      expect(await leafGet(QUEUED)).toBe(true);
      expect(await leafGet(APPROVAL)).toBe(true);
      expect(await leafGet(QUEUED_ELSEWHERE)).toBe(false);
    });
  });
}
