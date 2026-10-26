import React, { useState, useEffect, useCallback, useRef, useContext, useMemo } from 'react';
import { cn,
  Button,
  Input,
  Badge,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Popover,
  PopoverTrigger,
  PopoverContent, EmptyValue } from '@object-ui/components';
import { Search, X, Loader2, AlertCircle, Plus, TableProperties } from 'lucide-react';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';
import type { DataSource, FormField, QueryParams, LookupColumnDef, LookupFieldMetadata } from '@object-ui/types';
import { RecordPickerDialog, lookupFiltersToRecord } from './RecordPickerDialog.js';
import type { RecordPickerFilterColumn } from './RecordPickerDialog.js';
import { PeoplePicker } from './PeoplePicker.js';
import { useRecordQuery } from './useRecordQuery.js';
import { objectResolvesSearch } from './searchOffer.js';
import { deriveLookupColumns } from './deriveLookupColumns.js';
import { buildExpandFields, getRecordDisplayName, mergeFilterNodes, resolveAffordance, toPredicateRecord, withoutDeniedFields } from '@object-ui/core';
import { getRecentLookupIds, pushRecentLookupId } from './recentLookups.js';
import { getPersonInitials } from './personDisplay.js';
import { getCellRendererResolver } from './_cell-renderer-bridge.js';
// The one place a lookup column's display value is decided — shared with the
// "browse all records" picker (RecordPickerDialog) so a single `lookupColumns`
// declaration cannot render two different ways (objectui#5492).
import {
  normalizeColumn,
  fieldToLabel,
  buildLookupColumnDescriptors,
  renderLookupColumnValue,
} from './lookupColumnDisplay.js';
import { useSafeFieldLabel, useDisplayLocale } from '@object-ui/i18n';
import { SchemaRendererContext as ImportedSchemaRendererContext, useAction, useHasActionProvider } from '@object-ui/react';
import { usePermissions } from '@object-ui/permissions';
import { useFieldTranslation } from './useFieldTranslation.js';

export interface LookupOption {
  value: string | number;
  label: string;
  /**
   * Secondary text: searched by the popover typeahead alongside the label, and
   * rendered as supporting text. For AUTHORED static options this is the
   * declared `SelectOptionMetadata.description` (objectui#6153 — declared
   * there, and on `@objectstack/spec`'s `SelectOptionSchema`, precisely
   * because this widget consumes it); for fetched records `recordToOption`
   * derives it from `descriptionField`.
   */
  description?: string;
  [key: string]: any;
}

/** Page size for the quick-select popover typeahead */
const LOOKUP_PAGE_SIZE = 50;

/**
 * SchemaRendererContext is created by @object-ui/react.
 * Using a static import to be compatible with Next.js Turbopack SSR.
 *
 * ⚠️ This used to re-declare the imported context as `React.Context<any>`.
 * That widening was invisible at the read sites — every `ctx?.…` below read as
 * `any` while looking perfectly typed — so it also laundered the `dataSource`
 * read, which is precisely the consumer face objectui#7912 typed. The import
 * is now used AS DECLARED; the one read that needs members the context does
 * not declare takes a local widened VIEW of the value (see the
 * `resolvedDependentValues` note), so the widening is visible where it happens
 * and reaches nothing else.
 */
const SchemaRendererContext = ImportedSchemaRendererContext;

/**
 * A relation whose picker should offer inline "create the referenced record" by
 * default. Inline quick-create is a STANDARD capability so a freshly-built app
 * isn't a dead end (an empty required picker → you can create the FIRST related
 * record right here). Platform/system objects are excluded: the user directory
 * (`sys_user` and its bare `user`/`users` aliases) and everything under the
 * `sys_`/`cloud_`/`ai_` namespaces are pre-populated plumbing you must not create
 * from a field picker. A user-authored business entity (customer, pet, book, …)
 * never matches, so it gets the capability.
 */
const SYSTEM_REFERENCE_RX = /^(sys_|cloud_|ai_)/;
const USER_DIRECTORY_REFS = new Set(['user', 'users']);
function isUserFacingReference(reference: string | undefined): boolean {
  return !!reference && !SYSTEM_REFERENCE_RX.test(reference) && !USER_DIRECTORY_REFS.has(reference);
}

/**
 * The record field a lookup reads when the field declares no `displayField`:
 * the quick-create payload key, the pickers' display column, and the option
 * label's first rung when the referenced object's schema is not available.
 * It is a guess, not a declaration, so it never outranks what the referenced
 * object declares (see `recordToOption`).
 */
const DEFAULT_DISPLAY_FIELD = 'name';

/**
 * Map a raw record to a LookupOption using a display field and an id field.
 *
 * Label precedence (ADR-0079; objectui#10343, the lookup branch of
 * objectui#9436's ruling C1):
 *   1. with the referenced object's schema (`objectDef`): the unified
 *      `@object-ui/core#getRecordDisplayName`, with the field's DECLARED
 *      `displayField` as its `titleField` — the same call the read cell's
 *      `LookupCellRenderer` makes, so the dropdown, the chip and the record
 *      page agree:
 *        a. the field's own declared `displayField` (the author's explicit
 *           choice for this field),
 *        b. the object's declared `nameField` (then its deprecated aliases),
 *        c. the object's deprecated `titleFormat` template,
 *        d. type-aware derivation, then name-ish keys on the record.
 *      We stop short of the resolver's `Record #<id>` floor here so the chip
 *      still falls through to the bare id when nothing nameable exists.
 *   2. the display field on the record — the declared one, else
 *      {@link DEFAULT_DISPLAY_FIELD}. Without a schema this is the first rung;
 *      with one, the `name` guess sits BELOW the object's declarations, which
 *      is what `@objectstack/spec` means by the field "defaults to the
 *      referenced object's name/title".
 *   3. the legacy hard-coded name list, then the raw id.
 *
 * The template is not rendered here: `getRecordDisplayName` renders
 * `objectDef.titleFormat` itself (the shared `formatTitleTemplate`), at its
 * ADR-0079 rung.
 *
 * The label is a DISPLAY value, so it is built from the row as the user may
 * read it on `policyObject` (objectui#10373): once `policy` has loaded, every
 * field it denies is removed first by `withoutDeniedFields` from
 * `@object-ui/core` (objectui#10594), `idField` kept — the row ObjectStack's
 * `FieldMasker` already serves — and the chain above falls through exactly as
 * it does for that row. Nothing else moves: the value, the description and the record the
 * option carries (what `onSelectRecord` receives) are the row as served.
 *
 * @param displayField the lookup field's DECLARED `displayField` (or
 *   `reference_field`), `undefined` when it declares none — never the
 *   {@link DEFAULT_DISPLAY_FIELD} fallback, which would rank a guess above the
 *   referenced object's `nameField`.
 */
function recordToOption(
  record: any,
  displayField: string | undefined,
  idField: string,
  descriptionField: string | undefined,
  objectDef: any,
  policy: FieldReadPolicy,
  policyObject: string | undefined,
): LookupOption {
  const val = recordValue(record, idField);
  const shown = withoutDeniedFields(record, policy, policyObject, [idField]);

  // Object-level resolver, excluding its id floor so we don't shadow the
  // explicit `String(val)` tail.
  let unified: string | undefined;
  if (objectDef) {
    const resolved = getRecordDisplayName(objectDef, shown, { titleField: displayField });
    const id = record?.id ?? record?._id;
    const isFloor =
      resolved === 'Untitled' ||
      (id !== null && id !== undefined && resolved === `Record #${id}`);
    if (!isFloor) unified = resolved;
  }

  const label =
    unified ??
    shown[displayField ?? DEFAULT_DISPLAY_FIELD] ??
    shown.label ??
    shown.name ??
    shown.full_name ??
    shown.title ??
    shown.subject ??
    shown.externalId ??
    String(val);
  const description = descriptionField ? record[descriptionField] : undefined;
  const option = { value: val, label: String(label), description, ...record };
  // A row field literally named `label` wins the spread above. When a field was
  // withheld, the label built from the shown row stands instead, so a denied
  // `label` field cannot come back through the spread.
  return shown === record ? option : { ...option, label: String(label) };
}

/**
 * The committed value a fetched row stands for: the `value` of the option
 * `recordToOption` builds from it. The hydrated rows are keyed by it, so a
 * cached row and the option `findOption` matches can never disagree about
 * which value they belong to.
 */
function recordValue(record: Record<string, unknown>, idField: string): unknown {
  return record[idField] ?? record.id ?? record._id ?? record.externalId;
}

/**
 * `rows` merged into `prev` by the value each stands for (`recordValue`): a
 * later row for a value replaces the earlier one. Both row caches — the
 * hydrated rows and the picked rows — merge this way, so each holds one row
 * per value.
 */
function mergeRowsByValue(
  prev: Record<string, unknown>[],
  rows: Record<string, unknown>[],
  idField: string,
): Record<string, unknown>[] {
  const map = new Map(prev.map((r) => [recordValue(r, idField), r]));
  for (const r of rows) map.set(recordValue(r, idField), r);
  return Array.from(map.values());
}

/** The two members of the permission context the field-read rule asks. */
type FieldReadPolicy = Pick<ReturnType<typeof usePermissions>, 'isLoaded' | 'checkField'>;

/**
 * A reference value can arrive JSON-encoded — e.g. an unresolved external-id
 * reference `'{"externalId":"Website Relaunch"}'`. Parse such a string into its
 * object form so the inline editor resolves it through the same path as a
 * server-`$expand`ed record. Returns null for anything that isn't a JSON object
 * string. Mirrors the read cell (`LookupCellRenderer`) so the two stay aligned.
 */
function parseReferenceObjectString(v: any): Record<string, any> | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s.startsWith('{') || !s.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Map a LookupColumnDef.type to a filter input type for the filter bar.
 * Returns undefined if the field type is not filterable.
 */
function mapFieldTypeToFilterType(
  fieldType: string,
): RecordPickerFilterColumn['type'] | undefined {
  const mapping: Record<string, RecordPickerFilterColumn['type']> = {
    text: 'text',
    number: 'number',
    currency: 'number',
    percent: 'number',
    select: 'select',
    status: 'select',
    date: 'date',
    datetime: 'date',
    boolean: 'boolean',
  };
  return mapping[fieldType];
}

/**
 * Fit one option's preview line to its one line (objectui#13123): show every
 * segment, then hide the last one still shown for as long as the line
 * overflows, so a column the line cannot hold leaves WHOLE, together with every
 * column after it. A segment that draws a badge never shrinks and a text
 * segment never shrinks below its label (`previewOf`), so this is the only way
 * a column gives way once the text values are cut as far as they go.
 *
 * Read off the rendered box, never computed from field types: a cell renderer
 * draws what it draws, and only the browser knows how wide that is. jsdom has
 * no layout, where both widths read 0 and nothing is hidden.
 */
function fitPreviewLine(line: HTMLElement): void {
  const segments = Array.from(line.children) as HTMLElement[];
  for (const segment of segments) segment.hidden = false;
  for (let i = segments.length - 1; i >= 0 && line.scrollWidth > line.clientWidth; i -= 1) {
    segments[i].hidden = true;
  }
}

/**
 * The line under an option's label: the segments `previewOf` builds, fitted by
 * {@link fitPreviewLine} after every commit (the segments may have changed)
 * and whenever the line's own box is resized (the popover follows its
 * trigger's width).
 */
function OptionPreviewLine({ children }: { children: React.ReactNode }) {
  const lineRef = useRef<HTMLSpanElement>(null);
  React.useLayoutEffect(() => {
    if (lineRef.current) fitPreviewLine(lineRef.current);
  });
  React.useLayoutEffect(() => {
    const line = lineRef.current;
    if (!line || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => fitPreviewLine(line));
    observer.observe(line);
    return () => observer.disconnect();
  }, []);
  return (
    <span
      ref={lineRef}
      className="flex min-w-0 items-center gap-1 overflow-hidden text-xs text-muted-foreground"
      data-testid="lookup-option-preview"
    >
      {children}
    </span>
  );
}

/**
 * Lookup field for selecting related records.
 * Supports single and multi-select with search.
 *
 * When a `dataSource` is provided (either via props, via `field.dataSource`,
 * or via SchemaRendererContext), the dialog will dynamically load records
 * from the referenced object using `DataSource.find()`.
 * Falls back to static `options` when no DataSource is available.
 */
export function LookupField({ value, onChange, field, readonly, error: fieldError, ...props }: FieldWidgetComponentProps<any>) {
  const [isOpen, setIsOpen] = useState(false);
  const { t } = useFieldTranslation();
  // Same two i18n channels RecordPickerDialog reads, so the inline dropdown
  // resolves option labels and formats dates exactly as the picker does
  // (objectui#5492). Both are provider-safe.
  const { translateOptions } = useSafeFieldLabel();
  const displayLocale = useDisplayLocale();
  const listboxId = React.useId();

  // Create-new error is local; the popover's fetch state (search/loading/error/
  // total/options) is sourced from the shared useRecordQuery kernel below.
  const [createError, setCreateError] = useState<string | null>(null);

  // Records a pick committed — from the dropdown, the Level-2 pickers or
  // quick-create — so that findOption can resolve display labels even when the
  // record is not part of the Level 1 popover fetch. Kept as ROWS, not as
  // options, exactly as `hydratedRecords` below: the option is derived from
  // them on every render (`pickedOptions`), so its label follows the
  // referenced object's schema when that arrives after the pick
  // (objectui#10559).
  const [pickedRecords, setPickedRecords] = useState<Record<string, unknown>[]>([]);

  // Records fetched to label a value the field already holds (the hydration
  // effect below). Kept as the ROWS the DataSource served, not as options: the
  // option — its label above all — is derived from them on every render
  // (`hydratedOptions`), so it follows the referenced object's schema when that
  // arrives after the record (objectui#10487).
  const [hydratedRecords, setHydratedRecords] = useState<Record<string, unknown>[]>([]);

  // Ids whose hydration attempt has FINISHED — found or not — keyed by
  // String(id). Distinguishes "still loading" from "unresolvable" (deleted
  // record, fetch failure) so the trigger's hydrating state can't stick
  // forever on an id that will never resolve (#3108).
  const [hydrationSettled, setHydrationSettled] = useState<Set<string>>(() => new Set());

  // Arrow-key active index (-1 = none)
  const [activeIndex, setActiveIndex] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  const lookupField = field as any;

  // The form renderer passes `field: field.field || field` — `.field` is the
  // declared metadata slot (objectui#3090) — so the actual objectSchema field
  // metadata (reference, displayField, etc.) can arrive nested at
  // `lookupField.field`. Unwrap it so lookup-specific properties resolve
  // correctly. (This used to credit the docs-demo `createFieldRenderer` wrapper,
  // which never produced the nesting and was removed in objectui#3910; the form
  // path is the real producer.)
  const innerField = lookupField?.field;
  const fieldMeta = (innerField && typeof innerField === 'object' && ('reference' in innerField || 'type' in innerField))
    ? innerField
    : lookupField;
  // `idField`, `picker` and `subtitle` are picker configuration a HOST writes
  // onto this carrier (a form entry, an action parameter, a flow binding, a
  // `master_detail` inline grid column, `UserField`'s own defaults), never
  // object metadata: `FieldSchema` refuses all three by name, so the field
  // metadata types stopped declaring them (objectui#12242). They are read
  // through the face that does declare them, the form entry's.
  const pickerConfig: Pick<FormField, 'idField' | 'picker' | 'subtitle'> | undefined = fieldMeta;

  const staticOptions: LookupOption[] = fieldMeta?.options || [];
  const multiple = fieldMeta?.multiple || false;
  // The field's OWN display field, as declared — what `recordToOption` ranks
  // above the referenced object's declarations (objectui#10343). Read exactly as
  // the read cell (`LookupCellRenderer`) reads it.
  const declaredDisplayField: string | undefined =
    fieldMeta?.displayField || fieldMeta?.reference_field || undefined;
  const displayField = declaredDisplayField || DEFAULT_DISPLAY_FIELD;
  const descriptionField: string | undefined = fieldMeta?.descriptionField;
  const idField = pickerConfig?.idField || 'id';
  // `reference` — `@objectstack/spec`'s `FieldSchema.reference` — is the only
  // target spelling read (objectui#11070 round 4). A served def that still
  // spells a legacy key was folded onto it at ingestion
  // (`normalizeSchemaReferenceKeys`); no second spelling is read here.
  const referenceTo: string | undefined = fieldMeta?.reference;
  // Inline quick-create — a STANDARD capability, default ON for user-facing
  // relations: an empty/zero-result picker offers to create the referenced
  // record (opening its create form; see handleCreateNew) so the first related
  // record can be made right here. An explicit `allowCreate` wins — set it
  // `false` to opt a field out; system/user-directory references are excluded
  // from the default (isUserFacingReference).
  //
  // `allowCreate`, `lookupColumns` and `lookupPageSize` are the spellings
  // `@objectstack/spec`'s `FieldSchema` declares, and the only ones read here
  // (objectui#12157). The snake_case twins `allow_create` / `lookup_columns` /
  // `lookup_page_size` used to be read FIRST; they are retired, with no alias.
  // A served def loses nothing: the ingestion fold (`normalizeSchemaReferenceKeys`,
  // objectui#7650 ruling A) stamps a stored snake spelling onto its declared
  // key for every object `ObjectStackAdapter.getObjectSchema` serves and
  // `MetadataProvider` stores. A def handed to this widget any other way must
  // spell the declared key.
  const explicitAllowCreate = fieldMeta?.allowCreate;
  const allowCreate: boolean =
    explicitAllowCreate != null ? !!explicitAllowCreate : isUserFacingReference(referenceTo);

  // Enterprise Record Picker configuration
  const lookupColumns: Array<string | LookupColumnDef> | undefined = fieldMeta?.lookupColumns;
  const lookupPageSize: number | undefined = fieldMeta?.lookupPageSize;
  const lookupFilters: import('@object-ui/types').LookupFilterDef[] | undefined = fieldMeta?.lookupFilters;

  // Search-first PeoplePicker opt-in (user fields). When `picker === 'search'`
  // the Level-2 picker is the rich PeoplePicker (avatar rows + selection tray)
  // instead of the classic table dialog. `subtitle`/`avatar_field` drive the rows.
  const pickerVariant: string | undefined = pickerConfig?.picker;
  const subtitleFields: string[] | undefined = pickerConfig?.subtitle;
  const avatarField: string = fieldMeta?.avatar_field ?? fieldMeta?.avatarField ?? 'image';

  /**
   * Dependent lookups — restrict candidates based on values of *other* fields
   * in the same form. Two shapes are accepted:
   *
   * 1. `dependsOn: ['country']` → shorthand. The dependent field value is sent
   *    as both the filter field and the source field (i.e. `country = ${country}`).
   * 2. `dependsOn: [{ field: 'country', param: 'country_id' }]` → explicit.
   *    The remote field name (`param`) can differ from the local field name.
   *
   * The key is read THROUGH THE DECLARED TYPE (objectui#6153): `dependsOn` is
   * `BaseFieldMetadata.dependsOn`, the spec's field-level spelling — and since
   * objectui#7357 the ONLY one. That card retired objectui's snake_case twin
   * `depends_on` under ADR-0049 enforce-or-remove: it was never a spec key
   * (`FieldSchema` refuses it by name), so a second arm here would keep a
   * renderer-side dialect alive against a contract that rejects it. Only
   * this cascade read goes through `LookupFieldMetadata`; the rest of
   * `fieldMeta` stays untyped because its camelCase-fallback family
   * (`displayField`, `descriptionField`, …) is objectui#4631's population.
   *
   * When any dependency is empty, the lookup is gated and the user sees a
   * helpful "Select {field} first" hint instead of unfiltered records.
   */
  const cascadeMeta: LookupFieldMetadata | undefined = fieldMeta;
  const dependsOn = useMemo<Array<{ field: string; param: string }>>(() => {
    const raw = cascadeMeta?.dependsOn;
    // A bare parent name is the FORM-level shape (`FormField.dependsOn`), not the
    // field-level one the spec declares (array only) — an untyped host handing
    // one through still gets no cascade here, exactly as before.
    if (!raw || !Array.isArray(raw)) return [];
    return raw.map((d) =>
      typeof d === 'string' ? { field: d, param: d } : { field: d.field, param: d.param ?? d.field },
    );
  }, [cascadeMeta?.dependsOn]);

  /**
   * The gate sentence's `{{fields}}` — the controlling fields named the way the
   * user sees them on the form, not the way the metadata spells them.
   *
   * `dependsOn` holds API names, and this used to interpolate them straight
   * into the sentence, so every locale — `en` included — read "Select
   * crm_account first" (objectstack#5407): an internal identifier in the UI,
   * not merely an untranslated word. The host form supplies the name→label map
   * (`dependsOnLabels`); a name it doesn't cover falls back to itself, so a
   * standalone widget with no host renders exactly what it did before.
   *
   * The separator between the names is a LOCALE property, not a code constant
   * (objectui#4026, the mechanism objectstack#5407 established for the
   * invalid-submit toast). It used to be a hardcoded `', '` here while the
   * form renderer's copy of this same gate hardcoded `' / '`, so one shared
   * sentence read two different ways depending on which side produced it —
   * and under zh/ja both spellings were wrong for the script. Every caller of
   * the gate sentence now reads `validation.formInvalidJoiner`, the one
   * already-shipped key for exactly this kind of truncated-name list.
   */
  const dependsOnLabelsProp = props.dependsOnLabels;
  const dependsOnFieldsText = useMemo(
    () =>
      dependsOn
        .map((d) => dependsOnLabelsProp?.[d.field] || d.field)
        .join(t('validation.formInvalidJoiner')),
    [dependsOn, dependsOnLabelsProp, t],
  );

  // The record a dependent lookup gates on. The HOST supplies it on the
  // `dependentValues` prop; there is no context fallback (objectui#7206) — see
  // the resolver below.
  const dependentValuesProp = props.dependentValues;

  // Resolve DataSource: explicit prop > field-level > wrapper field > SchemaRendererContext > none
  const ctx = useContext(SchemaRendererContext);
  const contextDataSource = ctx?.dataSource ?? null;
  const dataSource: DataSource | null =
    (props.dataSource as DataSource | null | undefined) ?? lookupField?.dataSource ?? fieldMeta?.dataSource ?? contextDataSource;

  /** The record this picker gates and scopes itself by: the `dependentValues`
   *  prop its HOST passes, and nothing else. There is NO context fallback.
   *
   *  This resolution used to end `?? ctx.formValues ?? ctx.data ?? {}`, and
   *  this note used to call `ctx.data` the "record scope" channel and
   *  `ctx.formValues` a "form-data context provided by @object-ui/react".
   *  Neither member ever existed: `SchemaRendererContextType`
   *  (`@object-ui/react`, `context/SchemaRendererContext.tsx`) declares exactly
   *  `dataSource`, `debug`, `debugFlags` and `apiFetch`, and
   *  `SchemaRendererProvider` accepts no other prop — so those two links were
   *  unsettable rather than merely unset, and the tail resolved `{}` for every
   *  host that ever rendered this widget. Both were retired under ADR-0049
   *  enforce-or-remove (objectui#7206, maintainer ruling 2026-09-18).
   *
   *  ⇒ A widget reached without `dependentValues` resolves `{}`, which for a
   *  `dependsOn` lookup renders a permanently gated picker. That failure is now
   *  the whole diagnostic, and it is meant to be visible: the host holding the
   *  record passes it (objectui#7165 for the grid's inline column,
   *  objectui#7190 for the detail page). ⛔ Do not re-add a context leg here
   *  — objectui#7165 and objectui#7190 were both first read as independent host
   *  bugs precisely because this note claimed a host could supply the record
   *  through the context. */
  const resolvedDependentValues: Record<string, any> = useMemo(
    () => dependentValuesProp ?? {},
    [dependentValuesProp],
  );

  /** True when at least one dependency is missing (empty). The picker is gated
   *  in that state so we never issue an unfiltered query that ignores the
   *  user's earlier choices. */
  const dependenciesMissing = useMemo(() => {
    if (dependsOn.length === 0) return false;
    return dependsOn.some(({ field }) => {
      const v = resolvedDependentValues[field];
      return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    });
  }, [dependsOn, resolvedDependentValues]);

  const hasDataSource = dataSource != null && typeof dataSource.find === 'function' && !!referenceTo;

  // Fetch the referenced object's schema so option labels resolve through its
  // declarations (`nameField`, then the deprecated `titleFormat` template —
  // `recordToOption`, ADR-0079). Without this the label fell back to a
  // non-existent `name` field and ultimately to the raw record id.
  const [refObjectSchema, setRefObjectSchema] = useState<any>(null);
  useEffect(() => {
    if (!dataSource || !referenceTo) return;
    const getSchema = (dataSource as any).getObjectSchema;
    if (typeof getSchema !== 'function') return;
    let alive = true;
    Promise.resolve(getSchema.call(dataSource, referenceTo))
      .then((s: any) => { if (alive) setRefObjectSchema(s); })
      .catch(() => { /* fall back to displayField chain */ });
    return () => { alive = false; };
  }, [dataSource, referenceTo]);

  /**
   * Picker columns. Honour explicit `lookupColumns` when authored; otherwise
   * derive a multi-column, disambiguating set from the referenced object's
   * schema so every lookup gets a useful picker with zero field-level config.
   */
  const pickerColumns = useMemo<Array<string | LookupColumnDef> | undefined>(() => {
    if (lookupColumns && lookupColumns.length > 0) return lookupColumns;
    const derived = deriveLookupColumns(refObjectSchema, { displayField });
    return derived.length > 0 ? derived : undefined;
  }, [lookupColumns, refObjectSchema, displayField]);

  /**
   * Secondary line under each quick-select option. Honour explicit
   * `descriptionField`; otherwise reuse the first derived non-display column so
   * the inline popover also benefits from the richer schema.
   */
  const effectiveDescriptionField = useMemo<string | undefined>(() => {
    if (descriptionField) return descriptionField;
    const extra = pickerColumns?.find((c) => (typeof c === 'string' ? c : c.field) !== displayField);
    if (!extra) return undefined;
    return typeof extra === 'string' ? extra : extra.field;
  }, [descriptionField, pickerColumns, displayField]);

  /**
   * Columns previewed under each quick-select option (objectui#5492).
   *
   * This is the inline dropdown's half of the one-declaration/two-surfaces
   * contract. It used to be two separate ad-hoc reads of the raw record — the
   * subtitle printed `record[descriptionField]` verbatim and the row's `title`
   * attribute concatenated `label: String(rawValue)` for every other column —
   * so the same `lookupColumns` that the picker rendered as resolved names,
   * formatted dates and option labels came out here as bare foreign-key ids,
   * ISO timestamps and enum codes.
   *
   * Now one list feeds one renderer: an explicitly authored `descriptionField`
   * still leads (the author picked that column to be the subtitle), followed by
   * every non-display picker column. Both halves render through
   * `renderLookupColumnValue`, the picker's own renderer.
   */
  const previewColumns = useMemo<LookupColumnDef[]>(() => {
    const cols: LookupColumnDef[] = [];
    const seen = new Set<string>([displayField]);
    if (descriptionField) {
      cols.push({ field: descriptionField });
      seen.add(descriptionField);
    }
    for (const c of pickerColumns ?? []) {
      const col = normalizeColumn(c);
      if (seen.has(col.field)) continue;
      seen.add(col.field);
      cols.push(col);
    }
    return cols;
  }, [descriptionField, pickerColumns, displayField]);

  /**
   * Field descriptors for the previewed columns — the SAME builder the picker
   * calls, fed the same referenced-object schema, so a `select` column resolves
   * its authored option label and a `lookup` column carries its `reference`
   * through to the cell renderer that resolves the id to a name.
   */
  const previewDescriptors = useMemo(
    () => buildLookupColumnDescriptors(previewColumns, refObjectSchema?.fields, referenceTo ?? '', translateOptions),
    [previewColumns, refObjectSchema, referenceTo, translateOptions],
  );

  /**
   * `$expand` for the candidate queries (objectui#10223): the reference columns
   * among the ones this dropdown PREVIEWS, by `buildExpandFields`' rule — the
   * same one the list views use for their visible columns.
   *
   * Without it every previewed `lookup` / `master_detail` column arrived as a
   * bare foreign key, and the lookup cell renderer resolved each one with its
   * own `findOne` — one request per candidate per such column, on every open.
   * An expanded value is rendered by that same cell renderer with no fetch, so
   * the preview reads the same and the per-row requests go.
   *
   * Expansion is a DISPLAY concern here and stays one: options are built from
   * the row with its relations collapsed back to ids (`toPredicateRecord`), so
   * the label, the committed value and the record `onSelectRecord` hands a host
   * are what they were before any column was expanded. Only the preview reads
   * the expanded row (`previewRows` below). A backend that ignores `$expand`
   * returns bare ids, and the cell renderer's per-id resolution takes over as
   * before.
   *
   * Field-level security gates the OUTPUT, in the shape the objectui#7429 sweep
   * applied at every other `buildExpandFields` call site: once the policy has
   * loaded, a relation the user may not read on the referenced object is not
   * asked for; before it loads, nothing is filtered and `perms` in the deps
   * rebuilds the list when the answer arrives. Every name judged here is one
   * the referenced object declares, so the "`checkField` answers false for an
   * undeclared key" trap cannot be reached.
   *
   * No previewed column ⇒ no `$expand`. `buildExpandFields` reads an EMPTY
   * column list as "no column restriction" and returns every relation the
   * object declares; a dropdown that previews only its display field (a
   * `highlightFields` naming just that field, or every other field
   * system-managed) would then ask for `created_by`, `owner_id`, … — none of
   * which it renders.
   */
  const perms = usePermissions();
  const candidateExpand = useMemo<string[]>(() => {
    if (previewColumns.length === 0) return [];
    const expandable = buildExpandFields(refObjectSchema?.fields, previewColumns);
    if (!perms.isLoaded || !referenceTo) return expandable;
    return expandable.filter((f) => perms.checkField(referenceTo, f, 'read'));
  }, [refObjectSchema, previewColumns, perms, referenceTo]);

  /**
   * The previewed columns the user may READ — the ones `previewOf` renders
   * (objectui#10373). Field-level security gates the displayed OUTPUT, in the
   * shape `RelatedList`'s `keepReadableColumns` applies under the
   * objectui#7215 / objectui#7230 rulings: once the policy has loaded, a column
   * the user may not read on the referenced object is not previewed; before it
   * loads nothing is filtered, and `perms` in the deps re-derives the list when
   * the answer arrives. The object judged is `referenceTo`, the one
   * `candidateExpand` above judges.
   *
   * Gating `$expand` alone left a denied column on screen: a denied relation
   * arrived as a bare key, and the lookup cell renderer resolved it with a read
   * of its own.
   *
   * The id column is never filtered: it holds the value being committed. The
   * option's label is not one of these columns; `recordToOption` builds it
   * from the row with the denied fields removed (`withoutDeniedFields`), so the
   * display field and a `titleFormat` obey the same policy without dropping
   * the option. `candidateExpand` keeps
   * reading the unfiltered list and gating its own output, as every
   * `buildExpandFields` call site does; both ask `checkField` about the same
   * names on the same object, so the two lists cannot disagree.
   */
  const readablePreviewColumns = useMemo<LookupColumnDef[]>(
    () =>
      previewColumns.filter(
        (c) =>
          !perms.isLoaded ||
          !referenceTo ||
          c.field === idField ||
          perms.checkField(referenceTo, c.field, 'read'),
      ),
    [previewColumns, perms, referenceTo, idField],
  );

  // Derive filter-bar columns from any typed picker columns.
  const filterColumns = useMemo<RecordPickerFilterColumn[] | undefined>(() => {
    if (!pickerColumns) return undefined;
    const cols: RecordPickerFilterColumn[] = [];
    for (const c of pickerColumns) {
      if (typeof c === 'object' && c.type) {
        const filterType = mapFieldTypeToFilterType(c.type);
        if (filterType) cols.push({ field: c.field, label: c.label, type: filterType });
      }
    }
    return cols.length > 0 ? cols : undefined;
  }, [pickerColumns]);

  // Optional create-new callback
  const onCreateNew: ((searchQuery: string) => void) | undefined =
    props.onCreateNew ?? lookupField?.onCreateNew;

  // State for the full Record Picker dialog (Level 2)
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  // Dependent-lookup chain as a hard QueryParams.$filter record. Shared by
  // EVERY candidate surface — quick-select popover, Level-2 table picker and
  // the search-first PeoplePicker — so no picker can bypass the cascade
  // (#2215: the table picker used to list the full unfiltered set).
  const dependentFilter = useMemo<Record<string, any> | undefined>(() => {
    const f: Record<string, any> = {};
    for (const { field, param } of dependsOn) {
      const v = resolvedDependentValues[field];
      if (v === undefined || v === null || v === '') continue;
      f[param] = typeof v === 'number' ? v : String(v);
    }
    return Object.keys(f).length > 0 ? f : undefined;
  }, [dependsOn, resolvedDependentValues]);

  // Determine which options to display
  // Quick-select popover fetch — the shared record-query kernel (same one the
  // Record Picker dialog and PeoplePicker use). Filter = dependent-lookup chain
  // + base lookupFilters, so the popover matches the full picker.
  const popoverFilter = useMemo<Record<string, any> | undefined>(() => {
    const f: Record<string, any> = {
      ...(lookupFilters && lookupFilters.length > 0 ? lookupFiltersToRecord(lookupFilters) : {}),
      ...(dependentFilter ?? {}),
    };
    return Object.keys(f).length > 0 ? f : undefined;
  }, [dependentFilter, lookupFilters]);

  const popoverQuery = useRecordQuery({
    dataSource,
    objectName: referenceTo,
    enabled: isOpen && hasDataSource && !dependenciesMissing,
    pageSize: LOOKUP_PAGE_SIZE,
    filter: popoverFilter,
    expand: candidateExpand,
  });

  // Re-source the popover's fetch state from the kernel; all existing read sites
  // (searchQuery / loading / error / totalCount / fetchedOptions) stay unchanged.
  const searchQuery = popoverQuery.search;
  const loading = popoverQuery.loading;
  const totalCount = popoverQuery.total;
  const error = popoverQuery.error ?? createError;
  // Built from the row with its relations collapsed to ids — see
  // `candidateExpand` for why the option never sees the expanded form.
  const fetchedOptions = useMemo(
    () =>
      popoverQuery.records.map(r =>
        recordToOption(
          toPredicateRecord(r, refObjectSchema?.fields),
          declaredDisplayField, idField, effectiveDescriptionField, refObjectSchema,
          perms, referenceTo,
        ),
      ),
    [popoverQuery.records, declaredDisplayField, idField, effectiveDescriptionField, refObjectSchema, perms, referenceTo],
  );

  const allOptions = hasDataSource ? fetchedOptions : staticOptions;

  // For static options, filter locally based on search
  const filteredOptions = useMemo(() => {
    if (hasDataSource) return allOptions;
    if (!searchQuery) return allOptions;
    const q = searchQuery.toLowerCase();
    return allOptions.filter(opt =>
      opt.label.toLowerCase().includes(q) ||
      (opt.description && opt.description.toLowerCase().includes(q))
    );
  }, [hasDataSource, allOptions, searchQuery]);

  // Reset the keyboard cursor when the popover closes. Fetch state (records,
  // search, error, total) is owned by `popoverQuery` and resets automatically
  // when it becomes disabled (via `enabled`), including its debounced search.
  useEffect(() => {
    if (!isOpen) setActiveIndex(-1);
  }, [isOpen]);

  // objectui#12966 — no type-ahead on a target whose search resolves to no
  // field: the server refuses that search with `400 INVALID_FIELD`. The
  // dropdown still lists the target's records. The target schema is read at
  // mount (`refObjectSchema`); until it is known the box is kept, as before.
  const searchOffered = objectResolvesSearch(refObjectSchema) !== false;

  // Search is the kernel's debounced setter. A keystroke also clears the
  // active row: the rows on screen answer the previous term until the new
  // answer lands, and the row Enter takes is chosen again from that answer
  // (objectui#13162, see `defaultActiveIndex`).
  const handleSearchChange = useCallback(
    (query: string) => {
      setActiveIndex(-1);
      popoverQuery.setSearch(query);
    },
    [popoverQuery.setSearch],
  );

  /**
   * Hydrate the picker's display when the field already has a value (e.g.
   * edit-mode load, prefill via query-string from a related-list "+ New")
   * but no option resolves it yet. Fetches the referenced record(s) via
   * the DataSource and keeps the rows in `hydratedRecords` so the chip
   * shows a friendly label instead of an empty placeholder.
   *
   * It fetches rows and builds no label (objectui#10487). The referenced
   * object's schema is requested at mount too, and nothing orders the two: a
   * label built here, in whichever render the fetch returned to, was built on
   * the no-schema path whenever the record won, and nothing rebuilt it when the
   * schema arrived. `hydratedOptions` derives the label on every render
   * instead. So the dependency list names only what the FETCH reads. The
   * display and description fields are not in it: a change to either relabels
   * through `hydratedOptions`, and never cancels an in-flight fetch to issue a
   * second one.
   *
   * Deliberately UNFILTERED, unlike the recents rail below (#5195). These ids
   * are what the record already holds, not candidates being offered: the value
   * is committed, so hiding it cannot prevent a bad pick — it can only replace
   * a readable label with a raw id and hide the mismatch from the user who
   * needs to see it. A record that was admissible when chosen and is not any
   * more (a product deactivated last week) must still render its name. The
   * narrowing belongs on every surface that OFFERS a choice; this one reports
   * one already made.
   */
  useEffect(() => {
    if (!hasDataSource || !dataSource || !referenceTo) return;
    const raw: any[] = multiple
      ? Array.isArray(value) ? value : []
      : value != null && value !== '' ? [value] : [];
    // Expanded-reference values (server `$expand`, or their JSON-encoded string
    // form) already carry their display fields and resolve directly in
    // `resolveSelectedOption` — only bare ids need a fetch. Passing an object (or
    // a JSON string) to `findOne` would query for a bogus id and leave the
    // trigger stuck on the placeholder.
    const ids = raw.filter(
      (v) => v != null && v !== '' && typeof v !== 'object' && !parseReferenceObjectString(v),
    );
    if (!ids.length) return;
    // Only fetch records we haven't resolved yet.
    const unresolved = ids.filter((v) => !findOption(v));
    if (!unresolved.length) return;

    let cancelled = false;
    (async () => {
      try {
        const fetched: Record<string, unknown>[] = [];
        // Single id: the pre-existing cheap paths — a primary-id `findOne`
        // GET, or an equality filter when the field commits a different
        // column (`idField: 'name'` — e.g. position machine names,
        // objectstack-ai/objectstack#3508).
        if (unresolved.length === 1) {
          const id = unresolved[0];
          if (typeof (dataSource as any).findOne === 'function' && idField === 'id') {
            const rec = await (dataSource as any).findOne(referenceTo, id);
            if (rec) fetched.push(rec);
          } else {
            const res = await dataSource.find(referenceTo, {
              $filter: { [idField]: id },
              $top: 1,
            } as QueryParams);
            const rows = (res as any)?.data ?? res ?? [];
            if (rows[0]) fetched.push(rows[0]);
          }
        } else {
          // SEVERAL unresolved ids: one `$in` query per chunk. A multi-value
          // field can hold dozens of ids, and the old serial findOne-per-id
          // took seconds while the trigger sat on the empty "Select…"
          // placeholder (#3108).
          // Chunked to LOOKUP_PAGE_SIZE so no request exceeds the page size
          // a server may cap `$top` at; chunks run in parallel.
          const chunks: any[][] = [];
          for (let i = 0; i < unresolved.length; i += LOOKUP_PAGE_SIZE) {
            chunks.push(unresolved.slice(i, i + LOOKUP_PAGE_SIZE));
          }
          const results = await Promise.all(
            chunks.map((chunk) =>
              dataSource.find(referenceTo, {
                $filter: { [idField]: { $in: chunk } },
                $top: chunk.length,
              } as QueryParams),
            ),
          );
          for (const res of results) {
            const rows = (res as any)?.data ?? res ?? [];
            if (!Array.isArray(rows)) continue;
            for (const row of rows) fetched.push(row);
          }
        }
        if (!cancelled && fetched.length) {
          setHydratedRecords((prev) => mergeRowsByValue(prev, fetched, idField));
        }
      } catch {
        // Ignore — chip will fall back to showing the raw id.
      } finally {
        // Mark the attempt settled — found or not — so `hydrating` below
        // clears even for ids that no longer resolve (deleted records,
        // fetch failures) instead of spinning forever.
        if (!cancelled) {
          setHydrationSettled((prev) => {
            const next = new Set(prev);
            for (const id of unresolved) next.add(String(id));
            return next;
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, hasDataSource, referenceTo, idField, multiple]);

  // The picked and the hydrated rows as options, derived exactly as the
  // dropdown derives its own (`fetchedOptions`): the same `recordToOption`, the
  // same inputs, read on every render. The label therefore follows the
  // referenced object's schema when it arrives after the record, and the
  // field-read gate of the policy loaded now — the row as the user may read it
  // (objectui#10373) — rather than whatever either was in the render the fetch
  // returned to (objectui#10487) or the pick was made in (objectui#10559).
  const [pickedOptions, hydratedOptions] = useMemo<[LookupOption[], LookupOption[]]>(() => {
    const toOption = (r: Record<string, unknown>) =>
      recordToOption(r, declaredDisplayField, idField, effectiveDescriptionField, refObjectSchema, perms, referenceTo);
    return [pickedRecords.map(toOption), hydratedRecords.map(toOption)];
  }, [pickedRecords, hydratedRecords, declaredDisplayField, idField, effectiveDescriptionField, refObjectSchema, perms, referenceTo]);

  // Get selected option(s) — check static, fetched, picked, then hydrated
  // options. A pick outranks the hydrated row for the same value, as it did
  // when both shared one cache and the later write won.
  const findOption = useCallback(
    (v: any): LookupOption | undefined => {
      return (
        staticOptions.find(opt => opt.value === v) ??
        fetchedOptions.find(opt => opt.value === v) ??
        pickedOptions.find(opt => opt.value === v) ??
        hydratedOptions.find(opt => opt.value === v)
      );
    },
    [staticOptions, fetchedOptions, pickedOptions, hydratedOptions],
  );

  // String-coerced fallback for `findOption` — matches the read cell's tolerant
  // `String(a) === String(b)` comparison so a numeric cell value still resolves
  // against a string-keyed option (and vice versa). Only consulted when the
  // strict match misses, so homogeneous option lists are unaffected.
  const findOptionLoose = useCallback(
    (v: any): LookupOption | undefined => {
      const key = String(v);
      return (
        staticOptions.find(opt => String(opt.value) === key) ??
        fetchedOptions.find(opt => String(opt.value) === key) ??
        pickedOptions.find(opt => String(opt.value) === key) ??
        hydratedOptions.find(opt => String(opt.value) === key)
      );
    },
    [staticOptions, fetchedOptions, pickedOptions, hydratedOptions],
  );

  // Collapse an expanded-reference value (the related record object returned by
  // server `$expand`) to its bare id — used for option matching / highlighting.
  const normalizeId = useCallback(
    (raw: any): any => {
      const obj = raw != null && typeof raw === 'object' ? raw : parseReferenceObjectString(raw);
      return obj ? (obj[idField] ?? obj.id ?? obj._id ?? obj.externalId) : raw;
    },
    [idField],
  );

  // Level-2 pickers (PeoplePicker / RecordPickerDialog) operate on bare ids —
  // their seed queries and selected-row matching compare against `idField`
  // values. Collapse any `$expand`-ed record objects (passed through
  // uncollapsed by the inline editor, objectui#2572) before handing the value
  // down, or the seed fetch would query for a bogus object-shaped id.
  const pickerValue = useMemo(
    () => (multiple ? (Array.isArray(value) ? value.map(normalizeId) : []) : normalizeId(value)),
    [multiple, value, normalizeId],
  );

  // Resolve a raw field value into its display option. An expanded-reference
  // object is mapped directly (mirroring the read cell's display-name path) so
  // the inline editor shows the record's name instead of the placeholder; a bare
  // id resolves through the static / fetched / picker-hydrated option lists.
  const resolveSelectedOption = useCallback(
    (raw: any): LookupOption | undefined => {
      if (raw == null || raw === '') return undefined;
      // An expanded-reference object (server `$expand`) — or its JSON-encoded
      // string form, e.g. an external-id reference `'{"externalId":"…"}'` — is
      // mapped directly, mirroring the read cell (`LookupCellRenderer`).
      const asObject = typeof raw === 'object' ? raw : parseReferenceObjectString(raw);
      if (asObject) {
        return recordToOption(asObject, declaredDisplayField, idField, effectiveDescriptionField, refObjectSchema, perms, referenceTo);
      }
      // Bare id: strict match first, then a String()-coerced fallback so a
      // numeric cell value still resolves against a string-keyed option (and
      // vice versa) — matching the read cell's tolerant comparison.
      return findOption(raw) ?? findOptionLoose(raw);
    },
    [findOption, findOptionLoose, declaredDisplayField, idField, effectiveDescriptionField, refObjectSchema, perms, referenceTo],
  );

  // A value can hold bare ids that no option list resolves YET — the batch
  // hydration above is still in flight. While any such id is pending, the
  // trigger must not present the field as empty: a 41-value lookup rendered
  // the bare "Select…" placeholder for seconds, indistinguishable from
  // having no value at all (#3108).
  const hydrating = useMemo(() => {
    if (!hasDataSource) return false;
    const raw: any[] = multiple
      ? Array.isArray(value) ? value : []
      : value != null && value !== '' ? [value] : [];
    return raw.some(
      (v) =>
        v != null && v !== '' && typeof v !== 'object' && !parseReferenceObjectString(v) &&
        !findOption(v) && !findOptionLoose(v) &&
        !hydrationSettled.has(String(v)),
    );
  }, [hasDataSource, multiple, value, findOption, findOptionLoose, hydrationSettled]);

  // Committed-value count. During hydration the resolved-option count
  // undercounts (unresolved ids are filtered out below), so the trigger
  // shows this raw count instead.
  const rawSelectedCount = multiple
    ? (Array.isArray(value) ? value : []).filter((v) => v != null && v !== '').length
    : value != null && value !== '' ? 1 : 0;

  const selectedOptions = multiple
    ? (Array.isArray(value) ? value : []).map(resolveSelectedOption).filter(Boolean)
    : value ? [resolveSelectedOption(value)].filter(Boolean) : [];

  // Optional: receive the FULL selected record (not just its id) so a host can
  // auto-fill sibling fields from it — e.g. a line-item grid copying a product's
  // unit_price/description when the item is chosen. When provided (single
  // select), it drives the update and the host owns the resulting value change.
  const onSelectRecord = props.onSelectRecord;

  /**
   * Commit a pick. `row` is the record `option` was built from.
   *
   * The row is kept so the pick's label resolves synchronously and durably,
   * independent of the popover's `fetchedOptions` (which the editor may have
   * remounted away, or which a slow/contended re-render hasn't surfaced yet —
   * the intermittent CI failure where a just-picked lookup showed no label,
   * #2150). `selectedOptions` consults `pickedOptions` in `findOption`. The
   * row is kept, not `option`: an option built before the referenced object's
   * schema loaded carries a label frozen on the no-schema path, and it cannot
   * be rebuilt from itself, because `recordToOption` spreads the row over the
   * label it builds (objectui#10559).
   *
   * An authored static option has no row and keeps nothing: `findOption` reads
   * the authored list first, on every render.
   */
  const handleSelect = useCallback(
    (option: LookupOption, row?: Record<string, unknown>) => {
      if (row && option && option.value != null) {
        setPickedRecords((prev) => mergeRowsByValue(prev, [row], idField));
      }
      if (multiple) {
        // Normalise any expanded-reference objects to bare ids so toggling
        // compares like-for-like and always persists ids (never mixed shapes).
        const currentValues = (Array.isArray(value) ? value : []).map(normalizeId);
        const isSelected = currentValues.includes(option.value);

        if (isSelected) {
          onChange(currentValues.filter((v: any) => v !== option.value));
        } else {
          if (referenceTo) pushRecentLookupId(referenceTo, option.value);
          onChange([...currentValues, option.value]);
        }
      } else {
        if (referenceTo) pushRecentLookupId(referenceTo, option.value);
        if (onSelectRecord) onSelectRecord(option);
        else onChange(option.value);
        setIsOpen(false);
      }
    },
    [multiple, value, onChange, onSelectRecord, referenceTo, normalizeId, idField],
  );

  const handleRemove = (optionValue: any) => {
    if (multiple) {
      const currentValues = (Array.isArray(value) ? value : []).map(normalizeId);
      onChange(currentValues.filter((v: any) => v !== optionValue));
    } else {
      onChange(null);
    }
  };

  // Callback from the Level-2 pickers (RecordPickerDialog / PeoplePicker) —
  // keeps the selected rows so that findOption can resolve display labels
  // after the picker closes. The selection replaces the kept picks, as it
  // always has.
  const handlePickerSelectRecords = useCallback(
    (records: Record<string, unknown>[]) => {
      if (referenceTo) {
        records.forEach((r) => pushRecentLookupId(referenceTo, recordValue(r, idField) as string | number | undefined));
      }
      setPickedRecords(records);
    },
    [idField, referenceTo],
  );

  // ── Recently-used, quick-create, combined option list ────────────────────
  //
  // The recents rail lists CANDIDATES, so its re-fetch must answer the same
  // question the main popover query answers: "which records may this field
  // take right now?" (#5195). It used to answer a different one — it re-read
  // each remembered id with `dataSource.findOne(referenceTo, id)`, which
  // carries no filter at all, so a record the author's `lookupFilters`
  // exclude, or one belonging to the PREVIOUS value of a `dependsOn` parent,
  // stayed visible and selectable. Reported from a deployed project: pick a
  // product under project A, switch to project B, and the rail still offered
  // project A's product — the declared filter was enforced on every surface
  // except this one, leaving a server-side hook as the app's only defence.
  //
  // The fix is one filtered query, not a client-side prune: `popoverFilter`
  // (base `lookupFilters` + the `dependsOn` chain) is merged with the id
  // restriction through `mergeFilterNodes`, the repo's single filter sink, so
  // the SERVER decides admissibility exactly as it does for the main query.
  // Merging as a conjunction rather than spreading matters — a spread would
  // let the `$in` overwrite a declared filter that happens to key on the same
  // field, widening the accept set at the one place we are narrowing it.
  //
  // Two bypasses close with it: the per-id `findOption` cache could return a
  // record resolved under the old parent (the cache has no idea a filter
  // moved), and a gated cascade (`dependenciesMissing`) disabled the main
  // query while leaving this one running. Membership now comes only from the
  // filtered response; ids it does not return are dropped, whether they fail
  // the filters or no longer exist. It is also one request instead of up to
  // MAX_RECENT serial round-trips.
  //
  // The rail previews the same columns as the main list, so it asks for the
  // same `$expand` (objectui#10223). It keeps the rows it was served — the
  // preview reads them — and derives its options from them exactly as the main
  // list does, relations collapsed to ids.
  const [recentRows, setRecentRows] = useState<Record<string, unknown>[]>([]);
  // The expansion as a primitive, for the effect below: a memoised array's
  // identity is not a dependency to key a fetch on (AGENTS.md #10).
  const candidateExpandKey = candidateExpand.join(',');
  useEffect(() => {
    if (!isOpen || !hasDataSource || !dataSource || !referenceTo || searchQuery) return;
    if (dependenciesMissing) { setRecentRows([]); return; }
    const ids = getRecentLookupIds(referenceTo);
    if (!ids.length) { setRecentRows([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const idRestriction = { [idField]: { $in: ids } };
        const res = await dataSource.find(referenceTo, {
          $filter: popoverFilter
            ? mergeFilterNodes(popoverFilter, idRestriction)
            : idRestriction,
          $top: ids.length,
          ...(candidateExpand.length > 0 ? { $expand: candidateExpand } : {}),
        } as QueryParams);
        const rows = (res as any)?.data ?? res ?? [];
        const byId = new Map<string, any>();
        if (Array.isArray(rows)) {
          for (const row of rows) {
            const plain = toPredicateRecord(row, refObjectSchema?.fields);
            const rid = plain?.[idField] ?? plain?.id ?? plain?._id;
            if (rid !== undefined && rid !== null) byId.set(String(rid), row);
          }
        }
        // Most-recent-first order is preserved; the response only decides
        // WHICH ids survive, never their order.
        const kept = ids.map((id) => byId.get(String(id))).filter(Boolean);
        if (!cancelled) setRecentRows(kept);
      } catch { if (!cancelled) setRecentRows([]); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, hasDataSource, referenceTo, searchQuery, dependenciesMissing, popoverFilter, idField, candidateExpandKey]);
  const recentOptions = useMemo(
    () =>
      recentRows.map((r) =>
        recordToOption(
          toPredicateRecord(r, refObjectSchema?.fields),
          declaredDisplayField, idField, effectiveDescriptionField, refObjectSchema,
          perms, referenceTo,
        ),
      ),
    [recentRows, declaredDisplayField, idField, effectiveDescriptionField, refObjectSchema, perms, referenceTo],
  );

  /**
   * The rows previews render from (objectui#10223): each as the server returned
   * it, with any `$expand`-ed relation still expanded, so the lookup cell
   * renderer names it without a fetch. Keyed by the option's value (a
   * primitive, never an option object's identity). An option with no served
   * row — a static option, a just-created record — previews from itself. A
   * dropdown pick takes the row it keeps from here too
   * (`handleSelectCandidate`).
   */
  const previewRows = useMemo(() => {
    const byValue = new Map<string, Record<string, unknown>>();
    for (const raw of [...recentRows, ...popoverQuery.records]) {
      const plain = toPredicateRecord(raw, refObjectSchema?.fields);
      const v = plain?.[idField] ?? plain?.id ?? plain?._id ?? plain?.externalId;
      if (v !== undefined && v !== null && !byValue.has(String(v))) byValue.set(String(v), raw);
    }
    return byValue;
  }, [recentRows, popoverQuery.records, refObjectSchema, idField]);

  // Pick a dropdown option, keeping the row it was built from: its candidate
  // as served, with relations collapsed to ids, as `fetchedOptions` and
  // `recentOptions` collapse it (objectui#10559). A static option has no
  // served row, so it keeps none (see `handleSelect`).
  const handleSelectCandidate = useCallback(
    (option: LookupOption) => {
      const served = previewRows.get(String(option.value));
      handleSelect(option, served ? toPredicateRecord(served, refObjectSchema?.fields) : undefined);
    },
    [previewRows, refObjectSchema, handleSelect],
  );

  // Recently-used first (only before the user types), then live results — one
  // de-duped list that drives BOTH rendering and arrow-key navigation.
  const recentCount = (!searchQuery && hasDataSource) ? recentOptions.length : 0;
  const visibleOptions = useMemo(() => {
    if (searchQuery || !hasDataSource || recentOptions.length === 0) return filteredOptions;
    const recentIds = new Set(recentOptions.map((o) => o.value));
    return [...recentOptions, ...filteredOptions.filter((o) => !recentIds.has(o.value))];
  }, [searchQuery, hasDataSource, recentOptions, filteredOptions]);

  /**
   * The row Enter takes after a search (objectui#13162).
   *
   * No row used to be active until an arrow key moved to one, and the active
   * row was dropped whenever the list changed. So typing a term and pressing
   * Enter took nothing, and an arrow key pressed before the debounced answer
   * landed was undone by it: after a search, Enter set no value.
   *
   * Now, once the rows on screen answer the typed term, the first one is
   * active (`aria-activedescendant` names it), and Enter takes the match the
   * user can see. Until then the rows answer an EARLIER term — the query for
   * this one is debounced or in flight, which `answeredSearch` tells apart —
   * and no row is made active, so Enter cannot take a row the term did not ask
   * for. An authored option list filters here, at once, so its rows always
   * answer the term. Without a term nothing is made active, as before.
   *
   * Keyed on primitives (AGENTS.md #10): the values the list shows, and the
   * index itself. A row the user moved to with the arrow keys stays active
   * until either changes.
   */
  const searchAnswered = !hasDataSource || popoverQuery.answeredSearch === searchQuery;
  const defaultActiveIndex = searchQuery && searchAnswered && visibleOptions.length > 0 ? 0 : -1;
  const visibleValuesKey = JSON.stringify(visibleOptions.map((o) => o.value));
  useEffect(() => {
    setActiveIndex(defaultActiveIndex);
  }, [visibleValuesKey, defaultActiveIndex]);

  const [creating, setCreating] = useState(false);
  // Open the referenced object's create form through the ActionProvider's modal
  // handler (when a form host wired one). Safe outside a provider — useAction
  // returns a local runner and useHasActionProvider is false.
  const { execute } = useAction();
  const hasActionProvider = useHasActionProvider();
  // objectui#12082 (objectui#12081 item 6) — the built-in quick-create writes a
  // record of the TARGET object, so it reads that object's `lookupCreateNew`
  // row of the affordance-to-grant map: its managed-object policy, the
  // server's effective API operation set for it, and the caller's create grant
  // on it. `allowCreate` above says the field OFFERS quick-create; it was never
  // a grant, and nothing here used to ask for one, so a requester who cannot
  // create contract types was offered "Create new" for one. The schema is the
  // target's once fetched (`null` until then reads as the default bucket); with
  // no permission provider the grant reads open. A host-supplied
  // `onCreateNew` is the host's own affordance and is not gated here.
  const createGranted = resolveAffordance('lookupCreateNew', {
    objectSchema: refObjectSchema,
    objectName: referenceTo,
    perms,
  }).allowed;
  const canCreate = !!onCreateNew || (allowCreate && createGranted && (hasActionProvider || hasDataSource));
  const handleCreateNew = useCallback(
    async (q: string) => {
      const label = (q || '').trim();
      if (onCreateNew) { onCreateNew(label); setIsOpen(false); return; }
      if (!allowCreate || !createGranted || !referenceTo) return;
      setCreateError(null);

      // Preferred path — open the referenced object's FULL create form so the
      // user fills every required field themselves, then select the record they
      // created. This is the standard "create related record" behaviour: it
      // works for ANY object (not only ones whose sole required field is the
      // title) and turns an empty required picker from a dead end into a way to
      // author the first related record.
      if (hasActionProvider) {
        setIsOpen(false); // close the picker popover first
        // Defer opening the create dialog until the popover has fully closed and
        // returned focus to the field trigger. Two nested-modal bugs come from
        // opening it in the same tick as the triggering click:
        //  1) the just-mounted Dialog treats this click's release (and the
        //     popover's own dismiss) as an outside-interaction and flashes shut
        //     on the FIRST click (works on the second);
        //  2) with the popover already gone, the "+ create" button that Radix
        //     would return focus to is unmounted, so when the nested modal later
        //     closes focus leaks to <body> and dismisses the PARENT form's dialog
        //     too ("Cancel closes both").
        // A macrotask runs after Radix's focus-return layout effects, so focus is
        // safely back on the still-mounted field trigger before the Dialog opens.
        await new Promise((r) => setTimeout(r, 0));
        const result: any = await execute({
          type: 'modal',
          modal: { objectName: referenceTo, mode: 'create' },
        } as any);
        if (result?.success && result.data) {
          const opt = recordToOption(result.data, declaredDisplayField, idField, effectiveDescriptionField, refObjectSchema, perms, referenceTo);
          handleSelect(opt, result.data);
          return;
        }
        // `success` + an echoed `modal` schema means no modal handler was wired
        // in this tree → fall through to the legacy inline create. Anything else
        // (cancel / no data) means the user backed out → stop.
        if (!(result?.success && result.modal)) return;
      }

      // Fallback (no modal handler in scope): the legacy one-field inline create
      // from the typed text. Best-effort; surfaces any validation error inline.
      if (!dataSource || !label) return;
      setCreating(true);
      try {
        const created = await (dataSource as any).create(referenceTo, { [displayField]: label });
        const opt = recordToOption(created, declaredDisplayField, idField, effectiveDescriptionField, refObjectSchema, perms, referenceTo);
        handleSelect(opt, created);
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : String(err));
      } finally {
        setCreating(false);
      }
    },
    [onCreateNew, allowCreate, createGranted, referenceTo, hasActionProvider, execute, dataSource, displayField, declaredDisplayField, idField, effectiveDescriptionField, refObjectSchema, handleSelect, perms],
  );

  /**
   * Compact one-line preview of an option's extra (non-display) columns.
   *
   * Every value goes through `renderLookupColumnValue` — the picker's renderer
   * — so this line and the picker's table agree on one `lookupColumns`
   * declaration (objectui#5492). It replaces a `label: String(rawValue)`
   * concatenation that produced bare ids, raw ISO timestamps and enum codes.
   *
   * A column is previewed when the record HOLDS a value for it, decided on the
   * raw value, never on what the renderer makes of it. An unresolved foreign
   * key is a held value, so it keeps its column and shows whatever the lookup
   * cell renderer shows for it — never a silently empty slot, which the field
   * report behind this issue calls out as worse than showing the bare id.
   *
   * Each column is one SEGMENT — its separator, its label and its value — and
   * the line shows a column whole or not at all (objectui#13123). Every
   * column used to be a `min-w-0 truncate` span, so the line shrank them all
   * together and a badge was cut to its first glyph ("A.", "P..."):
   *  - a column whose cell is drawn by the renderer that draws a `select`
   *    badge keeps its full width: no shrink, no clamp on its value;
   *  - any other column truncates its VALUE, never below its label (the
   *    `minmax(0, max-content)` track gives the value nothing of the
   *    segment's minimum width, so that minimum is the label);
   *  - a column the line still cannot hold leaves whole, with every column
   *    after it (`fitPreviewLine`).
   */
  const previewOf = useCallback(
    (option: LookupOption): React.ReactNode => {
      // The option with its relations as the server served them — every other
      // key reads exactly as it did before `$expand` (objectui#10223).
      const served = previewRows.get(String(option.value));
      const row = served ? { ...option, ...served } : option;
      const cols = readablePreviewColumns.filter((c) => {
        const v = (row as any)[c.field];
        return v !== null && v !== undefined && v !== '';
      });
      if (cols.length === 0) return null;
      const cellRenderer = getCellRendererResolver();
      // Asked of the renderer map itself, so every type it draws as a badge
      // (`status`, `multiselect`, `radio`, …) is one with `select`, and no
      // second list of those types can drift from it.
      const badgeRenderer = cellRenderer?.('select');
      return cols.map((col, i) => {
        const type = previewDescriptors[col.field]?.type;
        const drawsBadge = !!badgeRenderer && !!type && cellRenderer?.(type) === badgeRenderer;
        // `whitespace-nowrap`: in the grid's `auto` track a label that may wrap
        // ("Annual Revenue:") would break onto a second line before its value
        // gave way, and the row would grow.
        const lead = (
          <span className="flex items-center gap-1 whitespace-nowrap">
            {i > 0 && <span aria-hidden="true" className="opacity-60">·</span>}
            <span className="opacity-70">{`${col.label || fieldToLabel(col.field)}:`}</span>
          </span>
        );
        const value = renderLookupColumnValue(row, col, {
          descriptors: previewDescriptors,
          cellRenderer,
          displayLocale,
        });
        return drawsBadge ? (
          <span key={col.field} className="flex shrink-0 items-center gap-1">
            {lead}
            <span data-lookup-preview={col.field}>{value}</span>
          </span>
        ) : (
          <span key={col.field} className="grid grid-cols-[auto_minmax(0,max-content)] items-center gap-1">
            {lead}
            <span className="min-w-0 truncate" data-lookup-preview={col.field}>{value}</span>
          </span>
        );
      });
    },
    [previewRows, readablePreviewColumns, previewDescriptors, displayLocale],
  );

  // Keyboard handler for the search input — arrow keys + Enter
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex(prev =>
          prev < visibleOptions.length - 1 ? prev + 1 : prev,
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex(prev => (prev > 0 ? prev - 1 : 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < visibleOptions.length) {
          handleSelectCandidate(visibleOptions[activeIndex]);
        }
      }
    },
    [visibleOptions, activeIndex, handleSelectCandidate],
  );

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const el = listRef.current.querySelector(`[data-lookup-index="${activeIndex}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  if (readonly) {
    if (!selectedOptions.length) {
      if (hydrating) {
        return (
          <span
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
            data-testid="lookup-hydrating"
          >
            <Loader2 className="size-3.5 animate-spin" />
            {multiple ? t('table.selected', { count: rawSelectedCount }) : t('lookup.loading')}
          </span>
        );
      }
      return <EmptyValue />;
    }

    if (multiple) {
      return (
        <div className="flex flex-wrap gap-1">
          {selectedOptions.map((opt, idx) => (
            <Badge key={idx} variant="outline">
              {opt?.label || opt?.[displayField]}
            </Badge>
          ))}
        </div>
      );
    }

    return (
      <span className="text-sm">
        {selectedOptions[0]?.label || selectedOptions[0]?.[displayField]}
      </span>
    );
  }

  // A single-select field draws its value INSIDE the trigger, in every mode
  // (objectui#13162). Compact mode (e.g. a line-item grid cell) always did:
  // a borderless trigger on one line, no chip stacked above it. The full-size
  // field drew the value as a chip ABOVE a trigger that went on reading
  // "Select…", so a field holding a value read as one still asking for it.
  // A multi-select field keeps its chips and its "N selected" trigger.
  const compact = !!props.compact;
  const singleSelectedLabel = selectedOptions[0]?.label || selectedOptions[0]?.[displayField];
  const showsSingleValue = !multiple && selectedOptions.length > 0;

  /**
   * A search-first chip's avatar, read only from a field the user may read on
   * `referenceTo` (objectui#10433). The option carries the row as served (see
   * `recordToOption`), so the chip used to draw a denied avatar on a backend
   * that does not strip it. Both keys the chip reads come from the option as
   * the user may read it (`withoutDeniedFields`, objectui#10594), so each is
   * judged by its own name: the configured avatar field, and `image`, the
   * fallback, which is a field of the same row. Before a policy loads nothing
   * is withheld, as at every other gate in this file. A single-select
   * search-first field draws the same avatar in its trigger (objectui#13162).
   */
  const chipAvatarUrl = (opt: LookupOption | undefined): string | undefined => {
    const shown = withoutDeniedFields(opt, perms, referenceTo, [idField]);
    const url = shown?.[avatarField] || shown?.image;
    return url ? String(url) : undefined;
  };
  const singleAvatarUrl = pickerVariant === 'search' && showsSingleValue ? chipAvatarUrl(selectedOptions[0]) : undefined;

  // Shared field trigger — the anchor for either the inline PeoplePicker
  // (search fields) or the classic quick-select popover. No onClick: the Radix
  // trigger it is slotted into (PopoverTrigger / SheetTrigger) owns open/close.
  //
  // DOM pass-through onto this button — the widget's real focusable control —
  // per objectui#3318. `name` is withheld: no native control here takes part
  // in form submission, and a stray `name` on a button invites exactly the
  // accidental-submitter semantics #3306 kept it off the SelectTrigger for.
  const { name: _domName, ...triggerDomProps } = toDomProps(props);
  const triggerButton = (
    <Button
      {...triggerDomProps}
      variant="outline"
      className={cn(
        // max-w-full: in a BLOCK parent (detail-section inline edit) the
        // inline-flex button is content-sized — a long selected label pushed
        // it past the card edge; bounding it lets the inner `truncate` span
        // clip instead (objectui#3466). flex-1/min-w-0 keep handling the
        // flex-parent (form row) case.
        'min-w-0 max-w-full flex-1 justify-start text-left font-normal',
        compact && 'h-8 rounded-none border-0 bg-transparent px-2 shadow-none focus-visible:ring-1 focus-visible:ring-ring/60',
      )}
      type="button"
      disabled={dependenciesMissing || props.disabled}
      data-testid={dependenciesMissing ? 'lookup-trigger-gated' : ((props.name || lookupField?.name) ? `lookup-trigger-${props.name || lookupField.name}` : 'lookup-trigger')}
      title={dependenciesMissing
        ? t('lookup.selectFirst', { fields: dependsOnFieldsText })
        : undefined}
      // AFTER the spread so this widget's own computation wins (#3222):
      // `fieldError` is the published validation slot — NOT the popover's
      // fetch error, which is a widget-internal state named `error` below.
      aria-invalid={!!fieldError}
    >
      {hydrating ? (
        <Loader2
          className={cn('size-4 shrink-0 animate-spin text-muted-foreground', compact ? 'mr-1.5' : 'mr-2')}
          data-testid="lookup-hydrating"
        />
      ) : pickerVariant === 'search' && showsSingleValue && !dependenciesMissing ? (
        // The avatar the single-select chip used to draw (objectui#10433's
        // read gate, via `chipAvatarUrl`). Decorative: the name follows.
        <Avatar className={cn('size-5 shrink-0', compact ? 'mr-1.5' : 'mr-2')}>
          {singleAvatarUrl && <AvatarImage src={singleAvatarUrl} alt="" />}
          <AvatarFallback className="text-[9px]">
            {getPersonInitials(String(singleSelectedLabel || ''))}
          </AvatarFallback>
        </Avatar>
      ) : (
        <Search className={cn('size-4 shrink-0 text-muted-foreground', compact ? 'mr-1.5' : 'mr-2')} />
      )}
      <span
        className={cn('truncate', selectedOptions.length === 0 && !hydrating && 'text-muted-foreground')}
        // A long name is cut by `truncate`; the whole of it stays on hover.
        title={!dependenciesMissing && !hydrating && showsSingleValue ? String(singleSelectedLabel ?? '') : undefined}
      >
        {dependenciesMissing
          ? t('lookup.selectFirst', { fields: dependsOnFieldsText })
          : hydrating
            // The value EXISTS but its labels are still loading — say so
            // instead of the empty placeholder (#3108).
            ? multiple
              ? t('table.selected', { count: rawSelectedCount })
              : t('lookup.loading')
            : selectedOptions.length === 0
              ? lookupField?.placeholder || t('common.select')
              : multiple
                ? t('table.selected', { count: selectedOptions.length })
                : singleSelectedLabel}
      </span>
    </Button>
  );

  /**
   * Whether the selected-value chips offer their remove control.
   *
   * `readonly` already returned a display-only rendering far above, so the case
   * this answers is the DISABLED one — and it is not a rare one: a field the
   * object declares `readonly` arrives here as `disabled` (the form's section
   * builder folds `field.readonly` into `disabled`), and so does a field the
   * caller's field-level security marks `editable: false`. Both disabled the
   * picker trigger and the browse button while leaving the chip's ✕ live, so
   * the one control that could still CHANGE the value was the one control the
   * gate had missed — a reporter could clear a master-detail parent the server
   * would then refuse to unset (`80c54122e`). ⭐ A refusal the UI invites is
   * worse than a refusal it prevents: the chips stay, the affordance goes.
   */
  const chipsRemovable = !props.disabled;

  /**
   * The single-select field's clear control (objectui#13162). The value moved
   * from a chip into the trigger, and the chip's ✕ moves beside it: the same
   * accessible name, the same `handleRemove`, gated by `chipsRemovable` like
   * the chip's (objectui#10120). Compact mode never had one, and still has none.
   */
  const singleClear = showsSingleValue && !compact && chipsRemovable ? (
    <Button
      variant="ghost"
      size="icon"
      className="shrink-0 text-muted-foreground hover:text-destructive"
      type="button"
      onClick={() => handleRemove(selectedOptions[0]?.value)}
      aria-label={t('lookup.remove', { label: singleSelectedLabel })}
      data-testid="lookup-clear"
    >
      <X className="size-4" />
    </Button>
  ) : null;

  return (
    <div className={compact ? '' : 'space-y-2'}>
      {/* Selected values display — a multi-select field's chips (full mode
          only; compact and single-select show the value in the trigger) */}
      {multiple && selectedOptions.length > 0 && !compact && (
        <div className="flex flex-wrap gap-1">
          {selectedOptions.map((opt, idx) => {
            const chipLabel = opt?.label || opt?.[displayField];
            // Search-first (people) fields show avatar chips; classic lookups
            // keep the plain text Badge.
            if (pickerVariant === 'search') {
              const avatarUrl = chipAvatarUrl(opt);
              return (
                <span
                  key={idx}
                  data-testid="people-field-chip"
                  className="inline-flex items-center gap-1.5 rounded-full border bg-background py-0.5 pl-0.5 pr-1.5 text-sm"
                >
                  <Avatar className="size-6 shrink-0">
                    {avatarUrl && <AvatarImage src={avatarUrl} alt={String(chipLabel || '')} />}
                    <AvatarFallback className="text-[10px]">
                      {getPersonInitials(String(chipLabel || ''))}
                    </AvatarFallback>
                  </Avatar>
                  <span className="max-w-[10rem] truncate">{chipLabel}</span>
                  {chipsRemovable && (
                    <button
                      onClick={() => handleRemove(opt?.value)}
                      className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      type="button"
                      aria-label={t('lookup.remove', { label: chipLabel })}
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </span>
              );
            }
            return (
              <Badge key={idx} variant="outline" className="gap-1">
                {chipLabel}
                {chipsRemovable && (
                  <button
                    onClick={() => handleRemove(opt?.value)}
                    className="ml-1 hover:text-destructive"
                    type="button"
                    aria-label={t('lookup.remove', { label: chipLabel })}
                  >
                    <X className="size-3" />
                  </button>
                )}
              </Badge>
            );
          })}
        </div>
      )}

      {/* Field control: search-first inline combobox (anchored dropdown / mobile
          sheet), else the classic quick-select popover. */}
      {pickerVariant === 'search' && hasDataSource && dataSource && referenceTo ? (
        // A single-select field's row holds the trigger and its clear control,
        // as the classic row below does; a multi-select field is unchanged.
        <div className={multiple ? 'contents' : 'flex items-center gap-1.5'}>
        <PeoplePicker
          inline
          trigger={triggerButton}
          open={isPickerOpen}
          onOpenChange={setIsPickerOpen}
          title={lookupField?.label || t('common.select')}
          multiple={multiple}
          dataSource={dataSource}
          objectName={referenceTo}
          displayField={displayField}
          idField={idField}
          subtitleFields={subtitleFields}
          avatarField={avatarField}
          pageSize={lookupPageSize}
          value={pickerValue}
          onSelect={onChange}
          onSelectRecords={handlePickerSelectRecords}
          lookupFilters={lookupFilters}
          baseFilter={dependentFilter}
        />
        {singleClear}
        </div>
      ) : (
      <div className="flex items-center gap-1.5">
      <Popover
        open={isOpen}
        onOpenChange={(o) => {
          if (!dependenciesMissing) setIsOpen(o);
        }}
      >
        <PopoverTrigger asChild>
          {triggerButton}
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          {/* Search input — not offered on a target whose search resolves to
              no field (objectui#12966, see `searchOffered`); the options below
              are buttons, so the list stays reachable without it. */}
          {searchOffered && (
            <div className="p-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  placeholder={t('table.search')}
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  className="w-full pl-9 h-8 text-sm"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-controls={listboxId}
                  aria-expanded={isOpen}
                  aria-activedescendant={activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined}
                />
                {loading && (
                  <Loader2
                    className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-muted-foreground"
                    data-testid="lookup-loading"
                  />
                )}
              </div>
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="flex flex-col items-center gap-2 py-4 px-2" role="alert">
              <AlertCircle className="size-5 text-destructive" />
              <p className="text-sm text-destructive">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => popoverQuery.refetch()}
                type="button"
              >
                {t('lookup.retry')}
              </Button>
            </div>
          )}

          {/* Loading state (initial load only, not search refinement) */}
          {loading && filteredOptions.length === 0 && !error && (
            <div className="flex flex-col items-center gap-2 py-6" role="status" aria-live="polite">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t('lookup.loading')}</p>
            </div>
          )}

          {/* Options list */}
          {!error && !(loading && filteredOptions.length === 0) && (
            <div ref={listRef} className="max-h-64 overflow-y-auto px-1 pb-1" role="listbox" id={listboxId}>
              {visibleOptions.length === 0 ? (
                <div className="py-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    {t('lookup.noOptions')}
                  </p>
                  {/* Quick-create entry */}
                  {canCreate && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2 gap-1"
                      type="button"
                      disabled={creating}
                      onClick={() => handleCreateNew(searchQuery)}
                    >
                      {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                      {searchQuery ? t('lookup.createNamed', { name: searchQuery }) : t('lookup.createNew')}
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  {visibleOptions.map((option, idx) => {
                    const isSelected = multiple
                      ? (Array.isArray(value) ? value : []).map(normalizeId).includes(option.value)
                      : normalizeId(value) === option.value;
                    const isActive = idx === activeIndex;
                    const showRecentHeader = recentCount > 0 && idx === 0;
                    const showResultsHeader = recentCount > 0 && idx === recentCount;

                    return (
                      <React.Fragment key={option.value}>
                        {showRecentHeader && (
                          <div className="px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            {t('lookup.recentlyUsed')}
                          </div>
                        )}
                        {showResultsHeader && (
                          <div className="mt-1 border-t px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            {t('lookup.allResults')}
                          </div>
                        )}
                        <button
                          id={`${listboxId}-opt-${idx}`}
                          data-lookup-index={idx}
                          role="option"
                          aria-selected={isSelected}
                          // The full label stays reachable on hover now that the
                          // extra columns are rendered into the row itself
                          // instead of concatenated raw into this attribute
                          // (objectui#5492).
                          title={String(option.label ?? '')}
                          onClick={() => handleSelectCandidate(option)}
                          className={`w-full text-left px-3 py-2 rounded-md text-sm hover:bg-accent flex items-center justify-between ${
                            isActive
                              ? 'bg-accent text-accent-foreground'
                              : isSelected
                                ? 'bg-accent/50 text-accent-foreground'
                                : ''
                          }`}
                          type="button"
                        >
                          <div className="min-w-0 flex-1">
                            <span className="block truncate">{option.label}</span>
                            {(() => {
                              const preview = previewOf(option);
                              if (!preview) return null;
                              return <OptionPreviewLine>{preview}</OptionPreviewLine>;
                            })()}
                          </div>
                          {isSelected && (
                            <Badge variant="default" className="ml-2 shrink-0">{t('lookup.selectedBadge')}</Badge>
                          )}
                        </button>
                      </React.Fragment>
                    );
                  })}
                  {/* Show total count when fetched from DataSource */}
                  {hasDataSource && totalCount > filteredOptions.length && (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      {t('lookup.showingResults', { shown: filteredOptions.length, total: totalCount })}
                    </p>
                  )}
                  {/* "Show All Results" button — opens the full Record Picker (Level 2) */}
                  {hasDataSource && totalCount > filteredOptions.length && (
                    <button
                      type="button"
                      className="w-full text-center px-3 py-2 rounded-md text-sm font-medium text-primary hover:bg-accent flex items-center justify-center gap-1.5"
                      onClick={() => {
                        setIsOpen(false);
                        setIsPickerOpen(true);
                      }}
                      data-testid="show-all-results"
                    >
                      <TableProperties className="size-3.5" />
                      {t('lookup.showAllResults', { count: totalCount })}
                    </button>
                  )}
                  {/* Quick-create entry (below results) */}
                  {canCreate && (
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 rounded-md text-sm hover:bg-accent flex items-center gap-1.5 text-muted-foreground"
                      disabled={creating}
                      onClick={() => handleCreateNew(searchQuery)}
                    >
                      {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                      {searchQuery ? t('lookup.createNamed', { name: searchQuery }) : t('lookup.createNew')}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>

      {singleClear}

      {/* "Browse All" button — classic lookups only; search fields open the
          PeoplePicker from the trigger itself, so this would be redundant. */}
      {hasDataSource && pickerVariant !== 'search' && (
        <Button
          variant="outline"
          size="icon"
          className="shrink-0"
          type="button"
          // Gated exactly like the main trigger (#2215) — pre-fix this button
          // opened the full unscoped table while the dependency was missing.
          disabled={dependenciesMissing || props.disabled}
          onClick={() => setIsPickerOpen(true)}
          aria-label={t('lookup.browseAll')}
          title={dependenciesMissing
            ? t('lookup.selectFirst', { fields: dependsOnFieldsText })
            : t('lookup.browseAll')}
          data-testid="browse-all-records"
        >
          <TableProperties className="size-4" />
        </Button>
      )}
      </div>
      )}

      {/* Level 2: classic table picker — search fields use the inline combobox above. */}
      {hasDataSource && dataSource && referenceTo && pickerVariant !== 'search' && (
        <RecordPickerDialog
          open={isPickerOpen}
          onOpenChange={setIsPickerOpen}
          title={lookupField?.label || t('common.select')}
          multiple={multiple}
          dataSource={dataSource}
          objectName={referenceTo}
          columns={pickerColumns}
          // The declared display field, never the `name` default, and the whole
          // schema, never a template cut out of it: the picker's display column
          // then makes `recordToOption`'s exact resolver call (objectui#10486).
          displayField={declaredDisplayField}
          objectSchema={refObjectSchema}
          idField={idField}
          pageSize={lookupPageSize}
          value={pickerValue}
          onSelect={onChange}
          onSelectRecords={handlePickerSelectRecords}
          lookupFilters={lookupFilters}
          baseFilter={dependentFilter}
          cellRenderer={getCellRendererResolver()}
          fieldsMeta={refObjectSchema?.fields}
          filterColumns={filterColumns}
        />
      )}
    </div>
  );
}
