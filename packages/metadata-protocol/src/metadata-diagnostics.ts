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

import { createHash } from 'node:crypto';
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
// [#26707] The snapshot key a write type's findings are spelled under — the
// runtime gate's own answer, so the publish verdict below is re-spelled
// against the same prefix the gate wrote it with.
import { stackKeyForType } from '@objectstack/lint/runtime';
import type { RuntimeAuthoringIssue } from '@objectstack/spec/api';

/**
 * Re-export the canonical validation-result type so callers in this
 * package don't need to dual-import from `@objectstack/spec/kernel`.
 */
export type MetadataDiagnostics = MetadataValidationResult;

// ---------------------------------------------------------------------------
// [#25783] The verdict memo
// ---------------------------------------------------------------------------
//
// Every served metadata read decorates every item it answers, and the
// decoration is a full `safeParse` of the item's type schema: measured at
// 60 ms of an 86 ms `GET /meta/object` over 108 objects, re-run on every
// read although the documents had not changed. So a verdict is remembered by
// WHAT WAS PARSED, never by where the document came from:
//
//  - **The schema object.** One memo per schema, held weakly, so a
//    `registerMetadataTypeSchema()` replacement starts from nothing and the
//    verdicts of a schema nobody holds any more are collected with it.
//  - **The document's content.** A SHA-256 of an encoding that tells apart
//    everything the parse can tell apart. A plain JSON document (the stored
//    rows, every HTTP body) is its `JSON.stringify`; one that holds
//    `undefined` — a strict schema refuses an undeclared key whose value is
//    `undefined`, and `JSON.stringify` drops that key — is spelled by
//    {@link encodeWithUndefined}. A document holding anything else (a
//    function, a class instance, a non-finite number, `-0`, a nesting
//    deeper than {@link KEYABLE_DEPTH}) has no faithful key and is parsed
//    every time, as before.
//
// Nothing else is an input: a schema's refinements read only the document
// and the spec's own constants (the node-config contract maps are fixed at
// first build), and no code path installs a global zod error map.
//
// ⛔ Not a cache of any read's ANSWER. The overlay cache's position in
// `readActiveOverlayRows` explains why a merged answer is never cached; this
// memo sits below every merge, on a pure function of its own input, so a
// metadata change is a different document and a different key.
//
// The cached verdict never leaves this module: each caller gets its own copy
// ({@link copyDiagnostics}), so a caller that edits the verdict it was handed
// edits nobody else's. Bounded per schema ({@link VERDICTS_PER_SCHEMA},
// least-recently-used first out); an evicted verdict is recomputed, never
// served stale.

/** How many verdicts one schema keeps before the least recently used goes. */
const VERDICTS_PER_SCHEMA = 4096;
/** Nesting past this depth is not keyed (a cycle would otherwise never end). */
const KEYABLE_DEPTH = 256;

const VERDICTS_BY_SCHEMA = new WeakMap<object, Map<string, MetadataDiagnostics>>();

/** `json`: `JSON.stringify` is faithful · `undefined`: faithful once `undefined` is spelled · `none`: no key. */
type KeyableShape = 'json' | 'undefined' | 'none';

function keyableShape(value: unknown, depth: number): KeyableShape {
    if (value === null) return 'json';
    switch (typeof value) {
        case 'string':
        case 'boolean':
            return 'json';
        case 'number':
            return Number.isFinite(value) && !Object.is(value, -0) ? 'json' : 'none';
        case 'undefined':
            return 'undefined';
        case 'object':
            break;
        default:
            return 'none';
    }
    if (depth >= KEYABLE_DEPTH) return 'none';
    let shape: KeyableShape = 'json';
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            const inner = keyableShape(value[i], depth + 1);
            if (inner === 'none') return 'none';
            if (inner === 'undefined') shape = 'undefined';
        }
        return shape;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return 'none';
    for (const key in value as Record<string, unknown>) {
        const inner = keyableShape((value as Record<string, unknown>)[key], depth + 1);
        if (inner === 'none') return 'none';
        if (inner === 'undefined') shape = 'undefined';
    }
    return shape;
}

/**
 * The encoding of a document {@link keyableShape} answered `undefined` for:
 * JSON's, with `undefined` spelled `u` wherever it stands, an array hole
 * included (the parse reads a hole as `undefined`).
 */
function encodeWithUndefined(value: unknown): string {
    if (value === undefined) return 'u';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
        let out = '[';
        for (let i = 0; i < value.length; i++) out += (i ? ',' : '') + encodeWithUndefined(value[i]);
        return out + ']';
    }
    let out = '{';
    let first = true;
    for (const key in value as Record<string, unknown>) {
        out += (first ? '' : ',') + JSON.stringify(key) + ':' + encodeWithUndefined((value as Record<string, unknown>)[key]);
        first = false;
    }
    return out + '}';
}

/** The memo key of a document, or `undefined` when it has no faithful one. */
function contentKey(document: unknown): string | undefined {
    const shape = keyableShape(document, 0);
    if (shape === 'none') return undefined;
    // The two encodings are told apart by their first character, so no
    // document's JSON can be another document's `undefined` spelling.
    const encoded = shape === 'json' ? `j${JSON.stringify(document)}` : `u${encodeWithUndefined(document)}`;
    return createHash('sha256').update(encoded).digest('base64');
}

/**
 * A caller's own copy of a verdict, key for key and in the same order: its
 * lists are flat lists of flat entries, so copying each entry copies it all.
 */
function copyDiagnostics(verdict: MetadataDiagnostics): MetadataDiagnostics {
    const copy: MetadataDiagnostics = { ...verdict };
    if (verdict.errors) copy.errors = verdict.errors.map((entry) => ({ ...entry }));
    if (verdict.warnings) copy.warnings = verdict.warnings.map((entry) => ({ ...entry }));
    return copy;
}

// ---------------------------------------------------------------------------
// [#26886] Options the runtime resolved from a shared picklist
// ---------------------------------------------------------------------------
//
// A field authors `picklist: '<name>'` and no `options`; every object read
// serves it with the list's options written beside `picklist` (the registry's
// picklist resolution, `PicklistServedFieldSchema`). Diagnostics judge what the
// author wrote, so the field schema's rule that refuses `picklist` and
// `options` together must not read the copy the runtime wrote: it flagged
// every picklist-bound field of every app.
//
// The resolution therefore MARKS the options array it derived
// ({@link markResolvedPicklistOptions}), and only a marked array is left out
// here. A field that authored its own `options` beside `picklist` arrives
// unmarked and is still flagged, with the same message and severity. The mark
// is a non-enumerable property, so no response, stored row or memo key ever
// carries it, and it is keyed with `Symbol.for` so every loaded copy of this
// package reads the one mark. A copy of the array (`.map`, a JSON round trip)
// drops it, and the field is then judged with its `options`: the failure
// direction is the old false error, never a missed one.

const RESOLVED_PICKLIST_OPTIONS = Symbol.for('@objectstack/metadata-protocol:resolved-picklist-options');

/**
 * Mark an `options` array as resolved from a shared picklist rather than
 * authored on the field. Returns the same array.
 */
export function markResolvedPicklistOptions<T extends object>(options: T): T {
    if (!Object.prototype.hasOwnProperty.call(options, RESOLVED_PICKLIST_OPTIONS)) {
        Object.defineProperty(options, RESOLVED_PICKLIST_OPTIONS, { value: true });
    }
    return options;
}

/** `true` when `options` is an array {@link markResolvedPicklistOptions} marked. */
export function isResolvedPicklistOptions(options: unknown): boolean {
    return Array.isArray(options)
        && (options as unknown as Record<symbol, unknown>)[RESOLVED_PICKLIST_OPTIONS] === true;
}

function withoutResolvedOptions(field: unknown): unknown {
    if (!field || typeof field !== 'object') return field;
    const { picklist, options } = field as { picklist?: unknown; options?: unknown };
    if (typeof picklist !== 'string' || !isResolvedPicklistOptions(options)) return field;
    const { options: _resolved, ...authored } = field as Record<string, unknown>;
    return authored;
}

/**
 * A document with the resolved `options` left out of every picklist-bound
 * field of its name-keyed `fields` (the only spelling the object schema
 * accepts). By reference when no field carries resolved options.
 */
function withoutResolvedPicklistOptions(document: unknown): unknown {
    if (!document || typeof document !== 'object') return document;
    const fields = (document as { fields?: unknown }).fields;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return document;
    let next: Record<string, unknown> | undefined;
    for (const [name, field] of Object.entries(fields as Record<string, unknown>)) {
        const judged = withoutResolvedOptions(field);
        if (judged === field) continue;
        next ??= { ...(fields as Record<string, unknown>) };
        next[name] = judged;
    }
    return next ? { ...(document as object), fields: next } : document;
}

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
    // [#26886] …and judge each picklist-bound field as its author wrote it:
    // the `options` the runtime resolved onto it are not part of that shape
    // ({@link withoutResolvedPicklistOptions}).
    const candidate = withoutResolvedPicklistOptions(stripReadDecorations(item));

    // [#25783] A document parsed before against this same schema is answered
    // from the memo — see "The verdict memo" above.
    const key = contentKey(candidate);
    if (key === undefined) return parseDiagnostics(schema, candidate);
    let verdicts = VERDICTS_BY_SCHEMA.get(schema);
    if (!verdicts) VERDICTS_BY_SCHEMA.set(schema, (verdicts = new Map()));
    let verdict = verdicts.get(key);
    if (verdict) {
        verdicts.delete(key);
    } else {
        verdict = parseDiagnostics(schema, candidate);
        if (verdicts.size >= VERDICTS_PER_SCHEMA) verdicts.delete(verdicts.keys().next().value as string);
    }
    verdicts.set(key, verdict);
    return copyDiagnostics(verdict);
}

/** The parse {@link computeMetadataDiagnostics} answers with, uncached. */
function parseDiagnostics(schema: z.ZodType, candidate: unknown): MetadataDiagnostics {
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
// [#26707] The publish verdict on a draft's `_diagnostics`
// ---------------------------------------------------------------------------

/**
 * A runtime-gate finding's path, re-spelled relative to the item it was found
 * on: the gate spells it inside its private per-write snapshot
 * (`flows[0].edges[1].condition`, `objects.invoice.fields.total`), and
 * `_diagnostics` paths are dotted and item-relative (`edges.1.condition`), the
 * spelling Studio's inline errors and canvas badges resolve. A path that does
 * not start at the written item (a finding located on a sibling, or a `where`-
 * style locator) is kept as the gate wrote it.
 */
function itemRelativeIssuePath(type: string, name: string, path: string): string {
    const stackKey = stackKeyForType(PLURAL_TO_SINGULAR[type] ?? type);
    if (!stackKey) return path;
    let rest: string | undefined;
    for (const prefix of [`${stackKey}[0]`, `${stackKey}.${name}`]) {
        if (path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`)) {
            rest = path.slice(prefix.length);
            break;
        }
    }
    if (rest === undefined) return path;
    return rest.replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '');
}

/**
 * Fold what publishing a draft would refuse into the draft's `_diagnostics`.
 *
 * `issues` are the runtime authoring gate's refusal for the draft body —
 * `ObjectStackProtocolImplementation#draftPublishVerdict`, the judgement the
 * publish door enforces — and each becomes one `errors[]` entry carrying the
 * publish's own `message`, with its `rule` id as the entry's `code`. Any of
 * them makes the verdict `valid: false`: the draft is still stored, but it does
 * not say it is valid while the publish says it is not. No issues: the schema
 * verdict is returned as it was. A type with no schema verdict (`undefined`)
 * gets one only when there is something to report.
 */
export function withPublishVerdict(
    type: string,
    name: string,
    diagnostics: MetadataDiagnostics | undefined,
    issues: readonly RuntimeAuthoringIssue[],
): MetadataDiagnostics | undefined {
    if (issues.length === 0) return diagnostics;
    const refusals = issues.map((issue) => ({
        path: itemRelativeIssuePath(type, name, issue.path),
        message: issue.message,
        code: issue.rule,
    }));
    return {
        ...diagnostics,
        valid: false,
        errors: [...(diagnostics?.errors ?? []), ...refusals],
    };
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

    // A list view's OWN `tabs` and `filterableFields` are not walked: each is a
    // `retiredKey` tombstone on every list-view shape. The write door refuses
    // it, and a stored or artifact-shipped body has it stripped by the
    // conversion replay before it is served. A body that still carries it is
    // already badged by the spec diagnostics, with the tombstone's prescription.

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
