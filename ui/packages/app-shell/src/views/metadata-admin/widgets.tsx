// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Built-in widget renderers for SchemaForm.
 *
 * These cover the common widget hints declared in spec `*.form.ts`
 * files (e.g. `widget: 'ref:object'`, `widget: 'master-detail'`).
 *
 * Each widget receives `WidgetProps`:
 *   - schema     — the JSONSchema fragment for THIS field (so widgets
 *                  for nested arrays can read items.properties)
 *   - value      — the current value
 *   - onChange   — write-back callback
 *   - readOnly   — disable
 *   - context    — out-of-band data (object list, ObjectQL fields, …)
 *
 * To register a new widget, add an entry to `WIDGETS` below. To wire
 * extra context (e.g. a fields list), extend `WidgetContext` in
 * SchemaForm.tsx and prefetch it in ResourceEditPage.
 */

import * as React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Input,
  Button,
  Label,
  Switch,
  LazyIcon,
  toKebabIconName,
  Popover,
  PopoverTrigger,
  PopoverContent,
  FilterBuilder,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@object-ui/components';
import type { RegistryComponentMeta } from '@object-ui/core';
import { AlertTriangle, ChevronDown, ChevronsUpDown, ChevronUp, Eye, EyeOff, Plus, Search, Trash2 } from 'lucide-react';
import { iconNames } from 'lucide-react/dynamic.mjs';
import { toast } from 'sonner';
import { useObjectTranslation } from '@object-ui/i18n';
import { useMetadataLocale, t, tFormat } from './i18n.js';
import type { FormFieldSpec, FormViewSpec, VisibilityPredicate } from './form-spec.js';
import { usePredicateScope } from '@object-ui/react';
import { buildPredicateCtx, visibleOptions, type PredicateCtx } from './predicate.js';
import { foldFilterGroupToSpecRules, FILTER_FOLD_REFUSAL_KEYS } from '../viewFilterFold.js';
import { ColorVariantPicker } from './color-variant-field.js';
import type { ConditionScope } from './conditionScope.js';
import { ConditionBuilder } from './inspectors/ConditionBuilder.js';
import { expressionSource, writeExpressionSource } from './inspectors/expression-envelope.js';
import { humanizeKey } from './inspectors/json-schema-to-fields.js';
import { datasetSelectOptions } from './inspectors/dataset-picker-options.js';
import type { DatasetCatalogEntry } from './previews/useDatasetCatalog.js';
import { useMonacoFallback } from './useMonacoFallback.js';
import { DraftChip } from '../studio-design/StudioDraftMark.js';
import {
  type LoadState,
  isLoading,
  loadErrorOf,
  loadedData,
  NOT_ASKED,
  offeredOptions,
  usePickerLoad,
} from './loadState.js';

/* -------------------------------------------------------------------------- */
/* The option catalogs a picker reads off {@link WidgetContext}                */
/* -------------------------------------------------------------------------- */

/** One entry of the bound object's field catalog (`field-ref`, `field-multi`). */
export interface ObjectFieldOption {
  name: string;
  label?: string;
  type?: string;
}

/** One entry of the source object's view catalog (`view-ref`). */
export interface ObjectViewOption {
  name: string;
  label?: string;
}

/** One entry of the source object's action catalog (`action-multi`). */
export interface ObjectActionOption {
  name: string;
  label?: string;
  locations?: string[];
}

/**
 * One declared item of a metadata registry, as a `ref-multi:<type>` picker
 * offers it (objectui#12126): the item's machine name, which is what the picker
 * stores, and the author's label for it.
 */
export interface RegistryItemOption {
  name: string;
  label?: string;
}

/**
 * A catalog handed to the pickers, in whichever of the four states its load is
 * actually in (objectui#5228).
 *
 * ## What this replaced, and why the replacement is a type and not a rule
 *
 * Until objectui#5228 this boundary spelled a catalog as a plain array plus two
 * side channels — a `*Loading` flag and a `catalogErrors` record — which meant a
 * FAILED load arrived here as `[]`, byte-identical to a load that completed and
 * found nothing. Nothing in the types said the failure channel existed: the
 * requirement lived in `CatalogErrors`' own doc comment, which had to open with
 * "a picker MUST consult this before it renders its catalog". That is a comment
 * doing a type's job, and it is one line away from being ignored —
 *
 * ```ts
 * const fields = context?.objectFields ?? [];   // type-correct, reads fine,
 * ```
 *
 * — which renders a refusal, a dropped connection or an expired session as the
 * metadata graph's own answer of "this object has no fields", the defect
 * objectui#5170 and objectui#5169 were filed for.
 *
 * As a union that read does not compile: `LoadState<T>` is not an array, so
 * every site that wants the list has to go through {@link offeredOptions},
 * whose parameter type excludes the `error` arm. The failure decision stops
 * being a rule a reviewer has to remember and becomes a precondition the
 * compiler checks, at exactly the sites that must decide what a failure looks
 * like.
 *
 * ## Absent still means something
 *
 * The catalogs stay optional — a host that never fetches views omits
 * `objectViews` — and absence reads as {@link NOT_ASKED}, the `idle` arm. A
 * question never asked is not a failure and must not render as one (ADR-0110
 * D3).
 */
export interface WidgetContext {
  /**
   * Which lint scope the schema-driven condition editor may claim on THIS
   * host's surface — `record`, `flattened`, or `none` for no claim at all
   * (objectui#8167).
   *
   * ## Required, and that is the whole point
   *
   * Every other member here is a catalog a host may or may not have fetched, so
   * absence is a legitimate answer. This one is a VERDICT about the surface the
   * host is editing, and there is no neutral value: the widget serves every
   * metadata type by name convention, so before this member existed every
   * condition field in every generic form fell through to `celAuthoring`'s
   * `hint.scope ?? 'flattened'` default and linted the retired bare shorthand
   * CLEAN — on the action and hook tiers, where the runtime binds the row as
   * the `record` ROOT and the predicate therefore never matches.
   *
   * Making it required puts the answer where the question can be answered: the
   * host knows which metadata type is on screen, the widget never can. A
   * missing verdict is a compile error at the construction site rather than a
   * silent `flattened` in front of an author.
   *
   * ⛔ This is NOT the widget's own knob and ⛔ not a hard-coded value. A host
   * editing one fixed surface states its verdict; a host editing many derives
   * it from the metadata type with `conditionScopeForMetadataType`, whose table
   * carries the per-tier rulings and the reading behind each one.
   */
  conditionScope: ConditionScope;
  /**
   * The context subjects a condition editor at this host may offer
   * (objectui#9953) — `undefined` to declare no narrowing.
   *
   * ## Why this is a SECOND member and not a widening of `conditionScope`
   *
   * `conditionScope` is a claim about how the CEL is LINTED; it is not a claim
   * about what the host BINDS, and the two come apart on exactly the tiers this
   * widget serves. `action`, `hook` and `validation` all rule `'record'`, yet a
   * hook's condition is evaluated by a server host binding `record` and
   * `previous` alone while an action's `visible` is evaluated in the browser,
   * where `user` really is bound. One value could not have carried both
   * answers, which is why `RECORD_CONDITION_SUBJECTS` refuses to derive itself
   * from `scope === 'record'`.
   *
   * ⛔ Not this widget's own knob, for the same reason `conditionScope` is not:
   * a host editing one fixed surface states its verdict, and a host editing
   * many derives it with `conditionSubjectsForMetadataType`.
   *
   * `undefined` changes nothing — `ConditionBuilder` keeps `CONTEXT_SUBJECTS`,
   * so a host that declares no narrowing offers what it always offered. That is
   * why this member is optional where `conditionScope` is required: a missing
   * scope silently claimed `flattened`, a missing vocabulary claims nothing.
   */
  conditionSubjects?: ReadonlyArray<{ value: string; label?: string }>;
  /**
   * The scope roots a condition editor at this host may OFFER (objectui#9856) —
   * `undefined` to declare no narrowing.
   *
   * ## Why a THIRD member, and not a widening of either of the two above
   *
   * `conditionScope` is how the predicate is LINTED and `conditionSubjects` is
   * what the row builder's dropdown may offer. This is what the RAW editor's
   * autocomplete may offer, and it is the only one of the three whose default
   * is already a narrowing: `ConditionBuilder` answers a `scope="record"` mount
   * with `RECORD_CONDITION_ROOTS` — the set every host of a record-scoped
   * condition binds — so the tier that needs a declaration here is the CLIENT
   * one, the mirror of the tier `conditionSubjects` narrows. One member could
   * not have carried both directions.
   *
   * ⛔ Not this widget's own knob, for the reason the two above give: a host
   * editing one fixed surface states its verdict, and a host editing many
   * derives it with `conditionRootsForMetadataType`.
   *
   * `undefined` changes nothing — the builder keeps the default its `scope`
   * implies, which is what every mount here offered before this member existed.
   */
  conditionRoots?: string[];
  /** Names of all object metadata records (for `ref:object`, `object-selector`). */
  objectNames?: LoadState<string[]>;
  /**
   * Field catalog of the bound object. Drives the `field-ref` / `field-multi`
   * pickers so View config props that reference a field (kanban.groupByField,
   * calendar.startDateField, chart.xAxisField, …) render as dropdowns of the
   * object's real fields instead of free text.
   */
  objectFields?: LoadState<ObjectFieldOption[]>;
  /**
   * View catalog of the bound/source object. Drives the `view-ref` picker so
   * `interfaceConfig.sourceView` renders as a dropdown of the source object's
   * real views instead of a free-text name the author can typo.
   */
  objectViews?: LoadState<ObjectViewOption[]>;
  /**
   * Action catalog of the bound/source object. Drives the `action-multi`
   * picker so interface-page toolbar `buttons` reference the object's real
   * actions (ActionSchema) instead of free-text — correct-by-construction.
   *
   * Rides the same request as {@link WidgetContext.objectFields} today, and
   * `ResourceEditPage` derives both from that one state (see `mapLoaded`), so
   * the two agree by construction rather than by the reader knowing they share
   * a fetch — which is what the old `catalogErrors.fields` key, consulted by
   * the *action* picker to learn whether *actions* had failed, asked of them.
   */
  objectActions?: LoadState<ObjectActionOption[]>;
  /**
   * Per-value sub-schemas for the `dynamic-config` widget: a map from a parent
   * field's value (e.g. the chosen driver id) to the JSON-Schema describing the
   * config object for that value. Lets a single `config` field render different
   * fields depending on a sibling selection (driver → connection settings).
   */
  dynamicSchemas?: Record<string, { properties?: Record<string, any>; required?: string[] }>;
  /**
   * Component ids placed on the page being edited — extracted from the draft's
   * `regions[].components[]` tree (see {@link collectPageComponentIds}). Drives
   * the `ref:component` picker so a page variable's `source` (the component that
   * writes it) is chosen from the real components on the canvas instead of a
   * free-text id the author can typo.
   */
  componentIds?: Array<{ id: string; type?: string; label?: string }>;
  /**
   * The analytics dataset catalog (objectui#11601). Drives the `ref:dataset`
   * picker, so a spec-form field that declares that hint — a joined report's
   * block `dataset` — is chosen from the real datasets, with the author's
   * label and description beside each name, instead of a free-text name the
   * author can typo. The value the picker writes is the dataset's name.
   *
   * The report inspector feeds the same `useDatasetCatalog` result its own
   * top-level dataset picker reads. A host that never fetches the catalog
   * omits this member; absence is {@link NOT_ASKED}, and the widget then
   * renders a labelled text input, as it does for a completed load that found
   * no datasets.
   */
  datasets?: LoadState<DatasetCatalogEntry[]>;
  /**
   * The permission-set catalog (objectui#12126): every permission set the
   * environment registry serves (metadata type `permission`). Drives the
   * `ref-multi:permission` picker, so a spec-form field that declares that hint
   * (the position form's `permissionSets`, ADR-0131 D4: a reference to a
   * declared item is by machine name, resolved registry-first) is chosen from
   * the declared sets instead of typed as free text. The picker stores the
   * picked sets' names, as a list.
   *
   * `ResourceEditPage` loads it only for a form that declares the hint
   * (`formDeclaresWidget`). A host that never fetches it omits this member;
   * absence is {@link NOT_ASKED}, and the widget then takes typed names, as it
   * does for a completed load that found no permission sets.
   */
  permissionSets?: LoadState<RegistryItemOption[]>;
}

/* Stable empties for the arms that have no catalog to offer yet — `idle` and
   `loading`. Module-level so {@link offeredOptions} returns the SAME array
   across renders and a memo downstream of it does not churn. Never a failure
   fallback: no failure can reach `offeredOptions` at all. */
const NO_OBJECT_NAMES: string[] = [];
const NO_OBJECT_FIELDS: ObjectFieldOption[] = [];
const NO_OBJECT_VIEWS: ObjectViewOption[] = [];
const NO_OBJECT_ACTIONS: ObjectActionOption[] = [];
const NO_DATASETS: DatasetCatalogEntry[] = [];
const NO_REGISTRY_ITEMS: RegistryItemOption[] = [];

export interface WidgetProps {
  /**
   * The host field id, handed down ONLY to a widget declared
   * `labelling: 'control'` in {@link WIDGET_LABELLING} — the host's
   * `<Label htmlFor>` points at it, so the widget must put it on the LABELABLE
   * element that is the field's primary control (objectui#4871).
   *
   * From `FieldRow` a `'group'` widget receives `undefined` here on purpose:
   * `<label for>` is inert on a container, and taking the id anyway would make
   * the `for` resolve while still naming nobody — the cosmetic half-fix
   * objectui#4010 refused. A grid CELL has no `<label>` that could dangle, so it
   * hands its cell id to EVERY widget as a plain anchor; a `'group'` widget has
   * nowhere to put it and the cell's name arrives by IDREF either way.
   */
  id?: string;
  /**
   * An IDREF naming whatever this widget renders. Every widget answers it on the
   * surface that IS the field, in BOTH declared labellings (objectui#9889) —
   * `'group'` on its `role="group"` / `role="radiogroup"` container, `'control'`
   * on its primary labelable element through {@link controlNaming}.
   *
   * From `FieldRow` this is the host label's own `id` and it reaches a
   * `'group'` widget only: an IDREF is the one channel that works on a
   * non-labelable surface, while a `'control'` widget is already named by the
   * `<label for>` — one label, one channel (objectui#3978). ⚠️ That mutual
   * exclusion is `FieldRow`'s rule about A LABEL, ⛔ not a rule about a widget.
   * A grid/table repeater cell has no `<label>` at all and passes BOTH
   * (objectui#5063); a widget that treats them as alternatives renders unnamed
   * there.
   */
  ariaLabelledBy?: string;
  /**
   * Whether the host shows a required `*` for this field (objectui#10367). That
   * `*` is `aria-hidden` — it sits inside the label that names the control, so
   * it would otherwise be read as part of the name — and this is the channel
   * that announces the requirement instead: a `labelling: 'control'` widget
   * puts it on its primary control as `aria-required`, through
   * {@link controlNaming}, next to the naming props. `filter-builder` is the
   * one `'control'` widget that does not: its face is a plain `button`, and
   * ARIA 1.2 does not support `aria-required` on role `button`. Of the
   * `'group'` widgets only `color-picker` reads it: its surface is a
   * `radiogroup`, which does support the state, so it hands the flag to
   * `ColorVariantPicker`. The rest render `role="group"`, which does not.
   */
  required?: boolean;
  schema: Record<string, any>;
  value: unknown;
  onChange: (v: unknown) => void;
  readOnly?: boolean;
  context?: WidgetContext;
  /**
   * The authored field spec — the SAME declaration the form layout is written
   * against (`./form-spec.js`), not a second description of it. This was an
   * inline copy until objectui#5040, and the copies disagreed: only this one
   * declared `dependsOn`, which {@link FieldSelectorWidget} and
   * {@link DynamicConfigWidget} both read below.
   */
  fieldSpec?: FormFieldSpec;
  /** All form data (for reading dependency values) */
  formData?: Record<string, unknown>;
  /**
   * objectui#12725 — the elements of this value the AI copilot added in the
   * pending draft, by stored value. Read by `field-multi` only, which draws the
   * copilot's draft chip inside each such element's row. Absent (every host but
   * Studio's list-view properties), nothing is marked.
   */
  copilotAdded?: ReadonlySet<string>;
}

export type WidgetRenderer = (props: WidgetProps) => React.ReactElement;

/**
 * The naming props a `labelling: 'control'` widget puts on the ONE labelable
 * element that is the field's primary control — BOTH channels together, never
 * one or the other (objectui#9889).
 *
 * `labelling` answers exactly one question: can the host's `<label for>` reach a
 * labelable element? `'control'` says yes, which is why the host hands such a
 * widget an `id`. It has never answered a SECOND question — which naming
 * channel the widget consumes — and reading it as though it did is the defect
 * this helper closes. `FieldRow`'s "exactly one of `id` / `ariaLabelledBy`" is a
 * rule about A HOST THAT HAS A LABEL, ⛔ not a rule about a widget: a grid/table
 * repeater CELL has no `<label>` at all (objectui#5063). It writes the column
 * name once in the `<th>`, names every cell from it by IDREF, keeps the cell id
 * on the control as a plain anchor — and so hands down BOTH. A widget that reads
 * only `id` is therefore an UNNAMED edit box in every grid row.
 *
 * The two channels cannot both be live, so emitting both is safe rather than a
 * second association beside a working one (the objectui#3978 hazard):
 * `aria-labelledby` wins the accessible-name computation over a native
 * `<label>`, and a host that has a label sends `id` alone while a grid cell that
 * sends both has no label to compete with.
 *
 * ⛔ NOT for the auxiliary affordances beside that control — a chip's remove
 * button, a reveal toggle, the hex mirror beside a colour swatch. Those carry
 * their OWN names and are not what the field's label names (the `'control'`
 * contract in {@link WIDGET_LABELLING}); spreading this over them would rename
 * every button in a cell after the column and bury the one name that identifies
 * the control.
 *
 * Historical reading, ⛔ not re-derived here: at baseline `fc12bc8c6`, on real
 * `SchemaForm` renders, every `'group'` widget in {@link WIDGET_LABELLING}
 * consumed the IDREF and ⛔ no `'control'` widget did. The instrument that
 * re-derives it is `SchemaForm.controlWidgetGridNaming-9889.test.tsx`, which
 * drives each registered widget into a grid cell and reads the accessible name.
 *
 * File-local on purpose: every widget in this registry lives in this module,
 * and the package barrel re-exports named symbols one by one — so exporting
 * this would enlarge a published surface that nothing outside can use.
 */
function controlNaming({
  id,
  ariaLabelledBy,
  required,
}: Pick<WidgetProps, 'id' | 'ariaLabelledBy' | 'required'>): {
  id?: string;
  'aria-labelledby'?: string;
  'aria-required'?: true;
} {
  // `aria-required` rides with the naming props because it belongs on the same
  // element: the one the host's label names, whose `*` is now `aria-hidden`
  // (objectui#10367). Omitted, never "false", when the field is optional.
  return { id, 'aria-labelledby': ariaLabelledBy, 'aria-required': required ? true : undefined };
}

/* -------------------------------------------------------------------------- */
/* Shared failure state for every option picker (objectui#5170)               */
/* -------------------------------------------------------------------------- */

/**
 * The one thing every picker renders when its option catalog failed to load.
 *
 * Before this existed there was no failure state anywhere in this file: the
 * loaders in `ResourceEditPage` caught a fault by writing the empty array, and
 * each picker then rendered its EMPTY copy — which is not neutral wording. It
 * names a cause, and on a failed load the cause it names is false:
 *
 *   • `ref:object`      → "object_name (no objects detected)"  — a measurement
 *   • `field-ref`       → "No object bound"   — but an object IS bound
 *   • `view-ref`        → "No object bound"   — likewise
 *   • `filter-mode`     → "Bind a source object to pick filter fields."
 *   • `action-multi`    → "Bind a source object to pick actions"
 *
 * So an operator authoring a view, a permission row or an action was told, in
 * so many words, that the thing they are looking for does not exist — and an
 * author who concludes "this object has no fields" tends to go and create one.
 *
 * One component, used by every picker, so the answer is the same wherever the
 * question is asked. The copy states that the list could not be loaded and
 * makes NO claim in either direction about whether options exist — the honest
 * answer when the question was never answered — and shows the cause. Every
 * picker keeps whatever control lets the author see and edit the value already
 * stored, because a failed catalog must not also block authoring.
 *
 * ⛔ The empty-state copy above is deliberately untouched: it is correct for a
 * load that COMPLETED and found nothing, and this card is additive. Rendering
 * it is now reachable only from a completed load.
 */
function PickerLoadFailure({
  message,
  testId,
}: {
  message: string;
  testId: string;
}) {
  const locale = useMetadataLocale();
  return (
    <div
      data-testid={testId}
      role="status"
      className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900"
    >
      <div className="flex items-center gap-1.5 font-medium">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        {t('engine.form.optionsLoadFailedTitle', locale)}
      </div>
      <p className="mt-1 text-amber-800">
        {t('engine.form.optionsLoadFailedDesc', locale)}
      </p>
      {message ? (
        <p
          data-testid={`${testId}-cause`}
          className="mt-1 max-w-full break-words font-mono text-[10px] text-amber-700"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* ref:object — pick an object by name                                        */
/* -------------------------------------------------------------------------- */

function RefObjectWidget({
  id,
  ariaLabelledBy,
  required,
  value,
  onChange,
  readOnly,
  context,
}: WidgetProps) {
  const locale = useMetadataLocale();
  const objectsState = context?.objectNames ?? NOT_ASKED;
  const v = value == null ? '' : String(value);
  // The object list FAILED to load — not the same fact as "there are no
  // objects", which is what the empty branch below says out loud (objectui#5170).
  // The freeform input is kept, and enabled, so a failed catalog does not also
  // block authoring.
  //
  // objectui#5228: this arm is now checked because the compiler makes it be —
  // `offeredOptions` below refuses a state that still carries the `error` arm,
  // so the list cannot be read until this decision is written down.
  if (objectsState.status === 'error') {
    return (
      <div className="space-y-1.5">
        <PickerLoadFailure message={objectsState.message} testId="ref-object-load-failed" />
        <Input
          {...controlNaming({ id, ariaLabelledBy, required })}
          value={v}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      </div>
    );
  }
  if (isLoading(objectsState)) {
    return (
      <Input
        {...controlNaming({ id, ariaLabelledBy, required })}
        value={v}
        disabled
        placeholder={t('engine.form.loadingObjects', locale)}
      />
    );
  }
  const names = offeredOptions(objectsState, NO_OBJECT_NAMES);
  // If list is empty (e.g. no objects defined yet), fall back to a
  // freeform text input so the user can still type a value.
  if (names.length === 0) {
    return (
      <Input
        {...controlNaming({ id, ariaLabelledBy, required })}
        value={v}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value || undefined)}
        placeholder={t('engine.form.noObjects', locale)}
      />
    );
  }
  return (
    <Select
      value={v}
      onValueChange={(next) => onChange(next || undefined)}
      disabled={readOnly}
    >
      <SelectTrigger {...controlNaming({ id, ariaLabelledBy, required })}>
        <SelectValue placeholder={t('engine.form.selectObject', locale)} />
      </SelectTrigger>
      <SelectContent>
        {names.map((n) => (
          <SelectItem key={n} value={n}>
            {n}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* -------------------------------------------------------------------------- */
/* ref:component — pick a component id from the page's canvas tree             */
/* -------------------------------------------------------------------------- */

/**
 * Walk a page draft's `regions[].components[]` tree and collect every component
 * that carries an `id`, returning `{ id, type, label }` in document order (and
 * de-duplicated on id, first-wins). Traverses nested containers via any array-
 * valued `components` / `children` under a node or its `properties`, so ids
 * inside `page:tabs` / `page:section` style containers are surfaced too.
 *
 * Used to fuel the `ref:component` picker (a page variable's `source` names the
 * component that writes it). Exported for unit testing.
 */
export function collectPageComponentIds(
  draft: unknown,
): Array<{ id: string; type?: string; label?: string }> {
  const out: Array<{ id: string; type?: string; label?: string }> = [];
  const seen = new Set<string>();
  const visitNode = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const rec = node as Record<string, unknown>;
    const id = rec.id;
    if (typeof id === 'string' && id && !seen.has(id)) {
      seen.add(id);
      out.push({
        id,
        type: typeof rec.type === 'string' ? rec.type : undefined,
        label: typeof rec.label === 'string' ? rec.label : undefined,
      });
    }
    // Recurse into nested component collections — directly on the node and
    // under `properties` (some container components nest children there).
    visitList(rec.components);
    visitList(rec.children);
    const props = rec.properties;
    if (props && typeof props === 'object') {
      visitList((props as Record<string, unknown>).components);
      visitList((props as Record<string, unknown>).children);
    }
  };
  const visitList = (list: unknown): void => {
    if (Array.isArray(list)) for (const n of list) visitNode(n);
  };
  if (draft && typeof draft === 'object') {
    const regions = (draft as Record<string, unknown>).regions;
    if (Array.isArray(regions)) {
      for (const region of regions) {
        if (region && typeof region === 'object') {
          visitList((region as Record<string, unknown>).components);
        }
      }
    }
  }
  return out;
}

/**
 * Single component-id picker for a page variable's `source` — the component
 * whose selection writes the variable (e.g. an `element:record_picker` with
 * `id="project_picker"`). Component ids come from `context.componentIds`
 * (extracted from the page draft's region/component tree). A stored value not
 * present in the tree is still shown so a stale/renamed id survives; when the
 * page has no components yet, degrades to a free-text input so the field stays
 * editable. Mirrors {@link RefObjectWidget} / {@link ViewRefWidget}.
 */
function RefComponentWidget({ id, ariaLabelledBy, required, value, onChange, readOnly, context }: WidgetProps) {
  const locale = useMetadataLocale();
  const components = context?.componentIds ?? [];
  const current = value == null ? '' : String(value);
  // No components placed yet → free-text fallback so the field is still usable.
  if (components.length === 0) {
    return (
      <Input
        {...controlNaming({ id, ariaLabelledBy, required })}
        value={current}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value || undefined)}
        placeholder={t('engine.form.noComponents', locale)}
      />
    );
  }
  const inTree = !current || components.some((c) => c.id === current);
  return (
    <Select
      value={current || NO_FIELD}
      onValueChange={(v) => onChange(v === NO_FIELD ? undefined : v)}
      disabled={readOnly}
    >
      <SelectTrigger {...controlNaming({ id, ariaLabelledBy, required })}>
        <SelectValue placeholder={t('engine.form.selectComponent', locale)} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_FIELD}>
          <span className="text-muted-foreground">{t('engine.form.none', locale)}</span>
        </SelectItem>
        {!inTree && current && (
          <SelectItem value={current}>
            <span className="flex items-center gap-2">
              <span className="font-mono">{current}</span>
              <span className="text-xs text-muted-foreground">{t('engine.form.notInObject', locale)}</span>
            </span>
          </SelectItem>
        )}
        {components.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            <span className="flex items-center gap-2">
              <span className="font-mono">{c.id}</span>
              {(c.label || c.type) && (
                <span className="text-xs text-muted-foreground">{c.label || c.type}</span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* -------------------------------------------------------------------------- */
/* ref:dataset — pick an analytics dataset by name                            */
/* -------------------------------------------------------------------------- */

/**
 * Single dataset picker for a field that declares `widget: 'ref:dataset'`
 * (objectui#11601) — a report's `dataset`, and a joined report's block
 * `dataset` once its row declares the hint. The datasets come from
 * `context.datasets`; each option reads the author's label beside the name and
 * the description after it (`datasetSelectOptions`, objectui#11161), and the
 * value written is the dataset's NAME.
 *
 * The four arms of the catalog, as {@link RefObjectWidget} reads them:
 *
 *  - FAILED — the shared failure notice beside a freeform box that stays
 *    enabled, so a failed catalog does not also block authoring (objectui#5170);
 *  - LOADING — the stored name in a disabled box;
 *  - `idle` (no host feeds a catalog) or a completed load with no datasets — a
 *    labelled text input that writes the typed name. ⛔ Never the raw-JSON
 *    face an unregistered hint falls back to;
 *  - LOADED — the picker. A stored name the catalog does not offer is kept as
 *    its own option, flagged `(not found)`, so it neither blanks the trigger
 *    nor reads like an offered dataset (objectui#8488).
 */
function RefDatasetWidget({ id, ariaLabelledBy, required, value, onChange, readOnly, context }: WidgetProps) {
  const locale = useMetadataLocale();
  const datasetsState = context?.datasets ?? NOT_ASKED;
  const current = value == null ? '' : String(value);
  const freeform = (
    <Input
      {...controlNaming({ id, ariaLabelledBy, required })}
      value={current}
      disabled={readOnly}
      onChange={(e) => onChange(e.target.value || undefined)}
    />
  );
  if (datasetsState.status === 'error') {
    return (
      <div className="space-y-1.5">
        <PickerLoadFailure message={datasetsState.message} testId="ref-dataset-load-failed" />
        {freeform}
      </div>
    );
  }
  if (isLoading(datasetsState)) {
    return (
      <Input
        {...controlNaming({ id, ariaLabelledBy, required })}
        value={current}
        disabled
        placeholder={t('engine.form.loadingOptions', locale)}
      />
    );
  }
  const options = datasetSelectOptions(offeredOptions(datasetsState, NO_DATASETS));
  if (options.length === 0) return freeform;
  const offered = !current || options.some((o) => o.value === current);
  return (
    <Select value={current} onValueChange={(next) => onChange(next || undefined)} disabled={readOnly}>
      <SelectTrigger {...controlNaming({ id, ariaLabelledBy, required })}>
        <SelectValue placeholder={t('engine.form.selectEllipsis', locale)} />
      </SelectTrigger>
      <SelectContent>
        {!offered && (
          <SelectItem value={current}>
            {tFormat('engine.form.flaggedValue', locale, {
              value: current,
              flag: t('engine.form.notFound', locale),
            })}
          </SelectItem>
        )}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* -------------------------------------------------------------------------- */
/* ref-multi:<type> — pick declared registry items by name, as a list         */
/* -------------------------------------------------------------------------- */

/**
 * What one `ref-multi:<type>` registration binds (objectui#12126): the catalog
 * it reads off {@link WidgetContext} and the copy that names its add control.
 * The key's grammar is the list form of the `ref:` pickers: arity in the
 * prefix, the exact registry type after the colon.
 */
interface RefMultiRegistry {
  /** The registry type after `ref-multi:`. Names the widget's test ids. */
  type: string;
  catalog: (context: WidgetContext | undefined) => LoadState<RegistryItemOption[]> | undefined;
  /** The add control's accessible name. */
  addLabelKey: string;
  /** The add picker's placeholder while declared items remain unpicked. */
  addPlaceholderKey: string;
  /** The add picker's placeholder once every declared item is picked. */
  allAddedKey: string;
}

/**
 * Multi picker for a field that declares `widget: 'ref-multi:<type>'`
 * (objectui#12126). The value is a LIST of the picked items' machine names,
 * in the order they were added; picking appends a name, removing drops it.
 *
 * The catalog's four arms, as {@link RefDatasetWidget} reads them, with the
 * names already stored listed in every arm, each removable while editable:
 *
 *  - FAILED — the shared failure notice beside a text box that stays enabled,
 *    so a failed catalog does not also block authoring (objectui#5170);
 *  - LOADING — the add box disabled, saying the options are loading;
 *  - `idle` (no host feeds a catalog) or a completed load that found nothing —
 *    a text box that adds the typed names. ⛔ Never the raw-JSON face an
 *    unregistered hint falls back to;
 *  - LOADED — an add picker offering the declared items not yet picked.
 *
 * A stored name the LOADED catalog does not declare stays in the list, flagged
 * `(not found)`, so it is neither dropped nor read as a declared item
 * (objectui#8488). The flag is a claim about the registry's answer, so it is
 * made only once the catalog has answered.
 *
 * Labelled `'group'`, as `field-multi` / `action-multi` are (objectui#4871):
 * the add control is gated behind `!readOnly`, so no one labelable element
 * carries the field in both states, and the host's label names the list.
 */
function RefMultiWidget({
  registry,
  value,
  onChange,
  readOnly,
  context,
  ariaLabelledBy,
}: WidgetProps & { registry: RefMultiRegistry }) {
  const locale = useMetadataLocale();
  const catalogState = registry.catalog(context) ?? NOT_ASKED;
  const testId = `ref-multi-${registry.type}`;
  const selected = Array.isArray(value)
    ? (value as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  const loadError = loadErrorOf(catalogState);
  const loading = isLoading(catalogState);
  // The flag needs an answered question: only a LOADED catalog can say that a
  // name is not declared.
  const declared =
    catalogState.status === 'loaded' ? offeredOptions(catalogState, NO_REGISTRY_ITEMS) : null;
  const [draft, setDraft] = React.useState('');

  const add = (names: string[]) => {
    const next = [...selected];
    for (const name of names) if (!next.includes(name)) next.push(name);
    if (next.length !== selected.length) onChange(next);
  };
  const commitDraft = () => {
    const names = draft.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    setDraft('');
    if (names.length) add(names);
  };
  const removeAt = (i: number) => {
    const next = selected.slice();
    next.splice(i, 1);
    onChange(next);
  };

  const addLabel = t(registry.addLabelKey, locale);
  const remaining = (declared ?? NO_REGISTRY_ITEMS).filter((o) => !selected.includes(o.name));
  const freeform = (
    <Input
      data-testid={`${testId}-freeform`}
      aria-label={addLabel}
      value={draft}
      disabled={loading}
      placeholder={loading ? t('engine.form.loadingOptions', locale) : t('engine.form.tagsPlaceholder', locale)}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          commitDraft();
        }
      }}
      onBlur={commitDraft}
    />
  );

  return (
    <div className="space-y-2" data-testid={testId} role="group" aria-labelledby={ariaLabelledBy}>
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {selected.map((name, i) => {
            const entry = declared?.find((o) => o.name === name);
            const notFound = declared !== null && !entry;
            return (
              <li
                key={name}
                data-not-found={notFound || undefined}
                className={
                  'inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs ' +
                  (notFound ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-input bg-muted')
                }
              >
                {entry?.label && entry.label !== name && <span>{entry.label}</span>}
                <code className="font-mono">{name}</code>
                {notFound && (
                  <span className="text-amber-700">{t('engine.form.notFound', locale)}</span>
                )}
                {!readOnly && (
                  <button
                    type="button"
                    aria-label={tFormat('engine.form.removeNamed', locale, { name })}
                    onClick={() => removeAt(i)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {loadError && <PickerLoadFailure message={loadError} testId={`${testId}-load-failed`} />}
      {!readOnly &&
        (declared && declared.length > 0 ? (
          <Select value="" onValueChange={(name) => add([name])} disabled={remaining.length === 0}>
            {/* No host id: the group above is the named surface, as on
                {@link FieldRefMultiWidget}'s add trigger. */}
            <SelectTrigger data-testid={`${testId}-add`} aria-label={addLabel}>
              <SelectValue
                placeholder={t(remaining.length ? registry.addPlaceholderKey : registry.allAddedKey, locale)}
              />
            </SelectTrigger>
            <SelectContent>
              {remaining.map((o) => (
                <SelectItem key={o.name} value={o.name}>
                  <span className="flex items-center gap-2">
                    {o.label && o.label !== o.name && <span>{o.label}</span>}
                    <code className="text-xs text-muted-foreground">{o.name}</code>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          freeform
        ))}
    </div>
  );
}

/** The `ref-multi:permission` registration: the permission-set registry (objectui#12126). */
const PERMISSION_REGISTRY: RefMultiRegistry = {
  type: 'permission',
  catalog: (context) => context?.permissionSets,
  addLabelKey: 'engine.form.addPermissionSetPlain',
  addPlaceholderKey: 'engine.form.addPermissionSet',
  allAddedKey: 'engine.form.allPermissionSetsAdded',
};

function RefMultiPermissionWidget(props: WidgetProps) {
  return <RefMultiWidget {...props} registry={PERMISSION_REGISTRY} />;
}

/* -------------------------------------------------------------------------- */
/* object-selector — multi-select object picker                               */
/* -------------------------------------------------------------------------- */

function ObjectSelectorWidget({
  id,
  ariaLabelledBy,
  required,
  value,
  onChange,
  readOnly,
  context,
  fieldSpec,
}: WidgetProps) {
  const locale = useMetadataLocale();
  const objectsState = context?.objectNames ?? NOT_ASKED;
  const multiple = fieldSpec?.multiple ?? false;
  
  // Parse value: string[], string (comma-separated), or empty
  const selectedValues = React.useMemo(() => {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(String);
    return String(value).split(',').map(s => s.trim()).filter(Boolean);
  }, [value]);

  const handleToggle = (objName: string) => {
    if (readOnly) return;
    
    if (!multiple) {
      onChange(objName);
      return;
    }

    const newSelection = selectedValues.includes(objName)
      ? selectedValues.filter(v => v !== objName)
      : [...selectedValues, objName];
    
    onChange(newSelection);
  };

  const handleRemove = (objName: string) => {
    if (readOnly) return;
    const newSelection = selectedValues.filter(v => v !== objName);
    onChange(multiple ? newSelection : '');
  };

  /* The freeform entry the FAILURE arm below renders in place of the picker
     (objectui#9931). Declared with the other hooks so it is unconditional —
     the arms below return early. It writes the SAME value shape the picker
     writes (an array when `multiple`, a bare name otherwise), so a name typed
     while the catalog is unknown round-trips exactly like a picked one. */
  const [draft, setDraft] = React.useState('');
  const commitDraft = (raw: string) => {
    const name = raw.trim();
    setDraft('');
    if (readOnly || !name) return;
    if (!multiple) {
      onChange(name);
      return;
    }
    if (!selectedValues.includes(name)) onChange([...selectedValues, name]);
  };

  if (isLoading(objectsState)) {
    return <Input {...controlNaming({ id, ariaLabelledBy, required })} value={t('engine.form.loadingObjects', locale)} readOnly disabled />;
  }

  // The object list FAILED to load (objectui#5170). The picker below would
  // otherwise render as a completed, empty dropdown — indistinguishable from an
  // install that genuinely has no objects. Already-selected values stay visible
  // and removable; only the "add" picker is replaced.
  /* Whatever is already selected, kept visible and removable in EVERY arm —
     the shape objectui#5227 landed for `field-selector`: a failed catalog must
     not also block authoring. */
  const selectedChips = selectedValues.length > 0 && (
    <div className="flex flex-wrap gap-2">
      {selectedValues.map(obj => (
        <div
          key={obj}
          className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-1 text-sm"
        >
          <span>{obj}</span>
          {!readOnly && (
            <button
              type="button"
              onClick={() => handleRemove(obj)}
              className="text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );

  // objectui#9931 — until this card the arm rendered chips plus the banner and
  // NOTHING labelable, so the host's `<label for>` dangled and the field had no
  // accessible name (in the card layout too, where the visible label is right
  // there). The chips answer "see and remove"; the freeform box is the arm's
  // primary control — the only way left to ADD a value — and it carries the
  // host naming. The in-file shape is `string-tags`: chips beside one entry box
  // that takes {@link controlNaming}. ⛔ Never the picker itself, disabled: see
  // the comment above.
  if (objectsState.status === 'error') {
    return (
      <div className="space-y-2">
        {selectedChips}
        <PickerLoadFailure message={objectsState.message} testId="object-selector-load-failed" />
        <Input
          {...controlNaming({ id, ariaLabelledBy, required })}
          data-testid="object-selector-freeform"
          value={draft}
          disabled={readOnly}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitDraft(draft);
            }
          }}
          onBlur={() => commitDraft(draft)}
        />
      </div>
    );
  }

  const names = offeredOptions(objectsState, NO_OBJECT_NAMES);

  return (
    <div className="space-y-2">
      {/* Selected items */}
      {selectedChips}

      {/* Object picker */}
      <Select
        value=""
        onValueChange={handleToggle}
        disabled={readOnly || names.length === 0}
      >
        <SelectTrigger {...controlNaming({ id, ariaLabelledBy, required })}>
          <SelectValue placeholder={multiple ? t('engine.form.addObjects', locale) : t('engine.form.selectObject', locale)} />
        </SelectTrigger>
        <SelectContent>
          {names.map(name => (
            <SelectItem key={name} value={name} disabled={!multiple && selectedValues.includes(name)}>
              {name}
              {selectedValues.includes(name) && ' ✓'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* field-selector — smart field picker (depends on selected object)          */
/* -------------------------------------------------------------------------- */

/** One entry of the `field-selector` catalog, as the REST endpoint spells it. */
interface FieldSelectorOption {
  name: string;
  label: string;
  type: string;
}

/** Stable identity for the non-`loaded` arms, so no consumer re-renders on a fresh `[]`. */
const EMPTY_FIELD_SELECTOR_OPTIONS: FieldSelectorOption[] = [];

/**
 * Fetch the bound object's field catalog for {@link FieldSelectorWidget}
 * (objectui#5227).
 *
 * This is the one loader in this family that does NOT go through
 * `MetadataClient` — it is a raw `fetch` to a REST path no other widget here
 * uses — which is why objectui#5170 missed it and why the option catalogs on
 * {@link WidgetContext} do not reach it. It had TWO ways to render
 * a fault as a measurement, and a union that guarded only the first would have
 * left the second wide open:
 *
 *   1. the `catch` wrote `setFields([])` — byte-identical to a successful
 *      response with no fields — and cleared the loading flag, so a dropped
 *      connection rendered as a completed, empty picker;
 *   2. it never checked `res.ok`, so a 4xx/5xx whose body happens to parse as
 *      JSON landed in the SUCCESS branch with `data.fields` undefined, and the
 *      old `|| []` rendered that refusal as "no fields" — worse than (1),
 *      because no error was ever raised for the `catch` to swallow.
 *
 * Both now leave through the same door: a throw, which {@link usePickerLoad}
 * can only turn into the `error` arm. The message follows the convention the
 * other raw-`fetch` callers in this package already use (`useRecordApprovals`,
 * `suggestedBindingsApi`, `studio-design/packages-io`): the server's own
 * message when it sent one, otherwise the status.
 */
async function fetchFieldSelectorOptions(objectName: string): Promise<FieldSelectorOption[]> {
  const res = await fetch(`/api/v1/objects/${objectName}/fields`);
  // Read the body BEFORE branching on `ok`: a refusal usually carries the more
  // useful sentence, and a non-JSON body must not be mistaken for a refusal
  // that said nothing (it still throws below — it just cannot add a cause).
  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) {
    const detail = payload?.error?.message ?? payload?.error ?? payload?.message;
    throw new Error(
      typeof detail === 'string' && detail ? detail : `HTTP ${res.status}`,
    );
  }
  // `payload.fields` narrows to the list; anything else is an answer we cannot
  // read, and the completed-load arm is the only one that reaches here.
  return Array.isArray(payload?.fields) ? (payload.fields as FieldSelectorOption[]) : [];
}

function FieldSelectorWidget({
  id,
  ariaLabelledBy,
  required,
  value,
  onChange,
  readOnly,
  fieldSpec,
  formData,
}: WidgetProps) {
  const locale = useMetadataLocale();

  // Resolve dependency: fieldSpec.dependsOn or fieldSpec.reference or 'objectName'
  const dependsOnRaw = fieldSpec?.dependsOn || fieldSpec?.reference || 'objectName';
  const dependsOnField = Array.isArray(dependsOnRaw) ? dependsOnRaw[0] : dependsOnRaw;
  const objectName = formData?.[dependsOnField] as string | undefined;

  // Four structurally distinct arms, one per `LoadState` — the shape this
  // directory landed for the other pickers (objectui#5170) and for the
  // References panel before them (objectui#5110). `null` while no object is
  // bound is the `idle` arm: a question never asked is not a failure.
  const loadFields = React.useMemo(
    () => (objectName ? () => fetchFieldSelectorOptions(objectName) : null),
    [objectName],
  );
  const fieldsState = usePickerLoad<FieldSelectorOption[]>(loadFields);
  const fields = loadedData(fieldsState, EMPTY_FIELD_SELECTOR_OPTIONS);
  const loadError = loadErrorOf(fieldsState);

  const multiple = fieldSpec?.multiple ?? false;

  // Parse value
  const selectedValues = React.useMemo(() => {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(String);
    return String(value).split(',').map(s => s.trim()).filter(Boolean);
  }, [value]);

  const handleToggle = (fieldName: string) => {
    if (readOnly) return;

    if (!multiple) {
      onChange(fieldName);
      return;
    }

    const newSelection = selectedValues.includes(fieldName)
      ? selectedValues.filter(v => v !== fieldName)
      : [...selectedValues, fieldName];

    onChange(newSelection);
  };

  const handleRemove = (fieldName: string) => {
    if (readOnly) return;
    const newSelection = selectedValues.filter(v => v !== fieldName);
    onChange(multiple ? newSelection : '');
  };

  /* The freeform entry the FAILURE arm below renders in place of the picker
     (objectui#9931), in the same shape {@link ObjectSelectorWidget} uses.
     Declared with the other hooks so it is unconditional — the arms below
     return early. */
  const [draft, setDraft] = React.useState('');
  const commitDraft = (raw: string) => {
    const name = raw.trim();
    setDraft('');
    if (readOnly || !name) return;
    if (!multiple) {
      onChange(name);
      return;
    }
    if (!selectedValues.includes(name)) onChange([...selectedValues, name]);
  };

  if (!objectName) {
    return <Input {...controlNaming({ id, ariaLabelledBy, required })} value={t('engine.form.selectObjectFirst', locale)} readOnly disabled />;
  }

  if (isLoading(fieldsState)) {
    return <Input {...controlNaming({ id, ariaLabelledBy, required })} value={t('engine.form.loadingFields', locale)} readOnly disabled />;
  }

  /* Whatever is already stored, kept visible and removable in EVERY completed
     arm — a failed catalog must not also block authoring. */
  const selectedChips = selectedValues.length > 0 && (
    <div className="flex flex-wrap gap-2">
      {selectedValues.map(field => {
        const fieldMeta = fields.find(f => f.name === field);
        return (
          <div
            key={field}
            className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-1 text-sm"
          >
            <span>{fieldMeta?.label || field}</span>
            <code className="text-xs text-muted-foreground">{fieldMeta?.type}</code>
            {!readOnly && (
              <button
                type="button"
                onClick={() => handleRemove(field)}
                className="text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );

  // The catalog FAILED to load — not the same fact as "this object has no
  // fields". The picker below is REPLACED rather than decorated (the shape
  // `field-ref` uses): with no options it could only render as a dead,
  // disabled dropdown next to a banner saying the options are unknown, which
  // is the very conflation this arm exists to end.
  //
  // objectui#9931 — replacing the picker left this arm with no labelable
  // element at all, so the host's `<label for>` dangled and the field lost its
  // accessible name. The replacement stands; what is added is the one control
  // the `'control'` declaration requires in EVERY branch — a freeform entry
  // that carries {@link controlNaming} and is the arm's only way to add a
  // field name while the catalog is unknown. ⛔ Still not the dropdown: the
  // paragraph above is why.
  if (loadError) {
    return (
      <div className="space-y-2">
        {selectedChips}
        <PickerLoadFailure message={loadError} testId="field-selector-load-failed" />
        <Input
          {...controlNaming({ id, ariaLabelledBy, required })}
          data-testid="field-selector-freeform"
          value={draft}
          disabled={readOnly}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitDraft(draft);
            }
          }}
          onBlur={() => commitDraft(draft)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Selected fields */}
      {selectedChips}

      {/* Field picker. `fields.length === 0` here means a load that COMPLETED
          and found nothing — the disabled trigger is that measurement, and it
          is now reachable only from the `loaded` arm. */}
      <Select
        value=""
        onValueChange={handleToggle}
        disabled={readOnly || fields.length === 0}
      >
        <SelectTrigger {...controlNaming({ id, ariaLabelledBy, required })}>
          <SelectValue placeholder={multiple ? t('engine.form.addFields', locale) : t('engine.form.selectField', locale)} />
        </SelectTrigger>
        <SelectContent>
          {fields.map(f => (
            <SelectItem key={f.name} value={f.name} disabled={!multiple && selectedValues.includes(f.name)}>
              <div className="flex items-center gap-2">
                <span>{f.label || f.name}</span>
                <code className="text-xs text-muted-foreground">{f.type}</code>
                {selectedValues.includes(f.name) && ' ✓'}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* master-detail — inline row editor for array-of-object fields               */
/* -------------------------------------------------------------------------- */

function MasterDetailWidget({
  schema,
  value,
  onChange,
  readOnly,
  context,
  ariaLabelledBy,
}: WidgetProps) {
  const locale = useMetadataLocale();
  // Unwrap anyOf/oneOf: pick the first array-of-object branch.
  let resolved = schema as Record<string, any> | undefined;
  if (resolved?.anyOf || resolved?.oneOf) {
    const branches = (resolved.anyOf ?? resolved.oneOf) as any[];
    const objBranch = branches.find(
      (b) => b?.type === 'array' && b?.items?.type === 'object',
    );
    if (objBranch) resolved = { ...resolved, ...objBranch };
  }
  const items = (resolved?.items ?? {}) as Record<string, any>;
  const itemProps = (items.properties ?? {}) as Record<string, any>;
  const required = new Set<string>(
    Array.isArray(items.required) ? items.required : [],
  );
  const rows = Array.isArray(value) ? (value as any[]) : [];
  const cols = Object.keys(itemProps);

  if (cols.length === 0) {
    // Falls back to JSON if the array items aren't a typed object.
    return (
      <div
        role="group"
        aria-labelledby={ariaLabelledBy}
        className="rounded border border-dashed border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-300"
      >
        {t('engine.form.masterDetailSchemaError', locale)}
      </div>
    );
  }

  function updateRow(idx: number, patch: Record<string, unknown>) {
    const next = rows.slice();
    next[idx] = { ...(next[idx] ?? {}), ...patch };
    onChange(next);
  }
  function addRow() {
    onChange([...rows, {}]);
  }
  function removeRow(idx: number) {
    const next = rows.slice();
    next.splice(idx, 1);
    onChange(next);
  }

  return (
    // A table of per-cell inputs plus row actions — a composite, so the host's
    // visible label names this container by IDREF (objectui#4871). Same shape
    // and same reason as `grid`'s `labelling: 'group'` in packages/fields
    // (objectui#4857): no `<label for>` can reach a table.
    <div className="space-y-2" role="group" aria-labelledby={ariaLabelledBy}>
      <div className="overflow-x-auto rounded border border-border/40">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              {cols.map((c) => (
                <th
                  key={c}
                  className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground"
                >
                  {/* objectui#8218 — a bare `?? c` printed the raw JSON Schema
                      key ("actionUrl", "actionType") as if it were a column
                      name, in every locale: the item property schemas the spec
                      derives carry `description` but no `title`, so this arm is
                      the one that always runs for `dashboard.header.actions[]`.
                      Humanising it is the same convention this tree already
                      applies everywhere else a title is absent
                      (`json-schema-to-fields.ts`: `prop.title || humanizeKey`;
                      `SchemaForm`'s `prettify` for section labels), NOT a
                      lenient contract fallback — `title` is an OPTIONAL
                      annotation, so its absence is not off-spec metadata and
                      the renderer has to choose something. The real fix for the
                      LOCALIZED column name is upstream and tracked there; see
                      the PR body. */}
                  {(itemProps[c]?.title as string) ?? humanizeKey(c)}
                  {required.has(c) && (
                    <span className="text-destructive ml-0.5">*</span>
                  )}
                </th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={cols.length + 1}
                  className="px-2 py-3 text-center text-xs text-muted-foreground"
                >
                  {t('engine.form.noRows', locale)}
                </td>
              </tr>
            )}
            {rows.map((row, idx) => (
              <tr key={idx} className="border-t border-border/30">
                {cols.map((c) => (
                  <td key={c} className="p-1">
                    <RowCell
                      schema={itemProps[c]}
                      value={(row ?? {})[c]}
                      readOnly={readOnly}
                      context={context}
                      onChange={(v) => updateRow(idx, { [c]: v })}
                    />
                  </td>
                ))}
                <td className="p-1 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeRow(idx)}
                    disabled={readOnly}
                    className="h-7 w-7 p-0"
                    aria-label={t('engine.form.removeRow', locale)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addRow}
        disabled={readOnly}
      >
        <Plus className="h-3.5 w-3.5 mr-1" /> {t('engine.form.addRow', locale)}
      </Button>
    </div>
  );
}

function RowCell({
  schema,
  value,
  readOnly,
  context,
  onChange,
}: {
  schema: Record<string, any>;
  value: unknown;
  readOnly?: boolean;
  context?: WidgetContext;
  onChange: (v: unknown) => void;
}) {
  // ref:object hint inside a row cell
  if (schema?.widget === 'ref:object') {
    return (
      <RefObjectWidget
        schema={schema}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        context={context}
      />
    );
  }
  // ref:component hint inside a row cell (page variable `source` picker)
  if (schema?.widget === 'ref:component') {
    return (
      <RefComponentWidget
        schema={schema}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        context={context}
      />
    );
  }
  // enum → dropdown
  const enumVals = schema?.enum as unknown[] | undefined;
  if (Array.isArray(enumVals) && enumVals.length > 0) {
    return (
      <Select
        value={value == null ? '' : String(value)}
        onValueChange={(v) => onChange(v || undefined)}
        disabled={readOnly}
      >
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          {enumVals.map((o) => (
            <SelectItem key={String(o)} value={String(o)}>
              {String(o)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  // boolean → checkbox-ish
  if (schema?.type === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={!!value}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4"
      />
    );
  }
  // number — same treatment as `SchemaForm`'s own numeric face (objectui#8218):
  // the schema's `default` greys in as a placeholder so an empty box reads
  // "using the default" rather than "unknown", and `minimum`/`maximum`/
  // `multipleOf` reach the control instead of being dropped on the floor. Kept
  // in step with that branch deliberately — these are the two numeric inputs
  // the property panel renders, and a bound honoured in one and ignored in the
  // other is worse than neither.
  if (schema?.type === 'number' || schema?.type === 'integer') {
    const num = (key: string): number | undefined => {
      const raw = (schema as Record<string, unknown> | undefined)?.[key];
      return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
    };
    const defaultValue = num('default');
    return (
      <Input
        type="number"
        value={value == null ? '' : String(value)}
        placeholder={defaultValue == null ? undefined : String(defaultValue)}
        min={num('minimum')}
        max={num('maximum')}
        step={num('multipleOf')}
        disabled={readOnly}
        onChange={(e) => {
          const n = e.target.valueAsNumber;
          onChange(Number.isFinite(n) ? n : undefined);
        }}
        className="h-8 text-xs"
      />
    );
  }
  // default: text
  return (
    <Input
      value={value == null ? '' : String(value)}
      disabled={readOnly}
      onChange={(e) => onChange(e.target.value || undefined)}
      className="h-8 text-xs"
    />
  );
}

/* -------------------------------------------------------------------------- */
/* string-tags — chip input for string[] (e.g. searchableFields)              */
/* -------------------------------------------------------------------------- */

function StringTagsWidget({
  id,
  ariaLabelledBy,
  required,
  value,
  onChange,
  readOnly,
}: WidgetProps) {
  const locale = useMetadataLocale();
  const tags = Array.isArray(value) ? (value as string[]) : [];
  const [draft, setDraft] = React.useState('');

  function add(raw: string) {
    const parts = raw
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...tags];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    onChange(next);
    setDraft('');
  }
  function remove(idx: number) {
    const next = tags.slice();
    next.splice(idx, 1);
    onChange(next);
  }

  return (
    <div className="rounded border border-input bg-background p-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {tags.map((t, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs"
          >
            <span className="font-mono">{t}</span>
            {!readOnly && (
              <button
                type="button"
                aria-label={tFormat('engine.form.removeNamed', locale, { name: t })}
                onClick={() => remove(i)}
                className="text-muted-foreground hover:text-destructive"
              >
                ×
              </button>
            )}
          </span>
        ))}
        <input
          {...controlNaming({ id, ariaLabelledBy, required })}
          type="text"
          value={draft}
          disabled={readOnly}
          placeholder={tags.length === 0 ? t('engine.form.tagsPlaceholder', locale) : ''}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add(draft);
            } else if (e.key === 'Backspace' && !draft && tags.length > 0) {
              remove(tags.length - 1);
            }
          }}
          onBlur={() => draft && add(draft)}
          className="min-w-[8rem] flex-1 bg-transparent text-sm outline-none"
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* multiselect — pick from a fixed option set (array of enum)                 */
/* -------------------------------------------------------------------------- */

/** "grid" → "Grid", "start_date" → "Start Date". */
function humanizeOption(v: string): string {
  return v
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Toggleable option set for `array<enum>` fields (e.g.
 * `appearance.allowedVisualizations`). Options come from the JSON Schema's
 * `items.enum` (or `fieldSpec.options`); the value is the selected subset
 * as a `string[]`, preserving the enum's declared order. Replaces the
 * free-text tag input the generic array renderer fell back to — the author
 * picks from the real allowed values instead of typing (and mistyping) them.
 */
function MultiSelectWidget({ value, onChange, readOnly, schema, fieldSpec, formData, ariaLabelledBy }: WidgetProps) {
  const hostScope = usePredicateScope();
  // Prefer explicit form options; else the JSON Schema enum on the items.
  //
  // ⚠️ RAW — every per-option `visibleWhen` is carried through untouched
  // (objectui#6247). This list answers the two questions that must NOT depend
  // on a predicate: whether this widget renders at all (the degradation branch
  // below) and what ORDER a selection is stored in (`toggle`). Only
  // `renderedOptions` is filtered.
  const options: Array<{ label: string; value: string; visibleWhen?: VisibilityPredicate }> =
    React.useMemo(() => {
      if (Array.isArray(fieldSpec?.options) && fieldSpec!.options!.length) {
        return fieldSpec!.options!.map((o) => ({ label: o.label, value: o.value, visibleWhen: o.visibleWhen }));
      }
      const enumVals: unknown =
        schema?.items?.enum ?? schema?.enum ?? [];
      return (Array.isArray(enumVals) ? enumVals : [])
        .filter((v): v is string => typeof v === 'string')
        .map((v) => ({ label: humanizeOption(v), value: v }));
    }, [fieldSpec, schema]);

  // The CONTENT half: what the author is offered right now.
  const renderedOptions = React.useMemo(
    () => visibleOptions(options, buildPredicateCtx(formData, hostScope)),
    [options, formData, hostScope],
  );

  const selected = React.useMemo(
    () => (Array.isArray(value) ? (value as unknown[]).filter((v): v is string => typeof v === 'string') : []),
    [value],
  );

  function toggle(opt: string) {
    if (readOnly) return;
    // Keep selection ordered by the option list so behaviour is stable
    // (e.g. allowedVisualizations[0] = the default/initial visualization).
    const set = new Set(selected);
    if (set.has(opt)) set.delete(opt);
    else set.add(opt);
    // ⚠️ RAW list, not the rendered one (objectui#6247, Fork C → C1: no
    // pruning). Ordering against the filtered list would DROP any already-
    // selected value whose option is currently hidden — pruning authored
    // metadata through the back door, on the next unrelated click, with no
    // author action that says "remove this". A hidden-but-selected value
    // survives; it is simply not offered again.
    const next = options.map((o) => o.value).filter((v) => set.has(v));
    onChange(next.length ? next : undefined);
  }

  // ⚠️ RAW length (objectui#6247, Fork B → B1). Testing the FILTERED length
  // here would make "withdraw every option" degrade to the free-text tag
  // editor — the opposite of the narrowing the author wrote, and a change of
  // naming channel that objectui#4871 removed from this file. A field whose
  // options are all withdrawn stays this widget and renders an empty group.
  if (options.length === 0) {
    // No known option set — degrade to the comma-tag editor so the field
    // is still editable rather than rendering an empty box.
    //
    // The degradation stays INSIDE this widget's named group rather than
    // handing the tag editor the host id: the declaration
    // (`multiselect: 'group'`) is read by the host BEFORE the option list is
    // known, so a fallback that changed naming channel would be exactly the
    // runtime self-selection objectui#4871 removed from `color-picker`. The
    // group is named; the tag input inside it is a sub-control.
    return (
      <div role="group" aria-labelledby={ariaLabelledBy}>
        <StringTagsWidget value={value} onChange={onChange} readOnly={readOnly} schema={schema} fieldSpec={fieldSpec} />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={ariaLabelledBy}>
      {renderedOptions.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            role="checkbox"
            aria-checked={on}
            disabled={readOnly}
            onClick={() => toggle(o.value)}
            className={
              'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ' +
              (on
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-input bg-background text-muted-foreground hover:text-foreground hover:bg-muted') +
              (readOnly ? ' opacity-60 cursor-not-allowed' : '')
            }
          >
            <span
              aria-hidden
              className={
                'flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border text-[9px] leading-none ' +
                (on ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40')
              }
            >
              {on ? '✓' : ''}
            </span>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}


/* -------------------------------------------------------------------------- */
/* field-ref / field-multi — pick object field(s) from the bound object       */
/* -------------------------------------------------------------------------- */

const NO_FIELD = '__none__';

/**
 * Single object-field picker. Used for View config props that reference one
 * field by name (titleField, groupByField, startDateField, colorField,
 * xAxisField, …). Field list comes from `context.objectFields`; a value not
 * present in the catalog is still shown so stale/custom values survive.
 */
function FieldRefWidget({ id, ariaLabelledBy, required, value, onChange, readOnly, context }: WidgetProps) {
  const locale = useMetadataLocale();
  const fieldsState = context?.objectFields ?? NOT_ASKED;
  const current = value == null ? '' : String(value);
  // Four structurally distinct arms, one per `LoadState` (objectui#5170), so a
  // fault can never be read as a measurement. Note what the empty placeholder
  // below claims: "No object bound" — on a failed load an object IS bound, so
  // that sentence names a cause that is not the real one, which is why the
  // failure arm replaces the picker rather than decorating it (the shape #5110
  // landed for the References panel).
  //
  // objectui#9931 — the failure arm is a branch this widget can render, so the
  // `'control'` declaration in {@link WIDGET_LABELLING} governs it like every
  // other: the host's `<label for>` must land on a labelable element here too.
  // `PickerLoadFailure` is a `div[role="status"]`, which no `for` can address,
  // so the banner is rendered BESIDE a freeform box that carries the naming and
  // keeps the stored field name visible and editable. That is the shape
  // `ref:object` already uses on this same arm, and the one
  // {@link PickerLoadFailure}'s own contract states for every picker — "keeps
  // whatever control lets the author see and edit the value already stored,
  // because a failed catalog must not also block authoring". ⛔ NOT the picker
  // itself: rendering a dead, option-less dropdown is the conflation this arm
  // exists to end.
  if (fieldsState.status === 'error') {
    return (
      <div className="space-y-1.5">
        <PickerLoadFailure message={fieldsState.message} testId="field-ref-load-failed" />
        <Input
          {...controlNaming({ id, ariaLabelledBy, required })}
          value={current}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }
  // Same in-file precedent as `ref:object` / `object-selector`: an unanswered
  // question renders as "asking", never as an answer of none.
  if (isLoading(fieldsState)) {
    return <Input {...controlNaming({ id, ariaLabelledBy, required })} value={t('engine.form.loadingOptions', locale)} readOnly disabled />;
  }
  const fields = offeredOptions(fieldsState, NO_OBJECT_FIELDS);
  const inCatalog = !current || fields.some((f) => f.name === current);
  return (
    <Select
      value={current || NO_FIELD}
      onValueChange={(v) => onChange(v === NO_FIELD ? '' : v)}
      disabled={readOnly}
    >
      <SelectTrigger {...controlNaming({ id, ariaLabelledBy, required })}>
        <SelectValue
          placeholder={fields.length ? t('engine.form.selectField', locale) : t('engine.form.noObjectBound', locale)}
        />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_FIELD}>
          <span className="text-muted-foreground">{t('engine.form.none', locale)}</span>
        </SelectItem>
        {!inCatalog && current && (
          <SelectItem value={current}>
            <span className="font-mono">{current}</span>
            <span className="ml-2 text-xs text-muted-foreground">{t('engine.form.notInObject', locale)}</span>
          </SelectItem>
        )}
        {fields.map((f) => (
          <SelectItem key={f.name} value={f.name}>
            <span className="flex items-center gap-2">
              <span>{f.label || f.name}</span>
              <code className="text-xs text-muted-foreground">{f.name}</code>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Resolve a stored `sourceView` value against a source object's view catalog,
 * mirroring the runtime resolver (InterfaceListPage.resolveSourceView): a value
 * resolves if it's an exact view name, a bare name matching a view's
 * `<object>.<name>` suffix, or the special `default`/`list` (→ object default
 * view). `showStored` is true when the stored value needs a synthesized option
 * (i.e. it isn't already an exact catalog entry). Exported for unit tests.
 */
export function resolveStoredViewRef(
  views: Array<{ name: string; label?: string }>,
  current: string,
): { exact?: { name: string; label?: string }; suffixMatch?: { name: string; label?: string }; isSpecial: boolean; resolves: boolean; showStored: boolean } {
  const exact = current ? views.find((v) => v.name === current) : undefined;
  const suffixMatch = current && !exact ? views.find((v) => v.name.endsWith(`.${current}`)) : undefined;
  const isSpecial = current === 'default' || current === 'list';
  return { exact, suffixMatch, isSpecial, resolves: !!exact || !!suffixMatch || isSpecial, showStored: !!current && !exact };
}

/**
 * Single view picker for `interfaceConfig.sourceView`. Views come from
 * `context.objectViews` (the source object's views, loaded from the object
 * named by the sibling `source` field). A value not present in the catalog is
 * still shown so stale/custom names survive; clearing to "None" omits the
 * field, which the protocol treats as the object's default view. Replaces the
 * free-text input where an author could type a non-existent view name.
 */
function ViewRefWidget({ id, ariaLabelledBy, required, value, onChange, readOnly, context }: WidgetProps) {
  const locale = useMetadataLocale();
  const viewsState = context?.objectViews ?? NOT_ASKED;
  const current = value == null ? '' : String(value);
  // objectui#5170 — same four arms as {@link FieldRefWidget}. The empty
  // placeholder says "No object bound", which is false when the object IS bound
  // and only its view catalog could not be fetched.
  //
  // objectui#9931 — same reading as {@link FieldRefWidget}'s failure arm: a
  // branch this widget can render is a branch the `'control'` declaration
  // covers, so the freeform box beside the banner carries the host naming and
  // keeps the stored view name editable while the catalog is unknown.
  if (viewsState.status === 'error') {
    return (
      <div className="space-y-1.5">
        <PickerLoadFailure message={viewsState.message} testId="view-ref-load-failed" />
        <Input
          {...controlNaming({ id, ariaLabelledBy, required })}
          value={current}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      </div>
    );
  }
  if (isLoading(viewsState)) {
    return <Input {...controlNaming({ id, ariaLabelledBy, required })} value={t('engine.form.loadingOptions', locale)} readOnly disabled />;
  }
  const views = offeredOptions(viewsState, NO_OBJECT_VIEWS);
  // Mirror the runtime resolver (InterfaceListPage.resolveSourceView): a stored
  // value resolves if it's an exact view name, OR a bare name matching a view's
  // `<object>.<name>` suffix, OR the special `default`/`list` (→ object default
  // view). Only a value that resolves to NOTHING gets the "(not in object)" tag —
  // so a working bare value like `default` is no longer mislabelled.
  const { suffixMatch, resolves, showStored } = resolveStoredViewRef(views, current);
  return (
    <Select
      value={current || NO_FIELD}
      onValueChange={(v) => onChange(v === NO_FIELD ? undefined : v)}
      disabled={readOnly}
    >
      <SelectTrigger {...controlNaming({ id, ariaLabelledBy, required })}>
        <SelectValue
          placeholder={views.length ? t('engine.form.selectEllipsis', locale) : t('engine.form.noObjectBound', locale)}
        />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_FIELD}>
          <span className="text-muted-foreground">{t('engine.form.none', locale)}</span>
        </SelectItem>
        {showStored && (
          <SelectItem value={current}>
            <span className="flex items-center gap-2">
              <span>{suffixMatch?.label || current}</span>
              <code className="text-xs text-muted-foreground">{suffixMatch ? `\u2192 ${suffixMatch.name}` : current}</code>
              {!resolves && (
                <span className="ml-1 text-xs text-muted-foreground">{t('engine.form.notInObject', locale)}</span>
              )}
            </span>
          </SelectItem>
        )}
        {views.map((v) => (
          <SelectItem key={v.name} value={v.name}>
            <span className="flex items-center gap-2">
              <span>{v.label || v.name}</span>
              <code className="text-xs text-muted-foreground">{v.name}</code>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Ordered multi object-field picker. Used for props that reference a list of
 * fields (kanban card `columns`, gallery `visibleFields`, chart
 * `yAxisFields`, `searchableFields`, …). Preserves order; supports reorder
 * and removal; values outside the catalog are retained.
 */
function FieldRefMultiWidget({ value, onChange, readOnly, context, ariaLabelledBy, copilotAdded }: WidgetProps) {
  const locale = useMetadataLocale();
  const fieldsState = context?.objectFields ?? NOT_ASKED;
  // objectui#5228 — the failure is decided here, before the catalog is read:
  // `offeredOptions` below does not accept a state that still carries the
  // `error` arm, so the add picker cannot be fed a list without this line.
  const loadError = loadErrorOf(fieldsState);
  const fields = fieldsState.status === 'error'
    ? NO_OBJECT_FIELDS
    : offeredOptions(fieldsState, NO_OBJECT_FIELDS);
  const selected: string[] = Array.isArray(value)
    ? value.map(String)
    : typeof value === 'string' && value
      ? value.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
  const labelFor = (name: string) => fields.find((f) => f.name === name)?.label || name;
  const remaining = fields.filter((f) => !selected.includes(f.name));

  const add = (name: string) => {
    if (!selected.includes(name)) onChange([...selected, name]);
  };
  const removeAt = (i: number) => {
    const next = selected.slice();
    next.splice(i, 1);
    onChange(next);
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= selected.length) return;
    const next = selected.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    // An ORDERED SET, not a single control: reorder/remove buttons per chip plus
    // an auxiliary "add" picker. Measured for objectui#4871's ledger — the add
    // picker (the only element that ever carried the host id) is gated behind
    // `!readOnly`, so a `control` declaration was true in the editable state and
    // DANGLING in the read-only one. A declaration that is conditionally true is
    // the shape the #4871 ruling removed, so the whole set is the named surface.
    <div className="space-y-2" role="group" aria-labelledby={ariaLabelledBy}>
      {selected.length > 0 && (
        <div className="space-y-1">
          {selected.map((name, i) => (
            <div
              key={name}
              className="flex items-center gap-1 rounded border border-input bg-background px-2 py-1 text-sm"
            >
              <span className="flex-1 truncate">
                {labelFor(name)}
                <code className="ml-2 text-xs text-muted-foreground">{name}</code>
              </span>
              {copilotAdded?.has(name) && (
                <DraftChip locale={locale} testId="studio-draft-element-chip" of={name} />
              )}
              {!readOnly && (
                <>
                  <button
                    type="button"
                    aria-label={t('engine.form.moveUp', locale)}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    className="px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={t('engine.form.moveDown', locale)}
                    disabled={i === selected.length - 1}
                    onClick={() => move(i, 1)}
                    className="px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={tFormat('engine.form.removeNamed', locale, { name })}
                    onClick={() => removeAt(i)}
                    className="px-1 text-muted-foreground hover:text-destructive"
                  >
                    ×
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {/* objectui#5170 — the field catalog failed to load, so the add picker
          below is empty for a reason that has nothing to do with the object.
          Selected chips above stay editable. */}
      {loadError && (
        <PickerLoadFailure message={loadError} testId="field-multi-load-failed" />
      )}
      {!readOnly && (
        <Select value="" onValueChange={add} disabled={remaining.length === 0}>
          {/* No host id here: the group above is the named surface, and an id
              on this auxiliary trigger would make the host's `for` resolve to
              "add a field" — a label click would open the picker rather than
              name the set (objectui#4871, the #4857 `grid` reading). */}
          <SelectTrigger aria-label={t('engine.form.addField', locale)}>
            <SelectValue
              placeholder={
                loadError
                  ? t('engine.form.optionsLoadFailedTitle', locale)
                  : fields.length
                    ? remaining.length
                      ? t('engine.form.addField', locale)
                      : t('engine.form.allFieldsAdded', locale)
                    : t('engine.form.noObjectBound', locale)
              }
            />
          </SelectTrigger>
          <SelectContent>
            {remaining.map((f) => (
              <SelectItem key={f.name} value={f.name}>
                <span className="flex items-center gap-2">
                  <span>{f.label || f.name}</span>
                  <code className="text-xs text-muted-foreground">{f.name}</code>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}


/* -------------------------------------------------------------------------- */
/* icon — searchable Lucide icon picker                                       */
/* -------------------------------------------------------------------------- */

// Lucide ships ~1500+ kebab-case icon names; freeze once for O(1) reuse.
const LUCIDE_ICON_NAMES: readonly string[] = iconNames as string[];
const LUCIDE_ICON_SET: Set<string> = new Set(LUCIDE_ICON_NAMES);
// Cap the rendered grid — each cell mounts a lazily-loaded icon, so showing all
// ~1500 at once would fire a flood of chunk requests. The search box narrows it.
const ICON_RESULT_LIMIT = 120;

/**
 * Searchable icon picker for `widget: 'icon'` string fields (page/app/object
 * `icon`). Replaces the raw text input where an author had to know and type a
 * Lucide name. The trigger shows a live preview of the current icon; opening it
 * reveals a search box + a grid of matching icons (preview + name). Selecting
 * writes the kebab-case name string.
 *
 * Out-of-catalog values survive: a name that isn't a Lucide icon (e.g. one from
 * another library, or a typo to be fixed later) is still shown on the trigger as
 * plain text (LazyIcon degrades to a fallback glyph) and is offered as the first
 * "keep" option so re-opening the picker never silently drops it.
 *
 * Such a name is also WARNED about, inline under the trigger and on every mount
 * of this widget (objectui#12531): the resolvers that draw a stored icon name
 * degrade an unknown one to their fallback glyph without a word, so this
 * warning is the one place an author learns the name draws nothing of its own.
 * The trigger points at it through `aria-describedby`.
 *
 * Built inline (no Radix portal) so the search + grid render eagerly — the same
 * jsdom-friendly choice the other pickers' tests rely on.
 */
export function IconPickerWidget({ id, ariaLabelledBy, required, value, onChange, readOnly }: WidgetProps) {
  const locale = useMetadataLocale();
  const current = value == null ? '' : String(value);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const warningId = React.useId();

  const currentKebab = current ? toKebabIconName(current) : '';
  const inCatalog = !current || LUCIDE_ICON_SET.has(currentKebab);

  const q = toKebabIconName(query.trim());
  const allMatches = React.useMemo(
    () => (q ? LUCIDE_ICON_NAMES.filter((n) => n.includes(q)) : LUCIDE_ICON_NAMES),
    [q],
  );
  const results = allMatches.slice(0, ICON_RESULT_LIMIT);
  const truncated = allMatches.length > results.length;

  const select = (name: string | undefined) => {
    onChange(name || undefined);
    setOpen(false);
    setQuery('');
  };

  return (
    <>
      <button
        {...controlNaming({ id, ariaLabelledBy, required })}
        type="button"
        role="combobox"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-describedby={inCatalog ? undefined : warningId}
        disabled={readOnly}
        onClick={() => !readOnly && setOpen(true)}
        className="flex w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm text-left disabled:cursor-not-allowed disabled:opacity-60"
      >
        <LazyIcon name={inCatalog ? current : undefined} className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className={'flex-1 truncate ' + (current ? 'font-mono' : 'text-muted-foreground')}>
          {current || t('engine.form.selectEllipsis', locale)}
        </span>
        <ChevronsUpDown aria-hidden className="h-3.5 w-3.5 shrink-0 opacity-50" />
      </button>
      {!inCatalog && (
        <p
          id={warningId}
          data-testid="icon-picker-unknown-name"
          className="mt-1 flex items-start gap-1 text-[11px] leading-snug text-amber-700 dark:text-amber-400"
        >
          <AlertTriangle aria-hidden className="mt-px h-3 w-3 shrink-0" />
          <span>{tFormat('engine.form.unknownIcon', locale, { name: current })}</span>
        </p>
      )}

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('engine.form.chooseIcon', locale)}</DialogTitle>
          </DialogHeader>

          <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2">
            <Search aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              type="text"
              autoFocus
              value={query}
              aria-label={t('engine.form.searchIcons', locale)}
              placeholder={t('engine.form.searchIcons', locale)}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>

          <div
            id={id ? `${id}-listbox` : undefined}
            role="listbox"
            className="grid max-h-[52vh] grid-cols-6 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-8"
          >
            {current && (
              <button
                type="button"
                role="option"
                aria-selected={false}
                title={t('engine.form.none', locale)}
                onClick={() => select(undefined)}
                className="flex aspect-square flex-col items-center justify-center gap-1 rounded border border-dashed border-border p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <Trash2 className="h-4 w-4" />
                <span className="w-full truncate text-center text-[9px] leading-tight">{t('engine.form.noneShort', locale)}</span>
              </button>
            )}
            {!inCatalog && current && (
              <button
                type="button"
                role="option"
                aria-selected
                title={current}
                onClick={() => select(current)}
                className="flex aspect-square flex-col items-center justify-center gap-1 rounded bg-accent p-1 text-accent-foreground ring-1 ring-primary"
              >
                <LazyIcon name={undefined} className="h-4 w-4" />
                <span className="w-full truncate text-center text-[9px] leading-tight">{current}</span>
              </button>
            )}
            {results.map((name) => {
              const selected = name === currentKebab;
              return (
                <button
                  key={name}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  title={name}
                  onClick={() => select(name)}
                  className={
                    'flex aspect-square flex-col items-center justify-center gap-1 rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground ' +
                    (selected ? 'bg-accent text-accent-foreground ring-1 ring-primary' : '')
                  }
                >
                  <LazyIcon name={name} className="h-5 w-5" />
                  <span className="w-full truncate text-center text-[9px] leading-tight">{name}</span>
                </button>
              );
            })}
            {results.length === 0 && (
              <p className="col-span-full px-2 py-6 text-center text-sm text-muted-foreground">
                {t('engine.form.noMatchingIcons', locale)}
              </p>
            )}
          </div>

          {truncated && (
            <p className="text-center text-xs text-muted-foreground">
              {tFormat('engine.form.iconsTruncated', locale, { shown: results.length, total: allMatches.length })}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* registry                                                                   */
/* -------------------------------------------------------------------------- */

// NOTE: The "airtable" / "object-fields-table" widgets used to live here.
// Removed in the Plan C refactor (see ADR-0014 §"Why not Airtable mode"):
// editing fields-as-columns can only honestly expose a tiny subset of the
// Field protocol. Record-typed metadata fields (including object.fields)
// now use the built-in `RecordField` engine in SchemaForm, which renders
// inline cards with the full per-entry sub-form derived from the protocol.

/* -------------------------------------------------------------------------- */
/* FilterModeWidget — ADR-0047 end-user filter element selector.              */
/*                                                                            */
/* Airtable-parity authoring control for `interfaceConfig.userFilters`. The   */
/* protocol stores "no filter bar" as ABSENCE of the field (omit-is-none),    */
/* not a literal `element: 'none'` — so this widget exposes None as a         */
/* first-class, selectable UI state that maps to `onChange(undefined)`,       */
/* keeping the metadata clean while giving authors the explicit tri/quad-     */
/* state selector they expect. Dropdown/Toggle modes edit the exposed fields  */
/* inline (matching Airtable's "Dropdowns: <fields>").                        */
/* -------------------------------------------------------------------------- */

// `toggle` remains a valid (deprecated) element in the protocol for
// back-compat, but is intentionally NOT offered as an authoring mode here:
// it overlaps tabs (presets) + dropdown (per-field values) without adding
// expressive power, needs per-field defaultValues to be useful, and the
// matching tool (Airtable) converged on None/Tabs/Dropdown. See ADR-0047 §3.4a.
type UFElement = 'dropdown' | 'tabs' | 'toggle';
type UFMode = 'dropdown' | 'tabs';
interface UFField { field: string; showCount?: boolean; label?: string; [k: string]: unknown }
interface UFRule { field: string; operator: string; value?: unknown }
interface UFTab { name: string; label: string; icon?: string; filter?: UFRule[]; isDefault?: boolean; [k: string]: unknown }
interface UFValue { element?: UFElement; fields?: UFField[]; tabs?: unknown[]; showAllRecords?: boolean; [k: string]: unknown }

// objectui#8218 — a module-level table cannot resolve a locale, so it carries
// the translation KEY and the render site resolves it. Hard-coding the English
// here is what put "None / Tabs / Dropdown" inside an otherwise-Chinese panel.
const FILTER_MODES: Array<{ key: 'none' | UFMode; labelKey: string }> = [
  { key: 'none', labelKey: 'engine.form.filterModeNone' },
  { key: 'tabs', labelKey: 'engine.form.filterModeTabs' },
  { key: 'dropdown', labelKey: 'engine.form.filterModeDropdown' },
];

const slugifyTabName = (s: string): string =>
  (s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'tab';

function FilterModeWidget({ value, onChange, readOnly, context, ariaLabelledBy }: WidgetProps) {
  const locale = useMetadataLocale();
  const uf = (value && typeof value === 'object' ? value : undefined) as UFValue | undefined;
  const mode: 'none' | UFElement = uf?.element ?? (uf ? 'dropdown' : 'none');
  const fieldsState = context?.objectFields ?? NOT_ASKED;
  // objectui#5170 — every "Bind a source object…" line below is a CAUSE claim.
  // On a failed catalog load a source object IS bound, so each of them names
  // the wrong reason; the failure state replaces them. objectui#5228: reading
  // the catalog at all now requires having written this decision first.
  const loadError = loadErrorOf(fieldsState);
  const objectFields = fieldsState.status === 'error'
    ? NO_OBJECT_FIELDS
    : offeredOptions(fieldsState, NO_OBJECT_FIELDS);

  const setMode = (next: 'none' | UFMode) => {
    if (readOnly) return;
    if (next === 'none') { onChange(undefined); return; }       // omit-is-none
    onChange({ ...(uf ?? {}), element: next });
  };

  const fields: UFField[] = Array.isArray(uf?.fields) ? (uf!.fields as UFField[]) : [];
  const patchFields = (nextFields: UFField[]) =>
    onChange({ ...(uf ?? {}), element: mode === 'none' ? 'dropdown' : mode, fields: nextFields });

  const selected = new Set(fields.map((f) => f.field));
  const remaining = objectFields.filter((f) => !selected.has(f.name));
  const labelFor = (name: string) => objectFields.find((f) => f.name === name)?.label || name;

  // A deprecated `element: 'toggle'` config still lands here — render its
  // field picker too so it stays editable, even though Toggle isn't offered
  // as a new authoring choice.
  const isFieldMode = mode === 'dropdown' || mode === 'toggle';

  // ── Tabs preset editing (ADR-0053) ──────────────────────────────────────
  // Read any shape (canonical {name,filter} or legacy {id,filters}) into the
  // canonical editing model; writes always emit the canonical form so authoring
  // converges on one schema.
  const readTabs = (): UFTab[] => {
    const raw = Array.isArray(uf?.tabs) ? (uf!.tabs as any[]) : [];
    return raw.map((t) => ({
      ...t,
      name: t?.name ?? t?.id ?? '',
      label: typeof t?.label === 'string' ? t.label : (t?.name ?? t?.id ?? ''),
      filter: Array.isArray(t?.filter)
        ? t.filter
        : Array.isArray(t?.filters)
          ? t.filters
              .filter((r: any) => Array.isArray(r) && r.length >= 2)
              .map((r: any) => ({ field: String(r[0]), operator: String(r[1]), value: r[2] }))
          : [],
      isDefault: t?.isDefault ?? t?.default,
    }));
  };
  const tabs = readTabs();

  const canonicalTab = (t: UFTab): UFTab => {
    const out: UFTab = { name: slugifyTabName(t.label || t.name), label: t.label || t.name || 'Tab' };
    if (t.icon) out.icon = t.icon;
    out.filter = Array.isArray(t.filter) ? t.filter : [];
    if (t.isDefault) out.isDefault = true;
    return out;
  };
  const writeTabs = (next: UFTab[]) => {
    const seen: Record<string, true> = {};
    const canon = next.map(canonicalTab).map((o) => {
      let n = o.name;
      if (seen[n]) { let k = 2; while (seen[`${o.name}_${k}`]) k++; n = `${o.name}_${k}`; }
      seen[n] = true;
      return { ...o, name: n };
    });
    onChange({ ...(uf ?? {}), element: 'tabs', tabs: canon });
  };
  const addTab = () => writeTabs([...tabs, { name: '', label: `Tab ${tabs.length + 1}`, filter: [] }]);
  const removeTab = (ti: number) => writeTabs(tabs.filter((_, i) => i !== ti));
  const moveTab = (ti: number, dir: -1 | 1) => {
    const next = [...tabs];
    const j = ti + dir;
    if (j < 0 || j >= next.length) return;
    [next[ti], next[j]] = [next[j], next[ti]];
    writeTabs(next);
  };
  const patchTab = (ti: number, patch: Partial<UFTab>) =>
    writeTabs(tabs.map((t, i) => (i === ti ? { ...t, ...patch } : t)));
  const setShowAllRecords = (c: boolean) => onChange({ ...(uf ?? {}), element: 'tabs', showAllRecords: c });

  return (
    // The host's visible label names this whole editor (mode choice + the field
    // / tab pickers that follow), by IDREF — objectui#4871. The inner
    // radiogroup keeps its OWN name: it is a sub-choice ("which element"), not
    // the field, and the two names are about different things.
    <div className="space-y-3" role="group" aria-labelledby={ariaLabelledBy}>
      {/* Segmented mode selector */}
      <div className="inline-flex rounded-md border border-input bg-background p-0.5" role="radiogroup" aria-label={t('engine.form.filterElement', locale)}>
        {FILTER_MODES.map((m) => {
          const active = mode === m.key;
          return (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={active}
              data-testid={`filter-mode-${m.key}`}
              disabled={readOnly}
              onClick={() => setMode(m.key)}
              className={
                'px-3 py-1 text-xs font-medium rounded transition-colors ' +
                (active
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted')
              }
            >
              {t(m.labelKey, locale)}
            </button>
          );
        })}
      </div>

      {/* Field picker for dropdown / toggle modes */}
      {isFieldMode && (
        <div className="space-y-2" data-testid="filter-mode-fields">
          {fields.length > 0 && (
            <div className="space-y-1">
              {fields.map((f, i) => (
                <div key={f.field} className="flex items-center gap-2 rounded border border-input bg-background px-2 py-1 text-sm">
                  <span className="flex-1 truncate">
                    {labelFor(f.field)}
                    <code className="ml-2 text-xs text-muted-foreground">{f.field}</code>
                  </span>
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Switch
                      checked={!!f.showCount}
                      disabled={readOnly}
                      onCheckedChange={(c) => patchFields(fields.map((x, j) => (j === i ? { ...x, showCount: c } : x)))}
                    />
                    count
                  </label>
                  {!readOnly && (
                    <button
                      type="button"
                      aria-label={t('engine.form.removeField', locale)}
                      onClick={() => patchFields(fields.filter((_, j) => j !== i))}
                      className="px-1 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {!readOnly && remaining.length > 0 && (
            <Select onValueChange={(name) => patchFields([...fields, { field: name }])}>
              <SelectTrigger className="h-8 text-xs" data-testid="filter-mode-add-field">
                <SelectValue placeholder={t('engine.form.addFilterField', locale)} />
              </SelectTrigger>
              <SelectContent>
                {remaining.map((f) => (
                  <SelectItem key={f.name} value={f.name}>
                    {f.label || f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {loadError ? (
            <PickerLoadFailure message={loadError} testId="filter-mode-fields-load-failed" />
          ) : objectFields.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('engine.form.bindObjectForFilterFields', locale)}</p>
          ) : null}
        </div>
      )}

      {/* Visual tab-preset editor for tabs mode (ADR-0053). Each tab is a pure
          filter preset { name, label, icon?, filter:[{field,operator,value}] };
          it never switches the view form (that is the Visualizations axis). */}
      {mode === 'tabs' && (
        <div className="space-y-2" data-testid="filter-mode-tabs-editor">
          {tabs.map((tab, ti) => (
            <div key={ti} className="rounded-md border border-input bg-background p-2 space-y-2" data-testid={`tab-preset-${ti}`}>
              <div className="flex items-center gap-1.5">
                <Input
                  value={tab.label}
                  placeholder={t('engine.form.tabLabel', locale)}
                  disabled={readOnly}
                  className="h-8 text-sm flex-1"
                  data-testid={`tab-label-${ti}`}
                  onChange={(e) => patchTab(ti, { label: e.target.value })}
                />
                <code className="text-[10px] text-muted-foreground shrink-0 max-w-[6rem] truncate" title={tab.name}>{tab.name}</code>
                {!readOnly && (
                  <>
                    <button type="button" aria-label={t('engine.form.moveTabUp', locale)} disabled={ti === 0}
                      onClick={() => moveTab(ti, -1)}
                      className="px-1 text-muted-foreground hover:text-foreground disabled:opacity-30">
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" aria-label={t('engine.form.moveTabDown', locale)} disabled={ti === tabs.length - 1}
                      onClick={() => moveTab(ti, 1)}
                      className="px-1 text-muted-foreground hover:text-foreground disabled:opacity-30">
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" aria-label={t('engine.form.removeTab', locale)}
                      onClick={() => removeTab(ti)}
                      className="px-1 text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>

              {/* Per-tab filter — unified runtime FilterBuilder (popover). */}
              <div className="pl-1" data-testid={`tab-${ti}-filter`}>
                <FilterBuilderField
                  value={tab.filter as FilterRuleLite[] | undefined}
                  onChange={(f) => patchTab(ti, { filter: f as any })}
                  fields={objectFields}
                  loadError={loadError}
                  readOnly={readOnly}
                />
              </div>
            </div>
          ))}

          {!readOnly && (
            <button type="button" data-testid="filter-mode-add-tab" onClick={addTab}
              className="inline-flex items-center text-xs font-medium text-primary hover:underline">
              <Plus className="h-3.5 w-3.5 mr-1" /> Add tab
            </button>
          )}

          <label className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
            <Switch
              checked={uf?.showAllRecords !== false}
              disabled={readOnly}
              data-testid="filter-mode-show-all"
              onCheckedChange={setShowAllRecords}
            />
            Show “All records” tab
          </label>

          {loadError ? (
            <PickerLoadFailure message={loadError} testId="filter-mode-tabs-load-failed" />
          ) : objectFields.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('engine.form.bindObjectForTabRules', locale)}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* action-multi — pick toolbar buttons from the source object's actions       */
/*                                                                            */
/* Interface-page `buttons` are object Actions (ActionSchema), not free text. */
/* This makes "buttons = object actions" correct-by-construction (the picker  */
/* only offers actions the object actually defines).                          */
/* -------------------------------------------------------------------------- */
function ActionMultiWidget({ value, onChange, readOnly, context, ariaLabelledBy }: WidgetProps) {
  const locale = useMetadataLocale();
  const actionsState = context?.objectActions ?? NOT_ASKED;
  // objectui#5228 — this picker used to read `catalogErrors.fields` to learn
  // whether the ACTION catalog had failed, because the two ride the same
  // `client.get('object', …)` request. That is still true, but it is now the
  // producer's job to say so (`ResourceEditPage` derives both catalogs from the
  // one `LoadState`), and this picker simply reads its own.
  const loadError = loadErrorOf(actionsState);
  const actions = actionsState.status === 'error'
    ? NO_OBJECT_ACTIONS
    : offeredOptions(actionsState, NO_OBJECT_ACTIONS);
  const selected: string[] = Array.isArray(value)
    ? value.map(String)
    : typeof value === 'string' && value
      ? value.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
  const labelFor = (name: string) => actions.find((a) => a.name === name)?.label || name;
  const remaining = actions.filter((a) => !selected.includes(a.name));

  const add = (name: string) => { if (!selected.includes(name)) onChange([...selected, name]); };
  const removeAt = (i: number) => { const next = selected.slice(); next.splice(i, 1); onChange(next); };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= selected.length) return;
    const next = selected.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    // Same ordered-set shape as {@link FieldRefMultiWidget}, and the same
    // measured reason for `labelling: 'group'` (objectui#4871): the add trigger
    // that used to carry the host id disappears in the read-only state.
    <div className="space-y-2" data-testid="action-multi" role="group" aria-labelledby={ariaLabelledBy}>
      {loadError && (
        <PickerLoadFailure message={loadError} testId="action-multi-load-failed" />
      )}
      {selected.length > 0 && (
        <div className="space-y-1">
          {selected.map((name, i) => (
            <div key={name} className="flex items-center gap-1 rounded border border-input bg-background px-2 py-1 text-sm">
              <span className="flex-1 truncate">
                {labelFor(name)}
                <code className="ml-2 text-xs text-muted-foreground">{name}</code>
              </span>
              {!readOnly && (
                <>
                  <button type="button" aria-label={t('engine.form.moveUp', locale)} disabled={i === 0} onClick={() => move(i, -1)} className="px-1 text-muted-foreground hover:text-foreground disabled:opacity-30">↑</button>
                  <button type="button" aria-label={t('engine.form.moveDown', locale)} disabled={i === selected.length - 1} onClick={() => move(i, 1)} className="px-1 text-muted-foreground hover:text-foreground disabled:opacity-30">↓</button>
                  <button type="button" aria-label={tFormat('engine.form.removeNamed', locale, { name })} onClick={() => removeAt(i)} className="px-1 text-muted-foreground hover:text-destructive">×</button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {!readOnly && (
        <Select value="" onValueChange={add} disabled={remaining.length === 0}>
          {/* No host id — see {@link FieldRefMultiWidget}'s add trigger. */}
          <SelectTrigger data-testid="action-multi-add" aria-label={t('engine.form.addActionButtonPlain', locale)}>
            <SelectValue placeholder={loadError ? t('engine.form.optionsLoadFailedTitle', locale) : actions.length ? (remaining.length ? t('engine.form.addActionButton', locale) : t('engine.form.allActionsAdded', locale)) : t('engine.form.bindObjectForActions', locale)} />
          </SelectTrigger>
          <SelectContent>
            {remaining.map((a) => (
              <SelectItem key={a.name} value={a.name}>
                <span className="flex items-center gap-2">
                  <span>{a.label || a.name}</span>
                  <code className="text-xs text-muted-foreground">{a.name}</code>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* filter-builder — the SAME runtime FilterBuilder used by the list toolbar,   */
/* reused in Studio for view/tab filters and the page base filter (unified UX).*/
/* Stored format stays spec ViewFilterRule[] ({field,operator,value}). Writes  */
/* use the CANONICAL @objectstack/spec operator vocabulary (the enum enforced  */
/* by ViewFilterRuleSchema); reads also accept legacy shorthand/camelCase      */
/* spellings still present in already-stored view metadata (gt / eq / isNull). */
/* -------------------------------------------------------------------------- */
/* The WRITE direction (builder group → spec `ViewFilterRule[]`) now lives in  */
/* `../viewFilterFold`, shared with the runtime list toolbar — this file used  */
/* to hold the only copy, which is why the toolbar had none and PUT its raw    */
/* FilterGroup (objectstack#5159). Its local `FB_TO_SPEC` table went with it:  */
/* the shared fold normalizes through the spec's own                           */
/* `normalizeFilterOperator`, which covers the four builder operators this     */
/* table had drifted behind (startsWith / endsWith / isNull / isNotNull).      */
/*                                                                             */
/* The READ direction's local `SPEC_TO_FB` table (spec spelling → builder      */
/* camelCase) is gone too (objectui#9306). The builder's ids ARE the spec's    */
/* canonical spellings now, and the builder folds every other spelling a       */
/* stored rule may carry — the spec's legacy aliases (`gt`, `nin`, …) and the  */
/* deprecated camelCase ids (`greaterOrEqual`, …) — through the spec's own     */
/* `normalizeFilterOperator` at its read boundary. A stored rule is therefore  */
/* handed over as authored; a hand-kept copy of that fold here is exactly how  */
/* this file drifted before.                                                   */

interface FilterRuleLite { field: string; operator: string; value?: unknown }

function FilterBuilderField({ value, onChange, fields, readOnly, id, ariaLabelledBy, loadError }: {
  value?: FilterRuleLite[];
  onChange: (rules: FilterRuleLite[]) => void;
  fields: Array<{ name: string; label?: string; type?: string }>;
  readOnly?: boolean;
  /**
   * Why `fields` is empty, when the reason is that the catalog failed to load
   * rather than that no object is bound (objectui#5170). Absent on a completed
   * load, empty or not.
   */
  loadError?: string;
  /**
   * Host field id, forwarded onto the trigger BUTTON — a labelable element, so
   * the host's `<label for>` reaches it (objectui#4871). Only the standalone
   * `filter-builder` widget passes one; the in-widget call site inside
   * {@link FilterModeWidget}'s tab editor is a sub-control of a group and
   * carries its own name instead.
   */
  id?: string;
  /**
   * An IDREF naming the trigger button, for a host with no `<label>` to point
   * at it — a grid/table repeater cell (objectui#5063/#9889). Passed by the
   * standalone widget only, for the same reason as `id`.
   */
  ariaLabelledBy?: string;
}) {
  const locale = useMetadataLocale();
  // The metadata-admin `t` above is a static engine-string table; refusal
  // copy lives in the shared console locale packs, so it resolves through the
  // platform translator (same one ObjectView's toolbar toasts use).
  const { t: tr } = useObjectTranslation();
  const rules = Array.isArray(value) ? value : [];
  const group = {
    id: 'g',
    logic: 'and' as const,
    conditions: rules.map((r, i) => ({
      id: `c${i}`,
      // Handed over as stored: the builder reads it through the spec's fold
      // (objectui#9306), and a spelling nothing folds is kept verbatim so it
      // round-trips on save instead of being rewritten.
      operator: r.operator ?? 'equals',
      field: r.field,
      value: (r.value as any) ?? '',
    })),
  };
  const fbFields = fields.map((f) => ({ value: f.name, label: f.label || f.name, type: f.type }));
  const summary = rules.length
    ? rules.map((r) => `${fields.find((f) => f.name === r.field)?.label || r.field}`).filter(Boolean).join(', ')
    : '';
  const handle = (g: any) => {
    // Shared with the runtime list toolbar (objectstack#5159). A group that
    // cannot fold losslessly — `logic: 'or'` over several rows, or a nested
    // group — is refused rather than silently written as AND, which is what
    // this callback used to do by dropping `g.logic` on the floor.
    const folded = foldFilterGroupToSpecRules(g);
    if (!folded.ok) {
      toast.error(tr(FILTER_FOLD_REFUSAL_KEYS[folded.reason]));
      return;
    }
    onChange(folded.rules as FilterRuleLite[]);
  };
  return (
    <Popover>
      {/* No `required` on the trigger, deliberately (objectui#10367): this face
          is a plain `button`, and ARIA 1.2 does not support `aria-required` on
          role `button` — axe-core reports it as `aria-allowed-attr`. The other
          ten `'control'` widgets carry it through `controlNaming`. */}
      <PopoverTrigger asChild>
        <Button {...controlNaming({ id, ariaLabelledBy })} variant="outline" size="sm" disabled={readOnly}
          className="h-8 w-full justify-between text-xs font-normal" data-testid="filter-builder-trigger">
          <span className="truncate text-left">{summary || <span className="text-muted-foreground">+ Add filter…</span>}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[440px] max-w-[90vw] p-3">
        {loadError ? (
          <PickerLoadFailure message={loadError} testId="filter-builder-load-failed" />
        ) : fields.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('engine.form.bindObjectForConditions', locale)}</p>
        ) : (
          <FilterBuilder fields={fbFields} value={group as any} onChange={handle} />
        )}
      </PopoverContent>
    </Popover>
  );
}

function FilterBuilderWidget({ id, ariaLabelledBy, value, onChange, readOnly, context }: WidgetProps) {
  const fieldsState = context?.objectFields ?? NOT_ASKED;
  const loadError = loadErrorOf(fieldsState);
  const fields = fieldsState.status === 'error'
    ? NO_OBJECT_FIELDS
    : offeredOptions(fieldsState, NO_OBJECT_FIELDS);
  return (
    // The whole face is ONE labelable element — a popover trigger `<button>` —
    // so this stays on the plain `<label for>` channel and simply stops dropping
    // the id the host hands down (objectui#4871: measured DANGLING before).
    <FilterBuilderField
      id={id}
      ariaLabelledBy={ariaLabelledBy}
      value={value as FilterRuleLite[] | undefined}
      onChange={(rules) => onChange(rules.length ? rules : undefined)}
      fields={fields}
      loadError={loadError}
      readOnly={readOnly}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* color-picker / color-input — TWO registrations, picked by the HOST         */
/* -------------------------------------------------------------------------- */

/**
 * The semantic palette a colour field declares, or an EMPTY array when it
 * declares none (objectui#4871).
 *
 * This is the split point of what used to be one `color-picker` widget with a
 * runtime `if`. Both the host — which must know, BEFORE it writes the label,
 * whether this field renders a `radiogroup` or a labelable input — and the
 * widgets themselves read the palette through this one function, so producer
 * and consumer cannot disagree about which surface will render. (Same discipline
 * `packages/components`' `resolveFieldLabelling` follows against
 * `renderFieldComponent`.)
 */
export function colorPaletteOptions(
  schema: Record<string, unknown> | undefined,
  fieldSpec: WidgetProps['fieldSpec'],
): Array<{ value: string; label?: string }> {
  if (Array.isArray(fieldSpec?.options) && fieldSpec!.options!.length) {
    return fieldSpec!.options!.map((o) => ({ value: o.value, label: o.label }));
  }
  if (Array.isArray(schema?.enum)) {
    return (schema!.enum as unknown[])
      .filter((v): v is string => typeof v === 'string')
      .map((v) => ({ value: v }));
  }
  return [];
}

/**
 * Which of the two colour registrations a field resolves to — `'color-picker'`
 * (a declared palette ⇒ swatch `radiogroup`) or `'color-input'` (free colour ⇒
 * native picker).
 *
 * The maintainer ruling of 2026-08-17 (objectui#4871, point 4) split the single
 * conditional registration precisely so this choice happens in the HOST, from
 * the schema, ahead of the label — passing both naming channels down for the
 * widget to pick at runtime would have re-introduced the inference the ruling
 * removes.
 */
export function resolveColorWidgetKey(
  schema: Record<string, unknown> | undefined,
  fieldSpec: WidgetProps['fieldSpec'],
): 'color-picker' | 'color-input' {
  // ⚠️ Reads {@link colorPaletteOptions}, the RAW palette, and it must keep
  // doing so (objectui#6247, Fork B → B1). This function decides which of the
  // two colour REGISTRATIONS the host mounts, and objectui#4871 point 4 put
  // that decision in the host, from the schema, BEFORE the label is written.
  // Filtering here would make the labelling channel itself predicate-dependent:
  // withdrawing the last swatch would silently re-register the field as
  // `color-input` and move its accessible name onto a different element.
  return colorPaletteOptions(schema, fieldSpec).length > 0 ? 'color-picker' : 'color-input';
}

/**
 * The palette a colour field OFFERS right now — {@link colorPaletteOptions}
 * with each option's `visibleWhen` applied (objectui#6247).
 *
 * The CONTENT half of the B1 split: the source list is still chosen on the RAW
 * `fieldSpec.options` (identically to {@link colorPaletteOptions}, so producer
 * and consumer cannot disagree about which list is in play, and a fully
 * withdrawn palette can never fall through to the schema `enum` and resurrect
 * the very swatches the predicate withdrew), and only its ELEMENTS are
 * filtered. An emptied palette renders an empty `radiogroup` — still
 * `color-picker`, per {@link resolveColorWidgetKey}.
 *
 * The `enum` arm is returned unfiltered because a JSON-Schema enum member has
 * no per-option predicate to read; there is nothing there to withhold.
 */
export function visibleColorPaletteOptions(
  schema: Record<string, unknown> | undefined,
  fieldSpec: WidgetProps['fieldSpec'],
  ctx: PredicateCtx,
): Array<{ value: string; label?: string }> {
  if (Array.isArray(fieldSpec?.options) && fieldSpec!.options!.length) {
    return visibleOptions(fieldSpec!.options!, ctx).map((o) => ({ value: o.value, label: o.label }));
  }
  return colorPaletteOptions(schema, fieldSpec);
}

/**
 * `color-picker` — a declared palette, rendered as a swatch `radiogroup`.
 * `labelling: 'group'`: `role="radiogroup"` is a container, so the host's label
 * publishes an id and this surface answers it by IDREF (objectui#4010 named the
 * group; objectui#4871 is what finally removed the host's dangling `for`).
 */
function ColorSwatchGroupWidget({ value, onChange, readOnly, schema, fieldSpec, formData, ariaLabelledBy, required }: WidgetProps) {
  const locale = useMetadataLocale();
  const hostScope = usePredicateScope();
  // Exactly one naming channel, chosen by which one the caller can supply
  // (`ColorVariantPickerNaming` makes that a type-level XOR, objectui#4010):
  // `SchemaForm` publishes a label id and takes the IDREF arm; a caller that
  // renders this widget standalone — with no visible label in a position to
  // publish an id — falls to the self-owned name, kept equal to the visible
  // text wherever there is one (WCAG 2.5.3).
  const naming = ariaLabelledBy
    ? ({ ariaLabelledBy } as const)
    : ({
        ariaLabel:
          fieldSpec?.label ??
          (typeof schema?.title === 'string' ? schema.title : undefined) ??
          t('engine.form.color', locale),
      } as const);
  return (
    <ColorVariantPicker
      {...naming}
      // The one `'group'` widget whose surface ARIA 1.2 gives a required state:
      // `aria-required` on its `radiogroup` (objectui#10367).
      required={required}
      value={value == null ? undefined : String(value)}
      onChange={(v) => onChange(v)}
      disabled={readOnly}
      options={visibleColorPaletteOptions(schema, fieldSpec, buildPredicateCtx(formData, hostScope))}
    />
  );
}

/**
 * `color-input` — free colour, rendered as the native picker plus a hex mirror.
 * `labelling: 'control'`: `input[type="color"]` IS a labelable element and is
 * the field's primary control, so it takes the host id and the plain
 * `<label for>` names it. The hex box beside it edits the same value and carries
 * its own name — before objectui#4871 it had none at all.
 */
function ColorInputWidget({ id, ariaLabelledBy, required, value, onChange, readOnly }: WidgetProps) {
  const locale = useMetadataLocale();
  const v = value == null ? '' : String(value);
  return (
    <div className="flex items-center gap-2">
      <input
        {...controlNaming({ id, ariaLabelledBy, required })}
        type="color"
        value={/^#([0-9a-f]{6})$/i.test(v) ? v : '#000000'}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-10 shrink-0 rounded border border-input bg-background p-0.5 disabled:opacity-60"
        // No `aria-label` beside the host's `<label for>`: an `aria-label` WINS
        // the accessible-name computation, so keeping the old constant here
        // would have overridden the field's visible label with "Color" — one
        // label, two channels, the broken one louder (objectui#3978).
        aria-label={id || ariaLabelledBy ? undefined : t('engine.form.color', locale)}
      />
      <Input
        value={v}
        placeholder={t('engine.form.colorHexPlaceholder', locale)}
        disabled={readOnly}
        aria-label={t('engine.form.colorHex', locale)}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="h-8 text-sm font-mono"
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* condition — no-code CEL predicate builder (visible / hidden / disabled / …) */
/* -------------------------------------------------------------------------- */

/**
 * `SchemaForm` routes every predicate-named field here (`visible` / `hidden` /
 * `disabled` / `condition` / `predicate` / `*When`), and most of those are
 * `ExpressionInputSchema` in the spec — so the value arriving is usually the
 * ADR-0089 envelope, not a string. `String(value)` put a literal
 * `[object Object]` in the editor and the commit wrote a bare string back over
 * the envelope; both go through the shared read/write pair now (#3218). The
 * pair is shape-preserving, so the plain-`string` predicate fields this widget
 * also serves keep round-tripping as strings.
 */
function ConditionWidget({ value, onChange, readOnly, context, ariaLabelledBy }: WidgetProps) {
  // objectui#5228 — `ConditionBuilder` renders a field dropdown and has no
  // failure state of its own, so a failed catalog reaches it as "no fields to
  // pick from". Passing `undefined` rather than an empty array is what it
  // already treats as "no catalog wired": the two arms it cannot tell apart are
  // collapsed onto the one that does NOT assert the object has no fields.
  const fieldsState = context?.objectFields ?? NOT_ASKED;
  const conditionFields =
    fieldsState.status === 'loaded' ? fieldsState.data : undefined;
  // objectui#8167 — the host's verdict about its own surface, never this
  // widget's guess. `undefined` is the one case this widget decides, and it
  // decides it by changing NOTHING: a host that hands down no `WidgetContext`
  // at all has made no claim, so the builder keeps forwarding no scope and
  // `celAuthoring`'s `hint.scope ?? 'flattened'` answers exactly what it
  // answered before this member existed. ⛔ Not `'none'`: that is a decision,
  // and swapping the editor under a host that never asked for it would be this
  // change reaching mounts nobody ruled on.
  const conditionScope = context?.conditionScope;
  // objectui#9953 — the OTHER half of the host's verdict, and a separate one:
  // the scope above says how this predicate is linted, this says which subjects
  // its evaluator actually binds. `undefined` is the unchanged case by
  // construction — an omitted `subjects` leaves `ConditionBuilder` on
  // `CONTEXT_SUBJECTS`, exactly what every mount here offered before.
  const conditionSubjects = context?.conditionSubjects;
  // objectui#9856 — the THIRD half, and the one that widens rather than
  // narrows: the builder already answers `scope="record"` with the roots every
  // host of a record-scoped condition binds, so a client-evaluated tier is the
  // one that has to say it binds more. `undefined` is the unchanged case by
  // construction — it leaves that default exactly where objectui#9645 put it.
  const conditionRoots = context?.conditionRoots;
  return (
    // `ConditionBuilder` is a multi-control composite (field / operator / value
    // rows plus add-condition buttons) shared with the curated inspectors, so
    // the naming wrapper lives HERE — the widget owns the host contract, the
    // shared builder stays host-agnostic (objectui#4871). The wrapper stays put
    // on both arms: `WIDGET_LABELLING` declares this key `'group'`, so the host
    // sends a label id and no control id, and that contract cannot vary with
    // the scope.
    <div role="group" aria-labelledby={ariaLabelledBy}>
      {conditionScope === 'none' ? (
        // No lint claim is honest on this surface, so the field gets the plain
        // string editor every non-predicate field gets — no builder, no scope,
        // no verdict. The read/write pair still runs, so an ADR-0089 envelope
        // round-trips here exactly as it does through the builder.
        <Input
          aria-labelledby={ariaLabelledBy}
          value={expressionSource(value)}
          onChange={(e) => onChange(writeExpressionSource(value, e.target.value))}
          disabled={readOnly}
        />
      ) : (
        <ConditionBuilder
          value={expressionSource(value)}
          onCommit={(cel) => onChange(writeExpressionSource(value, cel))}
          fields={conditionFields}
          disabled={readOnly}
          scope={conditionScope}
          subjects={conditionSubjects ? { context: conditionSubjects } : undefined}
          roots={conditionRoots}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* secret — write-only / masked credential input (encrypt-on-write fields)     */
/* -------------------------------------------------------------------------- */

/**
 * The ADR-0100 credential read mask: a stored secret reads back as this, never
 * plaintext.
 *
 * Renamed off the bare `SECRET_MASK` (objectui#4650). This is the SAME constant
 * `@objectstack/spec/data` exports under that name from 17.0.0 \u2014 the protocol
 * moved it to `spec` (objectstack#7572) precisely so the engine's field-read
 * path and the settings REST boundary stop each declaring a byte-identical
 * literal bound by nothing but convention. objectui should therefore IMPORT it
 * rather than declare it, which is what the #4043 doctrine asks for; that
 * import cannot be written yet because this repo is still pinned to
 * `^17.0.0-rc.6`, which does not export the name.
 *
 * So the copy stays for now, under a name that cannot be read as the spec's own
 * definition, and the whole burn-down is this one line: when #4636 / PR #4639
 * raises the pin, replace the literal with
 * `export { SECRET_MASK as OBJECTUI_SECRET_MASK } from '@objectstack/spec/data'`
 * (or re-export it plainly and drop this alias). Nothing outside this package
 * reads it \u2014 `@object-ui/app-shell`'s barrel does not re-export it \u2014 so that
 * swap is internal.
 *
 * The eight U+2022 BULLET characters are spelled out rather than computed, on
 * the spec's own reasoning: a plain grep for the mask a client actually received
 * has to find this declaration. Tripwire: `__tests__/spec-symbol-parity.test.ts`.
 */
export const OBJECTUI_SECRET_MASK = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';

/**
 * `secret` widget — a write-only credential input for `secret` field types (and
 * `format: 'password'` / `writeOnly` props). A stored secret reads back masked,
 * so the box starts empty with a "leave blank to keep" hint; typing replaces it,
 * a reveal toggle shows what you type, and Clear removes it. Emits the typed
 * value (new secret), `OBJECTUI_SECRET_MASK` (blank + existing = keep, a no-op on write),
 * `null` (Clear), or `undefined` (blank + none).
 */
function SecretWidget({ value, onChange, readOnly, schema, id, ariaLabelledBy, required }: WidgetProps) {
  const locale = useMetadataLocale();
  const stored = value === OBJECTUI_SECRET_MASK;
  const [reveal, setReveal] = React.useState(false);
  const [draft, setDraft] = React.useState<string>(stored || value == null ? '' : String(value));
  const update = (v: string) => {
    setDraft(v);
    if (v === '') onChange(stored ? OBJECTUI_SECRET_MASK : undefined); // blank: keep if stored, else unset
    else onChange(v);
  };
  return (
    <div className="flex items-center gap-2">
      <Input
        {...controlNaming({ id, ariaLabelledBy, required })}
        type={reveal ? 'text' : 'password'}
        value={draft}
        disabled={readOnly}
        autoComplete="off"
        placeholder={stored ? (schema?.description ? t('engine.form.secretSetTypeToReplace', locale) : t('engine.form.secretSetLeaveBlank', locale)) : (typeof schema?.description === 'string' ? '' : t('engine.form.enterAValue', locale))}
        onChange={(e) => update(e.target.value)}
        className="h-8 text-sm font-mono"
        // Same single-channel rule as `color-input`'s picker (objectui#4871):
        // this widget declares `labelling: 'control'`, so when the host hands
        // down an `id` its `<label for>` is the naming channel — and an
        // `aria-label` here WINS the accessible-name computation, which had the
        // visible field label ("API Key", "Client Secret") replaced by the
        // constant "Secret value" on every SchemaForm render. Kept only for a
        // caller that renders this widget with no host label at all.
        aria-label={id || ariaLabelledBy ? undefined : t('engine.form.secretValue', locale)}
      />
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={readOnly} aria-label={reveal ? t('engine.form.hideValue', locale) : t('engine.form.revealValue', locale)} onClick={() => setReveal((r) => !r)}>
        {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </Button>
      {stored && (
        <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 text-destructive hover:text-destructive" disabled={readOnly} onClick={() => { setDraft(''); onChange(null); }}>
          {t('engine.form.clear', locale)}
        </Button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* dynamic-config — sub-form whose schema is chosen by a sibling field value   */
/* -------------------------------------------------------------------------- */

/**
 * `dynamic-config` widget — renders an object field whose shape depends on a
 * SIBLING field\'s value. `fieldSpec.dependsOn` names the parent field (e.g.
 * `driver`); `context.dynamicSchemas[<parentValue>]` supplies the JSON-Schema
 * for the config object. The canonical case is a datasource\'s `config` field
 * that changes fields per driver, but it is generic: any "pick X → these
 * settings" pattern can reuse it by populating `dynamicSchemas`.
 */
function DynamicConfigWidget({ value, onChange, readOnly, fieldSpec, formData, context, ariaLabelledBy }: WidgetProps) {
  // Hoisted above this component's early returns so the hook order is stable.
  const locale = useMetadataLocale();
  const dep = Array.isArray(fieldSpec?.dependsOn) ? fieldSpec!.dependsOn![0] : fieldSpec?.dependsOn;
  const depVal = dep ? (formData?.[dep] as string | undefined) : undefined;
  const sub = depVal != null ? context?.dynamicSchemas?.[String(depVal)] : undefined;
  const props = (sub?.properties ?? {}) as Record<string, any>;
  const required = new Set<string>(sub?.required ?? []);
  const cfg = (value && typeof value === 'object' ? (value as Record<string, unknown>) : {}) as Record<string, unknown>;
  const setKey = (k: string, v: unknown) => {
    const next = { ...cfg };
    if (v === undefined || v === '') delete next[k]; else next[k] = v;
    onChange(next);
  };

  if (!depVal) {
    // Every branch answers the host's IDREF, so the field's visible label owns
    // this surface in each of its three states (objectui#4871) — a group named
    // in one state and anonymous in another is the conditional shape the #4871
    // ruling removed.
    return (
      <div role="group" aria-labelledby={ariaLabelledBy} className="text-xs text-muted-foreground">
        {tFormat('engine.form.selectDepToConfigure', locale, {
          dep: dep ?? t('engine.form.anOption', locale),
        })}
      </div>
    );
  }
  if (!sub || Object.keys(props).length === 0) {
    return (
      <div role="group" aria-labelledby={ariaLabelledBy} className="text-xs text-muted-foreground">
        {tFormat('engine.form.noConfigNeeded', locale, { value: String(depVal) })}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-border/60 p-3" role="group" aria-labelledby={ariaLabelledBy}>
      {Object.entries(props).map(([key, p]) => {
        const label = (p as any)?.title || key;
        const cur = cfg[key];
        const isReq = required.has(key);
        if ((p as any)?.type === 'boolean') {
          return (
            <div key={key} className="flex items-center justify-between gap-2">
              <Label className="text-xs">{label}</Label>
              {/* Sub-controls of a `labelling: 'group'` widget carry their OWN
                  names (objectui#4857's composite rule) — this one was the last
                  anonymous control inside the group. */}
              <Switch aria-label={label} checked={Boolean(cur)} disabled={readOnly} onCheckedChange={(c) => setKey(key, c)} />
            </div>
          );
        }
        if (Array.isArray((p as any)?.enum)) {
          return (
            <div key={key} className="space-y-1">
              <Label className="text-xs">{label}{isReq ? ' *' : ''}</Label>
              <Select value={cur != null ? String(cur) : ''} onValueChange={(v) => setKey(key, v)} disabled={readOnly}>
                <SelectTrigger className="h-8" aria-label={label}><SelectValue placeholder={t('engine.form.selectEllipsis', locale)} /></SelectTrigger>
                <SelectContent>
                  {((p as any).enum as unknown[]).map((o) => <SelectItem key={String(o)} value={String(o)}>{String(o)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          );
        }
        const isSecret = (p as any)?.format === 'password' || (p as any)?.writeOnly === true;
        const isNum = (p as any)?.type === 'number' || (p as any)?.type === 'integer';
        return (
          <div key={key} className="space-y-1">
            <Label className="text-xs">{label}{isReq ? ' *' : ''}</Label>
            {isSecret ? (
              // Credential sub-field → reuse the masked/keep/reveal secret input
              // so a config password (e.g. postgres) behaves like any secret field.
              <SecretWidget value={cur} onChange={(v) => setKey(key, v)} readOnly={readOnly} schema={p as Record<string, any>} />
            ) : (
              <Input
                type={isNum ? 'number' : 'text'}
                value={cur != null ? String(cur) : ''}
                disabled={readOnly}
                aria-label={label}
                onChange={(e) => setKey(key, isNum ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value)}
                className="h-8 text-sm"
              />
            )}
            {(p as any)?.description && <p className="text-[11px] text-muted-foreground">{(p as any).description}</p>}
          </div>
        );
      })}
    </div>
  );
}

// `satisfies` (not a `Record<string, …>` annotation) so the KEY SET survives as
// a literal union — that union is what makes `WIDGET_LABELLING` below exhaustive
// BY CONSTRUCTION: adding a widget here without deciding how the host's label
// reaches it is a compile error, not a silent fall-through to the dangling-`for`
// path (objectui#4871, the registry gate ruled jointly with objectui#4857).
export const WIDGETS = {
  'ref:object': RefObjectWidget,
  'ref:component': RefComponentWidget,
  'ref:dataset': RefDatasetWidget,
  'ref-multi:permission': RefMultiPermissionWidget,
  'filter-mode': FilterModeWidget,
  'object-selector': ObjectSelectorWidget,
  'field-selector': FieldSelectorWidget,
  'field-ref': FieldRefWidget,
  'field-multi': FieldRefMultiWidget,
  'action-multi': ActionMultiWidget,
  'filter-builder': FilterBuilderWidget,
  'view-ref': ViewRefWidget,
  'icon': IconPickerWidget,
  'color-picker': ColorSwatchGroupWidget,
  'color-input': ColorInputWidget,
  'condition': ConditionWidget,
  'master-detail': MasterDetailWidget,
  'string-tags': StringTagsWidget,
  'multiselect': MultiSelectWidget,
  'code': CodeWidget,
  'secret': SecretWidget,
  'dynamic-config': DynamicConfigWidget,
} satisfies Record<string, WidgetRenderer>;

/** Every key of {@link WIDGETS}, as a literal union. */
export type RegisteredWidgetKey = keyof typeof WIDGETS;

/**
 * The labelling vocabulary this host implements, DERIVED from the repo-wide
 * declaration type rather than restated (`RegistryComponentMeta['labelling']`,
 * objectui#3961 → #4857 → #4871's joint ruling: no host may keep a local
 * variant of it).
 *
 * `'display'` is excluded on a MEASURED basis, not an editorial one: every one
 * of this registry's widgets is an editable control or an editable composite —
 * none is the "pure display in every state" case `'display'` names, so this host
 * has no display CHANNEL to route one to. Excluding it here means adding such a
 * widget is a compile error at the declaration, pointing at the host that must
 * grow the `#4788` wrapper first — instead of a `'display'` declaration silently
 * degrading to the group channel and naming nothing (a widget declared
 * `'display'` spreads no props, so an `aria-labelledby` handed to it lands
 * nowhere). Deriving by `Exclude` keeps the vocabulary single-sourced: rename or
 * re-spell a member in `packages/core` and this stops compiling.
 */
export type WidgetLabelling = Exclude<NonNullable<RegistryComponentMeta['labelling']>, 'display'>;

/**
 * How the HOST's visible label reaches each registered widget — the reviewed
 * table that replaced twenty scattered per-widget judgements (objectui#4871,
 * maintainer ruling of 2026-08-17, point 1: ledger first, then declare).
 * (Nineteen before the `color-picker` split; objectui#4871's own body says
 * "17", which the ledger corrected — see the PR.)
 *
 * Measured on real `SchemaForm` renders at `167ec42e7`, both states, three
 * columns per widget: does the host `for` RESOLVE and to a LABELABLE element /
 * is the rendered face labelable at all / does the group have an accessible
 * name. The ledger is in the PR body; the three readings that decided a
 * classification are called out on the widgets themselves.
 *
 * ## `'control'` — the host's `<label for>` reaches a real labelable element
 *
 * The widget puts `id` on the ONE labelable element that is the field's primary
 * control, in EVERY branch it can render (loading, FAILED-catalog,
 * empty-catalog, read-only) —
 * and, on that SAME element, any `ariaLabelledBy` the host hands down
 * ({@link controlNaming}, objectui#9889). The id is the `<label for>` channel
 * and the IDREF is the channel a host with NO label uses; a grid/table cell is
 * that host, so declaring `'control'` has never meant "reads no IDREF".
 * ⛔ Auxiliary affordances beside that control — a chip's remove button, a
 * reveal toggle, the hex mirror beside a colour input — are EXEMPT and keep
 * their own names; they are not what the field's label names, and re-naming
 * them after the column would leave a grid row full of controls that all
 * announce the same thing. "In every
 * branch" is the load-bearing half: `field-multi` and `action-multi` look like
 * this in the editable state and were measured DANGLING in the read-only one,
 * which is why they are NOT here.
 *
 * ⭐ The parenthetical is EXAMPLES, and the quantifier before it is the rule —
 * settled on the record by objectui#9931, which read the two apart because the
 * catalog-FAILURE arm was not in the list. Read as exhaustive, the list would
 * make this table's own declaration false about widgets it names, and it would
 * contradict the membership test the paragraph above applies: `field-multi` and
 * `action-multi` are excluded for dangling in ONE arm — whichever arm that
 * happens to be, not one of three enumerated ones. The failure branch is named
 * in the list now so no later reader has to re-derive that; the rule it glosses
 * is unchanged, and no widget's declaration moved. ⛔ The list is still not the
 * scope — the instrument that re-derives which branches every `'control'`
 * widget actually names is
 * `SchemaForm.controlWidgetFailureArmNaming-9931.test.tsx`, which takes its
 * population from this table rather than from any list in prose.
 *
 * ## `'group'` — no `<label for>` can reach it; the WIDGET answers by IDREF
 *
 * Two shapes, one declaration, exactly as `packages/fields`' own table splits
 * them (objectui#4857):
 *
 *  - real composites — `filter-mode` (mode radiogroup + field/tab pickers),
 *    `master-detail` (a table of per-cell inputs), `condition` (predicate rows),
 *    `dynamic-config` (a driver-shaped sub-form), `field-multi` / `action-multi`
 *    (an ordered set with reorder/remove buttons plus an auxiliary add picker),
 *    `ref-multi:permission` (a list of names with remove buttons plus an
 *    auxiliary add control, objectui#12126);
 *  - single non-labelable surfaces — `color-picker`'s `div[role="radiogroup"]`,
 *    `multiselect`'s `div[role="group"]` of checkbox buttons, and `code`, whose
 *    only focusable is Monaco's internal textarea that this widget never renders.
 *
 * The host publishes its label's `id`, drops the `for` (inert on a container,
 * and a second broken channel beside a working one — objectui#3978/#4010), and
 * hands the id down as `ariaLabelledBy`; the widget puts it on the surface that
 * IS the field.
 */
export const WIDGET_LABELLING: Record<RegisteredWidgetKey, WidgetLabelling> = {
  'ref:object': 'control',
  'ref:component': 'control',
  'ref:dataset': 'control',
  'ref-multi:permission': 'group',
  'filter-mode': 'group',
  'object-selector': 'control',
  'field-selector': 'control',
  'field-ref': 'control',
  'field-multi': 'group',
  'action-multi': 'group',
  'filter-builder': 'control',
  'view-ref': 'control',
  'icon': 'control',
  'color-picker': 'group',
  'color-input': 'control',
  'condition': 'group',
  'master-detail': 'group',
  'string-tags': 'control',
  'multiselect': 'group',
  'code': 'group',
  'secret': 'control',
  'dynamic-config': 'group',
};

/**
 * The declared labelling of a widget key, for the host's channel decision.
 * An UNREGISTERED key (a passthrough hint, a third-party name) resolves to
 * `'control'` — byte for byte what `FieldRow` emitted before the
 * declaration existed.
 */
export function widgetLabelling(widget: string | undefined): WidgetLabelling {
  if (!widget) return 'control';
  return WIDGET_LABELLING[widget as RegisteredWidgetKey] ?? 'control';
}

/**
 * Does a form layout declare `widget` on any of its fields — in a section, in a
 * legacy `groups` entry, or on a sub-field of a composite or repeater row
 * (objectui#12126)?
 *
 * A host asks this before it loads a catalog only that widget reads, so the
 * request is sent for the forms that use the catalog and for no other. Typed on
 * {@link RegisteredWidgetKey}: a host asks about a widget this registry renders.
 */
export function formDeclaresWidget(form: FormViewSpec | undefined, widget: RegisteredWidgetKey): boolean {
  const declares = (fields: Array<string | FormFieldSpec> | undefined): boolean =>
    (fields ?? []).some((f) => typeof f !== 'string' && (f.widget === widget || declares(f.fields)));
  return [...(form?.sections ?? []), ...(form?.groups ?? [])].some((s) => declares(s.fields));
}

/* -------------------------------------------------------------------------- */
/* CodeWidget — Monaco editor (textarea fallback) for `type: 'code'` fields   */
/* -------------------------------------------------------------------------- */

/**
 * Infer language from fieldSpec.language → schema.format → field name.
 */
function inferCodeLanguage(fieldSpec?: WidgetProps['fieldSpec'], schema?: Record<string, any>): string {
  if (fieldSpec?.language) return fieldSpec.language;
  if (typeof schema?.format === 'string') {
    const f = schema.format.toLowerCase();
    if (f === 'sql' || f === 'javascript' || f === 'typescript' || f === 'json' || f === 'yaml' || f === 'html' || f === 'css' || f === 'python') return f;
  }
  // Common hook/action field name heuristics
  const name = fieldSpec?.field?.toLowerCase() ?? '';
  if (name.includes('sql') || name === 'query') return 'sql';
  if (name === 'source' || name === 'body' || name === 'script' || name === 'handler') return 'javascript';
  if (name === 'expression' || name === 'predicate' || name === 'formula' || name === 'condition') return 'javascript';
  return 'javascript';
}

const LazyCodeEditor = React.lazy(() =>
  import('@object-ui/plugin-editor').then((m) => ({ default: m.CodeEditorRenderer })),
);

/**
 * The one language whose slot is an ADR-0089 expression (objectui#10963). A form
 * row declares it (`type: 'code'`, `language: 'expression'`) over a spec slot
 * that persists as the `{ dialect, source, … }` envelope, so the editor text is
 * the envelope's `source` and an edit goes back through the shared read/write
 * pair, exactly as `ConditionWidget` does (objectui#3218).
 *
 * Keyed on the DECLARED language and nothing else. Every other language keeps
 * the plain string path, and a stored value's shape is never sniffed: a row
 * that holds an expression but declares another language is a producer defect
 * to fix in its form, not a guess to make here.
 */
const EXPRESSION_LANGUAGE = 'expression';

export function CodeWidget({
  schema,
  value,
  onChange,
  readOnly,
  fieldSpec,
  ariaLabelledBy,
}: WidgetProps) {
  const locale = useMetadataLocale();
  const language = inferCodeLanguage(fieldSpec, schema);
  const isExpression = language === EXPRESSION_LANGUAGE;
  // Expression slot: `expressionSource` never stringifies an envelope into
  // `[object Object]`, and `writeExpressionSource` keeps its `dialect` / `meta`
  // (a cleared editor writes `undefined`, as `ConditionWidget` does).
  const editorText = isExpression
    ? expressionSource(value)
    : typeof value === 'string' ? value : (value == null ? '' : String(value));
  const commit = (next: string | undefined): void =>
    onChange(isExpression ? writeExpressionSource(value, next ?? '') : (next ?? ''));
  // Monaco's core comes from a public CDN. Where it cannot be fetched (no
  // egress, a strict CSP) the editor never paints, so this widget reads the
  // page's one loader probe that the source editors read (objectui#11800) and
  // renders a plain textarea instead (objectui#11858). The editor is mounted
  // only once the probe has resolved: mounted earlier, its own `loader.init()`
  // on a failing install logs a second report and leaks an uncaught rejection.
  const [monacoStatus, containerRef] = useMonacoFallback();
  const loadingEditor = (
    <div className="h-[280px] flex items-center justify-center text-xs text-muted-foreground">
      {t('engine.form.loadingEditor', locale)}
    </div>
  );
  return (
    // The editor's own focusable is Monaco's internal textarea — this widget
    // never renders it and cannot put the host id on it, so a `<label for>` can
    // never reach the editing surface. Named by IDREF instead (objectui#4871).
    <div className="rounded-md border border-border/50 overflow-hidden" role="group" aria-labelledby={ariaLabelledBy}>
      <div className="flex items-center justify-between px-2 py-1 bg-muted/40 border-b border-border/30 text-[10px] font-mono text-muted-foreground">
        <span>{language}</span>
        {readOnly && <span>{t('engine.form.readOnly', locale)}</span>}
      </div>
      <div ref={containerRef}>
        {monacoStatus === 'unavailable' ? (
          // The fallback is this widget's own element, so it takes the same
          // IDREF as the group. It edits the same text and writes through the
          // same `commit` as the editor: a string, or the expression envelope.
          <textarea
            value={editorText}
            onChange={(e) => commit(e.target.value)}
            readOnly={readOnly}
            spellCheck={false}
            aria-labelledby={ariaLabelledBy}
            className="block h-[280px] w-full resize-y bg-background p-3 font-mono text-xs leading-relaxed outline-none"
          />
        ) : monacoStatus === 'loading' ? (
          loadingEditor
        ) : (
          <React.Suspense fallback={loadingEditor}>
            <LazyCodeEditor
              schema={{
                type: 'code',
                language,
                theme: 'vs-dark',
                height: '280px',
                readOnly,
              }}
              value={editorText}
              onChange={commit}
            />
          </React.Suspense>
        )}
      </div>
    </div>
  );
}
