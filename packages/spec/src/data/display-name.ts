// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0079 — Record display-name contract.
 *
 * A record's human title is a STRUCTURAL INVARIANT: every object has exactly one
 * primary title field, which is a real STORED field (text / autonumber / formula
 * whose result is text). This module is the single source of truth for:
 *   - which field types may back a title (`isTitleEligible` / `TITLE_ELIGIBLE`),
 *   - how the primary title field is resolved (`resolveDisplayField`) — explicit
 *     pointer first (`nameField`, then the deprecated `displayNameField` alias),
 *     then a deterministic derivation,
 *   - how a single record's display name is rendered (`resolveRecordDisplayName`)
 *     with a stable `Record #<id>` floor — NEVER a bare "Untitled",
 *   - a pure transform that GUARANTEES a primary exists (`provisionPrimary`),
 *   - and a completeness classifier for lint/quality reporting
 *     (`objectTitleCompleteness`).
 *
 * Pure + framework-agnostic (no Zod, no engine). Shared by authoring, the
 * approval/notification display-enrichment path, objectql search field
 * resolution, and build-time lint.
 *
 * NOTE on the schema: `nameField` is the canonical primary-title pointer
 * (ADR-0079). `displayNameField` is accepted as a DEPRECATED ALIAS at the
 * schema level (mapped onto `nameField`).
 * Both are still read here so this resolver works against metadata that has not
 * yet been normalized.
 */

/**
 * Minimal structural shape of a field definition this module needs to judge
 * title-eligibility. Intentionally loose — callers pass `Data.Field`,
 * `sys_metadata` rows, or hand-built fakes.
 */
export interface TitleEligibleFieldDef {
  type?: string;
  /**
   * For `formula` fields: the declared result type. The framework field schema
   * carries this as `returnType` (number/text/boolean/date); `valueType` is also
   * accepted for forward/cross-repo compatibility. A formula is title-eligible
   * ONLY when this is `text`.
   */
  returnType?: string;
  valueType?: string;
  [k: string]: unknown;
}

/**
 * Minimal structural shape of an object's metadata this module reads.
 * `fields` is a name-keyed map (declaration order = `Object.keys` order, which
 * the framework preserves for the `record` field type and object materialization).
 */
export interface DisplayNameObjectMeta {
  /** Canonical primary-title pointer (ADR-0079). */
  nameField?: string;
  /** Deprecated alias for `nameField`; still honored as a fallback. */
  displayNameField?: string;
  fields?: Record<string, TitleEligibleFieldDef> | undefined;
  [k: string]: unknown;
}

/**
 * Field types that are NEVER a record title — they carry no human-readable
 * short label (dates, numbers, booleans, media, structured/relational values,
 * choice tokens, and system/auto values). `autonumber` is excluded from
 * *derivation* here: an autonumber is a valid primary only when an author
 * points at it explicitly (an `autonumber` `Field` designated as the
 * `nameField`), not something we silently pick. `formula` is conditionally
 * eligible — see `isTitleEligible`.
 *
 * `phone` is deliberately excluded (a phone number is not a title); `email` IS
 * eligible (commonly the human handle on identity-ish objects).
 */
export const TITLE_INELIGIBLE_TYPES: ReadonlySet<string> = new Set([
  // Date & time
  'date', 'datetime', 'time',
  // Numbers
  'number', 'currency', 'percent',
  // Logic
  'boolean', 'toggle',
  // Media / files / attachments
  'file', 'image', 'avatar', 'video', 'audio', 'attachment', 'signature', 'qrcode',
  // Structured / untyped
  'json', 'code', 'composite', 'repeater', 'record', 'address', 'vector',
  // Geo
  'geolocation', 'location',
  // Choice tokens (machine values, not titles)
  'select', 'multiselect', 'multi_select', 'radio', 'checkboxes', 'checkbox', 'tags', 'color', 'rating', 'slider', 'progress',
  // Relational
  'lookup', 'master_detail', 'tree', 'user',
  // System / auto / derived
  'autonumber', 'password', 'secret',
  // Phone is not a title (email IS — handled in the eligible set)
  'phone',
]);

/**
 * Text-ish field types that ARE title-eligible. Used as a positive allowlist so
 * an UNKNOWN/new field type does not accidentally become a title (fail-closed).
 * `formula` is handled separately (eligible only when its result type is text).
 */
export const TITLE_ELIGIBLE_TYPES: ReadonlySet<string> = new Set([
  'text', 'textarea', 'email', 'url', 'markdown', 'html', 'richtext',
]);

/**
 * Convenience alias for `TITLE_ELIGIBLE_TYPES` named in ADR-0079 as the
 * `TITLE_ELIGIBLE` rule.
 */
export const TITLE_ELIGIBLE = TITLE_ELIGIBLE_TYPES;

/**
 * Is `fieldDef` a field that can back a record's human title?
 *
 * Eligible: text-ish types (`text`, `textarea`, `email`, `url`, `markdown`,
 * `html`, `richtext`) and a `formula` whose result type (`returnType`, or
 * `valueType`) is `text`. Everything else — explicitly the
 * {@link TITLE_INELIGIBLE_TYPES} set — is ineligible. Unknown types are
 * ineligible (fail-closed against the positive allowlist).
 */
export function isTitleEligible(fieldDef: TitleEligibleFieldDef | undefined | null): boolean {
  if (!fieldDef) return false;
  const type = fieldDef.type;
  if (!type) return false;
  if (type === 'formula') {
    const rt = fieldDef.returnType ?? fieldDef.valueType;
    return rt === 'text';
  }
  if (TITLE_INELIGIBLE_TYPES.has(type)) return false;
  return TITLE_ELIGIBLE_TYPES.has(type);
}

/**
 * Exact name-ish field names (case-insensitive), highest derivation priority.
 *
 * DIVERGES from lint's `NAME_LIKE_FIELDS`
 * (`packages/lint/src/data-model-rules.ts`) by exactly one entry: `code`. That
 * difference is INTENTIONAL — the two sets answer different questions, and the
 * maintainer ruled on 2026-08-10 (#6734) to keep both as they are and write the
 * gap down in both places rather than converge them.
 *
 * This set answers **"what is the record's title?"** — it is tier 1 of
 * {@link resolveDisplayField}'s derivation, i.e. the names whose presence is
 * strong enough evidence to pick that field as the primary title outright. A
 * `code` is an identifier, not a title, so it is deliberately absent here; a
 * `code`-only object still gets a title, but at tier 3 ("first title-eligible
 * field by declaration order") — by a different rule and a different priority.
 *
 * Lint R9 (`object/missing-name-field`) asks the looser **"will records be
 * anonymous?"** question — does this object have any title FACE at all — and
 * for that a `code` counts, which is why its set carries the extra entry. R9 is
 * `severity: 'suggestion'` and the `Record #<id>` floor below guarantees a
 * title regardless, so the two sets never disagree about an outcome a user
 * sees. Do not "fix" either set into the other without a ruling that supersedes
 * the one above.
 */
const NAME_ISH_EXACT: ReadonlySet<string> = new Set([
  'name', 'title', 'subject', 'label', 'full_name', 'display_name',
]);

/** Affix tokens that make a field name "name-ish" (e.g. `first_name`, `job_title`, `name_en`). */
const NAME_ISH_AFFIX_SUFFIX = ['_name', '_title'];
const NAME_ISH_AFFIX_PREFIX = ['name_'];

function isNameIshExact(fieldName: string): boolean {
  return NAME_ISH_EXACT.has(fieldName.toLowerCase());
}

function isNameIshAffix(fieldName: string): boolean {
  const lower = fieldName.toLowerCase();
  if (NAME_ISH_EXACT.has(lower)) return false; // exact handled at a higher tier
  return (
    NAME_ISH_AFFIX_SUFFIX.some((s) => lower.endsWith(s)) ||
    NAME_ISH_AFFIX_PREFIX.some((p) => lower.startsWith(p))
  );
}

/**
 * Derive the title field from the object's fields when no explicit pointer is
 * set. Ranking (highest first), restricted to title-eligible fields:
 *   1. name-ish EXACT  — `name`/`title`/`subject`/`label`/`full_name`/`display_name`
 *   2. name-ish AFFIX  — `*_name` / `*_title` / `name_*`
 *   3. first title-eligible field by declaration order
 * Returns `undefined` when no field is title-eligible.
 */
function deriveDisplayField(fields: Record<string, TitleEligibleFieldDef> | undefined): string | undefined {
  if (!fields) return undefined;
  const names = Object.keys(fields);

  // Tier 1: name-ish exact, in the EXACT priority order (name > title > subject > …)
  // so `name` wins over `title` when both exist, independent of declaration order.
  const exactOrder = ['name', 'title', 'subject', 'label', 'full_name', 'display_name'];
  for (const wanted of exactOrder) {
    for (const fname of names) {
      if (fname.toLowerCase() === wanted && isTitleEligible(fields[fname])) return fname;
    }
  }

  // Tier 2: name-ish affix, by declaration order.
  for (const fname of names) {
    if (isNameIshAffix(fname) && isTitleEligible(fields[fname])) return fname;
  }

  // Tier 3: first title-eligible field by declaration order.
  for (const fname of names) {
    if (!isNameIshExact(fname) && isTitleEligible(fields[fname])) return fname;
  }

  return undefined;
}

/**
 * Resolve the object's primary title field name:
 *   `nameField` (canonical) ?? `displayNameField` (deprecated alias) ?? derived.
 *
 * An explicit pointer is honored even if it is not currently title-eligible
 * (the author asserted it; eligibility gates only DERIVATION). Returns
 * `undefined` when there is no explicit pointer and nothing derivable.
 */
export function resolveDisplayField(objectMeta: DisplayNameObjectMeta | undefined | null): string | undefined {
  if (!objectMeta) return undefined;
  const explicit = objectMeta.nameField ?? objectMeta.displayNameField;
  if (explicit) return explicit;
  return deriveDisplayField(objectMeta.fields);
}

/** Options for {@link resolveRecordDisplayName}. */
export interface ResolveRecordDisplayNameOptions {
  /**
   * A view-declared title field that OVERRIDES the object's resolved display
   * field for this render (e.g. a list view choosing a different column as the
   * row label). When set, the record's value at this field is used directly.
   */
  viewTitleField?: string;
}

function isEmptyish(v: unknown): boolean {
  return v == null || (typeof v === 'string' && v.trim() === '');
}

/**
 * Render a single record's human display name.
 *
 *   opts.viewTitleField ? record[viewTitleField] : record[resolveDisplayField(meta)]
 *
 * Falls back to a stable `Record #<id>` floor (using `record.id` or `record._id`)
 * when the resolved value is null/empty. NEVER returns a bare "Untitled".
 */
export function resolveRecordDisplayName(
  objectMeta: DisplayNameObjectMeta | undefined | null,
  record: Record<string, unknown> | undefined | null,
  opts?: ResolveRecordDisplayNameOptions,
): string {
  const rec = record ?? {};
  const field = opts?.viewTitleField ?? resolveDisplayField(objectMeta);
  const value = field ? (rec as Record<string, unknown>)[field] : undefined;
  if (!isEmptyish(value)) return String(value);
  const id = (rec as Record<string, unknown>).id ?? (rec as Record<string, unknown>)._id;
  return `Record #${id ?? ''}`.trimEnd();
}

/** Options for {@link provisionPrimary}. */
export interface ProvisionPrimaryOptions {
  /**
   * Whether to SYNTHESIZE a `name` text field when nothing is title-eligible.
   *
   * - `true` (default) — full provisioning: designate a derivable title, else
   *   add a `name` text field and point `nameField` at it. GUARANTEES a primary
   *   exists. This adds a column, so for an already-materialized table it is a
   *   schema-migration-bearing change.
   * - `false` — DESIGNATE-ONLY: set `nameField` when a title can be
   *   resolved/derived from an EXISTING field, otherwise return the object
   *   unchanged (no `name` field is added, no schema change). Safe to run at the
   *   object-materialization seam against title-less system tables.
   */
  synthesize?: boolean;
}

/**
 * Pure transform that provisions the object's primary title field.
 *
 * - If a title can be resolved/derived from an existing field, set `nameField`
 *   to it (idempotent — a second call is a no-op).
 * - Otherwise, when `synthesize !== false` (the default), SYNTHESIZE a `name`
 *   text field (added to `fields`) and set `nameField: 'name'` — GUARANTEEING a
 *   primary exists. When `synthesize === false`, the object is returned
 *   UNCHANGED (no field added, no schema-migration-bearing column).
 *
 * Returns a NEW object when it changes anything (does not mutate the input); in
 * designate-only mode with nothing to designate it returns the input as-is. The
 * deprecated `displayNameField` is left untouched for back-compat; `nameField`
 * becomes the authoritative pointer.
 */
export function provisionPrimary<T extends DisplayNameObjectMeta>(
  objectMeta: T,
  opts?: ProvisionPrimaryOptions,
): T {
  const resolved = resolveDisplayField(objectMeta);
  if (resolved) {
    if (objectMeta.nameField === resolved) return objectMeta; // already canonical — no-op
    return { ...objectMeta, nameField: resolved };
  }
  // Nothing eligible to designate.
  if (opts?.synthesize === false) {
    // Designate-only: leave the object exactly as-is (no synthesized column,
    // no schema migration). The canonical pointer stays resolved on read.
    return objectMeta;
  }
  // Synthesize a primary `name` text field.
  const fields = { ...(objectMeta.fields ?? {}) };
  if (!fields.name) {
    fields.name = { type: 'text', label: 'Name', required: true } as TitleEligibleFieldDef;
  }
  return { ...objectMeta, fields, nameField: 'name' };
}

/** Result of {@link objectTitleCompleteness}. */
export interface ObjectTitleCompleteness {
  /**
   * - `explicit`    — an explicit pointer (`nameField`/`displayNameField`) is set.
   * - `derived`     — no explicit pointer, but a title-eligible field was derivable.
   * - `synthesized` — `nameField` points at a field NOT present in `fields`
   *   (e.g. a synthesized/expected `name`); the runtime must materialize it.
   * - `none`        — no pointer and nothing derivable. Lint/quality should flag.
   */
  status: 'explicit' | 'derived' | 'synthesized' | 'none';
  /** The resolved field name when one exists. */
  field?: string;
}

/**
 * Classify how an object's title is satisfied, for lint / quality reporting.
 * Does not mutate; mirrors `resolveDisplayField` precedence.
 */
export function objectTitleCompleteness(objectMeta: DisplayNameObjectMeta | undefined | null): ObjectTitleCompleteness {
  if (!objectMeta) return { status: 'none' };
  const explicit = objectMeta.nameField ?? objectMeta.displayNameField;
  if (explicit) {
    const present = !!objectMeta.fields && Object.prototype.hasOwnProperty.call(objectMeta.fields, explicit);
    return { status: present ? 'explicit' : 'synthesized', field: explicit };
  }
  const derived = deriveDisplayField(objectMeta.fields);
  if (derived) return { status: 'derived', field: derived };
  return { status: 'none' };
}
