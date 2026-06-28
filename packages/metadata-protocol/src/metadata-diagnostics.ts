// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Load-time metadata diagnostics.
 *
 * Decorates metadata documents read from `getMetaItems()` /
 * `getMetaItem()` with a `_diagnostics` envelope so Studio (and any
 * other consumer) can render validity badges, inline field errors, and
 * governance dashboards without having to re-implement spec validation
 * on the client.
 *
 * Single source of truth: the same {@link getMetadataTypeSchema} that
 * the save path (`protocol.saveMetaItem` →
 * `resolveOverlaySchema().safeParse()`) and the JSON-Schema emitter
 * (`getMetaTypes() → entries[].schema`) already consult. Adding a new
 * metadata type's Zod schema in one place automatically wires it up
 * for read-time diagnostics, write-time validation, **and** Studio's
 * form renderer.
 *
 * Wire shape (`_diagnostics`) intentionally mirrors the existing
 * {@link MetadataValidationResult} type from
 * `@objectstack/spec/kernel` so consumers can share one type alias
 * across the validate / write / read surfaces.
 */

import type { z } from 'zod';
import { getMetadataTypeSchema } from '@objectstack/spec/kernel';
import type { MetadataValidationResult } from '@objectstack/spec/kernel';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';

/**
 * Re-export the canonical validation-result type so callers in this
 * package don't need to dual-import from `@objectstack/spec/kernel`.
 */
export type MetadataDiagnostics = MetadataValidationResult;

/**
 * Compute spec diagnostics for a single metadata document.
 *
 * Returns `undefined` when the type has no registered Zod schema
 * (`function` / `service` / `router`, or any plugin type that has not
 * called `registerMetadataTypeSchema()`). Callers MUST treat that as
 * "no opinion" — not as "valid" — and either skip decoration entirely
 * or surface a `validatable: false` flag if their UI cares.
 */
export function computeMetadataDiagnostics(
    type: string,
    item: unknown,
): MetadataDiagnostics | undefined {
    const singular = PLURAL_TO_SINGULAR[type] ?? type;
    const schema = getMetadataTypeSchema(singular);
    if (!schema) return undefined;

    if (item === null || item === undefined || typeof item !== 'object') {
        return {
            valid: false,
            errors: [{
                path: '',
                message: 'Metadata document must be a non-null object',
                code: 'invalid_type',
            }],
        };
    }

    // Strip our own decoration before re-validating so it never becomes
    // a false-positive "unrecognized_keys" failure on schemas that grow
    // a `.strict()` mode in the future.
    const candidate = '_diagnostics' in (item as Record<string, unknown>)
        ? stripDiagnostics(item as Record<string, unknown>)
        : item;

    const parsed = (schema as z.ZodTypeAny).safeParse(candidate);
    if (parsed.success) {
        return { valid: true };
    }

    const errors = parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
        code: issue.code as string,
    }));

    return { valid: false, errors };
}

function stripDiagnostics(item: Record<string, unknown>): Record<string, unknown> {
    const { _diagnostics: _drop, ...rest } = item;
    void _drop;
    return rest;
}

/**
 * Attach `_diagnostics` to a single metadata item. Returns the item
 * unchanged when no diagnostics could be computed (unknown type) or
 * when the input is not an object.
 *
 * The returned reference is always a shallow copy when decoration
 * occurs — callers must not assume identity equality with the input.
 */
export function decorateMetadataItem<T>(type: string, item: T): T {
    if (!item || typeof item !== 'object') return item;
    const diagnostics = computeMetadataDiagnostics(type, item);
    if (!diagnostics) return item;
    return { ...(item as Record<string, unknown>), _diagnostics: diagnostics } as T;
}

/**
 * Decorate an array of metadata items. Non-array inputs and non-object
 * elements are returned unchanged, preserving the upstream defensive
 * "items may be a wrapped or naked array" contract documented in
 * `rest-server.ts`.
 */
export function decorateMetadataItems<T>(type: string, items: T[]): T[] {
    if (!Array.isArray(items)) return items;
    return items.map((item) => decorateMetadataItem(type, item));
}

// ---------------------------------------------------------------------------
// ADR-0047 — reference-integrity diagnostics for list views
// ---------------------------------------------------------------------------

/** Minimal object-definition shape the reference checker needs. */
interface ObjectDefLike {
    fields?: Record<string, { type?: string }> | Array<{ name: string; type?: string }>;
}

function fieldMap(objectDef: ObjectDefLike): Map<string, { type?: string }> {
    const map = new Map<string, { type?: string }>();
    const fields = objectDef?.fields;
    if (Array.isArray(fields)) {
        for (const f of fields) if (f?.name) map.set(f.name, f);
    } else if (fields && typeof fields === 'object') {
        for (const [name, f] of Object.entries(fields)) map.set(name, f ?? {});
    }
    return map;
}

/**
 * Cross-document reference checks Zod cannot express: every field a list
 * view's user-facing filter surface points at must exist on the source
 * object, and binding-dependent visualizations must have resolvable
 * bindings (kanban → select-like `groupByField`).
 *
 * Pure function — callers (read decoration, the ADR-0033 AI apply loop)
 * supply the already-resolved object definition. Returns `{ valid: true }`
 * when every reference resolves; errors use the same wire shape as
 * {@link computeMetadataDiagnostics} so consumers can merge the two.
 *
 * Spec-shape validation stays in `computeMetadataDiagnostics`; this only
 * covers what a schema alone cannot see.
 */
export function computeViewReferenceDiagnostics(
    view: Record<string, unknown>,
    objectDef: ObjectDefLike,
): MetadataDiagnostics {
    const fields = fieldMap(objectDef);
    const errors: NonNullable<MetadataDiagnostics['errors']> = [];
    const requireField = (name: unknown, path: string) => {
        if (typeof name !== 'string' || !name) return;
        if (!fields.has(name)) {
            errors.push({
                path,
                message: `Field "${name}" does not exist on the source object`,
                code: 'reference_not_found',
            });
        }
    };

    const userFilters = view?.userFilters as
        | { fields?: Array<{ field?: string }>; tabs?: Array<{ filter?: Array<{ field?: string }> }> }
        | undefined;
    userFilters?.fields?.forEach((f, i) => requireField(f?.field, `userFilters.fields.${i}.field`));
    userFilters?.tabs?.forEach((t, i) =>
        t?.filter?.forEach((r, j) => requireField(r?.field, `userFilters.tabs.${i}.filter.${j}.field`)));

    (view?.tabs as Array<{ filter?: Array<{ field?: string }> }> | undefined)?.forEach((t, i) =>
        t?.filter?.forEach((r, j) => requireField(r?.field, `tabs.${i}.filter.${j}.field`)));

    (view?.filterableFields as string[] | undefined)?.forEach((f, i) =>
        requireField(f, `filterableFields.${i}`));

    const kanban = view?.kanban as { groupByField?: string } | undefined;
    if (kanban?.groupByField) {
        requireField(kanban.groupByField, 'kanban.groupByField');
        const def = fields.get(kanban.groupByField);
        if (def && def.type && !['select', 'multi-select', 'boolean', 'lookup', 'master_detail', 'user'].includes(def.type)) {
            errors.push({
                path: 'kanban.groupByField',
                message: `Field "${kanban.groupByField}" (type "${def.type}") cannot group a kanban — use a select-like field`,
                code: 'invalid_binding',
            });
        }
    }

    return errors.length ? { valid: false, errors } : { valid: true };
}
