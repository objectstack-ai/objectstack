// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9653 — the four `/admin/sso/*` bridges carry the ADR-0068 D4 platform-admin
 * gate BEFORE delegating into better-auth.
 *
 * ── Why the gate is ObjectStack's to run, not the vendor's ──────────────────
 *
 * The bridges re-dispatch into `@better-auth/sso` "so all of its gates run"
 * (register-sso-provider.ts). The premise this file pins is that the vendor's
 * gates are NOT a platform-admin gate. Measured on the INSTALLED
 * `@better-auth/sso` 1.7.1 (dist/index.mjs, `registerSSOProvider`):
 *
 *   • `/sso/register` requires a session — and nothing more — when the body
 *     carries no `organizationId`: the org owner/admin check sits inside
 *     `if (ctx.body.organizationId) { … }`, so an org-less registration is
 *     admitted for ANY authenticated user (up to `providersLimit`, default 10).
 *   • `/sso/{request-domain-verification,verify-domain}` authorize per
 *     provider (`checkProviderAccess`): the registrar, or an org admin for an
 *     org-scoped provider. A member who registered an org-less provider can
 *     drive its domain verification end to end.
 *
 *   The `auth-manager.ts` before-hook on `/sso/register` (ADR-0024) narrows
 *   the first bullet on ObjectStack deployments, but it admits org
 *   owners/admins — who are NOT platform admins under ADR-0068 — and until
 *   this card nothing pinned any of it: with SSO off (the stock boot) every
 *   caller got the identical capability error, so the authorization answer
 *   was unobservable.
 *
 * The SSO capability is ON in every fixture here (`sso()` really mounted, with
 * `domainVerification.enabled`), so the refusals asserted below are
 * authorization verdicts — not capability errors masking the question.
 *
 * ── Hook-detach check (the #9970 hazard class) ──────────────────────────────
 *
 * The gate WRAPS the existing mounts: paths are unchanged and the admitted
 * path still re-dispatches through `authManager.handleRequest`, so better-auth
 * hooks keyed on the INNER paths (`/sso/register` — the ADR-0024 before-hook
 * in auth-manager.ts) keep firing exactly as before. No better-auth hook is
 * keyed on `/admin/sso/*` itself (better-auth never serves those paths). The
 * "platform admin is delegated" cases below pin that delegation survives.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { sso } from '@better-auth/sso';
import { AuthPlugin } from './auth-plugin';
import type { PluginContext } from '@objectstack/core';

const BASE = '/api/v1/auth';
const ORIGIN = 'http://localhost:3000';

/** The flat form bodies the metadata actions post — valid per the bridges. */
const BRIDGE_BODIES: Record<string, Record<string, unknown>> = {
  [`${BASE}/admin/sso/register`]: {
    providerId: 'acme',
    issuer: 'https://idp.acme.example',
    domain: 'acme.example',
    clientId: 'cid',
    clientSecret: 'csecret',
  },
  [`${BASE}/admin/sso/register-saml`]: {
    providerId: 'acme-saml',
    issuer: 'https://idp.acme.example/entity',
    domain: 'acme.example',
    entryPoint: 'https://idp.acme.example/sso',
    cert: 'PROBE-CERT',
  },
  [`${BASE}/admin/sso/request-domain-verification`]: { providerId: 'acme' },
  [`${BASE}/admin/sso/verify-domain`]: { providerId: 'acme' },
};
const BRIDGE_PATHS = Object.keys(BRIDGE_BODIES);

const mockCtx = (): PluginContext =>
  ({
    registerService: vi.fn(),
    getService: vi.fn((name: string) => (name === 'manifest' ? { register: vi.fn() } : undefined)),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(),
  }) as any;

/**
 * Mount the plugin's REAL route registration on a real Hono app (the
 * auth-catchall-fallthrough.test.ts harness), with the auth manager reduced to
 * the two seams the bridges read: `getApi().getSession` (what the gate judges)
 * and `handleRequest` (where the bridge delegates).
 */
async function mountBridges(deps: {
  getSession: (headers: Headers) => unknown | Promise<unknown>;
  handleRequest: (req: Request) => Promise<Response>;
}) {
  const app = new Hono();
  const ctx = mockCtx();
  const plugin = new AuthPlugin({ secret: 'test-secret-at-least-32-chars-long!!' });
  await plugin.init(ctx);
  (plugin as any).authManager = {
    handleRequest: deps.handleRequest,
    getApi: async () => ({
      getSession: async ({ headers }: { headers: Headers }) => deps.getSession(headers),
    }),
  };
  (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);
  return app;
}

const fire = (app: Hono, path: string, opts: { session?: string; cookie?: string } = {}) =>
  app.request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      ...(opts.session ? { 'x-test-session': opts.session } : {}),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: JSON.stringify(BRIDGE_BODIES[path]),
  });

/** A REAL better-auth instance with the REAL sso plugin — SSO capability ON. */
const makeSsoVendor = () =>
  betterAuth({
    baseURL: ORIGIN,
    basePath: BASE,
    secret: 'admin-sso-bridge-gate-test-secret-0123456789',
    database: memoryAdapter({}),
    emailAndPassword: { enabled: true },
    plugins: [sso({ domainVerification: { enabled: true } })],
  });

describe('#9653 the /admin/sso/* bridges run the ADR-0068 platform-admin gate before delegating', () => {
  // Session shapes are the exact ones platform-admin-gate.ts is unit-tested
  // for; here they drive the MOUNTED routes so the pin is on the wiring.
  const SESSIONS: Record<string, unknown> = {
    member: { user: { id: 'usr_member', positions: ['user'], role: 'user' } },
    'org-admin': { user: { id: 'usr_orgadmin', positions: ['user', 'org_admin', 'org_owner'], role: 'user' } },
    'platform-admin': { user: { id: 'usr_admin', positions: ['user', 'platform_admin'], role: 'user' } },
  };

  let app: Hono;
  let vendor: ReturnType<typeof betterAuth>;
  let delegated: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    vendor = makeSsoVendor();
    delegated = vi.fn(async (req: Request) => vendor.handler(req));
    app = await mountBridges({
      getSession: (headers) => SESSIONS[headers.get('x-test-session') ?? ''] ?? null,
      handleRequest: delegated as any,
    });
  });

  for (const path of BRIDGE_PATHS) {
    it(`${path}: anonymous → 401 UNAUTHENTICATED, and better-auth is never consulted`, async () => {
      delegated.mockClear();
      const res = await fire(app, path);
      const body: any = await res.json();
      // ADR-0112 envelope — code AND status. This replaces the old masked
      // answer (the capability error, e.g. 404 SSO_REGISTER_FAILED for anon).
      expect(res.status).toBe(401);
      expect(body.error?.code).toBe('UNAUTHENTICATED');
      expect(body.success).toBe(false);
      expect(delegated).not.toHaveBeenCalled();
    });

    it(`${path}: signed-in plain member → 403 PERMISSION_DENIED, never delegated`, async () => {
      delegated.mockClear();
      const res = await fire(app, path, { session: 'member' });
      const body: any = await res.json();
      expect(res.status).toBe(403);
      expect(body.error?.code).toBe('PERMISSION_DENIED');
      expect(delegated).not.toHaveBeenCalled();
    });

    it(`${path}: an ORG admin is not a platform admin — 403 PERMISSION_DENIED`, async () => {
      // The deliberate tightening this card lands (ADR-0068 D4: platform-
      // operator actions gate on isPlatformAdmin, sole operator). Before the
      // gate, the auth-manager /sso/register before-hook admitted org
      // owners/admins to the two register bridges.
      delegated.mockClear();
      const res = await fire(app, path, { session: 'org-admin' });
      const body: any = await res.json();
      expect(res.status).toBe(403);
      expect(body.error?.code).toBe('PERMISSION_DENIED');
      expect(delegated).not.toHaveBeenCalled();
    });

    it(`${path}: a platform admin passes the gate and IS delegated into better-auth`, async () => {
      delegated.mockClear();
      const res = await fire(app, path, { session: 'platform-admin' });
      const body: any = await res.json();
      // The gate did not refuse — whatever comes back is the vendor's own
      // judgment of the INNER request (here 401/unauthenticated, because the
      // fabricated platform-admin session has no real better-auth cookie for
      // the re-dispatch to carry). The pin is on delegation surviving the
      // gate: hooks keyed on the inner paths still run (see header).
      expect(body.error?.code).not.toBe('UNAUTHENTICATED');
      expect(body.error?.code).not.toBe('PERMISSION_DENIED');
      expect(delegated).toHaveBeenCalledTimes(1);
      const inner = delegated.mock.calls[0][0] as Request;
      expect(new URL(inner.url).pathname.startsWith(`${BASE}/sso/`)).toBe(true);
    });
  }
});

describe('#9653 the card’s assertion: on an SSO-ENABLED fixture a real plain member cannot register an SSO provider', () => {
  let vendor: ReturnType<typeof betterAuth>;
  let memberCookie: string;

  /** First `name=value` pair of every Set-Cookie the response carries. */
  const cookiesOf = (res: Response): string =>
    (res.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(';')[0])
      .join('; ');

  beforeAll(async () => {
    vendor = makeSsoVendor();
    const signUp = await vendor.handler(
      new Request(`${ORIGIN}${BASE}/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({
          email: 'plain.member@example.com',
          password: 'Member-Pass-123!',
          name: 'Plain Member',
        }),
      }),
    );
    expect(signUp.status, await signUp.clone().text()).toBe(200);
    memberCookie = cookiesOf(signUp);
    expect(memberCookie, 'sign-up returned no session cookie').toContain('session_token');
  });

  it('the member (REAL session, capability ON) is refused 403 PERMISSION_DENIED at the bridge, and the vendor is never consulted', async () => {
    const delegated = vi.fn(async (req: Request) => vendor.handler(req));
    const app = await mountBridges({
      // The REAL better-auth session resolution — the same seam the shipped
      // gate reads (`authApi.getSession({ headers })`).
      getSession: (headers) => vendor.api.getSession({ headers }),
      handleRequest: delegated as any,
    });

    const res = await fire(app, `${BASE}/admin/sso/register`, { cookie: memberCookie });
    const body: any = await res.json();
    expect(res.status).toBe(403);
    expect(body.error?.code).toBe('PERMISSION_DENIED');
    expect(delegated).not.toHaveBeenCalled();
  });

  // ── The premise measurement, kept live ────────────────────────────────────
  //
  // The vendor's own authorization for an ORG-LESS registration is a session
  // and nothing else (see header). Pinned network-free by aiming the same
  // member at the vendor's reserved-providerId refusal, which sits AFTER every
  // authorization check (session → providersLimit → organizationId block) and
  // BEFORE any endpoint-URL validation or discovery fetch: reaching it proves
  // the member cleared the vendor's whole authorization prologue.
  //
  // If a vendor bump turns this red with a 401/403 instead, better-auth has
  // started refusing non-admins itself — the ObjectStack gate then stands as
  // pure ADR-0068 D4 defense-in-depth; re-measure and update the posture notes
  // rather than deleting the gate.
  it('measured vendor posture (installed 1.7.1): an org-less /sso/register admits any authenticated user', async () => {
    const registerBody = {
      providerId: 'credential', // always in the vendor's reserved set
      issuer: 'https://idp.example.com',
      domain: 'example.com',
      oidcConfig: {
        clientId: 'cid',
        clientSecret: 'csecret',
        scopes: ['openid', 'email', 'profile'],
        mapping: { email: 'email', name: 'name' },
      },
    };
    const post = (cookie?: string) =>
      vendor.handler(
        new Request(`${ORIGIN}${BASE}/sso/register`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: ORIGIN,
            ...(cookie ? { cookie } : {}),
          },
          body: JSON.stringify(registerBody),
        }),
      );

    // Anonymous: the vendor's session gate refuses.
    const anon = await post();
    expect(anon.status).toBe(401);

    // The authenticated PLAIN MEMBER sails past authorization into business
    // validation — the reserved-id 422, not a 401/403 refusal.
    const member = await post(memberCookie);
    const memberBody = await member.clone().text();
    expect(member.status, memberBody).toBe(422);
    expect(memberBody).toMatch(/reserved/i);
  });
});
