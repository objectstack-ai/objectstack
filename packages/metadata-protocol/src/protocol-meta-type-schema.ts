// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 E0] Part of the module preamble of `protocol.ts`, moved here verbatim:
 * the canonical `/meta` type spelling, the served item and JSON Schema, and the overlay schema a save is judged against.
 *
 * A MOVE, not a redesign: every declaration below is byte-identical to the text
 * that stood above `ObjectStackProtocolImplementation`; only the imports and the
 * export list at the foot are new. `protocol.ts` re-exports what it exported.
 */
// [#17502] The served JSON Schema publishes what an author MAY write, so a
// property no instance can satisfy — a `retiredKey()` tombstone, rendered
// `{ not: {} }` — is dropped from it. See the module header for the channels
// that keep carrying the retirement's prescription.
import { stripUnauthorableProperties } from './unauthorable-nodes.js';
// [#19295] The output derivation of a `ZodPipe` erases the arm's own input
// type, so an authoring arm that accepts a bare string is served as the
// anonymous `{}`. This annotates that husk — and only that husk — so a
// consumer can tell an ERASED authoring type from a member that genuinely
// admits anything. See the module header for the predicate and its controls.
import { markErasedAuthoringInput } from './erased-authoring-mark.js';
import {
    applyAuditFieldGovernance,
    // [#6562] The injection/strip pair over the shared injected-column
    // definition table — see {@link governServedItem} / {@link stripServedSystemColumns}.
    applyInjectedSystemColumns,
    stripInjectedSystemColumns,
} from '@objectstack/metadata-core';
import { PLURAL_TO_SINGULAR, canonicalMetaUrlType, metaUrlSpellingRefusal } from '@objectstack/spec/shared';
import { type FormView } from '@objectstack/spec/ui';
import { METADATA_FORM_REGISTRY } from '@objectstack/spec/system';
import { getMetadataTypeSchema } from '@objectstack/spec/kernel';
import { z } from 'zod';

/**
 * Canonical Zod schema per metadata type lives in
 * `@objectstack/spec/kernel/metadata-type-schemas` and is exposed through
 * {@link getMetadataTypeSchema}. Both save-time validation
 * ({@link resolveOverlaySchema}) and the `/meta/types/:type` JSON Schema
 * emitter consult that single source of truth, so adding a new
 * metadata-type schema requires editing exactly one file (or calling
 * `registerMetadataTypeSchema()` from a plugin).
 */
// (TYPE_TO_SCHEMA removed — use `getMetadataTypeSchema(type)` directly.)

/**
 * Canonical {@link FormView} layout per metadata type. Sourced from the
 * shared {@link METADATA_FORM_REGISTRY} in `@objectstack/spec/system` so
 * the runtime form payload, the i18n extractor, and Studio all read from
 * a single source of truth.
 *
 * Types without an entry render with the auto-generated single-section
 * layout derived from their JSON Schema (acceptable for simple types).
 */
const TYPE_TO_FORM: Readonly<Record<string, FormView>> = METADATA_FORM_REGISTRY;

/**
 * The ONE canonical spelling of a metadata type at the `/meta` read/write/delete
 * boundary (#4432).
 *
 * Prime Directive #3 already fixes the answer — metadata type names are
 * SINGULAR (`'action'`, `'view'`), REST paths are plural (`/meta/actions`) — and
 * #3985 taught the per-type gates to accept both spellings. What it did not do
 * is fold them, so the two spellings addressed two different namespaces and the
 * layers below disagreed about which one an item lived in:
 *
 *  - the `SysMetadataRepository` write/delete path already folded to singular,
 *    while the authorization tier above it (`isOverlayAllowed`,
 *    `isArtifactBacked`) and the registry heal below it
 *    (`restoreArtifactRegistryView`) read the caller's spelling;
 *  - `getMetaItems` registered overlay rows back into the SchemaRegistry under
 *    the caller's spelling. One plural-spelled read minted a plural registry
 *    entry, `listItems('actions')` stopped being empty, and the singular
 *    fallback that had been supplying the code-authored items never ran again —
 *    so one overlay row shadowed an entire code-authored listing, and survived
 *    the DELETE that was supposed to lift it.
 *
 * Folding at the boundary (rather than adding another spelling-tolerant lookup
 * one layer down) is Prime Directive #12 applied to a type key: one contract,
 * not N dialects. Reads of data AT REST still try the other spelling as a
 * fallback — rows written under a plural `type` before this fix are real, and
 * nothing rewrites them on upgrade.
 *
 * ## [#7894] It folds through the URL map, NOT the manifest map
 *
 * This used to read `PLURAL_TO_SINGULAR`, which is a MANIFEST-COLLECTION map
 * (`objects: [...]`, `apps: [...]`) that `metadata-authoring-lint.ts` iterates
 * to decide which stack-level collections exist. Four registry types are
 * legitimately absent from it because they are not stack collections —
 * `field`, `seed`, `external_catalog`, `translation`. At this boundary that
 * absence did not read as "not a collection", it read as "unknown type", and an
 * unknown type takes the PLUGIN path, which every authorization gate is
 * permissive toward by construction. So `PUT /meta/fields/showcase_task.title`
 * answered 200 and persisted a row under `type='fields'` — a second namespace
 * for the same item, the #4432 defect exactly — while `PUT /meta/field/...`
 * answered 403 NOT_OVERRIDABLE. The plural URL was a door around the singular
 * URL's lock.
 *
 * {@link canonicalMetaUrlType} reads a map DERIVED from
 * `DEFAULT_METADATA_TYPE_REGISTRY` (unioned with every manifest spelling, so
 * nothing that resolved before resolves differently), which is why a newly
 * declared type cannot arrive unmapped. Adding the four missing keys to the
 * manifest map by hand would have fixed only today's four — and would have
 * advertised a `fields: [...]` stack collection that does not exist.
 *
 * ⛔ Do not "fix" a future instance of this by teaching a predicate one layer
 * down (`isNestedArtifactField` and friends) to accept a plural. That is the
 * spelling-tolerant lookup this comment has rejected since #4432, and it would
 * still persist the row under the plural `type`.
 */
export function canonicalMetaType(type: string): string {
    return canonicalMetaUrlType(type);
}

/**
 * {@link canonicalMetaType} applied to a `{ type }` request, without mutating the
 * caller's object — and the one checkpoint that REFUSES a spelling it cannot
 * honour instead of forwarding it to the plugin path (#7894).
 *
 * Applied here rather than inside {@link canonicalMetaType} on purpose: this is
 * the request boundary (all six `/meta` entry points funnel through it), while
 * `canonicalMetaType` is also called on read EXITS by `governServedItem` and
 * `stripServedSystemColumns`, where the type is already canonical and a throw
 * would be a bug rather than a refusal.
 *
 * The refusal is deliberately narrow: {@link metaUrlSpellingRefusal} returns a
 * verdict only for a spelling whose singular is a type the platform itself
 * DECLARES, so a plugin-registered runtime kind can never trip it. See that
 * function for why the rule is static rather than a live-registry lookup —
 * and (#8424) for why this boundary consumes the composed VERDICT rather than
 * the predicate parts: the spelling contract stays whole at its producer.
 *
 * ## [#8421] The SECOND verdict is not here
 *
 * This refusal is silent for a name that is not a plural of ANYTHING
 * (`fieldz`), because such a name reaches for no declared type. That residue
 * was closed by the maintainer's ruling of 2026-08-14 (「同意」), joint with
 * #8586 — but not in this function, because the verdict that closes it cannot
 * be answered from the request alone: it has to know whether the namespace it
 * would create already exists. It lives on the mint door itself, as
 * {@link ObjectStackProtocolImplementation.refuseUnmintableMetaType}, which
 * carries the scoping argument and the measurements behind it.
 */
function canonicalizeMetaRequestType<T extends { type: string }>(request: T): T {
    const refusal = metaUrlSpellingRefusal(request.type);
    if (refusal) {
        const err = new Error(
            `'${request.type}' is not a recognised spelling of metadata type `
            + `'${refusal.declared}'. Address it as '${refusal.declared}' or '${refusal.hint}'. `
            + `Refused rather than treated as a plugin-registered type, because forwarding an unrecognised `
            + `spelling of a declared type would create a second namespace under type='${request.type}'.`,
        );
        (err as any).code = 'INVALID_REQUEST';
        (err as any).status = 400;
        throw err;
    }
    const type = canonicalMetaType(request.type);
    return type === request.type ? request : { ...request, type };
}

/**
 * The last thing every `/meta` read does to an OBJECT document before it leaves
 * this service: make the field metadata it reports agree with what the engine
 * enforces on the write path — in BOTH of the ways it used to disagree.
 *
 * The mismatch this closes is structural, not incidental. A `/meta` object read
 * resolves through `sys_metadata` overlay → MetadataService → SchemaRegistry,
 * and only the last of those three has been through `applySystemFields`, so the
 * answer a caller got depended on which link produced it — with nothing in the
 * response saying which one had. Two halves, filed and ruled separately:
 *
 *  - **[#4513] the VALUE half.** The two stored layers answered with whatever
 *    the artifact/overlay body happened to declare, while `ObjectQL.update` was
 *    stripping caller writes to the audit family off the registry's
 *    post-injection schema. `created_at` read `readonly: false` and wrote as
 *    read-only, on the same field, at the same moment, from the one face a
 *    client can actually see (#4447 fixed the write half; this is the read
 *    half). {@link applyAuditFieldGovernance} normalizes a DECLARED audit field.
 *  - **[#6562] the PRESENCE half.** The stored layers reported the platform's
 *    own injected columns — `created_at`, `owner_id`, `organization_id`,
 *    `owning_business_unit_id`, … — as simply ABSENT, so an author reading an
 *    overlay-backed object reasonably concluded the columns do not exist, while
 *    every one of them is real in the database, filterable, orderable and
 *    enforced read-only on write. Maintainer ruling (2026-08-08), Option B: the
 *    read serves the EFFECTIVE runtime schema and the overlay-backed minority
 *    converges on the registry-backed majority.
 *    {@link applyInjectedSystemColumns} adds an UNDECLARED injected column.
 *
 * The two are composed rather than folded, because they do different things to
 * different fields: governance rewrites what the author declared, injection only
 * ever adds what nobody declared. Both return their input by reference when
 * nothing was needed, so the registry-sourced path (injected AND governed at
 * registration) and every non-object type pay a comparison and no copy.
 *
 * Applied per EXIT rather than inside `decorateMetadataItem`: decoration is a
 * diagnostics concern whose output `stripReadDecorations` deliberately removes
 * again on write, and neither of these is that — they are what the document
 * means. The read exits are also the ONLY place injection may happen (ruling
 * constraint 1): `getMetaItemLayered` calls this on `effective` and never on
 * `overlay`, so Studio's "what you customised" diff keeps showing the row the
 * author actually stored.
 *
 * ⛔ The write path owes this function a counterpart. See
 * {@link stripServedSystemColumns} — without it the standard Studio GET → edit →
 * PUT round-trip would persist the injected columns into `sys_metadata`, and the
 * #4326 byte-identical invariant would break the day this shipped.
 */
export function governServedItem<T>(type: string, item: T): T {
    if (canonicalMetaType(type) !== 'object') return item;
    return applyInjectedSystemColumns(applyAuditFieldGovernance(item));
}

/**
 * [#6562] The write-path counterpart of {@link governServedItem}'s injection
 * half: take the injected-but-undeclared system columns back off a body on its
 * way IN, so a served document handed straight back still persists byte-identical.
 *
 * Exactly the shape, and exactly the reason, of the `stripReadDecorations` call
 * beside it in `saveMetaItem` (#4326) — the write path persists the request body
 * verbatim by design for every type but `view` (ADR-0005 appendix (c), the
 * "Addendum — 2026-05-16 (c)"), so anything the READ adds must come
 * off again on the way in or it is baked into `sys_metadata.metadata`, into its
 * checksum, and into every history diff. Kept a SEPARATE strip from that one
 * rather than folded into `METADATA_READ_DECORATIONS`, because the two lists are
 * different in kind: a read decoration is derived diagnostics no schema accepts,
 * whereas an injected column is a real, spec-valid field declaration an author
 * may legitimately write — so this strip removes only a field byte-identical to
 * the platform's own definition, and a declared `owner_id` carrying the author's
 * own label survives untouched.
 */
export function stripServedSystemColumns<T>(type: string, item: T): T {
    return canonicalMetaType(type) === 'object' ? stripInjectedSystemColumns(item) : item;
}

/**
 * [#17501] Does a converted JSON Schema carry any authorable surface at all?
 *
 * `z.toJSONSchema()` answers a `ZodPipe` in its default `'output'` mode with a
 * document that is syntactically a JSON Schema and semantically nothing:
 * `{"$schema": "..."}` and not one property. It is truthy, so a `?? fallback`
 * downstream never fires, and the endpoint serves a document that reads as
 * "this type declares no constraints" when the truth is "this derivation could
 * not see the type at all".
 *
 * A derivation is DEGENERATE when it names no property, offers no union arm,
 * points at no `$ref` and opens no `additionalProperties` object — i.e. there
 * is nothing an author or a form renderer could address. Every one of those
 * four is a real authorable surface, so any one of them present means the
 * derivation worked.
 */
function isDegenerateDerivation(json: Record<string, unknown> | undefined): boolean {
    if (!json || typeof json !== 'object') return true;
    const properties = json.properties;
    if (properties && typeof properties === 'object' && Object.keys(properties).length > 0) return false;
    for (const arm of ['anyOf', 'oneOf', 'allOf'] as const) {
        const value = json[arm];
        if (Array.isArray(value) && value.length > 0) return false;
    }
    if (typeof json.$ref === 'string') return false;
    const additional = json.additionalProperties;
    if (additional && typeof additional === 'object') return false;
    return true;
}

/**
 * [#17501] One-shot per type: both derivations of this type's schema came back
 * empty. Keyed by type name, not by schema reference, because the message names
 * the type and repeating it per request is noise.
 */
const _warnedDegenerateDerivation = new Set<string>();

/**
 * Convert a Zod schema to a JSON Schema, returning `undefined` if no usable
 * derivation exists — which is what lets the caller's `?? HAND_CRAFTED_SCHEMAS`
 * arm fire. Cached per schema reference.
 *
 * ## [#17501] Why this tries TWICE, and why only sometimes
 *
 * `/meta/types` served `action` as `{"$schema": "..."}` — an empty schema for a
 * type that accepts 48 keys — because `ActionSchema` is
 * `lazySchema(() => actionObject().refine(...))`, a `ZodPipe`, and the OUTPUT
 * derivation of a pipe carries no properties. The hand-crafted fallback
 * declared for exactly this case never fired: conversion did not throw, it
 * SUCCEEDED and returned a truthy husk.
 *
 * The obvious repair — derive everything with `io: 'input'`, the authoring
 * shape a property panel actually wants, which `reference-sites.ts` already
 * passes — was measured across the whole served surface and REFUSED. It is not
 * a repair with a blast radius of one: 24 of the 26 types that carry a Zod
 * schema answer differently under `input`, and the direction is a WEAKENING of
 * a published contract — `required` entries 1132 to 867, `additionalProperties:
 * false` 663 to 637. Serving the authoring shape for every type is a defensible
 * contract change, but it is a `packages/spec` question with its own review,
 * not a rider on this bug fix. (The card's own reading that thirteen types
 * "answer identically" is a TOP-LEVEL PROPERTY COUNT, which cannot see either
 * keyword; the counts reproduce exactly and the inference from them does not.)
 *
 * So the output derivation stays the served default and the authoring
 * derivation is a RETRY, reached only when the default degenerates. Measured on
 * the full registry: exactly one type — `action` — takes the retry arm, and the
 * other 25 stay byte-for-byte identical. `protocol.meta-types-degenerate-derivation.test.ts`
 * pins that count, which is the assertion that fails if someone later widens
 * this to every type.
 *
 * ## Absence is deliberately NOT degeneracy
 *
 * A type with no Zod schema at all (`external_catalog`) never reaches here —
 * the caller's `zodSchema ? ... : undefined` guard sees to that — and it is a
 * different, honest shape: nothing is advertised, so nothing lies. This
 * function judges only a derivation that RAN and came back empty. Widening it
 * to cover missing schemas would change what absence means at the endpoint and
 * is out of scope.
 *
 * ## A throwing conversion keeps its old path exactly
 *
 * If the output derivation THROWS, that is the case `HAND_CRAFTED_SCHEMAS` was
 * documented for and it returns `undefined` as it always did — no retry. Not
 * one type's conversion throws today, so retrying there would move no payload
 * while widening the change past the ruling.
 *
 * ## [#19295] Why both derivations carry the erased-authoring `override`
 *
 * The degeneracy above is a WHOLE-TYPE husk. The same erasure also happens one
 * level down, per MEMBER: a predicate slot's string arm is a `ZodPipe`, so the
 * output derivation describes the transform's result and the arm itself is
 * served as `{}` — indistinguishable from a member that admits anything.
 * {@link markErasedAuthoringInput} annotates exactly those arms; it adds a
 * vendor keyword and changes no keyword zod emitted, so what each document
 * ACCEPTS is untouched and the refused `io: 'input'` widening stays refused.
 *
 * It is passed to BOTH calls on purpose. On the authoring retry a pipe derives
 * from its input side, nothing is erased, and the hook marks nothing — so a
 * type served from the retry (`action`) carries a real authoring arm instead
 * of a marked husk, which is the honest answer rather than a gap.
 */
const _jsonSchemaCache = new WeakMap<z.ZodTypeAny, Record<string, unknown> | null>();
function toJsonSchemaSafe(schema: z.ZodTypeAny, typeLabel?: string): Record<string, unknown> | undefined {
    const cached = _jsonSchemaCache.get(schema);
    if (cached !== undefined) return cached ?? undefined;

    let output: Record<string, unknown>;
    try {
        output = z.toJSONSchema(schema, {
            unrepresentable: 'any',
            override: markErasedAuthoringInput,
        }) as Record<string, unknown>;
    } catch {
        // Conversion failed outright — the original hand-crafted-fallback case.
        _jsonSchemaCache.set(schema, null);
        return undefined;
    }

    if (!isDegenerateDerivation(output)) {
        const authorable = stripUnauthorableProperties(output);
        _jsonSchemaCache.set(schema, authorable);
        return authorable;
    }

    // The default derivation produced a husk. Retry in the authoring shape
    // before giving up — for a `ZodPipe` this is the derivation that can see
    // the object at all.
    try {
        const authoring = z.toJSONSchema(schema, {
            unrepresentable: 'any',
            io: 'input',
            override: markErasedAuthoringInput,
        }) as Record<string, unknown>;
        if (!isDegenerateDerivation(authoring)) {
            const authorable = stripUnauthorableProperties(authoring);
            _jsonSchemaCache.set(schema, authorable);
            return authorable;
        }
    } catch {
        // Fall through to the loud arm below.
    }

    // Both derivations are unusable. Say so once, then hand the caller
    // `undefined` so its `?? HAND_CRAFTED_SCHEMAS` arm decides.
    if (typeLabel && !_warnedDegenerateDerivation.has(typeLabel)) {
        _warnedDegenerateDerivation.add(typeLabel);
        console.warn(
            `[Protocol] /meta/types: both the output and the authoring derivations of the `
            + `"${typeLabel}" schema came back empty, so no schema is derived from it — a property `
            + `panel built for this type will show no fields. Fix the schema so it derives, or `
            + `declare a HAND_CRAFTED_SCHEMAS entry for "${typeLabel}".`,
        );
    }
    _jsonSchemaCache.set(schema, null);
    return undefined;
}

/**
 * Hand-crafted fallback JSON Schemas for metadata types whose Zod schema
 * cannot be safely converted via `z.toJSONSchema()` (e.g. due to recursive
 * references or non-representable constructs like `z.lazy()` chains).
 *
 * These mirror the shape consumed by the corresponding `*.form.ts` layouts,
 * so the SchemaForm renderer can still produce a real form (instead of
 * falling back to the raw JSON editor). All fields use lenient types
 * (`string | object | array`) because the widget hint in the form layout
 * is what actually drives the UI control selection — the JSON Schema is
 * only used to (a) seed defaults and (b) report which property names exist.
 */
const HAND_CRAFTED_SCHEMAS: Record<string, Record<string, unknown>> = {
    object: {
        type: 'object',
        properties: {
            name: { type: 'string' },
            label: { type: 'string' },
            pluralLabel: { type: 'string' },
            icon: { type: 'string' },
            description: { type: 'string' },
            isSystem: { type: 'boolean', default: false },
            datasource: { type: 'string' },
            fields: {
                // Canonical Object.fields is a name-keyed map
                // (Record<string, FieldDefinition>) — insertion order is
                // display order. The SchemaForm engine recognises
                // `additionalProperties` as a Record and dispatches to
                // the `record` form-field renderer (ADR-0007). The form
                // layout in `object.form.ts` declares `type: 'record'`
                // so the inner `additionalProperties` schema is used to
                // shape each value.
                type: 'object',
                default: {},
                additionalProperties: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                        label: { type: 'string' },
                        type: { type: 'string' },
                        required: { type: 'boolean', default: false },
                        unique: { type: 'boolean', default: false },
                        defaultValue: {},
                        description: { type: 'string' },
                    },
                    required: ['type'],
                },
            },
            capabilities: { type: 'object', additionalProperties: true },
        },
        required: ['name'],
        additionalProperties: true,
    },
    action: {
        type: 'object',
        properties: {
            name: { type: 'string' },
            label: { type: 'string' },
            objectName: { type: 'string' },
            icon: { type: 'string' },
            type: { type: 'string', enum: ['url', 'flow', 'api', 'script'] },
            variant: { type: 'string', enum: ['primary', 'secondary', 'danger', 'ghost', 'outline'] },
            target: { type: 'string' },
            method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
            body: {
                type: 'array',
                default: [],
                items: {
                    type: 'object',
                    properties: {
                        line: { type: 'string' },
                    },
                },
            },
            params: {
                type: 'array',
                default: [],
                items: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                        label: { type: 'string' },
                        type: { type: 'string' },
                        required: { type: 'boolean', default: false },
                    },
                    required: ['name'],
                },
            },
            confirmText: { type: 'string' },
            successMessage: { type: 'string' },
            refreshAfter: { type: 'boolean', default: true },
            locations: {
                type: 'array',
                default: [],
                items: {
                    type: 'object',
                    properties: {
                        location: { type: 'string' },
                    },
                },
            },
            component: { type: 'string' },
            visible: { type: 'string' },
            disabled: { type: 'string' },
            // No `shortcut` / `bulkEnabled`: spec 17 retired both as
            // `retiredKey()` tombstones, so authoring either is a hard parse
            // rejection. This schema is what the Studio designer renders its
            // fallback form from, so leaving them here handed authors two
            // inputs that could only ever produce an unsaveable draft
            // (objectui#3145 removed the matching dedicated controls).
            // `bulkEnabled`'s replacement is the list view's `bulkActions` /
            // `bulkActionDefs`; `shortcut` has none.
            aiExposed: { type: 'boolean', default: false },
            recordIdParam: { type: 'string' },
            recordIdField: { type: 'string' },
            bodyShape: { type: 'string', enum: ['flat', 'nested'] },
        },
        required: ['name', 'label', 'type'],
        additionalProperties: true,
    },
    // ADR-0088 (#4509): the `validation` kind is retired, so its hand-crafted
    // form goes with it. Rules are authored inside `object.validations[]` and
    // edited on the object; there is no standalone validation editor to render
    // a schema for. (The form was flat by necessity — ValidationRuleSchema is a
    // 6-variant discriminated union the generic SchemaForm treats as opaque —
    // and it had no field for the object being validated, which is precisely
    // the gap that retired the kind: a rule saved here bound to nothing.)
};

/**
 * Zod schemas used to validate overlay items before they are persisted into
 * `sys_metadata` by {@link ObjectStackProtocolImplementation.saveMetaItem}.
 *
 * Single source of truth: the spec-side {@link getMetadataTypeSchema}
 * registry (`@objectstack/spec/kernel/metadata-type-schemas`). Every
 * metadata type whose payload should round-trip through Studio's
 * generic editor maps to its canonical Zod schema there; this function
 * is a plural→singular adapter on top of it.
 *
 * Validation policy:
 *   - `safeParse` is used so we can craft a 422 with structured `issues`.
 *   - [#20051] What is persisted depends on the type — ADR-0005 appendix (c),
 *     the "Addendum — 2026-05-16 (c): spec validation on overlay save":
 *     - `view` stores the parsed value of every key its body carried:
 *       undeclared keys are dropped, schema defaults are not materialised
 *       (ADR-0087's `storable` rule, the one flows follow). Every key the
 *       console reads back off a stored row is declared on the contract
 *       (`VIEW_CONSOLE_ROUND_TRIP_KEYS`), so the parse keeps it. See
 *       {@link projectStorableViewBody}.
 *     - Every other type stores its original payload verbatim, with two
 *       normalizations grafted back from `parsed.data` so a save stops
 *       minting legacy-alias rows — filter `operator` spellings
 *       ({@link graftNormalizedOperators}) and the form `groups` → `sections`
 *       move ({@link graftFoldedFormSections}). [#20101] A page that omits
 *       `type` is stored with the default `PageSchema` declares for it — see
 *       {@link withDeclaredPageTypeDefault}.
 *   - Types without a registered schema (the wiring-layer types
 *     `function`/`service`/`router`, and any plugin types that have not
 *     yet called `registerMetadataTypeSchema()`) fall through unvalidated.
 */
function resolveOverlaySchema(type: string, _item: unknown): z.ZodTypeAny | null {
    const singular = PLURAL_TO_SINGULAR[type] ?? type;
    return getMetadataTypeSchema(singular) ?? null;
}

/**
 * [ADR-0131 D6, ADR-0010 Phase 4.3] The schema the save door judges `key` by on
 * an item of `type` — read off {@link resolveOverlaySchema}, the door's own
 * resolver, so no list of which types declare which key is kept anywhere — or
 * `undefined` when that schema declares no such key (or the type has none).
 *
 * Read structurally: the object shapes the schema parses to, through the
 * wrappers the registered types use (lazy, pipe, union, intersection and the
 * optional family). A union declares the key when any member does. A schema
 * this walk cannot read answers `undefined`, which leaves the key to the save
 * door's own verdict — the direction that changes no refusal.
 *
 * The unmanaged import asks it for `protection`: only a type that declares the
 * block has one to strip (`stripUnmanagedImportLock`); on any other type the
 * save door judges the block exactly as it did before.
 */
export function overlaySchemaDeclaredKey(type: string, key: string): z.ZodTypeAny | undefined {
    return declaredKeySchema(resolveOverlaySchema(type, undefined), key, 0);
}

function declaredKeySchema(schema: unknown, key: string, depth: number): z.ZodTypeAny | undefined {
    if (!schema || depth > 12) return undefined;
    const def = (schema as { _zod?: { def?: Record<string, any> } })._zod?.def;
    switch (def?.type) {
        case 'object': {
            const shape = (schema as { shape?: Record<string, unknown> }).shape ?? def.shape ?? {};
            return Object.prototype.hasOwnProperty.call(shape, key) ? shape[key] as z.ZodTypeAny : undefined;
        }
        case 'lazy':
            return declaredKeySchema(def.getter?.(), key, depth + 1);
        case 'pipe':
            return declaredKeySchema(def.in, key, depth + 1) ?? declaredKeySchema(def.out, key, depth + 1);
        case 'intersection':
            return declaredKeySchema(def.left, key, depth + 1) ?? declaredKeySchema(def.right, key, depth + 1);
        case 'union':
            for (const option of (def.options ?? []) as unknown[]) {
                const found = declaredKeySchema(option, key, depth + 1);
                if (found) return found;
            }
            return undefined;
        case 'optional':
        case 'nullable':
        case 'default':
        case 'prefault':
        case 'readonly':
        case 'nonoptional':
        case 'catch':
            return declaredKeySchema(def.innerType, key, depth + 1);
        default:
            return undefined;
    }
}

// Shared with `protocol.ts` and the sibling preamble modules; module-private before the move.
export { HAND_CRAFTED_SCHEMAS, TYPE_TO_FORM, canonicalizeMetaRequestType, resolveOverlaySchema, toJsonSchemaSafe };
