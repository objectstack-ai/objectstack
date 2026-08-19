// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
// The authorization floor: the platform's ONE anonymous-deny decision plus the
// ONE identity-and-capability resolution every other HTTP seam reads. Both are
// imported rather than restated — see `requireDatasourceAdmin` below for why a
// local check would be the wrong shape even if it were written correctly.
import {
  resolveAuthzContext,
  shouldDenyAnonymous,
  ANONYMOUS_DENY_STATUS,
  ANONYMOUS_DENY_CODE,
  ANONYMOUS_DENY_MESSAGE,
} from '@objectstack/core';
import type { ErrorCode } from '@objectstack/spec/api';
// The slots this module resolves, by their declared contracts. Erasing a
// lookup to `any` is banned (#4127/#4176/#4202/#4251) and the ban is right
// here: `IAuthService` is what declares BOTH shapes of the session accessor
// (`api` and the lazy `getApi()`), so the two-step read below is a checked
// expression rather than a pair of guesses — the exact gap the rule's own
// message reports that erasure hiding, on the exact member this guard reads.
import type { IAuthService, IDataEngine, IHttpServer } from '@objectstack/spec/contracts';
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
 * ## Every route above requires the platform-settings capability (#9391, #9593)
 *
 * All eleven — reads, writes and the static catalog alike — answer `401`
 * `UNAUTHENTICATED` to a caller with no resolvable identity and `403`
 * `PERMISSION_DENIED` to a caller who resolves but holds no
 * `manage_platform_settings`, before any service is resolved and before any
 * handler body runs. See `requireDatasourceAdmin` inside the registrar for how
 * both decisions are reached, why they have to be made here rather than
 * inherited from a seam, and why the capability is neither minted nor split.
 *
 * The catalog route is included on purpose. It needs no service and reveals no
 * deployment data, but the family's own route ledger dispositions it
 * `server-only` — as it does every row here; the ledger's `public` disposition
 * exists and is used by nothing in this file — and a family whose floor has one
 * hole is a family whose floor has to be read route by route. Uniform is the
 * property worth having.
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
/**
 * Normalize the adapter's request headers to a Web `Headers`.
 *
 * `IHttpServer` hands handlers a plain `Record<string, string>` (the hono
 * adapter builds it from `c.req.header()`), while the session resolver behind
 * `resolveAuthzContext` is better-auth's, which reads a Web `Headers`. A
 * request whose headers are already a `Headers` is passed through untouched —
 * an adapter is free to hand over either.
 *
 * Returns `undefined` for a request carrying no readable headers at all. That
 * is a DENIAL, not a pass: the caller below treats it as "no identity could be
 * read", which is what an anonymous request is.
 */
function toWebHeaders(raw: unknown): Headers | undefined {
  if (raw && typeof (raw as Headers).get === 'function') return raw as Headers;
  if (raw && typeof raw === 'object') {
    const headers = new Headers();
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v == null) continue;
      if (Array.isArray(v)) for (const one of v) headers.append(k, String(one));
      else headers.set(k, String(v));
    }
    return headers;
  }
  return undefined;
}

/**
 * A `getSession(headers)` bound to the kernel's `auth` service, or `undefined`
 * when this deployment registers none.
 *
 * `undefined` does NOT open the routes. It removes one of the two credential
 * paths `resolveAuthzContext` consults (the better-auth session), leaving the
 * API-key path; a caller presenting neither resolves anonymous and is refused
 * below. A kernel with no auth service simply has no session to present.
 */
function buildGetSession(ctx: PluginContext): ((headers: Headers) => Promise<unknown>) | undefined {
  let authService: IAuthService | undefined;
  try {
    authService = ctx.getService<IAuthService>('auth');
  } catch {
    return undefined;
  }
  if (!authService) return undefined;
  // Narrowed once, outside the closure, so the closure body needs no re-check.
  const service = authService;
  return async (headers: Headers) => {
    // Both accessors are declared on the contract, and reading only the first
    // is a known way to get a silent anonymous: the shipped `plugin-auth`
    // registers an `AuthManager`, which has no `api` member at all, so `api`
    // alone yields `undefined` on every current deployment and the caller
    // reads that as "no session". `getApi()` is the accessor to prefer;
    // `api` is its legacy twin, kept because a provider may still mount it.
    const api = service.api ?? (await service.getApi?.());
    return api?.getSession?.({ headers });
  };
}

/**
 * The capability every route in this family demands (#9593).
 *
 * ## Matched, never minted
 *
 * `manage_platform_settings` is the capability the adjacent Setup-admin
 * families already gate on, and three independent measurements converge on it:
 *
 *  - **The sibling settings namespaces.** `@objectstack/service-settings`'s
 *    manifests split into two cohorts. The tenant-facing, cosmetic ones —
 *    `branding`, `company`, `localization`, `feature-flags` — declare
 *    `readPermission: 'setup.access'` / `writePermission: 'setup.write'`. The
 *    platform-infrastructure ones that carry connection configuration and
 *    credentials — `mail`, `storage`, `sms`, `auth`, `ai`, `knowledge`, and
 *    `packages/objectql`'s lifecycle namespace — declare
 *    `manage_platform_settings` for BOTH. A datasource is a driver plus a DSN
 *    plus a bound `sys_secret`; it belongs to the second cohort by
 *    construction, not by analogy.
 *  - **This plugin's own Setup nav entry.** `datasource-admin-plugin.ts`
 *    contributes `nav_datasources` into the Setup app's `group_integrations`
 *    slot with `requiredPermissions: ['manage_platform_settings']`. The
 *    console door was already gated at this capability while the HTTP door
 *    behind it took any authenticated caller — declared-but-unenforced (Prime
 *    Directive #10) with the declaration and the gap in one package. Gating
 *    here makes declared equal enforced and takes away no console anyone could
 *    already reach.
 *  - **The capability's own definition.** `PLATFORM_CAPABILITIES`
 *    (`packages/spec/src/security/capabilities.ts`) describes it as
 *    "Configure global platform settings (mail, storage, AI, licensing, …) and
 *    platform-only Setup pages" — the class this family is in, named in the
 *    registry rather than inferred here.
 *
 * ## Why there is no read/write split
 *
 * The card leaves the split to measurement, and the measurement says no. The
 * cohort that splits is the cosmetic one; the credential-bearing cohort does
 * not, and its reads are the reason. A read here is not a name list: `GET
 * /datasources/:name` returns the stored connection config — host, port,
 * database, user, `redactedConfigKeys` and the `hasSecret` handle flag — and
 * `GET /:name/remote-tables` returns a live introspection of a remote schema.
 * That is the same class of data `mail`, `storage` and `auth` gate their reads
 * on, and a lower read capability would publish a deployment's connection
 * topology to every authenticated tenant user, which is most of what the write
 * gate is protecting. `GET /drivers` is static and could stand lower, and is
 * held at the same line for the reason the authentication floor gave: a family
 * whose floor has one hole has to be read route by route.
 *
 * ⚠️ Not a platform-admin gate. `admin_full_access` carries
 * `manage_platform_settings` in its `systemPermissions`
 * (`plugin-security/src/objects/default-permission-sets.ts`), so every platform
 * admin holds it already and needs no bypass; a deployment can equally grant it
 * to an operator set that is not a full admin. There is deliberately no
 * `isPlatformAdmin` / posture arm here — that would be a SECOND policy beside
 * the capability, and the sibling gate in `@objectstack/rest`'s
 * `package-routes.ts` reads the held set only, for the same reason.
 */
export const DATASOURCE_ADMIN_CAPABILITY = 'manage_platform_settings';

export function registerDatasourceAdminRoutes(
  server: IHttpServer,
  ctx: PluginContext,
  basePath = '/api/v1',
): void {
  const root = `${basePath}/datasources`;

  /**
   * The authorization floor for this whole family (#9391 authentication, #9593
   * capability). Answers `401 UNAUTHENTICATED` or `403 PERMISSION_DENIED` and
   * returns `true` when the caller must be refused, so every handler opens with
   * `if (await requireDatasourceAdmin(req, res)) return;`.
   *
   * ## One resolution, two decisions — deliberately not two guards
   *
   * The identity and the held capabilities come out of the SAME
   * `resolveAuthzContext` call. Splitting this into an authentication guard
   * followed by a capability guard would resolve the request twice, and two
   * resolutions of one request can disagree — the second read is a fresh set of
   * `sys_*` queries against a store another request may have written in
   * between. One read, then both decisions off that one envelope.
   *
   * The order is fixed: anonymous first. A caller with no identity must be told
   * it has no identity, not that its (empty) capability set is insufficient —
   * the latter is both wrong and a hint that the credential was read and
   * rejected on other grounds.
   *
   * ## Why this module needs its own line at all
   *
   * These routes are mounted straight onto `IHttpServer` from a plugin `init()`
   * — the third mount style this family's route ledger describes — so they pass
   * through neither of the seams that produce the platform's 401s: the REST
   * server's `enforceAuth` (which guards `/data`, `/meta`, `/batch`,
   * `/security/explain`) runs inside `RestServer`'s own handlers, and the
   * dispatcher domains' anonymous floor runs inside the dispatcher. Neither is
   * reachable from here, and neither is a middleware anything could be routed
   * through. The sibling direct-mount registrar in `@objectstack/rest`
   * (`package-routes.ts`) reached the same conclusion and took the same shape
   * for the same reason.
   *
   * ## What is imported rather than restated, and why that matters
   *
   * Two things, and they are the whole point of the fix:
   *
   *  - the DECISION — `shouldDenyAnonymous` (`@objectstack/core`), the one
   *    function every HTTP seam shares, so this family can never drift on who
   *    counts as anonymous. `isSystem` is never settable from the wire, and a
   *    CORS `OPTIONS` preflight passes, both by that function's construction.
   *    No `path` is passed: the control-plane allowlist exists for `/auth`,
   *    `/health`, `/ready` and `/discovery`, and nothing here is one of those.
   *  - the IDENTITY — `resolveAuthzContext` (`@objectstack/core`), the same
   *    resolution `RestServer` and the runtime dispatcher perform. Reading only
   *    a better-auth session here would have been cheaper and WRONG in the
   *    direction that matters: it would refuse a caller presenting a valid
   *    `sys_api_key`, which is a credential this platform admits everywhere
   *    else. Admitting every credential kind the platform admits is what makes
   *    this a floor rather than a second, narrower policy.
   *
   * ## Fail-closed, and where the check sits
   *
   * Anything that throws or resolves to no identity is a refusal — an
   * unresolvable request is anonymous, and there is no fallback that opens the
   * routes. The check also runs BEFORE `resolve()`: an anonymous caller must
   * not learn from a `503` which services this deployment has wired, and a
   * refusal that landed after dispatch would already have performed the write
   * it was refusing.
   *
   * ## The envelope
   *
   * `sendError`, not the flat `ANONYMOUS_DENY_BODY` the `/data` + `/meta`
   * `enforceAuth` seam writes. Both are live and sanctioned (ADR-0112's
   * 2026-07-30 amendment records the flat and wrapped envelopes as the two);
   * every other body in this module goes through the shared `sendOk`/`sendError`
   * and `check:route-envelope` pins it at zero hand-written bodies, so the
   * wrapper is this surface's, while the status, code and message are the
   * shared ones. Same reasoning, same shape, as `package-routes.ts`.
   *
   * The capability refusal takes the STANDARD-catalog code for its status:
   * `403` `PERMISSION_DENIED`, which `HttpStatusErrorCodeMap` names for 403 and
   * `StandardErrorCode` describes as "User lacks required permission".
   * Deliberately NOT `FORBIDDEN`, which the sibling `package-routes.ts` emits:
   * that spelling is a grandfathered pre-gate synonym (ADR-0112 D3's
   * `STANDARD_SYNONYM_WAIVERS`), waived for the three packages already putting
   * it on the wire, and the waiver schema's own words are that it "keeps a WIRE
   * VALUE registered; it does not endorse the spelling for new code". A
   * standard member needs no per-package ledger registration either — the same
   * reason `SERVICE_UNAVAILABLE` and `RESOURCE_NOT_FOUND` appear below while
   * `@objectstack/service-datasource`'s ledger entry lists only its own two
   * registered codes.
   *
   * ## What the message says, and what it withholds
   *
   * The capability's name and nothing else. A refused caller needs to know
   * which grant to ask an administrator for; it must not learn whether the
   * named datasource exists, which services this deployment wired, or anything
   * else it was not entitled to read — which is also why this check, like the
   * anonymous one, runs BEFORE `resolve()` and before any handler body.
   */
  const requireDatasourceAdmin = async (req: any, res: any): Promise<boolean> => {
    let userId: string | undefined;
    let systemPermissions: string[] = [];
    try {
      const headers = toWebHeaders(req?.headers);
      if (headers) {
        // Both lookups happen PER REQUEST, for the same reason `resolve()`
        // below does it: this registrar runs inside a plugin `init()`, and a
        // service resolved there is a boot-instant snapshot of a registry that
        // is still filling. Binding the session resolver at registration time
        // would answer "no auth service" on precisely the deployments that
        // have one but register it later — every session-authenticated caller
        // refused, with nothing in the registry to show for it.
        const getSession = buildGetSession(ctx);
        // `IDataEngine` for both spellings: the resolver reads exactly `find`
        // off this, which is the data plane's own surface, and the same pair
        // is spelled this way where other services resolve the engine. The
        // two names are one registration — `packages/objectql` registers one
        // object under both, two lines apart.
        let ql: IDataEngine | undefined;
        try {
          ql = ctx.getService<IDataEngine>('objectql') ?? ctx.getService<IDataEngine>('data');
        } catch {
          ql = undefined;
        }
        const authz = await resolveAuthzContext({ ql, headers, getSession });
        userId = authz.userId;
        // The same envelope, read twice. `systemPermissions` is the resolver's
        // aggregate of every permission set the caller holds (user-bound and
        // position-bound alike) — the field `package-routes.ts` and the `/meta`
        // gate read, so this family gates on the platform's capability
        // resolution rather than a second reading of `sys_*`.
        systemPermissions = Array.isArray(authz.systemPermissions) ? authz.systemPermissions : [];
      }
    } catch {
      // Fail closed: an identity that could not be resolved is not an identity,
      // and grants that could not be read are not grants.
      userId = undefined;
      systemPermissions = [];
    }
    // `isSystem` is deliberately not read off anything the wire can reach —
    // `ResolvedAuthzContext` has no such field, and inbound HTTP never carries
    // one, so the only way past this line is a resolved caller.
    if (shouldDenyAnonymous({ userId, method: req?.method })) {
      sendError(res, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE);
      return true;
    }
    if (!systemPermissions.includes(DATASOURCE_ADMIN_CAPABILITY)) {
      sendError(
        res,
        403,
        'PERMISSION_DENIED',
        `Managing datasources requires the \`${DATASOURCE_ADMIN_CAPABILITY}\` capability.`,
      );
      return true;
    }
    return false;
  };


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
  server.get(root, async (req: any, res: any) => {
    if (await requireDatasourceAdmin(req, res)) return;
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
  server.get(`${root}/drivers`, async (req: any, res: any) => {
    if (await requireDatasourceAdmin(req, res)) return;
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
    if (await requireDatasourceAdmin(req, res)) return;
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
    if (await requireDatasourceAdmin(req, res)) return;
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
    if (await requireDatasourceAdmin(req, res)) return;
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
    if (await requireDatasourceAdmin(req, res)) return;
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
    if (await requireDatasourceAdmin(req, res)) return;
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
    if (await requireDatasourceAdmin(req, res)) return;
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
    if (await requireDatasourceAdmin(req, res)) return;
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
    if (await requireDatasourceAdmin(req, res)) return;
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
    if (await requireDatasourceAdmin(req, res)) return;
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
