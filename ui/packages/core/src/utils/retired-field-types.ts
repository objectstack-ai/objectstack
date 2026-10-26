/**
 * ObjectUI — retired field-type spellings
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * TOMBSTONE table — field-type spellings this renderer has RETIRED, mapped to
 * the prescription an author must follow instead (ADR-0049 enforce-or-remove).
 *
 * A retired spelling is not merely absent: absence here means
 * `mapFieldTypeToFormType`'s `|| 'field:text'` tail would hand back a
 * working plain text input, which is the failure mode this table exists to
 * prevent. An author who writes a retired name — or an AI author who copies one
 * out of a stale doc — must be TOLD, not quietly given a text box that looks
 * like it worked. So each entry resolves to a registered tombstone widget that
 * renders a visible refusal naming the migration
 * (`packages/fields/src/index.tsx`), while {@link reportRetiredFieldType}
 * writes the same prescription to the console.
 *
 * `owner` (objectui#4814, ruling A′): a synonym for `user` with zero behavioral
 * delta — both resolved to the SAME `UserField` widget — and absent from the
 * spec's closed 48-member `FieldType`, so no object schema could ever declare
 * it; it was reachable only through hand-written SDUI. Three code faces had
 * already drifted apart on this one word (the form's data-source rule excluded
 * it while plugin-grid's bulk dialog included it), which is the standing
 * evidence that a second spelling for one concept is a drift channel, not a
 * convenience. The idiom survives verbatim as `{ type: 'user', name: 'owner' }`.
 *
 * ## Why this table lives in `@object-ui/core` and not in `@object-ui/fields`
 *
 * It was born in `packages/fields/src/field-type-alias.ts`, next to the widget
 * map that is its first consumer, and `@object-ui/fields` still exports every
 * name in this module so no consumer of that surface had to move. It was HOISTED
 * here by objectui#4914, and for a measured reason rather than a tidiness one:
 * the retirement gate has to run ahead of six predicate faces, and one of them
 * — `operatorsForFieldType` / the filter row's control choice in
 * `packages/components/src/custom/filter-builder.tsx` — lives in
 * `@object-ui/components`, which `@object-ui/fields` DEPENDS ON (54 source
 * files import from it). A `components → fields` import is a package cycle, so
 * the six faces could not all read one table while that table lived in
 * `fields`.
 *
 * The alternative was a second copy of the table inside `components`, and that
 * is precisely what this file exists to make impossible: two tables means two
 * `reportedRetiredTypes` sets, so one retired spelling logs its prescription
 * TWICE — and the "fires once" half of the ruling would be false the day it
 * landed. `@object-ui/core` is below all six faces' packages (it imports only
 * `@object-ui/types`), and already owns the sibling cross-package field-type
 * vocabulary — {@link EXPANDABLE_FIELD_TYPES} in `./expand-fields.js`, whose
 * own docblock records what happened the last time this kind of table was
 * hand-copied per consumer. One table, one home, seven consumers.
 */
export const RETIRED_FIELD_TYPES: Readonly<Record<string, string>> = Object.freeze({
  owner:
    "[object-ui] Field type `owner` was RETIRED (objectui#4814). It was a synonym " +
    "for `user` with no behavioral difference, and it is not a member of " +
    "`@objectstack/spec`'s FieldType. Write the record-owner field as " +
    "`{ type: 'user', name: 'owner' }` — the field NAME carries the ownership " +
    "meaning, the type carries the widget. The `widget: 'field:owner'` spelling " +
    "is retired with it.",
});

/**
 * THE retirement gate — true when a spelling has been retired by this renderer.
 *
 * Ruled into existence by the maintainer on 2026-08-18 (objectui#4914, option
 * B) as the ONE question every field-type predicate asks before it answers:
 * "a retired spelling fires `reportRetiredFieldType` once and takes the
 * established disposition, instead of riding the lookup-family paths or
 * silently degrading."
 *
 * Quantified over the whole table rather than written per spelling, which is
 * the entire point of having a gate at all: the next retirement closes every
 * face the day it lands in {@link RETIRED_FIELD_TYPES}, instead of leaving each
 * consumer open until someone notices it. `owner` survived objectui#4814 in
 * thirteen more faces exactly because each one had hand-written its own
 * membership list.
 *
 * `hasOwnProperty`, not `RETIRED_FIELD_TYPES[type]`: a `type` of
 * `'constructor'` or `'toString'` reaches `Object.prototype` and would answer
 * truthy through a plain index read.
 *
 * @param type - The spelling an author wrote (or a backend column declared).
 * @returns `true` when the spelling is retired. Pure — it does NOT log; pair it
 * with {@link reportRetiredFieldType} at the face that wants to be loud.
 */
export function isRetiredFieldType(type: string | undefined | null): boolean {
  if (typeof type !== 'string' || !type) return false;
  return Object.prototype.hasOwnProperty.call(RETIRED_FIELD_TYPES, type);
}

/**
 * Spellings already reported this session, so a retired type inside a rendered
 * list logs its prescription ONCE instead of once per row. The message is a
 * fix instruction for an author, not a per-render event — a 1000-row grid
 * repeating it 1000 times buries the very thing it is trying to surface.
 *
 * Module state, and that is load bearing now that SEVEN faces call the reporter
 * (objectui#4914): the dedupe is per SPELLING, not per face, so a filter row
 * whose column is refused by `operatorsForFieldType`, by the control chooser
 * and by `normalizeFieldType` on the same render still prints one line.
 */
const reportedRetiredTypes = new Set<string>();

/**
 * Report a retired field-type spelling loudly, once per spelling.
 *
 * @param fieldType - The spelling the author wrote.
 * @returns `true` when `fieldType` is retired (whether or not this call was the
 * one that logged), so callers can branch on it without a second table lookup.
 */
export function reportRetiredFieldType(fieldType: string): boolean {
  const prescription = isRetiredFieldType(fieldType) ? RETIRED_FIELD_TYPES[fieldType] : undefined;
  if (!prescription) return false;
  if (!reportedRetiredTypes.has(fieldType)) {
    reportedRetiredTypes.add(fieldType);
    console.error(prescription);
  }
  return true;
}

/** Test seam — forget which spellings have been reported. */
export function resetRetiredFieldTypeReports(): void {
  reportedRetiredTypes.clear();
}
