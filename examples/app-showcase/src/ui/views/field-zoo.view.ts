// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineView, P } from '@objectstack/spec';

const data = { provider: 'object' as const, object: 'showcase_field_zoo' };

/**
 * Field Zoo views — the LIST-side half of the action-gating matrix declared in
 * `ui/actions/predicate-matrix.action.ts`.
 *
 * The actions there carry the gates; this file is what puts them on a screen
 * where a disagreement between surfaces is visible. Two seeded records do the
 * work: **Specimen — Full** (every field populated) and **Specimen — Minimal**
 * (most fields `null`), so every gate has a record it must pass and a record it
 * must fail.
 */
export const FieldZooViews = defineView({
  /**
   * The default list. Columns stay deliberately narrow — `name` plus a handful
   * of scalars — because the interesting thing about this view is what it does
   * NOT show.
   *
   * Almost every gate in the matrix reads a field that is not a column here:
   * `owner_id`, `f_lookup`, `f_json`, `f_location`, `f_tags` … A list's
   * `$select` is built from its COLUMNS, so before objectui#3501 the server was
   * never asked for those fields, and CEL treats an absent key as a FAULT
   * rather than as null — fail-closed on the row kebab and the selection bar,
   * fail-open on the lenient paths. The symptom was a row action that worked on
   * the detail page (which fetches the whole record) and silently vanished in
   * the list. Keeping the columns narrow is what keeps that regression
   * detectable here.
   */
  list: {
    label: 'Field Zoo',
    type: 'grid',
    data,
    columns: [
      { field: 'name' },
      { field: 'f_select' },
      { field: 'f_number' },
      { field: 'f_boolean' },
      { field: 'f_rating' },
    ],

    /**
     * Row-level conditional formatting over a RELATION field — the display-side
     * twin of the action gates, and the same trap. `f_lookup` IS a column
     * nowhere in this view, and even when a relational field IS shown the
     * client expands it for its label, replacing the stored id with the whole
     * related record. A rule comparing it therefore had to be written one way
     * for an expanded surface and another way for a plain one; binding the
     * relation as its foreign key everywhere (objectui#3501) is what makes this
     * single rule correct on both.
     *
     * #8990 — it is also the same SPARSE binding, so it takes the same guard:
     * this rule reads a column no view here projects, and the unguarded read
     * aborted at key resolution on every row. `has()` is the whole guard —
     * the surviving `!= null` is the rule's own test, not protection from a
     * fault, because `!=` against a literal never faults on a NULL value.
     */
    conditionalFormatting: [
      {
        condition: P`has(record.f_lookup) && record.f_lookup != null`,
        style: { backgroundColor: 'rgba(37, 99, 235, 0.08)' },
      },
    ],

    /**
     * The selection-bar half of the matrix. Each name resolves against the
     * object's declared actions and is promoted into a selection-bar button
     * carrying that action's label, icon, `visible` AND `requiredPermissions` —
     * the last of which the bar used to drop on the floor (objectui#3492), so
     * an action hidden in the row kebab reappeared here the moment a row was
     * ticked.
     *
     * What to look for, with BOTH specimens selected:
     *   • `showcase_zoo_relation_gate` — offered (Full's two lookups resolve
     *     to the same account id), and offered identically in the row `⋮` menu
     *     and the record header. Three surfaces, one verdict.
     *   • `showcase_zoo_owner_gate` — offered to whoever seeded the workspace
     *     (both specimens are theirs). `owner_id` is a platform-INJECTED column
     *     that object metadata never publishes, so it is also what proves a
     *     `$select` harvest knows the platform columns and does not drop it as
     *     a typo (objectui#3501).
     *   • `showcase_zoo_user_gate` — absent until you assign `f_user` to
     *     yourself on a record; `sys_user` rows cannot be seeded.
     *   • `showcase_zoo_visible_*` — the three authoring forms of one
     *     predicate. All three appear, and the run reports ONE skipped record:
     *     Minimal's `f_boolean` is false, so it is excluded from the run rather
     *     than silently acted on.
     *   • `showcase_zoo_perm_held` — present only for a caller holding
     *     `showcase.export_data`.
     *   • `showcase_zoo_perm_missing` / `_and` — absent for EVERYONE. A button
     *     here is the objectui#3492 regression, on screen.
     *   • `showcase_zoo_perm_empty` — always present; an empty declaration
     *     passes.
     */
    bulkActions: [
      'showcase_zoo_relation_gate',
      'showcase_zoo_owner_gate',
      'showcase_zoo_user_gate',
      'showcase_zoo_visible_string',
      'showcase_zoo_visible_tagged',
      'showcase_zoo_visible_envelope',
      'showcase_zoo_perm_held',
      'showcase_zoo_perm_missing',
      'showcase_zoo_perm_and',
      'showcase_zoo_perm_empty',
    ],
  },

  listViews: {
    /**
     * The same matrix with the predicate fields PROMOTED TO COLUMNS.
     *
     * The pair is the point: this view and the default one above declare the
     * same gates over the same records and must reach the same verdicts. They
     * differ only in whether the gated field is also displayed — which is to
     * say, only in whether the client expands it and whether the projection
     * would have included it anyway. Any button that appears in one and not the
     * other is a relation-binding or projection bug, and nothing else.
     */
    gated_columns: {
      label: 'Gated fields as columns',
      type: 'grid',
      data,
      columns: [
        { field: 'name' },
        { field: 'f_lookup' },
        { field: 'f_master_detail' },
        { field: 'f_boolean' },
        { field: 'f_rating' },
      ],
      bulkActions: [
        'showcase_zoo_relation_gate',
        'showcase_zoo_owner_gate',
        'showcase_zoo_user_gate',
        'showcase_zoo_visible_string',
        'showcase_zoo_visible_tagged',
        'showcase_zoo_visible_envelope',
        'showcase_zoo_perm_held',
        'showcase_zoo_perm_missing',
        'showcase_zoo_perm_and',
        'showcase_zoo_perm_empty',
      ],
    },

    /**
     * `bulkActionDefs` — the OTHER bulk vocabulary, authored inline rather than
     * resolved from a name. It carries the per-record `visible` directly, which
     * is the form whose eligibility split the dialog reports: over both
     * specimens it acts on Full and reports Minimal as skipped, rather than
     * quietly including it.
     *
     * `execution: 'aggregate'` is not decoration — a `custom` def without it is
     * a no-op the parser refuses outright ("the button runs, reports success
     * for every selected record, and does nothing"). Aggregate means ONE
     * dispatch for the whole selection, with the eligible ids in
     * `params._selectedIds`; the def resolves its `name` against the object's
     * declared actions to find something to dispatch.
     */
    inline_bulk_defs: {
      label: 'Inline bulk defs',
      type: 'grid',
      data,
      columns: [{ field: 'name' }, { field: 'f_boolean' }, { field: 'f_rating' }],
      bulkActionDefs: [
        {
          name: 'showcase_zoo_visible_string',
          operation: 'custom',
          execution: 'aggregate',
          label: 'Rated 4+ only',
          // #8990 — `f_rating` IS a column here, but a `bulkActionDefs` predicate
          // binds the selection's rows, not this view's columns, so it takes the
          // guard anyway. Ordering (`>=`) faults on a projected NULL, so this one
          // needs the full conjunction rather than `has()` alone.
          visible: P`has(record.f_rating) && record.f_rating != null && record.f_rating >= 4`,
        },
      ],
    },
  },
});
