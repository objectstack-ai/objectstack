// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The PUBLISH GATES for declarative `apis:` endpoints (#5040 E7, ADR-0121).
 *
 * ## What changed here, and why it is a narrowing rather than a reversal
 *
 * #4936 refused a non-empty `apis:` WHOLESALE: nothing mounted a declared
 * `path`, no matcher existed, and every key — `authRequired` included — parsed
 * green while gating nothing. That refusal was the honest state for a surface
 * with zero executor. #5040's E-series built the executor (mount seam, matcher,
 * policy keys, execution targets, mapping keys, OpenAPI enrichment), so the
 * refusal's premise is gone and keeping it would now be the lie in the other
 * direction: a working capability refused at the door.
 *
 * This module is that flip. A declared endpoint is no longer rejected for
 * EXISTING; it is rejected for being a shape 17.x cannot serve, one gate at a
 * time, each naming the endpoint, the key and the fix. The set of legal
 * declarations is exactly the set the runtime executes — the `declared =
 * enforced` state the whole program exists to reach.
 *
 * ## Every per-endpoint gate has a runtime counterpart, and the runtime is the source
 *
 * Nothing here is invented. Each per-endpoint gate mirrors a refusal the
 * runtime already makes, so publish and execution can never disagree about what
 * is servable (the one cross-item gate, ADR-0138 D2b in section (f), is a
 * publish refusal by the record's decision and says why there):
 *
 * | gate | runtime counterpart |
 * |---|---|
 * | unsupported target (`script` / `proxy` / incomplete `object_operation` / empty flow `target`) | `planEndpointTarget` — `packages/runtime/src/endpoint-executor.ts` |
 * | mapping (`transform`, unusable path, colliding `target`) | `mappingDeclarationRejection` — `packages/runtime/src/api-mapping.ts` |
 * | policy (armed-but-unusable `rateLimit`, negative `cacheTtlSeconds`, `cacheTtlSeconds` off GET) | `createEndpointRateLimiterRegistry` / `computeCacheControl` — `packages/runtime/src/endpoint-policy.ts` |
 * | namespace + uniqueness | ADR-0121 D1/D2, and `normalizeEndpointPath` (`packages/metadata/src/endpoint-matcher.ts`) for the path form |
 *
 * The runtime keeps its refusals: a declaration can still reach the store
 * through a direct `metadata.register()` that never passed publish, and a
 * silent skip there would be the same lie. This gate is the FIRST door, not
 * the only one.
 *
 * ## Why the messages are this long
 *
 * The author is very often an AI maintainer (ADR-0033) reading nothing but the
 * rejection. Each message therefore carries the fact, the exact offending
 * value, and the fix — enough to act on without opening this file, the ADR, or
 * the issue. That is the same posture as a `retiredKey()` tombstone.
 *
 * ## Three rulings this module implements verbatim
 *
 *  - **ADR-0138 D2b** — publish refuses an `authRequired: false` endpoint of
 *    `type: 'flow'` whose target flow declares `runAs: 'system'`, in both
 *    directions, with a prescription: no anonymous door triggers an elevated
 *    flow directly. Section (f); its D3 record is the semantic entry
 *    `api-endpoint-anonymous-elevated-flow-refused`.
 *  - **ADR-0121 D2 / #5040 Q1 = A** — the namespace segment comes from an
 *    EXPLICIT `manifest.namespace`. There is no `deriveNamespaceFromPackageId`
 *    fallback here on purpose: an outward URL contract must not shift because
 *    somebody rewrote a package id.
 *  - **ADR-0121 D6** — `authRequired: false` requires an ARMED rate limit, and
 *    "armed" means `rateLimit.enabled === true`. A presence check would be
 *    vacuous: `RateLimitConfigSchema.enabled` defaults to `false`, so
 *    `rateLimit: { windowMs, maxRequests }` parses into a budget that meters
 *    nothing while satisfying the letter of "declares a rateLimit".
 */

import type { ApiEndpoint } from './endpoint.zod';
import { normalizeEndpointPath } from './endpoint.zod';

/**
 * The platform's single reserved carve-out segment for app-declared endpoints
 * (ADR-0121 D1): a declared path is `<runtime prefix>/apps/<namespace>/<subpath>`.
 *
 * Deliberately a SECOND spelling of `APP_ENDPOINT_SEGMENT`
 * (`packages/runtime/src/api-endpoint-step.ts`), which cannot be imported here
 * — `packages/spec` is below `packages/runtime`. ADR-0121 makes the RULE the
 * contract, so the two sides agree on a rule rather than on a shared list.
 */
const APP_ENDPOINT_SEGMENT = 'apps';

/**
 * The dispatcher prefix a declaration is written against.
 *
 * A declared `path` is matched against the request path VERBATIM
 * (`endpointIndexKey`), so it carries the deployment's dispatcher prefix as a
 * literal — and publish, which runs long before any deployment exists, can only
 * hold declarations to the default (`DispatcherPluginConfig.prefix`, default
 * `/api/v1`). A deployment that re-prefixes its dispatcher is #5040 §7-8, an
 * open vocabulary question (prefix-relative declarations), NOT something to
 * guess at here.
 */
const DEFAULT_RUNTIME_PREFIX = '/api/v1';

/** The mount prefix every endpoint of `namespace` must be declared under. */
export function appEndpointMountPrefix(namespace: string): string {
    return `${DEFAULT_RUNTIME_PREFIX}/${APP_ENDPOINT_SEGMENT}/${namespace}/`;
}

/** Path segments no mapping may walk or write — prototype pollution vectors. */
const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

/** The object operations that never read a request body (#5111, PM ruling). */
const BODYLESS_OPERATIONS = new Set(['find', 'get', 'delete']);

/** The two mapping keys, spelled as the vocabulary spells them. */
const MAPPING_KEYS = ['inputMapping', 'outputMapping'] as const;
type MappingKey = (typeof MAPPING_KEYS)[number];

/**
 * One gate failure: where it happened (a Zod issue path, relative to the stack
 * root) and what the author must read.
 */
export interface EndpointGateIssue {
    /** Zod issue path — e.g. `['apis', 2, 'cacheTtlSeconds']`. */
    path: (string | number)[];
    message: string;
}

/** The stack identity the namespace gate reads (ADR-0121 D2). */
export interface EndpointGateIdentity {
    namespace?: string | undefined;
}

const NAMESPACE_RE = /^[a-z][a-z0-9_]{1,19}$/;

/**
 * Split a declared mapping path, or `undefined` when it is not a usable one.
 *
 * Character-for-character the runtime's `splitPath`
 * (`packages/runtime/src/api-mapping.ts`): a path that this accepts and that
 * one refuses would be a declaration published and then refused at 501.
 */
function splitMappingPath(path: unknown): string[] | undefined {
    if (typeof path !== 'string' || path === '') return undefined;
    const segments = path.split('.');
    for (const segment of segments) {
        if (segment === '' || UNSAFE_PATH_SEGMENTS.has(segment)) return undefined;
    }
    return segments;
}

/** Whether `a` is `b` or an ancestor of it (`['a']` vs `['a','b']`). */
function isPathPrefix(a: string[], b: string[]): boolean {
    if (a.length > b.length) return false;
    return a.every((segment, i) => b[i] === segment);
}

const MAPPING_PATH_HINT =
    "`source` and `target` are dot-separated field paths ('user.profile.email'). An empty path, an "
    + "empty segment ('a..b') and the JavaScript prototype keys (__proto__, prototype, constructor) "
    + 'are refused — the runtime refuses the identical set, so accepting one here would publish a '
    + 'declaration that answers 501 on every request.';

/**
 * Every gate, over one stack's `apis:`.
 *
 * Returns one issue per violation (never throws, never short-circuits the
 * array): an author fixing a stack with three bad endpoints should see three
 * rejections, not one per publish attempt. Per endpoint the gates DO stop at
 * the first failure, so a single endpoint reports the one thing to fix rather
 * than a cascade derived from it.
 */
export function validateApiEndpointDeclarations(
    endpoints: readonly ApiEndpoint[] | undefined,
    identity: EndpointGateIdentity,
): EndpointGateIssue[] {
    if (!endpoints || endpoints.length === 0) return [];

    const issues: EndpointGateIssue[] = [];
    const namespace = typeof identity.namespace === 'string' ? identity.namespace : undefined;

    // ── The namespace gate's precondition (ADR-0121 D2, #5040 Q1 = A) ───────
    //
    // Without an explicit namespace there is no legal path to hold anything to,
    // so this is reported once against `apis` itself and the per-endpoint path
    // gate is skipped — repeating "you have no namespace" per endpoint would
    // bury the one fix under N copies.
    const namespaceUsable = namespace !== undefined && NAMESPACE_RE.test(namespace);
    if (!namespaceUsable) {
        issues.push({
            path: ['apis'],
            message:
                'A stack that declares `apis:` MUST declare an explicit `manifest.namespace` '
                + (namespace === undefined
                    ? '(none is declared).'
                    : `(got '${namespace}', which is not a legal namespace).`)
                + ' The endpoint URL carve-out is derived from it (ADR-0121 D2): every declared `path` '
                + `must be \`${DEFAULT_RUNTIME_PREFIX}/${APP_ENDPOINT_SEGMENT}/<manifest.namespace>/<subpath>\`. `
                + 'The namespace is 2-20 chars matching /^[a-z][a-z0-9_]{1,19}$/ and is the same identity '
                + 'that prefixes every object name (`<namespace>_<short name>`). It is NOT derived from '
                + '`manifest.id`: an outward URL contract must not move because a package id was rewritten.',
        });
    }

    const mount = namespaceUsable ? appEndpointMountPrefix(namespace!) : undefined;
    /** normalized "METHOD path" → the first endpoint that claimed it. */
    const claims = new Map<string, { index: number; name: string }>();

    for (let index = 0; index < endpoints.length; index++) {
        const endpoint = endpoints[index]!;
        const at = (...rest: (string | number)[]): (string | number)[] => ['apis', index, ...rest];
        const named = `Endpoint '${endpoint.name}' (apis[${index}])`;

        const failure = firstFailure(endpoint, named, at, mount, claims);
        if (failure) {
            issues.push(failure);
            continue;
        }

        // Only a fully legal endpoint claims its route: a rejected declaration
        // must not also generate a duplicate report against the endpoint that
        // is fine.
        claims.set(claimKey(endpoint), { index, name: endpoint.name });
    }

    return issues;
}

/**
 * The IDENTITY-FREE gates for ONE already-parsed endpoint (#5189, #5040 E7b).
 *
 * Everything {@link validateApiEndpointDeclarations} judges EXCEPT the two
 * gates that need a stack identity the caller may not have:
 *
 *  - the **namespace** gate (ADR-0121 D1/D2) needs `manifest.namespace`, and
 *  - the **uniqueness** gate needs the sibling declarations of the same stack.
 *
 * Everything else — supported subset, mapping, policy (D6 included) — is
 * judgeable from the endpoint alone, so a consumer holding a single stored
 * declaration and no manifest can still refuse the shapes the runtime cannot
 * serve. The load-time backstop in the endpoint matcher
 * (`packages/metadata/src/endpoint-matcher.ts`) is exactly that consumer: a
 * declaration reaches the store through paths that never saw a manifest
 * (a direct `metadata.register()`, a Studio write), and D6 is the one gate
 * with no runtime counterpart — an unmetered anonymous endpoint executes
 * faithfully, which is precisely what D6 exists to prevent (#5189).
 *
 * Additive on purpose: it delegates to the SAME {@link firstFailure} the
 * full gate runs, so publish-time and load-time can never grow two opinions
 * of what is servable. The issue `path` it returns is relative to the
 * endpoint itself (`['rateLimit']`), not to a stack's `apis:` array.
 *
 * @returns the first gate failure, or `undefined` when the endpoint passes
 *          every identity-free gate.
 */
export function identityFreeEndpointGateFailure(endpoint: ApiEndpoint): EndpointGateIssue | undefined {
    return firstFailure(
        endpoint,
        `Endpoint '${endpoint.name}'`,
        (...rest) => rest,
        // No mount → `namespaceGate` returns undefined (it is "already reported
        // once, against `apis`" in the full run); no claims → `uniquenessGate`
        // has nothing to collide with. Both asymmetries are the point.
        undefined,
        new Map(),
    );
}

/** The normalized claim key — the matcher's own index key (`endpointIndexKey`). */
function claimKey(endpoint: ApiEndpoint): string {
    return `${endpoint.method.toUpperCase()} ${normalizeEndpointPath(endpoint.path)}`;
}

/**
 * The gates for ONE endpoint, in order, stopping at the first failure.
 *
 * Order is deliberate: namespace (is this route even yours?) → target (can this
 * shape run at all?) → mapping → policy → uniqueness. Reporting "your rate
 * limit is unusable" on an endpoint whose `type: 'proxy'` cannot run at all
 * would send the author to fix the wrong line.
 */
function firstFailure(
    endpoint: ApiEndpoint,
    named: string,
    at: (...rest: (string | number)[]) => (string | number)[],
    mount: string | undefined,
    claims: Map<string, { index: number; name: string }>,
): EndpointGateIssue | undefined {
    return (
        namespaceGate(endpoint, named, at, mount)
        ?? targetGate(endpoint, named, at)
        ?? mappingGate(endpoint, named, at)
        ?? policyGate(endpoint, named, at)
        ?? uniquenessGate(endpoint, named, at, claims)
    );
}

// ============================================================================
// (c) Namespace — ADR-0121 D1 / D2
// ============================================================================

function namespaceGate(
    endpoint: ApiEndpoint,
    named: string,
    at: (...rest: (string | number)[]) => (string | number)[],
    mount: string | undefined,
): EndpointGateIssue | undefined {
    if (mount === undefined) return undefined; // already reported once, against `apis`

    const path = endpoint.path;
    // Judged on the NORMALIZED path — the form the matcher indexes. Otherwise
    // `<mount>/` (a bare namespace root with a trailing slash) would pass here
    // and then be unreachable: it normalizes back to the mount itself, which
    // the endpoint step does not even consider a candidate path.
    const normalized = normalizeEndpointPath(path);
    const subpath = normalized.startsWith(mount) ? normalized.slice(mount.length) : undefined;
    if (subpath !== undefined && subpath !== '' && !subpath.startsWith('/')) return undefined;

    return {
        path: at('path'),
        message:
            `${named} declares path '${path}', which is not inside this stack's endpoint carve-out. `
            + `A declared path must be \`${mount}<subpath>\` with a non-empty subpath — for example `
            + `'${mount}things' (ADR-0121 D1). `
            + 'The `apps/<namespace>/` segment is what makes route ownership structural rather than a '
            + 'list to maintain: no built-in domain lives under `apps/`, and two packages can never '
            + 'collide because their namespaces differ. A path outside it would parse today and match '
            + 'NOTHING at runtime — the endpoint step only ever consults declarations under that mount. '
            + 'Only the subpath is yours to name; the prefix and namespace segments are derived from '
            + 'the deployment and from `manifest.namespace`.',
    };
}

// ============================================================================
// (a) Supported subset — mirrors `planEndpointTarget`
// ============================================================================

function targetGate(
    endpoint: ApiEndpoint,
    named: string,
    at: (...rest: (string | number)[]) => (string | number)[],
): EndpointGateIssue | undefined {
    if (endpoint.type === 'object_operation') {
        const object = endpoint.objectParams?.object;
        const operation = endpoint.objectParams?.operation;
        if (!object || !operation) {
            const missing = !object ? 'object' : 'operation';
            return {
                path: at('objectParams'),
                message:
                    `${named} declares \`type: 'object_operation'\` but \`objectParams.${missing}\` is missing. `
                    + 'An object_operation endpoint must declare BOTH `objectParams.object` (the object name, '
                    + "e.g. 'crm_lead') and `objectParams.operation` (one of find / get / create / update / "
                    + 'delete). The executor delegates to the same data pipeline `/data` uses and cannot '
                    + 'infer either half; an incomplete declaration would answer 501 on every request.',
            };
        }
        return undefined;
    }

    if (endpoint.type === 'flow') {
        if (!endpoint.target) {
            return {
                path: at('target'),
                message:
                    `${named} declares \`type: 'flow'\` but names no target flow in \`target\`. `
                    + 'Set `target` to the flow name (snake_case) this endpoint triggers — the endpoint is a '
                    + 'stable URL over that flow, executed through the same automation pipeline as '
                    + '`POST /automation/<name>/trigger`.',
            };
        }
        return undefined;
    }

    // Internal anchor for the `proxy` half: the egress/SSRF ruling this defers to
    // is #5040 §7-3. It stays in this comment rather than in the message — the
    // message is printed to a customer who cannot open the tracker.
    return {
        path: at('type'),
        message:
            `${named} declares \`type: '${endpoint.type}'\`, which this runtime does not execute. `
            + "This runtime executes only 'object_operation' and 'flow' endpoints. `script` is refused because "
            + 'no path in this repo verifies that a script target is reachable through the automation '
            + 'service — express the logic as a flow (`type: \'flow\'`) whose script node runs your '
            + 'registered function. `proxy` is refused because forwarding to an arbitrary outbound URL is '
            + 'a new egress/SSRF surface that needs its own security ruling before it can be served; '
            + 'call the third-party system from a flow instead, where the outbound call is '
            + 'made by a declared connector. Both stay in the vocabulary and are rejected here rather '
            + 'than parsed and ignored.',
    };
}

// ============================================================================
// (b) Mapping — mirrors `mappingDeclarationRejection`, plus the inert-declaration ruling
// ============================================================================

function mappingGate(
    endpoint: ApiEndpoint,
    named: string,
    at: (...rest: (string | number)[]) => (string | number)[],
): EndpointGateIssue | undefined {
    for (const key of MAPPING_KEYS) {
        const failure = mappingKeyGate(endpoint, key, named, at);
        if (failure) return failure;
    }
    return inertInputMappingGate(endpoint, named, at);
}

function mappingKeyGate(
    endpoint: ApiEndpoint,
    key: MappingKey,
    named: string,
    at: (...rest: (string | number)[]) => (string | number)[],
): EndpointGateIssue | undefined {
    const entries = endpoint[key];
    if (!Array.isArray(entries) || entries.length === 0) return undefined;

    const seen: Array<{ index: number; path: string; segments: string[] }> = [];

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!;
        const where = `${key}[${i}]`;

        if (entry.transform !== undefined) {
            return {
                path: at(key, i, 'transform'),
                message:
                    `${named} declares ${where}.transform ('${String(entry.transform)}'), which this runtime `
                    + 'does not execute. There is no transformation-function registry anywhere in the '
                    + 'platform, so the key would be parsed and ignored — the declared-but-inert state this '
                    + 'gate exists to end. A mapping entry MOVES and RENAMES fields by dot path and nothing '
                    + 'more: drop `transform`, or shape the value where it is produced (a flow endpoint whose '
                    + 'flow computes the value, or a formula field on the object). A function-valued '
                    + 'transform needs a registry and a sandbox ruling of its own before it can be declared.',
            };
        }

        const sourceSegments = splitMappingPath(entry.source);
        if (!sourceSegments) {
            return {
                path: at(key, i, 'source'),
                message:
                    `${named} declares ${where}.source '${String(entry.source)}', which is not a usable field `
                    + `path. ${MAPPING_PATH_HINT}`,
            };
        }

        const targetSegments = splitMappingPath(entry.target);
        if (!targetSegments) {
            return {
                path: at(key, i, 'target'),
                message:
                    `${named} declares ${where}.target '${String(entry.target)}', which is not a usable field `
                    + `path. ${MAPPING_PATH_HINT}`,
            };
        }

        const collision = seen.find(
            (other) => isPathPrefix(other.segments, targetSegments) || isPathPrefix(targetSegments, other.segments),
        );
        if (collision) {
            return {
                path: at(key, i, 'target'),
                message:
                    `${named} declares ${where}.target '${entry.target}', which collides with `
                    + `${key}[${collision.index}].target '${collision.path}'. Two mapping entries cannot write `
                    + "the same target path, and neither can write INSIDE the other's ('x' and 'x.y'): one "
                    + 'would silently discard the other, so the declaration you read is not the projection '
                    + 'you would get. Give each entry a distinct target.',
            };
        }

        seen.push({ index: i, path: entry.target, segments: targetSegments });
    }

    return undefined;
}

/**
 * `inputMapping` on an operation that never reads a request body.
 *
 * PM ruling on #5111 (2026-08-04), same category as `cacheTtlSeconds` on a non-GET
 * method: the declaration is legal to parse and provably inert, because
 * `inputMapping` maps the REQUEST BODY (its own `.describe()`) and `find` /
 * `get` / `delete` are served from `query` alone. "Declared, parsed, does
 * nothing" is exactly the state this program removes.
 */
function inertInputMappingGate(
    endpoint: ApiEndpoint,
    named: string,
    at: (...rest: (string | number)[]) => (string | number)[],
): EndpointGateIssue | undefined {
    const entries = endpoint.inputMapping;
    if (!Array.isArray(entries) || entries.length === 0) return undefined;
    if (endpoint.type !== 'object_operation') return undefined;

    const operation = endpoint.objectParams?.operation;
    if (!operation || !BODYLESS_OPERATIONS.has(operation)) return undefined;

    return {
        path: at('inputMapping'),
        message:
            `${named} declares \`inputMapping\` on a '${operation}' object_operation, which never reads a `
            + 'request body — so every entry would be parsed and then do nothing. `inputMapping` maps the '
            + 'REQUEST BODY to internal params (its own vocabulary text); `find` takes its criteria from '
            + 'the query string and `get` / `delete` take the record id from `query.id`. Remove the key, '
            + 'or move the endpoint to an operation that carries a body (`create` / `update`). '
            + 'Same rule, same reason as `cacheTtlSeconds` on a non-GET endpoint: a declaration that cannot '
            + 'take effect is rejected instead of silently ignored.',
    };
}

// ============================================================================
// (e) Policy — ADR-0121 D6 + the E4 refusals
// ============================================================================

function policyGate(
    endpoint: ApiEndpoint,
    named: string,
    at: (...rest: (string | number)[]) => (string | number)[],
): EndpointGateIssue | undefined {
    const rateLimit = endpoint.rateLimit;
    const armed = rateLimit?.enabled === true;

    // D6 — anonymous access requires an ARMED budget. `enabled` defaults to
    // `false`, so a presence check would pass a budget that meters nothing.
    if (endpoint.authRequired === false && !armed) {
        return {
            path: at('rateLimit'),
            message:
                `${named} declares \`authRequired: false\` without an ARMED rate limit. An anonymous `
                + 'endpoint is a free, unauthenticated execution entry point, so ADR-0121 D6 requires it to '
                + 'carry its own budget: declare `rateLimit: { enabled: true, windowMs: 60000, maxRequests: '
                + '100 }`. '
                + (rateLimit === undefined
                    ? 'No `rateLimit` is declared at all.'
                    : '`enabled` is not `true` — and it DEFAULTS to `false`, so writing only `windowMs` / '
                      + '`maxRequests` declares a budget that meters nothing and the endpoint would be '
                      + 'anonymous AND unmetered.')
                + ' `authRequired` defaults to `true`; setting it to `false` is the only way to open an '
                + 'endpoint, and arming the budget is the paired obligation.',
        };
    }

    if (armed) {
        const { maxRequests, windowMs } = rateLimit;
        if (typeof maxRequests === 'number' && maxRequests <= 0) {
            return {
                path: at('rateLimit', 'maxRequests'),
                message:
                    `${named} declares \`rateLimit.enabled: true\` with \`maxRequests: ${maxRequests}\`, a budget `
                    + 'that can never be honoured: a zero-or-negative allowance rejects every request, '
                    + 'including your own health checks. Set `maxRequests` above 0, or turn metering off with '
                    + '`enabled: false`. (The runtime fails closed on this shape — every request to the '
                    + 'endpoint would error — because "the author asked for metering and got none" is the '
                    + 'worse outcome.)',
            };
        }
        if (typeof windowMs === 'number' && windowMs <= 0) {
            return {
                path: at('rateLimit', 'windowMs'),
                message:
                    `${named} declares \`rateLimit.enabled: true\` with \`windowMs: ${windowMs}\`, which is not a `
                    + 'usable window. `windowMs` is the budget window in MILLISECONDS — 60000 is one minute. '
                    + 'Set it above 0, or turn metering off with `enabled: false`.',
            };
        }
    }

    const cacheTtlSeconds = endpoint.cacheTtlSeconds;
    if (typeof cacheTtlSeconds === 'number' && cacheTtlSeconds < 0) {
        return {
            path: at('cacheTtlSeconds'),
            message:
                `${named} declares \`cacheTtlSeconds: ${cacheTtlSeconds}\`. A response cache lifetime cannot be negative — `
                + 'seconds only, 0 or more. Use a positive number of seconds for a cacheable answer, or '
                + '`cacheTtlSeconds: 0` to say explicitly "never store this response" (it emits '
                + '`Cache-Control: no-store`); omit the key to send no caching header at all.',
        };
    }

    if (cacheTtlSeconds !== undefined && endpoint.method !== 'GET') {
        // Internal anchor for the GET-only rule: #5040 §3.3. Kept out of the
        // message, which is printed to a customer with no tracker access.
        return {
            path: at('cacheTtlSeconds'),
            message:
                `${named} declares \`cacheTtlSeconds\` on a ${endpoint.method} endpoint. \`cacheTtlSeconds\` is GET-only: `
                + 'it becomes a `Cache-Control` header on a successful response, and a '
                + 'non-GET answer is not a cacheable representation, so the key would be parsed and never '
                + 'take effect. Remove `cacheTtlSeconds`, or declare the endpoint as GET if it really is a read.',
        };
    }

    return undefined;
}

// ============================================================================
// (f) The anonymous door × elevated flow — ADR-0138 D2b
// ============================================================================
//
// `policyGate` above reads ONE endpoint. D2b is a property of a PAIR — an
// `authRequired: false` endpoint of `type: 'flow'` and the flow its `target`
// names, refused when that flow declares `runAs: 'system'` — so it cannot be a
// member of `firstFailure`: no single declaration carries both halves. The
// judge below is the one cross-item reading, and every publish door that holds
// both items calls it (ADR-0138 D2b, "Enforced by": "The cross-item read sits
// where both items are readable at publish, beside the per-endpoint …
// `policyGate`, which reads one endpoint only"):
//
// | door | what it holds | direction |
// |---|---|---|
// | the stack parse (`ObjectStackDefinitionSchema` → `applyApiEndpointGates`) | the stack's `apis` and `flows` together | both, as one input |
// | `MetadataManager.publishPackage` (`@objectstack/metadata`) | the package's `api` and `flow` items, and the manager's index of both | both |
// | the metadata protocol's flow publish (`saveMetaItem` in publish mode, the draft promotion) | the flow being published, and the declared endpoints | a flow set to `system` |
//
// Both directions, because either item can be the last one edited: the
// endpoint's publish reads its target's `runAs`, and a flow's publish that sets
// `runAs: 'system'` reads the anonymous endpoints that target it.
//
// ⛔ Not a mirror of a runtime refusal, unlike the gates above. The endpoint
// executor's `flowStartRefusal` refuses a non-system caller
// for a SELF-TRIGGERED `system` flow (`autolaunched`, `record_change`,
// `schedule`) and for a flow whose `requiredPermissions` it does not hold; a
// `system` flow of type `api` or `screen` declaring none, behind an anonymous
// endpoint, executes, elevated. The record places D2b at publish, and this is
// that refusal.
//
// The prescription is the record's, scenario by scenario: an authenticated
// endpoint for a partner that can hold a credential, the signed inbound-hook
// channel (ADR-0041) for a partner webhook, a public form for anonymous intake.
// `runAs: 'automation'` joins it when ADR-0073 M2 lands; until then the enum
// has no such value, and prescribing it would send an author to a key value the
// schema refuses.
//
// Out of scope by the record's own words ("recorded and not decided"): a
// guest-written row firing a record-change flow. The trigger there is the write,
// not the door.

/**
 * What the D2b judge reads of an endpoint. A parsed {@link ApiEndpoint}
 * satisfies it, and so does a stored body read as it sits: each field is read
 * structurally and only the exact value counts, so an absent `authRequired`
 * (whose schema default is `true`) is never anonymous.
 */
export interface AnonymousFlowDoorCandidate {
    readonly name?: unknown;
    readonly type?: unknown;
    readonly authRequired?: unknown;
    readonly target?: unknown;
}

/**
 * What the D2b judge reads of a flow: its `name`, and its declared `runAs`
 * (absent reads as the schema default, `'user'`).
 */
export interface ElevatedFlowCandidate {
    readonly name?: unknown;
    readonly runAs?: unknown;
}

/** One refused pair: an anonymous flow endpoint and the `runAs: 'system'` flow it triggers. */
export interface AnonymousElevatedFlowPair {
    /** Index into the `endpoints` the judge was handed. */
    endpointIndex: number;
    /** The endpoint's `name`, or `apis[<index>]` when it carries none. */
    endpoint: string;
    /** Index into the `flows` the judge was handed. */
    flowIndex: number;
    /** The flow's `name`, which is the endpoint's `target`. */
    flow: string;
}

/**
 * The flow an endpoint opens to an anonymous caller: its `target`, when the
 * endpoint is `type: 'flow'` with `authRequired: false` and names a target;
 * otherwise `undefined`.
 */
export function anonymousFlowDoorTarget(
    endpoint: AnonymousFlowDoorCandidate | null | undefined,
): string | undefined {
    if (!endpoint || typeof endpoint !== 'object') return undefined;
    if (endpoint.type !== 'flow' || endpoint.authRequired !== false) return undefined;
    return typeof endpoint.target === 'string' && endpoint.target !== '' ? endpoint.target : undefined;
}

/**
 * ADR-0138 D2b, the cross-item judge: every pair of an anonymous flow endpoint
 * (see {@link anonymousFlowDoorTarget}) and a flow of that name declaring
 * `runAs: 'system'`.
 *
 * Pure, total and order-preserving (endpoint order, then flow order). The
 * caller decides which half it is publishing and words the refusal for that
 * half: {@link anonymousEndpointElevatedFlowMessage} when the endpoint is the
 * item being published, {@link elevatedFlowAnonymousEndpointsMessage} when the
 * flow is.
 */
export function anonymousElevatedFlowPairs(
    endpoints: readonly (AnonymousFlowDoorCandidate | null | undefined)[] | undefined,
    flows: readonly (ElevatedFlowCandidate | null | undefined)[] | undefined,
): AnonymousElevatedFlowPair[] {
    if (!endpoints || endpoints.length === 0 || !flows || flows.length === 0) return [];

    /** flow name → the indexes of the `system` flows of that name. */
    const elevated = new Map<string, number[]>();
    for (let flowIndex = 0; flowIndex < flows.length; flowIndex++) {
        const flow = flows[flowIndex];
        if (!flow || typeof flow !== 'object' || flow.runAs !== 'system') continue;
        if (typeof flow.name !== 'string' || flow.name === '') continue;
        const indexes = elevated.get(flow.name);
        if (indexes) indexes.push(flowIndex);
        else elevated.set(flow.name, [flowIndex]);
    }
    if (elevated.size === 0) return [];

    const pairs: AnonymousElevatedFlowPair[] = [];
    for (let endpointIndex = 0; endpointIndex < endpoints.length; endpointIndex++) {
        const endpoint = endpoints[endpointIndex];
        const target = anonymousFlowDoorTarget(endpoint);
        const flowIndexes = target === undefined ? undefined : elevated.get(target);
        if (!flowIndexes) continue;
        const name = typeof endpoint?.name === 'string' && endpoint.name !== ''
            ? endpoint.name
            : `apis[${endpointIndex}]`;
        for (const flowIndex of flowIndexes) {
            pairs.push({ endpointIndex, endpoint: name, flowIndex, flow: target! });
        }
    }
    return pairs;
}

/**
 * The record's prescription, one serving channel per scenario. Short on
 * purpose: a 4xx message crosses the REST boundary with its tail truncated, so
 * the prescription comes before the reason in both sentences below.
 */
const ANONYMOUS_ELEVATED_FLOW_PRESCRIPTION =
    'an authenticated endpoint (`authRequired: true`) for a partner that can hold a credential, the flow\'s '
    + 'signed inbound hook (ADR-0041) for a partner webhook, or a public form for anonymous intake';

const ANONYMOUS_ELEVATED_FLOW_REASON =
    "Behind an anonymous door a `runAs: 'system'` flow would run every request's data steps as the system "
    + 'principal, past row-level security, with the rate limit as its only brake.';

/**
 * D2b's refusal when the ENDPOINT is the item being published (the stack
 * parse, a package publish): it names the endpoint, the flow and the
 * prescription.
 */
export function anonymousEndpointElevatedFlowMessage(endpoint: string, flow: string): string {
    return `Endpoint '${endpoint}' is anonymous (\`authRequired: false\`) and triggers flow '${flow}', which `
        + "declares `runAs: 'system'`: no anonymous door may start an elevated flow (ADR-0138 D2b), so publish "
        + 'refuses the pair whichever of the two is published last. Serve that caller with '
        + `${ANONYMOUS_ELEVATED_FLOW_PRESCRIPTION}. ${ANONYMOUS_ELEVATED_FLOW_REASON}`;
}

/**
 * D2b's refusal when the FLOW is the item being published with
 * `runAs: 'system'` while anonymous endpoints name it (the metadata protocol's
 * flow publish, a package publish whose flow an endpoint outside it names).
 *
 * @param endpoints the anonymous endpoints' names, at least one.
 */
export function elevatedFlowAnonymousEndpointsMessage(flow: string, endpoints: readonly string[]): string {
    const quoted = endpoints.map((name) => `'${name}'`);
    const triggers = quoted.length === 1
        ? `the anonymous endpoint ${quoted[0]} (\`authRequired: false\`) triggers it`
        : `the anonymous endpoints ${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]} `
          + '(`authRequired: false`) trigger it';
    return `Flow '${flow}' cannot be published with \`runAs: 'system'\`: ${triggers}, and no anonymous door may `
        + 'start an elevated flow (ADR-0138 D2b). Nothing was published. Serve that caller with '
        + `${ANONYMOUS_ELEVATED_FLOW_PRESCRIPTION} first. ${ANONYMOUS_ELEVATED_FLOW_REASON}`;
}

/**
 * D2b over one stack's `apis` and `flows` — the stack parse's leg, raised as
 * Zod issues by `applyApiEndpointGates`. One issue per refused pair, located at
 * the endpoint's `authRequired` (`['apis', <index>, 'authRequired']`): both
 * items are in the one input, so the stack is refused whichever of the two its
 * author edited last, and the issue sits on the door, which is what the
 * prescription changes.
 *
 * Independent of {@link validateApiEndpointDeclarations}'s per-endpoint
 * first-failure order: a pair is a fact about two declarations, never a
 * cascade of another gate's failure, so an anonymous endpoint that also lacks
 * its armed budget (ADR-0121 D6) is reported for both.
 */
export function validateAnonymousElevatedFlows(
    endpoints: readonly (AnonymousFlowDoorCandidate | null | undefined)[] | undefined,
    flows: readonly (ElevatedFlowCandidate | null | undefined)[] | undefined,
): EndpointGateIssue[] {
    return anonymousElevatedFlowPairs(endpoints, flows).map((pair) => ({
        path: ['apis', pair.endpointIndex, 'authRequired'],
        message: anonymousEndpointElevatedFlowMessage(pair.endpoint, pair.flow),
    }));
}

// ============================================================================
// (d) Uniqueness — one stack, one claim per METHOD + normalized path
// ============================================================================

function uniquenessGate(
    endpoint: ApiEndpoint,
    named: string,
    at: (...rest: (string | number)[]) => (string | number)[],
    claims: Map<string, { index: number; name: string }>,
): EndpointGateIssue | undefined {
    const key = claimKey(endpoint);
    const first = claims.get(key);
    if (!first) return undefined;

    return {
        path: at('path'),
        message:
            `${named} claims ${endpoint.method} ${endpoint.path}, already claimed by endpoint `
            + `'${first.name}' (apis[${first.index}]). One stack cannot declare the same METHOD and path `
            + 'twice: the matcher indexes exactly one endpoint per claim, so only the lexicographically '
            + 'first name would ever serve and the other would be dead metadata. Paths are compared with '
            + 'one trailing slash trimmed, the same rule the matcher applies — \'/x\' and \'/x/\' are the '
            + 'same claim. Give one of them a different path or method, or delete the one you do not want.',
    };
}
