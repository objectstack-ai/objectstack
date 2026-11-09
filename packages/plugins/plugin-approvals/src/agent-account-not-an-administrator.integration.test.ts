// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0151 D3] An AI service account is never an approvals administrator,
 * whatever it holds.
 *
 * ## Why this file exists
 *
 * `ApprovalService.isOverrideActor` and the `admin_rescue` administrators'
 * slate read standing partly by NAME off the envelope's `permissions`
 * (`admin_full_access` for the platform arm, `ORGANIZATION_ADMIN_GRANTS` for
 * the tenant arm and the slate). The agent ceiling clears bits on a set's
 * body, not names, so the resolver withholds those names from an account's
 * `permissions` instead (`resolveUserAuthzGrants`, core). An account can only
 * hold such a grant row through a system or seed writer (a non-system write is
 * refused at assignment), which is the row this file stores.
 *
 * ## What this pins
 *
 * Driven through the real `ApprovalService` on a real `ObjectQL` over
 * `SqlDriver` (better-sqlite3, in-memory), with each actor's envelope built
 * from the real `resolveUserAuthzGrants`:
 *
 * - an account holding `organization_admin` in the organization is not on the
 *   `admin_rescue` slate, while a person holding the same grant is;
 * - an account holding `admin_full_access`, or `organization_admin`, cannot
 *   decide a staffed request it is not on — answered as for a missing id, the
 *   request left pending — while a person holding the same grant overrides it;
 * - the premise: the account's envelope carries neither name, the person's
 *   carries it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import {
  bindSecurityCatalogReader, resolveUserAuthzGrants, type SecurityCatalogEntry, type SecurityCatalogReader,
} from '@objectstack/core';
import type { ApprovalRequestRow } from '@objectstack/spec/contracts';
import { ApprovalService, type ApprovalNodeAutoOutcome } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { relaxTenantColumns } from './pre-18-tenant-column.testkit.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const ORG = 'org_a';

/** People and accounts. An account is a `sys_user` row of kind `agent`. */
const USERS = [
  { id: 'u_sub', principal_kind: 'human' },
  { id: 'u_alice', principal_kind: 'human' },
  { id: 'u_owner', principal_kind: 'human' },
  { id: 'u_root', principal_kind: 'human' },
  { id: 'u_bot_org', principal_kind: 'agent' },
  { id: 'u_bot_root', principal_kind: 'agent' },
].map((u) => ({ ...u, name: u.id, email: `${u.id}@example.com` }));

/**
 * `sys_user_permission_set`, written as the system: the account rows are the
 * ones only a system or seed writer can store.
 */
const GRANTS: Array<[string, string, string | null]> = [
  ['u_owner', 'organization_admin', ORG],
  ['u_bot_org', 'organization_admin', ORG],
  ['u_root', 'admin_full_access', ORG],
  ['u_bot_root', 'admin_full_access', ORG],
];

const text = (name: string) => ({ name, label: name, type: 'text' as const });
const objectDef = (name: string, fields: string[]) => ({
  name,
  label: name,
  fields: Object.fromEntries([
    ['id', { ...text('id'), primaryKey: true }],
    ...fields.map((f) => [f, text(f)]),
  ]),
});

function catalogServing(names: string[]): SecurityCatalogReader {
  const entry = (name: string): SecurityCatalogEntry => ({
    type: 'permission', name, definition: { name }, source: 'registry',
  });
  return {
    async resolve(type, name) {
      return type === 'permission' && names.includes(name) ? entry(name) : undefined;
    },
    async list(type) {
      return type === 'permission' ? names.map(entry) : [];
    },
  };
}

async function packageObjects(): Promise<any[]> {
  let manifest: any;
  const ctx: any = {
    getService: (name: string) => {
      if (name === 'manifest') return { register: (m: any) => { manifest = m; } };
      throw new Error(`no service '${name}'`);
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };
  await new ApprovalsServicePlugin().init(ctx);
  return manifest.objects;
}

function opened(result: ApprovalRequestRow | ApprovalNodeAutoOutcome): ApprovalRequestRow {
  if ('autoApproved' in result) throw new Error('expected an OPENED approval request, got an auto-approval outcome');
  return result;
}

describe('[ADR-0151 D3] an AI service account is never an approvals administrator, whatever it holds', () => {
  let engine: ObjectQL;
  let svc: ApprovalService;
  let now = Date.parse('2026-11-09T09:00:00.000Z');
  let seq = 0;

  /** The envelope a transport builds for `userId`, from the real resolver. */
  const actor = async (userId: string) => {
    const grants = await resolveUserAuthzGrants(engine as any, userId, { tenantId: ORG });
    return {
      userId,
      tenantId: ORG,
      positions: grants.positions,
      permissions: grants.permissions,
      systemPermissions: grants.systemPermissions,
      ...(grants.posture ? { posture: grants.posture } : {}),
      ...(grants.principalKind ? { principalKind: grants.principalKind } : {}),
    } as any;
  };

  const open = async (approvers: any[]): Promise<ApprovalRequestRow> => {
    const i = ++seq;
    await engine.insert('crm_deal', { id: `D_${i}`, title: `d${i}` }, { context: SYSTEM } as any);
    return opened(await svc.openNodeRequest({
      object: 'crm_deal', recordId: `D_${i}`, runId: `run_${i}`, nodeId: 'review', flowName: 'deal_review',
      config: { approvers, behavior: 'first_response' } as any,
      submitterId: 'u_sub', record: { id: `D_${i}`, title: `d${i}` }, organizationId: ORG,
    } as any, { userId: 'u_sub', tenantId: ORG, positions: [], permissions: [] } as any));
  };

  /** What a decision attempt DID: the throw's code, the request's status, and whether a decision was recorded. */
  const attemptDecide = async (userId: string, id: string) => {
    let threw: string | null = null;
    try {
      await svc.decideNode(id, { decision: 'approve', actorId: userId } as any, await actor(userId));
    } catch (e) {
      threw = String((e as any)?.message ?? e).split(':')[0];
    }
    const [row]: any[] = await engine.find('sys_approval_request', { where: { id }, context: SYSTEM });
    const actions: any[] = await engine.find('sys_approval_action', { where: { request_id: id }, context: SYSTEM });
    const decision = actions.find((a) => a.actor_id === userId && a.action === 'approve');
    return { threw, status: row?.status, decided: Boolean(decision), viaOverride: Boolean(decision?.via_override) };
  };

  beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
    }), true);
    await engine.init();
    const defs = [
      objectDef('sys_user', ['name', 'email', 'principal_kind']),
      objectDef('sys_member', ['user_id', 'organization_id', 'role']),
      objectDef('sys_user_position', ['user_id', 'position', 'organization_id']),
      objectDef('sys_user_permission_set', ['user_id', 'permission_set', 'organization_id']),
      objectDef('crm_deal', ['title']),
      ...(await packageObjects()),
    ];
    for (const def of defs) engine.registry.registerObject(def as any, 'approvals-test', 'approvals-test');
    await engine.syncSchemas();
    await relaxTenantColumns(engine, ['sys_user', 'sys_user_permission_set', 'crm_deal']);
    bindSecurityCatalogReader(engine, catalogServing(['organization_admin', 'admin_full_access']));
    for (const u of USERS) await engine.insert('sys_user', u, { context: SYSTEM } as any);
    for (const [i, u] of USERS.entries()) {
      await engine.insert('sys_member', { id: `m_${i}`, user_id: u.id, organization_id: ORG, role: 'member' },
        { context: SYSTEM } as any);
    }
    for (const [i, [user_id, permission_set, organization_id]] of GRANTS.entries()) {
      await engine.insert('sys_user_permission_set', { id: `ups_${i}`, user_id, permission_set, organization_id },
        { context: SYSTEM } as any);
    }
    svc = new ApprovalService({
      engine: engine as any,
      clock: { now: () => new Date(now += 1000) },
      logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any,
    });
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('the premise: an account\'s envelope carries no administrative set name, a person\'s carries it', async () => {
    expect((await actor('u_bot_org')).permissions).not.toContain('organization_admin');
    expect((await actor('u_bot_root')).permissions).not.toContain('admin_full_access');
    expect((await actor('u_bot_root')).principalKind).toBe('agent');
    expect((await actor('u_owner')).permissions).toContain('organization_admin');
    expect((await actor('u_root')).permissions).toContain('admin_full_access');
  });

  it('an account holding organization_admin is not on the admin_rescue slate; a person holding it is', async () => {
    const row = await open([{ type: 'position', value: 'sales_manager' }]);
    expect(row.status).toBe('pending');
    expect([...(row.pending_approvers ?? [])].sort()).toEqual(['u_owner']);
  });

  it.each(['u_bot_root', 'u_bot_org'])(
    '%s cannot decide a staffed request it is not on: answered as for a missing id, left pending',
    async (account) => {
      const row = await open([{ type: 'user', value: 'u_alice' }]);
      expect(await attemptDecide(account, row.id)).toEqual({
        threw: 'REQUEST_NOT_FOUND', status: 'pending', decided: false, viaOverride: false,
      });
    },
  );

  it.each(['u_root', 'u_owner'])(
    'CONTROL: %s, a person holding the same grant, overrides the same staffed request',
    async (person) => {
      const row = await open([{ type: 'user', value: 'u_alice' }]);
      expect(await attemptDecide(person, row.id)).toEqual({
        threw: null, status: 'approved', decided: true, viaOverride: true,
      });
    },
  );
});
