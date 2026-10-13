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
 *
 * Every route of the family is mounted through ONE door (`mountFamilyRoute`
 * inside {@link registerSettingsRoutes}), which resolves the caller, refuses an
 * anonymous one with the platform's shared `401 UNAUTHENTICATED` (ADR-0056 D2,
 * ADR-0138 D2), and only then hands the request to the route.
 */

import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
// [#15999] The BRAND predicate, never `instanceof` — this error crosses package
// boundaries and a monorepo resolves the same module through more than one path
// (`src` under vitest aliases, `dist` under the published `exports`), so two
// copies of the class make `instanceof` answer FALSE for a genuine instance.
// See `packages/core/src/security/authz-store-unavailable.ts`.
//
// ADR-0056 D2 — the anonymous floor is the platform's ONE shared decision and
// its ONE status / code / message, imported rather than restated, so this
// family cannot drift from the other HTTP seams on who is refused or how.
import {
  ANONYMOUS_DENY_CODE,
  ANONYMOUS_DENY_MESSAGE,
  ANONYMOUS_DENY_STATUS,
  isAuthzStoreUnavailableError,
  shouldDenyAnonymous,
} from '@objectstack/core';
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
   * an anonymous, `enforced` context, which the family's anonymous floor
   * refuses with `401` on every route. The old default trusted `x-user-id` /
   * `x-permissions` headers, which let an unauthenticated client forge any
   * identity and write platform settings.
   *
   * The resolved `userId` is what admits a caller past that floor (ADR-0056
   * D2): a context with no `userId` is anonymous, whatever else it carries.
   */
  contextFromRequest?: (req: IHttpRequest) => SettingsContext | Promise<SettingsContext>;
}

// [Finding-1] Secure default: anonymous + enforced. No identity is read from
// request headers — a deployment that wants authenticated settings access must
// wire a verified `contextFromRequest` (the plugin does).
const defaultContext = (_req: IHttpRequest): SettingsContext => ({ enforced: true });

/**
 * One route of the settings family, split at the seam the family door needs.
 *
 * - `serve` is the route's own work, handed the caller's resolved context. It
 *   runs only for a caller the anonymous floor admitted.
 * - `refuse` maps anything thrown — by the context resolver or by `serve` — to
 *   this route's envelope. It is the route's own `catch` arm, unchanged; the
 *   door calls it for every throw except an authorization-store outage, which
 *   the door relays itself ({@link relayAuthzStoreOutage}).
 */
interface SettingsFamilyRoute {
  serve(req: IHttpRequest, res: IHttpResponse, ctx: SettingsContext): Promise<void>;
  refuse(res: IHttpResponse, err: any): void;
}

/**
 * [#15999, ruling item 3] Relay an authorization-store OUTAGE as the envelope
 * it declares, instead of flattening it into this layer's untyped `500
 * INTERNAL_ERROR` tail.
 *
 * `SettingsServicePlugin`'s `verifiedContextFromRequest` already re-raises the
 * brand rather than returning an enforced-but-empty context the routes would
 * read as a denial (commit 6a180e42d). But it is called as `await ctxOf(req)` from INSIDE
 * a `try` in this layer (each route's own, until the family door took the call
 * over), so until #15999 the brand was caught here and re-encoded
 * — `message` survived, `code` and `status` did not, and those are the two a
 * client branches on. The declared `503` / `SERVICE_UNAVAILABLE` never reached
 * the caller.
 *
 * RELAYED rather than re-raised, deliberately. A bare re-raise escapes to the
 * transport, which today answers a bare `500 INTERNAL_ERROR "No response from
 * handler"` — losing the message too — and the shared render that would give an
 * escaped envelope its declared status does not exist yet (#16545). A relay
 * answers before the throw escapes, so it is correct today and stays correct
 * once #16545 lands (the shared render then only sees what no route relayed).
 * The same shape `badRequest` in `service-datasource`'s `admin-routes.ts` has
 * used for a service-thrown `503`/`SERVICE_UNAVAILABLE` since #6504.
 *
 * `status` / `code` are read OFF the error rather than written as digits: the
 * envelope answered is the one the producer declared.
 *
 * Written once and called once, from the family door's `catch` — the four
 * routes' catches were one decision reached four ways, and a copy per handler
 * is exactly how a family drifts apart on the arm that matters least often.
 *
 * ⛔ Scoped to the brand. Every other throw keeps its existing arm, including
 * the untyped `500` tail — widening this to "anything carrying a status" would
 * let an unrelated coded throw pick this layer's status.
 *
 * Returns `true` when the outage envelope was answered and the caller must
 * stop.
 */
function relayAuthzStoreOutage(res: IHttpResponse, err: unknown): boolean {
  if (!isAuthzStoreUnavailableError(err)) return false;
  sendError(res, err.status, err.code, err.message);
  return true;
}

export function registerSettingsRoutes(
  http: IHttpServer,
  service: SettingsService,
  opts: SettingsRoutesOptions = {},
): void {
  const base = opts.basePath ?? '/api/settings';
  const ctxOf = opts.contextFromRequest ?? defaultContext;

  /**
   * The family's ONE door — every route below is mounted through it, so the
   * anonymous floor is mounted once for the family rather than copied into
   * each handler. A route registered on `http` directly would skip it, which
   * is why the floor's pins enumerate the routes off the registration itself.
   *
   * In order, for every request:
   *
   *  1. Resolve the caller (`contextFromRequest`). This is identity resolution,
   *     not settings logic; an authorization-store outage it raises is relayed
   *     as its own `503` (#15999), and any other throw takes the route's own
   *     `refuse` arm exactly as it did before the door existed.
   *  2. ADR-0056 D2 / ADR-0138 D2: the shared `!userId && !isSystem → 401`
   *     decision, BEFORE any settings logic runs. An anonymous caller learns
   *     nothing about the family — not which namespaces exist (the `404` it
   *     used to get for an unknown one), not which are protected (the `403`),
   *     not that the index is empty (the `200`).
   *  3. The route's own work (`serve`), with that same context.
   *
   * `isSystem` is deliberately not read: `SettingsContext` carries no such
   * field and inbound HTTP never holds one, so the only way past the floor is a
   * resolved `userId`. The request PATH is not passed either: the family is
   * never a control-plane path, and passing it would let a `basePath` moved
   * under an allow-listed prefix inherit an exemption the family never declared.
   */
  const mountFamilyRoute = (verb: 'get' | 'put' | 'post', path: string, route: SettingsFamilyRoute): void => {
    http[verb](path, (async (req, res) => {
      try {
        const ctx = await ctxOf(req);
        if (shouldDenyAnonymous({ userId: ctx?.userId, method: req.method })) {
          sendError(res, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE);
          return;
        }
        await route.serve(req, res, ctx);
      } catch (err: any) {
        if (relayAuthzStoreOutage(res, err)) return;
        route.refuse(res, err);
      }
    }) satisfies RouteHandler);
  };

  mountFamilyRoute('get', base, {
    async serve(_req, res, ctx) {
      const manifests = service.listManifests(ctx);
      sendOk(res, { manifests });
    },
    refuse(res, err) {
      if (err instanceof SettingsForbiddenError) {
        sendError(res, 403, 'SETTINGS_FORBIDDEN', err.message, { details: { namespace: err.namespace } });
      } else {
        sendError(res, 500, 'INTERNAL_ERROR', err?.message ?? 'Failed to list manifests');
      }
    },
  });

  mountFamilyRoute('get', `${base}/:namespace`, {
    async serve(req, res, ctx) {
      const ns = req.params.namespace;
      const payload = await service.getNamespace(ns, ctx);
      // #7522 — redact BEFORE the payload leaves the process. `values.<key>.value`
      // and every `cascadeChain` entry of a secret-backed key are masked;
      // `source`, `locked` and `lockedReason` are untouched, so the console's
      // "configured" state and the env-lock affordances read the same as before.
      sendOk(res, { ...payload, values: redactSecretValues(payload.values, service.secretKeysOf(ns)) });
    },
    refuse(res, err) {
      if (err instanceof SettingsForbiddenError) {
        sendError(res, 403, 'SETTINGS_FORBIDDEN', err.message, { details: { namespace: err.namespace } });
      } else if (err instanceof UnknownNamespaceError) {
        sendError(res, 404, 'UNKNOWN_NAMESPACE', err.message);
      } else {
        sendError(res, 500, 'INTERNAL_ERROR', err?.message ?? 'Failed to read namespace');
      }
    },
  });

  mountFamilyRoute('put', `${base}/:namespace`, {
    async serve(req, res, ctx) {
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
    },
    refuse(res, err) {
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
    },
  });

  mountFamilyRoute('post', `${base}/:namespace/:actionId`, {
    async serve(req, res, ctx) {
      const { namespace, actionId } = req.params;
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
    },
    refuse(res, err) {
      if (err instanceof SettingsForbiddenError) {
        sendError(res, 403, 'SETTINGS_FORBIDDEN', err.message, { details: { namespace: err.namespace } });
      } else if (err instanceof UnknownNamespaceError) {
        sendError(res, 404, 'UNKNOWN_NAMESPACE', err.message);
      } else {
        sendError(res, 500, 'INTERNAL_ERROR', err?.message ?? 'Action failed');
      }
    },
  });
}
