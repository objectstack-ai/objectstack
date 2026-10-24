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
  Card, 
  CardHeader, 
  CardTitle, 
  CardContent, 
  Collapsible, 
  CollapsibleTrigger, 
  CollapsibleContent,
  Button,
  EmptyValue,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useIsMobile,
  LazyIcon,
} from '@object-ui/components';
import { ChevronDown, ChevronRight, Copy, Check, Eye, EyeOff, Pencil } from 'lucide-react';
import { SchemaRenderer, toRenderableSchema, useInlineEdit, usePrintPage, usePredicateScope } from '@object-ui/react';
import { resolveFieldAffordance, isDeadlineSettled } from '@object-ui/core';
import { usePermissions } from '@object-ui/permissions';
import {
  BooleanCellRenderer,
  getCellRenderer,
  resolveCellRendererType,
  useBooleanValueLabel,
  resolveRecordPointer,
  RECORD_POINTER_CARD_TYPE,
  coerceToSafeValue,
  TextAreaField,
} from '@object-ui/fields';
import type { DetailViewSection as DetailViewSectionType, DetailViewField, FieldMetadata } from '@object-ui/types';
import { applyDetailAutoLayout } from './autoLayout';
import { useDetailTranslation } from './useDetailTranslation';
import { useSafeFieldLabel } from '@object-ui/react';
import { NON_EDITABLE_SYSTEM_FIELDS } from './systemFields';
import { InlineFieldInput } from './InlineFieldInput';
import { headerColorClass } from './headerColor';
import { hasCellValue } from './emptiness';
import {
  enrichDetailField,
  isComputedFieldType,
  isInlineExcludedDetailFieldType,
  isMaskedDetailFieldType,
} from './fieldEnrichment';

/**
 * Section-header icon. `fieldGroups[].icon` declares a Lucide name (spec),
 * so ASCII-identifier-ish values render as the real icon; anything else
 * (emoji / CJK text from hand-authored sections that predate the spec key)
 * keeps the historical text rendering instead of degrading to the generic
 * fallback icon.
 */
const SectionIcon: React.FC<{ name: string }> = ({ name }) => {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) {
    return <span className="text-muted-foreground">{name}</span>;
  }
  return <LazyIcon name={name} className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />;
};

/**
 * Compute responsive col-span classes so that col-span never exceeds the
 * visible column count at each Tailwind breakpoint.
 *
 * For columns=1: no span class (always single column)
 * For columns=2: md:col-span-{min(span,2)}
 * For columns=3: md:col-span-{min(span,2)} lg:col-span-{min(span,3)}
 * For columns>=4: …lg:col-span-{min(span,3)} xl:col-span-{min(span,4)}
 *
 * Mirrors the grid's breakpoint ladder (md→2, lg→3, xl→4) so a wide field
 * never spans more cells than exist at any breakpoint (objectui#2578).
 */
export function getResponsiveSpanClass(span: number | undefined, columns: number): string {
  if (!span || span <= 1 || columns <= 1) return '';

  if (columns === 2) {
    return span >= 2 ? 'md:col-span-2' : '';
  }

  if (columns === 3) {
    if (span === 2) return 'md:col-span-2';
    if (span >= 3) return 'md:col-span-2 lg:col-span-3';
    return '';
  }

  // columns >= 4: grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4
  if (span === 2) return 'md:col-span-2';
  if (span === 3) return 'md:col-span-2 lg:col-span-3';
  if (span >= 4) return 'md:col-span-2 lg:col-span-3 xl:col-span-4';

  return '';
}

/**
 * The `onChange` a read display is handed. `TextAreaField`'s `readonly` branch
 * renders no control and never calls it; the widget contract requires the slot.
 */
const ignoreReadOnlyChange = (): void => {};

/**
 * Whether a key pressed on a copy-on-activate row is the ROW's own activation
 * (objectui#12569): Enter or Space, aimed at the row itself.
 *
 * The row is a `role="button"` with its own tab stop, but its value cell can
 * draw focusable content of its own: a lookup's link to the referenced record,
 * the record-pointer card's links, the row's hover copy button. A key pressed
 * on any of those bubbles to the row's handler, and a `preventDefault` there
 * cancels the descendant's own activation, so Enter on a link inside the row
 * copied the row's raw value instead of following the link.
 *
 * So the row acts only when the event's target IS the row. A key aimed at
 * anything inside it is left to that element: no `preventDefault`, no copy. A
 * link opens; the hover copy button still copies, through its own click.
 *
 * Both row shapes (the mobile grouped-inset row and the default row) read this
 * one predicate. ⛔ Not a `stopPropagation` on each link instead: that fixes
 * one descendant kind at a time and leaves the next one cancelled.
 */
function isRowActivationKey(e: React.KeyboardEvent<HTMLElement>): boolean {
  if (e.target !== e.currentTarget) return false;
  return e.key === 'Enter' || e.key === ' ';
}

export interface VirtualScrollOptions {
  /** Enable virtual scrolling for large field sets */
  enabled?: boolean;
  /** Height of each field row in px (default: 60) */
  itemHeight?: number;
  /** Number of fields to render in the initial batch before revealing all (default: 20) */
  batchSize?: number;
}

export interface DetailSectionProps {
  section: DetailViewSectionType;
  data?: any;
  className?: string;
  /** Object schema from DataSource for field type enrichment */
  objectSchema?: any;
  /** Object name for i18n field label resolution */
  objectName?: string;
  /** Whether inline editing is active */
  isEditing?: boolean;
  /** Callback when a field value changes during inline editing */
  onFieldChange?: (field: string, value: any) => void;
  /**
   * Enter inline-edit mode focused on a specific field — wired to the per-field
   * double-click / hover-pencil affordances. Supplied ONLY when the record is
   * inline-editable (object lifecycle + permission gated upstream), so its
   * presence is what surfaces those affordances.
   */
  onEnterInlineEdit?: (fieldName: string) => void;
  /** Field to auto-focus when inline edit is entered from a field. */
  autoFocusField?: string | null;
  /** DataSource used by reference (lookup/master_detail/user) widgets during inline editing */
  dataSource?: any;
  /** Virtual scrolling configuration for sections with many fields */
  virtualScroll?: VirtualScrollOptions;
}

export const DetailSection: React.FC<DetailSectionProps> = ({
  section,
  data,
  className,
  objectSchema,
  objectName,
  isEditing = false,
  onFieldChange,
  onEnterInlineEdit,
  autoFocusField,
  dataSource,
  virtualScroll,
}) => {
  const [collapsedState, setIsCollapsed] = React.useState(section.defaultCollapsed ?? false);
  // objectui#11958 — on a page that declares `print`, a collapsible section
  // draws open: Radix unmounts a closed section's content, so a section
  // collapsed on screen never reaches paper, and `record:details` is in the
  // printable block subset because it prints every field it declares. Off a
  // print page the toggle is unchanged. Read once, above every early return:
  // the empty-field heuristic below reads the same answer (objectui#12717).
  const isPrintPage = usePrintPage() !== null;
  const isCollapsed = !isPrintPage && collapsedState;
  const [copiedField, setCopiedField] = React.useState<string | null>(null);
  const [visibleCount, setVisibleCount] = React.useState<number | undefined>(undefined);
  const [showEmptyOverride, setShowEmptyOverride] = React.useState(false);
  const { t } = useDetailTranslation();
  // The word a read-only boolean row is drawn with (objectui#12933): the same
  // `common.yes` / `common.no` pair every read-only boolean face reads
  // (objectui#11689), not a second word pair. Read once, above every early
  // return, so the hook count does not move with the section's contents.
  const booleanLabel = useBooleanValueLabel();
  const { fieldLabel, translateOptions } = useSafeFieldLabel();
  /**
   * The SERVER's per-field refusals from the last rejected inline save
   * (objectui#6868), read straight off the shared edit session so the reason
   * lands beside the input the server named. `null` outside an
   * `<InlineEditProvider>` — a bare / read-only `DetailSection` simply has no
   * session to read, exactly as it has no draft.
   */
  const serverFieldErrors = useInlineEdit()?.fieldErrors ?? null;
  /**
   * The caller's permissions, for the field question in-place edit asks of each
   * field (objectui#12103). With no provider mounted `isLoaded` is false and
   * the question is not asked, so a bare `DetailSection` behaves as before.
   */
  const perms = usePermissions();
  /**
   * The host predicate scope a declared deadline's `settledWhen` is judged in
   * beside this record (objectui#11815) — the scope the grid reads too.
   */
  const predicateScope = usePredicateScope();

  /**
   * What the copy affordance WRITES (objectui#8395).
   *
   * `String(value)` on an object is the literal text `[object Object]`, so
   * every object-valued cell — address, geolocation, JSON, file, expanded
   * lookup, repeater — silently put a placeholder on the clipboard, while the
   * cell BESIDE the button rendered that same value correctly. Objects are
   * serialized as JSON here instead: lossless, parseable, never
   * `[object Object]`.
   *
   * ## The JSON blob is a DEFENSIBLE DEFAULT, NOT A SETTLED CONTRACT
   *
   * What an object cell *should* put on the clipboard is a product question
   * with several defensible answers per kind — the formatted postal address
   * the reader can see, `lat, lng` for a geolocation, a filename for a file,
   * the option labels or the stored values for a multiselect. That contract is
   * objectui#8395's OPTION B (a shared value-to-text formatter that REUSES the
   * cell renderers' own formatters — `formatAddress`, objectui#4037 — rather
   * than re-spelling them), and it is a SEPARATE, still-unspecified card.
   * ⛔ Do not read this line as the answer to it.
   *
   * ## Two shapes were measured and REJECTED — do not reach for them
   *
   * Copying the cell's RENDERED text is the worse contract for 9 of 17 field
   * types and loses data silently: `date` renders `Mar 4` (the year is gone),
   * `percent` renders `12%` against a stored `0.123` (a different quantity),
   * `datetime` concatenates to an unparseable `3/4/20265:06 am`, and `image`
   * and `boolean` render no text at all — so it would copy the empty string,
   * which is strictly worse than the defect it set out to fix. And withdrawing
   * the affordance from text-less cells would narrow `canCopy` away from
   * `hasCellValue`, whose three readers MUST agree (see its docblock above).
   *
   * ## The non-regression half
   *
   * Non-objects keep `String(value)` BYTE-FOR-BYTE: a number still copies
   * `16`, never the rendered `16.00`; a select still copies its stored `won`,
   * never the rendered `Closed Won`. Pinned per kind — both halves — in
   * `__tests__/DetailSection.copyObjectValues-8395.test.tsx`.
   */
  const handleCopyField = React.useCallback((fieldName: string, value: any) => {
    let textValue: string;
    if (value === null || value === undefined) {
      textValue = '';
    } else if (typeof value === 'object') {
      // The same guard `JsonCellRenderer` already applies to this exact
      // operation on this exact value: a structure `JSON.stringify` cannot
      // represent (a cycle) keeps today's string form rather than throwing out
      // of a click handler, and the row stays consistent with its own cell.
      try {
        textValue = JSON.stringify(value);
      } catch {
        textValue = String(value);
      }
    } else {
      textValue = String(value);
    }
    navigator.clipboard.writeText(textValue).then(() => {
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(null), 2000);
    });
  }, []);

  // Identify empty fields once for both filtering and the toggle counter —
  // through `hasCellValue` in `./emptiness`, the ONE definition this file
  // shares with the em-dash affordance, the copy affordance (objectui#8376)
  // and, since objectui#8394, every other band of the record page.
  const isEmptyValue = React.useCallback((field: DetailViewField) => {
    return !hasCellValue(data?.[field.name] ?? field.value);
  }, [data]);

  const emptyCount = React.useMemo(
    () => section.fields.filter(isEmptyValue).length,
    [section.fields, isEmptyValue]
  );

  // Auto-hide-empty heuristic — the whole contract for the empty ROWS of a
  // section that still has a filled one (objectui#7129 Q2-C, maintainer
  // 2026-09-01, untouched by objectui#8603). When a section has empty rows AND
  // at least one filled row, hide the empties so the page does not become a
  // label-graveyard. The user can still reveal them with the toggle. An
  // authored `hideEmpty` does NOT override this branch in either polarity —
  // it never could: the read was `!section.hideEmpty`, so a written `false`
  // was indistinguishable from unauthored, which is the paradox Q2-C settled.
  //
  // The ALL-EMPTY case is the other domain, and it is `hideEmpty`'s — see
  // `allFieldsEmpty` below. The two are disjoint by construction: this
  // heuristic requires `filledCount > 0`, that one requires `filledCount === 0`.
  //
  // Thresholds were tightened in Phase N (2026-05): smaller sections (≥4
  // fields) and a lower empty ratio (≥25%) now trigger auto-hide so pages
  // start dense by default rather than sparse. Mobile remains the most
  // aggressive variant since vertical real estate is scarce.
  //
  // objectui#12717 — off on a page that declares `print`. The heuristic is a
  // SCREEN density call nobody authored (it reads the viewport and a ratio),
  // and its "Show N empty fields" toggle is a control that reached paper while
  // the empty rows it hid did not. `record:details` is in the printable block
  // subset because it prints every field it declares (objectui#11958), so on
  // paper every declared row prints and, with nothing hidden, there is no
  // toggle. ⛔ Not a `print:hidden` on the button: the rows would still be
  // missing. The AUTHORED all-empty hide below is not gated: it is what the
  // section declares, and it leaves no control behind.
  const isMobile = useIsMobile();
  const AUTO_HIDE_MIN_FIELDS = isMobile ? 3 : 4;
  const AUTO_HIDE_RATIO = isMobile ? 0.2 : 0.25;
  const filledCount = section.fields.length - emptyCount;
  const shouldAutoHideEmpty =
    !isPrintPage &&
    !isEditing &&
    section.fields.length >= AUTO_HIDE_MIN_FIELDS &&
    emptyCount / section.fields.length >= AUTO_HIDE_RATIO &&
    filledCount > 0;

  // The authored `record:details` section key, restored under objectui#8603
  // (director seat batch #137 item 3, maintainer 2026-09-15) after
  // objectui#7129 retired it on the premise that `@objectstack/spec` refused
  // the key — a premise the 17.3.0 pin move made false. The spec declares it
  // on `RecordDetailsProps.sections[]` and its describe() promises exactly
  // this: hiding is the renderer default, an all-empty section then renders
  // nothing at all (no heading, no skeleton), and `false` keeps the heading
  // and the label skeleton on an all-empty record.
  //
  // ⚠️ `=== true`, and the DEFAULT IS NOT HERE. `RecordDetailsRenderer`
  // resolves it (`hideEmpty: s.hideEmpty ?? true` on the authored section),
  // because "the renderer default" in that describe() is the default of the
  // renderer the key is DECLARED on. This component also receives sections
  // that default must not reach. The `record:details` direct-`fields`
  // fallback body synthesizes one nobody could write the key on, and hiding
  // it would be a hide with no declarable spelling to ask the skeleton back,
  // which is the exact defect upstream declared the key to fix. The
  // `detail-section` node declares `hideEmpty` (objectui#10485) but resolves
  // no default of its own, so an omitted key keeps the skeleton there too and
  // only an authored `true` hides. A truthiness test
  // (`!section.hideEmpty`) is banned for the mirror-image reason: it is what
  // made an authored `false` indistinguishable from unauthored before #7129.
  //
  // ⚠️ `!isEditing` is this renderer's boundary on the contract, and it is
  // deliberate: inline-edit mode is the surface where those empty rows are the
  // INPUTS. Hiding an all-empty section there would put its fields out of the
  // author's and the user's reach entirely, which no describe() asks for and
  // which would be a new defect rather than a restored behaviour. What the
  // contract governs is what a READER sees, and that is what this leaves
  // unchanged.
  const allFieldsEmpty = section.fields.length > 0 && filledCount === 0;
  const hideAllEmptySection = section.hideEmpty === true && allFieldsEmpty && !isEditing;

  const hideEmptyEffective =
    !showEmptyOverride && (shouldAutoHideEmpty || hideAllEmptySection);

  // Filter out empty fields when the auto-hide heuristic kicked in, or when an
  // all-empty section is hiding itself (its early return is below every hook).
  const visibleFields = hideEmptyEffective
    ? section.fields.filter((field) => !isEmptyValue(field))
    : section.fields;

  // Apply auto-layout: infer columns and auto-span wide fields
  const { fields: layoutFields, columns: rawColumns } = applyDetailAutoLayout(
    visibleFields,
    section.columns
  );
  // Never render more columns than there are visible fields — the object-wide
  // column count (objectui#2578) can exceed a section's visible count when
  // empty fields are hidden; a lone field shouldn't sit at 1/N width.
  const effectiveColumns = Math.min(rawColumns, Math.max(1, visibleFields.length));

  const renderField = (field: DetailViewField) => {
    const value = data?.[field.name] ?? field.value;
    
    // If custom renderer provided
    if (field.render) {
      return <SchemaRenderer schema={toRenderableSchema(field.render)} data={{ ...data, value }} />;
    }

    // Calculate responsive span class so col-span never exceeds the visible
    // column count at each breakpoint, preventing implicit columns on mobile.
    const spanClass = getResponsiveSpanClass(field.span, effectiveColumns);

    // Enrich field with objectSchema metadata once — used by both the
    // read-only cell renderer and the inline-edit widget so that things
    // like select options, currency code, lookup target, etc. are
    // available in either mode.
    const objectDefField = objectSchema?.fields?.[field.name];
    const enrichedField = enrichDetailField(field as Record<string, any>, objectDefField);
    if (objectName && Array.isArray(enrichedField.options) && enrichedField.options.length > 0) {
      enrichedField.options = translateOptions(objectName, field.name, enrichedField.options as any);
    }

    // Inline-edit eligibility for THIS field. Mirrors the input-branch gate so
    // the pencil / double-click affordance appears iff the field can actually
    // become an input: computed types (formula/summary/rollup/auto_number) and
    // fields explicitly flagged `readonly` are never editable. `onEnterInlineEdit`
    // is only threaded when the record itself is inline-editable, so its presence
    // carries the object-lifecycle + permission gate.
    // Read the authored view type and the object type SEPARATELY — the gate is
    // the UNION of the two, so an authored display `type` (which still drives
    // renderer/editor selection through `enrichedField.type`) can narrow
    // editability but never widen it (objectui#3355). Shared with
    // HeaderHighlight via `isComputedFieldType` so the two can't drift.
    const isComputedField = isComputedFieldType(field.type, objectDefField?.type);
    // Honor the OBJECT metadata's read-only flag too — the enrichment above
    // intentionally doesn't copy `readonly` into enrichedField, so read it
    // straight off objectDefField (covers formula / non-updateable fields the
    // framework flags `readonly:true` even when the view schema doesn't). And
    // never offer inline edit on immutable audit/identity fields by name
    // (created_at / id / …), in case a schema surfaces one as a section row.
    const isReadonly = field.readonly === true || objectDefField?.readonly === true;
    const isSystemField = NON_EDITABLE_SYSTEM_FIELDS.has(field.name);
    // Types the fields package excludes from in-place editing — the SAME
    // alias-aware contract the grid consults, not a second list (objectui#4221).
    // `password` / `secret` are masked on read, so the row has no real value to
    // seed an editor with and the fallback below is a PLAIN TEXT input: it
    // rendered the mask as the value and wrote it back over the credential.
    // The container family rode the same fallback with an object-shaped value.
    // Read as the same narrow-only UNION as `isComputedFieldType` (#3355).
    const isInlineExcluded = isInlineExcludedDetailFieldType(field.type, objectDefField?.type);
    // Types whose CELL is drawn as a mask (`password` / `secret`). Read the two
    // types SEPARATELY for the same narrow-only union as the gates above
    // (objectui#3355). Consumed by the copy affordance below — the mask and the
    // clipboard are the READ direction of the same refusal, and `isInlineExcluded`
    // (objectui#4221) already holds the WRITE direction of it.
    const isMaskedField = isMaskedDetailFieldType(field.type, objectDefField?.type);
    // The CALLER's write grant on this field (objectui#12103): the field
    // question of the `recordEdit` row of the affordance-to-grant map, the same
    // `write` question an edit form asks (`fieldWriteGate`). A field the
    // permission set marks `editable: false` — or the owner field without the
    // transfer grant — stays a read display, so in-place edit never offers a
    // write the server refuses with 403. The flags above are the object's; this
    // one is the principal's, and it only narrows.
    const isWriteGranted = !objectName || resolveFieldAffordance('recordEdit', perms, objectName, field.name);
    const fieldEditable =
      !isReadonly && !isComputedField && !isSystemField && !isInlineExcluded && isWriteGranted;
    const canInlineEditField = fieldEditable && !!onEnterInlineEdit;

    const displayValue = (() => {
      const isEmpty = !hasCellValue(value);
      if (isEmpty) {
        // The SHARED placeholder (objectui#8506). The span that stood here
        // spelled its own em-dash and resolved its own `aria-label` from
        // `detail.noValue`; `EmptyValue` resolves EXACTLY that key, with the
        // same `"No value"` English fallback, through a provider-safe hook — so
        // the accessible name survives byte-for-byte in every locale and the
        // duplicate resolution goes away. Two deliberate props:
        //
        //  - `title` — the sighted-mouse counterpart of the accessible name,
        //    added alongside it in the same commit. It rides through
        //    `EmptyValue`'s `...props`. `pointer-events-auto` is what keeps it
        //    a real tooltip: the shared component sets `pointer-events-none`,
        //    which stops the placeholder being a hit target, and a `title` on
        //    an element that can never be hovered is a dead attribute — the
        //    hover would fall through to this row's own
        //    `title={t('detail.editInlineHint')}` instead. It is also the only
        //    instrument that tells THIS placeholder apart from the one a cell
        //    renderer draws one row over (`DetailSection.emptinessAuthority-8376`,
        //    `record-details.emptySectionDefault`), which read it by title.
        //  - no `className` typography — the retired `text-muted-foreground/60
        //    text-sm` is a deliberate change, not an oversight: it made this
        //    row's dash a different grey and a different size from the dash
        //    `DateTimeCellRenderer` draws for an unparseable value in the very
        //    next row of the same section. They now draw identically.
        return (
          <EmptyValue
            className="pointer-events-auto"
            title={t('detail.noValue', { defaultValue: 'No value' })}
          />
        );
      }
      // A polymorphic pointer pair (`referenceVia`, objectui#12045): the field's
      // value is a record id of the object the SIBLING column names on this
      // row, so it is resolved here, where the row is in hand, by the one rule
      // `@object-ui/fields` owns. The pair is the renderer's `value`; the
      // default face draws the record id as text, and a host that can read
      // records registers its own under the same key. `referenceVia` is read
      // off the OBJECT field (the spec declares it there), and `type` off the
      // enriched field, so a view that re-types the field keeps its own face.
      // `referenceDeletedWhen` rides beside it (objectui#12489): the rule
      // decides whether this row asserts the target deleted, and takes the
      // option's label from the sibling's options translated exactly as this
      // grid translates a `select` field's options above, so the tombstone
      // reads as that option reads in its own cell.
      const pointer = resolveRecordPointer(
        {
          name: field.name,
          type: enrichedField.type,
          referenceVia: objectDefField?.referenceVia,
          referenceDeletedWhen: objectDefField?.referenceDeletedWhen,
        },
        data,
        (siblingName) => {
          const options = objectSchema?.fields?.[siblingName]?.options;
          return objectName && Array.isArray(options) && options.length > 0
            ? translateOptions(objectName, siblingName, options)
            : options;
        },
      );
      if (pointer) {
        const PointerRenderer = getCellRenderer(RECORD_POINTER_CARD_TYPE);
        return <PointerRenderer value={pointer} field={enrichedField as unknown as FieldMetadata} />;
      }
      // Use type-aware cell renderer; respect format hints (e.g.
      // text + format: 'phone' → PhoneCellRenderer with tel: link).
      const resolvedType = resolveCellRendererType(enrichedField as { type?: string; format?: string }) || field.type;
      // `textarea` reads through `TextAreaField`'s own read display, the
      // `readonly` branch the record form shows it with (objectui#11577) — the
      // read half of what `InlineFieldInput` does for edit mode (objectui#11562).
      // The cell renderer table maps `textarea` to `TextCellRenderer`, the
      // GRID's one-line cell (`truncate`: no wrap, an ellipsis), which folded a
      // multi-line note onto one line here. That mapping is right for a grid
      // row and stays; this row is not one. ⛔ No second hand-written
      // `whitespace-pre-wrap` copy here: the widget owns its read display.
      // The value goes through `coerceToSafeValue` and `String`, exactly what
      // `TextCellRenderer` drew from, so a string passes byte for byte and a
      // non-string value reads as it did instead of reaching React as an object.
      if (resolvedType === 'textarea') {
        return (
          <TextAreaField
            field={enrichedField as unknown as FieldMetadata}
            value={String(coerceToSafeValue(value))}
            onChange={ignoreReadOnlyChange}
            readonly
          />
        );
      }
      if (resolvedType) {
        const CellRenderer = getCellRenderer(resolvedType);
        // A boolean the viewer cannot edit reads as a WORD, not as the grid's
        // checkbox (objectui#12933). `BooleanCellRenderer` draws a disabled
        // checkbox, which on a record page reads as a setting that cannot be
        // clicked. "Cannot edit" is `fieldEditable`, the per-field answer this
        // row already computes for its own edit affordance: the field's and
        // the object definition's `readonly`, the computed / system / excluded
        // types, and the caller's write grant. An editable boolean keeps the
        // checkbox, and so does a value that is not a boolean: the renderer's
        // own guard (objectui#8582) draws the shared "No value" affordance for
        // it, so `false` is never invented here. Matched by renderer identity,
        // so `toggle` reads the same and a host's own boolean face is kept.
        if (CellRenderer === BooleanCellRenderer && !fieldEditable && typeof value === 'boolean') {
          return booleanLabel(value);
        }
        if (CellRenderer) {
          return (
            <CellRenderer
              value={value}
              field={enrichedField as unknown as FieldMetadata}
              deadlineSettled={isDeadlineSettled(enrichedField, data, { scope: predicateScope, fields: objectSchema?.fields })}
            />
          );
        }
      }
      return String(value);
    })();
    // Same definition as the affordance above, deliberately: a row that says
    // `No value` must not also offer to copy it. Before objectui#8376 both
    // tests were raw and agreed by coincidence; fixing only the affordance
    // would have put a copy button next to an em-dash that copies spaces.
    const canCopy = hasCellValue(value);
    // ⭐ A MASKED row offers no copy affordance at all (objectui#8440, maintainer
    // ruling 2026-09-08 option A). The cell deliberately refuses to render the
    // value; the affordance on the same row handed the RAW credential to the
    // clipboard — silently, with no error and no visible sign, which is worse
    // than not masking at all because the reader believes the value is
    // protected. ⛔ The refusal is NOT spelled into `canCopy`: that name is one
    // of the readers of `hasCellValue` (objectui#8376) that MUST agree on which
    // rows are EMPTY, and a masked row is not an empty one — it is a row whose
    // value this surface declines to hand over. Narrowing there would move the
    // emptiness answer for every reader of it.
    //
    // ⛔ Nor is it spelled into `handleCopyField`: option B — copying the
    // bullets — was considered and refused as a second silent wrong answer, so
    // there is nothing for the handler to write. Withdrawing the affordance is
    // the whole fix, and it is withdrawn at EVERY site that reaches the handler
    // (the desktop row, its Enter/Space, its hover button, and the mobile
    // grouped-inset row's click and Enter/Space).
    const copyOffered = canCopy && !isMaskedField;
    // An editable field surfaces the pencil (edit) affordance instead of the
    // copy affordance, and reserves single-click for text selection — so
    // click-to-copy only applies to non-editable fields.
    const copyInteractive = copyOffered && !canInlineEditField;
    const isCopied = copiedField === field.name;
    const fieldLabelText = fieldLabel(objectName || '', field.name, field.label || field.name);

    // iOS-style grouped-inset row (mobile, read mode): label left, value right,
    // hairline-separated rows inside the section card. The native-feeling
    // settings/detail form for the mobile target. Editing falls back to the
    // stacked layout below so inputs have room.
    if (isMobile && !(isEditing && fieldEditable)) {
      return (
        <div
          key={field.name}
          className={cn(
            "flex items-baseline justify-between gap-4 py-2.5 min-h-[44px] group",
            copyOffered && "cursor-pointer active:bg-muted/40 transition-colors",
          )}
          onClick={copyOffered ? () => handleCopyField(field.name, value) : undefined}
          onKeyDown={copyOffered ? (e: React.KeyboardEvent<HTMLElement>) => {
            if (isRowActivationKey(e)) { e.preventDefault(); handleCopyField(field.name, value); }
          } : undefined}
          role={copyOffered ? 'button' : undefined}
          tabIndex={copyOffered ? 0 : undefined}
        >
          <span className="text-[15px] text-muted-foreground shrink-0">{fieldLabelText}</span>
          <span className="text-[15px] text-foreground text-right break-words min-w-0 leading-snug">{displayValue}</span>
        </div>
      );
    }

    // Default field rendering with copy button and touch-friendly targets
    // min-w-0: a grid item defaults to min-width:auto, so a long unbreakable
    // value (raw JSON, a GPS pair, a URL) sets the track's min width and
    // overflows into the neighbouring cell — visible once columns narrow
    // (objectui#2578). Allowing the item to shrink lets the value wrap.
    return (
      <div key={field.name} className={cn("space-y-1.5 group min-w-0", spanClass)}>
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {fieldLabel(objectName || '', field.name, field.label || field.name)}
        </div>
        {isEditing && fieldEditable ? (
          <div className="min-h-[44px] sm:min-h-0">
            <InlineFieldInput
              field={enrichedField}
              value={value}
              onChange={(v) => onFieldChange?.(field.name, v)}
              dataSource={dataSource}
              autoFocus={autoFocusField === field.name}
              error={serverFieldErrors?.[field.name]}
              // The record a `dependsOn` field scopes itself by — the only
              // channel it has (objectui#7190, objectui#7206). `DetailView`
              // hands this section the saved record already merged with the
              // inline draft, so a parent edited in this session re-scopes the
              // child before anything is saved.
              dependentValues={data}
            />
            {/* The SERVER's reason for refusing this field, in place
                (objectui#6868). Published by `<InlineEditSaveBar>` onto the
                shared session after a rejected save; the widget's #3222 slot
                only marks `aria-invalid`, so the visible text is drawn here —
                exactly as `form.tsx` draws it on the form surface rather than
                leaving it to the widget. Nothing on this path evaluates a
                rule: the server is the validation authority on this surface. */}
            {serverFieldErrors?.[field.name] && (
              <p
                role="alert"
                data-inline-field-hint={field.name}
                className="mt-1 text-xs text-destructive"
              >
                {serverFieldErrors[field.name]}
              </p>
            )}
          </div>
        ) : (
        <div
          className={cn(
            "flex items-start justify-between gap-2 min-h-[44px] sm:min-h-0 rounded-md",
            copyInteractive && "cursor-pointer active:bg-muted/60 transition-colors",
            // Editable fields hint interactivity on hover and enter edit on
            // double-click (Salesforce/Airtable pattern). The negative margin
            // keeps the hover highlight flush with the label above.
            canInlineEditField && "cursor-pointer hover:bg-muted/40 transition-colors -mx-1.5 px-1.5"
          )}
          onClick={copyInteractive ? () => handleCopyField(field.name, value) : undefined}
          onDoubleClick={canInlineEditField ? () => onEnterInlineEdit?.(field.name) : undefined}
          onKeyDown={copyInteractive ? (e: React.KeyboardEvent<HTMLElement>) => {
            if (isRowActivationKey(e)) {
              e.preventDefault();
              handleCopyField(field.name, value);
            }
          } : undefined}
          role={copyInteractive ? "button" : undefined}
          tabIndex={copyInteractive ? 0 : undefined}
          title={canInlineEditField ? t('detail.editInlineHint') : undefined}
        >
          <div className="text-sm flex-1 min-w-0 break-words py-1">
            {displayValue}
          </div>
          {canInlineEditField ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    aria-label={t('detail.editInlineHint')}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEnterInlineEdit?.(field.name);
                    }}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t('detail.editInlineHint')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : copyOffered ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    // objectui#12625 — an icon-only button; the tooltip is
                    // closed at rest, so without this it has no name.
                    aria-label={t('detail.copyToClipboard')}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopyField(field.name, value);
                    }}
                  >
                    {isCopied ? (
                      <Check className="h-3 w-3 text-green-600" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {isCopied ? t('detail.copied') : t('detail.copyToClipboard')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
        </div>
        )}
      </div>
    );
  };

  // Virtual scroll: progressive batch rendering for large field sets
  const vsEnabled = virtualScroll?.enabled === true;
  const vsBatchSize = virtualScroll?.batchSize ?? 20;
  /** Delay (ms) before revealing remaining fields after the initial batch */
  const VS_REVEAL_DELAY = 100;

  React.useEffect(() => {
    if (!vsEnabled) {
      setVisibleCount(undefined);
      return;
    }
    // Start with a batch, then progressively reveal more
    if (layoutFields.length <= vsBatchSize) {
      setVisibleCount(undefined);
      return;
    }
    setVisibleCount(vsBatchSize);
    const timer = setTimeout(() => setVisibleCount(undefined), VS_REVEAL_DELAY);
    return () => clearTimeout(timer);
  }, [vsEnabled, layoutFields.length, vsBatchSize]);

  // Hide entire section when all fields are empty AND the user has not asked to
  // reveal them. Who decides this is the authored `hideEmpty` (`hideEmptyEffective`
  // above, default on, `false` to keep the skeleton); this line is the mechanism
  // it reaches, which is why restoring the read there needed no new exit here.
  // This early return MUST come AFTER every hook above (including
  // the virtual-scroll useEffect) — never before. When a section is all-empty
  // on one render (early return, N hooks) but has data on the next render (the
  // useEffect runs, N+1 hooks) of the SAME reconciled fiber, the hook count
  // changes between renders and React throws error #300 ("rendered more hooks
  // than during the previous render"). This is the master-detail drill-in
  // crash: navigating account → project reuses this DetailSection fiber, and
  // its sections flip from empty to populated. Keeping the guard below all
  // hooks makes the hook count invariant.
  if (visibleFields.length === 0 && emptyCount === section.fields.length) return null;

  const renderedFields = visibleCount !== undefined
    ? layoutFields.slice(0, visibleCount)
    : layoutFields;

  const showEmptyToggle = emptyCount > 0 && shouldAutoHideEmpty;

  const content = (
    <>
      {isMobile ? (
        <div className="flex flex-col divide-y divide-border/60">
          {renderedFields.map(renderField)}
        </div>
      ) : (
        <div
          className={cn(
            "grid gap-3 sm:gap-4",
            effectiveColumns === 1 ? "grid-cols-1" :
            effectiveColumns === 2 ? "grid-cols-1 md:grid-cols-2" :
            effectiveColumns === 3 ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3" :
            "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          )}
        >
          {renderedFields.map(renderField)}
        </div>
      )}
      {showEmptyToggle && (
        <div className="mt-3 -ml-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowEmptyOverride((s) => !s)}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            {showEmptyOverride ? (
              <EyeOff className="h-3.5 w-3.5 mr-1.5" />
            ) : (
              <Eye className="h-3.5 w-3.5 mr-1.5" />
            )}
            {showEmptyOverride
              ? t('detail.hideEmptyFields', { defaultValue: 'Hide empty fields' })
              : t('detail.showEmptyFields', { count: emptyCount, defaultValue: 'Show {{count}} empty fields' })}
          </Button>
        </div>
      )}
    </>
  );

  // Flat render: when section has no title, no border, and is not collapsible,
  // skip the Card chrome entirely. This is the universal case for an
  // auto-generated single section (no need for a "Details" wrapper around
  // a single block of fields).
  const isFlat = !section.title && !section.collapsible && section.showBorder === false;
  if (isFlat) {
    return <div className={cn(className)}>{content}</div>;
  }

  // objectui#12732 — on a print page a collapsible section takes this branch
  // too: it is always open there (objectui#11958), and paper cannot toggle,
  // so its header prints as this plain heading (title, icon, header colour,
  // description) instead of the disclosure button, chevron and hover chrome.
  if (!section.collapsible || isPrintPage) {
    return (
      <Card className={cn(section.showBorder === false ? 'border-none shadow-none' : '', className)}>
        {section.title && (
          <CardHeader className={cn('py-3 px-4 sm:py-4 sm:px-6', headerColorClass(section.headerColor))}>
            <CardTitle className="flex items-center justify-between text-base font-semibold tracking-tight">
              <div className="flex items-center gap-2">
                {section.icon && <SectionIcon name={section.icon} />}
                <span>{section.title}</span>
              </div>
            </CardTitle>
            {section.description && (
              <p className="text-xs text-muted-foreground mt-1">{section.description}</p>
            )}
          </CardHeader>
        )}
        <CardContent className="pt-3 sm:pt-4 px-3 sm:px-6 pb-4 sm:pb-5">
          {content}
        </CardContent>
      </Card>
    );
  }

  return (
    <Collapsible
      open={!isCollapsed}
      onOpenChange={(open) => setIsCollapsed(!open)}
      className={className}
    >
      {/*
        objectui#9218 — the SAME decision branch 2 above makes, and only that
        one. `className` stays on the outer `Collapsible`: relocating it is a
        different behaviour, unmeasured by that card.
      */}
      <Card className={cn(section.showBorder === false ? 'border-none shadow-none' : '')}>
        {/*
          objectui#12625 — the disclosure is a NATIVE button inside the
          header, not the header itself. `CollapsibleTrigger asChild` on the
          `CardHeader` div used to hand the div `aria-expanded` and a click
          handler but no role and no tabindex: the section title was not a
          button in the accessibility tree and a keyboard user could not reach
          or toggle it. The button takes its name from the section title,
          carries `aria-expanded`, and Enter / Space toggle it natively. Its
          `after:` overlay spans the (now `relative`) header, so a click
          anywhere on the header still toggles, as before.
        */}
        <CardHeader className={cn(
          "relative py-3 px-4 sm:py-4 sm:px-6 cursor-pointer hover:bg-muted/50 transition-colors",
          headerColorClass(section.headerColor)
        )}>
          <CardTitle className="text-base font-semibold tracking-tight">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between text-left rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 after:absolute after:inset-0"
              >
                <span className="flex items-center gap-2">
                  {section.icon && <SectionIcon name={section.icon} />}
                  <span>{section.title}</span>
                </span>
                <span className="flex items-center gap-2">
                  {isCollapsed ? (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
                  )}
                </span>
              </button>
            </CollapsibleTrigger>
          </CardTitle>
          {section.description && !isCollapsed && (
            <p className="text-xs text-muted-foreground mt-1">{section.description}</p>
          )}
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="pt-3 sm:pt-4 px-3 sm:px-6 pb-4 sm:pb-5">
            {content}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};
