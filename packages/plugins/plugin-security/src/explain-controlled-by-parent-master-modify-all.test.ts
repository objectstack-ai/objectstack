// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0055] `security/explain`'s record-grained verdict for an update and a
// delete of a `controlled_by_parent` record whose MASTER the caller may edit
// through `modifyAllRecords` on the master alone, beside the door's answer for
// the same caller and row.
//
// ## Why this route has its own file
//
// The console's record header asks exactly this question: it posts
// `security/explain` with a `recordId`, once for `update` and once for
// `delete`, and shows Edit and Delete on `decision.record.visible`. A sales
// manager who holds `viewAllRecords` + `modifyAllRecords` on the master (the
// account) and plain edit on the detail (a contract, a quote) reaches the
// detail's rows only through the master: the detail grants no bypass of its
// own, and the master is owned and created by somebody else.
//
// The routes to the master that the explain/door pair already pins beside each
// other (`controlled-by-parent-write-member.test.ts`, and the REST twin
// `packages/qa/dogfood/test/cbp-explain-master-write.dogfood.test.ts`) are an
// owned master, a master shared at `edit`, a master an RLS policy admits and a
// two-hop chain. None of them is the Modify All Data bypass, which the master
// check reaches by two seams of its own: the master's ownership floor comes off
// on the sharing write verdict `allow` that the bypass answers, and the master's
// record-sharing leg is the bypass branch of `canEdit`. This file pins that
// route, with the floor armed on both objects.
//
// ## The control
//
// The viewer holds `viewAllRecords` on the master WITHOUT `modifyAllRecords`:
// the near neighbour of the manager's grant. They read every master and every
// detail, and may edit neither the master nor, therefore, its details. Both
// faces must refuse them, and explain must name the master check's leg. A read
// bypass that leaked into a write verdict, or an explanation that stopped
// asking the master check, fails this half.
//
// ## The rig
//
// The real `SecurityPlugin` over a real `ObjectQL` and SQL driver
// (better-sqlite3, in memory), the real `SharingService` as the kernel's
// `sharing` service with its middleware on the engine after this plugin's, and
// the platform's own `member_default` set, whose wildcard `owner_only_writes` /
// `owner_only_deletes` floor (`created_by == current_user.id`, positions
// `['org_member']`) is armed for both callers. The armed case below shows it
// binding each of them on this stack, through explain's own `rls` record.
//
// `@objectstack/core` and `@objectstack/plugin-sharing` resolve through their
// built `dist/` here, as this package's other suites read them.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SharingService, buildSharingMiddleware, SysRecordShare } from '@objectstack/plugin-sharing';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { ExplainDecision } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { wireEngineSecuritySource } from './engine-security-source.testkit.js';

const SYS = { context: { isSystem: true } } as never;
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

const ACCOUNT = 'cbm_account';
const CONTRACT = 'cbm_contract';
/**
 * The floor witness: an object with no master and no owner column, whose rows
 * neither caller created. Explaining a write of one shows the floor's own
 * predicate in the `rls` record, for each caller.
 */
const MEMO = 'cbm_memo';

/** The master's owner and creator, and the creator of every detail row: nobody the suite explains. */
const REP = 'usr_rep';
const MANAGER = 'usr_manager';
const VIEWER = 'usr_viewer';

const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };

/** Modify All Data on the master only; the detail grants plain CRUD, reads included, and no write bypass. */
const MANAGER_SET = PermissionSetSchema.parse({
  name: 'cbm_manager',
  objects: {
    [ACCOUNT]: { ...CRUD, viewAllRecords: true, modifyAllRecords: true },
    [CONTRACT]: { ...CRUD, viewAllRecords: true, modifyAllRecords: false },
    [MEMO]: { allowRead: true, allowEdit: true, viewAllRecords: true },
  },
});

/** The control: the same grants with the master's write bypass withheld. */
const VIEWER_SET = PermissionSetSchema.parse({
  name: 'cbm_viewer',
  objects: {
    [ACCOUNT]: { allowRead: true, allowCreate: true, allowEdit: true, viewAllRecords: true, modifyAllRecords: false },
    [CONTRACT]: { ...CRUD, viewAllRecords: true, modifyAllRecords: false },
    [MEMO]: { allowRead: true, allowEdit: true, viewAllRecords: true },
  },
});

/** The execution context `resolveAuthzContext` hands the middleware for an organization member holding the set. */
const callerOf = (userId: string, set: string) => ({
  userId,
  positions: ['org_member'],
  permissions: [set, 'member_default'],
  posture: 'MEMBER',
});
const MANAGER_CALLER = callerOf(MANAGER, MANAGER_SET.name);
const VIEWER_CALLER = callerOf(VIEWER, VIEWER_SET.name);

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
let plugin: SecurityPlugin;

beforeAll(async () => {
  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.explain-controlled-by-parent-master-modify-all',
    name: 'Explain: a controlled_by_parent record under a master edited through Modify All Data',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysRecordShare,
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
        name: CONTRACT,
        label: 'Contract',
        sharingModel: 'controlled_by_parent',
        tenancy: { enabled: false },
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
          account: { name: 'account', type: 'master_detail', reference: ACCOUNT, required: true },
          created_by: { name: 'created_by', type: 'text' },
        },
      },
      {
        name: MEMO,
        label: 'Memo',
        sharingModel: 'private',
        tenancy: { enabled: false },
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
          created_by: { name: 'created_by', type: 'text' },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  await engine.insert(ACCOUNT, [{ id: 'acct_rep', name: "the rep's account", owner_id: REP, created_by: REP }], SYS);
  // One detail row per (caller, verb), so a delete that lands never changes another case's row.
  await engine.insert(CONTRACT, [
    { id: 'c_manager_update', name: 'contract', account: 'acct_rep', created_by: REP },
    { id: 'c_manager_delete', name: 'contract', account: 'acct_rep', created_by: REP },
    { id: 'c_viewer_update', name: 'contract', account: 'acct_rep', created_by: REP },
    { id: 'c_viewer_delete', name: 'contract', account: 'acct_rep', created_by: REP },
  ], SYS);
  await engine.insert(MEMO, [{ id: 'm_rep', name: "the rep's memo", created_by: REP }], SYS);

  const sets = [MEMBER_DEFAULT, MANAGER_SET, VIEWER_SET];
  let security: unknown;
  let sharing: SharingService | undefined;
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        type === 'permission' ? sets.find((s) => s.name === name) ?? null : engine.getSchema(name) ?? null,
      list: async () => sets,
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
  plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  // The engine's security source, as `ObjectQLPlugin.init` wires it on a kernel (ADR-0139 D2).
  wireEngineSecuritySource(engine, () => plugin);
  sharing = new SharingService({ engine: engine as never, securityService: () => security as never });
  engine.registerMiddleware(buildSharingMiddleware(sharing, ctx.logger) as never, { object: '*' });
});

afterAll(async () => {
  try { await engine?.destroy(); } catch { /* noop */ }
});

const explain = (operation: 'update' | 'delete', recordId: string, caller: object): Promise<ExplainDecision> =>
  plugin.explainAccessForCaller({ object: CONTRACT, operation, recordId }, { ...caller });

const door = (operation: 'update' | 'delete', recordId: string, caller: object): Promise<Answer> =>
  operation === 'update'
    ? landed(engine.update(CONTRACT, { name: 'edited' }, { where: { id: recordId }, context: { ...caller } } as never))
    : landed(engine.delete(CONTRACT, { where: { id: recordId }, context: { ...caller } } as never));

const sharingDetailOf = (d: ExplainDecision): string =>
  String(d.layers.find((l) => l.layer === 'sharing')?.record?.detail ?? '');

describe('[ADR-0055] explain answers a controlled_by_parent write under a Modify All Data master as the door does', () => {
  it('armed: every row was created by another user, and the ownership floor binds both callers on this stack', async () => {
    const stored = (await engine.find(CONTRACT, { where: {}, context: { isSystem: true } } as never)) as Array<Record<string, unknown>>;
    expect(stored.map((r) => r.created_by)).toEqual([REP, REP, REP, REP]);
    // The floor is the only update policy these sets carry: explained on a row
    // the caller did not create, the `rls` record names its predicate,
    // `created_by == current_user.id`, and it excludes the row.
    for (const caller of [MANAGER_CALLER, VIEWER_CALLER]) {
      const d = await plugin.explainAccessForCaller({ object: MEMO, operation: 'update', recordId: 'm_rep' }, { ...caller });
      const rls = d.layers.find((l) => l.layer === 'rls')?.record;
      expect(rls?.rowFilter, `the floor's predicate for ${caller.userId}`).toEqual({ created_by: caller.userId });
      expect(rls?.outcome).toBe('excluded');
    }
  });

  for (const verb of ['update', 'delete'] as const) {
    it(`${verb}: the master's Modify All Data holder, who created neither row, is explained writable and the door admits`, async () => {
      const id = `c_manager_${verb}`;
      const explained = await explain(verb, id, MANAGER_CALLER);
      const answered = await door(verb, id, MANAGER_CALLER);
      expect(answered, `${verb} door, the manager`).toEqual({ kind: 'admitted' });
      expect(explained.record, `explain ${verb}, the manager`).toMatchObject({ recordId: id, visible: true });
      expect(sharingDetailOf(explained)).not.toContain('master-detail write check');
    });

    it(`${verb}: control, the master's reader without Modify All Data is refused by both, on the master leg`, async () => {
      const id = `c_viewer_${verb}`;
      const explained = await explain(verb, id, VIEWER_CALLER);
      const answered = await door(verb, id, VIEWER_CALLER);
      expect(answered, `${verb} door, the viewer`).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
      expect((answered as { message: string }).message).toMatch(/requires edit access to its master record/);
      expect(explained.record, `explain ${verb}, the viewer`).toEqual({ recordId: id, visible: false, decidedBy: 'sharing' });
      expect(sharingDetailOf(explained)).toMatch(new RegExp(`refuses this ${verb} on its '[a-z_]+' leg`));
    });
  }

  it("reference: the master's own door gives the two callers the answers the master check gives them", async () => {
    const asManager = await landed(engine.update(ACCOUNT, { name: 'renamed' }, { where: { id: 'acct_rep' }, context: { ...MANAGER_CALLER } } as never));
    const asViewer = await landed(engine.update(ACCOUNT, { name: 'renamed' }, { where: { id: 'acct_rep' }, context: { ...VIEWER_CALLER } } as never));
    expect(asManager, 'the manager PATCHes the master').toEqual({ kind: 'admitted' });
    expect(asViewer, 'the viewer PATCHes the master').toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
  });
});
