// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectStackProtocol } from '@objectstack/spec/api';
import { IDataEngine } from '@objectstack/core';
import { readEnvWithDeprecation } from '@objectstack/types';
import type { ObjectQL } from './engine.js';
import { SysMetadataRepository, type SysMetadataEngine } from './sys-metadata-repository.js';
import { ConflictError } from '@objectstack/metadata-core';
import type {
    BatchUpdateRequest,
    BatchUpdateResponse,
    UpdateManyDataRequest,
    DeleteManyDataRequest,
    InstallPackageRequest,
    InstallPackageResponse
} from '@objectstack/spec/api';
import type { MetadataCacheRequest, MetadataCacheResponse, ServiceInfo, ApiRoutes, WellKnownCapabilities } from '@objectstack/spec/api';
import type { IFeedService } from '@objectstack/spec/contracts';
import { parseFilterAST, isFilterAST } from '@objectstack/spec/data';
import { PLURAL_TO_SINGULAR, SINGULAR_TO_PLURAL } from '@objectstack/spec/shared';
import { type FormView, isAggregatedViewContainer } from '@objectstack/spec/ui';
import { METADATA_FORM_REGISTRY } from '@objectstack/spec/system';
import { DEFAULT_METADATA_TYPE_REGISTRY, getMetadataTypeSchema, getMetadataTypeActions } from '@objectstack/spec/kernel';
import {
    extractProtection,
    evaluateLockForWrite,
    evaluateLockForDelete,
    resolveLockState,
    type MetadataLock,
    type MetadataProvenance,
} from '@objectstack/spec/kernel';
import { z } from 'zod';
import {
    computeMetadataDiagnostics,
    decorateMetadataItem,
    decorateMetadataItems,
    type MetadataDiagnostics,
} from './metadata-diagnostics.js';

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
            tags: { type: 'array', items: { type: 'string' } },
            active: { type: 'boolean', default: true },
            isSystem: { type: 'boolean', default: false },
            abstract: { type: 'boolean', default: false },
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
            shortcut: { type: 'string' },
            bulkEnabled: { type: 'boolean', default: false },
            aiExposed: { type: 'boolean', default: false },
            recordIdParam: { type: 'string' },
            recordIdField: { type: 'string' },
            bodyShape: { type: 'string', enum: ['flat', 'nested'] },
        },
        required: ['name', 'label', 'type'],
        additionalProperties: true,
    },
    // Validation rules live inside `object.validations[]`. The canonical
    // ValidationRuleSchema is a discriminated union of 9 variants; the
    // generic SchemaForm renderer treats unions as opaque JSON, so we
    // ship a *flat* form-friendly schema covering the common base
    // properties plus every variant-specific field as optional. Save-time
    // validation is unaffected — the union schema is still authoritative
    // at write time.
    validation: {
        type: 'object',
        properties: {
            // --- Base fields (all variants) ---
            name: { type: 'string', description: 'Unique rule name (snake_case)' },
            label: { type: 'string' },
            description: { type: 'string' },
            type: {
                type: 'string',
                enum: [
                    'script',
                    'unique',
                    'state_machine',
                    'format',
                    'cross_field',
                    'json',
                    'async',
                    'custom',
                    'conditional',
                ],
                default: 'script',
                description: 'Validation variant',
            },
            active: { type: 'boolean', default: true },
            events: {
                type: 'array',
                items: { type: 'string', enum: ['insert', 'update', 'delete'] },
                default: ['insert', 'update'],
            },
            priority: { type: 'number', default: 100, minimum: 0, maximum: 9999 },
            severity: {
                type: 'string',
                enum: ['error', 'warning', 'info'],
                default: 'error',
            },
            message: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            // --- Variant-specific (all optional, gated by `type`) ---
            condition: {
                type: 'string',
                description: 'CEL predicate (type=script). True ⇒ validation fails.',
            },
            fields: {
                type: 'array',
                items: { type: 'string' },
                description: 'Fields (type=unique / cross_field).',
            },
            scope: { type: 'string', description: 'CEL scope predicate (type=unique).' },
            caseSensitive: { type: 'boolean', default: true },
            field: { type: 'string', description: 'Single field (type=state_machine / format).' },
            transitions: {
                type: 'object',
                additionalProperties: { type: 'array', items: { type: 'string' } },
                description: 'Map { OldState: [AllowedNewStates] } (type=state_machine).',
            },
            regex: { type: 'string', description: 'Regex (type=format).' },
            format: {
                type: 'string',
                enum: ['email', 'url', 'phone', 'json'],
                description: 'Built-in format (type=format).',
            },
            url: { type: 'string', description: 'Endpoint URL (type=async).' },
            handler: { type: 'string', description: 'Handler reference (type=custom).' },
            when: { type: 'string', description: 'Outer condition (type=conditional).' },
        },
        required: ['name', 'type', 'message'],
        additionalProperties: true,
    },
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
 *   - Types without a registered schema (the wiring-layer types
 *     `function`/`service`/`router`, and any plugin types that have not
 *     yet called `registerMetadataTypeSchema()`) fall through unvalidated.
 */
function resolveOverlaySchema(type: string, _item: unknown): z.ZodTypeAny | null {
    const singular = PLURAL_TO_SINGULAR[type] ?? type;
    return getMetadataTypeSchema(singular) ?? null;
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

/**
 * Service Configuration for Discovery
 * Maps service names to their routes and plugin providers
 */
const SERVICE_CONFIG: Record<string, { route: string; plugin: string }> = {
    auth:         { route: '/api/v1/auth', plugin: 'plugin-auth' },
    automation:   { route: '/api/v1/automation', plugin: 'plugin-automation' },
    cache:        { route: '/api/v1/cache', plugin: 'plugin-redis' },
    queue:        { route: '/api/v1/queue', plugin: 'plugin-bullmq' },
    job:          { route: '/api/v1/jobs', plugin: 'job-scheduler' },
    ui:           { route: '/api/v1/ui', plugin: 'ui-plugin' },
    workflow:     { route: '/api/v1/workflow', plugin: 'plugin-workflow' },
    realtime:     { route: '/api/v1/realtime', plugin: 'plugin-realtime' },
    notification: { route: '/api/v1/notifications', plugin: 'plugin-notifications' },
    ai:           { route: '/api/v1/ai', plugin: 'plugin-ai' },
    i18n:         { route: '/api/v1/i18n', plugin: 'service-i18n' },
    graphql:      { route: '/graphql', plugin: 'plugin-graphql' },  // GraphQL uses /graphql by convention (not versioned REST)
    'file-storage': { route: '/api/v1/storage', plugin: 'plugin-storage' },
    search:       { route: '/api/v1/search', plugin: 'plugin-search' },
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
        { fromType: 'workflow', paths: ['object', 'targetObject'], kind: 'workflow' },
        { fromType: 'permission', paths: ['objects[].name', 'objects[].object'], kind: 'permission' },
        { fromType: 'app', paths: ['navItems[].objectName', 'navItems[].object', 'tabs[].objectName', 'tabs[].object'], kind: 'app nav' },
        { fromType: 'page', paths: ['object', 'objectName'], kind: 'page' },
        { fromType: 'report', paths: ['object', 'objectName'], kind: 'report' },
        { fromType: 'action', paths: ['object', 'objectName'], kind: 'action' },
        { fromType: 'validation', paths: ['object', 'objectName'], kind: 'validation' },
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

export class ObjectStackProtocolImplementation implements ObjectStackProtocol {
    private engine: ObjectQL;
    private getServicesRegistry?: () => Map<string, any>;
    private getFeedService?: () => IFeedService | undefined;
    /**
     * Project scope applied to sys_metadata reads/writes. When undefined
     * (single-kernel deployments), rows land in / come from the
     * platform-global bucket (`environment_id IS NULL`). When set, every
     * saveMetaItem insert/update and loadMetaFromDb query is filtered by
     * `environment_id = environmentId`, so per-project kernels see only their own
     * metadata even if several projects share the same physical database.
     */
    private environmentId?: string;

    /**
     * Lazily-instantiated SysMetadataRepository per organization. Keyed by
     * `${organizationId ?? '__env__'}`. Repositories are stateful — they
     * carry the per-org `seqCounter` and watch subscribers — so we cache
     * them rather than constructing one per call.
     */
    private overlayRepos = new Map<string, SysMetadataRepository>();

    constructor(
        engine: IDataEngine,
        getServicesRegistry?: () => Map<string, any>,
        getFeedService?: () => IFeedService | undefined,
        environmentId?: string,
    ) {
        this.engine = engine as ObjectQL;
        this.getServicesRegistry = getServicesRegistry;
        this.getFeedService = getFeedService;
        this.environmentId = environmentId;
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
     * One-time guard for ensuring the overlay-uniqueness UNIQUE INDEX exists
     * on `sys_metadata`. ADR-0005: scopes overlays by
     * `(type, name, organization_id, environment_id, scope)` for active rows only.
     * Idempotent SQL — safe to attempt on every protocol instance.
     *
     * Inlined here (rather than importing from @objectstack/metadata/migrations)
     * to avoid a circular dependency: metadata already depends on objectql.
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
            // ADR-0005 (revised 2026-05): per-env DBs replace the old
            // "per-project" isolation, so `environment_id` is no longer a
            // discriminator. Overlay uniqueness is `(type, name,
            // organization_id)` filtered to active rows. Drop the legacy
            // composite index first so the new partial UNIQUE can claim
            // the same name — DROP INDEX IF EXISTS is idempotent.
            try { await exec("DROP INDEX IF EXISTS idx_sys_metadata_overlay_active"); } catch { /* best-effort */ }
            const partialSql =
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_sys_metadata_overlay_active " +
                "ON sys_metadata (type, name, organization_id) " +
                "WHERE state = 'active'";
            const fallbackSql =
                "CREATE INDEX IF NOT EXISTS idx_sys_metadata_overlay_active " +
                "ON sys_metadata (type, name, organization_id)";
            try {
                await exec(partialSql);
            } catch (err: any) {
                const msg = err instanceof Error ? err.message : String(err);
                if (/partial|where clause|syntax/i.test(msg)) {
                    try {
                        await exec(fallbackSql);
                    } catch {
                        // ignore — non-essential optimization
                    }
                }
                // "already exists" or anything else: best-effort
            }
            // Mirror the same partial-UNIQUE for draft rows so a second
            // simultaneous draft cannot be inserted for the same
            // (type,name,org). The unique-active index above already
            // guards published rows; the two never collide because the
            // `state` predicate disambiguates them.
            const draftPartialSql =
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_sys_metadata_overlay_draft " +
                "ON sys_metadata (type, name, organization_id) " +
                "WHERE state = 'draft'";
            try {
                await exec(draftPartialSql);
            } catch (err: any) {
                const msg = err instanceof Error ? err.message : String(err);
                if (/partial|where clause|syntax/i.test(msg)) {
                    try {
                        await exec(
                            "CREATE INDEX IF NOT EXISTS idx_sys_metadata_overlay_draft " +
                            "ON sys_metadata (type, name, organization_id)",
                        );
                    } catch {
                        // ignore — best effort
                    }
                }
            }
        } catch {
            // ignore — index is an optimization, not a correctness invariant
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

    private requireFeedService(): IFeedService {
        const svc = this.getFeedService?.();
        if (!svc) {
            throw new Error('Feed service not available. Install and register service-feed to enable feed operations.');
        }
        return svc;
    }

    async getDiscovery() {
        // Get registered services from kernel if available
        const registeredServices = this.getServicesRegistry ? this.getServicesRegistry() : new Map();
        
        // Build dynamic service info with proper typing
        const services: Record<string, ServiceInfo> = {
            // --- Kernel-provided (objectql is an example kernel implementation) ---
            metadata:  { enabled: true, status: 'available' as const, route: '/api/v1/meta', provider: 'objectql' },
            data:      { enabled: true, status: 'available' as const, route: '/api/v1/data', provider: 'objectql' },
            analytics: { enabled: true, status: 'available' as const, route: '/api/v1/analytics', provider: 'objectql' },
        };

        // Check which services are actually registered
        for (const [serviceName, config] of Object.entries(SERVICE_CONFIG)) {
            if (registeredServices.has(serviceName)) {
                // Service is registered and available
                services[serviceName] = {
                    enabled: true,
                    status: 'available' as const,
                    route: config.route,
                    provider: config.plugin,
                };
            } else {
                // Service is not registered
                services[serviceName] = {
                    enabled: false,
                    status: 'unavailable' as const,
                    message: `Install ${config.plugin} to enable`,
                };
            }
        }

        // Build routes from services — a flat convenience map for client routing
        const serviceToRouteKey: Record<string, keyof ApiRoutes> = {
            auth: 'auth',
            automation: 'automation',
            ui: 'ui',
            workflow: 'workflow',
            realtime: 'realtime',
            notification: 'notifications',
            ai: 'ai',
            i18n: 'i18n',
            graphql: 'graphql',
            'file-storage': 'storage',
        };

        const optionalRoutes: Partial<ApiRoutes> = {
            analytics: '/api/v1/analytics',
        };

        // Add routes for available plugin services
        for (const [serviceName, config] of Object.entries(SERVICE_CONFIG)) {
            if (registeredServices.has(serviceName)) {
                const routeKey = serviceToRouteKey[serviceName];
                if (routeKey) {
                    optionalRoutes[routeKey] = config.route;
                }
            }
        }

        // Add feed service status
        if (registeredServices.has('feed')) {
            services['feed'] = {
                enabled: true,
                status: 'available' as const,
                route: '/api/v1/data',
                provider: 'service-feed',
            };
        } else {
            services['feed'] = {
                enabled: false,
                status: 'unavailable' as const,
                message: 'Install service-feed to enable',
            };
        }

        const routes: ApiRoutes = {
            data: '/api/v1/data',
            metadata: '/api/v1/meta',
            ...optionalRoutes,
        };

        // Build well-known capabilities from registered services.
        // DiscoverySchema defines capabilities as Record<string, { enabled, features?, description? }>
        // (hierarchical format). We also keep a flat WellKnownCapabilities for backward compat.
        const wellKnown: WellKnownCapabilities = {
            feed: registeredServices.has('feed'),
            comments: registeredServices.has('feed'),
            automation: registeredServices.has('automation'),
            cron: registeredServices.has('job'),
            search: registeredServices.has('search'),
            export: registeredServices.has('automation') || registeredServices.has('queue'),
            chunkedUpload: registeredServices.has('file-storage'),
        };

        // Convert flat booleans → hierarchical capability objects
        const capabilities: Record<string, { enabled: boolean; description?: string }> = {};
        for (const [key, enabled] of Object.entries(wellKnown)) {
            capabilities[key] = { enabled };
        }

        return {
            version: '1.0',
            apiName: 'ObjectStack API',
            routes,
            services,
            capabilities,
        };
    }

    async getMetaTypes() {
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

        const allTypes = Array.from(new Set([...schemaTypes, ...runtimeTypes]));

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

    async getMetaItems(request: { type: string; packageId?: string; organizationId?: string }) {
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
            // org-specific rows override env-wide rows on name collision
            const mergedMap = new Map<string, any>();
            for (const r of envWideRecords) mergedMap.set(r.name, r);
            for (const r of orgRecords) mergedMap.set(r.name, r);
            const records = Array.from(mergedMap.values());
            if (records && records.length > 0) {
                const byName = new Map<string, any>();
                for (const existing of items) {
                    const entry = existing as any;
                    if (entry && typeof entry === 'object' && 'name' in entry) {
                        byName.set(entry.name, entry);
                    }
                }
                for (const record of records) {
                    const data = typeof record.metadata === 'string'
                        ? JSON.parse(record.metadata)
                        : record.metadata;
                    if (data && typeof data === 'object' && 'name' in data) {
                        // Surface the persisted software-package binding so the
                        // sidebar package filter and provenance classification
                        // see overlay rows the same way they see registry items.
                        const recPkg = (record as { package_id?: string | null }).package_id ?? undefined;
                        if (recPkg && (data as any)._packageId === undefined) {
                            (data as any)._packageId = recPkg;
                        }
                        byName.set(data.name, data);
                    }
                    // Only hydrate the global registry for unscoped calls —
                    // scoped project entries must not leak process-wide.
                    if (this.environmentId === undefined) {
                        this.engine.registry.registerItem(request.type, data, 'name' as any);
                    }
                }
                items = Array.from(byName.values());
            }
        } catch {
            // DB not available — fall through with whatever we already have.
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
                    // Merge, avoiding duplicates by name
                    const itemMap = new Map<string, any>();
                    for (const item of items) {
                        const entry = item as any;
                        if (entry && typeof entry === 'object' && 'name' in entry) {
                            itemMap.set(entry.name, entry);
                        }
                    }
                    for (const item of runtimeItems) {
                        const entry = item as any;
                        if (entry && typeof entry === 'object' && 'name' in entry) {
                            // Do not overwrite entries already present in the
                            // map: those came from sys_metadata (customization
                            // overlays) or the SchemaRegistry and must win
                            // over the MetadataService's artifact baseline.
                            // Without this guard, saved per-org dashboard /
                            // view overlays disappear from list endpoints on
                            // refresh (detail endpoint kept showing the
                            // overlay because it uses a different code path).
                            if (!itemMap.has(entry.name)) {
                                itemMap.set(entry.name, entry);
                            }
                        }
                    }
                    items = Array.from(itemMap.values());
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
        // Never filter `package` (the Packages page must list disabled packages
        // to re-enable them) nor `object`/`objects` (filtering objects would
        // break data queries that depend on their schema).
        if (
            request.type !== 'package' &&
            request.type !== 'object' &&
            request.type !== 'objects'
        ) {
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
                    const a = this.lookupArtifactItem(
                        request.type,
                        (it as any)?.name,
                    );
                    return mergeArtifactProtection(it, a) as any;
                }),
            ),
        };
    }

    async getMetaItem(request: { type: string, name: string, packageId?: string, organizationId?: string, state?: 'active' | 'draft' }) {
        let item: unknown;
        const orgId = request.organizationId;
        // Studio's editor opens a draft buffer with `state: 'draft'`;
        // runtime loaders omit it and get the live published row.
        const readState: 'active' | 'draft' = request.state === 'draft' ? 'draft' : 'active';

        // 1. Customization overlay lookup (sys_metadata).
        //    Per ADR-0005 (revised), org-scoped row wins; env-wide
        //    (organization_id IS NULL) row is the fallback before falling
        //    through to the in-memory registry / MetadataService.
        try {
            const findOverlay = async (oid: string | null): Promise<any | undefined> => {
                const where: Record<string, unknown> = {
                    type: request.type,
                    name: request.name,
                    state: readState,
                    organization_id: oid,
                };
                const rec = await this.engine.findOne('sys_metadata', { where });
                if (rec) return rec;
                const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
                if (alt) {
                    const altWhere: Record<string, unknown> = {
                        type: alt,
                        name: request.name,
                        state: readState,
                        organization_id: oid,
                    };
                    return await this.engine.findOne('sys_metadata', { where: altWhere });
                }
                return undefined;
            };
            const record = (orgId ? await findOverlay(orgId) : undefined)
                ?? await findOverlay(null);
            if (record) {
                item = typeof record.metadata === 'string'
                    ? JSON.parse(record.metadata)
                    : record.metadata;
                // Surface the persisted software-package binding (parity with
                // the list path in getMetaItems) so provenance/UI can read it.
                const recPkg = (record as { package_id?: string | null }).package_id ?? undefined;
                if (recPkg && item && typeof item === 'object' && (item as any)._packageId === undefined) {
                    (item as any)._packageId = recPkg;
                }
            }
        } catch {
            // DB not available — fall through to registry / MetadataService
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
                err.code = 'no_draft';
                err.status = 404;
                throw err;
            }
            return { type: request.type, name: request.name, item: decorateMetadataItem(request.type, item) };
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
        if (item === undefined) {
            try {
                const services = this.getServicesRegistry?.();
                const metadataService = services?.get('metadata');
                if (metadataService && typeof metadataService.get === 'function') {
                    const fromService = await metadataService.get(request.type, request.name);
                    if (fromService !== undefined && fromService !== null) {
                        item = fromService;
                    } else {
                        const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
                        if (alt) {
                            const altFromService = await metadataService.get(alt, request.name);
                            if (altFromService !== undefined && altFromService !== null) {
                                item = altFromService;
                            }
                        }
                    }
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
            item = this.engine.registry.getItem(request.type, request.name);
            if (item === undefined) {
                const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
                if (alt) item = this.engine.registry.getItem(alt, request.name);
            }
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
        const artifactItem = this.lookupArtifactItem(request.type, request.name);
        const decorated = decorateMetadataItem(
            request.type,
            mergeArtifactProtection(item, artifactItem),
        );
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

        // ── code layer: MetadataService.get + registry, BYPASSING overlay ──
        let code: unknown | null = null;
        try {
            const services = this.getServicesRegistry?.();
            const metadataService = services?.get('metadata');
            if (metadataService && typeof metadataService.get === 'function') {
                let fromService = await metadataService.get(request.type, request.name);
                if (fromService === undefined || fromService === null) {
                    const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
                    if (alt) fromService = await metadataService.get(alt, request.name);
                }
                if (fromService !== undefined && fromService !== null) code = fromService;
            }
        } catch {
            // ignore
        }
        if (code === null) {
            let regItem = this.engine.registry.getItem(request.type, request.name);
            if (regItem === undefined) {
                const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
                if (alt) regItem = this.engine.registry.getItem(alt, request.name);
            }
            if (regItem !== undefined) code = regItem;
        }

        // ── overlay layer: sys_metadata row (org-scoped wins, then env-wide) ──
        let overlay: unknown | null = null;
        let overlayScope: 'org' | 'env' | null = null;
        try {
            const findOverlay = async (oid: string | null) => {
                const where: Record<string, unknown> = {
                    type: request.type,
                    name: request.name,
                    state: 'active',
                    organization_id: oid,
                };
                let rec = await this.engine.findOne('sys_metadata', { where });
                if (!rec) {
                    const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
                    if (alt) {
                        rec = await this.engine.findOne('sys_metadata', {
                            where: { ...where, type: alt },
                        });
                    }
                }
                return rec;
            };
            if (orgId) {
                const rec = await findOverlay(orgId);
                if (rec) {
                    overlay = typeof rec.metadata === 'string' ? JSON.parse(rec.metadata) : rec.metadata;
                    overlayScope = 'org';
                }
            }
            if (overlay === null) {
                const rec = await findOverlay(null);
                if (rec) {
                    overlay = typeof rec.metadata === 'string' ? JSON.parse(rec.metadata) : rec.metadata;
                    overlayScope = 'env';
                }
            }
        } catch {
            // DB unavailable — overlay stays null
        }

        const effective: unknown | null = overlay ?? code;

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
            const rows = await this.engine.find('sys_metadata_audit', {
                where,
                orderBy: [{ field: 'occurred_at', direction: 'desc' }],
                limit,
            } as any);
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
                list: {
                    type: 'grid' as const,
                    object: request.object,
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
                    colSpan: (fields[f]?.type === 'textarea' || fields[f]?.type === 'html') ? 2 : 1
                }));

             return {
                form: {
                    type: 'simple' as const,
                    object: request.object,
                    label: `Edit ${schema.label || schema.name}`,
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

    async findData(request: { object: string, query?: any, context?: any }) {
        const options: any = { ...request.query };
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
        for (const [dollar, bare] of [
            ['$top', 'top'],
            ['$skip', 'skip'],
            ['$orderby', 'orderBy'],
            ['$select', 'select'],
            ['$count', 'count'],
        ] as const) {
            if (options[dollar] != null && options[bare] == null) {
                options[bare] = options[dollar];
            }
            delete options[dollar];
        }

        // Numeric fields — normalize top → limit, skip → offset
        if (options.top != null) {
            options.limit = Number(options.top);
            delete options.top;
        }
        if (options.skip != null) {
            options.offset = Number(options.skip);
            delete options.skip;
        }
        if (options.limit != null) options.limit = Number(options.limit);
        if (options.offset != null) options.offset = Number(options.offset);

        // Select → fields: comma-separated string → array
        if (typeof options.select === 'string') {
            options.fields = options.select.split(',').map((s: string) => s.trim()).filter(Boolean);
        } else if (Array.isArray(options.select)) {
            options.fields = options.select;
        }
        if (options.select !== undefined) delete options.select;

        // Sort/orderBy → orderBy: string → SortNode[] array
        const sortValue = options.orderBy ?? options.sort;
        if (typeof sortValue === 'string') {
            const parsed = sortValue.split(',').map((part: string) => {
                const trimmed = part.trim();
                if (trimmed.startsWith('-')) {
                    return { field: trimmed.slice(1), order: 'desc' as const };
                }
                const [field, order] = trimmed.split(/\s+/);
                return { field, order: (order?.toLowerCase() === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc' };
            }).filter((s: any) => s.field);
            options.orderBy = parsed;
        } else if (Array.isArray(sortValue)) {
            options.orderBy = sortValue;
        }
        delete options.sort;

        // Filter/filters/$filter → where: normalize all filter aliases
        const filterValue = options.filter ?? options.filters ?? options.$filter ?? options.where;
        delete options.filter;
        delete options.filters;
        delete options.$filter;

        if (filterValue !== undefined) {
            let parsedFilter = filterValue;
            // JSON string → object
            if (typeof parsedFilter === 'string') {
                try { parsedFilter = JSON.parse(parsedFilter); } catch { /* keep as-is */ }
            }
            // Filter AST array → FilterCondition object
            if (isFilterAST(parsedFilter)) {
                parsedFilter = parseFilterAST(parsedFilter);
            }
            options.where = parsedFilter;
        }

        // Populate/expand/$expand → expand (Record<string, QueryAST>)
        const populateValue = options.populate;
        const expandValue = options.$expand ?? options.expand;
        const expandNames: string[] = [];
        if (typeof populateValue === 'string') {
            expandNames.push(...populateValue.split(',').map((s: string) => s.trim()).filter(Boolean));
        } else if (Array.isArray(populateValue)) {
            expandNames.push(...populateValue);
        }
        if (!expandNames.length && expandValue) {
            if (typeof expandValue === 'string') {
                expandNames.push(...expandValue.split(',').map((s: string) => s.trim()).filter(Boolean));
            } else if (Array.isArray(expandValue)) {
                expandNames.push(...expandValue);
            }
        }
        delete options.populate;
        delete options.$expand;
        // Clean up non-object expand (e.g. string) BEFORE the Record conversion
        // below, so that populate-derived names can create the expand Record even
        // when a legacy string expand was also present.
        if (typeof options.expand !== 'object' || options.expand === null) {
            delete options.expand;
        }
        // Only set expand if not already an object (advanced usage)
        if (expandNames.length > 0 && !options.expand) {
            options.expand = {} as Record<string, any>;
            for (const rel of expandNames) {
                options.expand[rel] = { object: rel };
            }
        }

        // Boolean fields
        for (const key of ['distinct', 'count']) {
            if (options[key] === 'true') options[key] = true;
            else if (options[key] === 'false') options[key] = false;
        }
        
        // Flat field filters: REST-style query params like ?id=abc&status=open
        // After extracting all known query parameters, any remaining keys are
        // treated as implicit field-level equality filters merged into `where`.
        const knownParams = new Set([
            'top', 'limit', 'offset',
            'orderBy',
            'fields',
            'where',
            'expand',
            'distinct', 'count',
            'aggregations', 'groupBy',
            'search', 'context', 'cursor',
        ]);
        if (!options.where) {
            const implicitFilters: Record<string, unknown> = {};
            for (const key of Object.keys(options)) {
                if (!knownParams.has(key)) {
                    implicitFilters[key] = options[key];
                    delete options[key];
                }
            }
            if (Object.keys(implicitFilters).length > 0) {
                options.where = implicitFilters;
            }
        }
        
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
                context: options.context,
            } as any);
            // Apply limit client-side (EngineAggregateOptions doesn't carry limit)
            const limited = typeof options.limit === 'number' && options.limit > 0
                ? records.slice(0, options.limit)
                : records;
            return {
                object: request.object,
                records: limited,
                total: limited.length,
                hasMore: false,
            };
        }

        const records = await this.engine.find(request.object, options);
        // Spec: FindDataResponseSchema — only `records` is returned.
        // OData `value` adaptation (if needed) is handled in the HTTP dispatch layer.
        return {
            object: request.object,
            records,
            total: records.length,
            hasMore: false
        };
    }

    async getData(request: { object: string, id: string, expand?: string | string[], select?: string | string[], context?: any }) {
        const queryOptions: any = {
            where: { id: request.id }
        };
        if (request.context !== undefined) {
            queryOptions.context = request.context;
        }

        // Support fields for single-record retrieval
        if (request.select) {
            queryOptions.fields = typeof request.select === 'string'
                ? request.select.split(',').map((s: string) => s.trim()).filter(Boolean)
                : request.select;
        }

        // Support expand for single-record retrieval
        if (request.expand) {
            const expandNames = typeof request.expand === 'string'
                ? request.expand.split(',').map((s: string) => s.trim()).filter(Boolean)
                : request.expand;
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
        const err = new Error(`Record ${request.id} not found in ${request.object}`) as Error & {
            code?: string;
            status?: number;
            object?: string;
        };
        err.code = 'RECORD_NOT_FOUND';
        err.status = 404;
        err.object = request.object;
        throw err;
    }

    async createData(request: { object: string, data: any, context?: any }) {
        const result = await this.engine.insert(
            request.object,
            request.data,
            request.context !== undefined ? { context: request.context } as any : undefined,
        );
        return {
            object: request.object,
            id: result.id,
            record: result
        };
    }

    async updateData(request: { object: string, id: string, data: any, expectedVersion?: string, context?: any }) {
        await this.assertVersionMatch(request.object, request.id, request.expectedVersion, request.context);
        const opts: any = { where: { id: request.id } };
        if (request.context !== undefined) opts.context = request.context;
        const result = await this.engine.update(request.object, request.data, opts);
        return {
            object: request.object,
            id: request.id,
            record: result
        };
    }

    async deleteData(request: { object: string, id: string, expectedVersion?: string, context?: any }) {
        await this.assertVersionMatch(request.object, request.id, request.expectedVersion, request.context);
        const opts: any = { where: { id: request.id } };
        if (request.context !== undefined) opts.context = request.context;
        await this.engine.delete(request.object, opts);
        return {
            object: request.object,
            id: request.id,
            success: true
        };
    }

    /**
     * Optimistic Concurrency Control gate shared by updateData/deleteData.
     *
     * When the caller passes a non-empty `expectedVersion` token (typically
     * the `updated_at` value they read), this fetches the current record
     * and compares its `updated_at` against the token. Mismatch → throw
     * `ConcurrentUpdateError` which the REST layer maps to 409.
     *
     * Behaviour:
     *  - Empty/missing token → no check (opt-in semantics; existing callers
     *    that haven't yet adopted OCC are unaffected).
     *  - Record not found → no check; downstream `engine.update` will
     *    surface the usual `RECORD_NOT_FOUND` 404. We intentionally do not
     *    treat "missing record" as a concurrency conflict.
     *  - Record has no `updated_at` field (timestamps disabled) → no check.
     *    Logging would be noisy here; OCC is opt-in and the absence of a
     *    version column is an explicit "this object doesn't support OCC"
     *    signal.
     */
    private async assertVersionMatch(
        object: string,
        id: string,
        expectedVersion: string | undefined,
        context: any
    ): Promise<void> {
        const expected = normaliseVersionToken(expectedVersion);
        if (!expected) return;
        const findOpts: any = { where: { id } };
        if (context !== undefined) findOpts.context = context;
        const current = await this.engine.findOne(object, findOpts);
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
            // ObjectQL exposes case-insensitive substring matching via `$contains`.
            const andClauses = terms.map(term => ({
                $or: searchableFields.map(f => ({ [f]: { $contains: term } })),
            }));
            const where = andClauses.length === 1 ? andClauses[0] : { $and: andClauses };

            try {
                const opts: any = {
                    where,
                    limit: perObject,
                    orderBy: [{ field: 'updated_at', direction: 'desc' }],
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
    // Lead Convert (M10.6)
    // ==========================================
    /**
     * Convert a qualified Lead into an Account + Contact (+ optional
     * Opportunity) and mark the Lead as converted. Mirrors the Salesforce
     * lead-conversion model:
     *
     *   - If `accountId` is provided, the lead's company info is NOT used
     *     to create a new account; the new contact and opportunity link to
     *     the existing account instead.
     *   - If `contactId` is provided, no new contact is created either —
     *     useful when the lead is a new contact at an existing account.
     *   - `createOpportunity` defaults to true; pass `false` to convert
     *     without producing an opportunity (some teams convert "logos
     *     only" first).
     *   - Lead is updated atomically: `is_converted=true`,
     *     `converted_account`/`converted_contact`/`converted_opportunity`
     *     pointers, `converted_date`, and `status='converted'`.
     *
     * Atomicity is enforced via the default driver's transaction support
     * when available; otherwise a best-effort compensation (delete
     * already-created child records on failure) is attempted. Permission
     * checks on each child object are inherited from the caller's
     * execution context so SecurityPlugin still gates account/contact/
     * opportunity creates.
     */
    async convertLead(request: {
        leadId: string;
        accountId?: string;
        contactId?: string;
        createOpportunity?: boolean;
        opportunity?: {
            name?: string;
            amount?: number;
            close_date?: string;
            stage?: string;
        };
        convertedStatus?: string;
        context?: any;
    }): Promise<{
        lead: any;
        account: any;
        contact: any;
        opportunity: any | null;
    }> {
        const leadId = String(request.leadId || '').trim();
        if (!leadId) {
            const err: any = new Error('leadId is required');
            err.status = 400;
            err.code = 'INVALID_REQUEST';
            throw err;
        }
        const ctx = request.context;
        const ctxOpt = ctx !== undefined ? { context: ctx } : undefined;

        // Load lead
        const lead = await this.engine.findOne('lead', { where: { id: leadId }, ...(ctxOpt as any) } as any);
        if (!lead) {
            const err: any = new Error(`Lead '${leadId}' not found`);
            err.status = 404;
            err.code = 'LEAD_NOT_FOUND';
            throw err;
        }
        if (lead.is_converted) {
            const err: any = new Error(`Lead '${leadId}' is already converted`);
            err.status = 409;
            err.code = 'LEAD_ALREADY_CONVERTED';
            throw err;
        }

        // Wrap the whole conversion in a single DB transaction so that a
        // partial failure (e.g. opportunity insert fails after we've
        // already created the account/contact) rolls back atomically
        // instead of leaving orphan rows. Falls back to direct execution
        // on drivers without transaction support — in that case the
        // operations are still ordered so callers see the same partial
        // state we'd get from any non-atomic sequence.
        const runConversion = async (trxCtx: any) => {
            const opCtx = trxCtx ?? ctx;
            const trxCtxOpt = opCtx !== undefined ? { context: opCtx } : undefined;

            // 1) Account
            let account: any;
            if (request.accountId) {
                account = await this.engine.findOne('account', { where: { id: request.accountId }, ...(trxCtxOpt as any) } as any);
                if (!account) {
                    const err: any = new Error(`Account '${request.accountId}' not found`);
                    err.status = 404;
                    err.code = 'ACCOUNT_NOT_FOUND';
                    throw err;
                }
            } else {
                const accountPayload: Record<string, any> = {
                    name: lead.company || `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim() || 'Untitled Account',
                };
                if (lead.industry)        accountPayload.industry = lead.industry;
                if (lead.annual_revenue)  accountPayload.annual_revenue = lead.annual_revenue;
                if (lead.number_of_employees) accountPayload.employees = lead.number_of_employees;
                if (lead.website)         accountPayload.website = lead.website;
                if (lead.phone)           accountPayload.phone = lead.phone;
                if (lead.address)         accountPayload.billing_address = lead.address;
                if (lead.owner)           accountPayload.owner = lead.owner;
                account = await this.engine.insert('account', accountPayload, trxCtxOpt as any);
            }

            // 2) Contact
            let contact: any;
            if (request.contactId) {
                contact = await this.engine.findOne('contact', { where: { id: request.contactId }, ...(trxCtxOpt as any) } as any);
                if (!contact) {
                    const err: any = new Error(`Contact '${request.contactId}' not found`);
                    err.status = 404;
                    err.code = 'CONTACT_NOT_FOUND';
                    throw err;
                }
            } else {
                const contactPayload: Record<string, any> = {
                    first_name: lead.first_name ?? '',
                    last_name:  lead.last_name  ?? lead.company ?? 'Unknown',
                };
                if (lead.salutation) contactPayload.salutation = lead.salutation;
                if (lead.email)      contactPayload.email = lead.email;
                if (lead.phone)      contactPayload.phone = lead.phone;
                if (lead.mobile)     contactPayload.mobile = lead.mobile;
                if (lead.title)      contactPayload.title = lead.title;
                if (lead.address)    contactPayload.mailing_address = lead.address;
                if (lead.owner)      contactPayload.owner = lead.owner;
                if (account?.id)     contactPayload.account = account.id;
                contact = await this.engine.insert('contact', contactPayload, trxCtxOpt as any);
            }

            // 3) Opportunity (optional)
            let opportunity: any | null = null;
            const shouldCreateOpp = request.createOpportunity !== false;
            if (shouldCreateOpp) {
                const oppOverrides = request.opportunity ?? {};
                const defaultName = oppOverrides.name
                    || `${account?.name ?? lead.company ?? 'Lead'} - New Opportunity`;
                const defaultClose = oppOverrides.close_date
                    || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
                const oppPayload: Record<string, any> = {
                    name: defaultName,
                    stage: oppOverrides.stage ?? 'qualification',
                    close_date: defaultClose,
                };
                if (oppOverrides.amount !== undefined)  oppPayload.amount = oppOverrides.amount;
                else if (lead.annual_revenue)            oppPayload.amount = lead.annual_revenue;
                if (account?.id)  oppPayload.account = account.id;
                if (contact?.id)  oppPayload.primary_contact = contact.id;
                if (lead.owner)   oppPayload.owner = lead.owner;
                if (lead.lead_source) oppPayload.lead_source = lead.lead_source;
                opportunity = await this.engine.insert('opportunity', oppPayload, trxCtxOpt as any);
            }

            // 4) Mark lead converted
            const leadUpdate: Record<string, any> = {
                is_converted: true,
                status: request.convertedStatus ?? 'converted',
                converted_account:     account?.id ?? null,
                converted_contact:     contact?.id ?? null,
                converted_opportunity: opportunity?.id ?? null,
                converted_date:        new Date().toISOString(),
            };
            const updatedLead = await this.engine.update('lead', leadUpdate, {
                where: { id: leadId },
                ...(trxCtxOpt as any),
            } as any);

            return {
                lead: updatedLead ?? { ...lead, ...leadUpdate },
                account,
                contact,
                opportunity,
            };
        };

        return (this.engine as any).transaction(runConversion, ctx);
    }

    // ==========================================
    // Metadata Caching
    // ==========================================

    async getMetaItemCached(request: { type: string, name: string, cacheRequest?: MetadataCacheRequest, locale?: string }): Promise<MetadataCacheResponse> {
        try {
            // Delegate to getMetaItem so the customization-overlay read order
            // (sys_metadata → registry → MetadataService) is honoured here too
            // (ADR-0005). Without this, cached reads silently bypass overlays.
            const result = await this.getMetaItem({ type: request.type, name: request.name });
            const item = (result as any)?.item;

            if (!item) {
                throw new Error(`Metadata item ${request.type}/${request.name} not found`);
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
            const hash = simpleHash(request.locale ? `${request.locale} ${content}` : content);
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
                    directives: ['public', 'max-age'],
                    maxAge: 3600, // 1 hour
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

    async batchData(request: { object: string, request: BatchUpdateRequest }): Promise<BatchUpdateResponse> {
        const { object, request: batchReq } = request;
        const { operation, records, options } = batchReq;
        const results: Array<{ id?: string; success: boolean; error?: string; record?: any }> = [];
        let succeeded = 0;
        let failed = 0;

        for (const record of records) {
            try {
                switch (operation) {
                    case 'create': {
                        const created = await this.engine.insert(object, record.data || record);
                        results.push({ id: created.id, success: true, record: created });
                        succeeded++;
                        break;
                    }
                    case 'update': {
                        if (!record.id) throw new Error('Record id is required for update');
                        const updated = await this.engine.update(object, record.data || {}, { where: { id: record.id } });
                        results.push({ id: record.id, success: true, record: updated });
                        succeeded++;
                        break;
                    }
                    case 'upsert': {
                        // Try update first, then create if not found
                        if (record.id) {
                            try {
                                const existing = await this.engine.findOne(object, { where: { id: record.id } });
                                if (existing) {
                                    const updated = await this.engine.update(object, record.data || {}, { where: { id: record.id } });
                                    results.push({ id: record.id, success: true, record: updated });
                                } else {
                                    const created = await this.engine.insert(object, { id: record.id, ...(record.data || {}) });
                                    results.push({ id: created.id, success: true, record: created });
                                }
                            } catch {
                                const created = await this.engine.insert(object, { id: record.id, ...(record.data || {}) });
                                results.push({ id: created.id, success: true, record: created });
                            }
                        } else {
                            const created = await this.engine.insert(object, record.data || record);
                            results.push({ id: created.id, success: true, record: created });
                        }
                        succeeded++;
                        break;
                    }
                    case 'delete': {
                        if (!record.id) throw new Error('Record id is required for delete');
                        await this.engine.delete(object, { where: { id: record.id } });
                        results.push({ id: record.id, success: true });
                        succeeded++;
                        break;
                    }
                    default:
                        results.push({ id: record.id, success: false, error: `Unknown operation: ${operation}` });
                        failed++;
                }
            } catch (err: any) {
                results.push({ id: record.id, success: false, error: err.message });
                failed++;
                if (options?.atomic) {
                    // Abort remaining operations on first failure in atomic mode
                    break;
                }
                if (!options?.continueOnError) {
                    break;
                }
            }
        }

        return {
            success: failed === 0,
            operation,
            total: records.length,
            succeeded,
            failed,
            results: options?.returnRecords !== false ? results : results.map(r => ({ id: r.id, success: r.success, error: r.error })),
        } as BatchUpdateResponse;
    }
    
    async createManyData(request: { object: string, records: any[] }): Promise<any> {
        const records = await this.engine.insert(request.object, request.records);
        return {
            object: request.object,
            records,
            count: records.length
        };
    }
    
    async updateManyData(request: UpdateManyDataRequest): Promise<BatchUpdateResponse> {
        const { object, records, options } = request;
        const results: Array<{ id?: string; success: boolean; error?: string; record?: any }> = [];
        let succeeded = 0;
        let failed = 0;

        for (const record of records) {
            try {
                const updated = await this.engine.update(object, record.data, { where: { id: record.id } });
                results.push({ id: record.id, success: true, record: updated });
                succeeded++;
            } catch (err: any) {
                results.push({ id: record.id, success: false, error: err.message });
                failed++;
                if (!options?.continueOnError) {
                    break;
                }
            }
        }

        return {
            success: failed === 0,
            operation: 'update',
            total: records.length,
            succeeded,
            failed,
            results,
        } as BatchUpdateResponse;
    }

    async analyticsQuery(request: any): Promise<any> {
        // Map AnalyticsQuery (cube-style) to engine aggregation.
        // cube name maps to object name; measures → aggregations; dimensions → groupBy.
        const { query, cube } = request;
        const object = cube;

        // Build groupBy from dimensions
        const groupBy = query.dimensions || [];

        // Build aggregations from measures
        // Measures can be simple field names like "count" or "field_name.sum"
        // Or cube-defined measure names. We support: field.function or just function(field).
        const aggregations: Array<{ field: string; method: string; alias: string }> = [];
        if (query.measures) {
            for (const measure of query.measures) {
                // Support formats: "count", "amount.sum", "revenue.avg"
                if (measure === 'count' || measure === 'count_all') {
                    aggregations.push({ field: '*', method: 'count', alias: 'count' });
                } else if (measure.includes('.')) {
                    const [field, method] = measure.split('.');
                    aggregations.push({ field, method, alias: `${field}_${method}` });
                } else {
                    // Treat as count of the field
                    aggregations.push({ field: measure, method: 'sum', alias: measure });
                }
            }
        }

        // Build filter from analytics filters
        let filter: any = undefined;
        if (query.filters && query.filters.length > 0) {
            const conditions: any[] = query.filters.map((f: any) => {
                const op = this.mapAnalyticsOperator(f.operator);
                if (f.values && f.values.length === 1) {
                    return { [f.member]: { [op]: f.values[0] } };
                } else if (f.values && f.values.length > 1) {
                    return { [f.member]: { $in: f.values } };
                }
                return { [f.member]: { [op]: true } };
            });
            filter = conditions.length === 1 ? conditions[0] : { $and: conditions };
        }

        // Execute via engine.aggregate (which delegates to driver.find with groupBy/aggregations)
        const rows = await this.engine.aggregate(object, {
            where: filter,
            groupBy: groupBy.length > 0 ? groupBy : undefined,
            aggregations: aggregations.length > 0
                ? aggregations.map(a => ({ function: a.method as any, field: a.field, alias: a.alias }))
                : [{ function: 'count' as any, alias: 'count' }],
        });

        // Build field metadata
        const fields = [
            ...groupBy.map((d: string) => ({ name: d, type: 'string' })),
            ...aggregations.map(a => ({ name: a.alias, type: 'number' })),
        ];

        return {
            success: true,
            data: {
                rows,
                fields,
            },
        };
    }

    async getAnalyticsMeta(request: any): Promise<any> {
        // Auto-generate cube metadata from registered objects in SchemaRegistry.
        // Each object becomes a cube; number fields → measures; other fields → dimensions.
        const objects = this.engine.registry.listItems('object');
        const cubeFilter = request?.cube;

        const cubes: any[] = [];
        for (const obj of objects) {
            const schema = obj as any;
            if (cubeFilter && schema.name !== cubeFilter) continue;

            const measures: Record<string, any> = {};
            const dimensions: Record<string, any> = {};
            const fields = schema.fields || {};

            // Always add a count measure
            measures['count'] = {
                name: 'count',
                label: 'Count',
                type: 'count',
                sql: '*',
            };

            for (const [fieldName, fieldDef] of Object.entries(fields)) {
                const fd = fieldDef as any;
                const fieldType = fd.type || 'text';

                if (['number', 'currency', 'percent'].includes(fieldType)) {
                    // Numeric fields become both measures and dimensions
                    measures[`${fieldName}_sum`] = {
                        name: `${fieldName}_sum`,
                        label: `${fd.label || fieldName} (Sum)`,
                        type: 'sum',
                        sql: fieldName,
                    };
                    measures[`${fieldName}_avg`] = {
                        name: `${fieldName}_avg`,
                        label: `${fd.label || fieldName} (Avg)`,
                        type: 'avg',
                        sql: fieldName,
                    };
                    dimensions[fieldName] = {
                        name: fieldName,
                        label: fd.label || fieldName,
                        type: 'number',
                        sql: fieldName,
                    };
                } else if (['date', 'datetime'].includes(fieldType)) {
                    dimensions[fieldName] = {
                        name: fieldName,
                        label: fd.label || fieldName,
                        type: 'time',
                        sql: fieldName,
                        granularities: ['day', 'week', 'month', 'quarter', 'year'],
                    };
                } else if (['boolean'].includes(fieldType)) {
                    dimensions[fieldName] = {
                        name: fieldName,
                        label: fd.label || fieldName,
                        type: 'boolean',
                        sql: fieldName,
                    };
                } else {
                    // text, select, lookup, etc. → dimension
                    dimensions[fieldName] = {
                        name: fieldName,
                        label: fd.label || fieldName,
                        type: 'string',
                        sql: fieldName,
                    };
                }
            }

            cubes.push({
                name: schema.name,
                title: schema.label || schema.name,
                description: schema.description,
                sql: schema.name,
                measures,
                dimensions,
                public: true,
            });
        }

        return {
            success: true,
            data: { cubes },
        };
    }

    private mapAnalyticsOperator(op: string): string {
        const map: Record<string, string> = {
            equals: '$eq',
            notEquals: '$ne',
            contains: '$contains',
            notContains: '$notContains',
            gt: '$gt',
            gte: '$gte',
            lt: '$lt',
            lte: '$lte',
            set: '$ne',
            notSet: '$eq',
        };
        return map[op] || '$eq';
    }

    async triggerAutomation(_request: any): Promise<any> {
        throw new Error('triggerAutomation requires plugin-automation service. Install and register a plugin that provides the "automation" service.');
    }

    async deleteManyData(request: DeleteManyDataRequest): Promise<any> {
        // This expects deleting by IDs.
        return this.engine.delete(request.object, {
            where: { id: { $in: request.ids } },
            ...request.options
        });
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
     */
    private isArtifactBacked(type: string, name: string): boolean {
        const registry = (this.engine as any)?.registry;
        if (!registry || typeof registry.getItem !== 'function') {
            // No registry available (test fixtures with partial engine
            // mocks). Treat as no artifact backing — safer for create paths
            // and the type-level gates still apply.
            return false;
        }
        const singular = PLURAL_TO_SINGULAR[type] ?? type;
        const item = registry.getItem(singular, name) ?? registry.getItem(type, name);
        if (!item || !item._packageId) return false;
        // `loadMetaFromDb` (line ~3092) registers DB-only objects with
        // a synthetic `'sys_metadata'` packageId so the registry can
        // distinguish them from purely transient entries. That sentinel
        // is NOT an artifact origin — exclude it here so DB-only objects
        // continue to behave as runtime-authored items.
        return item._packageId !== 'sys_metadata';
    }

    // ───────────────────────────────────────────────────────────────────
    // ADR-0010 — metadata protection (Phase 1: L3 item-level lock)
    // ───────────────────────────────────────────────────────────────────

    /**
     * Look up an item from the artifact registry across both the requested
     * type and its singular/plural twin. Returns `undefined` when the
     * registry is unavailable or the item is not artifact-backed.
     */
    private lookupArtifactItem(type: string, name: string): unknown {
        const registry = (this.engine as any)?.registry;
        if (!registry || typeof registry.getItem !== 'function') return undefined;
        const singular = PLURAL_TO_SINGULAR[type] ?? type;
        return registry.getItem(singular, name) ?? registry.getItem(type, name);
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
        // 1. Artifact wins.
        const registry = (this.engine as any)?.registry;
        const singular = PLURAL_TO_SINGULAR[type] ?? type;
        let artifactItem: any;
        if (registry && typeof registry.getItem === 'function') {
            artifactItem = registry.getItem(singular, name) ?? registry.getItem(type, name);
        }
        if (artifactItem && artifactItem._packageId && artifactItem._packageId !== 'sys_metadata') {
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
        } catch {
            // DB unavailable — fall through to 'none'.
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
        (err as any).code = 'item_locked';
        (err as any).status = 403;
        (err as any).lock = state.lock;
        (err as any).lockReason = reason;
        await this.recordMetadataAudit({
            type: args.type,
            name: args.name,
            organizationId: args.organizationId ?? null,
            operation: args.operation,
            outcome: 'denied',
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
        (err as any).code = 'item_locked';
        (err as any).status = 403;
        (err as any).lock = state.lock;
        (err as any).lockReason = reason;
        await this.recordMetadataAudit({
            type: args.type,
            name: args.name,
            organizationId: args.organizationId ?? null,
            operation: 'delete',
            outcome: 'denied',
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
     * Mirror an object-type overlay write into the in-memory engine
     * registry so subsequent CRUD finds the new schema. Idempotent and
     * safe to call after a successful persistence call. For the legacy
     * write path this is invoked BEFORE persistence (historical behavior
     * preserved); for the PR-10d.3 repository path it is invoked only
     * AFTER `put()` resolves successfully, so a failed write — DB error,
     * optimistic-lock conflict, validation failure — never leaks a
     * stale schema into the registry.
     */
    private applyObjectRegistryMutation(request: { type: string; name: string; item?: any }): void {
        if (request.type !== 'object' && request.type !== 'objects') return;
        this.engine.registry.registerItem(request.type, request.item, 'name');
        try {
            this.engine.registry.registerObject(request.item as any, 'sys_metadata');
        } catch (err: any) {
            console.warn(
                `[Protocol] registerObject failed for ${request.name}: ${err?.message ?? err}`,
            );
        }
    }

    async saveMetaItem(request: { type: string, name: string, item?: any, organizationId?: string, parentVersion?: string | null, actor?: string, force?: boolean, mode?: 'draft' | 'publish', packageId?: string | null }) {
        if (!request.item) {
            throw new Error('Item data is required');
        }
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
        if (this.environmentId !== undefined) {
            const overlayAllowed = ObjectStackProtocolImplementation.isOverlayAllowed(request.type);
            const runtimeCreateAllowed = ObjectStackProtocolImplementation.isRuntimeCreateAllowed(request.type);
            const artifactBacked = this.isArtifactBacked(request.type, request.name);
            if (artifactBacked && !overlayAllowed) {
                const err = new Error(
                    `[not_overridable] Metadata item '${request.type}/${request.name}' is provided by a code package `
                    + `and the type has not opted into per-org overlay writes (allowOrgOverride=false). `
                    + `Edit the source artifact and redeploy, or set OS_METADATA_WRITABLE to grant a runtime escape hatch. `
                    + `See docs/adr/0005-metadata-customization-overlay.md.`
                );
                (err as any).code = 'not_overridable';
                (err as any).status = 403;
                throw err;
            }
            if (!artifactBacked && !overlayAllowed && !runtimeCreateAllowed) {
                const err = new Error(
                    `[not_creatable] Metadata type '${request.type}' does not allow runtime creation `
                    + `(allowRuntimeCreate=false, allowOrgOverride=false). New items of this type must be defined in source code.`
                );
                (err as any).code = 'not_creatable';
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
                source: 'protocol.saveMetaItem',
            });
            if (lockErr) throw lockErr;
        }

        // Phase 3a-destructive: for object/field writes, diff against the
        // current schema and 409 if the change would drop data — unless the
        // caller has acknowledged the risk with `force: true`. The admin UI
        // surfaces the structured `issues` payload in a confirmation dialog.
        const singularType = PLURAL_TO_SINGULAR[request.type] ?? request.type;
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
                        (err as any).code = 'destructive_change';
                        (err as any).status = 409;
                        (err as any).issues = issues;
                        throw err;
                    }
                }
            } catch (err: any) {
                if (err?.code === 'destructive_change') throw err;
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
                (err as any).code = 'invalid_metadata';
                (err as any).status = 422;
                throw err;
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
        {
            const schema = resolveOverlaySchema(request.type, request.item);
            if (schema) {
                const parsed = schema.safeParse(request.item);
                if (!parsed.success) {
                    const issues = parsed.error.issues.map((i: z.ZodIssue) => ({
                        path: i.path.join('.'),
                        message: i.message,
                        code: i.code,
                    }));
                    const summary = issues.slice(0, 3)
                        .map((i: { path: string; message: string }) => `${i.path || '<root>'}: ${i.message}`)
                        .join('; ');
                    const err = new Error(
                        `[invalid_metadata] ${request.type}/${request.name} failed spec validation: ${summary}`
                        + (issues.length > 3 ? ` (+${issues.length - 3} more)` : '')
                    );
                    (err as any).code = 'invalid_metadata';
                    (err as any).status = 422;
                    (err as any).issues = issues;
                    throw err;
                }
            }
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

        // ADR-0008 — overlay-allowed metadata types ALWAYS route through the
        // repository write path: every mutation appends to the change log
        // and emits a watch event with a monotonic `seq` (which Studio /
        // browser clients consume for HMR). Non-overlay-allowed types
        // (`object`, `flow`, `agent`, ...) take the legacy raw-engine path
        // below — this preserves the control-plane bootstrap semantic where
        // `saveMetaItem` is permitted by the outer protocol gate to write
        // any metadata type when `environmentId` is undefined (the repository's
        // `assertAllowed()` would 403 those writes).
        //
        // PR-10d.6 (this PR) removed the `useRepositoryWritePath` flag.
        // For overlay-allowed types the repo path is no longer opt-out-able.
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
        const overlayAllowedForRepo = ObjectStackProtocolImplementation.isOverlayAllowed(singularTypeForRepo);
        const runtimeCreateAllowedForRepo = ObjectStackProtocolImplementation.isRuntimeCreateAllowed(singularTypeForRepo);
        const useRepoPath = overlayAllowedForRepo || runtimeCreateAllowedForRepo;
        if (useRepoPath) {
            const artifactBacked = this.isArtifactBacked(singularTypeForRepo, request.name);
            const intent: 'override-artifact' | 'runtime-only' = artifactBacked
                ? 'override-artifact'
                : 'runtime-only';
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
                // current published hash.
                const current = await repo.get(ref, { state: mode === 'draft' ? 'draft' : 'active' });
                parentVersion = current?.hash ?? null;
            }
            try {
                const result = await repo.put(ref, request.item, {
                    parentVersion,
                    actor: request.actor ?? 'system',
                    source: 'protocol.saveMetaItem',
                    intent,
                    state: mode === 'draft' ? 'draft' : 'active',
                    ...(request.packageId !== undefined ? { packageId: request.packageId } : {}),
                });
                // Persistence succeeded — NOW it's safe to mutate the
                // in-memory object registry. If put() had thrown, the
                // registry would still reflect the prior state. Drafts
                // are NOT live: don't propagate them into the runtime
                // object registry (would defeat the staging buffer).
                if (mode === 'publish') {
                    this.applyObjectRegistryMutation(request);
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
                    source: 'protocol.saveMetaItem',
                    note: mode === 'draft' ? 'draft' : 'active',
                });
                return {
                    success: true,
                    version: result.version,
                    seq: result.seq,
                    state: mode === 'draft' ? 'draft' : 'active',
                    message: orgId
                        ? `Saved customization overlay (org=${orgId}, state=${mode === 'draft' ? 'draft' : 'active'}) — type=${request.type}, name=${request.name} [seq=${result.seq}]`
                        : `Saved customization overlay (env-wide, state=${mode === 'draft' ? 'draft' : 'active'}) — type=${request.type}, name=${request.name} [seq=${result.seq}]`,
                };
            } catch (err: any) {
                if (err instanceof ConflictError) {
                    const conflict = new Error(
                        `[metadata_conflict] ${request.type}/${request.name} has been modified since you loaded it. `
                        + `Expected parent ${err.expectedParent ?? 'null'} but current is ${err.actualHead ?? 'null'}.`,
                    );
                    (conflict as any).code = 'metadata_conflict';
                    (conflict as any).status = 409;
                    (conflict as any).expectedParent = err.expectedParent;
                    (conflict as any).actualHead = err.actualHead;
                    throw conflict;
                }
                throw err;
            }
        }

        // Legacy raw-engine path — taken when the type is NOT overlay-allowed
        // (control-plane bootstrap of `object`/`flow`/etc. when `environmentId` is
        // undefined). This branch is intentionally retained: the repository
        // write path's `assertAllowed()` would 403 these types. There is no
        // change-log / HMR machinery for non-overlay metadata because
        // control-plane mutations are bootstrap-only and not subject to
        // per-org overlay semantics.
        //
        // Note: the registry mutation for the legacy path happens BEFORE
        // persistence (preserved historical behaviour). The overlay-allowed
        // path moved it to AFTER persistence in PR-10d.3 (rubber-duck #3).
        this.applyObjectRegistryMutation(request);

        try {
            const now = new Date().toISOString();
            const orgId = request.organizationId ?? null;
            const scopedWhere: Record<string, unknown> = {
                type: request.type,
                name: request.name,
                organization_id: orgId,
                state: 'active',
            };
            const existing = await this.engine.findOne('sys_metadata', {
                where: scopedWhere,
            });

            if (existing) {
                const updateRow: Record<string, unknown> = {
                    metadata: JSON.stringify(request.item),
                    updated_at: now,
                    version: (existing.version || 0) + 1,
                    state: 'active',
                };
                // Preserve an existing non-null package binding; only fill when
                // unset (mirror of SysMetadataRepository.put semantics).
                const existingPkg = (existing as { package_id?: string | null }).package_id ?? null;
                const nextPkg = existingPkg ?? request.packageId ?? null;
                if (nextPkg !== null) updateRow.package_id = nextPkg;
                await this.engine.update('sys_metadata', updateRow, {
                    where: { id: existing.id }
                });
            } else {
                // Use crypto.randomUUID() when available (modern browsers and Node ≥ 14.17);
                // fall back to a time+random ID for older or restricted environments.
                const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                    ? crypto.randomUUID()
                    : `meta_${Date.now()}_${Math.random().toString(36).slice(2)}`;
                const row: Record<string, unknown> = {
                    id,
                    name: request.name,
                    type: request.type,
                    // `scope` enum is ['system','platform','user']; per-org
                    // overlays use 'platform' as the informational tag. The
                    // authoritative isolation key is `organization_id`.
                    scope: 'platform',
                    metadata: JSON.stringify(request.item),
                    state: 'active',
                    version: 1,
                    created_at: now,
                    updated_at: now,
                    organization_id: orgId,
                };
                if (request.packageId) row.package_id = request.packageId;
                await this.engine.insert('sys_metadata', row);
            }

            return {
                success: true,
                message: orgId
                    ? `Saved customization overlay (org=${orgId}) — type=${request.type}, name=${request.name}`
                    : `Saved customization overlay (env-wide) — type=${request.type}, name=${request.name}`,
            };
        } catch (dbError: any) {
            // DB write failed — surface as an error rather than silently
            // succeeding (regression from the pre-ADR-0005 "silent loss" bug).
            console.error(
                `[Protocol] sys_metadata persistence failed for ${request.type}/${request.name}: ${dbError.message}`,
            );
            const err = new Error(
                `Failed to persist customization overlay to sys_metadata: ${dbError.message}. `
                + `In-memory registry was updated but will be lost on restart.`,
            );
            (err as any).code = 'overlay_persistence_failed';
            (err as any).status = 500;
            throw err;
        }
    }

    /**
     * Yield the durable change-log for a single metadata item — every
     * put/delete recorded in `sys_metadata_history` for `(org, type, name)`,
     * in event_seq order. Powers the Studio "History" tab and any
     * client-side audit timeline.
     *
     * Returns `[]` for non-overlay-allowed types (the legacy raw-engine
     * path doesn't record history) instead of throwing — callers can treat
     * "no history" uniformly.
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
    }): Promise<{
        success: boolean;
        version: string;
        seq: number;
        message?: string;
    }> {
        const singularType = PLURAL_TO_SINGULAR[request.type] ?? request.type;
        if (!ObjectStackProtocolImplementation.isOverlayAllowed(singularType)
            && !ObjectStackProtocolImplementation.isRuntimeCreateAllowed(singularType)) {
            const err: any = new Error(
                `[not_overridable] Metadata type '${request.type}' is not draftable — no overlay/runtime-create permission.`,
            );
            err.code = 'not_overridable';
            err.status = 403;
            throw err;
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
                actor: request.actor ?? 'system',
                source: 'protocol.publishMetaItem',
                ...(request.message ? { message: request.message } : {}),
                intent,
            });
            // Drafts skipped the registry mutation; on publish we now
            // refresh the runtime object registry so live behaviour
            // catches up immediately (matches saveMetaItem's
            // post-persistence registry update path).
            this.applyObjectRegistryMutation({
                type: request.type,
                name: request.name,
                item: result.item.body,
            });
            return {
                success: true,
                version: result.version,
                seq: result.seq,
                message: `Published draft — type=${request.type}, name=${request.name} [seq=${result.seq}]`,
            };
        } catch (err: any) {
            if (err instanceof ConflictError) {
                const conflict: any = new Error(
                    `[metadata_conflict] ${request.type}/${request.name} published row advanced while you held the draft. `
                    + `Expected parent ${err.expectedParent ?? 'null'} but current is ${err.actualHead ?? 'null'}.`,
                );
                conflict.code = 'metadata_conflict';
                conflict.status = 409;
                conflict.expectedParent = err.expectedParent;
                conflict.actualHead = err.actualHead;
                throw conflict;
            }
            throw err;
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
    }): Promise<{
        success: boolean;
        publishedCount: number;
        failedCount: number;
        published: Array<{ type: string; name: string; version: string }>;
        failed: Array<{ type: string; name: string; error: string; code?: string }>;
    }> {
        await this.ensureOverlayIndex();
        const orgId = request.organizationId ?? null;
        const repo = this.getOverlayRepo(orgId);
        const drafts = await repo.listDrafts({ packageId: request.packageId });

        const published: Array<{ type: string; name: string; version: string }> = [];
        const failed: Array<{ type: string; name: string; error: string; code?: string }> = [];

        for (const d of drafts) {
            try {
                const r = await this.publishMetaItem({
                    type: d.type,
                    name: d.name,
                    ...(request.organizationId ? { organizationId: request.organizationId } : {}),
                    ...(request.actor ? { actor: request.actor } : {}),
                    message: `publish app package '${request.packageId}'`,
                });
                published.push({ type: d.type, name: d.name, version: r.version });
            } catch (e: any) {
                failed.push({
                    type: d.type,
                    name: d.name,
                    error: e?.message ?? 'publish failed',
                    ...(e?.code ? { code: e.code } : {}),
                });
            }
        }

        return {
            success: failed.length === 0 && published.length > 0,
            publishedCount: published.length,
            failedCount: failed.length,
            published,
            failed,
        };
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
            err.code = 'invalid_request';
            err.status = 400;
            throw err;
        }
        const singularType = PLURAL_TO_SINGULAR[request.type] ?? request.type;
        if (!ObjectStackProtocolImplementation.isOverlayAllowed(singularType)
            && !ObjectStackProtocolImplementation.isRuntimeCreateAllowed(singularType)) {
            const err: any = new Error(
                `[not_overridable] Metadata type '${request.type}' is not revertable — no overlay/runtime-create permission.`,
            );
            err.code = 'not_overridable';
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
        const orgId = request.organizationId ?? null;
        const repo = this.getOverlayRepo(orgId);
        const artifactBacked = this.isArtifactBacked(singularType, request.name);
        const intent: 'override-artifact' | 'runtime-only' = artifactBacked
            ? 'override-artifact' : 'runtime-only';
        const ref = {
            type: singularType,
            name: request.name,
            org: orgId ?? 'env',
        } as Parameters<typeof repo.restoreVersion>[0];
        try {
            const result = await repo.restoreVersion(ref, request.toVersion, {
                actor: request.actor ?? 'system',
                source: 'protocol.rollbackMetaItem',
                ...(request.message ? { message: request.message } : {}),
                intent,
            });
            this.applyObjectRegistryMutation({
                type: request.type,
                name: request.name,
                item: result.item.body,
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
                conflict.code = 'metadata_conflict';
                conflict.status = 409;
                conflict.expectedParent = err.expectedParent;
                conflict.actualHead = err.actualHead;
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
    }): Promise<{
        success: boolean;
        message?: string;
        reset?: boolean;
        seq?: number;
    }> {
        // Two-tier authorization for delete (mirrors saveMetaItem).
        //  • Artifact-backed item → delete becomes a tombstone overlay,
        //    requires `allowOrgOverride`.
        //  • DB-only item → hard delete of a user-created row,
        //    requires `allowRuntimeCreate` (or `allowOrgOverride`).
        if (this.environmentId !== undefined) {
            const overlayAllowed = ObjectStackProtocolImplementation.isOverlayAllowed(request.type);
            const runtimeCreateAllowed = ObjectStackProtocolImplementation.isRuntimeCreateAllowed(request.type);
            const artifactBacked = this.isArtifactBacked(request.type, request.name);
            if (artifactBacked && !overlayAllowed) {
                const err = new Error(
                    `[not_overridable] Metadata item '${request.type}/${request.name}' is provided by a code package `
                    + `and the type has not opted into per-org overlay writes. `
                    + `See docs/adr/0005-metadata-customization-overlay.md.`
                );
                (err as any).code = 'not_overridable';
                (err as any).status = 403;
                throw err;
            }
            if (!artifactBacked && !overlayAllowed && !runtimeCreateAllowed) {
                const err = new Error(
                    `[not_creatable] Metadata type '${request.type}' does not allow runtime creation or deletion.`
                );
                (err as any).code = 'not_creatable';
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
                    return {
                        success: true,
                        reset: false,
                        message: targetState === 'draft'
                            ? `No pending draft for ${request.type}/${request.name}.`
                            : `No customization overlay found for ${request.type}/${request.name} — already at artifact default.`,
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
                    actor: request.actor ?? 'system',
                    source: 'protocol.deleteMetaItem',
                    intent: this.isArtifactBacked(singularTypeForRepo, request.name)
                        ? 'override-artifact'
                        : 'runtime-only',
                    state: targetState,
                });

                // Refresh the in-memory artifact-side state on control-plane
                // kernels (same logic as the legacy branch — see comments
                // there for why this only runs when environmentId === undefined).
                if (this.environmentId === undefined) {
                    try {
                        const services = this.getServicesRegistry?.();
                        const metadataService = services?.get('metadata');
                        if (metadataService && typeof metadataService.get === 'function') {
                            const artifactItem = await metadataService.get(request.type, request.name);
                            if (artifactItem !== undefined) {
                                this.engine.registry.registerItem(request.type, artifactItem, 'name');
                            }
                        }
                    } catch {
                        // Best-effort registry refresh; next read fixes it anyway
                    }
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

                return {
                    success: true,
                    reset: true,
                    seq: result.seq,
                    message: (request.state === 'draft')
                        ? `Draft discarded — ${request.type}/${request.name}. [seq=${result.seq}]`
                        : `Customization overlay deleted — ${request.type}/${request.name} reset to artifact default. [seq=${result.seq}]`,
                };
            } catch (err: any) {
                if (err instanceof ConflictError) {
                    const conflict = new Error(
                        `[metadata_conflict] ${request.type}/${request.name} has been modified since you loaded it. `
                        + `Expected parent ${err.expectedParent ?? 'null'} but current is ${err.actualHead ?? 'null'}.`,
                    );
                    (conflict as any).code = 'metadata_conflict';
                    (conflict as any).status = 409;
                    (conflict as any).expectedParent = err.expectedParent;
                    (conflict as any).actualHead = err.actualHead;
                    throw conflict;
                }
                const e = new Error(`Failed to delete customization overlay: ${err.message ?? err}`);
                (e as any).status = err?.status ?? 500;
                throw e;
            }
        }

        // ── Legacy raw-engine path: only reachable in control-plane bootstrap
        // (environmentId === undefined) for non-overlay-allowed types like
        // `object`, `flow`, `agent`. No history row, no watch event — these
        // types don't participate in the change-log model.
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
                    message: `No customization overlay found for ${request.type}/${request.name} — already at artifact default.`,
                };
            }
            await this.engine.delete('sys_metadata', { where: { id: existing.id } });

            if (this.environmentId === undefined) {
                try {
                    const services = this.getServicesRegistry?.();
                    const metadataService = services?.get('metadata');
                    if (metadataService && typeof metadataService.get === 'function') {
                        const artifactItem = await metadataService.get(request.type, request.name);
                        if (artifactItem !== undefined) {
                            this.engine.registry.registerItem(request.type, artifactItem, 'name');
                        }
                    }
                } catch {
                    // Best-effort registry refresh; next read fixes it anyway
                }
            }

            return {
                success: true,
                reset: true,
                message: `Customization overlay deleted — ${request.type}/${request.name} reset to artifact default.`,
            };
        } catch (err: any) {
            const e = new Error(`Failed to delete customization overlay: ${err.message}`);
            (e as any).status = 500;
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
     */
    async loadMetaFromDb(): Promise<{ loaded: number; errors: number }> {
        let loaded = 0;
        let errors = 0;
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
                    const data = typeof record.metadata === 'string'
                        ? JSON.parse(record.metadata)
                        : record.metadata;
                    // Normalize DB type to singular (DB may store legacy plural forms)
                    const normalizedType = PLURAL_TO_SINGULAR[record.type] ?? record.type;
                    if (normalizedType === 'object') {
                        this.engine.registry.registerObject(data as any, record.packageId || 'sys_metadata');
                    } else {
                        this.engine.registry.registerItem(normalizedType, data, 'name' as any);
                    }
                    loaded++;
                } catch (e) {
                    errors++;
                    console.warn(`[Protocol] Failed to hydrate ${record.type}/${record.name}: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
        } catch (e: any) {
            // "no such table" is expected on first run before migrations execute — not an error.
            if (!/no such table/i.test(e.message ?? '')) {
                console.warn(`[Protocol] DB hydration skipped: ${e.message}`);
            }
        }
        return { loaded, errors };
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

    // ==========================================
    // Feed Operations
    // ==========================================

    async listFeed(request: any): Promise<any> {
        const svc = this.requireFeedService();
        const result = await svc.listFeed({
            object: request.object,
            recordId: request.recordId,
            filter: request.type,
            limit: request.limit,
            cursor: request.cursor,
        });
        return { success: true, data: result };
    }

    async createFeedItem(request: any): Promise<any> {
        const svc = this.requireFeedService();
        const item = await svc.createFeedItem({
            object: request.object,
            recordId: request.recordId,
            type: request.type,
            actor: { type: 'user', id: 'current_user' },
            body: request.body,
            mentions: request.mentions,
            parentId: request.parentId,
            visibility: request.visibility,
        });
        return { success: true, data: item };
    }

    async updateFeedItem(request: any): Promise<any> {
        const svc = this.requireFeedService();
        const item = await svc.updateFeedItem(request.feedId, {
            body: request.body,
            mentions: request.mentions,
            visibility: request.visibility,
        });
        return { success: true, data: item };
    }

    async deleteFeedItem(request: any): Promise<any> {
        const svc = this.requireFeedService();
        await svc.deleteFeedItem(request.feedId);
        return { success: true, data: { feedId: request.feedId } };
    }

    async addReaction(request: any): Promise<any> {
        const svc = this.requireFeedService();
        const reactions = await svc.addReaction(request.feedId, request.emoji, 'current_user');
        return { success: true, data: { reactions } };
    }

    async removeReaction(request: any): Promise<any> {
        const svc = this.requireFeedService();
        const reactions = await svc.removeReaction(request.feedId, request.emoji, 'current_user');
        return { success: true, data: { reactions } };
    }

    async pinFeedItem(request: any): Promise<any> {
        const svc = this.requireFeedService();
        const item = await svc.getFeedItem(request.feedId);
        if (!item) throw new Error(`Feed item ${request.feedId} not found`);
        // IFeedService doesn't have dedicated pin/unpin — use updateFeedItem to persist pin state
        await svc.updateFeedItem(request.feedId, { visibility: item.visibility });
        return { success: true, data: { feedId: request.feedId, pinned: true, pinnedAt: new Date().toISOString() } };
    }

    async unpinFeedItem(request: any): Promise<any> {
        const svc = this.requireFeedService();
        const item = await svc.getFeedItem(request.feedId);
        if (!item) throw new Error(`Feed item ${request.feedId} not found`);
        await svc.updateFeedItem(request.feedId, { visibility: item.visibility });
        return { success: true, data: { feedId: request.feedId, pinned: false } };
    }

    async starFeedItem(request: any): Promise<any> {
        const svc = this.requireFeedService();
        const item = await svc.getFeedItem(request.feedId);
        if (!item) throw new Error(`Feed item ${request.feedId} not found`);
        // IFeedService doesn't have dedicated star/unstar — verify item exists then return state
        await svc.updateFeedItem(request.feedId, { visibility: item.visibility });
        return { success: true, data: { feedId: request.feedId, starred: true, starredAt: new Date().toISOString() } };
    }

    async unstarFeedItem(request: any): Promise<any> {
        const svc = this.requireFeedService();
        const item = await svc.getFeedItem(request.feedId);
        if (!item) throw new Error(`Feed item ${request.feedId} not found`);
        await svc.updateFeedItem(request.feedId, { visibility: item.visibility });
        return { success: true, data: { feedId: request.feedId, starred: false } };
    }

    async searchFeed(request: any): Promise<any> {
        const svc = this.requireFeedService();
        // Search delegates to listFeed with filter since IFeedService doesn't have a dedicated search
        const result = await svc.listFeed({
            object: request.object,
            recordId: request.recordId,
            filter: request.type,
            limit: request.limit,
            cursor: request.cursor,
        });
        // Filter by query text in body
        const queryLower = (request.query || '').toLowerCase();
        const filtered = result.items.filter((item: any) =>
            item.body?.toLowerCase().includes(queryLower)
        );
        return { success: true, data: { items: filtered, total: filtered.length, hasMore: false } };
    }

    async getChangelog(request: any): Promise<any> {
        const svc = this.requireFeedService();
        // Changelog retrieves field_change type feed items
        const result = await svc.listFeed({
            object: request.object,
            recordId: request.recordId,
            filter: 'changes_only',
            limit: request.limit,
            cursor: request.cursor,
        });
        const entries = result.items.map((item: any) => ({
            id: item.id,
            object: item.object,
            recordId: item.recordId,
            actor: item.actor,
            changes: item.changes || [],
            timestamp: item.createdAt,
            source: item.source,
        }));
        return { success: true, data: { entries, total: result.total, nextCursor: result.nextCursor, hasMore: result.hasMore } };
    }

    async feedSubscribe(request: any): Promise<any> {
        const svc = this.requireFeedService();
        const subscription = await svc.subscribe({
            object: request.object,
            recordId: request.recordId,
            userId: 'current_user',
            events: request.events,
            channels: request.channels,
        });
        return { success: true, data: subscription };
    }

    async feedUnsubscribe(request: any): Promise<any> {
        const svc = this.requireFeedService();
        const unsubscribed = await svc.unsubscribe(request.object, request.recordId, 'current_user');
        return { success: true, data: { object: request.object, recordId: request.recordId, unsubscribed } };
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
        const manifest = request.manifest;
        const pkg = this.engine.registry.installPackage(manifest as any, request.settings);

        // Best-effort durable persistence to `sys_packages`.
        try {
            const services = this.getServicesRegistry?.();
            const pkgSvc = services?.get('package') as
                | { publish?: (data: { manifest: unknown; metadata: unknown }) => Promise<unknown> }
                | undefined;
            if (pkgSvc?.publish && (manifest as any)?.version) {
                await pkgSvc.publish({ manifest, metadata: {} });
            }
        } catch (e) {
            // Non-fatal: registry write already succeeded; log and continue.
            console.warn(
                `[protocol.installPackage] sys_packages persist skipped for '${(manifest as any)?.id}': ${(e as Error)?.message}`,
            );
        }

        return { package: pkg as any, message: `Installed package: ${(manifest as any)?.id}` };
    }
}
