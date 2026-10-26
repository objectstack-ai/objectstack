/**
 * ViewConfigPanel — Shared Utilities
 *
 * Extracted from ViewConfigPanel to enable reuse across the
 * schema-driven config panel framework.
 */

import type { FilterBuilderOperator, FilterBuilderRowGroup, SortItem } from '@object-ui/components';
// The retirement gate (objectui#4914, ruling B). This package carries no
// `@object-ui/fields` dependency — and does not gain one here — so it reads
// the gate from its home in `@object-ui/core`, which `fields` re-exports
// verbatim. One table, one dedupe set, no new package edge.
import { isRetiredFieldType, reportRetiredFieldType } from '@object-ui/core';
import { VIEW_FILTER_OPERATORS, VIEW_FILTER_OPERATOR_ALIASES } from '@objectstack/spec/ui';
import type { ViewFilterOperator } from '@objectstack/spec/ui';

// ---------------------------------------------------------------------------
// Operator mapping: @objectstack/spec → FilterBuilder
// ---------------------------------------------------------------------------
//
// One direction only. A stored view filter is *read* into a FilterBuilder here;
// the write direction was retired with the legacy `buildViewConfigSchema`
// engine, and the studio's spec-driven inspector persists the authored body
// itself. The retired table was also objectui's last emitter of `'not in'`
// (with a space), `before` and `after` as filter-AST operators — spellings the
// server used to drop silently (#2901, objectstack#3948).

/**
 * There is no canonical → builder table any more (objectui#9306).
 *
 * This file used to carry `CANONICAL_TO_BUILDER`, a total map from every
 * `VIEW_FILTER_OPERATORS` member onto the FilterBuilder's camelCase id for it
 * (`not_equals` → `notEquals`, `icontains` → `containsCaseInsensitive`, …).
 * The dropdown now speaks the protocol's own ids, so that map had become the
 * identity over the twenty, and an identity table is a second copy of the
 * spec's list waiting to drift from it. The fact it used to guarantee — every
 * canonical operator reaches the builder as an id its dropdown can select —
 * is now carried by the builder's `FilterBuilderOperator` type itself, which
 * a type-level pin in `@object-ui/components` holds EQUAL to the spec's
 * `ViewFilterOperator` plus the two opt-in existence ids, and by
 * `view-operator-builder-parity.test.ts`, which drives every canonical member
 * and every alias row through {@link specToBuilderOperator} below.
 *
 * What survives is the part the spec does not do for us: folding the infix
 * spellings a stored filter ARRAY carries, and matching case- and
 * separator-insensitively, onto the canonical member.
 */

/**
 * Infix and short spellings a stored *filter array* carries instead of a view
 * spelling — `['amount', '>', 100]`. These are `AST_OPERATOR_MAP` keys
 * (`data/filter.zod.ts`) that case-folding alone cannot reach.
 */
const INFIX_TO_CANONICAL: Record<string, ViewFilterOperator> = {
    '=': 'equals',
    '==': 'equals',
    '!=': 'not_equals',
    '<>': 'not_equals',
    '>': 'greater_than',
    '<': 'less_than',
    '>=': 'greater_than_or_equal',
    '<=': 'less_than_or_equal',
    'nin': 'not_in',
    'like': 'contains',
};

/** Case- and separator-insensitive key: `not_in`, `notIn`, `'not in'` → `notin`. */
const fold = (op: string) => op.toLowerCase().replace(/[\s_-]+/g, '');

/**
 * Every spelling the spec itself recognises, folded onto its canonical member.
 *
 * Derived from the spec's own canonical list and legacy-alias table rather than
 * restated, so the ~30 aliases `VIEW_FILTER_OPERATOR_ALIASES` still folds — all
 * of them live in stored metadata, because `saveMeta` persists the authored body
 * verbatim — are covered without this file enumerating them. Hand-enumerating
 * spellings is what left `before`/`after` unmapped in the first place.
 */
const FOLDED_TO_CANONICAL: Map<string, ViewFilterOperator> = new Map([
    ...VIEW_FILTER_OPERATORS.map(op => [fold(op), op] as const),
    ...Object.entries(VIEW_FILTER_OPERATOR_ALIASES).map(([alias, op]) => [fold(alias), op] as const),
]);

/**
 * Resolve any stored operator spelling to a FilterBuilder operator id — which,
 * since objectui#9306, is the canonical `VIEW_FILTER_OPERATORS` member itself.
 *
 * Returns the input unchanged when no mapping exists, so an unrecognised
 * operator is visible in the UI rather than silently coerced to `equals`.
 */
export function specToBuilderOperator(op: string): string {
    const raw = String(op ?? '').trim();
    if (!raw) return 'equals';
    return INFIX_TO_CANONICAL[raw.toLowerCase()] ?? FOLDED_TO_CANONICAL.get(fold(raw)) ?? raw;
}

// ---------------------------------------------------------------------------
// Field type normalization: ObjectUI → FilterBuilder
// ---------------------------------------------------------------------------

/**
 * Normalize raw field types to the 5 categories supported by FilterBuilder/SortBuilder.
 * Lookup-like types (lookup, master_detail, user) map to 'select' because
 * FilterBuilder handles them identically when options are provided — the distinction
 * between select and lookup operators is handled within FilterBuilder itself via the
 * original field.type passed through ListView's filterFields.
 *
 * This is a defensive normalizer over an OPEN backend vocabulary, not a
 * consumer of the spec's closed `FieldType`: `picklist`, `money`, `int`,
 * `datetime_tz` and a dozen more spellings here have never been declarable
 * either, and they are deliberate compatibility members. That is the measured
 * reason (comment 5324769751) the retired spelling could not simply be deleted
 * from the list and called dead — it was reachable, and deletion alone would
 * have degraded it to `'text'` in SILENCE.
 *
 * THE GATE (objectui#4914, ruling B) runs ahead of every category test, which
 * answers the boundary question the maintainer settled on record: `owner`
 * arriving through a backend-vocabulary normalizer is an authoring error to
 * refuse loudly, not legitimate foreign input to tolerate. The retired spelling
 * still lands on `'text'` — the answer an unrecognised spelling gets — but the
 * author is handed the migration prescription on the way there.
 */
export function normalizeFieldType(rawType?: string): 'text' | 'number' | 'boolean' | 'date' | 'select' {
    const t = (rawType || '').toLowerCase();
    if (isRetiredFieldType(t)) {
        reportRetiredFieldType(t);
        return 'text';
    }
    if (['integer', 'int', 'float', 'double', 'number', 'currency', 'money', 'percent', 'rating'].includes(t)) return 'number';
    if (['date', 'datetime', 'datetime_tz', 'timestamp', 'time'].includes(t)) return 'date';
    if (['boolean', 'bool', 'checkbox', 'switch'].includes(t)) return 'boolean';
    if (['select', 'picklist', 'single_select', 'multi_select', 'enum', 'status', 'lookup', 'master_detail', 'user'].includes(t)) return 'select';
    return 'text';
}

// ---------------------------------------------------------------------------
// Spec-style filter bridge
// ---------------------------------------------------------------------------

function parseTriplet(arr: any[]): { id: string; field: string; operator: string; value: any } | null {
    if (!Array.isArray(arr) || arr.length < 2) return null;
    const [field, op, value] = arr;
    if (typeof field !== 'string' || typeof op !== 'string') return null;
    return {
        id: crypto.randomUUID(),
        field,
        operator: specToBuilderOperator(op),
        value: value ?? '',
    };
}

function parseSingleOrNested(item: any): Array<{ id: string; field: string; operator: string; value: any }> {
    if (Array.isArray(item)) {
        const triplet = parseTriplet(item);
        return triplet ? [triplet] : [];
    }
    if (typeof item === 'object' && item !== null && item.field) {
        return [{
            id: item.id || crypto.randomUUID(),
            field: item.field,
            operator: specToBuilderOperator(item.operator),
            value: item.value ?? '',
        }];
    }
    return [];
}

export function parseSpecFilter(raw: any): { logic: 'and' | 'or'; conditions: Array<{ id: string; field: string; operator: string; value: any }> } {
    if (!Array.isArray(raw) || raw.length === 0) {
        return { logic: 'and', conditions: [] };
    }

    // Detect ['and', ...conditions] or ['or', ...conditions]
    if (typeof raw[0] === 'string' && (raw[0] === 'and' || raw[0] === 'or')) {
        const logic = raw[0] as 'and' | 'or';
        const rest = raw.slice(1);
        const conditions = rest.flatMap((item: any) => parseSingleOrNested(item));
        return { logic, conditions };
    }

    // Detect single triplet: ['field', '=', value] (all primitives at top level)
    if (raw.length >= 2 && raw.length <= 3 && typeof raw[0] === 'string' && typeof raw[1] === 'string' && !Array.isArray(raw[0])) {
        // Check it's not an array of arrays
        if (!Array.isArray(raw[2])) {
            const cond = parseTriplet(raw);
            return { logic: 'and', conditions: cond ? [cond] : [] };
        }
    }

    // Detect array of conditions: [[...], [...]] or [{...}, {...}]
    if (Array.isArray(raw[0]) || (typeof raw[0] === 'object' && raw[0] !== null && !Array.isArray(raw[0]))) {
        const conditions = raw.flatMap((item: any) => parseSingleOrNested(item));
        return { logic: 'and', conditions };
    }

    // Fallback: try as single triplet
    const cond = parseTriplet(raw);
    return { logic: 'and', conditions: cond ? [cond] : [] };
}

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

/** Parse comma-separated string to trimmed non-empty string array */
export function parseCommaSeparated(input: string): string[] {
    return input.split(',').map(s => s.trim()).filter(Boolean);
}

/** Parse comma-separated string to positive number array */
export function parseNumberList(input: string): number[] {
    return input.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** View type labels for display */
export const VIEW_TYPE_LABELS: Record<string, string> = {
    grid: 'Grid',
    kanban: 'Kanban',
    calendar: 'Calendar',
    gallery: 'Gallery',
    timeline: 'Timeline',
    gantt: 'Gantt',
    map: 'Map',
    chart: 'Chart',
};

/** All available view type keys */
export const VIEW_TYPE_OPTIONS = Object.keys(VIEW_TYPE_LABELS);

/**
 * Row height options with Tailwind gap classes for visual icons.
 * Aligned with @objectstack/spec RowHeight enum — all 5 values.
 */
export const ROW_HEIGHT_OPTIONS: Array<{ value: string; gapClass: string }> = [
    { value: 'compact', gapClass: 'gap-0' },
    { value: 'short', gapClass: 'gap-px' },
    { value: 'medium', gapClass: 'gap-0.5' },
    { value: 'tall', gapClass: 'gap-1' },
    { value: 'extra_tall', gapClass: 'gap-1.5' },
];

// ---------------------------------------------------------------------------
// Field options derivation
// ---------------------------------------------------------------------------

export interface FieldOption {
    value: string;
    label: string;
    type: 'text' | 'number' | 'boolean' | 'date' | 'select';
    options?: any[];
    /** Raw (unnormalized) field type from objectDef. Used by view-type
     *  predicates (isImageLikeField, isGeoLikeField) that need finer signals
     *  than the 5-bucket `type`. Optional for backward-compat. */
    rawType?: string;
    /** Raw field name (same as `value` in current callers but kept distinct
     *  so future callers can carry through display-name heuristics without
     *  affecting persistence keys). */
    rawName?: string;
}

/** Derive field options from an objectDef for FilterBuilder/SortBuilder/Selects */
export function deriveFieldOptions(objectDef: { fields?: Record<string, any> }): FieldOption[] {
    if (!objectDef.fields) return [];
    return Object.entries(objectDef.fields)
        .filter(([key, field]: [string, any]) => {
            if (key.startsWith('_')) return false;
            if (field?.hidden) return false;
            return true;
        })
        .map(([key, field]: [string, any]) => ({
            value: key,
            label: field.label || key,
            type: normalizeFieldType(field.type),
            options: field.options,
            rawType: field.type,
            rawName: key,
        }));
}

/** Convert draft filter → FilterBuilderRowGroup for FilterBuilder */
export function toFilterGroup(draftFilter: any): FilterBuilderRowGroup {
    const parsed = parseSpecFilter(draftFilter);
    // The one place a stored (untyped) draft meets the builder's row type,
    // whose `operator` is `FilterBuilderOperator` rather than `string` since
    // objectui#9306. `specToBuilderOperator` answers a builder id for every
    // spelling the spec or the builder knows. A spelling nothing folds is
    // carried through verbatim ON PURPOSE (see `specToBuilderOperator`): the row
    // stays visible, with a blank operator trigger, instead of being coerced to
    // `equals` — the same way the builder's own read boundary keeps such a row.
    // So the type is ASSERTED over stored data here, not proven; nothing about
    // what this function returns at runtime changed.
    const conditions = parsed.conditions.map((c) => ({ ...c, operator: c.operator as FilterBuilderOperator }));
    return { id: 'root', logic: parsed.logic, conditions };
}

/**
 * Convert draft sort → SortItem[] for SortBuilder.
 *
 * Reads **`order`**, and only `order`. The retired spelling is **`direction`**
 * (objectui#6011): this used to fold `s.order || s.direction || 'asc'`, which
 * accepted two spellings for one key and silently preferred the canonical one.
 * That is the tolerance layer objectui#4869 ruled against — a spelling the sink
 * does not recognise gets ruled into the contract or rejected at the producer,
 * never absorbed here — and objectui#5293 retired the same word on
 * `ObjectViewProps.views[].sort`. A draft entry still spelled
 * `{ field, direction }` now takes the `'asc'` default instead of the direction
 * it asked for.
 *
 * ⛔ Do not re-add the alias. `SortUI`'s own file-local `toSortItems` is a
 * DIFFERENT symbol: it maps `SortEntry[]`, whose `direction` key is
 * type-correct on `SortUISchema`, and it is not this export.
 */
export function toSortItems(draftSort: any): SortItem[] {
    return (Array.isArray(draftSort) ? draftSort : []).map((s: any) => ({
        id: s.id || crypto.randomUUID(),
        field: s.field || '',
        order: (s.order || 'asc') as 'asc' | 'desc',
    }));
}

// ---------------------------------------------------------------------------
// Field-role detection
// ---------------------------------------------------------------------------
//
// These predicates classify object fields by their suitability for specific
// view roles (kanban group-by, gallery image, map latitude, etc.). They are
// used by CreateViewDialog to filter eligible fields and to compute whether a
// view type is at all available for the current object.
//
// Each predicate accepts the *raw* objectDef field (unnormalized) so that we
// can match on richer signals (semantic field type, name conventions) than
// the 5-bucket normalized type.

const IMAGE_FIELD_TYPES = new Set([
    'image', 'image_url', 'photo', 'picture', 'avatar',
    'file', 'attachment', 'attachments', 'media',
    'url', 'link', // URL fields commonly hold image links in CRM datasets
]);

const IMAGE_FIELD_NAME_HINTS = [
    'image', 'photo', 'picture', 'avatar', 'thumbnail', 'thumb',
    'logo', 'cover', 'banner', 'icon', 'attachment',
];

/**
 * True when the field is plausibly an image source for a gallery view.
 * Matches on field type (image/file/url-like) OR field name (avatar/photo/…).
 *
 * Accepts either a raw object-definition field (`{ type, name }`) or a derived
 * `FieldOption` (`{ rawType, rawName, value }`).
 */
export function isImageLikeField(
    field: { type?: string; name?: string; key?: string; rawType?: string; rawName?: string; value?: string } | undefined | null,
): boolean {
    if (!field) return false;
    const type = (field.rawType || field.type || '').toLowerCase();
    if (IMAGE_FIELD_TYPES.has(type)) return true;
    const name = (field.rawName || field.name || field.key || field.value || '').toLowerCase();
    if (!name) return false;
    return IMAGE_FIELD_NAME_HINTS.some((hint) => name.includes(hint));
}

const GEO_FIELD_TYPES = new Set([
    'geolocation', 'geo', 'geo_point', 'geopoint', 'location', 'latlng', 'lnglat',
]);

/**
 * True when the field is plausibly the latitude OR longitude component of a
 * geo coordinate. `axis` selects which one.
 *
 * Matches on:
 *   - dedicated geo types (always considered both axes)
 *   - field name conventions (`lat`, `latitude`, `lng`, `lon`, `longitude`)
 *
 * Accepts either a raw object-definition field or a derived `FieldOption`.
 */
export function isGeoLikeField(
    field: { type?: string; name?: string; key?: string; rawType?: string; rawName?: string; value?: string } | undefined | null,
    axis: 'latitude' | 'longitude',
): boolean {
    if (!field) return false;
    const type = (field.rawType || field.type || '').toLowerCase();
    if (GEO_FIELD_TYPES.has(type)) return true;
    const name = (field.rawName || field.name || field.key || field.value || '').toLowerCase();
    if (!name) return false;
    if (axis === 'latitude') {
        return /(^|[_-])lat([^a-z]|itude)?($|[_-])/.test(name) || name === 'lat';
    }
    return /(^|[_-])(lng|lon|long)([^a-z]|gitude)?($|[_-])/.test(name)
        || name === 'lng' || name === 'lon';
}

/**
 * Pick the first option whose field name matches one of the preferred
 * lowercase substrings. Falls back to the first option, or undefined when
 * the list is empty. Used for "smart default" auto-pick in CreateViewDialog.
 */
export function pickPreferredField(
    options: Array<{ value: string; label?: string }>,
    preferredNames: readonly string[],
): string | undefined {
    if (options.length === 0) return undefined;
    for (const pref of preferredNames) {
        const found = options.find((o) => o.value.toLowerCase().includes(pref));
        if (found) return found.value;
    }
    return options[0]?.value;
}

/** Common preferred names for kanban grouping (status-like fields). */
export const KANBAN_GROUP_PREFERRED: readonly string[] = [
    'status', 'stage', 'state', 'priority', 'category', 'type',
];

/** Common preferred names for primary date fields. */
export const PRIMARY_DATE_PREFERRED: readonly string[] = [
    'start_date', 'startdate', 'due_date', 'duedate',
    'event_date', 'date', 'created_at', 'createdat', 'created',
];

/** Common preferred names for end date fields (gantt). */
export const END_DATE_PREFERRED: readonly string[] = [
    'end_date', 'enddate', 'finish_date', 'completion_date', 'closed_at',
];

/** Common preferred names for human-readable title fields. */
export const TITLE_PREFERRED: readonly string[] = [
    'name', 'title', 'subject', 'label', 'full_name', 'display_name',
];
