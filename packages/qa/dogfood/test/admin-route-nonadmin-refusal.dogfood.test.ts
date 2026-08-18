// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// C9 of `identity-auth.admin-lifecycle-operations` (#9482) — every `/admin/`
// route refuses a non-admin, over a population DERIVED from the running stack.
//
// ── Why the population is derived and not listed ─────────────────────────────
//
// The clause this file pins is "the gate holds both ways for EVERY admin
// operation". A test that hardcodes today's routes cannot pin that: it passes
// forever while route N+1 ships unguarded, which is the failure this repo has
// already paid for twice (a tripwire aimed at the wrong file, and one keyed off
// a single path spelling rather than the mechanics). So the route set is read
// off the LIVE stack, from the two places admin routes can actually come from:
//
//   HALF A — `honoApp.routes`, the ObjectStack raw mounts. `auth-plugin.ts`
//     registers these directly on the Hono app AHEAD of better-auth's catch-all
//     (`rawApp.all(`${basePath}/*`)`), so they shadow the vendor's handler and
//     never appear in `auth.api`. Measured here: 9 routes.
//
//   HALF B — `auth.api`, the better-auth endpoint table. The catch-all publishes
//     whatever the vendor registers, so there are no per-route registration
//     calls to capture; every endpoint object carries `.path` and
//     `.options.method`, which is why `auth-route-ledger.conformance.test.ts`
//     uses the same seam. Measured here: 24 routes.
//
// Union: 31 routes at the configuration this file boots (5 + 11 + 2 + 4 + 9). Both halves are
// asserted non-empty, and the union is cross-checked against a small ANCHOR set,
// so a derivation that silently returns nothing cannot make the sweep vacuous.
//
// ⛔ The item's own C9 text names SIX routes (ban-user, list-users, create-user,
// set-role, remove-user, revoke-user-sessions). That enumeration is a fifth of
// the real surface. It is left alone here — correcting checklist prose is not
// this file's job — but the re-scoped `automated.ref` records the measured count
// so the next runner does not tick 31 routes off a 6-route reading.
//
// ── A new route fails until it is CLASSIFIED, not merely until it is guarded ──
//
// `EXPECTED` is checked against the derived set in BOTH directions: a route the
// stack serves with no entry fails, and an entry the stack no longer serves
// fails as stale. That is the mechanism that puts route N+1 in scope
// automatically — it cannot be added without someone writing down what its
// non-admin answer is supposed to be.
//
// ── The payloads are load-bearing, and this is the file's sharpest edge ───────
//
// MEASURED: better-auth validates the request body BEFORE it reaches the admin
// check, and so do the ObjectStack `/admin/sso/*`, `/admin/unlock-user` and
// `/admin/oauth2/toggle-disabled` mounts (their handlers read and shape-check
// `body` before calling `getSession`). Fire an EMPTY body at
// `/admin/ban-user` and a plain member receives:
//
//     400 {"message":"[body.userId] Invalid input: …","code":"VALIDATION_ERROR"}
//
// — byte-identical to what the platform admin receives. A route-walk built on
// empty bodies therefore asserts NOTHING about authorization while looking
// exactly like a passing security sweep: every response is non-2xx, every
// assertion green, and the gate is never consulted. So every route below is
// fired with a payload valid enough to reach the authorization check, and the
// refusal assertions carry the `code` as well as the status.
//
// ── Both sides, and the one place this file cannot have them ─────────────────
//
// A refusal-only suite stays green if a route starts refusing EVERYONE, so each
// bucket that can carry an allowed side does:
//
//   `objectstack-gate` (5 routes) — the full contrast. A plain member is refused
//     403 PERMISSION_DENIED, an anonymous caller 401 UNAUTHENTICATED, and the
//     platform admin is NOT refused: the same request reaches the handler and
//     comes back 2xx (unlock-user) or a SEMANTIC error (404 RESOURCE_NOT_FOUND
//     for a missing OAuth client). That is what proves the member's 403 is a
//     gate verdict and not a payload the server rejects for everyone.
//
//   `better-auth-gate` (11 routes) — refusal side only, DELIBERATELY. On this
//     stack the platform admin is refused these routes too, with the same
//     `YOU_ARE_NOT_ALLOWED_TO_*` code as the member. That is not a harness
//     artifact: better-auth's admin plugin authorizes on the legacy
//     `user.role === 'admin'` scalar (constructed at `auth-manager.ts` with
//     `schema` only, so the vendor default `adminRoles: ['admin']` applies),
//     while ADR-0068 D2 deliberately STOPPED synthesizing that scalar —
//     `auth-manager.ts` says so in as many words, and contributes
//     `platform_admin` to `positions[]` instead. Measured on the seeded dev
//     admin: `sys_user.role` is `'user'` and `positions` is
//     `['user','platform_admin']`. It is also why `create-user` and
//     `set-user-password` exist as ObjectStack mounts at all —
//     `admin-user-endpoints.ts` states the reason: the stock endpoint's
//     adminMiddleware "would 403 a platform admin whose legacy `role` scalar was
//     never synthesized".
//
//     The refusal half is still a real security assertion and is pinned. The
//     ALLOWED half is not asserted here, in either direction: pinning today's
//     admin-is-also-refused behaviour would turn the fix red, and pinning the
//     fixed behaviour would be red today. #9482's report carries the finding.
//
//   `self-scoped` (2 routes) — `has-permission` and `stop-impersonating` answer
//     a non-admin without a refusal BY DESIGN, and the invariant is asserted in
//     the shape that actually holds: they must not leak a privileged result.
//     `has-permission` answers 200 with `success:false` (a permission QUERY, and
//     the answer is "no"); `stop-impersonating` answers 400 "You are not
//     impersonating anyone" (it ends the CALLER's own impersonation, so it is
//     self-scoped, not an admin operation). Asserting a 403 on these would be
//     asserting a bug.
//
//   `capability-disabled` (4 routes) — the `/admin/sso/*` bridges. Unlike their
//     five ObjectStack siblings these carry NO ObjectStack-side gate: they
//     re-dispatch the request into better-auth "so all of its gates run"
//     (`register-sso-provider.ts`). On this stack the SSO capability is off, so
//     all three callers — anonymous, member AND platform admin — receive the
//     identical capability error (404 SSO_REGISTER_FAILED / 404
//     SAML_REGISTER_FAILED / 400 DOMAIN_VERIFICATION_DISABLED / 404
//     verify_domain_failed). Authorization is therefore NOT OBSERVABLE on these
//     four here, and this file says so instead of pretending: their delegated
//     gate is UNPROVEN by this pin, and an SSO-enabled deployment is where it
//     would have to be proven. The universal invariant still covers them.
//
//     The one assertion made is a tripwire, not a pin on the disabled state:
//     member and admin must receive the SAME answer. The day SSO is enabled in
//     this fixture those answers diverge, this goes red, and whoever enabled it
//     has to move the route into a bucket that actually checks its gate —
//     rather than inheriting a green that stopped meaning anything.
//
//   `not-mounted` (9 routes) — better-auth publishes the `/admin/oauth2/*`
//     resource and client endpoints from the oidcProvider plugin, which this
//     boot does not enable, so they answer 404 to everyone. A 404 discloses
//     nothing, and the universal invariant below still covers them: no
//     non-admin gets a 2xx.
//
// ── The universal invariant ─────────────────────────────────────────────────
//
// Independent of bucket, and asserted over the WHOLE derived set: neither an
// anonymous caller nor a plain member ever receives a 2xx from any `/admin/`
// route, with the single classified exception of `has-permission`, whose 200
// body is checked to be the negative answer. That is the assertion a newly
// added, silently unguarded route trips.
//
// @proof: admin-route-nonadmin-refusal

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const SYS = { isSystem: true };
const AUTH_BASE = '/api/v1/auth';

/** How a non-admin must be answered by one derived route. */
type Bucket =
  | 'objectstack-gate'
  | 'better-auth-gate'
  | 'self-scoped'
  | 'capability-disabled'
  | 'not-mounted';

interface RouteExpectation {
  bucket: Bucket;
  /** Body valid enough to reach the AUTHORIZATION check. */
  body?: Record<string, unknown>;
  /** Query string for GET routes, for the same reason. */
  query?: string;
  /** Why this route is in its bucket, when that is not obvious. */
  note?: string;
}

/**
 * Anchors — a derivation that returns an empty or truncated table cannot make
 * this suite pass. Deliberately the six routes the item's C9 names, so the
 * clause's own surface is provably inside the swept set.
 */
const ANCHORS = [
  'POST /api/v1/auth/admin/ban-user',
  'GET /api/v1/auth/admin/list-users',
  'POST /api/v1/auth/admin/create-user',
  'POST /api/v1/auth/admin/set-role',
  'POST /api/v1/auth/admin/remove-user',
  'POST /api/v1/auth/admin/revoke-user-sessions',
] as const;

/**
 * Every `/admin/` route this stack serves, and what a non-admin must get from
 * it. Checked for EXACT agreement with the derived set in both directions — a
 * new route with no entry here fails the suite by name.
 */
function expectationsFor(targetUserId: string): Record<string, RouteExpectation> {
  return {
    // ── ObjectStack raw mounts (ADR-0068 platform-admin gate) ──────────────
    'POST /api/v1/auth/admin/create-user': {
      bucket: 'objectstack-gate',
      body: { email: 'refusal.probe.created@example.com', name: 'Refusal Probe', password: 'Explicit-Pass-123' },
    },
    'POST /api/v1/auth/admin/set-user-password': {
      bucket: 'objectstack-gate',
      body: { userId: targetUserId, newPassword: 'Rotated-By-Probe-456' },
    },
    'POST /api/v1/auth/admin/import-users': {
      bucket: 'objectstack-gate',
      body: { format: 'json', rows: [{ email: 'refusal.probe.imported@example.com', name: 'Imported Probe' }] },
    },
    'POST /api/v1/auth/admin/unlock-user': {
      bucket: 'objectstack-gate',
      body: { userId: targetUserId },
    },
    'POST /api/v1/auth/admin/oauth2/toggle-disabled': {
      bucket: 'objectstack-gate',
      body: { client_id: 'refusal-probe-client', disabled: true },
      note: 'admin passes the gate and lands on RESOURCE_NOT_FOUND for the unknown client',
    },
    'POST /api/v1/auth/admin/sso/register': {
      bucket: 'capability-disabled',
      body: {
        providerId: 'refusal-probe-oidc',
        issuer: 'https://issuer.example',
        domain: 'refusal-probe.example',
        clientId: 'probe-client',
        clientSecret: 'probe-secret',
      },
    },
    'POST /api/v1/auth/admin/sso/register-saml': {
      bucket: 'capability-disabled',
      body: {
        providerId: 'refusal-probe-saml',
        issuer: 'https://saml-issuer.example',
        domain: 'refusal-probe-saml.example',
        entryPoint: 'https://saml-issuer.example/sso',
        cert: 'PROBE-CERT',
      },
    },
    'POST /api/v1/auth/admin/sso/request-domain-verification': {
      bucket: 'capability-disabled',
      body: { providerId: 'refusal-probe-oidc' },
    },
    'POST /api/v1/auth/admin/sso/verify-domain': {
      bucket: 'capability-disabled',
      body: { providerId: 'refusal-probe-oidc' },
    },

    // ── better-auth admin plugin (legacy `role` scalar gate) ────────────────
    'POST /api/v1/auth/admin/ban-user': { bucket: 'better-auth-gate', body: { userId: targetUserId, banReason: 'probe' } },
    'POST /api/v1/auth/admin/unban-user': { bucket: 'better-auth-gate', body: { userId: targetUserId } },
    'POST /api/v1/auth/admin/set-role': { bucket: 'better-auth-gate', body: { userId: targetUserId, role: 'admin' } },
    'POST /api/v1/auth/admin/remove-user': { bucket: 'better-auth-gate', body: { userId: targetUserId } },
    'POST /api/v1/auth/admin/impersonate-user': { bucket: 'better-auth-gate', body: { userId: targetUserId } },
    'POST /api/v1/auth/admin/revoke-user-sessions': { bucket: 'better-auth-gate', body: { userId: targetUserId } },
    'POST /api/v1/auth/admin/revoke-user-session': { bucket: 'better-auth-gate', body: { sessionToken: 'probe-session-token' } },
    'POST /api/v1/auth/admin/list-user-sessions': { bucket: 'better-auth-gate', body: { userId: targetUserId } },
    'POST /api/v1/auth/admin/update-user': { bucket: 'better-auth-gate', body: { userId: targetUserId, data: { name: 'Renamed By Probe' } } },
    'GET /api/v1/auth/admin/list-users': { bucket: 'better-auth-gate', query: '?limit=1' },
    'GET /api/v1/auth/admin/get-user': { bucket: 'better-auth-gate', query: `?id=${targetUserId}` },

    // ── answered without a refusal, by design ──────────────────────────────
    'POST /api/v1/auth/admin/has-permission': {
      bucket: 'self-scoped',
      body: { permissions: { user: ['list'] } },
      note: 'a permission QUERY — 200 with success:false is the negative answer, not a leak',
    },
    'POST /api/v1/auth/admin/stop-impersonating': {
      bucket: 'self-scoped',
      body: {},
      note: 'ends the CALLING session\'s own impersonation; a non-impersonating member gets 400',
    },

    // ── published by the catch-all, not mounted at this configuration ───────
    'GET /api/v1/auth/admin/oauth2/resources': { bucket: 'not-mounted' },
    'POST /api/v1/auth/admin/oauth2/resources': { bucket: 'not-mounted' },
    'GET /api/v1/auth/admin/oauth2/resources/:identifier': { bucket: 'not-mounted' },
    'PATCH /api/v1/auth/admin/oauth2/resources/:identifier': { bucket: 'not-mounted' },
    'DELETE /api/v1/auth/admin/oauth2/resources/:identifier': { bucket: 'not-mounted' },
    'POST /api/v1/auth/admin/oauth2/resources/:identifier/clients/:client_id': { bucket: 'not-mounted' },
    'DELETE /api/v1/auth/admin/oauth2/resources/:identifier/clients/:client_id': { bucket: 'not-mounted' },
    'POST /api/v1/auth/admin/oauth2/create-client': { bucket: 'not-mounted' },
    'PATCH /api/v1/auth/admin/oauth2/update-client': { bucket: 'not-mounted' },
  };
}

/** `VERB /wire/path` for every `/admin/` route the RUNNING stack serves. */
async function deriveAdminRoutes(stack: VerifyStack): Promise<{
  half: { objectstack: string[]; betterAuth: string[] };
  all: string[];
}> {
  // HALF A — raw Hono mounts registered ahead of the catch-all.
  const http = await stack.kernel.getServiceAsync<{ getRawApp(): { routes?: Array<{ method?: string; path?: string }> } }>(
    'http-server',
  );
  const honoRoutes = http.getRawApp().routes ?? [];
  const objectstack = [
    ...new Set(
      honoRoutes
        .filter((r) => typeof r?.path === 'string' && r.path.includes('/auth/admin/'))
        .map((r) => `${String(r.method).toUpperCase()} ${r.path}`),
    ),
  ];

  // HALF B — better-auth's own endpoint table, the seam the route ledger uses.
  const authManager = await stack.kernel.getServiceAsync<{
    getAuthInstance(): Promise<{ api?: Record<string, { path?: string; options?: { method?: string | string[] } }> }>;
  }>('auth');
  const auth = await authManager.getAuthInstance();
  const betterAuth = new Set<string>();
  for (const endpoint of Object.values(auth?.api ?? {})) {
    if (typeof endpoint?.path !== 'string' || !endpoint.path.startsWith('/admin/')) continue;
    const method = endpoint.options?.method;
    for (const verb of Array.isArray(method) ? method : [method ?? 'POST']) {
      betterAuth.add(`${String(verb).toUpperCase()} ${AUTH_BASE}${endpoint.path}`);
    }
  }

  return {
    half: { objectstack, betterAuth: [...betterAuth] },
    all: [...new Set([...objectstack, ...betterAuth])].sort(),
  };
}

/** Concrete request path for a derived route (path params filled with a miss). */
const wireOf = (route: string, query = ''): string =>
  route.split(' ')[1].replace(/:[A-Za-z_]+/g, 'nonexistent-probe-id').replace('/api/v1', '') + query;

interface Answer {
  status: number;
  code: string | undefined;
  body: string;
}

describe('#9482 C9: every derived /admin/ route refuses a non-admin', () => {
  let stack: VerifyStack;
  let adminToken: string;
  let memberToken: string;
  let targetUserId: string;
  let derived: Awaited<ReturnType<typeof deriveAdminRoutes>>;
  let expectations: Record<string, RouteExpectation>;
  let priorScim: string | undefined;

  beforeAll(async () => {
    // The `/admin/` surface 501s unless better-auth's admin plugin is on, and
    // `bootStack` exposes no auth-plugin override. `OS_SCIM_ENABLED` is the one
    // env knob that reaches it — `AuthManager.buildPluginList` resolves
    // `admin: pluginConfig.admin ?? scimEffective` (ADR-0071, SCIM forces admin
    // on), the same derivation `admin-identity-audit-trail.dogfood.test.ts`
    // uses. Read when the auth manager is constructed, so it must precede boot.
    priorScim = process.env.OS_SCIM_ENABLED;
    process.env.OS_SCIM_ENABLED = 'true';
    stack = await bootStack(showcaseStack);
    adminToken = await stack.signIn(); // seeded dev admin (platform admin)
    memberToken = await stack.signUp('refusal.probe.member@example.com', 'Member-Pass-123');

    // A disposable target the payloads can name. Authored at runtime — the
    // stock showcase seeds no second loginable member (#9308), and inventing
    // one in committed metadata would change what the stock app means.
    await stack.signUp('refusal.probe.target@example.com', 'Target-Pass-123');
    const ql = await stack.kernel.getServiceAsync<{
      find(o: string, q: unknown, c: unknown): Promise<Array<Record<string, unknown>>>;
    }>('objectql');
    const [target] = await ql.find(
      'sys_user',
      { where: { email: 'refusal.probe.target@example.com' }, limit: 1 },
      { context: SYS },
    );
    targetUserId = String(target.id);

    derived = await deriveAdminRoutes(stack);
    expectations = expectationsFor(targetUserId);
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (priorScim === undefined) delete process.env.OS_SCIM_ENABLED;
    else process.env.OS_SCIM_ENABLED = priorScim;
  });

  /** Fire one derived route as `token` (or anonymously when undefined). */
  async function fire(route: string, token: string | undefined): Promise<Answer> {
    const [verb] = route.split(' ');
    const spec = expectations[route];
    const path = wireOf(route, spec?.query ?? '');
    const res = token
      ? await stack.apiAs(token, verb, path, spec?.body)
      : await stack.api(path, {
          method: verb,
          headers: { 'Content-Type': 'application/json' },
          ...(spec?.body ? { body: JSON.stringify(spec.body) } : {}),
        });
    const body = await res.text();
    let code: string | undefined;
    try {
      const parsed = JSON.parse(body);
      // Two envelopes meet on this surface: ObjectStack's ADR-0112
      // `{success,error:{code}}` and better-auth's flat `{message,code}`.
      code = parsed?.error?.code ?? parsed?.code;
    } catch {
      code = undefined;
    }
    return { status: res.status, code, body: body.slice(0, 300) };
  }

  // ── Guard the guard ────────────────────────────────────────────────────

  it('the derivation reads a real route table from both halves', () => {
    expect(
      derived.half.objectstack.length,
      'no ObjectStack raw /admin/ mounts found — honoApp.routes did not resolve, and every ' +
        'assertion over the derived set would be vacuous',
    ).toBeGreaterThan(0);
    expect(
      derived.half.betterAuth.length,
      'no better-auth /admin/ endpoints found — auth.api did not resolve (a construction ' +
        'failure or a mocked module), and the sweep would assert nothing',
    ).toBeGreaterThan(0);
    // A floor, not an equality: this must not need editing when the vendor adds
    // an endpoint. The EXACT set is pinned by the coverage test below.
    expect(derived.all.length, 'the derived /admin/ surface collapsed').toBeGreaterThanOrEqual(20);

    const missingAnchors = ANCHORS.filter((a) => !derived.all.includes(a));
    expect(
      missingAnchors,
      `routes the checklist item names by hand are absent from the derived set — either the ` +
        `derivation broke or these were renamed:\n${missingAnchors.join('\n')}`,
    ).toEqual([]);
  });

  it('every derived route is classified, and every classification is still served', () => {
    const classified = new Set(Object.keys(expectations));
    const unclassified = derived.all.filter((r) => !classified.has(r)).sort();
    const stale = [...classified].filter((r) => !derived.all.includes(r)).sort();

    expect(
      unclassified,
      'the stack serves /admin/ route(s) this suite does not classify. A new admin route is ' +
        'IN SCOPE the moment it is mounted: add it to EXPECTED with the answer a non-admin ' +
        'must get, and it will be swept from then on.\n' + unclassified.join('\n'),
    ).toEqual([]);
    expect(
      stale,
      `classified route(s) the stack no longer serves — the entries are stale:\n${stale.join('\n')}`,
    ).toEqual([]);

    // The allowed-side contrast has to have somewhere to run, or the both-sides
    // half of this file is quietly empty.
    const gated = Object.values(expectations).filter((e) => e.bucket === 'objectstack-gate');
    expect(gated.length, 'no route carries the allowed-side contrast').toBeGreaterThan(0);
  });

  // ── The universal invariant, over the WHOLE derived set ────────────────

  it('no anonymous caller and no plain member ever gets a 2xx from an /admin/ route', async () => {
    const leaks: string[] = [];
    for (const route of derived.all) {
      for (const [who, token] of [
        ['anonymous', undefined],
        ['member', memberToken],
      ] as const) {
        const answer = await fire(route, token);
        const is2xx = answer.status >= 200 && answer.status < 300;
        if (!is2xx) continue;
        // The one classified exception: a permission QUERY answering "no".
        if (expectations[route]?.bucket === 'self-scoped' && route.endsWith('/has-permission')) {
          expect(
            answer.body,
            `${route} as ${who}: has-permission answered 2xx but not with the negative result`,
          ).toContain('"success":false');
          continue;
        }
        leaks.push(`${route} as ${who} -> ${answer.status} ${answer.body}`);
      }
    }
    expect(
      leaks,
      `an /admin/ route answered a non-admin with success. This is the highest-severity ` +
        `shape this suite exists to catch:\n${leaks.join('\n')}`,
    ).toEqual([]);
  }, 600_000);

  // ── Per-bucket refusal shape, with the allowed side where it exists ────

  it('the ObjectStack-mounted admin routes refuse both ways and admit the platform admin', async () => {
    const routes = derived.all.filter((r) => expectations[r]?.bucket === 'objectstack-gate');
    expect(routes.length, 'no objectstack-gate routes were derived').toBeGreaterThan(0);

    for (const route of routes) {
      const anon = await fire(route, undefined);
      expect(anon.status, `${route} anonymous: ${anon.body}`).toBe(401);
      expect(anon.code, `${route} anonymous code`).toBe('UNAUTHENTICATED');

      const member = await fire(route, memberToken);
      expect(member.status, `${route} member: ${member.body}`).toBe(403);
      expect(member.code, `${route} member code`).toBe('PERMISSION_DENIED');

      // The allowed side on the SAME route and payload: the platform admin is
      // not turned away by the gate. The handler may still answer a semantic
      // error (an unknown OAuth client, an unregistered SSO provider) — what
      // must not happen is the member's refusal.
      const admin = await fire(route, adminToken);
      expect(
        [401, 403].includes(admin.status),
        `${route} platform admin was refused by the gate (${admin.status} ${admin.body}) — ` +
          `the member's 403 above therefore proves nothing about authorization`,
      ).toBe(false);
      expect(admin.code, `${route} platform admin`).not.toBe('PERMISSION_DENIED');
    }
  }, 600_000);

  it('the better-auth admin routes refuse a non-admin with a named vendor code', async () => {
    const routes = derived.all.filter((r) => expectations[r]?.bucket === 'better-auth-gate');
    expect(routes.length, 'no better-auth-gate routes were derived').toBeGreaterThan(0);

    for (const route of routes) {
      const anon = await fire(route, undefined);
      expect(
        [401, 403].includes(anon.status),
        `${route} anonymous should be refused, got ${anon.status} ${anon.body}`,
      ).toBe(true);

      const member = await fire(route, memberToken);
      expect(
        [401, 403].includes(member.status),
        `${route} member should be refused, got ${member.status} ${member.body}`,
      ).toBe(true);
      // When the vendor answers with a body, it must be its own denial
      // vocabulary — not a validation error, which would mean the request died
      // before the gate and this assertion measured nothing.
      if (member.code !== undefined) {
        expect(
          member.code,
          `${route} member: refused with ${member.code}, which is not a denial code. A ` +
            `VALIDATION_ERROR here means the payload never reached the gate.`,
        ).toMatch(/^YOU_ARE_NOT_ALLOWED/);
      }
    }
    // ⛔ No allowed-side assertion in this bucket — see the header: the platform
    // admin is currently refused these routes too (ADR-0068 D2 vs better-auth's
    // `adminRoles: ['admin']`), and pinning EITHER side of that would be wrong.
  }, 600_000);

  it('the /admin/sso/* bridges answer identically to member and admin — authorization is not observable here', async () => {
    // NOT a pin on the capability being off. It is the tripwire described in
    // the header: while SSO is disabled these four cannot distinguish a caller,
    // so a bucket that claimed to check their gate would be checking nothing.
    // Enabling SSO makes member and admin diverge and turns this red on
    // purpose, so the routes get reclassified instead of coasting on a green.
    const routes = derived.all.filter((r) => expectations[r]?.bucket === 'capability-disabled');
    expect(routes.length, 'no capability-disabled routes were derived').toBeGreaterThan(0);

    for (const route of routes) {
      const member = await fire(route, memberToken);
      const admin = await fire(route, adminToken);
      expect(
        member.status >= 200 && member.status < 300,
        `${route}: a plain member got a success answer — ${member.body}`,
      ).toBe(false);
      expect(
        `${member.status} ${member.code}`,
        `${route}: member and platform admin no longer receive the same answer, so this route ` +
          `IS now authorization-observable. Move it to a bucket that asserts its gate — ` +
          `member=${member.status} ${member.code}, admin=${admin.status} ${admin.code}`,
      ).toBe(`${admin.status} ${admin.code}`);
    }
  }, 300_000);

  it('the self-scoped admin routes answer a non-admin without leaking a privileged result', async () => {
    const hasPermission = 'POST /api/v1/auth/admin/has-permission';
    const stopImpersonating = 'POST /api/v1/auth/admin/stop-impersonating';

    const member = await fire(hasPermission, memberToken);
    expect(member.status, `has-permission member: ${member.body}`).toBe(200);
    expect(
      member.body,
      'has-permission must answer a plain member "no" — a true answer would be the leak',
    ).toContain('"success":false');

    const stop = await fire(stopImpersonating, memberToken);
    expect(
      stop.status >= 200 && stop.status < 300,
      `stop-impersonating answered a non-impersonating member with success: ${stop.body}`,
    ).toBe(false);
  }, 300_000);
});
