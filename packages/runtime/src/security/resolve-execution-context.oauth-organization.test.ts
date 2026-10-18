// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An OAuth access token acts in the ONE organization its consent bound
 * (ADR-0090 D10; ruling record 6232069920, letter A).
 *
 * ## The defect
 *
 * `resolveExecutionContext` built a verified MCP token's session as
 * `{ user: { id } }` — no organization at all. So the shared resolver derived
 * no tenant, and the D10 delegator (the user the agent acts for, resolved by
 * `plugin-security` in the request's organization) held its GLOBAL grants and
 * nothing else. Every grant an administrator assigns is scoped to an
 * organization (ADR-0131), so an ordinary user's agent was refused every
 * object operation: `on-behalf-of principal may not 'find' … the delegator
 * lacks that grant (ADR-0090 D10 intersection)`.
 *
 * ## The rule now
 *
 * The verifier returns the organization the consent bound
 * (`IAuthService.verifyMcpAccessToken` → `organizationId`, read from the
 * token's `organization_id` claim). The synthetic session carries it as the
 * session's `activeOrganizationId`, so the session arm of
 * `resolveAuthzContext` vets it on EVERY request with the rule it applies to a
 * browser session (`vetOrganizationClaim`): kept while a current membership
 * backs it under a walled posture, dropped (no organization, global grants
 * only) once none does. ⛔ No union of the user's organizations, no widened
 * global grant, no third branch in core.
 *
 * ## The rig
 *
 * The REAL `resolveExecutionContext` → `resolveAuthzContext` (this package's
 * vitest alias resolves `@objectstack/core` to its source) over a table double,
 * and the resulting context handed to the REAL `SecurityPlugin` middleware —
 * the layer that answered the card's denial — over the same tables, under the
 * `isolated` posture (the enforcing one). Only the token verifier is faked: its
 * own half (consent → claim → `organizationId`) is pinned against a real
 * authorization server in `@objectstack/plugin-auth`.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { SecurityPlugin, RLS_DENY_FILTER } from '@objectstack/plugin-security';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';

import { resolveExecutionContext } from './resolve-execution-context.js';
import { bindCatalogFromTables } from './security-catalog.testkit.js';

const ALPHA = 'org_alpha';
const BETA = 'org_beta';
/** An organization no fixture user belongs to. */
const GAMMA = 'org_gamma';
const CLIENT = 'agent-client-1';
const LEAD = 'crm_lead';
const CONTACT = 'crm_contact';

/** One source for every set: the catalog rows core reads and the bodies the security plugin reads. */
const SETS: PermissionSet[] = [
  { name: 'crm_sales_user', label: 'Sales user', objects: { [LEAD]: { allowRead: true, allowCreate: true } } },
  { name: 'crm_contact_reader', label: 'Contact reader', objects: { [CONTACT]: { allowRead: true } } },
  { name: 'crm_lead_global', label: 'Lead (global)', objects: { [LEAD]: { allowRead: true, allowCreate: true } } },
  { name: 'admin_full_access', label: 'Admin', objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } } },
] as PermissionSet[];

/**
 * - `u_mia` holds `sales_rep` in org_alpha (→ `crm_sales_user`) and
 *   `crm_contact_reader` in org_beta; a member of both — the "another
 *   organization" control.
 * - `u_pat` is an org_alpha member holding no grant.
 * - `u_admin` holds `admin_full_access` GLOBALLY (the platform-admin row).
 * - `u_ex` held `sales_rep` in org_alpha and was removed from it (no
 *   org_alpha `sys_member` row; still a member of org_beta). They also hold
 *   `crm_lead_global` globally, so what is left after the claim is dropped is
 *   visible: a read the wall empties and a write it refuses.
 */
function tables(): Record<string, any[]> {
  return {
    sys_api_key: [],
    sys_user: ['u_mia', 'u_pat', 'u_admin', 'u_ex'].map((id) => ({ id, email: `${id}@example.com` })),
    sys_member: [
      { user_id: 'u_mia', organization_id: ALPHA, role: 'member' },
      { user_id: 'u_mia', organization_id: BETA, role: 'member' },
      { user_id: 'u_pat', organization_id: ALPHA, role: 'member' },
      { user_id: 'u_admin', organization_id: ALPHA, role: 'owner' },
      { user_id: 'u_ex', organization_id: BETA, role: 'member' },
    ],
    sys_user_position: [
      { user_id: 'u_mia', position: 'sales_rep', organization_id: ALPHA },
      { user_id: 'u_ex', position: 'sales_rep', organization_id: ALPHA },
    ],
    sys_user_permission_set: [
      { user_id: 'u_mia', permission_set: 'crm_contact_reader', organization_id: BETA },
      { user_id: 'u_admin', permission_set: 'admin_full_access', organization_id: null },
      { user_id: 'u_ex', permission_set: 'crm_lead_global', organization_id: null },
    ],
    sys_permission_set: SETS.map((s) => ({ id: `ps_${s.name}`, name: s.name, object_permissions: JSON.stringify(s.objects ?? {}) })),
    sys_position: [{ id: 'pos_sales_rep', name: 'sales_rep', organization_id: null }],
    sys_position_permission_set: [{ position_id: 'pos_sales_rep', permission_set_id: 'ps_crm_sales_user' }],
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

/** The verified results the fake verifier answers, by bearer. */
type Verified = { userId: string; scopes: string[]; clientId?: string; organizationId?: string };

function rig(posture: 'isolated' | 'group' | 'single' | undefined) {
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
    ...(posture ? { tenancy: { posture } } : {}),
  };

  const resolve = async (verified: Verified): Promise<ExecutionContext> => {
    const bearer = `h.${tokens.size}.s`;
    tokens.set(bearer, verified);
    return resolveExecutionContext({
      acceptOAuthAccessToken: true,
      getService: async (name: string) => services[name],
      getQl: async () => ql,
      request: { headers: { authorization: `Bearer ${bearer}` } },
    });
  };

  /** The same user, signed in through a browser session naming `activeOrganizationId` — the REST door's shape. */
  const resolveSession = async (userId: string, activeOrganizationId: string) =>
    resolveExecutionContext({
      getService: async (name: string) => (name === 'auth'
        ? { api: { getSession: async () => ({ user: { id: userId }, session: { id: `ses_${userId}`, userId, activeOrganizationId } }) } }
        : services[name]),
      getQl: async () => ql,
      request: { headers: {} },
    });

  const boot = async () => {
    const plugin = new SecurityPlugin({ fallbackPermissionSet: null });
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
  const run = async (context: ExecutionContext, operation: 'find' | 'insert', object: string) => {
    const opCtx: any = operation === 'find'
      ? { object, operation, ast: { where: undefined }, context }
      : { object, operation, data: { name: 'written' }, context };
    await middleware(opCtx, async () => {
      const seam = opCtx.postHookWriteImageCheck;
      if (seam) {
        seam.honoured = true;
        await seam.evaluate([opCtx.data]);
      }
      if (operation === 'find') opCtx.result = [];
    });
    return opCtx;
  };

  return { resolve, resolveSession, boot, run };
}

const READ_TOKEN = (userId: string, organizationId?: string): Verified => ({
  userId,
  scopes: ['data:read', 'data:write'],
  clientId: CLIENT,
  ...(organizationId ? { organizationId } : {}),
});

/**
 * The composed read filter's conjuncts. D10 ANDs the agent's Layer 0 with the
 * DELEGATOR's, so a delegated read under a wall carries one per principal.
 */
const conjuncts = (where: any): unknown[] => (where && Array.isArray(where.$and) ? where.$and : [where]);

/** The card's message: the D10 intersection refusing the delegator's missing grant. */
const D10_DENIAL = /on-behalf-of principal may not '(find|insert)' .* the delegator lacks that grant \(ADR-0090 D10 intersection\)/;

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { warn.mockRestore(); });

const droppedClaimLines = (): string[] => warn.mock.calls
  .map((c: unknown[]) => String(c[0]))
  .filter((line: string) => line.includes('organization claim dropped (organization_membership_ended)'));

describe('an OAuth token acts in the organization its consent bound — isolated posture, the real D10 middleware', () => {
  const r = rig('isolated');
  beforeAll(async () => { await r.boot(); });

  it('POSITIVE: the token bound to org_alpha reads and creates with the organization-scoped grant the user holds there', async () => {
    const ctx = await r.resolve(READ_TOKEN('u_mia', ALPHA));
    expect(ctx.tenantId).toBe(ALPHA);
    expect(ctx.principalKind).toBe('agent');
    expect(ctx.onBehalfOf).toEqual({ userId: 'u_mia', principalKind: 'human' });

    const read = await r.run(ctx, 'find', LEAD);
    // Admitted, and walled to the bound organization alone.
    expect(conjuncts(read.ast.where)).toEqual([{ organization_id: ALPHA }, { organization_id: ALPHA }]);
    await expect(r.run(ctx, 'insert', LEAD)).resolves.toBeDefined();
    expect(droppedClaimLines()).toEqual([]);
  });

  it('PARITY: the same user over a browser session in org_alpha resolves the same organization', async () => {
    const viaToken = await r.resolve(READ_TOKEN('u_mia', ALPHA));
    const viaSession = await r.resolveSession('u_mia', ALPHA);
    expect(viaToken.tenantId).toBe(viaSession.tenantId);
    expect(viaToken.accessible_org_ids).toEqual(viaSession.accessible_org_ids);
    expect(viaSession.permissions).toContain('crm_sales_user');
  });

  it('CONTROL — another organization stays invisible: bound to org_alpha, the org_beta grant does not count and the wall names org_alpha alone', async () => {
    const ctx = await r.resolve(READ_TOKEN('u_mia', ALPHA));
    await expect(r.run(ctx, 'find', CONTACT)).rejects.toThrow(D10_DENIAL);

    // Bound to org_beta instead: the reverse, never the union.
    const beta = await r.resolve(READ_TOKEN('u_mia', BETA));
    expect(beta.tenantId).toBe(BETA);
    const contacts = await r.run(beta, 'find', CONTACT);
    expect(conjuncts(contacts.ast.where)).toEqual([{ organization_id: BETA }, { organization_id: BETA }]);
    await expect(r.run(beta, 'find', LEAD)).rejects.toThrow(D10_DENIAL);
  });

  it('CONTROL — no grant still refuses: an org_alpha member holding nothing is refused in org_alpha', async () => {
    const ctx = await r.resolve(READ_TOKEN('u_pat', ALPHA));
    expect(ctx.tenantId).toBe(ALPHA);
    await expect(r.run(ctx, 'find', LEAD)).rejects.toThrow(D10_DENIAL);
  });

  it('CONTROL — a revoked membership: the claim is dropped, so only global grants apply — the read comes back empty and the tenant write is refused loudly', async () => {
    const ctx = await r.resolve(READ_TOKEN('u_ex', ALPHA));
    expect(ctx.tenantId).toBeUndefined();
    expect(droppedClaimLines()).toHaveLength(1);
    expect(droppedClaimLines()[0]).toContain(`principal=u_ex organization=${ALPHA}`);

    // The global grant admits the read; the wall has no organization to read in.
    const read = await r.run(ctx, 'find', LEAD);
    expect(conjuncts(read.ast.where)).toEqual([RLS_DENY_FILTER, RLS_DENY_FILTER]);
    await expect(r.run(ctx, 'insert', LEAD)).rejects.toThrow(/has no active organization/);
  });

  it('CONTROL — a platform admin\'s global grant is unchanged: it admits the delegated read bound or unbound; only the organization the wall reads in moves', async () => {
    const bound = await r.resolve(READ_TOKEN('u_admin', ALPHA));
    expect(bound.tenantId).toBe(ALPHA);
    expect(bound.posture).toBe('PLATFORM_ADMIN');
    expect(conjuncts((await r.run(bound, 'find', LEAD)).ast.where)).toEqual([{ organization_id: ALPHA }, { organization_id: ALPHA }]);

    // Unbound is what every token resolved before this change: still admitted
    // by the global grant, and — a business object under `isolated` — walled
    // to nothing with no organization to read in (ADR-0095 W2), as before.
    const unbound = await r.resolve(READ_TOKEN('u_admin'));
    expect(unbound.tenantId).toBeUndefined();
    expect(unbound.posture).toBe('PLATFORM_ADMIN');
    expect(conjuncts((await r.run(unbound, 'find', LEAD)).ast.where)).toEqual([RLS_DENY_FILTER, RLS_DENY_FILTER]);
  });

  it('CONTROL — a token minted before consents bound an organization (no claim) keeps today\'s behaviour: global grants only', async () => {
    const ctx = await r.resolve(READ_TOKEN('u_mia'));
    expect(ctx.tenantId).toBeUndefined();
    await expect(r.run(ctx, 'find', LEAD)).rejects.toThrow(D10_DENIAL);
    expect(droppedClaimLines()).toEqual([]);
  });

  it('CONTROL — an organization the user does not belong to (a resource row\'s custom claim, say) is dropped, never honoured', async () => {
    const ctx = await r.resolve(READ_TOKEN('u_mia', GAMMA));
    expect(ctx.tenantId).toBeUndefined();
    expect(droppedClaimLines()).toHaveLength(1);
    expect(droppedClaimLines()[0]).toContain(`principal=u_mia organization=${GAMMA}`);
    await expect(r.run(ctx, 'find', LEAD)).rejects.toThrow(D10_DENIAL);
  });
});

/**
 * The open-core default composition the card measured (`single`: no wall).
 * The token's organization still decides which organization-scoped grants
 * count, and — no wall, no membership read — it stands as claimed, exactly
 * as a browser session's `activeOrganizationId` does there.
 */
describe('the same token under the single posture (no wall) — the real D10 middleware', () => {
  const r = rig('single');
  beforeAll(async () => { await r.boot(); });

  it('POSITIVE: the token bound to org_alpha reads with the organization-scoped grant (the card\'s measured case)', async () => {
    const ctx = await r.resolve(READ_TOKEN('u_mia', ALPHA));
    expect(ctx.tenantId).toBe(ALPHA);
    expect((await r.run(ctx, 'find', LEAD)).ast.where).toBeUndefined();
    await expect(r.run(ctx, 'insert', LEAD)).resolves.toBeDefined();
  });

  it('CONTROL — no claim: the card\'s denial, unchanged', async () => {
    const ctx = await r.resolve(READ_TOKEN('u_mia'));
    expect(ctx.tenantId).toBeUndefined();
    await expect(r.run(ctx, 'find', LEAD)).rejects.toThrow(D10_DENIAL);
  });

  it('BOUNDARY — a former member\'s token keeps the bound organization here, as their session would: no wall reads no membership', async () => {
    const viaToken = await r.resolve(READ_TOKEN('u_ex', ALPHA));
    const viaSession = await r.resolveSession('u_ex', ALPHA);
    expect(viaToken.tenantId).toBe(ALPHA);
    expect(viaSession.tenantId).toBe(ALPHA);
    expect(droppedClaimLines()).toEqual([]);
    await expect(r.run(viaToken, 'find', LEAD)).resolves.toBeDefined();
  });
});

/**
 * The vetting is the session arm's, so the token's organization answers
 * exactly what a browser session's does in every posture: vetted against the
 * user's memberships where a wall is enforced (`isolated`, `group`), kept as
 * claimed where none is (`single`, or no `tenancy` service) — the same claim
 * a REST session's `activeOrganizationId` keeps there.
 */
describe('the token\'s organization follows the session arm in every posture', () => {
  const CASES: Array<['isolated' | 'group' | 'single' | undefined, { member: string | undefined; stranger: string | undefined }]> = [
    ['isolated', { member: ALPHA, stranger: undefined }],
    ['group', { member: ALPHA, stranger: undefined }],
    ['single', { member: ALPHA, stranger: GAMMA }],
    [undefined, { member: ALPHA, stranger: GAMMA }],
  ];
  for (const [posture, expected] of CASES) {
    it(`${posture ?? 'no tenancy service'}: a member organization ${expected.member ? 'is kept' : 'is dropped'}; a non-member one ${expected.stranger ? 'is kept' : 'is dropped'} — as for a session`, async () => {
      const r = rig(posture);
      for (const [org, want] of [[ALPHA, expected.member], [GAMMA, expected.stranger]] as const) {
        const viaToken = await r.resolve(READ_TOKEN('u_mia', org));
        const viaSession = await r.resolveSession('u_mia', org);
        expect(viaToken.tenantId, `token bound to ${org}`).toBe(want);
        expect(viaSession.tenantId, `session naming ${org}`).toBe(want);
      }
    });
  }
});
