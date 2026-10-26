/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import type { DateFieldMetadata, DateTimeFieldMetadata, FieldMetadata, SelectOptionMetadata } from '@object-ui/types';
import { ComponentRegistry, percentDisplayValue, type PercentScale, getRecordDisplayName, humanizeLabel, isEmptyValue, isMissingForRequired, formatDate, formatDateTime, formatDateTimeCompactParts, formatRelativeDate, toDisplayDate, extractRecords, withoutDeniedFields, type RegistryComponentMeta, type DateDisplayOptions } from '@object-ui/core';
// The platform's own value-shape contract, asked rather than restated
// (objectui#6744). See `locationStoredValueSchemaFor` below for why this is a
// runtime import in the barrel and not a hand-written coordinate range.
// `resolveFieldScale` is the same kind of ask: the width an ABSENT `scale`
// means is the protocol's answer, not this package's (objectui#9843).
import { valueSchemaFor, resolveFieldScale } from '@objectstack/spec/data';
import { useLocalization, useDisplayLocale, formatDisplayNumber } from '@object-ui/i18n';
import { Badge, Avatar, AvatarImage, AvatarFallback, Button, Checkbox, EmptyValue, cn, setFieldReadFaceResolver } from '@object-ui/components';
import { Check, Copy, Phone as PhoneIcon, MapPin, CircleQuestionMark, Lock, Star } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/react';
import { SchemaRendererContext as _SchemaRendererContext } from '@object-ui/react';
import { useRelatedRecordActions } from '@object-ui/react';
import { usePermissions } from '@object-ui/permissions';
import { withFieldCarrier } from './withFieldCarrier.js';
// Pure formatting rule shared with `AddressField`'s readonly branch — no React,
// so this does not pull the widget out of its lazy chunk (objectui#4037).
import { formatAddress, type AddressValue } from './widgets/address-format.js';
// The same arrangement for numbers: one formatting call shared with
// `NumberField`'s read-only branch (objectui#11431), and likewise for currency
// (`CurrencyField`) and percent (`PercentField`) (objectui#11444).
import { formatNumberFieldValue, formatCurrency, formatPercentPoints, percentCellScale } from './widgets/number-format.js';
import { useFieldTranslation } from './widgets/useFieldTranslation.js';
import { useBooleanValueLabel } from './widgets/booleanValueLabel.js';

// Module-level cache so multiple renderers fetching the same lookup ID
// only trigger one network call. Keyed by `${objectName}:${id}`. It holds the
// fetched RECORD and the referenced object's schema, not a resolved name: the
// name is a display value, resolved per render from the row the viewer may
// read (objectui#10501), so it follows the permission policy of the render
// that shows it rather than the one in force when the record arrived.
type LookupCacheEntry =
  | { state: 'pending'; promise: Promise<void> }
  | { state: 'ok'; record: Record<string, unknown> | null | undefined; schema: unknown }
  | { state: 'err' };
const lookupNameCache: Map<string, LookupCacheEntry> = new Map();

/**
 * Pick the most reasonable display name from an arbitrary record object.
 * Tries common name-like keys in priority order, then falls back to undefined.
 */
export function pickRecordDisplayName(
  record: Record<string, unknown> | null | undefined,
  preferredField?: string,
): string | undefined {
  if (!record || typeof record !== 'object') return undefined;
  // Caller-provided hint (typically the target object's displayNameField)
  // beats every heuristic so domain-specific names like `legal_name` win.
  if (preferredField) {
    const pv = record[preferredField];
    if (typeof pv === 'string' && pv.trim()) return pv.trim();
    if (typeof pv === 'number') return String(pv);
  }
  const candidates = ['name', 'full_name', 'display_name', 'label', 'title', 'subject', 'username'];
  for (const k of candidates) {
    const v = record[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  // Salesforce-style: build a composite name from common person-record
  // fields when no top-level display field is present. Preferred over the
  // raw `email` fallback below so `Bob Lin` beats `bob.lin@acme.com`.
  const first = record['first_name'];
  const last = record['last_name'];
  const salutation = record['salutation'];
  const composite = [salutation, first, last]
    .filter((p) => typeof p === 'string' && (p as string).trim())
    .map((p) => (p as string).trim())
    .join(' ');
  if (composite) return composite;
  // Email is the last-resort identifier (better than the opaque id).
  const email = record['email'];
  if (typeof email === 'string' && email.trim()) return email.trim();
  // Heuristic fallback: pick the first string-valued field whose name looks
  // like a human-facing identifier (legal_name, framework_name, control_number,
  // policy_code, etc.). This covers domain schemas that don't use the
  // hardcoded canonical names above. We skip obvious metadata keys.
  const SKIP = new Set([
    'id', '_id', 'organization_id', 'created_by', 'updated_by',
    'created_at', 'updated_at', 'tenant_id',
  ]);
  const SUFFIXES = ['_name', '_title', '_number', '_code', '_label'];
  for (const [k, v] of Object.entries(record)) {
    if (SKIP.has(k)) continue;
    if (k.endsWith('_id')) continue;
    if (!SUFFIXES.some((s) => k.endsWith(s))) continue;
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

// Module-level cache of referenced-object schemas (keyed by object name) so
// many lookup cells pointing at the same object trigger ONE metadata fetch.
type RefSchemaCacheEntry =
  | { state: 'pending'; promise: Promise<void> }
  | { state: 'ok'; schema: unknown }
  | { state: 'err' };
const refObjectSchemaCache: Map<string, RefSchemaCacheEntry> = new Map();

/**
 * Fetch (and cache) the referenced object's schema via
 * `dataSource.getObjectSchema`. Resolves to `undefined` when the data source
 * doesn't expose schema metadata or the fetch fails — callers fall back to the
 * key heuristic in that case.
 */
async function fetchRefObjectSchema(dataSource: any, referenceTo: string): Promise<any> {
  const settled = () => {
    const entry = refObjectSchemaCache.get(referenceTo);
    return entry?.state === 'ok' ? entry.schema : undefined;
  };
  const existing = refObjectSchemaCache.get(referenceTo);
  if (existing?.state === 'pending') {
    await existing.promise;
    return settled();
  }
  if (existing) return settled();
  const getSchema = dataSource?.getObjectSchema;
  if (typeof getSchema !== 'function') return undefined;
  const promise = Promise.resolve()
    .then(() => getSchema.call(dataSource, referenceTo))
    .then((schema: unknown) => { refObjectSchemaCache.set(referenceTo, { state: 'ok', schema }); })
    .catch(() => { refObjectSchemaCache.set(referenceTo, { state: 'err' }); });
  refObjectSchemaCache.set(referenceTo, { state: 'pending', promise });
  await promise;
  return settled();
}

/**
 * React hook wrapper over {@link fetchRefObjectSchema}: returns the referenced
 * object's schema once loaded (re-rendering when it lands), `undefined` while
 * pending or when schema metadata isn't available.
 */
function useRefObjectSchema(referenceTo: string | undefined): any {
  const ctx = React.useContext(_SchemaRendererContext);
  // No cast: the context declares `DataSource | null | undefined` since
  // objectui#7912, and this read has no second channel to merge with.
  const dataSource = ctx?.dataSource;
  const [, force] = React.useState(0);
  const canFetch =
    !!referenceTo && !!dataSource && typeof dataSource.getObjectSchema === 'function';

  React.useEffect(() => {
    if (!canFetch) return;
    const entry = refObjectSchemaCache.get(referenceTo!);
    if (entry && entry.state !== 'pending') return; // settled before this render
    let alive = true;
    fetchRefObjectSchema(dataSource, referenceTo!).then(() => {
      if (alive) force((n) => n + 1);
    });
    return () => { alive = false; };
  }, [canFetch, referenceTo, dataSource]);

  if (!canFetch) return undefined;
  const entry = refObjectSchemaCache.get(referenceTo!);
  return entry?.state === 'ok' ? entry.schema : undefined;
}

/**
 * Resolve an expanded/fetched lookup record to its display name the same way
 * the picker does (issue #2357): explicit `displayField` first, then the
 * unified ADR-0079 resolver against the referenced object's schema
 * (`nameField`/`displayNameField` → `titleFormat` → type-aware derivation,
 * which excludes autonumber). Only when no schema is available does it fall
 * back to {@link pickRecordDisplayName}, whose `_number`/`_code` suffix scan
 * can otherwise surface an autonumber (`0001`) over the record's real name.
 *
 * The name is a DISPLAY value, so every rung above reads the row as the viewer
 * may read it on the referenced object `referenceTo` (objectui#10501): with a
 * loaded `policy`, the fields it denies are removed first (see
 * {@link withoutDeniedFields}), and the ladder falls through exactly as it does
 * for the row a stripping backend serves. `policy` is required, so no caller
 * can resolve a name from the row as served by leaving it out.
 */
function resolveLookupRecordName(
  record: Record<string, unknown> | null | undefined,
  refSchema: any,
  displayField: string | undefined,
  policy: FieldReadPolicy,
  referenceTo: string | undefined,
): string | undefined {
  if (!record || typeof record !== 'object') return undefined;
  const shown = withoutDeniedFields(record, policy, referenceTo);
  if (refSchema) {
    const resolved = getRecordDisplayName(refSchema, shown, { titleField: displayField });
    // Stop short of the resolver's `Record #<id>` / `Untitled` floor so the
    // cell keeps its own id-placeholder handling for nameless records.
    const id = (shown as any).id ?? (shown as any)._id;
    const isFloor =
      resolved === 'Untitled' || (id != null && resolved === `Record #${id}`);
    if (!isFloor && resolved) return resolved;
  }
  return pickRecordDisplayName(shown, displayField);
}

/** The two members of the permission context the lookup cell's read gate asks. */
type FieldReadPolicy = Pick<ReturnType<typeof usePermissions>, 'isLoaded' | 'checkField'>;

/**
 * Heuristic: detect strings that look like opaque foreign-key IDs (e.g. nanoid
 * or BSON ObjectId).
 *
 * ⛔ Nothing in this repo calls it any more, and re-introducing a caller that
 * decides PRESENTATION from it would re-open objectui#8695. It used to gate
 * `LookupCellRenderer`'s muted `—`, i.e. it decided how an unresolved
 * reference was drawn from the SHAPE of the string rather than from whether
 * anything resolved — so `'Ada Lovelace'` printed as a confident name and an
 * opaque id lost its value, two opposite answers to one epistemic state. The
 * export is kept because it is part of this package's published surface and
 * retiring it is a breaking change no display card is entitled to make; the
 * shape question itself is legitimate (a picker filter, an id-vs-name guess),
 * it is only an answer to "what did this screen resolve?" that it can never be.
 */
export function isLikelyOpaqueId(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  // 12-32 chars, only [A-Za-z0-9_-], no whitespace.
  if (!/^[A-Za-z0-9_-]{12,32}$/.test(v)) return false;
  // Must have BOTH upper- and lower-case letters (real words rarely do at this length).
  // Also accept tokens that contain `_` or `-` separators alongside any case mix.
  const hasUpper = /[A-Z]/.test(v);
  const hasLower = /[a-z]/.test(v);
  const hasDigitOrSep = /[0-9_-]/.test(v);
  return (hasUpper && hasLower) || (hasUpper && hasDigitOrSep) || (hasLower && hasDigitOrSep);
}

/**
 * What {@link useLookupName} learned about one referenced record.
 *
 * - `named` — the reader's read returned the record and a display field named it.
 * - `absent` — the reader's own read SETTLED with no record (objectui#13335):
 *   `findOne` answered `null`, the `DataSource` contract's "not found", which
 *   is what a 404 becomes for a record the viewer may not read. The platform
 *   answers a record hidden from this reader and a record that does not exist
 *   identically on purpose (existence non-disclosure, objectui#8631), so this
 *   state is that fused answer and nothing finer.
 * - `undefined` — anything else: not asked, still in flight, the read threw,
 *   or a record came back that no display field could name.
 */
type LookupNameAnswer = { state: 'named'; name: string } | { state: 'absent' } | undefined;

/**
 * Fetch-on-demand resolver for foreign-key IDs that weren't expanded by the
 * server. Reads `dataSource` from SchemaRendererContext; safely no-ops if
 * the context isn't installed. Returns a {@link LookupNameAnswer}.
 *
 * The effect only FETCHES: the record and the referenced object's schema are
 * cached, and the name is resolved from them on every render with the
 * caller's `policy` (objectui#10501). A policy that loads or changes after the
 * record arrived therefore relabels the cell on the render it causes, with no
 * second read — a name resolved inside the effect would be fixed by the policy
 * of the render that STARTED the fetch, and re-running the effect could not
 * move it, because a settled entry returns early below.
 */
function useLookupName(
  referenceTo: string | undefined,
  value: unknown,
  displayField: string | undefined,
  policy: FieldReadPolicy,
): LookupNameAnswer {
  const ctx = React.useContext(_SchemaRendererContext);
  const dataSource = ctx?.dataSource;
  const [, force] = React.useState(0);

  const isResolvable =
    !!referenceTo &&
    !!dataSource &&
    typeof dataSource.find === 'function' &&
    (typeof value === 'string' || typeof value === 'number') &&
    value !== '';
  // The preferred display field is part of the cache identity (objectstack-ai/objectstack#2926 ⑧). The
  // entry now holds the record, not a name, so two columns with different
  // `displayField`s could share one; the key is left as it was so that this
  // change does not alter how many reads a screen makes.
  const cacheKey = isResolvable
    ? `${referenceTo}:${String(value)}:${displayField ?? ''}`
    : '';

  React.useEffect(() => {
    if (!isResolvable) return;
    const existing = lookupNameCache.get(cacheKey);
    if (existing && existing.state !== 'pending' && (existing as any).promise == null) return;
    if (existing?.state === 'pending') return;

    const promise: Promise<void> = (async () => {
      try {
        let record: Record<string, unknown> | undefined;
        if (typeof (dataSource as any).findOne === 'function') {
          record = await (dataSource as any).findOne(referenceTo, value);
        } else {
          // Top-level `$top`, not `{ options: { $top: 1 } }` (objectui#4025):
          // `options` is not a `QueryParams` key and no adapter reads it. Here
          // the nesting was harmless — the filter is primary-key equality, so
          // the answer is at most one row with or without a cap — but it is the
          // same spelling that cost `object-kanban` its row cap, and leaving one
          // live instance in the repo is what makes the next one look precedented.
          const result = await (dataSource as any).find(referenceTo, {
            $filter: { id: value },
            $top: 1,
          });
          // Read the rows through `@object-ui/core`'s `extractRecords` rather
          // than a fourth hand-rolled ladder. This site used to spell it
          // `result?.value || result?.data || []` — `value` AHEAD of `data`,
          // the ONE rows member `QueryResult` (`@object-ui/types`) declares.
          // A producer emitting both was resolved to the undeclared key
          // (objectui#6917 arm A). `extractRecords` accepts the same shapes
          // (bare array, `data`, `value`) in the order the contract implies,
          // and is the single measured answer for this seam (objectui#6839).
          const records: any[] = extractRecords(result);
          record = records[0];
        }
        // Resolve through the referenced object's schema (nameField /
        // titleFormat) so the chip agrees with the picker — the bare key
        // heuristic alone can surface an autonumber over the real name.
        const schema = await fetchRefObjectSchema(dataSource, referenceTo!);
        lookupNameCache.set(cacheKey, { state: 'ok', record, schema });
      } catch {
        lookupNameCache.set(cacheKey, { state: 'err' });
      }
      force((n) => n + 1);
    })();

    lookupNameCache.set(cacheKey, { state: 'pending', promise });
  }, [cacheKey, isResolvable, referenceTo, value, dataSource]);

  if (!isResolvable) return undefined;
  const entry = lookupNameCache.get(cacheKey);
  if (entry?.state !== 'ok') return undefined;
  if (entry.record == null) return { state: 'absent' };
  const name = resolveLookupRecordName(entry.record, entry.schema, displayField, policy, referenceTo);
  return name ? { state: 'named', name } : undefined;
}

/**
 * Safe label resolver for cell-level UI strings. Falls back to the English
 * default when no I18nProvider is available or when the key is missing.
 */
function useFieldLabel() {
  // useObjectTranslation is provider-safe (its context read is optional and
  // react-i18next falls back to the global instance), so no try/catch —
  // wrapping a hook call in try/catch violates rules-of-hooks: a throw after
  // some hooks ran would desync hook order on the next render.
  const { t } = useObjectTranslation();
  return (key: string, fallback: string) => {
    const v = t(key);
    return !v || v === key ? fallback : v;
  };
}

/**
 * Raw translate fn (with interpolation params) for cell-level strings, or
 * undefined when no I18nProvider is mounted — callers keep their English
 * fallback in that case.
 */
function useFieldTranslate(): ((key: string, params?: Record<string, unknown>) => string) | undefined {
  // useObjectTranslation is provider-safe (optional context read; react-i18next
  // falls back to the global instance), so it never throws — no try/catch, which
  // would wrap a hook call and violate rules-of-hooks. Mirrors useFieldLabel.
  const { t } = useObjectTranslation();
  return t as (key: string, params?: Record<string, unknown>) => string;
}

// Only the two symbols this module actually CALLS are imported eagerly. Every
// field widget used to be imported here as well, statically, purely to hand a
// component reference to the docs-demo `createFieldRenderer()` wrapper —
// removed with it (objectui#3910). The live registration path resolves widgets
// through the lazy loaders in `fieldWidgetMap` below, so nothing here needs a
// static reference; the widgets stay publicly available via the `export * from
// './widgets/…'` block at the end of this file.
import { ImageLightbox } from './widgets/ImageLightbox.js';
import { readFileValue, readFileValues, type FileValueView } from './widgets/file-value.js';
// The one view/download affordance every `file` surface renders (objectui#9161).
// Shared with `FileField` rather than copied into it; deliberately NOT
// re-exported below, so this package's published surface is unchanged.
import { FileValueAffordance, RestrictedFileAffordance } from './widgets/file-affordance.js';

/**
 * Cell renderer props
 */
export interface CellRendererProps {
  value: any;
  field: FieldMetadata;
  isEditing?: boolean;
  onChange?: (value: any) => void;
  /**
   * The row's values, for a renderer whose value only means something next to
   * a sibling column — the cell-side counterpart of the edit widget's
   * `FieldWidgetComponentProps.dependentValues` (objectui#12613). The console's
   * `recipient-picker` face reads the row's `recipient_type` from it, as the
   * picker reads the form record's.
   *
   * A call site that holds the row passes it; a renderer that needs a sibling
   * and gets none draws the stored value as the text cell does, so a call site
   * that does not pass it changes nothing.
   */
  dependentValues?: Record<string, unknown>;
  /**
   * The host's answer to "is this declared deadline settled for this row?"
   * (objectui#11815) — `isDeadlineSettled` from `@object-ui/core`, which
   * evaluates the field's `settledWhen` against the row the host holds. A cell
   * cannot evaluate a predicate, so the host hands it the verdict.
   *
   * While it is `true` the `date` and `datetime` cells paint no overdue wording
   * and no overdue colour: the relative wording falls back to the neutral
   * phrase a non-deadline reads. Absent or `false` changes nothing.
   */
  deadlineSettled?: boolean;
  /**
   * Write the year on a current-year date too (objectui#13331), read by the
   * `date` and `datetime` cells and handed to `formatDate` /
   * `formatRelativeDate` as `DateDisplayOptions.alwaysShowYear`.
   *
   * The record header's highlights strip passes it: its chips sit side by
   * side, and "End Date Sep 15" beside "Start Date Sep 15, 2025" read as a
   * date next month. Absent or `false` changes nothing, so a grid cell keeps
   * the default face that drops the current year.
   */
  alwaysShowYear?: boolean;
}

// `coerceToSafeValue` lives in `./coerceToSafeValue.ts` (objectui#8580) so
// that `./widgets/richTextDisplay.js` — a module this barrel imports — can
// reach it without importing the barrel back (the cycle `4bb940b6e` avoided). It is
// re-exported here unchanged: it is part of this package's published surface.
import { coerceToSafeValue } from './coerceToSafeValue.js';
export { coerceToSafeValue };

/**
 * ## This package and the emptiness FLOOR (objectui#8496)
 *
 * `@object-ui/core`'s `isEmptyValue` is the weakest common claim — `null`,
 * `undefined`, `''`, `[]` — and every guard in this file now stands in a STATED
 * relation to it instead of re-spelling its members. There are three relations,
 * and all three are legitimate:
 *
 *  - **the floor exactly** — `SelectCellRenderer`, `LookupCellRenderer`,
 *    `TextCellRenderer`, `FormulaCellRenderer` (a numeric result past its
 *    guard is then drawn by `NumberCellRenderer`, objectui#11683, so a
 *    `returnType: 'number'` formula holding whitespace answers this helper's
 *    extension below), `ColorSwatchCellRenderer`, and
 *    since objectui#8678 `MaskedCellRenderer` (on the coerced text, as `text`
 *    reads it), `VectorCellRenderer` and `GridCellRenderer`;
 *  - **the floor EXTENDED** — this helper (+ whitespace, on the coerced text);
 *    `UserCellRenderer` (+ every falsy scalar); `BooleanCellRenderer`
 *    (+ every non-boolean, objectui#8582); `DateCellRenderer` /
 *    `DateTimeCellRenderer` (+ every falsy scalar, so the numeric epoch is
 *    empty, and + every unparsable one, objectui#8581);
 *  - **the floor with a member DECLINED, out loud** — `JsonCellRenderer` draws
 *    the two-character literal for `[]` on purpose (objectui#8474 measured and
 *    kept it), `LocationCellRenderer`, `AddressCellRenderer` and the
 *    `composite` / `record` face (`StructuredValueCell`) inherit that through
 *    their JSON fallback, and `FileCellRenderer` states "0 files".
 *
 * ⛔ Those disagreements are MEASURED, not drift: do not "finish the job" by
 * making every renderer answer the floor. The pins that go red if one is
 * flattened are `__tests__/emptinessFloorExtensions-8496.test.tsx`.
 *
 * ---
 *
 * A coerced cell text with nothing in it is NOT a cell value (objectui#8490).
 *
 * `coerceToSafeValue([])` joins zero entries into `''`, and every renderer
 * below that fed that string on to a coercion drew something the record never
 * held: `Number('')` is `0`, so the number / currency / percent family printed
 * a digit (and a 0% progress bar); the email / url / phone family wrapped it
 * in a live anchor whose `href` was `mailto:` / `tel:` / nothing; and
 * `DateCellRenderer` handed it to `formatDate`, whose own hand-rolled em-dash
 * is a bare punctuation mark to a screen reader. A stored `''` reaches the
 * same `Number('')` fabrication one input-shape over, so the test is on the
 * coerced TEXT, not on the array: there is no number, address or date in a
 * blank string, whatever produced it. Whitespace counts as blank for the same
 * reason — `Number('  ')` is `0` too.
 *
 * ⛔ Not the package's general emptiness predicate — the renderers do not agree
 * on what "empty" means, and the roster above says where each one stands. This
 * answers ONE question for the renderers that coerce to text before they draw:
 * "did the coercion leave anything to draw?". `BooleanCellRenderer` does not
 * coerce to text and does not ask it.
 */
function isBlankCellText(safe: ReturnType<typeof coerceToSafeValue>): boolean {
  // THE FLOOR by name, taken on the COERCED text rather than on the raw value
  // (objectui#8496). `[]` never reaches it as an array — `coerceToSafeValue`
  // joins zero entries into `''`, which is the floor's string member.
  return (
    isEmptyValue(safe) ||
    // THE EXTENSION: whitespace counts as blank, because `Number('  ')` is `0`
    // too. It is not a floor member — `'   '` is a value on the gallery, the
    // kanban and `TextCellRenderer`.
    (typeof safe === 'string' && safe.trim() === '')
  );
}

/**
 * An OBJECT LITERAL is not a value of a string-, code- or reference-typed cell
 * (objectui#8596).
 *
 * The other half of the census objectui#8481 / objectui#8490 / objectui#8580
 * ran on `[]`. Where `[]` made a renderer draw nothing or fabricate a zero,
 * `{}` made it fabricate an IDENTITY: a live `href="mailto:[Object]"` anchor
 * with a copy button, a swatch whose CSS background was the string
 * `[object Object]`, an avatar captioned "U" labelled "User", the literal
 * `[Object Object]` in a status badge.
 *
 * `@objectstack/spec` types every one of those families as a string or a code:
 * `email` / `url` / `phone` / `color` are `STRING_VALUE_TYPES` ("Value is a
 * plain string"; the write seam is `z.string()`), the option families resolve
 * to `z.enum(codes)` or `z.string()`, and `user` shares the reference arm with
 * `lookup`. A plain object is a value of none of them — so the cell prints the
 * one answer this package has for "text for a value that is not a string"
 * (`coerceToSafeValue`, exactly as `text` prints it) and draws no affordance
 * that asserts something the record never stored. That is objectui#8580's
 * ruling for `markdown` / `html` / `richtext`, applied to the families that
 * still invented instead.
 *
 * ⛔ NOT arrays. `coerceToSafeValue` joins an array's entries, and a one-entry
 * array of a real address still formats and still links — the objectui#8490
 * email ruling, re-pinned by objectui#8580. `[]` itself never reaches here:
 * it coerces to `''` and every caller below already answers it with the shared
 * affordance. A `Date` is not a plain object either; `coerceToSafeValue`
 * carries its own ISO branch for it.
 */
function isPlainObjectValue(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

import { resolveFieldCurrency } from './currency.js';
export { resolveFieldCurrency };

/**
 * `formatCurrency` lives beside `formatNumberFieldValue` in
 * `./widgets/number-format.ts`, re-exported here under its long-standing
 * `@object-ui/fields` name: `CurrencyField`'s read-only branch calls the same
 * function `CurrencyCellRenderer` below calls, and the lazily loaded widget
 * cannot import this barrel (objectui#11444). The width (the currency's ISO
 * 4217 minor-unit count, every amount, no whole-amount trimming) and its
 * history are documented there.
 */
export { formatCurrency };

/**
 * Format currency value in compact form for mobile display.
 * E.g., $150,000 → $150K, $1,200,000 → $1.2M
 * When `currency` is undefined, returns a compact number without symbol.
 */
export function formatCompactCurrency(value: number, currency?: string, locale?: string): string {
  if (!currency) {
    try {
      const formatted = formatDisplayNumber(value, {
        locale,
        notation: 'compact',
        maximumFractionDigits: 1,
      });
      return formatted.replace(/\.0(?=[KMBT])/, '');
    } catch {
      return String(value);
    }
  }
  try {
    const formatted = formatDisplayNumber(value, {
      locale,
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    });
    // Strip trailing ".0" before compact suffix for consistent cross-environment output
    // e.g. "$150.0K" → "$150K" while keeping "$1.5M" intact
    return formatted.replace(/\.0(?=[KMBT])/, '');
  } catch {
    return `${currency} ${value}`;
  }
}

/**
 * Format a plain number with thousands separators at a fixed display width, no
 * currency symbol. `formatCurrency` renders an amount with no currency resolved
 * through the same call shape (`./widgets/number-format.ts`): we'd rather
 * render `1,234.50` than silently assume USD.
 */
export function formatNumber(value: number, decimals: number = 2, locale?: string): string {
  try {
    // Deliberately passes NO `scale`: `decimals` here is a display width the
    // caller chose, not a field's declared scale, so the ordinal no-grouping
    // policy must not fire: a caller's `decimals: 0` still keeps its
    // separators.
    return formatDisplayNumber(value, {
      locale,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return value.toFixed(decimals);
  }
}

/**
 * `percentCellScale` lives beside `formatPercentPoints` in
 * `./widgets/number-format.ts` and is re-exported here: the storage scale the
 * percent cell reads a field at, so every face rendering the cell's number for
 * the same field reads the same answer by reference (objectui#11475).
 */
export { percentCellScale };

/**
 * Format a stored percentage at the storage the caller STATES.
 *
 * `percentScale` is REQUIRED (objectui#11475): `'fraction'` (0.8 means 80%) or
 * `'whole'` (80 means 80%), the spec's `PercentScale`. A face holding a field
 * reads it with {@link percentCellScale} (the spec's `percentScaleOf`, a
 * fraction unless the field declares a `max` above 1); a face without one
 * states what it knows. A value outside the union throws. This used to guess
 * from the value's magnitude (`percentDisplayValue`'s old body), so a
 * fraction-stored `1` read `1%` here and `100%` in the read-only form.
 *
 * FROM `formatPercent(value, precision, locale)` TO
 * `formatPercent(value, percentScale, precision, locale)`.
 *
 * `locale` is the last positional parameter, matching {@link formatNumber} and
 * {@link formatCurrency}. Callers should pass the tag from
 * `useDisplayLocale()`.
 *
 * Before objectui#4553 this function took no locale and never touched `Intl`:
 * its whole body was `${percentDisplayValue(value).toFixed(precision)}%`, so it
 * rendered in NO locale rather than the machine's — an ASCII decimal mark and
 * never a grouping separator, byte-identical on every machine. That made
 * `1235%` the output everywhere, which is wrong in en-US as well as in German,
 * so the grouping and the locale are fixed together: en output MOVES from
 * `1235%` to `1,235%` at four digits and up, and that move is the fix.
 */
export function formatPercent(
  value: number,
  percentScale: PercentScale,
  precision: number = 0,
  locale?: string,
): string {
  // The magnitude at the STATED storage, through the shared core helper, so
  // the list cell and the dashboard measure formatter (`formatMeasure`) scale
  // by one rule.
  const displayValue = percentDisplayValue(value, percentScale);
  // The objectui#9808 clamp that stood here was retired at its own SUNSET
  // (objectui#11073): `@objectstack/spec` 17.5.0 refuses a `scale` above 100 at
  // the declaration, so the width the engine cannot render no longer arrives.
  // The rendering (the locale's percent convention, the grouping, the width)
  // is `formatPercentPoints`, the call `PercentField`'s read-only branch makes
  // too (objectui#11444); its comment carries why it is `'percentPoints'` and
  // never `style: 'percent'` (objectui#4590).
  return formatPercentPoints(displayValue, precision, locale);
}

/**
 * Humanize a snake_case or kebab-case string into Title Case — the fallback
 * label when no explicit `option.label` exists.
 *
 * Defined in `@object-ui/core` (`utils/humanize-label.ts`) and re-exported here
 * because this package is one of its two doorways: `plugin-grid`,
 * `plugin-gantt` and `plugin-detail` read it from `@object-ui/fields`, while
 * `plugin-charts` reads the same function straight from core. Until
 * objectui#5444 this file and `plugin-charts`' `ObjectChart.tsx` each held a
 * byte-identical private copy; core is the shared ancestor both packages
 * already depend on, so the convention has one home and no new dependency edge
 * (objectui#4389: core-canonical logic, plugins consume). The core docstring
 * carries the convention itself, and the reason it stays distinct from
 * `humanizeFieldKey`'s camelCase-splitting KEY convention.
 */
export { humanizeLabel };

/**
 * The date/datetime display path - `@object-ui/core`'s `utils/date-display.ts`
 * (objectui#7178), re-exported here under its original names so every existing
 * consumer of `@object-ui/fields` is unchanged.
 *
 * It moved for the reason `formatDisplayNumber` moved in objectui#4576: this
 * barrel is a React package, and the React-free engine could not import from
 * it. `core`'s `formatMeasure` needed this exact path - a dataset measure over
 * a date field was rendering its raw ISO string - and the alternative to
 * moving was a second date convention in `dataset-format.ts`, which is the
 * drift #4576 already paid for once with percent.
 */
export { formatDate, formatDateTime, formatDateTimeCompactParts, formatRelativeDate };
export type { DateDisplayOptions };

/**
 * Single-line cell value with a working ellipsis and a full-text fallback.
 *
 * `truncate` on a bare inline `<span>` never clips — an inline box has no
 * width box for `overflow:hidden` / `text-overflow:ellipsis` to act on, so
 * the value renders at full content width and the tail is silently cut by
 * whatever ancestor happens to clip (the detail card edge), with no ellipsis
 * (objectui#3466; same mechanism as the JSON cell in objectui#2578).
 * Block-level + `max-w-full` gives the span its parent's width to truncate
 * against, and as a flex item its `overflow:hidden` zeroes the automatic
 * min-size so it can shrink below the text width. The `title` keeps the full
 * text reachable on hover — host rows (detail sections) put their inline-edit
 * hint in *their* `title`, so the value's full text must live on the value
 * element itself, where it takes precedence under the cursor.
 */
function TruncatedText({
  text,
  className,
}: {
  text: string;
  className?: string;
}): React.ReactElement {
  return (
    <span className={cn('block max-w-full truncate', className)} title={text}>
      {text}
    </span>
  );
}

/**
 * Text field cell renderer
 */
export function TextCellRenderer({ value }: CellRendererProps): React.ReactElement {
  const safe = coerceToSafeValue(value);
  // THE FLOOR by name and nothing more (objectui#8496), on the coerced text.
  // ⛔ Deliberately NOT `isBlankCellText`: a stored `'   '` is a value of a text
  // cell and keeps its spaces — the trim belongs to the renderers that go on to
  // coerce the text into a number, a date or an `href`.
  if (isEmptyValue(safe)) return <EmptyValue />;
  return <TruncatedText text={String(safe)} />;
}

/**
 * Number field cell renderer
 */
export function NumberCellRenderer({ value, field }: CellRendererProps): React.ReactElement {
  // Hook before the empty-value early return — a value flipping between null
  // and set must not change the hook count between renders (same rule as
  // CurrencyCellRenderer below).
  const locale = useDisplayLocale();
  const safe = coerceToSafeValue(value);
  // Tested on the coerced text, not on `value == null` (objectui#8490): `[]`
  // and `''` both coerce to `''`, and `Number('')` is `0` — a digit the record
  // never held, indistinguishable from a real stored zero.
  if (isBlankCellText(safe)) return <EmptyValue />;

  const num = Number(safe);
  // The width (`scale` through `resolveFieldScale`), the grouping policy
  // (`scale` / `useGrouping`) and the two fraction-digit arms are assembled in
  // `formatNumberFieldValue`, the one call `NumberField`'s read-only branch
  // makes too, so a table cell and a read-only form show one field's value
  // identically (objectui#11431). The reasoning behind each input lives there.
  const formatted = !isNaN(num) ? formatNumberFieldValue(num, field, locale) : String(safe);

  return <span className="tabular-nums">{formatted}</span>;
}

/**
 * Rating field cell renderer — the star row `RatingField`'s read-only branch
 * draws (objectui#12110 item 2, finding A-03 of the HotCRM browser pass).
 *
 * `rating` used to share `NumberCellRenderer`, so a list column, a detail row
 * and a related list printed a bare `4` for a value the form draws as four of
 * five stars. The scale is the field's declared `max`, read the way
 * `RatingField` reads it, with `Field.rating`'s own default of 5 when none is
 * declared. The value and the scale are the cell's accessible text.
 *
 * Module-private on purpose: reached through `getCellRenderer('rating')`, the
 * one door every cell host already uses, so the package's export surface does
 * not grow.
 */
function RatingCellRenderer({ value, field }: CellRendererProps): React.ReactElement {
  const safe = coerceToSafeValue(value);
  // The same floor as `NumberCellRenderer` (objectui#8490): `[]` and `''`
  // coerce to `''`, and `Number('')` is a zero the record never held.
  if (isBlankCellText(safe)) return <EmptyValue />;
  const num = Number(safe);
  // Not a number: the text face the number cell gives it, and no star.
  if (!Number.isFinite(num)) return <span className="tabular-nums">{String(safe)}</span>;
  const declaredMax = (field as { max?: unknown } | undefined)?.max;
  const max = typeof declaredMax === 'number' && declaredMax > 0 ? Math.floor(declaredMax) : 5;
  const filled = Math.max(0, Math.min(max, Math.round(num)));
  return (
    <span className="inline-flex items-center gap-0.5" title={`${num} / ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <Star
          key={i}
          aria-hidden="true"
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            i < filled ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/40',
          )}
        />
      ))}
      <span className="sr-only">{`${num} / ${max}`}</span>
    </span>
  );
}

/**
 * Currency field cell renderer
 */
export function CurrencyCellRenderer({ value, field }: CellRendererProps): React.ReactElement {
  // Hooks before the empty-value early return — a value flipping between
  // null and set must not change the hook count between renders.
  const { currency: tenantCurrency } = useLocalization();
  const locale = useDisplayLocale();
  const safe = coerceToSafeValue(value);
  // Same fabrication as `NumberCellRenderer` (objectui#8490), one step worse:
  // a currency column sums and aligns a fabricated `0` like money.
  if (isBlankCellText(safe)) return <EmptyValue />;

  // Resolve the display currency via the shared precedence: field `currency` →
  // `currencyConfig.defaultCurrency` → the tenant default (ADR-0053). When none
  // is known, render a plain number — never a guessed symbol (silently assuming
  // USD mis-displays non-USD orgs, e.g. RMB amounts shown as $).
  const currency = resolveFieldCurrency(field as any, tenantCurrency);
  const num = Number(safe);
  // `CurrencyField`'s read-only branch makes this same call, so a table cell
  // and a read-only form show one amount identically: the currency's ISO 4217
  // minor-unit width, a whole amount included (objectui#11444).
  const formatted = !isNaN(num)
    ? formatCurrency(num, currency, locale)
    : String(safe);

  return <span className="tabular-nums font-medium whitespace-nowrap">{formatted}</span>;
}

/**
 * Percent field cell renderer with mini progress bar
 */
export function PercentCellRenderer({ value, field }: CellRendererProps): React.ReactElement {
  // Hook before the empty-value early return — a value flipping between null
  // and set must not change the hook count between renders (same rule as
  // NumberCellRenderer / CurrencyCellRenderer above).
  const locale = useDisplayLocale();
  // The bar's accessible name is the value text beside it (objectui#11690):
  // a `progressbar` must be named, and the formatted number is the one string
  // this cell has that is already in the viewer's locale — a translated
  // literal would name every percent column the same thing.
  const valueId = React.useId();
  const safe = coerceToSafeValue(value);
  // Same fabrication as `NumberCellRenderer` (objectui#8490): `[]` drew a 0%
  // progress bar with a `progressbar` role and `aria-valuenow` of 0.
  if (isBlankCellText(safe)) return <EmptyValue />;

  const percentField = field as any;
  // Decimal places come from `scale`, NOT `precision` — the same correction
  // objectui#2131 made on the currency arm and objectui#2134 on the number
  // arm, arriving one type later (objectui#9295). `@objectstack/spec` declares
  // the pair on the field face in its own words: `precision` is "Total digits
  // (non-negative integer)" and `scale` is "Decimal places (non-negative
  // integer)", so reading `precision` here padded every value out to the
  // column's TOTAL width — a decimal(10, 2) percent field rendered
  // `25.0000000000%`, and the grid footer beneath it read
  // `Sum: 25.0000000000%` for the same reason.
  //
  // ⛔ NOT `CurrencyConfigSchema.precision`, which is a different surface with
  // the opposite convention and its own `scale` alias — the spec warns against
  // conflating them at the field-face declaration itself.
  //
  // An ABSENT `scale` is the PROTOCOL's to answer, not this cell's
  // (objectui#9843, executing ruling A′ recorded on that card):
  // `resolveFieldScale` in `@objectstack/spec/data` returns the declared width
  // when the field has a well-formed one, and otherwise the platform's own
  // value for the field's type. The detail chip, the grid footer and the edit
  // widget ask the same function, so an undeclared `percent` reads one width
  // on every face, and ⛔ none of them spells a `?? N` of its own — a private
  // default is how this cell and the edit widget once rendered one stored
  // `0.25` as `25%` and `25.00%`.
  //
  // For `percent` the answer is a NUMBER — the type has a row — and ⛔ never
  // the `undefined` (min 0 / max 20) `NumberCellRenderer` above renders for a
  // `number` that declares nothing. The row is load-bearing HERE because a
  // fraction-stored value is multiplied by 100 first (`percentDisplayValue`),
  // and `Intl` renders
  // from the shortest decimal representation of the resulting double:
  // measured, a stored `0.07` becomes `7.000000000000001` and `0.29` becomes
  // `28.999999999999996`, so an unbounded maximum prints binary residue
  // straight to the user.
  //
  // ⚠️ This renderer also draws `progress`, and a textual field promoted by a
  // `format: 'percent'` hint (`resolveCellRendererType`). Neither type has a
  // row, so the resolver answers `undefined` for them — "no fixed width" —
  // and `formatPercent`'s own parameter default decides, as it did before.
  // That default is named in objectui#9843's report rather than widened here:
  // the protocol has not said what those types show when nothing is declared.
  //
  // The two members are handed over BY NAME — the spelling the detail chip and
  // the edit widget use — so the read of `scale` off this field stays visible
  // at the call site, where objectui#9784's source pin looks for it.
  const scale = resolveFieldScale({ type: percentField.type, scale: percentField.scale });
  const numValue = Number(safe);
  if (isNaN(numValue)) {
    return <span className="tabular-nums whitespace-nowrap">{String(safe)}</span>;
  }
  // ONE scaling rule, and it is the DECLARED storage (objectui#9452, then
  // objectui#11475). Both halves of this cell — the number and the bar's fill —
  // take their display magnitude from `percentDisplayValue` in
  // `@object-ui/core`, at the storage `percentCellScale` reads off this field:
  // the spec's `percentScaleOf` (a fraction unless the field declares a `max`
  // above 1), and `whole` for a `progress` field, whose reason is on that
  // helper. `formatPercent` just below applies the same pair for the number.
  //
  // ⛔ NOT from the value's MAGNITUDE, which is what stood here until
  // objectui#11475: `value > -1 && value < 1 ? value * 100 : value` read
  // neither the field nor its `max`, so a fraction-stored `1` (100%) read `1%`
  // in this cell and `100%` in the read-only form, and a whole-stored `0.5`
  // read `50%` here and `0.5%` there. The read-only form reads the
  // declaration, so the two faces now agree by reading the same thing.
  //
  // ⛔ NOT from the column's NAME, which is what stood here. A
  // `/progress|completion/` test against `field.name` decided the magnitude
  // BEFORE anything looked at the value, so a percent column whose name
  // happened to contain one of those words read its stored FRACTION as
  // percentage POINTS: one stored `0.5` rendered `50%` in the record-header
  // chip and `1%` in the list cell — the same record showing two magnitudes in
  // two places, which users report as a data bug rather than a formatting one.
  // The pattern was also UNANCHORED, so it matched on substring: a column
  // merely mentioning progress took the whole-percent path on the strength of
  // a word inside its name.
  //
  // What collapsed the question — measured across both first-party trees, and
  // reproducible from `PercentCellRenderer.nameKeyedScaling-9452.test.tsx`'s
  // header: the repo's own percent samples store FRACTIONS in exactly these
  // columns (the schema catalog's `progress` sample stores `0.753`, and the
  // inline editor is pinned on a `completion` field storing `0.5` meaning
  // 50%), the percent edit widget reads the same fields as fractions because
  // it detects the whole-percent convention from a declared `max > 1` and
  // never from the name, and the genuinely whole-percent producers are
  // declared by TYPE (`type: 'progress'`, `min: 0`, `max: 100`) and store only
  // `0` or integers at or above 1 — values on which the two rules agree by
  // construction. So the name test had no producer that needed it and two that
  // it misread.
  //
  // The name test's own price (a value strictly between 0 and 1 on a
  // `type: 'progress'` column read as a fraction) went with the magnitude
  // guess: a `progress` value is percentage points at every magnitude now.
  const percentScale = percentCellScale(percentField);
  const barValue = percentDisplayValue(numValue, percentScale);
  const formatted = formatPercent(numValue, percentScale, scale, locale);
  const clampedBar = Math.max(0, Math.min(100, barValue));
  
  // Layout contract (objectstack#5066): THE NUMBER IS THE CONTENT, THE BAR IS
  // DECORATION. The bar used to be `w-16 shrink-0` while the value span was
  // shrinkable, so in a narrow clipping container — a `record:highlights` chip
  // is `basis-[9rem]`/`min-w-[7rem]` and clips with `truncate` — the 64px bar
  // took the space and the value was silently cut mid-digit: a stored `33.33`
  // rendered `33%` in the DOM but read as `3` on screen, with no ellipsis and
  // nothing in the accessible name to signal the loss.
  //
  // So the priority is inverted: the value span is `shrink-0` (never sacrificed)
  // and the bar keeps `w-16` only as its PREFERRED width, free to shrink away
  // under pressure. It is deliberately NOT `flex-1` — growing is not wanted, or
  // every wide grid cell would stretch its bar; `w-16` stays the upper bound and
  // wide containers look exactly as before.
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div
        className="h-1.5 w-16 min-w-0 shrink rounded-full bg-muted ring-1 ring-inset ring-border/60 overflow-hidden"
        role="progressbar"
        aria-labelledby={valueId}
        aria-valuenow={clampedBar}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${clampedBar}%` }}
        />
      </div>
      <span id={valueId} className="shrink-0 tabular-nums whitespace-nowrap">{formatted}</span>
    </div>
  );
}

/**
 * Boolean field cell renderer (Airtable-style checkbox)
 * Supports semantic rendering for completion fields (green indicator).
 *
 * A `false` is a neutral state whatever the field is named (objectui#13412).
 * This face once drew a destructive "LABEL — Off" badge for `false` on six
 * status-like names (`active`, `enabled`, `verified` and their `is_` forms).
 * A plain `Field.boolean` named `verified` therefore read as an error on
 * every new record, while the same value under any other name drew an
 * unchecked box. Nothing in the metadata asked for it and nothing could turn
 * it off, so the name heuristic is gone: those names draw the checkbox too.
 */
export function BooleanCellRenderer({ value, field }: CellRendererProps): React.ReactElement {
  // The face's own words — the completion indicator's two accessible names —
  // come from the locale (objectui#11689), through the same hook and defaults
  // table as the read-only Yes / No words
  // (`useBooleanValueLabel`). Called before the early return below so the hook
  // count does not change with the value.
  const { t } = useFieldTranslation();
  // Only a real boolean is a value of a boolean column (objectui#8582).
  //
  // `@objectstack/spec`'s runtime value contract for `boolean` / `toggle` is a
  // bare `z.boolean()` (`data/field-value.zod.ts`, `valueSchemaFor`): the class
  // is declared "a JS boolean on the wire (driver read-coercion repairs SQL
  // 0/1)" and listed under `NON_TEXT_STORED_VALUE_TYPES` — stored "never text
  // on any backend". The truth table that turns `'true'` / `1` / `'0'` into a
  // boolean lives at the PRODUCER boundaries (objectql's `coerceBooleanFields`
  // on the read path and its `invalid_boolean` write-path refusal; `rest`'s
  // `parseBooleanCell` on CSV import), so a non-boolean reaching this renderer
  // is a producer that skipped its repair, and a second copy of that table
  // here would be the renderer-side dialect AGENTS.md #0.1 forbids.
  //
  // Before this guard every branch below read the value by TRUTHINESS. The
  // string `'false'`, the string `'0'` and `{}` drew a CHECKED box — a
  // completion field its green "Completed" indicator — an affirmative answer
  // the record never gave; `0` and `''` drew an UNCHECKED box, a `false` the
  // record never stored either. Both directions are the same
  // fabrication and both now land on the shared affordance, whose accessible
  // name ("No value") is a statement about the field's TYPE: the record holds
  // no boolean here. `null` / `undefined` and `[]` (objectui#8490: an empty
  // array holds no boolean) are the same answer for the same reason. A real
  // `false` is a value and stays an unchecked box.
  //
  // THE FLOOR, STRICTLY EXTENDED (objectui#8496): every one of its four members
  // is a non-boolean, so this one test already answers all of them and adding
  // `isEmptyValue(value) ||` in front of it would be a dead disjunct. What the
  // floor must NOT do here is grow a `false` member — that is the pinned
  // disagreement on this renderer.
  if (typeof value !== 'boolean') {
    return <span className="flex items-center justify-center"><EmptyValue /></span>;
  }

  // Semantic rendering for completion fields (green circle indicator)
  // Only match exact field names to avoid false positives
  const fieldName = field?.name?.toLowerCase() || '';
  const isCompletionField = fieldName === 'completed' || fieldName === 'is_completed'
    || fieldName === 'done' || fieldName === 'is_done';
  // The field's words (objectui#12584): the plain checkbox's accessible name.
  // Its label, else its humanized name. The fallback reads the name as
  // authored, not the lower-cased matching key above: `humanizeLabel` only
  // capitalises, so the key turned an unlabelled `IsPreferred` into
  // `Ispreferred`. A spec-legal name is lowercase snake_case already, so for
  // it the two spellings are the same string.
  const fieldLabel = field?.label || humanizeLabel(field?.name || '');

  if (isCompletionField) {
    return (
      <div className="flex items-center justify-center">
        {value ? (
          <div className="size-5 rounded-full bg-green-500 flex items-center justify-center" role="img" aria-label={t('fields.boolean.completed')} data-testid="completion-indicator">
            <Check className="size-3 text-white" />
          </div>
        ) : (
          <div className="size-5 rounded-full border-2 border-muted-foreground/30" role="img" aria-label={t('fields.boolean.notCompleted')} data-testid="completion-indicator" />
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-start">
      {/* Named by the field (objectui#12584): with no name a screen reader
          announced every cell as a bare "checkbox". The `checkbox` role
          already announces checked / not checked, so the name carries no
          state word. */}
      <Checkbox checked={value} disabled aria-label={fieldLabel} className="pointer-events-none" />
    </div>
  );
}

/**
 * The overdue affordance — ONE home for both date-family cell renderers
 * (objectui#8958).
 *
 * `dueLike` is declared for BOTH types — today on the field itself
 * (`DateFieldMetadata.dueLike` / `DateTimeFieldMetadata.dueLike`, by reference
 * to `@objectstack/spec`); when this was written, on the since-retired view
 * entry key, whose `describe` text read "Marks a date/datetime field as
 * due/deadline-semantic, gating the relative 'Overdue Nd' wording".
 * `DateCellRenderer` honoured it;
 * `DateTimeCellRenderer` never read it, so an author who marked a `datetime`
 * column `dueLike` published successfully and the affordance simply did not
 * appear — accepted, parsed, dropped, and rendered as a legitimate-looking
 * relative date. Measured before the change, one instant
 * (`2026-09-06T09:30:00.000Z`), clock `2026-09-09T12:00:00.000Z`, `en-US`:
 *
 *   date     `dueLike: true` -> "Overdue 3d"  + `text-red-600`
 *   datetime `dueLike: true` -> "3 days ago"  + no red
 *   datetime no key at all   -> "3 days ago"  + no red   <- byte-identical
 *
 * These two functions exist so the repair is a SHARED read rather than a
 * second copy: copying either into the sibling is objectui#4576 exactly — the
 * shape this package already paid for when one convention was duplicated
 * across a boundary and the two copies drifted while both stayed "correct".
 * The wording half was already shared (both cells reach the same
 * `formatRelativeDate`, which reads `options.dueLike`); these cover the two
 * halves that were not.
 */

/**
 * Whether a field is due/deadline-semantic, for ONE row: declared, and not
 * settled (objectui#11815, ruling D: overdue is declared-only).
 *
 * A date is a deadline only when its field declares `dueLike: true` —
 * `@objectstack/spec`'s `FieldSchema.dueLike`, typed by reference on
 * `DateFieldMetadata` / `DateTimeFieldMetadata`. Nothing else is read. The
 * field-name convention that used to stand behind the declaration (a regex
 * over `due` / `deadline` / `expires` / …) is retired: under ADR-0049 nothing
 * undeclared paints, so an undeclared `due_date` in the past reads as any
 * past date does.
 *
 * `deadlineSettled` is the host's verdict on the field's `settledWhen` for
 * this row (`isDeadlineSettled` in `@object-ui/core`). While it holds, the
 * cell answers exactly as for a non-deadline: neutral wording, no red. It is
 * a separate input on purpose — ⛔ never carried as `dueLike: false`, which
 * would merge "settled" with "not a deadline".
 */
function resolveDueLike(field: CellRendererProps['field'], deadlineSettled?: boolean): boolean {
  if (deadlineSettled === true) return false;
  return (field as DateFieldMetadata | DateTimeFieldMetadata | undefined)?.dueLike === true;
}

/**
 * Whether a due/deadline instant has passed, at DAY granularity.
 *
 * ⚠️ The granularity is inherited, not re-decided here. `formatRelativeDate`
 * compares calendar-day boundaries and gates its wording on `diffDays < -1`,
 * so "Overdue 0d" is not a string this codebase can produce — the shortest
 * overdue phrase is "Overdue 2d". This predicate is the same calendar-day
 * question asked of the styling half, so a `datetime` two hours past its
 * deadline reads "Today" and is not red, exactly as the `date` cell has
 * always answered for a deadline falling today. Making the `datetime` cell
 * time-of-day aware would put a SECOND convention in this file and make the
 * two columns unequal again, which is the defect being closed; sub-day
 * precision is a separate call, deliberately not taken here.
 */
function isOverdueInstant(date: Date, dueLike: boolean): boolean {
  if (!dueLike) return false;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return date < startOfToday;
}

/**
 * Date field cell renderer
 */
export function DateCellRenderer({ value, field, deadlineSettled, alwaysShowYear }: CellRendererProps): React.ReactElement {
  // `useDisplayLocale()`, NOT `useLocalization().locale` (objectui#4468). The
  // raw tenant locale is `undefined` on any workspace that never configured
  // one, and `Intl` reads the MACHINE's locale from `undefined` — so a `zh`
  // console rendered `逾期 6 天` (which resolves through `t`, the ACTIVE UI
  // language) beside `In 3 days` and `6 days ago` (which resolve through
  // `Intl`) on the SAME row. One channel for both halves, or the row
  // disagrees with itself.
  const locale = useDisplayLocale();
  const t = useFieldTranslate();
  // THE FLOOR, EXTENDED with every falsy scalar (objectui#8496). The extension
  // is deliberate and is the pinned disagreement on this renderer: `0` — the
  // numeric epoch — is EMPTY on a date cell, where the floor says nothing about
  // it. The floor's own `[]` member is answered one line down, on the coerced
  // text, because `[]` is truthy. ⛔ Do not "fix" this to spare the epoch.
  if (!value) return <EmptyValue />;
  const safe = coerceToSafeValue(value);
  // `[]` is truthy, so it passed the guard above and reached `formatDate` as
  // `''`, whose own em-dash is a bare punctuation mark with no accessible
  // name (objectui#8490). The shared affordance says "No value" instead.
  if (isBlankCellText(safe)) return <EmptyValue />;

  // An UNPARSABLE value reaches the same affordance (objectui#8581), and the
  // guard is spelled EXACTLY as `DateTimeCellRenderer`'s one function down —
  // the nearest sibling, answering the identical input, which has returned
  // `<EmptyValue />` for it all along. Before this, `not-a-date` fell through
  // to `formatDate`, whose own hand-rolled em-dash is a bare punctuation mark
  // to a screen reader: no `data-slot` of `empty-value`, no accessible name.
  // That is the objectui#8475 / objectui#8491 class of defect, and #8490
  // already routed this renderer's coerced-EMPTY input (the line above) to
  // the shared affordance while deliberately leaving this input for a card.
  //
  // Two renderers for the same data family disagreeing about the same input
  // is the shape this repo keeps paying for, so the closer neighbour is
  // authoritative. The cost is declared: the raw string was reachable on
  // hover through the `title` below, and the invalid branch no longer draws
  // that span. Measured before the change (objectui#8581): nothing in this
  // repo reads that `title` — no test, no selector, no export path; the only
  // occurrences of `isoString` are its assignment and its one use. A
  // PARSEABLE value keeps its `title` unchanged.
  //
  // `toDisplayDate(safe)` IS `formatDate`'s own parse step (it receives
  // `safe`, and `coerceToSafeValue` never returns a `Date`), so this branch
  // is co-extensive with the dash it replaces — never wider, never narrower.
  // In particular a numeric timestamp stays a number through the coercion and
  // still renders. The guard read `new Date(safe)` until objectui#10026, when
  // that step began refusing a date-only value naming a day its month does
  // not have (`2026-02-30`). The engine's parse accepts one, so the old guard
  // let it through to `formatDate`'s bare dash — objectui#8581's defect back,
  // on the refusal's own input.
  //
  // ⚠️ The `title` keeps the engine's `new Date(safe)`: for a date-only value
  // the parse step answers LOCAL midnight, whose `toISOString()` names the
  // previous day east of UTC (its own doc says so). So `displayDate` answers
  // validity and the overdue day — the day the text went through
  // (objectui#10183) — and `date` answers the `title` only.
  const displayDate = safe != null ? toDisplayDate(safe as string | number) : null;
  if (displayDate === null || isNaN(displayDate.getTime())) return <EmptyValue />;
  const date = new Date(safe as string | number);

  const dateField = field as any;
  const style = dateField.format || 'relative';

  // Both halves of the affordance come from the shared reads above, so the
  // `datetime` sibling one function down answers this question identically
  // instead of carrying a second copy (objectui#8958).
  const dueLike = resolveDueLike(field, deadlineSettled);
  const formatted = formatDate(safe as string | Date, style, { dueLike, locale, t, alwaysShowYear });
  const isOverdue = isOverdueInstant(displayDate, dueLike);

  return (
    <span
      className={`tabular-nums${isOverdue ? ' text-red-600' : ''}`}
      title={date.toISOString()}
    >
      {formatted}
    </span>
  );
}

/**
 * DateTime field cell renderer (Airtable-style with date and time visually separated)
 */
export function DateTimeCellRenderer({ value, field, deadlineSettled, alwaysShowYear }: CellRendererProps): React.ReactElement {
  // Hook before every early return — a value flipping between null and set
  // must not change the hook count between renders (same rule as the number /
  // currency renderers above). This is the site objectui#4468 caught rendering
  // `8/11/2026 12:00 am` inside an otherwise Chinese grid: both calls passed
  // `undefined`, i.e. the machine's locale, on every session.
  const locale = useDisplayLocale();
  const t = useFieldTranslate();
  // THE FLOOR, EXTENDED with every falsy scalar — the numeric epoch included,
  // spelled EXACTLY as `DateCellRenderer` one function up (objectui#8496). The
  // floor's `[]` member is answered by the unparsable-date test below, which
  // `coerceToSafeValue([])` reaches as `''`.
  if (!value) return <EmptyValue />;
  const safe = coerceToSafeValue(value);
  // The validity guard reads the shared parse step, spelled EXACTLY as
  // `DateCellRenderer`'s one function up, so the two siblings refuse the same
  // inputs — a date-only nonexistent day included (objectui#10026), and a
  // date-time written on one (`2026-02-30T10:00:00Z`, objectui#10301). The
  // formatters below still take the engine's `new Date(safe)`: this cell
  // renders an INSTANT, and that is unchanged. ⛔ This guard is the ONLY thing
  // that refuses such a day here: for one, `date` would be a `Date` the engine
  // already rolled into March, and no parse step downstream can refuse a `Date`.
  const displayDate = safe != null ? toDisplayDate(safe as string | number) : null;
  if (displayDate === null || isNaN(displayDate.getTime())) return <EmptyValue />;
  const date = new Date(safe as string | number);

  // `field.format` is read as a display style here for the same reason
  // `DateCellRenderer` reads it one function up: `datetime` had no style
  // vocabulary at all because this renderer destructured `value` only
  // (objectui#7443). `||`, not `??`, matches the `date` cell and keeps an
  // authored empty string on the compact face rather than dropping it into
  // the verbose default.
  // `FieldMetadata` is a 37-member union and `BaseFieldMetadata` carries no
  // `format`, so the bare property read is `TS2339` — SOME cast is load-bearing.
  // `DateTimeFieldMetadata` is the narrowest one that carries it (objectui#7747);
  // `as any` would also silence a typo in the property name, this does not.
  const authoredFormat = (field as DateTimeFieldMetadata | undefined)?.format || 'compact';

  // ── The authored vocabulary is mapped HERE (objectui#8853) ──────────────
  // `field.format` is ONE authored key, and until this mapping it meant two
  // different things depending on which of two neighbouring cell renderers
  // read it. Measured end to end through a real `ObjectGrid` column, one row,
  // one instant, `format: 'relative'` on both fields: the `date` cell painted
  // `In 2 days` and the `datetime` cell beside it painted
  // `Sep 11, 2026, 09:30 AM` — no error, no warning, no fallback. The runtime
  // accepted the key, parsed it, dropped it, and rendered something that still
  // looks like a legitimate date, which is why a reader cannot tell an
  // honoured style from a dropped one by looking at the cell.
  //
  // The two words are SELECTED here rather than threaded onward, and that is
  // the ruling objectui#8352 already made for `formatMeasureDate`'s datetime
  // arm — the same defect class one surface over. Threading `format` into
  // `formatDateTime`'s `options.style` is NOT the fix and was measured there:
  // that key's vocabulary is `'compact'` alone, so a pass-through would honour
  // the one word the `date` cell does NOT honour while still ignoring both
  // words it does — the defect inverted, not closed. Widening
  // `formatDateTime(value, options?)` is refused for the reason it was refused
  // there and in objectui#7443 ruling B: it is a PUBLISHED signature, and the
  // parity this card asks for is reachable from the call site without moving
  // it. Rejecting the currently-accepted spelling is refused too — that would
  // be a breaking narrowing of a published metadata surface.
  //
  //   `'relative'` -> `formatRelativeDate`, the SAME function `formatDate`
  //                   resolves `'relative'` to, so one calendar day reads the
  //                   same phrase in either column.
  //   `'short'`    -> the dense face of THIS type, which for a `datetime` cell
  //                   is the compact face painted below. `formatDate`'s
  //                   `'short'` is a narrow DATE face; the datetime equivalent
  //                   keeps the time of day, exactly as #8352 mapped it.
  //   anything else, `'compact'` and date patterns such as `'YYYY-MM-DD'`
  //                   included, falls through unchanged to the default face.
  //
  // ⚠️ Beyond the ±7-day window `formatRelativeDate` renders an absolute DATE
  // face, so an out-of-window `'relative'` datetime shows no time of day. That
  // window belongs to that function and is INHERITED here, not re-decided —
  // re-deciding it would put a second copy of the convention in this file,
  // which is objectui#4576 exactly. `'relative'` is day-granular by
  // construction (it shows no time inside the window either), and any other
  // fallback would make the two columns unequal again, which is the defect
  // being closed. Nothing is taken away from a working feature: this renderer
  // ignored the word outright before, so it starts honouring a request whose
  // granularity is days.
  //
  // ── The overdue affordance is read HERE (objectui#8958) ────────────────
  // `dueLike` used to be deliberately not threaded: objectui#8853 mapped
  // `format` and refused to acquire a second key's behaviour in the same
  // change, filing the call rather than guessing it. The call came back
  // "honour the declaration" — `DetailViewFieldSchema.dueLike` says
  // "date/datetime" in the `describe` text an author reads, and this renderer
  // never read it, so the affordance silently did not appear on a `datetime`
  // column that asked for it.
  //
  // Both halves are honoured, because the affordance IS both: the "Overdue
  // Nd" wording (`formatRelativeDate` reads `options.dueLike`, and `t`
  // travels with it — that function reaches `t` only through this key, which
  // is why #8853 left it off) and the red styling, applied to the span below.
  //
  // ⚠️ The styling is deliberately style-INDEPENDENT, matching the sibling.
  // `DateCellRenderer` reddens its span whatever face it painted, so gating
  // red on the relative branch alone would leave a `compact` datetime and a
  // `compact` date disagreeing about the same authored key — the defect
  // narrowed rather than closed. Since `'compact'` is THIS cell's default
  // face, that is also where the visible population is.
  const style = authoredFormat === 'short' ? 'compact' : authoredFormat;
  const dueLike = resolveDueLike(field, deadlineSettled);
  const isOverdue = isOverdueInstant(date, dueLike);
  // Spelled as the sibling spells it, one function up, for the same reason
  // every other guard in these two renderers is: one shape, one reading.
  const cellClass = `tabular-nums text-sm whitespace-nowrap${isOverdue ? ' text-red-600' : ''}`;

  if (style === 'relative') {
    return (
      <span className={cellClass}>
        {formatRelativeDate(date, { dueLike, locale, t, alwaysShowYear })}
      </span>
    );
  }

  // The compact face is painted in two halves — the time is muted and offset
  // — so this branch asks the shared module for the halves rather than the
  // joined string. Both come out of `formatDateTimeCompactParts`, which is
  // also what `formatDateTime(value, { style: 'compact' })` joins, so the
  // cell and every string caller of the compact face render the same instant
  // identically.
  // `null` is unreachable: the invalid/empty values it answers for already
  // returned `<EmptyValue />` above.
  //
  // The gap between the halves is TEXT, one space (objectui#11683). It used to
  // be an `ml-2` margin alone, so the cell's text was the two halves run
  // together: `2026/10/6上午1:42` in zh-CN, `10/6/20261:42 am` in en-US. That is
  // what a copy, a screen reader and `textContent` got. The space is the joiner
  // `formatDateTime`'s compact face puts between the same two halves, so the
  // cell's text is now that string exactly. The time half keeps its muted
  // colour and a narrower `ml-1` margin, which with the space keeps the halves
  // visibly apart.
  if (style === 'compact') {
    const parts = formatDateTimeCompactParts(date, { locale });
    if (parts) {
      return (
        <span className={cellClass}>
          <span>{parts.date}</span>{' '}
          <span className="ml-1 text-muted-foreground">{parts.time}</span>
        </span>
      );
    }
  }

  return (
    <span className={cellClass}>
      {formatDateTime(date, { style, locale, t })}
    </span>
  );
}

// Semantic color mapping (auto-detect from value text for priority & status fields)
// Keys use underscore notation; lookup normalizes spaces/hyphens to underscores automatically.
// Chinese keys are stored as-is and matched directly (no normalization side-effects).
const SEMANTIC_COLOR_MAP: Record<string, string> = {
  // Priority values (en)
  critical: 'red',
  urgent: 'red',
  high: 'orange',
  medium: 'yellow',
  normal: 'blue',
  low: 'gray',
  none: 'gray',
  // Status values (en)
  paid: 'green',
  completed: 'green',
  done: 'green',
  active: 'green',
  approved: 'green',
  resolved: 'green',
  pending: 'yellow',
  waiting: 'yellow',
  on_hold: 'yellow',
  shipped: 'blue',
  in_progress: 'blue',
  open: 'blue',
  processing: 'blue',
  draft: 'gray',
  new: 'gray',
  inactive: 'gray',
  closed: 'gray',
  cancelled: 'red',
  canceled: 'red',
  rejected: 'red',
  failed: 'red',
  overdue: 'red',
  delivered: 'purple',
  archived: 'indigo',
  // CRM lifecycle values (en)
  contacted: 'blue',
  qualified: 'purple',
  converted: 'green',
  won: 'green',
  lost: 'red',
  // Priority values (zh)
  紧急: 'red',
  严重: 'red',
  高: 'orange',
  中: 'yellow',
  普通: 'blue',
  低: 'gray',
  无: 'gray',
  // Status values (zh)
  新建: 'gray',
  草稿: 'gray',
  待处理: 'yellow',
  待审核: 'yellow',
  待联系: 'yellow',
  挂起: 'yellow',
  进行中: 'blue',
  处理中: 'blue',
  已联系: 'blue',
  跟进中: 'blue',
  已发货: 'blue',
  打开: 'blue',
  已确认: 'green',
  已审核: 'green',
  已通过: 'green',
  已完成: 'green',
  已支付: 'green',
  已签收: 'green',
  已转化: 'green',
  成单: 'green',
  赢得: 'green',
  已签约: 'green',
  已交付: 'purple',
  已归档: 'indigo',
  已关闭: 'gray',
  已取消: 'red',
  已拒绝: 'red',
  失败: 'red',
  逾期: 'red',
  流失: 'red',
  丢失: 'red',
};

// Color to Tailwind class mapping for custom Badge styling
// Color → Tailwind class mapping for status-style badges.
// Uses the modern "soft pill" pattern (Tailwind UI style): -50 background,
// -700 text, hairline -200 border. Dark mode mirrors with -950/40 surface
// and -300 text. This keeps status fields readable without the heavy,
// candy-colored look of the older -100/-300/-800 combination.
const BADGE_COLOR_MAP: Record<string, string> = {
  gray: 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-800/50 dark:text-gray-200 dark:border-gray-700/60',
  red: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/60',
  orange: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900/60',
  yellow: 'bg-yellow-50 text-yellow-800 border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-300 dark:border-yellow-900/60',
  green: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900/60',
  blue: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/60',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900/60',
  purple: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-900/60',
  pink: 'bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-950/40 dark:text-pink-300 dark:border-pink-900/60',
};

// Solid color → Tailwind background class for the small dot used by the
// `appearance: 'dot'` rendering of select/status fields. Uses the -500 shade
// for both light and dark modes so the dot remains a clear visual anchor
// without becoming a heavy color block.
const DOT_COLOR_MAP: Record<string, string> = {
  gray: 'bg-gray-400 dark:bg-gray-500',
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  yellow: 'bg-yellow-500',
  green: 'bg-green-500',
  blue: 'bg-blue-500',
  indigo: 'bg-indigo-500',
  purple: 'bg-purple-500',
  pink: 'bg-pink-500',
};

// Color palette used by the deterministic fallback when no schema/semantic
// color matches. Excludes 'gray' to ensure visual contrast between values.
const BADGE_FALLBACK_PALETTE: readonly string[] = [
  'blue', 'green', 'purple', 'orange', 'pink', 'indigo', 'yellow', 'red',
];

/**
 * Stable string hash (djb2-ish) → palette index.
 * Same value always yields the same color across renders/sessions.
 */
function hashToColor(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i++) {
    h = ((h << 5) + h) ^ value.charCodeAt(i);
  }
  const idx = Math.abs(h) % BADGE_FALLBACK_PALETTE.length;
  return BADGE_FALLBACK_PALETTE[idx];
}

/**
 * Map a hex color (e.g. '#8B5CF6') to the nearest named palette color the
 * badge/dot maps understand. Object field options almost always declare colors
 * as HEX, so without this the explicit author color is ignored and a semantic/
 * hash heuristic takes over (e.g. a purple 'In Review' rendered alarming-red).
 * Low-saturation hexes resolve to 'gray'; otherwise bucket by hue.
 */
function hexToPaletteName(hex: string): string | undefined {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return undefined;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (sat < 0.22) return 'gray';
  let hue: number;
  if (max === r) hue = (((g - b) / d) % 6 + 6) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  hue *= 60;
  if (hue >= 345 || hue < 15) return 'red';
  if (hue < 30) return 'orange';
  if (hue < 60) return 'yellow';
  if (hue < 170) return 'green';
  if (hue < 238) return 'blue';
  if (hue < 250) return 'indigo';
  if (hue < 295) return 'purple';
  return 'pink';
}

/** Normalize an option color to a named palette key: pass known names through,
 *  resolve hex to the nearest palette color, else undefined. */
function resolveColorName(color?: string): string | undefined {
  if (!color) return undefined;
  if (BADGE_COLOR_MAP[color]) return color;
  if (color.charAt(0) === '#') return hexToPaletteName(color);
  return undefined;
}

/* ---------------------------------------------------------------------------
 * Explicit-hex badge rendering (objectui#5141).
 *
 * `hexToPaletteName` above answers "which of the nine palette families is this
 * hex nearest?" — a deliberately lossy question. Two same-hue tiers an author
 * declared as distinct (`#2ecc71` "in progress" vs `#1e8449` "completed") land
 * in the same bucket and render byte-identical, so the declaration is silently
 * discarded. `plugin-gantt` already settled this class of conflict the other
 * way ("explicit colorField value (hex or semantic name) — metadata wins"), and
 * Studio's own option editor paints the author's swatch straight from the raw
 * hex. Badges were the odd one out.
 *
 * So when the author declared a hex we render THAT hex, deriving the soft-pill
 * surface / label / border from it instead of snapping to a family. The
 * derivation deliberately keeps the two properties the family maps gave us for
 * free:
 *
 *   1. Theme control. The derived colors are published as CSS custom
 *      properties and consumed by *static* Tailwind utilities, so light and
 *      dark remain ordinary `dark:` variants rather than a hard-coded inline
 *      background that ignores the theme. Tailwind can never generate a class
 *      for a runtime value (`bg-[#1e8449]` built from metadata is not in the
 *      source at build time), so the custom property — not the colour — has to
 *      be the dynamic part.
 *   2. Contrast. The label is not "the hex" but the lightness along the
 *      declared hue nearest the declared one that still clears WCAG AA against
 *      the derived surface. Authors can and do declare colours that are
 *      unreadable under a label; honoring the declaration must not turn that
 *      into a legibility bug across every list view.
 *
 * Non-hex declarations (family names, the semantic value map, the hash
 * fallback) are untouched and keep resolving exactly as before.
 * -------------------------------------------------------------------------*/

/** WCAG AA floor for badge label text against its own pill surface. */
const BADGE_TEXT_CONTRAST = 4.5;

/**
 * Visibility floor for the `appearance: 'dot'` marker. A dot carries no text,
 * so the AA *text* ratio does not apply; this is the measured floor of the
 * -500 shades `DOT_COLOR_MAP` ships today (yellow-500 `#eab308` is the weakest
 * at 1.92:1 on white). Pinning it here means an author-declared dot is never
 * less visible than the palette dot it replaces.
 */
const DOT_CONTRAST_FLOOR = 1.9;

interface Rgb { r: number; g: number; b: number }

/** Surfaces a dot sits on — used only to keep the dot itself visible. */
const LIGHT_SURFACE: Rgb = { r: 255, g: 255, b: 255 };
const DARK_SURFACE: Rgb = { r: 10, g: 10, b: 10 };

const clampNum = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function parseHexColor(hex: string): Rgb | undefined {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return undefined;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = (((gn - bn) / d) % 6 + 6) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let p: [number, number, number];
  if (hue < 60) p = [c, x, 0];
  else if (hue < 120) p = [x, c, 0];
  else if (hue < 180) p = [0, c, x];
  else if (hue < 240) p = [0, x, c];
  else if (hue < 300) p = [x, 0, c];
  else p = [c, 0, x];
  return {
    r: Math.round((p[0] + m) * 255),
    g: Math.round((p[1] + m) * 255),
    b: Math.round((p[2] + m) * 255),
  };
}

const rgbToHex = ({ r, g, b }: Rgb): string =>
  '#' + [r, g, b].map((v) => clampNum(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

/** WCAG relative luminance of an sRGB color. */
function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colors (1..21). */
function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Walk the declared hue for the lightness *closest to the declared one* that
 * still clears `target` against `surface`.
 *
 * Choosing the closest passing lightness rather than simply maximizing
 * contrast is what keeps the author's colour recognizable — maximizing would
 * collapse every badge label to black or white and re-lose the declaration we
 * are here to preserve. Only when the hue cannot reach the target at any
 * lightness (a very low-chroma declaration against a mid surface) do we fall
 * back to black or white, whichever is further from the surface: legibility
 * outranks fidelity.
 */
function readableOnSurface(
  h: number,
  s: number,
  declaredL: number,
  surface: Rgb,
  target: number,
): Rgb {
  let best: Rgb | undefined;
  let bestDistance = Infinity;
  for (let step = 0; step <= 100; step++) {
    const lightness = step / 100;
    const candidate = hslToRgb(h, s, lightness);
    if (contrastRatio(candidate, surface) < target) continue;
    const distance = Math.abs(lightness - declaredL);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  if (best) return best;
  const black: Rgb = { r: 0, g: 0, b: 0 };
  const white: Rgb = { r: 255, g: 255, b: 255 };
  return contrastRatio(black, surface) >= contrastRatio(white, surface) ? black : white;
}

/** The six pill colors plus the two dot colors derived from one declared hex. */
export interface HexBadgePalette {
  bg: string;
  fg: string;
  border: string;
  bgDark: string;
  fgDark: string;
  borderDark: string;
  dot: string;
  dotDark: string;
}

/**
 * Derive a full soft-pill palette from an author-declared hex.
 *
 * The declared LIGHTNESS is what separates two same-hue tiers (`#2ecc71` is
 * l=0.49, `#1e8449` is l=0.32 — their hues differ by 0.1°), so it has to
 * survive into the *surface*. A fixed pale tint — the obvious reading of
 * "compute a soft pill from the hex" — does not carry it: measured, that
 * leaves the reported pair ΔE 2.3 apart in Lab, at the ~2.3 just-noticeable
 * threshold, which would close this issue on paper while the user still cannot
 * tell the two badges apart. Letting the tint depth track the declared
 * lightness puts them ΔE 8.0 apart instead.
 */
export function deriveHexBadgePalette(color: string): HexBadgePalette | undefined {
  const rgb = parseHexColor(color);
  if (!rgb) return undefined;
  const { h, s, l } = rgbToHsl(rgb);
  // Keep a usable chroma at both ends: a fully desaturated declaration stays
  // neutral instead of being pushed into a hue it never declared, and a neon
  // one is reined in so the pill never fights the row it sits in.
  const sat = clampNum(s, 0.18, 0.92);

  // Light theme: pale for light declarations (the -50 look we ship today),
  // deepening as the declared colour darkens.
  const bgLightness = 0.95 - 0.32 * (1 - l);
  const bg = hslToRgb(h, sat * (0.55 + 0.25 * (1 - l)), bgLightness);
  const border = hslToRgb(h, sat * 0.62, clampNum(bgLightness - 0.14, 0, 1));
  const fg = readableOnSurface(h, sat, l, bg, BADGE_TEXT_CONTRAST);

  // Dark theme: the same idea mirrored — a dark surface whose depth tracks the
  // declared lightness, with the label lifted until it clears AA against it.
  const bgDarkLightness = 0.10 + 0.30 * l;
  const bgDark = hslToRgb(h, sat * 0.6, bgDarkLightness);
  const borderDark = hslToRgb(h, sat * 0.55, clampNum(bgDarkLightness + 0.12, 0, 1));
  const fgDark = readableOnSurface(h, sat, l, bgDark, BADGE_TEXT_CONTRAST);

  return {
    bg: rgbToHex(bg),
    fg: rgbToHex(fg),
    border: rgbToHex(border),
    bgDark: rgbToHex(bgDark),
    fgDark: rgbToHex(fgDark),
    borderDark: rgbToHex(borderDark),
    dot: rgbToHex(readableOnSurface(h, sat, l, LIGHT_SURFACE, DOT_CONTRAST_FLOOR)),
    dotDark: rgbToHex(readableOnSurface(h, sat, l, DARK_SURFACE, DOT_CONTRAST_FLOOR)),
  };
}

/**
 * Static utility strings. Tailwind has to SEE these at build time — they are
 * scanned out of this file by `packages/fields/src/index.css` — which is
 * exactly why the custom properties carry the colours.
 */
const HEX_BADGE_CLASSES =
  'bg-[color:var(--os-badge-bg)] text-[color:var(--os-badge-fg)] border-[color:var(--os-badge-border)] ' +
  'dark:bg-[color:var(--os-badge-bg-dark)] dark:text-[color:var(--os-badge-fg-dark)] dark:border-[color:var(--os-badge-border-dark)]';

const HEX_DOT_CLASSES = 'bg-[color:var(--os-dot-bg)] dark:bg-[color:var(--os-dot-bg-dark)]';

/** A className plus the custom properties it reads. */
export interface HexColorAppearance {
  className: string;
  style: React.CSSProperties;
}

/**
 * Soft-pill appearance for an explicitly declared hex, or `undefined` for
 * every other kind of declaration (family name, no colour at all) so the
 * caller falls back to `getBadgeColorClasses`.
 */
export function getBadgeHexAppearance(color?: string): HexColorAppearance | undefined {
  if (!color || color.charAt(0) !== '#') return undefined;
  const palette = deriveHexBadgePalette(color);
  if (!palette) return undefined;
  return {
    className: HEX_BADGE_CLASSES,
    style: {
      '--os-badge-bg': palette.bg,
      '--os-badge-fg': palette.fg,
      '--os-badge-border': palette.border,
      '--os-badge-bg-dark': palette.bgDark,
      '--os-badge-fg-dark': palette.fgDark,
      '--os-badge-border-dark': palette.borderDark,
    } as React.CSSProperties,
  };
}

/** Dot appearance for an explicitly declared hex (see `getBadgeHexAppearance`). */
export function getDotHexAppearance(color?: string): HexColorAppearance | undefined {
  if (!color || color.charAt(0) !== '#') return undefined;
  const palette = deriveHexBadgePalette(color);
  if (!palette) return undefined;
  return {
    className: HEX_DOT_CLASSES,
    style: {
      '--os-dot-bg': palette.dot,
      '--os-dot-bg-dark': palette.dotDark,
    } as React.CSSProperties,
  };
}

export function getBadgeColorClasses(color?: string, val?: unknown): string {
  const named = resolveColorName(color);
  if (named && BADGE_COLOR_MAP[named]) return BADGE_COLOR_MAP[named];
  if (val == null || val === '') return 'bg-muted text-muted-foreground border-border';
  const key = String(val).toLowerCase().replace(/[\s-]/g, '_');
  const semantic = SEMANTIC_COLOR_MAP[key];
  if (semantic && BADGE_COLOR_MAP[semantic]) return BADGE_COLOR_MAP[semantic];
  // Deterministic fallback so distinct values are visually distinguishable
  // even when metadata declares no colors.
  return BADGE_COLOR_MAP[hashToColor(key)];
}

/**
 * Resolve a semantic color name (e.g. "red", "green") for a value, suitable
 * for callers that need a raw color token rather than CSS classes (for
 * example, the Gantt renderer paints bars via inline styles).
 *
 * Resolution order: explicit option color → semantic value mapping →
 * deterministic hash fallback. Returns `undefined` only when no value is
 * supplied so the caller can fall back to its own default.
 */
export function getSemanticColorName(color?: string, val?: unknown): string | undefined {
  const named = resolveColorName(color);
  if (named && BADGE_COLOR_MAP[named]) return named;
  if (val == null || val === '') return undefined;
  const key = String(val).toLowerCase().replace(/[\s-]/g, '_');
  const semantic = SEMANTIC_COLOR_MAP[key];
  if (semantic) return semantic;
  return hashToColor(key);
}

// Resolved hex values for the -500 shade of each palette color. Mirrors
// `DOT_COLOR_MAP` and is consumed by callers that paint via inline styles
// (e.g. Gantt task bars, where Tailwind classes can't be applied to dynamic
// `style={}` values).
const COLOR_NAME_HEX: Record<string, string> = {
  gray: '#6b7280',
  red: '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  green: '#22c55e',
  blue: '#3b82f6',
  indigo: '#6366f1',
  purple: '#a855f7',
  pink: '#ec4899',
};

/**
 * Map a semantic color name to its Tailwind -500 hex value. Used by
 * inline-style consumers (Gantt bars). Falls back to the supplied default
 * (or the platform default blue) when the name is unrecognized.
 */
export function getSemanticHex(name?: string, fallback: string = '#3b82f6'): string {
  if (!name) return fallback;
  return COLOR_NAME_HEX[name] ?? fallback;
}

/**
 * Select field cell renderer.
 *
 * Two visual styles, controlled by `field.appearance` (renderer-level option,
 * not part of the `@objectstack/spec` field schema):
 *   - `'badge'` (default for spec compatibility): soft-pill colored badge.
 *   - `'dot'`: a small colored dot followed by the option label. Used by
 *     dense list/grid contexts to keep the table visually quiet — repeated
 *     filled badges across many rows create heavy visual noise.
 *
 * Metadata always wins: callers can pass `appearance: 'badge'` on the field
 * descriptor to force the legacy badge in any context.
 */
export function SelectCellRenderer({ value, field }: CellRendererProps): React.ReactElement {
  const selectField = field as any;
  const options: SelectOptionMetadata[] = selectField.options || [];
  const appearance: 'badge' | 'dot' = selectField.appearance === 'dot' ? 'dot' : 'badge';

  // THE FLOOR by name and nothing more (objectui#8496). It used to be spelled
  // out here as `value == null || value === '' || isEmptyMultiValue(value)` —
  // the same four members, in the fourth of five private copies.
  //
  // `[]` is a floor MEMBER, and it is answered HERE rather than in the array
  // branch below because this is the statement the renderer makes about having
  // nothing to draw (objectui#8481): the branch opens a flex-wrap row of badges
  // and maps zero entries into it, so its whole output was a CHILDLESS
  // container — no glyph, no accessible name, a visually blank cell. The same
  // shape is why `LookupCellRenderer` (a row of record chips) and
  // `UserCellRenderer` (an overlapping avatar stack) ask the floor too.
  if (isEmptyValue(value)) return <EmptyValue />;

  // Match a stored value to a configured option, falling back to a
  // case-insensitive comparison so seed data with mixed case
  // (e.g. "Referral" stored, "referral" defined) still resolves to the
  // localized option label.
  const findOption = (val: any): SelectOptionMetadata | undefined => {
    const exact = options.find(opt => opt.value === val);
    if (exact) return exact;
    const norm = String(val).toLowerCase();
    return options.find(opt => String(opt.value).toLowerCase() === norm);
  };

  const renderOne = (val: any, key?: number): React.ReactElement => {
    const option = findOption(val);
    // An object matches no declared option code, and `String()` made one up:
    // `humanizeLabel(String({}))` printed the literal `[Object Object]` in a
    // status badge (objectui#8596). The option families' value is a string
    // code (`valueSchemaFor` → `z.enum(codes)`, or `z.string()` where none are
    // declared), so an object is read as the string class reads it — the
    // package's one coercion, byte-equal to what `text` prints. `humanizeLabel`
    // is deliberately skipped for it: it exists to turn a machine CODE into
    // words (`in_progress` → `In Progress`) and rewrites anything else.
    const label = option?.label
      || (isPlainObjectValue(val) ? String(coerceToSafeValue(val)) : humanizeLabel(String(val)));

    if (appearance === 'dot') {
      // Resolve a real CSS color for the dot. Prefer explicit option color,
      // then semantic mapping for the value, then deterministic palette.
      // An explicitly declared hex is painted as declared (objectui#5141);
      // every other declaration keeps resolving to a palette family below.
      const hexDot = getDotHexAppearance(option?.color);
      const colorName = resolveColorName(option?.color)
        || SEMANTIC_COLOR_MAP[String(val).toLowerCase().replace(/[\s-]/g, '_')]
        || hashToColor(String(val).toLowerCase().replace(/[\s-]/g, '_'));
      const dotClass = hexDot ? hexDot.className : (DOT_COLOR_MAP[colorName] || DOT_COLOR_MAP.gray);
      // max-w-full bounds the (otherwise content-sized) inline-flex box so the
      // inner truncate can engage; title keeps the full label on hover
      // (objectui#3466, same class of bug as the badge branch below).
      return (
        <span key={key} className="inline-flex max-w-full items-center gap-1.5 text-sm" title={label}>
          <span
            className={cn('h-1.5 w-1.5 rounded-full shrink-0', dotClass)}
            style={hexDot?.style}
            aria-hidden="true"
          />
          <span className="min-w-0 truncate">{label}</span>
        </span>
      );
    }

    // An explicitly declared hex renders as declared (objectui#5141); family
    // names, the semantic value map and the hash fallback are unchanged.
    const hexBadge = getBadgeHexAppearance(option?.color);
    const colorClasses = hexBadge ? hexBadge.className : getBadgeColorClasses(option?.color, val);
    // max-w-full + inner truncate: in bounded containers (detail highlight
    // strip columns, grid cells) an overlong label used to clip mid-glyph at
    // the container edge; now the badge shrinks and ellipsizes, with the full
    // label on hover.
    return (
      <Badge
        key={key}
        variant="outline"
        className={cn('max-w-full min-w-0', colorClasses)}
        style={hexBadge?.style}
        title={label}
      >
        <span className="truncate">{label}</span>
      </Badge>
    );
  };

  // Handle multiple values
  if (Array.isArray(value)) {
    return (
      <div className={cn('flex flex-wrap', appearance === 'dot' ? 'gap-x-3 gap-y-1' : 'gap-1')}>
        {value.map((val, idx) => renderOne(val, idx))}
      </div>
    );
  }

  return renderOne(value);
}

/**
 * Email field cell renderer
 */
export function EmailCellRenderer({ value }: CellRendererProps): React.ReactElement {
  // Hooks before the empty-value early return (rules-of-hooks).
  const label = useFieldLabel();
  const [copied, setCopied] = React.useState(false);
  if (!value) return <EmptyValue />;

  const coerced = coerceToSafeValue(value);
  // `[]` is truthy and coerces to `''`, which used to become a live anchor
  // with `href="mailto:"` and no text — an affordance with nothing to link to
  // (objectui#8490). No address, no link.
  if (isBlankCellText(coerced)) return <EmptyValue />;
  const safe = String(coerced);
  // An object is not an address (objectui#8596). `mailto:[Object]` was a live
  // affordance that could not work, and the copy button offered to put
  // `[Object]` on the clipboard. The spec's value class for `email` is a plain
  // string, so the cell prints the coerced text exactly as `text` prints it
  // and links nothing.
  if (isPlainObjectValue(value)) return <TruncatedText text={safe} />;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    navigator.clipboard.writeText(safe).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => { /* clipboard not available */ });
  };
  
  // Fits a bounded single-line slot with an ELLIPSIS (objectui#12523), the
  // convention `TruncatedText` states for this file (objectui#3466). The anchor
  // used to keep `Button`'s `inline-flex`, so its text sat in an anonymous flex
  // item that no `text-overflow` reaches, and the whole cell was one atomic
  // inline box: a clipping host (a `record:highlights` chip) cut the address
  // mid-word with no ellipsis, because the first atomic inline on a line is
  // clipped, never ellipsed. `max-w-full` bounds the row to its host, `block`
  // makes the anchor a block container whose own text `truncate` ellipsizes,
  // and the copy button keeps its size. A host wider than the address sees no
  // change.
  return (
    <span className="inline-flex max-w-full items-center gap-1 group/email">
      <Button
        variant="link"
        className="block min-w-0 truncate p-0 h-auto font-normal text-blue-600 hover:text-blue-800"
        asChild
      >
        <a
          href={`mailto:${safe}`}
          onClick={(e) => e.stopPropagation()}
        >
          {safe}
        </a>
      </Button>
      <button
        type="button"
        className="shrink-0 opacity-0 group-hover/email:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
        onClick={handleCopy}
        aria-label={label('detail.copyEmail', 'Copy email')}
      >
        {copied ? (
          <Check className="h-3 w-3 text-green-600" />
        ) : (
          <Copy className="h-3 w-3 text-muted-foreground" />
        )}
      </button>
    </span>
  );
}

/**
 * URL field cell renderer
 */
export function UrlCellRenderer({ value }: CellRendererProps): React.ReactElement {
  if (!value) return <EmptyValue />;

  const coerced = coerceToSafeValue(value);
  // `[]` used to become a `target="_blank"` anchor with an EMPTY `href`
  // (objectui#8490) — same ruling as `EmailCellRenderer`: nothing to link to,
  // no link.
  if (isBlankCellText(coerced)) return <EmptyValue />;
  const safe = String(coerced);
  // An object is not a URL (objectui#8596) — same ruling as
  // `EmailCellRenderer`: a `target="_blank"` anchor whose `href` is `[Object]`
  // navigates nowhere, so the coerced text prints without one.
  if (isPlainObjectValue(value)) return <TruncatedText text={safe} />;
  // Same single-line convention as `EmailCellRenderer` (objectui#12523). This
  // anchor is the cell's root, so it stays inline-level: `inline-block` is a
  // block container that draws its own ellipsis, `max-w-full` bounds it to its
  // host, and `align-top` keeps an overflow-clipped inline-block from raising
  // the line box to its bottom-edge baseline.
  return (
    <Button
      variant="link"
      className="inline-block max-w-full truncate align-top p-0 h-auto font-normal text-blue-600 hover:text-blue-800"
      asChild
    >
      <a
        href={safe}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
      >
        {safe}
      </a>
    </Button>
  );
}

/**
 * Phone field cell renderer
 */
export function PhoneCellRenderer({ value }: CellRendererProps): React.ReactElement {
  // Hooks before the empty-value early return (rules-of-hooks).
  const label = useFieldLabel();
  const [copied, setCopied] = React.useState(false);
  if (!value) return <EmptyValue />;

  const coerced = coerceToSafeValue(value);
  // `[]` used to become a live `href="tel:"` anchor with no number
  // (objectui#8490) — same ruling as `EmailCellRenderer`.
  if (isBlankCellText(coerced)) return <EmptyValue />;
  const safe = String(coerced);
  // An object is not a number to dial (objectui#8596) — same ruling as
  // `EmailCellRenderer`: no `tel:[Object]` anchor, no copy button.
  if (isPlainObjectValue(value)) return <TruncatedText text={safe} />;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    navigator.clipboard.writeText(safe).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => { /* clipboard not available */ });
  };
  
  // Same single-line convention as `EmailCellRenderer` (objectui#12523). The
  // anchor keeps its icon-and-number flex row, so the number gets its own
  // `truncate` span: a flex item whose `overflow:hidden` zeroes its automatic
  // minimum size, so it is the one thing that gives way, with an ellipsis.
  return (
    <span className="inline-flex max-w-full items-center gap-1 group/phone">
      <a
        href={`tel:${safe}`}
        className="inline-flex min-w-0 items-center gap-1 text-blue-600 hover:text-blue-800"
        onClick={(e) => e.stopPropagation()}
      >
        <PhoneIcon className="h-3 w-3 shrink-0" />
        <span className="truncate">{safe}</span>
      </a>
      <button
        type="button"
        className="shrink-0 opacity-0 group-hover/phone:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
        onClick={handleCopy}
        aria-label={label('detail.copyPhone', 'Copy phone number')}
      >
        {copied ? (
          <Check className="h-3 w-3 text-green-600" />
        ) : (
          <Copy className="h-3 w-3 text-muted-foreground" />
        )}
      </button>
    </span>
  );
}

/**
 * File field cell renderer
 */
export function FileCellRenderer({ value, field }: CellRendererProps): React.ReactElement {
  // Hoisted ABOVE the empty guard on purpose (objectui#8441): this renderer's
  // first statement was that early return, and a hook placed after a
  // conditional return violates the rules of hooks — the call would be skipped
  // for an empty value and hook order would desync between renders.
  const t = useFieldTranslate();
  // THE FLOOR WITH `[]` DECLINED, and extended with every other falsy scalar
  // (objectui#8496). A file cell STATES ITS COUNT, so an empty array is a
  // value here — it renders "0 files", which is an answer the em-dash cannot
  // give. ⛔ Do not replace this with `isEmptyValue(value)`.
  if (!value) return <EmptyValue />;
  
  const fileField = field as any;
  const isMultiple = fileField.multiple;
  
  // The display name a value that carries none falls back to — the same key and
  // the same English default `FileField` reads, so the widget and the cell never
  // name one attachment two different ways. Kept on the i18n channel
  // (objectui#8441): this card introduces no new user-facing string.
  const translatedFallback = t?.('fields.file.fileFallback');
  const fallbackName =
    !translatedFallback || translatedFallback === 'fields.file.fileFallback'
      ? 'File'
      : translatedFallback;

  // One file, as the shared affordance when it resolves to a URL and as the
  // same truncating text as before when it does not (objectui#9161). ⛔ Never a
  // dead anchor: objectui#8490's ruling for `email` / `url` / `phone` —
  // "nothing to link to, no link" — reads the same here, and worse, since an
  // anchor that navigates nowhere reads as a working download.
  const renderOne = (view: FileValueView, key?: React.Key) => (
    <FileValueAffordance
      key={key}
      view={view}
      className="text-sm"
      fallback={<TruncatedText text={view.name} className="text-sm" />}
    />
  );

  // Kept parameterised on `count` even though the only surviving call passes 0
  // (below): the sentence has to stay true for any count, or a future caller
  // re-routing it would silently read `1 files`.
  const countLabel = (count: number) => {
    const translated = t?.('detail.fileCount', { count });
    return !translated || translated === 'detail.fileCount'
      ? `${count} ${count === 1 ? 'file' : 'files'}`
      : translated;
  };

  if (Array.isArray(value)) {
    // THE DEFECT this card fixed (objectui#9161): this arm rendered the COUNT
    // and nothing else, so a record whose `file` field held a successfully
    // uploaded attachment stated `1 file` and offered no way to reach it —
    // while the read path, the signing endpoint and the signed URL all answered
    // 200. Normalising through `readFileValues` is `ImageCellRenderer`'s
    // treatment one screen below, applied to the same spec family: a string
    // URL, a CDN link and an unexpanded bare id all resolve.
    const views = readFileValues(value, fallbackName);
    if (views.length === 0) {
      // THE COUNT SURVIVES on the one arm where it is the whole answer
      // (objectui#8496): an array that resolves to no renderable file states
      // `0 files` rather than drawing the em-dash — an answer the affordance
      // cannot give. Same channel and the same literal-key rule as
      // `RepeaterCellRenderer` below (objectui#8441). The
      // `count === 1 ? 'file' : 'files'` this replaced was NOT a rule violation
      // — it is English — but it was equally unlocalized, and plural-safe for
      // English only: `ru` has four plural categories and `ar` six, so a
      // two-branch ternary cannot spell either.
      return <span className="text-sm text-gray-600">{countLabel(views.length)}</span>;
    }
    return (
      <span className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-0.5">
        {views.map((view, idx) => renderOne(view, idx))}
      </span>
    );
  }
  
  // An object carrying nothing is not a file (objectui#8596). The spec's
  // media value schema makes `url` the one required member and names "an empty
  // object" among the values it rejects, so `{}` is a value of neither the
  // stored (`sys_file` id) nor the expanded (`{url, name?, …}`) form: the
  // record holds no file, and "No value" is TRUE of it. Before this it fell
  // through to the `'File'` fallback below and drew a chip for an attachment
  // that does not exist. `ImageCellRenderer` — the same spec family — already
  // answers `{}` with the shared affordance; this is the same answer, and the
  // two are pinned against each other.
  //
  // ⛔ Deliberately narrow: an object with any member at all still renders its
  // name (or the `'File'` fallback), so a real `{name: 'contract.pdf'}` is
  // never hidden. That boundary is `AddressCellRenderer`'s, stated one screen
  // below: "an object carrying no recognized part reads as empty, while
  // `{ foo: 1 }` keeps its JSON so real data is never hidden."
  if (isPlainObjectValue(value) && Object.keys(value).length === 0) return <EmptyValue />;

  // Same treatment for the single-value arm: the `value.name ||
  // value.original_name || 'File'` this replaced picked a name and stopped,
  // which is the other half of objectui#9161. `readFileValue` picks the same
  // name (plus a URL's last segment as a name of last resort) AND resolves the
  // URL, so a single attachment is reachable too.
  return renderOne(readFileValue(value, fallbackName));
}

/**
 * The images an image cell can actually draw for `value` — every entry that
 * resolves to a URL (objectui#8677).
 *
 * `ImageCellRenderer` draws exactly these and answers an empty list with the
 * shared affordance; `SignatureCellRenderer` asks the same question to decide
 * whether a value is an image at all. ONE predicate for both, so the two can
 * never disagree about what "drawable" means: were the signature cell to route
 * a value here that this list then drops, it would draw "No value" again —
 * the defect objectui#8677 removed, returning by drift.
 *
 * An image whose value carries no name of its own (a `data:` URI, a bare id)
 * comes back NAMELESS, so the cell's alt and its lightbox fall through to the
 * translated `fields.image.imageAlt` (objectui#10493). The literal `'Image'`
 * this passed as the fallback name used to fill that gap, which named every
 * such image `Image` on every locale and left the translated alt unreachable.
 */
function displayableImagesOf(value: unknown): Array<{ url: string; name?: string }> {
  // A file the reader may not open (`metadataRefused`) is not drawable: its
  // URL is the download door, which may refuse, and no MIME type was served
  // (objectui#12339). `ImageCellRenderer` draws it as the restricted state.
  return readFileValues(value, '')
    .filter((v) => v.url && !v.metadataRefused)
    .map((v) => ({ url: v.url as string, name: v.name || undefined }));
}

/**
 * Image field cell renderer (with thumbnails + click-to-zoom).
 *
 * An image value may be a plain URL string, an object ({ url | src | href … }),
 * a bare `sys_file` id, or an array of any of those. Normalising through
 * `readFileValues` (which resolves a bare id to its stable download URL) means
 * a string-URL field, a CDN link, and an unexpanded reference all render a
 * thumbnail instead of a broken `<img src="">` placeholder.
 *
 * Clicking a thumbnail opens a full-screen lightbox (single or gallery). The
 * click is `stopPropagation`-guarded so, inside a grid row, enlarging an image
 * doesn't also trigger row navigation.
 */
export function ImageCellRenderer({ value }: CellRendererProps): React.ReactElement {
  const { t } = useObjectTranslation();
  const [lightboxIndex, setLightboxIndex] = React.useState<number | null>(null);

  const imgs = React.useMemo(() => displayableImagesOf(value), [value]);
  // Images the reader may not open (the refused marker `{ id, metadataRefused:
  // true }`): drawn as a compact restricted state, never as a thumbnail
  // (objectui#12339). The lock stays a link to the id-derived download door.
  const restricted = React.useMemo(
    () => readFileValues(value, '').filter((v) => v.metadataRefused),
    [value],
  );

  // THE FLOOR, EXTENDED twice (objectui#8496): every falsy scalar, and every
  // value that resolves to no displayable image. `[]` is covered by the second
  // extension rather than by a floor call — unlike `FileCellRenderer` next
  // door, an image cell has no count to state. A restricted image is not
  // "no value": the record holds a file this reader may not see.
  if (!value || (imgs.length === 0 && restricted.length === 0)) return <EmptyValue />;

  const restrictedMarks = restricted.length > 0 && (
    <span className="inline-flex items-center gap-1 align-middle">
      {restricted.map((view, idx) => (
        <RestrictedFileAffordance
          key={idx}
          view={view}
          compact
          className="size-8 justify-center rounded-md border bg-muted"
        />
      ))}
    </span>
  );
  if (imgs.length === 0) return <>{restrictedMarks}</>;

  const imageAlt = (idx: number, name?: string) =>
    name || t('fields.image.imageAlt', { index: idx + 1 });
  const open = (idx: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setLightboxIndex(idx);
  };
  const multiple = imgs.length > 1;

  const lightbox = lightboxIndex !== null && (
    <ImageLightbox
      images={imgs}
      index={lightboxIndex}
      open
      onOpenChange={(o) => !o && setLightboxIndex(null)}
      onIndexChange={setLightboxIndex}
    />
  );

  if (multiple) {
    return (
      <>
        <div className="flex -space-x-2">
          {imgs.slice(0, 3).map((img, idx) => (
            <img
              key={idx}
              src={img.url}
              alt={imageAlt(idx, img.name)}
              onClick={open(idx)}
              className="size-8 cursor-zoom-in rounded-md border-2 border-background object-cover transition-transform hover:scale-110 hover:z-10"
            />
          ))}
          {imgs.length > 3 && (
            <button
              type="button"
              onClick={open(3)}
              className="size-8 rounded-md border-2 border-background bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground hover:bg-muted/80"
            >
              +{imgs.length - 3}
            </button>
          )}
        </div>
        {restrictedMarks}
        {lightbox}
      </>
    );
  }

  return (
    <>
      <img
        src={imgs[0].url}
        alt={imageAlt(0, imgs[0].name)}
        onClick={open(0)}
        className="size-10 cursor-zoom-in rounded-md object-cover transition-transform hover:scale-105"
      />
      {restrictedMarks}
      {lightbox}
    </>
  );
}

/**
 * Signature field cell renderer — an image when there is one to draw, and
 * otherwise the answer of the value class the spec puts `signature` in
 * (objectui#8677).
 *
 * `@objectstack/spec` places `signature` in `STRING_VALUE_TYPES` ("Value is a
 * plain string"; the write seam is `z.string()` — the stored value is a
 * data-URI PNG), NOT in `FILE_REFERENCE_TYPES` with `image` / `avatar`. It was
 * nonetheless registered straight to `ImageCellRenderer`, whose "nothing to
 * draw" answer is the MEDIA rule: the spec's file value requires `url`, so a
 * value with none holds no file and "No value" is TRUE of it. That rule is
 * right for `image` / `avatar` and wrong here. objectui#8580 ruled the string
 * class's empty-shaped values and objectui#8596 applied the ruling to the rest
 * of the class: `{}` is something the record stores, so the cell prints
 * `coerceToSafeValue`'s answer exactly as `text` prints it, and "No value"
 * would be false. `signature` was the one member still drawing the affordance
 * for `{}`.
 *
 * ⇒ Two arms, and the image arm keeps every populated signature it drew:
 *  - a value `ImageCellRenderer` can draw (the stored data-URI string, and the
 *    URL / reference shapes that renderer already resolves) goes to it,
 *    unchanged;
 *  - anything else is read the way the string class reads it: `[]`, `''` and
 *    `null` reach the shared affordance through the same floor `text` uses,
 *    and `{}` prints `[Object]`.
 *
 * ⛔ `ImageCellRenderer` is NOT changed for `image` / `avatar` — they are
 * `FILE_REFERENCE_TYPES`, and "No value" is their correct answer to `{}`.
 * ⛔ Deliberately NOT exported, like `RepeaterCellRenderer`: the published
 * surface of `@object-ui/fields` does not move; tests reach it the way every
 * call site does — `getCellRenderer('signature')`.
 */
function SignatureCellRenderer(props: CellRendererProps): React.ReactElement {
  return displayableImagesOf(props.value).length > 0 ? (
    <ImageCellRenderer {...props} />
  ) : (
    <TextCellRenderer {...props} />
  );
}

/**
 * The referenced record's id inside one lookup value — an `$expand`-ed record
 * object (`{ id, name, … }`) or the raw foreign key itself. `undefined` when
 * the value carries no id we could address (e.g. an unresolved external-id
 * reference), which the link below reads as "not navigable".
 */
function referencedRecordId(item: unknown): string | number | undefined {
  if (item == null || item === '') return undefined;
  if (typeof item === 'object') {
    const id = (item as Record<string, unknown>).id ?? (item as Record<string, unknown>)._id;
    if (typeof id === 'number') return id;
    return typeof id === 'string' && id !== '' ? id : undefined;
  }
  if (typeof item === 'string' || typeof item === 'number') return item;
  return undefined;
}

/**
 * Wrap a lookup's display value in a link to the record it references
 * (objectui#4336).
 *
 * On the record detail page a valued lookup used to render as plain text plus
 * a copy button — the referenced document's name was right there and there was
 * no way to reach it, so users copied the number and searched for it from the
 * list. Related-list cells pointing at a third object were dead in the same
 * way. Both surfaces resolve through `LookupCellRenderer`, so the affordance
 * belongs here, once.
 *
 * **The URL is not built here.** This package has no router and no business
 * knowing what a record route looks like; the host publishes its own builder
 * through `RelatedRecordActionsContext` (`recordHref` / `openRecord`) — the
 * same one the related list's row navigation uses. No host, or a host that
 * cannot route to that object, renders the value EXACTLY as before: no anchor,
 * no styling change, nothing to un-learn (Studio designer, embedded renderers,
 * standalone grids).
 *
 * A real `href` rather than a click handler, so middle-click / ⌘-click / "copy
 * link address" behave the way a link is supposed to; a plain left click is
 * handed to the host so navigation stays in-app.
 */
function ReferencedRecordLink({
  objectName,
  recordId,
  className,
  children,
}: {
  objectName?: string;
  recordId?: string | number;
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  const host = useRelatedRecordActions();
  const navigable = !!objectName && recordId != null && recordId !== '';
  const href =
    navigable && host?.recordHref
      ? host.recordHref(objectName as string, recordId as string | number)
      : null;

  if (!href) return <>{children}</>;

  return (
    <a
      href={href}
      className={cn('text-primary underline-offset-4 hover:underline', className)}
      onClick={(e) => {
        // The rows this cell sits in carry their own click handlers — the
        // detail row copies the field value, a related-list row opens ITS own
        // record. Following the reference must not also fire those.
        e.stopPropagation();
        // Modifier and non-primary clicks belong to the browser (new tab, new
        // window) — that is the point of rendering a real href.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        // No SPA handler: let the anchor navigate on its own.
        if (!host?.openRecord) return;
        e.preventDefault();
        host.openRecord(objectName as string, recordId as string | number);
      }}
    >
      {children}
    </a>
  );
}

/**
 * How many chips a multi-value lookup cell shows before collapsing the rest
 * into a single "+N" chip. Mirrors UserCellRenderer's avatar cap (3): enough
 * to identify the cell's content, few enough that the cell cannot grow its
 * row unboundedly (objectui — a 60-reference cell blew a grid row up to
 * several screens of height).
 */
const MAX_LOOKUP_CELL_CHIPS = 3;

/**
 * Lookup/Master-Detail field cell renderer.
 *
 * Display order:
 * 1. Embedded record object (`{ id, name, ... }` from `$expand`) → use its name
 * 2. Static `field.options[]` (e.g. when the lookup is a closed enum) → look up label
 * 3. Fetch-on-demand: when the value is a primitive ID and `field.reference`
 *    is known, resolve via dataSource and show the related record's display name.
 * 4. The reader's own read answered "no record" (a 404 for a record they may
 *    not read) → "Restricted record", with no id and no link (objectui#13335).
 * 5. Nothing named it → the unresolved-reference affordance (objectui#8695):
 *    the raw value, kept visible, beside a stated epistemic marker. This arm
 *    used to be two — a muted `—` for opaque-LOOKING strings and confident
 *    bare text for everything else — which answered one state two ways.
 *
 * Record → name resolution (1 and 3) goes through the referenced object's
 * schema when the data source exposes it (`displayField` → nameField/titleFormat
 * → derivation, see {@link resolveLookupRecordName}), so the chip and the
 * picker agree (issue #2357) — and, like the picker's option label, it reads
 * only the fields the viewer may read on the referenced object
 * (objectui#10501).
 */
export function LookupCellRenderer({ value, field }: CellRendererProps): React.ReactElement {
  // `reference` — the spelling `@objectstack/spec`'s `FieldSchema` declares —
  // is the only target spelling read, as every other reader (LookupField,
  // UserField, DetailSection, RelatedList, …) reads it (objectui#11070 round
  // 4). A served def that still spells a legacy key was folded onto it at
  // ingestion (`normalizeSchemaReferenceKeys`).
  const referenceTo = (field as { reference?: string }).reference;

  // Explicit author-chosen display field on the lookup — beats every resolver.
  // ObjectGrid forwards `displayField` on the column meta (RELATIONAL_META_KEYS)
  // the same way it forwards `reference` (objectstack-ai/objectstack#2926 ⑧).
  const displayField =
    (field as { displayField?: string }).displayField ||
    (field as { reference_field?: string }).reference_field ||
    undefined;

  // Referenced object's schema (nameField / titleFormat) so expanded records
  // resolve through the same unified resolver as the picker (issue #2357).
  const refSchema = useRefObjectSchema(referenceTo);

  // The permission policy the referenced record is named under: every name
  // below is resolved from the row with the fields it denies on
  // `referenceTo` removed (objectui#10501). A policy that loads or changes
  // re-renders this cell through the context, and the names follow it.
  const perms = usePermissions();

  // Pick the FIRST primitive id we see (for arrays, only the first one is auto-resolved
  // to keep the cell cheap; multi-value lookups should generally be expanded server-side).
  const primaryPrimitiveId = (() => {
    if (Array.isArray(value)) {
      const firstPrimitive = value.find(
        (v) => v != null && (typeof v === 'string' || typeof v === 'number') && v !== '',
      );
      return firstPrimitive;
    }
    if (
      value != null &&
      value !== '' &&
      (typeof value === 'string' || typeof value === 'number') &&
      typeof value !== 'object'
    ) {
      return value;
    }
    return undefined;
  })();

  // Always call the hook (rules of hooks). It safely no-ops when inputs are missing.
  const lookupAnswer = useLookupName(referenceTo, primaryPrimitiveId, displayField, perms);
  const resolvedName = lookupAnswer?.state === 'named' ? lookupAnswer.name : undefined;
  // The reader's own read of the first primitive answered "no record"
  // (objectui#13335). Only that id gets the restricted face: in flight, a
  // failed read, an unnamed record and the entries never asked keep the
  // unresolved one below.
  const restrictedId = lookupAnswer?.state === 'absent' ? primaryPrimitiveId : undefined;
  const restrictedLabel = useRestrictedLookupLabel();

  // THE FLOOR by name and nothing more (objectui#8496). Same childless-container
  // defect as `SelectCellRenderer` above: the array branch further down opens a
  // flex-wrap row of chips and maps zero entries into it (objectui#8481).
  if (isEmptyValue(value)) return <EmptyValue />;

  // A reference can arrive as a JSON-encoded object string — e.g. an
  // unresolved external-id reference '{"externalId":"Website Relaunch"}'.
  // Parse it and render a label instead of leaking raw JSON into the cell.
  if (typeof value === 'string') {
    const s = value.trim();
    if (s.startsWith('{') && s.endsWith('}')) {
      // Compute inside try, render outside — constructing JSX in a try/catch
      // doesn't catch its render errors anyway (react-hooks/error-boundaries).
      let parsedDisplay = '';
      let parsedId: string | number | undefined;
      try {
        const parsed = JSON.parse(s) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object') {
          parsedDisplay =
            resolveLookupRecordName(parsed, refSchema, displayField, perms, referenceTo) ||
            String(parsed.externalId ?? parsed.id ?? parsed._id ?? '');
          // An external-id reference has no record id yet — stays unlinked.
          parsedId = referencedRecordId(parsed);
        }
      } catch { /* not JSON — fall through to normal resolution */ }
      if (parsedDisplay) {
        return (
          <ReferencedRecordLink objectName={referenceTo} recordId={parsedId}>
            <TruncatedText text={parsedDisplay} />
          </ReferencedRecordLink>
        );
      }
    }
  }

  // Server-side $expand returns the related record as a nested object
  // (e.g. { id, name }). Render its display name directly — no fetch needed.
  if (!Array.isArray(value) && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const display =
      resolveLookupRecordName(obj, refSchema, displayField, perms, referenceTo) || String(obj.id || obj._id || '');
    if (display) {
      return (
        <ReferencedRecordLink objectName={referenceTo} recordId={referencedRecordId(obj)}>
          <TruncatedText text={display} />
        </ReferencedRecordLink>
      );
    }
  }

  const options: Array<{ value: unknown; label: string }> =
    (field as { options?: Array<{ value: unknown; label: string }> }).options || [];

  // Resolve a primitive ID to a label. Order:
  //   options → server-resolved name (via useLookupName) → UNRESOLVED
  //
  // ⭐ That last arm used to be TWO, and the split between them was the
  // defect (objectui#8695). `isLikelyOpaqueId(val)` sent opaque-LOOKING
  // strings to a muted `—` and sent everything else to confident bare text —
  // so ONE epistemic state, a reference this screen did not resolve, got two
  // OPPOSITE answers, chosen by the SHAPE of the string rather than by
  // whether anything resolved. Re-measured on this base with
  // `reference_to: 'sys_user'`:
  //
  //   'Ada Lovelace'     → <span class="block max-w-full truncate"
  //                          title="Ada Lovelace">Ada Lovelace</span>
  //   '01HQZX9K2M4N6P8R' → <span class="block max-w-full truncate
  //                          text-muted-foreground" title="—">—</span>
  //
  // The first is BYTE-IDENTICAL to what a `text` cell prints for the same
  // string: the screen states a confident fact it does not have, and a dirty
  // row reads exactly like a clean one. The second destroys the raw id, which
  // objectui#8434's triage named as "the only clue for diagnosing existing
  // dirty rows". Opposite failures, one state.
  //
  // Both are now the SAME answer — the one objectui#8434 settled for `user`:
  // additive (a stated marker, never the absence of one), epistemic (this
  // screen did not resolve it, never "not found"), raw value kept visible.
  // See `UnresolvedLookupReference` for why this renderer is entitled to say
  // nothing stronger.
  const resolveLabel = (val: unknown): { text: string; unresolved: boolean; restricted: boolean } => {
    if (options.length > 0) {
      const found = options.find((opt) => String(opt.value) === String(val));
      if (found) return { text: found.label, unresolved: false, restricted: false };
    }
    if (val === primaryPrimitiveId && resolvedName) {
      return { text: resolvedName, unresolved: false, restricted: false };
    }
    if (restrictedId !== undefined && val === restrictedId) {
      return { text: String(val), unresolved: false, restricted: true };
    }
    return { text: String(val), unresolved: true, restricted: false };
  };

  if (Array.isArray(value)) {
    const itemDisplay = (item: unknown): { label: string; unresolved: boolean; restricted: boolean } => {
      if (item != null && typeof item === 'object') {
        return {
          label:
            resolveLookupRecordName(item as Record<string, unknown>, refSchema, displayField, perms, referenceTo) ||
            String((item as any).id || (item as any)._id || '[Object]'),
          unresolved: false,
          restricted: false,
        };
      }
      const r = resolveLabel(item);
      // A restricted entry's label is the restricted sentence, never its id —
      // the overflow chip's `title` lists labels too.
      return { label: r.restricted ? restrictedLabel : r.text, unresolved: r.unresolved, restricted: r.restricted };
    };

    // Cap the chips the same way UserCellRenderer caps its avatars: a
    // multi-value lookup can reference dozens of records (a 60-reference cell
    // has been seen in the wild), and one chip per reference lets a single
    // cell stretch its row to several screens. The hidden names stay
    // reachable — the overflow chip's `title` lists them, and the record
    // itself shows the full set.
    const visible = value.slice(0, MAX_LOOKUP_CELL_CHIPS);
    const overflow = value.slice(MAX_LOOKUP_CELL_CHIPS);
    return (
      <div className="flex flex-wrap gap-1">
        {visible.map((item, idx) => {
          const { label, unresolved, restricted } = itemDisplay(item);
          if (restricted) {
            // No link: the reader's read of this record answered "not found".
            return (
              <span
                key={idx}
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted/40 text-muted-foreground"
              >
                <RestrictedLookupReference label={label} />
              </span>
            );
          }
          // Each chip is one referenced record, so each links on its own —
          // there is no single destination a multi-value cell could point at.
          return (
            <ReferencedRecordLink
              key={idx}
              objectName={referenceTo}
              recordId={referencedRecordId(item)}
              className="text-inherit"
            >
              <span
                className={cn(
                  'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                  unresolved
                    ? 'bg-muted/40 text-muted-foreground'
                    : 'bg-gray-50 text-gray-700 dark:bg-gray-800/50 dark:text-gray-200',
                )}
              >
                {/* The multi-value shape gets the same ruling as the scalar
                    one, one input-shape over (objectui#8695): a chip must not
                    be honest about an unresolved reference on one shape and
                    silent about it on the other. The chip's muted background
                    is unchanged — what changes is that the raw value survives
                    inside it instead of being replaced by `—`. */}
                {unresolved ? <UnresolvedLookupReference value={label} /> : label}
              </span>
            </ReferencedRecordLink>
          );
        })}
        {overflow.length > 0 && (
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted/40 text-muted-foreground"
            title={overflow.map((item) => itemDisplay(item).label).join(', ')}
          >
            +{overflow.length}
          </span>
        )}
      </div>
    );
  }

  if (typeof value === 'object' && value !== null) {
    const label =
      resolveLookupRecordName(value as Record<string, unknown>, refSchema, displayField, perms, referenceTo) ||
      String((value as any).id || (value as any)._id || '[Object]');
    return (
      <ReferencedRecordLink objectName={referenceTo} recordId={referencedRecordId(value)}>
        <TruncatedText text={label} />
      </ReferencedRecordLink>
    );
  }

  // Primitive value (e.g. raw ID): try options → resolver → UNRESOLVED.
  // The value IS the foreign key, so it addresses the record even when no
  // display name could be resolved — a reference that is present but unnamed
  // is still worth being able to open, which is why the affordance stays
  // INSIDE the link rather than replacing it.
  const { text, unresolved, restricted } = resolveLabel(value);
  // ...except a reference the reader's own read answered "not found" for
  // (objectui#13335): the label, no id, and no link to a page that would 404.
  if (restricted) return <RestrictedLookupReference label={restrictedLabel} />;
  return (
    <ReferencedRecordLink objectName={referenceTo} recordId={referencedRecordId(value)}>
      {unresolved ? (
        <UnresolvedLookupReference value={text} />
      ) : (
        <TruncatedText text={text} />
      )}
    </ReferencedRecordLink>
  );
}

/**
 * Formula field cell renderer (read-only). `summary` is registered to it too.
 *
 * The TABLE face of a formula; `FormulaField`'s read-only branch is its FORM
 * face, and the two read one rule (objectui#11748): the declared `returnType`,
 * or, with none, a JS number as a number and anything else as text. Each type
 * is then drawn through the calls the matching field type's faces make, so
 * one stored value reads the same in the form and in the table. The rule is
 * spelled in both modules because this barrel and the lazily loaded widget may
 * not import each other; `__tests__/formulaFaces.returnType-11748.test.tsx`
 * compares the two faces' text for every declared type.
 */
export function FormulaCellRenderer({ value, field }: CellRendererProps): React.ReactElement {
  // Hooks before the empty-value early return: the hook count must not change
  // when a value flips between null and set. The date face reads the display
  // locale; the boolean face reads the locale's word.
  const locale = useDisplayLocale();
  const booleanLabel = useBooleanValueLabel();
  const safe = coerceToSafeValue(value);
  // THE FLOOR by name and nothing more (objectui#8496), on the coerced text —
  // same relation as `TextCellRenderer`, which this renderer's text face mirrors.
  if (isEmptyValue(safe)) return <EmptyValue />;

  // A NUMERIC result is drawn by the number cell (objectui#11683). This
  // renderer printed every result as raw monospace text, so the showcase's
  // Budget Remaining (a formula declaring no `returnType`) read `200000` beside
  // a formatted currency column. A number now goes through `NumberCellRenderer`,
  // whose `formatNumberFieldValue` is the one call every number face makes: the
  // locale's grouping, and the width `resolveFieldScale` answers for this field.
  // The spec applies `scale` to a `formula` field, so a declared one is honoured.
  //
  // Which results are of which type:
  //   - a declared `returnType`: the spec's declared value type, read as
  //     declared, and never overridden by the value.
  //   - no `returnType`: the value's own JSON type. Only a JS number counts; a
  //     string of digits from an undeclared formula stays text, because nothing
  //     says it is a quantity (a postcode built by concatenation is not one).
  //
  // ⛔ No type is inferred from the expression or from its inputs. The spec's
  // own field form says of `returnType` that consumers read it "instead of
  // re-parsing the expression", so a formula over two currency fields that
  // declares `number` (or nothing) renders as a number here, not as money.
  const returnType = field && 'returnType' in field ? field.returnType : undefined;
  const valueType = returnType ?? (typeof value === 'number' ? 'number' : 'text');
  if (valueType === 'number') {
    return <NumberCellRenderer value={value} field={field} />;
  }

  // A declared CURRENCY is money (objectui#12111): the spec's `currency`
  // return type is "an amount of money, in the currency the formula's own
  // `currencyConfig` declares, as a currency field declares it". So it is drawn
  // by the currency cell itself, handed this formula's own definition: that
  // renderer reads `currencyConfig` through `resolveFieldCurrency` exactly as
  // it reads a currency field's, so a `fixed` config keeps its own code and an
  // absent one is `dynamic`, the tenant default currency. ⛔ No second money
  // formatter here.
  if (valueType === 'currency') {
    return <CurrencyCellRenderer value={value} field={field} />;
  }

  // A declared BOOLEAN reads the locale's Yes / No word (objectui#11748), the
  // word `BooleanField`'s read-only branch and the form face draw, and not
  // `BooleanCellRenderer`'s checkbox: a box has no text to agree with the
  // form's word. Only a JS boolean is a boolean, under the rule both boolean
  // faces apply (objectui#8582 / objectui#8593); this printed `true` raw.
  if (valueType === 'boolean') {
    if (typeof value !== 'boolean') return <EmptyValue />;
    return <span>{booleanLabel(value)}</span>;
  }

  // A declared DATE reads `formatDate`'s DEFAULT face (objectui#11748), the
  // face `DateField`'s read-only branch and the form face draw; this printed
  // the stored ISO text raw. ⛔ Not `DateCellRenderer`'s relative default
  // (`Today`, `2 days ago`): that face exists in the table only, so a formula
  // drawn with it would read one way in the form and another here. A falsy or
  // unparsable value is empty, guarded exactly as the form face guards it,
  // with `formatDate`'s own parse step.
  if (valueType === 'date') {
    if (!safe || isNaN(toDisplayDate(safe as string | number).getTime())) return <EmptyValue />;
    return <span className="tabular-nums">{formatDate(safe as string | number, undefined, { locale })}</span>;
  }

  // TEXT is drawn by the text cell (objectui#12357), declared `text` or
  // undeclared alike, so a formula that yields a person's name reads in the
  // column's own font beside the text fields around it. This printed every
  // remaining result in monospace, so a Leads Name column built by a formula
  // read as code; declaring `returnType: 'text'` changed nothing, and most
  // code-authored formulas arrive with no `returnType` at all. An expanded
  // record or an array is coerced to its name / joined text by the same
  // `coerceToSafeValue` both renderers call, so it takes this face too.
  return <TextCellRenderer value={value} field={field} />;
}

/**
 * A `user` reference this screen did NOT resolve to a person (objectui#8434).
 *
 * ## Why a primitive here is never "the ID or username"
 *
 * `user` is a lookup specialised to `sys_user`: `@objectstack/spec` puts it in
 * `REFERENCE_VALUE_TYPES`, whose stored form is a record id and whose expanded
 * form is the related record OBJECT. So the object branches below are the
 * resolved case, and a primitive reaching this renderer means exactly one
 * thing — nothing on this screen turned that reference into a person.
 *
 * The branch this replaces printed it as bare text, byte-identical to what a
 * `text` cell prints. Measured on the merged tree: `'Ada Lovelace'` (a name
 * written into the column), `'u_1'` and an opaque ULID all rendered as
 * `<span class="block max-w-full truncate" title="…">…</span>` — while an
 * expanded object rendered avatar + name. The ONLY difference between "we
 * resolved this person" and "we resolved nothing" was the ABSENCE of the
 * avatar, and a user who has never seen the avatar has no reason to read
 * absence as a failure. A subtractive signal is not a signal.
 *
 * ## Why the sentence says "unresolved" and not "not found"
 *
 * Measured, not assumed: this branch has TWO populations and cannot tell them
 * apart.
 *
 *   1. a `sys_user` id that arrived UNEXPANDED — the legitimate stored form.
 *      `packages/core/src/utils/expand-fields.ts` names it in those words:
 *      "a `user` column that is NOT requested for expansion comes back as a
 *      raw user id" (objectui#2032). The record exists.
 *   2. a string that is not a resolvable reference at all — a person's name
 *      written into the column (cloud#2074), which the save path refuses with
 *      `reference_not_found`.
 *
 * Both arrive as the same primitive, so a "not found" claim would be FALSE for
 * (1) — the same class of defect this card repairs, aimed the other way. What
 * is true of both is epistemic: this screen did not resolve it. The affordance
 * says that and nothing more.
 *
 * ⛔ The raw value stays VISIBLE and un-elided. It is the only clue for
 * diagnosing an existing dirty row, so this is deliberately NOT
 * `LookupCellRenderer`'s muted em-dash for opaque ids — that treatment buys
 * tidiness by destroying the evidence.
 *
 * ⚠️ No `pointer-events-none` here, unlike `EmptyValue`: that utility stops the
 * span being a hit target, so a `title` on it never renders a tooltip
 * (objectui#8506). The stated sentence has to be reachable by hovering.
 */
function UnresolvedUserReference({
  value,
  className,
}: {
  value: unknown;
  className?: string;
}): React.ReactElement {
  const t = useFieldTranslate();
  const raw = String(value);
  // The key is written as a LITERAL at every site on purpose:
  // `check:i18n-keys` judges a literal key against the `en` pack and checks
  // that the arguments here are exactly the holes that value has, and it
  // downgrades a key read from a constant to report-only. A shared constant
  // would have bought tidiness at the cost of the gate — which is also why
  // `UnresolvedLookupReference` below spells its own key out rather than
  // taking one as a prop.
  const translated = t?.('detail.unresolvedReference', { value: raw });
  // Same provider-less rule `useFieldLabel` documents: i18next echoes the key
  // when nothing resolves it, and the English fallback applies then. That
  // fallback is held byte-equal to the `en` pack's value by a pin, since this
  // shape is invisible to the inline-`defaultValue` half of `check:i18n-keys`.
  const hint =
    !translated || translated === 'detail.unresolvedReference'
      ? `Unresolved reference: ${raw} was not resolved to a user`
      : translated;
  return <UnresolvedReferenceMark raw={raw} hint={hint} className={className} />;
}

/**
 * A `lookup` / `master_detail` / `tree` reference this screen did NOT resolve
 * to a record (objectui#8695), carrying objectui#8434's ruling to the second
 * renderer that had the same defect.
 *
 * ## The state this names, and how many causes hide behind it
 *
 * `LookupCellRenderer` reaches here when neither the author's `options` nor
 * `useLookupName` produced a name, and the reader's read did not answer "no
 * record". The causes left, which the renderer does not tell apart:
 *
 *   1. never fetched — no `dataSource`, or no `reference` on the field;
 *   2. IN FLIGHT — the first paint of every successful resolve passes through
 *      here (measured: the settled paint replaces it);
 *   3. the resolver threw (`state: 'err'`);
 *   4. it answered with a record no display field could name;
 *   5. not attempted BY POLICY — only the FIRST primitive of an array is
 *      auto-resolved (`primaryPrimitiveId`), so entries 2..n never ask.
 *
 * A sixth cause used to land here too: the resolver answered with NO record.
 * `useLookupName` now surfaces that one (objectui#13335) and it draws
 * `RestrictedLookupReference` instead — it is the reader's own read saying
 * "not found", which a 404 for a record they may not read becomes. That face
 * still does not tell "cannot read" from "does not exist": the platform fuses
 * them on purpose (objectui#8631), and so does the label. What is true of the
 * five above is epistemic, and it is all this affordance says: this screen
 * did not resolve it.
 *
 * ## Why the raw value stays, and the `—` does not
 *
 * ⛔ This deliberately does NOT keep the muted em-dash this arm used to draw
 * for `isLikelyOpaqueId` strings. objectui#8434's triage named that treatment
 * by name and ruled against it — the raw string "is the only clue for
 * diagnosing existing dirty rows" — and the mother fix's own docblock says it
 * again: that treatment buys tidiness by destroying the evidence. The tidiness
 * it bought is real and it is the trade-off objectui#8695 flagged against
 * itself; it is bought back by TRUNCATION, which hides the id without deleting
 * it. The `—` also collided with `EmptyValue`'s glyph, so a cell with no value
 * and a cell whose value failed to resolve read identically to a person.
 *
 * ⚠️ The sentence is a SIBLING key, not the `user` one: that pack value ends
 * "was not resolved to a user", which is false on a `lookup` pointing at any
 * other object, and it is pinned byte-for-byte by two existing tests.
 */
function UnresolvedLookupReference({
  value,
  className,
}: {
  value: unknown;
  className?: string;
}): React.ReactElement {
  const t = useFieldTranslate();
  const raw = String(value);
  // Literal key — see `UnresolvedUserReference` above for what reading it
  // from a constant would cost at `check:i18n-keys`.
  const translated = t?.('detail.unresolvedLookupReference', { value: raw });
  const hint =
    !translated || translated === 'detail.unresolvedLookupReference'
      ? `Unresolved reference: ${raw} was not resolved to a record on this screen`
      : translated;
  return <UnresolvedReferenceMark raw={raw} hint={hint} className={className} />;
}

/** The translated "Restricted record" label (objectui#13335); literal key for `check:i18n-keys`. */
function useRestrictedLookupLabel(): string {
  const t = useFieldTranslate();
  const translated = t?.('detail.restrictedLookupReference', { defaultValue: 'Restricted record' });
  return !translated || translated === 'detail.restrictedLookupReference' ? 'Restricted record' : translated;
}

/**
 * A `lookup` / `master_detail` / `tree` reference whose record the reader's
 * own read answered "not found" for (objectui#13335) — on the ObjectStack
 * adapter, a 404 the server gives a record this viewer may not read.
 *
 * ⛔ No id and no link. The id was the only thing the old face showed, and it
 * means nothing to a person; a link would open a page that answers 404. ⛔ No
 * second read to name the record: the label says only what the reader's own
 * read already said, so it reveals nothing the id did not. The platform
 * answers "hidden from you" and "does not exist" with the same 404 on purpose
 * (objectui#8631), so this face is drawn for both: from where the reader
 * stands, either way the record is not one they can open.
 */
function RestrictedLookupReference({ label }: { label: string }): React.ReactElement {
  return (
    <span
      data-slot="restricted-reference"
      className="inline-flex min-w-0 max-w-full items-center gap-1 text-muted-foreground"
      title={label}
    >
      <Lock className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </span>
  );
}

/**
 * The shipped PRESENTATION of an unresolved reference, shared by the two
 * renderers that state one (objectui#8434 for `user`, objectui#8695 for
 * `lookup` / `master_detail` / `tree`), and published for the host faces of the
 * widget-hinted reference keys (objectui#12613), which draw the same state.
 *
 * Only the drawing is shared. Each caller keeps its own literal i18n key and
 * its own English fallback, because a key reaching this component as a prop
 * would be a key `check:i18n-keys` can no longer judge — and because the two
 * sentences are genuinely different claims: one is about a person, the other
 * about a record of whatever object the lookup points at.
 *
 * ⚠️ No `pointer-events-none` here, unlike `EmptyValue`: that utility stops the
 * span being a hit target, so a `title` on it never renders a tooltip
 * (objectui#8506). The stated sentence has to be reachable by hovering.
 *
 * ⚠️ `truncate` on the inner span rather than the outer one, and the outer is
 * `inline-flex`: `overflow: hidden` gives a flex item an automatic minimum
 * size of zero, so the text shrinks and ellipsises instead of forcing the row
 * wider. The full value stays reachable through the `title` sentence, which
 * names it — that is how this shape meets objectui#3466's truncation contract
 * (a single-line value must never expand its column and must expose its full
 * text) with an icon in front of the text.
 */
export function UnresolvedReferenceMark({
  raw,
  hint,
  className,
}: {
  raw: string;
  hint: string;
  className?: string;
}): React.ReactElement {
  return (
    <span
      data-slot="unresolved-reference"
      className={cn(
        'inline-flex min-w-0 max-w-full items-center gap-1 text-muted-foreground',
        className,
      )}
      title={hint}
    >
      <CircleQuestionMark className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{raw}</span>
    </span>
  );
}

/**
 * User/Owner field cell renderer (with avatars)
 *
 * The name and the avatar are DISPLAY values, so each person row is drawn as
 * the viewer may read it (objectui#10535): with a loaded policy, the fields it
 * denies on the person's object are removed first ({@link withoutDeniedFields},
 * `id` kept), and everything below reads that row — exactly as it reads the
 * row a stripping backend serves. The person's object is the field's
 * `reference`, and `sys_user` when it names none: the object `UserField`
 * points the picker at.
 */
export function UserCellRenderer({ value, field }: CellRendererProps): React.ReactElement {
  // Called before any early return (rules of hooks). A policy that loads or
  // changes re-renders this cell through the context, and the drawing follows.
  const perms = usePermissions();
  const personObject =
    (field as { reference?: string } | undefined)?.reference ||
    'sys_user';

  // THE FLOOR by name (objectui#8496) plus ONE extension: every falsy scalar.
  // `!value` alone never saw `[]` — a truthy empty array reached the
  // avatar-stack branch below and rendered an empty stack (objectui#8481) —
  // and the floor alone would let `0` through to `UnresolvedUserReference`,
  // which is not what a user reference of zero is.
  if (isEmptyValue(value) || !value) return <EmptyValue />;

  // A primitive is an UNRESOLVED reference, not "the ID/username" (objectui#8434).
  // The comment that stood here stated the branch's premise, and the premise was
  // wrong: printing the raw string as displayable text renders "resolution
  // failed" as "resolution succeeded". See `UnresolvedUserReference` for the two
  // populations that reach here and why the sentence is epistemic.
  if (typeof value !== 'object') {
    return <UnresolvedUserReference value={value} />;
  }
  
  if (Array.isArray(value)) {
    return (
      <div className="flex -space-x-2">
        {value.slice(0, 3).map((entry, idx) => {
          // The same ruling as the scalar branch above, one input-shape over
          // (objectui#8434): an entry that is not an expanded record is a
          // reference this screen did not resolve, and it said so by drawing
          // nothing. A multi-value `user` field must not be honest on its
          // single-value shape and silent on this one.
          if (typeof entry !== 'object' || entry === null) {
            return <UnresolvedUserReference key={idx} value={entry} className="text-sm" />;
          }
          // Each person as the viewer may read it (objectui#10535).
          const user = withoutDeniedFields(entry, perms, personObject);
          // An entry carrying nothing names no person (objectui#8596) — the
          // same ruling as the scalar branch below, one input-shape over.
          if (isPlainObjectValue(user) && Object.keys(user).length === 0) {
            return (
              <TruncatedText key={idx} text={String(coerceToSafeValue(user))} className="text-sm" />
            );
          }
          const name = user.name || user.username || 'User';
          const initials = name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
          
          return (
            <Avatar
              key={idx}
              className="size-8 border-2 border-white"
              title={name}
            >
              {user.image && <AvatarImage src={user.image} alt={name} />}
              <AvatarFallback className="bg-blue-500 text-white text-xs">
                {initials}
              </AvatarFallback>
            </Avatar>
          );
        })}
        {value.length > 3 && (
          <Avatar className="size-8 border-2 border-white">
            <AvatarFallback className="bg-gray-200 text-gray-600 text-xs">
              +{value.length - 3}
            </AvatarFallback>
          </Avatar>
        )}
      </div>
    );
  }
  
  // An expanded reference carrying nothing names no person (objectui#8596).
  // `{}` drew an avatar whose initial was `U` and whose caption was the
  // literal `'User'` — a face and a name for a record that has neither, taken
  // from the fallback below. `user` shares `valueSchemaFor`'s reference arm
  // with `lookup` / `master_detail` / `tree` (a record-id string when stored,
  // the related record object when expanded), and that family already answers
  // an object it cannot name with the coerced text — so `user` answers it the
  // same way, and the two are pinned byte-equal.
  //
  // ⛔ Deliberately narrow: `{ id: 'u_1' }` still draws its avatar, so no
  // populated reference moves. Same boundary as `AddressCellRenderer`'s.
  //
  // Judged on the person as the viewer may read it (objectui#10535), as is
  // everything below.
  const user = withoutDeniedFields(value, perms, personObject);
  if (Object.keys(user).length === 0) {
    return <TruncatedText text={String(coerceToSafeValue(user))} />;
  }

  const name = user.name || user.username || 'User';
  const initials = name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
  
  return (
    <div className="flex items-center gap-2">
      <Avatar className="size-8">
        {user.image && <AvatarImage src={user.image} alt={name} />}
        <AvatarFallback className="bg-blue-500 text-white text-xs">
          {initials}
        </AvatarFallback>
      </Avatar>
      <TruncatedText text={String(name)} />
    </div>
  );
}

/**
 * Field Registry
 * Stores mapping between field types and their renderers.
 */
const fieldRegistry = new Map<string, React.FC<CellRendererProps>>();

/**
 * Register a custom field renderer
 * @param type Field type (e.g. 'text', 'location', 'my-custom-type')
 * @param renderer React component to render the field
 */
export function registerFieldRenderer(type: string, renderer: React.FC<CellRendererProps>) {
  fieldRegistry.set(type, renderer);
}

/**
 * ## Polymorphic pointer pairs: `referenceVia` (objectui#12045)
 *
 * `@objectstack/spec`'s `FieldSchema.referenceVia` declares a `text` field as
 * the ID HALF of a two-column pointer pair (ADR-0052 §5): its value is a
 * record id of the object that the SIBLING column names, on the same row.
 * `sys_approval_request.record_id` with `referenceVia: 'object_name'` is one;
 * `sys_activity.source_id` with `referenceVia: 'source_object'` is another.
 *
 * The target object varies per ROW, so the pair is resolved where the row is
 * in hand, at the call site. {@link CellRendererProps} carries one value and no
 * row, which is why this is a function a call site asks and not a branch inside
 * {@link getCellRenderer}, whose dispatch stays on the field type alone.
 *
 * ⭐ This is the one place the rule lives. A call site that holds the row asks
 * `resolveRecordPointer(field, row, optionsOf)`, and draws a pair it gets back
 * with the renderer registered under {@link RECORD_POINTER_CARD_TYPE}, passing
 * the pair as that renderer's `value`. The same call answers whether the
 * platform asserted the target deleted on this row (`referenceDeletedWhen`,
 * objectui#12489), so no face and no call site evaluates that predicate. This package registers a default under that key
 * which draws the record id as text, exactly as the field drew before its pair
 * was read, so a host with nothing better changes nothing. A host that can read
 * records registers a richer face under the same key with
 * {@link registerFieldRenderer}: `@object-ui/app-shell` registers its record
 * preview card there.
 *
 * Two call sites ask it. The record details grid (`DetailSection` in
 * `@object-ui/plugin-detail`) draws the pair with the renderer registered under
 * {@link RECORD_POINTER_CARD_TYPE}. The list grid (`ObjectGrid` in
 * `@object-ui/plugin-grid`, objectui#12608) draws it with its own cell face,
 * not with that renderer: a face that reads its target one record at a time
 * costs one request per row in a list, so the list face batches the page's
 * targets into one read per object.
 */
export const RECORD_POINTER_CARD_TYPE = 'record_pointer_card';

/** One resolved pointer pair: the record a `referenceVia` field points at. */
export interface RecordPointer {
  /** The target's object machine name: the sibling column's value. */
  objectName: string;
  /** The target's record id: the pointer field's own value. */
  recordId: string;
  /**
   * Present only when the platform asserted, on this row, that the target was
   * deleted (the field's `referenceDeletedWhen` predicate holds, objectui#12489):
   * the label of the declared option that says so, as the call site's option
   * labels spell it. A face that receives it draws the tombstone in this text,
   * reads nothing and links nothing. Absent on every other row, and a face
   * then draws the pair as before.
   */
  deletedLabel?: string;
}

/**
 * `@objectstack/spec`'s `FieldSchema.referenceDeletedWhen`: the sibling
 * `select` field, and the one option of it, that the platform writes on a row
 * whose pointed-at record it deleted. The spec refuses it at parse unless the
 * field declares `referenceVia`, `field` is a single-value `select` of the same
 * object declaring inline `options`, and `value` is one of those options.
 */
type ReferenceDeletedWhen = { readonly field: string; readonly value: string };

/** The call site's option list for one field: what `select` cells draw with. */
type OptionsOf = (fieldName: string) => ReadonlyArray<{ readonly value?: unknown; readonly label?: unknown }> | null | undefined;

/**
 * Resolve the record a `referenceVia` pointer field points at on one row, or
 * `null` when the field is not a pointer or the row does not address a record.
 *
 * - `field` must be a `text` field declaring a non-empty `referenceVia`; the
 *   spec refuses the key on every other type, so nothing else qualifies here.
 * - The pair is read from `row`: the id under the field's own name, the object
 *   name under the sibling column the field names.
 * - Both halves must be non-blank strings. A half-addressed row is not a
 *   pointer this can draw, and the caller falls back to the field's ordinary
 *   face (the stored text).
 *
 * ## A deletion the platform asserts: `referenceDeletedWhen` (objectui#12489)
 *
 * When the field also declares `referenceDeletedWhen: { field, value }` and
 * this row's sibling `field` holds exactly `value`, the pair comes back with
 * `deletedLabel`: the label of that declared option, looked up in
 * `optionsOf(field)`. The call site supplies `optionsOf` because it holds the
 * object definition and the option labels the rest of its grid draws with
 * (localized ones included), so the tombstone and the sibling `select`'s own
 * cell say the same thing.
 *
 * - Only the declared assertion marks a target deleted. A target read that
 *   fails or answers no record says nothing about why: the platform answers a
 *   deleted record and one outside the reader's row set alike, on purpose.
 * - No `optionsOf`, or no option with that value among the sibling's options,
 *   means no label to draw, and the pair comes back without `deletedLabel`.
 *   The spec refuses a predicate whose value is not a declared option, so the
 *   second case is not reachable from spec-valid metadata. ⛔ Never the raw
 *   option value as the text: the tombstone is the option's own label.
 */
export function resolveRecordPointer(
  field: {
    readonly name: string;
    readonly type?: string | null;
    readonly referenceVia?: string | null;
    readonly referenceDeletedWhen?: ReferenceDeletedWhen | null;
  } | null | undefined,
  row: Readonly<Record<string, unknown>> | null | undefined,
  optionsOf?: OptionsOf,
): RecordPointer | null {
  if (!field || !row) return null;
  if (field.type !== 'text') return null;
  const via = field.referenceVia;
  if (typeof via !== 'string' || via === '') return null;
  const recordId = row[field.name];
  const objectName = row[via];
  if (typeof recordId !== 'string' || recordId.trim() === '') return null;
  if (typeof objectName !== 'string' || objectName.trim() === '') return null;
  const deletedLabel = resolveDeletedLabel(field.referenceDeletedWhen, row, optionsOf);
  return deletedLabel === null ? { objectName, recordId } : { objectName, recordId, deletedLabel };
}

/** The declared option's label when the row holds the deletion predicate, else `null`. */
function resolveDeletedLabel(
  when: ReferenceDeletedWhen | null | undefined,
  row: Readonly<Record<string, unknown>>,
  optionsOf: OptionsOf | undefined,
): string | null {
  if (!when || typeof when.field !== 'string' || typeof when.value !== 'string') return null;
  if (row[when.field] !== when.value) return null;
  const option = optionsOf?.(when.field)?.find((candidate) => candidate?.value === when.value);
  const label = option?.label;
  return typeof label === 'string' && label.trim() !== '' ? label : null;
}

function isRecordPointer(value: unknown): value is RecordPointer {
  if (value == null || typeof value !== 'object') return false;
  const candidate = value as Partial<RecordPointer>;
  return typeof candidate.objectName === 'string' && typeof candidate.recordId === 'string';
}

/**
 * The default face for {@link RECORD_POINTER_CARD_TYPE}: the record id as
 * text, which is what the pointer field drew before its pair was read, or, on
 * a row where the platform asserted the target deleted, the declared option's
 * label (`deletedLabel`, objectui#12489) in place of the id. Any other value
 * goes to the text cell unchanged.
 */
function RecordPointerTextCellRenderer({ value, field }: CellRendererProps): React.ReactElement {
  const text = isRecordPointer(value) ? (value.deletedLabel ?? value.recordId) : value;
  return <TextCellRenderer value={text} field={field} />;
}

/**
 * Format hints (e.g. `{ type: 'text', format: 'phone' }`) that should
 * map to a richer cell renderer than the bare type would imply. The
 * canonical ObjectStack pattern uses `Field.text({ format: 'phone' })`
 * for plain text columns that should still render with a tel: link,
 * `Field.text({ format: 'url' })` for clickable links, etc.
 *
 * Only applies when the field's base type is a generic text type;
 * explicit types like 'phone'/'email'/'currency' already win without
 * any format hint.
 */
const FORMAT_TO_RENDERER: Record<string, string> = {
  phone: 'phone',
  tel: 'phone',
  telephone: 'phone',
  email: 'email',
  url: 'url',
  uri: 'url',
  link: 'url',
  currency: 'currency',
  money: 'currency',
  percent: 'percent',
  percentage: 'percent',
};

const TEXTUAL_BASE_TYPES = new Set(['text', 'textarea', 'string', 'longtext', '']);

/**
 * Field `widget` hints whose READ face is a cell of its own (objectui#12613),
 * registered under the widget's own key below. The spec's `widget` names the
 * component a field is drawn with in place of its `type` default; for these two
 * the stored text is a machine reference — an object name, a recipient id —
 * and a host face registered under the key names what it references, as the
 * edit widget's readonly branch does, instead of printing the api name.
 *
 * Only a widget listed here promotes, and only over a textual base type, the
 * same bound the `format` hints keep: a widget with no read face of its own
 * (`filter-condition`, `position-ref`, …) still draws as its `type`.
 */
const WIDGET_CELL_RENDERER_TYPES: ReadonlySet<string> = new Set(['object-ref', 'recipient-picker']);

/**
 * Resolve the canonical cell-renderer key for a field. Accepts either a
 * raw type string (back-compat) or a field-metadata object so that
 * format hints (`format: 'phone'` etc.) can promote a plain `text`
 * field to its richer renderer counterpart, and a declared `widget` with
 * a read cell of its own (`WIDGET_CELL_RENDERER_TYPES`) to that cell.
 */
export function resolveCellRendererType(fieldOrType: string | { type?: string; format?: string; widget?: string } | null | undefined): string {
  if (!fieldOrType) return 'text';
  if (typeof fieldOrType === 'string') return fieldOrType;
  const baseType = (fieldOrType.type || '').toLowerCase();
  const widget = fieldOrType.widget;
  if (typeof widget === 'string' && WIDGET_CELL_RENDERER_TYPES.has(widget) && TEXTUAL_BASE_TYPES.has(baseType)) {
    return widget;
  }
  const formatRaw = fieldOrType.format;
  const format = typeof formatRaw === 'string' ? formatRaw.toLowerCase() : '';
  if (format && FORMAT_TO_RENDERER[format] && TEXTUAL_BASE_TYPES.has(baseType)) {
    return FORMAT_TO_RENDERER[format];
  }
  return fieldOrType.type || 'text';
}

/**
 * The compact JSON text of a value: objects and arrays are stringified,
 * primitives fall through to their string form. A structure `JSON.stringify`
 * cannot represent (a cycle) keeps its `String` form rather than throwing out
 * of a render.
 *
 * ONE spelling, two readers: {@link JsonCellRenderer} draws a whole value with
 * it, and the `composite` / `record` face below draws the nested values it
 * still shows as JSON with it, so one stored value cannot read two ways.
 */
function compactJsonText(value: unknown): string {
  if (typeof value !== 'object') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Renders a free-form JSON value (`json`, `object`) as compact, readable JSON,
 * and is the fallback face for a shape a structured renderer cannot recognize
 * (`location` / `geolocation`, `address`, `composite` / `record`).
 */
export function JsonCellRenderer({ value }: CellRendererProps): React.ReactElement {
  // THE FLOOR WITH ONE MEMBER DECLINED, and the declension is the point
  // (objectui#8496). `[]` is a floor member everywhere else in this file; here
  // it is a VALUE and draws the two-character literal, because a `json` cell
  // states the structure the record holds and "an empty array" is a structure.
  // objectui#8474 measured that and pinned it. ⛔ Do not simplify this to
  // `isEmptyValue(value)`: that flattens a decision already on the record.
  if (isEmptyValue(value) && !Array.isArray(value)) return <EmptyValue />;
  const text = compactJsonText(value);
  // The original site of the block-level+max-w-full+title pattern
  // (objectui#2578) — now shared with every single-line value renderer via
  // TruncatedText (objectui#3466).
  return <TruncatedText text={text} className="font-mono text-xs text-gray-600" />;
}

/**
 * The `number` field a sub-value is formatted as: no `scale` is declared, so a
 * sub-value keeps its natural precision and the default grouping, exactly what
 * `NumberCellRenderer` draws for a `number` field that declares none.
 */
const UNDECLARED_NUMBER_SUB_FIELD: FieldMetadata = { name: '', type: 'number' };

/** One drawn sub-value: the node the line shows, and its text for the `title`. */
interface SubValueFace {
  node: React.ReactNode;
  text: string;
}

/** One labelled sub-value: a key and its face. */
interface StructuredPair {
  key: string;
  label: string;
  face: SubValueFace;
}

/** One entry of the face: a pair, or (a `record` entry) a labelled group of pairs. */
type StructuredEntry = StructuredPair | { key: string; label: string; group: StructuredPair[] };

const STRUCTURED_SEPARATOR = ' · ';

/** The plain text of a list of entries — the line as the `title` spells it. */
function structuredEntriesText(entries: readonly StructuredEntry[]): string {
  return entries
    .map((entry) =>
      'group' in entry
        ? `${entry.label} (${structuredEntriesText(entry.group)})`
        : `${entry.label} ${entry.face.text}`,
    )
    .join(STRUCTURED_SEPARATOR);
}

/**
 * The `dt` / `dd` pairs of a list of entries. The separator and the brackets
 * are `aria-hidden` (the `<dl>` already says where a pair starts) and sit
 * INSIDE a `dt` / `dd`, because a `<dl>` may hold nothing else.
 */
function structuredEntriesNodes(entries: readonly StructuredEntry[]): React.ReactNode {
  return entries.map((entry, index) => (
    <div key={entry.key} className="inline">
      <dt className={cn('inline', 'group' in entry ? 'font-medium' : 'text-muted-foreground')}>
        {index > 0 && (
          <span aria-hidden="true" className="font-normal text-muted-foreground">
            {STRUCTURED_SEPARATOR}
          </span>
        )}
        {entry.label}
      </dt>{' '}
      <dd className="inline">
        {'group' in entry ? (
          <>
            <span aria-hidden="true" className="text-muted-foreground">(</span>
            <dl className="inline">{structuredEntriesNodes(entry.group)}</dl>
            <span aria-hidden="true" className="text-muted-foreground">)</span>
          </>
        ) : (
          entry.face.node
        )}
      </dd>
    </div>
  ));
}

/**
 * `composite` / `record` cell renderers: an embedded value read as labelled
 * sub-values, not as its stored JSON (objectui#11697).
 *
 * `@objectstack/spec` declares `composite` as one embedded sub-object and
 * `record` as a name-keyed map of embedded sub-objects whose insertion order is
 * the display order. Both were registered to {@link JsonCellRenderer}, so the
 * record page, which reaches every value through this table (the one the grid
 * reads too), drew `{"width":10,"height":20}` in a monospace face. `address`
 * made the same move in objectui#4037.
 *
 * ## The face
 *
 *  - `composite`: one labelled pair per key, `Width 10 · Height 20`.
 *  - `record`: one labelled group per entry name holding that entry's pairs,
 *    `Primary (Name A · Score 9) · Backup (Name B · Score 7)`. An entry that
 *    is not a populated sub-object is drawn as a pair, as a composite key is.
 *  - A scalar sub-value is drawn with this package's face for its JS type: a
 *    number through `formatNumberFieldValue` (the call `NumberCellRenderer`
 *    makes, here with no declared `scale`), a boolean as the locale's word
 *    (`useBooleanValueLabel`, the boolean-as-text face of the read-only
 *    surfaces), a string as itself, and a floor member as {@link EmptyValue}.
 *    ⛔ Not the cell components themselves: the text cell and the boolean
 *    checkbox are block-level, and this face is one line.
 *  - A nested object or array stays compact JSON ({@link compactJsonText}).
 *
 * It is ONE truncated line in every host, as {@link TruncatedText} is, because
 * the grid cell, the record page row and the summary chip all draw it; the
 * full text is the `title` on the value element. The structure is a `<dl>`, so
 * assistive technology reads term / definition pairs.
 *
 * ## Labels
 *
 * The humanized key (`humanizeLabel`, the key fallback this package's boolean
 * cell already uses for its checkbox's accessible name). There is no declared sub-field label
 * to prefer: the spec's `FieldSchema` has no sub-field member for either type
 * and refuses `fields` / `subFields` as unrecognized keys, so no metadata a
 * producer can publish carries one, and a label read from the field here would
 * be a key the contract refuses (AGENTS.md #0.1).
 *
 * ## Unchanged
 *
 * The floor, and every shape this face does not recognize, answer exactly as
 * {@link JsonCellRenderer} answers: `null` / `undefined` / `''` draw
 * {@link EmptyValue}; `[]` and `{}` keep their literal (objectui#8474, and
 * objectui#8481's json-literal fence); a value that is not an object, a JSON
 * string included, is drawn as it is and never parsed (AGENTS.md #0.1).
 *
 * ⛔ Not exported, for the reason {@link RepeaterCellRenderer} gives: the table
 * entries are reachable the way every call site reaches them,
 * `getCellRenderer('composite')` / `getCellRenderer('record')`.
 */
function StructuredValueCell({
  value,
  field,
  groupEntries,
}: CellRendererProps & { groupEntries: boolean }): React.ReactElement {
  // Hooks before the early returns, so the hook count does not change with the
  // value (the rule `NumberCellRenderer` states).
  const locale = useDisplayLocale();
  const booleanLabel = useBooleanValueLabel();
  if (isEmptyValue(value) && !Array.isArray(value)) return <EmptyValue />;
  if (!isPlainObjectValue(value) || Object.keys(value).length === 0) {
    return <JsonCellRenderer value={value} field={field} />;
  }

  const faceOf = (sub: unknown): SubValueFace => {
    if (isEmptyValue(sub) && !Array.isArray(sub)) {
      return { node: <EmptyValue />, text: '—' };
    }
    if (typeof sub === 'boolean') {
      const word = booleanLabel(sub);
      return { node: word, text: word };
    }
    if (typeof sub === 'number' && Number.isFinite(sub)) {
      const formatted = formatNumberFieldValue(sub, UNDECLARED_NUMBER_SUB_FIELD, locale);
      return { node: <span className="tabular-nums">{formatted}</span>, text: formatted };
    }
    if (Array.isArray(sub) || isPlainObjectValue(sub)) {
      const json = compactJsonText(sub);
      return { node: <span className="font-mono">{json}</span>, text: json };
    }
    const text = String(coerceToSafeValue(sub));
    return { node: text, text };
  };
  const pairsOf = (object: Record<string, unknown>): StructuredPair[] =>
    Object.entries(object).map(([key, sub]) => ({ key, label: humanizeLabel(key), face: faceOf(sub) }));

  const entries: StructuredEntry[] = Object.entries(value).map(([key, sub]) =>
    groupEntries && isPlainObjectValue(sub) && Object.keys(sub).length > 0
      ? { key, label: humanizeLabel(key), group: pairsOf(sub) }
      : { key, label: humanizeLabel(key), face: faceOf(sub) },
  );

  return (
    <dl className="block max-w-full truncate" title={structuredEntriesText(entries)}>
      {structuredEntriesNodes(entries)}
    </dl>
  );
}

/** `composite`: one embedded sub-object, drawn as labelled pairs. See {@link StructuredValueCell}. */
function CompositeCellRenderer(props: CellRendererProps): React.ReactElement {
  return <StructuredValueCell {...props} groupEntries={false} />;
}

/** `record`: a name-keyed map of sub-objects, one labelled group per entry. See {@link StructuredValueCell}. */
function RecordMapCellRenderer(props: CellRendererProps): React.ReactElement {
  return <StructuredValueCell {...props} groupEntries />;
}

/**
 * Renders a `color` value as a swatch alongside its hex/string value.
 */
export function ColorSwatchCellRenderer({ value }: CellRendererProps): React.ReactElement {
  // THE FLOOR by name and nothing more (objectui#8496). `''` and `[]` reached
  // the same affordance one branch down (`String([])` is `''`, which the blank
  // test below caught); asking the floor here says so once, at the door.
  if (isEmptyValue(value)) return <EmptyValue />;
  // An object is not a colour (objectui#8596). `String({})` is
  // `'[object Object]'`, which this renderer handed to `background-color` —
  // an invalid declaration the browser drops, so the swatch drew a bordered
  // box with no colour beside that literal. `color` is a `STRING_VALUE_TYPES`
  // member, so a non-string prints the string class's coerced text (as `text`
  // prints it) and gets no swatch: a swatch is a claim about a colour.
  if (isPlainObjectValue(value)) {
    const coerced = coerceToSafeValue(value);
    if (isBlankCellText(coerced)) return <EmptyValue />;
    return <TruncatedText text={String(coerced)} />;
  }
  const color = String(value);
  // `String([])` is `''`, which used to draw a bordered swatch box with no
  // background colour beside an empty text span (objectui#8490): a swatch
  // with no colour is not a colour.
  if (isBlankCellText(color)) return <EmptyValue />;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span
        className="h-3.5 w-3.5 rounded border border-black/10 shrink-0"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      <span className="font-mono text-xs">{color}</span>
    </span>
  );
}

/**
 * The rich-content display pipelines — `markdown` through the GFM renderer,
 * `html`/`richtext` through the sanitizing HTML renderer — live in
 * `./widgets/richTextDisplay.js` rather than here, so `RichTextField` can
 * import them without importing this barrel back (`4bb940b6e`). Re-exported
 * unchanged: they are part of this package's published surface, and
 * `RICH_TEXT_CELL_RENDERERS` below is the one table both the cell resolver and
 * the widget's readonly branch read.
 */
export { MarkdownCellRenderer, HtmlCellRenderer } from './widgets/richTextDisplay.js';
// The KEY SET of that same table, published for the form-side consumers that
// used to hand-write it (objectui#8438). See its docblock for why a runtime
// list is needed next to the `RichTextFieldType` union.
export { RICH_TEXT_FIELD_TYPES, type RichTextFieldType } from './widgets/richTextDisplay.js';
import { RICH_TEXT_CELL_RENDERERS } from './widgets/richTextDisplay.js';

/**
 * Renders a `location`/`geolocation` value as readable coordinates with a pin.
 * Accepts `{ lat, lng }` / `{ latitude, longitude }`, a `"lat,lng"` string,
 * or a `[lat, lng]` array. Falls back to compact JSON for anything else.
 */
export function LocationCellRenderer({ value }: CellRendererProps): React.ReactElement {
  // THE FLOOR WITH `[]` DECLINED (objectui#8496), inherited rather than chosen:
  // an unrecognized shape falls through to `JsonCellRenderer` below, whose
  // pinned answer for `[]` is the array literal (objectui#8474). Declining the
  // member here keeps the two ends of that fallback saying one thing.
  if (isEmptyValue(value) && !Array.isArray(value)) return <EmptyValue />;
  let lat: number | undefined;
  let lng: number | undefined;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, any>;
    lat = typeof v.lat === 'number' ? v.lat : typeof v.latitude === 'number' ? v.latitude : undefined;
    lng = typeof v.lng === 'number' ? v.lng : typeof v.lon === 'number' ? v.lon : typeof v.longitude === 'number' ? v.longitude : undefined;
  } else if (Array.isArray(value) && value.length === 2) {
    lat = Number(value[0]);
    lng = Number(value[1]);
  } else if (typeof value === 'string') {
    const parts = value.split(',').map((s) => parseFloat(s.trim()));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      [lat, lng] = parts;
    }
  }
  if (typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng)) {
    return (
      <span className="inline-flex items-center gap-1 text-sm tabular-nums">
        <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        {lat.toFixed(4)}, {lng.toFixed(4)}
      </span>
    );
  }
  return <JsonCellRenderer value={value} field={{} as any} />;
}

/**
 * Renders an `address` value as a formatted single-line postal address instead
 * of stringified JSON (objectui#4037).
 *
 * The detail page's display registry mapped `address` to {@link JsonCellRenderer},
 * so a populated address read as `{"street":"中策路 1 号","city":"杭州",…}` on the
 * detail page and in its inline-edit read state — while the very same value
 * rendered correctly in the create/edit dialog, whose input registry has always
 * carried `address`. Read side only: nothing about the input widget changes.
 *
 * Layout is not invented here. It is {@link formatAddress} — the rule
 * `AddressField`'s own readonly branch already applied, over the sub-field set
 * its inputs expose — so a readonly form and a detail page cannot spell one
 * stored address two ways.
 *
 * Anything `formatAddress` cannot recognize falls back to compact JSON rather
 * than rendering blank: an unknown shape stays visible (today's behaviour) and
 * is never silently swallowed by the fix.
 */
export function AddressCellRenderer({ value }: CellRendererProps): React.ReactElement {
  // Part order follows the reader's display locale (objectui#4028). This is
  // the SAME `formatAddress` the input widget's readonly branch calls, and
  // that shared definition is the whole point of objectui#4037 — so passing
  // the locale on only one of the two callers would re-open exactly the drift
  // that change closed: one stored address, largest-first in a readonly form
  // and US-ordered in the grid cell next to it. Measured on this branch, not
  // assumed: `formatAddress` has these two callers and no others.
  //
  // `useDisplayLocale()` is the same resolver every other locale-aware cell
  // renderer in this file already uses, and it is provider-safe (it resolves
  // to `'en'` — the unchanged small-to-large order — with nothing mounted).
  const locale = useDisplayLocale();
  // THE FLOOR WITH `[]` DECLINED (objectui#8496), for the same inherited reason
  // as `LocationCellRenderer`: this renderer's own docblock promises that an
  // unknown shape stays visible through the JSON fallback rather than being
  // swallowed, and `[]` is an unknown shape here.
  if (isEmptyValue(value) && !Array.isArray(value)) return <EmptyValue />;
  // A plain string address (some apps store one) is already display-ready.
  if (typeof value === 'string') return <TruncatedText text={value} className="text-sm" />;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const formatted = formatAddress(value as AddressValue, locale);
    if (formatted) return <TruncatedText text={formatted} className="text-sm" />;
    // An object carrying no recognized part: `{}` reads as empty, while
    // `{ foo: 1 }` keeps its JSON so real data is never hidden.
    if (Object.keys(value as Record<string, unknown>).length === 0) return <EmptyValue />;
  }
  return <JsonCellRenderer value={value} field={{} as any} />;
}

/**
 * `repeater` cell renderer — how many sub-records the row holds.
 *
 * Routed through `useFieldTranslate` (objectui#8441). It used to be an inline
 * arrow inside {@link getCellRenderer}'s table spelling the count as the
 * number followed by a hardcoded Chinese unit word (the literal is quoted in
 * objectui#8441; it is not reproduced here because AGENTS.md #-1 governs code
 * comments too) — user-facing text hardcoded into a standard renderer, which breaks AGENTS.md #-1 AND bypasses i18n: every reader on every
 * locale read it, English ones included, next to the English siblings
 * (`[Vector]`, `[Grid]`, `FileCellRenderer`) on the same detail page. Making it
 * English would have answered only the first of those two.
 *
 * ⭐ A NAMED module-level component, not the inline arrow it replaces.
 * `getCellRenderer` rebuilds its `standardMap` — and therefore every arrow
 * literal in it — on EVERY call, and the call sites resolve inside render
 * (`DetailSection`, `renderFieldValue`). An inline entry is thus a new
 * component TYPE each render, so React unmounts and remounts the cell every
 * time and any hook state goes with it — here react-i18next's language
 * subscription, torn down and rebuilt per render. Every other hook-using entry
 * in that table (`DateCellRenderer`, `DateTimeCellRenderer`,
 * `ImageCellRenderer`, `FormulaCellRenderer`) is a stable module-level
 * reference for the same reason.
 *
 * ⛔ Deliberately NOT exported: the published surface of `@object-ui/fields`
 * stays exactly where it was. The table entry is reachable for tests the way
 * every call site reaches it — `getCellRenderer('repeater')`.
 */
function RepeaterCellRenderer({ value }: CellRendererProps): React.ReactElement {
  const t = useFieldTranslate();
  const n = Array.isArray(value) ? value.length : 0;
  if (n === 0) return <EmptyValue />;
  // The key is written as a LITERAL for the reason `UnresolvedUserReference`
  // states above: `check:i18n-keys` judges a literal key against the `en` pack
  // and checks that the arguments here are exactly the holes that value has,
  // and it downgrades a key read from a constant to report-only.
  const translated = t?.('detail.repeaterItemCount', { count: n });
  // Same provider-less rule `useFieldLabel` documents: i18next echoes the key
  // when nothing resolves it, and the English fallback applies then. That
  // fallback is held byte-equal to the `en` pack's `_one`/`_other` values by a
  // pin, since this shape is invisible to the inline-`defaultValue` half of
  // `check:i18n-keys`.
  const label =
    !translated || translated === 'detail.repeaterItemCount'
      ? `${n} ${n === 1 ? 'item' : 'items'}`
      : translated;
  return <span className="text-gray-500 italic">{label}</span>;
}

/**
 * `password` / `secret` cell renderer: the mask for a credential that is SET,
 * and the shared affordance for one that is NOT (objectui#8678).
 *
 * The entry this replaces was an argument-less arrow that drew the mask for
 * every input, `null` included. On screen, a credential that was never set was
 * then drawn exactly like one that is set. The platform's read contract is
 * presence-preserving on purpose: `@objectstack/spec`'s `SECRET_MASK` docblock
 * says an unset credential "reads back `null` instead, never this mask", which
 * is what lets a console render "configured" vs "not configured" at all. This
 * cell threw that distinction away one step before the reader saw it.
 *
 * ⛔ The value is NEVER printed and never reaches the DOM. Only its presence is
 * read. A populated value keeps the exact mask it drew before this card, and
 * nothing here is a weaker mask.
 *
 * "Empty" is the string class's answer, since both types are
 * `STRING_VALUE_TYPES` members in the spec: `TextCellRenderer`'s predicate
 * exactly, the floor on the coerced text. `{}` therefore stays a VALUE and
 * keeps the mask, per objectui#8596's string-class ruling ("the record IS
 * storing something"). A whitespace-only string also keeps it, because `text`
 * keeps its spaces and a blank credential is still a set one.
 * `cellRenderers.valueIndependent-8678` pins this byte-equal to `text` for
 * every empty input.
 *
 * ⭐ A NAMED module-level component, for the reason {@link RepeaterCellRenderer}
 * states: `EmptyValue` holds a hook, and an inline arrow in the table below
 * is a new component type on every resolution, so it would tear that hook down
 * per render.
 *
 * Exported (objectui#10657) for the cell a producer cannot type yet. While an
 * object-bound table is still waiting for its object's field types, or after
 * that read failed, a column with no type of its own could be a credential,
 * so `ObjectGrid`, `RelatedList` and `ObjectDataTable` draw it WITHHELD: as
 * this mask, never as text. It is this component and not the live registry
 * entry for `password`, so a host override of a masked type cannot change what
 * a withheld cell draws. Registering it for a type
 * (`registerFieldRenderer('api_token', MaskedCellRenderer)`) masks that type,
 * as {@link isMaskedFieldType} describes. `field` is optional: the mask reads
 * only whether the value is present, so a withheld cell has no field metadata
 * to invent.
 */
export function MaskedCellRenderer({
  value,
}: Omit<CellRendererProps, 'field'> & { field?: CellRendererProps['field'] }): React.ReactElement {
  if (isEmptyValue(coerceToSafeValue(value))) return <EmptyValue />;
  return <span>••••••</span>;
}

/**
 * The field types this package DECLARES masked: their standard cell is
 * {@link MaskedCellRenderer}, which draws `••••••` in place of the value
 * (objectui#8686). The read-side twin of the credential entry in
 * `INLINE_EXCLUDED_FIELD_TYPES`, which lives in `FieldEditWidget`.
 *
 * ⭐ This set BUILDS the table's masked entries — `buildStandardCellRendererMap`
 * spreads one {@link MaskedCellRenderer} entry per member — so adding a type
 * here masks its cell AND makes {@link isMaskedFieldType} answer `true` for it,
 * in one edit. There is no second list to keep in step.
 *
 * ⚠️ Membership answers "what ships masked", ⛔ not "what is masked right now":
 * `registerFieldRenderer` can add or replace a masked type at runtime, and a
 * set cannot see that. Consumers deciding what to do with a cell's value ask
 * {@link isMaskedFieldType}.
 *
 * RAW spellings, deliberately: the cell path does not resolve form aliases
 * (`getCellRenderer` is an exact-key lookup), so `field:password` renders in
 * the clear and is not a member.
 *
 * Owned here for now. The objectui#8686 ruling made the protocol the first
 * place to look: if `@objectstack/spec` comes to declare which field types are
 * credentials, this set derives from that declaration instead of listing types.
 */
export const MASKED_FIELD_TYPES: ReadonlySet<string> = new Set<string>(['password', 'secret']);

/**
 * Is a cell of this field type drawn as a mask instead of as its value? The
 * one authority for that question (objectui#8686): ask it rather than keep a
 * list of types. The read-side twin of `isInlineExcludedFieldType()`.
 *
 * A LIVE reading of the cell registry, taken at call time, in the order
 * {@link getCellRenderer} resolves: the runtime registry first, then the
 * standard table.
 *
 *  1. The type resolves to THE mask ({@link MaskedCellRenderer}) → `true`,
 *     declared or not. That is how a host adds a masked type:
 *     `registerFieldRenderer('api_token', getCellRenderer('password'))`.
 *  2. Otherwise, a type outside {@link MASKED_FIELD_TYPES} → `false`.
 *  3. A declared type whose mask a host REPLACED at runtime
 *     (`registerFieldRenderer('password', X)`) → the override is read:
 *     - X is one of this package's own cell renderers → `false`. None of them
 *       is the mask, so the predicate answers `false` and the cell draws what
 *       X draws (for `TextCellRenderer`, the value).
 *     - X is the host's own component → `true`, the declared answer. Nothing
 *       here can tell whether an opaque component masks. Answering `false`
 *       would offer a credential to anything that trusts this predicate
 *       (the detail page's copy affordance, objectui#8440) while a custom mask
 *       hides it on screen. So an unreadable override falls back to the
 *       declared set, on the side that withholds.
 *
 * RAW spelling, no alias resolution, for the reason {@link MASKED_FIELD_TYPES}
 * states. Side-effect free, like `isInlineExcludedFieldType()`: unlike
 * {@link getCellRenderer}, it never reports a retired spelling.
 */
export function isMaskedFieldType(fieldType: string | undefined): boolean {
  if (!fieldType) return false;
  const standardMap = buildStandardCellRendererMap();
  const live = fieldRegistry.has(fieldType) ? fieldRegistry.get(fieldType) : standardMap[fieldType];
  if (live === MaskedCellRenderer) return true;
  if (!MASKED_FIELD_TYPES.has(fieldType)) return false;
  return !Object.values(standardMap).some((standard) => standard === live);
}

/**
 * `vector` / `grid` cell renderers: the placeholder literal for a value that is
 * stored, and the shared affordance for none (objectui#8678). Before this, both
 * were argument-less arrows that printed their literal for every input. Neither
 * type has a masking rationale, so a constant face was just an assertion that
 * the record held something.
 *
 * "Empty" is the floor exactly (`isEmptyValue`: `null`, `undefined`, `''`,
 * `[]`), read from each type's value class:
 *  - `vector` is `z.array(z.number())` in the spec's `valueSchemaFor`, so `[]`
 *    is its own empty member: an embedding with no dimensions.
 *  - `grid` is not a spec `FieldType`, so the spec gives it no class. Its class
 *    is this package's own `GridField` contract, an array of row objects. `[]`
 *    is zero rows.
 *
 * ⛔ Deliberately NOT extended to `{}`. Neither class can produce it (the spec's
 * write seam refuses a non-array `vector`, and `GridField` writes arrays). And
 * `@object-ui/plugin-detail`'s `hasCellValue` calls every object a value, so a
 * `{}` clause here would draw "No value" inside a row that band has already
 * called filled. A clause for a value the contract cannot produce would also be
 * the renderer-side tolerance AGENTS.md #0.1 refuses.
 *
 * The populated face is byte-for-byte what it was. Whether a stored vector or
 * grid deserves a face richer than a literal is a separate question.
 */
function VectorCellRenderer({ value }: CellRendererProps): React.ReactElement {
  if (isEmptyValue(value)) return <EmptyValue />;
  return <span className="text-gray-500 italic">[Vector]</span>;
}

/** See {@link VectorCellRenderer}: the same rule, with `grid`'s literal. */
function GridCellRenderer({ value }: CellRendererProps): React.ReactElement {
  if (isEmptyValue(value)) return <EmptyValue />;
  return <span className="text-gray-500 italic">[Grid]</span>;
}

/**
 * THE standard cell-renderer table, built fresh on every call.
 *
 * ⭐ A FUNCTION returning a new object, ⛔ not a module-level constant. Until
 * objectui#8678 that difference was observable: four entries were INLINE arrows
 * (`password`, `secret`, `vector`, `grid`), and hoisting this object would have
 * frozen their identity. They became the named renderers above when they began
 * drawing `EmptyValue`. No entry is an inline arrow now, and
 * `cellRenderers.valueIndependent-8678` pins every registered type as ONE
 * function object across two resolutions, so a new inline entry goes red by
 * name. `getCellRenderer` still rebuilds the table per call, and
 * {@link listCellRendererTypes} reads the SAME builder rather than a second
 * copy of the key list, so the two cannot drift.
 */
function buildStandardCellRendererMap(): Record<string, React.FC<CellRendererProps>> {
  return {
    text: TextCellRenderer,
    textarea: TextCellRenderer,
    // `markdown` / `html` / `richtext` — spread from THE table rather than
    // written out here, so this resolver and `RichTextField`'s readonly branch
    // cannot drift apart on which pipeline a rich-content type reads through
    // (`4bb940b6e`). `richtext` maps to the HTML renderer, NOT the markdown
    // one, which drops raw HTML and therefore rendered every populated richtext
    // value as a blank cell (objectui#5452).
    ...RICH_TEXT_CELL_RENDERERS,
    code: TextCellRenderer,
    qrcode: TextCellRenderer,
    number: NumberCellRenderer,
    currency: CurrencyCellRenderer,
    percent: PercentCellRenderer,
    progress: PercentCellRenderer,
    slider: NumberCellRenderer,
    rating: RatingCellRenderer,
    boolean: BooleanCellRenderer,
    toggle: BooleanCellRenderer,
    date: DateCellRenderer,
    datetime: DateTimeCellRenderer,
    time: TextCellRenderer,
    select: SelectCellRenderer,
    status: SelectCellRenderer,
    multiselect: SelectCellRenderer,
    radio: SelectCellRenderer,
    checkboxes: SelectCellRenderer,
    tags: SelectCellRenderer,
    lookup: LookupCellRenderer,
    master_detail: LookupCellRenderer,
    tree: LookupCellRenderer,
    email: EmailCellRenderer,
    url: UrlCellRenderer,
    phone: PhoneCellRenderer,
    file: FileCellRenderer,
    video: FileCellRenderer,
    audio: FileCellRenderer,
    image: ImageCellRenderer,
    avatar: ImageCellRenderer,
    // A `STRING_VALUE_TYPES` member, not a media type (objectui#8677): the
    // image when there is one, otherwise the string class's answer.
    signature: SignatureCellRenderer,
    formula: FormulaCellRenderer,
    summary: FormulaCellRenderer,
    auto_number: TextCellRenderer,
    user: UserCellRenderer,
    // `password` / `secret` — spread from THE declared set, so the table that
    // draws the mask and the set `isMaskedFieldType` falls back to are one
    // fact (objectui#8686).
    ...Object.fromEntries([...MASKED_FIELD_TYPES].map((type) => [type, MaskedCellRenderer])),
    location: LocationCellRenderer,
    geolocation: LocationCellRenderer,
    address: AddressCellRenderer,
    color: ColorSwatchCellRenderer,
    json: JsonCellRenderer,
    object: JsonCellRenderer,
    // Labelled sub-values, not the stored JSON (objectui#11697).
    composite: CompositeCellRenderer,
    record: RecordMapCellRenderer,
    repeater: RepeaterCellRenderer,
    vector: VectorCellRenderer,
    grid: GridCellRenderer,
  };
}

/**
 * Every field type that resolves to a cell renderer OF ITS OWN — a LIVE
 * reading of the registry, taken when you call it (objectui#8734).
 *
 * ## Why this exists
 *
 * Two censuses — `cellRenderers.objectLiteral-8596` in this package and
 * `summaryChip.badgeFitCensus-8464` in `@object-ui/plugin-detail` — declare in
 * prose that they measure "every type `getCellRenderer` resolves to a renderer
 * of its own", and each enforced that declaration with a hard-coded population
 * size. A newly registered type is absent from such a table, so every row in it
 * still passes: the census goes on measuring a snapshot while claiming to
 * measure the registry. This function is what those censuses reconcile against,
 * so a new type turns a silent pass into a red row that NAMES the type.
 *
 * ## ⭐ A function, ⛔ not a frozen constant
 *
 * `FORM_FIELD_TYPES` next door may be `Object.freeze(Object.keys(...))` because
 * `fieldWidgetMap` is a module literal that never changes. This registry DOES
 * change: {@link registerFieldRenderer} is published, and a host may add or
 * override a type after this module is evaluated. A frozen constant here would
 * be a snapshot taken at import time — the very defect the censuses are being
 * repaired for, one level down. Every call re-reads.
 *
 * The answer is the UNION of the runtime registry and the standard table,
 * because {@link getCellRenderer} dispatches on both; it is sorted so callers
 * get a stable order, and `TextCellRenderer` is the TOTAL fallback for
 * everything else, which is exactly why "everything else" is not listed here.
 */
export function listCellRendererTypes(): readonly string[] {
  return [...new Set([...fieldRegistry.keys(), ...Object.keys(buildStandardCellRendererMap())])].sort();
}

/**
 * Get the appropriate cell renderer for a field type
 */
export function getCellRenderer(fieldType: string): React.FC<CellRendererProps> {
  // 1. Try exact match in registry
  if (fieldRegistry.has(fieldType)) {
    return fieldRegistry.get(fieldType)!;
  }

  // 1b. A RETIRED spelling reaching the read path says a stored column is still
  //     typed with a name this renderer no longer honours. There is no visible
  //     alert a table CELL can carry without wrecking the row, so the console
  //     prescription is the loud half here (once per spelling —
  //     `reportRetiredFieldType`), and the cell degrades to text deliberately
  //     rather than by omission (objectui#4814).
  reportRetiredFieldType(fieldType);

  // 2. Fallback to standard mappings if not overridden
  const standardMap = buildStandardCellRendererMap();

  // 3. Register standard renderers implicitly if not present
  // This ensures that if we call registerFieldRenderer('text', Custom), it works,
  // but if we don't, we get the standard one.
  return standardMap[fieldType] || TextCellRenderer;
}

// Register standard renderers immediately
registerFieldRenderer('lookup', LookupCellRenderer);
registerFieldRenderer('master_detail', LookupCellRenderer);
registerFieldRenderer('select', SelectCellRenderer);
registerFieldRenderer('status', SelectCellRenderer);
registerFieldRenderer('user', UserCellRenderer);
// The pointer pair's default face (objectui#12045): the record id as text. A
// host that can read records registers its own face under the same key.
registerFieldRenderer(RECORD_POINTER_CARD_TYPE, RecordPointerTextCellRenderer);
// The two widget-hinted reference keys `resolveCellRendererType` promotes to
// (objectui#12613), with the stored text as their DEFAULT face — the
// `RECORD_POINTER_CARD_TYPE` arrangement above: this package owns the rule and
// the keys, and a host that can read the referenced lists registers the faces
// that name them (`@object-ui/app-shell`'s widget reference cells). Not drawn
// here because every module of this package rides the console's eager
// `ui-components` chunk, whatever imports it lazily, and that chunk's ceiling
// in `scripts/check-eager-closure-budget.mjs` has no room for a label reader;
// the host loads its faces lazily, off the eager closure.
registerFieldRenderer('object-ref', TextCellRenderer);
registerFieldRenderer('recipient-picker', TextCellRenderer);
// `owner` was registered here to the same UserCellRenderer until objectui#4814
// retired the spelling — see the TOMBSTONE below. `getCellRenderer('owner')`
// now reports the prescription and falls to the text cell.

// Register getCellRenderer in the bridge so RecordPickerDialog can access it
// via LookupField without circular imports.
import { setCellRendererResolver } from './widgets/_cell-renderer-bridge.js';
setCellRendererResolver(getCellRenderer);

/**
 * The face `@object-ui/components`' field-face seam answers for a field
 * (objectui#13216): the read cell a declared `widget` promotes the field to
 * (`WIDGET_CELL_RENDERER_TYPES`), through the same
 * `getCellRenderer(resolveCellRendererType(field))` lookup the grid's cells
 * make, so `page:header` draws a widget-hinted `nameField` the way a list
 * column draws it. `undefined` when the field's key is not a widget's, and
 * while the key still draws its default face, the stored text
 * (`TextCellRenderer`): that is the text the heading already prints, so a host
 * that registers no face under the key keeps the heading it had.
 *
 * Not exported: the seam's reader, `resolveFieldReadFace` from
 * `@object-ui/components`, is the one way to ask, so this package's published
 * surface does not move.
 */
function resolveDeclaredFieldFace(field: FieldMetadata): React.FC<CellRendererProps> | undefined {
  const key = resolveCellRendererType(field);
  if (!WIDGET_CELL_RENDERER_TYPES.has(key)) return undefined;
  const face = getCellRenderer(key);
  return face === TextCellRenderer ? undefined : face;
}

// Fill the seam when this module loads: `@object-ui/components` cannot import
// this package (it depends on that one), so the slot is filled from here.
setFieldReadFaceResolver(resolveDeclaredFieldFace);



// `mapFieldTypeToFormType` moved to './field-type-alias' (re-exported below) so
// FieldEditWidget can resolve spec aliases without importing this barrel.
export { mapFieldTypeToFormType } from './field-type-alias.js';
import { mapFieldTypeToFormType } from './field-type-alias.js';
// `isRetiredFieldType` is the gate the maintainer ruled onto THIS package's
// surface (objectui#4914, ruling B) — "export a single `isRetiredFieldType(t)`
// gate from `@object-ui/fields` and place it ahead of each of the six live
// predicate faces". The implementation is homed in `@object-ui/core` because
// one of those six faces lives in `@object-ui/components`, which this package
// depends on; see `core/src/utils/retired-field-types.ts`. Every consumer that
// can reach `@object-ui/fields` reads it from here, and the two that cannot
// (`components`, and `plugin-view` which carries no `fields` dependency) read
// the same function object from `@object-ui/core`.
export {
  RETIRED_FIELD_TYPES,
  isRetiredFieldType,
  reportRetiredFieldType,
  resetRetiredFieldTypeReports,
} from './field-type-alias.js';
import { RETIRED_FIELD_TYPES, reportRetiredFieldType } from './field-type-alias.js';

/**
 * Formats file size in bytes to human-readable string
 * @param bytes - File size in bytes (must be non-negative)
 * @returns Formatted string (e.g., "5 MB", "1.5 GB")
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 0 || !Number.isFinite(bytes)) {
    return '0 B';
  }
  
  if (bytes === 0) {
    return '0 B';
  }
  
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`;
}

/**
 * Per-field-definition cache of the spec's derived value schema
 * (objectui#6744).
 *
 * `valueSchemaFor` states the requirement itself: "Pure derivation — no caching
 * here; runtime consumers MUST cache per field definition (building a
 * `z.object` per write is an order of magnitude costlier than parsing)." This
 * is the same `WeakMap`-on-the-field-def idiom the platform's own write-path
 * validator uses (`shapeSchemaFor`,
 * `packages/objectql/src/validation/record-validator.ts`), so the hit rate is
 * governed by the same condition there and here: whether the host hands the
 * same field object back.
 *
 * ⛔ The def is passed through VERBATIM, never rebuilt from keys picked out of
 * it. `valueSchemaFor` decides for itself what a location value is and how a
 * field's multiplicity participates; a reconstructed def would be a second
 * reading of the contract, free to drift from the first (AGENTS.md #0.1).
 */
const locationStoredValueSchemas = new WeakMap<object, ReturnType<typeof valueSchemaFor>>();

function locationStoredValueSchemaFor(field: any): ReturnType<typeof valueSchemaFor> {
  let schema = locationStoredValueSchemas.get(field);
  if (!schema) {
    schema = valueSchemaFor(field, 'stored');
    locationStoredValueSchemas.set(field, schema);
  }
  return schema;
}

/**
 * The STORED-value rule for a `type: 'location'` field (objectui#6744).
 *
 * ## What was missing
 *
 * `buildValidationRules` is the producer of the host-side `error` prop that
 * every field widget's published objectui#3222 slot reads, and it had no
 * `location` branch. So a coordinate that is ALREADY IN THE RECORD and violates
 * the spec's range was never validated on an edit form: the control rendered
 * it, nothing marked it invalid, and submitting re-wrote it unchanged.
 *
 * ⚠️ This is a different defect from objectui#6714/#6716, which are about a
 * refusal at INPUT time — the user types something the widget will not emit. A
 * refusal never becomes a form value, so this rule is handed `undefined` in
 * both of those arms; the two do not overlap and neither replaces the other.
 *
 * ## Why the whole value is handed to the spec, not a range test
 *
 * ⛔ The bounds are NOT restated here as `-90`/`90` literals — the same
 * discipline `LocationField`'s own `isSpecAcceptedLocation` follows, and for the
 * same reason: a hand-copied range is a SECOND contract that drifts from the
 * spec silently (AGENTS.md #0.1).
 *
 * Asking `valueSchemaFor(field, 'stored')` also makes this rule agree, by
 * construction, with the platform's own write path. The engine's record
 * validator checks a stored `location` against THIS schema (ADR-0104 D1,
 * `record-validator.ts`), warn-first until a deployment's `os migrate
 * value-shapes` scan certifies zero violations and rejecting afterwards. So a
 * value this rule marks invalid is a value the platform itself already refuses
 * or has recorded as an admitted violation — the form now surfaces that
 * verdict where the person who can correct it is standing, rather than
 * inventing a verdict of its own.
 *
 * ## Absence is `required`'s business, not this rule's
 *
 * The spec's schema describes a PRESENT value — it refuses `null` and
 * `undefined` outright, and its docblock says so ("null/undefined/required
 * handling stays with the caller"). Deciding presence HERE would be a second
 * definition of "empty" competing with the one `required` uses, so this asks
 * core's `isMissingForRequired` — the repo's single presence contract, the same
 * predicate the form renderer's own `required` validator calls. That is what
 * keeps a CREATE form with an untouched location field valid.
 *
 * ## The message is the spec's own complaint
 *
 * Built from the schema's issues, exactly as `LocationField`'s
 * `refusedRangeMessage` builds the widget-side sentence, so the day the schema
 * moves both sentences move with it and neither can quote a stale bound.
 */
function buildLocationStoredValueValidator(field: any): (value: unknown) => true | string {
  return (value: unknown) => {
    if (isMissingForRequired(value)) return true;
    const parsed = locationStoredValueSchemaFor(field).safeParse(value);
    if (parsed.success) return true;
    const detail = parsed.error.issues
      .map((issue: any) => `${issue.path.join('.') || 'value'}: ${issue.message}`)
      .join('; ');
    return `Invalid location: ${detail}`;
  };
}

/**
 * Build validation rules from field metadata
 * @param field - Field metadata from ObjectStack
 * @returns Validation rule object compatible with react-hook-form
 *
 * ⛔ No field-level `pattern` / `pattern_message` / `validate` (objectui#12242,
 * maintainer ruling A). `@objectstack/spec`'s `FieldSchema` refuses all three
 * by name, so no published object carries them, and the field metadata types
 * retire them as `never`. A regex check is the OBJECT's `format` validation
 * rule (`validations[]`), which the server runs on every write that touches
 * the field and refuses with the rule's message; this function adds no client
 * pre-check of it.
 */
export function buildValidationRules(field: any): any {
  const rules: any = {};

  // Required validation. Emit a bare `true` for the auto-generated case rather
  // than baking an English message here: the form renderer localizes it via
  // `t('validation.required', { field })`. A field-authored `required_message`
  // still wins and is passed through verbatim.
  if (field.required) {
    rules.required = typeof field.required_message === 'string'
      ? field.required_message
      : true;
  }

  // Standard validation messages are localized by the form renderer, which has
  // an i18n `t` in scope. We therefore emit `message: undefined` for the
  // auto-generated case and tag each rule with a `messageKey` (+ any interp
  // vars); a field-authored `*_message` is a string and passes through as-is,
  // still winning over the localized default. See form.tsx `localizeRule`.

  // Length validation for text fields. The keys are the spec's `minLength` /
  // `maxLength` (@objectstack/spec FieldSchema — what the server
  // record-validator enforces), and they are the only spelling read: the
  // snake_case pair this function also read until objectui#11070 is retired,
  // with no alias. The spec refuses it by name, and no objectui type declares
  // it any more.
  const minLength = field.minLength;
  if (minLength) {
    rules.minLength = {
      value: minLength,
      message: typeof field.min_length_message === 'string' ? field.min_length_message : undefined,
      messageKey: 'validation.minLength',
    };
  }

  const maxLength = field.maxLength;
  if (maxLength) {
    rules.maxLength = {
      value: maxLength,
      message: typeof field.max_length_message === 'string' ? field.max_length_message : undefined,
      messageKey: 'validation.maxLength',
    };
  }

  // Number range validation
  if (field.min !== undefined) {
    rules.min = {
      value: field.min,
      message: typeof field.min_message === 'string' ? field.min_message : undefined,
      messageKey: 'validation.min',
    };
  }

  if (field.max !== undefined) {
    rules.max = {
      value: field.max,
      message: typeof field.max_message === 'string' ? field.max_message : undefined,
      messageKey: 'validation.max',
    };
  }

  // Email validation
  if (field.type === 'email') {
    rules.pattern = {
      value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      message: undefined,
      messageKey: 'validation.email',
    };
  }

  // URL validation
  if (field.type === 'url') {
    rules.pattern = {
      value: /^https?:\/\/.+/,
      message: undefined,
      messageKey: 'validation.url',
    };
  }

  // Stored-value validation for `location` (objectui#6744). See
  // `buildLocationStoredValueValidator` for what this rule is and what it is
  // deliberately not.
  //
  // Emitted in react-hook-form's OBJECT form, the shape the form renderer
  // composes its own `required` entry into (`packages/components/src/renderers/form/form.tsx`),
  // so the two compose rather than clobber. RHF reports an object-form failure
  // under its key, so this surfaces as `type: 'location'`. (It also used to
  // keep a field-level `validate` running beside it; that key is retired,
  // objectui#12242.)
  if (field.type === 'location') {
    rules.validate = {
      location: buildLocationStoredValueValidator(field),
    };
  }

  return Object.keys(rules).length > 0 ? rules : undefined;
}

/**
 * Evaluate a conditional expression for field visibility
 * @param condition - Condition object from field metadata
 * @param formData - Current form values
 * @returns Whether the condition is met
 */
export function evaluateCondition(condition: any, formData: any): boolean {
  if (!condition) return true;

  // Simple field equality check
  if (condition.field && condition.value !== undefined) {
    const fieldValue = formData[condition.field];
    if (condition.operator === '=' || condition.operator === '==') {
      return fieldValue === condition.value;
    } else if (condition.operator === '!=') {
      return fieldValue !== condition.value;
    } else if (condition.operator === '>') {
      return fieldValue > condition.value;
    } else if (condition.operator === '>=') {
      return fieldValue >= condition.value;
    } else if (condition.operator === '<') {
      return fieldValue < condition.value;
    } else if (condition.operator === '<=') {
      return fieldValue <= condition.value;
    } else if (condition.operator === 'in') {
      return Array.isArray(condition.value) && condition.value.includes(fieldValue);
    }
  }

  // AND/OR logic
  if (condition.and && Array.isArray(condition.and)) {
    return condition.and.every((c: any) => evaluateCondition(c, formData));
  }

  if (condition.or && Array.isArray(condition.or)) {
    return condition.or.some((c: any) => evaluateCondition(c, formData));
  }

  // Default to true if condition format is unknown
  return true;
}

// TOMBSTONE (objectui#3910, ruling B of objectui#3798) — `createFieldRenderer()`
// lived here. It wrapped a field widget in synthesized label/description chrome
// plus a local `useState` + `onChange`, which let a BARE field node render
// standalone under `SchemaRenderer`. Only `registerFields()` (below, also
// removed) ever called it, and only the docs site called that — so the chrome
// existed nowhere a real application could reach, and the docs demos showed a
// rendering no app produces. The catalog's field examples are form-hosted now
// (`{ type: 'form', fields: [...] }`), where the real form renderer owns label
// and value state. Do not re-add a second, demo-only registration path: one
// registration seam is the whole point (objectui#3308).

/**
 * Field widget map for lazy loading
 * Maps field type to widget component
 */
type FieldWidgetLoader = () => Promise<{ default: React.ComponentType<any> }>;

// `satisfies` (not a `Record<string, …>` annotation) so the KEY SET survives as
// a literal union — that union is what makes `FIELD_WIDGET_LABELLING` below
// exhaustive BY CONSTRUCTION: adding a widget here without deciding its
// labelling is a compile error, not a silent fallback (objectui#4857).
const fieldWidgetMap = {
  // Basic fields
  'text': () => import('./widgets/TextField.js').then(m => ({ default: m.TextField })),
  'textarea': () => import('./widgets/TextAreaField.js').then(m => ({ default: m.TextAreaField })),
  'number': () => import('./widgets/NumberField.js').then(m => ({ default: m.NumberField })),
  'boolean': () => import('./widgets/BooleanField.js').then(m => ({ default: m.BooleanField })),
  'select': () => import('./widgets/SelectField.js').then(m => ({ default: m.SelectField })),
  // The platform date picker (objectui#12622, objectui#12642): a text box in
  // the display locale's format with a calendar popover, for every consumer of
  // this map — the record form (`registerField`) and the action-param and
  // bulk-action dialogs (`getLazyFieldWidget`) alike, so a field type has one
  // face. It writes what the native input wrote: `YYYY-MM-DD` for `date`, an
  // ISO instant for `datetime`. Its read-only face is `DateField` /
  // `DateTimeField`'s own.
  'date': () => import('./widgets/date-picker/DatePickerField.js').then(m => ({ default: m.DatePickerField })),
  'datetime': () => import('./widgets/date-picker/DatePickerField.js').then(m => ({ default: m.DateTimePickerField })),
  'time': () => import('./widgets/TimeField.js').then(m => ({ default: m.TimeField })),
  
  // Contact fields
  'email': () => import('./widgets/EmailField.js').then(m => ({ default: m.EmailField })),
  'phone': () => import('./widgets/PhoneField.js').then(m => ({ default: m.PhoneField })),
  'url': () => import('./widgets/UrlField.js').then(m => ({ default: m.UrlField })),
  
  // Selection fields (multi-value / option groups)
  'multiselect': () => import('./widgets/MultiSelectField.js').then(m => ({ default: m.MultiSelectField })),
  'radio': () => import('./widgets/RadioField.js').then(m => ({ default: m.RadioField })),
  'checkboxes': () => import('./widgets/CheckboxesField.js').then(m => ({ default: m.CheckboxesField })),
  'tags': () => import('./widgets/TagsField.js').then(m => ({ default: m.TagsField })),

  // Specialized fields
  'currency': () => import('./widgets/CurrencyField.js').then(m => ({ default: m.CurrencyField })),
  'percent': () => import('./widgets/PercentField.js').then(m => ({ default: m.PercentField })),
  'password': () => import('./widgets/PasswordField.js').then(m => ({ default: m.PasswordField })),
  'markdown': () => import('./widgets/RichTextField.js').then(m => ({ default: m.RichTextField })),
  'html': () => import('./widgets/RichTextField.js').then(m => ({ default: m.RichTextField })),
  'richtext': () => import('./widgets/RichTextField.js').then(m => ({ default: m.RichTextField })),
  'lookup': () => import('./widgets/LookupField.js').then(m => ({ default: m.LookupField })),
  // master_detail represents the child-side FK to its parent. In create/edit forms it
  // must render as a single-value lookup picker (it is typically NOT NULL). The legacy
  // MasterDetailField widget modelled this as a one-to-many list, which is incorrect
  // for the child-side and prevented users from filling the required parent reference.
  'master_detail': () => import('./widgets/LookupField.js').then(m => ({ default: m.LookupField })),
  
  // File fields
  'file': () => import('./widgets/FileField.js').then(m => ({ default: m.FileField })),
  'image': () => import('./widgets/ImageField.js').then(m => ({ default: m.ImageField })),
  
  // Location field
  'location': () => import('./widgets/LocationField.js').then(m => ({ default: m.LocationField })),
  
  // Computed/Read-only fields
  'formula': () => import('./widgets/FormulaField.js').then(m => ({ default: m.FormulaField })),
  'summary': () => import('./widgets/SummaryField.js').then(m => ({ default: m.SummaryField })),
  'auto_number': () => import('./widgets/AutoNumberField.js').then(m => ({ default: m.AutoNumberField })),
  
  // User fields. `owner` pointed at this same UserField until objectui#4814
  // retired it (see the TOMBSTONE near `registerAllFields`) — do not re-add it
  // here: membership in this map is what makes a name a renderable field type
  // (`FORM_FIELD_TYPES` is its key set).
  'user': () => import('./widgets/UserField.js').then(m => ({ default: m.UserField })),

  // Complex data types
  'object': () => import('./widgets/ObjectField.js').then(m => ({ default: m.ObjectField })),
  'vector': () => import('./widgets/VectorField.js').then(m => ({ default: m.VectorField })),
  'grid': () => import('./widgets/GridField.js').then(m => ({ default: m.GridField })),
  
  // Additional field types from @objectstack/spec
  'color': () => import('./widgets/ColorField.js').then(m => ({ default: m.ColorField })),
  'slider': () => import('./widgets/SliderField.js').then(m => ({ default: m.SliderField })),
  'rating': () => import('./widgets/RatingField.js').then(m => ({ default: m.RatingField })),
  'code': () => import('./widgets/CodeField.js').then(m => ({ default: m.CodeField })),
  'avatar': () => import('./widgets/AvatarField.js').then(m => ({ default: m.AvatarField })),
  'address': () => import('./widgets/AddressField.js').then(m => ({ default: m.AddressField })),
  'geolocation': () => import('./widgets/GeolocationField.js').then(m => ({ default: m.GeolocationField })),
  'signature': () => import('./widgets/SignatureField.js').then(m => ({ default: m.SignatureField })),
  'qrcode': () => import('./widgets/QRCodeField.js').then(m => ({ default: m.QRCodeField })),

  // Widget-hint-only pickers (reached via a field `widget:` override, never a
  // bare field `type`). They render a *picker* over machine data an admin would
  // otherwise have to type — used by sys_sharing_rule (ADR-0056 P2 pattern):
  //   object-ref       → choose a registered object by name
  //   filter-condition → visual criteria builder scoped to the chosen object
  //   recipient-picker → record picker whose target follows a sibling type
  'object-ref': () => import('./widgets/ObjectRefField.js').then(m => ({ default: m.ObjectRefField })),
  'filter-condition': () => import('./widgets/FilterConditionField.js').then(m => ({ default: m.FilterConditionField })),
  'recipient-picker': () => import('./widgets/RecipientPickerField.js').then(m => ({ default: m.RecipientPickerField })),
  // Registry-name pickers (objectui#7611, ruling B2 on objectstack#22865): a
  // text field that stores the MACHINE NAME of one item of one metadata
  // registry type, listed from `GET /api/v1/meta/<type>`. The type is in the
  // key, as `object-ref` carries `object`; one key per type a grant names.
  //   position-ref   → a position (sys_user_position's position name)
  //   permission-ref → a permission set (sys_user_permission_set.permission_set)
  'position-ref': () => import('./widgets/RegistryRefField.js').then(m => ({ default: m.PositionRefField })),
  'permission-ref': () => import('./widgets/RegistryRefField.js').then(m => ({ default: m.PermissionRefField })),
} satisfies Record<string, FieldWidgetLoader>;

/** The registered field widget keys, as a literal union (objectui#4857). */
export type RegisteredFieldWidgetType = keyof typeof fieldWidgetMap;

// String-indexed view of the same object, for the resolver call sites below
// that look up ARBITRARY spellings (aliases, retired keys, author typos). The
// literal-keyed `fieldWidgetMap` cannot be indexed by a plain `string`; this
// alias widens the key without copying anything.
const fieldWidgetLoaderByKey: Record<string, FieldWidgetLoader | undefined> = fieldWidgetMap;

/**
 * Every field type the form can render (the canonical list of supported types).
 * Exported so inline editing can be checked against it — a form type must
 * either have an inline editor or be explicitly excluded, see
 * `INLINE_EXCLUDED_FIELD_TYPES` and its drift-guard test.
 */
export const FORM_FIELD_TYPES: readonly string[] = Object.freeze(Object.keys(fieldWidgetMap));

/**
 * Resolve an arbitrary field-type spelling to the widget key the form uses.
 * A key already present in the widget map resolves to itself; spec aliases
 * (`toggle`, `json`, `repeater`, `secret`, …) resolve through
 * {@link mapFieldTypeToFormType}; anything unknown falls back to `text` —
 * the same fallback the form renderer applies.
 *
 * Consumers that render field widgets outside the form (e.g. the app-shell
 * `ActionParamDialog`) use this + {@link getLazyFieldWidget} so their type
 * support can never drift behind the form surface (ADR-0059).
 */
export function resolveFormWidgetType(fieldType: string): string {
  if (fieldWidgetLoaderByKey[fieldType]) return fieldType;
  // A retired spelling resolves to ITSELF, not to `text`: the registry holds a
  // tombstone widget under that key which refuses visibly, so every host built
  // on this seam (the app-shell `ActionParamDialog`, the bulk dialog) reports
  // the retirement instead of silently rendering an input (objectui#4814).
  if (RETIRED_FIELD_TYPES[fieldType]) return fieldType;
  const mapped = mapFieldTypeToFormType(fieldType).replace(/^field:/, '');
  return fieldWidgetLoaderByKey[mapped] ? mapped : 'text';
}

/**
 * The widget keys that must be fed the live record (`dependentValues`) so their
 * offered option set can be re-resolved per option `visibleWhen` / `dependsOn`.
 *
 * Defined in `@object-ui/core`, next to `resolveCascadingOptions` — the
 * evaluator that reads the record — and re-exported here because this is the
 * package whose {@link resolveFormWidgetType} produces the keys the set is
 * keyed on: a consumer resolving a widget key finds the allow-table in the
 * same place. One definition, two doorways; never a second copy (objectui#4770,
 * which converged the three private copies that preceded it).
 */
export { CASCADE_OPTION_WIDGET_TYPES } from '@object-ui/core';

/**
 * The ONE action-param resolver (objectui#12105): a declared action param —
 * inline, or field-backed via `{ field, objectOverride }` — resolved against
 * the object's field definitions into the `ActionParamDef` a param dialog
 * renders. Exported from here because this is the package both of its callers
 * depend on: app-shell's single-record `ActionParamDialog` and plugin-grid's
 * selection-bar bulk dialog (a promoted action's params). See the module.
 */
export {
  resolveActionParam,
  resolveActionParams,
  resolveParamWidgetType,
  withKnownObjects,
  RESOLVED_ONLY_PARAM_KEYS,
} from './resolveActionParams.js';
export type {
  RawActionParam,
  RawActionParamOption,
  ResolveActionParamsContext,
} from './resolveActionParams.js';

/**
 * The ONE read of a field definition's help line (objectui#12213):
 * `inlineHelpText`, else `description`. Exported from here because both of its
 * readers can reach this package: `@object-ui/plugin-form`'s record form and
 * this package's own `resolveActionParam`. See the module.
 */
export { fieldHelpText } from './fieldHelpText.js';

/** Cache so each widget type creates one lazy component (and one chunk request). */
const lazyFieldWidgets = new Map<string, React.ComponentType<any>>();

/**
 * Lazily-loaded form field widget for a field type. Shares the exact loaders
 * of {@link fieldWidgetMap} (the same components `registerField` registers for
 * forms), wrapped in `React.lazy` and cached per type — so a consumer can
 * render any form-supported field type without eagerly bundling every widget.
 * Render inside a `<Suspense>` boundary. Unknown types resolve to the `text`
 * widget via {@link resolveFormWidgetType}.
 */
export function getLazyFieldWidget(fieldType: string): React.ComponentType<any> {
  const key = resolveFormWidgetType(fieldType);
  // A retired key has no loader in `fieldWidgetMap` by construction, so it is
  // answered with the tombstone before the lazy path (which would otherwise
  // call `React.lazy(undefined)`). The tombstone is BOUND to `key`: a host
  // that resolved the key from an authored `widget` hands over a `field` whose
  // `type` is a live type, and the refusal must name what was resolved
  // (objectui#10471) — see {@link retiredFieldTombstoneFor}.
  if (RETIRED_FIELD_TYPES[key]) return retiredFieldTombstoneFor(key);
  let Widget = lazyFieldWidgets.get(key);
  if (!Widget) {
    // `resolveFormWidgetType` only returns keys the map holds, hence the `!`.
    Widget = React.lazy(fieldWidgetLoaderByKey[key]!);
    lazyFieldWidgets.set(key, Widget);
  }
  return Widget;
}

/**
 * Register a specific field type lazily
 * @param fieldType - The field type to register (e.g., 'text', 'number')
 * 
 * @example
 * // Register only the text field
 * registerField('text');
 */
// The field widgets that register ONLY their namespaced `field:<type>` key and
// no bare `<type>` fallback. Since objectui#10859 batch 8 this is EVERY key of
// `fieldWidgetMap`: a field widget is reached as a form field, which resolves
// `field:<type>` and nothing else (form.tsx `renderFieldComponent`, ruling B of
// objectui#5254), never as a node `type`. The groups below say why each key
// first came off the bare table.
//
// ⛔ Do not take a key back out of this set. A bare fallback makes the key a
// registered node type that `objectui validate` refuses at `type` (no arm in
// `AnyComponentSchema` claims it): the known-types derivation pin forces
// `packages/cli/src/utils/known-schema-types.ts` to be regenerated, and the
// regenerated list turns the `REFUSED_AT_TYPE` ratchet
// (`packages/cli/src/__tests__/registered-types-validate-ratchet-10859.test.ts`)
// red, naming the key. A NEW widget added to `fieldWidgetMap` is added here in
// the same change, for the same reason.
//
// `scripts/check-doc-component-types.mjs` reads this set by name (the
// `fieldWidgetMap` entry's `skipFallbackSet`), so it stays a literal list.
const FIELD_TYPES_SKIP_FALLBACK = new Set([
  // ── Bare-name collisions ──────────────────────────────────────────────────
  // The short name is owned by a display/ui/view/plugin component registered
  // elsewhere (e.g. the display widgets and form-input primitives in
  // @object-ui/components, or the markdown display plugin), which page schemas
  // expect (e.g. `{ type: 'markdown', content }` → the markdown renderer, not
  // the RichText editor). Without skipFallback each of these logged a
  // "bare-name fallback is being overwritten" warning at boot.
  // Display widgets (text/image/avatar/grid live in @object-ui/components
  // or @object-ui/layout as the bare-name owners).
  'text',
  'image',
  'avatar',
  'grid',
  // Form-input primitives owned by `ui:*` in @object-ui/components.
  'textarea',
  'select',
  'email',
  'password',
  'slider',
  // Display renderer owned by `plugin-markdown:markdown`.
  'markdown',
  // The html tier's inline `code` element passthrough, owned by `ui:code` in
  // `renderers/basic/html-elements.tsx` (objectui#10756). Before this line the
  // bare `code` key was THIS widget's fallback, so `<code>inline</code>` on a
  // `kind:'html'` page drew a code editor and dropped its text.
  'code',
  // No other package owns the bare `time`/`address` key, but `registerField`
  // wraps each call in a fresh `React.lazy(...)`, so re-registration (HMR,
  // re-import) fails the registry's identity check every time and logs the
  // same "bare-name fallback overwritten" warning at every boot regardless.
  'time',
  'address',
  // Widget-hint-only pickers — resolved solely via `field:<widget>`, so the
  // bare-key fallback is never wanted.
  'object-ref',
  'filter-condition',
  'recipient-picker',
  'position-ref',
  'permission-ref',
  // ── Retired bare node keys (objectui#10859 batch 8) ───────────────────────
  // Each was registered bare only as this loop's fallback: no other package
  // owns the name, no form path reads it, and no document authors it as a
  // node — every occurrence in the catalog and the docs sits at a field
  // position (`fields[]`, `columns[]`, `filters[]`) — and `objectui validate`
  // refused the bare key at `type`. Retired by the seat's batch-8 ruling on
  // the card, through this set — the route its mechanism answer names.
  'auto_number',
  'boolean',
  'checkboxes',
  'color',
  'currency',
  'date',
  'datetime',
  'file',
  'formula',
  'geolocation',
  'location',
  'lookup',
  'master_detail',
  'multiselect',
  'number',
  'object',
  'percent',
  'phone',
  'qrcode',
  'radio',
  'rating',
  'richtext',
  'signature',
  'summary',
  'tags',
  'url',
  'user',
  'vector',
  // ── Retired bare node key (objectui#13449) ────────────────────────────────
  // `html` sat in the display-widget group above while `@object-ui/components`
  // registered its raw-HTML `ui:html` node, which owned the bare key. That node
  // type is retired, so no package owns bare `html` any more. It stays in this
  // set so the bare key resolves to NOTHING: a stale `{ type: 'html' }` node
  // must draw the unknown-component panel, never this rich-text editor, and a
  // form keeps reaching the widget as `field:html`.
  'html',
]);

/**
 * The labelling declaration of EVERY registered field widget
 * (`RegistryComponentMeta.labelling` — the closed `'control' | 'group' | 'display'`
 * vocabulary, objectui#3961 extended by objectui#4857). This `Record` is keyed
 * by the widget map's own literal key union, so it is exhaustive BY
 * CONSTRUCTION: registering a widget without deciding how a host's label
 * reaches it is a COMPILE error here, not a silent fall-through to the
 * `'control'` path — the omitted-declaration degradation is exactly the trap
 * the #4857 ruling named, and it is what turned the display-only four into
 * fields with no accessible name.
 *
 * ## `'group'` — a surface no `<label for>` can reach; the WIDGET consumes the IDREF
 *
 * Two shapes, one declaration:
 *
 *  - real composites — `address` / `geolocation` render several inputs under one
 *    container, `checkboxes` / `radio` / `rating` / `multiselect` a set of
 *    choice controls, and `grid` a whole table of cell inputs plus row actions;
 *    the host's label names the GROUP, each sub-control keeps its own name (a
 *    sub-label, the chip's text content, or a cell's own `aria-label`).
 *  - single non-labelable controls — `file`'s one control is a
 *    `div[role="button"]` dropzone, `slider`'s is Radix's `span[role="slider"]`
 *    thumb (objectui#3318), `signature`'s drawing surface is a `<canvas>`
 *    (objectui#3318). A `div`/`span`/`canvas` cannot be `for`-labelled, so the
 *    name goes by IDREF to the control (or, for `signature`, its container).
 *
 * Measured, not assumed: every `'group'` entry was verified in a real form —
 * the #3961/#3975 probes for the first seven, the #3318 delivery for
 * `slider`/`signature`, and the #4857 re-measurement for `grid` (bare config:
 * one focusable, the auxiliary "Add line" BUTTON — routing `for` there would
 * have label clicks INSERT A ROW; realistic config: 8 focusables across cell
 * inputs and row actions — a composite, not a single control).
 *
 * ## `'display'` — a pure display in EVERY state; the HOST wraps (objectui#4857)
 *
 * `formula` / `summary` / `auto_number` / `vector` have no editable branch at
 * all: the whole widget is a replacement display with no focusable control, in
 * the editable state as much as the readonly one (on the real object-form path
 * they arrive `disabled`, never `readonly`, so the #4788 readonly gate could
 * not cover them). The form renderer answers the declaration with its own
 * wrapper — id + `aria-labelledby` + `aria-describedby` + `role="group"`, the
 * #4788 container — and the label emits no `for`. The widgets spread nothing,
 * by design; the host is the named surface.
 *
 * ## `'control'` — everything else
 *
 * The host's `<label for>` reaches a real labelable element. At registration
 * this is deliberately spelled as ABSENCE of the meta key (one spelling of the
 * default, objectui#3961), so hosts keep one rule for these and for
 * out-of-registry widgets alike; the entry here is still mandatory, because
 * "defaulted by omission" and "decided to be the default" are different facts.
 */
export const FIELD_WIDGET_LABELLING: Record<
  RegisteredFieldWidgetType,
  NonNullable<RegistryComponentMeta['labelling']>
> = {
  text: 'control',
  textarea: 'control',
  number: 'control',
  boolean: 'control',
  select: 'control',
  date: 'control',
  datetime: 'control',
  time: 'control',
  email: 'control',
  phone: 'control',
  url: 'control',
  multiselect: 'group',
  radio: 'group',
  checkboxes: 'group',
  tags: 'control',
  currency: 'control',
  percent: 'control',
  password: 'control',
  markdown: 'control',
  html: 'control',
  richtext: 'control',
  lookup: 'control',
  master_detail: 'control',
  file: 'group',
  image: 'control',
  location: 'control',
  formula: 'display',
  summary: 'display',
  auto_number: 'display',
  user: 'control',
  object: 'control',
  vector: 'display',
  grid: 'group',
  color: 'control',
  slider: 'group',
  rating: 'group',
  code: 'control',
  avatar: 'control',
  address: 'group',
  geolocation: 'group',
  signature: 'group',
  qrcode: 'control',
  'object-ref': 'control',
  'filter-condition': 'control',
  'recipient-picker': 'control',
  'position-ref': 'control',
  'permission-ref': 'control',
};

export function registerField(fieldType: string): void {
  const loader = fieldWidgetLoaderByKey[fieldType];
  if (!loader) {
    console.warn(`Unknown field type: ${fieldType}`);
    return;
  }
  
  // Create lazy component
  const LazyFieldWidget = React.lazy(loader);

  // Register with field namespace. No LAYOUT wrapper — the form renderer owns
  // label/description/spacing. The only thing wrapped is the metadata carrier:
  // `withFieldCarrier` maps `SchemaRenderer`'s `schema` node onto `field`
  // (objectui#3233) and renders nothing of its own.
  // The loader check above proves `fieldType` is a map key, which is what the
  // labelling record is keyed by — hence the cast, not a second lookup table.
  const labelling = FIELD_WIDGET_LABELLING[fieldType as RegisteredFieldWidgetType];
  ComponentRegistry.register(fieldType, withFieldCarrier(LazyFieldWidget), {
    namespace: 'field',
    skipFallback: FIELD_TYPES_SKIP_FALLBACK.has(fieldType),
    // Only the group- and display-labelled widgets carry the meta key;
    // `'control'` stays ABSENT, which every host reads as `'control'`
    // (objectui#3961). One spelling of the default, in one place — while the
    // exhaustive record above still forces every widget to declare.
    ...(labelling !== 'control' ? { labelling } : null),
  });
}

/**
 * Register all field types (for backward compatibility)
 * This function auto-registers all field widgets on import.
 * 
 * For better tree-shaking, use registerField() to register only needed fields.
 * 
 * @example
 * // Register all fields at once
 * registerAllFields();
 */
/**
 * The widget a RETIRED field-type spelling renders (objectui#4814).
 *
 * Shape borrowed from the form renderer's spec-vocabulary boundary (#3090),
 * which is this repo's settled answer to "an authored entry this renderer
 * cannot honour": an inline alert that NAMES the offending entry, plus a
 * `console.error` whose text doubles as the fix instruction. Nothing is thrown
 * — one retired field must not take down the rest of a record form — but
 * nothing is silently substituted either, which is the whole point: the author
 * sees a refusal where they expected an input, not a text box that looks like
 * it worked.
 *
 * The spelling it names is `retiredFieldType` — the key the RESOLVER answered
 * with this tombstone — and is re-derived from the field only when a host
 * renders the tombstone directly without one (objectui#10471). The field is
 * the wrong witness whenever the retired spelling arrived through a different
 * key than `field.type`: an authored `widget` wins over `type` in both form
 * hosts, so `{ type: 'user', widget: 'owner' }` reaches the `owner` tombstone
 * carrying a `user` field, and deriving from it named the LIVE type as
 * retired, lost the prescription, and logged nothing. The two resolvers fill
 * the prop by binding it ({@link retiredFieldTombstoneFor}); a host whose key
 * IS `field.type` (plugin-detail's inline editor) may keep omitting it.
 */
export const RetiredFieldTombstone: React.FC<Record<string, any>> = (props) => {
  const spelling: string =
    props?.retiredFieldType ??
    props?.field?.type ?? props?.schema?.type ?? props?.type ?? 'unknown';
  const prescription =
    RETIRED_FIELD_TYPES[spelling] ??
    `[object-ui] Field type \`${spelling}\` was retired.`;
  React.useEffect(() => {
    reportRetiredFieldType(spelling);
  }, [spelling]);
  return (
    <div
      role="alert"
      data-testid="field-retired-tombstone"
      data-retired-field-type={spelling}
      className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {prescription}
    </div>
  );
};

/** One bound tombstone per retired spelling — see {@link retiredFieldTombstoneFor}. */
const retiredFieldTombstonesBySpelling = new Map<string, React.ComponentType<Record<string, unknown>>>();

/**
 * {@link RetiredFieldTombstone}, bound to the retired spelling a resolver
 * answered with it (objectui#10471).
 *
 * Both resolvers that turn a retired key into the tombstone hand out this
 * component — `getLazyFieldWidget` and the `field:` registrations of
 * `registerAllFields()` — because neither can put the key into the props a
 * host renders it with: `FormPage` and the record form pass the row's `field`,
 * and nothing else names what was resolved. Binding it here tells the
 * tombstone which spelling it answers for, with no host edit and no second
 * table: the spelling is the resolver's own key, and the prescription is still
 * read from `RETIRED_FIELD_TYPES` by the tombstone itself.
 *
 * Cached per spelling, so the identity is stable (a host that memoises on the
 * key does not remount) and the registry and the lazy door hand out the SAME
 * component. `reportRetiredFieldType` stays once per spelling: it dedupes on
 * the spelling, which is now the right one.
 */
function retiredFieldTombstoneFor(spelling: string): React.ComponentType<Record<string, unknown>> {
  let Bound = retiredFieldTombstonesBySpelling.get(spelling);
  if (!Bound) {
    const BoundTombstone: React.FC<Record<string, unknown>> = (props) => (
      <RetiredFieldTombstone {...props} retiredFieldType={spelling} />
    );
    BoundTombstone.displayName = `RetiredFieldTombstone(${spelling})`;
    Bound = BoundTombstone;
    retiredFieldTombstonesBySpelling.set(spelling, Bound);
  }
  return Bound;
}

export function registerAllFields(): void {
  Object.keys(fieldWidgetMap).forEach(fieldType => {
    registerField(fieldType);
  });
  // Retired spellings are registered LAST and only under the `field:` namespace
  // (`skipFallback` — a tombstone must not claim the bare global name). This is
  // what makes `widget: 'field:owner'` and a hand-written `type: 'owner'` land
  // on a visible refusal instead of falling through to the form's text input.
  // Each is registered BOUND to its spelling, because the record form also
  // reaches `field:owner` through `widget: 'owner'` over a live-typed field
  // (objectui#10471).
  Object.keys(RETIRED_FIELD_TYPES).forEach(fieldType => {
    ComponentRegistry.register(fieldType, retiredFieldTombstoneFor(fieldType), {
      namespace: 'field',
      skipFallback: true,
    });
  });
}

// TOMBSTONE (objectui#3910, ruling B of objectui#3798) — `registerFields()` lived
// here. It registered every widget wrapped in `createFieldRenderer` (above) under
// the same `field:<type>` keys `registerAllFields()` owns, so whoever called it
// LAST won the registry. Its only caller was the docs site, which needed the
// synthesized label + `onChange` to render a bare field node standalone.
//
// objectui#3308 ruled "registration gets exactly one path"; the implementation
// (PR #3793) then disproved the assumption that this was a redundant duplicate —
// it was a demo host adapter, and switching the docs site to `registerAllFields()`
// alone would have left the demo inputs inert. Ruling B of objectui#3798 resolved
// that by moving the docs catalog's field examples to form hosting
// (`{ type: 'form', fields: [...] }`), which deletes the need for the adapter
// instead of relocating it: the form renderer already owns label and value state,
// so the docs now show what a real application actually renders.
//
// Do not re-add this or any second registration path. `registerAllFields()` (and
// `registerField()` for one type) is the seam; a docs- or test-only wrapper that
// re-registers `field:<type>` silently shadows the live entry for every consumer
// sharing the registry.
//
// TOMBSTONE (objectui#3308, ADR-0049 enforce-or-remove) — `field:capability-multiselect`
// was registered inside `registerFields()`, and ONLY there. Because the docs site
// was that function's sole caller, the key never existed on the live path, so a
// field authored with `widget: 'capability-multiselect'` resolved to nothing in
// every real app while a comment here advertised it as usable from a record form.
// Nothing stamped the hint either, and ADR-0056 P2 put the capability editor in
// Studio. The widget NAME stays retired — do not add it to `fieldWidgetMap`.
// `CapabilityMultiSelectField` itself lives on as a plain component, imported and
// rendered directly by Studio's `PermissionMatrixEditor` (ADR-0056 P2's design).
//
// TOMBSTONE (objectui#4814, ruling A′, ADR-0049 enforce-or-remove) — the field
// type `owner` and its widget key `field:owner`. Both pointed at `UserField`,
// the SAME widget `user` resolves to, so the word carried zero behavioral delta;
// and `owner` is absent from `@objectstack/spec`'s closed 48-member `FieldType`,
// so no object schema could declare it — it was reachable only through
// hand-written SDUI. Three code faces had already drifted apart on this one
// word: the form's data-source rule excluded it, plugin-grid's bulk dialog
// included it, and app-shell's `paramToField` included it — which is the
// standing evidence that a second spelling for one concept is a drift channel,
// not a convenience.
//
// The retirement is LOUD, not silent, and that distinction is the ruling's
// point. `mapFieldTypeToFormType`'s `|| 'field:text'` tail and
// `resolveFormWidgetType`'s `: 'text'` tail would each have handed a retired
// `owner` field a working plain text input, with no gate anywhere turning red —
// an AI author copying `type: 'owner'` out of a stale doc would have shipped a
// text box believing it shipped a person picker. So `owner` resolves to
// `RetiredFieldTombstone` (a visible refusal) and `reportRetiredFieldType`
// writes the migration to the console. This is also the designed answer to the
// one surface this retirement could not measure: the `cloud` repo was never
// scanned (no credentials in the measuring session), so any consumer living
// there fails loudly and nameably instead of degrading in silence.
//
// Do not re-add `owner` to `fieldWidgetMap` or to `field-type-alias`'s live
// `typeMap`. The surviving idiom is `{ type: 'user', name: 'owner' }` — the
// field NAME carries ownership meaning, the type carries the widget.
// `UserField` and `UserCellRenderer` are untouched; only the synonym is gone.

export * from './widgets/types.js';
// File field value shapes (ObjectStack ADR-0104 D3 wave 2) — the single
// arbiter of reference vs expanded vs legacy-blob form, shared by the upload
// widgets and by action-param serialization.
export * from './widgets/file-value.js';
export * from './FieldEditWidget.js';
export * from './widgets/TextField.js';
export * from './widgets/NumberField.js';
export * from './widgets/BooleanField.js';
// objectui#11689 — the locale's word for a read-only boolean value, read by
// every surface that draws one as text (including `@object-ui/plugin-detail`'s
// highlights chip). `BooleanValueText` stays internal: its only caller is the
// lookup column renderer in this package.
export { useBooleanValueLabel, type BooleanValueLabel } from './widgets/booleanValueLabel.js';
export * from './widgets/SelectField.js';
export * from './widgets/DateField.js';
export * from './widgets/DateTimeField.js';
export * from './widgets/TimeField.js';
export * from './widgets/EmailField.js';
export * from './widgets/PhoneField.js';
export * from './widgets/UrlField.js';
export * from './widgets/CurrencyField.js';
export * from './widgets/PercentField.js';
export * from './widgets/PasswordField.js';
export * from './widgets/TextAreaField.js';
export * from './widgets/RichTextField.js';
export * from './widgets/LookupField.js';
export * from './widgets/CapabilityMultiSelectField.js';
export * from './widgets/ObjectRefField.js';
export * from './widgets/FilterConditionField.js';
export * from './widgets/RecipientPickerField.js';
// The kind table and the two spellings the reference widgets share with a host
// face (objectui#12613), published so the face names a stored value as the
// widget does: `@object-ui/app-shell`'s widget reference cells are the reader.
// Only what that reader imports; the widgets' own reads stay module-private.
export { objectRefOptionLabel } from './widgets/objectRefLabel.js';
export {
  RECIPIENT_RECORD_KINDS,
  RECIPIENT_REGISTRY_KINDS,
  FIELD_RECIPIENT_TYPE,
  recipientCandidateLabel,
} from './widgets/recipientKinds.js';
export * from './widgets/RecordPickerDialog.js';
// Shared picker-column derivation (ADR-0085 highlightFields → displayFields →
// schema walk) — consumed by LookupField AND by RelatedList's Add-picker so a
// lookup picker and a related-list Add dialog of the same object agree on
// columns (#3365).
export * from './widgets/deriveLookupColumns.js';
export * from './widgets/FileField.js';
export * from './widgets/ImageField.js';
export { ImageCropperDialog } from './widgets/ImageCropperDialog.js';
export type { ImageCropperDialogProps } from './widgets/ImageCropperDialog.js';
export * from './widgets/LocationField.js';
export * from './widgets/FormulaField.js';
export * from './widgets/SummaryField.js';
export * from './widgets/AutoNumberField.js';
export * from './widgets/UserField.js';
export * from './widgets/ObjectField.js';
export * from './widgets/VectorField.js';
export * from './widgets/GridField.js';
// New widgets according to @objectstack/spec
export * from './widgets/ColorField.js';
export * from './widgets/SliderField.js';
export * from './widgets/RatingField.js';
export * from './widgets/CodeField.js';
export * from './widgets/AvatarField.js';
export * from './widgets/AddressField.js';
export * from './widgets/GeolocationField.js';
export * from './widgets/SignatureField.js';
export * from './widgets/QRCodeField.js';
export * from './widgets/MasterDetailField.js';
export * from './widgets/MultiSelectField.js';
export * from './widgets/RadioField.js';
export * from './widgets/CheckboxesField.js';
export * from './widgets/TagsField.js';

// The SDUI-node → `field` adapter every registration here goes through
// (objectui#3233). Exported so a widget registered OUTSIDE this repo can reach
// the same single-carrier guarantee instead of re-growing a `field || schema`
// read of its own.
export { withFieldCarrier } from './withFieldCarrier.js';

// The whitelist that decides what a widget's `...props` spread may put on a
// DOM element (objectui#3291) — the runtime executor of the "DOM pass-through"
// block of `FieldWidgetComponentProps`. Exported for the same reason as
// `withFieldCarrier` above: a widget authored outside this repo needs to reach
// it, or it re-grows the bare spread this closed.
export { toDomProps } from './widgets/toDomProps.js';
export type { FieldDomProps } from './widgets/toDomProps.js';

// The sibling executor for the NON-DOM half of the same declaration
// (`f08bcd9af`): `error` plus the "Host plumbing" block, forwarded as
// COMPONENT props because none of them is DOM-legal. Exported alongside
// `toDomProps` because a host factory authored outside this repo needs the
// pair — reaching for only the first one is how `FieldEditWidget` came to
// deliver half the contract it declares.
export { toHostProps } from './widgets/toHostProps.js';
export type { HostProps } from './widgets/toHostProps.js';

// The native date/time control value adapters (objectui#3127). `DateTimeField`
// is ISO-canonical on BOTH sides — it takes the record's ISO instant and hands
// an ISO instant back, which is also the wire form the platform's `datetime`
// value contract requires (`InstantValueSchema`: an ISO-8601 instant with an
// explicit zone), so no consumer has to convert at its own serialization
// boundary. `ActionParamDialog` used to (objectstack#5061 removed it — the
// zone-less wall clock it produced was the one shape the validator rejects).
// Exported for the same reason as `toDomProps` above: a widget authored outside
// this repo needs the same pair, and a second copy of "what the local wall clock
// of an instant is" would drift from this one.
export {
  toDateInputValue,
  toDateTimeInputValue,
  fromDateTimeInputValue,
} from './widgets/nativeDateValue.js';

// The AGGREGATED half of the upload-in-flight signal (objectui#10166).
// `onUploadingChange` answers "is THIS widget uploading" to a host that renders
// the control itself; a record form hands a `fields` array to the `form` node
// renderer and never touches a widget, so it has no place to attach that
// callback. `useUploadingScope` + `UploadingScopeProvider` let such a host ask
// "is ANYTHING below me uploading" and gate its own Save on the answer.
// Exported because the hosts that need it live in other packages
// (`@object-ui/plugin-form`), and because a second, host-local implementation
// of the same aggregation would drift from the one `useUploadingSignal` feeds.
export { useUploadingScope, UploadingScopeProvider } from './widgets/uploadingScope.js';
// The producer side of that same signal, exported for the same reason
// `toDomProps`/`toHostProps` are: a widget authored outside this repo publishes
// its in-flight state through this ONE hook, and a second implementation of
// "tell my host I am uploading" would reach only half the sinks.
export { useUploadingSignal } from './widgets/useUploadingSignal.js';
export type { UploadingScope } from './widgets/uploadingScope.js';

// Initialize registry
registerAllFields();
