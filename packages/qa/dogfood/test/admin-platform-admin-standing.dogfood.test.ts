// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The ADMIN side of `identity-auth.admin-lifecycle-operations` (#9482) — what a
// real ObjectStack platform admin gets from every `/admin/` route, both when
// the answer is "yes" and when the answer is a REFUSAL THAT IS ON PURPOSE.
//
// Its sibling `admin-route-nonadmin-refusal.dogfood.test.ts` pins the other
// principal: no anonymous caller and no plain member ever gets a 2xx. That file
// deliberately asserted NOTHING about the platform admin's answer on the
// better-auth-gated bucket, because at the time it was written the product
// decision had not been made and pinning either side would have been wrong.
// The decision has since landed. This file is that hole, closed.
//
// ── The decision this file encodes ──────────────────────────────────────────
//
// better-auth's stock `admin` plugin authorizes on the legacy
// `user.role === 'admin'` scalar. ADR-0068 D2 deliberately STOPPED synthesizing
// that scalar — `auth-manager.ts` says so in as many words — and contributes
// `platform_admin` to `positions[]` instead. So the vendor's own `/admin/`
// endpoints refuse a genuine ObjectStack platform admin. Two rulings decided,
// route by route, what to do about that:
//
//   ADMITTED (#9970, #10352, and the pre-existing ObjectStack mounts) — every
//     route with a real ObjectStack consumer was re-authorized on the ADR-0068
//     predicate and now answers the platform admin. `ban-user` / `unban-user`
//     / `create-user` / `set-user-password` / `unlock-user` / `import-users` /
//     `oauth2/toggle-disabled` are raw Hono mounts carrying the shared judge
//     (`platform-admin-gate.ts`); `impersonate-user` is NOT — a raw mount is
//     forbidden there (maintainer ruling 2026-08-20) because it would
//     hand-roll better-auth's signed-cookie contract with
//     `/admin/stop-impersonating` and silently detach the #8243 bearer-rotation
//     hook. It is a better-auth PLUGIN endpoint with only the authorization
//     predicate replaced, and since #11686 that predicate is the consolidated
//     authority `hasPlatformAdminStanding`.
//
//   ⭐ REFUSED BY DESIGN — the eight routes below answer a platform admin
//     `403 YOU_ARE_NOT_ALLOWED_TO_*`, and that is a RULED OUTCOME, not a gap
//     anyone forgot to close:
//
//       #9969 (closed `not_planned`, re-implement-on-demand standing) — seven
//         routes with NO ObjectStack consumer at all: no `type: 'api'` action,
//         no console call, no SDK row, no doc that tells anyone to call them.
//         `remove-user`, `revoke-user-session`, `revoke-user-sessions`,
//         `list-user-sessions`, `update-user`, `list-users`, `get-user`. They
//         are surface the `rawApp.all(`${basePath}/*`)` catch-all publishes
//         because better-auth registers it. Startup scope discipline: do not
//         build seven routes nobody calls. Whichever one first acquires a real
//         consumer gets an ObjectStack mount AT THAT MOMENT.
//
//       #9968 (ruled B, 2026-08-20, reaffirmed 2026-08-22) — `set-role`. Its
//         only effect is `internalAdapter.updateUser(userId, { role })`, i.e.
//         writing the very scalar ADR-0068 D2 retired, which `customSession`
//         then folds back into `positions[]`. A working "Set Platform Role"
//         button would be a supported, gated, one-user-at-a-time channel for
//         resurrecting the dual identity representation the 2026-08-18 Option-3
//         veto killed. So the maintainer retired the CONSOLE ACTION (PR #11530)
//         and left the vendor ROUTE mounted and vendor-gated, byte for byte.
//
// ⛔ THEREFORE: a `403` from any of those eight is the system working. Do not
// "fix" it. Re-implementing one is a product decision with a named trigger (a
// real ObjectStack consumer appearing), and it belongs to #9969 / #9968, not to
// whoever next reads this file and mistakes a deliberate refusal for a bug.
// If you are here because you added that consumer: mount the route with the
// ADR-0068 gate, move its entry from `REFUSED_BY_DESIGN` to `ADMITTED`, and the
// sweep at the bottom will hold you to it.
//
// ── Why the fixture is NOT the one the unit tests use ───────────────────────
//
// `plugin-auth/src/remove-user-atomicity.test.ts` makes better-auth's admin
// endpoints answer by writing `role = 'admin'` onto the admin row in-process.
// That synthesizes a scalar a real deployment never has — which is exactly why
// no existing test observed the defect that produced this whole card family.
// ⛔ Not copied here. The subject below is the identity a real platform admin
// actually carries, and the FIRST test asserts that before any route answer is
// read: `positions` contains `platform_admin`, `isPlatformAdmin` is true, and
// `sys_user.role` is NOT `'admin'`. Every later test refuses to run until that
// control has passed, because without it a 403 could just mean "the fixture was
// never an admin" and the by-design half of this file would be vacuous.
//
// ── Two sides, two instruments ──────────────────────────────────────────────
//
// The transport is shared on purpose (same routes, same stack, one `fire`).
// The EXPECTATIONS are not, and must not be: `expectAdmitted` asserts a 2xx AND
// re-reads the STORED state the call was supposed to move, while
// `expectRefusedByDesign` asserts an exact status+code pair and that NOTHING
// moved. Neither can be satisfied by the other's bug — an `expectAdmitted` that
// silently passed everything would still leave the stored-state read-back
// unsatisfied, and an `expectRefusedByDesign` that silently passed everything
// would not produce the 2xx bodies the admitted half consumes.
//
// ── The sweep is the mirror of the sibling file's ───────────────────────────
//
// The sibling asserts "no non-admin ever gets a 2xx" over a DERIVED population.
// This one asserts the dual over the same derived population: **no route
// refuses the platform admin unless it is a recorded by-design refusal.** That
// is what puts route N+1 in scope automatically — a newly mounted admin route
// that forgets the ADR-0068 gate refuses the platform admin, and fails here by
// name until someone either gates it properly or writes down why it refuses.
//
// @proof: admin-platform-admin-standing

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const SYS = { isSystem: true };
const AUTH_BASE = '/api/v1/auth';

interface Ql {
  find(object: string, query: unknown, ctx: unknown): Promise<unknown>;
  insert(object: string, doc: unknown, ctx: unknown): Promise<unknown>;
}

const rowsOf = (r: unknown): Array<Record<string, unknown>> =>
  Array.isArray(r) ? r : ((r as { records?: Array<Record<string, unknown>> })?.records ?? []);

/**
 * The eight routes that answer a platform admin `403 YOU_ARE_NOT_ALLOWED_TO_*`
 * ON PURPOSE, with the card that ruled each one and the reason in its own
 * words. The `why` string is not decoration — it is printed in the assertion
 * message, so a failure here reads as "the ruled refusal moved", never as
 * "found a 403, presumably a bug".
 */
const REFUSED_BY_DESIGN: Record<
  string,
  { code: string; body?: Record<string, unknown>; query?: string; ruledBy: string; why: string }
> = {
  'POST /api/v1/auth/admin/remove-user': {
    code: 'YOU_ARE_NOT_ALLOWED_TO_DELETE_USERS',
    ruledBy: '#9969 (closed not_planned)',
    why: 'no ObjectStack consumer; re-implement on demand. It also still carries better-auth\'s break-glass last-local-credential before-hook precisely BECAUSE it is not shadowed by a raw mount',
  },
  'POST /api/v1/auth/admin/revoke-user-session': {
    code: 'YOU_ARE_NOT_ALLOWED_TO_REVOKE_USERS_SESSIONS',
    ruledBy: '#9969 (closed not_planned)',
    why: 'no ObjectStack consumer; re-implement on demand',
  },
  'POST /api/v1/auth/admin/revoke-user-sessions': {
    code: 'YOU_ARE_NOT_ALLOWED_TO_REVOKE_USERS_SESSIONS',
    ruledBy: '#9969 (closed not_planned)',
    why: 'no ObjectStack consumer; re-implement on demand',
  },
  'POST /api/v1/auth/admin/list-user-sessions': {
    code: 'YOU_ARE_NOT_ALLOWED_TO_LIST_USERS_SESSIONS',
    ruledBy: '#9969 (closed not_planned)',
    why: 'no ObjectStack consumer; re-implement on demand',
  },
  'POST /api/v1/auth/admin/update-user': {
    code: 'YOU_ARE_NOT_ALLOWED_TO_UPDATE_USERS',
    ruledBy: '#9969 (closed not_planned)',
    why: 'no ObjectStack consumer; re-implement on demand',
  },
  'GET /api/v1/auth/admin/list-users': {
    code: 'YOU_ARE_NOT_ALLOWED_TO_LIST_USERS',
    ruledBy: '#9969 (closed not_planned)',
    why: 'no ObjectStack consumer; the console reads the roster through the ObjectQL sys_user surface, not this endpoint',
  },
  'GET /api/v1/auth/admin/get-user': {
    code: 'YOU_ARE_NOT_ALLOWED_TO_GET_USER',
    ruledBy: '#9969 (closed not_planned)',
    why: 'no ObjectStack consumer; re-implement on demand',
  },
  'POST /api/v1/auth/admin/set-role': {
    code: 'YOU_ARE_NOT_ALLOWED_TO_CHANGE_USERS_ROLE',
    ruledBy: '#9968 (ruled B 2026-08-20, reaffirmed 2026-08-22; action retired by PR #11530)',
    why: 'its ONLY effect is writing the ADR-0068-D2-retired legacy role scalar, which customSession folds back into positions[]. The sys_user console action was RETIRED rather than the route re-implemented — a working one would resurrect the dual identity representation the 2026-08-18 Option-3 veto killed',
  },
};

/**
 * Every `/admin/` route that answers a platform admin WITHOUT a gate refusal.
 * Not all of them reach a 2xx at this boot (the four `/admin/sso/*` bridges
 * land on a capability error while SSO is off, and `oauth2/toggle-disabled`
 * needs a real client row) — what unites them is that the ADR-0068 gate ADMITS
 * the admin and the handler is reached. The ones with an observable stored
 * effect are pinned individually below.
 */
const ADMITTED = [
  'POST /api/v1/auth/admin/ban-user',
  'POST /api/v1/auth/admin/unban-user',
  'POST /api/v1/auth/admin/create-user',
  'POST /api/v1/auth/admin/set-user-password',
  'POST /api/v1/auth/admin/unlock-user',
  'POST /api/v1/auth/admin/import-users',
  'POST /api/v1/auth/admin/oauth2/toggle-disabled',
  'POST /api/v1/auth/admin/impersonate-user',
  'POST /api/v1/auth/admin/sso/register',
  'POST /api/v1/auth/admin/sso/register-saml',
  'POST /api/v1/auth/admin/sso/request-domain-verification',
  'POST /api/v1/auth/admin/sso/verify-domain',
] as const;

/**
 * Routes that answer a non-refusal for a reason unrelated to authorization, so
 * the sweep does not read their answer as evidence either way. Each is recorded
 * with WHY, so this is a classification and not a mute button.
 */
const NOT_AN_AUTHORIZATION_ANSWER: Record<string, string> = {
  'POST /api/v1/auth/admin/has-permission':
    'a permission QUERY, not an operation. It answers 200 {success:false} to the platform admin too, because the vendor evaluates it against the legacy role scalar — the same mismatch, but the shape is an answer, not a refusal',
  'POST /api/v1/auth/admin/stop-impersonating':
    'self-scoped: it ends the CALLER\'s own impersonation. A non-impersonating caller — admin or not — gets 400',
  'GET /api/v1/auth/admin/oauth2/resources': 'oidcProvider plugin not enabled at this boot — 404 to everyone',
  'POST /api/v1/auth/admin/oauth2/resources': 'oidcProvider plugin not enabled at this boot — 404 to everyone',
  'GET /api/v1/auth/admin/oauth2/resources/:identifier': 'oidcProvider plugin not enabled at this boot — 404 to everyone',
  'PATCH /api/v1/auth/admin/oauth2/resources/:identifier': 'oidcProvider plugin not enabled at this boot — 404 to everyone',
  'DELETE /api/v1/auth/admin/oauth2/resources/:identifier': 'oidcProvider plugin not enabled at this boot — 404 to everyone',
  'POST /api/v1/auth/admin/oauth2/resources/:identifier/clients/:client_id':
    'oidcProvider plugin not enabled at this boot — 404 to everyone',
  'DELETE /api/v1/auth/admin/oauth2/resources/:identifier/clients/:client_id':
    'oidcProvider plugin not enabled at this boot — 404 to everyone',
  'POST /api/v1/auth/admin/oauth2/create-client': 'oidcProvider plugin not enabled at this boot — 404 to everyone',
  'PATCH /api/v1/auth/admin/oauth2/update-client': 'oidcProvider plugin not enabled at this boot — 404 to everyone',
};

interface Answer {
  status: number;
  code: string | undefined;
  json: Record<string, unknown>;
  body: string;
}

describe('#9482: what an ObjectStack platform admin gets from every /admin/ route', () => {
  let stack: VerifyStack;
  let ql: Ql;
  let adminToken: string;
  let adminUserId: string;
  let targetUserId: string;
  let priorScim: string | undefined;

  /**
   * The admin-identity control's verdict. ⛔ Every route assertion in this file
   * gates on it: a 403 measured against a subject that was never a platform
   * admin proves nothing, and the by-design half would be vacuous.
   */
  let identityControlPassed = false;

  const requireIdentityControl = () => {
    expect(
      identityControlPassed,
      'the admin-identity control has not passed — no route answer in this file may be read as evidence ' +
        'about authorization until the subject is proven to be an ObjectStack platform admin who is NOT ' +
        'carrying the legacy role scalar',
    ).toBe(true);
  };

  beforeAll(async () => {
    // `/admin/` 501s unless better-auth's admin plugin is on, and `bootStack`
    // exposes no auth-plugin override. `OS_SCIM_ENABLED` is the one env knob
    // that reaches it — `buildPluginList` resolves `admin: pluginConfig.admin ??
    // scimEffective` (ADR-0071, SCIM forces admin on). Read when the auth
    // manager is constructed, so it must precede boot.
    priorScim = process.env.OS_SCIM_ENABLED;
    process.env.OS_SCIM_ENABLED = 'true';
    stack = await bootStack(showcaseStack);
    adminToken = await stack.signIn(); // the seeded dev admin
    ql = await stack.kernel.getServiceAsync<Ql>('objectql');

    // A disposable target, authored at runtime: the stock showcase seeds no
    // second loginable member (#9308) and inventing one in committed metadata
    // would change what the stock app means.
    await stack.signUp('standing.probe.target@example.com', 'Target-Pass-123');
    const [target] = rowsOf(
      await ql.find('sys_user', { where: { email: 'standing.probe.target@example.com' }, limit: 1 }, { context: SYS }),
    );
    targetUserId = String(target.id);
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (priorScim === undefined) delete process.env.OS_SCIM_ENABLED;
    else process.env.OS_SCIM_ENABLED = priorScim;
  });

  /** Shared TRANSPORT. Deliberately produces no expectation of its own. */
  async function fire(route: string, body?: unknown, query = ''): Promise<Answer> {
    const [verb, wire] = route.split(' ');
    const path = wire.replace(/:[A-Za-z_]+/g, 'nonexistent-probe-id').replace('/api/v1', '') + query;
    const res = await stack.apiAs(adminToken, verb, path, body);
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* non-JSON — kept in `body` for the failure message */
    }
    // Two envelopes meet here: ObjectStack's ADR-0112 `{success,error:{code}}`
    // and better-auth's flat `{message,code}`.
    const code =
      ((json.error as { code?: string } | undefined)?.code ?? (json.code as string | undefined)) || undefined;
    return { status: res.status, code, json, body: text.slice(0, 400) };
  }

  /** INSTRUMENT 1 — the admitted side. 2xx, plus the stored state it moved. */
  async function expectAdmitted(route: string, body: unknown, note: string): Promise<Answer> {
    requireIdentityControl();
    const answer = await fire(route, body);
    expect(
      answer.status,
      `${route} refused the platform admin (${answer.status} ${answer.body}) — ${note}. This route is on the ` +
        `ADMITTED list: it carries the ADR-0068 gate and a real ObjectStack consumer, so a refusal here is the ` +
        `#9652 defect returning, not a design decision.`,
    ).toBe(200);
    expect(answer.json.success, `${route}: ${answer.body}`).toBe(true);
    return answer;
  }

  /** INSTRUMENT 2 — the by-design refusal. Exact status AND exact code. */
  async function expectRefusedByDesign(route: string): Promise<Answer> {
    requireIdentityControl();
    const spec = REFUSED_BY_DESIGN[route];
    expect(spec, `${route} is not on the by-design list`).toBeDefined();
    const answer = await fire(route, spec.body, spec.query ?? '');

    expect(
      answer.status,
      `${route} answered the platform admin ${answer.status}, not 403.\n` +
        `⛔ This refusal is RULED, by ${spec.ruledBy}: ${spec.why}.\n` +
        `If the route now ADMITS the admin, someone re-implemented it — move its entry from ` +
        `REFUSED_BY_DESIGN to ADMITTED and pin the effect. If it answers some OTHER refusal, the vendor's ` +
        `posture moved and this pin is the thing that noticed.\n${answer.body}`,
    ).toBe(403);

    // ADR-0112: `code` as well as `status`. A status-only assertion here would
    // stay green against a route that started refusing for a completely
    // different reason — measured on this very surface in #9968's ablation,
    // where a target-guard regression kept the 403 and changed only the code.
    expect(
      answer.code,
      `${route} refused with ${answer.code}, not the vendor denial code this refusal is made of.\n` +
        `A VALIDATION_ERROR here would mean the payload never reached the authorization check and this ` +
        `assertion measured nothing.\n${answer.body}`,
    ).toBe(spec.code);
    return answer;
  }

  // ── 0. THE ADMIN-IDENTITY CONTROL ─────────────────────────────────────────

  it('the subject is a real ObjectStack platform admin, and NOT by the legacy role scalar', async () => {
    const res = await stack.apiAs(adminToken, 'GET', '/auth/get-session');
    expect(res.status, 'get-session did not answer for the admin bearer').toBe(200);
    const session = (await res.json()) as { user?: Record<string, unknown>; session?: Record<string, unknown> };
    const user = session.user ?? {};
    adminUserId = String(user.id ?? '');
    expect(adminUserId, 'no user id on the admin session').not.toBe('');

    // The ADR-0068 spellings, both of them.
    expect(
      user.positions,
      'the subject does not carry the platform_admin position — every refusal measured in this file would ' +
        'then mean "the fixture was never an admin" rather than anything about authorization',
    ).toContain('platform_admin');
    expect(user.isPlatformAdmin, 'the subject is not isPlatformAdmin').toBe(true);

    // ⭐ And the negative half, which is the whole point: the standing above is
    // NOT coming from the legacy scalar. `remove-user-atomicity.test.ts` writes
    // `role = 'admin'` onto the admin row to make the vendor endpoints answer;
    // a fixture that did that here would turn the by-design refusals green for
    // the wrong reason and would not resemble any real deployment.
    expect(
      user.role,
      'the session user carries role === "admin" — the legacy scalar ADR-0068 D2 retired. This fixture is ' +
        'no longer the identity a real platform admin has, and every assertion in this file is measuring ' +
        'the wrong subject',
    ).not.toBe('admin');

    const [adminRow] = rowsOf(await ql.find('sys_user', { where: { id: adminUserId }, limit: 1 }, { context: SYS }));
    expect(adminRow, 'the admin sys_user row did not read back').toBeDefined();
    expect(
      adminRow.role,
      'sys_user.role is "admin" in storage — the scalar a post-ADR-0068-D2 deployment never writes',
    ).not.toBe('admin');

    identityControlPassed = true;
  }, 120_000);

  // ── 1. THE ADMITTED SIDE, with the stored effect read back ────────────────

  it('C0 — ban persists and reverses for a platform admin, through the ObjectStack mounts', async () => {
    const banned = await expectAdmitted(
      'POST /api/v1/auth/admin/ban-user',
      { userId: targetUserId, banReason: 'standing-probe-reason' },
      'ban-user moved onto an ObjectStack raw mount with the ADR-0068 gate by PR #9970',
    );
    expect(banned.json.data, 'ban-user data').toMatchObject({ userId: targetUserId, banned: true });

    // The response is not the assertion — the STORED row is.
    const [afterBan] = rowsOf(await ql.find('sys_user', { where: { id: targetUserId }, limit: 1 }, { context: SYS }));
    expect(afterBan.banned, `sys_user.banned after ban-user: ${JSON.stringify(afterBan)}`).toBeTruthy();
    expect(afterBan.ban_reason, 'the ban reason did not persist').toBe('standing-probe-reason');

    // Reversal — the gate is reversible, not a tombstone.
    await expectAdmitted(
      'POST /api/v1/auth/admin/unban-user',
      { userId: targetUserId },
      'unban-user moved onto an ObjectStack raw mount with the ADR-0068 gate by PR #9970',
    );
    const [afterUnban] = rowsOf(await ql.find('sys_user', { where: { id: targetUserId }, limit: 1 }, { context: SYS }));
    expect(afterUnban.banned, `sys_user.banned after unban-user: ${JSON.stringify(afterUnban)}`).toBeFalsy();
  }, 300_000);

  it('the other ObjectStack-mounted admin operations admit the platform admin and their write lands', async () => {
    await expectAdmitted('POST /api/v1/auth/admin/unlock-user', { userId: targetUserId }, 'pre-existing mount');

    const imported = await expectAdmitted(
      'POST /api/v1/auth/admin/import-users',
      { format: 'json', rows: [{ email: 'standing.probe.imported@example.com', name: 'Imported Probe' }] },
      'pre-existing mount',
    );
    expect(imported.json.data, 'import-users summary').toMatchObject({ summary: { created: 1, errors: 0 } });
    const importedRows = rowsOf(
      await ql.find(
        'sys_user',
        { where: { email: 'standing.probe.imported@example.com' }, limit: 1 },
        { context: SYS },
      ),
    );
    expect(importedRows.length, 'import-users returned created:1 but no sys_user row exists').toBe(1);

    // `oauth2/toggle-disabled` needs a real client row to reach a 2xx — with a
    // missing client it answers 404 RESOURCE_NOT_FOUND, which is the handler
    // being REACHED, not the gate. Seeding one turns "the admin got past the
    // gate" into "the admin's write landed", which is the stronger pin.
    await ql.insert(
      'sys_oauth_application',
      {
        client_id: 'standing-probe-client',
        name: 'Standing Probe Client',
        redirect_uris: JSON.stringify(['https://standing-probe.example/cb']),
        disabled: false,
      },
      { context: SYS },
    );
    const toggled = await expectAdmitted(
      'POST /api/v1/auth/admin/oauth2/toggle-disabled',
      { client_id: 'standing-probe-client', disabled: true },
      'pre-existing mount',
    );
    expect(toggled.json.data).toMatchObject({ client_id: 'standing-probe-client', disabled: true });
    const [client] = rowsOf(
      await ql.find(
        'sys_oauth_application',
        { where: { client_id: 'standing-probe-client' }, limit: 1 },
        { context: SYS },
      ),
    );
    expect(client.disabled, 'toggle-disabled answered 200 but the stored row did not move').toBeTruthy();
  }, 300_000);

  // ── 2. THE BY-DESIGN REFUSALS ─────────────────────────────────────────────

  it('the eight consumer-less admin routes refuse the platform admin BY DESIGN, each with its ruled code', async () => {
    requireIdentityControl();

    // Read the target's whole row first: the refusals must move NOTHING, and
    // three of these eight (remove-user, update-user, revoke-user-sessions)
    // would be plainly visible in it if they had.
    const [before] = rowsOf(await ql.find('sys_user', { where: { id: targetUserId }, limit: 1 }, { context: SYS }));

    const specs: Record<string, unknown> = {
      'POST /api/v1/auth/admin/remove-user': { userId: targetUserId },
      'POST /api/v1/auth/admin/revoke-user-session': { sessionToken: 'standing-probe-session-token' },
      'POST /api/v1/auth/admin/revoke-user-sessions': { userId: targetUserId },
      'POST /api/v1/auth/admin/list-user-sessions': { userId: targetUserId },
      'POST /api/v1/auth/admin/update-user': { userId: targetUserId, data: { name: 'Renamed By A Refused Call' } },
      'POST /api/v1/auth/admin/set-role': { userId: targetUserId, role: 'admin' },
    };
    for (const [route, body] of Object.entries(specs)) {
      const spec = REFUSED_BY_DESIGN[route];
      expect(spec, `${route} has no REFUSED_BY_DESIGN entry — the by-design list and this loop disagree`).toBeDefined();
      spec.body = body as Record<string, unknown>;
      await expectRefusedByDesign(route);
    }
    REFUSED_BY_DESIGN['GET /api/v1/auth/admin/list-users'].query = '?limit=1';
    await expectRefusedByDesign('GET /api/v1/auth/admin/list-users');
    REFUSED_BY_DESIGN['GET /api/v1/auth/admin/get-user'].query = `?id=${targetUserId}`;
    await expectRefusedByDesign('GET /api/v1/auth/admin/get-user');

    // The no-effect control. A refusal that still did the thing is the worst
    // possible reading of a green refusal assertion.
    const [after] = rowsOf(await ql.find('sys_user', { where: { id: targetUserId }, limit: 1 }, { context: SYS }));
    expect(after, 'remove-user answered 403 but the target row is gone').toBeDefined();
    expect(after.name, 'update-user answered 403 but the name changed anyway').toBe(before.name);
    expect(after.role, 'set-role answered 403 but the role scalar moved anyway').toBe(before.role);
    expect(
      after.role,
      '⛔ the target now carries the legacy admin scalar — a refused set-role must never be able to write it',
    ).not.toBe('admin');
  }, 300_000);

  // ── 3. C6 — impersonation, the one ADMITTED route that is not a raw mount ──

  it('C6 — the platform admin may impersonate, and the session records the attribution', async () => {
    requireIdentityControl();

    // ⚠️ This test is ordered near the end and re-signs at its close ON
    // PURPOSE. `rotateCallerBearerOnImpersonation` (#8243) rotates the CALLER's
    // bearer as part of a successful impersonation, so `adminToken` is dead the
    // instant this succeeds — measured: every later call answers 401
    // UNAUTHENTICATED. A file that fired this in the middle would look like a
    // cascade of authorization failures.
    const answer = await fire('POST /api/v1/auth/admin/impersonate-user', { userId: targetUserId });
    expect(
      answer.status,
      `impersonate-user refused the platform admin (${answer.status} ${answer.body}) — the endpoint was ` +
        `re-authorized on the ADR-0068 predicate by PR #10352 and consolidated onto hasPlatformAdminStanding ` +
        `by PR #11686, so a refusal here is that work regressing`,
    ).toBe(200);

    const session = answer.json.session as Record<string, unknown> | undefined;
    expect(session, `impersonate-user 200 with no session in the body: ${answer.body}`).toBeDefined();
    expect(session!.userId, 'the minted session is not for the target').toBe(targetUserId);
    expect(
      session!.impersonatedBy,
      'the impersonated session does not attribute the admin — an unattributable support session is the ' +
        'failure this clause exists to catch',
    ).toBe(adminUserId);

    // Attribution in STORAGE, not just in the response body.
    const [stored] = rowsOf(
      await ql.find('sys_session', { where: { id: String(session!.id) }, limit: 1 }, { context: SYS }),
    );
    expect(stored, 'the impersonated session was not persisted').toBeDefined();
    expect(stored.impersonated_by, `sys_session.impersonated_by: ${JSON.stringify(stored)}`).toBe(adminUserId);

    adminToken = await stack.signIn(); // the rotation above killed the old one
  }, 300_000);

  // ── 4. THE SWEEP — the dual of the sibling file's universal invariant ─────

  it('no /admin/ route refuses the platform admin unless it is a recorded by-design refusal', async () => {
    requireIdentityControl();

    // Derived from the running stack, through the same two seams the sibling
    // file uses: the raw Hono mounts registered ahead of better-auth's
    // catch-all, and better-auth's own endpoint table.
    const http = await stack.kernel.getServiceAsync<{
      getRawApp(): { routes?: Array<{ method?: string; path?: string }> };
    }>('http-server');
    const objectstack = [
      ...new Set(
        (http.getRawApp().routes ?? [])
          .filter((r) => typeof r?.path === 'string' && r.path.includes('/auth/admin/'))
          .map((r) => `${String(r.method).toUpperCase()} ${r.path}`),
      ),
    ];
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
    const derived = [...new Set([...objectstack, ...betterAuth])].sort();

    // Guard the guard: a derivation that silently returned nothing would make
    // the sweep vacuous, and every by-design entry must still be served.
    expect(objectstack.length, 'no ObjectStack raw /admin/ mounts derived').toBeGreaterThan(0);
    expect(betterAuth.size, 'no better-auth /admin/ endpoints derived').toBeGreaterThan(0);
    const missing = Object.keys(REFUSED_BY_DESIGN).filter((r) => !derived.includes(r));
    expect(missing, `by-design route(s) the stack no longer serves — the entries are stale:\n${missing.join('\n')}`).toEqual(
      [],
    );
    const admittedMissing = ADMITTED.filter((r) => !derived.includes(r));
    expect(admittedMissing, `ADMITTED route(s) no longer served:\n${admittedMissing.join('\n')}`).toEqual([]);
    // The two instruments must never be pointed at the same route.
    expect(
      ADMITTED.filter((r) => r in REFUSED_BY_DESIGN),
      'a route is listed as both admitted and refused-by-design',
    ).toEqual([]);

    // Fire everything. ⚠️ ORDER IS LOAD-BEARING: `impersonate-user` goes LAST
    // because it (a) rotates the caller's bearer and (b) answers
    // 403 BANNED_USER — a 403 about the TARGET, not a gate verdict — if the
    // sweep's own `ban-user` call has not been reversed yet. Both are
    // handled explicitly rather than left to sort order.
    const impersonate = 'POST /api/v1/auth/admin/impersonate-user';
    const order = [...derived.filter((r) => r !== impersonate), ...derived.filter((r) => r === impersonate)];

    const bodies: Record<string, { body?: Record<string, unknown>; query?: string }> = {
      'POST /api/v1/auth/admin/create-user': {
        body: { email: 'standing.sweep.created@example.com', name: 'Sweep Probe', password: 'Explicit-Pass-123' },
      },
      'POST /api/v1/auth/admin/set-user-password': { body: { userId: targetUserId, newPassword: 'Rotated-789' } },
      'POST /api/v1/auth/admin/import-users': {
        body: { format: 'json', rows: [{ email: 'standing.sweep.imported@example.com', name: 'Sweep Imported' }] },
      },
      'POST /api/v1/auth/admin/unlock-user': { body: { userId: targetUserId } },
      'POST /api/v1/auth/admin/oauth2/toggle-disabled': { body: { client_id: 'standing-probe-client', disabled: false } },
      'POST /api/v1/auth/admin/sso/register': {
        body: {
          providerId: 'standing-probe-oidc',
          issuer: 'https://issuer.example',
          domain: 'standing-probe.example',
          clientId: 'probe-client',
          clientSecret: 'probe-secret',
        },
      },
      'POST /api/v1/auth/admin/sso/register-saml': {
        body: {
          providerId: 'standing-probe-saml',
          issuer: 'https://saml-issuer.example',
          domain: 'standing-probe-saml.example',
          entryPoint: 'https://saml-issuer.example/sso',
          cert: 'PROBE-CERT',
        },
      },
      'POST /api/v1/auth/admin/sso/request-domain-verification': { body: { providerId: 'standing-probe-oidc' } },
      'POST /api/v1/auth/admin/sso/verify-domain': { body: { providerId: 'standing-probe-oidc' } },
      'POST /api/v1/auth/admin/ban-user': { body: { userId: targetUserId, banReason: 'sweep' } },
      'POST /api/v1/auth/admin/unban-user': { body: { userId: targetUserId } },
      'POST /api/v1/auth/admin/impersonate-user': { body: { userId: targetUserId } },
      'POST /api/v1/auth/admin/has-permission': { body: { permissions: { user: ['list'] } } },
      'POST /api/v1/auth/admin/stop-impersonating': { body: {} },
      ...Object.fromEntries(
        Object.entries(REFUSED_BY_DESIGN).map(([route, spec]) => [route, { body: spec.body, query: spec.query }]),
      ),
    };

    const unexplainedRefusals: string[] = [];
    const unexpectedlyAdmitted: string[] = [];
    for (const route of order) {
      if (route === impersonate) {
        // Guarantee the target is not banned, so a 403 here can only be the
        // gate — never the target guard. (The sweep banned it four routes ago.)
        await fire('POST /api/v1/auth/admin/unban-user', { userId: targetUserId });
      }
      const spec = bodies[route] ?? {};
      const answer = await fire(route, spec.body, spec.query ?? '');
      const isGateRefusal = answer.status === 401 || answer.status === 403;

      if (isGateRefusal && !(route in REFUSED_BY_DESIGN)) {
        unexplainedRefusals.push(`${route} -> ${answer.status} ${answer.code ?? '(no code)'} ${answer.body}`);
      }
      if (!isGateRefusal && route in REFUSED_BY_DESIGN) {
        unexpectedlyAdmitted.push(`${route} -> ${answer.status} ${answer.code ?? '(no code)'} ${answer.body}`);
      }
      if (route === impersonate) adminToken = await stack.signIn(); // #8243 rotation
    }

    expect(
      unexplainedRefusals,
      'an /admin/ route refused the PLATFORM ADMIN and is not on the by-design list. Either it is a new route ' +
        'that forgot the ADR-0068 gate — the #9652 defect, arriving on fresh surface — or it is a deliberate ' +
        'refusal nobody wrote down. Gate it, or add it to REFUSED_BY_DESIGN with the card that ruled it and ' +
        `why:\n${unexplainedRefusals.join('\n')}`,
    ).toEqual([]);

    expect(
      unexpectedlyAdmitted,
      'a route recorded as refused-by-design now ADMITS the platform admin. That is a real behaviour change on ' +
        'an authorization surface: someone re-implemented the route (which #9969 explicitly permits on demand), ' +
        'or the vendor posture moved. Move its entry to ADMITTED and pin the effect — do not delete the ' +
        `assertion:\n${unexpectedlyAdmitted.join('\n')}`,
    ).toEqual([]);

    // Every route the sweep passed over without an authorization reading is
    // classified, so "not a refusal" can never quietly mean "not measured".
    const unclassified = derived.filter(
      (r) => !(r in REFUSED_BY_DESIGN) && !(ADMITTED as readonly string[]).includes(r) && !(r in NOT_AN_AUTHORIZATION_ANSWER),
    );
    expect(
      unclassified,
      'the stack serves /admin/ route(s) this file neither admits, refuses-by-design, nor classifies as ' +
        `answering for a non-authorization reason:\n${unclassified.join('\n')}`,
    ).toEqual([]);
  }, 900_000);
});
