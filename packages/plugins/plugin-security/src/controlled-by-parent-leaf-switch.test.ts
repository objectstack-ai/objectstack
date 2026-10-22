// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0055 · ADR-0139 D6] `controlled_by_parent` is the seventh consumer of
 * the engine's `ReadableIds` leaf: the read derivation answers
 * `{ masterFK: { $in: ReadableIds.of(master) } }` for every
 * `controlled_by_parent` object, the engine composes it at its executor
 * boundary from the security service's own `canReadObject` / `getReadFilter`
 * of the master, and the driver runs ONE statement with the master inside a
 * subquery. No master id list is materialised, nothing is bound per master.
 *
 * Measured on the real stack: `ObjectQL` over better-sqlite3, the real
 * `SecurityPlugin` with the real `SharingService` behind it, direct member
 * contexts and the delegated context `resolveAuthzContext` and
 * `assembleExecutionContext` assemble.
 *
 * ## What the id-list form answered before this switch, on this rig
 *
 * The derivation pre-scanned the master under a system context
 * (`select id from <master> [where …]`) and bound every readable id into
 * `$in` — once per find and once more per count, with no limit. So a detail
 * read ran 2 statements per find (the scan, then the read with the ids
 * bound), 4 per find + count, and past the dialect's variable limit
 * (33,000 masters here; better-sqlite3's limit is 32,766) both verbs
 * answered `DATABASE_ERROR` / 500, `too many SQL variables`.
 *
 * ## The pins
 *
 * - every caller shape keeps its row set: plain (restricted by ownership and a
 *   share), unrestricted (`viewAllRecords`), delegated (the ADR-0090 D10
 *   intersection), two-level chain, null and dangling master pointers
 *   (excluded — ruling B item 4), and a caller the master object does not
 *   admit (the deny door, `$in: []`);
 * - statements per request: find = 1, find + count = 2, no scan of the master
 *   on its own, the master inside the child's subquery;
 * - past the variable limit: 200 with exactly the right rows;
 * - a metadata cycle and a chain past the depth bound answer zero rows from
 *   the plugin's registry walk, never the engine's 500 — and the cut is the
 *   engine's own: a chain of eight derived objects composes (eight nested
 *   subqueries in one statement), the ninth is the empty set;
 * - a write verb's predicate carries no leaf (ADR-0139 D1): a bulk update of a
 *   detail lands, narrowed to the rows the caller may read and edit;
 * - the scope `getReadFilter` answers carries the branded leaf — one for a
 *   direct caller, one per leg for a delegated one — so the analytics faces
 *   receive the same spelling the find path runs.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveAuthzContext, assembleExecutionContext } from '@objectstack/core';
import { isReadableIds } from '@objectstack/spec/data';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SysOrganization, SysUser, SysMember } from '@objectstack/platform-objects/identity';
import { SharingService, buildSharingMiddleware, SysRecordShare } from '@objectstack/plugin-sharing';

import { SysPosition, SysPermissionSet, SysPositionPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { relaxTenantColumns } from './pre-18-tenant-column.testkit.js';

/**
 * The dialects this rig runs on: SQLite always; live PostgreSQL when
 * `OS_TEST_POSTGRES_URL` names one (the ruling's measurement condition for
 * the switch: driver-sql's readable-ids conformance on PostgreSQL, and this
 * rig's row sets and statements on it). The PostgreSQL cell builds its tables
 * in a schema of its own and drops it on teardown. PostgreSQL binds up to
 * 65,535 parameters, so the bind-limit case below does not discriminate the
 * id-list form there; its row set is still read.
 */
interface Cell { readonly label: 'sqlite' | 'postgres'; readonly url?: string }
const PG_URL = process.env.OS_TEST_POSTGRES_URL;
const CELLS: readonly Cell[] = [{ label: 'sqlite' }, ...(PG_URL ? [{ label: 'postgres' as const, url: PG_URL }] : [])];

const SYS = { context: { isSystem: true } } as never;
const ORG = 'org_cbp_leaf';

/** The master: `private`, owner-scoped by plugin-sharing, with one share. */
const ACCOUNT = 'qa_cbp_leaf_account';
/** A one-hop detail of ACCOUNT. */
const CONTACT = 'qa_cbp_leaf_contact';
/** A derived master: `controlled_by_parent` of ACCOUNT. */
const QUOTE = 'qa_cbp_leaf_quote';
/** The two-level chain's leaf: `controlled_by_parent` of QUOTE. */
const LINE = 'qa_cbp_leaf_line';
/** The bind-limit pair: a master with more rows than the dialect binds, and its detail. */
const BIG_MASTER = 'qa_cbp_leaf_big_master';
const BIG_CHILD = 'qa_cbp_leaf_big_child';
/** Past better-sqlite3's `SQLITE_MAX_VARIABLE_NUMBER` (32,766). */
const BIG_MASTERS = 33_000;
/** A two-object metadata cycle. */
const CYC_A = 'qa_cbp_leaf_cyc_a';
const CYC_B = 'qa_cbp_leaf_cyc_b';
/** A generated chain `deep_0 → … → deep_9` of derived objects over a `private` root `deep_10`. */
const DEEP = 'qa_cbp_leaf_deep';
const DEEP_LINKS = 10;

const HUMAN = 'u_cbp_leaf_human';
const OTHER = 'u_cbp_leaf_other';
const VIEW_ALL = 'u_cbp_leaf_view_all';
const NO_ACCOUNT_READ = 'u_cbp_leaf_no_account_read';

const SET = {
  /** Read on every object, edit on the account and its contacts; silent on rows. */
  member: 'qa_cbp_leaf_member',
  /** The same, with `viewAllRecords` on the account: an unrestricted master scope. */
  viewAll: 'qa_cbp_leaf_view_all',
  /** Read on the details, not on the account. */
  noAccount: 'qa_cbp_leaf_no_account',
  /** The agent's ceiling: read everywhere, a content rule on the account's rows. */
  ceiling: 'qa_cbp_leaf_ceiling',
} as const;

type Outcome = { kind: 'landed'; value: unknown } | { kind: 'refused'; code?: string; status?: number; message?: string };

const outcomeOf = (p: Promise<unknown>): Promise<Outcome> =>
  p.then(
    (value) => ({ kind: 'landed' as const, value }),
    (e: unknown) => {
      const x = e as { code?: unknown; status?: unknown; statusCode?: unknown; message?: unknown } | null;
      const status = x?.statusCode ?? x?.status;
      return {
        kind: 'refused' as const,
        code: x?.code == null ? undefined : String(x.code),
        status: status == null ? undefined : Number(status),
        message: x?.message == null ? undefined : String(x.message),
      };
    },
  );

const releaseAsyncContexts = (...owners: object[]): void => {
  for (const owner of owners) {
    for (const value of Object.values(owner)) if (value instanceof AsyncLocalStorage) value.disable();
  }
};

const ids = (rows: unknown): string[] =>
  (Array.isArray(rows) ? rows : [rows])
    .filter(Boolean)
    .map((r) => String((r as { id: unknown }).id))
    .sort();

const TEXT = (name: string) => ({ name, type: 'text' });
const OWNER = { name: 'owner_id', type: 'lookup', reference: 'sys_user' };
const ID = { name: 'id', type: 'text', primaryKey: true };
const masterOf = (field: string, master: string) => ({ name: field, type: 'master_detail', reference: master, required: true });

function deepChain(): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let k = 0; k < DEEP_LINKS; k++) {
    out.push({
      name: `${DEEP}_${k}`,
      label: `Deep ${k}`,
      sharingModel: 'controlled_by_parent',
      fields: { id: ID, up: masterOf('up', `${DEEP}_${k + 1}`) },
    });
  }
  out.push({ name: `${DEEP}_${DEEP_LINKS}`, label: 'Deep root', sharingModel: 'private', fields: { id: ID, owner_id: OWNER } });
  return out;
}

async function boot(cell: Cell) {
  const engine = new ObjectQL();
  let dropSchema: (() => Promise<void>) | undefined;
  if (cell.label === 'postgres') {
    const schema = `qa_cbp_leaf_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
    const admin = new SqlDriver({ client: 'pg', connection: cell.url, pool: { min: 0, max: 1 } } as never);
    await admin.execute(`create schema "${schema}"`);
    dropSchema = async () => {
      try { await admin.execute(`drop schema "${schema}" cascade`); } finally { await admin.disconnect?.(); }
    };
    engine.registerDriver(new SqlDriver({ client: 'pg', connection: cell.url, searchPath: [schema] } as never) as never, true);
  } else {
    engine.registerDriver(
      new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
      true,
    );
  }
  await engine.init();
  const everyDeep = Array.from({ length: DEEP_LINKS + 1 }, (_, k) => `${DEEP}_${k}`);
  engine.registerApp({
    id: 'com.objectstack.qa.controlled-by-parent-leaf-switch',
    name: 'controlled_by_parent answers the ReadableIds leaf',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPosition, SysUserPermissionSet,
      SysOrganization, SysUser, SysMember, SysRecordShare,
      { name: ACCOUNT, label: 'Account', sharingModel: 'private', fields: { id: ID, name: TEXT('name'), owner_id: OWNER } },
      {
        name: CONTACT, label: 'Contact', sharingModel: 'controlled_by_parent',
        fields: { id: ID, note: TEXT('note'), account: masterOf('account', ACCOUNT) },
      },
      {
        name: QUOTE, label: 'Quote', sharingModel: 'controlled_by_parent',
        fields: { id: ID, name: TEXT('name'), account: masterOf('account', ACCOUNT) },
      },
      {
        name: LINE, label: 'Quote line', sharingModel: 'controlled_by_parent',
        fields: { id: ID, note: TEXT('note'), quote: masterOf('quote', QUOTE) },
      },
      { name: BIG_MASTER, label: 'Big master', sharingModel: 'private', fields: { id: ID, name: TEXT('name'), owner_id: OWNER } },
      {
        name: BIG_CHILD, label: 'Big child', sharingModel: 'controlled_by_parent',
        fields: { id: ID, note: TEXT('note'), master: masterOf('master', BIG_MASTER) },
      },
      { name: CYC_A, label: 'Cycle A', sharingModel: 'controlled_by_parent', fields: { id: ID, b: masterOf('b', CYC_B) } },
      { name: CYC_B, label: 'Cycle B', sharingModel: 'controlled_by_parent', fields: { id: ID, a: masterOf('a', CYC_A) } },
      ...deepChain(),
    ],
  } as never);
  await engine.syncSchemas();
  // The organization-less permission-set catalogue row below exists only on a
  // store built before 18.x (ADR-0131 D1 makes a fresh tenant column NOT
  // NULL): that table is this store's.
  await relaxTenantColumns(engine as never, ['sys_permission_set']);

  const e = engine as unknown as {
    insert: (o: string, row: Record<string, unknown>, opts: never) => Promise<unknown>;
    getDriver: (o: string) => {
      create: (o: string, row: Record<string, unknown>) => Promise<unknown>;
      knex: ((table: string) => { insert: (rows: Record<string, unknown>[]) => Promise<unknown> })
        & { on: (ev: string, fn: (q: { sql?: unknown }) => void) => void; removeListener: (ev: string, fn: (q: { sql?: unknown }) => void) => void };
    };
    logger: { warn: () => void };
  };
  await e.insert('sys_organization', { id: ORG, name: ORG, slug: ORG }, SYS);
  for (const id of [HUMAN, OTHER, VIEW_ALL, NO_ACCOUNT_READ]) {
    await e.insert('sys_user', { id, name: id, email: `${id}@example.test` }, SYS);
    await e.insert('sys_member', { id: `mem_${id}`, user_id: id, organization_id: ORG, role: 'member' }, SYS);
  }
  const READ = { allowRead: true } as const;
  const READ_EDIT = { allowRead: true, allowEdit: true } as const;
  const detailObjects = [CONTACT, QUOTE, LINE, BIG_CHILD, CYC_A, CYC_B, ...everyDeep];
  const readAll = Object.fromEntries([ACCOUNT, BIG_MASTER, ...detailObjects].map((o) => [o, READ]));
  const sets = [
    ...defaultPermissionSets,
    PermissionSetSchema.parse({ name: SET.member, objects: { ...readAll, [ACCOUNT]: READ_EDIT, [CONTACT]: READ_EDIT } }),
    PermissionSetSchema.parse({ name: SET.viewAll, objects: { ...readAll, [ACCOUNT]: { ...READ, viewAllRecords: true } } }),
    PermissionSetSchema.parse({ name: SET.noAccount, objects: Object.fromEntries(detailObjects.map((o) => [o, READ])) }),
    PermissionSetSchema.parse({
      name: SET.ceiling,
      objects: readAll,
      rowLevelSecurity: [
        { name: 'qa_cbp_leaf_ceiling_open_only', object: ACCOUNT, operation: 'select', using: "record.name == 'open'" },
      ],
    }),
  ];
  // The delegators hold their sets through stored grants, as a user does.
  for (const name of [SET.member, SET.noAccount]) {
    await e.getDriver('sys_permission_set').create('sys_permission_set', {
      id: `ps_${name}`, name, label: name, organization_id: null, managed_by: 'admin', active: true,
      object_permissions: JSON.stringify({}), system_permissions: JSON.stringify([]),
    });
  }
  for (const [user, set] of [[HUMAN, SET.member], [OTHER, SET.member], [NO_ACCOUNT_READ, SET.noAccount]] as const) {
    await e.insert('sys_user_permission_set', { id: `ups_${user}`, user_id: user, permission_set: set, organization_id: ORG }, SYS);
  }

  // The accounts: two of HUMAN's (one 'open', one 'secret' — the ceiling's
  // rule tells them apart), one of OTHER's, and one of OTHER's shared to
  // HUMAN for read.
  await e.insert(ACCOUNT, { id: 'a_open', name: 'open', owner_id: HUMAN }, SYS);
  await e.insert(ACCOUNT, { id: 'a_secret', name: 'secret', owner_id: HUMAN }, SYS);
  await e.insert(ACCOUNT, { id: 'a_other', name: 'open', owner_id: OTHER }, SYS);
  await e.insert(ACCOUNT, { id: 'a_shared', name: 'open', owner_id: OTHER }, SYS);
  await e.insert('sys_record_share', {
    id: 'shr_cbp_leaf_1', object_name: ACCOUNT, record_id: 'a_shared', recipient_type: 'user', recipient_id: HUMAN, access_level: 'read',
  }, SYS);
  // The details, one per account, plus a null and a dangling master pointer
  // (written through the driver: the required master is what the authoring
  // door refuses, and these rows exist to be excluded). A driver write is not
  // stamped, so it names the rig's organization itself.
  const direct = async (object: string, rows: Record<string, unknown>[]) => {
    for (const row of rows) await e.getDriver(object).create(object, { ...row, organization_id: ORG });
  };
  await direct(CONTACT, [
    { id: 'c_open', note: '', account: 'a_open' }, { id: 'c_secret', note: '', account: 'a_secret' },
    { id: 'c_other', note: '', account: 'a_other' }, { id: 'c_shared', note: '', account: 'a_shared' },
    { id: 'c_null', note: '', account: null }, { id: 'c_dangling', note: '', account: 'a_missing' },
  ]);
  await direct(QUOTE, [
    { id: 'q_open', name: 'q', account: 'a_open' }, { id: 'q_other', name: 'q', account: 'a_other' },
    { id: 'q_null', name: 'q', account: null }, { id: 'q_dangling', name: 'q', account: 'a_missing' },
  ]);
  await direct(LINE, [
    { id: 'l_open', note: '', quote: 'q_open' }, { id: 'l_other', note: '', quote: 'q_other' },
    { id: 'l_via_null', note: '', quote: 'q_null' }, { id: 'l_via_dangling', note: '', quote: 'q_dangling' },
    { id: 'l_null', note: '', quote: null }, { id: 'l_dangling', note: '', quote: 'q_missing' },
  ]);
  // The bind-limit population, straight through the driver's connection:
  // BIG_MASTERS masters HUMAN owns, one OTHER owns, and three children.
  const knex = e.getDriver(BIG_MASTER).knex;
  const bigRows: Record<string, unknown>[] = [];
  for (let i = 0; i < BIG_MASTERS; i++) {
    bigRows.push({ id: `m${String(i).padStart(5, '0')}`, name: 'open', owner_id: HUMAN, organization_id: ORG });
  }
  bigRows.push({ id: 'm_other', name: 'open', owner_id: OTHER, organization_id: ORG });
  for (let i = 0; i < bigRows.length; i += 500) await knex(BIG_MASTER).insert(bigRows.slice(i, i + 500));
  await direct(BIG_CHILD, [
    { id: 'bc1', note: '', master: 'm00001' }, { id: 'bc2', note: '', master: 'm00002' }, { id: 'bc3', note: '', master: 'm_other' },
  ]);
  // The cycle, and the deep chain whose root HUMAN owns: any empty answer on
  // it is the bound talking, not the fixture.
  await direct(CYC_A, [{ id: 'cyc_a1', b: 'cyc_b1' }]);
  await direct(CYC_B, [{ id: 'cyc_b1', a: 'cyc_a1' }]);
  for (let k = 0; k < DEEP_LINKS; k++) await direct(`${DEEP}_${k}`, [{ id: `${DEEP}_${k}_r`, up: `${DEEP}_${k + 1}_r` }]);
  await direct(`${DEEP}_${DEEP_LINKS}`, [{ id: `${DEEP}_${DEEP_LINKS}_r`, owner_id: HUMAN }]);

  let security: {
    getReadFilter: (o: string, c: unknown) => Promise<Record<string, unknown> | undefined>;
    canReadObject: (o: string, c: unknown) => Promise<boolean>;
  } | undefined;
  let sharing: SharingService | undefined;
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        type === 'permission' ? sets.find((s: { name?: string }) => s.name === name) ?? null : engine.getSchema(name) ?? null,
      list: async () => sets,
    },
    tenancy: { posture: 'single' },
    get sharing() { return sharing; },
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const ctx = {
    logger,
    registerService: (name: string, svc: unknown) => {
      if (name === 'security') security = svc as typeof security;
      else services[name] = svc;
    },
    hook: () => undefined,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  // What `ObjectQLPlugin.init` does on a kernel: put the SOURCE of the
  // `security` service in the engine's slot, read at every composition.
  (engine as unknown as Record<symbol, unknown>)[Symbol.for('objectstack.objectql.securityServiceSource')] = () => security;
  sharing = new SharingService({ engine: engine as never, securityService: () => security as never });
  engine.registerMiddleware(buildSharingMiddleware(sharing, ctx.logger) as never, { object: '*' });
  vi.spyOn(e.logger, 'warn').mockImplementation(() => undefined);

  /** A delegated context for `userId`, as the OAuth door assembles it, the agent holding `ceiling` as its only grant. */
  const onBehalfOf = async (userId: string, ceiling: string = SET.ceiling) => {
    const authz = await resolveAuthzContext({
      userAuthGates: undefined,
      apiKeyLifecycle: undefined,
      ql: engine,
      headers: {},
      getSession: async () => ({
        user: { id: userId },
        session: { id: `sess_${userId}`, userId, activeOrganizationId: ORG },
      }),
      tenancyPosture: 'single',
    } as never);
    return assembleExecutionContext({
      authz,
      oauth: { userId, scopes: ['data:read'], clientId: 'qa_agent_client', scopePermissions: [ceiling], delegatesActions: false },
      localization: undefined,
      requestLocale: undefined,
      accessToken: undefined,
    } as never)!;
  };

  return {
    engine,
    logger,
    onBehalfOf,
    read: async (object: string, context: unknown) =>
      ids(await engine.find(object, { context: { ...(context as object) } } as never)),
    count: (object: string, context: unknown) => engine.count(object, { context: { ...(context as object) } } as never),
    readOutcome: (object: string, context: unknown) => outcomeOf(engine.find(object, { context: { ...(context as object) } } as never)),
    countOutcome: (object: string, context: unknown) => outcomeOf(engine.count(object, { context: { ...(context as object) } } as never)),
    readFilter: (object: string, context: unknown) => security!.getReadFilter(object, { ...(context as object) }),
    canReadObject: (object: string, context: unknown) => security!.canReadObject(object, { ...(context as object) }),
    /** The SQL statements the driver ran during `run`, as their text. */
    statementsDuring: async (run: () => Promise<unknown>): Promise<string[]> => {
      const seen: string[] = [];
      const onQuery = (q: { sql?: unknown }) => { seen.push(String(q?.sql ?? '')); };
      knex.on('query', onQuery);
      try { await run(); } finally { knex.removeListener('query', onQuery); }
      return seen;
    },
    teardown: async () => {
      try { await engine.destroy(); } catch { /* noop */ }
      releaseAsyncContexts(engine, plugin);
      await dropSchema?.();
    },
  };
}

type Rig = Awaited<ReturnType<typeof boot>>;

const member = (userId: string, set: string) => ({ userId, positions: [], permissions: [set], posture: 'MEMBER' });
/** The table a statement's FIRST `from` names — the table it reads, not one inside a subquery of it. */
const fromTable = (sql: string): string | undefined => /^select .*? from `?([a-z0-9_]+)`?/i.exec(sql)?.[1];
/** A statement that reads `table` — not one that reads another table with `table` inside a subquery. */
const readsTable = (table: string) => (sql: string) => fromTable(sql) === table;
/** The leaves a scope carries, as the objects they name, in walk order. */
function leavesIn(node: unknown, out: string[] = []): string[] {
  if (node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const item of node) leavesIn(item, out); return out; }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === '$in' && isReadableIds(value)) out.push(value.object);
    else leavesIn(value, out);
  }
  return out;
}

for (const cell of CELLS) describe(`on ${cell.label}`, () => {
  describe('[ADR-0139 D6] controlled_by_parent answers the leaf: every caller shape keeps its row set', () => {
    let rig: Rig;
    beforeAll(async () => { rig = await boot(cell); }, 120_000);
    afterAll(async () => { await rig.teardown(); });

    it('the accounts, measured apart: the owner-match plus the one share for each identity, and every row for view-all', async () => {
      expect(await rig.read(ACCOUNT, member(HUMAN, SET.member))).toEqual(['a_open', 'a_secret', 'a_shared']);
      expect(await rig.read(ACCOUNT, member(OTHER, SET.member))).toEqual(['a_other', 'a_shared']);
      expect(await rig.read(ACCOUNT, member(VIEW_ALL, SET.viewAll))).toEqual(['a_open', 'a_other', 'a_secret', 'a_shared']);
    });

    it('a restricted caller reads the contacts of the accounts it may read — find and count, both identities', async () => {
      for (const [user, expected] of [
        [HUMAN, ['c_open', 'c_secret', 'c_shared']],
        [OTHER, ['c_other', 'c_shared']],
      ] as const) {
        const context = member(user, SET.member);
        expect(await rig.read(CONTACT, context), user).toEqual([...expected]);
        expect(await rig.count(CONTACT, context), user).toBe(expected.length);
      }
    });

    it('an unrestricted master scope (viewAllRecords) reads every contact whose account exists — never the null or dangling pointer (ruling B item 4)', async () => {
      const context = member(VIEW_ALL, SET.viewAll);
      expect(await rig.read(CONTACT, context)).toEqual(['c_open', 'c_other', 'c_secret', 'c_shared']);
      expect(await rig.count(CONTACT, context)).toBe(4);
    });

    it('a caller the master object does not admit reads no contact: canReadObject(ACCOUNT) is false, the leaf is $in: []', async () => {
      const context = member(NO_ACCOUNT_READ, SET.noAccount);
      expect(await rig.readOutcome(ACCOUNT, context)).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
      expect(await rig.canReadObject(ACCOUNT, context)).toBe(false);
      expect(await rig.read(CONTACT, context)).toEqual([]);
      expect(await rig.count(CONTACT, context)).toBe(0);
    });

    it("a delegated caller reads the intersection: the delegator's accounts the ceiling admits", async () => {
      const context = await rig.onBehalfOf(HUMAN);
      expect(await rig.read(ACCOUNT, context)).toEqual(['a_open', 'a_shared']);
      expect(await rig.read(CONTACT, context)).toEqual(['c_open', 'c_shared']);
      expect(await rig.count(CONTACT, context)).toBe(2);
    });

    it('the two-level chain composes: a line is readable where its quote is, and a quote where its account is', async () => {
      expect(await rig.read(QUOTE, member(HUMAN, SET.member))).toEqual(['q_open']);
      expect(await rig.read(LINE, member(HUMAN, SET.member))).toEqual(['l_open']);
      expect(await rig.read(LINE, member(OTHER, SET.member))).toEqual(['l_other']);
      expect(await rig.read(LINE, member(VIEW_ALL, SET.viewAll))).toEqual(['l_open', 'l_other']);
      expect(await rig.read(LINE, await rig.onBehalfOf(HUMAN))).toEqual(['l_open']);
      expect(await rig.count(LINE, member(VIEW_ALL, SET.viewAll))).toBe(2);
    });

    it('CONTROL — a system context reads every detail whose master pointer is set, the chain composed with no restriction', async () => {
      expect(await rig.read(CONTACT, { isSystem: true })).toEqual(['c_dangling', 'c_null', 'c_open', 'c_other', 'c_secret', 'c_shared']);
    });
  });

  describe('[ADR-0139 D6] statements per request: one per find, two per find + count, no scan of the master', () => {
    let rig: Rig;
    beforeAll(async () => { rig = await boot(cell); }, 120_000);
    afterAll(async () => { await rig.teardown(); });

    const shapes = (): Array<[string, string, unknown | Promise<unknown>, string]> => [
      ['plain', CONTACT, member(HUMAN, SET.member), ACCOUNT],
      ['unrestricted', CONTACT, member(VIEW_ALL, SET.viewAll), ACCOUNT],
      ['two-level chain', LINE, member(HUMAN, SET.member), QUOTE],
    ];

    it.each(shapes())('%s: the find is one statement, the master inside its subquery, and find + count is two', async (_shape, object, contextOrPromise, master) => {
      const context = await contextOrPromise;
      const reading = (statements: string[]) => statements.filter((sql) => readsTable(object)(sql) || readsTable(master)(sql) || readsTable(ACCOUNT)(sql));
      const find = await rig.statementsDuring(() => rig.engine.find(object, { context: { ...(context as object) } } as never));
      const findAll = `find:\n${find.join('\n')}`;
      expect(reading(find), findAll).toHaveLength(1);
      expect(reading(find)[0], findAll).toMatch(new RegExp(`^select .* from .${object}. where .*in \\(select .id. from .${master}.`, 'i'));
      // No statement reads the master on its own: the leaf stands where the
      // pre-resolved id list stood, so the master is never pre-scanned.
      expect(find.filter(readsTable(master)), findAll).toHaveLength(0);
      expect(find.filter(readsTable(ACCOUNT)), findAll).toHaveLength(0);
      const both = await rig.statementsDuring(async () => {
        await rig.engine.find(object, { context: { ...(context as object) } } as never);
        await rig.engine.count(object, { context: { ...(context as object) } } as never);
      });
      const bothAll = `find + count:\n${both.join('\n')}`;
      expect(reading(both), bothAll).toHaveLength(2);
      for (const sql of reading(both)) expect(sql, bothAll).toMatch(/in \(select/i);
    });

    it('a delegated find is one statement too: both halves write the leaf, the engine composes the master once, the subquery is carried twice', async () => {
      const context = await rig.onBehalfOf(HUMAN);
      const find = await rig.statementsDuring(() => rig.engine.find(CONTACT, { context: { ...context } } as never));
      const all = `delegated find:\n${find.join('\n')}`;
      const reads = find.filter((sql) => readsTable(CONTACT)(sql) || readsTable(ACCOUNT)(sql));
      expect(reads, all).toHaveLength(1);
      expect(reads[0].match(new RegExp(`in \\(select .id. from .${ACCOUNT}.`, 'gi')) ?? [], all).toHaveLength(2);
      expect(find.filter(readsTable(ACCOUNT)), all).toHaveLength(0);
    });

    it('the two-level chain is one statement with the subqueries nested: quote inside the line, account inside the quote', async () => {
      const find = await rig.statementsDuring(() => rig.engine.find(LINE, { context: member(HUMAN, SET.member) } as never));
      const reads = find.filter(readsTable(LINE));
      expect(reads, find.join('\n')).toHaveLength(1);
      expect(reads[0]).toMatch(new RegExp(`in \\(select .id. from .${QUOTE}. where .*in \\(select .id. from .${ACCOUNT}.`, 'i'));
    });
  });

  describe('[ADR-0139 D6] past the dialect\'s variable limit', () => {
    let rig: Rig;
    beforeAll(async () => { rig = await boot(cell); }, 180_000);
    afterAll(async () => { await rig.teardown(); });

    it(`a detail under ${BIG_MASTERS} readable masters answers 200 with exactly the right rows, and count agrees`, async () => {
      const context = member(HUMAN, SET.member);
      expect(await rig.read(BIG_MASTER, { isSystem: true })).toHaveLength(BIG_MASTERS + 1);
      const find = await rig.readOutcome(BIG_CHILD, context);
      expect(find.kind, JSON.stringify(find)).toBe('landed');
      expect(ids((find as { value: unknown }).value)).toEqual(['bc1', 'bc2']);
      const count = await rig.countOutcome(BIG_CHILD, context);
      expect(count).toEqual({ kind: 'landed', value: 2 });
    });

    it('…in one statement that binds the owner, never a master id', async () => {
      const find = await rig.statementsDuring(() => rig.engine.find(BIG_CHILD, { context: member(HUMAN, SET.member) } as never));
      const reads = find.filter(readsTable(BIG_CHILD));
      expect(reads, find.join('\n')).toHaveLength(1);
      expect(reads[0]).toMatch(new RegExp(`in \\(select .id. from .${BIG_MASTER}. where`, 'i'));
      expect(find.filter(readsTable(BIG_MASTER))).toHaveLength(0);
    });
  });

  describe('[ADR-0055 amendment] the two guards answer zero rows from the registry walk, never the engine\'s refusal', () => {
    let rig: Rig;
    beforeAll(async () => { rig = await boot(cell); }, 120_000);
    afterAll(async () => { await rig.teardown(); });

    it('a metadata cycle: zero rows, 200, reported as a cycle, and no statement scans either object', async () => {
      rig.logger.error.mockClear();
      const statements = await rig.statementsDuring(async () => {
        expect(await rig.readOutcome(CYC_A, member(HUMAN, SET.member))).toMatchObject({ kind: 'landed', value: [] });
        expect(await rig.countOutcome(CYC_B, member(HUMAN, SET.member))).toEqual({ kind: 'landed', value: 0 });
      });
      const messages = rig.logger.error.mock.calls.map((c: unknown[]) => String(c[0]));
      expect(messages.some((m) => m.includes('CYCLE') && m.includes(CYC_A))).toBe(true);
      expect(statements.filter((sql) => /in \(select/i.test(sql))).toHaveLength(0);
    });

    it('a chain past the depth bound: zero rows, 200, reported naming the bound', async () => {
      rig.logger.error.mockClear();
      expect(await rig.readOutcome(`${DEEP}_0`, member(HUMAN, SET.member))).toMatchObject({ kind: 'landed', value: [] });
      expect(await rig.readOutcome(`${DEEP}_1`, member(HUMAN, SET.member))).toMatchObject({ kind: 'landed', value: [] });
      const messages = rig.logger.error.mock.calls.map((c: unknown[]) => String(c[0]));
      expect(messages.some((m) => m.includes('depth bound') && m.includes(`${DEEP}_0`))).toBe(true);
    });

    it("the cut is the engine's: eight derived objects compose into one statement with eight nested subqueries, and the row is served", async () => {
      // `deep_2 → deep_3 → … → deep_9` are eight derived objects over the
      // `private` root HUMAN owns. The engine composes a chain at most eight
      // scopes deep; the plugin's bound refuses the ninth (`deep_1`, above).
      const context = member(HUMAN, SET.member);
      const statements = await rig.statementsDuring(async () => {
        expect(await rig.read(`${DEEP}_2`, context)).toEqual([`${DEEP}_2_r`]);
      });
      const reads = statements.filter(readsTable(`${DEEP}_2`));
      expect(reads, statements.join('\n')).toHaveLength(1);
      expect(reads[0].match(/in \(select/gi) ?? []).toHaveLength(8);
      expect(await rig.read(`${DEEP}_${DEEP_LINKS - 1}`, context)).toEqual([`${DEEP}_${DEEP_LINKS - 1}_r`]);
    });
  });

  describe('[ADR-0139 D1] a write verb\'s predicate carries no leaf', () => {
    let rig: Rig;
    beforeAll(async () => { rig = await boot(cell); }, 120_000);
    afterAll(async () => { await rig.teardown(); });

    it('a bulk update of the contacts lands, narrowed to the rows whose account the caller may read and edit', async () => {
      const context = member(OTHER, SET.member);
      const outcome = await outcomeOf(rig.engine.update(CONTACT, { note: 'bulk' }, { where: {}, multi: true, context: { ...context } } as never));
      expect(outcome.kind, JSON.stringify(outcome)).toBe('landed');
      const after = (await rig.engine.find(CONTACT, { context: { isSystem: true } } as never)) as Array<{ id: string; note: string }>;
      const noted = after.filter((r) => r.note === 'bulk').map((r) => r.id).sort();
      expect(noted).toEqual(['c_other', 'c_shared']);
    });
  });

  describe('[ADR-0139 D6] the scope getReadFilter answers carries the leaf — the spelling the analytics faces receive', () => {
    let rig: Rig;
    beforeAll(async () => { rig = await boot(cell); }, 120_000);
    afterAll(async () => { await rig.teardown(); });

    it('a direct caller: one leaf over the master, and nothing bound per master', async () => {
      const scope = await rig.readFilter(CONTACT, member(HUMAN, SET.member));
      expect(leavesIn(scope)).toEqual([ACCOUNT]);
      expect(JSON.stringify(scope)).not.toMatch(/a_open|a_secret|a_shared/);
    });

    it('a delegated caller: one leaf per leg, both over the master', async () => {
      const scope = await rig.readFilter(CONTACT, await rig.onBehalfOf(HUMAN));
      expect(leavesIn(scope)).toEqual([ACCOUNT, ACCOUNT]);
    });

    it("a derived master's scope carries the leaf over ITS master, so the chain composes inside the engine", async () => {
      expect(leavesIn(await rig.readFilter(QUOTE, member(HUMAN, SET.member)))).toEqual([ACCOUNT]);
      expect(leavesIn(await rig.readFilter(LINE, member(HUMAN, SET.member)))).toEqual([QUOTE]);
    });

    it('a caller the master object does not admit still receives the leaf; the engine answers it $in: [] (canReadObject false)', async () => {
      const context = member(NO_ACCOUNT_READ, SET.noAccount);
      expect(leavesIn(await rig.readFilter(CONTACT, context))).toEqual([ACCOUNT]);
      expect(await rig.canReadObject(ACCOUNT, context)).toBe(false);
    });
  });
});
