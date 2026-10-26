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
const ORG = 'org_omd';

const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
/** READ on every contract, EDIT on none: the master is readable and NOT editable. */
const MASTER_READ = { allowRead: true, viewAllRecords: true };
/** Modify All Data on the contract, which the sharing verdict answers `allow` for. */
const MASTER_EDIT = { allowRead: true, allowCreate: true, allowEdit: true, viewAllRecords: true, modifyAllRecords: true };
const DETAILS = { [OBLIGATION]: CRUD, [TASK]: CRUD, [NOTE]: CRUD };

const REQUESTER_SET = PermissionSetSchema.parse({ name: 'omd_requester', objects: { [CONTRACT]: MASTER_READ, ...DETAILS } });
const EDITOR_SET = PermissionSetSchema.parse({ name: 'omd_editor', objects: { [CONTRACT]: MASTER_EDIT, ...DETAILS } });
/** CRUD on the details and NO grant on the contract: the master is not readable. */
const BLIND_SET = PermissionSetSchema.parse({ name: 'omd_blind', objects: { ...DETAILS } });
const SETS = [MEMBER_DEFAULT, REQUESTER_SET, EDITOR_SET, BLIND_SET];

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
    ],
  } as never);
  await engine.syncSchemas();

  await engine.insert('sys_user', [REP, OWNER, STRANGER, EDITOR, BLIND, DELEGATOR].map((id) => ({
    id, name: id, email: `${id}@omd.test`,
  })), SYS);
  await engine.insert('sys_organization', [{ id: ORG, name: 'OMD', slug: 'omd' }], SYS);
  // The delegator holds the requester's set through a stored position row
  // owned by ORG, so the on-behalf-of link resolves to the same grants the
  // owner holds — and NO `sys_member` row, so no ownership floor binds the
  // delegator's pass: the only thing left to refuse a delegated update is the
  // master gate, which is the pin (see the chain-middle-master suite for why
  // the row lands straight through the driver).
  await (engine as any).getDriver('sys_user_position').create('sys_user_position', {
    id: 'up_delegator', user_id: DELEGATOR, position: REQUESTER_SET.name, organization_id: ORG,
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
