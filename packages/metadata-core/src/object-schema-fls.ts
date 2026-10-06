// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0106] Metadata-plane field-level security — the **one** projection every
 * object-schema exit runs before it answers (objectstack#3682, from #3661 ③).
 *
 * ## What this closes
 *
 * The data plane enforces FLS everywhere it matters: list reads mask values,
 * exports project columns (#3547), and the write path 403s forbidden fields.
 * The metadata plane did not — `GET /meta/object/:name`, `GET /meta/object` and
 * the runtime `/metadata` catch-all shipped the **full** object schema to any
 * authenticated caller. That is not merely field names: a field carries its
 * label, type, picklist option values, `formula` expression, `visibleWhen`
 * predicate, `defaultValue`, and — via ADR-0066 D3 — the `requiredPermissions`
 * capability names guarding it. ADR-0106 D1 removes an unreadable field
 * **whole**; partial redaction still leaks existence and invites clients to
 * render ghost columns.
 *
 * ## Why the shared normalizer lives here
 *
 * Same criterion as {@link applyAuditFieldGovernance} (#4513) and the two
 * engine dispatch predicates (#5619): the exits are spread across
 * `@objectstack/rest` (three) and `@objectstack/runtime` (four), and a
 * per-route copy of the projection is the drift this repo keeps paying for —
 * ADR-0106 D5 says so in as many words ("every schema-serving outlet, or the
 * mask is decoration"). `@objectstack/metadata-core` depends on
 * `{ @objectstack/spec, zod }` only, so both dispatch packages can import it
 * with no new edge and no cycle.
 *
 * ## The shape of one exit
 *
 * ```ts
 * const posture = await resolveObjectSchemaMaskPosture({ objectName, context, security, enabled });
 * const masked  = applyObjectSchemaMask(document, await relateObjectSchemaMaskPosture(posture, document));
 * //             fetch → relate → mask → send
 * ```
 *
 * The relate step (#21884) asks the same caller's question about the OTHER
 * objects the fetched document's action params read through `objectOverride` —
 * only the document names them, so it runs after the fetch. It is a no-op for
 * every posture but `project` and every document without such a read.
 *
 * `resolveObjectSchemaMaskPosture` is where ADR-0106 D6's three-tier failure
 * posture is decided, ONCE, so no exit can invent a fourth answer:
 *
 * | Condition | Posture | Wire effect |
 * |---|---|---|
 * | masking disabled (D8 escape hatch) / no `security` service / exempt caller (D4) | `passthrough` | serve unmasked, byte-identical to pre-ADR |
 * | `getReadableFields` → `undefined` (field universe unresolvable) | `undetermined` | serve unmasked + structured warn + metric + `Cache-Control: private, no-store`, **no shared ETag** |
 * | `getReadableFields` throws | throws {@link ObjectSchemaMaskEvaluationError} | the exit answers 5xx — never the unmasked body, never an empty-fields 200 |
 * | otherwise | `project` | fields ∉ readable are deleted whole, references included |
 *
 * ## D3 — mask AFTER the cache, fingerprint the ETag
 *
 * The shared metadata cache keeps storing ONE full schema per
 * (type, name, locale, environment) — no caller dimension in the key, so cache
 * storage stays O(objects) rather than O(users × objects). What varies per
 * caller is the **validator**: {@link objectFieldVisibilityFingerprint} hashes
 * the caller's *denied* set and {@link foldVisibilityFingerprintIntoEtag} folds
 * it into the ETag. An unrestricted caller denies nothing, so the fingerprint
 * is the empty string and the ETag is byte-identical to today's; callers in one
 * permission cohort share 304s; a permission change moves the fingerprint and
 * self-invalidates the stale 304.
 */

import { maskDeniedFieldReferences, objectOverrideReads } from './object-schema-fls-references.js';

/**
 * [#6603 / ADR-0066 D1] The capabilities that let a caller **write** an object
 * schema — the authoritative set, from which the D4 read exemption below is
 * derived.
 *
 * The gate itself is spelled at eight sites (`packages/rest/src/rest-server.ts`
 * ×4, `packages/runtime/src/domains/meta.ts` ×2, and the two `/packages` write
 * transports); this constant is the same key named ONCE so the read side can
 * reference it instead of re-spelling it. Changing the write gate's key without
 * changing this constant is the drift #7020 measured — see below.
 */
export const OBJECT_SCHEMA_WRITE_CAPABILITIES: readonly string[] = ['manage_metadata'];

/**
 * [ADR-0106 D4] Capabilities that exempt a caller from the mask **without**
 * granting them schema writes — the named read-only exemptions.
 *
 * These are exactly the two the `app` filter treats as "builder" — Studio and
 * Setup authoring cannot work against a projected schema, and draft/preview
 * reads are admin-gated upstream already.
 *
 * Kept as an explicit list rather than derived, because the #7020 measurement
 * found real principals here that hold no write capability and are meant not to:
 * `organization_admin` / `organization_admin_no_bypass` (`setup.access`, with
 * `manage_metadata` withheld in as many words at
 * `plugin-security/src/objects/default-permission-sets.ts:139-142`) and the
 * showcase `showcase_ops` operations persona. Whether those stay exempt is the
 * follow-up ruling #7020 leaves open; until it lands, nobody's current read
 * access is narrowed.
 *
 * This is ALSO the `/packages` read cohort (#7033 / #7023) — `package-routes.ts`
 * and `domains/packages.ts` import it by this name. That gate was ruled
 * separately and is deliberately NOT the union below.
 */
export const OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES: readonly string[] = ['studio.access', 'setup.access'];

/**
 * The `systemPermissions` capabilities that exempt a caller from the mask
 * (ADR-0106 D4) — **derived**, never hand-kept.
 *
 * #7020 measured the two sets this platform actually had: the #6603 write gate
 * (`manage_metadata`) and this exemption list (`studio.access` / `setup.access`)
 * were disjoint apart from `admin_full_access` carrying all three, so
 * #6603's stated rationale — *"whoever can write a schema is whoever can see
 * the full schema"* — held only by that coincidence. A `manage_metadata`-only
 * caller passed every write gate and still read a PROJECTED schema, which is
 * precisely the GET → edit → PUT round trip that deletes the fields the caller
 * could not see.
 *
 * The maintainer's 2026-08-10 ruling makes the write gate authoritative and this
 * list a derivation of it, so the invariant holds **by construction**: the union
 * cannot drift from the write gate, because it is not written down twice.
 *
 * The derivation is one-directional on purpose — can-write implies can-see-all;
 * it does not imply can-see-all requires can-write. The read-only exemptions
 * above are preserved verbatim pending their follow-up ruling.
 *
 * The exemption is a **caller** property, not a route property: an exempt caller
 * hitting the public route gets the full schema, and a non-exempt caller gets
 * the projection on every route.
 */
export const OBJECT_SCHEMA_MASK_EXEMPT_CAPABILITIES: readonly string[] = [
    ...OBJECT_SCHEMA_WRITE_CAPABILITIES,
    ...OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES,
];

/**
 * Environment escape hatch for ADR-0106 D8 — a deployment that explicitly wants
 * an unmasked metadata plane.
 *
 * Named per AGENTS.md Prime Directive #9's "escape hatch / dangerous override"
 * shape (`OS_ALLOW_{X}`): deliberately ungrouped and scary-looking, because
 * turning it on re-opens a disclosure hole on purpose.
 */
export const OBJECT_SCHEMA_MASK_DISABLE_ENV = 'OS_ALLOW_UNMASKED_OBJECT_METADATA';

/** Why an exit is serving the document unprojected. */
export type ObjectSchemaMaskPassthroughReason =
    /** ADR-0106 D8 — the deployment opted out. */
    | 'disabled'
    /** ADR-0106 D6 tier 1 — no `security` service at all; the deployment has no FLS posture. */
    | 'no-service'
    /** ADR-0106 D4 — `isSystem` or a platform-admin caller. */
    | 'exempt'
    /** Not an object schema (no `fields` map to project). */
    | 'not-applicable';

/**
 * The decision {@link resolveObjectSchemaMaskPosture} reaches for one caller ×
 * one object, BEFORE the document is fetched.
 */
export type ObjectSchemaMaskPosture =
    | { kind: 'passthrough'; reason: ObjectSchemaMaskPassthroughReason }
    /** ADR-0106 D6 tier 2 — `getReadableFields` could not answer. */
    | { kind: 'undetermined' }
    | {
        kind: 'project';
        readable: ReadonlySet<string>;
        /**
         * [#21884] The same caller's readable fields on each OTHER object the
         * document's action params read through `objectOverride` — filled AFTER
         * the fetch by {@link relateObjectSchemaMaskPosture}, because only the
         * document says which objects those are. `undefined` for an object
         * whose set could not be determined. An object missing from the map
         * (or no map at all) reads the same way: a param reading it drops its
         * action — fail closed, never served on a guess.
         */
        related?: ReadonlyMap<string, ReadonlySet<string> | undefined>;
        /**
         * [#21884] This posture's own question — same caller, same service —
         * asked about another object: its readable fields, or `undefined` when
         * they cannot be determined. Set by
         * {@link resolveObjectSchemaMaskPosture}; read by
         * {@link relateObjectSchemaMaskPosture}. A posture without it relates
         * nothing.
         */
        relate?: (objectName: string) => Promise<ReadonlySet<string> | undefined>;
    };

/** A posture that serves the document unchanged and needs no fingerprint. */
export const OBJECT_SCHEMA_MASK_NOT_APPLICABLE: ObjectSchemaMaskPosture =
    { kind: 'passthrough', reason: 'not-applicable' };

/**
 * ADR-0106 D6 tier 3 — the security service **threw** while evaluating the
 * caller's readable set.
 *
 * An unhealthy security service must not auto-open a disclosure hole, and the
 * only safe closed form is an error: visible, retryable, never cached. Exits
 * translate this to 5xx. They must never fall back to the unmasked body (D3's
 * fetch → mask → send ordering is what makes that impossible) and never answer
 * an empty-fields 200, which is both a silently wrong UI and cacheable poison.
 */
export class ObjectSchemaMaskEvaluationError extends Error {
    readonly objectName: string;
    /** The error the security service threw, kept for the operator-side log. */
    readonly evaluationError: unknown;

    constructor(objectName: string, evaluationError?: unknown) {
        super(
            `[ADR-0106] Field visibility for object '${objectName}' could not be evaluated; `
            + 'refusing to serve the object schema rather than disclose unmasked fields.',
        );
        this.name = 'ObjectSchemaMaskEvaluationError';
        this.objectName = objectName;
        this.evaluationError = evaluationError;
    }
}

/**
 * Is per-caller object-schema masking on for this deployment (ADR-0106 D8)?
 *
 * Default **on** — masking is the platform default and ships with the current
 * major. `configured === false` (the REST layer's `metadata.maskObjectFields`)
 * or {@link OBJECT_SCHEMA_MASK_DISABLE_ENV} opts out.
 *
 * @param configured Per-server config value, when the exit has one.
 * @param env Environment bag; defaults to `process.env` where one exists.
 */
export function isObjectSchemaMaskingEnabled(
    configured?: boolean,
    env?: Record<string, string | undefined>,
): boolean {
    if (configured === false) return false;
    const bag = env ?? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    const raw = bag?.[OBJECT_SCHEMA_MASK_DISABLE_ENV];
    if (typeof raw === 'string' && raw.trim() !== '' && raw.trim() !== '0' && raw.trim().toLowerCase() !== 'false') {
        return false;
    }
    return true;
}

/**
 * Is this caller exempt from the mask (ADR-0106 D4)?
 *
 * `isSystem` (which `getReadableFields` already bypasses) plus any caller in
 * {@link OBJECT_SCHEMA_MASK_EXEMPT_CAPABILITIES} — i.e. anyone the #6603 write
 * gate admits ({@link OBJECT_SCHEMA_WRITE_CAPABILITIES}) OR one of the named
 * read-only exemptions ({@link OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES}),
 * judged by the same `systemPermissions` reading the `app` filter uses.
 *
 * The write half is what makes "whoever can write a schema can see all of it"
 * true by construction rather than by two lists staying coincidentally equal
 * (#7020's ruling); it is also what keeps a masked read from being PUT back
 * verbatim and silently deleting the invisible fields.
 */
export function isObjectSchemaMaskExempt(context: unknown): boolean {
    if (!context || typeof context !== 'object') return false;
    const ctx = context as { isSystem?: unknown; systemPermissions?: unknown };
    if (ctx.isSystem === true) return true;
    if (!Array.isArray(ctx.systemPermissions)) return false;
    return ctx.systemPermissions.some(
        (p) => typeof p === 'string' && OBJECT_SCHEMA_MASK_EXEMPT_CAPABILITIES.includes(p),
    );
}

/**
 * The `security` service surface this projection consumes.
 *
 * Deliberately structural and all-optional: the service is absent in
 * deployments without `plugin-security`, and a partial implementation must
 * degrade rather than lie (the contract's own feature-detection rule).
 */
export interface ObjectSchemaMaskSecuritySurface {
    /** #3547 — the authoritative readable-column set; `undefined` = no answer. */
    getReadableFields?(object: string, context?: unknown): Promise<string[] | undefined> | string[] | undefined;
    /**
     * [ADR-0106 D7] The metadata-plane variant: identical to
     * {@link getReadableFields} except that a caller resolving to **zero**
     * permission sets goes through the same fallback-set resolution
     * `/auth/me/permissions` uses, instead of falling open to the full field
     * set. Preferred when present; exits fall back to `getReadableFields`.
     */
    getMetadataReadableFields?(object: string, context?: unknown): Promise<string[] | undefined> | string[] | undefined;
}

/** Structured-degradation sink for ADR-0106 D6's middle tier. */
export interface ObjectSchemaMaskTelemetry {
    /** A `warn`-level structured record (functional degradation, not durability loss). */
    warn?(message: string, meta: Record<string, unknown>): void;
    /** A monotonic counter increment. */
    counter?(name: string, labels: Record<string, string>): void;
}

/** Metric name for the D6 middle tier — a deployment living here is an operational condition. */
export const OBJECT_SCHEMA_MASK_UNDETERMINED_METRIC = 'objectstack_meta_field_visibility_undetermined_total';

/**
 * Decide the masking posture for one caller × one object, BEFORE the document
 * is fetched (ADR-0106 D2/D4/D6/D7/D8).
 *
 * Resolving first is what lets an exit keep today's exact cached-read code path
 * when the answer is `passthrough` — the byte-identical guarantee D3 promises
 * unrestricted callers is a property of the code path, not just of the body.
 *
 * @throws {ObjectSchemaMaskEvaluationError} when the security service throws.
 */
export async function resolveObjectSchemaMaskPosture(input: {
    /** Object machine name (`req.params.name`). */
    objectName: string;
    /** The caller's execution context, or `undefined` when it could not be resolved. */
    context: unknown;
    /** The registered `security` service, or `undefined` when none is. */
    security: ObjectSchemaMaskSecuritySurface | undefined;
    /** {@link isObjectSchemaMaskingEnabled} for this deployment. */
    enabled: boolean;
    /** Optional sink for the D6 middle tier. */
    telemetry?: ObjectSchemaMaskTelemetry;
}): Promise<ObjectSchemaMaskPosture> {
    const { objectName, context, security, enabled, telemetry } = input;
    if (!enabled) return { kind: 'passthrough', reason: 'disabled' };
    // D4 — a caller property. Checked before the service call so an exempt
    // caller costs nothing and cannot be turned into an error by a sick
    // security service.
    if (isObjectSchemaMaskExempt(context)) return { kind: 'passthrough', reason: 'exempt' };

    const ask = typeof security?.getMetadataReadableFields === 'function'
        ? security.getMetadataReadableFields.bind(security)
        : (typeof security?.getReadableFields === 'function' ? security.getReadableFields.bind(security) : undefined);
    // D6 tier 1 — no FLS posture in this deployment at all. The data plane does
    // not mask either, so tightening the metadata plane alone would be theater.
    if (!ask) return { kind: 'passthrough', reason: 'no-service' };

    let readable: string[] | undefined;
    try {
        readable = await ask(objectName, context);
    } catch (error) {
        // D6 tier 3 — an unhealthy security service must not auto-open.
        throw new ObjectSchemaMaskEvaluationError(objectName, error);
    }

    if (!Array.isArray(readable)) {
        // D6 tier 2 — the field universe is unresolvable (registry hydration).
        // Fail OPEN, loudly: failing closed here bricks every render of the
        // object for every user and risks a bootstrap deadlock, because
        // permission sets are themselves metadata.
        telemetry?.warn?.(
            '[ADR-0106] object-schema field visibility undetermined — serving the UNMASKED schema; '
            + 'response downgraded to `private, no-store` and no shared ETag is emitted',
            { object: objectName, decision: 'serve-unmasked' },
        );
        telemetry?.counter?.(OBJECT_SCHEMA_MASK_UNDETERMINED_METRIC, { object: objectName });
        return { kind: 'undetermined' };
    }

    // [#21884] The same question about another object, for the action params
    // that read one through `objectOverride`. Unlike this object's own D6
    // tiers, an answer it cannot get WITHHOLDS what depends on it — the
    // actions reading that object — rather than opening the document or
    // refusing it: nothing about the other object is served on a guess, and
    // the rest of this document does not depend on it. Said once per object.
    const relate = async (related: string): Promise<ReadonlySet<string> | undefined> => {
        let answer: string[] | undefined;
        try {
            answer = await ask(related, context);
        } catch (error) {
            telemetry?.warn?.(
                '[ADR-0106] field visibility on a related object could not be evaluated — '
                + 'the actions whose params read it through `objectOverride` are withheld',
                { object: objectName, related, decision: 'withhold-actions', error: String(error) },
            );
            return undefined;
        }
        if (!Array.isArray(answer)) {
            telemetry?.warn?.(
                '[ADR-0106] field visibility on a related object undetermined — '
                + 'the actions whose params read it through `objectOverride` are withheld',
                { object: objectName, related, decision: 'withhold-actions' },
            );
            telemetry?.counter?.(OBJECT_SCHEMA_MASK_UNDETERMINED_METRIC, { object: related });
            return undefined;
        }
        return new Set(answer);
    };

    return { kind: 'project', readable: new Set(readable), relate };
}

/**
 * [#21884] Complete a `project` posture for the document it is about to mask:
 * resolve the caller's readable fields on every OTHER object the document's
 * action params read through `objectOverride` (ADR-0106 D1 judges such a param
 * against the object it names, not this one).
 *
 * Called by every exit AFTER its fetch and BEFORE {@link applyObjectSchemaMask}
 * — only the document says which objects those are, so this half cannot ride
 * the posture resolved before the fetch (D3). Any posture but `project`, and a
 * document with no such read, comes back as given (same reference). Objects
 * already related are not asked again, so one posture related over several
 * documents (a layered read's layers) asks each object once. Never throws: an
 * object it cannot resolve is related as `undefined`, which withholds the
 * actions that read it.
 */
export async function relateObjectSchemaMaskPosture(
    posture: ObjectSchemaMaskPosture,
    ...documents: unknown[]
): Promise<ObjectSchemaMaskPosture> {
    if (posture.kind !== 'project') return posture;
    const targets = new Set<string>();
    for (const document of documents) {
        for (const read of objectOverrideReads(document)) {
            if (!posture.related?.has(read.object)) targets.add(read.object);
        }
    }
    if (targets.size === 0) return posture;
    const related = new Map(posture.related ?? []);
    for (const object of targets) {
        related.set(object, posture.relate ? await posture.relate(object) : undefined);
    }
    return { ...posture, related };
}

/** The result of projecting one document. */
export interface ObjectSchemaMaskResult<T> {
    /** The document to serve. Same reference when nothing was removed. */
    document: T;
    /** Field names removed, sorted. Empty for an unrestricted caller. */
    denied: readonly string[];
    /**
     * {@link objectFieldVisibilityFingerprint} over {@link denied} and the
     * `objectOverride` reads withheld (as `object.field`, #21884); `''` when
     * nothing was removed.
     */
    fingerprint: string;
    /**
     * True when the projection would have left the schema with **no** fields at
     * all while the source declared some.
     *
     * `getReadableFields` answers `[]` only where its own posture read failed
     * closed (#3545), so this is a degraded answer wearing a valid shape — and
     * ADR-0106 D6 rules an empty-fields `200` out in as many words ("the worst
     * option — silently wrong UI **and** cacheable poison"). Exits answer 5xx.
     */
    emptied: boolean;
}

/**
 * Project a metadata document's `fields` onto the caller's readable set
 * (ADR-0106 D1) — remove an unreadable field **whole**: its `fields` entry AND
 * every reference to it elsewhere in the document (object-level rules, role
 * pointers, name lists, expressions, and the definitions of the fields that
 * stay), per {@link maskDeniedFieldReferences}.
 *
 * Pure and total, with the same tolerance contract as
 * {@link applyAuditFieldGovernance}: any input may be handed to it, including a
 * bare record that has never been through Zod. A document with no `fields`
 * record is returned by reference (a non-object type reaching an object exit,
 * or an object schema that declares none), and so is a document from which
 * nothing was removed — so an unrestricted caller pays one pass and no copy.
 */
export function applyObjectSchemaMask<T>(document: T, posture: ObjectSchemaMaskPosture): ObjectSchemaMaskResult<T> {
    const unchanged: ObjectSchemaMaskResult<T> = { document, denied: [], fingerprint: '', emptied: false };
    if (posture.kind !== 'project') return unchanged;
    if (!document || typeof document !== 'object' || Array.isArray(document)) return unchanged;

    const rec = document as unknown as Record<string, unknown>;
    const fields = rec.fields;
    // `fields` is a record keyed by machine name — the one shape `packages/spec`
    // declares. Anything else is not an object schema and is left alone rather
    // than tolerated as a second dialect (Prime Directive #12).
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return unchanged;

    const declared = fields as Record<string, unknown>;
    const denied: string[] = [];
    for (const name of Object.keys(declared)) {
        if (!posture.readable.has(name)) denied.push(name);
    }
    // [#21884] The `objectOverride` reads this caller cannot make — each one
    // withholds its action, so the served body varies with them as surely as
    // with `denied`, and the fingerprint must too (D3: a cohort shares 304s
    // only when it shares the body). Qualified `object.field`, which no field
    // name can collide with.
    const relatedDenied = [...new Set(objectOverrideReads(rec)
        .filter((read) => !posture.related?.get(read.object)?.has(read.field))
        .map((read) => `${read.object}.${read.field}`))];
    if (denied.length === 0 && relatedDenied.length === 0) return unchanged;
    denied.sort();

    const kept: Record<string, unknown> = {};
    for (const [name, def] of Object.entries(declared)) {
        if (posture.readable.has(name)) kept[name] = def;
    }

    // D1's "whole" covers the field's references too: a validation rule over it,
    // a role pointer naming it, a readable field's formula reading it, … — see
    // `object-schema-fls-references.ts` for every position and its disposition.
    const projected = maskDeniedFieldReferences(
        { ...rec, fields: kept },
        new Set(denied),
        posture.related ?? new Map(),
    );

    return {
        document: projected as unknown as T,
        denied,
        fingerprint: objectFieldVisibilityFingerprint([...denied, ...relatedDenied]),
        emptied: Object.keys(kept).length === 0,
    };
}

/**
 * A stable hash of the caller's **denied** field set for one object (ADR-0106
 * D3) — the ETag dimension that keeps `304` semantics correct per permission
 * cohort without putting a caller dimension in the cache key.
 *
 * Empty denied set → empty string, which is what makes an unrestricted caller's
 * ETag byte-identical to the pre-ADR one (see
 * {@link foldVisibilityFingerprintIntoEtag}). {@link applyObjectSchemaMask}
 * hands it the `objectOverride` reads it withheld too, qualified as
 * `object.field` (#21884), since those also change the served body.
 *
 * FNV-1a/32, hex, order-independent (the input is sorted first): two callers in
 * the same cohort must hash equal whatever order their sets were computed in.
 */
export function objectFieldVisibilityFingerprint(denied: readonly string[]): string {
    if (denied.length === 0) return '';
    const joined = [...denied].sort().join('\u0000');
    let hash = 0x811c9dc5;
    for (let i = 0; i < joined.length; i++) {
        hash ^= joined.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

/** Separator between the shared validator and the per-cohort fingerprint. */
const FINGERPRINT_SEPARATOR = '~';

/**
 * Fold a caller's visibility fingerprint into a shared ETag value (ADR-0106 D3).
 *
 * An empty fingerprint returns the ETag **unchanged** — the zero-regression
 * property the ADR promises unrestricted callers, and the reason this is a fold
 * rather than a rewrite.
 */
export function foldVisibilityFingerprintIntoEtag(etag: string, fingerprint: string): string {
    return fingerprint === '' ? etag : `${etag}${FINGERPRINT_SEPARATOR}${fingerprint}`;
}

/**
 * Normalize an `If-None-Match` header value to the bare validator string —
 * strips `W/` and the surrounding quotes, the same normalization
 * `getMetaItemCached` applies before comparing.
 */
export function normalizeIfNoneMatch(header: unknown): string | undefined {
    if (typeof header !== 'string') return undefined;
    const trimmed = header.trim();
    if (trimmed === '') return undefined;
    return trimmed.replace(/^W\/"(.*)"$/, '$1').replace(/^"(.*)"$/, '$1');
}
