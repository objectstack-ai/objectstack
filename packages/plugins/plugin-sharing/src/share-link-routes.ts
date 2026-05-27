// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * REST surface for ShareLinkService.
 *
 *   POST   /api/v1/share-links                 → create a link
 *   GET    /api/v1/share-links                 → list links (?object, ?recordId, ?includeRevoked)
 *   DELETE /api/v1/share-links/:idOrToken      → revoke
 *   GET    /api/v1/share-links/:token/resolve  → resolve token, returns { record, link, redactFields }
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

import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import type { ShareLinkExecutionContext } from '@objectstack/spec/contracts';
import type { ShareLinkService } from './share-link-service.js';
import type { SharingEngine } from './sharing-service.js';

const SYSTEM_CTX = { isSystem: true, roles: [], permissions: [] } as const;

export interface ShareLinkRoutesOptions {
  basePath?: string;
  /** Read caller identity for authenticated routes. */
  contextFromRequest?: (req: IHttpRequest) => ShareLinkExecutionContext;
}

const defaultContext = (req: IHttpRequest): ShareLinkExecutionContext => {
  const header = (name: string): string | undefined => {
    const v = req.headers?.[name];
    return Array.isArray(v) ? v[0] : v;
  };
  return {
    userId: header('x-user-id'),
    tenantId: header('x-tenant-id'),
  };
};

function sendError(res: IHttpResponse, status: number, code: string, message: string) {
  res.status(status).json({ error: { code, message } });
}

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
      const ctx = ctxOf(req);
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
      await res.status(201).json({ link });
    } catch (err: any) {
      sendError(res, err?.status ?? 500, err?.code ?? 'INTERNAL', err?.message ?? 'Failed to create link');
    }
  }) satisfies RouteHandler);

  // ── LIST ───────────────────────────────────────────────────────
  http.get(base, (async (req, res) => {
    try {
      const ctx = ctxOf(req);
      const q = req.query ?? {};
      const link = await service.listLinks(
        {
          object: typeof q.object === 'string' ? q.object : undefined,
          recordId: typeof q.recordId === 'string' ? q.recordId : undefined,
          createdBy: typeof q.createdBy === 'string' ? q.createdBy : undefined,
          includeRevoked: q.includeRevoked === 'true' || q.includeRevoked === '1',
        },
        ctx,
      );
      await res.json({ links: link });
    } catch (err: any) {
      sendError(res, err?.status ?? 500, err?.code ?? 'INTERNAL', err?.message ?? 'Failed to list links');
    }
  }) satisfies RouteHandler);

  // ── REVOKE ─────────────────────────────────────────────────────
  http.delete(`${base}/:idOrToken`, (async (req, res) => {
    try {
      const ctx = ctxOf(req);
      await service.revokeLink(req.params.idOrToken, ctx);
      await res.status(204).send('');
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
      const signedInUserId = (() => {
        const v = req.headers?.['x-user-id'];
        return Array.isArray(v) ? v[0] : v;
      })();
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

      await res.json({
        record: applyRedaction(record, resolved.redactFields),
        link: {
          id: resolved.link.id,
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
      const SYSTEM_CTX = { isSystem: true, roles: [], permissions: [] } as const;
      const rows = await engine.find('ai_messages', {
        where: { conversation_id: resolved.link.record_id },
        sort: [{ field: 'created_at', direction: 'asc' }],
        limit: 500,
        context: SYSTEM_CTX,
      } as any);
      res.status(200).json({ data: rows ?? [] });
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
