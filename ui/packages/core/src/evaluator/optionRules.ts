/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Client-side resolution of per-option visibility for `select` / `radio` /
 * `multiselect` fields — cascading (dependent) options and role/context gating.
 *
 * An option carries an optional `visibleWhen` CEL predicate; the option is
 * offered only when it evaluates TRUE against the live record + `current_user`
 * (the SAME engine and binding environment as a field-level `visibleWhen`, via
 * {@link evalFieldPredicate}). This expresses both:
 *   - cascades — `record.country == 'cn'` (the dependent list narrows as the
 *     controlling field changes), and
 *   - role/context gating — `'admin' in current_user.positions`.
 *
 * A field declares which sibling fields its option list reacts to via
 * `dependsOn` (aligns with `@objectstack/spec` Field.dependsOn — the same knob
 * lookups use). While any dependency is empty the list is *gated*: we surface a
 * "select the parent first" hint instead of an unfiltered set, mirroring the
 * dependent-lookup UX (#2215).
 *
 * Evaluation is fail-open (a broken/absent predicate keeps the option) — the
 * same safe default as field visibility. Client-side hiding is UX, not a
 * security boundary: when an option is gated for access-control reasons the
 * server must also reject writes of its value.
 */
import type { DependsOnInput } from '@object-ui/types';
import { evalFieldPredicate, type FieldRulePredicate } from './fieldRules.js';
import { isEmptyValue } from '../utils/emptiness.js';

/**
 * Minimal shape of a select/radio option this module reads. Deliberately has no
 * index signature so richer option types (`SelectOption`, `SelectOptionMetadata`)
 * remain structurally assignable — the helpers only read `value`/`visibleWhen`.
 */
export interface OptionLike {
  label: string;
  /** Widened with `SelectOption.value` (#3090): the option engines treat the
   * value opaquely (gate/filter by `visibleWhen`, compare by identity), so a
   * numeric/boolean authored value flows through unchanged. */
  value: string | number | boolean;
  /** Per-option visibility predicate (CEL). Omit = always available. */
  visibleWhen?: FieldRulePredicate;
}

/**
 * A field's `dependsOn` as authored — imported from `@object-ui/types`, where
 * `FormField.dependsOn` is declared with it (framework#4074; formerly a local
 * declaration that only the reader knew about, while the public
 * `FormField.dependsOn` said `string`). Re-exported for this module's existing
 * consumers.
 */
export type { DependsOnInput } from '@object-ui/types';

/**
 * Normalize a field's `dependsOn` to the list of sibling field names it reacts
 * to. The lookup-only `{field,param}` form contributes just its `field`.
 */
export function resolveDependsOnFields(dependsOn: DependsOnInput): string[] {
  if (!dependsOn) return [];
  const arr = Array.isArray(dependsOn) ? dependsOn : [dependsOn];
  return arr
    .map((d) => (typeof d === 'string' ? d : d && typeof d === 'object' ? d.field : null))
    .filter((f): f is string => typeof f === 'string' && f.length > 0);
}

// A dependency counts as UNMET on exactly the shared floor — `null`,
// `undefined`, the empty string, the empty array — and this module is where
// those four members were first written down. objectui#8496 promoted them out
// of here into `utils/emptiness.ts` (byte-for-byte the same four) so the four
// other surfaces that had each re-spelled them could stop. No extension and no
// declension: a gated option list asks the floor and nothing more.

/**
 * True when at least one `dependsOn` field is empty in the record — the option
 * list is gated and the widget should prompt for the parent rather than show an
 * unfiltered set. Returns false when there are no dependencies.
 */
export function isOptionGroupGated(
  dependsOn: DependsOnInput,
  record: Record<string, unknown>,
): boolean {
  const fields = resolveDependsOnFields(dependsOn);
  return fields.some((f) => isEmptyValue(record[f]));
}

/**
 * Filter options by their per-option `visibleWhen` predicate, evaluated against
 * the live `record` (+ optional `scope`, e.g. `{ current_user }`). Options with
 * no predicate are always kept; a predicate that errors fails open (kept).
 */
export function resolveVisibleOptions<T extends OptionLike>(
  options: readonly T[] | undefined | null,
  record: Record<string, unknown>,
  scope?: Record<string, unknown>,
): T[] {
  if (!options || options.length === 0) return [];
  return options.filter((o) =>
    o?.visibleWhen == null
      ? true
      : evalFieldPredicate(o.visibleWhen, record, true, undefined, scope, {
          context: `visibleWhen of option '${String(o.value)}'`,
        }),
  );
}

/**
 * The text an option widget SHOWS for one option: its `label`, or its `value`
 * when the label is blank (`20b507aff`).
 *
 * ## Why a blank label reaches a renderer at all — it is a LEGAL document
 *
 * This is deliberately NOT the lenient renderer fallback AGENTS.md #0.1
 * forbids. That rule governs metadata the contract REFUSES ("if the metadata
 * is off-spec, fix it at the producer"); an empty label is metadata the
 * contract ACCEPTS. Measured on the installed `@objectstack/spec` 18.1.0,
 * `SelectOptionSchema`:
 *
 *   { value: 'low', label: 'Low' } -> ACCEPT   (lit control)
 *   { value: 'low', label: '' }    -> ACCEPT   <- the key reading
 *   { value: 'low' }               -> REJECT invalid_type at [label]
 *
 * `@object-ui/types` mirrors that reading in prose on `SelectOptionBase`:
 * "An empty string is a valid label; an ABSENT one is not." So the producer
 * is right to emit `label: ''` — the field designer's `patchOptions` does,
 * under the ruling `f0f774b0d` landed, and a pin
 * (`ObjectFieldInspector.optionLabel.test.tsx`) fails if it ever invents
 * content to fill the hole instead. A document every layer calls legal has to
 * render as something a person can click.
 *
 * ## What the contract does NOT say, and who had already answered it
 *
 * The spec states no display default for a legal-but-blank label, so nothing
 * upstream decides this. objectui had nevertheless already decided it — on
 * HALF its read sites. Measured across the four option widgets before this
 * helper existed, with `{ value: 'low', label: '' }` authored and
 * `{ value: 'high', label: 'High' }` beside it as the lit control:
 *
 *   | widget      | readonly path      | interactive path |
 *   | select      | "low"              | ""               |
 *   | multiselect | "low"              | ""               |
 *   | radio       | "low"              | ""               |
 *   | checkboxes  | "low"              | ""               |
 *
 * Four summary paths spelled `opt?.label || value` and fell back; the four
 * interactive paths spelled `{opt.label}` and rendered nothing. So the same
 * option read "low" in a read-only form and blank in the editable one — the
 * bug was never "tolerate or refuse", it was a widget family disagreeing with
 * itself, and the blank half is the one a person has to click.
 *
 * This function is that decision written ONCE, the same "one definition, N
 * surfaces" move as {@link CASCADE_OPTION_WIDGET_TYPES} below. All eight sites
 * call it, so the two halves cannot drift apart again.
 *
 * ## Boundaries
 *
 * - Blank means TRIM-empty, so a whitespace-only label falls back too: it is
 *   the same invisible row to the person looking at it, and it is the
 *   spelling the producer's own reader already uses to call an authored
 *   `value` blank (`classifyOption`, `o.value.trim() === ''`).
 * - `label` is typed required, but this reads defensively because renderers
 *   are handed unvalidated runtime metadata: a non-string label must fall back
 *   rather than throw where `{opt.label}` merely rendered nothing.
 * - This changes DISPLAY only. It writes nothing, and it is not a licence to
 *   author blank labels — whether the contract should refuse them outright is
 *   a `packages/spec` question, not a renderer one.
 */
export function optionDisplayLabel(option: OptionLike): string {
  const { label } = option;
  return typeof label === 'string' && label.trim() !== '' ? label : String(option.value);
}

/**
 * Whether a scalar field value is still valid given the currently-visible
 * options — used to decide a cascade clear (parent changed, child's old choice
 * no longer offered). An empty value is always "valid" (nothing to clear).
 */
export function isValueStillOffered(
  value: unknown,
  visibleOptions: readonly OptionLike[],
): boolean {
  if (isEmptyValue(value)) return true;
  if (Array.isArray(value)) {
    // Multi-select: valid only when every selected value is still offered.
    return value.every((v) => visibleOptions.some((o) => o.value === v));
  }
  return visibleOptions.some((o) => o.value === value);
}

/** The resolved state of a cascading / role-gated option list. */
export interface CascadingOptions<T extends OptionLike> {
  /** Offered options after `visibleWhen` filtering. Empty while gated. */
  options: T[];
  /** True when a declared `dependsOn` field is empty — the list is gated. */
  gated: boolean;
  /** Normalized `dependsOn` field names (drives the "select the parent first" hint). */
  dependsOnFields: string[];
}

/**
 * Resolve an option field's offered set in one shot: normalize `dependsOn`,
 * decide whether the list is gated (a controlling field is still empty), and —
 * unless gated — filter by each option's `visibleWhen`. The single source of
 * truth behind the option widgets' `useCascadingOptions` hook and the form
 * renderer's inline pre-filter / cascade-clear, so gating and filtering can
 * never drift between them (#2715).
 *
 * `gated` is true only when there IS a `dependsOn` and one of its fields is
 * empty; a field with no `dependsOn` is never gated (its options are filtered
 * purely by `visibleWhen`). Callers format their own hint from `dependsOnFields`.
 */
export function resolveCascadingOptions<T extends OptionLike>(
  rawOptions: readonly T[] | undefined | null,
  record: Record<string, unknown>,
  dependsOn: DependsOnInput,
  scope?: Record<string, unknown>,
): CascadingOptions<T> {
  const dependsOnFields = resolveDependsOnFields(dependsOn);
  const gated = dependsOnFields.length > 0 && isOptionGroupGated(dependsOn, record);
  const options = gated ? [] : resolveVisibleOptions(rawOptions, record, scope);
  return { options, gated, dependsOnFields };
}

/**
 * Widget keys whose OFFERED option set is re-resolved against a live record by
 * {@link resolveCascadingOptions} — i.e. the allow-list of widgets a surface
 * must thread its live record to (`dependentValues`). Each of their options may
 * carry a `visibleWhen` predicate read against `record.*`, and the field may
 * declare a `dependsOn` gate (ADR-0058 / objectui#2284 / objectui#1583).
 * Without the record a cascading select never sees its controlling field and
 * stays permanently gated on the "select the parent first" hint.
 *
 * ## One definition, three surfaces (objectui#4770)
 *
 * Three surfaces feed this one evaluator, and each carried its own private copy
 * of these four keys until this constant existed — with no gate able to notice
 * them drifting apart on what "the record" means:
 *
 * - the object form — `CASCADE_OPTION_FIELD_TYPES` in
 *   `components/src/renderers/form/form.tsx` (the original);
 * - the single-record action dialog — `CASCADE_OPTION_WIDGET_TYPES` in
 *   `app-shell/src/views/ActionParamDialog.tsx` (objectui#3765 / PR #4756);
 * - the bulk action dialog — the same name in
 *   `plugin-grid/src/components/BulkActionDialog.tsx` (objectui#4757 / PR #4763).
 *
 * The set lives in `@object-ui/core`, next to the evaluator it describes,
 * because core is the one package all three already depend on — the form layer
 * cannot reach `@object-ui/fields` (that dependency runs the other way). Same
 * shape and same reason as `EXPANDABLE_FIELD_TYPES` in
 * `core/src/utils/expand-fields.ts`, the in-repo precedent for a form-layer
 * allow-table more than one surface reads. `@object-ui/fields` re-exports it
 * next to `resolveFormWidgetType` for discoverability — a re-export, never a
 * second definition.
 *
 * ## An ALLOW-LIST, not a blanket pass-through
 *
 * `dependentValues` is also the channel two widget-hint pickers read a specific
 * SIBLING KEY from (`filter-condition` reads `object_name`, `recipient-picker`
 * reads `recipient_type`), and the lookup family filters its query by it —
 * neither of which is an option list, so ⛔ no member is ever added to THIS set
 * to serve them. Each surface decides that separately, by OR-ing its own rule
 * beside this one, and they do not agree:
 *
 * - the object form has fed both families all along — `needsDataSourceWiring`,
 *   its own line beside the one that reads this set;
 * - the single-record action dialog feeds the lookup family since
 *   objectui#8672 ruling A — `paramNeedsDependentValues()`, same shape;
 * - the bulk action dialog feeds neither, and nothing has ruled on it.
 *
 * ⇒ objectui#4771 is the open boundary for the widget-hint pickers everywhere,
 * and for the lookup family on the bulk dialog. Stated here so the surfaces'
 * copies of the statement become one; ⛔ do not read a member of this set as
 * the answer to "does widget X get the record on surface Y".
 *
 * ## Normalization stays with the consumer
 *
 * The members are WIDGET keys — `resolveFormWidgetType` output in the two
 * dialogs, `normalizeFieldType` output (the `field:` prefix stripped) in the
 * form — not authored `type` spellings. Each consumer keeps its own
 * normalization; the two normalizations agree on these four members, which is
 * what makes one shared set safe to read from both.
 *
 * `select` + `multiple: true` is not listed separately: `SelectField` delegates
 * to `MultiSelectField` with the whole prop object, so the key it resolves
 * under (`select`) is the one that must carry the record.
 */
export const CASCADE_OPTION_WIDGET_TYPES: ReadonlySet<string> = new Set([
  'select',
  'multiselect',
  'radio',
  'checkboxes',
]);
