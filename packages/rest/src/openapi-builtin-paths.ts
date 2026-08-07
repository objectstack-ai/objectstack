// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * BUILT-IN ROUTES → OpenAPI path entries (#5588, maintainer ruling C).
 *
 * ## What was wrong
 *
 * The published `GET {apiPath}/openapi.json` used to carry a built-in route
 * section written by hand in `packages/spec/scripts/build-openapi.ts` against
 * a literal `basePath = '/api'`. A real boot probed it row by row and **0 of
 * its 10 operations existed** (#5588): every path was missing the `/v1` (and
 * the CRUD ones also the `/data`), `PUT {object}/{id}` was documented while
 * the server answers `PATCH` and 405s the `PUT`, and two paths were served by
 * nobody at all — `/api/meta/types` exists nowhere in the repo, and
 * `/.well-known/objectstack` is the runtime dispatcher's, mounted on the ROOT
 * rather than under the API base. A consumer generating a client from that
 * document got one 404 per data call.
 *
 * It could not have been right in that seat either: `apiPath` is configurable
 * (`api.apiPath ?? api.basePath + '/' + api.version`), so no static JSON
 * shipped in a package can spell the prefix correctly for every deployment.
 *
 * ## The shape of the fix
 *
 * The maintainer ruled option C (2026-08-06, on #5588): the built-in section
 * is OWNED AND PRODUCED BY `packages/rest`, the package that mounts those
 * routes (ADR-0076 one-route-one-owner, the ownership of this document proven
 * by the real boot in #5078). `packages/spec` keeps only what it genuinely
 * owns — `components.schemas`, `info`, `securitySchemes`.
 *
 * This module is the rest half. It reads the routes the server has actually
 * mounted and returns the `paths` section for them; `rest-server.ts` installs
 * it in place of whatever the static artifact carried, so the stale section
 * cannot leak through even while the spec-side generation is still there
 * (leg 2 = #5744, blocked by this one). Discarding rather than merging is the
 * point: a serve-time merge with a wrong static section republishes the wrong
 * section.
 *
 * ## The source of truth, and why it is this one
 *
 * `RestServer.getRoutes()` — the very tables the router matches requests
 * against, read at REQUEST time. That is what makes phantom rows structurally
 * impossible rather than merely unlikely: a route absent from the tables is
 * absent from the document, and vice versa. It is also what makes the prefix
 * correct for free, since the paths there are the wire paths the server
 * registered under its configured base.
 *
 * Since #5822 that answer covers both ways this package mounts a route:
 * `RouteManager`'s own table, and the routes the bypassing registrars reported
 * after mounting them (`direct-mount.ts`). The second half kept the same
 * standard rather than relaxing it — a registrar reports the array it iterated
 * to mount, so the document still describes only what a boot actually mounted.
 *
 * The four batch routes are the standing demonstration: they register only
 * when the protocol implements `batchData` / `createManyData` / … , so on a
 * runtime without them they are neither served nor documented. A hand-written
 * table cannot express that; this one gets it right by construction.
 *
 * ## COVERAGE — what is in the section and what is not (#5588 ⑤)
 *
 * IN: every route this `RestServer` knows is mounted under the base being
 * served — regardless of ledger `disposition`. Disposition records whether the
 * SDK expresses a route, which is a different question from whether the HTTP
 * surface exists; `server-only` and `public` routes are served and therefore
 * documented. Two ways in, both real:
 *
 *  - Everything registered through its own `RouteManager` — all families in
 *    `rest-route-ledger.ts` whose `source` is `route-manager` (discovery,
 *    openapi, metadata, ui, crud, data-actions, search, email, forms, sharing,
 *    reports, approvals, analytics, security, batch). On a default boot that is
 *    78 routes, against the 10 operations the old section described.
 *  - Since #5822, the `direct-mount` registrars' routes (`package-routes.ts`,
 *    `external-datasource-routes.ts`, 9 ledger rows, 8 of them SDK
 *    capabilities) — but ONLY the ones this boot actually mounted. They
 *    register straight on `IHttpServer`, bypassing `RouteManager`, and the
 *    package registrar is service-gated (`packageService`) by
 *    `rest-api-plugin.ts`; each registrar now returns the array it iterated to
 *    mount and the composition step records it on this server, so the fact
 *    comes from the actual call rather than from a second, hand-kept table. A
 *    deployment with no `package` service documents no `packages.*` route,
 *    which is the same standard the rest of this document is held to — see
 *    `direct-mount.ts`, and `direct-mount-introspection.test.ts` for both
 *    directions pinned.
 *
 * OUT, deliberately and namedly:
 *
 *  - Everything mounted by other packages: the runtime dispatcher's root
 *    routes (including the `/.well-known/objectstack` the old section
 *    misfiled under `/api`), `service-storage`, `service-i18n`. Not rest's
 *    routes, not rest's to describe.
 *  - Declared (`api` metadata) endpoints — they join the same document one
 *    step later, from their own owner, via `enrichOpenApiWithEndpoints`.
 *
 * ## What it will NOT say
 *
 * Same rule as {@link ./openapi-endpoints.ts}: everything emitted is either
 * read off the registration or derived mechanically from the wire path. No
 * invented request/response schemas, no guessed status codes, no query
 * parameters nobody verified. The old section is the cautionary tale — its
 * `$ref`s to `CreateRequest`/`UpdateRequest` were wrong about the wire shape
 * on top of being attached to paths that 404: those envelopes are `{ data }`
 * while the route's body is the bare record, which `packages/spec`'s own
 * route catalog records at `plugin-rest-api.zod.ts` ("Was 'CreateRequestSchema'
 * — the generic service-contract envelope … which is NOT what this route
 * receives"). A document consumers generate clients from is better silent
 * than confidently wrong; absence is visible, fiction is not.
 *
 * One consequence worth stating: per-operation `security` is emitted ONLY as
 * `[]`, for routes whose registration tags them `public` (the anonymous form
 * runner). Every other operation says nothing and inherits the document-level
 * requirement. That under-claims for the handful of routes that answer
 * anonymously (`/discovery`, `/openapi.json`, `/docs`) — deliberately: the
 * registration carries no auth fact for them, and "credentials not needed" is
 * the one direction where a wrong claim leaks data.
 */

/** The slice of a registered route this module reads. */
export interface BuiltinRouteFact {
  /** HTTP verb as registered — `PATCH` is `PATCH`, never normalised to `PUT`. */
  method: string;
  /** Wire path with `:param` segments, exactly as `RouteManager` holds it. */
  path: string;
  /** Registration metadata; `summary` and `tags` are carried into the document. */
  metadata?: { summary?: string; tags?: readonly string[] } | undefined;
}

/** Where a structural surprise in the route table is reported. */
export interface BuiltinPathsLogger {
  error(message: string, meta?: unknown): void;
}

const DEFAULT_LOGGER: BuiltinPathsLogger = {
  error: (message, meta) =>
    meta === undefined
      ? (globalThis as { console?: Console }).console?.error(message)
      : (globalThis as { console?: Console }).console?.error(message, meta),
};

/** The project-scoping mirror segment (`rest-server.ts` `getScopedBasePath`). */
const SCOPE_SEGMENT = '/environments/:environmentId';

/** Tag a registration carries when the route answers anonymous callers. */
const PUBLIC_TAG = 'public';

/**
 * Methods that carry a request body in HTTP, and therefore in the document.
 * Mirrors the same constant in `openapi-endpoints.ts`.
 */
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

const RESPONSE_NOTE =
  'Response envelope. This section describes the route surface — which method and path exist, ' +
  'and what each is for. Per-route payload schemas are not derived here and are deliberately not ' +
  'invented (#5588).';

const REQUEST_BODY_NOTE =
  'JSON request body. Its shape is route-specific and is not described by this document (#5588).';

/**
 * Is this wire path served by the document being built for `basePath`?
 *
 * Both halves matter. A prefix test alone would let `/api/v10/...` in on a
 * `/api/v1` document (segment boundary), and would let the project-scoped
 * MIRROR in on the unscoped document — the mirror is a second, complete
 * registration under `{base}/environments/:environmentId` which gets its OWN
 * `openapi.json` (`registerRoutes` calls `registerForBase` once per base), so
 * copying it into the unscoped document would double every path.
 */
export function isUnderBase(path: string, basePath: string): boolean {
  if (!path.startsWith(basePath)) return false;
  const tail = path.slice(basePath.length);
  if (tail !== '' && !tail.startsWith('/')) return false;
  if (!basePath.includes(SCOPE_SEGMENT) && (tail === SCOPE_SEGMENT || tail.startsWith(`${SCOPE_SEGMENT}/`))) {
    return false;
  }
  return true;
}

/** `/api/v1/data/:object/:id` → `/api/v1/data/{object}/{id}`. */
export function toTemplatePath(wirePath: string): string {
  return wirePath
    .split('/')
    .map((segment) => (segment.startsWith(':') ? `{${segment.slice(1)}}` : segment))
    .join('/');
}

/** The `:param` names of a wire path, in order. */
export function pathParameterNames(wirePath: string): string[] {
  return wirePath
    .split('/')
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => segment.slice(1));
}

/** `request-info` → `RequestInfo`, `openapi.json` → `OpenapiJson`, `_drafts` → `Drafts`. */
function pascal(segment: string): string {
  return segment
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/**
 * A stable, mechanical `operationId` — `GET /api/v1/data/:object/:id` →
 * `getDataByObjectById`.
 *
 * Derived from the method and the path tail rather than authored, so a new
 * route cannot land with a missing or duplicated id, and an existing one
 * cannot drift away from the path it names. The base is excluded so the
 * project-scoped mirror's document (a separate document) names the same
 * operations as the unscoped one.
 */
export function buildOperationId(method: string, wirePath: string, basePath: string): string {
  const tail = wirePath.slice(basePath.length).split('/').filter(Boolean);
  const verb = method.toLowerCase();
  if (tail.length === 0) return `${verb}ApiRoot`;
  return (
    verb +
    tail.map((segment) => (segment.startsWith(':') ? `By${pascal(segment.slice(1))}` : pascal(segment))).join('')
  );
}

/** The produced built-in section. */
export interface BuiltinPathsResult {
  /** OpenAPI `paths`, keyed by templated path. */
  paths: Record<string, Record<string, unknown>>;
  /** Top-level `tags`, the union of the tags the produced operations use. */
  tags: Array<{ name: string }>;
  /** How many mounted routes this section describes — one operation each. */
  operationCount: number;
}

/**
 * Build the built-in section for one base path from the routes mounted under it.
 *
 * Pure: no clock, no I/O, no server. `rest-server.ts` hands it
 * `routeManager.getAll()` at request time; the tests hand it fixtures.
 */
export function buildBuiltinPaths(
  routes: readonly BuiltinRouteFact[],
  basePath: string,
  logger: BuiltinPathsLogger = DEFAULT_LOGGER,
): BuiltinPathsResult {
  const paths: Record<string, Record<string, unknown>> = {};
  const tagNames: string[] = [];
  const usedOperationIds = new Set<string>();
  /** templated path with parameter names erased → the first path with that shape. */
  const shapes = new Map<string, string>();
  let operationCount = 0;

  for (const route of routes) {
    if (!route || typeof route.path !== 'string' || typeof route.method !== 'string') continue;
    if (!isUnderBase(route.path, basePath)) continue;

    const template = toTemplatePath(route.path);
    const key = route.method.toLowerCase();

    // Two wire paths that differ only in parameter NAMES are one path to
    // OpenAPI ("identical" per the Paths Object) and would silently shadow
    // each other in the document. It cannot happen on today's surface; say so
    // loudly if it ever starts to, rather than publishing the survivor alone.
    // Keyed by shape ALONE, not by method+shape, because that verdict is a
    // property of the Paths Object: `GET /x/{a}` and `POST /x/{b}` collide too.
    const shape = template.replace(/\{[^}]*\}/g, '{}');
    const incumbentShape = shapes.get(shape);
    if (incumbentShape !== undefined && incumbentShape !== template) {
      logger.error(
        `[REST] built-in route '${route.method} ${route.path}' collides with '${incumbentShape}' in the ` +
          `OpenAPI document: OpenAPI treats templated paths that differ only in parameter names as ` +
          `identical. Documenting the first and OMITTING this one — rename a path parameter to fix it.`,
        { method: route.method, path: route.path, documented: incumbentShape },
      );
      continue;
    }
    shapes.set(shape, template);

    const item = paths[template] ?? (paths[template] = {});
    if (key in item) {
      logger.error(
        `[REST] built-in route '${route.method} ${route.path}' is mounted twice; the document keeps the ` +
          `first registration.`,
        { method: route.method, path: route.path },
      );
      continue;
    }

    let operationId = buildOperationId(route.method, route.path, basePath);
    if (usedOperationIds.has(operationId)) {
      let suffix = 2;
      while (usedOperationIds.has(`${operationId}${suffix}`)) suffix += 1;
      logger.error(
        `[REST] built-in operationId '${operationId}' is not unique; '${route.method} ${route.path}' is ` +
          `documented as '${operationId}${suffix}'.`,
        { method: route.method, path: route.path },
      );
      operationId = `${operationId}${suffix}`;
    }
    usedOperationIds.add(operationId);

    const operation: Record<string, unknown> = { operationId };

    const summary = route.metadata?.summary;
    if (typeof summary === 'string' && summary.length > 0) operation.summary = summary;

    const declaredTags = route.metadata?.tags;
    const tags: string[] = declaredTags
      ? [...declaredTags].filter((tag) => typeof tag === 'string' && tag.length > 0)
      : [];
    if (tags.length > 0) {
      operation.tags = [...tags];
      for (const tag of tags) if (!tagNames.includes(tag)) tagNames.push(tag);
    }

    // Read off the FULL wire path, so the scoped base's own `:environmentId` —
    // part of the base, but still a path parameter of every operation in that
    // document — is declared like any other. De-duplicated because a parameter
    // may only be declared once per operation.
    const parameterNames = pathParameterNames(route.path).filter(
      (name, index, all) => all.indexOf(name) === index,
    );
    if (parameterNames.length > 0) {
      operation.parameters = parameterNames.map((name) => ({
        name,
        in: 'path',
        required: true,
        schema: { type: 'string' },
      }));
    }

    if (BODY_METHODS.has(route.method.toUpperCase())) {
      operation.requestBody = {
        // Not `true`: several built-in POSTs (approval transitions, publish,
        // rollback) act on the path alone. Claiming a body is required where
        // it is not is the same class of untruth as claiming a path exists.
        required: false,
        description: REQUEST_BODY_NOTE,
        content: { 'application/json': { schema: { type: 'object' } } },
      };
    }

    // `default` rather than a status code: the success status is a per-handler
    // fact (201 on create, 204 on some deletes) that the route table does not
    // carry, and `200` would be wrong for those. `default` says "any response",
    // which is true of every row here.
    operation.responses = { default: { description: RESPONSE_NOTE } };

    if (tags.includes(PUBLIC_TAG)) operation.security = [];

    item[key] = operation;
    operationCount += 1;
  }

  return { paths, tags: tagNames.map((name) => ({ name })), operationCount };
}
