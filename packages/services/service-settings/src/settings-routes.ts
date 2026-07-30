// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * REST surface for the SettingsService — see ADR-0007 §REST.
 *
 *   GET    /api/settings                       → visible manifests
 *   GET    /api/settings/:namespace            → { manifest, values }
 *   PUT    /api/settings/:namespace            → batch upsert
 *   POST   /api/settings/:namespace/:actionId  → invoke declared action
 *
 * The route layer is a thin wrapper that maps thrown service errors
 * into proper HTTP status codes; all business logic lives in
 * `SettingsService`.
 */

import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { SettingsService } from './settings-service.js';
import {
  SettingsForbiddenError,
  SettingsLockedError,
  SettingsValidationError,
  UnknownKeyError,
  UnknownNamespaceError,
  type SettingsContext,
} from './settings-service.types.js';

export interface SettingsRoutesOptions {
  /** Base path. Default `/api/settings`. */
  basePath?: string;
  /**
   * Derive the VERIFIED caller identity from the request. Production wiring
   * (`SettingsServicePlugin`) passes a resolver backed by the platform's
   * verified session / API-key / OAuth resolution (`resolveAuthzContext`), so
   * `permissions` reflect real capabilities and are never spoofable.
   *
   * [Finding-1] The default is SECURE: it trusts NO identity header and yields
   * an anonymous, `enforced` context (deny protected reads + all writes). The
   * old default trusted `x-user-id` / `x-permissions` headers, which let an
   * unauthenticated client forge any identity and write platform settings.
   */
  contextFromRequest?: (req: IHttpRequest) => SettingsContext | Promise<SettingsContext>;
}

// [Finding-1] Secure default: anonymous + enforced. No identity is read from
// request headers — a deployment that wants authenticated settings access must
// wire a verified `contextFromRequest` (the plugin does).
const defaultContext = (_req: IHttpRequest): SettingsContext => ({ enforced: true });

/**
 * Emit an error in the DECLARED envelope — `BaseResponseSchema` +
 * `ApiErrorSchema` (`packages/spec/src/api/contract.zod.ts`), i.e.
 * `{ success: false, error: { code, message } }`.
 *
 * This module was already half-right before #3843: `error` was correctly a
 * nested `{ code, message }` object, but no body carried the `success` flag the
 * envelope declares — so `BaseResponseSchema.safeParse` failed on every
 * response, success and error alike, and a caller keying on `success` (as
 * `ObjectStackClient.unwrapResponse` does) could not tell these routes' bodies
 * apart from an already-unwrapped payload.
 */
function sendError(res: IHttpResponse, status: number, code: string, message: string, extra?: Record<string, unknown>) {
  res.status(status).json({ success: false, error: { code, message, ...extra } });
}

/**
 * Emit a success body in the DECLARED envelope — `{ success: true, data }`.
 *
 * The three success bodies keep their payload keys, one level deeper:
 * `{ manifests }` → `{ success: true, data: { manifests } }`. The
 * `GET /:namespace` payload is `SettingsNamespacePayloadSchema`
 * (`{ manifest, values }`) and moves under `data` whole, so that schema still
 * describes exactly what the route returns — now as the envelope's `data`
 * rather than as the entire body.
 */
function sendOk(res: IHttpResponse, data: unknown, status = 200) {
  res.status(status).json({ success: true, data });
}

export function registerSettingsRoutes(
  http: IHttpServer,
  service: SettingsService,
  opts: SettingsRoutesOptions = {},
): void {
  const base = opts.basePath ?? '/api/settings';
  const ctxOf = opts.contextFromRequest ?? defaultContext;

  http.get(base, (async (req, res) => {
    try {
      const ctx = await ctxOf(req);
      const manifests = service.listManifests(ctx);
      sendOk(res, { manifests });
    } catch (err: any) {
      if (err instanceof SettingsForbiddenError) {
        sendError(res, 403, 'SETTINGS_FORBIDDEN', err.message, { namespace: err.namespace });
      } else {
        sendError(res, 500, 'INTERNAL', err?.message ?? 'Failed to list manifests');
      }
    }
  }) satisfies RouteHandler);

  http.get(`${base}/:namespace`, (async (req, res) => {
    const ns = req.params.namespace;
    try {
      const ctx = await ctxOf(req);
      const payload = await service.getNamespace(ns, ctx);
      sendOk(res, payload);
    } catch (err: any) {
      if (err instanceof SettingsForbiddenError) {
        sendError(res, 403, 'SETTINGS_FORBIDDEN', err.message, { namespace: err.namespace });
      } else if (err instanceof UnknownNamespaceError) {
        sendError(res, 404, 'UNKNOWN_NAMESPACE', err.message);
      } else {
        sendError(res, 500, 'INTERNAL', err?.message ?? 'Failed to read namespace');
      }
    }
  }) satisfies RouteHandler);

  http.put(`${base}/:namespace`, (async (req, res) => {
    const ns = req.params.namespace;
    let body = (req.body ?? {}) as Record<string, unknown>;
    // DX symmetry: GET returns `{ values: { key: { value, source, … } } }`.
    // Accept that same envelope on PUT (sole top-level `values` object) so a
    // caller can write back exactly what it read instead of tripping a
    // confusing UNKNOWN_KEY('values'). Per-key, unwrap the read-shape
    // `{ value, … }` wrapper to the bare value; flat `{ key: value }` bodies
    // (and a manifest that genuinely declares a `values` key alongside others)
    // are untouched.
    if (
      Object.keys(body).length === 1 &&
      body.values && typeof body.values === 'object' && !Array.isArray(body.values)
    ) {
      const inner = body.values as Record<string, unknown>;
      body = Object.fromEntries(
        Object.entries(inner).map(([k, v]) =>
          v && typeof v === 'object' && !Array.isArray(v) && 'value' in (v as object)
            ? [k, (v as { value: unknown }).value]
            : [k, v],
        ),
      );
    }
    try {
      const ctx = await ctxOf(req);
      const result = await service.setMany(ns, body, ctx);
      sendOk(res, { values: result });
    } catch (err: any) {
      if (err instanceof SettingsForbiddenError) {
        sendError(res, 403, 'SETTINGS_FORBIDDEN', err.message, { namespace: err.namespace });
      } else if (err instanceof SettingsLockedError) {
        sendError(res, 409, 'SETTINGS_LOCKED', err.message, {
          namespace: err.namespace,
          key: err.key,
          reason: err.reason,
        });
      } else if (err instanceof UnknownNamespaceError) {
        sendError(res, 404, 'UNKNOWN_NAMESPACE', err.message);
      } else if (err instanceof UnknownKeyError) {
        sendError(res, 400, 'UNKNOWN_KEY', err.message, { namespace: err.namespace, key: err.key });
      } else if (err instanceof SettingsValidationError) {
        sendError(res, 400, 'SETTINGS_VALIDATION', err.message, {
          namespace: err.namespace,
          fields: err.fields,
        });
      } else {
        sendError(res, 500, 'INTERNAL', err?.message ?? 'Failed to write namespace');
      }
    }
  }) satisfies RouteHandler);

  http.post(`${base}/:namespace/:actionId`, (async (req, res) => {
    const { namespace, actionId } = req.params;
    try {
      const ctx = await ctxOf(req);
      const result = await service.runAction(namespace, actionId, req.body, ctx);
      // The 200/400 split is PRE-EXISTING and preserved verbatim: an action
      // that ran and reported `ok: false` is still answered 400. Whether a
      // reported (as opposed to crashed) failure ought to be a 200 carrying the
      // verdict is #3913's question about actions generally, not this
      // envelope's — so only the body shape changes here.
      //
      // On the failure arm the whole `SettingsActionResult` is kept under
      // `error.details`, so the renderer's `message` / `severity` / `details`
      // all survive while `body.error.message` reads where the envelope says it
      // should for a 4xx.
      if (result.ok) {
        sendOk(res, result);
      } else {
        sendError(res, 400, 'SETTINGS_ACTION_FAILED', result.message ?? 'Action reported failure', {
          details: result,
        });
      }
    } catch (err: any) {
      if (err instanceof SettingsForbiddenError) {
        sendError(res, 403, 'SETTINGS_FORBIDDEN', err.message, { namespace: err.namespace });
      } else if (err instanceof UnknownNamespaceError) {
        sendError(res, 404, 'UNKNOWN_NAMESPACE', err.message);
      } else {
        sendError(res, 500, 'INTERNAL', err?.message ?? 'Action failed');
      }
    }
  }) satisfies RouteHandler);
}
