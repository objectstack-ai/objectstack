// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * REST surface for ShareLinkService.
 *
 *   POST   /api/v1/share-links                 → create a link      → data: link
 *   GET    /api/v1/share-links                 → list links         → data: link[]
 *                                                (?object, ?recordId, ?includeRevoked)
 *   DELETE /api/v1/share-links/:idOrToken      → revoke             → data: { ok: true }
 *   GET    /api/v1/share-links/:token/resolve  → resolve token      → data: { record, link, redactFields }
 *   GET    /api/v1/share-links/:token/messages → conversation rows  → data: ai_messages[]
 *
 * Every body is the declared `{ success: true, data }` / `{ success: false,
 * error: { code, message } }` envelope, written by the shared `sendOk` /
 * `sendError` (`@objectstack/types`). Read the note below on why `data` carries
 * the payload bare: the shapes above are the dispatcher twin's, which this module
 * converged onto in #3983, and the `success` flag they used to omit is why two
 * `client.shareLinks.*` methods were broken here.
 *
 * The resolve route is intentionally public — it's the only endpoint
 * holders of a token need. It does:
 *
 *   1. Look up the row by token (via ShareLinkService.resolveToken,
 *      which gates audience / expiry / password and stamps usage).
 *   2. Fetch the underlying record with a SYSTEM context (so the read
 *      bypasses normal RLS — the token IS the authorisation).
 *   3. Strip `redactFields` from the record before returning.
 *
 * For browser-rendered share pages, the front-end calls this endpoint
 * and renders the response read-only.
 */

import type { IHttpServer, IHttpRequest, RouteHandler } from '@objectstack/spec/contracts';
// The declared envelope is written in ONE place for the whole platform (#3973).
import { sendOk, sendError } from '@objectstack/types';
import type { ShareLinkExecutionContext } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { ShareLinkService } from './share-link-service.js';
import type { SharingEngine } from './sharing-service.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

export interface ShareLinkRoutesOptions {
  basePath?: string;
  /**
   * Derive the VERIFIED caller identity for the authenticated routes
   * (create / list / revoke). Production wiring (`SharingServicePlugin`) passes
   * a resolver backed by `resolveAuthzContext` (session / API key / OAuth).
   *
   * [Finding-2] The default is SECURE: it trusts NO identity header and yields
   * an anonymous context (the authenticated routes then 401). The old default
   * trusted `x-user-id` / `x-tenant-id`, which let a client forge attribution
   * and enumerate/revoke other users' links.
   *
   * [#6206 / #6430] It returns the FULL {@link ExecutionContext} — the whole
   * `resolveAuthzContext` envelope — because this module forwards it unchanged
   * into `createLink` / `listLinks` / `revokeLink`, every one of which
   * ADJUDICATES access. A resolver that rebuilds a subset here silently changes
   * those verdicts: `accessible_org_ids` is the `group`-posture Layer 0 wall
   * (ADR-0105 D2) and denies when absent. The routes' OWN decision — is this
   * request authenticated at all? — is the only thing they read off it
   * themselves, via {@link isAuthenticated}.
   */
  contextFromRequest?: (req: IHttpRequest) => ExecutionContext | Promise<ExecutionContext>;
}

// [Finding-2] Secure default: anonymous (no identity read from headers). A
// deployment that wants authenticated share-link management must wire a
// verified `contextFromRequest` (the plugin does).
const defaultContext = (_req: IHttpRequest): ExecutionContext => ({});

/**
 * [#6206] The routes' own 401 gate — authenticated vs anonymous, and nothing
 * more.
 *
 * Typed to {@link ShareLinkExecutionContext} deliberately: that is the shape
 * the contract retains for exactly this decision, and narrowing HERE (at the
 * read) rather than at the resolver (at the production site) is the whole point
 * of the ruling. The gate reads no authorization dimension, so it needs no
 * authorization envelope — while the object the routes hand on to the service
 * stays the complete one.
 */
function isAuthenticated(ctx: ShareLinkExecutionContext): boolean {
  return Boolean(ctx.userId);
}

/**
 * ## Why `data` carries the payload bare on this module's five routes
 *
 * `sendOk(res, links)`, not `sendOk(res, { links })`.
 *
 * These five routes have a twin: `runtime/src/domains/share-links.ts` serves
 * the same paths off the dispatcher, and for cloud's per-environment kernels
 * that twin is the DESIGNED PRIMARY surface (`registerShareLinkRoutes: false`).
 * It has always answered in the declared envelope with `data` as the payload —
 * `data: link`, `data: links`, `data: { ok: true }`, `data: { record, link,
 * redactFields }`, `data: rows`. This module answered `{ link }`, `{ links }`,
 * `{ ok: true }`, `{ record, link, redactFields }`, `{ data: rows }`. Same
 * routes, two shapes, decided by which surface happened to mount them — the
 * asymmetry #3636 fixed for `/i18n`, one domain over.
 *
 * That was not cosmetics. Three of these routes are `disposition: 'sdk'` in
 * `runtime/src/route-ledger.ts` (`shareLinks.create` / `.list` / `.revoke`), and
 * `ObjectStackClient.unwrapResponse` keys on a boolean `success`. With no flag
 * it returns the body verbatim, so against THIS surface `shareLinks.create()`
 * handed back `{ link: … }` (making the documented `.token` `undefined`) and
 * `shareLinks.list()` handed back `{ links: [] }`, so any `.map()` on it threw.
 * `packages/client/src/admin-surfaces.test.ts` mocks all three as
 * `{ success: true, data: <payload> }`: the SDK was written and tested against
 * the dispatcher's shape (#3983).
 *
 * So passing the payload bare is what makes `unwrapResponse` return the same
 * value on both surfaces, and it is what the consumers already read
 * (`body.links ?? body.data`, `created.link ?? created.data`, `body?.data ?? []`)
 * — they carry that tolerance precisely BECAUSE both shapes existed in the
 * fleet. Prime Directive #12: the shim goes once the producer agrees.
 */

/** Strip `redactFields` from a record (also removes from nested arrays of objects). */
function applyRedaction(record: any, redactFields: string[]): any {
  if (!record || typeof record !== 'object' || redactFields.length === 0) return record;
  if (Array.isArray(record)) return record.map((r) => applyRedaction(r, redactFields));
  const out: any = {};
  for (const [k, v] of Object.entries(record)) {
    if (redactFields.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

export function registerShareLinkRoutes(
  http: IHttpServer,
  service: ShareLinkService,
  engine: SharingEngine,
  opts: ShareLinkRoutesOptions = {},
): void {
  const base = opts.basePath ?? '/api/v1/share-links';
  const ctxOf = opts.contextFromRequest ?? defaultContext;

  // ── CREATE ─────────────────────────────────────────────────────
  http.post(base, (async (req, res) => {
    try {
      const ctx = await ctxOf(req);
      // [Finding-2] Managing links requires a verified principal.
      if (!isAuthenticated(ctx)) return sendError(res, 401, 'UNAUTHENTICATED', 'Sign in to create share links');
      const body: any = req.body ?? {};
      if (!body.object || !body.recordId) {
        return sendError(res, 400, 'VALIDATION_FAILED', 'object and recordId are required');
      }
      const link = await service.createLink(
        {
          object: body.object,
          recordId: body.recordId,
          permission: body.permission,
          audience: body.audience,
          expiresAt: body.expiresAt ?? null,
          emailAllowlist: body.emailAllowlist,
          password: body.password,
          redactFields: body.redactFields,
          label: body.label,
        },
        ctx,
      );
      // Echo the token in the create response only — the listing
      // endpoint also returns it (admins need to copy/recreate URLs),
      // but downstream API consumers typically derive the public URL
      // from `link.token` immediately.
      sendOk(res, link, 201);
    } catch (err: any) {
      sendError(res, err?.status ?? 500, err?.code ?? 'INTERNAL', err?.message ?? 'Failed to create link');
    }
  }) satisfies RouteHandler);

  // ── LIST ───────────────────────────────────────────────────────
  http.get(base, (async (req, res) => {
    try {
      const ctx = await ctxOf(req);
      if (!isAuthenticated(ctx)) return sendError(res, 401, 'UNAUTHENTICATED', 'Sign in to list share links');
      const q = req.query ?? {};
      const links = await service.listLinks(
        {
          object: typeof q.object === 'string' ? q.object : undefined,
          recordId: typeof q.recordId === 'string' ? q.recordId : undefined,
          // [Finding-2] Force the caller's own id — a client can no longer pass
          // `?createdBy=<victim>` to enumerate another user's link tokens.
          createdBy: ctx.userId,
          includeRevoked: q.includeRevoked === 'true' || q.includeRevoked === '1',
        },
        ctx,
      );
      sendOk(res, links);
    } catch (err: any) {
      sendError(res, err?.status ?? 500, err?.code ?? 'INTERNAL', err?.message ?? 'Failed to list links');
    }
  }) satisfies RouteHandler);

  // ── REVOKE ─────────────────────────────────────────────────────
  http.delete(`${base}/:idOrToken`, (async (req, res) => {
    try {
      const ctx = await ctxOf(req);
      if (!isAuthenticated(ctx)) return sendError(res, 401, 'UNAUTHENTICATED', 'Sign in to revoke share links');
      await service.revokeLink(req.params.idOrToken, ctx);
      // `{ ok: true }` moves from BEING the body to being its `data`. It was a
      // second word for `success` at the top level (#3689 retired that from
      // storage); inside `data` it is just the payload, and it is the payload the
      // dispatcher twin and `admin-surfaces.test.ts` both already use.
      sendOk(res, { ok: true });
    } catch (err: any) {
      sendError(res, err?.status ?? 500, err?.code ?? 'INTERNAL', err?.message ?? 'Failed to revoke link');
    }
  }) satisfies RouteHandler);

  // ── PUBLIC RESOLVE ────────────────────────────────────────────
  //
  // No `ctxOf` here — the token IS the authorisation. We still allow
  // probes from a signed-in user so audience=signed_in is satisfiable.
  http.get(`${base}/:token/resolve`, (async (req, res) => {
    try {
      const q = req.query ?? {};
      // [Finding-2] The `audience: 'signed_in'` gate must key off the VERIFIED
      // session, not a spoofable `x-user-id` header — otherwise anyone can pass
      // the "must be signed in" check by inventing a user id.
      const signedInUserId = (await ctxOf(req)).userId;
      const recipientEmail = typeof q.email === 'string' ? q.email : undefined;
      const providedPassword =
        typeof q.password === 'string'
          ? q.password
          : (() => {
              const v = req.headers?.['x-share-password'];
              return Array.isArray(v) ? v[0] : v;
            })();

      const resolved = await service.resolveToken(req.params.token, {
        signedInUserId,
        recipientEmail,
        providedPassword,
      });
      if (!resolved) {
        // Probe row to give a more useful status code (401 vs 404 vs 410).
        const probe = await engine.find('sys_share_link', {
          where: { token: req.params.token },
          limit: 1,
          context: SYSTEM_CTX,
        } as any);
        const row = Array.isArray(probe) && probe[0] ? (probe[0] as any) : null;
        if (row && !row.revoked_at && (!row.expires_at || Date.parse(row.expires_at) > Date.now())) {
          if (row.password_hash) {
            return sendError(
              res,
              401,
              providedPassword ? 'WRONG_PASSWORD' : 'NEEDS_PASSWORD',
              providedPassword ? 'Incorrect password' : 'This link requires a password',
            );
          }
          if (row.audience === 'signed_in' && !signedInUserId) {
            return sendError(res, 401, 'SIGN_IN_REQUIRED', 'Please sign in to view this link');
          }
        }
        if (row && (row.revoked_at || (row.expires_at && Date.parse(row.expires_at) <= Date.now()))) {
          return sendError(res, 410, 'EXPIRED_OR_REVOKED', 'Share link has expired or been revoked');
        }
        return sendError(res, 404, 'INVALID_OR_EXPIRED', 'Share link is invalid, expired, or revoked');
      }

      // Fetch the underlying record with system context — the token
      // gates access, RLS does not.
      const rows = await engine.find(resolved.link.object_name, {
        where: { id: resolved.link.record_id },
        limit: 1,
        context: SYSTEM_CTX,
      } as any);
      const record = Array.isArray(rows) && rows[0] ? rows[0] : null;
      if (!record) {
        return sendError(res, 410, 'RECORD_GONE', 'The shared record no longer exists');
      }

      sendOk(res, {
        record: applyRedaction(record, resolved.redactFields),
        link: {
          id: resolved.link.id,
          token: resolved.link.token,
          object_name: resolved.link.object_name,
          record_id: resolved.link.record_id,
          permission: resolved.link.permission,
          audience: resolved.link.audience,
          expires_at: resolved.link.expires_at,
          label: resolved.link.label,
          created_at: resolved.link.created_at,
        },
        redactFields: resolved.redactFields,
      });
    } catch (err: any) {
      sendError(res, err?.status ?? 500, err?.code ?? 'INTERNAL', err?.message ?? 'Failed to resolve link');
    }
  }) satisfies RouteHandler);

  // ──────────────────────────────────────────────────────────────
  // Object-specific related-records lookup.
  //
  // Some objects only make sense alongside their children — most
  // notably `ai_conversations` and the `ai_messages` they own. Rather
  // than baking every relationship into the resolver, we expose a
  // narrow, opt-in `GET /:token/messages` route that:
  //
  //   1. Re-validates the capability token (so revocation / expiry
  //      kicks in even after the original resolve).
  //   2. Confirms the shared record really is an `ai_conversations`.
  //   3. Returns the conversation's messages, ordered by creation.
  //
  // Other object kinds can register additional public endpoints
  // following the same pattern.
  // ──────────────────────────────────────────────────────────────
  http.get(`${base}/:token/messages`, (async (req, res) => {
    try {
      const password =
        typeof req.query?.password === 'string' ? (req.query.password as string) : undefined;
      const resolved = await service.resolveToken(req.params.token, { providedPassword: password });
      if (!resolved) {
        sendError(res, 404, 'NOT_FOUND', 'Share link not found');
        return;
      }
      if (resolved.link.object_name !== 'ai_conversations') {
        sendError(res, 400, 'UNSUPPORTED', 'This share link does not expose messages');
        return;
      }
      const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;
      const rows = await engine.find('ai_messages', {
        where: { conversation_id: resolved.link.record_id },
        orderBy: [{ field: 'created_at', order: 'asc' }],
        limit: 500,
        context: SYSTEM_CTX,
      } as any);
      // Already had a `data` key, but no `success` flag — so `unwrapResponse`
      // returned the WRAPPER `{ data: rows }` rather than `rows`. Adding the flag
      // is what makes the same read (`body.data`) work through the SDK too.
      sendOk(res, rows ?? []);
    } catch (err: any) {
      sendError(
        res,
        err?.status ?? 500,
        err?.code ?? 'INTERNAL',
        err?.message ?? 'Failed to load messages',
      );
    }
  }) satisfies RouteHandler);
}
