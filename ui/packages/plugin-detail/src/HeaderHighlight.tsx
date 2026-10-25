/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import {
  cn,
  Button,
  EmptyValue,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@object-ui/components';
import type { HighlightField } from '@object-ui/types';
import { EXPANDABLE_FIELD_TYPES, resolveFieldAffordance, isDeadlineSettled } from '@object-ui/core';
import { usePermissions } from '@object-ui/permissions';
import { getCellRenderer, resolveCellRendererType, useBooleanValueLabel } from '@object-ui/fields';
import { useSafeFieldLabel, useInlineEdit, usePredicateScope } from '@object-ui/react';
import { Check, X, Pencil } from 'lucide-react';
import { InlineFieldInput } from './InlineFieldInput';
import {
  enrichDetailField,
  isComputedFieldType,
  isInlineExcludedDetailFieldType,
} from './fieldEnrichment';
import { NON_EDITABLE_SYSTEM_FIELDS } from './systemFields';
import { useDetailTranslation } from './useDetailTranslation';
import { hasCellValue } from './emptiness';

export interface HeaderHighlightProps {
  fields: HighlightField[];
  data?: any;
  className?: string;
  /** Object name for i18n field label resolution */
  objectName?: string;
  /** Object schema for field metadata enrichment */
  objectSchema?: any;
  /** DataSource used by reference (lookup / user) editors during inline edit */
  dataSource?: any;
}

export const HeaderHighlight: React.FC<HeaderHighlightProps> = ({
  fields,
  data,
  className,
  objectName,
  objectSchema,
  dataSource,
}) => {
  const { fieldLabel } = useSafeFieldLabel();
  const { t } = useDetailTranslation();
  // The boolean chip's word (objectui#11689) — the one every read-only boolean
  // word in `@object-ui/fields` reads, so this strip cannot say a different
  // word from the field the same record shows in its form.
  const booleanLabel = useBooleanValueLabel();
  // Shared record-level inline-edit session (objectui#2407 P2). Null when the
  // host doesn't wrap the page in an <InlineEditProvider> → strip stays
  // read-only, exactly as before.
  const inline = useInlineEdit();
  const editing = inline?.editing ?? false;
  const canEdit = inline?.canEdit ?? false;
  // The caller's permissions, for the field question the strip asks of each
  // highlight — the same one the details body asks (objectui#12103).
  const perms = usePermissions();
  // The host predicate scope a declared deadline's `settledWhen` is judged in
  // (objectui#11815), against the staged record below.
  const predicateScope = usePredicateScope();

  // The STAGED record: the saved record this strip receives, overlaid with the
  // edit session's draft by the same spread `DetailView` gives the details body
  // (objectui#7190). It is the ONE rule for "what is this record now" on this
  // strip — both what a `dependsOn` field scopes itself by (`dependentValues`,
  // its only channel since objectui#7206) and each field's own live value,
  // below. An OWN draft key wins even when its value is `undefined`: that is an
  // emptied field, not an untouched one.
  //
  // Memoised on its inputs as a render-cost hint only (AGENTS.md #10) — nothing
  // here depends on the identity it returns. Termination of an option widget's
  // cascade clear rests on the value read below, not on this memo: the widget's
  // offered `options` are rebuilt every render regardless.
  const draft = inline?.draft;
  const stagedRecord = React.useMemo(
    () => (data && draft ? { ...data, ...draft } : data),
    [data, draft],
  );

  if (!fields.length || !data) return null;

  // In read mode we hide value-less fields to keep the strip dense; WHILE
  // EDITING we keep them so the user can fill an empty highlight in place.
  const hasValue = (f: HighlightField) => {
    const val = data?.[f.name];
    return val !== null && val !== undefined && val !== '';
  };
  const visibleFields = editing ? fields : fields.filter(hasValue);

  if (visibleFields.length === 0) return null;

  return (
    <TooltipProvider>
      <section
        className={cn(
          // De-boxed: render as a naked stats row with subtle bottom divider
          // instead of a filled Card. Keeps the page calm and lets the tab
          // strip below carry the visual anchor.
          '@container border-b border-border/60 pb-4',
          className,
        )}
        aria-label={t('detail.highlightsLabel')}
      >
        <div
          className={cn(
            'flex flex-wrap gap-y-4',
            // A chip's left border separates it from the chip BEFORE it on its
            // line (objectui#12523). The first chip of every WRAPPED line used
            // to keep that border and its left padding, so a second line read
            // as an indented list under a flush first line. No selector can
            // name "the first chip of a line", so from `sm` up the row is
            // pulled left by exactly one chip's border and left padding, and
            // a clip at the strip's own left edge hides whatever lands there:
            // that is every line-start border and nothing else. The clip
            // leaves `--spacing * 1.5` of the padding visible, the bleed of an
            // editable value's hover background (`-mx-1.5`), and does not clip
            // the other three sides. Below `sm` there is no border to hide
            // (each chip is its own line, see the chip classes).
            'sm:-ml-[calc(var(--spacing)*5+1px)]',
            'sm:[clip-path:inset(-100vmax_-100vmax_-100vmax_calc(var(--spacing)*3.5+1px))]',
          )}
        >
          {visibleFields.map((field) => {
            const rawValue = data[field.name];
            // Enrich field metadata from objectSchema
            const objectDefField = objectSchema?.fields?.[field.name];
            const resolvedType = field.type || objectDefField?.type;
            // Shared with DetailSection (`enrichDetailField`) so the highlights
            // strip and the details body resolve an identical field shape —
            // including the relational keys a lookup picker needs (`multiple`,
            // display/id fields, picker config), and the `reference` target
            // backend schemas use.
            const enrichedField = enrichDetailField(
              { name: field.name, label: field.label, type: resolvedType || 'text' },
              objectDefField,
            );

            // Live value = the field's entry in the STAGED record (objectui#2407
            // P2): the draft's own key when the session has one — even an
            // `undefined` one — else the saved value. This used to read
            // `undefined` as "untouched" and fall back to the saved value, which
            // disagreed with the record handed to the widgets: a cascade clear
            // that emptied a value the parent no longer offers was handed the
            // saved value again, emptied it again, and looped forever
            // (objectui#7190, contract review on PR #10255). Same rule as the
            // details body, which reads `DetailView`'s merged record.
            const value = stagedRecord ? stagedRecord[field.name] : rawValue;

            // Field-level editability gate — shares `isComputedFieldType` with
            // DetailSection so the strip and the body agree on which highlights
            // are editable. Computed types (formula/summary/rollup/auto_number),
            // `readonly` (view OR object metadata), and immutable system/audit
            // fields never edit.
            //
            // The gate takes the authored type and the object type SEPARATELY,
            // not `resolvedType` — an authored display `type` can narrow
            // editability but never widen it (objectui#3355). `resolvedType`
            // keeps its display precedence for renderer selection just below.
            const isComputed = isComputedFieldType(field.type, objectDefField?.type);
            const isReadonly =
              field.readonly === true || objectDefField?.readonly === true;
            const isSystem = NON_EDITABLE_SYSTEM_FIELDS.has(field.name);
            // Same shared exclusion the details body and the grid consult, so a
            // credential chip never opens the plain text editor that would show
            // its mask as the value and write it back (objectui#4221). Union of
            // the two types, like the computed gate above.
            const isInlineExcluded = isInlineExcludedDetailFieldType(
              field.type,
              objectDefField?.type,
            );
            // The CALLER's write grant on this field (objectui#12103): the
            // `recordEdit` row's field question, asked exactly as the details
            // body asks it, since the strip and the body are one edit session
            // with one Save. A field refused for this caller — `editable: false`
            // in their permission set, or the owner without the transfer grant
            // — exposes no editor here either.
            const isWriteGranted =
              !objectName || resolveFieldAffordance('recordEdit', perms, objectName, field.name);
            const fieldEditable =
              !isComputed && !isReadonly && !isSystem && !isInlineExcluded && isWriteGranted;
            const canInlineEditField = canEdit && fieldEditable;
            const editorActive = editing && canInlineEditField;

            // The renderer the chip DRAWS, which a declared `format` can change:
            // a `text` field with `format: 'phone'` draws the phone cell
            // (objectui#12523). Both the renderer and the wide-basis rule below
            // read this one value, so a chip is sized for what it shows.
            const drawnType = resolveCellRendererType(enrichedField as any) || resolvedType || 'text';

            // Use type-aware cell renderer — all renderers coerce values via
            // coerceToSafeValue() so even object/array data is safe (no error #310).
            const CellRenderer = getCellRenderer(drawnType);

            const isKpi =
              resolvedType === 'number' ||
              resolvedType === 'integer' ||
              resolvedType === 'currency' ||
              resolvedType === 'percent' ||
              resolvedType === 'decimal';
            // Two independent reasons a chip needs the wide basis, kept
            // separate because only one of them is a shared table:
            //  1. long-text DISPLAY types, whose value simply does not fit a
            //     9rem column — this surface's own list. `phone` joined it in
            //     objectui#11659: its cell draws a dial icon and a copy button
            //     around the number inside an `inline-flex` box, and the
            //     `truncate` span below cannot put an ellipsis on an
            //     inline-flex child — it clips it. A 9rem chip cut
            //     `0574-8765-4321` to `0574-876` with no ellipsis; the wide
            //     basis shows a whole number;
            //  2. REFERENCE-BEARING types, whose inline editor is a record
            //     picker (see the `dataSource` prop doc above, which already
            //     names `lookup` / `user` together as the reference editors).
            // The second is NOT restated here: it is `EXPANDABLE_FIELD_TYPES`
            // in `@object-ui/core`, the one relational family every other face
            // reads (objectui#4770 / #4790 / #4815 / #5312 / #5692). The
            // literal that stood here diverged in BOTH directions
            // (objectui#5874): it lacked `user` and `tree` — whose picker needs
            // the same room as `lookup`'s, so gaining them RESTORES the stated
            // rule — and it carried `reference`, a spelling neither source of
            // `resolvedType` can produce (`HighlightField['type']` is a closed
            // union without it, and `@objectstack/spec`'s `FieldType` refuses
            // it), exactly where `owner` sat before objectui#4814 retired it.
            //
            // Pinned by an identity spy on that `has`. Extending this surface
            // later: OR in another surface-local disjunct, the way (1) is
            // written. Never `new Set([...EXPANDABLE_FIELD_TYPES, ...])`.
            //
            // (1) reads `drawnType`, not `resolvedType` (objectui#12523): it is
            // about what the chip DISPLAYS. A `text` field declared
            // `format: 'phone'` drew the phone cell on the 9rem basis, which
            // is the cut objectui#11659 gave phones the wide basis to stop;
            // the HotCRM lead read "+1-555-0" that way. (2) is about the
            // editor, which the declared type picks, so it keeps
            // `resolvedType`.
            const isWide =
              drawnType === 'email' ||
              drawnType === 'url' ||
              drawnType === 'phone' ||
              drawnType === 'textarea' ||
              (!!resolvedType && EXPANDABLE_FIELD_TYPES.has(resolvedType));
            const isBoolean = resolvedType === 'boolean';
            // The SAME definition the body grid draws its em-dash from
            // (`./emptiness`, objectui#8376/#8394). This strip sits between the
            // page H1 and the body grid, and the H1's own authority
            // (`recordDisplayValueAt`) trims — so a raw test here made this the
            // one band on the page still calling a whitespace-only value FILLED
            // and painting a blank chip where the em-dash belongs. Objects stay
            // values: they go to `CellRenderer` below, which knows how to draw
            // them.
            const isEmpty = !hasCellValue(value);

            // Compact-layout UX: an editor (select / date / lookup) needs more
            // room than a KPI number, so an actively-edited column widens to the
            // "wide" basis and renders the input full-width (Salesforce-style
            // expand-on-edit) instead of cramming it into a 9rem column.
            const useWide = isWide || editorActive;

            // How the row's width is shared (objectui#11684). The basis is the
            // column's FLOOR, and line breaking still reads it, so which chips
            // share a line is what it always was. `grow` then hands the line's
            // free width to the columns, and `max-w-max` caps each one at its
            // own content: a column that already fits stops growing and the
            // rest of the free width goes on to the columns that still need
            // it. A value truncates only once its line has no free width left.
            //
            // The old fixed caps (16rem / 24rem, no grow) cut "QA Widget 1" to
            // "QA Wid…" in a 9rem chip with most of the drawer row empty. The
            // content cap keeps what those caps were for: no column is ever
            // wider than what it shows, so a sparse strip still packs left
            // and the hover pencil stays beside its value.
            //
            // The floor is a min-width as well as the basis, so a short value
            // keeps its 9rem column. The `min(…, 100%)` lets a column narrow to
            // the row when the row itself is narrower than the floor.
            //
            // What a chip that runs out of line does (objectui#12523): no chip
            // is ever wider than its line — the floors decide the lines and
            // `grow` only hands out what is left — so a value is cut by the
            // value span below, never by the row. That span draws an ellipsis
            // and carries the whole value as its `title`; the link cells
            // (email / url / phone) used to defeat the ellipsis, because each
            // was one atomic inline box, and now fit a bounded slot themselves
            // (`@object-ui/fields`). `max-w-max` stays: it is what passes a
            // fitting chip's share of the free width on to the chips that
            // still need it.
            //
            // Every chip carries the separator; the row hides it at the start
            // of each line (see the row above), so a wrapped line starts flush
            // like the first one.
            //
            // Below `sm` the strip is ONE layout (objectui#12523): every chip
            // is a full-width line with no separator and no padding. At a
            // 358px row two columns leave a value about 150px, which cuts the
            // HotCRM lead's phone number and email, while a full line shows
            // both whole; and a touch screen cannot hover a `title`. The
            // classes are the same for every chip, wide or not, so no chip
            // can fall back to the wrapping layout.
            return (
              <div
                key={field.name}
                className={cn(
                  'group flex flex-col gap-1 px-5 border-l border-border/60',
                  'grow max-w-max',
                  useWide
                    ? 'basis-[16rem] min-w-[min(16rem,100%)]'
                    : 'basis-[9rem] min-w-[min(9rem,100%)]',
                  'max-sm:basis-full max-sm:max-w-full max-sm:border-l-0 max-sm:px-0',
                )}
              >
                <span className="text-xs font-medium text-muted-foreground">
                  {fieldLabel(objectName || '', field.name, field.label)}
                </span>

                {editorActive ? (
                  <>
                    <InlineFieldInput
                      field={enrichedField}
                      value={value}
                      onChange={(v) => inline!.setField(field.name, v)}
                      dataSource={dataSource}
                      autoFocus={inline!.autoFocusField === field.name}
                      error={inline!.fieldErrors?.[field.name]}
                      dependentValues={stagedRecord}
                    />
                    {/* The SERVER's reason for refusing this field, in place
                        (objectui#6868) — the highlights strip shares ONE edit
                        session with the details body, so a refusal marks the
                        field wherever the user is editing it. */}
                    {inline!.fieldErrors?.[field.name] && (
                      <p
                        role="alert"
                        data-inline-field-hint={field.name}
                        className="mt-1 text-xs text-destructive"
                      >
                        {inline!.fieldErrors[field.name]}
                      </p>
                    )}
                  </>
                ) : (
                  <div
                    className={cn(
                      'flex items-start justify-between gap-1',
                      // Editable highlights hint interactivity on hover and enter
                      // edit on double-click (matches the details body).
                      canInlineEditField &&
                        'cursor-pointer rounded-md -mx-1.5 px-1.5 hover:bg-muted/40 transition-colors',
                    )}
                    onDoubleClick={
                      canInlineEditField ? () => inline!.enter(field.name) : undefined
                    }
                    title={canInlineEditField ? t('detail.editInlineHint') : undefined}
                  >
                    <div className="min-w-0 flex-1">
                      {isBoolean ? (
                        value ? (
                          <span className="inline-flex items-center gap-1 self-start rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 ring-1 ring-inset ring-emerald-500/30 dark:text-emerald-400">
                            <Check className="h-3 w-3" aria-hidden />
                            {booleanLabel(true)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 self-start rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-500/30 dark:text-amber-400">
                            <X className="h-3 w-3" aria-hidden />
                            {booleanLabel(false)}
                          </span>
                        )
                      ) : isEmpty ? (
                        // The SHARED placeholder (objectui#8506). This span
                        // spelled its own em-dash and resolved its own
                        // `aria-label` from `detail.noValue`; `EmptyValue`
                        // resolves EXACTLY that key with the same `"No value"`
                        // English fallback, so the accessible name survives
                        // byte-for-byte in every locale. Unlike the body grid's
                        // placeholder this one carries NO `title`, so nothing
                        // here needs `pointer-events` back — the strip's chip
                        // keeps its own `onDoubleClick`, which fires from the
                        // chip, not from the dash.
                        //
                        // `block` is layout, not typography: the filled branch
                        // below is a `block` span inside the same
                        // `min-w-0 flex-1` box, and an inline dash would sit on
                        // a different baseline. The retired
                        // `text-sm text-muted-foreground/60` IS a deliberate
                        // typography change — it made the strip's own dash a
                        // different grey from the one a cell renderer draws for
                        // a chip two columns over.
                        <EmptyValue className="block" />
                      ) : (
                        <span
                          // Hover reveals the full value; for option-backed
                          // fields prefer the option LABEL over the raw
                          // stored value ('Technology', not 'technology').
                          title={
                            (Array.isArray((enrichedField as any).options)
                              ? (enrichedField as any).options.find(
                                  (o: any) => o?.value === value,
                                )?.label
                              : undefined) ??
                            (typeof value === 'string' || typeof value === 'number'
                              ? String(value)
                              : undefined)
                          }
                          className={cn(
                            'block min-w-0 truncate text-sm font-semibold',
                            isKpi && 'tabular-nums tracking-tight',
                          )}
                        >
                          <CellRenderer
                            value={value}
                            field={enrichedField as any}
                            deadlineSettled={isDeadlineSettled(enrichedField, stagedRecord, { scope: predicateScope, fields: objectSchema?.fields })}
                            // Every date in the strip writes its year
                            // (objectui#13331). The chips are read side by
                            // side, so a current-year date without its year
                            // ("End Date Sep 15") beside a past-year one
                            // ("Start Date Sep 15, 2025") read as next month.
                            // Grid cells keep the shared face that drops it.
                            alwaysShowYear
                          />
                        </span>
                      )}
                    </div>
                    {canInlineEditField && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            aria-label={t('detail.editInlineHint')}
                            onClick={(e) => {
                              e.stopPropagation();
                              inline!.enter(field.name);
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t('detail.editInlineHint')}</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </TooltipProvider>
  );
};
