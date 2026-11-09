// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0151 D3] An AI service account's API key admits the ACCOUNT as the
 * subject: `userId` the account, `principalKind: 'agent'`, no `onBehalfOf`,
 * no system permission — on the `/mcp` door and on the dispatcher's own face —
 * and its sets are read under the agent ceiling.
 *
 * ## The rig
 *
 * The REAL `resolveExecutionContext` → `resolveAuthzContext` (this package's
 * vitest alias resolves `@objectstack/core` to its source) over a table
 * double, and the context it builds handed to the REAL `SecurityPlugin`. Only
 * the OAuth token verifier is faked, for the OAuth-delegated CONTROL.
 *
 * - `u_bot` is an AI service account (`principal_kind: 'agent'`) owned by
 *   `u_mia`, a plain member of org_alpha. It holds `crm_lead_reader` and
 *   `crm_lead_super` in org_alpha, and — as no registration door would ever
 *   write, but a store can hold — `admin_full_access` owned by the Default
 *   Organization: the row that anchors platform standing for a person. The
 *   account never carries that name, so it is never held.
 * - `crm_lead_super` breaches the agent ceiling: View All, Modify All,
 *   transfer and the recycle bin on `crm_lead`, a system permission and an
 *   admin scope. It is the set "assigned, then edited": the refusal at
 *   assignment cannot see an edit, so what the account reads is the set as it
 *   stands now, and the clamp is what holds.
 * - `u_mia` (the CONTROL) is a person holding the SAME two sets, and her own
 *   key.
 * - The `everyone` anchor binds `crm_contact_reader`, so a person reads
 *   contacts through it and the account must not.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';

import { resolveExecutionContext } from './resolve-execution-context.js';
import { hashApiKey } from './api-key.js';
import { bindCatalogFromTables } from './security-catalog.testkit.js';

const ALPHA = 'org_alpha';
const DEFAULT_ORG = 'org_default';
const LEAD = 'crm_lead';
const CONTACT = 'crm_contact';
const FUTURE = '2999-01-01T00:00:00Z';
const BOT_KEY = 'osk_31739_account_key';
const MIA_KEY = 'osk_31739_person_key';
const CLIENT = 'agent-client-1';

/** One source for every set: the catalog rows core reads and the bodies the security plugin reads. */
const SETS: PermissionSet[] = [
  { name: 'crm_lead_reader', label: 'Lead reader', objects: { [LEAD]: { allowRead: true } } },
  {
    name: 'crm_lead_super',
    label: 'Lead superuser',
    objects: {
      [LEAD]: {
        allowRead: true,
        allowEdit: true,
        viewAllRecords: true,
        modifyAllRecords: true,
        allowTransfer: true,
        allowRestoreOwnDeleted: true,
        manageRecycleBin: true,
      },
    },
    systemPermissions: ['manage_users'],
    adminScope: { businessUnit: 'bu_root', includeSubtree: true, manageAssignments: true, assignablePermissionSets: [] },
  },
  { name: 'crm_contact_reader', label: 'Contact reader', objects: { [CONTACT]: { allowRead: true } } },
  // The superuser wildcard: every object, through the two bypass bits alone.
  { name: 'admin_full_access', label: 'Admin', objects: { '*': { viewAllRecords: true, modifyAllRecords: true } } },
] as PermissionSet[];

function tables(): Record<string, any[]> {
  return {
    sys_api_key: [
      { id: 'k_bot', key: hashApiKey(BOT_KEY), revoked: false, user_id: 'u_bot', expires_at: FUTURE, active_organization_id: ALPHA },
      { id: 'k_mia', key: hashApiKey(MIA_KEY), revoked: false, user_id: 'u_mia', expires_at: FUTURE, active_organization_id: ALPHA },
    ],
    sys_user: [
      { id: 'u_bot', email: 'bot-31739@agents.invalid', principal_kind: 'agent', accountable_user_id: 'u_mia' },
      { id: 'u_mia', email: 'mia@example.com', principal_kind: 'human' },
    ],
    sys_member: [
      { user_id: 'u_bot', organization_id: ALPHA, role: 'member' },
      { user_id: 'u_mia', organization_id: ALPHA, role: 'member' },
    ],
    sys_user_position: [],
    sys_user_permission_set: [
      { user_id: 'u_bot', permission_set: 'crm_lead_reader', organization_id: ALPHA },
      { user_id: 'u_bot', permission_set: 'crm_lead_super', organization_id: ALPHA },
      { user_id: 'u_bot', permission_set: 'admin_full_access', organization_id: DEFAULT_ORG },
      { user_id: 'u_mia', permission_set: 'crm_lead_reader', organization_id: ALPHA },
      { user_id: 'u_mia', permission_set: 'crm_lead_super', organization_id: ALPHA },
    ],
    sys_organization: [{ id: DEFAULT_ORG, slug: 'default' }],
    sys_permission_set: SETS.map((s) => ({
      id: `ps_${s.name}`,
      name: s.name,
      object_permissions: JSON.stringify(s.objects ?? {}),
      ...(s.systemPermissions ? { system_permissions: JSON.stringify(s.systemPermissions) } : {}),
    })),
    sys_position: [{ id: 'pos_everyone', name: 'everyone', organization_id: null }],
    sys_position_permission_set: [{ position_id: 'pos_everyone', permission_set_id: 'ps_crm_contact_reader' }],
  };
}

/** Equality, `$in` and a NULL column; every other shape refused loudly. */
function matchesWhere(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([field, cond]) => {
    if (field.startsWith('$')) throw new Error(`fixture where-matcher: unsupported combinator '${field}'`);
    if (cond !== null && typeof cond === 'object') {
      if (!Array.isArray((cond as any).$in)) throw new Error(`fixture where-matcher: unsupported operator on '${field}'`);
      return (cond as any).$in.includes(row[field]);
    }
    if (cond === null) return (row[field] ?? null) === null;
    return row[field] === cond;
  });
}

function schemaOf(name: string) {
  return {
    name,
    sharingModel: 'public_read_write',
    fields: { id: { name: 'id' }, name: { name: 'name', type: 'text' }, organization_id: { name: 'organization_id', type: 'text' } },
  };
}

type Verified = { userId: string; scopes: string[]; clientId?: string; organizationId?: string };

function rig() {
  const t = tables();
  let middleware: any;
  const ql: any = bindCatalogFromTables({
    registerMiddleware: (mw: any) => { if (!middleware) middleware = mw; },
    getSchema: (name: string) => (name.startsWith('sys_') ? undefined : schemaOf(name)),
    async find(object: string, q: any = {}) {
      const rows = (t[object] ?? []).filter((r) => matchesWhere(r, q?.where));
      return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
    },
    async findOne(object: string, q: any = {}) {
      assertEngineFindOnePredicate(object, q);
      return (t[object] ?? []).filter((r) => matchesWhere(r, q?.where))[0] ?? null;
    },
  }, t);

  const tokens = new Map<string, Verified>();
  const services: Record<string, any> = {
    manifest: { register: vi.fn() },
    objectql: ql,
    metadata: {
      get: async (_type: string, name: string) => (name.startsWith('sys_') ? null : schemaOf(name)),
      list: async () => SETS,
    },
    auth: { verifyMcpAccessToken: async (bearer: string) => tokens.get(bearer) ?? null },
  };

  /** Resolve a request carrying `headers`, on the `/mcp` door (`acceptOAuthAccessToken`) or the dispatcher's face. */
  const resolve = (headers: Record<string, string>, mcp: boolean): Promise<ExecutionContext> =>
    resolveExecutionContext({
      ...(mcp ? { acceptOAuthAccessToken: true } : {}),
      getService: async (name: string) => services[name],
      getQl: async () => ql,
      request: { headers },
    });

  const resolveToken = async (verified: Verified): Promise<ExecutionContext> => {
    const bearer = `h.${tokens.size}.s`;
    tokens.set(bearer, verified);
    return resolve({ authorization: `Bearer ${bearer}` }, true);
  };

  const plugin = new SecurityPlugin({ fallbackPermissionSet: null });
  const boot = async () => {
    const ctx: any = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registerService: vi.fn(),
      getService: (name: string) => {
        if (!(name in services)) throw new Error(`service not registered: ${name}`);
        return services[name];
      },
    };
    await plugin.init(ctx);
    await plugin.start(ctx);
  };

  /** Run one operation through the security middleware; the engine body stands in for `next()`. */
  const run = async (context: ExecutionContext, operation: 'find', object: string) => {
    const opCtx: any = { object, operation, ast: { where: undefined }, context };
    await middleware(opCtx, async () => { opCtx.result = []; });
    return opCtx;
  };

  /** The effective object permission the security service reports for `context` on `object`. */
  const effective = async (context: ExecutionContext, object: string) =>
    ((await (plugin as any).getEffectiveObjectPermissions(context)) as Record<string, any>)[object];

  /** The sets the plugin evaluates for `context`. */
  const sets = async (context: ExecutionContext): Promise<PermissionSet[]> =>
    (plugin as any).resolvePermissionSetsForContext(context);

  return { resolve, resolveToken, boot, run, effective, sets };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { warn.mockRestore(); });

describe('[ADR-0151 D3] an AI service account\'s key admits the account itself', () => {
  const r = rig();
  beforeAll(async () => { await r.boot(); });

  for (const [door, mcp] of [['/mcp', true], ['the dispatcher', false]] as const) {
    it(`on ${door}: userId is the account, principalKind 'agent', no onBehalfOf, no system permission, no everyone anchor, no admin standing`, async () => {
      const ctx = await r.resolve({ 'x-api-key': BOT_KEY }, mcp);
      expect(ctx.userId).toBe('u_bot');
      expect(ctx.principalKind).toBe('agent');
      expect(ctx.onBehalfOf).toBeUndefined();
      expect(Object.keys(ctx)).not.toContain('onBehalfOf');
      expect(ctx.oauthScopes).toBeUndefined();
      expect(ctx.systemPermissions).toEqual([]);
      expect(ctx.positions).not.toContain('everyone');
      expect(ctx.positions).not.toContain('platform_admin');
      expect(ctx.posture).not.toBe('PLATFORM_ADMIN');
      expect(ctx.isSystem).toBe(false);
      // Its own grants are its whole authority: the sets it holds, by name.
      expect(ctx.permissions).toEqual(expect.arrayContaining(['crm_lead_reader', 'crm_lead_super']));
      expect(ctx.permissions).not.toContain('crm_contact_reader');
    });
  }

  it('the same key presented as `Authorization: Bearer` on /mcp admits the same account', async () => {
    const ctx = await r.resolve({ authorization: `Bearer ${BOT_KEY}` }, true);
    expect(ctx.userId).toBe('u_bot');
    expect(ctx.principalKind).toBe('agent');
    expect(ctx.onBehalfOf).toBeUndefined();
  });

  it('a ceiling-breaching set it holds grants nothing above the ceiling — the set as it stands now, after any edit', async () => {
    const ctx = await r.resolve({ 'x-api-key': BOT_KEY }, true);
    const lead = await r.effective(ctx, LEAD);
    // The ordinary grants of the set still hold…
    expect(lead).toMatchObject({ allowRead: true, allowEdit: true });
    // …and nothing above the ceiling does.
    for (const bit of ['viewAllRecords', 'modifyAllRecords', 'allowTransfer', 'allowRestoreOwnDeleted', 'manageRecycleBin']) {
      expect(lead?.[bit], bit).not.toBe(true);
    }
    const held = await r.sets(ctx);
    // The breaching set is held (and clamped); the administrative set the
    // store also holds for it is never held at all: standing is read by name too.
    expect(held.map((s) => s.name)).toContain('crm_lead_super');
    expect(held.map((s) => s.name)).not.toContain('admin_full_access');
    for (const s of held) {
      expect(s.systemPermissions ?? [], s.name).toEqual([]);
      expect((s as any).adminScope, s.name).toBeUndefined();
      for (const entry of Object.values(s.objects ?? {})) {
        expect((entry as any).viewAllRecords, s.name).not.toBe(true);
        expect((entry as any).modifyAllRecords, s.name).not.toBe(true);
      }
    }
  });

  it('a read reachable only through the everyone anchor or the superuser wildcard is refused for the account', async () => {
    const ctx = await r.resolve({ 'x-api-key': BOT_KEY }, true);
    await expect(r.run(ctx, 'find', CONTACT)).rejects.toThrow();
    await expect(r.run(ctx, 'find', LEAD)).resolves.toBeDefined();
  });
});

describe('CONTROLS — a person and an OAuth-delegated agent are unchanged', () => {
  const r = rig();
  beforeAll(async () => { await r.boot(); });

  it('a person\'s key holding the SAME sets: human, everyone, the system permission and the superuser bits all stand', async () => {
    const ctx = await r.resolve({ 'x-api-key': MIA_KEY }, true);
    expect(ctx.userId).toBe('u_mia');
    expect(ctx.principalKind).toBe('human');
    expect(ctx.onBehalfOf).toBeUndefined();
    expect(ctx.positions).toContain('everyone');
    expect(ctx.systemPermissions).toContain('manage_users');
    const lead = await r.effective(ctx, LEAD);
    expect(lead).toMatchObject({ viewAllRecords: true, modifyAllRecords: true, allowTransfer: true });
    await expect(r.run(ctx, 'find', CONTACT)).resolves.toBeDefined();
  });

  it('an OAuth-delegated agent keeps today\'s shape: principalKind agent WITH onBehalfOf naming the person', async () => {
    const ctx = await r.resolveToken({ userId: 'u_mia', scopes: ['data:read'], clientId: CLIENT, organizationId: ALPHA });
    expect(ctx.userId).toBe('u_mia');
    expect(ctx.principalKind).toBe('agent');
    expect(ctx.onBehalfOf).toEqual({ userId: 'u_mia', principalKind: 'human' });
    expect(ctx.performedBy).toEqual(expect.objectContaining({ clientId: CLIENT }));
  });
});
