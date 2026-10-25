/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * record-title — the ONE shared display-name resolver for ObjectStack records
 * (ADR-0079).
 *
 * Historically ~6 surfaces (gallery cards, calendar pills, kanban cards, gantt
 * bars, lookup chips, related-lists, breadcrumbs, global search) each carried
 * their OWN divergent resolver. None of them read the object's declared
 * `displayNameField`, and each fell back to a slightly different hard-coded list
 * (`name`/`title`/`label`/`subject`/…) that excluded perfectly good name fields
 * like `activity_name`. An object whose records carry their name in
 * `activity_name` therefore rendered "Untitled" everywhere.
 *
 * This module unifies them onto ONE precedence, implemented by
 * {@link getRecordDisplayName}. Phase 2 promotes the object's declared field
 * (`nameField`) to canonical and de-prioritizes the legacy render-only
 * `titleFormat` template:
 *
 *   0. `options.titleField` — the caller's own DECLARED view-level pointer
 *      (gallery / calendar / gantt / map / kanban / timeline config).
 *   1. `objectDef.nameField` — the canonical record-title pointer (ADR-0079);
 *      a field the server can return and query, if present & non-empty. With
 *      the undeclared `objectDef.titleField` read gone (objectui#6531) this is
 *      the top of the OBJECT-level ladder, exactly as ADR-0079 states.
 *   2. `objectDef.displayNameField` (alias `NAME_FIELD_KEY`) — deprecated alias
 *      of `nameField`, kept for back-compat.
 *   3. `objectDef.titleFormat` — LEGACY render-only template, rendered via
 *      {@link formatTitleTemplate}. Kept working for back-compat, but a declared
 *      field (1/2) now wins over it.
 *   4. Type-aware derivation — the first *title-eligible* field from
 *      `objectDef.fields`, ranked name-ish-exact > name-ish-affix > declaration
 *      order. Skipped when `objectDef.fields` is absent.
 *   5. `Record #<id>` floor — only a truly id-less record yields `'Untitled'`.
 *
 * Pure (no React / i18n) so it can live in `@object-ui/core` and be imported by
 * app-shell, the field widgets, and every view plugin — exactly like
 * `percentDisplayValue` / `formatMeasure`.
 */

import { isSystemManagedField } from '@object-ui/types';

// Sentinel marking an empty-placeholder position inside a titleFormat render,
// so adjacent separators can be stripped in a second pass.
//
// Spelled as an escape rather than written as the byte itself (objectstack#5450):
// a raw U+0000 in this literal made the WHOLE file binary to grep and ripgrep,
// so a content search printed `binary file matches` and no line at all. The
// runtime value is unchanged, and it has to be: this token is interpolated
// verbatim into the RegExps below and must stay both regex-safe and a character
// no record value can carry — a printable separator would be stripped out of
// real titles.
const EMPTY_TOKEN = '\u0000';
// Separators commonly placed between {fields} in titleFormat patterns
// (hyphen, em/en dashes, pipes, slashes, middle dot, comma, colon).
const SEPARATOR_CLASS = '[-\\u2013\\u2014|/·,:]';

/**
 * Standard display fields a referenced/expanded object exposes its name through,
 * highest priority first. Shared by both the titleFormat expansion (for
 * `{lookup}` placeholders that resolve to an embedded object) and the name-ish
 * exact ranking in {@link deriveTitleField}.
 */
const NAME_ISH_EXACT = [
  'name',
  'title',
  'subject',
  'label',
  'full_name',
  'display_name',
] as const;

/**
 * Field types that can NEVER serve as a human-readable record title. Used by
 * {@link deriveTitleField} to skip dates, numbers, pickers, lookups, binary
 * blobs, etc. — anything whose value isn't a free-text name.
 *
 * Notes:
 *  - `email` is intentionally NOT excluded (a contact with only an email is
 *    better labelled by it than by `Record #…`).
 *  - `phone` IS excluded (a bare phone number is a poor title).
 *  - `formula` is handled specially: eligible only when its declared
 *    `data_type`/`dataType`/`returnType` is text-like.
 */
const NON_TITLE_TYPES = new Set<string>([
  'date',
  'datetime',
  'time',
  'number',
  'currency',
  'percent',
  'boolean',
  'file',
  'image',
  'attachment',
  'json',
  'geolocation',
  'select',
  'multiselect',
  // common ObjectStack aliases for the picker/lookup family
  'picklist',
  'multipicklist',
  'lookup',
  'master_detail',
  'reference',
  'autonumber',
  // ObjectStack registry/metadata spelling of the same type (see the
  // `auto_number` field-widget registration) — an autonumber like `0001` is a
  // record *number*, never its title.
  'auto_number',
  'phone',
]);

/** Text-like formula return types that keep a formula field title-eligible. */
const TEXT_FORMULA_RETURN_TYPES = new Set<string>(['text', 'string', 'textarea', 'html']);

/**
 * Pull a human-readable display name out of an expanded reference object using
 * the Salesforce-style fallback chain (standard name fields → salutation/first/
 * last composite → email). Returns null when nothing usable is present.
 */
function displayNameOfEmbeddedObject(o: any): string | null {
  const display: any =
    o.name ?? o.full_name ?? o.display_name ?? o.label ?? o.title ?? o.subject ?? null;
  if (display == null || (typeof display === 'string' && !display.trim())) {
    const composite = [o.salutation, o.first_name, o.last_name]
      .filter((p: any) => typeof p === 'string' && p.trim())
      .map((p: string) => p.trim())
      .join(' ');
    if (composite) return composite;
    if (typeof o.email === 'string' && o.email.trim()) return o.email.trim();
    return null;
  }
  return typeof display === 'string' ? display : String(display);
}

/**
 * Render a record title from a `titleFormat` pattern.
 *
 * Accepts either a legacy string template or an Expression envelope
 * (`{ dialect: 'template', source: string }`) emitted by `@objectstack/spec`'s
 * normalized templates. Both single-brace (`{field}`) and double-brace
 * (`{{field}}`, the handlebars-style some authoring paths emit) placeholders are
 * supported. Dotted paths (`{account.name}`) walk `$expanded` lookup objects; a
 * placeholder that resolves to a whole object is reduced to its display name.
 *
 * Empty placeholders (missing / null / empty / whitespace-only fields) are
 * stripped along with any orphan separator they leave behind, so
 * `"{full_name} - {company}"` evaluated against `{ company: "Acme" }` yields
 * `"Acme"`, not `" - Acme"`. Returns an empty string when no placeholder
 * resolved.
 *
 * What counts as "empty" is not decided here (objectui#10446). Each
 * placeholder's value goes through {@link displayValueOf}, the body of
 * {@link recordDisplayValueAt}: trim, then empty. This function used to test
 * the raw value against `null` / `undefined` / `''` on its own, so a
 * whitespace-only value counted as RESOLVED. The later whitespace collapse
 * then left its separator dangling: `{contract_no} - {name}` with a blank
 * `name` rendered `HT-2026-003 -`, while every value-keyed rung of
 * {@link getRecordDisplayName} judged the same value empty.
 */
export function formatTitleTemplate(
  titleFormat: string | { source?: string } | undefined | null,
  record: any,
): string {
  let template: string | undefined =
    typeof titleFormat === 'string'
      ? titleFormat
      : titleFormat && typeof titleFormat === 'object' && typeof titleFormat.source === 'string'
        ? titleFormat.source
        : undefined;

  if (!template || !record || typeof record !== 'object') return '';

  // Normalize handlebars-style `{{field}}` to single-brace `{field}` so a single
  // pass handles both. (Authoring tools and some legacy resolvers emit `{{…}}`.)
  template = template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, '{$1}');

  let anyResolved = false;
  let out = template.replace(/\{([^{}]+)\}/g, (_match, fieldName) => {
    const parts = String(fieldName).trim().split('.');
    let value: any = record;
    for (const p of parts) {
      if (value == null) break;
      value = (value as any)[p];
    }
    const shown = displayValueOf(value);
    if (shown === undefined) return EMPTY_TOKEN;
    anyResolved = true;
    return shown;
  });

  if (!anyResolved) return '';

  const sepBefore = new RegExp(`\\s*${SEPARATOR_CLASS}\\s*${EMPTY_TOKEN}`, 'g');
  const sepAfter = new RegExp(`${EMPTY_TOKEN}\\s*${SEPARATOR_CLASS}\\s*`, 'g');
  out = out
    .replace(sepBefore, '')
    .replace(sepAfter, '')
    .replace(new RegExp(EMPTY_TOKEN, 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();

  return out;
}

/**
 * Decide whether a field definition can serve as a record title. Excludes the
 * {@link NON_TITLE_TYPES} (dates, numbers, pickers, lookups, binary, …); a
 * `formula` is eligible only when it returns text. A field with no declared
 * type is treated as eligible (text-by-default), so loosely-typed metadata
 * still produces a name rather than falling through to `Record #…`.
 */
export function isTitleEligibleField(def: any): boolean {
  if (!def || typeof def !== 'object') return false;
  const type = typeof def.type === 'string' ? def.type.toLowerCase() : undefined;
  if (!type) return true;
  if (type === 'formula') {
    const ret = String(
      def.data_type ?? def.dataType ?? def.returnType ?? def.result_type ?? '',
    ).toLowerCase();
    return TEXT_FORMULA_RETURN_TYPES.has(ret);
  }
  return !NON_TITLE_TYPES.has(type);
}

/**
 * Normalize an `objectDef.fields` shape into an ordered `[name, def]` list.
 * Accepts both the record form (`{ name: { type } }`, declaration order =
 * insertion order) and the array form (`[{ name, type }]`).
 */
function fieldEntries(fields: any): Array<[string, any]> {
  if (!fields) return [];
  if (Array.isArray(fields)) {
    return fields
      .filter((f) => f && typeof f === 'object' && typeof f.name === 'string')
      .map((f) => [f.name as string, f]);
  }
  if (typeof fields === 'object') {
    return Object.keys(fields).map((k) => [k, fields[k]]);
  }
  return [];
}

/**
 * Per-`objectDef` memo for {@link deriveTitleField}. The derived title field is a
 * pure function of `objectDef.fields`, so caching it keyed by the `objectDef`
 * identity turns a per-record field scan (1000 redundant scans for a 1000-row
 * list) into a single scan per object definition. `WeakMap` so a discarded
 * objectDef is GC'd with its cache entry — no eviction logic, no leak.
 *
 * Stores `undefined` as the explicit "scanned, found nothing" result, so we use
 * `has()` (not a truthy lookup) to distinguish "cached undefined" from "not yet
 * cached". Only non-null object keys are cached (WeakMap rejects primitives).
 */
const deriveTitleFieldCache = new WeakMap<object, string | undefined>();

/** Uncached field scan — the body of {@link deriveTitleField}. */
function computeDerivedTitleField(objectDef: any): string | undefined {
  const entries = fieldEntries(objectDef?.fields).filter(([, def]) => isTitleEligibleField(def));
  if (entries.length === 0) return undefined;

  // 1. name-ish exact (in NAME_ISH_EXACT priority order).
  for (const wanted of NAME_ISH_EXACT) {
    const hit = entries.find(([name]) => name.toLowerCase() === wanted);
    if (hit) return hit[0];
  }

  // 2. name-ish affix.
  const affix = entries.find(([name]) => {
    const n = name.toLowerCase();
    return n.endsWith('_name') || n.endsWith('_title') || n.startsWith('name_');
  });
  if (affix) return affix[0];

  // 3. first title-eligible field by declaration order.
  return entries[0][0];
}

/**
 * Type-aware derivation (precedence step 4): pick the best title-eligible field
 * name from `objectDef.fields`, ranked:
 *
 *   1. name-ish exact   — `name`,`title`,`subject`,`label`,`full_name`,
 *                         `display_name` (case-insensitive)
 *   2. name-ish affix   — `*_name`, `*_title`, `name_*` (case-insensitive)
 *   3. declaration order — first remaining title-eligible field
 *
 * Returns the field name, or undefined when `fields` is absent/empty or holds
 * no title-eligible field.
 *
 * Memoized per `objectDef` identity (see {@link deriveTitleFieldCache}): the
 * field scan runs once per object definition, not once per record. The result is
 * byte-identical to the uncached computation — only the scan is cached, and only
 * when `objectDef` is a non-null object (the WeakMap key requirement).
 */
export function deriveTitleField(objectDef: any): string | undefined {
  // Only object keys can be memoized; primitives/null fall through uncached.
  if (objectDef === null || typeof objectDef !== 'object') {
    return computeDerivedTitleField(objectDef);
  }
  if (deriveTitleFieldCache.has(objectDef)) {
    return deriveTitleFieldCache.get(objectDef);
  }
  const derived = computeDerivedTitleField(objectDef);
  deriveTitleFieldCache.set(objectDef, derived);
  return derived;
}

/**
 * The declared name-field pointer, read exactly as {@link getRecordDisplayName}
 * reads it: the canonical `nameField` (ADR-0079 Phase 2), then its deprecated
 * `displayNameField` / `NAME_FIELD_KEY` aliases.
 *
 * One spelling, every reader. Inside this module that is the value-space
 * resolver and the name-space {@link resolveNameField}. Re-typing the `??`
 * chain at another reader is how two readers drift into disagreeing about
 * which field titles an object. No new alias is read here; this is the
 * existing ladder, extracted.
 *
 * Exported (objectui#9436) for callers that must rank the DECLARED pointer on
 * its own, apart from the type-aware derivation that {@link resolveNameField}
 * folds in after it. The record-page H1 needs exactly that: ADR-0079 puts the
 * declared pointer (steps 1+2) above the legacy `titleFormat` (step 3), and the
 * derivation (step 4) below it, so a caller that interleaves its own
 * `titleFormat` rendering has to read the two halves separately. Read the value
 * as `recordDisplayValueAt(record, declaredNameField(objectDef))`, which is how
 * {@link getRecordDisplayName} reads steps 1+2.
 *
 * Returns the pointer exactly as declared, or `undefined` when none is. It
 * never derives: an object that declares nothing answers `undefined` even when
 * its `fields` would derive a title field.
 */
export function declaredNameField(objectDef: any): any {
  return objectDef?.nameField ?? objectDef?.displayNameField ?? objectDef?.NAME_FIELD_KEY;
}

/**
 * WHICH FIELD titles this object — the name-space twin of
 * {@link getRecordDisplayName}, which answers what that field SAYS on one
 * record. Same ladder, minus the rungs that only exist per record:
 *
 *   1+2. the declared pointer ({@link declaredNameField});
 *   4.   else the type-aware derivation ({@link deriveTitleField}).
 *
 * The two omissions are deliberate, not oversights. `options.titleField`
 * (step 0) belongs to one view, not to the object. `titleFormat` (step 3) is a
 * render-only template, not a field name — there is no column, no sort key and
 * no `$select` entry to be had from it, which is the same reason ADR-0079
 * demoted it. A caller that wants a title for a `titleFormat`-only object wants
 * {@link getRecordDisplayName}, per record.
 *
 * Deliberately does NOT require the answer to exist in `objectDef.fields`: in
 * value-space the declared pointer is read off the RECORD, so demanding a field
 * def here would make the two resolvers disagree. A caller that needs a
 * RENDERABLE column checks presence itself — see {@link leadWithNameField}.
 *
 * Returns `undefined` when nothing declares or derives a name field.
 */
export function resolveNameField(objectDef: any): string | undefined {
  const declared = declaredNameField(objectDef);
  if (typeof declared === 'string' && declared.length > 0) return declared;
  return deriveTitleField(objectDef);
}

/**
 * Put the object's name field at the FRONT of a **synthesized** default column
 * list, so a list no author ever configured still lets you tell its rows apart.
 *
 * Why this exists (objectui#7245): the three faces that synthesize default list
 * columns each took a declared `highlightFields` verbatim. `highlightFields` is
 * the ADR-0085 "most important fields" role, and its canonical consumer — the
 * detail-page highlight strip — deliberately *excludes* the title field,
 * because the strip sits directly under the page H1 that already shows it. So
 * well-authored metadata routinely omits the name from `highlightFields`: the
 * showcase `showcase_account` declares `["status", "industry", "annual_revenue"]`
 * against `nameField: "name"`, and its default grid rendered 14 rows with no
 * name column and nothing to distinguish them.
 *
 * A list has no H1 to lean on, so the same role needs the opposite treatment
 * here. This is not a new convention: `deriveLookupColumns` in `@object-ui/fields`
 * already leads its picker columns with the display field and filters it out of
 * the declared list — the record-picker equivalent of this problem, solved the
 * same way. This makes the list faces agree with it.
 *
 * MOVES the name field rather than only prepending a missing one: an author who
 * lists it third still gets it first, which is what "the column that identifies
 * the row" means. Order among the remaining columns is untouched.
 *
 * NOT for author-declared column lists. A view that declares `columns` said what
 * it wants; overriding that would be exactly the renderer-side second-guessing
 * AGENTS.md Commandment #0.1 rules out. Every caller passes a list it
 * synthesized itself.
 *
 * Three cases return `columns` untouched, each guarding a rule that already
 * governs these column lists:
 *
 *  - **No field def** (nothing resolved, or the pointer names a field the object
 *    does not carry) — a synthesized list must never fabricate a column the
 *    object cannot render.
 *  - **`hidden: true`** — the author said don't show this field. That outranks
 *    the fact that it also titles the record; every one of these faces already
 *    drops hidden fields from its own walk.
 *  - **DERIVED onto a system-managed field.** {@link deriveTitleField} filters
 *    by TYPE only, so on an object with no name-ish business field it can land
 *    on a framework-injected column — and leading a default list with a raw id
 *    is precisely the regression objectui#2702 / #2777 fixed. A *declared*
 *    `nameField` is exempt: `sys_migration` really does point at `id`, and an
 *    author's explicit designation is not a heuristic misfire.
 */
export function leadWithNameField(objectDef: any, columns: string[]): string[] {
  const declared = declaredNameField(objectDef);
  const isDeclared = typeof declared === 'string' && declared.length > 0;
  const lead = isDeclared ? declared : deriveTitleField(objectDef);
  const def = lead ? objectDef?.fields?.[lead] : undefined;
  if (!lead || !def) return columns;
  if (def.hidden) return columns;
  if (!isDeclared && isSystemManagedField(lead, def)) return columns;
  return [lead, ...columns.filter((c) => c !== lead)];
}

/**
 * Standard name-ish keys probed directly on a *record* as a last resort before
 * the `Record #<id>` floor — used when `objectDef.fields` is absent so
 * {@link deriveTitleField} can't run (loosely-typed metadata, the lightweight
 * object stub `useRecordSearch` synthesizes for a hit whose object is not in
 * the app's metadata — `{ name: objectName }` — etc.). Mirrors the historical
 * hard-coded fallback chain the divergent resolvers used, so removing them is
 * non-regressive. Ordered by priority.
 *
 * objectui#6531 rewrote the parenthetical above: it used to say those search
 * candidates "carry only `name`/`titleField`", which read as evidence that some
 * producer puts `titleField` on an object-shaped payload. The census found
 * none, and the spec's object schema rejects the key outright.
 */
const NAME_ISH_RECORD_KEYS = [
  'name',
  'full_name',
  'fullName',
  'display_name',
  'displayName',
  'title',
  'subject',
  'label',
] as const;

/**
 * Read a non-empty string-ish display value off a record at `field`, else
 * `undefined`.
 *
 * THE definition of "this record has a value here" — the question every
 * value-keyed rung of {@link getRecordDisplayName} asks, and the reason a
 * whitespace-only field is not a title.
 *
 * ## Why this is exported (objectui#8350)
 *
 * A second reader existed. `record:details`' dedupe ladder in
 * `@object-ui/plugin-detail` asks the same question about the same record for
 * the same field, to decide which body-grid row duplicates the page H1 — and it
 * asked it with a hand-written raw `undefined` / `null` / `''` test, which a
 * whitespace-only value passes and this one does not. So for a record whose
 * title field held only spaces the two halves disagreed about whether that
 * field had a value at all: the H1 walked on to the next rung, while the grid
 * hid the row anyway — a field vanished to deduplicate against a heading that
 * never showed it. The ladder now calls THIS. One authority, not two
 * implementations that agree today.
 *
 * ⛔ Do not re-spell this test at a call site, and do not "just add a trim"
 * there: three things beyond the trim are part of the definition, and a second
 * implementation drifts on each of them independently —
 *   - an expanded/embedded reference object resolves through its Salesforce-
 *     style display chain and is EMPTY when that yields nothing (a bare
 *     `{ id }` lookup payload is not a title);
 *   - non-strings are stringified, so `0` and `false` ARE values, not blanks;
 *   - `null` and `undefined` are empty, and only those two.
 *
 * The rule itself is {@link displayValueOf}, which {@link formatTitleTemplate}
 * applies to each placeholder value (objectui#10446). So a `titleFormat`
 * placeholder is empty exactly when this function would call its field empty.
 */
export function recordDisplayValueAt(record: any, field: string | undefined): string | undefined {
  if (!field || !record || typeof record !== 'object') return undefined;
  return displayValueOf(record[field]);
}

/**
 * The value half of {@link recordDisplayValueAt}: one already-read value in,
 * its display string or `undefined` (empty) out. Trim, then empty.
 *
 * Module-private on purpose. It exists so the two readers in this file that
 * judge a single value, `recordDisplayValueAt` and each placeholder of
 * {@link formatTitleTemplate}, run ONE implementation of that judgement rather
 * than two that agree today (objectui#10446). Read its full definition on
 * {@link recordDisplayValueAt}.
 */
function displayValueOf(value: any): string | undefined {
  let v: any = value;
  if (v && typeof v === 'object') v = displayNameOfEmbeddedObject(v);
  if (v === null || v === undefined) return undefined;
  const s = typeof v === 'string' ? v.trim() : String(v);
  return s === '' ? undefined : s;
}

export interface RecordDisplayNameOptions {
  /**
   * Optional explicit title field (e.g. a view's `titleField` / gallery
   * `titleField` / kanban `cardTitle`). When set and it yields a non-empty
   * value on the record, it wins over everything — preserving each view's
   * author-chosen field. Pass nothing to use the object-level precedence only.
   */
  titleField?: string;
  /** Floor when the record has no id at all. Defaults to `'Untitled'`. */
  fallback?: string;
  /**
   * Whether to probe standard name-ish keys (`name`/`title`/…) directly on the
   * record when `objectDef.fields` is absent (precedence step 4b). Defaults to
   * `true`. Callers that have a better generic fallback to interleave (e.g. the
   * detail header prefers `schema.title`, the object label, over a guessed
   * record key) pass `false` so this step is skipped and the resolver returns
   * its `Record #<id>` floor instead — letting the caller decide.
   */
  deriveFromRecordKeys?: boolean;
}

/**
 * THE unified record display-name resolver (ADR-0079).
 *
 * Precedence (ADR-0079 Phase 2 makes the object's declared field canonical and
 * de-prioritizes the legacy `titleFormat` template):
 *   0. `options.titleField` (when provided & non-empty on the record) — lets
 *      a view keep its author-chosen title field. The object-level
 *      `objectDef.titleField` leg was removed in objectui#6531: the spec's
 *      object schema rejects that key, so nothing could produce it.
 *   1. `objectDef.nameField` — the NEW canonical record-title pointer
 *      (ADR-0079). A field name the server can return and query.
 *   2. `objectDef.displayNameField` / `objectDef.NAME_FIELD_KEY` — the
 *      deprecated alias of `nameField`, kept for back-compat.
 *   3. `objectDef.titleFormat` (rendered template) — LEGACY, render-only, kept
 *      for back-compat only; an explicitly-declared field (1/2) now wins over
 *      it. See the deprecation note on the branch below.
 *   4. type-aware derivation from `objectDef.fields` ({@link deriveTitleField}).
 *   4b. standard name-ish keys probed directly on the record
 *      ({@link NAME_ISH_RECORD_KEYS}) — the safety net for when `fields` is
 *      absent so derivation can't run.
 *   5. `Record #<id>` (using `record.id ?? record._id`), else `options.fallback`
 *      (default `'Untitled'`) for a truly id-less record.
 *
 * @param objectDef Object definition (may be `any`/partial — every field is
 *                  read defensively).
 * @param record    The record data.
 */
export function getRecordDisplayName(
  objectDef: any,
  record: any,
  options?: RecordDisplayNameOptions,
): string {
  // 0. Explicit title field — the caller's option, if it actually resolves on
  //    the record. This is a DECLARED key: every view config that offers a
  //    title pointer (`ui/CalendarConfig`, `ui/GalleryConfig`, `ui/GanttConfig`,
  //    `ui/ListMapConfig`, `ui/ObjectKanbanProps`, `ui/TimelineConfig`) declares
  //    `titleField`, and its author chose it for THIS view, so it outranks the
  //    object's own pointer by design.
  //
  //    An object-level `objectDef.titleField` used to be consulted here too, as
  //    a second `??` leg. Removed in objectui#6531: `@objectstack/spec`'s object
  //    schema is a `strictObject` that REJECTS `titleField` with
  //    `unrecognized_keys` — the same code a nonsense key gets — so no
  //    spec-compliant producer can ship it, and a census across both repos
  //    (metadata, every `getObjectSchema` implementation, the lookup-chip and
  //    search-candidate paths) found none that does. Reading it was a
  //    consumer-side alias for an undeclared key (AGENTS.md Commandment #0.1),
  //    ranked ABOVE the `nameField` ADR-0079 Phase 2 made canonical.
  const explicit = recordDisplayValueAt(record, options?.titleField);
  if (explicit) return explicit;

  // 1+2. Declared name field — the canonical `nameField` (ADR-0079 Phase 2),
  //      then its deprecated `displayNameField` / `NAME_FIELD_KEY` alias. An
  //      explicitly-declared field now wins over the legacy `titleFormat`
  //      template (step 3): an object that sets `nameField` resolves via it even
  //      if it also carries a stale `titleFormat`.
  //      The `??` chain itself lives in {@link declaredNameField} so the
  //      name-space {@link resolveNameField} reads the identical ladder.
  const declared = recordDisplayValueAt(record, declaredNameField(objectDef));
  if (declared) return declared;

  // 3. titleFormat (LEGACY, render-only template). DEPRECATED by ADR-0079: the
  //    server can neither return nor query a render-only template, so it can't
  //    be the canonical record-title pointer. Kept for back-compat with objects
  //    that still declare one and have no `nameField`/`displayNameField`.
  //    Composite titles should instead be a formula field designated as the
  //    object's `nameField`. Now evaluated AFTER the declared field (1+2).
  if (objectDef?.titleFormat) {
    const formatted = formatTitleTemplate(objectDef.titleFormat, record);
    if (formatted) return formatted;
  }

  // 4. Type-aware derivation from the object's fields.
  const derivedField = deriveTitleField(objectDef);
  const derived = recordDisplayValueAt(record, derivedField);
  if (derived) return derived;

  // 4b. Name-ish keys on the record itself — the safety net for when the
  //     object schema (with its field *types*) wasn't available to
  //     `deriveTitleField` (objectDef null/partial, a different fetched shape,
  //     a lightweight search candidate, …). Skipped naturally when step 4
  //     already returned, and opt-out via `deriveFromRecordKeys: false`.
  if (options?.deriveFromRecordKeys !== false && record && typeof record === 'object') {
    // (i) exact standard keys (name, full_name, title, …).
    for (const key of NAME_ISH_RECORD_KEYS) {
      const v = recordDisplayValueAt(record, key);
      if (v) return v;
    }
    // (ii) `*_name` / `*_title` / `name_*` AFFIX on the record's own keys.
    //      This is what lets an object whose label lives in `activity_name`
    //      (the build agent's `<entity>_name` convention) resolve to the real
    //      name even when no typed objectDef reached the resolver — the exact
    //      ADR-0079 repro. `*_id` / `_`-prefixed / system keys are skipped, so
    //      `owner_id`, `organization_id`, `created_by` never win.
    for (const key of Object.keys(record)) {
      const k = key.toLowerCase();
      if (k === 'id' || k === '_id' || k.endsWith('_id') || k.startsWith('_')) continue;
      if (k.endsWith('_name') || k.endsWith('_title') || k.startsWith('name_')) {
        const v = recordDisplayValueAt(record, key);
        if (v) return v;
      }
    }
  }

  // 5. Record-#id floor; only a truly id-less record hits the bare fallback.
  const id = record?.id ?? record?._id;
  if (id !== null && id !== undefined && String(id).trim() !== '') {
    return `Record #${id}`;
  }
  return options?.fallback ?? 'Untitled';
}
