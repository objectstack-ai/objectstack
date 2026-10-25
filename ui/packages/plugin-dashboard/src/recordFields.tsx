/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Shared field-rendering helpers for the dashboard data widgets.
 *
 * Both the table widget cells (`ObjectDataTable`) and the drill-to-record
 * detail drawer (`RecordDetailDrawer`) must format a field value identically —
 * a currency in the table must read as a currency in the record drawer. These
 * helpers centralize that logic so the two surfaces never drift:
 *
 * - {@link indexObjectFields} normalizes an object schema's `fields` (array or
 *   map form) into a `name → def` lookup.
 * - {@link buildFieldMeta} derives the `FieldMeta` consumed by the shared
 *   `@object-ui/fields` cell renderers from an object-schema field definition
 *   (with optional per-column overrides + translated select options).
 * - {@link renderFieldValue} turns a raw value + `FieldMeta` into a React node
 *   using the same currency / percent / date / cell-renderer rules as the grid.
 */

import React from 'react';
import {
  getCellRenderer,
  resolveCellRendererType,
  formatCurrency,
  formatPercent,
  percentCellScale,
  formatDate,
  // THE GATE the maintainer ruled onto this package's surface (objectui#4914,
  // ruling B). Read from `@object-ui/fields` here — the spelling the ruling
  // names — which re-exports the single implementation homed in
  // `@object-ui/core`.
  isRetiredFieldType,
  reportRetiredFieldType,
} from '@object-ui/fields';
// The reference-bearing field family, read as the object `@object-ui/core`
// publishes rather than restated here (objectui#5692). Imported from its home
// package, the way the other converged consumers do, so the identity pin has a
// single object to spy on.
import { EXPANDABLE_FIELD_TYPES } from '@object-ui/core';
// The one currency precedence every field / measure / cell face shares
// (objectui#10463), read from its home package as `ObjectGrid` and
// `ObjectMetricWidget` read it.
import { resolveFieldCurrency } from '@object-ui/i18n';

/**
 * Framework / system audit fields hidden from auto-derived columns and the
 * record-detail drawer. Authors wanting them can pass an explicit whitelist.
 */
export const SYSTEM_FIELDS = new Set([
  'id', 'organization_id', 'tenant_id', 'created_at', 'updated_at',
  'created_by', 'updated_by', 'deleted_at', 'deleted_by', 'version',
  '_id', '__typename',
]);

/** Whether a field name/def is a framework/system field that should be hidden. */
export function isSystemField(name: string, def?: any): boolean {
  if (def && (def.isSystem === true || def.system === true)) return true;
  return SYSTEM_FIELDS.has(name);
}

/** Field types whose `options` carry per-value labels worth translating. */
const OPTION_TYPES = new Set(['select', 'picklist', 'dropdown', 'status']);

/** Numeric-flavoured field types (right-aligned in tables). */
export const NUMERIC_FIELD_TYPES = new Set([
  'currency', 'money', 'number', 'integer', 'decimal', 'float', 'percent', 'percentage',
]);

/**
 * Field types whose `format` {@link renderFieldValue} reads as a date display
 * pattern (objectui#10220).
 *
 * `format` has one key and several readers, each with its own vocabulary. The
 * `FieldSchema.format` description objectstack#19763 wrote for
 * `@objectstack/spec` says so: the `date` / `datetime` cells read it as a
 * display style, while on a plain-text field the shared resolver
 * (`resolveCellRendererType`, `@object-ui/fields`) reads a small set of
 * renderer-hint words. The date branch used to fire on any
 * `format` containing a Y / M / D / H / m / s letter, whatever the field's type,
 * so `format: 'email'` (it has an `m`) sent an address to `formatDate` and
 * painted an em dash. So did an `autonumber` record-number pattern carrying
 * date tokens and a `time` field's `HH:mm` — neither of them a hint word.
 *
 * ⛔ Do not replace this gate with a list of hint words to exclude: that is a
 * second copy of the resolver's vocabulary, kept in step by hand, and the
 * autonumber and time cases show it would still miss. A field whose type is
 * unknown is not a date cell either; a column with no schema type declares
 * `type: 'date'` to get the date face.
 */
const DATE_PATTERN_FIELD_TYPES = new Set(['date', 'datetime']);

/**
 * Relational keys copied from the OBJECT SCHEMA field def onto the built
 * {@link FieldMeta}, so a lookup / master_detail / tree cell can resolve the
 * record it references (objectui#6694).
 *
 * ## What was broken
 *
 * When objectui#6694 was filed, `LookupCellRenderer` (`@object-ui/fields`)
 * resolved its target from `field.reference_to || field.reference` and its
 * display field from `field.display_field`. `FieldMeta` carried NONE of those
 * spellings, so for every lookup cell in `ObjectDataTable` and
 * `RecordDetailDrawer` the renderer resolved `undefined` and two things failed
 * silently: `useRefObjectSchema` never loaded the referenced object's schema
 * (so the ADR-0079 / issue #2357 resolution never ran and the cell fell back to
 * `pickRecordDisplayName`'s generic `.name`/`.title` heuristic), and
 * `ReferencedRecordLink`'s `objectName` was always `undefined` (so `navigable`
 * was always `false` and the cell never rendered a real anchor — no
 * drill-through, no middle-click, no copy-link).
 *
 * ## This is ADOPTED, not invented
 *
 * `plugin-grid`'s `ObjectGrid` already makes this exact copy —
 * `applyRelationalMeta`, off its `RELATIONAL_META_KEYS`, at all three of its
 * column-building call sites — which is why its lookup cells have always had
 * both behaviours. This is that same move, made once in the seam BOTH dashboard
 * widgets funnel through, which is what this module exists for (see the file
 * header: the two surfaces must never drift).
 *
 * ## ⚠️ The copy set is DELIBERATELY narrower than the grid's — measured, per key
 *
 * The grid's copy set is derived from the key table in
 * `plugin-grid/src/relationalMetaKeys.ts`; read it there rather than from a
 * list copied here. The grid needs its picker keys because its cells are
 * EDITABLE — the defect that earned them was an inline-edited lookup showing a
 * raw id — and those keys drive the inline picker's query.
 *
 * These two widgets are READ-ONLY. Their only render path is
 * {@link renderFieldValue} → `getCellRenderer` → a CELL renderer; no field
 * EDITOR is reachable from it. Measured on `packages/fields/src/index.tsx` —
 * the module `getCellRenderer` dispatches into — the complete set of relational
 * keys read off a cell's `field` prop is:
 *
 *  - `reference`, `displayField` — read by `LookupCellRenderer` itself.
 *    ✅ COPIED.
 *
 *    ⭐ `reference_to` LEFT this list with objectui#11070 round 4. The cell
 *    read `reference_to || reference` until then; it reads `reference` alone
 *    now, the ingestion choke point no longer stamps `reference_to`, and no
 *    in-repo producer writes it. Copying it would write a member no reader
 *    consults — the shape objectui#6711 and objectui#6874 retired.
 *
 *    ⭐ `display_field` LEFT this list with objectui#11070's text-family round,
 *    for the same reason. The cell has resolved the display pointer as
 *    `displayField || reference_field` since objectui#7155 retired its
 *    `display_field` leg, and the ingestion choke point folds a served
 *    `display_field` onto `displayField` (objectui#7650), so the copy of it
 *    wrote a member no reader consulted. `FieldMeta` no longer declares it,
 *    and `ObjectDataTable` refuses it on an authored column by a hand-written
 *    tombstone (`ObjectDataTableRetiredDisplayFieldSnakeTombstone`).
 *
 *    ⭐ `displayField` ARRIVED with objectui#6875: it is the spelling
 *    `@objectstack/spec`'s strict `FieldSchema` DECLARES, so on a live path
 *    served through `getObjectSchema` it is the one that arrives, and without
 *    it a lookup cell here rendered the referenced record's generic `.name`
 *    instead of the author's pointer. The grid's twin of this defect is pinned
 *    behaviourally in `plugin-grid/src/__tests__/lookupDisplayFieldSpelling-6875.test.tsx`.
 *
 *  - `reference_field` — the chain's second leg, and still ⛔ NOT copied.
 *    `FieldSchema` does not declare it (it parses to `unrecognized_keys`) and
 *    the producer repo has zero occurrences of the identifier, against a
 *    `displayField` control that hits 68 files. Copying it would write a member
 *    from the def on every call that no producer can fill — objectui#6711's
 *    reasoning, unchanged.
 *  - `id_field`, `description_field`, `lookup_filters`, `lookupFilters` — ZERO
 *    mentions in that module; read only by `fields/src/widgets/LookupField.tsx`
 *    and `UserField.tsx`, both EDITORS. ⛔ NOT copied.
 *  - `reference_to_field` — ZERO member reads anywhere in the repo. ⛔ NOT
 *    copied. ⭐ The grid has since retired it from its own list too
 *    (objectui#6711); this measurement is what that retirement acted on.
 *  - `titleFormat` — never read off a FIELD meta at all; every reader takes it
 *    off the OBJECT schema (`getRecordDisplayName` in `@object-ui/core`,
 *    `containers.tsx`). On this path that object schema arrives through
 *    `useRefObjectSchema(reference)` — so copying the target (`reference_to`
 *    then, `reference` since objectui#11070 round 4) is what makes
 *    `titleFormat` work, and copying `titleFormat` here would reach nothing. ⛔ NOT copied. ⭐ The grid has since retired it too
 *    (objectui#6874), on exactly this reading.
 *
 * ⛔ Do not "restore parity" by widening this to the grid's set. A member
 * written from the schema def on every call and read by nothing is exactly what
 * objectui#6625 (`decimals`) and objectui#6597 (`referenceTo`) retired from this
 * very file. Add a key when a reader on THIS path is measured, not before; if
 * these widgets ever gain inline editing, that is the event that earns the
 * picker keys. The boundary is pinned in
 * `__tests__/lookupRelationalMeta-6694.test.tsx`.
 */
const CELL_RELATIONAL_META_KEYS = ['reference', 'displayField'] as const;

/**
 * Copy {@link CELL_RELATIONAL_META_KEYS} off a schema field def, with
 * `applyRelationalMeta`'s own semantics: a key is written only when the def
 * actually carries it, so a non-relational field's meta gains no keys at all and
 * an absent key never lands as an explicit `undefined`.
 */
function pickCellRelationalMeta(def: any): Partial<FieldMeta> {
  const out: Partial<FieldMeta> = {};
  if (!def) return out;
  for (const key of CELL_RELATIONAL_META_KEYS) {
    if (def[key] !== undefined) out[key] = def[key];
  }
  return out;
}

/**
 * The override vocabulary this package's two field surfaces share.
 *
 * ⚠️ This type is a DERIVATION SOURCE, not only a shape: `ObjectDataTable`'s
 * two column bands are both `Exclude<keyof FieldMeta, …>` — `EnrichedColumn`'s
 * write-side tombstones (objectui#6373) and `AuthoredColumnOverrides`' read-side
 * refusal band (objectui#6425). So a member REMOVED here silently leaves both
 * bands, and any refusal that rode on its membership stops enforcing with
 * nothing going red. A member being retired must therefore be re-refused
 * explicitly at that seam before it leaves this type — see
 * `ObjectDataTableRetiredDecimalsTombstone` in `ObjectDataTable.tsx`, which is
 * what `decimals` left behind.
 *
 * ⛔ `decimals` was RETIRED from this type by objectui#6625 — written from the
 * schema def on every call and read by nothing (zero `.decimals` member reads
 * across `@object-ui/fields`, `@object-ui/i18n`, `@object-ui/components`,
 * `@object-ui/core` and this package, measured against a `.scale` positive
 * control that hits `NumberField.tsx` / `GridField.tsx` / `index.tsx`). If a
 * reader is ever wanted here it reads `scale` — the field def's decimal-places
 * key, which is what the retired write resolved to anyway and what
 * `NumberCellRenderer` already reads (`precision` is the total digit count, a
 * different question — objectui#2131). ⛔ Do not resurrect `decimals`.
 *
 * ⛔ `referenceTo` was RETIRED from this type by objectui#6597 (enforce-or-remove,
 * withdraw branch — maintainer's standing startup-stage rule, 2026-08-27: no
 * measured demand retires immediately). It was documented by this package's
 * README as an author-facing column override, but the promise was never kept:
 * `LookupCellRenderer` (`@object-ui/fields`) resolves its lookup target from
 * `field.reference_to` / `field.reference` — never `field.referenceTo` — and
 * `computeLookupExpand` (`ObjectDataTable.tsx`) builds `$expand` from the OBJECT
 * SCHEMA's field types, never from an authored override. Measured with the
 * `referenceTo`-vs-`options` positive control in
 * `ObjectDataTable.overrideSource-6425.test.tsx`: `options` (a live override)
 * separates two equal-valued columns, `referenceTo` does not — an authored
 * override renders byte-identical to its absence. No authoring story survived
 * the search either: the sibling `ObjectGrid` producer's own relational-meta
 * pass-through (`applyRelationalMeta`, `plugin-grid/src/ObjectGrid.tsx`) copies
 * `reference_to` / `reference` from the SCHEMA field def only, never from an
 * authored column override, and no example/doc/fixture in this repo shows a
 * table column pinning a lookup's target to something other than what its
 * schema field already says. If a reader for the resolved reference target is
 * ever wanted here, it reads `reference_to` / `reference` off the schema field
 * def directly — the spelling `LookupCellRenderer` and `computeLookupExpand`
 * actually use. ⛔ Do not resurrect `referenceTo`.
 *
 * ⭐ That reader ARRIVED (objectui#6694): `reference` / `displayField` below
 * (with `reference_to` beside them until objectui#11070 round 4 retired it,
 * and `display_field` until objectui#11070's text-family round did), copied
 * from the SCHEMA field def by {@link buildFieldMeta} and justified per key on
 * `CELL_RELATIONAL_META_KEYS`.
 * They are the "future reader" both retirement notes predicted, in the spelling
 * they named, and they change neither verdict — the source is the schema field
 * def, never an authored column override, which is the exact distinction
 * objectui#6597 measured and withdrew on.
 *
 * ⚠️ Being `FieldMeta` members they GROW both derived bands in
 * `ObjectDataTable.tsx` — `EnrichedColumn`'s emit tombstones and
 * `UnheldFieldMetaOverrideKey`'s read-side refusal. `reference_to` left the
 * type in objectui#11070 round 4 and `display_field` in its text-family round,
 * so — by the rule at the top of this docblock — each one's refusal is
 * re-stated by hand there (`ObjectDataTableRetiredReferenceToSnakeTombstone`,
 * `ObjectDataTableRetiredDisplayFieldSnakeTombstone`). That is the intended
 * verdict rather than a side effect: an AUTHORED column may not source a
 * lookup's reference target (objectui#6597 measured no authoring story for
 * one), while the schema-derived write is reached by neither band. They landed
 * in both without anyone editing a list — the property this derivation exists
 * for.
 */
export interface FieldMeta {
  name: string;
  label: string;
  type?: string;
  options?: Array<{ value: any; label: string; color?: string }>;
  format?: string;
  currency?: string;
  /**
   * The field def's declared upper bound, which on a `percent` field is its
   * STORAGE statement: the spec's `percentScaleOf` reads a fraction unless
   * `max` is above 1 (objectui#11475). Copied from the SCHEMA field def by
   * {@link buildFieldMeta} so the percent cell and the `%` branch of
   * {@link renderFieldValue} read the field's storage rather than guess it
   * from the value. Never an authored column override: as a `FieldMeta`
   * member it lands in `ObjectDataTable`'s read-side refusal band, which is
   * the intended verdict — a column may not restate how its field stores.
   */
  max?: number;
  /**
   * Lookup target object — the spelling `@objectstack/spec`'s `FieldSchema`
   * declares and the only one `LookupCellRenderer` reads. Its snake_case twin
   * `reference_to` was RETIRED from this type by objectui#11070 round 4.
   */
  reference?: string;
  /**
   * Author-declared display field on the lookup, in the SPEC spelling
   * (`FieldSchema.displayField`) — it beats every resolver in the cell. The
   * first leg of `LookupCellRenderer`'s `displayField || reference_field`
   * chain, and the only leg a spec-compliant producer can emit
   * (objectui#6875). Its snake_case twin `display_field` was RETIRED from this
   * type by objectui#11070's text-family round: no reader read it.
   */
  displayField?: string;
}

/**
 * Normalize an object schema's `fields` into a `{ name → def }` map. Accepts
 * both the array form (`[{ name, type, ... }]`) and the keyed map form
 * (`{ name: { type, ... } }`). Returns an empty object when no schema.
 */
export function indexObjectFields(objectSchema: any): Record<string, any> {
  const out: Record<string, any> = {};
  const fields = objectSchema?.fields;
  if (!fields) return out;
  if (Array.isArray(fields)) {
    for (const def of fields) if (def?.name) out[def.name] = def;
  } else {
    for (const [name, def] of Object.entries(fields)) out[name] = { name, ...(def as any) };
  }
  return out;
}

export interface BuildFieldMetaParams {
  accessorKey: string;
  label: string;
  /** Field definition from the object schema (if known). */
  def?: any;
  /** Object name, used to translate select-option labels. */
  objectName?: string;
  /** Translator for per-option labels (from `useSafeFieldLabel`). */
  fieldOptionLabel?: (objectName: string, field: string, value: string, fallback: string) => string;
  /**
   * Per-column overrides (table columns may pin type/format/options).
   *
   * A subset of {@link FieldMeta}, which is what makes that type the pool
   * `ObjectDataTable`'s refusal band derives from. `decimals` left with the
   * member (objectui#6625): its last feeder went when objectui#6425's ruling
   * removed the authored read from `ObjectDataTable.enrich()`, and
   * `RecordDetailDrawer` — the only other caller — passes no overrides at all.
   * `referenceTo` left the same way (objectui#6597): `ObjectDataTable.enrich()`
   * no longer reads it off the authored column, and `RecordDetailDrawer` never
   * did.
   */
  overrides?: {
    type?: string;
    format?: string;
    options?: any;
    currency?: string;
  };
}

/**
 * Build the `FieldMeta` for a single field, resolving currency from the
 * schema field def and translating select options. Column-level overrides
 * win over schema-derived values.
 *
 * The field def's currency goes through `resolveFieldCurrency`
 * (`@object-ui/i18n`) rather than a chain of this helper's own (objectui#10463).
 * The resolver is what reads `currencyConfig`, the spec's one fixed-currency
 * declaration, and only under `currencyMode: 'fixed'`. The chain it replaced
 * read the flat `currency` / `defaultCurrency` spellings only, so a fixed
 * field painted in the tenant currency in both the table cell and the record
 * drawer. The call passes NO tenant default: `renderFieldValue` backstops with
 * the tenant only after the symbol it infers from a `format`, and a tenant code
 * resolved here would jump ahead of that symbol.
 */
export function buildFieldMeta(params: BuildFieldMetaParams): FieldMeta {
  const { accessorKey, label, def: meta, objectName, fieldOptionLabel, overrides = {} } = params;

  let options: Array<{ value: any; label: string; color?: string }> | undefined =
    overrides.options ?? meta?.options;

  if (objectName && options && fieldOptionLabel && OPTION_TYPES.has(meta?.type)) {
    options = options.map((opt: any) => {
      if (opt == null) return opt;
      const value = typeof opt === 'object' ? opt.value : opt;
      const fallback = typeof opt === 'object' ? (opt.label || String(value)) : String(value);
      return {
        value,
        label: fieldOptionLabel(objectName, accessorKey, String(value), fallback),
        color: typeof opt === 'object' ? opt.color : undefined,
      };
    });
  }

  return {
    name: accessorKey,
    label,
    type: overrides.type ?? meta?.type,
    options,
    format: overrides.format ?? meta?.format,
    currency: overrides.currency ?? resolveFieldCurrency(meta),
    // The storage statement of a `percent` field (objectui#11475), from the
    // schema def only — see `FieldMeta.max`.
    ...(typeof meta?.max === 'number' && { max: meta.max }),
    // ⛔ No `decimals` — RETIRED by objectui#6625. It resolved
    // `meta?.decimals ?? meta?.scale` on every call and reached no reader; the
    // `overrides.decimals ??` head of that chain had already lost its only
    // feeder to objectui#6425's ruling. A future reader reads `scale`.
    //
    // ⛔ No `referenceTo` — RETIRED by objectui#6597 (enforce-or-remove,
    // withdraw). It resolved `overrides.referenceTo ?? meta?.referenceTo ??
    // meta?.reference(.to) ?? meta?.target` on every call and reached no
    // reader: `LookupCellRenderer` resolved its target from
    // `reference_to` / `reference` (`reference` alone since objectui#11070
    // round 4), never this spelling. ⭐ That future reader
    // ARRIVED in objectui#6694 — the spread below, in the schema field def's own
    // spelling, which is the one that retirement note pointed at. The
    // retirement stands: this is a SCHEMA-derived write with no `overrides.`
    // leg, so it makes no authored key live.
    ...pickCellRelationalMeta(meta),
  };
}

/** Whether a `FieldMeta` should be right-aligned (numeric / currency / percent). */
export function isNumericFieldMeta(fieldMeta: Pick<FieldMeta, 'type' | 'format'>): boolean {
  return (
    NUMERIC_FIELD_TYPES.has(fieldMeta.type as string) ||
    (typeof fieldMeta.format === 'string' && /^[$¥€£]|%$|0/.test(fieldMeta.format))
  );
}

/**
 * Render a raw field value to a React node using the same currency / percent /
 * date / cell-renderer rules as the dashboard table. Returns `''` for nullish /
 * empty values.
 *
 * `tenantCurrency` (localization.currency, ADR-0053) backstops a currency
 * field/format that declares no explicit code of its own, so both the table
 * cell and the record-detail drawer honor the tenant default.
 */
export function renderFieldValue(
  value: any,
  fieldMeta: FieldMeta,
  tenantCurrency?: string,
  // BCP-47 display locale from `useDisplayLocale()` (objectui#4553). Optional
  // and last, so an existing caller that passes nothing keeps the behavior it
  // had. This is a plain function rather than a component, so the locale has to
  // arrive as an argument — there is no hook to read it from here.
  displayLocale?: string,
): React.ReactNode {
  if (value == null || value === '') return '';
  const fmt = fieldMeta.format;
  if (typeof fmt === 'string' && /^\$|¥|€|£/.test(fmt) && typeof value === 'number') {
    // Honor explicit `currency`; else infer from the leading symbol so we never
    // silently fall back to USD when the author wrote `¥`/`€`; finally fall back
    // to the tenant default currency.
    const symbolMap: Record<string, string> = { '$': 'USD', '¥': 'JPY', '€': 'EUR', '£': 'GBP' };
    const inferred = symbolMap[fmt[0]];
    // The display locale this function was handed goes to EVERY formatter
    // below, not only to the percent one: the currency and date branches used
    // to drop it, and `formatCurrency` / `formatDate` read an absent tag as
    // "follow the runtime", i.e. the MACHINE's locale — invisible to a source
    // scan, since the call passes an argument list that merely omits it
    // (objectui#9909).
    return formatCurrency(value, fieldMeta.currency || inferred || tenantCurrency, displayLocale);
  }
  if (typeof fmt === 'string' && /%/.test(fmt) && typeof value === 'number') {
    const decimals = (fmt.match(/0\.(0+)%/) || [undefined, ''] as any)[1].length;
    // The RAW stored value goes to `formatPercent`, which applies
    // `percentDisplayValue` (`@object-ui/core`) at the storage stated here.
    // This is the same call the list-view percent cell makes for an ordinary
    // percent column (`PercentCellRenderer` in `@object-ui/fields`), so a
    // percent now reads identically as a record field, as a grid cell and as a
    // dashboard measure.
    //
    // The STORAGE is stated, never read off the value (objectui#11475). A
    // `percent` (or `progress`) field states it in its declaration, read by
    // `percentCellScale` — the answer the cell reads, the spec's
    // `percentScaleOf` over `FieldMeta.max`. Any other field carries no
    // percent storage at all (the spec: "a plain `number` carries no percent
    // semantics"), so the only statement left is the `%` pattern itself, and
    // numeral's `%` multiplies by 100: a fraction. The magnitude guess this
    // replaced read a fraction-stored `1` as `1%` and a whole-stored `0.5` as
    // `50%`.
    //
    // ⚠️ This call site used to make the fraction/points decision AGAIN, with a
    // local copy that had drifted from the one it duplicated (objectui#5607):
    //
    //   const normalized = value > 1 ? value / 100 : value;
    //   return formatPercent(normalized * 100, decimals, displayLocale);
    //
    // Three measured divergences, all of them the one defect — a caller
    // re-deciding what core owns:
    //  - `(value / 100) * 100` is NOT value-preserving in binary floating
    //    point. It re-introduced, one call frame upstream, exactly the round
    //    trip objectui#4590 removed from inside `formatPercent`: 19,978 of
    //    199,000 values on the 0.001-step grid to 200 change bit pattern and
    //    1,108 rendered strings move, every one a last-digit off-by-one —
    //    a stored `1.605` rendered `1.60%` where half-up is `1.61%`.
    //  - A stored fraction below 0.01 was scaled TWICE: the local `* 100` put
    //    it below 1, so core's fraction arm scaled it again — `0.005` (0.5%)
    //    rendered `50.00%`, a factor of 100.
    //  - The local test was `value > 1`, not core's symmetric `|value| < 1`,
    //    so a negative already in points was treated as a fraction: `-5`
    //    rendered `-500.00%`.
    // Deleting the branch fixes all three, because they were never three bugs.
    const percentScale =
      fieldMeta.type === 'percent' || fieldMeta.type === 'progress'
        ? percentCellScale(fieldMeta)
        : 'fraction';
    return formatPercent(value, percentScale, decimals, displayLocale);
  }
  // A date pattern only on a date field (objectui#10220) — see
  // `DATE_PATTERN_FIELD_TYPES` for why the gate is the type. A date field's
  // style word that carries none of the Y / M / D / H / m / s letters
  // (`relative`) still falls through to its cell renderer below, as before.
  if (
    typeof fmt === 'string'
    && DATE_PATTERN_FIELD_TYPES.has(fieldMeta.type as string)
    && /[YMDHms]/.test(fmt)
  ) {
    return formatDate(value, fmt, { locale: displayLocale });
  }
  const Renderer = getCellRenderer(resolveCellRendererType(fieldMeta as any));
  return <Renderer value={value} field={fieldMeta as any} />;
}

/**
 * Whether a field is a relation/lookup (used to drive `$expand`).
 *
 * THE GATE (objectui#4914, ruling B) runs ahead of the membership test.
 * Measured before the ruling: `isLookupType('owner')` was `true` — a retired
 * spelling holding first-class relation status. It answers `false` now, and
 * says why once.
 *
 * The membership half is no longer a private table (objectui#5692). It used to
 * be `new Set(['lookup', 'reference', 'master_detail', 'user'])`, one of TWO
 * copies this package held — the other inline in `computeLookupExpand` — and
 * neither derived from nor pinned against {@link EXPANDABLE_FIELD_TYPES}, the
 * family `@object-ui/core` publishes for exactly this question. objectui#5312's
 * claim to have converted "the LAST private copy" was false by these two: they
 * predate that sweep and were outside its file surface.
 *
 * The convergence moved membership in two directions, each decided by
 * measurement rather than by preference (objectui#5692):
 *
 *  - `tree` is GAINED. A self-referencing hierarchy field is reference-bearing,
 *    it is a member of the spec's closed `FieldType`, and the form / grid road
 *    already `$expand`s it. The dashboard road giving it the same treatment is
 *    family behaviour restored, not a new decision.
 *  - `reference` is DROPPED, and dropping it is a no-op on spec-compliant data.
 *    The spelling is absent from `@objectstack/spec`'s closed `FieldType`
 *    vocabulary and is refused by `FieldSchema.safeParse` — measured with
 *    `lookup` / `master_detail` / `user` / `tree` as live controls and the
 *    retired `owner` plus a nonsense spelling as dead ones — so no
 *    spec-compliant object schema can declare a field whose stored type is
 *    `reference`. Where the spelling IS live it is a legacy DIALECT alias on the
 *    action-param surface, folded to `lookup` before any field-type data is read
 *    (`PARAM_TYPE_ALIASES` in `app-shell/src/utils/paramToField.ts`). Keeping it
 *    here would be a lenient renderer-side alias for off-spec metadata, which is
 *    what AGENTS.md #0.1 bans.
 *
 * Extending this surface later: OR in a second, surface-local set, the way the
 * object form's `needsDataSourceWiring` does. Never
 * `new Set([...EXPANDABLE_FIELD_TYPES, …])` — a copy re-forks the table, which
 * is the defect this change removed, and the identity pin fails on it by design.
 */
export function isLookupType(t: unknown): boolean {
  if (typeof t === 'string' && isRetiredFieldType(t)) {
    reportRetiredFieldType(t);
    return false;
  }
  return EXPANDABLE_FIELD_TYPES.has(t as string);
}
