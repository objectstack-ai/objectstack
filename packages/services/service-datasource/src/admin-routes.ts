// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import type { ErrorCode } from '@objectstack/spec/api';
import type { IHttpServer } from '@objectstack/spec/contracts';
// The declared envelope is written in ONE place for the whole platform (#3973).
import { sendOk, sendError } from '@objectstack/types';
import { DRIVER_CATALOG } from './driver-catalog.js';

/**
 * The services these routes dispatch to.
 *
 * Two, not one — which is the whole reason the 503 below is parameterised. The
 * module is *named* after `datasource-admin` and most of it is served by that
 * service, but the three schema-introspection routes are served by
 * `external-datasource`.
 */
type ServiceName = 'datasource-admin' | 'external-datasource';

/**
 * The 400 `error.code` a refusal from each service carries. Both codes are
 * registered in the error-code ledger (ADR-0112 D3,
 * `packages/spec/src/api/error-code-ledger.zod.ts`) under this package.
 *
 * Keyed by `ServiceName` for the same reason `resolve` below takes one (#4225):
 * the code is an attribution — the ledger reads `DATASOURCE_ADMIN_ERROR` as "a
 * refusal from the datasource-admin service" — so it must come from the service
 * the route dispatches to. It did not until #4249: `badRequest` hard-coded
 * `DATASOURCE_ADMIN_ERROR`, so a `no such schema` raised by the
 * external-datasource introspector was reported, machine-readably this time, as
 * a lifecycle refusal from datasource-admin — the same mis-attribution #4225
 * fixed in the 503 `message`, one field over.
 */
const SERVICE_ERROR_CODE: Record<ServiceName, ErrorCode> = {
  'datasource-admin': 'DATASOURCE_ADMIN_ERROR',
  'external-datasource': 'EXTERNAL_DATASOURCE_ERROR',
};

/**
 * Datasource lifecycle REST routes (ADR-0015 Addendum §3.5).
 *
 * Mounted under `/api/v1/datasources`. Every route degrades gracefully
 * (`503 SERVICE_UNAVAILABLE`) when the service *it* needs is not wired in —
 * naming that service rather than the one this module is named after (#4225) —
 * and refusals surface as `400` with the service's message, under the
 * `error.code` registered for the service that refused (#4249):
 * `DATASOURCE_ADMIN_ERROR` or `EXTERNAL_DATASOURCE_ERROR`.
 *
 * Served by `datasource-admin`:
 *
 *   GET    /datasources              → listDatasources (provenance + health)
 *   GET    /datasources/:name        → getDatasource (config credential-redacted)
 *   POST   /datasources/test         → testConnection (no persistence)
 *   POST   /datasources              → createDatasource (origin: 'runtime')
 *   PATCH  /datasources/:name        → updateDatasource (runtime only)
 *   DELETE /datasources/:name        → removeDatasource (runtime only)
 *   POST   /datasources/:name/migrate-credential
 *                                    → migrateCredential (runtime only, #8155)
 *
 * Served by `external-datasource`:
 *
 *   GET    /datasources/:name/remote-tables → listRemoteTables (?schema= filters)
 *   POST   /datasources/:name/test          → testConnection (a SAVED datasource)
 *   POST   /datasources/:name/object-draft  → generateObjectDraft
 *
 * `GET /datasources/drivers` is static metadata and needs neither service.
 *
 * Request bodies carry the connection draft inline with an optional cleartext
 * `secret` field; the route splits `secret` out so it never reaches the draft
 * the service persists.
 *
 * Every body — both halves — is built by the shared `sendOk` / `sendError`, in
 * the envelope `BaseResponseSchema` declares (#3843, consolidated in #3973).
 *
 * ## What this module emitted before #3843
 *
 * `{ error: '<string>' }` — the shape #3675 had already declared wrong for
 * `service-storage`, with `message` a SIBLING of `error` rather than a field
 * of it:
 *
 *     res.status(400).json({ error: 'datasource_admin_error', message });
 *
 * so a caller reading `body.error.message` got `undefined` here and the real
 * message from the dispatcher — the identical asymmetry #3675 opened on, one
 * layer over. `ObjectStackClient` sniffs several shapes to paper over the
 * difference; that shim is the consumer-side symptom Prime Directive #12 says
 * to cure at the producer.
 *
 * The codes follow ADR-0112, which #3841 settled while #3843 was in review:
 * `error.code` is SCREAMING_SNAKE and `ApiErrorSchema.code` is the closed
 * `ErrorCode` union — which is now also `sendError`'s parameter type, so an
 * unregistered code fails to COMPILE rather than failing a schema parse at
 * runtime (#3973). The old lowercase trio was re-spelled accordingly, and the
 * generic conditions went to the STANDARD catalog rather than becoming
 * registered synonyms of it:
 *
 *   datasource_admin_unavailable → SERVICE_UNAVAILABLE   (standard)
 *   not_found                    → RESOURCE_NOT_FOUND    (standard)
 *   datasource_admin_error       → DATASOURCE_ADMIN_ERROR (registered — a
 *                                  lifecycle/validation refusal specific to
 *                                  this service, so not a standard synonym)
 *
 * #4249 then split the third row in two: `DATASOURCE_ADMIN_ERROR` had been
 * carried verbatim onto the three routes served by `external-datasource`,
 * whose refusals are now the separately registered `EXTERNAL_DATASOURCE_ERROR`
 * — see `SERVICE_ERROR_CODE` above.
 *
 * Which service is unavailable is carried by `message`; the ledger explicitly
 * asks generic conditions to reuse the catalog instead of registering a
 * per-service 503. That puts the whole burden of naming the service on one
 * string — see `resolve` below for how it is kept honest (#4225).
 */
export function registerDatasourceAdminRoutes(
  server: IHttpServer,
  ctx: PluginContext,
  basePath = '/api/v1',
): void {
  const root = `${basePath}/datasources`;

  /**
   * Resolve the service a route dispatches to — or answer
   * `503 SERVICE_UNAVAILABLE` naming THAT service and return `undefined`, which
   * the caller returns on.
   *
   * The name that performs the lookup is the same one that writes the message,
   * so the two cannot disagree. They did until #4225: a single `unavailable`
   * helper hard-coded `datasource-admin` while three routes — `GET
   * /:name/remote-tables`, `POST /:name/test`, `POST /:name/object-draft` —
   * resolve `external-datasource`. An operator whose federation service was
   * unwired got told to go look at `datasource-admin`, which was running fine.
   * Passing the name to the helper instead would have fixed those three; taking
   * it from the lookup is what stops a tenth route reintroducing the mismatch.
   *
   * `method` is the one call the route goes on to make. It is checked here
   * because "the service is registered" and "this route can use it" are not the
   * same fact — a host may wire a partial implementation — and this preserves
   * the per-route capability check the call sites did before.
   */
  const resolve = (res: any, service: ServiceName, method: string): any => {
    let svc: any;
    try {
      svc = ctx.getService<any>(service);
    } catch {
      svc = undefined;
    }
    if (!svc?.[method]) {
      sendError(res, 503, 'SERVICE_UNAVAILABLE', `The ${service} service is not available.`);
      return undefined;
    }
    return svc;
  };

  /**
   * Answer a refusal as `400`, with the code registered for the service the
   * route dispatches to (`SERVICE_ERROR_CODE`) and the service's own message.
   * `service` is the same name the route passed to `resolve` — restating it is
   * what keeps the attribution honest per route (#4249).
   *
   * [#6504] One exception, and it is a relay rather than a new decision: a
   * service that threw an error already carrying the `503`/`SERVICE_UNAVAILABLE`
   * envelope has classified its own refusal as a DEPENDENCY OUTAGE, and 400
   * would tell the caller its request was malformed — the opposite of the
   * truth, and the opposite of "retry this". The only thrower today is
   * `removeDatasource` refusing to delete on a bound-object count it could not
   * take completely. Read off the error rather than special-cased per route, so
   * the next refusal of this class needs no second edit here; both fields are
   * required so an unrelated error carrying a stray `status` cannot re-route
   * itself. `sendError`'s parameter type is the closed `ErrorCode` union, so
   * the code below is checked at compile time rather than trusted from the
   * throw site.
   */
  const badRequest = (res: any, service: ServiceName, err: unknown) => {
    const envelope = err as { code?: unknown; status?: unknown } | null | undefined;
    if (envelope?.status === 503 && envelope?.code === 'SERVICE_UNAVAILABLE') {
      return sendError(res, 503, 'SERVICE_UNAVAILABLE', (err as Error).message);
    }
    return sendError(res, 400, SERVICE_ERROR_CODE[service], err instanceof Error ? err.message : String(err));
  };

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

  // List all datasources with provenance + health. The catch was missing
  // until #4264 — the one route in this module without one, so a backing-store
  // failure surfaced as the adapter's non-envelope 500 instead of the 400 its
  // eight siblings answer.
  server.get(root, async (_req: any, res: any) => {
    const svc = resolve(res, 'datasource-admin', 'listDatasources');
    if (!svc) return;
    try {
      const datasources = await svc.listDatasources();
      sendOk(res, { datasources });
    } catch (err) {
      badRequest(res, 'datasource-admin', err);
    }
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
  //
  // `?schema=` narrows the listing to one remote schema, and is forwarded here
  // for the same reason #4249 gave the two spellings one FAILURE contract: they
  // are one operation — `IExternalDatasourceService.listRemoteTables`, resolved
  // from the same `external-datasource` slot — reached two ways. Until #7955
  // this handler never read the query, so `?schema=public` came back UNFILTERED:
  // neither the filtered answer nor a refusal, which is the "declared ≠
  // enforced" shape (Prime Directive #10) in its quietest form — the twin one
  // path over honoured the same parameter. The coercion below is copied from
  // that twin (`packages/rest/src/external-datasource-routes.ts`) deliberately,
  // down to what it does with a NON-string: a repeated `?schema=a&schema=b`
  // reaches the handler as an array (the adapter surfaces repeated keys that
  // way), and both spellings drop it to `undefined` — no filter. Whether an
  // unusable query parameter should instead be REFUSED is the ingress-policy
  // question #7606 owns globally; honouring it is correct under either answer,
  // so this route does not pre-empt it.
  server.get(`${root}/:name/remote-tables`, async (req: any, res: any) => {
    const svc = resolve(res, 'external-datasource', 'listRemoteTables');
    if (!svc) return;
    try {
      const schema = typeof req.query?.schema === 'string' ? req.query.schema : undefined;
      const tables = await svc.listRemoteTables(req.params.name, { schema });
      sendOk(res, { tables });
    } catch (err) {
      badRequest(res, 'external-datasource', err);
    }
  });

  // Test a *saved* datasource by name with a live round-trip (backs the
  // `datasource` `test_connection` action). Distinct from `POST /datasources/test`
  // which probes an unsaved draft carried inline. Registered before the generic
  // `:name` mutation routes.
  // Read one datasource's full detail for the edit form. `config` is redacted
  // of every stored credential — including one embedded in a connection URL —
  // and the response names what was withheld in `redactedConfigKeys`, alongside
  // the `hasSecret` flag for the bound `sys_secret` handle (#8081). Registered
  // after the static `/drivers` route so that literal segment is never captured
  // as a name.
  server.get(`${root}/:name`, async (req: any, res: any) => {
    const svc = resolve(res, 'datasource-admin', 'getDatasource');
    if (!svc) return;
    try {
      const datasource = await svc.getDatasource(req.params.name);
      if (!datasource) return sendError(res, 404, 'RESOURCE_NOT_FOUND', `Datasource "${req.params.name}" does not exist.`);
      sendOk(res, { datasource });
    } catch (err) {
      badRequest(res, 'datasource-admin', err);
    }
  });

  server.post(`${root}/:name/test`, async (req: any, res: any) => {
    const svc = resolve(res, 'external-datasource', 'testConnection');
    if (!svc) return;
    try {
      const result = await svc.testConnection(req.params.name);
      sendOk(res, result);
    } catch (err) {
      badRequest(res, 'external-datasource', err);
    }
  });

  // Re-home a SAVED datasource's stored cleartext credential into the secret
  // store (#8155) — the target of the declared `migrate_credential` metadata
  // -type action, and the only door this migration has. Operator-initiated and
  // per-datasource by construction: there is no batch spelling of this route.
  //
  // A row this action cannot re-home safely comes back `200` with
  // `status: 'refused'` and a `reason`/`remedy` pair, NOT a `400`: the datasource
  // is intact and still working, the operator asked a question and got an
  // answer, and nothing about the request was wrong. A 400 here would read as
  // "your call was malformed" for the one outcome the card requires be stated
  // plainly. Genuine refusals — an unknown name, a throwing store — still take
  // the `badRequest` arm below.
  server.post(`${root}/:name/migrate-credential`, async (req: any, res: any) => {
    const svc = resolve(res, 'datasource-admin', 'migrateCredential');
    if (!svc) return;
    try {
      const result = await svc.migrateCredential(req.params.name);
      sendOk(res, { result });
    } catch (err) {
      badRequest(res, 'datasource-admin', err);
    }
  });

  server.post(`${root}/:name/object-draft`, async (req: any, res: any) => {
    const svc = resolve(res, 'external-datasource', 'generateObjectDraft');
    if (!svc) return;
    const { table, ...opts } = (req.body as Record<string, unknown>) ?? {};
    if (!table) return badRequest(res, 'external-datasource', new Error('Body field "table" is required.'));
    try {
      const draft = await svc.generateObjectDraft(req.params.name, String(table), opts);
      sendOk(res, { draft });
    } catch (err) {
      badRequest(res, 'external-datasource', err);
    }
  });

  // Probe a connection without persisting anything. Registered before the
  // `:name` routes so the literal `test` segment is never captured as a name.
  server.post(`${root}/test`, async (req: any, res: any) => {
    const svc = resolve(res, 'datasource-admin', 'testConnection');
    if (!svc) return;
    const { draft, secret } = splitSecret(req.body);
    try {
      const result = await svc.testConnection(draft, secret);
      sendOk(res, { result });
    } catch (err) {
      badRequest(res, 'datasource-admin', err);
    }
  });

  // Create a runtime datasource.
  server.post(root, async (req: any, res: any) => {
    const svc = resolve(res, 'datasource-admin', 'createDatasource');
    if (!svc) return;
    const { draft, secret } = splitSecret(req.body);
    try {
      const datasource = await svc.createDatasource(draft, secret);
      sendOk(res, { datasource }, 201);
    } catch (err) {
      badRequest(res, 'datasource-admin', err);
    }
  });

  // Patch a runtime datasource.
  server.patch(`${root}/:name`, async (req: any, res: any) => {
    const svc = resolve(res, 'datasource-admin', 'updateDatasource');
    if (!svc) return;
    const { draft, secret } = splitSecret(req.body);
    try {
      const datasource = await svc.updateDatasource(req.params.name, draft, secret);
      sendOk(res, { datasource });
    } catch (err) {
      badRequest(res, 'datasource-admin', err);
    }
  });

  // Remove a runtime datasource.
  server.delete(`${root}/:name`, async (req: any, res: any) => {
    const svc = resolve(res, 'datasource-admin', 'removeDatasource');
    if (!svc) return;
    try {
      await svc.removeDatasource(req.params.name);
      res.status(204).end();
    } catch (err) {
      badRequest(res, 'datasource-admin', err);
    }
  });
}
