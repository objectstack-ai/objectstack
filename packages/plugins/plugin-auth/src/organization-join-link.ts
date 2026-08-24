// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Universal organization join link, V1 (#11587, epic #11586).
 *
 * ONE shareable link per organization; anyone opening it registers/logs in
 * and joins as **member**. Six routes, all mounted by `auth-plugin.ts` on the
 * raw app ahead of the better-auth catch-all (the `organization/add-member`
 * precedent), all ledgered in `auth-route-ledger.ts`:
 *
 *   POST /api/v1/auth/organization/create-join-link     org owner/admin
 *   POST /api/v1/auth/organization/rotate-join-link     org owner/admin
 *   POST /api/v1/auth/organization/revoke-join-link     org owner/admin
 *   GET  /api/v1/auth/organization/get-join-link        org owner/admin
 *   GET  /api/v1/auth/organization/get-join-link-info   public, rate-limited
 *   POST /api/v1/auth/organization/accept-join-link     session + verified email
 *
 * ── Authorization: the invite-member predicate family, not a parallel one ──
 *
 * The mutating admin routes are judged by the vendor's OWN permission
 * predicate — `auth.api.hasPermission` with `{ invitation: ['create'] }`
 * (create/rotate/get) and `{ invitation: ['cancel'] }` (revoke) — exactly the
 * checks `organization/invite-member` and `cancel-invitation` run (measured on
 * the installed better-auth 1.7.1, `routes/crud-invites.mjs:95-100,435-438`).
 * Minting a join link IS creating a standing invitation, so it must never be
 * grantable more widely than the email invite. No local re-derivation of the
 * ac map: two spellings of one authorization question cannot be kept in
 * agreement (the remove-member-permission-guard lesson).
 *
 * ── Membership writes go through the governed path ──────────────────────────
 *
 * `accept-join-link` calls the vendor's server-only `auth.api.addMember`
 * (measured: `createAuthEndpoint({ method: 'POST', … })` with NO path in
 * `routes/crud-members.mjs` — the same endpoint the `/organization/add-member`
 * mount wraps), so the already-a-member check, membership limit, organization
 * hooks and the objectql-adapter write (history, attribution) all stay the
 * vendor's. This module NEVER hand-inserts a `sys_member` row.
 *
 * ── Verified email (ruled on the epic) ──────────────────────────────────────
 *
 * Joining requires an authenticated session whose email is VERIFIED —
 * the posture better-auth GHSA-fmh4-wcc4-5jm3 / PR #9877 forced for
 * invitation acceptance, applied here from birth. Refusal: 401
 * `EMAIL_NOT_VERIFIED` (the standard-catalog code; its documented family is
 * 401 — the session lacks a required authentication property, remediation is
 * verify-then-retry, like `MFA_REQUIRED`).
 *
 * ── The token is a bearer credential ────────────────────────────────────────
 *
 * 256-bit `randomBytes`, base64url. The two token-consuming routes are
 * rate-limited per caller (fixed window over the shared counter store — the
 * #2780 OTP-budget machinery), and the info route answers an UNKNOWN token
 * with a bare 404 `JOIN_LINK_INVALID` that names no organization. Live-but-
 * dead states (expired / revoked / exhausted) DO name the organization: the
 * holder received the link legitimately, and the landing page needs "the Acme
 * link expired — ask your admin" to be actionable.
 *
 * ── One active link per org: enforced HERE, and only here ───────────────────
 *
 * `create` refuses with 409 `JOIN_LINK_EXISTS` while a live link exists;
 * `rotate` revokes the current link and mints the replacement in one request.
 * A declared partial unique index cannot back this up: the partial-index
 * declaration surface was retired at protocol 17 (#5248 — remove over
 * enforce), so the endpoints are the single writer. Suppressed generic CRUD
 * (`sys-join-link.object.ts`) is what makes "single writer" true.
 *
 * ── Deliberate V1 limits (documented, not accidental) ───────────────────────
 *
 * - `use_count` is a read-check-write counter: two concurrent joins can
 *   overshoot `max_uses` by one. Bounded, member-grade, accepted for V1 —
 *   the same posture as the OTP budget's non-atomic window.
 * - Non-goals per the epic ruling: domain allowlists, approval queues,
 *   per-link roles, multiple concurrent links, SCIM interplay.
 */

import { randomBytes } from 'node:crypto';
import { MEMBERSHIP_ROLE_MEMBER } from '@objectstack/spec/identity';
import { mapAuthApiError, type EndpointResult } from './admin-user-endpoints.js';
import { incrementFixedWindow, type CounterStore } from './rate-limit-storage.js';

/** The one table this module owns. */
export const JOIN_LINK_OBJECT = 'sys_join_link';

/** Default lifetime of a freshly minted link (ruled on epic #11586). */
export const DEFAULT_JOIN_LINK_TTL_DAYS = 7;

/** Upper bound an admin may stretch `expiresInDays` to. */
export const MAX_JOIN_LINK_TTL_DAYS = 90;

/** Fixed-window budget for the public token-info probe (per caller, 60s). */
export const JOIN_LINK_INFO_RATE_LIMIT = 30;

/** Fixed-window budget for join attempts (per caller, 60s). */
export const JOIN_LINK_ACCEPT_RATE_LIMIT = 10;

const RATE_WINDOW_SECONDS = 60;

/** Engine writes run system-context; ADR-0092 D2 refuses user-context writes. */
const SYSTEM_CTX = { isSystem: true };

/** Minimal better-auth server-api surface these routes drive. */
export interface JoinLinkAuthApi {
  getSession(opts: { headers: Headers }): Promise<unknown>;
  hasPermission(opts: {
    body: { permissions: Record<string, string[]>; organizationId?: string };
    headers: Headers;
  }): Promise<{ success?: boolean } | null>;
  addMember(opts: {
    body: { userId: string; role: string | string[]; organizationId?: string };
  }): Promise<Record<string, unknown> | null>;
}

/** Minimal engine surface (find/insert/update, system-context). */
export interface JoinLinkDataEngine {
  find(object: string, query: Record<string, unknown>, opts?: unknown): Promise<unknown>;
  insert(object: string, data: Record<string, unknown>, opts?: unknown): Promise<unknown>;
  update(object: string, patch: Record<string, unknown>, opts?: unknown): Promise<unknown>;
}

export interface OrganizationJoinLinkDeps {
  getAuthApi(): Promise<Partial<JoinLinkAuthApi> | Record<string, unknown>>;
  getDataEngine(): JoinLinkDataEngine | undefined;
  /** Shared counter store for the two rate-limited public routes. */
  getCounterStore(): Promise<CounterStore>;
  /** Test seam. */
  now?(): Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Envelope helpers (ADR-0112 — code AND status on every refusal)
// ─────────────────────────────────────────────────────────────────────────────

const refusal = (status: number, code: string, message: string): EndpointResult => ({
  status,
  body: { success: false, error: { code, message } },
});

const ok = (data: Record<string, unknown>): EndpointResult => ({
  status: 200,
  body: { success: true, data },
});

const badRequest = (message: string): EndpointResult => refusal(400, 'VALIDATION_ERROR', message);

const notImplemented = (): EndpointResult =>
  refusal(501, 'NOT_IMPLEMENTED', 'The better-auth organization plugin is not enabled (auth.plugins.organization)');

async function parseJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Both spellings, like the sibling mounts (`add-member` reads `userId ?? user_id`). */
function readString(body: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = body[key];
    if (typeof raw === 'string' && raw.length > 0) return raw;
  }
  return undefined;
}

function readBoundedInt(
  body: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): { value?: number; error?: string } {
  const raw = body[key];
  if (raw === undefined || raw === null) return {};
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw !== '' ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) {
    return { error: `${key} must be an integer between ${min} and ${max}` };
  }
  return { value: n };
}

/**
 * Closed query-parameter set for the two GET routes (the 2026-08-12 REST
 * ingress ruling): an unrecognised name gets a located 400 instead of being
 * dropped. Mirrors `packages/rest/src/query-allowlist.ts` semantics — not
 * imported, because those helpers are deliberately internal to the REST
 * server's `req.query` shape and are not on the `@objectstack/rest` barrel;
 * widening that barrel is outside this card.
 */
function refuseUnknownQueryParamsRaw(
  request: Request,
  allowed: readonly string[],
): EndpointResult | undefined {
  const permitted = new Set(allowed);
  const unknown = [...new URL(request.url).searchParams.keys()]
    .filter((k) => !permitted.has(k))
    .sort();
  if (unknown.length === 0) return undefined;
  const subject =
    unknown.length === 1
      ? `The "${unknown[0]}" query parameter is not supported by this endpoint.`
      : `The query parameters ${unknown.map((n) => `"${n}"`).join(', ')} are not supported by this endpoint.`;
  return badRequest(
    `${subject} This endpoint will not silently ignore a parameter it does not understand. ` +
      `Supported parameters: ${[...allowed].sort().join(', ')}.`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Session / permission plumbing
// ─────────────────────────────────────────────────────────────────────────────

interface SessionShape {
  user?: { id?: unknown; email?: unknown; emailVerified?: unknown };
  session?: { activeOrganizationId?: unknown };
}

interface Caller {
  userId: string;
  emailVerified: boolean;
  activeOrganizationId?: string;
}

/** Resolve the session or answer the 401 (anonymous-first, ADR-0112). */
async function resolveCaller(
  api: Partial<JoinLinkAuthApi>,
  request: Request,
): Promise<Caller | EndpointResult> {
  const session = (await api.getSession?.({ headers: request.headers })) as SessionShape | null;
  const userId = session?.user?.id;
  if (!userId) return refusal(401, 'UNAUTHENTICATED', 'Sign in first');
  const active = session?.session?.activeOrganizationId;
  return {
    userId: String(userId),
    emailVerified: session?.user?.emailVerified === true,
    ...(typeof active === 'string' && active.length > 0 ? { activeOrganizationId: active } : {}),
  };
}

/**
 * The invite-member permission family, asked of the VENDOR. Returns undefined
 * when admitted, the 403 otherwise. A non-member throws inside the vendor
 * (`USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION`) — same verdict, same envelope.
 */
async function refuseUnlessOrgPermitted(
  api: Partial<JoinLinkAuthApi>,
  request: Request,
  organizationId: string,
  permissions: Record<string, string[]>,
): Promise<EndpointResult | undefined> {
  try {
    const verdict = await api.hasPermission!({
      body: { permissions, organizationId },
      headers: request.headers,
    });
    if (verdict?.success === true) return undefined;
  } catch {
    // Non-member / vendor refusal — collapsed onto the one 403 below.
  }
  return refusal(403, 'PERMISSION_DENIED', 'Organization owner or admin role required');
}

/** `organizationId` from body, else the caller's active organization. */
function resolveOrganizationId(
  body: Record<string, unknown>,
  caller: Caller,
): string | EndpointResult {
  const explicit = readString(body, 'organizationId', 'organization_id');
  const orgId = explicit ?? caller.activeOrganizationId;
  if (!orgId) {
    return badRequest('organizationId is required (the session has no active organization)');
  }
  return orgId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Row plumbing
// ─────────────────────────────────────────────────────────────────────────────

interface JoinLinkRow {
  id: string;
  organization_id: string;
  token: string;
  expires_at: string | Date;
  revoked_at?: string | Date | null;
  max_uses?: number | null;
  use_count?: number | null;
  [key: string]: unknown;
}

function rowsOf(result: unknown): JoinLinkRow[] {
  if (Array.isArray(result)) return result as JoinLinkRow[];
  const records = (result as { records?: unknown } | null)?.records;
  return Array.isArray(records) ? (records as JoinLinkRow[]) : [];
}

type LinkState = 'valid' | 'expired' | 'revoked' | 'exhausted';

/** Revocation dominates expiry dominates exhaustion — one deterministic order. */
function linkState(link: JoinLinkRow, now: Date): LinkState {
  if (link.revoked_at) return 'revoked';
  const exp = new Date(link.expires_at as string | Date).getTime();
  if (!Number.isFinite(exp) || exp <= now.getTime()) return 'expired';
  const maxUses = typeof link.max_uses === 'number' ? link.max_uses : undefined;
  if (maxUses !== undefined && (link.use_count ?? 0) >= maxUses) return 'exhausted';
  return 'valid';
}

async function findLiveLink(
  engine: JoinLinkDataEngine,
  organizationId: string,
  now: Date,
): Promise<JoinLinkRow | undefined> {
  const rows = rowsOf(
    await engine.find(
      JOIN_LINK_OBJECT,
      { where: { organization_id: organizationId, revoked_at: null }, limit: 50 },
      { context: SYSTEM_CTX },
    ),
  );
  return rows.find((r) => linkState(r, now) === 'valid');
}

async function findByToken(
  engine: JoinLinkDataEngine,
  token: string,
): Promise<JoinLinkRow | undefined> {
  const rows = rowsOf(
    await engine.find(JOIN_LINK_OBJECT, { where: { token }, limit: 1 }, { context: SYSTEM_CTX }),
  );
  return rows[0];
}

async function organizationName(
  engine: JoinLinkDataEngine,
  organizationId: string,
): Promise<string | null> {
  const rows = rowsOf(
    await engine.find(
      'sys_organization',
      { where: { id: organizationId }, limit: 1 },
      { context: SYSTEM_CTX },
    ),
  );
  const name = rows[0]?.name;
  return typeof name === 'string' ? name : null;
}

/** The wire face of a link row — the raw row minus nothing (V1 stores the token retrievably). */
function linkFace(link: JoinLinkRow): Record<string, unknown> {
  return {
    id: link.id,
    organizationId: link.organization_id,
    token: link.token,
    expiresAt: link.expires_at,
    revokedAt: link.revoked_at ?? null,
    maxUses: link.max_uses ?? null,
    useCount: link.use_count ?? 0,
  };
}

function genId(): string {
  return `jlnk_${Date.now().toString(36)}${randomBytes(6).toString('hex')}`;
}

/** ≥128-bit required by the epic; this is 256-bit, URL-safe. */
export function mintJoinToken(): string {
  return randomBytes(32).toString('base64url');
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting (bearer-credential probing resistance)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Best caller key available on a raw Request: proxy-reported IP when present,
 * else a per-fallback bucket. The fallback deliberately still limits (one
 * shared bucket) rather than waving unlabeled traffic through — prefer
 * failing closed on an anti-abuse gate.
 */
function callerKey(request: Request, fallback: string): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return `ip:${first}`;
  }
  const real = request.headers.get('x-real-ip');
  if (real) return `ip:${real.trim()}`;
  return fallback;
}

async function refuseWhenRateLimited(
  deps: OrganizationJoinLinkDeps,
  request: Request,
  route: 'info' | 'accept',
  fallbackKey: string,
  limit: number,
): Promise<EndpointResult | undefined> {
  try {
    const store = await deps.getCounterStore();
    const key = `join-link:${route}:${callerKey(request, fallbackKey)}`;
    const { count } = await incrementFixedWindow(store, key, RATE_WINDOW_SECONDS);
    if (count > limit) {
      return refusal(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests — retry shortly');
    }
  } catch {
    // A broken counter store must not take the join flow down with it —
    // functional degradation, admitted (the resolver already warned once).
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────

function capability(api: Partial<JoinLinkAuthApi>): EndpointResult | undefined {
  // Without the organization plugin there is no member model at all — the
  // add-member precedent's capability probe, on the same two functions these
  // routes drive.
  if (typeof api.addMember !== 'function' || typeof api.hasPermission !== 'function') {
    return notImplemented();
  }
  return undefined;
}

function engineOf(deps: OrganizationJoinLinkDeps): JoinLinkDataEngine | EndpointResult {
  const engine = deps.getDataEngine();
  if (!engine) return refusal(503, 'SERVICE_UNAVAILABLE', 'Data engine is not available yet');
  return engine;
}

interface MintOptions {
  organizationId: string;
  expiresInDays: number;
  maxUses?: number;
}

async function mintLink(
  engine: JoinLinkDataEngine,
  opts: MintOptions,
  now: Date,
): Promise<JoinLinkRow> {
  const expiresAt = new Date(now.getTime() + opts.expiresInDays * 24 * 60 * 60 * 1000);
  const row = await engine.insert(
    JOIN_LINK_OBJECT,
    {
      id: genId(),
      organization_id: opts.organizationId,
      token: mintJoinToken(),
      expires_at: expiresAt,
      revoked_at: null,
      max_uses: opts.maxUses ?? null,
      use_count: 0,
    },
    { context: SYSTEM_CTX },
  );
  return row as JoinLinkRow;
}

/** Shared front half of create/rotate: session → capability → org → permission → parsed knobs. */
async function gateMutation(
  deps: OrganizationJoinLinkDeps,
  request: Request,
  permissions: Record<string, string[]>,
): Promise<
  | { api: Partial<JoinLinkAuthApi>; engine: JoinLinkDataEngine; body: Record<string, unknown>; organizationId: string; caller: Caller }
  | EndpointResult
> {
  const api = (await deps.getAuthApi()) as Partial<JoinLinkAuthApi>;
  const caller = await resolveCaller(api, request);
  if ('status' in caller) return caller;
  const missing = capability(api);
  if (missing) return missing;
  const engine = engineOf(deps);
  if ('status' in engine) return engine;
  const body = await parseJson(request);
  const organizationId = resolveOrganizationId(body, caller);
  if (typeof organizationId !== 'string') return organizationId;
  const denied = await refuseUnlessOrgPermitted(api, request, organizationId, permissions);
  if (denied) return denied;
  return { api, engine, body, organizationId, caller };
}

/** `POST /api/v1/auth/organization/create-join-link` */
export async function runCreateJoinLink(
  deps: OrganizationJoinLinkDeps,
  request: Request,
): Promise<EndpointResult> {
  const gate = await gateMutation(deps, request, { invitation: ['create'] });
  if ('status' in gate) return gate;
  const { engine, body, organizationId } = gate;

  const days = readBoundedInt(body, 'expiresInDays', 1, MAX_JOIN_LINK_TTL_DAYS);
  if (days.error) return badRequest(days.error);
  const maxUses = readBoundedInt(body, 'maxUses', 1, 100000);
  if (maxUses.error) return badRequest(maxUses.error);

  const now = deps.now?.() ?? new Date();
  const existing = await findLiveLink(engine, organizationId, now);
  if (existing) {
    return refusal(
      409,
      'JOIN_LINK_EXISTS',
      'An active join link already exists for this organization — rotate it to replace it, or revoke it first',
    );
  }
  const link = await mintLink(
    engine,
    {
      organizationId,
      expiresInDays: days.value ?? DEFAULT_JOIN_LINK_TTL_DAYS,
      ...(maxUses.value !== undefined ? { maxUses: maxUses.value } : {}),
    },
    now,
  );
  return ok({ link: linkFace(link) });
}

/** `POST /api/v1/auth/organization/rotate-join-link` — revoke current + mint, one request. */
export async function runRotateJoinLink(
  deps: OrganizationJoinLinkDeps,
  request: Request,
): Promise<EndpointResult> {
  const gate = await gateMutation(deps, request, { invitation: ['create'] });
  if ('status' in gate) return gate;
  const { engine, body, organizationId } = gate;

  const days = readBoundedInt(body, 'expiresInDays', 1, MAX_JOIN_LINK_TTL_DAYS);
  if (days.error) return badRequest(days.error);
  const maxUses = readBoundedInt(body, 'maxUses', 1, 100000);
  if (maxUses.error) return badRequest(maxUses.error);

  const now = deps.now?.() ?? new Date();
  const existing = await findLiveLink(engine, organizationId, now);
  if (existing) {
    await engine.update(
      JOIN_LINK_OBJECT,
      { id: existing.id, revoked_at: now },
      { context: SYSTEM_CTX },
    );
  }
  const link = await mintLink(
    engine,
    {
      organizationId,
      expiresInDays: days.value ?? DEFAULT_JOIN_LINK_TTL_DAYS,
      ...(maxUses.value !== undefined ? { maxUses: maxUses.value } : {}),
    },
    now,
  );
  return ok({ link: linkFace(link), rotated: Boolean(existing) });
}

/** `POST /api/v1/auth/organization/revoke-join-link` */
export async function runRevokeJoinLink(
  deps: OrganizationJoinLinkDeps,
  request: Request,
): Promise<EndpointResult> {
  const gate = await gateMutation(deps, request, { invitation: ['cancel'] });
  if ('status' in gate) return gate;
  const { engine, organizationId } = gate;

  const now = deps.now?.() ?? new Date();
  const existing = await findLiveLink(engine, organizationId, now);
  if (!existing) {
    return refusal(404, 'RESOURCE_NOT_FOUND', 'This organization has no active join link');
  }
  const updated = await engine.update(
    JOIN_LINK_OBJECT,
    { id: existing.id, revoked_at: now },
    { context: SYSTEM_CTX },
  );
  return ok({ link: linkFace((updated as JoinLinkRow) ?? { ...existing, revoked_at: now }) });
}

/** `GET /api/v1/auth/organization/get-join-link` — the console's "copy link anytime" read. */
export async function runGetJoinLink(
  deps: OrganizationJoinLinkDeps,
  request: Request,
): Promise<EndpointResult> {
  const refusedQuery = refuseUnknownQueryParamsRaw(request, ['organizationId']);
  if (refusedQuery) return refusedQuery;

  const api = (await deps.getAuthApi()) as Partial<JoinLinkAuthApi>;
  const caller = await resolveCaller(api, request);
  if ('status' in caller) return caller;
  const missing = capability(api);
  if (missing) return missing;
  const engine = engineOf(deps);
  if ('status' in engine) return engine;

  const fromQuery = new URL(request.url).searchParams.get('organizationId') ?? undefined;
  const organizationId = fromQuery ?? caller.activeOrganizationId;
  if (!organizationId) {
    return badRequest('organizationId is required (the session has no active organization)');
  }
  const denied = await refuseUnlessOrgPermitted(api, request, organizationId, {
    invitation: ['create'],
  });
  if (denied) return denied;

  const now = deps.now?.() ?? new Date();
  const existing = await findLiveLink(engine, organizationId, now);
  return ok({ link: existing ? linkFace(existing) : null });
}

/**
 * `GET /api/v1/auth/organization/get-join-link-info?token=…` — the
 * unauthenticated landing-page probe. Org display name + validity state ONLY;
 * an unknown token reveals nothing.
 */
export async function runGetJoinLinkInfo(
  deps: OrganizationJoinLinkDeps,
  request: Request,
): Promise<EndpointResult> {
  const limited = await refuseWhenRateLimited(deps, request, 'info', 'anon', JOIN_LINK_INFO_RATE_LIMIT);
  if (limited) return limited;

  const refusedQuery = refuseUnknownQueryParamsRaw(request, ['token']);
  if (refusedQuery) return refusedQuery;
  const token = new URL(request.url).searchParams.get('token');
  if (!token) return badRequest('token is required');

  const engine = engineOf(deps);
  if ('status' in engine) return engine;

  const link = await findByToken(engine, token);
  if (!link) {
    return refusal(404, 'JOIN_LINK_INVALID', 'This join link is not valid');
  }
  const now = deps.now?.() ?? new Date();
  const state = linkState(link, now);
  const name = await organizationName(engine, link.organization_id);
  return ok({ status: state, organization: { name } });
}

/**
 * `POST /api/v1/auth/organization/accept-join-link` — the join itself.
 * Session + verified email; live-validates the token; membership through the
 * governed `auth.api.addMember`; idempotent when already a member.
 */
export async function runAcceptJoinLink(
  deps: OrganizationJoinLinkDeps,
  request: Request,
): Promise<EndpointResult> {
  const api = (await deps.getAuthApi()) as Partial<JoinLinkAuthApi>;
  const caller = await resolveCaller(api, request);
  if ('status' in caller) return caller;

  const limited = await refuseWhenRateLimited(
    deps,
    request,
    'accept',
    `user:${caller.userId}`,
    JOIN_LINK_ACCEPT_RATE_LIMIT,
  );
  if (limited) return limited;

  if (!caller.emailVerified) {
    return refusal(
      401,
      'EMAIL_NOT_VERIFIED',
      'Verify your email address before joining an organization through a link',
    );
  }
  const missing = capability(api);
  if (missing) return missing;
  const engine = engineOf(deps);
  if ('status' in engine) return engine;

  const body = await parseJson(request);
  const token = readString(body, 'token');
  if (!token) return badRequest('token is required');

  const link = await findByToken(engine, token);
  if (!link) return refusal(404, 'JOIN_LINK_INVALID', 'This join link is not valid');

  const now = deps.now?.() ?? new Date();
  const state = linkState(link, now);
  if (state === 'revoked') {
    return refusal(410, 'JOIN_LINK_REVOKED', 'This join link has been revoked — ask an organization admin for a new one');
  }
  if (state === 'expired') {
    return refusal(410, 'JOIN_LINK_EXPIRED', 'This join link has expired — ask an organization admin for a new one');
  }
  if (state === 'exhausted') {
    return refusal(410, 'JOIN_LINK_EXHAUSTED', 'This join link has reached its maximum number of uses — ask an organization admin for a new one');
  }

  const organizationId = link.organization_id;
  const orgName = await organizationName(engine, organizationId);

  // Idempotent re-join: answered from the membership table, and the same
  // verdict is re-derived from the vendor's own refusal below so a concurrent
  // join cannot turn "already in" into an error.
  const existingMember = rowsOf(
    await engine.find(
      'sys_member',
      { where: { organization_id: organizationId, user_id: caller.userId }, limit: 1 },
      { context: SYSTEM_CTX },
    ),
  )[0];
  if (existingMember) {
    return ok({
      alreadyMember: true,
      member: existingMember,
      organization: { id: organizationId, name: orgName },
    });
  }

  let member: Record<string, unknown> | null;
  try {
    // The governed write: role PINNED to member (never authorable, per the
    // epic ruling), organization explicit, headers deliberately not forwarded
    // — nothing ambient decides the target org. The vendor endpoint is
    // server-only and does no authorization of its own; the LINK is the
    // authorization here, and it was just live-validated.
    member = await api.addMember!({
      body: { userId: caller.userId, role: MEMBERSHIP_ROLE_MEMBER, organizationId },
    });
  } catch (error) {
    const vendorCode = (error as { body?: { code?: string } } | null)?.body?.code;
    if (vendorCode === 'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION') {
      return ok({
        alreadyMember: true,
        member: null,
        organization: { id: organizationId, name: orgName },
      });
    }
    // Everything else — ORGANIZATION_MEMBERSHIP_LIMIT_REACHED (403),
    // ORGANIZATION_NOT_FOUND, … — forwarded verbatim; their checks are not
    // duplicated here (duplicated security checks are where bypasses live).
    return mapAuthApiError(error, 'organization/accept-join-link failed');
  }

  // Best-effort counter (see the module header for the accepted overshoot).
  try {
    await engine.update(
      JOIN_LINK_OBJECT,
      { id: link.id, use_count: (link.use_count ?? 0) + 1 },
      { context: SYSTEM_CTX },
    );
  } catch {
    // The membership write already landed; a failed counter update must not
    // report the join as failed. Exhaustion drifts by at most the failed
    // increments — bounded, and the link stays revocable.
  }

  return ok({
    alreadyMember: false,
    member,
    organization: { id: organizationId, name: orgName },
  });
}
