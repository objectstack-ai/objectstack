/**
 * resolveActionParams — Resolves field-backed action parameters against
 * runtime object metadata.
 *
 * Action params (`packages/spec/src/ui/action.zod.ts ActionParamSchema`) may
 * either be declared inline (`{ name, label, type, ... }`) or reference an
 * existing object field via `{ field, objectOverride? }`. Field-backed
 * params inherit label (i18n via `fieldLabel()`), type, options, placeholder,
 * and help text from the object's field definition. Inline properties on a
 * field-backed param act as overrides.
 *
 * NOT validation: this comment used to claim it, but no `validation` was ever
 * inherited — `RuntimeField` below has no such key to read one from, and the
 * `ActionParamDef` it would have landed on no longer declares one either
 * (objectui#3201). A param's constraints reach the widgets through
 * `paramToField()` as `required` / `minLength` / `maxLength` / `pattern`.
 *
 * The resolver flattens each param to the runtime `ActionParamDef` shape
 * expected by `ActionParamDialog`, so the dialog itself stays agnostic to
 * field references.
 *
 * ## ONE resolver, two dialogs (objectui#12105)
 *
 * This module used to live in `@object-ui/app-shell` (`src/utils/`), which only
 * the single-record `ActionParamDialog` could reach. The selection bar's bulk
 * dialog lives in `@object-ui/plugin-grid`, which `app-shell` depends on and
 * which therefore can never import from it, so a promoted bulk action's
 * field-backed param (`{ field, objectOverride }`) was mapped by hand in
 * plugin-grid's `toBulkParam` — never against the field definition — and drew a
 * raw text box where the record dialog drew the record picker.
 *
 * It moved here because this is the one package BOTH sides already depend on
 * that holds everything the resolver reads: `@object-ui/core` (the
 * `ActionParamDef` it emits and the reference-bearing family), this package's
 * {@link resolveFormWidgetType} (the widget fold `resolveParamWidgetType` asks)
 * and `@objectstack/spec` (the inline per-locale label). Nothing app-shell-local
 * came with it except that three-row param alias table. Both dialogs now call
 * these functions; ⛔ never a second copy of the resolution logic on either side.
 *
 * AUTHORING vs RESOLVED is the load-bearing distinction here, and the two
 * vocabularies are not interchangeable (objectui#3174). What an author may
 * write is exactly the spec's `ActionParamSchema` key set — mirrored by
 * `@object-ui/types`' `ActionParam` and by {@link RawActionParam} below. What
 * this function EMITS is `@object-ui/core`'s `ActionParamDef`, whose picker
 * group (`referenceTo`, `displayField`, …) exists only after resolution.
 * Authoring a resolved-side key is a mistake in every direction — `tsc`
 * rejects it, the server's `.strict()` parse rejects it, and this resolver
 * names it via {@link RESOLVED_ONLY_PARAM_KEYS} rather than reading it.
 */
import { EXPANDABLE_FIELD_TYPES, toPredicateRecord } from '@object-ui/core';
import type { ActionParamDef, ActionParamOption } from '@object-ui/core';
// The form's widget fold. Imported from the barrel this module is re-exported
// by — a cycle in the SOURCE graph only, and a call-time one: nothing at this
// module's top level reads it, and the published bundle is a single file.
import { resolveFormWidgetType } from './index.js';
// The field's help line, read in the one order the record form reads it in.
import { fieldHelpText } from './fieldHelpText.js';
import type { I18nLabel } from '@objectstack/spec/ui';
// Aliased per PR #4169's convention — app-shell has its OWN `resolveI18nLabel`
// (renamed `resolveKeyedI18nLabel` by objectui#4167) over the translation-KEY
// vocabulary, which does not accept the inline per-locale map this resolves.
import { resolveI18nLabel as resolveInlineI18nLabel } from '@objectstack/spec/ui';

/**
 * The bundler-replaced `process.env.NODE_ENV` idiom the dev-only warnings below
 * read, declared for THIS module only. This package's source program carries no
 * node typings on purpose — a browser library, the same stance and the same
 * reasoning as `@object-ui/components`' `browser-process-shim.d.ts`. Declared
 * here, module-scoped, rather than as a second ambient global, so it can never
 * shadow the real node global in a program that does load `@types/node` (the
 * defect that shim's header records). The runtime read is unchanged from when
 * this module lived in app-shell: a consumer's bundler replaces it.
 */
declare const process: { env: { NODE_ENV?: string } };

/**
 * Param-only type spellings the dialog historically accepted, folded onto the
 * canonical form widget vocabulary. These are legacy dialect entries kept for
 * params already authored with them — new params should use spec `FieldType`
 * values directly.
 */
const PARAM_TYPE_ALIASES: Record<string, string> = {
  checkbox: 'boolean',
  reference: 'lookup',
  'datetime-local': 'datetime',
  // NOTE: spec's `autonumber` (vs the widget-map key `auto_number`) is folded
  // in the shared `mapFieldTypeToFormType`, so `resolveFormWidgetType` already
  // handles it — no param-only alias needed here.
};

/**
 * Resolve a param `type` to the form widget key that renders it — the fold from
 * a PARAM type spelling to its widget, the one alias table, read rather than
 * restated (see `isLookupResolvedType` below, and app-shell's `paramToField`,
 * which asks the same question one step later). Any type in `FORM_FIELD_TYPES`
 * resolves to itself (identity — asserted by app-shell's drift test); aliases
 * and unknown types resolve through the same fallback chain the form applies
 * (unknown → `text`).
 */
export function resolveParamWidgetType(paramType: string): string {
  return resolveFormWidgetType(PARAM_TYPE_ALIASES[paramType] ?? paramType);
}

/**
 * Resolved params keep raw `FieldType` values (`text` / `email` / `select` /
 * `file` / …), matching the `FieldType` enum in `@objectstack/spec`. **Do
 * not** translate into the FormField widget vocabulary (`field:select`, …)
 * here — `ActionParamDialog` owns that translation via its `paramToField()`
 * adapter (ADR-0059).
 */

/**
 * One option as AUTHORED on an action param — {@link ActionParamOption} with
 * the label on the authoring side of rc.6's `I18nLabel` widening.
 *
 * The distinction is the whole point of the authored/resolved split: an author
 * may write `{ value: 'high', label: { en: 'High', 'zh-CN': '高' } }`, and
 * `ActionParamDialog` reads `ActionParamOption.label` as a plain `string`. Left
 * un-narrowed, the map would ride an INLINE option list straight through to the
 * select widget (inline options pass through verbatim — see `resolvedOptions`),
 * and render as `[object Object]` with no diagnostic anywhere. So the two types
 * are kept apart and {@link resolveOptionLabels} is the one crossing point.
 *
 * Spelled out rather than `Omit<ActionParamOption, 'label'> & { … }`: `Omit`
 * over a type carrying `[key: string]: unknown` resolves `Exclude<keyof T,
 * 'label'>` back to `string | number`, so it drops `value`'s type AND keeps
 * `label` as `unknown` — the derivation silently erases exactly the two keys it
 * is supposed to be about.
 */
export type RawActionParamOption = {
  /** Authored label — a plain string, or rc.6's inline per-locale map. */
  label?: I18nLabel;
  value: string;
  /**
   * Everything else an option declares (`visibleWhen` / `color` / `icon` /
   * `disabled`), preserved verbatim — `fbc23e094`.
   */
  [key: string]: unknown;
};

/** Raw param as authored on a schema action (post-zod). */
export interface RawActionParam {
  name?: string;
  field?: string;
  objectOverride?: string;
  /**
   * Display label, as authored. `@objectstack/spec` 17.0.0-rc.6 widened
   * `I18nLabel` from `string` to `string | Record<string, string>`, so an
   * author may inline a per-locale map here
   * (`label: { en: 'Reason', 'zh-CN': '原因' }`) — the same widening the spec's
   * `ActionParamSchema.label` carries.
   *
   * This restatement is the load-bearing half (objectui#3174): when it drifts
   * from what `@object-ui/types`' `ActionParam` says an author may write, this
   * resolver stops accepting the public authoring type. That drift is exactly
   * what a widened `I18nLabel` produced, and it is why the fix belongs on this
   * DECLARATION rather than on the test that surfaced it.
   *
   * `resolveActionParams` emits `ActionParamDef.label`, which is a plain
   * `string` — so the map is resolved on the way out (see {@link
   * ResolveActionParamsContext.locale}), never forwarded.
   */
  label?: I18nLabel;
  type?: string;
  required?: boolean;
  /**
   * Option list authored inline on the param. Speaks the same vocabulary as the
   * resolved side ({@link ActionParamOption}): the two keys this resolver reads
   * plus a catch-all for whatever else an option declares (`visibleWhen`,
   * `color`, `icon`, `disabled`) — `fbc23e094`.
   *
   * One key differs, and it is the same rc.6 widening as {@link
   * RawActionParam.label} one level down: an option's `label` is authored as
   * `I18nLabel` and RESOLVED to a `string` before it reaches
   * `ActionParamOption`. See {@link RawActionParamOption}.
   */
  options?: RawActionParamOption[];
  placeholder?: string;
  helpText?: string;
  defaultValue?: unknown;
  /** When true, seed defaultValue from the row record using the field name. */
  defaultFromRow?: boolean;
  /**
   * Carry-over declaration — the spec's `ActionParamSchema.carryOver`
   * (objectui#6246): seeded from the row, rendered read-only, submitted
   * verbatim. Copied onto `ActionParamDef.carryOver` unchanged on every branch
   * below; `ActionParamDialog` is what honours it.
   */
  carryOver?: boolean;
  /** Allow multiple values (file/image/lookup/user params → array value). */
  multiple?: boolean;
  /** Accepted upload types (MIME types / extensions) for `file`/`image` params. */
  accept?: string[];
  /** Max upload size in bytes for `file`/`image` params. */
  maxSize?: number;
  /**
   * Reference target for an INLINE `lookup`/`master_detail` param (objectstack-ai/objectstack#3405) —
   * the object whose records the picker searches. Field-backed params inherit
   * it from the referenced field instead (see `lookupExtras` below). Spelled
   * `reference` to match `FieldSchema.reference` / `ActionParamSchema.reference`.
   */
  reference?: string;
  /**
   * Visibility predicate (CEL) — mirrors the spec `ActionParamSchema.visible`.
   * The server serialises it through `ExpressionInputSchema` as an
   * `{ dialect, source }` envelope, so accept both the raw string and the
   * envelope. Propagated to `ActionParamDef.visible` so `ActionParamDialog`
   * can gate the param (e.g. hide `phoneNumber` unless `features.phoneNumber`).
   * Absent = always visible.
   */
  visible?: string | { dialect?: string; source?: string };
}

/**
 * The param's handle in the action payload — `name` wins, defaulting to the
 * field it binds.
 *
 * One of the two identity reads this module makes, and the reason both are
 * named functions rather than open-coded alternations: they are two LAYERS, not
 * two spellings of one (objectui#3104's inventory says so for this exact file).
 * Reading them through a single reader each is what keeps that distinction
 * legible — and keeps a third, accidental precedence from appearing the next
 * time someone needs a param's identity.
 *
 * NOT `columnIdentity()` from `@object-ui/core`: that reader is canonical-first
 * (`field` beats `name`) because a list COLUMN's identity is the object field it
 * shows. A param is the opposite — it is a slot in the payload that may bind a
 * field — so borrowing the column reader here would silently invert the
 * precedence and rename every field-backed param that also names itself.
 */
function paramName(param: RawActionParam): string | undefined {
  return param.name ?? param.field;
}

/**
 * The one crossing point from {@link RawActionParamOption} to
 * {@link ActionParamOption}: resolve each authored `label` — a plain string or
 * rc.6's inline per-locale map — to the single string the dialog renders.
 *
 * Everything else is preserved by spread, for the same reason
 * {@link normaliseOptions} preserves it (`fbc23e094`): rebuilding a fresh
 * `{ label, value }` silently drops `visibleWhen` / `color` / `icon` /
 * `disabled`. A label that resolves to nothing falls back to `value`, which is
 * what a bare-string option already means (`{ label: s, value: s }`).
 */
function resolveOptionLabels(
  options: RawActionParamOption[] | undefined,
  locale: string | undefined,
): ActionParamOption[] | undefined {
  if (!options) return undefined;
  // Identity-preserving fast path, and it is load-bearing rather than an
  // optimisation: `fbc23e094` pins that an INLINE option list reaches the
  // dialog *verbatim* — `toBe`, not `toEqual` — because the bug it closed was a
  // rebuild that dropped `visibleWhen`. A list with nothing to resolve is
  // therefore returned untouched, so that pin stays true as written; only a
  // list that actually carries a map is rebuilt, and then by spread.
  if (everyLabelResolved(options)) return options;
  return options.map((option) =>
    typeof option.label === 'string'
      ? (option as ActionParamOption)
      : {
          ...option,
          // `?? option.value` is what a bare-string option already means
          // (`{ label: s, value: s }`), and it is forced rather than chosen:
          // `ActionParamOption.label` is a required `string`.
          label: resolveInlineI18nLabel(option.label, locale) ?? option.value,
        },
  );
}

/** True when no option carries a label the dialog cannot render as-is. */
function everyLabelResolved(
  options: RawActionParamOption[],
): options is ActionParamOption[] {
  return options.every((option) => typeof option.label === 'string');
}

/**
 * The key a `defaultFromRow` param reads off the row record — `field` wins here,
 * because row data is keyed by OBJECT FIELD. The mirror image of
 * {@link paramName}, deliberately: same two keys, opposite question.
 */
function rowValueKey(param: RawActionParam): string | undefined {
  return param.field ?? param.name;
}

/**
 * Keys of the RESOLVED `ActionParamDef` that are not authorable on a raw param,
 * mapped to the prescription an author needs (objectui#3174).
 *
 * They are deliberately ABSENT from `RawActionParam` above rather than declared
 * and ignored: the whole defect this table exists for is that
 * `@object-ui/types`' public `ActionParam` declared them "for parity with the
 * resolved shape", so `{ name: 'account_id', type: 'lookup', referenceTo:
 * 'account' }` type-checked, lost its picker target here, and rendered as a
 * plain record-id text box. `ActionParamSchema` in `@objectstack/spec` is
 * `.strict()` and rejects every one of them at parse time — `referenceTo` by
 * name, with `reference` as the suggestion — so resolving them here would make
 * objectui accept metadata the platform itself refuses to store. That is a
 * second de-facto contract, not a kindness (AGENTS.md "contract-first"): such a
 * param would work in a locally-authored TS action and fail at publish.
 *
 * So the disposition is: recognise, name, and refuse — never silently drop, and
 * never quietly honour.
 */
export const RESOLVED_ONLY_PARAM_KEYS: Readonly<Record<string, string>> = (() => {
  const fromField =
    'It is inherited from the referenced field — make the param field-backed '
    + "(`{ field: '<lookup_field>' }`) to pick it up.";
  return {
    referenceTo:
      "Use `reference` instead — `reference: '<object>'` is the spec's spelling for an inline "
      + 'picker target, and the only one this resolver reads.',
    displayField: fromField,
    idField: fromField,
    descriptionField: fromField,
    titleFormat: fromField,
    lookupColumns: fromField,
    lookupFilters: fromField,
    lookupPageSize: fromField,
    dependsOn: fromField,
  };
})();

/**
 * Dev-mode guard: name any resolved-only key an author put on a raw param.
 *
 * `tsc` already rejects these against `@object-ui/types`' `ActionParam`, and the
 * server rejects them at parse. This covers the gap between the two — params
 * authored in plain JS, loaded from JSON, or synthesised at runtime — so the
 * mistake is loud wherever it enters, instead of surfacing downstream as
 * `paramToField()`'s "no reference target" warning naming a key the author never
 * wrote (which is how objectui#3174 read from the author's seat).
 */
function warnResolvedOnlyKeys(param: RawActionParam): void {
  if (process.env.NODE_ENV === 'production') return;
  const raw = param as unknown as Record<string, unknown>;
  for (const key of Object.keys(RESOLVED_ONLY_PARAM_KEYS)) {
    if (raw[key] === undefined) continue;
    console.warn(
      `[resolveActionParams] Param "${paramName(param) ?? '(unnamed)'}" declares \`${key}\`, `
        + 'which is not an authorable action-param key: it belongs to the RESOLVED `ActionParamDef`, '
        + "`@objectstack/spec`'s `ActionParamSchema` rejects it at parse time, and this resolver ignores it. "
        + RESOLVED_ONLY_PARAM_KEYS[key],
    );
  }
}

/** Field metadata as exposed by `useMetadata().objects[].fields`. */
interface RuntimeField {
  type?: string;
  label?: string;
  required?: boolean;
  placeholder?: string;
  /**
   * `@objectstack/spec`'s `FieldSchema.inlineHelpText`, the help line drawn
   * under the field's control (objectui#12213). Read first for a field-backed
   * param's `helpText`, through `fieldHelpText`, the read the record form
   * shares.
   */
  inlineHelpText?: string;
  /**
   * The help line's fallback, read second through `fieldHelpText`. An
   * objectstack server on `@objectstack/spec` 17.7.0 or later serves a field's
   * translated help text here.
   */
  description?: string;
  /**
   * The field's own option list — `select` / `radio` / `checkboxes` metadata as
   * `@objectstack/spec`'s `SelectOptionSchema` declares it, so entries may carry
   * `visibleWhen` / `color` / `icon` / `disabled` alongside label and value. A
   * bare string is shorthand for `{ label: s, value: s }`.
   */
  options?: Array<ActionParamOption | string>;
  multiple?: boolean;
  defaultValue?: unknown;
  // ── Upload widget config (file/image fields) ──
  accept?: string[];
  maxSize?: number;
  // ── Lookup-specific metadata (preserved when resolving lookup params) ──
  //
  // ⭐ objectui#7435 — three members are declared here in the spelling
  // `@objectstack/spec`'s `FieldSchema` DECLARES, alongside the snake twins
  // this interface already carried. They are not new metadata: they are the
  // only spelling a spec-compliant author can emit and the one
  // `getObjectSchema` serves, and until this change no camel spelling could be
  // read off a resolved field def at all. MEASURED on the pin resolved here,
  // `@objectstack/spec@17.4.0` — `FieldSchema.safeParse` ACCEPTS
  // `displayField` / `descriptionField` / `lookupFilters` and REFUSES every
  // snake twin below with `unrecognized_keys`, controls lit in the same run.
  //
  // ⭐ objectui#7435 second slice — `lookupColumns` and `lookupPageSize` join
  // them on the same measurement, re-taken on the pin this tree resolves:
  // `FieldSchema.safeParse` ACCEPTS both camel spellings and REFUSES
  // `lookup_columns` / `lookup_page_size` with `unrecognized_keys`, with the
  // minimal lookup def ACCEPTED and `zzz_not_a_real_key` REJECTED as controls
  // in the same run.
  //
  // ⛔ `id_field` and `title_format` deliberately gain NO camel twin. Measured
  // on that same pin, `FieldSchema` refuses `idField` exactly as it refuses
  // `id_field` (the spec's only `idField` is on `InlineGridColumnSchema`, a
  // different shape), and `titleFormat` is an OBJECT-level key whose canonical
  // target carries an ADR-0079 deprecation toward `nameField`. Declaring either
  // camel spelling here would fossilise a spelling no contract declares —
  // the exact defect this family exists to stop. Routed to objectui#7650.
  //
  // ⭐ objectui#8672, ruling A — `dependsOn` is now declared in the SPEC
  // spelling and ONLY in it. Unlike the five keys above it gains no snake twin
  // to rank behind, because there was never a contractual reason for one:
  // `FieldSchema` DECLARES `dependsOn` and refuses `depends_on` by name. The
  // snake member this interface used to carry was the only spelling the read
  // site below looked at, so a spec-valid field def declaring the cascade
  // resolved to `undefined` while the one spelling that DID arrive was one no
  // author could legally write. That is not a producer leg worth keeping behind
  // the declared one — it is the inverse of one, and keeping it would be the
  // consumer-side tolerance AGENTS.md #0.1 bans.
  //
  // ⭐ objectui#11070 round 4 removed the `reference_to` member: nothing here
  // read it (the target is read as `reference` below), and ObjectUI no longer
  // writes or reads that spelling anywhere.
  //
  // ⭐ objectui#11070 round 6 removed the `display_field` member the same way:
  // `displayField` is now the only display spelling read below. A served def
  // loses nothing, because the ingestion fold (objectui#7650 ruling A) stamps a
  // stored `display_field` onto `displayField` on every object
  // `MetadataProvider` stores; only a host that hands this resolver its own,
  // unfolded `objects` loses the snake value.
  //
  // ⭐ objectui#12157 removed the `lookup_columns` and `lookup_page_size`
  // members on the same ground: `lookupColumns` / `lookupPageSize` are read
  // alone below, and the fold stamps either stored snake spelling onto its
  // declared key.
  reference?: string;
  displayField?: string;
  reference_field?: string;
  id_field?: string;
  descriptionField?: string;
  description_field?: string;
  title_format?: string;
  lookupColumns?: unknown[];
  lookupFilters?: unknown[];
  lookup_filters?: unknown[];
  lookupPageSize?: number;
  dependsOn?: unknown[];
}

interface RuntimeObject {
  name?: string;
  fields?: Record<string, RuntimeField>;
}

export interface ResolveActionParamsContext {
  /** Default object name when a param's `objectOverride` is absent. */
  objectName: string;
  /** All known runtime objects (`useMetadata().objects`). */
  objects: RuntimeObject[];
  /** i18n resolver — `useObjectLabel().fieldLabel`. */
  fieldLabel: (objectName: string, fieldName: string, fallback: string) => string;
  /** Optional option-label translator — `useObjectLabel().fieldOptionLabel`. */
  fieldOptionLabel?: (
    objectName: string,
    fieldName: string,
    optionValue: string,
    fallback: string,
  ) => string;
  /**
   * Row record providing default values for params with `defaultFromRow` set.
   * Used by list_item actions (edit/delete dialogs) so the dialog opens with
   * the row's current values pre-filled.
   */
  row?: Record<string, unknown>;
  /**
   * Active UI language (BCP-47) used to resolve an inline per-locale
   * {@link RawActionParam.label} down to the one string `ActionParamDef.label`
   * can carry. Both callers thread `useObjectTranslation().language`.
   *
   * Optional and nullish-tolerant: omitted means "no locale known", which the
   * spec's resolver documents as resolving to `en`. It is a context field
   * rather than a hook read because this is a pure function — the caller is
   * the component that already knows the language.
   */
  locale?: string;
}

/**
 * Normalise a field's option list for a param: expand bare strings into
 * `{ label, value }` and translate each label through `fieldOptionLabel`.
 *
 * Those are the only two jobs. Everything else the option declares is
 * PRESERVED, not rebuilt (`fbc23e094`): this used to return a fresh
 * `{ label, value }` per entry, which silently dropped a field's per-option
 * `visibleWhen` — so a select field whose options narrow by predicate in the
 * object form (`resolveVisibleOptions()` in `@object-ui/core`, ADR-0058 /
 * #2284) offered the FULL list, predicate-hidden entries included, the moment
 * an action param inherited that field via `{ field: '<name>' }`. Same field
 * metadata, two surfaces, two behaviours, no diagnostic anywhere. `color` /
 * `icon` / `disabled` were lost the same way.
 *
 * Only the field-inherited branch ever came through here; options authored
 * inline on the param always passed through verbatim (see `resolvedOptions`
 * below), which is precisely the asymmetry this restores.
 */
function normaliseOptions(
  options: Array<ActionParamOption | string> | undefined,
  objectName: string,
  fieldName: string,
  optionLabel?: ResolveActionParamsContext['fieldOptionLabel'],
): ActionParamOption[] | undefined {
  if (!Array.isArray(options) || options.length === 0) return undefined;
  return options.map((o) => {
    const raw: ActionParamOption = typeof o === 'string' ? { label: o, value: o } : o;
    const label = optionLabel
      ? optionLabel(objectName, fieldName, raw.value, raw.label)
      : raw.label;
    return { ...raw, label, value: raw.value };
  });
}

/**
 * Flatten a param `visible` predicate to a plain CEL string. The spec's
 * `ExpressionInputSchema` normalises the authored string into an
 * `{ dialect, source }` envelope, so unwrap `.source`; a raw string passes
 * through untouched. Empty / absent → `undefined` (always visible).
 */
function normaliseVisible(visible: RawActionParam['visible']): string | undefined {
  if (typeof visible === 'string') return visible || undefined;
  if (visible && typeof visible === 'object' && typeof visible.source === 'string') {
    return visible.source || undefined;
  }
  return undefined;
}

/**
 * The row a `defaultFromRow` param is seeded from, in its STORED form
 * (objectui#13271).
 *
 * A list surface reads its rows with `$expand` on the relations it shows, and
 * the server replaces a relation's id IN PLACE with the related record. Copied
 * verbatim, that record became the param's value and went out on the wire: a
 * `lookup` param submitted a whole `sys_user` record where the endpoint expects
 * its id, which is what Setup → Teams → Remove from Team answered 400 to. The
 * value contract is the id (`@objectstack/spec` `field-value.zod.ts`: the
 * expanded record is the READ shape and is never stored).
 *
 * So the row goes through `toPredicateRecord`, the one rule that binds a
 * fetched record the way the server stores it, and the rule the predicate and
 * Undo paths (`captureUpdateUndoData`, objectui#11122) already use: a field the
 * row's object DECLARES relational collapses to its id, element-wise for a
 * `multiple` one, and every other field is left exactly as the row carries it.
 * It is decided by the object's field types, never by the value's shape: a
 * `json` field may hold an object with an `id`, and that object is its value.
 *
 * The row is a record of `ctx.objectName` (the action's own object — both
 * callers resolve against it), so that object's fields name the relations; an
 * `objectOverride` names where a param's field METADATA is read, not what the
 * row is. Without that object in `ctx.objects` nothing is collapsed — a caller
 * that cannot name the relations must not guess — and the seed is the row's
 * value as before. Display is unaffected: the picker hydrates an id to its
 * record's name.
 */
function storedRow(
  row: Record<string, unknown>,
  ctx: ResolveActionParamsContext,
): Record<string, unknown> {
  const rowObject = ctx.objects.find((o) => o?.name === ctx.objectName);
  return toPredicateRecord(row, rowObject?.fields);
}

/**
 * Resolve a single raw param against object metadata. Inline params pass
 * through (with safe defaults); field-backed params inherit from the
 * referenced field and accept inline overrides on top.
 */
export function resolveActionParam(
  param: RawActionParam,
  ctx: ResolveActionParamsContext,
): ActionParamDef {
  // Off-spec resolved-side keys are named here, at the authoring boundary,
  // before anything downstream can mistake the resulting gap for partial
  // metadata (objectui#3174).
  warnResolvedOnlyKeys(param);

  /** Row-context default: when `defaultFromRow` and a row is present, the
   *  param's defaultValue is the row's STORED value at {@link rowValueKey}. */
  const rowKey = rowValueKey(param);
  const rowDefault =
    param.defaultFromRow && ctx.row && rowKey != null && Object.prototype.hasOwnProperty.call(ctx.row, rowKey)
      ? storedRow(ctx.row, ctx)[rowKey]
      : undefined;

  /**
   * The authored label, resolved to the one string `ActionParamDef` carries.
   *
   * `?? param.name` / `?? ctx.fieldLabel(…)` keeps working unchanged: the
   * resolver answers `undefined` for an absent label AND for a map no limb
   * matched, and returns `''` verbatim for an authored empty string — which is
   * what `param.label ?? …` did before, since `''` is not nullish.
   */
  const authoredLabel = resolveInlineI18nLabel(param.label, ctx.locale);
  /** Inline options, with each authored label narrowed to the resolved side. */
  const authoredOptions = resolveOptionLabels(param.options, ctx.locale);

  // Inline param — no field reference, just normalise.
  if (!param.field) {
    return {
      name: param.name ?? '',
      label: authoredLabel ?? param.name ?? '',
      type: param.type ?? 'text',
      required: param.required ?? false,
      options: authoredOptions,
      placeholder: param.placeholder,
      helpText: param.helpText,
      defaultValue: rowDefault ?? param.defaultValue,
      visible: normaliseVisible(param.visible),
      // This output is built key by key, so an authored key that is not
      // copied here never reaches the dialog — which is how `carryOver` went
      // unhonoured until objectui#6246. Same line on the two branches below.
      carryOver: param.carryOver,
      multiple: param.multiple,
      accept: param.accept,
      maxSize: param.maxSize,
      // Inline picker target (objectstack-ai/objectstack#3405). Without this an inline `lookup` param
      // could never reach `<LookupField>` — `paramToField()` degrades a
      // targetless picker to a raw record-id text input.
      referenceTo: param.reference,
    };
  }

  const ownerName = param.objectOverride ?? ctx.objectName;
  const owner = ctx.objects.find((o) => o?.name === ownerName);
  const field: RuntimeField | undefined = owner?.fields?.[param.field];

  if (!field) {
    // The backing field is NOT in the metadata this resolver was given, so the
    // param's type, its options and — for a picker — its object binding are all
    // unknown. `type: param.type ?? 'text'` below is a LAST-RESORT shape, not a
    // resolution: a field-backed `{ field: 'contract_type' }` param declaring no
    // inline `type` becomes a `text` param here, which is how a lookup param
    // reached the user as an unannotated empty box with no dropdown and no
    // request for the referenced object on the wire (`6cc910b6d`).
    //
    // ⭐ That shape stays — a partially-cached environment must not crash — but
    // it no longer travels ANONYMOUSLY. `unresolvedField` names the pair that
    // could not be resolved, and `ActionParamDialog` refuses on it rather than
    // offering a box no human can fill. Without this key the degradation is
    // undetectable downstream: by the time `paramToField()` sees the param it
    // is a `text` param, so `paramDegradesWithoutTarget()` answers false and
    // even the objectstack-ai/objectstack#3405 "paste a record id" hints do not fire.
    //
    // ⛔ The warning is NOT gated on the param's type. "Which widget did this
    // want?" is exactly the question that cannot be answered here, so gating on
    // `lookup` would stay silent for the reported case, whose param names no
    // inline type at all.
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[resolveActionParams] Param "${paramName(param) ?? param.field}" is field-backed `
          + `(\`{ field: '${param.field}' }\`) but \`${ownerName}.${param.field}\` is not in the `
          + 'object metadata this resolver was given, so its type, options and picker target are '
          + 'all unknown. The action dialog refuses the param instead of rendering an input for a '
          + 'contract it cannot read. Check the field name, the owning object (`objectOverride`), '
          + 'and that the object metadata has loaded.',
      );
    }
    return {
      unresolvedField: `${ownerName}.${param.field}`,
      name: paramName(param) ?? param.field,
      label: authoredLabel ?? ctx.fieldLabel(ownerName, param.field, param.field),
      type: param.type ?? 'text',
      required: param.required ?? false,
      options: authoredOptions,
      placeholder: param.placeholder,
      helpText: param.helpText,
      defaultValue: rowDefault ?? param.defaultValue,
      visible: normaliseVisible(param.visible),
      carryOver: param.carryOver,
      multiple: param.multiple,
      accept: param.accept,
      maxSize: param.maxSize,
      // The field is unresolvable, so an inline `reference` is the only picker
      // target available — keep it rather than dropping to a text input.
      referenceTo: param.reference,
    };
  }

  const resolvedType = param.type ?? field.type ?? 'text';
  const resolvedOptions = authoredOptions
    ?? normaliseOptions(field.options, ownerName, param.field, ctx.fieldOptionLabel);
  const resolvedLabel = authoredLabel
    ?? ctx.fieldLabel(ownerName, param.field, field.label ?? param.field);

  /** Lookup/reference params carry extra picker config that the dialog
   *  forwards to `<LookupField>`. Without these the picker would fall back
   *  to a plain text input. */
  // Which params are reference-bearing is NOT restated here. It is
  // `EXPANDABLE_FIELD_TYPES` in `@object-ui/core` — the one relational family
  // (objectui#4770 / #4790 / #4815 / #5312 / #5692) — asked over the widget key
  // `resolveParamWidgetType()` folds this spelling onto. That is deliberately
  // the SAME expression `paramToField()` evaluates one step later: this half
  // POPULATES the picker group below and that half FORWARDS it to the widget,
  // so a divergence between them silently drops a picker's config. Asking the
  // one question through the one alias table is what makes them agree
  // mechanically rather than by hand (objectui#5874).
  //
  // The literal that stood here diverged from the family in BOTH directions,
  // and on THREE members rather than the two its three sibling faces missed:
  //
  //  - it lacked `master_detail`, `user` and `tree`. A field-backed param over
  //    any of them inherited NO picker config, so `paramToField()` then found
  //    no `referenceTo` and degraded the param to a plain record-id text input
  //    — the unexplained "paste a UUID" box objectui#3405 exists to prevent.
  //    Gaining them RESTORES the rule this block states; it does not widen it.
  //  - it carried `reference`, and that spelling survives the change: the fold
  //    is where it belongs (`PARAM_TYPE_ALIASES` at the top of this file keeps it
  //    as a legacy param dialect, folded to `lookup`), not hand-copied into a
  //    membership test. Measured, not assumed — `reference` is refused by
  //    `ActionParamSchema` and absent from `@objectstack/spec`'s `FieldType`,
  //    with `lookup` / `master_detail` / `user` / `tree` accepted as live
  //    controls and retired `owner` plus a nonsense spelling refused as dead
  //    ones — so it is undeclarable, but the dialog still ACCEPTS it from
  //    params already authored with it, and that acceptance is the alias
  //    table's to state, once.
  //
  // Pinned by an identity spy on that `has`, so a member-identical private copy
  // fails rather than quietly re-forking. Never
  // `new Set([...EXPANDABLE_FIELD_TYPES, ...])`.
  const isLookupResolvedType = EXPANDABLE_FIELD_TYPES.has(
    resolveParamWidgetType(resolvedType),
  );
  const lookupExtras: Partial<ActionParamDef> = isLookupResolvedType
    ? {
        // Inline `reference` wins, matching how every other inline value
        // overrides the resolved field (objectstack-ai/objectstack#3405).
        // ⚠️ objectui#6837 half 2: the READ narrows to `reference` (the only
        // spelling the protocol declares — `FieldSchema` refuses `reference_to`
        // by name). The EMITTED key is unchanged: it is what this emit's TARGET
        // contract declares, and renaming it would be a separate change.
        // Source here is `owner.fields[param.field]` — an object schema field def,
        // i.e. the protocol. Target contract: `ActionParamDef.referenceTo`.
        // objectui#7642 CENSUS — verdict KEEP. The in-file provenance note above is
        // CORRECT (`ctx.objects` is `useMetadata().objects`, the `/api/v1/meta/object`
        // documents), so this really is the object-schema def. It is still kept: the
        // serve path runs no parse, so retiring a snake read deletes the only read
        // of an authorable key. (That census sentence used to add "and none of the
        // four reads below has a camel leg" — objectui#7435 made that half false for
        // three of them, and its second slice for `lookup_columns` and
        // `lookup_page_size` too; the KEEP verdict it supports is unchanged.)
        //
        // ⭐ objectui#7435 — the DECLARED spelling is ranked FIRST on the three
        // keys that have one. Every read here used to be snake-only, so the
        // camelCase values `getObjectSchema` serves were silently dropped and
        // the param rendered with picker defaults. The snake legs are KEPT
        // behind the declared one, in their pre-existing order: a per-site
        // producer sweep found no in-repo producer of them, but neither of the
        // two producers that can still emit them is covered by that sweep — a
        // document stored before the key was tightened (the serve path runs no
        // parse — objectui#7650) and a host adapter outside this repo. Dropping
        // a leg is a retirement with its own evidence, not a side effect here.
        // (`display_field` has since had that retirement — objectui#11070
        // round 6, below.)
        //
        // ⭐ objectui#7435 second slice — `lookupColumns` and `lookupPageSize`
        // get the same treatment, on the same re-taken measurement. Both are
        // pure picker CONFIG: the value they carry changes what the picker
        // shows, never whether it can be opened.
        //
        // ⛔ `idField` and `titleFormat` keep their snake-only reads on purpose
        // — see {@link RuntimeField}. Neither has a `FieldSchema` spelling to
        // rank first, so there is nothing to add that would not fossilise an
        // undeclared key.
        //
        // ⭐ objectui#8672, ruling A — `dependsOn` is the third declared key of
        // that slice and it lands here now, in the DECLARED spelling and with
        // no snake leg behind it. It was held back deliberately: honouring the
        // spec spelling while `ActionParamDialog` fed `dependentValues` to
        // option widgets only would have turned every spec-valid def that
        // declares a cascade into a `lookup-trigger-gated`, permanently
        // DISABLED picker — a measurement objectui#9130 built, rendered and
        // then refused to ship, routing the disposition to objectui#8672.
        //
        // The dialog now supplies that record (see `paramNeedsDependentValues`
        // in app-shell's `views/ActionParamDialog.tsx`), so the gate lifts as soon as the
        // named parent carries a value and `LookupField` narrows the picker by
        // it. The two halves ship together on purpose: either alone is a
        // regression, and this comment is the reason they may not be split
        // again.
        //
        // ⛔ The snake read is GONE rather than demoted, which is where this
        // key departs from the siblings above that keep one. Their snake legs
        // are kept because a pre-tightening document or an out-of-repo host
        // adapter could still emit them. `depends_on` has no such producer to
        // protect: `FieldSchema` refuses it BY NAME (suggesting `dependsOn`), so
        // no document that parses can carry it, and objectui#7357 already
        // retired the renderer-side twin in `LookupField`. Keeping it would
        // leave this resolver the last reader of a spelling the protocol rejects.
        //
        // ⭐ objectui#11070 round 6 — `displayField` reads its declared spelling
        // alone too: the `display_field` leg is retired, with no alias. The
        // pre-tightening document that leg was kept for is now covered by the
        // ingestion fold (objectui#7650 ruling A stamps a stored
        // `display_field` onto `displayField` on every object `MetadataProvider`
        // stores), so a served def loses nothing. A host that hands this
        // resolver its own, unfolded `objects` does lose the snake value; the
        // round's changeset states that break. `reference_field` keeps its
        // place behind it: `FieldSchema` declares no twin the fold could stamp
        // it onto, so the fold leaves it on the def as served.
        //
        // ⭐ objectui#12157 — `lookupColumns` and `lookupPageSize` read their
        // declared spelling alone too, on the same ground as `displayField`:
        // the `lookup_columns` / `lookup_page_size` legs are retired, with no
        // alias, and `LookupField` retired its own reads of them in the same
        // change. A def served through the fold loses nothing; a host that
        // hands this resolver its own, unfolded `objects` loses the snake value.
        referenceTo: param.reference ?? field.reference,
        displayField: field.displayField ?? field.reference_field,
        idField: field.id_field,
        descriptionField: field.descriptionField ?? field.description_field,
        titleFormat: field.title_format,
        lookupColumns: field.lookupColumns,
        lookupFilters: field.lookupFilters ?? field.lookup_filters,
        lookupPageSize: field.lookupPageSize,
        dependsOn: field.dependsOn,
      }
    : {};

  return {
    name: paramName(param) ?? param.field,
    label: resolvedLabel,
    type: resolvedType,
    required: param.required ?? field.required ?? false,
    options: resolvedOptions,
    placeholder: param.placeholder ?? field.placeholder,
    // The param's own `helpText` first; else the help line the field draws
    // under its control on the record form, through the one read the record
    // form shares (`fieldHelpText`, objectui#12213): the spec's
    // `inlineHelpText`, then `description`, an empty string reading as absent.
    // A served `help` key is not read.
    helpText: param.helpText ?? fieldHelpText(field),
    defaultValue: rowDefault ?? param.defaultValue ?? field.defaultValue,
    visible: normaliseVisible(param.visible),
    // A declaration of the PARAM, never inherited from the field.
    carryOver: param.carryOver,
    // Widget config inherited from the field for every type (not just
    // lookup): multi-value shape and upload constraints (ADR-0059).
    multiple: param.multiple ?? field.multiple,
    accept: param.accept ?? field.accept,
    maxSize: param.maxSize ?? field.maxSize,
    ...lookupExtras,
  };
}

/**
 * Union the objects a CALLER holds with the ones the console's metadata store
 * holds, caller first — the object list `resolveActionParams()` should be given.
 *
 * ## Why a union and not simply the store (`6cc910b6d`)
 *
 * The two lists answer different questions and neither contains the other.
 * The caller's list is the world that caller is rendering: `ObjectView` passes
 * the full published set, `DeclaredActionsBar` passes the ONE object it is
 * drawing a toolbar for, `ConsoleShell`'s root runtime passes none, and a
 * preview/draft host passes an overlaid world whose defs deliberately differ
 * from the published ones. The store's list is every object the session has
 * loaded. A caller that carries a def must keep it — replacing it would make a
 * draft overlay render its published twin — so the caller is ranked FIRST and
 * `resolveActionParam`'s `find()` takes the first match by name.
 *
 * What the store adds is the objects the caller never had: the owner of a
 * `{ field }` param dispatched from a surface that is not scoped to that object
 * at all, and the `objectOverride` target of a cross-object param. Before this,
 * such a param resolved against a list that could not contain its owner and
 * degraded — for a field-backed param, which carries no inline `type`, into a
 * bare `text` param: an empty box, no dropdown, no request for the referenced
 * object on the wire, while the identical field rendered a real picker on a
 * record form off this very store.
 *
 * ⛔ Not a lenient fallback in the AGENTS.md #0.1 sense: no dialect is being
 * tolerated and no shape coerced. The metadata is spec-compliant and already in
 * the client; this is the seam that was not handing it over.
 *
 * Pure, and deduplicated by object `name` so a def cannot be resolved twice.
 * Entries with no usable `name` are carried through from the caller's list
 * (they are that caller's business) and skipped from the store's.
 */
export function withKnownObjects<T>(
  supplied: readonly T[] | undefined,
  stored: readonly T[] | undefined,
): T[] {
  const nameOf = (o: T): string | undefined => {
    const name = (o as { name?: unknown } | null | undefined)?.name;
    return typeof name === 'string' && name ? name : undefined;
  };
  const out: T[] = Array.isArray(supplied) ? [...supplied] : [];
  const seen = new Set<string>();
  for (const o of out) {
    const name = nameOf(o);
    if (name) seen.add(name);
  }
  if (!Array.isArray(stored)) return out;
  for (const o of stored) {
    const name = nameOf(o);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(o);
  }
  return out;
}

/** Resolve an array of raw action params. */
export function resolveActionParams(
  params: RawActionParam[] | undefined,
  ctx: ResolveActionParamsContext,
): ActionParamDef[] {
  if (!Array.isArray(params)) return [];
  return params.map((p) => resolveActionParam(p, ctx));
}
