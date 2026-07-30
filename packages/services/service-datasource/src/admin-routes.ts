// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import type { IHttpServer } from '@objectstack/spec/contracts';
import { DRIVER_CATALOG } from './driver-catalog.js';

/**
 * Datasource lifecycle REST routes (ADR-0015 Addendum §3.5).
 *
 * Mounted under `/api/v1/datasources` and served by the `datasource-admin`
 * service. Every route degrades gracefully
 * (`503 datasource_admin_unavailable`) when the service is not wired in, and
 * lifecycle/validation failures surface as `400` with the service's message.
 *
 *   GET    /datasources              → listDatasources (provenance + health)
 *   POST   /datasources/test         → testConnection (no persistence)
 *   POST   /datasources              → createDatasource (origin: 'runtime')
 *   PATCH  /datasources/:name        → updateDatasource (runtime only)
 *   DELETE /datasources/:name        → removeDatasource (runtime only)
 *
 * Request bodies carry the connection draft inline with an optional cleartext
 * `secret` field; the route splits `secret` out so it never reaches the draft
 * the service persists.
 *
 * Every body — both halves — is built by `sendOk` / `sendError` below, in the
 * envelope `BaseResponseSchema` declares. See those two for what this module
 * emitted before #3843 and why it was the worse of the two drifting dialects.
 */
export function registerDatasourceAdminRoutes(
  server: IHttpServer,
  ctx: PluginContext,
  basePath = '/api/v1',
): void {
  const root = `${basePath}/datasources`;

  const adminService = (): any => {
    try {
      return ctx.getService<any>('datasource-admin');
    } catch {
      return undefined;
    }
  };

  const externalService = (): any => {
    try {
      return ctx.getService<any>('external-datasource');
    } catch {
      return undefined;
    }
  };

  /**
   * Emit an error in the DECLARED envelope — `BaseResponseSchema` +
   * `ApiErrorSchema` (`packages/spec/src/api/contract.zod.ts`), i.e.
   * `{ success: false, error: { code, message } }`.
   *
   * Before #3843 this module emitted `{ error: '<string>' }` — the shape #3675
   * had already declared wrong for `service-storage`, with `message` a SIBLING
   * of `error` rather than a field of it:
   *
   *     res.status(400).json({ error: 'datasource_admin_error', message });
   *
   * so a caller reading `body.error.message` got `undefined` here and the real
   * message from the dispatcher — the identical asymmetry #3675 opened on, one
   * layer over. `ObjectStackClient` sniffs several shapes to paper over the
   * difference; that shim is the consumer-side symptom Prime Directive #12 says
   * to cure at the producer.
   *
   * The `code` strings are carried over UNCHANGED (`datasource_admin_error`,
   * `not_found`, …) even though they are lowercase snake while
   * `storage-routes.ts` and `settings-routes.ts` emit SCREAMING_SNAKE. Which
   * vocabulary wins is #3841's call, and it is a decision about ~240 codes
   * repo-wide, not about these four; re-spelling them here would pick that
   * dialect by accident and make #3841's sweep harder to verify. This change is
   * the envelope only — the same split #3687 / #3837 made deliberately.
   */
  const sendError = (res: any, status: number, code: string, message: string) =>
    res.status(status).json({ success: false, error: { code, message } });

  /**
   * Emit a success body in the DECLARED envelope — `{ success: true, data }`.
   *
   * The payload keys are unchanged, just one level deeper: `{ datasources }`
   * becomes `{ success: true, data: { datasources } }`. `ObjectStackClient`
   * reads these through `unwrapResponse`, which returns `body.data` when the
   * flag is present, so the SDK's published return types describe the same
   * object they always did.
   */
  const sendOk = (res: any, data: unknown, status = 200) =>
    res.status(status).json({ success: true, data });

  const unavailable = (res: any) =>
    sendError(res, 503, 'datasource_admin_unavailable', 'The datasource-admin service is not available.');

  const badRequest = (res: any, err: unknown) =>
    sendError(res, 400, 'datasource_admin_error', err instanceof Error ? err.message : String(err));

  /** Split an inline `{ secret, ...draft }` body into (draft, secret). */
  const splitSecret = (body: any): { draft: any; secret: any } => {
    const { secret, ...draft } = (body as Record<string, unknown>) ?? {};
    // Accept either a bare string or a `{ value, namespace?, key? }` object.
    const normalised =
      secret == null
        ? undefined
        : typeof secret === 'string'
          ? { value: secret }
          : secret;
    return { draft, secret: normalised };
  };

  // List all datasources with provenance + health.
  server.get(root, async (_req: any, res: any) => {
    const svc = adminService();
    if (!svc?.listDatasources) return unavailable(res);
    const datasources = await svc.listDatasources();
    sendOk(res, { datasources });
  });

  // Catalog of connection drivers + their JSON-Schema config (drives the
  // Studio connection form). Static metadata — no service dependency, so it
  // is always available even before any datasource-admin service is wired.
  server.get(`${root}/drivers`, async (_req: any, res: any) => {
    sendOk(res, { drivers: DRIVER_CATALOG });
  });

  // Read-only schema introspection for the Studio "sync objects" flow.
  // `GET /datasources/:name/remote-tables` lists the datasource's remote tables;
  // `POST /datasources/:name/object-draft` generates an ObjectStack object
  // definition draft for one table (introspect + type-map, no persistence —
  // the caller creates the object through the normal metadata channel).
  server.get(`${root}/:name/remote-tables`, async (req: any, res: any) => {
    const svc = externalService();
    if (!svc?.listRemoteTables) return unavailable(res);
    try {
      const tables = await svc.listRemoteTables(req.params.name);
      sendOk(res, { tables });
    } catch (err) {
      badRequest(res, err);
    }
  });

  // Test a *saved* datasource by name with a live round-trip (backs the
  // `datasource` `test_connection` action). Distinct from `POST /datasources/test`
  // which probes an unsaved draft carried inline. Registered before the generic
  // `:name` mutation routes.
  // Read one datasource's full detail for the edit form (credential stripped;
  // `config` is non-sensitive, plus a `hasSecret` flag). Registered after the
  // static `/drivers` route so that literal segment is never captured as a name.
  server.get(`${root}/:name`, async (req: any, res: any) => {
    const svc = adminService();
    if (!svc?.getDatasource) return unavailable(res);
    try {
      const datasource = await svc.getDatasource(req.params.name);
      if (!datasource) return sendError(res, 404, 'not_found', `Datasource "${req.params.name}" does not exist.`);
      sendOk(res, { datasource });
    } catch (err) {
      badRequest(res, err);
    }
  });

  server.post(`${root}/:name/test`, async (req: any, res: any) => {
    const svc = externalService();
    if (!svc?.testConnection) return unavailable(res);
    try {
      const result = await svc.testConnection(req.params.name);
      sendOk(res, result);
    } catch (err) {
      badRequest(res, err);
    }
  });

  server.post(`${root}/:name/object-draft`, async (req: any, res: any) => {
    const svc = externalService();
    if (!svc?.generateObjectDraft) return unavailable(res);
    const { table, ...opts } = (req.body as Record<string, unknown>) ?? {};
    if (!table) return badRequest(res, new Error('Body field "table" is required.'));
    try {
      const draft = await svc.generateObjectDraft(req.params.name, String(table), opts);
      sendOk(res, { draft });
    } catch (err) {
      badRequest(res, err);
    }
  });

  // Probe a connection without persisting anything. Registered before the
  // `:name` routes so the literal `test` segment is never captured as a name.
  server.post(`${root}/test`, async (req: any, res: any) => {
    const svc = adminService();
    if (!svc?.testConnection) return unavailable(res);
    const { draft, secret } = splitSecret(req.body);
    try {
      const result = await svc.testConnection(draft, secret);
      sendOk(res, { result });
    } catch (err) {
      badRequest(res, err);
    }
  });

  // Create a runtime datasource.
  server.post(root, async (req: any, res: any) => {
    const svc = adminService();
    if (!svc?.createDatasource) return unavailable(res);
    const { draft, secret } = splitSecret(req.body);
    try {
      const datasource = await svc.createDatasource(draft, secret);
      sendOk(res, { datasource }, 201);
    } catch (err) {
      badRequest(res, err);
    }
  });

  // Patch a runtime datasource.
  server.patch(`${root}/:name`, async (req: any, res: any) => {
    const svc = adminService();
    if (!svc?.updateDatasource) return unavailable(res);
    const { draft, secret } = splitSecret(req.body);
    try {
      const datasource = await svc.updateDatasource(req.params.name, draft, secret);
      sendOk(res, { datasource });
    } catch (err) {
      badRequest(res, err);
    }
  });

  // Remove a runtime datasource.
  server.delete(`${root}/:name`, async (req: any, res: any) => {
    const svc = adminService();
    if (!svc?.removeDatasource) return unavailable(res);
    try {
      await svc.removeDatasource(req.params.name);
      res.status(204).end();
    } catch (err) {
      badRequest(res, err);
    }
  });
}
