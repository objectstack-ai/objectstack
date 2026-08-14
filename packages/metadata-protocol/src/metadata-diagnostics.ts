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
import { getMetadataTypeSchema, stripReadDecorations } from '@objectstack/spec/kernel';
import type { MetadataValidationResult } from '@objectstack/spec/kernel';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
// [#5598] The READ path's share of the #5364 expansion. `zodIssuesToMetadataIssues`
// is the ONE ranking this package speaks; the save path's 422 calls the same
// function, so a document's verdict cannot depend on whether it was being saved
// or being opened. See the note above the `.safeParse()` below.
import { zodIssuesToMetadataIssues } from './protocol.js';
// [#8154] The per-type credential redactor seam (`@objectstack/spec/kernel`,
// landed by #8300). Composed into `decorateMetadataItem` below — see the
// ordering note there for why it is not applied per read exit.
import { redactMetadataItem } from './metadata-redaction.js';

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

    // [#7656] Strip EVERY read decoration — the shared
    // `METADATA_READ_DECORATIONS` list — before re-validating, not just the
    // `_diagnostics` key this function stamps itself.
    //
    // This is a re-parse of a SERVED document in exactly the sense the module
    // header of `spec/kernel/metadata-read-decorations.ts` means, so it is the
    // third consumer of that list (after the write path's verbatim persist and
    // the cold-boot flow bind) and must read it rather than keep a private
    // one-key copy. The private copy predated `_draft` joining the list, and
    // the schemas being closed since #4001 turned that gap into a verdict about
    // the READER: `?preview=draft` stamps `_draft:true` on the item (both the
    // single-item exit and the list overlay) and then decorates it, so the
    // strict schema rejected our own badge BY NAME and every valid draft came
    // back `valid:false / unrecognized_keys: ["_draft"]`.
    //
    // ⛔ The item schema is NOT the thing to loosen here: `_draft` is not a
    // document key and must stay rejected when it appears in a stored body. It
    // is the response's badge, which is precisely what the decoration list
    // says. Same class as #6810 (`indexed`), different remedy — that key did
    // not belong on the served body at all and left at its injection site,
    // whereas this one is read by the UI and belongs on the response.
    const candidate = stripReadDecorations(item);

    const parsed = (schema as z.ZodTypeAny).safeParse(candidate);
    if (parsed.success) {
        return { valid: true };
    }

    // [#5598] NOT `parsed.error.issues.map(…)`. Zod folds every branch of a
    // failed `z.union` into ONE top-level issue whose path is `''` and whose
    // message is the literal `"Invalid input"`; a plain `.map()` therefore put
    // exactly that on `_diagnostics` and dropped the branch that says WHICH key
    // is wrong. `ViewMetadataSchema` IS a top-level union, so EVERY stored view
    // with a defect degraded to one rootless line and Studio's inline field
    // errors had nothing to highlight — the read-path twin of the save-path
    // defect #5364 fixed, and the fifth consumer of one mechanism (#4971,
    // #5014, #5341, #5364).
    //
    // Reusing `zodIssuesToMetadataIssues` rather than re-deriving the policy is
    // the point: branch selection (drop the branches that only mismatch a root
    // KIND, fewest-issues wins, `unrecognized_keys` breaks the tie, ties all
    // emitted under a cap, nested unions recursed with absolute paths) is
    // defined once, so opening a broken document and saving it give the author
    // the same words. The expansion is strictly additive — the union's own
    // entry is still first, so any consumer reading `errors[0]` today reads the
    // same entry after this change.
    const errors = zodIssuesToMetadataIssues(parsed.error.issues);

    return { valid: false, errors };
}

/**
 * Attach `_diagnostics` to a single metadata item, and apply the type's
 * read-path redactor. Returns the item unchanged when neither applies, or
 * when the input is not an object.
 *
 * The returned reference is always a shallow copy when decoration
 * occurs — callers must not assume identity equality with the input.
 *
 * [#8154] ⛔ THE ORDER OF THE TWO STATEMENTS BELOW IS LOAD-BEARING, and it is
 * why redaction is composed HERE rather than applied at each read exit beside
 * `governServedObject` (whose own docblock in `protocol.ts` explains why
 * governance and injection went the other way).
 *
 * Diagnostics MUST be computed on the RAW stored body. Measured, in the
 * predicted direction: computing them on the redacted body flips
 * `valid:false` → `valid:true` for exactly the rows holding a stored cleartext
 * credential — because the redacted body is the one the post-#8078 schema
 * ACCEPTS — which destroys the `#8081` item-3 migration inventory. That badge
 * is the operator's only enumeration of which rows still need migrating, so
 * inverting these two lines silently removes the remedy while the leak it was
 * tracking looks fixed. Composed into one function so no call site can invert
 * an ordering it cannot see.
 *
 * Redaction runs even when diagnostics are `undefined`. A type with a
 * registered redactor and no registered Zod schema is exactly the shape a
 * plugin's secret-bearing type arrives in, and an early `return item` on the
 * diagnostics miss would serve its credentials in cleartext — a fail-open
 * keyed on an unrelated registration.
 */
export function decorateMetadataItem<T>(type: string, item: T): T {
    if (!item || typeof item !== 'object') return item;
    const diagnostics = computeMetadataDiagnostics(type, item);
    const served = redactMetadataItem(type, item);
    if (!diagnostics) return served;
    return { ...(served as Record<string, unknown>), _diagnostics: diagnostics } as T;
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
