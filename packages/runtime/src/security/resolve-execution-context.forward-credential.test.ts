// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0090 D10 rule 5, #28367] The runtime dispatcher's half of the agent
 * forward credential.
 *
 * A request the action door injected in-process for an AI agent's `api`
 * forward carries a credential minted for that one forward, never the agent's
 * token. `resolveExecutionContext` redeems it and hands the shared assembler
 * the agent provenance it was minted with, so the target builds the SAME agent
 * principal the MCP door built: `principalKind: 'agent'`, `onBehalfOf`,
 * `performedBy`, `oauthScopes`, and the consent's organization, vetted again.
 * It does so on every route this door serves, not only `/mcp`, and it reports
 * no admission (the `/keys` mint door refuses anything but a signed-in
 * session). Presented outside its forward, the header is nobody.
 *
 * The rig is the REAL resolver over a table double (the shape of
 * `resolve-execution-context.oauth-organization.test.ts`).
 */

import { describe, it, expect, vi } from 'vitest';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { FORWARD_CREDENTIAL_HEADER, withForwardCredential, type ForwardCredentialBinding } from '@objectstack/rest';

import { resolveExecutionContext } from './resolve-execution-context.js';
import { bindCatalogFromTables } from './security-catalog.testkit.js';

const ALPHA = 'org_alpha';

function tables(): Record<string, any[]> {
  return {
    sys_api_key: [],
    sys_user: [{ id: 'u_mia', email: 'u_mia@example.com' }],
    sys_member: [{ user_id: 'u_mia', organization_id: ALPHA, role: 'member' }],
    sys_user_position: [],
    sys_user_permission_set: [],
    sys_organization: [{ id: 'org_default', slug: 'default' }],
    sys_permission_set: [],
    sys_position: [],
    sys_position_permission_set: [],
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

function rig() {
  const t = tables();
  const ql: any = bindCatalogFromTables({
    registerMiddleware: () => undefined,
    getSchema: () => undefined,
    async find(object: string, q: any = {}) {
      const rows = (t[object] ?? []).filter((r) => matchesWhere(r, q?.where));
      return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
    },
    async findOne(object: string, q: any = {}) {
      assertEngineFindOnePredicate(object, q);
      return (t[object] ?? []).filter((r) => matchesWhere(r, q?.where))[0] ?? null;
    },
  }, t);
  const getSession = vi.fn(async () => null);
  const services: Record<string, any> = {
    objectql: ql,
    auth: { api: { getSession }, verifyMcpAccessToken: vi.fn(async () => null) },
    tenancy: { posture: 'isolated' },
  };
  const resolve = (request: any, extra: { acceptOAuthAccessToken?: boolean } = {}) => {
    const onAdmission = vi.fn();
    return resolveExecutionContext({
      getService: async (name: string) => services[name],
      getQl: async () => ql,
      request,
      onAdmission,
      ...extra,
    }).then((ec) => ({ ec: ec as any, onAdmission }));
  };
  return { resolve, getSession, services };
}

const binding = (over: Partial<ForwardCredentialBinding> = {}): ForwardCredentialBinding => ({
  method: 'PATCH',
  path: '/api/v1/data/crm_lead/r1',
  run: { objectName: 'crm_lead', actionName: 'probe', recordId: 'r1' },
  agent: { userId: 'u_mia', clientId: 'agent-client-1', scopes: ['actions:execute', 'data:write'], organizationId: ALPHA },
  ...over,
});
const forwarded = (handle: string, over: Record<string, unknown> = {}) => ({
  method: 'PATCH',
  path: '/api/v1/data/crm_lead/r1',
  headers: { host: 'localhost', [FORWARD_CREDENTIAL_HEADER]: handle },
  ...over,
});

describe('[ADR-0090 D10 rule 5] the dispatcher resolves a forward credential to the same agent principal', () => {
  it('on a route that is not `/mcp`, the redeemed credential is the agent: scopes, delegator, client, the consent\'s organization; no admission reported', async () => {
    const { resolve, getSession } = rig();

    const { ec, onAdmission } = await withForwardCredential(binding(), (h) => resolve(forwarded(h)));

    expect(ec).toMatchObject({
      userId: 'u_mia',
      principalKind: 'agent',
      onBehalfOf: { userId: 'u_mia', principalKind: 'human' },
      performedBy: { clientId: 'agent-client-1' },
      oauthScopes: ['actions:execute', 'data:write'],
      tenantId: ALPHA,
    });
    expect(onAdmission).not.toHaveBeenCalled();
    // Nothing was read from a session for it: the forward carries none.
    expect(getSession).not.toHaveBeenCalled();
  });

  it('the same request object resolved twice reads the same agent (the credential is spent once per request, not per read)', async () => {
    const { resolve } = rig();
    const [a, b] = await withForwardCredential(binding(), async (h) => {
      const req = forwarded(h);
      return [await resolve(req), await resolve(req)];
    });
    expect(a.ec.principalKind).toBe('agent');
    expect(b.ec.principalKind).toBe('agent');
  });

  it('a second request presenting the spent handle, or a request for another method or route, is nobody: a guest', async () => {
    const { resolve } = rig();
    const replay = await withForwardCredential(binding(), async (h) => {
      await resolve(forwarded(h));
      return resolve(forwarded(h));
    });
    expect(replay.ec.principalKind).toBe('guest');

    for (const over of [{ method: 'DELETE' }, { path: '/api/v1/data/crm_lead/r2' }]) {
      const { ec } = await withForwardCredential(binding(), (h) => resolve(forwarded(h, over)));
      expect(ec.principalKind, JSON.stringify(over)).toBe('guest');
      expect(ec.oauthScopes).toBeUndefined();
    }
  });

  it('the header presented outside any forward is nobody, on `/mcp` and off it', async () => {
    const { resolve } = rig();
    for (const accept of [false, true]) {
      const { ec } = await resolve(forwarded('A'.repeat(43)), { acceptOAuthAccessToken: accept });
      expect(ec.principalKind).toBe('guest');
      expect(ec.oauthScopes).toBeUndefined();
    }
  });

  it('a consent organization the delegator no longer belongs to is dropped, exactly as for a token at the MCP door', async () => {
    const { resolve } = rig();
    const { ec } = await withForwardCredential(
      binding({ agent: { userId: 'u_mia', clientId: 'agent-client-1', scopes: ['actions:execute'], organizationId: 'org_gone' } }),
      (h) => resolve(forwarded(h)),
    );
    expect(ec.principalKind).toBe('agent');
    expect(ec.tenantId).toBeUndefined();
  });
});
