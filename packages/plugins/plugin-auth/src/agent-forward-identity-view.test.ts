// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [ADR-0090 D10 rule 5, #28367] The identity mount's request-scoped view of
// the delegating user. Pinned here at the seam (the mount middleware and the
// session-lookup plugin); end to end through better-auth in
// `packages/qa/dogfood/test/mcp-oauth-api-action-forward.dogfood.test.ts`.

import { describe, it, expect, vi } from 'vitest';
import { FORWARD_CREDENTIAL_HEADER, withForwardCredential } from '@objectstack/rest';
import {
  agentForwardIdentityViewPlugin,
  agentForwardPerformedBy,
  serveAgentForwardAtIdentityMount,
} from './agent-forward-identity-view.js';
import { authSystemWriteContext } from './auth-actor-attribution.js';

const AGENT = { userId: 'u_mia', clientId: 'agent-client-1', scopes: ['actions:execute', 'data:write'], organizationId: 'org_alpha' };
const URL_ = 'http://localhost/api/v1/auth/update-user';
const bind = { method: 'POST', path: '/api/v1/auth/update-user', run: { objectName: 'sys_user', actionName: 'update_my_profile' }, agent: AGENT };

/** A Hono-shaped context: `c.req.raw` and a writable `c.res`. */
const honoCtx = (headers: Record<string, string>) => ({
  req: { raw: new Request(URL_, { method: 'POST', headers, body: JSON.stringify({ name: 'x' }) }) },
  res: undefined as Response | undefined,
});

/** The plugin's wrapped adapter over an inner one that knows one user and no session. */
const wrappedAdapter = (user: Record<string, unknown> | null = { id: 'u_mia', email: 'mia@example.com', banned: false }) => {
  const inner = {
    findOne: vi.fn(async (args: any) => (args.model === 'user' ? user : null)),
    create: vi.fn(),
  };
  const out: any = agentForwardIdentityViewPlugin().init({ adapter: inner, sessionConfig: { expiresIn: 604800 } });
  return { inner, adapter: out.context.adapter };
};

describe('[ADR-0090 D10 rule 5] the identity mount: a forward credential becomes a request-scoped view of the delegating user', () => {
  it('a redeemed credential: better-auth reads one opaque bearer and none of the caller\'s identity headers; its lookup answers the delegating user in the consent\'s organization', async () => {
    const { adapter, inner } = wrappedAdapter();
    let seen: { authorization: string | null; cookie: string | null; forward: string | null; apiKey: string | null } | undefined;
    let session: any;
    let performedBy: unknown;
    let writeCtx: unknown;

    await withForwardCredential(bind, async (handle) => {
      const c = honoCtx({ [FORWARD_CREDENTIAL_HEADER]: handle, cookie: 'better-auth.session_token=ambient', 'x-api-key': 'osk_x' });
      await serveAgentForwardAtIdentityMount(c, async () => {
        const h = c.req.raw.headers;
        seen = { authorization: h.get('authorization'), cookie: h.get('cookie'), forward: h.get(FORWARD_CREDENTIAL_HEADER), apiKey: h.get('x-api-key') };
        const token = String(seen.authorization).replace(/^Bearer /, '');
        session = await adapter.findOne({ model: 'session', where: [{ field: 'token', value: token }], join: { user: true } });
        performedBy = agentForwardPerformedBy();
        writeCtx = await authSystemWriteContext();
        c.res = new Response('{}', { headers: { 'set-cookie': 'better-auth.session_token=minted', 'set-auth-token': 'minted', 'content-type': 'application/json' } });
      });
      // Nothing that carries a credential leaves the mount for an agent caller.
      expect(c.res!.headers.get('set-cookie')).toBeNull();
      expect(c.res!.headers.get('set-auth-token')).toBeNull();
      expect(c.res!.headers.get('content-type')).toBe('application/json');
    });

    expect(seen!.authorization).toMatch(/^Bearer [A-Za-z0-9_-]{32}$/);
    expect(seen!.cookie).toBeNull();
    expect(seen!.apiKey).toBeNull();
    expect(seen!.forward).toBeNull();
    expect(session).toMatchObject({ userId: 'u_mia', activeOrganizationId: 'org_alpha', user: { id: 'u_mia' } });
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
    // No session of record: the view never wrote one.
    expect(inner.create).not.toHaveBeenCalled();
    expect(performedBy).toEqual({ clientId: 'agent-client-1' });
    expect(writeCtx).toMatchObject({ isSystem: true, performedBy: { clientId: 'agent-client-1' } });
  });

  it('the view\'s bearer is no session anywhere else: outside the request\'s own chain the lookup passes through and finds nothing', async () => {
    const { adapter, inner } = wrappedAdapter();
    let token = '';
    await withForwardCredential(bind, async (handle) => {
      const c = honoCtx({ [FORWARD_CREDENTIAL_HEADER]: handle });
      await serveAgentForwardAtIdentityMount(c, async () => {
        token = String(c.req.raw.headers.get('authorization')).replace(/^Bearer /, '');
      });
    });
    expect(await adapter.findOne({ model: 'session', where: [{ field: 'token', value: token }], join: { user: true } })).toBeNull();
    expect(inner.findOne).toHaveBeenCalledWith(expect.objectContaining({ model: 'session' }));
    expect(agentForwardPerformedBy()).toBeUndefined();
  });

  it('a banned or missing delegating user has no view', async () => {
    for (const user of [{ id: 'u_mia', banned: true, banExpires: null }, null]) {
      const { adapter } = wrappedAdapter(user);
      await withForwardCredential(bind, async (handle) => {
        const c = honoCtx({ [FORWARD_CREDENTIAL_HEADER]: handle });
        await serveAgentForwardAtIdentityMount(c, async () => {
          const token = String(c.req.raw.headers.get('authorization')).replace(/^Bearer /, '');
          expect(await adapter.findOne({ model: 'session', where: [{ field: 'token', value: token }], join: { user: true } })).toBeNull();
        });
      });
    }
  });

  it('a credential that does not redeem (from outside, or for another route) is dropped and the request resolves on its other headers alone', async () => {
    const outside = honoCtx({ [FORWARD_CREDENTIAL_HEADER]: 'A'.repeat(43), cookie: 'c=1' });
    await serveAgentForwardAtIdentityMount(outside, async () => {
      expect(outside.req.raw.headers.get(FORWARD_CREDENTIAL_HEADER)).toBeNull();
      expect(outside.req.raw.headers.get('authorization')).toBeNull();
      expect(outside.req.raw.headers.get('cookie')).toBe('c=1');
      expect(agentForwardPerformedBy()).toBeUndefined();
    });

    await withForwardCredential({ ...bind, path: '/api/v1/auth/admin/ban-user' }, async (handle) => {
      const c = honoCtx({ [FORWARD_CREDENTIAL_HEADER]: handle });
      await serveAgentForwardAtIdentityMount(c, async () => {
        expect(c.req.raw.headers.get('authorization')).toBeNull();
        expect(agentForwardPerformedBy()).toBeUndefined();
      });
    });
  });

  it('no credential presented: the request passes through untouched', async () => {
    const c = honoCtx({ authorization: 'Bearer person_session' });
    const before = c.req.raw;
    await serveAgentForwardAtIdentityMount(c, async () => undefined);
    expect(c.req.raw).toBe(before);
  });
});
