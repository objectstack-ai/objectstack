// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Field runtime VALUE-shape contract (ADR-0104 D1).
 *
 * `FieldSchema` owns what a field *definition* looks like; this module owns
 * what a field's runtime *value* looks like — the shape the write path
 * accepts, drivers persist, and an unexpanded API read returns. Before this
 * module the knowledge lived as private, hand-copied type sets in objectql's
 * record-validator, rest's import-coerce, driver-sql, and verify; adding one
 * multi-capable or JSON-shaped type meant updating four lists or silently
 * corrupting data. Those consumers now derive from the classes below.
 *
 * Two canonical forms exist per field (ADR-0104 D1):
 *  - `stored`   — the storage/wire form (e.g. lookup ⇒ record-id string,
 *                 `date` ⇒ `YYYY-MM-DD`, select ⇒ option code).
 *  - `expanded` — the enriched `$expand` read form (lookup ⇒ the related
 *                 record object). For types without an expansion,
 *                 expanded ≡ stored.
 *
 * "Reality wins": where the deployed stored shape is coherent, the contract
 * adopts it — deployed data is a wire contract we don't get to rewrite by
 * editing Zod. This is why `currency` is a bare number (not the never-consumed
 * `CurrencyValueSchema` object) and `location` is `{lat, lng}` (what field-zoo
 * stores), not the never-consumed `{latitude, longitude}` shape.
 *
 * Purity: schemas/constants/derivation only — no runtime logic, no caching
 * (Prime Directive #2). Consumers cache `valueSchemaFor` results per field
 * definition; building a Zod schema per write is the one performance trap
 * this contract has (ADR-0104 performance budget).
 */

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { SystemObjectName } from '../system/constants/system-names';
import type { FieldType } from './field.zod';

/* ────────────────────────────────────────────────────────────────────────────
 * Semantic type classes
 *
 * Membership is over `FieldType` values only. Driver-internal aliases that are
 * NOT authorable field types (`integer`, `int`, `float`, `object`, `array`,
 * external `reference`) stay in their drivers, layered on top of these sets.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Value is a plain string (validated per-type: email/url/phone formats, lengths). */
export const STRING_VALUE_TYPES: ReadonlySet<string> = new Set([
  'text', 'textarea', 'email', 'url', 'phone', 'password', 'secret',
  'markdown', 'html', 'richtext', 'code',
  'color', 'signature', 'qrcode',
] as const satisfies readonly FieldType[]);

/** Value is a finite numeric scalar. `currency` IS a bare number (see header). */
export const NUMERIC_VALUE_TYPES: ReadonlySet<string> = new Set([
  'number', 'currency', 'percent', 'rating', 'slider', 'progress', 'summary',
] as const satisfies readonly FieldType[]);

/** Value is a JS boolean on the wire (driver read-coercion repairs SQL 0/1). */
export const BOOLEAN_VALUE_TYPES: ReadonlySet<string> = new Set([
  'boolean', 'toggle',
] as const satisfies readonly FieldType[]);

/** Naive calendar day, stored `YYYY-MM-DD` — NOT an instant (ADR-0053). */
export const CALENDAR_DATE_TYPES: ReadonlySet<string> = new Set([
  'date',
] as const satisfies readonly FieldType[]);

/** UTC instant, stored as ISO-8601 with explicit zone (ADR-0053). */
export const INSTANT_TYPES: ReadonlySet<string> = new Set([
  'datetime',
] as const satisfies readonly FieldType[]);

/** Wall-clock time of day, `HH:MM[:SS[.fff]]` (+ optional zone) — not `Date.parse`-able (#2004). */
export const CLOCK_TIME_TYPES: ReadonlySet<string> = new Set([
  'time',
] as const satisfies readonly FieldType[]);

/** Single-choice option types: value is one declared option code. */
export const SINGLE_OPTION_TYPES: ReadonlySet<string> = new Set([
  'select', 'radio',
] as const satisfies readonly FieldType[]);

/** Inherently-multi option types: value is an array of option codes (tags: free-form). */
export const MULTI_OPTION_TYPES: ReadonlySet<string> = new Set([
  'multiselect', 'checkboxes', 'tags',
] as const satisfies readonly FieldType[]);

/**
 * Value points at another record: a record-id string in stored form, the
 * related record object in expanded form (`$expand` overwrites in place).
 */
export const REFERENCE_VALUE_TYPES: ReadonlySet<string> = new Set([
  'lookup', 'master_detail', 'user', 'tree',
] as const satisfies readonly FieldType[]);

/**
 * Reference types whose target object is FIXED BY THE TYPE rather than chosen
 * by the author, mapped to that target.
 *
 * `user` is the only member: `field.zod` defines it as "a lookup specialized to
 * the `sys_user` system object … target fixed to the `sys_user` system object",
 * and the `Field.user()` builder — unlike `Field.lookup(reference, …)` /
 * `Field.masterDetail(reference, …)` — takes NO target argument and writes
 * `reference: 'sys_user'` itself. The target is a CONSTANT OF THE TYPE, so
 * `reference` on a `user` field materializes that constant; it does not supply
 * it. Metadata authored without it (hand-written JSON, an AI author, a Studio
 * form) is fully specified, not under-specified.
 */
const IMPLICIT_REFERENCE_TARGETS: ReadonlyMap<string, string> = new Map([
  ['user', SystemObjectName.USER],
]);

/**
 * The object a reference-typed field points at — the SINGLE arbiter of "what
 * does this field expand into", for the gate that admits an `expand` and the
 * engine that performs it alike.
 *
 * Returns `undefined` only when the field genuinely names no target: a
 * non-reference type, or a `lookup`/`master_detail`/`tree` with no `reference`
 * (an authoring bug — those types carry an author-chosen target and nothing
 * can supply it for them).
 *
 * Framework#4443 / cloud#983: the two callers used to read `field.reference`
 * raw, which made a `{ type: 'user' }` field targetless to BOTH — the expand
 * gate refused `?expand=<that field>` with `400 INVALID_FIELD … declares no
 * target object`, so an AI-authored app whose default list view expanded its
 * "responsible person" column answered its very first screen with an error
 * page. Deriving the target here (rather than requiring every author to
 * restate a constant) is what keeps the gate and the engine agreeing on the
 * one question they both ask.
 */
export function referenceTargetOf(def: unknown): string | undefined {
  if (!def || typeof def !== 'object') return undefined;
  const { type, reference } = def as { type?: unknown; reference?: unknown };
  if (typeof type !== 'string' || !REFERENCE_VALUE_TYPES.has(type)) return undefined;
  if (typeof reference === 'string' && reference) return reference;
  return IMPLICIT_REFERENCE_TARGETS.get(type);
}

/**
 * Media/attachment types. Stored form TODAY is the legacy inline metadata
 * object (`{url, name?, size?, ...}`) or an opaque file-id/url string;
 * ADR-0104 D3 (file-as-reference) narrows this to a `sys_file` id. The stored
 * schema below deliberately admits both until D3 lands.
 */
export const FILE_REFERENCE_TYPES: ReadonlySet<string> = new Set([
  'image', 'file', 'avatar', 'video', 'audio',
] as const satisfies readonly FieldType[]);

/**
 * Does a stored file-field string look like an opaque `sys_file` id, rather
 * than the URL a file field legitimately holds in the legacy/dual-mode world?
 *
 * ADR-0104 D3 wave 2 makes this the SINGLE arbiter for both directions of the
 * reference path — the read resolver (which ids does the engine expand?) and
 * the write claimer (which ids does storage take ownership of?). Two
 * hand-copied predicates that drift by one character would silently claim
 * files nobody expands, or expand files nobody owns; there is exactly one
 * definition so that cannot happen.
 *
 * A minted id is uuid/nanoid-shaped: word characters and `-`, nothing else. A
 * URL — `https://…`, `/api/…`, `data:…`, `blob:…` — always carries a `:`, `/`
 * or `.` and so can never match.
 */
export function isFileIdToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

/**
 * ExecutionContext key that makes a read return file-field values in their
 * STORED form (the bare `sys_file` id) instead of the expanded
 * `{ id, name, url, … }` shape the engine's read resolver derives in place.
 *
 * Exists for the callers whose subject is the stored form itself — the
 * ADR-0104 backfill and `verifyFileReferences` reconciliation (#3617). On a
 * live kernel the resolver otherwise rewrites every resolvable id before the
 * scan sees it, so the reconciliation would report held references as absent:
 * false `stale_owner` noise, and — worse — a missed `unowned_reference` is a
 * false pass of the very gate that authorises irreversible behaviour.
 *
 * A spec-level constant for the same reason `isFileIdToken` is one: the
 * engine (which honours the key) and the storage service (which sends it)
 * must agree on the exact string, and two hand-copied literals drifting by a
 * character would silently re-enable expansion mid-scan.
 */
export const RAW_FILE_VALUES_CONTEXT_KEY = '__rawFileValues';

/** Structured JSON payloads persisted in JSON columns. */
export const STRUCTURED_JSON_TYPES: ReadonlySet<string> = new Set([
  'json', 'composite', 'repeater', 'record', 'location', 'address', 'vector',
] as const satisfies readonly FieldType[]);

/** Server-computed types: never client-written; shape is producer-owned. */
export const COMPUTED_VALUE_TYPES: ReadonlySet<string> = new Set([
  'formula', 'summary', 'autonumber',
] as const satisfies readonly FieldType[]);

/**
 * Single-value types that become an ARRAY when flagged `multiple: true`
 * (`FieldSchema.multiple`: select/lookup/file/image; `radio` shares the select
 * branch; `user` stores identically to `lookup`). Previously hand-copied in
 * objectql record-validator AND rest import-coerce.
 */
export const MULTI_CAPABLE_TYPES: ReadonlySet<string> = new Set([
  'select', 'radio', 'lookup', 'user', 'file', 'image',
] as const satisfies readonly FieldType[]);

/**
 * The minimal slice of a field definition the value contract reads. Structural
 * (not `Field`) so runtime callers with their own trimmed field-def interfaces
 * (objectql's `FieldDef`, rest's `ExportFieldMeta`) can pass theirs verbatim.
 */
export interface ValueShapeFieldDef {
  type: string;
  multiple?: boolean;
  options?: Array<{ value: string | number } | string | number>;
}

/**
 * Whether a field's persisted value is an array — an inherently-multi option
 * type, or a multi-capable type flagged `multiple: true`. THE shared
 * definition (was duplicated verbatim in record-validator + import-coerce).
 */
export function isMultiValueField(def: ValueShapeFieldDef): boolean {
  if (MULTI_OPTION_TYPES.has(def.type)) return true;
  return MULTI_CAPABLE_TYPES.has(def.type) && def.multiple === true;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Canonical value schemas
 * ──────────────────────────────────────────────────────────────────────────── */

/** `YYYY-MM-DD` — the calendar-day stored form (driver collapses Date → day). */
export const CalendarDateValueSchema = lazySchema(() =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD (calendar day, not an instant)'));
export type CalendarDateValue = z.input<typeof CalendarDateValueSchema>;

/** ISO-8601 instant with explicit zone — the `datetime` stored form. */
export const InstantValueSchema = lazySchema(() =>
  z.string().refine((s) => !Number.isNaN(Date.parse(s)) && (/[Zz]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s.slice(10))),
    'expected an ISO-8601 instant with explicit zone (e.g. 2026-03-15T14:30:00.000Z)'));
export type InstantValue = z.input<typeof InstantValueSchema>;

/** `HH:MM[:SS[.fff]]` with optional zone — the `time` stored form (#2004). */
export const ClockTimeValueSchema = lazySchema(() =>
  z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]([01]\d|2[0-3]):?[0-5]\d)?$/,
    'expected HH:MM or HH:MM:SS (wall-clock time of day)'));
export type ClockTimeValue = z.input<typeof ClockTimeValueSchema>;

/** GPS point — the shape field-zoo stores and renderers read. See header re: the retired `{latitude, longitude}` form. */
export const LocationValueSchema = lazySchema(() => z.object({
  lat: z.number().min(-90).max(90).describe('Latitude'),
  lng: z.number().min(-180).max(180).describe('Longitude'),
  altitude: z.number().optional().describe('Altitude in meters'),
  accuracy: z.number().optional().describe('Accuracy in meters'),
}));
export type LocationValue = z.input<typeof LocationValueSchema>;

/**
 * Address Schema — structured address for the `address` field type.
 *
 * DECLARED here since #7127 (previously in `./field.zod`, which re-exports it
 * for compatibility): it is the enforced address VALUE contract, so this
 * module is its true home — and the old `field.zod` declaration was the ONE
 * runtime edge back into that file. `field.zod` now consumes this module's
 * value contract for its `defaultValue` gate, and a runtime edge in each
 * direction is an ESM evaluation cycle whose order-dependent TDZ crash this
 * move retires structurally (the remaining `FieldType` import above is
 * type-only and erased at runtime).
 */
export const AddressSchema = lazySchema(() => z.object({
  street: z.string().optional().describe('Street address'),
  city: z.string().optional().describe('City name'),
  state: z.string().optional().describe('State/Province'),
  postalCode: z.string().optional().describe('Postal/ZIP code'),
  country: z.string().optional().describe('Country name or code'),
  countryCode: z.string().optional().describe('ISO country code (e.g., US, GB)'),
  formatted: z.string().optional().describe('Formatted address string'),
}));

/** Structured address value — adopts the (previously unconsumed) `AddressSchema` as the enforced contract. */
export const AddressValueSchema = AddressSchema;
export type AddressValue = z.input<typeof AddressValueSchema>;

/**
 * Declared media value (ADR-0104 D3 wave 1) — the inline metadata object the
 * platform stores today for a `file` / `image` / `avatar` / `video` / `audio`
 * field. `url` is the one required member; the rest are optional descriptors
 * renderers read. Extra keys are tolerated (renderers add their own), but a
 * value with no `url` — an empty object, a `{ name }` fragment, a number — is
 * now rejected instead of waved through as an opaque payload.
 *
 * Wave 2 (file-as-reference) narrows the STORED form to an opaque `sys_file`
 * id and makes THIS the `expanded` read shape, with `url` derived from the
 * `/files/:fileId` resolver rather than stored.
 */
export const FileValueSchema = lazySchema(() => z.looseObject({
  url: z.string(),
  name: z.string().optional(),
  size: z.number().optional(),
  mimeType: z.string().optional(),
  alt: z.string().optional(),
  duration: z.number().optional(),
}));
export type FileValue = z.input<typeof FileValueSchema>;

/**
 * Media/attachment STORED value (ADR-0104 D3 wave 2) — an opaque `sys_file` id.
 *
 * Deliberately id-SHAPED rather than any non-empty string. The two legacy forms
 * a file field used to hold are both strings-or-objects that this rejects, and
 * rejecting them is the point:
 *
 *  - an **inline metadata blob** is no longer the stored form; it is the
 *    `expanded` READ form ({@link FileValueSchema}), derived rather than stored;
 *  - an **external URL** was never a managed file. ADR-0104 R7 retires it toward
 *    an explicit `url` field, which under AI authoring is what stops "managed
 *    file" and "external link" from being the same declaration.
 *
 * Both surface through the warn-first value-shape rollout (R1/R2) rather than
 * as hard failures, so a deployment sees exactly which values still need the
 * backfill before it opts into strict enforcement.
 */
export const FileReferenceIdValueSchema = lazySchema(() =>
  z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Expected an opaque sys_file id'),
);
export type FileReferenceIdValue = z.input<typeof FileReferenceIdValueSchema>;

/**
 * Media/attachment value in either form — the TRANSITIONAL union that was the
 * stored contract before wave 2.
 *
 * @deprecated The stored form is {@link FileReferenceIdValueSchema}; the
 * expanded read form is {@link FileValueSchema}. Retained for consumers that
 * genuinely need to accept both during the migration window, so they say so
 * explicitly rather than by default.
 */
export const FileLikeValueSchema = lazySchema(() => z.union([
  z.string().min(1),
  FileValueSchema,
]));
export type FileLikeValue = z.input<typeof FileLikeValueSchema>;

/**
 * A stored reference value that is really an EMBEDDED RECORD, serialized.
 *
 * In a document store the expanded form arrives as an object and `z.string()`
 * already rejects it. In a SQL deployment the same value reaches storage as
 * JSON *text* in a TEXT column — a non-empty string — which is exactly how a
 * legacy embedded reference survives into a relational table. Anchored on the
 * first non-space character rather than a `JSON.parse` attempt so the check
 * stays allocation-free on the write path: no record id the platform mints, and
 * no external key any datasource can supply, begins with `{` or `[`.
 */
const EMBEDDED_REFERENCE_TEXT = /^\s*[[{]/;

/**
 * Record-id string — the stored form of every reference type.
 *
 * Non-empty is not the whole contract. `os migrate value-shapes` is the
 * evidence half of the ADR-0104 D1 per-deployment gate, and its own header
 * names "a `lookup` holding an expanded record object" as a case it exists to
 * find — but a bare `z.string().min(1)` accepts the JSON text such a value is
 * stored as, so the gate closed on evidence it never collected (#4455). The
 * scan deliberately imports the write-path predicate, so the write path was
 * equally blind and the value survived future writes too.
 *
 * The rejection is deliberately NARROW — an embedded object/array, not an id
 * charset. Its file sibling {@link FileReferenceIdValueSchema} can bound its
 * charset because a `sys_file` id is minted by the platform and by nothing
 * else; a reference id is whatever the target object's primary key holds,
 * including an external key an ADR-0015 federated datasource supplies. So this
 * rejects the shape that is provably not an id and leaves the id alphabet to
 * the object that owns it. Widening it further needs evidence about real
 * external keys, not a guess.
 */
export const ReferenceIdValueSchema = lazySchema(() =>
  z.string().min(1).refine((v) => !EMBEDDED_REFERENCE_TEXT.test(v), {
    message:
      'Expected a record id, but the value is an embedded record object. A reference stores an ' +
      'opaque id; the expanded record is the READ shape ($expand produces it) and is never stored. ' +
      'Replace the value with the referenced record\'s id.',
  }),
);
export type ReferenceIdValue = z.input<typeof ReferenceIdValueSchema>;

function optionCodes(def: ValueShapeFieldDef): string[] {
  if (!Array.isArray(def.options)) return [];
  return def.options.map((o) => (typeof o === 'object' && o !== null ? String(o.value) : String(o)));
}

export type ValueForm = 'stored' | 'expanded';

/**
 * The runtime value schema for one field definition. Pure derivation — no
 * caching here; runtime consumers MUST cache per field definition (building a
 * `z.object` per write is an order of magnitude costlier than parsing).
 *
 * The schema describes a PRESENT value: null/undefined/required handling stays
 * with the caller (insert vs PATCH semantics differ — see record-validator).
 * Where the contract is deliberately open (`json`, `code` payloads, computed
 * types), the schema is `z.unknown()` — openness is now an explicit decision,
 * not an accident of nobody checking.
 */
export function valueSchemaFor(def: ValueShapeFieldDef, form: ValueForm = 'stored'): z.ZodType {
  const t = def.type;

  const element = ((): z.ZodType => {
    if (STRING_VALUE_TYPES.has(t)) return z.string();
    if (NUMERIC_VALUE_TYPES.has(t)) return z.number().finite();
    if (BOOLEAN_VALUE_TYPES.has(t)) return z.boolean();
    if (CALENDAR_DATE_TYPES.has(t)) return CalendarDateValueSchema;
    if (INSTANT_TYPES.has(t)) return InstantValueSchema;
    if (CLOCK_TIME_TYPES.has(t)) return ClockTimeValueSchema;
    if (SINGLE_OPTION_TYPES.has(t) || MULTI_OPTION_TYPES.has(t)) {
      // tags (and option types authored without options) are free-form strings.
      const codes = optionCodes(def);
      return codes.length > 0 ? z.enum(codes as [string, ...string[]]) : z.string();
    }
    if (REFERENCE_VALUE_TYPES.has(t)) {
      // Expanded form: `$expand` replaces the id in place with the related
      // record object (objectql engine `expandRelatedRecords`). The record's
      // own shape is that object's contract, not this field's — hence open.
      return form === 'expanded'
        ? z.union([ReferenceIdValueSchema, z.record(z.string(), z.unknown())])
        : ReferenceIdValueSchema;
    }
    if (FILE_REFERENCE_TYPES.has(t)) {
      // Expanded form: the read path replaces a stored id in place with the
      // resolved `{ id, name, size, mimeType, url }` — same polymorphism the
      // reference types have, and for the same reason, so an unresolved id
      // (storage service absent, file not committed) stays valid.
      return form === 'expanded'
        ? z.union([FileReferenceIdValueSchema, FileValueSchema])
        : FileReferenceIdValueSchema;
    }
    if (t === 'location') return LocationValueSchema;
    if (t === 'address') return AddressValueSchema;
    if (t === 'composite') return z.record(z.string(), z.unknown());
    if (t === 'record') return z.record(z.string(), z.unknown());
    if (t === 'repeater') return z.array(z.record(z.string(), z.unknown()));
    if (t === 'vector') return z.array(z.number());
    // `json` payloads, computed outputs not covered by a shape class above
    // (`formula` / `autonumber` — producer-owned), and any future type default
    // to explicitly-open. Openness is a decision here, not an accident.
    return z.unknown();
  })();

  return isMultiValueField(def) ? z.array(element) : element;
}
