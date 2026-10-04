// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0106 D1] The second half of "remove an unreadable field WHOLE": the
 * field's REFERENCES elsewhere in the served object document.
 *
 * {@link applyObjectSchemaMask} deletes a denied field's entry from `fields`.
 * That alone is not D1's promise — "a field the caller cannot read does not
 * exist for that caller, on any plane" — because an object schema names its
 * fields in many more places than the `fields` map: object-level rule entries
 * (`validations`, `indexes`, `activityMilestones`), role pointers
 * (`nameField`, `stageField`, …), name lists (`highlightFields`, …),
 * expressions (`titleFormat`, field-group `visibleWhen`, …), and the
 * definitions of the fields that STAY (`relatedListColumns`, `dependsOn`, the
 * formula `expression`, `visibleWhen` / `readonlyWhen` / `requiredWhen`, …).
 * This module removes those references, for the one caller being served.
 *
 * ## The four dispositions
 *
 * Every position is classified once, in the two tables below, by what a
 * reference there MEANS — so the disposition is the one that keeps the served
 * document truthful for a caller who cannot see the field:
 *
 * | Position kind | What a reference to a denied field does |
 * |---|---|
 * | **pointer** (a string naming one field) | the key is deleted — the role falls back to its default, derived from the fields the caller IS served |
 * | **name list** (`string[]`, or `{ field }` entries) | the entry is filtered out; an emptied list is deleted |
 * | **expression** (CEL / template / filter) | the key is deleted — the caller cannot evaluate it meaningfully (the denied value is stripped from every record it reads), and the platform still evaluates the stored one server-side |
 * | **rule entry** (`validations[i]`, `indexes[i]`, …) | the entry is dropped — a rule over a field the caller cannot read is server policy the caller cannot evaluate, and its text describes the field |
 *
 * A position that names fields of ANOTHER object (`lookupColumns`,
 * `displayField`, `summaryOperations`, …) is `foreign`: those names are
 * governed by that object's own projection, and filtering them against THIS
 * object's denied set would delete unrelated columns that merely share a name.
 *
 * ## Fail-safe by construction
 *
 * A key neither table classifies is treated as an expression: it is served
 * unless it mentions a denied name, and deleted if it does. A new spec key
 * therefore over-masks rather than leaks until it is classified, and
 * `object-schema-fls-references.test.ts` pins both tables against the live
 * `ObjectSchema` / `FieldSchema` shapes so a new key is classified on the day
 * it lands.
 *
 * "Mentions" is an identifier-token test, not a substring test: a string
 * mentions `budget` when one of its `[A-Za-z_][A-Za-z0-9_]*` tokens IS
 * `budget` — so `record.budget > 0` and `{budget}` do, while `budget_code`
 * and `Budget` do not. Object keys are tested the same way (a filter
 * condition keys on the field name).
 *
 * Pure and non-mutating: the input is the shared cache's single full copy
 * (ADR-0106 D3), so every changed branch is a fresh object and every unchanged
 * branch is the same reference.
 */

/** A scrubber's answer meaning "delete this key / drop this entry". */
const REMOVE: unique symbol = Symbol('remove');
type Scrubbed = unknown | typeof REMOVE;
type Scrub = (value: unknown, denied: ReadonlySet<string>) => Scrubbed;

const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/g;

/** Does this string carry a denied name as an identifier token? */
function stringMentions(text: string, denied: ReadonlySet<string>): boolean {
    for (const token of text.match(IDENTIFIER) ?? []) {
        if (denied.has(token)) return true;
    }
    return false;
}

/**
 * Keys whose values are display prose, skipped by {@link mentionsDenied} in
 * `prose: 'skip'` mode. A label or confirmation sentence is not a field
 * reference — a capitalised "Budget" never matches anyway, and an English
 * word that happens to equal a field name must not cost a caller a whole
 * list view or action.
 */
const PROSE_KEYS: ReadonlySet<string> = new Set([
    'label', 'pluralLabel', 'description', 'title', 'message', 'helpText', 'inlineHelpText',
    'placeholder', 'confirmText', 'successMessage', 'errorMessage', 'outcomeMessages',
    'relatedListTitle', 'inlineTitle', 'icon',
]);

/**
 * Does `value` reference any denied field — in any string leaf or object key?
 *
 * `prose: 'include'` (rule entries) reads everything, because a rule's message
 * describes the field it guards; `prose: 'skip'` (list views, actions) ignores
 * {@link PROSE_KEYS}.
 */
export function mentionsDenied(
    value: unknown,
    denied: ReadonlySet<string>,
    prose: 'include' | 'skip' = 'include',
): boolean {
    if (typeof value === 'string') return stringMentions(value, denied);
    if (Array.isArray(value)) return value.some((entry) => mentionsDenied(entry, denied, prose));
    if (value && typeof value === 'object') {
        for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
            if (prose === 'skip' && PROSE_KEYS.has(key)) continue;
            if (stringMentions(key, denied)) return true;
            if (mentionsDenied(inner, denied, prose)) return true;
        }
    }
    return false;
}

// ── Building blocks ───────────────────────────────────────────────────────────

/** Served as is — the position carries no reference to a field of this object. */
const keep: Scrub = (value) => value;

/** A string naming ONE field of this object. */
const pointer: Scrub = (value, denied) => (typeof value === 'string' && denied.has(value) ? REMOVE : value);

/** A CEL predicate / formula / template / filter condition. */
const expression: Scrub = (value, denied) => (mentionsDenied(value, denied) ? REMOVE : value);

/** The field a name-list entry names: a bare string, or `{ field }` / `{ name }`. */
function entryFieldName(entry: unknown): string | undefined {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const rec = entry as Record<string, unknown>;
        if (typeof rec.field === 'string') return rec.field;
        if (typeof rec.name === 'string') return rec.name;
    }
    return undefined;
}

/** A list of field names of this object; an emptied list is deleted (every such key is optional). */
const names: Scrub = (value, denied) => {
    if (!Array.isArray(value)) return pointer(value, denied);
    const kept = value.filter((entry) => {
        const name = entryFieldName(entry);
        return name === undefined || !denied.has(name);
    });
    if (kept.length === value.length) return value;
    return kept.length === 0 ? REMOVE : kept;
};

/** An array whose elements are scrubbed one by one; `REMOVE` drops the element. */
function arrayOf(element: Scrub): Scrub {
    return (value, denied) => {
        if (!Array.isArray(value)) return expression(value, denied);
        let changed = false;
        const out: unknown[] = [];
        for (const entry of value) {
            const next = element(entry, denied);
            if (next !== entry) changed = true;
            if (next !== REMOVE) out.push(next);
        }
        if (!changed) return value;
        return out.length === 0 ? REMOVE : out;
    };
}

/**
 * Rule entries: an entry that mentions a denied field ANYWHERE — its pointers,
 * its condition, its message — is dropped whole.
 */
const ruleEntries: Scrub = arrayOf((entry, denied) => (mentionsDenied(entry, denied, 'include') ? REMOVE : entry));

/** An object block scrubbed key by key; an unclassified key is an {@link expression}. */
function block(table: Readonly<Record<string, Scrub>>): Scrub {
    return (value, denied) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return expression(value, denied);
        return scrubRecord(value as Record<string, unknown>, table, denied);
    };
}

/** A `Record<string, entry>` whose values are scrubbed; `REMOVE` deletes the entry. */
function recordOf(entry: Scrub): Scrub {
    return (value, denied) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return expression(value, denied);
        let changed = false;
        const out: Record<string, unknown> = {};
        for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
            const next = entry(inner, denied);
            if (next !== inner) changed = true;
            if (next !== REMOVE) out[key] = next;
        }
        if (!changed) return value;
        return Object.keys(out).length === 0 ? REMOVE : out;
    };
}

/**
 * A presentation entry (list view, action): its column-style name lists are
 * filtered, and any OTHER non-prose mention of a denied field — a filter, a
 * sort, a visibility predicate, a param — drops the entry, because serving it
 * without that part would silently change what it does.
 */
function presentationEntry(listKeys: readonly string[]): Scrub {
    return (value, denied) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return expression(value, denied);
        const rec = value as Record<string, unknown>;
        let changed = false;
        const out: Record<string, unknown> = {};
        for (const [key, inner] of Object.entries(rec)) {
            if (listKeys.includes(key)) {
                const next = names(inner, denied);
                if (next !== inner) changed = true;
                if (next !== REMOVE) out[key] = next;
                continue;
            }
            if (!PROSE_KEYS.has(key) && (stringMentions(key, denied) || mentionsDenied(inner, denied, 'skip'))) {
                return REMOVE;
            }
            out[key] = inner;
        }
        return changed ? out : value;
    };
}

/** Apply `table` to every key of `rec`; same reference when nothing changed. */
function scrubRecord(
    rec: Record<string, unknown>,
    table: Readonly<Record<string, Scrub>>,
    denied: ReadonlySet<string>,
): Record<string, unknown> {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(rec)) {
        const scrub = Object.prototype.hasOwnProperty.call(table, key) ? table[key]! : expression;
        const next = scrub(inner, denied);
        if (next !== inner) changed = true;
        if (next !== REMOVE) out[key] = next;
    }
    return changed ? out : rec;
}

// ── The ADR-0010 protection envelope — present on objects and fields alike ───

const PROTECTION_ENVELOPE: Readonly<Record<string, Scrub>> = {
    _lock: keep, _lockReason: keep, _lockSource: keep, _provenance: keep,
    _packageId: keep, _packageVersion: keep, _lockDocsUrl: keep,
};

// ── Field level: the definition of a field the caller IS served ──────────────

/** A select option: its own `visibleWhen` is a predicate over sibling fields. */
const option = block({ label: keep, value: keep, description: keep, color: keep, default: keep, visibleWhen: expression, icon: keep });

/**
 * [ADR-0106 D1] Every `FieldSchema` key, classified. Pinned against the live
 * schema shape by `object-schema-fls-references.test.ts`.
 */
export const FIELD_REFERENCE_POSITIONS: Readonly<Record<string, Scrub>> = {
    // Identity, type and value-shape facets of the field itself.
    name: keep, label: keep, type: keep, description: keep, format: keep, required: keep,
    storage: keep, searchable: keep, multiple: keep, unique: keep, maxLength: keep,
    minLength: keep, valueDomain: keep, rows: keep, precision: keep, scale: keep, min: keep,
    max: keep, useGrouping: keep, accept: keep, maxSize: keep, picklist: keep, reference: keep,
    deleteBehavior: keep, inlineEdit: keep, inlineTitle: keep, relatedList: keep,
    relatedListTitle: keep, lookupPageSize: keep, allowCreate: keep, returnType: keep,
    language: keep, step: keep, currencyConfig: keep, dimensions: keep, trackHistory: keep,
    group: keep, widget: keep, hidden: keep, internal: keep, readonly: keep,
    requiredPermissions: keep, maskingRule: keep, ackPlaintextMasking: keep, system: keep,
    sortable: keep, inlineHelpText: keep, placeholder: keep, externalId: keep,
    conditionalRequired: keep,
    // Names of ANOTHER object's fields — that object's projection governs them.
    inlineColumns: keep, inlineAmountField: keep, displayField: keep, descriptionField: keep,
    lookupColumns: keep, lookupFilters: keep, summaryOperations: keep,
    // A sibling field of THIS object.
    referenceVia: pointer,
    relatedListColumns: names,
    dependsOn: names,
    // Evaluated against this object's record.
    expression,
    visibleWhen: expression,
    readonlyWhen: expression,
    requiredWhen: expression,
    relatedListFilter: expression,
    defaultValue: expression,
    autonumberFormat: expression,
    options: arrayOf(option),
    ...PROTECTION_ENVELOPE,
};

const readableField = block(FIELD_REFERENCE_POSITIONS);

// ── Object level ──────────────────────────────────────────────────────────────

/** A row-CRUD override flag: `boolean`, or `{ enabled, visibleWhen, disabledWhen }`. */
const crudFlag: Scrub = (value, denied) => (
    value && typeof value === 'object' && !Array.isArray(value)
        ? block({ enabled: keep, visibleWhen: expression, disabledWhen: expression })(value, denied)
        : value
);

/** `lifecycle.ttl` measures from ONE field; a denied one leaves no ttl the caller can be told about. */
const ttl: Scrub = (value, denied) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const rec = value as Record<string, unknown>;
        if (typeof rec.field === 'string' && denied.has(rec.field)) return REMOVE;
    }
    return block({ field: pointer, expireAfter: keep, onlyWhen: expression })(value, denied);
};

/** `external.columnMap` is remote column → LOCAL field name; an entry mapping onto a denied field goes. */
const columnMap = recordOf(pointer);

/** The list-view keys that are column-style lists of this object's field names. */
const LIST_VIEW_NAME_LISTS = ['columns', 'hiddenFields', 'fieldOrder', 'searchableFields', 'filterableFields'] as const;

/**
 * [ADR-0106 D1] Every top-level `ObjectSchema` key, classified. `fields` is
 * absent on purpose — {@link maskDeniedFieldReferences} owns it. Pinned against
 * the live schema shape by `object-schema-fls-references.test.ts`.
 */
export const OBJECT_REFERENCE_POSITIONS: Readonly<Record<string, Scrub>> = {
    // Identity and posture — no field names.
    name: keep, label: keep, pluralLabel: keep, description: keep, icon: keep, isSystem: keep,
    managedBy: keep, ownership: keep, systemFields: keep, datasource: keep, access: keep,
    requiredPermissions: keep, fileAccessDelegate: keep, editMode: keep, enable: keep,
    sharingModel: keep, externalSharingModel: keep, protection: keep,
    // Role pointers.
    nameField: pointer,
    displayNameField: pointer,
    imageField: pointer,
    stageField: pointer,
    // Name lists.
    highlightFields: names,
    searchableFields: names,
    // Expressions.
    titleFormat: expression,
    // Rule entries — dropped whole when they mention a denied field.
    validations: ruleEntries,
    indexes: ruleEntries,
    activityMilestones: ruleEntries,
    // Blocks.
    userActions: block({ create: crudFlag, import: crudFlag, edit: crudFlag, delete: crudFlag, exportCsv: keep }),
    external: block({
        remoteName: keep, remoteSchema: keep, writable: keep, introspectedAt: keep, ignoreColumns: keep,
        columnMap,
    }),
    fieldGroups: arrayOf(block({
        key: keep, label: keep, icon: keep, description: keep, collapse: keep,
        defaultExpanded: keep, collapsible: keep, collapsed: keep, visibleWhen: expression,
    })),
    tenancy: block({ enabled: keep, tenantField: pointer }),
    lifecycle: block({
        class: keep, storage: keep, archive: keep, reclaim: keep,
        retention: block({ maxAge: keep, onlyWhen: expression }),
        ttl,
    }),
    publicSharing: block({
        enabled: keep, allowedAudiences: keep, allowedPermissions: keep, maxExpiryDays: keep,
        redactFields: names, eligibility: expression,
    }),
    // Presentation entries.
    listViews: recordOf(presentationEntry(LIST_VIEW_NAME_LISTS)),
    actions: arrayOf(presentationEntry([])),
    ...PROTECTION_ENVELOPE,
};

/**
 * Remove every reference to a `denied` field from an object document whose
 * `fields` map has ALREADY been projected (so every field left in it is
 * readable). Returns the same reference when nothing referenced a denied field.
 */
export function maskDeniedFieldReferences(
    document: Record<string, unknown>,
    denied: ReadonlySet<string>,
): Record<string, unknown> {
    if (denied.size === 0) return document;
    const { fields, ...rest } = document;
    const scrubbedRest = scrubRecord(rest, OBJECT_REFERENCE_POSITIONS, denied);

    let scrubbedFields = fields;
    if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
        const scrubbed = recordOf(readableField)(fields, denied);
        // A field definition is never REMOVEd by its own scrub (only keys inside
        // it are), so the map keeps exactly the projected field set.
        scrubbedFields = scrubbed === REMOVE ? {} : scrubbed;
    }

    if (scrubbedRest === rest && scrubbedFields === fields) return document;
    // Rebuilt in the document's own key order, so a masked body differs from
    // the full one only where a reference was removed.
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(document)) {
        if (key === 'fields') out.fields = scrubbedFields;
        else if (Object.prototype.hasOwnProperty.call(scrubbedRest, key)) out[key] = scrubbedRest[key];
    }
    return out;
}
