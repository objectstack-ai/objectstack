// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// [#9686] The anonymous-deny floor: one DECISION function and one set of
// semantics (status / code / message) shared by every HTTP seam on the
// platform, so this family can never drift on who counts as anonymous.
import {
  shouldDenyAnonymous,
  ANONYMOUS_DENY_STATUS,
  ANONYMOUS_DENY_CODE,
  ANONYMOUS_DENY_MESSAGE,
  type PluginContext,
} from '@objectstack/core';
import type { IExternalDatasourceService, IHttpServer } from '@objectstack/spec/contracts';
// The declared envelope is written in ONE place for the whole platform (#3973).
import { sendOk, sendError } from '@objectstack/types';
import { mountDirectRoutes, type DirectMountedRoute } from './direct-mount.js';

/**
 * External Datasource Federation REST routes (ADR-0015 §6.2).
 *
 * Mounted under `/api/v1/datasources/:name/external/*` and served by the
 * `external-datasource` service. Every route degrades gracefully
 * (`503 SERVICE_UNAVAILABLE`) when federation is not wired into the
 * host, so the routes are safe to register unconditionally.
 *
 *   GET  /datasources/:name/external/tables             → listRemoteTables
 *   POST /datasources/:name/external/tables/:remote/draft → generateObjectDraft
 *   POST /datasources/:name/external/tables/:remote/import → importObject
 *   POST /datasources/:name/external/refresh-catalog    → refreshCatalog
 *   POST /datasources/:name/external/validate           → validateAll (this ds)
 *
 * NOTE: the datasource *lifecycle* routes (`/api/v1/datasources` —
 * list / test / create / update / remove, ADR-0015 Addendum) were extracted
 * into the private `@objectstack/datasource-admin` package, which registers
 * them via its own `registerDatasourceAdminRoutes`.
 *
 * Returns the routes it mounted so the caller can record them on the
 * `RestServer` that owns the surface (#5822): the returned array IS the array
 * that was iterated to mount. See `direct-mount.ts`.
 *
 * Every body is built by the shared `sendOk` / `sendError`, in the envelope
 * `BaseResponseSchema` declares (#3843, consolidated in #3973). Before #3843
 * this module emitted the pre-#3675 `{ error: '<string>' }`, with the message a
 * SIBLING of `error` on the import path — so a caller reading
 * `body.error.message` got `undefined`.
 *
 * Codes follow ADR-0112 (#3841, settled while #3843 was in review):
 * `external_service_unavailable` → the standard `SERVICE_UNAVAILABLE`, since the
 * ledger asks generic conditions to reuse the catalog rather than register a
 * per-service synonym; `external_import_error` → `EXTERNAL_IMPORT_ERROR`,
 * registered under this package because a refused federated import is specific
 * to it.
 *
 * `EXTERNAL_DATASOURCE_ERROR` (#4249) is the introspection twin: a refusal from
 * `listRemoteTables` / `generateObjectDraft`. Before #4249 those two routes had
 * no `catch` at all, so a `no such schema` surfaced as the adapter's
 * non-envelope `500 { error: 'No response from handler' }` — while the SAME two
 * service operations, reached through `service-datasource/admin-routes.ts`,
 * answered 400. One operation, one failure contract now, on both paths.
 * #4264 closed the same gap on the two routes #4249 left uncovered —
 * `refreshCatalog` / `validateAll` — whose throws (unknown datasource,
 * unreachable remote, metadata-store failure) took the same uncaught path to
 * that adapter 500. Every service call this module makes is now wrapped.
 *
 * Note `POST /validate` keeps its `ok` — unlike the `{ ok: true, key }` #3689
 * retired from storage, that one was a private second word for `success`, while
 * this `ok` is a COMPUTED verdict over the federated objects
 * (`results.every(r => r.ok)`). A domain verdict that happens to share the name
 * is not a second envelope flag, so it belongs inside `data` rather than being
 * dropped.
 */
export interface ExternalDatasourceRoutesOptions {
  /**
   * [#9686] Resolve the caller's execution context for a federation request.
   *
   * Wired by `direct-mount-composition.ts` to the `RestServer`'s own resolver —
   * the SAME identity resolution the `/meta` REST gate, the runtime dispatcher
   * and the sibling `registerPackageRoutes` gate read, so this family can never
   * admit a different set of callers than the rest of the surface. That
   * resolver admits every credential kind the platform admits (a better-auth
   * session AND a `sys_api_key`), which is what makes this a floor rather than
   * a second, narrower policy: reading only a session here would be cheaper and
   * wrong in the direction that matters, refusing an SDK caller holding a key
   * the platform accepts everywhere else.
   *
   * It is a RESOLVER, not a resolved context: the lookups behind it (auth
   * service, engine) happen per request, so a deployment whose auth plugin
   * registers after the REST plugin is not frozen into a boot-instant "no auth
   * service" snapshot that would refuse every authenticated caller.
   *
   * Absent ⇒ the gate FAILS CLOSED (401). `isSystem` is never resolved from
   * inbound HTTP.
   */
  resolveExecutionContext?: (req: any) => Promise<{
    userId?: string | null;
    isSystem?: boolean;
  } | undefined>;
}

export function registerExternalDatasourceRoutes(
  server: IHttpServer,
  ctx: PluginContext,
  basePath = '/api/v1',
  options: ExternalDatasourceRoutesOptions = {},
): readonly DirectMountedRoute[] {
  const ext = `${basePath}/datasources/:name/external`;

  /**
   * [#9686] The authentication floor for this whole family. Answers
   * `401 UNAUTHENTICATED` and returns `true` when the caller must be refused,
   * so every handler opens with `if (await refuseAnonymous(req, res)) return;`.
   *
   * ## Why this registrar needs its own line
   *
   * These five routes are mounted straight onto `IHttpServer` by
   * `direct-mount-composition.ts`, so they pass through none of the seams that
   * produce the platform's 401s: `RestServer.enforceAuth` is a private method
   * invoked inside that server's OWN handlers (it guards `/data`, `/meta`,
   * `/batch`, `/security/explain`), not middleware a direct mount is routed
   * through, and the dispatcher domains' floor runs inside the dispatcher.
   * Being composed by `RestServer` is not itself a guard. The sibling
   * direct-mount registrar in this package (`package-routes.ts`) reached the
   * same conclusion for the same reason, as did the datasource-admin family
   * one package over (`service-datasource/src/admin-routes.ts`, #9391) — whose
   * two `external-datasource` routes are the DECLARED TWINS of the first two
   * here (`remote-tables-twin.equivalence.test.ts`, #4249 / #7955). One
   * operation cannot answer 401 at one spelling and serve at the other.
   *
   * ## What is reused rather than restated
   *
   *  - the DECISION — `shouldDenyAnonymous` (`@objectstack/core`), the one
   *    function every HTTP seam shares. `isSystem` is not settable from the
   *    wire and a CORS `OPTIONS` preflight passes, both by its construction.
   *    No `path` is passed: the control-plane allowlist exists for `/auth`,
   *    `/health`, `/ready` and `/discovery`, and nothing here is one of those.
   *  - the IDENTITY — {@link ExternalDatasourceRoutesOptions.resolveExecutionContext},
   *    the `RestServer`'s own resolution, handed to this registrar by the same
   *    composition step that already hands it to `registerPackageRoutes`.
   *  - the ENVELOPE — the shared `sendError`, like every other body in this
   *    module (`check:route-envelope` pins it at zero hand-written bodies), so
   *    the status, code and message are the platform's while the wrapper is
   *    this surface's (ADR-0112's two live envelopes, read per the seam called).
   *
   * ## Fail closed, and why the check sits FIRST
   *
   * Anything that throws — synchronously or as a rejected promise — and
   * anything resolving to no identity is a refusal; there is no configuration,
   * posture or absent service that opens these routes. The check runs before
   * the `external-datasource` lookup so an anonymous caller cannot learn from a
   * `503` which services a deployment has wired, and — for the two routes that
   * write — so the refusal provably precedes the write rather than following it.
   *
   * Authentication and nothing more: whether these routes should FURTHER
   * require a capability is the separately-ruled question #9593 asks of the
   * admin family, and is deliberately absent here.
   */
  const refuseAnonymous = async (req: any, res: any): Promise<boolean> => {
    let authz: { userId?: string | null; isSystem?: boolean } | undefined;
    try {
      authz = await options.resolveExecutionContext?.(req);
    } catch {
      // An identity that could not be resolved is not an identity.
      authz = undefined;
    }
    if (shouldDenyAnonymous({ userId: authz?.userId, isSystem: authz?.isSystem, method: req?.method })) {
      sendError(res, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE);
      return true;
    }
    return false;
  };

  /**
   * The `external-datasource` slot's occupant (ADR-0015 §4.5).
   *
   * [#4251 B4] `IExternalDatasourceService`, which `ExternalDatasourceService`
   * declares `implements` — so the five method names and arities this module
   * probes are checked against the contract rather than asserted. Returns
   * `undefined` when federation is not wired into the host; every route below
   * answers 503 in that case, which is why the lookup is allowed to fail.
   */
  const externalService = (): IExternalDatasourceService | undefined => {
    try {
      return ctx.getService<IExternalDatasourceService>('external-datasource');
    } catch {
      return undefined;
    }
  };

  const unavailable = (res: any) =>
    sendError(res, 503, 'SERVICE_UNAVAILABLE', 'The external-datasource service is not available.');

  /**
   * A refusal from the external-datasource service — same code as the
   * admin-routes path (#4249). Named after the service, not one operation:
   * since #4264 every route here except the import (which has its own
   * registered code) answers its catch with this.
   */
  const refused = (res: any, err: unknown) =>
    sendError(res, 400, 'EXTERNAL_DATASOURCE_ERROR', err instanceof Error ? err.message : String(err));

  /**
   * ONE declaration of this registrar's surface (#5822): the array below is
   * what gets mounted on the host server AND what is handed back as the
   * description of what was mounted — no second table to keep in sync. See
   * `direct-mount.ts`.
   *
   * Note what this list does NOT claim: it says these five routes are MOUNTED,
   * which they unconditionally are (the plugin registers them whether or not
   * federation is wired in), never that the `external-datasource` service is
   * present. That verdict stays per-request, inside each handler, where it can
   * still answer 503 — the boot must not record it (AGENTS.md, "never record a
   * verdict the boot can still contradict").
   */
  const routes: readonly DirectMountedRoute[] = [
    // List remote tables (optionally filtered by ?schema=).
    {
      method: 'GET',
      path: `${ext}/tables`,
      metadata: { summary: 'List remote tables on an external datasource', tags: ['datasources'] },
      handler: async (req: any, res: any) => {
        if (await refuseAnonymous(req, res)) return;
        const svc = externalService();
        if (!svc?.listRemoteTables) return unavailable(res);
        try {
          const schema = typeof req.query?.schema === 'string' ? req.query.schema : undefined;
          const tables = await svc.listRemoteTables(req.params.name, { schema });
          sendOk(res, { tables });
        } catch (err) {
          refused(res, err);
        }
      },
    },

    // Generate an Object draft (structured + *.object.ts source) from a table.
    {
      method: 'POST',
      path: `${ext}/tables/:remote/draft`,
      metadata: { summary: 'Generate an Object draft from a remote table', tags: ['datasources'] },
      handler: async (req: any, res: any) => {
        if (await refuseAnonymous(req, res)) return;
        const svc = externalService();
        if (!svc?.generateObjectDraft) return unavailable(res);
        try {
          const draft = await svc.generateObjectDraft(
            req.params.name,
            req.params.remote,
            (req.body as Record<string, unknown>) ?? {},
          );
          sendOk(res, { draft });
        } catch (err) {
          refused(res, err);
        }
      },
    },

    // Import a remote table as a live (runtime-origin) federated object so it's
    // immediately queryable — the "Import as Object" action (ADR-0015 Addendum).
    // 503 when the service is absent; 400 when import is refused (e.g. read-only
    // metadata store) or the remote table is missing.
    {
      method: 'POST',
      path: `${ext}/tables/:remote/import`,
      metadata: { summary: 'Import a remote table as a federated object', tags: ['datasources'] },
      handler: async (req: any, res: any) => {
        if (await refuseAnonymous(req, res)) return;
        const svc = externalService();
        if (!svc?.importObject) return unavailable(res);
        try {
          const result = await svc.importObject(
            req.params.name,
            req.params.remote,
            (req.body as Record<string, unknown>) ?? {},
          );
          sendOk(res, { object: result }, 201);
        } catch (err) {
          sendError(
            res,
            400,
            'EXTERNAL_IMPORT_ERROR',
            err instanceof Error ? err.message : String(err),
          );
        }
      },
    },

    // Refresh and return the cached catalog snapshot.
    {
      method: 'POST',
      path: `${ext}/refresh-catalog`,
      metadata: { summary: 'Refresh the external datasource catalog snapshot', tags: ['datasources'] },
      handler: async (req: any, res: any) => {
        if (await refuseAnonymous(req, res)) return;
        const svc = externalService();
        if (!svc?.refreshCatalog) return unavailable(res);
        try {
          const catalog = await svc.refreshCatalog(req.params.name);
          sendOk(res, { catalog });
        } catch (err) {
          refused(res, err);
        }
      },
    },

    // Validate the federated objects on this datasource.
    {
      method: 'POST',
      path: `${ext}/validate`,
      metadata: { summary: 'Validate the federated objects on a datasource', tags: ['datasources'] },
      handler: async (req: any, res: any) => {
        if (await refuseAnonymous(req, res)) return;
        const svc = externalService();
        if (!svc?.validateAll) return unavailable(res);
        try {
          const report = await svc.validateAll();
          const results = (report.results ?? []).filter((r) => r.datasource === req.params.name);
          sendOk(res, { ok: results.every((r) => r.ok), results });
        } catch (err) {
          refused(res, err);
        }
      },
    },
  ];

  return mountDirectRoutes(server, routes);
}
