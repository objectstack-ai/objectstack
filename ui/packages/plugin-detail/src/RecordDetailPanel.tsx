/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * RecordDetailPanel — the record overlay's PAYLOAD, with no shell of its own.
 *
 * This is `RecordDetailDrawer`'s body lifted out of the `Sheet` it used to be
 * welded to (objectui#9299, director seat decision batch #128 item 1). The
 * ruling is that *how* a record opens — drawer / modal / split / popover — is a
 * property of the overlay shell and is honoured the same on every view type,
 * so exactly one payload is mounted through `NavigationOverlay` by all five
 * list-type renderers (`ObjectGrid`, `ObjectTree`, `ObjectGantt`,
 * `ObjectKanban`, `ObjectCalendar`).
 *
 * What lives here: the `objectSchema` -> typed-field derivation, the single
 * `InlineEditProvider` session, `DetailView`, and the record-level
 * `InlineEditSaveBar`. What does NOT live here: `Sheet`/`Dialog`/`Popover`,
 * headers, close buttons, drag-resize, width policy. All of that is the
 * shell's, and the shell is `NavigationOverlay`.
 *
 * ⚠️ Capability is HANDLER PRESENCE, not a boolean prop: a caller that omits
 * `onFieldSave` gets a strictly read-only panel (no inline editors), and one
 * that omits `onDelete` gets no delete action. That is what lets a gantt row
 * locked through `lockField` open read-only without the panel knowing what a
 * lock is.
 *
 * ⚠️ …and a handler handed in is a WIRING, not a grant (objectui#12082). The
 * inline edit is the `recordEdit` row of the affordance-to-grant map, the row
 * the record page reads for the same in-place edit: the object's policy, the
 * server's effective operation set and the caller's update grant. Read HERE,
 * once, because every host that offers the overlay's inline edit reaches it
 * through this panel's `onFieldSave` — the calendar, the kanban and the gantt.
 * A closed row withholds the edit session as an absent handler does. The
 * delete action is `DetailView`'s own `recordDelete` read, unchanged.
 */

import React from 'react';
import { isExpandableFieldType, resolveAffordance, type SchemaLike } from '@object-ui/core';
import type { DataSource } from '@object-ui/types';
import { SYSTEM_MANAGED_FIELD_NAMES } from '@object-ui/types';
import { InlineEditProvider } from '@object-ui/react';
import { usePermissions } from '@object-ui/permissions';
import { DetailView } from './DetailView';
import { InlineEditSaveBar } from './InlineEditSaveBar';
import { useDetailTranslation } from './useDetailTranslation';

/**
 * Field names hidden from the quick-look overlay / inline edit form.
 *
 * Scope: this is the OVERLAY allow-list — used to keep the slim panel UI
 * focused on author-defined business fields. The full record detail page
 * (`RecordDetailView`) surfaces audit fields via a compact
 * `<RecordMetaFooter>` (single-line, muted) rather than a heavy panel, so
 * users can still see who/when created or last touched a record.
 *
 * Derived from the shared `SYSTEM_MANAGED_FIELD_NAMES` — the same set the grid's
 * default-column derivation uses — so it stays in lockstep with the fields
 * `applySystemFields` injects (audit `*_at`/`*_by`, the ownership/tenant FKs,
 * soft-delete bookkeeping). Callers can still override via the `systemFields` prop.
 */
export const DEFAULT_SYSTEM_FIELDS = new Set(SYSTEM_MANAGED_FIELD_NAMES);

export interface RecordDetailPanelProps {
  /** The record being displayed. */
  record: Record<string, any>;
  /** Logical object name used by the data source. */
  objectName: string;
  /** Record id (string-coerced before issuing update/delete). */
  recordId: string | number;
  /** Active data source — used for inline updates and deletion. */
  dataSource?: DataSource;
  /**
   * Optional objectSchema (as returned by `dataSource.getObjectSchema`).
   * When provided the panel infers field types so dates / picklists /
   * currency render with their proper widgets.
   */
  objectSchema?: { fields?: Record<string, any> } | null;
  /** Number of columns the field grid should use. Default `2`. */
  columns?: number;
  /**
   * Optional override for the SYSTEM_FIELDS filter. Defaults to a
   * standard set (id, timestamps, audit fields).
   */
  systemFields?: Set<string>;
  /**
   * Persist an inline field edit. Plugins usually update local state
   * here so the panel stays in sync after the network round-trip.
   */
  onFieldSave?: (field: string, value: unknown) => void | Promise<void>;
  /**
   * Persist record deletion. Plugins are expected to remove the record
   * from their local state; the host is asked to close via `onClose`
   * after this resolves.
   */
  onDelete?: () => void | Promise<void>;
  /**
   * Dismiss the overlay. Called after a successful delete. The shell owns
   * every other way of closing.
   */
  onClose?: () => void;
  /**
   * Optional URL to the full record page. When provided, the panel adds an
   * "Open in new tab" entry to `DetailView`'s header overflow menu.
   * Typically `/console/apps/{appName}/{objectName}/record/{recordId}`.
   */
  fullPageHref?: string;
}

/**
 * Build `DetailView`'s typed field list from an object schema.
 *
 * Exported because the derivation — not just the JSX — is what the five
 * renderers share; a second hand-written copy is exactly the fork this card
 * exists to remove.
 */
export function buildRecordDetailFields(
  record: Record<string, any>,
  objectSchema: { fields?: Record<string, any> } | null | undefined,
  systemFields: Set<string>,
): Array<Record<string, any>> {
  // Build typed fields list from objectSchema, falling back to record keys
  // when no schema is available. Lookups are marked readonly because we
  // don't yet wire a relation picker inside the panel's inline editor —
  // showing them as plain text inputs would let users overwrite the
  // relation with a free-form string.
  const schemaFields: Record<string, any> = (objectSchema?.fields ?? {}) as Record<string, any>;
  const orderedNames = Object.keys(schemaFields).length
    ? Object.keys(schemaFields)
    : Object.keys(record);
  return orderedNames
    .filter((name) => !systemFields.has(name) && !name.startsWith('__'))
    .filter((name) => name in record)
    // Honor `hidden: true` on the schema field def so internal/system fields
    // (e.g. database_url, environment_id, is_system) don't leak into the
    // quick-look panel.
    .filter((name) => !schemaFields[name]?.hidden)
    .map((name) => {
      const def = schemaFields[name] || {};
      // Which types are reference-bearing is NOT restated here: it is
      // `EXPANDABLE_FIELD_TYPES` in `@object-ui/core`, read through
      // `isExpandableFieldType` — the same family the `$expand` builder, the
      // object form's `needsDataSourceWiring`, the grid's `bulkParamToField`
      // and the dashboard's whitelist read (objectui#4770 / #4790 / #4815 /
      // #5312 / #5692). The literal that stood here diverged in BOTH
      // directions (objectui#5874):
      //
      //  - it lacked `user` and `tree`. Both carry the same foreign-key
      //    storage as `lookup`, so the reason stated above — the panel has no
      //    relation picker, and a plain text input would let the user overwrite
      //    the relation with a free-form string — applied to them just as much.
      //    Gaining them RESTORES the stated rule rather than widening it.
      //  - it carried a fifth spelling `reference`, which no producer can emit:
      //    absent from `@objectstack/spec`'s closed `FieldType` vocabulary,
      //    exactly where `owner` sat before objectui#4814 retired it.
      //
      // Pinned by an identity spy on that `has`, so a member-identical private
      // copy fails rather than quietly re-forking the table. Never
      // `new Set([...EXPANDABLE_FIELD_TYPES, ...])` — a copy re-forks it.
      const isLookup = isExpandableFieldType(def);
      // Carry through the full field metadata so DetailView's inline-edit
      // mode can resolve the correct widget (e.g. a select with options
      // rather than a free-form text input). DetailSection performs the
      // same enrichment when rendering a record detail page; without this
      // fan-out the panel rendered a plaintext input for every picklist.
      return {
        name,
        label: def.label,
        type: def.type as any,
        readonly: !!def.readonly || isLookup,
        options: def.options,
        currency: def.currency,
        // The spec's one declaration of a fixed currency: `FieldSchema`
        // refuses a field-level `currency`, so without this a fixed-EUR amount
        // read in the tenant's currency here (objectui#12242).
        currencyConfig: def.currencyConfig,
        precision: def.precision,
        scale: (def as any).scale,
        // Beside `scale`, whose scale-0 grouping heuristic it overrides in the
        // number cell (objectui#11026).
        useGrouping: def.useGrouping,
        format: def.format,
        // Served schemas key the target as `reference` (ObjectStack
        // convention, #2407), the only spelling read here.
        //
        // Two further arms stood here until objectui#6837 — `def.referenceTo`
        // and `def.target` — and they were NOT redundant-but-harmless: no
        // contract declares either spelling. `FieldSchema` refuses BOTH by name
        // with `unrecognized_keys`, each carrying its own "did you mean
        // `reference`" rename; `referenceTo` is additionally stripped at the
        // designer read door (`RETIRED_FIELD_KEYS`, objectui#6041 / #6519), so
        // that arm could never hit. A structure-walk producer census found ZERO
        // emitters of either at THIS cell — a value inside an object schema's
        // `fields` container, which is what `objectSchema.fields[name]` reads —
        // while the controls `reference` (92 hits / 36 files) and `reference_to`
        // (52 / 36) were hot in the same pass over the same cells. So the two
        // arms were invented tolerance surface: a silent absorption point for a
        // producer that should fail visibly (AGENTS.md #0.1).
        //
        // ⛔ Do not re-add a spelling arm here. A producer emitting a refused
        // spelling is fixed AT THE PRODUCER, or canonicalised once at the
        // ingestion choke point (`normalizeSchemaReferenceKeys`, which folds a
        // legacy spelling onto `reference`) — never by a renderer-side alias.
        //
        // objectui#6837 half 2 deleted the last read arm too: the RIGHT-hand
        // side reads `reference` alone, the only spelling the protocol
        // declares. objectui#11070 round 4 renamed the LEFT-hand key to match:
        // this emit's TARGET contract (`DetailViewField` /
        // `DetailViewFieldSchema` in `@object-ui/types`) declares `reference`
        // now, and the widgets it feeds read nothing else.
        reference: def.reference,
        reference_field: def.reference_field ?? def.referenceField,
        required: def.required,
        validation: def.validation,
        placeholder: def.placeholder,
        description: def.description,
      };
    });
}

/**
 * The default overlay width, and the single code home of this literal
 * repo-wide.
 *
 * The gantt, kanban and calendar renderers deliberately spell no `width` of
 * their own and let an unauthored `navigation.width` fall through to this
 * value. Converging it on the `size: 'lg'` bucket (`min(92vw, 960px)` — up to
 * 53% wider below a 1600px viewport) was RULED AGAINST: objectui#6584,
 * 2026-08-27 — stays on the CSS literal; no bucket convergence. The question is
 * CLOSED, not open.
 *
 * ⚠️ It became an EXPORT with objectui#9299. Before that it was
 * `RecordDetailDrawer`'s default parameter, reached by passing `undefined`;
 * the renderers no longer go through that component, so they read the constant
 * instead. ⛔ Do not re-spell the literal at a call site — four copies of a
 * ruled-on number is how the four surfaces drift apart.
 *
 * `NavigationOverlay` treats an authored width as a FLOOR
 * (`max(WIDTH, min(60vw, 880px))`), and for this value that expression reduces
 * to `min(60vw, 960px)` at every viewport — i.e. the same pixels the old
 * inline style set.
 */
export const RECORD_OVERLAY_DEFAULT_WIDTH = 'min(960px, 60vw)';

/** The record overlay payload — shell-free by construction. */
export function RecordDetailPanel({
  record,
  objectName,
  recordId,
  dataSource,
  objectSchema,
  columns = 2,
  systemFields = DEFAULT_SYSTEM_FIELDS,
  onFieldSave,
  onDelete,
  onClose,
  fullPageHref,
}: RecordDetailPanelProps) {
  const { t } = useDetailTranslation();
  const fields = buildRecordDetailFields(record, objectSchema, systemFields);
  const perms = usePermissions();
  // objectui#12082 — the overlay's inline edit is the `recordEdit` row, asked
  // of the object this panel shows, with that object's schema for the policy
  // half. With no permission provider mounted the grant and the operation set
  // read open, so a standalone overlay behaves as before.
  const editGranted = resolveAffordance('recordEdit', {
    objectSchema: objectSchema as SchemaLike | null | undefined,
    objectName,
    perms,
  }).allowed;
  const fieldSave = editGranted ? onFieldSave : undefined;

  return (
    /* One inline-edit session scoped to this overlay. `canEdit` gates on
       handler presence so an omitted onFieldSave yields a strictly
       read-only panel (objectui#2407 P1) — and on the `recordEdit` verdict
       above, so a handler the caller may not use yields the same panel. */
    <InlineEditProvider canEdit={!!fieldSave}>
      <DetailView
        dataSource={dataSource}
        // Capability = handler presence: a caller that omits onFieldSave /
        // onDelete gets a strictly read-only panel (no inline editors, no
        // delete action) — e.g. a gantt row locked via lockField. Hardcoding
        // these on would let the panel bypass row-level locks.
        inlineEdit={!!fieldSave}
        schema={{
          type: 'detail-view',
          objectName,
          resourceId: String(recordId),
          data: record,
          showDelete: !!onDelete,
          columns,
          fields,
          // Fold "Open in new tab" into DetailView's unified header
          // overflow menu (the "..." kebab) rather than floating it
          // as a separate icon. This way we never stack a third icon
          // on top of the shell's own button cluster.
          actions: fullPageHref
            ? [
                {
                  type: 'action:bar',
                  location: 'record_header',
                  systemActions: [
                    {
                      name: 'sys_open_new_tab',
                      label: t('detail.openInNewTab'),
                      icon: 'external-link',
                      type: 'script',
                      onClick: () =>
                        window.open(fullPageHref, '_blank', 'noopener'),
                    },
                  ],
                },
              ]
            : undefined,
        } as any}
        onDelete={onDelete ? async () => {
          try {
            await onDelete();
            onClose?.();
          } catch (err) {
            console.error('[RecordDetailPanel] delete failed:', err);
          }
        } : undefined}
      />
      {/* Record-level Save/Cancel bar. Callback mode: loops the caller's
          per-field onFieldSave over the draft, preserving the overlay's
          existing persistence contract (plugin-gantt/kanban/calendar). */}
      <InlineEditSaveBar
        onFieldSave={fieldSave ? async (field, value) => {
          try {
            await fieldSave(field, value);
          } catch (err) {
            console.error('[RecordDetailPanel] inline field save failed:', err);
            // Rethrow so the save bar surfaces the failure inline and keeps
            // the draft — swallowing made a rejected save look successful.
            throw err;
          }
        } : undefined}
      />
    </InlineEditProvider>
  );
}

export default RecordDetailPanel;
