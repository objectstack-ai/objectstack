// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Canonical registry of the Studio list layout of each metadata type: which
 * columns the "All metadata" list of a type shows. The list counterpart of
 * {@link METADATA_FORM_REGISTRY}, and consumed the same way:
 *
 * - `getMetaTypes()` in `@objectstack/metadata-protocol` serves each entry as
 *   `list` on the type's `/meta/types` row, beside `form`, so Studio, the CLI
 *   and AI clients read one declaration;
 * - the REST `/meta/types` handler translates each column header through the
 *   type's form field slot, `metadataForms.<type>.fields.<field>.label`, so a
 *   column and the form field of the same key read the same words;
 * - `os i18n extract` emits that slot for every column whose path the type's
 *   form does not already declare.
 *
 * Every column names a key of the type's own schema (or a dotted path into it).
 * `metadata-list-zod-reconciliation.test.ts` refuses a column naming a key the
 * schema does not declare, and a header that differs from the form field label
 * of the same path (one translation slot, one English source).
 *
 * A type with no entry here gets the Studio default list (name, label,
 * description).
 *
 * @see METADATA_FORM_REGISTRY — the form layouts this registry sits beside
 */

import { defineList, type MetadataListViewParsed } from '../ui/view.zod';

const NAME = { field: 'name', label: 'Name' } as const;
const LABEL = { field: 'label', label: 'Label' } as const;
const DESCRIPTION = { field: 'description', label: 'Description' } as const;

/**
 * Frozen map of metadata type → canonical list layout.
 *
 * @example
 * <!-- os:check -->
 * ```ts
 * import { METADATA_LIST_REGISTRY } from '@objectstack/spec/system';
 *
 * for (const [type, list] of Object.entries(METADATA_LIST_REGISTRY)) {
 *   console.log(type, list.columns.map((c) => c.field).join(', '));
 * }
 * ```
 */
export const METADATA_LIST_REGISTRY: Readonly<Record<string, MetadataListViewParsed>> = Object.freeze({
    // ── logic ─────────────────────────────────────────────────────────────
    hook: defineList({
        schemaId: 'hook',
        columns: [
            NAME, LABEL,
            { field: 'object', label: 'Object', type: 'list' },
            { field: 'events', label: 'Events', type: 'list' },
            { field: 'priority', label: 'Priority' },
            { field: 'async', label: 'Async', type: 'boolean' },
            DESCRIPTION,
        ],
    }),
});

/** Union of metadata type keys with a registered list layout. */
export type MetadataListType = keyof typeof METADATA_LIST_REGISTRY;
