// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Auth route ledger — the audited disposition of the `/api/v1/auth/*` surface
 * (#3656, closing the widest hole the #3642 capstone measured).
 *
 * WHY THIS ONE IS DIFFERENT. Tranches 1–3 ledgered routes this repo declares.
 * These are declared by **better-auth**, a third-party dependency on its own
 * release cadence, and the plugin mounts them with a single catch-all —
 * `rawApp.all(`${basePath}/*`)` — so there are no per-route registration calls
 * to capture the way tranche 3 captured `registerStorageRoutes`. The seam is
 * `auth.api` instead: every better-auth endpoint object carries `.path` and
 * `.options.method`, so the live instance IS the route table.
 *
 * WHAT IT REPLACES. Until #3656 this whole surface was one `* /auth/**` row in
 * the dispatcher ledger. That row claims a PREFIX, not a resolvable route, and
 * the capstone guard measured what that cost: 54 SDK methods — the largest and
 * most security-relevant namespace in the client — matched on nothing stronger
 * than "something under /auth is claimed". `auth.me` builds
 * `/api/v1/auth/get-session`; a prefix claim cannot tell you better-auth still
 * calls it that. The risk is not hypothetical — this repo already chased
 * better-auth 1.7 column drift in #3624 / #3647.
 *
 * TWO HALVES, DELIBERATELY ASYMMETRIC. `auth-route-ledger.conformance.test.ts`
 * checks them differently, and the asymmetry is a decision, not an oversight:
 *
 *   1. `AUTH_ROUTE_LEDGER` — the reviewed rows: every route the SDK actually
 *      calls, each naming its client method. Checked STRICTLY — a row whose
 *      path better-auth no longer serves fails CI. This is what catches an
 *      upstream rename before it reaches users.
 *   2. `BETTER_AUTH_MOUNTED_SURFACE` — the full inventory of what the catch-all
 *      exposes. Checked for EXACT equality against the live enumeration, in
 *      both directions. It is a machine-maintained list, not reviewed prose:
 *      requiring a hand-written rationale for all ~129 endpoints would make
 *      every better-auth upgrade a hundred-row review and the ledger would rot
 *      into rubber-stamping. But the catch-all publishes whatever upstream
 *      adds, so a version bump that introduces endpoints MUST be visible —
 *      equality makes it a CI diff someone has to look at.
 *
 * ENUMERATION IS CONFIG-DEPENDENT. better-auth plugins are opt-in, so the route
 * set varies with `AuthPluginConfig`. The inventory is pinned at the
 * configuration that turns on every plugin the SDK targets (see
 * `LEDGERED_PLUGIN_CONFIG` in the conformance test) — the maximal surface,
 * so nothing the SDK can reach is missing from it. A deployment running fewer
 * plugins serves a subset; that is correct and is why the SDK rows for gated
 * families carry `requires`.
 *
 * This module is package-internal (not exported from the index): it is the
 * guard's data, not public API. It must stay import-free — the client-side
 * guard imports it as a relative SOURCE file.
 */

/** Disposition of a single auth route. Same vocabulary as the other ledgers. */
export type AuthRouteDisposition =
  /** Expressed by the SDK — `client` names the method (dotted path). */
  | 'sdk'
  /** Should be in the SDK and is not — an open, acknowledged gap. */
  | 'gap'
  /** Deliberately not SDK surface. */
  | 'server-only'
  /** Public, unauthenticated browser-facing route. */
  | 'public'
  /** Server and client disagree on the shape — needs reconciliation. */
  | 'mismatch'
  /**
   * PUBLISHED BY THE CATCH-ALL, REFUSED AT RUNTIME (#7735). The path resolves —
   * better-auth registers the endpoint unconditionally, so it is in
   * `BETTER_AUTH_MOUNTED_SURFACE` and it is NOT a 404-by-absence — but the
   * capability behind it is deliberately not configured, so every call is
   * refused. `note` MUST say which switch is off and what has to be decided
   * before it goes on.
   *
   * This is `gap`'s mirror image, and the pair is why a separate word was worth
   * adding rather than reusing one: `gap` means the server has the capability
   * and the SDK does not express it; `disabled` means the SDK expresses it and
   * the server refuses. Both are "not a live product surface", and neither is a
   * `mismatch` (that word is for a shape disagreement, and its count is
   * ratcheted to zero).
   *
   * ⛔ A `disabled` row is a LEDGER STATE, never a parking space. It exists so
   * the ledger can say "we know, and here is the decision it is waiting on"
   * instead of booking a dead route as `sdk`; the conformance suite pins the
   * set of them against the live better-auth options, so a row cannot sit here
   * while the capability is quietly switched on, nor be re-booked as `sdk`
   * while it is off.
   */
  | 'disabled';

export interface AuthRouteLedgerEntry {
  /** `VERB /api/v1/auth/...` — full wire path at the default base. */
  route: string;
  /** Grouping for diff messages. */
  family: string;
  /**
   * Who declares the route. `better-auth` rows are verified against the live
   * `auth.api` table; `objectstack` rows are mounted by `auth-plugin.ts`
   * directly on the raw app AHEAD of the catch-all, so they never appear there.
   */
  source: 'better-auth' | 'objectstack';
  disposition: AuthRouteDisposition;
  /**
   * Dotted method path on `ObjectStackClient` — required when disposition is
   * `sdk`, and deliberately KEPT on a `disabled` row (#7735): the SDK method
   * still exists and still builds this URL, so erasing the name would hide
   * exactly the fact the row is there to record.
   */
  client?: string;
  /** Optional better-auth plugin this route needs (absent = always mounted). */
  requires?: string;
  /**
   * Name of the `@objectstack/spec/api` export declaring this route's response
   * PAYLOAD — the `data` of the shared `{ success, data }` envelope where the
   * route emits one, the whole body where it does not. The envelope itself is
   * not this field's business; `pnpm check:route-envelope` guards it
   * structurally, and a single field cannot describe both halves honestly.
   *
   * ABSENT MEANS "UNDECLARED", and that is the state of most of the mounted
   * surface: at the #3877 audit, 0 of 237 ledgered routes carried a schema
   * reference. #3877 ruled that authoring the ~190 missing ones is NOT
   * scheduled — a response schema is a product decision about what an endpoint
   * promises, and mass-producing them is precisely how declarations nobody
   * validated come to exist (the four defects #3676/#3833/#3847/#3870 fixed).
   * So this field is filled incrementally, as a family lands conformance
   * coverage or a route is touched for other reasons; a blank one changes no
   * behaviour and is not a defect.
   *
   * ⛔ DO NOT FILL A ROW THAT HAS NO CONFORMANCE COVERAGE. The field exists to
   * make "what does this route declare" queryable so #3877's Stage D ratchet
   * can demand coverage for it; a name written ahead of the test it points at
   * would BE the "declared but unverified" surface the programme exists to
   * remove. `packages/client/src/route-ledger-response-schema.test.ts` resolves
   * every name written here against the live `@objectstack/spec/api` exports,
   * so a typo or a retired schema fails loudly rather than rotting.
   *
   * A NAME rather than a live schema object, deliberately: this module stays
   * import-free — the client-side guards compile it as a relative SOURCE file,
   * and `zod` is not a dependency of every package that owns a ledger. The
   * resolution belongs in the guard that can import the spec, not in the data.
   */
  responseSchema?: string;
  /** One-line rationale. Required for every non-`sdk` disposition. */
  note?: string;
}

export const AUTH_ROUTE_LEDGER: readonly AuthRouteLedgerEntry[] = [
  { route: 'POST /api/v1/auth/change-email', family: 'core-auth', source: 'better-auth', disposition: 'sdk', client: 'auth.changeEmail', note: 'live since #7735: auth-manager.ts sets user.changeEmail.enabled, and the confirmation link rides emailVerification.sendVerificationEmail to the NEW address; since #8019 the OLD address also gets an auth.email_change_notice (notification only — sendChangeEmailConfirmation stays off, it is a gate not a notifier)' },
  { route: 'POST /api/v1/auth/change-password', family: 'core-auth', source: 'better-auth', disposition: 'sdk', client: 'auth.changePassword' },
  // #7735 — self-service account deletion is NOT wired, and this row says so
  // rather than booking it as a live SDK surface. Maintainer ruling
  // 2026-08-12, verbatim: 「`delete-user` 从 ledger 摘掉 mounted 记账(记为
  // disabled/未接线,诚实状态)。⛔ 不配置 `user.deleteUser`:B2B 多租户下自助删号
  // 牵连记录归属与租户数据 …… 自助删号需要一次 deliberate 设计,不由一张 QA 卡带
  // 出来」. The ruling's other reason — that the admin-side `/admin/remove-user`
  // was itself broken — has since expired (#7724 landed), and the conclusion
  // does not move with it: the design question is the standing one, and a
  // future design starts from #7724's deletion semantics.
  { route: 'POST /api/v1/auth/delete-user', family: 'core-auth', source: 'better-auth', disposition: 'disabled', client: 'auth.deleteUser', note: 'better-auth publishes the endpoint but user.deleteUser is deliberately unconfigured, so it answers 404 (as does its GET /delete-user/callback half); self-service deletion needs a deliberate B2B design first — maintainer ruling 2026-08-12 on #7735' },
  { route: 'GET /api/v1/auth/get-session', family: 'core-auth', source: 'better-auth', disposition: 'sdk', client: 'auth.me', note: 'auth.me and auth.refreshToken both target it' },
  { route: 'POST /api/v1/auth/link-social', family: 'core-auth', source: 'better-auth', disposition: 'sdk', client: 'auth.accounts.linkSocial' },
  { route: 'GET /api/v1/auth/list-accounts', family: 'core-auth', source: 'better-auth', disposition: 'sdk', client: 'auth.accounts.list' },
  { route: 'GET /api/v1/auth/list-sessions', family: 'core-auth', source: 'better-auth', disposition: 'sdk', client: 'auth.sessions.list' },
  { route: 'POST /api/v1/auth/revoke-other-sessions', family: 'core-auth', source: 'better-auth', disposition: 'sdk', client: 'auth.sessions.revokeOthers' },
  { route: 'POST /api/v1/auth/revoke-session', family: 'core-auth', source: 'better-auth', disposition: 'sdk', client: 'auth.sessions.revoke' },
  { route: 'POST /api/v1/auth/revoke-sessions', family: 'core-auth', source: 'better-auth', disposition: 'sdk', client: 'auth.sessions.revokeAll' },
  { route: 'POST /api/v1/auth/send-verification-email', family: 'core-auth', source: 'better-auth', disposition: 'sdk', client: 'auth.sendVerificationEmail' },
  { route: 'POST /api/v1/auth/sign-in/email', family: 'core-auth', source: 'better-auth', disposition: 'sdk', client: 'auth.login' },
  { route: 'POST /api/v1/auth/sign-in/social', family: 'core-auth', source: 'better-auth', disposition: 'sdk', client: 'auth.signInWithProvider' },
  { route: 'POST /api/v1/auth/sign-out', family: 'core-auth', source: 'better-auth', disposition: 'sdk', client: 'auth.logout' },
  { route: 'POST /api/v1/auth/sign-up/email', family: 'core-auth', source: 'better-auth', disposition: 'sdk', client: 'auth.register' },
  { route: 'POST /api/v1/auth/unlink-account', family: 'core-auth', source: 'better-auth', disposition: 'sdk', client: 'auth.accounts.unlink' },
  { route: 'POST /api/v1/auth/update-user', family: 'core-auth', source: 'better-auth', disposition: 'sdk', client: 'auth.updateUser' },
  { route: 'GET /api/v1/auth/verify-email', family: 'core-auth', source: 'better-auth', disposition: 'sdk', client: 'auth.verifyEmail' },
  { route: 'POST /api/v1/auth/oauth2/consent', family: 'oauth-provider', source: 'better-auth', disposition: 'sdk', client: 'oauth.consent', requires: 'oidcProvider' },
  { route: 'POST /api/v1/auth/oauth2/create-client', family: 'oauth-provider', source: 'better-auth', disposition: 'sdk', client: 'oauth.applications.register', requires: 'oidcProvider' },
  { route: 'POST /api/v1/auth/oauth2/delete-client', family: 'oauth-provider', source: 'better-auth', disposition: 'sdk', client: 'oauth.applications.delete', requires: 'oidcProvider' },
  { route: 'GET /api/v1/auth/oauth2/get-client', family: 'oauth-provider', source: 'better-auth', disposition: 'sdk', client: 'oauth.applications.get', requires: 'oidcProvider' },
  { route: 'GET /api/v1/auth/oauth2/get-clients', family: 'oauth-provider', source: 'better-auth', disposition: 'sdk', client: 'oauth.applications.list', requires: 'oidcProvider' },
  { route: 'GET /api/v1/auth/oauth2/public-client', family: 'oauth-provider', source: 'better-auth', disposition: 'sdk', client: 'oauth.applications.getPublic', requires: 'oidcProvider' },
  { route: 'GET /api/v1/auth/bootstrap-status', family: 'objectstack-mount', source: 'objectstack', disposition: 'sdk', client: 'auth.bootstrapStatus' },
  { route: 'GET /api/v1/auth/config', family: 'objectstack-mount', source: 'objectstack', disposition: 'sdk', client: 'auth.getConfig' },
  { route: 'POST /api/v1/auth/organization/accept-invitation', family: 'organization', source: 'better-auth', disposition: 'sdk', client: 'organizations.invitations.accept', requires: 'organization' },
  // #9941 — better-auth declares `addMember` with NO HTTP path (server-only
  // `auth.api.addMember`; measured on the installed 1.7.1), so the catch-all
  // never publishes it and it is correctly ABSENT from
  // BETTER_AUTH_MOUNTED_SURFACE. auth-plugin.ts mounts this wrapper itself,
  // ahead of the catch-all, behind the ADR-0068 platform-admin gate — it
  // restores the URL the `sys_member` `add_member` toolbar action has always
  // targeted (on multi-org the only UI path to attach an existing user).
  { route: 'POST /api/v1/auth/organization/add-member', family: 'organization', source: 'objectstack', disposition: 'server-only', requires: 'organization', note: 'no SDK method builds this URL — the sys_member add_member action posts it directly; ObjectStack mount wrapping the vendor server-only auth.api.addMember, platform-admin gated (ADR-0068), #9941' },
  { route: 'POST /api/v1/auth/organization/add-team-member', family: 'organization', source: 'better-auth', disposition: 'sdk', client: 'organizations.teams.addMember', requires: 'organization' },
  { route: 'POST /api/v1/auth/organization/cancel-invitation', family: 'organization', source: 'better-auth', disposition: 'sdk', client: 'organizations.invitations.cancel', requires: 'organization' },
  { route: 'POST /api/v1/auth/organization/create', family: 'organization', source: 'better-auth', disposition: 'sdk', client: 'organizations.create', requires: 'organization' },
  { route: 'POST /api/v1/auth/organization/create-team', family: 'organization', source: 'better-auth', disposition: 'sdk', client: 'organizations.teams.create', requires: 'organization' },
  { route: 'POST /api/v1/auth/organization/delete', family: 'organization', source: 'better-auth', disposition: 'sdk', client: 'organizations.delete', requires: 'organization' },
  { route: 'GET /api/v1/auth/organization/get-active-member', family: 'organization', source: 'better-auth', disposition: 'sdk', client: 'organizations.getActiveMember', requires: 'organization' },
  { route: 'GET /api/v1/auth/organization/get-full-organization', family: 'organization', source: 'better-auth', disposition: 'sdk', client: 'organizations.get', requires: 'organization' },
  { route: 'POST /api/v1/auth/organization/invite-member', family: 'organization', source: 'better-auth', disposition: 'sdk', client: 'organizations.invitations.resend', requires: 'organization', note: 'organizations.invitations.resend and organizations.invite both target it' },
  { route: 'POST /api/v1/auth/organization/leave', family: 'organization', source: 'better-auth', disposition: 'sdk', client: 'organizations.leave', requires: 'organization' },
  { route: 'GET /api/v1/auth/organization/list', family: 'organization', source: 'better-auth', disposition: 'sdk', client: 'organizations.list', requires: 'organization' },
  { route: 'GET /api/v1/auth/organization/list-invitations', family: 'organization', source: 'better-auth', disposition: 'sdk', client: 'organizations.invitations.list', requires: 'organization' },
  { route: 'GET /api/v1/auth/organization/list-members', family: 'organization', source: 'better-auth', disposition: 'sdk', client: 'organizations.listMembers', requires: 'organization' },
  { route: 'GET /api/v1/auth/organization/list-team-members', family: 'organization', source: 'better-auth', disposition: 'sdk', client: 'organizations.teams.listMembers', requires: 'organization' },
  { route: 'GET /api/v1/auth/organization/list-teams', family: 'organization', source: 'better-auth', disposition: 'sdk', client: 'organizations.teams.list', requires: 'organization' },
  { route: 'GET /api/v1/auth/organization/list-user-invitations', family: 'organization', source: 'better-auth', disposition: 'sdk', client: 'organizations.invitations.listMine', requires: 'organization' },
  { route: 'POST /api/v1/auth/organization/reject-invitation', family: 'organization', source: 'better-auth', disposition: 'sdk', client: 'organizations.invitations.reject', requires: 'organization' },
  { route: 'POST /api/v1/auth/organization/remove-member', family: 'organization', source: 'better-auth', disposition: 'sdk', client: 'organizations.removeMember', requires: 'organization' },
  { route: 'POST /api/v1/auth/organization/remove-team', family: 'organization', source: 'better-auth', disposition: 'sdk', client: 'organizations.teams.delete', requires: 'organization' },
  { route: 'POST /api/v1/auth/organization/remove-team-member', family: 'organization', source: 'better-auth', disposition: 'sdk', client: 'organizations.teams.removeMember', requires: 'organization' },
  { route: 'POST /api/v1/auth/organization/set-active', family: 'organization', source: 'better-auth', disposition: 'sdk', client: 'organizations.setActive', requires: 'organization' },
  { route: 'POST /api/v1/auth/organization/update', family: 'organization', source: 'better-auth', disposition: 'sdk', client: 'organizations.update', requires: 'organization' },
  { route: 'POST /api/v1/auth/organization/update-member-role', family: 'organization', source: 'better-auth', disposition: 'sdk', client: 'organizations.updateMemberRole', requires: 'organization' },
  { route: 'POST /api/v1/auth/organization/update-team', family: 'organization', source: 'better-auth', disposition: 'sdk', client: 'organizations.teams.update', requires: 'organization' },
  { route: 'POST /api/v1/auth/two-factor/disable', family: 'two-factor', source: 'better-auth', disposition: 'sdk', client: 'auth.twoFactor.disable', requires: 'twoFactor' },
  { route: 'POST /api/v1/auth/two-factor/enable', family: 'two-factor', source: 'better-auth', disposition: 'sdk', client: 'auth.twoFactor.enable', requires: 'twoFactor' },
  { route: 'POST /api/v1/auth/two-factor/generate-backup-codes', family: 'two-factor', source: 'better-auth', disposition: 'sdk', client: 'auth.twoFactor.generateBackupCodes', requires: 'twoFactor' },
  { route: 'POST /api/v1/auth/two-factor/verify-backup-code', family: 'two-factor', source: 'better-auth', disposition: 'sdk', client: 'auth.twoFactor.verifyBackupCode', requires: 'twoFactor' },
  { route: 'POST /api/v1/auth/two-factor/verify-totp', family: 'two-factor', source: 'better-auth', disposition: 'sdk', client: 'auth.twoFactor.verifyTotp', requires: 'twoFactor' },];


/**
 * Every route the better-auth catch-all publishes at `LEDGERED_PLUGIN_CONFIG`,
 * as `VERB /wire/path`. Machine-maintained: regenerate from the conformance
 * test's failure diff after a better-auth upgrade, then REVIEW the diff — a new
 * entry here is a new publicly-mounted auth endpoint, which is a security
 * surface change even when it is an intended one.
 *
 * ⚠️ PUBLICATION, NOT LIVENESS (#7735). This list answers "what does the
 * catch-all expose", and nothing else — better-auth registers several endpoints
 * unconditionally and then refuses them at runtime when the feature switch
 * behind them is off, so an entry here is NOT evidence that a call succeeds.
 * Today that gap is `POST /api/v1/auth/delete-user` and
 * `GET /api/v1/auth/delete-user/callback`: both are published, both answer 404,
 * because `user.deleteUser` is deliberately unconfigured. The claim about
 * whether a route WORKS lives one list up, in `AUTH_ROUTE_LEDGER`, where that
 * pair carries the `disabled` disposition and its reason.
 *
 * ⛔ So do not "reconcile" a disabled route by deleting it from here. This list
 * is checked for EXACT equality against the live `auth.api` enumeration in both
 * directions; removing a published entry makes the conformance test red and
 * would misreport the mounted attack surface, which is the one thing this list
 * exists to keep honest.
 *
 * The two `/.well-known/*` entries are not under the base path: `auth-plugin.ts`
 * mounts those discovery documents at the app root (RFC 8414 / OIDC require it).
 */
export const BETTER_AUTH_MOUNTED_SURFACE: readonly string[] = [
  'DELETE /api/v1/auth/admin/oauth2/resources/:identifier',
  'DELETE /api/v1/auth/admin/oauth2/resources/:identifier/clients/:client_id',
  'GET /.well-known/oauth-authorization-server',
  'GET /.well-known/openid-configuration',
  'GET /api/v1/auth/account-info',
  'GET /api/v1/auth/admin/get-user',
  'GET /api/v1/auth/admin/list-users',
  'GET /api/v1/auth/admin/oauth2/resources',
  'GET /api/v1/auth/admin/oauth2/resources/:identifier',
  'GET /api/v1/auth/callback/:id',
  'GET /api/v1/auth/delete-user/callback',
  'GET /api/v1/auth/device',
  'GET /api/v1/auth/error',
  'GET /api/v1/auth/get-session',
  'GET /api/v1/auth/jwks',
  'GET /api/v1/auth/list-accounts',
  'GET /api/v1/auth/list-sessions',
  'GET /api/v1/auth/magic-link/verify',
  'GET /api/v1/auth/oauth2/authorize',
  'GET /api/v1/auth/oauth2/end-session',
  'GET /api/v1/auth/oauth2/get-client',
  'GET /api/v1/auth/oauth2/get-clients',
  'GET /api/v1/auth/oauth2/get-consent',
  'GET /api/v1/auth/oauth2/get-consents',
  'GET /api/v1/auth/oauth2/public-client',
  'GET /api/v1/auth/oauth2/userinfo',
  'GET /api/v1/auth/ok',
  'GET /api/v1/auth/organization/get-active-member',
  'GET /api/v1/auth/organization/get-active-member-role',
  'GET /api/v1/auth/organization/get-full-organization',
  'GET /api/v1/auth/organization/get-invitation',
  'GET /api/v1/auth/organization/get-organization',
  'GET /api/v1/auth/organization/list',
  'GET /api/v1/auth/organization/list-invitations',
  'GET /api/v1/auth/organization/list-members',
  'GET /api/v1/auth/organization/list-team-members',
  'GET /api/v1/auth/organization/list-teams',
  'GET /api/v1/auth/organization/list-user-invitations',
  'GET /api/v1/auth/organization/list-user-teams',
  'GET /api/v1/auth/reset-password/:token',
  'GET /api/v1/auth/token',
  'GET /api/v1/auth/verify-email',
  'PATCH /api/v1/auth/admin/oauth2/resources/:identifier',
  'PATCH /api/v1/auth/admin/oauth2/update-client',
  'POST /api/v1/auth/admin/ban-user',
  'POST /api/v1/auth/admin/create-user',
  'POST /api/v1/auth/admin/has-permission',
  'POST /api/v1/auth/admin/impersonate-user',
  'POST /api/v1/auth/admin/list-user-sessions',
  'POST /api/v1/auth/admin/oauth2/create-client',
  'POST /api/v1/auth/admin/oauth2/resources',
  'POST /api/v1/auth/admin/oauth2/resources/:identifier/clients/:client_id',
  'POST /api/v1/auth/admin/remove-user',
  'POST /api/v1/auth/admin/revoke-user-session',
  'POST /api/v1/auth/admin/revoke-user-sessions',
  'POST /api/v1/auth/admin/set-role',
  'POST /api/v1/auth/admin/set-user-password',
  'POST /api/v1/auth/admin/stop-impersonating',
  'POST /api/v1/auth/admin/unban-user',
  'POST /api/v1/auth/admin/update-user',
  'POST /api/v1/auth/callback/:id',
  'POST /api/v1/auth/change-email',
  'POST /api/v1/auth/change-password',
  'POST /api/v1/auth/delete-user',
  'POST /api/v1/auth/device/approve',
  'POST /api/v1/auth/device/code',
  'POST /api/v1/auth/device/deny',
  'POST /api/v1/auth/device/token',
  'POST /api/v1/auth/get-access-token',
  'POST /api/v1/auth/get-session',
  'POST /api/v1/auth/link-social',
  'POST /api/v1/auth/oauth2/authorize',
  'POST /api/v1/auth/oauth2/client/rotate-secret',
  'POST /api/v1/auth/oauth2/consent',
  'POST /api/v1/auth/oauth2/continue',
  'POST /api/v1/auth/oauth2/create-client',
  'POST /api/v1/auth/oauth2/delete-client',
  'POST /api/v1/auth/oauth2/delete-consent',
  // RP-initiated logout, POST form (OIDC RP-Initiated Logout §3). Added by the
  // stable 1.7 line (#3002) as the POST counterpart of the already-mounted
  // `GET /api/v1/auth/oauth2/end-session`, plus its confirmation step. Same
  // handler and same gating as the GET — the confirm step is what stops a
  // cross-site GET from silently ending a session.
  'POST /api/v1/auth/oauth2/end-session',
  'POST /api/v1/auth/oauth2/end-session/confirm',
  'POST /api/v1/auth/oauth2/introspect',
  'POST /api/v1/auth/oauth2/public-client-prelogin',
  'POST /api/v1/auth/oauth2/register',
  'POST /api/v1/auth/oauth2/revoke',
  'POST /api/v1/auth/oauth2/token',
  'POST /api/v1/auth/oauth2/update-client',
  'POST /api/v1/auth/oauth2/update-consent',
  'POST /api/v1/auth/oauth2/userinfo',
  'POST /api/v1/auth/organization/accept-invitation',
  'POST /api/v1/auth/organization/add-team-member',
  'POST /api/v1/auth/organization/cancel-invitation',
  'POST /api/v1/auth/organization/check-slug',
  'POST /api/v1/auth/organization/create',
  'POST /api/v1/auth/organization/create-team',
  'POST /api/v1/auth/organization/delete',
  'POST /api/v1/auth/organization/has-permission',
  'POST /api/v1/auth/organization/invite-member',
  'POST /api/v1/auth/organization/leave',
  'POST /api/v1/auth/organization/reject-invitation',
  'POST /api/v1/auth/organization/remove-member',
  'POST /api/v1/auth/organization/remove-team',
  'POST /api/v1/auth/organization/remove-team-member',
  'POST /api/v1/auth/organization/set-active',
  'POST /api/v1/auth/organization/set-active-team',
  'POST /api/v1/auth/organization/update',
  'POST /api/v1/auth/organization/update-member-role',
  'POST /api/v1/auth/organization/update-team',
  'POST /api/v1/auth/refresh-token',
  'POST /api/v1/auth/request-password-reset',
  'POST /api/v1/auth/reset-password',
  'POST /api/v1/auth/revoke-other-sessions',
  'POST /api/v1/auth/revoke-session',
  'POST /api/v1/auth/revoke-sessions',
  'POST /api/v1/auth/send-verification-email',
  'POST /api/v1/auth/sign-in/email',
  'POST /api/v1/auth/sign-in/magic-link',
  'POST /api/v1/auth/sign-in/social',
  'POST /api/v1/auth/sign-out',
  'POST /api/v1/auth/sign-up/email',
  'POST /api/v1/auth/two-factor/disable',
  'POST /api/v1/auth/two-factor/enable',
  'POST /api/v1/auth/two-factor/generate-backup-codes',
  'POST /api/v1/auth/two-factor/get-totp-uri',
  'POST /api/v1/auth/two-factor/send-otp',
  'POST /api/v1/auth/two-factor/verify-backup-code',
  'POST /api/v1/auth/two-factor/verify-otp',
  'POST /api/v1/auth/two-factor/verify-totp',
  'POST /api/v1/auth/unlink-account',
  'POST /api/v1/auth/update-session',
  'POST /api/v1/auth/update-user',
  'POST /api/v1/auth/verify-password',];
