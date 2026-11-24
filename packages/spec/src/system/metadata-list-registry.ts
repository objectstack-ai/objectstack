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
    // ── data ──────────────────────────────────────────────────────────────
    object: defineList({
        schemaId: 'object',
        columns: [NAME, LABEL, { field: 'pluralLabel', label: 'Plural Label' }, { field: 'fields', label: 'Fields', type: 'count' }, DESCRIPTION],
    }),
    field: defineList({
        schemaId: 'field',
        // A field row's `object` is stamped by the server, not a `FieldSchema`
        // key, so the console appends it as its own column.
        columns: [NAME, { field: 'type', label: 'Type', type: 'badge' }, LABEL],
    }),
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
    seed: defineList({
        schemaId: 'seed',
        columns: [{ field: 'object', label: 'Object' }, { field: 'mode', label: 'Mode', type: 'badge' }],
    }),
    mapping: defineList({
        schemaId: 'mapping',
        columns: [
            NAME, LABEL,
            { field: 'targetObject', label: 'Target Object' },
            { field: 'mode', label: 'Mode', type: 'badge' },
            { field: 'sourceFormat', label: 'Source Format', type: 'badge' },
        ],
    }),
    picklist: defineList({
        schemaId: 'picklist',
        columns: [NAME, LABEL, { field: 'options', label: 'Options', type: 'count' }, DESCRIPTION],
    }),

    // ── ui ────────────────────────────────────────────────────────────────
    view: defineList({
        schemaId: 'view',
        columns: [NAME, { field: 'object', label: 'Object' }, { field: 'type', label: 'Type', type: 'badge' }, LABEL],
    }),
    page: defineList({
        schemaId: 'page',
        columns: [NAME, LABEL, { field: 'type', label: 'Type', type: 'badge' }, DESCRIPTION],
    }),
    dashboard: defineList({
        schemaId: 'dashboard',
        columns: [NAME, LABEL, DESCRIPTION],
    }),
    action: defineList({
        schemaId: 'action',
        columns: [NAME, LABEL, { field: 'type', label: 'Type', type: 'badge' }, { field: 'objectName', label: 'Object Name' }, DESCRIPTION],
    }),
    report: defineList({
        schemaId: 'report',
        columns: [NAME, LABEL, { field: 'type', label: 'Type', type: 'badge' }, { field: 'dataset', label: 'Data Source' }, DESCRIPTION],
    }),
    dataset: defineList({
        schemaId: 'dataset',
        columns: [NAME, LABEL, { field: 'object', label: 'Object' }, DESCRIPTION],
    }),

    // ── automation ────────────────────────────────────────────────────────
    flow: defineList({
        schemaId: 'flow',
        columns: [NAME, LABEL, { field: 'type', label: 'Type', type: 'badge' }, DESCRIPTION],
    }),
    job: defineList({
        schemaId: 'job',
        columns: [
            NAME, LABEL,
            { field: 'schedule', label: 'Schedule', type: 'summary' },
            { field: 'enabled', label: 'Enabled', type: 'boolean' },
            DESCRIPTION,
        ],
    }),
    assignment_rule: defineList({
        schemaId: 'assignment_rule',
        columns: [
            NAME, LABEL,
            { field: 'object', label: 'Object' },
            { field: 'entries', label: 'Entries', type: 'count' },
            { field: 'active', label: 'Active', type: 'boolean' },
            DESCRIPTION,
        ],
    }),

    // ── system ────────────────────────────────────────────────────────────
    api: defineList({
        schemaId: 'api',
        columns: [
            NAME,
            { field: 'method', label: 'Method', type: 'badge' },
            { field: 'path', label: 'Path' },
            { field: 'type', label: 'Type', type: 'badge' },
            { field: 'objectParams.object', label: 'Object' },
            { field: 'objectParams.operation', label: 'Operation', type: 'badge' },
        ],
    }),
    translation: defineList({
        schemaId: 'translation',
        columns: [NAME, LABEL, { field: 'locale', label: 'Locale', type: 'badge' }],
    }),
    email_template: defineList({
        schemaId: 'email_template',
        columns: [
            NAME, LABEL,
            { field: 'locale', label: 'Locale', type: 'badge' },
            { field: 'subject', label: 'Subject' },
            { field: 'active', label: 'Active', type: 'boolean' },
            DESCRIPTION,
        ],
    }),
    doc: defineList({
        schemaId: 'doc',
        columns: [NAME, LABEL, { field: 'group', label: 'Group' }, { field: 'tags', label: 'Tags', type: 'list' }, DESCRIPTION],
    }),
    book: defineList({
        schemaId: 'book',
        columns: [NAME, LABEL, { field: 'audience', label: 'Audience' }, { field: 'groups', label: 'Groups', type: 'count' }, DESCRIPTION],
    }),

    // ── security ──────────────────────────────────────────────────────────
    permission: defineList({
        schemaId: 'permission',
        columns: [NAME, LABEL, DESCRIPTION],
    }),
    position: defineList({
        schemaId: 'position',
        columns: [NAME, LABEL, DESCRIPTION],
    }),
    sharing_rule: defineList({
        schemaId: 'sharing_rule',
        columns: [
            NAME, LABEL,
            { field: 'object', label: 'Object' },
            { field: 'sharedWith', label: 'Shared With', type: 'summary' },
            { field: 'accessLevel', label: 'Access Level', type: 'badge' },
        ],
    }),
    queue: defineList({
        schemaId: 'queue',
        columns: [NAME, LABEL, { field: 'members', label: 'Members', type: 'count' }, DESCRIPTION],
    }),

    // ── ai ────────────────────────────────────────────────────────────────
    agent: defineList({
        schemaId: 'agent',
        columns: [
            NAME, LABEL,
            { field: 'role', label: 'Role' },
            { field: 'model.model', label: 'Model' },
            { field: 'active', label: 'Active', type: 'boolean' },
        ],
    }),
    tool: defineList({
        schemaId: 'tool',
        columns: [NAME, LABEL, { field: 'objectName', label: 'Object Name' }, DESCRIPTION],
    }),
    skill: defineList({
        schemaId: 'skill',
        columns: [
            NAME, LABEL,
            { field: 'tools', label: 'Tools', type: 'count' },
            { field: 'active', label: 'Active', type: 'boolean' },
            DESCRIPTION,
        ],
    }),
});

/** Union of metadata type keys with a registered list layout. */
export type MetadataListType = keyof typeof METADATA_LIST_REGISTRY;
