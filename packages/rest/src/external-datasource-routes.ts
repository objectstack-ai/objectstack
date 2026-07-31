// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import type { IHttpServer } from '@objectstack/spec/contracts';
// The declared envelope is written in ONE place for the whole platform (#3973).
import { sendOk, sendError } from '@objectstack/types';

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
 *
 * Note `POST /validate` keeps its `ok` — unlike the `{ ok: true, key }` #3689
 * retired from storage, that one was a private second word for `success`, while
 * this `ok` is a COMPUTED verdict over the federated objects
 * (`results.every(r => r.ok)`). A domain verdict that happens to share the name
 * is not a second envelope flag, so it belongs inside `data` rather than being
 * dropped.
 */
export function registerExternalDatasourceRoutes(
  server: IHttpServer,
  ctx: PluginContext,
  basePath = '/api/v1',
): void {
  const ext = `${basePath}/datasources/:name/external`;

  const externalService = (): any => {
    try {
      return ctx.getService<any>('external-datasource');
    } catch {
      return undefined;
    }
  };

  const unavailable = (res: any) =>
    sendError(res, 503, 'SERVICE_UNAVAILABLE', 'The external-datasource service is not available.');

  /** An introspection refusal — same code as the admin-routes path (#4249). */
  const introspectionRefused = (res: any, err: unknown) =>
    sendError(res, 400, 'EXTERNAL_DATASOURCE_ERROR', err instanceof Error ? err.message : String(err));

  // List remote tables (optionally filtered by ?schema=).
  server.get(`${ext}/tables`, async (req: any, res: any) => {
    const svc = externalService();
    if (!svc?.listRemoteTables) return unavailable(res);
    try {
      const schema = typeof req.query?.schema === 'string' ? req.query.schema : undefined;
      const tables = await svc.listRemoteTables(req.params.name, { schema });
      sendOk(res, { tables });
    } catch (err) {
      introspectionRefused(res, err);
    }
  });

  // Generate an Object draft (structured + *.object.ts source) from a table.
  server.post(`${ext}/tables/:remote/draft`, async (req: any, res: any) => {
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
      introspectionRefused(res, err);
    }
  });

  // Import a remote table as a live (runtime-origin) federated object so it's
  // immediately queryable — the "Import as Object" action (ADR-0015 Addendum).
  // 503 when the service is absent; 400 when import is refused (e.g. read-only
  // metadata store) or the remote table is missing.
  server.post(`${ext}/tables/:remote/import`, async (req: any, res: any) => {
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
  });

  // Refresh and return the cached catalog snapshot.
  server.post(`${ext}/refresh-catalog`, async (req: any, res: any) => {
    const svc = externalService();
    if (!svc?.refreshCatalog) return unavailable(res);
    const catalog = await svc.refreshCatalog(req.params.name);
    sendOk(res, { catalog });
  });

  // Validate the federated objects on this datasource.
  server.post(`${ext}/validate`, async (req: any, res: any) => {
    const svc = externalService();
    if (!svc?.validateAll) return unavailable(res);
    const report = await svc.validateAll();
    const results = (report.results ?? []).filter((r: any) => r.datasource === req.params.name);
    sendOk(res, { ok: results.every((r: any) => r.ok), results });
  });
}
