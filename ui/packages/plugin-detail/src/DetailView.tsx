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
  Badge,
  Button, 
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  renderNodeSlot,
} from '@object-ui/components';
import { 
  ArrowLeft, 
  Edit, 
  Star,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  Copy,
  Lock,
  X,
} from 'lucide-react';
import { DetailSection } from './DetailSection';
import { EmptySectionsFold } from './EmptySectionsFold';
import { DetailTabs } from './DetailTabs';
import { SectionGroup } from './SectionGroup';
import { HeaderHighlight } from './HeaderHighlight';
import { RecordComments } from './RecordComments';
import { ActivityTimeline } from './ActivityTimeline';
import { HistoryTimeline } from './HistoryTimeline';
import { RecordMetaFooter } from './RecordMetaFooter';
import { RecordPageProvenanceContext } from './recordPageProvenance';
import { SchemaRenderer, SchemaErrorBoundary, toRenderableSchema, useSafeFieldLabel, useDataInvalidation, useInlineEdit, useRowPredicate, resolveApprovalLock, usePrintPage } from '@object-ui/react';
import { buildExpandFields, declaredNameField, getRecordDisplayName, formatTitleTemplate, recordDisplayValueAt, resolveAffordance, toDisplayDate, userActionPredicates, withoutDeniedFields } from '@object-ui/core';
import { usePermissions } from '@object-ui/permissions';
import { useLocalization, useDisplayLocale, resolveFieldCurrency } from '@object-ui/i18n';
import type { DetailViewSchema, DataSource, ActionSchema, SchemaNode } from '@object-ui/types';
import { useDetailTranslation } from './useDetailTranslation';
import { useRecordEditable } from './useRecordEditable';
import { getCellRenderer, resolveCellRendererType, coerceToSafeValue, formatPercent, percentCellScale } from '@object-ui/fields';
import { resolveFieldScale } from '@objectstack/spec/data';
import { hasCellValue } from './emptiness';
import { enrichDetailField } from './fieldEnrichment';
import { chipTakesCellRenderer } from './summaryChipRenderers';
import { summaryChipPercentPoints } from './summaryChipPercent';


/** Stable empty draft so the section `data`-merge identity is preserved when
 *  no <InlineEditProvider> is mounted (bare / read-only DetailView). */
const EMPTY_DRAFT: Record<string, any> = {};

/**
 * Resolve the human-readable title for the detail header.
 *
 * Priority order:
 *   1. `schema.primaryField` value on the record (view-author override).
 *   1b. The object's DECLARED name pointer (`nameField`, then its deprecated
 *      `displayNameField` alias) when it holds a value on the record — read
 *      through `@object-ui/core#declaredNameField` (objectui#9436).
 *   2. `objectSchema.titleFormat` (e.g. `{full_name} - {company}`), the legacy
 *      render-only template, BELOW the declared pointer.
 *   3. Type-aware field derivation, via the unified
 *      `@object-ui/core#getRecordDisplayName` (ADR-0079) — so the detail
 *      header matches gallery / calendar / lookup / search.
 *   4. `schema.title` (caller-provided override, typically the object label).
 *   4b. Record-key probe (`name`/`title`/`*_name`/…) — last resort before the
 *      floor, for records whose name lives in a field the type-aware derivation
 *      skips (e.g. an `autonumber` `name`) and whose caller set no title
 *      (objectui#2688).
 *   5. `Record #<id>` floor, else the translated "Details" fallback.
 *
 * `data` is the record as the viewer may read it: the caller removes the
 * fields the loaded policy denies first (`titleRow`, objectui#10434), so a
 * denied field is read by every rung below as an absent one.
 */
function resolveDisplayTitle(
  data: any,
  schema: DetailViewSchema,
  objectSchema: any,
  fallback: string,
): string {
  if (data && typeof data === 'object') {
    // 1. Explicit primary field wins (author's chosen header field).
    if (schema.primaryField) {
      const v = (data as any)[schema.primaryField];
      if (v !== null && v !== undefined && v !== '') return String(v);
    }
    // 1b. The object's DECLARED name pointer, ABOVE the template
    //     (objectui#9436, ruled C1). This is the protocol's order:
    //     `@objectstack/spec`'s `titleFormat` describe says "an explicit
    //     nameField now takes precedence", and `getRecordDisplayName` ranks
    //     the pointer (steps 1+2) above the template (step 3). The value is
    //     read the way the resolver reads it, through core's one spelling of
    //     the pointer. It is filtered by the same floor test step 3 applies,
    //     so on an object with no `titleFormat` this rung answers exactly what
    //     step 3 answered before it. A blank value falls through to the
    //     template.
    const declared = recordDisplayValueAt(data, declaredNameField(objectSchema));
    if (declared) {
      const id = (data as any).id ?? (data as any)._id;
      const isFloor =
        declared === 'Untitled' ||
        (id !== null && id !== undefined && declared === `Record #${id}`);
      if (!isFloor) return declared;
    }
    // 2. titleFormat, the legacy render-only template, BELOW the declared
    //    pointer. The shared renderer walks dotted paths + embedded lookup
    //    objects and strips orphan separators around empty placeholders.
    const formatted = formatTitleTemplate(objectSchema?.titleFormat, data);
    if (formatted) return formatted;
  }
  // 3. Unified resolver (ADR-0079): displayNameField → type-aware field
  //    derivation, so an object whose name lives in e.g. `activity_name`
  //    (no titleFormat, no standard `name` field) still renders its real name
  //    here — matching gallery / calendar / lookup / search. We stop short of
  //    the resolver's `Record #<id>` floor because the detail header prefers
  //    the object label (`schema.title`) over a bare id; detect & skip it.
  if (data && typeof data === 'object') {
    const id = (data as any).id ?? (data as any)._id;
    // `deriveFromRecordKeys: false` → only the object-DECLARED identity
    // (displayNameField + type-aware field derivation) contributes here; a bare
    // record-key guess does NOT outrank the caller's `schema.title` object
    // label below. We also detect & skip the resolver's `Record #<id>` floor.
    const unified = getRecordDisplayName(objectSchema, data, { deriveFromRecordKeys: false });
    const isFloor =
      unified === 'Untitled' ||
      (id !== null && id !== undefined && unified === `Record #${id}`);
    if (!isFloor) return unified;
  }
  // 4. Caller-provided title override (object label).
  if (schema.title) return schema.title;
  // 4b. Record-key probe as the LAST resort before the id floor (objectui#2688).
  //     Only reached when the caller provided no title, so the "guessed key must
  //     not outrank schema.title" rule above still holds — but a name-ish value
  //     sitting right on the record (e.g. `name` typed `autonumber`, which the
  //     type-aware derivation deliberately skips) beats a bare `Record #<id>`.
  if (data && typeof data === 'object') {
    const id = (data as any).id ?? (data as any)._id;
    const guessed = getRecordDisplayName(objectSchema, data);
    const guessedIsFloor =
      guessed === 'Untitled' ||
      (id !== null && id !== undefined && guessed === `Record #${id}`);
    if (!guessedIsFloor) return guessed;
  }
  // 5. `Record #<id>` floor, else the translated "Details" fallback.
  if (data && typeof data === 'object') {
    const id = (data as any).id ?? (data as any)._id;
    if (id !== null && id !== undefined && String(id).trim() !== '') {
      return `Record #${id}`;
    }
  }
  return fallback;
}

export interface DetailViewProps {
  schema: DetailViewSchema;
  dataSource?: DataSource;
  className?: string;
  onEdit?: () => void;
  onDelete?: () => void;
  onBack?: () => void;
  /**
   * Opt into inline editing. When true AND an `<InlineEditProvider>` is present
   * (with `canEdit`), fields surface the double-click / hover-pencil affordance
   * and edits stage into the shared draft (objectui#2407 P1). The Save/Cancel
   * bar + atomic persistence live in `<InlineEditSaveBar>`, rendered by the host.
   */
  inlineEdit?: boolean;
  /**
   * Optional discussion content rendered as a dedicated "Discussion" tab when
   * autoTabs is enabled. Lets the host page mount a rich chatter panel without
   * floating it below the detail body.
   */
  discussionSlot?: React.ReactNode;
  /**
   * Reserved: optional right-rail content (activity feed, related summary).
   * Currently accepted but rendered as a stacked block at the bottom; a
   * proper side-by-side layout is on the roadmap.
   */
  rightRail?: React.ReactNode;
  /**
   * Localized object label displayed in the header subtitle. When omitted,
   * `schema.objectName` is used as a fallback.
   */
  objectLabel?: string;
  /**
   * Optional callback fired whenever the detail record is loaded or refreshed
   * (after fetch, optimistic save, or schema-provided initial data). Lets the
   * host page surface the record's primary value (e.g. to a breadcrumb or
   * window title) without re-fetching.
   */
  onDataLoaded?: (record: any) => void;
  /**
   * Controlled favourite state for the header star button. When provided,
   * the legacy DetailView mirrors it instead of using its own local
   * state — letting hosts persist favourites (e.g. via `useFavorites`).
   */
  isFavorite?: boolean;
  /**
   * Called when the user clicks the header star. Receives the next state.
   */
  onToggleFavorite?: (next: boolean) => void;
  /**
   * The host supplies the record through `schema.data`, so this view never
   * reads it itself: while `schema.data` is absent for the `resourceId` the
   * host names, it shows its loading state and sends nothing, and it renders
   * the record once the host hands it over.
   *
   * The record page sets it on its `record:details` body (objectui#12701): the
   * page already reads the record, with every relation the page expands, so a
   * second read of the same row from the body — narrower, sent while the
   * page's own read was still on the wire — was one request too many on every
   * record open. Omitted, the view reads its record as before.
   */
  recordFromHost?: boolean;
}


/**
 * Every field entry named by every section, flattened — the ONE spelling.
 *
 * ⚠️ Tolerant of a section with no `fields` array ON PURPOSE, and the
 * tolerance is not leniency toward off-spec metadata (Commandment #0.1): a
 * section carrying `{ group }` instead of `{ fields }` is EXACTLY what
 * `@objectstack/spec` 17.3.0 declares (`RecordDetailsProps.sections[].group`,
 * objectstack#13855), so this is the renderer learning to read a document the
 * contract already accepts.
 *
 * A bare `sections.flatMap((s) => s.fields)` does not skip such a section — it
 * keeps `undefined` as an ELEMENT (flatMap flattens arrays, and `undefined` is
 * not one), and the very next line reads `.name` off it. That threw
 * `Cannot read properties of undefined (reading 'name')` from inside a
 * `useMemo` ABOVE the section loop, so no per-section boundary could contain
 * it and `SchemaErrorBoundary` blanked the whole `record:details` component —
 * one authored key erasing every sibling section on the page (objectui#8497).
 * The crash predates the key it fires on: it arrived with `e99770841`
 * (2026-05-01), months before objectstack#13855 declared `group`, so it was never a
 * deliberate refusal of anything.
 */
const sectionFieldEntries = (sections: any[] | undefined): any[] =>
  (sections || []).flatMap((s) => (Array.isArray(s?.fields) ? s.fields : []));

/**
 * One section's blast radius is that section (objectui#8497 acceptance 2).
 *
 * `SchemaErrorBoundary` already existed one level UP, per COMPONENT — which is
 * why a single malformed section rendered "Component `record:details` failed to
 * render" over the whole body and every well-formed sibling vanished with it.
 * Reusing that same boundary per section pushes the granularity down: the
 * broken section shows the failure in its own place, its siblings keep
 * rendering their fields and their labels.
 *
 * ⚠️ This is the SECOND half of the containment and it cannot be the only one.
 * A React error boundary catches what throws while RENDERING ITS SUBTREE, and
 * the crash this card was filed for throws in a `useMemo` in `DetailView`'s own
 * body — above every section, outside any per-section subtree. Hence
 * {@link sectionFieldEntries}: that one guards the path that actually fired,
 * this one bounds every OTHER way a section can throw.
 *
 * `componentType` is the section identity, so the notice names which section
 * failed rather than blaming the component that hosts it.
 */
const SectionBoundary: React.FC<{ section: any; index: number; children: React.ReactNode }> = ({
  section,
  index,
  children,
}) => (
  <SchemaErrorBoundary
    componentType={`record:details section ${
      section?.name ?? section?.group ?? section?.title ?? section?.label ?? `#${index + 1}`
    }`}
  >
    {children}
  </SchemaErrorBoundary>
);


export const DetailView: React.FC<DetailViewProps> = ({
  schema: rawSchema,
  dataSource,
  className,
  onEdit,
  onDelete,
  onBack,
  inlineEdit = false,
  discussionSlot,
  rightRail: _rightRail,
  objectLabel,
  onDataLoaded,
  isFavorite: isFavoriteProp,
  onToggleFavorite,
  recordFromHost = false,
}) => {
  const [data, setData] = React.useState<any>(rawSchema.data);
  const [loading, setLoading] = React.useState(!rawSchema.data && ((recordFromHost && rawSchema.resourceId != null) || !!((rawSchema.api && rawSchema.resourceId) || (dataSource && rawSchema.objectName && rawSchema.resourceId))));
  const [internalFavorite, setInternalFavorite] = React.useState(false);
  const isFavorite = isFavoriteProp ?? internalFavorite;
  // Inline-edit session is lifted to a shared record-level context
  // (objectui#2407 P1): DetailView no longer owns the edit draft/flags — it
  // reads them from <InlineEditProvider>. `inline` is null when a host renders
  // DetailView without a provider (bare / legacy usage) → read-only. The
  // Save/Cancel bar + atomic persistence live in <InlineEditSaveBar>.
  const inline = useInlineEdit();
  // objectui#12307: `true` only under a `record:details` that reads the page's
  // record — the page host draws the one footer then. See the context's doc.
  const pageDrawsProvenance = React.useContext(RecordPageProvenanceContext);
  // objectui#12751 — `true` on a page that declares `print`. Read once, above
  // every early return, the way `DetailSection` reads it (objectui#12717): the
  // approval band below is live, per-viewer workflow state, not document
  // content, so it does not print.
  const isPrintPage = usePrintPage() !== null;
  const isInlineEditing = inline?.editing ?? false;
  const editedValues = inline?.draft ?? EMPTY_DRAFT;
  const autoFocusField = inline?.autoFocusField ?? null;
  // Retained local error state for the approval-cancel flow ONLY — the
  // inline-edit draft now surfaces its own errors through the save bar.
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [objectSchema, setObjectSchema] = React.useState<any>(null);
  const [idCopied, setIdCopied] = React.useState(false);
  const [reloadTick, setReloadTick] = React.useState(0);
  // #2269 — refetch in place when this record (or its object) is invalidated
  // on the data bus (form save, record action, undo, any dataSource write).
  // Replaces the host's key={...} remount, which destroyed tab/scroll/inline
  // edit state on every refresh. Inert when the schema carries inline data
  // (the HOST owns fetching then and passes fresh data down).
  const invalidationNonce = useDataInvalidation(
    rawSchema.objectName || undefined,
    rawSchema.resourceId != null ? String(rawSchema.resourceId) : undefined,
  );
  const [isCancellingApproval, setIsCancellingApproval] = React.useState(false);
  const { t } = useDetailTranslation();
  // Tenant default currency (ADR-0053) for summary metrics whose field omits one.
  const { currency: tenantCurrency } = useLocalization();
  // The BCP-47 tag every `Intl`-backed renderer on this page formats with
  // (objectui#9167). Read here, at the top of the component, because the
  // summary-chip map below is inside this render and a hook cannot be called
  // from it. `useDisplayLocale` is the composition — tenant locale, then the
  // active UI language, then `'en'` — and NOT `undefined`, which would hand
  // `Intl` the machine's locale, a channel neither the tenant nor the user set.
  const displayLocale = useDisplayLocale();
  const { fieldOptionLabel, fieldLabel } = useSafeFieldLabel();

  // Field-level permission gate. Filter section.fields and top-level
  // fields based on the current user's read permissions BEFORE any
  // downstream use (summary fields, header highlight, autoTabs body,
  // section grouping, inline edit lookup, $expand build). When no
  // PermissionProvider is mounted, `perms.isLoaded` is false and the
  // schema passes through unchanged.
  const perms = usePermissions();
  const gatedSchema = React.useMemo<DetailViewSchema>(() => {
    if (!perms?.isLoaded || !rawSchema.objectName) return rawSchema;
    const canRead = (fieldName: string) =>
      perms.checkField(rawSchema.objectName!, fieldName, 'read');
    const filterFields = (arr?: any[]): any[] | undefined => {
      if (!arr) return arr;
      return arr.filter((f) => {
        const name = typeof f === 'string' ? f : f?.name;
        return !name || canRead(name);
      });
    };
    return {
      ...rawSchema,
      fields: filterFields(rawSchema.fields as any[]) as any,
      sections: rawSchema.sections?.map((s) => ({
        ...s,
        fields: filterFields(s.fields as any[]) as any,
      })),
      summaryFields: filterFields(rawSchema.summaryFields as any[]) as any,
    };
  }, [rawSchema, perms]);

  /**
   * The record the header TITLE is built from: `data` without the fields the
   * loaded policy denies on this object, `id` kept (objectui#10434).
   *
   * `gatedSchema` above hides a denied field's ROW, but the title ladder in
   * `resolveDisplayTitle` reads the record itself, so a denied `primaryField`,
   * name pointer or `titleFormat` token still printed in the H1. Built from
   * this row, a denied field reads as an absent one and the ladder falls
   * through to its next source, the title ObjectStack's `FieldMasker` row
   * already yields. Before the policy loads nothing is removed, and `perms`
   * in the deps re-derives the row when the answer arrives.
   */
  const titleRow = React.useMemo(
    () => withoutDeniedFields(data, perms, rawSchema.objectName),
    [data, perms, rawSchema.objectName],
  );

  /**
   * Record-level write gate (objectstack#3821). Object-level permissions say
   * whether the user may edit `showcase_private_note` at all; they cannot say
   * whether they may edit THIS one. A read-only sharing grant sits exactly in
   * that gap, so the header used to offer "Edit", open the form, and let the
   * user retype a field before the server rejected it with a 403. Ask the
   * explain engine for the row-level verdict and reflect it on the CTA.
   *
   * Only consulted when the object-level check already passes — when it
   * doesn't, the buttons are hidden anyway and the request would be waste.
   * Fails open (see `useRecordEditable`); the server remains the authority.
   *
   * [objectui#12082] The object-level check is the `recordEdit` /
   * `recordDelete` row of the affordance-to-grant map (`resolveAffordance` in
   * `@object-ui/core`) — the same rows the console record page's header reads:
   * the server's effective operation set and the caller's grant. The row's
   * third layer, the object's own policy (bucket + the BOOLEAN `userActions`
   * form), is deliberately left out here (`objectSchema: null`): on this
   * surface it is the HOST's channel, lowered into `showEdit` / `showDelete`,
   * and this view must not grow a second definition of it (objectui#4419,
   * pinned in `DetailView.userActionPredicates.test.tsx`). With no provider
   * mounted the grant and the operation set read open.
   *
   * [objectui#13045] Each verdict feeds only its own button (`showEdit` /
   * `showDelete` in the `schema` memo below), so it is asked only when the
   * host shows that button. The console record page's `record:details` body
   * sets neither (its header owns Edit and Delete and asks for itself), and
   * its two questions were a second asker that merely joined the header's
   * in-flight request, or went out alone once the header had no reason to
   * ask.
   */
  const objectAllowsUpdate = React.useMemo(
    () => resolveAffordance('recordEdit', { objectSchema: null, objectName: rawSchema.objectName, perms }).allowed,
    [perms, rawSchema.objectName],
  );
  const objectAllowsDelete = React.useMemo(
    () => resolveAffordance('recordDelete', { objectSchema: null, objectName: rawSchema.objectName, perms }).allowed,
    [perms, rawSchema.objectName],
  );
  const recordId =
    rawSchema.resourceId != null ? String(rawSchema.resourceId) : undefined;
  const canEditRecord = useRecordEditable(
    rawSchema.objectName,
    recordId,
    'update',
    objectAllowsUpdate && !!gatedSchema.showEdit,
  );
  const canDeleteRecord = useRecordEditable(
    rawSchema.objectName,
    recordId,
    'delete',
    objectAllowsDelete && !!gatedSchema.showDelete,
  );

  /**
   * Per-record CRUD predicates from the object's `userActions.edit` / `delete`
   * OBJECT form (objectui#2614) — the header's fourth gate (objectui#4419).
   *
   * The boolean form of the same key already reached this surface: the host
   * lowers it into `schema.showEdit` / `showDelete` through the affordance
   * resolver. The predicate form did not, so an author upgrading from "nobody
   * may delete this object" to "these records may not be deleted" silently
   * lost the header while keeping the row kebab — a key whose scope SHRANK
   * when a predicate was added to it (ADR-0078: no silently-inert metadata).
   *
   * Parsed by `userActionPredicates` from `@object-ui/core` — THE parser for
   * this shape, the same import `RelatedList` makes a few files over and the
   * same one `plugin-grid`'s `resolveRowCrudAffordances` feeds the row kebab
   * from. A boolean flag yields NO predicates, which is what keeps the boolean
   * form the host's channel alone rather than growing a second definition of
   * it here.
   */
  const editPredicates = React.useMemo(
    () => userActionPredicates(objectSchema?.userActions?.edit),
    [objectSchema],
  );
  const deletePredicates = React.useMemo(
    () => userActionPredicates(objectSchema?.userActions?.delete),
    [objectSchema],
  );
  /**
   * The object's field definitions, handed to every predicate on this record
   * for the same reason the row kebab passes them (`ObjectGrid` →
   * `RowActionMenu`'s `objectFields`): a relation field must bind as the
   * stored FOREIGN KEY rather than whatever `$expand` substituted for it on
   * this surface, or `record.owner == os.user.id` answers a different question
   * here than it does on the list.
   */
  const objectFields = objectSchema?.fields;

  /**
   * `visibleWhen` — fails CLOSED, and counts as DECLARED by `!= null` rather
   * than by truthiness, so `visibleWhen: false` hides the affordance instead
   * of reading as "ungated" (the objectui#3492 invariant that
   * `isBuiltinRowActionVisible` restates for the row surfaces). `?? true`
   * expresses the ungated default as a boolean, which `useRowPredicate`
   * short-circuits without touching the engine — a boolean handed to CEL
   * faults and would fail closed.
   *
   * `useRowPredicate` IS the row surfaces' evaluator: `plugin-grid`'s
   * `evalRowActionVisibility` (the body of `isBuiltinRowActionVisible`)
   * documents itself as mirroring `useRowPredicate(pred, row, { fallback:
   * false, warnOnError: true, label, fields })` exactly, boolean
   * short-circuit included, and is hook-free only because a row loop
   * evaluates a variable number of actions inside one `useMemo`. The header
   * evaluates a fixed arity of one record, so the hook form is that same
   * evaluator without the constraint that shaped the wrapper.
   */
  const editVisible = useRowPredicate(editPredicates?.visibleWhen ?? true, data, {
    fallback: false,
    warnOnError: true,
    label: 'builtin:edit:visibleWhen',
    fields: objectFields,
  });
  const deleteVisible = useRowPredicate(deletePredicates?.visibleWhen ?? true, data, {
    fallback: false,
    warnOnError: true,
    label: 'builtin:delete:visibleWhen',
    fields: objectFields,
  });
  /**
   * `disabledWhen` — fails SOFT (an unevaluable predicate must not grey a
   * button forever), and the `!= null` gate lives OUTSIDE the evaluation, so
   * `disabledWhen: ''` reads as "no condition" rather than as "disable".
   * Verbatim the posture of `DataTableBuiltinRowActionItem`.
   */
  const editDisabledPred = useRowPredicate(editPredicates?.disabledWhen, data, {
    fallback: false,
    warnOnError: true,
    label: 'builtin:edit:disabledWhen',
    fields: objectFields,
  });
  const deleteDisabledPred = useRowPredicate(deletePredicates?.disabledWhen, data, {
    fallback: false,
    warnOnError: true,
    label: 'builtin:delete:disabledWhen',
    fields: objectFields,
  });
  const editDisabled = editPredicates?.disabledWhen != null && editDisabledPred;
  const deleteDisabled = deletePredicates?.disabledWhen != null && deleteDisabledPred;

  const schema = React.useMemo<DetailViewSchema>(
    () => ({
      ...gatedSchema,
      // The predicate is a FOURTH conjunct — the permission/writability gates
      // above are untouched, so a predicate that holds can never resurrect a
      // button the user is not allowed to press.
      showEdit: gatedSchema.showEdit && objectAllowsUpdate && canEditRecord && editVisible,
      showDelete: gatedSchema.showDelete && objectAllowsDelete && canDeleteRecord && deleteVisible,
    }),
    [
      gatedSchema,
      objectAllowsUpdate,
      canEditRecord,
      editVisible,
      objectAllowsDelete,
      canDeleteRecord,
      deleteVisible,
    ],
  );


  // Fire onDataLoaded whenever the record changes so hosts can publish it
  // (e.g. to the navigation breadcrumb or document title).
  React.useEffect(() => {
    if (data && onDataLoaded) onDataLoaded(data);
  }, [data, onDataLoaded]);

  /**
   * Auto-detect "summary fields" for the header chip row when the schema does
   * not explicitly provide them. Heuristic: pick the first status/select-like
   * field, the first currency/number "main metric", and the first date.
   * Skipped entirely when explicit `summaryFields` are configured.
   */
  const autoSummaryFields = React.useMemo<string[]>(() => {
    if (schema.summaryFields && schema.summaryFields.length > 0) return [];
    const allFields = [
      ...sectionFieldEntries(schema.sections as any[]),
      ...(schema.fields || []),
    ];
    const fieldDefMap: Record<string, any> = {};
    for (const f of allFields) {
      if (!fieldDefMap[f.name]) fieldDefMap[f.name] = f;
    }
    if (objectSchema?.fields) {
      for (const [name, def] of Object.entries<any>(objectSchema.fields)) {
        fieldDefMap[name] = { ...(fieldDefMap[name] || {}), ...def, name };
      }
    }
    // The picker and the chip renderer below MUST ask the same question. This
    // spelling is the same defect one rung earlier (objectui#8394): a
    // whitespace-only `status` satisfied a raw test, so it won the single
    // status slot — and then the render dropped it for being empty, leaving no
    // status chip at all where a genuinely filled `stage` would have shown one.
    const has = (n: string) => hasCellValue(data?.[n]);
    const picks: string[] = [];
    // 1) status / stage / state / select with options
    const statusKeys = ['status', 'stage', 'state', 'phase'];
    const statusName = statusKeys.find((k) => fieldDefMap[k] && has(k))
      || Object.keys(fieldDefMap).find((n) => fieldDefMap[n]?.type === 'select' && has(n));
    if (statusName) picks.push(statusName);
    // 2) primary metric: currency or number whose name suggests value
    const moneyName = Object.keys(fieldDefMap).find(
      (n) => (fieldDefMap[n]?.type === 'currency' || /amount|revenue|value|total|price/i.test(n)) && has(n),
    );
    if (moneyName && !picks.includes(moneyName)) picks.push(moneyName);
    // 3) primary date
    const dateName = Object.keys(fieldDefMap).find(
      (n) => (fieldDefMap[n]?.type === 'date' || fieldDefMap[n]?.type === 'datetime')
        && /close|due|start|end|expected/i.test(n)
        && has(n),
    );
    if (dateName && !picks.includes(dateName)) picks.push(dateName);
    return picks;
  }, [schema.summaryFields, schema.sections, schema.fields, objectSchema, data]);

  const effectiveSummaryFields = schema.summaryFields && schema.summaryFields.length > 0
    ? schema.summaryFields
    : autoSummaryFields;

  const handleCopyRecordId = React.useCallback(() => {
    if (!schema.resourceId) return;
    navigator.clipboard.writeText(String(schema.resourceId)).then(() => {
      setIdCopied(true);
      setTimeout(() => setIdCopied(false), 1500);
    });
  }, [schema.resourceId]);


  // Whether the host's record is here yet: with `recordFromHost` the effect
  // below must re-run the moment it arrives, whatever else changed.
  const hostRecordArrived = recordFromHost && !!schema.data;

  // Fetch objectSchema + data with $expand when DataSource is provided
  React.useEffect(() => {
    let isMounted = true;

    // If inline data provided, use it directly. We still need to fetch the
    // objectSchema so that DetailSection can resolve field types (picklist
    // options, currency, references…). Without this, a remount that happens
    // *after* the parent has already loaded ctx.data (e.g. switching tabs
    // in record:details) would skip the schema fetch entirely and render
    // picklist values as raw enum keys like "existing_upgrade".
    if (schema.data) {
      setData(schema.data);
      setLoading(false);
      if (dataSource?.getObjectSchema && schema.objectName) {
        dataSource
          .getObjectSchema(schema.objectName)
          .then((resolvedSchema) => {
            if (isMounted) setObjectSchema(resolvedSchema);
          })
          .catch(() => {
            /* objectSchema is best-effort; renderer falls back to raw values */
          });
      }
      return () => {
        isMounted = false;
      };
    }

    // objectui#12701 — the host reads this record; wait for it, read nothing.
    // A host that names no record (a binding that matched no row) has none
    // coming, and falls through to the not-found state as before.
    if (recordFromHost && schema.resourceId != null) {
      setLoading(true);
      return () => {
        isMounted = false;
      };
    }

    if (dataSource && schema.objectName && schema.resourceId) {
      setLoading(true);
      // Clear stale state when navigating between objects/records
      setObjectSchema(null);
      setData(null);
      const objectName = schema.objectName;
      const resourceId = schema.resourceId;
      const prefix = `${objectName}-`;

      // Collect all visible fields from sections and top-level fields
      const allFields = [
        ...sectionFieldEntries(schema.sections as any[]),
        ...(schema.fields || []),
      ];

      // Load objectSchema first, then fetch data with $expand
      const schemaPromise = dataSource.getObjectSchema
        ? dataSource.getObjectSchema(objectName).catch(() => null)
        : Promise.resolve(null);

      schemaPromise.then((resolvedSchema) => {
        if (!isMounted) return;
        setObjectSchema(resolvedSchema);

        // Compute $expand from objectSchema.
        //
        // [objectui#7230] FIELD-LEVEL SECURITY ON `$expand`, the gate
        // objectui#7215 / PR #7229 put on the two projection sites in its
        // scope. `$select` on a denied lookup asks for a bare foreign key;
        // `$expand` asks the server to RESOLVE the relation and return the
        // related record — the larger of the two requests.
        //
        // ⚠️ THIS SITE WAS ALREADY INPUT-GATED, AND THAT IS THE DEFECT, not the
        // fix. `allFields` is collected from `schema`, which is `gatedSchema` —
        // already FLS-filtered field by field above. Filtering the INPUT is
        // precisely the route PR #7229 measured as unsound, and here is what it
        // costs: `buildExpandFields` reads an EMPTY column list as "no column
        // restriction" and falls back to EVERY declared relation on the object.
        // So a detail view whose authored fields are ALL denied had its column
        // list gated down to `[]` and its `$expand` WIDENED from the relations
        // it asked for to every relation the object declares — the principal
        // who may read least asking for the most. The same widening is reached
        // with no authored field list at all, where the input filter has
        // nothing to remove and the expansion is maximal from the start.
        //
        // ⭐ SO THE GATE GOES ON THE HELPER'S OUTPUT. The input filter above
        // stays — it is load-bearing for the RENDER half — but it is no longer
        // what decides the projection. Gating the output also gives the
        // required ordering structurally: `buildExpandFields` returns a subset
        // of the object's DECLARED reference-bearing fields, so every name
        // judged here is declared by construction and the "`checkField` answers
        // false for an undeclared key" trap cannot be reached — a derived /
        // host-joined column is never judged. Both halves are pinned in
        // `__tests__/DetailView.expandFls-7230.test.tsx`.
        //
        // Graded as objectui#7215 graded it: defence-in-depth against
        // ObjectStack's own server (`FieldMasker.maskRecord` deletes the very
        // key objectql writes the expansion back under; the sub-read takes the
        // referenced object's full CRUD + RLS + FLS, objectstack#7626), and
        // load-bearing for a backend that does not strip.
        //
        // An unanswered policy filters nothing, exactly as `gatedSchema` above
        // defers; `perms` is in this effect's dependency list.
        const expandable = buildExpandFields(resolvedSchema?.fields, allFields);
        const expandFields = !perms?.isLoaded
          ? expandable
          : expandable.filter((f) => perms.checkField(objectName, f, 'read'));
        const params = expandFields.length > 0 ? { $expand: expandFields } : undefined;

        const findOnePromise = params
          ? dataSource.findOne(objectName, resourceId, params)
          : dataSource.findOne(objectName, resourceId);

        // Helper: try alternate ID format (strip or prepend objectName prefix)
        const tryAltId = () => {
          const resIdStr = String(resourceId);
          const altId = resIdStr.startsWith(prefix)
            ? resIdStr.slice(prefix.length)   // strip prefix
            : `${prefix}${resIdStr}`;          // prepend prefix
          return (params
            ? dataSource.findOne(objectName, altId, params)
            : dataSource.findOne(objectName, altId)
          ).then((fallbackResult) => {
            if (isMounted) {
              setData(fallbackResult);
              setLoading(false);
            }
          }).catch(() => {
            if (isMounted) {
              setData(null);
              setLoading(false);
            }
          });
        };

        return findOnePromise
          .catch(() => null) // Convert any error to null to trigger alternate ID fallback
          .then((result) => {
          if (!isMounted) return;
          if (result) {
            setData(result);
            setLoading(false);
            return;
          }
          // Fallback: try alternate ID format for backward compatibility
          return tryAltId();
        });
      }).catch((err) => {
         if (isMounted) {
           console.error('Failed to fetch detail data:', err);
           setLoading(false);
         }
      });
    } else if (schema.api && schema.resourceId) {
      setLoading(true);
      fetch(`${schema.api}/${schema.resourceId}`)
        .then(res => res.json())
        .then(result => {
          if (isMounted) {
            setData(result?.data || result);
          }
        })
        .catch(err => {
          console.error('Failed to fetch detail data:', err);
        })
        .finally(() => { if (isMounted) setLoading(false); });
    }

    return () => { isMounted = false; };
  }, [schema.api, schema.resourceId, schema.objectName, dataSource, schema.sections, schema.fields, reloadTick, invalidationNonce, perms, recordFromHost, hostRecordArrived]);

  const handleBack = React.useCallback(() => {
    if (onBack) {
      onBack();
    } else if (schema.onNavigate) {
      // SPA-aware navigation
      const backUrl = schema.backUrl || (schema.objectName ? `/${schema.objectName}` : '/');
      schema.onNavigate(backUrl, { replace: true });
    } else if (schema.backUrl) {
      window.location.href = schema.backUrl;
    } else {
      window.history.back();
    }
  }, [onBack, schema]);

  const handleEdit = React.useCallback(() => {
    if (onEdit) {
      onEdit();
    } else if (schema.onNavigate && schema.editUrl) {
      // SPA-aware navigation
      schema.onNavigate(schema.editUrl);
    } else if (schema.onNavigate && schema.objectName && schema.resourceId) {
      // Build edit URL from object + resource
      schema.onNavigate(`/${schema.objectName}/${schema.resourceId}/edit`);
    } else if (schema.editUrl) {
      window.location.href = schema.editUrl;
    }
  }, [onEdit, schema]);

  const handleCancelApproval = React.useCallback(async () => {
    if (!dataSource?.cancelPendingApproval || !schema.objectName || !schema.resourceId) {
      setSaveError(t('detail.cancelApprovalUnavailable'));
      return;
    }
    setIsCancellingApproval(true);
    setSaveError(null);
    try {
      await dataSource.cancelPendingApproval(String(schema.objectName), String(schema.resourceId));
      // Refresh local data immediately so the lock badge disappears even
      // when our `data` was supplied via parent context (which bypasses
      // the load effect's reloadTick path).
      if (dataSource.findOne) {
        try {
          const fresh = await dataSource.findOne(
            String(schema.objectName),
            String(schema.resourceId),
          );
          if (fresh) setData(fresh);
        } catch {
          /* best-effort */
        }
      }
      // Bump the load-effect dep so any nested fetch (e.g. related lists)
      // re-runs against the now-recalled state.
      setReloadTick((n) => n + 1);
      // Notify upstream providers (e.g. RecordContextProvider in app-shell)
      // so they can re-sync their cached copy of the record. Listeners are
      // optional — this is fire-and-forget.
      try {
        window.dispatchEvent(new CustomEvent('objectui:record-changed', {
          detail: {
            objectName: String(schema.objectName),
            recordId: String(schema.resourceId),
            reason: 'approval-recalled',
          },
        }));
      } catch {
        /* SSR or restricted env */
      }
    } catch (err: any) {
      const raw = err?.message || err?.error || String(err ?? 'Cancel failed');
      const cleaned = raw
        .replace(/^\[[^\]]+\]\s*/, '')
        .replace(/^[A-Z][A-Z0-9_]+:\s*/, '');
      setSaveError(`${t('detail.cancelApprovalFailed')}: ${cleaned}`);
    } finally {
      setIsCancellingApproval(false);
    }
  }, [dataSource, schema.objectName, schema.resourceId, t]);

  const handleDelete = React.useCallback(() => {
    const confirmMessage = schema.deleteConfirmation || t('detail.deleteConfirmation');
    // Use window.confirm as fallback — the ActionProvider's onConfirm handler
    // will intercept this if wired up via the action system.
    if (window.confirm(confirmMessage)) {
      onDelete?.();
      // Navigate back after deletion if onNavigate available
      if (schema.onNavigate && schema.objectName) {
        schema.onNavigate(`/${schema.objectName}`, { replace: true });
      }
    }
  }, [onDelete, schema]);

  const handleShare = React.useCallback(() => {
    // Share functionality - could trigger share dialog or copy link
    if (navigator.share && schema.objectName && schema.resourceId) {
      navigator.share({
        title: schema.title || t('detail.details'),
        text: `${schema.objectName} #${schema.resourceId}`,
        url: window.location.href,
      }).catch((err) => {
        // objectui#4029 — a real failure of the Share API, not debug noise.
        console.error('Share failed:', err);
      });
    } else {
      // Fallback: copy link to clipboard
      navigator.clipboard.writeText(window.location.href);
    }
  }, [schema]);

  // NOTE: Duplicate / Export / View History are intentionally hidden until
  // real implementations exist. See systemActions below.

  const handleToggleFavorite = React.useCallback(() => {
    const next = !isFavorite;
    if (onToggleFavorite) onToggleFavorite(next);
    if (isFavoriteProp === undefined) setInternalFavorite(next);
  }, [isFavorite, isFavoriteProp, onToggleFavorite]);

  // Thin bindings from the shared inline-edit context down into each
  // DetailSection, so the section render sites below stay unchanged. Staging a
  // field edit routes to the shared draft; entering edit is gated by `canEdit`
  // (object-lifecycle + permission) at the context source. Save/Cancel and
  // persistence are owned by <InlineEditSaveBar>, not DetailView.
  const handleInlineFieldChange = inline?.setField;
  const handleEnterInlineEditField =
    inline && inline.canEdit ? inline.enter : undefined;

  // Keyboard shortcuts for prev/next record navigation (← / →)
  React.useEffect(() => {
    if (!schema.recordNavigation) return;
    const nav = schema.recordNavigation;
    const handler = (e: KeyboardEvent) => {
      // Skip when focus is inside an input, textarea, or contenteditable
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === 'ArrowLeft' && nav.currentIndex > 0) {
        e.preventDefault();
        nav.onNavigate(nav.recordIds[nav.currentIndex - 1]);
      } else if (e.key === 'ArrowRight' && nav.currentIndex < nav.recordIds.length - 1) {
        e.preventDefault();
        nav.onNavigate(nav.recordIds[nav.currentIndex + 1]);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [schema.recordNavigation]);

  // objectui#7997 — the `related` ENTRY on this node is RETIRED (ADR-0049
  // enforce-or-remove, maintainer ruling 2026-09-10: 「关掉详情页那个入口（推荐）」).
  // `DetailViewSchema.related` is a `?: never` tombstone on the TypeScript face
  // and a `retirementTombstone()` arm on the zod mirror, so this component no
  // longer reads it and no longer renders a Related tab or a Related section.
  //
  // ⛔ The capability did not retire, only this door: author a
  // `record:related_list` block, which is the protocol-governed entry
  // (@objectstack/spec `RecordRelatedListProps`) and which has always rendered
  // through the same `RelatedList` component this branch used — see
  // `renderers/record-related-list.tsx`.
  //
  // Auto-discovery of related panels via INVERSE references (other objects
  // whose FK points at the current record) was never this component's job
  // either; it belongs to the page layer (e.g. RecordDetailView), which has the
  // registry of all objects.

  /**
   * Chrome-level "system" actions (Duplicate, Export, View History, Delete,
   * and mobile-only fallbacks for Share / Edit / Inline Edit) expressed as
   * {@link ActionSchema} entries. These are funnelled into the *single*
   * overflow menu of the record-header `action:bar` via its `systemActions`
   * field, guaranteeing at most one "More" button on the header regardless
   * of how many business actions the object metadata contributes.
   *
   * `onClick` is used as a UI-local escape hatch because these handlers
   * depend on React state (e.g., `isInlineEditing`) and local DOM APIs
   * (`navigator.share`, `navigator.clipboard`) that are not part of the
   * server-driven action protocol.
   */
  const systemActions = React.useMemo<ActionSchema[]>(() => {
    // System action items use a UI-local shape (`type: 'script'`,
    // `variant: 'destructive'`, `onClick`) that doesn't perfectly conform
    // to the canonical ActionSchema discriminated union. Cast at the
    // boundary so call sites can keep treating them as ActionSchema[].
    const items: any[] = [];

    // Share lives in the unified overflow on every breakpoint — keeps the
    // header focused on the primary Edit CTA. (Was sm:hidden previously.)
    items.push({
      name: 'sys_share',
      label: t('detail.share'),
      icon: 'share-2',
      type: 'script',
      onClick: handleShare,
    });
    if (schema.showEdit) {
      items.push({
        name: 'sys_edit_mobile',
        label: t('detail.edit'),
        // objectui#5622 — `square-pen`, NOT `edit`. These items become an
        // `action:bar` schema, and the action renderers resolve `icon` through
        // lucide's runtime `icons` record (`resolve-icon.ts`). lucide retires a
        // spelling by dropping it from that record while KEEPING it as a
        // deprecated named export, so `edit` type-checks everywhere it is
        // imported and resolves to NOTHING here — this entry drew a label with
        // no icon. `Edit === SquarePen` is true on the installed lucide, so the
        // glyph is unchanged; only the spelling was dead.
        icon: 'square-pen',
        type: 'script',
        className: 'sm:hidden',
        // `edit.disabledWhen` greys this entry exactly as it greys the desktop
        // CTA below and the row kebab's Edit — one predicate, one answer, on
        // every breakpoint. Set only when it HOLDS: `action:menu` reads a
        // declared `disabled` by `!= null`, so a `false` would still be a
        // declared gate (harmless, but it would say something the object did
        // not declare).
        ...(editDisabled ? { disabled: true } : null),
        onClick: handleEdit,
      });
    }
    // No mobile inline-edit toggle: on touch (no hover / double-click) the
    // primary Edit CTA — which opens the full form — is the single edit path,
    // so we don't reintroduce a competing "Edit fields" entry in the overflow.

    // Universal record-level utilities (desktop + mobile).
    // Duplicate / Export / View History are intentionally omitted until
    // real implementations land — previously they only emitted console.log
    // and surfacing fake actions to end users is misleading.

    // Destructive action — separated and styled via variant.
    if (schema.showDelete) {
      items.push({
        name: 'sys_delete',
        label: t('detail.delete'),
        icon: 'trash',
        type: 'script',
        variant: 'destructive',
        tags: ['separator-before'],
        // `delete.disabledWhen` — kebab symmetry, same rule as Edit above.
        ...(deleteDisabled ? { disabled: true } : null),
        onClick: handleDelete,
      });
    }

    return items as ActionSchema[];
  }, [
    t,
    schema.showEdit,
    schema.showDelete,
    editDisabled,
    deleteDisabled,
    handleShare,
    handleEdit,
    handleDelete,
  ]);

  /**
   * Inject `systemActions` into the record-header `action:bar` if one was
   * provided via `schema.actions`; otherwise append a new header `action:bar`
   * that carries only the system actions. The goal is to always render a
   * single, unified overflow menu containing both business-action overflow
   * and system actions.
   */
  const headerActionNodes = React.useMemo<SchemaNode[]>(() => {
    // `schema.actions` is typed as ActionSchema[] by DetailViewSchema, but
    // in practice RecordDetailView (and consumers) pass through full UI
    // schema nodes like `action:bar` so they can be rendered by
    // SchemaRenderer. Treat each entry as an opaque SchemaNode here.
    const actions = (schema.actions ?? []) as unknown as SchemaNode[];
    if (systemActions.length === 0) return actions;
    let injected = false;
    const mapped: SchemaNode[] = actions.map((node) => {
      const record = node as Record<string, unknown> | null;
      if (
        record &&
        typeof record === 'object' &&
        record.type === 'action:bar' &&
        (!record.location || record.location === 'record_header')
      ) {
        injected = true;
        const existingSystem = Array.isArray(record.systemActions)
          ? (record.systemActions as ActionSchema[])
          : [];
        return {
          ...record,
          systemActions: [...existingSystem, ...systemActions],
        } as unknown as SchemaNode;
      }
      return node;
    });
    if (!injected) {
      mapped.push({
        type: 'action:bar',
        location: 'record_header',
        systemActions,
      } as unknown as SchemaNode);
    }
    return mapped;
  }, [schema.actions, systemActions]);

  if (loading || schema.loading) {
    return (
      <div className={cn('space-y-4', className)}>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!data && !schema.data) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-16 text-center', className)}>
        <p className="text-lg font-semibold">{t('detail.recordNotFound')}</p>
        <p className="text-sm text-muted-foreground mt-1">
          {t('detail.recordNotFoundDescription')}
        </p>
        {(schema.showBack ?? true) && (
          <Button variant="outline" size="sm" onClick={handleBack} className="mt-4 gap-2">
            <ArrowLeft className="h-4 w-4" />
            {t('detail.goBack')}
          </Button>
        )}
      </div>
    );
  }

  // objectui#13386 — a body whose sections are ALL empty draws one fold row
  // for the whole body (`EmptySectionsFold`). Only when the sections ARE the
  // body: section groups draw fields of their own beside them.
  const foldEmptySections = (rendered: React.ReactNode) =>
    schema.sectionGroups?.length ? rendered : (
      <EmptySectionsFold
        sections={schema.sections ?? []}
        data={{ ...data, ...editedValues }}
        isEditing={isInlineEditing}
      >
        {rendered}
      </EmptySectionsFold>
    );

  return (
    <TooltipProvider>
      <div className={cn('space-y-6', className)}>
        {/* Header - Airtable-inspired layout. Suppressed when the host page
            renders its own `page:header` (e.g. record:details embedded
            under a Lightning-style page) to avoid a duplicate title chip. */}
        {schema.showHeader !== false && (
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-start justify-between gap-3 sm:gap-4 pb-4 border-b">
          {/* ── Why this column carries `w-full sm:w-auto` (objectui#9119) ──

              Below `sm` this row is a COLUMN flex container, so a child's
              WIDTH is its CROSS size — and `items-start` on the row sizes a
              cross axis to fit-content. This column therefore took the h1's
              max-content width whatever the viewport was (1201.22px inside a
              320px row in the console; 1045.59px for the same 98-character
              title under the headless font metrics the e2e pin reads). The
              `truncate` below never fired, because its containing block had
              been sized to the text, and the header overran its row by the
              difference on every phone-width record whose name runs past
              roughly thirty characters. What the reader got depended on the
              host: the console's content pane computes `overflow-x: hidden`,
              so there the title was cut off mid-word with no ellipsis and no
              scrollbar; a host that does not clip got a sideways page scroll
              instead. Both are this one defect.

              ⛔ Neither utility already on this line can fix that, and a
              third one of the same kind cannot either: `min-w-0` is a FLOOR,
              not a ceiling, and `flex-1` acts on the MAIN axis — which in a
              column container is HEIGHT. Only a definite cross size does it.
              (objectui#3466 / objectui#2493 were a MISSING `min-w-0` on other
              surfaces; this is not that one.)

              `sm:w-auto` hands the row straight back to the `sm:flex-row`
              title/action arbitration objectui#7281 fixed, unchanged — the
              action tail below spells the same pair for the same reason, and
              the 799px row of the pin is the lit control proving it. */}
          <div className="flex items-start gap-2 sm:gap-3 flex-1 min-w-0 sm:min-w-64 w-full sm:w-auto">
            {(schema.showBack ?? true) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={handleBack} className="shrink-0 mt-1">
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('detail.back')}</TooltipContent>
              </Tooltip>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-bold truncate">
                  {resolveDisplayTitle(titleRow, schema, objectSchema, t('detail.details'))}
                </h1>
                {effectiveSummaryFields.map((fieldName) => {
                  const val = data?.[fieldName];
                  // Same definition as `has` above and as every other band of
                  // the page (`./emptiness`, objectui#8376/#8394). A raw test
                  // here rendered a whitespace-only value as a visually blank
                  // Badge beside the H1 — while the H1's own authority called
                  // that field empty.
                  if (!hasCellValue(val)) return null;
                  // Format value based on field type from schema or objectSchema.
                  // Best-effort: currency → localized currency, date/datetime →
                  // localized date string, others → String(val).
                  const sectionField = sectionFieldEntries(schema.sections as any[])
                    .concat(schema.fields || [])
                    .find((f) => f.name === fieldName);
                  const objField = objectSchema?.fields?.[fieldName];
                  const ftype = sectionField?.type || objField?.type;
                  // ── The chip's NAME half ──────────────────────────────────
                  //
                  // The chip carries no visible label, so what follows is the
                  // WHOLE of what a screen-reader user hears the field called —
                  // and it used to be `fieldName`, the raw stored column
                  // (objectui#8729). Every other band of this page resolves a
                  // label: `HeaderHighlight` and `DetailSection` both call
                  // `fieldLabel(objectName, name, authoredLabel)`. This is that
                  // same call, not a fourth resolution path — a chip and the
                  // highlight strip one band below must name the same field the
                  // same way, including when a translation overrides the
                  // authored label.
                  //
                  // The fallback chain is this render's own field resolution,
                  // not a new one: the summary chip is addressed by NAME only
                  // (`summaryFields: ['owner_ref']`), so unlike the siblings —
                  // whose inputs are field objects that already carry a label —
                  // it has to find one. `sectionField` (the author's explicit
                  // entry) wins over `objField` (the object schema), exactly as
                  // `enrichDetailField` states it, and `fieldName` is the floor,
                  // exactly as `DetailSection` spells it (`field.label ||
                  // field.name`). `autoSummaryFields` above already merges the
                  // two sources this way to PICK the chip; this names it from
                  // the same pair.
                  //
                  // ⚠️ NOT `chipField.label` below: `enrichDetailField` copies
                  // `ENRICHED_FIELD_METADATA_KEYS`, and `label` is deliberately
                  // not one of them — so that bag carries `sectionField?.label`
                  // alone and an object-schema label would be dropped.
                  //
                  // ⛔ `data-summary-chip` keeps the RAW name on purpose: it is
                  // a machine handle for tests and automation, not a name for a
                  // reader, and a stored column is exactly what it should say.
                  const chipLabel = fieldLabel(
                    schema.objectName || '',
                    fieldName,
                    sectionField?.label || objField?.label || fieldName,
                  );
                  let display: string = String(val);
                  let percentValue: number | null = null;
                  try {
                    // -- The locale these four option bags format in ---------------
                    //
                    // `displayLocale`, never the literal `undefined` (objectui#9453).
                    // `useDisplayLocale`'s own doc comment names that literal as "the
                    // one thing a caller must not do": `undefined` means the MACHINE's
                    // locale, which is neither the tenant channel nor the UI-language
                    // one. A German tenant read a German date in the list and an en-US
                    // one beside the H1 of the record it opened, for one stored value.
                    // The percent branch below already reads this same binding.
                    //
                    // The number of fraction digits, the date style and the time style
                    // are NOT part of that repair. They are this chip's own
                    // deliberately compact face, and whether a KPI chip beside a title
                    // should instead read exactly like its list cell is an OPEN
                    // question objectui#9453 recorded and did not answer.
                    // `EN_CONTROL_ROWS` in `summaryChip.displayLocale-9453.test.tsx`
                    // is what holds that line: those rows are green before this change
                    // and after it, and go red the moment one of those options moves.
                    if (ftype === 'currency') {
                      const num = Number(val);
                      if (!Number.isNaN(num)) {
                        const cur = resolveFieldCurrency({ ...(objField as any), ...(sectionField as any) }, tenantCurrency);
                        display = cur
                          ? new Intl.NumberFormat(displayLocale, {
                              style: 'currency',
                              currency: cur,
                              maximumFractionDigits: 0,
                            }).format(num)
                          : new Intl.NumberFormat(displayLocale, {
                              maximumFractionDigits: 0,
                            }).format(num);
                      }
                    } else if (ftype === 'date' || ftype === 'datetime') {
                      // The shared parse step, never `new Date(val)`: a
                      // date-only value is UTC midnight to the engine and read
                      // back here in the viewer's zone, one day early west of
                      // UTC (objectui#10183). The face stays this chip's own.
                      const d = toDisplayDate(val);
                      if (!Number.isNaN(d.getTime())) {
                        display = ftype === 'datetime'
                          ? d.toLocaleString(displayLocale, { dateStyle: 'medium', timeStyle: 'short' })
                          : d.toLocaleDateString(displayLocale, { dateStyle: 'medium' } as any);
                      }
                    } else if (ftype === 'percent') {
                      const num = Number(val);
                      if (!Number.isNaN(num)) {
                        // ── ONE number, ONE spelling, and neither is this
                        //    file's (objectui#8728 → #9071 → #9167) ──────────
                        //
                        // The chip draws a percent TWICE: the text states it,
                        // the bar below draws it clamped to its track. They
                        // used to scale `num` by two different rules, so a
                        // stored `0.123` said `0.123%` beside a bar at 12.3%
                        // (objectui#8728). objectui#9071 put both halves onto
                        // the repo's SCALING — `percentDisplayValue` in
                        // `@object-ui/core` — and stopped there, so the chip
                        // still appended a bare `%` to the full JavaScript
                        // number while the list cell rendered the same stored
                        // value through the locale's percent affix at the
                        // field's precision. One record, two readings again,
                        // one contract-half further down.
                        //
                        // ⭐ The TEXT now takes the other half from the same
                        // place: `formatPercent` is the list cell's own body
                        // (`PercentCellRenderer` calls it with exactly these
                        // arguments), and it applies `percentDisplayValue`
                        // itself — so this is not a second entry into the
                        // scaling, it is the doorway that carries BOTH halves,
                        // which is what `percentDisplayValue`'s doc comment
                        // asks of a third surface. ⛔ Nothing here rounds or
                        // appends a sign of its own; that local rule is the
                        // shape objectui#9071 deleted.
                        //
                        // The BAR still reads `summaryChipPercentPoints`,
                        // deliberately: a bar draws the UNROUNDED magnitude —
                        // the list cell's own bar does the same, off its
                        // `barValue` before formatting — so rounding the fill
                        // to the field's precision would make this chip
                        // disagree with the cell it just started agreeing with.
                        const percentField = { ...(objField as any), ...(sectionField as any) };
                        // The field's width, read with the same view-over-object
                        // precedence the currency branch above spells and
                        // resolved by the PROTOCOL (objectui#9843):
                        // `resolveFieldScale` answers the declared `scale` when
                        // it is well-formed, and otherwise `@objectstack/spec`'s
                        // own absent width for a percent field. The list cell,
                        // the grid footer and the edit widget ask the same
                        // function, so one undeclared stored value reads one
                        // width on every face — ⛔ no `?? N` here or there. The
                        // type asked about is `ftype`, the one this branch
                        // renders, rather than the merged bag's.
                        //
                        // ⭐ The MEMBER moved and the AUTHORITY did not
                        // (objectui#9295). This read was `precision ?? 0` until
                        // `@objectstack/spec` was read at source: it declares
                        // `precision` as the "Total digits" of a decimal(p, s)
                        // column and `scale` as its "Decimal places", so the
                        // cell was padding a decimal(10, 2) percent field out to
                        // ten fraction digits and this chip mirrored it there.
                        // objectui#9167 routed this chip onto the LIST CELL as
                        // the authority — its ruling turns on the two being
                        // byte-equal — so when the cell's member moved, staying
                        // on `precision` is what would have BROKEN that ruling,
                        // not what would have kept it. Whatever the cell reads,
                        // this reads; that is the whole of the coupling.
                        const scale = resolveFieldScale({ type: ftype, scale: percentField.scale });
                        // The STORAGE is the field's too (objectui#11475):
                        // `percentCellScale` is the spec's `percentScaleOf`
                        // over the same merged bag (its `max`), the answer the
                        // list cell reads, so a fraction-stored `1` reads
                        // `100%` on both faces and a whole-stored `50` reads
                        // `50%`. Text and bar take the one answer.
                        const percentScale = percentCellScale({ type: ftype, max: percentField.max });
                        display = formatPercent(num, percentScale, scale, displayLocale);
                        const points = summaryChipPercentPoints(num, percentScale);
                        percentValue = Math.max(0, Math.min(100, points));
                      }
                    } else if (ftype === 'select' || ftype === 'status' || ftype === 'multiselect') {
                      // Resolve raw option label from field metadata as
                      // fallback, then translate via i18n resolver.
                      const opts = (sectionField as any)?.options || objField?.options;
                      let fallback = String(val);
                      if (Array.isArray(opts)) {
                        const m = opts.find((o: any) => String(o?.value ?? o) === String(val));
                        if (m?.label) fallback = m.label;
                      } else if (opts && typeof opts === 'object') {
                        const m = (opts as any)[String(val)];
                        if (m?.label) fallback = m.label;
                      }
                      display = schema.objectName
                        ? fieldOptionLabel(schema.objectName, fieldName, String(val), fallback)
                        : fallback;
                    }
                  } catch {
                    /* fall back to String(val) */
                  }

                  // ── The chip's STRING path cannot express an object ───────
                  //
                  // `String({…})` is the literal `[object Object]`, and it
                  // reached the reader twice: as the chip's text beside the H1
                  // and, because the accessible name is built from the same
                  // string, as the chip's accessible name (objectui#8464).
                  // Every branch above lands here too — `Number({})` is `NaN`,
                  // `new Date({})` is Invalid, and the option lookup falls back
                  // to `String(val)` — so the four formatted families are
                  // caught by this one test rather than by four of their own.
                  //
                  // The test is the DEFECT'S OWN SIGNATURE, not a type guess:
                  // it fires exactly where the placeholder was produced, so a
                  // value the string path already renders (`['a','b']` →
                  // `a,b`, every scalar) is byte-for-byte untouched.
                  //
                  // ⭐ Which side this chip is on was MEASURED, not argued.
                  // objectui#8395 established on this page that "render what
                  // the user sees" and "render the underlying value" give
                  // different answers per kind. This chip already answers the
                  // FIRST question for every family it formats — it prints
                  // `$1,235` for a stored `1234.5`, `Mar 4, 2026` for
                  // `'2026-03-04'`, `Closed Won` for `'won'` — so the display
                  // authority is the field's own cell renderer, exactly as
                  // `HeaderHighlight` reads it one band below.
                  //
                  // ⚠️ …but only where a pill can host it. A Badge is a much
                  // smaller surface than a cell: 15 of the 53 registered types
                  // draw a nested pill, an avatar composite, a bare `<img>`
                  // with no text, or a "No value" face for a value
                  // `hasCellValue` just called FILLED. Those kinds are named,
                  // with the measurement, in `./summaryChipRenderers`, and they
                  // take `coerceToSafeValue` — this package's single answer to
                  // the same question, and byte-equal to what seven of them
                  // print in their own cell (objectui#8596).
                  const chipField = enrichDetailField(
                    { name: fieldName, label: sectionField?.label, type: ftype || 'text' },
                    objField,
                  );
                  const chipRendererType =
                    resolveCellRendererType(chipField as any) || ftype || 'text';
                  const stringPathFailed = display.includes('[object Object]');
                  const ChipCellRenderer =
                    stringPathFailed && chipTakesCellRenderer(chipRendererType)
                      ? getCellRenderer(chipRendererType)
                      : null;
                  if (stringPathFailed && !ChipCellRenderer) {
                    display = String(coerceToSafeValue(val) ?? '');
                  }

                  if (ChipCellRenderer) {
                    return (
                      <Badge
                        key={fieldName}
                        variant="secondary"
                        className="text-xs bg-primary/10 text-primary border-transparent hover:bg-primary/15"
                        data-summary-chip={fieldName}
                      >
                        {/* The chip carries no visible label, so the field name
                            reached the reader only through the `aria-label`
                            that the string branches below still set. A renderer
                            draws an ELEMENT, and an `aria-label` would override
                            it — hiding the very value this branch exists to
                            show. Same accessible name, `field: value`, composed
                            from content instead. */}
                        <span className="sr-only">{`${chipLabel}: `}</span>
                        <ChipCellRenderer value={val} field={chipField as any} />
                      </Badge>
                    );
                  }

                  if (percentValue !== null) {
                    return (
                      <Badge
                        key={fieldName}
                        variant="secondary"
                        className="text-xs bg-primary/10 text-primary border-transparent hover:bg-primary/15 gap-1.5 pl-2 pr-2"
                        aria-label={`${chipLabel}: ${display}`}
                        data-summary-chip={fieldName}
                      >
                        <span
                          className="relative inline-block h-1.5 w-12 rounded-full bg-primary/20 overflow-hidden"
                          aria-hidden
                        >
                          <span
                            className="absolute inset-y-0 left-0 rounded-full bg-primary"
                            style={{ width: `${percentValue}%` }}
                          />
                        </span>
                        {display}
                      </Badge>
                    );
                  }
                  return (
                    <Badge
                      key={fieldName}
                      variant="secondary"
                      className="text-xs bg-primary/10 text-primary border-transparent hover:bg-primary/15"
                      aria-label={`${chipLabel}: ${display}`}
                      data-summary-chip={fieldName}
                    >
                      {display}
                    </Badge>
                  );
                })}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-6 w-6 shrink-0"
                      onClick={handleToggleFavorite}
                      aria-label={isFavorite ? t('detail.removeFromFavorites') : t('detail.addToFavorites')}
                    >
                      {isFavorite ? (
                        <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                      ) : (
                        <Star className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {isFavorite ? t('detail.removeFromFavorites') : t('detail.addToFavorites')}
                  </TooltipContent>
                </Tooltip>
              </div>
              {schema.objectName && (
                <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                  <span className="font-medium">{objectLabel || schema.objectName}</span>
                  {schema.resourceId && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 shrink-0 text-muted-foreground/60 hover:text-foreground"
                          onClick={handleCopyRecordId}
                          aria-label={t('detail.copyRecordId', { defaultValue: 'Copy record ID' })}
                        >
                          {idCopied ? (
                            <Check className="h-3 w-3 text-green-600" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {idCopied
                          ? t('detail.copied', { defaultValue: 'Copied!' })
                          : t('detail.copyRecordId', { defaultValue: 'Copy record ID' })}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 shrink-0 w-full sm:w-auto">
            {/* Prev/Next Record Navigation */}
            {schema.recordNavigation && (
              <div className="flex items-center gap-1 mr-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={schema.recordNavigation.currentIndex <= 0}
                      onClick={() => {
                        const nav = schema.recordNavigation!;
                        if (nav.currentIndex > 0) {
                          nav.onNavigate(nav.recordIds[nav.currentIndex - 1]);
                        }
                      }}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('detail.previousRecord')}</TooltipContent>
                </Tooltip>
                <span className="text-xs text-muted-foreground whitespace-nowrap px-1">
                  {t('detail.recordOf', { current: schema.recordNavigation.currentIndex + 1, total: schema.recordNavigation.recordIds.length })}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={schema.recordNavigation.currentIndex >= schema.recordNavigation.recordIds.length - 1}
                      onClick={() => {
                        const nav = schema.recordNavigation!;
                        if (nav.currentIndex < nav.recordIds.length - 1) {
                          nav.onNavigate(nav.recordIds[nav.currentIndex + 1]);
                        }
                      }}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('detail.nextRecord')}</TooltipContent>
                </Tooltip>
              </div>
            )}

            {/* The inline-edit Save / Cancel bar now lives in the record-level
                <InlineEditSaveBar> (rendered by the host), not the header —
                so the highlights strip and the details body share one bar and
                one atomic Save (objectui#2407 P1). */}

            {/* Share moved into the unified overflow menu (sys_share) so the
                header focuses on the primary Edit CTA. */}

            {/* Edit Button — desktop-only primary CTA. Mobile fallback is in
                the unified overflow via `systemActions`. */}
            {schema.showEdit && (
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* `userActions.edit.disabledWhen` greys the CTA instead of
                      removing it — the kebab's rule for the same key
                      (objectui#4419): `visibleWhen` decides existence,
                      `disabledWhen` decides pressability. */}
                  <Button
                    variant="default"
                    disabled={editDisabled}
                    onClick={() => { if (!editDisabled) handleEdit(); }}
                    className="gap-2 hidden sm:inline-flex"
                  >
                    <Edit className="h-4 w-4" />
                    <span className="hidden sm:inline">{t('detail.edit')}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('detail.editRecord')}</TooltipContent>
              </Tooltip>
            )}

            {/* Header business actions (and the unified "..." overflow menu
                that holds systemActions) render LAST so the three-dot more
                menu sits at the far right edge — the standard placement
                for "more options" affordances. */}
            {headerActionNodes.map((action, index) => (
              <SchemaRenderer key={`header-action-${index}`} schema={toRenderableSchema(action)} data={data} />
            ))}
          </div>
        </div>
        )}

      {/* Custom Header */}
{/* ⛔ No `&&` guard on a node slot (objectui#9162): `&&` evaluates to the
          slot itself, so a legal authored `header: 0` — the published node union
          carries a `z.number()` arm — painted the character "0" here. Measured
          leaking on `origin/main` at 7d6439c4b before this change; the card's
          census listed these two as HITS, and the probe confirmed them.
          `renderNodeSlot` runs the wrapper only when the slot has content, so
          the wrapping `div` disappears with it. Pinned in
          `__tests__/DetailView.nodeSlotNumericFalsy-9162.test.tsx`. */}
      {renderNodeSlot(schema.header, (header) => (
        <div>
          <SchemaRenderer schema={toRenderableSchema(header)} data={data} />
        </div>
      ))}

      {/* Header Highlight Area */}
      {schema.highlightFields && schema.highlightFields.length > 0 && (
        <HeaderHighlight fields={schema.highlightFields} data={data} objectName={schema.objectName} objectSchema={objectSchema} />
      )}

      {/* Approval band — when the DetailView's own header is suppressed
          (composed under a Lightning-style page:header), surface the running
          approval + recall affordance inline. The inline-edit Save / Cancel
          bar itself now lives in the record-level <InlineEditSaveBar>
          (objectui#2407 P1).

          objectui#12751 — not on a print page. The recall button is a control,
          and the status badge and the tally are the approval's live state:
          they differ by viewer (recall is the submitter's) and change with
          each decision, which is why the spec refuses `record:approvals` and
          `record:approval_decision` inside a print page. A printed record
          that should say where its approval stands prints the record's own
          status field through `record:details`, the way `record:path` leaves
          the current stage to it. */}
      {inlineEdit && schema.showHeader === false && !isPrintPage && (() => {
        // Two independent facts, not one (objectui#2902):
        //
        //   isPending — an approval is running on this record.
        //   isLocked  — that approval also forbids edits.
        //
        // They come apart because an approval node declares `lockRecord`, and
        // on a `lockRecord: false` node the backend accepts writes for the
        // whole time the node waits. Rendering one band for both states told
        // the user "locked" on a record they could freely edit, and the
        // approver — the very person the flag exists to let edit — never tried.
        //
        // The record's own `approval_status` is the fallback for bare/legacy
        // DetailView usage where no host threads the state (objectui#2618 for
        // why the record field alone is not enough). It carries no node
        // granularity, so it can only mean "locked" — the safe read, since a
        // wrongly-offered edit dies on the server with RECORD_LOCKED.
        //
        // But it must NOT be OR-ed in unconditionally, because the two sources
        // genuinely disagree in a shipping configuration: a flow configuring an
        // `approvalStatusField` mirrors `approval_status: 'pending'` onto the
        // record on submit *regardless of* `lockRecord` (framework
        // `mirrorStatusField`), so the mirror would drag the band back to
        // "Locked for approval" on exactly the `lockRecord: false` node this
        // feature exists to free — pencils live and saves landing underneath it.
        //
        // So a host-threaded approval decides: pending, and locked exactly when
        // the host says so. `InlineEditProvider` defaults `approvalPending` to
        // `locked`, so a host threading only `locked` (objectui#2618, before
        // `approvalPending` existed) still reads as an approval that locks.
        //
        // With none threaded, `false` / `false` is ambiguous: no host at all, a
        // host that read no approvals, or a host whose approvals read ANSWERED
        // and found nothing. Only the last means "no approval is running", and
        // it is the one that must not fall back to the column — a composition
        // without the approvals service answers the read empty, enforces no
        // lock, and the column's stale `pending` used to re-lock the band
        // (objectui#12220). `approvalReadAnswered` is the host saying which.
        //
        // `resolveApprovalLock` is the ONE rule: the record page host
        // (app-shell `RecordDetailView`) calls it for the pair it threads here.
        const hostLocked = inline?.locked ?? false;
        const hostPending = inline?.approvalPending ?? false;
        const { pending: isPending, locked: isLocked } = resolveApprovalLock({
          readAnswered: inline?.approvalReadAnswered === true,
          openApproval: hostPending || hostLocked ? { locked: hostLocked } : null,
          recordStatus: data?.approval_status,
        });
        // How many decisions the pending node still needs (objectstack#4478).
        // `lockRecord` told the approver they may not EDIT; this tells them
        // whether their own approval finalizes the step. A `quorum` node with
        // `minApprovals: 2` over three approvers, or a `per_group` (会签) node
        // waiting on finance and legal, are indistinguishable from a plain
        // one-approver step without it — the badge alone reads "someone must
        // approve", and the approver clicks expecting the record to move on.
        //
        // Server-computed (`decision_progress`), threaded by the host from the
        // approvals read; the renderer stays DataSource-agnostic and never
        // re-derives the engine's tally rules. Absent on `first_response`
        // nodes, where one decision IS the whole step and a "1 of 1" bar would
        // be noise.
        const progress = isPending ? inline?.approvalProgress : undefined;
        // A bar of `need` ticks is legible up to about a dozen; past that the
        // count in the label carries it alone rather than shrinking to hairlines.
        const segmented = !!progress && progress.need > 0 && progress.need <= 12;
        // Nothing to surface (no approval, no approval-cancel error): no band.
        if (!isPending && !saveError) return null;
        return (
        <div className="flex flex-col items-end gap-1">
          {isPending && (
            <div className="flex items-center justify-end gap-2">
              <span
                role="status"
                className={
                  isLocked
                    ? 'inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800'
                    // An editable approval is informational, not a warning —
                    // amber here would read as "something is blocked".
                    : 'inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-2 py-1 text-xs text-sky-800'
                }
                title={
                  isLocked
                    ? (inline?.lockedReason ?? t('detail.lockedTooltip'))
                    : t('detail.approvalPendingTooltip')
                }
              >
                {isLocked ? <Lock className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                <span>
                  {isLocked
                    ? t('detail.lockedByApproval')
                    : t('detail.approvalPendingEditable')}
                </span>
              </span>
              {/* Recall belongs to the approval, not to the lock: an editable
                  pending approval is just as recallable as a locked one.

                  It also belongs to the SUBMITTER (`830ed5803`). The server
                  authorizes recall on submitter identity and refuses everyone
                  else, so rendering the button for every reader of a pending
                  record offers a lever whose click must fail — the
                  writability-feedback mismatch, not a permission question: what
                  the server permits is unchanged by this gate, and nothing
                  downstream treats `approvalIsSubmitter` as authorization.

                  Withdrawn rather than disabled-with-reason, matching the
                  sibling submitter levers (the approvals panel's Remind, the
                  declared `approval_recall` action's `visible` predicate): for a
                  non-submitter this control is never actionable on any pending
                  record, so a permanently disabled button would be standing
                  clutter on a band that already states the record is in
                  approval. The band, its tally and the approvals timeline still
                  explain the state to everyone; only the lever they can never
                  pull is gone.

                  `undefined` means the host resolves no approval identity, and
                  then this renders exactly as it did before the signal existed
                  — hiding on absent information would take the submitter's own
                  unlock lever away (see InlineEditContextValue). */}
              {dataSource?.cancelPendingApproval && inline?.approvalIsSubmitter !== false && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancelApproval}
                  disabled={isCancellingApproval}
                  className={
                    isLocked
                      ? 'gap-2 border-amber-300 text-amber-800 hover:bg-amber-50'
                      : 'gap-2 border-sky-300 text-sky-800 hover:bg-sky-50'
                  }
                  // The locked variant's tooltip promises to UNLOCK the record;
                  // on a node that never locked it, that sentence describes an
                  // effect the click does not have.
                  title={isLocked
                    ? t('detail.cancelApprovalTooltip')
                    : t('detail.cancelApprovalTooltipUnlocked')}
                >
                  <X className="h-4 w-4" />
                  <span>
                    {isCancellingApproval
                      ? t('detail.cancelApprovalInFlight')
                      : t('detail.cancelApproval')}
                  </span>
                </Button>
              )}
            </div>
          )}
          {progress && (
            <div className="flex flex-col items-end gap-1 max-w-[16rem]">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={progress.need}
                aria-valuenow={Math.min(progress.got, progress.need)}
                aria-label={t('detail.approvalProgressLabel')}
                className="flex items-center gap-2 w-full justify-end"
              >
                <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                  {progress.behavior === 'per_group'
                    ? t('detail.approvalProgressGroups', { got: progress.got, need: progress.need })
                    : t('detail.approvalProgress', { got: progress.got, need: progress.need })}
                </span>
                {segmented && (
                  <span className="flex items-center gap-1 w-20 shrink-0">
                    {Array.from({ length: progress.need }).map((_, i) => (
                      <span
                        key={i}
                        aria-hidden="true"
                        className={cn(
                          'h-1.5 flex-1 rounded-full',
                          i < progress.got ? 'bg-emerald-500' : 'bg-muted',
                        )}
                      />
                    ))}
                  </span>
                )}
              </div>
              {/* Per-group ticks (会签): WHICH groups have signed, not just how
                  many. Group keys come from the data — the flow author's own
                  labels — so there are no locale strings to add for them. */}
              {progress.groups && progress.groups.length > 0 && (
                <div className="flex flex-wrap justify-end gap-1">
                  {progress.groups.map((g) => (
                    <span
                      key={g.group}
                      title={`${g.got}/${g.need}`}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]',
                        g.satisfied
                          ? 'border-emerald-300 text-emerald-700'
                          : 'border-border text-muted-foreground',
                      )}
                    >
                      {g.satisfied
                        ? <Check className="h-3 w-3" />
                        : <Circle className="h-2.5 w-2.5" />}
                      <span>{`${g.group} ${g.got}/${g.need}`}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          {saveError && (
            <div
              role="alert"
              className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-2 py-1 max-w-md text-right"
            >
              {saveError}
            </div>
          )}
        </div>
        );
      })()}

      {/* Auto Tabs mode: wrap sections, related, activity into tabs.
          When only the Details tab would render (no related, no activity, no
          discussion), skip the Tabs strip entirely — it's pure visual noise. */}
      {schema.autoTabs && !schema.tabs?.length ? (() => {
        const hasActivity = !!schema.activities && schema.activities.length > 0;
        const hasDiscussion = !!discussionSlot;
        const hasHistory = !!schema.history;
        // objectui#2257 — the host may supply the initial tab (restored from
        // `?tab=`) and a change callback (writes it back). Honored only when
        // the requested value names a tab that actually renders; the active
        // tab must survive this component remounting, so it cannot live only
        // in Radix's uncontrolled state.
        const tabValues = [
          'details',
          ...(hasActivity ? ['activity'] : []),
          ...(hasDiscussion ? ['discussion'] : []),
          ...(hasHistory ? ['history'] : []),
        ];
        const requestedTab = (schema as any).defaultTab as string | undefined;
        const initialTab = requestedTab && tabValues.includes(requestedTab) ? requestedTab : 'details';
        const onTabChange = (schema as any).onTabChange as ((value: string) => void) | undefined;
        const detailsContent = (
          <div className="space-y-3 sm:space-y-4">
            {/* Section Groups */}
            {schema.sectionGroups && schema.sectionGroups.length > 0 && (
              schema.sectionGroups.map((group, index) => (
                <SectionGroup
                  key={index}
                  group={group}
                  data={{ ...data, ...editedValues }}
                  objectSchema={objectSchema}
                  objectName={schema.objectName}
                  isEditing={isInlineEditing}
                  onFieldChange={handleInlineFieldChange}
                  onEnterInlineEdit={inlineEdit ? handleEnterInlineEditField : undefined}
                  autoFocusField={autoFocusField}
                  dataSource={dataSource}
                />
              ))
            )}
            {schema.sections && schema.sections.length > 0 && foldEmptySections(
              schema.sections.map((section, index) => (
                <SectionBoundary key={index} section={section} index={index}>
                  <DetailSection
                    section={section}
                    data={{ ...data, ...editedValues }}
                    objectSchema={objectSchema}
                    objectName={schema.objectName}
                    isEditing={isInlineEditing}
                    onFieldChange={handleInlineFieldChange}
                    onEnterInlineEdit={inlineEdit ? handleEnterInlineEditField : undefined}
                    autoFocusField={autoFocusField}
                    dataSource={dataSource}
                  />
                </SectionBoundary>
              ))
            )}
            {schema.fields && schema.fields.length > 0 && !schema.sections?.length && (
              <DetailSection
                section={{
                  fields: schema.fields,
                  columns: schema.columns,
                }}
                data={{ ...data, ...editedValues }}
                objectSchema={objectSchema}
                objectName={schema.objectName}
                isEditing={isInlineEditing}
                onFieldChange={handleInlineFieldChange}
                onEnterInlineEdit={inlineEdit ? handleEnterInlineEditField : undefined}
                autoFocusField={autoFocusField}
                dataSource={dataSource}
              />
            )}
            {/* Comments in details tab */}
            {schema.comments && (
              <RecordComments
                comments={schema.comments}
                onAddComment={schema.onAddComment}
              />
            )}
          </div>
        );

        if (!hasActivity && !hasDiscussion && !hasHistory) {
          // Single-tab case: render just the details content without a tab strip.
          return <div className="mt-2">{detailsContent}</div>;
        }

        return (
          <Tabs defaultValue={initialTab} onValueChange={onTabChange} className="w-full">
            <TabsList className="w-full justify-start border-b rounded-none bg-transparent p-0">
              <TabsTrigger
                value="details"
                className="relative rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
              >
                {t('detail.details')}
              </TabsTrigger>
              {hasActivity && (
                <TabsTrigger
                  value="activity"
                  className="relative rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
                >
                  <span className="flex items-center gap-1.5">
                    {t('detail.activity')}
                    <Badge variant="secondary" className="text-xs bg-primary/10 text-primary border-transparent">{schema.activities!.length}</Badge>
                  </span>
                </TabsTrigger>
              )}
              {hasDiscussion && (
                <TabsTrigger
                  value="discussion"
                  className="relative rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
                >
                  {t('detail.discussion', { defaultValue: 'Discussion' })}
                </TabsTrigger>
              )}
              {hasHistory && (
                <TabsTrigger
                  value="history"
                  className="relative rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
                >
                  <span className="flex items-center gap-1.5">
                    {t('detail.history', { defaultValue: 'History' })}
                    {!schema.history!.loading && schema.history!.entries.length > 0 && (
                      <Badge variant="secondary" className="text-xs bg-primary/10 text-primary border-transparent">
                        {schema.history!.entries.length}
                      </Badge>
                    )}
                  </span>
                </TabsTrigger>
              )}
            </TabsList>

            {/* Details Tab Content */}
            <TabsContent value="details" className="mt-4 motion-safe:data-[state=active]:animate-in motion-safe:data-[state=active]:fade-in-0 motion-safe:duration-150">
              {detailsContent}
            </TabsContent>

            {/* Activity Tab Content */}
            {hasActivity && (
              <TabsContent value="activity" className="mt-4 motion-safe:data-[state=active]:animate-in motion-safe:data-[state=active]:fade-in-0 motion-safe:duration-150">
                <ActivityTimeline activities={schema.activities!} />
              </TabsContent>
            )}

            {/* Discussion Tab Content */}
            {hasDiscussion && (
              <TabsContent value="discussion" className="mt-4 motion-safe:data-[state=active]:animate-in motion-safe:data-[state=active]:fade-in-0 motion-safe:duration-150">
                {discussionSlot}
              </TabsContent>
            )}

            {/* History Tab Content */}
            {hasHistory && (
              <TabsContent value="history" className="mt-4 motion-safe:data-[state=active]:animate-in motion-safe:data-[state=active]:fade-in-0 motion-safe:duration-150">
                <HistoryTimeline
                  entries={schema.history!.entries}
                  loading={schema.history!.loading}
                  emptyText={schema.history!.emptyText ?? t('detail.historyEmpty', { defaultValue: 'No history yet' })}
                />
              </TabsContent>
            )}
          </Tabs>
        );
      })() : (
        <>
          {/* Section Groups */}
          {schema.sectionGroups && schema.sectionGroups.length > 0 && (
            <div className="space-y-3 sm:space-y-4">
              {schema.sectionGroups.map((group, index) => (
                <SectionGroup
                  key={index}
                  group={group}
                  data={{ ...data, ...editedValues }}
                  objectSchema={objectSchema}
                  objectName={schema.objectName}
                  isEditing={isInlineEditing}
                  onFieldChange={handleInlineFieldChange}
                  onEnterInlineEdit={inlineEdit ? handleEnterInlineEditField : undefined}
                  autoFocusField={autoFocusField}
                  dataSource={dataSource}
                />
              ))}
            </div>
          )}

          {/* Sections */}
          {schema.sections && schema.sections.length > 0 && (
            <div className="space-y-3 sm:space-y-4">
              {foldEmptySections(schema.sections.map((section, index) => (
                <SectionBoundary key={index} section={section} index={index}>
                  <DetailSection
                    section={section}
                    data={{ ...data, ...editedValues }}
                    objectSchema={objectSchema}
                    objectName={schema.objectName}
                    isEditing={isInlineEditing}
                    onFieldChange={handleInlineFieldChange}
                    onEnterInlineEdit={inlineEdit ? handleEnterInlineEditField : undefined}
                    autoFocusField={autoFocusField}
                    dataSource={dataSource}
                  />
                </SectionBoundary>
              )))}
            </div>
          )}

          {/* Direct Fields (if no sections) */}
          {schema.fields && schema.fields.length > 0 && !schema.sections?.length && (
            <DetailSection
              section={{
                fields: schema.fields,
                columns: schema.columns,
              }}
              data={{ ...data, ...editedValues }}
              objectSchema={objectSchema}
              objectName={schema.objectName}
              isEditing={isInlineEditing}
              onFieldChange={handleInlineFieldChange}
              onEnterInlineEdit={inlineEdit ? handleEnterInlineEditField : undefined}
              autoFocusField={autoFocusField}
              dataSource={dataSource}
            />
          )}

          {/* Tabs */}
          {schema.tabs && schema.tabs.length > 0 && (
            <DetailTabs tabs={schema.tabs} data={data} />
          )}

          {/* Comments */}
          {schema.comments && (
            <RecordComments
              comments={schema.comments}
              onAddComment={schema.onAddComment}
            />
          )}

          {/* Activity Timeline */}
          {schema.activities && schema.activities.length > 0 && (
            <ActivityTimeline activities={schema.activities} />
          )}
        </>
      )}

      {/* Record provenance footer — replaces the old "System Information"
          section with a low-visual-weight single-line summary of audit
          fields (created/updated by + when). Renders nothing when none of
          the audit fields are present on the record. Not drawn here when the
          record page draws it once for the record (objectui#12307, see
          `RecordPageProvenanceContext`). */}
      {!pageDrawsProvenance && (
        <RecordMetaFooter
          data={{ ...data, ...editedValues }}
          objectSchema={objectSchema}
          objectName={schema.objectName}
        />
      )}

      {/* Custom Footer */}
{/* ⛔ No `&&` guard on a node slot (objectui#9162): `&&` evaluates to the
          slot itself, so a legal authored `footer: 0` — the published node union
          carries a `z.number()` arm — painted the character "0" here. Measured
          leaking on `origin/main` at 7d6439c4b before this change; the card's
          census listed these two as HITS, and the probe confirmed them.
          `renderNodeSlot` runs the wrapper only when the slot has content, so
          the wrapping `div` disappears with it. Pinned in
          `__tests__/DetailView.nodeSlotNumericFalsy-9162.test.tsx`. */}
      {renderNodeSlot(schema.footer, (footer) => (
        <div>
          <SchemaRenderer schema={toRenderableSchema(footer)} data={data} />
        </div>
      ))}
      </div>
    </TooltipProvider>
  );
};
