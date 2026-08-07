// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The MAPPING KEYS of a declarative `apis:` endpoint (#5040 E5c / #5137).
 *
 * `inputMapping` / `outputMapping` were declared by `ApiEndpointSchema` and read
 * by nothing: an author could write them, publish would accept them, and the
 * endpoint would run as if they were absent. That is the "parsed, then nothing
 * happens" middle state #5040 exists to end and the textbook ADR-0049
 * `declared ≠ enforced` shape — and it is worst for AI-authored metadata, where
 * a key that is silently ignored produces no signal at all and the mistake
 * stays in the app. This module is the enforcement.
 *
 * ## The vocabulary is the whole specification
 *
 * The vocabulary is FROZEN (#5040), so what these keys mean is exactly what
 * `packages/spec/src/api/endpoint.zod.ts` says and nothing more:
 *
 * | declaration | `.describe()` |
 * |---|---|
 * | `inputMapping` | *Map Request Body to Internal Params* |
 * | `outputMapping` | *Map Internal Result to Response Body* |
 * | `ApiMapping.source` | *Source field/path* |
 * | `ApiMapping.target` | *Target field/path* |
 * | `ApiMapping.transform` | *Transformation function name — NOT EXECUTED in 17.x, and publish REJECTS the key: there is no transformation-function registry anywhere in the platform, so it stays in the frozen vocabulary and is refused rather than parsed and ignored (#5040 E7). A mapping entry moves and renames fields by dot path and nothing more — shape the value where it is produced instead (a flow endpoint whose flow computes it, or a formula field on the object)* |
 *
 * Five short sentences, and everything below is the MINIMAL faithful reading of
 * them — `transform`'s now says out loud, at the point of authoring, what this
 * module and the E7 publish gate have always answered at rejection time (#6065).
 * Where the text is silent this module takes the least expressive option
 * available and says so here, because the alternative — inventing expression
 * power (a template language, JSONPath, wildcards, conditionals) — would put a
 * dialect in the runtime that no contract declares and no publish gate can
 * check. Each choice below is a place a later vocabulary decision can WIDEN
 * without breaking a declaration that works today; none of them can be narrowed
 * later, which is why the narrow reading is the safe one.
 *
 * ### 1. A mapping is a PROJECTION, not a merge
 *
 * The result is built from the declared `target` paths alone: an undeclared
 * field of the source does not ride along. That is what "map A to B" says, it is
 * what the vocabulary's own example does (`firstName` → `first_name`,
 * `user.profile.email` → `contact.email` — `endpoint.test.ts`), and on the
 * outbound side it makes `outputMapping` an allow-list, which is the property an
 * external integration surface (ADR-0121 D3: `apis` = the platform's OUTWARD
 * face) actually wants. A merge would leak every internal field the pipeline
 * happened to return, forever, by default.
 *
 * ### 2. `source` reads the REQUEST BODY — not the query string
 *
 * `inputMapping` says *Map **Request Body** to Internal Params*, so the body is
 * what `source` resolves against. #5137's suggested scope (and #5040 §3.4)
 * floated `{...query, ...body}` instead; that is not implemented here, on
 * purpose. Merging the two invents a precedence rule between them that no text
 * states — and a silent precedence rule is exactly the sort of thing an author
 * discovers by having a request behave differently than it reads. Query
 * parameters keep reaching the executor untouched, as they always have; if the
 * maintainer decides mapping should see them too, adding a source is a
 * compatible widening of this reading, whereas removing one would break
 * declarations.
 *
 * ### 3. `source` / `target` are dot-separated paths, and nothing else
 *
 * "field/path" is read as `a.b.c`: split on `.`, own properties only (so a path
 * can never reach an inherited member), array indices addressed by their
 * numeric key (`records.0.id`). No wildcards, no filters, no `$`-syntax, no
 * escaping — a key that genuinely contains a dot is not addressable, which is a
 * limit of the vocabulary rather than a licence to design one here.
 *
 * ### 4. A `source` that resolves to nothing leaves its `target` UNSET
 *
 * The mapping is a projection, not a validator: an absent optional field
 * produces an absent target rather than an explicit `null`/`undefined` key or a
 * rejected request. Inventing a required-ness rule here would be a second,
 * weaker copy of validation that the target pipeline already performs with the
 * object's own field metadata.
 *
 * ### 5. An absent (or empty) key is byte-for-byte passthrough
 *
 * No declaration ⇒ the very same value flows on, by reference. This is what
 * keeps E5b's behavior unchanged for every endpoint that declares no mapping,
 * and it is pinned by tests on both sides of the seam.
 *
 * ## What this module REFUSES, loudly
 *
 * A declaration it cannot serve gets a structured 501 `NOT_IMPLEMENTED` naming
 * the exact entry and key — never a silent skip, never a "best effort" partial
 * application. The status and the code deliberately match
 * `endpoint-executor.ts`'s `unsupported` arm: this is the same category of
 * answer (a declaration inside the frozen vocabulary that 17.x does not
 * execute), and the caller is not at fault, so blaming the request with a 4xx
 * would misreport whose defect it is. The refused set:
 *
 *  - **`transform`** — there is no "transformation function name" registry
 *    anywhere in this repo, and inventing one is a sandboxing decision, not a
 *    mapping detail (the same reasoning that makes `stack.zod.ts`'s namesake a
 *    build-time failure, framework#2611). #5040 §3.4 keeps it rejected at
 *    publish; this is the runtime backstop for a declaration that reached the
 *    store some other way (a direct `metadata.register()`).
 *  - **an unusable path** — empty, an empty segment (`a..b`), or a JavaScript
 *    prototype key (`__proto__` / `prototype` / `constructor`), which must never
 *    be walkable on either side.
 *  - **colliding targets** — two entries writing the same path, or one writing
 *    INSIDE another's target, where the later would silently discard the
 *    earlier.
 *
 * Every one of those belongs in the same "unsupported subset" the E7 publish
 * gate (#5111) rejects with a prescription, so an author meets the error while
 * writing the app rather than while serving a request. This module is the
 * backstop, not the primary gate — but it must never be the *silent* one.
 *
 * ## Pure by construction
 *
 * Functions of their arguments: no service lookup, no kernel, no I/O, no
 * mutation of anything the caller passed in. The application point — after the
 * policy pass, before delegation, and on a SUCCESS body only — lives in
 * `api-endpoint-step.ts`, which is also where the rule that an error answer is
 * never remapped is enforced (a mapping must not be able to dress a failure up
 * as data).
 */

import { DispatcherErrorCode } from '@objectstack/spec/api';
import type { ApiEndpoint } from '@objectstack/spec/api';
import { apiErrorResponse } from './error-envelope.js';

/** The two mapping keys, spelled as the vocabulary spells them. */
export type EndpointMappingKey = 'inputMapping' | 'outputMapping';

/** One declared mapping entry (`ApiMappingSchema`). */
interface ApiMappingEntry {
    source: string;
    target: string;
    transform?: string;
}

/**
 * A structured refusal, in the shape the step writes straight to the wire —
 * built by the one envelope builder, never assembled here.
 */
export interface EndpointMappingRejection {
    status: number;
    body: unknown;
}

/** Either a mapped value, or the refusal to answer with. */
export type EndpointMappingOutcome<T> =
    | { ok: true; value: T }
    | { ok: false; rejection: EndpointMappingRejection };

/**
 * Path segments this runtime refuses to walk or write, on either side of a
 * mapping. `__proto__` and friends are how a data-driven `set` turns into
 * prototype pollution; a declaration is not a trusted enough source to allow
 * them (an app's metadata is increasingly AI-written), and no legitimate
 * mapping needs them.
 */
const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

// ============================================================================
// Paths
// ============================================================================

/** Split a declared path, or `undefined` when it is not a usable one. */
function splitPath(path: string): string[] | undefined {
    if (typeof path !== 'string' || path === '') return undefined;
    const segments = path.split('.');
    for (const segment of segments) {
        if (segment === '' || UNSAFE_PATH_SEGMENTS.has(segment)) return undefined;
    }
    return segments;
}

/**
 * Read a dot path off a value.
 *
 * Own properties only: a mapping must not be able to reach `toString` or any
 * other inherited member, and "the field is absent" and "the prototype has one
 * of that name" must not answer the same.
 */
function readPath(source: unknown, segments: string[]): unknown {
    let current: unknown = source;
    for (const segment of segments) {
        if (current === null || typeof current !== 'object') return undefined;
        if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
        current = (current as Record<string, unknown>)[segment];
    }
    return current;
}

/**
 * Write a dot path into the projection under construction.
 *
 * Intermediate objects are created as needed. It never has to overwrite one it
 * did not create: colliding targets are refused at declaration level
 * ({@link mappingDeclarationRejection}), so the defensive branch below cannot
 * be reached through this module's own entry points — it is there so a future
 * caller cannot make silent data loss out of a partially built object.
 */
function writePath(target: Record<string, unknown>, segments: string[], value: unknown): void {
    let current = target;
    for (let i = 0; i < segments.length - 1; i++) {
        const segment = segments[i]!;
        const next = current[segment];
        if (next === null || typeof next !== 'object' || Array.isArray(next)) {
            current[segment] = {};
        }
        current = current[segment] as Record<string, unknown>;
    }
    current[segments[segments.length - 1]!] = value;
}

// ============================================================================
// Declarations
// ============================================================================

/** The entries declared under one key — `[]` when the key is absent. */
function entriesOf(endpoint: ApiEndpoint, key: EndpointMappingKey): ApiMappingEntry[] {
    const declared = endpoint[key];
    return Array.isArray(declared) ? (declared as ApiMappingEntry[]) : [];
}

/** The one refusal shape, so every branch here answers identically. */
function reject(message: string, hint: string): EndpointMappingRejection {
    return apiErrorResponse({
        code: DispatcherErrorCode.enum.NOT_IMPLEMENTED,
        httpStatus: 501,
        message,
        extra: { hint },
    });
}

const PATH_HINT =
    "`source` and `target` are dot-separated field paths ('user.profile.email'). An empty path, an empty "
    + "segment ('a..b') and the JavaScript prototype keys (__proto__, prototype, constructor) are refused; "
    + 'the publish gate rejects the same shapes (#5040 E7).';

/**
 * Whether this runtime can serve a key's declaration AT ALL — data-independent,
 * so the answer is the same for every request and can be taken BEFORE anything
 * is executed.
 *
 * That ordering is the point for `outputMapping`: validating it only when the
 * result arrives would let a `create` endpoint with a broken projection insert
 * the record and THEN refuse to answer, which is the worst of both outcomes.
 * The step therefore takes this verdict before it delegates.
 *
 * Returns `undefined` when the declaration is servable (including when there is
 * none).
 */
export function mappingDeclarationRejection(
    endpoint: ApiEndpoint,
    key: EndpointMappingKey,
): EndpointMappingRejection | undefined {
    const entries = entriesOf(endpoint, key);
    const targets: Array<{ index: number; path: string; segments: string[] }> = [];

    for (let index = 0; index < entries.length; index++) {
        const entry = entries[index]!;
        const at = `${key}[${index}]`;

        if (entry.transform !== undefined) {
            return reject(
                `Endpoint '${endpoint.name}' declares ${at}.transform ('${entry.transform}'), which this runtime `
                + 'does not execute.',
                'A mapping entry moves and renames fields by dot path; there is no transformation-function '
                + "registry in this runtime, so `transform` is rejected at publish (#5040 §3.4, E7) rather than "
                + 'parsed and ignored. Drop the key, or shape the value where it is produced.',
            );
        }

        const sourceSegments = splitPath(entry.source);
        if (!sourceSegments) {
            return reject(
                `Endpoint '${endpoint.name}' declares ${at}.source '${entry.source}', which is not a usable `
                + 'field path.',
                PATH_HINT,
            );
        }

        const targetSegments = splitPath(entry.target);
        if (!targetSegments) {
            return reject(
                `Endpoint '${endpoint.name}' declares ${at}.target '${entry.target}', which is not a usable `
                + 'field path.',
                PATH_HINT,
            );
        }

        const collision = targets.find((seen) => isPathPrefix(seen.segments, targetSegments)
            || isPathPrefix(targetSegments, seen.segments));
        if (collision) {
            return reject(
                `Endpoint '${endpoint.name}' declares ${at}.target '${entry.target}', which collides with `
                + `${key}[${collision.index}].target '${collision.path}'.`,
                'Two mapping entries cannot write the same target path, and neither can write inside the '
                + "other's — one of them would silently discard the other. Give each entry a distinct target.",
            );
        }

        targets.push({ index, path: entry.target, segments: targetSegments });
    }

    return undefined;
}

/** Whether `a` is `b` or an ancestor of it (`['a']` vs `['a','b']`). */
function isPathPrefix(a: string[], b: string[]): boolean {
    if (a.length > b.length) return false;
    return a.every((segment, i) => b[i] === segment);
}

// ============================================================================
// Application
// ============================================================================

/** Project a source value through validated entries. */
function project(entries: ApiMappingEntry[], source: unknown): Record<string, unknown> {
    const projected: Record<string, unknown> = {};
    for (const entry of entries) {
        const value = readPath(source, splitPath(entry.source)!);
        // Absent source ⇒ absent target. See §4 of the module note: a mapping
        // projects, it does not assert that a field was supplied.
        if (value === undefined) continue;
        writePath(projected, splitPath(entry.target)!, value);
    }
    return projected;
}

/**
 * `inputMapping` — the request body the target pipeline will see.
 *
 * With no declaration the caller's own body is returned BY REFERENCE, so a
 * request to an endpoint that declares no mapping is delegated exactly as it
 * was before this module existed.
 */
export function applyInputMapping(endpoint: ApiEndpoint, body: unknown): EndpointMappingOutcome<unknown> {
    const entries = entriesOf(endpoint, 'inputMapping');
    if (entries.length === 0) return { ok: true, value: body };

    const rejection = mappingDeclarationRejection(endpoint, 'inputMapping');
    if (rejection) return { ok: false, rejection };

    return { ok: true, value: project(entries, body) };
}

/**
 * `outputMapping` — the response body for a SUCCESSFUL execution.
 *
 * Takes the success body as the executor built it and returns one with its
 * PAYLOAD projected: `data` when the body is the standard `{ success, data,
 * meta }` envelope (`successAnswer`, `endpoint-executor.ts`), the body itself
 * otherwise. Every other member rides through untouched — a mapping projects
 * the result, it can never rewrite the envelope, drop `success`, or make an
 * answer that is not the declared shape.
 *
 * Applying this to an ERROR body is not prevented here but never happens: the
 * caller applies it on success only (`api-endpoint-step.ts`), because a mapping
 * that could reshape a failure into data would be able to hide it.
 */
export function applyOutputMapping(endpoint: ApiEndpoint, successBody: unknown): EndpointMappingOutcome<unknown> {
    const entries = entriesOf(endpoint, 'outputMapping');
    if (entries.length === 0) return { ok: true, value: successBody };

    const rejection = mappingDeclarationRejection(endpoint, 'outputMapping');
    if (rejection) return { ok: false, rejection };

    if (successBody !== null && typeof successBody === 'object' && !Array.isArray(successBody)
        && Object.prototype.hasOwnProperty.call(successBody, 'data')) {
        const envelope = successBody as Record<string, unknown>;
        return { ok: true, value: { ...envelope, data: project(entries, envelope.data) } };
    }

    return { ok: true, value: project(entries, successBody) };
}
