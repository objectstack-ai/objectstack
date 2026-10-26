/**
 * ObjectUI — expand-fields utility
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { columnIdentity } from './column-identity.js';

/**
 * Relational ("reference-bearing") field types whose stored value is a foreign
 * key into another object — and which therefore benefit from `$expand`, so a
 * response carries the related record instead of only its foreign key.
 *
 * `user` is a lookup specialised to `sys_user`: it carries the same `reference`
 * + id storage and the server resolves it through the same expand path as
 * `lookup` / `master_detail`, so a `user` column that is NOT requested for
 * expansion comes back as a raw user id (objectui#2032). What a CELL then
 * prints for that id is deliberately not stated here — see the next section.
 *
 * ## No rendering claim is made here, on purpose — objectui#8693
 *
 * Both paragraphs above used to make one: the `user` sentence ended "…and
 * renders as '—'", and the opening one called the unexpanded cell "a bare id
 * placeholder ('—')". Measured on `da5e4f69e` by resolving each family through
 * `getCellRenderer` and rendering three unexpanded primitives:
 *
 * | unexpanded value     | `lookup` / `master_detail` / `tree` | `user`             |
 * |----------------------|-------------------------------------|--------------------|
 * | `'u_1'`              | `u_1`, plain truncated span         | `u_1`, same span   |
 * | `'01HQZX9K2M4N6P8R'` | muted `—`                           | the raw ULID       |
 * | `'Ada Lovelace'`     | `Ada Lovelace`, plain span          | the raw string     |
 *
 * Wrong twice over. `user` never drew the em-dash at all — `UserCellRenderer`
 * has no resolver, no `useLookupName`, no `isLikelyOpaqueId`. And the three
 * families that do draw it draw it ONLY for values `isLikelyOpaqueId` accepts;
 * that qualifier is the entire content of the behaviour and the sentence never
 * carried it, so a reader was told a human-readable id would degrade visibly
 * when it printed as if it were a name — the defect objectui#8434 was for.
 *
 * It is not replaced by a corrected sentence, because a corrected sentence
 * could not be kept true HERE. `@object-ui/core` does not depend on
 * `@object-ui/fields` in `dependencies`, `peerDependencies` or
 * `devDependencies` — the arrow runs the other way — so no test that can reach
 * this file can render the cell it would describe, and nothing in this repo
 * compares a docblock to rendered output. A replacement would be checked by
 * whatever checked the last one: nobody. Its shelf life was measured too —
 * while objectui#8693 was open, PR #8698 (objectui#8434) sat in the merge
 * queue rewriting the `user` column of that very table: on its head
 * `3692f7218` all three primitives render an unresolved-reference affordance
 * that KEEPS the raw value. A corrected sentence would have been stale before
 * it landed. The other three families are byte-identical on both trees.
 *
 * The storage claim is the half this set actually depends on, and that half IS
 * checkable here (`__tests__/expand-fields.test.ts`, plus the identity pins
 * below). How an unexpanded reference prints belongs next to the renderers in
 * `@object-ui/fields`, where a test can fail.
 *
 * Note on `tree`: a self-referencing hierarchy field is a reference too, so it
 * belongs in this set; whether the backend materialises the expanded object
 * for it is a server concern — requesting it is harmless and forward-compatible.
 *
 * ## One family, many consumers — and NO reliable count of them
 *
 * This section used to open "One family, four consumers" and enumerate four.
 * That count was hand-kept, and hand-kept counts of this table are exactly what
 * keeps going wrong: it was already stale by two when objectui#5692 measured it
 * (`paramToField` in `app-shell` had joined with objectui#5312, and
 * `ListView`'s relational-sort rule reads the set directly), and objectui#5312's
 * claim to have converted "the LAST private copy" was false by two MORE — see
 * the falsification note at the end. Read the list below as the lineage of the
 * conversions, not as a census; the mechanical fact is the identity pins.
 *
 * Re-measured for objectui#8693 on `da5e4f69e`: stale again, by FOUR. The
 * commit that corrected the "fourth and last" claim (objectui#5874 / #6064)
 * converged four more private copies of its own and never added them here —
 * the last four bullets below. Re-derive before trusting it; the recipe is at
 * the end of the list.
 *
 * This is the reference-bearing FAMILY, not the `$expand` builder's private
 * list, and these concerns read it under several different words:
 *
 *  - `$expand` construction — `buildExpandFields` below ("expandable");
 *  - predicate-record projection — `predicate-record.ts` ("relational");
 *  - the object form's data-source wiring — `needsDataSourceWiring` in
 *    `packages/components/src/renderers/form/form.tsx`, which decides which
 *    registered widget gets `dataSource` / `dependentValues` /
 *    `dependsOnLabels` threaded to it;
 *  - the grid's bulk-action dialog — `widgetNeedsDataSource` in
 *    `packages/plugin-grid/src/components/bulkParamToField.ts`, which decides
 *    which param widget is handed the grid's `DataSource` and which param field
 *    shape carries `reference` / `displayField`;
 *  - the action-param dialog — `paramToField` in
 *    `packages/app-shell/src/utils/paramToField.ts`, which decides which param
 *    carries a reference target (objectui#5312);
 *  - the list view's relational-sort rule — `ListView.tsx`, which will not offer
 *    a server-side sort on a field whose stored value is a foreign key;
 *  - the dashboard table's `$expand` whitelist — `computeLookupExpand` in
 *    `packages/plugin-dashboard/src/ObjectDataTable.tsx` (objectui#5692);
 *  - the dashboard's relation/link test — `isLookupType` in
 *    `packages/plugin-dashboard/src/recordFields.tsx` (objectui#5692);
 *  - the action-param RESOLVER (one step before `paramToField`) —
 *    `packages/fields/src/resolveActionParams.ts` (objectui#5874; moved out of
 *    app-shell by objectui#12105 so the bulk dialog shares it);
 *  - the detail header's relation test — `HeaderHighlight.tsx` in
 *    `packages/plugin-detail` (objectui#5874);
 *  - the detail drawer's relation test — `RecordDetailDrawer.tsx` in
 *    `packages/plugin-detail`, reading through `isExpandableFieldType`
 *    (objectui#5874);
 *  - the kanban board's `$expand` — `ObjectKanban.tsx` in
 *    `packages/plugin-kanban`, reading through `buildExpandFields`
 *    (objectui#5874).
 *
 * ⚠️ Re-derive rather than trust. One command, from the repo root, over the
 * whole tree with NO pathspec. (Narrowing it to `packages/` + a `*` segment +
 * `/src` matches ZERO files, and would drop `apps/` besides. The two-character
 * sequence is spelled out in words here because writing it literally would end
 * this comment.)
 *
 *     git grep -lE 'EXPANDABLE_FIELD_TYPES|isExpandableFieldType|buildExpandFields'
 *
 * 96 files on `da5e4f69e`. Drop tests, changesets and changelogs and the
 * production readers fall into three radii, only the first of which the list
 * above is about: this file plus 8 more naming the set directly, plus 4 more
 * calling `isExpandableFieldType`, plus 13 more calling `buildExpandFields`.
 * The sweep was controlled by planting a reader under `apps/console/src/` and
 * confirming the same command found it — `apps/` holds no reader today, and a
 * zero-hit region is otherwise indistinguishable from a blind spot.
 *
 * The third one used to be a second hand-maintained copy, and this comment used
 * to claim the set "mirrors the form layer's `DATA_SOURCE_FIELD_TYPES`
 * (`lookup` / `master_detail` / `tree`)". That was true for 15 days. The form's
 * copy then gained `capability-multiselect` (objectui#2403) and, the same day,
 * `object-ref` / `filter-condition` / `recipient-picker` (objectui#2421), after
 * which the two sets were not in a subset relation in EITHER direction — `user`
 * only here, three picker names only there — and no gate could say so
 * (objectui#4790). The form now DERIVES from this set instead of restating it:
 *
 *     form's data-source rule  ==  EXPANDABLE_FIELD_TYPES
 *                                  + the widget-hint-only picker names
 *
 * The extension is one-directional and cannot fold back into this set:
 * `object-ref` / `filter-condition` / `recipient-picker` (and the registry-name
 * pickers `position-ref` / `permission-ref`, objectui#7611) are widget HINTS, never
 * declarable field types (`widgetHintOnly: true` in
 * `app-shell/src/utils/paramValueShape.ts`), so no object schema can produce a
 * field whose `type` is one of them.
 *
 * The fourth was a hand-maintained copy too, one member set removed from BOTH
 * of the above (`lookup` / `master_detail` / `user` — no `tree`, no pickers, and
 * for a while a fifth spelling, `owner`, that objectui#4814 retired). It now
 * derives from this set with NO extension, because the bulk dialog's params
 * cannot produce the widget-hint names (objectui#4815):
 *
 *     bulk dialog's data-source rule  ==  EXPANDABLE_FIELD_TYPES
 *
 * Neither consumer copies the set — both call `.has()` on THIS object, and both
 * carry an identity pin (a spy on this `has`) so a member-identical private copy
 * fails rather than quietly re-forking the table.
 *
 * ## The "LAST private copy" claim was false — objectui#5692
 *
 * objectui#5312 converted `paramToField` (`app-shell`) and recorded it as the
 * fourth and LAST private copy of this rule. `packages/plugin-dashboard` held
 * two more the whole time — `LOOKUP_TYPES` in `recordFields.tsx` and an inline
 * disjunction inside `computeLookupExpand` in `ObjectDataTable.tsx` — which
 * predate that sweep and were outside its file surface, so nothing contradicted
 * the claim. Both now derive from this set with NO extension and carry the same
 * identity pin.
 *
 * Those two were NOT member-identical to this set, in either direction: they
 * lacked `tree` and carried a fifth spelling, `reference`. Converging them was
 * therefore a behaviour change in two directions, and the direction that could
 * have widened THIS set was settled by measurement rather than by preference:
 * `reference` is absent from `@objectstack/spec`'s closed `FieldType`
 * vocabulary and is refused by `FieldSchema.safeParse` — measured with `lookup`
 * / `master_detail` / `user` / `tree` as live controls and the retired `owner`
 * plus a nonsense spelling as dead ones — so no spec-compliant object schema can
 * declare a field whose stored type is `reference`, and the dashboard's copies
 * were carrying a dead spelling, not a member this set was missing. This set is
 * unchanged by objectui#5692; the two dashboard faces simply stopped answering
 * for a type no producer can emit.
 *
 * Stated so it reads as a decision rather than a surprise: **adding a member
 * here also grants that type the form's data-source wiring.** That is the
 * intended coupling — a type whose stored value is a foreign key needs a
 * `DataSource` to resolve that key on the read path (expand) and on the edit
 * path (the picker) alike.
 */
export const EXPANDABLE_FIELD_TYPES: ReadonlySet<string> = new Set([
  'lookup',
  'master_detail',
  'tree',
  'user',
]);

/**
 * Whether a field definition is a reference-bearing type that can be `$expand`-ed.
 * Only the field's `type` matters here — the `reference` / `reference_to` target
 * is irrelevant to the decision, so this works regardless of which canonical key
 * the schema uses to name the related object.
 */
export function isExpandableFieldType(fieldDef: unknown): boolean {
  return (
    !!fieldDef &&
    typeof fieldDef === 'object' &&
    EXPANDABLE_FIELD_TYPES.has((fieldDef as { type?: unknown }).type as string)
  );
}

/**
 * Build an array of field names that should be included in `$expand`
 * when fetching data. This scans the given object schema fields
 * (and optional column configuration) for reference-bearing field types
 * (see {@link EXPANDABLE_FIELD_TYPES}: `lookup` / `master_detail` / `tree` /
 * `user`), so the backend (e.g. objectql) returns expanded objects instead of
 * raw foreign-key IDs.
 *
 * @param schemaFields - Object map of field metadata from `getObjectSchema()`,
 *   e.g. `{ account: { type: 'lookup', reference: 'accounts' }, ... }`.
 * @param columns - Optional explicit column list. When provided, only
 *   reference fields that appear in `columns` are expanded — list/grid/kanban
 *   views pass their VISIBLE columns here so wide objects don't pay to expand
 *   relations no cell will show. Accepts `string[]` or `ListColumn[]` (objects
 *   with a `field` property).
 * @returns Array of field names to pass as `$expand` (empty → omit `$expand`).
 *
 * @example
 * ```ts
 * const fields = {
 *   name: { type: 'text' },
 *   account: { type: 'lookup', reference: 'accounts' },
 *   parent: { type: 'master_detail', reference: 'contacts' },
 *   assignee: { type: 'user', reference: 'sys_user' },
 * };
 * buildExpandFields(fields);
 * // → ['account', 'parent', 'assignee']
 *
 * buildExpandFields(fields, ['name', 'account']);
 * // → ['account']   (only the visible reference columns)
 * ```
 */
export function buildExpandFields(
  schemaFields?: Record<string, any> | null,
  columns?: (string | { field?: string; name?: string; fieldName?: string })[],
): string[] {
  if (!schemaFields || typeof schemaFields !== 'object') {
    return [];
  }

  // Collect every reference-bearing field name from the schema.
  const referenceFieldNames: string[] = [];
  for (const [fieldName, fieldDef] of Object.entries(schemaFields)) {
    if (isExpandableFieldType(fieldDef)) {
      referenceFieldNames.push(fieldName);
    }
  }

  if (referenceFieldNames.length === 0) {
    return [];
  }

  // When columns are provided, restrict expansion to visible columns only.
  if (columns && Array.isArray(columns) && columns.length > 0) {
    const columnFieldNames = new Set<string>();
    for (const col of columns) {
      // `columnIdentity` handles all three entry shapes (bare string, spec
      // `{field}`, legacy `{name}`/`{fieldName}`) and resolves canonical-first
      // — the same precedence every renderer now uses, so what gets expanded
      // and what gets rendered can no longer name two different fields (#3104).
      const name = columnIdentity(col);
      if (name) columnFieldNames.add(name);
    }
    return referenceFieldNames.filter((f) => columnFieldNames.has(f));
  }

  return referenceFieldNames;
}
