// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
    DataProtocol, MetadataProtocol, PackageProtocol,
} from '@objectstack/spec/api';
import { IDataEngine, engineCanRollBack, recordNotFoundError } from '@objectstack/core';
import { readEnvWithDeprecation, resolveTenancyPosture } from '@objectstack/types';
// [#6285] ADR-0105 D1's authority on "does this deployment wall organizations?".
// `resolveMultiOrgEnabled()` is DEMOTED and its own doc comment says answering
// this question with it is a bug (cloud#1020, #5233) — so the posture, and only
// the posture, is what the runtime authoring gate is told.
import { postureEnforcesWall } from '@objectstack/spec/security';
import type { MetadataHostEngine } from './host-engine.js';
import { evaluateRuntimeAuthoringGate } from './runtime-authoring-gate.js';
// [#7560] ADR-0070's read-only-package rule, shared with the `/packages`
// lifecycle gate in `@objectstack/runtime` — see `./package-writability.js`.
import { isWritablePackage as isWritablePackageShared } from './package-writability.js';
import type { RuntimeAuthoringIssue } from './runtime-authoring-gate.js';
// [#6418] `sys_metadata`'s overlay-uniqueness indexes: probe-first DDL plus the
// ADR-0120 D4 reporting that replaced this file's empty `catch` blocks.
import { ensureMetadataOverlayIndexes } from './migrations/overlay-index.js';
import { SysMetadataRepository, type SysMetadataEngine } from './sys-metadata-repository.js';
import {
    ConflictError,
    assertProtocolCompat,
    applyAuditFieldGovernance,
    // [#6562] The injection/strip pair over the shared injected-column
    // definition table — see {@link governServedItem} / {@link stripServedSystemColumns}.
    applyInjectedSystemColumns,
    stripInjectedSystemColumns,
    // [#7774] The i18n-bundle identity table (#7730) and its reader. A type
    // listed here is identified by `(name, <field>)`, so every merge in the
    // unscoped `/meta` list keys on the pair — see {@link metaItemKey}.
    ITEM_KEY_DISCRIMINATORS,
    itemDiscriminator,
    type MetadataItem,
} from '@objectstack/metadata-core';
// [#5532] One vocabulary of "which driver read errors are benign", shared with
// `sys-metadata-repository.ts` in this package and with `DatabaseLoader` in
// `@objectstack/metadata` (#5108). See `rethrowUnlessMetadataStoreUnprovisioned`.
import { isMissingTableError } from '@objectstack/metadata/errors';
import type {
    BatchUpdateRequest,
    BatchUpdateResponse,
    UpdateManyDataRequest,
    DeleteManyDataRequest,
    InstallPackageRequest,
    InstallPackageResponse
} from '@objectstack/spec/api';
import type { MetadataCacheRequest, MetadataCacheResponse, ServiceInfo, ApiRoutes, WellKnownCapabilities, CapabilityDescriptor } from '@objectstack/spec/api';
import type { ApiError, BatchOperationResult } from '@objectstack/spec/api';
import { readServiceSelfInfo, ErrorCode, standardErrorCodeForHttpStatus, resolveDiscoveryEnvironment } from '@objectstack/spec/api';
import {
    parseFilterAST, isFilterAST, VALID_AST_OPERATORS, REFERENCE_VALUE_TYPES, referenceTargetOf,
    AggregationFunction, DateGranularity, resolveSearchFieldResolution,
    SEARCHABLE_TEXTUAL_TYPES, SEARCHABLE_ENUM_TYPES, SEARCH_AUTO_EXCLUDED_FIELDS,
    isVirtualSearchField,
    RUNTIME_OWNED_FIELD_TYPES,
    RPC_QUERY_ALIAS_SLOTS, foldQueryAliasSlots,
    type QueryAliasConflict, type QueryAliasSlot,
    type DroppedFieldsEvent, type QueryAST, type EngineQueryOptionsParsed,
} from '@objectstack/spec/data';
import { PLURAL_TO_SINGULAR, SINGULAR_TO_PLURAL } from '@objectstack/spec/shared';
import { applyConversionsToStoredItem, type ConversionNotice } from '@objectstack/spec';
import { type FormView, isAggregatedViewContainer, expandViewContainer } from '@objectstack/spec/ui';
import { METADATA_FORM_REGISTRY, CORE_SERVICE_PROVIDER, serviceUnavailableMessage, inProcessServiceMessage } from '@objectstack/spec/system';
import { DEFAULT_METADATA_TYPE_REGISTRY, getMetadataTypeSchema, getMetadataTypeActions, getMetadataCreateSeed, PROTOCOL_VERSION } from '@objectstack/spec/kernel';
import {
    extractProtection,
    evaluateLockForWrite,
    evaluateLockForDelete,
    resolveLockState,
    type MetadataLock,
    type MetadataProvenance,
} from '@objectstack/spec/kernel';
import { validateObjectNamespacePrefix, deriveNamespaceFromPackageId } from '@objectstack/spec/kernel';
import { stripReadDecorations } from '@objectstack/spec/kernel';
// [#5488] The `@objectstack/spec/api` import that stood here — `ApiEndpointSchema`,
// `validateApiEndpointDeclarations`, `type ApiEndpoint` — went with
// `gateApiDraftsForPublish` (see its retirement note in `publishPackageDrafts`).
// This module no longer judges endpoints at all: `api` is code-only since #5488,
// so no `api` draft can be authored here, and the ONE judge of what is servable
// stays `validateApiEndpointDeclarations` on the artifact route (stack schema,
// `publishPackage` #5189, and `buildEndpointIndex` at load, PR #5203). An
// endpoint-shaped import left behind with no caller reads as a capability this
// module still has (#3950), so it is removed rather than parked.
import { z } from 'zod';
import {
    computeMetadataDiagnostics,
    computeViewReferenceDiagnostics,
    decorateMetadataItem,
    decorateMetadataItems,
    type MetadataDiagnostics,
} from './metadata-diagnostics.js';
import type {
    StoredFlowCanonicalization,
    StoredMigrationNotice,
    StoredMigrationReport,
    StoredMigrationRow,
} from './stored-migration.js';

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
 */
function canonicalMetaType(type: string): string {
    return PLURAL_TO_SINGULAR[type] ?? type;
}

/** {@link canonicalMetaType} applied to a `{ type }` request, without mutating the caller's object. */
function canonicalizeMetaRequestType<T extends { type: string }>(request: T): T {
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
function governServedItem<T>(type: string, item: T): T {
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
 * verbatim by design (ADR-0005 §Validation), so anything the READ adds must come
 * off again on the way in or it is baked into `sys_metadata.metadata`, into its
 * checksum, and into every history diff. Kept a SEPARATE strip from that one
 * rather than folded into `METADATA_READ_DECORATIONS`, because the two lists are
 * different in kind: a read decoration is derived diagnostics no schema accepts,
 * whereas an injected column is a real, spec-valid field declaration an author
 * may legitimately write — so this strip removes only a field byte-identical to
 * the platform's own definition, and a declared `owner_id` carrying the author's
 * own label survives untouched.
 */
function stripServedSystemColumns<T>(type: string, item: T): T {
    return canonicalMetaType(type) === 'object' ? stripInjectedSystemColumns(item) : item;
}

// [#5488] `PUBLISH_DRAFTS_NAMESPACE_REMEDY` stood here (#5206 step 2): the
// "so where do I declare the namespace, from here?" sentence appended to the
// ADR-0121 D2 gate's own message on this path. It is retired with
// `gateApiDraftsForPublish`, the only thing that ever appended it — this path
// no longer reports endpoint violations, because it can no longer receive an
// `api` draft to violate anything.

/**
 * [#3770] One-shot flag for the "engine has no schema registry" warning emitted
 * by {@link ObjectStackProtocolImplementation.assertObjectRegistered}. The
 * condition is a property of how the host constructed the engine, so it is
 * constant for the process — warn once, not once per request.
 */
let warnedNoRegistryForDataGate = false;

/**
 * Convert a Zod schema to a JSON Schema, returning `undefined` if conversion
 * fails (e.g. unsupported constructs). Cached per schema reference.
 */
const _jsonSchemaCache = new WeakMap<z.ZodTypeAny, Record<string, unknown> | null>();
function toJsonSchemaSafe(schema: z.ZodTypeAny): Record<string, unknown> | undefined {
    const cached = _jsonSchemaCache.get(schema);
    if (cached !== undefined) return cached ?? undefined;
    try {
        const result = z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown>;
        _jsonSchemaCache.set(schema, result);
        return result;
    } catch {
        _jsonSchemaCache.set(schema, null);
        return undefined;
    }
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
 *   - We do NOT replace the persisted document with `parsed.data`; the
 *     original payload is stored verbatim so Studio-only auxiliary fields
 *     (e.g. `isPinned`, `isDefault`, `sortOrder`) survive the round-trip.
 *     The one exception is filter `operator` spellings, which are grafted back
 *     from `parsed.data` so a save stops minting new legacy-alias rows — see
 *     {@link graftNormalizedOperators}.
 *   - Types without a registered schema (the wiring-layer types
 *     `function`/`service`/`router`, and any plugin types that have not
 *     yet called `registerMetadataTypeSchema()`) fall through unvalidated.
 */
function resolveOverlaySchema(type: string, _item: unknown): z.ZodTypeAny | null {
    const singular = PLURAL_TO_SINGULAR[type] ?? type;
    return getMetadataTypeSchema(singular) ?? null;
}

/**
 * One entry of the `422 INVALID_METADATA` envelope's `issues[]` — the shape
 * Studio's designer keys on to highlight the offending form control.
 *
 * `code` is zod's OWN issue code, passed through verbatim. That is deliberately
 * NOT the ADR-0114 `fields[]` catalog the data surface speaks: this envelope is
 * a metadata-authoring diagnostic, its consumers already read raw zod codes, and
 * aligning the two vocabularies is a separate decision (#5364).
 */
interface MetadataIssueEntry {
    path: string;
    message: string;
    code: string | undefined;
}

/**
 * How many levels of nested `invalid_union` are expanded below a top-level
 * issue, and how many equally-informative branches are emitted at one level.
 *
 * Both bounds — and the whole selection policy below — are the ones
 * `formatZodError` landed for the CLI/spec side of this defect (#4971,
 * `spec/src/shared/error-map.zod.ts`) and `zodIssuesToFields` landed for the
 * REST wire (#5014, `rest/src/rest-server.ts`). This is the THIRD copy: spec
 * exports only the STRING renderer and rest's version emits ADR-0114
 * `{field, code}` catalog entries, while this envelope is
 * `{path, message, code}` with zod's raw code. The *verdict* must match all the
 * same, or one mistake gets three different prescriptions depending on whether
 * the author published from the terminal, POSTed to the data API, or saved from
 * Studio (#5364).
 */
const UNION_EXPANSION_DEPTH_LIMIT = 3;
const UNION_BRANCH_EMIT_LIMIT = 3;

/**
 * A zod issue, as much of it as the expansion reads.
 *
 * `errors` exists only on `invalid_union`: one issue list **per union branch**,
 * with each branch's paths RELATIVE to the union issue's own path. Zod raises a
 * single `invalid_union` issue whose own `message` is the literal
 * `"Invalid input"`, so everything a failing branch has to say lives down there.
 */
interface ZodIssueLike {
    path?: unknown;
    message?: unknown;
    code?: unknown;
    errors?: unknown;
}

/** A zod issue path, normalised to the array zod always produces. */
function issuePathOf(issue: ZodIssueLike): Array<string | number> {
    return Array.isArray(issue?.path) ? (issue.path as Array<string | number>) : [];
}

/**
 * True when a branch only complains that the value is the wrong *kind* at the
 * branch root — `expected string, received object` for the string member of
 * `z.union([z.string(), SomeObject])`.
 *
 * Such a branch carries no prescription: the author never intended it, and
 * emitting it is the "N branches, N times the noise" failure. An empty branch
 * (zod's "matched multiple" variant carries `errors: []`) counts as
 * uninformative too — `every` on an empty list is `true`.
 */
function isKindMismatchOnly(issues: readonly ZodIssueLike[]): boolean {
    return issues.every(
        (issue) =>
            issuePathOf(issue).length === 0
            && (issue?.code === 'invalid_type' || issue?.code === 'invalid_value'),
    );
}

/** True when a branch carries the #4001 campaign's unknown-key prescription. */
function carriesUnknownKey(issues: readonly ZodIssueLike[]): boolean {
    return issues.some((issue) => issue?.code === 'unrecognized_keys');
}

/**
 * Pick the branch(es) of a failed union whose issues actually explain the
 * failure. Ranking, in order (identical to `selectUnionBranches` in
 * `spec/src/shared/error-map.zod.ts` and `rest/src/rest-server.ts`):
 *
 * 1. **Kind-mismatch-only branches are dropped entirely.** If *every* branch is
 *    one — a plain `z.union([z.string(), z.number()])` handed an object —
 *    nothing is selected and the union reports exactly what it always has.
 * 2. **Fewest issues wins.** The branch the author was closest to hitting
 *    complains least, so "fewest" is what keeps ONE unknown key from arriving as
 *    N `issues[]` entries, one per branch.
 * 3. **A branch carrying `unrecognized_keys` breaks a tie**, because that is
 *    where the curated prose lives.
 * 4. Declaration order breaks what remains, so the envelope is deterministic.
 *
 * Branches that tie at the top are all emitted (capped): when two shapes explain
 * the failure equally well, privileging the first by accident of declaration
 * order would be a lie about which shape was expected.
 */
function selectUnionBranches(
    branches: readonly (readonly ZodIssueLike[])[],
): readonly (readonly ZodIssueLike[])[] {
    const informative = branches
        .map((issues, index) => ({ issues, index }))
        .filter((branch) => !isKindMismatchOnly(branch.issues));
    if (informative.length === 0) return [];

    const rank = (branch: { issues: readonly ZodIssueLike[] }): [number, number] => [
        branch.issues.length,
        carriesUnknownKey(branch.issues) ? 0 : 1,
    ];

    const sorted = [...informative].sort((a, b) => {
        const [aCount, aKeys] = rank(a);
        const [bCount, bKeys] = rank(b);
        return aCount - bCount || aKeys - bKeys || a.index - b.index;
    });

    const [bestCount, bestKeys] = rank(sorted[0]!);
    return sorted
        .filter((branch) => {
            const [count, keys] = rank(branch);
            return count === bestCount && keys === bestKeys;
        })
        .slice(0, UNION_BRANCH_EMIT_LIMIT)
        .map((branch) => branch.issues);
}

/**
 * One issue → its `issues[]` entries, appended to `out`.
 *
 * An ordinary issue is one entry. An `invalid_union` is its own entry (zod's
 * bare `"Invalid input"`) FOLLOWED by the entries of the branches that explain
 * it, with `path` resolved against the union's own — branch paths are RELATIVE
 * to it, which is the trap #5014 paid for: a branch issue's `path` names a slot
 * inside the union member, not inside the document.
 *
 * The union's entry is kept rather than replaced: it is the only entry naming
 * the slot the client sent, existing consumers already read it, and when every
 * branch is uninformative it is still the whole answer. So the expansion is
 * strictly ADDITIVE — no entry that shipped before this changed is gone or
 * renumbered, only newly accompanied.
 *
 * `seen` de-duplicates entries *within one top-level issue*: two branches that
 * reject the same key with the same words say it once. Union entries themselves
 * are exempt, since two same-path `"Invalid input"` entries can head genuinely
 * different sub-trees.
 *
 * Deliberate divergence from the spec-side renderer: where it prints a trailing
 * "… and N more branches rejected this value", this emits nothing. That line is
 * a rendering affordance for a terminal; an `issues[]` entry is a machine-read
 * record that must name a slot and carry a code, and the omission note has
 * neither.
 */
function collectMetadataIssues(
    issue: ZodIssueLike,
    parentPath: Array<string | number>,
    depth: number,
    seen: Set<string>,
    out: MetadataIssueEntry[],
): void {
    const path = [...parentPath, ...issuePathOf(issue)];
    const branches: readonly (readonly ZodIssueLike[])[] =
        issue?.code === 'invalid_union' && Array.isArray(issue?.errors)
            ? (issue.errors as unknown[]).filter(
                (branch): branch is ZodIssueLike[] => Array.isArray(branch),
            )
            : [];
    const expandable = branches.length > 0 && depth < UNION_EXPANSION_DEPTH_LIMIT;

    const entry: MetadataIssueEntry = {
        path: path.join('.'),
        message: String(issue?.message ?? 'Invalid value'),
        code: issue?.code === undefined ? undefined : String(issue.code),
    };

    if (!expandable) {
        const key = JSON.stringify([entry.path, entry.code, entry.message]);
        if (seen.has(key)) return;
        seen.add(key);
    }
    out.push(entry);
    if (!expandable) return;

    for (const branch of selectUnionBranches(branches)) {
        for (const nested of branch) {
            collectMetadataIssues(nested, path, depth + 1, seen, out);
        }
    }
}

/**
 * Zod issues → the `422 INVALID_METADATA` envelope's `issues[]`.
 *
 * A rejection behind a `z.union` is expanded (#5364): zod folds every branch of
 * a failed union into ONE top-level issue whose message is the literal
 * `"Invalid input"`, so mapping only top-level issues put
 * `[{path: '', message: 'Invalid input', code: 'invalid_union'}]` on the wire —
 * not one field name — while the branch that says WHICH key is wrong (the #4001
 * curated unknown-key prose, the legal enum of a mistyped discriminator) was
 * produced and dropped at the `.map()`.
 *
 * That mattered most HERE of the four consumers of this defect: `ViewMetadataSchema`
 * is itself a top-level union, so EVERY failed `view` save degraded to that one
 * rootless line and Studio's form had nothing to highlight. The other three —
 * `formatZodError` (#4971), `zodIssuesToFields` (#5014), the CLI's
 * `formatZodErrors` (#5341) — lost prescriptions; this one lost field
 * localisation itself.
 *
 * Branch selection is described on {@link selectUnionBranches} and is identical
 * to the other copies by construction.
 */
export function zodIssuesToMetadataIssues(issues: unknown): MetadataIssueEntry[] {
    if (!Array.isArray(issues)) return [];
    const out: MetadataIssueEntry[] = [];
    for (const issue of issues) {
        // A fresh `seen` per top-level issue: de-duplication is about one
        // union's branches agreeing, never about two independent issues.
        collectMetadataIssues(issue as ZodIssueLike, [], 0, new Set<string>(), out);
    }
    return out;
}

/**
 * [#4435/#5138] The 404 a single-record operation answers when the id names no
 * row — the repo's ONE `RECORD_NOT_FOUND` envelope.
 *
 * [#7867] The body moved to `@objectstack/core`
 * (`utils/record-not-found.ts` — full provenance lives there); this is a
 * re-export, so every existing importer of
 * `@objectstack/metadata-protocol`'s `recordNotFoundError` is unchanged and
 * the three producers still share one function object.
 *
 * ⛔ Do not re-declare it here. It moved because a THIRD producer needed it and
 * could not reach this package: `ObjectQL.update()`/`delete()`'s by-id gate
 * lives in `packages/objectql`, whose `/core` entry closure is forbidden by
 * ADR-0076 D2's boundary ratchet from importing `@objectstack/metadata-protocol`
 * at all. A local copy here would be the second spelling #5138 ruled out.
 */
export { recordNotFoundError };

/**
 * A 400 for a `$filter` ARRAY that looks like a filter AST but is not one.
 *
 * The message has to be *actionable from the request*, which is the whole point
 * of rejecting here rather than letting a driver fail later: the caller sent a
 * query parameter, so the error names the offending element and the vocabulary
 * it was checked against — not a driver-internal builder state.
 *
 * Diagnoses the three shapes `isFilterAST` refuses, in the order they occur in
 * practice. #4121. Sibling of {@link unusableFilterError}, which covers the
 * non-array ways a filter fails to become one (#4181); both emit
 * `INVALID_FILTER` so the condition has one wire code however it was reached.
 */
function malformedFilterArrayError(filter: unknown[]): Error {
    const detail = describeMalformedFilter(filter);
    const err: any = new Error(
        `Malformed $filter: ${detail} A filter array is a comparison ` +
        `[field, operator, value], a logical node ["and"|"or", ...conditions], or a ` +
        `list of those. Recognised operators: ${[...VALID_AST_OPERATORS].sort().join(', ')}.`,
    );
    err.status = 400;
    err.code = 'INVALID_FILTER';
    return err;
}

/** The specific reason a filter array failed `isFilterAST`, for the message above. */
function describeMalformedFilter(filter: unknown[]): string {
    const [first, second] = filter;
    const isKeyword = typeof first === 'string' && ['and', 'or'].includes(first.toLowerCase());

    // `["and"]` / `["or"]` with nothing to join. The one shape that still
    // returned every row silently after #3948: the driver sets its join mode,
    // matches no element, and emits no predicate.
    if (isKeyword && filter.length < 2) {
        return `logical node ["${String(first)}"] has no conditions to join.`;
    }
    // A bare triple whose operator is outside the AST vocabulary — the original
    // `before` / `after` / `'not in'` case.
    if (typeof first === 'string' && !isKeyword && typeof second === 'string'
        && !VALID_AST_OPERATORS.has(second.toLowerCase())) {
        return `unrecognised operator "${second}" in [${JSON.stringify(first)}, ...].`;
    }
    // An element that is neither a join keyword nor a nested condition.
    const badIndex = filter.findIndex(
        (item) => !Array.isArray(item)
            && !(typeof item === 'string' && ['and', 'or'].includes(item.toLowerCase())),
    );
    if (badIndex >= 0 && filter.some((item) => Array.isArray(item))) {
        const bad = filter[badIndex];
        return `element ${badIndex} is ${bad === null ? 'null' : typeof bad}, ` +
            `expected a condition array or a logical keyword.`;
    }
    return `${JSON.stringify(filter)} is not a recognised filter shape.`;
}

/**
 * The keys THIS file stamps onto every served document (`_diagnostics` via
 * `decorateMetadataItem`, `_draft` via the draft-preview overlay) — and the
 * strip that keeps them out of a persisted body (#4326) or a strict re-parse
 * (cloud#971).
 *
 * The list itself lives in `@objectstack/spec` because this module PRODUCES the
 * decoration while consumers in other layers (`service-automation`'s cold-boot
 * flow bind, …) have to REMOVE it: one shared definition is what stops the two
 * sides from drifting. See `spec/kernel/metadata-read-decorations.ts` for the
 * full rationale and for why the ADR-0010 protection envelope (`_lock`,
 * `_packageId`, …) is deliberately not stripped despite the shared spelling.
 *
 * Re-exported here so `@objectstack/metadata-protocol`'s public surface is
 * unchanged.
 */
export { stripReadDecorations };

/**
 * Guarantee a `view` body carries a top-level `name`.
 *
 * {@link ObjectStackProtocolImplementation.getMetaItems} only surfaces a
 * sys_metadata overlay row when its parsed body has a top-level `name` (objects
 * and dashboards include one; some view producers — notably loose `{ list }`
 * fragments — do not, so the view is silently dropped from the object's view
 * list and never appears as a tab). We stamp the save name here, at the single
 * write chokepoint, without otherwise reshaping the document.
 *
 * Deliberately does NOT convert shape: both the `defineView` container form
 * (`{ list, listViews, … }`) and the `{ name, object, viewKind, config }`
 * record form are valid and the console consumes both — reshaping a container
 * into a record risks producing an invalid record (e.g. a non-`<object>.<key>`
 * name). Structural validity is enforced separately by the view metadata schema
 * during the spec-validation step. No-op for non-view types and bodies that
 * already carry a `name`.
 *
 * When `baseline` is provided (the registry entry this overlay will shadow),
 * missing identity fields — `viewKind`, `object`, `label` — are inherited onto
 * non-container bodies. A runtime personalization PUT (console column sort,
 * inline edit, …) sends only the raw view config; persisting it verbatim makes
 * the overlay replace the flattened package entry minus its identity, and the
 * view silently drops out of every consumer that filters on
 * `viewKind`/`object` (e.g. the switcher endpoint). See #2555. Container
 * bodies are left untouched — `expandViewContainer` derives identity itself.
 */
export function normalizeViewMetadata(type: string, item: unknown, saveName: string, baseline?: unknown): unknown {
    const singular = PLURAL_TO_SINGULAR[type] ?? type;
    if (singular !== 'view') return item;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const it = item as Record<string, unknown>;
    const patch = viewIdentityPatch(it, baseline);
    if (it.name && !patch) return it;
    return { ...it, ...(it.name ? undefined : { name: saveName }), ...patch };
}

/**
 * Persist the operator spellings the spec's own schema normalized, and nothing
 * else. objectui#2945.
 *
 * `ViewFilterRuleSchema.operator` is `z.preprocess(normalizeFilterOperator, …)`,
 * so a stored `notEquals` / `gt` / `isNull` is folded to its canonical form
 * during validation — and then the result was thrown away, because `saveMeta`
 * persists the authored body verbatim (deliberately: `parsed.data` strips the
 * Studio-only auxiliary fields that ride along with an overlay). The alias table
 * `VIEW_FILTER_OPERATOR_ALIASES` therefore keeps acquiring *new* rows with every
 * save, which is why it can never be retired: there is no point at which the
 * last alias row is behind you.
 *
 * This grafts the normalization back on without giving up the verbatim body.
 * It walks the authored value and the parsed value in lockstep **by structure**
 * and copies across exactly one thing: an `operator` whose parsed value differs
 * from the authored one. No key list to maintain — every filter site the schema
 * knows about is covered, including ones added later — and nothing is added,
 * removed, reordered or defaulted, so an auxiliary field cannot be lost the way
 * a wholesale `parsed.data` swap would lose it.
 *
 * Returns the input itself when nothing changed, so the common case allocates
 * nothing.
 */
export function graftNormalizedOperators(authored: unknown, parsed: unknown): unknown {
    if (Array.isArray(authored)) {
        if (!Array.isArray(parsed)) return authored;
        let changed = false;
        const out = authored.map((entry, i) => {
            const next = graftNormalizedOperators(entry, parsed[i]);
            if (next !== entry) changed = true;
            return next;
        });
        return changed ? out : authored;
    }

    if (!authored || typeof authored !== 'object') return authored;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return authored;

    const a = authored as Record<string, unknown>;
    const p = parsed as Record<string, unknown>;
    let patch: Record<string, unknown> | undefined;

    for (const [key, value] of Object.entries(a)) {
        // The one value this function is allowed to rewrite. Guarded on both
        // sides being strings so a `$`-token condition object — a different
        // operator vocabulary entirely — cannot be reshaped by accident.
        if (key === 'operator' && typeof value === 'string' && typeof p[key] === 'string') {
            if (p[key] !== value) (patch ??= {})[key] = p[key];
            continue;
        }
        const next = graftNormalizedOperators(value, p[key]);
        if (next !== value) (patch ??= {})[key] = next;
    }

    return patch ? { ...a, ...patch } : authored;
}

/**
 * Persist the `groups` → `sections` fold the spec's own schema performed, and
 * nothing else. #7134, the save-path half of #6926 / PR #7128.
 *
 * `FormViewSchema` carries `foldFormGroupsIntoSections` as a `.overwrite()`
 * check, so a form authored with the legacy `groups` alias parses to one
 * carrying canonical `sections` — and then the result was thrown away, because
 * `saveMeta` persists the authored body verbatim (deliberately: `parsed.data`
 * strips the Studio-only auxiliary fields that ride along with an overlay). A
 * Studio-saved public form therefore reached every `sections`-reading consumer
 * still spelled `groups`, and `packages/rest`'s three `/forms/:slug` routes
 * degrade on exactly that: an empty published field schema, an empty
 * `allowedFields` whitelist on submit (#6920), and `403 LOOKUP_NOT_PUBLIC` for
 * every field. Same shape of gap as {@link graftNormalizedOperators}, and the
 * same consequence — while saves keep minting the authored spelling, the alias
 * can never be retired and the objectui-side folds cannot be removed.
 *
 * ## Why this is a SIBLING of {@link graftNormalizedOperators}, not a parameter
 *
 * That function walks authored and parsed in lockstep by structure and copies
 * across a changed SCALAR at a key both sides carry. `groups` → `sections` is a
 * KEY MOVE — one key removed, another added — which its per-key loop cannot
 * express: it iterates the AUTHORED keys and only ever patches a key already
 * there, so it can neither drop `groups` nor introduce `sections`. Measured, not
 * assumed (#7134).
 *
 * ## How the fold is DETECTED, rather than guessed
 *
 * At each structural position the fold is taken to have happened iff the author
 * wrote `groups`, the parse did NOT keep it, and the parse produced `sections`
 * in its place. That is the exact post-condition of
 * `foldFormGroupsIntoSections`, so no list of "places a form can live" is
 * maintained here: the top-level flattened overlay, `config` on a `ViewItem`,
 * and `form` / `formViews.*` on a container are all covered by the same walk,
 * and a form slot added later is covered without an edit. A `groups` key the
 * schema keeps (a different vocabulary — `app.zod`'s nav groups, a passthrough
 * record) fails the middle test and is left alone.
 *
 * ## What is moved is the AUTHORED array, not the parsed one
 *
 * `parsed.data`'s sections carry schema defaults (`collapsible`, `collapsed`,
 * `columns`); persisting those would be the wholesale swap this whole design
 * avoids. The authored array moves verbatim — the producer's fold is
 * `FormSectionSchema` → `FormSectionSchema` with no sub-key rewriting, so the
 * moved value is already the canonical one. When the author wrote BOTH keys the
 * producer keeps `sections` and drops `groups`, empty array included; so does
 * this.
 *
 * Returns the input itself when nothing changed, so the common case allocates
 * nothing.
 */
export function graftFoldedFormSections(authored: unknown, parsed: unknown): unknown {
    if (Array.isArray(authored)) {
        if (!Array.isArray(parsed)) return authored;
        let changed = false;
        const out = authored.map((entry, i) => {
            const next = graftFoldedFormSections(entry, parsed[i]);
            if (next !== entry) changed = true;
            return next;
        });
        return changed ? out : authored;
    }

    if (!authored || typeof authored !== 'object') return authored;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return authored;

    const a = authored as Record<string, unknown>;
    const p = parsed as Record<string, unknown>;

    // The post-condition of `foldFormGroupsIntoSections`, read off this position.
    const folded = a.groups !== undefined && p.groups === undefined && p.sections !== undefined;

    let patch: Record<string, unknown> | undefined;
    for (const [key, value] of Object.entries(a)) {
        // When the fold fired, the parsed node structurally corresponding to the
        // authored `groups` is `sections` — descending against `p.groups` there
        // would silently stop walking at the one key this function is about.
        const counterpart = folded && key === 'groups' ? p.sections : p[key];
        const next = graftFoldedFormSections(value, counterpart);
        if (next !== value) (patch ??= {})[key] = next;
    }

    if (!folded) return patch ? { ...a, ...patch } : authored;

    const { groups, ...rest } = patch ? { ...a, ...patch } : a;
    // `sections` wins when the author wrote it — including as an empty array,
    // which is what the producer's fold does and therefore what already renders.
    return rest.sections !== undefined ? rest : { ...rest, sections: groups };
}

/**
 * #2555 — compute the identity fields (`viewKind`, `object`, `label`) a view
 * overlay is missing but the registry entry it shadows carries. The overlay's
 * own fields always win. Returns `null` (nothing to inherit) for `defineView`
 * container bodies — their identity is derived at expansion — and for
 * absent/invalid baselines.
 */
function viewIdentityPatch(overlay: Record<string, unknown>, baseline: unknown): Record<string, unknown> | null {
    if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) return null;
    if ('list' in overlay || 'listViews' in overlay || 'formViews' in overlay) return null;
    const b = baseline as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const key of ['viewKind', 'object', 'label'] as const) {
        if (overlay[key] === undefined && b[key] !== undefined) patch[key] = b[key];
    }
    return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * ADR-0010 §3.3 — Overlay the artifact's metadata-protection envelope
 * onto a returned item so artifact-level lock/packageId/provenance
 * always wins over whatever was persisted in the `sys_metadata` overlay
 * row. Returns `item` unchanged when no artifact baseline is available.
 *
 * The artifact's `_lock`, `_lockReason`, `_packageId`, `_packageVersion`,
 * and `_provenance` are the source of truth — an overlay copy may
 * pre-date the artifact's protection declaration and would otherwise
 * mask it.
 */
function mergeArtifactProtection(item: unknown, artifactItem: unknown): unknown {
    if (item === undefined || item === null) return item;
    if (artifactItem === undefined || artifactItem === null) return item;
    const a = artifactItem as Record<string, unknown>;
    if (typeof a !== 'object') return item;
    const out: Record<string, unknown> = { ...(item as Record<string, unknown>) };
    if (a._lock !== undefined) out._lock = a._lock;
    if (a._lockReason !== undefined) out._lockReason = a._lockReason;
    if (a._lockDocsUrl !== undefined) out._lockDocsUrl = a._lockDocsUrl;
    if (a._lockSource !== undefined) out._lockSource = a._lockSource;
    if (a._packageId !== undefined) out._packageId = a._packageId;
    if (a._packageVersion !== undefined) out._packageVersion = a._packageVersion;
    if (a._provenance !== undefined) out._provenance = a._provenance;
    return out;
}

/**
 * ADR-0048 (#1828) — composite dedup identity for the unscoped metadata list.
 *
 * Two installed packages may legitimately ship the same `type`/`name`
 * (e.g. `page/home`); the SchemaRegistry already stores them under distinct
 * `${packageId}:${name}` keys. Any list-merge that deduplicates by bare `name`
 * collapses the two packages' rows into one (last-write-wins), which is the
 * bug this key closes. A `NUL` separator keeps names containing `:` unambiguous.
 *
 * [#7774] `discriminator` is a third component, and it is OPTIONAL on purpose:
 * omitting it produces the exact two-component string this function has always
 * produced, so every type identified by `(package, name)` keeps a
 * byte-identical key and this change's blast radius is provable rather than
 * argued. It is supplied only for a type listed in `ITEM_KEY_DISCRIMINATORS`
 * (`email_template` today), whose identity the spec declares as
 * `(name, locale)` — an i18n bundle. Without it the second locale's
 * `Map.set` overwrote the first and `GET /meta/email_template` served one
 * member of a bundle it had every member of.
 */
function metaItemKey(
    packageId: string | null | undefined,
    name: unknown,
    discriminator?: string,
): string {
    const base = `${packageId ?? ''}\u0000${String(name)}`;
    return discriminator === undefined ? base : `${base}\u0000${discriminator}`;
}

/**
 * [#7774] The bundle discriminator a STORED `sys_metadata` row declares, read
 * off the row's serialized body.
 *
 * The row's own COLUMNS cannot answer this: `sys_metadata`'s overlay
 * uniqueness is `(type, name, organization_id, package_id)` — declared on
 * `idx_sys_metadata_overlay_active` in `sys-metadata.object.ts` — and the
 * table has no locale column at all. An `email_template` overlay's locale
 * lives inside the `metadata` JSON payload, which is where its identity is.
 * So a row-level merge keying on columns alone cannot tell two members of one
 * bundle apart, and the body has to be consulted.
 *
 * The parse is skipped entirely for an undiscriminated type (all but one
 * today): `undefined` comes back before any JSON work, so this costs nothing
 * on the paths it does not serve. A body that fails to parse falls back to the
 * canonical member instead of throwing — the caller a few lines on parses it
 * again for real, and that failure is the one that should surface.
 */
function storedRowDiscriminator(type: string, record: unknown): string | undefined {
    if (!ITEM_KEY_DISCRIMINATORS[type]) return undefined;
    const raw = (record as { metadata?: unknown } | null | undefined)?.metadata;
    let body: unknown = raw;
    if (typeof raw === 'string') {
        try { body = JSON.parse(raw); } catch { body = undefined; }
    }
    return itemDiscriminator(type, body);
}

/**
 * ADR-0048 (#1828) — package-aware overlay merge for the unscoped metadata list.
 *
 * `baseItems` (the lower layer: registry artifacts, or the running result) and
 * `records` (the higher layer: active `sys_metadata` overlays, or draft rows)
 * are merged so that:
 *
 *   • Two installed packages shipping the same `type/name` stay TWO rows —
 *     resolution is per `(package, name)`, not bare `name`, so a higher-layer
 *     row no longer collapses a same-name row from a different package.
 *   • For each package `P` that owns a row of a given name, the winner is the
 *     LATEST contribution that is either `P`'s own row or a package-less
 *     ("global", `package_id IS NULL`) row — mirroring
 *     `getMetaItem(name, packageId=P)`'s "scoped-then-global-fallback"
 *     resolution, so the list and single-item paths agree. This is also why a
 *     legacy row whose active/draft layers disagree on package attribution
 *     still collapses (a package-less active row + its `package_id`-bearing
 *     draft resolve to the one package slot, draft winning).
 *   • A name with NO package-owned row resolves to its latest package-less
 *     contribution — the pre-existing env-wide behaviour, unchanged.
 *
 * `transform(data, prev)` runs on each `records` body before it enters the
 * merge (view-identity healing, draft tagging); `prev` is the base row it
 * shadows at the same slot (or any same-name base row), else undefined.
 *
 * [#7774] The bucket is per SLOT, not per name, and for a type in
 * `ITEM_KEY_DISCRIMINATORS` the slot is `(name, discriminator)`. This is the
 * half of the collapse that #7774's card predicted would need no change, and
 * it needed one: the card reasoned about the OVERLAY rows (correctly — they
 * are unique on `type+name+organization_id+package_id` and carry no locale
 * column), but the rows are only the higher layer. `baseItems` is the
 * SchemaRegistry's listing, and since #7730 that listing carries every member
 * of a bundle. Bucketed by bare name, two members of one bundle landed in one
 * bucket and the loop below emitted exactly one row per `(bucket, package)` —
 * so a single unrelated overlay row for the type was enough to drop a locale,
 * and the surviving row was the overlay body regardless of which member it
 * actually customizes. Slot-keyed, the overlay lands on its OWN member and the
 * others are served untouched. An undiscriminated type's slot is its name, so
 * its buckets are unchanged.
 *
 * @param type Canonical (singular) metadata type of every row being merged.
 */
function mergePackageAwareOverlay(
    type: string,
    baseItems: unknown[],
    records: Array<{ data: unknown; packageId: string | undefined }>,
    transform?: (data: any, prev: any) => any,
): unknown[] {
    // Per-SLOT, layer-ordered contributions; `pkg: undefined` = package-less.
    const buckets = new Map<string, Array<{ pkg: string | undefined; item: any }>>();
    const order: string[] = []; // first-seen slot order → stable output
    const slotOf = (item: unknown, name: unknown): string => {
        const disc = itemDiscriminator(type, item);
        return disc === undefined ? String(name) : `${String(name)}\u0000${disc}`;
    };
    const push = (slot: string, pkg: string | undefined, item: any) => {
        let list = buckets.get(slot);
        if (!list) { buckets.set(slot, (list = [])); order.push(slot); }
        list.push({ pkg, item });
    };

    for (const raw of baseItems) {
        const item = raw as any;
        if (item && typeof item === 'object' && 'name' in item) {
            push(slotOf(item, item.name), (item._packageId ?? undefined) as string | undefined, item);
        }
    }
    for (const { data, packageId } of records) {
        const body = data as any;
        if (!(body && typeof body === 'object' && 'name' in body)) continue;
        // The base row this record shadows at its own slot (for view-identity
        // healing): a same-package row, else a package-less one, else any
        // same-slot row it stands in for.
        const slot = slotOf(body, body.name);
        const list = buckets.get(slot);
        const prev = list
            ? (list.find((c) => c.pkg === packageId)?.item
                ?? list.find((c) => c.pkg === undefined)?.item
                ?? list[0]?.item)
            : undefined;
        push(slot, packageId, transform ? transform(body, prev) : body);
    }

    const out: unknown[] = [];
    for (const slot of order) {
        const list = buckets.get(slot)!;
        const reals = Array.from(new Set(list.filter((c) => c.pkg !== undefined).map((c) => c.pkg)));
        if (reals.length === 0) {
            out.push(list[list.length - 1].item); // latest package-less row wins
            continue;
        }
        for (const real of reals) {
            // getMetaItem(name, real) resolution: latest row that is `real`'s
            // own or package-less (global fallback).
            let chosen: any;
            for (const c of list) {
                if (c.pkg === real || c.pkg === undefined) chosen = c.item;
            }
            if (chosen === undefined) continue;
            // A package-less body standing in for package `real` must carry
            // `real`'s provenance (the base row it replaced was `real`'s).
            if (chosen._packageId === undefined) chosen = { ...chosen, _packageId: real };
            out.push(chosen);
        }
    }
    return out;
}

/**
 * Simple hash function for ETag generation (browser-compatible)
 * Uses a basic hash algorithm instead of crypto.createHash
 */
function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
}

/**
 * Thrown by `updateData` / `deleteData` when the caller supplies an
 * `expectedVersion` that does not match the current record's `updated_at`.
 *
 * The HTTP layer maps this to `409 Conflict` with code `CONCURRENT_UPDATE`,
 * and includes both the current server-side version and the current record
 * payload so the client can render an informed conflict-resolution UI
 * ("Reload latest" vs. "Overwrite anyway").
 *
 * NOTE: This is an *application-level* compare-and-set — not an atomic
 * storage-layer CAS. There is a small TOCTOU window between the version
 * check and the subsequent write. For the conflict frequency this targets
 * (different users seconds-to-minutes apart in B2B record editing) this
 * is more than adequate; a future revision can push the check into the
 * driver's UPDATE statement (`WHERE id=? AND updated_at=?`) for true
 * atomicity.
 */
export class ConcurrentUpdateError extends Error {
    readonly code = 'CONCURRENT_UPDATE';
    readonly status = 409;
    readonly currentVersion: string | null;
    readonly currentRecord: unknown;
    constructor(opts: { currentVersion: string | null; currentRecord: unknown; message?: string }) {
        super(opts.message ?? 'Record was modified by another user');
        this.name = 'ConcurrentUpdateError';
        this.currentVersion = opts.currentVersion;
        this.currentRecord = opts.currentRecord;
    }
}

/**
 * Normalises a version token for comparison. Strips RFC-7232-style quotes
 * (`"…"`) that an HTTP `If-Match` header may carry, trims whitespace, and
 * returns null for empty / nullish input.
 */
function normaliseVersionToken(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (!s) return null;
    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
        return s.slice(1, -1);
    }
    return s;
}

// Lifecycle columns the engine always owns; the clone path drops them by NAME
// so the insert re-stamps fresh values instead of copying the source's. Mirrors
// record-validator's SKIP_FIELDS (system-injected, never author-supplied).
const CLONE_STRIP_FIELDS: readonly string[] = [
    'id', 'created_at', 'created_by', 'updated_at', 'updated_by',
];

/**
 * [#3043] Drop caller-supplied writes to statically `readonly: true` fields from
 * an INSERT payload, at the external DATA-WRITE INGRESS.
 *
 * #2948/#3003 made static `readonly` server-enforced on UPDATE (the engine strips
 * a non-system caller's write). INSERT was left exempt — but for approval/status
 * columns that exemption is the SHORTER attack: instead of the #3003
 * draft-then-PATCH move, a non-system caller can POST a record already
 * `approval_status: 'approved'` in one step. This closes it symmetrically, but at
 * the INGRESS rather than in the engine: every EXTERNAL programmatic create — the
 * REST CRUD route, the GraphQL/MCP dispatcher (`bridge.create` → `callData` →
 * here), and bulk import — lands in the DataProtocol, while TRUSTED internal
 * writers (better-auth's adapter, the metadata repository, the seed loader) call
 * `engine.insert` DIRECTLY and never pass through here. Keeping the strip at the
 * ingress therefore protects every agent/caller path at once WITHOUT stripping
 * the internal writers that legitimately seed read-only columns on create
 * (identity provisioning, provenance stamps, event-log cursors) — the blast
 * radius an engine-level insert strip would have.
 *
 * Silent by contract (like the UPDATE / `readonlyWhen` strips): the forged key is
 * dropped, the create still succeeds, and the engine re-derives the field's
 * `defaultValue` (a forged `approval_status` becomes `draft`, the enforced
 * initial state, not NULL). `isSystem` writes are exempt. `readonlyWhen` stays
 * INSERT-exempt (a conditional lock needs a prior record, which a create lacks).
 * Handles a single record or a batch array.
 *
 * SCOPE — author-defined business objects only. PLATFORM objects (`managedBy`
 * set, or the reserved `sys_` namespace) carry their OWN field-write governance
 * that a silent strip must not pre-empt: e.g. ADR-0086 REJECTS (403) a forged
 * `managed_by:'package'` / `package_id` on `sys_permission_set`, and #3004
 * rejects a forged `owner_id` anchor — several of those columns are `readonly`,
 * so stripping them here would silently swallow the payload the guard is meant to
 * reject. The #3043 threat is app approval/status/verdict fields (the issue's
 * `sporadic_application` / `assessment`), never `sys_`; this is the same
 * platform-vs-authored boundary `applySystemFields` uses for ownership.
 *
 * SCOPE, second boundary — RUNTIME-OWNED field types
 * ({@link RUNTIME_OWNED_FIELD_TYPES}: today `autonumber`) are left to the
 * ENGINE's own insert strip (`stripRuntimeOwnedFields`, #5503), which runs on
 * every insert path including the direct `engine.insert` callers this ingress
 * never sees. Skipping them here removes no protection and prevents this seam
 * from PRE-EMPTING an exemption it does not implement: the engine strip honours
 * `preserveAudit` (#3493 — a historical import reinstating legacy record
 * numbers) while this one knows only `isSystem`. Before #5628 the distinction
 * was academic, because an `autonumber` field carried no `readonly` flag for the
 * loop below to notice; now that `Field.autonumber` injects one, stripping here
 * would silently delete the value a historical import is entitled to keep,
 * BEFORE the engine could apply the whitelist. Author-declared `readonly` on
 * every other type is untouched — the #3043 strip is exactly as wide as it was.
 *
 * SCOPE, third boundary — `preserveAudit` IS NOT READ HERE, DELIBERATELY (#6640).
 * The historical-import exemption (#3493) is an **UPDATE-path rule only**; see
 * {@link warnPreserveAuditIgnoredOnInsert} for the ruling, the reason, and the
 * loud signal a non-system INSERT gets for asking.
 */
function stripReadonlyForInsert(schema: any, data: any, context: any): any {
    if (context?.isSystem) return data;
    if (!schema || schema.managedBy || String(schema.name ?? '').startsWith('sys_')) return data;
    const fields = schema?.fields;
    if (!fields || data == null) return data;
    // [#6640] The UNION of names actually removed, across every row of a batch —
    // the same aggregation `mergeDroppedFieldEvents` applies, and for the same
    // reason: the strip is schema-uniform, so one signal per ingress call is
    // faithful where one per row would be noise.
    const stripped = new Set<string>();
    const stripRow = (row: any): any => {
        if (row == null || typeof row !== 'object') return row;
        let out = row;
        for (const name of Object.keys(fields)) {
            if (!fields[name]?.readonly) continue;
            // [#5628] The engine's runtime-owned strip owns these, with the
            // wider exemption set. See the note above.
            if (RUNTIME_OWNED_FIELD_TYPES.has(String(fields[name]?.type ?? ''))) continue;
            if (!(name in out)) continue;
            if (out === row) out = { ...row };
            delete out[name];
            stripped.add(name);
        }
        return out;
    };
    const result = Array.isArray(data) ? data.map(stripRow) : stripRow(data);
    if (context?.preserveAudit && stripped.size > 0) {
        warnPreserveAuditIgnoredOnInsert(String(schema.name ?? ''), Array.from(stripped));
    }
    return result;
}

/**
 * [#6640] THE loud half of the `preserveAudit` ruling — a non-system INSERT that
 * asks for the historical-import exemption is TOLD it does not exist here.
 *
 * ## The contradiction this closes
 *
 * `FieldSchema.readonly`'s `.describe()` promised the `preserveAudit` exemption
 * (#3493) on BOTH write paths, and `docs/protocol/objectql/security.mdx` agreed.
 * Only UPDATE ever implemented it: `stripReadonlyFields` (objectql's
 * rule-validator) consults `isPreservableUnderAudit`, while this INSERT ingress
 * has never read `preserveAudit` at all — `isSystem` is its only exemption. REST
 * import's `treatAsHistorical` (`rest/src/import-runner.ts`) puts
 * `preserveAudit: true` on the write context and creates through `createData`,
 * i.e. through exactly this seam. So ONE historical import PRESERVED an
 * author-declared `readonly` business column (`closed_at`, `resolved_by`) on the
 * rows it updated and SILENTLY DROPPED it on the rows it created.
 *
 * ## Which half the ruling kept (maintainer, 2026-08-08 — option 2)
 *
 * The **enforcement** is the truth and the **contract** was narrowed to it: the
 * exemption is UPDATE-only, and this entry keeps honouring `isSystem` alone.
 * Honouring `preserveAudit` here instead would have handed a NON-system caller —
 * `treatAsHistorical` arrives on an ordinary REST import request — the ability to
 * seed the approval/status columns #3043 exists to protect, in one POST. That is
 * the #3043 threat model reversed, for a capability with no measured consumer:
 * replaying archival readonly facts on INSERT is available today, from a system
 * context, which is what the in-repo importer can run as.
 *
 * ## Why it is a WARNING and not a throw — measured, not assumed
 *
 * The ruling made loudness binding and left the SHAPE to whichever one can be
 * both loud and non-breaking. A throw cannot: `runImport`'s per-row writer
 * collects a write error into `toFailedResult(rowNo, res.error)` rather than
 * aborting the run, so refusing here would not stop a historical import — it
 * would convert every row it CREATES into a failed row, while the rows it
 * updates still succeed. And the trigger is not exotic: the audit family itself
 * (`created_at` / `created_by` / `updated_at` / `updated_by`) is `readonly: true`
 * in the registry's `AUDIT_FIELD_DEFS`, so an ordinary export→historical-import
 * round-trip carries readonly columns on every row. Measured on this branch, a
 * throwing variant took the historical import of 2 new rows from
 * `{created: 2, errors: 0}` to `{created: 0, errors: 2}`. Breaking the shipped
 * `treatAsHistorical` flow for new rows is precisely the condition under which
 * the ruling names the loud WARNING — strip still applied — as the
 * containment-correct landing.
 *
 * The silence this replaces was specific: the drop itself already surfaces
 * through `droppedFields` (#3431), but a caller who EXPLICITLY asked for the
 * exemption could not tell "your fields were stripped by the ordinary #3043
 * rule" from "the exemption you requested does not exist on this path". This
 * says the second one, by name. It fires ONLY when `preserveAudit` was requested
 * AND something was actually removed — a request that loses nothing has nothing
 * to report, and the ordinary non-`preserveAudit` strip is left exactly as quiet
 * as #3043 designed it.
 *
 * Family precedent #5714/#5931: a declared key silently ignored on one branch
 * joins the loud set by default. Those two could reject outright because they
 * judge AUTHORING input, before anything runs; this one sits on a live write
 * path, which is what moves it from throw to warn.
 */
function warnPreserveAuditIgnoredOnInsert(object: string, fields: readonly string[]): void {
    console.warn(
        `[Protocol] preserveAudit is UPDATE-only and was IGNORED on this INSERT` +
        `${object ? ` (object '${object}')` : ''}: the historical-import exemption (#3493) applies when a ` +
        `record is UPDATED, never when it is created, so the readonly field(s) ${fields.join(', ')} were ` +
        `STRIPPED from this create rather than preserved. To replay archival readonly facts on INSERT, ` +
        `write from a system context (\`context.isSystem\`) — a non-system create may not seed a readonly ` +
        `column (#3043/#6640).`,
    );
}

/**
 * [#3431] Recover a `DroppedFieldsEvent` from a before/after write-payload diff.
 *
 * The UPDATE strips (static `readonly` / `readonlyWhen`) run INSIDE the engine,
 * which reports them via the `onFieldsDropped` listener (wired in `updateData`).
 * The CREATE `readonly` strip, however, runs at THIS protocol ingress
 * (`stripReadonlyForInsert`, #3043) — BEFORE the engine — so the engine listener
 * never sees it. Diffing the caller-supplied keys against the stripped payload
 * recovers exactly which supplied fields the ingress strip removed, so the create
 * path can surface them symmetrically with update.
 *
 * Returns `null` when nothing was dropped (same reference, non-object, array, or
 * no key delta) so callers can `if (ev) dropped.push(ev)` without emitting empty
 * events. Mirrors the engine's own before/after key-set diff (`reportDroppedFields`
 * in objectql/engine.ts) so both channels agree on what "dropped" means.
 */
function diffDroppedFields(
    object: string,
    before: unknown,
    after: unknown,
    reason: DroppedFieldsEvent['reason'],
): DroppedFieldsEvent | null {
    if (before === after || before == null || typeof before !== 'object' || Array.isArray(before)) return null;
    const afterObj = (after ?? {}) as Record<string, unknown>;
    const fields = Object.keys(before as Record<string, unknown>).filter((k) => !(k in afterObj));
    return fields.length > 0 ? { object, fields, reason } : null;
}

/**
 * [#3455] Collapse a batch's per-row `DroppedFieldsEvent`s into one event per
 * `(object, reason)` with the UNION of dropped field names.
 *
 * Used by the bulk-create surface (`createManyData`), whose `{ object, records,
 * count }` response has no per-row slot to hang a `droppedFields` on. The
 * insert-ingress strip (#3043) is static-`readonly` only — schema-uniform, so
 * every row drops the same set — which makes an aggregated view faithful rather
 * than lossy. Returns `[]` when nothing was dropped so callers can spread
 * `...(x.length ? { droppedFields: x } : {})` and keep the omit-when-empty shape.
 * The per-row `insertMany`/`batch` paths keep row precision instead (they have a
 * per-row result to carry it).
 */
function mergeDroppedFieldEvents(events: DroppedFieldsEvent[]): DroppedFieldsEvent[] {
    if (events.length === 0) return [];
    const byKey = new Map<string, { object: string; reason: DroppedFieldsEvent['reason']; fields: Set<string> }>();
    for (const ev of events) {
        const key = `${ev.object}|${ev.reason}`;
        let bucket = byKey.get(key);
        if (!bucket) { bucket = { object: ev.object, reason: ev.reason, fields: new Set() }; byKey.set(key, bucket); }
        for (const f of ev.fields) bucket.fields.add(f);
    }
    return Array.from(byKey.values()).map((b) => ({ object: b.object, fields: Array.from(b.fields), reason: b.reason }));
}

/**
 * One row of a bulk-write result — exactly the `BatchOperationResult` the spec
 * declares (`BatchOperationResultSchema`, spec/api/batch.zod.ts). Aliased to
 * the spec type so tsc pins every batch loop in this file to the wire contract:
 * declared = delivered (#4793; the conformance pin in
 * protocol.batch-row-conformance.test.ts holds the runtime side).
 *
 * History: this was a deliberately divergent legacy shape (`error: string`,
 * `record`, no `index`) that predated the schema; ADR-0119 D4 left it in place
 * so a wire-visible change would not ride along on a bug fix, and #4793 is
 * that tracked reconciliation, shipped in the v17 major window. The rollback
 * marking (#4620) is structured with it: `ROLLED_BACK` / `NOT_ATTEMPTED` are
 * `ApiError.code` values, not message-string prefixes.
 */
type BatchDataRowResult = BatchOperationResult;

/**
 * Map a thrown per-row batch error into the wire's `ApiError` (#4793).
 *
 * `code` keeps the thrown error's own code when it is part of the declared
 * vocabulary (StandardErrorCode ∪ ERROR_CODE_LEDGER — an invented code would
 * make the row fail `BatchOperationResultSchema.parse`, exactly the drift the
 * conformance pin exists to catch loudly rather than ship). Otherwise it
 * derives from the HTTP status when the error carries one, falling back to
 * INTERNAL_ERROR — an unclassified engine throw is a 500 in row form.
 */
function toRowApiError(err: any): ApiError {
    const thrown = typeof err?.code === 'string' && ErrorCode.safeParse(err.code).success
        ? (err.code as ApiError['code'])
        : undefined;
    const status = typeof err?.status === 'number' ? err.status : undefined;
    return {
        code: thrown ?? (status !== undefined ? standardErrorCodeForHttpStatus(status) : 'INTERNAL_ERROR'),
        message: typeof err?.message === 'string' && err.message.length > 0 ? err.message : String(err),
        ...(status !== undefined ? { httpStatus: status } : {}),
    };
}

/**
 * [#7426] Carry a wrapped error's `code` onto its re-wrap — but only when that
 * code is part of the DECLARED vocabulary.
 *
 * ## What it fixes
 *
 * {@link ObjectStackProtocolImplementation.deleteMetaItem} is the one verb in
 * this file that re-wraps rather than rethrows: its two catches build a fresh
 * `Error` carrying the "failed to delete" context, and they carried `status`
 * forward while dropping `code`. Every sibling verb translates `ConflictError`
 * and then `throw err`s the original untouched, so `code` survives there. The
 * consequence was topology-dependent: a `SysMetadataRepository` refusal — the
 * only refusal a CONTROL-PLANE kernel can produce for these types, since
 * `deleteMetaItem`'s own two-tier block is skipped when `environmentId` is
 * undefined — reached the caller as **403 with `code: undefined`**, its code
 * surviving only as prose inside the message, while the identical refusal on a
 * project kernel arrived with `NOT_OVERRIDABLE` intact. ADR-0112 makes the code
 * the machine-readable half of a refusal; a 403 without one is what the ledger
 * exists to prevent.
 *
 * ## Why it is a PREDICATE and not `e.code = err.code`
 *
 * That re-wrap is the exit of every non-conflict failure on the path — genuine
 * driver faults as much as refusals — so an unconditional copy would put a
 * driver's own dialect (`42P01`, `SQLITE_CONSTRAINT`, `ECONNREFUSED`) into the
 * field `ApiErrorSchema.code` declares as a closed union (ADR-0112 D4), which
 * is the drift the ledger exists to stop. The gate is therefore membership in
 * `StandardErrorCode ∪ ERROR_CODE_LEDGER` — verbatim the predicate
 * {@link toRowApiError} above already applies to decide which thrown code may
 * become a wire code. One rule, one place to change it, and a code the engine
 * DID register (`ERR_DATASOURCE_UNAVAILABLE`) is as welcome as one this package
 * threw.
 *
 * ## What it deliberately does not touch
 *
 * `status`. The repository catch's `err?.status ?? 500` and the legacy catch's
 * literal `500` are unchanged — the second is a path with no authorization gate
 * on it, where every failure really is a fault, and moving either is a separate
 * contract decision. Only the `code` rule is unified across the two exits, so
 * the envelope does not vary by which failure kind produced it.
 */
function carryCatalogedErrorCode(target: Error, source: unknown): void {
    const code = (source as { code?: unknown } | null | undefined)?.code;
    if (typeof code === 'string' && ErrorCode.safeParse(code).success) {
        (target as Error & { code?: string }).code = code;
    }
}

/**
 * [#8136] Whether a caught error **declared itself a client-facing refusal** —
 * a 4xx `status` in the ADR-0112 envelope — and its sentence may therefore be
 * quoted back to the caller.
 *
 * ## The rule this answers, and why it is a POSITIVE list
 *
 * This package used to interpolate whatever it caught into the message it
 * threw (`Failed to delete customization overlay: ${err.message}`) and into the
 * `error` strings it collects for a caller. A driver failure on `sys_metadata`
 * therefore reached a client verbatim — `SQLITE_ERROR: no such table:
 * sys_metadata` on a 500, and the same text inside `failed[].error` on the
 * `PACKAGE_DELETE_PARTIAL` 400, where no message-level withhold at any HTTP
 * boundary can reach it because it is not the message. Three downstream
 * sanitizers each had a hole because of it.
 *
 * The cure is Prime Directive #12's: pay the consumer-side tolerance down at
 * the producer. So the question asked here is **not** "does this text look like
 * a driver dump?" — that is `looksLikeInternalErrorLeak`, a heuristic over
 * phrasing, and a phrasing test can only ever know the dialects someone has
 * met. It is the inverse and bounded question: **did we author this sentence
 * for a caller?** A producer that declared 4xx has said the failure is the
 * caller's to fix and has written the remedy into the message — the
 * self-correcting refusals `SysMetadataRepository` raises (`[item_locked]`,
 * `[writable_package_required]`, `[no_draft]`, …) are exactly that, and they
 * must survive intact. Everything else is withheld by DEFAULT, so a dialect
 * this repo has never run is handled correctly without anyone having enumerated
 * it.
 *
 * ## ⛔ NOT the complement of `declaresServerFault`
 *
 * The obvious-looking `!declaresServerFault(err)` (`@objectstack/types`, #5811)
 * is the wrong direction and would reinstate the whole defect: a bare `Error`
 * from a driver declares NOTHING, so it fails that test and would be quoted —
 * and a bare driver `Error` is precisely the case measured here. The two
 * predicates answer different halves and neither is the other's negation:
 * `declaresServerFault` asks a BOUNDARY whether to withhold a declared fault's
 * detail; this asks a PRODUCER whether it is allowed to quote at all, and an
 * undeclared error is never allowed.
 *
 * ## Why `status` alone, when the sibling code rule also checks the catalog
 *
 * {@link carryCatalogedErrorCode} gates on membership in `StandardErrorCode ∪
 * ERROR_CODE_LEDGER` because it writes `ApiErrorSchema.code`, a closed union a
 * driver's own dialect must never enter. A message is free text, so the
 * catalog does not bound it, and the two readings coincide on every refusal
 * that reaches these exits today (each declares both halves). Where they could
 * differ, status-alone is the safe direction: requiring a catalogued code too
 * would blank an authored refusal that happens to carry an uncatalogued one —
 * deleting a #4277 self-correcting message, which is a usability regression in
 * exchange for no disclosure gain.
 *
 * The withheld text never leaves the server: every call site rides the original
 * error on `cause`, which `handleRouteError` / `logWithheldServerFault` print
 * whole — the same posture {@link metadataStoreUnavailableError} already takes.
 */
function declaresClientRefusal(err: unknown): boolean {
    const status = (err as { status?: unknown } | null | undefined)?.status;
    return typeof status === 'number' && status >= 400 && status < 500;
}

/**
 * [#8136] The client-facing sentence for a failed overlay delete: the caller's
 * own refusal when they declared one, and otherwise a stable line that names
 * the operation and quotes nothing.
 *
 * Both of {@link ObjectStackProtocolImplementation.deleteMetaItem}'s re-wrap
 * exits share it, for the reason {@link carryCatalogedErrorCode} gives about
 * `code`: the envelope must not vary by which path served the delete.
 *
 * The `Failed to delete customization overlay` prefix is unchanged, byte for
 * byte — it is the operation description a caller needs and several pins read
 * it. What changes is what follows the colon.
 */
function overlayDeleteFailureMessage(err: unknown, type: string, name: string): string {
    if (declaresClientRefusal(err)) {
        const declared = (err as { message?: unknown } | null | undefined)?.message;
        if (typeof declared === 'string' && declared.length > 0) {
            return `Failed to delete customization overlay: ${declared}`;
        }
    }
    return `Failed to delete customization overlay for ${type}/${name}. `
        + 'The metadata store rejected the delete; the reason is in the server log. '
        + 'Retry once the metadata database is reachable.';
}

/**
 * [#8136] The per-item `error` string a collector puts on its response — the
 * caller's own refusal when they declared one, otherwise a stable fallback.
 *
 * The counterpart of {@link overlayDeleteFailureMessage} for the paths that
 * report failure as DATA rather than by throwing. That distinction is why the
 * producer is the only place this can be fixed: `deletePackage`'s `failed[]`
 * and `cleanups[]` ride onto a `PACKAGE_DELETE_PARTIAL` 400 inside `details`,
 * so no 5xx message withhold at any HTTP boundary ever sees them.
 *
 * @param fallback - what to say when nothing may be quoted. Already the
 *   existing no-message fallback at every call site (`'delete failed'`,
 *   `'cleanup failed'`), so the withheld case reuses the sentence the caller
 *   could already receive rather than inventing a second vocabulary.
 */
function clientFacingFailureText(err: unknown, fallback: string): string {
    if (declaresClientRefusal(err)) {
        const declared = (err as { message?: unknown } | null | undefined)?.message;
        if (typeof declared === 'string' && declared.length > 0) return declared;
    }
    return fallback;
}

/**
 * A batch row that names no record id for an operation that needs one — a
 * caller error, so it carries VALIDATION_FAILED / 400 rather than falling
 * through {@link toRowApiError}'s unclassified-throw default (#4793).
 */
function rowRequiredIdError(operation: 'update' | 'delete'): Error {
    const err = new Error(`Record id is required for ${operation}`) as Error & { code?: string; status?: number };
    err.code = 'VALIDATION_FAILED';
    err.status = 400;
    return err;
}

/**
 * [#5532] The client-facing sentence for "the `sys_metadata` overlay read
 * failed, so I do not know whether this item exists".
 *
 * Deliberately does NOT interpolate the driver's own message. #5437 records
 * why: the REST boundary drops a 5xx's prose unconditionally, and the two
 * write-side 500s in this very file (`Failed to persist customization overlay
 * to sys_metadata: ${dbError.message}`) are the specimen that made it drop —
 * a driver line is nowhere near the length bound, so it arrived intact. The
 * driver error still reaches the operator: it rides as `cause` on the thrown
 * error, and `handleRouteError` / `logWithheldServerFault` print the whole
 * object.
 */
const METADATA_STORE_UNAVAILABLE_MESSAGE =
    'The metadata store could not be read, so whether this item exists is unknown. '
    + 'Retry once the metadata database is reachable.';

/**
 * [#5532] A `sys_metadata` READ that failed for a reason that is NOT "the table
 * has not been provisioned yet" — i.e. the rows may well exist and simply were
 * not seen.
 *
 * 503, not 500: nothing about the REQUEST is wrong, the condition is a
 * dependency outage that may clear, and a caller/proxy SHOULD retry. That is
 * the same verdict `mapDataError` already gives `ERR_DATASOURCE_UNAVAILABLE`.
 * `SERVICE_UNAVAILABLE` is the standard catalog's own code for 503
 * (`HttpStatusErrorCodeMap[503]`, ADR-0112) — a catalogued code rather than an
 * invented string, and no new ledger vocabulary for a distinction no consumer
 * measures today.
 */
function metadataStoreUnavailableError(cause: unknown): Error {
    const err = new Error(METADATA_STORE_UNAVAILABLE_MESSAGE) as Error & {
        code?: string;
        status?: number;
        cause?: unknown;
    };
    err.code = 'SERVICE_UNAVAILABLE';
    err.status = 503;
    err.cause = cause;
    return err;
}

/**
 * [#5532] The terminal "this metadata item does not exist" — structured, so it
 * stops falling out of `mapDataError`'s catch-all.
 *
 * A miss is a 404 with the catalog's own not-found code
 * (`HttpStatusErrorCodeMap[404] === 'RESOURCE_NOT_FOUND'`, and the spelling
 * `GET /meta/:type/:name` already emits from its app-visibility gate). Before
 * this, the throw was a bare `Error`: no `status`, no `code`, so it reached the
 * REST boundary's terminal branch and was answered — verbatim as a 400 before
 * #5489, as a sanitised `500 INTERNAL_ERROR` after it. Both are wrong answers
 * for a plain miss, in opposite directions; neither could be told apart from a
 * genuine fault by any client.
 */
function metadataItemNotFoundError(type: string, name: string): Error {
    const err = new Error(`Metadata item ${type}/${name} not found`) as Error & {
        code?: string;
        status?: number;
    };
    err.code = 'RESOURCE_NOT_FOUND';
    err.status = 404;
    return err;
}

/** What one pass of the `batchData` record loop produced (ADR-0119 D4). */
type BatchDataLoopOutcome = { results: BatchDataRowResult[]; succeeded: number; failed: number };

/**
 * The canonical `QueryAST` surface (`spec/data/query.zod.ts`), enumerated.
 *
 * Typed as `Record<keyof QueryAST, true>` so `tsc` pins it to the spec in BOTH
 * directions: a key added there is a missing-property error here, a key removed
 * there is an excess-property error here. That matters because the set below
 * decides what is a query parameter and what is a field filter — silently
 * drifting from the AST would resurrect exactly the #4134 failure for whatever
 * key was added.
 *
 * The #4286 tombstones (`joins`, `windowFunctions`) still count: `retiredKey()`
 * keeps a retired key in `keyof QueryAST`, so both stay listed — and therefore
 * deliberately stay RESERVED at this boundary while the tombstone lives. That
 * is the right compat posture: a caller still sending one belongs with the
 * prescription, not with a silent `where.joins` filter. When a tombstone ages
 * out (~two majors) and the key leaves the spec, the excess-property error
 * here is the reminder that deleting its line UN-reserves the name — an object
 * field genuinely called `joins` would start resolving as an implicit filter,
 * which is a behavior change to call out in that changeset.
 */
const QUERY_AST_KEYS: Readonly<Record<keyof QueryAST, true>> = {
    object: true, fields: true, where: true, search: true, searchFields: true,
    orderBy: true, limit: true, offset: true, top: true, cursor: true,
    joins: true, aggregations: true, groupBy: true, having: true,
    windowFunctions: true, distinct: true, expand: true,
};

/**
 * [#4254] The two aggregation vocabularies, read off the SPEC's own enums so a
 * function or granularity added there is admitted here without a second edit —
 * the same both-directions pinning `QUERY_AST_KEYS` gets from `keyof QueryAST`.
 * They exist because the in-memory aggregation path answers an unknown member
 * with a silent placeholder (`null` result / raw-value buckets) rather than an
 * error, so the ingress must be the layer that refuses one.
 */
const AGGREGATION_FUNCTIONS: ReadonlySet<string> = new Set(AggregationFunction.options);
const DATE_GRANULARITIES: ReadonlySet<string> = new Set(DateGranularity.options);

/**
 * [#4134] Every query-parameter name `findData` consumes itself, consulted
 * AFTER the alias normalization in `findData` has run — so the wire spellings
 * that get rewritten (`$top`→`top`→`limit`, `select`→`fields`, `sort`→
 * `orderBy`, `filter`/`filters`/`$filter`→`where`, `populate`/`$expand`→
 * `expand`, `skip`→`offset`, …) are already gone by this point and
 * deliberately do NOT appear here. Anything still standing is either a name in
 * this set or a candidate field filter.
 *
 * The structural AST keys (`object`, `joins`, `having`, `windowFunctions`)
 * matter even though no querystring carries them: `POST /data/:object/query`
 * hands its body in as `query`, and that body IS a `Partial<QueryAST>`. Without
 * them, `client.data.query('task', { object: 'task', limit: 5 })` would have
 * its `object` key read as a filter and match zero rows.
 *
 * A name in this set can never be used as an implicit field filter, so an
 * object with a field genuinely called e.g. `count` or `cursor` must filter it
 * through the explicit form (`?filter={"count":3}`). That trade-off predates
 * #4134 for the original members; it is called out here so the next person to
 * add one knows what they are spending.
 */
const RESERVED_LIST_QUERY_PARAMS: ReadonlySet<string> = new Set([
    ...Object.keys(QUERY_AST_KEYS),
    // Transport-only extras the normalizer consumes but the AST does not name.
    'count',        // ?count / $count — response flag, not a projection
    // `searchFields` used to be listed here as such an extra. It is a named
    // AST key since #3899 declared it (ADR-0061 P1), so it now arrives through
    // the spread above and the type-level pin covers it — the hand-maintained
    // copy would have been a second source that could silently fall out of step.
    // Server-derived, never caller input (stripped then re-set from `request`).
    'context',
]);

/**
 * [#4134] High-frequency wrong guesses → the parameter that actually works.
 * Keys are normalized (lower-cased, `_`/`-` stripped) so `pageSize`,
 * `page_size` and `PAGE-SIZE` all land on the same entry.
 *
 * This is a HINT table, not an alias table: nothing here is accepted as input.
 * Adding an entry makes a rejection more helpful; it never makes a request
 * succeed, so it does not create the second de-facto contract Prime Directive
 * #12 warns about.
 */
const QUERY_PARAM_NEAR_MISS: Readonly<Record<string, string>> = {
    // page-size dialects (the #4134 repro: `?pageSize=5` → 200 + empty list)
    pagesize: 'top', persize: 'top', perpage: 'top', pagelimit: 'top',
    rowsperpage: 'top', pagecount: 'top', size: 'top', take: 'top',
    first: 'top', max: 'top', maxresults: 'top', maxrecords: 'top',
    // page-offset dialects
    page: 'skip', pageno: 'skip', pagenum: 'skip', pagenumber: 'skip',
    pageindex: 'skip', start: 'skip', startindex: 'skip', startat: 'skip',
    // sorting
    sortby: 'sort', sortfield: 'sort', sortorder: 'sort', order: 'sort',
    ordering: 'sort',
    // search
    q: 'search', keyword: 'search', keywords: 'search', term: 'search',
    searchterm: 'search', querytext: 'search',
    // filtering
    filterby: 'filter', criteria: 'filter', conditions: 'filter',
    // projection / relations
    columns: 'select', include: 'expand', includes: 'expand', with: 'expand',
};

/**
 * The OData spelling of each parameter {@link QUERY_PARAM_NEAR_MISS} points at.
 * NOT derivable by prefixing `$` — `sort` is `$orderby`, and suggesting a
 * `$sort` that the unsupported-`$` guard rejects would just hand the caller a
 * second 400.
 */
const ODATA_SPELLING: Readonly<Record<string, string>> = {
    top: '$top', skip: '$skip', sort: '$orderby', search: '$search',
    filter: '$filter', select: '$select', expand: '$expand',
};

/**
 * [#3795] The spec's alias table ({@link RPC_QUERY_ALIAS_SLOTS}) extended with
 * the wire-only spellings no schema declares: `filters` (documented plural
 * alias of the `filter` transport param) and the OData `$filter` / `$expand`.
 * Every spelling of one QueryAST slot resolves through ONE fold — the four
 * slots that used to resolve backwards (canonical consulted last), each in its
 * own open-coded way, are the reason the table lives in the spec and not here.
 */
const WIRE_QUERY_ALIAS_SLOTS: readonly QueryAliasSlot[] = (() => {
    const extra: Record<string, readonly string[]> = {
        where: ['filters', '$filter'],
        expand: ['$expand'],
    };
    return RPC_QUERY_ALIAS_SLOTS.map((slot) => ({
        canonical: slot.canonical,
        aliases: [...slot.aliases, ...(extra[slot.canonical] ?? [])],
    }));
})();

/**
 * The OData `$`-prefixed spelling of each bare wire parameter this normalizer
 * consumes, hoisted out of the loop in `findData` that used to own it so the
 * arity survey below and that loop read ONE table (#7321). Adding a `$` alias
 * in one place and not the other is exactly how a parameter ends up folded but
 * unchecked.
 *
 * `$filter` / `$expand` are deliberately absent: they are declared as slot
 * aliases on {@link WIRE_QUERY_ALIAS_SLOTS} instead, because they fold straight
 * to a canonical key rather than to a bare wire spelling.
 */
const WIRE_DOLLAR_ALIASES: readonly (readonly [string, string])[] = [
    ['$top', 'top'],
    ['$skip', 'skip'],
    ['$orderby', 'orderBy'],
    ['$select', 'select'],
    ['$count', 'count'],
    ['$search', 'search'],
    ['$searchFields', 'searchFields'],
];

/**
 * [#7321] The list-query slots whose DECLARED value type admits an array, by
 * canonical key. Everything else this normalizer reads — including a leftover
 * key lowered into an implicit field filter — is single-valued, and an array on
 * it is a repeated wire parameter (see {@link assertQueryParamArity}).
 *
 * This set is the whole judgement. `IHttpRequest.query` is
 * `Record< string, string | string[] >` and the array arm is produced by a real
 * first-party adapter (`NodeHttpServer` hands `?x=1&x=2` through as
 * `['1','2']`, measured over a socket on #6878), so `Array.isArray` at this
 * boundary means one of exactly two things: a repeated querystring parameter,
 * or a JSON array in a `POST /data/:object/query` body. This normalizer serves
 * BOTH ingresses and cannot tell them apart — which is why the rule keys off the
 * declared TYPE rather than off the request. On a slot that never declares an
 * array, `Array.isArray` is unambiguous evidence of repetition; on a slot that
 * does, it is the ordinary shape and must not be touched.
 *
 * Per member, why the array is legal (`packages/spec/src/data/query.zod.ts`):
 *  - `fields`        — `z.array(FieldNodeSchema)`; `?$select=a&$select=b` IS the
 *                      projection `['a','b']`.
 *  - `orderBy`       — `z.array(SortNodeSchema)`, and `normalizeSortNodes` has an
 *                      explicit `string[]` arm: repetition COMPOSES into a
 *                      multi-key sort (`?sort=name&sort=-age`), it does not
 *                      conflict.
 *  - `expand`        — the name-array arm lowers to `{name: {object: name}}`.
 *  - `searchFields`  — `z.array(z.string())`; the engine reads the comma-string
 *                      and the array from either slot.
 *  - `where`         — a FILTER AST is an array (`['status','=','open']`), so a
 *                      blanket arity refusal here would reject the AST body form
 *                      outright. Arity for this slot is judged one layer up, at
 *                      the REST querystring ingress (`assertFilterParamSuppliedOnce`,
 *                      #7390) — the only layer that knows an array on this wire
 *                      is a repetition and can be nothing else. A repeated
 *                      `?filter=` never reaches this block on `GET /data/:object`;
 *                      worse, `?filter=status&filter=%3D&filter=open` spells a
 *                      valid AST and succeeds with a filter nobody expressed.
 *  - `groupBy`       — `z.array(GroupByNodeSchema)`.
 *  - `aggregations`  — `z.array(AggregationNodeSchema)`.
 *  - `joins` / `windowFunctions` — retired ARRAY keys (#4286). The tombstone,
 *                      not an arity refusal, must stay their answer.
 *
 * Deliberately NOT here, each because the spec declares a scalar: `limit`/`top`
 * and `offset` (`z.number()`), `search` (`string | FullTextSearch`), `object`
 * (`z.string()`), `having` (a `FilterCondition` OBJECT — the engine has no AST
 * arm for it), the `count` response flag, and the retired scalars `cursor` /
 * `distinct`.
 */
const ARRAY_VALUED_QUERY_SLOTS: readonly string[] = [
    'fields', 'orderBy', 'expand', 'searchFields', 'where',
    'groupBy', 'aggregations', 'joins', 'windowFunctions',
];

/**
 * [#7321] {@link ARRAY_VALUED_QUERY_SLOTS} expanded to every WIRE spelling that
 * reaches it, derived from the same two tables the fold uses so a new alias
 * cannot silently lose its array arm — the failure mode would be `?$select=a&
 * $select=b` starting to 400, i.e. the damage case this card exists to avoid.
 */
const ARRAY_VALUED_LIST_QUERY_PARAMS: ReadonlySet<string> = (() => {
    const names = new Set<string>(ARRAY_VALUED_QUERY_SLOTS);
    for (const slot of WIRE_QUERY_ALIAS_SLOTS) {
        if (!names.has(slot.canonical)) continue;
        for (const alias of slot.aliases) names.add(alias);
    }
    for (const [dollar, bare] of WIRE_DOLLAR_ALIASES) {
        if (names.has(bare)) names.add(dollar);
    }
    return names;
})();

/**
 * [#7321] A parameter this normalizer reads as single-valued, supplied more
 * than once.
 *
 * ## Why a refusal, and why this code
 *
 * `?$top=1&$top=2` is a well-formed request carrying two irreconcilable
 * intents. Picking one is the silent drop itself, and coercing the pair is
 * worse: `Number(['1','2'])` is `NaN`, so the window reached the driver as
 * `limit: NaN` — driver-dependent behaviour under a 200, never an error. That
 * is the same class #6928 / PR #7299 refused one layer over on
 * `GET /api/v1/notifications`, and the same rule #6307 / #6877 landed in
 * `packages/rest` (`readSingleQueryValue`); the wording below is theirs
 * verbatim so a caller who repeats a parameter on two different routes is told
 * the same thing twice, not two things once.
 *
 * `INVALID_REQUEST` / 400 is what {@link conflictingQueryParamsError} in this
 * same normalizer already answers for the IDENTICAL condition reached the other
 * way — two SPELLINGS of one slot carrying different values (#4181 → #3795).
 * One slot given two values is one defect; it must not carry two codes
 * depending on whether the caller repeated `filter` or wrote `filter` and
 * `where`. (The rest layer spells its 400 `VALIDATION_ERROR` and the runtime
 * layer `VALIDATION_FAILED`; those are each package's house catalog member for
 * a 400, registered per package in `error-code-ledger.zod.ts`. The RULE and the
 * status are what have to agree across the three, and do.)
 *
 * ## Why the count and not the values
 *
 * Two identical values are still two occurrences and are still refused: "at
 * most one DISTINCT value" would be a de-duplication rule no caller can
 * predict, while "supply it at most once" is checkable client-side without
 * knowing anything about our semantics (#6877).
 */
function repeatedQueryParamError(param: string, count: number): Error {
    const err: any = new Error(
        `The '${param}' query parameter was supplied ${count} times. Supply it at most once — `
        + 'this endpoint will not choose between conflicting values. It was NOT applied as a '
        + 'list: a single-valued parameter given an array coerces to a value nobody asked for '
        + `(Number(['1','2']) is NaN), which the driver then answers under a 200.`,
    );
    err.status = 400;
    err.code = 'INVALID_REQUEST';
    err.param = param;
    return err;
}

/**
 * [#7321] Refuse a repeated occurrence of any list-query parameter this
 * normalizer reads as single-valued, and normalise the benign one-element array
 * away so nothing below has to know the union existed.
 *
 * Runs at the TOP of `findData`, ahead of the `$`-alias pass and the #3795 slot
 * fold, for two reasons:
 *
 *  1. The message then quotes the parameter the caller actually wrote — the
 *     #4226 discipline. After the fold, `?$top=1&$top=2` would be reported as
 *     `'limit'`, a name absent from the request.
 *  2. The fold compares slot spellings by `JSON.stringify`, so an unchecked
 *     `?top=1&top=2&limit=1` reaches it as `['1','2']` vs `'1'` and is refused
 *     as a "conflicting query parameters" problem — a true refusal with a false
 *     diagnosis. Checking arity first means the caller is told what is actually
 *     wrong.
 *
 * Length 0 is DELETED rather than set to `undefined` (which is what the rest
 * layer's `refuseRepeatedQueryParams` does with it): the leftover-key bucket
 * below reads `Object.keys(options)`, so a key left behind carrying `undefined`
 * would be lowered into an implicit `{field: undefined}` predicate. "Not
 * supplied" has to mean absent here, not present-and-empty.
 */
function assertQueryParamArity(options: Record<string, unknown>): void {
    for (const name of Object.keys(options)) {
        const value = options[name];
        if (!Array.isArray(value)) continue;
        if (ARRAY_VALUED_LIST_QUERY_PARAMS.has(name)) continue;
        if (value.length > 1) throw repeatedQueryParamError(name, value.length);
        // length 1 → one occurrence an adapter encoded as an array; length 0 →
        // no occurrence at all.
        if (value.length === 0) delete options[name];
        else options[name] = value[0];
    }
}

/**
 * [#4181 → #3795] Spellings of ONE slot carrying DIFFERENT values. Two values
 * for one slot cannot be reconciled — merging them would invent an intent the
 * caller never expressed, and picking one is the silent drop itself — so an
 * ambiguous request is refused. Redundant identical spellings pass. #4181
 * established this on the filter slot; the fold now applies it to all five.
 *
 * `spellingFor` maps each folded name back to the wire spelling the caller
 * actually wrote (`$orderby`, not `orderBy`) — the #4226 discipline.
 */
function conflictingQueryParamsError(
    conflict: QueryAliasConflict,
    spellingFor: (name: string) => string,
): Error {
    const names = conflict.spellings.map((s) => `'${spellingFor(s)}'`).join(', ');
    const err: any = new Error(
        `Conflicting query parameters: ${names} are spellings of the same parameter `
        + `(canonical '${conflict.canonical}') and were given different values. Send exactly one.`,
    );
    err.status = 400;
    err.code = 'INVALID_REQUEST';
    return err;
}

/**
 * [#4181] A filter the normalizer cannot turn into a usable `FilterCondition`
 * by any route other than the array shapes {@link malformedFilterArrayError}
 * already diagnoses: unparseable JSON, or JSON that parses to something no
 * driver can read (a number, a bare string, `null`).
 *
 * Carries `INVALID_FILTER` — the standard-catalog code (`errors.zod.ts`,
 * "Invalid filter expression") that #4121 introduced on this same code path for
 * the array case. One condition, one wire code, however the caller reached it:
 * a `$filter` array with a bad operator and a `?filter=` that is not JSON are
 * the same answer to the same question ("this filter cannot run").
 *
 * The message states the filter was NOT APPLIED, because that is the part a
 * caller cannot infer: the pre-#4181 behavior was an ordinary-looking 200 over
 * the unfiltered set.
 */
function unusableFilterError(param: string, detail: string): Error {
    const err: any = new Error(
        `Query parameter '${param}' ${detail}. It was not applied, and an unapplied `
        + 'filter would have returned the unfiltered result set.',
    );
    err.status = 400;
    err.code = 'INVALID_FILTER';
    err.param = param;
    return err;
}

/**
 * [#6994] Field types whose value NO driver materialises, so no driver can
 * ORDER BY them.
 *
 * `formula` is the whole set today, and deliberately not a synonym for
 * "computed": the three computed types diverge exactly here.
 *
 * | type | column | sortable |
 * |---|---|---|
 * | `formula` | none — `SqlDriver.createColumn` returns early; `driver-turso`'s transport skips it with the same `Virtual — no column` note | **no** |
 * | `summary` | `table.float`, maintained by the engine | yes (measured #6924: `orderBy <summary> desc` -> E D C B A over 5 4 3 2 1) |
 * | `autonumber` | `table.string`, engine-assigned | yes |
 *
 * So the spec's own `COMPUTED_VALUE_TYPES` (`formula`/`summary`/`autonumber`)
 * is the WRITE contract — "never client-written" — and is the wrong set to
 * gate a sort with: it would refuse the two types that sort correctly.
 *
 * This is a local set rather than a shared spec constant because the same fact
 * is currently spelled in five places, none of them in `packages/spec`:
 * `driver-sql`'s `fieldHasColumn` and `createColumn`, `driver-turso`'s
 * `remote-transport`, `objectql`'s `planFormulaProjection` and
 * `search-companion`, and `plugin-audit`'s `VIRTUAL_FIELD_TYPES`.
 * Consolidating them is a cross-package change and is filed separately; adding
 * a sixth local spelling here — with that ledger written down — keeps this fix
 * inside one package rather than opening a spec-wide edit for one string.
 *
 * One deliberate divergence from `fieldHasColumn`: that helper short-circuits
 * on `multiple` (a `multiple` field is a JSON column whatever its type), so it
 * would answer "has a column" for a `multiple` formula. This set does not,
 * because the questions differ — `fieldHasColumn` asks whether DDL emits a
 * column, this asks whether there is a persisted VALUE to order by, and a
 * formula's value is computed on read and never written, so that JSON column
 * is always empty. Ordering by it degrades exactly as the bare case does.
 */
const UNMATERIALIZED_SORT_TYPES: ReadonlySet<string> = new Set(['formula']);

/**
 * [#4226] A sort the normalizer cannot turn into a usable `SortNode[]`, or one
 * that names a field the object does not have — or, since #4256, a dotted path
 * (`account.company_name`) that would have to cross into a related record no
 * driver joins for.
 *
 * Carries `INVALID_SORT` — the standard-catalog code (`errors.zod.ts`,
 * "Invalid sort specification") that had sat in the catalog with no emitter
 * since it was written. One condition, one wire code, however the caller
 * reached it.
 *
 * The message spells out what an unapplied sort costs, because that is the part
 * a caller cannot infer from the response: `sort` + `top` is how you ask for
 * "the latest N", and a dropped sort turns that into an ARBITRARY N with a
 * perfectly ordinary-looking 200 over it. The rows are all there and all real —
 * which is exactly why nobody notices.
 */
function invalidSortError(
    param: string,
    detail: string,
    opts?: { hint?: string, extra?: Record<string, unknown> },
): Error {
    const err: any = new Error(
        `Query parameter '${param}' ${detail}. It was not applied, and an unapplied `
        + "sort returns the rows in an arbitrary order — which 'top'/'limit' then "
        + 'slices into an arbitrary page.'
        + (opts?.hint ?? ''),
    );
    err.status = 400;
    err.code = 'INVALID_SORT';
    err.param = param;
    Object.assign(err, opts?.extra ?? {});
    return err;
}

/**
 * [#4721] A sort node that spells its direction `direction` instead of `order`.
 *
 * This is the one unknown key on this axis that has a KNOWN right answer, so it
 * gets a rejection that carries the translation rather than a generic refusal.
 * `direction` is not a typo — it is the live vocabulary of a neighbouring
 * contract (`IReportService.orderBy`, `spec/src/contracts/report-service.ts`),
 * which `plugin-auth/objectql-adapter.ts` already translates to `order` by hand.
 * A necessary translation nothing enforced is exactly ADR-0049's shape.
 *
 * Measured on `main` before this rejection existed, on the schema side of the
 * same door:
 *
 * ```
 * SortNodeSchema.parse({ field: 'updated_at', direction: 'desc' })
 *   →  { field: 'updated_at', order: 'asc' }
 * ```
 *
 * So the failure was not "unsorted" — it was sorted the OTHER WAY, and with a
 * `limit` that means a different set of rows came back under a 200. Worse than
 * the family `invalidSortError` was built for (#3948, #4226): those return the
 * right rows in an arbitrary order, this one returns the wrong rows.
 *
 * `INVALID_SORT` rather than a new code: one condition — "this sort was not
 * applied as written" — keeps one wire code however the caller reached it.
 */
function invalidSortDirectionKeyError(param: string, field: string): Error {
    return invalidSortError(
        param,
        `spells the sort direction for '${field}' as \`direction\`, which is not a key on this `
        + 'axis — the QueryAST sort node is `{ field, order }`',
        {
            hint:
                ` Write \`{ field: '${field}', order: 'desc' }\`. \`direction\` is`
                + " `IReportService.orderBy`'s vocabulary, a genuinely different contract; on this"
                + ' axis it was silently dropped and `order` fell back to `asc`, so a descending'
                + ' request came back ascending — and with `limit`, a different set of rows.',
            extra: { field, key: 'direction' },
        },
    );
}

/**
 * [#4254] An aggregation-axis value (`groupBy` / `aggregations`) whose SHAPE
 * the spec's `QueryAST` cannot read — a non-array, an entry that names no
 * field, a function or granularity outside the spec enums, a missing alias.
 *
 * Carries `INVALID_QUERY` — the standard-catalog code (`errors.zod.ts`,
 * "Malformed query syntax") that had sat in the catalog with no emitter since
 * it was written, exactly as `INVALID_SORT` had before #4226. Shape mistakes
 * get their own code because they are not about any FIELD: `INVALID_FIELD` on
 * these axes is reserved for a well-formed entry naming a column the object
 * does not have.
 *
 * The message spells out what the dropped/misread value used to do, because
 * that is the part the caller cannot infer: every one of these shapes was
 * silently ignored (rows returned ungrouped) or silently mis-answered
 * (`null` aggregates, one raw-value bucket per row) with an ordinary 200.
 */
function invalidQueryError(
    param: string,
    detail: string,
    opts?: { hint?: string, extra?: Record<string, unknown> },
): Error {
    const err: any = new Error(
        `Query parameter '${param}' ${detail}.`
        + (opts?.hint ?? ''),
    );
    err.status = 400;
    err.code = 'INVALID_QUERY';
    err.param = param;
    Object.assign(err, opts?.extra ?? {});
    return err;
}

/**
 * [#4226] Every wire spelling of `sort`/`orderBy`, folded to the one shape the
 * QueryAST declares (`SortNodeSchema[]`) — or a rejection.
 *
 * Four spellings arrive here today and only two of them ever reached a driver:
 *
 * | spelling | example | before |
 * |:---|:---|:---|
 * | string | `?sort=-created_at` | worked |
 * | `SortNode[]` | `[{field,order}]` | worked |
 * | `string[]` | `['-created_at']` | **dropped** — the client's own declared type (`orderBy?: string \| string[] \| SortNode[]`) |
 * | `Record<field,dir>` | `{created_at:'desc'}` | **dropped** — what `GET /data/:object/export`, `GET /data/import/jobs` and objectui's calendar all emit |
 *
 * The two dropped ones never failed: `SqlDriver` guards its ORDER BY clause
 * with `Array.isArray(query.orderBy)`, so a shape it could not read produced no
 * clause at all. `GET /data/import/jobs` has been asking for `created_at desc`
 * and serving insertion order ever since it was written; #4181 taught the
 * export route to REJECT an unparseable `orderby`, but the parsed result then
 * fell into this same hole one layer down.
 *
 * Normalizing here — in the one shared normalizer every ingress funnels through
 * — is what gives `GET /data/:object`, `POST /data/:object/query`, the export
 * route and the runtime dispatcher a single answer instead of four. Anything
 * that still cannot be read as a sort is a 400 rather than a silent no-op: per
 * #3948, an unapplied sort must not look like an applied one.
 *
 * [#4721] One key gets named treatment on top of that: a node written
 * `{ field, direction }` is refused with {@link invalidSortDirectionKeyError}
 * rather than read as "sort by `field`, direction unspecified". It is the wire
 * half of a door whose schema half is `SortNodeSchema`'s
 * `aliases: { direction: 'order' }` — both closed in one change, because
 * guarding one door only is the asymmetry #1535 shipped and #4522 came back for.
 */
function normalizeSortNodes(value: unknown, param: string): Array<{ field: string, order: 'asc' | 'desc' }> {
    const direction = (raw: unknown, subject: string): 'asc' | 'desc' => {
        if (raw === undefined || raw === null || raw === '') return 'asc';
        const dir = String(raw).trim().toLowerCase();
        if (dir === 'asc' || dir === 'desc') return dir;
        throw invalidSortError(param, `gives ${subject} the direction '${raw}', which is neither 'asc' nor 'desc'`);
    };
    // `-field` / `field` / `field desc` — the querystring shorthand, also used
    // for each element of the `string[]` form.
    const fromShorthand = (raw: string): { field: string, order: 'asc' | 'desc' } | undefined => {
        const trimmed = raw.trim();
        if (!trimmed) return undefined;
        if (trimmed.startsWith('-')) {
            const field = trimmed.slice(1).trim();
            return field ? { field, order: 'desc' } : undefined;
        }
        const [field, order] = trimmed.split(/\s+/);
        return field ? { field, order: direction(order, `'${field}'`) } : undefined;
    };
    const fromElement = (el: unknown, index: number): { field: string, order: 'asc' | 'desc' } | undefined => {
        if (typeof el === 'string') return fromShorthand(el);
        if (el && typeof el === 'object' && !Array.isArray(el)) {
            const node = el as { field?: unknown, order?: unknown };
            if (typeof node.field === 'string' && node.field.trim()) {
                // [#4721] `{ field, direction }` — the wire half of the door
                // `SortNodeSchema`'s `aliases: { direction: 'order' }` closes on
                // the schema side. Checked HERE and not left to the schema
                // because an external caller's `orderBy` never reaches it: this
                // normalizer runs at the ingress, ahead of any QueryAST parse.
                //
                // Rejecting only on a well-formed sort NODE is deliberate. In
                // the sibling `{field: direction}` map form a key named
                // `direction` is an ordinary column name ("sort by the
                // `direction` column"), and that form does not reach this
                // branch — it has no string `field`.
                if ('direction' in node) throw invalidSortDirectionKeyError(param, node.field.trim());
                return { field: node.field.trim(), order: direction(node.order, `'${node.field}'`) };
            }
        }
        throw invalidSortError(
            param,
            `has an entry at position ${index} that names no field (received ${JSON.stringify(el) ?? typeof el})`,
        );
    };

    if (value === undefined || value === null || value === '') return [];
    if (typeof value === 'string') {
        return value.split(',').map(fromShorthand).filter((s): s is { field: string, order: 'asc' | 'desc' } => !!s);
    }
    if (Array.isArray(value)) {
        return value.map(fromElement).filter((s): s is { field: string, order: 'asc' | 'desc' } => !!s);
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>);
        if (entries.length === 0) return [];
        // A single `SortNode` sent unwrapped (`{field:'x',order:'desc'}`) is the
        // one-element array it obviously means; anything else is read as the
        // `{field: direction}` map, whose VALUES must be directions — that check
        // is what stops a stray object being silently accepted as "no sort".
        if (typeof (value as any).field === 'string') return [fromElement(value, 0)!];
        return entries.map(([field, dir]) => ({ field, order: direction(dir, `'${field}'`) }));
    }
    throw invalidSortError(param, `is a ${typeof value}, which names no field to sort by`);
}

/** Fold a parameter name to its near-miss lookup key. */
function nearMissKey(name: string): string {
    return name.toLowerCase().replace(/[_-]/g, '');
}

/** Levenshtein distance, bailed out early once it exceeds `max`. */
function editDistance(a: string, b: string, max: number): number {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const row = [i];
        let best = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
            if (row[j] < best) best = row[j];
        }
        if (best > max) return max + 1;
        prev = row;
    }
    return prev[b.length];
}

/**
 * [#4134] Actionable tail for an unknown list query parameter: the canonical
 * spelling when the caller used a known dialect (`pageSize` → `$top`), else the
 * closest real field name when it reads like a typo (`stauts` → `status`).
 * Returns `''` when nothing is close enough to be worth guessing.
 */
function suggestQueryParam(param: string, knownFields: readonly string[]): string {
    const canonical = QUERY_PARAM_NEAR_MISS[nearMissKey(param)];
    if (canonical) {
        const odata = ODATA_SPELLING[canonical];
        return ` Did you mean the '${canonical}' query parameter`
            + (odata ? ` (OData spelling '${odata}')` : '')
            + '?';
    }
    return suggestFieldName(param, knownFields);
}

/**
 * [#4226] The field-typo half of {@link suggestQueryParam}, on its own.
 *
 * The `sort` / `select` / `expand` axes name a field DIRECTLY, so the
 * parameter-dialect half above is not merely useless there but actively wrong:
 * it would answer `?sort=order` with "did you mean the 'sort' query parameter",
 * which is the parameter the caller already used.
 */
function suggestFieldName(name: string, knownFields: readonly string[]): string {
    const folded = nearMissKey(name);
    // Only worth guessing for names long enough that a small distance is
    // meaningful — at 3 chars everything is within 2 edits of everything.
    if (folded.length >= 4) {
        const max = folded.length <= 5 ? 1 : 2;
        let best: string | undefined;
        let bestDistance = max + 1;
        for (const field of knownFields) {
            const d = editDistance(folded, nearMissKey(field), max);
            if (d < bestDistance) { bestDistance = d; best = field; }
        }
        if (best !== undefined && bestDistance <= max) {
            return ` Did you mean the field '${best}'?`;
        }
    }
    return '';
}

/**
 * [#7534] The logical combinators a `FilterCondition` may carry. These hold
 * NESTED CONDITIONS rather than naming a field, so {@link collectFilterFieldKeys}
 * descends through them instead of judging them.
 *
 * Exactly the three the contract declares (`FilterConditionSchema`,
 * `@objectstack/spec`) — `$and` / `$or` / `$not`. `$nor` is deliberately absent:
 * it is a driver-INTERNAL lowering (`driver-memory` rewrites an input `$not`
 * into a one-operand `$nor`, MongoDB's document-level negation) and is REFUSED
 * as input vocabulary by that same driver, so a `$nor` arriving on the wire is
 * not a combinator this layer should silently descend into.
 */
const FILTER_LOGICAL_KEYS: ReadonlySet<string> = new Set(['$and', '$or', '$not']);

/**
 * [#7534] Every key of a `FilterCondition` that NAMES A FIELD, structure
 * discarded — whether a predicate sits under an `$or` changes nothing about
 * whether its column exists.
 *
 * Two rules, and both are deliberately conservative in the direction that
 * cannot invent a rejection:
 *
 * - **A `$`-prefixed key is never a field.** `$and`/`$or`/`$not` are recursed
 *   into; any OTHER `$` key is skipped WITHOUT descending. An unrecognised
 *   combinator therefore leaves the fields beneath it ungated — a hole, not a
 *   false 400 — which is the right failure direction for a gate whose whole
 *   purpose is to stop wrong answers, not to invent new ones.
 * - **A field key's VALUE is not descended into.** It is either an operator bag
 *   (`{$gte: 18}`) or a nested-relation condition (`{owner: {region: 'NA'}}`),
 *   and the latter's keys belong to a DIFFERENT object whose field map this
 *   gate has not resolved. Judging them against THIS object's fields would
 *   refuse legitimate relation filters. The head segment — `owner` — is a field
 *   of this object and IS judged, which is the same reach
 *   {@link ObjectStackProtocolImplementation.assertQueryParamsAreFields} has on
 *   a dotted path (`owner_id.name`).
 *
 * `depth` is a cheap backstop against a self-referential `where`. JSON cannot
 * produce one, but `POST /data/:object/query` is not the only door — the RPC
 * dispatcher and in-process callers hand over live objects — and a gate that
 * can hang the read path is worse than the defect it closes.
 */
function collectFilterFieldKeys(
    where: unknown,
    out: string[] = [],
    depth = 0,
): string[] {
    if (depth > 32) return out;
    if (!where || typeof where !== 'object' || Array.isArray(where)) return out;
    for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
        if (key.startsWith('$')) {
            if (!FILTER_LOGICAL_KEYS.has(key)) continue;
            if (Array.isArray(value)) {
                for (const arm of value) collectFilterFieldKeys(arm, out, depth + 1);
            } else {
                collectFilterFieldKeys(value, out, depth + 1);
            }
            continue;
        }
        out.push(key);
    }
    return out;
}

/**
 * Service Configuration for Discovery
 * Maps service names to their routes and plugin providers.
 *
 * A missing `route` means the service has NO HTTP surface — discovery must
 * not advertise a route for it (ADR-0076 D12, #2462: an advertised route
 * with no mounted handler 404s and misleads consumers). Such entries carry
 * `noHttpSurface` instead, stating how to report an occupant that does not
 * self-describe: `realtime`'s advertised capability IS the missing HTTP/WS
 * surface, so an in-process bus is `degraded`; `cache`/`queue`/`job` are
 * kernel-internal contracts fully served in-process (#4318), so an unmarked
 * real implementation stays `available`. Either way `handlerReady` is
 * reported `false` — for a route-less slot it is not a proxy for anything,
 * it is the fact itself.
 */
/**
 * [#4093 follow-up] `plugin` is no longer written here. It named the package a
 * consumer should install, and ten of the fifteen names did not exist —
 * `plugin-redis` / `plugin-bullmq` / `job-scheduler` / `plugin-notifications` /
 * `plugin-storage` / `plugin-automation` / `ui-plugin`, plus `plugin-ai`,
 * `plugin-search` and `plugin-workflow` for slots nothing implements at all.
 * The value is surfaced as discovery's `provider` and as its remedy line, so a
 * wrong name is a dead end handed to whoever is trying to fix their stack.
 *
 * It now comes from `CORE_SERVICE_PROVIDER` in `@objectstack/spec/system`, the
 * one table both discovery builders read, verified against what actually
 * registers each slot and guarded by `scripts/check-service-providers.mjs`.
 * Only the ROUTE stays local — that is this builder's own knowledge.
 */
const SERVICE_CONFIG: Record<string, {
    route?: string;
    /** Route-less slots only: status + message for an occupant with no self-description. */
    noHttpSurface?: { statusWhenUnmarked: 'available' | 'degraded'; message: string };
}> = {
    // Plugin-provided like every other optional service since the degraded
    // ObjectQL fallback was retired (#3891): advertised iff the real engine
    // is registered — never hardcoded 'available' (the pre-#2462 lie the
    // fallback existed to paper over).
    analytics:    { route: '/api/v1/analytics' },
    auth:         { route: '/api/v1/auth' },
    automation:   { route: '/api/v1/automation' },
    // Kernel-internal slots (#4318): their providers (service-cache/-queue/
    // -job) mount no HTTP routes — these are in-process contracts, not HTTP
    // capabilities, so there is no route to advertise and never will be. The
    // /api/v1/cache|queue|jobs paths this table used to declare existed
    // nowhere else in the repository; every default boot advertised them next
    // to the fallbacks' own `handlerReady: false` — a single ServiceInfo
    // contradicting itself.
    cache:        { noHttpSurface: { statusWhenUnmarked: 'available', message: inProcessServiceMessage('cache') } },
    queue:        { noHttpSurface: { statusWhenUnmarked: 'available', message: inProcessServiceMessage('queue') } },
    job:          { noHttpSurface: { statusWhenUnmarked: 'available', message: inProcessServiceMessage('job') } },
    ui:           { route: '/api/v1/ui' },
    // `workflow: { route: '/api/v1/workflow' }` retired with the slot (#4451,
    // v17): nothing ever registered or resolved it (ADR-0115 Evidence 5) and
    // no host ever mounted the path. State machines are `state_machine`
    // validation rules; approvals are flow nodes (ADR-0019).
    // service-realtime is an in-process pub/sub bus; nothing mounts
    // /api/v1/realtime, so no route is advertised (D12, #2462). Unlike the
    // kernel-internal slots above, the capability this slot advertises is
    // realtime push to clients — without a surface that IS reduced, so an
    // unmarked bus reports degraded. Message matches the dispatcher builder.
    realtime:     { noHttpSurface: { statusWhenUnmarked: 'degraded', message: 'In-process event bus only — no HTTP/WS realtime surface is mounted' } },
    notification: { route: '/api/v1/notifications' },
    ai:           { route: '/api/v1/ai' },
    i18n:         { route: '/api/v1/i18n' },
    // `graphql: { route: '/graphql' }` was here until #4451. It was never a
    // `CoreServiceName`, so nothing could ever occupy the slot and the entry
    // was unreachable — but it declared a path the dispatcher had already
    // removed as out of the product plan (`http-dispatcher.ts`: "/graphql
    // removed — GraphQL is not in the product plan", #2462 follow-on). A
    // route nobody serves, for a slot that does not exist, in the table SDKs
    // and AI clients read.
    'file-storage': { route: '/api/v1/storage' },
    search:       { route: '/api/v1/search' },
};

/**
 * Phase 3a-references: hand-curated reference path registry.
 *
 * Maps a *target* metadata type to the list of *source* type+path tuples
 * that may point at it. Used by {@link findReferencesToMeta} to scan all
 * loaded metadata and surface "what depends on this?" before a user
 * deletes or renames an artifact.
 *
 * Path syntax:
 *   - `'foo'`            → item.foo
 *   - `'foo.bar'`        → item.foo.bar
 *   - `'foo[]'`          → each element of array item.foo
 *   - `'foo[].bar'`      → bar of each element of array item.foo
 *   - `'foo{}'`          → each value of Record item.foo
 *   - `'foo{}.bar'`      → bar of each value of Record item.foo
 *
 * Coverage is intentionally narrow — covers the highest-value references
 * for MVP. Add more entries as new editors are built.
 */
const REFERENCE_PATHS: Record<string, Array<{ fromType: string; paths: string[]; kind: string }>> = {
    object: [
        { fromType: 'view', paths: ['object', 'objectName'], kind: 'view' },
        { fromType: 'dashboard', paths: ['widgets[].object', 'widgets[].objectName'], kind: 'dashboard widget' },
        { fromType: 'flow', paths: ['object', 'context.object', 'trigger.object', 'targetObject'], kind: 'flow' },
        // fromType 'workflow' removed (#4451): no such metadata type is
        // registered, so the row scanned nothing.
        { fromType: 'permission', paths: ['objects[].name', 'objects[].object'], kind: 'permission' },
        { fromType: 'app', paths: ['navItems[].objectName', 'navItems[].object', 'tabs[].objectName', 'tabs[].object'], kind: 'app nav' },
        { fromType: 'page', paths: ['object', 'objectName'], kind: 'page' },
        { fromType: 'report', paths: ['object', 'objectName'], kind: 'report' },
        { fromType: 'action', paths: ['object', 'objectName'], kind: 'action' },
        // fromType 'validation' removed (#4509): it scanned `object`/`objectName`
        // on a schema that has neither — every variant is strict, so parse would
        // have stripped such a key anyway — and the kind is now retired
        // (ADR-0088). Rules travel with their object, so a rule's dependency on
        // that object needs no row: deleting the object takes them with it.
        { fromType: 'hook', paths: ['object', 'objectName'], kind: 'hook' },
        { fromType: 'object', paths: ['fields[].referenceTo', 'fields{}.referenceTo', 'fields{}.reference'], kind: 'field reference' },
    ],
    view: [
        { fromType: 'dashboard', paths: ['widgets[].view', 'widgets[].viewName'], kind: 'dashboard widget' },
        { fromType: 'app', paths: ['navItems[].viewName', 'tabs[].viewName'], kind: 'app nav' },
        { fromType: 'page', paths: ['viewName'], kind: 'page' },
    ],
    tool: [
        { fromType: 'agent', paths: ['tools[]', 'tools[].name'], kind: 'agent tool' },
    ],
    skill: [
        { fromType: 'agent', paths: ['skills[]', 'skills[].name'], kind: 'agent skill' },
    ],
    flow: [
        { fromType: 'app', paths: ['navItems[].flowName', 'tabs[].flowName'], kind: 'app nav' },
    ],
    dashboard: [
        { fromType: 'app', paths: ['navItems[].dashboardName', 'tabs[].dashboardName'], kind: 'app nav' },
    ],
    page: [
        { fromType: 'app', paths: ['navItems[].pageName', 'tabs[].pageName'], kind: 'app nav' },
    ],
};

/**
 * Extract one or more string values from `item` at `path`. Supports
 * `'a.b'` (nested object access) and `'a[].b'` (array element access).
 * Returns an empty array if any segment is missing.
 */
function extractPathValues(item: unknown, path: string): string[] {
    if (!item || typeof item !== 'object') return [];
    const segments = path.split('.');
    let current: unknown[] = [item];
    for (const rawSeg of segments) {
        let kind: 'value' | 'array' | 'record' = 'value';
        let seg = rawSeg;
        if (seg.endsWith('[]')) {
            kind = 'array';
            seg = seg.slice(0, -2);
        } else if (seg.endsWith('{}')) {
            kind = 'record';
            seg = seg.slice(0, -2);
        }
        const next: unknown[] = [];
        for (const node of current) {
            if (!node || typeof node !== 'object') continue;
            let value: unknown;
            if (seg === '') {
                value = node;
            } else {
                value = (node as Record<string, unknown>)[seg];
            }
            if (value === undefined || value === null) continue;
            if (kind === 'array') {
                if (Array.isArray(value)) {
                    for (const v of value) next.push(v);
                }
            } else if (kind === 'record') {
                if (Array.isArray(value)) {
                    for (const v of value) next.push(v);
                } else if (typeof value === 'object') {
                    for (const v of Object.values(value as Record<string, unknown>)) next.push(v);
                }
            } else {
                next.push(value);
            }
        }
        current = next;
        if (current.length === 0) return [];
    }
    // Coerce final values to strings, dropping non-string non-object leaves.
    const out: string[] = [];
    for (const v of current) {
        if (typeof v === 'string' && v.length > 0) out.push(v);
        else if (v && typeof v === 'object' && 'name' in (v as any) && typeof (v as any).name === 'string') {
            out.push((v as any).name);
        }
    }
    return out;
}

/**
 * Phase 3a-destructive: detect changes between an existing object schema
 * and an incoming overlay that would break runtime data — removed fields,
 * field type narrowing, required toggled on without a default. Returned
 * issues are surfaced as HTTP 409 `destructive_change` unless the caller
 * sets `force: true`, letting the admin UI render a warning dialog before
 * proceeding.
 *
 * Scope is intentionally narrow for MVP: covers the most common
 * data-loss footguns for `object` and `field` types. Subsequent passes
 * can layer in relationship changes, enum-value removals, etc.
 */
/**
 * Shallow JSON diff used by `diffMetaItem`. Compares the top-level
 * keys of `from` vs `to`; primitive value changes are reported as
 * `changed`, nested objects/arrays that differ structurally are also
 * reported as a single `changed` entry (deep structural diffs are out
 * of scope — Studio renders the full bodies for a side-by-side view).
 */
function diffShallow(
    from: Record<string, unknown>,
    to: Record<string, unknown>,
): {
    added: Array<{ path: string; value: unknown }>;
    removed: Array<{ path: string; value: unknown }>;
    changed: Array<{ path: string; from: unknown; to: unknown }>;
} {
    const added: Array<{ path: string; value: unknown }> = [];
    const removed: Array<{ path: string; value: unknown }> = [];
    const changed: Array<{ path: string; from: unknown; to: unknown }> = [];
    const fromKeys = new Set(Object.keys(from ?? {}));
    const toKeys = new Set(Object.keys(to ?? {}));
    for (const k of toKeys) {
        if (!fromKeys.has(k)) {
            added.push({ path: k, value: (to as any)[k] });
        } else {
            const a = (from as any)[k];
            const b = (to as any)[k];
            const aStr = JSON.stringify(a);
            const bStr = JSON.stringify(b);
            if (aStr !== bStr) {
                changed.push({ path: k, from: a, to: b });
            }
        }
    }
    for (const k of fromKeys) {
        if (!toKeys.has(k)) {
            removed.push({ path: k, value: (from as any)[k] });
        }
    }
    return { added, removed, changed };
}

function detectDestructiveObjectChanges(prev: any, next: any): Array<{
    code: string;
    field?: string;
    message: string;
}> {
    if (!prev || typeof prev !== 'object' || !next || typeof next !== 'object') return [];
    const prevFields = (prev.fields && typeof prev.fields === 'object') ? prev.fields as Record<string, any> : {};
    const nextFields = (next.fields && typeof next.fields === 'object') ? next.fields as Record<string, any> : {};

    const issues: Array<{ code: string; field?: string; message: string }> = [];

    // Removed fields — silently dropping a column is a data-loss event.
    for (const fname of Object.keys(prevFields)) {
        // Skip system fields — those are managed by applySystemFields and
        // re-injected on every registerObject call; they will look "removed"
        // in any user-supplied overlay.
        if (prevFields[fname]?.system) continue;
        if (!(fname in nextFields)) {
            issues.push({
                code: 'field_removed',
                field: fname,
                message: `Field '${fname}' removed — existing data in this column will become inaccessible.`,
            });
        }
    }

    // Field type changes — narrowing or incompatible conversions.
    const TYPE_COMPATIBILITY: Record<string, Set<string>> = {
        text: new Set(['textarea', 'markdown', 'html', 'code']),
        number: new Set([]),
        boolean: new Set([]),
        date: new Set(['datetime']),
        datetime: new Set(['date']),
    };
    for (const fname of Object.keys(nextFields)) {
        const prevField = prevFields[fname];
        const nextField = nextFields[fname];
        if (!prevField) continue; // brand-new field — non-destructive
        const prevType = prevField.type;
        const nextType = nextField.type;
        if (prevType && nextType && prevType !== nextType) {
            const compatible = TYPE_COMPATIBILITY[prevType]?.has(nextType);
            if (!compatible) {
                issues.push({
                    code: 'field_type_change',
                    field: fname,
                    message: `Field '${fname}' type changed from '${prevType}' to '${nextType}' — existing values may not convert cleanly.`,
                });
            }
        }
        // required toggled on without a default — new inserts will start
        // to fail validation, and any null rows already in the table will
        // fail on next save.
        if (!prevField.required && nextField.required && nextField.defaultValue === undefined) {
            issues.push({
                code: 'field_required_no_default',
                field: fname,
                message: `Field '${fname}' is now required but has no default value — existing rows with null values may fail validation.`,
            });
        }
    }
    return issues;
}

/**
 * Result of projecting a published metadata body into its data-plane
 * representation. `success:false` with an `error` is the surfaced-not-thrown
 * failure contract — publishing the metadata itself always succeeds.
 */
export interface PublishMaterializeResult {
    success: boolean;
    inserted: number;
    updated: number;
    error?: string;
}

/**
 * Publish-time materializer (ADR-0086 P2). Receives the just-published body
 * plus the draft's package binding and org scope. Registered per metadata type
 * via {@link ObjectStackProtocolImplementation.registerPublishMaterializer}.
 */
export type PublishMaterializer = (args: {
    body: unknown;
    packageId: string | null;
    organizationId: string | null;
    actor: string;
}) => Promise<PublishMaterializeResult>;

/**
 * Uninstall-time data-plane cleanup (ADR-0086 D3, #2747). The exact mirror of
 * {@link PublishMaterializer}: domain plugins own data-plane tables the
 * protocol layer must not know the shape of (e.g. plugin-security's
 * `sys_permission_set` and its binding tables), so they register a named
 * cleanup here and {@link ObjectStackProtocolImplementation.deletePackage}
 * invokes every cleanup with the uninstalled package id. Cleanups run
 * best-effort — a failure is REPORTED on the uninstall response (`cleanups`),
 * never thrown — but ghost grants are a security condition, so callers must
 * surface a failed cleanup, not swallow it.
 */
export type UninstallCleanup = (args: {
    packageId: string;
    organizationId?: string;
    actor?: string;
}) => Promise<{ success: boolean; removed: number; error?: string }>;

/** Per-cleanup outcome reported on the `deletePackage` response. */
export interface UninstallCleanupOutcome {
    name: string;
    success: boolean;
    removed: number;
    error?: string;
}

/**
 * Post-persistence metadata-mutation notification (#2588). Emitted by
 * `saveMetaItem` / `publishMetaItem` / `deleteMetaItem` AFTER the write
 * landed. `type` is the singular metadata type name. Subscribe via
 * {@link ObjectStackProtocolImplementation.onMetadataMutation}.
 */
export interface MetadataMutationEvent {
    type: string;
    name: string;
    /** Resulting lifecycle state of the row the mutation produced. */
    state: 'active' | 'draft' | 'deleted';
    organizationId?: string | null;
}

/**
 * Awaited per-type mutation projector (ADR-0094). Invoked AFTER a metadata
 * mutation persists — `saveMetaItem` (draft AND active saves),
 * `publishMetaItem`, `deleteMetaItem` — and AWAITED before the write returns,
 * so a data-plane read-model derived from the metadata (e.g. `permission` →
 * `sys_permission_set`) is already consistent when the caller's next read
 * lands. This is what makes such a read-model a PURE projection: the
 * projector is its only writer, and it runs in the same awaited operation as
 * every metadata write, instead of a fire-and-forget subscriber a new write
 * path might race or forget.
 *
 * Complements (does not replace) {@link MetadataMutationEvent} listeners,
 * which stay fire-and-forget for cache-invalidation consumers.
 *
 * Best-effort: a projector failure is surfaced on the write's response
 * (`projectionApplied: { success:false, error }`) and logged, never thrown —
 * the metadata write itself already succeeded, and boot reconciliation heals
 * the projection on next start.
 *
 * `body` carries the just-persisted item when the mutation has one in hand
 * (save/publish); projectors that need the EFFECTIVE (layered) body should
 * re-read it — a delete, for instance, may reveal the artifact baseline.
 */
export type MetadataMutationProjector = (
    evt: MetadataMutationEvent & { body?: unknown },
) => Promise<void>;

/** Per-write outcome of the awaited mutation projector (ADR-0094). */
export interface MutationProjectionOutcome {
    success: boolean;
    error?: string;
}

/**
 * Pre-persistence authoring gate (ADR-0094 addendum seam; #3050).
 *
 * Unlike the post-persist {@link MetadataMutationProjector} (best-effort,
 * never thrown), an authoring gate runs BEFORE persistence and REJECTS the
 * write by throwing — it is the seam for domain invariants that must hold on
 * every runtime-authored body regardless of which HTTP surface produced it
 * (e.g. plugin-security's OWD posture gate: an environment may only TIGHTEN
 * a packaged object's `sharingModel`, and `externalSharingModel ≤
 * sharingModel` per ADR-0090 D11).
 *
 * Invoked inside `saveMetaItem` for BOTH draft and publish-mode saves, after
 * the ADR-0005 overlay/runtime-create authorization and the per-type spec
 * validation — so `publishMetaItem` promotes an already-gated body and needs
 * no second gate. Environment writes only: control-plane bootstrap writes
 * (`environmentId === undefined`) are the package author's own channel and
 * bypass the gate, mirroring the ADR-0005 gate above.
 */
export interface MetadataAuthoringGateContext {
    /** Singular type name (e.g. `object`). */
    type: string;
    name: string;
    /** Lifecycle the body is being saved into. */
    state: 'draft' | 'active';
    organizationId?: string;
    /** The body being persisted. */
    body: unknown;
    /** True when a packaged artifact backs this name — the write is an env overlay of shipped metadata. */
    isArtifactBacked: boolean;
    /** The packaged (code-layer) baseline body when {@link isArtifactBacked}; the declaration an overlay customizes. */
    declaredBody?: unknown;
}
export type MetadataAuthoringGate = (ctx: MetadataAuthoringGateContext) => void | Promise<void>;

/**
 * Which authoring channel a kernel's metadata writes arrive on (#6710).
 *
 * ADR-0005 carves out "the package author's own bootstrap channel" from the
 * runtime authoring rules: a control-plane kernel installing a package is not
 * an author publishing into a live tenant, and gating it would refuse the very
 * bodies the platform ships. The carve-out is legitimate and stays.
 *
 * What #6710 changed is **how a kernel says it is that channel**. Until this
 * type existed the answer was inferred from `environmentId === undefined` — a
 * ROW-SCOPING key pressed into service as a topology signal. That proxy lies:
 * the CLI's lightweight host-config assembler (`serve.ts`'s auto-register
 * branch, `new ObjectQLPlugin()` with no options) also leaves `environmentId`
 * undefined, and it serves an END-USER `PUT /api/v1/meta/*`. Both topologies
 * read identically, so the whole #4463 gate — all the shared `AUTHORING_RULES`
 * — was disengaged on a self-hosted app server. #5086 had already moved the
 * code-only refusal off the same proxy for the same reason ("keying
 * authorization off a row-scoping key is what made a type-level declaration
 * depend on deployment topology; the declaration decides it here instead").
 *
 * So the channel is now DECLARED, not inferred:
 *
 * - `'environment'` — metadata arrives from an author (Studio tenant, MCP/AI
 *   agent, `PUT /api/v1/meta/*`). The gate runs. **This is the default**, and
 *   the default is the whole point: an assembly that forgets to declare gets
 *   MORE enforcement, never less, so the next assembly variant nobody thought
 *   about cannot silently reopen this hole.
 * - `'package-author'` — this kernel IS the package author's own bootstrap
 *   channel. Only the genuine control-plane assembly may state this.
 *
 * Deliberately a channel NAME and not a boolean: `skipAuthoringRules: true`
 * would be the same bytes with the opposite meaning — a kill switch any
 * assembly could reach for to make a red publish go away. A caller has to
 * claim to BE the package author to be treated as one.
 */
export type MetadataAuthoringChannel = 'environment' | 'package-author';

/**
 * Implements the per-domain contracts this class ACTUALLY provides (ADR-0076
 * D10 — the facade never implemented the other domains; those live in their
 * owning services and are reached through the discovery `services` registry,
 * never through this class). Analytics left this list with the degraded shim
 * retirement (#3891) — the domain's one implementation is
 * `@objectstack/service-analytics`.
 */
export class ObjectStackProtocolImplementation implements
    DataProtocol, MetadataProtocol, PackageProtocol {
    private engine: MetadataHostEngine;
    private getServicesRegistry?: () => Map<string, any>;
    /**
     * Project scope applied to sys_metadata reads/writes. When undefined
     * (single-kernel deployments), rows land in / come from the
     * platform-global bucket (`environment_id IS NULL`). When set, every
     * saveMetaItem insert/update and loadMetaFromDb query is filtered by
     * `environment_id = environmentId`, so per-project kernels see only their own
     * metadata even if several projects share the same physical database.
     *
     * [#6710] Row scoping ONLY. This key keeps every one of its other jobs —
     * the `environment_id` stamp/filter, the ADR-0005 overlay-whitelist gate,
     * the local metadata-storage provisioning decision — but it no longer
     * decides whether the #4463 runtime authoring rules run.
     * See {@link authoringChannel}.
     *
     * [#7674] …and no longer whether the #3050 pre-persistence authoring gate
     * runs either. The sentence above used to list "the #3050 authoring-gate
     * scope" among this key's surviving jobs, and that call site kept the
     * `environmentId !== undefined` wrapper #6710 had just retired next door —
     * so the identical proxy-signal defect outlived its own diagnosis on the
     * sibling gate. Both doors read {@link authoringChannel} now.
     */
    private environmentId?: string;

    /**
     * The declared authoring channel (#6710). Defaults to `'environment'`,
     * which is what makes the #4463 gate active on every kernel that does not
     * explicitly claim to be the package author's own bootstrap channel.
     *
     * Read by {@link assertRuntimeAuthoringRules} and, since #7674, by the
     * #3050 pre-persistence authoring gate's call site in {@link saveMetaItem}
     * — the two doors that ask "is this an AUTHOR publishing, or the package
     * author's own bootstrap?". It is deliberately NOT a general-purpose
     * authorization key: the ADR-0005 overlay-whitelist gate keeps reading
     * `environmentId`, because that one really is about row scope.
     */
    private authoringChannel: MetadataAuthoringChannel;

    /**
     * Lazily-instantiated SysMetadataRepository per organization. Keyed by
     * `${organizationId ?? '__env__'}`. Repositories are stateful — they
     * carry the per-org `seqCounter` and watch subscribers — so we cache
     * them rather than constructing one per call.
     */
    private overlayRepos = new Map<string, SysMetadataRepository>();

    /**
     * Publish-time materializers keyed by singular metadata type (ADR-0086 P2).
     * When a draft of a registered type is published, its body is projected
     * into a data-plane representation the admin surface reads — e.g. a
     * `permission` set is upserted into `sys_permission_set` with
     * `managed_by:'package'`. Domain plugins own the projection (the generic
     * protocol layer must not know `sys_permission_set`'s field shape), so they
     * register here at init. Best-effort — a materializer failure is surfaced on
     * the publish response, never thrown (publishing metadata always succeeds
     * independently; the same contract as `seed` apply).
     */
    private publishMaterializers = new Map<string, PublishMaterializer>();

    /** [#2747] Named uninstall cleanups, run by {@link deletePackage}. */
    private uninstallCleanups = new Map<string, UninstallCleanup>();

    /**
     * Awaited per-type mutation projectors (ADR-0094), keyed by singular
     * metadata type. Unlike {@link publishMaterializers} (publish-only,
     * package door) a projector runs on EVERY persisted mutation of its type
     * — save, publish, delete — so a derived data-plane read-model can be a
     * pure projection with no unsynchronized door. One per type; a second
     * registration replaces the first (idempotent re-init).
     */
    private mutationProjectors = new Map<string, MetadataMutationProjector>();

    /**
     * Pre-persistence authoring gates (#3050). One per type; a second
     * registration replaces the first (idempotent re-init). Unlike
     * projectors these THROW to reject the write — see
     * {@link MetadataAuthoringGate}.
     */
    private authoringGates = new Map<string, MetadataAuthoringGate>();

    /**
     * Once-per-process dedupe for stored-row conversion notices
     * (`conversionId|type|name`). `getMetaItems`/`getMetaItem` re-read
     * sys_metadata on every call, so without this a single legacy row would
     * warn on every list request instead of once.
     */
    private storedConversionWarned = new Set<string>();

    /**
     * Once-per-process dedupe (`type|name`) for the warning `saveMetaItem`
     * emits when the flow canonicalizer throws and the save falls back to the
     * raw body (#4580). Studio autosaves the same draft over and over, and a
     * WIP cycle throws on every one of them.
     */
    private flowCanonicalizeFallbackWarned = new Set<string>();

    /**
     * Canonicalize a stored `sys_metadata` body on rehydration (#3903;
     * ADR-0087 addendum "stored metadata replays the chain").
     *
     * Every seam that turns a row's `metadata` JSON into an in-memory item
     * funnels through here, so a row written under a past protocol is read
     * in today's canonical shape — parity with what the authored load path
     * has always done, extended by the full-chain replay data at rest needs
     * (a stored row has no author for a tombstone to teach).
     *
     * `flow` is deliberately skipped: flow-node conversions carry an
     * open-namespace conflict guard that needs the automation engine's live
     * executor registry (`reservedNodeTypes`), which this layer does not
     * have. Flows canonicalize at `AutomationEngine.registerFlow` — the
     * execution seam — with the same full-chain policy.
     */
    private convertStoredItem(type: string, data: unknown): unknown {
        const singular = PLURAL_TO_SINGULAR[type] ?? type;
        return this.convertStoredItemDetailed(type, data, (n) => {
            const name = (data as { name?: unknown } | null | undefined)?.name;
            const key = `${n.conversionId}|${singular}|${String(name ?? '')}`;
            if (this.storedConversionWarned.has(key)) return;
            this.storedConversionWarned.add(key);
            console.warn(
                `[Protocol] stored ${singular}/${String(name ?? '<unnamed>')} carries a pre-protocol shape; ` +
                `${n.message} The row itself is unchanged — re-save it (Studio edit → save, or run ` +
                `"os migrate meta --stored --apply") to persist the canonical shape.`,
            );
        }).item;
    }

    /**
     * {@link convertStoredItem} with the chain's notices handed back instead of
     * only logged — what {@link migrateStoredMetadata} reports per row (#4327).
     *
     * The notices ARE the change signal: a conversion emits exactly one per
     * rewrite it performs (ADR-0087 D2 "loud"), so an empty list means the row
     * is already canonical and there is nothing to persist. Comparing bodies
     * instead would be weaker — the pass is copy-on-write, so an untouched
     * branch is shared and a re-serialized identical body can still differ in
     * key order.
     */
    private convertStoredItemDetailed(
        type: string,
        data: unknown,
        onNotice?: (notice: ConversionNotice) => void,
    ): { item: unknown; notices: ConversionNotice[] } {
        const singular = PLURAL_TO_SINGULAR[type] ?? type;
        if (singular === 'flow') return { item: data, notices: [] };
        const notices: ConversionNotice[] = [];
        const item = applyConversionsToStoredItem(singular, data, {
            onNotice: (n) => {
                notices.push(n);
                onNotice?.(n);
            },
        });
        return { item, notices };
    }

    /**
     * Resolve a flow canonicalizer from the live services registry (#4498).
     *
     * `convertStoredItem` skips `flow` because flow-node conversions carry
     * ADR-0078's open-namespace conflict guard, which needs the automation
     * engine's executor registry to tell a rename from a clobber. #4454 built
     * that capability as `AutomationEngine.canonicalizeStoredFlow` and handed
     * it to `migrateStoredMetadata` as an explicit hook, because the CLI has
     * to boot an engine of its own to hold one.
     *
     * Inside a server there is nothing to thread: this protocol is constructed
     * with an accessor for the kernel's service table (the same one
     * `analytics` and `package` are read from), and the automation service
     * registers itself under `automation`. So every caller running next to a
     * live engine can have the capability for free — which is what makes the
     * flow-skip fixable at `duplicatePackage` (a WRITE that was minting new
     * pre-protocol rows) rather than only at the CLI.
     *
     * Resolution is deliberately **lazy** — per call, never cached at
     * construction. Plugin init order is not guaranteed to put `automation`
     * in the table before the protocol is assembled (the CLI's
     * `buildDataMigrationPlugins` adds it after ObjectQL by design), and
     * caching `undefined` from a too-early read would silently disable flow
     * canonicalization for the life of the process.
     *
     * Returns `undefined` when no engine is reachable. That is a real state —
     * a control-plane or metadata-only host has no automation service — and
     * every caller must decide what it means for them rather than assume a
     * flow was handled.
     */
    private resolveFlowCanonicalizer():
        ((name: string, body: unknown) => StoredFlowCanonicalization) | undefined {
        const automation = this.getServicesRegistry?.().get('automation') as
            | { canonicalizeStoredFlow?: (name: string, definition: unknown) => StoredFlowCanonicalization }
            | undefined;
        const canonicalize = automation?.canonicalizeStoredFlow;
        if (typeof canonicalize !== 'function') return undefined;
        return (name, body) => canonicalize.call(automation, name, body);
    }

    /**
     * @param authoringChannel [#6710] which channel this kernel's metadata
     * writes arrive on. Omitted ⇒ `'environment'` ⇒ the #4463 runtime
     * authoring gate is ACTIVE. Only the genuine control-plane assembly passes
     * `'package-author'`. The default is the fail-safe direction on purpose:
     * a caller that forgets this argument gets more enforcement, never less.
     */
    constructor(
        engine: IDataEngine,
        getServicesRegistry?: () => Map<string, any>,
        environmentId?: string,
        authoringChannel: MetadataAuthoringChannel = 'environment',
    ) {
        this.engine = engine as MetadataHostEngine;
        this.getServicesRegistry = getServicesRegistry;
        this.environmentId = environmentId;
        this.authoringChannel = authoringChannel;
    }

    /**
     * Register a publish-time materializer for a metadata type (ADR-0086 P2).
     * Called by domain plugins at init (e.g. plugin-security registers the
     * `permission` → `sys_permission_set` projection). The singular type name is
     * used — `permissions` and `permission` both resolve here. One materializer
     * per type; a second registration replaces the first (idempotent re-init).
     */
    registerPublishMaterializer(type: string, materializer: PublishMaterializer): void {
        const singular = PLURAL_TO_SINGULAR[type] ?? type;
        this.publishMaterializers.set(singular, materializer);
    }

    /**
     * Register a named uninstall-time data-plane cleanup (ADR-0086 D3, #2747).
     * Called by domain plugins at init — e.g. plugin-security registers the
     * cleanup that removes its package-owned `sys_permission_set` rows and
     * their bindings when the owning package is uninstalled, so grants are
     * revoked everywhere at once (no ghost grants). One cleanup per name; a
     * second registration replaces the first (idempotent re-init).
     */
    registerUninstallCleanup(name: string, cleanup: UninstallCleanup): void {
        this.uninstallCleanups.set(name, cleanup);
    }

    /**
     * Register the awaited mutation projector for a metadata type (ADR-0094).
     * Called by the domain plugin that owns the derived read-model (e.g.
     * plugin-security registers the `permission` → `sys_permission_set`
     * projector). Singular or plural type names both resolve.
     */
    registerMutationProjector(type: string, projector: MetadataMutationProjector): void {
        const singular = PLURAL_TO_SINGULAR[type] ?? type;
        this.mutationProjectors.set(singular, projector);
    }

    /**
     * Register the pre-persistence authoring gate for a metadata type
     * (ADR-0094 addendum seam; #3050). Called by domain plugins at init —
     * e.g. plugin-security registers the `object` OWD posture gate. The gate
     * THROWS to reject the write. Singular or plural type names both resolve;
     * one gate per type, a second registration replaces the first.
     */
    registerAuthoringGate(type: string, gate: MetadataAuthoringGate): void {
        const singular = PLURAL_TO_SINGULAR[type] ?? type;
        this.authoringGates.set(singular, gate);
    }

    /**
     * Run the registered authoring gate for an about-to-persist body (#3050).
     * No-op when no gate is registered for the type. A gate throw PROPAGATES
     * (with its status/code) — that is the contract: the write is rejected
     * before persistence. Resolves the artifact-backed flag and the packaged
     * declaration body (the baseline an overlay customizes) for the gate.
     */
    private async runAuthoringGate(evt: {
        type: string; name: string; state: 'draft' | 'active'; organizationId?: string; body: unknown;
    }): Promise<void> {
        const singular = PLURAL_TO_SINGULAR[evt.type] ?? evt.type;
        const gate = this.authoringGates.get(singular);
        if (!gate) return;
        const artifactBacked = this.isArtifactBacked(evt.type, evt.name);
        let declaredBody: unknown;
        if (artifactBacked && typeof this.engine.registry?.getItem === 'function') {
            const alt = PLURAL_TO_SINGULAR[evt.type] ?? SINGULAR_TO_PLURAL[evt.type];
            declaredBody = this.engine.registry.getItem(evt.type, evt.name)
                ?? (alt ? this.engine.registry.getItem(alt, evt.name) : undefined);
        }
        await gate({
            type: singular,
            name: evt.name,
            state: evt.state,
            ...(evt.organizationId ? { organizationId: evt.organizationId } : {}),
            body: evt.body,
            isArtifactBacked: artifactBacked,
            ...(declaredBody !== undefined ? { declaredBody } : {}),
        });
    }

    /**
     * The #4463 runtime authoring gate — the fourth door.
     *
     * Runs the SHARED author-time rule registry (`@objectstack/lint`'s
     * `AUTHORING_RULES`, the same table `os validate` / `os build` / `os lint`
     * run) over a body about to go `active`, and throws the 422 its gating
     * findings earn. Draft saves are never gated (D1) — publishing the draft
     * runs this.
     *
     * Deliberately NOT a {@link registerAuthoringGate} registration: those are
     * per-type and single-slot, owned by the domain plugin that registers them
     * (plugin-security holds `object`). This is the platform's own gate and it
     * must be unconditional — a plugin cannot displace it, and no surface can
     * skip it, because every surface reaches this class.
     *
     * The rules resolve names against the LIVE object universe, which is
     * strictly better information than the CLI's single-package view — the
     * inversion #4463 D2 points out: the same rule can be more decisive here
     * than it can be at build time.
     *
     * [#6285 / #6155 Q3=A] It also supplies the two DEPLOYMENT facts the CLI
     * cannot know and the shared registry therefore must not read: the
     * organization partition this write lands in, and whether this deployment
     * enforces an organization wall. Both are gathered here — the impure side —
     * and passed as arguments, so `evaluateRuntimeAuthoringGate` stays a pure
     * function of its inputs and a test can drive both postures without
     * mutating the process.
     *
     * [#4717] Throws on the gating half, RETURNS the advisory half. Advisories
     * do not block anything, so the only honest place for them is the 2xx the
     * write earns — `saveMetaItem` attaches them to its response, and the only
     * other caller (the draft→active promotion in `publishMetaItem`) simply
     * ignores the value, which is why adding this channel could not change what
     * either door does.
     * Returns an empty array on every early return: no rules ran, so there is
     * nothing to report, and "clean" is told apart from "nothing ran" by the
     * gate's own `rulesRun`, not by this.
     */
    private assertRuntimeAuthoringRules(evt: {
        type: string; name: string; state: 'draft' | 'active'; body: unknown; source?: string;
        /**
         * The organization partition of this write (`saveMetaItem`'s
         * `organizationId`). Absent = a platform-level / environment write,
         * which is one limb of the #6285 refusal combination.
         */
        organizationId?: string | null;
    }): RuntimeAuthoringIssue[] {
        // [#6710] The ADR-0005 carve-out, now DECLARED instead of inferred.
        //
        // This line used to read `if (this.environmentId === undefined)
        // return;` — the carve-out keyed off a ROW-SCOPING key. #6285 measured
        // that short-circuit and found every *regular* serving path safely on
        // the gated side (`os dev` / `os start` bind `env_local`, the
        // standalone artifact stack `proj_local`, a cloud per-project kernel
        // its own), and concluded the only thing behind it was the
        // control-plane bootstrap kernel. That conclusion was incomplete, and
        // #6710 measured the counter-example at boot level: the CLI's
        // lightweight host-config assembler (`serve.ts`'s
        // `config.objects && !hasObjectQL` branch → `new ObjectQLPlugin()`
        // with no options) ALSO leaves `environmentId` undefined, and it
        // serves an end-user `PUT /api/v1/meta/*`. `isHostConfig` →
        // `shouldBootWithLibrary === false` is the flagship showcase's own
        // boot shape, so a self-hosted app server ran all the shared
        // `AUTHORING_RULES` on exactly nothing — and for a Studio tenant or an
        // MCP/AI author this gate is not the weakest of four doors, it is the
        // ONLY one (#4463's filing reason).
        //
        // Two topologies, one key, opposite intents: that is the definition of
        // a proxy signal, and #5086 had already retired the same proxy for the
        // code-only refusal a few hundred lines below. So the channel is now
        // stated by the assembly (`assembleMetadataProtocol` ← the plugin
        // option) rather than guessed from row scope, and the DEFAULT is the
        // gated one. An assembly that forgets to declare gets more
        // enforcement, never less — the direction matters more than the
        // mechanism, because the failure mode being designed out is precisely
        // "a new assembly variant nobody thought about".
        //
        // `environmentId` keeps its row-scoping jobs — the `environment_id`
        // stamp/filter and the ADR-0005 overlay-whitelist gate. [#7674] It no
        // longer keys the #3050 authoring gate below either: #6710 re-keyed
        // this activation and left that one on the retired proxy, which cost
        // the ADR-0090 D11 object posture gate every host-config deployment
        // until #7674 finished the move.
        if (this.authoringChannel === 'package-author') return [];
        if (evt.state !== 'active') return [];
        // `os migrate meta --stored --apply` rewrites rows that ALREADY EXIST
        // into the current dialect. It is not an author publishing anything —
        // it is the platform healing its own storage — and #4463 D4 is explicit
        // that the gate blocks new writes while stored rows keep their
        // ADR-0087 path. Gating it would invert the tool: a tenant with one
        // pre-existing violation could never canonicalize that row, and the
        // migration would report `failed` while leaving the body in the OLDER
        // dialect — strictly worse than the state it was asked to improve.
        //
        // Safe as a carve-out because `source` is stated by the SERVER, never
        // forwarded from a request (see the note at the top of `saveMetaItem`):
        // no caller can spell its way past the gate. `duplicatePackage` is
        // deliberately NOT here — it mints brand-new rows under new names, and
        // a copy of a broken flow is a new broken flow.
        if (evt.source === 'migrate-stored') return [];
        const singular = PLURAL_TO_SINGULAR[evt.type] ?? evt.type;

        // Resolution context. Best-effort: a host without a registry (a
        // metadata-only test double) still writes, it just gets the rules that
        // need no object universe. Never let context-gathering fail a write.
        let objects: unknown[] = [];
        try {
            if (typeof this.engine.registry?.listItems === 'function') {
                objects = [...this.engine.registry.listItems('object')];
                if (objects.length === 0) objects = [...this.engine.registry.listItems('objects')];
            }
        } catch {
            objects = [];
        }

        const verdict = evaluateRuntimeAuthoringGate({
            type: singular,
            name: evt.name,
            state: evt.state,
            body: evt.body,
            objects,
            ...(evt.organizationId !== undefined ? { organizationId: evt.organizationId } : {}),
            orgWallEnforced: this.orgWallEnforced(),
        });
        if (verdict.error) throw verdict.error;
        return verdict.advisories;
    }

    /**
     * [#6285] Does this deployment enforce an organization wall (ADR-0105 D1)?
     *
     * The authoritative reading, and the only one:
     * `postureEnforcesWall(resolveTenancyPosture())`. `resolveMultiOrgEnabled()`
     * is the demoted legacy input — a deployment that sets only the canonical
     * `OS_TENANCY_POSTURE` reads `false` there while genuinely running a walled
     * posture, which is the bug shape cloud#1020 and #5233 already paid for.
     *
     * Read per call rather than memoised: `resolveTenancyPosture()` reads
     * `process.env` live by contract, and a gate that cached the answer at
     * construction would disagree with every other consumer for the life of the
     * process.
     *
     * `resolveTenancyPosture()` THROWS on an unrecognized `OS_TENANCY_POSTURE`
     * — deliberately, so a typo cannot silently remove the wall. That refusal
     * belongs at boot, not on a metadata write, so it is caught here and read
     * as WALLED. Fail-closed is the direction ADR-0105 argues for on exactly
     * this input ("refusing to boot rather than silently falling back to a
     * posture with no organization wall"), and it costs nothing in practice: a
     * deployment in that state does not boot, and even when reached it only
     * arms a guardrail — a publish still has to match every other limb of the
     * refusal combination to be turned away.
     */
    private orgWallEnforced(): boolean {
        try {
            return postureEnforcesWall(resolveTenancyPosture());
        } catch {
            return true;
        }
    }

    /**
     * Run the registered projector for a just-persisted mutation (ADR-0094).
     * Returns `undefined` when no projector is registered for the type;
     * otherwise a {@link MutationProjectionOutcome} that callers attach to
     * the write's response as `projectionApplied`. Never throws.
     */
    private async runMutationProjector(
        evt: MetadataMutationEvent & { body?: unknown },
    ): Promise<MutationProjectionOutcome | undefined> {
        const projector = this.mutationProjectors.get(evt.type);
        if (!projector) return undefined;
        try {
            await projector(evt);
            return { success: true };
        } catch (e) {
            const error = e instanceof Error ? e.message : String(e);
            console.warn(
                `[Protocol] mutation projector failed for ${evt.type}/${evt.name} (state=${evt.state}): ${error}`,
            );
            return { success: false, error };
        }
    }

    /**
     * Runtime-mutation listeners (#2588). Every metadata mutation that lands
     * through this protocol — `saveMetaItem` (draft AND direct-active saves),
     * `publishMetaItem` (per-item and package publish-drafts), and
     * `deleteMetaItem` — notifies these listeners AFTER persistence succeeds.
     *
     * This is the ONE choke point every authoring surface funnels through
     * (rest-server, http-dispatcher, AI builders, direct protocol callers),
     * so boot-cached runtime consumers can re-sync on authoring without each
     * HTTP surface hand-announcing. First consumer: ObjectQLPlugin re-binds
     * runtime-authored hooks when a `hook` row changes.
     *
     * Server-side extension only — NOT part of the ObjectStackProtocol wire
     * contract (same status as `loadMetaFromDb`).
     */
    private metadataMutationListeners: Array<(evt: MetadataMutationEvent) => void> = [];

    /** Subscribe to post-persistence metadata mutations. Returns an unsubscribe fn. */
    onMetadataMutation(listener: (evt: MetadataMutationEvent) => void): () => void {
        this.metadataMutationListeners.push(listener);
        return () => {
            const i = this.metadataMutationListeners.indexOf(listener);
            if (i >= 0) this.metadataMutationListeners.splice(i, 1);
        };
    }

    /**
     * Notify mutation listeners (best-effort, synchronous fan-out). A
     * listener failure must never fail the write it observes — the row is
     * already persisted — so each listener is isolated in its own try/catch.
     */
    private emitMetadataMutation(evt: MetadataMutationEvent): void {
        for (const listener of this.metadataMutationListeners) {
            try {
                listener(evt);
            } catch (e) {
                console.warn(
                    `[Protocol] metadata-mutation listener failed for ${evt.type}/${evt.name}: `
                    + `${e instanceof Error ? e.message : String(e)}`,
                );
            }
        }
    }

    /**
     * Lazily obtain a SysMetadataRepository for the given organization.
     * Env-wide overlays (organizationId == null) share a singleton under
     * the `__env__` key.
     */
    private getOverlayRepo(organizationId: string | null): SysMetadataRepository {
        const key = organizationId ?? '__env__';
        let repo = this.overlayRepos.get(key);
        if (!repo) {
            repo = new SysMetadataRepository({
                engine: this.engine as unknown as SysMetadataEngine,
                organizationId,
                orgLabel: organizationId ?? 'env',
            });
            this.overlayRepos.set(key, repo);
        }
        return repo;
    }

    /**
     * [#7559] ADR-0005 / #3115 — resolve the org scope an item's lineage
     * ACTUALLY lives in, for a caller whose active org may not be that scope.
     *
     * This is the read-side half of the rule {@link SysMetadataRepository.listDrafts}
     * states on the write side: a non-null-org caller sees BOTH its own overlay
     * rows and the env-wide (`organization_id IS NULL`) ones, "so consumers that
     * then act on a draft MUST route the write to THIS scope, not the caller's
     * active org, or they 404 on the env-wide row they can never match".
     * {@link publishPackageDrafts} learned it — it promotes each draft through
     * `getOverlayRepo(d.organizationId)` and captures `prevVersion` from the
     * row in the draft's OWN scope. The two revert callers did not, and read
     * back under `getOverlayRepo(request.organizationId)` instead.
     *
     * Measured on `origin/main` (#7559): an env-wide `view` published twice from
     * a console request carrying an active org lands its `sys_metadata` and
     * `sys_metadata_history` rows at `organization_id = NULL` while the commit
     * records `prevVersion: 2`; `revertCommit` with that same active org then
     * asks `sys_metadata_history` for `(organization_id='org_x', version=2)`,
     * matches nothing, and answers `VERSION_NOT_FOUND: No history row at
     * version 2` — over a row `GET …/history` lists. Same input with no active
     * org succeeds, and an org-scoped item reverted by its own org succeeds:
     * the disagreement is `organization_id` alone.
     *
     * NOT the `package_id` scoping #6215 fixed — that one is a step later, in
     * {@link SysMetadataRepository.restoreVersion}'s `put()` parent lookup, and
     * is intact and uninvolved here (the history table carries no `package_id`
     * column at all).
     *
     * Precedence is the ADR-0005 overlay order — the caller's own org shadows
     * env-wide — so an org that has its own overlay row reverts THAT row, and
     * only an org with no overlay of its own falls through to the env-wide
     * lineage it was already publishing into. When neither scope has a lineage
     * the caller's own scope is returned unchanged, so a genuinely absent item
     * still fails in the scope the caller asked about.
     *
     * Deliberately NO `catch`: a driver failure here must fail the revert, not
     * resolve to a scope nobody verified (AGENTS.md read-seam invention rule).
     */
    private async resolveMetaItemOrgScope(
        singularType: string,
        name: string,
        requestOrgId: string | null,
    ): Promise<string | null> {
        if (requestOrgId === null) return null;
        const inOrg = await this.engine.findOne('sys_metadata_history', {
            where: { organization_id: requestOrgId, type: singularType, name },
        });
        if (inOrg) return requestOrgId;
        const inEnv = await this.engine.findOne('sys_metadata_history', {
            where: { organization_id: null, type: singularType, name },
        });
        return inEnv ? null : requestOrgId;
    }

    /**
     * One-time guard for ensuring the overlay-uniqueness UNIQUE INDEXes exist
     * on `sys_metadata`. ADR-0005 (revised 2026-05) + ADR-0048: per-env DBs
     * replace the old "per-project" isolation, so `environment_id` is no longer
     * a discriminator — overlay uniqueness is
     * `(type, name, organization_id, COALESCE(package_id, ''))`, enforced once
     * among ACTIVE rows and once among DRAFT rows. Idempotent SQL — safe to
     * attempt on every protocol instance.
     *
     * ⚠️ This method resolves a raw-SQL seam and nothing more. The DDL, its
     * ORDER and its reporting live in `./migrations/overlay-index.ts` (#6418),
     * which replaced the DROP-then-CREATE sequence that used to sit here: the
     * drop always succeeded and a failing create left `sys_metadata` with no
     * unique index at all, silently, because both `catch` blocks were empty.
     * See that module's header for why the order is now probe-first and why the
     * dialect fallback must stay NON-unique.
     *
     * Kept in this package (rather than imported from
     * `@objectstack/metadata/migrations`) to avoid a circular dependency:
     * metadata already depends on objectql.
     */
    private overlayIndexEnsured = false;
    private async ensureOverlayIndex(): Promise<void> {
        if (this.overlayIndexEnsured) return;
        this.overlayIndexEnsured = true;
        try {
            const engineAny = this.engine as any;
            let driver: any = engineAny?.driver ?? engineAny?.getDriver?.();
            if (!driver && engineAny?.drivers instanceof Map) {
                for (const candidate of engineAny.drivers.values()) {
                    if (
                        candidate &&
                        (typeof (candidate as any).raw === 'function' ||
                            typeof (candidate as any).execute === 'function')
                    ) {
                        driver = candidate;
                        break;
                    }
                }
            }
            if (!driver) return;
            const exec = async (sql: string): Promise<void> => {
                if (typeof (driver as any).raw === 'function') {
                    await (driver as any).raw(sql);
                } else if (typeof (driver as any).execute === 'function') {
                    await (driver as any).execute(sql);
                } else {
                    throw new Error('driver has neither raw nor execute');
                }
            };
            // `console` satisfies the logger surface structurally; this class
            // carries no injected logger, and its own diagnostics go to
            // `console.warn` throughout (see `emitMetadataMutation`).
            await ensureMetadataOverlayIndexes(exec, console);
        } catch {
            // A boot must never fail over an index. Note this arm is now only
            // reachable for driver RESOLUTION failures: every DDL failure past
            // this point is classified and reported by the migration itself,
            // instead of vanishing into an empty catch (#6418).
        }
    }

    /**
     * Exposes the project scope the protocol is bound to. Consumers like
     * the HTTP dispatcher use this to decide whether to trust the process-
     * wide SchemaRegistry or whether they must route a read through the
     * protocol's environment_id-filtered lookup.
     */
    getProjectId(): string | undefined {
        return this.environmentId;
    }

    async getDiscovery() {
        // Get registered services from kernel if available
        const registeredServices = this.getServicesRegistry ? this.getServicesRegistry() : new Map();

        // Build dynamic service info with proper typing. Analytics is NOT in
        // this kernel-provided block: since the degraded ObjectQL fallback was
        // retired (#3891) it is an ordinary optional service, computed from the
        // registry via SERVICE_CONFIG below — absent means `unavailable`, and
        // no route is advertised (the pre-#2462 hardcode here is exactly what
        // the fallback was invented to make true).
        //
        // [#4089] The `metadata` slot is reported from whatever fills it, not
        // hardcoded `available`. The kernel auto-registers `createMemoryMetadata`
        // when no MetadataPlugin is present, and plugin-dev registers its own
        // in-memory registry; both self-describe as `degraded` (D12), and
        // hardcoding `available` here overstated them as exactly equivalent to a
        // sys_metadata-backed registry. Absent or unmarked ⇒ `available`, which
        // is what the real MetadataPlugin (carrying no marker) reports.
        //
        // This is also where the two builders stopped disagreeing: the runtime
        // dispatcher hardcoded the opposite verdict for the same slot
        // (`degraded` + "DB persistence pending"), so one host called a persisted
        // registry degraded while the other called an in-memory one available.
        // Both now compute it, and `handlerReady: true` is stated on both sides:
        // `/api/v1/meta` is served by the protocol, not by this service, so it is
        // mounted whichever implementation occupies the slot.
        const metadataSelf = readServiceSelfInfo(registeredServices.get('metadata'));

        // [#4130] `data` was the last self-judging entry in this block. Same
        // reasoning, one degree weaker: its hardcoded `available` is currently
        // true, but only because ObjectQL is the slot's sole producer and
        // plugin-dev (whose `data` stub declares `stub`) always loads
        // ObjectQLPlugin as a child. That is a load-order convention in another
        // package, not something this builder verifies — so verify it here.
        // Unmarked implementation ⇒ `available` + `handlerReady: true`, i.e.
        // exactly what the hardcode said, now derived rather than asserted.
        const dataSelf = readServiceSelfInfo(registeredServices.get('data'));

        const services: Record<string, ServiceInfo> = {
            // --- Kernel-provided (objectql is an example kernel implementation) ---
            metadata:  {
                enabled: true,
                status: metadataSelf?.status ?? ('available' as const),
                handlerReady: true,
                route: '/api/v1/meta',
                provider: 'objectql',
                ...(metadataSelf?.message ? { message: metadataSelf.message } : {}),
            },
            data:      {
                enabled: true,
                status: dataSelf?.status ?? ('available' as const),
                handlerReady: dataSelf?.handlerReady ?? true,
                route: '/api/v1/data',
                provider: 'objectql',
                ...(dataSelf?.message ? { message: dataSelf.message } : {}),
            },
        };

        // [#4000, #4058] The dispatcher answers a self-declared non-handler in
        // one of ITS domains' slots with the same 404/501 an empty slot gets
        // (`isServiceServeable`, runtime/src/service-serveable.ts), so this
        // builder must not advertise a route for one — that would be the
        // `declared ≠ enforced` gap discovery exists to close.
        //
        // Scoped to the dispatcher-owned domains on purpose. For the other
        // entries in SERVICE_CONFIG the route belongs to the plugin that
        // registers the service (service-storage's own `/api/v1/storage`
        // routes, plugin-search, plugin-graphql, …) rather than to a dispatcher
        // domain, so `handlerReady` there says nothing about whether THAT route
        // is mounted, and suppressing it would be a guess. `file-storage` stays
        // listed as the one entry with no dispatcher domain behind it — #4087
        // retired the `/storage` bridge — because for that slot `handlerReady`
        // is not a proxy for anything, it is the fact itself: an occupant that
        // mounts no HTTP surface must not have `/api/v1/storage` advertised on
        // its behalf. When service-storage is installed it registers a real
        // (unmarked) service and mounts the routes, so the entry never fires.
        const DISPATCHER_GATED_SERVICES = new Set([
            'analytics', 'automation', 'notification', 'ai', 'i18n', 'file-storage',
        ]);
        const unserveable = (serviceName: string) =>
            DISPATCHER_GATED_SERVICES.has(serviceName)
            && readServiceSelfInfo(registeredServices.get(serviceName))?.handlerReady === false;
        const advertisedRoute = (serviceName: string, route?: string) =>
            unserveable(serviceName) ? undefined : route;

        // Check which services are actually registered
        for (const [serviceName, config] of Object.entries(SERVICE_CONFIG)) {
            if (registeredServices.has(serviceName)) {
                // Registered — but honor a stub/dev/fallback self-description
                // instead of blindly reporting 'available' (ADR-0076 D12).
                const self = readServiceSelfInfo(registeredServices.get(serviceName));
                // No HTTP surface at all: the handler can never be ready, and
                // the entry's own `noHttpSurface` declaration says whether that
                // also degrades the slot (realtime) or not (cache/queue/job —
                // in-process contracts, #4318).
                const noHttpSurface = !config.route;
                services[serviceName] = {
                    enabled: true,
                    status: self?.status ?? (config.noHttpSurface?.statusWhenUnmarked ?? ('available' as const)),
                    route: advertisedRoute(serviceName, config.route),
                    provider: CORE_SERVICE_PROVIDER[serviceName] ?? undefined,
                    ...(noHttpSurface || self?.handlerReady !== undefined
                        ? { handlerReady: noHttpSurface ? false : self?.handlerReady }
                        : {}),
                    ...(self?.message
                        ? { message: self.message }
                        : config.noHttpSurface
                            ? { message: config.noHttpSurface.message }
                            : {}),
                };
            } else {
                // Service is not registered
                services[serviceName] = {
                    enabled: false,
                    status: 'unavailable' as const,
                    message: serviceUnavailableMessage(serviceName),
                };
            }
        }

        // Build routes from services — a flat convenience map for client routing
        const serviceToRouteKey: Record<string, keyof ApiRoutes> = {
            analytics: 'analytics',
            auth: 'auth',
            automation: 'automation',
            ui: 'ui',
            realtime: 'realtime',
            notification: 'notifications',
            ai: 'ai',
            i18n: 'i18n',
            'file-storage': 'storage',
            // [#6633] The package-management surface. `package` is NOT a
            // CoreServiceName slot, so it must not enter SERVICE_CONFIG — a
            // non-slot row there is the shape of the retired `graphql` defect,
            // and it would also fabricate a `services` availability entry whose
            // remedy line lies. Its route flows through the
            // NON_SLOT_SERVICE_ROUTES loop below instead: same gate
            // (registered service), same mapping table, one hop over.
            package: 'packages',
        };

        // [#6633] Routes advertised for registered services that are not
        // CoreServiceName slots. Advertised iff the service is registered —
        // the same convention every SERVICE_CONFIG row uses, and for `package`
        // it is exactly the predicate that decides the mount on both real host
        // types: the @objectstack/rest direct-mount registrar is gated on this
        // same service (`direct-mount-composition.ts`), and the runtime
        // dispatcher — whose `/packages` domain is unconditional — answers
        // discovery from its own `getDiscoveryInfo()`, never from this
        // builder.
        //
        // `datasources` is deliberately NOT here (same reasoning as `mcp`,
        // #5679): the federation mount belongs to the REST host, which this
        // builder cannot see, and the runtime dispatcher serves no
        // `/datasources` domain at all — advertising it from here would be the
        // advertise-the-unmounted half of ADR-0076 D12. The REST discovery
        // endpoint advertises it from its recorded direct mounts.
        const NON_SLOT_SERVICE_ROUTES: Record<string, string> = {
            package: '/api/v1/packages',
        };

        const optionalRoutes: Partial<ApiRoutes> = {};

        // Add routes for available plugin services. Services without an HTTP
        // surface (config.route undefined) advertise no route (D12, #2462).
        for (const [serviceName, config] of Object.entries(SERVICE_CONFIG)) {
            const route = advertisedRoute(serviceName, config.route);
            if (registeredServices.has(serviceName) && route) {
                const routeKey = serviceToRouteKey[serviceName];
                if (routeKey) {
                    optionalRoutes[routeKey] = route;
                }
            }
        }

        // [#6633] Same flow for the non-slot routed services declared above.
        for (const [serviceName, route] of Object.entries(NON_SLOT_SERVICE_ROUTES)) {
            if (registeredServices.has(serviceName)) {
                const routeKey = serviceToRouteKey[serviceName];
                if (routeKey) {
                    optionalRoutes[routeKey] = route;
                }
            }
        }

        const routes: ApiRoutes = {
            data: '/api/v1/data',
            metadata: '/api/v1/meta',
            ...optionalRoutes,
        };

        // Build well-known capabilities from registered services.
        //
        // [#5672] `WellKnownCapabilitiesSchema` is THE capability vocabulary and
        // `DiscoverySchema.capabilities` is now a closed object over it, so this
        // literal must answer EVERY key — a capability this host does not
        // deliver is `enabled: false`, never an absent key (maintainer ruling A,
        // 2026-08-06). The `WellKnownCapabilities` annotation is what enforces
        // that at compile time: adding a key to the vocabulary breaks this line
        // until it is answered here.
        //
        // Each key's basis is recorded next to it. Where a capability is backed
        // by a service slot, the predicate is deliberately the SAME one that
        // decides whether the route is advertised (`advertisedRoute`/
        // `unserveable` above) — what we advertise and what we claim cannot
        // disagree.
        const capabilityServed = (serviceName: string) =>
            registeredServices.has(serviceName) && !unserveable(serviceName);

        const wellKnown: WellKnownCapabilities = {
            // Comments/chatter are served by the `sys_comment` object via the generic
            // data API (ADR-0052 §5) — not a dedicated service. The capability is true
            // iff that object is loaded (the always-on audit slate provides it); this
            // keeps declared === enforced (Prime Directive #10). #3180
            comments: !!this.engine.registry?.getObject?.('sys_comment'),
            automation: registeredServices.has('automation'),
            cron: registeredServices.has('job'),
            // [#7541] Serveability-gated on the protocol's OWN search
            // implementation, was slot presence. This is the same predicate the
            // route refuses on: `registerSearchEndpoints`
            // (packages/rest/src/rest-server.ts) 501s exactly when
            // `typeof protocol.searchAll !== 'function'`, so the two ends can no
            // longer answer the same question differently — the rule stated at
            // the top of this block, applied to the key that was still exempt.
            //
            // The old predicate was wrong in the direction discovery exists to
            // prevent: `searchAll` is implemented by this class unconditionally,
            // nothing in either repository registers the `search` slot
            // (CORE_SERVICE_PROVIDER records that, verified), so every REST host
            // served `GET /api/v1/search` 200 while advertising
            // `capabilities.search = false`. A conforming client — one that
            // trusts the document instead of probing — skipped a working
            // surface. Prime Directive #10 inverted.
            //
            // `services.search` is deliberately NOT collapsed into this. The
            // slot is a distinct question with its own answer: `CoreServiceName`
            // declares it "Search Engine (Elastic/Meili)" and `ISearchService`
            // is an index/query contract, so `services.search` reports WHICH
            // ENGINE occupies the slot while this bit reports WHETHER THE
            // SURFACE IS SERVED (`WellKnownCapabilitiesSchema.search`: "whether
            // the backend supports full-text search"). They may legitimately
            // differ — an empty slot with a served endpoint is today's normal
            // host — and `serviceUnavailableMessage('search')` now says so in
            // the same document, the way `ui` does for the same shape (#4146).
            search: typeof this.searchAll === 'function',
            export: registeredServices.has('automation') || registeredServices.has('queue'),
            // [#5672] Serveability-gated, was presence-only. Two reasons, and
            // the second is the binding one:
            //   1. `declared === enforced` — a self-declared stub file-storage
            //      mounts no HTTP surface, so this builder already withholds
            //      `routes.storage` from it; advertising chunked upload anyway
            //      promised an upload endpoint that cannot exist.
            //   2. the runtime dispatcher answers this key `hasFiles`, i.e.
            //      `isServiceServeable(filesSvc)`. Leaving this one on presence
            //      would make the two producers give the SAME host opposite
            //      answers for the SAME key — a new dialect inside the
            //      vocabulary this issue exists to unify.
            chunkedUpload: capabilityServed('file-storage'),
            // Atomic cross-object batch (#3298 / #1604 / ADR-0034 item 4): the
            // REST /batch endpoint runs its ops inside `engine.transaction()`,
            // which only opens a real (all-or-nothing) transaction when the
            // engine exposes one — otherwise it degrades to a non-atomic
            // passthrough. Advertise the capability iff the runtime engine can
            // honour a transaction, so `declared === enforced` (Prime Directive
            // #10). The rest-server producer ANDs this with `api.enableBatch` so
            // a server that doesn't mount the route reports `false` at its layer.
            // (ADR-0119 D1: `transaction` is contract-declared, so this probe
            // no longer needs a structural cast to ask the question.)
            transactionalBatch: typeof this.engine?.transaction === 'function',

            // ── Joined the vocabulary with ruling A (#5672) ───────────────────
            // These six used to be the runtime dispatcher's half of the split.
            // This builder can answer all of them from the services registry it
            // already reads, so none of them is a "cannot deliver ⇒ false"
            // placeholder — they are measured, per key:

            // No host mounts a WS/SSE surface: service-realtime is an in-process
            // pub/sub bus, which is precisely why SERVICE_CONFIG.realtime
            // declares `noHttpSurface` and no `routes.realtime` is ever
            // advertised (ADR-0076 D12, #2462). A literal `false` is the honest
            // answer here, not a stand-in for one — and it matches the runtime
            // dispatcher's answer for the same reason, in the same words.
            websockets: false,
            // Storage: the `file-storage` slot, gated on serveability rather
            // than presence — a self-declared stub mounts nothing, and this
            // builder already withholds `routes.storage` from it.
            files: capabilityServed('file-storage'),
            analytics: capabilityServed('analytics'),
            ai: capabilityServed('ai'),
            // Slot is `notification` (singular, CoreServiceName); the capability
            // and the route key are plural. Same slot, three spellings — the
            // mapping is here so nothing has to guess it.
            notifications: capabilityServed('notification'),
            i18n: capabilityServed('i18n'),
        };

        // Convert flat booleans → hierarchical capability objects.
        //
        // [#5672] Keyed by the vocabulary, not by `string`. The old
        // `Record<string, …>` was assignable to the open record
        // `DiscoverySchema.capabilities` used to be; against the closed shape
        // it no longer is, and that is the closure doing its job — the compiler
        // now refuses a producer whose capability map is not the whole
        // vocabulary. Iterating `wellKnown`'s own keys means fullness is
        // carried over from the annotated literal above rather than re-asserted.
        const capabilities = {} as Record<keyof WellKnownCapabilities, CapabilityDescriptor>;
        for (const key of Object.keys(wellKnown) as Array<keyof WellKnownCapabilities>) {
            capabilities[key] = { enabled: wellKnown[key] };
        }

        // [#4828] Locale, derived from the registered i18n service exactly the
        // way the runtime dispatcher's `getDiscoveryInfo()` derives it — same
        // accessors, same fallback. `DiscoverySchema` declares `locale`
        // REQUIRED and this producer never emitted it, so the REST `/discovery`
        // shape could not satisfy the schema at all; deriving it (rather than
        // hardcoding `en`) keeps the answer honest on a stack that actually
        // ships translations.
        const i18nSvc = registeredServices.get('i18n');
        let locale = { default: 'en', supported: ['en'], timezone: 'UTC' };
        if (i18nSvc) {
            const defaultLocale = typeof i18nSvc.getDefaultLocale === 'function'
                ? i18nSvc.getDefaultLocale() : 'en';
            const locales = typeof i18nSvc.getLocales === 'function'
                ? i18nSvc.getLocales() : [];
            locale = {
                default: defaultLocale,
                supported: locales.length > 0 ? locales : [defaultLocale],
                timezone: 'UTC',
            };
        }

        // [#4828] `name` is the canonical identity key (`DiscoverySchema`
        // requires it); `apiName` is the deprecated alias, emitted with the
        // IDENTICAL value until its scheduled removal in protocol 18 (schedule
        // in `GetDiscoveryResponseSchema`). Before this, the two discovery
        // producers spelled the same concept differently and disjointly — this
        // one emitted only `apiName`, the dispatcher only `name` — so no
        // consumer had a key that worked against both.
        const name = 'ObjectStack API';

        return {
            version: '1.0',
            name,
            /** @deprecated Use `name`. Removed in protocol 18 (#4828). */
            apiName: name,
            // [#5936] The operator's value, passed as read — no local default.
            // What an ABSENT `NODE_ENV` advertises is decided once, inside
            // `resolveDiscoveryEnvironment` (`production`, per the 2026-08-07
            // ruling, direction 1), so this producer and the runtime dispatcher
            // cannot drift on it. Before that ruling the default lived at the
            // dispatcher's own call site and this producer had no equivalent, so
            // a deployment that forgot the variable was told `development` here
            // and `production` there — the exact drift the shared mapper exists
            // to prevent (#4828). Do not re-introduce a default here.
            environment: resolveDiscoveryEnvironment(
                (globalThis as { process?: { env?: Record<string, string | undefined> } })
                    .process?.env?.NODE_ENV,
            ),
            routes,
            locale,
            services,
            capabilities,
        };
    }

    /**
     * [#6992] The LIVE metadata-type set of this kernel: every type either
     * registry has heard of, whether or not `DEFAULT_METADATA_TYPE_REGISTRY`
     * declares it. Spellings are returned as each source stores them
     * (singular or plural) — callers normalise through
     * {@link PLURAL_TO_SINGULAR}, as they already did inline.
     *
     * Two sources, and both are needed:
     *
     *  - `engine.registry.getRegisteredTypes()` — the SchemaRegistry. This is
     *    the one that actually carries the plugin-registered family: manifests
     *    register through the `manifest` service during kernel Phase 1
     *    (`ql.registerApp`), so by Phase 2 it holds `theme`, `connector`,
     *    `webhook`, `sharing_rule`, `analytics_cube`, … — none of which have a
     *    registry entry.
     *  - the `metadata` service's `getRegisteredTypes()` — types the
     *    MetadataManager knows. Its `typeRegistry` is seeded with
     *    `DEFAULT_METADATA_TYPE_REGISTRY` in the manager's constructor, so
     *    early in boot this source contributes only declared types; it grows
     *    later (artifact load, `additionalTypes`) and is read for the types
     *    the SchemaRegistry has not been told about.
     *
     * Extracted from {@link getMetaTypes} rather than copied: the listing and
     * {@link reportUnhydratableOrgScopedRows} must answer "which types exist
     * here" identically, or the audit accuses a type the listing does not
     * admit exists (and vice versa). One accessor, no second vocabulary.
     */
    private async listLiveMetadataTypes(): Promise<string[]> {
        const schemaTypes = this.engine.registry.getRegisteredTypes();

        // Also include types from MetadataService (runtime-registered: agent, tool, etc.)
        let runtimeTypes: string[] = [];
        try {
            const services = this.getServicesRegistry?.();
            const metadataService = services?.get('metadata');
            if (metadataService && typeof metadataService.getRegisteredTypes === 'function') {
                runtimeTypes = await metadataService.getRegisteredTypes();
            }
        } catch {
            // MetadataService not available
        }

        return Array.from(new Set([...schemaTypes, ...runtimeTypes]));
    }

    async getMetaTypes() {
        const allTypes = await this.listLiveMetadataTypes();

        // Phase 3a-1: enrich response with per-type registry metadata so admin
        // UI can render directory pages, filter by domain, decide which types
        // expose write actions, etc. Existing clients keep working — the
        // `types: string[]` field is preserved alongside the new `entries`.
        //
        // Phase 3a-env-writable: `OS_METADATA_WRITABLE` env var (comma
        // separated singular type names) flips `allowOrgOverride` on listed
        // types so admins can self-serve. The same env var is consulted by
        // `isOverlayAllowed()` at write time — they must stay in sync.
        const writableOverrides = ObjectStackProtocolImplementation.envWritableTypes();
        const registryByType = new Map(
            DEFAULT_METADATA_TYPE_REGISTRY.map((e) => [e.type, e] as const)
        );

        const entries = allTypes.map((type) => {
            const singular = (PLURAL_TO_SINGULAR[type] ?? type) as string;
            // Phase 3a-schema: emit a JSON Schema per type so the generic
            // metadata admin UI can render real forms (no more raw-JSON
            // textareas for new resources). The canonical schema for every
            // built-in (and plugin-registered) metadata type lives in the
            // central `getMetadataTypeSchema()` registry; we delegate so
            // Studio's editor and the runtime overlay validator stay in
            // lock-step (one source of truth).
            const zodSchema = getMetadataTypeSchema(singular);
            const schema = (zodSchema ? toJsonSchemaSafe(zodSchema) : undefined)
                ?? HAND_CRAFTED_SCHEMAS[singular];
            const form = TYPE_TO_FORM[singular];
            // Phase 2: the authoritative minimal create seed (single source of
            // truth in @objectstack/spec). Studio/CLI derive create defaults
            // from this via /meta/types instead of re-inventing them.
            const createSeed = getMetadataCreateSeed(singular);

            // Type-level actions: merge the registry's declarative actions
            // with any plugin-registered overlay (`registerMetadataTypeActions`).
            // This is the single accessor — a host plugin (e.g. the private
            // datasource-admin backend) contributes its `test_connection`
            // button here, co-located with the route handler it calls, so the
            // button only appears when the backend that serves it is installed.
            const typeActions = getMetadataTypeActions(singular);

            const base = registryByType.get(singular as any);
            if (base) {
                const isEnvOverridden = writableOverrides.has(singular);
                return {
                    ...base,
                    type: singular,
                    schemaId: singular, // API client expects schemaId field
                    allowOrgOverride: base.allowOrgOverride || isEnvOverridden,
                    overrideSource: isEnvOverridden && !base.allowOrgOverride
                        ? 'env' as const
                        : 'registry' as const,
                    schema,
                    form,
                    ...(createSeed !== undefined ? { createSeed } : {}),
                    // Override the spread `base.actions` with the merged view
                    // (declarative + plugin-registered). Omit when empty to
                    // preserve the prior "no actions key" response shape.
                    ...(typeActions.length ? { actions: typeActions } : {}),
                };
            }
            // Runtime-registered type with no registry entry — synthesise a
            // minimal descriptor so the UI can still surface it.
            return {
                type: singular,
                schemaId: singular, // API client expects schemaId field
                label: singular,
                description: undefined,
                filePatterns: [],
                supportsOverlay: false,
                allowOrgOverride: writableOverrides.has(singular),
                allowRuntimeCreate: true,
                supportsVersioning: false,
                executionPinned: false,
                loadOrder: 1000,
                domain: 'system' as const,
                overrideSource: writableOverrides.has(singular) ? 'env' as const : 'registry' as const,
                schema,
                form,
                ...(createSeed !== undefined ? { createSeed } : {}),
                // Plugin-registered actions on a type with no registry entry.
                ...(typeActions.length ? { actions: typeActions } : {}),
            };
        }).sort((a, b) => {
            if (a.domain !== b.domain) return a.domain.localeCompare(b.domain);
            return a.type.localeCompare(b.type);
        });

        return { types: allTypes, entries };
    }

    /**
     * Sweep all (or filtered) metadata types and report entries that
     * fail spec validation. Powers the Studio governance view
     * (`GET /api/v1/meta/diagnostics`) and `os doctor`-style CLI
     * checks.
     *
     * `severity` defaults to `'error'` — only entries with at least
     * one Zod error issue are returned. `'warning'` includes
     * everything we surface (warnings are reserved for a future lint
     * layer on top of spec validation).
     *
     * `type` may be either a singular (`'view'`) or plural (`'views'`)
     * identifier; the underlying `getMetaItems` already normalises.
     *
     * Implementation note: leverages the `_diagnostics` already
     * decorated onto items by `getMetaItems()` to avoid running
     * `safeParse()` twice. For types whose schema is unregistered we
     * skip silently (they cannot be validated and should not appear
     * as "valid" either — they are simply opaque to this report).
     */
    async getMetaDiagnostics(request: {
        type?: string;
        severity?: 'error' | 'warning';
        organizationId?: string;
        packageId?: string;
    } = {}): Promise<{
        entries: Array<{ type: string; name: string; diagnostics: MetadataDiagnostics }>;
        total: number;
        scannedTypes: number;
        scannedItems: number;
        /**
         * Per-type aggregate stats — count of items and the list of
         * packages contributing to each type. Computed in the same
         * sweep so the Studio directory page can render tile counts
         * and a package filter in one round-trip.
         */
        stats: Record<string, { count: number; locked: number; packages: string[] }>;
    }> {
        const includeWarnings = request.severity === 'warning';
        const targetTypes = request.type
            ? [request.type]
            : DEFAULT_METADATA_TYPE_REGISTRY
                .filter((e) => getMetadataTypeSchema(e.type))
                .map((e) => e.type);

        const entries: Array<{ type: string; name: string; diagnostics: MetadataDiagnostics }> = [];
        const stats: Record<string, { count: number; locked: number; packages: string[] }> = {};
        let scannedItems = 0;

        for (const t of targetTypes) {
            let listed: any;
            try {
                listed = await this.getMetaItems({
                    type: t,
                    organizationId: request.organizationId,
                    packageId: request.packageId,
                } as any);
            } catch {
                // Type not listable in this kernel scope — skip.
                continue;
            }
            const items: any[] = Array.isArray(listed?.items)
                ? listed.items
                : Array.isArray(listed)
                    ? listed
                    : [];
            const pkgSet = new Set<string>();
            let lockedCount = 0;
            for (const item of items) {
                scannedItems += 1;
                const pkg = (item?._packageId ?? null) as string | null;
                if (pkg) pkgSet.add(pkg);
                const lock = item?._lock as string | undefined;
                if (lock && lock !== 'none') lockedCount += 1;
                const diag: MetadataDiagnostics | undefined =
                    item?._diagnostics ?? computeMetadataDiagnostics(t, item);
                if (!diag) continue;
                if (diag.valid && !includeWarnings) continue;
                if (diag.valid && includeWarnings && !diag.warnings?.length) continue;
                entries.push({
                    type: t,
                    name: typeof item?.name === 'string' ? item.name : '<unknown>',
                    diagnostics: diag,
                });
            }
            stats[t] = { count: items.length, locked: lockedCount, packages: [...pkgSet].sort() };
        }

        return {
            entries,
            total: entries.length,
            scannedTypes: targetTypes.length,
            scannedItems,
            stats,
        };
    }

    /**
     * [#5532] Decide what a failed READ against `sys_metadata` means, and
     * rethrow unless it is the ONE benign reason.
     *
     * ## The defect
     *
     * Every overlay read in `getMetaItems`/`getMetaItem` used to `catch {}` into
     * its own empty value — `items` left as-is, `item` left `undefined`, the
     * draft lookup falling through to the active read. That made a metadata
     * store the protocol cannot reach **indistinguishable** from an environment
     * where the item was never customised, and the emptiness then travelled
     * the whole read chain unremarked:
     *
     *   - `getMetaItemCached` turned it into `not found` — an outage answered
     *     as "that item does not exist", which is the opposite disposition
     *     (retry the backend vs. create the item / fix the link);
     *   - the `state='draft'` read turned it into `NO_DRAFT` / 404 — an outage
     *     answered as "there is no pending edit", which a publish flow reads as
     *     "nothing to publish";
     *   - `getMetaItems` turned it into `items: []` — an outage answered as
     *     "this environment declares none of these", the exact shape #5108 fixed
     *     one layer down in `DatabaseLoader` and #5089 in `listForIndex`.
     *
     * ADR-0110 D3 is the rule: a miss and an outage are different facts with
     * opposite meanings, and a consumer must never read one as the other.
     *
     * ## The one benign reason
     *
     * `sys_metadata` has not been provisioned yet. There are then genuinely no
     * overlay rows, so falling through to the registry / MetadataService IS the
     * truth, and a first boot must not explode. Classification is by error TYPE
     * through {@link isMissingTableError} — the same predicate `DatabaseLoader`
     * (#5108) and this package's own `SysMetadataRepository` (#4867) ask, so a
     * driver quirk is taught to the platform once. Conservative in the same
     * direction: an unrecognised error is NOT benign, because a false "benign"
     * silently mis-answers "does this exist?" while a false "real" costs one
     * 503 the caller can retry.
     *
     * @throws {@link metadataStoreUnavailableError} — a 503 carrying the driver
     *         error as `cause`. Not the driver error itself: unwrapped, it has
     *         no status, so the REST boundary would have to guess from the
     *         message text — and `mapDataError` guesses `no such table` into
     *         `404 OBJECT_NOT_FOUND`, i.e. straight back into a miss.
     * @returns normally ONLY for the benign case, licensing the caller to treat
     *          the overlay as absent.
     */
    private rethrowUnlessMetadataStoreUnprovisioned(error: unknown): void {
        if (isMissingTableError(error)) return;
        throw metadataStoreUnavailableError(error);
    }

    /**
     * [#7556] Resolve an OBJECT body that came from the MetadataService into the
     * object's resolved schema, by folding the registry's `extend` contributors
     * onto it.
     *
     * The two readers of a single object — this file's by-name read and its
     * layered view — consult {@link readItemFromMetadataService} BEFORE the
     * SchemaRegistry, because that service is the HMR-fresh copy. For every
     * other metadata type that ordering is free. For `object` it is not: an
     * object's resolved schema is DEFINED (ADR-0029 D9.2 / D9.6) as a base layer
     * with its `extend` contributors folded on, and the MetadataService copy is
     * only the base layer. A deployment that ingests a compiled artifact
     * (`artifactSource`, i.e. every sealed/served runtime) registers `objects`
     * and `objectExtensions` into that service as SEPARATE collections, so the
     * body this method receives is the owner's declaration with no extender in
     * it. Serving it unfolded is what made the showcase's three
     * `objectExtensions` fields readable through `GET /meta/object`, writable
     * through the data API, and absent from `GET /meta/object/:name` — the read
     * the edit and new forms derive from.
     *
     * The list read needs no counterpart: it reads `registry.listItems`, whose
     * object branch resolves through the same fold, so it was never wrong.
     * This method exists to make the two AGREE at their one point of
     * divergence, not to give the by-name route a rule of its own.
     *
     * Applied ONLY to a MetadataService body. A registry-sourced body has
     * already been folded, and the fold concatenates `validations`/`indexes`
     * (see {@link SchemaRegistry.foldObjectExtendersOnto}), so applying it twice
     * would duplicate both.
     */
    private foldObjectExtendersFromRegistry(type: string, name: unknown, body: unknown): unknown {
        const singular = PLURAL_TO_SINGULAR[type] ?? type;
        if (singular !== 'object') return body;
        if (body === null || typeof body !== 'object') return body;
        // [#8027] The list caller reads the name off the ROW rather than off a
        // request, and a row with no usable `name` has no contributor list to
        // look up — `mergePackageAwareOverlay` skips such rows too.
        if (typeof name !== 'string' || name === '') return body;
        const registry = (this.engine as any)?.registry;
        // Partial registry doubles in tests predate this method; a host that
        // cannot fold answers exactly as it did before.
        if (!registry || typeof registry.foldObjectExtendersOnto !== 'function') return body;
        try {
            return registry.foldObjectExtendersOnto(name, body);
        } catch {
            // The fold is a read over in-memory contributors; a failure here
            // must not turn a served schema into a 5xx.
            return body;
        }
    }

    /**
     * [#8268, generalising #8038] The REGISTRY-SIDE half of
     * {@link governServedItem}'s presence convergence: replay the registry's
     * object-materialization seam onto the served body.
     *
     * `applyInjectedSystemColumns` (#6562) converges the columns whose
     * membership is a pure function of the document
     * (`resolveInjectedSystemColumns`), so it needs nothing but the body. The
     * materialization stamps are not like that. `__search` is DEPLOYMENT-gated
     * (`SchemaRegistry` provisions it only when its own `searchCompanion` flag
     * is on, and that flag is `options.searchCompanion ??
     * resolveSearchPinyinEnabled()`, which a host may set explicitly), and the
     * ADR-0079 `nameField` designation must match the answer THAT registry
     * reached over THAT object's contributors. So the answer has to come from
     * the registry that made the decision, which is why this is a method here
     * and a `materializeServedObjectOnto` there, exactly as
     * {@link foldObjectExtendersFromRegistry} is a method here and a
     * `foldObjectExtendersOnto` there (#7556).
     *
     * ⛔ It asks for the WHOLE seam, deliberately, and this is the point of
     * #8268 rather than an implementation detail. Three stamps of one seam —
     * #6562's injected system columns, #8038's `__search`, #8268's `nameField`
     * — diverged on this exact read path and were found, filed and fixed ONE AT
     * A TIME, because each convergence reached for one named stamp. A stamp
     * added to `materializeBaseLayer` now arrives here already converged, with
     * no fourth method and no fourth card.
     *
     * Applied AFTER `governServedItem` at each exit, because the registry
     * materializes after `applySystemFields` too: the title is resolved by
     * `resolveDisplayField` over the POST-injection field set, so injecting
     * first is what makes this pass and the registry's own answer the same
     * answer rather than two independent guesses.
     *
     * No-op for every type but `object`, and — via the registry — for a
     * deployment with companions off, an object with no eligible display field,
     * and a body already carrying every stamp (every registry-backed read,
     * which is the majority path this converges the minority onto).
     */
    private materializeFromRegistry<T>(type: string, body: T): T {
        if (canonicalMetaType(type) !== 'object') return body;
        if (body === null || typeof body !== 'object') return body;
        const registry = (this.engine as any)?.registry;
        // Partial registry doubles in tests predate this method; a host that
        // cannot answer the gate answers exactly as it did before. The
        // `provisionSearchCompanionOnto` fallback keeps a double that was
        // written against #8038's narrower seam serving what it served then,
        // rather than silently losing the companion convergence to a rename.
        if (registry && typeof registry.materializeServedObjectOnto === 'function') {
            try {
                return registry.materializeServedObjectOnto(body) as T;
            } catch {
                // A read over an in-memory flag, the registry's own resolved
                // answer and the body's own fields; a failure here must not turn
                // a served schema into a 5xx.
                return body;
            }
        }
        if (registry && typeof registry.provisionSearchCompanionOnto === 'function') {
            try {
                return registry.provisionSearchCompanionOnto(body) as T;
            } catch {
                return body;
            }
        }
        return body;
    }

    /**
     * {@link governServedItem} plus the registry-gated half it cannot reach
     * ({@link materializeFromRegistry}) — the whole of what a `/meta` READ EXIT
     * owes an object document. Every call site of the free function that is a
     * read exit goes through this instead; the one call site that is not —
     * `getMetaItemLayered`'s `code` / `overlay` layers, which are deliberately
     * raw — never called it in the first place (#6562 ruling constraint 1,
     * #7556's boundary).
     */
    private governServedObject<T>(type: string, item: T): T {
        return this.materializeFromRegistry(type, governServedItem(type, item));
    }

    /**
     * [#8268, generalising #8038] The write-side counterpart of
     * {@link materializeFromRegistry}, owed for the reason
     * {@link stripServedSystemColumns} is owed one field family over: the write
     * path persists the request body verbatim (ADR-0005 §Validation), so a
     * document this service's read added a stamp to would otherwise be handed
     * straight back and stored carrying it.
     *
     * Measured on the runtime-created object path — the write door type
     * `object` has open by default, an artifact-backed object refusing the save
     * outright with `NOT_OVERRIDABLE` — the stored row went from
     * `fields: [name]` to `fields: [__search, name]` on a single GET → PUT
     * before #8038 added the companion half, and gained a `nameField` the
     * author never wrote on the same round trip before #8268 added the title
     * half. The landed `#4326` round-trip pin catches either omission, which is
     * why the read half and this half must move together.
     *
     * ⛔ Asks the registry for the WHOLE seam's inverse rather than for one
     * named stamp — the same reason {@link materializeFromRegistry} does.
     */
    private stripMaterializedFromRegistry<T>(type: string, item: T): T {
        if (canonicalMetaType(type) !== 'object') return item;
        if (item === null || typeof item !== 'object') return item;
        const registry = (this.engine as any)?.registry;
        // Partial registry doubles in tests predate this method; the narrower
        // #8038 spelling keeps such a host stripping what it stripped before
        // rather than silently losing the companion strip to a rename.
        if (registry && typeof registry.stripMaterializedStampsFrom === 'function') {
            try {
                return registry.stripMaterializedStampsFrom(item) as T;
            } catch {
                // A read over the body's own fields; a failure here must not
                // turn a save into a 5xx.
                return item;
            }
        }
        if (registry && typeof registry.stripProvisionedSearchCompanionFrom === 'function') {
            try {
                return registry.stripProvisionedSearchCompanionFrom(item) as T;
            } catch {
                return item;
            }
        }
        return item;
    }

    /**
     * {@link stripServedSystemColumns} plus the registry-seam half
     * ({@link stripMaterializedFromRegistry}) — the whole of what the write
     * path owes {@link governServedObject}.
     */
    private stripServedObjectColumns<T>(type: string, item: T): T {
        return this.stripMaterializedFromRegistry(type, stripServedSystemColumns(type, item));
    }

    /**
     * [#5840] Read ONE item from the `metadata` service, keeping the ADR-0110
     * D3 verdict instead of flattening it into `undefined`.
     *
     * The `sys_metadata` overlay reads in this file already refuse to answer an
     * outage as an absence (#5532 / #5707) — they see a throw and rethrow it as
     * a 503. The MetadataService reads could not do the same, and not because
     * anyone decided they should not: `MetadataManager.get()` swallows a loader
     * failure internally, so an unreachable metadata database arrived here as
     * the very same `undefined` a name that was never declared produces. The
     * verdict existed one layer down (`loadDiagnosed`) and was discarded two
     * hops before this call site. `getDiagnosed` (#5840) hands it over.
     *
     * Deliberately does NOT throw: the two callers want the same fact and
     * dispose of it differently — see each call site. A service that predates
     * `getDiagnosed` reports nothing degraded, which is exactly what it could
     * express before, so its behaviour is unchanged.
     *
     * The singular/plural retry is folded in because both callers do it, and
     * `degraded` must be the verdict of the WHOLE lookup: a first read that
     * failed is not made trustworthy by an alternate spelling that cleanly
     * missed.
     */
    private async readItemFromMetadataService(
        type: string,
        name: string,
        packageId?: string,
    ): Promise<{ data: unknown; degraded: boolean; errors: string[] }> {
        const services = this.getServicesRegistry?.();
        const metadataService: any = services?.get('metadata');
        if (!metadataService || typeof metadataService.get !== 'function') {
            return { data: undefined, degraded: false, errors: [] };
        }
        // ADR-0048 — thread the caller's package id so a single-item fetch is
        // package-scoped. Passed positionally to BOTH reads, so whatever the
        // occupant of the `metadata` slot makes of a third argument today is
        // unchanged by which of the two methods answers.
        const read = async (t: string): Promise<{ data: unknown; degraded: boolean; errors: string[] }> => {
            if (typeof metadataService.getDiagnosed === 'function') {
                const diagnosed = await metadataService.getDiagnosed(t, name, packageId);
                return {
                    data: diagnosed?.data,
                    degraded: diagnosed?.degraded === true,
                    errors: Array.isArray(diagnosed?.errors) ? diagnosed.errors : [],
                };
            }
            return { data: await metadataService.get(t, name, packageId), degraded: false, errors: [] };
        };

        const primary = await read(type);
        if (primary.data !== undefined && primary.data !== null) return primary;
        const alt = PLURAL_TO_SINGULAR[type] ?? SINGULAR_TO_PLURAL[type];
        if (!alt) return { data: undefined, degraded: primary.degraded, errors: primary.errors };
        const secondary = await read(alt);
        if (secondary.data !== undefined && secondary.data !== null) return secondary;
        return {
            data: undefined,
            degraded: primary.degraded || secondary.degraded,
            errors: [...primary.errors, ...secondary.errors],
        };
    }

    /**
     * [#5840] The MetadataService counterpart of
     * {@link rethrowUnlessMetadataStoreUnprovisioned}: turn a degraded read
     * into the same 503 the overlay half of these methods already throws.
     *
     * There is no driver error to carry here — `MetadataManager` warn-logs and
     * skips each failing loader — so `cause` is built from the messages it
     * collected, which is what reaches the operator through
     * `handleRouteError` / `logWithheldServerFault`.
     */
    private throwMetadataServiceUnavailable(errors: string[]): never {
        throw metadataStoreUnavailableError(
            new Error(
                `The metadata service could not read every loader: ${
                    errors.length > 0 ? errors.join('; ') : 'no loader detail reported'
                }`,
            ),
        );
    }

    async getMetaItems(request: { type: string; packageId?: string; organizationId?: string; previewDrafts?: boolean }) {
        // #4432 — CANONICAL TYPE KEY. See {@link canonicalMetaType}. This one
        // is load-bearing twice over: the SchemaRegistry indexes code-authored
        // items under the SINGULAR type, and the overlay-hydration branch below
        // registers overlay rows back into it under `request.type`. Called with
        // the plural spelling, that branch minted a PLURAL registry entry — and
        // once `listItems('actions')` was non-empty, the singular fallback that
        // had been supplying the 11 code-authored actions stopped running. One
        // overlay row shadowed the entire code-authored listing.
        request = canonicalizeMetaRequestType(request);
        const { packageId } = request;
        let items: unknown[] = [];

        // Unscoped kernels (control plane): read everything from SchemaRegistry.
        // Scoped (project) kernels: skip user-project entries in SchemaRegistry to
        // prevent cross-project leakage, but DO include scope:'system' packages
        // (plugin-auth, plugin-security, plugin-audit, …) — those are globally
        // shared and must be visible at every project's meta endpoint.
        if (this.environmentId === undefined) {
            items = [...this.engine.registry.listItems(request.type, packageId)];
            // Normalize singular/plural using explicit mapping
            if (items.length === 0) {
                const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
                if (alt) items = [...this.engine.registry.listItems(alt, packageId)];
            }
        } else {
            // For project kernels: the SchemaRegistry is owned by THIS
            // kernel's ObjectQL instance (not shared across projects in the
            // process), so we can safely include every package — system
            // plugins (auth/security/audit) and the project's own app
            // package alike. The `_packageId` tag added by `listItems`
            // (registry.ts) is preserved for the sidebar to compute the
            // correct navigation URL.
            items = [...this.engine.registry.listItems(request.type, packageId)];
            if (items.length === 0) {
                const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
                if (alt) items = [...this.engine.registry.listItems(alt, packageId)];
            }
        }

        // Always consult the DB so metadata persisted by the seeder /
        // bulkRegister shows up even when the registry already has unrelated
        // entries (the previous fallback-only logic meant per-env metadata
        // was never surfaced whenever system-bridged items populated the
        // registry). Deduplicate against whatever the registry returned.
        //
        // ADR-0005 (revised 2026-05): isolation is now per-organization, since
        // each env has its own physical DB. We surface both org-scoped overlays
        // (when an active org is provided) and env-wide (organization_id IS NULL)
        // overlays; org-scoped rows win on name collision.
        try {
            const orgId = (request as any).organizationId as string | undefined;
            const queryByOrg = async (oid: string | null): Promise<any[]> => {
                const whereClause: Record<string, unknown> = {
                    type: request.type,
                    state: 'active',
                    organization_id: oid,
                };
                if (packageId) whereClause.package_id = packageId;
                let rs = await this.engine.find('sys_metadata', { where: whereClause });
                if ((!rs || rs.length === 0)) {
                    const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
                    if (alt) {
                        const altWhere: Record<string, unknown> = { type: alt, state: 'active', organization_id: oid };
                        if (packageId) altWhere.package_id = packageId;
                        rs = await this.engine.find('sys_metadata', { where: altWhere });
                    }
                }
                return rs ?? [];
            };
            const envWideRecords = await queryByOrg(null);
            const orgRecords = orgId ? await queryByOrg(orgId) : [];
            // org-specific rows override env-wide rows on name collision.
            // ADR-0048 (#1828) — key by (package, name), not bare name, so a
            // package A row and a package B row of the same name do not
            // collapse; org-over-env precedence still holds within each slot.
            //
            // [#7774] …and for a bundled type the slot is `(package, name,
            // locale)`. Within ONE org this changes nothing — the store's own
            // unique index is `(type, name, organization_id, package_id)`, so
            // an org cannot hold two rows that differ only by body locale.
            // Across the two tiers it can: an env-wide row and this org's row
            // may customize DIFFERENT members of one bundle, and keying them
            // together made the org's zh-CN row silently displace the
            // env-wide en-US one. Precedence is unchanged where it was ever
            // meaningful — an org row still overrides the env-wide row of the
            // same member — and an undiscriminated type keeps a
            // byte-identical key.
            const mergedMap = new Map<string, any>();
            const rowKey = (r: any): string =>
                metaItemKey(r.package_id, r.name, storedRowDiscriminator(request.type, r));
            for (const r of envWideRecords) mergedMap.set(rowKey(r), r);
            for (const r of orgRecords) mergedMap.set(rowKey(r), r);
            const records = Array.from(mergedMap.values());
            if (records && records.length > 0) {
                const isView = (PLURAL_TO_SINGULAR[request.type] ?? request.type) === 'view';
                // Parse each overlay body once — replaying the stored-row
                // conversion chain (#3903) so every consumer of this list sees
                // the canonical protocol shape — and surface its persisted
                // software-package binding so the sidebar package filter and
                // provenance classification see overlay rows the way they see
                // registry items.
                const overlays = records.map((record) => {
                    const data = this.convertStoredItem(
                        String(record.type ?? request.type),
                        typeof record.metadata === 'string'
                            ? JSON.parse(record.metadata)
                            : record.metadata,
                    ) as any;
                    const recPkg = (record as { package_id?: string | null }).package_id ?? undefined;
                    if (recPkg && data && typeof data === 'object' && (data as any)._packageId === undefined) {
                        (data as any)._packageId = recPkg;
                    }
                    // [#6602] The row's own scope travels with its body. The
                    // merged set below is env-wide rows PLUS this org's rows,
                    // and the two are only distinguishable here, at the row.
                    const recOrg = (record as { organization_id?: string | null }).organization_id ?? null;
                    return { data, packageId: recPkg, organizationId: recOrg };
                });

                // ADR-0048 (#1828) — package-aware merge: a package-scoped row
                // overlays ONLY its own package's entry, so two installed
                // packages shipping the same `type/name` (e.g. `page/home`) are
                // not collapsed to one. #2555 — heal identity-less view overlays
                // from the entry they shadow (a raw-config row would otherwise
                // drop viewKind/object and vanish the view from switcher/list
                // consumers); the overlay's own fields still win. [#7774] The
                // merge slot carries the bundle discriminator, so an
                // `email_template` overlay lands on its own locale member
                // instead of flattening every member of the bundle onto it.
                items = mergePackageAwareOverlay(request.type, items, overlays, (data, prev) => {
                    if (isView && data && typeof data === 'object') {
                        const patch = viewIdentityPatch(data as Record<string, unknown>, prev);
                        if (patch) Object.assign(data as Record<string, unknown>, patch);
                    }
                    // [#8027] The list half of the same rule the by-name read
                    // applies to its own overlay adoption. This merge REPLACES a
                    // base item with the overlay body wholesale (it is a
                    // per-slot layer pick, not a field merge), so for `object` —
                    // whose resolved schema is D9.2's base-plus-extenders — the
                    // winning row has to be resolved the same way `resolveObject`
                    // resolves the base it displaced, or the two reads of one
                    // object disagree the moment a row exists. Both routes were
                    // wrong here together, which is why #7556's byName===listed
                    // pin stayed green through this defect.
                    return this.foldObjectExtendersFromRegistry(
                        request.type, (data as { name?: unknown } | null)?.name, data,
                    );
                });

                // Only hydrate the global registry for unscoped (control-plane)
                // calls — scoped project entries must not leak process-wide.
                // #4521 — this loop is no longer the ONLY way an overlay reaches
                // the registry (the write writes through as well), so it is the
                // shared {@link hydrateOverlayIntoRegistry} that both callers
                // use: a read and a write that register differently would put
                // the registry in two different states for the same row.
                //
                // [#6602] The kernel gate below is only half the rule, and the
                // half that was missing is the ROW's: `overlays` is the MERGED
                // env-wide + org-scoped set, so this loop used to graft this
                // caller's org bodies into the registry every other org in the
                // process reads from — one listing call was enough, and it also
                // undid the write-side gate for anything already saved. The
                // per-row verdict now lives in the shared hydrator, which each
                // row's own `organizationId` answers to; the merged LIST above
                // is unchanged, so org readers still get their overlays.
                if (this.environmentId === undefined) {
                    for (const { data, packageId: recPkg, organizationId: recOrg } of overlays) {
                        this.hydrateOverlayIntoRegistry(request.type, data, {
                            packageId: recPkg,
                            organizationId: recOrg,
                        });
                    }
                }
            }
        } catch (error) {
            // [#5532] Only "sys_metadata not provisioned yet" licenses us to
            // answer with whatever we already have. Any other read failure
            // means overlay rows may exist and were not seen — serving the
            // registry-only set would report them as never declared.
            this.rethrowUnlessMetadataStoreUnprovisioned(error);
        }

        // ADR-0033 draft-overlay preview: when the caller opts in (admin-gated
        // upstream — see http-dispatcher), overlay `state='draft'` rows on top of
        // the active result so the rendered console can preview pending changes
        // BEFORE publish (instead of only reading them as a JSON diff). Draft rows
        // WIN over active on name collision, and draft-only items (e.g. a brand-new
        // AI-authored object) surface too. Each overlaid item is tagged `_draft:true`
        // so the UI can badge it and show the "PREVIEW — drafts" banner. We do NOT
        // hydrate the SchemaRegistry from drafts — drafts must never leak into the
        // process-wide registry or to non-preview reads.
        if (request.previewDrafts) {
            try {
                const orgId = (request as any).organizationId as string | undefined;
                const queryDrafts = async (oid: string | null): Promise<any[]> => {
                    const whereClause: Record<string, unknown> = { type: request.type, state: 'draft', organization_id: oid };
                    if (packageId) whereClause.package_id = packageId;
                    let rs = await this.engine.find('sys_metadata', { where: whereClause });
                    if (!rs || rs.length === 0) {
                        const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
                        if (alt) {
                            const altWhere: Record<string, unknown> = { type: alt, state: 'draft', organization_id: oid };
                            if (packageId) altWhere.package_id = packageId;
                            rs = await this.engine.find('sys_metadata', { where: altWhere });
                        }
                    }
                    return rs ?? [];
                };
                const draftRecords = [...(await queryDrafts(null)), ...(orgId ? await queryDrafts(orgId) : [])];
                if (draftRecords.length > 0) {
                    // ADR-0048 (#1828) — package-aware draft overlay (parity with
                    // the active-overlay merge above): a package-scoped draft
                    // previews only its own package's entry, so two packages'
                    // same-name drafts stay distinct. Draft rows win over active.
                    const drafts = draftRecords.map((record) => {
                        const data = this.convertStoredItem(
                            String(record.type ?? request.type),
                            typeof record.metadata === 'string' ? JSON.parse(record.metadata) : record.metadata,
                        ) as any;
                        const recPkg = (record as { package_id?: string | null }).package_id ?? undefined;
                        if (recPkg && data && typeof data === 'object' && (data as any)._packageId === undefined) {
                            (data as any)._packageId = recPkg;
                        }
                        return { data, packageId: recPkg };
                    });
                    // [#7774] Same bundle slot as the active merge above — a
                    // draft of one locale must preview over that locale, not
                    // over the whole bundle.
                    items = mergePackageAwareOverlay(request.type, items, drafts, (data) => {
                        if (data && typeof data === 'object') (data as any)._draft = true;
                        return data;
                    });
                }
            } catch (error) {
                // [#5532] Same rule as the active-overlay read above. Serving
                // the active result "unchanged" is a lie to a caller that asked
                // for a draft preview: it renders the published world while the
                // pending edits it asked to see were never read.
                this.rethrowUnlessMetadataStoreUnprovisioned(error);
            }
        }

        // Merge with MetadataService (runtime-registered items: agents, tools, etc.)
        try {
            const services = this.getServicesRegistry?.();
            const metadataService = services?.get('metadata');
            if (metadataService && typeof metadataService.list === 'function') {
                let runtimeItems = await metadataService.list(request.type);
                // When filtering by packageId, only include runtime items that
                // belong to the requested package. MetadataService.list() returns
                // items from ALL packages, so we must filter here to respect the
                // package scope requested by the caller (e.g., Studio sidebar).
                if (packageId && runtimeItems && runtimeItems.length > 0) {
                    runtimeItems = runtimeItems.filter((item: any) => item?._packageId === packageId);
                }
                if (runtimeItems && runtimeItems.length > 0) {
                    // Merge, avoiding duplicates. ADR-0048 (#1828) — resolution
                    // is per `(slot, package)` and never by bare `name`, so a
                    // runtime item from one package does not collapse a
                    // same-name item from another.
                    //
                    // [#7774] …and the slot carries the bundle discriminator
                    // for a type whose identity the spec declares as a pair.
                    // This merge is where the i18n bundle actually died:
                    // `items` already held both members (the registry keeps
                    // them since #7730), the second write overwrote the first,
                    // and `GET /meta/email_template` served one locale. It only
                    // ever runs with a `metadata` service installed AND
                    // answering non-empty for the type — which is why that
                    // regression was invisible to every suite that omits one.
                    //
                    // [#7654] THE RESOLUTION IS THE OVERLAY MERGE'S, and it is
                    // now literally that function instead of a second
                    // implementation of the same idea. As a hand-rolled `Map`
                    // keyed on `(package, name)` with STRICT equality, this step
                    // disagreed with {@link mergePackageAwareOverlay} — which
                    // runs one layer above it on the very same list — about the
                    // package-LESS row, and the disagreement reached the wire as
                    // a duplicate. A package-less row does not merely occupy a
                    // slot of its own: it STANDS IN for each package's row of
                    // that name, which is how `getMetaItem(name, packageId=P)`
                    // resolves and what the overlay merge already implements.
                    //
                    // A runtime `PUT /api/v1/meta/<type>/<name>` carries no
                    // `?package=`, so `sys_metadata` takes a
                    // `package_id IS NULL` row. For a type the SchemaRegistry
                    // has nothing for — `skill`, `agent` and `tool` reach the
                    // MetadataService through its own loaders, so the registry
                    // listing is empty and this baseline is the only package row
                    // there is — that overlay leaves the merge above UNSTAMPED
                    // (it stamps `_packageId` from the base row it displaced,
                    // and there was none). Its key then missed the
                    // package-bearing baseline row here, the "already present"
                    // guard below never fired, and `GET /api/v1/meta/skill`
                    // listed the override row AND the package row after a 200
                    // PUT. The mirrored attribution — a package-less runtime
                    // baseline under a package-bearing higher row — duplicated
                    // for the same reason and is closed by the same call.
                    //
                    // Layer order is the one the guard this replaces stated:
                    // entries from `sys_metadata` (customization overlays) or
                    // the SchemaRegistry WIN over the MetadataService's artifact
                    // baseline — without that, saved per-org dashboard / view
                    // overlays disappeared from list endpoints on refresh while
                    // the detail endpoint kept showing them. So `items` is the
                    // higher layer (`records`) and the runtime listing is the
                    // base, and "latest contribution wins" reproduces the guard
                    // rather than reversing it.
                    items = mergePackageAwareOverlay(
                        request.type,
                        runtimeItems as unknown[],
                        (items as any[]).map((it) => ({
                            data: it,
                            packageId: ((it as any)?._packageId ?? undefined) as string | undefined,
                        })),
                    );
                }
            }
        } catch {
            // MetadataService not available or doesn't support this type
        }

        // Hide metadata owned by a disabled package. `listItems` already drops
        // disabled-package items from the SchemaRegistry, but the DB overlay and
        // MetadataService merges above can re-introduce them (e.g. an app/view
        // persisted in sys_metadata). Re-apply the filter on the final merged
        // set so a disabled package's metadata stops surfacing in the console.
        //
        // Never filter `package`: the Packages page must list disabled packages
        // to re-enable them, so filtering it would make disable irreversible.
        //
        // [#7557] `object` USED to be exempt here too, on the reasoning that
        // "filtering objects would break data queries that depend on their
        // schema". That conflated two different readers. Data queries resolve
        // schema through `registry.getObject` / `listItems('object')` — the
        // registry primitives, which this filter does not touch and which
        // deliberately keep serving a disabled package's objects so migrations,
        // cross-package references and the runtime authoring gate (`protocol.ts`
        // resolution context) still see a complete object universe. NOTHING
        // resolves a query's schema through `getMetaItems`, which is the API
        // READ surface. So the exemption bought no safety and cost the
        // enforcement: `/meta/objects` kept listing a disabled package's objects
        // while its nav and views correctly vanished.
        //
        // The data plane is refused separately and loudly, in
        // `assertObjectRegistered` (`OBJECT_PACKAGE_DISABLED`) — absence here
        // and refusal there are the two halves of one answer, pinned together
        // by `protocol.package-disable-enforcement.test.ts`.
        if (request.type !== 'package') {
            items = (items as any[]).filter(
                (it) => !this.engine.registry.isPackageDisabled((it as any)?._packageId),
            );
        }

        // Canonical-shape exposure (ADR-0017, "Object has-many View"): a
        // `defineView` document is kept in the registry under the bare
        // `<object>` key for defensive single-item reads, but it is NOT a
        // first-class, independently addressable view — the registrar expands
        // it into independent ViewItems (each carrying `viewKind` + `config`).
        // Never surface the aggregated `{ list, form, listViews }` container
        // through enumeration so every list consumer (Studio metadata list,
        // REST `GET /meta/view`, AI schema retriever) sees exactly one
        // canonical entry per named view and never the legacy wrapper shape.
        if (request.type === 'view' || request.type === 'views') {
            items = (items as any[]).filter((it) => !isAggregatedViewContainer(it));
        }

        // Merge registered navigation contributions into each served app
        // (ADR-0029 D7). The setup app is a shell of empty group anchors;
        // platform-objects and capability plugins inject their menu entries as
        // contributions, merged lazily on read. REST app endpoints read through
        // this path (not registry.getAllApps), so the merge must happen here too
        // or every contributed group renders empty.
        if (request.type === 'app' || request.type === 'apps') {
            items = (items as any[]).map((app) => this.engine.registry.applyNavContributions(app));
        }

        return {
            type: request.type,
            items: decorateMetadataItems(
                request.type,
                (items as any[]).map((it) => {
                    // ADR-0048 — scope the artifact lookup to THIS item's owning
                    // package so a same-name collision grafts each item's own
                    // protection envelope, not the first-registered package's.
                    // (`requested` packageId, when the whole list is scoped,
                    // takes priority; else the item's own `_packageId`.)
                    const a = this.lookupArtifactItem(
                        request.type,
                        (it as any)?.name,
                        packageId ?? ((it as any)?._packageId as string | undefined),
                    );
                    // [#4513] Same governance as the single-item read — the list
                    // is the other exit a client reads field metadata from, and
                    // an overlay row wins over the (already-governed) registry
                    // entry in the merge above, so it carries the same lie.
                    return this.governServedObject(request.type, mergeArtifactProtection(it, a)) as any;
                }),
            ),
        };
    }

    async getMetaItem(request: { type: string, name: string, packageId?: string, organizationId?: string, state?: 'active' | 'draft', previewDrafts?: boolean }) {
        // #4432 — CANONICAL TYPE KEY. See {@link canonicalMetaType}.
        request = canonicalizeMetaRequestType(request);
        let item: unknown;
        const orgId = request.organizationId;
        // Studio's editor opens a draft buffer with `state: 'draft'`;
        // runtime loaders omit it and get the live published row.
        const readState: 'active' | 'draft' = request.state === 'draft' ? 'draft' : 'active';

        // ADR-0033 draft-overlay preview (non-strict): when the caller opts in
        // (admin-gated upstream), prefer a `state='draft'` row if one exists, else
        // fall back to the active read below. This differs from the strict
        // `state:'draft'` mode, which 404s (`no_draft`) when no draft exists — the
        // render path must degrade to the published value, not error. The draft
        // item is tagged `_draft:true` so the UI can badge it.
        if (request.previewDrafts && readState !== 'draft') {
            try {
                const findDraft = async (oid: string | null): Promise<any | undefined> => {
                    // ADR-0048 prefer-local (parity with the active-read overlay below).
                    const lookup = async (t: string): Promise<any | undefined> => {
                        const base: Record<string, unknown> = {
                            type: t, name: request.name, state: 'draft', organization_id: oid,
                        };
                        if (request.packageId) {
                            const scoped = await this.engine.findOne('sys_metadata', {
                                where: { ...base, package_id: request.packageId },
                            });
                            if (scoped) return scoped;
                            // ADR-0048 — global (package-less) draft only, never
                            // another package's draft.
                            return await this.engine.findOne('sys_metadata', {
                                where: { ...base, package_id: null },
                            });
                        }
                        return await this.engine.findOne('sys_metadata', { where: base });
                    };
                    const rec = await lookup(request.type);
                    if (rec) return rec;
                    const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
                    if (alt) return await lookup(alt);
                    return undefined;
                };
                const draftRec = (orgId ? await findDraft(orgId) : undefined) ?? await findDraft(null);
                if (draftRec) {
                    const draftItem = this.convertStoredItem(
                        String(draftRec.type ?? request.type),
                        typeof draftRec.metadata === 'string'
                            ? JSON.parse(draftRec.metadata)
                            : draftRec.metadata,
                    ) as any;
                    if (draftItem && typeof draftItem === 'object') {
                        const recPkg = (draftRec as { package_id?: string | null }).package_id ?? undefined;
                        if (recPkg && (draftItem as any)._packageId === undefined) (draftItem as any)._packageId = recPkg;
                        (draftItem as any)._draft = true;
                    }
                    return {
                        type: request.type,
                        name: request.name,
                        item: decorateMetadataItem(request.type, this.governServedObject(request.type, draftItem)),
                    };
                }
            } catch (error) {
                // [#5532] Falling through to the active read here would answer
                // "there is no draft for this item" from a read that never
                // reached the table the drafts live in.
                this.rethrowUnlessMetadataStoreUnprovisioned(error);
            }
        }

        // 1. Customization overlay lookup (sys_metadata).
        //    Per ADR-0005 (revised), org-scoped row wins; env-wide
        //    (organization_id IS NULL) row is the fallback before falling
        //    through to the in-memory registry / MetadataService.
        try {
            const findOverlay = async (oid: string | null): Promise<any | undefined> => {
                // ADR-0048 prefer-local: when a package id is supplied and two
                // installed packages ship the same type/name, prefer the row owned
                // by that package before falling back to first-match (package-less
                // query). This mirrors `SchemaRegistry.getItem(type, name, pkg)`.
                const lookup = async (t: string): Promise<any | undefined> => {
                    const base: Record<string, unknown> = {
                        type: t,
                        name: request.name,
                        state: readState,
                        organization_id: oid,
                    };
                    if (request.packageId) {
                        const scoped = await this.engine.findOne('sys_metadata', {
                            where: { ...base, package_id: request.packageId },
                        });
                        if (scoped) return scoped;
                        // ADR-0048 — no package-owned overlay; fall back to the
                        // GLOBAL (package-less) overlay only. Must NOT match a
                        // different package's row, or a collision would serve
                        // package B's customization for a package A read.
                        return await this.engine.findOne('sys_metadata', {
                            where: { ...base, package_id: null },
                        });
                    }
                    // No package context (legacy/runtime reader) — match any.
                    return await this.engine.findOne('sys_metadata', { where: base });
                };
                const rec = await lookup(request.type);
                if (rec) return rec;
                const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
                if (alt) return await lookup(alt);
                return undefined;
            };
            const record = (orgId ? await findOverlay(orgId) : undefined)
                ?? await findOverlay(null);
            if (record) {
                item = this.convertStoredItem(
                    String(record.type ?? request.type),
                    typeof record.metadata === 'string'
                        ? JSON.parse(record.metadata)
                        : record.metadata,
                );
                // Surface the persisted software-package binding (parity with
                // the list path in getMetaItems) so provenance/UI can read it.
                const recPkg = (record as { package_id?: string | null }).package_id ?? undefined;
                if (recPkg && item && typeof item === 'object' && (item as any)._packageId === undefined) {
                    (item as any)._packageId = recPkg;
                }
            }
        } catch (error) {
            // [#5532] THE site this issue was raised on. Falling through to the
            // registry / MetadataService with `item` still `undefined` is what
            // let a storage outage arrive at the client as `not found` (active
            // read) or `NO_DRAFT` (draft read) — both of them claims about
            // authorship, made from a read that never happened.
            this.rethrowUnlessMetadataStoreUnprovisioned(error);
        }

        // Draft reads stop here — they intentionally do NOT fall through
        // to the runtime registry / MetadataService (which only know
        // about published values). When the draft row is missing we
        // throw `no_draft` (HTTP 404) so the REST contract is identical
        // to `POST /publish` on an empty slot: clients use a single
        // status code to decide "no pending edit" without sniffing
        // envelope shape. See ADR-0005 §draft-lifecycle.
        if (readState === 'draft') {
            if (item === undefined) {
                const err: any = new Error(
                    `[no_draft] No pending draft exists for ${request.type}/${request.name}.`,
                );
                err.code = 'NO_DRAFT';
                err.status = 404;
                throw err;
            }
            return {
                type: request.type,
                name: request.name,
                item: decorateMetadataItem(request.type, this.governServedObject(request.type, item)),
            };
        }

        // [#8027] An OBJECT's overlay row is a BASE LAYER, not a resolved
        // schema. ADR-0029 D9.2 defines the resolution as `overlay ?? own` with
        // the `extend` contributors folded ON — which is what
        // `SchemaRegistry.resolveObject` does for an overlay it knows about, and
        // what step 2 below already does (#7556) for the MetadataService copy.
        // Step 1 was the one adopter that served its layer verbatim, so a single
        // customisation row — an admin renaming the object's label in Studio —
        // silently dropped every extension-contributed field from this read, and
        // therefore from every writable form derived from it, while the data API
        // kept accepting and persisting those same fields.
        //
        // Placed AFTER the draft return on purpose: a draft is a pending edit of
        // the base layer, and folding it would show an author extension fields
        // inside the document they are editing and about to PUT back. Drafts were
        // never folded (before #7556 nothing was), so this leaves that asymmetry
        // exactly where it already was rather than widening this fix into it.
        //
        // No-op for every type but `object`, for an object nothing extends, and
        // for an item with no overlay row (`item` is still undefined here, and
        // step 2 / step 3 fold their own sources).
        if (item !== undefined) {
            item = this.foldObjectExtendersFromRegistry(request.type, request.name, item);
        }

        // 2. MetadataService (runtime-registered items: HMR-updated view/page/
        //    dashboard/agent/tool, plus FilesystemLoader-sourced items). This
        //    is consulted BEFORE the in-memory SchemaRegistry because the
        //    registry is a boot-time cache populated by `loadMetadataFromService`
        //    and is NOT invalidated on `MetadataManager.register()` (which is
        //    how the CLI dev watcher pushes recompiled metadata into the
        //    running server). Without this ordering, edits to `*.view.ts`
        //    source files appear to take effect (MetadataManager learns the
        //    new value) but reads continue to return the stale registry copy.
        // [#5840] `serviceDegraded` survives past the registry step below on
        // purpose — see the branch that reads it after step 3 for why the
        // verdict cannot be acted on here.
        let serviceDegraded: { degraded: boolean; errors: string[] } | undefined;
        if (item === undefined) {
            try {
                // Threads the caller's package id (ADR-0048) so a single-item
                // fetch is package-scoped: when two installed packages ship the
                // same type/name, the facade prefers the requester's own item.
                const fromService = await this.readItemFromMetadataService(
                    request.type,
                    request.name,
                    request.packageId,
                );
                if (fromService.data !== undefined && fromService.data !== null) {
                    // [#7556] A layer, not a resolved schema — see
                    // {@link foldObjectExtendersFromRegistry}. No-op for every
                    // type but `object`, and for an object nothing extends.
                    item = this.foldObjectExtendersFromRegistry(
                        request.type, request.name, fromService.data,
                    );
                } else if (fromService.degraded) {
                    serviceDegraded = fromService;
                }
            } catch {
                // MetadataService not available — fall through
            }
        }

        // 3. In-memory SchemaRegistry (artifact-loaded out-of-box values, and
        //    items that bypass MetadataService — e.g. some object-schema
        //    extension chains registered by AppPlugin directly).
        //    Both control-plane (unscoped) and project kernels consult the
        //    registry. The previous guard that skipped the registry for
        //    project kernels was meant to prevent cross-project leakage at
        //    the LIST level — but for a single-item lookup the kernel's own
        //    `engine.registry` is project-local (each ObjectQL instance has
        //    its own SchemaRegistry), so reading from it is safe and
        //    necessary. Without this, project-kernel callers of
        //    `GET /api/v1/meta/object/<name>` 404 even though the object is
        //    registered and visible via the list endpoint.
        if (item === undefined) {
            item = this.engine.registry.getItem(request.type, request.name, request.packageId);
            if (item === undefined) {
                const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
                if (alt) item = this.engine.registry.getItem(alt, request.name, request.packageId);
            }
        }

        // [#5840] The MetadataService half of the #5532 rule, and the last
        // moment it can be applied. The cached-read wrapper below this method
        // documents its 404 as "reaching here now means a real miss —
        // `getMetaItem` throws 503 rather than answering `undefined` when the
        // store could not be read". That was true of the overlay read only: a
        // metadata database the LOADERS could not reach was warn-logged inside
        // `MetadataManager` and arrived at step 2 as a plain `undefined`, so
        // the outage was served as `404 RESOURCE_NOT_FOUND` — a claim about
        // what the author declared, made from a read that never happened.
        //
        // Deliberately narrow, and deliberately after step 3: a registry hit is
        // a real declaration, so the answer contains no false claim and is
        // served exactly as before (possibly staler than the service copy — the
        // pre-existing ordering trade-off, not this issue's). Only when the
        // WHOLE chain resolved nothing does the degraded read change anything,
        // because only then would this method answer "no such item".
        if (item === undefined && serviceDegraded?.degraded) {
            this.throwMetadataServiceUnavailable(serviceDegraded.errors);
        }

        // Merge registered navigation contributions into a served app
        // (ADR-0029 D7) — parity with the getMetaItems list path so a
        // single-app fetch (GET /meta/app/<name>) also sees the contributed
        // menu entries, not just the empty group-anchor shell.
        if ((request.type === 'app' || request.type === 'apps') && item) {
            item = this.engine.registry.applyNavContributions(item);
        }

        // ADR-0010 §3.3 — artifact-level protection (lock/packageId) always
        // wins over any overlay row. The metadata service may return a
        // persisted overlay copy that pre-dates the artifact's `_lock`
        // declaration; we must consult the in-memory artifact registry
        // directly and let its protection envelope override.
        // ADR-0048 — scope the artifact lookup to the requested package so a
        // same-name collision grafts the OWNING package's protection envelope
        // (`_packageId`/`_lock`), not whichever package registered first.
        const artifactItem = this.lookupArtifactItem(request.type, request.name, request.packageId);
        let decorated = decorateMetadataItem(
            request.type,
            this.governServedObject(request.type, mergeArtifactProtection(item, artifactItem)),
        );
        // ADR-0047 — list views additionally get reference-integrity
        // diagnostics (userFilters/tabs fields must exist on the source
        // object, kanban groupBy must be select-like). Zod cannot see
        // across documents; merge the cross-document errors into the
        // same `_diagnostics` envelope. Defensive: a failed lookup must
        // never break a read.
        if ((request.type === 'view' || request.type === 'views') && decorated && typeof decorated === 'object') {
            try {
                const viewDoc = decorated as Record<string, any>;
                const sourceObject = viewDoc?.object
                    ?? viewDoc?.data?.object
                    ?? viewDoc?.objectName
                    ?? viewDoc?.list?.data?.object;
                const objectDef = typeof sourceObject === 'string'
                    ? this.engine.registry.getObject(sourceObject)
                    : undefined;
                if (objectDef) {
                    const refs = computeViewReferenceDiagnostics(viewDoc, objectDef as any);
                    if (!refs.valid) {
                        const prior = viewDoc._diagnostics;
                        decorated = {
                            ...viewDoc,
                            _diagnostics: {
                                valid: false,
                                errors: [
                                    ...(prior && prior.valid === false && Array.isArray(prior.errors) ? prior.errors : []),
                                    ...(refs.errors ?? []),
                                ],
                            },
                        } as typeof decorated;
                    }
                }
            } catch { /* reference diagnostics are best-effort */ }
        }
        // ADR-0010 — surface lock/provenance flags so Studio can render
        // the correct affordances without a second round trip.
        const artifactBacked = this.isArtifactBacked(request.type, request.name);
        const lockState = resolveLockState(decorated, artifactBacked);
        return {
            type: request.type,
            name: request.name,
            item: decorated,
            lock: lockState.lock,
            ...(lockState.lockReason !== undefined ? { lockReason: lockState.lockReason } : {}),
            ...(lockState.lockSource !== undefined ? { lockSource: lockState.lockSource } : {}),
            ...(lockState.lockDocsUrl !== undefined ? { lockDocsUrl: lockState.lockDocsUrl } : {}),
            ...(lockState.provenance !== undefined ? { provenance: lockState.provenance } : {}),
            ...(lockState.packageId !== undefined ? { packageId: lockState.packageId } : {}),
            ...(lockState.packageVersion !== undefined ? { packageVersion: lockState.packageVersion } : {}),
            editable: lockState.editable,
            deletable: lockState.deletable,
            resettable: lockState.resettable,
        };
    }

    /**
     * Phase 3a-layered-get: return the 3 layers of a metadata item
     * separately — `code` (artifact-loaded baseline), `overlay` (per-org
     * customisation row, if any), and `effective` (what `getMetaItem`
     * would return, i.e. overlay-wins merge).
     *
     * Drives the "Code default vs Overlay vs Effective" diff tab in the
     * generic Metadata Resource Edit page. Admins can see exactly what
     * was customised and reset selectively.
     *
     * `code` is null if no artifact baseline exists; `overlay` is null if
     * no sys_metadata row exists for the requested scope; `effective` is
     * never null when either layer exists.
     *
     * [#5707] Those three sentences are ASSERTIONS about what the author
     * declared, so the method may only make them from a read that happened.
     * The layers are a 3-LAYER shape (code / overlay / effective), not a
     * 3-VALUE one: there is no "unknown" spelling for a layer, and the null
     * that would have to stand in for it already means "not customised". So
     * an overlay read that failed is reported as a failure, never as a layer.
     *
     * [#5840] That rule now holds on BOTH halves. It could not before: the
     * code layer's failure is a loader `MetadataManager` warn-logs and skips,
     * so it reached this method as an ordinary `undefined` and became
     * `code: null` — the same unfounded assertion, one column to the left, and
     * the one the lock/affordance flags are derived from.
     *
     * @throws {@link metadataStoreUnavailableError} — 503 /
     *         `SERVICE_UNAVAILABLE` when a read that would decide a layer did
     *         not happen: the `sys_metadata` overlay read failing for any
     *         reason other than the table not being provisioned yet (which
     *         genuinely means "no overlay row" and still returns normally),
     *         carrying the driver error on `cause`; or (#5840) the code
     *         layer's MetadataService read reporting `degraded` with nothing
     *         in the registry to answer instead, carrying the failing loaders'
     *         messages on `cause`.
     */
    async getMetaItemLayered(request: {
        type: string;
        name: string;
        packageId?: string;
        organizationId?: string;
    }): Promise<{
        type: string;
        name: string;
        code: unknown | null;
        overlay: unknown | null;
        overlayScope: 'org' | 'env' | null;
        effective: unknown | null;
        /**
         * Load-time validation result for the effective payload — same
         * shape attached to getMetaItems/getMetaItem by
         * decorateMetadataItem. Undefined for types without a registered
         * Zod schema (function/service/router). Lets the Studio edit
         * page surface invalid-metadata banners + inline field errors
         * without a second round-trip.
         */
        _diagnostics?: MetadataDiagnostics;
        // ── ADR-0010 protection envelope ──
        lock: MetadataLock;
        lockReason?: string;
        lockSource?: 'artifact' | 'package' | 'env-forced' | 'overlay';
        lockDocsUrl?: string;
        provenance?: MetadataProvenance;
        packageId?: string;
        packageVersion?: string;
        editable: boolean;
        deletable: boolean;
        resettable: boolean;
    }> {
        const orgId = request.organizationId;

        // #4432 — CANONICAL TYPE KEY. See {@link canonicalMetaType}. The
        // three-layer diagnostic must answer for ONE namespace, or `code` and
        // `overlay` can be read from two.
        request = canonicalizeMetaRequestType(request);
        // ── code layer: MetadataService.get + registry, BYPASSING overlay ──
        let code: unknown | null = null;
        let codeDegraded: { degraded: boolean; errors: string[] } | undefined;
        try {
            // ADR-0048 — package-scope the code layer so a same-name
            // collision resolves to the requested package's artifact.
            const fromService = await this.readItemFromMetadataService(
                request.type,
                request.name,
                request.packageId,
            );
            if (fromService.data !== undefined && fromService.data !== null) {
                // [#7556] The CODE layer of an object is D9.6's "owner's
                // declaration with its extenders folded on", so the
                // MetadataService copy is its base, not the layer itself.
                // `effective` is `overlay ?? code`, so an object with no
                // overlay row — the ordinary shape — is corrected by this
                // single fold on both layers the diagnostic reports.
                code = this.foldObjectExtendersFromRegistry(
                    request.type, request.name, fromService.data,
                );
            } else if (fromService.degraded) {
                // [#5840] Kept, not swallowed — acted on after the registry
                // fallback below, which may still produce a real code layer.
                codeDegraded = fromService;
            }
        } catch {
            // ignore
        }
        if (code === null) {
            // Prefer the artifact-only lookup so an overlay row hydrated
            // into the registry's plain key can't masquerade as the "code
            // default" layer; fall back to getItem for runtime-only items.
            let regItem = this.lookupArtifactItem(request.type, request.name, request.packageId)
                ?? this.engine.registry.getItem(request.type, request.name, request.packageId);
            if (regItem === undefined) {
                const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
                if (alt) regItem = this.engine.registry.getItem(alt, request.name, request.packageId);
            }
            if (regItem !== undefined) code = regItem;
        }

        // [#5840] The code half of the rule #5707 wrote for the overlay half,
        // eleven lines below. `code: null` is not a shrug — this method states
        // it positively ("no packaged/code-layer definition exists"), and the
        // response then DERIVES from it: `lockSource = code ?? overlay ?? {}`
        // feeds `resolveLockState`, so an item whose code layer declares
        // `_lock: 'full'` is rendered `editable: true, deletable: true` when
        // the read that would have found that lock simply failed. An
        // availability failure widening an affordance is precisely what
        // ADR-0110 D3 forbids, and the overlay half of this very method
        // already refuses to do it — the two halves were asymmetric only
        // because the loader failure was invisible on this side.
        //
        // Same narrow shape as the overlay half: the benign "nothing there"
        // still returns `code: null` normally (a clean miss is not degraded),
        // and a registry hit above is a real code layer, so this fires only
        // when the null would otherwise be an unfounded authorship claim.
        if (code === null && codeDegraded?.degraded) {
            this.throwMetadataServiceUnavailable(codeDegraded.errors);
        }

        // ── overlay layer: sys_metadata row (org-scoped wins, then env-wide) ──
        let overlay: unknown | null = null;
        let overlayScope: 'org' | 'env' | null = null;
        try {
            const findOverlay = async (oid: string | null) => {
                // ADR-0048 prefer-local: when a package is supplied, the row
                // owned by that package wins over a package-less first match.
                const lookup = async (t: string) => {
                    const base: Record<string, unknown> = {
                        type: t, name: request.name, state: 'active', organization_id: oid,
                    };
                    if (request.packageId) {
                        const scoped = await this.engine.findOne('sys_metadata', {
                            where: { ...base, package_id: request.packageId },
                        });
                        if (scoped) return scoped;
                        // ADR-0048 — fall back to the GLOBAL (package-less)
                        // overlay only, never another package's row.
                        return await this.engine.findOne('sys_metadata', {
                            where: { ...base, package_id: null },
                        });
                    }
                    return await this.engine.findOne('sys_metadata', { where: base });
                };
                let rec = await lookup(request.type);
                if (!rec) {
                    const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
                    if (alt) rec = await lookup(alt);
                }
                return rec;
            };
            if (orgId) {
                const rec = await findOverlay(orgId);
                if (rec) {
                    overlay = this.convertStoredItem(
                        String(rec.type ?? request.type),
                        typeof rec.metadata === 'string' ? JSON.parse(rec.metadata) : rec.metadata,
                    );
                    overlayScope = 'org';
                }
            }
            if (overlay === null) {
                const rec = await findOverlay(null);
                if (rec) {
                    overlay = this.convertStoredItem(
                        String(rec.type ?? request.type),
                        typeof rec.metadata === 'string' ? JSON.parse(rec.metadata) : rec.metadata,
                    );
                    overlayScope = 'env';
                }
            }
        } catch (error) {
            // [#5707] The same rule as the four overlay reads in
            // `getMetaItems` / `getMetaItem` (#5532), on the one overlay read
            // PR #5705 deliberately did not reach.
            //
            // Swallowing here does not answer 404 — it answers something this
            // method states positively in THREE fields at once: `overlay: null`
            // ("nothing was ever customised"), `overlayScope: null` ("no scope
            // holds a row"), and `effective = code` ("what runs today is the
            // packaged artifact, verbatim"). The whole point of the layered
            // read is to show an author what they changed; during an outage it
            // told them they had changed nothing, which is the #5532 error —
            // an availability failure reported as an authorship fact — landing
            // in the diff view instead of on a 404.
            //
            // The benign case is unchanged and is why this is not a bare
            // rethrow: an unprovisioned `sys_metadata` genuinely holds no
            // overlay row, so `overlay: null` / `effective = code` IS the truth
            // and first boot still renders the code layer.
            // See {@link rethrowUnlessMetadataStoreUnprovisioned}.
            this.rethrowUnlessMetadataStoreUnprovisioned(error);
        }

        // [#4513] `effective` is documented above as "what `getMetaItem` would
        // return", and the response's `_diagnostics` is computed from it — so it
        // carries the same audit-family governance that read now applies, or the
        // sentence stops being true the moment the overlay declares a writable
        // `created_at`. `code` and `overlay` are deliberately left RAW: they are
        // the diagnostic's whole point (what the package shipped vs what was
        // customised), and a Studio diff showing `code`'s declaration next to
        // `effective`'s governed value is the platform override made visible,
        // not a defect.
        // [#8027] …and `effective` is "what `getMetaItem` would return", so when
        // the overlay wins it is that read's BASE LAYER, resolved the same way:
        // D9.2's base-plus-extenders. Without this the single `?layers=true`
        // response contradicted itself — `code` carried the extension fields
        // (#7556 folds it) and `effective` did not, with the `overlay` layer
        // showing a customisation that explained none of the difference.
        //
        // ⛔ The fold lands on the EFFECTIVE base only. `overlay` stays the row
        // the tenant actually stored: a code-declared extension is not a tenant
        // customisation, and #7556 drew that boundary deliberately (the same
        // reason `governServedItem` is called here and never on `overlay`).
        const effectiveBase: unknown | null = overlay !== null
            ? this.foldObjectExtendersFromRegistry(request.type, request.name, overlay)
            : code;
        const effective: unknown | null = this.governServedObject(request.type, effectiveBase);

        const _diagnostics =
            effective !== null && effective !== undefined
                ? computeMetadataDiagnostics(request.type, effective)
                : undefined;

        // ADR-0010 — surface lock/provenance flags so the Studio editor
        // can render the correct affordances without a second round trip.
        const artifactBacked = this.isArtifactBacked(request.type, request.name);
        // Lock resolution: artifact wins over overlay, matching getEffectiveLock.
        const lockSource: any = code ?? overlay ?? {};
        const lockState = resolveLockState(lockSource, artifactBacked);

        return {
            type: request.type,
            name: request.name,
            code,
            overlay,
            overlayScope,
            effective,
            ...(_diagnostics ? { _diagnostics } : {}),
            lock: lockState.lock,
            ...(lockState.lockReason !== undefined ? { lockReason: lockState.lockReason } : {}),
            ...(lockState.lockSource !== undefined ? { lockSource: lockState.lockSource } : {}),
            ...(lockState.lockDocsUrl !== undefined ? { lockDocsUrl: lockState.lockDocsUrl } : {}),
            ...(lockState.provenance !== undefined ? { provenance: lockState.provenance } : {}),
            ...(lockState.packageId !== undefined ? { packageId: lockState.packageId } : {}),
            ...(lockState.packageVersion !== undefined ? { packageVersion: lockState.packageVersion } : {}),
            editable: lockState.editable,
            deletable: lockState.deletable,
            resettable: lockState.resettable,
        };
    }

    /**
     * ADR-0010 §3.6 / Phase 4.1 — read the metadata-protection audit log
     * for a single item. Returns the most-recent rows of
     * `sys_metadata_audit` for this (type, name) tuple, sorted newest
     * first. Refused (`denied`) and forced (`forced`) writes both appear
     * here — they never reach the `history` endpoint, which only tracks
     * successful body snapshots.
     *
     * The table is provisioned by `platform-objects` and is the
     * compliance surface for the lock-enforcement story. When the
     * environment has not yet provisioned the table (legacy install
     * prior to ADR-0010) the call returns `{ events: [] }` instead of
     * raising, keeping the Studio tab harmless.
     */
    async auditMetaItem(request: {
        type: string;
        name: string;
        organizationId?: string | null;
        limit?: number;
    }): Promise<{
        events: Array<{
            id: unknown;
            occurredAt: string;
            actor: string;
            source: string | null;
            operation: 'save' | 'publish' | 'rollback' | 'delete' | 'reset';
            outcome: 'allowed' | 'denied' | 'forced';
            code: string;
            lockState: MetadataLock | null;
            lockOverridden: boolean;
            requestId: string | null;
            note: string | null;
        }>;
    }> {
        const singular = PLURAL_TO_SINGULAR[request.type] ?? request.type;
        const limit = Math.min(
            Math.max(1, request.limit ?? 100),
            500,
        );
        try {
            // Org-scoped lookup: include rows for the specific org AND
            // env-wide (organization_id IS NULL) rows so the editor
            // sees both tenant overlays and env-level package writes.
            const where: Record<string, unknown> = {
                type: singular,
                name: request.name,
            };
            // `order`, NOT `direction`: the QueryAST sort shape is
            // `SortNodeSchema` = `{ field, order }`, and both drivers normalize
            // off `.order` with no fallback. `direction` is `IReportService`'s
            // vocabulary and is silently DROPPED here (the schema is not
            // `.strict()`), which left this query running ascending — the
            // OLDEST `limit` audit events, i.e. the beginning of an object's
            // life and never its recent changes (#4674). The `as any` is gone
            // for the same reason: `EngineQueryOptionsParsed` rejects the wrong key,
            // and erasing the type is what let it through.
            const rows = await this.engine.find('sys_metadata_audit', {
                where,
                orderBy: [{ field: 'occurred_at', order: 'desc' }],
                limit,
            });
            const events = (Array.isArray(rows) ? rows : []).map((r: any) => ({
                id: r.id,
                occurredAt:
                    typeof r.occurred_at === 'string'
                        ? r.occurred_at
                        : r.occurred_at instanceof Date
                            ? r.occurred_at.toISOString()
                            : String(r.occurred_at ?? ''),
                actor: String(r.actor ?? 'system'),
                source: r.source ?? null,
                operation: r.operation,
                outcome: r.outcome,
                code: String(r.code ?? ''),
                lockState: (r.lock_state ?? null) as MetadataLock | null,
                lockOverridden: Boolean(r.lock_overridden),
                requestId: r.request_id ?? null,
                note: r.note ?? null,
            }));
            return { events };
        } catch (err: any) {
            // Table not provisioned (legacy env) or driver doesn't
            // expose `find` — return empty rather than 500ing the tab.
            console.warn(
                `[Protocol] auditMetaItem read failed for ${request.type}/${request.name}: ${err?.message ?? err}`,
            );
            return { events: [] };
        }
    }

    async getUiView(request: { object: string, type: 'list' | 'form' }) {
        const schema = this.engine.registry.getObject(request.object);
        if (!schema) throw new Error(`Object ${request.object} not found`);

        const fields = schema.fields || {};
        const fieldKeys = Object.keys(fields);

        if (request.type === 'list') {
            // Intelligent Column Selection
            // 1. Always include 'name' or name-like fields
            // 2. Limit to 6 columns by default
            const priorityFields = ['name', 'title', 'label', 'subject', 'email', 'status', 'type', 'category', 'created_at'];
            
            let columns = fieldKeys.filter(k => priorityFields.includes(k));
            
            // If few priority fields, add others until 5
            if (columns.length < 5) {
                const remaining = fieldKeys.filter(k => !columns.includes(k) && k !== 'id' && !fields[k].hidden);
                columns = [...columns, ...remaining.slice(0, 5 - columns.length)];
            }
            
            // Sort columns by priority then alphabet or schema order
            // For now, just keep them roughly in order they appear in schema or priority list
            
            return {
                // [#5948] `object` sits on the CONTAINER, not on the view member.
                // `ViewSchema` declares it here ("Object this container binds to")
                // and `ListViewSchema` / `FormViewSchema` are `strictObject` that
                // never declared it — so the old member-level copy made the real
                // response fail its own declared schema with `unrecognized_keys`.
                // Nothing read it (measured: `useView` passes the body through as
                // `any`, objectui never calls `meta.getView`), so this is a
                // relocation, not a removal: readers move up one level.
                object: request.object,
                list: {
                    type: 'grid' as const,
                    label: schema.label || schema.name,
                    columns: columns.map(f => ({
                        field: f,
                        label: fields[f]?.label || f,
                        sortable: true
                    })),
                    sort: fields['created_at'] ? ([{ field: 'created_at', order: 'desc' }] as any) : undefined,
                    searchableFields: columns.slice(0, 3) // Make first few textual columns searchable
                }
            };
        } else {
             // Form View Generation
             // Simple single-section layout for now
             const formFields = fieldKeys
                .filter(k => k !== 'id' && k !== 'created_at' && k !== 'updated_at' && !fields[k].hidden)
                .map(f => ({
                    field: f,
                    label: fields[f]?.label,
                    required: fields[f]?.required,
                    readonly: fields[f]?.readonly,
                    type: fields[f]?.type,
                    // Default to 2 columns for most, 1 for textareas
                    colSpan: (fields[f]?.type === 'textarea' || fields[f]?.type === 'html') ? 2 : 1,
                    // `FormField.span` defaults to 'auto'; this view is hand-built
                    // rather than run through `FormFieldSchema.parse()`, so the
                    // default is spelled out to make the returned object a real
                    // parsed `View` (the same reason the section below states its
                    // own `collapsible` / `collapsed` / `columns` defaults). Was
                    // unnoticed while `FormField` resolved to `any` (#4171).
                    span: 'auto' as const
                }));

             return {
                // [#5948] Same relocation as the list branch above. The dropped
                // `label` is NOT relocated: it was `Edit ${…}` — a rendered UI
                // string, not metadata, and `FormViewSchema` deliberately has no
                // `label`. The caller already knows the object it asked for, so
                // the heading is the UI's to compose.
                object: request.object,
                form: {
                    type: 'simple' as const,
                    sections: [
                        {
                            label: 'General Information',
                            columns: 2 as const,
                            collapsible: false,
                            collapsed: false,
                            fields: formFields
                        }
                    ]
                }
            };
        }
    }

    /**
     * [#3770] Data-plane existence gate — the object MUST be in the schema
     * registry before any data entry point below touches storage.
     *
     * ## Why this exists
     *
     * The REST API-exposure gate (`enforceApiAccess`, ADR-0049 / #1889) skips
     * objects it cannot find in metadata, and justified that with "the data
     * path will 404 anyway". It would not. `engine.find` resolves an
     * UNREGISTERED name straight to a physical table name
     * (`resolveObjectName` → `StorageNameMapping.resolveTableName({ name })`),
     * so the request only 404'd as a *side effect* of the driver complaining
     * about a missing table (which the REST layer recognises by matching the
     * driver's error string) — and did not 404 at all when a table with that
     * name happened to exist: out-of-band DDL, a registration that failed
     * after `syncObjectSchema` had already run, a registration race. In that
     * window the exposure gate was silently skipped and the rows were served.
     *
     * The gate lives HERE, at the protocol ingress, for the same reason
     * `enforceApiAccess` does: this is the external API boundary. Internal
     * callers (hooks, flows, migrations, raw ObjectQL) talk to the engine
     * directly and are deliberately unaffected — `apiEnabled` and this check
     * both control automatic API exposure, not data access.
     *
     * ## Tiering — mirrors the #3545 decision recorded in `api-exposure.ts`
     *
     * - **Registry present, object absent → fail CLOSED** (404
     *   `OBJECT_NOT_FOUND`). The registry is authoritative for objects:
     *   `object` is `allowOrgOverride: false` (ADR-0005), so no per-org
     *   overlay can legitimately exist outside the process-wide registry, and
     *   both boot hydration (`loadMetaFromDb`) and runtime authoring
     *   (`applyObjectRegistryMutation`) register the schema before its table
     *   is reachable.
     *
     *   [#6190] That justification rested on a premise the WRITE path did not
     *   enforce until this note was written. `allowOrgOverride: false` closed
     *   the overlay tier only; `object` is also `allowRuntimeCreate: true`, and
     *   that tier stamped `organization_id` on the row like any other — so a
     *   Studio-authored `object` COULD legitimately exist as a per-org row,
     *   invisible to boot hydration, and this gate's fail-closed answer meant
     *   404 for every record in a table that still held the data. The premise
     *   is now true by enforcement: {@link orgScopedWriteRefusal} refuses an
     *   org-scoped write of any type the registry declares non-org-overridable,
     *   on both minting paths, so the only org-scoped `object` rows that can
     *   exist are residue written before that gate (#6190's ruling 2 = A:
     *   handled non-destructively — made audible by
     *   {@link reportUnhydratableOrgScopedRows} and disposed of operationally,
     *   NOT rewritten by a migration). Fail-closed stays the right answer for
     *   those: the registry entry is genuinely absent, and serving the table
     *   would serve one org's rows to every org. Pinned by
     *   `protocol.org-scoped-write-refused.test.ts`, which keeps `object` as
     *   its named specimen precisely so this paragraph cannot go stale
     *   silently again.
     * - **No registry on the engine at all → skip.** There is no source of
     *   truth to consult, so the check cannot answer; failing closed would
     *   break every registry-less host (edge/Lite embeddings, engine doubles)
     *   for no security gain. Warned once per process so a deployment in that
     *   state is observable rather than a silent blanket-allow — the lesson
     *   #3545 recorded for `loadObjectItems`.
     */
    private assertObjectRegistered(object: string): void {
        const registry: any = this.engine?.registry;
        if (!registry || typeof registry.getObject !== 'function') {
            if (!warnedNoRegistryForDataGate) {
                warnedNoRegistryForDataGate = true;
                console.warn(
                    '[Protocol] engine exposes no schema registry — the data-plane object-existence '
                    + 'gate (#3770) is INACTIVE for this process; unregistered object names reach the '
                    + 'driver as raw table names.',
                );
            }
            return;
        }
        if (registry.getObject(object)) {
            // [#7557] Registered is not the same as SERVING. A disabled package
            // keeps its objects registered on purpose — disable is reversible
            // and destroys no data, and the schema stays resolvable for the
            // machinery that needs it (the runtime authoring gate resolves its
            // object universe through `listItems('object')`, migrations and
            // cross-package references through `getObject`). What must stop is
            // the API serving its rows, which until now it did: nav and views
            // dropped on disable while `GET /data/<object>` still answered 200
            // with every row.
            //
            // Refused LOUDLY rather than by silent absence. The 404 status
            // matches the closest sibling in this codebase — `OBJECT_API_DISABLED`
            // for `enable.apiEnabled: false` (rest-server.ts) — so "this object
            // exists but is switched off" keeps ONE status across both switches,
            // and it keeps the data plane consistent with the metadata listing,
            // which now drops the object too (`getMetaItems`). The distinct code
            // is what makes it loud: a bare `OBJECT_NOT_FOUND` sends a caller —
            // an AI agent especially — hunting for a typo or re-creating an
            // object that is merely switched off, while this one names the cause
            // and therefore the fix (re-enable the package).
            //
            // Optional-called: registry doubles across the test suites implement
            // `isPackageDisabled` but not this, and a host whose registry cannot
            // answer must not have every read refused.
            if (typeof registry.isObjectPackageDisabled === 'function'
                && registry.isObjectPackageDisabled(object)) {
                const disabled: any = new Error(
                    `Object '${object}' belongs to a disabled package and is not being served. `
                    + 'Re-enable the package to restore access.',
                );
                disabled.code = 'OBJECT_PACKAGE_DISABLED';
                disabled.status = 404;
                disabled.object = object;
                throw disabled;
            }
            return;
        }
        const err: any = new Error(`Object '${object}' not found`);
        err.code = 'OBJECT_NOT_FOUND';
        err.status = 404;
        err.object = object;
        throw err;
    }

    /**
     * [#4134] The names a list query may legitimately use on `object`, or
     * `null` when nothing authoritative is available to check against.
     *
     * ONE resolution shared by all four read axes — filter (#4134), sort,
     * projection and expand (#4226) — because "does this field exist" is one
     * question and four answers to it is exactly the state these issues were
     * filed about. It is also the read half of a question the WRITE path
     * already answers loudly (`400 INVALID_FIELD` via `mapDataError` in
     * `@objectstack/rest`).
     *
     * Tiering mirrors {@link assertObjectRegistered}, one level down:
     *
     * - **Schema present with a field map → authoritative.** An unlisted name
     *   is a 400. The registry injects the audit/tenant/owner columns
     *   (`created_at`, `created_by`, `updated_at`, `updated_by`,
     *   `organization_id`, `owner_id`) into `fields`, so those are usable
     *   normally; `id` and the two audit timestamps are added defensively
     *   because they are primary-key/engine-assigned rather than declared, and
     *   `engine.find()` admits the same three unconditionally — a gate stricter
     *   than the engine it guards would reject queries that used to work.
     * - **No registry, or a schema with no field map → skip.** Nothing to check
     *   against (registry-less Lite/edge hosts, engine doubles, external
     *   datasources whose columns are not mirrored locally). The
     *   object-existence gate above already warns once when the registry itself
     *   is missing, so this stays quiet rather than warning twice per process.
     */
    private resolveQueryFields(object: string): { known: ReadonlySet<string>, declared: readonly string[], fields: any, schema: any } | null {
        const schema: any = this.engine?.registry?.getObject?.(object);
        const declared = schema?.fields;
        if (!declared || typeof declared !== 'object') return null;
        // A legacy ARRAY field map is not checkable: `Object.keys` on it yields
        // '0', '1', '2' …, so every gate below would reject every real field
        // name. Skipping is the same call the no-field-map case makes — there
        // is nothing here to answer "does this field exist" with.
        if (Array.isArray(declared)) return null;
        const fieldNames = Object.keys(declared);
        if (fieldNames.length === 0) return null;
        const known = new Set(fieldNames);
        known.add('id');
        known.add('created_at');
        known.add('updated_at');
        return { known, declared: fieldNames, fields: declared, schema };
    }

    /**
     * [#4134] Read-path unknown-field gate for the implicit filters `findData`
     * derives from leftover query parameters.
     *
     * Rejects with the SAME envelope the write path produces for the same
     * mistake — `400 INVALID_FIELD` + `field` + `object` — so a name that
     * cannot be written cannot be silently filtered on either. Dotted paths are
     * judged on their head segment only (`owner_id.name`), matching how
     * `engine.find()` validates projections.
     */
    private assertQueryParamsAreFields(object: string, params: readonly string[]): void {
        const gate = this.resolveQueryFields(object);
        if (!gate) return;
        const unknown = params.filter((p) => !gate.known.has(String(p).split('.')[0]));
        if (unknown.length === 0) return;
        const first = unknown[0];
        const err: any = new Error(
            `Unknown field '${first}' on object '${object}'`
            + (unknown.length > 1 ? ` (also: ${unknown.slice(1).join(', ')})` : '')
            + '. Query parameters that are not reserved are read as field filters, so an '
            + 'unknown name can only match zero records.'
            + suggestQueryParam(first, gate.declared),
        );
        err.code = 'INVALID_FIELD';
        err.status = 400;
        err.field = first;
        err.fields = unknown;
        err.object = object;
        throw err;
    }

    /**
     * [#7534] The same read-path gate, on the EXPLICIT filter axes — the `where`
     * object, the `$filter` string and the filter AST.
     *
     * #4134 closed this defect for the filters `findData` DERIVES from leftover
     * query parameters, and {@link resolveQueryFields} was written for "ONE
     * resolution shared by all four read axes". The explicit axes never called
     * it, so one endpoint family answered ONE mistake two ways, chosen by which
     * door the caller used:
     *
     * ```
     * GET  /data/showcase_invoice?not_a_field=x            -> 400 INVALID_FIELD
     * POST /data/showcase_invoice/query {where:{not_a_field:'x'}} -> 200 {records:[],total:0}
     * ```
     *
     * The losing answer is the exact failure #4134 was filed about: an unknown
     * name lowers into a field-equality predicate that can only match zero rows,
     * so the response is indistinguishable from "no data" — and it cost a real
     * investigation once already, where an empty list was read as an RLS /
     * org-scope visibility bug rather than a typo.
     *
     * ONE call covers all three doors because they are not three code paths:
     * `where` / `filter` / `filters` / `$filter` resolve to one slot at the
     * #3795 fold, and a filter AST is lowered by `parseFilterAST` — the single
     * sink for that sugar — before this runs. So this gate reads the same
     * `FilterCondition` the driver will read, which is what keeps "the field the
     * gate saw" and "the column that reached the driver" from drifting apart.
     *
     * # Ordering: after the #4134 param gate, before the #4164 merge
     *
     * Deliberately NOT reordered relative to its siblings. Running it AFTER
     * {@link assertQueryParamsAreFields} keeps that gate's verdict first when a
     * request gets both wrong, so no existing precedence moves; running it
     * BEFORE the #4164 implicit/explicit merge is what lets it name the axis the
     * caller actually used, since after the merge the two are one `$and` and the
     * distinction is gone.
     *
     * # What it does NOT do
     *
     * The `param` in the message is the caller's own wire spelling (#4226's
     * discipline — telling someone who sent `?$filter=…` that "'where' is
     * invalid" names a parameter absent from their request). The message states
     * the zero-row consequence rather than just the bad name, because that is
     * the part a caller cannot infer from a `200`.
     *
     * Value shapes are NOT judged here: a wrong-typed or unrunnable filter is
     * `INVALID_FILTER`'s job (#4121 / #4181), already answered upstream in this
     * same block. This gate answers questions about the NAME, with exactly the
     * envelope the write path and the bare-key door already give it.
     *
     * [#8296] It answers TWO of them now — "does this field exist" and, second,
     * "does this field's TYPE materialise a column to filter on". A `formula`
     * field is known, undotted and unfilterable: it cleared this gate precisely
     * BECAUSE the object declares it, reached a driver that has no column for
     * it, and answered 200 with zero rows in BOTH directions. That was the last
     * axis in this family still fail-open — SORT refuses the same field
     * (#6994/#7095) and SEARCH refuses it (#6674) — and it is the shape the
     * standing ruling of 2026-08-12 names: a declaration the platform cannot
     * honour is refused at the latest checkpoint that can see the whole
     * picture, naming the offending key path, never answered 200.
     *
     * SCOPE: this is an INGRESS gate, so it covers what reaches {@link
     * findData}. The half it cannot reach — a caller handing a `where` straight
     * to `engine.find` / `findOne` / `count` / `aggregate` / `update` /
     * `delete`, which is how a saved report's `query.filter` travels
     * (`plugin-reports` forwards it verbatim) — is closed at the engine's own
     * filter seam by `assertFilterIsMaterializable` (`@objectstack/objectql`,
     * `filter-comparand-shape.ts`), with the same `400 INVALID_FIELD` and the
     * same remedy sentence. Same two-door shape, and same reason, as the sort
     * axis' #7095.
     */
    private assertFilterFieldsExist(object: string, where: unknown, param: string): void {
        if (!where || typeof where !== 'object') return;
        const names = collectFilterFieldKeys(where);
        if (names.length === 0) return;
        const gate = this.resolveQueryFields(object);
        if (!gate) return;
        // Head segment only, exactly as the bare-key door judges `owner_id.name`.
        const unknown = names.filter((f) => !gate.known.has(f.split('.')[0]));
        if (unknown.length > 0) {
            const first = unknown[0];
            const err: any = new Error(
                `Query parameter '${param}' filters on '${first}', which is not a field on object `
                + `'${object}'`
                + (unknown.length > 1 ? ` (also: ${unknown.slice(1).join(', ')})` : '')
                + '. A filter on a field that does not exist can only match zero records, so the '
                + 'query was refused instead of answered with an empty list.'
                + suggestFieldName(first, gate.declared),
            );
            err.code = 'INVALID_FIELD';
            err.status = 400;
            err.field = first;
            err.fields = unknown;
            err.object = object;
            err.param = param;
            throw err;
        }

        // [#8296] The SECOND verdict on this axis: a name that is a REAL field
        // of this object and still cannot be filtered on, because its TYPE
        // materialises no column. It is the FILTER axis finally growing the
        // verdict its two neighbours already have — {@link
        // assertSortFieldsExist} splits `unknown` from unmaterializable
        // (#6994) and {@link assertSearchFieldsAreSearchable} splits `unknown`
        // from `virtual` (#6674) — and it was the last axis on which a
        // declaration the platform cannot honour still answered 200.
        //
        // Measured on a real `ObjectQL` + this protocol, base cb43296ef
        // (`is_open` a `formula` over the stored `status` column):
        //
        // ```
        // where { is_open: true }          -> 0 rows, NO ERROR
        // where { is_open: false }         -> 0 rows, NO ERROR
        // CONTROL where { status: 'open' } -> 4 rows
        // CONTROL where { subtask_total: 5 } -> 1 row   (`summary` HAS a column)
        // ```
        //
        // BOTH directions are wrong and the `false` one is the dangerous one:
        // the same predicate against a STORED boolean returns every row, so a
        // filter meaning "not yet done" silently becomes "no records at all".
        // The response is indistinguishable from an empty table, and the
        // formula READS correctly in that very same response (`applyFormulaPlan`
        // hydrates it), so the field is visibly populated and simultaneously
        // unfilterable.
        //
        // Judged by the same `@objectstack/spec/data` predicate the SEARCH axis
        // uses ({@link isVirtualSearchField} / `SEARCH_VIRTUAL_TYPES`) rather
        // than a list minted here, so this gate and the drivers cannot disagree
        // about which types have a column. `summary` and `autonumber` are NOT
        // in it and must not be: both get real stored columns and filter
        // correctly — a gate widened to the spec's `COMPUTED_VALUE_TYPES` (the
        // WRITE contract) would refuse two working types.
        //
        // PRECEDENCE — `unknown` first, then this, mirroring the sort axis'
        // `unknown` > `dotted` > unmaterializable: identity errors before type
        // errors. DOTTED names are deliberately NOT judged here: a dotted
        // filter path has no verdict on this axis at all (its head being a real
        // field is what carries it through the check above), and inventing one
        // for the formula-headed case alone would answer two spellings of one
        // unjudged shape differently.
        const virtual = names.filter((f) => !f.includes('.') && isVirtualSearchField(gate.fields[f]));
        if (virtual.length === 0) return;
        const virtualFirst = virtual[0];
        const virtualType = String(gate.fields[virtualFirst]?.type ?? 'formula');
        const err: any = new Error(
            `Query parameter '${param}' filters on '${virtualFirst}', a virtual '${virtualType}' `
            + `field on object '${object}'`
            + (virtual.length > 1 ? ` (also: ${virtual.slice(1).join(', ')})` : '')
            + '. Its value is computed on read and never stored, so no driver materializes a '
            + 'column to filter on: the predicate reaches the driver, matches nothing, and the '
            + 'query answers an empty list under a 200 — in BOTH directions, so a false test '
            + 'returns no records where the same test against a stored boolean returns every '
            + 'record.'
            // Deliberately the same remedy, in the same words, as the SORT
            // axis' formula refusal (#6994) and #6673's SEARCH-axis
            // correction, with only the verb changed to name this axis. One
            // vocabulary across the doors: an author refused on two axes must
            // not be sent two different ways.
            + ` Denormalise the value onto '${object}' (a stored field, written when the source`
            + ' changes) and filter that.',
        );
        err.code = 'INVALID_FIELD';
        err.status = 400;
        err.field = virtualFirst;
        err.fields = virtual;
        err.object = object;
        err.param = param;
        throw err;
    }

    /**
     * [#4226] SORT axis. A sort naming a field the object does not have is
     * refused (`400 INVALID_SORT`) instead of being dropped on the floor.
     *
     * The stakes sit between the other two axes: the row SET is unchanged, so
     * this is not #4181's "returned everything" — but `sort` + `top` is how a
     * caller asks for "the latest N", and a dropped sort makes that an
     * arbitrary N that no amount of inspecting the response can reveal.
     * `SqlDriver` has a deliberate backstop that drops an unknown ORDER BY
     * column and returns the rows unordered (objectstack#3821 — rows matter
     * more than their order); that backstop is for a *driver* that has already
     * been handed the query. Refusing HERE, before it is handed over, is what
     * keeps it from doubling as a silent tolerance at the API boundary.
     *
     * The colon form gets its own hint: `?sort=title:desc` is the spelling
     * `GET /data/:object/export` accepts, and a caller who moved between the
     * two routes deserves better than "no such field 'title:desc'".
     *
     * [#4256] A dotted path (`?sort=account.company_name`) is refused on the
     * same terms — the last sort shape that still degraded silently after
     * #4226. Its head segment being a real field is what carried it past the
     * unknown-field check while no driver could then order by it: `SqlDriver`
     * hands the path to Knex, which renders `"account"."company_name"` against
     * a table that was never joined, and the #3821 unknown-column backstop
     * retries WITHOUT the sort; Mongo and the memory driver resolve the path
     * against the row itself, where a foreign key is a scalar id, so every
     * value is missing and the ordering is a no-op. Unknown heads keep the
     * typo-shaped rejection above (reported first, like the expand gate's
     * `unknown` > `not-a-reference` precedence); a dotted path on a real head
     * gets a message that says which relationship it tried to cross and
     * prescribes what `query-syntax.mdx` has prescribed since #4240:
     * denormalise the value onto the queried object and sort by that.
     *
     * [#6924] WHAT to denormalise onto was wrong, and this overturns #4256's
     * own recorded wording. That issue chose "a formula or rollup field that
     * copies it into a real column" — a prescription the platform cannot
     * deliver, so the refusal handed the author a dead end at the exact moment
     * they asked for help. Measured on a REAL `SqlDriver` (better-sqlite3) and
     * on `InMemoryDriver`, with a `formula` field named directly — which at the
     * time was NOT dotted and NOT unknown, so this gate let it through
     * (#6994 closes that, third verdict below):
     *
     * ```
     * control  orderBy title asc    -> A B C D E      (a real column sorts)
     * baseline no sort              -> C A E B D      (insertion order)
     * orderBy  <formula field> asc  -> C A E B D  200 (insertion order)
     * orderBy  <formula field> desc -> C A E B D  200 (direction-blind)
     * ```
     *
     * No column exists to order by (`SqlDriver.createColumn` returns early for
     * `formula`; sqlite answers `no such column`), the #3821 unknown-column
     * backstop retries WITHOUT the sort, and the response is 200 with every
     * row present in an arbitrary order — the very failure #4226/#4256 exist
     * to stop. Following the old hint therefore landed the author back inside
     * the defect they had just been refused for.
     *
     * `rollup`/`summary` was the other half of that wording and is NOT broken
     * the same way — it does get a real, maintained column (`table.float`;
     * measured: `orderBy <summary> desc` -> E D C B A over values 5 4 3 2 1).
     * It is dropped from the hint because it cannot do THIS job: a rollup
     * aggregates CHILD records (count/sum/min/max/avg), so it cannot carry a
     * looked-up parent's column (`account.company_name`) onto this object.
     * Wrong tool, not a broken one — naming it here still sends the author
     * somewhere that cannot work.
     *
     * "Stored" is #6673's vocabulary for the same correction on the SEARCH
     * axis (`validate-searchable-fields.ts`, "a stored text field"); the two
     * axes deliberately say the same word.
     *
     * [#6994] The non-dotted half of that same defect, refused as the THIRD
     * verdict below. It is the SORT axis finally growing the verdict its two
     * neighbours in this class already have: `assertSearchFieldsExist` splits
     * `unknown` from `unsearchable` (a known field whose TYPE search cannot
     * scan) and `assertExpandFieldsExist` splits `unknown` from `notRelations`
     * (a known field whose TYPE cannot be expanded). Sort had only `unknown`
     * and `dotted`, so "known field, wrong type for this axis" was the one
     * member of the family with no door — which is why a `formula` field
     * reached a driver that has no column for it.
     *
     * SCOPE: this is an INGRESS gate, so it covers what reaches {@link findData}
     * — the REST list route, `POST /data/:object/query`, the export route (which
     * funnels its `$orderby` through here) and the RPC dispatcher.
     *
     * [#7095] It is no longer the ONLY door for this verdict, and the half it
     * cannot reach is now closed rather than merely noted. A caller reaching
     * `engine.find()` / `engine.findOne()` directly — hooks, flows, reports,
     * expand sub-reads — used to get the silent drop;
     * `assertOrderByIsMaterializable` (`@objectstack/objectql`, `engine.ts`)
     * refuses it there with the SAME `400 INVALID_SORT` and the same remedy
     * sentence this gate emits, ruled on #7095 (an ORDER BY the engine cannot
     * apply is a refusal with guidance prose, never a silent drop). What made
     * leaving it at ingress untenable is that the direct path is AUTHOR-
     * reachable, not merely internal: a saved report's `query.orderBy` is
     * forwarded verbatim into `engine.find` (`plugin-reports`), and it never
     * passes through here.
     *
     * ONE EDGE, measured and deliberately left: a nested `expand` sort is also
     * forwarded into the expansion sub-read (`expandRelatedRecords`), and the
     * engine door does fire there — but that sub-read sits inside a pre-existing
     * graceful-degradation `catch` that swallows EVERY expand failure and
     * retains the raw foreign keys. So that one path improves from silent to
     * OBSERVABLE (a warning carrying the field and the remedy) rather than
     * becoming a refusal. Reversing that backstop is the #3821-family swallow —
     * a separate decision on all expand failure modes, not a rider on this one.
     *
     * This gate is UNCHANGED and still the first door: it keeps the `param` name
     * in the message (which the engine cannot know) and the `unknown` >
     * `dotted` > unmaterializable precedence. The engine door deliberately
     * judges only the third verdict — see its docblock for why it does not
     * inherit the other two.
     */
    private assertSortFieldsExist(object: string, orderBy: ReadonlyArray<{ field: string }>, param: string): void {
        if (orderBy.length === 0) return;
        const gate = this.resolveQueryFields(object);
        if (!gate) return;
        const names = orderBy.map((s) => String(s.field));
        const unknown = names.filter((f) => !gate.known.has(f.split('.')[0]));
        if (unknown.length > 0) {
            const first = unknown[0];
            const hint = first.includes(':')
                ? ` The list route spells a direction with a space or a leading '-'`
                  + ` ('sort=${first.split(':')[0]} desc', 'sort=-${first.split(':')[0]}');`
                  + " 'field:direction' is the export route's spelling."
                : suggestFieldName(first, gate.declared);
            throw invalidSortError(
                param,
                `sorts by '${first}', which is not a field on object '${object}'`
                + (unknown.length > 1 ? ` (also: ${unknown.slice(1).join(', ')})` : ''),
                { hint, extra: { field: first, fields: unknown, object } },
            );
        }
        const dotted = names.filter((f) => f.includes('.'));
        if (dotted.length > 0) {
            const first = dotted[0];
            const head = first.split('.')[0];
            const headDef: any = gate.fields[head];
            const crossesRelation = headDef != null && REFERENCE_VALUE_TYPES.has(headDef.type);
            throw invalidSortError(
                param,
                (crossesRelation
                    ? `sorts by '${first}', which follows the relationship '${head}' into another object — `
                      + `sort reaches only columns of '${object}' itself`
                    : `sorts by '${first}', a dotted path — sort reaches only whole columns of '${object}', `
                      + "not values inside them")
                + (dotted.length > 1 ? ` (also: ${dotted.slice(1).join(', ')})` : ''),
                {
                    hint: ` Denormalise the value onto '${object}' (a stored field, written when the`
                        + ' source changes) and sort by that. Not a formula field: it is virtual,'
                        + ' no driver materialises a column for one, and ORDER BY on it is silently'
                        + ' dropped.',
                    extra: { field: first, fields: dotted, object },
                },
            );
        }

        // [#6994] The third verdict on this axis: a name that is a REAL,
        // non-dotted field of this object and still cannot be ordered by,
        // because its TYPE materialises no column ({@link
        // UNMATERIALIZED_SORT_TYPES} — `formula`, today the whole set).
        //
        // This is the shape the doc comment above already describes and this
        // gate already let through: being in `gate.known` is what carried it
        // past the unknown check, being undotted is what carried it past the
        // check just above. Re-measured on this branch's base (real `SqlDriver`
        // over better-sqlite3, real `ObjectQL`, real protocol on top):
        //
        // ```
        // FORMULA  orderBy sort_key asc  -> ["C","A","E","B","D"]  5 rows, 200
        //   its sort_key values          -> ["C","A","E","B","D"]
        // FORMULA  orderBy sort_key desc -> ["C","A","E","B","D"]  asc === desc
        // RAW SQL  order by sort_key     -> sqlite: no such column: sort_key
        // ```
        //
        // The response literally carries the values it was asked to sort by,
        // out of order, under a 200 — so the answer contradicts the request in
        // plain view and still reports success.
        //
        // PRECEDENCE — `unknown` > `dotted` > this. It is last for the same
        // reason the expand gate reports `unknown` before `not-a-reference`:
        // identity errors first, then shape, then type. The two above are
        // therefore unchanged verdict-for-verdict, and a dotted path whose head
        // is a formula field keeps the dotted answer (it is wrong about the
        // shape too, and the shape is what the caller wrote).
        const unmaterialized = names.filter(
            (f) => UNMATERIALIZED_SORT_TYPES.has(String(gate.fields[f]?.type ?? '')),
        );
        if (unmaterialized.length === 0) return;
        const virtualFirst = unmaterialized[0];
        const virtualType = String(gate.fields[virtualFirst]?.type);
        throw invalidSortError(
            param,
            `sorts by '${virtualFirst}', a ${virtualType} field on '${object}' — a ${virtualType} `
            + 'value is computed on read, so no driver materialises a column to order by'
            + (unmaterialized.length > 1 ? ` (also: ${unmaterialized.slice(1).join(', ')})` : ''),
            {
                // Deliberately the same remedy, in the same words, as the
                // dotted refusal above and as #6673's SEARCH-axis correction:
                // one vocabulary across the doors, so an author refused twice
                // is not sent two different ways.
                hint: ` Denormalise the value onto '${object}' (a stored field, written when the`
                    + ' source changes) and sort by that. A formula field is virtual: with no'
                    + ' column behind it the ORDER BY reaches the driver, finds nothing, and is'
                    + ' dropped — the arbitrary order this refusal replaces.',
                extra: { field: virtualFirst, fields: unmaterialized, object },
            },
        );
    }

    /**
     * [#4226] PROJECTION axis. A `select`/`fields` naming a column the object
     * does not have is refused (`400 INVALID_FIELD`).
     *
     * This axis fails in the direction nobody expects. `engine.find()` drops
     * unknown columns (deliberate `SELECT *` / OData tolerance) and then falls
     * back to `*` when that leaves the projection empty (so the driver is not
     * handed an empty SELECT list) — which compose into: `?select=<typo>` asked
     * for ONE column and got EVERY column. A parameter whose entire purpose is
     * to return less had "return more" as its failure mode, pointing away from
     * both FLS and data minimisation.
     *
     * Rejecting the partially-unknown case too (`?select=title,no_such`) is the
     * #3948 reading — an unapplied projection must not look like a satisfied
     * one — and the same rule the filter axis already lives by. The tolerant
     * reading (align with Salesforce/OData leniency) would have to explain why
     * `?status=<typo>` is a 400 and `?select=<typo>` is not, on one endpoint,
     * about the same field map.
     *
     * The engine's tolerance on THIS axis is untouched: it guards INTERNAL
     * callers (hooks, flows, expand sub-reads, registry-less hosts) that never
     * pass through this ingress, exactly like the object-existence gate above.
     * An unknown projection name is dropped and the projection falls back to
     * `*`, so the engine still over-returns rather than throwing.
     *
     * [#7095] That tolerance is PER-AXIS, and this docblock used to be read as
     * a statement about the engine in general — it is not one any more, so the
     * limit is written here rather than left to be inferred. On the SORT axis
     * the engine now REFUSES an ORDER BY it cannot materialise
     * (`assertOrderByIsMaterializable`, `@objectstack/objectql`), because the
     * two axes fail differently: a dropped projection name returns MORE than
     * asked (every column, inspectable in the response), while a dropped sort
     * returns the right rows in an order the response cannot be distinguished
     * from a satisfied one — and with `limit`, an arbitrary page of them. The
     * #7095 sweep found no in-tree internal caller relying on the sort drop, so
     * narrowing it cost no caller anything; nothing equivalent has been measured
     * for the projection axis, and this sentence is not a licence to assume it.
     *
     * [#7532] The DOTTED leg, which this gate used to pass on its head
     * segment. `f.split('.')[0]` is what let `fields=['name','account.name']`
     * through: `account` IS a field, so the entry cleared the unknown-name
     * check above and reached the driver as a projection column. Measured at
     * that commit on a REAL `SqlDriver` (better-sqlite3), against the same
     * object the card reports:
     *
     * ```
     * no projection              -> account amount created_at id name status updated_at
     * fields ['name']            -> name                          (a plain name narrows)
     * fields ['name','account.name'] -> account amount created_at id name status updated_at
     * fields ['account.name']    -> account amount created_at id name status updated_at
     * ```
     *
     * The dotted rows are BYTE-IDENTICAL to no projection at all — the exact
     * "asked for less, received more" this axis' first paragraph describes,
     * reached by a different route. Knex renders `"account"."name"` against a
     * table that was never joined, sqlite answers `no such column`, and
     * `SqlDriver`'s #3821 recovery ladder retries `select('*')` because rows
     * matter more than the projection. That ladder is a DRIVER-side tolerance
     * for internal callers and is deliberately left alone here (filed
     * separately as defence-in-depth); refusing at this ingress is what stops a
     * request from reaching it carrying a projection no driver can apply.
     *
     * It also settles the card's second complaint: an unknown PLAIN column was
     * a 400 while an unknown DOTTED one was a 200 with every field, so one
     * mistake got opposite verdicts on one endpoint depending on spelling.
     *
     * The governing precedent is #5918 on the analytics MEASURES axis, which
     * faced this exact shape and ruled the same way: refuse the dotted member
     * loudly, naming the caller's original spelling, *because there is no
     * correct answer to converge on*. That is the distinction from #5739, where
     * refusing would have rejected queries that already compiled correctly.
     * Here — as there — nothing resolved these paths, so both the typo
     * (`titel.name`) and the genuine traversal intent (`account.name`) eat this
     * 400: the two are not separable at this door, and the alternative is the
     * over-return above.
     *
     * NOT a removal of a working feature — nothing resolved these paths. The
     * spec's `fields` description, `query-syntax.mdx`, `data/query.mdx` and the
     * `query.joins` / nested-select retirement prescriptions all still offer a
     * dotted `fields` path as the way to read one related column; every one of
     * them describes behaviour no driver implements. Aligning that prose with
     * `expand` is spec/docs surface with its own blast radius and is called out
     * on the PR rather than smuggled in here.
     *
     * [#4196] It also owns the projection's SHAPE, which is a different
     * question from its names and is answered first — see below.
     */
    private assertProjectionFieldsExist(object: string, fields: unknown, param: string): void {
        if (!Array.isArray(fields) || fields.length === 0) return;
        // [#4196] A non-string entry is the retired nested-select object form
        // (`{ field, fields, alias }`). It is checked BEFORE the field map,
        // because it is wrong about the shape rather than about this object —
        // and a registry-less host, which returns no gate below, would
        // otherwise let it through to a driver that cannot read it. Until now
        // it reached `.map(String)` and was refused as the unknown field
        // `"[object Object]"`: a 400 naming something the caller never wrote.
        const badShape = fields.findIndex((f) => typeof f !== 'string');
        if (badShape !== -1) {
            const entry = fields[badShape];
            // Only the shape that used to be legal earns the retirement clause.
            const retiredForm = typeof entry === 'object' && entry !== null && !Array.isArray(entry);
            const err: any = new Error(
                `'${param}' entry #${badShape + 1} on object '${object}' is not a field name.`
                + (retiredForm
                    ? ' The nested-select object form `{ field, fields, alias }` was removed in '
                      + '@objectstack/spec 17 (#4196) — no engine or driver ever read it.'
                    : '')
                // [#7532] The dotted-path half of this prescription is GONE.
                // It pointed at a spelling this same gate now refuses — and
                // before that refusal it pointed at a spelling no driver
                // resolves, which answered with every field. Naming it here
                // sent the author from one refusal straight into the widening
                // defect, the same dead end #6924 removed from the SORT axis'
                // hint. `expand` is the one door for related data on this axis.
                + " Select related records with `expand` (`expand=owner`, or `{ expand: { owner: "
                + "{ object: 'user', fields: ['name'] } } }` to choose its columns).",
            );
            err.code = 'INVALID_FIELD';
            err.status = 400;
            err.object = object;
            err.param = param;
            throw err;
        }
        const gate = this.resolveQueryFields(object);
        if (!gate) return;
        const names = fields as string[];
        const unknown = names.filter((f) => !gate.known.has(f.split('.')[0]));
        if (unknown.length > 0) {
            const first = unknown[0];
            const unknownErr: any = new Error(
                `Unknown field '${first}' on object '${object}'`
                + (unknown.length > 1 ? ` (also: ${unknown.slice(1).join(', ')})` : '')
                + `. '${param}' chooses which fields to return; dropping an unknown one silently `
                + 'answered a NARROWER projection with a WIDER one — a projection naming no known '
                + 'field fell all the way back to every field.'
                + suggestFieldName(first, gate.declared),
            );
            unknownErr.code = 'INVALID_FIELD';
            unknownErr.status = 400;
            unknownErr.field = first;
            unknownErr.fields = unknown;
            unknownErr.object = object;
            unknownErr.param = param;
            throw unknownErr;
        }
        // [#7532] The DOTTED verdict — the leg the head-segment check above
        // does not cover, and the one that made this axis fail in the very
        // direction its own docblock warns about.
        //
        // Ordered `unknown` > `dotted`, the same precedence
        // {@link assertSortFieldsExist} applies, so the two axes agree about
        // which complaint a caller hears first when an entry is both.
        //
        // It sits AFTER the `gate` early-return for the same reason the sort
        // axis' dotted verdict does: the relation-vs-not split below reads
        // `gate.fields`, and a registry-less host has no field map to read.
        const dotted = names.filter((f) => f.includes('.'));
        if (dotted.length === 0) return;
        const first = dotted[0];
        const head = first.split('.')[0];
        const headDef: any = gate.fields[head];
        const crossesRelation = headDef != null && REFERENCE_VALUE_TYPES.has(headDef.type);
        const dottedErr: any = new Error(
            (crossesRelation
                ? `Field '${first}' on object '${object}' follows the relationship '${head}' into `
                  + `another object — '${param}' reaches only columns of '${object}' itself`
                : `Field '${first}' on object '${object}' is a dotted path — '${param}' reaches only `
                  + `whole columns of '${object}', not values inside them`)
            + (dotted.length > 1 ? ` (also: ${dotted.slice(1).join(', ')})` : '')
            + '. No driver resolves it: the path reaches the driver as a column name, matches no '
            + 'column, and the projection falls back to EVERY field — a narrower request answered '
            + 'with a wider response, which is the same failure the unknown-name refusal above '
            + 'exists to stop.'
            + (crossesRelation
                ? ` Read the related record with 'expand' (\`expand=${head}\`, or `
                  + `\`{ expand: { ${head}: { object: '<target>', fields: ['<column>'] } } }\` to `
                  + `choose its columns), or denormalise the value onto '${object}' (a stored `
                  + 'field, written when the source changes) and name that.'
                : ` Name the whole column ('${head}') and read into its value in the caller.`),
        );
        dottedErr.code = 'INVALID_FIELD';
        dottedErr.status = 400;
        dottedErr.field = first;
        dottedErr.fields = dotted;
        dottedErr.object = object;
        dottedErr.param = param;
        throw dottedErr;
    }

    /**
     * [#4226] EXPAND axis. An `expand`/`populate` naming something the engine
     * cannot expand is refused (`400 INVALID_FIELD`).
     *
     * The lightest of the three — neither the row set nor the returned columns
     * change, the relation simply is not there — but the response gives the
     * caller nothing to distinguish "this relation does not exist" from "every
     * row happens to have a null foreign key", and the client then renders raw
     * ids where names belong.
     *
     * Two rejections, one code, different messages, because the fixes differ:
     * a name that is no field at all is a typo, while a name that IS a field
     * but holds no reference (`?expand=title`) is a misunderstanding of what
     * expansion does. {@link REFERENCE_VALUE_TYPES} is the spec's own list of
     * types whose value "points at another record … the related record object
     * in expanded form" — the same set `engine.expandRelatedRecords` resolves,
     * so this gate cannot drift from what expansion actually delivers. The
     * "does it name a target" half reads `referenceTargetOf` for the same
     * reason: the engine resolves the target through that one function, so a
     * type whose target is implied (`user` ⇒ `sys_user`) can never be refused
     * here and expanded there.
     */
    private assertExpandTargetsExist(object: string, names: readonly string[]): void {
        if (names.length === 0) return;
        const gate = this.resolveQueryFields(object);
        if (!gate) return;
        const unknown: string[] = [];
        const notRelations: string[] = [];
        const targetless: string[] = [];
        for (const raw of names) {
            const name = String(raw);
            const def: any = gate.fields[name.split('.')[0]];
            if (!def) { unknown.push(name); continue; }
            if (!REFERENCE_VALUE_TYPES.has(def.type)) { notRelations.push(name); continue; }
            // A reference-typed field that names no target object leaves
            // `expandRelatedRecords` nothing to batch-load. That is an
            // authoring bug on the OBJECT, not on the request, and saying "not
            // a relationship" about a declared lookup would send the caller
            // looking in the wrong place.
            //
            // `referenceTargetOf` — not a raw `def.reference` read — because
            // some reference types carry their target in the TYPE (`user` ⇒
            // `sys_user`) rather than in an author-written `reference`. The
            // engine's expand loop resolves the target through the same
            // function, which is what keeps this gate from refusing a field
            // expansion would have delivered (cloud#983).
            if (!referenceTargetOf(def)) targetless.push(name);
        }
        const [offenders, reason] =
            unknown.length > 0 ? [unknown, 'unknown' as const]
            : notRelations.length > 0 ? [notRelations, 'not-a-reference' as const]
            : [targetless, 'targetless' as const];
        if (offenders.length === 0) return;
        const first = offenders[0];
        const err: any = new Error(
            (reason === 'unknown'
                ? `Unknown field '${first}' on object '${object}'`
                : reason === 'not-a-reference'
                    ? `Field '${first}' on object '${object}' is not a relationship`
                    : `Field '${first}' on object '${object}' declares no target object`)
            + (offenders.length > 1 ? ` (also: ${offenders.slice(1).join(', ')})` : '')
            + '. \'expand\' resolves a reference field into the related record, so '
            + (reason === 'unknown'
                ? 'a name the object does not declare can never be expanded.'
                : reason === 'not-a-reference'
                    ? `only ${[...REFERENCE_VALUE_TYPES].join(' / ')} fields can be expanded.`
                    : "the field's `reference` must name the object it points at.")
            + (reason === 'unknown' ? suggestFieldName(first, gate.declared) : ''),
        );
        err.code = 'INVALID_FIELD';
        err.status = 400;
        err.field = first;
        err.fields = offenders;
        err.object = object;
        err.param = 'expand';
        throw err;
    }

    /**
     * [#4254] SEARCH-FIELDS axis. A `searchFields` override naming something
     * `search` cannot scan is refused (`400 INVALID_FIELD`).
     *
     * This axis is the `select` failure with the sign flipped OUTWARD. The
     * engine's `resolveSearchFields` drops unknown names and, when that leaves
     * the override empty, falls back to the FULL allowed set — the exact
     * two-step #4226 closed on projections, except that where a widened
     * projection returns extra columns, a widened search returns extra ROWS:
     * `?search=alpha&searchFields=<typo>` matched rows the caller's narrowing
     * excluded, in a response with nothing to distinguish it from a satisfied
     * one. `searchFields` exists only to narrow (ADR-0061: the override is
     * "intersected with the allowed set — it can narrow the scan, never widen
     * it"), so failing open to a wider scan is the one direction it must never
     * take. Its only in-framework caller today is `GET /data/:object/export` —
     * the same route whose `search` support just shipped precisely so an
     * export would stop downloading "the unsearched superset … in a file that
     * looks authoritative".
     *
     * Rejections share one code and differ in message, because the fixes
     * differ (the same split the expand axis draws): a name that is no field
     * at all is a typo, while a REAL field outside the searchable set needs
     * the OBJECT changed — added to a declared `searchableFields`, or declared
     * searchable at all when the auto-default excludes its type. [#6674] adds
     * the one case where changing the OBJECT cannot help either: a VIRTUAL
     * (`formula`) field has no stored column on any driver, so declaring it
     * searchable is not a narrower search but a scan of nothing — it used to
     * clear this gate precisely BECAUSE the object declared it, the fail-open
     * shape this axis exists to refuse. The allowed
     * set itself comes from {@link resolveSearchFieldResolution} in
     * `@objectstack/spec/data` — the same function the engine's search
     * expansion consumes — so this gate cannot admit a field the engine would
     * then decline to scan, nor refuse one it would.
     *
     * Names are judged EXACTLY (no dotted-head tolerance): the engine
     * intersects the override with the allowed set by exact string, so
     * `owner_id.name` — plausible from the select/sort axes — would be
     * silently dropped there, and this gate letting it through would
     * reintroduce the fallback it exists to close.
     *
     * ## The PROJECTION axis answers the same name differently — on purpose
     *
     * A name this gate refuses can still be spelled in `select` and come back
     * 200 with the key simply absent: {@link assertProjectionFieldsExist} gates
     * on whether a field is KNOWN, not on whether it is RETURNABLE, and the
     * engine's read path then drops what the caller may not see
     * (`omitInternalFields` for `internal: true` columns,
     * `stripSearchCompanionFromRead` for the hidden `__search` companion).
     * Measured on `__search`: `searchFields=__search` is a 400 here, while
     * `select=__search` is a 200 whose body lacks it.
     *
     * That is not a gap someone forgot to close — it was asked as its own
     * question and ruled intended on 2026-08-12 (#7876, direction C). The two
     * axes are different KINDS of surface. `searchFields` is AUTHORING input:
     * it tells the server how to RUN the query, so a value the server will not
     * honour changes WHICH ROWS come back — the fail-open this gate exists for.
     * `select` is a READ PROJECTION: it names what the caller would like back,
     * the row set is untouched either way, and a column the caller may not see
     * is simply not in the body.
     *
     * ⛔ Do not close the asymmetry by teaching the projection gate to refuse
     * unreturnable columns. That was the alternative on #7876 and it was
     * declined: it converts requests that answer 200 today into failures, for
     * symmetry, on spellings with no measured callers. A real caller burned by
     * a silent drop reopens the question on THAT measurement; the asymmetry
     * alone does not.
     */
    private assertSearchFieldsAreSearchable(object: string, requested: unknown, param: string): void {
        // Shape first, BEFORE the field-map tiering below — same order as the
        // projection gate (#4196): a registry-less host, which skips the name
        // checks, still must not carry an unreadable override to an engine
        // that would ignore it and scan the default set.
        let names: readonly string[];
        if (typeof requested === 'string') {
            names = requested.split(',').map((s) => s.trim()).filter(Boolean);
        } else if (Array.isArray(requested)) {
            const badShape = requested.findIndex((f) => typeof f !== 'string');
            if (badShape !== -1) {
                const err: any = new Error(
                    `'${param}' entry #${badShape + 1} on object '${object}' is not a field name. `
                    + `'${param}' narrows which columns 'search' scans, as a comma-separated string `
                    + 'or an array of field names.',
                );
                err.code = 'INVALID_FIELD';
                err.status = 400;
                err.object = object;
                err.param = param;
                throw err;
            }
            names = requested;
        } else {
            const err: any = new Error(
                `'${param}' on object '${object}' must be a comma-separated string or an array of `
                + `field names, received ${requested === null ? 'null' : typeof requested}. It narrows `
                + "which columns 'search' scans; a value the server cannot read would have been "
                + 'ignored, leaving the search over the DEFAULT columns instead.',
            );
            err.code = 'INVALID_FIELD';
            err.status = 400;
            err.object = object;
            err.param = param;
            throw err;
        }
        // An empty override is ABSENT — the engine falls through to the
        // allowed set for it, which for a caller who named nothing is the
        // answer they asked for, not a widened one.
        if (names.length === 0) return;
        const gate = this.resolveQueryFields(object);
        if (!gate) return;
        const { allowed, source } = resolveSearchFieldResolution({
            fields: gate.fields,
            searchableFields: gate.schema?.searchableFields,
            // [ADR-0079] Same precedence the engine's search expansion applies:
            // `nameField` is canonical, `displayNameField` the honored alias.
            displayField: gate.schema?.nameField ?? gate.schema?.displayNameField,
        });
        const allowedSet = new Set(allowed);
        // A name in the object's own `searchableFields` that names no field is
        // a STALE DECLARATION — a bug on the OBJECT, not on the request. It
        // matters because clients echo the declaration verbatim (objectui's
        // list search sends `$searchFields: schema.searchableFields`), so
        // calling it "unknown" would send the caller hunting a typo they
        // never made. Same split the expand axis draws for a lookup whose
        // `reference` was never authored.
        const declaredSet = new Set<string>(Array.isArray(gate.schema?.searchableFields) ? gate.schema.searchableFields : []);
        const unknown = names.filter((n) => !allowedSet.has(n) && !gate.known.has(n) && !declaredSet.has(n));
        const staleDeclared = names.filter((n) => !allowedSet.has(n) && !gate.known.has(n) && declaredSet.has(n));
        // [#6674] A VIRTUAL field is its own rejection, split out of
        // `unsearchable` before the source branch below rather than after it,
        // because BOTH of that branch's messages are wrong for it. The declared
        // one ("a field outside it cannot be a search target until it is added
        // there") is false — it may already BE in the list, which is exactly the
        // shape this closes; the auto one prescribes "declare `searchableFields`
        // to choose the searchable set explicitly", which for a formula field is
        // an instruction to author the refused declaration. The fix is neither:
        // the value has no column anywhere, so it must be mirrored onto a stored
        // one. Judged by the same `@objectstack/spec/data` predicate the
        // resolution applies, so gate and engine cannot disagree about which
        // types have a column.
        const virtual = names.filter((n) => !allowedSet.has(n) && gate.known.has(n) && isVirtualSearchField(gate.fields[n]));
        const unsearchable = names.filter((n) => !allowedSet.has(n) && gate.known.has(n) && !isVirtualSearchField(gate.fields[n]));
        const [offenders, reason] =
            unknown.length > 0 ? [unknown, 'unknown' as const]
            : staleDeclared.length > 0 ? [staleDeclared, 'stale-declared' as const]
            : virtual.length > 0 ? [virtual, 'virtual' as const]
            : [unsearchable, 'unsearchable' as const];
        if (offenders.length === 0) return;
        const first = offenders[0];
        let detail: string;
        if (reason === 'stale-declared') {
            detail = `Field '${first}' on object '${object}' is declared in 'searchableFields' but `
                + 'does not exist'
                + (offenders.length > 1 ? ` (also: ${offenders.slice(1).join(', ')})` : '')
                + '. The declaration is stale — searching it can never match, and the engine '
                + "silently skipped it. Fix the object's 'searchableFields' to name real fields.";
        } else if (reason === 'virtual') {
            const vtype = gate.fields[first]?.type ?? 'formula';
            detail = `Field '${first}' on object '${object}' is a virtual '${vtype}' field and cannot be searched`
                + (offenders.length > 1 ? ` (also: ${offenders.slice(1).join(', ')})` : '')
                + `. Its value is computed on read and never stored, so no driver materializes a `
                + `column for 'search' to scan and the entry can never match — measured as 0 rows, `
                + 'with no error, on both the in-memory and the SQL backends.'
                + (declaredSet.has(first)
                    ? ` The object's 'searchableFields' declares it, which is what made the entry `
                      + 'look like coverage; remove it there as well.'
                    : '')
                + ` Mirror the computed value onto a stored text field on '${object}' and search that instead.`;
        } else if (reason === 'unknown') {
            // A dotted path is a special unknown: plausible vocabulary from the
            // select/sort axes, but search scans this object's own columns.
            const dottedHint = first.includes('.') && gate.known.has(first.split('.')[0])
                ? " 'search' scans this object's own columns; a related record's column cannot be a search target."
                : suggestFieldName(first, gate.declared);
            detail = `Unknown field '${first}' on object '${object}'`
                + (offenders.length > 1 ? ` (also: ${offenders.slice(1).join(', ')})` : '')
                + `. '${param}' narrows which columns 'search' scans, so a name the object does not `
                + 'declare cannot narrow anything — and the engine used to drop it and scan the '
                + 'default columns instead, answering a NARROWER search with a WIDER one.'
                + dottedHint;
        } else if (source === 'declared') {
            detail = `Field '${first}' on object '${object}' is not searchable`
                + (offenders.length > 1 ? ` (also: ${offenders.slice(1).join(', ')})` : '')
                + `. The object declares 'searchableFields' (${allowed.join(', ')}), which is the set `
                + "'search' scans — a field outside it cannot be a search target until it is added there.";
        } else {
            const meta = gate.fields[first];
            const why = !meta || SEARCH_AUTO_EXCLUDED_FIELDS.has(first)
                ? 'a system/audit column, which the default never includes'
                : meta.hidden
                    ? 'hidden'
                    : `type '${meta.type}'`;
            detail = `Field '${first}' on object '${object}' is not searchable`
                + (offenders.length > 1 ? ` (also: ${offenders.slice(1).join(', ')})` : '')
                + `. With no 'searchableFields' declared, 'search' scans the text-like columns `
                + `(${[...SEARCHABLE_TEXTUAL_TYPES, ...SEARCHABLE_ENUM_TYPES].join(' / ')}), and '${first}' is `
                + why
                + ". Declare 'searchableFields' on the object to choose the searchable set explicitly.";
        }
        const err: any = new Error(detail);
        err.code = 'INVALID_FIELD';
        err.status = 400;
        err.field = first;
        err.fields = offenders;
        err.object = object;
        err.param = param;
        throw err;
    }

    /**
     * [#4254] GROUP-BY axis. A grouping target the object does not have is
     * refused (`400 INVALID_FIELD`); a grouping target the spec cannot read is
     * refused as a shape (`400 INVALID_QUERY`).
     *
     * The failure this closes is the quietest of the family: the in-memory
     * aggregation path projects an unknown column as `null` for every row, so
     * ALL rows land in one bucket — `groupBy=[<typo>]` answered
     * `[{ <typo>: null, n: <true row count> }]`, a structurally perfect result
     * identical to "this column really holds a single value". A chart draws
     * one bar; nothing anywhere says the grouping never ran. And the answer
     * depended on which backend a deployment happens to sit on: a driver with
     * native aggregation hands `GROUP BY <typo>` to its database instead
     * (whose refusal `SqlDriver` may or may not surface), while the in-memory
     * fallback invents the one-bucket result — the "two routes, opposite
     * answers" split #4226 closed, relocated one axis over. Refusing at the
     * shared ingress is what makes the two paths agree.
     *
     * Names are judged EXACTLY, not by dotted head: the aggregation contract
     * groups by THIS object's columns (`row[field]` verbatim on the in-memory
     * path, a bare column reference in pushed-down SQL), so a dotted path can
     * only ever produce the null bucket.
     */
    private assertGroupByFieldsExist(object: string, groupBy: unknown): void {
        if (groupBy === undefined || groupBy === null) return;
        if (!Array.isArray(groupBy)) {
            throw invalidQueryError(
                'groupBy',
                `must be an array of grouping targets (a field name, or { field, dateGranularity } `
                + `for date bucketing), received ${typeof groupBy}`,
                {
                    hint: ' A value the server cannot read used to be ignored — the rows came back '
                        + 'UNGROUPED, looking exactly like a query that never asked for grouping. '
                        + `Send e.g. { "groupBy": ["status"] } in the 'POST /data/:object/query' body.`,
                    extra: { object },
                },
            );
        }
        if (groupBy.length === 0) return;
        const fieldsToCheck: string[] = [];
        for (let i = 0; i < groupBy.length; i++) {
            const entry = groupBy[i];
            if (typeof entry === 'string') {
                fieldsToCheck.push(entry);
                continue;
            }
            if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
                throw invalidQueryError(
                    'groupBy',
                    `entry #${i + 1} on object '${object}' is not a grouping target — expected a `
                    + `field name or { field, dateGranularity }, received `
                    + `${entry === null ? 'null' : Array.isArray(entry) ? 'an array' : typeof entry}`,
                    { extra: { object } },
                );
            }
            if (typeof entry.field !== 'string' || entry.field.length === 0) {
                throw invalidQueryError(
                    'groupBy',
                    `entry #${i + 1} on object '${object}' names no field — the structured form is `
                    + `{ field, dateGranularity?, alias? }`,
                    { extra: { object } },
                );
            }
            if (entry.dateGranularity !== undefined && !DATE_GRANULARITIES.has(entry.dateGranularity)) {
                throw invalidQueryError(
                    'groupBy',
                    `entry #${i + 1} on object '${object}' buckets by '${String(entry.dateGranularity)}', `
                    + `which is not a date granularity (${[...DATE_GRANULARITIES].join(' / ')})`,
                    {
                        hint: ' An unknown granularity used to fall through to one bucket per raw '
                            + 'value — date bucketing that silently never bucketed.',
                        extra: { object },
                    },
                );
            }
            fieldsToCheck.push(entry.field);
        }
        const gate = this.resolveQueryFields(object);
        if (!gate) return;
        const unknown = fieldsToCheck.filter((f) => !gate.known.has(f));
        if (unknown.length === 0) return;
        const first = unknown[0];
        const dottedHint = first.includes('.') && gate.known.has(first.split('.')[0])
            ? " Grouping runs over this object's own columns; a related record's column cannot be a "
              + 'grouping target.'
            : suggestFieldName(first, gate.declared);
        const err: any = new Error(
            `Unknown field '${first}' on object '${object}'`
            + (unknown.length > 1 ? ` (also: ${unknown.slice(1).join(', ')})` : '')
            + `. 'groupBy' buckets rows by a column's values, so an unknown column puts every row `
            + 'in ONE bucket keyed null — a result indistinguishable from a column that really '
            + 'holds a single value.'
            + dottedHint,
        );
        err.code = 'INVALID_FIELD';
        err.status = 400;
        err.field = first;
        err.fields = unknown;
        err.object = object;
        err.param = 'groupBy';
        throw err;
    }

    /**
     * [#4254] AGGREGATIONS axis. An aggregation over a field the object does
     * not have is refused (`400 INVALID_FIELD`); an entry the spec cannot read
     * is refused as a shape (`400 INVALID_QUERY`).
     *
     * The stakes are the highest of the three #4254 axes because the wrong
     * answer is a NUMBER: the in-memory path collects `undefined` for every
     * row and `sum` folds those to 0, so `sum(<typo>)` answered `0` — the same
     * `0` a genuinely empty quarter produces, in a report whose whole job is
     * to be believed. (`avg`/`min`/`max` answer `null`, `count(<typo>)` counts
     * nothing — every function has a plausible-looking value for a column that
     * is not there.)
     *
     * The shape checks pin the rest of the spec's `AggregationNode` contract,
     * because each violation also had a silent placeholder instead of an
     * error: a function outside the spec enum computed `null`, a missing
     * `alias` keyed the result column `"undefined"`, and a field-less
     * aggregation is only meaningful as `count(*)` — for every other function
     * it answered `null`/`0` while looking like a served query. `count` with
     * no field (or the explicit `'*'` sentinel) is the one legitimate
     * field-less form and passes.
     */
    private assertAggregationFieldsExist(object: string, aggregations: unknown): void {
        if (aggregations === undefined || aggregations === null) return;
        if (!Array.isArray(aggregations)) {
            throw invalidQueryError(
                'aggregations',
                `must be an array of { function, field?, alias } entries, received `
                + `${typeof aggregations}`,
                {
                    hint: ' A value the server cannot read used to be ignored — the rows came back '
                        + 'raw and unaggregated. Send e.g. { "aggregations": [{ "function": "sum", '
                        + `"field": "amount", "alias": "total" }] } in the 'POST /data/:object/query' body.`,
                    extra: { object },
                },
            );
        }
        if (aggregations.length === 0) return;
        const fieldsToCheck: string[] = [];
        for (let i = 0; i < aggregations.length; i++) {
            const entry = aggregations[i];
            if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
                throw invalidQueryError(
                    'aggregations',
                    `entry #${i + 1} on object '${object}' is not an aggregation — expected `
                    + `{ function, field?, alias }, received `
                    + `${entry === null ? 'null' : Array.isArray(entry) ? 'an array' : typeof entry}`,
                    { extra: { object } },
                );
            }
            if (typeof entry.function !== 'string' || !AGGREGATION_FUNCTIONS.has(entry.function)) {
                throw invalidQueryError(
                    'aggregations',
                    `entry #${i + 1} on object '${object}' uses `
                    + (typeof entry.function === 'string'
                        ? `'${entry.function}', which is not an aggregation function`
                        : 'no aggregation function')
                    + ` (${[...AGGREGATION_FUNCTIONS].join(' / ')})`,
                    {
                        hint: ' An unknown function used to compute null for every group while the '
                            + 'response looked served.',
                        extra: { object },
                    },
                );
            }
            if (typeof entry.alias !== 'string' || entry.alias.length === 0) {
                throw invalidQueryError(
                    'aggregations',
                    `entry #${i + 1} on object '${object}' has no 'alias' — the alias names the `
                    + `result column (without one it came back keyed "undefined")`,
                    { extra: { object } },
                );
            }
            if (entry.field === undefined || entry.field === null) {
                if (entry.function !== 'count') {
                    throw invalidQueryError(
                        'aggregations',
                        `entry '${entry.alias}' on object '${object}' applies '${entry.function}' to no `
                        + `field. Only 'count' may omit the field (count(*), every row); '${entry.function}' `
                        + 'needs a column to compute over — without one it answered null while looking served',
                        { extra: { object } },
                    );
                }
                continue;
            }
            if (typeof entry.field !== 'string') {
                throw invalidQueryError(
                    'aggregations',
                    `entry '${entry.alias}' on object '${object}' has a non-string 'field' `
                    + `(received ${typeof entry.field})`,
                    { extra: { object } },
                );
            }
            if (entry.field === '*') {
                if (entry.function !== 'count') {
                    throw invalidQueryError(
                        'aggregations',
                        `entry '${entry.alias}' on object '${object}' applies '${entry.function}' to '*'. `
                        + `'*' is the count-all sentinel and only 'count' reads it`,
                        { extra: { object } },
                    );
                }
                continue;
            }
            fieldsToCheck.push(entry.field);
        }
        const gate = this.resolveQueryFields(object);
        if (!gate) return;
        const unknown = fieldsToCheck.filter((f) => !gate.known.has(f));
        if (unknown.length === 0) return;
        const first = unknown[0];
        const dottedHint = first.includes('.') && gate.known.has(first.split('.')[0])
            ? " Aggregation runs over this object's own columns; a related record's column cannot "
              + 'be aggregated.'
            : suggestFieldName(first, gate.declared);
        const err: any = new Error(
            `Unknown field '${first}' on object '${object}'`
            + (unknown.length > 1 ? ` (also: ${unknown.slice(1).join(', ')})` : '')
            + `. An aggregation computes over a column's values, so an unknown column could only `
            + 'aggregate blanks — sum answered 0 and avg/min/max answered null, each '
            + 'indistinguishable from the same result over real data.'
            + dottedHint,
        );
        err.code = 'INVALID_FIELD';
        err.status = 400;
        err.field = first;
        err.fields = unknown;
        err.object = object;
        err.param = 'aggregations';
        throw err;
    }

    async findData(request: { object: string, query?: any, context?: any }) {
        // [#3770] Existence first: an unregistered object is a 404 before any
        // query parameter is even parsed, so an unknown name can never be
        // probed for query-shape validity (nor reach the driver as a table).
        this.assertObjectRegistered(request.object);
        const options: any = { ...request.query };
        // The execution context is SERVER-DERIVED and never caller input.
        //
        // `request.query` is the raw request bag on every ingress that reaches
        // here — the REST `POST /data/:object/query` route hands `req.body`
        // straight in as `query`. `context` is in the known-params set below, so
        // it was not swept into the implicit-filter bucket either: a caller's
        // `context` survived this spread and, because the assignment below is
        // conditional, became the operation's execution context whenever no
        // server context resolved (before #3963 an anonymous request on a
        // `requireAuth: false` deployment; the invariant holds regardless).
        //
        // What rides on it is total: plugin-security's middleware opens with
        // `if (opCtx.context?.isSystem) return next()` — the entire RLS / FLS /
        // CRUD chain skipped — and `__expandRead` marks a read as an expansion
        // sub-read (#2850; it waived the object-level CRUD gate for "public"
        // objects until #7626 removed that). Neither is ever schema-stripped on
        // this path: `ExecutionContextSchema.parse` runs only in
        // `engine.createContext`, which the read path does not use.
        //
        // Route-level `enforceAuth` is what kept that from being reachable, so
        // this was a fail-OPEN default one layer down. Drop any inbound
        // `context` unconditionally: the protocol must not depend on a gate
        // above it staying switched on.
        delete options.context;

        // [#7321] Arity BEFORE any read, fold or coercion. `IHttpRequest.query`
        // is `Record< string, string | string[] >`; the array arm is real (the
        // `node:http` adapter hands `?x=1&x=2` through as `['1','2']`, measured
        // over a socket on #6878), and every coercion below was written for the
        // string arm. `Number(['1','2'])` is `NaN`, so `?$top=1&$top=2` used to
        // reach the driver as `limit: NaN` — a wrong answer served as a 200.
        //
        // Single-vs-multi is a PER-PARAMETER judgement, never a sweep: `$select`
        // / `$expand` / `$searchFields` / `$orderby` accept the array arm on
        // purpose and are untouched here. See
        // {@link ARRAY_VALUED_QUERY_SLOTS} for the full disposition.
        assertQueryParamArity(options);

        // Forward the dispatcher's ExecutionContext so RBAC/RLS middleware
        // can apply per-request enforcement. The protocol layer is purely
        // a normalizer — it must never strip security context.
        if (request.context !== undefined) {
            options.context = request.context;
        }

        // ====================================================================
        // Normalize legacy params → QueryAST standard (where/fields/orderBy/offset/expand)
        // ====================================================================

        // OData-style `$`-prefixed params → bare aliases that the rest of
        // this function knows how to normalize. Without this step, params
        // like `?$top=2&$orderby=...` survive into the catch-all
        // implicit-filter pass below and get merged into `where` as
        // bogus field-equality predicates (e.g. `where.$top = "2"`),
        // which silently returns zero rows for every list endpoint.
        //
        // [#4226] `wireSpelling` remembers which alias each rewritten slot
        // arrived under, so a rejection quotes the parameter the caller
        // actually wrote. Telling someone who sent `?$orderby=…` that
        // "'orderBy' is invalid" names a parameter absent from their request.
        //
        // [#7321] The table itself now lives at module scope
        // ({@link WIRE_DOLLAR_ALIASES}) so the arity survey above and this fold
        // cannot drift apart on which `$` spellings exist.
        const wireSpelling: Record<string, string> = {};
        for (const [dollar, bare] of WIRE_DOLLAR_ALIASES) {
            if (options[dollar] != null && options[bare] == null) {
                options[bare] = options[dollar];
                wireSpelling[bare] = dollar;
            }
            delete options[dollar];
        }

        // [#3795] One slot, one value. Every alias spelling of the six
        // QueryAST slots resolves HERE, by the spec's own table, before the
        // per-slot wire coercion below ever runs — so that coercion reads
        // canonical keys only. An alias alone folds into its canonical key;
        // redundant identical spellings collapse; different values for one
        // slot are refused (the #4181 rule, generalized from the filter slot
        // to all of them — four used to resolve BACKWARDS here, each in its
        // own way, disagreeing with the spec's documented precedence and with
        // the runtime dispatcher's copy of the same fold; `top`→`limit`
        // joined the table last, via #4346).
        //
        // `arrivedAs` remembers which spelling carried each slot's value;
        // composed with `wireSpelling` it names the parameter the caller
        // actually wrote in every rejection below (#4226).
        const spellingFor = (name: string): string => wireSpelling[name] ?? name;
        const arrivedAs = foldQueryAliasSlots(options, WIRE_QUERY_ALIAS_SLOTS, (conflict) => {
            throw conflictingQueryParamsError(conflict, spellingFor);
        });
        const slotParam = (canonical: string): string => spellingFor(arrivedAs[canonical] ?? canonical);

        // Numeric fields — coerce querystring strings. `top` already folded
        // into `limit` above: the pair joined the #3795 slot table with #4346,
        // replacing an open-coded rewrite here that resolved it BACKWARDS
        // (`options.limit = Number(options.top)` — the alias overwrote the
        // canonical key, so `{top: 1, limit: 3}` answered 1 over HTTP and 3
        // through a direct engine call).
        if (options.limit != null) options.limit = Number(options.limit);
        if (options.offset != null) options.offset = Number(options.offset);

        // Projection: comma-separated string → array. A single-value
        // querystring param arrives as a bare string — `?fields=name` or the
        // folded `?select=` / `$select` spellings — which drivers' `.map()`
        // calls over `query.fields` would otherwise throw on.
        const projectionKey = slotParam('fields');
        if (typeof options.fields === 'string') {
            options.fields = options.fields.split(',').map((s: string) => s.trim()).filter(Boolean);
        } else if (options.fields !== undefined && !Array.isArray(options.fields)) {
            delete options.fields;
        }
        // [#4226] Unknown projection columns are refused rather than dropped —
        // see `assertProjectionFieldsExist` for why this axis' silent failure
        // returned MORE than was asked for.
        this.assertProjectionFieldsExist(request.object, options.fields, projectionKey);

        // Sort: every wire shape → SortNode[].
        //
        // [#4226] `normalizeSortNodes` folds the two shapes that used to fall
        // through this block untouched — `string[]` and `{field: direction}` —
        // and refuses the ones it cannot read. Before it, "not a string and not
        // an array" simply skipped the branch, leaving a value on `orderBy`
        // that `SqlDriver`'s `Array.isArray` guard then declined to turn into
        // an ORDER BY clause: no sort, no error, no way to tell.
        const sortValue = options.orderBy;
        const sortKey = slotParam('orderBy');
        if (sortValue === undefined || sortValue === null) {
            // Nothing to sort by — and an explicit `orderBy: null` must not ride
            // to the engine as a value every driver quietly declines to read.
            delete options.orderBy;
        } else {
            const orderBy = normalizeSortNodes(sortValue, sortKey);
            // [#4226] Validated on the NORMALIZED nodes, so one gate covers
            // every spelling — `?sort=no_such`, `['-no_such']`, `{no_such:
            // 'desc'}` and `[{field:'no_such'}]` are one mistake with one
            // answer. Assigned only after it passes, so a rejected sort cannot
            // leave a half-applied one behind.
            this.assertSortFieldsExist(request.object, orderBy, sortKey);
            if (orderBy.length > 0) options.orderBy = orderBy;
            else delete options.orderBy;
        }

        // Filter: the folded slot value → a usable `FilterCondition` on
        // `where`, or a rejection. The four spellings of this slot
        // (`where`/`filter`/`filters`/`$filter`) already resolved through the
        // #3795 fold above — #4181's one-slot-one-value rule, which this block
        // pioneered before the fold generalized it.
        const filterKey = slotParam('where');

        if (options.where !== undefined) {
            let parsedFilter = options.where;
            // A blank `?filter=` is ABSENT, not malformed — the same `length > 0`
            // guard the export route applies before parsing. Deleting `where`
            // here (rather than leaving `''` on it) is what lets every consumer
            // below test presence with a plain falsy check.
            if (typeof parsedFilter === 'string' && parsedFilter.trim() === '') {
                delete options.where;
            } else {
                // [#4181] JSON string → object. Parse failure is a REJECTION, not
                // a fallback. The `catch { /* keep as-is */ }` this replaces left
                // the raw string on `where`, a shape no driver consumes — so the
                // filter was dropped whole and `?filter={status:done` (one missing
                // quote) answered 200 with the UNFILTERED page. Worst member of
                // the #3948 family: #4134 zeroed, #4164 dropped one predicate,
                // this returned everything.
                //
                // The sibling `GET /data/:object/export` route has rejected this
                // exact input since it was written (`400 INVALID_REQUEST`,
                // "filter must be JSON"); the list path was the outlier. The
                // guard lives HERE, in the shared normalizer, so `GET
                // /data/:object`, `POST /data/:object/query` and the runtime
                // dispatcher all inherit one answer instead of three.
                if (typeof parsedFilter === 'string') {
                    try {
                        parsedFilter = JSON.parse(parsedFilter);
                    } catch {
                        throw unusableFilterError(filterKey, 'must be valid JSON');
                    }
                }
                // Filter AST array → FilterCondition object
                if (isFilterAST(parsedFilter)) {
                    parsedFilter = parseFilterAST(parsedFilter);
                } else if (Array.isArray(parsedFilter) && parsedFilter.length > 0) {
                    // [#4121] `isFilterAST` was being read as a *conversion* gate,
                    // so an array it refused was assigned to `where` unconverted —
                    // an opaque value the driver then had to make sense of. Every
                    // driver now fails on it, so this is not a narrowing; it moves
                    // the failure to where the malformed filter actually arrived,
                    // with the request's own vocabulary in the message instead of a
                    // driver-internal one.
                    //
                    // It also closes what the driver-side fix could not: a lone
                    // `['and']` / `['or']` sets the join mode, matches no element,
                    // and emits NO predicate — the last shape that still returned
                    // every row silently after #3948. An empty `[]` is left alone:
                    // it means "no filter", and every path already treats it that
                    // way — so it falls through to the shape check below, which
                    // passes it (an array IS an object).
                    throw malformedFilterArrayError(parsedFilter);
                }
                // [#4181] Parsed-but-unusable is the same failure one step later:
                // `?filter=5` / `?filter="open"` / `?filter=null` all yield a
                // non-object `where` that no driver reads. #4121 above catches the
                // array shapes; this catches the scalar ones, and together they are
                // what lets the #4164 merge below trust `where` to be an object.
                if (parsedFilter === null || typeof parsedFilter !== 'object') {
                    throw unusableFilterError(
                        filterKey,
                        `must be a filter object or condition array, received ${parsedFilter === null ? 'null' : typeof parsedFilter}`,
                    );
                }
                options.where = parsedFilter;
            }
        }

        // Expand: the folded slot value → `Record<string, QueryAST>`. A comma
        // list (string) and a name array both lower to `{name: {object: name}}`;
        // the advanced `{rel: QueryAST}` map a caller may send directly on
        // `POST /data/:object/query` passes through as-is. Lowering the ARRAY
        // shape here (not just the string) also closes a pre-#3795 gap: a raw
        // name array used to survive this block whole, so the #4226 gate read
        // its INDICES as relation names and refused real requests with
        // "Unknown field '0'".
        const expandValue = options.expand;
        const expandNames: string[] = [];
        if (typeof expandValue === 'string') {
            expandNames.push(...expandValue.split(',').map((s: string) => s.trim()).filter(Boolean));
        } else if (Array.isArray(expandValue)) {
            expandNames.push(...expandValue);
        }
        if (typeof options.expand !== 'object' || options.expand === null || Array.isArray(options.expand)) {
            delete options.expand;
        }
        if (expandNames.length > 0 && !options.expand) {
            options.expand = {} as Record<string, any>;
            for (const rel of expandNames) {
                options.expand[rel] = { object: rel };
            }
        }
        // [#4226] Both routes into `expand` are gated: the comma-list spellings
        // collected above, and the advanced `{rel: QueryAST}` map a caller may
        // send directly on `POST /data/:object/query`. Validating the map's KEYS
        // rather than `expandNames` is what covers the second one.
        if (options.expand && typeof options.expand === 'object') {
            this.assertExpandTargetsExist(request.object, Object.keys(options.expand));
        }

        // [#4254] The `searchFields` override is validated on the value the
        // ENGINE will read — the standalone parameter when present, otherwise
        // the object-form `search: { query, fields }` a `POST` body may carry
        // (same precedence as the engine's own `searchFields ?? search.fields`,
        // and the same shapes: the engine accepts the comma-string and array
        // forms from either slot). Checked whether or not a `search` term rode
        // along: the caller named fields either way, and a stale override is
        // the same typo before the search that will eventually use it is added.
        if (options.searchFields != null) {
            this.assertSearchFieldsAreSearchable(
                request.object, options.searchFields, wireSpelling.searchFields ?? 'searchFields',
            );
        } else if (options.search !== null && typeof options.search === 'object'
            && (options.search as any)?.fields != null) {
            this.assertSearchFieldsAreSearchable(
                request.object, (options.search as any).fields, wireSpelling.search ?? 'search',
            );
        }

        // Boolean fields
        for (const key of ['distinct', 'count']) {
            if (options[key] === 'true') options[key] = true;
            else if (options[key] === 'false') options[key] = false;
        }

        // [#2926 ⑩] Every supported OData-style `$` alias has been consumed and
        // deleted above ($top/$skip/$orderby/$select/$count/$search/
        // $searchFields/$filter/$expand). A `$`-prefixed key can never be a
        // field name, so anything left is an unsupported query parameter —
        // fail loudly instead of letting it fall into the implicit-filter
        // bucket below, where it silently matched zero rows (or, before the
        // $filter alias existed, was dropped entirely and returned the
        // UNFILTERED page — a footgun for scripts resolving ids by name).
        const unsupportedDollarParams = Object.keys(options).filter((k) => k.startsWith('$'));
        if (unsupportedDollarParams.length > 0) {
            const err: any = new Error(
                `Unsupported query parameter(s): ${unsupportedDollarParams.join(', ')}. ` +
                'Supported $-prefixed parameters: $top, $skip, $orderby, $select, $count, $search, $searchFields, $filter, $expand.',
            );
            err.status = 400;
            err.code = 'UNSUPPORTED_QUERY_PARAM';
            throw err;
        }

        // [#4134] A leftover key is about to be lowered into a field-equality
        // predicate (or, when an explicit `where` won, dropped on the floor).
        // Both readings are only sound if the key names a REAL field: a filter
        // on a field that does not exist can never match, so `?pageSize=5`
        // returned 200 + `total: 0` — indistinguishable from "no data". The
        // write path already rejects the same input loudly (`INVALID_FIELD`);
        // this is the read half of that one piece of knowledge, and the mirror
        // of #3948's rule for driver-memory: an unapplied filter must not look
        // like a satisfied one.
        //
        // Validated BEFORE the `!options.where` branch below, so a bad param is
        // a 400 whether or not the caller also sent an explicit filter — the
        // failure must not depend on which other params rode along.
        const leftoverParams = Object.keys(options).filter((k) => !RESERVED_LIST_QUERY_PARAMS.has(k));
        if (leftoverParams.length > 0) {
            this.assertQueryParamsAreFields(request.object, leftoverParams);
        }

        // [#7534] The same question, on the EXPLICIT filter the caller wrote —
        // the sibling door #4134's fix never reached. `options.where` is a
        // lowered `FilterCondition` by this point whichever of the three doors
        // carried it (`where` object, `$filter` string, filter AST), so one call
        // covers all three. Placed here, and not earlier, on purpose: see
        // `assertFilterFieldsExist` for why it runs after the param gate above
        // and before the #4164 merge below.
        this.assertFilterFieldsExist(request.object, options.where, filterKey);

        // Flat field filters: REST-style query params like ?id=abc&status=open
        // are implicit field-level equality predicates. Every leftover key is a
        // verified field name by this point — the #4134 gate above runs FIRST,
        // which is exactly what makes the merge below safe: an unknown name
        // already 400'd, so nothing merged here can be a predicate that matches
        // nothing.
        //
        // [#4164] Implicit predicates now COMPOSE with an explicit `where`
        // instead of being silently dropped. `?filter={...}&status=open` means
        // what it says — both apply, `{ $and: [explicit, implicit] }` — the
        // same composition the engine itself uses to fold the `$search`
        // predicate or an expand's declared filter into an existing `where`,
        // and a combinator the #3774 conformance suite pins across every
        // FilterCondition backend. Contradictory sides need no special case:
        // both predicates apply and the intersection is an HONEST zero (the
        // filters ran), unlike the pre-#4134 zero (a filter that never ran).
        // Consuming the keys here also stops them riding to `engine.find` as
        // stray top-level AST junk, and count() below reads the same
        // `options.where`, so pagination totals see the merged predicate too.
        //
        // #4164 shipped with a `typeof explicitWhere === 'object'` guard here,
        // because the parse tolerance above could leave a raw unparseable string
        // on `where` and folding real predicates into that garbage would neither
        // apply them nor surface the bug. #4181 fixed that at the source — a
        // filter now either parses to an object or 400s — so `where` is an
        // object or absent by construction and the guard is gone with it.
        const explicitWhere = options.where;
        if (leftoverParams.length > 0) {
            const implicitFilters: Record<string, unknown> = {};
            for (const key of leftoverParams) {
                implicitFilters[key] = options[key];
                delete options[key];
            }
            // An absent or empty explicit filter (`?filter={}`, `?filter=`) is
            // vacuous — the implicit predicates stand alone rather than being
            // wrapped in a one-armed `$and`.
            options.where = !explicitWhere || Object.keys(explicitWhere).length === 0
                ? implicitFilters
                : { $and: [explicitWhere, implicitFilters] };
        }

        // [#4254] The aggregation axes name fields too, and were the last
        // read-path axes that answered a wrong name with a plausible result
        // (one null-keyed bucket; sum = 0). Validated before the routing
        // below so an unreadable SHAPE cannot slip past the `Array.isArray`
        // routing guard and ride to `engine.find` as ignored AST junk —
        // rows returned ungrouped, looking exactly like a served query.
        this.assertGroupByFieldsExist(request.object, options.groupBy);
        this.assertAggregationFieldsExist(request.object, options.aggregations);

        // Route to engine.aggregate() when the query has GROUP BY / aggregations.
        // engine.find() does not do in-memory aggregation fallback, so without
        // this branch a spec-shape aggregate request would silently return
        // ungrouped raw rows on drivers (e.g. SqlDriver) that don't natively
        // honor groupBy/aggregations in find().
        const hasGroupBy = Array.isArray(options.groupBy) && options.groupBy.length > 0;
        const hasAggregations = Array.isArray(options.aggregations) && options.aggregations.length > 0;
        if (hasGroupBy || hasAggregations) {
            const records = await this.engine.aggregate(request.object, {
                where: options.where,
                groupBy: options.groupBy,
                aggregations: options.aggregations,
                // Enforced engine-side since #4286 (step 3) — dropping it here
                // was finding 1: the one wire path to aggregate() lost the
                // clause before any executor could ever see it.
                having: options.having,
                context: options.context,
            } as any);
            // Apply limit client-side (EngineAggregateOptions doesn't carry limit).
            // `records` is the full grouped set, so its length IS the real total
            // and `hasMore` follows from whether the slice dropped any groups.
            const limited = typeof options.limit === 'number' && options.limit > 0
                ? records.slice(0, options.limit)
                : records;
            return {
                object: request.object,
                records: limited,
                total: records.length,
                hasMore: limited.length < records.length,
            };
        }

        // [#4371 option 2] Strip the PROTOCOL-layer keys off the bag before it
        // becomes the engine option bag — the engine now rejects option keys
        // it does not execute, and these belong to this layer, not to it:
        // - `object`: the POST-body convenience copy of the route object
        //   (reserved above so it is not read as a field filter). It used to
        //   ride the spread into the engine AST and OVERRIDE the resolved
        //   object, splitting `ast.object` from the table actually queried —
        //   a mismatch is refused, never resolved by picking a winner.
        // - `count`: a response-shape flag this method consumed above.
        // - QueryAST tombstones (`cursor`/`joins`/`windowFunctions`/
        //   `distinct`): reserved at the wire gate so they are not read as
        //   field filters; on the wire they stay ignored-with-tombstone-docs
        //   (schema parse is where they 400), and they must not leak to the
        //   engine as junk.
        // - `having`: consumed by the aggregate branch above; the find path
        //   cannot serve it.
        if (options.object != null && options.object !== request.object) {
            const err: any = new Error(
                `Conflicting object: the route addresses '${request.object}' but the query body ` +
                `says '${options.object}'. The body 'object' key is a convenience copy of the ` +
                'route object and must match it.',
            );
            err.status = 400;
            err.code = 'QUERY_OBJECT_MISMATCH';
            throw err;
        }
        for (const k of ['object', 'count', 'joins', 'windowFunctions', 'cursor', 'distinct', 'having']) {
            delete options[k];
        }
        const records = await this.engine.find(request.object, options);
        // Pagination metadata. When a `limit` is present the response is a single
        // page, so `records.length` is the page size — NOT the match total. Run a
        // count over the same `where` so the client can render total pages and know
        // whether more pages remain (true server-side pagination). Without a limit
        // the full result set is returned, so its length already IS the total.
        //
        // engine.count() only honors `where`; a `search`/`distinct` query can't be
        // reproduced by it, so for those we skip the count and fall back to a
        // page-local estimate (a full page implies there may be more) rather than
        // reporting a wrong total.
        const pageLimit = typeof options.limit === 'number' && options.limit > 0 ? options.limit : undefined;
        const pageOffset = typeof options.offset === 'number' && options.offset > 0 ? options.offset : 0;
        let total = records.length;
        let hasMore = false;
        if (pageLimit !== undefined) {
            // `distinct` used to suppress the count here too — #4286 finding 2:
            // the flag's ONLY observable effect platform-wide, on a capability
            // that never deduplicated a row. Removed with `query.distinct`
            // (tombstoned in spec 17); `total`/`hasMore` are truthful again.
            const countable = options.search == null;
            if (countable) {
                try {
                    total = await this.engine.count(request.object, {
                        where: options.where,
                        context: options.context,
                    } as any);
                } catch {
                    // engine.count() has its own find().length fallback; if it still
                    // throws, degrade to a page-local total rather than failing the list.
                    total = pageOffset + records.length;
                }
                hasMore = pageOffset + records.length < total;
            } else {
                hasMore = records.length === pageLimit;
                total = pageOffset + records.length + (hasMore ? 1 : 0);
            }
        }
        return {
            object: request.object,
            records,
            total,
            hasMore,
        };
    }

    async getData(request: { object: string, id: string, expand?: string | string[], select?: string | string[], context?: any }) {
        this.assertObjectRegistered(request.object); // [#3770]
        const queryOptions: any = {
            where: { id: request.id }
        };
        if (request.context !== undefined) {
            queryOptions.context = request.context;
        }

        // Support fields for single-record retrieval
        //
        // [#4226] Gated exactly as on the list path. `GET /data/:object/:id` and
        // `GET /data/:object` read the same `select`/`expand` against the same
        // field map, so answering one with a 400 and the other with a silently
        // widened projection would recreate, one route over, the very split
        // ("two routes, opposite answers for one input") this issue was filed
        // about.
        if (request.select) {
            queryOptions.fields = typeof request.select === 'string'
                ? request.select.split(',').map((s: string) => s.trim()).filter(Boolean)
                : request.select;
            this.assertProjectionFieldsExist(request.object, queryOptions.fields, 'select');
        }

        // Support expand for single-record retrieval
        if (request.expand) {
            const expandNames = typeof request.expand === 'string'
                ? request.expand.split(',').map((s: string) => s.trim()).filter(Boolean)
                : request.expand;
            this.assertExpandTargetsExist(request.object, expandNames);
            queryOptions.expand = {} as Record<string, any>;
            for (const rel of expandNames) {
                queryOptions.expand[rel] = { object: rel };
            }
        }

        const result = await this.engine.findOne(request.object, queryOptions);
        if (result) {
            return {
                object: request.object,
                id: request.id,
                record: result
            };
        }
        throw recordNotFoundError(request.object, request.id);
    }

    /**
     * Validate-only (#6037 — #4633 ruling D): report the write path's verdict
     * on candidate rows without persisting any of them.
     *
     * Deliberately thin. The verdict comes from `engine.validate()`, which
     * calls the same `validateRecord` / `evaluateValidationRules` that
     * `insert()` calls — so "the preview agrees with the write" is guaranteed
     * by construction rather than by a mirror kept in step by hand. That
     * mirror is what this replaces: `rest/src/import-coerce.ts` re-implemented
     * a slice of the engine's rules and structurally could not predict the
     * rest of the family (ADR-0104 value shapes, `format`, object-level
     * `validations`, the state machine).
     *
     * Same object-existence gate as every other data entry point (#3770), so
     * an unknown object fails the same way here as it would on the real write
     * — a preview that 404s differently from its write is a mirror again.
     */
    async validateData(request: { object: string, data: any, mode?: 'insert' | 'update', context?: any }) {
        this.assertObjectRegistered(request.object);
        return this.engine.validate(request.object, request.data, {
            ...(request.mode !== undefined ? { mode: request.mode } : {}),
            ...(request.context !== undefined ? { context: request.context } : {}),
        });
    }

    async createData(request: { object: string, data: any, context?: any }) {
        this.assertObjectRegistered(request.object); // [#3770]
        // [#3043] Ingress-level static-`readonly` strip — a non-system caller
        // cannot seed a read-only column (e.g. `approval_status`) on create.
        const data = stripReadonlyForInsert(
            this.engine.registry?.getObject(request.object),
            request.data,
            request.context,
        );
        // [#3431] The #3043 ingress strip above is SILENT by contract; surface it
        // so a REST/API caller learns which supplied fields were dropped, symmetric
        // with `updateData`. The strip lives at THIS ingress (not the engine, which
        // is INSERT-readonly-exempt, #3413), so recover it by diffing the supplied
        // payload against the stripped one. The engine's `onFieldsDropped` is ALSO
        // wired below so a FUTURE insert-side engine strip surfaces automatically
        // through the same list instead of going silent.
        const dropped: DroppedFieldsEvent[] = [];
        const ingressDropped = diffDroppedFields(request.object, request.data, data, 'readonly');
        if (ingressDropped) dropped.push(ingressDropped);
        const opts: any = { onFieldsDropped: (e: DroppedFieldsEvent) => { dropped.push(e); } };
        if (request.context !== undefined) opts.context = request.context;
        const result = await this.engine.insert(request.object, data, opts);
        return {
            object: request.object,
            id: result.id,
            record: result,
            ...(dropped.length > 0 ? { droppedFields: dropped } : {}),
        };
    }

    /**
     * Clone a record — read the source, drop engine-owned columns, and
     * insert a fresh copy. Gated by the object's `enable.clone` capability
     * (default `true`; only an explicit `enable.clone === false` disables it).
     *
     * Shallow by design: it duplicates the record's own scalar/business field
     * values, not its related child records. The insert path re-stamps audit
     * columns, regenerates `autonumber` fields, and recomputes derived
     * (`formula`/`summary`) fields, so the copy is a valid new row rather than
     * a byte-identical twin. Caller-supplied `overrides` are applied last and
     * win over the copied values — the natural place to set a new `name`,
     * clear a unique field, or reset status before insert.
     */
    async cloneData(request: { object: string, id: string, overrides?: Record<string, any>, context?: any }) {
        // [#3770] This object-existence check used to be open-coded here and
        // was the ONLY one on the whole data plane; it is now the shared gate
        // every data entry point runs. Same error envelope as before.
        this.assertObjectRegistered(request.object);
        const schema: any = this.engine.registry?.getObject(request.object);
        // `enable.clone` defaults to true in the spec; treat an absent block /
        // absent flag as enabled and only block on an explicit `false`.
        if (schema?.enable?.clone === false) {
            const err: any = new Error(`Cloning is disabled for object '${request.object}'`);
            err.code = 'CLONE_DISABLED';
            err.status = 403;
            err.object = request.object;
            throw err;
        }

        const ctx = request.context;
        const ctxOpt = ctx !== undefined ? { context: ctx } : undefined;

        const source = await this.engine.findOne(
            request.object,
            { where: { id: request.id }, ...(ctxOpt as any) } as any,
        );
        if (!source) throw recordNotFoundError(request.object, request.id);

        // Copy the source, then strip the columns the engine owns so the insert
        // path re-derives them rather than carrying the source's values over.
        const data: Record<string, any> = { ...source };
        for (const f of CLONE_STRIP_FIELDS) delete data[f];
        const fields: Record<string, any> = schema?.fields || {};
        for (const [name, def] of Object.entries(fields)) {
            if (!def) continue;
            // Engine-/automation-owned values: injected system/audit columns,
            // engine-generated autonumbers, and computed formula/summary fields.
            if ((def as any).system === true
                || (def as any).type === 'autonumber'
                || (def as any).type === 'formula'
                || (def as any).type === 'summary') {
                delete data[name];
            }
        }
        // Caller overrides win (new name, cleared unique field, reset status…).
        if (request.overrides && typeof request.overrides === 'object') {
            Object.assign(data, request.overrides);
        }

        // [#3043] A clone is a create: a non-system caller must not carry over (or
        // override in) a read-only column — copying the source's `approval_status`
        // or forging one via `overrides` would mint an approved record. Strip them
        // so the insert re-derives their `defaultValue`, symmetric with createData.
        const insertData = stripReadonlyForInsert(schema, data, ctx);

        const result = await this.engine.insert(request.object, insertData, ctxOpt as any);
        return {
            object: request.object,
            id: result.id,
            sourceId: request.id,
            record: result,
        };
    }

    async updateData(request: { object: string, id: string, data: any, expectedVersion?: string, context?: any }) {
        this.assertObjectRegistered(request.object); // [#3770]
        // [#4435] ONE probe serves both gates.
        //
        // A PATCH of an id that names no row answered `200 { record: null }` —
        // the caller had to null-check a SUCCESS payload to discover its write
        // never landed, which is exactly what a client that PATCHes a
        // concurrently deleted record does not do. `getData` has always
        // answered 404 for the same id; the two verbs now agree.
        //
        // Existence is asked BEFORE the write rather than read off what comes
        // back: the engine's update returns the post-write READBACK, which is
        // also `null` when the row still exists but the write moved it out of
        // the caller's row scope (reassigning `owner_id` away from yourself
        // under an owner-scoped RLS policy). Reading that as "not found" would
        // answer 404 to a write that succeeded. So ask existence directly.
        //
        // The probe asks EXISTENCE, not visibility — see `probeRecord` for why
        // that distinction is load-bearing (it keeps this fix out of the RLS
        // model and keeps the #1994 by-id-write proof able to go red).
        //
        // OCC already had to read the same row for its `updated_at`, so the two
        // gates share this single read instead of issuing a probe each. Two
        // round-trips per PATCH would have been a performance regression no
        // gate reports, and the second read could even disagree with the first.
        const current = await this.probeRecord(request.object, request.id);
        if (!current) throw recordNotFoundError(request.object, request.id);
        // 404 wins over 409 when both could apply: OCC has always declined to
        // treat a missing record as a concurrency conflict, and "this record
        // does not exist" is the more specific answer.
        this.assertVersionOf(request.object, request.id, current, request.expectedVersion);
        const opts: any = { where: { id: request.id } };
        if (request.context !== undefined) opts.context = request.context;
        // [#3407/#3431] Capture the engine's LEGAL write strips (static `readonly`
        // (#2948) / TRUE `readonlyWhen` (#3042)) so a REST/API caller is not left
        // to field-by-field diff the returned row to discover a value never
        // landed. The write still succeeds — this only makes the strip observable,
        // mirroring service-automation's `update_record` wiring (#3413). A faulty
        // listener never breaks the write (the engine catches + logs).
        const dropped: DroppedFieldsEvent[] = [];
        opts.onFieldsDropped = (e: DroppedFieldsEvent) => { dropped.push(e); };
        // [#6479] At THIS ingress the row is the one the caller named — `request.id`,
        // the path `:id` — and nothing in the payload gets to move it.
        //
        // The engine's dispatch reads the PAYLOAD first: a truthy scalar `data.id`
        // outranks `options.where.id` (`engine-update-dispatch.ts`, case *"a SCALAR
        // data.id still wins over a scalar where.id"* — `expectId: 'rec_1'`). That
        // rule is correct and deliberate for a caller who hands ObjectQL a payload
        // and nothing else (#5748 / PR #5919, ruling A); it is a HOLE here, because
        // this caller has already named the row twice — in the URL and in `where` —
        // and the three gates around this line all judge THAT row:
        //
        //   probe   → `probeRecord(object, request.id)`      (existence, #4435)
        //   OCC     → `assertVersionOf(…, request.id, …)`    (If-Match / expectedVersion)
        //   receipt → `{ id: request.id, record: result }`
        //
        // Passing `request.data` verbatim let a body `{"id":"rec_2"}` on
        // `PATCH /data/task/rec_1` bind rec_2: probed rec_1, OCC-checked rec_1,
        // WROTE rec_2, and answered `id: rec_1` beside rec_2's readback. rec_2 was
        // never probed and never version-checked, so a client that GETs a record,
        // edits it and PUTs the whole body back — with the wrong row's id picked up
        // from a mis-clicked list or a stale refresh — performed a silent cross-row
        // write past its own `If-Match`.
        //
        // The fix is the shape the BULK ingress has always used for the same
        // question (`rest-server.ts`, batch `update`: `ql.update(op.object,
        // { ...data, id }, …)` — the operation's id after the spread, so it wins).
        // Two ingresses, one answer (#4550 / #4434). It changes no engine verdict:
        // the call still dispatches `by-id`, on the id `where` already carried.
        //
        // Deliberately NOT route B (400 on mismatch) or route C (ban `id` in
        // `UpdateDataRequestSchema`) — both were rejected by the 2026-08-08 triage
        // ruling on #6479; B installs a new rejection on a shipped API and C
        // changes the accepted request shape.
        //
        // A non-record payload is passed through UNTOUCHED (`undefined`, `null`, an
        // array): the engine reads `data.id` unguarded on purpose, so `undefined`
        // is its `TypeError`, and an ingress that answered a non-record payload
        // more kindly than the producer would be the very looseness
        // `engine-update-dispatch.ts` exists to prevent. Those shapes carry no
        // scalar `id` to outrank `where.id` either, so the invariant holds for them
        // through `opts.where` alone.
        const writeData = (
            request.data !== null
            && typeof request.data === 'object'
            && !Array.isArray(request.data)
        )
            ? { ...(request.data as Record<string, unknown>), id: request.id }
            : request.data;
        const result = await this.engine.update(request.object, writeData, opts);
        return {
            object: request.object,
            id: request.id,
            record: result,
            ...(dropped.length > 0 ? { droppedFields: dropped } : {}),
        };
    }

    async deleteData(request: { object: string, id: string, expectedVersion?: string, context?: any }) {
        this.assertObjectRegistered(request.object); // [#3770]
        await this.assertVersionMatch(request.object, request.id, request.expectedVersion);
        const opts: any = { where: { id: request.id } };
        if (request.context !== undefined) opts.context = request.context;
        const deleted = await this.engine.delete(request.object, opts);
        // [#4435] `success: true` used to be a LITERAL — the response said the
        // same thing for a real deletion, an already-deleted row and a typo'd
        // id, so nothing on the wire could tell them apart. The driver contract
        // (`IDataDriver.delete` — "True if deleted, false if not found") already
        // carries the answer; it was simply discarded here. Now it decides:
        // `false` is a 404, matching `getData` on the same id, and `success` on
        // the 200 finally means what it says.
        //
        // Read as `=== false` on purpose. That is the contract's own value for
        // "no row matched"; anything else — a driver returning the deleted row,
        // an `undefined` from an off-contract implementation — is not a
        // POSITIVE not-found signal, and inventing a 404 out of it would break
        // deletes against third-party drivers rather than report honestly.
        if (deleted === false) throw recordNotFoundError(request.object, request.id);
        return {
            object: request.object,
            id: request.id,
            success: true
        };
    }

    /**
     * [#4435] Does this row EXIST? A fact about the database — deliberately
     * NOT "may this caller see it".
     *
     * Read with a system context so no row-level policy narrows it. That is
     * load-bearing, and the first version of this fix got it wrong: probing
     * with the CALLER's context turns the existence gate into an authorization
     * gate, because a row the caller cannot read comes back `null` and the
     * PATCH answers 404. Two things break when it does.
     *
     * 1. It silently changes RLS semantics. Whether an unreadable row may be
     *    written by id is the #1994 pre-image check's decision, made inside
     *    `engine.update` where the write policy lives. A probe in front of it
     *    quietly adds a second, different rule — scope creep into the security
     *    model, from a bug fix about missing records.
     *
     * 2. It disarms a revert-provable security proof. `@proof: rls-by-id-write`
     *    (`packages/qa/dogfood/test/rls-fixture.dogfood.test.ts`, referenced by
     *    the `permission.rowLevelSecurity.using` liveness ledger entry) boots a
     *    fixture whose member can read nothing but has no write policy, and
     *    asserts the runner reports `rls-hole`. A caller-scoped probe 404s that
     *    PATCH, so the RED half goes green — and the gate can no longer prove
     *    it is able to go red. If the #1994 fix were ever reverted, this probe
     *    would MASK it. Accidentally hardening one path is not worth
     *    permanently blinding the gate that watches the whole class.
     *
     * So the probe answers existence only, and authorization stays exactly
     * where it was. The one behaviour this adds is the 404 the issue asked for:
     * an id that names no row at all.
     *
     * One place, because two gates need this row — the existence gate and OCC's
     * `updated_at` comparison — and issuing a probe each would put two
     * round-trips on every PATCH.
     */
    private async probeRecord(object: string, id: string): Promise<any> {
        return this.engine.findOne(object, { where: { id }, context: { isSystem: true } } as any);
    }

    /**
     * [#5088] The same existence gate {@link updateData} runs, for the BY-ID
     * BULK write faces — `updateManyData` and `batchData`'s `update` branch.
     *
     * #4435's "a write that touched zero rows must not report success" landed on
     * 2 of the 5 write faces in this file: `updateData` (probe) and
     * `runDeleteManyLoop` (`deleted === false`). The three bulk faces went
     * straight to `engine.update` / `engine.delete`, so a row naming no record
     * did not merely misreport — it entered the WRITE PIPELINE. Downstream that
     * is worse than a wrong status code: with no stored row to overlay, #4770's
     * record materialisation (stored ⊕ payload) produces a payload-only record,
     * a hook `condition` reading any untouched field finds it absent, and
     * #4775's unevaluable-condition abort fires. The row then failed
     * `INTERNAL_ERROR` with a diagnostic accusing a CORRECT hook of naming an
     * undeclared field. Three contracts disagreeing because one of them never
     * ran; the probe is what makes them agree again.
     *
     * Deliberately the same `probeRecord` the single-record path uses, for the
     * reason documented there: it asks EXISTENCE, not visibility, which keeps
     * this gate out of the RLS model (the by-id write policy stays #1994's
     * decision, inside `engine.update`) and keeps the `rls-by-id-write` proof
     * able to go red. And deliberately BEFORE the write, never inferred from a
     * null readback — `updateData`'s note explains why that inference would
     * answer 404 to a write that succeeded by moving the row out of the
     * caller's scope.
     *
     * Inside the atomic arm this still reads the batch's own uncommitted state:
     * `engine.transaction` runs its callback inside the ambient `txStore`
     * (ADR-0034), and `buildDriverOptions` falls back to that store when the
     * context carries no explicit `transaction`, so the probe rides the same
     * connection as the writes it guards.
     */
    private async assertRecordExists(object: string, id: string): Promise<void> {
        const current = await this.probeRecord(object, id);
        if (!current) throw recordNotFoundError(object, id);
    }

    /**
     * Optimistic Concurrency Control — the COMPARISON half, over a row the
     * caller has already read. Pure: it issues no query of its own, which is
     * what lets `updateData` run the gate on its existence probe's result
     * rather than re-reading the record (#4435).
     *
     * When the caller passes a non-empty `expectedVersion` token (typically the
     * `updated_at` value they read), a mismatch throws `ConcurrentUpdateError`,
     * which the REST layer maps to 409.
     *
     * Behaviour:
     *  - Empty/missing token → no check (opt-in semantics; existing callers
     *    that haven't yet adopted OCC are unaffected).
     *  - Record not found → no check. We intentionally do not treat "missing
     *    record" as a concurrency conflict; `updateData` has already answered
     *    404 by this point, and `deleteData` lets the driver report it.
     *  - Record has no `updated_at` field (timestamps disabled) → no check.
     *    Logging would be noisy here; OCC is opt-in and the absence of a
     *    version column is an explicit "this object doesn't support OCC"
     *    signal.
     */
    private assertVersionOf(
        object: string,
        id: string,
        current: any,
        expectedVersion: string | undefined,
    ): void {
        const expected = normaliseVersionToken(expectedVersion);
        if (!expected) return;
        if (!current) return;
        const currentVersion = normaliseVersionToken((current as any).updated_at);
        if (!currentVersion) return;
        if (currentVersion !== expected) {
            throw new ConcurrentUpdateError({
                currentVersion,
                currentRecord: current,
                message: `Record ${object}/${id} was modified by another user (current version ${currentVersion}, expected ${expected})`,
            });
        }
    }

    /**
     * OCC gate for `deleteData`, which — unlike `updateData` — needs no
     * existence probe of its own: the driver's own `delete` return reports
     * whether a row matched (#4435). So this still probes ONLY when the caller
     * actually opted into OCC, keeping a plain DELETE at zero extra reads.
     */
    private async assertVersionMatch(
        object: string,
        id: string,
        expectedVersion: string | undefined,
    ): Promise<void> {
        if (!normaliseVersionToken(expectedVersion)) return;
        const current = await this.probeRecord(object, id);
        this.assertVersionOf(object, id, current, expectedVersion);
    }

    // ==========================================
    // Global Search (M10.5)
    // ==========================================
    /**
     * Cross-object substring search across all registered objects that opt in
     * via `enable.searchable !== false` and `enable.apiEnabled !== false`.
     * Searches text-like fields (text/textarea/email/url/phone/markdown/html/string)
     * whose `searchable: true` flag is set, falling back to the object's
     * `displayNameField` (or `name`) when no fields are explicitly searchable.
     *
     * The query is split into whitespace-separated terms; each term must match
     * (case-insensitive LIKE) at least one searchable field. RBAC/RLS is
     * enforced by forwarding the caller's `context` to `engine.find` so users
     * only see records they are entitled to read.
     */
    async searchAll(request: {
        q: string;
        objects?: string[];
        limit?: number;
        perObject?: number;
        context?: any;
    }): Promise<{
        query: string;
        hits: Array<{
            object: string;
            id: string;
            title: string;
            snippet?: string;
            record: any;
        }>;
        totalObjects: number;
        totalHits: number;
        truncated: boolean;
    }> {
        const q = (request.q ?? '').trim();
        if (!q) {
            return { query: '', hits: [], totalObjects: 0, totalHits: 0, truncated: false };
        }

        const overallLimit = Math.max(1, Math.min(100, Number(request.limit ?? 20)));
        const perObject = Math.max(1, Math.min(25, Number(request.perObject ?? 5)));
        const objectsFilter = request.objects && request.objects.length
            ? new Set(request.objects)
            : null;

        // Tokenise: each token must match (LIKE %term%) at least one searchable field
        const terms = q.split(/\s+/).filter(Boolean).slice(0, 8);

        const allObjects = (this.engine as any).registry?.getAllObjects?.() ?? [];
        const hits: Array<{ object: string; id: string; title: string; snippet?: string; record: any }> = [];
        let objectsScanned = 0;

        for (const obj of allObjects) {
            if (hits.length >= overallLimit) break;
            if (!obj?.name) continue;
            if (objectsFilter && !objectsFilter.has(obj.name)) continue;

            // Skip platform/system tables and opt-outs
            const enable = obj.enable ?? {};
            if (enable.searchable === false) continue;
            if (enable.apiEnabled === false) continue;
            // Skip noisy system tables by name prefix
            if (obj.name.startsWith('sys_audit_log')
                || obj.name.startsWith('sys_activity')
                || obj.name.startsWith('sys_session')
                || obj.name.startsWith('sys_presence')
                || obj.name.startsWith('sys_metadata')
                || obj.name.startsWith('sys_account')) {
                continue;
            }

            const fieldsRaw = obj.fields;
            const fields: Array<{ name: string; type: string; searchable?: boolean }> =
                Array.isArray(fieldsRaw)
                    ? fieldsRaw
                    : (fieldsRaw && typeof fieldsRaw === 'object'
                        ? Object.entries(fieldsRaw).map(([name, f]: [string, any]) => ({ name, ...(f || {}) }))
                        : []);
            const TEXT_TYPES = new Set(['text', 'textarea', 'string', 'email', 'url', 'phone', 'markdown', 'html']);
            const fieldByName = new Map(fields.map(f => [f.name, f]));
            const hasField = (n: string) => fieldByName.has(n);
            // Resolve title for a record using titleFormat → displayNameField →
            // common conventional fields → id. titleFormat supports simple
            // `{field}` placeholders (the `template` dialect); unresolved
            // placeholders fall through to the next strategy.
            const titleFormatSource = (obj.titleFormat && (obj.titleFormat.source || obj.titleFormat))
                || undefined;
            const renderTitle = (row: any): string => {
                if (typeof titleFormatSource === 'string') {
                    let allResolved = true;
                    const rendered = titleFormatSource.replace(/\{\{?\s*([a-zA-Z0-9_.]+)\s*\}?\}/g, (_m, key) => {
                        const v = row[key];
                        if (v == null || v === '') { allResolved = false; return ''; }
                        return String(v);
                    }).trim();
                    if (rendered && allResolved) return rendered;
                    if (rendered) return rendered.replace(/\s+-\s+$/, '').replace(/^\s+-\s+/, '').trim() || row.id;
                }
                const candidates = [
                    obj.displayNameField,
                    'name', 'full_name', 'title', 'subject', 'label', 'company',
                ].filter((c): c is string => typeof c === 'string' && hasField(c));
                for (const c of candidates) {
                    const v = row[c];
                    if (v != null && String(v).trim()) return String(v);
                }
                const fn = row.first_name, ln = row.last_name;
                if (fn || ln) return `${fn ?? ''} ${ln ?? ''}`.trim();
                return String(row.id);
            };

            const titleFieldName = obj.displayNameField
                || (hasField('name') ? 'name' : undefined)
                || (hasField('title') ? 'title' : undefined)
                || fields.find(f => TEXT_TYPES.has(f.type))?.name;

            let searchableFields = fields
                .filter(f => f && TEXT_TYPES.has(f.type) && f.searchable === true)
                .map(f => f.name as string);

            // Fallback: if no field is explicitly searchable, scan the title field
            if (searchableFields.length === 0 && titleFieldName) {
                searchableFields = [titleFieldName];
            }
            if (searchableFields.length === 0) continue;

            objectsScanned++;

            // Build AND-of-OR filter: every term must hit at least one field.
            // [#7641] Case-insensitive substring matching is `$icontains`, NOT
            // `$contains` — the comment this replaced asserted the opposite and
            // was the same declared≠enforced defect as `search-filter.ts`'s
            // (`$contains` is contractually case-SENSITIVE, #4706 Q2 = A). The
            // global-search palette is a SECOND producer of search clauses and
            // was wrong the same way; `search.global-search`'s knownGaps already
            // recorded it as this issue's to fix. Neither operator's semantics
            // changed — only which one the palette compiles to.
            const andClauses = terms.map(term => ({
                $or: searchableFields.map(f => ({ [f]: { $icontains: term } })),
            }));
            const where = andClauses.length === 1 ? andClauses[0] : { $and: andClauses };

            try {
                // `order`, NOT `direction` — see the audit-history query above.
                // Ascending here returned the STALEST `perObject` matches and
                // truncated away the recently-edited records a searcher is most
                // likely to want (#4674). Typed rather than `any` so the
                // contract rejects the wrong key at the call site.
                const opts: EngineQueryOptionsParsed = {
                    where,
                    limit: perObject,
                    orderBy: [{ field: 'updated_at', order: 'desc' }],
                };
                if (request.context !== undefined) opts.context = request.context;

                const rows = await this.engine.find(obj.name, opts);
                for (const row of rows || []) {
                    if (hits.length >= overallLimit) break;
                    const title = renderTitle(row);
                    // Build snippet from first searchable field that contains a term
                    let snippet: string | undefined;
                    for (const f of searchableFields) {
                        const v = row[f];
                        if (typeof v === 'string' && v) {
                            const lc = v.toLowerCase();
                            const idx = terms.map(t => lc.indexOf(t.toLowerCase())).find(i => i >= 0);
                            if (idx != null && idx >= 0) {
                                const start = Math.max(0, idx - 30);
                                const end = Math.min(v.length, idx + 90);
                                snippet = (start > 0 ? '…' : '') + v.slice(start, end) + (end < v.length ? '…' : '');
                                break;
                            }
                        }
                    }
                    hits.push({
                        object: obj.name,
                        id: row.id,
                        title,
                        snippet,
                        record: row,
                    });
                }
            } catch {
                // RBAC denial or driver hiccup — skip silently per object
                continue;
            }
        }

        return {
            query: q,
            hits,
            totalObjects: objectsScanned,
            totalHits: hits.length,
            truncated: hits.length >= overallLimit,
        };
    }

    // ==========================================
    // Metadata Caching
    // ==========================================

    async getMetaItemCached(request: { type: string, name: string, cacheRequest?: MetadataCacheRequest, locale?: string }): Promise<MetadataCacheResponse> {
        // #4432 — CANONICAL TYPE KEY. See {@link canonicalMetaType}. The ETag
        // and the cache entry are keyed by type, so two spellings would cache
        // the same item twice and invalidate only one of them.
        request = canonicalizeMetaRequestType(request);
        try {
            // Delegate to getMetaItem so the customization-overlay read order
            // (sys_metadata → registry → MetadataService) is honoured here too
            // (ADR-0005). Without this, cached reads silently bypass overlays.
            const result = await this.getMetaItem({ type: request.type, name: request.name });
            const item = (result as any)?.item;

            if (!item) {
                // [#5532] Structured: 404 + the catalog's `RESOURCE_NOT_FOUND`.
                // Reaching here now means a real miss — `getMetaItem` throws
                // 503 rather than answering `undefined` when the store could
                // not be read (see
                // {@link rethrowUnlessMetadataStoreUnprovisioned}) — so the
                // 404 is a claim this layer is finally entitled to make.
                //
                // [#5840] That entitlement was only three-quarters earned when
                // it was written: it held for the `sys_metadata` overlay read,
                // whose failure arrives as a throw, and NOT for the
                // MetadataService read, whose failure `MetadataManager`
                // warn-logs and skips — so a loader outage still reached this
                // line as a plain missing `item` and was answered 404. Both
                // halves now refuse to guess (see
                // {@link readItemFromMetadataService}).
                throw metadataItemNotFoundError(request.type, request.name);
            }

            // Calculate ETag (simple hash of the stringified metadata).
            //
            // The ETag MUST vary by locale. The REST layer translates the
            // response body *after* this validator check, so an ETag computed
            // only from the (untranslated) content would let a language switch
            // match the prior `If-None-Match` and return `304 Not Modified`
            // carrying a stale-locale body — labels/headers stuck in the old
            // language until a hard refresh (issue #1319). Folding the resolved
            // locale into the hash gives each locale a distinct validator.
            const content = JSON.stringify(item);
            const hash = simpleHash(request.locale ? `${request.locale}\u0000${content}` : content);
            const etag = { value: hash, weak: false };

            // Check If-None-Match header
            if (request.cacheRequest?.ifNoneMatch) {
                const clientEtag = request.cacheRequest.ifNoneMatch.replace(/^"(.*)"$/, '$1').replace(/^W\/"(.*)"$/, '$1');
                if (clientEtag === hash) {
                    // Return 304 Not Modified
                    return {
                        notModified: true,
                        etag,
                    };
                }
            }

            // Return full metadata with cache headers
            return {
                data: item,
                etag,
                lastModified: new Date().toISOString(),
                cacheControl: {
                    // Metadata is invalidated by publish, so freshness must be
                    // gated by the ETag validator — not a TTL. `no-cache` lets
                    // clients store the body but forces an `If-None-Match`
                    // revalidation on every use: a cheap 304 when unchanged,
                    // fresh fields the instant a publish bumps the ETag. The old
                    // `max-age=3600` pinned the schema for up to an hour, so the
                    // AI-build "New" form kept rendering pre-publish fields until
                    // the TTL lapsed (no revalidation in between). `private` also
                    // keeps per-tenant metadata out of shared CDN/proxy caches.
                    directives: ['private', 'no-cache'],
                },
                notModified: false,
            };
        } catch (error: any) {
            throw error;
        }
    }

    // ==========================================
    // Batch Operations
    // ==========================================

    async batchData(request: { object: string, request: BatchUpdateRequest, context?: any }): Promise<BatchUpdateResponse> {
        const { object, request: batchReq, context } = request;
        this.assertObjectRegistered(object); // [#3770]
        const { operation, records, options } = batchReq;

        // [#3043] The batch endpoint is an external ingress: strip forged
        // read-only columns on create. [#3455] It DOES resolve an execution
        // context (threaded by REST); thread it to every engine call so RLS/FLS
        // and `readonlyWhen` run under the caller, and pass it to the strip so a
        // system caller is correctly exempt (the pre-#3455 code hard-coded the
        // strip context to `undefined`, treating every batch create as non-system).
        const batchSchema = this.engine.registry?.getObject(object);

        // ADR-0119 D4 — `atomic` is REAL or REFUSED, never silent best-effort.
        // This flag used to only `break` the loop: every write before the
        // failure stayed COMMITTED while the response called itself atomic and
        // reported those rows `success: true`. Same class as #4346 — a
        // write-path guarantee declared but not enforced, silent and
        // destructive exactly when it matters.
        //
        // Opt-in is an explicit `=== true`. `BatchOptionsSchema` declared
        // `.default(true)` while no enforcement site ever delivered atomicity
        // (REST forwards the original body, so the parsed default never reached
        // this loop), so treating "absent" as atomic would silently flip every
        // existing caller's failure semantics. The declaration is aligned to
        // the enforced value instead; see the schema's note.
        if (options?.atomic === true) {
            return await this.runAtomicBatchData({ object, operation, records, options, batchSchema, context });
        }

        const outcome = await this.runBatchDataLoop({ object, operation, records, options, batchSchema, context, atomic: false });
        return this.buildBatchDataResponse(operation, records, options, outcome);
    }

    /**
     * The atomic arm of {@link batchData} (ADR-0119 D4): the whole batch runs
     * inside ONE `engine.transaction()`, so the first failure rolls back every
     * prior write — and the response says so, rather than reporting rows that
     * no longer exist as successes.
     */
    private async runAtomicBatchData(args: {
        object: string;
        operation: BatchUpdateRequest['operation'];
        records: BatchUpdateRequest['records'];
        options: BatchUpdateRequest['options'];
        batchSchema: any;
        context: any;
    }): Promise<BatchUpdateResponse> {
        const { object, operation, records, options, batchSchema, context } = args;
        return await this.runAtomicBatch({
            object,
            context,
            runLoop: (trxCtx) => this.runBatchDataLoop({ object, operation, records, options, batchSchema, context: trxCtx, atomic: true }),
            onCommit: (outcome) => this.buildBatchDataResponse(operation, records, options, outcome),
            onRollback: (outcome) => this.buildRolledBackBatchResponse(operation, records, outcome),
        });
    }

    /**
     * The atomic arm, shared by every bulk-write surface on this protocol
     * (#4620): `batchData` (ADR-0119 D4), `updateManyData` and
     * `deleteManyData`.
     *
     * D4 fixed `batchData` alone, and its two siblings in this file carried the
     * same class of defect — `deleteManyData` `break`-ed the loop and left every
     * prior delete committed under a response that called itself atomic (worse
     * than the `batchData` case: a partial delete has no natural undo), while
     * `updateManyData` never read `atomic` at all. Fixed by giving all three ONE
     * runner rather than a third and fourth copy of transaction handling —
     * copies are exactly how the next sibling drifts back into a lie.
     *
     * Each caller supplies only what differs: the per-record loop, and the two
     * response builders. Everything that makes `atomic` a guarantee — the
     * fail-closed capability gate, the single `engine.transaction()`, the abort
     * sentinel, the zero-successes rollback response — lives here, once.
     */
    private async runAtomicBatch(args: {
        object: string;
        context: any;
        runLoop: (trxCtx: any) => Promise<BatchDataLoopOutcome>;
        onCommit: (outcome: BatchDataLoopOutcome) => BatchUpdateResponse;
        onRollback: (outcome: BatchDataLoopOutcome) => BatchUpdateResponse;
    }): Promise<BatchUpdateResponse> {
        const { object, context, runLoop, onCommit, onRollback } = args;

        // Two-level probe, shared with the ADR-0119 D2 migration-journal runner
        // as `engineCanRollBack` (#4617). `engine.transaction()` runs the
        // callback with NO transaction and NO rollback when the default driver
        // lacks `beginTransaction` — a declared caveat of the contract member
        // (ADR-0119 D1), and one that would turn "atomic" back into a lie
        // precisely where it matters. So where the driver registry is
        // inspectable, the driver is checked too; where it is not (test
        // doubles), the engine-level probe is all there is.
        //
        // Shared rather than restated: this and the runner's gate were the same
        // condition written twice, and two copies of "can this runtime actually
        // roll back?" drift by one clause and leave one caller believing it has
        // atomicity it does not have.
        const engineTx = engineCanRollBack(this.engine)
            ? this.engine.transaction.bind(this.engine)
            : undefined;

        if (!engineTx) {
            // REFUSE, do not degrade. A caller that asked for atomicity is
            // exactly the caller who must not silently receive best-effort —
            // silent degradation is how this flag came to lie in the first
            // place. Mirrors the cross-object /batch route's refusal; the
            // condition is generic, so it uses the standard error catalog
            // rather than registering an ADR-0112 synonym.
            const err: any = new Error(
                `Atomic batch on '${object}' requires engine transaction support; this runtime cannot roll back. ` +
                `Retry without options.atomic, or probe capabilities.transactionalBatch on /discovery first.`,
            );
            err.status = 501;
            err.code = 'NOT_IMPLEMENTED';
            throw err;
        }

        // Identity-checked sentinel: aborting the transaction is how a rollback
        // is requested, but the abort itself is not an error to propagate.
        const ABORT = new Error('atomic batch aborted — rolled back');
        let aborted: BatchDataLoopOutcome | undefined;
        try {
            return await engineTx(async (trxCtx: any) => {
                const outcome = await runLoop(trxCtx);
                if (outcome.failed > 0) {
                    aborted = outcome;
                    throw ABORT;
                }
                return onCommit(outcome);
            }, context);
        } catch (err) {
            if (err === ABORT && aborted) {
                return onRollback(aborted);
            }
            throw err;
        }
    }

    /**
     * The per-record loop, shared by both arms of {@link batchData} (ADR-0119
     * D4) so atomic and non-atomic cannot drift apart. `atomic` changes exactly
     * one thing: it aborts on the first failure regardless of
     * `continueOnError` (whose own contract text already scopes it to
     * `atomic=false`). It used to change a second — forbidding the upsert
     * fallback insert, whose failure inside an aborted transaction could only
     * mask the real cause — until #5099 removed that fallback from BOTH arms:
     * the upsert fork is decided by an existence probe before any write, so a
     * fallback insert could only bury a real update failure under the
     * duplicate-key error of inserting a row just proven to exist.
     */
    private async runBatchDataLoop(args: {
        object: string;
        operation: BatchUpdateRequest['operation'];
        records: BatchUpdateRequest['records'];
        options: BatchUpdateRequest['options'];
        batchSchema: any;
        context: any;
        atomic: boolean;
    }): Promise<BatchDataLoopOutcome> {
        const { object, operation, records, options, batchSchema, context, atomic } = args;
        const results: BatchDataRowResult[] = [];
        let succeeded = 0;
        let failed = 0;

        // Spread form for options objects that already carry `where`/`onFieldsDropped`
        // (`{}` spread is a safe no-op); arg form for `insert`, whose whole options
        // arg is `undefined` when there is no context — exact parity with createData.
        const ctxOpt = context !== undefined ? { context } : {};
        const insertCtx = context !== undefined ? { context } : undefined;

        // [#4793] `index` is the row's position in the REQUEST array — the
        // correlation a caller needs for failure rows that carry no id.
        for (const [index, record] of records.entries()) {
            try {
                switch (operation) {
                    case 'create': {
                        // [#3455] Diff the supplied row against the stripped one so a
                        // batch-create caller sees the same `droppedFields` a
                        // single-write create surfaces (#3431).
                        const stripped = stripReadonlyForInsert(batchSchema, record.data || record, context);
                        const ev = diffDroppedFields(object, record.data || record, stripped, 'readonly');
                        const created = await this.engine.insert(object, stripped, insertCtx as any);
                        results.push({ id: created.id, success: true, data: created, index, ...(ev ? { droppedFields: [ev] } : {}) });
                        succeeded++;
                        break;
                    }
                    case 'update': {
                        if (!record.id) throw rowRequiredIdError('update');
                        // [#5088] Same existence gate as `updateMany` and the
                        // single-record PATCH — a row naming no record must not
                        // enter the write pipeline, where #4770's stored ⊕
                        // payload merge has no stored side and #4775 blames the
                        // hook for the resulting gap.
                        await this.assertRecordExists(object, record.id);
                        // [#3455] Collect the engine's LEGAL write strips per row.
                        const dropped: DroppedFieldsEvent[] = [];
                        const updated = await this.engine.update(object, record.data || {}, { where: { id: record.id }, onFieldsDropped: (e: DroppedFieldsEvent) => { dropped.push(e); }, ...ctxOpt } as any);
                        results.push({ id: record.id, success: true, data: updated, index, ...(dropped.length > 0 ? { droppedFields: dropped } : {}) });
                        succeeded++;
                        break;
                    }
                    case 'upsert': {
                        if (record.id) {
                            // [#5099] The update-or-insert fork asks EXISTENCE,
                            // not visibility. `findOne` under the CALLER's
                            // context is the read RLS/sharing narrows (#3455),
                            // so an existing row outside the caller's scope
                            // answered null, took the insert arm, and either
                            // duplicate-keyed — an authorization/update
                            // scenario reported as a key collision — or, on a
                            // store without a unique id constraint, wrote a
                            // second row. Same probe as the update branch above
                            // and the single-record path (#4620): it asks the
                            // database a fact, and whether the caller may WRITE
                            // the row it proves stays #1994's decision inside
                            // `engine.update`.
                            //
                            // The old fallback (update threw → blind insert)
                            // is gone with the fork's visibility read: with
                            // existence decided BEFORE the write, a fallback
                            // insert could only bury a real update failure
                            // under the duplicate-key error of inserting a row
                            // just proven to exist — the same masking ADR-0119
                            // D4 forbade inside the atomic arm.
                            const existing = await this.probeRecord(object, record.id);
                            if (existing) {
                                const dropped: DroppedFieldsEvent[] = [];
                                const updated = await this.engine.update(object, record.data || {}, { where: { id: record.id }, onFieldsDropped: (e: DroppedFieldsEvent) => { dropped.push(e); }, ...ctxOpt } as any);
                                results.push({ id: record.id, success: true, data: updated, index, ...(dropped.length > 0 ? { droppedFields: dropped } : {}) });
                            } else {
                                const created = await this.engine.insert(object, { id: record.id, ...(record.data || {}) }, insertCtx as any);
                                results.push({ id: created.id, success: true, data: created, index });
                            }
                        } else {
                            const created = await this.engine.insert(object, record.data || record, insertCtx as any);
                            results.push({ id: created.id, success: true, data: created, index });
                        }
                        succeeded++;
                        break;
                    }
                    case 'delete': {
                        if (!record.id) throw rowRequiredIdError('delete');
                        // [#5088] `deleteManyData` learned this in #4435; this
                        // branch — the OTHER by-id bulk delete, ten lines from
                        // it — kept discarding the driver's return and pushing
                        // `success: true` unconditionally, so a batch of typo'd
                        // ids reported every one of them deleted. Same `=== false`
                        // reading as both fixed faces: the contract's positive
                        // not-found value (`IDataDriver.delete`), never an
                        // inference from a falsy return, so a third-party driver
                        // that answers with the deleted row is not turned into a
                        // spurious 404.
                        const deleted = await this.engine.delete(object, { where: { id: record.id }, ...ctxOpt } as any);
                        if (deleted === false) throw recordNotFoundError(object, record.id);
                        results.push({ id: record.id, success: true, index });
                        succeeded++;
                        break;
                    }
                    default:
                        results.push({ id: record.id, success: false, index, errors: [{ code: 'VALIDATION_FAILED', message: `Unknown operation: ${operation}`, httpStatus: 400 }] });
                        failed++;
                }
            } catch (err: any) {
                results.push({ id: record.id, success: false, index, errors: [toRowApiError(err)] });
                failed++;
                if (atomic) {
                    // Abort on the first failure; the caller rolls back. Atomic
                    // outranks `continueOnError` — there is nothing to continue
                    // toward when every write so far is about to be undone.
                    break;
                }
                if (!options?.continueOnError) {
                    break;
                }
            }
        }

        return { results, succeeded, failed };
    }

    /**
     * [#7539] Reconciles a STOPPED loop's outcome with the request it answers,
     * shared by the ordinary (committed) response of all three bulk-write
     * surfaces.
     *
     * Without `continueOnError` a failure ends the run — the declared default
     * (`BatchOptionsSchema.continueOnError`: *"If true (and atomic=false),
     * continue processing remaining records after errors"*), and ADR-0119 D4
     * left it deliberately untouched ("non-atomic batches behave exactly as
     * before"). Stopping was never the bug. Reporting the stop was: the three
     * builders read `total` from the REQUEST (`records.length`) while `results`,
     * `succeeded` and `failed` came from a loop that had stopped early, so an
     * un-attempted record was invisible **twice over** — it produced no
     * `results[]` entry and was counted in neither bucket. The only trace of it
     * was `succeeded + failed != total`: an arithmetic mismatch no client
     * should have to notice, let alone interpret.
     *
     * So every record gets a row saying what happened to it, and the counters
     * add up. The classification is the one the ATOMIC arm has emitted since
     * #4793 — `NOT_ATTEMPTED` as `errors[0].code`, registered in the ADR-0112
     * ledger, the message carrying the human-readable cause and the causal row
     * index — because "never ran" means the same thing to a client whether the
     * batch stopped to roll back or stopped because it was told to. The message
     * additionally names `continueOnError`, since on THIS arm the caller's next
     * action is a flag rather than a fixed row.
     *
     * `failed` therefore counts every row that is not a success, exactly as
     * {@link buildRolledBackBatchResponse} already does, keeping ONE reading of
     * the envelope across both arms: `succeeded` and `failed` partition
     * `results`, and `succeeded + failed === total === results.length`. A new
     * `notAttempted` envelope field would have bought the same information at
     * the price of two different meanings for `failed` on two arms of one
     * endpoint — which is the kind of drift that separated the rows from the
     * counters here in the first place.
     *
     * A no-op when the loop ran to completion: every all-success path, every
     * `continueOnError` run, and the atomic arm's `onCommit`, which by
     * construction only ever sees `failed === 0`.
     */
    private reconcileStoppedBatch(
        records: ReadonlyArray<{ id?: string }>,
        outcome: BatchDataLoopOutcome,
    ): BatchDataLoopOutcome {
        if (outcome.results.length >= records.length) return outcome;

        const causeIndex = outcome.results.findIndex(r => !r.success);
        const cause = causeIndex >= 0 ? outcome.results[causeIndex]?.errors?.[0]?.message : undefined;

        const results = outcome.results.slice();
        for (let index = results.length; index < records.length; index++) {
            results.push({
                // Echoed back so a caller can retry exactly the skipped rows.
                id: records[index]?.id,
                success: false,
                index,
                errors: [{
                    code: 'NOT_ATTEMPTED' as const,
                    message: `record ${causeIndex} failed — ${cause ?? 'unknown error'}; the batch stopped there. `
                        + 'Set options.continueOnError to process the remaining records.',
                }],
            });
        }

        // Every padded row is a non-success, so this stays a PARTITION of
        // `results` rather than a second tally free to drift from it.
        return { results, succeeded: outcome.succeeded, failed: results.length - outcome.succeeded };
    }

    /** The ordinary (committed) batch response — every row reports what it did. */
    private buildBatchDataResponse(
        operation: BatchUpdateRequest['operation'],
        records: BatchUpdateRequest['records'],
        options: BatchUpdateRequest['options'],
        outcome: BatchDataLoopOutcome,
    ): BatchUpdateResponse {
        const { results, succeeded, failed } = this.reconcileStoppedBatch(records, outcome); // [#7539]
        return {
            success: failed === 0,
            operation,
            total: records.length,
            succeeded,
            failed,
            // [#3455] `returnRecords: false` drops the record payload (`data`)
            // but KEEPS `errors`, `index` and `droppedFields` — the last is a
            // small write-observability warning, not the record data the flag
            // suppresses.
            results: options?.returnRecords !== false ? results : results.map(r => ({ id: r.id, success: r.success, index: r.index, ...(r.errors ? { errors: r.errors } : {}), ...(r.droppedFields ? { droppedFields: r.droppedFields } : {}) })),
        } as BatchUpdateResponse;
    }

    /**
     * The response for an atomic batch that rolled back (ADR-0119 D4).
     *
     * Nothing persisted, so nothing may report success — the old code's real
     * damage was not the missing transaction alone but telling the caller that
     * rows it had just undone were `success: true`. Rows are classified from
     * what actually happened: a row that had succeeded is now `ROLLED_BACK`,
     * the row that failed keeps its causal error, and rows the abort never
     * reached are `NOT_ATTEMPTED`. The classification is STRUCTURED (#4793):
     * `ROLLED_BACK` / `NOT_ATTEMPTED` are `errors[0].code` values registered in
     * the ERROR_CODE_LEDGER, so a client branches on the code — the message
     * carries only the human-readable cause and the causal row's index, never
     * a prefix convention to regex. `returnRecords` is moot — no record exists
     * to return, and a `droppedFields` warning about a reverted write would
     * only mislead.
     */
    private buildRolledBackBatchResponse(
        operation: BatchUpdateRequest['operation'],
        // Only `length` and `id` are read, so `updateManyData`'s rows and the
        // id list `deleteManyData` rolls back reuse this verbatim (#4620) —
        // the marking a client reconciles against must be one implementation,
        // not three that agree today.
        records: ReadonlyArray<{ id?: string }>,
        outcome: BatchDataLoopOutcome,
    ): BatchUpdateResponse {
        const attempted = outcome.results;
        const causeIndex = attempted.findIndex(r => !r.success);
        const cause = causeIndex >= 0 ? attempted[causeIndex]?.errors?.[0]?.message : undefined;

        const results: BatchDataRowResult[] = records.map((record, index) => {
            const attempt = attempted[index];
            if (!attempt) {
                return {
                    id: record.id, success: false, index,
                    errors: [{ code: 'NOT_ATTEMPTED' as const, message: `atomic batch aborted by record ${causeIndex}` }],
                };
            }
            if (attempt.success) {
                return {
                    id: attempt.id ?? record.id, success: false, index,
                    errors: [{ code: 'ROLLED_BACK' as const, message: `record ${causeIndex} failed — ${cause ?? 'unknown error'}` }],
                };
            }
            return { id: attempt.id ?? record.id, success: false, index, errors: attempt.errors };
        });

        return {
            success: false,
            operation,
            total: records.length,
            succeeded: 0,
            failed: records.length,
            results,
        } as BatchUpdateResponse;
    }

    async createManyData(request: { object: string, records: any[], context?: any }): Promise<any> {
        this.assertObjectRegistered(request.object); // [#3770]
        // [#3043] Ingress-level static-`readonly` strip (per row) — mirrors
        // createData for the bulk-create / import surface.
        const rows = stripReadonlyForInsert(
            this.engine.registry?.getObject(request.object),
            request.records,
            request.context,
        );
        // [#3455] Surface the #3043 ingress strip, symmetric with single-write
        // createData. Diff each supplied row against its stripped form, then
        // AGGREGATE — the `{ records, count }` response has no per-row slot, so
        // a union is the only representable view here. (It used to be lossless
        // as well, the ingress strip being static-`readonly` and therefore
        // schema-uniform; the engine strip #5503 adds is per-row, so the union
        // now genuinely aggregates. `insertManyData`, which HAS a per-row slot,
        // keeps row precision for both sources.)
        const dropped: DroppedFieldsEvent[] = [];
        if (Array.isArray(request.records)) {
            for (let i = 0; i < request.records.length; i++) {
                const ev = diffDroppedFields(request.object, request.records[i], Array.isArray(rows) ? rows[i] : rows, 'readonly');
                if (ev) dropped.push(ev);
            }
        }
        // [#5503] The engine gained an INSERT-side strip of its own (runtime-owned
        // `autonumber` values a non-system caller supplied). Forward the listener
        // here as `createData` already does, so a bulk create / import learns
        // which record numbers were refused instead of only the server log seeing
        // it. Merging AFTER the write is what lets both sources land in one list.
        const opts: any = { onFieldsDropped: (e: DroppedFieldsEvent) => { dropped.push(e); } };
        if (request.context !== undefined) opts.context = request.context;
        const records = await this.engine.insert(request.object, rows, opts);
        const merged = mergeDroppedFieldEvents(dropped);
        return {
            object: request.object,
            records,
            count: records.length,
            ...(merged.length > 0 ? { droppedFields: merged } : {}),
        };
    }

    /**
     * Partial-success bulk create (framework#3172): like createManyData, but a
     * row that fails validation is a per-row verdict instead of aborting the
     * whole batch — the import runner uses this so a bad row never forces a
     * degradation re-run of the good rows' beforeInsert hooks. Requires an
     * engine with `insertMany` (ObjectQL has it); absent that, callers should
     * fall back to createManyData.
     */
    async insertManyData(request: { object: string, records: any[], context?: any }): Promise<{ object: string; outcomes: Array<{ ok: boolean; record?: any; error?: unknown; droppedFields?: DroppedFieldsEvent[] }> }> {
        this.assertObjectRegistered(request.object); // [#3770]
        const engineInsertMany = (this.engine as any)?.insertMany;
        if (typeof engineInsertMany !== 'function') {
            throw new Error('insertManyData requires an engine with insertMany (framework#3172)');
        }
        // Same ingress strip as createManyData (#3043).
        const rows = stripReadonlyForInsert(
            this.engine.registry?.getObject(request.object),
            request.records,
            request.context,
        );
        // [#3455] Per-row #3043 ingress-strip observability. Unlike createManyData,
        // this partial-success path HAS a per-row slot (`outcomes[i]`), so keep
        // row precision: `stripReadonlyForInsert` maps 1:1 in order, so the i-th
        // supplied row diffs against the i-th stripped row and rides the i-th
        // outcome. Computed BEFORE the insert so a per-row engine failure never
        // hides which fields the ingress had already dropped.
        const rowsArr = Array.isArray(rows) ? rows : [rows];
        const perRowDropped: Array<DroppedFieldsEvent | null> = Array.isArray(request.records)
            ? request.records.map((rec, i) => diffDroppedFields(request.object, rec, rowsArr[i], 'readonly'))
            : [];
        // [#5503] The ENGINE now strips too (runtime-owned `autonumber` values a
        // non-system caller supplied), and its `onFieldsDropped` event is the
        // UNION over the batch — the listener signature carries no row index. Row
        // precision is recoverable without one: the engine strip only removes
        // keys the ROW ITSELF supplied, so a dropped name belongs to exactly the
        // rows whose supplied payload carried it. Without this the import
        // surface (which prefers this partial-success path over createManyData)
        // would drop record numbers with nothing but a server log to show for it.
        const engineDropped = new Set<string>();
        const opts: any = { onFieldsDropped: (e: DroppedFieldsEvent) => { for (const f of e.fields) engineDropped.add(f); } };
        if (request.context !== undefined) opts.context = request.context;
        const outcomes: Array<{ ok: boolean; record?: any; error?: unknown; droppedFields?: DroppedFieldsEvent[] }> = await engineInsertMany.call(
            this.engine,
            request.object,
            rows,
            opts,
        );
        if (Array.isArray(outcomes)) {
            for (let i = 0; i < outcomes.length; i++) {
                if (!outcomes[i]) continue;
                const supplied = (request.records?.[i] ?? {}) as Record<string, unknown>;
                const mine = [...engineDropped].filter((f) => f in supplied);
                const events: DroppedFieldsEvent[] = [];
                if (perRowDropped[i]) events.push(perRowDropped[i]!);
                if (mine.length > 0) events.push({ object: request.object, fields: mine, reason: 'readonly' });
                const merged = mergeDroppedFieldEvents(events);
                if (merged.length > 0) outcomes[i].droppedFields = merged;
            }
        }
        return { object: request.object, outcomes };
    }
    
    async updateManyData(request: UpdateManyDataRequest & { context?: any }): Promise<BatchUpdateResponse> {
        const { object, records, options, context } = request;
        this.assertObjectRegistered(object); // [#3770]

        // [#4620] `atomic` used not to appear ANYWHERE in this method: the
        // option was accepted, declared in `BatchOptionsSchema` with a contract
        // that promises all-or-nothing, and never read — a caller asking for
        // atomicity silently got best-effort with no signal at all. Same
        // enforcement shape as `batchData` (ADR-0119 D4), same runner, so the
        // three bulk-write surfaces cannot drift apart again. `=== true` is the
        // deliberate opt-in from D4: absent/false keeps today's semantics
        // exactly.
        if (options?.atomic === true) {
            return await this.runAtomicBatch({
                object,
                context,
                runLoop: (trxCtx) => this.runUpdateManyLoop({ object, records, options, context: trxCtx, atomic: true }),
                onCommit: (outcome) => this.buildUpdateManyResponse(records, outcome),
                onRollback: (outcome) => this.buildRolledBackBatchResponse('update', records, outcome),
            });
        }

        const outcome = await this.runUpdateManyLoop({ object, records, options, context, atomic: false });
        return this.buildUpdateManyResponse(records, outcome);
    }

    /**
     * The per-record loop of {@link updateManyData}, shared by both arms
     * (#4620) so atomic and non-atomic cannot drift apart. `atomic` changes
     * exactly one thing: it aborts on the first failure regardless of
     * `continueOnError` — whose own contract text already scopes it to
     * `atomic=false`, and which has nothing to continue toward when every write
     * so far is about to be undone.
     */
    private async runUpdateManyLoop(args: {
        object: string;
        records: UpdateManyDataRequest['records'];
        options: UpdateManyDataRequest['options'];
        context: any;
        atomic: boolean;
    }): Promise<BatchDataLoopOutcome> {
        const { object, records, options, context, atomic } = args;
        const results: BatchDataRowResult[] = [];
        let succeeded = 0;
        let failed = 0;

        for (const [index, record] of records.entries()) {
            try {
                // [#3455] Two gaps the pre-#3455 loop had, both fixed per row:
                //  1. `context` was never threaded — bulk updates ran the engine
                //     context-less, so RLS/FLS and `readonlyWhen` evaluated without
                //     the caller's principal. Thread it like single-write updateData.
                //  2. `onFieldsDropped` was never wired — the same static `readonly`
                //     (#2948) / `readonlyWhen` (#3042) strips that single-write now
                //     surfaces (#3431) happened silently here. Collect per row.
                //
                // [#5100] Same guard as `runBatchDataLoop`'s update branch
                // (#4793), same classification: an id-less row is a CALLER
                // error — VALIDATION_FAILED/400 — not a data-state one. The
                // REST entrance already rejects it (`UpdateManyRecordSchema`
                // requires `id`, #3939), but that invariant lives two packages
                // away; unguarded, an in-process caller's malformed row
                // reached the probe and the write as `{ id: undefined }`,
                // whose reading is up to each driver's undefined-where-key
                // handling — at best a 404 with `undefined` interpolated into
                // the message, at worst a where-clause with no id at all.
                if (!record.id) throw rowRequiredIdError('update');
                // [#5088] Third gap, the same shape: no existence gate. A row
                // naming no record went straight into `engine.update`, so the
                // hook pipeline ran over a payload-only record and the row came
                // back `INTERNAL_ERROR` from #4775's condition abort — blaming
                // the hook for a caller's stale id. Probe first, per row, so
                // this face answers what the single-record PATCH answers.
                await this.assertRecordExists(object, record.id);
                const dropped: DroppedFieldsEvent[] = [];
                const opts: any = { where: { id: record.id }, onFieldsDropped: (e: DroppedFieldsEvent) => { dropped.push(e); } };
                if (context !== undefined) opts.context = context;
                const updated = await this.engine.update(object, record.data || {}, opts);
                results.push({ id: record.id, success: true, data: updated, index, ...(dropped.length > 0 ? { droppedFields: dropped } : {}) });
                succeeded++;
            } catch (err: any) {
                results.push({ id: record.id, success: false, index, errors: [toRowApiError(err)] });
                failed++;
                if (atomic) {
                    // Abort on the first failure; the caller rolls back.
                    break;
                }
                if (!options?.continueOnError) {
                    break;
                }
            }
        }

        return { results, succeeded, failed };
    }

    /**
     * The ordinary (committed) `updateMany` response. Deliberately NOT
     * {@link buildBatchDataResponse}: this surface has never honoured
     * `returnRecords`, and quietly starting to would change the default
     * (non-atomic) path's payload while fixing an unrelated bug (#4620).
     */
    private buildUpdateManyResponse(
        records: UpdateManyDataRequest['records'],
        outcome: BatchDataLoopOutcome,
    ): BatchUpdateResponse {
        // [#7539] Same under-report as `batchData`, ten lines away — the card's
        // "per-object bulk counters under-report whenever a row fails without
        // `continueOnError`". Fixed through the one shared reconciler, because
        // a second copy is how these three drifted apart before (#4620).
        const { results, succeeded, failed } = this.reconcileStoppedBatch(records, outcome);
        return {
            success: failed === 0,
            operation: 'update',
            total: records.length,
            succeeded,
            failed,
            results,
        } as BatchUpdateResponse;
    }

    // `analyticsQuery` / `getAnalyticsMeta` were retired with the degraded
    // `analytics` service shim (#3891 / #3878). They aggregated through
    // `engine.aggregate` WITHOUT the caller's ExecutionContext — no RLS or
    // tenant predicate was ever injected — and read a non-contract `filters`
    // field while silently ignoring the canonical `AnalyticsQuery.where`, so a
    // spec-conformant filtered request returned an unscoped full-table
    // aggregate. The analytics domain has exactly one implementation now:
    // `@objectstack/service-analytics` (context-aware, fail-closed
    // `getReadScope`). Deployments without it get an honest 404 from the
    // dispatcher's `/analytics` domain instead of wrong numbers.

    async triggerAutomation(_request: any): Promise<any> {
        throw new Error('triggerAutomation requires plugin-automation service. Install and register a plugin that provides the "automation" service.');
    }

    /**
     * Bulk delete by id — the `POST /data/:object/deleteMany` ingress.
     *
     * [#3897] This used to build `{ where: { id: { $in: ids } } }` and then
     * spread `...request.options` OVER it. `options` is caller-supplied (the
     * REST route splats the whole request body into the protocol request), so
     * a body key replaced the predicate the endpoint is named after:
     *
     *   {"ids":["a"],"options":{"multi":true,"where":{}}}
     *
     * reached `engine.delete` as an unscoped bulk delete — widening "delete
     * these 3 records" into "delete everything this caller is allowed to
     * delete" (RLS/sharing middleware still composes onto the AST, so the blast
     * radius is the caller's visible set, not the whole table). The same spread
     * could smuggle in `context`, i.e. a forged principal on any deployment
     * where the route is reachable without auth.
     *
     * The fix is structural rather than a re-ordered spread: caller `options`
     * is a `BatchOptions` bag (`atomic` / `returnRecords` /
     * `continueOnError` / `validateOnly`) and carries NOTHING `engine.delete`
     * consumes, so it is never merged into the engine options. The engine call
     * is built here from the validated id list alone, and each id is deleted by
     * scalar primary key — the same shape `batchData`'s `delete` case uses.
     *
     * Deleting per id (instead of one `$in` bulk delete) also fixes the second
     * half of #3897 and two silent gaps behind it:
     *   - the endpoint's happy path never worked at all — `deleteManyData` never
     *     set `multi`, so a well-formed `{"ids":[…]}` hit engine.ts's
     *     `'Delete requires an ID or options.multi=true'` throw, and ONLY the
     *     requests that triggered the override above got through;
     *   - the bulk branch skips `cascadeDeleteRelations`, so `deleteBehavior`
     *     (`cascade` / `set_null` / `restrict`) was not honoured for the rows it
     *     removed;
     *   - the declared {@link BatchUpdateResponse} contract (per-record results,
     *     `atomic` / `continueOnError`) was unimplementable from a bulk row
     *     count. It is now actually delivered.
     *
     * [#4620] That last bullet over-claimed for one member: `atomic` was
     * per-record, but it only stopped the loop — no transaction, no rollback,
     * every earlier delete left committed under a response titled atomic. It is
     * delivered for real now, through the shared {@link runAtomicBatch}, and
     * refused (501 `NOT_IMPLEMENTED`) on a runtime that cannot roll back.
     */
    async deleteManyData(request: DeleteManyDataRequest & { context?: any }): Promise<BatchUpdateResponse> {
        const { object, options, context } = request;
        this.assertObjectRegistered(object); // [#3770]

        // Fail CLOSED on anything that is not a list of scalar ids. A non-scalar
        // entry (`{"ids":[{"$ne":null}]}`) must never reach `where.id` as an
        // operator object — that is the same "predicate widening" this endpoint
        // was just hardened against, one layer down.
        const isScalarId = (v: unknown) =>
            (typeof v === 'string' && v.length > 0) || typeof v === 'number' || typeof v === 'bigint';
        const ids = request.ids as unknown;
        if (!Array.isArray(ids) || ids.some((id) => !isScalarId(id))) {
            const err: any = new Error(
                `deleteMany on '${object}' requires 'ids' to be an array of record ids`,
            );
            err.code = 'VALIDATION_FAILED';
            err.status = 400;
            throw err;
        }

        // [#4620] `atomic` here was the same fake-atomic `batchData` carried
        // before ADR-0119 D4 — it only `break`-ed the loop, so every row deleted
        // before the failure stayed DELETED while the response called itself
        // atomic. Worse than the `batchData` case, because a partial delete has
        // no natural undo: the caller cannot reconstruct the rows from the
        // request. Same runner, same fail-closed gate, same row marking.
        if (options?.atomic === true) {
            const rows = ids.map((id) => ({ id: String(id) }));
            return await this.runAtomicBatch({
                object,
                context,
                runLoop: (trxCtx) => this.runDeleteManyLoop({ object, ids, options, context: trxCtx, atomic: true }),
                onCommit: (outcome) => this.buildDeleteManyResponse(ids, outcome),
                onRollback: (outcome) => this.buildRolledBackBatchResponse('delete', rows, outcome),
            });
        }

        const outcome = await this.runDeleteManyLoop({ object, ids, options, context, atomic: false });
        return this.buildDeleteManyResponse(ids, outcome);
    }

    /**
     * The per-id loop of {@link deleteManyData}, shared by both arms (#4620) —
     * see {@link runUpdateManyLoop} for why `atomic` outranks `continueOnError`.
     */
    private async runDeleteManyLoop(args: {
        object: string;
        ids: unknown[];
        options: DeleteManyDataRequest['options'];
        context: any;
        atomic: boolean;
    }): Promise<BatchDataLoopOutcome> {
        const { object, ids, options, context, atomic } = args;
        const results: BatchDataRowResult[] = [];
        let succeeded = 0;
        let failed = 0;
        const ctxOpt = context !== undefined ? { context } : {};

        for (const [index, id] of ids.entries()) {
            try {
                // [#4435] Per-row honesty on the bulk path. This discarded the
                // driver's return and pushed `success: true` unconditionally, so
                // `{"ids":["nonexistent_1"]}` answered `succeeded: 1` — a batch
                // of typo'd ids reported every one of them deleted. A caller
                // reconciling "which of my 200 ids were real" got a list that
                // agreed with whatever it sent. Same `=== false` reading as the
                // single-record path: the contract's positive not-found value,
                // never an inference from a falsy return.
                const deleted = await this.engine.delete(object, { where: { id }, ...ctxOpt } as any);
                // `id` is `unknown` to this helper only because the caller's
                // fail-closed `isScalarId` guard is what proves it scalar.
                if (deleted === false) throw recordNotFoundError(object, id as string | number);
                results.push({ id: String(id), success: true, index });
                succeeded++;
            } catch (err: any) {
                results.push({ id: String(id), success: false, index, errors: [toRowApiError(err)] });
                failed++;
                // Same stop semantics as `batchData`: `atomic` aborts the rest on
                // the first failure (the caller rolls back), and without
                // `continueOnError` a failure ends the run rather than silently
                // ploughing on.
                if (atomic) break;
                if (!options?.continueOnError) break;
            }
        }

        return { results, succeeded, failed };
    }

    /** The ordinary (committed) `deleteMany` response — every id reports what it did. */
    private buildDeleteManyResponse(ids: unknown[], outcome: BatchDataLoopOutcome): BatchUpdateResponse {
        // [#7539] Same reconciliation as the other two faces; `ids` are mapped
        // to the `{ id }` row shape the atomic arm already hands the rollback
        // builder, so a skipped id comes back echoed and retryable.
        const { results, succeeded, failed } = this.reconcileStoppedBatch(ids.map((id) => ({ id: String(id) })), outcome);
        return {
            success: failed === 0,
            operation: 'delete',
            total: ids.length,
            succeeded,
            failed,
            results,
        } as BatchUpdateResponse;
    }

    /**
     * Metadata types that are customer-overridable via {@link saveMetaItem}/
     * {@link deleteMetaItem} in project-kernel mode. Derived from the canonical
     * registry in {@link DEFAULT_METADATA_TYPE_REGISTRY}: a type opts in by
     * setting `allowOrgOverride: true` on its registry entry. The set is
     * augmented with the plural form of every singular so callers using REST
     * conventions (`/api/v1/meta/views/...`) get the same gate. See ADR-0005
     * §"Whitelist enforcement" for the rationale and the per-type rollout
     * checklist.
     */
    private static readonly OVERLAY_ALLOWED_TYPES: ReadonlySet<string> = (() => {
        const out = new Set<string>();
        for (const entry of DEFAULT_METADATA_TYPE_REGISTRY) {
            if (!entry.allowOrgOverride) continue;
            out.add(entry.type);
            const plural = SINGULAR_TO_PLURAL[entry.type];
            if (plural) out.add(plural);
        }
        return out;
    })();

    /**
     * Phase 3a-env-writable: parse `OS_METADATA_WRITABLE` once.
     * Comma-separated singular type names. When the env var is set, the
     * listed types get treated as `allowOrgOverride: true` regardless of
     * their static registry entry. This is the runtime escape hatch admins
     * use to enable Studio-side editing of types whose protocol-level flag
     * is still false (object, field, permission, …).
     *
     * Memoised at first call. Tests can override by clearing the cache via
     * {@link ObjectStackProtocolImplementation.resetEnvWritableCache}.
     */
    private static _envWritableTypes: Set<string> | null = null;
    private static envWritableTypes(): ReadonlySet<string> {
        if (this._envWritableTypes !== null) return this._envWritableTypes;
        const raw = readEnvWithDeprecation('OS_METADATA_WRITABLE', 'OBJECTSTACK_METADATA_WRITABLE') || '';
        const set = new Set<string>();
        for (const tok of raw.split(',')) {
            const t = tok.trim();
            if (!t) continue;
            const singular = PLURAL_TO_SINGULAR[t] ?? t;
            set.add(singular);
            const plural = SINGULAR_TO_PLURAL[singular];
            if (plural) set.add(plural);
        }
        this._envWritableTypes = set;
        return set;
    }

    /** Test hook — clear the memoised env-writable cache. */
    static resetEnvWritableCache(): void {
        this._envWritableTypes = null;
    }

    /**
     * Types that opt into runtime creation of brand-new items (ADR-0005
     * extension — two-tier model). A type may have
     * `allowOrgOverride: false` (cannot overlay artifact-shipped items)
     * yet still set `allowRuntimeCreate: true` (users can author new
     * items in `sys_metadata`). The two flags are orthogonal; see
     * {@link isArtifactBacked} for how the protocol decides which gate
     * applies to a given save/delete.
     */
    /**
     * Set of type names that have a static entry in
     * `DEFAULT_METADATA_TYPE_REGISTRY`. Anything outside this set is
     * runtime-registered (plugin-provided types like `theme`, `api`,
     * `connector`) — the listing endpoint at `getMetaTypes()` synthesises
     * those with `allowRuntimeCreate: true`, so this gate must agree.
     */
    private static readonly STATIC_REGISTRY_TYPES: ReadonlySet<string> = (() => {
        const out = new Set<string>();
        for (const entry of DEFAULT_METADATA_TYPE_REGISTRY) {
            out.add(entry.type);
            const plural = SINGULAR_TO_PLURAL[entry.type];
            if (plural) out.add(plural);
        }
        return out;
    })();

    private static readonly RUNTIME_CREATE_ALLOWED_TYPES: ReadonlySet<string> = (() => {
        const out = new Set<string>();
        for (const entry of DEFAULT_METADATA_TYPE_REGISTRY) {
            if (!entry.allowRuntimeCreate) continue;
            out.add(entry.type);
            const plural = SINGULAR_TO_PLURAL[entry.type];
            if (plural) out.add(plural);
        }
        return out;
    })();

    /**
     * [#6960] Metadata types whose LOADER merges a per-org/env overlay row on
     * top of the artifact at read time — `supportsOverlay: true` on the
     * registry entry, read straight off the declaration.
     *
     * This is a strictly different question from {@link OVERLAY_ALLOWED_TYPES}
     * (`allowOrgOverride`), and the registry keeps the two flags apart on
     * purpose: `supportsOverlay` is a CAPABILITY of the read path ("an overlay
     * row under this name changes what is served"), `allowOrgOverride` is a
     * PERMISSION on the write path ("a tenant may author one"). #6483 / PR
     * #6608 rolled the permission back for six types — `permission`,
     * `position`, `page`, `app`, `dataset`, `book` — and deliberately left
     * the capability alone, which is exactly the state #6960 was filed about:
     * a row authored BEFORE the rollback still merges overlay-wins today.
     *
     * Registry-derived, never a hand-written list (Prime Directive #8), and
     * augmented with the plural spelling so `/api/v1/meta/pages/...` is judged
     * identically to the singular — the same normalization every sibling set
     * in this class does.
     */
    private static readonly OVERLAY_CAPABLE_TYPES: ReadonlySet<string> = (() => {
        const out = new Set<string>();
        for (const entry of DEFAULT_METADATA_TYPE_REGISTRY) {
            if (!entry.supportsOverlay) continue;
            out.add(entry.type);
            const plural = SINGULAR_TO_PLURAL[entry.type];
            if (plural) out.add(plural);
        }
        return out;
    })();

    /**
     * [#6960] Does this type's loader merge an overlay row at read time?
     * Normalizes plural→singular, like every other predicate here.
     *
     * Read ONLY by `deleteMetaItem`'s two-tier authorization (and mirrored by
     * `SysMetadataRepository`'s delete gate); it never widens a create or an
     * update. See the call site for the ruling that licenses the asymmetry.
     */
    private static mergesOverlayAtRead(type: string): boolean {
        const singular = PLURAL_TO_SINGULAR[type] ?? type;
        return this.OVERLAY_CAPABLE_TYPES.has(singular)
            || this.OVERLAY_CAPABLE_TYPES.has(type);
    }

    /** Normalize plural→singular before consulting the allow-list. */
    private static isOverlayAllowed(type: string): boolean {
        const singular = PLURAL_TO_SINGULAR[type] ?? type;
        if (this.OVERLAY_ALLOWED_TYPES.has(singular)
            || this.OVERLAY_ALLOWED_TYPES.has(type)) {
            return true;
        }
        const env = this.envWritableTypes();
        return env.has(singular) || env.has(type);
    }

    /** Does this type permit creating brand-new (artifact-free) items? */
    private static isRuntimeCreateAllowed(type: string): boolean {
        const singular = PLURAL_TO_SINGULAR[type] ?? type;
        if (this.RUNTIME_CREATE_ALLOWED_TYPES.has(singular)
            || this.RUNTIME_CREATE_ALLOWED_TYPES.has(type)) {
            return true;
        }
        // Runtime-registered types (no static registry entry) are
        // synthesised by getMetaTypes() with allowRuntimeCreate=true;
        // mirror that here so /api/v1/meta and PUT /api/v1/meta agree.
        if (!this.STATIC_REGISTRY_TYPES.has(singular)
            && !this.STATIC_REGISTRY_TYPES.has(type)) {
            return true;
        }
        return false;
    }

    /**
     * The prescription half of a code-only refusal (#5086): where the author
     * is supposed to declare this item instead. Read from the type's own
     * registry entry (`filePatterns`), so a newly-flagged type carries an
     * accurate hint the day it is flagged — nothing here to keep in sync.
     */
    private static codeOnlySourceHint(type: string): string {
        const singular = PLURAL_TO_SINGULAR[type] ?? type;
        const entry = DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === singular);
        const pattern = entry?.filePatterns?.[0];
        return pattern ? ` Declare it in source (${pattern}) and redeploy.` : '';
    }

    /**
     * #5086 — a brand-new item of a type the registry declares code-only
     * (`allowRuntimeCreate: false` AND `allowOrgOverride: false`).
     *
     * Names the type, the flags that produced the verdict, the prescription
     * and the escape hatch — the same shape the retired-key refusals in this
     * wave carry, because a refusal an author cannot act on just moves the
     * confusion one layer down. `NOT_CREATABLE` is the catalogued code
     * (`packages/spec/src/api/error-code-ledger.zod.ts`).
     */
    private static codeOnlyCreateError(type: string): Error {
        const err = new Error(
            `[not_creatable] Metadata type '${type}' is code-only: the metadata-type registry declares `
            + `allowRuntimeCreate=false and allowOrgOverride=false, so it cannot be created through the `
            + `runtime metadata API (PUT /api/v1/meta/${type}/:name) on any kernel.`
            + ObjectStackProtocolImplementation.codeOnlySourceHint(type)
            + ` An operator may set OS_METADATA_WRITABLE=${PLURAL_TO_SINGULAR[type] ?? type} to grant a runtime escape hatch. `
            + `See docs/adr/0005-metadata-customization-overlay.md.`
        );
        (err as any).code = 'NOT_CREATABLE';
        (err as any).status = 403;
        return err;
    }

    /**
     * #5086 — the artifact-backed half of the same refusal: the name IS
     * shipped by a code package, so the honest verdict is "you may not
     * overlay it" rather than "you may not create it".
     */
    private static codeOnlyOverrideError(type: string, name: string): Error {
        const err = new Error(
            `[not_overridable] Metadata item '${type}/${name}' is provided by a code package and its type is `
            + `code-only (allowRuntimeCreate=false, allowOrgOverride=false), so it cannot be overlaid through `
            + `the runtime metadata API on any kernel.`
            + ObjectStackProtocolImplementation.codeOnlySourceHint(type)
            + ` An operator may set OS_METADATA_WRITABLE=${PLURAL_TO_SINGULAR[type] ?? type} to grant a runtime escape hatch. `
            + `See docs/adr/0005-metadata-customization-overlay.md.`
        );
        (err as any).code = 'NOT_OVERRIDABLE';
        (err as any).status = 403;
        return err;
    }

    /**
     * [#6190] The org-scope half of the same family: a write that would stamp
     * `sys_metadata.organization_id` on a type the registry declares has NO
     * per-org channel. Returns the refusal, or `null` when the write is fine.
     *
     * ## Why a write-time refusal and not a read-time repair
     *
     * `allowOrgOverride` and `allowRuntimeCreate` are orthogonal tiers (see
     * {@link isRuntimeCreateAllowed}), and the runtime-create tier never
     * consulted the ORG dimension: `SysMetadataRepository.put` stamps
     * `organization_id: this.organizationId` whatever the type is, so a
     * Studio-authored item of an `allowOrgOverride: false` type persisted a
     * per-org row that the platform can never read back. Cold boot
     * (`loadMetaFromDb`, `organization_id: null`) walks past it and the
     * env-wide consumers never ask for it — the write path was strictly more
     * permissive than the read path, which is the false-compliance shape
     * ADR-0049 forbids. Measured consequences, both silent before this gate:
     *
     *  - `flow` — the row binds its triggers for the life of the process that
     *    wrote it and stops firing after the next restart, with no log line
     *    (#6190's original report; the cold-boot warn that made the residue
     *    audible shipped separately, see
     *    {@link reportUnhydratableOrgScopedRows}).
     *  - `object` — worse, and fails CLOSED: the object is absent from the
     *    registry after boot while its physical table still holds the data, so
     *    {@link assertObjectRegistered} answers 404 `OBJECT_NOT_FOUND` for
     *    every record in it.
     *
     * Maintainer ruling 2026-08-08 on #6190 (option A of three): refuse the
     * write. Option B — silently coercing the row to env-wide — was rejected
     * because it rewrites the tenancy statement the author made; option D —
     * the log alone — leaves declared ≠ enforced.
     *
     * ## Shape decisions
     *
     *  - **Registry-derived, never a hand-written type list** (Prime Directive
     *    #8): the predicate is {@link isOverlayAllowed} — the same one the
     *    sibling refusal below it uses, over the same derived
     *    {@link OVERLAY_ALLOWED_TYPES} set. A type that gains
     *    `allowOrgOverride: true` tomorrow is admitted here the same day, with
     *    nothing to keep in sync.
     *  - **The operator hatch stays ONE door.** Because the predicate is
     *    `isOverlayAllowed`, `OS_METADATA_WRITABLE` unlocks org scoping exactly
     *    as it unlocks the overlay — which is what this file already promises a
     *    few lines down ("unlocking a type there unlocks it here too") and what
     *    the ruling asked for by naming this the *sibling* of the
     *    `NOT_OVERRIDABLE` refusal. Two differently-keyed notions of
     *    "overridable" inside one method would be the drift, not the safety.
     *
     *    The DIAGNOSTIC is deliberately wider than the refusal:
     *    {@link reportUnhydratableOrgScopedRows} ignores the hatch and reports
     *    an org-scoped row of any non-org-overridable type, because the hatch
     *    unlocks the write and cannot teach `loadMetaFromDb` to read the row
     *    back. So an operator who deliberately opens the door still gets told,
     *    at every boot, that what they wrote did not survive it. Warning is
     *    free and should be maximal; refusing removes a capability, and the
     *    declaration — including its documented override — decides that.
     *  - **Statically-declared types only.** A type with no entry in
     *    `DEFAULT_METADATA_TYPE_REGISTRY` is plugin-registered at runtime, and
     *    both existing gates ({@link isRuntimeCreateAllowed} here,
     *    `assertAllowed` in the repository) treat that family as permissive by
     *    construction — `getMetaTypes()` synthesises `allowRuntimeCreate: true`
     *    for it. Refusing those here would extend a ruling measured over the
     *    registry to a surface nobody measured, so they keep today's behaviour.
     *    Their org rows are skipped by cold boot too; that gap is stated in the
     *    PR rather than silently widened here.
     *  - **`NOT_OVERRIDABLE`, not a new code.** The condition IS "this type has
     *    no per-org override channel", the sentence `NOT_OVERRIDABLE` already
     *    carries, and the code vocabulary is a closed set owned by
     *    `packages/spec`'s ledger (ADR-0112 D3) — a cross-package edit this
     *    card is not authorised to make. The message carries the distinction.
     *
     * Pinned by `protocol.org-scoped-write-refused.test.ts`.
     */
    private static orgScopedWriteRefusal(
        type: string,
        name: string,
        organizationId: string | null | undefined,
    ): Error | null {
        if (!organizationId) return null;
        const singular = PLURAL_TO_SINGULAR[type] ?? type;
        if (this.isOverlayAllowed(type)) return null;
        if (!this.STATIC_REGISTRY_TYPES.has(singular) && !this.STATIC_REGISTRY_TYPES.has(type)) return null;
        const err: any = new Error(
            `[not_overridable] Metadata item '${type}/${name}' cannot be written org-scoped `
            + `(organization '${organizationId}'). `
            + `The metadata-type registry declares allowOrgOverride=false for '${singular}', so the platform has `
            + `no per-org channel for it: boot hydration loads env-wide rows only, so this row would be absent `
            + `from the registry after the next restart — a '${singular}' that answered today would stop `
            + `(an 'object' answers 404 OBJECT_NOT_FOUND for every record in its still-populated table, a 'flow' `
            + `silently stops firing). Save it env-wide instead (retry with no active organization), or ship the `
            + `per-org variant as its own deployment (ADR-0005: "Per-org variants are a deployment, not an `
            + `overlay"). An operator may set OS_METADATA_WRITABLE=${singular} to grant a runtime escape hatch, `
            + `but note the row still will not survive a restart — the hatch unlocks the write, not the read, `
            + `and boot logs every such row it walks past. `
            + `See docs/adr/0005-metadata-customization-overlay.md and #6190.`
        );
        err.code = 'NOT_OVERRIDABLE';
        err.status = 403;
        err.organizationId = organizationId;
        err.docs = 'docs/adr/0005-metadata-customization-overlay.md';
        return err;
    }

    /**
     * Does an artifact (npm-package-loaded) item exist at `(type, name)`?
     *
     * The schema registry's `_packageId` tag is set only when
     * `registerItem(..., packageId)` is called with a truthy packageId
     * — and only artifact loaders do that. DB-rehydrated items
     * (sys_metadata rows registered back into the registry by
     * `getMetaItems` / `loadMetaFromDb`) call `registerItem` without a
     * packageId, so they carry no `_packageId` and are correctly
     * excluded here.
     *
     * Used by the two-tier authorization model to distinguish
     * "overlaying a packaged item" (requires `allowOrgOverride`) from
     * "authoring a DB-only item" (requires only `allowRuntimeCreate`).
     *
     * [#7743] …and it must answer that question about the artifact as SHIPPED,
     * not about how the registry happens to key it. See
     * {@link isNestedArtifactField} for the one declared type whose artifacts
     * are not standalone registry items at all.
     */
    private isArtifactBacked(type: string, name: string): boolean {
        // `lookupArtifactItem` only returns items whose `_packageId` marks a
        // genuine code package (the `'sys_metadata'` rehydration sentinel is
        // excluded), and — via `SchemaRegistry.getArtifactItem` — is immune
        // to plain-key shadows hydrated from overlay rows.
        if (this.lookupArtifactItem(type, name) !== undefined) return true;
        return this.isNestedArtifactField(type, name);
    }

    /**
     * [#7743] Is `(field, '<object>.<field>')` a field a code package ships?
     *
     * ## Why this predicate needs a second resolver at all
     *
     * `field` is the ONE type in `DEFAULT_METADATA_TYPE_REGISTRY` whose
     * artifacts are not standalone registry items. Its `filePatterns`
     * (`**\/*.field.ts`) match nothing in any app — fields are authored INSIDE
     * the object (`ObjectSchema.fields`, a `z.record(name, FieldSchema)`), so
     * the object's loader registers one `object` item and no `field` items at
     * all. `getArtifactItem('field', 'showcase_task.title')` therefore misses
     * on a field the package unambiguously ships.
     *
     * That miss is not cosmetic — it is a load-bearing authorization input.
     * `isArtifactBacked` is what picks the write INTENT for
     * `SysMetadataRepository.assertAllowed` (`override-artifact` vs
     * `runtime-only`) and what arms `saveMetaItem`'s own `NOT_OVERRIDABLE`
     * gate. With the lookup empty, an override of a packaged field was
     * classified as a runtime-only CREATE, and `field` carries
     * `allowRuntimeCreate: true` — so `allowOrgOverride: false` was never
     * consulted, and `PUT /api/v1/meta/field/showcase_task.title` answered
     * **200** on a write the registry forbids. Measured on the showcase before
     * this fix: 200 `state:'active'`, the row reading back with
     * `_diagnostics.valid=true`.
     *
     * ## Why this is `field`-only and not a general nesting rule
     *
     * Measured across the whole registry on a booted showcase (#7743): every
     * other declared type either registers its artifacts standalone with a
     * `_packageId` — `action` (70), `page` (33), `permission` (16), `dataset`
     * (9), `doc` (9), `hook` (4), `report` (4), `mapping`/`book`/
     * `email_template` (1 each) — or genuinely ships no artifacts at all
     * (`position`, `tool`, `skill`, `seed`, `translation`,
     * `external_catalog`), where "not artifact-backed" is the TRUE answer and
     * the runtime-create tier is the right one. `action` is the instructive
     * one: it is also nested inside the object document, yet it IS registered
     * standalone, so it was already refused correctly (403) in the same run.
     * `field` is the only name where the registry's answer and the shipped
     * artifact disagree, so widening this to a class would be widening it past
     * what was measured.
     *
     * ## Shape decisions
     *
     *  - **Containment, not a synthetic envelope.** This returns a boolean
     *    rather than routing through {@link lookupArtifactItem}, because a
     *    field sub-document is a bare `{ name, label, type, … }` with no
     *    `_packageId` / `_lock` envelope. The other `lookupArtifactItem`
     *    callers (lock resolution, `mergeArtifactProtection`, the layered
     *    read) consume that envelope, and handing them a field body would make
     *    them assert provenance nobody stamped. The authorization question —
     *    "does a package ship this?" — is answerable without one.
     *  - **The OBJECT is resolved through the artifact-only lookup**, so an
     *    overlay row hydrated under the plain key cannot manufacture *or* mask
     *    an artifact field (ADR-0010 §3.3, the same shadow-immunity the
     *    standalone path relies on).
     *  - **`fields` is read in its one canonical form** — a record keyed by
     *    field name (`object.zod.ts`, `z.record(...)`). No array fallback:
     *    Prime Directive #12 keeps one contract rather than two dialects.
     *  - **A brand-new field stays creatable.** A name the object's artifact
     *    does not carry answers `false` here, keeps the `runtime-only` intent,
     *    and is still accepted under `allowRuntimeCreate: true` — the
     *    declaration has two tiers and this closes only the overlay one.
     */
    private isNestedArtifactField(type: string, name: string): boolean {
        if ((PLURAL_TO_SINGULAR[type] ?? type) !== 'field') return false;
        // `<object>.<field>` — both halves are snake_case and carry no dot of
        // their own, so the FIRST separator is the only one.
        const sep = name.indexOf('.');
        if (sep <= 0 || sep === name.length - 1) return false;
        const objectArtifact = this.lookupArtifactItem('object', name.slice(0, sep)) as
            { fields?: Record<string, unknown> } | undefined;
        const fields = objectArtifact?.fields;
        if (!fields || typeof fields !== 'object') return false;
        return Object.prototype.hasOwnProperty.call(fields, name.slice(sep + 1));
    }

    // ───────────────────────────────────────────────────────────────────
    // ADR-0010 — metadata protection (Phase 1: L3 item-level lock)
    // ───────────────────────────────────────────────────────────────────

    /**
     * Look up an item from the artifact registry across both the requested
     * type and its singular/plural twin. Returns `undefined` when the
     * registry is unavailable or the item is not artifact-backed.
     */
    private lookupArtifactItem(type: string, name: string, currentPackageId?: string): unknown {
        const registry = (this.engine as any)?.registry;
        if (!registry) return undefined;
        const singular = PLURAL_TO_SINGULAR[type] ?? type;
        // Prefer the artifact-only lookup: it scans composite
        // (`<packageId>:<name>`) entries first, so an overlay row hydrated
        // into the plain key (getMetaItems / loadMetaFromDb) can never
        // shadow the packaged artifact's protection envelope (ADR-0010
        // §3.3 — pre-fix, that shadow made a `_lock: full` app read back
        // as unlocked after PUT+GET until restart). `currentPackageId`
        // (ADR-0048) makes that scan package-scoped (prefer-local).
        if (typeof registry.getArtifactItem === 'function') {
            return registry.getArtifactItem(singular, name, currentPackageId)
                ?? registry.getArtifactItem(type, name, currentPackageId);
        }
        // Partial registry mocks in tests — fall back to getItem and apply
        // the same package-provenance filter inline.
        if (typeof registry.getItem !== 'function') return undefined;
        const item = registry.getItem(singular, name, currentPackageId) ?? registry.getItem(type, name, currentPackageId);
        if (!item || !(item as any)._packageId || (item as any)._packageId === 'sys_metadata') {
            return undefined;
        }
        return item;
    }

    /**
     * True when `packageId` is a **writable base** — a DB-backed package an
     * org or the AI may author *new* metadata into (ADR-0070 D2).
     *
     * [#7560] The rule itself moved to {@link isWritablePackage} in
     * `./package-writability.js` because it gained a SECOND caller: the
     * `/packages` lifecycle routes, which must refuse to disable or delete a
     * read-only package the same way this path refuses to author into one. Two
     * hand-kept copies of "which packages are read-only" is precisely the drift
     * that let `DELETE /packages/:id` remove a platform package from a live
     * deployment while `saveMetaItem` was refusing to add one field to it. This
     * method stays as the in-class spelling; the shared function is the
     * definition, and its doc comment carries the reasoning.
     */
    private isWritablePackage(packageId: string | null | undefined): boolean {
        return isWritablePackageShared(this.engine, packageId);
    }

    /**
     * Resolve the effective `_lock` for an item by consulting the
     * artifact registry first, then the persisted overlay row. Artifact
     * always wins — by design, an overlay cannot loosen a packaged
     * lock (ADR-0010 §3.3).
     *
     * Returns `'none'` when nothing is locked, which is the common
     * case. Safe to call when `environmentId` is undefined (control-
     * plane bootstrap) — the lock check is only meaningful in tenant
     * scope and the caller is expected to also gate on `environmentId`.
     *
     * `'none'` is a VERDICT, not a default: both callers turn it into
     * "allow". So it is returned only when the absence of a lock was
     * actually established. When the overlay row cannot be read this
     * method THROWS (#5706) rather than answering "unlocked" — see the
     * `catch` below and {@link rethrowUnlessMetadataStoreUnprovisioned}.
     *
     * @throws {@link metadataStoreUnavailableError} — 503 /
     *         `SERVICE_UNAVAILABLE`, when the lock state could not be
     *         determined. The one non-throwing failure is an
     *         unprovisioned `sys_metadata`, where "no overlay row" is
     *         the truth rather than an unknown.
     */
    private async getEffectiveLock(
        type: string,
        name: string,
        organizationId: string | null | undefined,
    ): Promise<{
        lock: MetadataLock;
        lockReason: string | undefined;
        lockSource: 'artifact' | 'overlay' | undefined;
    }> {
        // 1. Artifact wins. `lookupArtifactItem` is shadow-immune: a
        //    sys_metadata overlay row hydrated into the registry's plain
        //    key cannot mask the packaged artifact's `_lock` envelope.
        const artifactItem = this.lookupArtifactItem(type, name) as any;
        if (artifactItem) {
            const p = extractProtection(artifactItem);
            if (p.lock !== 'none') {
                return { lock: p.lock, lockReason: p.lockReason, lockSource: 'artifact' };
            }
        }
        // 2. Overlay row.
        try {
            const where: Record<string, unknown> = {
                type,
                name,
                state: 'active',
                organization_id: organizationId ?? null,
            };
            const row = await this.engine.findOne('sys_metadata', { where });
            if (row) {
                const body = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
                const p = extractProtection(body);
                if (p.lock !== 'none') {
                    return { lock: p.lock, lockReason: p.lockReason, lockSource: 'overlay' };
                }
            }
        } catch (error) {
            // #5706 — A LOCK GATE MUST NOT FAIL OPEN. This `catch` used to
            // swallow every read failure and fall through to `'none'`, and
            // `'none'` is not a neutral value here: it is the verdict "the
            // author declared no protection", which `evaluateLockForWrite` /
            // `evaluateLockForDelete` turn straight into "allow". So an
            // unreadable `sys_metadata` silently converted a write that had to
            // be refused into a write that was performed — measured on
            // `origin/main`: with the overlay row declaring `_lock:
            // 'no-overlay'` and only the read above failing, `saveMetaItem`
            // returned `success: true` after an `update` on `sys_metadata`
            // (and `deleteMetaItem` the same, on `_lock: 'no-delete'`).
            //
            // Note what that also costs the audit trail: the allowed path
            // writes its ordinary `outcome: 'allowed'` row, so nothing
            // afterwards records that this write should have been denied.
            //
            // The window is not "the metadata store is down" — a fully dead
            // store fails the write too. It is "the READ failed and the write
            // still succeeded": a transient error, a single timed-out query, a
            // read-replica fault, partial pool exhaustion. Narrow, but the
            // shape is wrong at any width, and it is the inverse of ADR-0049's
            // fail-closed direction.
            //
            // The discrimination is the same one #5532 / PR #5705 installed for
            // the overlay READS in this file, reused verbatim rather than
            // reinvented: an unprovisioned `sys_metadata` genuinely has no
            // overlay row, so `'none'` IS the truth and first boot must not
            // explode; every other error is an outage and becomes a 503, whose
            // `cause` carries the driver error. ADR-0010 §3.3 is the decision
            // this defends; ADR-0110 D3 is the rule it was breaking — a miss
            // and an outage are different facts, and here reading one as the
            // other disarmed a protection gate.
            //
            // Consequence, deliberate and wire-visible: `save` / `publish` /
            // `rollback` / `delete` now fail with 503 when the lock state
            // cannot be read, instead of proceeding as if unlocked. Refusing
            // one uncertain write beats performing one that had to be refused.
            this.rethrowUnlessMetadataStoreUnprovisioned(error);
        }
        return { lock: 'none', lockReason: undefined, lockSource: undefined };
    }

    /**
     * Best-effort audit-row writer (ADR-0010 §3.6). Failures here are
     * logged but never block the underlying decision: an environment
     * without the audit table provisioned (legacy installs before this
     * ADR landed) still answers normal API calls, just without the
     * compliance trail. Phase 2 will make the audit table a hard
     * dependency.
     */
    private async recordMetadataAudit(entry: {
        type: string;
        name: string;
        organizationId?: string | null;
        operation: 'save' | 'publish' | 'rollback' | 'delete' | 'reset';
        outcome: 'allowed' | 'denied' | 'forced';
        code: string;
        lockState?: MetadataLock;
        lockOverridden?: boolean;
        actor?: string;
        source?: string;
        requestId?: string;
        note?: string;
    }): Promise<void> {
        try {
            await this.engine.insert('sys_metadata_audit', {
                occurred_at: new Date().toISOString(),
                actor: entry.actor ?? 'system',
                source: entry.source ?? 'protocol',
                type: PLURAL_TO_SINGULAR[entry.type] ?? entry.type,
                name: entry.name,
                organization_id: entry.organizationId ?? null,
                operation: entry.operation,
                outcome: entry.outcome,
                code: entry.code,
                lock_state: entry.lockState ?? 'none',
                lock_overridden: entry.lockOverridden ?? false,
                request_id: entry.requestId ?? null,
                note: entry.note ?? null,
            } as any);
        } catch (err: any) {
            // Don't promote audit-table failures to API errors. Log so
            // operators can spot a misconfigured deployment.
            console.warn(
                `[Protocol] sys_metadata_audit write failed for ${entry.type}/${entry.name}: ${err?.message ?? err}`,
            );
        }
    }

    /**
     * Phase 1 L3 enforcement for write operations (save / publish /
     * rollback). Returns null on allow. Returns the structured `Error`
     * the caller should `throw` on deny — also records the denial in
     * the audit log so refused attempts are visible in compliance
     * reports (refused writes never reach sys_metadata_history).
     */
    private async assertLockAllowsWrite(args: {
        type: string;
        name: string;
        organizationId?: string;
        operation: 'save' | 'publish' | 'rollback';
        actor?: string;
        source?: string;
        requestId?: string;
    }): Promise<Error | null> {
        if (this.environmentId === undefined) return null;
        const state = await this.getEffectiveLock(args.type, args.name, args.organizationId ?? null);
        const refusal = evaluateLockForWrite(state.lock);
        if (!refusal) return null;
        const reason = state.lockReason ?? refusal.reason;
        const err = new Error(
            `[item_locked] ${args.type}/${args.name} is locked (_lock=${state.lock}${state.lockSource ? `, source=${state.lockSource}` : ''}). `
            + `${reason} — See ADR-0010 §3.3.`,
        );
        (err as any).code = 'ITEM_LOCKED';
        (err as any).status = 403;
        (err as any).lock = state.lock;
        (err as any).lockReason = reason;
        await this.recordMetadataAudit({
            type: args.type,
            name: args.name,
            organizationId: args.organizationId ?? null,
            operation: args.operation,
            outcome: 'denied',
            // adr0112-ok: D6b — persisted audit column, its own vocabulary
            code: 'item_locked',
            lockState: state.lock,
            actor: args.actor,
            source: args.source ?? `protocol.${args.operation}MetaItem`,
            requestId: args.requestId,
            note: reason,
        });
        return err;
    }

    /** Counterpart of {@link assertLockAllowsWrite} for delete. */
    private async assertLockAllowsDelete(args: {
        type: string;
        name: string;
        organizationId?: string;
        actor?: string;
        source?: string;
        requestId?: string;
    }): Promise<Error | null> {
        if (this.environmentId === undefined) return null;
        const state = await this.getEffectiveLock(args.type, args.name, args.organizationId ?? null);
        const refusal = evaluateLockForDelete(state.lock);
        if (!refusal) return null;
        const reason = state.lockReason ?? refusal.reason;
        const err = new Error(
            `[item_locked] ${args.type}/${args.name} is locked (_lock=${state.lock}${state.lockSource ? `, source=${state.lockSource}` : ''}). `
            + `${reason} — See ADR-0010 §3.3.`,
        );
        (err as any).code = 'ITEM_LOCKED';
        (err as any).status = 403;
        (err as any).lock = state.lock;
        (err as any).lockReason = reason;
        await this.recordMetadataAudit({
            type: args.type,
            name: args.name,
            organizationId: args.organizationId ?? null,
            operation: 'delete',
            outcome: 'denied',
            // adr0112-ok: D6b — persisted audit column, its own vocabulary
            code: 'item_locked',
            lockState: state.lock,
            actor: args.actor,
            source: args.source ?? 'protocol.deleteMetaItem',
            requestId: args.requestId,
            note: reason,
        });
        return err;
    }

    /**
     * [#7748] Audit an optimistic-concurrency refusal (the 409
     * `METADATA_CONFLICT` envelope) — ONE spelling shared by all four routes
     * that can raise it (save / publish / rollback / delete).
     *
     * ## Why this is a denial and not an absence
     *
     * The lock gate ({@link assertLockAllowsWrite}) already records the writes
     * it refuses, so a compliance report could show a locked item's rejected
     * saves. The 409 is refused OUTSIDE that helper — it comes back from the
     * repository's parent-version check — and until this landed nothing on that
     * route wrote a row at all. A caller repeatedly losing a race against
     * another author was therefore indistinguishable, in the trail, from a
     * caller who never tried: both leave nothing behind.
     *
     * A single helper rather than four copies is deliberate: the four call
     * sites already carry four near-identical hand-written conflict `Error`s,
     * and adding a fifth-through-eighth hand-written audit block is how one
     * idea acquires four spellings that then drift apart.
     */
    private async recordOptimisticConflictAudit(args: {
        type: string;
        name: string;
        organizationId?: string | null;
        operation: 'save' | 'publish' | 'rollback' | 'delete';
        actor?: string;
        source: string;
        requestId?: string;
        expectedParent?: unknown;
        actualHead?: unknown;
    }): Promise<void> {
        await this.recordMetadataAudit({
            type: args.type,
            name: args.name,
            organizationId: args.organizationId ?? null,
            operation: args.operation,
            outcome: 'denied',
            // adr0112-ok: D6b — persisted audit column, its own vocabulary
            code: 'metadata_conflict',
            ...(args.actor ? { actor: args.actor } : {}),
            source: args.source,
            ...(args.requestId ? { requestId: args.requestId } : {}),
            note: `expected parent ${args.expectedParent ?? 'null'} but current is ${args.actualHead ?? 'null'}`,
        });
    }

    /**
     * Mirror an object-type overlay write into the in-memory engine
     * registry so subsequent CRUD finds the new schema. Idempotent and
     * safe to call after a successful persistence call. For the legacy
     * write path this is invoked BEFORE persistence (historical behavior
     * preserved); for the PR-10d.3 repository path it is invoked only
     * AFTER `put()` resolves successfully, so a failed write — DB error,
     * optimistic-lock conflict, validation failure — never leaks a
     * stale schema into the registry.
     *
     * ── OWNERSHIP KEY (#4636, maintainer ruling 2026-08-07, option B) ──
     *
     * The contributor is keyed by the row's REAL `package_id`, not by the
     * `'sys_metadata'` sentinel this used to hard-write. The sentinel
     * survives for exactly one case — a package-less write, which has no
     * real id to use.
     *
     * Why the key had to move (and not the other side): the ownership key
     * IS the package-filter key. `SchemaRegistry.getAllObjects(packageId)`
     * matches `contributor.packageId`, so an object created through
     * Studio's package workspace was invisible to its own package's filter
     * until something re-registered it. The written contract in
     * `objectql/src/registry.ts` (the `isTenantAuthored` header) already
     * said the real id is the key and the sentinel is a save-path-only
     * artefact; this makes the save path say the same thing.
     *
     * ── `_provenance: 'org'` IS STAMPED HERE, SERVER-SIDE ──
     *
     * On a COPY of the body, unconditionally — the request's own
     * `_provenance` is never consulted, and never wins.
     *
     * That is load-bearing, not defensive coding. `applyProtection` (spec)
     * stamps `_provenance: 'package'` whenever it is handed a package id
     * and the body has not already answered, and the registry's artifact
     * lookup reads exactly that key: a row registered under `app.<slug>`
     * with package provenance IS a code artifact as far as
     * `getArtifactItem` is concerned, so `isArtifactBacked` turns true and
     * `saveMetaItem`'s overlay gate refuses the NEXT write to it with
     * `not_overridable` — `object` declares `allowOrgOverride: false`.
     * Moving the key without the stamp therefore re-creates cloud#970 (an
     * app the user just built becomes silently un-editable) on the write
     * path, one save later instead of one restart later. Measured, not
     * assumed: see the reverse-verification limb in
     * `objectql/src/protocol-writepath-object-ownership.test.ts`.
     *
     * Client-supplied provenance cannot be trusted here:
     * `metadata-read-decorations.ts` deliberately does NOT strip
     * `_provenance`, so a Studio GET → PUT round-trip echoes whatever the
     * served document carried. Every row this method sees came out of a
     * `sys_metadata` write, which is tenant-authored by definition
     * (ADR-0010 `_provenance: 'org'`) — so the server states that fact
     * rather than reading it back from the caller. Same sentence the boot
     * re-hydration already writes for the same rows.
     */
    private applyObjectRegistryMutation(request: { type: string; name: string; item?: any; packageId?: string | null }): void {
        if (request.type !== 'object' && request.type !== 'objects') return;
        this.engine.registry.registerItem(request.type, request.item, 'name');
        try {
            const layer = this.classifyObjectContribution(request.name, request.packageId);
            if (layer.kind === 'mismatch') {
                // Unreachable from `saveMetaItem`, which refuses this row at
                // the producer (D9.9) — but `applyRegistryWriteThrough` has
                // other callers (rollback, publish promotion), and registering
                // the layer anyway would put `sys_metadata` and the registry
                // back into the disagreement D9.9 exists to prevent.
                throw ObjectStackProtocolImplementation.overlayPackageMismatchError(
                    request.name, layer.packageId, layer.ownerPackageId,
                );
            }
            this.engine.registry.registerObject(
                { ...(request.item as Record<string, unknown>), _provenance: 'org' } as any,
                layer.packageId,
                undefined,
                // [ADR-0029 D9.8] The KIND, chosen by asking the registry a
                // question it can answer: does a PACKAGED owner already hold
                // this name? Registering unconditionally as `'own'` is what
                // made this seam splice the packaged contributor out and
                // destroy the code definition at write time (#6853).
                layer.kind,
            );
        } catch (err: any) {
            console.warn(
                `[Protocol] registerObject failed for ${request.name}: ${err?.message ?? err}`,
            );
        }
    }

    /**
     * [ADR-0029 D9.8/D9.9] Which contributor KIND a `sys_metadata` object row
     * registers as — and whether it may register at all.
     *
     * ```
     * packaged `own` contributor already registered for this name?
     *   no  -> `own`      (a runtime-authored object; today's behaviour, keyed
     *                      by the row's package_id or the sentinel)
     *   yes -> `overlay`  (a tenant layer over the code definition)
     * ```
     *
     * Every row this classifies came out of `sys_metadata` and is therefore
     * tenant-authored by definition, which is why the question is only about
     * the OTHER side: a runtime-authored object's owner IS the tenant's own
     * row, and re-writing it stays an ordinary re-registration rather than
     * becoming a layer over itself.
     *
     * The row's `package_id` (`P`) is provenance ON the layer, never an
     * ownership claim (D9.9), so against the packaged owner's id `O`:
     *
     * | case | verdict |
     * |:--|:--|
     * | `P == O` | the normal case — one overlay layer over `O`'s object. |
     * | `P` empty / absent (the `'sys_metadata'` sentinel) | **accepted** — a package-less env-wide overlay is ADR-0005's platform-global shape. Before D9 this THREW `already owned by package "O"`, an artefact of the borrowed `own` slot rather than a decision (#6995, measured as P2). |
     * | `P == Q`, some other package | **mismatch** — refused loudly. |
     *
     * Falls back to `'own'` — today's behaviour — for a registry that does not
     * offer the discriminator, so a duck-typed engine double is never made to
     * fail by a question it cannot answer.
     */
    private classifyObjectContribution(
        name: string,
        rowPackageId: string | null | undefined,
    ):
        | { kind: 'own' | 'overlay'; packageId: string }
        | { kind: 'mismatch'; packageId: string; ownerPackageId: string } {
        // `||`, not `??`: an empty-string binding is "no package", the same
        // normalisation both hydration seams apply to `package_id`.
        const binding = rowPackageId || '';
        const registry: any = (this.engine as any)?.registry;
        const owner = typeof registry?.getPackagedObjectOwner === 'function'
            ? registry.getPackagedObjectOwner(name)
            : undefined;
        const ownerPackageId: unknown = owner?.packageId;
        if (typeof ownerPackageId !== 'string' || ownerPackageId === '') {
            return { kind: 'own', packageId: binding || 'sys_metadata' };
        }
        if (binding !== '' && binding !== ownerPackageId) {
            return { kind: 'mismatch', packageId: binding, ownerPackageId };
        }
        return { kind: 'overlay', packageId: binding || 'sys_metadata' };
    }

    /**
     * [ADR-0029 D9.9] The mis-bound overlay refusal.
     *
     * The overlay-uniqueness index keys on
     * `(type, name, organization_id, COALESCE(package_id, ''))` (ADR-0005
     * amendment, #6825), so `sys_metadata` can legitimately hold two active
     * rows for one `(type, name)` bound to two packages. For every other type
     * that is fine — two packages really can ship `page/home`. For `object` it
     * is not representable: `computeFQN` is identity, so the registry holds
     * exactly one entry per object name and could never serve two. Refusing
     * the mis-bound row is what keeps the two stores in agreement instead of
     * letting `sys_metadata` describe a shape the registry cannot hold.
     */
    private static overlayPackageMismatchError(
        name: string, rowPackageId: string, ownerPackageId: string,
    ): Error {
        const err: any = new Error(
            `[object_overlay_package_mismatch] Cannot layer object '${name}': the overlay is bound to package `
            + `'${rowPackageId}', but the object is owned by package '${ownerPackageId}'. `
            + `An object has exactly one registry entry, so it can carry exactly one overlay layer — bind the `
            + `customization to '${ownerPackageId}', or have '${rowPackageId}' extend the object instead. `
            + `See docs/adr/0029-kernel-object-ownership-and-platform-objects-decomposition.md.`,
        );
        err.code = 'OBJECT_OVERLAY_PACKAGE_MISMATCH';
        err.status = 422;
        err.packageId = rowPackageId;
        err.ownerPackageId = ownerPackageId;
        err.docs = 'docs/adr/0029-kernel-object-ownership-and-platform-objects-decomposition.md';
        return err;
    }

    /**
     * Register ONE active overlay body into the engine's SchemaRegistry.
     *
     * The single implementation shared by the READ-side hydration
     * (`getMetaItems`) and the WRITE-side write-through
     * ({@link applyRegistryWriteThrough}) — #4521. Two copies of this rule
     * would let a read and a write leave the registry in two different
     * states for the same row, which is the class of bug the write-through
     * exists to close.
     *
     * Graft the artifact's protection envelope onto the overlay body BEFORE
     * registering: the plain-key entry written here shadows the packaged
     * artifact on `registry.getItem`, and a bare overlay body would strip
     * `_lock`/`_packageId`/`_provenance` from every registry-direct reader
     * (ADR-0010 §3.3 — an overlay must never loosen a packaged lock).
     * ADR-0048 (#1828) — scope the artifact lookup to the row's OWN package
     * so a colliding overlay no longer grafts the first-registered package's
     * provenance/lock onto another package's row.
     *
     * ── [#6602] THE ROW-SCOPE GATE LIVES HERE, AND ITS ARGUMENT IS REQUIRED ──
     *
     * ADR-0005 (revised 2026-05): **only env-wide rows
     * (`organization_id IS NULL`) enter the process-wide SchemaRegistry.**
     * Per-org overlays are served on demand by `getMetaItem` /
     * `getMetaItems` and never grafted into the shared registry, because that
     * registry has exactly one plain key per `(type, name)` and no org
     * dimension to hold them apart.
     *
     * Boot already obeyed this — `loadMetaFromDb` filters
     * `organization_id: null` and states the rule in its own comment — but
     * the two RUNTIME seams did not: {@link applyRegistryWriteThrough} gated
     * on `environmentId` alone (its TSDoc claimed the rule and the code said
     * nothing about org), and the `getMetaItems` hydration loop walked the
     * merged env-wide + org record set. Measured on an unscoped kernel, an
     * org-scoped `view` write landed in the registry under the plain key, and
     * one org-scoped listing call did the same — so org B's next listing
     * started from org A's body (#6602).
     *
     * `organizationId` is therefore a REQUIRED parameter and not an optional
     * one: an omitted org would default to "env-wide" and reinstate the exact
     * hole, whereas a required one makes every caller state the row's scope.
     * Declared = enforced, at the ONE choke point all three hydration callers
     * (boot, read-side, write-through) already share — a fourth caller cannot
     * forget a gate it has to answer to compile.
     *
     * The KERNEL-scope gate (`environmentId === undefined`) deliberately
     * stays with the callers: that is a fact about the kernel this protocol
     * instance serves, not about the row in hand.
     *
     * Returns whether anything was registered (org-scoped rows, bodies
     * without a `name`, and registry doubles without `registerItem`, are
     * no-ops).
     */
    private hydrateOverlayIntoRegistry(
        type: string,
        data: unknown,
        options: { packageId?: string | null; organizationId: string | null },
    ): boolean {
        // [#6602] ADR-0005 — a per-org overlay is served on demand, never
        // grafted into the registry every org in this process shares.
        if (options.organizationId !== null && options.organizationId !== undefined) return false;
        if (!data || typeof data !== 'object' || !('name' in data)) return false;
        const registry: any = (this.engine as any)?.registry;
        if (!registry || typeof registry.registerItem !== 'function') return false;
        const artifact = this.lookupArtifactItem(type, (data as any).name, options.packageId ?? undefined);
        registry.registerItem(type, mergeArtifactProtection(data, artifact), 'name' as any);
        this.hydrateExpandedViewItems(type, data, options, registry);
        return true;
    }

    /**
     * [#7736] Expand an aggregated `defineView` container that arrived through
     * the RUNTIME door into the same independent ViewItems the two SOURCE
     * registrars produce — at the one hydration choke point all three runtime
     * callers already share.
     *
     * "Object has-many View" (ADR-0017 §2, §3.2) makes container ingestion
     * DUAL-READ: register the container under the bare `<object>` key for
     * back-compatible single-item reads, AND register every expanded ViewItem
     * under `<object>.<viewKey>`, because only the expanded items carry the
     * `viewKind` + `object` pair that every object-bound read path filters on
     * (`GET /meta/view?object=` in `rest-server.ts`, `getViewsByObject()` in
     * `metadata-manager.ts`). Both source registrars do exactly this — the
     * ObjectQL boot loop (`engine.ts`, `key === 'views'`) and the metadata
     * artifact/HMR loader (`plugin.ts`, `isAggregatedViewContainer`) — and the
     * runtime door did not, so a container authored against a writable runtime
     * package was stored, badged `_diagnostics.valid: true`, and then served by
     * nothing: `getMetaItems` DROPS containers from enumeration (the
     * canonical-shape filter below) on the stated assumption that "the
     * registrar expands it", and for a runtime-written row no registrar ever
     * had. Measured before the fix: the stored container expands cleanly to two
     * items that WOULD match the switcher, and both object-bound exits answered
     * zero.
     *
     * Here rather than at either read exit deliberately. There are two
     * independent object-bound readers — the REST route reads through
     * `getMetaItems`, while `getViewsByObject()` reads `MetadataManager.list`
     * — so expanding at one of them fixes the card's literal repro and leaves
     * its sibling exit answering empty. This function is the ONE place all
     * three runtime hydration callers (boot `loadMetaFromDb`, read-side
     * `getMetaItems`, write-through `applyRegistryWriteThrough`) already
     * funnel through, so one expansion serves every reader, survives a restart,
     * and keeps read-your-writes — the "single, universally-applied location"
     * #7163 asked for after the same defect was fixed one seam further in.
     *
     * The canonical-shape filter in `getMetaItems` is deliberately left alone:
     * its invariant ("a container's expanded items are also present") is what
     * was false here, and this restores it rather than loosening the filter —
     * which would surface the legacy wrapper shape to every list consumer and
     * still show the switcher nothing, since a container carries no `viewKind`.
     *
     * Object-name derivation mirrors `plugin.ts` (`list.data.object` →
     * `form.data.object`), falling back to the row's own name — for a container
     * the metadata door's save name IS the object. No derivable object means no
     * expansion, exactly as the artifact loader already decides.
     */
    private hydrateExpandedViewItems(
        type: string,
        data: unknown,
        options: { packageId?: string | null; organizationId: string | null },
        registry: any,
    ): void {
        if ((PLURAL_TO_SINGULAR[type] ?? type) !== 'view') return;
        if (!isAggregatedViewContainer(data)) return;
        const container = data as Record<string, any>;
        const viewObject =
            container?.list?.data?.object
            ?? container?.form?.data?.object
            ?? (typeof container.name === 'string' ? container.name : undefined);
        if (!viewObject) return;
        for (const vi of expandViewContainer(viewObject, container)) {
            // Carry the container's package provenance onto each expanded item
            // so the package-disable filter and ADR-0048 artifact scoping judge
            // them by the same owner the container has.
            const item: Record<string, unknown> = { ...(vi as any) };
            if (container._packageId !== undefined && item._packageId === undefined) {
                item._packageId = container._packageId;
            }
            const viArtifact = this.lookupArtifactItem(
                type,
                vi.name,
                (item._packageId as string | undefined) ?? options.packageId ?? undefined,
            );
            registry.registerItem(type, mergeArtifactProtection(item, viArtifact), 'name' as any);
        }
    }

    /**
     * [#4521] Write-through the SchemaRegistry after a mutation goes LIVE, so
     * a just-saved item is dispatchable — not merely listable.
     *
     * `resolveRouteActionDeclaration` (and every other runtime consumer that
     * reads `engine.registry` directly) treats the registry as the live view
     * of metadata. Before this method the write only wrote through it for
     * `object` ({@link applyObjectRegistryMutation} returns early otherwise);
     * every other overlay type arrived in the registry solely via the
     * READ-side hydration in `getMetaItems` / `loadMetaFromDb`. That made a
     * *read* the thing that repaired the registry: a `PUT /meta/action/x`
     * followed immediately by `POST /actions/<object>/x` answered the
     * ADR-0110 "has no declaration" 404, and the very next listing call made
     * the same POST succeed (#4432 F1, split out as #4521). Read-your-writes
     * between the meta list and the dispatch path was decided by whether
     * anyone had listed yet.
     *
     * The fix is at the producer, not the consumer: no retry, no sleep and no
     * tolerance was added at the dispatch site, and ADR-0110's 404 for a
     * genuinely absent declaration is untouched — an item nobody wrote still
     * has nothing in the registry to find.
     *
     * Call ONLY after the write has landed and is live:
     *  • `saveMetaItem` repo path — post-`put()`, `mode === 'publish'` only
     *    (drafts are a staging buffer and must never leak into the runtime);
     *  • `runPublishSideEffects` — the draft→active promotion;
     *  • `rollbackMetaItem` — the restored body is the live one.
     *
     * The non-object branch carries the same `environmentId === undefined`
     * gate the read-side hydration carries: a project-scoped row must not be
     * registered into a registry that unscoped (control-plane) callers share.
     * The write must not be more permissive about that than the read is.
     *
     * [#6602] That sentence was true of the ENVIRONMENT dimension and false
     * of the ORGANIZATION one: the gate above says nothing about
     * `organization_id`, so on an unscoped kernel a per-org overlay write
     * hydrated straight into the process-wide registry under the plain key —
     * the designed per-org overlay leaking out of its org. `organizationId`
     * is now part of this request and is handed to
     * {@link hydrateOverlayIntoRegistry}, which owns the row-scope verdict
     * for all three hydration paths. Callers pass the SAME `orgId` they wrote
     * the row with, so the registry's view cannot disagree with the row's
     * scope.
     */
    private applyRegistryWriteThrough(request: {
        type: string;
        name: string;
        item?: any;
        packageId?: string | null;
        /** The row's org scope — `null` for an env-wide row. [#6602] */
        organizationId: string | null;
    }): void {
        if (request.type === 'object' || request.type === 'objects') {
            // NOT org-gated, deliberately: an `object` is `allowOrgOverride:
            // false` (ADR-0005) and its physical TABLE is env-wide, so the
            // registry entry backing it is env-wide too — `assertObjectRegistered`
            // fails CLOSED on a missing entry, and refusing to register here
            // would make a runtime-created object unreachable for data CRUD
            // rather than merely un-listed. This branch has never carried the
            // `environmentId` gate either, for the same reason.
            this.applyObjectRegistryMutation(request);
            return;
        }
        if (this.environmentId !== undefined) return;
        try {
            this.hydrateOverlayIntoRegistry(request.type, request.item, {
                packageId: request.packageId ?? undefined,
                organizationId: request.organizationId,
            });
        } catch (err: any) {
            // Best-effort, exactly like the object branch: the row is already
            // persisted, so a registry hiccup must not fail the write that
            // succeeded. It degrades to the pre-#4521 behaviour (the next
            // listing hydrates it), never to a lost write.
            console.warn(
                `[Protocol] registry write-through failed for ${request.type}/${request.name}: ${err?.message ?? err}`,
            );
        }
    }

    /**
     * Heal the in-memory registry after a metadata reset (overlay-row
     * delete). Walks the layers UNDER the deleted overlay, in order, and
     * stops at the first one that can serve the name:
     *
     *  1. Drop the plain-key runtime shadow so the packaged artifact
     *     (registered under `<packageId>:<name>`) becomes the visible
     *     value again. The shadow is written by the overlay-hydration
     *     paths (`getMetaItems` / `loadMetaFromDb`) and — pre-fix —
     *     survived the reset until restart, leaving stale overlay
     *     content (and a stripped `_lock` envelope) in every
     *     registry-direct read (ADR-0010 §3.3).
     *  2. When no composite-key artifact exists, fall back to the
     *     MetadataService baseline (FilesystemLoader-sourced types) and
     *     re-register it, preserving the historical refresh behaviour
     *     for items the SchemaRegistry never held as artifacts.
     *  3. [#5079] When NEITHER layer has anything, the deleted row was the
     *     whole item — so the plain-key entry is retired too
     *     ({@link SchemaRegistry.removeOverlayEntry}).
     *
     * ## Why step 3 exists (#5079, the #4432 residual)
     *
     * Step 1 declines for a runtime-CREATED item: `removeRuntimeShadow` only
     * un-shadows a packaged artifact, and there is none. Step 2 then found
     * nothing either — and the method returned, leaving the plain-key entry
     * that #4521's write-through had put there. Nothing else ever removed it,
     * so for the life of the process `GET /meta/<type>` kept enumerating a
     * deleted item, `GET /meta/<type>/<name>` kept serving its body, and the
     * ADR-0110 D3 declaration gate kept resolving it — while the row was gone
     * from `sys_metadata` and the handler registry had already dropped it.
     * The measured symptom: after `DELETE /meta/action/x`, `POST
     * /actions/<obj>/x` 404s with the *handler-miss* wording ("not found")
     * instead of ADR-0110's "has no declaration", because the declaration was
     * still resolvable from this stale entry. The delete's own receipt already
     * tells the truth here — #5927 splits it into "reset to artifact default"
     * (artifact-backed) vs "it no longer exists" (runtime-only); step 3 is the
     * registry making the same distinction the receipt makes.
     *
     * ## Why the layer-2 read is now diagnosed, and runs on every kernel
     *
     * [#5840] left this read on plain `get` because it "decides nothing" —
     * true then, false now: its `undefined` is what licenses step 3 to retire
     * an entry. So it goes through {@link readItemFromMetadataService}, which
     * carries the ADR-0110 D3 verdict, and a DEGRADED read stops the walk
     * without retiring anything. Retiring on an outage would answer "this
     * item exists in no layer" from a read that never reached one — the exact
     * miss-vs-outage confusion #5532/#5840 closed on the sibling paths. The
     * same helper also folds in the singular/plural retry, so a baseline
     * stored under the twin spelling is found rather than retired.
     *
     * RE-REGISTRATION stays control-plane-only (`environmentId === undefined`)
     * — the historical refresh semantics of the original call sites, unchanged.
     * Only the READ is now unconditional, because a project kernel needs the
     * same evidence before retiring an entry.
     *
     * ## Why `organizationId` is a REQUIRED parameter (#6780)
     *
     * Every tier above is `(type, name)`-addressed: `removeRuntimeShadow`
     * drops the PLAIN key, the layer-2 re-register writes the PLAIN key, and
     * `removeOverlayEntry` retires the PLAIN key. There is exactly one
     * plain-key entry per (type, name) in a process, and per ADR-0005 it
     * belongs to the ENV-WIDE row — an org-scoped overlay never enters the
     * registry at all (the rule {@link hydrateOverlayIntoRegistry} owns since
     * #6602). So a heal run on behalf of an ORG-scoped delete cannot address
     * anything of its own: it can only un-shadow or retire the entry every
     * other org and the control plane read.
     *
     * Measured on `origin/main` before this gate existed: env-wide
     * `view/shared_grid` in the registry → org A saves its own overlay (the
     * entry correctly stays `Env grid`, #6602 holding) → org A DELETEs ITS
     * OWN overlay → `registry.getItem('view','shared_grid')` is `undefined`
     * while the env-wide row still sits in `sys_metadata`. While the entry is
     * gone, direct registry readers answer as if the item does not exist
     * (ADR-0110 D3's declaration gate, `resolveRouteActionDeclaration`,
     * fail-closed `assertObjectRegistered` → 404) — one tenant's "reset my
     * customization" degrading every other tenant's runtime on the unscoped
     * kernels #5086 measured the flagship showcase booting with.
     *
     * The verdict lives HERE rather than at the call sites for the reason
     * {@link hydrateOverlayIntoRegistry} states on the register side (#6602 /
     * PR #6779): this is the ONE choke point all four heal callers already
     * route through, and a REQUIRED (never optional) `organizationId` makes a
     * fifth caller answer the question at compile time. An optional parameter
     * would default an omission to "env-wide" and reinstate the exact hole.
     *
     * REGISTER WIDE, RETIRE NARROW — the asymmetry is deliberate. The
     * write-through's `object` branch is NOT org-gated ({@link
     * applyRegistryWriteThrough}), and that carve-out does not transfer to
     * removal: it is argued from `assertObjectRegistered` failing CLOSED, so
     * a surplus entry degrades to "listable but rowless" and the next reload
     * heals it, while a wrongly retired entry 404s data CRUD for every tenant.
     * The two costs are not symmetric, so the two gates are not either.
     *
     * The KERNEL-scope gate stays where it was: `environmentId === undefined`
     * still guards re-registration only, because that is a fact about the
     * kernel this protocol instance serves, not about the row in hand.
     *
     * Best-effort: a failure must never block the delete that already
     * succeeded; the next full reload fixes the registry anyway.
     */
    private async restoreArtifactRegistryView(
        type: string,
        name: string,
        /** The DELETE's own scope — `null` for an env-wide row. [#6780] */
        organizationId: string | null,
    ): Promise<void> {
        // [#6780] ADR-0005 — the plain-key entry belongs to the env-wide row,
        // so only an env-wide removal may heal (or retire) it.
        if (organizationId !== null && organizationId !== undefined) return;
        try {
            const registry: any = this.engine.registry;
            const singular = PLURAL_TO_SINGULAR[type] ?? type;

            // ── [ADR-0029 D9.7] THE OBJECT HALF'S LAYER SUBTRACTION ──
            //
            // Runs AHEAD of the tier walk, not inside tier 3, and the reason is
            // the same asymmetry #6808 was filed for — one layer down. Tier 1
            // (`removeRuntimeShadow`) returns as soon as it heals the generic
            // `metadata` map, so an object whose plain-key shadow it can heal
            // would never reach a tier-3 limb, and its overlay LAYER would stay
            // registered in `objectContributors` — the deleted customization
            // still being served by `getObject`, which is what the data plane
            // dispatches on.
            //
            // Unconditionally correct for `object`, which is why it needs no
            // tier: the row is gone, so its layer goes with it, and whatever
            // was underneath — a packaged owner, or nothing — is what should be
            // served next. When a packaged owner IS underneath, this is the
            // whole restoration: it is already there, at its own priority, in
            // its own namespace, with its own definition, so nothing has to be
            // reconstructed from values that no longer exist (#6853's measured
            // wall).
            if (singular === 'object' && typeof registry.removeObjectOverlay === 'function') {
                registry.removeObjectOverlay(name);
            }

            let healed = false;
            if (typeof registry.removeRuntimeShadow === 'function') {
                healed = registry.removeRuntimeShadow(singular, name);
                if (type !== singular) {
                    healed = registry.removeRuntimeShadow(type, name) || healed;
                }
            }
            if (healed) return;

            const baseline = await this.readItemFromMetadataService(type, name);
            if (baseline.data !== undefined && baseline.data !== null) {
                if (this.environmentId === undefined) {
                    this.engine.registry.registerItem(type, baseline.data, 'name');
                }
                return;
            }
            // ADR-0110 D3 — an outage is not an absence. Leave the entry: it
            // is stale, which is exactly where this method already was, and a
            // later delete or reload heals it.
            if (baseline.degraded) return;

            // [#5079] No artifact, no baseline: the row WAS the item.
            if (typeof registry.removeOverlayEntry === 'function') {
                registry.removeOverlayEntry(singular, name);
                if (type !== singular) registry.removeOverlayEntry(type, name);
            }
            // [#6808] …and an `object` lives in a SECOND place, so tier 3 has a
            // second limb. `applyObjectRegistryMutation` writes both halves on
            // the way in — `registerItem` into the generic `metadata` map, and
            // `registerObject` into `objectContributors` — while every verb
            // this walk used above (`removeRuntimeShadow`, `registerItem`,
            // `removeOverlayEntry`) addresses only the first. So the walk
            // retired the listing copy and left the DISPATCH copy: measured
            // over the real `SysMetadataRepository`, after the delete
            // `metadata['object']` was empty while `registry.getObject(name)`
            // — and `getItem('object', name)`, which special-cases back to it —
            // still served the object, keeping the deleted row's schema
            // readable and WRITABLE for the life of the process.
            //
            // Same tier as `removeOverlayEntry`, and only that tier: tiers 1
            // and 2 both concluded that a lower layer still serves this name
            // (a packaged artifact, or a MetadataService baseline), and an
            // object that is still served must stay registered — retiring it
            // there would turn "reset to artifact default" into an outage,
            // because `assertObjectRegistered` fails CLOSED for the whole data
            // plane. Only "no layer serves it" licenses removal, which is the
            // verdict this branch already carries for the other half.
            //
            // The ADR-0029 extender guard lives in the registry verb (see
            // {@link SchemaRegistry.unregisterObject}) and it THROWS — which
            // this best-effort heal must not propagate: the repository delete
            // has already committed, and the operator's row is gone either
            // way. So the refusal is caught and stated, deliberately NOT left
            // to the silent outer `catch`: an extended object surviving a
            // delete is a real divergence between the store and the runtime,
            // and it must be visible in the log rather than inferred later
            // from a registry that disagrees with `sys_metadata`.
            //
            // ── AND IT NEVER RETIRES A CODE-SHIPPED OBJECT ──
            //
            // The same refusal `removeOverlayEntry` carries one line up, for
            // the same reason: unregistering shipped code that the overlay
            // delete never touched would be a worse bug than the one this
            // closes. It is asked through the protocol's OWN existing predicate
            // ({@link isArtifactBacked} → `SchemaRegistry.getArtifactItem`,
            // which for `object` reads the contributor definition and applies
            // exactly the artifact test the sibling verb applies to the plain
            // key), so this limb inherits that judgement instead of open-coding
            // a second one.
            //
            // Not theoretical, and NOT already covered by the gate at the top of
            // `deleteMetaItem`: that two-tier authorization — which refuses an
            // artifact-backed `object` outright with `not_overridable` — runs
            // only when `environmentId !== undefined`. On a CONTROL-PLANE
            // kernel it is skipped, and `revertCommit`'s soft-remove limb
            // reaches this walk without it either, so the delete can arrive
            // here for a name a code package still ships. Retiring it would
            // take that object off the whole data plane until restart, because
            // `assertObjectRegistered` fails closed.
            //
            // ── [ADR-0029 D9.7] THE LAYER-ADDRESSED VERB RUNS FIRST ──
            //
            // When a packaged owner survives underneath, the tenant's delete
            // removes ONE thing: its overlay LAYER. The packaged definition is
            // already there — its own priority, its own namespace, its own body
            // — so restoring the artifact view is a SUBTRACTION, not a
            // reconstruction. That is what dissolves #6853's measured wall
            // (the delete-time heal needed five values and three of them no
            // longer existed by the time it ran): the judgement moved to write
            // time, where the packaged owner is one lookup away.
            //
            // It also retires #7012's package-binding guard, deliberately and
            // measurably rather than by tidiness. That guard existed because
            // `isArtifactBacked` was FALSIFIED here — an overlay row bound to
            // the packaged owner's id destroyed the packaged contributor at
            // write time, so the predicate answered "not shipped" for an object
            // the package still ships. D9 removes the falsification at its
            // source: the packaged `own` contributor is never spliced out, so
            // the predicate is honest and the case the guard protected cannot
            // reach the retirement limb at all (`removeObjectOverlay` returns
            // first, and `isArtifactBacked` is true besides). What the guard
            // still reached after that was only its own ACCEPTED COST — a
            // package-bound RUNTIME-authored object (Studio's package
            // workspace, #4636), indistinguishable from a shipped one by
            // binding alone, kept listable-but-rowless until restart. With the
            // predicate honest that is no longer the cheap direction, it is
            // simply the wrong answer: nothing ships the name, the row WAS the
            // item, and the operator asked for it to be gone.
            if (
                singular === 'object'
                && !this.isArtifactBacked(singular, name)
                && typeof registry.unregisterObject === 'function'
            ) {
                try {
                    registry.unregisterObject(name);
                } catch (err: any) {
                    console.warn(
                        `[Protocol] object '${name}' was deleted from sys_metadata but stays registered: `
                        + `${err?.message ?? err}`,
                    );
                }
            }
        } catch {
            // Best-effort registry refresh; next read fixes it anyway
        }
    }

    /**
     * Ensure a just-PUBLISHED object's physical table exists so it is usable
     * for data CRUD immediately — without a server restart. Registering the
     * object (above) only updates the in-memory registry; the table is created
     * by the driver's schema sync, which otherwise only runs at boot. Without
     * this, inserting into a freshly-published object fails with "no such
     * table" (surfaced as `object_not_found`) until the next restart.
     * Best-effort + non-fatal: drivers without DDL (or read-only datasources)
     * simply no-op, and a sync failure must not abort the publish.
     */
    private async ensureObjectStorage(type: string, name: string): Promise<void> {
        if (type !== 'object' && type !== 'objects') return;
        try {
            await this.engine.syncObjectSchema(name);
        } catch (err: any) {
            console.warn(`[Protocol] table sync failed for object '${name}': ${err?.message ?? err}`);
        }
    }

    /**
     * [#4636] The package binding of a persisted overlay row, read from the
     * row itself.
     *
     * The write paths that HAVE a `packageId` parameter (`saveMetaItem`, the
     * publish promotion) pass the caller's binding straight through — the same
     * value `SysMetadataRepository.put` stamps on the row, so key and row agree
     * by construction. `rollbackMetaItem` has no such parameter: it addresses a
     * row that already exists, and the row's own `package_id` is the only
     * authoritative answer to "who owns this".
     *
     * Mirrors the repository's own `whereFor(ref, 'active', undefined)`: no
     * package predicate (match any package), scoped by org + type + name +
     * state. Deliberately NOT a `findOne` on the repository — `MetadataItem`
     * projects the body, not the binding, and widening that shared type to
     * carry one field for one caller is a contract change PR1 does not need.
     *
     * Not caught: a metadata-store outage here means the ownership key would be
     * a guess, and every caller reads this BEFORE its write, so failing is
     * still failing closed.
     */
    private async resolveOverlayPackageBinding(
        type: string,
        name: string,
        organizationId: string | null,
    ): Promise<string | null> {
        const row = await this.engine.findOne('sys_metadata', {
            where: {
                type,
                name,
                organization_id: organizationId,
                state: 'active',
            },
        });
        return (row as { package_id?: string | null } | null)?.package_id ?? null;
    }

    /**
     * Inverse of {@link ensureObjectStorage}: drop an object's physical table.
     * DESTRUCTIVE — deletes the table and all its rows. Only invoked when a
     * delete explicitly opts into storage teardown (see {@link deleteMetaItem}'s
     * `dropStorage`), so publishing an object solely to preview it can be undone
     * without leaving an orphan table. Best-effort: a failure is logged, not
     * thrown — the metadata delete already succeeded, and a stray table is
     * reclaimed by the next sync/drop rather than blocking the delete.
     */
    private async dropObjectStorage(type: string, name: string): Promise<void> {
        if (type !== 'object' && type !== 'objects') return;
        try {
            await this.engine.dropObjectSchema(name);
        } catch (err: any) {
            console.warn(`[Protocol] table drop failed for object '${name}': ${err?.message ?? err}`);
        }
    }

    /**
     * Guard for storage teardown on delete. Drops a physical table only when
     * the caller opted in AND it is safe: object types only (others have no
     * table), active state only (drafts were never materialised), and never a
     * `sys_`-prefixed platform table.
     */
    private shouldDropStorage(type: string, name: string, dropStorage: boolean | undefined, state: 'active' | 'draft'): boolean {
        if (!dropStorage) return false;
        const singular = PLURAL_TO_SINGULAR[type] ?? type;
        if (singular !== 'object') return false;
        if (state !== 'active') return false;
        if (name.startsWith('sys_')) return false;
        return true;
    }

    async saveMetaItem(request: { type: string, name: string, item?: any, organizationId?: string, parentVersion?: string | null, actor?: string, force?: boolean, mode?: 'draft' | 'publish', packageId?: string | null, source?: string }) {
        if (!request.item) {
            throw new Error('Item data is required');
        }
        // #4432 — CANONICAL TYPE KEY. See {@link canonicalMetaType}.
        request = canonicalizeMetaRequestType(request);
        // What the history row, the audit row and the watch event record as the
        // origin of this write. Defaults to this method — the ordinary Studio /
        // REST / SDK save. The only caller that overrides it is
        // {@link migrateStoredMetadata} (`'migrate-stored'`), so an operator
        // reading a diff can tell a canonicalization pass from an author's edit
        // (#4327). NOT request-derived: the REST layer builds this request field
        // by field and never forwards a client-supplied `source`, so provenance
        // stays something the server states, not something a caller claims.
        const writeSource = request.source ?? 'protocol.saveMetaItem';
        // Drop OUR OWN read decorations before anything reads the body (#4326).
        // The write path persists verbatim by design (ADR-0005 §Validation), so
        // the standard Studio round-trip — GET (decorated) → edit → PUT the whole
        // body — would otherwise bake a read-time verdict into the row, its
        // checksum, and every history diff. See {@link stripReadDecorations} for
        // why this is a silent strip and which underscore keys are NOT touched.
        // Placed first so the destructive-change diff, the schema gate, the
        // authoring gate and the persisted body all see the same document.
        request.item = stripReadDecorations(request.item);
        // [#6562] …and OUR OWN injected system columns, for the same reason and
        // at the same moment. `governServedItem` now serves the EFFECTIVE object
        // schema, so the very same Studio round-trip would otherwise persist
        // `created_at` / `owner_id` / `organization_id` / … into a body whose
        // author declared none of them — turning the platform's own columns into
        // a phantom customization in `sys_metadata`, in the checksum, in every
        // history diff, and in the layered read's `overlay` layer. Placed
        // alongside the decoration strip so the destructive-change diff, the
        // schema gate, the authoring gate and the persisted body all still see
        // one document. See {@link stripServedSystemColumns} for why this is a
        // separate strip from the decoration list and not another entry in it.
        request.item = this.stripServedObjectColumns(request.type, request.item);
        // Per-item lifecycle (ADR-0005 §"Drafts"). Default is `'publish'`
        // (legacy semantics — save goes straight live) to keep callers
        // that predate the draft/publish split working. Studio's
        // designer surface opts into staged drafts by sending
        // `?mode=draft`; the `POST /publish` endpoint then promotes it.
        const mode: 'draft' | 'publish' = request.mode === 'draft' ? 'draft' : 'publish';

        // ADR-0005 (extended — two-tier model): project-kernel customization is
        // gated by per-item provenance, not just the type-level flag.
        //
        //  • Item exists as a packaged artifact → require `allowOrgOverride`
        //    (writing here would overlay code-shipped behaviour; gated for
        //    security on executable types like hook/trigger/validation).
        //  • Item does NOT exist as an artifact → require `allowRuntimeCreate`
        //    OR `allowOrgOverride`. This lets users author brand-new hooks /
        //    validations / triggers without unlocking the artifact-shadowing
        //    capability. Returns `not_creatable` (vs `not_overridable`) so
        //    the UI can present a tailored message.
        const overlayAllowed = ObjectStackProtocolImplementation.isOverlayAllowed(request.type);
        const runtimeCreateAllowed = ObjectStackProtocolImplementation.isRuntimeCreateAllowed(request.type);

        // #5086 — CODE-ONLY TYPES ARE REFUSED ON EVERY KERNEL, not only on
        // project-scoped ones. A type whose registry entry sets BOTH
        // `allowRuntimeCreate: false` AND `allowOrgOverride: false` declares
        // that it has **no runtime write channel at all** — today `job`
        // (#4509: `handler` resolves only through the compiled bundle's
        // function table, so a runtime-created job could never be scheduled)
        // and `agent` (ADR-0063 §2: platform-owned, per-org forks withdrawn).
        //
        // The rest of this block stays behind `environmentId !== undefined`
        // because ADR-0005 §"Whitelist enforcement" deliberately keeps the
        // *overlay* whitelist off single-kernel deployments ("keep their
        // existing behaviour"). That sentence predates `allowRuntimeCreate`
        // and speaks only of the overlay list — it never granted a topology
        // the right to author a type the registry declares code-only. And the
        // premise the carve-out rests on ("this kernel is the package
        // author's own bootstrap channel") is simply not true for the CLI's
        // lightweight assembler: a host config with instantiated plugins
        // (`isHostConfig` → `shouldBootWithLibrary === false`) boots
        // `new ObjectQLPlugin()` with NO environmentId, so the flagship
        // showcase — a self-hosted app server whose `PUT /api/v1/meta/*` is
        // an END-USER surface — ran with this entire gate disengaged. Keying
        // authorization off a row-scoping key is what made a type-level
        // declaration depend on deployment topology; the declaration decides
        // it here instead.
        //
        // `isOverlayAllowed` still consults `OS_METADATA_WRITABLE`, so the
        // documented operator escape hatch stays the ONE door: unlocking a
        // type there unlocks it here too. `deleteMetaItem` is deliberately
        // NOT gated the same way — removing a code-only row that predates
        // this refusal is repair, and must stay possible.
        //
        // [#6960] THAT CARVE-OUT NOW NAMES BOTH TIERS, because as written it
        // covered only the CODE-ONLY one (`allowRuntimeCreate: false` AND
        // `allowOrgOverride: false`, i.e. the `if` immediately below) while
        // the identical argument had grown a second population: an
        // ARTIFACT-BACKED item of a type that kept `allowRuntimeCreate: true`
        // and had its `allowOrgOverride` ROLLED BACK to `false` (#6483 / PR
        // #6608 — `permission` / `position` / `page` / `app` / `dataset` /
        // `book`). Its loader still merges the overlay at read time
        // (`supportsOverlay: true`, untouched by the rollback), so a row
        // authored before the rollback keeps shaping the effective body while
        // the ordinary "Reset to package default" answered 403 — repair
        // reachable only through the operator hatch. The maintainer ruled on
        // 2026-08-10 that the delete side moves for that tier too: the
        // removal restores the code-declared state, is strictly narrowing,
        // and cannot widen anything.
        //
        // ⛔ THE ASYMMETRY IS DELIBERATE AND DELETE-ONLY. This gate and the
        // artifact-backed refusal below it are UNCHANGED: create and update
        // on such an item stay refused exactly as today. Do not "restore
        // symmetry" in either direction — symmetrizing towards delete re-opens
        // the write door #6483 closed, symmetrizing towards save re-traps the
        // repair. And the relaxation is keyed on `supportsOverlay`, not on
        // `allowOrgOverride`, so it stops at the tier boundary: `object`
        // (`supportsOverlay: false`, its overlay a contributor LAYER per
        // ADR-0029 D9) keeps refusing both verbs, which is D9.6's declared
        // cost and is pinned. See {@link deleteMetaItem}.
        if (!overlayAllowed && !runtimeCreateAllowed) {
            throw this.isArtifactBacked(request.type, request.name)
                ? ObjectStackProtocolImplementation.codeOnlyOverrideError(request.type, request.name)
                : ObjectStackProtocolImplementation.codeOnlyCreateError(request.type);
        }

        // [#6190] …and the ORG dimension of the same declaration, on the tier
        // that never consulted it. Placed HERE — before the topology carve-out
        // below, before the destructive diff, before the schema parse — for the
        // two reasons #5086 put its own refusal first: the verdict depends on
        // nothing but the type and the requested scope, and "refused, not
        // refused after writing" is the property the issue was filed about, so
        // the gate must precede every path that could persist a row. Draft
        // saves are gated identically (the branch is below): a draft is the
        // first half of the SECOND minting path this closes, and #4463 D1
        // recorded what happens when only one of the two doors gates.
        // See {@link orgScopedWriteRefusal} for the ruling and the shape.
        {
            const orgRefusal = ObjectStackProtocolImplementation.orgScopedWriteRefusal(
                request.type, request.name, request.organizationId,
            );
            if (orgRefusal) throw orgRefusal;
        }

        if (this.environmentId !== undefined) {
            const artifactBacked = this.isArtifactBacked(request.type, request.name);
            if (artifactBacked && !overlayAllowed) {
                // [#8184] THE PACKAGE DOOR — the SECOND refusal point for one
                // condition, and the reason this card exists.
                //
                // `SysMetadataRepository.assertAllowed` reads the base the
                // caller NAMED and answers `ITEM_LOCKED` (`lockSource:
                // 'package'`) when it is read-only (#7682, then #8146's
                // hatch ruling). That door is topology-INDEPENDENT — and it
                // was unreachable here, because this branch throws first on
                // every kernel with an `environmentId`. So one request
                // answered `ITEM_LOCKED` on a host-config / CLI-assembled
                // kernel and the undiscriminated `NOT_OVERRIDABLE` on a
                // project/cloud per-env one: the refusal VOCABULARY keyed off
                // a row-scoping key, which is the #5086 / #6710 finding
                // (see the block comment above) arriving on the error codes.
                // A client that learns to handle `ITEM_LOCKED` on one
                // deployment never saw it on the other.
                //
                // ⚠️ MIRRORED, NOT RE-INVENTED. Same predicate
                // ({@link isWritablePackage}, the ADR-0070 rule in one
                // place), same emitter — `readOnlyBaseOverrideError` is
                // called, not copied — so the code, the status, the
                // `lockSource`, the `packageId` and the sentence cannot drift
                // between the two doors. Two independently-authored refusals
                // for one condition is how `NOT_OVERRIDABLE`-everywhere
                // started.
                //
                // THE LIMB ORDERING IS THE RULE, and it is the same ordering
                // the repository states: BELOW every registry limb, ABOVE the
                // hatch limb.
                //   • Below the registry limb — this whole branch is guarded
                //     by `!overlayAllowed`, so an `allowOrgOverride` type
                //     never reaches the door. That is ADR-0005: an org
                //     overlay of a code-shipped item ALWAYS names the
                //     read-only package it customizes, and a door one limb
                //     higher would close the overlay model outright. Pinned.
                //   • Above the hatch limb — `isOverlayAllowed` folds
                //     `OS_METADATA_WRITABLE` in, so an OPEN hatch takes the
                //     write past this branch entirely, down to the repository
                //     door, which applies the same rule with `hatchOpen:
                //     true` and its own remedy. The hatch therefore still
                //     never unlocks package writability on this topology
                //     either (#8146 NARROW), and both directions of that
                //     remedy selection are pinned in
                //     `sys-metadata-repository.package-writability.test.ts`.
                //     That is also why `hatchOpen` is passed as a literal
                //     `false` here rather than recomputed: reaching this line
                //     PROVES the hatch is closed, and a recomputed value
                //     would be dead code dressed as a decision.
                //
                // ⛔ NARROW, exactly as the repository is: only a write that
                // NAMES a read-only base is re-coded. A package-less write
                // keeps `NOT_OVERRIDABLE` verbatim. Refusing a hatch write
                // that names NO read-only base (BROAD) retires the hatch's
                // only documented use and needs a maintainer decision plus a
                // docs/ADR change — never arrived at from here.
                //
                // `runtime-only` needs no limb here: this branch is guarded by
                // `artifactBacked`, so the intent is always
                // `override-artifact`. The create side of the door is the
                // ADR-0070 D1 gate further down this method, which is already
                // topology-independent and already answers
                // `WRITABLE_PACKAGE_REQUIRED` / 422 on every kernel.
                const namedBase = typeof request.packageId === 'string' && request.packageId.length > 0;
                if (namedBase && !this.isWritablePackage(request.packageId)) {
                    throw SysMetadataRepository.readOnlyBaseOverrideError(
                        request.type, request.packageId as string, false,
                    );
                }
                const err = new Error(
                    `[not_overridable] Metadata item '${request.type}/${request.name}' is provided by a code package `
                    + `and the type has not opted into per-org overlay writes (allowOrgOverride=false). `
                    + `Edit the source artifact and redeploy, or set OS_METADATA_WRITABLE to grant a runtime escape hatch. `
                    + `See docs/adr/0005-metadata-customization-overlay.md.`
                );
                (err as any).code = 'NOT_OVERRIDABLE';
                (err as any).status = 403;
                throw err;
            }

            // ADR-0010 L3 — per-item lock. Artifact `_lock` (or persisted
            // overlay `_lock`) blocks save independent of the L1 type-level
            // flag. Records the denial in `sys_metadata_audit` before
            // throwing so refused attempts are visible in compliance reports.
            const lockErr = await this.assertLockAllowsWrite({
                type: request.type,
                name: request.name,
                ...(request.organizationId ? { organizationId: request.organizationId } : {}),
                operation: 'save',
                ...(request.actor ? { actor: request.actor } : {}),
                source: writeSource,
            });
            if (lockErr) throw lockErr;
        }

        const singularType = PLURAL_TO_SINGULAR[request.type] ?? request.type;

        // [ADR-0029 D9.9 / #6995] The refusal that is about REPRESENTABILITY
        // rather than authorization: an `object` overlay bound to a package
        // that does not own the object. See
        // {@link overlayPackageMismatchError} for why one object name can
        // carry at most one overlay layer while `sys_metadata` can hold two
        // rows for it.
        //
        // AT THE PRODUCER, deliberately. Before D9 this row reached
        // `registerObject`, which threw `already owned by package "…"` into
        // `applyObjectRegistryMutation`'s best-effort `console.warn` — and
        // `saveMetaItem` still returned a SUCCESS RECEIPT for a write the
        // runtime had discarded (#6995, the silent write-side divergence).
        // The receipt and the registry now agree because the write never
        // happens: this precedes `ensureOverlayIndex` and every `put`.
        if (singularType === 'object') {
            const layer = this.classifyObjectContribution(request.name, request.packageId);
            if (layer.kind === 'mismatch') {
                throw ObjectStackProtocolImplementation.overlayPackageMismatchError(
                    request.name, layer.packageId, layer.ownerPackageId,
                );
            }
        }

        // Phase 3a-destructive: for object/field writes, diff against the
        // current schema and 409 if the change would drop data — unless the
        // caller has acknowledged the risk with `force: true`. The admin UI
        // surfaces the structured `issues` payload in a confirmation dialog.
        if (!request.force && (singularType === 'object' || singularType === 'field')) {
            try {
                const existing = await this.getMetaItem({
                    type: request.type,
                    name: request.name,
                    ...(request.organizationId ? { organizationId: request.organizationId } : {}),
                } as any);
                const prev = (existing as any)?.item;
                if (prev) {
                    const issues = detectDestructiveObjectChanges(prev, request.item);
                    if (issues.length > 0) {
                        const summary = issues.slice(0, 3).map((i) => i.message).join('; ');
                        const err = new Error(
                            `[destructive_change] ${request.type}/${request.name} would drop or transform existing data: ${summary}`
                            + (issues.length > 3 ? ` (+${issues.length - 3} more)` : '')
                            + ` — re-submit with ?force=true to proceed.`
                        );
                        (err as any).code = 'DESTRUCTIVE_CHANGE';
                        (err as any).status = 409;
                        (err as any).issues = issues;
                        throw err;
                    }
                }
            } catch (err: any) {
                if (err?.code === 'DESTRUCTIVE_CHANGE') throw err;
                // Other errors during the diff lookup are non-fatal —
                // they just skip the safety check.
            }
        }

        // Defense-in-depth: reject the layered *read* envelope as a write body.
        //
        // `getMetaItemLayered` returns a 3-state diagnostic shape
        // `{ type, name, code, overlay, overlayScope, effective, ... }` for the
        // Studio designer's `?layers=true` GET. That envelope is NOT a metadata
        // body — but a designer surface that lacks a dedicated editor for a
        // given type can accidentally PUT the envelope straight back, which (if
        // the per-type Zod schema below is unavailable — e.g. a type with no
        // registered schema, or a stale `@objectstack/spec` build that predates
        // the type being added to the registry) would persist an all-null stub
        // and surface as a metadata diagnostic error in the admin UI. The
        // simultaneous presence of `code`, `overlay`, `overlayScope`, and
        // `effective` is unique to the layered envelope and never appears in a
        // real metadata body, so we reject it here regardless of type/schema.
        {
            const it = request.item as Record<string, unknown>;
            const looksLikeLayeredEnvelope =
                it && typeof it === 'object' && !Array.isArray(it)
                && 'code' in it && 'overlay' in it && 'overlayScope' in it && 'effective' in it;
            if (looksLikeLayeredEnvelope) {
                const err = new Error(
                    `[invalid_metadata] ${request.type}/${request.name}: the request body is a layered read `
                    + `envelope ({ code, overlay, overlayScope, effective }), not a metadata body. `
                    + `Unwrap and send the effective/overlay document instead — the layered shape is read-only `
                    + `(GET ?layers=true) and must never be persisted.`
                );
                (err as any).code = 'INVALID_METADATA';
                (err as any).status = 422;
                throw err;
            }
        }

        // Normalize loose `view` bodies to the canonical record shape BEFORE
        // validation + persistence, so no producer (AI tools, hand-authoring,
        // Studio) can persist a view that validates but the console can't bind
        // or render (missing top-level name/object/viewKind). The registry
        // entry this overlay will shadow supplies the missing identity fields
        // (#2555 — a console personalization PUT sends only the raw config).
        // See {@link normalizeViewMetadata}.
        {
            let baseline: unknown;
            if ((PLURAL_TO_SINGULAR[request.type] ?? request.type) === 'view'
                && typeof this.engine.registry?.getItem === 'function') {
                const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
                baseline = this.engine.registry.getItem(request.type, request.name)
                    ?? (alt ? this.engine.registry.getItem(alt, request.name) : undefined);
            }
            request.item = normalizeViewMetadata(request.type, request.item, request.name, baseline);
        }

        // Canonicalize `flow` bodies BEFORE the schema gate, so an author's
        // save heals a pre-protocol row the way it heals every other type
        // (#4542). The read path serves stored flows verbatim (the ADR-0078
        // conflict guard needs the engine's executor registry — see
        // {@link resolveFlowCanonicalizer}), and `FlowNodeSchema.config` is an
        // open record, so without this pass the gate below accepts the legacy
        // dialect back and the row stays `pending` in `os migrate meta
        // --stored` forever. Persists `storable`, never the parsed shape —
        // schema defaults are deliberately excluded (ADR-0087). Copy-on-write:
        // an already-canonical body comes back reference-identical, so
        // `migrateStoredMetadata` and `duplicatePackage` re-entering here pay
        // nothing.
        if (singularType === 'flow' && request.item) {
            // No automation service reachable (control-plane / metadata-only
            // host): save exactly as today — a host must not start refusing
            // flow writes it accepted yesterday.
            const canonicalizeFlow = this.resolveFlowCanonicalizer();
            if (canonicalizeFlow) {
                let result: StoredFlowCanonicalization | undefined;
                try {
                    result = canonicalizeFlow(request.name, request.item);
                } catch (e: any) {
                    // `canonicalizeStoredFlow` is STRICTER than the gate below
                    // (strict parse + cycle detection + control-flow region
                    // validation). A work-in-progress draft with a temporary
                    // cycle must stay saveable, so fall back to the raw body
                    // and let today's gate stay the arbiter — in draft AND
                    // publish mode; `registerFlow` refuses to arm a malformed
                    // flow either way.
                    //
                    // Say so (#4580). The fallback is correct but it is the one
                    // posture here with no signal of its own: a save that
                    // skipped canonicalization is otherwise indistinguishable
                    // from one that healed the row, and a body that is BOTH a
                    // legacy dialect and unparseable re-persists verbatim —
                    // the #4542 symptom, silently, against a boot warning that
                    // told the author re-saving would fix it. Every other link
                    // in the chain is loud (ADR-0087 D2): conversions emit
                    // notices, `convertStoredItem` warns on read,
                    // `migrateStoredMetadata` reports `failed`.
                    //
                    // Deduped per flow per process, like {@link
                    // storedConversionWarned} — Studio autosave writes the same
                    // draft repeatedly and this must not become a spam loop.
                    const key = `${singularType}|${request.name}`;
                    if (!this.flowCanonicalizeFallbackWarned.has(key)) {
                        this.flowCanonicalizeFallbackWarned.add(key);
                        console.warn(
                            `[Protocol] flow/${request.name} was saved WITHOUT canonicalization: `
                            + `${e?.message ?? String(e)} The body was persisted as submitted, so a `
                            + `pre-protocol shape in it stays legacy on disk. Run `
                            + `"os migrate meta --stored" to see the row's status.`,
                        );
                    }
                    result = undefined;
                }
                if (result) {
                    if (result.conflicts.length > 0) {
                        // ADR-0078's guard refused a node-type rename because
                        // the old token is a LIVE name owned by a custom
                        // executor here. Persisting the un-renamed body would
                        // mint exactly the row this pass exists to prevent
                        // (same posture as `duplicatePackage` / #4454). 409,
                        // not 422: the body may be perfectly valid — the
                        // refusal comes from environment state, so
                        // resubmitting the same body cannot help.
                        const first = result.conflicts[0]!;
                        const err = new Error(
                            `[flow_conversion_conflict] ${request.type}/${request.name}: conversion refused — `
                            + `'${first.token}' at ${first.path} is a live name in this environment `
                            + `(${result.conflicts.length} conflict(s)). ${first.message}`
                        );
                        (err as any).code = 'FLOW_CONVERSION_CONFLICT';
                        (err as any).status = 409;
                        (err as any).conflicts = result.conflicts;
                        throw err;
                    }
                    request.item = result.storable;
                }
            }
        }

        // Spec-conformance check: if a Zod schema is registered for this
        // overlay type (see OVERLAY_VALIDATION_SCHEMAS), validate the payload
        // before persisting. We surface invalid payloads as `422
        // invalid_metadata` with structured Zod issues so the Studio form can
        // highlight the offending field. The original `item` is kept verbatim
        // — `parsed.data` would strip Studio-only auxiliary fields (e.g.
        // isPinned, isDefault, sortOrder) that intentionally ride along with
        // the overlay document. ADR-0005 §"Validation".
        //
        // [#5364] "so the Studio form can highlight the offending field" was
        // the promise; a top-level `z.union` broke it. Mapping only the issues
        // zod raises at the TOP level sent `[{path: '', message: 'Invalid
        // input', code: 'invalid_union'}]` and nothing else — and since
        // `ViewMetadataSchema` IS a top-level union, that was every failed view
        // save. {@link zodIssuesToMetadataIssues} expands the branches that
        // explain the rejection, which is where the #4001 curated prose and the
        // real key names live.
        {
            const schema = resolveOverlaySchema(request.type, request.item);
            if (schema) {
                const parsed = schema.safeParse(request.item);
                if (!parsed.success) {
                    const issues = zodIssuesToMetadataIssues(parsed.error.issues);
                    const summary = issues.slice(0, 3)
                        .map((i: { path: string; message: string }) => `${i.path || '<root>'}: ${i.message}`)
                        .join('; ');
                    const err = new Error(
                        `[invalid_metadata] ${request.type}/${request.name} failed spec validation: ${summary}`
                        + (issues.length > 3 ? ` (+${issues.length - 3} more)` : '')
                    );
                    (err as any).code = 'INVALID_METADATA';
                    (err as any).status = 422;
                    (err as any).issues = issues;
                    throw err;
                }
                // Keep the body verbatim, but not its *legacy spellings*: the
                // schema just folded them to canonical and the result would
                // otherwise be discarded, so every save minted new alias rows.
                // Two normalizations are grafted back, each by its own walk —
                // filter `operator` values ({@link graftNormalizedOperators},
                // objectui#2945) and the form `groups` → `sections` key move
                // ({@link graftFoldedFormSections}, #7134). A key move is not
                // expressible in the scalar walk, which is why there are two.
                //
                // The fold runs FIRST so the operator walk meets `sections`
                // lined up with the parsed tree rather than a `groups` key the
                // parsed side no longer has. Form sections carry no `operator`
                // today (`visibleWhen` is a CEL string), so this ordering is
                // structural hygiene rather than a measured fix — but it is the
                // ordering that stays correct if one ever does.
                request.item = graftNormalizedOperators(
                    graftFoldedFormSections(request.item, parsed.data),
                    parsed.data,
                );
            }
        }

        // The #4463 runtime authoring gate — the shared author-time rule
        // registry, on the write path. `active` saves only (D1): this is the
        // publish verb, and it is the same table `os build` gates on. Placed
        // immediately after the schema check because a rule reads a body the
        // schema already accepted — a Zod failure is the more basic verdict and
        // must be the one the author sees first.
        //
        // [#4717] The advisory half of D3 starts its journey here. `errors` is
        // thrown above as the 422; `advisories` never blocks anything, so it is
        // captured and rides the 2xx this write is about to earn. Held in a
        // local rather than on `this`: the gate is per-write and two concurrent
        // saves must not read each other's findings.
        const runtimeAdvisories = this.assertRuntimeAuthoringRules({
            type: request.type,
            name: request.name,
            state: mode === 'draft' ? 'draft' : 'active',
            body: request.item,
            source: writeSource,
            // [#6285] The write's organization partition. It was always here;
            // it simply never travelled to the gate, which is the whole reason
            // the "platform-level flow" limb could not be judged before.
            organizationId: request.organizationId ?? null,
        });

        // Pre-persistence authoring gate (#3050): a domain plugin may veto the
        // body before it persists (throws propagate to the caller with their
        // status/code). Runs for BOTH draft and publish-mode saves, so a later
        // publishMetaItem promotes an already-gated body.
        //
        // [#7674] Keyed on the DECLARED authoring channel, exactly as #6710
        // re-keyed `assertRuntimeAuthoringRules` a few hundred lines up. This
        // line used to read `if (this.environmentId !== undefined)`, and its
        // own comment reaffirmed the reasoning #6710 had already retired:
        // "control-plane bootstrap writes (environmentId undefined) are the
        // package author's own channel". They are not the only such writes.
        // The CLI's lightweight host-config assembler (`serve.ts`'s
        // `config.objects && !hasObjectQL` branch → `new ObjectQLPlugin()`
        // with no options) leaves `environmentId` undefined too, and it serves
        // an END-USER `PUT /api/v1/meta/*` — `isHostConfig` →
        // `shouldBootWithLibrary === false` is the flagship showcase's own boot
        // shape. So plugin-security's ADR-0090 D11 object posture gate — R1
        // `owd_widening_forbidden` and R2 `owd_external_wider` — ran on NO
        // self-hosted deployment at all, while `AUTHORING_RULES` deliberately
        // withheld its own `validateSecurityPosture` from the runtime surface
        // on the stated grounds that this gate already covered it
        // (`packages/lint/src/authoring-rules.ts`, `surfaceReason`). Declared,
        // not enforced, on both tables at once.
        //
        // The direction is #6710's and matters more than the mechanism: the
        // DEFAULT is the gated one, so an assembly variant nobody has thought
        // of yet gets more enforcement, never less. Only a caller that claims
        // to BE the package author is treated as one.
        if (this.authoringChannel !== 'package-author') {
            await this.runAuthoringGate({
                type: request.type,
                name: request.name,
                state: mode === 'draft' ? 'draft' : 'active',
                ...(request.organizationId ? { organizationId: request.organizationId } : {}),
                body: request.item,
            });
        }

        // 1. Update the in-memory registry (runtime cache) ONLY for the
        //    `object` type — schema definitions feed engine.syncSchema and
        //    must be reflected immediately for CRUD to work. For all other
        //    metadata types (view, dashboard, ...) we deliberately do NOT
        //    mutate the artifact-loaded registry — sys_metadata is the
        //    authoritative overlay store and `getMetaItem` consults it
        //    first (ADR-0005). Mutating the registry here would create a
        //    "stale overlay" hazard: `deleteMetaItem` cannot restore the
        //    original artifact value because it was overwritten in-place.
        // 1. (deferred) — Object-type runtime-registry mutation used to happen
        //    here unconditionally. Moved to AFTER successful persistence
        //    (PR-10d.3 rubber-duck #3): a failed put() — DB error, optimistic
        //    conflict, validation — must not leave a stale object schema in
        //    the in-memory registry. See `applyObjectRegistryMutation` below.

        // 2. Persist to sys_metadata as a customization overlay row.
        //    ADR-0005 (revised 2026-05): isolation key is `organization_id`
        //    (each env = its own DB, so environment_id is redundant). Org-scoped
        //    rows belong to the active organization in the request; env-wide
        //    overlays are written with organization_id = NULL.
        await this.ensureOverlayIndex();

        // ADR-0008 — persistence has exactly ONE route: the repository write
        // path. Every mutation appends to the change log and emits a watch
        // event with a monotonic `seq` (which Studio / browser clients consume
        // for HMR).
        //
        // #5264 — the second route is gone. A legacy raw-engine branch used to
        // sit after this block (`engine.insert`/`engine.update` straight into
        // `sys_metadata`: no history row, no watch event, no `seq`) and ran
        // whenever `isOverlayAllowed(type) || isRuntimeCreateAllowed(type)`
        // was false. #5086 (PR #5263) made that condition unreachable HERE:
        // the code-only refusal earlier in this method throws on exactly that
        // predicate, on EVERY kernel (`environmentId` no longer keys it), read
        // off the same canonical type key — `canonicalizeMetaRequestType` folds
        // plural→singular at the top, and both flag readers fold again
        // internally, so the two evaluations cannot disagree. A type that
        // reaches this line always has a repository write path.
        // `OS_METADATA_WRITABLE` is not a hole either: unlocking a type there
        // makes `isOverlayAllowed` true, which routes it right back here — one
        // door, not a bypass. The delete side's symmetric-looking branch is
        // NOT dead and was deliberately left alone; see {@link deleteMetaItem}.
        //
        // PR-10d.6 removed the `useRepositoryWritePath` flag. The repository
        // path is no longer opt-out-able for any type that gets this far.
        //
        // Callers that omit `parentVersion` get backward-compatible
        // "last-write-wins" semantics: we read the current row's checksum
        // and use it as the parent, so the conflict check tautologically
        // passes (best-effort — racy under concurrent writes; explicit
        // optimistic-lock is opt-in via `parentVersion`).
        // Callers that pass an explicit `parentVersion` (e.g. Studio after
        // reading an item) get true optimistic-lock conflict detection
        // surfaced as a 409.
        const singularTypeForRepo = PLURAL_TO_SINGULAR[request.type] ?? request.type;
        const artifactBacked = this.isArtifactBacked(singularTypeForRepo, request.name);
        const intent: 'override-artifact' | 'runtime-only' = artifactBacked
            ? 'override-artifact'
            : 'runtime-only';
        // D1 (ADR-0070) — a brand-new, DB-only ("runtime-only") metadata
        // item MUST resolve to a WRITABLE base. Binding it to a read-only
        // code/installed package makes it read back as "code-provided" and
        // lock read-only after publish (the #2252 bug). We used to silently
        // coerce such a binding to `null`, but that scattered orphans into a
        // package-less bucket with no container to delete; ADR-0070 replaces
        // the coercion with an actionable rejection so the authoring surface
        // (Studio / AI) redirects the user to pick or create a base first.
        //
        // Left untouched (the binding survives):
        //   • `override-artifact` writes — an org overlay OF a packaged item
        //     must keep pointing at the package it customizes (ADR-0005).
        //   • a project-scoped base, or a bare ADR-0048 authoring-workspace
        //     id — both are writable; `isWritablePackage` returns true.
        // A `null` packageId is still accepted here (legacy org-overlay
        // destination); ADR-0070 D5 retires it once the surfaces always
        // resolve a base and the orphan migration has run.
        if (
            intent === 'runtime-only' &&
            request.packageId != null &&
            !this.isWritablePackage(request.packageId)
        ) {
            // Surfaced verbatim as a console toast — keep the sentence
            // user-actionable; the ADR pointer lives in `docs` below.
            const err = new Error(
                `[writable_package_required] Cannot save ${singularTypeForRepo}/${request.name}: `
                + `the package '${request.packageId}' is read-only (provided by code or an installed app). `
                + `Switch to a writable package in the package selector, or create a new one, and retry.`,
            );
            (err as any).code = 'WRITABLE_PACKAGE_REQUIRED';
            (err as any).status = 422;
            (err as any).packageId = request.packageId;
            (err as any).docs = 'docs/adr/0070-package-first-authoring.md';
            throw err;
        }
        const orgId = request.organizationId ?? null;
        const repo = this.getOverlayRepo(orgId);
        const ref = {
            type: singularTypeForRepo,
            name: request.name,
            org: orgId ?? 'env',
        } as Parameters<typeof repo.put>[0];
        let parentVersion: string | null;
        if (request.parentVersion !== undefined) {
            parentVersion = request.parentVersion;
        } else {
            // Parent is scoped to the lifecycle we're about to write:
            // a draft's parent is the current draft hash (or null
            // for the first draft); a publish's parent is the
            // current published hash. ADR-0048 — scope to the same
            // package the upsert targets so a collision's other-package
            // row is never read as this item's parent.
            const current = await repo.get(ref, {
                state: mode === 'draft' ? 'draft' : 'active',
                packageId: request.packageId ?? null,
            });
            parentVersion = current?.hash ?? null;
        }
        try {
            const result = await repo.put(ref, request.item, {
                parentVersion,
                // #4556 — `actor` lands in `sys_metadata_history.recorded_by`,
                // a lookup('sys_user'). No caller actor → NULL, never the
                // sentinel string 'system' (which resolves to no user row).
                actor: request.actor ?? null,
                source: writeSource,
                intent,
                state: mode === 'draft' ? 'draft' : 'active',
                ...(request.packageId !== undefined ? { packageId: request.packageId } : {}),
            });
            // Persistence succeeded — NOW it's safe to mutate the
            // in-memory registry. If put() had thrown, the registry
            // would still reflect the prior state. Drafts are NOT
            // live: don't propagate them into the runtime registry
            // (would defeat the staging buffer).
            // #4521 — write through for EVERY overlay type, not just
            // `object`: the runtime dispatch path reads this registry,
            // so an item that is already listable must be dispatchable
            // in the same breath. See {@link applyRegistryWriteThrough}.
            if (mode === 'publish') {
                this.applyRegistryWriteThrough({
                    type: singularTypeForRepo,
                    name: request.name,
                    item: request.item,
                    packageId: request.packageId ?? null,
                    // [#6602] The SAME scope the row was just written with —
                    // a per-org overlay stays out of the shared registry.
                    organizationId: orgId,
                });
                await this.ensureObjectStorage(request.type, request.name);
            }
            // ADR-0010 — success audit (best-effort).
            await this.recordMetadataAudit({
                type: request.type,
                name: request.name,
                organizationId: orgId,
                operation: 'save',
                outcome: 'allowed',
                code: 'ok',
                ...(request.actor ? { actor: request.actor } : {}),
                source: writeSource,
                note: mode === 'draft' ? 'draft' : 'active',
            });
            // [ADR-0094] Awaited projection BEFORE the fire-and-forget
            // listeners: a derived read-model (e.g. sys_permission_set)
            // is already consistent when this save returns.
            const projectionApplied = await this.runMutationProjector({
                type: singularTypeForRepo,
                name: request.name,
                state: mode === 'draft' ? 'draft' : 'active',
                organizationId: orgId,
                body: request.item,
            });
            this.emitMetadataMutation({
                type: singularTypeForRepo,
                name: request.name,
                state: mode === 'draft' ? 'draft' : 'active',
                organizationId: orgId,
            });
            return {
                success: true,
                version: result.version,
                seq: result.seq,
                ...(projectionApplied ? { projectionApplied } : {}),
                // [#4717] #4463 D3's advisory half, finally on the response.
                //
                // CONDITIONAL on purpose, and the condition is the contract:
                // the key is omitted — never `[]` — when the gate had nothing
                // to say, so a clean save's response bytes are exactly what
                // they were before this field existed and no existing caller
                // sees a new key. `SaveMetaItemResponseSchema.advisories` is
                // declared optional for that reason, and the conformance suite
                // pins BOTH directions (present with findings, absent without),
                // because an optional key is precisely what a conformance gate
                // built on "nothing was stripped" cannot notice on its own.
                //
                // Save door only. The gate also runs on the draft→active
                // promotion (#4463 D1, so `?mode=draft` + publish is not a
                // bypass) and that door does NOT carry this field yet — its own
                // response contract only just landed as #7294. The asymmetry is
                // deliberate and stated in the changeset.
                ...(runtimeAdvisories.length > 0 ? { advisories: runtimeAdvisories } : {}),
                // #5745 — the literal union, not `string`. An object-literal
                // property widens a two-literal ternary to `string`, which made
                // this method fail to satisfy `MetadataProtocol.saveMetaItem`
                // once the spec declared `state` as the closed set it has always
                // emitted. Type-only: the value is unchanged.
                state: (mode === 'draft' ? 'draft' : 'active') as 'draft' | 'active',
                // #5265 — the receipt says only what this write path already
                // KNOWS. `artifactBacked` (computed above, and the same fact
                // `intent` is derived from) is exactly the difference between
                // the two things a save can be:
                //
                //   • override-artifact — a code-shipped artifact exists under
                //     this (type, name), so the row we just wrote customizes
                //     it. "customization overlay" is literally true; the
                //     sentence is unchanged, verbatim, on purpose.
                //   • runtime-only — nothing is being overlaid. The row IS the
                //     item. Seven registry types declare `supportsOverlay:
                //     false` yet are writable at runtime by design (`object`,
                //     `field`, `hook`, `seed`, `mapping`, `flow`, `action`),
                //     and every one of them used to be told it had "saved a
                //     customization overlay" of nothing.
                //
                // Deliberately NOT split further into created-vs-updated. The
                // available fact is `parentVersion === null`, and that is
                // scoped to (state, packageId): the first DRAFT of an item
                // that already has a live active row reads as "no parent", so
                // a `Created …` receipt derived from it would swap one false
                // claim for another. Distinguishing it honestly needs a read
                // this path does not already make, and a receipt is not worth
                // a query — so the verb stays the neutral, true "Saved".
                message: artifactBacked
                    ? (orgId
                        ? `Saved customization overlay (org=${orgId}, state=${mode === 'draft' ? 'draft' : 'active'}) — type=${request.type}, name=${request.name} [seq=${result.seq}]`
                        : `Saved customization overlay (env-wide, state=${mode === 'draft' ? 'draft' : 'active'}) — type=${request.type}, name=${request.name} [seq=${result.seq}]`)
                    : (orgId
                        ? `Saved ${singularTypeForRepo} '${request.name}' (org=${orgId}, state=${mode === 'draft' ? 'draft' : 'active'}) [seq=${result.seq}]`
                        : `Saved ${singularTypeForRepo} '${request.name}' (env-wide, state=${mode === 'draft' ? 'draft' : 'active'}) [seq=${result.seq}]`),
            };
        } catch (err: any) {
            if (err instanceof ConflictError) {
                const conflict = new Error(
                    `[metadata_conflict] ${request.type}/${request.name} has been modified since you loaded it. `
                    + `Expected parent ${err.expectedParent ?? 'null'} but current is ${err.actualHead ?? 'null'}.`,
                );
                (conflict as any).code = 'METADATA_CONFLICT';
                (conflict as any).status = 409;
                (conflict as any).expectedParent = err.expectedParent;
                (conflict as any).actualHead = err.actualHead;
                await this.recordOptimisticConflictAudit({
                    type: request.type,
                    name: request.name,
                    organizationId: orgId,
                    operation: 'save',
                    ...(request.actor ? { actor: request.actor } : {}),
                    source: writeSource,
                    expectedParent: err.expectedParent,
                    actualHead: err.actualHead,
                });
                throw conflict;
            }
            throw err;
        }
    }

    /**
     * `os migrate meta --stored` — canonicalize `sys_metadata` rows in place so
     * the read-path conversion chain has a finish line (#4327).
     *
     * #4317 made every stored-row rehydration seam replay the full ADR-0087
     * chain, so a row written under any past protocol *reads* canonical forever
     * ({@link convertStoredItem}). The rows themselves stayed legacy: the chain
     * re-lowers them on every load and each one emits a conversion notice per
     * process. This pass ends that for a deployment that runs it — same chain,
     * same policy, result written back — while the read path stays the
     * guarantee for every deployment that does not (#3855: operator-run
     * migrations cannot be relied upon, so nothing here is load-bearing).
     *
     * ## What it walks
     *
     * `active` and `draft` rows, every org (the env-wide `organization_id IS
     * NULL` bucket included). `archived` / `deprecated` rows are deliberately
     * not read: they are not served metadata, and rewriting them would edit a
     * record of what *was*. `sys_metadata_history` is untouched for the same
     * reason the addendum gives — converting a version body would break the
     * checksum↔body pairing.
     *
     * ## How it writes
     *
     * Through {@link saveMetaItem}, not the repository directly, so a rewritten
     * row gets everything an author's save gets: the schema gate, a
     * `sys_metadata_history` row, a fresh checksum, the mutation projectors and
     * the watch event Studio's HMR consumes. Three deliberate arguments:
     *
     * - `parentVersion: row.checksum` — a true optimistic lock. A concurrent
     *   writer that moved the row between our read and our write gets a 409,
     *   reported as `failed`, never a clobber.
     * - `force: true` — the destructive-change diff compares the *stored*
     *   body (which `getMetaItem` already serves converted) against the body we
     *   are about to write (the same conversion). It is empty by construction,
     *   and there is no author here for a confirmation prompt to reach.
     * - `source: 'migrate-stored'` — so a history diff distinguishes a
     *   canonicalization pass from an edit someone made.
     *
     * ## What it declines to touch, and says so
     *
     * - **`flow` rows with no reachable automation engine.** Flow-node
     *   conversions carry ADR-0078's open-namespace conflict guard, which
     *   needs the engine's live executor registry. When one is reachable —
     *   passed as `canonicalizeFlow`, or resolved from the services registry
     *   (#4498) — flows are migrated like anything else (#4454); when none is,
     *   they are reported `skipped` with that reason, never counted done.
     * - **Types with no repository write path** (neither `allowOrgOverride` nor
     *   `allowRuntimeCreate`). This pass declines them, and since #5086 it
     *   would have no choice: `saveMetaItem` refuses a code-only type with
     *   `403 NOT_CREATABLE` / `NOT_OVERRIDABLE` before persistence. The skip
     *   predates that refusal and outranks it — declining is a *reported*
     *   `skipped` row, where forwarding the write would surface as `failed`
     *   noise on every run. (Historical note for anyone reading the skip
     *   reason: until #5264 the write would instead have landed in a legacy
     *   raw-engine branch that recorded no history and forced `state:
     *   'active'`. That branch is gone; the skip is what always kept this
     *   pass away from it.)
     *
     *   Today that is exactly one type, `agent`, and its skip is **permanent
     *   by design, not a to-do** (#4507): ADR-0063 §2 closes `*.agent.ts` to
     *   third parties, so the only agent definitions in existence are the two
     *   the platform ships from version control — where git, not
     *   `sys_metadata_history`, is the change log. See the note beside the
     *   `agent` entry in `metadata-plugin.zod.ts` before treating this branch
     *   as a gap to close.
     * - **Rows that still fail the current schema after conversion.**
     *   `saveMetaItem` rejects them (422) and that rejection is correct: the
     *   body is a genuine contract violation, not chain-owned history. They
     *   surface as `failed` with the validation message, keep reading through
     *   the chain, and stay fixable in Studio.
     */
    async migrateStoredMetadata(request: {
        /** Write. Omitted / false = preview: reports what it would do, writes nothing. */
        apply?: boolean;
        /** Restrict to these metadata types (singular or plural spelling). */
        types?: string[];
        /** Recorded as the writer on the history + audit rows. */
        actor?: string;
        /**
         * Canonicalize a stored `flow` body (#4454). **Optional override** —
         * when omitted, the automation engine is resolved from the live
         * services registry (#4498, {@link resolveFlowCanonicalizer}).
         *
         * `AutomationEngine.canonicalizeStoredFlow` is the implementation.
         * Flow conversions carry ADR-0078's open-namespace conflict guard,
         * which needs the engine's executor registry to tell a rename from a
         * clobber. A caller running next to a live engine (an admin route, a
         * server task) needs to pass nothing; the CLI passes its own because
         * it boots an inert engine specifically to hold one, and an explicit
         * hook is also what makes the flow branch testable without an engine.
         *
         * When neither is available — a control-plane or metadata-only host —
         * flow rows are reported `skipped` with that reason rather than
         * quietly counted done.
         *
         * Must return the **storable** shape — conversions and the schema's
         * `condition` envelopes, without schema defaults. Throwing is a valid
         * answer for a row that cannot canonicalize; the row is reported
         * `failed` with the message.
         */
        canonicalizeFlow?: (name: string, body: unknown) => StoredFlowCanonicalization;
    } = {}): Promise<StoredMigrationReport> {
        const canonicalizeFlow = request.canonicalizeFlow ?? this.resolveFlowCanonicalizer();
        const apply = request.apply === true;
        const typeFilter = request.types && request.types.length > 0
            ? new Set(request.types.map((t) => PLURAL_TO_SINGULAR[t] ?? t))
            : null;

        const report: StoredMigrationReport = {
            apply,
            protocol: PROTOCOL_VERSION,
            scanned: 0,
            canonical: 0,
            pending: 0,
            rewritten: 0,
            skipped: 0,
            failed: 0,
            rows: [],
        };

        // Two scoped queries rather than one unfiltered scan: `state` is an
        // equality column and these are the only two states that are SERVED
        // metadata. Archived bodies are never even read.
        const rows: any[] = [];
        for (const state of ['active', 'draft'] as const) {
            rows.push(...await this.engine.find('sys_metadata', { where: { state } }));
        }

        for (const row of rows) {
            const rawType = String(row.type ?? '');
            const singular = PLURAL_TO_SINGULAR[rawType] ?? rawType;
            if (typeFilter && !typeFilter.has(singular)) continue;
            report.scanned++;

            const state: 'active' | 'draft' = row.state === 'draft' ? 'draft' : 'active';
            const organizationId: string | null = row.organization_id ?? null;
            const packageId: string | null = row.package_id ?? null;
            const base = {
                id: String(row.id ?? ''),
                type: singular,
                name: String(row.name ?? ''),
                organizationId,
                packageId,
                state,
                notices: [] as StoredMigrationNotice[],
            };
            // An already-canonical row is counted, never itemised: on a healthy
            // deployment that is every row, and a report listing all of them
            // would bury the handful that actually need something.
            const record = (entry: StoredMigrationRow): void => {
                if (entry.outcome === 'canonical') {
                    report.canonical++;
                    return;
                }
                report[entry.outcome]++;
                report.rows.push(entry);
            };

            let body: unknown;
            try {
                body = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
            } catch (e: any) {
                record({
                    ...base,
                    outcome: 'failed',
                    reason: `the stored body is not valid JSON (${e?.message ?? String(e)})`,
                });
                continue;
            }

            // Flow rows need the automation engine's live executor registry for
            // ADR-0078's open-namespace conflict guard — supplied by the caller
            // (#4454) or resolved from the services registry (#4498), and
            // reported `skipped` when neither can reach one.
            let flowResult: StoredFlowCanonicalization | undefined;
            if (singular === 'flow') {
                if (!canonicalizeFlow) {
                    record({
                        ...base,
                        outcome: 'skipped',
                        reason: 'flows canonicalize at AutomationEngine.registerFlow — the node-type '
                            + 'conflict guard needs the live executor registry, and no automation service '
                            + 'is reachable from this caller',
                    });
                    continue;
                }
                try {
                    flowResult = canonicalizeFlow(base.name, body);
                } catch (e: any) {
                    // `FlowSchema` is strict (#4001) and the region validator
                    // hard-fails, so this is a row that cannot register at all —
                    // already broken at runtime. Report it; never persist a guess.
                    record({
                        ...base,
                        outcome: 'failed',
                        reason: `the flow does not canonicalize: ${e?.message ?? String(e)}`,
                    });
                    continue;
                }
                if (flowResult.conflicts.length > 0) {
                    // A rename refused because its old token is a LIVE name owned
                    // by something else. Rewriting would clobber that owner, and
                    // skipping quietly would hide it — the guard exists to be loud.
                    const first = flowResult.conflicts[0]!;
                    record({
                        ...base,
                        outcome: 'failed',
                        reason: `conversion refused — '${first.token}' at ${first.path} is a live name in `
                            + `this environment (${flowResult.conflicts.length} conflict(s)). ${first.message}`,
                    });
                    continue;
                }
            }

            const overlayAllowed = ObjectStackProtocolImplementation.isOverlayAllowed(singular);
            const runtimeCreateAllowed = ObjectStackProtocolImplementation.isRuntimeCreateAllowed(singular);
            if (!overlayAllowed && !runtimeCreateAllowed) {
                record({
                    ...base,
                    outcome: 'skipped',
                    reason: `type '${singular}' has no repository write path (allowOrgOverride and `
                        + 'allowRuntimeCreate are both false), so a rewrite would record no history',
                });
                continue;
            }

            // A flow's canonical body was already computed above (it needs the
            // engine); everything else converts here.
            //
            // The change signal differs by type, and the difference is real.
            // For a non-flow item every rewrite comes from a conversion, and a
            // conversion always emits a notice (ADR-0087 D2 "loud"), so notices
            // are exact. A flow additionally gains the `{dialect, source}`
            // envelope the schema derives for edge conditions — that is a
            // schema transform, not a conversion, so it emits NO notice while
            // still changing the body. Both passes are copy-on-write, so
            // identity is the precise test there: `storable === body` exactly
            // when nothing was rewritten at all.
            const { item, notices } = flowResult
                ? { item: flowResult.storable, notices: flowResult.notices }
                : this.convertStoredItemDetailed(singular, body);
            const changed = flowResult ? item !== body : notices.length > 0;
            if (!changed) {
                record({ ...base, outcome: 'canonical' });
                continue;
            }
            const flattened: StoredMigrationNotice[] = notices.map((n) => ({
                conversionId: n.conversionId,
                surface: n.surface,
                from: n.from,
                to: n.to,
                path: n.path,
                message: n.message,
            }));

            if (!apply) {
                record({ ...base, notices: flattened, outcome: 'pending' });
                continue;
            }

            try {
                await this.saveMetaItem({
                    type: singular,
                    name: base.name,
                    item,
                    mode: state === 'draft' ? 'draft' : 'publish',
                    parentVersion: row.checksum ?? null,
                    packageId,
                    force: true,
                    source: 'migrate-stored',
                    actor: request.actor ?? 'migrate-stored',
                    ...(organizationId ? { organizationId } : {}),
                });
                record({ ...base, notices: flattened, outcome: 'rewritten' });
            } catch (e: any) {
                record({
                    ...base,
                    notices: flattened,
                    outcome: 'failed',
                    reason: e?.message ?? String(e),
                });
            }
        }

        return report;
    }

    /**
     * Yield the durable change-log for a single metadata item — every
     * put/delete recorded in `sys_metadata_history` for `(org, type, name)`,
     * in event_seq order. Powers the Studio "History" tab and any
     * client-side audit timeline.
     *
     * Returns `[]` for code-only types (neither `allowOrgOverride` nor
     * `allowRuntimeCreate`) instead of throwing — callers can treat "no
     * history" uniformly. Those types have no history to yield by
     * construction: `saveMetaItem` refuses them outright (#5086), and the one
     * write channel they retain — `deleteMetaItem`'s legacy raw-engine branch
     * on a control-plane kernel — appends no `sys_metadata_history` row.
     */
    async historyMetaItem(request: {
        type: string;
        name: string;
        organizationId?: string;
        sinceSeq?: number;
        limit?: number;
    }): Promise<{ events: import('@objectstack/metadata-core').MetadataEvent[] }> {
        const singularType = PLURAL_TO_SINGULAR[request.type] ?? request.type;
        if (!ObjectStackProtocolImplementation.isOverlayAllowed(singularType)
            && !ObjectStackProtocolImplementation.isRuntimeCreateAllowed(singularType)) {
            return { events: [] };
        }
        const orgId = request.organizationId ?? null;
        const repo = this.getOverlayRepo(orgId);
        const ref = {
            type: singularType,
            name: request.name,
            org: orgId ?? 'env',
        } as Parameters<typeof repo.history>[0];

        const events: import('@objectstack/metadata-core').MetadataEvent[] = [];
        const opts: { sinceSeq?: number; limit?: number } = {};
        if (request.sinceSeq !== undefined) opts.sinceSeq = request.sinceSeq;
        if (request.limit !== undefined) opts.limit = request.limit;
        for await (const ev of repo.history(ref, opts)) events.push(ev);
        return { events };
    }

    /**
     * Promote the pending draft overlay to the live (`active`) row.
     * Records a history event with `op='publish'`. 404 (`[no_draft]`)
     * when there is nothing to publish.
     */
    async publishMetaItem(request: {
        type: string;
        name: string;
        organizationId?: string;
        actor?: string;
        message?: string;
        /**
         * INTERNAL — `publishPackageDrafts` publishes many drafts and batch-applies
         * every seed body in ONE loader pass afterwards (cross-seed references need
         * multi-pass over the whole set), so it suppresses the per-item apply here.
         */
        _skipSeedApply?: boolean;
    }): Promise<{
        success: boolean;
        version: string;
        seq: number;
        message?: string;
        /**
         * Present when a `seed` draft was published: the result of materializing
         * its rows. Publishing the metadata ALWAYS succeeds independently — a
         * seed-load problem is surfaced here, never thrown, so callers (and UIs)
         * must check `seedApplied.success` instead of assuming data went live.
         */
        seedApplied?: {
            success: boolean;
            inserted: number;
            updated: number;
            error?: string;
            errors?: unknown[];
        };
        /**
         * Present when a publish-time materializer is registered for this type
         * (ADR-0086 P2 — e.g. `permission` → `sys_permission_set`): the result
         * of projecting the published body into its data-plane row. Best-effort,
         * same contract as `seedApplied` — surfaced, never thrown.
         */
        materializeApplied?: PublishMaterializeResult;
        /**
         * Present when an ADR-0094 mutation projector is registered for this
         * type: the outcome of the awaited post-persist projection. The
         * draft→active promotion runs the projector exactly as a direct active
         * save does, so this is the same receipt `saveMetaItem` returns.
         *
         * [#7294] It was ASSIGNED below and missing from this annotation, so
         * the method's declared type denied a key the wire body carried — the
         * same declared-≠-returned gap one layer down from the one #7294
         * closed on the spec side.
         */
        projectionApplied?: MutationProjectionOutcome;
    }> {
        const { singularType, orgId, result } = await this.promoteDraftForPublish(request);
        // [#7748] ADR-0010 — success audit (best-effort), the same shape
        // `saveMetaItem` and `deleteMetaItem` write on their allowed paths.
        //
        // Until this landed, the ONLY route from a publish to `recordMetadataAudit`
        // was `assertLockAllowsWrite`, which records on the DENY path and returns
        // before any write on allow. So a REFUSED publish was audited and a
        // SUCCESSFUL one was not — the inverse of what an audit trail is for.
        //
        // Written here, after `promoteDraftForPublish` has committed the
        // draft→active promotion and before the side effects: the same position
        // the other two allowed-outcome sites take (persistence durable,
        // projections not yet run). Deliberately NOT inside
        // `promoteDraftForPublish` — `publishPackageDrafts` calls that inside ONE
        // `engine.transaction()`, and an audit row that rolls back with the batch
        // is a different contract from the two existing sites, which write after
        // their repository transaction has closed. The batch path is therefore
        // still unaudited; that is filed separately rather than smuggled in here.
        await this.recordMetadataAudit({
            type: request.type,
            name: request.name,
            organizationId: orgId,
            operation: 'publish',
            outcome: 'allowed',
            code: 'ok',
            ...(request.actor ? { actor: request.actor } : {}),
            source: 'protocol.publishMetaItem',
            note: 'active',
        });
        const response: {
            success: boolean;
            version: string;
            seq: number;
            message?: string;
            seedApplied?: { success: boolean; inserted: number; updated: number; error?: string; errors?: unknown[] };
            materializeApplied?: PublishMaterializeResult;
            projectionApplied?: MutationProjectionOutcome;
        } = {
            success: true,
            version: result.version,
            seq: result.seq,
            message: `Published draft — type=${request.type}, name=${request.name} [seq=${result.seq}]`,
        };
        const effects = await this.runPublishSideEffects({
            singularType,
            requestType: request.type,
            name: request.name,
            orgId,
            body: result.item.body,
            packageId: result.packageId,
            ...(request.actor ? { actor: request.actor } : {}),
            skipSeedApply: !!request._skipSeedApply,
        });
        if (effects.seedApplied) response.seedApplied = effects.seedApplied;
        if (effects.materializeApplied) response.materializeApplied = effects.materializeApplied;
        if (effects.projectionApplied) response.projectionApplied = effects.projectionApplied;
        return response;
    }

    /**
     * Phase 1 of a publish (ADR-0067 D2) — guards + draft promotion,
     * METADATA WRITES ONLY: the draftable gate, the ADR-0010 lock check, and
     * `repo.promoteDraft` (active-row put + draft delete), with
     * optimistic-lock conflicts translated to `metadata_conflict`. Contains
     * NO side effects, so a batch caller (`publishPackageDrafts`) can run
     * many promotions inside ONE `engine.transaction()` and roll them ALL
     * back together — the "a commit cannot half-land" invariant.
     * `publishMetaItem` composes it with {@link runPublishSideEffects} for
     * the single-item path.
     */
    private async promoteDraftForPublish(request: {
        type: string; name: string; organizationId?: string; actor?: string; message?: string;
    }): Promise<{
        singularType: string;
        orgId: string | null;
        result: { version: string; seq: number; item: MetadataItem; packageId: string | null };
    }> {
        const singularType = PLURAL_TO_SINGULAR[request.type] ?? request.type;
        if (!ObjectStackProtocolImplementation.isOverlayAllowed(singularType)
            && !ObjectStackProtocolImplementation.isRuntimeCreateAllowed(singularType)) {
            const err: any = new Error(
                `[not_overridable] Metadata type '${request.type}' is not draftable — no overlay/runtime-create permission.`,
            );
            err.code = 'NOT_OVERRIDABLE';
            err.status = 403;
            throw err;
        }
        // [#6190] The draft→active promotion is the OTHER way an org-scoped row
        // of a non-org-overridable type reaches `active` — `publishMetaItem`
        // and, behind Studio's "publish whole app", `publishPackageDrafts`.
        // `saveMetaItem`'s gate now refuses to MINT such a draft, so what this
        // door closes is the promotion of residue that predates the refusal:
        // a legacy org-scoped draft row must not be promotable into a fresh
        // active phantom. Exactly the #4463 D1 posture — gating one door and
        // not the other makes the refusal bypassable by anyone who saves
        // `?mode=draft` and then POSTs `/publish`.
        {
            const orgRefusal = ObjectStackProtocolImplementation.orgScopedWriteRefusal(
                request.type, request.name, request.organizationId,
            );
            if (orgRefusal) throw orgRefusal;
        }
        // ADR-0010 L3 — lock blocks publish too (publishing is a write).
        const _publishLockErr = await this.assertLockAllowsWrite({
            type: request.type,
            name: request.name,
            ...(request.organizationId ? { organizationId: request.organizationId } : {}),
            operation: 'publish',
            ...(request.actor ? { actor: request.actor } : {}),
            source: 'protocol.publishMetaItem',
        });
        if (_publishLockErr) throw _publishLockErr;
        await this.ensureOverlayIndex();
        const orgId = request.organizationId ?? null;
        const repo = this.getOverlayRepo(orgId);

        // #4463 D1 — the OTHER way a body reaches `active`. `saveMetaItem`
        // gates a direct active save and deliberately lets every draft through;
        // that permission is only sound if the draft→active promotion gates.
        // Without this the gate would be trivially bypassable by anyone who
        // saves `?mode=draft` and then POSTs `/publish` — which is exactly what
        // Studio's designer surface does on every edit.
        const draftForGate = await repo.get(
            { type: singularType, name: request.name, org: orgId ?? 'env' } as Parameters<typeof repo.get>[0],
            { state: 'draft' },
        );
        if (draftForGate) {
            this.assertRuntimeAuthoringRules({
                type: singularType,
                name: request.name,
                state: 'active',
                body: draftForGate.body,
                // [#6285] Same partition the draft is being promoted in. Without
                // it the draft door would be a bypass for this refusal alone,
                // which is the exact hole #4463 D1 closed for the other 26.
                organizationId: orgId,
            });
        }

        const artifactBacked = this.isArtifactBacked(singularType, request.name);
        const intent: 'override-artifact' | 'runtime-only' = artifactBacked
            ? 'override-artifact' : 'runtime-only';
        const ref = {
            type: singularType,
            name: request.name,
            org: orgId ?? 'env',
        } as Parameters<typeof repo.promoteDraft>[0];
        try {
            const result = await repo.promoteDraft(ref, {
                // #4556 — NULL, not 'system', for an actor-less publish.
                actor: request.actor ?? null,
                source: 'protocol.publishMetaItem',
                ...(request.message ? { message: request.message } : {}),
                intent,
            });
            return { singularType, orgId, result };
        } catch (err: any) {
            if (err instanceof ConflictError) {
                const conflict: any = new Error(
                    `[metadata_conflict] ${request.type}/${request.name} published row advanced while you held the draft. `
                    + `Expected parent ${err.expectedParent ?? 'null'} but current is ${err.actualHead ?? 'null'}.`,
                );
                conflict.code = 'METADATA_CONFLICT';
                conflict.status = 409;
                conflict.expectedParent = err.expectedParent;
                conflict.actualHead = err.actualHead;
                await this.recordOptimisticConflictAudit({
                    type: request.type,
                    name: request.name,
                    organizationId: orgId,
                    operation: 'publish',
                    ...(request.actor ? { actor: request.actor } : {}),
                    source: 'protocol.publishMetaItem',
                    expectedParent: err.expectedParent,
                    actualHead: err.actualHead,
                });
                throw conflict;
            }
            throw err;
        }
    }

    /**
     * Phase 2 of a publish (ADR-0067 D2) — the post-promotion side effects:
     * runtime object-registry refresh, table DDL, single-item seed apply,
     * the ADR-0086 P2 publish materializer, the ADR-0094 awaited projector,
     * and the mutation event. Everything here is (a) non-transactional by
     * nature (DDL cannot run inside the driver transaction; the registry is
     * in-memory; projections are best-effort) and (b) healed by boot
     * reconciliation when it fails — which is why a batch publish runs it
     * AFTER the metadata transaction commits: side effects can self-heal, a
     * half-landed metadata batch cannot (the ADR-0094 lesson).
     */
    private async runPublishSideEffects(args: {
        singularType: string;
        requestType: string;
        name: string;
        orgId: string | null;
        body: unknown;
        packageId: string | null;
        actor?: string;
        skipSeedApply?: boolean;
    }): Promise<{
        seedApplied?: { success: boolean; inserted: number; updated: number; error?: string; errors?: unknown[] };
        materializeApplied?: PublishMaterializeResult;
        projectionApplied?: MutationProjectionOutcome;
    }> {
        const out: {
            seedApplied?: { success: boolean; inserted: number; updated: number; error?: string; errors?: unknown[] };
            materializeApplied?: PublishMaterializeResult;
            projectionApplied?: MutationProjectionOutcome;
        } = {};
        // Drafts skipped the registry mutation; on publish we now refresh the
        // runtime registry so live behaviour catches up immediately (matches
        // saveMetaItem's post-persistence registry update path — #4521 makes
        // that path cover every overlay type, so promoting a drafted action
        // makes it dispatchable at once instead of at the next listing).
        this.applyRegistryWriteThrough({
            type: args.singularType,
            name: args.name,
            item: args.body,
            packageId: args.packageId,
            // [#6602] The promoted draft carries the org it was drafted in.
            organizationId: args.orgId,
        });
        // Create the object's table now so it's CRUD-able without a restart.
        await this.ensureObjectStorage(args.requestType, args.name);
        // Publishing a `seed` is what makes its rows live — materialize them
        // NOW (best-effort, never fails the publish) so every publish path
        // (per-ref REST publish, the home banner, package publish-drafts)
        // lands data, not just metadata. The body is already in hand from
        // the promote — no read-back, so no org-scope resolution pitfalls.
        if (args.singularType === 'seed' && !args.skipSeedApply) {
            out.seedApplied = await this.applySeedBodies([args.body], args.orgId);
        }
        // Publish-time materializer (ADR-0086 P2): project the published body
        // into its data-plane row (e.g. `permission` → `sys_permission_set`
        // with `managed_by:'package'`). Unlike seeds this needs no batch
        // ordering — permission sets carry no cross-item references — so it
        // runs on every publish path, package-draft batch included. The
        // owning `package_id` rides on the draft's binding, so a package-door
        // set materializes under the right owner.
        const materializer = this.publishMaterializers.get(args.singularType);
        if (materializer) {
            try {
                out.materializeApplied = await materializer({
                    body: args.body,
                    packageId: args.packageId,
                    organizationId: args.orgId,
                    actor: args.actor ?? 'system',
                });
            } catch (e: any) {
                out.materializeApplied = {
                    success: false, inserted: 0, updated: 0,
                    error: e?.message ?? 'materialize failed',
                };
            }
        }
        // [ADR-0094] Awaited projection: runs AFTER the package-door
        // materializer (which stamps package provenance) so the projector
        // sees final record state; refuses/no-ops per its own rules.
        const publishProjection = await this.runMutationProjector({
            type: args.singularType,
            name: args.name,
            state: 'active',
            organizationId: args.orgId,
            body: args.body,
        });
        if (publishProjection) out.projectionApplied = publishProjection;
        this.emitMetadataMutation({
            type: args.singularType,
            name: args.name,
            state: 'active',
            organizationId: args.orgId,
        });
        return out;
    }

    /**
     * Materialize published `seed` bodies into data rows via the SeedLoaderService
     * (externalId-keyed upsert, multi-pass for cross-seed references). Passing ALL
     * of a publish's seed bodies in ONE call lets a child seed reference a parent
     * seed's rows regardless of publish order. Best-effort: any failure is
     * returned, never thrown — publishing metadata must not be blocked by a data
     * problem, but the caller surfaces `seedApplied` so the failure is LOUD.
     */
    private async applySeedBodies(
        bodies: unknown[],
        organizationId: string | null,
    ): Promise<{ success: boolean; inserted: number; updated: number; error?: string; errors?: unknown[] }> {
        try {
            const seeds = bodies.filter(
                (b: any) => b && typeof b.object === 'string' && Array.isArray(b.records),
            );
            if (seeds.length === 0) {
                return { success: false, inserted: 0, updated: 0, error: 'seed apply: no readable seed bodies' };
            }
            const { SeedLoaderService } = await import('./seed-loader.js');
            const { SeedLoaderRequestSchema } = await import('@objectstack/spec/data');
            // The loader only needs `getObject` from IMetadataService (dependency
            // graph + field introspection); satisfy it from the protocol's own
            // metadata reads so no kernel service lookup is required.
            const metadataAdapter = {
                getObject: async (name: string) => {
                    const wrapper: any = await (this as any).getMetaItem({
                        type: 'object',
                        name,
                        ...(organizationId ? { organizationId } : {}),
                    });
                    return wrapper?.item ?? wrapper ?? null;
                },
            };
            const loader = new SeedLoaderService(
                this.engine as any,
                metadataAdapter as any,
                console as any,
            );
            const request = SeedLoaderRequestSchema.parse({
                seeds,
                config: {
                    defaultMode: 'upsert',
                    multiPass: true,
                    ...(organizationId ? { organizationId } : {}),
                },
            });
            const r = await loader.load(request);
            return {
                success: r.success,
                inserted: r.summary.totalInserted,
                updated: r.summary.totalUpdated,
                ...(r.errors?.length ? { errors: r.errors } : {}),
            };
        } catch (e: any) {
            return { success: false, inserted: 0, updated: 0, error: e?.message ?? 'seed apply failed' };
        }
    }

    /**
     * List pending DRAFT metadata (ADR-0033) for the org, optionally narrowed
     * by `packageId` and/or `type`. The list reads of `getMetaItems` only see
     * the ACTIVE registry; this exposes what an AI authored but a human hasn't
     * published yet, so the console can show a "pending changes" surface and a
     * just-built app package isn't displayed as empty. No body is returned.
     */
    async listDrafts(request?: {
        packageId?: string;
        type?: string;
        organizationId?: string;
    }): Promise<{
        drafts: Array<{
            type: string;
            name: string;
            organizationId: string | null;
            packageId: string | null;
            updatedAt: string | null;
            updatedBy: string | null;
        }>;
    }> {
        await this.ensureOverlayIndex();
        const orgId = request?.organizationId ?? null;
        const repo = this.getOverlayRepo(orgId);
        const drafts = await repo.listDrafts({
            ...(request?.type ? { type: PLURAL_TO_SINGULAR[request.type] ?? request.type } : {}),
            ...(request?.packageId ? { packageId: request.packageId } : {}),
        });
        return { drafts };
    }

    /**
     * Publish every pending DRAFT bound to a package in one shot (ADR-0033) —
     * the "publish whole app" action. Promotes each draft→active by reusing the
     * per-item {@link publishMetaItem} primitive (which runs the overridable /
     * lock guards and refreshes the runtime registry), so this needs NO
     * `metadata` service (unlike `MetadataService.publishPackage`, which reads
     * the in-memory registry and 503s when that service is absent). Per-item
     * failures are collected and do NOT abort the rest.
     */
    async publishPackageDrafts(request: {
        packageId: string;
        organizationId?: string;
        actor?: string;
        /** ADR-0067 — commit message (for AI turns: the user's instruction). */
        message?: string;
        /** ADR-0067 — AI model that authored the turn (absent for human/CLI). */
        aiModel?: string;
    }): Promise<{
        success: boolean;
        publishedCount: number;
        failedCount: number;
        published: Array<{ type: string; name: string; version: string }>;
        failed: Array<{ type: string; name: string; error: string; code?: string }>;
        /** Aggregate result of materializing every published `seed` (absent when no seeds). */
        seedApplied?: { success: boolean; inserted: number; updated: number; error?: string; errors?: unknown[] };
        /**
         * ADR-0086 P2 — aggregate result of publish-time materializers across the
         * batch (e.g. `permission` → `sys_permission_set`). Absent when no
         * published item had a registered materializer. `failures` names each
         * item whose projection did NOT land (e.g. a permission-set name owned by
         * the env door or another package) so the caller surfaces it instead of
         * reporting a clean publish over a set that never went live.
         */
        materializeApplied?: {
            success: boolean;
            inserted: number;
            updated: number;
            failures: Array<{ type: string; name: string; error: string }>;
        };
        /**
         * ADR-0038 L3 — post-publish runtime probe report (absent when nothing
         * was publishable). One real read per published artifact: seeded
         * objects must have rows, views must be readable, dashboard widgets'
         * dataset selections must execute and return data. `issues` carries
         * BuildIssue-shaped findings (layer 'runtime') for the agent / chat
         * health surfaces; probes never fail the publish itself.
         */
        probes?: import('./build-probes.js').BuildProbeReport;
        /** ADR-0067 — id of the commit this publish recorded (absent if nothing published). */
        commitId?: string;
    }> {
        await this.ensureOverlayIndex();
        const orgId = request.organizationId ?? null;
        const repo = this.getOverlayRepo(orgId);
        const drafts = await repo.listDrafts({ packageId: request.packageId });

        // Runtime enforcement of the package namespace-prefix rule (ADR-0028
        // current-state contract). `defineStack` enforces this at compile time,
        // but Studio-authored packages never take that path — so a bare,
        // collision-prone object name (`ticket` instead of `leave_ticket`)
        // could publish unchecked. Read the package's DECLARED namespace and
        // reject any object draft missing the `<ns>_` prefix BEFORE promoting
        // anything — the publish is atomic, so one bad name fails the whole
        // batch with an actionable message. Like `defineStack`, we do NOT
        // invent a prefix here when the package declares no namespace (legacy
        // packages are grandfathered); the default is derived+persisted once at
        // install time (`installPackage`), so real Studio packages always have
        // one by the time they publish.
        const pkgNamespace = this.engine?.registry?.getPackage?.(request.packageId)?.manifest?.namespace;
        /**
         * Every PRE-FLIGHT refusal of this batch, in one report.
         *
         * The namespace-prefix rule established the posture and the
         * ADR-0121 endpoint gates below join it: a violation is found BEFORE
         * anything is promoted, and it fails the WHOLE batch
         * (`publishedCount: 0`, `published: []`) rather than publishing the
         * healthy siblings around it. That is not a choice made here — it is
         * ADR-0067 D2's turn-atomicity ("a commit cannot half-land") read
         * backwards onto the pre-flight, and it is what `MetadataManager.
         * publishPackage` does with the same gates on the other path (#5189):
         * one `validationErrors` list, `itemsPublished: 0`.
         *
         * Both gates run before the report is returned, so an author fixing a
         * package sees the object-name violations AND the endpoint violations
         * in one round trip instead of one class per publish attempt.
         */
        const preflightViolations: Array<{ type: string; name: string; error: string; code: string }> = [];
        if (pkgNamespace) {
            for (const d of drafts) {
                if (d.type !== 'object') continue;
                const err = validateObjectNamespacePrefix(d.name, pkgNamespace);
                if (err) preflightViolations.push({ type: d.type, name: d.name, error: err, code: 'NAMESPACE_PREFIX' });
            }
        }

        // [#5488 — RETIRED GATE, recorded overturn of PR #5279]
        //
        // `gateApiDraftsForPublish` stood here (#5206 step 2, #5040 E7 /
        // ADR-0121) and ran the endpoint publish gates over this batch's `api`
        // drafts. It is deliberately REMOVED, two days after it landed, by the
        // maintainer ruling of 2026-08-07T16:59Z implemented in #5488 — not
        // deleted as dead weight and not lost in a refactor.
        //
        // Why it can go: the gate judged whether an `api` draft was fit to be
        // PROMOTED TO ACTIVE in `sys_metadata`. No such row is ever served. The
        // serving criterion belongs to `IMetadataService.matchEndpoint` →
        // `EndpointMatcher` → `MetadataManager.listForIndex('api')`, which
        // reads the manager's registry plus its filesystem/memory loaders;
        // `sys_metadata` is in neither, so a promoted endpoint 404s forever
        // (real boot, #5488 — no `EXCLUDED` line, because it was never in the
        // index to be excluded from). The gate was a correct verdict about a
        // state with no consumer.
        //
        // Why it MUST go rather than sit unreached: `api` is now code-only
        // (`allowRuntimeCreate: false` + `allowOrgOverride: false`), and the
        // #5086 inlet refuses the write BEFORE persistence and BEFORE the
        // draft/publish branch — it does not look at `mode`. So no `api` draft
        // row can be created any more, and this gate could never again see one.
        // Leaving it would leave unreachable code asserting a rule about a row
        // that cannot exist, which is the shape of a phantom check.
        //
        // What still judges endpoints, unchanged: `validateApiEndpointDeclarations`
        // / `identityFreeEndpointGateFailure` (`api/endpoint-publish-gate.ts`)
        // on the route that actually serves — the stack schema, `publishPackage`
        // (#5189), and again at load in `buildEndpointIndex` (PR #5203). ADR-0121
        // keeps its "publish REJECTS" ruling in full on that route; only the
        // runtime-authored-draft door it used to also cover is gone, because
        // that door opened onto nothing.
        //
        // Re-entry, as the ruling recorded it: if #2657 Part B promotes `apis`
        // to a registered type WITH A REAL CONSUMPTION PATH, this gate comes
        // back with it — implementation first, declaration second.

        if (preflightViolations.length > 0) {
            return {
                success: false,
                publishedCount: 0,
                failedCount: preflightViolations.length,
                published: [],
                failed: preflightViolations,
            };
        }

        const published: Array<{ type: string; name: string; version: string }> = [];
        const failed: Array<{ type: string; name: string; error: string; code?: string; issues?: Array<{ path: string; message: string; code?: string }> }> = [];

        // Structure first, seeds LAST — a seed's rows can only land after its
        // object's table exists (publishMetaItem creates it). Within the seeds we
        // batch-apply every body in ONE loader pass below (multi-pass reference
        // resolution across the whole set), so per-item apply is suppressed.
        const ordered = [
            ...drafts.filter((d) => d.type !== 'seed'),
            ...drafts.filter((d) => d.type === 'seed'),
        ];
        const seedBodies: unknown[] = [];

        // ADR-0067 — capture each artifact's PRE-publish state so this turn can
        // be recorded as ONE revertible commit. existedBefore=false → the commit
        // creates it (revert = soft-remove); true → it edits an existing artifact
        // (revert = restoreVersion(prevVersion)). Best-effort: a capture failure
        // just omits that item from the revert plan, never blocks the publish.
        const commitItems: Array<{ type: string; name: string; existedBefore: boolean; prevVersion: number | null }> = [];
        for (const d of ordered) {
            try {
                // Read the pre-publish active row in the draft's OWN scope
                // (env-wide drafts have env-wide active rows). Using the
                // request's active org here would miss an env-wide edit and
                // mis-record it as a create in the revert plan (#3115).
                const activeRow = (await this.engine.findOne('sys_metadata', {
                    where: { organization_id: d.organizationId ?? null, type: d.type, name: d.name, state: 'active' },
                })) as { version?: number } | null;
                commitItems.push({
                    type: d.type,
                    name: d.name,
                    existedBefore: !!activeRow,
                    prevVersion: activeRow && typeof activeRow.version === 'number' ? activeRow.version : null,
                });
            } catch {
                commitItems.push({ type: d.type, name: d.name, existedBefore: false, prevVersion: null });
            }
        }
        const publishedSeqs: number[] = [];
        // ADR-0086 P2 — accumulate each item's publish-time materialization so a
        // batch package publish surfaces a permission set that failed to go live
        // (owned by the env door / another package), not just a clean count.
        const materialize = { any: false, inserted: 0, updated: 0, failures: [] as Array<{ type: string; name: string; error: string }> };

        // ═══ Phase 1 — ATOMIC metadata writes (ADR-0067 D2) ═══
        // Every draft promotion AND the sys_metadata_commit record run inside
        // ONE engine transaction: any failure rolls ALL of them back — "a
        // commit cannot half-land". Nested repository writes JOIN this
        // transaction via the engine's ambient-tx join (a nested begin would
        // deadlock single-connection pools), and side effects are deliberately
        // deferred to Phase 2: DDL cannot run inside the driver transaction,
        // in-memory registry mutations cannot roll back, and projections /
        // probes are healed by boot reconciliation — side effects can
        // self-heal, a half-landed metadata batch cannot (the ADR-0094
        // lesson). Engines without `transaction()` (memory driver, minimal
        // stubs) fall through to a plain sequential run with the same weaker
        // guarantee the repository's `withTxn` documents.
        type PromotedDraft = {
            d: { type: string; name: string };
            singularType: string;
            body: unknown;
            packageId: string | null;
            version: string;
            seq: number;
        };
        const promoted: PromotedDraft[] = [];
        // (assigned inside the transaction closure — keep the wide type)
        let commit = null as { commitId: string } | null;
        // ADR-0119 D1 — `transaction` is contract-declared, so this reaches it
        // by name instead of through a structural cast. Bound once up front:
        // the probe and the call must agree on one resolved function.
        const engineTx = typeof this.engine?.transaction === 'function'
            ? this.engine.transaction.bind(this.engine)
            : undefined;
        const inTxn: <T>(cb: () => Promise<T>) => Promise<T> =
            engineTx ? (cb) => engineTx(() => cb()) : (cb) => cb();
        try {
            await inTxn(async () => {
                for (const d of ordered) {
                    try {
                        // Promote each draft in the scope `listDrafts` surfaced
                        // it from (#3115). Studio/package authoring writes the
                        // draft env-wide (`organization_id = NULL`) while the
                        // publishing session may carry a non-null active org;
                        // `listDrafts` includes those env-wide rows via its `$or`,
                        // so the promote MUST target the draft's own org or it
                        // 404s (`no_draft`) on a row it can never match.
                        const draftOrgId = d.organizationId ?? null;
                        if (d.type === 'seed') {
                            // Capture the body BEFORE promote (the draft row is
                            // deleted by the promote, and a post-publish read-back
                            // has org-scope resolution pitfalls — reading the
                            // draft is unambiguous). Read from the draft's own
                            // scope, not the request's active org.
                            const seedRepo = this.getOverlayRepo(draftOrgId);
                            const ref = { type: d.type, name: d.name, org: draftOrgId ?? 'env' } as unknown as Parameters<typeof seedRepo.get>[0];
                            const draft = await seedRepo.get(ref, { state: 'draft' });
                            if (draft?.body) seedBodies.push(draft.body);
                        }
                        const { singularType, result } = await this.promoteDraftForPublish({
                            type: d.type,
                            name: d.name,
                            ...(draftOrgId ? { organizationId: draftOrgId } : {}),
                            ...(request.actor ? { actor: request.actor } : {}),
                            message: `publish app package '${request.packageId}'`,
                        });
                        promoted.push({
                            d, singularType,
                            body: result.item.body,
                            packageId: result.packageId,
                            version: result.version,
                            seq: result.seq,
                        });
                        if (typeof result.seq === 'number') publishedSeqs.push(result.seq);
                    } catch (e: unknown) {
                        // Tag the causal item and abort — the surrounding
                        // transaction rolls back every promotion made so far.
                        const err = e instanceof Error ? e : new Error(String(e));
                        (err as { __batchItem?: unknown }).__batchItem = d;
                        throw err;
                    }
                }
                // ADR-0067 — record this turn as ONE commit, INSIDE the same
                // transaction as the promotions it describes: the commit row and
                // the published state land or roll back together, so a recorded
                // commit can never describe a partial publish.
                if (promoted.length > 0) {
                    const promotedKeys = new Set(promoted.map((p) => `${p.d.type}/${p.d.name}`));
                    commit = await this.recordPackageCommit({
                        orgId,
                        packageId: request.packageId,
                        operation: 'apply',
                        ...(request.message ? { message: request.message } : {}),
                        ...(request.actor ? { actor: request.actor } : {}),
                        ...(request.aiModel ? { aiModel: request.aiModel } : {}),
                        items: commitItems.filter((it) => promotedKeys.has(`${it.type}/${it.name}`)),
                        ...(publishedSeqs.length
                            ? { eventSeqStart: Math.min(...publishedSeqs), eventSeqEnd: Math.max(...publishedSeqs) }
                            : {}),
                    });
                }
            });
        } catch (e: any) {
            // The batch rolled back — NOTHING landed (ADR-0067 D2). Report the
            // causal item with its real error; every other draft is marked
            // BATCH_ABORTED so the caller sees the all-or-nothing semantics
            // instead of inferring them from publishedCount 0.
            const causal = e?.__batchItem as { type: string; name: string } | undefined;
            const failedOut = ordered.map((d) =>
                causal && d.type === causal.type && d.name === causal.name
                    ? {
                        type: d.type, name: d.name,
                        error: e?.message ?? 'publish failed',
                        ...(e?.code ? { code: e.code } : {}),
                        // Carry structured spec-validation issues so the publish
                        // surface can point at the offending field.
                        ...(Array.isArray(e?.issues) ? { issues: e.issues } : {}),
                    }
                    : {
                        type: d.type, name: d.name,
                        error: `not published — the batch is all-or-nothing (ADR-0067 D2) and `
                            + `${causal ? `${causal.type}/${causal.name}` : 'another item'} failed; the transaction rolled back`,
                        code: 'BATCH_ABORTED',
                    });
            return {
                success: false,
                publishedCount: 0,
                failedCount: failedOut.length,
                published: [],
                failed: failedOut,
            };
        }

        // ═══ Phase 2 — side effects, after the metadata committed ═══
        // Registry refresh, DDL, materializers, projections, events — per item
        // in publish order. Best-effort at the batch level: the metadata IS
        // live at this point, so a side-effect failure must be surfaced (via
        // materialize.failures / probes), never turned into a fake unpublish.
        for (const p of promoted) {
            published.push({ type: p.d.type, name: p.d.name, version: p.version });
            try {
                const eff = await this.runPublishSideEffects({
                    singularType: p.singularType,
                    requestType: p.d.type,
                    name: p.d.name,
                    orgId,
                    body: p.body,
                    packageId: p.packageId,
                    ...(request.actor ? { actor: request.actor } : {}),
                    skipSeedApply: true,
                });
                if (eff.materializeApplied) {
                    materialize.any = true;
                    materialize.inserted += eff.materializeApplied.inserted;
                    materialize.updated += eff.materializeApplied.updated;
                    if (!eff.materializeApplied.success) {
                        materialize.failures.push({
                            type: p.d.type, name: p.d.name,
                            error: eff.materializeApplied.error ?? 'materialize failed',
                        });
                    }
                }
            } catch (e: any) {
                // Boot reconciliation heals registry/DDL/projection drift; the
                // published metadata is authoritative. Surface, don't lie.
                console.warn(
                    `[Protocol] publish side effects failed for ${p.d.type}/${p.d.name}: ${e?.message ?? e}`,
                );
                materialize.any = true;
                materialize.failures.push({
                    type: p.d.type, name: p.d.name,
                    error: `side effects failed (metadata is live; boot reconciliation heals): ${e?.message ?? 'unknown'}`,
                });
            }
        }

        const seedApplied = seedBodies.length > 0 ? await this.applySeedBodies(seedBodies, orgId) : undefined;

        // ADR-0038 L3: exercise what was just published — one real read per
        // artifact — so "Published!" can never again mean "and silently
        // broken". Best-effort by design: a probe crash is swallowed (the
        // publish already happened and must report as such), and findings ride
        // the response for the agent / chat health card to act on.
        let probes: import('./build-probes.js').BuildProbeReport | undefined;
        if (published.length > 0) {
            try {
                const { runBuildProbes } = await import('./build-probes.js');
                const analytics = this.getServicesRegistry?.().get('analytics');
                probes = await runBuildProbes({
                    engine: this.engine as any,
                    getItem: async (type, name) => {
                        const wrapper: any = await (this as any).getMetaItem({
                            type,
                            name,
                            ...(orgId ? { organizationId: orgId } : {}),
                        });
                        return wrapper?.item ?? wrapper ?? undefined;
                    },
                    published,
                    ...(analytics && typeof analytics.queryDataset === 'function' ? { analytics } : {}),
                    organizationId: orgId,
                });
            } catch {
                probes = undefined;
            }
        }

        // ADR-0067 D2 — the commit record was written INSIDE the Phase-1
        // transaction above, together with the promotions it describes.

        return {
            success: failed.length === 0 && published.length > 0,
            publishedCount: published.length,
            failedCount: failed.length,
            published,
            failed,
            ...(seedApplied ? { seedApplied } : {}),
            ...(materialize.any
                ? { materializeApplied: {
                    success: materialize.failures.length === 0,
                    inserted: materialize.inserted,
                    updated: materialize.updated,
                    failures: materialize.failures,
                } }
                : {}),
            ...(probes ? { probes } : {}),
            ...(commit ? { commitId: commit.commitId } : {}),
        };
    }

    /**
     * Discard every pending DRAFT bound to a package — the NON-destructive
     * inverse of {@link publishPackageDrafts}. Drops only `state='draft'` rows
     * (via the per-item delete primitive), reverting the package to its last
     * published baseline; active/published metadata and physical tables are
     * left untouched.
     *
     * Use case: "I edited this app for a while and it turned out worse than
     * before — abandon all my changes." Routes through the sys_metadata path
     * (no metadata-service dependency, unlike `POST /packages/:id/revert`).
     */
    async discardPackageDrafts(request: {
        packageId: string;
        organizationId?: string;
        actor?: string;
    }): Promise<{
        success: boolean;
        discardedCount: number;
        failedCount: number;
        discarded: Array<{ type: string; name: string }>;
        failed: Array<{ type: string; name: string; error: string; code?: string }>;
    }> {
        await this.ensureOverlayIndex();
        const orgId = request.organizationId ?? null;
        const repo = this.getOverlayRepo(orgId);
        const drafts = await repo.listDrafts({ packageId: request.packageId });

        const discarded: Array<{ type: string; name: string }> = [];
        const failed: Array<{ type: string; name: string; error: string; code?: string }> = [];

        for (const d of drafts) {
            try {
                // Discard the draft in the scope it lives in (#3115). Like
                // publish, `listDrafts` surfaces env-wide drafts to a non-null
                // active org via `$or`; deleting under the request's active org
                // would silently no-op on those env-wide rows.
                const draftOrgId = d.organizationId ?? null;
                await this.deleteMetaItem({
                    type: d.type,
                    name: d.name,
                    state: 'draft',
                    ...(draftOrgId ? { organizationId: draftOrgId } : {}),
                    ...(request.actor ? { actor: request.actor } : {}),
                });
                discarded.push({ type: d.type, name: d.name });
            } catch (e: any) {
                // [#8136] Same source, same reasoning as `deletePackage`'s
                // `failed[]` collector below: this `try` wraps only
                // `deleteMetaItem`, whose exits all now either declare a
                // refusal or withhold at the source. Clean derivatively; no
                // filter of its own.
                failed.push({
                    type: d.type,
                    name: d.name,
                    error: e?.message ?? 'discard failed',
                    ...(e?.code ? { code: e.code } : {}),
                });
            }
        }

        return {
            success: failed.length === 0 && discarded.length > 0,
            discardedCount: discarded.length,
            failedCount: failed.length,
            discarded,
            failed,
        };
    }

    /**
     * Delete an ENTIRE package: every `sys_metadata` row bound to it (active
     * AND draft) and — by default — the physical table of each object it
     * defined. DESTRUCTIVE: removes the app and its data. Use case: "I don't
     * want this package anymore."
     *
     * Set `keepData: true` to remove the metadata but preserve object tables.
     * The `sys_`-table guard in {@link deleteMetaItem} still applies, so
     * platform storage is never dropped. Drafts are removed before active rows
     * so each object's table is torn down once. Per-item failures are collected
     * without aborting the rest.
     */
    async deletePackage(request: {
        packageId: string;
        organizationId?: string;
        allTenants?: boolean;
        actor?: string;
        keepData?: boolean;
    }): Promise<{
        success: boolean;
        deletedCount: number;
        failedCount: number;
        deleted: Array<{ type: string; name: string; state: string }>;
        failed: Array<{ type: string; name: string; error: string; code?: string }>;
        cleanups: UninstallCleanupOutcome[];
    }> {
        // [#7780] A cross-tenant uninstall must be DECLARED, never inferred from
        // an absent parameter. Maintainer ruling (2026-08-12):
        // 跨租户卸载必须显式声明,缺省缺参永远不等于「全部租户」.
        //
        // Before this gate, `{ packageId }` with no org matched EVERY
        // organization's rows — measured during #7705 at 5 of 5 deleted,
        // including a foreign org's. The two doors disagreed on which semantic
        // that was: the direct-mount REST registrar
        // (`packages/rest/src/package-routes.ts`) passes no org and got the
        // cross-tenant read, while the dispatcher twin
        // (`packages/runtime/src/domains/packages.ts`) resolves one and got the
        // org-scoped read. Nobody chose that split; it fell out of a missing
        // argument.
        //
        // Why a flag and not a convention: `resolveActiveOrganizationId`
        // (#4127) is entirely `catch`-wrapped, so ANY throw on the auth seam
        // returns `undefined`. An accidental org-less call and a deliberate
        // env-wide one are byte-identical at the call site, and the widest
        // possible reading of a destructive operation is the one that must
        // never be reachable by accident. `allTenants: true` is the carrier
        // that makes the two distinguishable.
        //
        // ⛔ NOT narrowed to `organization_id IS NULL` — #7705 proved that
        // revives the orphaned-row defect on the other door. The remedy here is
        // explicitness, not narrowing: with the flag, the no-org branch stays
        // package-wide exactly as it was.
        //
        // Mirrors the `force: true` / `DESTRUCTIVE_CHANGE` opt-in this same
        // class already uses for `saveMetaItem` — refuse, name the remedy in the
        // message, and carry a ledger-declared code plus an explicit status.
        // Two ways to violate ONE contract — "the uninstall's tenant scope must be
        // readable off the request" — so both answer in the same family, with the
        // same code and status, and each names the parameters that produced it.
        //
        // (a) CONTRADICTORY. `organizationId` says "this tenant", `allTenants`
        // says "every tenant". Rejecting beats picking a winner, because both
        // silent resolutions are worse than a refusal: resolving narrow-first
        // makes `allTenants: true` silently INERT (the caller believes they
        // asked for a cross-tenant uninstall and quietly gets a scoped one,
        // discovering it only when the rows they expected gone are still
        // there); resolving explicit-first silently IGNORES a named
        // organization and deletes every tenant's rows — the original defect
        // wearing a flag. Rejecting is also the only reading that stays correct
        // when a request is COMPOSED from two places (a resolver supplying the
        // org, config supplying the flag), which is exactly the accidental
        // composition `resolveActiveOrganizationId` makes real.
        if (request.organizationId && request.allTenants === true) {
            const err = new Error(
                `[tenant_scope_required] Refusing to uninstall '${request.packageId}':`
                + ` organizationId ('${request.organizationId}') and allTenants: true are mutually exclusive —`
                + ` one scopes the uninstall to a single tenant, the other clears every tenant's rows.`
                + ` — pass organizationId alone to scope it, or allTenants: true alone to confirm the cross-tenant uninstall.`
            );
            (err as any).code = 'TENANT_SCOPE_REQUIRED';
            (err as any).status = 400;
            throw err;
        }
        // (b) UNDECLARED. Note `!== true`: an explicit `allTenants: false` lands
        // here with absent, deliberately. `false` is not a request for
        // cross-tenant semantics, so it cannot authorise them — only the
        // affirmative `true` does.
        if (!request.organizationId && request.allTenants !== true) {
            const err = new Error(
                `[tenant_scope_required] Refusing to uninstall '${request.packageId}' with no organization scope:`
                + ` an uninstall that names neither an organization nor an explicit cross-tenant intent would delete`
                + ` EVERY organization's rows for this package.`
                + ` — pass organizationId to scope it, or allTenants: true to confirm the cross-tenant uninstall.`
            );
            (err as any).code = 'TENANT_SCOPE_REQUIRED';
            (err as any).status = 400;
            throw err;
        }
        const where: Record<string, unknown> = { package_id: request.packageId };
        // [#7705] Surface BOTH org-scoped rows and env-wide (`organization_id
        // IS NULL`) rows to an org-scoped uninstall. A strict
        // `organization_id = <org>` equality silently dropped every env-wide
        // row, and env-wide is where a package's metadata normally LANDS: the
        // REST `PUT /meta/:type/:name` save path does not thread the session's
        // active org, and AI-authored metadata is written env-wide too. So an
        // uninstall issued by a session that HAS an active org (the dispatcher
        // door, `packages/runtime/src/domains/packages.ts`, is the one that
        // resolves and passes `organizationId`) selected only the handful of
        // rows that happened to be org-scoped and left the rest behind —
        // reporting `deletedCount` > 0 and `success: true` while the package's
        // rows demonstrably survived (the orphaned-uninstall bug).
        //
        // Same defect and same remedy as the #3115 "orphaned draft" bug one
        // file over ({@link SysMetadataRepository.listDrafts}), and the shape
        // is deliberately identical to it. The driver's own implicit tenant
        // wall already reads this way (`field = :tenant OR field IS NULL`,
        // #2734); only author-supplied predicates are strict, which is what
        // made this silent.
        //
        // The no-org branch is deliberately NOT narrowed to `organization_id
        // IS NULL`: the other door of this route (the direct-mount REST
        // registrar, `packages/rest/src/package-routes.ts`) passes no
        // `organizationId` at all, and restricting it to env-wide rows would
        // orphan every org-scoped row — the same bug, re-created on the other
        // door. Absent an org, a full uninstall stays package-wide — and since
        // #7780 that branch is reachable only with `allTenants: true`, so the
        // width is now something a caller ASKED for rather than something a
        // missing argument selected.
        //
        // There is no tie-break for "both supplied" because that combination
        // never reaches here — it is refused above. A destructive operation
        // whose scope is stated twice, contradictorily, has no reading that is
        // safe to guess.
        if (request.organizationId) {
            where.$or = [
                { organization_id: request.organizationId },
                { organization_id: null },
            ];
        }
        // [#8136] This read is the uninstall's FIRST database touch, and until
        // now it sat outside every `try` in this method — the per-item `catch`
        // below wraps only the `deleteMetaItem` loop. So a driver failure here
        // propagated whole, out of the protocol and onto the wire: measured as
        // `500 INTERNAL_ERROR / "SQLITE_ERROR: no such table: sys_metadata"`
        // from `DELETE /api/v1/packages/:id`, a physical table name shipped to
        // a client.
        //
        // Declared rather than swallowed: {@link metadataStoreUnavailableError}
        // is this file's EXISTING answer for "a `sys_metadata` read failed" —
        // 503 / `SERVICE_UNAVAILABLE`, a message that quotes nothing, and the
        // driver error carried on `cause` so the operator still gets it whole.
        // Reusing it rather than minting a second sentence for one condition is
        // the point; see its docblock for why the verdict is 503.
        //
        // ⛔ Deliberately NOT routed through {@link
        // rethrowUnlessMetadataStoreUnprovisioned}, which returns normally for
        // `isMissingTableError` and would license the caller to treat the
        // overlay as absent. On a READ that is right — there are genuinely no
        // rows. Here it would turn an unreachable store into `rows = []`, and
        // this method reports that as a completed uninstall that deleted
        // nothing. An outage answered as "there was nothing to remove" is the
        // ADR-0110 D3 confusion in its most damaging direction, on a
        // destructive verb. Every failure stays a failure; only the disclosure
        // changes.
        let rows: any[];
        try {
            rows = (await this.engine.find('sys_metadata', { where })) as any[];
        } catch (e) {
            throw metadataStoreUnavailableError(e);
        }

        const dropStorage = request.keepData !== true;
        // Delete drafts before active so an object's table is dropped once (on
        // the active delete), not pre-empted by a draft delete.
        const ordered = [...rows].sort((a, b) => (a.state === 'draft' ? 0 : 1) - (b.state === 'draft' ? 0 : 1));

        const deleted: Array<{ type: string; name: string; state: string }> = [];
        const failed: Array<{ type: string; name: string; error: string; code?: string }> = [];

        for (const row of ordered) {
            const state: 'active' | 'draft' = row.state === 'draft' ? 'draft' : 'active';
            try {
                await this.deleteMetaItem({
                    type: row.type,
                    name: row.name,
                    state,
                    ...(row.organization_id ? { organizationId: row.organization_id } : {}),
                    ...(request.actor ? { actor: request.actor } : {}),
                    ...(dropStorage ? { dropStorage: true } : {}),
                });
                deleted.push({ type: row.type, name: row.name, state });
            } catch (e: any) {
                // [#8136] NO filter here, deliberately, and this comment is why
                // the absence is a decision rather than an oversight.
                //
                // This `try` wraps exactly one call, and every exit
                // `deleteMetaItem` has is now either a refusal it DECLARED
                // (its two-tier authorization block and `assertLockAllowsDelete`
                // — 4xx with a catalogued code) or one of its two re-wraps,
                // which withhold at the source via {@link
                // overlayDeleteFailureMessage}. Its one engine touch outside
                // its own `try`, `getEffectiveLock`, has been fail-closed
                // through `rethrowUnlessMetadataStoreUnprovisioned` since
                // #5706, so that arrives as the non-quoting 503 too.
                //
                // So `failed[].error` — which rides onto the
                // `PACKAGE_DELETE_PARTIAL` 400 inside `details`, out of reach
                // of any boundary's message withhold — is clean BECAUSE the
                // producer is, which is the whole shape of this fix. Adding a
                // second filter here would be consumer-side tolerance over a
                // producer that no longer needs it (Prime Directive #12), and
                // it would blank the per-item refusals that make a partial
                // uninstall actionable.
                failed.push({
                    type: row.type,
                    name: row.name,
                    error: e?.message ?? 'delete failed',
                    ...(e?.code ? { code: e.code } : {}),
                });
            }
        }

        // #2532 counterpart: also drop the durable `sys_packages` record —
        // service-package hydrates that table back into the registry at boot,
        // so leaving the row behind would RESURRECT an uninstalled package on
        // the next restart. Best-effort, same posture as install persistence.
        try {
            const pkgSvc = this.getServicesRegistry?.()?.get('package') as
                | { delete?: (id: string) => Promise<unknown> }
                | undefined;
            if (pkgSvc?.delete) await pkgSvc.delete(request.packageId);
        } catch (e) {
            console.warn(
                `[protocol.deletePackage] sys_packages cleanup skipped for '${request.packageId}': ${(e as Error)?.message}`,
            );
        }

        // [#2747] Unregister from the in-memory SchemaRegistry too, so the
        // running kernel stops serving the package without waiting for a
        // restart. Best-effort: the HTTP dispatcher already unregisters
        // before calling us (second call is a no-op warn), and a package
        // with live extenders refuses unregistration — that failure is
        // logged, not fatal (the durable row is gone, so the next boot is
        // clean either way).
        try {
            (this.engine as any)?.registry?.uninstallPackage?.(request.packageId);
        } catch (e) {
            console.warn(
                `[protocol.deletePackage] registry unregistration skipped for '${request.packageId}': ${(e as Error)?.message}`,
            );
        }

        // [#2747] Data-plane cleanups registered by domain plugins (mirror of
        // the publish materializers): revoke what the package's metadata
        // granted — e.g. plugin-security removes its package-owned
        // sys_permission_set rows and their bindings. Best-effort per cleanup;
        // outcomes ride on the response so a failed revocation (ghost grants —
        // a security condition) is visible to the caller, never silent.
        const cleanups: UninstallCleanupOutcome[] = [];
        for (const [name, cleanup] of this.uninstallCleanups) {
            try {
                const r = await cleanup({
                    packageId: request.packageId,
                    ...(request.organizationId ? { organizationId: request.organizationId } : {}),
                    ...(request.actor ? { actor: request.actor } : {}),
                });
                cleanups.push({
                    name,
                    success: r?.success !== false,
                    removed: typeof r?.removed === 'number' ? r.removed : 0,
                    ...(r?.error ? { error: r.error } : {}),
                });
            } catch (e: any) {
                // [#8136] A cleanup is arbitrary plugin code that goes straight
                // at the engine (plugin-security deletes `sys_permission_set`
                // rows and their bindings), so a driver failure lands here
                // verbatim — and this outcome rides on the RESPONSE by design,
                // inside `details`, where no boundary's message withhold can
                // reach it. Quoted only when the cleanup declared a refusal.
                cleanups.push({
                    name,
                    success: false,
                    removed: 0,
                    error: clientFacingFailureText(e, 'cleanup failed'),
                });
                console.warn(
                    `[protocol.deletePackage] uninstall cleanup '${name}' failed for '${request.packageId}': ${e?.message}`,
                );
            }
        }

        return {
            success: failed.length === 0 && deleted.length > 0,
            deletedCount: deleted.length,
            failedCount: failed.length,
            deleted,
            failed,
            cleanups,
        };
    }

    /**
     * ADR-0070 D4 — duplicate a writable base into a NEW package (the Airtable
     * "duplicate base" gesture). Clones every ACTIVE item the source owns into
     * `targetPackageId`, RE-NAMESPACING object names — the blueprint prefixes a
     * base's object names with its namespace (e.g. `iojn_repair_ticket`), and
     * `sys_metadata` keys on (type,name,org), so a same-name copy would collide
     * with the source — and rewriting every intra-package reference (lookup
     * `reference`, view `object`, expressions, etc.) to the new names. Per-item
     * best-effort; one failure never aborts the whole clone.
     */
    async duplicatePackage(request: {
        sourcePackageId: string;
        targetPackageId: string;
        targetName?: string;
        targetNamespace?: string;
        organizationId?: string;
        actor?: string;
    }): Promise<{
        success: boolean;
        copiedCount: number;
        failedCount: number;
        targetPackageId: string;
        copied: Array<{ type: string; name: string }>;
        failed: Array<{ type: string; name: string; error: string }>;
    }> {
        const registry: any = (this.engine as any).registry;
        const srcPkg = registry?.getPackage?.(request.sourcePackageId);
        const sourceNs: string =
            (srcPkg?.manifest?.namespace as string) ?? (request.sourcePackageId.split('.').pop() ?? '');
        const targetNs: string =
            request.targetNamespace ?? (request.targetPackageId.split('.').pop() ?? request.targetPackageId);

        const where: Record<string, unknown> = { package_id: request.sourcePackageId, state: 'active' };
        // [#7819 tier 2] Copy the source's env-wide (`organization_id IS NULL`)
        // rows too, not just the ones this org happens to own — the same `$or`
        // {@link deletePackage} (#7705) and {@link listCommits} (#7779) carry.
        // Unlike the tier-1 sites this really is plain scan scoping (`where` is
        // keyed on package + state, not on `id`), so the family remedy applies
        // without their authorization question.
        //
        // Measured on a real driver before the fix: a source package holding one
        // env-wide row and one org-scoped row duplicated by an org caller
        // answered `{success: true, copiedCount: 1, failedCount: 0}` — a PARTIAL
        // copy reported as a whole one, because `organization_id = <org>` matches
        // no NULL column. The mixed state is ordinary, not contrived: a publish
        // made before an active org was selected lands its `sys_metadata` row
        // env-wide (`saveMetaItem` writes `organization_id = NULL`), and
        // `resolveActiveOrganizationId` yields `undefined` for such a session
        // *and* for any throw on the auth seam.
        //
        // The sharper consequence is the rename map below, which is built ONLY
        // from the rows this scan returns. With the env-wide OBJECT rows missing
        // it came out empty, so a copied view was renamed `iojn2_list` while its
        // `data.object` still pointed at the SOURCE package's `iojn_widget` — a
        // duplicate silently wired back to the base it was cloned from, reporting
        // success. An all-env-wide source degraded differently and just as
        // quietly: `{success: false, copiedCount: 0, failedCount: 0}`, nothing
        // copied and nothing named as failed.
        //
        // The no-org branch is deliberately NOT narrowed to `organization_id IS
        // NULL`, exactly as #7705 / #7779 / tier 1 left theirs: that door copies
        // every scope today, and restricting it to env-wide rows would drop every
        // org-scoped row from the copy — the same bug pointed the other way.
        if (request.organizationId) {
            where.$or = [
                { organization_id: request.organizationId },
                { organization_id: null },
            ];
        }
        const scanned = (await this.engine.find('sys_metadata', { where })) as any[];

        // [#7819 tier 2] ADR-0005 overlay precedence — the caller's OWN org
        // shadows env-wide ({@link resolveMetaItemOrgScope} states the same rule
        // for history lineages). Widening the scan makes a collision newly
        // possible that could not occur while it was a strict equality: one item
        // can now appear TWICE, as an env-wide row PLUS this org's overlay of it.
        // Every copy is written under `request.organizationId`, so both would
        // land on the same target key — overlay uniqueness is
        // `(type, name, organization_id, COALESCE(package_id, ''))` — and which
        // body survived would be decided by driver row order. Keep the org
        // overlay: it is what this caller already reads everywhere else.
        let rows = scanned;
        if (request.organizationId) {
            const byKey = new Map<string, any>();
            for (const row of scanned) {
                // [#7932] …and for a bundled type the slot is
                // `(type, name, discriminator)`. Same shape #7774 gave
                // {@link metaItemKey}: the discriminator is appended ONLY
                // when the type declares one, so every undiscriminated type
                // keeps a byte-identical two-component key and this
                // change's blast radius is provable rather than argued.
                //
                // Within ONE org the collapse cannot happen —
                // `sys_metadata`'s overlay uniqueness is
                // `(type, name, organization_id, package_id)` and the table
                // has no locale column, so one org cannot hold two rows
                // differing only by body locale. Across the two tiers it
                // can, and this scan is the one place they meet: an
                // env-wide `auth.welcome` customized in `en-US` and THIS
                // org's `zh-CN` customization are two different members of
                // one bundle (`EmailTemplateDefinitionSchema` resolves a
                // template by `(name, locale)`), and keying them together
                // let the org row displace the env-wide one — the
                // duplicate then shipped one locale of a two-locale
                // customization, reporting success. Precedence is unchanged
                // where it was ever meaningful: an org row still wins over
                // the env-wide row of the SAME member.
                //
                // The discriminator is read off the RAW stored body rather
                // than the converted one, which is safe because no ADR-0087
                // conversion entry touches `email_template` — re-checked
                // against `packages/spec/src/conversions/registry.ts`,
                // whose surfaces are flow/page/object/view/app/… and never
                // this type.
                const disc = storedRowDiscriminator(String(row?.type), row);
                const base = `${row?.type}\u0000${row?.name}`;
                const key = disc === undefined ? base : `${base}\u0000${disc}`;
                const kept = byKey.get(key);
                const keptIsEnvWide = kept != null && (kept.organization_id ?? null) === null;
                if (kept == null || (keptIsEnvWide && (row?.organization_id ?? null) !== null)) {
                    byKey.set(key, row);
                }
            }
            rows = [...byKey.values()];
        }

        // Map only OBJECT names that carry the source namespace prefix; views/etc.
        // are renamed by the same prefix swap and reference-rewritten via the map.
        const renameName = (name: string): string =>
            sourceNs && typeof name === 'string' && name.startsWith(`${sourceNs}_`)
                ? `${targetNs}_${name.slice(sourceNs.length + 1)}`
                : name;
        const renameMap = new Map<string, string>();
        for (const row of rows) {
            if (row?.type === 'object') {
                const nn = renameName(row.name);
                if (nn !== row.name) renameMap.set(row.name, nn);
            }
        }
        // Longest-first, identifier-boundary rewrite so `iojn_task` never corrupts
        // `iojn_task_log`, and `iojn_x` inside `record.iojn_x`/`iojn_x.view` matches.
        const olds = [...renameMap.keys()].sort((a, b) => b.length - a.length);
        const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = olds.length ? new RegExp(`(${olds.map(esc).join('|')})(?![A-Za-z0-9_])`, 'g') : null;
        const deepRewrite = (v: any): any => {
            if (typeof v === 'string') return re ? v.replace(re, (m) => renameMap.get(m) ?? m) : v;
            if (Array.isArray(v)) return v.map(deepRewrite);
            if (v && typeof v === 'object') {
                const o: any = {};
                for (const [k, val] of Object.entries(v)) o[k] = deepRewrite(val);
                return o;
            }
            return v;
        };

        if (srcPkg?.manifest && typeof registry?.installPackage === 'function') {
            try {
                // Route through installPackage (not a bare registry write) so the
                // duplicated base ALSO lands in sys_packages — otherwise the copy
                // would vanish from GET /packages on the next restart (#2532).
                // Spread-then-strip: the source may carry `scope` (e.g. 'project'
                // on a code package) — copying it would brand the duplicate as
                // read-only in every writability heuristic, when the whole point
                // of a duplicate is a WRITABLE base. The copy is scope-less.
                const dupManifest: Record<string, unknown> = {
                    ...srcPkg.manifest,
                    id: request.targetPackageId,
                    name: request.targetName ?? `${srcPkg.manifest.name ?? request.sourcePackageId} (copy)`,
                    namespace: targetNs,
                };
                delete dupManifest.scope;
                await this.installPackage({ manifest: dupManifest } as InstallPackageRequest);
            } catch {
                /* best-effort — the per-item package binding still works without a manifest row */
            }
        }

        const copied: Array<{ type: string; name: string }> = [];
        const failed: Array<{ type: string; name: string; error: string }> = [];
        // Resolved once for the whole copy: every flow row in this package needs
        // the same engine, and a package with fifty flows should not walk the
        // service table fifty times.
        const canonicalizeFlow = this.resolveFlowCanonicalizer();

        for (const row of rows) {
            const newName = renameName(row.name);
            const rawType = String(row.type);
            const singular = PLURAL_TO_SINGULAR[rawType] ?? rawType;
            let body: unknown;
            try {
                body = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata ?? {});
            } catch {
                failed.push({ type: row.type, name: row.name, error: 'unparseable metadata' });
                continue;
            }

            // Canonicalize the source row before re-saving (#3903): the copy is
            // a NEW write and must pass today's schema gate, so a legacy shape
            // the chain owns is lifted rather than failing the copy —
            // duplication never mints new rows in a pre-protocol dialect.
            //
            // For `flow` that guarantee was false until #4498: `convertStoredItem`
            // returns flows untouched, and `FlowNodeSchema.config` is an open
            // `z.record`, so a pre-17 body (`delete_record` with `config.filters`)
            // sailed through `saveMetaItem` and landed verbatim in a brand-new
            // row. ADR-0087 justifies the whole stored-metadata design on new
            // writes being canonical — "a strictly shrinking concern" — and this
            // was the one live producer contradicting it.
            let item: any;
            if (singular === 'flow') {
                if (!canonicalizeFlow) {
                    // No engine in this process (control-plane / metadata-only
                    // host). Copy the source body as-is — the honest behaviour,
                    // and no worse than the source row already is — rather than
                    // failing a duplication that has nothing to do with flows.
                    // `os migrate meta --stored --apply` is the finish line for
                    // both rows, and it reports what it could not canonicalize.
                    item = body;
                } else {
                    try {
                        const result = canonicalizeFlow(String(row.name ?? ''), body);
                        if (result.conflicts.length > 0) {
                            // ADR-0078's guard refused a node-type rename because
                            // the old token is a LIVE name owned by something
                            // else here. Copying the un-renamed body anyway would
                            // mint exactly the row this fix exists to prevent, so
                            // the item fails and names the token (same posture as
                            // #4454's `failed` outcome).
                            const first = result.conflicts[0]!;
                            failed.push({
                                type: row.type,
                                name: row.name,
                                error: `conversion refused — '${first.token}' at ${first.path} is a live name in `
                                    + `this environment (${result.conflicts.length} conflict(s)). ${first.message}`,
                            });
                            continue;
                        }
                        item = result.storable;
                    } catch (e: any) {
                        // `FlowSchema` is strict (#4001) and the region validator
                        // hard-fails: this source row cannot register at all, so
                        // the copy would be broken the same way. Report it.
                        failed.push({
                            type: row.type,
                            name: row.name,
                            error: `the flow does not canonicalize: ${e?.message ?? String(e)}`,
                        });
                        continue;
                    }
                }
            } else {
                try {
                    item = this.convertStoredItem(rawType, body);
                } catch (e: any) {
                    // A tombstoned key throws here (ADR-0087 D2) — a genuine
                    // contract violation in the source, not a parse failure.
                    failed.push({
                        type: row.type,
                        name: row.name,
                        error: `the source item does not convert: ${e?.message ?? String(e)}`,
                    });
                    continue;
                }
            }
            const rewritten = deepRewrite(item);
            if (rewritten && typeof rewritten === 'object' && !Array.isArray(rewritten)) rewritten.name = newName;
            // [#7819 tier 2] The copy lands in the SCOPE OF THE ROW IT CAME
            // FROM, not the request's — the same rule #7559 gave `revertCommit`
            // ({@link resolveMetaItemOrgScope}) for the same reason, now that
            // widening the scan above means this loop, too, processes a batch
            // that "legitimately mixes an env-wide artifact with an org
            // overlay".
            //
            // Not cosmetic: without it the read fix alone cannot produce a
            // working duplicate. Stamping the request's org on every copy is
            // REFUSED for any type the metadata-type registry declares
            // `allowOrgOverride=false` — `object` among them — with
            // `NOT_OVERRIDABLE`, because boot hydration loads env-wide rows
            // only and an org-scoped `object` row would vanish on the next
            // restart (ADR-0005, #6190). Since an `object` therefore CANNOT
            // exist org-scoped, every object row in a source package is
            // env-wide, and an org-scoped `duplicatePackage` could not copy a
            // single one: before this card the strict equality hid them, and
            // with only the scan widened they would land in `failed[]`
            // instead. Objects being what a base is mostly made of, ADR-0070
            // D4's "duplicate base" gesture was structurally unable to
            // duplicate a base whenever an org was active.
            //
            // Scoped to the org-scoped door alone. With no `organizationId` on
            // the request the scan returns every organization's rows and each
            // copy is written env-wide exactly as before — that door's
            // behaviour is deliberately left byte-identical, as this card
            // leaves all of its no-org branches.
            const copyOrgId: string | null = request.organizationId
                ? ((row?.organization_id ?? null) as string | null)
                : null;
            try {
                await this.saveMetaItem({
                    type: row.type,
                    name: newName,
                    item: rewritten,
                    mode: 'publish',
                    packageId: request.targetPackageId,
                    ...(copyOrgId ? { organizationId: copyOrgId } : {}),
                    ...(request.actor ? { actor: request.actor } : {}),
                });
                copied.push({ type: row.type, name: newName });
            } catch (e: any) {
                failed.push({ type: row.type, name: row.name, error: e?.message ?? 'copy failed' });
            }
        }
        return {
            success: failed.length === 0 && copied.length > 0,
            copiedCount: copied.length,
            failedCount: failed.length,
            targetPackageId: request.targetPackageId,
            copied,
            failed,
        };
    }

    /**
     * ADR-0070 D5 — adopt orphaned (package-less) metadata into a base. The
     * pre-package-first stopgaps left runtime-authored items with
     * `package_id = null` (or the `sys_metadata` sentinel). This bulk-rebinds
     * every such orphan to `targetPackageId` so the env converges on the
     * package-first model and the "Local / Custom" migration scope can be
     * retired. Owned rows (already bound to a real package) are left untouched.
     * Updates the durable column; the in-memory registry picks the new binding
     * up on the next metadata reload.
     */
    async reassignOrphanedMetadata(request: {
        targetPackageId: string;
        organizationId?: string;
        actor?: string;
    }): Promise<{
        success: boolean;
        reassignedCount: number;
        reassigned: Array<{ type: string; name: string }>;
        targetPackageId: string;
    }> {
        const where: Record<string, unknown> = {};
        // [#7819 tier 2] See env-wide (`organization_id IS NULL`) orphans too.
        // This is the sharper member of the family, because FINDING ORPHANS IS
        // THE ENTIRE PURPOSE of this method: a class of orphan it structurally
        // cannot see is not a partial answer, it is a wrong one. Measured on a
        // real driver before the fix — two orphans, one env-wide and one
        // org-scoped, adopted by an org caller: `{success: true,
        // reassignedCount: 1}`, with the env-wide orphan left at
        // `package_id = null` and nothing reporting that it was skipped.
        //
        // Not a legacy-only population, which is what makes this live rather
        // than latent. The docstring above calls orphans a pre-package-first
        // residue, and ADR-0070 D1 does reject NEW orphans that name a
        // read-only package (`WRITABLE_PACKAGE_REQUIRED`) — but a
        // `saveMetaItem` that names NO package at all still succeeds today and
        // lands `package_id = null, organization_id = null`, i.e. the current
        // write path mints exactly the orphan this scan could not see.
        //
        // ADR-0070 D5 settles the scope question this widening raises (an
        // org-scoped caller now rebinds rows every org can see): the unit is
        // explicitly the ENVIRONMENT — "bulk-assign legacy orphans to a default
        // base named for the environment", completing when "an environment has
        // no orphans", in a deployment model whose own words are "there is no
        // per-org overlay dimension here… the relevant axis is code package vs
        // writable base, not 'org'". Under that model every orphan is env-wide,
        // so the strict equality made this method inert for an org-scoped
        // caller in precisely the deployment it was designed for.
        //
        // ⛔ The no-org branch stays `{}` — deliberately un-narrowed, and this
        // is the exposure the card flagged as worst: that door already scans
        // EVERY organization's rows. Narrowing it to `organization_id IS NULL`
        // would re-create this same bug pointed the other way. Whether that
        // door should be that wide is #7780's open product question, which is
        // a maintainer call and explicitly NOT decided here.
        if (request.organizationId) {
            where.$or = [
                { organization_id: request.organizationId },
                { organization_id: null },
            ];
        }
        const rows = (await this.engine.find('sys_metadata', { where })) as any[];
        const orphans = rows.filter(
            (r) => r?.package_id == null || r.package_id === '' || r.package_id === 'sys_metadata',
        );

        const reassigned: Array<{ type: string; name: string }> = [];
        for (const row of orphans) {
            try {
                await this.engine.update(
                    'sys_metadata',
                    { package_id: request.targetPackageId },
                    { where: { id: row.id } },
                );
                reassigned.push({ type: row.type, name: row.name });
            } catch {
                /* skip a row that fails to update; report only what moved */
            }
        }
        return {
            success: reassigned.length > 0,
            reassignedCount: reassigned.length,
            reassigned,
            targetPackageId: request.targetPackageId,
        };
    }

    // ─────────────────────────────────────────────────────────────────────
    // ADR-0067 — package-scoped commit history & rollback
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Record one commit row (best-effort) grouping a turn's published
     * artifacts. Returns the commit id, or null if the commit store is
     * unavailable (e.g. unit-test stubs) — recording never blocks a publish.
     */
    private async recordPackageCommit(args: {
        orgId: string | null;
        packageId: string;
        operation: 'apply' | 'revert';
        message?: string;
        actor?: string;
        aiModel?: string;
        parentCommitId?: string;
        items: Array<{ type: string; name: string; existedBefore: boolean; prevVersion: number | null }>;
        eventSeqStart?: number;
        eventSeqEnd?: number;
    }): Promise<{ commitId: string } | null> {
        try {
            const commitId = 'cmt_' + (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID()
                : `${args.eventSeqEnd ?? 0}-${args.items.length}-${args.packageId}`);
            await this.engine.insert('sys_metadata_commit', {
                id: commitId,
                package_id: args.packageId,
                operation: args.operation,
                ...(args.message ? { message: args.message } : {}),
                ...(args.actor ? { actor: args.actor } : {}),
                ...(args.aiModel ? { ai_model: args.aiModel } : {}),
                ...(args.parentCommitId ? { parent_commit_id: args.parentCommitId } : {}),
                ...(args.eventSeqStart !== undefined ? { event_seq_start: args.eventSeqStart } : {}),
                ...(args.eventSeqEnd !== undefined ? { event_seq_end: args.eventSeqEnd } : {}),
                items: JSON.stringify(args.items),
                item_count: args.items.length,
                organization_id: args.orgId,
                created_at: new Date().toISOString(),
            });
            return { commitId };
        } catch {
            // Commit store unavailable (or insert raced) — the publish itself
            // already succeeded; grouping is a best-effort overlay on top.
            return null;
        }
    }

    private parseCommitItems(
        raw: unknown,
    ): Array<{ type: string; name: string; existedBefore: boolean; prevVersion: number | null }> {
        if (Array.isArray(raw)) return raw as Array<{ type: string; name: string; existedBefore: boolean; prevVersion: number | null }>;
        if (typeof raw === 'string') {
            try {
                const p = JSON.parse(raw);
                return Array.isArray(p) ? p : [];
            } catch {
                return [];
            }
        }
        return [];
    }

    /**
     * List the commit timeline for a package, newest-first (ADR-0067).
     *
     * `[]` means ONE thing: this package genuinely has no commits — a first
     * boot before `sys_metadata_commit` is provisioned, or a package nobody has
     * applied yet. It does NOT mean "the commit store could not be read".
     *
     * [#5980] It used to mean both. The `catch` answered `[]` for every failure
     * and this JSDoc said so outright ("Returns [] if the commit store is
     * unavailable"), which is ADR-0110 D3 broken on the ADR-0067 timeline: a
     * miss and an outage are different facts with opposite meanings, and the
     * timeline is `revertCommit`'s selection surface. An unreachable store
     * rendered as "this package has no history", so the Studio offers nothing
     * to roll back at the exact moment an operator is trying to roll something
     * back — and {@link rollbackToPackageCommit}, which filters this list,
     * reported `success: true` for having reverted nothing. Not one line was
     * logged anywhere on the path.
     *
     * Classification is by error TYPE through
     * {@link rethrowUnlessMetadataStoreUnprovisioned} — the same guard the
     * `sys_metadata` overlay reads in this file already ask (#5532 / #5707) and
     * the same `isMissingTableError` predicate `DatabaseLoader` (#5108) and
     * `SysMetadataRepository` (#4867) ask, so a driver quirk is taught to the
     * platform once rather than re-spelled per seam.
     *
     * @throws {@link metadataStoreUnavailableError} — a 503 carrying the driver
     *         error as `cause`, for every failure that is not an unprovisioned
     *         table.
     */
    async listCommits(request: {
        packageId: string;
        organizationId?: string;
        limit?: number;
    }): Promise<Array<{
        id: string;
        operation: 'apply' | 'revert';
        message?: string;
        actor?: string;
        aiModel?: string;
        parentCommitId?: string;
        itemCount: number;
        items: Array<{ type: string; name: string; existedBefore: boolean; prevVersion: number | null }>;
        createdAt?: string;
    }>> {
        try {
            const where: Record<string, unknown> = { package_id: request.packageId };
            // [#7779] Surface BOTH org-scoped and env-wide (`organization_id IS
            // NULL`) commit rows to an org-scoped caller — the same defect and
            // the same remedy as the sibling {@link deletePackage} read one
            // function above (#7705), and as {@link
            // SysMetadataRepository.listDrafts} (#3115) in this package.
            //
            // Env-wide commit rows are not hypothetical: {@link
            // recordPackageCommit} stores `organization_id: request.
            // organizationId ?? null`, and the ONLY door into a publish — the
            // dispatcher's `POST /packages/:id/publish-drafts` — forwards an
            // org only when `resolveActiveOrganizationId` yields one. That
            // resolver answers `undefined` for a session with no active
            // organization AND for every failure on the auth seam (it is
            // `catch`-wrapped). So a publish made before an org was selected —
            // or during a transient auth blip — lands its commit env-wide,
            // permanently, and the strict equality then hid it from every
            // org-scoped read of that package's timeline.
            //
            // This is NOT merely an observability miss. {@link
            // rollbackToPackageCommit} derives the set of commits to undo from
            // this list, so an invisible commit was silently never reverted:
            // measured pre-fix, a rollback past an env-wide commit answered
            // `{success: true, revertedCommits: []}` while that commit's
            // changes stayed live.
            //
            // The no-org branch is deliberately NOT narrowed to
            // `organization_id IS NULL`, exactly as #7705 left its own: a
            // caller with no active org reads the package's whole timeline,
            // and restricting it to env-wide rows would hide every org-scoped
            // commit instead — the same bug pointed the other way.
            if (request.organizationId) {
                where.$or = [
                    { organization_id: request.organizationId },
                    { organization_id: null },
                ];
            }
            const rows = (await this.engine.find('sys_metadata_commit', {
                where,
                ...(request.limit ? { limit: request.limit } : {}),
            })) as any[];
            const mapped = rows.map((r) => ({
                id: r.id,
                operation: (r.operation ?? 'apply') as 'apply' | 'revert',
                ...(r.message ? { message: r.message } : {}),
                ...(r.actor ? { actor: r.actor } : {}),
                ...(r.ai_model ? { aiModel: r.ai_model } : {}),
                ...(r.parent_commit_id ? { parentCommitId: r.parent_commit_id } : {}),
                itemCount: typeof r.item_count === 'number' ? r.item_count : 0,
                items: this.parseCommitItems(r.items),
                ...(r.created_at ? { createdAt: r.created_at } : {}),
            }));
            // Newest-first; tolerate drivers that don't order by returning
            // insertion order, then sort by the ISO timestamp.
            mapped.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
            return mapped;
        } catch (error) {
            // [#5980] Benign (the table has not been provisioned) falls through;
            // everything else is a read that did not happen and leaves as a 503.
            this.rethrowUnlessMetadataStoreUnprovisioned(error);
            return [];
        }
    }

    /**
     * Revert a single commit (ADR-0067): undo exactly the artifacts it touched.
     * A created-by-this-commit artifact is soft-removed (metadata row deleted;
     * the data table is NOT dropped — recoverable, per ADR-0067 §5); a modified
     * artifact is restored to its pre-commit `prevVersion`. The revert is itself
     * recorded as a NEW commit (operation='revert'), so history stays
     * append-only and the revert is itself revertible.
     *
     * [#6621] BOTH limbs refresh the SchemaRegistry, so a revert that answers
     * `success: true` is one the running process has already acted on. The
     * restore limb writes the restored body through ({@link
     * applyRegistryWriteThrough}, the #4521 rule the sibling
     * {@link rollbackMetaItem} has always carried); the soft-remove limb runs
     * the same three-tier heal the sibling {@link deleteMetaItem} runs after
     * its own `repo.delete` ({@link restoreArtifactRegistryView}). Before
     * this, a batch revert persisted its change and left the runtime
     * dispatching the reverted-away body until restart —
     * {@link rollbackToPackageCommit} inherited it, so a whole-package
     * rollback could report success and change nothing the process could see.
     */
    async revertCommit(request: {
        commitId: string;
        organizationId?: string;
        actor?: string;
    }): Promise<{
        success: boolean;
        revertedCount: number;
        failedCount: number;
        reverted: Array<{ type: string; name: string; action: 'removed' | 'restored' }>;
        failed: Array<{ type: string; name: string; error: string; code?: string }>;
        revertCommitId?: string;
    }> {
        await this.ensureOverlayIndex();
        const orgId = request.organizationId ?? null;
        const where: Record<string, unknown> = { id: request.commitId };
        // [#7819] Resolve BOTH org-scoped and env-wide (`organization_id IS
        // NULL`) commit rows for an org-scoped caller — the same defect and
        // remedy as the sibling {@link listCommits} (#7779) and {@link
        // deletePackage} (#7705). `organization_id = <org>` matches no NULL
        // column, so this answered `COMMIT_NOT_FOUND` (404) for a row that
        // demonstrably exists and that the SAME caller's `listCommits`
        // returns.
        //
        // ⚠️ This site is NOT the family's plain scan-scoping, and the `$or`
        // was chosen over the two alternatives rather than copied. `where` is
        // keyed on `id`, so the predicate reads like an AUTHORIZATION filter
        // layered on a unique key. Measured against the only door, it is not
        // one: authorization on `POST /packages/:id/commits/:commitId/revert`
        // is `requireManageMetadata`, checked before this call; the
        // `organizationId` that arrives is the session's *active org
        // selection* from `resolveActiveOrganizationId`, whose body is
        // entirely `catch`-wrapped and answers `undefined` on any auth-seam
        // throw — and `undefined` omits this predicate, which is the WIDEST
        // reading (every organization's commits). A boundary that fails OPEN
        // is not a boundary, so there is no authz here to make precise; that
        // rules out "keep it but distinguish 'not yours' from 'no such
        // commit'". Dropping the predicate outright is defensible on an id
        // lookup, but it would newly let an org caller revert ANOTHER
        // organization's commit by id — a widening this card never asked for.
        // The `$or` admits the env-wide rows and refuses that one.
        //
        // The body already agreed with this reading before the lookup did:
        // #7559 made each item resolve its scope FROM THE ROW ({@link
        // resolveMetaItemOrgScope}) precisely because "a batch legitimately
        // mixes an env-wide artifact with an org overlay", so the loop below
        // processes env-wide items for an org caller while the lookup above
        // refused to hand them over. {@link rollbackToPackageCommit} made the
        // contradiction self-evident: since #7814 it plans from `listCommits`
        // (org + env-wide) and fed each id straight back into this lookup.
        //
        // The no-org branch is deliberately NOT narrowed to `organization_id
        // IS NULL`, exactly as #7705 and #7779 left theirs: the direct-mount
        // REST registrar passes no `organizationId` at all, and restricting
        // that door to env-wide rows would make every org-scoped commit
        // unrevertable — the same bug pointed the other way.
        if (request.organizationId) {
            where.$or = [
                { organization_id: request.organizationId },
                { organization_id: null },
            ];
        }
        const row = (await this.engine.findOne('sys_metadata_commit', { where })) as any;
        if (!row) {
            const err: any = new Error(`[commit_not_found] No commit '${request.commitId}'.`);
            err.code = 'COMMIT_NOT_FOUND';
            err.status = 404;
            throw err;
        }
        const items = this.parseCommitItems(row.items);
        // #4556 — threaded into repo.put/delete → `recorded_by`; NULL when the
        // revert carries no human actor.
        const actor = request.actor ?? null;
        const reverted: Array<{ type: string; name: string; action: 'removed' | 'restored' }> = [];
        const failed: Array<{ type: string; name: string; error: string; code?: string }> = [];

        // Reverse apply order so artifacts that depend on others (e.g. a view on
        // a new object) are removed before the thing they reference.
        for (const it of [...items].reverse()) {
            // [#7559] PER ITEM, and from the ROW rather than from the request —
            // the same shape {@link publishPackageDrafts} already uses when it
            // promotes each draft in the draft's OWN scope and captures
            // `prevVersion` there. A batch legitimately mixes an env-wide
            // artifact with an org overlay, so a hoisted `orgId` has to pick one
            // and be wrong about the other — which is exactly how a commit whose
            // items are env-wide answered `VERSION_NOT_FOUND` for every item
            // when reverted by a caller with an active org. See
            // {@link resolveMetaItemOrgScope} for the measurement.
            const itemOrgId = await this.resolveMetaItemOrgScope(
                PLURAL_TO_SINGULAR[it.type] ?? it.type,
                it.name,
                orgId,
            );
            const repo = this.getOverlayRepo(itemOrgId);
            const ref = { type: it.type, name: it.name, org: itemOrgId ?? 'env' } as unknown as Parameters<typeof repo.get>[0];
            try {
                const current = await repo.get(ref, { state: 'active' });
                if (!it.existedBefore) {
                    // Created by this commit → soft-remove (metadata only; table stays).
                    //
                    // [#6620] The write INTENT is derived per item, exactly as
                    // the sibling DELETE caller {@link deleteMetaItem} derives
                    // it (and as the sibling revert caller
                    // {@link rollbackMetaItem} derives its own) — all three now
                    // agree. Stated as the CONSTANT `'override-artifact'` this
                    // limb used to carry, `SysMetadataRepository.delete` opened
                    // with `assertAllowed(ref.type, opts.intent)` — the same
                    // gate `put` uses — which refuses every type that is not
                    // `allowOrgOverride`, `object` among them. So a commit that
                    // CREATED an object could not be reverted at all: the
                    // first-build undo (publish a brand-new app, then undo it)
                    // left every created object behind, answered `success:
                    // false` with a populated `failed[]`, and left the package
                    // half-reverted — its overlay-allowed items removed, its
                    // objects not.
                    //
                    // Per ITEM, not per call: one first-build commit routinely
                    // creates a runtime object beside a packaged-artifact name,
                    // so a hoisted intent has to pick one and be wrong about
                    // the other. A genuinely artifact-backed item still
                    // resolves to `'override-artifact'` and is still refused
                    // with `NOT_OVERRIDABLE` — the derivation states the
                    // caller's case, it does not widen the repository's gate,
                    // which is unchanged and right.
                    //
                    // Sibling limb: #6563 (PR #6642) did the same for the
                    // restore branch below, where the intent was UNSTATED and
                    // fell through to `restoreVersion`'s `?? 'override-artifact'`
                    // default. The registry half of both limbs is #6621, fixed
                    // here and below.
                    const intent: 'override-artifact' | 'runtime-only' =
                        this.isArtifactBacked(it.type, it.name) ? 'override-artifact' : 'runtime-only';
                    if (current) {
                        await repo.delete(ref, {
                            parentVersion: current.hash,
                            actor,
                            source: 'protocol.revertCommit',
                            intent,
                            state: 'active',
                        });
                    }
                    // [#6621] The registry must stop serving what the revert
                    // just removed — the #4521 rule on the DELETE side of it.
                    //
                    // Measured on `origin/main` before this line existed: a
                    // first-build undo of a created `object` answered
                    // `success: true`, left `sys_metadata` with zero rows for
                    // the name, and `SchemaRegistry` kept serving the body —
                    // the same split the restore limb below showed, one limb
                    // over. Same for an overlay `view` on a control-plane
                    // kernel, where the plain-key entry `saveMetaItem`'s
                    // write-through had put there simply stayed.
                    //
                    // WHICH heal, and why not a bare unregister: this is the
                    // #6687 three-tier walk the sibling delete caller
                    // {@link deleteMetaItem} runs after its own `repo.delete`,
                    // and the tiers are the point. A soft-removed overlay that
                    // shadows a packaged artifact must fall BACK to the
                    // artifact (tier 1, ADR-0005 reset), not vanish; only when
                    // no layer serves the name at all is the plain-key entry
                    // retired (tier 3, #5079). A flat `removeOverlayEntry`
                    // here would delete names a code package still ships. Both
                    // delete/revert callers now run the same walk, exactly as
                    // both now derive the same per-item intent.
                    //
                    // Run for the no-row case too, deliberately: that is the
                    // self-heal branch `deleteMetaItem` documents — a stale
                    // shadow can outlive the row it came from, and this limb's
                    // contract is "this artifact is not here after the revert",
                    // not "a row was deleted".
                    //
                    // [#6602] ORG GATE, and it is asymmetric ON PURPOSE. Only
                    // an env-wide revert may mutate the process-wide registry:
                    // an org-scoped row never entered it (ADR-0005, the rule
                    // {@link hydrateOverlayIntoRegistry} owns), so healing on
                    // its behalf would un-shadow or retire an entry that
                    // belongs to the env-wide row every other org reads. The
                    // write-through's object branch is deliberately NOT
                    // org-gated, and that carve-out does not transfer here: it
                    // is argued from `assertObjectRegistered` failing CLOSED,
                    // which licenses registering broadly and never retiring
                    // broadly. Register wide, retire narrow.
                    //
                    // [#6780] The verdict this comment argues now lives INSIDE
                    // {@link restoreArtifactRegistryView} as a REQUIRED
                    // parameter, so `orgId` is handed over rather than tested
                    // here: PR #6807's call-site `if (orgId === null)` guarded
                    // this ONE caller while the sibling `deleteMetaItem` — the
                    // caller this limb was modelled on — had the same hole on
                    // all three of its own call sites. The gate moved to the
                    // choke point every caller shares; the pin below this
                    // comment is unchanged and still covers the batch path.
                    // [#7559] The ITEM's resolved scope, not the request's — the
                    // #6602 gate this parameter carries asks "is this row
                    // env-wide?", and an env-wide row reverted by an org-scoped
                    // caller skipped the heal entirely while answering success.
                    await this.restoreArtifactRegistryView(it.type, it.name, itemOrgId);
                    reverted.push({ type: it.type, name: it.name, action: 'removed' });
                } else if (it.prevVersion !== null && it.prevVersion !== undefined) {
                    // Edited an existing artifact → restore the pre-commit body.
                    //
                    // [#6563] The write INTENT is derived per item, exactly as the
                    // sibling caller {@link rollbackMetaItem} derives it. Left
                    // unstated, `SysMetadataRepository.restoreVersion` defaults to
                    // `'override-artifact'` and `put`'s `assertAllowed` refuses every
                    // type that is not `allowOrgOverride` — `object` among them — so
                    // each `object` item of a reverted commit came back in `failed[]`
                    // as `NOT_OVERRIDABLE` while the same edit reverted fine one
                    // artifact at a time through the version-history revert. The
                    // repository's default is right for callers that genuinely mean
                    // "override a packaged artifact"; the defect was this caller never
                    // saying which of the two cases it is.
                    //
                    // Per ITEM, not per call: `revertCommit` reverts a batch, and a
                    // commit routinely mixes a runtime-created object with an overlay
                    // on a packaged view. A genuinely artifact-backed item still
                    // resolves to `'override-artifact'` and is still refused — the
                    // derivation states the case, it does not widen the gate.
                    //
                    // The soft-remove limb above stated the same intent as a
                    // CONSTANT and was fixed the same way (#6620), so both limbs now
                    // derive it. The registry half of both is #6621, below.
                    const intent: 'override-artifact' | 'runtime-only' =
                        this.isArtifactBacked(it.type, it.name) ? 'override-artifact' : 'runtime-only';
                    // [#6621 / #4636] The ownership key the write-through needs,
                    // read from the ROW rather than from the request — the sibling
                    // revert caller {@link rollbackMetaItem} reads it exactly this
                    // way, and for the same reason: `revertCommit` has no
                    // `packageId` parameter either, and inventing one would let a
                    // caller re-key an artifact it does not own. Left unpassed, a
                    // row bound to `app.<slug>` re-registers under the
                    // `'sys_metadata'` sentinel and `registerObject` throws
                    // `already owned by package "app.<slug>"` into a best-effort
                    // `console.warn` — a revert that reports success while the
                    // registry keeps the body it was supposed to revert.
                    //
                    // Read BEFORE the restore, deliberately (#4636 again): the row
                    // exists at this point and a read failure still fails this ITEM
                    // cleanly into `failed[]`. Read afterwards it would be a
                    // fallible query downstream of a write that already succeeded —
                    // the shape that ends in a `catch {}` swallowing a real outage
                    // (#4867). Per ITEM, because a batch mixes bindings.
                    const restorePackageId = await this.resolveOverlayPackageBinding(it.type, it.name, itemOrgId);
                    const restored = await repo.restoreVersion(ref, it.prevVersion, {
                        actor,
                        source: 'protocol.revertCommit',
                        message: `revert commit ${request.commitId}`,
                        intent,
                    });
                    // [#6621] #4521 — a revert is a live write like any other: the
                    // restored body must be the one the runtime dispatches on
                    // immediately, not after someone lists the type.
                    //
                    // Measured on `origin/main` before this call existed, with the
                    // real `SysMetadataRepository`: an `object` saved twice and then
                    // reverted answered `{ success: true, revertedCount: 1,
                    // failed: [] }`, the stored row came back to `["name","amount"]`
                    // — and `SchemaRegistry.getObject(...)` still carried
                    // `due_date`. `success: true` while CRUD dispatches on the body
                    // the operator just reverted away, healing only at the next
                    // restart. Type-agnostic: an overlay `view` on a control-plane
                    // kernel showed the same split (`stored 'Cases'` vs
                    // `registry 'Renamed'`).
                    //
                    // The registry key is the SINGULAR type — the spelling
                    // `saveMetaItem`'s own write-through registered under — while
                    // the repo-facing reads above keep `it.type`, which is the
                    // spelling the row is stored with. Two different keys, on
                    // purpose.
                    this.applyRegistryWriteThrough({
                        type: PLURAL_TO_SINGULAR[it.type] ?? it.type,
                        name: it.name,
                        item: restored.item.body,
                        packageId: restorePackageId,
                        // [#6602] The row's OWN scope, per item. An org-scoped row
                        // is refused by {@link hydrateOverlayIntoRegistry} and never
                        // reaches the registry every org in this process shares —
                        // inherited, not re-decided here.
                        // [#7559] …and now that is what it actually IS. This line
                        // said "the row's OWN scope" while passing the REQUEST's
                        // org; the resolution above is what makes the comment true.
                        organizationId: itemOrgId,
                    });
                    reverted.push({ type: it.type, name: it.name, action: 'restored' });
                }
            } catch (e: any) {
                failed.push({
                    type: it.type,
                    name: it.name,
                    error: e?.message ?? 'revert failed',
                    ...(e?.code ? { code: e.code } : {}),
                });
            }
        }

        // Record the revert as its own commit (append-only history).
        const revertCommit = await this.recordPackageCommit({
            orgId,
            packageId: row.package_id,
            operation: 'revert',
            message: `Revert: ${row.message ?? request.commitId}`,
            ...(request.actor ? { actor: request.actor } : {}),
            parentCommitId: request.commitId,
            items: reverted.map((r) => ({
                type: r.type,
                name: r.name,
                existedBefore: r.action === 'restored',
                prevVersion: null,
            })),
        });

        return {
            success: failed.length === 0 && reverted.length > 0,
            revertedCount: reverted.length,
            failedCount: failed.length,
            reverted,
            failed,
            ...(revertCommit ? { revertCommitId: revertCommit.commitId } : {}),
        };
    }

    /**
     * Roll a package back THROUGH every `apply` commit newer than `commitId`
     * (newest first), leaving the package as it was at that commit. Each step is
     * an individual `revertCommit`, so the whole rollback is itself audited.
     */
    async rollbackToPackageCommit(request: {
        commitId: string;
        organizationId?: string;
        actor?: string;
    }): Promise<{
        success: boolean;
        revertedCommits: string[];
        failed: Array<{ commitId: string; error: string }>;
    }> {
        const where: Record<string, unknown> = { id: request.commitId };
        // [#7819] Same widening as the {@link revertCommit} lookup above, and
        // for the sharper reason: this function PLANS from {@link listCommits},
        // which since #7814 returns org-scoped and env-wide rows alike to an
        // org caller. With the strict equality here, an org-scoped rollback
        // whose TARGET happened to be recorded env-wide answered 404 before it
        // planned anything at all — for a commit the caller's own timeline had
        // just listed. The rationale for the `$or` over the alternatives, and
        // for leaving the no-org branch un-narrowed, is stated in full there.
        if (request.organizationId) {
            where.$or = [
                { organization_id: request.organizationId },
                { organization_id: null },
            ];
        }
        const target = (await this.engine.findOne('sys_metadata_commit', { where })) as any;
        if (!target) {
            const err: any = new Error(`[commit_not_found] No commit '${request.commitId}'.`);
            err.code = 'COMMIT_NOT_FOUND';
            err.status = 404;
            throw err;
        }
        const all = await this.listCommits({
            packageId: target.package_id,
            ...(request.organizationId ? { organizationId: request.organizationId } : {}),
        });
        // listCommits is newest-first; revert every `apply` commit strictly newer
        // than the target (by created_at). Revert commits are skipped (their
        // effect is already captured by re-reverting the apply they undid).
        const targetCreatedAt = String(target.created_at ?? '');
        const toRevert = all.filter(
            (c) => String(c.createdAt ?? '') > targetCreatedAt && c.operation === 'apply',
        );
        const revertedCommits: string[] = [];
        const failed: Array<{ commitId: string; error: string }> = [];
        for (const c of toRevert) {
            try {
                await this.revertCommit({
                    commitId: c.id,
                    ...(request.organizationId ? { organizationId: request.organizationId } : {}),
                    ...(request.actor ? { actor: request.actor } : {}),
                });
                revertedCommits.push(c.id);
            } catch (e: any) {
                failed.push({ commitId: c.id, error: e?.message ?? 'revert failed' });
            }
        }
        return { success: failed.length === 0, revertedCommits, failed };
    }

    /**
     * Restore the body recorded at history `toVersion` as the new
     * live row. Writes a history event with `op='revert'`. 404
     * (`[version_not_found]`) when the target version doesn't exist;
     * 409 (`[version_not_restorable]`) when the target is a delete
     * tombstone (no body to bring back).
     */
    async rollbackMetaItem(request: {
        type: string;
        name: string;
        toVersion: number;
        organizationId?: string;
        actor?: string;
        message?: string;
    }): Promise<{
        success: boolean;
        version: string;
        seq: number;
        restoredFromVersion: number;
        message?: string;
    }> {
        if (!Number.isFinite(request.toVersion) || request.toVersion < 1) {
            const err: any = new Error(
                `[invalid_request] rollbackMetaItem requires a positive integer 'toVersion' (got ${request.toVersion}).`,
            );
            err.code = 'INVALID_REQUEST';
            err.status = 400;
            throw err;
        }
        const singularType = PLURAL_TO_SINGULAR[request.type] ?? request.type;
        if (!ObjectStackProtocolImplementation.isOverlayAllowed(singularType)
            && !ObjectStackProtocolImplementation.isRuntimeCreateAllowed(singularType)) {
            const err: any = new Error(
                `[not_overridable] Metadata type '${request.type}' is not revertable — no overlay/runtime-create permission.`,
            );
            err.code = 'NOT_OVERRIDABLE';
            err.status = 403;
            throw err;
        }
        // ADR-0010 L3 — lock blocks rollback (writes a new active row).
        const _rollbackLockErr = await this.assertLockAllowsWrite({
            type: request.type,
            name: request.name,
            ...(request.organizationId ? { organizationId: request.organizationId } : {}),
            operation: 'rollback',
            ...(request.actor ? { actor: request.actor } : {}),
            source: 'protocol.rollbackMetaItem',
        });
        if (_rollbackLockErr) throw _rollbackLockErr;
        await this.ensureOverlayIndex();
        // [#7559] The scope the item's lineage actually lives in, not the
        // caller's active org. Measured on `origin/main`: an env-wide `view`
        // rolled back by a caller with an active org threw `VERSION_NOT_FOUND`
        // (404) at exactly the version its own history endpoint lists, while
        // the identical call with no active org succeeded — the same
        // disagreement {@link revertCommit} showed, one caller over. See
        // {@link resolveMetaItemOrgScope}.
        const orgId = await this.resolveMetaItemOrgScope(
            singularType,
            request.name,
            request.organizationId ?? null,
        );
        const repo = this.getOverlayRepo(orgId);
        const artifactBacked = this.isArtifactBacked(singularType, request.name);
        const intent: 'override-artifact' | 'runtime-only' = artifactBacked
            ? 'override-artifact' : 'runtime-only';
        const ref = {
            type: singularType,
            name: request.name,
            org: orgId ?? 'env',
        } as Parameters<typeof repo.restoreVersion>[0];
        // [#4636] The ownership key the write-through below needs, read from
        // the ROW rather than from the request — `rollbackMetaItem` has no
        // `packageId` parameter, and inventing one would let a caller re-key
        // an object it does not own. `restoreVersion` → `put` preserves an
        // existing non-null `package_id` on update, so the binding read here
        // is the binding the restored row still carries.
        //
        // Read BEFORE the restore, deliberately: the row exists at this point
        // and a read failure can still fail the whole rollback cleanly. Reading
        // it afterwards would put a fallible query downstream of a write that
        // already succeeded — the shape that ends in a `catch {}` swallowing a
        // real outage (#4867).
        const rollbackPackageId = await this.resolveOverlayPackageBinding(singularType, request.name, orgId);
        try {
            const result = await repo.restoreVersion(ref, request.toVersion, {
                // #4556 — NULL, not 'system', for an actor-less rollback.
                actor: request.actor ?? null,
                source: 'protocol.rollbackMetaItem',
                ...(request.message ? { message: request.message } : {}),
                intent,
            });
            // #4521 — a rollback is a live write like any other: the restored
            // body must be the one the runtime dispatches on immediately, not
            // after someone lists the type.
            // #4636 — …under the SAME ownership key `saveMetaItem` used. Left
            // unpassed, an object row bound to `app.<slug>` re-registered here
            // under the `'sys_metadata'` sentinel and `registerObject` threw
            // `already owned by package "app.<slug>"` into the best-effort
            // `console.warn` — a rollback that reported success while the
            // registry kept serving the body it was supposed to revert.
            this.applyRegistryWriteThrough({
                type: singularType,
                name: request.name,
                item: result.item.body,
                packageId: rollbackPackageId,
                // [#6602] A rollback restores the row IN ITS OWN SCOPE — an
                // org-scoped restore must not graft the body process-wide.
                organizationId: orgId,
            });
            // [#7748] ADR-0010 — success audit (best-effort). Same position as
            // `saveMetaItem`'s: persistence committed, registry write-through
            // done, before the receipt. A rollback reached `recordMetadataAudit`
            // only through `assertLockAllowsWrite`'s DENY path before this, so a
            // refused rollback was recorded and a performed one was not.
            await this.recordMetadataAudit({
                type: request.type,
                name: request.name,
                organizationId: orgId,
                operation: 'rollback',
                outcome: 'allowed',
                code: 'ok',
                ...(request.actor ? { actor: request.actor } : {}),
                source: 'protocol.rollbackMetaItem',
                note: `restored from version ${request.toVersion}`,
            });
            return {
                success: true,
                version: result.version,
                seq: result.seq,
                restoredFromVersion: request.toVersion,
                message: `Reverted to version ${request.toVersion} — type=${request.type}, name=${request.name} [seq=${result.seq}]`,
            };
        } catch (err: any) {
            if (err instanceof ConflictError) {
                const conflict: any = new Error(
                    `[metadata_conflict] ${request.type}/${request.name} advanced during rollback. `
                    + `Expected parent ${err.expectedParent ?? 'null'} but current is ${err.actualHead ?? 'null'}.`,
                );
                conflict.code = 'METADATA_CONFLICT';
                conflict.status = 409;
                conflict.expectedParent = err.expectedParent;
                conflict.actualHead = err.actualHead;
                await this.recordOptimisticConflictAudit({
                    type: request.type,
                    name: request.name,
                    organizationId: orgId,
                    operation: 'rollback',
                    ...(request.actor ? { actor: request.actor } : {}),
                    source: 'protocol.rollbackMetaItem',
                    expectedParent: err.expectedParent,
                    actualHead: err.actualHead,
                });
                throw conflict;
            }
            throw err;
        }
    }

    /**
     * Compute a shallow structural diff between two historical
     * versions of a metadata item. Either side may be omitted: when
     * `toVersion` is undefined the current active body is used; when
     * `fromVersion` is undefined the immediately previous history row
     * is used. Returns `{ added, removed, changed }` keyed by JSON
     * pointer-style paths for primitive leaves; nested objects/arrays
     * are reported as a single change record.
     */
    async diffMetaItem(request: {
        type: string;
        name: string;
        fromVersion?: number;
        toVersion?: number;
        organizationId?: string;
    }): Promise<{
        type: string;
        name: string;
        fromVersion: number | null;
        toVersion: number | null;
        added: Array<{ path: string; value: unknown }>;
        removed: Array<{ path: string; value: unknown }>;
        changed: Array<{ path: string; from: unknown; to: unknown }>;
    }> {
        const singularType = PLURAL_TO_SINGULAR[request.type] ?? request.type;
        const orgId = request.organizationId ?? null;
        const events = (await this.historyMetaItem({
            type: singularType,
            name: request.name,
            ...(orgId ? { organizationId: orgId } : {}),
        })).events;
        const versions = events
            .map((ev: any) => (ev as any).version as number | undefined)
            .filter((v): v is number => typeof v === 'number');
        // The `historyMetaItem` MetadataEvent shape doesn't carry the
        // per-(type,name) `version` directly — re-fetch via the repo
        // to read the underlying history rows with their version.
        const repo = this.getOverlayRepo(orgId);
        const fullRef = {
            type: singularType,
            name: request.name,
            org: orgId ?? 'env',
        } as { type: string; name: string; org: string };
        const histRows: Array<{ version: number; body: Record<string, unknown> | null }> = [];
        try {
            const engineAny = this.engine as any;
            const rows = await engineAny.find('sys_metadata_history', {
                where: {
                    organization_id: orgId,
                    type: singularType,
                    name: request.name,
                },
            });
            rows.sort((a: any, b: any) => (a.version ?? 0) - (b.version ?? 0));
            for (const r of rows) {
                const body = r.metadata == null
                    ? null
                    : (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata);
                histRows.push({ version: r.version ?? 0, body });
            }
        } catch {
            // history table unavailable — fall through with empty list
        }
        const byVersion = new Map<number, Record<string, unknown> | null>();
        for (const r of histRows) byVersion.set(r.version, r.body);

        let fromBody: Record<string, unknown> | null = null;
        let toBody: Record<string, unknown> | null = null;
        let fromVersion: number | null = null;
        let toVersion: number | null = null;

        if (request.toVersion !== undefined) {
            toVersion = request.toVersion;
            toBody = byVersion.get(request.toVersion) ?? null;
        } else {
            const current = await repo.get(fullRef as any, { state: 'active' });
            toBody = current ? (current.body as Record<string, unknown>) : null;
            toVersion = histRows.length ? histRows[histRows.length - 1]!.version : null;
        }
        if (request.fromVersion !== undefined) {
            fromVersion = request.fromVersion;
            fromBody = byVersion.get(request.fromVersion) ?? null;
        } else if (toVersion !== null) {
            // Use the version immediately preceding `toVersion`
            const sorted = histRows.map((r) => r.version).filter((v) => v < toVersion!);
            if (sorted.length) {
                fromVersion = sorted[sorted.length - 1]!;
                fromBody = byVersion.get(fromVersion) ?? null;
            }
        }
        const diff = diffShallow(fromBody ?? {}, toBody ?? {});
        const _used = versions; void _used;
        return {
            type: request.type,
            name: request.name,
            fromVersion,
            toVersion,
            ...diff,
        };
    }

    /**
     * Remove a customization overlay row for the given metadata item, so the
     * next read falls through to the artifact-loaded default. Implements the
     * "Reset to factory default" semantic from ADR-0005. Whitelist is shared
     * with {@link saveMetaItem}.
     */
    async deleteMetaItem(request: {
        type: string;
        name: string;
        organizationId?: string;
        parentVersion?: string | null;
        actor?: string;
        state?: 'active' | 'draft';
        /**
         * When true, also drop the object's physical table after the metadata
         * is removed (object + active only; never `sys_`). Default false keeps
         * delete non-destructive to data. Used by the "discard a previewed
         * object" flow so a publish-to-preview leaves no orphan table.
         */
        dropStorage?: boolean;
    }): Promise<{
        success: boolean;
        message?: string;
        reset?: boolean;
        seq?: number;
        /** [ADR-0094] Outcome of the awaited mutation projector, when one is registered. */
        projectionApplied?: MutationProjectionOutcome;
    }> {
        // #4432 — CANONICAL TYPE KEY. See {@link canonicalMetaType}. Without it
        // the authorization tier (`isOverlayAllowed` / `isArtifactBacked`) and
        // the registry heal (`restoreArtifactRegistryView`) read the caller's
        // spelling while the repository deletes under the singular — so a
        // DELETE could remove the row and leave the shadow it was meant to lift.
        request = canonicalizeMetaRequestType(request);
        // Two-tier authorization for delete (mirrors saveMetaItem).
        //  • Artifact-backed item → delete becomes a tombstone overlay,
        //    requires `allowOrgOverride`…
        //  • …EXCEPT when the type's loader merges overlays at read time
        //    (`supportsOverlay: true`) — then removing the row is repair and
        //    is allowed without it. [#6960, delete-only; see below.]
        //  • DB-only item → hard delete of a user-created row,
        //    requires `allowRuntimeCreate` (or `allowOrgOverride`).
        if (this.environmentId !== undefined) {
            const overlayAllowed = ObjectStackProtocolImplementation.isOverlayAllowed(request.type);
            const runtimeCreateAllowed = ObjectStackProtocolImplementation.isRuntimeCreateAllowed(request.type);
            const artifactBacked = this.isArtifactBacked(request.type, request.name);
            // [#6960] …and the ONE removal the refusal above must not swallow.
            //
            // MAINTAINER RULING, 2026-08-10 (#6960): removing a legacy env
            // overlay on a type whose per-org override channel was rolled back
            // is allowed through the ordinary delete path. Deleting an overlay
            // restores the code-declared state — it is the NARROWING direction
            // and cannot widen anything — so refusing it serves no security
            // purpose while trapping the repair behind `OS_METADATA_WRITABLE`.
            //
            // ⛔ DELETE ONLY, AND IT IS NOT AN OVERSIGHT. Create and update on
            // the same item stay refused exactly as before (`saveMetaItem`'s
            // sibling gate is untouched); a future tidy-up that "restores
            // symmetry" here re-opens the write door the #6483 rollback closed.
            // The asymmetry is the ruling.
            //
            // THE TIER BOUNDARY, which is what makes this narrow enough to be
            // safe: {@link mergesOverlayAtRead} is `supportsOverlay`, NOT
            // `allowOrgOverride`.
            //
            //  • `supportsOverlay: true` + `allowOrgOverride: false` — the
            //    ROLLED-BACK OVERLAYABLE tier (`permission` / `position` /
            //    `page` / `app` / `dataset` / `book`, and any type that lands
            //    in this shape later). #6483 / PR #6608 closed the write door
            //    and left the read path merging overlay-wins, so a row
            //    authored before the rollback still shapes the effective body
            //    and the ordinary "Reset to package default" flow answered 403
            //    with the item still customized. That is the stuck operator
            //    this branch releases.
            //  • `supportsOverlay: false` — `object` above all, whose overlay
            //    is a CONTRIBUTOR LAYER (ADR-0029 D9) rather than a merge, and
            //    whose reset refusal is D9.6's declared and maintainer-approved
            //    cost. This branch does not reach it and must not: pinned by
            //    `protocol-object-overlay-layer.test.ts` on both topologies.
            //
            // The same carve-out is mirrored — deliberately, not by accident —
            // in `SysMetadataRepository`'s delete gate, because that one is
            // TOPOLOGY-INDEPENDENT: a control-plane kernel skips this whole
            // block (`environmentId === undefined`) and would otherwise be
            // refused there instead, leaving the fix half-done. See
            // {@link SysMetadataRepository.assertDeleteAllowed}.
            const legacyOverlayRemoval = ObjectStackProtocolImplementation
                .mergesOverlayAtRead(request.type);
            if (artifactBacked && !overlayAllowed && !legacyOverlayRemoval) {
                const err = new Error(
                    `[not_overridable] Metadata item '${request.type}/${request.name}' is provided by a code package `
                    + `and the type has not opted into per-org overlay writes. `
                    + `See docs/adr/0005-metadata-customization-overlay.md.`
                );
                (err as any).code = 'NOT_OVERRIDABLE';
                (err as any).status = 403;
                throw err;
            }
            if (!artifactBacked && !overlayAllowed && !runtimeCreateAllowed) {
                const err = new Error(
                    `[not_creatable] Metadata type '${request.type}' does not allow runtime creation or deletion.`
                );
                (err as any).code = 'NOT_CREATABLE';
                (err as any).status = 403;
                throw err;
            }

            // ADR-0010 L3 — lock blocks delete.
            const lockErr = await this.assertLockAllowsDelete({
                type: request.type,
                name: request.name,
                ...(request.organizationId ? { organizationId: request.organizationId } : {}),
                ...(request.actor ? { actor: request.actor } : {}),
                source: 'protocol.deleteMetaItem',
            });
            if (lockErr) throw lockErr;
        }

        const singularTypeForRepo = PLURAL_TO_SINGULAR[request.type] ?? request.type;
        // #5927 — the fact the four delete receipts below have to tell the
        // truth about, hoisted to method scope because it is read by BOTH
        // delete paths (repository and legacy raw-engine) and by `intent`.
        //
        // It is the SAME fact the repo path already computed inline for
        // `intent: 'override-artifact' | 'runtime-only'` — this binding
        // replaces that call rather than adding one, so the receipt split
        // costs zero new registry reads. (The two-tier authorization block
        // above computes it a second time under `request.type`; that one is
        // block-scoped to `environmentId !== undefined` and cannot be reused
        // here. Both spellings agree: `canonicalizeMetaRequestType` already
        // folded `request.type` to singular at the top of this method, which
        // makes `singularTypeForRepo` a no-op re-fold — see #4432.)
        const artifactBacked = this.isArtifactBacked(singularTypeForRepo, request.name);
        const overlayAllowedForRepoDel = ObjectStackProtocolImplementation.isOverlayAllowed(singularTypeForRepo);
        const runtimeCreateAllowedForRepoDel = ObjectStackProtocolImplementation.isRuntimeCreateAllowed(singularTypeForRepo);
        const useRepoPath = overlayAllowedForRepoDel || runtimeCreateAllowedForRepoDel;

        // ADR-0008 — overlay-allowed types route through SysMetadataRepository
        // so the delete (a) is wrapped in engine.transaction(), (b) appends a
        // tombstone row to sys_metadata_history, and (c) emits a watch event
        // with a monotonic `seq` for HMR. Non-overlay-allowed types (only
        // reachable in control-plane bootstrap mode where environmentId is
        // undefined) take the legacy raw-engine path below — the repository's
        // `assertAllowed()` whitelist would 403 those deletes.
        if (useRepoPath) {
            const orgId = request.organizationId ?? null;
            const repo = this.getOverlayRepo(orgId);
            const ref = {
                type: singularTypeForRepo,
                name: request.name,
                org: orgId ?? 'env',
            } as Parameters<typeof repo.delete>[0];

            try {
                const targetState: 'active' | 'draft' = request.state === 'draft' ? 'draft' : 'active';
                // Probe first — "no overlay exists" is a success/no-op, not
                // a conflict. The repo would otherwise throw ConflictError.
                const current = await repo.get(ref, { state: targetState });
                if (!current) {
                    // Self-heal: even with no overlay row, a stale runtime
                    // shadow may linger in the registry (e.g. pollution from
                    // before this fix shipped) — drop it so the artifact
                    // view really IS the default we claim below.
                    //
                    // [#6780] `orgId` is passed, and this branch is where it
                    // matters MOST: with no row to delete, an org that never
                    // customized anything at all could evict the env-wide
                    // plain-key entry with a single no-op DELETE. Measured on
                    // `origin/main`: receipt `{reset: false, "nothing to
                    // delete"}` and `registry.getItem('view','shared_grid')`
                    // → `undefined`, the env-wide row untouched in
                    // `sys_metadata`. A gate applied only to the delete-ful
                    // branch below would have left this door standing open.
                    if (targetState === 'active') {
                        await this.restoreArtifactRegistryView(request.type, request.name, orgId);
                    }
                    return {
                        success: true,
                        reset: false,
                        // #5927 — "already at artifact default" presumes an
                        // artifact default EXISTS to be at. When nothing is
                        // shipped under this (type, name), the absent overlay
                        // row is the absence of the whole item, and the miss
                        // says that instead of naming a baseline that was
                        // never there. The draft leg claimed neither and is
                        // unchanged, verbatim.
                        message: targetState === 'draft'
                            ? `No pending draft for ${request.type}/${request.name}.`
                            : artifactBacked
                                ? `No customization overlay found for ${request.type}/${request.name} — already at artifact default.`
                                : `No ${singularTypeForRepo} '${request.name}' found — nothing to delete.`,
                    };
                }

                // Last-write-wins parent resolution unless the caller pinned
                // an explicit version (Studio's "Reset" button is unpinned;
                // a future "delete vN" flow can pass parentVersion).
                const parentVersion: string = request.parentVersion !== undefined
                    ? (request.parentVersion ?? current.hash)
                    : current.hash;

                const result = await repo.delete(ref, {
                    parentVersion,
                    // #4556 — NULL, not 'system', for an actor-less delete.
                    actor: request.actor ?? null,
                    source: 'protocol.deleteMetaItem',
                    // #5927 — was an inline `this.isArtifactBacked(...)` call
                    // with these exact arguments; now reads the method-scoped
                    // binding the receipts share. Same fact, one call fewer.
                    intent: artifactBacked
                        ? 'override-artifact'
                        : 'runtime-only',
                    state: targetState,
                });

                // Heal the registry: drop the overlay's runtime shadow so the
                // packaged artifact is visible again (all kernels), and on
                // control-plane kernels also refresh from MetadataService —
                // see {@link restoreArtifactRegistryView}. Draft discards
                // skip this: drafts never hydrate into the registry, and the
                // still-active overlay (if any) must keep its shadow.
                //
                // [#6780] SCOPED by the same `orgId` the row was deleted with,
                // so the registry's view cannot disagree with the row's scope
                // — the sibling rule the write side states in
                // {@link applyRegistryWriteThrough}. Org A resetting ITS OWN
                // overlay used to retire the plain-key entry belonging to the
                // ENV-WIDE row, i.e. one tenant's "reset to default" blanked
                // the item for every other tenant and the control plane.
                if (targetState === 'active') {
                    await this.restoreArtifactRegistryView(request.type, request.name, orgId);
                }

                // Storage teardown (opt-in): drop the now-orphaned physical table
                // for a discarded object so a publish-to-preview leaves no residue.
                if (this.shouldDropStorage(request.type, request.name, request.dropStorage, targetState)) {
                    await this.dropObjectStorage(singularTypeForRepo, request.name);
                }

                // ADR-0010 — success audit (best-effort).
                await this.recordMetadataAudit({
                    type: request.type,
                    name: request.name,
                    organizationId: orgId,
                    operation: 'delete',
                    outcome: 'allowed',
                    code: 'ok',
                    ...(request.actor ? { actor: request.actor } : {}),
                    source: 'protocol.deleteMetaItem',
                    note: targetState,
                });

                // [ADR-0094] Awaited projection: a delete may retire the
                // derived record OR reset it to the artifact baseline — the
                // projector re-reads the layered state and decides.
                const deleteProjection = await this.runMutationProjector({
                    type: singularTypeForRepo,
                    name: request.name,
                    state: 'deleted',
                    organizationId: orgId,
                });
                this.emitMetadataMutation({
                    type: singularTypeForRepo,
                    name: request.name,
                    state: 'deleted',
                    organizationId: orgId,
                });
                return {
                    success: true,
                    reset: true,
                    seq: result.seq,
                    ...(deleteProjection ? { projectionApplied: deleteProjection } : {}),
                    // #5927 — the same split #5265/PR #5926 made on the save
                    // side, on the reset path. `artifactBacked` is exactly the
                    // difference between the two things a delete can be:
                    //
                    //   • override-artifact — a code-shipped artifact sits
                    //     under this (type, name). Removing the row really
                    //     does lift a customization layer and really does
                    //     leave the packaged default in force; the sentence is
                    //     literally true and is unchanged, byte for byte.
                    //   • runtime-only — nothing is underneath. The row WAS
                    //     the item, and after this delete it does not exist in
                    //     any layer. Telling an admin who just deleted an
                    //     `object`/`flow`/`hook` they created that it was
                    //     "reset to artifact default" points them at a
                    //     baseline that has never existed.
                    //
                    // The draft leg discards a pending draft and never claimed
                    // a reset, so it is unchanged. `[seq=…]` stays on every
                    // branch — HMR cursors read it.
                    message: (request.state === 'draft')
                        ? `Draft discarded — ${request.type}/${request.name}. [seq=${result.seq}]`
                        : artifactBacked
                            ? `Customization overlay deleted — ${request.type}/${request.name} reset to artifact default. [seq=${result.seq}]`
                            : `Deleted ${singularTypeForRepo} '${request.name}' — it no longer exists. [seq=${result.seq}]`,
                };
            } catch (err: any) {
                if (err instanceof ConflictError) {
                    const conflict = new Error(
                        `[metadata_conflict] ${request.type}/${request.name} has been modified since you loaded it. `
                        + `Expected parent ${err.expectedParent ?? 'null'} but current is ${err.actualHead ?? 'null'}.`,
                    );
                    (conflict as any).code = 'METADATA_CONFLICT';
                    (conflict as any).status = 409;
                    (conflict as any).expectedParent = err.expectedParent;
                    (conflict as any).actualHead = err.actualHead;
                    await this.recordOptimisticConflictAudit({
                        type: request.type,
                        name: request.name,
                        organizationId: orgId,
                        operation: 'delete',
                        ...(request.actor ? { actor: request.actor } : {}),
                        source: 'protocol.deleteMetaItem',
                        expectedParent: err.expectedParent,
                        actualHead: err.actualHead,
                    });
                    throw conflict;
                }
                // [#8136] The message quotes `err` only when `err` DECLARED
                // itself a caller-facing refusal — see {@link
                // declaresClientRefusal}. Every engine touch in the `try` above
                // (`repo.get`, `repo.delete`, `restoreArtifactRegistryView`,
                // `dropObjectStorage`, `recordMetadataAudit`, the projector)
                // can land a bare driver `Error` in this catch, and this exit
                // used to interpolate it whole.
                const e = new Error(overlayDeleteFailureMessage(err, request.type, request.name));
                (e as any).status = err?.status ?? 500;
                // The withheld text is not lost, it is relocated: `cause` is
                // what `handleRouteError` / `logWithheldServerFault` print, the
                // same posture {@link metadataStoreUnavailableError} takes.
                (e as any).cause = err;
                // [#7426] …and the SAME treatment for `code`, gated on the
                // declared vocabulary. This is the exit a control-plane
                // kernel's repository refusal leaves by — `NOT_OVERRIDABLE` /
                // 403 for a `supportsOverlay: false` type — and until now only
                // its `status` made it out. See {@link carryCatalogedErrorCode}
                // for why an unconditional copy is the wrong shape here.
                carryCatalogedErrorCode(e, err);
                throw e;
            }
        }

        // ── Legacy raw-engine path: reachable in control-plane bootstrap
        // (`environmentId === undefined`) for a code-only type — one whose
        // registry entry sets BOTH `allowOrgOverride: false` and
        // `allowRuntimeCreate: false` (today `job` and `agent`). No history
        // row, no watch event — these types don't participate in the
        // change-log model, and `SysMetadataRepository.assertAllowed()` would
        // 403 the delete outright.
        //
        // #5264 — THIS ONE IS ALIVE. `saveMetaItem` used to carry a branch of
        // the same shape; that one was deleted because #5086 (PR #5263) put an
        // unconditional code-only refusal in front of it, on every kernel.
        // The delete side was left ungated ON PURPOSE by that same PR, and the
        // asymmetry is the point: refusing to CREATE a code-only row is a new
        // guarantee, while REMOVING a code-only row that predates the refusal
        // is the repair action the guarantee depends on. Note where the gate
        // above stops — the two-tier delete authorization runs only when
        // `environmentId !== undefined`, so on a control-plane kernel a
        // code-only delete arrives here with `useRepoPath === false` and this
        // is the only code that can serve it.
        //
        // So: do not "clean up the symmetry" by deleting this the way #5264
        // deleted its twin, and do not gate it to match `saveMetaItem` —
        // either would strand the very rows #5263 made unwritable. If it ever
        // does become unreachable, the proof has to come from the delete
        // side's own gates, not from the save side's.
        const scopedWhere: Record<string, unknown> = {
            type: request.type,
            name: request.name,
            organization_id: request.organizationId ?? null,
        };

        try {
            const existing = await this.engine.findOne('sys_metadata', { where: scopedWhere });
            if (!existing) {
                return {
                    success: true,
                    reset: false,
                    // #5927 — same split as the repository path's miss above.
                    message: artifactBacked
                        ? `No customization overlay found for ${request.type}/${request.name} — already at artifact default.`
                        : `No ${singularTypeForRepo} '${request.name}' found — nothing to delete.`,
                };
            }
            await this.engine.delete('sys_metadata', { where: { id: existing.id } });

            // Storage teardown (opt-in) — see the repo-path branch above.
            {
                const targetState: 'active' | 'draft' = request.state === 'draft' ? 'draft' : 'active';
                if (this.shouldDropStorage(request.type, request.name, request.dropStorage, targetState)) {
                    await this.dropObjectStorage(PLURAL_TO_SINGULAR[request.type] ?? request.type, request.name);
                }
            }

            // [#6780] The legacy path deletes under the SAME org predicate it
            // built into `scopedWhere` above, so the heal reads its scope from
            // the same place. Reachable only on a control-plane kernel for a
            // code-only type, which is exactly the kernel whose registry every
            // org shares — the narrowest path and the widest blast radius.
            if (request.state !== 'draft') {
                await this.restoreArtifactRegistryView(
                    request.type,
                    request.name,
                    request.organizationId ?? null,
                );
            }

            return {
                success: true,
                reset: true,
                // #5927 — same split as the repository path's success above.
                // This branch carries no `[seq=…]`: it writes no history row
                // and emits no watch event (see the block comment opening this
                // path), so there is no cursor to report. That asymmetry is
                // pre-existing and deliberate — the split does not touch it.
                message: artifactBacked
                    ? `Customization overlay deleted — ${request.type}/${request.name} reset to artifact default.`
                    : `Deleted ${singularTypeForRepo} '${request.name}' — it no longer exists.`,
            };
        } catch (err: any) {
            // [#8136] Same rule as the repository path's exit above — one
            // sentence-selection rule for both, so the envelope does not vary
            // by which path served the delete. This path is deliberately
            // ungated (#5264), so in practice everything reaching here is a
            // fault and nothing is quoted; the shared helper is what keeps that
            // true if a declared refusal ever does arrive.
            const e = new Error(overlayDeleteFailureMessage(err, request.type, request.name));
            (e as any).status = 500;
            (e as any).cause = err;
            // [#7426] The SECOND re-wrap exit, and it gets the same `code` rule
            // — otherwise the verb would answer an envelope that varies by
            // which path served the delete, which is harder to reason about
            // than the gap it replaced. Only refusals cannot arrive here (this
            // path is deliberately ungated, #5264), so in practice what it
            // carries is an engine code the ledger registered; the literal 500
            // stays as it is, for the reason {@link carryCatalogedErrorCode}
            // gives.
            carryCatalogedErrorCode(e, err);
            throw e;
        }
    }

    /**
     * Hydrate SchemaRegistry from the database on startup.
     * Loads all active metadata records and registers them in the in-memory registry.
     * Safe to call repeatedly — idempotent (latest DB record wins).
     *
     * Per ADR-0005, project-kernel mode ALSO hydrates from sys_metadata —
     * customization overlay rows must survive restart. Scope filter
     * (`environment_id = this.environmentId ?? null`) keeps tenants isolated.
     *
     * #3903 — two contract duties run per row, and their split is deliberate:
     *
     *  1. **Convert** ({@link convertStoredItem}): the full ADR-0087 chain
     *     replays, so a row written under a past protocol registers in the
     *     canonical shape. Chain-owned history therefore stops presenting as
     *     "invalid metadata" at all.
     *  2. **Diagnose, never drop**: what still fails the type's current spec
     *     schema *after* conversion is a genuine contract violation — counted
     *     in `invalid`, warned with a stable `[metadata_spec_invalid]` marker,
     *     and STILL registered. Boot-time refusal would unhook the metadata
     *     from every serving surface (an object row backs live tables; an
     *     unregistered item cannot even be listed, opened, or fixed in
     *     Studio), turning an upgrade into a data outage. The enforcing gates
     *     live where an author is present to act: `saveMetaItem` rejects new
     *     writes (422), and the read surfaces badge the row via
     *     `_diagnostics`. This is that same read-side verdict, surfaced once
     *     at boot where operators look.
     *
     * #5897 / ADR-0110 D3 — the return value can now say **"the store was not
     * read at all"**. `loaded: 0` alone cannot: it is equally the truth for an
     * empty store, an un-provisioned store, and a database this process could
     * not reach, and the sole consumer
     * (`ObjectQLPlugin.restoreMetadataFromDb`) therefore logged an outage as
     * `debug` "No persisted metadata found in database" while the kernel went
     * on to report ready. `storeUnavailable` is that missing bit, set on
     * exactly the branch that already prints `DB hydration skipped` — i.e. the
     * outer read failed for a reason {@link isMissingTableError} does NOT call
     * benign.
     *
     * Three things it deliberately is **not**:
     *
     *  - **Not a superset of `errors`.** Per-row hydration failures already
     *    have their own counter and the rows around them did land. This bit
     *    means the row set itself never arrived, so the hydration is not
     *    partial — it is absent. (Named `storeUnavailable` rather than a bare
     *    `degraded` for that reason: the narrower word cannot be misread as
     *    "something, somewhere, went wrong".)
     *  - **Not set for an un-provisioned store.** A first boot before
     *    migrations genuinely holds no overlay rows (#5841), so `loaded: 0` IS
     *    the truth there and the bit stays `false`.
     *  - **Not a control-flow change.** Boot still degrades and continues; what
     *    changes is that the degradation can be *told apart* from health and is
     *    reported at the level AGENTS.md "Degradation log levels" prescribes
     *    for it — persisted state and runtime state disagreeing while the
     *    system keeps looking healthy is the `error` class.
     *
     * It is the boot-side spelling of the same fact `MetadataManager`'s
     * `loadDiagnosed` reports as `degraded` for the loader plane.
     */
    async loadMetaFromDb(): Promise<{ loaded: number; errors: number; invalid: number; storeUnavailable: boolean }> {
        let loaded = 0;
        let errors = 0;
        let invalid = 0;
        /** #5897 — see the TSDoc: set only on the non-benign outer-catch branch. */
        let storeUnavailable = false;
        try {
            // ADR-0005 (revised 2026-05): hydrate only env-wide rows
            // (organization_id IS NULL). Per-org overlays are loaded on
            // demand by getMetaItem to avoid cross-org leakage into the
            // process-wide SchemaRegistry.
            const where: Record<string, unknown> = {
                state: 'active',
                organization_id: null,
            };
            const records = await this.engine.find('sys_metadata', { where });
            for (const record of records) {
                try {
                    const data = this.convertStoredItem(
                        String(record.type),
                        typeof record.metadata === 'string'
                            ? JSON.parse(record.metadata)
                            : record.metadata,
                    );
                    // Normalize DB type to singular (DB may store legacy plural forms)
                    const normalizedType = PLURAL_TO_SINGULAR[record.type] ?? record.type;
                    const verdict = computeMetadataDiagnostics(normalizedType, data);
                    if (verdict && !verdict.valid) {
                        invalid++;
                        const first = verdict.errors?.[0];
                        console.warn(
                            `[Protocol] [metadata_spec_invalid] stored ${normalizedType}/${record.name} fails the ` +
                            `current spec schema even after conversion` +
                            (first ? ` (${first.path || '<root>'}: ${first.message})` : '') +
                            `. Registered anyway so it stays serveable and fixable — correct it in Studio ` +
                            `(the read carries the full _diagnostics), or delete the sys_metadata row.`,
                        );
                    }
                    if (normalizedType === 'object') {
                        // Every row here came from `sys_metadata` — a TENANT-authored
                        // overlay, whatever package it is bound to. Say so (ADR-0010
                        // `_provenance: 'org'`), because the package id alone reads as
                        // code provenance: registering under the real `app.<slug>`
                        // made the registry's artifact lookup claim the row was
                        // code-shipped, and `saveMetaItem`'s overlay gate then refused
                        // the very next write with `not_overridable`. An app the user
                        // had just built became un-editable at the first kernel
                        // rebuild (cloud#970).
                        //
                        // The ownership key is the row's REAL package binding
                        // (#4636 PR2). These rows come off `engine.find`, so
                        // their columns are snake_case — `package_id`, never
                        // `packageId`, exactly as `getMetaItems` and the
                        // sibling branch below already read them. Reading the
                        // camelCase key made the expression `undefined ||
                        // 'sys_metadata'`, so every boot registered even a
                        // package-bound object under the sentinel and the
                        // sidebar's `getAllObjects(packageId)` filter lost it
                        // across a restart. `||` and not `??`, symmetric with
                        // the write path's `request.packageId || 'sys_metadata'`:
                        // an empty binding is "no package", and the sentinel
                        // marks exactly that one thing.
                        //
                        // [ADR-0029 D9.8] …and the KIND is chosen, not
                        // defaulted. Registering every row as `'own'` is what
                        // made this seam replay a destruction of the packaged
                        // definition on EVERY boot, silently and with a clean
                        // `{loaded:1,errors:0,invalid:0}` receipt (#6853 P6).
                        // [D9.9] A row bound to a package that does NOT own the
                        // object throws here on purpose: the per-record catch
                        // below counts it in `errors` with its reason, which is
                        // the boot-side half of the write-path refusal.
                        const layer = this.classifyObjectContribution(
                            String(record.name),
                            (record as { package_id?: string | null }).package_id,
                        );
                        if (layer.kind === 'mismatch') {
                            throw ObjectStackProtocolImplementation.overlayPackageMismatchError(
                                String(record.name), layer.packageId, layer.ownerPackageId,
                            );
                        }
                        this.engine.registry.registerObject(
                            { ...(data as Record<string, unknown>), _provenance: 'org' } as any,
                            layer.packageId,
                            undefined,
                            layer.kind,
                        );
                    } else {
                        // Same rule as the getMetaItems read-side hydration and
                        // the #4521 write-through — the ONE shared
                        // {@link hydrateOverlayIntoRegistry}: graft the
                        // artifact's protection envelope (ADR-0010 §3.3) with
                        // the artifact lookup scoped to the row's OWN package
                        // (ADR-0048 / #1828 / #4624). Pre-fix this branch kept
                        // a third inline copy that looked the artifact up
                        // UNSCOPED, so a name-colliding overlay grafted the
                        // first-registered package's `_lock`/`_packageId`/
                        // `_provenance` onto another package's row at boot.
                        // When artifacts load after this hydration the merge
                        // finds nothing and the row registers unchanged — same
                        // as before, scoped or not.
                        //
                        // [#6602] The org argument states what the WHERE
                        // clause above already selected for. It is a no-op
                        // today by construction — and that is the point: the
                        // rule this branch's comment states ("hydrate only
                        // env-wide rows") stops depending on a query filter
                        // staying correct, because the hydrator refuses an
                        // org-scoped row whatever selected it.
                        this.hydrateOverlayIntoRegistry(
                            normalizedType,
                            data,
                            {
                                packageId: (record as { package_id?: string | null }).package_id ?? undefined,
                                organizationId: (record as { organization_id?: string | null }).organization_id ?? null,
                            },
                        );
                    }
                    loaded++;
                } catch (e) {
                    errors++;
                    console.warn(`[Protocol] Failed to hydrate ${record.type}/${record.name}: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
            // #6190 — say out loud which org-scoped rows this filter just
            // walked past. See {@link reportUnhydratableOrgScopedRows}.
            await this.reportUnhydratableOrgScopedRows();
        } catch (e: unknown) {
            // #5841 — the ONE benign reason this whole read can fail is
            // `sys_metadata` not being provisioned yet: on a first boot, before
            // migrations execute, there genuinely are no overlay rows, so
            // `loaded: 0` IS the truth and a warning would be noise.
            //
            // Classification is by error TYPE through {@link isMissingTableError}
            // — the same predicate {@link rethrowUnlessMetadataStoreUnprovisioned}
            // asks a few thousand lines up, that `SysMetadataRepository` asks in
            // this package (#4867) and that `DatabaseLoader` asks in
            // `@objectstack/metadata` (#5108). This seam used to run its own
            // `/no such table/i` over `e.message`: a second, hand-copied
            // vocabulary of "which driver errors are benign", wrong in both
            // directions the moment the driver changes. Postgres phrases the very
            // same first boot as `relation "sys_metadata" does not exist` (and
            // sets SQLSTATE 42P01), so the regex mis-read a benign first boot as
            // an anomaly and printed a warning nobody could act on; conversely any
            // driver that says "no such table" for a different failure got read as
            // benign. One driver quirk, taught to the platform once.
            //
            // #5897 (was #5841 fact 2, closed here): every OTHER failure is a
            // read that did not happen, and it now SAYS so in the return value
            // instead of only in a console line. Before this, the shape could
            // not tell "the store had no overlay rows" from "the store could
            // not be read" — ADR-0110 D3's rule, on the boot side — so the one
            // consumer (`ObjectQLPlugin.restoreMetadataFromDb`) reported an
            // outage as `debug` "No persisted metadata found in database" and
            // the kernel went on to report ready.
            //
            // The two lines this branch and that consumer print are one event
            // at two altitudes, not a repetition: this one names the DRIVER
            // error (the detail an operator debugs with), the consumer's
            // `error` names what the outage COSTS and how to fix it. Keeping
            // the technical line here at `warn` is what lets the consumer's
            // line stay the single loud statement of consequence.
            if (!isMissingTableError(e)) {
                storeUnavailable = true;
                console.warn(
                    `[Protocol] DB hydration skipped: ${e instanceof Error ? e.message : String(e)}`,
                );
            }
        }
        return { loaded, errors, invalid, storeUnavailable };
    }

    /**
     * [#6190] Cold boot walks past every `organization_id IS NOT NULL` row.
     * For the types the registry declares per-org overridable that is the
     * design (ADR-0005 revised 2026-05 — those overlays are loaded on demand
     * by `getMetaItem`/`getMetaItems`, which is why the filter above exists).
     * For every OTHER type it is a stored row the platform has no per-org
     * channel for, and until this method the skip was **completely silent**.
     *
     * The measured specimen is `flow`. `flow` is `allowOrgOverride: false`
     * (rolled back in #6283 / PR #6478, matching ADR-0005:57) but
     * `allowRuntimeCreate: true`, so a tenant authoring a BRAND-NEW flow in
     * Studio still writes `sys_metadata.organization_id = '<org>'` — the
     * runtime `PUT /metadata/:type/:name` threads `resolveActiveOrganizationId`
     * into `saveMetaItem`, and `SysMetadataRepository.put` stamps
     * `organization_id: this.organizationId` whatever the type is. That flow
     * binds its triggers for the rest of the process's life (the publish-time
     * write-through puts it in the process-wide registry) and then, on the
     * next restart, this filter drops it and the `kernel:ready` binder —
     * `getMetaItems({ type: 'flow' })`, no `organizationId`, so
     * `orgRecords = []` — never sees it. It stops firing, and nothing said so:
     * the `kernel:bootstrapped` unbound audit cannot report a flow that was
     * never registered.
     *
     * This method does not change what boot loads. It makes the absence
     * LOUD — AGENTS.md's rule, and the half of #6190 that is implementable
     * without a contract ruling. Whether such a row should exist at all
     * (refuse the write / force it env-wide / teach the binder to read per-org)
     * is the maintainer decision recorded on the issue; the operator-visible
     * consequence is the same either way and it is what an operator needs
     * TODAY to explain an automation that stopped after a restart.
     *
     * Shape decisions, all deliberate:
     *
     *  - **Which rows.** Registry-derived, never a hand-written list
     *    (Prime Directive #7): the complement of
     *    {@link OVERLAY_ALLOWED_TYPES}'s source flag. Derived from
     *    `DEFAULT_METADATA_TYPE_REGISTRY` and NOT from
     *    {@link isOverlayAllowed}, because the `OS_METADATA_WRITABLE` escape
     *    hatch only unlocks the WRITE — an env-unlocked type's org rows are
     *    hydrated no more than any other's, so silencing the line on that
     *    flag would hide exactly the deployment most likely to have these rows.
     *  - **[#6992] …plus every LIVE type the registry does not declare at
     *    all.** {@link listLiveMetadataTypes} — the same accessor
     *    {@link getMetaTypes} lists from. A plugin-registered type (`theme`,
     *    `connector`, `webhook`, `sharing_rule`, `analytics_cube`, …) has no
     *    registry entry, so the loop above could not reach it, yet
     *    `loadMetaFromDb`'s filter is type-BLIND and skips its org-scoped rows
     *    exactly like a `flow`'s. That family was the one getting neither the
     *    refusal nor the warning. It has no declaration to consult, and
     *    `getMetaTypes()` synthesises `allowOrgOverride: false` for it, so
     *    "not per-org overridable" is its correct reading here.
     *
     *    ── THE DIVERGENCE FROM THE REFUSAL IS DELIBERATE ──
     *
     *    {@link orgScopedWriteRefusal} keys off the STATIC registry and
     *    returns `null` for exactly this family (its "Statically-declared
     *    types only" bullet); this audit keys off the LIVE set and reports it.
     *    The two sets are meant to differ, and a future reader should not
     *    "fix" one to match the other. The asymmetry is this file's own stated
     *    posture, three bullets up in that method: *warning is free and should
     *    be maximal; refusing removes a capability*. Widening the refusal
     *    would extend the 2026-08-08 ruling — reasoned over the 27 declared
     *    entries — onto a surface nobody measured; widening the warning costs
     *    an operator one more segment on a line that already exists. Same
     *    reasoning by which this method ignores `OS_METADATA_WRITABLE` while
     *    the refusal honours it. Ruled on #6992, scoped to the diagnostic.
     *
     *    Measured, not assumed (#6992): at the instant this method runs — in
     *    `ObjectQLPlugin.start()` Phase 2, after every plugin's `init` — a
     *    real `app-showcase` boot has 7 live types with no registry entry
     *    (`analytics_cube`, `connector`, `data`, `package`, `sharing_rule`,
     *    `theme`, `webhook`), all of them from the SchemaRegistry. The
     *    widening is therefore live and not defeated by boot order.
     *  - **Two predicates, both narrowing.** `organization_id IS NOT NULL`
     *    plus the type list keeps the query empty-by-default: a healthy
     *    deployment reads nothing and prints nothing. A driver that drops
     *    either predicate degrades to reading more rows, never to a false
     *    line — the JS filter re-checks both.
     *  - **One aggregated line.** Counts per type plus a capped sample of
     *    names, so a tenant with a thousand such rows costs one line rather
     *    than a thousand.
     *  - **Best-effort, and non-fatal by construction.** A diagnostic must
     *    never be the reason a boot fails, so its own catch swallows: the
     *    caller's outer catch classifies REAL hydration outages
     *    (`storeUnavailable`, #5897) and this must not be able to reach it.
     */
    private async reportUnhydratableOrgScopedRows(): Promise<void> {
        /** Names printed per type before the line collapses to a count. */
        const SAMPLE_PER_TYPE = 5;
        try {
            const orgOverridable = new Set<string>();
            /** Types `DEFAULT_METADATA_TYPE_REGISTRY` declares, whatever their flags. */
            const declaredTypes = new Set<string>();
            /** [#6992] Live types with NO registry entry — reported, never refused. */
            const undeclaredTypes = new Set<string>();
            const scannedTypes: string[] = [];
            const scan = (singular: string): void => {
                scannedTypes.push(singular);
                // Both spellings: `sys_metadata.type` may hold the legacy
                // plural, exactly as the hydration loop above assumes.
                const plural = SINGULAR_TO_PLURAL[singular];
                if (plural) scannedTypes.push(plural);
            };
            for (const entry of DEFAULT_METADATA_TYPE_REGISTRY) {
                declaredTypes.add(entry.type);
                if (entry.allowOrgOverride) {
                    orgOverridable.add(entry.type);
                    continue;
                }
                scan(entry.type);
            }
            // [#6992] Widen to the live registry — see the TSDoc's "…plus every
            // LIVE type the registry does not declare at all" bullet. Best
            // effort like the rest of this method: a kernel whose accessors
            // throw degrades to the declared scan it had before, never to a
            // failed boot.
            let liveTypes: string[] = [];
            try {
                liveTypes = await this.listLiveMetadataTypes();
            } catch {
                liveTypes = [];
            }
            for (const liveType of liveTypes) {
                const singular = PLURAL_TO_SINGULAR[liveType] ?? liveType;
                if (declaredTypes.has(singular) || undeclaredTypes.has(singular)) continue;
                undeclaredTypes.add(singular);
                scan(singular);
            }
            if (scannedTypes.length === 0) return;

            const rows = await this.engine.find('sys_metadata', {
                where: {
                    state: 'active',
                    organization_id: { $null: false },
                    type: { $in: scannedTypes },
                },
            });
            if (!rows || rows.length === 0) return;

            // Re-check both predicates in JS: a driver that cannot lower one
            // of them hands back a superset, and a superset must not become a
            // false accusation.
            const counts = new Map<string, number>();
            const samples = new Map<string, string[]>();
            const scannedSingulars = new Set<string>(
                scannedTypes.map((t) => PLURAL_TO_SINGULAR[t] ?? t),
            );
            let total = 0;
            for (const row of rows) {
                const org = (row as { organization_id?: string | null }).organization_id;
                if (org === null || org === undefined || org === '') continue;
                const singular = PLURAL_TO_SINGULAR[String(row.type)] ?? String(row.type);
                if (orgOverridable.has(singular)) continue;
                // [#6992] Re-check the TYPE predicate too, which is what the
                // TSDoc above has always promised ("the JS filter re-checks
                // both"). Before the live widening, `orgOverridable` was that
                // re-check: within the declared registry, "not org-overridable"
                // and "in the scanned list" were the same statement. They are
                // not any more — a row of a type that is neither declared NOR
                // live (a plugin uninstalled since the row was written) is
                // absent from the list, so only this line keeps a driver that
                // cannot lower `$in` from turning a superset into a line about
                // a type this kernel never scanned.
                if (!scannedSingulars.has(singular)) continue;
                total++;
                counts.set(singular, (counts.get(singular) ?? 0) + 1);
                const names = samples.get(singular) ?? [];
                if (names.length < SAMPLE_PER_TYPE) names.push(`${String(row.name)}@${String(org)}`);
                samples.set(singular, names);
            }
            if (total === 0) return;

            let reportedUndeclared = false;
            const detail = Array.from(counts.entries())
                .map(([type, count]) => {
                    const names = samples.get(type) ?? [];
                    const more = count > names.length ? `, +${count - names.length} more` : '';
                    // [#6992] Mark the plugin-registered family. Not decoration:
                    // the operator's next step differs between the two: a
                    // DECLARED type's org-scoped write is refused from now on
                    // (#6190), so the listed rows are historical residue and
                    // cannot grow; an UNDECLARED type's write is not refused,
                    // so the same names come back after every restart until the
                    // author stops writing them org-scoped.
                    const mark = undeclaredTypes.has(type) ? ' [plugin-registered]' : '';
                    if (mark) reportedUndeclared = true;
                    return `${type}×${count}${mark} (${names.join(', ')}${more})`;
                })
                .join('; ');
            console.warn(
                `[Protocol] [metadata_org_scoped_unhydrated] ${total} active sys_metadata row(s) are ` +
                `org-scoped on types with NO per-org channel (the registry declares allowOrgOverride=false, ` +
                `or does not declare the type at all), so boot hydration skipped them and they are absent ` +
                `from the process-wide registry: ${detail}. ` +
                `A 'flow' listed here will NOT bind its triggers in this process (the kernel:ready binder ` +
                `reads flows env-wide) — it fired until the last restart and stops now. ` +
                (reportedUndeclared
                    ? `Types marked [plugin-registered] have no metadata-type registry entry, so the #6190 `
                    + `org-scope write refusal does NOT cover them: rows of those types can still be written `
                    + `org-scoped, and will be listed here again after every restart until the author stops. `
                    : '') +
                `Re-save the item env-wide (no active organization), or delete the row. See #6190 / #6992 / ADR-0005.`,
            );
        } catch {
            // Diagnostics never break boot — see the TSDoc. Deliberately not
            // routed to the caller's outer catch: that one classifies real
            // hydration outages, and a failed extra probe is not one.
        }
    }

    // ==========================================
    // Metadata References (Phase 3a-references)
    // ==========================================

    /**
     * Scan all loaded metadata for references pointing at the given
     * `{type, name}` target. Returns one row per referring artifact with
     * the path that produced the hit, so the admin UI can render an
     * "Used by" panel before destructive actions (rename / delete /
     * type-narrowing).
     *
     * Coverage is driven by the hand-curated {@link REFERENCE_PATHS}
     * registry. Types not present in the registry simply return no hits
     * — the engine never throws.
     */
    async findReferencesToMeta(request: {
        type: string;
        name: string;
        organizationId?: string;
    }): Promise<{
        references: Array<{
            type: string;
            name: string;
            label?: string;
            path: string;
            kind: string;
        }>;
    }> {
        const singularTarget = PLURAL_TO_SINGULAR[request.type] ?? request.type;
        const targetName = request.name;
        const matchers = REFERENCE_PATHS[singularTarget];
        if (!matchers || matchers.length === 0) {
            return { references: [] };
        }

        const seen = new Set<string>(); // dedup key: `${fromType}|${itemName}|${path}`
        const out: Array<{ type: string; name: string; label?: string; path: string; kind: string }> = [];

        // Walk distinct source types in parallel.
        await Promise.all(
            matchers.map(async (matcher) => {
                let items: unknown[] = [];
                try {
                    const result = await this.getMetaItems({
                        type: matcher.fromType,
                        ...(request.organizationId ? { organizationId: request.organizationId } : {}),
                    });
                    items = (result?.items ?? []) as unknown[];
                } catch {
                    return;
                }
                for (const raw of items) {
                    if (!raw || typeof raw !== 'object') continue;
                    const sourceName = (raw as any).name as string | undefined;
                    if (!sourceName) continue;
                    // Don't list an item as a reference to itself unless the
                    // self-reference is meaningful (e.g. object→field path).
                    const isSelfReference = matcher.fromType === singularTarget && sourceName === targetName;
                    for (const path of matcher.paths) {
                        const values = extractPathValues(raw, path);
                        if (!values.includes(targetName)) continue;
                        if (isSelfReference && !path.includes('[]') && !path.includes('{}')) continue;
                        const key = `${matcher.fromType}|${sourceName}|${path}`;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        const label = (raw as any).label as string | undefined;
                        out.push({
                            type: matcher.fromType,
                            name: sourceName,
                            ...(label ? { label } : {}),
                            path,
                            kind: matcher.kind,
                        });
                    }
                }
            }),
        );

        // Stable sort: by type, then by name.
        out.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

        return { references: out };
    }

    /**
     * Install a package from a manifest — the single canonical write primitive
     * for the package subsystem (ADR-0033 consolidation).
     *
     * It writes BOTH stores that the runtime keeps for packages, so a package
     * surfaces consistently no matter which read path is used:
     *   1. the in-memory `SchemaRegistry` (what the dispatcher's
     *      `/api/v1/packages` list/detail and `getMetaItems({type:'package'})`
     *      read — i.e. what Studio's package selector shows), and
     *   2. the durable `sys_packages` table via the optional `package` service
     *      (so the package survives a restart; that service re-hydrates these
     *      rows back into the registry on boot).
     *
     * The DB write is best-effort and non-fatal: when the `package` service is
     * absent (e.g. the `marketplace` capability is off) the package is still
     * registered in-memory and visible for the lifetime of the process.
     */
    async installPackage(request: InstallPackageRequest): Promise<InstallPackageResponse> {
        // #2532 — runtime-created base packages routinely arrive versionless
        // ({id, name} from the builder / Setup). `sys_packages.version` is NOT
        // NULL, and the old guard here (`pkgSvc?.publish && manifest.version`)
        // silently SKIPPED persistence for exactly those packages — so they
        // lived only in the in-memory registry and vanished on restart, while
        // their metadata (objects, tables) survived. Default the version
        // instead of skipping: the registry and the durable row must agree.
        const manifest: any = { ...(request.manifest as any) };
        if (typeof manifest.version !== 'string' || !manifest.version) {
            manifest.version = '0.1.0';
        }

        // Studio-authored writable packages arrive WITHOUT a namespace. The
        // protocol mandates a package namespace whose prefix every object name
        // must carry (manifest.zod `namespace`); `defineStack` enforces it at
        // compile time, but runtime-created packages never take that path — so
        // the rule was silently inert for them. Derive a default namespace from
        // the package id (`com.example.leave` → `leave`) so the prefix can be
        // enforced at publish. An explicitly declared namespace always wins.
        // Set it on the single `manifest` object shared by the in-memory
        // registry and the durable `sys_packages` row below, so both agree.
        if (typeof manifest.namespace !== 'string' || !manifest.namespace) {
            const derived = deriveNamespaceFromPackageId(manifest.id);
            if (derived) manifest.namespace = derived;
        }

        // ADR-0087 D1 — protocol handshake. Refuse a package whose declared
        // `engines.protocol` range excludes this runtime's major BEFORE writing
        // it to the registry, with a structured diagnostic naming the migrate
        // command — instead of letting the mismatch surface later as a deep
        // schema/renderer crash. Packages with no range are grandfathered (warn
        // only); an unparsed range never causes a false rejection.
        assertProtocolCompat(manifest);

        const pkg = this.engine.registry.installPackage(manifest as any, request.settings);

        // Best-effort durable persistence to `sys_packages` (non-fatal by
        // design — without the `package` service the install stays visible
        // for the process lifetime) — but never SILENT: a skipped persist is
        // a restart-loss, so it must at least leave a trace.
        try {
            const services = this.getServicesRegistry?.();
            const pkgSvc = services?.get('package') as
                | { publish?: (data: { manifest: unknown; metadata: unknown }) => Promise<{ success?: boolean; error?: string } | unknown> }
                | undefined;
            if (pkgSvc?.publish) {
                const out = (await pkgSvc.publish({ manifest, metadata: {} })) as
                    | { success?: boolean; error?: string }
                    | undefined;
                if (out && out.success === false) {
                    console.warn(
                        `[protocol.installPackage] sys_packages persist FAILED for '${manifest?.id}': ${out.error ?? 'unknown error'} — package will not survive a restart`,
                    );
                }
            } else {
                console.warn(
                    `[protocol.installPackage] no 'package' service — '${manifest?.id}' registered in-memory only (will not survive a restart)`,
                );
            }
        } catch (e) {
            // Non-fatal: registry write already succeeded; log and continue.
            console.warn(
                `[protocol.installPackage] sys_packages persist skipped for '${manifest?.id}': ${(e as Error)?.message}`,
            );
        }

        return { package: pkg as any, message: `Installed package: ${manifest?.id}` };
    }

    /**
     * Edit an installed package's manifest (name / description / version) — the
     * durable half of `PATCH /packages/:id`. Merges the patch into the registry
     * (preserving lifecycle state — see {@link SchemaRegistry.updatePackageManifest})
     * then re-persists the merged manifest to `sys_packages` via the `package`
     * service so the edit survives a restart. Persistence is best-effort and
     * non-fatal (matching `installPackage`): the registry write already
     * succeeded, so a persist failure is logged, never thrown.
     */
    async updatePackage(request: {
        packageId: string;
        patch: { name?: string; description?: string; version?: string };
    }): Promise<{ package: any; message: string }> {
        const pkg = this.engine.registry.updatePackageManifest(request.packageId, request.patch);
        if (!pkg) {
            throw Object.assign(new Error(`Package '${request.packageId}' not found`), { statusCode: 404 });
        }
        try {
            const services = this.getServicesRegistry?.();
            const pkgSvc = services?.get('package') as
                | { publish?: (data: { manifest: unknown; metadata: unknown }) => Promise<{ success?: boolean; error?: string } | unknown> }
                | undefined;
            if (pkgSvc?.publish) {
                const out = (await pkgSvc.publish({ manifest: (pkg as any).manifest, metadata: {} })) as
                    | { success?: boolean; error?: string }
                    | undefined;
                if (out && out.success === false) {
                    console.warn(
                        `[protocol.updatePackage] sys_packages persist FAILED for '${request.packageId}': ${out.error ?? 'unknown error'} — the edit will not survive a restart`,
                    );
                }
            } else {
                console.warn(
                    `[protocol.updatePackage] no 'package' service — '${request.packageId}' edited in-memory only (will not survive a restart)`,
                );
            }
        } catch (e) {
            console.warn(
                `[protocol.updatePackage] sys_packages persist skipped for '${request.packageId}': ${(e as Error)?.message}`,
            );
        }
        return { package: pkg as any, message: `Updated package: ${request.packageId}` };
    }
}
