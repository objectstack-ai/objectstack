/**
 * CreateViewDialog — Airtable-style "Create new view" modal.
 *
 * Step 1: User picks a view type from a visual grid of cards (icon + label
 * + short description). Selection is highlighted.
 * Step 2: For view types that need them, the user picks the type's
 * configuration (e.g. the group-by field for kanban, the start-date field for
 * calendar/timeline/gantt, lat/lng for map, image for gallery; for chart, an
 * ADR-0021 dataset of this object and that dataset's measure, plus one of its
 * dimensions when it declares any). The Create button stays disabled until
 * every required pick is set; an optional pick (the chart dimension) never
 * gates it.
 * Step 3: The user enters a display label (required, defaults to "Grid 1" etc.)
 * and a machine `name` (the metadata key). The name auto-fills from the label
 * via `slugify`, a Chinese label through its pinyin first (`romanizeHan`:
 * `客户等级` → `kehu_dengji`); for a label that still yields nothing (a
 * Japanese one, say) the field is left empty and the user must type a key
 * before Create enables (#2767 P5 — no more silent random names).
 *
 * On submit, calls `onCreate({ type, label, name, [type]: {...picked config} })`
 * and waits for it: the dialog closes only when the save resolves `true`, and
 * stays open with the user's input when it resolves `false` (objectui#11578).
 * The parent persists the view; this dialog WRITES nothing. It does READ:
 * while open, for the chart type, it lists the datasets through the metadata
 * client and resolves the chosen dataset's measures and dimensions
 * (`useObjectDatasetBinding`, objectui#11576: `useDatasetCatalog` keeping only
 * the datasets whose base `object` is this object, and `useDatasetSemantics`,
 * the pair the dashboard widget editor binds with). The Studio list-view
 * panel's chart section reads through the same hook (objectstack#27933). A
 * closed dialog, or one with no `objectDef`, fetches nothing.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import type { ListViewVisualization } from '@object-ui/core';
import { slugify } from './metadata-admin/createDerive.js';
import { romanizeHan, useHanRomanizer } from './metadata-admin/romanizeHan.js';
import { datasetOptionLabel, useObjectDatasetBinding } from './studio-design/objectDatasets.js';
import {
  deriveFieldOptions,
  isImageLikeField,
  isGeoLikeField,
  pickPreferredField,
  KANBAN_GROUP_PREFERRED,
  PRIMARY_DATE_PREFERRED,
  END_DATE_PREFERRED,
  type FieldOption,
} from '@object-ui/plugin-view/core';
import {
  LayoutGrid,
  KanbanSquare,
  Calendar as CalendarIcon,
  Image as ImageIcon,
  GanttChartSquare,
  Clock,
  Map as MapIcon,
  BarChart3,
  ListTree,
  CalendarClock,
  AlertCircle,
  ChevronLeft,
} from 'lucide-react';

export interface CreateViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Called with a fully-formed view config payload. The type-specific picks
   * are nested under their type key (e.g. `kanban.groupByField`,
   * `chart.dataset`), the block of that name on the spec's `ListViewSchema`;
   * see `REQUIRED_FIELDS_BY_TYPE` below for which of those blocks a test
   * re-derives against the spec.
   *
   * Resolves `true` once the view is saved, and `false` when the save was
   * refused; the caller has already told the user why. The dialog closes only
   * on `true`. On `false` it stays open with the user's input intact and
   * Create enabled again, so a refused save never looks like a saved one
   * (objectui#11578). Create is disabled while the save is in flight. A
   * rejection is not caught here: the dialog stays open and the error stays
   * the caller's.
   */
  onCreate: (
    config: Record<string, any> & { type: string; label: string; name: string },
  ) => boolean | Promise<boolean>;
  /** Used to suggest unique default names like "Grid 2" if "Grid 1" exists. */
  existingLabels?: string[];
  /** Restrict the available view types. Defaults to all built-in types. */
  availableTypes?: string[];
  /**
   * Object definition. Provides the available fields used to populate the
   * required field selectors (group-by, start-date, etc.). When omitted,
   * required-field validation is skipped.
   */
  objectDef?: { name: string; label?: string; fields?: Record<string, any>; [key: string]: any };
}

interface ViewTypeMeta {
  type: ListViewVisualization;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

/**
 * Build the picker's rows from a TOTAL record over the visualizations.
 *
 * A total `Record<ListViewVisualization, …>` (`ca3942729`). This picker was a
 * nine-entry array whose `type` was plain `string`, so it was never compared
 * against any view-type union — one of the sites the card behind `ca3942729` records as "drifted,
 * with no type-checking at all". Keyed on the derived visualization union it now
 * fails the build when the spec adds a visualization, instead of quietly
 * becoming unofferable.
 *
 * ⚠️ `page` is absent BY CONSTRUCTION and needs no locale keys. The spec models
 * `type: 'page'` as a list view that mounts a published page through `pageName`,
 * not as a visualization with field bindings — and this dialog's whole job below
 * is collecting those bindings. Offering it would require a page picker and a
 * `pageName` binding this dialog has no notion of.
 *
 * ⚠️ Every bundle key stays spelled out as a LITERAL argument to `t()`, never
 * assembled from a stem. `scripts/check-i18n-call-site-keys.mjs` can only see a
 * member missing from all ten packs when the key is literal; a
 * `t(`console.objectView.viewType${stem}`)` template turns ten packs' worth of
 * coverage into a prefix check, which is the same "guard that stopped guarding"
 * shape this card exists to remove.
 */
function buildViewTypeMeta(t: (k: string) => string): ViewTypeMeta[] {
  const meta: Record<ListViewVisualization, Omit<ViewTypeMeta, 'type'>> = {
    grid:     { icon: LayoutGrid,       label: t('console.objectView.viewTypeGrid'),     description: t('console.objectView.viewTypeGridDesc') },
    kanban:   { icon: KanbanSquare,     label: t('console.objectView.viewTypeKanban'),   description: t('console.objectView.viewTypeKanbanDesc') },
    calendar: { icon: CalendarIcon,     label: t('console.objectView.viewTypeCalendar'), description: t('console.objectView.viewTypeCalendarDesc') },
    gallery:  { icon: ImageIcon,        label: t('console.objectView.viewTypeGallery'),  description: t('console.objectView.viewTypeGalleryDesc') },
    timeline: { icon: Clock,            label: t('console.objectView.viewTypeTimeline'), description: t('console.objectView.viewTypeTimelineDesc') },
    gantt:    { icon: GanttChartSquare, label: t('console.objectView.viewTypeGantt'),    description: t('console.objectView.viewTypeGanttDesc') },
    map:      { icon: MapIcon,          label: t('console.objectView.viewTypeMap'),      description: t('console.objectView.viewTypeMapDesc') },
    chart:    { icon: BarChart3,        label: t('console.objectView.viewTypeChart'),    description: t('console.objectView.viewTypeChartDesc') },
    tree:     { icon: ListTree,         label: t('console.objectView.viewTypeTree'),     description: t('console.objectView.viewTypeTreeDesc') },
    timesheet: { icon: CalendarClock,   label: t('console.objectView.viewTypeTimesheet'), description: t('console.objectView.viewTypeTimesheetDesc') },
  };
  return (Object.entries(meta) as [ListViewVisualization, Omit<ViewTypeMeta, 'type'>][])
    .map(([type, row]) => ({ type, ...row }));
}

/**
 * The view types this dialog offers, in grid order: the same rows the picker
 * renders, read from {@link buildViewTypeMeta} with an identity translator.
 *
 * Pure, so a test can enumerate it at collection time without rendering.
 * `CreateViewDialog.viewTypeParse-11581.test.tsx` drives its per-type parse
 * pin from this list, so a type added to the picker without a parse row there
 * turns that pin red (objectui#11581).
 *
 * Exported for that pin, not from the package index. @internal
 */
export function offeredViewTypes(): ListViewVisualization[] {
  return buildViewTypeMeta((k) => k).map((m) => m.type);
}

/** Suggest a non-colliding default name like "Grid 1", "Grid 2", … */
function suggestName(typeLabel: string, existing: Set<string>): string {
  for (let i = 1; i < 1000; i++) {
    const candidate = `${typeLabel} ${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  return typeLabel;
}

// ---------------------------------------------------------------------------
// Required-field schema per view type
// ---------------------------------------------------------------------------
//
// Each entry describes a sub-config key a view type writes under its own
// block (kanban.groupByField, calendar.startDateField, gantt.startDateField +
// endDateField, gallery.coverField, map.latitudeField + longitudeField,
// chart.chartType + dataset + values (+ dimensions), tree.parentField). The
// blocks are meant to be the spec ListView blocks of those names. What
// re-derives that is a parse against `ListViewSchema`:
// `CreateViewDialog.viewTypeParse-11581.test.tsx` submits this dialog once per
// type `offeredViewTypes()` lists and parses the body BOTH persisting doors
// build from that payload ("Save as view" and the add-view door, which share
// one builder, `buildNewViewSpec`). `chart` is also pinned on its own, through
// each door's page: `CreateViewDialog.chartBinding-11576.test.tsx` and
// `ObjectView.createChartView-11576.test.tsx`.
//
// `chart` was the one block that had drifted: it wrote `xAxisField` /
// `yAxisFields`, the pre-ADR-0021 inline axes the spec's strict
// `ListChartConfigSchema` refuses by name, so the platform's view write door
// refused every chart view this dialog created (objectui#11576). It now
// writes the ADR-0021 binding only; there is no second spelling.
//
// `kind` says where a select's options come from:
//   - 'field' (default): the object's fields, narrowed by `filter` (e.g. only
//     date fields for date selectors; only image/file/url fields for gallery
//     covers; only lat-named numeric fields for map latitude);
//   - 'enum': the static `enumOptions` (chart.chartType);
//   - 'dataset': the ADR-0021 datasets whose base `object` is this object,
//     never the whole catalog;
//   - 'measure' / 'dimension': the CHOSEN dataset's own members, by name.
//
// `preferred` provides a list of name substrings to auto-pick when the user
// hasn't chosen anything yet — improves first-run quality of common cases
// (kanban→status, calendar→start_date, …).

interface RequiredFieldDef {
  /** Sub-config key under the type (e.g. "groupByField") */
  key: string;
  /** i18n key for the label */
  i18nKey: string;
  /** i18n key for an optional helper text under the select. */
  helpI18nKey?: string;
  /** Filter the field options. Returns true to keep. */
  filter?: (f: FieldOption) => boolean;
  /** Preferred name substrings for smart-default auto-pick. */
  preferred?: readonly string[];
  /** Where the options come from (see the comment above). Default 'field'. */
  kind?: 'field' | 'enum' | 'dataset' | 'measure' | 'dimension';
  /** Static options for `kind: 'enum'` selects. */
  enumOptions?: ReadonlyArray<{ value: string; i18nKey: string }>;
  /** Default value to seed when the dialog first opens (for enum). */
  defaultValue?: string;
  /** The spec declares a list here: the one picked name is written as `[name]`. */
  list?: boolean;
  /**
   * Not required: no asterisk, never gates Create, omitted from the payload
   * when empty. The row is shown only while it has options to offer.
   */
  optional?: boolean;
}

/** One option of a config select: the stored value and the text shown. */
interface PickOption {
  value: string;
  label: string;
}

/** The item a held value none of a picker's options carries is shown by. */
const OUTSIDE_OPTIONS = 'outside';

/**
 * objectui#11865 — one config pick (a group-by field, a date field, the chart's
 * type, dataset, measure or dimension), drawn with the shared `Select` the rest
 * of the console picks with. It used to be a browser-native `<select>`. What a
 * pick writes is unchanged: `onPick` receives the picked option's own `value`,
 * the string the native control's `change` carried, and the dialog stores it
 * through `choose` as before.
 *
 * - Items carry their option's INDEX, not its value. The first option is the
 *   "select a field" placeholder, whose value is `''`, which `SelectItem`
 *   refuses; picking it still clears the pick, as it did. An index cannot
 *   collide with a field or dataset name, as a stand-in string could.
 * - A held value none of the options carries (a field the object no longer
 *   has) gets an item of its own, labelled with the value, so the trigger
 *   shows what Create would write. The native control showed the placeholder
 *   there. Picking that item writes nothing.
 * - Disabled follows the primitive (objectui#11781): `disabled` disables the
 *   trigger itself.
 * - `id` lands on the trigger, so the row's `<label htmlFor>` names it as it
 *   named the native control, and `aria-required` still announces the state.
 */
function ConfigPicker({
  id,
  required,
  value,
  options,
  onPick,
  disabled,
}: {
  id: string;
  required: boolean;
  value: string;
  options: ReadonlyArray<PickOption>;
  onPick: (value: string) => void;
  disabled: boolean;
}) {
  const at = options.findIndex((o) => o.value === value);
  return (
    <Select
      value={at !== -1 ? String(at) : OUTSIDE_OPTIONS}
      onValueChange={(token) => {
        // `undefined` for the outside item: it is the held value, so there is nothing to write.
        const picked = options[Number(token)];
        if (picked) onPick(picked.value);
      }}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        data-testid={id}
        aria-required={required ? 'true' : undefined}
        className="h-9 px-2 text-xs"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {at === -1 && <SelectItem value={OUTSIDE_OPTIONS}>{value}</SelectItem>}
        {options.map((o, i) => (
          <SelectItem key={`${i}:${o.value}`} value={String(i)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const CHART_TYPE_OPTIONS = [
  { value: 'bar',     i18nKey: 'console.objectView.chartTypeBar' },
  { value: 'line',    i18nKey: 'console.objectView.chartTypeLine' },
  { value: 'pie',     i18nKey: 'console.objectView.chartTypePie' },
  { value: 'area',    i18nKey: 'console.objectView.chartTypeArea' },
  { value: 'scatter', i18nKey: 'console.objectView.chartTypeScatter' },
] as const;

const REQUIRED_FIELDS_BY_TYPE: Record<string, RequiredFieldDef[]> = {
  kanban: [
    {
      key: 'groupByField',
      i18nKey: 'console.objectView.groupByField',
      helpI18nKey: 'console.objectView.groupByFieldHelp',
      filter: (f) => f.type === 'select' || f.type === 'boolean',
      preferred: KANBAN_GROUP_PREFERRED,
    },
  ],
  calendar: [
    {
      key: 'startDateField',
      i18nKey: 'console.objectView.startDateField',
      helpI18nKey: 'console.objectView.startDateFieldHelp',
      filter: (f) => f.type === 'date',
      preferred: PRIMARY_DATE_PREFERRED,
    },
    {
      key: 'titleField',
      i18nKey: 'console.objectView.titleField',
      helpI18nKey: 'console.objectView.titleFieldHelp',
      filter: (f) => f.type === 'text',
    },
  ],
  timeline: [
    {
      key: 'startDateField',
      i18nKey: 'console.objectView.startDateField',
      helpI18nKey: 'console.objectView.timelineDateFieldHelp',
      filter: (f) => f.type === 'date',
      preferred: PRIMARY_DATE_PREFERRED,
    },
    {
      key: 'titleField',
      i18nKey: 'console.objectView.titleField',
      helpI18nKey: 'console.objectView.titleFieldHelp',
      filter: (f) => f.type === 'text',
    },
  ],
  gantt: [
    {
      key: 'startDateField',
      i18nKey: 'console.objectView.startDateField',
      helpI18nKey: 'console.objectView.ganttStartDateFieldHelp',
      filter: (f) => f.type === 'date',
      preferred: PRIMARY_DATE_PREFERRED,
    },
    {
      key: 'endDateField',
      i18nKey: 'console.objectView.endDateField',
      helpI18nKey: 'console.objectView.ganttEndDateFieldHelp',
      filter: (f) => f.type === 'date',
      preferred: END_DATE_PREFERRED,
    },
    {
      key: 'titleField',
      i18nKey: 'console.objectView.titleField',
      helpI18nKey: 'console.objectView.titleFieldHelp',
      filter: (f) => f.type === 'text',
    },
  ],
  gallery: [
    {
      key: 'coverField',
      i18nKey: 'console.objectView.imageField',
      helpI18nKey: 'console.objectView.imageFieldHelp',
      filter: (f) => isImageLikeField(f),
    },
  ],
  map: [
    {
      key: 'latitudeField',
      i18nKey: 'console.objectView.latitudeField',
      helpI18nKey: 'console.objectView.latitudeFieldHelp',
      filter: (f) => f.type === 'number' && isGeoLikeField(f, 'latitude'),
    },
    {
      key: 'longitudeField',
      i18nKey: 'console.objectView.longitudeField',
      helpI18nKey: 'console.objectView.longitudeFieldHelp',
      filter: (f) => f.type === 'number' && isGeoLikeField(f, 'longitude'),
    },
  ],
  chart: [
    {
      key: 'chartType',
      i18nKey: 'console.objectView.chartType',
      helpI18nKey: 'console.objectView.chartTypeHelp',
      kind: 'enum',
      enumOptions: CHART_TYPE_OPTIONS,
      defaultValue: 'bar',
    },
    {
      key: 'dataset',
      i18nKey: 'console.objectView.dataset',
      helpI18nKey: 'console.objectView.datasetHelp',
      kind: 'dataset',
    },
    {
      key: 'values',
      i18nKey: 'console.objectView.chartMeasure',
      helpI18nKey: 'console.objectView.chartMeasureHelp',
      kind: 'measure',
      list: true,
    },
    {
      key: 'dimensions',
      i18nKey: 'console.objectView.chartDimension',
      helpI18nKey: 'console.objectView.chartDimensionHelp',
      kind: 'dimension',
      list: true,
      optional: true,
    },
  ],
  tree: [
    {
      key: 'parentField',
      i18nKey: 'console.objectView.parentField',
      helpI18nKey: 'console.objectView.parentFieldHelp',
      // Self-referencing pointer: a `tree` field, or a lookup/master_detail
      // back to the same object. `rawType` carries the unnormalized field type.
      filter: (f) =>
        f.rawType === 'tree' ||
        f.rawType === 'lookup' ||
        f.rawType === 'master_detail',
    },
  ],
  // objectstack#34382 — the dialog picks ONE row field (`rowFields` is a list
  // of one to three; more are added in the view's settings), the date field
  // and the numeric value field the cells edit.
  timesheet: [
    {
      key: 'rowFields',
      i18nKey: 'console.objectView.timesheetRowField',
      helpI18nKey: 'console.objectView.timesheetRowFieldHelp',
      list: true,
    },
    {
      key: 'dateField',
      i18nKey: 'console.objectView.timesheetDateField',
      helpI18nKey: 'console.objectView.timesheetDateFieldHelp',
      filter: (f) => f.type === 'date',
      preferred: PRIMARY_DATE_PREFERRED,
    },
    {
      key: 'valueField',
      i18nKey: 'console.objectView.timesheetValueField',
      helpI18nKey: 'console.objectView.timesheetValueFieldHelp',
      filter: (f) => f.rawType === 'number' || f.rawType === 'currency' || f.rawType === 'percent',
    },
  ],
  // grid has no strictly required fields at create time
};

/**
 * The type-specific picks of a new view (the group-by field of a kanban, the
 * date field of a calendar, the chart's dataset binding, …): what each type
 * requires, the options each pick offers, the smart defaults, and the block
 * the picks write under the type's key. Shared by {@link CreateViewDialog} and
 * the switcher's in-place {@link CreateViewCard}, so both create the same
 * views. `enabled` gates the dataset catalog read: a closed surface reads
 * nothing.
 */
function useRequiredPicks({
  enabled,
  objectDef,
  types,
  selectedType,
}: {
  enabled: boolean;
  objectDef?: CreateViewDialogProps['objectDef'];
  types: readonly ViewTypeMeta[];
  selectedType: string;
}) {
  const { t } = useObjectTranslation();
  const fieldOptions = useMemo(() => (objectDef ? deriveFieldOptions(objectDef) : []), [objectDef]);
  /** Map of `${type}.${fieldKey}` → selected field name. Per-type so switching
   *  view types preserves the user's earlier choices in case they switch back. */
  const [requiredFieldValues, setRequiredFieldValues] = useState<Record<string, string>>({});

  // Required fields for the currently selected type
  const requiredFields = REQUIRED_FIELDS_BY_TYPE[selectedType] ?? [];

  // ── The chart's ADR-0021 dataset binding (objectui#11576) ────────────────
  // Called unconditionally (stable hook order). A closed dialog, or one with
  // no object to filter by, fetches nothing; an open one lists the catalog,
  // keeping only the datasets whose base `object` is this object. Never the
  // whole list. Only a dataset this object exposes is ever resolved, so a
  // stale or foreign name can never feed the measure and dimension pickers.
  const objectName = objectDef?.name;
  const chosenDataset = requiredFieldValues['chart.dataset'] ?? '';
  const {
    catalog,
    datasets: objectDatasets,
    bound: boundDataset,
    semantics,
  } = useObjectDatasetBinding(objectName, chosenDataset, { enabled });
  // What the effects below re-run on: the NAMES offered, never the identity
  // of a memoised list (AGENTS.md #10).
  const datasetKey = objectDatasets.map((d) => d.name).join('\u0000');
  const measureKey = semantics.measures.map((m) => m.name).join('\u0000');
  const dimensionKey = semantics.dimensions.map((d) => d.name).join('\u0000');

  /** The object's fields a `kind: 'field'` select may offer. */
  const eligibleFields = (rf: RequiredFieldDef): FieldOption[] =>
    rf.filter ? fieldOptions.filter(rf.filter) : fieldOptions;

  /** The options a config select offers, from where its `kind` says. */
  const optionsFor = (rf: RequiredFieldDef): PickOption[] => {
    switch (rf.kind) {
      case 'enum':
        return (rf.enumOptions ?? []).map((o) => ({ value: o.value, label: t(o.i18nKey) }));
      case 'dataset':
        return objectDatasets.map((d) => ({ value: d.name, label: datasetOptionLabel(d) }));
      case 'measure':
        return semantics.measures.map((m) => ({ value: m.name, label: m.label ?? m.name }));
      case 'dimension':
        return semantics.dimensions.map((d) => ({ value: d.name, label: d.label ?? d.name }));
      default:
        return eligibleFields(rf);
    }
  };

  /** True when this pick can be satisfied on this object. Used by the type
   *  grid to disable a card whose configuration the object cannot supply. */
  const hasEligible = (rf: RequiredFieldDef): boolean => {
    switch (rf.kind) {
      case 'enum':
        return (rf.enumOptions?.length ?? 0) > 0;
      case 'dataset':
        // No object, or none of its datasets: blocked. While the catalog is
        // still loading the answer is not in, so the card is not greyed yet.
        return !!objectName && (catalog.loading || objectDatasets.length > 0);
      case 'measure':
      case 'dimension':
        // Judged against the chosen dataset, in the picker itself.
        return true;
      default:
        if (!objectDef) return true; // no objectDef → skip eligibility checks
        return eligibleFields(rf).length > 0;
    }
  };

  /** Map: viewType -> the pick blocking it, if it can't be created.
   *  Computed once per render so the type grid knows which cards to disable. */
  const typeUnavailability = useMemo(() => {
    const out: Record<string, RequiredFieldDef | null> = {};
    types.forEach((vt) => {
      const reqs = REQUIRED_FIELDS_BY_TYPE[vt.type] ?? [];
      const blocker = reqs.find((rf) => !hasEligible(rf));
      out[vt.type] = blocker ?? null;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types, fieldOptions, objectDef, objectName, datasetKey, catalog.loading]);

  const getRequiredValue = (key: string) => requiredFieldValues[`${selectedType}.${key}`] ?? '';
  const setRequiredValue = (key: string, value: string) =>
    setRequiredFieldValues(prev => ({ ...prev, [`${selectedType}.${key}`]: value }));

  /**
   * The value a pick actually holds. A dataset, measure or dimension name
   * counts only while it is among the options offered now: a name left from
   * another dataset, or one the catalog no longer lists, reads as unset, so it
   * can neither open Create nor reach the payload.
   */
  const pickedValue = (rf: RequiredFieldDef): string => {
    const v = getRequiredValue(rf.key);
    if (!v) return '';
    if (rf.kind === 'dataset' || rf.kind === 'measure' || rf.kind === 'dimension') {
      return optionsFor(rf).some((o) => o.value === v) ? v : '';
    }
    return v;
  };

  /** Set a pick. Choosing a dataset clears the measure and dimension picked
   *  from the previous one: they are names OF a dataset. */
  const choose = (rf: RequiredFieldDef, value: string) => {
    if (rf.kind !== 'dataset') {
      setRequiredValue(rf.key, value);
      return;
    }
    setRequiredFieldValues((prev) => {
      const next = { ...prev, [`${selectedType}.${rf.key}`]: value };
      requiredFields
        .filter((f) => f.kind === 'measure' || f.kind === 'dimension')
        .forEach((f) => { next[`${selectedType}.${f.key}`] = ''; });
      return next;
    });
  };

  const allRequiredFilled = requiredFields.every(f => f.optional || pickedValue(f).length > 0);

  // Auto-pick a sensible default for any pick. Runs whenever the type or the
  // available options change, but only fills slots that hold nothing yet.
  // Strategy:
  //   - enum: seed with `defaultValue` (e.g. chart → 'bar')
  //   - a single eligible option, of any kind: pick it (saves a click)
  //   - several eligible object fields + `preferred`: pick the first match
  //     in the preferred list (e.g. kanban groupBy → status > stage > …)
  useEffect(() => {
    if (requiredFields.length === 0) return;
    requiredFields.forEach((rf) => {
      if (pickedValue(rf).length > 0) return;
      if (rf.kind === 'enum') {
        if (rf.defaultValue) setRequiredValue(rf.key, rf.defaultValue);
        return;
      }
      const eligible = optionsFor(rf);
      if (eligible.length === 0) return;
      if (eligible.length === 1) {
        setRequiredValue(rf.key, eligible[0].value);
        return;
      }
      if (rf.kind && rf.kind !== 'field') return; // `preferred` names object fields only
      const picked = pickPreferredField(eligibleFields(rf), rf.preferred ?? []);
      if (picked) setRequiredValue(rf.key, picked);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType, fieldOptions, datasetKey, measureKey, dimensionKey]);

  /**
   * The picks bundled under their type's key, the spec ListView block of that
   * name (e.g. `{ groupByField }` for `kanban`). A `list` pick is written as a
   * one-element array: the chart's `values` and `dimensions` are lists in the
   * spec.
   */
  const subConfig = (): Record<string, any> => {
    const out: Record<string, any> = {};
    requiredFields.forEach((rf) => {
      const v = pickedValue(rf);
      if (!v) return;
      out[rf.key] = rf.list ? [v] : v;
    });
    return out;
  };

  return {
    fieldOptions,
    requiredFields,
    optionsFor,
    pickedValue,
    choose,
    typeUnavailability,
    allRequiredFilled,
    subConfig,
    reset: () => setRequiredFieldValues({}),
    catalog,
    boundDataset,
    semantics,
  };
}

export function CreateViewDialog({
  open,
  onOpenChange,
  onCreate,
  existingLabels,
  availableTypes,
  objectDef,
}: CreateViewDialogProps) {
  const { t } = useObjectTranslation();
  // Prefix for the type cards' label / text ids (aria-labelledby, -describedby).
  const typeGridId = useId();
  const allTypes = useMemo(() => buildViewTypeMeta(t), [t]);
  const types = useMemo(
    () => (availableTypes && availableTypes.length > 0
      ? allTypes.filter(v => availableTypes.includes(v.type))
      : allTypes),
    [allTypes, availableTypes],
  );
  // Stabilise the existing-labels list across renders so we don't churn the
  // `existingSet` memo (and the dependent useEffects) on every parent render.
  // Callers commonly pass `views.map(v => v.label)` inline, which is a fresh
  // array each render — without this normalisation, the name-suggest effect
  // below would re-fire indefinitely and could trigger "Maximum update depth"
  // when the array contents are stable but the reference is not.
  const existingKey = (existingLabels ?? []).join('\u0000');
  const existingSet = useMemo(
    () => new Set(existingLabels ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [existingKey],
  );
  const [selectedType, setSelectedType] = useState<string>(types[0]?.type ?? 'grid');
  const [label, setLabel] = useState<string>('');
  const [touched, setTouched] = useState(false);
  // Machine `name` (metadata key) + whether the user has typed into it. Auto-
  // derived from `label` via slugify until the user edits it directly.
  const [name, setName] = useState<string>('');
  const [nameTouched, setNameTouched] = useState(false);
  /** A save is in flight (objectui#11578). The ref turns away a second press
   *  in the same tick, before the disabled Create button has rendered. */
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  // Reset when the dialog opens, and re-suggest name whenever type changes
  // (only while the user hasn't manually edited it yet).
  useEffect(() => {
    if (open) {
      setSelectedType(types[0]?.type ?? 'grid');
      setTouched(false);
      setNameTouched(false);
      resetPicks();
    }
    // `resetPicks` only clears state; the dialog resets on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, types]);

  useEffect(() => {
    if (!touched) {
      const meta = types.find(v => v.type === selectedType);
      setLabel(suggestName(meta?.label ?? 'View', existingSet));
    }
  }, [selectedType, touched, types, existingSet]);

  // Derive the machine name from the label until the user edits it. A Chinese
  // label derives through its pinyin, re-deriving when the dictionary lands
  // (`romanizerVersion`); a label that still yields '' leaves the field empty
  // and the user is prompted to fill it in (rather than a silent random key —
  // #2767 P5).
  const romanizerVersion = useHanRomanizer(label);
  useEffect(() => {
    if (!nameTouched) setName(slugify(romanizeHan(label)));
  }, [label, nameTouched, romanizerVersion]);

  const {
    fieldOptions,
    requiredFields,
    optionsFor,
    pickedValue,
    choose,
    typeUnavailability,
    allRequiredFilled,
    subConfig: buildSubConfig,
    reset: resetPicks,
    catalog,
    boundDataset,
    semantics,
  } = useRequiredPicks({ enabled: open, objectDef, types, selectedType });

  const trimmed = label.trim();
  const isDuplicate = trimmed.length > 0 && existingSet.has(trimmed);
  // Machine name: same snake_case shape slugify emits and the metadata `name`
  // pattern (`^[a-z_][a-z0-9_]*$`) accepts. Empty → prompt; malformed → hint.
  const NAME_RE = /^[a-z_][a-z0-9_]*$/;
  const nameKey = name.trim();
  const nameMissing = nameKey.length === 0;
  const nameInvalid = nameKey.length > 0 && !NAME_RE.test(nameKey);
  const canSubmit = trimmed.length > 0 && !isDuplicate && allRequiredFilled && !nameMissing && !nameInvalid;


  const handleSubmit = async () => {
    if (!canSubmit || submittingRef.current) return;
    // Bundle the picks under their type-specific sub-key, the spec ListView
    // block of that name (e.g. { type: "kanban", kanban: { groupByField } }).
    // A `list` pick is written as a one-element array: the chart's `values`
    // and `dimensions` are lists in the spec.
    const subConfig = buildSubConfig();
    const payload: Record<string, any> & { type: string; label: string; name: string } = {
      type: selectedType,
      label: trimmed,
      name: nameKey,
    };
    if (Object.keys(subConfig).length > 0) {
      payload[selectedType] = subConfig;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      // Close only on a saved view (objectui#11578). A refused save resolves
      // `false`: the dialog stays, with everything the user typed.
      const saved = await onCreate(payload);
      if (saved) onOpenChange(false);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[560px]"
        data-testid="create-view-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t('console.objectView.createView')}</DialogTitle>
          <DialogDescription>
            {t('console.objectView.createViewDesc')}
          </DialogDescription>
        </DialogHeader>

        {/* Three columns at dialog width, two on a phone: at four, a card's
            text column was too narrow for a description or a reason to read
            in full, so the text was clamped mid-word (objectui#13141). */}
        <div className="grid grid-cols-2 gap-2 py-2 sm:grid-cols-3" data-testid="create-view-type-grid">
          {types.map(({ type, label: typeLabel, description, icon: Icon }) => {
            const selected = type === selectedType;
            const blocker = typeUnavailability[type];
            const disabled = !!blocker;
            // A card that cannot be chosen says WHY on its face, not in a
            // `title` on a disabled button: a disabled button takes no focus
            // and touch has no hover, so a tooltip reached only the mouse
            // (objectui#13141). A dataset is not a field, so a chart card
            // blocked on one says so in its own words rather than "no field
            // that can serve as".
            const unavailableReason = disabled
              ? blocker!.kind === 'dataset'
                ? t('console.objectView.viewTypeUnavailableDataset')
                : t('console.objectView.viewTypeUnavailable', { field: t(blocker!.i18nKey) })
              : undefined;
            const labelId = `${typeGridId}-${type}-label`;
            const textId = `${typeGridId}-${type}-text`;
            return (
              <button
                key={type}
                type="button"
                data-testid={`create-view-type-${type}`}
                aria-pressed={selected}
                aria-disabled={disabled}
                aria-labelledby={labelId}
                aria-describedby={textId}
                disabled={disabled}
                onClick={() => { if (!disabled) setSelectedType(type); }}
                className={cn(
                  'group flex flex-col items-start gap-1 rounded-lg border bg-background p-3 text-left transition-colors',
                  !disabled && 'hover:border-primary/60 hover:bg-accent/40',
                  selected && !disabled
                    ? 'border-primary ring-2 ring-primary/30 bg-accent/40'
                    : 'border-border',
                  disabled && 'opacity-50 cursor-not-allowed',
                )}
              >
                <Icon
                  className={cn(
                    'h-5 w-5',
                    selected && !disabled
                      ? 'text-primary'
                      : 'text-muted-foreground group-hover:text-foreground',
                  )}
                />
                <div id={labelId} className="text-xs font-medium leading-tight">{typeLabel}</div>
                <div
                  id={textId}
                  className="text-[10px] leading-tight text-muted-foreground"
                  data-testid={`create-view-type-${type}-text`}
                >
                  {unavailableReason ?? description}
                </div>
              </button>
            );
          })}
        </div>

        {/* Type-specific configuration */}
        {requiredFields.length > 0 && (
          <div className="space-y-3 rounded-md border border-dashed bg-muted/30 p-3" data-testid="create-view-required-fields">
            {requiredFields.map((rf) => {
              const options = optionsFor(rf);
              // An optional pick is offered only where there is something to
              // offer: the chart dimension, when the chosen dataset declares any.
              if (rf.optional && options.length === 0) return null;
              const selectedFieldValue = pickedValue(rf);
              const isField = !rf.kind || rf.kind === 'field';
              const ofDataset = rf.kind === 'measure' || rf.kind === 'dimension';
              // Nothing to judge yet: the catalog, or the chosen dataset's
              // members, are still on their way; or no dataset is chosen.
              const pending = (rf.kind === 'dataset' && catalog.loading)
                || (ofDataset && (!boundDataset || semantics.loading));
              const noEligible = isField
                ? fieldOptions.length > 0 && options.length === 0
                : rf.kind !== 'enum' && !pending && options.length === 0;
              const noEligibleText = rf.kind === 'dataset'
                ? (catalog.error ?? t('console.objectView.viewTypeUnavailableDataset'))
                : ofDataset
                  ? (semantics.error ?? t('console.objectView.noDatasetMeasure'))
                  : t('console.objectView.noEligibleFieldForType');
              return (
                <div key={rf.key} className="space-y-1">
                  <label
                    htmlFor={`create-view-required-${rf.key}`}
                    className="text-xs font-medium"
                  >
                    {t(rf.i18nKey)}
                    {/* Visual-only (objectui#3299): required is announced as a
                        STATE via `aria-required` on the control; hiding the `*`
                        keeps "asterisk" out of the accessible name. */}
                    {!rf.optional && (
                      <span className="ml-1 text-destructive" aria-hidden="true">*</span>
                    )}
                  </label>
                  <ConfigPicker
                    id={`create-view-required-${rf.key}`}
                    required={!rf.optional}
                    value={selectedFieldValue}
                    options={[
                      {
                        value: '',
                        label: isField ? t('console.objectView.selectField') : t('console.objectView.selectOption'),
                      },
                      ...options,
                    ]}
                    onPick={(value) => choose(rf, value)}
                    disabled={noEligible || pending}
                  />
                  {rf.helpI18nKey && !noEligible && (
                    <p className="text-[11px] text-muted-foreground">
                      {t(rf.helpI18nKey)}
                    </p>
                  )}
                  {noEligible && (
                    <p
                      className="flex items-center gap-1 text-[11px] text-destructive"
                      data-testid={`create-view-error-no-field-${rf.key}`}
                    >
                      <AlertCircle className="h-3 w-3" />
                      {noEligibleText}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="space-y-1">
          <label htmlFor="create-view-name-input" className="text-xs font-medium">
            {t('console.objectView.title')}
            <span className="ml-1 text-destructive" aria-hidden="true">*</span>
          </label>
          <Input
            id="create-view-name-input"
            aria-required="true"
            data-testid="create-view-name-input"
            autoFocus
            value={label}
            onChange={(e) => { setLabel(e.target.value); setTouched(true); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) void handleSubmit(); }}
            placeholder={t('console.objectView.newView')}
            className="h-9"
          />
          {isDuplicate && (
            <p className="text-[11px] text-destructive" data-testid="create-view-error-duplicate">
              {t('console.objectView.duplicateViewName')}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <label htmlFor="create-view-machine-name-input" className="text-xs font-medium">
            {t('console.objectView.viewName')}
            <span className="ml-1 text-destructive" aria-hidden="true">*</span>
          </label>
          <Input
            id="create-view-machine-name-input"
            aria-required="true"
            data-testid="create-view-machine-name-input"
            value={name}
            onChange={(e) => { setName(e.target.value); setNameTouched(true); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) void handleSubmit(); }}
            placeholder="grid_1"
            className="h-9 font-mono"
          />
          {nameMissing ? (
            <p className="text-[11px] text-muted-foreground" data-testid="create-view-machine-name-help">
              {t('console.objectView.viewNameRequired')}
            </p>
          ) : nameInvalid ? (
            <p className="text-[11px] text-destructive" data-testid="create-view-error-machine-name">
              {t('console.objectView.viewNameInvalid')}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground" data-testid="create-view-machine-name-help">
              {t('console.objectView.viewNameHelp')}
            </p>
          )}
        </div>

        <DialogFooter className="mt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="create-view-cancel"
          >
            {t('console.objectView.cancel')}
          </Button>
          <Button
            type="button"
            disabled={!canSubmit || submitting}
            onClick={() => void handleSubmit()}
            data-testid="create-view-submit"
          >
            {t('console.objectView.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// The view switcher's in-place create card
// ---------------------------------------------------------------------------

/** The longest machine key the generator writes, before a numeric suffix. */
const VIEW_KEY_MAX = 48;

/**
 * A view's machine key, generated from its name and never shown: the name's
 * snake_case form (a Chinese name through its pinyin, `romanizeHan`), else
 * `view`, made unique against `taken` with a `_2`, `_3`, … suffix. `taken`
 * holds bare keys or qualified `object.key` names; both spellings collide.
 */
export function uniqueViewKey(label: string, taken: Iterable<string>): string {
  const used = new Set<string>();
  for (const name of taken) {
    if (typeof name !== 'string' || !name) continue;
    used.add(name);
    const dot = name.lastIndexOf('.');
    if (dot !== -1) used.add(name.slice(dot + 1));
  }
  let base = slugify(romanizeHan(label)).slice(0, VIEW_KEY_MAX).replace(/_+$/g, '');
  if (!/^[a-z_][a-z0-9_]*$/.test(base)) base = 'view';
  if (!used.has(base)) return base;
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${base}_${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
}

/** What the in-place create card asks its host to create. */
export interface InPlaceViewRequest {
  /**
   * The new view: its type, the name the reader gave it, the machine key
   * generated from that name ({@link uniqueViewKey}; a shared view's
   * metadata key, unused by one of the reader's own views) and the type's
   * picks under the type's key, as {@link CreateViewDialog} hands them.
   */
  config: Record<string, any> & { type: string; label: string; name: string };
  /** `personal`: one of the reader's own views; `shared`: a view of the object. */
  scope: 'personal' | 'shared';
  /** Carry the list's unsaved filters and sort into the new view. */
  includeCurrent: boolean;
}

export interface CreateViewCardProps {
  /** Fields for the type's pick (group-by, date, …), as {@link CreateViewDialogProps}. */
  objectDef?: CreateViewDialogProps['objectDef'];
  /** The views' names, to suggest a default name no view has and to refuse a taken one. */
  existingLabels?: string[];
  /** The views' ids or keys, to generate a machine key no view has. */
  existingKeys?: string[];
  /** Restrict the view types. Defaults to every type the dialog offers. */
  availableTypes?: string[];
  /** The reader may create one of their own views. */
  canCreatePersonal: boolean;
  /** The reader may create a shared view: the card then offers the switch. */
  canCreateShared: boolean;
  /** The list holds filters or a sort its view does not: offer to include them (on by default). */
  hasUnsavedConditions: boolean;
  /**
   * Create the view and enter it. Resolves `true` once created; `false` when
   * refused (the host has said why), and the card keeps what was entered.
   */
  onCreate: (request: InPlaceViewRequest) => boolean | Promise<boolean>;
  /** Back to the view list. */
  onBack: () => void;
}

/**
 * The in-place create card of the view switcher: the switcher's dropdown turns
 * into it on 「Add view」. Name (beside the chosen type's icon), the view type,
 * the one pick the type needs (kanban: the group-by field; calendar: the date
 * field; a type that needs none shows none), whether to include the list's
 * unsaved filters and sort, and — for a reader who may — personal or shared.
 * No machine name is asked for: {@link uniqueViewKey} generates it.
 *
 * Picks beyond the type's first are filled with the same defaults the dialog
 * picks, and shown only while they hold nothing, so a type that needs more
 * than one binding (a gantt's two dates, a map's two coordinates) is never
 * dropped from the card. Writes nothing itself: `onCreate` does.
 */
export function CreateViewCard({
  objectDef,
  existingLabels,
  existingKeys,
  availableTypes,
  canCreatePersonal,
  canCreateShared,
  hasUnsavedConditions,
  onCreate,
  onBack,
}: CreateViewCardProps) {
  const { t } = useObjectTranslation();
  const allTypes = useMemo(() => buildViewTypeMeta(t), [t]);
  const types = useMemo(
    () => (availableTypes && availableTypes.length > 0
      ? allTypes.filter((v) => availableTypes.includes(v.type))
      : allTypes),
    [allTypes, availableTypes],
  );
  const existingKey = (existingLabels ?? []).join('\u0000');
  const existingSet = useMemo(
    () => new Set(existingLabels ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [existingKey],
  );
  const [selectedType, setSelectedType] = useState<string>(types[0]?.type ?? 'grid');
  const [label, setLabel] = useState('');
  const [touched, setTouched] = useState(false);
  const [includeCurrent, setIncludeCurrent] = useState(true);
  const [scope, setScope] = useState<'personal' | 'shared'>(canCreatePersonal ? 'personal' : 'shared');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const baseId = useId();
  // Loads the pinyin dictionary for a Chinese name, so the key reads as it.
  useHanRomanizer(label);

  const {
    requiredFields,
    optionsFor,
    pickedValue,
    choose,
    typeUnavailability,
    allRequiredFilled,
    subConfig,
    catalog,
    boundDataset,
    semantics,
  } = useRequiredPicks({ enabled: true, objectDef, types, selectedType });

  const meta = types.find((v) => v.type === selectedType);
  useEffect(() => {
    if (!touched) setLabel(suggestName(meta?.label ?? 'View', existingSet));
  }, [meta?.label, touched, existingSet]);

  const primary = requiredFields.find((rf) => !rf.optional && rf.kind !== 'enum');
  const shownPicks = requiredFields.filter((rf) => rf === primary || (!rf.optional && !pickedValue(rf)));
  const trimmed = label.trim();
  const isDuplicate = trimmed.length > 0 && existingSet.has(trimmed);
  const typeBlocked = !!typeUnavailability[selectedType];
  const canSubmit = trimmed.length > 0 && !isDuplicate && !typeBlocked && allRequiredFilled && (canCreatePersonal || canCreateShared);
  const TypeIcon = meta?.icon ?? LayoutGrid;

  const submit = async () => {
    if (!canSubmit || submittingRef.current) return;
    const block = subConfig();
    const config: InPlaceViewRequest['config'] = {
      type: selectedType,
      label: trimmed,
      name: uniqueViewKey(trimmed, existingKeys ?? []),
      ...(Object.keys(block).length > 0 ? { [selectedType]: block } : {}),
    };
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onCreate({ config, scope, includeCurrent: hasUnsavedConditions && includeCurrent });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const nameId = `${baseId}-name`;
  const typeId = `${baseId}-type`;
  const includeId = `${baseId}-include`;
  return (
    <div data-testid="create-view-card">
      <div className="flex items-center border-b px-1 py-1">
        <button
          type="button"
          onClick={onBack}
          data-testid="create-view-card-back"
          className="flex items-center gap-1 rounded-sm px-1.5 py-1 text-[13px] font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-11"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          {t('view.switcher.addView', { defaultValue: 'Add view' })}
        </button>
      </div>
      <div className="space-y-3 p-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground" aria-hidden="true">
            <TypeIcon className="h-4 w-4" />
          </span>
          <Input
            id={nameId}
            autoFocus
            value={label}
            aria-label={t('view.switcher.myViewName', { defaultValue: 'View name' })}
            placeholder={t('view.switcher.myViewName', { defaultValue: 'View name' })}
            onFocus={(e) => { if (!touched) e.currentTarget.select(); }}
            onChange={(e) => { setLabel(e.target.value); setTouched(true); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
            className="h-8 text-[13px] max-sm:h-11"
            data-testid="create-view-card-name"
          />
        </div>
        {isDuplicate && (
          <p className="text-[11px] text-destructive" data-testid="create-view-card-duplicate">
            {t('console.objectView.duplicateViewName')}
          </p>
        )}

        <div className="space-y-1">
          <label htmlFor={typeId} className="text-xs font-medium text-muted-foreground">
            {t('view.switcher.typeLabel', { defaultValue: 'View type' })}
          </label>
          <Select value={selectedType} onValueChange={setSelectedType}>
            <SelectTrigger id={typeId} className="h-8 text-[13px] max-sm:h-11" data-testid="create-view-card-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {types.map(({ type, label: typeLabel, icon: Icon }) => (
                <SelectItem key={type} value={type} disabled={!!typeUnavailability[type]} data-testid={`create-view-card-type-${type}`}>
                  <span className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {typeLabel}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {shownPicks.map((rf) => {
          const options = optionsFor(rf);
          const isField = !rf.kind || rf.kind === 'field';
          const ofDataset = rf.kind === 'measure' || rf.kind === 'dimension';
          const pending = (rf.kind === 'dataset' && catalog.loading)
            || (ofDataset && (!boundDataset || semantics.loading));
          const id = `create-view-card-pick-${rf.key}`;
          return (
            <div key={rf.key} className="space-y-1">
              <label htmlFor={id} className="text-xs font-medium text-muted-foreground">{t(rf.i18nKey)}</label>
              <ConfigPicker
                id={id}
                required={!rf.optional}
                value={pickedValue(rf)}
                options={[
                  { value: '', label: isField ? t('console.objectView.selectField') : t('console.objectView.selectOption') },
                  ...options,
                ]}
                onPick={(value) => choose(rf, value)}
                disabled={pending || options.length === 0}
              />
            </div>
          );
        })}

        {hasUnsavedConditions && (
          <label htmlFor={includeId} className="flex cursor-pointer items-center gap-2 text-[13px]">
            <input
              id={includeId}
              type="checkbox"
              checked={includeCurrent}
              onChange={(e) => setIncludeCurrent(e.target.checked)}
              className="rounded border-input"
              data-testid="create-view-card-include-current"
            />
            {t('view.switcher.includeCurrent', { defaultValue: 'Include the current filters and sort' })}
          </label>
        )}

        {canCreatePersonal && canCreateShared && (
          <div className="space-y-1">
            <div role="radiogroup" className="grid grid-cols-2 gap-0.5 rounded-md bg-muted p-0.5" data-testid="create-view-card-scope">
              {(['personal', 'shared'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={scope === value}
                  onClick={() => setScope(value)}
                  data-testid={`create-view-card-scope-${value}`}
                  className={cn(
                    'h-7 rounded-[5px] px-2 text-xs font-medium transition-colors max-sm:h-11',
                    scope === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {value === 'personal'
                    ? t('view.switcher.myViews', { defaultValue: 'My views' })
                    : t('view.switcher.scopeShared', { defaultValue: 'Shared' })}
                </button>
              ))}
            </div>
          </div>
        )}
        {scope === 'shared' && (
          <p className="text-[11px] text-muted-foreground" data-testid="create-view-card-shared-hint">
            {t('view.switcher.scopeHint', { defaultValue: 'Shared views are seen by everyone who can see this list' })}
          </p>
        )}

        <Button
          type="button"
          className="h-8 w-full text-[13px] max-sm:h-11"
          disabled={!canSubmit || submitting}
          onClick={() => void submit()}
          data-testid="create-view-card-submit"
        >
          {t('view.switcher.create', { defaultValue: 'Create' })}
        </Button>
      </div>
    </div>
  );
}
