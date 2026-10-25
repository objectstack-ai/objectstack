/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { isInlineExcludedFieldType, isMaskedFieldType } from '@object-ui/fields';

/**
 * Field types the PLATFORM computes — the value is machine-owned and no user
 * write is legitimate. They carry a `reference` for relational metadata but
 * have no editor of their own.
 *
 * One set, three readers, so they cannot drift: `InlineFieldInput` renders them
 * as text instead of hijacking them into a record picker, and both editability
 * gates (`DetailSection`, `HeaderHighlight`) treat them as never inline-editable.
 * It lives beside `enrichDetailField` — deciding whether a column is
 * machine-computed is part of resolving a detail field's shape out of the view
 * entry plus the object schema, not the private business of any one component.
 * Re-exported from `InlineFieldInput` under its historical name.
 *
 * **Both spellings of the auto-number type are members** (objectui#4219).
 * `@objectstack/spec` — and the designer, and the importer — spell it
 * `autonumber`; `auto_number` is the widget map's key, and the alias table
 * (`fields/src/field-type-alias.ts`) maps both onto `field:auto_number`. This
 * set is matched by RAW spelling, so carrying one of them is carrying half the
 * type: `plugin-form` lists both in each of its non-input sets, and this is the
 * shape that was missing here. The gap was not academic — the reader that has
 * no host gate in front of it is `InlineFieldInput`'s reference fallback
 * (`!!field.reference && !TEXTUAL_REF_FALLBACK_TYPES.has(type)`), on
 * exported public API, so a spec-spelled auto-number carrying a `reference`
 * resolved into the RECORD PICKER — a list of records offered as replacements
 * for a machine-generated identity. The editability half of the same report is
 * held by the alias-aware shared exclusion since #4228; the two gates are a
 * union, and matching spellings is what stops that union's survivability from
 * depending on which spelling the metadata happens to use.
 */
export const TEXTUAL_REF_FALLBACK_TYPES = new Set([
  'formula',
  'summary',
  'rollup',
  'autonumber',
  'auto_number',
]);

/**
 * Is this field machine-computed, given the type authored on the view entry and
 * the type declared on the object schema?
 *
 * **Narrow-only — the answer is the UNION of the two.** Either type being
 * computed locks the field. An authored `type` is a DISPLAY override: it picks
 * the cell renderer and the editor, and that selection keeps its usual
 * precedence (`viewFieldType || objectFieldType`) everywhere else. It can
 * therefore only ever *narrow* editability, never widen it.
 *
 * Before objectui#3355 both gates resolved a single effective type with that
 * same display precedence, so an authored non-computed type ERASED the object's
 * computed declaration from the gate's view. The app that reported
 * objectstack-ai/objectstack#5077 ships `{ name: 'supply_share', type: 'number' }`
 * — a display override worked around objectstack#5066 — over a hook-maintained
 * ROLLUP, and the header chip became inline-editable: a user overwrote the
 * computed value by hand and it stayed corrupted until an unrelated child-row
 * touch re-fired the rollup (downstream yinlianghui/hotcrm-heimao#61).
 *
 * The object schema is authoritative about what is machine-owned; a
 * presentation override has no business granting write access. Narrowing still
 * works — an authored `type: 'formula'` locks a plain object column, which is
 * how a view declares "this column is computed elsewhere".
 */
export function isComputedFieldType(
  viewFieldType: unknown,
  objectFieldType: unknown,
): boolean {
  return (
    TEXTUAL_REF_FALLBACK_TYPES.has(viewFieldType as string) ||
    TEXTUAL_REF_FALLBACK_TYPES.has(objectFieldType as string)
  );
}

/**
 * Members of the fields package's `INLINE_EXCLUDED_FIELD_TYPES` that the DETAIL
 * editor nevertheless routes to a dedicated widget, and therefore keeps.
 *
 * The shared set is one list carrying several arguments, and only some of them
 * are about the value. The binary/attachment family is excluded there for a
 * GRID-cell reason — its own comment reads "edited from the record form, shown
 * read-only **in the grid**" — because a cell cannot host an upload dropzone.
 * A detail row can, and does: `InlineFieldInput` routes `image`/`avatar`/
 * `signature`/`file` (and the `video`/`audio` spellings of `file`) to the very
 * widgets the record form uses, added deliberately so inline edit could preview,
 * replace and remove files instead of showing a bare storage URL.
 *
 * `markdown` is exempt on the same footing (objectui#11541). The shared set
 * excludes it among the "Heavy / full editors — better in the record form than
 * a cell", which is again an argument about a CELL. #4228 kept it out of the
 * detail row for the reason it recorded there: "a one-line text box is lossy".
 * That box was the only editor the row then had for it — the terminal text
 * input, which is one line, so the browser strips every line break from the
 * value it is seeded with and the next keystroke writes the flattened text
 * back. A markdown value is a plain string, so a MULTI-line editor loses
 * nothing, and `InlineFieldInput` routes it to `TextAreaField`, the fields
 * package's multi-line widget (the one a `textarea` field edits with in the
 * record form and in a grid cell), never to that terminal input. The grid
 * keeps the exclusion for `markdown`. `html` and
 * `richtext` are not exempt: they stay excluded, unchanged.
 *
 * The credential and container members are excluded for a VALUE reason — masked
 * on read, or object-shaped — and that argument transfers to the detail page
 * verbatim, because the detail fallback is the same plain text input the grid's
 * is. Those stay excluded here.
 *
 * Every entry is pinned twice by `__tests__/inlineCredentialGate.test.tsx`: it
 * must be a real member of the shared set, and `InlineFieldInput` must really
 * render something other than the terminal text input for it. An exemption that
 * outlives its routing therefore fails, rather than silently re-opening the
 * plain-text path this gate exists to close.
 */
export const DETAIL_ROUTED_INLINE_TYPES = new Set<string>([
  'image',
  'avatar',
  'signature',
  'file',
  'video',
  'audio',
  'markdown',
]);

/**
 * Is this field one the fields package excludes from inline editing, given the
 * type authored on the view entry and the type declared on the object schema?
 *
 * The rule itself is NOT restated here — it is `isInlineExcludedFieldType()`
 * from `@object-ui/fields`, the same alias-aware contract the grid consults
 * (`plugin-grid/src/inline-edit-options.ts`). The detail hosts used to gate on
 * readonly / computed / system only, so `password` and `secret` — masked on
 * read, with no real value to seed an editor from — reached the terminal plain
 * text input, which rendered the mask as if it were the value and wrote it
 * straight back over the credential (objectui#4221). The container family
 * (`object`/`composite`/`record`/`grid`/`repeater`/`vector`) rode the same
 * fallback with an object-shaped value.
 *
 * **Narrow-only, like {@link isComputedFieldType}** — the answer is the UNION of
 * the two types, so an authored display `type` can lock a field but never
 * unlock one (objectui#3355). An `image` authored over an object `secret` stays
 * locked: the exemption is consulted per type, before the union.
 */
export function isInlineExcludedDetailFieldType(
  viewFieldType: unknown,
  objectFieldType: unknown,
): boolean {
  return isExcludedForDetail(viewFieldType) || isExcludedForDetail(objectFieldType);
}

function isExcludedForDetail(fieldType: unknown): boolean {
  if (typeof fieldType !== 'string') return false;
  if (DETAIL_ROUTED_INLINE_TYPES.has(fieldType)) return false;
  return isInlineExcludedFieldType(fieldType);
}

/**
 * Is this row's cell drawn as a mask, given the type authored on the view entry
 * and the type declared on the object schema?
 *
 * The rule itself is NOT restated here — it is `isMaskedFieldType()` from
 * `@object-ui/fields`, the package that owns the mask registrations
 * (objectui#8686). This file used to keep its own two-member copy of the
 * masked types (objectui#8440), documented as a mirror with two accepted
 * costs: a masked type added to the fields package would render masked and
 * stay copy-interactive here, and `registerFieldRenderer('password', …)`
 * could replace the mask at runtime without this copy seeing it. Reading the
 * authority closes both: a type the fields package masks, declared or
 * registered, refuses the copy here with no edit to this file. The same shape
 * {@link isInlineExcludedDetailFieldType} already has for the write direction.
 *
 * **Narrow-only, like {@link isComputedFieldType} and
 * {@link isInlineExcludedDetailFieldType}** — the answer is the UNION of the
 * two, so an authored display `type` can withdraw the copy affordance but never
 * restore it (objectui#3355). The direction matters here more than anywhere: an
 * object column declared `secret` keeps its refusal even when a view authors
 * `type: 'text'` over it, because a PRESENTATION override has no business
 * widening access to a credential. The declared cost of the union is the mirror
 * case — an object `text` column authored as `password` masks AND refuses the
 * copy, which is the same answer the cell already gives.
 */
export function isMaskedDetailFieldType(
  viewFieldType: unknown,
  objectFieldType: unknown,
): boolean {
  return isMaskedForDetail(viewFieldType) || isMaskedForDetail(objectFieldType);
}

function isMaskedForDetail(fieldType: unknown): boolean {
  return typeof fieldType === 'string' && isMaskedFieldType(fieldType);
}

/**
 * Object-metadata keys carried onto a detail-view field so the read cell and
 * the inline editor see the SAME resolved field shape the object form does.
 *
 * A `DetailViewField` only declares presentation (name / label / span / …), so
 * everything that configures a widget lives on the object schema. `DetailSection`
 * and `HeaderHighlight` each used to hand-copy their own subset, which drifted
 * repeatedly — numeric `min`/`max`/`step` were missing (objectui#2572), and the
 * relational block below was missing entirely, so a `multiple: true` lookup
 * rendered as a SINGLE-select picker in inline edit (picking one record replaced
 * the value and closed the popover, making multi-select impossible).
 *
 * Ordering is documentation only; the copy is key-by-key.
 */
export const ENRICHED_FIELD_METADATA_KEYS = [
  // Presentation / value formatting
  'options',
  'currency',
  // The SPEC channel for a per-field currency (a bare `currency` key is
  // designer/DB-only) — resolveFieldCurrency reads it second (#2548).
  'currencyConfig',
  'precision',
  'scale',
  // The author's digit-grouping hint, which overrides `scale`'s scale-0
  // heuristic in the number cell (objectui#11026).
  'useGrouping',
  // Numeric range/step constraints (objectui#2572 item 3).
  'min',
  'max',
  'step',
  'format',
  // Per-field widget override (ADR-0056 P2) — a structured editor replaces the
  // raw type in inline edit too, matching the form path.
  'widget',
  // The deadline semantic (objectui#11815): the FIELD's `dueLike`, and the
  // `settledWhen` the host judges against the record before it hands the cell
  // `deadlineSettled`. See `DEADLINE_KEYS` in `enrichDetailField` below.
  'dueLike',
  'settledWhen',

  // Relational / picker configuration. Every key the lookup + user pickers read
  // off their field metadata, so an inline-edit picker behaves
  // exactly like the same field on the object form: multi-value selection,
  // display/description/id fields, quick-create, the Level-2 record picker's
  // columns / page size / base filters, the search-first people picker, and
  // dependent-lookup gating.
  'multiple',
  'reference_field',
  // ⭐ objectui#7155 converged the lookup dialect on the spec's camelCase and
  // retired `display_field` / `description_field` / `id_field` / `lookup_filters`
  // from the widget contract, the docs and every in-repo producer. Copying them
  // here would forward keys no reader consults.
  'displayField',
  'descriptionField',
  'idField',
  // ⭐ objectui#12157 retired `allow_create` / `lookup_columns` /
  // `lookup_page_size` from the picker the same way, so only the spec
  // spellings are copied.
  'allowCreate',
  'lookupColumns',
  'lookupPageSize',
  'lookupFilters',
  'picker',
  'subtitle',
  'avatar_field',
  'avatarField',
  'depends_on',
  'dependsOn',
] as const;

/** The two deadline keys only the object field may supply (objectui#11815). */
const DEADLINE_KEYS = ['dueLike', 'settledWhen'] as const;

/**
 * Merge a detail-view field with its object-schema metadata.
 *
 * The view field always wins — it is the author's explicit override; the object
 * schema only fills the keys it left undefined — except the two deadline keys,
 * which only the object field supplies. Shared by `DetailSection` (the
 * details body) and `HeaderHighlight` (the highlights strip) so the two editors
 * can't drift again.
 *
 * `readonly` is deliberately NOT copied: the hosts read it straight off the
 * object metadata for their editability gate, and widgets take `readonly` as a
 * prop rather than from field metadata.
 */
export function enrichDetailField(
  viewField: Record<string, any>,
  objectDefField: Record<string, any> | undefined | null,
): Record<string, any> {
  const enriched: Record<string, any> = { ...viewField };
  // The deadline is the FIELD's declaration and nothing else's (objectui#11815,
  // ruling D): the authored view-entry `dueLike` retired, so a view entry
  // never supplies either deadline key — not even one that arrives untyped.
  for (const key of DEADLINE_KEYS) delete enriched[key];
  if (!objectDefField) return enriched;

  if (!enriched.type && objectDefField.type) enriched.type = objectDefField.type;

  for (const key of ENRICHED_FIELD_METADATA_KEYS) {
    const value = (objectDefField as Record<string, any>)[key];
    if (value !== undefined && enriched[key] === undefined) enriched[key] = value;
  }

  // objectui#6837 half 2 — maintainer 2026-08-31: protocol normalization
  // belongs on the SERVER, the front end just executes the protocol.
  // `reference` is the only target spelling `@objectstack/spec`'s
  // `FieldSchema` declares; it refuses `reference_to` by name with its own
  // "did you mean -> `reference`?" rename. objectstack#13847 rewrites
  // stored `reference_to` on the serve path and in `os migrate meta`. A
  // legacy-only def is canonicalised ONCE at the ingestion choke point
  // (`normalizeSchemaReferenceKeys`, which warns in dev) — never here.
  //
  // `enriched` is a `DetailViewField`-shaped bag, and that contract declares
  // `reference` since objectui#11070 round 4, so the read and the stamped key
  // are one spelling. A view field that already names its own target keeps it.
  const refTarget = objectDefField.reference;
  if (refTarget && enriched.reference === undefined) enriched.reference = refTarget;

  return enriched;
}
