// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0055 §3 amendment, #25760 — ruling 6398566164] A `controlled_by_parent`
// detail may opt its rows' OWNERS into updating them with READ access to the
// master: `sharing: { controlledByParent: { ownerMayEdit: true } }`.
//
// ## The gap this pins
//
// Salesforce's Activities under OWD = Controlled by Parent let the owner of an
// activity edit it while reading its account. ADR-0055 §3 had one rule for
// every write of a detail — EDIT access to the master — so a detail row's
// owner who could only read the master was refused their own row, and an
// authored `owner_id == current_user.id` update policy on the detail could
// not change that (step 2.7's policies compose AND with the master gate).
//
// The ruling (letter 1): an opt-in, per object, default unchanged; with it the
// detail row's own owner passes the write gate with READ on the master;
// everyone else still needs master EDIT. The ruling names `update`; this suite
// pins insert, delete, a predicate update and a delegated write OUT of the
// opt-in, each refused by the master gate as before.
//
// ## The rig
//
// The real `SecurityPlugin` over a real `ObjectQL` and SQL driver
// (better-sqlite3, in memory), the real `SharingService` as the kernel's
// `sharing` service with its middleware on the engine after this plugin's, and
// the platform's own `member_default` set carrying the ownership floor — the
// `controlled-by-parent-chain-middle-master.test.ts` rig. The owner column the
// gate compares against is the registry's INJECTED `owner_id`
// (`applySystemFields`, `ownership: 'user'` by default): `omd_obligation`
// declares none, so the suite proves the column the opt-in names is the one
// every stored row already carries.
//
//   omd_obligation --contract--> omd_contract   (opted in,      ownership: user)
//   omd_task       --contract--> omd_contract   (NOT opted in,  ownership: user)
//   omd_note       --contract--> omd_contract   (opted in,      ownership: none)
//
// [ADR-0055 §3 as amended for #33250 — ruling A+] The second opt-in of the
// same block, `writeRequiresMasterRead: true`: with it the master question the
// gate asks for an insert, an update and a delete of a detail is READ on the
// master instead of EDIT, and the detail's own grants, row-level policies and
// FLS decide the rest. Its pins are the `[#33250]` blocks at the end, over the
// same rig plus:
//
//   omd_milestone  --contract--> omd_contract    (writeRequiresMasterRead)
//   omd_step       --milestone-> omd_milestone   (writeRequiresMasterRead; a chain of two opted-in hops)
//   omd_line       --milestone-> omd_milestone   (NOT opted in; edit on the milestone, then read on its contract)

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SharingService, buildSharingMiddleware, SysRecordShare } from '@objectstack/plugin-sharing';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { ControlledByParentWriteOutcome } from '@objectstack/spec/contracts';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { wireEngineSecuritySource } from './engine-security-source.testkit.js';

const SYS = { context: { isSystem: true } } as never;
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

const CONTRACT = 'omd_contract';
const OBLIGATION = 'omd_obligation';
const TASK = 'omd_task';
const NOTE = 'omd_note';

/** Creates every row (the floor's `created_by`); never a caller, never an owner. */
const REP = 'usr_rep';
/** The persona of the ruling: owns the detail row, reads the master, cannot edit it. */
const OWNER = 'usr_owner';
/** Reads the master, cannot edit it, owns nothing. */
const STRANGER = 'usr_stranger';
/** Edits the master through Modify All Data; owns nothing. */
const EDITOR = 'usr_editor';
/** Owns the detail row and cannot even READ the master. */
const BLIND = 'usr_blind';
/** A delegator holding the owner's grants and bound by no floor, for the on-behalf-of pin. */
const DELEGATOR = 'usr_delegator';
/** [#33250] A delegator holding only the blind set: it cannot read any contract. */
const BLIND_DELEGATOR = 'usr_blind_delegator';
/** [#33250] Reads the contract object but not the contracts REP owns (no View All on a private master). */
const HIDDEN = 'usr_hidden';
/** [#33250] Reads the contract; holds READ alone on the milestone: no create, edit or delete grant of its own. */
const LOOKER = 'usr_looker';
/** [#33250] Reads the contract; CRUD on the milestone, narrowed by an update policy to the rows it owns. */
const NARROW = 'usr_narrow';
const ORG = 'org_omd';

const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
/** READ on every contract, EDIT on none: the master is readable and NOT editable. */
const MASTER_READ = { allowRead: true, viewAllRecords: true };
/** Modify All Data on the contract, which the sharing verdict answers `allow` for. */
const MASTER_EDIT = { allowRead: true, allowCreate: true, allowEdit: true, viewAllRecords: true, modifyAllRecords: true };
const MILESTONE = 'omd_milestone';
const STEP = 'omd_step';
const LINE = 'omd_line';
const DETAILS = { [OBLIGATION]: CRUD, [TASK]: CRUD, [NOTE]: CRUD, [MILESTONE]: CRUD, [STEP]: CRUD, [LINE]: CRUD };

const REQUESTER_SET = PermissionSetSchema.parse({ name: 'omd_requester', objects: { [CONTRACT]: MASTER_READ, ...DETAILS } });
const EDITOR_SET = PermissionSetSchema.parse({ name: 'omd_editor', objects: { [CONTRACT]: MASTER_EDIT, ...DETAILS } });
/** CRUD on the details and NO grant on the contract: the master is not readable. */
const BLIND_SET = PermissionSetSchema.parse({ name: 'omd_blind', objects: { ...DETAILS } });
/** [#33250] READ on the contract object without View All: a private contract REP owns is hidden from the holder. */
const HIDDEN_SET = PermissionSetSchema.parse({ name: 'omd_hidden', objects: { [CONTRACT]: { allowRead: true }, ...DETAILS } });
/** [#33250] Reads every contract; the milestone may be READ only. */
const LOOKER_SET = PermissionSetSchema.parse({
  name: 'omd_looker',
  objects: { [CONTRACT]: MASTER_READ, [MILESTONE]: { allowRead: true } },
});
/** [#33250] Reads every contract; CRUD on the milestone, but its own update policy admits only the rows the holder owns. */
const NARROW_SET = PermissionSetSchema.parse({
  name: 'omd_narrow',
  objects: { [CONTRACT]: MASTER_READ, [MILESTONE]: CRUD },
  rowLevelSecurity: [{ name: 'omd_milestone_own_rows', object: MILESTONE, operation: 'update', using: 'owner_id == current_user.id' }],
});
const SETS = [MEMBER_DEFAULT, REQUESTER_SET, EDITOR_SET, BLIND_SET, HIDDEN_SET, LOOKER_SET, NARROW_SET];

/** The execution context `resolveAuthzContext` hands the middleware for an organization member holding the sets. */
const memberOf = (userId: string, ...sets: string[]) => ({
  userId,
  tenantId: ORG,
  positions: ['org_member'],
  permissions: [...sets, 'member_default'],
  posture: 'MEMBER',
});
const OWNER_CALLER = memberOf(OWNER, REQUESTER_SET.name);
const STRANGER_CALLER = memberOf(STRANGER, REQUESTER_SET.name);
const EDITOR_CALLER = memberOf(EDITOR, EDITOR_SET.name);
const BLIND_CALLER = memberOf(BLIND, BLIND_SET.name);
const HIDDEN_CALLER = memberOf(HIDDEN, HIDDEN_SET.name);
const LOOKER_CALLER = memberOf(LOOKER, LOOKER_SET.name);
const NARROW_CALLER = memberOf(NARROW, NARROW_SET.name);
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
let security: { checkControlledByParentWrite: (object: string, id: string, context: unknown) => Promise<ControlledByParentWriteOutcome> };
/** The plugin's `logger.warn`, for the one report this suite pins. */
const warnings = vi.fn<(msg: string, meta?: unknown) => void>();
let seq = 0;

const detail = (name: string, label: string, extra: Record<string, unknown> = {}) => ({
  name,
  label,
  sharingModel: 'controlled_by_parent',
  tenancy: { enabled: false },
  fields: {
    id: { name: 'id', type: 'text', primaryKey: true },
    name: { name: 'name', type: 'text' },
    contract: { name: 'contract', type: 'master_detail', reference: CONTRACT, required: true },
    created_by: { name: 'created_by', type: 'text' },
  },
  ...extra,
});

const OPT_IN = { sharing: { controlledByParent: { ownerMayEdit: true } } };
/** [#33250] The second opt-in: read on the master is the master question for every write of the detail. */
const MASTER_READ_OPT_IN = { sharing: { controlledByParent: { writeRequiresMasterRead: true } } };

/** [#33250] A detail of the milestone: same shape as {@link detail}, its master the milestone. */
const milestoneDetail = (name: string, label: string, extra: Record<string, unknown> = {}) => ({
  name,
  label,
  sharingModel: 'controlled_by_parent',
  tenancy: { enabled: false },
  fields: {
    id: { name: 'id', type: 'text', primaryKey: true },
    name: { name: 'name', type: 'text' },
    milestone: { name: 'milestone', type: 'master_detail', reference: MILESTONE, required: true },
    created_by: { name: 'created_by', type: 'text' },
  },
  ...extra,
});

beforeAll(async () => {
  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.controlled-by-parent-owner-may-edit',
    name: 'A controlled_by_parent detail whose owner may edit with read on the master',
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
        name: CONTRACT,
        label: 'Contract',
        sharingModel: 'private',
        tenancy: { enabled: false },
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
          owner_id: { name: 'owner_id', type: 'text' },
          created_by: { name: 'created_by', type: 'text' },
        },
      },
      // The opt-in, on a detail that declares NO owner column of its own: the
      // registry's injected `owner_id` is the one the gate reads.
      detail(OBLIGATION, 'Obligation', OPT_IN),
      // The default: no opt-in, so ADR-0055 §3 unamended.
      detail(TASK, 'Task'),
      // The opt-in on a detail whose rows carry NO owner (`ownership: 'none'`
      // injects no `owner_id`): the opt-in names nobody and is reported.
      detail(NOTE, 'Note', { ...OPT_IN, ownership: 'none' }),
      // [#33250] Read on the master suffices for every write of these.
      detail(MILESTONE, 'Milestone', MASTER_READ_OPT_IN),
      milestoneDetail(STEP, 'Step', MASTER_READ_OPT_IN),
      // [#33250] Not opted in, under an opted-in master: edit on the milestone, then read on its contract.
      milestoneDetail(LINE, 'Line'),
    ],
  } as never);
  await engine.syncSchemas();

  await engine.insert('sys_user', [REP, OWNER, STRANGER, EDITOR, BLIND, DELEGATOR, BLIND_DELEGATOR, HIDDEN, LOOKER, NARROW].map((id) => ({
    id, name: id, email: `${id}@omd.test`,
  })), SYS);
  await engine.insert('sys_organization', [{ id: ORG, name: 'OMD', slug: 'omd' }], SYS);
  // The delegator holds the requester's set through a stored direct grant row
  // owned by ORG, so the on-behalf-of link resolves to the same grants the
  // owner holds — and a membership whose role (`admin` → `org_admin`) sits
  // outside the members-only floor's `org_member` domain (a delegation needs
  // the delegator's current membership under every posture, ADR-0093 D8.1 as
  // amended), so no ownership floor binds the delegator's pass: the only thing
  // left to refuse a delegated update is the master gate, which is the pin (see
  // the chain-middle-master suite for why the row lands straight through the
  // driver).
  await engine.insert('sys_member', [{ id: 'mem_delegator', user_id: DELEGATOR, organization_id: ORG, role: 'admin' }], SYS);
  await (engine as any).getDriver('sys_user_permission_set').create('sys_user_permission_set', {
    id: 'ups_delegator', user_id: DELEGATOR, permission_set: REQUESTER_SET.name, organization_id: ORG,
  });
  // [#33250] The same shape for a delegator who reads no contract at all.
  await engine.insert('sys_member', [{ id: 'mem_blind_delegator', user_id: BLIND_DELEGATOR, organization_id: ORG, role: 'admin' }], SYS);
  await (engine as any).getDriver('sys_user_permission_set').create('sys_user_permission_set', {
    id: 'ups_blind_delegator', user_id: BLIND_DELEGATOR, permission_set: BLIND_SET.name, organization_id: ORG,
  });

  let securityService: unknown;
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
    logger: { info: vi.fn(), warn: warnings, error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, svc: unknown) => { if (name === 'security') securityService = svc; },
    hook: () => undefined,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  wireEngineSecuritySource(engine, () => plugin);
  sharing = new SharingService({ engine: engine as never, securityService: () => securityService as never });
  engine.registerMiddleware(buildSharingMiddleware(sharing, ctx.logger) as never, { object: '*' });
  security = securityService as typeof security;
});

afterAll(async () => {
  try { await engine?.destroy(); } catch { /* noop */ }
});

interface Pair { contract: string; row: string }

/**
 * A fresh contract and one detail row under it per case. Every row is CREATED
 * by `REP` unless the case names its creator — the floor's `created_by` never
 * names the caller — and the detail row is OWNED by `owner` (`owner_id`), the
 * column the opt-in reads: the two are different people, so what admits the
 * owner below is the opt-in and not the creator floor.
 */
async function seed(object: string, opts: { owner?: string | null; createdBy?: string } = {}): Promise<Pair> {
  const n = ++seq;
  const pair = { contract: `contract_${n}`, row: `${object}_${n}` };
  await engine.insert(CONTRACT, [{ id: pair.contract, name: `contract ${n}`, owner_id: REP, created_by: REP }], SYS);
  const row: Record<string, unknown> = { id: pair.row, name: 'as seeded', contract: pair.contract, created_by: opts.createdBy ?? REP };
  if (opts.owner !== undefined) row.owner_id = opts.owner;
  await engine.insert(object, [row], SYS);
  return pair;
}

const stored = (object: string, id: string) =>
  engine.findOne(object, { where: { id }, context: { isSystem: true } } as never) as Promise<Record<string, unknown> | null>;
const rowsUnder = async (object: string, contract: string) =>
  ((await engine.find(object, { where: { contract }, context: { isSystem: true } } as never)) as Array<Record<string, unknown>>).length;

const updateById = (object: string, pair: Pair, caller: object, data: Record<string, unknown> = { name: 'edited by id' }) =>
  landed(engine.update(object, data, { where: { id: pair.row }, context: { ...caller } } as never));
const updateByPredicate = (object: string, pair: Pair, caller: object) =>
  landed(engine.update(object, { name: 'edited by predicate' }, { where: { id: { $in: [pair.row] } }, multi: true, context: { ...caller } } as never));
const insertUnder = (object: string, pair: Pair, caller: object) =>
  landed(engine.insert(object, { name: 'inserted', contract: pair.contract }, { context: { ...caller } } as never));
const deleteById = (object: string, pair: Pair, caller: object) =>
  landed(engine.delete(object, { where: { id: pair.row }, context: { ...caller } } as never));

/** The ADR-0112 envelope of a master-gate refusal: the CALLER's object and verb (#7474), and the master that refused. */
function expectMasterGateRefusal(answer: Answer, verb: string, object: string): void {
  expect(answer).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
  const message = (answer as { message: string }).message;
  expect(message).toContain(`[Security] Access denied: ${verb} on '${object}' requires edit access to its master record`);
  expect(message).toContain(`master '${CONTRACT}'`);
}

const reportsNaming = (object: string) =>
  warnings.mock.calls.filter(([msg]) => String(msg).startsWith(`[security/controlled-by-parent] object "${object}"`));

describe('[#25760] the opt-in: the owner of a detail row updates it by id with READ on the master', () => {
  it('the column the opt-in names is the registry\'s injected owner_id — the detail declares none of its own', () => {
    const fields = (engine.getSchema(OBLIGATION) as { fields?: Record<string, unknown> } | undefined)?.fields ?? {};
    expect(Object.keys(fields)).toContain('owner_id');
    expect(reportsNaming(OBLIGATION), 'nothing to report: the opt-in names a column the schema carries').toEqual([]);
  });

  it('the owner, who reads the contract and cannot edit it: the by-id update is ADMITTED and the row changed', async () => {
    const pair = await seed(OBLIGATION, { owner: OWNER });
    expect(await updateById(OBLIGATION, pair, OWNER_CALLER)).toEqual({ kind: 'admitted' });
    expect((await stored(OBLIGATION, pair.row))?.name).toBe('edited by id');
  });

  it('CONTROL — the same grants, not the owner: refused by the master gate, and the row is as seeded', async () => {
    const pair = await seed(OBLIGATION, { owner: OWNER });
    expectMasterGateRefusal(await updateById(OBLIGATION, pair, STRANGER_CALLER), 'update', OBLIGATION);
    expect((await stored(OBLIGATION, pair.row))?.name).toBe('as seeded');
  });

  it('a row that names no owner admits nobody through the opt-in', async () => {
    const pair = await seed(OBLIGATION, { owner: null });
    expectMasterGateRefusal(await updateById(OBLIGATION, pair, OWNER_CALLER), 'update', OBLIGATION);
    expect((await stored(OBLIGATION, pair.row))?.name).toBe('as seeded');
  });

  it('the owner who cannot READ the contract is refused, and the row is as seeded', async () => {
    const pair = await seed(OBLIGATION, { owner: BLIND });
    expect(await updateById(OBLIGATION, pair, BLIND_CALLER)).toMatchObject({ kind: 'refused' });
    expect((await stored(OBLIGATION, pair.row))?.name).toBe('as seeded');
  });

  it('CONTROL — a master editor who owns nothing is admitted as before: the §3 rule is unchanged for everyone else', async () => {
    const pair = await seed(OBLIGATION, { owner: OWNER });
    expect(await updateById(OBLIGATION, pair, EDITOR_CALLER)).toEqual({ kind: 'admitted' });
    expect((await stored(OBLIGATION, pair.row))?.name).toBe('edited by id');
  });
});

describe('[#25760] what the opt-in does NOT widen — each shape keeps the master-edit rule', () => {
  it('a DELETE by the owner is refused by the master gate, and the row stays', async () => {
    const pair = await seed(OBLIGATION, { owner: OWNER });
    expectMasterGateRefusal(await deleteById(OBLIGATION, pair, OWNER_CALLER), 'delete', OBLIGATION);
    expect(await stored(OBLIGATION, pair.row)).not.toBeNull();
  });

  it('an INSERT under a contract the owner only reads is refused by the master gate, and no row lands', async () => {
    const pair = await seed(OBLIGATION, { owner: OWNER });
    const before = await rowsUnder(OBLIGATION, pair.contract);
    expectMasterGateRefusal(await insertUnder(OBLIGATION, pair, OWNER_CALLER), 'insert', OBLIGATION);
    expect(await rowsUnder(OBLIGATION, pair.contract)).toBe(before);
  });

  it('a PREDICATE update (multi: true) selecting the owner\'s own row is refused, and the row is as seeded', async () => {
    const pair = await seed(OBLIGATION, { owner: OWNER });
    const answer = await updateByPredicate(OBLIGATION, pair, OWNER_CALLER);
    expect(answer).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
    expect((answer as { message: string }).message).toContain('requires edit access to its master record');
    expect((await stored(OBLIGATION, pair.row))?.name).toBe('as seeded');
  });

  it('a DELEGATED update by the owner (on behalf of a delegator with the same grants) is refused by the master gate', async () => {
    // A delegated by-id write keeps BOTH floors at step 2.7 (ADR-0090 D10:
    // the detail's floor is not handed to the master gate on that path), so
    // the owner CREATED this row — its own floor passes — and the delegator
    // is bound by none; the only thing left to refuse is the master gate,
    // which is what the owner leg must leave standing on a delegated write.
    const pair = await seed(OBLIGATION, { owner: OWNER, createdBy: OWNER });
    expectMasterGateRefusal(await updateById(OBLIGATION, pair, onBehalfOf(OWNER_CALLER, DELEGATOR)), 'update', OBLIGATION);
    expect((await stored(OBLIGATION, pair.row))?.name).toBe('as seeded');
    // Control — delegation is the only variable: the same owner, acting for itself, on the same row.
    expect(await updateById(OBLIGATION, pair, OWNER_CALLER)).toEqual({ kind: 'admitted' });
    expect((await stored(OBLIGATION, pair.row))?.name).toBe('edited by id');
  });

  it('a body that RE-POINTS the row under another contract the owner only reads is refused: the owner may change the row, not move it', async () => {
    const pair = await seed(OBLIGATION, { owner: OWNER });
    const other = await seed(OBLIGATION, { owner: OWNER });
    expectMasterGateRefusal(
      await updateById(OBLIGATION, pair, OWNER_CALLER, { name: 'moved', contract: other.contract }),
      'update',
      OBLIGATION,
    );
    expect(await stored(OBLIGATION, pair.row)).toMatchObject({ name: 'as seeded', contract: pair.contract });
  });

  it('…while a body naming the row\'s OWN contract names no new master and is admitted', async () => {
    const pair = await seed(OBLIGATION, { owner: OWNER });
    expect(await updateById(OBLIGATION, pair, OWNER_CALLER, { name: 'kept', contract: pair.contract })).toEqual({ kind: 'admitted' });
    expect((await stored(OBLIGATION, pair.row))?.name).toBe('kept');
  });
});

describe('[#25760] the default is unchanged: a detail that has NOT opted in refuses its owner as before', () => {
  it('the owner of a task row, reading the contract, is refused by the master gate', async () => {
    const pair = await seed(TASK, { owner: OWNER });
    expectMasterGateRefusal(await updateById(TASK, pair, OWNER_CALLER), 'update', TASK);
    expect((await stored(TASK, pair.row))?.name).toBe('as seeded');
  });

  it('CONTROL — the master editor is admitted on the task', async () => {
    const pair = await seed(TASK, { owner: OWNER });
    expect(await updateById(TASK, pair, EDITOR_CALLER)).toEqual({ kind: 'admitted' });
  });
});

describe('[#25760] the opt-in on a detail whose rows carry no owner (ownership: none) names nobody', () => {
  it('the caller is refused by the master gate, and the object is reported once', async () => {
    const pair = await seed(NOTE);
    expectMasterGateRefusal(await updateById(NOTE, pair, OWNER_CALLER), 'update', NOTE);
    expect((await stored(NOTE, pair.row))?.name).toBe('as seeded');

    const reports = reportsNaming(NOTE);
    expect(reports).toHaveLength(1);
    expect(reports[0][0]).toContain('declares sharing.controlledByParent.ownerMayEdit: true but carries no owner_id column');
    expect(reports[0][1]).toEqual({ object: NOTE });

    // Resolved once per cache generation: a second write re-reads the cached relation, nothing is said again.
    await updateById(NOTE, pair, OWNER_CALLER);
    expect(reportsNaming(NOTE)).toHaveLength(1);
  });
});

describe('[#25760] ISecurityService.checkControlledByParentWrite answers as the write path does', () => {
  it('allow for the owner who reads the master; deny for the same grants without ownership', async () => {
    const pair = await seed(OBLIGATION, { owner: OWNER });
    expect(await security.checkControlledByParentWrite(OBLIGATION, pair.row, { ...OWNER_CALLER })).toEqual({ outcome: 'allow' });
    expect(await security.checkControlledByParentWrite(OBLIGATION, pair.row, { ...STRANGER_CALLER })).toMatchObject({ outcome: 'deny' });
  });

  it('deny for the owner of a detail that has not opted in', async () => {
    const pair = await seed(TASK, { owner: OWNER });
    expect(await security.checkControlledByParentWrite(TASK, pair.row, { ...OWNER_CALLER })).toMatchObject({ outcome: 'deny' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [#33250 — ruling A+] `sharing.controlledByParent.writeRequiresMasterRead: true`
//
// The maintainer's ruling 「读主记录即可增改删」: with the opt-in, whoever reads
// the master inserts, updates and deletes the detail under the detail's own
// grants; the default is unchanged. So the gate swaps ONE question — the master
// is asked READ instead of EDIT — on every shape it judges (a by-id write, an
// insert single or batch, a predicate write, a re-point, each hop of a chain),
// and the detail's own object grant, its own row-level policies and its FLS
// decide what they decided before.
// ─────────────────────────────────────────────────────────────────────────────

/** A fresh contract, a milestone under it and one row of `object` (a milestone detail) under the milestone. */
async function seedUnderMilestone(object: string, opts: { owner?: string | null; createdBy?: string } = {}) {
  const top = await seed(MILESTONE, { owner: REP });
  const n = ++seq;
  const row: Record<string, unknown> = { id: `${object}_${n}`, name: 'as seeded', milestone: top.row, created_by: opts.createdBy ?? REP };
  if (opts.owner !== undefined) row.owner_id = opts.owner;
  await engine.insert(object, [row], SYS);
  return { contract: top.contract, milestone: top.row, row: row.id as string };
}

/** The master gate's refusal for an opted-in detail: the caller's object and verb, and READ as the question. */
function expectMasterReadRefusal(answer: Answer, verb: string, object: string): void {
  expect(answer).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
  expect((answer as { message: string }).message).toContain(
    `[Security] Access denied: ${verb} on '${object}' requires read access to its master record`,
  );
}

const readerOf = (caller: object) => ({ ...caller });

describe('[#33250] the opt-in: whoever reads the master inserts, updates and deletes the detail under its own grants', () => {
  it('an INSERT under a contract the caller only reads is admitted, and the row lands', async () => {
    const pair = await seed(MILESTONE, { owner: REP });
    const before = await rowsUnder(MILESTONE, pair.contract);
    expect(await insertUnder(MILESTONE, pair, readerOf(STRANGER_CALLER))).toEqual({ kind: 'admitted' });
    expect(await rowsUnder(MILESTONE, pair.contract)).toBe(before + 1);
  });

  it('a BATCH insert naming two contracts the caller only reads is admitted whole', async () => {
    const a = await seed(MILESTONE, { owner: REP });
    const b = await seed(MILESTONE, { owner: REP });
    const answer = await landed(engine.insert(MILESTONE, [
      { name: 'batch a', contract: a.contract },
      { name: 'batch b', contract: b.contract },
    ], { context: { ...STRANGER_CALLER } } as never));
    expect(answer).toEqual({ kind: 'admitted' });
    expect(await rowsUnder(MILESTONE, a.contract)).toBe(2);
    expect(await rowsUnder(MILESTONE, b.contract)).toBe(2);
  });

  it('a by-id UPDATE of a row the caller neither owns nor created is admitted, and the row changed', async () => {
    const pair = await seed(MILESTONE, { owner: REP });
    expect(await updateById(MILESTONE, pair, STRANGER_CALLER)).toEqual({ kind: 'admitted' });
    expect((await stored(MILESTONE, pair.row))?.name).toBe('edited by id');
  });

  it('a by-id DELETE of a row the caller neither owns nor created is admitted, and the row is gone', async () => {
    const pair = await seed(MILESTONE, { owner: REP });
    expect(await deleteById(MILESTONE, pair, STRANGER_CALLER)).toEqual({ kind: 'admitted' });
    expect(await stored(MILESTONE, pair.row)).toBeNull();
  });

  it('a PREDICATE update (multi: true) is admitted, and the row changed', async () => {
    const pair = await seed(MILESTONE, { owner: REP });
    expect(await updateByPredicate(MILESTONE, pair, STRANGER_CALLER)).toEqual({ kind: 'admitted' });
    expect((await stored(MILESTONE, pair.row))?.name).toBe('edited by predicate');
  });

  it('a PREDICATE delete (multi: true) is admitted, and the row is gone', async () => {
    const pair = await seed(MILESTONE, { owner: REP });
    const answer = await landed(engine.delete(MILESTONE, { where: { id: { $in: [pair.row] } }, multi: true, context: { ...STRANGER_CALLER } } as never));
    expect(answer).toEqual({ kind: 'admitted' });
    expect(await stored(MILESTONE, pair.row)).toBeNull();
  });

  it('a body that RE-POINTS the row under another contract the caller reads is admitted', async () => {
    const pair = await seed(MILESTONE, { owner: REP });
    const other = await seed(MILESTONE, { owner: REP });
    expect(await updateById(MILESTONE, pair, STRANGER_CALLER, { name: 'moved', contract: other.contract })).toEqual({ kind: 'admitted' });
    expect(await stored(MILESTONE, pair.row)).toMatchObject({ name: 'moved', contract: other.contract });
  });

  it('CONTROL — a master editor is admitted as before', async () => {
    const pair = await seed(MILESTONE, { owner: REP });
    expect(await updateById(MILESTONE, pair, EDITOR_CALLER)).toEqual({ kind: 'admitted' });
  });
});

describe('[#33250] without read on the master, every write of an opted-in detail is refused', () => {
  it('no read grant on the contract: insert, update and delete are refused, and nothing is written', async () => {
    const pair = await seed(MILESTONE, { owner: BLIND });
    const before = await rowsUnder(MILESTONE, pair.contract);
    expectMasterReadRefusal(await insertUnder(MILESTONE, pair, BLIND_CALLER), 'insert', MILESTONE);
    expectMasterReadRefusal(await updateById(MILESTONE, pair, BLIND_CALLER), 'update', MILESTONE);
    expectMasterReadRefusal(await deleteById(MILESTONE, pair, BLIND_CALLER), 'delete', MILESTONE);
    expect(await rowsUnder(MILESTONE, pair.contract)).toBe(before);
    expect((await stored(MILESTONE, pair.row))?.name).toBe('as seeded');
  });

  it('a read grant on the contract object, but the contract row is hidden: insert, update and delete are refused', async () => {
    const pair = await seed(MILESTONE, { owner: HIDDEN, createdBy: HIDDEN });
    const before = await rowsUnder(MILESTONE, pair.contract);
    expectMasterReadRefusal(await insertUnder(MILESTONE, pair, HIDDEN_CALLER), 'insert', MILESTONE);
    expectMasterReadRefusal(await updateById(MILESTONE, pair, HIDDEN_CALLER), 'update', MILESTONE);
    expectMasterReadRefusal(await deleteById(MILESTONE, pair, HIDDEN_CALLER), 'delete', MILESTONE);
    expect(await rowsUnder(MILESTONE, pair.contract)).toBe(before);
    expect((await stored(MILESTONE, pair.row))?.name).toBe('as seeded');
  });

  it('a body that re-points the row under a contract the caller cannot read is refused, and the row stays', async () => {
    const pair = await seed(MILESTONE, { owner: HIDDEN, createdBy: HIDDEN });
    // A contract the hidden caller does read: its own.
    await engine.update(CONTRACT, { owner_id: HIDDEN, created_by: HIDDEN }, { where: { id: pair.contract }, context: { isSystem: true } } as never);
    const other = await seed(MILESTONE, { owner: REP });
    expect(await updateById(MILESTONE, pair, HIDDEN_CALLER, { name: 'edited' })).toEqual({ kind: 'admitted' });
    expectMasterReadRefusal(
      await updateById(MILESTONE, pair, HIDDEN_CALLER, { name: 'moved', contract: other.contract }),
      'update',
      MILESTONE,
    );
    expect(await stored(MILESTONE, pair.row)).toMatchObject({ name: 'edited', contract: pair.contract });
  });
});

describe('[#33250] the detail\'s own grants still decide', () => {
  it('reading the contract and holding READ alone on the milestone: insert, update and delete are refused by the object gate', async () => {
    const pair = await seed(MILESTONE, { owner: LOOKER });
    const before = await rowsUnder(MILESTONE, pair.contract);
    for (const answer of [
      await insertUnder(MILESTONE, pair, LOOKER_CALLER),
      await updateById(MILESTONE, pair, LOOKER_CALLER),
      await deleteById(MILESTONE, pair, LOOKER_CALLER),
    ]) {
      expect(answer).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
      expect((answer as { message: string }).message).not.toContain('its master record');
    }
    expect(await rowsUnder(MILESTONE, pair.contract)).toBe(before);
    expect((await stored(MILESTONE, pair.row))?.name).toBe('as seeded');
  });

  it('the milestone\'s own owner-keyed update policy decides as authored: its own row is admitted, another\'s is not', async () => {
    const own = await seed(MILESTONE, { owner: NARROW });
    const theirs = await seed(MILESTONE, { owner: REP });
    expect(await updateById(MILESTONE, own, NARROW_CALLER)).toEqual({ kind: 'admitted' });
    expect((await stored(MILESTONE, own.row))?.name).toBe('edited by id');
    expect(await updateById(MILESTONE, theirs, NARROW_CALLER)).toMatchObject({ kind: 'refused' });
    expect((await stored(MILESTONE, theirs.row))?.name).toBe('as seeded');
  });
});

describe('[#33250] chains: each hop asks what the object written at that hop declares', () => {
  it('a step (opted in) under a milestone (opted in): the caller who reads the contract writes the step', async () => {
    const chain = await seedUnderMilestone(STEP, { owner: REP });
    expect(await updateById(STEP, { contract: chain.contract, row: chain.row }, STRANGER_CALLER)).toEqual({ kind: 'admitted' });
    expect(await landed(engine.insert(STEP, { name: 'inserted', milestone: chain.milestone }, { context: { ...STRANGER_CALLER } } as never)))
      .toEqual({ kind: 'admitted' });
  });

  it('…and the caller who cannot read the contract cannot: the milestone it would write under is not readable', async () => {
    const chain = await seedUnderMilestone(STEP, { owner: BLIND });
    expectMasterReadRefusal(await updateById(STEP, { contract: chain.contract, row: chain.row }, BLIND_CALLER), 'update', STEP);
    expect((await stored(STEP, chain.row))?.name).toBe('as seeded');
  });

  it('a line (NOT opted in) under a milestone (opted in): edit on the milestone, then read on its contract, admits the reader', async () => {
    const chain = await seedUnderMilestone(LINE, { owner: REP });
    expect(await updateById(LINE, { contract: chain.contract, row: chain.row }, STRANGER_CALLER)).toEqual({ kind: 'admitted' });
    expect((await stored(LINE, chain.row))?.name).toBe('edited by id');
  });

  it('…and refuses the caller who cannot read the contract, on the milestone\'s hop', async () => {
    const chain = await seedUnderMilestone(LINE, { owner: BLIND });
    const answer = await updateById(LINE, { contract: chain.contract, row: chain.row }, BLIND_CALLER);
    expect(answer).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
    expect((await stored(LINE, chain.row))?.name).toBe('as seeded');
  });
});

describe('[#33250] on behalf of another user: each principal is asked the same read question', () => {
  it('both read the contract: the delegated insert is admitted', async () => {
    const pair = await seed(MILESTONE, { owner: REP });
    const before = await rowsUnder(MILESTONE, pair.contract);
    expect(await insertUnder(MILESTONE, pair, onBehalfOf(STRANGER_CALLER, DELEGATOR))).toEqual({ kind: 'admitted' });
    expect(await rowsUnder(MILESTONE, pair.contract)).toBe(before + 1);
  });

  it('the delegator cannot read the contract: the delegated insert is refused, and no row lands', async () => {
    const pair = await seed(MILESTONE, { owner: REP });
    const before = await rowsUnder(MILESTONE, pair.contract);
    expectMasterReadRefusal(await insertUnder(MILESTONE, pair, onBehalfOf(STRANGER_CALLER, BLIND_DELEGATOR)), 'insert', MILESTONE);
    expect(await rowsUnder(MILESTONE, pair.contract)).toBe(before);
  });

  it('the agent cannot read the contract: the delegated insert is refused, and no row lands', async () => {
    const pair = await seed(MILESTONE, { owner: REP });
    const before = await rowsUnder(MILESTONE, pair.contract);
    expectMasterReadRefusal(await insertUnder(MILESTONE, pair, onBehalfOf(BLIND_CALLER, DELEGATOR)), 'insert', MILESTONE);
    expect(await rowsUnder(MILESTONE, pair.contract)).toBe(before);
  });

  it('a delegated by-id update (both read the contract; the agent created the row, so its own floor passes) is admitted', async () => {
    const pair = await seed(MILESTONE, { owner: REP, createdBy: STRANGER });
    expect(await updateById(MILESTONE, pair, onBehalfOf(STRANGER_CALLER, DELEGATOR))).toEqual({ kind: 'admitted' });
    expect((await stored(MILESTONE, pair.row))?.name).toBe('edited by id');
  });
});

describe('[#33250] the default is unchanged: a detail that has NOT opted in asks edit on the master for every write', () => {
  it('the master reader is refused insert, update and delete on the task, each by the master gate', async () => {
    const pair = await seed(TASK, { owner: STRANGER });
    expectMasterGateRefusal(await insertUnder(TASK, pair, STRANGER_CALLER), 'insert', TASK);
    expectMasterGateRefusal(await updateById(TASK, pair, STRANGER_CALLER), 'update', TASK);
    expectMasterGateRefusal(await deleteById(TASK, pair, STRANGER_CALLER), 'delete', TASK);
    expect((await stored(TASK, pair.row))?.name).toBe('as seeded');
  });
});

describe('[#33250] ISecurityService.checkControlledByParentWrite answers the opt-in as the write path does', () => {
  it('allow for a master reader who neither owns nor created the row', async () => {
    const pair = await seed(MILESTONE, { owner: REP });
    expect(await security.checkControlledByParentWrite(MILESTONE, pair.row, { ...STRANGER_CALLER })).toEqual({ outcome: 'allow' });
  });

  it('deny on object_permission when the contract may not be read at all', async () => {
    const pair = await seed(MILESTONE, { owner: BLIND });
    expect(await security.checkControlledByParentWrite(MILESTONE, pair.row, { ...BLIND_CALLER }))
      .toEqual({ outcome: 'deny', leg: 'object_permission' });
  });

  it('deny on row_level_security when the contract row is hidden from the caller', async () => {
    const pair = await seed(MILESTONE, { owner: HIDDEN });
    expect(await security.checkControlledByParentWrite(MILESTONE, pair.row, { ...HIDDEN_CALLER }))
      .toEqual({ outcome: 'deny', leg: 'row_level_security' });
  });

  it('on behalf of a delegator who cannot read the contract: deny', async () => {
    const pair = await seed(MILESTONE, { owner: REP });
    expect(await security.checkControlledByParentWrite(MILESTONE, pair.row, onBehalfOf(STRANGER_CALLER, BLIND_DELEGATOR)))
      .toMatchObject({ outcome: 'deny' });
  });
});
