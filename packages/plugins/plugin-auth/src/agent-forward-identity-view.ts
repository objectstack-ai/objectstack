// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0090 D10 rule 5, #28367] The identity mount's half of the agent forward
 * credential: an AI agent's `api` action forwarded to an identity route
 * (`/api/v1/auth/…`) reaches better-auth with the delegating user as its
 * caller, for that one request only, and with no session of record.
 *
 * ## Why a view, and not a session
 *
 * better-auth reads a session and nothing else. Minting one for the forward
 * (option C of #28178) stays refused: a session is valid at every identity
 * route, for its whole lifetime, wherever it is presented, so it would hand the
 * agent the user's whole reach. So the forward credential is resolved BEFORE
 * better-auth runs ({@link serveAgentForwardAtIdentityMount}), and better-auth
 * is shown a request-scoped view of the delegating user:
 *
 *  - the request better-auth reads carries a random, opaque bearer and none of
 *    the caller's identity headers (the action door already dropped them; they
 *    are dropped again here, so this door reads one credential only);
 *  - better-auth's session lookup for that bearer is answered from memory by
 *    {@link agentForwardIdentityViewPlugin}, ONLY inside this request's own
 *    async chain: no `sys_session` row, no stored token, no cookie, nothing
 *    that outlives the request. Presented anywhere else the bearer names no
 *    session at all;
 *  - nothing a target answers that could carry a credential (a session cookie,
 *    a rotated bearer) leaves this door for an agent caller.
 *
 * Two gates then stand, and the agent passes only if both do: the action
 * door's (the agent's intersected authority, the exposure and the confirmation,
 * checked before the mint) and better-auth's own (the delegating user's, here).
 *
 * ## Attribution
 *
 * A write this request makes records the agent and its user: the user through
 * the session the view answers (the existing actor seam,
 * `auth-actor-attribution.ts`), the agent's client through
 * {@link agentForwardPerformedBy}, which the identity write contexts carry as
 * `performedBy`, so the audit row stamps `performed_by` and `on_behalf_of`.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import {
  FORWARD_CREDENTIAL_HEADER,
  redeemForwardCredential,
  type ForwardAgentProvenance,
} from '@objectstack/rest';

/** One forwarded agent request's view, alive for that request's async chain only. */
interface AgentIdentityView {
  /** The opaque bearer better-auth reads; meaningful only inside this chain. */
  readonly token: string;
  readonly sessionId: string;
  readonly agent: ForwardAgentProvenance;
  readonly createdAt: Date;
}

/** Kept on a registered global symbol so a dual-loaded module copy shares it. */
const VIEW_STORE_KEY = Symbol.for('@objectstack/plugin-auth.agent-forward-identity-view');
const viewStore: AsyncLocalStorage<AgentIdentityView> =
  ((globalThis as Record<symbol, unknown>)[VIEW_STORE_KEY] as AsyncLocalStorage<AgentIdentityView> | undefined) ??
  ((globalThis as Record<symbol, unknown>)[VIEW_STORE_KEY] = new AsyncLocalStorage<AgentIdentityView>()) as AsyncLocalStorage<AgentIdentityView>;

/**
 * The caller identity headers this door never lets a forwarded agent request
 * carry into better-auth: the forward itself carries none, so a copy here is a
 * request the action door did not build, and the view's bearer is the one
 * credential better-auth reads.
 */
const IDENTITY_REQUEST_HEADERS = ['authorization', 'cookie', 'x-admin-session-token', 'x-api-key'] as const;

/**
 * The response headers that can carry a credential (`bearer()`'s rotated
 * token, the admin recovery lane's, a session cookie). None reaches an agent
 * caller: whatever a target mints stays with the target.
 */
const CREDENTIAL_RESPONSE_HEADERS = ['set-cookie', 'set-auth-token', 'set-admin-session-token'] as const;

/** The agent's client, when the current request is a forwarded agent's; recorded as `performedBy`. */
export function agentForwardPerformedBy(): { clientId: string } | undefined {
  const view = viewStore.getStore();
  return view ? { clientId: view.agent.clientId } : undefined;
}

/**
 * The identity mount's middleware, run ahead of every route under the auth
 * base path (the vendor catch-all and the platform's raw mounts alike).
 *
 * - No forward credential presented: the request passes untouched.
 * - One presented that does not redeem (from the network, replayed, for
 *   another method or route, expired): the header is dropped and the request
 *   resolves as if it had carried nothing more than its other headers.
 * - One that redeems: the request is rebuilt with no caller identity header and
 *   the view's bearer, and runs inside the view; credential headers are
 *   stripped from the answer.
 */
export async function serveAgentForwardAtIdentityMount(c: any, next: () => Promise<void>): Promise<void> {
  const raw: Request | undefined = c?.req?.raw;
  const presented = raw?.headers?.get(FORWARD_CREDENTIAL_HEADER);
  if (!raw || !presented) return next();
  const agent = redeemForwardCredential(presented, raw.method, raw.url);
  const headers = new Headers(raw.headers);
  headers.delete(FORWARD_CREDENTIAL_HEADER);
  if (!agent) {
    c.req.raw = new Request(raw, { headers });
    return next();
  }
  for (const name of IDENTITY_REQUEST_HEADERS) headers.delete(name);
  // `bearer()` signs an undotted token itself and reads it as the session
  // cookie: so the view's token is 192 random bits, base64url (no dot).
  const view: AgentIdentityView = {
    token: randomBytes(24).toString('base64url'),
    sessionId: `agent_forward_${randomBytes(12).toString('base64url')}`,
    agent,
    createdAt: new Date(),
  };
  headers.set('authorization', `Bearer ${view.token}`);
  c.req.raw = new Request(raw, { headers });
  await viewStore.run(view, () => next());
  const res: Response | undefined = c.res;
  if (res && CREDENTIAL_RESPONSE_HEADERS.some((h) => res.headers.has(h))) {
    const out = new Headers(res.headers);
    for (const name of CREDENTIAL_RESPONSE_HEADERS) out.delete(name);
    const exposed = out.get('access-control-expose-headers');
    if (exposed) {
      const kept = exposed.split(',').map((s) => s.trim()).filter((s) => s && !CREDENTIAL_RESPONSE_HEADERS.includes(s.toLowerCase() as never));
      if (kept.length) out.set('access-control-expose-headers', kept.join(', '));
      else out.delete('access-control-expose-headers');
    }
    c.res = new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
  }
}

/** A better-auth adapter `where` naming exactly one session token. */
function soleTokenOf(where: unknown): string | undefined {
  if (!Array.isArray(where) || where.length !== 1) return undefined;
  const w = where[0] as { field?: unknown; value?: unknown; operator?: unknown };
  if (w?.field !== 'token' || (w.operator !== undefined && w.operator !== 'eq')) return undefined;
  return typeof w.value === 'string' ? w.value : undefined;
}

/** A user better-auth would refuse a session to: banned, and the ban not lapsed. */
function isBanned(user: any): boolean {
  if (!user?.banned) return false;
  const until = user.banExpires ? new Date(user.banExpires).getTime() : undefined;
  return until === undefined || Number.isNaN(until) || until > Date.now();
}

/**
 * The better-auth plugin that answers the view's session lookup from memory.
 * It wraps the database adapter better-auth builds its session store on
 * (`init` runs before that store is built), and changes exactly one read: a
 * `session` lookup by the token of the view open in THIS async chain. Every
 * other read and every write passes through untouched, and outside a view this
 * plugin does nothing.
 *
 * The view's session belongs to the delegating user, in the one organization
 * the consent bound, and is created now, so better-auth neither refreshes it
 * (no write) nor re-issues it. A user who is gone, or banned, has no view.
 */
export function agentForwardIdentityViewPlugin() {
  return {
    id: 'objectstack-agent-forward-identity-view',
    init(ctx: any) {
      const inner = ctx?.adapter;
      if (!inner || typeof inner.findOne !== 'function') return undefined;
      const expiresInSec = Number(ctx?.sessionConfig?.expiresIn) > 0 ? Number(ctx.sessionConfig.expiresIn) : 60 * 60 * 24 * 7;
      const findOne = async (args: any) => {
        const view = viewStore.getStore();
        if (!view || args?.model !== 'session' || soleTokenOf(args?.where) !== view.token) {
          return inner.findOne(args);
        }
        const user = await inner.findOne({ model: 'user', where: [{ field: 'id', value: view.agent.userId }] });
        if (!user || isBanned(user)) return null;
        const session = {
          id: view.sessionId,
          token: view.token,
          userId: view.agent.userId,
          createdAt: view.createdAt,
          updatedAt: view.createdAt,
          expiresAt: new Date(view.createdAt.getTime() + expiresInSec * 1000),
          ipAddress: null,
          userAgent: null,
          ...(view.agent.organizationId ? { activeOrganizationId: view.agent.organizationId } : {}),
        };
        return args?.join?.user ? { ...session, user } : session;
      };
      const adapter = new Proxy(inner, {
        get(target, prop, receiver) {
          if (prop === 'findOne') return findOne;
          return Reflect.get(target, prop, receiver);
        },
      });
      return { context: { adapter } };
    },
  };
}
