// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0055 amendment, #23093] A `controlled_by_parent` MIDDLE master is judged,
// at the chain walk's hop, by the composition its own direct by-id write is
// judged by — with the platform ownership floor ARMED.
//
// ## What was measured before this suite existed
//
// A two-level chain, the shape of HotCRM's quote lines:
//
//   cbc_line  --quote-->  cbc_quote  --account-->  cbc_account
//   controlled_by_parent  controlled_by_parent      private
//
// For an organization member (position `org_member`, so the platform floor
// `owner_only_writes`, `created_by == current_user.id`, binds), one principal and
// one quote row got two answers to one `update`:
//
//   • the quote's own by-id write — step 2.7 hands a `controlled_by_parent`
//     object's floor to the master gate (commit 6feac910b, the 2026-08-15
//     ruling), so it was ADMITTED for a member who may edit the account;
//   • a write to any line under it — the chain walk's hop asked the quote's
//     write RLS with that floor still standing, so it was REFUSED `403 …
//     (row-level security)` unless the member had created the quote.
//
// The maintainer's ruling on #23093 (letter A) extends the 2026-08-15 ruling to
// that hop. So the invariant this file pins, case by case, is the ruling's own:
// for one principal, a line write under a middle master is admitted IFF that
// principal's direct by-id update of the middle master is admitted.
//
// ## Why this is not a case in `controlled-by-parent-chain.test.ts`
//
// That suite's rig is a read-only engine double whose principals hold no
// position, so the floor never binds there and its two-level writes were
// admitted before and after this change. The floor needs `org_member`, a real
// composition and real rows; the ruling's evidence is "admitted AND the row
// changed", which a double without a write verb cannot show.
//
// ## The four ruled pins, and the one control the analysis left unmeasured
//
//   1. middle editable → the line write is ADMITTED, and the row changed;
//   2. root not editable → REFUSED (the walk reaches the root and refuses there);
//   3. middle not editable → REFUSED — by its object grant, and by an
//      APP-AUTHORED update policy on the middle master (only the PLATFORM floor
//      yields; the app's own policy still decides, at the hop as on the door);
//   4. a DELEGATED write keeps both floors — the agent's and the delegator's.
//
// Every refusal pin was ablated against the implementation (the PR body and the
// card's dev report carry the red runs); no ablation scaffolding lives here.
//
// ## The rig
//
// The real `SecurityPlugin` over a real `ObjectQL` and SQL driver
// (better-sqlite3, in memory), the real `SharingService` as the kernel's
// `sharing` service with its middleware on the engine after this plugin's, and
// the platform's own `member_default` set carrying the floor. The identity
// objects `resolveUserAuthzGrants` reads are registered so a delegator resolves
// from stored rows, as it does on a served stack.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SharingService, buildSharingMiddleware, SysRecordShare } from '@objectstack/plugin-sharing';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';

const SYS = { context: { isSystem: true } } as never;
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

const ACCOUNT = 'cbc_account';
const QUOTE = 'cbc_quote';
const LINE = 'cbc_line';

/** Owns and creates every row nobody else is named for. Never a caller. */
const REP = 'usr_rep';
const MANAGER = 'usr_manager';
const ROOT_READER = 'usr_root_reader';
const MIDDLE_READER = 'usr_middle_reader';
const LOCKED = 'usr_locked';
const PLAIN = 'usr_plain';
/** Delegation case (i): the agent is the floor-bound member, the delegator is not. */
const DELEGATOR_UNBOUND = 'usr_delegator_unbound';
/** Delegation case (ii): the agent is not floor-bound, the delegator is. */
const AGENT_UNBOUND = 'usr_agent_unbound';
const DELEGATOR_MEMBER = 'usr_delegator_member';
const ORG = 'org_cbc';

const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
/** The root's editor: Modify All Data on the account, which the sharing verdict answers `allow` for. */
const ROOT_EDIT = { allowRead: true, allowCreate: true, allowEdit: true, viewAllRecords: true, modifyAllRecords: true };

/** Edits the root through Modify All Data, plain CRUD on the quote and its lines. The card's persona. */
const MANAGER_SET = PermissionSetSchema.parse({
  name: 'cbc_manager',
  objects: { [ACCOUNT]: ROOT_EDIT, [QUOTE]: CRUD, [LINE]: CRUD },
});

/** Reads every account, edits none — the root is readable and NOT editable. */
const ROOT_READER_SET = PermissionSetSchema.parse({
  name: 'cbc_root_reader',
  objects: { [ACCOUNT]: { allowRead: true, viewAllRecords: true }, [QUOTE]: CRUD, [LINE]: CRUD },
});

/** Edits the root, holds NO update grant on the middle master. */
const MIDDLE_READER_SET = PermissionSetSchema.parse({
  name: 'cbc_middle_reader',
  objects: { [ACCOUNT]: ROOT_EDIT, [QUOTE]: { allowRead: true }, [LINE]: CRUD },
});

/**
 * An APP-AUTHORED update policy on the middle master, carried by a set that
 * grants nothing else: only an `open` quote may be updated. Nothing the platform
 * ships spells it, so it is the provenance control — the hop drops the PLATFORM
 * floor and must leave this policy deciding, exactly as the quote's own door does.
 */
const QUOTE_OPEN_ONLY_SET = PermissionSetSchema.parse({
  name: 'cbc_quote_open_only',
  objects: {},
  rowLevelSecurity: [{ name: 'cbc_quote_updates_open_only', object: QUOTE, operation: 'update', using: "stage == 'open'" }],
});

/** CRUD on the account WITHOUT any bypass: a member reaches only the accounts it owns. */
const PLAIN_SET = PermissionSetSchema.parse({
  name: 'cbc_plain',
  objects: { [ACCOUNT]: { allowRead: true, allowCreate: true, allowEdit: true }, [QUOTE]: CRUD, [LINE]: CRUD },
});

const SETS = [MEMBER_DEFAULT, MANAGER_SET, ROOT_READER_SET, MIDDLE_READER_SET, QUOTE_OPEN_ONLY_SET, PLAIN_SET];

/** The execution context `resolveAuthzContext` hands the middleware for an organization member holding the sets. */
const memberOf = (userId: string, ...sets: string[]) => ({
  userId,
  // The organization the request runs in — and so the one a delegator's stored
  // grants are resolved in (`resolveDelegatorContext`).
  tenantId: ORG,
  positions: ['org_member'],
  permissions: [...sets, 'member_default'],
  posture: 'MEMBER',
});
const MANAGER_CALLER = memberOf(MANAGER, MANAGER_SET.name);
const ROOT_READER_CALLER = memberOf(ROOT_READER, ROOT_READER_SET.name);
const MIDDLE_READER_CALLER = memberOf(MIDDLE_READER, MIDDLE_READER_SET.name);
const LOCKED_CALLER = memberOf(LOCKED, MANAGER_SET.name, QUOTE_OPEN_ONLY_SET.name);
const PLAIN_CALLER = memberOf(PLAIN, PLAIN_SET.name);
/** Holds the manager's grants and NO `org_member`, so no floor binds it. */
const AGENT_UNBOUND_CALLER = { userId: AGENT_UNBOUND, tenantId: ORG, positions: [], permissions: [MANAGER_SET.name], posture: 'MEMBER' };
const onBehalfOf = (caller: object, delegator: string) => ({ ...caller, onBehalfOf: { userId: delegator } });

type Answer = { kind: 'admitted' } | { kind: 'refused'; code?: string; status?: number; message: string };

const landed = (p: Promise<unknown>): Promise<Answer> =>
  p.then(
    () => ({ kind: 'admitted' as const }),
    (e: any) => ({
      kind: 'refused' as const,
      code: e?.code == null ? undefined : String(e.code),
      status: e?.statusCode ?? e?.status,
      message: `${String(e?.message ?? '')} ${String(e?.developerMessage ?? '')}`,
    }),
  );

let engine: ObjectQL;
let seq = 0;

beforeAll(async () => {
  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.controlled-by-parent-chain-middle-master',
    name: 'A controlled_by_parent middle master under the platform ownership floor',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysRecordShare,
      SysUser,
      SysOrganization,
      SysMember,
      SysUserPosition,
      SysUserPermissionSet,
      {
        name: ACCOUNT,
        label: 'Account',
        sharingModel: 'private',
        tenancy: { enabled: false },
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
          owner_id: { name: 'owner_id', type: 'text' },
          created_by: { name: 'created_by', type: 'text' },
        },
      },
      {
        name: QUOTE,
        label: 'Quote',
        sharingModel: 'controlled_by_parent',
        tenancy: { enabled: false },
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
          stage: { name: 'stage', type: 'text' },
          account: { name: 'account', type: 'master_detail', reference: ACCOUNT, required: true },
          created_by: { name: 'created_by', type: 'text' },
        },
      },
      {
        name: LINE,
        label: 'Quote line',
        sharingModel: 'controlled_by_parent',
        tenancy: { enabled: false },
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
          quote: { name: 'quote', type: 'master_detail', reference: QUOTE, required: true },
          created_by: { name: 'created_by', type: 'text' },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();

  // The two delegators exist as users, so the on-behalf-of link resolves rather
  // than failing closed. Each holds the manager's set through a stored position
  // row owned by ORG — the organization the delegated request runs in, the only
  // one a grant row applies in (ADR-0131 D10: an organization-less row applies
  // nowhere); only DELEGATOR_MEMBER is an organization member, so only it
  // carries the floor.
  await engine.insert('sys_user', [
    { id: DELEGATOR_UNBOUND, name: 'Delegator, not a member', email: 'delegator-unbound@cbc.test' },
    { id: DELEGATOR_MEMBER, name: 'Delegator, a member', email: 'delegator-member@cbc.test' },
  ], SYS);
  await engine.insert('sys_organization', [{ id: ORG, name: 'CBC', slug: 'cbc' }], SYS);
  await engine.insert('sys_member', [{ id: 'mem_delegator', user_id: DELEGATOR_MEMBER, organization_id: ORG, role: 'member' }], SYS);
  // Landed straight through the driver, so each row stores exactly the
  // organization named here. DELEGATOR_UNBOUND's row is ORG's without a
  // membership: under `single` the session's organization is kept without one,
  // and no `sys_member` row means no `org_member` floor.
  const positions = (engine as any).getDriver('sys_user_position');
  for (const row of [
    { id: 'up_unbound', user_id: DELEGATOR_UNBOUND, position: MANAGER_SET.name, organization_id: ORG },
    { id: 'up_member', user_id: DELEGATOR_MEMBER, position: MANAGER_SET.name, organization_id: ORG },
  ]) {
    await positions.create('sys_user_position', row);
  }

  let security: unknown;
  let sharing: SharingService | undefined;
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        type === 'permission' ? SETS.find((s) => s.name === name) ?? null : engine.getSchema(name) ?? null,
      list: async () => SETS,
    },
    get sharing() { return sharing; },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, svc: unknown) => { if (name === 'security') security = svc; },
    // The lifecycle hooks are collected and never fired, so no bootstrap read
    // is left running into the engine teardown.
    hook: () => undefined,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  sharing = new SharingService({ engine: engine as never, securityService: () => security as never });
  engine.registerMiddleware(buildSharingMiddleware(sharing, ctx.logger) as never, { object: '*' });
});

afterAll(async () => {
  try { await engine?.destroy(); } catch { /* noop */ }
});

interface Chain { account: string; quote: string; line: string }

/**
 * A fresh chain per case, so a delete that lands never moves another case's
 * row. Every row is created by `REP` unless the case names its creator — the
 * floor's question is exactly "who created this row".
 */
async function seedChain(opts: { accountOwner?: string; accountCreatedBy?: string; quoteCreatedBy?: string; stage?: string; lineCreatedBy?: string } = {}): Promise<Chain> {
  const n = ++seq;
  const chain = { account: `acct_${n}`, quote: `quote_${n}`, line: `line_${n}` };
  await engine.insert(ACCOUNT, [{ id: chain.account, name: `account ${n}`, owner_id: opts.accountOwner ?? REP, created_by: opts.accountCreatedBy ?? REP }], SYS);
  await engine.insert(QUOTE, [{ id: chain.quote, name: `quote ${n}`, stage: opts.stage ?? 'open', account: chain.account, created_by: opts.quoteCreatedBy ?? REP }], SYS);
  await engine.insert(LINE, [{ id: chain.line, name: 'as seeded', quote: chain.quote, created_by: opts.lineCreatedBy ?? REP }], SYS);
  return chain;
}

const stored = (object: string, id: string) =>
  engine.findOne(object, { where: { id }, context: { isSystem: true } } as never) as Promise<Record<string, unknown> | null>;
const linesUnder = async (quote: string) =>
  ((await engine.find(LINE, { where: { quote }, context: { isSystem: true } } as never)) as Array<Record<string, unknown>>).length;

/** The middle master's own door: a by-id update of the quote, as this principal. */
const updateQuote = (chain: Chain, caller: object) =>
  landed(engine.update(QUOTE, { name: 'quote edited' }, { where: { id: chain.quote }, context: { ...caller } } as never));
const updateLine = (chain: Chain, caller: object) =>
  landed(engine.update(LINE, { name: 'line edited' }, { where: { id: chain.line }, context: { ...caller } } as never));
const insertLine = (chain: Chain, caller: object) =>
  landed(engine.insert(LINE, { name: 'line inserted', quote: chain.quote }, { context: { ...caller } } as never));
const deleteLine = (chain: Chain, caller: object) =>
  landed(engine.delete(LINE, { where: { id: chain.line }, context: { ...caller } } as never));

/**
 * The ADR-0112 envelope of a master-gate refusal, and its first sentence: it
 * names the CALLER's own object and verb (#7474), never an ancestor.
 */
function expectMasterGateRefusal(answer: Answer, verb: string, refusingMaster: string): void {
  expect(answer).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
  const message = (answer as { message: string }).message;
  expect(message).toContain(`[Security] Access denied: ${verb} on '${LINE}' requires edit access to its master record`);
  expect(message).toContain(`master '${refusingMaster}'`);
}

/** All three line verbs refused on the master gate, and no row moved. */
async function expectLineWritesRefused(chain: Chain, caller: object, refusingMaster: string): Promise<void> {
  const before = await linesUnder(chain.quote);
  expectMasterGateRefusal(await updateLine(chain, caller), 'update', refusingMaster);
  expectMasterGateRefusal(await insertLine(chain, caller), 'insert', refusingMaster);
  expectMasterGateRefusal(await deleteLine(chain, caller), 'delete', refusingMaster);
  expect((await stored(LINE, chain.line))?.name, 'the refused update left the row as seeded').toBe('as seeded');
  expect(await linesUnder(chain.quote), 'the refused insert added no row and the refused delete removed none').toBe(before);
}

describe('[#23093] pin 1 — the middle master is editable: its lines are writable, as its own door is', () => {
  it('a member who did not create the quote: the quote PATCH lands, and so do the line update, insert and delete', async () => {
    const chain = await seedChain();
    expect(await updateQuote(chain, MANAGER_CALLER), 'the middle master\'s own door').toEqual({ kind: 'admitted' });
    expect((await stored(QUOTE, chain.quote))?.name).toBe('quote edited');

    expect(await updateLine(chain, MANAGER_CALLER), 'line update').toEqual({ kind: 'admitted' });
    expect((await stored(LINE, chain.line))?.name, 'the line row changed').toBe('line edited');

    const before = await linesUnder(chain.quote);
    expect(await insertLine(chain, MANAGER_CALLER), 'line insert').toEqual({ kind: 'admitted' });
    expect(await linesUnder(chain.quote), 'the inserted line landed under the quote').toBe(before + 1);

    expect(await deleteLine(chain, MANAGER_CALLER), 'line delete').toEqual({ kind: 'admitted' });
    expect(await stored(LINE, chain.line), 'the deleted line is gone').toBeNull();
  });
});

describe('[#23093] pin 2 — the root is not editable: the walk reaches the root and refuses there', () => {
  it('the root readable but not editable: the quote PATCH is refused, and every line write is refused naming the root', async () => {
    const chain = await seedChain();
    const direct = await updateQuote(chain, ROOT_READER_CALLER);
    expect(direct, 'the middle master\'s own door').toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
    await expectLineWritesRefused(chain, ROOT_READER_CALLER, ACCOUNT);
  });

  it('the root not even readable (owned by another, never shared): the quote PATCH is refused, and so is a line insert', async () => {
    // A by-id line write would stop earlier — the line is hidden by the read
    // derivation, so its door answers not-found first — so the master gate is
    // measured on the insert, which has no pre-image.
    const chain = await seedChain();
    expect(await updateQuote(chain, PLAIN_CALLER), 'the middle master\'s own door').toMatchObject({ kind: 'refused' });
    const before = await linesUnder(chain.quote);
    expectMasterGateRefusal(await insertLine(chain, PLAIN_CALLER), 'insert', ACCOUNT);
    expect(await updateLine(chain, PLAIN_CALLER)).toMatchObject({ kind: 'refused' });
    expect(await deleteLine(chain, PLAIN_CALLER)).toMatchObject({ kind: 'refused' });
    expect((await stored(LINE, chain.line))?.name).toBe('as seeded');
    expect(await linesUnder(chain.quote)).toBe(before);
  });
});

describe('[#23093] pin 3 — the middle master is not editable: its lines are not writable', () => {
  it('no update grant on the middle master: the quote PATCH is refused, and every line write is refused naming the quote', async () => {
    const chain = await seedChain();
    expect(await updateQuote(chain, MIDDLE_READER_CALLER), 'the middle master\'s own door').toMatchObject({ kind: 'refused', status: 403 });
    await expectLineWritesRefused(chain, MIDDLE_READER_CALLER, QUOTE);
  });

  it('an APP-AUTHORED update policy refuses the quote: the hop refuses its lines too — only the platform floor yields', async () => {
    const chain = await seedChain({ stage: 'closed' });
    const direct = await updateQuote(chain, LOCKED_CALLER);
    expect(direct, 'the middle master\'s own door').toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
    expect((direct as { message: string }).message).toContain('(row-level security)');
    await expectLineWritesRefused(chain, LOCKED_CALLER, QUOTE);
  });

  it('…and it still refuses when the caller CREATED that quote: the app policy decides, the creator floor does not widen it', async () => {
    // Before #23093 the hop composed the floor and the authored policy as
    // alternatives, so the creator's line writes were admitted under a quote
    // its own door refuses them — the same two-answer shape, the other way.
    const chain = await seedChain({ stage: 'closed', quoteCreatedBy: LOCKED, lineCreatedBy: LOCKED });
    expect(await updateQuote(chain, LOCKED_CALLER), 'the middle master\'s own door').toMatchObject({ kind: 'refused', status: 403 });
    await expectLineWritesRefused(chain, LOCKED_CALLER, QUOTE);
  });

  it('CONTROL: the same policy admits an open quote, and then its lines are writable — the policy, not the set, is what refused', async () => {
    const chain = await seedChain({ stage: 'open' });
    expect(await updateQuote(chain, LOCKED_CALLER)).toEqual({ kind: 'admitted' });
    expect(await updateLine(chain, LOCKED_CALLER)).toEqual({ kind: 'admitted' });
    expect((await stored(LINE, chain.line))?.name).toBe('line edited');
  });
});

describe('[#23093] pin 4 — a DELEGATED write keeps both floors at the middle master', () => {
  it('the agent\'s floor: a member acting for an unbound delegator is refused the line write, as its delegated quote PATCH is', async () => {
    // The agent created the root and the line, so every floor but the middle
    // master's passes for it; the delegator is bound by no floor at all. Only
    // the agent's floor on the quote (created by REP) can refuse.
    const chain = await seedChain({ accountCreatedBy: MANAGER, lineCreatedBy: MANAGER });
    const delegated = onBehalfOf(MANAGER_CALLER, DELEGATOR_UNBOUND);
    expect(await updateQuote(chain, delegated), 'the delegated quote PATCH').toMatchObject({ kind: 'refused', status: 403 });
    expectMasterGateRefusal(await updateLine(chain, delegated), 'update', QUOTE);
    expectMasterGateRefusal(await insertLine(chain, delegated), 'insert', QUOTE);
    expect((await stored(LINE, chain.line))?.name).toBe('as seeded');
    // Control — delegation is the only variable: the same member, acting for itself.
    expect(await updateLine(chain, MANAGER_CALLER)).toEqual({ kind: 'admitted' });
  });

  it('the delegator\'s floor: an unbound agent acting for a member delegator is refused the line write, as its delegated quote PATCH is', async () => {
    const chain = await seedChain({ accountCreatedBy: DELEGATOR_MEMBER, lineCreatedBy: DELEGATOR_MEMBER });
    const delegated = onBehalfOf(AGENT_UNBOUND_CALLER, DELEGATOR_MEMBER);
    expect(await updateQuote(chain, delegated), 'the delegated quote PATCH').toMatchObject({ kind: 'refused', status: 403 });
    expectMasterGateRefusal(await updateLine(chain, delegated), 'update', QUOTE);
    expectMasterGateRefusal(await insertLine(chain, delegated), 'insert', QUOTE);
    expect((await stored(LINE, chain.line))?.name).toBe('as seeded');
    // Control — delegation is the only variable: the same agent, acting for itself.
    expect(await updateLine(chain, AGENT_UNBOUND_CALLER)).toEqual({ kind: 'admitted' });
  });
});
