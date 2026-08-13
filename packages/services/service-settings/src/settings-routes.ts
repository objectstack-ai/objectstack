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

import type { IHttpServer, IHttpRequest, RouteHandler } from '@objectstack/spec/contracts';
// The declared envelope is written in ONE place for the whole platform (#3973).
// Its `extra` is `ApiError`'s own optional fields, so the undeclared siblings
// #4224 retired from this module cannot come back through it either.
import { sendOk, sendError } from '@objectstack/types';
import { SettingsService } from './settings-service.js';
// #7522 — the REST boundary is where an encrypted setting stops being cleartext.
// The service decrypts on purpose (in-process plugins need the real secret);
// nothing that leaves over HTTP may carry it. See the module header for the
// mask shape and why it mirrors ADR-0100's encrypted-field convention.
import { dropEchoedSecretMasks, redactSecretValues } from './settings-secret-redaction.js';
import {
  SettingsCryptoUnavailableError,
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
        sendError(res, 403, 'SETTINGS_FORBIDDEN', err.message, { details: { namespace: err.namespace } });
      } else {
        sendError(res, 500, 'INTERNAL_ERROR', err?.message ?? 'Failed to list manifests');
      }
    }
  }) satisfies RouteHandler);

  http.get(`${base}/:namespace`, (async (req, res) => {
    const ns = req.params.namespace;
    try {
      const ctx = await ctxOf(req);
      const payload = await service.getNamespace(ns, ctx);
      // #7522 — redact BEFORE the payload leaves the process. `values.<key>.value`
      // and every `cascadeChain` entry of a secret-backed key are masked;
      // `source`, `locked` and `lockedReason` are untouched, so the console's
      // "configured" state and the env-lock affordances read the same as before.
      sendOk(res, { ...payload, values: redactSecretValues(payload.values, service.secretKeysOf(ns)) });
    } catch (err: any) {
      if (err instanceof SettingsForbiddenError) {
        sendError(res, 403, 'SETTINGS_FORBIDDEN', err.message, { details: { namespace: err.namespace } });
      } else if (err instanceof UnknownNamespaceError) {
        sendError(res, 404, 'UNKNOWN_NAMESPACE', err.message);
      } else {
        sendError(res, 500, 'INTERNAL_ERROR', err?.message ?? 'Failed to read namespace');
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
      // #7522 — the echoed-mask no-op. GET now answers a secret with the mask;
      // a form that submits back what it read means "unchanged", so the key is
      // dropped rather than persisted as the mask's literal text. Resolved here
      // (not in the service) for the same reason the redaction is: in-process
      // callers write real values and must keep doing so.
      //
      // `secretKeysOf` throws `UnknownNamespaceError` for an unregistered
      // namespace — the same 404 `setMany` would have raised one line later, in
      // the same order relative to the 403 authz check.
      const secretKeys = service.secretKeysOf(ns);
      const result = await service.setMany(ns, dropEchoedSecretMasks(body, secretKeys), ctx);
      // The write response carries resolved values too — including cascade
      // entries the caller never submitted (an upper-scope secret it may not
      // have set). Same boundary, same redaction.
      sendOk(res, { values: redactSecretValues(result, secretKeys) });
    } catch (err: any) {
      if (err instanceof SettingsForbiddenError) {
        sendError(res, 403, 'SETTINGS_FORBIDDEN', err.message, { details: { namespace: err.namespace } });
      } else if (err instanceof SettingsLockedError) {
        sendError(res, 409, 'SETTINGS_LOCKED', err.message, {
          details: { namespace: err.namespace, key: err.key, reason: err.reason },
        });
      } else if (err instanceof UnknownNamespaceError) {
        sendError(res, 404, 'UNKNOWN_NAMESPACE', err.message);
      } else if (err instanceof UnknownKeyError) {
        sendError(res, 400, 'UNKNOWN_KEY', err.message, {
          details: { namespace: err.namespace, key: err.key },
        });
      } else if (err instanceof SettingsValidationError) {
        // `details.fields` is `FieldError[]` (ADR-0114) — the same array shape
        // the record validators and the dispatcher's validation exit carry, so
        // the console's field-error extractor reads this one with no per-surface
        // special case. It is `details.fields` rather than a top-level
        // `error.fields` because `fields` is declared on
        // `EnhancedApiErrorSchema`, not on the base `ApiErrorSchema` these
        // routes emit; `validation-failure.ts` puts the array in the same place
        // for the same reason.
        sendError(res, 400, 'SETTINGS_VALIDATION', err.message, {
          details: { namespace: err.namespace, fields: err.fields },
        });
      } else if (err instanceof SettingsCryptoUnavailableError) {
        // #8273 — the fail-closed refusal (#8026) gets its wire spelling. The
        // status stays 500 on purpose: this is a server-side misconfiguration
        // (no confidential crypto wired), not the caller's fault, and not a
        // 503 — no retry succeeds until an operator wires a cryptoProvider, so
        // inviting one would be dishonest. The registered code is what lets the
        // Setup UI render "reconfigure the deployment" instead of "the server
        // crashed"; the message carries the operator's fix.
        sendError(res, 500, 'SETTINGS_CRYPTO_UNAVAILABLE', err.message, {
          details: { namespace: err.namespace, key: err.key },
        });
      } else {
        sendError(res, 500, 'INTERNAL_ERROR', err?.message ?? 'Failed to write namespace');
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
        sendError(res, 403, 'SETTINGS_FORBIDDEN', err.message, { details: { namespace: err.namespace } });
      } else if (err instanceof UnknownNamespaceError) {
        sendError(res, 404, 'UNKNOWN_NAMESPACE', err.message);
      } else {
        sendError(res, 500, 'INTERNAL_ERROR', err?.message ?? 'Action failed');
      }
    }
  }) satisfies RouteHandler);
}
