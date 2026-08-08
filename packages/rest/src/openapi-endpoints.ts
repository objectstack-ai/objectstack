// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DECLARED ENDPOINTS → OpenAPI path entries (#5040 E6, closing #5078).
 *
 * ## Why this lives in `packages/rest`
 *
 * `GET {basePath}/openapi.json` has exactly ONE owner, and a real boot proved
 * which: `rest-server.ts` answers it with a 355KB enriched document (Host-
 * injected `servers[0]`, 199 paths after `{object}` expansion, two `x-template`
 * fingerprints — all three are rest-server behaviours). The dispatcher carried
 * a `metaSvc.generateOpenApi` probe for the same path that was DOUBLY dead:
 * no implementation of the method has ever existed in this repo or its two
 * siblings, and no route delivered `/openapi.json` into `dispatch()` in the
 * first place. #5078 recorded both facts; the E6 design amendment on #5040 drew
 * the ADR-0076 conclusion — the documentation face joins the owner that already
 * serves the route, and the shadow branch is deleted rather than implemented.
 * Implementing `generateOpenApi` on a metadata service would have created the
 * second owner that ADR-0076 §1 exists to forbid.
 *
 * So: this module extends the SAME enrichment pipeline that expands `{object}`
 * placeholders. Same request, same document, same best-effort posture.
 *
 * ## What it will and will not say
 *
 * The `ApiEndpointSchema` vocabulary is FROZEN (#5040 §0) and carries exactly
 * two documentation fields — `summary` and `description`. Everything else this
 * module emits is either the declaration read back verbatim (`path`, `method`,
 * `name`→`operationId`) or a fact about how the executor will treat that
 * declaration, mirrored from `endpoint-executor.ts` with the line cited. There
 * is no third category: no invented request/response schemas, no guessed
 * summaries, no `x-` extensions. A published OpenAPI document is a contract
 * consumers generate clients from — a fabricated schema in it is worse than an
 * absent one, because absence is visible and fiction is not.
 *
 * ## The mirrored facts, and why they are mirrored rather than imported
 *
 * The execution semantics live in `@objectstack/runtime` (`planEndpointTarget`,
 * `executeObjectOperation`) and the documentation face lives here, in a package
 * that does not — and per the layering should not — depend on the runtime. The
 * three facts restated below are each one line, each cited to its authority,
 * and each covered by a test that fails if this file drifts:
 *
 *  1. `object_operation` takes its record id from `query.id` for `get` /
 *     `update` / `delete` (`endpoint-executor.ts` `requireRecordId`) — the
 *     frozen vocabulary has no path-template syntax, so a declared endpoint
 *     cannot express `/{id}`.
 *  2. `create` answers 201, everything else 200 (`successAnswer` call sites).
 *  3. `script` / `proxy`, and an `object_operation` missing its `objectParams`,
 *     answer 501 (`planEndpointTarget`'s `unsupported` arm). Documenting those
 *     as if they worked is the declared≠enforced defect this program exists to
 *     remove, so they are documented as what they are.
 *
 * A shared, spec-level description of an endpoint's HTTP contract would delete
 * the mirror; it is not built here because Prime Directive #2 keeps logic out
 * of `packages/spec` and the frozen vocabulary is not this unit's to widen.
 *
 * ## What it emits today
 *
 * Real documents. The #5040 E7 publish flip
 * (`packages/spec/src/api/endpoint-publish-gate.ts`) ended the wholesale
 * refusal of a non-empty `apis:`, so the enumeration is no longer empty on a
 * deployment that declares endpoints: a real showcase boot serves an
 * `/openapi.json` describing its two declared endpoints
 * (`packages/qa/dogfood/test/showcase-declarative-endpoints.dogfood.test.ts`).
 *
 * ## What it is HANDED (#5224)
 *
 * Its production caller no longer passes the enumerated `api` items. It passes
 * the set the endpoint matcher confirmed it will serve (`served-endpoints.ts`),
 * because enumeration and service are two different readers and a real boot
 * measured them disagreeing: a row written through `PUT /meta/api/{name}` was
 * enumerated, never matched, and published here as a live path with
 * `security: []` while every request to it answered 404.
 *
 * That makes the parse-and-resolve-duplicates pass below DOWNSTREAM of the
 * authority rather than a second opinion beside it — with a matcher-narrowed
 * input its duplicate branch cannot fire, since the matcher already resolved
 * every route to one owner. It is kept because this function is exported and
 * unit-tested as a unit: it must still refuse to document a half-valid shape
 * when handed raw items directly. What it must never become is the place where
 * "will this be served" is decided; that question has one owner, and asking it
 * is the caller's job.
 *
 * The empty-set case is still exact rather than approximate — with nothing to
 * add, {@link enrichOpenApiWithEndpoints} returns its input document BY
 * REFERENCE — which is what keeps a deployment that declares no endpoint
 * byte-identical to one built before this module existed. That invariant is
 * pinned by a test rather than argued.
 */

import { ApiEndpointSchema, type ApiEndpoint } from '@objectstack/spec/api';

/** The slice of an OpenAPI document this module reads and rewrites. */
export interface OpenApiDocumentLike {
  paths?: Record<string, unknown>;
  security?: unknown;
  [key: string]: unknown;
}

/**
 * Where a rejected declaration is reported.
 *
 * Same posture as the endpoint matcher's load gate (`buildEndpointIndex`): a
 * stored item that fails `ApiEndpointSchema` is skipped LOUDLY and named, never
 * documented half-parsed. A document that describes a declaration the matcher
 * refuses to serve is the same class of lie as the ledger note #5078 was filed
 * about.
 */
export interface EndpointDocLogger {
  error(message: string, meta?: unknown): void;
}

const DEFAULT_LOGGER: EndpointDocLogger = {
  error: (message, meta) =>
    meta === undefined
      ? (globalThis as { console?: Console }).console?.error(message)
      : (globalThis as { console?: Console }).console?.error(message, meta),
};

/**
 * Trim exactly one trailing slash, never from a lone `/`.
 *
 * Mirrors `normalizeEndpointPath` (`@objectstack/metadata` endpoint-matcher),
 * restated rather than imported so the HTTP face does not take a runtime
 * dependency on the metadata engine for one line. It matters that the two
 * agree: the matcher treats `/x` and `/x/` as one route, so a document that
 * listed both would advertise a route nobody serves.
 */
function normalizeDeclaredPath(path: string): string {
  const raw = String(path ?? '');
  if (raw.length > 1 && raw.endsWith('/')) return raw.slice(0, -1);
  return raw;
}

/** OpenAPI Path Item keys are the lower-cased method names. */
function operationKey(method: string): string {
  return String(method ?? '').toLowerCase();
}

/**
 * The security requirement an authenticated endpoint points at.
 *
 * Read OFF THE DOCUMENT (its own `security`, else its first declared scheme)
 * instead of hard-coding a scheme name here. The document is generated from
 * `packages/spec`; naming `bearerAuth` in this file would create a second
 * place that has to be right, and it would go stale silently — the document
 * would still parse, the operation would just point at a scheme that no longer
 * exists. Returns `undefined` when the document declares no security at all,
 * in which case authenticated operations simply say nothing (and inherit
 * whatever the document-level default is, per the OpenAPI object model).
 */
export function resolveSecurityRequirement(doc: OpenApiDocumentLike): unknown[] | undefined {
  const docSecurity = doc.security;
  if (Array.isArray(docSecurity) && docSecurity.length > 0) {
    return docSecurity.map((req) => (req && typeof req === 'object' ? { ...(req as object) } : req));
  }
  const schemes = (doc.components as { securitySchemes?: Record<string, unknown> } | undefined)?.securitySchemes;
  const first = schemes && typeof schemes === 'object' ? Object.keys(schemes)[0] : undefined;
  return first ? [{ [first]: [] }] : undefined;
}

/** How the executor will treat this declaration — the mirrored facts, in one place. */
interface EndpointHttpFacts {
  /** Status the executor answers on success (or 501 when it cannot execute). */
  successStatus: number;
  /** `true` when the executor reads a record id off `query.id`. */
  requiresRecordId: boolean;
  /** `true` when the executor reads the request body. */
  readsBody: boolean;
  /** Set when the runtime refuses to execute the declaration at all. */
  unsupportedReason?: string;
}

/**
 * Mirror of `planEndpointTarget` + the `object_operation` operation table
 * (`endpoint-executor.ts`), reduced to the four facts a path entry needs.
 */
function httpFactsFor(endpoint: ApiEndpoint): EndpointHttpFacts {
  if (endpoint.type === 'object_operation') {
    const object = endpoint.objectParams?.object;
    const operation = endpoint.objectParams?.operation;
    if (!object || !operation) {
      return {
        successStatus: 501,
        requiresRecordId: false,
        readsBody: false,
        unsupportedReason:
          "declares type 'object_operation' without both `objectParams.object` and `objectParams.operation`",
      };
    }
    return {
      successStatus: operation === 'create' ? 201 : 200,
      requiresRecordId: operation === 'get' || operation === 'update' || operation === 'delete',
      readsBody: operation === 'create' || operation === 'update',
    };
  }

  if (endpoint.type === 'flow') {
    if (!endpoint.target) {
      return {
        successStatus: 501,
        requiresRecordId: false,
        readsBody: false,
        unsupportedReason: "declares type 'flow' but names no target flow",
      };
    }
    // The request body is the flow input, exactly as on
    // `POST /automation/:name/trigger`.
    return { successStatus: 200, requiresRecordId: false, readsBody: true };
  }

  return {
    successStatus: 501,
    requiresRecordId: false,
    readsBody: false,
    unsupportedReason: `declares type '${endpoint.type}', which this runtime does not execute in 17.x`,
  };
}

/** Methods that carry a request body in HTTP, and therefore in the document. */
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/**
 * One OpenAPI Operation Object for one declaration.
 *
 * Exported for the tests that assert the shape per endpoint type; the enricher
 * below is the only production caller.
 */
export function buildEndpointOperation(
  endpoint: ApiEndpoint,
  securityRequirement: unknown[] | undefined,
): Record<string, unknown> {
  const facts = httpFactsFor(endpoint);
  const operation: Record<string, unknown> = { operationId: endpoint.name };

  // `summary` / `description` are the ONLY documentation the frozen vocabulary
  // carries. Absent means absent — no derived stand-in, because a generated
  // sentence reads exactly like an authored one and cannot be told apart later.
  if (endpoint.summary) operation.summary = endpoint.summary;
  if (endpoint.description) operation.description = endpoint.description;

  if (facts.requiresRecordId) {
    operation.parameters = [
      {
        name: 'id',
        in: 'query',
        required: true,
        schema: { type: 'string' },
        description:
          'Record id. Declared endpoints take it from the query string — the endpoint vocabulary defines no path templates.',
      },
    ];
  }

  if (facts.readsBody && BODY_METHODS.has(endpoint.method)) {
    // Free-form object, deliberately: the executor forwards the body (through
    // `inputMapping`, when declared) to the same pipeline the built-in route
    // uses, and this document has no PER-OBJECT schemas to point at.
    //
    // Since #5168 `components.schemas` is no longer empty — it carries the
    // nine contract schemas — but they are an ISLAND: the served document
    // contains ZERO `$ref`s, so nothing in it points INTO them (#6797,
    // re-measured against the real `GET /openapi.json` handler and against
    // the static artifact, both 0). That is structural rather than an
    // oversight — no step of the assembly emits one. Since #5588 (ruling C)
    // the built-in section is produced at request time by `buildBuiltinPaths`,
    // which emits none DELIBERATELY: the artifact's old section pointed at
    // `CreateRequest`/`UpdateRequest` and was wrong about the wire shape those
    // routes accept (`openapi-builtin-paths.ts`, "What it will NOT say"). And
    // #5744 stopped the generator emitting `paths` at all.
    //
    // So there is no reference graph to hang a body schema on; and the nine
    // are generic CRUD envelopes (`ApiError`, …) rather than the shape of
    // `showcase_task`'s body in any case. An empty `type: object` says "a
    // JSON object, shape not described here", which is true; naming fields we
    // have not derived would not be.
    operation.requestBody = {
      required: true,
      content: { 'application/json': { schema: { type: 'object' } } },
    };
  }

  const responses: Record<string, unknown> = {};
  if (facts.unsupportedReason) {
    responses['501'] = {
      description: `Not implemented — this endpoint ${facts.unsupportedReason}.`,
    };
  } else {
    responses[String(facts.successStatus)] = {
      description: facts.successStatus === 201 ? 'Created' : 'Success',
    };
  }
  if (endpoint.authRequired) responses['401'] = { description: 'Unauthorized' };
  operation.responses = responses;

  // `authRequired` is `true` by default and materialised by the parse above, so
  // there is no "unset" state to document. An explicit `security: []` is the
  // OpenAPI way to say "this operation takes no credentials" — the one shape a
  // reviewer should be able to spot in a diff.
  if (endpoint.authRequired) {
    if (securityRequirement) operation.security = securityRequirement;
  } else {
    operation.security = [];
  }

  return operation;
}

/**
 * Parse the stored `api` items, dropping (loudly) everything that is not a
 * valid declaration, and resolve duplicate route claims the way the matcher
 * does.
 *
 * Exported for tests. The duplicate rule — lexicographically-first `name` keeps
 * the route — is `buildEndpointIndex`'s, restated here for the same reason it
 * was chosen there: it is total, deterministic across nodes and boots, and it
 * must produce the SAME winner, or the document would name an endpoint the
 * runtime does not run.
 */
export function selectDocumentableEndpoints(
  items: readonly unknown[],
  logger: EndpointDocLogger = DEFAULT_LOGGER,
): ApiEndpoint[] {
  const byRoute = new Map<string, ApiEndpoint>();

  for (const item of items) {
    const parsed = ApiEndpointSchema.safeParse(item);
    if (!parsed.success) {
      const declaredName =
        item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string'
          ? (item as { name: string }).name
          : '<unnamed>';
      logger.error(
        `[REST] stored api item '${declaredName}' does not satisfy ApiEndpointSchema — it is OMITTED ` +
          `from the OpenAPI document. The endpoint matcher excludes it too, so the route it declares ` +
          `answers 404; fix the declaration rather than the document.`,
        { issues: parsed.error.issues },
      );
      continue;
    }

    const endpoint = parsed.data;
    const key = `${endpoint.method.toUpperCase()} ${normalizeDeclaredPath(endpoint.path)}`;
    const incumbent = byRoute.get(key);
    if (!incumbent) {
      byRoute.set(key, endpoint);
      continue;
    }

    const challengerWins = endpoint.name < incumbent.name;
    if (challengerWins) byRoute.set(key, endpoint);
    const winner = challengerWins ? endpoint : incumbent;
    const loser = challengerWins ? incumbent : endpoint;
    logger.error(
      `[REST] duplicate endpoint claim on '${key}': api items '${incumbent.name}' and '${endpoint.name}' ` +
        `both declare it. '${winner.name}' is documented and '${loser.name}' is OMITTED — the rule is ` +
        `lexicographically-first \`name\` wins, the same one the endpoint matcher applies, so the ` +
        `document and the runtime name the same owner.`,
      { key, documented: winner.name, omitted: loser.name },
    );
  }

  return [...byRoute.values()];
}

/**
 * Fold declared endpoints into an OpenAPI document's `paths`.
 *
 * Returns `doc` ITSELF when there is nothing to add — that is what makes the
 * empty-set case byte-identical rather than merely equivalent, which is the
 * state a deployment declaring no endpoint stays in. Since the E7 flip let a
 * non-empty `apis:` publish, the other branch is the live one wherever
 * endpoints are declared.
 *
 * A declaration never displaces a built-in: if the document already describes
 * the same path+method, the built-in keeps it and the declaration is reported.
 * ADR-0076's rule is one route, one owner; where the two could disagree, the
 * package that actually mounts the route wins, in the document as on the wire.
 */
export function enrichOpenApiWithEndpoints<T extends OpenApiDocumentLike>(
  doc: T,
  items: readonly unknown[],
  logger: EndpointDocLogger = DEFAULT_LOGGER,
): T {
  if (!Array.isArray(items) || items.length === 0) return doc;

  const endpoints = selectDocumentableEndpoints(items, logger);
  if (endpoints.length === 0) return doc;

  const securityRequirement = resolveSecurityRequirement(doc);
  const paths: Record<string, unknown> = { ...(doc.paths ?? {}) };
  let added = 0;

  for (const endpoint of endpoints) {
    const path = normalizeDeclaredPath(endpoint.path);
    const key = operationKey(endpoint.method);
    const existing = paths[path] as Record<string, unknown> | undefined;

    if (existing && typeof existing === 'object' && key in existing) {
      logger.error(
        `[REST] declared endpoint '${endpoint.name}' claims '${endpoint.method} ${path}', which this ` +
          `document already describes as a built-in route. The built-in KEEPS it and the declaration is ` +
          `OMITTED from the document — a path has one owner (ADR-0076), and the owner is whoever mounts it.`,
        { endpoint: endpoint.name, method: endpoint.method, path },
      );
      continue;
    }

    paths[path] = { ...(existing ?? {}), [key]: buildEndpointOperation(endpoint, securityRequirement) };
    added += 1;
  }

  if (added === 0) return doc;
  return { ...doc, paths };
}
