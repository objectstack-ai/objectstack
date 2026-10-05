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
 * | **name list** (`string[]`, or object entries where the spec admits them) | the entry is filtered out — an object entry when ANY facet reads the field (a list column's own `field`, its `prefix.field`, its `summary.field`); an emptied list is deleted |
 * | **expression** (CEL / template / filter) | the key is deleted — the caller cannot evaluate it meaningfully (the denied value is stripped from every record it reads), and the platform still evaluates the stored one server-side |
 * | **rule entry** (`validations[i]`, `indexes[i]`, …) | the entry is dropped — a rule over a field the caller cannot read is server policy the caller cannot evaluate, and its text describes the field |
 *
 * A position that names fields of ANOTHER object (`lookupColumns`,
 * `displayField`, `summaryOperations`, …) is kept as is: those names are
 * governed by that object's own projection, and filtering them against THIS
 * object's denied set would delete unrelated columns that merely share a name.
 * The inline master-detail grid (`inlineColumns`, `inlineAmountField`) is NOT
 * such a position: it is declared on the child's own `master_detail` field and
 * names the child's own columns, so it is scrubbed against this object.
 *
 * An action param's `field` under `objectOverride` is the one such position
 * that is still JUDGED rather than kept: it is a field of the object the
 * override names, so it is read against the caller's readable set on THAT
 * object ({@link MaskScope.related}), and the action is dropped when the field
 * is not in it — or when that set could not be determined (fail closed). It is
 * not a reference to this object's fields (see {@link actionParamReadsDenied}).
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
 * mentions `score` when one of its `[A-Za-z_][A-Za-z0-9_]*` tokens IS
 * `score` — so `record.score > 0` and `{score}` do, while `score_band`
 * and `Score` do not. In a classified position an object KEY is a reference
 * only where keys ARE field names — a `FilterCondition` (`relatedListFilter`,
 * a list view's `filter`), a `lifecycle` `onlyWhen` map, an action's `patch`;
 * elsewhere a key is a schema word, so a denied field called `type` or
 * `source` does not cost the caller every rule or every CEL envelope. The
 * unclassified path tests every key.
 *
 * ## Accepted limitations
 *
 * - A string LITERAL equal to a denied name in a classified position — a
 *   `defaultValue`, a filter comparand, a quoted CEL string — reads as a
 *   reference, so the position is deleted (over-masking, never a leak).
 * - A composite identifier (`score_positive`) is one token and is not
 *   matched, even where an author meant it to evoke the field.
 * - A list view or action that reads a denied field anywhere outside its
 *   column lists (a nested `kanban.groupByField`, a sort, a param) is dropped
 *   whole rather than partially rewritten.
 * - An action param whose `name` equals a denied field drops the action,
 *   although a param name is a request-body key rather than a field. It is
 *   kept a reference on purpose: it defaults to the param's `field`, and the
 *   body key it names is commonly the field the action writes. Under
 *   `objectOverride` a `name` that restates `field` is that field — a field of
 *   the other object, judged there; an explicit `name` that differs from
 *   `field` is a body key whose owner nothing here can verify, so it keeps
 *   this reading. So does `field` itself when `defaultFromRow` seeds the
 *   param from THIS object's row, which reads it here too.
 * - A name, pointer or field-keyed key is matched on its root segment as
 *   well as whole, so a dotted path through a denied lookup (`owner.city`
 *   with `owner` denied) is a reference to it.
 * - A `fieldGroups[].key` is a group name, not a field reference — the
 *   readable fields join a group through their own `group: <key>` — so a group
 *   keyed like a denied field is served; dropping it would regroup fields the
 *   caller IS entitled to. A `listViews` key, by contrast, is the view's whole
 *   identity and nothing else points at it, so a view keyed like a denied field
 *   is dropped.
 *
 * Total: a cyclic document terminates (the reference walk guards its path),
 * and every table is finite, so no input overflows the stack by recursion
 * through the tables.
 *
 * Pure and non-mutating: the input is the shared cache's single full copy
 * (ADR-0106 D3), so every changed branch is a fresh object and every unchanged
 * branch is the same reference.
 */

/** A scrubber's answer meaning "delete this key / drop this entry". */
const REMOVE: unique symbol = Symbol('remove');
type Scrubbed = unknown | typeof REMOVE;

/**
 * What a scrub needs beyond THIS object's denied set: the document's own object
 * name, and the caller's readable field set on each OTHER object an action
 * param reads through `objectOverride`. Only the action-param reading consults
 * it; every other scrub ignores it.
 */
export interface MaskScope {
    /** The served document's `name` — an `objectOverride` naming it is this object. */
    readonly objectName?: string;
    /**
     * The caller's readable fields on another object, by name. `undefined`, or
     * an object missing from the map, means the set could not be determined —
     * a param reading that object then drops its action (fail closed).
     */
    readonly related: ReadonlyMap<string, ReadonlySet<string> | undefined>;
}

/** No related object resolved: every `objectOverride` read fails closed. */
const NO_RELATED: MaskScope = { related: new Map() };

type Scrub = (value: unknown, denied: ReadonlySet<string>, scope?: MaskScope) => Scrubbed;

const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/g;

/** Does this string carry a denied name as an identifier token? */
function stringMentions(text: string, denied: ReadonlySet<string>): boolean {
    for (const token of text.match(IDENTIFIER) ?? []) {
        if (denied.has(token)) return true;
    }
    return false;
}

/**
 * Does `name` — a field name, or a dotted path ROOTED at one (`owner.city`) —
 * name a denied field of this object? A path's root segment is this object's
 * field (the rest walks the referenced record), so a path through a denied
 * lookup names the denied field as surely as the bare name does.
 */
function namesDeniedField(name: string, denied: ReadonlySet<string>): boolean {
    return denied.has(name) || denied.has(name.split('.', 1)[0]!);
}

/**
 * Keys whose values are display prose, skipped by {@link mentionsDenied} in
 * `prose: 'skip'` mode. A label or confirmation sentence is not a field
 * reference — a capitalised "Score" never matches anyway, and an English
 * word that happens to equal a field name must not cost a caller a whole
 * list view or action.
 */
const PROSE_KEYS: ReadonlySet<string> = new Set([
    'label', 'pluralLabel', 'description', 'title', 'message', 'helpText', 'inlineHelpText',
    'placeholder', 'confirmText', 'successMessage', 'errorMessage', 'outcomeMessages',
    'relatedListTitle', 'inlineTitle', 'icon',
]);

/**
 * Keys whose values are a closed vocabulary or a non-field namespace — a rule's
 * `type` / `severity` / `events`, an expression envelope's `dialect`, a filter
 * rule's `operator`, a sort's `order`, a state machine's state values, a
 * `format` rule's enum, a `regex` pattern, a `json_schema` rule's JSON Schema.
 * In a CLASSIFIED position their values never name a field of this object, so
 * a denied field that happens to be called `script`, `email` or `cel` must not
 * cost the caller every rule of that kind. Not consulted on the unclassified
 * fail-safe path, nor inside a field-keyed block (where `type` IS a field).
 */
const VOCABULARY_KEYS: ReadonlySet<string> = new Set([
    'type', 'dialect', 'severity', 'events', 'format', 'operator', 'order', 'direction',
    'transitions', 'initialStates', 'regex', 'schema',
]);

/**
 * Keys whose value is a FIELD-KEYED block: a Query-DSL `FilterCondition`
 * (`{ status: { $ne: 'x' }, $and: [...] }`), a `lifecycle.*.onlyWhen` map, an
 * action's `patch` (field → static value). Only there is an object KEY a field
 * reference; everywhere else in a classified position a key is a schema word
 * (`type`, `source`, `name`, …) and is never tested.
 */
const FIELD_KEYED_KEYS: ReadonlySet<string> = new Set(['filter', 'where', 'relatedListFilter', 'onlyWhen', 'patch']);

/** How {@link mentionsDenied} reads object keys. */
export type KeyReading =
    /** Every key is tested — the UNCLASSIFIED fail-safe path, where nothing is known about the shape. */
    | 'all'
    /** Keys are tested only inside a {@link FIELD_KEYED_KEYS} block; {@link VOCABULARY_KEYS} values are skipped. */
    | 'classified'
    /** The value itself is a field-keyed block (`relatedListFilter`, `onlyWhen`). */
    | 'field-keyed';

/**
 * Does `value` reference any denied field?
 *
 * `prose: 'include'` (rule entries) reads everything, because a rule's message
 * describes the field it guards; `prose: 'skip'` (list views, actions) ignores
 * {@link PROSE_KEYS}. `keys` says which object keys are field references —
 * see {@link KeyReading}; the default is the fail-safe `'all'`.
 *
 * Total on any input, cyclic ones included: a value already on the walk's
 * path is not re-entered (its answer is the one being computed above it), so a
 * self-referencing document terminates instead of overflowing the stack. The
 * guard is the current PATH, not every value ever seen, so a sub-object shared
 * by two positions is still read in each position's own key reading.
 */
export function mentionsDenied(
    value: unknown,
    denied: ReadonlySet<string>,
    prose: 'include' | 'skip' = 'include',
    keys: KeyReading = 'all',
): boolean {
    const onPath = new WeakSet<object>();

    const enter = (node: object, read: () => boolean): boolean => {
        if (onPath.has(node)) return false;
        onPath.add(node);
        try {
            return read();
        } finally {
            onPath.delete(node);
        }
    };

    /** A `FilterCondition` / field → value map: non-`$` keys are field names. */
    const fieldKeyed = (node: unknown): boolean => {
        if (typeof node === 'string') return stringMentions(node, denied);
        if (!node || typeof node !== 'object') return false;
        if (Array.isArray(node)) return enter(node, () => node.some(fieldKeyed));
        const rec = node as Record<string, unknown>;
        // A list-view filter RULE (`{ field, operator, value }`) keys on schema
        // words, not field names: its field is the `field` string.
        if (typeof rec.field === 'string') return walk(rec, false);
        return enter(rec, () => Object.entries(rec).some(([key, inner]) => (
            key.startsWith('$')
                ? fieldKeyed(inner) // `$and` / `$or` / `$not` nest conditions; `$gt: 5` is a literal
                : namesDeniedField(key, denied) || walk(inner, false)
        )));
    };

    const walk = (node: unknown, testKeys: boolean): boolean => {
        if (typeof node === 'string') return stringMentions(node, denied);
        if (!node || typeof node !== 'object') return false;
        if (Array.isArray(node)) return enter(node, () => node.some((entry) => walk(entry, testKeys)));
        return enter(node, () => {
            for (const [key, inner] of Object.entries(node as Record<string, unknown>)) {
                if (prose === 'skip' && PROSE_KEYS.has(key)) continue;
                if (testKeys) {
                    if (stringMentions(key, denied) || walk(inner, true)) return true;
                    continue;
                }
                if (VOCABULARY_KEYS.has(key)) continue;
                if (FIELD_KEYED_KEYS.has(key) ? fieldKeyed(inner) : walk(inner, false)) return true;
            }
            return false;
        });
    };

    if (keys === 'all') return walk(value, true);
    if (keys === 'field-keyed') return fieldKeyed(value);
    return walk(value, false);
}

// ── Building blocks ───────────────────────────────────────────────────────────

/** Served as is — the position carries no reference to a field of this object. */
const keep: Scrub = (value) => value;

/** A string naming ONE field of this object. */
const pointer: Scrub = (value, denied) => (typeof value === 'string' && namesDeniedField(value, denied) ? REMOVE : value);

/**
 * A CEL predicate / formula / template, bare or in its `{ dialect, source }`
 * envelope: deleted when a string in it names a denied field. Its object keys
 * are schema words, not field references (see {@link KeyReading}).
 */
const expression: Scrub = (value, denied) => (mentionsDenied(value, denied, 'include', 'classified') ? REMOVE : value);

/** A field-keyed block — a Query-DSL `FilterCondition`, an `onlyWhen` map: its KEYS are field names. */
const fieldKeyed: Scrub = (value, denied) => (mentionsDenied(value, denied, 'include', 'field-keyed') ? REMOVE : value);

/**
 * A key no table classifies, or a classified key holding a value of the wrong
 * shape: nothing is known about it, so every string AND every key is read as a
 * possible reference — the fail-safe path over-masks rather than leaks.
 */
const unclassified: Scrub = (value, denied) => (mentionsDenied(value, denied, 'include', 'all') ? REMOVE : value);

/**
 * Does one object-form name-list entry read a denied field through ANY facet?
 * `table` classifies the entry's keys (its own `field`, and nested same-object
 * pointers such as a list column's `prefix.field` / `summary.field`); a facet
 * whose scrub would change it reads a denied field. A key the table does not
 * classify goes the {@link unclassified} way, so a new nested pointer
 * over-masks until it is classified.
 */
function entryReadsDenied(
    entry: Record<string, unknown>,
    table: Readonly<Record<string, Scrub>>,
    denied: ReadonlySet<string>,
): boolean {
    for (const [key, inner] of Object.entries(entry)) {
        const scrub = Object.prototype.hasOwnProperty.call(table, key) ? table[key]! : unclassified;
        if (scrub(inner, denied) !== inner) return true;
    }
    return false;
}

/**
 * A list of field names of this object; an emptied list is deleted (every such
 * key is optional). A string entry is judged as a name (or a path rooted at
 * one). Where the spec also admits an OBJECT entry (`entryTable` given), the
 * entry is dropped when any of its facets reads a denied field — its own
 * `field` or a nested pointer — because serving the column without that facet
 * would render a different column. An object entry in a strings-only list is
 * the wrong shape and is read fail-safe: any mention drops it.
 */
function nameList(entryTable?: Readonly<Record<string, Scrub>>): Scrub {
    return (value, denied) => {
        if (!Array.isArray(value)) return pointer(value, denied);
        const kept = value.filter((entry) => {
            if (typeof entry === 'string') return !namesDeniedField(entry, denied);
            if (entryTable && entry && typeof entry === 'object' && !Array.isArray(entry)) {
                return !entryReadsDenied(entry as Record<string, unknown>, entryTable, denied);
            }
            return !mentionsDenied(entry, denied, 'include', 'all');
        });
        if (kept.length === value.length) return value;
        return kept.length === 0 ? REMOVE : kept;
    };
}

/** A strings-only list of field names of this object (see {@link nameList}). */
const names: Scrub = nameList();

/** An array whose elements are scrubbed one by one; `REMOVE` drops the element. */
function arrayOf(element: Scrub): Scrub {
    return (value, denied, scope) => {
        if (!Array.isArray(value)) return unclassified(value, denied);
        let changed = false;
        const out: unknown[] = [];
        for (const entry of value) {
            const next = element(entry, denied, scope);
            if (next !== entry) changed = true;
            if (next !== REMOVE) out.push(next);
        }
        if (!changed) return value;
        return out.length === 0 ? REMOVE : out;
    };
}

/**
 * Rule entries: an entry that mentions a denied field ANYWHERE — its pointers,
 * its condition, its message — is dropped whole. Its keys (`type`, `name`,
 * `severity`, …) and its vocabulary values are not references; see
 * {@link VOCABULARY_KEYS}.
 */
const ruleEntries: Scrub = arrayOf((entry, denied) => (mentionsDenied(entry, denied, 'include', 'classified') ? REMOVE : entry));

/** An object block scrubbed key by key; an unclassified key goes the {@link unclassified} way. */
function block(table: Readonly<Record<string, Scrub>>): Scrub {
    return (value, denied, scope) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return unclassified(value, denied);
        return scrubRecord(value as Record<string, unknown>, table, denied, scope);
    };
}

/**
 * A `Record<string, entry>` whose values are scrubbed; `REMOVE` deletes the
 * entry. With `keyIsName`, an entry whose KEY names a denied field is deleted
 * too — for maps keyed by an author-chosen name the caller is shown
 * (`listViews`), where a key spelling a denied field discloses it.
 */
function recordOf(entry: Scrub, keyIsName = false): Scrub {
    return (value, denied, scope) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return unclassified(value, denied);
        let changed = false;
        const out: Record<string, unknown> = {};
        for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
            if (keyIsName && stringMentions(key, denied)) {
                changed = true;
                continue;
            }
            const next = entry(inner, denied, scope);
            if (next !== inner) changed = true;
            if (next !== REMOVE) out[key] = next;
        }
        if (!changed) return value;
        return Object.keys(out).length === 0 ? REMOVE : out;
    };
}

/** Does a presentation entry's `key` read a denied field? */
type EntryRead = (value: unknown, denied: ReadonlySet<string>, scope: MaskScope) => boolean;

/** The default reading of a non-list key: every non-prose mention, as {@link mentionsDenied} reads it. */
const readsAsThisObject = (key: string): EntryRead => (value, denied) => (
    // Read as `{ [key]: value }` so the key's own kind applies: prose and
    // vocabulary keys are skipped, `filter` / `patch` are field-keyed.
    mentionsDenied({ [key]: value }, denied, 'skip', 'classified')
);

/**
 * A presentation entry (list view, action): its column-style name lists are
 * filtered, and any OTHER non-prose mention of a denied field — a filter, a
 * sort, a visibility predicate, a param — drops the entry, because serving it
 * without that part would silently change what it does. `reads` overrides how
 * one key is read; every other key is read as this object's
 * ({@link readsAsThisObject}).
 */
function presentationEntry(
    lists: Readonly<Record<string, Scrub>>,
    reads: Readonly<Record<string, EntryRead>> = {},
): Scrub {
    return (value, denied, scope = NO_RELATED) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return unclassified(value, denied);
        const rec = value as Record<string, unknown>;
        let changed = false;
        const out: Record<string, unknown> = {};
        for (const [key, inner] of Object.entries(rec)) {
            if (Object.prototype.hasOwnProperty.call(lists, key)) {
                const next = lists[key]!(inner, denied, scope);
                if (next !== inner) changed = true;
                if (next !== REMOVE) out[key] = next;
                continue;
            }
            const read = Object.prototype.hasOwnProperty.call(reads, key) ? reads[key]! : readsAsThisObject(key);
            if (read(inner, denied, scope)) return REMOVE;
            out[key] = inner;
        }
        return changed ? out : value;
    };
}

/**
 * [#21884] Does one action param read a field the caller is denied?
 *
 * A param with no `objectOverride` (or one naming this object) is read as every
 * other key of an action is: any non-prose mention of a denied field of THIS
 * object, `field` and `name` included.
 *
 * With `objectOverride` naming ANOTHER object, its `field` is a field of that
 * object. It is judged against the caller's readable set THERE
 * ({@link MaskScope.related}) and is not a reference to this object's fields: a
 * field absent from that set, or a set that could not be determined, drops the
 * action — the ADR-0106 rule, applied to the object the field belongs to. The
 * override's value is an object name, never a field. Everything else on the
 * param is still read against this object — `visible`, `options[].visibleWhen`,
 * `defaultValue`, an explicit `name` that differs from `field` (a body key whose
 * owner cannot be verified here) — and so is `field` (with a `name` restating
 * it) when `defaultFromRow` seeds it from this object's row, which is a second
 * read of a field of this object.
 */
export function actionParamReadsDenied(param: unknown, denied: ReadonlySet<string>, scope: MaskScope): boolean {
    const asThisObject = (value: unknown): boolean => mentionsDenied({ params: [value] }, denied, 'skip', 'classified');
    if (!param || typeof param !== 'object' || Array.isArray(param)) return asThisObject(param);
    const rec = param as Record<string, unknown>;
    const other = rec.objectOverride;
    if (typeof other !== 'string' || other === scope.objectName) return asThisObject(rec);

    const rest: Record<string, unknown> = { ...rec };
    delete rest.objectOverride;
    if (typeof rec.field === 'string') {
        if (!scope.related.get(other)?.has(rec.field)) return true;
        if (rec.defaultFromRow !== true) {
            delete rest.field;
            if (rest.name === rec.field) delete rest.name;
        }
    }
    return asThisObject(rest);
}

/** An action's `params`: the action reads a denied field when any one param does. */
const actionParams: EntryRead = (value, denied, scope) => (
    Array.isArray(value)
        ? value.some((param) => actionParamReadsDenied(param, denied, scope))
        : readsAsThisObject('params')(value, denied, scope)
);

/**
 * [#21884] Every `(object, field)` the document's action params read through an
 * `objectOverride` naming ANOTHER object — the reads {@link actionParamReadsDenied}
 * judges against {@link MaskScope.related}. In document order, duplicates kept.
 */
export function objectOverrideReads(document: unknown): Array<{ object: string; field: string }> {
    if (!document || typeof document !== 'object' || Array.isArray(document)) return [];
    const rec = document as Record<string, unknown>;
    const reads: Array<{ object: string; field: string }> = [];
    if (!Array.isArray(rec.actions)) return reads;
    for (const action of rec.actions) {
        const params = action && typeof action === 'object' ? (action as Record<string, unknown>).params : undefined;
        if (!Array.isArray(params)) continue;
        for (const param of params) {
            if (!param || typeof param !== 'object' || Array.isArray(param)) continue;
            const { objectOverride, field } = param as Record<string, unknown>;
            if (typeof objectOverride === 'string' && objectOverride !== rec.name && typeof field === 'string') {
                reads.push({ object: objectOverride, field });
            }
        }
    }
    return reads;
}

/** Apply `table` to every key of `rec`; same reference when nothing changed. */
function scrubRecord(
    rec: Record<string, unknown>,
    table: Readonly<Record<string, Scrub>>,
    denied: ReadonlySet<string>,
    scope?: MaskScope,
): Record<string, unknown> {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(rec)) {
        const scrub = Object.prototype.hasOwnProperty.call(table, key) ? table[key]! : unclassified;
        const next = scrub(inner, denied, scope);
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
 * [ADR-0106 D1] Every `InlineGridColumnSchema` key, classified. A column's
 * `name` is a field of THIS object (the child the grid edits); its lookup
 * `reference` / `displayField` / `idField` name the referenced object and its
 * fields; its `readonlyWhen` / `requiredWhen` read the row as `record`.
 * Pinned against the live schema shape by `object-schema-fls-references.test.ts`.
 */
export const INLINE_COLUMN_POSITIONS: Readonly<Record<string, Scrub>> = {
    name: keep, label: keep, type: keep, options: keep, prefix: keep, step: keep,
    reference: keep, displayField: keep, idField: keep, multiple: keep, accept: keep,
    defaultHidden: keep, computed: keep, scale: keep, autofill: keep, width: keep, required: keep,
    // Judged by `inlineColumn` before the table runs: a denied one drops the column.
    expr: keep,
    readonlyWhen: expression,
    requiredWhen: expression,
};

/**
 * One inline-grid column: dropped whole when it IS a denied field (`name`) or
 * is computed from one (`expr` — a computed cell recomputed from sibling cells,
 * so serving it without the expression would show a different number). Its
 * other facets are scrubbed by {@link INLINE_COLUMN_POSITIONS}.
 */
const inlineColumn: Scrub = (value, denied) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return unclassified(value, denied);
    const rec = value as Record<string, unknown>;
    if (typeof rec.name === 'string' && namesDeniedField(rec.name, denied)) return REMOVE;
    if (rec.expr !== undefined && mentionsDenied(rec.expr, denied, 'include', 'classified')) return REMOVE;
    return scrubRecord(rec, INLINE_COLUMN_POSITIONS, denied);
};

/**
 * [ADR-0106 D1] The `{ field, param }` form of a `dependsOn` entry. `field` is
 * a sibling field of THIS object; `param` is the remote filter key on the
 * lookup's TARGET object — that object's name, not a reference here.
 */
export const DEPENDS_ON_ENTRY_POSITIONS: Readonly<Record<string, Scrub>> = {
    field: pointer,
    param: keep,
};

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
    // `displayField` / `descriptionField` / `lookupColumns` / `lookupFilters`
    // name fields of the `reference` target (the lookup picker reads them);
    // `summaryOperations` (`field`, `filter`) reads the CHILD object it rolls up.
    displayField: keep, descriptionField: keep, lookupColumns: keep, lookupFilters: keep,
    summaryOperations: keep,
    // A sibling field of THIS object. The inline grid is declared on the
    // child's `master_detail` field and its columns ARE the child's own fields —
    // this object, not the parent the field points at.
    referenceVia: pointer,
    inlineAmountField: pointer,
    inlineColumns: arrayOf(inlineColumn),
    relatedListColumns: names,
    dependsOn: nameList(DEPENDS_ON_ENTRY_POSITIONS),
    // Evaluated against this object's record.
    expression,
    visibleWhen: expression,
    readonlyWhen: expression,
    requiredWhen: expression,
    relatedListFilter: fieldKeyed,
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
        if (typeof rec.field === 'string' && namesDeniedField(rec.field, denied)) return REMOVE;
    }
    return block({ field: pointer, expireAfter: keep, onlyWhen: fieldKeyed })(value, denied);
};

/** `external.columnMap` is remote column → LOCAL field name; an entry mapping onto a denied field goes. */
const columnMap = recordOf(pointer);

/**
 * [ADR-0106 D1] Every `ColumnPrefixSchema` key, classified: `field` is a sibling
 * field of this object rendered before the cell value.
 */
export const COLUMN_PREFIX_POSITIONS: Readonly<Record<string, Scrub>> = { field: pointer, type: keep };

/**
 * [ADR-0106 D1] Every `ColumnSummaryConfigSchema` key, classified: `field` is
 * the field of this object the footer aggregates.
 */
export const COLUMN_SUMMARY_POSITIONS: Readonly<Record<string, Scrub>> = { type: keep, field: pointer };

/** `summary`: the bare aggregation (a closed vocabulary) or `{ type, field }`. */
const columnSummary: Scrub = (value, denied) => (
    typeof value === 'string' ? value : block(COLUMN_SUMMARY_POSITIONS)(value, denied)
);

/**
 * [ADR-0106 D1] Every `ListColumnSchema` key, classified. A column is dropped
 * when any facet reads a denied field — its own `field`, or the nested
 * pointers `prefix.field` / `summary.field` (see {@link nameList}). `action`
 * is a registered action id, `type` a renderer name; neither names a field.
 * Pinned against the live schema shape by `object-schema-fls-references.test.ts`.
 */
export const LIST_COLUMN_POSITIONS: Readonly<Record<string, Scrub>> = {
    field: pointer,
    label: keep, width: keep, align: keep, hidden: keep, sortable: keep, resizable: keep,
    wrap: keep, type: keep, pinned: keep, link: keep, action: keep,
    summary: columnSummary,
    prefix: block(COLUMN_PREFIX_POSITIONS),
};

/** The list-view keys that are column-style lists of this object's field names. */
const LIST_VIEW_NAME_LISTS: Readonly<Record<string, Scrub>> = {
    columns: nameList(LIST_COLUMN_POSITIONS),
    hiddenFields: names,
    fieldOrder: names,
    searchableFields: names,
    filterableFields: names,
};

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
        retention: block({ maxAge: keep, onlyWhen: fieldKeyed }),
        ttl,
    }),
    publicSharing: block({
        enabled: keep, allowedAudiences: keep, allowedPermissions: keep, maxExpiryDays: keep,
        redactFields: names, eligibility: expression,
    }),
    // Presentation entries.
    // A view KEYED by a denied field's name goes too: the key is shown to the caller.
    listViews: recordOf(presentationEntry(LIST_VIEW_NAME_LISTS), true),
    // An action's `params` are read one by one: a param's `field` under
    // `objectOverride` belongs to the object it names (see `actionParamReadsDenied`).
    actions: arrayOf(presentationEntry({}, { params: actionParams })),
    ...PROTECTION_ENVELOPE,
};

/**
 * Remove every reference to a `denied` field from an object document whose
 * `fields` map has ALREADY been projected (so every field left in it is
 * readable). Returns the same reference when nothing referenced a denied field.
 *
 * [#21884] `related` is the caller's readable set on each OTHER object an
 * action param reads through `objectOverride` (see {@link MaskScope.related});
 * a read of an object it does not resolve drops its action. So a document with
 * such a read is walked even when nothing of THIS object is denied.
 */
export function maskDeniedFieldReferences(
    document: Record<string, unknown>,
    denied: ReadonlySet<string>,
    related: MaskScope['related'] = NO_RELATED.related,
): Record<string, unknown> {
    if (denied.size === 0 && objectOverrideReads(document).length === 0) return document;
    const scope: MaskScope = {
        ...(typeof document.name === 'string' ? { objectName: document.name } : {}),
        related,
    };
    const { fields, ...rest } = document;
    const scrubbedRest = scrubRecord(rest, OBJECT_REFERENCE_POSITIONS, denied, scope);

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
